import { describe, expect, it } from 'vitest';
import { KnowledgeVectorStore, type KnowledgeVectorSample } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

/** 固定二维 embedding：查询 [1,0]，便于控制语义排序 */
const provider: EmbeddingProvider = {
    async embed() { return [1, 0]; },
    async embedBatch(texts: string[]) { return texts.map(() => [1, 0]); },
    async isAvailable(): Promise<EmbeddingAvailability> { return { available: true, model: 'mock', dimensions: 2 }; },
    getProviderInfo(): ProviderInfo { return { type: 'mock', name: 'mock', model: 'mock' }; },
    getModelName() { return 'mock'; },
    async getDimensions() { return 2; },
};

function sample(id: string, vector: number[], text = id): KnowledgeVectorSample {
    return {
        id,
        bookId: 'b1',
        bookName: '书',
        dimension: 'style',
        sample: text,
        vector,
    };
}

function makeStore(items: KnowledgeVectorSample[]): KnowledgeVectorStore {
    const store = new KnowledgeVectorStore({} as never, provider);
    (store as unknown as { loaded: boolean }).loaded = true;
    (store as unknown as { samples: Map<string, KnowledgeVectorSample[]> })
        .samples = new Map([['b1', items]]);
    return store;
}

describe('KnowledgeVectorStore — 语义 Top-K 剪枝', () => {
    it('小库保持全量语义排序与过滤', async () => {
        const store = makeStore([
            sample('low', [0, 1]),
            sample('high', [1, 0]),
        ]);
        const results = await store.search('查询', { topN: 1 });
        expect(results[0]?.sample).toBe('high');
        expect(results.every(item => item.score >= 0.15)).toBe(true);
    });

    it('大库（>200 候选）仍返回语义最高样本，且维度过滤保留', async () => {
        const items: KnowledgeVectorSample[] = [];
        for (let i = 0; i < 260; i++) {
            items.push(sample(`s${i}`, i === 250 ? [1, 0] : [0, 1]));
        }
        items.push({ ...sample('rhythm', [1, 0], '节奏样本'), dimension: 'rhythm' });

        const store = makeStore(items);
        const results = await store.search('查询', { topN: 1, dimensions: ['style'] });
        expect(results[0]?.sample).toBe('s250');
        expect(results.some(item => item.dimension === 'rhythm')).toBe(false);
    });

    it('minScore 在剪枝后仍然生效', async () => {
        const store = makeStore([sample('low', [0, 1])]);
        const results = await store.search('查询', { topN: 1, minScore: 0.99 });
        expect(results).toEqual([]);
    });

    it('bookIds 过滤在语义粗筛前生效', async () => {
        const store = makeStore([sample('a', [1, 0])]);
        (store as unknown as { samples: Map<string, KnowledgeVectorSample[]> }).samples.set('b2', [
            { ...sample('b', [1, 0]), bookId: 'b2', bookName: '书B' },
        ]);
        const results = await store.search('查询', { topN: 1, bookIds: ['b2'] });
        expect(results).toHaveLength(1);
        expect(results[0]?.bookId).toBe('b2');
    });
});
