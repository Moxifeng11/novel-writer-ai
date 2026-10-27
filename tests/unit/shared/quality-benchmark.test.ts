import { describe, expect, it } from 'vitest';
import { computeBenchmarkSummary, passesBenchmark } from '../../../shared/quality-benchmark';

function sample(id: string, label: 'good' | 'bad', overall: number, language = overall) {
    return { id, label, overall, dimensions: { language } };
}

describe('quality-benchmark — 指标与回归判断', () => {
    it('good 均分高于 bad 时通过', () => {
        const summary = computeBenchmarkSummary([
            sample('g1', 'good', 82), sample('g2', 'good', 80), sample('g3', 'good', 78),
            sample('b1', 'bad', 60), sample('b2', 'bad', 58), sample('b3', 'bad', 62),
        ]);
        expect(summary.goodMean).toBe(80);
        expect(summary.badMean).toBe(60);
        expect(summary.gap).toBe(20);
        expect(passesBenchmark(summary, { minGap: 5 }).passed).toBe(true);
    });

    it('样本不足时失败并给出提示', () => {
        const summary = computeBenchmarkSummary([sample('g1', 'good', 80), sample('b1', 'bad', 60)]);
        const result = passesBenchmark(summary);
        expect(result.passed).toBe(false);
        expect(result.reasons.join(' ')).toContain('基准样章不足');
    });

    it('差距过小或误分类过多时失败', () => {
        const summary = computeBenchmarkSummary([
            sample('g1', 'good', 70), sample('g2', 'good', 71), sample('g3', 'good', 72),
            sample('b1', 'bad', 69), sample('b2', 'bad', 70), sample('b3', 'bad', 71),
        ]);
        const result = passesBenchmark(summary, { minGap: 5 });
        expect(result.passed).toBe(false);
        expect(result.reasons.join(' ')).toContain('均分差');
    });

    it('维度分离度按差值排序', () => {
        const summary = computeBenchmarkSummary([
            { id: 'g1', label: 'good', overall: 80, dimensions: { language: 85, rhythm: 70 } },
            { id: 'g2', label: 'good', overall: 82, dimensions: { language: 86, rhythm: 72 } },
            { id: 'g3', label: 'good', overall: 81, dimensions: { language: 84, rhythm: 71 } },
            { id: 'b1', label: 'bad', overall: 60, dimensions: { language: 60, rhythm: 68 } },
            { id: 'b2', label: 'bad', overall: 61, dimensions: { language: 61, rhythm: 69 } },
            { id: 'b3', label: 'bad', overall: 59, dimensions: { language: 59, rhythm: 67 } },
        ]);
        expect(summary.dimensions[0].dimension).toBe('language');
        expect(summary.dimensions[0].gap).toBeGreaterThan(summary.dimensions[1].gap);
    });
});
