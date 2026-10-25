import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { ALL_FULL_STEPS } from '../../../engine/step-definitions';
import {
    getStreamlinedPhases,
    mapStreamlinedPhaseToStepIndex,
} from '../../../ui/full-writer/streamlined-nav-presenter';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';

describe('阶段表与步骤定义一致性', () => {
    it('阶段表必须覆盖全部步骤，且 index 与 ALL_FULL_STEPS 一一对应', () => {
        const phases = getStreamlinedPhases();
        const covered = phases.flatMap(p => p.stepIndexes).sort((a, b) => a - b);
        const allIndexes = ALL_FULL_STEPS.map(s => s.index).sort((a, b) => a - b);
        expect(covered).toEqual(allIndexes);
    });

    it('每个阶段内的 index 顺序与 steps 顺序一致', () => {
        for (const phase of getStreamlinedPhases()) {
            expect(phase.steps.length).toBe(phase.stepIndexes.length);
            phase.stepIndexes.forEach((idx, i) => {
                const step = ALL_FULL_STEPS.find(s => s.index === idx);
                expect(step, `index ${idx} 不存在于 ALL_FULL_STEPS`).toBeTruthy();
                const expectedKey = idx === 0 ? 'context' : idx === 10 ? 'settlement' : step!.key;
                expect(phase.steps[i]).toBe(expectedKey);
            });
        }
    });
});

describe('mapStreamlinedPhaseToStepIndex — 定位第一个未完成步骤', () => {
    it('规划阶段：infoPlan 已完成 → 定位到 plotDistill', () => {
        expect(mapStreamlinedPhaseToStepIndex('planning', new Set(['infoPlan']))).toBe(2);
    });

    it('规划阶段：全部完成 → 停留在最后一个规划步骤', () => {
        const done = new Set(['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand']);
        expect(mapStreamlinedPhaseToStepIndex('planning', done)).toBe(6);
    });

    it('审查阶段：质量控制完成、分析未完成 → 定位到 analysisReport', () => {
        expect(mapStreamlinedPhaseToStepIndex('review', new Set(['qualityControl']))).toBe(9);
    });

    it('上下文阶段固定回到起点', () => {
        expect(mapStreamlinedPhaseToStepIndex('context', new Set(['context']))).toBe(0);
    });
});

describe('ChapterStateManager.invalidateSteps', () => {
    const make = () => new ChapterStateManager({} as App);

    it('completed / levels / stale 三者同步', () => {
        const mgr = make();
        mgr.stepCompleted.add('qualityControl');
        mgr.stepLevels['qualityControl'] = 'complete';

        mgr.invalidateSteps(['qualityControl']);

        expect(mgr.stepCompleted.has('qualityControl')).toBe(false);
        expect(mgr.stepLevels['qualityControl']).toBe('partial');
        expect(mgr.staleSteps.has('qualityControl')).toBe(true);
    });

    it('markStale=false 时只清完成态，不标脏', () => {
        const mgr = make();
        mgr.stepCompleted.add('analysisReport');
        mgr.stepLevels['analysisReport'] = 'complete';

        mgr.invalidateSteps(['analysisReport'], false);

        expect(mgr.stepCompleted.has('analysisReport')).toBe(false);
        expect(mgr.staleSteps.has('analysisReport')).toBe(false);
    });

    it('未完成的步骤被失效时不产生虚假的 partial', () => {
        const mgr = make();
        mgr.stepLevels['settlement'] = 'empty';

        mgr.invalidateSteps(['settlement']);

        expect(mgr.stepLevels['settlement']).toBe('empty');
        expect(mgr.staleSteps.has('settlement')).toBe(true);
    });
});
