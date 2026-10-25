/**
 * quality-baseline.ts — 质量基线校准（纯函数）
 *
 * 以项目质量历史的均值/标准差作为基线，判断当前章节「高于/持平/低于」历史水平。
 * 不做 IO，样本由调用方从 `services/quality-history-store.ts` 读取。
 */
import {
    QUALITY_BASELINE_AT_SIGMA,
    QUALITY_BASELINE_MIN_SAMPLES,
} from './thresholds';
import type { QualityHistoryRecord } from './quality-history';

export type QualityBaselineDimensionKey =
    | 'language'
    | 'rhythm'
    | 'character'
    | 'plot'
    | 'atmosphere'
    | 'structure';

export const QUALITY_BASELINE_DIMENSION_FIELDS: Record<QualityBaselineDimensionKey, keyof QualityHistoryRecord> = {
    language: 'languageScore',
    rhythm: 'rhythmScore',
    character: 'characterScore',
    plot: 'plotScore',
    atmosphere: 'atmosphereScore',
    structure: 'structureScore',
};

export interface QualityBaselineStats {
    mean: number;
    stdDev: number;
    count: number;
}

export interface QualityBaseline {
    overall: QualityBaselineStats;
    dimensions: Record<QualityBaselineDimensionKey, QualityBaselineStats>;
    sampleCount: number;
    /** 计算时使用的最小样本数，维度样本不足时对比直接跳过 */
    minSamples: number;
    computedAt: number;
}

export type BaselineLevel = 'above' | 'at' | 'below';

export interface BaselineDimensionComparison {
    current: number;
    baseline: number;
    delta: number;
    zScore: number;
    level: BaselineLevel;
}

export interface BaselineComparison {
    overall: BaselineDimensionComparison;
    dimensions: Partial<Record<QualityBaselineDimensionKey, BaselineDimensionComparison>>;
    sampleCount: number;
    level: BaselineLevel;
}

export interface CurrentQualitySnapshot {
    overallScore: number;
    dimensions?: Partial<Record<QualityBaselineDimensionKey, number>>;
}

function computeStats(values: number[]): QualityBaselineStats {
    const count = values.length;
    if (count === 0) return { mean: 0, stdDev: 0, count: 0 };
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    if (count === 1) return { mean, stdDev: 0, count };
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
    return { mean, stdDev: Math.sqrt(variance), count };
}

/**
 * 计算基线；样本数不足 `minSamples`（默认 3）时返回 null，避免用一两次评估冒充基线。
 */
export function computeQualityBaseline(
    records: QualityHistoryRecord[],
    options?: { minSamples?: number },
): QualityBaseline | null {
    const minSamples = Math.max(1, options?.minSamples ?? QUALITY_BASELINE_MIN_SAMPLES);
    // 0 是旧记录/空评估的占位值：与维度口径保持一致，不能当作真实低分参与均值，
    // 否则基线整体被拉低，当前章节会恒判「高于基线」。
    const valid = records.filter(record => Number.isFinite(record.overallScore) && record.overallScore > 0);
    if (valid.length < minSamples) return null;

    const dimensions = {} as Record<QualityBaselineDimensionKey, QualityBaselineStats>;
    for (const [key, field] of Object.entries(QUALITY_BASELINE_DIMENSION_FIELDS) as Array<
        [QualityBaselineDimensionKey, keyof QualityHistoryRecord]
    >) {
        const values = valid
            .map(record => record[field])
            // 0 是旧记录/缺维度时的占位值：参与均值会把基线拉到 0，导致所有维度恒判「高于基线」
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
        dimensions[key] = computeStats(values);
    }

    return {
        overall: computeStats(valid.map(record => record.overallScore)),
        dimensions,
        sampleCount: valid.length,
        minSamples,
        computedAt: Date.now(),
    };
}

function compareDimension(
    current: number,
    baseline: QualityBaselineStats,
    atSigma: number,
): BaselineDimensionComparison {
    const delta = current - baseline.mean;
    if (baseline.stdDev <= 0) {
        // 历史无波动：用 1 分容差避免把微小差异判成偏离
        const level: BaselineLevel = Math.abs(delta) <= 1 ? 'at' : delta > 0 ? 'above' : 'below';
        return { current, baseline: baseline.mean, delta, zScore: delta, level };
    }
    const zScore = delta / baseline.stdDev;
    const level: BaselineLevel = Math.abs(zScore) < atSigma ? 'at' : zScore > 0 ? 'above' : 'below';
    return { current, baseline: baseline.mean, delta, zScore, level };
}

/**
 * 当前质量对照基线。`dimensions` 只包含调用方提供的维度。
 */
export function compareToBaseline(
    current: CurrentQualitySnapshot,
    baseline: QualityBaseline,
    options?: { atSigma?: number },
): BaselineComparison {
    const atSigma = Math.max(0, options?.atSigma ?? QUALITY_BASELINE_AT_SIGMA);
    const overall = compareDimension(current.overallScore, baseline.overall, atSigma);

    const dimensions: Partial<Record<QualityBaselineDimensionKey, BaselineDimensionComparison>> = {};
    for (const key of Object.keys(baseline.dimensions) as QualityBaselineDimensionKey[]) {
        const value = current.dimensions?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        // 维度样本不足时不给结论：1-2 个样本的均值会把偶然波动说成「偏离基线」
        const stats = baseline.dimensions[key];
        if (stats.count < baseline.minSamples) continue;
        dimensions[key] = compareDimension(value, stats, atSigma);
    }

    return {
        overall,
        dimensions,
        sampleCount: baseline.sampleCount,
        level: overall.level,
    };
}
