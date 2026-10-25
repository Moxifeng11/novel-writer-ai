import { describe, expect, it } from 'vitest';
import {
    BODY_DOWNSTREAM_STEP_KEYS,
    calcStepIndexAfterPlanning,
    downstreamStepsAfterPlanningChange,
} from '../../../engine/planning-step-advance';

describe('downstreamStepsAfterPlanningChange', () => {
    it('规划步骤变更且正文已存在时，正文与全部下游失效', () => {
        for (const key of ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand']) {
            expect(downstreamStepsAfterPlanningChange(key, true)).toEqual([...BODY_DOWNSTREAM_STEP_KEYS]);
        }
    });

    it('正文尚未生成时不做任何失效，避免把未写的正文标成待重做', () => {
        expect(downstreamStepsAfterPlanningChange('outline', false)).toEqual([]);
        expect(downstreamStepsAfterPlanningChange('sceneExpand', false)).toEqual([]);
    });

    it('非规划步骤不触发规划失效', () => {
        expect(downstreamStepsAfterPlanningChange('bodyGeneration', true)).toEqual([]);
        expect(downstreamStepsAfterPlanningChange('qualityControl', true)).toEqual([]);
        expect(downstreamStepsAfterPlanningChange('settlement', true)).toEqual([]);
    });

    it('返回值是副本，调用方修改不会污染常量', () => {
        const steps = downstreamStepsAfterPlanningChange('outline', true);
        steps.pop();
        expect(downstreamStepsAfterPlanningChange('outline', true)).toHaveLength(4);
    });
});

describe('calcStepIndexAfterPlanning', () => {
    it('5 个规划步骤全部完成时推进到正文写作', () => {
        const done = new Set(['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand']);
        expect(calcStepIndexAfterPlanning(done)).toBe(7);
    });

    it('仍有缺失时停留在第一个缺失的规划步骤', () => {
        const done = new Set(['infoPlan', 'plotDistill']);
        // outline 是第 4 个步骤（index 4）
        expect(calcStepIndexAfterPlanning(done)).toBe(4);
    });
});
