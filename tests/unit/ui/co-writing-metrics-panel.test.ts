import { describe, it, expect } from 'vitest';
import { computeMetricsRenderState } from '../../../ui/co-writing/metrics-panel';
import type { PlotCompletionMetrics } from '../../../shared/types';

/**
 * 指标面板三态（评估中/失败/内容不足）决定提示文案与重试入口是否出现，
 * 这里只测纯判定，DOM 渲染由视图既有链路覆盖。
 */
function makeMetrics(partial: Partial<PlotCompletionMetrics> = {}): PlotCompletionMetrics {
    return {
        sceneObjectivesMet: 0,
        characterArcsAdvanced: 0,
        foreshadowingSeeded: 0,
        emotionalArcProgress: 0,
        overallCompletion: 0,
        ...partial,
    } as PlotCompletionMetrics;
}

describe('co-writing metrics-panel 三态判定', () => {
    it('空正文且无指标时判定内容不足', () => {
        expect(computeMetricsRenderState(makeMetrics(), 0, 'idle')).toEqual({
            isEvaluating: false,
            isError: false,
            isInsufficient: true,
        });
    });

    it('正文达到 50 字后不再提示内容不足', () => {
        expect(computeMetricsRenderState(makeMetrics(), 50, 'idle').isInsufficient).toBe(false);
    });

    it('已有任一指标时不算内容不足', () => {
        expect(computeMetricsRenderState(makeMetrics({ emotionalArcProgress: 1 }), 10, 'idle').isInsufficient).toBe(false);
    });

    it('评估中与失败状态独立透传', () => {
        expect(computeMetricsRenderState(makeMetrics(), 0, 'evaluating').isEvaluating).toBe(true);
        expect(computeMetricsRenderState(makeMetrics(), 0, 'error').isError).toBe(true);
    });
});
