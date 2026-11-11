/**
 * book-style-logic.test.ts — 风格页签数据整形回归（阶段 D2 / DSH-20261112-11）
 *
 * 这些映射与钳制此前内联在 900+ 行渲染器里零覆盖：改一个英文键、去掉
 * `Math.min(100, …)`、删掉「不足 3 维不画雷达」的门槛，都不会有任何测试变红。
 */
import { describe, expect, it } from 'vitest';
import {
    PARAGRAPH_LENGTH_NAME_MAP,
    SENSE_NAME_MAP,
    SENTENCE_LENGTH_NAME_MAP,
    SENTENCE_TYPE_NAME_MAP,
    buildFiveSensesRadarData,
    buildParagraphLengthBarData,
    buildSentenceLengthBarData,
    buildSentenceTypeDonutData,
    buildStyleScoreLines,
    resolveSenseLabel,
} from '../../../ui/views/book-style-logic';

describe('buildFiveSensesRadarData', () => {
    it('五维全给：换算百分比、钳制超界值、未知键保留原文', () => {
        const data = buildFiveSensesRadarData({
            distribution: { visual: 0.42, auditory: 0.31, olfactory: 0.1, gustatory: 1.2, unknown: 0.05 },
        });
        expect(data.map(d => d.label)).toEqual(['视觉', '听觉', '嗅觉', '味觉', 'unknown']);
        expect(data[0].value).toBe(42);
        expect(data[3].value).toBe(100); // 1.2*100=120 → 钳到 100
        expect(data[4].value).toBe(5);
    });

    it('不足 3 维返回空数组（不画雷达）', () => {
        expect(buildFiveSensesRadarData({ distribution: { visual: 0.5, auditory: 0.5 } })).toEqual([]);
    });

    it('缺 distribution / 空对象 / null 都返回空数组', () => {
        expect(buildFiveSensesRadarData(undefined)).toEqual([]);
        expect(buildFiveSensesRadarData(null)).toEqual([]);
        expect(buildFiveSensesRadarData({})).toEqual([]);
        expect(buildFiveSensesRadarData({ distribution: {} })).toEqual([]);
    });

    it('映射表正好五感且无重复', () => {
        expect(Object.keys(SENSE_NAME_MAP)).toHaveLength(5);
        expect(new Set(Object.values(SENSE_NAME_MAP)).size).toBe(5);
    });
});

describe('resolveSenseLabel', () => {
    it('已知键翻译、未知键原样、undefined 给空串', () => {
        expect(resolveSenseLabel('visual')).toBe('视觉');
        expect(resolveSenseLabel('sixth')).toBe('sixth');
        expect(resolveSenseLabel(undefined)).toBe('');
    });
});

describe('buildSentenceTypeDonutData', () => {
    it('四种句式翻译 + 未知键保留；空输入返回空数组', () => {
        const data = buildSentenceTypeDonutData({ declarative: 8, interrogative: 2, weird: 1 });
        expect(data).toEqual([
            { label: '陈述句', value: 8 },
            { label: '疑问句', value: 2 },
            { label: 'weird', value: 1 },
        ]);
        expect(buildSentenceTypeDonutData(null)).toEqual([]);
        expect(buildSentenceTypeDonutData({})).toEqual([]);
    });

    it('句式映射四键齐全', () => {
        expect(Object.keys(SENTENCE_TYPE_NAME_MAP).sort()).toEqual(
            ['declarative', 'elliptical', 'exclamatory', 'interrogative'],
        );
    });
});

describe('buildSentenceLengthBarData', () => {
    it('三档翻译；未知键保留原文', () => {
        expect(buildSentenceLengthBarData({ short: 3, medium: 5, long: 2, extra: 1 })).toEqual([
            { label: '短句', value: 3 },
            { label: '中句', value: 5 },
            { label: '长句', value: 2 },
            { label: 'extra', value: 1 },
        ]);
        expect(buildSentenceLengthBarData(undefined)).toEqual([]);
    });

    it('句长三档与段长四档不混用（段长多 veryLong）', () => {
        expect(Object.keys(SENTENCE_LENGTH_NAME_MAP)).toHaveLength(3);
        expect(Object.keys(PARAGRAPH_LENGTH_NAME_MAP)).toHaveLength(4);
        expect(PARAGRAPH_LENGTH_NAME_MAP.veryLong).toBe('超长段');
    });
});

describe('buildParagraphLengthBarData', () => {
    it('四档翻译（含超长段）', () => {
        expect(buildParagraphLengthBarData({ short: 1, medium: 2, long: 3, veryLong: 4 })).toEqual([
            { label: '短段', value: 1 },
            { label: '中段', value: 2 },
            { label: '长段', value: 3 },
            { label: '超长段', value: 4 },
        ]);
        expect(buildParagraphLengthBarData(null)).toEqual([]);
    });
});

describe('buildStyleScoreLines', () => {
    it('最多 5 条且用注入的格式化', () => {
        const scores = { a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5, f: 0.6 };
        const lines = buildStyleScoreLines(scores, v => `${Math.round(v * 100)}%`);
        expect(lines).toEqual(['a: 10%', 'b: 20%', 'c: 30%', 'd: 40%', 'e: 50%']);
    });

    it('空评分返回空数组', () => {
        expect(buildStyleScoreLines(undefined, v => String(v))).toEqual([]);
    });
});
