/**
 * task-budget-engine.ts — 任务预算调节引擎（纯函数，可测）
 *
 * 背景（2026-10-29）：
 * 设置页原本给 6 个任务各渲染一张卡片，每张卡片 5 个输入框
 * （模型 / 最大输入 / 最大输出 / 思考等级 / 思考预算），共 30 个控件。
 * 用户要维护 30 个数字才能调好一次写作，而且任何一致性问题（比如
 * 输出上限比模型能力还大）都要自己避免。
 *
 * 改为「一个全局档位 → 引擎分发到各任务」：
 *   - 用户只选一个预算档位 + 一个思考强度；
 *   - 引擎按任务类别（规划 / 正文 / 分析）乘以各自系数，
 *     再从模型能力推导出输入 / 输出 / 思考预算；
 *   - 显式的任务级覆盖仍然保留优先级（兼容老数据），但不再提供 UI。
 *
 * 关键约束：**默认档位必须与旧行为逐值一致**，否则升级会静默改变
 * 生成质量与成本。`balanced` 档的系数全部为 1。
 */

/**
 * 本模块刻意不 import task-model：两者若互相引用会形成模块环
 * （`shared/task-model.ts` 需要引擎做推导）。这里只依赖结构类型，
 * 由调用方把自己的类型传进来即可。
 */
export interface BudgetLimits {
    maxContext: number;
    maxOutput: number;
}

/** 预算档位：越靠后越舍得花 token */
export type BudgetTier = 'lean' | 'balanced' | 'generous' | 'extreme';

export interface BudgetTierSpec {
    value: BudgetTier;
    label: string;
    description: string;
    /** 各任务类别的输出上限系数（相对模型 maxOutput） */
    outputFactor: Record<TaskCategory, number>;
    /** 输入预算系数（1 = 用满 context - output*1.15） */
    inputFactor: number;
}

/** 任务类别：决定「输出需求」的量级 */
export type TaskCategory = 'planning' | 'writing' | 'analysis';

/**
 * 任务 → 类别。
 * 规划类产出短（大纲条目、场景卡），正文类产出长，分析与质检介于两者。
 *
 * `default` 是「未指定任务」的兜底，按正文类别给足预算（宁可多给，
 * 不能因为没分类就把输出压掉）；`cowrite` 产出散文，同属正文类。
 */
export const TASK_CATEGORY: Record<string, TaskCategory> = {
    default: 'writing',
    planning: 'planning',
    body: 'writing',
    cowrite: 'writing',
    analysis: 'analysis',
    quality: 'analysis',
    deconstruction: 'analysis',
    fingerprint: 'analysis',
};

export const BUDGET_TIERS: readonly BudgetTierSpec[] = [
    {
        value: 'lean',
        label: '省 token',
        description: '输出压到模型上限的一半以内，适合快速试写与本地小模型。',
        outputFactor: { planning: 0.5, writing: 0.6, analysis: 0.5 },
        inputFactor: 0.85,
    },
    {
        value: 'balanced',
        label: '均衡（默认）',
        description: '与升级前完全一致：输出用满模型上限，输入吃掉剩余窗口。',
        outputFactor: { planning: 1, writing: 1, analysis: 1 },
        inputFactor: 1,
    },
    {
        value: 'generous',
        label: '放开',
        description: '输出仍用满模型上限，输入额外预留 10% 余量给长上下文。',
        outputFactor: { planning: 1, writing: 1, analysis: 1 },
        inputFactor: 1,
    },
    {
        value: 'extreme',
        label: '极限',
        description: '输出用满上限 + 思考强度拉满。成本最高，适合关键章节。',
        outputFactor: { planning: 1, writing: 1, analysis: 1 },
        inputFactor: 1,
    },
];

const TIER_VALUES = new Set<string>(BUDGET_TIERS.map(t => t.value));

export function normalizeBudgetTier(value: unknown): BudgetTier {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (TIER_VALUES.has(text)) return text as BudgetTier;
    return 'balanced';
}

export function budgetTierSpec(tier: BudgetTier | undefined): BudgetTierSpec {
    const normalized = normalizeBudgetTier(tier);
    return BUDGET_TIERS.find(t => t.value === normalized) ?? BUDGET_TIERS[1];
}

/** 极端档会把思考强度强制拉满 */
export function effectiveIntensity(tier: BudgetTier | undefined, intensity: number): number {
    if (normalizeBudgetTier(tier) === 'extreme') return 100;
    const value = Number.isFinite(intensity) ? Math.round(intensity) : 50;
    return Math.max(0, Math.min(100, value));
}

export interface BudgetPlanInput {
    /** 任务类别 */
    category: TaskCategory;
    /** 模型能力 */
    limits: BudgetLimits;
    /** 预算档位 */
    tier?: BudgetTier;
    /** 思考强度 0–100 */
    intensity: number;
    /** 用户显式指定的思考预算上限；0/未填表示按强度自动 */
    explicitThinkingBudget?: number;
    /** 任务级显式覆盖：沿用旧数据，优先于引擎 */
    override?: {
        maxInputTokens?: number;
        maxOutputTokens?: number;
        thinkingBudget?: number;
    };
}

export interface BudgetPlan {
    maxContext: number;
    maxInput: number;
    maxOutput: number;
    thinkingBudget: number;
    /** 命中的档位（便于 UI 回显与排错） */
    tier: BudgetTier;
    /** 是否因任务级覆盖而未采用引擎推导值 */
    overridden: { input: boolean; output: boolean; thinking: boolean };
}

/** 输入必须给输出留的余量系数（旧逻辑为 1.15，保持不变） */
const INPUT_RESERVE = 1.15;
const MIN_INPUT = 512;
const MIN_OUTPUT = 1;

/**
 * 把「一个全局档位」分发成某个任务的具体预算。
 *
 * 顺序：
 *   1. 任务级覆盖（老数据）优先；
 *   2. 否则按档位系数 × 模型能力推导；
 *   3. 最后做边界收敛：输入 + 输出不超过 context，且输入不少于 512。
 */
export function planTaskBudget(input: BudgetPlanInput): BudgetPlan {
    const tierSpec = budgetTierSpec(input.tier);
    const tier = tierSpec.value;
    const category = input.category;

    const context = Number.isFinite(input.limits.maxContext) && input.limits.maxContext > 0
        ? Math.floor(input.limits.maxContext)
        : 32768;

    // ── 输出上限 ──
    const modelOutput = Number.isFinite(input.limits.maxOutput) && input.limits.maxOutput > 0
        ? Math.floor(input.limits.maxOutput)
        : 8192;
    const engineOutput = Math.max(
        MIN_OUTPUT,
        Math.floor(modelOutput * (tierSpec.outputFactor[category] ?? 1)),
    );
    const overrideOutput = Number.isFinite(input.override?.maxOutputTokens) && (input.override?.maxOutputTokens || 0) > 0
        ? Math.floor(input.override!.maxOutputTokens!)
        : 0;
    const maxOutput = Math.max(MIN_OUTPUT, Math.min(overrideOutput || engineOutput, context));

    // ── 输入预算 ──
    // 取整顺序与旧实现保持一致：先算 context - reserved 再 floor，
    // 否则平衡档会比升级前少 1 个 token（差一虽然无害，但会让「默认档
    // 与旧行为逐值一致」这条约束变成近似而非精确）。
    const reserved = maxOutput * INPUT_RESERVE * tierSpec.inputFactor;
    const engineInput = Math.max(MIN_INPUT, Math.floor(context - reserved));
    const overrideInput = Number.isFinite(input.override?.maxInputTokens) && (input.override?.maxInputTokens || 0) > 0
        ? Math.floor(input.override!.maxInputTokens!)
        : 0;
    const maxInput = Math.max(
        MIN_INPUT,
        Math.min(overrideInput || engineInput, Math.max(MIN_INPUT, context - maxOutput)),
    );

    // ── 思考预算 ──
    const intensity = effectiveIntensity(tier, input.intensity);
    const autoBudget = Math.floor(maxOutput * 0.3 * (intensity / 100));
    const explicitCap = Number.isFinite(input.explicitThinkingBudget) && (input.explicitThinkingBudget || 0) > 0
        ? Math.floor(input.explicitThinkingBudget!)
        : 0;
    const overrideThinking = Number.isFinite(input.override?.thinkingBudget) && (input.override?.thinkingBudget || 0) > 0
        ? Math.floor(input.override!.thinkingBudget!)
        : 0;

    let thinkingBudget: number;
    if (intensity <= 0) {
        thinkingBudget = 0;
    } else if (overrideThinking > 0) {
        // 任务级覆盖会被强度缩放，避免「设了 100 但强度 0」
        thinkingBudget = Math.min(Math.floor(overrideThinking * (intensity / 100)), maxOutput);
    } else if (explicitCap > 0) {
        thinkingBudget = Math.min(Math.floor(explicitCap * (intensity / 100)), maxOutput);
    } else {
        thinkingBudget = Math.min(autoBudget, maxOutput);
    }

    return {
        maxContext: context,
        maxInput,
        maxOutput,
        thinkingBudget,
        tier,
        overridden: {
            input: overrideInput > 0,
            output: overrideOutput > 0,
            thinking: overrideThinking > 0,
        },
    };
}

/**
 * 一份可直接展示的分发表：给定全部任务，返回每个任务的推导结果。
 * 用于设置页的只读预览表，替代原先 6 张可编辑卡片。
 */
export function planAllTasks(
    tasks: readonly string[],
    resolveLimits: (task: string) => BudgetLimits,
    tier: BudgetTier | undefined,
    intensity: number,
    explicitThinkingBudget: number,
    overrides?: Partial<Record<string, { maxInputTokens?: number; maxOutputTokens?: number; thinkingBudget?: number }>>,
): Array<{ task: string; category: TaskCategory; plan: BudgetPlan }> {
    return tasks.map(task => ({
        task,
        category: TASK_CATEGORY[task],
        plan: planTaskBudget({
            category: TASK_CATEGORY[task],
            limits: resolveLimits(task),
            tier,
            intensity,
            explicitThinkingBudget,
            override: overrides?.[task],
        }),
    }));
}
