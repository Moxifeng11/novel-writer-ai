/**
 * quality-loop-modal.ts — 质量闭环面板（B1 校验 / B2 定向修订 / B4 历史）
 *
 * 这三块能力此前只有插件方法（`runPostGenerationCheck` / `autoReviseChapter` /
 * `runQualityPanel`），界面上没有入口，普通用户根本触达不到。本面板把它们接起来：
 * 选章节 → 运行校验（本地多路检查，不耗 token）→ 看报告 → 定向修订（AI，需凭据，
 * 带确认与轮次上限）→ 自动刷新历史（通过率/类型分布/修订轮次）。
 */

import { Modal, Notice, Setting } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type NovelWriterPlugin from '@/main';
import { getChaptersForProject } from '@/ui/project-utils';
import { listProjectIds } from '@/shared/project-catalog';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import type { QualityPanelView } from '@/services/quality-panel-service';
import type { PostGenerationCheckReport } from '@/shared/post-generation-check-model';
import { FourCheckStore } from '@/services/four-check-store';
import {
    FOUR_CHECK_REFRESH_BUSY_LABEL,
    FOUR_CHECK_REFRESH_HINT,
    FOUR_CHECK_REFRESH_LABEL,
    FOUR_CHECK_SECTION_HINT,
    FOUR_CHECK_SECTION_TITLE,
    describeFourCheckEmpty,
    describeFourCheckHeader,
    describeFourCheckRefreshFailed,
    describeFourCheckRefreshed,
    describeFourCheckRefreshStarted,
} from '@/shared/chapter-four-checks-model';
import type { FourCheckReport, FourCheckStatus } from '@/shared/chapter-four-checks-model';
import {
    describeQualitySummary,
    describeRecordResult,
    describeRevisionOutcome,
    describeSeverityCounts,
    formatCheckedAt,
    pickQualityChapter,
} from '@/shared/quality-loop-model';

const log = createLogger('QualityLoopModal');

/** 定向修订默认轮次上限 */
const DEFAULT_MAX_ROUNDS = 2;

/** 四项校验状态图标（与模型内措辞保持一致） */
const FOUR_CHECK_ICON: Record<FourCheckStatus, string> = {
    pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭',
};

/**
 * 质量闭环面板。
 */
export class QualityLoopModal extends Modal {
    private project = '';
    private projects: string[] = [];
    private chapters: string[] = [];
    private chapter = '';
    private maxRounds = DEFAULT_MAX_ROUNDS;
    private panel: QualityPanelView | null = null;
    private lastReport: PostGenerationCheckReport | null = null;
    private fourChecks: Record<string, FourCheckReport> = {};
    private busy: '' | 'check' | 'revise' | 'load' | 'fourcheck' = '';
    private statusEl: HTMLElement | null = null;
    private reportEl: HTMLElement | null = null;
    private fourChecksEl: HTMLElement | null = null;
    private historyEl: HTMLElement | null = null;

    /**
     * @param plugin - 插件实例
     * @param project - 目标项目（省略时取当前活动项目）
     */
    constructor(private readonly plugin: NovelWriterPlugin, project?: string) {
        super(plugin.app);
        this.project = String(project ?? plugin.getActiveProject() ?? '').trim();
    }

    /** 打开 */
    onOpen(): void {
        this.modalEl.addClass('nw-quality-loop');
        this.projects = listProjectIds(this.app);
        if (!this.project) this.project = this.projects[0] ?? '';
        const context = this.plugin.getWorkbenchContext();
        const preferred = context && context.project === this.project ? context.chapterName : null;
        this.chapters = this.project
            ? getChaptersForProject(this.app, this.project).map(entry => entry.chapter)
            : [];
        this.chapter = pickQualityChapter(this.chapters, preferred);
        this.render();
        void this.loadHistory();
    }

    /** 切换项目：重建章节列表与历史 */
    private switchProject(project: string): void {
        if (!project || project === this.project) return;
        this.project = project;
        this.chapters = getChaptersForProject(this.app, project).map(entry => entry.chapter);
        this.chapter = pickQualityChapter(this.chapters, null);
        this.lastReport = null;
        this.panel = null;
        this.fourChecks = {};
        this.render();
        void this.loadHistory();
    }

    /** 关闭清空 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 读取质量历史 */
    private async loadHistory(): Promise<void> {
        if (!this.project) {
            this.panel = null;
            this.renderHistory();
            return;
        }
        this.busy = 'load';
        this.renderHistory();
        try {
            this.panel = await this.plugin.runQualityPanel(this.project);
        } catch (error) {
            this.panel = null;
            new Notice(`读取质量历史失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
        try {
            this.fourChecks = await new FourCheckStore(this.plugin.app).view(this.project);
        } catch (error) {
            // 四校验结果缺失/损坏只影响该区块展示，不打断质量历史
            this.fourChecks = {};
            log.warn('读取四项校验失败（只影响该区块展示）:', error);
        }
        this.busy = '';
        this.renderHistory();
        this.renderFourChecks();
    }

    /** 运行生成后校验（本地检查，不调用 AI） */
    private async runCheck(): Promise<void> {
        if (this.busy || !this.chapter) return;
        this.busy = 'check';
        this.render();
        try {
            this.lastReport = await this.plugin.runPostGenerationCheck(this.project, this.chapter);
            new Notice(
                `${this.chapter}：${this.lastReport.passed ? '✅ 通过' : '❌ 未通过'}（${describeSeverityCounts(this.lastReport.counts)}）`,
                6000,
            );
        } catch (error) {
            new Notice(`校验失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        } finally {
            this.busy = '';
            this.render();
            await this.loadHistory();
        }
    }

    /** 定向修订（消耗 AI 调用，先确认） */
    private async runRevision(): Promise<void> {
        if (this.busy || !this.chapter) return;
        if (!this.plugin.hasAiCredentials) {
            new Notice('定向修订需要可用的 AI 凭据：请先在「连接与模型」里配置并解锁 API key', 8000);
            return;
        }
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: `对「${this.chapter}」做定向修订？`,
            description: `最多 ${this.maxRounds} 轮，每轮只改校验报告里的问题处；修订稿通过长度/内容守卫才落盘（否则保留原稿）。`,
            warning: `会消耗 ${this.maxRounds} 次以内的正文调用额度。`,
        });
        if (!confirmed) return;
        this.busy = 'revise';
        this.render();
        try {
            const outcome = await this.plugin.autoReviseChapter(this.project, this.chapter, { maxRounds: this.maxRounds });
            this.lastReport = outcome.report;
            new Notice(describeRevisionOutcome(outcome), 9000);
        } catch (error) {
            new Notice(`定向修订失败：${error instanceof Error ? error.message : String(error)}`, 10000);
        } finally {
            this.busy = '';
            this.render();
            await this.loadHistory();
        }
    }

    /** Recompute four checks from on-disk body (paths outside step 7). */
    private async runFourCheckRefresh(): Promise<void> {
        if (this.busy || !this.chapter) return;
        this.busy = 'fourcheck';
        this.render();
        try {
            const report = await this.plugin.refreshFourChecks(this.project, this.chapter);
            this.fourChecks[this.chapter] = report;
            new Notice(describeFourCheckRefreshed(report), 8000);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            new Notice(describeFourCheckRefreshFailed(reason), 8000);
        } finally {
            this.busy = '';
            this.render();
            this.renderFourChecks();
        }
    }

    /** 渲染 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '🔁 质量闭环' });
        if (!this.project) {
            contentEl.createEl('p', {
                text: '没有找到当前项目：请先在「项目与章节」里打开一个作品，或从设置里进入。',
                cls: 'setting-item-description',
            });
            return;
        }
        contentEl.createEl('p', {
            text: `项目：${this.project} · 校验不耗 AI 额度；定向修订会调用模型`,
            cls: 'setting-item-description',
        });

        if (this.projects.length > 1) {
            new Setting(contentEl)
                .setName('项目')
                .addDropdown(dropdown => {
                    for (const item of this.projects) dropdown.addOption(item, item);
                    dropdown.setValue(this.project);
                    dropdown.onChange(value => this.switchProject(value));
                });
        }

        new Setting(contentEl)
            .setName('章节')
            .setDesc(this.chapters.length > 0 ? `共 ${this.chapters.length} 章` : '该项目还没有章节')
            .addDropdown(dropdown => {
                if (this.chapters.length === 0) dropdown.addOption('', '（无章节）');
                for (const name of this.chapters) dropdown.addOption(name, name);
                dropdown.setValue(this.chapter);
                dropdown.onChange(value => {
                    this.chapter = value;
                    this.lastReport = null;
                    this.render();
                    this.renderFourChecks();
                });
            });

        new Setting(contentEl)
            .setName('修订轮次上限')
            .setDesc('定向修订最多跑几轮（每轮最多改 5 条问题）')
            .addDropdown(dropdown => dropdown
                .addOption('1', '1 轮')
                .addOption('2', '2 轮（默认）')
                .addOption('3', '3 轮')
                .setValue(String(this.maxRounds))
                .onChange(value => { this.maxRounds = Math.max(1, Math.min(3, parseInt(value, 10) || DEFAULT_MAX_ROUNDS)); }));

        new Setting(contentEl)
            .setName('运行校验 / 定向修订')
            .setDesc('先校验看问题，再决定是否让 AI 定向修订（修订前会二次确认）')
            .addButton(button => button
                .setButtonText(this.busy === 'check' ? '校验中…' : '运行校验')
                .setDisabled(Boolean(this.busy) || !this.chapter)
                .onClick(() => void this.runCheck()))
            .addButton(button => button
                .setButtonText(this.busy === 'revise' ? '修订中…' : '定向修订')
                .setCta()
                .setDisabled(Boolean(this.busy) || !this.chapter)
                .onClick(() => void this.runRevision()));

        this.statusEl = contentEl.createEl('p', { cls: 'setting-item-description' });
        this.statusEl.setText(
            this.busy === 'check' ? '⌛ 正在运行生成后校验…'
                : this.busy === 'revise' ? '⌛ 正在定向修订（会调用模型，可能需要几十秒）…'
                    : this.busy === 'load' ? '⌛ 正在读取质量历史…'
                        : this.busy === 'fourcheck' ? describeFourCheckRefreshStarted()
                            : '',
        );

        this.reportEl = contentEl.createDiv({ cls: 'nw-quality-loop-report' });
        this.renderReport();

        contentEl.createEl('h4', { text: FOUR_CHECK_SECTION_TITLE });
        contentEl.createEl('p', {
            text: FOUR_CHECK_SECTION_HINT,
            cls: 'setting-item-description',
        });
        new Setting(contentEl)
            .setName(FOUR_CHECK_REFRESH_LABEL)
            .setDesc(FOUR_CHECK_REFRESH_HINT)
            .addButton(button => button
                .setButtonText(this.busy === 'fourcheck' ? FOUR_CHECK_REFRESH_BUSY_LABEL : FOUR_CHECK_REFRESH_LABEL)
                .setDisabled(Boolean(this.busy) || !this.chapter)
                .onClick(() => void this.runFourCheckRefresh()));
        this.fourChecksEl = contentEl.createDiv({ cls: 'nw-quality-loop-four-checks' });
        this.renderFourChecks();

        contentEl.createEl('h4', { text: '质量历史' });
        this.historyEl = contentEl.createDiv({ cls: 'nw-quality-loop-history' });
        this.renderHistory();
    }

    /** 渲染最近一次校验报告 */
    private renderReport(): void {
        if (!this.reportEl) return;
        this.reportEl.empty();
        const report = this.lastReport;
        if (!report) return;
        this.reportEl.createEl('p', {
            text: `最近校验：${report.passed ? '✅ 通过' : '❌ 未通过'}（${describeSeverityCounts(report.counts)}）`,
        });
        if (report.items.length === 0) {
            this.reportEl.createEl('p', { text: '未发现问题。', cls: 'setting-item-description' });
            return;
        }
        const list = this.reportEl.createEl('ul', { cls: 'nw-quality-loop-items' });
        for (const item of report.items.slice(0, 30)) {
            const tag = item.severity === 'error' ? '❌' : item.severity === 'warn' ? '⚠️' : 'ℹ️';
            const li = list.createEl('li', { text: `${tag} ${item.message}` });
            if (item.suggestion) li.createDiv({ cls: 'setting-item-description', text: `建议：${item.suggestion}` });
        }
        if (report.items.length > 30) {
            this.reportEl.createEl('p', { text: `另有 ${report.items.length - 30} 条未展示`, cls: 'setting-item-description' });
        }
    }

    /** 渲染「本章四项校验」（正文保存后落盘，按章覆盖） */
    private renderFourChecks(): void {
        const el = this.fourChecksEl;
        if (!el) return;
        el.empty();
        const report = this.fourChecks[this.chapter];
        if (!report) {
            el.createEl('p', {
                text: describeFourCheckEmpty(this.chapter),
                cls: 'setting-item-description',
            });
            return;
        }
        el.createEl('p', { text: describeFourCheckHeader(report, formatCheckedAt(report.checkedAt)) });
        const list = el.createEl('ul', { cls: 'nw-quality-loop-items' });
        for (const item of report.items) {
            list.createEl('li', { text: `${FOUR_CHECK_ICON[item.status]} [${item.label}] ${item.message}` });
        }
    }

    /** 渲染历史汇总 */
    private renderHistory(): void {
        if (!this.historyEl) return;
        this.historyEl.empty();
        if (this.busy === 'load') {
            this.historyEl.createEl('p', { text: '读取中…', cls: 'setting-item-description' });
            return;
        }
        const panel = this.panel;
        if (!panel) {
            this.historyEl.createEl('p', { text: '读取失败（可点「刷新」重试）。', cls: 'setting-item-description' });
            return;
        }
        for (const line of describeQualitySummary(panel)) {
            this.historyEl.createEl('p', { text: line });
        }
        if (panel.recent.length > 0) {
            const table = this.historyEl.createEl('table', { cls: 'nw-quality-loop-table' });
            const head = table.createEl('tr');
            for (const title of ['章节', '时间', '结论', '轮次']) head.createEl('th', { text: title });
            for (const record of panel.recent) {
                const row = table.createEl('tr');
                row.createEl('td', { text: record.chapterName });
                row.createEl('td', { text: formatCheckedAt(record.checkedAt) });
                row.createEl('td', { text: describeRecordResult(record) });
                row.createEl('td', { text: String(record.revisionRounds) });
            }
        }
        new Setting(this.historyEl)
            .setDesc(`历史文件：${panel.path}`)
            .addButton(button => button
                .setButtonText('刷新')
                .setDisabled(Boolean(this.busy))
                .onClick(() => void this.loadHistory()));
    }
}
