import { describe, expect, it } from 'vitest';
import { UnloadBarrier } from '../../../shared/unload-barrier';

/**
 * L2-1（2026-11-10 维度①二轮）：卸载屏障必须有界等待视图保存，且超时不能
 * 拖死宿主。这里锁住等待/超时/异常清理/原 Promise 透传四个契约。
 */
describe('UnloadBarrier', () => {
    it('drain 等待已登记任务完成', async () => {
        const barrier = new UnloadBarrier();
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        barrier.track(pending);

        const drain = barrier.drain(1000);
        expect(barrier.pendingCount).toBe(1);
        release();

        await expect(drain).resolves.toBe(true);
        expect(barrier.pendingCount).toBe(0);
    });

    it('超时返回 false，不无限等待', async () => {
        const barrier = new UnloadBarrier();
        barrier.track(new Promise<void>(() => { /* 永不结束 */ }));
        await expect(barrier.drain(10)).resolves.toBe(false);
    });

    it('登记失败任务不产生未处理拒绝，且会被清理', async () => {
        const barrier = new UnloadBarrier();
        const rejected = Promise.reject(new Error('save failed'));
        barrier.track(rejected);

        await expect(barrier.drain(1000)).resolves.toBe(true);
        expect(barrier.pendingCount).toBe(0);
        // track 返回原 Promise：调用方仍能拿到原始失败
        await expect(rejected).rejects.toThrow('save failed');
    });

    it('close 后仍允许登记（卸载流程内的保存）', async () => {
        const barrier = new UnloadBarrier();
        barrier.close();
        expect(barrier.isClosed).toBe(true);
        let release!: () => void;
        barrier.track(new Promise<void>((resolve) => { release = resolve; }));
        const drain = barrier.drain(1000);
        release();
        await expect(drain).resolves.toBe(true);
    });
});
