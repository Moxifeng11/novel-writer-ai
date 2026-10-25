import { describe, it, expect } from 'vitest';
import {
    compareToBaseline,
    computeQualityBaseline,
    type CurrentQualitySnapshot,
} from '../../../shared/quality-baseline';
import type { QualityHistoryRecord } from '../../../shared/quality-history';

function record(overallScore: number, dimensionScore = overallScore): QualityHistoryRecord {
    return {
        chapterKey: '第1章',
        timestamp: 1_700_000_000_000 + overallScore,
        wordCount: 2000,
        overallScore,
        languageScore: dimensionScore,
        rhythmScore: dimensionScore,
        characterScore: dimensionScore,
        plotScore: dimensionScore,
        atmosphereScore: dimensionScore,
        structureScore: dimensionScore,
        grade: 'A',
        trend: 'stable',
    };
}

describe('computeQualityBaseline', () => {
    it('样本不足时返回 null', () => {
        expect(computeQualityBaseline([])).toBeNull();
        expect(computeQualityBaseline([record(70), record(80)])).toBeNull();
        expect(computeQualityBaseline([record(70), record(80)], { minSamples: 2 })).not.toBeNull();
    });

    it('计算均值与样本标准差', () => {
        const baseline = computeQualityBaseline([record(70), record(80), record(90)])!;
        expect(baseline.sampleCount).toBe(3);
        expect(baseline.overall.mean).toBeCloseTo(80, 6);
        expect(baseline.overall.stdDev).toBeCloseTo(10, 6);
        expect(baseline.dimensions.language.mean).toBeCloseTo(80, 6);
        expect(baseline.dimensions.structure.count).toBe(3);
    });

    it('忽略非有限总分', () => {
        const broken = record(80);
        (broken as any).overallScore = Number.NaN;
        const baseline = computeQualityBaseline([record(60), record(70), record(80), broken])!;
        expect(baseline.sampleCount).toBe(3);
    });

    it('维度 0 占位不参与基线（旧记录缺维度不会把均值拉到 0）', () => {
        const legacy = record(80);
        legacy.languageScore = 0;

        const baseline = computeQualityBaseline([record(70), record(80), legacy])!;

        expect(baseline.sampleCount).toBe(3);
        expect(baseline.dimensions.language.count).toBe(2);
        expect(baseline.dimensions.language.mean).toBeCloseTo(75, 6);
    });

    it('总分 0 占位不参与基线（与维度口径一致）', () => {
        const baseline = computeQualityBaseline([record(70), record(80), record(90), record(0)])!;

        expect(baseline.sampleCount).toBe(3);
        expect(baseline.overall.mean).toBeCloseTo(80, 6);
    });

    it('剔除 0 占位后样本不足时返回 null', () => {
        expect(computeQualityBaseline([record(70), record(80), record(0)])).toBeNull();
    });
});

describe('compareToBaseline', () => {
    const baseline = computeQualityBaseline([record(70), record(80), record(90)])!;

    function snapshot(overallScore: number, dimensions?: CurrentQualitySnapshot['dimensions']): CurrentQualitySnapshot {
        return { overallScore, dimensions };
    }

    it('高于基线（z >= 0.5σ）', () => {
        const comparison = compareToBaseline(snapshot(86), baseline);
        expect(comparison.level).toBe('above');
        expect(comparison.overall.delta).toBeCloseTo(6, 6);
        expect(comparison.overall.zScore).toBeCloseTo(0.6, 6);
    });

    it('与基线持平（|z| < 0.5σ）', () => {
        expect(compareToBaseline(snapshot(84), baseline).level).toBe('at');
        expect(compareToBaseline(snapshot(80), baseline).level).toBe('at');
    });

    it('低于基线', () => {
        const comparison = compareToBaseline(snapshot(74), baseline);
        expect(comparison.level).toBe('below');
        expect(comparison.overall.delta).toBeCloseTo(-6, 6);
    });

    it('只比较调用方提供的维度', () => {
        const comparison = compareToBaseline(snapshot(80, { language: 90, plot: 70 }), baseline);
        expect(Object.keys(comparison.dimensions).sort()).toEqual(['language', 'plot']);
        expect(comparison.dimensions.language!.level).toBe('above');
        expect(comparison.dimensions.plot!.level).toBe('below');
    });

    it('维度样本不足 minSamples 时不输出该维度结论', () => {
        const sparse = computeQualityBaseline([record(80, 0), record(80, 0), record(80, 80)])!;
        expect(sparse.dimensions.language.count).toBe(1);

        const comparison = compareToBaseline(snapshot(80, { language: 95 }), sparse);

        expect(comparison.overall.level).toBe('at');
        expect(comparison.dimensions.language).toBeUndefined();
    });

    it('历史无波动时用 1 分容差判定', () => {
        const flat = computeQualityBaseline([record(80), record(80), record(80)])!;
        expect(compareToBaseline(snapshot(81), flat).level).toBe('at');
        expect(compareToBaseline(snapshot(83), flat).level).toBe('above');
        expect(compareToBaseline(snapshot(77), flat).level).toBe('below');
    });

    it('支持自定义持平区间', () => {
        expect(compareToBaseline(snapshot(86), baseline, { atSigma: 1 }).level).toBe('at');
    });
});
