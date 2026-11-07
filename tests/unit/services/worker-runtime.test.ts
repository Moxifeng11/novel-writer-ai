/**
 * worker-runtime — Worker 侧协议边界测试
 *
 * 覆盖 registerTaskHandler + startWorkerRuntime 的消息流：
 * 未注册类型、进度/完成上报、异常归一、AbortError 静默、取消传播；
 * 以及 createInlineWorkerCode / createWorkerFromHandlers 的源码内联。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createInlineWorkerCode,
    createWorkerFromHandlers,
    getRegisteredTaskTypes,
    registerTaskHandler,
    startWorkerRuntime,
} from '../../../services/worker-runtime';
import type { WorkerMessage } from '../../../services/worker-protocol';

interface FakeScope {
    postMessage: (message: WorkerMessage) => void;
    onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
}

function installScope(): { scope: FakeScope; posted: WorkerMessage[] } {
    const posted: WorkerMessage[] = [];
    const scope: FakeScope = {
        postMessage: message => posted.push(message),
        onmessage: null,
    };
    vi.stubGlobal('self', scope);
    return { scope, posted };
}

function dispatch(scope: FakeScope, data: WorkerMessage): void {
    scope.onmessage?.({ data } as MessageEvent<WorkerMessage>);
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('worker-runtime — task 消息协议', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('startWorkerRuntime 安装 onmessage 并上报 worker:ready', () => {
        const { scope, posted } = installScope();

        startWorkerRuntime();

        expect(posted).toHaveLength(1);
        expect(posted[0].type).toBe('worker:ready');
        expect(typeof scope.onmessage).toBe('function');
    });

    it('未注册任务类型回传 task:error 且不产生完成消息', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'missing-1', taskType: 'demo:missing', input: null },
        });
        await flush();

        expect(posted).toHaveLength(2);
        expect(posted[1]).toMatchObject({
            type: 'task:error',
            taskId: 'missing-1',
            error: 'Unknown task type: demo:missing',
        });
    });

    it('成功任务依次回传进度与完成结果，并向处理器暴露 signal', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();
        let received: unknown;
        let signal: AbortSignal | undefined;
        registerTaskHandler('demo:success', async (input, context) => {
            received = input;
            signal = context.signal;
            context.onProgress(0.4, '半程');
            return 'ok';
        });

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'ok-1', taskType: 'demo:success', input: { value: 2 } },
        });
        await flush();

        expect(received).toEqual({ value: 2 });
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(posted.map(message => message.type)).toEqual(['worker:ready', 'task:progress', 'task:complete']);
        expect(posted[1]).toMatchObject({ taskId: 'ok-1', payload: { progress: 0.4, message: '半程' } });
        expect(posted[2]).toMatchObject({ taskId: 'ok-1', payload: { result: 'ok' } });
    });

    it('处理器以非 Error 拒绝时归一为 String 文本', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();
        registerTaskHandler('demo:string-error', () => Promise.reject('boom'));

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'str-1', taskType: 'demo:string-error', input: null },
        });
        await flush();

        expect(posted[1]).toMatchObject({ type: 'task:error', taskId: 'str-1', error: 'boom' });
    });

    it('AbortError 保持静默，不回传 task:error', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();
        registerTaskHandler('demo:abort-error', () => {
            throw new DOMException('已取消', 'AbortError');
        });

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'abort-1', taskType: 'demo:abort-error', input: null },
        });
        await flush();

        expect(posted.map(message => message.type)).toEqual(['worker:ready']);
    });

    it('task:cancel 中止在跑任务 signal 且不额外回传消息', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();
        let signal: AbortSignal | undefined;
        registerTaskHandler('demo:cancel', (_input, context) => {
            signal = context.signal;
            return new Promise<never>((_resolve, reject) => {
                context.signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')));
            });
        });

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'cancel-1', taskType: 'demo:cancel', input: null },
        });
        await flush();
        expect(signal?.aborted).toBe(false);

        dispatch(scope, { type: 'task:cancel', taskId: 'cancel-1' });
        await flush();

        expect(signal?.aborted).toBe(true);
        expect(posted.map(message => message.type)).toEqual(['worker:ready']);
    });

    it('重复注册同一类型时后注册处理器生效，并出现在注册清单', async () => {
        const { scope, posted } = installScope();
        startWorkerRuntime();
        registerTaskHandler('demo:dup', async () => 'first');
        registerTaskHandler('demo:dup', async () => 'second');

        dispatch(scope, {
            type: 'task:start',
            payload: { taskId: 'dup-1', taskType: 'demo:dup', input: null },
        });
        await flush();

        expect(getRegisteredTaskTypes()).toContain('demo:dup');
        expect(posted[1]).toMatchObject({ type: 'task:complete', payload: { result: 'second' } });
    });

    it('createInlineWorkerCode 内联自定义处理器并以启动调用收尾', () => {
        const bare = createInlineWorkerCode();
        expect(bare).not.toContain("registerTaskHandler('");
        expect(bare).toContain('startWorkerRuntime();');

        const custom = createInlineWorkerCode({ 'demo:echo': 'async input => input' });
        expect(custom).toContain("registerTaskHandler('demo:echo', async input => input);");
    });

    it('createWorkerFromHandlers 用处理器源码生成 blob Worker', async () => {
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
            blobs.push(obj as Blob);
            return 'blob:worker-runtime';
        });
        class FakeWorker {
            constructor(readonly url: string) {}
        }
        vi.stubGlobal('Worker', FakeWorker);

        const worker = createWorkerFromHandlers({ 'demo:inline': async (input: never) => input });

        expect(worker).toBeInstanceOf(FakeWorker);
        expect((worker as unknown as FakeWorker).url).toBe('blob:worker-runtime');
        expect(blobs).toHaveLength(1);
        await expect(blobs[0].text()).resolves.toContain("registerTaskHandler('demo:inline'");
    });
});
