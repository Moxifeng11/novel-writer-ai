/**
 * planning-step-advance.ts — 章节规划阶段完成后的步骤推进（纯函数）
 *
 * 与 StepRunner 解耦，便于单测；避免「规划已生成但停留在旧步骤」的流转卡死。
 */
import { ALL_FULL_STEPS } from './step-definitions';

/** 章节规划阶段的 5 个步骤（顺序与 UI 一致） */
export const PLANNING_STEP_KEYS = [
    'infoPlan',
    'plotDistill',
    'outline',
    'emotionPlan',
    'sceneExpand',
] as const;

/** 正文写作步骤索引 */
export const BODY_GENERATION_STEP_INDEX = 7;

/** 正文及其下游：规划变更后必须失效的步骤 */
export const BODY_DOWNSTREAM_STEP_KEYS = [
    'bodyGeneration',
    'qualityControl',
    'analysisReport',
    'settlement',
] as const;

/**
 * 规划步骤变更后需要失效的步骤。
 *
 * 正文尚未生成时返回空数组：避免把「还没写的正文」标成「待重做」。
 * @param stepKey - 步骤键
 * @param hasBody - 是否含正文
 * @returns 结果数组
 */
export function downstreamStepsAfterPlanningChange(stepKey: string, hasBody: boolean): string[] {
    if (!hasBody) return [];
    if (!(PLANNING_STEP_KEYS as readonly string[]).includes(stepKey)) return [];
    return [...BODY_DOWNSTREAM_STEP_KEYS];
}

/**
 * 计算规划阶段结束后的目标步骤索引：
 * - 5 个规划步骤全部完成 → 正文写作（index 7）
 * - 仍有缺失 → 第一个缺失的规划步骤
 * - 无可用步骤 → -1（调用方保持原位）
 * @param stepCompleted - 步骤完成状态
 * @returns 数值结果
 */
export function calcStepIndexAfterPlanning(stepCompleted: Set<string>): number {
    if (PLANNING_STEP_KEYS.every(key => stepCompleted.has(key))) {
        return BODY_GENERATION_STEP_INDEX;
    }
    const nextKey = PLANNING_STEP_KEYS.find(key => !stepCompleted.has(key));
    return ALL_FULL_STEPS.find(step => step.key === nextKey)?.index ?? -1;
}
