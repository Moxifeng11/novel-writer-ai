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

export type WorkerMessageType =
    | 'task:start'
    | 'task:progress'
    | 'task:complete'
    | 'task:error'
    | 'task:cancel'
    | 'worker:ready'
    | 'worker:error'
    | 'worker:warning';

export interface WorkerMessage {
    type: WorkerMessageType;
    taskId?: string;
    payload?: any;
    error?: string;
}

export interface WorkerTaskDefinition {
    taskType: string;
    input: any;
}

export interface TaskProgressPayload {
    progress: number;
    message?: string;
}

export interface TaskCompletePayload {
    result: any;
}

export interface TaskStartPayload extends WorkerTaskDefinition {
    taskId: string;
}

export interface WorkerErrorPayload {
    message: string;
    stack?: string;
}

export type FallbackHandler = (
    input: any,
    onProgress?: (progress: number, message?: string) => void
) => Promise<any>;

export interface WorkerManagerOptions {
    workerUrl?: string;
    maxWorkers?: number;
    fallbackToMain?: boolean;
}

export interface TaskExecutionResult<R> {
    result: R;
    cancel: () => void;
}

export interface WorkerPoolStats {
    totalWorkers: number;
    activeWorkers: number;
    idleWorkers: number;
    queuedTasks: number;
}
