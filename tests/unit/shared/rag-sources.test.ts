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
