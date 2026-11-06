/**
 * worker-manager.ts — Web Worker 管理器（主线程侧）
 *
 * 管理 Worker 的生命周期、任务调度和错误处理，提供统一的异步任务执行接口。
 * 支持 Worker 池、任务队列、进度通知、取消任务和自动降级策略。
 *
 * 核心特性：
 * - Worker 池化复用，避免频繁创建销毁开销
 * - 任务队列 + 并发控制
 * - 任务进度事件通知
 * - 自动降级策略（Worker 不可用时回退到主线程执行）
 * - 任务取消支持（AbortController 语义）
 * - Blob URL 内联 Worker，无需额外构建配置
 *
 * 用法：
 *   const manager = new WorkerManager({ maxWorkers: 2 });
 *   const task = manager.executeTask('compute', data, (p) => log.info(p));
 *   task.cancel(); // 取消任务
 *   const result = await task; // 获取结果
 */

import { createLogger } from '@/shared/logger';
import { getDegradationNotifier } from '@/shared/degradation-notifier';
import { notifyWorkerUnavailable } from '@/shared/plugin-worker-url';
import type {
    WorkerMessage,
    WorkerManagerOptions,
    FallbackHandler,
    TaskProgressPayload,
    TaskCompletePayload,
    WorkerPoolStats,
    TaskStartPayload,
} from './worker-protocol';
import { createInlineWorker, createInlineWorkerCode } from './worker-runtime';

const log = createLogger('WorkerManager');

const DEFAULT_OPTIONS: Required<Pick<WorkerManagerOptions, 'maxWorkers' | 'fallbackToMain'>> = {
    maxWorkers: 2,
    fallbackToMain: true,
};

interface TaskState<P = unknown, R = unknown> {
    taskId: string;
    taskType: string;
    input: P;
    onProgress?: (progress: number, message?: string) => void;
    resolve: (value: R) => void;
    reject: (reason: unknown) => void;
    worker?: Worker;
    cancelled: boolean;
    abortController?: AbortController;
}

interface WorkerWrapper {
    worker: Worker;
    busy: boolean;
    currentTaskId?: string;
    ready: boolean;
    blobUrl?: string;
}

interface CancelablePromise<T> extends Promise<T> {
    cancel: () => void;
}

let taskIdCounter = 0;
const generateTaskId = (): string => `task-${Date.now()}-${++taskIdCounter}`;

/**
 * WorkerManager 类。
 */
export class WorkerManager {
    private options: Omit<Required<WorkerManagerOptions>, 'workerUrl'> & { workerUrl?: string };
    private workers: WorkerWrapper[] = [];
    private taskQueue: TaskState[] = [];
    private activeTasks: Map<string, TaskState> = new Map();
    private fallbackHandlers: Map<string, FallbackHandler> = new Map();
    private workerAvailable: boolean = true;
    private destroyed: boolean = false;

    constructor(options?: WorkerManagerOptions) {
        this.options = {
            maxWorkers: options?.maxWorkers ?? DEFAULT_OPTIONS.maxWorkers,
            fallbackToMain: options?.fallbackToMain ?? DEFAULT_OPTIONS.fallbackToMain,
            workerUrl: options?.workerUrl,
        };

        this.detectWorkerSupport();
    }

    private detectWorkerSupport(): void {
        try {
            if (typeof Worker === 'undefined') {
                this.workerAvailable = false;
                log.warn('当前环境不支持 Web Worker，将使用主线程降级模式');
                notifyWorkerUnavailable('当前环境不支持 Web Worker');
                return;
            }

            const testCode = createInlineWorkerCode();
            const testWorker = createInlineWorker(testCode);
            testWorker.terminate();
            this.workerAvailable = true;
        } catch (e) {
            this.workerAvailable = false;
            log.warn('Web Worker 初始化检测失败，将使用主线程降级模式:', e);
            notifyWorkerUnavailable(
                `Web Worker 初始化失败：${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    /**
     * Worker 是否可用（不可用时走主线程降级）。
     * @returns 布尔值
     */
    isWorkerAvailable(): boolean {
        return this.workerAvailable && !this.destroyed;
    }

    /**
     * 注册某任务类型的主线程降级处理器。
     *
     * @param taskType - 任务类型
     * @param handler - 降级处理函数
     */
    registerFallbackHandler(taskType: string, handler: FallbackHandler): void {
        this.fallbackHandlers.set(taskType, handler);
    }

    /**
     * executeTask 方法。
     * @param taskType - 参数值
     * @param input - 输入
     * @param onProgress - 参数值
      * @returns CancelablePromise<R> 实例
     */
    executeTask<P = unknown, R = unknown>(
        taskType: string,
        input: P,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<R> {
        if (this.destroyed) {
            const promise = Promise.reject(new Error('WorkerManager has been destroyed')) as CancelablePromise<R>;
            promise.cancel = () => {};
            return promise;
        }

        const taskId = generateTaskId();
        let taskState: TaskState<P, R>;

        const promise = new Promise<R>((resolve, reject) => {
            taskState = {
                taskId,
                taskType,
                input,
                onProgress,
                resolve: resolve as (value: R) => void,
                reject,
                cancelled: false,
            };

            this.activeTasks.set(taskId, taskState as TaskState);

            if (!this.workerAvailable && this.options.fallbackToMain) {
                this.executeFallback(taskState as TaskState);
                return;
            }

            this.taskQueue.push(taskState as TaskState);
            this.processQueue();
        }) as CancelablePromise<R>;

        promise.cancel = () => this.cancelTask(taskId);

        return promise;
    }

    private processQueue(): void {
        if (this.destroyed || this.taskQueue.length === 0) return;

        const idleWorker = this.workers.find((w) => w.ready && !w.busy);
        if (idleWorker) {
            const task = this.taskQueue.shift();
            if (task) {
                this.assignTaskToWorker(task, idleWorker);
            }
            return;
        }

        if (this.workers.length < this.options.maxWorkers) {
            this.createWorker()
                .then((workerWrapper) => {
                    if (this.destroyed) {
                        this.terminateWorker(workerWrapper);
                        return;
                    }
                    this.workers.push(workerWrapper);
                    this.processQueue();
                })
                .catch((error) => {
                    log.error('创建 Worker 失败:', error);
                    if (this.options.fallbackToMain) {
                        this.workerAvailable = false;
                        notifyWorkerUnavailable(
                            `Worker 脚本加载失败（${this.options.workerUrl || 'inline'}）：${error instanceof Error ? error.message : String(error)}`
                        );
                        this.drainQueueWithFallback();
                    } else {
                        const task = this.taskQueue.shift();
                        if (task) {
                            this.rejectTask(task, error);
                        }
                    }
                });
        }
    }

    private createWorker(): Promise<WorkerWrapper> {
        return new Promise((resolve, reject) => {
            try {
                let worker: Worker;
                let blobUrl: string | undefined;

                if (this.options.workerUrl) {
                    worker = new Worker(this.options.workerUrl);
                } else {
                    const code = createInlineWorkerCode();
                    const blob = new Blob([code], { type: 'application/javascript' });
                    blobUrl = URL.createObjectURL(blob);
                    worker = new Worker(blobUrl);
                }

                const wrapper: WorkerWrapper = {
                    worker,
                    busy: false,
                    ready: false,
                    blobUrl,
                };

                const handleMessage = (event: MessageEvent<WorkerMessage>) => {
                    if (event.data.type === 'worker:ready') {
                        wrapper.ready = true;
                        worker.removeEventListener('message', handleMessage);
                        worker.addEventListener('message', (ev) => this.handleWorkerMessage(wrapper, ev));
                        worker.addEventListener('error', (ev) => this.handleWorkerError(wrapper, ev));
                        resolve(wrapper);
                    }
                };

                worker.addEventListener('message', handleMessage);

                setTimeout(() => {
                    if (!wrapper.ready) {
                        this.terminateWorker(wrapper);
                        reject(new Error('Worker 初始化超时'));
                    }
                }, 5000);
            } catch (error) {
                reject(error);
            }
        });
    }

    private assignTaskToWorker(task: TaskState, workerWrapper: WorkerWrapper): void {
        if (task.cancelled) {
            this.activeTasks.delete(task.taskId);
            this.processQueue();
            return;
        }

        workerWrapper.busy = true;
        workerWrapper.currentTaskId = task.taskId;
        task.worker = workerWrapper.worker;

        const payload: TaskStartPayload = {
            taskId: task.taskId,
            taskType: task.taskType,
            input: task.input,
        };

        try {
            workerWrapper.worker.postMessage({
                type: 'task:start',
                taskId: task.taskId,
                payload,
            });
        } catch (error) {
            log.error(`发送任务失败 (${task.taskType}):`, error);
            workerWrapper.busy = false;
            workerWrapper.currentTaskId = undefined;

            if (this.options.fallbackToMain) {
                this.executeFallback(task);
            } else {
                this.rejectTask(task, error);
            }
            this.processQueue();
        }
    }

    private handleWorkerMessage(workerWrapper: WorkerWrapper, event: MessageEvent<WorkerMessage>): void {
        const { type, taskId, payload, error } = event.data;

        switch (type) {
            case 'task:progress': {
                const progressPayload = payload as TaskProgressPayload;
                const task = this.activeTasks.get(taskId || '');
                if (task && task.onProgress) {
                    task.onProgress(progressPayload.progress, progressPayload.message);
                }
                break;
            }
            case 'task:complete': {
                const completePayload = payload as TaskCompletePayload;
                const task = this.activeTasks.get(taskId || '');
                if (task) {
                    this.resolveTask(task, completePayload.result);
                }
                this.releaseWorker(workerWrapper);
                break;
            }
            case 'task:error': {
                const task = this.activeTasks.get(taskId || '');
                if (task) {
                    if (this.options.fallbackToMain && this.isRecoverableError(error)) {
                        log.warn(`Worker 任务失败，尝试降级执行 (${task.taskType}):`, error);
                        this.executeFallback(task);
                    } else {
                        this.rejectTask(task, new Error(error || 'Unknown task error'));
                    }
                }
                this.releaseWorker(workerWrapper);
                break;
            }
            case 'worker:error': {
                log.error('Worker 运行时错误:', payload);
                this.recycleWorker(workerWrapper);
                break;
            }
            case 'worker:warning': {
                const warnPayload = payload as { code?: string; engine?: string; missing?: string[]; fallback?: string };
                if (warnPayload?.code === 'INJECTION_FAILED' || warnPayload?.code === 'INJECTION_PARTIAL') {
                    log.warn(
                        `Worker 报告引擎部分降级 [${warnPayload.engine}]: 分析器 ${warnPayload.missing?.join(', ')} 未注入，相关维度使用关键字统计`
                    );
                    getDegradationNotifier().notify({
                        source: 'injection',
                        from: 'full',
                        to: warnPayload.fallback || 'keyword_stats',
                        reason: `${warnPayload.engine} 分析器未注入: ${warnPayload.missing?.join(', ')}`,
                        severity: 'warning',
                        recoverable: false,
                    });
                } else {
                    log.warn('Worker 报告警告:', warnPayload);
                }
                break;
            }
            default:
                break;
        }
    }

    private handleWorkerError(workerWrapper: WorkerWrapper, event: ErrorEvent): void {
        log.error('Worker 错误事件:', event.message, event.filename, event.lineno);
        this.recycleWorker(workerWrapper);
    }

    private isRecoverableError(errorMessage?: string): boolean {
        if (!errorMessage) return true;
        const networkErrors = ['network', 'fetch', 'api', 'http', 'timeout', 'abort'];
        return !networkErrors.some((keyword) => errorMessage.toLowerCase().includes(keyword));
    }

    private resolveTask(task: TaskState, result: unknown): void {
        if (!task.cancelled) {
            task.resolve(result);
        }
        this.activeTasks.delete(task.taskId);
    }

    private rejectTask(task: TaskState, error: unknown): void {
        task.reject(error);
        this.activeTasks.delete(task.taskId);
    }

    private releaseWorker(workerWrapper: WorkerWrapper): void {
        workerWrapper.busy = false;
        workerWrapper.currentTaskId = undefined;
        this.processQueue();
    }

    private recycleWorker(workerWrapper: WorkerWrapper): void {
        const index = this.workers.indexOf(workerWrapper);
        if (index > -1) {
            this.workers.splice(index, 1);
        }

        const currentTaskId = workerWrapper.currentTaskId;
        this.terminateWorker(workerWrapper);

        if (currentTaskId) {
            const task = this.activeTasks.get(currentTaskId);
            if (task) {
                if (this.options.fallbackToMain) {
                    log.warn(`Worker 异常回收，降级执行任务 (${task.taskType})`);
                    this.executeFallback(task);
                } else {
                    this.rejectTask(task, new Error('Worker terminated unexpectedly'));
                }
            }
        }

        this.processQueue();
    }

    private terminateWorker(workerWrapper: WorkerWrapper): void {
        try {
            workerWrapper.worker.terminate();
        } catch (e) {
            log.warn('终止 Worker 失败:', e);
        }
        if (workerWrapper.blobUrl) {
            try {
                URL.revokeObjectURL(workerWrapper.blobUrl);
            } catch (e) {
                log.warn('释放 Blob URL 失败:', e);
            }
        }
    }

    private executeFallback(task: TaskState): void {
        const handler = this.fallbackHandlers.get(task.taskType);
        if (!handler) {
            this.rejectTask(task, new Error(`No fallback handler for task type: ${task.taskType}`));
            return;
        }

        const abortController = new AbortController();
        task.abortController = abortController;

        setTimeout(async () => {
            if (task.cancelled) return;

            try {
                const result = await handler(task.input, task.onProgress);
                if (!task.cancelled) {
                    this.resolveTask(task, result);
                }
            } catch (error) {
                if (!task.cancelled) {
                    this.rejectTask(task, error);
                }
            }
        }, 0);
    }

    private drainQueueWithFallback(): void {
        while (this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
            if (task) {
                this.executeFallback(task);
            }
        }
    }

    private cancelTask(taskId: string): void {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        task.cancelled = true;

        const queuedIndex = this.taskQueue.findIndex((t) => t.taskId === taskId);
        if (queuedIndex > -1) {
            this.taskQueue.splice(queuedIndex, 1);
            this.rejectTask(task, new Error('Task cancelled'));
            return;
        }

        if (task.abortController) {
            task.abortController.abort();
            this.rejectTask(task, new Error('Task cancelled'));
            return;
        }

        const workerWrapper = this.workers.find((w) => w.currentTaskId === taskId);
        if (workerWrapper) {
            try {
                workerWrapper.worker.postMessage({
                    type: 'task:cancel',
                    taskId,
                });
            } catch (e) {
                log.warn('发送取消消息失败:', e);
            }
            this.rejectTask(task, new Error('Task cancelled'));
        }
    }

    /**
     * 取消全部在跑任务并清理队列。
     */
    cancelAll(): void {
        const taskIds = Array.from(this.activeTasks.keys());
        for (const taskId of taskIds) {
            this.cancelTask(taskId);
        }
    }

    /**
     * 读取 Worker 池统计。
     * @returns 池统计
     */
    getStats(): WorkerPoolStats {
        const activeWorkers = this.workers.filter((w) => w.busy).length;
        const idleWorkers = this.workers.filter((w) => w.ready && !w.busy).length;
        return {
            totalWorkers: this.workers.length,
            activeWorkers,
            idleWorkers,
            queuedTasks: this.taskQueue.length,
        };
    }

    /**
     * 销毁 Worker 池（插件卸载时调用）。
     */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.cancelAll();
        this.taskQueue = [];

        for (const workerWrapper of this.workers) {
            this.terminateWorker(workerWrapper);
        }
        this.workers = [];

        log.info('WorkerManager 已销毁');
    }
}
