import { describe, expect, it } from 'vitest';
import { deriveBaseline, detectRhythmDeviations, renderRhythmReport } from '@/shared/rhythm-baseline-model';
import type { SceneIntensity } from '@/shared/rhythm-baseline-model';

const scenes = (values: number[]): SceneIntensity[] => values.map((intensity, i) => ({ index: i + 1, intensity }));

describe('deriveBaseline', () => {
    it('基准随进度上升', () => {
        const baseline = deriveBaseline(scenes([20, 30, 40, 50, 60, 70]));
        expect(baseline.expected).toHaveLength(6);
        expect(baseline.expected[5]).toBeGreaterThan(baseline.expected[0]);
    });

    it('空/单场景安全', () => {
        expect(deriveBaseline([]).expected).toEqual([]);
        expect(deriveBaseline(scenes([50])).expected).toHaveLength(1);
    });
});

describe('detectRhythmDeviations', () => {
    it('平铺被识别', () => {
        const deviations = detectRhythmDeviations(scenes([50, 51, 52, 53]));
        expect(deviations.some(item => item.kind === 'flat')).toBe(true);
    });

    it('突增被识别', () => {
        const deviations = detectRhythmDeviations(scenes([30, 30, 30, 95]));
        expect(deviations.some(item => item.kind === 'spike')).toBe(true);
    });

    it('骤降被识别', () => {
        const deviations = detectRhythmDeviations(scenes([90, 90, 90, 10]));
        expect(deviations.some(item => item.kind === 'drop')).toBe(true);
    });

    it('单场景无偏离', () => {
        expect(detectRhythmDeviations(scenes([50]))).toEqual([]);
    });
});

describe('renderRhythmReport', () => {
    it('渲染曲线与判定', () => {
        const list = scenes([30, 60, 90]);
        const text = renderRhythmReport(list, detectRhythmDeviations(list));
        expect(text).toContain('节奏曲线');
        expect(text).toContain('场景1:30');
    });

    it('无偏离明确说明', () => {
        const list = scenes([40, 45, 50]);
        const text = renderRhythmReport(list, []);
        expect(text).toContain('无明显偏离');
    });

    it('空输入返回空串', () => {
        expect(renderRhythmReport([], [])).toBe('');
    });
});
