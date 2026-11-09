import { App, Modal, TFile, TFolder } from 'obsidian';
import { isChapterSettledText } from '@/shared/chapter-status';
import { buildSettlementTable } from '@/engine/settlement/settlement-artifacts';
import { SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjNarrativeOverview } from '@/shared/paths';
import { ObsidianFrontmatter, writeVaultText } from '@/shared/file-system-port';
import { settlementArtifactNotice, writeSettlementArtifacts } from '@/engine/settlement/settlement-coordinator';

import NovelWriterPlugin from '@/main';
import { getChapterFileName, CHAPTER_FILE_TYPES } from '@/engine/chapter-utils';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from './full-writer-view';
import { SettlementEngine } from '@/engine/settlement-engine';
import { writeChapterStateSnapshot } from '@/engine/chapter-state-snapshot-service';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { createLogger } from '@/shared/logger';
import { getExecutionLedger, summarizeSettlement } from '@/services/execution-ledger';
import { OperationConfirmModal } from './components/progress';
import { showSuccessNotice, showWarningNotice } from './components/notice-helpers';


const log = createLogger('ChapterSettlementModal');
interface SettlementTargetChapter {
    project: string;
    chapDir: string;
    chapName: string;
    bodyPath: string;
}

/**
 * 章节结算弹窗。
 */
export class ChapterSettlementModal extends Modal {
    private plugin: NovelWriterPlugin;
    private settlementEngine: SettlementEngine;
    private initialProject?: string;
    private initialVolume?: string;
    private initialChapterNum?: number;
    private initialChapterName?: string;

    constructor(app: App, plugin: NovelWriterPlugin, initial?: { project: string; volume: string; chapterNum: number; chapterName?: string }) {
        super(app);
        this.plugin = plugin;
        this.settlementEngine = plugin.engineRegistry.get(ENGINE_NAMES.SETTLEMENT_ENGINE);
        this.initialProject = initial?.project;
        this.initialVolume = initial?.volume;
        this.initialChapterNum = initial?.chapterNum;
        this.initialChapterName = initial?.chapterName;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }
        contentEl.empty();
        contentEl.createEl('h2', { text: '📋 章节结算' });

        const target = this.resolveTargetChapter();
        if (!target) {
            contentEl.createEl('p', { text: '❌ 请先打开章节正文文件，或从协同写作完成入口打开。' });
            return;
        }

        contentEl.createEl('p', { text: `正在结算 ${target.project} → ${target.chapName}` });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: '优先使用分析报告执行完整结算；如果缺少分析报告，将生成轻量章节结算表。'
        });

        const settleButton = contentEl.createEl('button', { text: '执行结算', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        settleButton.onclick = async () => {
            settleButton.disabled = true;
            settleButton.setText('结算中...');
            try {
                await this.executeSettlement(target);
            } finally {
                settleButton.disabled = false;
                settleButton.setText('执行结算');
            }
        };
    }

    private resolveTargetChapter(): SettlementTargetChapter | null {
        if (this.initialProject && this.initialVolume && this.initialChapterNum) {
            const chapName = this.initialChapterName || `第${this.initialChapterNum}章`;
            return {
                project: this.initialProject,
                chapDir: `${this.initialProject}/03-大纲与章节/步骤结果/${this.initialVolume}/${chapName}`,
                chapName,
                bodyPath: `${this.initialProject}/03-大纲与章节/正文/${this.initialVolume}/${chapName}_正文.md`
            };
        }

        // 工作台/项目页没有 activeFile：用界面当前章节，避免结算入口点进来无法执行
        const target = this.plugin.getActiveChapterTarget();
        if (target) {
            return {
                project: target.project,
                chapDir: target.chapDir,
                chapName: target.chapterName,
                bodyPath: target.bodyPath,
            };
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const path = activeFile.path;
        const project = projectIdFromPath(path);
        const bodyMatch = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第\d+卷)\/(第\d+章)[^/]*_正文\.md$/);
        if (bodyMatch) {
            const volume = bodyMatch[2];
            const chapName = bodyMatch[3];
            return {
                project,
                chapDir: `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapName}`,
                chapName,
                bodyPath: path
            };
        }

        const stepMatch = path.match(/^(.+?)\/03-大纲与章节\/步骤结果\/(第\d+卷)\/(第\d+章)\//);
        if (stepMatch) {
            const volume = stepMatch[2];
            const chapName = stepMatch[3];
            return {
                project,
                chapDir: `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapName}`,
                chapName,
                bodyPath: resolveBodyFilePath(this.app, project, volumeNumber(volume), parseInt(chapName.match(/\d+/)?.[0] || '0', 10))
            };
        }

        return null;
    }

    private async executeSettlement(target: SettlementTargetChapter): Promise<void> {
        await this.ensureFolder(target.chapDir);

        const reportFile = this.app.vault.getFiles().find(f =>
            f.path.startsWith(target.chapDir) && f.name.includes('分析报告')
        );
        const bodyFile = this.app.vault.getAbstractFileByPath(target.bodyPath);
        const bodyText = bodyFile instanceof TFile ? await this.app.vault.read(bodyFile) : '';

        // 重复结算守卫：流水线侧已有 settled 守卫，弹窗此前没有，
        // 连点两次会把成长/互信息/账本再写一遍。这里显式确认，避免「手滑重复结算」。
        const settled = isChapterSettledText(bodyText);
        if (settled) {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '本章已结算',
                description: `「${target.chapName}」状态已是 settled。重新结算会再次回写实体/伏笔/时间线（追加类写入已按章去重）。`,
                warning: '若你之后手动改过实体卡或伏笔库，重新结算可能覆盖这些手改。',
                confirmText: '仍要重新结算',
                cancelText: '取消',
            });
            if (!confirmed) return;
        }

        if (!reportFile) {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '未找到分析报告',
                description: '将执行「轻结算」：只根据正文 frontmatter 更新实体出场状态。',
                warning: '轻结算不会更新关系、伏笔、时间线与成长记录；如需完整结算，请先在流水线中生成分析报告。',
                confirmText: '执行轻结算',
                cancelText: '取消',
            });
            if (!confirmed) return;
            await this.createLightSettlement(target, bodyText);
            return;
        }

        const report = await this.app.vault.read(reportFile);
        const ledger = getExecutionLedger();
        const runId = ledger.begin({
            commandId: 'novel-writer-chapter-settlement',
            project: target.project,
            source: 'ui',
            label: `${target.chapName} 结算`,
        });
        let result;
        try {
            result = await this.settlementEngine.settle(target.project, target.chapDir, target.chapName, report, bodyText);
        } catch (e) {
            ledger.finish(runId, { status: 'failed', failure: e instanceof Error ? e.message : String(e) });
            throw e;
        }
        // 空指令集：引擎未执行任何写入（mode=empty），不得写结算表 / 标记 settled
        if (result.mode === 'empty') {
            ledger.finish(runId, {
                status: 'done',
                detail: `${target.chapName} 分析报告无可应用指令，未执行结算`,
            });
            showWarningNotice('分析报告未解析出可应用指令（UPDATE_*/NEW_*/RELATION 等），本次未执行结算；请检查报告，或改用轻结算', { timeout: 8000 });
            return;
        }
        // 部分失败已回滚：不写结算表/快照/总览，也不把正文标 settled。
        if (result.rollback || result.settlementPartial) {
            const detail = result.rollback
                ? `恢复 ${result.rollback.reverted} 项${result.rollback.failed > 0 ? `，回滚失败 ${result.rollback.failed} 项` : ''}`
                : '回滚不完整';
            ledger.finish(runId, {
                status: 'failed',
                failure: `${target.chapName} 结算已回滚（${detail}）`,
            });
            showWarningNotice(`本次结算失败并已回滚（${detail}）；未写结算表、未标记正文 settled，请修正报告后重试`, { title: '结算未完成', timeout: 10000 });
            return;
        }
        // 执行登记表：Agent 通过 get_execution_status 读取本次结算回写量
        ledger.finish(runId, {
            status: 'done',
            detail: `${target.chapName} 结算表已写入`,
            settlement: summarizeSettlement(result),
        });

        const totalUpdated = result.updated;
        const totalCreated = result.createdChars + result.createdLocs + result.createdFactions + result.createdItems + result.createdForeshadows + result.createdTimelines;
        const artifactReport = await writeSettlementArtifacts({
            chapterName: target.chapName,
            volume: (target.chapDir.match(/第(\d+)卷/)?.[0]) || '',
            mode: 'full',
            result,
            model: '',
        }, {
            writeSettlementTable: text => this.writeSettlementFile(target, text),
            writeSnapshot: () => this.writeStateSnapshot(target, bodyText, result.chars),
            // 完整结算后重建叙事总览；失败只记 warning，不影响结算本体
            refreshNarrativeOverview: async () => {
                const overview = await this.settlementEngine.generateNarrativeOverview(target.project);
                if (overview.trim()) {
                    await writeVaultText(this.app, pjNarrativeOverview(target.project), overview);
                }
            },
        });
        const artifactWarning = settlementArtifactNotice(artifactReport);
        // settlementArtifactNotice 文案自带「⚠️ 」前缀，助手标题行会再渲染一次，这里去掉避免重复
        if (artifactWarning) showWarningNotice(artifactWarning.replace(/^⚠️\s*/u, ''), { timeout: 8000 });
        showSuccessNotice(`更新${totalUpdated}项，新建${totalCreated}项`, { title: '结算完成', timeout: 8000 });
        await this.refreshWorkspaceAndClose();
    }

    private async createLightSettlement(target: SettlementTargetChapter, bodyText: string): Promise<void> {
        const trimmed = bodyText.trim();
        const excerpt = trimmed ? trimmed.slice(0, 240).replace(/\n+/g, ' ') : '正文为空，暂无摘要。';
        const wordCount = trimmed.length;

        const lightResult = await this.settlementEngine.settleLight(
            target.project,
            target.chapDir,
            target.chapName,
            bodyText
        );
        getExecutionLedger().recordCompleted({
            commandId: 'novel-writer-chapter-settlement-light',
            project: target.project,
            source: 'ui',
            label: `${target.chapName} 轻量结算`,
            detail: '无分析报告，基于正文 frontmatter 的轻量结算',
            settlement: summarizeSettlement(lightResult),
        });

        const lightTable = this.buildLightSummary(target, wordCount, excerpt, trimmed.length > 240, lightResult);
        const lightReport = await writeSettlementArtifacts({
            chapterName: target.chapName,
            volume: (target.chapDir.match(/第(\d+)卷/)?.[0]) || '',
            mode: 'light',
            result: lightResult,
            tableText: lightTable,
        }, {
            writeSettlementTable: text => this.writeSettlementFile(target, text),
            writeSnapshot: () => this.writeStateSnapshot(target, bodyText, lightResult.chars),
        });
        const lightWarning = settlementArtifactNotice(lightReport);
        // 同 artifactWarning：去掉自带前缀后交给告警助手统一渲染
        if (lightWarning) showWarningNotice(lightWarning.replace(/^⚠️\s*/u, ''), { timeout: 8000 });

        const totalUpdated = lightResult.updated;
        if (lightResult.lightPartial && lightResult.lightFailures) {
            const f = lightResult.lightFailures;
            const parts = [
                f.entities.length > 0 ? `实体 ${f.entities.length} 个（${f.entities.slice(0, 3).join('、')}${f.entities.length > 3 ? '…' : ''}）` : '',
                f.foreshadow ? '伏笔库' : '',
                f.bodyFrontmatter ? '正文状态' : '',
            ].filter(Boolean);
            showWarningNotice(`部分更新失败：${parts.join('、')}；轻结算幂等，可直接重跑修复`, { title: '轻量结算部分完成', timeout: 10000 });
        }
        showSuccessNotice(`基于正文 frontmatter 更新${totalUpdated}项实体状态；补跑分析报告后可执行完整结算`, { title: '轻量结算完成', timeout: 8000 });
        await this.refreshWorkspaceAndClose();
    }

    /** v4.0: 结算表 frontmatter（与 元文件/00-系统模板/结算表模板.md 对齐） */
    private buildSettlementFrontmatter(
        target: SettlementTargetChapter,
        status: 'completed' | 'pending',
        mode: 'full' | 'light',
        partial = false,
    ): string {
        const volMatch = target.chapDir.match(/\/步骤结果\/(第\d+卷)\//);
        const vol = volMatch ? volMatch[1] : '';
        const now = new Date().toISOString();
        return `---\ntags: [结算表]\n卷: "${vol}"\n章: "${target.chapName}"\nstep_status: generated\nstep_model: ""\nstep_timestamp: ${now}\n结算时间: ${now}\n结算状态: ${status}\nsettlement_mode: ${mode}${partial ? '\nsettlement_partial: true' : ''}\n---\n\n`;
    }

    private buildSettlementSummary(target: SettlementTargetChapter, result: { updatedChars: number; updatedForeshadows: number; createdChars: number; createdLocs: number; createdFactions: number; createdItems: number; createdForeshadows: number; createdTimelines: number }, _isLight: boolean): string {
        // 表头/字段由 engine/settlement/settlement-artifacts 统一生成，
        // 避免与「一键成文」路径各写一份模板造成漂移。
        const volMatch = target.chapDir.match(/\/步骤结果\/(第\d+卷)\//);
        return buildSettlementTable({
            chapterName: target.chapName,
            volume: volMatch ? volMatch[1] : '',
            result,
        });
    }

    private buildLightSummary(target: SettlementTargetChapter, wordCount: number, excerpt: string, truncated: boolean, result?: { updatedChars: number; updatedLocations: number; updatedFactions: number; updatedItems: number; updatedForeshadows: number; chars: string[]; locs: string[]; factions: string[]; items: string[] }): string {
        const fm = this.buildSettlementFrontmatter(target, 'completed', 'light');
        const charList = result?.chars?.length ? result.chars.join('、') : '无';
        const locList = result?.locs?.length ? result.locs.join('、') : '无';
        const factionList = result?.factions?.length ? result.factions.join('、') : '无';
        const itemList = result?.items?.length ? result.items.join('、') : '无';
        return `${fm}# ${target.chapName} 轻量结算表\n\n## 结算状态\n- 类型：协同写作轻量结算（基于正文 frontmatter）\n- 正文字数：${wordCount}\n- 分析报告：未找到，执行轻量结算\n\n## 实体状态更新\n- 人物状态更新：${result?.updatedChars || 0} 人（${charList}）\n- 地点状态更新：${result?.updatedLocations || 0} 个（${locList}）\n- 势力状态更新：${result?.updatedFactions || 0} 个（${factionList}）\n- 物品功法更新：${result?.updatedItems || 0} 个（${itemList}）\n- 伏笔状态更新：${result?.updatedForeshadows || 0} 个\n\n## 本章摘要草稿\n${excerpt}${truncated ? '……' : ''}\n\n## 说明\n- 轻量结算基于正文 frontmatter 的「涉及人物/地点/势力/物品功法」字段更新实体状态\n- 补跑「分析报告」后可执行完整章节结算（含详细字段更新、新实体创建、关系更新等）\n- 可结合设定检查面板确认人物状态变更\n`;
    }

    private async writeStateSnapshot(
        target: SettlementTargetChapter,
        bodyText: string,
        updatedChars: string[],
    ): Promise<void> {
        const chapterNum = parseInt(target.chapName.match(/第(\d+)章/)?.[1] || '0', 10);
        const sceneFile = this.app.vault.getFiles().find(f =>
            f.path.startsWith(target.chapDir) && f.name.includes('Scene展开'),
        );
        const sceneExpansion = sceneFile instanceof TFile ? await this.app.vault.read(sceneFile) : '';
        await writeChapterStateSnapshot(this.app, {
            project: target.project,
            chapterNum,
            chapterName: target.chapName,
            bodyText,
            sceneExpansion,
            updatedChars,
        });
    }

    private async writeSettlementFile(target: SettlementTargetChapter, content: string): Promise<void> {
        const settlePath = `${target.chapDir}/${getChapterFileName(target.chapName, CHAPTER_FILE_TYPES.settlement)}`;
        const settleFile = this.app.vault.getAbstractFileByPath(settlePath);
        if (settleFile instanceof TFile) {
            await this.app.vault.modify(settleFile, content);
        } else {
            await this.app.vault.create(settlePath, content);
        }

        await this.markBodySettled(target, settlePath);

        const sf = this.app.vault.getAbstractFileByPath(settlePath);
        if (sf instanceof TFile) {
            await this.plugin.safeOpenFile(sf);
        }
    }

    private async markBodySettled(target: SettlementTargetChapter, settlePath: string): Promise<void> {
        const bodyFile = this.app.vault.getAbstractFileByPath(target.bodyPath);
        if (!(bodyFile instanceof TFile)) {
            log.warn('[ChapterSettlementModal] 正文文件不存在，无法回写 settled 状态:', target.bodyPath);
            return;
        }

        try {
            await new ObsidianFrontmatter(this.app).processFrontmatter(bodyFile, (fm) => {
                fm['status'] = 'settled';
            });
        } catch (e) {
            log.warn('[ChapterSettlementModal] 回写正文 settled 状态失败:', e);
            showWarningNotice('结算表已生成，但正文状态回写失败，请检查 frontmatter');
        }
    }

    private async ensureFolder(path: string): Promise<void> {
        const parts = path.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(current);
            if (!existing) {
                await this.app.vault.createFolder(current);
            } else if (!(existing instanceof TFolder)) {
                throw new Error(`无法创建目录，路径已被文件占用：${current}`);
            }
        }
    }

    private async refreshWorkspaceAndClose(): Promise<void> {
        const wsLeaves = this.plugin.app.workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE);
        for (const leaf of wsLeaves) {
            const view = leaf.view;
            if (view instanceof FullWriterView && typeof view.refreshContextBar === 'function') {
                view.refreshContextBar();
            }
        }
        this.close();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
import { projectIdFromPath } from '@/shared/paths';

import { resolveBodyFilePath } from '@/engine/chapter-utils';
import { volumeNumber } from '@/shared/chapter-target';