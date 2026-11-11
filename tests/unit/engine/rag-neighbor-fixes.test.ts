/**
 * RAG 邻块扩展缺陷回归测试（v4.83.1）
 *
 * 两个缺陷都是「静默失效」类，之前没有任何测试能发现：
 *
 * RAG-1：`getNeighbors` 内部按**单一维度**过滤，而命中的 position 跨多个维度。
 *        旧实现只传 `working[0].dimension` → 非首维度邻块永远取不到；
 *        同 position 跨维度时还会把别的维度样本当邻块塞进来（张冠李戴）。
 * RAG-2：`retrieve` 在调用方未指定 `bookIds` 时传空数组给 `getNeighbors`，
 *        而后者 `for (const bookId of [])` 一次都不循环 → 邻块扩展静默失效。
 */

import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../../../engine/rag/retrieval-service';
import type { KnowledgeSearchResult, KnowledgeVectorStore, KnowledgeVectorSample } from '../../../engine/knowledge-vector-store';

/** 构造检索命中 */
function hit(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
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

/** 构造邻块样本 */
function sample(dimension: string, position: number, bookId = 'b1'): KnowledgeVectorSample {
    return {
        id: `${bookId}-${dimension}-${position}`,
        bookId,
        bookName: '参考书',
        dimension: dimension as KnowledgeVectorSample['dimension'],
        sample: `邻块正文 ${dimension}#${position}`,
        vector: [],
        position,
    };
}

describe('RAG-1｜邻块扩展必须按维度分组（跨维度不再取错）', () => {
    it('命中跨两个维度时，getNeighbors 对每个维度各调用一次', async () => {
        const getNeighbors = vi.fn(async (_bookIds: string[], dimension: string) => {
            // 只返回「本维度」的邻块，模拟真实 store 的维度过滤行为
            if (dimension === 'character') return [sample('character', 2)];
            if (dimension === 'style') return [sample('style', 6)];
            return [];
        });
        const store = {
            search: async () => [
                hit({ dimension: 'character', position: 1 }),
                hit({ dimension: 'style', position: 5, sample: '另一段完全不同的风格样本，用于触发多样性。' }),
            ],
            getNeighbors,
        } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, {
            queryText: '主角在雨夜里堵住叛徒',
            bookIds: ['b1'],
            topN: 4,
        });

        const calledDimensions = getNeighbors.mock.calls.map(call => call[1]).sort();
        expect(calledDimensions).toEqual(['character', 'style']);
        // 两个维度的邻块都应进入结果
        const dimensions = outcome.hits.map(item => item.dimension);
        expect(dimensions).toContain('character');
        expect(dimensions).toContain('style');
    });

    it('同一 position 跨维度时不会把别的维度样本当邻块（防张冠李戴）', async () => {
        // character 与 style 都有 position=5，但邻块内容不同
        const getNeighbors = vi.fn(async (_bookIds: string[], dimension: string) => {
            if (dimension === 'character') return [sample('character', 6)];
            if (dimension === 'style') return [sample('style', 6)];
            return [];
        });
        const store = {
            search: async () => [
                hit({ dimension: 'character', position: 5 }),
                hit({ dimension: 'style', position: 5, sample: '另一段风格样本内容，与上一条明显不同。' }),
            ],
            getNeighbors,
        } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, {
            queryText: '主角在雨夜里堵住叛徒',
            bookIds: ['b1'],
            topN: 4,
        });

        // 每个命中只应拿到**自己维度**的邻块（mergeNeighborHits 会把邻块拼接到命中后）
        for (const item of outcome.hits) {
            if (item.labels?.includes('邻块')) {
                const expected = item.dimension === 'character' ? '邻块正文 character#6' : '邻块正文 style#6';
                const wrong = item.dimension === 'character' ? '邻块正文 style#6' : '邻块正文 character#6';
                expect(item.sample).toContain(expected);
                expect(item.sample).not.toContain(wrong);
            }
        }
    });
});

describe('RAG-2｜bookIds 缺省时邻块扩展不得静默失效', () => {
    it('未传 bookIds 时退化为「全部已加载书」并正常扩展', async () => {
        const getNeighbors = vi.fn(async (bookIds: string[]) => {
            // 只要 bookIds 非空就返回邻块
            return bookIds.length > 0 ? [sample('style', 3)] : [];
        });
        const store = {
            search: async () => [hit({ dimension: 'style', position: 2 })],
            getNeighbors,
            getLoadedBookIds: () => ['b1', 'b2'],
        } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, {
            queryText: '主角在雨夜里堵住叛徒',
            topN: 4,
            // 故意不传 bookIds（复现 mode-injection 的调用方式）
        });

        expect(getNeighbors).toHaveBeenCalled();
        const passedBookIds = getNeighbors.mock.calls[0][0];
        expect(passedBookIds).toEqual(['b1', 'b2']);
        expect(outcome.telemetry.neighborSkipped).toBeUndefined();
    });

    it('确实没有任何书可查时，遥测标记 neighborSkipped 而不是静默', async () => {
        const store = {
            search: async () => [hit({ dimension: 'style', position: 2 })],
            getNeighbors: async () => [],
            getLoadedBookIds: () => [],
        } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, {
            queryText: '主角在雨夜里堵住叛徒',
            topN: 4,
        });

        expect(outcome.telemetry.neighborSkipped).toBe(true);
    });

    it('显式传空数组与缺省同等处理（都退化为已加载书）', async () => {
        const getNeighbors = vi.fn(async (_bookIds: string[]) => [sample('style', 3)]);
        const store = {
            search: async () => [hit({ dimension: 'style', position: 2 })],
            getNeighbors,
            getLoadedBookIds: () => ['b1'],
        } as unknown as KnowledgeVectorStore;

        await retrieve(store, { queryText: '主角在雨夜里堵住叛徒', bookIds: [], topN: 4 });
        expect(getNeighbors.mock.calls[0][0]).toEqual(['b1']);
    });

    it('显式指定 bookIds 时优先使用调用方给的列表', async () => {
        const getNeighbors = vi.fn(async (_bookIds: string[]) => [sample('style', 3)]);
        const store = {
            search: async () => [hit({ dimension: 'style', position: 2 })],
            getNeighbors,
            getLoadedBookIds: () => ['b1', 'b2', 'b3'],
        } as unknown as KnowledgeVectorStore;

        await retrieve(store, { queryText: '主角在雨夜里堵住叛徒', bookIds: ['b9'], topN: 4 });
        expect(getNeighbors.mock.calls[0][0]).toEqual(['b9']);
    });

    it('store 不提供 getLoadedBookIds 时安全退化（不抛错）', async () => {
        const store = {
            search: async () => [hit({ dimension: 'style', position: 2 })],
            getNeighbors: async () => [],
        } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, { queryText: '主角在雨夜里堵住叛徒', topN: 4 });
        expect(outcome.hits.length).toBeGreaterThan(0);
        expect(outcome.telemetry.neighborSkipped).toBe(true);
    });
});
