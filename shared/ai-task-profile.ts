/**
 * ai-task-profile.ts — 按任务性质配置 AI 采样参数（2026-11-26）
 *
 * ## 为什么需要分档
 *
 * 本仓此前温度是「一个值管所有任务」，而且是三个不同默认值混用：
 * - API 层（`ai-engine.ts` / `ai-api-stream.ts` / `ai-api-client.ts`）默认 **0.7**
 * - 步骤链（`step-runner.ts:1214`）从 UI slider 读，默认 **1.4**
 * - 协同写作（`settings.coWriteTemperature`）**1.25**
 *
 * 问题：质量自检要稳定 JSON（低温度），正文生成要创意（高温度）。
 * 共用一个值必然有一端不最优。而 1.4 已超出多数模型建议上限。
 *
 * ## 取值依据
 *
 * 借鉴云笔生产环境实测配置（三档分工）：
 * - 0.3 质量自检 / 结构化输出
 * - 0.6 指令改写
 * - 0.8 内容生成
 *
 * 本仓在此基础微调：
 * - `extraction` 用 0.2（比云笔更严，因为实体抽取必须严格 JSON）
 * - `analysis` 用 0.4（结构化 + 适度归纳）
 * - `body-generation` 用 0.8（与云笔一致）
 *
 * ## 注意
 *
 * 这是**采样参数**，不是人味判据。人味判断只用 `engine/zhuque-detector.ts`。
 */

/** 任务类型 */
export type AiTaskKind =
    /** 正文生成：创意优先，句子要长短错落 */
    | 'body-generation'
    /** 蒸馏/摘要：忠实原文优先，不能编造 */
    | 'distillation'
    /** 质量自检：必须稳定输出结构化 JSON */
    | 'quality-check'
    /** 分析报告：结构化 + 适度归纳 */
    | 'analysis'
    /** 指令改写/润色：在保持原意基础上改清晰 */
    | 'rewrite'
    /** 结构化抽取（实体/伏笔/境界等）：严格 JSON，最低温度 */
    | 'extraction'
    /** 大纲/规划：要结构，但要一点创造 */
    | 'planning';

/** 采样配置 */
export interface AiSamplingProfile {
    temperature: number;
    maxTokens: number;
    /** 说明，用于设置页/账本展示 */
    note: string;
}

/**
 * 各任务类型的采样档位。
 *
 * 温度设计原则：
 * - ≤0.3：要求严格结构化输出（JSON、抽取），高温会导致字段漂移/格式错乱
 * - 0.4-0.6：结构化 + 归纳/改写
 * - 0.8：创意写作，低温会产出保守重复、句子均匀
 */
export const AI_TASK_PROFILES: Record<AiTaskKind, AiSamplingProfile> = {
    'body-generation': { temperature: 0.8, maxTokens: 8192, note: '创意优先：避免句子均匀、情节保守' },
    'distillation': { temperature: 0.3, maxTokens: 4096, note: '忠实原文：低温度减少编造' },
    'quality-check': { temperature: 0.3, maxTokens: 4096, note: '结构化 JSON：低温度防格式漂移' },
    'analysis': { temperature: 0.4, maxTokens: 4096, note: '结构化 + 适度归纳' },
    'rewrite': { temperature: 0.6, maxTokens: 4096, note: '保持原意基础上改清晰' },
    'extraction': { temperature: 0.2, maxTokens: 4096, note: '严格抽取：最低温度防幻觉字段' },
    'planning': { temperature: 0.7, maxTokens: 8192, note: '大纲规划：结构 + 创造平衡' },
};

/**
 * 取某任务的采样配置，允许调用方覆写。
 *
 * @param kind - 任务类型
 * @param overrides - 覆写项（如用户在设置里自定义了温度）
 * @returns 采样配置
 * @example
 * const { temperature, maxTokens } = resolveSampling('body-generation');
 * // { temperature: 0.8, maxTokens: 8192, note: '创意优先：...' }
 */
export function resolveSampling(
    kind: AiTaskKind,
    overrides: Partial<AiSamplingProfile> = {},
): AiSamplingProfile {
    const base = AI_TASK_PROFILES[kind];
    return {
        temperature: overrides.temperature ?? base.temperature,
        maxTokens: overrides.maxTokens ?? base.maxTokens,
        note: overrides.note ?? base.note,
    };
}

/**
 * 把步骤键映射到任务类型。
 *
 * 本仓 10 个步骤各有不同性质，用统一温度是浪费：
 * - 信息规划/大纲/情绪/场景 → planning
 * - 正文生成 → body-generation
 * - 质量检查 → quality-check
 * - 分析报告 → analysis
 * - 情节蒸馏 → distillation
 *
 * @param stepKey - 步骤键（`STEP_KEYS.*`）
 * @returns 任务类型；未知步骤退回 'planning'
 * @example
 * taskKindOfStep('bodyGeneration') // 'body-generation'
 * taskKindOfStep('qualityControl') // 'quality-check'
 */
export function taskKindOfStep(stepKey: string): AiTaskKind {
    switch (stepKey) {
        case 'bodyGeneration':
            return 'body-generation';
        case 'qualityControl':
            return 'quality-check';
        case 'analysisReport':
            return 'analysis';
        case 'plotDistill':
            return 'distillation';
        case 'infoPlan':
        case 'outline':
        case 'emotionPlan':
        case 'sceneExpand':
        case 'characterSoul':
        case 'settlement':
            return 'planning';
        default:
            return 'planning';
    }
}
