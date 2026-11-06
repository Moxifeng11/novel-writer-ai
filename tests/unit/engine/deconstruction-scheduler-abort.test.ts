import { describe, it, expect } from 'vitest';
import { DeconstructionScheduler } from '../../../engine/deconstruction-scheduler';
import { WorkerManager } from '../../../services/worker-manager';

/**
 * 第 44 轮把 WorkerManager.rejectTask 的 `!cancelled` 守卫去掉后，
 * 取消中的 worker 任务会以 `Task cancelled` 拒绝；本文件锁定
 * 拆解调度器（真实调用方）的 abort 路径：await 中的任务必须结算，不得永久挂起。
 */

function createScheduler(): DeconstructionScheduler {
    return new DeconstructionScheduler(
        {} as any,
        {
            getBook: async () => ({ id: 'book-1', name: '测试书籍' }),
            setBreakdownStatus: async () => {},
        } as any,
        undefined,
        undefined,
        undefined,
        () => ({
            deconstructionEngine: {
                defaultQualityLevel: 'fast' as const,
                enableAutoUpgrade: true,
                enabledDimensions: ['style'] as any[],
                includeCommercial: false,
                includeReadability: false,
                vectorEnabled: false,
                vectorModel: 'bge-m3',
                vectorCacheSize: 5000,
                vectorBatchSize: 32,
                llmEnabled: false,
                llmModel: 'deepseek-r1:7b',
                maxConcurrency: 1,
                textSampleLimit: 10,
                dimensionConcurrency: 3,
            },
        })
    );
}

/** 用真实 WorkerManager 承担取消语义，只把 DeconstructionWorkerManager 的入口形状投影出来。 */
function createWorkerAdapter(manager: WorkerManager, onCancel?: () => void) {
    const wrap = (taskType: string) => (text: string, onProgress?: (p: number, msg?: string) => void) => {
        const task = manager.executeTask(taskType, { text }, onProgress);
        const cancel = task.cancel;
        task.cancel = () => {
            onCancel?.();
            cancel();
        };
        return task;
    };

    return {
        isWorkerAvailable: () => false,
        analyzeStyle: wrap('deconstruct:style'),
        analyzeStyleWithVector: wrap('deconstruct:style:vector'),
    };
}

function runStyleDimension(
    scheduler: DeconstructionScheduler,
    adapter: ReturnType<typeof createWorkerAdapter>,
    signal: AbortSignal
) {
    // 私有 seam：与 breakdownStyle 实际调用同一条控制流，避免启动完整任务（落盘/报告）引入假阳性。
    return (scheduler as any).runDimensionWithFallback({
        dimension: 'style',
        task: { bookId: 'book-1', bookName: '测试书籍', sourceText: '正文' },
        onProgress: () => {},
        signal,
        vectorAvailable: false,
        degradedDimensions: [],
        degradationReasons: [],
        runVector: () => adapter.analyzeStyleWithVector('正文'),
        runPlain: () => adapter.analyzeStyle('正文'),
        runVectorRetry: () => adapter.analyzeStyleWithVector('正文'),
        runFallback: async () => ({ summary: 'fallback' }),
    });
}

describe('DeconstructionScheduler — abort 路径（第 44 轮 WorkerManager 修复回归）', () => {
    it('在途任务被 cancel 后 runDimensionWithFallback 及时以 Task cancelled 结算，不挂起', async () => {
        const scheduler = createScheduler();
        const manager = new WorkerManager();
        let handlerStarted!: () => void;
        const started = new Promise<void>(resolve => {
            handlerStarted = resolve;
        });
        // 挂起不结算，模拟 Worker 计算中；只有 cancel 才能让它结束（第 44 轮修复语义）。
        manager.registerFallbackHandler('deconstruct:style', () => {
            handlerStarted();
            return new Promise(() => {});
        });
        const adapter = createWorkerAdapter(manager);
        (scheduler as any).workerManager = adapter;

        const controller = new AbortController();
        try {
            const pending = runStyleDimension(scheduler, adapter, controller.signal);
            await started;
            controller.abort();

            const outcome = await Promise.race([
                pending.then(
                    () => 'resolved',
                    (error: Error) => `rejected:${error.message}`
                ),
                new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 100)),
            ]);

            expect(outcome).toBe('rejected:Task cancelled');
        } finally {
            manager.destroy();
            scheduler.destroy();
        }
    });

    it('维度完成后才 abort 不回调 cancel，也不改变已结算结果', async () => {
        const scheduler = createScheduler();
        const manager = new WorkerManager();
        let cancelCount = 0;
        manager.registerFallbackHandler('deconstruct:style', async () => ({ summary: 'done' }));
        const adapter = createWorkerAdapter(manager, () => {
            cancelCount += 1;
        });
        (scheduler as any).workerManager = adapter;

        const controller = new AbortController();
        try {
            const result = await runStyleDimension(scheduler, adapter, controller.signal);
            expect(result).toEqual({ usedVector: false, result: { summary: 'done' } });

            controller.abort();
            expect(cancelCount).toBe(0);
        } finally {
            manager.destroy();
            scheduler.destroy();
        }
    });
});
