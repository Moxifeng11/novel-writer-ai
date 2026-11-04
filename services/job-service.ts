/**
 * job-service.ts — 长任务统一注册、进度、取消与重试
 *
 * 背景：批量生成、章节一键跑、结算、拆解、导出各自维护进度与取消，
 * 关掉视图后状态就丢，失败后也无法统一重试。这里只做“任务生命周期”，
 * 不替代各引擎自己的实现：调用方把已有 run(signal) 注册进来即可。
 *
 * 约束：
 * - 任务状态只在插件生命周期内保留（不写用户 vault）；
 * - 取消 = 触发 AbortSignal + 调用可选 onCancel，不强行杀异步栈；
 * - 重试创建新任务并保留旧记录，便于对照失败现场。
 */

/** 任务状态。 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 任务类型（用于任务中心分组与文案）。 */
export type JobKind =
    | 'chapter-run'
    | 'batch'
    | 'settlement'
    | 'deconstruction'
    | 'export'
    | 'custom';

/** 任务进度快照。 */
export interface JobProgress {
    current: number;
    total: number;
    label: string;
}

/** 任务对外记录（只读快照）。 */
export interface JobRecord {
    id: string;
    kind: JobKind;
    title: string;
    project: string;
    status: JobStatus;
    progress: JobProgress;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    cancelable: boolean;
    retryable: boolean;
    /** 任务成功时的返回值（仅内存，UI 不应依赖其结构） */
    result?: unknown;
}

/** 任务执行上下文。 */
export interface JobRunContext {
    signal: AbortSignal;
    /** 更新进度；只传需要变化的字段 */
    update(progress: Partial<JobProgress>): void;
}

/** 任务定义：调用方提供稳定的 run 闭包。 */
export interface JobDefinition {
    kind: JobKind;
    title: string;
    project?: string;
    /** 默认 true */
    cancelable?: boolean;
    /** 默认 true；false 时任务中心不显示重试 */
    retryable?: boolean;
    run(ctx: JobRunContext): Promise<unknown>;
    /** AbortSignal 之后的额外取消动作（如 orchestrator.cancel()） */
    onCancel?(): void;
}

/** 任务变更事件。 */
export interface JobChangeEvent {
    type: 'started' | 'progress' | 'finished' | 'cancelled' | 'removed';
    job: JobRecord;
}

/** JobService 选项。 */
export interface JobServiceOptions {
    /** 时间源（测试注入） */
    now?: () => number;
    /** 已结束任务最多保留多少条（默认 50） */
    maxHistory?: number;
}

interface StoredJob {
    record: JobRecord;
    definition: JobDefinition;
    controller: AbortController;
    cancelRequested: boolean;
}

function cloneRecord(record: JobRecord): JobRecord {
    return { ...record, progress: { ...record.progress } };
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message || error.name;
    return String(error);
}

/**
 * 任务服务：注册、取消、重试、订阅。
 */
export class JobService {
    private readonly now: () => number;
    private readonly maxHistory: number;
    private readonly jobs = new Map<string, StoredJob>();
    private readonly listeners = new Set<(event: JobChangeEvent) => void>();
    private readonly waiters = new Map<string, Array<(record: JobRecord) => void>>();
    private seq = 0;

    /**
     * @param options - 时间源与历史上限
     */
    constructor(options: JobServiceOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.maxHistory = Math.max(1, options.maxHistory ?? 50);
    }

    /**
     * 启动任务；立即返回 running 快照，执行在微任务中进行。
     *
     * @param definition - 任务定义
     * @returns 任务快照
     */
    start(definition: JobDefinition): JobRecord {
        this.seq += 1;
        const id = `job_${this.seq}`;
        const record: JobRecord = {
            id,
            kind: definition.kind,
            title: definition.title,
            project: definition.project ?? '',
            status: 'queued',
            progress: { current: 0, total: 0, label: '' },
            createdAt: this.now(),
            cancelable: definition.cancelable !== false,
            retryable: definition.retryable !== false,
        };
        const stored: StoredJob = {
            record,
            definition,
            controller: new AbortController(),
            cancelRequested: false,
        };
        this.jobs.set(id, stored);
        this.emit('started', record);
        const snapshot = cloneRecord(record);
        void this.run(stored);
        return snapshot;
    }

    /**
     * 取消任务：先置为 cancelled，再触发 abort 与 onCancel。
     *
     * @param id - 任务 id
     * @returns 是否找到且可取消
     */
    cancel(id: string): boolean {
        const stored = this.jobs.get(id);
        if (!stored) return false;
        if (stored.record.status !== 'queued' && stored.record.status !== 'running') return false;
        stored.cancelRequested = true;
        stored.record.status = 'cancelled';
        stored.record.finishedAt = this.now();
        stored.record.progress.label = '已取消';
        stored.controller.abort();
        try {
            stored.definition.onCancel?.();
        } catch {
            // onCancel 只做尽力清理，失败不影响取消结果
        }
        this.emit('cancelled', stored.record);
        this.settleWaiters(stored.record);
        this.trimHistory();
        return true;
    }

    /**
     * 重试失败/取消的任务，创建新记录并保留旧记录。
     *
     * @param id - 原任务 id
     * @returns 新任务快照；不可重试时返回 null
     */
    retry(id: string): JobRecord | null {
        const stored = this.jobs.get(id);
        if (!stored || stored.record.retryable === false) return null;
        if (stored.record.status !== 'failed' && stored.record.status !== 'cancelled') return null;
        return this.start(stored.definition);
    }

    /**
     * 等待任务结束（成功/失败/取消）。
     *
     * @param id - 任务 id
     * @returns 结束时的任务快照
     */
    waitFor(id: string): Promise<JobRecord> {
        const stored = this.jobs.get(id);
        if (!stored) return Promise.resolve({
            id,
            kind: 'custom',
            title: '',
            project: '',
            status: 'failed',
            progress: { current: 0, total: 0, label: '' },
            createdAt: this.now(),
            cancelable: false,
            retryable: false,
            error: '任务不存在',
        });
        if (stored.record.status !== 'running' && stored.record.status !== 'queued') {
            return Promise.resolve(cloneRecord(stored.record));
        }
        return new Promise(resolve => {
            const list = this.waiters.get(id) ?? [];
            list.push(resolve);
            this.waiters.set(id, list);
        });
    }

    /**
     * 取单个任务快照。
     *
     * @param id - 任务 id
     * @returns 任务快照或 undefined
     */
    get(id: string): JobRecord | undefined {
        const stored = this.jobs.get(id);
        return stored ? cloneRecord(stored.record) : undefined;
    }

    /**
     * 全部任务快照：运行中/排队在前，其余按创建时间倒序。
     *
     * @returns 任务快照数组
     */
    list(): JobRecord[] {
        const all = [...this.jobs.values()].map(item => cloneRecord(item.record));
        const active = all
            .filter(item => item.status === 'running' || item.status === 'queued')
            .sort((a, b) => a.createdAt - b.createdAt);
        const finished = all
            .filter(item => item.status !== 'running' && item.status !== 'queued')
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, this.maxHistory);
        return [...active, ...finished];
    }

    /**
     * 运行中的任务。
     *
     * @returns 任务快照数组
     */
    getActive(): JobRecord[] {
        return this.list().filter(item => item.status === 'running' || item.status === 'queued');
    }

    /**
     * 订阅任务变更。
     *
     * @param listener - 监听器
     * @returns 取消订阅函数
     */
    subscribe(listener: (event: JobChangeEvent) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** 停止全部运行中任务（插件卸载）。 */
    dispose(): void {
        for (const stored of this.jobs.values()) {
            if (stored.record.status === 'running' || stored.record.status === 'queued') {
                stored.cancelRequested = true;
                stored.controller.abort();
            }
        }
        for (const stored of this.jobs.values()) {
            if (stored.record.status === 'cancelled') this.settleWaiters(stored.record);
        }
        this.listeners.clear();
        this.waiters.clear();
    }

    private async run(stored: StoredJob): Promise<void> {
        const { record, definition, controller } = stored;
        if (stored.cancelRequested) return;
        record.status = 'running';
        record.startedAt = this.now();
        this.emit('started', record);
        try {
            const result = await definition.run({
                signal: controller.signal,
                update: (progress) => this.update(stored, progress),
            });
            if (stored.cancelRequested) return;
            record.result = result;
            record.status = 'succeeded';
            record.progress.label = '已完成';
            if (record.progress.total > 0) record.progress.current = record.progress.total;
            record.finishedAt = this.now();
            this.emit('finished', record);
            this.settleWaiters(record);
        } catch (error) {
            if (stored.cancelRequested || controller.signal.aborted
                || (error instanceof Error && error.name === 'AbortError')) {
                const carried = (error as { jobResult?: unknown } | null)?.jobResult;
                if (carried !== undefined) record.result = carried;
                if ((record.status as JobStatus) !== 'cancelled') {
                    record.status = 'cancelled';
                    record.progress.label = '已取消';
                    record.finishedAt = this.now();
                    this.emit('cancelled', record);
                }
                this.settleWaiters(record);
                return;
            }
            record.status = 'failed';
            record.error = errorMessage(error);
            record.progress.label = '失败';
            record.result = (error as { jobResult?: unknown } | null)?.jobResult;
            record.finishedAt = this.now();
            this.emit('finished', record);
            this.settleWaiters(record);
        } finally {
            this.trimHistory();
        }
    }

    private update(stored: StoredJob, patch: Partial<JobProgress>): void {
        if (stored.record.status !== 'running') return;
        const next = stored.record.progress;
        if (typeof patch.current === 'number' && Number.isFinite(patch.current)) next.current = Math.max(0, patch.current);
        if (typeof patch.total === 'number' && Number.isFinite(patch.total)) next.total = Math.max(0, patch.total);
        if (typeof patch.label === 'string') next.label = patch.label;
        this.emit('progress', stored.record);
    }

    private emit(type: JobChangeEvent['type'], record: JobRecord): void {
        const event: JobChangeEvent = { type, job: cloneRecord(record) };
        for (const listener of this.listeners) {
            try { listener(event); } catch { /* 监听器异常不影响任务 */ }
        }
    }

    private settleWaiters(record: JobRecord): void {
        const list = this.waiters.get(record.id);
        if (!list) return;
        this.waiters.delete(record.id);
        for (const resolve of list) resolve(cloneRecord(record));
    }

    private trimHistory(): void {
        const finished = [...this.jobs.values()]
            .filter(item => item.record.status !== 'running' && item.record.status !== 'queued')
            .sort((a, b) => b.record.createdAt - a.record.createdAt);
        for (const item of finished.slice(this.maxHistory)) {
            this.jobs.delete(item.record.id);
            this.emit('removed', item.record);
        }
    }
}
