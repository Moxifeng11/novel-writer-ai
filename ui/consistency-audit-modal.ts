/**
 * consistency-audit-modal.ts — 跨章一致性审核视图（S4）
 *
 * 设计取舍：**不塞进章节质量看板**。质量看板是「章级」的（必须先定位到某一章才能打开），
 * 而一致性审核是「项目级」的（跨全部章节比对），塞进去语义不符、入口也别扭。
 * 因此做成从命令「一致性审核」打开的专用 Modal，与「流程诊断」「番茄榜单」等工具命令一致。
 *
 * 每条矛盾的呈现必须包含（缺一不算命中，与引擎层约定一致）：
 *  类型徽章 · 严重度 · 人类可读理由 · **双侧证据（章节 + 引文）** · 置信度 · 可跳转到正文位置
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { listProjectIds } from '@/shared/project-catalog';
import { runAuditForProject } from '@/engine/consistency/consistency-audit-wiring';
import { formatReportSummary, type AuditReport } from '@/engine/consistency/audit-pipeline';
import {
    ASSERTION_KIND_META,
    type ConsistencyContradiction,
    type ConsistencyEvidence,
} from '@/engine/consistency/assertion-model';
import { chapterNumOf } from '@/engine/consistency/consistency-audit-wiring';
import {
    buildEmptyStateHint,
    canJumpToEvidence,
    formatEvidenceChapter,
    formatEvidenceTitle,
    formatKindBadge,
    formatMetaLine,
    offsetToLine,
} from './consistency-audit-format';

/** 日志器 */
const log = createLogger('ConsistencyAudit');
import { createLogger } from '@/shared/logger';

/** Modal 选项 */
export interface ConsistencyAuditModalOptions {
    /** 打开时是否自动跑一次审核（默认 true） */
    autoRun?: boolean;
}

/**
 * 跨章一致性审核视图。
 */
export class ConsistencyAuditModal extends Modal {
    private readonly plugin: NovelWriterPlugin;

    private readonly options: ConsistencyAuditModalOptions;

    private project = '';

    private report: AuditReport | null = null;

    private listEl: HTMLElement | null = null;

    private summaryEl: HTMLElement | null = null;

    private statusEl: HTMLElement | null = null;

    /** 是否启用模型复核（默认启用，但仅有疑似配对时才会真的调用） */
    private useLlm = true;

    /**
     * 构造。
     *
     * @param app - Obsidian 应用
     * @param plugin - 插件实例
     * @param options - 选项
     */
    constructor(app: App, plugin: NovelWriterPlugin, options: ConsistencyAuditModalOptions = {}) {
        super(app);
        this.plugin = plugin;
        this.options = options;
    }

    /**
     * 渲染入口。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-consistency-modal');
        contentEl.createEl('h2', { text: '🔍 跨章一致性审核' });

        const project = this.plugin.getActiveProject();
        if (!project) {
            contentEl.createEl('p', {
                cls: 'nw-consistency-hint',
                text: '请先打开一个项目（章节正文或项目内任意文件），再运行一致性审核。',
            });
            return;
        }
        this.project = project;
        contentEl.createEl('p', {
            cls: 'nw-consistency-subtitle',
            text: `项目：${project} ｜ 检查：数量/外貌不符 · 时间线与时长 · 同时性 · 命名混淆 · 废弃伏笔`,
        });

        this.renderToolbar(contentEl);
        this.summaryEl = contentEl.createEl('div', { cls: 'nw-consistency-summary' });
        this.statusEl = contentEl.createEl('div', { cls: 'nw-consistency-status' });
        this.listEl = contentEl.createEl('div', { cls: 'nw-consistency-list' });

        if (this.options.autoRun !== false) void this.runAudit();
    }

    /**
     * 清理。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * 顶部工具栏：重跑 / 模型复核开关。
     *
     * @param parent - 容器
     */
    private renderToolbar(parent: HTMLElement): void {
        const bar = parent.createEl('div', { cls: 'nw-consistency-toolbar' });

        const runBtn = bar.createEl('button', { text: '重新检查', cls: 'mod-cta' });
        runBtn.addEventListener('click', () => { void this.runAudit(); });

        const label = bar.createEl('label', { cls: 'nw-consistency-toggle' });
        const checkbox = label.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.useLlm;
        checkbox.addEventListener('change', () => { this.useLlm = checkbox.checked; });
        label.createEl('span', { text: '疑似项交模型复核（会产生少量费用）' });
    }

    /**
     * 跑审核并渲染。
     */
    private async runAudit(): Promise<void> {
        if (!this.listEl || !this.summaryEl || !this.statusEl) return;
        this.statusEl.setText('正在检查…');
        this.listEl.empty();
        try {
            const result = await runAuditForProject(this.app, this.plugin, this.project, {
                useLlm: this.useLlm,
                maxPairs: 10,
            });
            this.report = result.report;
            this.statusEl.setText('');
            this.renderSummary(result.report, result.warnings);
            this.renderList(result.report);
        } catch (error) {
            log.error('[一致性审核] 运行失败:', error);
            this.statusEl.setText(`检查失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 汇总区。
     *
     * @param report - 报告
     * @param warnings - 数据源告警
     */
    private renderSummary(report: AuditReport, warnings: readonly string[]): void {
        if (!this.summaryEl) return;
        this.summaryEl.empty();
        for (const line of formatReportSummary(report)) {
            this.summaryEl.createEl('div', { text: line });
        }
        // 数据源读失败必须显式提示：否则用户会以为「没问题」，实际是「没检查全」
        for (const warning of warnings) {
            this.summaryEl.createEl('div', { cls: 'nw-consistency-warning', text: `⚠️ ${warning}` });
        }
    }

    /**
     * 矛盾列表。
     *
     * @param report - 报告
     */
    private renderList(report: AuditReport): void {
        if (!this.listEl) return;
        this.listEl.empty();
        if (report.contradictions.length === 0) {
            const empty = this.listEl.createEl('div', { cls: 'nw-consistency-empty' });
            empty.createEl('div', { text: '未发现跨章一致性矛盾。' });
            empty.createEl('div', {
                cls: 'nw-consistency-hint',
                text: buildEmptyStateHint(),
            });
            return;
        }
        for (const contradiction of report.contradictions) {
            this.renderCard(this.listEl, contradiction);
        }
    }

    /**
     * 单条矛盾卡片。
     *
     * @param parent - 容器
     * @param c - 矛盾
     */
    private renderCard(parent: HTMLElement, c: ConsistencyContradiction): void {
        const meta = formatKindBadge(c.kind);
        const card = parent.createEl('div', { cls: `nw-consistency-card nw-consistency-${meta.severity}` });

        const head = card.createEl('div', { cls: 'nw-consistency-card-head' });
        head.createEl('span', { cls: `nw-consistency-badge nw-consistency-badge-${meta.severity}`, text: meta.label });
        head.createEl('span', { cls: 'nw-consistency-subject', text: `${c.subject} · ${c.predicate}` });
        head.createEl('span', { cls: 'nw-consistency-meta', text: formatMetaLine(c) });

        card.createEl('div', { cls: 'nw-consistency-reason', text: c.reasoning });

        const ev = card.createEl('div', { cls: 'nw-consistency-evidence' });
        this.renderEvidence(ev, 'A', c.evidenceA);
        this.renderEvidence(ev, 'B', c.evidenceB);
    }

    /**
     * 单侧证据（可点击跳转）。
     *
     * @param parent - 容器
     * @param side - 侧别（A/B）
     * @param evidence - 证据
     */
    private renderEvidence(parent: HTMLElement, side: string, evidence: ConsistencyEvidence): void {
        const row = parent.createEl('div', { cls: 'nw-consistency-evidence-row' });
        row.createEl('span', { cls: 'nw-consistency-side', text: side });
        row.createEl('span', { cls: 'nw-consistency-chapter', text: formatEvidenceChapter(evidence) });
        const quote = row.createEl('span', { cls: 'nw-consistency-quote', text: `「${evidence.quote}」` });
        quote.title = formatEvidenceTitle(evidence);

        if (!canJumpToEvidence(evidence)) return;
        const jump = row.createEl('button', { cls: 'nw-consistency-jump', text: '跳到正文' });
        jump.addEventListener('click', () => { void this.jumpToEvidence(evidence); });
    }

    /**
     * 打开章节并把光标移到证据位置。
     *
     * @param evidence - 证据
     */
    private async jumpToEvidence(evidence: ConsistencyEvidence): Promise<void> {
        try {
            const file = this.findChapterFile(evidence.chapterKey);
            if (!file) {
                new Notice('未找到对应章节正文文件', 3000);
                return;
            }
            const content = await this.app.vault.cachedRead(file);
            const line = offsetToLine(content, evidence.offset ?? 0);
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
            const editor = (leaf.view as unknown as { editor?: { setCursor: (p: { line: number; ch: number }) => void; scrollIntoView: (r: unknown, center: boolean) => void } }).editor;
            if (!editor) return;
            const pos = { line, ch: 0 };
            editor.setCursor(pos);
            editor.scrollIntoView({ from: pos, to: pos }, true);
        } catch (error) {
            new Notice(`无法跳转：${error instanceof Error ? error.message : String(error)}`, 4000);
        }
    }

    /**
     * 按章节 key 找正文文件（章号匹配，兼容卷目录）。
     *
     * @param chapterKey - 章节 key
     * @returns 文件；找不到返回 null
     */
    private findChapterFile(chapterKey: string): TFile | null {
        const num = chapterNumOf(chapterKey);
        if (num === null) return null;
        const root = `${this.project}/03-大纲与章节/正文`;
        const candidates = this.app.vault.getMarkdownFiles().filter((file) => {
            if (!file.path.startsWith(`${root}/`)) return false;
            const match = /第(\d+)章/.exec(file.name);
            return Boolean(match) && Number(match![1]) === num;
        });
        return candidates[0] ?? null;
    }
}

