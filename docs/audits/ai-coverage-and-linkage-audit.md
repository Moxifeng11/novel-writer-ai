# AI 接入现状与表单联系断链审计（ai-coverage-and-linkage-audit）

- 日期：2026-11-14
- 任务来源：用户直接要求「查清哪些还没接入 AI、降级为什么影响质量、表单之间的联系是否真正进入 AI 写作」
- 取证方法：四路并行探索智能体（AI 调用点普查 / 创作链路逐步 AI 属性 / 降级路径普查 / 表单联系数据流）+ 高影响结论逐条人工核实 + 用户实际运行配置（data.json，脱敏）核验
- 立项：见 §六（任务板 DSH-20261114-01 ~ 08）
- 可信度标注：§三/§四 中【已核实】= 人工 grep/读码确认；【智能体取证】= 并行智能体给出 file:line、未逐条复跑，置信度高但如实施请先复核现场

---

## 一、AI 调用面总量（普查结论）

- 真正发起 `callAI*` 调用的非测试文件 **53 个**（engine 34 + ui 19；另有 1 处动态绑定 `consistency/consistency-audit-wiring.ts:302` 的 `engine.callAI.bind(engine)`，点号 grep 会漏）。
- 长篇章节流水线 11 步中 **8 步真 AI**（信息规划/情节蒸馏/大纲摘要/情绪规划/Scene 展开/正文流式/质量控制/分析报告）；向导 8 步中 **6 步真 AI**（世界观/设定库/文笔风格可选 AI/实体 4 类/全书规划）。
- 唯一网络出口 `shared/http-transport.ts`，import 方 6 文件（AI 客户端两件套、embedding×2、本地模型探测×2）；例外：`agentBackend='dsh'` 时走 `engine/agent/dsh/` 子进程 JSON-RPC。
- 死接口：`ai-engine.ts:772 callAIWithTemplate` 全仓零调用【已核实】。

## 二、不调 AI 的内容生产点（定位澄清——不是质量问题根源）

| 环节 | 位置 | 性质 |
| --- | --- | --- |
| 故事结构（向导 1） | `shared/story-structure.ts:488 generateRandomStorySettings` | CSPRNG 在预置池加权抽样；语义字段经 `creationModePrompt` 进 prompt ✅ |
| 批量建章（向导 7） | `ui/batch-create-modal.ts:324-372` | 纯模板骨架落盘，供 AI 步骤填充 ✅ |
| 角色灵魂（步骤 3） | `engine/step-specials.ts:71-118` | **执行体=把 `ctx.vars.characterCores` 拷贝落盘**；灵魂数据源头是实体生成 AI；跳过实体向导则此步报错卡住（`wizard-controller.ts:292` entities 是唯一可跳步）⚠️ |
| 章节结算（步骤 10） | `engine/step-settlement.ts:104-217` | 规则引擎，消费第 9 步 AI 提取的 `UPDATE_/NEW_/RELATION:/GROWTH:/EMOTION:` 指令确定性回写 ✅ |
| 上下文装配（步骤 0）/导出 | `template-vars-builder.ts:722` / `engine/export/` | 磁盘 gather + 规则计算，零 AI（装配质量问题见 §四） |
| 拆解统计层 | `workers/deconstruction-worker.js`（bundle 无 callAI） | 无 LLM 增强时纯统计；降级可见性缺陷见 §三-4 ⚠️ |
| 质量评估 worker | `engine/mode-unit-quality.ts:48,126` | 纯统计评分（设计如此） |
| 协同轻审查四项 | `engine/co-writer-engine.ts:2611` 起 | 自我标注「同步，不走 AI」的检查器，不生成正文 ✅ |

短篇/剧本与长篇共用 engine 层 AI 端口（`mode-document-writer` / `mode-unit-writer`，单元写作流式 ：427），不是「独立未接 AI」；差异只在模式注入块与文件布局，实体管线比长篇薄。

## 三、降级路径与可见性（按危害排序）

【已核实】与【智能体取证】混合，实施前请复核现场：

1. 【已核实】**知识检索失败 = 空注入继续写**：`engine/knowledge-injector.ts:792,819,857,906` 各 `buildKb*` catch→返回空串，无 Notice、不走 degradation-notifier；执行时间线 knowledgeTail 行 `chars=0` 被 `ui/full-writer/execution-panels.ts` 过滤**直接不渲染**——风格/节奏/考据指引静默归零。
2. 【智能体取证】**上下文硬截断仅 log.warn**：`engine/context-manager.ts:755-766`；一键路径 `vars['contextTruncated']`（`context-loader-controller.ts:147`）**全仓零读者（死标志）**。
3. 【智能体取证】**模板变量失败静默置空**：`ui/full-writer/template-vars-builder.ts` 十余处（:512 伏笔计划、:846 entityRelations、:938/:955 承诺账本/角色弧线、:1007 场景卡兜底文案…），仅 log.warn。
4. 【智能体取证】**LLM 增强降级不可见**：`engine/llm-enhancer.ts:176,188,206,395,401,412,497,503,514` 全系列只 log；`LLM_DEGRADED` 标记全仓仅 `rhythm-deconstructor.ts:1642` 一处检查且同样只 log——用户开了 `deconstructionEngine.llmEnabled`，模型坏了拆解悄悄变纯统计，知识库 UI 无「已降级」标记。
5. 【智能体取证】**流式三级降级静默**（原生 SSE→模拟流→完整响应，`engine/ai-api-stream.ts:547,584,609` 仅 log.warn）；**maxTokens 静默夹紧**（:122-126）；**空正文扩容/关思考重试不可见**（ai-api-client.ts:770-798）。
6. 【智能体取证】**跨模型回退**（`buildFallbackModels`=请求模型+全部 availableModels，ai-api-client.ts:213-227）有 CRITICAL Notice，但**成稿不记录实际落笔模型**。
7. 【已核实→做得好的】prompt 超预算丢段在 11 步链路**有** Notice CRITICAL + 时间线 `droppedSections/trimmedSections` 展示（`step-runner.ts:1287-1316`、`execution-panels.ts:88-110`）。
8. 【智能体取证】degradation-notifier 覆盖缺口：`source 'llm'` 语义该覆盖但几乎无发射方（仅 generate-character-modal 两处）；知识检索失败、硬截断、步骤级注入跳过（`step-runner.ts:172,203,307,354,382,410,432,2010` 八处）都不走 notifier。

## 四、表单联系断链清单（核心发现）

**总判断：结构化表单数据大量只流向「结算/一致性检查」侧；生成 prompt 侧靠名称子串匹配与上一章快照兜底。**

| # | 断链 | 证据 | 可信度 |
|---|---|---|---|
| 1 | **事实库三元组从不进写作 prompt**：`toContextNodes`（`engine/context/knowledge-fact-nodes.ts:106`）已实现、`story-context-graph.ts:1067` 已能消费 `source.factNodes`，但 `story-context-service.ts:111-134` 与 `co-writer-engine.ts:2376-2396` 两个适配器都没构造传参——全仓零生产接线；事实只被 `consistency-audit-wiring.ts:345`（审核）消费 | 【已核实】grep 生产调用为零 |
| 2 | **人物卡连续性三字段（已知信息/伤势/持有物品）不进主实体块**：`formatCharacter`（`story-context-graph.ts:308-344`）与 `buildEntityVars`（`template-vars-builder.ts:164-195`）均无这三字段（`frontmatter-schema.ts:101-103` 定义为「连续性账本」）；仅上一章快照（`chapter-state-snapshot-service.ts:76-78`，快照过期即整块撤下 `context-manager.ts:1596`）与 `association-resolver.ts:143-144`（无持有物品，且只挂 bodyGeneration/qualityControl/analysisReport 尾部 `step-prompt-assembly.ts:165`）部分覆盖——**手工更新人物卡对一键正文 `${allChars}` 无影响** | 【已核实】 |
| 3 | **台账稳定 ID/关联边不参与生成**：`ledger-io.ts:121-127` 构建 `buildLedgerIndex` 不传 `links/relations`（恒空）；`buildLedgerLinks`（`ledger-link.ts:38`）唯一调用是关联索引看板渲染（`context-manager.ts:2484`）；生成侧「伏笔↔人物」退化为名称子串匹配（`story-context-graph.ts:964-971`） | 【已核实】 |
| 4 | **`story_linkage.promptText`（本章关联索引 ≤1800 字）只进旧单章弹窗**：唯一消费者 `ui/write-chapter-modal.ts:349`；一键链路只拿它定伏笔 due 优先级，文本本体不进 body 模板 | 【已核实】 |
| 5 | 结构阶段/硬规则不进正文 prompt：`template-vars-builder.ts:736-739` 产出 `narrativeStructureStages` 后全仓无模板引用；五套结构 beats/hardRules（`shared/story-structure.ts:39` 起）只到 UI | ~~【智能体取证】~~ **已勘误（DSH-20261114-07）**：`buildLongStoryPromptBlock` 一直含「结构阶段 + 硬约束」段，且经 `getCreationModePromptBlock → creationModePrompt` 追加到每个步骤 system prompt（`template-utils.ts:154-160`）——断链不成立；真实缺口是链路无测试锁定，已在 `tests/unit/shared/story-structure-prompt.test.ts` 逐环锁死。`narrativeStructureStages` 变量定位为 UI 展示（template-vars-builder 注释已说明） |
| 6 | 时间线「涉及人物/地点/类型」列不进 `${timelineEvents}`（4 列 legacy：时间/章节/事件/影响）；涉及人物只在 `${storyContextPack}` 交叉摘要（v2/v3 有、v4 无） | 【智能体取证】 |
| 7 | **body-v4 模板整段丢注入**：`allFactions/allLocs/allItems/unrevealedForeshadow/timelineEvents/storyContextPack/entityRelations/triggeredMemories/longTermMemory` 九变量 v2 全 1、v4 全 0（逐一 grep） | 【已核实】 |
| 8 | **`entity_status`（dead/hidden）无消费端过滤**：`frontmatter-schema.ts:89` 定义、结算写入 `settlement-engine.ts:385-452`，`story-context-graph.ts:434` 只存 metadata——死者/隐匿实体照常进 `${allChars}` | 【智能体取证】 |
| 9 | 结算表零生成侧读者：`batch-pipeline-runner.ts:410` 载入 `stepResults['settlement']` 后零消费（grep 无命中） | 【智能体取证】 |
| 10 | 死代码：`formatSnapshotForPrompt`（`world-state-snapshot.ts:206-225`）无生产调用方；`callAIWithTemplate`（`ai-engine.ts:772`）零调用 | 【已核实】 |

附加错位：`chapter-snapshot-builder.ts:90` 把「当前状态」错位映射为 `injury`，knowledge-injector 展示的「伤势：」实为当前状态文本【智能体取证】。

**字段级补充**【智能体取证】：人物卡「性别/首次出场/entity_last_*」不进 prompt；物品「当前状态」仅 entity-graph 随身物品行间接出现；伏笔「计划回收」legacy 变量与图完整文本都有、但不进 `${storyContextPack}` 交叉摘要。

## 五、「AI 写作没优势」因果链

```
向导大纲空洞 / 实体被跳过 → 灵魂层空 → auto 路由落 v1（最老模板，template-utils.ts:124-141）
  ＋ 知识检索静默失败 → 风格/节奏/考据指引归零（§三-1）
  ＋ 人物卡更新不进 allChars、事实库断链、台账关联边断链（§四-1/2/3）
  ＋ 死者照常注入（§四-8）
  ⇒ AI 拿到缺料 prompt → 正文「模板感」→ 用户感知「AI 没优势」
```

与历史审计口径一致：设定数据不缺、AI 调用面不缺，**断的是「表单 → prompt」最后一公里与静默降级的可见性**。

## 六、立项清单（任务板 DSH-20261114-01 ~ 08，FIFO）

| 任务 | 内容 | 主要写范围 |
| --- | --- | --- |
| DSH-20261114-01（P0） | 事实库接入生成 prompt：`buildStoryContext` 与协同适配器补传 `factNodes`（`toContextNodes` 现成，纯接线） | engine/context/story-context-service.ts、engine/co-writer-engine.ts、tests |
| DSH-20261114-02（P0） | 人物卡连续性三字段进主实体块（formatCharacter/buildEntityVars）+ snapshot-builder injury 错位修复 + association-resolver 补持有物品 | engine/context/story-context-graph.ts、ui/full-writer/template-vars-builder.ts、engine/chapter-snapshot-builder.ts、tests |
| DSH-20261114-03（P0） | 知识注入空转可见化：检索失败走 notifier + 知识库链路状态降级显示 + 时间线 chars=0 行不吞 | engine/knowledge-injector.ts、engine/step-runner.ts、ui/views/knowledge-base-view.ts、tests |
| DSH-20261114-04（P1） | 台账 links/relations 进 buildLedgerIndex，生成侧用稳定 ID 关联（复用 buildLedgerLinks 唯一写入器约定，不得绕过 D3-17 锁语义） | engine/ledger/ledger-io.ts、engine/context/story-context-graph.ts、tests |
| DSH-20261114-05（P1） | entity_status dead/hidden 过滤（新链路 + 旧打分路径双覆盖） | engine/context/story-context-graph.ts、engine/entity-scorer.ts、tests |
| DSH-20261114-06（P1） | story_linkage.promptText 接进一键链路（body/质控/分析三步尾部，≤1800 字预算） | engine/step-runner.ts、ui/full-writer/context-loader-controller.ts、tests |
| DSH-20261114-07（P1） | 结构阶段/硬规则进正文 prompt（narrativeStructureStages 找到消费端：v1/v2/v3 模板或 creationModePrompt 扩展） | shared/story-structure.ts、engine/prompts/*、tests |
| DSH-20261114-08（P2） | 治理杂项：body-v4 补变量或标注实验版料不全、跨模型回退记录进成稿/时间线、maxTokens 夹紧可见化、死代码清理（callAIWithTemplate/formatSnapshotForPrompt/PromptsSection 死导入） | engine/prompts/body-v4-prompts.ts、engine/ai-api-stream.ts、engine/ai-engine.ts、tests |

## 七、边界与未验证项

- 用户实际配置核验：`activeBodyTemplate='auto'`（灵魂层就绪→v2，否则 v1；v4 仅显式 `_bodyVariant='v4'` 触发）；端点 api.deepseek.com、模型 deepseek-flash；`deconstructionEngine.llmEnabled=true`；`fingerprintInjectionBudget=2000`；knowledge-injector 默认 `enabled=true`（`setEnabled` 无生产调用方）。data.json 中未发现强制 `_bodyVariant`。
- 【智能体取证】条目在实施时需先复核现场（行号以取证时点为准）。
- 本审计不含 token 成本/延迟层面的评估，不含具体 prompt 文案设计。
- 报告不改动任何运行时代码；§六 8 项均为独立可发任务，实施时按仓库门禁（preflight + 回归锁）验收。

## 八、勘误与阶段3收口（2026-11-14）

### §四-9「结算表零生成侧读者」——**勘误：该项失效**

原文引用 `batch-pipeline-runner.ts:410` 载入 `stepResults['settlement']` 后零消费。
复核结论：
- 该文件**已不存在**（历史重构后移除），全仓已无 `stepResults['settlement']` 的读写
- 结算表是**用户可读产物**（写入 `结算表` 文件、带 `nw/步骤/结算表` 标签，`chapter-utils` 按类型识别），
  不是生成侧输入——"零生成侧读者"是**设计如此**，不是断链
- 结算结果的**状态面**已有读者：`step-runner` 把 `summarizeSettlement(result)` 写进执行台账，
  失败/回滚会抛错并标 `settlement_partial`

结论：**不接线、不删除**，该项从待办移除。

### 阶段3 已修（本轮）
| 项 | 修法 |
|---|---|
| §四-6 时间线列 | 新增 `shared/timeline-events-format.ts`：涉及人物/地点/类型随事件注入（10 条测试） |
| §三-2 contextTruncated 死标志 | 截断时上报 `injection` 降级事件（Notice + 诊断包可见） |
| §三-3 模板变量静默置空 | 11 处 catch 收敛到 `warnVarsDegraded`（同标签去重，走 degradation-notifier） |
| §三-4 LLM 降级不可见 | `llm-enhancer` 三个降级路径上报 `source='llm'` 事件（同维度去重，4 条测试） |
