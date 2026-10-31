/**
 * prompt-registry.ts — 提示词模板的版本元数据（可归因、可切换）
 *
 * 现状：`engine/prompts/*` 里的模板全是裸字符串，没有机器可读的 id/版本，
 * 只有注释里写「第三版 / v4」；`engine/prompt-manager.ts` 有版本模型但整个类没有调用方。
 * 结果：正文生成用了哪个模板、人味块用的是配额版还是样文版，事后无法归因。
 *
 * 这里只做「元数据 + 变体选择」，不改模板正文（避免动到 12 组锁定文案的契约测试）：
 * - 每个步骤登记 `id@version` 与内容哈希；
 * - 正文有两套模板（V1/V2），人味块有两个版本（quota/exemplar），所以正文的
 *   `templateVersion` 是「模板版本 + 人味版本」的组合标识。
 */
import { hashContent } from '../../shared/versioned-registry';
import {
    BODY_GENERATION_SYSTEM_PROMPT,
    BODY_GENERATION_USER_TEMPLATE,
    INFO_PLAN_PROMPTS,
    OUTLINE_PROMPTS,
    ANALYSIS_REPORT_PROMPTS,
    QUALITY_CONTROL_PROMPTS,
} from './chapter-pipeline-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT_V2, BODY_GENERATION_USER_TEMPLATE_V2 } from './body-v2-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT_V3, BODY_GENERATION_USER_TEMPLATE_V3 } from './body-v3-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT_V4, BODY_GENERATION_USER_TEMPLATE_V4 } from './body-v4-prompts';
import { HUMAN_VOICE_BLOCK, HUMAN_VOICE_WEAK_RULES } from './human-voice';
import { DEAI_REWRITE_SYSTEM_PROMPT } from './deai-prompts';

export type HumanVoiceMode = 'exemplar' | 'quota';

export interface PromptVariantMeta {
    /** 稳定 id，如 `bodyGeneration.v2` */
    id: string;
    /** 语义版本，如 `2.1.0` */
    version: string;
    /** 内容哈希（system+user），用于 A/B 归因与缓存失效判断 */
    hash: string;
    /** 一行说明，设置页/账本展示 */
    notes?: string;
}

export interface PromptRenderMeta extends PromptVariantMeta {
    stepKey: string;
    /** 人味块版本（仅正文相关步骤有） */
    voiceVersion?: string;
    /** 组合标识：`模板 id@version+voice id@version` */
    compositeId: string;
}

/** 步骤 → 变体元数据。正文有两套（V1/V2），其余单版本。 */
const STEP_VARIANTS: Record<string, PromptVariantMeta & { system: string; user: string }> = {
    bodyGeneration: {
        id: 'bodyGeneration.v1',
        version: '1.4.0',
        system: BODY_GENERATION_SYSTEM_PROMPT,
        user: BODY_GENERATION_USER_TEMPLATE,
        hash: hashContent(BODY_GENERATION_SYSTEM_PROMPT + BODY_GENERATION_USER_TEMPLATE),
        notes: 'V1 流水线正文（无灵魂层时回退）',
    },
    bodyGenerationV2: {
        id: 'bodyGeneration.v2',
        version: '2.1.0',
        system: BODY_GENERATION_SYSTEM_PROMPT_V2,
        user: BODY_GENERATION_USER_TEMPLATE_V2,
        hash: hashContent(BODY_GENERATION_SYSTEM_PROMPT_V2 + BODY_GENERATION_USER_TEMPLATE_V2),
        notes: 'V2 小说家模式正文（有灵魂层时的默认）',
    },
    bodyGenerationV3: {
        id: 'bodyGeneration.v3',
        version: '3.0.0',
        system: BODY_GENERATION_SYSTEM_PROMPT_V3,
        user: BODY_GENERATION_USER_TEMPLATE_V3,
        hash: hashContent(BODY_GENERATION_SYSTEM_PROMPT_V3 + BODY_GENERATION_USER_TEMPLATE_V3),
        notes: 'V3 节拍先行：台词清单前置，不注入禁用清单/工艺长文',
    },
    bodyGenerationV4: {
        id: 'bodyGeneration.v4',
        version: '4.0.0',
        system: BODY_GENERATION_SYSTEM_PROMPT_V4,
        user: BODY_GENERATION_USER_TEMPLATE_V4,
        hash: hashContent(BODY_GENERATION_SYSTEM_PROMPT_V4 + BODY_GENERATION_USER_TEMPLATE_V4),
        notes: 'V4 对话主干：按台词编号写成连续对话，叙述只补 1–3 句',
    },
    infoPlan: {
        id: 'infoPlan.v1', version: '1.2.0',
        system: INFO_PLAN_PROMPTS.systemPrompt, user: INFO_PLAN_PROMPTS.userPrompt,
        hash: hashContent(INFO_PLAN_PROMPTS.systemPrompt + INFO_PLAN_PROMPTS.userPrompt),
    },
    outline: {
        id: 'outline.v1', version: '1.3.0',
        system: OUTLINE_PROMPTS.systemPrompt, user: OUTLINE_PROMPTS.userPrompt,
        hash: hashContent(OUTLINE_PROMPTS.systemPrompt + OUTLINE_PROMPTS.userPrompt),
    },
    analysisReport: {
        id: 'analysisReport.v1', version: '1.5.0',
        system: ANALYSIS_REPORT_PROMPTS.systemPrompt, user: ANALYSIS_REPORT_PROMPTS.userPrompt,
        hash: hashContent(ANALYSIS_REPORT_PROMPTS.systemPrompt + ANALYSIS_REPORT_PROMPTS.userPrompt),
    },
    qualityControl: {
        id: 'qualityControl.v1', version: '1.3.0',
        system: QUALITY_CONTROL_PROMPTS.systemPrompt, user: QUALITY_CONTROL_PROMPTS.userPrompt,
        hash: hashContent(QUALITY_CONTROL_PROMPTS.systemPrompt + QUALITY_CONTROL_PROMPTS.userPrompt),
    },
    deaiRewrite: {
        id: 'deai.rewrite', version: '2.0.0',
        system: DEAI_REWRITE_SYSTEM_PROMPT, user: '',
        hash: hashContent(DEAI_REWRITE_SYSTEM_PROMPT),
        notes: '消痕改写（样文优先版）',
    },
};

/** 人味块版本（正文 system 里的 `${humanVoice}`） */
export function voiceVariantMeta(mode: HumanVoiceMode): PromptVariantMeta {
    const content = mode === 'quota' ? HUMAN_VOICE_BLOCK : HUMAN_VOICE_WEAK_RULES;
    return {
        id: mode === 'quota' ? 'voice.quota' : 'voice.exemplar',
        version: mode === 'quota' ? '3.0.0' : '5.0.0',
        hash: hashContent(content),
        notes: mode === 'quota' ? '旧版 23 条数值配额' : '样文优先的 6 条弱约束',
    };
}

/** 正文变体：V2 需要灵魂层数据，`forceVariant` 供实验/设置强制指定 */
export function resolveBodyVariant(
    vars: Record<string, string> | undefined,
    forceVariant?: 'v1' | 'v2' | 'v3' | 'v4',
): PromptVariantMeta {
    if (forceVariant === 'v1') return STEP_VARIANTS.bodyGeneration;
    if (forceVariant === 'v2') return STEP_VARIANTS.bodyGenerationV2;
    if (forceVariant === 'v3') return STEP_VARIANTS.bodyGenerationV3;
    if (forceVariant === 'v4') return STEP_VARIANTS.bodyGenerationV4;
    // 未显式指定时优先读 vars._bodyVariant（template-vars-builder 写入设置的变体）
    const fromVars = (vars?._bodyVariant || '').trim().toLowerCase();
    if (fromVars === 'v1') return STEP_VARIANTS.bodyGeneration;
    if (fromVars === 'v2') return STEP_VARIANTS.bodyGenerationV2;
    if (fromVars === 'v3') return STEP_VARIANTS.bodyGenerationV3;
    if (fromVars === 'v4') return STEP_VARIANTS.bodyGenerationV4;
    const soulReady = vars?.characterSoulReady === '1'
        || (vars?.protagonistSoulDetail || '').trim().length > 0;
    return soulReady ? STEP_VARIANTS.bodyGenerationV2 : STEP_VARIANTS.bodyGeneration;
}

/** 任意步骤的模板变体（未登记的步骤返回 null，调用方按无版本处理） */
export function promptVariantOf(stepKey: string): PromptVariantMeta | null {
    const hit = STEP_VARIANTS[stepKey];
    if (!hit) return null;
    const { system: _system, user: _user, ...meta } = hit;
    return meta;
}

/**
 * 组装归因元数据：正文会把模板版本与人味版本合成一个 compositeId，
 * 这样账本里既能区分「改了哪段模板」，也能区分「用的是配额还是样文」。
 */
export function renderMetaOf(
    stepKey: string,
    options: { vars?: Record<string, string>; voiceMode?: HumanVoiceMode; forceBodyVariant?: 'v1' | 'v2' | 'v3' | 'v4' } = {},
): PromptRenderMeta | null {
    const base = stepKey === 'bodyGeneration'
        ? resolveBodyVariant(options.vars, options.forceBodyVariant)
        : promptVariantOf(stepKey);
    if (!base) return null;
    const voice = options.voiceMode ? voiceVariantMeta(options.voiceMode) : null;
    return {
        ...base,
        stepKey,
        voiceVersion: voice ? `${voice.id}@${voice.version}` : undefined,
        compositeId: voice ? `${base.id}@${base.version}+${voice.id}@${voice.version}` : `${base.id}@${base.version}`,
    };
}

/** 全部已登记变体（设置页/文档用） */
export function listPromptVariants(): PromptVariantMeta[] {
    const list = Object.values(STEP_VARIANTS).map(({ system: _s, user: _u, ...meta }) => meta);
    list.push(voiceVariantMeta('exemplar'), voiceVariantMeta('quota'));
    return list;
}
