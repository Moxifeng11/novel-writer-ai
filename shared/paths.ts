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
/**
 * pjProjectMeta：返回路径 ``${project}/.project``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjProjectMeta(project: string) { return `${project}/.project`; }
/**
 * pjConfig：返回路径 ``${project}/config``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjConfig(project: string) { return `${project}/config`; }

// ------------------------------------------------------------
// v31: `.project` 是点文件，Obsidian 不会把点文件纳入 vault 索引，
// 因此 `app.vault.getAbstractFileByPath('xxx/.project')` 恒为 null，
// 进而 `vault.read` 无法读取，导致题材/类型/同人策略等元数据全部静默丢失。
// 统一改走 adapter（直接读底层文件系统），下列助手集中封装这一行为。
// ------------------------------------------------------------

/**
 * 读取 `.project` 原始内容；点文件需走 adapter，读不到返回 null
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns 文本结果 或 null
 */
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

/**
 * 同步判断项目是否存在：用项目文件夹（被索引）替代不被索引的 `.project` 点文件
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 是否成功
 */
export function isProjectFolder(
    app: { vault: { getAbstractFileByPath(p: string): unknown } },
    project: string,
): boolean {
    return app.vault.getAbstractFileByPath(project) != null;
}
/** v4.0 相对子目录常量（项目名之下的相对路径，供需要 relative folder 的 API 复用） */
export const SUBDIR_WORLD_ARCH = '01-世界架构';
/**
 * 路径常量 SUBDIR_CHARS：``${SUBDIR_WORLD_ARCH}/人物``。
 */
export const SUBDIR_CHARS = `${SUBDIR_WORLD_ARCH}/人物`;
/**
 * 路径常量 SUBDIR_LOCS：``${SUBDIR_WORLD_ARCH}/地点``。
 */
export const SUBDIR_LOCS = `${SUBDIR_WORLD_ARCH}/地点`;
/**
 * 路径常量 SUBDIR_FACTIONS：``${SUBDIR_WORLD_ARCH}/势力``。
 */
export const SUBDIR_FACTIONS = `${SUBDIR_WORLD_ARCH}/势力`;
/**
 * 路径常量 SUBDIR_ITEMS：``${SUBDIR_WORLD_ARCH}/物品功法``。
 */
export const SUBDIR_ITEMS = `${SUBDIR_WORLD_ARCH}/物品功法`;
/**
 * 路径常量 SUBDIR_WORLDVIEW_FILE：``${SUBDIR_WORLD_ARCH}/世界观总览.md``。
 */
export const SUBDIR_WORLDVIEW_FILE = `${SUBDIR_WORLD_ARCH}/世界观总览.md`;
/**
 * 路径常量 SUBDIR_SETTING_LIB_FILE：``${SUBDIR_WORLD_ARCH}/设定库.md``。
 */
export const SUBDIR_SETTING_LIB_FILE = `${SUBDIR_WORLD_ARCH}/设定库.md`;
/**
 * 路径常量 SUBDIR_WRITING_STYLE_FILE：``${SUBDIR_WORLD_ARCH}/文笔风格.md``。
 */
export const SUBDIR_WRITING_STYLE_FILE = `${SUBDIR_WORLD_ARCH}/文笔风格.md`;

/**
 * pjWorldview：返回路径 ``${project}/${SUBDIR_WORLDVIEW_FILE}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjWorldview(project: string) { return `${project}/${SUBDIR_WORLDVIEW_FILE}`; }
/**
 * v4.0: 设定库移入 01-世界架构/
 *
 * @param project - 项目（路径或对象）
 */
export function pjSettingLib(project: string) { return `${project}/${SUBDIR_SETTING_LIB_FILE}`; }
/**
 * v4.0: 文笔风格移入 01-世界架构/
 *
 * @param project - 项目（路径或对象）
 */
export function pjWritingStyle(project: string) { return `${project}/${SUBDIR_WRITING_STYLE_FILE}`; }
/** 写作规则在 00-系统模板/，项目创建时复制 */
/**
 * 从文件路径解析项目根（P1-4）。
 *
 * 旧实现取路径首段：`长篇小说/书名/...` → `长篇小说`，而缓存键用完整项目路径，
 * 失效永不命中（只能等 TTL）。这里优先在已知项目键里做最长前缀匹配，找不到才退回首段。
 * @param filePath - 文件路径
 * @param candidates - 候选
  * @returns 文本结果 或 null
 */
export function matchProjectFromPath(filePath: string, candidates: Iterable<string>): string | null {
    const path = String(filePath || '').split('\\').join('/');
    if (!path) return null;
    let best = '';
    for (const candidate of candidates) {
        const project = String(candidate || '').trim();
        if (!project) continue;
        if (project.length <= best.length) continue;
        if (path === project || path.startsWith(`${project}/`)) best = project;
    }
    if (best) return best;
    const first = path.split('/')[0];
    return first || null;
}

/**
 * pjWritingRules：返回路径 ``${project}/00-系统模板/写作规则.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjWritingRules(project: string) { return `${project}/00-系统模板/写作规则.md`; }
/**
 * 弱/强写作对照库
 *
 * @param project - 项目（路径或对象）
 */
export function pjContrastLibrary(project: string) { return `${project}/00-系统模板/写作对照库.md`; }
/**
 * 角色弧线表
 *
 * @param project - 项目（路径或对象）
 */
export function pjCharacterArcTable(project: string) { return `${project}/${SUBDIR_WORLD_ARCH}/角色弧线.md`; }

// ============================================================
// 3. 实体
// ============================================================

/**
 * 净化用户/AI 提供的名称段，防止路径穿越与非法文件名（技术审计 F5）。
 *
 * 规则：
 * - 剥离控制字符与两侧空白
 * - 路径分隔符等文件系统非法字符（\\ / : * ? " < > |）替换为 _
 * - 剥离首尾的 `.`（消除 `..` 段，杜绝 `../` 逃逸出 vault 与 Windows 尾点问题）
 * - 净化后为空时返回 '未命名'，保证调用方恒拿到可用相对段
 *
 * 例：`../../evil` → `_.._evil`；`C:\x` → `C__x`；`林晚舟` → `林晚舟`。
 * @param name - 名称
 * @returns 文本结果
 */
export function sanitizeName(name: string): string {
    const cleaned = name
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim()
        .replace(/^\.+/, '')
        .replace(/\.+$/, '');
    return cleaned || '未命名';
}

/**
 * pjCharsDir：返回路径 ``${project}/${SUBDIR_CHARS}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjCharsDir(project: string) { return `${project}/${SUBDIR_CHARS}`; }
/**
 * pjLocsDir：返回路径 ``${project}/${SUBDIR_LOCS}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjLocsDir(project: string) { return `${project}/${SUBDIR_LOCS}`; }
/**
 * pjFactionsDir：返回路径 ``${project}/${SUBDIR_FACTIONS}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjFactionsDir(project: string) { return `${project}/${SUBDIR_FACTIONS}`; }
/**
 * pjItemsDir：返回路径 ``${project}/${SUBDIR_ITEMS}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjItemsDir(project: string) { return `${project}/${SUBDIR_ITEMS}`; }
/**
 * pjCharFile：返回路径 ``${project}/${SUBDIR_CHARS}/${sanitizeName(name)}.md``。
 *
 * @param project - 项目路径
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function pjCharFile(project: string, name: string) { return `${project}/${SUBDIR_CHARS}/${sanitizeName(name)}.md`; }
/**
 * pjLocFile：返回路径 ``${project}/${SUBDIR_LOCS}/${sanitizeName(name)}.md``。
 *
 * @param project - 项目路径
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function pjLocFile(project: string, name: string) { return `${project}/${SUBDIR_LOCS}/${sanitizeName(name)}.md`; }
/**
 * pjFactionFile：返回路径 ``${project}/${SUBDIR_FACTIONS}/${sanitizeName(name)}.md``。
 *
 * @param project - 项目路径
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function pjFactionFile(project: string, name: string) { return `${project}/${SUBDIR_FACTIONS}/${sanitizeName(name)}.md`; }
/**
 * pjItemFile：返回路径 ``${project}/${SUBDIR_ITEMS}/${sanitizeName(name)}.md``。
 *
 * @param project - 项目路径
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function pjItemFile(project: string, name: string) { return `${project}/${SUBDIR_ITEMS}/${sanitizeName(name)}.md`; }

// ============================================================
// 4. 大纲 / 章节 (v4.0 重构)
// ============================================================

/**
 * 大纲章节根目录
 *
 * @param project - 项目（路径或对象）
 */
export function pjOutlineDir(project: string) { return `${project}/03-大纲与章节`; }

// ---- 4a. 正文 ----
/**
 * 某卷正文目录
 *
 * @param project - 项目（路径或对象）
 * @param volN - 卷编号
 */
export function pjBodyDir(project: string, volN: number) { return `${project}/03-大纲与章节/正文/第${volN}卷`; }
/**
 * 某章正文文件
 *
 * @param project - 项目（路径或对象）
 * @param volN - 卷编号
 * @param chapN - 章号
 */
export function pjBodyFile(project: string, volN: number, chapN: number) { return `${pjBodyDir(project, volN)}/第${chapN}章_正文.md`; }

// ---- 4b. 步骤结果 ----
/**
 * 某章步骤结果目录
 *
 * @param project - 项目（路径或对象）
 * @param volN - 卷编号
 * @param chapN - 章号
 */
export function pjStepDir(project: string, volN: number, chapN: number) { return `${project}/03-大纲与章节/步骤结果/第${volN}卷/第${chapN}章`; }
/**
 * 某章的某步骤文件（匹配元文件命名：第X章_类型.md）
 *
 * @param project - 项目（路径或对象）
 * @param volN - 卷编号
 * @param chapN - 章号
 * @param stepType - 步骤类型
 */
export function pjStepFile(project: string, volN: number, chapN: number, stepType: string) { return `${pjStepDir(project, volN, chapN)}/第${chapN}章_${stepType}.md`; }

// ---- 4c. 分卷大纲 ----
/**
 * 分卷大纲目录
 *
 * @param project - 项目（路径或对象）
 */
export function pjVolumeOutlineDir(project: string) { return `${project}/03-大纲与章节/分卷大纲`; }
/**
 * 某卷分卷大纲文件
 *
 * @param project - 项目（路径或对象）
 * @param volN - 卷编号
 */
export function pjVolumeOutlineFile(project: string, volN: number) { return `${project}/03-大纲与章节/分卷大纲/第${volN}卷_分卷大纲.md`; }

/**
 * 卷目录（正文+步骤结果的父级概念，用于扫描）
 *
 * @param project - 项目（路径或对象）
 * @param n - 编号
 */
export function pjVolumeDir(project: string, n: number) { return `${project}/03-大纲与章节/正文/第${n}卷`; }

// ---- 旧路径（v4.0 废弃，0 调用者，待 Batch-E 移除） ----

// ============================================================
// 5. 时间线 / 伏笔
// ============================================================
/**
 * pjTimelineDir：返回路径 ``${project}/02-时间线与伏笔``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjTimelineDir(project: string) { return `${project}/02-时间线与伏笔`; }
/**
 * pjForeshadowDB：返回路径 ``${project}/02-时间线与伏笔/伏笔库.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjForeshadowDB(project: string) { return `${project}/02-时间线与伏笔/伏笔库.md`; }
/**
 * 承诺/谜团账本
 *
 * @param project - 项目（路径或对象）
 */
export function pjPromiseLedger(project: string) { return `${project}/02-时间线与伏笔/承诺账本.md`; }
/**
 * pjForeshadowTracker：返回路径 ``${project}/04-项目总控/伏笔追踪.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjForeshadowTracker(project: string) { return `${project}/04-项目总控/伏笔追踪.md`; }
/**
 * pjTimelineBoard：返回路径 ``${project}/02-时间线与伏笔/时间线看板.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjTimelineBoard(project: string) { return `${project}/02-时间线与伏笔/时间线看板.md`; }
/**
 * pjMemoryShardsDir：返回路径 ``${project}/02-时间线与伏笔/记忆碎片``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjMemoryShardsDir(project: string) { return `${project}/02-时间线与伏笔/记忆碎片`; }

// ============================================================
// 6. 封面
// ============================================================
/**
 * pjCoverDir：返回路径 ``${project}/封面``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjCoverDir(project: string) { return `${project}/封面`; }
/**
 * pjCoverFile：返回路径 ``${project}/封面/cover.${ext}``。
 *
 * @param project - 项目路径
 * @param ext - 扩展名
 * @returns 拼接后的 vault 相对路径
 */
export function pjCoverFile(project: string, ext: string) { return `${project}/封面/cover.${ext}`; }

// ============================================================
// 7. 模板 (v4.0 升级)
// ============================================================
/**
 * 路径常量 PJ_TEMPLATE_DIR：`'元文件/00-系统模板'`。
 */
export const PJ_TEMPLATE_DIR = '元文件/00-系统模板';
/**
 * 路径常量 PJ_WORLD_ARCH_DIR：`'元文件/01-世界架构'`。
 */
export const PJ_WORLD_ARCH_DIR = '元文件/01-世界架构';
/**
 * 路径常量 PJ_TIMELINE_DIR：`'元文件/02-时间线与伏笔'`。
 */
export const PJ_TIMELINE_DIR = '元文件/02-时间线与伏笔';
/**
 * 路径常量 PJ_OUTLINE_DIR：`'元文件/03-大纲与章节'`。
 */
export const PJ_OUTLINE_DIR = '元文件/03-大纲与章节';
/**
 * 路径常量 PJ_CONTROL_DIR：`'元文件/04-项目总控'`。
 */
export const PJ_CONTROL_DIR = '元文件/04-项目总控';
/**
 * 路径常量 PJ_FANFIC_DIR：`'元文件/05-同人设定库'`。
 */
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
/**
 * 路径常量 PJ_PROMPT_TEMPLATE_DIR：``${PJ_TEMPLATE_DIR}/prompts``。
 */
export const PJ_PROMPT_TEMPLATE_DIR = `${PJ_TEMPLATE_DIR}/prompts`;
/**
 * pjPromptSystemTemplate：返回路径 ``${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-system.md``。
 *
 * @param stepKey - 步骤键
 * @returns 拼接后的 vault 相对路径
 */
export function pjPromptSystemTemplate(stepKey: string) { return `${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-system.md`; }
/**
 * pjPromptUserTemplate：返回路径 ``${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-user.md``。
 *
 * @param stepKey - 步骤键
 * @returns 拼接后的 vault 相对路径
 */
export function pjPromptUserTemplate(stepKey: string) { return `${PJ_PROMPT_TEMPLATE_DIR}/${stepKey}-user.md`; }
/**
 * pjWritingRulesPromptTemplate：返回路径 ``${PJ_PROMPT_TEMPLATE_DIR}/writing-rules.md``。
 *
 * @returns 拼接后的 vault 相对路径
 */
export function pjWritingRulesPromptTemplate() { return `${PJ_PROMPT_TEMPLATE_DIR}/writing-rules.md`; }

// ============================================================
// 8. 同人设定库
// ============================================================
/**
 * v4.0: 99- → 05-
 *
 * @param project - 项目（路径或对象）
 */
export function pjFanficDir(project: string) { return `${project}/05-同人设定库`; }
/**
 * pjFanficFile：返回路径 ``${project}/05-同人设定库/${sanitizeName(name)}.md``。
 *
 * @param project - 项目路径
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function pjFanficFile(project: string, name: string) { return `${project}/05-同人设定库/${sanitizeName(name)}.md`; }
/**
 * 同人设定草稿（未通过人工审核，不得绑定到项目）
 *
 * @param project - 项目（路径或对象）
 */
export function pjFanficPendingDir(project: string) { return `${project}/05-同人设定库/_待审核`; }
/**
 * 同人考据资料缓存（来源、摘录、哈希）
 *
 * @param project - 项目（路径或对象）
 * @param workName - 作品名
 */
export function pjFanficResearchDir(project: string, workName: string) { return `${project}/05-同人设定库/_资料/${sanitizeName(workName)}`; }
/**
 * 人工审核记录 sidecar
 *
 * @param project - 项目（路径或对象）
 */
export function pjFanficAuditDir(project: string) { return `${project}/05-同人设定库/_审核`; }
/**
 * 审核通过的正式同人设定路径
 *
 * @param project - 项目（路径或对象）
 * @param workName - 作品名
 */
export function pjFanficApprovedFile(project: string, workName: string) { return `${pjFanficDir(project)}/${sanitizeName(workName)}设定.md`; }

// ============================================================
// 9. 项目总控
// ============================================================
/**
 * pjControlDir：返回路径 ``${project}/04-项目总控``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjControlDir(project: string) { return `${project}/04-项目总控`; }

// ============================================================
// 10. 写作规则（模板路径）
// ============================================================
/**
 * 路径常量 WRITING_RULES_PATH_PROJECT：`'00-系统模板/写作规则.md'`。
 */
export const WRITING_RULES_PATH_PROJECT = '00-系统模板/写作规则.md';
/**
 * 路径常量 WRITING_RULES_PATH_TEMPLATE：``${PJ_TEMPLATE_DIR}/写作规则.md``。
 */
export const WRITING_RULES_PATH_TEMPLATE = `${PJ_TEMPLATE_DIR}/写作规则.md`;
/**
 * pjWritingRulesTemplate：返回路径 `WRITING_RULES_PATH_TEMPLATE`。
 *
 * @returns 拼接后的 vault 相对路径
 */
export function pjWritingRulesTemplate() { return WRITING_RULES_PATH_TEMPLATE; }

// ============================================================
// 11. 别名函数（更具可读性的 API）
// ============================================================
/**
 * getWorldviewPath：返回路径 `pjWorldview(project)`。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function getWorldviewPath(project: string): string { return pjWorldview(project); }
/**
 * getSettingLibPath：返回路径 `pjSettingLib(project)`。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function getSettingLibPath(project: string): string { return pjSettingLib(project); }
/**
 * getWritingStylePath：返回路径 `pjWritingStyle(project)`。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function getWritingStylePath(project: string): string { return pjWritingStyle(project); }
/**
 * getLegacyWritingStylePath：返回路径 ``${project}/文笔风格.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function getLegacyWritingStylePath(project: string): string { return `${project}/文笔风格.md`; }
/**
 * getVolumeOutlinePath：返回路径 `pjVolumeOutlineFile(project, 1)`。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function getVolumeOutlinePath(project: string): string { return pjVolumeOutlineFile(project, 1); }

// ============================================================
// 12. 项目总控文件
// ============================================================
/**
 * 信息债看板
 *
 * @param project - 项目（路径或对象）
 */
export function pjInfoDebtBoard(project: string) { return `${project}/04-项目总控/信息债看板.md`; }
/**
 * 全书简介多版本目录（v4.18）
 *
 * @param project - 项目（路径或对象）
 */
export function pjSynopsisDir(project: string) { return `${pjControlDir(project)}/全书简介`; }
/**
 * pjSynopsisIndexFile：返回路径 ``${pjSynopsisDir(project)}/index.json``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjSynopsisIndexFile(project: string) { return `${pjSynopsisDir(project)}/index.json`; }
/**
 * pjSynopsisDraftFile：返回路径 ``${pjSynopsisDir(project)}/草稿.md``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault 相对路径
 */
export function pjSynopsisDraftFile(project: string) { return `${pjSynopsisDir(project)}/草稿.md`; }
/**
 * pjSynopsisVersionFile：返回路径 ``${pjSynopsisDir(project)}/${sanitizeName(id)}.md``。
 *
 * @param project - 项目路径
 * @param id - 标识
 * @returns 拼接后的 vault 相对路径
 */
export function pjSynopsisVersionFile(project: string, id: string) { return `${pjSynopsisDir(project)}/${sanitizeName(id)}.md`; }
/**
 * 兼容文件：当前采用版本
 *
 * @param project - 项目（路径或对象）
 */
export function pjSynopsisAdoptedFile(project: string) { return `${pjControlDir(project)}/全书简介.md`; }
/**
 * 叙事总览
 *
 * @param project - 项目（路径或对象）
 */
export function pjNarrativeOverview(project: string) { return `${project}/04-项目总控/叙事总览.md`; }
/**
 * 每章世界状态快照目录
 *
 * @param project - 项目（路径或对象）
 */
export function pjChapterStateSnapshotDir(project: string) { return `${project}/04-项目总控/章节状态快照`; }
/**
 * 第 N 章结束状态快照
 *
 * @param project - 项目（路径或对象）
 * @param chapterNum - 章号
 */
export function pjChapterStateSnapshot(project: string, chapterNum: number) {
    return `${pjChapterStateSnapshotDir(project)}/第${chapterNum}章_状态快照.md`;
}
/**
 * 事实索引（故事质量闭环 Task 11 待确认队列落盘）
 *
 * @param project - 项目（路径或对象）
 */
export function pjFactIndexFile(project: string) { return `${project}/04-项目总控/事实索引.json`; }
/**
 * 生成断点目录（故事质量闭环 Task 7/10 断点落盘）
 *
 * @param project - 项目（路径或对象）
 */
export function pjCheckpointDir(project: string) { return `${project}/04-项目总控/断点`; }

// ============================================================
// 12.1 全局分析报告（与作品无关的平台级数据）
// ============================================================
/** 平台榜单分析目录：不属于任何作品，统一落在元文件全局层，禁止写 vault 根目录 */
export const GLOBAL_RANK_DIR = '元文件/06-榜单分析';
/**
 * globalRankFile：返回路径 ``${GLOBAL_RANK_DIR}/${sanitizeName(name)}.md``。
 *
 * @param name - 实体名
 * @returns 拼接后的 vault 相对路径
 */
export function globalRankFile(name: string) { return `${GLOBAL_RANK_DIR}/${sanitizeName(name)}.md`; }

// ============================================================
// 13. 实体目录常量（供 filter / startsWith 判断使用）
// ============================================================
/**
 * 路径常量 SUBDIR_BODY_ROOT：`'03-大纲与章节/正文'`。
 */
export const SUBDIR_BODY_ROOT = '03-大纲与章节/正文';
/**
 * 路径常量 SUBDIR_STEP_ROOT：`'03-大纲与章节/步骤结果'`。
 */
export const SUBDIR_STEP_ROOT = '03-大纲与章节/步骤结果';
/**
 * 路径常量 SUBDIR_VOLUME_OUTLINE：`'03-大纲与章节/分卷大纲'`。
 */
export const SUBDIR_VOLUME_OUTLINE = '03-大纲与章节/分卷大纲';
/**
 * 路径常量 SUBDIR_OUTLINE_ROOT：`'03-大纲与章节'`。
 */
export const SUBDIR_OUTLINE_ROOT = '03-大纲与章节';
/**
 * 路径常量 SUBDIR_TIMELINE：`'02-时间线与伏笔'`。
 */
export const SUBDIR_TIMELINE = '02-时间线与伏笔';
/**
 * 路径常量 SUBDIR_CONTROL：`'04-项目总控'`。
 */
export const SUBDIR_CONTROL = '04-项目总控';
/**
 * 路径常量 SUBDIR_FANFIC：`'05-同人设定库'`。
 */
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

/**
 * pluginDataDir：返回路径 `PLUGIN_DATA_DIR`。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function pluginDataDir(): string { return PLUGIN_DATA_DIR; }
/**
 * pluginPreferenceFile：返回路径 ``${PLUGIN_DATA_DIR}/${project}-preferences.json``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function pluginPreferenceFile(project: string): string { return `${PLUGIN_DATA_DIR}/${project}-preferences.json`; }
/**
 * pluginStylePatternsFile：返回路径 ``${PLUGIN_DATA_DIR}/${project}-style-patterns.json``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function pluginStylePatternsFile(project: string): string { return `${PLUGIN_DATA_DIR}/${project}-style-patterns.json`; }

// ============================================================
// 15. 写作指纹库
// ============================================================
/**
 * 路径常量 FINGERPRINT_LIBRARY_DIR：`'fingerprint-library'`。
 */
export const FINGERPRINT_LIBRARY_DIR = 'fingerprint-library';
/**
 * 路径常量 GLOBAL_FINGERPRINTS_FILE：`'global-fingerprints.json'`。
 */
export const GLOBAL_FINGERPRINTS_FILE = 'global-fingerprints.json';
/**
 * 路径常量 FINGERPRINT_VECTORS_DIR：`'vectors'`。
 */
export const FINGERPRINT_VECTORS_DIR = 'vectors';
/**
 * 路径常量 PROJECT_FINGERPRINT_LIBRARY_DIR：`'写作指纹库'`。
 */
export const PROJECT_FINGERPRINT_LIBRARY_DIR = '写作指纹库';
/**
 * 路径常量 PROJECT_FINGERPRINTS_FILE：`'project-fingerprints.json'`。
 */
export const PROJECT_FINGERPRINTS_FILE = 'project-fingerprints.json';
/**
 * 路径常量 TEMPLATE_FINGERPRINTS_FILE：`'template-fingerprints.json'`。
 */
export const TEMPLATE_FINGERPRINTS_FILE = 'template-fingerprints.json';
/**
 * 路径常量 PROJECT_GLOBAL_FINGERPRINT_STATE_FILE：`'global-fingerprint-state.json'`。
 */
export const PROJECT_GLOBAL_FINGERPRINT_STATE_FILE = 'global-fingerprint-state.json';
/**
 * 路径常量 FINGERPRINT_INTENSITY_CONFIG_FILE：`'fingerprint-intensity-config.json'`。
 */
export const FINGERPRINT_INTENSITY_CONFIG_FILE = 'fingerprint-intensity-config.json';

/**
 * globalFingerprintLibraryDir：返回路径 ``${pluginDataDir()}/${FINGERPRINT_LIBRARY_DIR}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function globalFingerprintLibraryDir(): string { return `${pluginDataDir()}/${FINGERPRINT_LIBRARY_DIR}`; }
/**
 * globalFingerprintsFile：返回路径 ``${pluginDataDir()}/${GLOBAL_FINGERPRINTS_FILE}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function globalFingerprintsFile(): string { return `${pluginDataDir()}/${GLOBAL_FINGERPRINTS_FILE}`; }
/**
 * globalFingerprintVectorsDir：返回路径 ``${pluginDataDir()}/${FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function globalFingerprintVectorsDir(): string { return `${pluginDataDir()}/${FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}`; }
/**
 * projectFingerprintLibraryDir：返回路径 ``${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function projectFingerprintLibraryDir(project: string): string { return `${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}`; }
/**
 * projectFingerprintsFile：返回路径 ``${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${PROJECT_FINGERPRINTS_FILE}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function projectFingerprintsFile(project: string): string { return `${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${PROJECT_FINGERPRINTS_FILE}`; }
/**
 * projectFingerprintVectorsDir：返回路径 ``${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function projectFingerprintVectorsDir(project: string): string { return `${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}`; }
/**
 * templateFingerprintLibraryDir：返回路径 ``${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function templateFingerprintLibraryDir(): string { return `${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}`; }
/**
 * templateFingerprintsFile：返回路径 ``${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${TEMPLATE_FINGERPRINTS_FILE}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function templateFingerprintsFile(): string { return `${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${TEMPLATE_FINGERPRINTS_FILE}`; }
/**
 * templateFingerprintVectorsDir：返回路径 ``${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function templateFingerprintVectorsDir(): string { return `${PJ_CONTROL_DIR}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_VECTORS_DIR}`; }
/**
 * projectGlobalFingerprintStateFile：返回路径 ``${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${PROJECT_GLOBAL_FINGERPRINT_STATE_FILE}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function projectGlobalFingerprintStateFile(project: string): string { return `${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${PROJECT_GLOBAL_FINGERPRINT_STATE_FILE}`; }
/**
 * projectFingerprintIntensityFile：返回路径 ``${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_INTENSITY_CONFIG_FILE}``。
 *
 * @param project - 项目路径
 * @returns 拼接后的 vault/插件相对路径
 */
export function projectFingerprintIntensityFile(project: string): string { return `${pjControlDir(project)}/${PROJECT_FINGERPRINT_LIBRARY_DIR}/${FINGERPRINT_INTENSITY_CONFIG_FILE}`; }

// ============================================================
// 16. 写作知识库
// ============================================================
/**
 * 路径常量 DEFAULT_KNOWLEDGE_BASE_DIR：`'写作知识库'`。
 */
export const DEFAULT_KNOWLEDGE_BASE_DIR = '写作知识库';
/**
 * 路径常量 KB_INDEX_FILE：`'知识库索引.md'`。
 */
export const KB_INDEX_FILE = '知识库索引.md';
/**
 * 路径常量 KB_TAG_SYSTEM_FILE：`'标签体系.md'`。
 */
export const KB_TAG_SYSTEM_FILE = '标签体系.md';
/**
 * 路径常量 KB_BASIC_INFO_FILE：`'基本信息.md'`。
 */
export const KB_BASIC_INFO_FILE = '基本信息.md';
/**
 * 路径常量 KB_STYLE_FINGERPRINT_FILE：`'风格指纹.json'`。
 */
export const KB_STYLE_FINGERPRINT_FILE = '风格指纹.json';
/**
 * 路径常量 KB_RHYTHM_ANALYSIS_FILE：`'节奏分析.md'`。
 */
export const KB_RHYTHM_ANALYSIS_FILE = '节奏分析.md';
/**
 * 路径常量 KB_WRITING_TECHNIQUES_FILE：`'写作技巧.md'`。
 */
export const KB_WRITING_TECHNIQUES_FILE = '写作技巧.md';
/**
 * 路径常量 KB_STRUCTURE_BREAKDOWN_FILE：`'结构拆解.md'`。
 */
export const KB_STRUCTURE_BREAKDOWN_FILE = '结构拆解.md';
/**
 * 路径常量 KB_CHARACTER_EXTRACTION_FILE：`'人设提取.md'`。
 */
export const KB_CHARACTER_EXTRACTION_FILE = '人设提取.md';
/**
 * 路径常量 KB_FORESHADOW_DB_FILE：`'伏笔库.md'`。
 */
export const KB_FORESHADOW_DB_FILE = '伏笔库.md';
/**
 * 路径常量 KB_COMMERCIAL_ANALYSIS_FILE：`'商业价值.md'`。
 */
export const KB_COMMERCIAL_ANALYSIS_FILE = '商业价值.md';
/**
 * 路径常量 KB_READABILITY_ANALYSIS_FILE：`'可读性分析.md'`。
 */
export const KB_READABILITY_ANALYSIS_FILE = '可读性分析.md';
/**
 * 路径常量 KB_BREAKDOWN_LOG_FILE：`'拆解日志.md'`。
 */
export const KB_BREAKDOWN_LOG_FILE = '拆解日志.md';
/**
 * 路径常量 KB_VECTORS_DIR：`'knowledge-vectors'`。
 */
export const KB_VECTORS_DIR = 'knowledge-vectors';
/**
 * 路径常量 KB_CONFIG_DIR：`'_config'`。
 */
export const KB_CONFIG_DIR = '_config';
/**
 * 路径常量 KB_CONFIG_FILE：`'knowledge-base-config.json'`。
 */
export const KB_CONFIG_FILE = 'knowledge-base-config.json';
/**
 * 路径常量 KB_IMPORT_HISTORY_FILE：`'import-history.json'`。
 */
export const KB_IMPORT_HISTORY_FILE = 'import-history.json';
/**
 * 路径常量 KB_IMPORT_PRESETS_FILE：`'import-presets.json'`。
 */
export const KB_IMPORT_PRESETS_FILE = 'import-presets.json';

/**
 * kbKnowledgeBaseDir：返回路径 `baseDir || DEFAULT_KNOWLEDGE_BASE_DIR`。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbKnowledgeBaseDir(baseDir?: string): string { return baseDir || DEFAULT_KNOWLEDGE_BASE_DIR; }
/**
 * kbConfigDir：返回路径 ``${kbKnowledgeBaseDir(baseDir)}/${KB_CONFIG_DIR}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbConfigDir(baseDir?: string): string { return `${kbKnowledgeBaseDir(baseDir)}/${KB_CONFIG_DIR}`; }
/**
 * kbConfigFile：返回路径 ``${kbConfigDir(baseDir)}/${KB_CONFIG_FILE}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbConfigFile(baseDir?: string): string { return `${kbConfigDir(baseDir)}/${KB_CONFIG_FILE}`; }
/**
 * kbIndexFile：返回路径 ``${kbKnowledgeBaseDir(baseDir)}/${KB_INDEX_FILE}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbIndexFile(baseDir?: string): string { return `${kbKnowledgeBaseDir(baseDir)}/${KB_INDEX_FILE}`; }
/**
 * kbTagSystemFile：返回路径 ``${kbKnowledgeBaseDir(baseDir)}/${KB_TAG_SYSTEM_FILE}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbTagSystemFile(baseDir?: string): string { return `${kbKnowledgeBaseDir(baseDir)}/${KB_TAG_SYSTEM_FILE}`; }
export function kbBookDir(bookName: string, baseDir?: string): string {
    // F5：sanitizeName 在原字符替换基础上补 `..` 段剥离，防止书名逃逸出知识库目录
    const safeBookName = sanitizeName(bookName);
    return `${kbKnowledgeBaseDir(baseDir)}/${safeBookName}`;
}
/**
 * kbBookBasicInfoFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_BASIC_INFO_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookBasicInfoFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_BASIC_INFO_FILE}`; }
/**
 * kbBookStyleFingerprintFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_STYLE_FINGERPRINT_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookStyleFingerprintFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_STYLE_FINGERPRINT_FILE}`; }
/**
 * kbBookRhythmAnalysisFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_RHYTHM_ANALYSIS_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookRhythmAnalysisFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_RHYTHM_ANALYSIS_FILE}`; }
/**
 * kbBookWritingTechniquesFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_WRITING_TECHNIQUES_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookWritingTechniquesFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_WRITING_TECHNIQUES_FILE}`; }
/**
 * kbBookStructureBreakdownFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_STRUCTURE_BREAKDOWN_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookStructureBreakdownFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_STRUCTURE_BREAKDOWN_FILE}`; }
/**
 * kbBookCharacterExtractionFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_CHARACTER_EXTRACTION_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookCharacterExtractionFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_CHARACTER_EXTRACTION_FILE}`; }
/**
 * kbBookForeshadowDBFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_FORESHADOW_DB_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookForeshadowDBFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_FORESHADOW_DB_FILE}`; }
/**
 * kbBookCommercialAnalysisFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_COMMERCIAL_ANALYSIS_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookCommercialAnalysisFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_COMMERCIAL_ANALYSIS_FILE}`; }
/**
 * kbBookReadabilityAnalysisFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_READABILITY_ANALYSIS_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookReadabilityAnalysisFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_READABILITY_ANALYSIS_FILE}`; }
/**
 * kbBookBreakdownLogFile：返回路径 ``${kbBookDir(bookName, baseDir)}/${KB_BREAKDOWN_LOG_FILE}``。
 *
 * @param bookName - 书名
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbBookBreakdownLogFile(bookName: string, baseDir?: string): string { return `${kbBookDir(bookName, baseDir)}/${KB_BREAKDOWN_LOG_FILE}`; }
/**
 * kbVectorsDir：返回路径 ``${pluginDataDir()}/${KB_VECTORS_DIR}``。
 *
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbVectorsDir(): string { return `${pluginDataDir()}/${KB_VECTORS_DIR}`; }
/**
 * kbImportHistoryFile：返回路径 ``${kbConfigDir(baseDir)}/${KB_IMPORT_HISTORY_FILE}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbImportHistoryFile(baseDir?: string): string { return `${kbConfigDir(baseDir)}/${KB_IMPORT_HISTORY_FILE}`; }
/**
 * kbImportPresetsFile：返回路径 ``${kbConfigDir(baseDir)}/${KB_IMPORT_PRESETS_FILE}``。
 *
 * @param baseDir - 参数
 * @returns 拼接后的 vault/插件相对路径
 */
export function kbImportPresetsFile(baseDir?: string): string { return `${kbConfigDir(baseDir)}/${KB_IMPORT_PRESETS_FILE}`; }

// ============================================================
// 17. 版本管理
// ============================================================
/** 项目内版本目录 */
export const PROJECT_VERSIONS_DIR = '_versions';
/** 版本索引文件名 */
export const VERSION_INDEX_FILE = 'versions.json';
/** 回滚历史文件名 */
export const ROLLBACK_HISTORY_FILE = 'rollback-history.json';

/**
 * 项目内版本根目录
 *
 * @param project - 项目（路径或对象）
 */
export function pjVersionsDir(project: string): string { return `${project}/${PROJECT_VERSIONS_DIR}`; }

/**
 * 某内容类型的版本目录
 *
 * @param project - 项目（路径或对象）
 * @param contentType - 内容类型
 * @returns 文本结果
 */
export function pjContentTypeVersionsDir(project: string, contentType: string): string {
    return `${pjVersionsDir(project)}/${contentType}`;
}

/**
 * 某内容的版本目录（按内容 key 分目录）
 *
 * @param project - 项目（路径或对象）
 * @param contentType - 内容类型
 * @param contentKey - 内容键
 * @returns 文本结果
 */
export function pjContentVersionsDir(project: string, contentType: string, contentKey: string): string {
    const safeKey = contentKey.replace(/[\\/:*?"<>|]/g, '_');
    return `${pjContentTypeVersionsDir(project, contentType)}/${safeKey}`;
}

/**
 * 从项目内任意路径推断项目 ID。
 *
 * 结构有两代：v4+ 为「长篇小说/书名/03-…」，旧版为「书名/03-…」。
 * 直接 `split('/')[0]` 在 v4 结构下会把「长篇小说」当项目，导致版本历史/项目级缓存落到错误目录。
 * 规则：定位已知子目录（03-大纲与章节 等），取它前面最多两段；找不到就退回前两段。
 * @param filePath - 文件路径
 * @returns 文本结果
 */
export function projectIdFromPath(filePath: string): string {
    const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) return '';
    const markers = ['03-大纲与章节', '03-正文', '04-项目总控', '02-时间线与伏笔', '01-设定库', '00-系统模板'];
    const idx = parts.findIndex(part => markers.includes(part));
    if (idx > 0) return parts.slice(Math.max(0, idx - 2), idx).join('/');
    return parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0];
}

/** 从正文/步骤路径反解出的章节定位 */
export interface ChapterLocation {
    project: string;
    volume: string;
    chapterNum: number;
    chapterName: string;
}

/**
 * 章节路径的单一解析入口（B2）。
 *
 * 旧实现有三份：core/command-registry 只认「第N章_正文.md」，
 * main.ts 允许带标题，ui/full-writer-utils 用 `split('/')[0]` 取项目
 * （v4 结构下会把「长篇小说」当项目）。这里统一：
 *   - 正文：<项目>/03-大纲与章节/正文/第N卷/第M章[_标题]_正文.md
 *   - 步骤：<项目>/03-大纲与章节/步骤结果/第N卷/第M章/...
 * 其它路径返回 null，由调用方决定回退。
 * @param filePath - 文件路径
  * @returns ChapterLocation 或 null
 */
export function parseChapterLocation(filePath: string): ChapterLocation | null {
    const path = String(filePath || '').replace(/\\/g, '/');
    if (!path) return null;

    const body = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第(\d+)卷)\/(第(\d+)章)(?:_[^/]*)?_正文\.md$/);
    if (body) {
        const chapterNum = parseInt(body[5], 10);
        if (!Number.isFinite(chapterNum)) return null;
        return {
            project: body[1],
            volume: body[2],
            chapterNum,
            chapterName: `第${chapterNum}章`,
        };
    }

    const step = path.match(/^(.+?)\/03-大纲与章节\/步骤结果\/(第(\d+)卷)\/(第(\d+)章)(?:\/|$)/);
    if (step) {
        const chapterNum = parseInt(step[5], 10);
        if (!Number.isFinite(chapterNum)) return null;
        return {
            project: step[1],
            volume: step[2],
            chapterNum,
            chapterName: `第${chapterNum}章`,
        };
    }

    return null;
}

/**
 * 版本索引文件路径
 *
 * @param project - 项目（路径或对象）
 * @param contentType - 内容类型
 * @param contentKey - 内容键
 * @returns 文本结果
 */
export function pjVersionIndexFile(project: string, contentType: string, contentKey: string): string {
    return `${pjContentVersionsDir(project, contentType, contentKey)}/${VERSION_INDEX_FILE}`;
}

/**
 * 具体版本内容文件路径
 *
 * @param project - 项目（路径或对象）
 * @param contentType - 内容类型
 * @param contentKey - 内容键
 * @param versionId - 版本ID
 * @returns 文本结果
 */
export function pjVersionContentFile(project: string, contentType: string, contentKey: string, versionId: string): string {
    return `${pjContentVersionsDir(project, contentType, contentKey)}/${versionId}.md`;
}

/**
 * 回滚历史文件路径
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function pjRollbackHistoryFile(project: string): string {
    return `${pjVersionsDir(project)}/${ROLLBACK_HISTORY_FILE}`;
}

/** 插件数据目录中的版本目录（备用存储位置） */
export function pluginVersionsDir(): string { return `${pluginDataDir()}/versions`; }

