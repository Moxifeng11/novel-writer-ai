/**
 * divergence-trend.test.ts — 「偏离度持续上升」必须同时满足数值上升与时间跨度
 *
 * 面板 B 每 500ms 就可能评估一次，历史按评估次数记录；只比较最近 3 次数值
 * 会把几秒内的三次编辑判成「连续多章上升」，并触发 24 小时冷却。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DIVERGENCE_RISING_MIN_WINDOW_MS } from '../../../shared/thresholds';
import { isRisingDivergence } from '../../../shared/divergence-trend';
import { PlotDivergenceEngine } from '../../../engine/plot-divergence-engine';

const T0 = 1_700_000_000_000;

describe('isRisingDivergence — 纯函数', () => {
    it('三次评估在几秒内完成时不算持续上升', () => {
        const samples = [
            { value: 25, at: T0 },
            { value: 35, at: T0 + 10_000 },
            { value: 45, at: T0 + 20_000 },
        ];
        expect(isRisingDivergence(samples, T0 + 20_000)).toBe(false);
    });

    it('三次评估跨过最小时间窗且连续上升时判定为持续上升', () => {
        const samples = [
            { value: 25, at: T0 },
            { value: 35, at: T0 + 60_000 },
            { value: 45, at: T0 + DIVERGENCE_RISING_MIN_WINDOW_MS },
        ];
        expect(isRisingDivergence(samples, T0 + DIVERGENCE_RISING_MIN_WINDOW_MS)).toBe(true);
    });

    it('跨度差 1ms 未达门槛时不算', () => {
        const samples = [
            { value: 25, at: T0 },
            { value: 35, at: T0 + 60_000 },
            { value: 45, at: T0 + DIVERGENCE_RISING_MIN_WINDOW_MS - 1 },
        ];
        expect(isRisingDivergence(samples, T0 + DIVERGENCE_RISING_MIN_WINDOW_MS - 1)).toBe(false);
    });

    it('样本不足三条时不算', () => {
        expect(isRisingDivergence([{ value: 1, at: T0 }, { value: 90, at: T0 }], T0 + 600_000)).toBe(false);
    });

    it('涨幅不超过 5 时不算', () => {
        const samples = [
            { value: 30, at: T0 },
            { value: 33, at: T0 + 60_000 },
            { value: 36, at: T0 + DIVERGENCE_RISING_MIN_WINDOW_MS },
        ];
        expect(isRisingDivergence(samples, T0 + DIVERGENCE_RISING_MIN_WINDOW_MS)).toBe(false);
    });
});

describe('PlotDivergenceEngine — 持续上升告警接线', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const dimensions = {
        mainlineDivergence: { score: 0, issues: [] as string[] },
        characterDivergence: { score: 0, issues: [] as string[] },
        rhythmDivergence: { score: 0, issues: [] as string[] },
        foreshadowDivergence: { score: 0, issues: [] as string[] },
        settingDivergence: { score: 0, issues: [] as string[] },
    };

    function makeEngineWithHistory(values: number[], ats: number[]): {
        check: (now: number) => { shouldAlert: boolean; alertReason?: string };
    } {
        const engine = new PlotDivergenceEngine();
        const raw = engine as unknown as {
            divergenceHistory: number[];
            divergenceHistoryAt: number[];
            checkShouldAlert: (
                overallDivergence: number,
                overallLevel: string,
                dims: typeof dimensions,
            ) => { shouldAlert: boolean; alertReason?: string };
        };
        raw.divergenceHistory = [...values];
        raw.divergenceHistoryAt = [...ats];
        return {
            check: (now: number) => {
                vi.useFakeTimers();
                vi.setSystemTime(now);
                return raw.checkShouldAlert(values[values.length - 1], 'warning', dimensions);
            },
        };
    }

    it('三次数值上升但只隔 20 秒 → 不告警', () => {
        const { check } = makeEngineWithHistory([25, 35, 45], [T0, T0 + 10_000, T0 + 20_000]);
        const result = check(T0 + 20_000);
        expect(result.shouldAlert).toBe(false);
    });

    it('跨过最小时间窗后 → 告警文案不再声称「多章」', () => {
        const { check } = makeEngineWithHistory(
            [25, 35, 45],
            [T0, T0 + 60_000, T0 + DIVERGENCE_RISING_MIN_WINDOW_MS],
        );
        const result = check(T0 + DIVERGENCE_RISING_MIN_WINDOW_MS);
        expect(result.shouldAlert).toBe(true);
        expect(result.alertReason).toContain('持续上升');
        expect(result.alertReason).not.toContain('多章');
    });
});
