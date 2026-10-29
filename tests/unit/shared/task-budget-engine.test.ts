import { describe, it, expect } from 'vitest';
import {
    BUDGET_TIERS,
    budgetTierSpec,
    effectiveIntensity,
    normalizeBudgetTier,
    planAllTasks,
    planTaskBudget,
    TASK_CATEGORY,
} from '../../../shared/task-budget-engine';

const LIMITS = { maxContext: 1_000_000, maxOutput: 65_536 };

describe('预算档位', () => {
    it('未知档位回落到均衡', () => {
        expect(normalizeBudgetTier('weird')).toBe('balanced');
        expect(normalizeBudgetTier(undefined)).toBe('balanced');
        expect(normalizeBudgetTier('EXTREME')).toBe('extreme');
    });

    it('档位表覆盖四档且都有说明', () => {
        expect(BUDGET_TIERS.map(t => t.value)).toEqual(['lean', 'balanced', 'generous', 'extreme']);
        for (const tier of BUDGET_TIERS) {
            expect(tier.label.length).toBeGreaterThan(0);
            expect(tier.description.length).toBeGreaterThan(0);
        }
    });

    it('极限档把思考强度锁到 100', () => {
        expect(effectiveIntensity('extreme', 10)).toBe(100);
        expect(effectiveIntensity('balanced', 10)).toBe(10);
        expect(effectiveIntensity('balanced', 300)).toBe(100);
        expect(effectiveIntensity('balanced', -5)).toBe(0);
    });
});

describe('任务分类', () => {
    it('规划/正文/分析三类映射正确', () => {
        expect(TASK_CATEGORY.planning).toBe('planning');
        expect(TASK_CATEGORY.body).toBe('writing');
        expect(TASK_CATEGORY.quality).toBe('analysis');
        expect(TASK_CATEGORY.deconstruction).toBe('analysis');
        expect(TASK_CATEGORY.fingerprint).toBe('analysis');
    });
});

describe('planTaskBudget — 默认档必须与旧行为一致', () => {
    it('均衡档：输出用满模型上限', () => {
        const plan = planTaskBudget({ category: 'planning', limits: LIMITS, tier: 'balanced', intensity: 50 });
        expect(plan.maxOutput).toBe(LIMITS.maxOutput);
    });

    it('均衡档：输入 = context - output*1.15（不低于 512）', () => {
        const plan = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'balanced', intensity: 50 });
        expect(plan.maxInput).toBe(Math.max(512, Math.floor(LIMITS.maxContext - LIMITS.maxOutput * 1.15)));
    });

    it('均衡档：输入 + 输出不超过上下文', () => {
        for (const category of ['planning', 'writing', 'analysis'] as const) {
            const plan = planTaskBudget({ category, limits: LIMITS, tier: 'balanced', intensity: 50 });
            expect(plan.maxInput + plan.maxOutput).toBeLessThanOrEqual(plan.maxContext);
        }
    });

    it('小模型也不塌成 0', () => {
        const plan = planTaskBudget({
            category: 'planning',
            limits: { maxContext: 8192, maxOutput: 4096 },
            tier: 'balanced',
            intensity: 50,
        });
        expect(plan.maxOutput).toBe(4096);
        expect(plan.maxInput).toBeGreaterThanOrEqual(512);
        expect(plan.maxInput + plan.maxOutput).toBeLessThanOrEqual(8192);
    });
});

describe('planTaskBudget — 档位分发', () => {
    it('省 token 档按类别压缩输出（正文扣得比规划少）', () => {
        const planning = planTaskBudget({ category: 'planning', limits: LIMITS, tier: 'lean', intensity: 50 });
        const writing = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'lean', intensity: 50 });
        expect(planning.maxOutput).toBeLessThan(LIMITS.maxOutput);
        expect(writing.maxOutput).toBeLessThan(LIMITS.maxOutput);
        // 正文输出需求更大，扣得更少
        expect(writing.maxOutput).toBeGreaterThan(planning.maxOutput);
    });

    it('省 token 档把腾出的窗口给输入', () => {
        const lean = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'lean', intensity: 50 });
        const balanced = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'balanced', intensity: 50 });
        expect(lean.maxOutput).toBeLessThan(balanced.maxOutput);
        expect(lean.maxInput).toBeGreaterThanOrEqual(balanced.maxInput);
    });

    it('档位越大输出不小幅缩水（单调）', () => {
        const lean = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'lean', intensity: 50 });
        const generous = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'generous', intensity: 50 });
        expect(generous.maxOutput).toBeGreaterThanOrEqual(lean.maxOutput);
    });

    it('未知档位按均衡处理', () => {
        const unknown = planTaskBudget({
            category: 'body' as never as 'writing',
            limits: LIMITS,
            tier: 'nope' as never,
            intensity: 50,
        });
        expect(unknown.tier).toBe('balanced');
        expect(unknown.maxOutput).toBe(LIMITS.maxOutput);
    });
});

describe('planTaskBudget — 思考预算', () => {
    it('强度 0 不预留思考预算', () => {
        const plan = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'balanced', intensity: 0 });
        expect(plan.thinkingBudget).toBe(0);
    });

    it('强度越高思考预算越大', () => {
        const low = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'balanced', intensity: 25 });
        const high = planTaskBudget({ category: 'writing', limits: LIMITS, tier: 'balanced', intensity: 90 });
        expect(high.thinkingBudget).toBeGreaterThan(low.thinkingBudget);
    });

    it('思考预算不超过输出上限', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: { maxContext: 8192, maxOutput: 1024 },
            tier: 'balanced',
            intensity: 100,
        });
        expect(plan.thinkingBudget).toBeLessThanOrEqual(plan.maxOutput);
    });

    it('全局上限按强度缩放，不是直接取用', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: LIMITS,
            tier: 'balanced',
            intensity: 50,
            explicitThinkingBudget: 10_000,
        });
        expect(plan.thinkingBudget).toBe(5000);
    });
});

describe('planTaskBudget — 任务级覆盖仍优先', () => {
    it('覆盖的输出上限优先于档位推导', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: LIMITS,
            tier: 'lean',
            intensity: 50,
            override: { maxOutputTokens: 12_345 },
        });
        expect(plan.maxOutput).toBe(12_345);
        expect(plan.overridden.output).toBe(true);
    });

    it('覆盖的输入预算优先，但仍受上下文约束', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: { maxContext: 10_000, maxOutput: 2000 },
            tier: 'balanced',
            intensity: 50,
            override: { maxInputTokens: 999_999 },
        });
        expect(plan.maxInput).toBeLessThanOrEqual(10_000 - 2000);
    });

    it('覆盖的思考预算按强度缩放', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: LIMITS,
            tier: 'balanced',
            intensity: 40,
            override: { thinkingBudget: 8000 },
        });
        expect(plan.thinkingBudget).toBe(3200);
        expect(plan.overridden.thinking).toBe(true);
    });

    it('非法覆盖值被忽略', () => {
        const plan = planTaskBudget({
            category: 'writing',
            limits: LIMITS,
            tier: 'balanced',
            intensity: 50,
            override: { maxOutputTokens: -5, maxInputTokens: 0 },
        });
        expect(plan.maxOutput).toBe(LIMITS.maxOutput);
        expect(plan.overridden.output).toBe(false);
        expect(plan.overridden.input).toBe(false);
    });
});

describe('planAllTasks — 分发表', () => {
    it('每个任务给出类别与计划', () => {
        const rows = planAllTasks(
            ['planning', 'body', 'analysis'],
            () => LIMITS,
            'balanced',
            50,
            0,
        );
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ task: 'planning', category: 'planning' });
        expect(rows[1]).toMatchObject({ task: 'body', category: 'writing' });
        for (const row of rows) {
            expect(row.plan.maxInput).toBeGreaterThan(0);
            expect(row.plan.maxOutput).toBeGreaterThan(0);
        }
    });

    it('可传入不同模型的限制（规划用 flash、正文用 pro）', () => {
        const rows = planAllTasks(
            ['planning', 'body'],
            (task) => (task === 'planning' ? { maxContext: 8192, maxOutput: 4096 } : LIMITS),
            'balanced',
            50,
            0,
        );
        expect(rows[0].plan.maxContext).toBe(8192);
        expect(rows[1].plan.maxContext).toBe(1_000_000);
    });

    it('任务级覆盖表生效', () => {
        const rows = planAllTasks(
            ['planning', 'body'],
            () => LIMITS,
            'lean',
            50,
            0,
            { body: { maxOutputTokens: 999 } },
        );
        const body = rows.find(r => r.task === 'body')!;
        expect(body.plan.maxOutput).toBe(999);
        expect(body.plan.overridden.output).toBe(true);
    });

    it('budgetTierSpec 对未知值给均衡', () => {
        expect(budgetTierSpec(undefined).value).toBe('balanced');
        expect(budgetTierSpec('lean' as never).value).toBe('lean');
    });
});
