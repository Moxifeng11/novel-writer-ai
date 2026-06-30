/**
 * paths.ts — 项目内标准路径构建函数 (v4.0)
 *
 * 目的：消除硬编码路径拼接，项目结构变更时只需修改本文件。
 *
 * v4.0 变更：
 * - 设定库/文笔风格 从根目录移入 01-世界架构/
 * - 章节结构从 第X卷/第X章/*.md 改为 正文/ + 步骤结果/ 双目录
 * - 分卷大纲改为按卷归档 分卷大纲/第X卷_分卷大纲.md
 * - 模板已升级为 v4.0（去 _v4 后缀）
 * - 同人设定库 99- → 05-
 *
 * ⚠️ 平台适配说明：
 * - 纯路径函数（pjProjectMeta, pjCharsDir 等）：无平台依赖，全项目通用
 * - 以下函数是平台适配层，专门封装 Obsidian 特殊行为：
 *   - readProjectMeta(): 封装点文件读取（.project 是点文件，vault API 读不到，需用 adapter）
 *   - isProjectFolder(): 封装项目目录检测
 *   这些函数保留在 paths.ts 中作为平台适配层，但应尽量减少使用。
 */

// ============================================================
// 1. 项目元数据
// ============================================================
export function pjProjectMeta(project: string) { return `${project}/.project`; }
export function pjConfig(project: string) { return `${project}/config`; }

// ------------------------------------------------------------
// v31: `.project` 是点文件，Obsidian 不会把点文件纳入 vault 索引，
// 因此 `app.vault.getAbstractFileByPath('xxx/.project')` 恒为 null，
// 进而 `vault.read` 无法读取，导致题材/类型/同人策略等元数据全部静默丢失。
// 统一改走 adapter（直接读底层文件系统），下列助手集中封装这一行为。
// ------------------------------------------------------------

/** 读取 `.project` 原始内容；点文件需走 adapter，读不到返回 null */
export async function readProjectMeta(
    app: { vault: { adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string> } } },
    project: string,
): Promise<string | null> {
    const path = pjProjectMeta(project);
    try {
        if (!(await app.vault.adapter.exists(path))) return null;
        return await app.vault.adapter.read(path);
    } catch {
        return null;
    }
}

/** 同步判断项目是否存在：用项目文件夹（被索引）替代不被索引的 `.project` 点文件 */
export function isProjectFolder(
    app: { vault: { getAbstractFileByPath(p: string): unknown } },
    project: string,
): boolean {
    return app.vault.getAbstractFileByPath(project) != null;
}
/** v4.0 相对子目录常量（项目名之下的相对路径，供需要 relative folder 的 API 复用） */
export const SUBDIR_WORLD_ARCH = '01-世界架构';
export const SUBDIR_CHARS = `${SUBDIR_WORLD_ARCH}/人物`;
export const SUBDIR_LOCS = `${SUBDIR_WORLD_ARCH}/地点`;
export const SUBDIR_FACTIONS = `${SUBDIR_WORLD_ARCH}/势力`;
export const SUBDIR_ITEMS = `${SUBDIR_WORLD_ARCH}/物品功法`;
export const SUBDIR_WORLDVIEW_FILE = `${SUBDIR_WORLD_ARCH}/世界观总览.md`;
export const SUBDIR_SETTING_LIB_FILE = `${SUBDIR_WORLD_ARCH}/设定库.md`;
export const SUBDIR_WRITING_STYLE_FILE = `${SUBDIR_WORLD_ARCH}/文笔风格.md`;

export function pjWorldview(project: string) { return `${project}/${SUBDIR_WORLDVIEW_FILE}`; }
/** v4.0: 设定库移入 01-世界架构/ */
export function pjSettingLib(project: string) { return `${project}/${SUBDIR_SETTING_LIB_FILE}`; }
/** v4.0: 文笔风格移入 01-世界架构/ */
export function pjWritingStyle(project: string) { return `${project}/${SUBDIR_WRITING_STYLE_FILE}`; }
/** 写作规则在 00-系统模板/，项目创建时复制 */
export function pjWritingRules(project: string) { return `${project}/00-系统模板/写作规则.md`; }

// ============================================================
// 3. 实体
// ============================================================
export function pjCharsDir(project: string) { return `${project}/${SUBDIR_CHARS}`; }
export function pjLocsDir(project: string) { return `${project}/${SUBDIR_LOCS}`; }
export function pjFactionsDir(project: string) { return `${project}/${SUBDIR_FACTIONS}`; }
export function pjItemsDir(project: string) { return `${project}/${SUBDIR_ITEMS}`; }
export function pjCharFile(project: string, name: string) { return `${project}/${SUBDIR_CHARS}/${name}.md`; }
export function pjLocFile(project: string, name: string) { return `${project}/${SUBDIR_LOCS}/${name}.md`; }
export function pjFactionFile(project: string, name: string) { return `${project}/${SUBDIR_FACTIONS}/${name}.md`; }
export function pjItemFile(project: string, name: string) { return `${project}/${SUBDIR_ITEMS}/${name}.md`; }

// ============================================================
// 4. 大纲 / 章节 (v4.0 重构)
// ============================================================

/** 大纲章节根目录 */
export function pjOutlineDir(project: string) { return `${project}/03-大纲与章节`; }

// ---- 4a. 正文 ----
/** 某卷正文目录 */
export function pjBodyDir(project: string, volN: number) { return `${project}/03-大纲与章节/正文/第${volN}卷`; }
/** 某章正文文件 */
export function pjBodyFile(project: string, volN: number, chapN: number) { return `${pjBodyDir(project, volN)}/第${chapN}章_正文.md`; }

// ---- 4b. 步骤结果 ----
/** 某章步骤结果目录 */
export function pjStepDir(project: string, volN: number, chapN: number) { return `${project}/03-大纲与章节/步骤结果/第${volN}卷/第${chapN}章`; }
/** 某章的某步骤文件（匹配元文件命名：第X章_类型.md） */
export function pjStepFile(project: string, volN: number, chapN: number, stepType: string) { return `${pjStepDir(project, volN, chapN)}/第${chapN}章_${stepType}.md`; }

// ---- 4c. 分卷大纲 ----
/** 分卷大纲目录 */
export function pjVolumeOutlineDir(project: string) { return `${project}/03-大纲与章节/分卷大纲`; }
/** 某卷分卷大纲文件 */
/** @deprecated v4.0: 使用 pjVolumeOutlineFile(project, 1) 替代（分卷大纲已按卷归档） */
export function pjVolumeOutline(project: string) { return pjVolumeOutlineFile(project, 1); }
export function pjVolumeOutlineFile(project: string, volN: number) { return `${project}/03-大纲与章节/分卷大纲/第${volN}卷_分卷大纲.md`; }

/** 卷目录（正文+步骤结果的父级概念，用于扫描） */
export function pjVolumeDir(project: string, n: number) { return `${project}/03-大纲与章节/正文/第${n}卷`; }

// ---- 旧路径（v4.0 废弃，0 调用者，待 Batch-E 移除） ----
/** @deprecated v4.0: 使用 pjBodyFile / pjStepFile 替代 */
export function pjChapterDir(project: string, volN: number, chapN: number) { return `${project}/03-大纲与章节/第${volN}卷/第${chapN}章`; }

// ============================================================
// 5. 时间线 / 伏笔
// ============================================================
export function pjTimelineDir(project: string) { return `${project}/02-时间线与伏笔`; }
export function pjForeshadowDB(project: string) { return `${project}/02-时间线与伏笔/伏笔库.md`; }
export function pjTimelineBoard(project: string) { return `${project}/02-时间线与伏笔/时间线看板.md`; }
export function pjMemoryShardsDir(project: string) { return `${project}/02-时间线与伏笔/记忆碎片`; }

// ============================================================
// 6. 封面
// ============================================================
export function pjCoverDir(project: string) { return `${project}/封面`; }
export function pjCoverFile(project: string, ext: string) { return `${project}/封面/cover.${ext}`; }

// ============================================================
// 7. 模板 (v4.0 升级)
// ============================================================
export const PJ_TEMPLATE_DIR = '元文件/00-系统模板';
export const PJ_WORLD_ARCH_DIR = '元文件/01-世界架构';
export const PJ_TIMELINE_DIR = '元文件/02-时间线与伏笔';
export const PJ_OUTLINE_DIR = '元文件/03-大纲与章节';
export const PJ_CONTROL_DIR = '元文件/04-项目总控';
export const PJ_FANFIC_DIR = '元文件/05-同人设定库';
/** @deprecated */
export function pjCharTemplate() { return `${PJ_TEMPLATE_DIR}/人物模板.md`; }
/** @deprecated */
export function pjLocTemplate() { return `${PJ_TEMPLATE_DIR}/地点模板.md`; }
/** @deprecated */
export function pjFactionTemplate() { return `${PJ_TEMPLATE_DIR}/势力模板.md`; }
/** @deprecated */
export function pjWritingStyleTemplate() { return `${PJ_TEMPLATE_DIR}/文笔风格模板.md`; }

/** v4.0 新模板 */
/** @deprecated */
export function pjBodyTemplate() { return `${PJ_TEMPLATE_DIR}/正文模板.md`; }
/** @deprecated */
export function pjInfoPlanTemplate() { return `${PJ_TEMPLATE_DIR}/信息规划模板.md`; }
/** @deprecated */
export function pjPlotDistillTemplate() { return `${PJ_TEMPLATE_DIR}/情节蒸馏模板.md`; }
/** @deprecated */
export function pjOutlineTemplate() { return `${PJ_TEMPLATE_DIR}/大纲摘要模板.md`; }
/** @deprecated */
export function pjAnalysisTemplate() { return `${PJ_TEMPLATE_DIR}/分析报告模板.md`; }
/** @deprecated */
export function pjSettlementTemplate() { return `${PJ_TEMPLATE_DIR}/结算表模板.md`; }
/** @deprecated */
export function pjVolumeOutlineTemplate() { return `${PJ_TEMPLATE_DIR}/分卷大纲模板.md`; }
/** @deprecated */
export function pjWorldviewTemplate() { return `${PJ_TEMPLATE_DIR}/世界观模板.md`; }
/** @deprecated */
export function pjItemTemplate() { return `${PJ_TEMPLATE_DIR}/物品模板.md`; }

/** V2 步骤模板 */
/** @deprecated */
export function pjContinuityReviewTemplate() { return `${PJ_TEMPLATE_DIR}/连贯性审查模板.md`; }
/** @deprecated */
export function pjSelfCheckTemplate() { return `${PJ_TEMPLATE_DIR}/自检报告模板.md`; }
/** @deprecated */
export function pjFixTemplate() { return `${PJ_TEMPLATE_DIR}/修正记录模板.md`; }
/** @deprecated */
export function pjFinalFixTemplate() { return `${PJ_TEMPLATE_DIR}/最终修正模板.md`; }
/** @deprecated */
export function pjQualityControlTemplate() { return `${PJ_TEMPLATE_DIR}/质量控制模板.md`; }
/** @deprecated */
export function pjEmotionPlanTemplate() { return `${PJ_TEMPLATE_DIR}/情绪规划模板.md`; }
/** @deprecated */
export function pjSceneExpandTemplate() { return `${PJ_TEMPLATE_DIR}/Scene展开模板.md`; }
/** @deprecated */
export function pjCharacterSoulTemplate() { return `${PJ_TEMPLATE_DIR}/角色灵魂模板.md`; }

// ============================================================
// 7.5 AI Prompt 模板（v4.1.0 P7 新增）
// ============================================================
export const PJ_PROMPT_TEMPLATE_DIR = `${PJ_TEMPLATE_DIR}/prompts`;
export function pjPromptSystemTemplate(stepKey: string) { return `${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-system.md`; }
export function pjPromptUserTemplate(stepKey: string) { return `${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-user.md`; }
export function pjWritingRulesPromptTemplate() { return `${PJ_PROMPT_TEMPLATE_DIR}/writing-rules.md`; }

// ============================================================
// 8. 同人设定库
// ============================================================
/** v4.0: 99- → 05- */
export function pjFanficDir(project: string) { return `${project}/05-同人设定库`; }
export function pjFanficFile(project: string, name: string) { return `${project}/05-同人设定库/${name}.md`; }

// ============================================================
// 9. 项目总控
// ============================================================
export function pjControlDir(project: string) { return `${project}/04-项目总控`; }

// ============================================================
// 10. 写作规则（模板路径）
// ============================================================
export const WRITING_RULES_PATH_PROJECT = '00-系统模板/写作规则.md';
export const WRITING_RULES_PATH_TEMPLATE = `${PJ_TEMPLATE_DIR}/写作规则.md`;
export function pjWritingRulesTemplate() { return WRITING_RULES_PATH_TEMPLATE; }

// ============================================================
// 11. 别名函数（更具可读性的 API）
// ============================================================
export function getWorldviewPath(project: string): string { return pjWorldview(project); }
export function getSettingLibPath(project: string): string { return pjSettingLib(project); }
export function getWritingStylePath(project: string): string { return pjWritingStyle(project); }
export function getLegacyWritingStylePath(project: string): string { return `${project}/文笔风格.md`; }
export function getVolumeOutlinePath(project: string): string { return pjVolumeOutlineFile(project, 1); }

// ============================================================
// 12. 项目总控文件
// ============================================================
/** 信息债看板 */
export function pjInfoDebtBoard(project: string) { return `${project}/04-项目总控/信息债看板.md`; }
/** 叙事总览 */
export function pjNarrativeOverview(project: string) { return `${project}/04-项目总控/叙事总览.md`; }

// ============================================================
// 13. 实体目录常量（供 filter / startsWith 判断使用）
// ============================================================
export const SUBDIR_BODY_ROOT = '03-大纲与章节/正文';
export const SUBDIR_STEP_ROOT = '03-大纲与章节/步骤结果';
export const SUBDIR_VOLUME_OUTLINE = '03-大纲与章节/分卷大纲';
export const SUBDIR_OUTLINE_ROOT = '03-大纲与章节';
export const SUBDIR_TIMELINE = '02-时间线与伏笔';
export const SUBDIR_CONTROL = '04-项目总控';
export const SUBDIR_FANFIC = '05-同人设定库';

export function isInCharsDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_CHARS}/`);
}
export function isInLocsDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_LOCS}/`);
}
export function isInFactionsDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_FACTIONS}/`);
}
export function isInItemsDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_ITEMS}/`);
}
export function isInOutlineDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/03-大纲与章节/`);
}
export function isInBodyDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_BODY_ROOT}/`);
}
export function isInStepDir(project: string, filePath: string): boolean {
    return filePath.startsWith(`${project}/${SUBDIR_STEP_ROOT}/`);
}

// ============================================================
// 14. 插件数据目录（.obsidian/plugins/ 下）
// ============================================================
const PLUGIN_DATA_DIR = '.obsidian/plugins/novel-writer-ai/data';

export function pluginDataDir(): string { return PLUGIN_DATA_DIR; }
export function pluginPreferenceFile(project: string): string { return `${PLUGIN_DATA_DIR}/${project}-preferences.json`; }
export function pluginStylePatternsFile(project: string): string { return `${PLUGIN_DATA_DIR}/${project}-style-patterns.json`; }

