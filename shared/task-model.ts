/**
 * task-model.ts — 任务级模型与预算解析
 *
 * 背景：旧实现把 maxContext/maxOutput 存成全局单值，任何一次「选择模型」
 * 都会改写它，而 StepRunner 又无条件读取全局值。结果是 Flash 的 4K 输出
 * 上限会截断正文，Pro 的 131K 上限又会被规划任务继承。
 *
 * 本模块把「任务 → 模型 → 能力上限」拆成纯函数，调用方只需要传入
 * settings 与 resolveLimits，即可得到该任务真正应使用的模型和预算。
 */

import { resolveProviderSourceType } from './model-source';

import { planTaskBudget, TASK_CATEGORY, type BudgetTier } from './task-budget-engine';

/**
 * AI 任务类型。
 */
export type AiTask =
    | 'default'
    | 'planning'
    | 'body'
    | 'analysis'
    | 'quality'
    | 'deconstruction'
    | 'fingerprint'
    | 'cowrite';

/**
 * 思考模式。
 */
export type ThinkingMode = 'off' | 'auto' | 'on';

/** 四级思考能力：极速 / 标准 / 深度 / 极限 */
export type ThinkingLevel = 'fast' | 'standard' | 'deep' | 'max';

/**
 * 思考等级规格。
 */
export interface ThinkingLevelSpec {
    level: ThinkingLevel;
    label: string;
    percent: number;
    mode: ThinkingMode;
    description: string;
}

/**
 * 思考等级表。
 */
export const THINKING_LEVELS: ThinkingLevelSpec[] = [
    { level: 'fast', label: '极速', percent: 0, mode: 'off', description: '关闭思考，最低延迟与成本；适合快速草稿、格式整理。' },
    { level: 'standard', label: '标准', percent: 35, mode: 'auto', description: '由供应商决定是否思考，默认强度；适合大多数规划与正文。' },
    { level: 'deep', label: '深度', percent: 70, mode: 'on', description: '显式开启思考，适合复杂情节、长文推理与质量检查。' },
    { level: 'max', label: '极限', percent: 100, mode: 'on', description: '最大思考预算，适合高难推理；延迟与费用最高。' },
];

/**
 * 夹取思考强度。
 *
 * @param value - 值
 * @returns 强度
 */
export function clampThinkingIntensity(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 取思考等级规格。
 *
 * @param level - 层级或档位
 * @returns 规格
 */
export function thinkingLevelSpec(level: ThinkingLevel | undefined): ThinkingLevelSpec {
    return THINKING_LEVELS.find(item => item.level === level) || THINKING_LEVELS[1];
}

/**
 * 思考模式→等级。
 *
 * @param mode - 模式
 * @returns 等级
 */
export function thinkingLevelFromMode(mode: ThinkingMode | undefined): ThinkingLevel {
    if (mode === 'off') return 'fast';
    if (mode === 'on') return 'deep';
    return 'standard';
}

/**
 * 思考模式→强度。
 *
 * @param mode - 模式
 * @returns 强度
 */
export function thinkingIntensityFromMode(mode: ThinkingMode | undefined): number {
    return thinkingLevelSpec(thinkingLevelFromMode(mode)).percent;
}

/** 强度 → 最接近的预设等级（滑杆拖动时保持四级语义） */
export function nearestThinkingLevel(intensity: number): ThinkingLevel {
    const value = clampThinkingIntensity(intensity);
    return THINKING_LEVELS.reduce((best, item) =>
        Math.abs(item.percent - value) < Math.abs(best.percent - value) ? item : best
    ).level;
}

/**
 * 任务预算覆盖。
 */
export interface TaskBudgetOverride {
    model?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    thinkingMode?: ThinkingMode;
    thinkingBudget?: number;
    /** 四级思考等级；设置后优先于 thinkingMode 的隐式语义 */
    thinkingLevel?: ThinkingLevel;
    /** 0–100 思考强度；滑杆可覆盖等级预设 */
    thinkingIntensity?: number;
}

/**
 * 任务模型提供方。
 */
export interface TaskModelProvider {
    id: string;
    endpoint: string;
    models?: string[];
    sourceType?: 'cloud' | 'local';
}

/**
 * 任务模型设置。
 */
export interface TaskModelSettings {
    defaultModel: string;
    flashModel: string;
    proModel: string;
    apiEndpoint?: string;
    customProviders?: TaskModelProvider[];
    providerKeys?: Record<string, string>;
    deconstructionEngine?: { llmModel?: string };
    taskBudgets?: Partial<Record<AiTask, TaskBudgetOverride>>;
    /** 全局思考模式；任务级设置优先。 */
    thinkingMode?: ThinkingMode;
    /** 全局思考预算（token），0 表示不单独预留。 */
    thinkingBudget?: number;
    /** 全局四级思考等级 */
    thinkingLevel?: ThinkingLevel;
    /** 全局思考强度 0–100 */
    thinkingIntensity?: number;
    /**
     * 全局预算档位（2026-10-29）。
     * 用户只设这一个档位 + 思考强度，输入/输出/思考预算由
     * `task-budget-engine` 按任务类别分发；缺省为 balanced（与旧行为一致）。
     */
    budgetTier?: BudgetTier;
}

/**
 * 模型上下文/输出上限。
 */
export interface ModelLimits {
    maxContext: number;
    maxOutput: number;
}

/**
 * 任务模型配置。
 */
export interface TaskModelConfig extends ModelLimits {
    task: AiTask;
    model: string;
    /** 模型所属 provider 的 endpoint；用于按模型能力/本地路由解析 */
    endpoint?: string;
    providerId?: string;
    apiKey?: string;
    sourceType?: 'cloud' | 'local';
    maxInput: number;
    thinkingMode: ThinkingMode;
    thinkingBudget: number;
    thinkingLevel: ThinkingLevel;
    thinkingIntensity: number;
}

const PLANNING_STEPS = new Set([
    'infoPlan',
    'plotDistill',
    'outline',
    'emotionPlan',
    'sceneExpand',
]);

/** 步骤 key → 任务类型。fix/finalFix 等正文修正与正文共用 pro 预算。 */
export function resolveTaskForStep(stepKey: string, modelStrategy?: string): AiTask {
    if (stepKey === 'bodyGeneration' || stepKey === 'fix' || stepKey === 'finalFix') {
        return 'body';
    }
    if (stepKey === 'qualityControl') return 'quality';
    if (stepKey === 'analysisReport') return 'analysis';
    if (PLANNING_STEPS.has(stepKey)) return 'planning';
    if (modelStrategy === 'pro') return 'body';
    if (modelStrategy === 'flash') return 'planning';
    return 'default';
}

/** 任务默认使用的模型。任务覆盖优先于模型策略。 */
export function resolveTaskModel(settings: TaskModelSettings, task: AiTask): string {
    const override = settings.taskBudgets?.[task]?.model;
    if (override && override.trim()) return override.trim();

    switch (task) {
        case 'planning':
        case 'analysis':
            return settings.flashModel || settings.defaultModel;
        case 'body':
        case 'quality':
        case 'fingerprint':
            return settings.proModel || settings.defaultModel;
        case 'deconstruction':
            return settings.deconstructionEngine?.llmModel || settings.proModel || settings.defaultModel;
        case 'cowrite':
        case 'default':
        default:
            return settings.defaultModel;
    }
}

/**
 * 按模型名找所属 provider。
 * 任务级模型可以跨供应商选择，预算/本地路由必须用该模型自己的 endpoint。
 */
export function findTaskModelProvider(
    settings: TaskModelSettings,
    model: string,
): TaskModelProvider | null {
    if (!model) return null;
    return (settings.customProviders || []).find(p => Array.isArray(p.models) && p.models.includes(model)) || null;
}

/**
 * 解析任务预算。
 *
 * 优先级：任务覆盖 → 模型能力（由调用方的 resolveLimits 决定，内部已处理
 * 用户覆盖/本地探测/静态表）→ 安全回退。
 *
 * maxInput 是「提示词预算」，不是模型窗口：默认给输出预留 15% 的估算余量，
 * 避免输入把输出空间挤到 0。后续设置页会允许显式覆盖。
 */
export function resolveTaskModelConfig(
    settings: TaskModelSettings,
    task: AiTask,
    resolveLimits: (model: string, endpoint?: string) => ModelLimits,
    endpoint?: string,
): TaskModelConfig {
    const model = resolveTaskModel(settings, task);
    const override = settings.taskBudgets?.[task];
    const provider = findTaskModelProvider(settings, model);
    const effectiveEndpoint = endpoint || provider?.endpoint || settings.apiEndpoint;
    const sourceType = provider
        ? resolveProviderSourceType({ id: provider.id, endpoint: provider.endpoint, sourceType: provider.sourceType })
        : undefined;
    const apiKey = provider
        ? (settings.providerKeys?.[provider.id] || (sourceType === 'local' ? 'ollama' : undefined))
        : undefined;

    let limits: ModelLimits;
    try {
        limits = resolveLimits(model, effectiveEndpoint);
    } catch {
        limits = { maxContext: 32768, maxOutput: 8192 };
    }

    const context = Number.isFinite(limits.maxContext) && limits.maxContext > 0
        ? Math.floor(limits.maxContext)
        : 32768;

    // 显式思考设置先取出来：它决定走「引擎自动分配」还是「旧版直取预算」。
    const legacyThinkingMode: ThinkingMode = override?.thinkingMode
        ?? settings.thinkingMode
        ?? 'auto';
    const requestedThinkingBudget = override?.thinkingBudget ?? settings.thinkingBudget ?? 0;
    const explicitLevel = override?.thinkingLevel ?? settings.thinkingLevel;
    const explicitIntensity = override?.thinkingIntensity ?? settings.thinkingIntensity;
    const hasExplicitThinking = explicitLevel !== undefined || explicitIntensity !== undefined;

    // 输入 / 输出预算统一交给调节引擎：用户只设一个全局档位，
    // 引擎按任务类别分发。`balanced` 档系数全为 1，逐值与重构前一致。
    //
    // 思考预算有一个历史分支必须保留：旧实现里只有 `thinkingMode` +
    // `thinkingBudget`、没有显式等级/强度时，预算是**直取不缩放、也不自动**；
    // 只有存在显式等级/强度时才走自动或按强度缩放。这里用「是否有显式思考」
    // 来决定是否把强度交给引擎，避免升级后静默改变成本。
    const plan = planTaskBudget({
        category: TASK_CATEGORY[task],
        limits: { maxContext: context, maxOutput: limits.maxOutput },
        tier: settings.budgetTier,
        intensity: hasExplicitThinking
            ? (explicitIntensity !== undefined
                ? explicitIntensity
                : thinkingLevelSpec(explicitLevel).percent)
            : 0,
        explicitThinkingBudget: hasExplicitThinking ? requestedThinkingBudget : 0,
        override: {
            maxInputTokens: override?.maxInputTokens,
            maxOutputTokens: override?.maxOutputTokens,
            // 只在显式思考路径下让引擎处理任务级思考预算
            thinkingBudget: hasExplicitThinking ? override?.thinkingBudget : undefined,
        },
    });
    const maxOutput = plan.maxOutput;
    const maxInput = plan.maxInput;

    let thinkingMode: ThinkingMode = legacyThinkingMode;
    let thinkingLevel: ThinkingLevel = explicitLevel ?? thinkingLevelFromMode(legacyThinkingMode);
    let thinkingIntensity = explicitIntensity !== undefined
        ? clampThinkingIntensity(explicitIntensity)
        : thinkingIntensityFromMode(legacyThinkingMode);
    let thinkingBudget: number;

    if (hasExplicitThinking) {
        thinkingIntensity = explicitIntensity !== undefined
            ? clampThinkingIntensity(explicitIntensity)
            : thinkingLevelSpec(explicitLevel).percent;
        thinkingLevel = explicitLevel ?? nearestThinkingLevel(thinkingIntensity);
        thinkingMode = override?.thinkingMode
            ?? (thinkingIntensity <= 0 ? 'off' : thinkingIntensity >= 70 ? 'on' : 'auto');
        thinkingBudget = (thinkingIntensity <= 0 || thinkingMode === 'off')
            ? 0
            : plan.thinkingBudget;
    } else {
        // 旧版行为：显式给了预算就直取（不乘强度），没给就是 0（不自动预留）。
        thinkingBudget = Number.isFinite(requestedThinkingBudget) && requestedThinkingBudget > 0
            ? Math.min(Math.floor(requestedThinkingBudget), maxOutput)
            : 0;
    }

    return {
        task,
        model,
        endpoint: effectiveEndpoint,
        providerId: provider?.id,
        apiKey,
        sourceType,
        maxContext: context,
        maxInput,
        maxOutput,
        thinkingMode,
        thinkingBudget,
        thinkingLevel,
        thinkingIntensity,
    };
}
