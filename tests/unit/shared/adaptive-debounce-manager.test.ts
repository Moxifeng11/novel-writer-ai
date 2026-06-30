import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AdaptiveDebounceManager } from '../../../shared/adaptive-debounce-manager';

describe('AdaptiveDebounceManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('基础防抖 (debounceFixed)', () => {
        it('延迟执行函数', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('test', fn, 300);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(299);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('多次调用只执行最后一次', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('test', fn, 300);
            manager.debounceFixed('test', fn, 300);
            manager.debounceFixed('test', fn, 300);

            vi.advanceTimersByTime(300);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('不同 key 互不影响', () => {
            const manager = new AdaptiveDebounceManager();
            const fn1 = vi.fn();
            const fn2 = vi.fn();

            manager.debounceFixed('a', fn1, 200);
            manager.debounceFixed('b', fn2, 400);

            vi.advanceTimersByTime(200);
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).not.toHaveBeenCalled();

            vi.advanceTimersByTime(200);
            expect(fn2).toHaveBeenCalledTimes(1);
        });

        it('支持异步函数', async () => {
            const manager = new AdaptiveDebounceManager();
            let resolved = false;
            const fn = vi.fn(async () => {
                resolved = true;
            });

            manager.debounceFixed('test', fn, 100);
            vi.advanceTimersByTime(100);

            await vi.runAllTimersAsync();
            expect(resolved).toBe(true);
        });
    });

    describe('自适应防抖 (debounce)', () => {
        it('首次调用使用中速延迟', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounce('test', fn);

            vi.advanceTimersByTime(299);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('快速连续调用切换到快速延迟（长延迟）', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            // 快速调用 5 次，使用 Date.now 模拟快速输入
            // 方法：在每次 debounce 前手动修改历史记录来模拟快速调用
            // 直接调用 debounce 5 次（间隔 0，因为 fake timer 下 Date.now 不变）
            for (let i = 0; i < 5; i++) {
                manager.debounce('test', fn);
            }

            // 由于 5 次连续调用（间隔 < 200ms），应该使用快速延迟 (500ms)
            // 499ms 时还没执行
            vi.advanceTimersByTime(499);
            expect(fn).not.toHaveBeenCalled();

            // 500ms 时执行
            vi.advanceTimersByTime(1);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('慢速调用切换到慢速延迟（短延迟）', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            // 第一次调用（中速延迟 300ms）
            manager.debounce('test', fn);
            vi.advanceTimersByTime(600); // 等待执行完成 + 超过 slowThreshold

            // 第二次调用，间隔 600ms (> slowThreshold 500ms)
            manager.debounce('test', fn);

            // 应该使用慢速延迟 (150ms)
            vi.advanceTimersByTime(149);
            expect(fn).toHaveBeenCalledTimes(1); // 第一次执行了

            vi.advanceTimersByTime(1);
            expect(fn).toHaveBeenCalledTimes(2); // 第二次执行了
        });
    });

    describe('取消 (cancel)', () => {
        it('cancel 取消指定 key', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('test', fn, 300);
            manager.cancel('test');

            vi.advanceTimersByTime(300);
            expect(fn).not.toHaveBeenCalled();
        });

        it('取消不存在的 key 不报错', () => {
            const manager = new AdaptiveDebounceManager();
            expect(() => manager.cancel('nonexistent')).not.toThrow();
        });
    });

    describe('立即执行 (flush)', () => {
        it('flush 立即执行待执行的函数', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('test', fn, 300);
            manager.flush('test');

            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('flush 后不再执行', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('test', fn, 300);
            manager.flush('test');

            vi.advanceTimersByTime(300);
            expect(fn).toHaveBeenCalledTimes(1); // 只执行一次（flush 时）
        });

        it('flush 不存在的 key 不报错', () => {
            const manager = new AdaptiveDebounceManager();
            expect(() => manager.flush('nonexistent')).not.toThrow();
        });
    });

    describe('全部取消/执行', () => {
        it('cancelAll 取消所有待执行', () => {
            const manager = new AdaptiveDebounceManager();
            const fn1 = vi.fn();
            const fn2 = vi.fn();

            manager.debounceFixed('a', fn1, 200);
            manager.debounceFixed('b', fn2, 400);
            manager.cancelAll();

            vi.advanceTimersByTime(400);
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).not.toHaveBeenCalled();
        });

        it('flushAll 立即执行所有', () => {
            const manager = new AdaptiveDebounceManager();
            const fn1 = vi.fn();
            const fn2 = vi.fn();

            manager.debounceFixed('a', fn1, 200);
            manager.debounceFixed('b', fn2, 400);
            manager.flushAll();

            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
        });
    });

    describe('状态查询', () => {
        it('getPendingCount 返回待执行数量', () => {
            const manager = new AdaptiveDebounceManager();
            expect(manager.getPendingCount()).toBe(0);

            manager.debounceFixed('a', vi.fn(), 100);
            expect(manager.getPendingCount()).toBe(1);

            manager.debounceFixed('b', vi.fn(), 200);
            expect(manager.getPendingCount()).toBe(2);

            vi.advanceTimersByTime(100);
            expect(manager.getPendingCount()).toBe(1);
        });

        it('hasPending 检查指定 key', () => {
            const manager = new AdaptiveDebounceManager();
            expect(manager.hasPending('test')).toBe(false);

            manager.debounceFixed('test', vi.fn(), 100);
            expect(manager.hasPending('test')).toBe(true);

            vi.advanceTimersByTime(100);
            expect(manager.hasPending('test')).toBe(false);
        });
    });

    describe('内存管理', () => {
        it('超过 maxKeys 时自动清理', () => {
            const manager = new AdaptiveDebounceManager({ maxKeys: 10 });
            const fn = vi.fn();

            // 创建 15 个不同的 key
            for (let i = 0; i < 15; i++) {
                manager.debounceFixed(`key-${i}`, fn, 1000);
            }

            // 待执行数量应该 <= maxKeys (会清理一半旧的)
            expect(manager.getPendingCount()).toBeLessThanOrEqual(10);
        });

        it('dispose 清理所有资源', () => {
            const manager = new AdaptiveDebounceManager();
            const fn = vi.fn();

            manager.debounceFixed('a', fn, 200);
            manager.debounceFixed('b', fn, 400);

            manager.dispose();

            vi.advanceTimersByTime(400);
            expect(fn).not.toHaveBeenCalled();
            expect(manager.getPendingCount()).toBe(0);
        });
    });

    describe('错误处理', () => {
        it('同步函数错误不影响其他 key', () => {
            const manager = new AdaptiveDebounceManager();
            const fn1 = vi.fn(() => { throw new Error('test error'); });
            const fn2 = vi.fn();

            manager.debounceFixed('a', fn1, 100);
            manager.debounceFixed('b', fn2, 200);

            vi.advanceTimersByTime(200);
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
        });

        it('异步函数错误不影响其他 key', async () => {
            const manager = new AdaptiveDebounceManager();
            const fn1 = vi.fn(async () => { throw new Error('test error'); });
            const fn2 = vi.fn();

            manager.debounceFixed('a', fn1, 100);
            manager.debounceFixed('b', fn2, 200);

            await vi.runAllTimersAsync();
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
        });
    });
});
