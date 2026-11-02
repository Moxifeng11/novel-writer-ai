/**
 * humanize-report-modal.ts — 正文“人味体检”面板
 *
 * 只做两件事：
 *   1. 把段落碎片化、句长、对话、标点等指标摊开给用户看；
 *   2. 提供确定性的“自然段重排”，合并相邻短段、把对话和说话人的动作并段。
 *
 * 不在这里调用模型。需要重写句子时，用步骤页的「AI 消痕改写」。
 */
import { App, Modal, Notice } from 'obsidian';
import {
    analyzeProse,
    formatProseMetrics,
    scoreProseRisk,
    type ProseIssue,
    type ProseMetrics,
    type ProseRiskReport,
} from '../shared/prose-metrics';
import { naturalizeBodyText, type NaturalizeResult } from '../shared/prose-naturalizer';

/**
 * HumanizeReportModalOptions 类型定义。
 */
export interface HumanizeReportModalOptions {
    /** 当前正文（可含 `# 第X章` 标题行） */
    bodyText: string;
    /** 应用重排后的完整正文 */
    onApply?: (nextText: string) => Promise<void> | void;
}

interface BodyParts {
    title: string;
    body: string;
}

function splitTitle(text: string): BodyParts {
    const match = text.match(/^(#{1,6}\s*第[^\n]*\n+)/);
    if (!match) return { title: '', body: text };
    return { title: match[1], body: text.slice(match[1].length) };
}

const LEVEL_LABEL: Record<ProseRiskReport['level'], string> = {
    low: '低',
    medium: '中',
    high: '高',
};

/**
 * HumanizeReportModal 类。
 */
export class HumanizeReportModal extends Modal {
    private readonly options: HumanizeReportModalOptions;
    private parts: BodyParts;
    private preview: NaturalizeResult | null = null;
    private previewEl: HTMLElement | null = null;
    private applyBtn: HTMLButtonElement | null = null;

    constructor(app: App, options: HumanizeReportModalOptions) {
        super(app);
        this.options = options;
        this.parts = splitTitle(options.bodyText || '');
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-humanize-modal');

        const report = scoreProseRisk(analyzeProse(this.parts.body));
        contentEl.createEl('h2', { text: '📊 人味体检', cls: 'nw-humanize-title' });
        contentEl.createEl('p', {
            text: '这些指标只反映可读性和碎片化风险，不代表任何外部检测器的判定。分数高时先合并短段、补对话和过渡，再考虑整段改写。',
            cls: 'nw-humanize-subtitle',
        });

        this.renderScore(contentEl, report);
        this.renderMetricGrid(contentEl, report.metrics);
        this.renderIssues(contentEl, report.issues);

        this.previewEl = contentEl.createDiv({ cls: 'nw-humanize-preview nw-humanize-hidden' });

        const actions = contentEl.createDiv({ cls: 'nw-humanize-actions' });
        const naturalizeBtn = actions.createEl('button', {
            text: '🪄 自然段重排',
            cls: 'nw-humanize-btn nw-humanize-btn-primary',
        });
        naturalizeBtn.onclick = () => this.buildPreview();

        this.applyBtn = actions.createEl('button', {
            text: '应用到正文',
            cls: 'nw-humanize-btn',
        });
        this.applyBtn.disabled = true;
        this.applyBtn.onclick = () => { void this.applyPreview(); };

        const closeBtn = actions.createEl('button', {
            text: '关闭',
            cls: 'nw-humanize-btn',
        });
        closeBtn.onclick = () => this.close();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    private renderScore(container: HTMLElement, report: ProseRiskReport): void {
        const card = container.createDiv({ cls: `nw-humanize-score nw-humanize-level-${report.level}` });
        card.createDiv({ cls: 'nw-humanize-score-value', text: String(report.score) });
        const meta = card.createDiv({ cls: 'nw-humanize-score-meta' });
        meta.createDiv({ cls: 'nw-humanize-score-label', text: `碎片化风险：${LEVEL_LABEL[report.level]}` });
        meta.createDiv({
            cls: 'nw-humanize-score-hint',
            text: report.issues.length > 0
                ? `发现 ${report.issues.length} 项可改进点`
                : '段落和句长看起来正常',
        });
    }

    private renderMetricGrid(container: HTMLElement, metrics: ProseMetrics): void {
        const grid = container.createDiv({ cls: 'nw-humanize-grid' });
        const items: Array<{ label: string; value: string; hint: string }> = [
            { label: '平均叙述段长', value: `${metrics.avgNarrativeParagraphLength} 字`, hint: '目标 80–220 字' },
            { label: '单句叙述段', value: `${Math.round(metrics.singleSentenceNarrativeParagraphRatio * 100)}%`, hint: '目标 ≤ 30%' },
            { label: '平均句长', value: `${metrics.avgSentenceLength} 字`, hint: '目标 20–30 字' },
            { label: '长句占比', value: `${Math.round(metrics.longSentenceRatio * 100)}%`, hint: '目标 10–20%（≥35 字）' },
            { label: '短句占比', value: `${Math.round(metrics.shortSentenceRatio * 100)}%`, hint: '目标 ≤ 25%（≤10 字）' },
            { label: '对话占比', value: `${Math.round(metrics.dialogueCharsRatio * 100)}%`, hint: '目标 25–45%' },
            { label: '破折号', value: `${metrics.dashPer1000}/千字`, hint: '目标 ≤ 2/千字' },
            { label: '句首多样性', value: `${Math.round(metrics.sentenceStartDiversity * 100)}%`, hint: '越高越好' },
        ];
        for (const item of items) {
            const cell = grid.createDiv({ cls: 'nw-humanize-cell' });
            cell.createDiv({ cls: 'nw-humanize-cell-label', text: item.label });
            cell.createDiv({ cls: 'nw-humanize-cell-value', text: item.value });
            cell.createDiv({ cls: 'nw-humanize-cell-hint', text: item.hint });
        }
    }

    private renderIssues(container: HTMLElement, issues: ProseIssue[]): void {
        if (issues.length === 0) {
            container.createDiv({ cls: 'nw-humanize-ok', text: '✅ 没有发现明显的碎片化问题。' });
            return;
        }
        const list = container.createDiv({ cls: 'nw-humanize-issues' });
        for (const issue of issues) {
            const item = list.createDiv({ cls: `nw-humanize-issue nw-humanize-level-${issue.severity}` });
            const head = item.createDiv({ cls: 'nw-humanize-issue-head' });
            head.createSpan({ cls: 'nw-humanize-issue-badge', text: LEVEL_LABEL[issue.severity] });
            head.createSpan({ cls: 'nw-humanize-issue-title', text: issue.title });
            item.createDiv({ cls: 'nw-humanize-issue-detail', text: issue.detail });
            item.createDiv({ cls: 'nw-humanize-issue-suggestion', text: `建议：${issue.suggestion}` });
        }
    }

    private buildPreview(): void {
        if (!this.previewEl) return;
        const result = naturalizeBodyText(this.parts.body);
        this.preview = result;
        this.previewEl.empty();
        this.previewEl.classList.remove('nw-humanize-hidden');

        if (result.mergedParagraphs === 0) {
            this.previewEl.createDiv({ cls: 'nw-humanize-ok', text: '没有可合并的相邻短段。' });
            if (this.applyBtn) this.applyBtn.disabled = true;
            return;
        }

        const before = scoreProseRisk(analyzeProse(this.parts.body));
        const after = scoreProseRisk(analyzeProse(result.text));
        const head = this.previewEl.createDiv({ cls: 'nw-humanize-preview-head' });
        head.createEl('h3', { text: '自然段重排预览' });
        head.createDiv({
            cls: 'nw-humanize-preview-stats',
            text: `${result.changes.join('；')}。风险分 ${before.score} → ${after.score}。`,
        });
        head.createDiv({
            cls: 'nw-humanize-preview-note',
            text: '只合并段落边界，不改写句子。应用后请通读一遍，确认对话归属和场景切换没有被误并。',
        });

        const cols = this.previewEl.createDiv({ cls: 'nw-humanize-compare' });
        const beforeCol = cols.createDiv({ cls: 'nw-humanize-col' });
        beforeCol.createEl('h4', { text: '重排前' });
        beforeCol.createDiv({ cls: 'nw-humanize-text', text: this.parts.body.slice(0, 2400) });
        const afterCol = cols.createDiv({ cls: 'nw-humanize-col' });
        afterCol.createEl('h4', { text: '重排后' });
        afterCol.createDiv({ cls: 'nw-humanize-text', text: result.text.slice(0, 2400) });

        const metrics = this.previewEl.createDiv({ cls: 'nw-humanize-metrics' });
        metrics.createEl('pre', { text: formatProseMetrics(after.metrics) });

        if (this.applyBtn) this.applyBtn.disabled = false;
    }

    private async applyPreview(): Promise<void> {
        if (!this.preview || !this.options.onApply || !this.applyBtn) return;
        this.applyBtn.disabled = true;
        this.applyBtn.setText('应用中...');
        try {
            await this.options.onApply(`${this.parts.title}${this.preview.text}`);
            new Notice('✅ 已应用自然段重排');
            this.close();
        } catch (error) {
            new Notice(`❌ 应用失败：${error instanceof Error ? error.message : String(error)}`, 6000);
            this.applyBtn.disabled = false;
            this.applyBtn.setText('应用到正文');
        }
    }
}
