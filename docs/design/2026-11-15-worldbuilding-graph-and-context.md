> ⚠️ **本文档已被 `docs/audit/2026-11-15-plugin-data-model-audit.md` 取代。**
> 该文基于全仓代码审计；本文为未做全量调研前的早期草案，其中对时间线/伏笔/世界观存储形态的判断不准确，仅保留作思路记录。

# 世界观/设定库图谱化 + AI 上下文装配设计（v1 · 2026-11-15）

> 目标：用 Obsidian 的**标签 + 笔记属性 + 双链**把整本小说的要素连成一张图，
> 让 AI 写正文时能按需取到「这一刻该知道的一切」，从根上解决「上下文不够 → 忘记前文」。

## 一、问题本质

不是「AI 记性差」，而是**写作时该给的上下文没给全**：

1. 长篇小说几十万字，任何模型窗口都装不下
2. 只喂「上一章」不够——伏笔、时间线、人物关系、世界观规则都在别处
3. 现有实现偏「单文件堆设定」：设定和正文脱节，AI 看不到也改不动

## 二、数据模型（Obsidian 原生能力）

### 2.1 一切皆笔记

每个要素 = 一个 Markdown 笔记，**属性在 frontmatter，正文写内容，关系用双链**：

```md
---
type: character            # 要素类型（统一枚举）
id: lin-xuan               # 稳定 id（重命名不变）
aliases: [林玄, 小玄]       # 供检索/正文匹配
tags: [nw/人物, nw/主角]
status: active             # active/retired/unconfirmed
relations:
  - target: su-wan
    type: ally
    since: 第3章
storyTime: 开篇
---

# 林玄

外门弟子，性格……
```

### 2.2 类型枚举（`type`）

| type | 中文 | 关系图角色 |
|---|---|---|
| `character` | 人物 | 人物关系图节点 |
| `location` | 地点 | 地点归属/事件发生地 |
| `faction` | 势力/组织 | 势力关系 |
| `item` | 物品/法宝 | 持有/归属 |
| `worldview` | 世界观规则 | 规则约束（如「灵气浓度」） |
| `setting` | 设定条目 | 世界细节 |
| `timeline` | 时间线事件 | 时间轴节点 |
| `foreshadow` | 伏笔 | 状态：埋下/推进/回收 |
| `chapter` | 章节 | 正文 |
| `outline` | 大纲 | 结构 |

### 2.3 标签规范（`tags`）

层级标签便于 Obsidian 面板折叠与检索：

```
nw/人物   nw/人物/主角   nw/人物/反派
nw/地点   nw/势力        nw/物品
nw/世界观 nw/设定        nw/时间线
nw/伏笔   nw/伏笔/未回收  nw/伏笔/已回收
nw/正文   nw/大纲
```

**规则**：`type` 定语义，`tags` 定可检索切片，二者不互相替代。

### 2.4 关系表达（两条通道）

1. **frontmatter `relations`**：结构化、可校验（供图谱视图与工具读）
2. **正文 `[[双链]]`**：作者写作时自然产生（供反向链接、提及位置）

索引同时收集两者 → 图谱边 = `relations ∪ wikilinks`。

## 三、索引层（复用现有 ProjectIndexService）

现有 `04-项目总控/索引.json` 已按路径分类；扩展为**要素索引**：

```ts
interface EntityIndexEntry {
  path: string;
  type: EntityType;          // 来自 frontmatter.type
  id?: string;
  aliases: string[];         // frontmatter.aliases
  tags: string[];            // frontmatter.tags
  summary: string;           // frontmatter.简介 / 首段
  storyTime?: string;
  status?: string;
  relations: RelationRef[];  // frontmatter.relations
  links: string[];           // 正文 [[双链]] 目标
  mtime: number;             // 增量更新
}
```

增量策略：文件 mtime 变化才重解析；全量重建只在首次或手动「重建索引」。

## 四、检索层（写正文时的上下文装配）

### 4.1 上下文包（Context Pack）

写第 N 章前，按预算装配：

| 槽位 | 来源 | 预算 |
|---|---|---|
| 当前章大纲/细纲 | outline 笔记 | 高 |
| 前情摘要 | 前 1–2 章摘要（已有章节摘要机制） | 高 |
| 本章涉及要素 | 大纲/细纲中出现的 aliases → 人物/地点/势力卡 | 中 |
| 未回收伏笔 | `tags: nw/伏笔/未回收` 且埋设章 ≤ N | 中 |
| 时间线（截至本章） | timeline 事件按 storyTime 排序 | 中 |
| 相关世界观规则 | 按关键词/标签匹配 | 低 |
| 风格/禁忌 | 项目规则 | 低 |

### 4.2 检索算法（由粗到细）

1. **精确**：大纲里出现 `林玄` → 命中 `aliases` 含「林玄」的人物卡
2. **标签**：`nw/伏笔/未回收` 全取（数量可控）
3. **时间线**：取 `storyTime <= 当前章` 的最近 K 条
4. **语义兜底**（可选）：对摘要做关键词重叠排序

### 4.3 工具化（Agent 可主动查）

在已有 `memory_search` / `read_plan` 基础上新增：

| 工具 | 作用 |
|---|---|
| `build_context(chapter)` | 返回本章上下文包（结构化 + 文本） |
| `timeline_query(until)` | 查截至某时间点的事件 |
| `foreshadow_list(status)` | 列未回收/已回收伏笔 |
| `entity_get(path)` | 取单张要素卡全文 |
| `entity_patch(path, old, new)` | 局部改（已有 memory_patch） |

## 五、管理界面（图与画布复用）

| 视图 | 用途 | 状态 |
|---|---|---|
| 设定实体图 | 人物/地点/势力/物品关系 | 已有，需加「按 type 过滤」 |
| 规划画布 | 事件/阶段/选择/便签 | 已有 |
| **世界观图**（新） | worldview/setting 规则之间的引用关系 | 待做 |
| **时间线视图**（新） | timeline 事件按 storyTime 排序，可拖拽调整 | 待做 |
| **伏笔看板**（新） | 未回收/推进中/已回收三列看板 | 待做 |
| **要素速查**（新） | 全项目要素搜索（type/tag/alias/正文） | 待做 |

## 六、写入闭环（防「写了就忘」）

章节保存后触发**要素抽取建议**（不自动改，只提示）：

1. 从本章正文抽人名/地名 → 与索引比对
2. 新出现的要素 → 建议建卡（或标记待确认）
3. 伏笔推进 → 建议改 `status`
4. 时间线推进 → 建议加事件

用户确认后才写入（沿用「提案不等于采用」原则）。

## 七、迁移与兼容

- **非破坏**：Markdown 仍是唯一真源；索引/图谱都是派生数据
- 老项目：一次性「补全 frontmatter」向导（只补 `type/tags/aliases`，不改正文）
- 无 frontmatter 的文件按路径推断 type（现有 `inferIndexKind` 已具备）

## 八、分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| S1 | 属性 schema + 索引扩展（type/tags/aliases/relations/links） | 索引能列出要素与边；单测覆盖解析 |
| S2 | 设定实体图按 type 过滤 + 世界观图视图 | 图能分类型显示 |
| S3 | 时间线视图 + 伏笔看板 | 按 storyTime 排序 / 按状态分列 |
| S4 | `build_context` 等工具 + 写作前装配接入 | 写章时上下文包含伏笔/时间线/要素 |
| S5 | 要素抽取建议（章节保存后提示） | 提示准确、可一键采用 |
| S6 | 要素速查面板（type/tag/alias/全文） | 搜索命中并可直接打开/编辑 |

## 九、非目标

- 不做向量数据库/嵌入检索（先用精确匹配 + 标签 + 时间线，可控可解释）
- 不改变「Markdown 为真源」原则
- 不引入外部图数据库（图谱存 JSON，随项目同步）
