/**
 * worker-protocol.ts — Web Worker 消息协议定义
 *
 * 定义主线程与 Worker 之间通信的消息格式、类型和任务定义。
 * 所有跨线程消息必须遵循此协议，确保类型安全和一致性。
 *
 * 消息流向：
 * - 主线程 → Worker: task:start, task:cancel
 * - Worker → 主线程: worker:ready, task:progress, task:complete, task:error, worker:error
 */

/**
 * Worker 消息类型。
 */
export type WorkerMessageType =
    | 'task:start'
    | 'task:progress'
    | 'task:complete'
    | 'task:error'
    | 'task:cancel'
    | 'worker:ready'
    | 'worker:error'
    | 'worker:warning';

/**
 * Worker 消息。
 */
export interface WorkerMessage {
    type: WorkerMessageType;
    taskId?: string;
    payload?: any;
    error?: string;
}

/**
 * 任务定义。
 */
export interface WorkerTaskDefinition {
    taskType: string;
    input: any;
}

/**
 * 进度负载。
 */
export interface TaskProgressPayload {
    progress: number;
    message?: string;
}

/**
 * 完成负载。
 */
export interface TaskCompletePayload {
    result: any;
}

/**
 * 开始负载。
 */
export interface TaskStartPayload extends WorkerTaskDefinition {
    taskId: string;
}

/**
 * 错误负载。
 */
export interface WorkerErrorPayload {
    message: string;
    stack?: string;
}

/**
 * 主线程降级处理器。
 */
export type FallbackHandler = (
    input: any,
    onProgress?: (progress: number, message?: string) => void
) => Promise<any>;

/**
 * Worker 管理器选项。
 */
export interface WorkerManagerOptions {
    workerUrl?: string;
    maxWorkers?: number;
    fallbackToMain?: boolean;
}

/**
 * 任务执行结果。
 */
export interface TaskExecutionResult<R> {
    result: R;
    cancel: () => void;
}

/**
 * Worker 池统计。
 */
export interface WorkerPoolStats {
    totalWorkers: number;
    activeWorkers: number;
    idleWorkers: number;
    queuedTasks: number;
}
