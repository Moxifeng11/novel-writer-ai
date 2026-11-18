/**
 * execution-panels.ts — 主区域流程时间线、步骤错误卡与固定日志窗口
 *
 * 三块 UI 共用 ExecutionRunStore，不读写执行逻辑，也不影响步骤完成判定。
 */
import type { StepFailure } from '@/shared/execution-events';
import { t } from '@/i18n';
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
        head.createSpan({ text: t('fullwriter.ep.timelineTitle'), cls: 'nw-exec-timeline-title' });
        const clearBtn = head.createEl('button', {
            text: t('fullwriter.iv.clearBtn'),
            cls: 'nw-exec-mini-btn',
            attr: { title: t('fullwriter.ep.clearAllTip') },
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
            list.createDiv({ text: t('fullwriter.ep.timelineEmpty'), cls: 'nw-exec-empty' });
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
                const retry = row.createEl('button', { text: t('fullwriter.fp.retry'), cls: 'nw-exec-mini-btn' });
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
        let entries: Array<{ label: string; influence: string; chars: number; estTokens: number; source?: string; truncated?: boolean; failed?: boolean; empty?: boolean }> = [];
        try {
            const parsed = event.debug?.ledgerEntries;
            if (typeof parsed === 'string') entries = JSON.parse(parsed);
        } catch {
            entries = [];
        }
        // DSH-20261114-03：failed/empty 的 0 字符行不再被过滤吞掉——
        // 「检索失败归零」与「本来没有」必须在时间线可见（audit §三-1）
        const visible = entries.filter((entry) => entry.chars > 0 || entry.failed || entry.empty);
        if (visible.length === 0) return;

        const details = row.createEl('details', { cls: 'nw-exec-ledger' });
        details.createEl('summary', {
            text: t('fullwriter.ep.injectTrace', { count: visible.length, chars: String(event.debug?.totalChars ?? 0), tokens: String(event.debug?.totalEstTokens ?? 0) }),
            cls: 'nw-exec-ledger-summary',
        });

        const table = details.createEl('table', { cls: 'nw-exec-ledger-table' });
        const head = table.createEl('thead');
        const headRow = head.createEl('tr');
        for (const label of [t('fullwriter.ep.colSegment'), t('fullwriter.ep.colScope'), t('fullwriter.ep.colChars'), t('fullwriter.ep.colTokens'), t('fullwriter.ep.colSource')]) {
            headRow.createEl('th', { text: label });
        }
        const body = table.createEl('tbody');
        for (const entry of visible) {
            const tr = body.createEl('tr');
            const degraded = Boolean(entry.truncated || entry.failed);
            if (degraded) tr.addClass('nw-exec-ledger-truncated');
            tr.createEl('td', { text: `${entry.label}${degraded ? ' ⚠' : ''}` });
            tr.createEl('td', { text: entry.influence });
            tr.createEl('td', {
                text: entry.chars > 0
                    ? String(entry.chars)
                    : entry.failed ? t('fullwriter.ep.zeroFailed') : t('fullwriter.ep.zeroDisabled'),
            });
            tr.createEl('td', { text: String(entry.estTokens) });
            tr.createEl('td', { text: entry.source || '' });
        }
    }

    private renderStatus(): void {
        if (!this.status) return;
        const status = this.store.getStatus();
        this.status.setText(status?.message || t('fullwriter.ep.waitingExec'));
        this.status.toggleClass('nw-exec-status-active', Boolean(status));
        const meta = status && status.total
            ? t('fullwriter.ep.progressSuffix', { current: status.current ?? 0, total: status.total, calls: status.aiCalls ? t('fullwriter.ep.progressCalls', { count: status.aiCalls }) : '' })
            : '';
        this.status.setAttr('title', `${status?.message || ''}${meta}`);
    }
}

/**
 * renderStepFailureCard 函数。
 * @param container - 容器元素
 * @param failure - 失败信息
 * @param handlers - 回调集合
  * @returns HTMLElement 实例
 */
export function renderStepFailureCard(
    container: HTMLElement,
    failure: StepFailure,
    handlers: ExecutionPanelHandlers,
): HTMLElement {
    const card = container.createDiv({ cls: 'nw-exec-failure' });
    const head = card.createDiv({ cls: 'nw-exec-failure-head' });
    head.createSpan({ text: t('fullwriter.ep.failureTitle', { step: failure.stepLabel }), cls: 'nw-exec-failure-title' });
    head.createSpan({ text: kindLabel(failure.kind), cls: 'nw-exec-failure-kind' });

    const nodeRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    nodeRow.createSpan({ text: t('fullwriter.ep.atNode'), cls: 'nw-exec-failure-label' });
    nodeRow.createSpan({ text: `${failure.stepLabel}（${failure.stepKey}）`, cls: 'nw-exec-failure-value' });

    const reasonRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    reasonRow.createSpan({ text: t('fullwriter.ep.reason'), cls: 'nw-exec-failure-label' });
    reasonRow.createSpan({ text: failure.message, cls: 'nw-exec-failure-value nw-exec-failure-reason' });

    if (failure.missing.length > 0) {
        const missingRow = card.createDiv({ cls: 'nw-exec-failure-row' });
        missingRow.createSpan({ text: t('fullwriter.ep.missingItems'), cls: 'nw-exec-failure-label' });
        missingRow.createSpan({ text: failure.missing.join('、'), cls: 'nw-exec-failure-value' });
    }

    const hintRow = card.createDiv({ cls: 'nw-exec-failure-row' });
    hintRow.createSpan({ text: t('fullwriter.ep.suggestion'), cls: 'nw-exec-failure-label' });
    hintRow.createSpan({ text: failure.suggestion, cls: 'nw-exec-failure-value nw-exec-failure-hint' });

    if (failure.detail) {
        const details = card.createEl('details', { cls: 'nw-exec-failure-detail' });
        details.createEl('summary', { text: t('fullwriter.ep.viewErrorDetail') });
        details.createEl('pre', { text: failure.detail });
    }

    const actions = card.createDiv({ cls: 'nw-exec-failure-actions' });
    if (failure.retryable) {
        const retry = actions.createEl('button', { text: t('fullwriter.ep.retryStep'), cls: 'nw-btn nw-btn-primary nw-btn-sm' });
        retry.addEventListener('click', () => handlers.onRetry(failure.stepKey));
    }
    const logBtn = actions.createEl('button', { text: t('fullwriter.ep.viewFullLog'), cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
    logBtn.addEventListener('click', () => handlers.onOpenLog());
    return card;
}

function kindLabel(kind: StepFailure['kind']): string {
    const labels: Record<StepFailure['kind'], string> = {
        validation: t('fullwriter.ep.kindValidation'),
        api: t('fullwriter.ep.kindApi'),
        parse: t('fullwriter.ep.kindParse'),
        save: t('fullwriter.ep.kindSave'),
        incomplete: t('fullwriter.ep.kindIncomplete'),
        truncated: t('fullwriter.ep.kindTruncated'),
        exception: t('fullwriter.ep.kindException'),
        cancelled: t('fullwriter.ep.kindCancelled'),
    };
    return labels[kind] || t('fullwriter.ep.kindDefault');
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
            attr: { type: 'button', title: t('fullwriter.ep.logToggleTip') },
        });
        toggle.createSpan({ text: t('fullwriter.ep.logBtn') });
        this.badge = toggle.createSpan({ text: '0', cls: 'nw-exec-log-badge' });
        toggle.addEventListener('click', () => this.setExpanded(!this.expanded));

        const panel = root.createDiv({ cls: 'nw-exec-log-panel' });
        const head = panel.createDiv({ cls: 'nw-exec-log-head' });
        head.createSpan({ text: t('fullwriter.ep.logTitle'), cls: 'nw-exec-log-title' });
        const filterSelect = head.createEl('select', { cls: 'nw-exec-log-filter' });
        for (const option of [
            { value: 'all', label: t('fullwriter.ep.logAll') },
            { value: 'error', label: t('fullwriter.ep.logErrors') },
            { value: 'warning', label: t('fullwriter.ep.logWarnings') },
            { value: 'debug', label: t('fullwriter.ep.logDebug') },
        ]) {
            filterSelect.createEl('option', { value: option.value, text: option.label });
        }
        filterSelect.addEventListener('change', () => {
            this.filter = filterSelect.value as LogFilter;
            this.render();
        });
        const copyBtn = head.createEl('button', { text: t('fullwriter.ep.copyBtn'), cls: 'nw-exec-mini-btn' });
        copyBtn.addEventListener('click', () => {
            const text = this.store.exportText();
            void navigator.clipboard?.writeText(text).catch(() => undefined);
        });
        const collapse = head.createEl('button', { text: t('fullwriter.ep.collapseBtn'), cls: 'nw-exec-mini-btn' });
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
            list.createDiv({ text: t('fullwriter.ep.noMatchingLog'), cls: 'nw-exec-log-empty' });
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
            details.createEl('summary', { text: t('fullwriter.ep.stackTrace') });
            details.createEl('pre', { text: entry.stack });
        }
    }
}
