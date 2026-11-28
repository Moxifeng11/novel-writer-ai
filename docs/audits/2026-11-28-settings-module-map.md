# 设置面板全量字段 ↔ 模块映射底账（2026-11-28）

> 生成方式：按 `ui/settings/section-factory.ts` 的 20 个页签逐文件枚举
> （grep `.onChange`/`addToggle|addDropdown|addText|addSlider` 提取写入字段），
> 默认值对照 `core/settings-service.ts` getDefaultSettings()（L491-652）与
> `main.ts` NovelWriterSettings（L294-762），消费方经全仓 grep 读取点核实。
> 用途：「按设置摸清每个模块」的底账 + 死配置/口径分裂清单的出处。

## 功能域与页签总览（6 域 × 20 tab）

| 域 | 页签 |
|---|---|
| connect | setup / api / agent / mcp |
| writing | cowrite / writing / modes / suggestions |
| rules | rules / recognition / foreshadow |
| knowledge | knowledge / deconstruction / template / fingerprint |
| ui | appearance / layout |
| ops | projects / performance / about |

---

## setup（SetupSection · setup-section.ts）
- `templateScaffoldOnStartup`（默认 true）— toggle — 启动时自动写「元文件」模板树 — `main.ts:3377`
- 其余全是按钮/只读（自检清单、一键修复模板、示例项目、结算恢复、首启引导），无 settings 写入。

## api（ApiSection · api-section.ts）
渠道详情（写入 `customProviders[]`，经 `plugin.updateProvider`）：
- `customProviders[].name` / `.endpoint` / `.apiFormat`（openai-chat/ollama/anthropic 等）/ `.requestUrlOverride`
- `providerKeys[providerId]`（加密落盘）+ 当前渠道同步 `apiKey`
- `customProviders[].headers`（每行 Key: value）
- `.models / .disabledModels / .modelMeta{contextWindow,maxTokens,vision,单价} / .modelsEndpoint` → 同步进 `settings.availableModels`
- 「使用中」切换 → `apiEndpoint`；可见性 → `enabledProviderIds`
- 渠道级思考强度 → `providerThinking[id]{mode,budget}` — `ai-api-client.ts:409`

全局模型分配（`providerAssignments[id]`）：
- `.defaultModel`（deepseek-v3-2-251201）— `core/provider-manager.ts:534`
- `.flashModel` — `ai-chapter-helpers.ts:56`；`.proModel` — `ai-character-generator.ts:307`
- `modelOverrides[endpoint][model].maxContext/.maxOutput` — `ai-engine.ts:444`、`context-manager.ts:250`

任务参数（仅当前渠道，折叠区）：
- `thinkingLevel`/`thinkingIntensity`/`thinkingMode`（默认无）— `step-runner.ts:1024,1307,2329`、`analysis-report-engine.ts:561`、`fingerprint-extractor.ts:251`、`style-distill-service.ts:111`（经 shared/task-model.ts）
- `budgetTier`（lean/balanced/generous/extreme）— `shared/task-budget-engine.ts:189`；`thinkingBudget`（0）— :230
- `taskBudgets` / `providerTaskBudgets[id]` — `provider-manager.ts:194-198`

同人考据（`canonResearch.*`）：provider（manual/deepseek/mcp/wikipedia/bangumi/bing/brave/serper/tavily）/ mcpServerId / mcpToolName / mcpQueryParam / apiKey（加密）/ allowedDomains / blockedDomains / maxSources（6）/ excerptChars（1200，钳 200–20000）— `services/canon-research-service.ts:276`
密钥加密卡片：解锁/设定/重置口令（会话态，非 settings 字段）。

## cowrite（CoWriteSection · writing-sections.ts）
- `coWriteModelMode`（local/cloud）— `co-write-options.ts:156`；`coWriteModel`（空=自动探测）— `local-model-utils.ts:101`
- `coWriteCloudProvider` / `coWriteCloudModel` — `co-write-options.ts:276,134`、`ui/co-writing/control-panel.ts:146`
- `coWriteTemperature`（0.7）— `co-writer-engine.ts:311`；`coWriteMaxTokens`（600）— :313,391
- `coWriteNumCtx`（0=自动）— :305；`coWriteCandidateBatching`（true）— `co-writer-engine.ts:1040`
- `autoPlotEvaluation`（true）— `ui/cowrite/live-analysis-controller.ts:129`；`autoGhostAssociation`（true）— `co-writing-view.ts:3141`

## writing（WritingSection · writing-sections.ts）
字数组：`defaultWordCount`（3000）— `co-writing-view.ts:3233`、`four-check-refresh.ts:49`；`minWordCount`(2500)/`maxWordCount`(5000) — **仅本页校验提示**（引擎实际按 `wordMinRatio` 消费）⚠️ 口径分裂
形态组：`naturalParagraphMode`(true) — `step-result-saver.ts:379`；`stepGateMode`('costly') — `step-runner.ts:1222`；`bodyConfirmMode`('overwrite') — `continue-chapters-modal.ts:420`；`activeBodyTemplate`('auto') — `template-vars-builder.ts:1151`；`humanVoiceMode`('exemplar') — `step-runner.ts:874`；`countableHumanHints`(false) — :1154；`structuredChangeLines`(false) — `step-result-saver.ts:341`、`template-vars-builder.ts:676`
上下文组：`storyContextTier`('auto') — `story-context-service.ts:65`；`enableAutoModelFallback`(true) — `ai-api-client.ts:662`；`contextTokenCap`(0) — `step-runner.ts:1142`；`contextCompressionMode`('extractive') — :263；`contextScope`('compact') — `entity-state-controller.ts:47`；`promptSplitRatio`(0.67) — `step-prompt-assembly.ts:291`
闸门组：`refineRounds`(3) — `step-modal-controller.ts:485`；`autoRevisionAfterQC`(true) — `step-runner.ts:1791`；`bodySceneContextStrict`(false) — `template-vars-builder.ts:380`；`sceneLoopBodyGeneration`(false) — :1546；`settlementStrictWrites`(false) — :248；`coWriteStructuredConstraints`(false) — `co-writer-engine.ts:1001`；`contextHygieneAutoFix`(true) — :1167
阈值组：`wordMinRatio`(0.7) — `step-definitions.ts:143`、`step-runner.ts:748`；`antiAiExtraWords`([]) — `main.ts:1113`→`anti-ai-detector.ts:142`

## modes（ModeSection）
无用户可改项（三类创作模式只读展示，常量 `MODE_LIBRARY_ROOTS` / `CREATION_MODE_SPECS`）。

## recognition（RecognitionSection · general-sections.ts）
- `characterRecognitionLayers`(['rule','vector'])×3 层开关 — `character-recognition-modal.ts:108`（组装 RecognitionOptions → `character-recognition-pipeline.ts`）
- `ruleLayer.minMentionCount`(5)/`enableFreqFilter`(true)/`enableContextCheck`(true)/`enableVerbFilter`(true)
- `vectorLayer.enabled`(true)/`semanticFilterThreshold`(0.5)/`mergeSimilarityThreshold`(0.85)
- `llmLayer.enabled`(false)/`verifyBatchSize`(20)/`titleBatchSize`(8)/`minConfidence`(0.3)

## suggestions（SuggestionsSection · general-sections.ts）⚠️ 死配置
- `suggestions.autoAdoptHighConfidence`(false)/`autoAdoptThreshold`(0.9)/`showEvidenceByDefault`(false)/`batchAdoptThreshold`(0.7)
- **全仓仅设置页自身读写，无 engine/ui 消费点**（预留配置）。重构候选：接线或摘除。

## template（TemplateSection · writing-sections.ts）
无直接 settings 控件。上半模板文件列表（`ui/template-manager.ts`）；下半 PromptManagerSettings → `services/prompt-manager.ts`，持久化到 `promptManagerConfig`（main.ts:1138-1146）。默认步骤模板与引擎 canonical 的同源由 `check:template-parity` 门禁兜底（fafe4107）。

## fingerprint（FingerprintSection · fingerprint-section.ts）
- `extraAiHighFreqWords`([]) — `anti-ai-detector.ts`（main.ts:1113 注入）
- `styleKeywordOverrides.positiveEmotion/.negativeEmotion/.highIntensity`([]) — `style-features-v2.ts`（`style-distill-service.ts:136` 注入）
- 指纹库列表（文件级，非 settings）。注：`fingerprintInjectionBudget`(2000) 无本页 UI，消费方 `co-writer-engine.ts:768`

## knowledge（KnowledgeSection · knowledge-section.ts）
- `vectorEnhancedDeconstruction`(true) — `deconstruction-scheduler.ts:562`
- `vectorDeconstructionThreshold`(0.3) — ⚠️ 死配置（仅设置页读写）
- `vectorProviderType`('ollama') / `embeddingFallbackPolicy`('local-only') — `engine-registry.ts:1303-1345`、`provider-factory.ts:58,74`
- `vectorOllama*` / `vectorOpenai*` / `vectorDoubao*` / `vectorQwen*`（按类型显隐）→ 共享 EmbeddingProviderFactory
- 注：`embeddingModel`/`embeddingEndpoint` 无本页 UI 但被 `engine-registry.ts:1316-1317` 消费

## deconstruction（DeconstructionSection · deconstruction-section.ts）
全部写 `settings.deconstructionEngine.*`（默认对照 shared/deconstruction-settings.ts）：
- `defaultQualityLevel`('standard') / `enableAutoUpgrade`(true) / `enabledDimensions`(6+2) / `includeCommercial`(true) / `includeReadability`(true)
- `vectorEnabled`(true) / `vectorModel`('bge-m3'，必须本地) / `vectorCacheSize`(5000) / `vectorBatchSize`(32)
- `llmEnabled`(false，带警示) / `llmModel`(''，必须云端，本地名即时告警) / `makersModelsKey`（顶级字段，加密）
- `includeZhuque`(false) / `zhuqueMaxChars`(20000)
- `maxConcurrency`(2) / `sampleMode`(false) / `textSampleLimit`(100000)
- 消费方 `deconstruction-scheduler`（541/549/743/1954+）——全本拆解决策见 docs/audits/2026-11-28-kb-deconstruction-flow.md §三

## foreshadow（ForeshadowSection · foreshadow-section.ts）
- `maxUnrevealedForeshadow`(20) — `context-manager.ts:245`
- `foreshadowConfig`（类型列表管理）— `foreshadow-deconstructor.ts:1277`

## rules（RulesSection · general-sections.ts）
- `semanticKeywordOverrides.injury/.action/.modern/.location/.drastic`([]) — ⚠️ 死配置（`shared/semantic-keywords.ts:111` resolveSemanticKeywords 零调用方）
- `experimentGroup`('') — `step-runner.ts:882`
- 其余规则版本状态卡（RulesService，文件级）

## appearance（AppearanceSection）
- `language`('auto') — `main.ts:1152`；`theme`('auto') / `themeColors.*` / `themePresets[]` — `core/theme-manager.ts`
- `petEnabled`(true) — `main.ts:2689`；`petImage` — `main.ts:2750-2831`
- `dailyWordTarget`(3000) — `main.ts:2875`；`showWordCountInStatusBar`(true) — :2713

## layout（LayoutSection · writing-sections.ts）
- `panelLayout.autoRestore`(true) / `panelLayout.panels`([]) — `settings-service.ts:428`
- `panelSizes.fwStepNav`(140)/`fwRightPanel`(220) — `engine-registry.ts:1185`
- 恢复默认按钮：清 panelSizes + agentWorkbench 左右宽 + coWriteEditorWidthRatio

## projects（ProjectLibrarySection）
无 settings 字段（规划/迁移/撤销按钮，文件级 `project-migration-service.ts`）。

## performance（PerformanceSection · general-sections.ts）
- `readOnlyMode`(false) — `agent-workbench-view.ts:1270`；`sessionRetentionEnabled`(true) — `main.ts:1532`
- 性能监控开关（内存态，不落 settings）— `performance-monitor.ts:206`

## agent（AgentBackendSection · agent-section.ts）
- `agentWriteApproval`('ask') — `agent-workbench-view.ts:1276`

## mcp（McpSection · mcp-section.ts）
无直接控件；`mcpServers[]` 经 mcp-manager-modal / mcp-server-form-modal 管理 — `agent-workbench-view.ts:1218`

## about（AboutSection · general-sections.ts）
- `autoCheckUpdates`(false) / `updateSource`('github') / `updateGithubRepo` / `updateGithubToken`（加密）/ `updateCustomUrl` / `updateCheckIntervalHours`(168) — `engine-registry.ts:1503-1508`

---

## 设置字段 ↔ 消费模块反查表（grep 读取点）

| 消费模块 | 设置字段（代表读取点） |
|---|---|
| ai-api-client + ai-api-stream | apiEndpoint/apiKey(121,144)、providerKeys、customProviders(328+)、availableModels(168)、enableAutoModelFallback(662)、maxApiRetries(490)、promptCacheEnabled(605)、providerThinking(409)、maxOutput |
| ai-engine | maxContext(444)、maxOutput(105) |
| step-runner | stepGateMode(1222)、contextTokenCap(1142)、contextCompressionMode(263)、settlementStrictWrites(248)、humanVoiceMode(874,1031)、experimentGroup(882)、sceneLoopBodyGeneration(1546)、autoRevisionAfterQC(1791,1842)、thinkingLevel/thinkingBudget/budgetTier/taskBudgets（经 resolveTaskModelConfig）、wordMinRatio/promptSplitRatio（经 thresholds 748,2346） |
| step-modal-controller | refineRounds(485)、humanVoiceMode(76) |
| step-result-saver | structuredChangeLines(341)、naturalParagraphMode(379) |
| step-definitions / step-prompt-assembly | wordMinRatio(143)、promptSplitRatio(291) |
| context-manager | maxContext(244,250)、maxUnrevealedForeshadow(245,251) |
| context/story-context-service | storyContextTier(65) |
| co-writer-engine | coWriteTemperature(311)、coWriteMaxTokens(313,391)、coWriteCandidateBatching(1040)、candidateParallel(1053)、coWriteStructuredConstraints(1001)、coWriteContextDelta(1336)、fingerprintInjectionBudget(768)、referenceBookIds(817) |
| co-writer/co-write-options + local-model-utils | coWriteModelMode(156)、coWriteCloudProvider(276)、coWriteCloudModel(134)、coWriteNumCtx(305)、providerKeys(237)、coWriteModel(101) |
| deconstruction-scheduler | deconstructionEngine.*(541+)、vectorEnhancedDeconstruction(562)、providerKeys(1990)、makersModelsKey |
| engine-registry | vector*/embedding*/embeddingFallbackPolicy(1303-1345)、autoCheckUpdates 等(1503-1508)、panelSizes(1185)、language(1285) |
| embedding/provider-factory | vectorProviderType、vectorOllama*/vectorOpenai*/vectorDoubao*/vectorQwen*、embeddingModel、embeddingEndpoint(58-74) |
| anti-ai-detector | antiAiExtraWords/extraAiHighFreqWords(142，main.ts:1113 注入) |
| style-features-v2 | styleKeywordOverrides（style-distill-service.ts:136 注入） |
| character-recognition-pipeline | characterRecognitionLayers、ruleLayer.*、vectorLayer.*、llmLayer.*（modal 组装） |
| foreshadow-deconstructor | foreshadowConfig（经 ForeshadowConfigManager） |
| quality/four-check-refresh | defaultWordCount(49)、wordMinRatio(102) |
| core/provider-manager | providerAssignments(174-183,534)、providerTaskBudgets(194-198)、enabledProviderIds、availableModels |
| core/theme-manager | theme、themeColors、themePresets(113-119) |
| services/prompt-manager | promptManagerConfig（main.ts:1138 注入） |
| services/canon-research-service | canonResearch(276) |
| ui/co-writing-view + ui/co-writing/* | precisionMode(486,1888)、coWriteLayout(227)、coWriteEditorWidthRatio(228)、coWriteSuggestionPanelVisible(229)、coWriteEditorFont(467)、字号/行高/高亮/专注(1155-1301)、autoGhostAssociation(3141)、defaultWordCount(3233)、referenceBookWeights(3028-3034) |
| ui/full-writer/* | activeBodyTemplate(1151)、humanVoiceMode(1144)、countableHumanHints(1154)、experimentGroup(1156)、structuredChangeLines(676)、bodySceneContextStrict(380,432)、dedupeRulesInStyle(439)、contextHygieneAutoFix(1167)、contextCompressionMode(650)、contextScope(47) |
| ui/continue-chapters-modal / scene-confirm-modal | bodyConfirmMode(420)、naturalParagraphMode(431/205) |
| ui/agent-workbench-view | readOnlyMode(1270)、agentWriteApproval(1276)、mcpServers(1218)、agentWorkbench 左右宽(293-315) |
| main.ts | templateScaffoldOnStartup(3377)、sessionRetentionEnabled(1532)、autoCheckUpdates(3318)、language(1152)、antiAiExtraWords(1113)、referenceBookIds(1106,2641)、infoDebtThreshold(1121)、petEnabled(2689)、showWordCountInStatusBar(2713)、dailyWordTarget(2875) |

## 死配置 / 口径分裂清单（优化候选）

| 项 | 状态 | 建议 |
|---|---|---|
| `suggestions.*` 4 项 | 设了不生效（仅设置页读写） | 接线到建议引擎或从面板摘除 |
| `semanticKeywordOverrides.*` 5 项 | `resolveSemanticKeywords` 零调用方 | 接线进语义检测或摘除 |
| `vectorDeconstructionThreshold` | 仅设置页读写 | 明确语义后接线或摘除 |
| `minWordCount/maxWordCount` vs `wordMinRatio` | 两套字数口径并存（前者仅校验展示） | 面板文案标注「仅校验」，或统一走 ratio |
| `fingerprintInjectionBudget` / `embeddingModel` / `embeddingEndpoint` / `maxApiRetries` / `precisionMode` / `dedupeRulesInStyle` / `candidateParallel` / `promptCacheEnabled` / `infoDebtThreshold` | 有消费无 UI（引擎/视图直接读默认值） | 低优先：按需补 UI 或保持现状 |
