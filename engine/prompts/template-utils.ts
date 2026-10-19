/**
 * engine/prompts/template-utils.ts
 * PromptTemplate 接口 + 路由表 + 变量替换工具。
 *
 * 提示词正文已全部外置到同级职责文件（chapter-pipeline-prompts / body-v2-prompts /
 * soul-driven-prompts / deai-prompts / memory-prompts），本文件只保留路由与替换职责。
 */
import {
    INFO_PLAN_PROMPTS,
    PLOT_DISTILL_PROMPTS,
    OUTLINE_PROMPTS,
    BODY_GENERATION_SYSTEM_PROMPT,
    BODY_GENERATION_USER_TEMPLATE,
    BODY_GENERATION_DESC,
    SELF_CHECK_PROMPTS,
    FIX_PROMPTS,
    CONTINUITY_CHECK_PROMPTS,
    ANALYSIS_REPORT_PROMPTS,
    QUALITY_CONTROL_PROMPTS,
} from './chapter-pipeline-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V2,
    BODY_GENERATION_USER_TEMPLATE_V2,
    BODY_GENERATION_V2_DESC,
} from './body-v2-prompts';
import { MEMORY_GENERATION_PROMPTS } from './memory-prompts';
import {
    CHARACTER_SOUL_PROMPTS,
    EMOTION_PLAN_PROMPTS,
    SCENE_EXPAND_PROMPTS,
} from './soul-driven-prompts';

// ============================================================
export interface PromptTemplate {
    description: string;
    systemPrompt: string;
    userPrompt: string;
}

/**
 * 根据步骤 key 获取对应的提示词模板
 * 使用函数导出以避免 esbuild tree-shaking 掉模板字符串
 */
export function getStepTemplate(key: string): PromptTemplate | null {
    const map: Record<string, PromptTemplate> = {
        infoPlan: INFO_PLAN_PROMPTS,
        plotDistill: PLOT_DISTILL_PROMPTS,
        outline: OUTLINE_PROMPTS,
        characterSoul: CHARACTER_SOUL_PROMPTS,
        emotionPlan: EMOTION_PLAN_PROMPTS,
        sceneExpand: SCENE_EXPAND_PROMPTS,
        bodyGeneration: {
            description: BODY_GENERATION_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT,
            userPrompt: BODY_GENERATION_USER_TEMPLATE,
        },
        bodyGenerationV2: {
            description: BODY_GENERATION_V2_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT_V2,
            userPrompt: BODY_GENERATION_USER_TEMPLATE_V2,
        },
        // @deprecated 旧版步骤（selfCheck / fix / finalFix / continuityCheck）已合并入
        // qualityControl，以下四条仅为打开旧项目时的只读兼容路由，新流水线不再调用。
        selfCheck: SELF_CHECK_PROMPTS,
        fix: FIX_PROMPTS,
        finalFix: FIX_PROMPTS,
        continuityCheck: CONTINUITY_CHECK_PROMPTS,
        analysisReport: ANALYSIS_REPORT_PROMPTS,
        qualityControl: QUALITY_CONTROL_PROMPTS,
        memoryGeneration: MEMORY_GENERATION_PROMPTS,
    };
    return map[key] || null;
}

/**
 * V2: 获取步骤模板——支持使用 V2 prompt 替换 V1
 * 当 vars 中 characterCores 有数据时自动启用 V2 模式
 */
export function getStepTemplateAuto(key: string, vars?: Record<string, string>): PromptTemplate | null {
    if (key === 'bodyGeneration' && vars) {
        // 如果有灵魂层数据 → 启用 V2 小说家模式
        const hasSoul = !!(vars.characterCores && vars.characterCores.trim().length > 100);
        if (hasSoul) {
            return getStepTemplate('bodyGenerationV2');
        }
    }
    return getStepTemplate(key);
}

/**
 * 替换模板变量
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value || '');
    }
    return result;
}