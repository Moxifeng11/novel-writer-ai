import { describe, expect, it } from 'vitest';
import {
    DEFAULT_INJECTION_BUDGET,
    buildFeatureRows,
    buildStatItems,
    resolveInjectionBudget,
    visibleSamples,
} from '../../../ui/views/fingerprint-detail-logic';

/**
 * 指纹详情面板数据整形回归（阶段 D2 / DSH-20261112-07）。
 *
 * 锁住：统计四项口径、空特征不渲染、代表片段截断、注入预算非法回落。
 */

describe('buildStatItems', () => {
    it('四项统计按固定顺序返回并复用统一格式化', () => {
        const items = buildStatItems({
            avgSentenceLength: 18.34,
            avgParagraphLength: 120.6,
            dialogueRatio: 0.35,
            descriptionRatio: 0.2,
        });
        expect(items.map(item => item.label)).toEqual(['平均句长', '平均段长', '对话占比', '描写占比']);
        expect(items[0].value).toContain('18.3');
        expect(items[2].value).toContain('%');
    });

    it('缺失 stats 时也返回四项占位（不让面板塌掉）', () => {
        expect(buildStatItems(undefined)).toHaveLength(4);
        expect(buildStatItems({})).toHaveLength(4);
    });
});

describe('buildFeatureRows', () => {
    const labels = [
        { key: 'sentenceRhythm', label: '句式节奏' },
        { key: 'rhetoric', label: '修辞特点' },
        { key: 'overallTone', label: '整体基调' },
    ];

    it('按固定顺序输出非空字符串特征', () => {
        const rows = buildFeatureRows({
            sentenceRhythm: '短句为主',
            rhetoric: '',
            overallTone: '冷峻',
        }, labels);
        expect(rows).toEqual([
            { key: 'sentenceRhythm', label: '句式节奏', value: '短句为主' },
            { key: 'overallTone', label: '整体基调', value: '冷峻' },
        ]);
    });

    it('非字符串/空对象/空值都不渲染', () => {
        expect(buildFeatureRows({ sentenceRhythm: 42 }, labels)).toEqual([]);
        expect(buildFeatureRows({}, labels)).toEqual([]);
        expect(buildFeatureRows(null, labels)).toEqual([]);
    });
});

describe('visibleSamples', () => {
    it('默认最多 3 条且不改原数组', () => {
        const samples = ['a', 'b', 'c', 'd'];
        expect(visibleSamples(samples)).toEqual(['a', 'b', 'c']);
        expect(samples).toHaveLength(4);
    });

    it('空/null 与 max=0 返回空数组', () => {
        expect(visibleSamples([])).toEqual([]);
        expect(visibleSamples(undefined)).toEqual([]);
        expect(visibleSamples(['a'], 0)).toEqual([]);
    });
});

describe('resolveInjectionBudget', () => {
    it('正数生效', () => {
        expect(resolveInjectionBudget(3000)).toBe(3000);
        expect(resolveInjectionBudget('1500')).toBe(1500);
    });

    it('非法值回落默认 2000', () => {
        expect(resolveInjectionBudget(0)).toBe(DEFAULT_INJECTION_BUDGET);
        expect(resolveInjectionBudget(-5)).toBe(DEFAULT_INJECTION_BUDGET);
        expect(resolveInjectionBudget('abc')).toBe(DEFAULT_INJECTION_BUDGET);
        expect(resolveInjectionBudget(undefined)).toBe(DEFAULT_INJECTION_BUDGET);
    });
});

describe('边界补充', () => {
    it('visibleSamples 负 max 返回空数组', () => {
        expect(visibleSamples(['a', 'b'], -1)).toEqual([]);
    });

    it('resolveInjectionBudget 对 NaN 回落默认值', () => {
        expect(resolveInjectionBudget(Number.NaN)).toBe(DEFAULT_INJECTION_BUDGET);
    });

    it('buildFeatureRows 忽略未出现在 labels 的字段', () => {
        const rows = buildFeatureRows(
            { sentenceRhythm: '短句', extraField: '不应出现' },
            [{ key: 'sentenceRhythm', label: '句式节奏' }],
        );
        expect(rows).toEqual([{ key: 'sentenceRhythm', label: '句式节奏', value: '短句' }]);
    });
});
