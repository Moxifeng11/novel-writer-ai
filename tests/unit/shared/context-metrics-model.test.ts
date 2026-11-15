import { describe, expect, it } from 'vitest';
import { compareMetrics, renderMetricsReport, summarizeInjection } from '@/shared/context-metrics-model';
import type { InjectionRecord } from '@/shared/context-metrics-model';

const rec = (step: string, tokens: number, truncated = 0): InjectionRecord =>
    ({ step, chars: tokens * 2, estTokens: tokens, truncated });

describe('summarizeInjection', () => {
    it('汇总总量与按步', () => {
        const summary = summarizeInjection([rec('body', 1000), rec('body', 500), rec('quality', 300, 1)]);
        expect(summary.totalTokens).toBe(1800);
        expect(summary.byStep.body).toBe(1500);
        expect(summary.truncated).toBe(1);
        expect(summary.records).toBe(3);
    });

    it('空记录', () => {
        expect(summarizeInjection([]).totalTokens).toBe(0);
    });
});

describe('compareMetrics', () => {
    it('下降时给出百分比与结论', () => {
        const comparison = compareMetrics([rec('body', 10000, 3)], [rec('body', 6000, 0)]);
        expect(comparison.tokenDelta).toBe(-4000);
        expect(comparison.tokenDeltaPercent).toBe(-40);
        expect(comparison.truncatedDelta).toBe(-3);
        expect(comparison.verdict).toContain('下降 40%');
        expect(comparison.verdict).toContain('截断减少 3 次');
    });

    it('上升时也如实报告', () => {
        const comparison = compareMetrics([rec('body', 1000)], [rec('body', 1500)]);
        expect(comparison.tokenDeltaPercent).toBe(50);
        expect(comparison.verdict).toContain('上升');
    });

    it('持平', () => {
        const comparison = compareMetrics([rec('body', 1000)], [rec('body', 1000)]);
        expect(comparison.tokenDeltaPercent).toBe(0);
        expect(comparison.verdict).toContain('持平');
    });

    it('改造前为空时百分比为 0', () => {
        expect(compareMetrics([], [rec('body', 100)]).tokenDeltaPercent).toBe(0);
    });
});

describe('renderMetricsReport', () => {
    it('无数据时明确说明', () => {
        expect(renderMetricsReport(compareMetrics([], []))).toContain('暂无注入账本数据');
    });

    it('渲染前后与按步对比', () => {
        const text = renderMetricsReport(compareMetrics([rec('body', 10000)], [rec('body', 6000), rec('quality', 1000)]));
        expect(text).toContain('改造前');
        expect(text).toContain('改造后');
        expect(text).toContain('按步骤');
        expect(text).toContain('quality');
    });
});
