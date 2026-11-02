/**
 * execution-panels.ts — 主区域流程时间线、步骤错误卡与固定日志窗口
 *
 * 三块 UI 共用 ExecutionRunStore，不读写执行逻辑，也不影响步骤完成判定。
 */
import type { StepFailure } from '../../shared/execution-events';
import type { ExecutionEvent, ExecutionLogEntry, ExecutionRunStore } from './execution-run-store';
import { formatTime } from './execution-run-store';

/**
 * 执行面板回调。
 */
export interface ExecutionPanelHandlers {
    onRetry: (stepKey: string) => void;
    onOpenLog: () => void;
}

const LEVEL_ICON: Record<string, string> = {
    debug: '·',
    info: '•',
    success: '✓',
    warning: '!',
    error: '✕',
};

/**
 * 执行时间线面板。
 */
export class ExecutionTimelinePanel {
    private unsubscribe: (() => void) | null = null;
    private root: HTMLElement | null = null;
    private list: HTMLElement | null = null;
    private status: HTMLElement | null = null;

    constructor(
        private readonly store: ExecutionRunStore,
        private readonly handlers: ExecutionPanelHandlers,
    ) {}

    /**
     * 挂载面板。
     *
     * @param container - 容器元素
     */
    mount(container: HTMLElement): void {
        this.destroy();
        const root = container.createDiv({ cls: 'nw-exec-timeline' });
        const head = root.createDiv({ cls: 'nw-exec-timeline-head' });
        head.createSpan({ text: '执行流程', cls: 'nw-exec-timeline-title' });
        const clearBtn = head.createEl('button', {
            text: '清空',
            cls: 'nw-exec-mini-btn',
            attr: { title: '清空本次执行的时间线、错误与日志' },
        });
        clearBtn.addEventListener('click', () => this.store.reset());

        this.status = root.createDiv({ cls: 'nw-exec-status' });
        this.list = root.createDiv({ cls: 'nw-exec-event-list' });
        this.root = root;

        this.unsubscribe = this.store.subscribe((change) => {
            if (change === 'status') {
                this.renderStatus();
                return;
            }
            this.render();
        });
        this.render();
    }

    /**
     * 销毁面板。
     */
    destroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.root?.remove();
        this.root = null;
        this.list = null;
        this.status = null;
    }

    private render(): void {
        this.renderStatus();
        if (!this.list) return;
        const list = this.list;
        list.empty();
        const events = this.store.getEvents();
        if (events.length === 0) {
            list.createDiv({ text: '执行本步或一键完成后，流程节点会按时间显示在这里。', cls: 'nw-exec-empty' });
            return;
        }
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        for (const event of events.slice(-80)) {
            const row = list.createDiv({ cls: `nw-exec-event nw-exec-event-${event.level}` });
            row.createSpan({ text: formatTime(event.at), cls: 'nw-exec-time' });
            row.createSpan({ text: LEVEL_ICON[event.level] || '•', cls: 'nw-exec-level' });
            if (event.stepLabel || event.stepKey) {
                row.createSpan({ text: event.stepLabel || event.stepKey || '', cls: 'nw-exec-step' });
            }
            const message = row.createSpan({ text: event.message, cls: 'nw-exec-message' });
            if (event.detail) message.setAttr('title', event.detail);
            if (event.level === 'error') {
                const retry = row.createEl('button', { text: '重试', cls: 'nw-exec-mini-btn' });
                retry.addEventListener('click', () => {
                    if (event.stepKey) this.handlers.onRetry(event.stepKey);
                });
            }
            // v4.20 注入溯源：prompt-ledger 事件渲染成分段表格（谁影响了本次调用、谁被截断）
            if (event.type === 'prompt-ledger') {
                this.renderLedgerDetails(row, event);
            }
        }
        if (atBottom) list.scrollTop = list.scrollHeight;
    }

    /** 注入溯源账本表格：解析事件 debug.ledgerEntries，无解析结果时退回纯文本 */
    private renderLedgerDetails(row: HTMLElement, event: ExecutionEvent): void {
        let entries: Array<{ label: string; influence: string; chars: number; estTokens: number; source?: string; truncated?: boolean }> = [];
        try {
            const parsed = event.debug?.ledgerEntries;
            if (typeof parsed === 'string') entries = JSON.parse(parsed);
        } catch {
            entries = [];
        }
        const nonEmpty = entries.filter((entry) => entry.chars > 0);
        if (nonEmpty.length === 0) return;

        const details = row.createEl('details', { cls: 'nw-exec-ledger' });
        details.createEl('summary', {
            text: `注入溯源 · ${nonEmpty.length} 段 / ${event.debug?.totalChars ?? 0} 字符 / ~${event.debug?.totalEstTokens ?? 0} token`,
            cls: 'nw-exec-ledger-summary',
        });

        const table = details.createEl('table', { cls: 'nw-exec-ledger-table' });
        const head = table.createEl('thead');
        const headRow = head.createEl('tr');
        for (const label of ['注入段', '影响面', '字符', '~token', '来源']) {
            headRow.createEl('th', { text: label });
        }
        const body = table.createEl('tbody');
        for (const entry of nonEmpty) {
            const tr = body.createEl('tr');
            if (entry.truncated) tr.addClass('nw-exec-ledger-truncated');
            tr.createEl('td', { text: `${entry.label}${entry.truncated ? ' ⚠' : ''}` });
            tr.createEl('td', { text: entry.influence });
            tr.createEl('td', { text: String(entry.chars) });
            tr.createEl('td', { text: String(entry.estTokens) });
            tr.createEl('td', { text: entry.source || '' });
        }
    }

    private renderStatus(): void {
        if (!this.status) return;
        const status = this.store.getStatus();
        this.status.setText(status?.message || '等待执行');
        this.status.toggleClass('nw-exec-status-active', Boolean(status));
        const meta = status && status.total
            ? `（${status.current ?? 0}/${status.total} 步${status.aiCalls ? `，${status.aiCalls} 次 AI` : ''}）`
            : '';
        this.status.setAttr('title', `${status?.message || ''}${meta}`);
    }
}

export function renderStepFailureCard(
    container: HTMLElement,
    failure: StepFailure,
    handlers: ExecutionPanelHandlers,
): HTMLElement {
    const card = container.createDiv({ cls: 'nw-exec-failure' });
    const head = card.createDiv({ cls: 'nw-exec-failure-head' });
    head.createSpan({ text: `❌ ${failure.stepLabel} 执行失败`, cls: 'nw-exec-failure-title' });
    head.createSpan({ text: kindLabel(failure.kind), cls: 'nw-exec-failure-kind' });

    const nodeRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    nodeRow.createSpan({ text: '发生节点', cls: 'nw-exec-failure-label' });
    nodeRow.createSpan({ text: `${failure.stepLabel}（${failure.stepKey}）`, cls: 'nw-exec-failure-value' });

    const reasonRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    reasonRow.createSpan({ text: '原因', cls: 'nw-exec-failure-label' });
    reasonRow.createSpan({ text: failure.message, cls: 'nw-exec-failure-value nw-exec-failure-reason' });

    if (failure.missing.length > 0) {
        const missingRow = card.createDiv({ cls: 'nw-exec-failure-row' });
        missingRow.createSpan({ text: '缺失项', cls: 'nw-exec-failure-label' });
        missingRow.createSpan({ text: failure.missing.join('、'), cls: 'nw-exec-failure-value' });
    }

    const hintRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    hintRow.createSpan({ text: '处理建议', cls: 'nw-exec-failure-label' });
    hintRow.createSpan({ text: failure.suggestion, cls: 'nw-exec-failure-value nw-exec-failure-hint' });

    if (failure.detail) {
        const details = card.createEl('details', { cls: 'nw-exec-failure-detail' });
        details.createEl('summary', { text: '查看错误详情' });
        details.createEl('pre', { text: failure.detail });
    }

    const actions = card.createDiv({ cls: 'nw-exec-failure-actions' });
    if (failure.retryable) {
        const retry = actions.createEl('button', { text: '🔄 重试本步', cls: 'nw-btn nw-btn-primary nw-btn-sm' });
        retry.addEventListener('click', () => handlers.onRetry(failure.stepKey));
    }
    const logBtn = actions.createEl('button', { text: '🐞 查看完整日志', cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
    logBtn.addEventListener('click', () => handlers.onOpenLog());
    return card;
}

function kindLabel(kind: StepFailure['kind']): string {
    const labels: Record<StepFailure['kind'], string> = {
        validation: '前置校验',
        api: '接口调用',
        parse: '输出解析',
        save: '保存失败',
        incomplete: '内容不完整',
        truncated: '输出截断',
        exception: '执行异常',
        cancelled: '已取消',
    };
    return labels[kind] || '执行失败';
}

type LogFilter = 'all' | 'error' | 'warning' | 'debug';

/**
 * 执行日志面板。
 */
export class ExecutionLogPanel {
    private root: HTMLElement | null = null;
    private list: HTMLElement | null = null;
    private badge: HTMLElement | null = null;
    private panel: HTMLElement | null = null;
    private filter: LogFilter = 'all';
    private expanded = false;
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly store: ExecutionRunStore) {}

    /**
     * 挂载面板。
     *
     * @param host - 宿主元素
     */
    mount(host: HTMLElement): void {
        this.unsubscribe?.();
        this.root?.remove();
        this.root = null;
        this.list = null;
        this.panel = null;

        const root = host.createDiv({ cls: 'nw-exec-log-root' });
        const toggle = root.createEl('button', {
            cls: 'nw-exec-log-toggle',
            attr: { type: 'button', title: '打开执行日志：时间线、错误堆栈与调试信息' },
        });
        toggle.createSpan({ text: '🐞 执行日志' });
        this.badge = toggle.createSpan({ text: '0', cls: 'nw-exec-log-badge' });
        toggle.addEventListener('click', () => this.setExpanded(!this.expanded));

        const panel = root.createDiv({ cls: 'nw-exec-log-panel' });
        const head = panel.createDiv({ cls: 'nw-exec-log-head' });
        head.createSpan({ text: '执行日志', cls: 'nw-exec-log-title' });
        const filterSelect = head.createEl('select', { cls: 'nw-exec-log-filter' });
        for (const option of [
            { value: 'all', label: '全部' },
            { value: 'error', label: '仅错误' },
            { value: 'warning', label: '仅警告' },
            { value: 'debug', label: '仅调试' },
        ]) {
            filterSelect.createEl('option', { value: option.value, text: option.label });
        }
        filterSelect.addEventListener('change', () => {
            this.filter = filterSelect.value as LogFilter;
            this.render();
        });
        const copyBtn = head.createEl('button', { text: '复制', cls: 'nw-exec-mini-btn' });
        copyBtn.addEventListener('click', () => {
            const text = this.store.exportText();
            void navigator.clipboard?.writeText(text).catch(() => undefined);
        });
        const collapse = head.createEl('button', { text: '收起', cls: 'nw-exec-mini-btn' });
        collapse.addEventListener('click', () => this.setExpanded(false));

        this.list = panel.createDiv({ cls: 'nw-exec-log-list' });
        this.panel = panel;
        this.root = root;

        this.unsubscribe = this.store.subscribe((change) => {
            if (change === 'status') return;
            this.render();
            if (this.store.hasErrors() && !this.expanded) {
                this.badge?.addClass('nw-exec-badge-alert');
            }
        });
        this.setExpanded(this.expanded);
    }

    /**
     * 销毁面板。
     */
    destroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.root?.remove();
        this.root = null;
        this.panel = null;
        this.list = null;
        this.badge = null;
    }

    /**
     * 展开/收起。
     *
     * @param expanded - 是否展开
     */
    setExpanded(expanded: boolean): void {
        this.expanded = expanded;
        this.panel?.toggleClass('nw-exec-log-panel-open', expanded);
        this.badge?.removeClass('nw-exec-badge-alert');
        if (expanded) this.render();
    }

    /**
     * 是否展开。
     * @returns 布尔值
     */
    isExpanded(): boolean {
        return this.expanded;
    }

    private render(): void {
        if (!this.list) return;
        const logs = this.store.getLogs();
        const errorCount = logs.filter(entry => entry.level === 'error').length;
        if (this.badge) {
            this.badge.setText(String(errorCount));
            this.badge.toggleClass('nw-exec-badge-zero', errorCount === 0);
        }
        const list = this.list;
        list.empty();

        const filtered = logs.filter(entry => {
            if (this.filter === 'all') return true;
            if (this.filter === 'error') return entry.level === 'error';
            if (this.filter === 'warning') return entry.level === 'warning';
            return entry.level === 'debug';
        });
        if (filtered.length === 0) {
            list.createDiv({ text: '暂无匹配日志', cls: 'nw-exec-log-empty' });
            return;
        }
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        for (const entry of filtered.slice(-400)) {
            this.renderEntry(list, entry);
        }
        if (atBottom) list.scrollTop = list.scrollHeight;
    }

    private renderEntry(list: HTMLElement, entry: ExecutionLogEntry): void {
        const row = list.createDiv({ cls: `nw-exec-log-item nw-exec-log-${entry.level}` });
        const head = row.createDiv({ cls: 'nw-exec-log-item-head' });
        head.createSpan({ text: formatTime(entry.at), cls: 'nw-exec-time' });
        head.createSpan({ text: entry.level.toUpperCase(), cls: 'nw-exec-log-level' });
        head.createSpan({ text: entry.stepLabel || entry.stepKey || entry.scope, cls: 'nw-exec-step' });
        row.createDiv({ text: entry.message, cls: 'nw-exec-log-message' });
        if (entry.detail) {
            row.createEl('pre', { text: entry.detail, cls: 'nw-exec-log-detail' });
        }
        if (entry.stack) {
            const details = row.createEl('details', { cls: 'nw-exec-log-stack' });
            details.createEl('summary', { text: '堆栈' });
            details.createEl('pre', { text: entry.stack });
        }
    }
}
