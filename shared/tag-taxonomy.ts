/**
 * tag-taxonomy.ts — 标签分级（双标签并存）
 *
 * 现有标签是扁平中文（正文/人物/分析报告…），和用户私人标签混在标签面板里。
 * 本模块给每个插件标签配一个层级命名空间标签 `nw/...`：
 *  - 写入端：新旧标签并存（只加不删），老项目零破坏；
 *  - 读取端：Obsidian 标签面板会把 `nw/步骤/*`、`nw/实体/*` 折叠成组，
 *    Bases 看板用 `file.hasTag("nw/正文")` 精确筛选。
 *
 * 纯函数，不依赖 Obsidian。
 */
import type { NotebookFileKind } from './frontmatter-schema';

/** 插件标签 → 层级标签（唯一映射源；Bases filter 与写入端都从这里取） */
export const LEGACY_TO_NAMESPACE: Record<string, string> = {
    正文: 'nw/正文',
    短篇正文: 'nw/正文',
    剧本: 'nw/正文',
    人物: 'nw/实体/人物',
    地点: 'nw/实体/地点',
    势力: 'nw/实体/势力',
    物品功法: 'nw/实体/物品',
    物品: 'nw/实体/物品',
    世界观: 'nw/设定/世界观',
    设定库: 'nw/设定/设定库',
    文笔风格: 'nw/设定/文笔风格',
    伏笔库: 'nw/设定/伏笔库',
    时间线: 'nw/设定/时间线',
    关系状态: 'nw/设定/关系状态',
    信息规划: 'nw/步骤/信息规划',
    大纲摘要: 'nw/步骤/大纲摘要',
    情节蒸馏: 'nw/步骤/情节蒸馏',
    分析报告: 'nw/步骤/分析报告',
    结算表: 'nw/步骤/结算表',
    质量控制: 'nw/步骤/质量控制',
    情绪规划: 'nw/步骤/情绪规划',
    'Scene展开': 'nw/步骤/Scene展开',
    角色灵魂: 'nw/步骤/角色灵魂',
    审查报告: 'nw/步骤/审查报告',
    自检报告: 'nw/步骤/自检报告',
    修正记录: 'nw/步骤/修正记录',
    最终修正: 'nw/步骤/最终修正',
    连贯性审查: 'nw/步骤/连贯性审查',
    状态快照: 'nw/设定/状态快照',
    记忆碎片: 'nw/设定/记忆碎片',
};

/** 类型 → 看板 filter 用的命名空间标签 */
export const KIND_NAMESPACE_TAG: Partial<Record<NotebookFileKind, string>> = {
    body: 'nw/正文',
    character: 'nw/实体/人物',
    location: 'nw/实体/地点',
    faction: 'nw/实体/势力',
    item: 'nw/实体/物品',
    worldview: 'nw/设定/世界观',
    settingLib: 'nw/设定/设定库',
    foreshadow: 'nw/设定/伏笔库',
    timeline: 'nw/设定/时间线',
};

/**
 * NAMESPACE_PREFIX 常量。
 */
export const NAMESPACE_PREFIX = 'nw/';

/**
 * 旧标签 → 层级标签；未知标签返回 null（表示不需要追加）
 *
 * @param legacyTag - 旧标签
  * @returns 文本结果 或 null
 */
export function namespaceTagOf(legacyTag: string): string | null {
    const tag = String(legacyTag || '').replace(/^#/, '').trim();
    if (!tag) return null;
    return LEGACY_TO_NAMESPACE[tag] ?? null;
}

/**
 * 是否已是层级标签
 *
 * @param tag - 标签
 * @returns 是否成功
 */
export function isNamespaceTag(tag: string): boolean {
    return String(tag || '').replace(/^#/, '').startsWith(NAMESPACE_PREFIX);
}

/**
 * 在已有标签列表上幂等追加层级标签：
 * - 旧标签原样保留（双标签并存）；
 * - 已有同名层级标签不重复追加；
 * - 未知标签原样保留、不追加。
 * @param existing - 已有
 * @param legacyTags - 旧标签列表
 * @returns 结果数组
 */
export function withNamespaceTags(existing: unknown, legacyTags: string | string[]): string[] {
    const base = Array.isArray(existing)
        ? existing.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean)
        : typeof existing === 'string'
            ? existing.split(/[,，\s]+/).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean)
            : [];
    const input = Array.isArray(legacyTags) ? legacyTags : [legacyTags];

    const result = [...base];
    const seen = new Set(result);
    for (const legacy of input) {
        if (!legacy) continue;
        if (!seen.has(legacy)) {
            result.push(legacy);
            seen.add(legacy);
        }
        const ns = namespaceTagOf(legacy);
        if (ns && !seen.has(ns)) {
            result.push(ns);
            seen.add(ns);
        }
    }
    return result;
}

/**
 * 该文件当前缺少哪些层级标签（迁移 dry-run 用）
 *
 * @param existing - 已有
 * @returns 结果数组
 */
export function missingNamespaceTags(existing: unknown): string[] {
    const tags = Array.isArray(existing)
        ? existing.map((tag) => String(tag).replace(/^#/, '').trim())
        : typeof existing === 'string'
            ? existing.split(/[,，\s]+/).map((tag) => tag.replace(/^#/, '').trim())
            : [];
    const have = new Set(tags);
    const missing: string[] = [];
    for (const legacy of tags) {
        const ns = namespaceTagOf(legacy);
        if (ns && !have.has(ns)) missing.push(ns);
    }
    return missing;
}

/**
 * 把标签数组渲染成 YAML 内联数组（保持中文原样，含 `/` 不需要引号）
 *
 * @param tags - 标签列表
 * @returns 文本结果
 */
export function formatTagArray(tags: string[]): string {
    return `[${tags.join(', ')}]`;
}