import { describe, expect, it } from 'vitest';
import { formatRetrievalHits, mergeQueryResults, retrieve } from '../../../engine/rag/retrieval-service';
import type { KnowledgeSearchResult, KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';

function result(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
    return {
        sample: '样本正文内容，足够长以便通过最小长度检查。',
        bookId: 'b1',
        bookName: '参考书',
        dimension: 'style',
        score: 0.8,
        position: 1,
        ...overrides,
    };
}

describe('rag/retrieval-service — 多查询合并', () => {
    it('同一命中被两条查询命中时只保留一条并合并标签', () => {
        const merged = mergeQueryResults([
            { label: '当前场景', weight: 1.2, results: [result()] },
            { label: '章纲', weight: 1, results: [result()] },
        ]);
        expect(merged.hits).toHaveLength(1);
        expect(merged.deduped).toBe(1);
        expect(merged.hits[0].labels).toEqual(expect.arrayContaining(['当前场景', '章纲']));
        // 权重乘算后分数取高者（1.2 倍）
        expect(merged.hits[0].score).toBeCloseTo(0.96, 5);
    });

    it('不同 position 视为不同命中', () => {
        const merged = mergeQueryResults([
            { label: 'A', weight: 1, results: [result({ position: 1 }), result({ position: 2 })] },
        ]);
        expect(merged.hits).toHaveLength(2);
    });
});

describe('rag/retrieval-service — 管线', () => {
    function fakeStore(overrides: Partial<KnowledgeVectorStore> = {}): KnowledgeVectorStore {
        let hits = 0;
        let misses = 0;
        return {
            search: async () => [result({ position: 1 }), result({ position: 2, sample: '另一段完全不同的场景描写，用来触发多样性选择。' })],
            getNeighbors: async () => [
                { id: 'n1', bookId: 'b1', bookName: '参考书', dimension: 'style', sample: '邻块正文，补齐上下文。', vector: [], position: 3 },
            ],
            getQueryCacheStats: () => ({ hits, misses, size: 2 }),
            ...overrides,
        } as unknown as KnowledgeVectorStore;
    }

    it('多查询 → 邻块 → MMR → 预算，产出遥测', async () => {
        const outcome = await retrieve(fakeStore(), {
            source: { outline: '第三章揭穿内鬼身份的关键冲突', emotionPlan: '压抑转为爆发' },
            topN: 3,
            maxChars: 400,
        });
        expect(outcome.error).toBeUndefined();
        expect(outcome.hits.length).toBeGreaterThan(0);
        expect(outcome.telemetry.queries).toBe(2);
        expect(outcome.telemetry.chars).toBeLessThanOrEqual(400);
        expect(outcome.telemetry.neighborMerged).toBeGreaterThanOrEqual(0);
    });

    it('查询计划为空时直接返回空（不调用检索）', async () => {
        let called = false;
        const store = fakeStore({ search: (async () => { called = true; return []; }) as never });
        const outcome = await retrieve(store, { source: {} });
        expect(outcome.hits).toEqual([]);
        expect(called).toBe(false);
    });

    it('向量库缺失/抛错时给出 error 而不是静默空', async () => {
        const missing = await retrieve(null, { queryText: '有内容的查询文本' });
        expect(missing.error).toContain('未初始化');

        const broken = fakeStore({ search: (async () => { throw new Error('embedding 超时'); }) as never });
        const failed = await retrieve(broken, { queryText: '有内容的查询文本' });
        expect(failed.hits).toEqual([]);
        expect(failed.error).toContain('查询失败');
    });

    it('queryText 兼容单查询调用', async () => {
        const outcome = await retrieve(fakeStore(), { queryText: '主角在雨夜里堵住叛徒', topN: 2 });
        expect(outcome.telemetry.queries).toBe(1);
    });
});

describe('rag/retrieval-service — 渲染', () => {
    it('带 citation 与序号，超长截断', () => {
        const text = formatRetrievalHits([
            { sample: 'X'.repeat(300), bookId: 'b1', bookName: '参考书', dimension: 'style', score: 0.9 },
        ], { header: '【风格参考】', perItemChars: 100 });
        expect(text).toContain('【风格参考】');
        expect(text).toContain('〔参考书·style〕');
        expect(text).toContain('…');
        expect(text.length).toBeLessThan(200);
    });

    it('空命中返回空串', () => {
        expect(formatRetrievalHits([])).toBe('');
    });
});