import { describe, it, expect } from 'vitest';
import { extractKeywordTokens, keywordOverlapRatio } from '../../../shared/keyword-tokens';

describe('extractKeywordTokens', () => {
    it('中文按 2-gram 切分，英文/数字按词切分', () => {
        const tokens = extractKeywordTokens('悬疑反转 Novel 2025');
        expect(tokens).toContain('悬疑');
        expect(tokens).toContain('疑反');
        expect(tokens).toContain('反转');
        expect(tokens).toContain('novel');
        expect(tokens).toContain('2025');
    });

    it('忽略单字与单字符英文，避免噪声命中', () => {
        const tokens = extractKeywordTokens('a 我 b 的');
        expect(tokens).not.toContain('a');
        expect(tokens).not.toContain('b');
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toBe('我的');
    });

    it('大小写归一且去重', () => {
        const tokens = extractKeywordTokens('Novel NOVEL novel');
        expect(tokens.filter(token => token === 'novel')).toHaveLength(1);
    });

    it('按 limit 截断，保证长文本检索开销可控', () => {
        const longText = Array.from({ length: 400 }, (_, i) => `关键词${i}`).join(' ');
        expect(extractKeywordTokens(longText, 50)).toHaveLength(50);
    });

    it('空输入返回空数组', () => {
        expect(extractKeywordTokens('')).toEqual([]);
        expect(extractKeywordTokens(undefined as unknown as string)).toEqual([]);
    });
});

describe('keywordOverlapRatio', () => {
    it('全命中返回 1，部分命中按比例计算', () => {
        const tokens = ['悬疑', '反转', '节奏'];
        expect(keywordOverlapRatio(tokens, '悬疑反转节奏')).toBe(1);
        expect(keywordOverlapRatio(tokens, '只有悬疑')).toBeCloseTo(1 / 3, 5);
    });

    it('无命中或空查询返回 0', () => {
        expect(keywordOverlapRatio(['悬疑'], '都市日常')).toBe(0);
        expect(keywordOverlapRatio([], '悬疑')).toBe(0);
        expect(keywordOverlapRatio(['悬疑'], '')).toBe(0);
    });

    it('大小写不敏感', () => {
        expect(keywordOverlapRatio(['novel'], 'NOVEL OPENING')).toBe(1);
    });
});
