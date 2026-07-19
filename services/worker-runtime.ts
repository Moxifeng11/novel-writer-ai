/**
 * worker-runtime.ts — Web Worker 运行时工具
 *
 * 提供 Worker 侧的任务注册、消息处理和运行时控制。
 * 支持两种使用方式：
 * 1. 独立 Worker 脚本中直接使用 registerTaskHandler + startWorkerRuntime
 * 2. 通过 createInlineWorkerCode 生成可内联的 Worker 代码字符串（Blob URL 方式）
 */

import type {
    WorkerMessage,
    WorkerMessageType,
    TaskStartPayload,
    TaskProgressPayload,
    TaskCompletePayload,
    WorkerErrorPayload,
} from './worker-protocol';

export interface TaskHandlerContext {
    onProgress: (progress: number, message?: string) => void;
    signal: AbortSignal;
}

export type TaskHandler = (input: any, context: TaskHandlerContext) => Promise<any>;

const taskHandlers: Map<string, TaskHandler> = new Map();
const abortControllers: Map<string, AbortController> = new Map();

function postMessageToMain(type: WorkerMessageType, taskId?: string, payload?: any, error?: string): void {
    const message: WorkerMessage = { type, taskId, payload, error };
    (self as any).postMessage(message);
}

function sendProgress(taskId: string, progress: number, message?: string): void {
    const payload: TaskProgressPayload = { progress, message };
    postMessageToMain('task:progress', taskId, payload);
}

function sendComplete(taskId: string, result: any): void {
    const payload: TaskCompletePayload = { result };
    postMessageToMain('task:complete', taskId, payload);
}

function sendTaskError(taskId: string, error: Error): void {
    postMessageToMain('task:error', taskId, undefined, error.message);
}

function sendWorkerError(error: Error): void {
    const payload: WorkerErrorPayload = {
        message: error.message,
        stack: error.stack,
    };
    postMessageToMain('worker:error', undefined, payload);
}

async function handleTaskStart(payload: TaskStartPayload): Promise<void> {
    const { taskId, taskType, input } = payload;

    const handler = taskHandlers.get(taskType);
    if (!handler) {
        sendTaskError(taskId, new Error(`Unknown task type: ${taskType}`));
        return;
    }

    const abortController = new AbortController();
    abortControllers.set(taskId, abortController);

    try {
        const result = await handler(input, {
            onProgress: (progress: number, message?: string) => {
                sendProgress(taskId, progress, message);
            },
            signal: abortController.signal,
        });
        sendComplete(taskId, result);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return;
        }
        sendTaskError(taskId, error instanceof Error ? error : new Error(String(error)));
    } finally {
        abortControllers.delete(taskId);
    }
}

function handleTaskCancel(taskId: string): void {
    const abortController = abortControllers.get(taskId);
    if (abortController) {
        abortController.abort();
        abortControllers.delete(taskId);
    }
}

function handleMessage(event: MessageEvent<WorkerMessage>): void {
    const { type, taskId, payload } = event.data;

    switch (type) {
        case 'task:start':
            handleTaskStart(payload as TaskStartPayload);
            break;
        case 'task:cancel':
            if (taskId) {
                handleTaskCancel(taskId);
            }
            break;
        default:
            break;
    }
}

export function registerTaskHandler(taskType: string, handler: TaskHandler): void {
    taskHandlers.set(taskType, handler);
}

export function startWorkerRuntime(): void {
    (self as any).onmessage = handleMessage;
    postMessageToMain('worker:ready');
}

export function getRegisteredTaskTypes(): string[] {
    return Array.from(taskHandlers.keys());
}

export function createInlineWorkerCode(customHandlers?: Record<string, string>): string {
    const handlersCode = customHandlers
        ? Object.entries(customHandlers)
              .map(([taskType, handlerCode]) => `registerTaskHandler('${taskType}', ${handlerCode});`)
              .join('\n')
        : '';

    return `
        const taskHandlers = new Map();
        const abortControllers = new Map();

        function postMessageToMain(type, taskId, payload, error) {
            self.postMessage({ type, taskId, payload, error });
        }

        function sendProgress(taskId, progress, message) {
            postMessageToMain('task:progress', taskId, { progress, message });
        }

        function sendComplete(taskId, result) {
            postMessageToMain('task:complete', taskId, { result });
        }

        function sendTaskError(taskId, error) {
            postMessageToMain('task:error', taskId, undefined, error.message);
        }

        function sendWorkerError(error) {
            postMessageToMain('worker:error', undefined, { message: error.message, stack: error.stack });
        }

        async function handleTaskStart(payload) {
            const { taskId, taskType, input } = payload;
            const handler = taskHandlers.get(taskType);
            if (!handler) {
                sendTaskError(taskId, new Error('Unknown task type: ' + taskType));
                return;
            }
            const abortController = new AbortController();
            abortControllers.set(taskId, abortController);
            try {
                const result = await handler(input, {
                    onProgress: (progress, message) => sendProgress(taskId, progress, message),
                    signal: abortController.signal,
                });
                sendComplete(taskId, result);
            } catch (error) {
                if (error && error.name === 'AbortError') return;
                sendTaskError(taskId, error instanceof Error ? error : new Error(String(error)));
            } finally {
                abortControllers.delete(taskId);
            }
        }

        function handleTaskCancel(taskId) {
            const abortController = abortControllers.get(taskId);
            if (abortController) {
                abortController.abort();
                abortControllers.delete(taskId);
            }
        }

        function handleMessage(event) {
            const { type, taskId, payload } = event.data;
            switch (type) {
                case 'task:start':
                    handleTaskStart(payload);
                    break;
                case 'task:cancel':
                    if (taskId) handleTaskCancel(taskId);
                    break;
            }
        }

        function registerTaskHandler(taskType, handler) {
            taskHandlers.set(taskType, handler);
        }

        function startWorkerRuntime() {
            self.onmessage = handleMessage;
            postMessageToMain('worker:ready');
        }

        ${handlersCode}
        startWorkerRuntime();
    `;
}

export function createInlineWorker(workerCode: string): Worker {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    return new Worker(url);
}

export function createWorkerFromHandlers(handlers: Record<string, TaskHandler>): Worker {
    const handlerStrings: Record<string, string> = {};
    for (const [taskType, handler] of Object.entries(handlers)) {
        handlerStrings[taskType] = handler.toString();
    }
    const code = createInlineWorkerCode(handlerStrings);
    return createInlineWorker(code);
}
