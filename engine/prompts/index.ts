/**
 * engine/prompts/index.ts
 * 提示词模板库 barrel — 统一对外出口。
 *
 * 拆分历史（v4.5.1 之后）：
 *   原 prompt-templates.ts (1097 行) → 7 个职责文件 + 此 barrel。
 *   外部仍可通过 `import { ... } from '@/engine/engine/prompt-templates'` 访问（原文件改为 re-export）。
 *   新代码建议直接 `import { ... } from '@/engine/engine/prompts'`。
 *
 * 子文件职责：
 *   - writing-rules.ts        全局写作规则（16 心法 + 格式参考；与元文件/00-系统模板/写作规则.md 同结构）
 *   - chapter-pipeline-prompts.ts  9 步流水线 V1 模板
 *   - body-v2-prompts.ts      V2 正文生成（小说家模式）
 *   - soul-driven-prompts.ts  V2 灵魂驱动步骤（角色灵魂 / 情绪规划 / Scene 展开）
 *   - deai-prompts.ts         去 AI 味独立通道
 *   - co-write-prompts.ts     句级协同写作 8 方向
 *   - memory-prompts.ts       记忆碎片生成
 *   - template-utils.ts       PromptTemplate 接口 + 路由 + 变量替换
 */

export { WRITING_RULES } from './writing-rules';
export {
    CHARACTER_SOUL_PROMPTS,
    EMOTION_PLAN_PROMPTS,
    SCENE_EXPAND_PROMPTS,
} from './soul-driven-prompts';
export {
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
export {
    BODY_GENERATION_SYSTEM_PROMPT_V2,
    BODY_GENERATION_USER_TEMPLATE_V2,
    BODY_GENERATION_V2_DESC,
} from './body-v2-prompts';
export {
    DEAI_CHECK_SYSTEM_PROMPT,
    DEAI_CHECK_USER_TEMPLATE,
    DEAI_REWRITE_SYSTEM_PROMPT,
    DEAI_REWRITE_USER_TEMPLATE,
} from './deai-prompts';
export type { CoWriteDirection } from './co-write-prompts';
export {
    CO_WRITE_DIRECTION_PROMPTS,
    CO_WRITE_PROMPTS,
} from './co-write-prompts';
export {
    MEMORY_GENERATION_SYSTEM_PROMPT,
    MEMORY_GENERATION_USER_TEMPLATE,
    MEMORY_GENERATION_PROMPTS,
} from './memory-prompts';
export type { PromptTemplate } from './template-utils';
export {
    getStepTemplate,
    getStepTemplateAuto,
    fillTemplate,
} from './template-utils';
