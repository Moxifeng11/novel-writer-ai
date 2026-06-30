import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { findChapterFile, findBodyFileV4, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { pjStepDir, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjForeshadowDB } from '../shared/paths';
import { diagnoseOutline } from '../shared/info-debt';

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
            wrapper.style.setProperty('max-width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(650px, 90vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔍 流程诊断工具' });

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
            console.warn('[小说工坊] 操作失败:', e);
        }

        const f = this.app.vault.getAbstractFileByPath(rp);
        if (f instanceof TFile) { await this.plugin.safeOpenFile(f); }

        new Notice('✅ 诊断报告已生成', 5000);
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

function showError(msg: string): void {
    new Notice(`❌ ${msg}`, 5000);
}
