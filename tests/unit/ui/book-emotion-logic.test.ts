/**
 * book-emotion-logic.test.ts — NRC 情绪/弧线/严重度映射回归（阶段 D2 / DSH-20261112-11）
 *
 * NRC 八维与八种弧线类型此前内联在渲染器里零覆盖：键名拼错一个字母，图表静默
 * 退化成英文键；`Math.min(100,…)` 钳制被删后超界值会画破雷达。16 条用例锁行为。
 */
import { describe, expect, it } from 'vitest';
import {
    buildNrcEmotionRadarData,
    EMOTION_ARC_TYPE_MAP,
    NRC_EMOTION_NAME_MAP,
    resolveEmotionArcLabel,
    resolveSeverityColor,
    resolveSeverityLabel,
    SEVERITY_COLORS,
    SEVERITY_LABELS,
} from '../../../ui/views/book-emotion-logic';

describe('buildNrcEmotionRadarData', () => {
    it('八维全给：换算百分比、钳制超界、未知键保留原文', () => {
        const data = buildNrcEmotionRadarData({
            overallDistribution: {
                anger: 0.32, anticipation: 0.18, disgust: 0.05, fear: 0.1,
                joy: 1.4, sadness: 0.12, surprise: 0.08, trust: 0.15,
            },
        });
        expect(data.map(d => d.label)).toEqual(
            ['愤怒', '期待', '厌恶', '恐惧', '喜悦', '悲伤', '惊讶', '信任'],
        );
        expect(data[0].value).toBe(32);
        expect(data[4].value).toBe(100); // 1.4*100 → 钳到 100
    });

    it('不足 3 维返回空数组（不画雷达）', () => {
        expect(buildNrcEmotionRadarData({ overallDistribution: { joy: 0.5, fear: 0.5 } })).toEqual([]);
    });

    it('缺分布 / 空对象 / null 返回空数组', () => {
        expect(buildNrcEmotionRadarData(undefined)).toEqual([]);
        expect(buildNrcEmotionRadarData(null)).toEqual([]);
        expect(buildNrcEmotionRadarData({})).toEqual([]);
        expect(buildNrcEmotionRadarData({ overallDistribution: {} })).toEqual([]);
    });

    it('NRC 恰好八维且无重复中文名', () => {
        expect(Object.keys(NRC_EMOTION_NAME_MAP)).toHaveLength(8);
        expect(new Set(Object.values(NRC_EMOTION_NAME_MAP)).size).toBe(8);
    });
});

describe('resolveEmotionArcLabel', () => {
    it('八种弧线逐一翻译', () => {
        expect(resolveEmotionArcLabel('rags_to_riches')).toBe('逆袭上升 (Rags to Riches)');
        expect(resolveEmotionArcLabel('riches_to_rags')).toBe('盛极而衰 (Riches to Rags)');
        expect(resolveEmotionArcLabel('man_in_hole')).toBe('跌入谷底回升 (Man in Hole)');
        expect(resolveEmotionArcLabel('icarus')).toBe('伊卡洛斯 (Icarus)');
        expect(resolveEmotionArcLabel('cinderella')).toBe('灰姑娘 (Cinderella)');
        expect(resolveEmotionArcLabel('oedipus')).toBe('俄狄浦斯 (Oedipus)');
        expect(resolveEmotionArcLabel('steady')).toBe('平稳型 (Steady)');
        expect(resolveEmotionArcLabel('complex')).toBe('复杂型 (Complex)');
    });

    it('未知键保留原文，undefined 给空串', () => {
        expect(resolveEmotionArcLabel('custom_arc')).toBe('custom_arc');
        expect(resolveEmotionArcLabel(undefined)).toBe('');
    });

    it('映射表正好八键', () => {
        expect(Object.keys(EMOTION_ARC_TYPE_MAP)).toHaveLength(8);
    });
});

describe('严重度徽标（商业/可读性页签共用）', () => {
    it('三档颜色与中文标签一一对应', () => {
        expect(resolveSeverityColor('high')).toBe('var(--color-red)');
        expect(resolveSeverityColor('medium')).toBe('var(--color-orange)');
        expect(resolveSeverityColor('low')).toBe('var(--color-green)');
        expect(resolveSeverityLabel('high')).toBe('高');
        expect(resolveSeverityLabel('medium')).toBe('中');
        expect(resolveSeverityLabel('low')).toBe('低');
    });

    it('未知档位回落 text-muted / 保留原文', () => {
        expect(resolveSeverityColor('critical')).toBe('var(--text-muted)');
        expect(resolveSeverityLabel('critical')).toBe('critical');
    });

    it('映射表三键且颜色无重复', () => {
        expect(Object.keys(SEVERITY_COLORS)).toHaveLength(3);
        expect(Object.keys(SEVERITY_LABELS)).toHaveLength(3);
        expect(new Set(Object.values(SEVERITY_COLORS)).size).toBe(3);
    });
});
