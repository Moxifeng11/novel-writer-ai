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

export type AiTask =
    | 'default'
    | 'planning'
    | 'body'
    | 'analysis'
    | 'quality'
    | 'deconstruction'
    | 'fingerprint'
    | 'cowrite';

export type ThinkingMode = 'off' | 'auto' | 'on';

/** 四级思考能力：极速 / 标准 / 深度 / 极限 */
export type ThinkingLevel = 'fast' | 'standard' | 'deep' | 'max';

export interface ThinkingLevelSpec {
    level: ThinkingLevel;
    label: string;
    percent: number;
    mode: ThinkingMode;
    description: string;
}

export const THINKING_LEVELS: ThinkingLevelSpec[] = [
    { level: 'fast', label: '极速', percent: 0, mode: 'off', description: '关闭思考，最低延迟与成本；适合快速草稿、格式整理。' },
    { level: 'standard', label: '标准', percent: 35, mode: 'auto', description: '由供应商决定是否思考，默认强度；适合大多数规划与正文。' },
    { level: 'deep', label: '深度', percent: 70, mode: 'on', description: '显式开启思考，适合复杂情节、长文推理与质量检查。' },
    { level: 'max', label: '极限', percent: 100, mode: 'on', description: '最大思考预算，适合高难推理；延迟与费用最高。' },
];

export function clampThinkingIntensity(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function thinkingLevelSpec(level: ThinkingLevel | undefined): ThinkingLevelSpec {
    return THINKING_LEVELS.find(item => item.level === level) || THINKING_LEVELS[1];
}

export function thinkingLevelFromMode(mode: ThinkingMode | undefined): ThinkingLevel {
    if (mode === 'off') return 'fast';
    if (mode === 'on') return 'deep';
    return 'standard';
}

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

export interface TaskModelProvider {
    id: string;
    endpoint: string;
    models?: string[];
    sourceType?: 'cloud' | 'local';
}

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
}

export interface ModelLimits {
    maxContext: number;
    maxOutput: number;
}

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

    const requestedOutput = Number.isFinite(override?.maxOutputTokens) && (override?.maxOutputTokens || 0) > 0
        ? Math.floor(override!.maxOutputTokens!)
        : limits.maxOutput;
    const maxOutput = Math.max(1, Math.min(
        Number.isFinite(requestedOutput) && requestedOutput > 0 ? Math.floor(requestedOutput) : 8192,
        context,
    ));

    const derivedInput = Math.max(512, Math.floor(context - maxOutput * 1.15));
    const requestedInput = Number.isFinite(override?.maxInputTokens) && (override?.maxInputTokens || 0) > 0
        ? Math.floor(override!.maxInputTokens!)
        : derivedInput;
    const maxInput = Math.max(512, Math.min(requestedInput, Math.max(512, context - maxOutput)));

    const legacyThinkingMode: ThinkingMode = override?.thinkingMode
        ?? settings.thinkingMode
        ?? 'auto';
    const requestedThinkingBudget = override?.thinkingBudget ?? settings.thinkingBudget ?? 0;
    const explicitLevel = override?.thinkingLevel ?? settings.thinkingLevel;
    const explicitIntensity = override?.thinkingIntensity ?? settings.thinkingIntensity;
    const hasExplicitThinking = explicitLevel !== undefined || explicitIntensity !== undefined;

    let thinkingMode: ThinkingMode = legacyThinkingMode;
    let thinkingLevel: ThinkingLevel = explicitLevel ?? thinkingLevelFromMode(legacyThinkingMode);
    let thinkingIntensity = explicitIntensity !== undefined
        ? clampThinkingIntensity(explicitIntensity)
        : thinkingIntensityFromMode(legacyThinkingMode);
    let thinkingBudget = Number.isFinite(requestedThinkingBudget) && requestedThinkingBudget > 0
        ? Math.min(Math.floor(requestedThinkingBudget), maxOutput)
        : 0;

    if (hasExplicitThinking) {
        thinkingIntensity = explicitIntensity !== undefined
            ? clampThinkingIntensity(explicitIntensity)
            : thinkingLevelSpec(explicitLevel).percent;
        thinkingLevel = explicitLevel ?? nearestThinkingLevel(thinkingIntensity);
        thinkingMode = override?.thinkingMode
            ?? (thinkingIntensity <= 0 ? 'off' : thinkingIntensity >= 70 ? 'on' : 'auto');
        // 强度为 0 或显式关闭时不预留思考预算；否则按强度缩放显式预算或自动预算。
        if (thinkingIntensity <= 0 || thinkingMode === 'off') {
            thinkingBudget = 0;
        } else {
            const autoBudget = Math.floor(maxOutput * 0.3 * (thinkingIntensity / 100));
            thinkingBudget = Number.isFinite(requestedThinkingBudget) && requestedThinkingBudget > 0
                ? Math.min(Math.floor(requestedThinkingBudget * (thinkingIntensity / 100)), maxOutput)
                : Math.min(autoBudget, maxOutput);
        }
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
