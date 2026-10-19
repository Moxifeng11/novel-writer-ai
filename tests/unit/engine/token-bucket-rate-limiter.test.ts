import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../../../engine/token-bucket-rate-limiter';

describe('TokenBucketRateLimiter', () => {
    describe('基础操作', () => {
        it('初始令牌数正确', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            expect(limiter.availableTokens).toBeCloseTo(100, 0);
        });

        it('初始令牌数可自定义', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
                initialTokens: 50,
            });
            expect(limiter.availableTokens).toBeCloseTo(50, 0);
        });

        it('tryAcquire 有令牌时返回 true', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            expect(limiter.tryAcquire(10)).toBe(true);
            expect(limiter.availableTokens).toBeCloseTo(90, 0);
        });

        it('tryAcquire 令牌不足时返回 false', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
                initialTokens: 5,
            });
            expect(limiter.tryAcquire(10)).toBe(false);
            expect(limiter.availableTokens).toBeCloseTo(5, 0);
        });

        it('acquire 有令牌时立即 resolve', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            await limiter.acquire(10);
            expect(limiter.availableTokens).toBeCloseTo(90, 0);
        });

        it('release 归还令牌', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
                initialTokens: 50,
            });
            limiter.release(10);
            expect(limiter.availableTokens).toBeCloseTo(60, 0);
        });

        it('release 不超过最大容量', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            limiter.release(50);
            expect(limiter.availableTokens).toBe(100);
        });
    });

    describe('令牌补充（真实时间）', () => {
        it('随时间补充令牌', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 100,
                maxTokens: 100,
                initialTokens: 0,
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(limiter.availableTokens).toBeGreaterThan(0);
            expect(limiter.availableTokens).toBeLessThan(100);
        });

        it('令牌补充不超过上限', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 100,
                maxTokens: 50,
                initialTokens: 45,
            });
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(limiter.availableTokens).toBe(50);
        });

        it('等待后 acquire 成功', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 100,
                maxTokens: 100,
                initialTokens: 5,
            });

            let acquired = false;
            const promise = limiter.acquire(10).then(() => {
                acquired = true;
            });

            expect(acquired).toBe(false);
            await promise;
            expect(acquired).toBe(true);
            expect(limiter.availableTokens).toBeLessThanOrEqual(95);
        });
    });

    describe('优先级队列（真实时间）', () => {
        it('高优先级先获取令牌', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 50,
                maxTokens: 10,
                initialTokens: 0,
            });

            const order: string[] = [];

            const lowPriority = limiter.acquire(5, { priority: 1 }).then(() => {
                order.push('low');
            });

            const highPriority = limiter.acquire(5, { priority: 10 }).then(() => {
                order.push('high');
            });

            expect(limiter.queueLength).toBe(2);

            await Promise.all([lowPriority, highPriority]);

            expect(order[0]).toBe('high');
            expect(order).toEqual(['high', 'low']);
        });

        it('同优先级按入队顺序', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 50,
                maxTokens: 10,
                initialTokens: 0,
            });

            const order: string[] = [];

            const first = limiter.acquire(5, { priority: 5 }).then(() => {
                order.push('first');
            });

            const second = limiter.acquire(5, { priority: 5 }).then(() => {
                order.push('second');
            });

            await Promise.all([first, second]);

            expect(order).toEqual(['first', 'second']);
        });
    });

    describe('暂停/恢复', () => {
        it('pause 后 tryAcquire 返回 false', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });

            limiter.pause();
            expect(limiter.isPaused).toBe(true);
            expect(limiter.tryAcquire(10)).toBe(false);
        });

        it('resume 后恢复正常', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
                initialTokens: 0,
            });

            limiter.pause();

            let acquired = false;
            const promise = limiter.acquire(5).then(() => {
                acquired = true;
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            expect(acquired).toBe(false);

            limiter.resume();
            await promise;
            expect(acquired).toBe(true);
        });
    });

    describe('动态调速', () => {
        it('setRate 调整速率', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            expect(limiter.currentRate).toBe(10);

            limiter.setRate(20);
            expect(limiter.currentRate).toBe(20);
        });

        it('setMaxTokens 调整最大容量', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });
            limiter.setMaxTokens(50);
            expect(limiter.availableTokens).toBe(50);
        });
    });

    describe('AbortSignal 取消（真实时间）', () => {
        it('signal abort 后请求被拒绝', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 1,
                maxTokens: 10,
                initialTokens: 0,
            });

            const controller = new AbortController();
            const promise = limiter.acquire(5, { signal: controller.signal });

            expect(limiter.queueLength).toBe(1);

            controller.abort();

            await expect(promise).rejects.toThrow('请求已取消');
            expect(limiter.queueLength).toBe(0);
        });
    });

    describe('批次消耗', () => {
        it('一次性消耗多个令牌', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 100,
            });

            await limiter.acquire(50);
            expect(limiter.availableTokens).toBeCloseTo(50, 0);
        });

        it('请求超过最大容量抛出错误', async () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 10,
                maxTokens: 50,
            });

            await expect(limiter.acquire(100)).rejects.toThrow('超过最大容量');
        });
    });

    describe('队列长度', () => {
        it('queueLength 返回等待中的请求数', () => {
            const limiter = new TokenBucketRateLimiter({
                tokensPerSecond: 1,
                maxTokens: 10,
                initialTokens: 0,
            });

            expect(limiter.queueLength).toBe(0);

            limiter.acquire(5);
            expect(limiter.queueLength).toBe(1);

            limiter.acquire(5);
            expect(limiter.queueLength).toBe(2);
        });
    });
});
