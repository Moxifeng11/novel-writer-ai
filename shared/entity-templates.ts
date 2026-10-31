/**
 * entity-templates.ts — 势力 / 地点 / 物品功法 的正文模板唯一来源
 *
 * 批次 4：单条生成（`engine/ai-entity-generator`）与批量生成
 * （`engine/ai-batch-entity-generator`）此前各存一份示例模板，字段顺序与
 * 元字段（`entity_status` / `entity_created_at` 等）不一致——同一项目经不同
 * 入口生成的实体 frontmatter 因此分叉。此处收敛为唯一来源，纯字符串、零 import，
 * 放 shared 供两层共用。
 *
 * 唯一保留的参数差异：物品功法批量生成时 `itemType` 可为「功法」（扁平标签
 * 随之切换），单条生成固定「物品功法」。
 */

export type EntityTemplateKind = 'faction' | 'location' | 'item';

export interface EntityTemplateOptions {
    /** 物品功法的扁平标签名（默认「物品功法」） */
    itemTag?: string;
}

export interface EntityTemplateBlock {
    /** 示例 YAML frontmatter（含首尾 `---`） */
    frontmatter: string;
    /** 示例正文（一级标题 + 四分节） */
    body: string;
}

export function buildEntityTemplateBlock(
    kind: EntityTemplateKind,
    options?: EntityTemplateOptions,
): EntityTemplateBlock {
    if (kind === 'faction') {
        return {
            frontmatter: `---
tags: [势力, nw/实体/势力]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
别称:
类型:
地位/排名:
描述:
领袖:
---`,
            body: `# 势力名

## 确定性设定
- 领袖：
- 核心成员：
- 层级体系：
- 规模：
- 宗旨：
- 行事风格：
- 资源底蕴：

## 不确定性
- 内部矛盾：
- 隐藏目的：
- 潜在变数：

## 与其他元素的互信息
- [[关联人物]] :
- [[敌对势力]] :
- [[关联地点]] :

## 变更记录
- [章节名] 时间戳 | 变更描述`,
        };
    }

    if (kind === 'location') {
        return {
            frontmatter: `---
tags: [地点, nw/实体/地点]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
别称:
类型:
所在世界/区域:
描述:
重要程度:
地理特征:
主要居民/势力:
---`,
            body: `# 地点名

## 确定性设定
- 地理特征：
- 气候：
- 灵脉/资源：
- 规模：
- 主要居民/势力：
- 文化风俗：

## 不确定性
- 隐藏秘密：
- 未探索区域：
- 潜在危机：

## 与其他元素的互信息
- [[关联人物]] :
- [[关联势力]] :
- [[关联事件]] :

## 变更记录
- [章节名] 时间戳 | 变更描述`,
        };
    }

    // 双标签并存：扁平标签（可切换「功法」）+ nw/ 层级标签（Bases 看板按层级筛选）
    return {
        frontmatter: `---
tags: [${options?.itemTag ?? '物品功法'}, nw/实体/物品]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
类型:
品阶/等级:
所属/归属:
描述:
效果:
---`,
        body: `# 物品/功法名

## 确定性设定
- 外观/形态：
- 特性：
- 主要用途：
- 特殊效果：

## 不确定性
- 隐藏能力：
- 限制/副作用：
- 真正来历：

## 与其他元素的互信息
- [[持有者/修炼者]] :
- [[关联剧情]] :
- [[关联物品]] :

## 变更记录
- [章节名] 时间戳 | 变更描述`,
    };
}
