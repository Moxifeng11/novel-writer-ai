import { describe, expect, it } from 'vitest';
import {
    classifyCanonSource,
    computeCanonSourceHash,
    createCanonSource,
    formatCanonSourcesForPrompt,
    selectAuthoritativeSources,
    validateCanonSources,
} from '../../../shared/canon-source';

describe('canon-source — 原著来源分级', () => {
    it('官方站点识别为 official', () => {
        expect(classifyCanonSource({ url: 'https://www.qidian.com/book/123', title: '原作设定' })).toBe('official');
    });

    it('同人/改编站点识别为 derivative，即使手工标成 official', () => {
        expect(classifyCanonSource({ url: 'https://www.lofter.com/post/1', title: '同人设定', tier: 'official' })).toBe('derivative');
        expect(classifyCanonSource({ url: 'https://example.com/x', title: '动画改编设定' })).toBe('derivative');
    });

    it('百科类只作为 reference，不能作为事实依据', () => {
        const tier = classifyCanonSource({ url: 'https://zh.wikipedia.org/wiki/x', title: '条目' });
        expect(tier).toBe('reference');
        const validation = validateCanonSources([createCanonSource({ url: 'https://zh.wikipedia.org/wiki/x', excerpt: '内容' }, 0)]);
        expect(validation.valid).toBe(false);
    });

    it('只把官方来源送进生成 prompt', () => {
        const sources = [
            createCanonSource({ url: 'https://www.qidian.com/book/1', title: '官方', excerpt: '官方设定' }, 0),
            createCanonSource({ url: 'https://www.lofter.com/x', title: '同人', excerpt: '同人设定' }, 1),
        ];
        expect(selectAuthoritativeSources(sources)).toHaveLength(1);
        const prompt = formatCanonSourcesForPrompt(sources);
        expect(prompt).toContain('官方设定');
        expect(prompt).not.toContain('同人设定');
    });

    it('来源哈希变化可被检测', () => {
        const a = [createCanonSource({ url: 'https://www.qidian.com/1', excerpt: 'A' }, 0)];
        const b = [createCanonSource({ url: 'https://www.qidian.com/1', excerpt: 'B' }, 0)];
        expect(computeCanonSourceHash(a)).not.toBe(computeCanonSourceHash(b));
    });
});