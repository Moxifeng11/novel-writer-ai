/**
 * usage-ledger-modal.ts — AI 用量账本
 *
 * 展示最近 AI 调用的 token/耗时/状态汇总与按模型分布；数据来自
 * services/usage-ledger（插件数据目录，不进用户 vault）。
 */
import { App, Modal } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { getUsageLedger, type UsageRecord } from '@/services/usage-ledger';

function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}

function formatDuration(ms: number): string {
    if (ms >= 60_000) return `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

/**
 * AI 用量账本弹窗。
 */
export class UsageLedgerModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private bodyEl: HTMLElement | null = null;
    private unsubscribe: (() => void) | null = null;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     */
    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /** 打开并订阅账本变化。 */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('💰 AI 用量账本');
        this.contentEl.empty();
        this.contentEl.addClass('nw-usage-ledger');
        this.bodyEl = this.contentEl.createDiv();
        const ledger = getUsageLedger(this.plugin.app);
        await ledger.load();
        this.unsubscribe = ledger.subscribe(() => this.render());
        this.render();
    }

    /** 关闭时取消订阅。 */
    onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.contentEl.empty();
    }

    private render(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        const ledger = getUsageLedger(this.plugin.app);
        const records = ledger.list(200);
        const summary = ledger.summary(200);

        const head = this.bodyEl.createDiv({ cls: 'nw-project-health-head' });
        head.createEl('h3', { text: '最近调用' });
        const refresh = head.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '刷新' });
        refresh.addEventListener('click', () => this.render());
        const clear = head.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '清空' });
        clear.addEventListener('click', () => {
            void ledger.clear().then(() => this.render());
        });

        const summaryEl = this.bodyEl.createDiv({ cls: 'nw-usage-summary' });
        const cards: Array<[string, string]> = [
            ['调用', `${summary.okCalls} 成功 / ${summary.failedCalls} 失败`],
            ['Token', `${formatTokens(summary.totalTokens)}（入 ${formatTokens(summary.promptTokens)} / 出 ${formatTokens(summary.completionTokens)}）`],
            ['总耗时', formatDuration(summary.durationMs)],
        ];
        for (const [label, value] of cards) {
            const card = summaryEl.createDiv({ cls: 'nw-usage-card' });
            card.createDiv({ cls: 'nw-usage-card-label', text: label });
            card.createDiv({ cls: 'nw-usage-card-value', text: value });
        }

        if (summary.byModel.length > 0) {
            const models = this.bodyEl.createDiv({ cls: 'nw-usage-models' });
            models.createEl('h4', { text: '按模型' });
            const table = models.createEl('table', { cls: 'nw-usage-table' });
            const headRow = table.createEl('tr');
            for (const label of ['模型', '调用', 'Token', '耗时']) headRow.createEl('th', { text: label });
            for (const model of summary.byModel) {
                const row = table.createEl('tr');
                row.createEl('td', { text: model.model });
                row.createEl('td', { text: `${model.okCalls}✓ / ${model.failedCalls}✗` });
                row.createEl('td', { text: formatTokens(model.totalTokens) });
                row.createEl('td', { text: formatDuration(model.durationMs) });
            }
        }

        if (records.length === 0) {
            const empty = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '💰' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '还没有调用记录' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '写作、质检、Agent 调用 AI 后会出现在这里。' });
            return;
        }

        const list = this.bodyEl.createDiv({ cls: 'nw-usage-list' });
        for (const record of records.slice(0, 50)) this.renderRecord(list, record);
    }

    private renderRecord(host: HTMLElement, record: UsageRecord): void {
        const row = host.createDiv({ cls: `nw-usage-row nw-is-${record.status}` });
        const main = row.createDiv({ cls: 'nw-usage-row-main' });
        main.createSpan({ cls: 'nw-usage-model', text: record.model });
        main.createSpan({
            cls: 'nw-usage-status',
            text: record.status === 'ok' ? '✅' : record.status === 'aborted' ? '⏹ 已取消' : '❌',
        });
        row.createDiv({
            cls: 'nw-usage-meta',
            text: `${new Date(record.at).toLocaleString()} · ${formatTokens(record.totalTokens)} tok · ${formatDuration(record.durationMs)}${record.error ? ` · ${record.error}` : ''}`,
        });
    }
}
