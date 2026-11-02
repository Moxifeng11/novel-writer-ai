/**
 * execution-run-store.ts — 单章执行过程的内存账本
 *
 * 时间线只保留人类可读的节点；日志保留更细的调试信息与堆栈。
 * 所有面板共享同一实例，切换步骤/重渲染不会丢历史。
 */
import type {
    DiagnosticInput,
    ExecutionEventInput,
    ExecutionLevel,
    StepFailure,
} from '../../shared/execution-events';

export interface ExecutionEvent extends ExecutionEventInput {
    id: number;
    at: number;
}

export interface ExecutionLogEntry extends DiagnosticInput {
    id: number;
    at: number;
}

export type ExecutionStoreChange = 'event' | 'log' | 'failure' | 'status' | 'reset';

const LEVEL_WEIGHT: Record<ExecutionLevel, number> = {
    debug: 0,
    info: 1,
    success: 2,
    warning: 3,
    error: 4,
};

const MAX_EVENTS = 300;
const MAX_LOGS = 800;

export class ExecutionRunStore {
    private events: ExecutionEvent[] = [];
    private logs: ExecutionLogEntry[] = [];
    private failures = new Map<string, StepFailure>();
    private nextId = 1;
    private listeners = new Set<(change: ExecutionStoreChange) => void>();
    private status: { message: string; current?: number; total?: number; aiCalls?: number } | null = null;
    private statusTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 订阅执行账本变化。
     *
     * @param listener - 监听器
     * @returns 取消订阅函数
     */
    subscribe(listener: (change: ExecutionStoreChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 读取时间线事件。
     * @returns 事件数组
     */
    getEvents(): readonly ExecutionEvent[] {
        return this.events;
    }

    /**
     * 读取日志条目。
     * @returns 日志数组
     */
    getLogs(): readonly ExecutionLogEntry[] {
        return this.logs;
    }

    /**
     * 读取执行状态。
     * @returns 状态或 null
     */
    getStatus(): Readonly<{ message: string; current?: number; total?: number; aiCalls?: number }> | null {
        return this.status;
    }

    /**
     * 取指定步骤失败。
     *
     * @param stepKey - 步骤键
     * @returns 失败或 undefined
     */
    getFailure(stepKey: string): StepFailure | undefined {
        return this.failures.get(stepKey);
    }

    /**
     * 读取全部失败。
     * @returns 失败数组
     */
    getFailures(): readonly StepFailure[] {
        return [...this.failures.values()];
    }

    /**
     * 是否存在错误。
     * @returns 布尔值
     */
    hasErrors(): boolean {
        return this.failures.size > 0;
    }

    /**
     * 追加时间线事件。
     *
     * @param input - 输入
     */
    addEvent(input: ExecutionEventInput): void {
        const recent = this.events[this.events.length - 1];
        // 同一条消息常同时由 showError/showNotice 与结构化失败上报，
        // 2 秒内相同文本只保留一条，并把级别升级为更严重的一侧。
        if (recent
            && recent.message === input.message
            && recent.stepKey === input.stepKey
            && Date.now() - recent.at < 2000) {
            if (LEVEL_WEIGHT[input.level] > LEVEL_WEIGHT[recent.level]) recent.level = input.level;
            return;
        }
        this.events.push({ ...input, id: this.nextId++, at: Date.now() });
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        this.notify('event');
    }

    /**
     * 追加日志。
     *
     * @param input - 输入
     */
    addLog(input: DiagnosticInput): void {
        this.logs.push({ ...input, id: this.nextId++, at: Date.now() });
        if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
        this.notify('log');
    }

    /**
     * 记录步骤失败。
     *
     * @param failure - 失败信息
     */
    recordFailure(failure: StepFailure): void {
        this.failures.set(failure.stepKey, failure);
        this.addEvent({
            type: 'step-error',
            level: 'error',
            message: failure.message,
            stepKey: failure.stepKey,
            stepLabel: failure.stepLabel,
            detail: failure.suggestion,
        });
        this.addLog({
            level: 'error',
            scope: 'step',
            message: failure.message,
            stepKey: failure.stepKey,
            stepLabel: failure.stepLabel,
            detail: [failure.detail, failure.suggestion].filter(Boolean).join('\n'),
            stack: failure.stack,
        });
        this.notify('failure');
    }

    /**
     * 清除指定失败。
     *
     * @param stepKey - 步骤键
     */
    clearFailure(stepKey: string): void {
        if (!this.failures.delete(stepKey)) return;
        this.notify('failure');
    }

    /**
     * 清除全部失败。
     */
    clearAllFailures(): void {
        if (this.failures.size === 0) return;
        this.failures.clear();
        this.notify('failure');
    }

    /**
     * 设置执行状态。
     *
     * @param message - 消息
     * @param current? - 参数
     * @param total? - 参数
     * @param aiCalls? - 参数
     */
    setStatus(message: string, current?: number, total?: number, aiCalls?: number): void {
        this.status = { message, current, total, aiCalls };
        this.scheduleStatusNotify();
    }

    /**
     * 清除状态。
     */
    clearStatus(): void {
        this.status = null;
        this.scheduleStatusNotify();
    }

    /**
     * 重置账本。
     */
    reset(): void {
        this.events = [];
        this.logs = [];
        this.failures.clear();
        this.status = null;
        this.nextId = 1;
        this.notify('reset');
    }

    /** 生成可直接粘贴到问题反馈里的纯文本日志。 */
    exportText(): string {
        const lines: string[] = [`执行日志（${new Date().toLocaleString()}）`];
        for (const event of this.events) {
            lines.push(`[${formatTime(event.at)}] ${event.level.toUpperCase()} ${event.stepLabel || event.stepKey || ''} ${event.message}`);
        }
        lines.push('', '--- 调试详情 ---');
        for (const entry of this.logs) {
            lines.push(`[${formatTime(entry.at)}] ${entry.level.toUpperCase()} ${entry.scope} ${entry.stepLabel || ''} ${entry.message}`);
            if (entry.detail) lines.push(indent(entry.detail));
            if (entry.stack) lines.push(indent(entry.stack));
        }
        return lines.join('\n');
    }

    private scheduleStatusNotify(): void {
        if (this.statusTimer) return;
        this.statusTimer = setTimeout(() => {
            this.statusTimer = null;
            this.notify('status');
        }, 120);
    }

    private notify(change: ExecutionStoreChange): void {
        for (const listener of this.listeners) {
            try {
                listener(change);
            } catch {
                // 单个面板渲染失败不能影响执行主流程
            }
        }
    }
}

export function formatTime(at: number): string {
    return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}

function indent(text: string): string {
    return text.split('\n').map(line => `    ${line}`).join('\n');
}
