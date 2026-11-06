import { describe, expect, it, vi, afterEach } from 'vitest';
import { WorkerManager } from '../../../services/worker-manager';

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
}

describe('WorkerManager — 主线程降级与任务生命周期', () => {
    afterEach(() => {
        vi.useRealTimers();
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
});
