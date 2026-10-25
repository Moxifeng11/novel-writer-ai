import { App, Modal, Notice, Platform, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { findChapterFile, findBodyFileV4, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { pjStepDir, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjForeshadowDB } from '../shared/paths';
import { diagnoseOutline } from '../shared/info-debt';
import { createLogger } from '../shared/logger';
import { getDegradationNotifier } from '../shared/degradation-notifier';
import { exportTextFile } from '../shared/export-file';
import { getBudgetSnapshots } from '../shared/budget-telemetry';
import { ENGINE_NAMES } from '../engine/engine-registry';


const log = createLogger('DiagnoseWriterModal');
export class DiagnoseWriterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔍 流程诊断工具' });

        this.renderBudgetSection(contentEl);

        const bundleRow = contentEl.createDiv({ attr: { style: 'margin-bottom:12px;' } });
        const bundleBtn = bundleRow.createEl('button', {
            text: '📦 导出诊断包',
            cls: 'nw-btn novel-writer-button',
            attr: { type: 'button' },
        });
        bundleBtn.onclick = () => void this.exportDiagnosticBundle();

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const volSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const chapInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '章节号',
            cls: 'nw-input novel-writer-input'
        });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });
            // 默认定位当前项目，避免工作台里点诊断还要手动找项目
            const preferred = this.plugin.getActiveProject();
            if (preferred && projects.includes(preferred)) projectSelect.value = preferred;

            await this.populateVolumes(projectSelect.value, volSelect);

            projectSelect.onchange = async () => {
                await this.populateVolumes(projectSelect.value, volSelect);
            };

            const diagnoseButton = contentEl.createEl('button', { text: '开始诊断', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            diagnoseButton.onclick = async () => {
                const project = projectSelect.value;
                const volume = volSelect.value;
                const chapNum = parseInt(chapInput.value);

                if (!chapNum) {
                    showError('请输入章节号');
                    return;
                }

                await this.diagnose(project, volume, chapNum);
            };
        };

        populateProjects();
    }

    /** 最近 prompt 预算：模型/输入/可用/丢弃片段，帮助定位本地小窗口被裁剪的原因 */
    private renderBudgetSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'nw-diagnose-budget' });
        section.createEl('h3', { text: '📊 最近预算' });
        const snapshots = getBudgetSnapshots().slice(-5).reverse();
        if (snapshots.length === 0) {
            section.createDiv({ cls: 'nw-diagnose-budget-empty', text: '暂无预算记录；执行一次生成/续写后再打开诊断。' });
            return;
        }
        const list = section.createDiv({ cls: 'nw-diagnose-budget-list' });
        for (const snapshot of snapshots) {
            const row = list.createDiv({ cls: 'nw-diagnose-budget-row' });
            const head = row.createDiv({ cls: 'nw-diagnose-budget-head' });
            head.createSpan({ cls: 'nw-diagnose-budget-source', text: snapshot.source });
            head.createSpan({ cls: 'nw-diagnose-budget-model', text: snapshot.model || '未记录模型' });
            head.createSpan({ cls: 'nw-diagnose-budget-time', text: new Date(snapshot.at).toLocaleTimeString() });

            const metrics: string[] = [];
            if (typeof snapshot.inputTokens === 'number') metrics.push(`输入 ~${snapshot.inputTokens}`);
            if (typeof snapshot.availableTokens === 'number') metrics.push(`可用 ${snapshot.availableTokens}`);
            if (typeof snapshot.contextWindow === 'number') metrics.push(`窗口 ${snapshot.contextWindow}`);
            if (typeof snapshot.maxInputTokens === 'number') metrics.push(`预算 ${snapshot.maxInputTokens}`);
            row.createDiv({ cls: 'nw-diagnose-budget-metrics', text: metrics.join(' · ') || '未记录 token 指标' });

            if (snapshot.overBudget) {
                row.createSpan({ cls: 'nw-diagnose-budget-over', text: '超预算' });
            }
            if (snapshot.droppedSections.length > 0) {
                row.createDiv({ cls: 'nw-diagnose-budget-dropped', text: `丢弃：${snapshot.droppedSections.join('、')}` });
            }
            if (snapshot.trimmedSections.length > 0) {
                row.createDiv({ cls: 'nw-diagnose-budget-trimmed', text: `截断：${snapshot.trimmedSections.join('、')}` });
            }
        }
    }

    private async populateVolumes(project: string, selectEl: HTMLSelectElement): Promise<void> {
        selectEl.innerHTML = '';
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            // v4.0：卷目录位于 正文/ 或 步骤结果/ 之下
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
            if (m && !volDirs.includes(m[1])) volDirs.push(m[1]);
        }
        volDirs.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
        if (volDirs.length === 0) {
            selectEl.createEl('option', { value: '', text: '未找到卷目录' });
        } else {
            volDirs.forEach(vol => {
                selectEl.createEl('option', { value: vol, text: vol });
            });
        }
    }

    private async diagnose(project: string, volume: string, chapNum: number): Promise<void> {
        const chapName = `第${chapNum}章`;
        const volN = parseInt(volume.match(/\d+/)?.[0] || '0', 10);
        // v4.0：步骤结果目录与正文目录分离；chapDir 现指步骤结果目录。
        const chapDir = pjStepDir(project, volN, chapNum);

        const report: string[] = [];
        report.push(`# 流程诊断报告 — ${chapName}`);
        report.push(`项目: ${project}`);
        report.push(`卷: ${volume}`);
        report.push(`路径: ${chapDir}`);
        report.push('');

        // v4.0：正文位于 正文/第V卷/，与 chapDir（步骤结果）分离。
        const bodyFile = findBodyFileV4(this.app, project, volN, chapNum);
        report.push(`## 1. 正文文件`);
        report.push(bodyFile ? `✅ 存在: ${bodyFile.path}` : '❌ 不存在');
        if (bodyFile) {
            const size = (await this.app.vault.read(bodyFile)).length;
            report.push(`大小: ${size} 字节`);
        }

        const infoFile = findChapterFile(this.app.vault.getFiles(), chapDir, CHAPTER_FILE_TYPES.infoPlan);
        report.push('');
        report.push(`## 2. 信息规划`);
        report.push(infoFile ? `✅ 存在: ${infoFile.path}` : '❌ 不存在');
        if (infoFile) {
            const c = (await this.app.vault.read(infoFile)).length;
            report.push(`大小: ${c} 字节`);
        }

        const outlineFile = this.app.vault.getFiles().find(f => f.path.startsWith(chapDir) && f.name.includes('大纲摘要'));
        report.push('');
        report.push(`## 3. 大纲摘要`);
        report.push(outlineFile ? `✅ 存在: ${outlineFile.path}` : '❌ 不存在');
        if (outlineFile) {
            const raw = await this.app.vault.read(outlineFile);
            const result = diagnoseOutline(raw);
            report.push(`大纲摘要检查: ${result}`);
        }

        report.push('');
        report.push(`## 4. 信息债状态`);
        try {
            const ff = this.app.vault.getAbstractFileByPath(`${pjForeshadowDB(project)}`);
            if (ff instanceof TFile) {
                const fc = await this.app.vault.read(ff);
                let count = 0;
                const names: string[] = [];
                for (const line of fc.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---')) continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') {
                        count++;
                        names.push(cols.length >= 6 ? cols[1] : cols[0]);
                    }
                }
                report.push(`未揭示伏笔: ${count} 个`);
                if (count > 10) {
                    const take = count > 20 ? 4 : count > 15 ? 3 : 2;
                    report.push(`本批将揭示: ${names.slice(0, take).join('、')}`);
                } else if (count > 5) {
                    report.push(`本批将揭示: ${names.slice(0, 1).join('、')}`);
                }
            } else {
                report.push('❌ 伏笔库.md 不存在');
            }
        } catch (e) {
            report.push(`❌ 读取伏笔库失败: ${(e as Error).message}`);
        }

        report.push('');
        report.push(`## 5. API 配置`);
        if (this.plugin.settings.apiKey) {
            report.push(`✅ API Key 已配置`);
            report.push(`Endpoint: ${this.plugin.settings.apiEndpoint}`);
            report.push(`Model: ${this.plugin.settings.defaultModel}`);
        } else {
            report.push('❌ API Key 未配置');
        }

        const reportFile = this.app.vault.getFiles().find(f => f.path.startsWith(chapDir) && f.name.includes('分析报告'));
        report.push('');
        report.push(`## 6. 分析报告（上次运行遗留）`);
        report.push(reportFile ? `⚠️ 存在: ${reportFile.path}` : '🆕 尚不存在');

        const rp = `${chapDir}/${chapName}_诊断报告.md`;
        try {
            const existingDiag = this.app.vault.getAbstractFileByPath(rp);
            if (existingDiag) await this.app.vault.delete(existingDiag);
            await this.app.vault.create(rp, report.join('\n'));
        } catch (e) {
            log.warn('[小说工坊] 操作失败:', e);
        }

        const f = this.app.vault.getAbstractFileByPath(rp);
        if (f instanceof TFile) { await this.plugin.safeOpenFile(f); }

        new Notice('✅ 诊断报告已生成', 5000);
        this.close();
    }

    /**
     * 导出诊断包（FR-E-08）：版本、平台、能力开关、降级记录、最近错误。
     * 不包含 API Key、正文或任何文件内容。
     */
    private async exportDiagnosticBundle(): Promise<void> {
        const settings = this.plugin.settings;
        const degradation = getDegradationNotifier().getEvents().map(event => ({
            source: event.source,
            dimension: event.dimension,
            from: event.from,
            to: event.to,
            reason: event.reason,
            severity: event.severity,
            recoverable: event.recoverable,
            timestamp: new Date(event.timestamp).toISOString(),
        }));

        let updateStatus: Record<string, unknown> | null = null;
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.CACHE_MANAGER);
            if (cacheManager) {
                updateStatus = {
                    lastCheck: cacheManager.getUpdateLastCheck?.() ?? null,
                    lastResult: cacheManager.getUpdateLastResult?.() ?? null,
                };
            }
        } catch {
            updateStatus = null;
        }

        const endpointHost = (() => {
            try {
                return new URL(settings.apiEndpoint).host;
            } catch {
                return 'invalid-endpoint';
            }
        })();

        const bundle = {
            meta: {
                generatedAt: new Date().toISOString(),
                pluginVersion: this.plugin.manifest.version,
                platform: Platform.isDesktop ? 'desktop' : 'mobile',
                os: typeof process !== 'undefined' ? process.platform : 'unknown',
            },
            capabilities: {
                isDesktop: Platform.isDesktop,
                isMobile: Platform.isMobile,
                apiKeyConfigured: Boolean(settings.apiKey)
                    || Object.values(settings.providerKeys ?? {}).some(Boolean),
                precisionMode: settings.precisionMode,
                autoPlotEvaluation: settings.autoPlotEvaluation,
                autoGhostAssociation: settings.autoGhostAssociation ?? true,
                autoReview: settings.enableAutoReview,
                autoCorrect: settings.enableAutoCorrect,
                models: {
                    default: settings.defaultModel,
                    flash: settings.flashModel,
                    pro: settings.proModel,
                },
                maxContext: settings.maxContext,
                maxOutput: settings.maxOutput,
            },
            endpoint: {
                host: endpointHost,
                // 仅保留协议与主机，避免泄露路径/查询参数中的凭据
                updateSource: settings.updateSource,
            },
            degradation,
            updateStatus,
            notes: '诊断包不含 API Key、正文与文件内容；降级记录最多保留最近 200 条。',
        };

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const result = await exportTextFile(
            this.app,
            `novel-writer-diagnostic-${stamp}.json`,
            JSON.stringify(bundle, null, 2),
            { mime: 'application/json;charset=utf-8', successMessage: '✅ 诊断包已导出', preferVault: true },
        );
        if (!result.ok) {
            log.warn('[DiagnoseWriterModal] 诊断包导出失败:', result.error);
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

function showError(msg: string): void {
    new Notice(`❌ ${msg}`, 5000);
}
