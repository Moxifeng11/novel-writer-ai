import { describe, expect, it } from 'vitest';
import {
    RAG_SOURCE_LIMIT,
    formatRagSources,
    pushRagSource,
    summarizeRagSources,
    type RagSource,
} from '../../../shared/rag-sources';

function src(partial: Partial<RagSource> = {}): RagSource {
    return {
        book: '书A',
        dimension: 'style',
        score: 0.812,
        excerpt: '他把门推开，风灌进来。',
        ...partial,
    };
}

describe('pushRagSource', () => {
    it('记录来源并把分数保留两位', () => {
        const list: RagSource[] = [];
        expect(pushRagSource(list, src())).toBe(true);
        expect(list[0].score).toBe(0.81);
    });

    it('同书同维度同片段只记一次', () => {
        const list: RagSource[] = [];
        pushRagSource(list, src());
        expect(pushRagSource(list, src({ score: 0.9 }))).toBe(false);
        expect(list).toHaveLength(1);
    });

    it('同书不同维度视为不同来源', () => {
        const list: RagSource[] = [];
        pushRagSource(list, src({ dimension: 'style' }));
        expect(pushRagSource(list, src({ dimension: 'original' }))).toBe(true);
        expect(list).toHaveLength(2);
    });

    it('超过上限不再追加', () => {
        const list: RagSource[] = [];
        for (let i = 0; i < RAG_SOURCE_LIMIT + 3; i++) {
            pushRagSource(list, src({ excerpt: `片段${i}` }));
        }
        expect(list).toHaveLength(RAG_SOURCE_LIMIT);
    });

    it('缺书名或空片段直接忽略', () => {
        const list: RagSource[] = [];
        expect(pushRagSource(list, src({ book: '  ' }))).toBe(false);
        expect(pushRagSource(list, src({ excerpt: '   ' }))).toBe(false);
        expect(list).toHaveLength(0);
    });

    it('长片段截断到 60 字并加省略号', () => {
        const list: RagSource[] = [];
        pushRagSource(list, src({ excerpt: '字'.repeat(200) }));
        expect(list[0].excerpt.length).toBeLessThanOrEqual(61);
        expect(list[0].excerpt.endsWith('…')).toBe(true);
    });

    it('非法分数归零而不是 NaN', () => {
        const list: RagSource[] = [];
        pushRagSource(list, src({ score: Number.NaN }));
        expect(list[0].score).toBe(0);
    });
});

describe('formatRagSources / summarizeRagSources', () => {
    it('format 幂等：重复输入不会产生重复项', () => {
        const raw = [src(), src({ score: 0.5 }), src({ dimension: 'original' })];
        const once = formatRagSources(raw);
        const twice = formatRagSources(once);
        expect(once).toHaveLength(2);
        expect(twice).toEqual(once);
    });

    it('summary 形如「书(dimension) 0.81；…」', () => {
        const summary = summarizeRagSources([src(), src({ book: '书B', dimension: 'original', score: 0.7 })]);
        expect(summary).toBe('书A(style) 0.81；书B(original) 0.70');
    });

    it('空列表返回空串', () => {
        expect(summarizeRagSources([])).toBe('');
    });
});

import { normalizeRagSources, summarizeRagUsage } from '../../../shared/rag-sources';

describe('normalizeRagSources — 读取 frontmatter', () => {
    it('非数组返回空；坏条目被丢弃', () => {
        expect(normalizeRagSources(undefined)).toEqual([]);
        expect(normalizeRagSources('x')).toEqual([]);
        const list = normalizeRagSources([
            { book: '书A', dimension: 'style', score: 0.8, excerpt: '片段' },
            { book: '', dimension: 'style', score: 0.5, excerpt: '无效' },
            null,
            'x',
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].book).toBe('书A');
    });
});

describe('summarizeRagUsage', () => {
    const records = [
        { path: 'p/第1章_大纲摘要.md', label: '大纲摘要', sources: [{ book: '书A', dimension: 'style', score: 0.8, excerpt: 'a' }] },
        { path: 'p/第1章_正文.md', label: '正文', sources: [
            { book: '书A', dimension: 'style', score: 0.7, excerpt: 'b' },
            { book: '书B', dimension: 'original', score: 0.6, excerpt: 'c' },
        ] },
        { path: 'p/第1章_质量控制.md', label: '质量控制', sources: [] },
    ];

    it('计算命中率、片段数、书目与维度聚合', () => {
        const usage = summarizeRagUsage(records);
        expect(usage.stepsTotal).toBe(3);
        expect(usage.stepsWithRag).toBe(2);
        expect(usage.hitRate).toBeCloseTo(2 / 3);
        expect(usage.totalSources).toBe(3);
        expect(usage.byBook).toEqual([
            { book: '书A', count: 2 },
            { book: '书B', count: 1 },
        ]);
        expect(usage.byDimension[0]).toEqual({ dimension: 'style', count: 2 });
    });

    it('recent 只保留有引用的记录，并尊重上限', () => {
        const usage = summarizeRagUsage(records, { recentLimit: 1 });
        expect(usage.recent).toHaveLength(1);
        expect(usage.recent[0].label).toBe('大纲摘要');
    });

    it('空记录集命中率为 0 而不是 NaN', () => {
        const usage = summarizeRagUsage([]);
        expect(usage.hitRate).toBe(0);
        expect(usage.stepsTotal).toBe(0);
    });
});
