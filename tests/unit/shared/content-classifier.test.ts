import { describe, it, expect } from 'vitest';
import {
    classifyBook,
    classifyFingerprint,
    classificationTagNames,
    mergeClassificationTags,
} from '../../../shared/content-classifier';
import type { StyleFingerprint, StyleFingerprintStats } from '../../../engine/style-fingerprint-library';

function stats(overrides: Partial<StyleFingerprintStats> = {}): StyleFingerprintStats {
    return {
        avgSentenceLength: 18,
        avgParagraphLength: 120,
        dialogueRatio: 0.2,
        descriptionRatio: 0.65,
        wordCount: 12000,
        sentenceLengthStdDev: 10,
        shortSentenceRatio: 0.2,
        longSentenceRatio: 0.1,
        dialogueTurnRatio: 0.1,
        paragraphLengthStdDev: 20,
        lexicalDiversity: 0.4,
        ...overrides,
    };
}

function fingerprint(overrides: Partial<StyleFingerprint> = {}): StyleFingerprint {
    return {
        id: 'fp-1',
        name: '测试指纹',
        source: '测试章节',
        scope: 'project',
        enabled: true,
        tags: [],
        stats: stats(),
        features: {
            sentenceRhythm: '',
            wordPreference: '',
            narrativeStyle: '',
            rhetoric: '',
            dialogueStyle: '',
            paragraphStructure: '',
            overallTone: '',
        },
        samples: [],
        extractedAt: Date.now(),
        ...overrides,
    };
}

describe('classifyFingerprint', () => {
    it('短句、对话密集的指纹归到节奏与对话两个维度', () => {
        const result = classifyFingerprint(fingerprint({
            stats: stats({
                avgSentenceLength: 9,
                shortSentenceRatio: 0.58,
                dialogueRatio: 0.46,
                dialogueTurnRatio: 0.5,
                descriptionRatio: 0.3,
            }),
        }));

        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(labels).toContain('节奏:短句快节奏');
        expect(labels).toContain('节奏:短促推进');
        expect(labels).toContain('对话:对话驱动');
        expect(labels).toContain('对话:对白密集');
        expect(result.primary).toBe('短句快节奏');
    });

    it('长句与长段落归到绵长铺陈与长段落叙事', () => {
        const result = classifyFingerprint(fingerprint({
            stats: stats({
                avgSentenceLength: 34,
                longSentenceRatio: 0.42,
                sentenceLengthStdDev: 22,
                avgParagraphLength: 240,
                lexicalDiversity: 0.62,
            }),
        }));

        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(labels).toContain('节奏:长句舒展');
        expect(labels).toContain('节奏:绵长铺陈');
        expect(labels).toContain('节奏:句长起伏大');
        expect(labels).toContain('结构:长段落叙事');
        expect(labels).toContain('语言:词汇丰富');
        expect(result.primary).toBe('长句舒展');
    });

    it('特征描述里的情绪词会追加到对应维度', () => {
        const result = classifyFingerprint(fingerprint({
            features: {
                sentenceRhythm: '',
                wordPreference: '冷峻克制',
                narrativeStyle: '',
                rhetoric: '',
                dialogueStyle: '',
                paragraphStructure: '',
                overallTone: '悬疑紧张，快节奏',
            },
        }));

        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(labels).toContain('语言:冷峻克制');
        expect(labels).toContain('情绪:悬疑紧张');
        expect(labels).toContain('节奏:强冲突快节奏');
    });

    it('同一输入重复分类结果稳定且不产生重复标签', () => {
        const fp = fingerprint({ tags: ['悬疑', '悬疑', '快节奏'] });
        const first = classifyFingerprint(fp);
        const second = classifyFingerprint(fp);

        expect(second).toEqual(first);
        const keys = first.tags.map(tag => `${tag.dimension}|${tag.label}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('旧指纹缺少扩展统计字段时不会崩溃', () => {
        const legacy = fingerprint({
            stats: {
                avgSentenceLength: 0,
                avgParagraphLength: 0,
                dialogueRatio: 0,
                descriptionRatio: 0,
                wordCount: 0,
            },
        });
        const result = classifyFingerprint(legacy);
        expect(result.primary).toBe('未分类');
        expect(result.tags).toEqual([]);
    });
});

describe('classifyBook', () => {
    it('题材优先作为主分类，并保留受众、技法、商业维度', () => {
        const result = classifyBook({
            name: '测试书',
            themeTags: ['都市', '悬疑'],
            techniqueTags: ['多线叙事'],
            primaryGenre: '都市',
            genreChannel: 'male',
            wordCount: 600000,
            synopsis: '强冲突反转，商业爆款',
        });

        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(result.primary).toBe('都市');
        expect(labels).toContain('受众:男频');
        expect(labels).toContain('技法:多线叙事');
        expect(labels).toContain('题材:都市');
        expect(labels).toContain('商业:长篇连载');
        expect(labels).toContain('商业:商业向');
        expect(labels).toContain('节奏:强冲突快节奏');
    });

    it('短篇字数归到短篇/中短篇并命中悬疑情绪', () => {
        const result = classifyBook({
            name: '短篇悬疑',
            themeTags: [],
            synopsis: '一桩推理案件',
            wordCount: 32000,
        });
        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(labels).toContain('商业:短篇/中短篇');
        expect(labels).toContain('情绪:悬疑紧张');
    });

    it('质量均分计算忽略非数值字段', () => {
        const result = classifyBook({
            name: '高质量书',
            themeTags: [],
            qualityScores: {
                overall: 86,
                style: 82,
                vectorEnabled: true,
            },
        });
        const labels = result.tags.map(tag => `${tag.dimension}:${tag.label}`);
        expect(labels).toContain('商业:高质量样本');
    });

    it('缺少任何信息时返回未分类而不是抛错', () => {
        const result = classifyBook({ name: '空白书' });
        expect(result.primary).toBe('未分类');
        expect(result.tags).toEqual([]);
    });

    it('只有受众或商业标签时主分类退回首个别名而不是未分类', () => {
        const audience = classifyBook({ name: '书', genreChannel: 'male' });
        expect(audience.primary).toBe('男频');

        const commercial = classifyBook({ name: '书', wordCount: 600000 });
        expect(commercial.primary).toBe('长篇连载');
    });
});

describe('mergeClassificationTags', () => {
    it('保留用户标签，替换旧分类标签并去重', () => {
        const result = classifyBook({
            name: '书',
            primaryGenre: '玄幻',
            genreChannel: 'female',
        });
        const merged = mergeClassificationTags(
            ['我的标签', '分类:过期分类', '分类:过期分类', '我的标签'],
            result,
        );

        expect(merged).toContain('我的标签');
        expect(merged).not.toContain('分类:过期分类');
        expect(merged).toContain('分类:玄幻');
        expect(merged).toContain('分类:女频');
        expect(new Set(merged).size).toBe(merged.length);
    });

    it('标签总数上限为 30，避免无限增长', () => {
        const result = classifyBook({ name: '书', primaryGenre: '都市' });
        const existing = Array.from({ length: 40 }, (_, i) => `用户标签${i}`);
        const merged = mergeClassificationTags(existing, result);
        expect(merged).toHaveLength(30);
    });

    it('classificationTagNames 统一使用 分类: 前缀', () => {
        const result = classifyBook({ name: '书', primaryGenre: '都市' });
        expect(classificationTagNames(result).every(name => name.startsWith('分类:'))).toBe(true);
    });

    it('重复归类不会产生 分类:分类: 嵌套前缀', () => {
        const first = classifyBook({ name: '书', primaryGenre: '都市', themeTags: ['悬疑'] });
        const once = mergeClassificationTags([], first);
        const second = classifyBook({ name: '书', primaryGenre: '都市', themeTags: ['悬疑'], customTags: once });
        const twice = mergeClassificationTags(once, second);

        expect(twice).toEqual(once);
        expect(twice.some(tag => tag.startsWith('分类:分类:'))).toBe(false);
    });
});
