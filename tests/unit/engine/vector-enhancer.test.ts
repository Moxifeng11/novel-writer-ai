import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorEnhancer } from '../../../engine/vector-enhancer';
import { TokenBucketRateLimiter } from '../../../engine/token-bucket-rate-limiter';
import type { EmbeddingProvider } from '../../../engine/embedding/embedding-provider';

class MockEmbeddingProvider implements EmbeddingProvider {
    public embedCallCount = 0;
    public embedBatchCallCount = 0;
    private modelName: string;

    constructor(modelName = 'test-model') {
        this.modelName = modelName;
    }

    async embed(text: string): Promise<number[]> {
        this.embedCallCount++;
        return [text.length, text.length * 2, text.length * 3];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        this.embedBatchCallCount++;
        return texts.map(text => [text.length, text.length * 2, text.length * 3]);
    }

    async isAvailable() {
        return { available: true, model: this.modelName };
    }

    getProviderInfo() {
        return { type: 'mock', name: 'Mock Provider', model: this.modelName };
    }

    getModelName(): string {
        return this.modelName;
    }

    async getDimensions(): Promise<number> {
        return 3;
    }
}

describe('VectorEnhancer', () => {
    describe('缓存命中率统计', () => {
        it('连续两次对相同文本调用 embedText，第二次命中缓存', async () => {
            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider);

            const result1 = await enhancer.embedText('hello world');
            expect(result1).toHaveLength(3);

            const stats1 = enhancer.getCacheStats();
            expect(stats1.hits).toBe(0);
            expect(stats1.misses).toBe(1);
            expect(stats1.hitRate).toBe(0);
            expect(stats1.size).toBe(1);

            const result2 = await enhancer.embedText('hello world');
            expect(result2).toHaveLength(3);
            expect(result2[0]).toBe(result1[0]);

            const stats2 = enhancer.getCacheStats();
            expect(stats2.hits).toBe(1);
            expect(stats2.misses).toBe(1);
            expect(stats2.hitRate).toBe(0.5);
            expect(stats2.size).toBe(1);
        });
    });

    describe('批处理优化', () => {
        it('批量请求时，实际 API 调用次数小于文本数', async () => {
            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider, { batchSize: 10 });

            await enhancer.embedText('cached-1');

            const texts = ['cached-1', 'new-1', 'new-2', 'new-3', 'new-4', 'new-5'];
            const results = await enhancer.embedTexts(texts);

            expect(results).toHaveLength(6);
            expect(provider.embedBatchCallCount).toBe(1);

            const stats = enhancer.getCacheStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(6);
        });
    });

    describe('LRU 缓存淘汰策略', () => {
        it('设置 maxSize=10，依次嵌入 11 个不同文本，最早的被淘汰', async () => {
            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider);
            enhancer.setMaxSize(5);
            expect(enhancer.getMaxSize()).toBe(5);

            for (let i = 0; i < 5; i++) {
                await enhancer.embedText(`text-${i}`);
            }
            expect(enhancer.getCacheSize()).toBe(5);

            await enhancer.embedText('text-5');
            expect(enhancer.getCacheSize()).toBe(5);

            const missesBefore = enhancer.getCacheStats().misses;
            await enhancer.embedText('text-0');
            const missesAfter = enhancer.getCacheStats().misses;
            expect(missesAfter).toBe(missesBefore + 1);
        });
    });

    describe('clearCache 和 resetCacheStats', () => {
        it('clearCache 后缓存大小为 0，stats 重置', async () => {
            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider);

            await enhancer.embedText('a');
            await enhancer.embedText('a');
            expect(enhancer.getCacheSize()).toBe(1);

            enhancer.resetCacheStats();
            const stats1 = enhancer.getCacheStats();
            expect(stats1.hits).toBe(0);
            expect(stats1.misses).toBe(0);
            expect(enhancer.getCacheSize()).toBe(1);

            enhancer.clearCache();
            expect(enhancer.getCacheSize()).toBe(0);
            const stats2 = enhancer.getCacheStats();
            expect(stats2.hits).toBe(0);
            expect(stats2.misses).toBe(0);
        });
    });

    describe('向后兼容', () => {
        it('legacy client 正常工作', async () => {
            let embedCount = 0;
            const legacyClient = {
                async embed(text: string): Promise<number[]> {
                    embedCount++;
                    return [text.length];
                }
            };
            const enhancer = new VectorEnhancer(legacyClient);

            const r1 = await enhancer.embedText('test');
            const r2 = await enhancer.embedText('test');
            expect(r1[0]).toBe(r2[0]);
            expect(embedCount).toBe(1);
        });
    });

    describe('缓存 key 包含模型名', () => {
        it('构造函数接受 maxCacheSize 选项', () => {
            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider, { maxCacheSize: 500 });
            expect(enhancer.getMaxSize()).toBe(500);
        });
    });

    describe('令牌桶限流集成', () => {
        it('构造带 rateLimiter 的 VectorEnhancer，embed 调用时 rateLimiter.acquire 被调用', async () => {
            const provider = new MockEmbeddingProvider();
            const rateLimiter = new TokenBucketRateLimiter({
                tokensPerSecond: 100,
                maxTokens: 100,
            });
            const acquireSpy = vi.spyOn(rateLimiter, 'acquire');
            const enhancer = new VectorEnhancer(provider, { rateLimiter });

            await enhancer.embedText('test');

            expect(acquireSpy).toHaveBeenCalledWith(1);
        });

        it('limit参数可配置（不同 tokensPerSecond/maxTokens 传入 VectorEnhancer）', () => {
            const rateLimiter1 = new TokenBucketRateLimiter({
                tokensPerSecond: 5,
                maxTokens: 10,
            });
            expect(rateLimiter1.currentRate).toBe(5);

            const provider = new MockEmbeddingProvider();
            const enhancer = new VectorEnhancer(provider, { rateLimiter: rateLimiter1 });
            expect(enhancer.getRateLimiter()).toBe(rateLimiter1);

            const rateLimiter2 = new TokenBucketRateLimiter({
                tokensPerSecond: 20,
                maxTokens: 50,
            });
            enhancer.setRateLimiter(rateLimiter2);
            expect(enhancer.getRateLimiter()?.currentRate).toBe(20);
        });

        it('限流器 pause 后 embed 调用被阻塞，resume 后恢复', async () => {
            const provider = new MockEmbeddingProvider();
            const rateLimiter = new TokenBucketRateLimiter({
                tokensPerSecond: 100,
                maxTokens: 100,
            });
            const enhancer = new VectorEnhancer(provider, { rateLimiter });

            rateLimiter.pause();
            expect(rateLimiter.isPaused).toBe(true);

            let embedDone = false;
            const embedPromise = enhancer.embedText('test').then(() => {
                embedDone = true;
            });

            await new Promise(r => setTimeout(r, 50));
            expect(embedDone).toBe(false);

            rateLimiter.resume();
            await embedPromise;
            expect(embedDone).toBe(true);
        });
    });
});
