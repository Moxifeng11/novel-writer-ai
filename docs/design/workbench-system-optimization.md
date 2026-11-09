# 写作工作台系统优化方案（10 项）

> 版本：v1 · 定稿：2026-11-09
> 状态：**方案定稿，按 B0–B9 批次实施**（实施进度以 `docs/progress/auto-iterations.md` 与 git 为准）
> 适用范围：长篇 11 步流水线、句级协同写作、Agent 创作工作台、短篇/剧本单元写作
> 真相源：代码与 git；本文只描述目标、契约与验收，不复制测试数字

---

## 0. 执行摘要

本次梳理覆盖用户提出的 10 项：模块盘点、上下文与回写链路、人物一致性、剧情记忆、实体关系、调用时关联查询、图谱兜底、时间线与伏笔、超长上下文处理、完整方案文档。

审计得到三条决定性事实：

1. **时间线、伏笔、关联索引是同一族数据，却被拆成三套实现**。三者只共享 `第N章` 字符串与人物/地点名称文本，没有稳定 ID 和结构化引用；解析器、写入器、去重键、状态语义各有 3–5 套。
2. **实体类型、属性、标签同样是多套口径**。`NotebookFileKind` 11 种、`EntityKind` 4 种、属性 schema 11 种但伏笔/时间线为空；属性 schema 只是结算白名单的子集；`关系状态.md` 无法被 `resolveFileKind` 识别；Bases 只写不读。
3. **超长上下文不是单点截断，而是压缩、优先级丢弃、硬截断三段叠加**，且检索发生在预算装配之前，截断后不会补检。

因此目标架构不是再增加三个模块，而是：

```
                     ┌─────────────────────────────┐
                     │  Obsidian 原生层             │
                     │  实体索引 / 属性 schema / 标签 │
                     │  Bases（只展示）/ 双链 / 图谱  │
                     └──────────────┬──────────────┘
                                    │ 实体 ID、别名、类型
┌───────────────────────────────────▼───────────────────────────────────┐
│ 故事台账 Story Ledger（唯一数据层）                                     │
│ Event / Foreshadow / Promise / Relation / Link                         │
│ 单一解析器 · 单一写入器 · 索引查询 · 关联索引独立落盘                     │
└───────┬─────────────────┬─────────────────┬─────────────────┬──────────┘
        │                 │                 │                 │
  上下文装配         关联查询           剧情记忆          一致性校验
  (预算/压缩)      (association)      (chapter digest)   (OOC/图谱)
```

10 项与落点：

| # | 需求 | 落点 |
|---:|---|---|
| 1 | 功能模块盘点 | 本文 §1 |
| 2 | 上下文链路与回写 | 本文 §2 + `docs/design/` 后续实现说明 |
| 3 | 人物一致性 | §5.1 + `shared/character-rules.ts`、checker 改造、质控/分析接线 |
| 4 | 剧情记忆 | §5.2 + `engine/memory/chapter-digest.ts` + `剧情记忆/` |
| 5 | 实体关系持久化 | §5.3 + V2 权威 + 5 维增量 + 待确认队列 |
| 6 | 调用时关联查询 | §5.4 + `engine/context/association-resolver.ts` |
| 7 | 图谱兜底 | §5.5 + `engine/graph/graph-validator.ts`（只读） |
| 8 | 时间线同步/校验/查询 | §5.6 + `engine/ledger/*`（与伏笔/关联索引同源） |
| 9 | 超长不硬截断 | §5.7 + `shared/context/budget-plan.ts`、`overflow-recovery.ts` |
| 10 | 完整方案 | 本文全篇（路径/要求/验收/异常/迁移/回滚） |

---

## 1. 工作台功能模块清单

> 只列生产入口；「持久化」列给出写入产物，未标锁的写入点即当前风险点（见 §3）。

### 1.1 完整写作台（长篇 11 步）

| 模块 | 入口 | 输入 | 核心逻辑 | 输出/交互 | 持久化 |
|---|---|---|---|---|---|
| 项目/章节选择 | `ui/full-writer-view.ts`、`ui/full-writer/project-selector-controller.ts` | 项目目录、章节文件、frontmatter | 项目探测、章节排序、卷内复用 tab | 项目卡/章节卡/全部章节弹窗 | 只读 vault |
| 上下文加载（步骤 0） | `ui/full-writer/context-loader-controller.ts` | 项目、当前章、全库设定 | `ContextManager.gatherAll` 并行采集 12 模块；压缩；就绪评估；角色灵魂提取 | 上下文、缺失提示、重新加载 | 内存缓存（TTL 5 分钟）+ 角色灵魂步骤文件 |
| 一键全章规划 | `ui/full-writer-view.ts`、`engine/step-runner.ts` | 模板变量、自定义模板 | 合并提示词、预算闸门、解析校验、逐模块保存 | 5 个规划步骤文件、自动跳正文 | `03-大纲与章节/步骤结果/…` |
| 单步规划/角色灵魂/情绪/Scene | 步骤导航、`engine/step-specials.ts` | 前置步骤结果、上下文、知识注入 | 模板 resolver + 特例生成器 | 单步结果、跳过/重跑 | 同上各步骤文件 |
| 正文整章生成 | 标题栏/正文操作栏、`ui/full-writer/chapter-orchestrator.ts` | 模板变量、模型、温度 | 规划→正文→质控→分析→结算；流式；截断续写 | 正文、步骤状态、执行账本 | 正文（`BodyWriter`，锁+版本） |
| 润色/干预/修订 | `ui/polish-editor.ts`、`ui/full-writer/intervention-controller.ts` | 正文、选区、干预意见 | 防抖写回；消痕/迭代/定向修订 | 正文/修正稿；下游步骤失效 | 正文、修正记录、版本库 |
| 质量控制（步骤 8） | 步骤 8、复盘标签页 | 正文、设定、人物、伏笔、时间线、上一章 | 模板 prompt、情绪审计、程序化 `QualityGate` | 质量控制文件、时间线事件 | `第N章_质量控制.md` |
| 分析报告（步骤 9） | 步骤 9、结构化增强按钮 | 正文、信息规划、质控问题、承诺、角色弧线 | 模板 prompt；结构化分析；事实入队 | 分析报告、待确认事实、分析历史 | 分析报告、`.sessions/*.json`、`事实索引.json` |
| 章节结算（步骤 10） | 步骤 10、结算弹窗 | 分析报告、正文、实体/伏笔/时间线 | `SettlementEngine.settle` 17 类回写；journal 回滚 | 结算表、快照、总览、frontmatter 更新 | `结算表.md`、`章节状态快照/`、`叙事总览.md`、伏笔/时间线/关系/账本 |
| 成稿导出 | 创作流程页、命令 | 章节、格式、封面、平台 | `collectChapters`、`compileManuscript`、EPUB/DOCX | Markdown/TXT/HTML/EPUB/DOCX | 桌面下载；移动端 `导出文件/` |
| 创作流程页 | `ui/full-writer/flow-panel-controller.ts` | 模式、磁盘事实、流程快照 | 阶段进度、下一动作、阻塞原因 | 阶段卡片、下一步 | 读项目文件；导出标记 localStorage |
| 短篇/剧本单元写作 | `ui/full-writer/unit-writer-controller.ts` | 单元文件、编辑器正文、选区 | 生成/续写/改写、质检、单元结算、完成、防抖保存 | 单元正文、质检/结算 | 单元文件及评审文件 |
| 项目初始化向导 | `ui/full-writer/wizard-step-executors.ts` | 项目类型、同人设定、故事结构 | 同人→结构→实体→世界观→设定库→文风→全书规划→批量建章 | 分步向导 | 项目文件；向导结果 localStorage |
| 版本/备份/状态/诊断 | 标题栏、`ui/backup-center-modal.ts`、状态栏 | 版本索引、步骤/结算产物、配置备份 | 版本列表/对比/回滚；备份聚合 | 版本弹窗、状态栏 | `_versions/`、`usage-ledger.json`、设置备份 |
| 快捷工具 | `domains/long/tool-catalog.ts` | 当前项目/章节 | 调起全书规划、批量建章、实体生成、质量仪表盘等 | 弹窗/命令 | 各命令自身写入 |

### 1.2 句级协同写作

| 模块 | 入口 | 输入 | 核心逻辑 | 输出/交互 | 持久化 |
|---|---|---|---|---|---|
| 章节绑定/加载 | `ui/co-writing-view.ts`、`engine/co-writer-engine.ts` | 项目/卷/章、正文 | 冲刷上一章、清空建议、`gatherAll` + 快照 + 故事上下文包 | 左栏、编辑器、指标 | 正文、协同历史、会话状态（插件 data） |
| 建议/联想/改写/迭代 | 键盘、`ui/co-writing/suggestion-flow.ts` | 光标前全文、提示、选区、临时指令 | `suggestNext` → 输入预算 → 分区预算 → 流式调用 | 候选卡/幽灵建议 | 候选历史（最多 20 条） |
| 接受与插入 | 候选卡、`insertTextAndRecord` | 候选文本、选区、区间 | 防重复接受、更新快照/历史 | 插入正文、刷新指标 | 2 秒防抖 → `BodyWriter` |
| 自动保存/冲突保护 | `ui/cowrite/body-save-controller.ts` | 编辑器全文、章节身份 | 串行保存链、外部覆盖检测、切章冲刷 | 保存状态、关闭前 flush | 正文；版本备份 |
| 知识库/参考书 | 知识库 Tab、`co-writer-engine` | 参考书 ID/权重、检索词 | 书目/匹配/引用/建议；同步注入器 | 参考书卡、引用片段 | 知识库目录/向量目录 |
| 轻结算/完稿 | `ui/co-writing/settlement-actions.ts` | 正文 frontmatter、正文 | 待结算徽标、标记完稿、打开结算弹窗 | 结算提醒 | 正文 `status`；结算文件 |

### 1.3 Agent 创作工作台

| 模块 | 入口 | 输入 | 核心逻辑 | 输出/交互 | 持久化 |
|---|---|---|---|---|---|
| 对话输入 | `ui/agent-workbench-view.ts` | 文本、`@` 引用、图片、引用消息、项目 chip | 组装 payload；忙时 steer | 气泡、chips、重试、新会话 | 会话 JSONL |
| Harness 会话 | `engine/agent/harness/harness-engine.ts` | 项目、记忆槽位、计划、工具目录 | 系统提示拼装、回合循环、压缩、spill | 回复、工具调用、计划 | `.sessions/agent/<项目>.jsonl` |
| 工具调用 | `engine/agent/harness/host-tools.ts` | 模型 JSON `tool` | 25 个工具：项目/章节/读写/检索/删除/移动/命令 | 工具结果、审批、chips | 走 port；无统一版本 |
| 左栏项目/计划/阶段 | `ui/agent-workbench/stage-panel.ts` | 项目列表、记忆、计划 | 项目树、计划、阶段面板 | 点击直达 | 会话快照 |
| 右栏文件树/预览 | `ui/agent-workbench-view.ts` | 文件树、选中文件 | 展开、预览、遥测 | 折叠区 | 只读预览 |
| dsh 后端 | `bootDsh` | dsh 进程/协议 | 可选外部后端，失败回退 | 模式徽标 | dsh 会话；spill |

### 1.4 横切能力

| 能力 | 入口 | 说明 |
|---|---|---|
| 右侧上下文面板 | `ui/rendering/context-panel.ts` | 必做输入、模块失败、压缩截断警告、token 条 |
| 手动上下文注入 | `ui/context-injector-modal.ts` | 读取涉及实体与未揭示伏笔，幂等写正文（当前无锁/无版本） |
| 知识库 | `ui/views/knowledge-base-view.ts` | 参考书、维度配置、拆解、向量化、匹配 |
| 写作指纹 | `ui/views/writing-fingerprint-view.ts` | 模板/全局/项目指纹、强度、混合/蒸馏 |
| 注入账本 | `shared/injection-ledger.ts` | 统计注入段与预算；当前统计截断前变量 |

---

## 2. AI 上下文链路与回写机制

### 2.1 章节流水线主链

```
用户输入/章节信息
  → ContextManager.gatherAll()                        engine/context-manager.ts
      ├─ 12 模块并行采集（人物/灵魂/记忆/地点/势力/物品/设定/文风/伏笔/时间线/规则/世界观）
      ├─ compressWorldContext()                        engine/context-compressor.ts
      └─ 内存缓存：key=项目::当前章，TTL 5min，LRU 16
  → buildTemplateVars()                               ui/full-writer/template-vars-builder.ts
      ├─ 实体变量（关键词打分 + 主角兜底）
      ├─ 上下文变量（优先 compressed）
      ├─ applyStoryContextBus()                        engine/context/story-context-service.ts
      ├─ 上下文体检/去重                                 shared/context-hygiene.ts
      └─ 注入账本（截断前）
  → resolveStepPrompt()                               engine/prompt-resolver.ts
  → StepRunner.executeCurrentStep()                   engine/step-runner.ts
      ├─ 本步模型/任务预算
      ├─ assembleStepPrompt()                         engine/step-prompt-assembly.ts
      │   ├─ 知识/指纹注入
      │   └─ fitPromptToContext()                     shared/prompt-budget.ts
      ├─ callAI / callAIStream
      │   └─ AIEngine → AIApiClient（available < 512 才拒绝）
      ├─ finishReason/截断处理（正文自动续写最多 3 次）
      ├─ 后置校验/情绪审计/下游失效
      └─ saveStepResult()                             engine/step-result-saver.ts
          ├─ 正文 → BodyWriter（锁 + 版本）
          └─ 非正文 → 直接 fs.write（无锁/无版本）
  → 质控 / 事实入队 / 定向修订
  → 结算 SettlementEngine.settle()                     engine/settlement-engine.ts
      ├─ 17 类回写 + journal 回滚
      └─ 快照/总览
  → 账本：执行登记（内存）、用量账本（JSON）、分析会话、版本库
```

### 2.2 协同写作链

`openChapter` → flush 上一章 → `CoWriterEngine.init`（`gatherAll` + 快照 + 故事上下文包）→ 光标前文（截尾 2000 字）→ 输入预算 → 知识/指纹注入 → `PromptBuilder.buildSuggestionPrompt`（分区优先级 + 必保尾部）→ 调用 → 候选卡 → 接受 → 2 秒防抖 `BodyWriter.write` → 指标/实时分析。

### 2.3 Agent 链

`submit` → 引用/附件拼 payload → `runTurn`（压缩检查 + 系统提示 + 回合预算）→ 适配器 → 工具调用 → 日志追加 → 会话存档。

Agent 不自动注入 `ContextManager`/故事上下文；只能靠工具读取。`@` 引用只把路径放进 payload。

### 2.4 注入链

- 正文知识：`StepRunner.loadBodyKnowledge` → `KnowledgeInjector.injectForBodyGeneration`（风格→节奏→技巧→人物→伏笔→规则）→ `extraTail`。
- 指纹：`StyleFingerprintLibrary` → `selectBodyStyleSamples` → `systemTail`（不参与预算裁剪）。
- 协同：`PromptBuilder.getFingerprintPromptParts` + `getKnowledgePromptParts`，与 `KnowledgeInjector` 段存在重叠。
- 故事上下文包：local 4200 / cloud 24000 token 上限；必含项 + 优先级 + 每类名额。

### 2.5 回写矩阵

| 产物 | 写入器 | 锁 | 版本/回滚 | 现状 |
|---|---|---|---|---|
| 正文 | `BodyWriter.write` | `withWriteLock` | 覆盖前版本备份；5 分钟节流 | 强 |
| 步骤结果 | `step-result-saver.ts` | **无** | 无 | 弱：并发可覆盖 |
| 步骤 frontmatter | 同上 | **无** | 无 | 弱：`getFile` 失败静默 |
| 结算实体/伏笔/时间线/关系 | `SettlementEngine` | 逐文件锁 | journal | 强，但 8 个子步骤异常只告警 |
| 结算表 | `ChapterSettlementModal` | **无** | 无 | 弱；步骤结算不写表 |
| 正文 `status=settled`（弹窗） | `chapter-settlement-modal.ts` | **无** | 无 | 与引擎锁不共享 |
| 分析面板直接应用 | `analysis-report-panel.ts` | 部分内部锁 | 无 journal | 可绕过结算 |
| 手动上下文注入 | `context-injector-modal.ts` | **无** | 无 | 绕过 BodyWriter |
| Agent `write_file` | `host-tools.ts` | 依赖 port | 无 | 可覆盖正文 |
| 版本库 | `chapter-version-service.ts` | 索引锁 | 自身即回滚基础 | 强 |
| 执行登记 | `execution-ledger.ts` | 内存 | 无 | 不落盘 |
| 用量账本 | `usage-ledger.ts` | 无 | 无 | 追加 |
| 向导/导出标记 | localStorage | — | — | 换设备丢失 |

### 2.6 缓存与失效

- `ContextManager` 缓存 key 为项目+章，TTL 5 分钟；`invalidateCacheByPath` 由 `main.ts` 的 modify 事件调用，但 `CharacterRepository` 自带 5 分钟 TTL，不随 modify 失效。
- 故事上下文包按场景 key 重建；协同切场景才刷新。
- 指纹库按 `mtime+size` 签名加载（已实现）。
- 知识向量按文件签名加载。

---

## 3. 缺陷登记

> 编号用于批次验收；证据行号以审计时点为准，实施时以函数名为准。

### 3.1 P0（数据正确性/可构建性）

| ID | 缺陷 | 证据 | 影响 | 批次 |
|---|---|---|---|---|
| P0-1 | 时间线压缩保留最旧 15 条 | `context-manager` 按章号降序取 30；`context-compressor.compressTimeline` 取 `slice(-15)` | 最新事件被丢，注入旧剧情 | B3 |
| P0-2 | 伏笔压缩按 `parts[4]` 统一当计划回收 | `context-compressor.parseForeshadowLines` | 已揭示/废弃行被当未回收；`plannedReveal/status` 丢失 | B3 |
| P0-3 | 伏笔三类行 6/7/8 列并存，移动函数列偏移 | `analysis-report-engine`、`utils/helpers`、`settlement-engine` 三份 `moveForeshadowToRevealed` | 串列、移不走、状态错 | B3 |
| P0-4 | 时间线 4/7 列写入互串，分析报告固定插第一条分隔线 | `analysis-report-engine.applyTimelineChanges`、`settlement-engine.settleStep_createTimelines` | 列错位、写入背景纪元 | B3 |
| P0-5 | `NW-LINKAGE` 块被多个解析器当业务数据 | 只有 `ContextManager` 剥离；分析/伏笔管理器/review 解析到 EOF | 统计与 prompt 污染 | B3 |
| P0-6 | 关联索引写入业务文件，单块整替，参照章取最大正文 | `story-linkage-writer.upsertLinkageBlock`、`context-manager.writeStoryLinkageIndex` | 覆盖、章错、无法多章 | B3 |
| P0-7 | `待回收` 被判为已揭示 | `shared/foreshadow-status.ts` 的裸 `回收` 匹配 | 伏笔被跳过 | B3 |
| P0-8 | 头尾截断“扩尾”逻辑反向，退化为纯前缀 | `shared/prompt-budget.ts` | 尾部写指令丢失 | B8 |
| P0-9 | 关键词压缩可能返回空串，消费方不回退 | `context-compressor.compressByKeywords`；`template-vars-builder` | 世界观/设定库整段消失 | B3 |
| P0-10 | 步骤结果无锁、结算子步骤失败不回滚、步骤结算不写结算表 | `step-result-saver.ts`、`settlement-engine.ts`、`step-runner.ts` | 静默丢写、产物不一致 | B3 |

### 3.2 P1（一致性与记忆）

| ID | 缺陷 | 证据 | 批次 |
|---|---|---|---|
| P1-1 | 人物一致性未接入分析/质控；`attachCharacterConsistencyToReport` 无调用者 | `analysis-report-engine.ts`、`step-runner.ts` | B6 |
| P1-2 | checker 阈值参数未使用、能力检测无关键词回退、段落级归属、子串姓名、平均分稀释 | `character-consistency-checker.ts` | B6 |
| P1-3 | 两套人物规则表分叉 | checker 与 `deviation-detector` | B6 |
| P1-4 | 标准提示词不产生 V2 关系 5 维增量 | `chapter-pipeline-prompts.ts`、`relationship-engine.ts` | B4 |
| P1-5 | 实时关系变化只进事实队列，不写 V2 | `co-writer-state-sync`、`fact-index-vault` | B4 |
| P1-6 | 关系 history 截断破坏幂等 | `relationship-engine.applyRelationshipChanges` | B4 |
| P1-7 | 只读上一章，3 章窗口无生产调用者 | `context-manager.gatherPreviousChapter`、`previous-chapter-window.ts` | B4 |
| P1-8 | 事实确认只追加正文小节，不更新当前状态；确认后可重复入队 | `fact-index-vault.ts`、`fact-index-manager.ts` | B4 |
| P1-9 | 上下文缓存/人物 Repository 不随修改失效 | `context-manager`、`base-markdown-repository` | B3 |
| P1-10 | `QualityGate` 未收 beats，结构层恒通过且不阻断 | `quality-gate.ts`、`step-runner.ts` | B6 |
| P1-11 | 人物属性 schema 不含 OOC/连续性字段 | `frontmatter-schema.ts` | B2 |
| P1-12 | 关系/时间线文件非 frontmatter、无类型/标签，Bases 不可见 | `relationship-engine.ts`、模板资产 | B2/B4 |
| P1-13 | 12 处绕过 `entity-reader` 自建扫描 | 见 §5.5 表 | B2 |
| P1-14 | 图谱反链能力 `getEntityBacklinks` 无调用者 | `entity-graph.ts` | B7 |

### 3.3 P2（可维护性）

| ID | 缺陷 | 批次 |
|---|---|---|
| P2-1 | `TimelineEvent` 两套类型（`chapter: number` vs `string`） | B2 |
| P2-2 | 关联索引模型丢 `location/impact/type/era` | B3 |
| P2-3 | 去重键三套不统一 | B3 |
| P2-4 | 故事上下文图节点 ID 用数组下标 | B3 |
| P2-5 | 状态语义五套并存 | B3 |
| P2-6 | 单元/模式写入无预算闸门 | B8 |
| P2-7 | token 估算口径 4 套（1.5/2/4/字符） | B8 |
| P2-8 | 注入账本统计截断前变量 | B8 |

---

## 4. 目标架构：故事台账 + 实体索引

### 4.1 为什么必须同源

三个真实耦合点：

1. **同一坐标**：时间线事件、伏笔埋设/回收、关联索引都按 `第N章` 定位；伏笔的“到期/逾期”由章节号与计划回收章计算，时间线决定“故事走到哪一天”。
2. **同一引用**：三者的“涉及人物/地点/设定”都是名称文本；图谱、上下文包、联想查询都按名称匹配，名称一改全部断链。
3. **同一产物**：关联索引同时汇总伏笔与时间线，并写回这两个业务文件；解析器不剥离就会把索引当数据。

因此必须共享一套记录模型、一套解析、一套写入、一套 ID/章节引用；否则任何单点修复都会被另一条写入路径写坏。

### 4.2 记录模型（`engine/ledger/ledger-model.ts`）

```ts
type RecordId = string; // EV-xxxx / FS-xxxx / PR-xxxx / REL-xxxx / LNK-xxxx

interface EventRecord {
  id: RecordId;
  name: string;
  time: string;              // 原样保留
  chapterNum: number | null; // 解析失败为 null，不丢记录
  chapterKey: string;        // 第N章
  era: 'background' | 'main' | 'unknown';
  locationRefs: EntityRef[];
  entityRefs: EntityRef[];
  foreshadowRefs: RecordId[];
  impact: string;
  type: string;
  importance: 'high' | 'medium' | 'low' | 'unknown';
  status: 'planned' | 'occurred' | 'unknown';
  source: 'settlement' | 'analysis' | 'manual' | 'import';
  sourcePath: string;
  lineNo: number;
  raw: string;
}

interface ForeshadowRecord {
  id: RecordId;
  name: string;
  importance: string;
  buryChapter: string;
  plannedReveal: string;
  revealChapter: string;
  status: 'unrevealed' | 'revealed' | 'abandoned' | 'unknown';
  relatedRefs: EntityRef[];
  mainline: string;
  eventRefs: RecordId[];
  method: string;
  reason: string;
  sourcePath: string;
  lineNo: number;
  raw: string;
}

interface PromiseRecord { id; name; type; raisedChapter; raisedBy: EntityRef; expectedChapter; status; lastAdvancedChapter; note; }
interface RelationRecord { id; a: EntityRef; b: EntityRef; trust; attraction; fear; resentment; dependence; status; historyKeys: string[]; lastUpdatedChapter; }
interface LinkRecord { id; from: RecordId; to: RecordId; kind: 'mention'|'sets-up'|'pays-off'|'related'|'location'; weight: number; chapterNum: number | null; source: 'explicit'|'derived'; }
```

实体引用：

```ts
interface EntityRef {
  id: string;        // ENT-<hash(kind|canonicalName)>
  name: string;      // 原文名称
  kind: EntityKind;  // character | faction | location | item | unknown
  path?: string;     // 解析成功时的笔记路径
  resolved: boolean;
}
```

### 4.3 稳定 ID 与章节引用

- `EV`：`hash(era|chapterKey|normalize(time)|normalize(name))`；同一条事件重复写入得到同一 ID。
- `FS`：`hash(normalize(name))`；同名伏笔视为同一条（与现有“同名去重”一致）。
- `REL`：`hash(sorted(entityIdA, entityIdB))`。
- `PR`：`hash(normalize(name))`。
- 表格若已有 `事件ID/伏笔ID/关系ID` 列则优先采用；否则派生。重命名保身份的诉求通过显式 ID 列满足，不强制迁移。
- 章节统一走 `shared/chapter-ref.ts`：`parseChapterRef(text) → { num, key, volume? }`；`TimelineEvent.chapter` 双类型收敛为 `chapterNum + chapterKey`，旧类型保留适配器。

### 4.4 唯一解析器（`ledger-parse.ts`）

规则：

1. 先剥离自动块：`NW-LINKAGE`、`NW-LEDGER`（新）；剥离范围只限这些标记。
2. 按 `##` 分节识别业务区（未回收/已回收/已废弃、背景纪元/主线纪元），区内找表头。
3. **按表头映射列**，不按位置：`时间/对应章节/事件/影响`、`#/事件名称/时间/地点/涉及人物/章节/类型`、`#/伏笔名称/重要程度/埋设章节/计划回收/相关人物/关联主线/当前状态`、`#/伏笔名称/重要程度/埋设章节/相关人物/关联主线/回收章节/回收方式`、`#/伏笔名称/原因/废弃章节`。
4. 无表头时按分节类型走列宽兜底；仍无法识别则产出 `raw` 记录并标记 `unknown`，不丢行。
5. 状态统一 `normalizeForeshadowStatus(text, section)`：
   - 未回收节 + `待回收/未揭示/未回收/铺垫中` → `unrevealed`；
   - 已回收节 → `revealed`；
   - 废弃节 → `abandoned`；
   - 其余 `unknown`（保留原文）。
   修正裸 `回收` 误判。
6. 去重键统一为记录 ID；同一 ID 多行时保留信息量最大的一条并产出 `duplicateRows` 警告。

### 4.5 唯一写入器（`ledger-write.ts`）

契约：

- 所有时间线/伏笔/承诺/关系的机器写入必须经过本模块；`settlement-engine`、`analysis-report-engine`、`story-linkage` 适配器、迁移命令都调用它。
- 每次写入：`withWriteLock(path)` → 读 → 解析 → 变更 → 序列化 → 写 → journal 记录（整文件或追加标记）。
- 按目标表现有列宽序列化；旧 4 列时间线保持 4 列，不强行加列；有 `事件ID/关联伏笔` 列时填充。
- 纪元选择：`background` 写「背景纪元」，`main` 写「主线纪元」，`unknown` 写「主线纪元」并加警告。
- 幂等：按记录 ID；同 ID 只在字段变化时更新（`updatedFields` 报告）。
- 失败：抛 `LedgerWriteError`，调用方必须置 `hasPartialFailure`，不得吞掉。
- 兼容：保留 `markdown-table-utils` 旧函数为薄封装，内部改为调用本模块的表格定位，避免跨表取号。

### 4.6 索引与查询（`ledger-index.ts`）

```ts
interface StoryLedgerIndex {
  events: EventRecord[];
  foreshadows: ForeshadowRecord[];
  promises: PromiseRecord[];
  relations: RelationRecord[];
  links: LinkRecord[];
  issues: LedgerIssue[];
  signature: string; // 文件 mtime+size 组合
}
```

查询 API：

```ts
dueForeshadows(chapter: number, window?: number): ForeshadowRecord[]
eventsForEntity(entityId: string, chapterWindow?: number): EventRecord[]
eventsForForeshadow(fsId: string): EventRecord[]
relationsFor(entityId: string): RelationRecord[]
openPromises(chapter: number): PromiseRecord[]
timelineWindow(chapter: number, n: number): EventRecord[]
linksOf(recordId: string): LinkRecord[]
```

缓存：内存按项目 + 文件签名；可选 JSON 缓存放插件数据目录（不写 vault）。任何 ledger 写入后主动失效。

### 4.7 关联索引迁移（`ledger-link.ts`）

- 新落盘位置：`04-项目总控/故事台账/关联索引.md`，按章分节；生成内容来自索引，不再写业务文件。
- 边生成：
  - 显式：伏笔 `关联事件` 列、时间线 `关联伏笔` 列、关系对。
  - 派生：同章事件 ↔ 伏笔（埋设/计划回收章 ±1）、实体共现、场景卡关联。
  - 名称解析失败 → `unresolved` 边 + issue，不猜。
- 旧块处理：读取兼容（继续剥离）；提供命令「迁移关联索引」：备份两文件 → 写新文件 → 删除旧 `NW-LINKAGE` 块 → 校验行数一致。
- `engine/story-linkage.ts` 保留为适配器：`buildStoryLinkage` 内部改用 ledger；`promptText` 仍可供旧链路使用，但数据来自索引。

### 4.8 实体索引与类型注册表

- `shared/entity-index.ts`：从 `metadataCache.getFileCache` 构建 `EntityIndex`；字段：`kind/path/name/aliases/tags/properties/mtime/entityId`。
- 名称消歧：规范名 + 别名（`别称`、文件名、`姓名/名称`）；同名多实体返回候选，调用方必须用路径或类型消歧；不确定时标 `ambiguous`，不静默选第一个。
- `shared/entity-reader.ts` 扩为唯一枚举入口；先替换 `gatherCharacterState`、`chapter-state-snapshot-service`、`entity-graph`、`settlement-engine` 的人物读取。
- 类型注册表：`NotebookFileKind` 增加 `relationship`；镜像模式下增加 `event/foreshadowItem/relation`；`FRONTMATTER_SCHEMAS` 补齐；`resolveFileKind` 补路径/标签规则。

### 4.9 属性、标签、Bases、镜像笔记

- 属性：schema 必须是运行时字段的超集。人物补 `性格标签/外貌特征/人物背景/金手指/功法/核心驱动力_软肋/习惯性小动作/已知信息/伤势/持有物品/entity_last_changed_chapter/entity_last_seen_at`；物品补 `效果/别称/描述`；timeline/foreshadow/relationship 补文件级摘要字段。
- 标签：所有写入走 `withNamespaceTags`；补 `LEGACY_TO_NAMESPACE` 缺失项并统一同义标签；`kindFromNamespaceTag` 补 `nw/设定/关系状态|文笔风格|状态快照|记忆碎片`。
- 文件级摘要：时间线看板 `事件总数/主线事件数/最新事件章节/最后更新`；伏笔库 `未回收数/已回收数/已废弃数`；关系状态 `关系对数/最后更新章节`；新增 `故事台账.base`。
- 镜像笔记（默认关）：设置 `ledgerMirror: 'off'|'on'`；开启后生成事件/伏笔/关系笔记，带 `nw/实体/事件` 等标签，供图谱/Bases/双链使用；**只由 ledger 重建，不反向解析**；删除守卫。
- 查询层：`shared/obsidian-query.ts` 只读 `metadataCache`；Bases 只展示，不读回。

### 4.10 消费方改造清单

| 消费方 | 现在 | 改为 |
|---|---|---|
| 上下文采集 | `parseForeshadowContent/parseTimelineContent` | `ledger-parse` + `ledger-index` |
| 压缩 | `compressForeshadows/compressTimeline` | 索引查询 + 保留字段的压缩 |
| 故事上下文图 | 名称子串连边 | 实体 ID + 结构化边 |
| 结算 | 三份 move/append | `ledger-write` |
| 分析报告 | 自解析 + 7 列写 | `ledger-write` + 目标表列宽 |
| 关联索引 | 业务文件块 | 独立文件 + 适配器 |
| 联想查询 | 无 | `association-resolver` → ledger/entity index |
| 图谱校验 | 无 | `graph-validator` 只读 |
| 记忆摘要 | 上一章原文切片 | 章节摘要 + 3 章窗口 |

---

## 5. 专项方案

### 5.1 人物一致性（防 OOC）

**输入**：人物卡 frontmatter（`性格标签/外貌特征/功法/金手指/人物背景/当前状态/当前情绪`）、正文、章节快照、关系状态。

**规则**：

1. 姓名匹配：最长优先 + 命中区间屏蔽 + 最小长度 2；单字名只在显式别名表启用。
2. 归属：句子级；一句多角色时按最近主语/说话人归属，无法判定则记 `ambiguous` 不扣分。
3. 性格：向量优先，关键词回退；阈值由设置 `oocVectorThreshold`（默认 0.6）控制。
4. 能力：向量 + 关键词回退（当前只有向量）。
5. 外貌：反义词表；同句共现才报 `high`。
6. 行为：性格→不兼容动作表；与 `DeviationDetector` 共用 `shared/character-rules.ts`。
7. 评分：逐角色分 + `worstSeverity`；任一 `high` 即 `passed=false`，不做多角色平均稀释。

**输出**：`CharacterConsistencyReport { passed, worstSeverity, characters[], issues[] }`；持久化 `第N章_一致性检查.md`（步骤产物，走统一 saver）。

**接线**：

- 分析报告 `executeFullAnalysis` 调用并写入 warnings/suggestions（修正死代码）。
- 第 8 步质控把报告传入 `QualityGate`；`QualityGate` 接收 `beats` 与一致性报告，高严重 OOC 使 `passed=false`，触发既有 `autoRevisionAfterQC`，不硬中断生成。
- 质量仪表盘使用真实 checker 结果，不再用姓名列表走 V1 统计。
- 协同设定守卫复用同一规则表；仍只取尾部 1200 字，但阈值/词表统一。

**异常**：无人物卡 → `skipped` 并注明原因；向量不可用 → 关键词回退；解析失败 → 报告 `degraded`，不伪造 100 分。

### 5.2 剧情记忆（长期不失忆）

**记录**：`04-项目总控/剧情记忆/第N章_摘要.md` + `index.json`。

摘要字段（确定性生成，不调用模型）：

```yaml
章: 第N章
标题: ...
在场人物: [ENT-..., ...]
关键事件: [EV-..., ...]
未回收线索: [FS-...]
新事实: [...]
未兑现承诺: [PR-...]
结尾钩子: ...
时间跨度: ...
生成时间: ISO
```

**生成**：结算成功后由 `chapter-digest` 从 ledger 索引 + 正文尾段 + 承诺账本生成；失败不影响结算，但写 `digest_status: failed` 并在下次打开时重试。

**注入**：最近 3 章完整摘要 + 更早章节单行（复用 `previous-chapter-window.ts`）；预算不足时按“最近优先、同章事件优先”裁剪；由 `association-resolver` 或模板变量注入，二者不重复。

**保留**：`index.json` 只增不删；摘要文件按章保存；用户删除后不自动重建（尊重手改），只在结算时重建本章。

**异常**：缺摘要 → 回退上一章正文切片（现有行为）并标注 `degraded`；ledger 不可用 → 用章节快照兜底。

### 5.3 实体关系持久化

- 权威：`01-世界架构/关系状态.md`（V2）不变；V1 互信息仍是人读日志，不解析。
- 提示词：分析报告新增 `RELATION_5D: A|B|trust+5,attraction+2|原因`；保留旧 `RELATION:` 兼容；提示词版本递增，用户覆盖优先。
- 定性映射：`师徒/信任加深/决裂/恐惧` → 小增量（±2–8），带 `source:'qualitative'` 与置信度；数值变化仍以显式 `±N` 为准。
- 幂等：`historyKeys` 独立持久化（frontmatter 或专用行），不再依赖会被截断的 history 文本；同章同原因只应用一次。
- 合并：同一对角色多个 `##` 段加载时合并，保留信息量最大者并产出 issue。
- 实时：协同守卫检测到的关系变化写 `04-项目总控/待确认/关系变更.md`（去重）；用户在质量仪表盘确认后，下一次结算由 `updateV2Relations` 消费；未确认不写权威文件。
- 文件形态：补 `tags: [关系状态, nw/设定/关系状态]`、`关系对数`、`最后更新章节`；`resolveFileKind` 识别为 `relationship`。
- 可选镜像：关系对笔记（默认关），字段 5 维 + 状态 + 章节；只读镜像。

**异常**：关系文件损坏 → 保留原文、跳过写入、报 issue；同名多段 → 合并并警告；写锁失败 → 重试 2 次后置 `hasPartialFailure`。

### 5.4 调用时关联查询

`engine/context/association-resolver.ts`：

```ts
resolveAssociations({ project, task, text, presentEntities?, budgetTokens }): AssociationBundle
```

**触发矩阵**：

| 链路 | 触发 | 查询内容 |
|---|---|---|
| 正文生成 | 装配前，且存在在场实体 | 人物卡摘要、关系、到期伏笔、时间线窗口、最近摘要、未兑现承诺 |
| 质控/分析 | 正文尾段实体 | 人物设定（OOC 输入）、伏笔回收状态、时间线 |
| 协同建议 | 光标前 1200 字实体 | 人物状态、关系、到期伏笔（轻量） |
| 单元写作 | 选区实体 | 同上（轻量） |

**去重**：与已装配段落做规范化集合比较；已存在则 `reused`，只补 `added`；同一实体只出现一次。

**预算**：按 `budgetTokens` 分配，优先级：在场人物 > 到期伏笔 > 关系 > 时间线 > 摘要 > 承诺；超预算整项跳过并记录，不截半句。

**异常**：无实体 → 返回空并 `skipped`；索引不可用 → 降级为现有 `gatherAll` 数据；解析歧义 → 候选列表 + 警告。

### 5.5 图谱兜底（只读）

`engine/graph/graph-validator.ts`，输入 `metadataCache.resolvedLinks` + `EntityIndex` + `StoryLedgerIndex`。

**规则**：

| 规则 | 判定 | 严重度 |
|---|---|---|
| 断链 | wiki-link 目标不存在 | high |
| 孤立实体 | 实体卡被章节 `涉及*` 引用 ≥3 次但无任何入链 | medium |
| 关系缺卡 | 关系状态中 A/B 无对应实体笔记 | high |
| 双链字段不一致 | `所属势力/当前位置/领袖/归属` 链接目标与实体类型不符 | medium |
| 台账未知引用 | 时间线/伏笔引用的人物/地点无法解析 | medium |
| 类型冲突 | 路径暗示人物、标签却是地点 | low |

**触发**：命令「校验故事一致性」；结算成功后（防抖 5 秒，非阻塞）；ledger 重建后。不做定时后台扫描。

**访问规则**：只读 vault 与 metadataCache；只写 `04-项目总控/诊断/故事一致性报告.md`；不修改任何实体/台账文件；无 `metadataCache`（移动端/未就绪）→ `skipped` 并说明。

**报告**：按规则分组，含文件路径、行号、建议动作；只给建议，不自动修。

### 5.6 时间线（与伏笔/关联索引同源）

- 模型/解析/写入/查询全部走 §4。
- 校验规则：
  1. 章号可解析；无章号只警告。
  2. 同一纪元内章号单调（按表内顺序）；倒序报 `out-of-order`。
  3. 时间可解析（`第N天/年/月`、绝对日期、`三日后` 相对表达）；不可解析只警告。
  4. 重复事件（同 ID）。
  5. 引用未知实体/伏笔。
  6. 缺影响列（4 列空值）。
- 输出 `TimelineIssue[]` 进 `StoryLedgerIndex.issues`；上下文面板显示计数；分析报告 warnings 附带。
- 同步点：结算、分析报告应用、迁移命令、手动「重建台账」；其他路径不得直接写表。
- 查询：`timelineWindow(chapter, n)` 返回“最近 n 条 occur 事件”，供上下文/联想/摘要复用。

### 5.7 无强制截断（超长处理）

**原则**：不静默丢信息；预算不足时先补检、再压缩、再重组，仍不足则显式报错并给可操作选项。

**预算计划**（`shared/context/budget-plan.ts`）：

```ts
interface ContextSectionPlan {
  key: string;
  role: 'required' | 'optional';
  priority: number;       // 越大越重要
  minTokens: number;
  currentTokens: number;
  shrinkable: boolean;
}
planContextBudget(sections, maxInputTokens): { sections, total, deficit }
```

**恢复流程**（`engine/context/overflow-recovery.ts`）：

1. **定向补检**：缺口 > 阈值时，用 `association-resolver` 只取“当前场景/在场实体/到期伏笔”的缺失事实；已存在的不重复。
2. **确定性抽取压缩**：按句切分；保留含在场实体、场景关键词、因果连接词的句子；保持原文顺序；输出 `〔压缩：保留 N/M 句，省略…〕`；按内容哈希缓存。
3. **重组去重**：跨段实体/伏笔/时间线只保留信息量最大的一处；保留 required 段与尾部指令。
4. **仍超预算**：抛 `ContextOverflowError { deficit, sections, suggestions }`；正文生成阻断并提示“提高 contextTokenCap / 关闭可选模块 / 缩小输出”；协同短建议降级为告警 + 尽力发送（受 `coWriteMaxTokens` 限制）。

**设置**：`contextCompressionMode: 'extractive' | 'off'`（默认 `extractive`）；`contextOverflowPolicy: 'error' | 'warn'`（正文默认 `error`，协同默认 `warn`）。

**遥测**：`ContextBudgetReport` 写步骤 frontmatter `context_budget`；上下文面板显示每段 kept/compressed/dropped；注入账本记录 `association` 段。

**异常**：抽取压缩失败 → 保留原文并报错，不静默截断；检索失败 → 跳过补检并标注；预算配置非法 → 回退模型窗口并警告。

---

## 6. 验证标准

### 6.1 单元/集成

| 领域 | 必测 |
|---|---|
| 台账 | 4/7 列、三态伏笔、纪元、幂等、列宽保持、旧块剥离、ID 稳定、重复行 |
| 时间线 | 校验 6 条规则、窗口查询、结算/分析写入一致 |
| 关系 | 5 维解析、定性映射、幂等键、重复段合并、待确认队列 |
| 记忆 | 摘要确定性、3 章窗口、缺摘要降级 |
| 联想 | 实体提取、消歧、去重、预算选择、无实体降级 |
| 一致性 | 阈值、子串姓名、同段多角色、能力回退、高严重度 |
| 图谱 | 断链、孤立、缺卡、类型冲突、只读（写调用断言为 0） |
| 预算 | 缺口触发补检、抽取保序、超限显式错误、单元模式有闸门 |

### 6.2 架构门禁

- 时间线/伏笔/承诺/关系写入只允许出现在 `engine/ledger/`（静态扫描白名单）。
- 关系机器读取只允许 `loadRelationshipStates`。
- 正文/单元写入必须经过预算计划（静态扫描 + 白名单）。
- 一致性检查必须被质控与分析调用（存在性断言）。

### 6.3 E2E（mock，不跑 `E2E_REWRITE`）

- 完整旅程：规划→正文→质控→分析→结算→导出。
- 断言：结算表存在；时间线行与表头列宽一致；伏笔状态字段完整；一致性报告生成；`context_budget` 存在；导出含正文。

### 6.4 手工冒烟

Obsidian 重载后跑一章低成本链路：上下文面板显示预算报告；结算后台账/摘要/报告落盘；二次结算幂等；旧项目 `NW-LINKAGE` 迁移后无重复行。

---

## 7. 异常处理与降级

| 失败点 | 行为 | 用户可见 |
|---|---|---|
| ledger 解析失败 | 保留 raw 记录，标记 `unknown`，不丢行 | 面板计数 + 报告 |
| ledger 写入失败 | 抛错，调用方置 `hasPartialFailure`，journal 可回滚 | 错误卡 + 重试 |
| 结算子步骤失败 | 不再只 log；置 partial 并停止后续产物 | 结算弹窗提示 |
| 索引不可用 | 降级到 `gatherAll` 原始数据 | 警告 |
| 实体歧义 | 返回候选，不静默选择 | 选择器/警告 |
| 图谱无 metadataCache | `skipped` | 报告注明 |
| 摘要生成失败 | 结算继续，标记 failed，下次重试 | 状态栏 |
| 预算不足 | 补检→压缩→报错 | 可操作提示 |
| 迁移失败 | 备份保留，原文件不改 | 迁移报告 |

数据安全约束：所有台账写入 `withWriteLock` + journal；迁移先备份；镜像笔记删除有守卫；不修改用户正文以外的非目标文件。

---

## 8. 迁移与兼容

1. **格式**：解析器兼容 4/7 列时间线、6/7/8 列伏笔、旧 `NW-LINKAGE`；写入保持目标表现有列宽。
2. **关联索引**：旧块继续读取并剥离；迁移命令把内容搬到 `04-项目总控/故事台账/关联索引.md`，校验行数后删旧块；失败回滚备份。
3. **标签**：新增 `nw/*` 只追加不删除；旧扁平标签保留；迁移命令幂等。
4. **属性**：只补空值，不覆盖用户值；`findMissingProperties` 对无默认值 required 字段写占位后不再重复报缺失（修正收敛）。
5. **镜像笔记**：默认关；开启后只生成不改用户手写笔记；关闭后不自动删（提供清理命令）。
6. **回滚**：每批独立提交；数据迁移命令带备份与 `--dry-run`；失败用备份恢复。

---

## 9. 实施批次

| 批次 | 交付 | 出口 |
|---|---|---|
| B0 | 恢复构建（外部回退清理） | `tsc/lint/现有单测` 绿 |
| B1 | 本文档 + 索引登记 | `check:docs` 绿 |
| B2 | chapter-ref / entity-index / query / schema / 标签 | 单测 + `tsc` + `lint` |
| B3 | ledger 五模块 + 写入方迁移 + 关联索引独立 | 台账单测 + 旧项目兼容 |
| B4 | 关系 5 维 + 待确认队列 + 章节摘要 | 关系/摘要单测 |
| B5 | association-resolver 三链路接入 | 去重/预算单测 |
| B6 | character-rules + checker + 质控/分析接线 | OOC 单测 + 架构断言 |
| B7 | graph-validator + 报告 | 只读断言 + 规则单测 |
| B8 | budget-plan + overflow-recovery + 三链路闸门 | 无静默截断断言 |
| B9 | 门禁/E2E/文档/台账收口 | `preflight:release` 绿 |

每批红灯不提交；连续两次修不好用 `record-iteration.mjs --type blocked` 记录并停止后续批次；不得抬基线过关（必要时写 note）。

---

## 10. 实施状态（2026-11-10）

| 批次 | 状态 | 提交 | 验收 |
|---|---|---|---|
| B0 | 完成 | —（外部回退已 stash） | `tsc=0` |
| B1 | 完成 | `da84753` | `check:docs` 通过 |
| B2 | 完成 | `4d1139a` | 30 测试通过 |
| B3 | 完成 | `44612b8` | 170 回归测试通过 |
| B4 | 完成 | `ded5ca6` | 关系/摘要 37 测试通过 |
| B5 | 完成 | `7cdc18f` | 关联查询 42 测试通过 |
| B6 | 完成 | `4e8aaff` | 一致性/门禁 129 测试通过 |
| B7 | 完成 | `df20025` | 图谱规则 2 测试通过 |
| B8 | 完成 | `025e4a5` | 预算/压缩 64 测试通过 |
| B9 | 进行中 | — | 架构契约测试 + 文档 |

已落地与本文设计的差异：

- 关联索引改为 `04-项目总控/故事台账/关联索引.md`；旧 `NW-LINKAGE` 块只读兼容、不再写入业务文件。
- 图谱兜底只读、只写 `04-项目总控/诊断/故事一致性报告.md`；没有自动修复。
- 超长上下文默认 `extractive`：先定向补检，再按句抽取压缩；正文/质控/分析仍超时抛 `ContextOverflowError`，协同短建议保留告警策略。
- 逐条事件/伏笔/关系镜像笔记未启用（默认关，设计保留）。

