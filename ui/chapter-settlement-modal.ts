import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import { SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';

import NovelWriterPlugin from '../main';
import { getChapterFileName, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from './full-writer-view';
import { SettlementEngine } from '../engine/settlement-engine';
import { writeChapterStateSnapshot } from '../engine/chapter-state-snapshot-service';
import { ENGINE_NAMES } from '../shared/engine-names';
import { createLogger } from '../shared/logger';
import { getExecutionLedger, summarizeSettlement } from '../services/execution-ledger';


const log = createLogger('ChapterSettlementModal');
interface SettlementTargetChapter {
    project: string;
    chapDir: string;
    chapName: string;
    bodyPath: string;
}

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

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
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
        const project = path.split('/')[0];
        const bodyMatch = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第\d+卷)\/(第\d+章)_正文\.md$/);
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
                bodyPath: `${project}/${SUBDIR_BODY_ROOT}/${volume}/${chapName}_正文.md`
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

        if (!reportFile) {
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
        // 执行登记表：Agent 通过 get_execution_status 读取本次结算回写量
        ledger.finish(runId, {
            status: 'done',
            detail: `${target.chapName} 结算表已写入`,
            settlement: summarizeSettlement(result),
        });

        const totalUpdated = result.updated;
        const totalCreated = result.createdChars + result.createdLocs + result.createdFactions + result.createdItems + result.createdForeshadows + result.createdTimelines;
        const summary = this.buildSettlementSummary(target, result, false);

        await this.writeSettlementFile(target, summary);
        await this.writeStateSnapshot(target, bodyText, result.chars);
        new Notice(`✅ 结算完成：更新${totalUpdated}项，新建${totalCreated}项`, 8000);
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

        const summary = this.buildLightSummary(target, wordCount, excerpt, trimmed.length > 240, lightResult);
        await this.writeSettlementFile(target, summary);
        await this.writeStateSnapshot(target, bodyText, lightResult.chars);

        const totalUpdated = lightResult.updated;
        new Notice(`✅ 轻量结算完成：基于正文 frontmatter 更新${totalUpdated}项实体状态；补跑分析报告后可执行完整结算`, 8000);
        await this.refreshWorkspaceAndClose();
    }

    /** v4.0: 结算表 frontmatter（与 元文件/00-系统模板/结算表模板.md 对齐） */
    private buildSettlementFrontmatter(target: SettlementTargetChapter, status: 'completed' | 'pending'): string {
        const volMatch = target.chapDir.match(/\/步骤结果\/(第\d+卷)\//);
        const vol = volMatch ? volMatch[1] : '';
        const now = new Date().toISOString();
        return `---\ntags: [结算表]\n卷: "${vol}"\n章: "${target.chapName}"\nstep_status: generated\nstep_model: ""\nstep_timestamp: ${now}\n结算时间: ${now}\n结算状态: ${status}\n---\n\n`;
    }

    private buildSettlementSummary(target: SettlementTargetChapter, result: { updatedChars: number; updatedForeshadows: number; createdChars: number; createdLocs: number; createdFactions: number; createdItems: number; createdForeshadows: number; createdTimelines: number }, _isLight: boolean): string {
        const fm = this.buildSettlementFrontmatter(target, 'completed');
        return `${fm}# ${target.chapName} 结算表\n\n## 更新状态\n- 人物状态更新：${result.updatedChars} 人\n- 伏笔状态更新：${result.updatedForeshadows} 个\n\n## 新建元素\n- 新建人物：${result.createdChars} 个\n- 新建地点：${result.createdLocs} 个\n- 新建势力：${result.createdFactions} 个\n- 新建物品功法：${result.createdItems} 个\n- 新建伏笔：${result.createdForeshadows} 个\n- 新建时间线事件：${result.createdTimelines} 个\n`;
    }

    private buildLightSummary(target: SettlementTargetChapter, wordCount: number, excerpt: string, truncated: boolean, result?: { updatedChars: number; updatedLocations: number; updatedFactions: number; updatedItems: number; updatedForeshadows: number; chars: string[]; locs: string[]; factions: string[]; items: string[] }): string {
        const fm = this.buildSettlementFrontmatter(target, 'completed');
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
            await this.app.fileManager.processFrontMatter(bodyFile, (fm: any) => {
                fm['status'] = 'settled';
            });
        } catch (e) {
            log.warn('[ChapterSettlementModal] 回写正文 settled 状态失败:', e);
            new Notice('⚠️ 结算表已生成，但正文状态回写失败，请检查 frontmatter');
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

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
