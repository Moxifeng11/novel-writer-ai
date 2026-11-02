/**
 * command-mode-rules.ts — 命令与创作模式的对应关系
 *
 * 放在 shared/ 是为了同时服务两处：
 *   - core/command-registry：用同步模式判断在命令面板里隐藏不适用的命令
 *   - ui/command-ui-executor：执行前给出明确提示（隐藏不等于解释）
 *
 * 未登记的命令一律视为「所有模式可用」；读不到项目也放行，
 * 由各命令自己的「请先选择项目」提示兜底。
 */
import { CommandIds } from './command-ids';
import type { CreationMode } from './creation-mode';

export const LONG_ONLY: CreationMode[] = ['long'];
export const SHORT_ONLY: CreationMode[] = ['short'];
export const SCRIPT_ONLY: CreationMode[] = ['script'];
/** 与项目结构无关的通用能力：实体/设定/标签/文笔，三种模式都有同一份目录结构 */
export const ALL_MODES: CreationMode[] = ['long', 'short', 'script'];

/** 命令 id → 允许的创作模式 */
export const COMMAND_MODE_RULES: Record<string, CreationMode[]> = {
    [CommandIds.PLAN_BOOK]: LONG_ONLY,
    [CommandIds.VOLUME_INTRO]: LONG_ONLY,
    // 批量建章/建节/建集：BatchCreateModal 对三种模式都有实现，不能只放行长篇
    [CommandIds.BATCH_CREATE]: ['long', 'short', 'script'],
    [CommandIds.REBUILD_CHAPTERS]: LONG_ONLY,
    [CommandIds.BATCH_CHAPTERS]: LONG_ONLY,
    [CommandIds.BATCH_NOVELS]: LONG_ONLY,
    [CommandIds.CONTINUE_CHAPTERS]: LONG_ONLY,
    [CommandIds.WRITE_CHAPTER]: LONG_ONLY,
    [CommandIds.WRITE_CHAPTER_AUTO]: LONG_ONLY,
    [CommandIds.AUTO_WRITER]: LONG_ONLY,
    [CommandIds.REVIEW_CHAPTER]: LONG_ONLY,
    [CommandIds.TARGETED_REVISION]: LONG_ONLY,
    [CommandIds.QUALITY_DASHBOARD]: LONG_ONLY,
    [CommandIds.CHAPTER_SETTLEMENT]: LONG_ONLY,
    [CommandIds.CROSS_VOLUME_STATE]: LONG_ONLY,
    [CommandIds.NARRATIVE_OVERVIEW]: LONG_ONLY,
    [CommandIds.STEP_RESULT_VIEWER]: LONG_ONLY,
    [CommandIds.STORY_LINKAGE_BOARD]: LONG_ONLY,
    [CommandIds.BATCH_DECONSTRUCT]: LONG_ONLY,
    // 实体/设定/标签/文笔：三模式共用 01-设定库 与项目路径，不再按长篇独占
    // （P1-7 遗留：短篇/剧本目录里这几个按钮曾被整组过滤掉，用户以为没有这些功能）
    [CommandIds.ADD_FANFIC]: ALL_MODES,
    [CommandIds.CHARACTER_RECOGNITION]: LONG_ONLY,
    [CommandIds.WORLDVIEW]: LONG_ONLY,
    [CommandIds.CHARACTER]: ALL_MODES,
    [CommandIds.FACTION]: ALL_MODES,
    [CommandIds.LOCATION]: ALL_MODES,
    [CommandIds.ITEM]: ALL_MODES,
    [CommandIds.ENTITY_MANAGER]: ALL_MODES,
    [CommandIds.ENTITY_GENERATE]: ALL_MODES,
    [CommandIds.AI_BUILDER]: LONG_ONLY,
    [CommandIds.EXTRACT_ELEMENTS]: LONG_ONLY,
    [CommandIds.POPULATE_SETTING_LIB]: LONG_ONLY,
    [CommandIds.POPULATE_SETTING_LIB_INTERNAL]: LONG_ONLY,
    [CommandIds.TAGS_ANALYSIS]: ALL_MODES,
    [CommandIds.STYLE_DISTILLER]: ALL_MODES,
    [CommandIds.CONTEXT_INJECTOR]: LONG_ONLY,
    [CommandIds.CO_WRITING]: LONG_ONLY,
    [CommandIds.SHORT_RESEARCH]: SHORT_ONLY,
    [CommandIds.SHORT_STORY_CORE]: SHORT_ONLY,
    [CommandIds.SHORT_OUTLINE]: SHORT_ONLY,
    [CommandIds.SCRIPT_RESEARCH]: SCRIPT_ONLY,
    [CommandIds.SCRIPT_SCENE_BIBLE]: SCRIPT_ONLY,
    [CommandIds.SCRIPT_OUTLINE]: SCRIPT_ONLY,
    [CommandIds.SCRIPT_STORYBOARD]: SCRIPT_ONLY,
};

/** 提示语里的可读命令名 */
export const COMMAND_MODE_LABELS: Record<string, string> = {
    [CommandIds.PLAN_BOOK]: 'AI全书规划',
    [CommandIds.VOLUME_INTRO]: '全书简介',
    [CommandIds.BATCH_CREATE]: '批量建章',
    [CommandIds.REBUILD_CHAPTERS]: '重建章节',
    [CommandIds.BATCH_CHAPTERS]: '批量写正文',
    [CommandIds.BATCH_NOVELS]: '批量生成章节',
    [CommandIds.CONTINUE_CHAPTERS]: '续写规划',
    [CommandIds.REVIEW_CHAPTER]: '连贯性审查',
    [CommandIds.QUALITY_DASHBOARD]: '质量仪表盘',
    [CommandIds.CHAPTER_SETTLEMENT]: '章节结算',
    [CommandIds.CROSS_VOLUME_STATE]: '跨卷状态继承',
    [CommandIds.NARRATIVE_OVERVIEW]: '叙事总览',
    [CommandIds.STEP_RESULT_VIEWER]: '步骤结果查看',
    [CommandIds.STORY_LINKAGE_BOARD]: '故事联动看板',
    [CommandIds.BATCH_DECONSTRUCT]: '批量拆书',
    [CommandIds.ADD_FANFIC]: '添加同人设定',
    [CommandIds.CHARACTER_RECOGNITION]: '角色识别审核',
    [CommandIds.WORLDVIEW]: '生成世界观',
    [CommandIds.CHARACTER]: '生成人物',
    [CommandIds.FACTION]: '生成势力',
    [CommandIds.LOCATION]: '生成地点',
    [CommandIds.ITEM]: '生成物品功法',
    [CommandIds.ENTITY_MANAGER]: '实体管理',
    [CommandIds.ENTITY_GENERATE]: '统一生成实体',
    [CommandIds.AI_BUILDER]: 'AI世界元素生成',
    [CommandIds.EXTRACT_ELEMENTS]: 'AI 元素提取',
    [CommandIds.POPULATE_SETTING_LIB]: '从世界观生成设定库',
    [CommandIds.POPULATE_SETTING_LIB_INTERNAL]: '从世界观生成设定库',
    [CommandIds.TAGS_ANALYSIS]: '作品标签分析',
    [CommandIds.STYLE_DISTILLER]: '文笔风格蒸馏',
    [CommandIds.CONTEXT_INJECTOR]: '上下文注入',
    [CommandIds.CO_WRITING]: '句级协同写作',
    [CommandIds.SHORT_RESEARCH]: '短篇前期调研',
    [CommandIds.SHORT_STORY_CORE]: '短篇故事核',
    [CommandIds.SHORT_OUTLINE]: '短篇分节大纲',
    [CommandIds.SCRIPT_RESEARCH]: '剧本前期调研',
    [CommandIds.SCRIPT_SCENE_BIBLE]: '剧本场景圣经',
    [CommandIds.SCRIPT_OUTLINE]: '剧本分集大纲',
    [CommandIds.SCRIPT_STORYBOARD]: '剧本分镜表',
};

/**
 * 返回该命令允许的模式；未登记返回 null（不限制）
 *
 * @param commandId - 命令ID
  * @returns 结果数组 或 null
 */
export function commandAllowedModes(commandId: string): CreationMode[] | null {
    return COMMAND_MODE_RULES[commandId] ?? null;
}

export function isCommandAllowedInMode(commandId: string, mode: CreationMode): boolean | null {
    const allowed = commandAllowedModes(commandId);
    if (!allowed) return null;
    return allowed.includes(mode);
}
