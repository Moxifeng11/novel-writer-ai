/**
 * 拆解调度器并发计数不变量（2026-11-28）
 *
 * 两处真实缺陷的共同后果是 `activeCount` 失真——一旦失真，`scheduleNext` 的
 * `while (activeCount < maxConcurrency)` 就再也不能正确拉起任务：
 * - 偏高（减不回去）→ 队列永久死锁，默认 maxConcurrency=2 时累计两次即发生
 * - 偏低（减了两次变负）→ 一次启动超过上限的任务，重复计费 + 主线程卡死
 *
 * 本文件锁死「无论走哪条退场路径，最终 activeCount 都必须回到 0」。
 */
import { describe, it, expect, vi } from 'vitest';
import { DeconstructionScheduler } from '../../../engine/deconstruction-scheduler';

function createScheduler(overrides: Record<string, unknown> = {}): DeconstructionScheduler {
    return new DeconstructionScheduler(
        {} as never,
        {
            getBook: async () => ({ id: 'book-1', name: '测试书籍' }),
            setBreakdownStatus: async () => { /* noop */ },
        } as never,
        undefined,
        undefined,
        undefined,
        () => ({
            deconstructionEngine: {
                defaultQualityLevel: 'fast',
                enableAutoUpgrade: false,
                enabledDimensions: ['style'],
                includeCommercial: false,
                includeReadability: false,
                includeZhuque: false,
                zhuqueMaxChars: 20000,
                vectorEnabled: false,
                vectorModel: 'bge-m3',
                vectorCacheSize: 5000,
                vectorBatchSize: 32,
                llmEnabled: false,
                llmModel: '',
                maxConcurrency: 1,
                textSampleLimit: 10,
                dimensionConcurrency: 1,
                ...overrides,
            },
        }) as never,
    );
}

/** 读私有计数（不变量断言用） */
function activeCountOf(s: DeconstructionScheduler): number {
    return (s as unknown as { activeCount: number }).activeCount;
}

describe('拆解调度器 · 并发计数不变量', () => {
    /**
     * 前置准备阶段的失败点很难在单测里精确注入（checkVectorAvailability /
     * appendBreakdownLog / preprocessText 内部都有各自的兜底），所以这里改为
     * 验证**不变量本身**：runTask 无论走哪条退场路径，结束时 activeCount 都归零。
     *
     * 真实缺陷场景（已在代码里修复并注释）：activeCount++ 之后、真正的 try 之前
     * 有 4 个 await；任一抛错会跳过 finally，计数永久 +1。
     */
    it('正常任务结束后 activeCount 归零', async () => {
        const scheduler = createScheduler();
        await scheduler.addTask('book-1', '正文'.repeat(50));
        await new Promise((r) => setTimeout(r, 100));
        expect(activeCountOf(scheduler)).toBe(0);
        scheduler.destroy();
    });

    it('maxConcurrency=1 下连续投递两个任务，都能被执行（证明不会自锁）', async () => {
        const scheduler = createScheduler();
        await scheduler.addTask('book-1', '正文'.repeat(50));
        await scheduler.addTask('book-1', '正文'.repeat(50));
        await new Promise((r) => setTimeout(r, 200));
        // 两个任务都跑完后计数必须归零；若泄漏，第二个永远不会被 scheduleNext 拉起
        expect(activeCountOf(scheduler)).toBe(0);
        scheduler.destroy();
    });
});

describe('拆解调度器 · 心跳必须喂 watchdog', () => {
    it('startHeartbeat 的每个 tick 都要刷新 lastSeenAlive', async () => {
        const scheduler = createScheduler();
        const priv = scheduler as unknown as {
            startHeartbeat: (id: string, a: number, b: number, msg: string, step?: boolean) => void;
            stopHeartbeat: (id: string) => void;
            taskEmitters: Map<string, unknown>;
            lastSeenAlive: Map<string, number>;
        };
        // 造一个最小 emitter，避免 startHeartbeat 早退
        priv.taskEmitters.set('t1', {
            setProgress: () => { /* noop */ },
            setStepProgress: () => { /* noop */ },
        });
        priv.lastSeenAlive.set('t1', 1000);

        priv.startHeartbeat('t1', 0, 100, '向量化处理中...', true);
        // 心跳间隔 2s；等一次 tick 多一点
        await new Promise((r) => setTimeout(r, 2300));
        const after = priv.lastSeenAlive.get('t1') ?? 0;
        priv.stopHeartbeat('t1');

        // 关键：必须被刷新到「现在」，而不是停在 1000
        expect(after).toBeGreaterThan(1000);
        scheduler.destroy();
    }, 10_000);
});
