/**
 * 拆解书籍向量必须被 RAG 用上（v4.83.1）
 *
 * 用户反馈：「知识库的拆解书籍功能不是刚好可以作为向量数据库吗，这个需要利用起来」。
 * 排查发现**两道关卡把拆解向量挡在门外**：
 *
 * 1. `KnowledgeInjector` 的两处守卫要求 `referenceBooks.length > 0`——
 *    用户拆解了书但没在协同写作里勾选「参考书」时，知识库注入直接返回空。
 * 2. `retrieve` 把 `bookIds: []` 原样传给 `store.search`，而后者用
 *    `if (options.bookIds && !options.bookIds.includes(bookId)) continue` 判断——
 *    空数组是 truthy，于是「一个都不要」，检索结果恒为空。
 *
 * 本文件锁定修复后的语义：**没勾参考书 = 不限制范围 = 检索全部已拆解书**。
 */

import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../../../engine/rag/retrieval-service';
import type { KnowledgeSearchResult, KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';

/** 构造命中 */
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

describe('retrieve — bookIds 空数组语义（核心修复）', () => {
    it('bookIds: [] 视为「不限制」，不再传空数组给 store.search', async () => {
        const search = vi.fn(async () => [hit()]);
        const store = { search, getNeighbors: async () => [] } as unknown as KnowledgeVectorStore;

        const outcome = await retrieve(store, {
            queryText: '主角在雨夜里堵住叛徒',
            bookIds: [],
            topN: 4,
        });

        // 关键断言：传给 store.search 的 bookIds 是 undefined（不限制），而不是 []
        const passed = (search.mock.calls[0] as unknown as [string, { bookIds?: string[] }])[1];
        expect(passed.bookIds).toBeUndefined();
        expect(outcome.hits.length).toBeGreaterThan(0);
    });

    it('显式 bookIds 仍按调用方指定收窄', async () => {
        const search = vi.fn(async () => [hit()]);
        const store = { search, getNeighbors: async () => [] } as unknown as KnowledgeVectorStore;

        await retrieve(store, { queryText: '主角在雨夜里堵住叛徒', bookIds: ['b9'], topN: 4 });

        const passed = (search.mock.calls[0] as unknown as [string, { bookIds?: string[] }])[1];
        expect(passed.bookIds).toEqual(['b9']);
    });

    it('不传 bookIds 与传空数组等价（都不限制）', async () => {
        const searchA = vi.fn(async () => [hit()]);
        const searchB = vi.fn(async () => [hit()]);
        const storeA = { search: searchA, getNeighbors: async () => [] } as unknown as KnowledgeVectorStore;
        const storeB = { search: searchB, getNeighbors: async () => [] } as unknown as KnowledgeVectorStore;

        await retrieve(storeA, { queryText: '主角在雨夜里堵住叛徒', topN: 4 });
        await retrieve(storeB, { queryText: '主角在雨夜里堵住叛徒', bookIds: [], topN: 4 });

        const a = (searchA.mock.calls[0] as unknown as [string, { bookIds?: string[] }])[1];
        const b = (searchB.mock.calls[0] as unknown as [string, { bookIds?: string[] }])[1];
        expect(a.bookIds).toBeUndefined();
        expect(b.bookIds).toBeUndefined();
    });

    it('邻块扩展在 bookIds 为空时用「全部已加载书」', async () => {
        const getNeighbors = vi.fn(async (_ids: string[]) => []);
        const store = {
            search: async () => [hit({ position: 2 })],
            getNeighbors,
            getLoadedBookIds: () => ['b1', 'b2'],
        } as unknown as KnowledgeVectorStore;

        await retrieve(store, { queryText: '主角在雨夜里堵住叛徒', bookIds: [], topN: 4 });
        expect(getNeighbors.mock.calls[0][0]).toEqual(['b1', 'b2']);
    });
});

describe('store.search 的空数组行为（说明为何必须规范化）', () => {
    it('空数组在 includes 判断下等价于「全部排除」', () => {
        // 复刻 store.search 第 638 行的判断：`options?.bookIds && !options.bookIds.includes(bookId)`
        const wouldSkip = (scope: string[] | undefined, bookId: string): boolean =>
            Boolean(scope && !scope.includes(bookId));

        expect(wouldSkip([], 'b1')).toBe(true);        // 空数组 → 全部被跳过（旧 bug）
        expect(wouldSkip(undefined, 'b1')).toBe(false); // undefined → 不限制
        expect(wouldSkip(['b9'], 'b1')).toBe(true);     // 指定范围 → 不在范围内才跳过
        expect(wouldSkip(['b1'], 'b1')).toBe(false);
    });
});
