import { describe, expect, it, vi } from 'vitest';
import {
    ChapterOrchestrator,
    buildChapterRunPlan,
    countRemainingChapterActions,
    type ChapterOrchestratorDeps,
} from '../../../ui/full-writer/chapter-orchestrator';
import type { ChapterStateManager } from '../../../ui/states/chapter-state-manager';

const PLANNING = ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand'];

function completed(keys: string[] = []): Set<string> {
    return new Set(['context', ...keys]);
}

describe('buildChapterRunPlan — 一键编排决策', () => {
    it('推荐模式全缺规划：合并规划 1 次 + 正文/质量/分析 = 4 次 AI', () => {
        const plan = buildChapterRunPlan(completed(), '', '', { mode: 'recommended' });
        expect(plan.useCombinedPlanning).toBe(true);
        expect(plan.missingPlanning).toEqual(PLANNING);
        expect(plan.aiCalls).toBe(4);
        expect(plan.plannedActions).toBe(4);
        expect(plan.runSettlement).toBe(false);
    });

    it('部分规划缺失：只补缺失步骤，不合并', () => {
        const plan = buildChapterRunPlan(completed(['infoPlan', 'outline']), '', '', { mode: 'recommended' });
        expect(plan.useCombinedPlanning).toBe(false);
        expect(plan.missingPlanning).toEqual(['plotDistill', 'emotionPlan', 'sceneExpand']);
        expect(plan.aiCalls).toBe(6); // 3 规划 + 正文 + 质量 + 分析
    });

    it('正文已结算 / 分析无指令时不重复结算', () => {
        const plan = buildChapterRunPlan(
            completed([...PLANNING, 'bodyGeneration', 'qualityControl', 'analysisReport']),
            '---\nstatus: settled\n---\n# 第1章\n',
            '普通报告',
        );
        expect(plan.runSettlement).toBe(false);
        expect(plan.aiCalls).toBe(0);
    });

    it('分析含指令且正文未结算时才结算', () => {
        const plan = buildChapterRunPlan(
            completed([...PLANNING, 'bodyGeneration', 'qualityControl', 'analysisReport']),
            '---\nstatus: written\n---\n# 第1章\n',
            'UPDATE_CHARACTER: [[甲]] | 状态 | 受伤',
        );
        expect(plan.runSettlement).toBe(true);
        expect(plan.aiCalls).toBe(0);
    });

    it('countRemainingChapterActions 与 plan 一致', () => {
        expect(countRemainingChapterActions(completed(), '', '')).toBe(4);
    });
});

function makeHarness() {
    const state = {
        stepCompleted: completed(),
        stepResults: {} as Record<string, string>,
        currentStepIndex: 1,
    } as unknown as ChapterStateManager;

    const stepRunner = {
        executePlanningCombined: vi.fn(async () => {
            for (const key of PLANNING) {
                state.stepCompleted.add(key);
                state.stepResults[key] = `${key} content`;
            }
            return { success: true };
        }),
        executeStepsSequential: vi.fn(async (keys: string[]) => {
            for (const key of keys) {
                state.stepCompleted.add(key);
                state.stepResults[key] = key === 'analysisReport'
                    ? 'UPDATE_CHARACTER: [[甲]] | 状态 | 受伤'
                    : `${key} content`;
            }
        }),
    };

    const settle = vi.fn(async () => {
        state.stepCompleted.add('settlement');
    });

    const deps: ChapterOrchestratorDeps = {
        stepRunner: stepRunner as never,
        state,
        makeCtx: () => ({
            setCurrentStepIndex: (v: number) => { state.currentStepIndex = v; },
            getAbortController: () => null,
        } as never),
        loadContext: vi.fn(async () => { state.stepCompleted.add('context'); }),
        render: vi.fn(async () => {}),
        getTabContent: () => ({}) as HTMLElement,
        settle,
        showNotice: vi.fn(),
        showError: vi.fn(),
        showSuccess: vi.fn(),
    };
    return { state, stepRunner, settle, deps };
}

describe('ChapterOrchestrator — 推荐模式', () => {
    it('一次运行完成 5 规划 + 正文 + 质量 + 分析 + 结算，共 4 次 AI', async () => {
        const h = makeHarness();
        const orchestrator = new ChapterOrchestrator(h.deps);

        const result = await orchestrator.run({ mode: 'recommended' });

        expect(result.status).toBe('completed');
        expect(result.aiCalls).toBe(4);
        expect(h.stepRunner.executePlanningCombined).toHaveBeenCalledTimes(1);
        expect(h.stepRunner.executeStepsSequential).toHaveBeenCalledTimes(3); // body / quality / analysis
        expect(h.settle).toHaveBeenCalledTimes(1);
        for (const key of [...PLANNING, 'bodyGeneration', 'qualityControl', 'analysisReport', 'settlement']) {
            expect(h.state.stepCompleted.has(key), key).toBe(true);
        }
    });

    it('逐步模式不调用合并规划，规划 5 次 + 正文/质量/分析 = 8 次 AI', async () => {
        const h = makeHarness();
        const orchestrator = new ChapterOrchestrator(h.deps);

        const result = await orchestrator.run({ mode: 'step' });

        expect(result.status).toBe('completed');
        expect(result.aiCalls).toBe(8);
        expect(h.stepRunner.executePlanningCombined).not.toHaveBeenCalled();
        expect(h.stepRunner.executeStepsSequential).toHaveBeenCalledTimes(8);
    });

    it('某步失败时停在失败步骤，不继续正文/结算', async () => {
        const h = makeHarness();
        h.stepRunner.executeStepsSequential.mockImplementation(async (keys: string[]) => {
            if (keys.includes('bodyGeneration')) throw new Error('body failed');
            for (const key of keys) h.state.stepCompleted.add(key);
        });
        const orchestrator = new ChapterOrchestrator(h.deps);

        const result = await orchestrator.run({ mode: 'recommended' });

        expect(result.status).toBe('failed');
        expect(result.failedStep).toBe('bodyGeneration');
        expect(h.settle).not.toHaveBeenCalled();
        expect(h.state.stepCompleted.has('qualityControl')).toBe(false);
    });
});
