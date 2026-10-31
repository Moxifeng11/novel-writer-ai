/**
 * scripts/fixtures/prompt-exports.ts —— 组合实验的「真实提示词」出口
 *
 * 由 `scripts/humanness-combo.mjs` 用 esbuild 打包成 ESM 后 import，
 * 保证实验用的模板/规则/人味块与插件运行时是**同一份文本**（不再手抄 prompt）。
 */
import { WRITING_RULES } from '../../shared/writing-rules';
import { WRITING_RULES_LEGACY } from '../../shared/writing-rules-legacy';
import {
    WRITING_RULES_ANCHOR,
    WRITING_RULES_SCENE_BEAT,
    WRITING_RULES_VOICEPRINT,
} from '../../shared/writing-rules-variants';
import {
    BODY_GENERATION_SYSTEM_PROMPT,
    BODY_GENERATION_USER_TEMPLATE,
} from '../../engine/prompts/chapter-pipeline-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V2,
    BODY_GENERATION_USER_TEMPLATE_V2,
} from '../../engine/prompts/body-v2-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V3,
    BODY_GENERATION_USER_TEMPLATE_V3,
} from '../../engine/prompts/body-v3-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V4,
    BODY_GENERATION_USER_TEMPLATE_V4,
} from '../../engine/prompts/body-v4-prompts';
import { HUMAN_VOICE_BLOCK, HUMAN_VOICE_WEAK_RULES } from '../../engine/prompts/human-voice';
import { buildCraftConstraintBlock, buildNegativeConstraintBlock } from '../../engine/craft-constraints';
import { fillTemplate } from '../../engine/prompts/template-utils';
import { COUNTABLE_HUMAN_HINTS } from '../../engine/prompts/human-countable-hints';
import { deriveBodyFormat, describeBodyFormat } from '../../shared/body-format';
import { analyzeHumanFeatures, evaluateHumanFeatures } from '../../shared/human-feature-rubric';
import { hashContent } from '../../shared/versioned-registry';

export const BODY_TEMPLATES: Record<string, { system: string; user: string }> = {
    v1: { system: BODY_GENERATION_SYSTEM_PROMPT, user: BODY_GENERATION_USER_TEMPLATE },
    v2: { system: BODY_GENERATION_SYSTEM_PROMPT_V2, user: BODY_GENERATION_USER_TEMPLATE_V2 },
    v3: { system: BODY_GENERATION_SYSTEM_PROMPT_V3, user: BODY_GENERATION_USER_TEMPLATE_V3 },
    v4: { system: BODY_GENERATION_SYSTEM_PROMPT_V4, user: BODY_GENERATION_USER_TEMPLATE_V4 },
};

export const RULES: Record<string, string> = {
    base360: WRITING_RULES,
    legacy: WRITING_RULES_LEGACY,
    anchor370: WRITING_RULES_ANCHOR,
    scene380: WRITING_RULES_SCENE_BEAT,
    voiceprint390: WRITING_RULES_VOICEPRINT,
};

export const VOICE: Record<string, string> = {
    quota: HUMAN_VOICE_BLOCK,
    exemplar: HUMAN_VOICE_WEAK_RULES,
};

export const CRAFT_BLOCK = buildCraftConstraintBlock();
export const NEGATIVE_BLOCK = buildNegativeConstraintBlock();
export { COUNTABLE_HUMAN_HINTS };

export { fillTemplate, deriveBodyFormat, describeBodyFormat, analyzeHumanFeatures, evaluateHumanFeatures, hashContent };
