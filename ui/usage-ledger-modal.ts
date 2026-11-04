/**
 * usage-ledger-modal.ts — AI 用量账本
 *
 * 展示最近 AI 调用的 token/耗时/状态汇总，以及按模型/按项目/按来源分布；
 * 数据来自 services/usage-ledger（插件数据目录，不进用户 vault）。
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
 * 费用聚合展示（元）：有任何已计费记录时显示金额，否则（未配置单价）显示 '—'。
 */
function formatCostYuan(value: number): string {
    return value > 0 ? `¥${value.toFixed(4)}` : '—';
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
            ['费用(元)', formatCostYuan(summary.costYuan)],
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
            for (const label of ['模型', '调用', 'Token', '耗时', '费用(元)']) headRow.createEl('th', { text: label });
            for (const model of summary.byModel) {
                const row = table.createEl('tr');
                row.createEl('td', { text: model.model });
                row.createEl('td', { text: `${model.okCalls}✓ / ${model.failedCalls}✗` });
                row.createEl('td', { text: formatTokens(model.totalTokens) });
                row.createEl('td', { text: formatDuration(model.durationMs) });
                row.createEl('td', { text: formatCostYuan(model.costYuan) });
            }
        }

        // 按项目：依赖调用链挂的 usage scope；「(未归因)」行偏大说明有调用点漏挂归因
        if (summary.byProject.length > 0) {
            const projects = this.bodyEl.createDiv({ cls: 'nw-usage-projects' });
            projects.createEl('h4', { text: '按项目' });
            const table = projects.createEl('table', { cls: 'nw-usage-table' });
            const headRow = table.createEl('tr');
            for (const label of ['项目', '调用', 'Token', '耗时']) headRow.createEl('th', { text: label });
            for (const project of summary.byProject) {
                const row = table.createEl('tr');
                row.createEl('td', { text: project.project });
                row.createEl('td', { text: `${project.okCalls}✓ / ${project.failedCalls}✗` });
                row.createEl('td', { text: formatTokens(project.totalTokens) });
                row.createEl('td', { text: formatDuration(project.durationMs) });
            }
        }

        // 按来源：哪条链（步骤/单元写作/Agent/裸 AI）最烧 token 一目了然
        if (summary.bySource.length > 0) {
            const sources = this.bodyEl.createDiv({ cls: 'nw-usage-sources' });
            sources.createEl('h4', { text: '按来源' });
            const table = sources.createEl('table', { cls: 'nw-usage-table' });
            const headRow = table.createEl('tr');
            for (const label of ['来源', '调用', 'Token']) headRow.createEl('th', { text: label });
            for (const source of summary.bySource) {
                const row = table.createEl('tr');
                row.createEl('td', { text: source.source });
                row.createEl('td', { text: String(source.calls) });
                row.createEl('td', { text: formatTokens(source.totalTokens) });
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
        // 归因徽标：来源必有；项目/步骤仅在实际归因到时展示（对应三条调用链的 scope）
        const attribution: string[] = [`来源 ${record.source}`];
        if (record.project) {
            attribution.push(record.stepKey ? `${record.project} · ${record.stepKey}` : record.project);
        }
        const meta = [
            new Date(record.at).toLocaleString(),
            `${formatTokens(record.totalTokens)} tok`,
            formatDuration(record.durationMs),
            ...attribution,
            // 配置了单价的记录追加估算费用；未配置不显示（避免误导为 0 元）
            ...(record.costYuan !== undefined ? [`¥${record.costYuan.toFixed(4)}`] : []),
        ];
        row.createDiv({
            cls: 'nw-usage-meta',
            text: `${meta.join(' · ')}${record.error ? ` · ${record.error}` : ''}`,
        });
    }
}
