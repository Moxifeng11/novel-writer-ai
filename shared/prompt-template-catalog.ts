/**
 * prompt-template-catalog.ts — 可自定义提示词模板的唯一清单
 *
 * 之前只活在 ui/template-manager.ts；AssetRegistry（engine 层）也要枚举模板来源，
 * 所以把清单下沉到 shared，UI 侧保留 re-export 兼容。
 */
import { PJ_PROMPT_TEMPLATE_DIR } from './paths';

/** 模板分类。 */
export type TemplateCategory = 'step' | 'worldview' | 'entity' | 'deai';

/** 模板定义（不含运行时状态）。 */
export interface TemplateCatalogEntry {
    key: string;
    name: string;
    category: TemplateCategory;
    categoryName: string;
    systemPath: string;
    userPath: string;
}

/** 所有支持的模板类型定义 */
export const ALL_TEMPLATE_DEFS: TemplateCatalogEntry[] = [
    // 步骤模板
    { key: 'infoPlan', name: '信息规划', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/infoPlan-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/infoPlan-user.md` },
    { key: 'plotDistill', name: '情节蒸馏', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/plotDistill-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/plotDistill-user.md` },
    { key: 'outline', name: '大纲摘要', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/outline-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/outline-user.md` },
    { key: 'emotionPlan', name: '情绪规划', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/emotionPlan-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/emotionPlan-user.md` },
    { key: 'sceneExpand', name: 'Scene展开', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/sceneExpand-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/sceneExpand-user.md` },
    { key: 'characterSoul', name: '角色灵魂', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/characterSoul-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/characterSoul-user.md` },
    { key: 'qualityControl', name: '质量控制', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/qualityControl-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/qualityControl-user.md` },
    { key: 'selfCheck', name: 'AI自检', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/selfCheck-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/selfCheck-user.md` },
    { key: 'fix', name: '修正优化', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/fix-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/fix-user.md` },
    { key: 'finalFix', name: '最终修正', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/finalFix-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/finalFix-user.md` },
    { key: 'continuityCheck', name: '连贯性审查', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/continuityCheck-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/continuityCheck-user.md` },
    { key: 'analysisReport', name: '分析报告', category: 'step', categoryName: '步骤模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/analysisReport-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/analysisReport-user.md` },
    // 世界观/实体模板
    { key: 'worldviewSkeleton', name: '世界观骨架', category: 'worldview', categoryName: '世界观模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/worldviewSkeleton-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/worldviewSkeleton-user.md` },
    { key: 'worldviewModule', name: '世界观模块', category: 'worldview', categoryName: '世界观模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/worldviewModule-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/worldviewModule-user.md` },
    { key: 'settingLib', name: '设定库', category: 'worldview', categoryName: '世界观模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/settingLib-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/settingLib-user.md` },
    { key: 'character', name: '人物生成', category: 'entity', categoryName: '实体模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/character-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/character-user.md` },
    { key: 'faction', name: '势力生成', category: 'entity', categoryName: '实体模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/faction-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/faction-user.md` },
    { key: 'location', name: '地点生成', category: 'entity', categoryName: '实体模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/location-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/location-user.md` },
    { key: 'item', name: '物品功法', category: 'entity', categoryName: '实体模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/item-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/item-user.md` },
    // DEAI 模板
    { key: 'deaiCheck', name: 'DEAI检测', category: 'deai', categoryName: 'DEAI模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/deaiCheck-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/deaiCheck-user.md` },
    { key: 'deaiRewrite', name: 'DEAI改写', category: 'deai', categoryName: 'DEAI模板', systemPath: `${PJ_PROMPT_TEMPLATE_DIR}/deaiRewrite-system.md`, userPath: `${PJ_PROMPT_TEMPLATE_DIR}/deaiRewrite-user.md` },
];

