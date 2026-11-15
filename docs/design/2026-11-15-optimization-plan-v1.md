# 优化方案 v1（基于全仓审计 · 2026-11-15）

> 依据 `docs/audit/2026-11-15-plugin-data-model-audit.md` 与用户决策：
> ① 时间线/伏笔接受「每事件/每伏笔一文件 + 看板派生」
> ② 关系权威**不用当前单表 md**，需新方式（本文给两个选项，待你选）
> ③ 迁移对旧项目也生效
> ④ 优先级：先 B（统一索引），后 A（要素卡片化）

## 一、B 阶段：统一索引（先做，低风险高收益）

### 1.1 目标

把「路径索引」升级为「要素索引」，成为全插件唯一的**查询入口**：
按类型 / 标签 / 别名 / 关系 / 全文检索，供 `@` 引用、实体图、上下文装配、侧栏、Agent 工具共用。

### 1.2 数据模型（`shared/project-index-model.ts` 扩展）

```ts
interface IndexEntry {
  path: string;
  name: string;
  kind: IndexKind;          // 由 frontmatter.type 优先，路径兜底
  type?: EntityType;        // character/location/faction/item/worldview/setting/timeline/foreshadow/...
  tags: string[];           // frontmatter.tags + metadataCache 内联标签
  aliases: string[];        // frontmatter.aliases ?? 别称/别名/曾用名
  summary?: string;         // frontmatter.简介 ?? 首段
  status?: string;
  storyTime?: string;
  links: string[];          // 正文 [[双链]] 目标（来自 metadataCache.resolvedLinks）
  relations: RelationRef[]; // frontmatter.relations（若采用关系文件方案则来自关系卡）
  mtime: number;
  size: number;
}
```

### 1.3 实施步骤（可独立提交）

1. **S1 读属性**：`ProjectIndexService.scan` 接入 `metadataCache.getFileCache`，填 `type/tags/aliases/summary/status`
   - 增量：mtime 未变不重解析；`metadataCache` 变更事件触发失效
   - 排除：`_versions/`、`.看板/`、`04-项目总控/事务|会话预设|断点`
2. **S2 查询 API**：`query({type?, tag?, alias?, text?, kind?, folder?, limit?})`，返回条目（不含正文）
   - 收编 `shared/obsidian-query.ts`（其 kind/tag/property 查询并入，避免两套）
3. **S3 消费方切换**：
   - `@` mention：路径 → 索引（按别名/标题/标签匹配，带 kind 图标）
   - 实体图卡片：路径推断 → `entry.type`（修掉「关系状态.md 变设定卡」问题）
   - 侧栏「提及位置」：保持 metadataCache 反链，但补「同标签/同别名」入口
4. **S4 标签写入一致性修复**（与 S1 配套，否则索引读到脏数据）：
   - `step-result-saver` 改 `withNamespaceTags` 幂等追加，不再整数组覆盖
   - `body-writer` 追加 `nw/正文`（保留 legacy `正文`）
5. **S5 别名统一**：新写入同时写原生 `aliases`（数组）与中文 `别称`（兼容旧卡）
6. **S6 迁移（旧项目生效）**：
   - 命令「重建要素索引」：全量重扫 + 补 `type/tags/aliases`（**只补不改正文**，dry-run 预览 → 执行）
   - 幂等：已存在的键不覆盖，只填空缺

### 1.4 验收

- 单测：frontmatter 解析（type/tags/aliases/summary）、查询过滤（type/tag/alias/text）、增量（mtime 不变不重解析）
- 实机：造一个项目 → 索引 JSON 含 type/tags/aliases → `@` 弹出按别名命中 → 实体图卡片类型正确
- 门禁：preflight EXIT=0

## 二、A 阶段：要素卡片化（B 完成后做）

### 2.1 时间线

- 每事件一文件：`02-时间线与伏笔/时间线事件/<时间>-<事件名>.md`
  - frontmatter：`type: timeline`、`时间`、`章节`、`纪元`、`地点`、`涉及人物`、`类型`、`重要程度`、`状态`、`关联伏笔`
- `时间线看板.md` 改为**派生视图**：由索引按 `时间/storyTime` 排序生成（或 Obsidian Bases `.base`）
- 写入：结算/分析报告 → 写事件文件（不再整表改写）；看板只读

### 2.2 伏笔

- 每伏笔一文件：`02-时间线与伏笔/伏笔/<伏笔名>.md`
  - frontmatter：`type: foreshadow`、`伏笔ID`、`重要程度`、`埋设章节`、`计划回收`、`当前状态`、`相关人物`、`关联主线`、`回收章节`、`回收方式`、`关联事件`
- `伏笔库.md` 改为派生视图（未回收/已回收/已废弃三节由索引生成）
- 删除 `04-项目总控/伏笔追踪.md`（第二份真源），`ForeshadowManager` 改为读写伏笔文件
- 统一状态词表：`planted | progressing | resolved | abandoned`（废除三套并存）

### 2.3 世界观 / 设定库

- 拆条目：`01-世界架构/世界观/<条目>.md`、`01-世界架构/设定/<条目>.md`
  - frontmatter：`type: worldview|setting`、`分类`、`tags`、`关联人物/地点/势力`
- `世界观总览.md`、`设定库.md` 保留为**目录/索引页**（由索引生成或手写导航）

### 2.4 关系（待你选，见第三节）

### 2.5 迁移

- 一次性迁移命令：解析现有 `时间线看板.md`/`伏笔库.md`/`世界观总览.md`/`设定库.md` → 拆成条目文件（保留原文件为 `.bak` 或转为派生视图）
- 幂等 + dry-run + 可回滚（迁移前自动备份到 `_versions/migration/`）

### 2.6 验收

- 单测：表格→条目解析（时间线 4 列/7 列两种格式、伏笔三节）、条目→看板渲染往返
- 实机：迁移一个真实项目 → 条目文件生成、看板渲染一致、结算写入走条目文件
- 门禁：preflight EXIT=0

## 三、关系存储：两个候选（**待你选**）

### 选项 R1：每关系一文件（卡片化，与其它要素一致）

- 路径：`01-世界架构/关系/<人物A>-<人物B>.md`
- frontmatter：`type: relation`、`人物A`、`人物B`、`关系类型`、`trust/attraction/fear/resentment/dependence`、`关系状态`、`最后更新章节`
- 正文：关系演变记录
- 优点：Obsidian 原生反链/属性检索/图谱直接可用；与「一切皆笔记」一致
- 缺点：关系数量大时文件多；数值更新需写文件

### 选项 R2：单一结构化存储（JSON 为权威）

- 路径：`04-项目总控/关系.json`（或 `.jsonl`）
- 结构：`{version, relations:[{id,a,b,type,trust,...,updatedAt}]}`
- 优点：数值更新快、查询方便、无文件爆炸
- 缺点：Obsidian 原生能力用不上（反链/属性检索/图谱看不到），与「标签属性链接一切」的方向相悖

### 建议

**R1**。理由：你的核心诉求是「用 Obsidian 的标签和笔记属性把数据连起来」，关系也应是一等公民；R2 会把关系再次变成插件私有数据，与目标冲突。
但 R1 需要配套：关系文件命名冲突处理、`人物A/B` 用 `[[双链]]`、图谱视图读关系文件（而非 JSON 缓存）。

## 四、实施顺序与里程碑

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M1 | B-S1/S2：索引读属性 + 查询 API | 索引可查 type/tag/alias/text |
| M2 | B-S3/S4/S5：消费方切换 + 标签/别名写入修复 | `@`/实体图走新索引 |
| M3 | B-S6：旧项目重建索引命令 | 存量项目可用 |
| M4 | A-时间线卡片化 + 看板派生 | 事件文件 + 派生看板 |
| M5 | A-伏笔卡片化 + 统一状态 | 伏笔文件 + 派生库 + 删追踪器 |
| M6 | A-世界观/设定条目化 | 条目文件 + 索引页 |
| M7 | A-关系（R1）落地 + 实体图改读关系文件 | 关系卡片 + 图谱 |
| M8 | 迁移命令 + 实机验证 | 旧项目全量迁移 |

每里程碑独立提交、preflight EXIT=0、实机验证。

## 五、待确认

1. **关系存储选 R1 还是 R2？**（建议 R1）
2. 时间线/伏笔的**文件命名**：`<时间>-<事件名>.md` / `<伏笔名>.md` 是否可接受（重名加序号）？
3. 迁移时原文件保留方式：转成派生视图（推荐）还是改名 `.bak`？
