import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { BODY_CHANGE_INVALIDATED_STEPS } from '../../../engine/step-definitions';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';

describe('A7 正文变更的失效传播口径', () => {
    it('必须覆盖审查 / 分析 / 结算三个下游', () => {
        expect(BODY_CHANGE_INVALIDATED_STEPS).toEqual(
            expect.arrayContaining(['qualityControl', 'analysisReport', 'settlement']),
        );
    });

    it('按该列表失效后，completed / levels / stale 三者同步', () => {
        const mgr = new ChapterStateManager({} as App);
        for (const key of BODY_CHANGE_INVALIDATED_STEPS) {
            mgr.stepCompleted.add(key);
            mgr.stepLevels[key] = 'complete';
        }

        mgr.invalidateSteps([...BODY_CHANGE_INVALIDATED_STEPS]);

        for (const key of BODY_CHANGE_INVALIDATED_STEPS) {
            expect(mgr.stepCompleted.has(key)).toBe(false);
            expect(mgr.stepLevels[key]).toBe('partial');
            expect(mgr.staleSteps.has(key)).toBe(true);
        }
    });
});
