import { describe, it, expect } from 'vitest';
import { classifyBook, classifyFingerprint } from '../../../shared/content-classifier';
import { extractKeywordTokens } from '../../../shared/keyword-tokens';

/**
 * 压力基线：分类是纯本地规则、在列表渲染时逐项调用，必须在数千条规模下
 * 保持毫秒级；阈值故意放宽，只拦截“意外退化成 O(n²) 或正则回溯”的回归。
 */
describe('分类与关键词压力基线', () => {
    it('5000 个指纹连续分类低于 2000ms 且结果确定', () => {
        const fingerprints = Array.from({ length: 5000 }, (_, i) => ({
            name: `指纹样本 ${i}`,
            source: i % 2 === 0 ? '悬疑紧张，短句快节奏' : '细腻抒情，长句铺陈',
            tags: i % 3 === 0 ? ['都市'] : ['古风'],
            stats: {
                avgSentenceLength: 8 + (i % 24),
                avgParagraphLength: 40 + (i % 200),
                dialogueRatio: (i % 100) / 100,
                descriptionRatio: ((i * 7) % 100) / 100,
                wordCount: 3000 + i,
                sentenceLengthStdDev: i % 30,
                shortSentenceRatio: (i % 100) / 100,
                longSentenceRatio: ((i * 3) % 100) / 100,
                dialogueTurnRatio: ((i * 5) % 100) / 100,
                lexicalDiversity: ((i * 11) % 100) / 100,
            },
            features: {
                overallTone: i % 2 === 0 ? '紧张压迫' : '温暖治愈',
            },
        }));

        const started = performance.now();
        let firstPrimary = '';
        for (const [index, fp] of fingerprints.entries()) {
            const result = classifyFingerprint(fp);
            if (index === 0) firstPrimary = result.primary;
        }
        const elapsed = performance.now() - started;
        console.log(`[stress] classifyFingerprint x5000 = ${elapsed.toFixed(1)}ms`);

        expect(classifyFingerprint(fingerprints[0]).primary).toBe(firstPrimary);
        expect(elapsed).toBeLessThan(2000);
    });

    it('2000 本书连续分类低于 1500ms', () => {
        const books = Array.from({ length: 2000 }, (_, i) => ({
            name: `书籍 ${i}`,
            themeTags: i % 2 === 0 ? ['都市', '悬疑'] : ['古风', '言情'],
            techniqueTags: ['多线叙事', '群像'],
            customTags: i % 5 === 0 ? ['分类:旧标签'] : [],
            primaryGenre: i % 2 === 0 ? '都市' : '古装',
            genreChannel: (i % 3 === 0 ? 'male' : i % 3 === 1 ? 'female' : 'neutral') as 'male' | 'female' | 'neutral',
            wordCount: 30000 + (i * 400),
            synopsis: i % 4 === 0 ? '强冲突反转，商业爆款' : '细腻治愈的日常',
            qualityScores: { overall: 70 + (i % 30), vectorEnabled: true },
        }));

        const started = performance.now();
        for (const book of books) {
            classifyBook(book);
        }
        const elapsed = performance.now() - started;
        console.log(`[stress] classifyBook x2000 = ${elapsed.toFixed(1)}ms`);

        expect(elapsed).toBeLessThan(1500);
    });

    it('超长文本关键词提取保持有界', () => {
        const longText = '悬疑反转节奏对话描写'.repeat(20000);
        const started = performance.now();
        const tokens = extractKeywordTokens(longText, 120);
        const elapsed = performance.now() - started;
        console.log(`[stress] extractKeywordTokens 300k chars = ${elapsed.toFixed(1)}ms`);

        expect(tokens.length).toBeLessThanOrEqual(120);
        expect(elapsed).toBeLessThan(500);
    });
});
