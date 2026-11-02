/**
 * entity-links.ts — 实体关系的 Obsidian 原生链接层
 *
 * 设计原则（对标「避免文件之间关系的维护成本」）：
 * - AI/结算只填**实体名**；链接化在结算层完成，写入 frontmatter 值为 `[[名字]]`。
 * - **单侧写入**：所有权只写在物品侧（所属/归属 → 人物），人物侧「持有物品」
 *   不做双写，由 metadataCache 反查（engine/entity-graph.ts）得到。
 * - 读取容忍一切旧格式：`[[X]]`、`[[X|别名]]`、纯字符串、YAML 数组、逗号串。
 *
 * 纯函数，不依赖 Obsidian。
 */

export type LinkCardinality = 'single' | 'list';

export interface LinkFieldPolicy {
    /** frontmatter 字段名 */
    key: string;
    cardinality: LinkCardinality;
    /** 链接指向的实体类别（用于反查时过滤目录） */
    targetCategory: 'character' | 'faction' | 'location' | 'item';
}

/**
 * 链接字段策略表：这些 frontmatter 字段的值是实体间关系，结算时自动链接化。
 * 键 = `${category}.${frontmatterKey}`。
 */
export const LINK_FIELD_POLICY: Record<string, LinkFieldPolicy> = {
    'character.所属势力': { key: '所属势力', cardinality: 'single', targetCategory: 'faction' },
    'character.当前位置': { key: '当前位置', cardinality: 'single', targetCategory: 'location' },
    'character.持有物品': { key: '持有物品', cardinality: 'list', targetCategory: 'item' },
    'item.所属/归属': { key: '所属/归属', cardinality: 'single', targetCategory: 'character' },
    'item.现存放位置': { key: '现存放位置', cardinality: 'single', targetCategory: 'location' },
    'location.所在世界/区域': { key: '所在世界/区域', cardinality: 'single', targetCategory: 'location' },
    'faction.领袖': { key: '领袖', cardinality: 'single', targetCategory: 'character' },
};

/**
 * 该字段是否是链接字段；是则返回策略
 *
 * @param category - 分类
 * @param fieldKey - 字段键
  * @returns LinkFieldPolicy 或 undefined
 */
export function getLinkPolicy(category: string, fieldKey: string): LinkFieldPolicy | undefined {
    return LINK_FIELD_POLICY[`${category}.${fieldKey}`];
}

/**
 * 实体名 → wiki-link；空名原样返回
 *
 * @param name - 名称
 * @returns 文本结果
 */
export function toWikiLink(name: string): string {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    if (/^\[\[.*\]\]$/.test(trimmed)) return trimmed; // 已是链接
    return `[[${trimmed.replace(/^\[\[|\]\]$/g, '')}]]`;
}

/**
 * 名单 → 链接数组（去重、去空）
 *
 * @param names - 名称列表
 * @returns 结果数组
 */
export function toWikiLinks(names: string[]): string[] {
    const seen = new Set<string>();
    const links: string[] = [];
    for (const name of names || []) {
        const trimmed = String(name || '').trim();
        if (!trimmed) continue;
        const link = toWikiLink(trimmed);
        if (link && !seen.has(link)) {
            seen.add(link);
            links.push(link);
        }
    }
    return links;
}

/**
 * 任意历史格式的字段值 → 实体名数组。
 * 容忍：`[[A]]`、`[[A|别名]]`、`A、B`、`"A"`、YAML 数组解析后的数组值。
 * @param value - 值
 * @returns 结果数组
 */
export function parseLinkValue(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
        return value.flatMap((item) => parseLinkValue(item));
    }
    const text = String(value).trim();
    if (!text) return [];
    // 先抽出所有 [[...]]（含别名），保留书写顺序
    const bracketed = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
    if (bracketed.length > 0) return bracketed;
    // 无链接：按分隔符拆纯文本；「名称（说明）」只留名称——
    // 实测结算把「获得锁脉环（扣于左腕）」整体包进 [[ ]]，生成破损链接
    return text
        .split(/[、，,；;]+/)
        .map((part) => part.trim().replace(/[（(][^（)）]*[）)]\s*$/, '').trim())
        .filter((part) => part.length > 0 && part.length <= 60);
}

/**
 * single 字段的写入值：第一个名字的链接（旧值有多个时只链第一个，其余信息不丢——反查仍在）
 *
 * @param names - 名称列表
 * @returns 文本结果
 */
export function formatSingleLinkValue(names: string[]): string {
    return names.length > 0 ? toWikiLink(names[0]) : '';
}

/**
 * list 字段的写入值：YAML 内联数组
 *
 * @param names - 名称列表
 * @returns 结果数组
 */
export function formatListLinkValue(names: string[]): string[] {
    return toWikiLinks(names);
}
