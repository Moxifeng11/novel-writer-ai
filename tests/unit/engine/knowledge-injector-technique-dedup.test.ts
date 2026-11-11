import { describe, it, expect, vi } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';
import type { KnowledgeSearchResult } from '../../../engine/knowledge-vector-store';

function result(category: string, score: number, sample = `${category}示例片段`): KnowledgeSearchResult {
    return {
        sample,
        bookId: 'b1',
        bookName: '参考书',
        dimension: 'technique',
        category,
        score,
    };
}

function makeInjector(results: KnowledgeSearchResult[]): KnowledgeInjector {
    const store = { search: vi.fn(async () => results) };
    const injector = new KnowledgeInjector(null as never, {
        knowledgeVectorStore: store as never,
    });
    injector.addReferenceBook('b1', '参考书', 1, true);
    // 只开技巧维度，避免其它维度也去查同一份 mock
    injector.setDimensionWeights({ character: 0, worldview: 0, style: 0, rhythm: 0, technique: 1 });
    return injector;
}

function countOccurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

describe('KnowledgeInjector — 技巧注入去重', () => {
    it('同一技巧类别只注入一次，不同类别仍可进入', async () => {
        const injector = makeInjector([
            result('伏笔', 0.95),
            result('伏笔', 0.9),
            result('伏笔', 0.85),
            result('伏笔', 0.8),
            result('伏笔', 0.75),
            result('反转', 0.7),
        ]);

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角发现密信' }, 0.8);

        const techniqueLines = text.split('\n').filter(line => /^\d+\. 伏笔——《/.test(line.trim()));
        expect(techniqueLines).toHaveLength(1);
        expect(text).toContain('反转');
    });

    it('最多输出 5 个不同技巧', async () => {
        const injector = makeInjector(
            ['伏笔', '铺垫', '悬念', '反转', '衬托', '对比', '象征'].map((name, i) => result(name, 0.9 - i * 0.01)),
        );

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        const numbered = text.split('\n').filter(line => /^\d+\. /.test(line.trim()));
        expect(numbered).toHaveLength(5);
    });

    it('缺少 category 的样本归为「通用技巧」且只保留一条', async () => {
        const store = { search: vi.fn(async () => [
            { ...result('伏笔', 0.9), category: undefined },
            { ...result('伏笔', 0.8), category: undefined },
        ]) };
        const injector = new KnowledgeInjector(null as never, { knowledgeVectorStore: store as never });
        injector.addReferenceBook('b1', '参考书', 1, true);
        injector.setDimensionWeights({ character: 0, worldview: 0, style: 0, rhythm: 0, technique: 1 });

        const text = await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        expect(countOccurrences(text, '通用技巧')).toBe(1);
    });

    it('技巧检索只取 technique 维度，不把 structure 的结构节点算作技巧类别', async () => {
        const store = {
            search: vi.fn(async (_query: string, _options: { dimensions?: string[] }) => []),
        };
        const injector = new KnowledgeInjector(null as never, { knowledgeVectorStore: store as never });
        injector.addReferenceBook('b1', '参考书', 1, true);
        injector.setDimensionWeights({ character: 0, worldview: 0, style: 0, rhythm: 0, technique: 1 });

        await injector.injectKnowledgeBase({ projectPath: '/test', outline: '主角赴宴' }, 0.8);

        const techniqueCall = store.search.mock.calls.find(
            ([, options]: [string, { dimensions?: string[] } | undefined]) =>
                options?.dimensions?.includes('technique'),
        );
        // P2：canon 维度会一并检索（同人考据资料需跨维度召回）；这里只断言不混入其他**拆解**维度
        expect(techniqueCall?.[1].dimensions).toContain('technique');
        expect(techniqueCall?.[1].dimensions).not.toContain('structure');
    });
});
