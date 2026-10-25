/**
 * knowledge-injector-style-original.test.ts — 文风注入的 style / original 配额
 *
 * style 每本书约 5 条，原文分块每本最多 120 条：同一次 topN 检索里原文几乎必然
 * 把风格分析样本挤光，「文风参考」只剩原文片段。按维度分别检索并给风格留配额。
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';
import type { KnowledgeSearchResult } from '../../../engine/knowledge-vector-store';

function sample(dimension: 'style' | 'original', name: string, score: number, position?: number): KnowledgeSearchResult {
    return {
        sample: name,
        bookId: 'b1',
        bookName: '参考书',
        dimension,
        score,
        position,
    };
}

function makeInjector(
    styleResults: KnowledgeSearchResult[],
    originalResults: KnowledgeSearchResult[],
): { injector: KnowledgeInjector; search: Mock } {
    const search = vi.fn(async (_query: string, options?: { dimensions?: string[] }) => {
        if (options?.dimensions?.includes('style')) return styleResults;
        if (options?.dimensions?.includes('original')) return originalResults;
        return [];
    });
    const injector = new KnowledgeInjector(null as never, {
        knowledgeVectorStore: { search } as never,
    });
    injector.addReferenceBook('b1', '参考书', 1, true);
    injector.setDimensionWeights({ character: 0, worldview: 0, style: 1, rhythm: 0, technique: 0 });
    return { injector, search };
}

describe('KnowledgeInjector — 文风注入的 style / original 配额', () => {
    it('两个维度分别检索，风格样本不会被原文分块挤光', async () => {
        const styleResults = [
            sample('style', '风格A', 0.99),
            sample('style', '风格B', 0.98),
        ];
        // position 5 / 6 相邻：去重后只保留高分的 5
        const originalResults = [
            sample('original', '原文位置5', 0.96, 5),
            sample('original', '原文位置6', 0.95, 6),
            sample('original', '原文位置7', 0.94, 7),
            sample('original', '原文位置20', 0.9, 20),
        ];
        const { injector, search } = makeInjector(styleResults, originalResults);

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        const dimensionsUsed = search.mock.calls.map(([, options]) => options?.dimensions);
        expect(dimensionsUsed).toContainEqual(['style']);
        expect(dimensionsUsed).toContainEqual(['original']);

        expect(text).toContain('风格A');
        expect(text).toContain('原文位置5');
        // 相邻块被去重，且不会因为原文占满配额而把风格样本挤掉
        expect(text).not.toContain('原文位置6');
    });

    it('原文为空时用风格样本补齐总条数，而不是只留风格配额', async () => {
        const styleResults = [
            sample('style', '风格A', 0.99),
            sample('style', '风格B', 0.98),
            sample('style', '风格C', 0.97),
            sample('style', '风格D', 0.96),
            sample('style', '风格E', 0.95),
        ];
        const { injector } = makeInjector(styleResults, []);

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        // 布局上限是每个参考书最多展示 3 条：能出现 C 说明没有停在风格配额（1 条）
        expect(text).toContain('风格C');
    });

    it('风格为空时仍可只靠原文分块注入，并保持相邻去重', async () => {
        const originalResults = [
            sample('original', '原文位置0', 0.96, 0),
            sample('original', '原文位置1', 0.95, 1),
            sample('original', '原文位置2', 0.94, 2),
            sample('original', '原文位置10', 0.93, 10),
            sample('original', '原文位置11', 0.92, 11),
        ];
        const { injector } = makeInjector([], originalResults);

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        expect(text).toContain('原文位置0');
        expect(text).toContain('原文位置10');
        // 用引号包住，避免「原文位置10」误命中「原文位置1」
        expect(text).not.toContain('"原文位置1"');
    });
});
