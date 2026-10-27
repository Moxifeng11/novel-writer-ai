/**
 * quality-benchmark.ts — 基准样章评估指标
 *
 * 输入是已算好的评分（WQE/QSE），本模块只做统计与回归判断，
 * 不引入第二套评分标准。
 */

export type BenchmarkLabel = 'good' | 'bad';

export interface BenchmarkSampleScore {
    id: string;
    label: BenchmarkLabel;
    genre?: string;
    overall: number;
    dimensions: Record<string, number>;
}

export interface BenchmarkDimensionSummary {
    dimension: string;
    goodMean: number;
    badMean: number;
    gap: number;
}

export interface BenchmarkSummary {
    sampleCount: number;
    goodCount: number;
    badCount: number;
    goodMean: number;
    badMean: number;
    gap: number;
    misclassified: string[];
    dimensions: BenchmarkDimensionSummary[];
    sufficient: boolean;
    warning?: string;
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeBenchmarkSummary(samples: BenchmarkSampleScore[]): BenchmarkSummary {
    const good = samples.filter(s => s.label === 'good');
    const bad = samples.filter(s => s.label === 'bad');
    const goodMean = mean(good.map(s => s.overall));
    const badMean = mean(bad.map(s => s.overall));
    const dimensions = new Set<string>();
    for (const s of samples) for (const key of Object.keys(s.dimensions || {})) dimensions.add(key);

    const dimensionSummaries: BenchmarkDimensionSummary[] = Array.from(dimensions).map(dimension => {
        const g = mean(good.map(s => s.dimensions?.[dimension] ?? 0));
        const b = mean(bad.map(s => s.dimensions?.[dimension] ?? 0));
        return { dimension, goodMean: g, badMean: b, gap: g - b };
    }).sort((a, b) => b.gap - a.gap);

    // 单样本误分类：good 低于 bad 均分，或 bad 高于 good 均分
    const misclassified = samples
        .filter(s => (s.label === 'good' ? s.overall < badMean : s.overall > goodMean))
        .map(s => s.id);

    const sufficient = good.length >= 3 && bad.length >= 3;
    return {
        sampleCount: samples.length,
        goodCount: good.length,
        badCount: bad.length,
        goodMean,
        badMean,
        gap: goodMean - badMean,
        misclassified,
        dimensions: dimensionSummaries,
        sufficient,
        warning: sufficient ? undefined : '基准样章不足：good/bad 各至少 3 条才有统计意义',
    };
}

/** 回归判断：good 与 bad 的均分差至少达到 minGap，且误分类不超过 maxMisclassified。 */
export function passesBenchmark(
    summary: BenchmarkSummary,
    options: { minGap?: number; maxMisclassified?: number } = {},
): { passed: boolean; reasons: string[] } {
    const minGap = options.minGap ?? 5;
    const maxMisclassified = options.maxMisclassified ?? Math.max(1, Math.floor(summary.sampleCount * 0.2));
    const reasons: string[] = [];
    if (!summary.sufficient) reasons.push(summary.warning || '样本不足');
    if (summary.gap < minGap) reasons.push(`good/bad 均分差 ${summary.gap.toFixed(1)} < ${minGap}`);
    if (summary.misclassified.length > maxMisclassified) {
        reasons.push(`误分类 ${summary.misclassified.length} 条 > ${maxMisclassified}`);
    }
    return { passed: reasons.length === 0, reasons };
}
