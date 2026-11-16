/**
 * 「下一步」推演测试（2026-11-16，D2 / H-03）
 *
 * 缺陷背景：右栏此前只有一行固定文案「下一步：xxx」，主操作按钮永远是「项目向导」，
 * 不随项目真实状态变化。现在按 shared/creation-flow 快照推演。
 */
import { describe, expect, it } from 'vitest';
import { buildNextStepPlan } from '../../../ui/full-writer/next-step';
import type { CreationFlowSnapshot, CreationFlowStageStatus } from '../../../shared/creation-flow';

function stage(overrides: Partial<CreationFlowStageStatus> & { id: string }): CreationFlowStageStatus {
    return {
        label: overrides.label ?? overrides.id,
        description: overrides.description ?? '',
        action: overrides.action ?? 'write-unit',
        weight: 0.25,
        state: overrides.state ?? 'todo',
        ratio: overrides.ratio ?? 0,
        progressText: overrides.progressText ?? '',
        ctaLabel: overrides.ctaLabel ?? '开始',
        primaryAction: overrides.primaryAction ?? 'write-unit',
        ...overrides,
    };
}

function snapshot(stages: CreationFlowStageStatus[], extra: Partial<CreationFlowSnapshot> = {}): CreationFlowSnapshot {
    return {
        mode: 'long',
        unitLabel: '章',
        project: '长篇小说/A',
        stages,
        overallRatio: 0.3,
        nextStageId: stages[0]?.id ?? '',
        nextUnitNumber: 3,
        ...extra,
    };
}

describe('buildNextStepPlan', () => {
    it('未完成向导 → 继续初始化', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'wizard', action: 'wizard', primaryAction: 'wizard', state: 'todo', label: '初始化与全书规划' }),
        ]));
        expect(plan?.title).toBe('完成初始化向导');
        expect(plan?.action).toBe('wizard');
        expect(plan?.allDone).toBe(false);
    });

    it('章节写作阶段 → 「继续写第 N 章」并带上单元号', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'chapters', state: 'active', progressText: '2/10' }),
        ], { nextUnitNumber: 3 }));
        expect(plan?.title).toBe('继续写第 3 章');
        expect(plan?.ctaLabel).toBe('继续写作');
        expect(plan?.unitNumber).toBe(3);
    });

    it('无骨架 → 批量建章', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'chapters', primaryAction: 'create-units', action: 'create-units' }),
        ]));
        expect(plan?.action).toBe('create-units');
        expect(plan?.ctaLabel).toBe('批量建章');
    });

    it('短篇单位标签正确带入文案', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'units', state: 'active' }),
        ], { mode: 'short', unitLabel: '节', nextUnitNumber: 2 }));
        expect(plan?.title).toBe('继续写第 2 节');
    });

    it('结算阶段 → 去结算', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'settlement', state: 'active', action: 'settle', primaryAction: 'settle' }),
        ]));
        expect(plan?.action).toBe('settle');
        expect(plan?.ctaLabel).toBe('去结算');
    });

    it('blocked 阶段回溯到依赖的可执行阶段', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'wizard', action: 'wizard', primaryAction: 'wizard', state: 'active' }),
            stage({
                id: 'chapters',
                state: 'blocked',
                blockedBy: 'wizard',
                blockedReason: '先完成初始化',
            }),
        ], { nextStageId: 'chapters' }));
        expect(plan?.stageId).toBe('wizard');
        expect(plan?.action).toBe('wizard');
    });

    it('blocked 依赖环不死循环', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'a', state: 'blocked', blockedBy: 'b' }),
            stage({ id: 'b', state: 'blocked', blockedBy: 'a' }),
        ], { nextStageId: 'a' }));
        expect(plan).not.toBeNull();
    });

    it('全部完成 → 导出收尾卡', () => {
        const plan = buildNextStepPlan(snapshot([
            stage({ id: 'export', state: 'done', action: 'export', primaryAction: 'export' }),
        ], { nextStageId: '', nextUnitNumber: null }));
        expect(plan?.allDone).toBe(true);
        expect(plan?.title).toBe('全部阶段已完成');
        expect(plan?.action).toBe('export');
        expect(plan?.percent).toBe(100);
    });

    it('空快照返回 null', () => {
        expect(buildNextStepPlan(null)).toBeNull();
        expect(buildNextStepPlan(snapshot([]))).toBeNull();
    });

    it('进度百分比按 overallRatio 换算并夹在 0-100', () => {
        expect(buildNextStepPlan(snapshot([stage({ id: 'x' })], { overallRatio: 0.456 }))?.percent).toBe(46);
        expect(buildNextStepPlan(snapshot([stage({ id: 'x' })], { overallRatio: 2 }))?.percent).toBe(100);
        expect(buildNextStepPlan(snapshot([stage({ id: 'x' })], { overallRatio: -1 }))?.percent).toBe(0);
    });
});
