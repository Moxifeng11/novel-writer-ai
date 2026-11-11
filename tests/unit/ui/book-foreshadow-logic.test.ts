/**
 * book-foreshadow-logic.test.ts — 伏笔页签数据整形回归（阶段 D2 / DSH-20261112-11）
 *
 * 原渲染方法里 typeLabels 定义了两次、重要度档位用内联三元——改一边漏一边没有任何
 * 测试能发现。这里锁：标签单源、评分卡占位、环图数值兜底、档位边界（>= 判定）。
 */
import { describe, expect, it } from 'vitest';
import {
    buildForeshadowDonutData,
    buildForeshadowQualityItems,
    buildForeshadowStatItems,
    FORESHADOW_FILTER_OPTIONS,
    FORESHADOW_IMPORTANCE_STYLES,
    FORESHADOW_TYPE_LABELS,
    foreshadowImportanceTier,
    resolveForeshadowTypeLabel,
} from '../../../ui/views/book-foreshadow-logic';

describe('resolveForeshadowTypeLabel', () => {
    it('五类翻译齐全，未知键保留原文', () => {
        expect(resolveForeshadowTypeLabel('item')).toBe('物品伏笔');
        expect(resolveForeshadowTypeLabel('skill')).toBe('功法伏笔');
        expect(resolveForeshadowTypeLabel('character')).toBe('人物伏笔');
        expect(resolveForeshadowTypeLabel('setting')).toBe('设定伏笔');
        expect(resolveForeshadowTypeLabel('event')).toBe('事件伏笔');
        expect(resolveForeshadowTypeLabel('mystery')).toBe('mystery');
    });

    it('标签表正好五键（分布与列表共用单源）', () => {
        expect(Object.keys(FORESHADOW_TYPE_LABELS)).toHaveLength(5);
    });
});

describe('buildForeshadowQualityItems', () => {
    it('五项按固定顺序并带各自配色', () => {
        const items = buildForeshadowQualityItems({
            totalScore: 82, diversityScore: 70, resolutionRate: 55, signalNoiseRatio: 88, coverageScore: 61,
        });
        expect(items.map(i => i.label)).toEqual(['综合评分', '类型多样性', '回收率', '信噪比', '覆盖度']);
        expect(items[0]).toMatchObject({ value: '82分', color: 'var(--interactive-accent)' });
        expect(items[1].value).toBe('70%');
    });

    it('缺失字段给 - 占位（卡片不塌）', () => {
        const items = buildForeshadowQualityItems(undefined);
        expect(items).toHaveLength(5);
        expect(items.every(i => i.value === '-')).toBe(true);
        const partial = buildForeshadowQualityItems({ totalScore: 60 });
        expect(partial[0].value).toBe('60分');
        expect(partial[2].value).toBe('-');
    });
});

describe('buildForeshadowDonutData', () => {
    it('已回收/未回收两片，缺统计回落 0（不产生 undefined 值）', () => {
        expect(buildForeshadowDonutData({ resolvedCount: 3, unresolvedCount: 5 })).toEqual([
            { label: '已回收', value: 3, color: '#2ecc71' },
            { label: '未回收', value: 5, color: '#f59e0b' },
        ]);
        expect(buildForeshadowDonutData(undefined)).toEqual([
            { label: '已回收', value: 0, color: '#2ecc71' },
            { label: '未回收', value: 0, color: '#f59e0b' },
        ]);
    });
});

describe('buildForeshadowStatItems', () => {
    it('四项统计，平均重要度走注入的格式化', () => {
        const items = buildForeshadowStatItems(
            { totalForeshadows: 8, resolvedCount: 3, unresolvedCount: 5, avgImportance: 0.62 },
            v => `${Math.round(v * 100)}%`,
        );
        expect(items.map(i => i.value)).toEqual(['8', '3', '5', '62%']);
    });

    it('缺统计给 - 占位', () => {
        expect(buildForeshadowStatItems(undefined, v => String(v)).every(i => i.value === '-')).toBe(true);
    });
});

describe('foreshadowImportanceTier', () => {
    it('边界用 >= 判定：0.7 高、0.4 中、低于为默认', () => {
        expect(foreshadowImportanceTier(0.7)).toBe('high');
        expect(foreshadowImportanceTier(0.69)).toBe('mid');
        expect(foreshadowImportanceTier(0.4)).toBe('mid');
        expect(foreshadowImportanceTier(0.39)).toBe('default');
        expect(foreshadowImportanceTier(undefined)).toBe('default');
    });

    it('三档各有无重复的样式串', () => {
        const styles = Object.values(FORESHADOW_IMPORTANCE_STYLES);
        expect(styles).toHaveLength(3);
        expect(new Set(styles).size).toBe(3);
    });
});

describe('FORESHADOW_FILTER_OPTIONS', () => {
    it('三档顺序固定，all 在前', () => {
        expect(FORESHADOW_FILTER_OPTIONS.map(o => o.value)).toEqual(['all', 'resolved', 'unresolved']);
        expect(FORESHADOW_FILTER_OPTIONS.map(o => o.label)).toEqual(['全部', '已回收', '未回收']);
    });
});
