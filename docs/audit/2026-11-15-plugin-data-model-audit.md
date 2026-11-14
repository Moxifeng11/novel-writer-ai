# 插件数据模型与模块关系审计（2026-11-15）

> 目的：在提出任何优化方案前，把**现状**查清。本文只写事实与证据（文件:行号），
> 方案部分单列为「候选方向（待确认）」，不作为定论。

## 一、项目与路径体系

### 1.1 创建流程（长篇）
`CreateProjectModal` → `createLongNovelProject`（`ui/services/project-create-service.ts:123`）：
1. 同人审核闸门 → 计算项目路径（`project-locator.ts:67`）
2. 同名则确认覆盖 + 删目录 + 固定 300ms 等待（`:155-169`）
3. `ensureTemplateScaffold` 复制内置 56 个模板（`template-scaffold.ts:74`）
4. `元文件` 下除两个子目录外全部复制，只做一次字面 `replace('元文件', 项目)`（`:223,243`）
5. 补拷 `01-世界架构/{设定库,文笔风格}.md`（`:254-307`）
6. 写 `.project`（`vault.create/modify`，与 paths.ts「点文件只走 adapter」的约定冲突）
7. 写 `写作配置.md`（`WritingProfileManager`）→ 打开工作台

短篇/剧本走 `DomainProjectFactory`（`domains/kernel/domain-project-factory.ts:61`），结构不同（`短篇创作/01-故事核…`、`剧本创作/01-人物与场景…`）。

### 1.2 路径体系
- 项目 = `<模式库根>/<书名>`，模式库根 3 个：长篇小说/短篇小说/剧本（`creation-mode.ts:52-84`）
- 目录名至少 **5 套来源**：creation-mode rootDir、project-mode 前缀、项目身份标志、索引根名、frontmatter PATH_RULES
- 章节路径硬编码 ≥10 处（helpers/chapter-target/chapter-utils/co-writing/review-agent/project-utils…）
- `04-项目总控` 下实际文件/目录 ≈ 25 种（索引、版本、剧情记忆、一致性审核、设定图、规划、plan、spec、附件、goal、事务、会话预设、断点、诊断…）

### 1.3 索引现状
`services/project-index-service.ts` + `shared/project-index-model.ts`：
- 只收 `path/name/size/mtime`，**不读正文、不读 frontmatter、不含 tags/links/relations**
- `kind` 由**路径子串**推断（`project-index-model.ts:85-102`）：`01-世界架构/**` 一律判为 `setting`
- 存 `<项目>/04-项目总控/索引.json`；`read()` 无调用方；落盘写入会自触失效事件
- 消费方仅两处：`@` mention 候选（路径）、设定实体图卡片（路径 + 首行摘要正则）

## 二、要素存储形态（关键事实）

| 要素 | 形态 | 路径 | 结构化程度 |
|---|---|---|---|
| 时间线 | **单一 md + 表格行** | `02-时间线与伏笔/时间线看板.md` | 表格列（4 列/7 列两套），事件 ID 由字段哈希派生 |
| 伏笔 | **单一 md + 三节表格** | `02-时间线与伏笔/伏笔库.md` | 表格 + 分节标题双通道 |
| 伏笔（第二份） | 单一 md | `04-项目总控/伏笔追踪.md` | `ForeshadowManager` 自读自写，**与伏笔库不互同步** |
| 承诺/谜团 | 单一 md | `02-时间线与伏笔/承诺账本.md` | 表格 |
| 世界观 | **单一 md + 多级 H2** | `01-世界架构/世界观总览.md` | 无 YAML 结构化字段 |
| 设定库 | **单一 md + 8 节 H2** | `01-世界架构/设定库.md` | 同上；且不在脚手架内，需「从世界观生成」 |
| 人物/地点/势力/物品 | **每实体一文件** | `01-世界架构/{人物,地点,势力,物品功法}/<名>.md` | 25/9/7/9 个 frontmatter 键 |
| 关系（数值） | **单一 md + 表格** | `01-世界架构/关系状态.md` | 每对 5 个数值维度 |
| 关系（语义边） | 每项目一 JSON | `04-项目总控/设定图/关系.json` + `历史/` | 卡片 id = `type:path`，改名即孤儿 |
| 规划画布 | 每项目一 JSON | `04-项目总控/规划/画布.json` | 节点/边/便签，**与任何 md 无连接** |

### 2.1 关系表达的四个并存通道
1. frontmatter 单侧 wiki-link（`shared/entity-links.ts:26-36` 的 7 个字段）
2. `关系状态.md` 数值关系（权威）
3. `设定图/关系.json` 语义边（仅视图消费）
4. 章节 frontmatter `涉及人物/地点/势力/物品功法` 纯名字数组（非链接，无法反查）

### 2.2 三套实体/名称解析
- `ProjectIndexService`：路径推断（实体图卡片用）
- `engine/entity-graph.ts`：metadataCache + frontmatter（prompt 用）
- `shared/entity-index.ts`：名称/别名索引（ENT-id，正文匹配用）

## 三、标签与属性现状

### 3.1 已有基础（比预想的好）
- 标签体系已存在：`shared/tag-taxonomy.ts:15-61` 定义 `nw/*` 层级标签 + legacy 映射
- 属性 schema 已存在：`shared/frontmatter-schema.ts:235-257`，16 类文件类型、字段与必填
- 半成品查询层：`shared/obsidian-query.ts` 支持按 kind/tag/property 查询（**几乎无生产调用**）
- 反链：侧栏「查看提及位置」用 `metadataCache.getBacklinksForFile`（`project-side-panel-view.ts:394-405`）

### 3.2 缺口
- **无原生 `aliases`**：用中文键 `别称/别名/曾用名`，Obsidian 的 `[[简称]]` 不享受别名解析
- **tags 写入不一致**：`step-result-saver.ts:547-575` 整数组覆盖 tags（抹掉 nw/* 与用户标签）；`body-writer.ts:399-401` 只写 legacy `正文`
- **schema 与实际写入漂移**：`对话占比/口语密度/时间锚点/人味分`、`settlement_*`、`quality_*`、`step_actual_model/rag_sources` 均不在 schema
- **tags 不属于任何 schema** → 属性面板不能编辑标签
- **无「按属性/标签/别名检索全项目」入口**：索引不读属性，`obsidian-query` 无 UI/命令
- 类型识别两套口径：`resolveFileKind` 只读 frontmatter.tags，侧栏优先 `metadataCache.tags`

## 四、模块产出 / 消费关系

### 4.1 写作主链（建项目 → 拆解 → 大纲 → 正文 → 结算 → 版本 → 统计）
1. 建项目：模板骨架 + `.project` + 写作指纹
2. 拆解：知识库 txt → 8 维 md + 向量库 → 正文注入
3. 大纲：向导/大纲步骤 → 分卷大纲 + 步骤结果
4. 正文：`BodyWriter` 统一落盘（status/word_count/涉及人物 + 覆盖前自动存版本）
5. 结算：分析报告 → 实体卡/伏笔库/时间线/关系状态/正文 status + 结算表 + 状态快照 + 剧情记忆摘要 + 事实库/断言/矛盾 + 图谱诊断
6. 版本：`_versions/`（自动 + 手动）+ 回滚史
7. 统计：`word_count` → 日产出；`usage-ledger` → 用量；`rag_sources` → KB 命中

### 4.2 孤岛数据（写了没人读）
`矛盾.json`、`诊断/故事一致性报告.md`、`剧情记忆/index.json`、`故事台账/关联索引.md`、`伏笔追踪.md`（三方法无调用方）、`会话预设/`（入口无调用方）、`索引.json#read()`、`叙事总览.md`（无读方）、`断言.json`（未进 prompt）、`断点/`（仅弹窗用）

### 4.3 重复真源（同一事实多处）
事实（正文>事实库>摘要>断言>事实索引）、伏笔（库/追踪/信息债）、关系（关系状态/设定图 json/待确认队列）、章节状态（frontmatter/结算表/快照/UI 现算）、字数（frontmatter/台账/现算）、token（ledger/步骤 frontmatter）、摘要（md + index.json）、叙事总览（5 处写）、指纹（三层）、历史（4 套）

## 五、关键粗糙点（按影响排序）

1. **时间线/伏笔/世界观/设定库都是单一 md**：无逐事件/逐条目的属性，无法按属性检索、无法做逐条关系、无法精确增量更新；3 个写方对时间线整文件读改写（注释自认并发覆盖）
2. **伏笔两套真源 + 三套状态词表**（`ledger-model.ts:228-242` / `foreshadow-status.ts:39-45` / `foreshadow-manager.ts:1040-1043`）
3. **关系四通道并存**，实体图卡片却来自路径推断（不读 frontmatter），关系真源是 `关系状态.md` 而非 `设定图/关系.json`
4. **规划画布与 md 零连接**：节点无 `memoryRefs`；`chapterRefs` 无写入方 →「已落文」状态不可达
5. **索引太粗**：只有路径，`01-世界架构/**` 一律判 setting；`@` 用路径而非属性/别名
6. **标签写入会被覆盖**（step-result-saver）、**无 aliases 原生属性**
7. **新建项目不满足自身项目标准**（标准要求 `01-世界架构/{人物,势力,地点,物品}`、`03-大纲与章节/正文`，创建不建；`物品` vs `物品功法` 名称不一致）
8. **模板复制是字面替换**：`{{Name}}` 占位符原样带出；`元文件/06-榜单分析` 若存在会被复制进每个项目
9. 三套实体/名称解析并存，口径不一
10. 大量路径硬编码 + 5 套目录名来源 + 7 组 schema 漂移字段

## 六、候选优化方向（待确认，不是定论）

> 原则：Markdown 仍为唯一真源；属性/标签做索引与检索；不引入外部图数据库。

### 方向 A：要素「卡片化」（时间线/伏笔/世界观/设定库）
- 时间线：事件 → 每事件一文件（frontmatter: 时间/章节/地点/涉及人物/类型/状态），看板 md 改为**派生视图**
- 伏笔：每伏笔一文件（埋设章/计划回收/状态/关联事件），伏笔库 md 改为派生视图
- 世界观/设定库：拆成条目文件（每规则/每设定一条），总览 md 保留为目录/索引
- 代价：文件数增加；收益：可按属性/标签/关系检索与增量更新

### 方向 B：统一索引（读 frontmatter + 链接）
- 扩展 `ProjectIndexService`：读 `type/tags/aliases/relations/links/mtime`，增量按 mtime
- 提供查询 API：`byType` / `byTag` / `byAlias` / `byRelation` / 全文
- 收编 `obsidian-query.ts` 半成品，`@` mention 改用索引（别名/标题/标签）

### 方向 C：关系单一真源
- 以 `关系状态.md`（或每关系一文件）为权威，`设定图/关系.json` 改为派生缓存
- 实体图卡片改读 frontmatter 类型，而非路径推断

### 方向 D：规划画布 ↔ 要素连接
- 节点加 `memoryRefs`（人物/地点/伏笔/时间线），写正文时按节点引用装配上下文
- `chapterRefs` 由「落文」动作写入（解决不可达状态）

### 方向 E：项目创建流程重设计
- 先定「项目标准」（目录/文件/属性 schema 单一来源），创建流程按标准生成
- 模板占位符渲染；`元文件` 过滤清单显式化；统一 `.project` 写入通道

### 方向 F：写入闭环
- 结算后产出「要素变更建议」（不自动改），用户确认后写入

## 七、待你确认的问题

1. 时间线/伏笔是否接受「每事件/每伏笔一文件 + 看板派生」？这是改动最大的一步
2. 关系权威放哪里：`关系状态.md`（现状）还是每关系一文件？
3. 旧项目迁移策略：一次性补属性 + 拆分（可回滚） vs 只对新项目生效
4. 优先级：先做 B（统一索引，风险低收益大）还是先做 A（卡片化，改动大）？

## 八、本审计的边界

- 只读代码，未在运行中的 Obsidian 里验证 `.base` 看板渲染、反链 API 返回结构、模板复制结果
- 未穷举所有 UI 入口可达性；知识库拆解子系统只确认产物路径与消费方
- 未逐份核对 56 个模板文件内容与 paths 函数命名
