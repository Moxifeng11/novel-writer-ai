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
import {
    BODY_GENERATION_SYSTEM_PROMPT_V3,
    BODY_GENERATION_USER_TEMPLATE_V3,
    BODY_GENERATION_V3_DESC,
} from './body-v3-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V4,
    BODY_GENERATION_USER_TEMPLATE_V4,
    BODY_GENERATION_V4_DESC,
} from './body-v4-prompts';
import { MEMORY_GENERATION_PROMPTS } from './memory-prompts';
import { COUNTABLE_HUMAN_HINTS } from './human-countable-hints';
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
        bodyGenerationV3: {
            description: BODY_GENERATION_V3_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT_V3,
            userPrompt: BODY_GENERATION_USER_TEMPLATE_V3,
        },
        bodyGenerationV4: {
            description: BODY_GENERATION_V4_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT_V4,
            userPrompt: BODY_GENERATION_USER_TEMPLATE_V4,
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
 * 只有「主角真实 9 字段灵魂层」存在时才启用 V2；
 * 旧口径只看 characterCores 长度，多个「（灵魂层未配置）」也能超过 100 字而误开 V2。
 */
export function getStepTemplateAuto(key: string, vars?: Record<string, string>): PromptTemplate | null {
    let template: PromptTemplate | null = null;
    if (key === 'bodyGeneration' && vars) {
        // 实验/设置可强制正文变体（v1/v2/v3/v4）；留空按灵魂层自动路由。
        const forced = (vars._bodyVariant || '').trim().toLowerCase();
        const forcedKey = forced === 'v1' ? 'bodyGeneration'
            : forced === 'v2' ? 'bodyGenerationV2'
            : forced === 'v3' ? 'bodyGenerationV3'
            : forced === 'v4' ? 'bodyGenerationV4'
            : '';
        if (forcedKey) {
            template = getStepTemplate(forcedKey);
        } else {
            const soulReady = vars.characterSoulReady === '1'
                || (vars.protagonistSoulDetail || '').trim().length > 0;
            if (soulReady) {
                template = getStepTemplate('bodyGenerationV2');
            }
        }
    }
    if (!template) template = getStepTemplate(key);
    if (!template) return null;

    // 可数硬指标（实验 C9 的组成部分，默认关闭）：只在正文步骤追加，且放在 system 末尾。
    if (key === 'bodyGeneration' && vars?._countableHints === '1') {
        template = { ...template, systemPrompt: `${template.systemPrompt}\n\n${COUNTABLE_HUMAN_HINTS}` };
    }

    // 短篇/剧本：在既有模板末尾追加模式硬约束；长篇没有 creationModePrompt，保持原样。
    const modeBlock = (vars?.creationModePrompt || '').trim();
    if (!modeBlock) return template;
    return {
        ...template,
        systemPrompt: `${template.systemPrompt}

${modeBlock}`,
    };
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