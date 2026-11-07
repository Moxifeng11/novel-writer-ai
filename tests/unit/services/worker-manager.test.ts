import { describe, expect, it, vi, afterEach } from 'vitest';
import { WorkerManager } from '../../../services/worker-manager';
import { getDegradationNotifier } from '../../../shared/degradation-notifier';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

class FakeWorker {
    static instances: FakeWorker[] = [];
    listeners = new Map<string, Set<(event: any) => void>>();
    posted: unknown[] = [];
    terminated = false;

    constructor(readonly url: string) {
        FakeWorker.instances.push(this);
    }

    addEventListener(type: string, listener: (event: any) => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: (event: any) => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }

    emit(type: string, data?: unknown): void {
        const event = { data } as MessageEvent<unknown>;
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

function useWorkerEnvironment(): void {
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
}

/** 启动一个真实 Worker 任务并等到 worker:ready 握手完成（返回被分配的 Worker 实例）。 */
async function startWorkerTask(manager: WorkerManager): Promise<{ worker: FakeWorker; taskId: string }> {
    await tick();
    const worker = FakeWorker.instances.at(-1);
    if (!worker) throw new Error('未创建 Worker 实例');
    worker.emit('message', { type: 'worker:ready' });
    await tick();
    const start = worker.posted[0] as { type: string; taskId: string } | undefined;
    if (!start) throw new Error('未发送 task:start');
    return { worker, taskId: start.taskId };
}

describe('WorkerManager — 主线程降级与任务生命周期', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        FakeWorker.instances = [];
    });

    it('无 Worker 环境时经降级处理器成功完成并透传进度', async () => {
        const manager = new WorkerManager();
        const progress: Array<[number, string | undefined]> = [];
        manager.registerFallbackHandler('compute', async (input: number, onProgress) => {
            onProgress?.(0.5, '一半');
            return input * 2;
        });

        const task = manager.executeTask<number, number>('compute', 21, (value, message) => {
            progress.push([value, message]);
        });

        await expect(task).resolves.toBe(42);
        expect(progress).toEqual([[0.5, '一半']]);
        manager.destroy();
    });

    it('降级处理器抛错时任务以同一错误拒绝', async () => {
        const manager = new WorkerManager();
        const failure = new Error('引擎执行失败');
        manager.registerFallbackHandler('compute', async () => {
            throw failure;
        });

        await expect(manager.executeTask('compute', 1)).rejects.toBe(failure);
        manager.destroy();
    });

    it('未注册降级处理器时按任务类型拒绝', async () => {
        const manager = new WorkerManager();

        await expect(manager.executeTask('unknown-task', 1)).rejects.toThrow(
            'No fallback handler for task type: unknown-task'
        );
        manager.destroy();
    });

    it('cancelAll 拒绝全部在跑任务且不再执行处理器', async () => {
        const manager = new WorkerManager();
        const handler = vi.fn(async () => 'done');
        manager.registerFallbackHandler('compute', handler);

        const task = manager.executeTask('compute', 1);
        const expectation = expect(task).rejects.toThrow('Task cancelled');
        manager.cancelAll();
        await expectation;

        await tick();
        expect(handler).not.toHaveBeenCalled();
        manager.destroy();
    });

    it('destroy 后新任务直接拒绝，且重复销毁幂等', async () => {
        const manager = new WorkerManager();
        manager.destroy();
        manager.destroy();

        await expect(manager.executeTask('compute', 1)).rejects.toThrow(
            'WorkerManager has been destroyed'
        );
        expect(manager.isWorkerAvailable()).toBe(false);
    });

    it('Worker 初始化超时且禁用降级时以超时错误拒绝', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Worker', FakeWorker);

        const manager = new WorkerManager({ maxWorkers: 1, fallbackToMain: false });
        const task = manager.executeTask('compute', 1);
        const expectation = expect(task).rejects.toThrow('Worker 初始化超时');

        await vi.advanceTimersByTimeAsync(5000);
        await expectation;
        expect(FakeWorker.instances.some(worker => worker.terminated)).toBe(true);
        manager.destroy();
    });

    it('Worker 就绪后按 progress/complete 驱动任务，且空闲 Worker 复用', async () => {
        useWorkerEnvironment();
        const manager = new WorkerManager({ maxWorkers: 1 });
        const progress: Array<[number, string | undefined]> = [];
        const task = manager.executeTask<number, number>('compute', 3, (value, message) => {
            progress.push([value, message]);
        });

        const { worker, taskId } = await startWorkerTask(manager);
        expect((worker.posted[0] as { type: string }).type).toBe('task:start');

        worker.emit('message', {
            type: 'task:progress',
            taskId,
            payload: { progress: 0.4, message: '四成' },
        });
        worker.emit('message', { type: 'task:complete', taskId, payload: { result: 9 } });

        await expect(task).resolves.toBe(9);
        expect(progress).toEqual([[0.4, '四成']]);

        const instancesBefore = FakeWorker.instances.length;
        const second = manager.executeTask('compute', 4);
        await tick();
        expect(FakeWorker.instances.length).toBe(instancesBefore);
        const secondStart = worker.posted.at(-1) as { type: string; taskId: string };
        expect(secondStart.type).toBe('task:start');
        worker.emit('message', { type: 'task:complete', taskId: secondStart.taskId, payload: { result: 8 } });
        await expect(second).resolves.toBe(8);
        manager.destroy();
    });

    it('task:error 可恢复时降级主线程执行', async () => {
        useWorkerEnvironment();
        const manager = new WorkerManager({ maxWorkers: 1 });
        manager.registerFallbackHandler('compute', async (input: number) => input * 3);
        const task = manager.executeTask('compute', 2);

        const { worker, taskId } = await startWorkerTask(manager);
        worker.emit('message', { type: 'task:error', taskId, error: 'boom' });

        await expect(task).resolves.toBe(6);
        manager.destroy();
    });

    it('task:error 命中网络关键词时拒绝且释放 Worker', async () => {
        useWorkerEnvironment();
        const manager = new WorkerManager({ maxWorkers: 1 });
        const task = manager.executeTask('compute', 1);

        const { worker, taskId } = await startWorkerTask(manager);
        worker.emit('message', { type: 'task:error', taskId, error: 'api timeout' });

        await expect(task).rejects.toThrow('api timeout');
        const stats = manager.getStats();
        expect(stats.totalWorkers).toBe(1);
        expect(stats.idleWorkers).toBe(1);
        manager.destroy();
    });

    it('worker:error 回收 Worker，禁用降级时拒绝当前任务', async () => {
        useWorkerEnvironment();
        const manager = new WorkerManager({ maxWorkers: 1, fallbackToMain: false });
        const task = manager.executeTask('compute', 1);

        const { worker } = await startWorkerTask(manager);
        worker.emit('message', { type: 'worker:error', payload: '崩了' });

        await expect(task).rejects.toThrow('Worker terminated unexpectedly');
        expect(worker.terminated).toBe(true);
        expect(manager.getStats().totalWorkers).toBe(0);
        manager.destroy();
    });

    it('worker:warning 注入降级时写入降级通知', async () => {
        useWorkerEnvironment();
        const notify = vi.spyOn(getDegradationNotifier(), 'notify');
        const manager = new WorkerManager({ maxWorkers: 1 });
        const task = manager.executeTask('compute', 1);

        const { worker } = await startWorkerTask(manager);
        worker.emit('message', {
            type: 'worker:warning',
            payload: { code: 'INJECTION_FAILED', engine: 'style', missing: ['analyzer'], fallback: 'keyword_stats' },
        });

        expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'injection', from: 'full', to: 'keyword_stats' })
        );
        const cancelExpectation = expect(task).rejects.toThrow('Task cancelled');
        task.cancel();
        await cancelExpectation;
        manager.destroy();
    });
});
