# 代码索引（Code Index）

> 版本：v4.19.0 · 更新：2026-10-26 · 源文件：880 个 .ts（含 352 个 .test.ts）

---

## 总览

| 层级 | 目录 | 文件数 | 核心职责 |
|------|------|--------|----------|
| 入口 | `main.ts` 等根级 | 3 | 插件注册、生命周期、命令绑定 |
| UI 层 | `ui/` | 156 | 视图、Modal、组件、设置面板 |
| Facade 层 | `ui/cowrite/` | 7 | 协同写作 UI 与引擎的中间层 |
| 引擎层 | `engine/` | 217 | 业务逻辑、AI 引擎、质量检测、Repository |
| 服务层 | `services/` | 31 | 跨引擎协调、Worker 管理、外部服务 |
| 核心服务 | `core/` | 6 | 插件级核心服务（加密、设置、主题、Provider） |
| 共享层 | `shared/` | 77 | 工具函数、状态管理、类型定义、文件系统抽象 |
| 测试 | `tests/` | 342 | 单元测试、集成测试、E2E 测试（327 个 `.test.ts`） |

---

## 一、入口层

### main.ts
- `NovelWriterPlugin` — 插件主类，负责生命周期（onload/unload）、命令注册、视图注册、设置面板、EngineRegistry 初始化
- 位置：`main.ts`
- 命令层上下文：`setWorkbenchContext / getWorkbenchContext / getActiveChapterTarget()`（后者委托 `shared/chapter-target.ts`）；`getActiveProject()` 在 activeFile 不属于项目时回退工作台项目，禁止各 Modal 自行读 `getActiveFile()`
- 工作台入口：`openFullWriterHome()` 在复用已打开视图后调用 `FullWriterView#showProjectSelector()`（非项目页切页、已在项目页刷新并提示）；快捷工具与左侧 ribbon 必须走该入口，`openFullWriterView()` 保持静默刷新语义

---

## 二、核心服务层（core/）

> 插件级单例服务，在 EngineRegistry 第 2 阶段初始化

| 文件 | 类/导出 | 职责 |
|------|---------|------|
| `core/index.ts` | — | 统一导出入口 |
| `core/crypto-service.ts` | `CryptoService` | API Key 加解密（AES-GCM）、主密码保护 |
| `core/settings-service.ts` | `SettingsService` | 设置持久化、迁移、数据类封装（加载统一走 `deepMergeSettings`：缺失嵌套字段回落默认、数组整体替换、`undefined` 不覆盖；`schemaVersion` 不符或缺默认顶层键时自动回写） |
| `core/provider-manager.ts` | `ProviderManager` | AI 供应商管理（内置+自定义）、模型能力检测 |
| `core/theme-manager.ts` | `ThemeManager` | 主题切换、CSS 变量管理 |
| `core/command-registry.ts` | `CommandRegistry` | 命令注册与调度（只登记 id 与回调：45 个 Modal/视图命令委托 `CommandUiPort`，10 个无 UI 依赖命令在本类执行；不 import 任何 ui 模块） |

> 命令相关协作模块：`shared/command-ids.ts`（id 常量）、`shared/command-ui-port.ts`（执行端口 + payload 类型）、`ui/command-ui-executor.ts`（Modal / 视图 / 编辑器选区命令的实际执行层）。

---

## 三、引擎层（engine/）

### 3.1 引擎注册中心

| 文件 | 类/导出 | 职责 |
|------|---------|------|
| `engine/engine-registry.ts` | `EngineRegistry` | 中央引擎注册中心，9 阶段初始化，3 种作用域（singleton/project/transient），懒加载，依赖检查，Dispose 生命周期 |
| `engine/internal-registry.ts` | `InternalRegistry` | 内部注册工具函数 |

**ENGINE_NAMES 常量（30+ 引擎）**：`CACHE_MANAGER`, `INTERNAL_REGISTRY`, `CRYPTO_SERVICE`, `SETTINGS_SERVICE`, `THEME_MANAGER`, `PROVIDER_MANAGER`, `COMMAND_REGISTRY`, `FILE_SYSTEM`, `LOGGER`, `PERFORMANCE_MONITOR`, `AI_ENGINE`, `AI_OUTLINE_GENERATOR`, `AI_CHAPTER_HELPERS`, `AI_CHARACTER_GENERATOR`, `AI_ENTITY_GENERATOR`, `AI_SCENE_GENERATOR`, `AI_WORLDVIEW_GENERATOR`, `AI_SCENE_EXPANDER`, `CO_WRITER_ENGINE`, `ANALYSIS_REPORT_ENGINE`, `QUALITY_SCORE_ENGINE`, `DEVIATION_DETECTOR`, `REWRITE_SUGGESTION_ENGINE`, `REALTIME_MONITOR`, `PERFORMANCE_OPTIMIZER`, `QUALITY_HISTORY_STORE`, `SETTLEMENT_ENGINE`, `STYLE_FINGERPRINT_LIBRARY`, `STYLE_VECTOR_STORE`, `KNOWLEDGE_BASE`, `UPDATE_CHECKER` 等

---

### 3.2 Repository 层（数据访问）

> 统一的 Markdown+Frontmatter 数据访问层，基于 IRepository/IBulkRepository 接口

#### 接口与基类
| 文件 | 类/导出 | 职责 |
|------|---------|------|
| `engine/repository/interfaces.ts` | `IRepository<T, TId>`, `IBulkRepository<T>` | Repository 接口定义 |
| `engine/repository/base-markdown-repository.ts` | `BaseMarkdownRepository` | Markdown+Frontmatter 读写基类，内置 LRU 缓存 |
| `engine/repository/lru-cache.ts` | `LruCache` | LRU 内存缓存 |

#### 领域模型（domain/）
| 目录 | 内容 |
|------|------|
| `aggregates/` | 聚合根：`ProjectAggregate`, `ChapterAggregate`, `CharacterAggregate`, `FactionAggregate`, `LocationAggregate`, `ItemAggregate` |
| `value-objects/` | 值对象：`Frontmatter`, `WordCount`, `ChapterStatus`, `EntityStatus` |
| `serializers/` | 序列化器：`FrontmatterSerializer`, `EntityFactory` |
| `validators/` | 验证器：`DomainValidator` |

#### 具体 Repository
| 文件 | 类 | 管理实体 |
|------|-----|----------|
| `engine/repository/project-repository.ts` | `ProjectRepository` | 项目（Project） |
| `engine/repository/chapter-repository.ts` | `ChapterRepository` | 章节（Chapter） |
| `engine/repository/character-repository.ts` | `CharacterRepository` | 角色（Character） |
| `engine/repository/faction-repository.ts` | `FactionRepository` | 势力（Faction） |
| `engine/repository/location-repository.ts` | `LocationRepository` | 地点（Location） |
| `engine/repository/item-repository.ts` | `ItemRepository` | 物品（Item） |

---

### 3.3 AI 引擎组

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/ai-engine.ts` | `AIEngine` | AI 调用封装，流式生成（SSE/模拟流/完整响应三级降级）、重试、超时、模型降级 |
| `engine/ai-api-client.ts` | — | 底层 API 客户端；输出上限先取用户模型覆盖（`plugin.resolveModelLimits`），再回退静态能力表 |
| `engine/ai-prompt-builder.ts` | `buildChapterPrompts` / `buildSystemPrompt` / `buildUserPrompt` | 章节正文 prompt 唯一组装入口：`buildChapterPrompts` 把知识注入作为 user 中的可裁剪层（priority 25），正文主体为必保尾部，并与 `buildSystemPrompt` 分离（禁止 `systemPrompt += knowledge`） |
| `engine/ai-types.ts` | — | AI 相关类型定义 |
| `engine/ai-outline-generator.ts` | `OutlineGenerator` | 全书规划递进式生成：蓝图 → 分卷（长卷分段 + 章节批次受限并发 3）→ 跨卷校验/修复 → 全局章号补全；降级标记以最终内容重新校验 |
| `engine/outline-contract.ts` | — | 全书规划契约层：字段值提取（缩进子项归属字段）、章节表分析/净化（统一表头+分隔行+数据行）、蓝图与单卷结构校验 |
| `engine/cross-volume-outline-validator.ts` | `CrossVolumeOutlineValidator` | 跨卷一致性校验（章节连续、人物、转折点、伏笔、势力、支线）；转折点在预期卷或更早卷出现即满足 |
| `engine/ai-chapter-helpers.ts` | — | 章节生成辅助方法 |
| `engine/ai-character-generator.ts` | `AICharacterGenerator` | AI 角色生成；`completeCharacter` 使用完整输出契约（18 字段 / 3 嵌套组 / 7 分节） |
| `engine/ai-entity-generator.ts` | `AIEntityGenerator` | AI 实体生成 |
| `engine/ai-batch-entity-generator.ts` | `AIBatchEntityGenerator` | AI 批量实体生成 |
| `engine/ai-scene-generator.ts` | `AISceneGenerator` | AI 场景生成 |
| `engine/ai-scene-expander.ts` | `AISceneExpander` | AI 场景扩写 |
| `engine/ai-worldview-generator.ts` | `WorldviewGenerator` / `WorldviewGenerationResult` | AI 世界观生成（工作台路径返回 `{ content, error }`，失败原因可透传 UI） |
| `engine/prompt-builder.ts` | `PromptBuilder` | 通用 Prompt 构建器（续写/联想/改写/句级迭代；四条链路均支持 `budget` 走 `assemblePromptWithinBudget`，末尾任务片段为必保 `tailParts`；四条链路均含 `fanfic` 同人约束 priority 98；续写/迭代的必保前文按 `resolvePrecedingCharLimit` 自适应 800~2000 字；场景知识注入作为 `knowledgeInjection` section priority 70、项目规则与文笔风格作为 `projectStyle` priority 85 参与裁剪，system 只留静态硬规则；知识片段检索的技巧参考只消费 `technique`，原文片段按 2 倍检索后相邻去重；指纹样本按 `enabled` + 强度过滤，强度 0（完全禁用）的指纹连同示例样本一并排除；启用指纹 > `MAX_INJECTED_STYLE_FINGERPRINTS`(3) 时经 `selectFingerprintsForInjection` 用 V2 12 维检索按正文尾部 500 字取 top3，检索范围限定为启用指纹（`fingerprintIds`），检索失败/空结果回退全量，注入与样本过滤同用筛选结果） |
| `engine/prompt-manager.ts` | `PromptManager` | Prompt 模板管理 |
| `engine/prompt-templates.ts` | — | Prompt 模板 |

#### Prompts 目录
| 文件 | 内容 |
|------|------|
| `engine/prompts/body-v2-prompts.ts` | 正文 V2 提示词 |
| `engine/prompts/chapter-pipeline-prompts.ts` | 章节流水线提示词 |
| `engine/prompts/co-write-prompts.ts` | 协同写作提示词 |
| `engine/prompts/deai-prompts.ts` | 反 AI 检测提示词 |
| `engine/prompts/memory-prompts.ts` | 记忆提示词 |
| `engine/prompts/template-utils.ts` | 模板工具函数 |
| `engine/prompts/writing-rules.ts` | 写作规则 |

---

### 3.4 协同写作引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/co-writer-engine.ts` | `CoWriterEngine` | 协同写作主引擎，建议生成、历史管理（`refreshStaticContext` 保留 init 阶段加载的同人约束/长篇记忆/跨卷/人物关系；5 个生成入口经 `syncFanficRules` / `syncFingerprints` 刷新运行时上下文）；`trackEntityStates` 按 `getCoWriteModel()` / `getCoWriteOptions()` 传入实体状态检测，未配置协同模型时回退 `flashModel`；`syncFanficRules` 保存最近一次同人设定并提供 `getFanficRulesWarning()` 供视图提示加载失败；`syncFanficRules(project, focusText?)` 用「本章大纲前 600 字 + 本次已写正文尾部 900 字」构造 focus 传给 `formatFanficRulesForPrompt`，五个生成入口（续写/流式/改写/迭代/联想）各自传入本次文本，人物/势力超上限时按相关度选取；`lastKnowledgeCount` 必须由每个会触发「已注入 N 条」提示的生成入口写入（`generateDirectionalCandidate` / `iterateSuggestion` / `rewriteSuggestion` / `suggestStream`），且必须在 prompt 构建后经 `recordKnowledgeInjection` 按 `countRetainedPromptParts` 取「预算裁剪后实际保留条数」，被裁掉的条数写入 `lastKnowledgeDroppedCount`（`directionKnowledgeCounts` 仍记检索总数，供「未拆解」判定），否则提示会沿用上一条建议的旧数字或谎报注入条数；`getProtagonistName` 只走「人物 frontmatter 身份扫描 → 默认『主角』」两级（Rev 102 起不再读已删除的 `_workbenchState`）；embedding 统一经 `createEmbeddingProvider()` → `EmbeddingProviderFactory.fromSettings`，跟随 `vectorProviderType`（不再硬编码 Ollama） |
| `engine/co-writer/` | — | 协同写作子模块 |
| `engine/co-writer/co-writer-types.ts` | — | 协同写作类型定义 |
| `engine/co-writer/session-state.ts` | — | 会话状态管理 |
| `engine/co-writer/create-session-store.ts` | — | 会话状态创建（Zustand 风格） |

---

### 3.5 质量检测引擎组（quality/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/quality/quality-score-engine.ts` | `QualityScoreEngine` | 综合质量评分引擎（注入 `v1Engine` 后总分与六维取自 WQE，并在 `v1Result` 透传原始 WQE 结果，供历史落盘拿完整六维而无需重算；正文不足 `QUALITY_MIN_EVALUABLE_CHARS` 时返回空结果，与 WQE 共用同一门槛；`EvaluationContext` 已删除无写入方的 `previousChapterText`；`ICharacterChecker.check` 只声明 `(chapterText, characterInfos)` 两参，`historyTexts` 已随实现同步删除；`syncV1Context` 在读取缓存前把 `characterNames ?? characterInfos.map(name)` / `chapterOutline` / `mainlineKeywords` 注入 V1 内核（其 `evaluate(text)` 只收文本，不同步则人物维度只能正则估算），上下文签名变化时清空 `dimensionCache` / `fullCache`，三样都缺席时不改内核；C1 起 `v1Engine` 为唯一评分口径：注入后 `rhythmAnalyzer` / `emotionAnalyzer` / `characterChecker` 与 `QSE_CALIBRATION` fallback 均不参与，构造时若收到二者会打一次 warn 点名被忽略项，生产入口不得再注入这些分析器；C2 起 `languageTexture` 由 `languageQuality.details` 的 `vocabRichness` / `rhetoricCount` 派生（`QSE_SUB_WEIGHTS.languageTextureFromV1`），子项缺失时回退原值，避免与 `readability` 同源；C3 起 `changedRange` 语义落地：变更范围含人物名时绕过 `dimensionCache` 重算人物一致性，不含时复用，未传 `changedRange` 保持普通缓存；C4 起 `evaluate` / `evaluateDimension` 经 `enqueueEvaluation` 串行执行，避免 `syncV1Context` 修改共享 V1 内核时被并发调用覆盖上下文，`evaluate` 拆为入队 + `evaluateInternal`） |
| `engine/quality/deviation-detector.ts` | `DeviationDetector` | 偏离检测（6 类：主线/人物OOC/矛盾/伏笔遗忘/节奏/情绪断层）；伏笔遗忘优先按计划回收章分层（逾期 critical、剩余 ≤3 章 warning），无计划章才回退全局阈值；warning 偏离度封顶 59、critical 从 60 起；总偏离分 = 最严重单条 `issue.degree`（类型加权平均恒被该值支配，已删除；「面」由 `listDeviatedTypes` 在 UI 展示「N类异常」），严重度由总分单调推导；V1 人物 OOC 的 `degree` 按 `inc.severity` 设下限（high ≥ critical 阈值、medium ≥ warning 阈值、low 保持 `100 - 角色分`），避免「偏离 15 · 严重」，并把 checker 的「第N段附近」写入 `evidence`（`location` 只放人物名，不再用恒等三元丢弃位置）；`unevaluatedTypes` 标记缺数据源而无法评估的类型（无人物档案/无伏笔/无期望节奏/无大纲），UI 不得把 0 分显示成无问题；人物相关检测按 `/\r?\n+/` 分段并要求同段共现（外貌矛盾不会被同章其他角色误触发）；情绪断层的段落统计同用 `/\r?\n+/`（只按空行切会使整章 1 段、在 `<3 段` 处直接返回，整类永不触发）；设定矛盾按「人物 + 矛盾词」去重（当前章优先，其次最近前文，避免多章窗口把同一问题重复计数；去重集合建在人物维度、跨矛盾组共用，设定同时含两种发色时不会产出同 id 重复项）；缓存键 = 正文哈希 + 上下文指纹（`hashContext`：大纲/人物/前文/伏笔/期望节奏） |
| `engine/quality/rewrite-suggestion-engine.ts` | `RewriteSuggestionEngine` | 改写建议引擎，6 种类型（润色/扩写/缩写/节奏/人物/逻辑），启发式自动检测，AI+规则双模式 |
| `engine/quality/rewrite-types.ts` | — | 改写类型定义 |
| `engine/quality/rewrite-prompts.ts` | — | 改写提示词 |
| `engine/quality/realtime-monitor.ts` | `RealtimeMonitor` | 实时质量监控（协同写作视图「实时质量」开关：评分 + 偏离报告，状态栏可见）；只返回结果、不写历史（历史由调用方经 `appendQualityHistory` 落盘）；`busy:` 并发守卫；外部 `AbortSignal` 监听由 `detachExternalAbort()` 在 `cleanup`/`reset`/`dispose` 成对摘除；不提供空分数兜底（部分失败由调用方跳过落盘）；`failures` 在任何失败时返回（含两项全失败），供 UI 区分「未评估」与「评估失败」 |
| `engine/quality/performance-optimizer.ts` | `PerformanceOptimizer` | 性能优化器 |
| `engine/quality/quality-worker.ts` | — | 质量检测 Worker（C1 起 QSE 只注入 `v1Engine`，不再注入 `characterChecker`；人物逐条比对由 `DeviationDetector` 的 `PlotDivergenceEngine` + `CharacterConsistencyChecker` 负责，`rhythmAnalyzer` 依赖主线程 AI 能力三处都不注入） |

---

### 3.6 风格引擎组（style/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/style/style-deconstructor-v2.ts` | `StyleDeconstructorV2` | 风格拆解 V2（多维度指纹提取） |
| `engine/style/style-dimensions-v2.ts` | — | 风格维度定义 V2 |
| `engine/style/style-vector-store-v2.ts` | `StyleVectorStoreV2` | 风格向量存储 V2（12 维；记录 modelId/dimensionCount，换 embedding 模型自动隔离并报告重建） |
| `engine/style/fingerprint-blender-v2.ts` | `FingerprintBlenderV2` | 指纹融合器 V2 |
| `engine/style/fingerprint-migrator.ts` | `FingerprintMigrator` | 指纹迁移（V1→V2） |
| `engine/style/v2-quantitative-extractor.ts` | `calculateRhythmStats` / `calculatePerspectiveStats` | V2 定量拆解（节奏/视角纯统计） |
| `engine/style/style-intensity-engine.ts` | `StyleIntensityEngine` | 风格强度引擎 |
| `engine/style/fingerprint-selection.ts` | `selectFingerprintsForInjection` | 指纹注入选择器唯一口径（上限 3；协同 `all` / 11 步 `firstN` 回退 + 降级回调），协同与 11 步共用 |
| `engine/style/dynamic-injection-engine.ts` | `DynamicInjectionEngine` | 动态注入引擎（TieredInjectionBuilder 按指纹强度截断描述/示例；DynamicSampleSelector 的 2 条上限只对带 fingerprintId 的样本生效） |
| `engine/style/style-worker.ts` | — | 风格计算 Worker |

---

### 3.7 拆解引擎组（deconstructors/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/deconstructors/structure-deconstructor.ts` | `StructureDeconstructor` | 结构拆解（起承转合 QCCH / 节奏单元 卷·章·节 / 三线结构 主·副·感情线 / 结构类型判定 / 叙事时序 Genette 框架 时序·时长·频率 / 多结构模板匹配 三幕式·英雄之旅·起承转合·救猫咪·网文公式 / 向量增强三线与 QCCH / Markdown 报告） |
| `engine/deconstructors/character-deconstructor.ts` | `CharacterDeconstructor` | 角色拆解（人物识别 / 关系网络 / 角色弧 / 重要度 / 时间线 / 角色网络中心性：度·接近·介数·PageRank·社区·密度·平均路径 / 角色声音指纹：TTR·语气词·句式·性格标记·独特表达·区分度） |
| `engine/deconstructors/foreshadow-deconstructor.ts` | `ForeshadowDeconstructor` | 伏笔拆解（贯穿性名词识别 / 伏笔类型分类 物品·功法·人物·设定·事件 / 重要度评估 / 回收检测 / 伏笔配对 one-to-one·one-to-many·many-to-one / 回收质量 完整度·时机·方式·情感·铺垫 / 伏笔网络 主线·支线·层级·链·交汇·密度·节奏 / 未回收追踪·遗忘检测·回收建议 / **世界观设定提取 10 类** 地理·历史·政治·经济·文化·宗教·魔法体系·种族·科技·组织·覆盖度·关联 / **设定植入密度分析** 每章密度·新设定·重复设定·过载判定·趋势·分布合理性 / 向量增强 / Markdown 报告） |
| `engine/deconstructors/rhythm-deconstructor.ts` | `RhythmDeconstructor` | 节奏拆解（情绪曲线 / 剧情阶段 / 结构匹配 / 爽点 / 章末钩子 / 张力曲线 / 情感弧原型 / NRC 8 情绪 / 节奏曲线） |
| `engine/deconstructors/style-deconstructor.ts` | `StyleDeconstructor` | 风格拆解 V1（句式节奏 / 用词偏好 / 叙事 / 修辞 / 对话 / 段落 / 整体文风 / 词汇丰富度 TTR·MTLD·Yule's K / 五感分析） |
| `engine/deconstructors/technique-deconstructor.ts` | — | 技法拆解 |
| `engine/deconstructors/deconstruction-worker.ts` | — | 拆解 Worker |
| `engine/quality-scorer.ts` | `QualityScorer` | 拆解质量评分器（三维评分 完整性40%·一致性30%·置信度30% / 等级划分 high≥80·medium 50-80·low<50 / 9 条跨维度交叉验证规则 爽点vs情绪·钩子vs张力·对话vs Show·TTR vs AI痕迹·金手指vs评分·角色数vs密度·设定vs世界观·结构vs节奏·情感vs张力 / shouldUpgrade 自动升级建议 / suggestLevel 档位建议 / 由 `DeconstructionScheduler` 在每个维度拆解后调用） |

---

### 3.8 知识库与向量存储

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/knowledge-base-config.ts` | — | 知识库配置 |
| `engine/knowledge-injector.ts` | `KnowledgeInjector` | 知识注入器（分层注入：`injectForSceneBodyLayers` 必须层进 system、按需层进 user 并按预算裁剪；`maxInputTokens` 时复用 prompt-budget；技巧注入按 `category` 去重、最多 5 类且只取 `technique`；设定段统一检索 `structure`；原文注入相邻去重；文风段 `style` / `original` 分维度检索并按配额合并；指纹风格段以指纹库启用状态为唯一真相源并按强度 0 过滤，经 `fingerprint-selection` 限 3 个、特征每字段 200 字） |
| `engine/knowledge-tags.ts` | — | 知识标签系统 |
| `engine/knowledge-to-fingerprint-converter.ts` | — | 知识到指纹转换器 |
| `engine/knowledge-vector-store.ts` | `KnowledgeVectorStore` | 知识向量存储（支持 `original` 原文分块维度、`replaceBookSamples` 幂等替换；`STATE_LOCK` 让加载与所有写操作共用一把 `withWriteLock` 全局串行队列（并发 add 不丢更新、不同书互不覆盖）；`reloadIfChanged` 按向量文件签名感知其他实例的新书/重拆/删书；`loadIndex` 按 `bookId` 判孤儿——构造第 4 参 `{ isBookAlive(bookId) }`（生产入口为 `KnowledgeBaseManager#hasBook`）返回 `false` 时跳过该向量，`bookName` 只做展示；未提供回调时才回退「`knowledge-base/{bookName}` 目录不存在即跳过」的旧判定；向量文件记录 `modelId`/`dimensionCount`，换 embedding 模型后 `loadIndex`/`rebuildIndex` 跳过旧模型向量（不删文件，`getModelMismatches()` 可查），`search` 跳过维度不一致的样本而不是抛错，结果经 `filterRetrievalResults` 去掉低相关尾部后再 `slice(0, topN)`） |
| `engine/local-vector-store.ts` | `LocalVectorStore` | 本地向量存储（`search` 结果回填 `fingerprintId`，并经 `filterRetrievalResults` 去掉低相关尾部后再 `slice(0, topN)`；按「路径+mtime+size」签名感知其他实例的新增/重建/删除，不依赖一次性 loaded 缓存；向量文件记录 `modelId`，换 embedding 模型后跳过旧模型指纹（`getModelMismatches()` 可查），`search` 跳过维度不一致样本而不是抛错） |
| `engine/webnovel-knowledge-base.ts` | — | 网文知识库 |
| `engine/vector-enhancer.ts` | — | 向量增强 |
| `engine/embedding/` | — | Embedding 供应商适配层 |

#### Embedding 子模块
| 文件 | 类 |
|------|-----|
| `engine/embedding/embedding-provider.ts` | `EmbeddingProvider` 基类 |
| `engine/embedding/embedding-fingerprint.ts` | `computeEmbeddingFingerprint` / `detectEmbeddingMismatch` | embedding 指纹唯一口径（`provider:model@baseUrlHash`）+ 模型/维度双校验；知识库与指纹 V1/V2 共用 |
| `engine/embedding/provider-factory.ts` | `ProviderFactory`（`fromSettings` 统一按插件设置构造 provider，缺省值与 provider 默认值集中在工厂；`createWithFallback` 仅启动期探测） |
| `engine/embedding/openai-provider.ts` | `OpenAIEmbeddingProvider` |
| `engine/embedding/doubao-provider.ts` | `DoubaoEmbeddingProvider` |
| `engine/embedding/ollama-provider.ts` | `OllamaEmbeddingProvider` |
| `engine/embedding/qwen-provider.ts` | `QwenEmbeddingProvider` |

---

### 3.9 剧情与情节引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/plot-completion-engine.ts` | `PlotCompletionEngine` | 情节完成度引擎（正文 < `PLOT_COMPLETION_MIN_EVALUABLE_CHARS`=50 字返回六维全 0 空结果，调用方须按「无法评估」处理） |
| `engine/plot-divergence-engine.ts` | `PlotDivergenceEngine` | 情节偏离检测（正文 < `DEVIATION_MIN_EVALUABLE_CHARS`=100 字返回 0% / normal 空结果，不可当作「无偏离」展示）；「持续上升」告警由 `shared/divergence-trend.ts#isRisingDivergence` 判定，除涨幅外还要求最近 3 次评估跨越 `DIVERGENCE_RISING_MIN_WINDOW_MS`（2 分钟），`divergenceHistory` 与 `divergenceHistoryAt` 同步维护 |
| `engine/plot-redundancy-checker.ts` | `PlotRedundancyChecker` | 情节冗余检查 |
| `engine/outline-to-text-expander.ts` | — | 大纲转正文扩写 |
| `engine/scene-expander.ts` | `SceneExpander` | 场景扩写器；`SCENE_HEADING_SOURCE` / `parseSceneHeadings` / `splitSceneSections` 是场景标题解析唯一入口（兼容 `##`~`######`、`场景N`/`sceneN`）；`SCENE_EXPAND_SYSTEM_PROMPT` / `SCENE_EXPAND_USER_TEMPLATE` 是**实际生成模板**（`soul-driven-prompts.ts` 的同名模板只服务 UI 路由），消费 `infoPlan` / `prevChapEnding` / `timelineEvents` / `emotionPlan` / `triggeredMemories`，system 含「第一场景承接上一章结尾、时间不得倒退、换场必须有过渡、只演出已确定事件」四条硬约束；预算裁剪走 `sectionAware` |
| `engine/chapter-brief.ts` | — | 章节写作简报：把 信息规划/情节蒸馏/大纲摘要/情绪规划/Scene展开 收敛为 `ChapterBrief`（纯函数）；`buildBriefPromptParts` 注入当前场景 8 要素，`formatEntityBrief` 做中文字段映射 |

---

### 3.10 角色与关系引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/character-soul.ts` | `CharacterSoul` | 角色灵魂模型（9 字段 `hasSoul` 才可注入）；`formatSoulForPrompt` 转 prompt 文本，`buildCharacterSoulSummary(souls, protagonistName, { relevantNames, maxSouls })` 按本章相关角色过滤、默认上限 8 人、主角必留，`hasSoulData` 基于过滤后的集合（`context-loader-controller` 的自动提取与 `template-vars-builder` 共用，禁止再用不存在的 `personality/background` 字段） |
| `engine/character-consistency-checker.ts` | — | 角色一致性检查（`check(chapterText, characterInfos)` 只做当前章 vs 人物档案；分段按 `/\r?\n+/`、与 `DeviationDetector` 同口径；外貌矛盾按「人物 + 矛盾词」跨矛盾组去重；性格/行为检测经 `resolveConfiguredTraits` 同时接受标签与关键词（「冷静」按「沉稳」处理）；跨章设定一致性由 `deviation-detector` 的 `detectSettingContradictions` 负责） |
| `engine/character-context.ts` | — | 人物 frontmatter → 检测上下文统一映射 `toCharacterContextInfos`（协同主视图 OOC/设定矛盾与浮窗逻辑检查共用；字段回退 `name`→`姓名`→`fileName`，非字符串降级空串） |
| `engine/foreshadow-context.ts` | `toForeshadowTrackings` / `extractForeshadowKeywords` / `parsePlannedRevealChapter` / `applyPlannedRevealChapters` | 伏笔追踪（`04-项目总控/伏笔追踪.md`）→ 偏离检测上下文映射（跳过已回收/低重要度/无章号；关键词取 4–16 字片段，宁漏勿误）；并从伏笔库「回收章节」补齐 `expectedRecoverChapterNum`（规范化名称最长匹配、已有值不覆盖），供告警按计划分层 |
| `engine/relationship-engine.ts` | `RelationshipEngine` | 关系引擎 |
| `engine/entity-context-engine.ts` | `EntityContextEngine` | 实体上下文引擎 |
| `engine/entity-scorer.ts` | `EntityScorer` | 实体评分器；`scoreAndFilterEntities` 是共享 topN 旧口径，`scoreAndFilterEntitiesByType(entities, contextText, budgets)` 按类型分配名额（`DEFAULT_ENTITY_TYPE_BUDGETS`：人物 12 / 势力 6 / 地点 6 / 物品 6），避免人物被势力/地点挤掉；`template-vars-builder` 另强制并入「角色定位含主角」的角色 |
| `engine/entity-state-manager.ts` | `EntityStateManager` | 实体状态管理；`detectStateChanges` 支持 `options.model` / `options.callOptions` 覆盖，由调用方决定模型（协同写作传 `getCoWriteModel()`，未传时回退 `flashModel`） |

---

### 3.11 情绪引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/emotion-planner.ts` | `EmotionPlanner` | 情绪规划器 |
| `engine/emotion-curve-analyzer.ts` | `EmotionCurveAnalyzer` | 情绪曲线分析；统一按本地关键词词典分类（`joy/sadness/anger/fear/surprise/neutral`，无 AI 依赖，构造无参）；片段按内容哈希缓存，正文尾部增长只重算变化片段 |
| `engine/emotion-auditor.ts` | — | 情绪审计 |

---

### 3.12 上下文管理

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/context-manager.ts` | `ContextManager` | 上下文管理器（同人时间线/OOC 规则按 `.project` 记录的完整路径定位，`resolveFanficSettingsFile` 兼容旧数据只写文件名；面板与 prompt 同口径丢弃占位）。Rev 186：`buildStoryLinkage` 组装本章关联索引（伏笔库 + 时间线看板 + 设定库/世界观标题 + 实体名 + 合并分卷大纲，异常返回 null），`writeStoryLinkageIndex` 回写两文件标记块；`parseTimelineContent` 同时兼容 7 列富表与 4 列简表（时间/对应章节/事件/影响），并在解析前剥离 NW-LINKAGE 自动块防止自我污染 |
| `engine/chapter-context-builder.ts` | — | 章节上下文构建 |
| `engine/context-compressor.ts` | `ContextCompressor` | 上下文压缩器；世界观/设定库字符上限随模型窗口缩放（世界观 `max(2000, min(12000, 12% 窗口))`、设定库 `max(1000, min(6000, 6% 窗口))`），小窗口保持旧下限，128K 窗口不再被固定 1000 字砍半 |
| `engine/context/context-diff-detector.ts` | — | 上下文差异检测 |
| `engine/context/incremental-updater.ts` | — | 增量更新器 |
| `engine/story-linkage.ts` | `buildStoryLinkage` 等 | 关联索引引擎（Rev 186）：`parsePlannedRange` 把「计划回收」解析成章号区间（支持 `第6章` / `第6-8章` / `第6章前后` / 待定），`classifyForeshadow` 输出 due/overdue/upcoming/later/unknown；按伏笔名与时间线事件去重、与设定条目（设定库/世界观标题 + 人物/地点/势力/物品名）互链、裁剪分卷大纲本章段落，产出 `due/overdue/upcoming/timeline/timelineAll/settingHits/planningRefs/warnings` 与 ≤1800 字 `promptText`。通用标题（如「与主线关联」）不计入关联命中 |
| `engine/story-linkage-writer.ts` | `upsertLinkageBlock` 等 | 关联索引回写（Rev 186）：只替换 `<!-- NW-LINKAGE:BEGIN -->…<!-- NW-LINKAGE:END -->` 标记块，无标记则追加；`buildForeshadowIndexBlock` / `buildTimelineIndexBlock` 生成到期/逾期/即将到期与去重时间线表格；重复回写字节级一致 |

---

### 3.13 步骤流水线引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/step-runner.ts` | `StepRunner` | 步骤执行器（11 步 prompt 统一经 `step-prompt-assembly` 做窗口闸门：知识注入作为增强尾部，超预算先丢注入再头尾截断主体；窗口/输出按本步实际模型经 `clampBudgetToModelLimits` 收窄，不直接用全局设置；`finishReason === 'aborted'` 或 signal 已取消时直接返回、不落盘）。重试原语、合并规划、特例步骤、结算链路、批量顺序执行与 prompt 装配均已外迁，本类保留同名委托方法 |
| `engine/step-runner-retry.ts` | — | `callAIWithRetry`（业务级 2 次尝试 + abort 不重试）、`callAIStreamWithRetry`（length 截断自动续写 ≤3 次）、`warnIfTruncated`；host 仅注入 `aiEngine` 与进度/通知回调 |
| `engine/step-specials.ts` | — | 特例步骤：`characterSoul` / `emotionPlan` / `sceneExpand` 的独立编排（不经过通用 callAI）；宿主注入引擎、回调、保存、本步预算与知识注入 |
| `engine/step-settlement.ts` | — | 章节结算链路：报告磁盘回退、强制揭示解析、结算汇总、叙事总览刷新与上下文面板通知；文件读写由宿主注入 |
| `engine/step-sequential.ts` | — | 批量顺序执行：跳过已完成/未知步骤、按传入顺序执行、失败即中断、结束后恢复索引；输入元素由宿主注入（engine 不直接调用 document） |
| `engine/step-prompt-assembly.ts` | — | 通用步骤 prompt 装配：`assembleStepPrompt` 负责知识注入（outline → `loadOutlineKnowledge`、bodyGeneration → `loadBodyKnowledge` 文笔指纹）作为可丢弃尾部、按本步实际模型取窗口预算、头尾截断与降级日志；不引用 engine-registry |
| `engine/planning-combined.ts` | — | 合并规划纯函数：5 模块 prompt 模板 + 变量填充（`buildCombinedPlanningPrompts`）、分隔符解析（`parseCombinedPlanning`）与完整性判定（`evaluateCombinedPlanning`：本次有效产出 / 仍缺失 / 是否满足 infoPlan + outline 最低条件，`COMBINED_PLANNING_MIN_MODULE_CHARS`=50；Rev 185 起支持可选 `isValid` 谓词，调用方传 `validateStepResult(...).level==='complete'` 把「字符数够但结构残缺」的模块排除出 generated） |
| `engine/step-definitions.ts` | — | 步骤定义与迁移映射；`BODY_CHANGE_INVALIDATED_STEPS` 为正文改写后的下游失效唯一口径 |
| `engine/step-result-saver.ts` | `StepResultSaver` | 步骤结果保存；落盘前跑 `validateStepResult`，只有 complete 写 `step_status=generated`，否则 `partial` |
| `engine/step-modal-controller.ts` | — | 步骤弹窗控制；消痕/精修/逐轮选择接受后经 `invalidateAfterBodyChange` 走统一失效传播 |
| `engine/step-validator.ts` | `StepValidator` | 步骤验证器（`normalizeStepMarkup` 先规范化粗体/独占标签，再做分节校验；四级状态 empty/skeleton/partial/complete）；规范化只在「短标签（≤20 字、无句读、命中结构标签白名单）」时升为 `##`，已有标题先剥离 `一、/1./第二节` 编号；`extractSectionAfterHeading` 只被同级或更高级标题截断（`^#{1,headingLevel}`），不得被 `###` 子节提前终止；`isStepResultComplete` = 非模板骨架 + 结构校验通过，供断点续跑/恢复使用。Rev 185：`stripPlaceholderLines` 剔除空标签/空表格行/枚举提示/方括号模板说明后再判内容长度，`isTemplateSkeleton` 复用清洗（去掉 Markdown 标题后不足 30 字即骨架），修复无 `${}` 占位符的模板（情节蒸馏、大纲摘要）被误判 complete；`validateCharacterSoul` 按 `【角色名】` 块解析，字段值需非占位且去标点 ≥4 字，兼容紧凑 `欲>/惧>/底>` 格式 |
| `engine/context-readiness.ts` | `assessContextReadiness` | 上下文输入清单与完整性判定（Rev 185）：输出 17 项（人物/大纲/世界观或设定库/前章摘要/角色灵魂/地点/势力/物品/伏笔/时间线/文笔/写作规则/情绪规划/Scene/触发记忆/压缩/失败模块）的条数与字数；必做项 = 人物、大纲、世界观或设定库、非首章的前章摘要，缺失时 `ready=false` 并点名。Rev 186：新增第 18 项「关联索引（伏笔/时间线↔设定/规划）」（可选，详情显示到期/逾期/设定/规划计数与数据提示数，未建立时提示可在看板生成） |
| `engine/planning-step-advance.ts` | — | `calcStepIndexAfterPlanning`：规划阶段结束后的目标步骤（全部完成→正文 index 7，否则第一个缺失规划步骤）；`downstreamStepsAfterPlanningChange`：规划变更后正文与下游失效（正文未生成时返回空） |
| `engine/long-term-memory.ts` | `loadLongTermMemory` / `loadVolumeSummaries` / `formatConfirmedFacts` | 长篇记忆层：事实索引中**已确认**的人物/世界观/剧情事实（pending 不进入 prompt，按类分组/限条数/限字数）+ 前序卷大纲经 `VolumeOutlineSummarizer` 提取压缩的前情提要；协同与正文 V1/V2 共用 |
| `engine/step-runner-callbacks.ts` | — | 步骤回调 |

---

### 3.14 结算引擎（settlement/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/settlement-engine.ts` | `SettlementEngine` | 结算引擎 |
| `engine/settlement/report-parser.ts` | — | 结算报告解析 |
| `engine/settlement/markdown-table-utils.ts` | — | Markdown 表格工具 |
| `engine/settlement/settlement-types.ts` | — | 结算类型定义 |
| `engine/settlement/settle-context.ts` | — | 结算上下文 |

---

### 3.15 其他引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/analysis-report-engine.ts` | `AnalysisReportEngine` | 分析报告引擎（`checkCharacterConsistency` 只接收正文与人物信息，不再有 `historyTexts`） |
| `engine/anti-ai-detector.ts` | `AntiAIDetector` | 反 AI 检测 |
| `engine/coherence-checker.ts` | — | 连贯性检查 |
| `engine/content-safety-checker.ts` | `ContentSafetyChecker` | 内容安全检查 |
| `engine/cross-volume-integration.ts` | — | 跨卷整合 |
| `engine/ending-traction-engine.ts` | — | 结尾牵引力引擎 |
| `engine/fingerprint-extractor.ts` | — | 指纹提取器 |
| `engine/logic-consistency-checker.ts` | `LogicConsistencyChecker` | 逻辑一致性检查 |
| `engine/memory-trigger.ts` | — | 记忆触发器 |
| `engine/novel-analyzer.ts` | `NovelAnalyzer` | 小说分析器 |
| `engine/preference-memory.ts` | — | 偏好记忆 |
| `engine/rhythm-analyzer.ts` | `RhythmAnalyzer` | 节奏分析（段落类型/语速/信息密度/紧张度，全部本地规则；紧张度按关键词命中数估算，无 AI 依赖，构造无参） |
| `engine/review-agent.ts` | — | 评审代理 |
| `engine/sentence-diversity-engine.ts` | `SentenceDiversityEngine` | 句式多样性引擎 |
| `engine/style-fingerprint-library.ts` | `StyleFingerprintLibrary` | 风格指纹库（V2 12 维加载保留；`searchSimilarStylesV2` / `searchByDimensionV2` / 模型隔离报告；`searchSimilarStylesV2` 支持 `fingerprintIds` 把排名限定在指定集合内，避免禁用/模板指纹占满 topN；项目强度配置 `loadIntensityConfigs` 每次读盘、`set/removeIntensityConfig` 先读盘再写；`reloadIfChanged` 按指纹文件签名感知其他实例的新增/删除/启停） |
| `engine/style-learner.ts` | — | 风格学习器 |
| `engine/style-similarity-scorer.ts` | `StyleSimilarityScorer` | 风格相似度评分 |
| `engine/style-vector-store.ts` | — | 风格向量存储（旧版） |
| `engine/writing-profile.ts` | `WritingProfileManager` | 写作画像（`.project` frontmatter 的读写与归一化）。`FingerprintConfig` 只保留 `templateInherited` / `injectionStrength`：指纹启用状态唯一真相源是指纹库，旧画像里的 `enabledProject` / `enabledGlobal` 在 `normalizeFingerprint` 中被忽略且不再写回 |
| `engine/writing-quality-engine.ts` | `WritingQualityEngine` | 写作质量引擎 |
| `engine/chapter-utils.ts` | — | 章节工具函数。`listChapterNumbers`（Rev 184）以「步骤结果目录 ∪ 正文文件」并集推导已建骨架章节，供三个旧版章节生成工具确定章范围 |
| `engine/export/manuscript-compiler.ts` | `compileManuscript` 等纯函数 | 成稿编译（Markdown / TXT / HTML，含排序与打印样式） |

---

### 3.16 缓存系统（cache/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/cache/multi-layer-cache.ts` | `MultiLayerCache` | 多层缓存（L1 内存 + L2 文件） |
| `engine/cache/file-cache.ts` | `FileCache` | 文件缓存（带 TTL、损坏恢复） |
| `engine/cache/preload-manager.ts` | `PreloadManager` | 预加载管理器 |

---

### 3.17 流式生成（streaming/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/streaming/simulated-stream.ts` | — | 模拟流式生成（按字/按句输出） |
| `engine/streaming/stream-parser.ts` | — | SSE 流解析器 |

---

> 性能监控统一由服务层 `services/performance-monitor.ts` 提供，引擎层不再保留重复实现。

---

## 四、服务层（services/）

> 跨引擎协调、外部服务集成、Worker 管理

| 文件 | 类 | 职责 |
|------|-----|------|
| `services/index.ts` | — | 统一导出 |
| `services/worker-manager.ts` | `WorkerManager` | 通用 Worker 管理器（池化、队列、进度、降级） |
| `services/deconstruction-worker-manager.ts` | — | 拆解任务专用 Worker 管理器 |
| `services/deconstruction-scheduler.ts` | `DeconstructionScheduler` | 拆解任务调度器（v8.0 起导出 `DeconstructionEngineSettings`/`DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS`/`ALL_BREAKDOWN_DIMENSIONS`/`DIMENSION_LABELS`，`addTask` 保留全文，维度拆解超阈值时接入全文分块编排；`vectorizeBook` 同时写入原文分块与 6 个报告维度；`revectorizeBook` 为公开的重算入口，只重算向量、不重新拆解，向量存储缺失时抛错；`addTask` 对同书 `pending/running/paused` 任务直接返回既有 id，`cancelByBook` 供删除入口取消在途任务；`vectorizeBook` / `saveSegmentedDimensionResult` / `appendBreakdownLog` 写盘前二次校验书仍存在；A5 起导出 `buildBreakdownFinishNotice`，向量化结果经 `recordVectorOutcome` 写回 `task.vectorStatus/vectorError` 与 `KnowledgeBaseManager.setVectorStatus`，失败发 `vector` 降级事件，完成 Notice 不再无条件报「拆解完成」） |
| `services/scheduler-segment-integration.ts` | `SchedulerSegmentIntegration` | 调度器分块集成层：复用 `TextSegmenter` 的章节优先/段落与字数兜底分块，逐块调用 `DeconstructionWorkerManager`，通过 `IncrementalResultAggregator` 聚合结果，并保留可选 LLM 增强接入点 |
| `services/heavy-task-worker-manager.ts` | — | 重任务 Worker 管理器（主线程分支的 QSE 只注入 `v1Engine`，C1 起不再注入 `characterChecker` 并删除 `checkQualityEngineInjection`；`checkDeviationDetectorInjection` 保留，检查 `DeviationDetector` 的 `plotDivergenceEngine` / `characterChecker` / `rhythmAnalyzer`） |
| `services/worker-protocol.ts` | — | Worker 通信协议 |
| `services/worker-runtime.ts` | — | Worker 运行时 |
| `services/template-service.ts` | `TemplateService` | 模板服务（系统模板+自定义模板） |
| `services/example-project-service.ts` | `importExampleProject` | 最小示例项目导入（1 卷 3 章 + 人物 + 伏笔，静态内容） |
| `services/prompt-manager.ts` | `PromptManager` | Prompt 管理服务 |
| `services/prompt-templates-default.ts` | — | 默认 Prompt 模板 |
| `services/prompt-manager-types.ts` | — | Prompt 管理类型 |
| `services/settlement-service.ts` | — | 结算服务 |
| `services/knowledge-base-manager.ts` | `KnowledgeBaseManager` | 知识库管理服务（`deleteBook` 同步清理向量文件与 `index.json` 条目；`updateBook` 改名在 `fs.rename` 后调 `renameVectorArtifacts(bookId, newName)` 重写 `${bookId}.json` 与 `index.json` 的 `bookName`（含 `samples[].bookName`），缺失/损坏只 warn；`hasBook(bookId)` 供 `KnowledgeVectorStore.isBookAlive` 判存活；A5 起 `BookBasicInfo` 增加 `vectorStatus`/`vectorError`，由 `setVectorStatus` 独立落盘，拆解状态仍为 `completed`） |
| `services/knowledge-original-chunker.ts` | `chunkOriginalText` | 书籍原文分块（按段落拼装、超长硬切、超量均匀采样） |
| `services/vector-rebuild-service.ts` | `rebuildAllVectors` | 批量重向量化编排（依赖注入、串行执行；只重算已有样本的向量，不调用 AI；单条失败不中断，返回成功/跳过/失败报告） |
| `services/worldview-cache-service.ts` | — | 世界观缓存服务 |
| `services/chapter-recognizer.ts` | — | 章节识别服务 |
| `services/chapter-version-service.ts` | `ChapterVersionService` | 章节版本管理 |
| `services/batch-import-manager.ts` | — | 批量导入管理器 |
| `services/foreshadow-manager.ts` | — | 伏笔管理器 |
| `services/genre-classifier.ts` | `GenreClassifier` | 题材分类器 |
| `services/genre-preference-memory.ts` | — | 题材偏好记忆 |
| `services/rules-service.ts` | — | 规则服务 |
| `services/update-checker.ts` | `UpdateChecker` | 更新检查器 |
| `services/performance-monitor.ts` | `PerformanceMonitor` / `performanceMonitor` | 唯一性能监控实现（分层埋点、慢操作、报告；`measure()` 不泄漏 activeMark） |
| `services/local-model-probe.ts` | `probeOllamaModelCapability` / `ensureLocalModelCapability` | 本地 Ollama 能力探测（`/api/show` → `context_length`），结果注册到能力表；失败冷却 5 分钟 |
| `services/quality-history-store.ts` | `loadQualityHistory` / `appendQualityHistory` / `writeQualityHistory` | 质量历史落盘（`项目/04-项目总控/质量历史.json`，与 data.json 解耦）；追加按项目队列串行化，避免两条写入口并发读-改-写互相覆盖；`trend` 在追加时统一由 `computeChapterTrend` 按前序章重算，调用方传入的章内趋势会被覆盖；落盘前经 `aggregateQualityHistoryByChapter` 收敛为「一章一条、保留最后一次」，避免单章高频落盘（面板 B 每 30s）灌满 200 条配额并挤掉其他章样本 |

---

## 五、共享层（shared/）

> 无状态工具函数、状态管理、类型定义、基础设施抽象

### 状态管理（store/）
| 文件 | 导出 | 职责 |
|------|------|------|
| `shared/store/createStore.ts` | `createStore` | Zustand 风格状态创建 |
| `shared/store/types.ts` | — | 状态类型定义 |
| `shared/store/compose.ts` | `compose` | 中间件组合 |
| `shared/store/shallow.ts` | `shallow` | 浅比较 |
| `shared/store/middleware/logger.ts` | `logger` | 日志中间件 |
| `shared/store/middleware/persist.ts` | `persist` | 持久化中间件 |
| `shared/store/middleware/devtools.ts` | `devtools` | DevTools 中间件 |
| `shared/store/middleware/thunk.ts` | `thunk` | Thunk 中间件 |

### 核心工具
| 文件 | 导出 | 职责 |
|------|------|------|
| `shared/file-system-port.ts` | `FileSystemPort` | 文件系统抽象端口（Obsidian/Mock 双实现）。`ObsidianFileSystem` 对 vault 索引未命中的路径（插件数据目录 `.obsidian/plugins/<id>/data`）回退 `vault.adapter`：`read`/`write`/`exists`/`listFiles`/`listFolders`/`mkdir`/`delete` 均有回退，索引外列表构造只含 `path/name/basename/extension/stat` 的虚拟 `TFile`；vault 内文件仍走 `vault.read/modify/create/createFolder`，保留索引与事件语义 |
| `shared/logger.ts` | `Logger` | 日志工具 |
| `shared/paths.ts` | — | 路径工具函数；全局层目录 `元文件/00-05`，Rev 181 新增 `GLOBAL_RANK_DIR = '元文件/06-榜单分析'` 与 `globalRankFile()` 承接平台级报告（番茄榜单），禁止写 vault 根目录 |
| `shared/chapter-target.ts` | `resolveActiveChapterTarget` | 命令层章节上下文纯函数：优先级「工作台上下文 > activeFile 标准正文 > activeFile 步骤结果目录」，输出 `{project, volume, chapterName, chapterNum, chapDir, bodyPath}`；快捷工具/命令面板的章节级操作统一走此函数 |
| `shared/auto-context-block.ts` | `buildAutoContextBlock` / `stripAutoContext` / `upsertAutoContext` | 正文「自动注入上下文」块的幂等读写：块边界用 `<!-- nw:auto-context:start/end -->` 标记，写入前清理标记块与旧版无标记块；插入位置 marker 后 → 一级标题后 → 末尾 |
| `shared/frontmatter.ts` | — | Frontmatter 解析/序列化 |
| `shared/token-estimator.ts` | `TokenEstimator` | Token 估算器 |
| `shared/diff-utils.ts` | — | Diff 工具 |
| `shared/api-response-utils.ts` | — | API 响应工具（提取内容、剥离 Markdown 代码围栏） |
| `shared/info-debt.ts` | `InfoDebt` | 信息债追踪 |
| `shared/progress-emitter.ts` | `ProgressEmitter` | 进度发射器 |
| `shared/time-estimator.ts` | `TimeEstimator` | 时间估算器 |
| `shared/adaptive-debounce-manager.ts` | — | 自适应防抖管理器 |
| `shared/serialized-writer.ts` | — | 序列化写入器 |
| `shared/yield.ts` | `yieldToUI` | UI 让步工具（setTimeout(0) 让出主线程控制权） |
| `shared/settings-migrator.ts` | — | 设置迁移器 |
| `shared/template-validator.ts` | — | 模板验证器（严格完整性：空值/占位词/空分节均判缺失；含世界观、分卷大纲、设定库、文笔风格、四类实体校验）。同人设定 `validateFanficSettings(content, { requireTimelineData })`：9 字段须实质填写（`isFanficValueFilled` 拒绝「（待补充）」等占位），时间线真实行口径与 `parseFanficTimeline` 一致；`requireTimelineData: false` 供只收集字段的向导表单使用。展示侧 `parseCanonTimelineTable` / `parseFanTimelineTable` 与 prompt 注入共用 `shared/fanfic-rules.ts#parseFanficTimelineRows`（保留空单元格列位，禁止先 `filter(c => c.length > 0)` 再按列名映射，否则中间空列会让后续列整体左移）；`loadFanficRules` 经 `extractFanficRuleValue` 读取并按分号/换行拆条，续行不再丢失；`parseMarkdownTable`（原创纪元时间轴）只去掉首尾竖线、保留中间空单元格。以上展示侧解析同样丢弃整行占位与占位规则 |
| `shared/thresholds.ts` | — | 阈值与校准系数的唯一来源（质量等级 90/80/70/60、色阶 80/60、偏离 60/30、质量可评估 100 / 完成度可评估 50 / 偏离可检测 100 / 实时落盘 300、设定守卫增量 300 与冷却 5 分钟、剧情完成度评估增量 300 / 冷却 2 分钟 / 最小间隔 30 秒、偏离持续上升时间窗 2 分钟、自动联想最小间隔 4 秒、历史上限 200、原文分块 400/40/120、六维权重/子项权重/标定乘数 `WQE_*` / `QSE_*`） |
| `shared/quality-grade.ts` | `gradeFromScore` / `qualityScoreColor` / `divergenceLevelFromScore` | 质量等级、着色、偏离等级的单一实现 |
| `shared/quality-history.ts` | `parseQualityHistoryFile` / `mergeQualityHistory` / `aggregateQualityHistoryByChapter` / `normalizeChapterKey` / `buildQualityChapterKey` / `computeChapterTrend` / `isQualitySampleUsable` / `isSameQualityEvalTarget` / `serializeQualityHistoryFile` | 质量历史序列化、合并与按章聚合（纯函数，容错旧格式；基线/趋势样本单位为「章」，同章取最后一次，章键统一为「第N章」；`computeChapterTrend` 只与前序章比较（排除同章，至少 2 章，差值 5 分），不使用章内评估次数；`buildQualityChapterKey` 为协同两条质量写入口提供同一章键构造；`isQualitySampleUsable` 为两条写入口共用的样本门槛，短文本 0 分空结果不入库；`isSameQualityEvalTarget` 校验异步评估发起/返回时章节身份一致，切章后旧分数不得显示或入库） |
| `shared/protagonist.ts` | `roleIndicatesProtagonist` / `findProtagonistName` | 主角识别（「身份」字符串/数组判定，兼容「主角」「主人公」；从人物 frontmatter 取主角名，`name`→`姓名`→`fileName` 回退） |
| `shared/plot-eval-throttle.ts` | `shouldRunPlotEval` / `buildPlotEvalSignature` | 协同写作剧情完成度 AI 评估的触发门槛（纯函数）：正文签名（章节身份 + 长度 + FNV-1a）未变则跳过；有变化时要求「新增 ≥300 字或距上次 ≥2 分钟」，且两次评估至少间隔 30 秒；换章与 `force`（手动重试 / 生成完成）直接评估 |
| `shared/divergence-trend.ts` | `isRisingDivergence` | 偏离度「持续上升」判定（纯函数）：样本不足 3 条、最近 3 次评估跨度 < `DIVERGENCE_RISING_MIN_WINDOW_MS`（2 分钟）、相邻涨幅 > 5 不足两次时均返回 false；供 `PlotDivergenceEngine` 使用，避免几秒内连续编辑就误报「连续多章」 |
| `shared/preview-scroll.ts` | `captureScrollSnapshot` / `resolveRestoredScrollTop` | 协同预览区滚动锚点（纯函数）：`refreshPreview` 全量重渲染前记录 `scrollTop` 与是否贴底（距底部 32px 内），渲染后贴底恢复到新的最大滚动值、非贴底保持原绝对位置、内容变短时夹紧上限 |
| `shared/ghost-trigger.ts` | `shouldRequestGhostAssociationByInterval` | 协同自动联想（幽灵建议）的最小请求间隔（纯函数）：距上次请求未满 `GHOST_ASSOCIATION_MIN_INTERVAL_MS`（4 秒）时返回 false；`lastRequestAt <= 0` 与间隔 ≤0 时放行 |
| `shared/rhythm-intent.ts` | `parseExpectedRhythm` | 从规划文本解析预期节奏（纯函数、无 AI）：只认显式标注（`节奏：快/中/慢`、`快节奏`、`节奏偏慢`、`慢热`、`中等节奏` 等）；无标注或快慢同时出现返回 `undefined`（不做节奏偏离）；`CoWritingView#buildDeviationContext` 用它填充 `expectedRhythm` |
| `shared/cursor-position.ts` | `resolveCursorPosition` | 编辑器光标位置归一化（纯函数）：`null` / `undefined` / 非有限数按 `fallback`（默认文末、`'start'` 为 0）回退，其余夹紧到 `[0, 正文长度]`；`0` 是合法光标位置，不再被 `selectionStart \|\| value.length` 当成「无光标」回退到文末 |
| `shared/prompt-budget.ts` | `assemblePromptWithinBudget` / `truncateTextToTokens` / `resolvePrecedingCharLimit` / `fitPromptToContext` / `clampBudgetToModelLimits` / `countRetainedPromptParts` | prompt 按 token 预算裁剪：`assemblePromptWithinBudget` 供协同链路按优先级裁剪片段（保留节点/简报/角色状态）；`resolvePrecedingCharLimit` 按输入预算计算「已写内容」字符上限（800~2000，无预算=800）；`fitPromptToContext` 供 11 步流水线把 system+user+知识注入压进模型窗口，超预算时先丢注入再按 `sectionAware` 分段优先级丢段/缩段（低优先段整段丢弃并追加「已省略以下段落」标记，关键段最后才动），最后才头尾截断主体；`clampBudgetToModelLimits` 把全局设置窗口/输出收窄到本步模型真实能力（取小，非法值回退设置）；`countRetainedPromptParts` 统计预算裁剪后仍完整出现在 prompt 里的片段条数（B7 的「已注入 N 条」口径） |
| `shared/ai-credentials.ts` | `hasUsableAiCredentials` | 「能否发起 AI 调用」的唯一判定：有密钥，或端点经 `resolveProviderSourceType` 判定为 local（本地免密钥推理）；供 `plugin.hasAiCredentials` 与所有生成前守卫使用 |
| `shared/quality-baseline.ts` | `computeQualityBaseline` / `compareToBaseline` | 质量基线校准：按项目历史均值/标准差输出「高于/持平/低于基线」及 z 分数（纯函数；总分与各维度的 0 占位都不计入，旧记录不会把均值拉到 0；样本不足的维度不出结论） |
| `shared/fanfic-rules.ts` | `readFanficRules` / `readFanficRulesFromFS` / `parseFanficRules` / `parseFanficCharacters` / `parseFanficFactions` / `parseFanficTimeline` / `parseFanficTimelineRows` / `extractFanficRuleValue` / `formatFanficRulesForPrompt` / `mergeFanficRequirement` / `formatFanficRulesLoadWarning` | 同人约束唯一读取与解析入口（`.project` 同人设定路径 → 核心设定 + 原作主要人物/势力组织 + 两张时间线 + 创作规则约束块）；`extractFanficRuleValue` 是单字段解析唯一口径（正文 `- **字段**：` 多行续行优先，frontmatter `字段: 值` 回退），向导回填与 `parseFanficRules` 共用；`parseFanficEntrySection` 是「多条目小节」唯一实现（人物与势力共用，按名称条目切分、占位「（待补充）」跳过；`parseFanficRules` 的核心字段与三条创作规则同样过滤占位，全占位时输出空串），`formatFanficRulesForPrompt` 各段最多注入 6 条、单字段 60 字（`FANFIC_MAX_INJECTED_CHARACTERS` / `FANFIC_CHARACTER_FIELD_MAX_CHARS`），人物/势力超过 6 条时按 `options.focusText` 中名字出现次数排序选取（同分保持原顺序，无 focus 回退前 6），截断时补「共 N 人/个，以上为与当前章节相关的 6 人/个」说明；`parseFanficTimelineRows` 是时间线表格的唯一行解析（原始单元格二维数组，列位置与文件一一对应、保留空单元格；丢弃表头、`|---|` 分隔行与整行占位），`parseFanficTimeline` 基于它过滤占位后拼「｜」行供 prompt 使用，上下文面板的 `parseCanonTimelineTable` / `parseFanTimelineTable` 复用同一函数（两侧必须同源，禁止先过滤空单元格再按列名映射）；注入上限 8 行 / 单行 120 字（`FANFIC_MAX_INJECTED_TIMELINE_ROWS` / `FANFIC_TIMELINE_ROW_MAX_CHARS`），超出时按进度选窗口：同人时间线取最近 8 行（`selectFanficTimeline`），原作时间线用同人最近 3 条的「对应原作时间」找 canon 锚点后取「锚点前 2 行」起连续 8 行（`selectCanonTimeline`，无锚点回退前 8 行），并补「共 N 行，以上为第 X–Y 行 / 最近 8 行」说明；两段分别输出「【原作剧情时间线】」「【同人时间线】」；`FanficRules.loadError` 区分 `missing-path` / `missing-file` / `read-failed`（FS 版先 `exists`），`formatFanficRulesLoadWarning` 生成用户提示，避免空规则静默：无 `loadError` 时还要判断「是否有可注入内容」（六字段 / 人物 / 势力 / 两张时间线任一非空，作品名与路径不算，口径与 `formatFanficRulesForPrompt` 是否输出约束块一致），只有骨架占位的文件同样提示「没有可用内容」，否则绑定成功却零约束；`mergeFanficRequirement` 统一实体生成 6 处入口的「约束块 + 用户描述」拼接 |
| `shared/fanfic-binding.ts` | `listFanficSettingCandidates` | 「绑定已有同人设定文件」的候选筛选（纯函数）：只收本项目 `05-同人设定库` 与全局 `元文件/05-同人设定库` 下的 `.md`（含子目录），归一化反斜杠与冗余斜杠、去重、排除当前已绑定文件、按展示名排序 |
| `shared/prereq-check.ts` | `describePrerequisiteGaps` | 协同前置规划缺口判定（纯函数）：文件不存在只报名字、读取失败标 `（读取失败）`、去 frontmatter 后正文 < `PREREQ_MIN_BODY_CHARS`（100）标 `（内容过短）`；恰好等于门槛视为通过 |
| `shared/knowledge-position.ts` | `formatKnowledgeChunkLabel` / `dedupeAdjacentChunks` | 知识检索结果 `position` 的唯一展示口径（下标 → `片段#N`，禁止再乘 100 当百分比）；原文分块相邻去重（同书 position 差 ≤1 只留高分块） |
| `shared/retrieval-filter.ts` | `filterRetrievalResults` / `filterRetrievalResultsByScope` | 检索结果相关性过滤唯一口径：先剔除 `score` 非有限值，再按「最高分 × `RETRIEVAL_RELATIVE_MIN_SCORE`(0.85)」与绝对下限 `RETRIEVAL_ABSOLUTE_MIN_SCORE`(0.15) 取大者截断尾部；最高分低于绝对下限返回空，至少保留最高分；多维度合并检索必须用 `perDimension` 按维度各自过滤；两个向量存储的 `search` 必须先过滤再 `slice(0, topN)` |
| `shared/previous-chapter-window.ts` | `selectPreviousChapterFiles` / `buildPreviousChapterWindow` / `stripFrontmatterBlock` | 前文章节上下文窗口（纯函数）：`selectPreviousChapterFiles` 从正文文件列表按章号选最近 `PREVIOUS_CHAPTER_WINDOW_SIZE`(3) 章（跨卷、同章多份取最短路径正稿、排除当前章及更晚）；`buildPreviousChapterWindow` 先 `stripFrontmatterBlock` 再按单章 12000 / 合计 30000 字预算、最近优先裁剪，空正文跳过；供 `CoWritingView#loadPreviousChapterContext` 替代「同卷文件名替换」 |
| `shared/scene-body-merge.ts` | `mergeSceneBodies` | 逐场景确认结果按顺序合并为整章正文（空场景丢弃，场景间空一行） |
| `shared/format-constants.ts` | — | 格式常量（实体字段契约单一事实源，含嵌套组与必填值键） |
| `shared/changelog-data.ts` | — | 更新日志数据 |
| `shared/model-capabilities.ts` | `findModelCapability` / `registerDetectedModelCapability` | 模型能力映射（最长键优先；探测值 > 静态表 > 本地兜底 8192/4096；用户覆盖由 ProviderManager 最优先） |
| `shared/volume-plan.ts` | `parseVolumePlan` / `hasBlockingIssues` / `countPlannedChapters` | 全书规划解析与建章前一致性校验（卷范围 / 表格章号 / 重叠与断档）；分隔行可选，不再漏算每卷首章 |
| `shared/chapter-table.ts` | `parseChapterRow` / `extractChapterTableRows` / `isChapterTableHeaderLine` | 章节分配表解析单一事实源（表头变体、可选分隔行、`**N**`/`第N章` 单元格）；生成端与批量建章共用 |
| `shared/model-source.ts` | `ModelSourceType` / `resolveProviderSourceType` | 模型源类型定义与解析（云端/本地） |
| `shared/plugin-api.ts` | — | 插件 API 类型 |
| `shared/plugin-cache.ts` | — | 插件缓存 |
| `shared/write-lock.ts` | `withWriteLock` / `KNOWLEDGE_VECTOR_STATE_LOCK` | 写入锁（从 `engine/write-lock.ts` 迁出，`engine` 与 `services` 均可合法引用）：`withWriteLock(path, fn)` 以模块级 Map 维护 per-path Promise 串行队列；`BodyWriter.write` 的第一层用它包裹 `writeLocked`，`KnowledgeBaseManager#renameVectorArtifacts` 用 `KNOWLEDGE_VECTOR_STATE_LOCK` 与拆解/向量写入串行 |
| `shared/plugin-capabilities.ts` | — | 插件能力 |
| `shared/template-scaffold.ts` | `ensureTemplateScaffold` | 全新安装的「元文件」模板自举（只补缺失、不覆盖） |
| `shared/template-scaffold-assets.generated.ts` | `TEMPLATE_SCAFFOLD_FILES` | 内置模板资源（自动生成，勿手改） |
| `shared/entity-persistence.ts` | `saveEntities` / `validateEntityContent` / `formatSaveOutcome` | 实体统一落盘最后门禁（四类实体共用：完整性校验不通过一律拒绝、单次上限 200、空名拒绝、同名不覆盖改另存、失败明细） |
| `shared/entity-integrity.ts` | `ensureEntityIntegrity` / `EntityRepairHandler` | 实体完整性闭环（校验 → AI 补全一次 → 复检），所有 UI 保存入口共用 |
| `shared/entity-stats.ts` | `countProjectEntities` / `ProjectEntityStats` | 项目实体数量统计唯一事实源（Rev 192）：世界观文件存在 = 1；人物/势力/地点/物品 = 对应目录下 `.md` 数量；AI 生成器/实体管理/向导完成页共用同一口径 |
| `shared/entity-audit.ts` | `auditEntityFiles` / `readProjectWorldview` / `overwriteEntityIfComplete` | 存量实体审计与原地修复（跳过模板，复检通过才覆写，不产生「名称（2）」副本） |
| `shared/plugin-worker-url.ts` | `resolvePluginWorkerUrl` / `notifyWorkerUnavailable` | 插件目录 Worker 绝对 URL 解析与一次性降级通知 |

### 实体模型
| 文件 | 内容 |
|------|------|
| `shared/entity-models.ts` | 实体模型定义 |
| `shared/entity-registry.ts` | 实体注册表 |
| `shared/entity-field-mappings.ts` | 实体字段映射 |
| `shared/step-frontmatter.ts` | 步骤 Frontmatter 定义 |
| `shared/co-writer-types.ts` | 协同写作类型 |
| `shared/types.ts` | 通用类型 |
| `shared/version-types.ts` | 版本类型 |

---

## 六、UI 层（ui/）

### 共享构造与动作
| 文件 | 内容 |
|------|------|
| `ui/fingerprint-embedding.ts` | `createFingerprintEmbedding(app, scope, settings, project)`：成对返回 `{ provider, vectorStore }`，provider 恒经 `EmbeddingProviderFactory.fromSettings` 构造，供设置页 / mini 设置 / 小说分析 / `RefillModal` 共用，杜绝「UI 写入 Ollama、检索读云端」 |
| `ui/vector-rebuild-action.ts` | `rebuildAllVectorsWithConfirm`：设置页与 mini 设置共用的「🧠 重向量化」入口（确认弹窗 → `rebuildAllVectors` → 成功/跳过/失败汇总）；与 `knowledge-rebuild-action`（只重扫文件）职责不同 |

### 视图
| 文件 | 类 | 职责 |
|------|-----|------|
| `ui/co-writing-view.ts` | `CoWritingView` | 协同写作主视图（Obsidian ItemView；实时质量评估委托 `ui/cowrite/realtime-quality-controller.ts`：10 分钟节流落盘、偏离上下文、busy/pending 补跑、顶栏渲染与切章重置均在该 controller；视图保留开关按钮、顶栏元素、人物/伏笔数据加载与评分内核装配）；`tractionEngine` 由 `facade.createEndingTractionEngine` 创建，供 `ui/cowrite/live-analysis-controller.ts#renderTractionPanel` 渲染「🎯 情节牵引」；`updatePlotCompletion` 向面板 B 注入项目名后再更新完成度；`refreshMetrics` 先经 `shared/plot-eval-throttle.ts#shouldRunPlotEval` 判定（正文未变 / 新增不足且未冷却 / 未到 30 秒最小间隔 → 跳过 AI），`force=true`（手动重试、生成完成）不受限；`refreshPreview` 先 `++previewSeq` 取代次，`MarkdownRenderer.renderMarkdown` 渲染到 detached staging 容器，完成后校验代次再一次性搬进 `previewContent`（旧渲染/切章在途渲染不写回，避免新旧正文混排），500ms 节流窗口内改为尾随渲染（`schedulePreviewFlush` 按剩余时间补一次，force 刷新 / `openChapter` / `onClose` 取消挂起定时器），不再丢弃最后一次输入，前后经 `shared/preview-scroll.ts` 保留滚动位置（贴底继续跟随最新正文）；`refreshGhostAssociation` 经 `shared/ghost-trigger.ts#shouldRequestGhostAssociationByInterval` 限频 4 秒（切章/首次不受限），未到间隔不更新 `lastGhostSeed`，并受 `settings.autoGhostAssociation` 控制（关闭时清空建议、不排防抖、不发请求，在途结果也不写回）；`warnFanficRulesOnce()` 在同人设定加载失败时提示（按「项目 + 文案」去重，无警告时清空去重键），复查点为 `initEngine` 之后 + 生成收口 `showKnowledgeInjectionNotice`（建议/迭代/改写/流式共用）+ 两条联想路径（`handleAssociationSuggest` / `refreshGhostAssociation` 返回后过完守卫），会话中删除/移走设定文件不会静默失去同人约束；所有光标取值（续写/迭代/联想/插入建议/技巧片段插入/光标前上下文）统一经 `shared/cursor-position.ts#resolveCursorPosition`，光标位于开头（`0`）时不再被当成「无光标」回退到文末；前置规划缺口经 `shared/prereq-check.ts#describePrerequisiteGaps` 判定，警告横幅挂在 `editorWrapEl` 首位（`flex:0 0 auto`，真正位于编辑器上方），每次检查先无条件移除旧横幅、8 秒后淡出并 `remove()`；完成度评估按「项目\|章号」校验返回身份，切章经 `resetPlotMetricsForChapterSwitch` 中止在途请求并复位 `idle`，且 `initEngine` 前不用旧会话 metrics 渲染；`onOpen` 不再从工作台状态回填章节（Rev 102 删除 `_workbenchState`），章节上下文只能由 `openChapter` / `openCoWritingFromActiveContext` 的路径反解显式绑定；不再持有情绪/节奏分析器实例（所有权在 `MonitorPanelA`）；实时质量监控构造时注入 `PlotDivergenceEngine` + `CharacterConsistencyChecker`（与 `quality-worker` / `heavy-task-worker` 同口径，`rhythmAnalyzer` 依赖主线程 AI 能力不注入）；顶栏消费 `MonitorResult.failures`：两项都失败显示「质量评估失败（…）」而不是「质量 --」，偏离单独失败追加「偏离检测失败」（`describeMonitorFailures` 把 `quality:` / `deviations:` 前缀映射为用户可读标签）；`saveBody` 委托 `ui/cowrite/body-save-controller.ts`（入口快照 `{project,volume,chapterNum,chapterName,bodyPath}`，await 后只用快照，写盘后 `isSameChapterIdentity` 为假则不再回写 UI）；`openChapter` 首行 `flushPendingBodySaveBeforeChapterSwitch()` 以旧身份冲刷排队正文，失败则提示并中止切章；`clearChapterBinding()` 供无显式上下文的入口回到空态：先按旧身份冲刷排队保存，再清空 `project` / `chapterName` / `volume` / `chapterNum`、编辑器、建议、指标与 `tractionEngine`，状态栏显示「未绑定章节」，禁止沿用上一本书的绑定） |
| `ui/cowrite/body-save-controller.ts` | `BodySaveController` | 协同保存管线（D2 从 `co-writing-view.ts` 抽出）：入口快照章节身份，await 期间切章仍写旧章路径；保存串行（进行中再次调用返回 false）；`flushBeforeChapterSwitch` 用旧身份冲刷排队自动保存，失败返回 false 供调用方中止切章 |
| `ui/cowrite/realtime-quality-controller.ts` | `RealtimeQualityController` | 实时质量评估管线（D2 从 `co-writing-view.ts` 抽出）：busy/pending 编排与补跑、偏离上下文（大纲/最近前文/人物/伏笔）、顶栏质量+偏离渲染、质量历史 10 分钟节流落盘、开关与切章重置；视图只提供正文/身份/数据与 DOM 句柄，评分内核由视图装配（composition root） |
| `ui/monitor-panel-b.ts` | `MonitorPanelB` | 浮窗监控面板 B（剧情完成度/偏离预警/章节结算/写作质量；结局牵引由协同主视图的 `live-analysis-controller` 渲染，面板不再重复建 `EndingTractionEngine`）；质量区在正文 < `QUALITY_MIN_EVALUABLE_CHARS` 时只显示「综合质量 --」与原因（不渲染 0 分、不进基线）；完成度 < 50 字、偏离 < 100 字时同样只显示「--」与原因，且不写 `history` / `divergenceHistory`、不触发偏离预警；摘要 `empty()` 后分别经 `ensureQualityDetailPanel` / `ensureCompletionDetailPanel` / `ensureDivergenceDetailPanel` 重建详情面板；基线/趋势按「章」聚合，历史落盘经 `appendQualityHistory` 节流；内存 `baselineHistory` 同样按章收敛（同章旧样本先移除再追加），配额语义为 200 章而非 200 次评估；项目名由 `setActiveProject` 同步注入（`resolveProject` 优先级：注入 > activeFile），协同视图无 activeFile 时不得回退到空串或上一本书；切章冲刷传 `currentBaselineProject`，保证待写记录写回其所属项目；`onClose` 先按同一口径冲刷（`currentBaselineProject || resolveProject()`）再 `dispose`，避免关闭后防抖回调残留与 A 书末条写进 B 书；用户提示统一 `new Notice`（此前 `app.notice.addNotice` 不存在，预警/里程碑/质量提醒从未显示）；偏离/质量/完成度评估异常均经 `renderEvalFailure` 清空卡片并显示「--」+「本次评估失败」，不保留上一次的分数 |
| `ui/monitor-panel-a.ts` | `MonitorPanelA` | 浮窗监控面板 A（节奏/情绪/OOC/实体）。`refreshWithBody` 会被输入（2.5s 防抖）与插入/保存（0.5s）并发触发：用 `analysisSeq` 代次守卫，情绪与节奏各自 `await` 后（含 `catch`）校验代次，过期直接返回不写 DOM；短正文分支同样推进代次，避免清空后被旧请求写回 |
| `ui/full-writer-view.ts` | `FullWriterView` | 章节写作工作台主视图；`refreshChapterStateFromDisk()` 供协同写作返回后从磁盘恢复步骤状态；`onOpen` / `handleFileChange` 必须先 `restoreChapterState()` 再 `loadContext()`，否则自动提取的角色灵魂完成态会被磁盘模板覆盖 |
| `ui/states/chapter-state-manager.ts` | `ChapterStateManager` | 步骤状态唯一载体：`updateStepState` 走结构校验、`invalidateSteps` 同步 `stepCompleted/stepLevels/staleSteps`；恢复时只有 `reviewed` 可信，`generated` 重新校验；无步骤文件（或校验 empty/skeleton）时必须删除 `stepResults`，否则导航按残留结果显示 ◐；`settlement` 无独立文件，按正文 frontmatter `status: settled / 已完稿` 识别完成 |
| `ui/polish-editor.ts` | `PolishEditor` | 结算步骤内嵌润色编辑器；自动保存成功回调由工作台注入（`BODY_CHANGE_INVALIDATED_STEPS`），写盘失败不失效；`PolishAIPolishModal` 的项目为必传参数（当前章节所属项目），不得回落到 `getActiveProject()` |

> v8.14 技术审计批 D：`ui/action-panel.ts`（零引用死组件）已删除。

### 主要 Modal
| 文件 | 功能 |
|------|------|
| `ui/create-project-modal.ts` | 创建项目 |
| `ui/auto-writer-modal.ts` | 自动写作 |
| `ui/batch-import-modal.ts` | 批量导入 |
| `ui/batch-create-modal.ts` | 批量建章（读取全书规划一次性创建全部卷，建章前校验大纲、建章后校验落盘） |
| `ui/batch-chapters-modal.ts` | 批量章节（`AbortController` 取消：`onClose` 中止在途 AI，取消后不再写盘并提示「后续章节未执行」） |
| `ui/continue-chapters-modal.ts` | 续写章节 |
| `ui/chapter-outline-tree-modal.ts` | 章节大纲树 |
| `ui/chapter-settlement-modal.ts` | 章节结算 |
| `ui/chapter-version-modal.ts` | 章节版本 |
| `ui/co-write-floating-panel.ts` | 协同写作浮动面板（与 Tab 版共享 `CoWriterEngine`；光标取值同样经 `shared/cursor-position.ts#resolveCursorPosition`，开头光标不再回退到文末） |
| `ui/context-injector-modal.ts` | 上下文注入 |
| `ui/cross-volume-state-modal.ts` | 跨卷状态 |
| `ui/diagnose-writer-modal.ts` | 写作诊断 |
| `ui/ai-builder-modal.ts` | AI 世界元素生成器（单个/批量实体生成均经 `readFanficPromptBlockWithNotice` 注入同人约束，设定失效时提示）。Rev 192：补齐 `novel-writer-ai-builder-*` 全套样式后，多项目视图为两列卡片矩阵（进度条 + 五项统计横排 + 进入/快捷生成），仪表盘为自适应实体卡片网格；统计走 `shared/entity-stats.ts#countProjectEntities`；人物批量记录失败批次数、全失败明确提示；单项目隐藏「切换项目」入口 |
| `ui/fanfic-prompt-notice.ts` | `readFanficPromptBlockWithNotice` | 实体生成入口读取同人约束块的唯一入口：`readFanficRules` → `formatFanficRulesLoadWarning`（缺失/不存在/读取失败/内容全空）→ `Notice(…, 8000)` → `formatFanficRulesForPrompt`。人物/势力/地点/物品/统一实体/AI 建卡 7 处调用点不得再直接拼 `formatFanficRulesForPrompt(await readFanficRules(...))`，否则空块与「有约束」在界面上无法区分 |
| `ui/add-fanfic-setting-modal.ts` | 同人设定（可绑定到指定项目：落盘到 `项目/05-同人设定库/` 并回写 `.project` 的同人设定路径；提示词复用 `buildFanficSettingsContent` 骨架，保存前做完整性校验与一次 AI 补全；有项目时另提供「🔗 使用已有设定文件」区，候选走 `listFanficSettingCandidates`、绑定走 `attachFanficPathToProject`，不完整允许绑定但提示缺失字段） |
| `ui/full-writer/fanfic-settings-utils.ts` | 同人设定结构、保存前校验、`.project` 路径回写的唯一实现（`buildFanficSettingsContent` / `attachFanficPathToProject` / `isFanficSettingsContentValidEnough` / `saveFanficSettingFile`；向导口径 = 9 字段实质填写 + 时间线表格结构，占位「（待补充）」不算内容；骨架同时产出「## 主要人物」「## 势力组织」占位，AI 生成与向导保存结构一致；单字段解析不在本文件，统一走 `shared/fanfic-rules.ts#extractFanficRuleValue`） |
| `ui/appearance-settings.ts` | 外观设置 |
| `ui/backup-yuan-modal.ts` | 备份还原 |
| `ui/changelog-modal.ts` | 更新日志 |
| `ui/quality-dashboard-modal.ts` | 章节质量仪表盘（六维评分 + 时间范围筛选 + 维度钻取 + 问题点击定位 + 导出；C2 起评估传 `characterNames`（按项目缓存 60s）+ 本章「大纲摘要」作为 `chapterOutline`，与协同视图同源；评估缓存键为 `path:mtime`；雷达展示六维聚合，总分取各章 `overallScore` 均值而非六维均值；Rev 186 起 `scanChapters` 过滤无正文的骨架章，避免空 TFile 参与评分） |
| `ui/story-linkage-modal.ts` | 关联索引看板（Rev 186，命令 `novel-writer-story-linkage`）：摘要 chips（到期/逾期/即将/时间线/设定/提示），分区展示到期、逾期、3 章内即将到期伏笔（含关联设定与规划定位）、本章时间线、全书规划定位、数据质量提示；「🔄 重新扫描」与「✍️ 回写关联索引」（二次确认后调用 `writeStoryLinkageIndex`）；空/加载/失败态齐备。Rev 187：章节选择器改为 DOM 自绘下拉（触发按钮 + 搜索框 + 章节行，点击行即切章），禁用原生 `<select>`；宽度改挂 `modalEl`（`.modal.novel-writer-linkage-modal`），`scanSeq` 丢弃过期扫描结果。Rev 188：点击任意章节行（含当前章）都必须 `scan()`，不得对同章提前返回。Rev 190：章节选择面板改为 header 内流内全宽展开（不再 absolute 遮挡正文，列表限高 200px）；弹窗内容区纵向 flex（header/footer 固定、body 滚动）；表格 `table-layout: fixed` + 分类列宽（`--foreshadow` / `--timeline`）；六个分区卡片化；外部点击判断同时覆盖 `pickerEl` 与 `panelEl`。Rev 191：章节列表回块级布局（`.novel-writer-linkage-chapter-list` 去掉 flex，列表项 `flex: 0 0 auto`），修复 400 项被 `flex-shrink` 压成 12px 高、文字横条视觉重叠 |
| `ui/export-manuscript-modal.ts` | 成稿导出（Markdown / TXT / HTML，HTML 可打印为 PDF） |
| `ui/rewrite-suggestion-modal.ts` | AI 改写建议（选中文本 → 2-3 个方案 → 一键替换，AI 失败自动降级规则建议） |
| `ui/rename-project-modal.ts` | 重命名当前项目（fileManager 重命名 + `.project` 标题同步） |
| `ui/writing-style-modal.ts` | 文笔风格设置（多文件预设一键应用、「➕ 新增预设」面板：填名称 → AI 生成 9 节内容 → 落盘为新预设、参考样本编辑、分节文本域） |
| `ui/writing-style-presets.ts` | 多文件文笔预设解析 / 加载 / 新增（`元文件/00-系统模板/文笔风格预设/`，`saveStylePreset` 负责命名、序号、完整性校验与落盘） |
| `ui/unified-entity-generate-modal.ts` | 统一实体生成（人物/势力/地点/物品，逐条 `ensureEntityIntegrity` 补全 + 复检后才交给 `saveEntities`） |

### 完整写作工作台（ui/full-writer/）
| 文件 | 功能 |
|------|------|
| `ui/full-writer/project-selector-controller.ts` | 项目与章节页：左侧项目卡片网格 + 右侧常驻项目概览与工具面板（不再有隐藏的预览抽屉与「⚡️ 工具」弹窗）；项目卡片选中/默认选中经 `onProjectSelected` 回写命令层上下文，默认选中优先沿用上次项目而非 `projects[0]`。Rev 192：「全部章节」弹窗改为 960px 宽 + 搜索框 + ✅/✏️/📝 图例 + 按卷分组（sticky 卷标题）+ 自适应网格 + 62vh 滚动 + 空态，`showAllChapters` 内部先 `sortChaptersByNumber` |
| `ui/full-writer/template-vars-builder.ts` | `buildTemplateVars`：提示词模板变量构建（章节上下文 / 实体 / 同人约束 / 长篇记忆 / 格式契约）；同人约束必须经 `ui/fanfic-prompt-notice.ts#readFanficPromptBlockWithNotice` 读取（设定失效时 `Notice` 提示），禁止直接拼 `formatFanficRulesForPrompt(await readFanficRules(...))` |
| `ui/full-writer/context-loader-controller.ts` | `ContextLoaderController`：上下文加载 + 角色灵魂自动提取；提取结果必须经 `saveStepResult('characterSoul', …)` 落盘且保存成功才标 complete（失败降 partial）；磁盘已有真实灵魂文件或内存已有恢复内容时跳过提取，不得覆盖 |
| `ui/full-writer/quick-tools-panel.ts` | 常驻快捷工具面板渲染：非 compact 模式下分组标题为可点击折叠头（组名 + 数量 + 箭头），compact 模式渲染章节页单行 chip 条 |
| `ui/full-writer/tool-catalog.ts` | 快捷工具目录单一事实源（6 组 37 项 + `CHAPTER_QUICK_TOOL_IDS` 高频条）；`ToolGroup.defaultCollapsed` 控制项目页右侧面板默认收起哪些低频组 |
| `ui/full-writer/title-bar-controller.ts` | 章节页标题栏：项目/章节选择 + 资源入口 + 常驻快捷工具条（⚙️ 设置 打开 `MiniSettingsModal`）；v4.17 增加“🚀 一键完成本章 / 🐢 逐步完成”，模式类型取自 `shared/chapter-run.ts` 以避免与编排器形成 UI 环 |
| `ui/full-writer/chapter-orchestrator.ts` | v4.17 单章一键编排：按 `ChapterStateManager` 完成态推导剩余动作；推荐模式合并 5 个规划步骤，逐步模式逐项执行；支持暂停/继续/取消、失败停留、结算幂等；不重写 StepRunner |
| `shared/local-ai-queue.ts` | v4.17 本地 AI 进程级串行队列：建议/幽灵/守卫/验证共用 1 个槽，abort 时从等待队列移除；云端调用不经过此队列 |
| `shared/chapter-run.ts` | v4.17 单章运行模式（`recommended` / `step`）的共享类型，供视图、标题栏与编排器共同引用 |
| `shared/canon-source.ts` | v4.18 同人考据来源分级：官方/官方 Wiki/参考资料/衍生/未知，衍生来源过滤与来源哈希 |
| `services/canon-research-service.ts` | v4.18 官方来源检索与缓存：手动 URL/摘录 + 可选搜索 API；只保存短摘录 |
| `shared/fanfic-audit.ts` | v4.18 同人设定规则审核、来源覆盖、衍生来源阻断与补全/审核提示词 |
| `ui/fanfic-review-modal.ts` | v4.18 同人设定人工审核：来源逐字段展示、必选检查项、通过后绑定 |
| `services/project-rename-service.ts` | v4.18 项目重命名：目录 + `.project` + 世界观 + 写作配置 + 插件偏好迁移 |
| `shared/project-name.ts` | v4.18 项目名校验：空名/标点/系统目录/Windows 保留名/重名 |
| `shared/synopsis-spec.ts` | v4.18 全书简介四风格规格、评分与解析 |
| `services/synopsis-store.ts` | v4.18 全书简介多版本、草稿、采用版本兼容副本 |
| `ui/full-writer/entity-state-controller.ts` | `EntityStateController`：涉及实体同步、结算后实体状态检测、上下文面板刷新；`refreshContextBar()` 必须先移除 `.novel-writer-fw-context-panel` 再 `ContextPanel.render`，不得用不存在的 `.novel-writer-fw-context-card`，否则旧面板残留使 workspace grid 变两行、章节页塌陷 |
| `ui/full-writer/wizard-step-validators.ts` | 向导步骤「内容级」完整性校验（同人设定 / 世界观 / 设定库 / 文笔风格 / 大纲 / 章节）；同人分支统一走 `isFanficSettingsContentValidEnough`，与保存侧同口径（向导表单不收集时间线） |
| `ui/full-writer/wizard-controller.ts` | 向导导航门禁：内容不完整阻止进入下一步，提供「重新生成 / 跳过此步骤 →」 |
| `ui/full-writer/wizard-step-executors.ts` | 向导步骤执行器：生成后立即做内容校验，不完整标记 `complete_with_warnings` |
| `ui/full-writer/wizard-step-renderers.ts` | 向导步骤渲染；同人步骤表单下方提供「绑定项目里已有设定文件」（候选经 `shared/fanfic-binding.ts` 筛选，绑定前确认存在且非空，回写 `.project` 并回填表单；字段不完整允许绑定但提示缺失项）；三条创作规则 textarea 必须用 `shared/fanfic-rules.ts#extractFanficRuleValue` 回填（与 prompt 注入同一解析口径），不能走 frontmatter `key:` 正则 |
| `ui/full-writer/scene-outline-controller.ts` | Scene 展开场景编辑器：解析走 `parseSceneHeadings`；`saveScenes()` 返回是否真正写入，解析为 0 且原文件非空时拒绝覆盖；`saveRawContent()` 负责纯文本模式落盘 |
| `ui/full-writer/step-render-controller.ts` | 章节步骤渲染与保存按钮；左侧阶段导航渲染阶段状态 + 11 个步骤级 ✅/◐/○/⚠️ 子项（必做标记、当前高亮、可点击直达）；按模式调用 `saveScenes()` / `saveRawContent()`，仅在返回 `true` 时提示成功并标记步骤完成 |
| `ui/full-writer/streamlined-nav-presenter.ts` | 阶段导航单一事实源：阶段表由 `ALL_FULL_STEPS` 派生（含 `requiredSteps`）；完成口径「必做全完成即完成，可选不阻塞，全可选阶段做过一步即完成」；阶段点击定位第一个未完成步骤 |
| `ui/full-writer/batch-pipeline-runner.ts` | 批量 N 章流水线：复用 11 步 + BodyWriter + 结算；单步空产出自动重试一次；取消经 `AbortController` 中断当前请求；断点续跑时「已结算 + 步骤齐全」整章返回 `skipped`，不再重复结算 |
| `ui/full-writer/batch-targets.ts` | `BATCH_STEP_KEYS` / `buildBatchTargets` / `isBodySettled` | 批量步骤键与目标生成；`isBodySettled` 读正文 frontmatter 的 `status`（settled/已结算/已完稿），只匹配 frontmatter 区域 |
| `ui/full-writer/batch-step-retry.ts` | 批量单步重试策略（叶子模块，`shouldRetryBatchStep` / `BATCH_STEP_MAX_ATTEMPTS`）：取消与达到上限不重试，供单测独立导入 |

### 协同写作 UI（cowrite/）
| 文件 | 功能 |
|------|------|
| `ui/cowrite/cowrite-mappers.ts` | 状态映射 |
| `ui/cowrite/history-modal.ts` | 建议历史 |
| `ui/cowrite/iterate-instruction-modal.ts` | 迭代指令 |
| `ui/cowrite/live-analysis-controller.ts` | 实时分析控制（牵引面板 + 推送面板 A + 设定守卫；`input` 触发的守卫要过「新增 ≥300 字或冷却 5 分钟」门槛，插入/保存/手动不限制；守卫用 `guardSeq` 代次，切章经 `resetForChapterSwitch()` 作废在途结果并清空长度基准，`finally` 只在代次匹配时释放锁；牵引面板用 `tractionSeq`，切章清空容器并由 `openChapter` 在引擎就绪后重渲染） |
| `ui/cowrite/memory-manager-modal.ts` | 记忆管理 |
| `ui/cowrite/suggestion-edit-modal.ts` | 建议编辑 |
| `ui/cowrite/suggestion-history-store.ts` | 建议历史存储 |

### 组件（components/）
| 文件 | 功能 |
|------|------|
| `ui/components/analysis-report-panel.ts` | 分析报告面板 |
| `ui/components/emotion-curve-view.ts` | 情绪曲线视图 |
| `ui/components/empty-state.ts` | 空状态通用组件（图标+标题+描述+操作按钮，内联 SVG） |
| `ui/components/progress/` | 进度组件（进度条、浮动球、加载遮罩、任务卡片、步骤列表、状态栏、确认弹窗） |

---

## 七、类型定义（types/）

| 文件 | 内容 |
|------|------|
| `types/global.d.ts` | 全局类型声明 |
| `types/obsidian-augment.d.ts` | Obsidian API 类型扩充 |

---

## 八、测试（tests/）

| 目录 | 数量 | 内容 |
|------|------|------|
| `tests/unit/` | 165 | 单元测试（engine/、services/、shared/、ui/） |
| `tests/integration/` | 7 | 集成测试（项目创建、章节生成、知识库、题材分类、版本管理、世界观生成、工作流） |
| `tests/e2e/` | 3 | E2E：`obsidian-plugin.spec.ts` 为真实 Electron 链路（创建项目 → 打开工作台）；其余为浏览器模拟用例 |
| `tests/__mocks__/` | 1 | Obsidian Mock |
| `tests/setup.ts` | 1 | 测试设置 |

---

## 九、构建与脚本（scripts/）

| 文件 | 功能 |
|------|------|
| `scripts/build.js` | esbuild 构建脚本（main + 3 Worker 入口） |
| `scripts/baseline-utils.mjs` | 架构守卫基线工具：`--baseline <file>` 只对新增违规失败，`--update-baseline` 仅在无新增时收紧（section 独立读写，`check:deps` / `check-engines` 共用） |
| `scripts/check-css.js` | CSS 检查脚本 |
| `scripts/check-dependencies.mjs` | 依赖检查 |
| `scripts/check-release.mjs` | 发布资产与版本一致性校验（三资产 / Worker / 内置模板） |
| `scripts/cleanup-css.js` | CSS 清理 |
| `scripts/generate-template-assets.mjs` | 将 `assets/template-scaffold/` 生成为 TS 模块（`--check` 校验一致性） |
| `scripts/scan-engine-instances.mjs` | 引擎实例扫描 |
| `scripts/stats-css.js` | CSS 统计 |
| `scripts/sync-version.js` | 版本同步 |

---

## 十、配置文件

| 文件 | 作用 |
|------|------|
| `package.json` | 项目配置、依赖、脚本 |
| `tsconfig.json` | TypeScript 配置 |
| `manifest.json` | Obsidian 插件清单 |
| `playwright.config.ts` | Playwright E2E 测试配置 |
| `styles.css` | 插件样式 |
| `design-tokens.css` | 设计令牌 CSS 变量 |
| `.engine-registry-whitelist.json` | 引擎注册白名单 |
| `.github/workflows/ci.yml` | CI 门禁（模板一致性 / lint / typecheck / test / build / 发布校验） |
| `.github/workflows/release.yml` | 推送 `v*` tag 自动创建 GitHub Release（核心文件 + `workers/` + 含 Worker 的 zip） |
| `assets/template-scaffold/` | 内置模板源文件（构建时嵌入 `main.js`） |

---

## 快速查找索引

### 按功能查找

| 你要做什么 | 去哪里找 |
|------------|----------|
| 添加新的 AI 调用 | `engine/ai-engine.ts` + `engine/prompts/` |
| 添加新的实体类型 | `engine/repository/domain/aggregates/` + `shared/entity-models.ts` |
| 添加新的 Repository | `engine/repository/` 下新建，参照 `character-repository.ts` |
| 添加新的状态切片 | `shared/store/createStore.ts` + 对应模块 |
| 修改 UI 组件 | `ui/components/` 或 `ui/cowrite/` |
| 添加新的质量检测 | `engine/quality/` |
| 修改拆解质量评分 / 交叉验证规则 | `engine/quality-scorer.ts` + `services/deconstruction-scheduler.ts` |
| 添加新的风格维度 | `engine/style/style-dimensions-v2.ts` |
| 修改构建配置 | `scripts/build.js` |
| 添加新命令 | `shared/command-ids.ts`（id）+ `core/command-registry.ts`（注册）+ `ui/command-ui-executor.ts`（UI 执行，如需要）+ `main.ts`（装配） |
| 添加新的设置项 | `core/settings-service.ts` + `ui/appearance-settings.ts` |
| 修改拆解引擎配置（增强级别/维度/向量/LLM/性能） | `services/deconstruction-scheduler.ts`（`DeconstructionEngineSettings`） + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + `ui/settings-tab.ts` / `ui/mini-settings-modal.ts`（`renderDeconstructionSection` / `renderDeconstructionTab`） |
| 修改指纹列表 / 作用域判定 | `ui/fingerprint-utils.ts`（`renderFingerprintList` / `isSourceOnlyFingerprintScope`；`template` 是来源库，不参与注入，三个入口统一用该判定隐藏启用/强度控件） |
| 修改 Worker 相关 | `services/worker-manager.ts` + `services/worker-protocol.ts` |

### 按问题查找

| 遇到的问题 | 检查文件 |
|------------|----------|
| AI 调用失败 | `engine/ai-engine.ts` |
| 数据读取/写入失败 | `engine/repository/base-markdown-repository.ts` |
| 性能问题 | `services/performance-monitor.ts` |
| 缓存问题 | `engine/cache/multi-layer-cache.ts` |
| 引擎找不到 | `engine/engine-registry.ts` + `.engine-registry-whitelist.json` |
| 样式问题 | `styles.css` + `design-tokens.css` |
| 测试失败 | `tests/unit/` 对应目录 |
| 拆解质量评分异常 / 交叉验证规则不生效 | `engine/quality-scorer.ts` + `services/deconstruction-scheduler.ts` |
| 拆解引擎设置不生效 / 维度缺失 / 并发不对 / 全文分块未触发 | `services/deconstruction-scheduler.ts`（`addTask` / `breakdownDimensionWithSegments` / `getSegmentedBreakdownConfig`） + `services/scheduler-segment-integration.ts` + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + 设置面板「🧬 拆解引擎」tab |
