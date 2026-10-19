# 代码索引（Code Index）

> 版本：v4.11.0 · 更新：2026-10-19 · 源文件：605 个 .ts（含 178 个测试）

---

## 总览

| 层级 | 目录 | 文件数 | 核心职责 |
|------|------|--------|----------|
| 入口 | `main.ts` | 1 | 插件注册、生命周期、命令绑定 |
| UI 层 | `ui/` | 149 | 视图、Modal、组件、设置面板 |
| Facade 层 | `ui/cowrite/` | 7 | 协同写作 UI 与引擎的中间层 |
| 引擎层 | `engine/` | 317 | 业务逻辑、AI 引擎、质量检测、Repository |
| 服务层 | `services/` | 37 | 跨引擎协调、Worker 管理、外部服务 |
| 核心服务 | `core/` | 6 | 插件级核心服务（加密、设置、主题、Provider） |
| 共享层 | `shared/` | 67 | 工具函数、状态管理、类型定义、文件系统抽象 |
| 测试 | `tests/` | 178 | 单元测试、集成测试、E2E 测试 |

---

## 一、入口层

### main.ts
- `NovelWriterPlugin` — 插件主类，负责生命周期（onload/unload）、命令注册、视图注册、设置面板、EngineRegistry 初始化
- 位置：`main.ts`

---

## 二、核心服务层（core/）

> 插件级单例服务，在 EngineRegistry 第 2 阶段初始化

| 文件 | 类/导出 | 职责 |
|------|---------|------|
| `core/index.ts` | — | 统一导出入口 |
| `core/crypto-service.ts` | `CryptoService` | API Key 加解密（AES-GCM）、主密码保护 |
| `core/settings-service.ts` | `SettingsService` | 设置持久化、迁移、数据类封装 |
| `core/provider-manager.ts` | `ProviderManager` | AI 供应商管理（内置+自定义）、模型能力检测 |
| `core/theme-manager.ts` | `ThemeManager` | 主题切换、CSS 变量管理 |
| `core/command-registry.ts` | `CommandRegistry` | 命令注册与调度 |

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
| `engine/ai-api-client.ts` | — | 底层 API 客户端 |
| `engine/ai-prompt-builder.ts` | `AIPromptBuilder` | Prompt 构建器 |
| `engine/ai-types.ts` | — | AI 相关类型定义 |
| `engine/ai-outline-generator.ts` | `AIOutlineGenerator` | AI 大纲生成 |
| `engine/ai-chapter-helpers.ts` | — | 章节生成辅助方法 |
| `engine/ai-character-generator.ts` | `AICharacterGenerator` | AI 角色生成 |
| `engine/ai-entity-generator.ts` | `AIEntityGenerator` | AI 实体生成 |
| `engine/ai-batch-entity-generator.ts` | `AIBatchEntityGenerator` | AI 批量实体生成 |
| `engine/ai-scene-generator.ts` | `AISceneGenerator` | AI 场景生成 |
| `engine/ai-scene-expander.ts` | `AISceneExpander` | AI 场景扩写 |
| `engine/ai-worldview-generator.ts` | `AIWorldviewGenerator` | AI 世界观生成 |
| `engine/prompt-builder.ts` | `PromptBuilder` | 通用 Prompt 构建器 |
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
| `engine/co-writer-engine.ts` | `CoWriterEngine` | 协同写作主引擎，建议生成、历史管理 |
| `engine/co-writer/` | — | 协同写作子模块 |
| `engine/co-writer/co-writer-types.ts` | — | 协同写作类型定义 |
| `engine/co-writer/session-state.ts` | — | 会话状态管理 |
| `engine/co-writer/create-session-store.ts` | — | 会话状态创建（Zustand 风格） |
| `engine/co-writer/parallel-suggestions.ts` | — | 并行建议生成 |

---

### 3.5 质量检测引擎组（quality/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/quality/quality-score-engine.ts` | `QualityScoreEngine` | 综合质量评分引擎 |
| `engine/quality/deviation-detector.ts` | `DeviationDetector` | 偏离检测（6 类：主线/人物OOC/矛盾/伏笔遗忘/节奏/情绪断层） |
| `engine/quality/rewrite-suggestion-engine.ts` | `RewriteSuggestionEngine` | 改写建议引擎，6 种类型（润色/扩写/缩写/节奏/人物/逻辑），启发式自动检测，AI+规则双模式 |
| `engine/quality/rewrite-types.ts` | — | 改写类型定义 |
| `engine/quality/rewrite-prompts.ts` | — | 改写提示词 |
| `engine/quality/realtime-monitor.ts` | `RealtimeMonitor` | 实时质量监控 |
| `engine/quality/performance-optimizer.ts` | `PerformanceOptimizer` | 性能优化器 |
| `engine/quality/quality-history-store.ts` | `QualityHistoryStore` | 质量历史记录存储 |
| `engine/quality/quality-worker.ts` | — | 质量检测 Worker |

---

### 3.6 风格引擎组（style/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/style/style-deconstructor-v2.ts` | `StyleDeconstructorV2` | 风格拆解 V2（多维度指纹提取） |
| `engine/style/style-dimensions-v2.ts` | — | 风格维度定义 V2 |
| `engine/style/style-vector-store-v2.ts` | `StyleVectorStoreV2` | 风格向量存储 V2 |
| `engine/style/fingerprint-blender-v2.ts` | `FingerprintBlenderV2` | 指纹融合器 V2 |
| `engine/style/fingerprint-migrator.ts` | `FingerprintMigrator` | 指纹迁移（V1→V2） |
| `engine/style/v2-quantitative-extractor.ts` | `calculateRhythmStats` / `calculatePerspectiveStats` | V2 定量拆解（节奏/视角纯统计） |
| `engine/style/style-intensity-engine.ts` | `StyleIntensityEngine` | 风格强度引擎 |
| `engine/style/dynamic-injection-engine.ts` | `DynamicInjectionEngine` | 动态注入引擎 |
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
| `engine/knowledge-injector.ts` | `KnowledgeInjector` | 知识注入器 |
| `engine/knowledge-tags.ts` | — | 知识标签系统 |
| `engine/knowledge-to-fingerprint-converter.ts` | — | 知识到指纹转换器 |
| `engine/knowledge-vector-store.ts` | `KnowledgeVectorStore` | 知识向量存储 |
| `engine/local-vector-store.ts` | `LocalVectorStore` | 本地向量存储 |
| `engine/webnovel-knowledge-base.ts` | — | 网文知识库 |
| `engine/vector-enhancer.ts` | — | 向量增强 |
| `engine/embedding/` | — | Embedding 供应商适配层 |

#### Embedding 子模块
| 文件 | 类 |
|------|-----|
| `engine/embedding/embedding-provider.ts` | `EmbeddingProvider` 基类 |
| `engine/embedding/provider-factory.ts` | `ProviderFactory` |
| `engine/embedding/openai-provider.ts` | `OpenAIEmbeddingProvider` |
| `engine/embedding/doubao-provider.ts` | `DoubaoEmbeddingProvider` |
| `engine/embedding/ollama-provider.ts` | `OllamaEmbeddingProvider` |
| `engine/embedding/qwen-provider.ts` | `QwenEmbeddingProvider` |

---

### 3.9 剧情与情节引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/plot-completion-engine.ts` | `PlotCompletionEngine` | 情节补全引擎 |
| `engine/plot-divergence-engine.ts` | `PlotDivergenceEngine` | 情节偏离检测 |
| `engine/plot-redundancy-checker.ts` | `PlotRedundancyChecker` | 情节冗余检查 |
| `engine/outline-to-text-expander.ts` | — | 大纲转正文扩写 |
| `engine/scene-expander.ts` | `SceneExpander` | 场景扩写器 |

---

### 3.10 角色与关系引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/character-soul.ts` | `CharacterSoul` | 角色灵魂模型 |
| `engine/character-consistency-checker.ts` | — | 角色一致性检查 |
| `engine/relationship-engine.ts` | `RelationshipEngine` | 关系引擎 |
| `engine/entity-context-engine.ts` | `EntityContextEngine` | 实体上下文引擎 |
| `engine/entity-scorer.ts` | `EntityScorer` | 实体评分器 |
| `engine/entity-state-manager.ts` | `EntityStateManager` | 实体状态管理 |

---

### 3.11 情绪引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/emotion-planner.ts` | `EmotionPlanner` | 情绪规划器 |
| `engine/emotion-curve-analyzer.ts` | — | 情绪曲线分析 |
| `engine/emotion-auditor.ts` | — | 情绪审计 |

---

### 3.12 上下文管理

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/context-manager.ts` | `ContextManager` | 上下文管理器 |
| `engine/chapter-context-builder.ts` | — | 章节上下文构建 |
| `engine/context-compressor.ts` | `ContextCompressor` | 上下文压缩器 |
| `engine/context/context-diff-detector.ts` | — | 上下文差异检测 |
| `engine/context/incremental-updater.ts` | — | 增量更新器 |

---

### 3.13 步骤流水线引擎

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/step-runner.ts` | `StepRunner` | 步骤执行器 |
| `engine/step-definitions.ts` | — | 步骤定义与迁移映射 |
| `engine/step-result-saver.ts` | `StepResultSaver` | 步骤结果保存 |
| `engine/step-modal-controller.ts` | — | 步骤弹窗控制 |
| `engine/step-validator.ts` | `StepValidator` | 步骤验证器 |
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
| `engine/analysis-report-engine.ts` | `AnalysisReportEngine` | 分析报告引擎 |
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
| `engine/rhythm-analyzer.ts` | — | 节奏分析 |
| `engine/review-agent.ts` | — | 评审代理 |
| `engine/sentence-diversity-engine.ts` | `SentenceDiversityEngine` | 句式多样性引擎 |
| `engine/style-fingerprint-library.ts` | `StyleFingerprintLibrary` | 风格指纹库 |
| `engine/style-learner.ts` | — | 风格学习器 |
| `engine/style-similarity-scorer.ts` | `StyleSimilarityScorer` | 风格相似度评分 |
| `engine/style-vector-store.ts` | — | 风格向量存储（旧版） |
| `engine/write-lock.ts` | `WriteLock` | 写入锁 |
| `engine/writing-profile.ts` | — | 写作画像 |
| `engine/writing-quality-engine.ts` | `WritingQualityEngine` | 写作质量引擎 |
| `engine/chapter-utils.ts` | — | 章节工具函数 |

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

### 3.18 性能监控（performance/）

| 文件 | 类 | 职责 |
|------|-----|------|
| `engine/performance/performance-monitor.ts` | `PerformanceMonitor` | 性能监控器，指标收集、耗时统计 |

---

## 四、服务层（services/）

> 跨引擎协调、外部服务集成、Worker 管理

| 文件 | 类 | 职责 |
|------|-----|------|
| `services/index.ts` | — | 统一导出 |
| `services/worker-manager.ts` | `WorkerManager` | 通用 Worker 管理器（池化、队列、进度、降级） |
| `services/deconstruction-worker-manager.ts` | — | 拆解任务专用 Worker 管理器 |
| `services/deconstruction-scheduler.ts` | `DeconstructionScheduler` | 拆解任务调度器（v8.0 起导出 `DeconstructionEngineSettings`/`DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS`/`ALL_BREAKDOWN_DIMENSIONS`/`DIMENSION_LABELS`，`addTask` 保留全文，维度拆解超阈值时接入全文分块编排） |
| `services/scheduler-segment-integration.ts` | `SchedulerSegmentIntegration` | 调度器分块集成层：复用 `TextSegmenter` 的章节优先/段落与字数兜底分块，逐块调用 `DeconstructionWorkerManager`，通过 `IncrementalResultAggregator` 聚合结果，并保留可选 LLM 增强接入点 |
| `services/heavy-task-worker-manager.ts` | — | 重任务 Worker 管理器 |
| `services/worker-protocol.ts` | — | Worker 通信协议 |
| `services/worker-runtime.ts` | — | Worker 运行时 |
| `services/template-service.ts` | `TemplateService` | 模板服务（系统模板+自定义模板） |
| `services/prompt-manager.ts` | `PromptManager` | Prompt 管理服务 |
| `services/prompt-templates-default.ts` | — | 默认 Prompt 模板 |
| `services/prompt-manager-types.ts` | — | Prompt 管理类型 |
| `services/settlement-service.ts` | — | 结算服务 |
| `services/knowledge-base-manager.ts` | — | 知识库管理服务 |
| `services/worldview-cache-service.ts` | — | 世界观缓存服务 |
| `services/chapter-recognizer.ts` | — | 章节识别服务 |
| `services/chapter-version-service.ts` | `ChapterVersionService` | 章节版本管理 |
| `services/batch-import-manager.ts` | — | 批量导入管理器 |
| `services/foreshadow-manager.ts` | — | 伏笔管理器 |
| `services/genre-classifier.ts` | `GenreClassifier` | 题材分类器 |
| `services/genre-preference-memory.ts` | — | 题材偏好记忆 |
| `services/rules-service.ts` | — | 规则服务 |
| `services/update-checker.ts` | `UpdateChecker` | 更新检查器 |
| `services/performance-monitor.ts` | — | 服务层性能监控 |

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
| `shared/file-system-port.ts` | `FileSystemPort` | 文件系统抽象端口（Obsidian/Mock 双实现） |
| `shared/logger.ts` | `Logger` | 日志工具 |
| `shared/paths.ts` | — | 路径工具函数 |
| `shared/frontmatter.ts` | — | Frontmatter 解析/序列化 |
| `shared/token-estimator.ts` | `TokenEstimator` | Token 估算器 |
| `shared/diff-utils.ts` | — | Diff 工具 |
| `shared/api-response-utils.ts` | — | API 响应工具 |
| `shared/info-debt.ts` | `InfoDebt` | 信息债追踪 |
| `shared/progress-emitter.ts` | `ProgressEmitter` | 进度发射器 |
| `shared/time-estimator.ts` | `TimeEstimator` | 时间估算器 |
| `shared/adaptive-debounce-manager.ts` | — | 自适应防抖管理器 |
| `shared/serialized-writer.ts` | — | 序列化写入器 |
| `shared/yield.ts` | `yieldToUI` | UI 让步工具（setTimeout(0) 让出主线程控制权） |
| `shared/settings-migrator.ts` | — | 设置迁移器 |
| `shared/template-validator.ts` | — | 模板验证器 |
| `shared/thresholds.ts` | — | 阈值常量 |
| `shared/format-constants.ts` | — | 格式常量 |
| `shared/changelog-data.ts` | — | 更新日志数据 |
| `shared/model-capabilities.ts` | — | 模型能力映射 |
| `shared/model-source.ts` | `ModelSourceType` / `resolveProviderSourceType` | 模型源类型定义与解析（云端/本地） |
| `shared/plugin-api.ts` | — | 插件 API 类型 |
| `shared/plugin-cache.ts` | — | 插件缓存 |
| `shared/plugin-capabilities.ts` | — | 插件能力 |
| `shared/template-scaffold.ts` | `ensureTemplateScaffold` | 全新安装的「元文件」模板自举（只补缺失、不覆盖） |
| `shared/template-scaffold-assets.generated.ts` | `TEMPLATE_SCAFFOLD_FILES` | 内置模板资源（自动生成，勿手改） |

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

### 视图
| 文件 | 类 | 职责 |
|------|-----|------|
| `ui/co-writing-view.ts` | `CoWritingView` | 协同写作主视图（Obsidian ItemView） |

> v8.14 技术审计批 D：`ui/action-panel.ts`（零引用死组件）已删除。

### 主要 Modal
| 文件 | 功能 |
|------|------|
| `ui/create-project-modal.ts` | 创建项目 |
| `ui/auto-writer-modal.ts` | 自动写作 |
| `ui/batch-import-modal.ts` | 批量导入 |
| `ui/batch-create-modal.ts` | 批量创建 |
| `ui/batch-chapters-modal.ts` | 批量章节 |
| `ui/continue-chapters-modal.ts` | 续写章节 |
| `ui/chapter-outline-tree-modal.ts` | 章节大纲树 |
| `ui/chapter-settlement-modal.ts` | 章节结算 |
| `ui/chapter-version-modal.ts` | 章节版本 |
| `ui/co-write-floating-panel.ts` | 协同写作浮动面板 |
| `ui/context-injector-modal.ts` | 上下文注入 |
| `ui/cross-volume-state-modal.ts` | 跨卷状态 |
| `ui/diagnose-writer-modal.ts` | 写作诊断 |
| `ui/ai-builder-modal.ts` | AI 构建器 |
| `ui/add-fanfic-setting-modal.ts` | 同人设置 |
| `ui/appearance-settings.ts` | 外观设置 |
| `ui/backup-yuan-modal.ts` | 备份还原 |
| `ui/changelog-modal.ts` | 更新日志 |
| `ui/quality-dashboard-modal.ts` | 章节质量仪表盘（六维评分 + 时间范围筛选 + 维度钻取 + 导出） |

### 协同写作 UI（cowrite/）
| 文件 | 功能 |
|------|------|
| `ui/cowrite/cowrite-mappers.ts` | 状态映射 |
| `ui/cowrite/history-modal.ts` | 建议历史 |
| `ui/cowrite/iterate-instruction-modal.ts` | 迭代指令 |
| `ui/cowrite/live-analysis-controller.ts` | 实时分析控制 |
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
| `tests/unit/` | ~70 | 单元测试（engine/、services/、shared/、ui/） |
| `tests/integration/` | 7 | 集成测试（项目创建、章节生成、知识库、题材分类、版本管理、世界观生成、工作流） |
| `tests/e2e/` | 3 | E2E 测试（插件加载、项目创建、项目卡片交互） |
| `tests/__mocks__/` | 1 | Obsidian Mock |
| `tests/setup.ts` | 1 | 测试设置 |

---

## 九、构建与脚本（scripts/）

| 文件 | 功能 |
|------|------|
| `scripts/build.js` | esbuild 构建脚本（main + 3 Worker 入口） |
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
| `.github/workflows/release.yml` | 推送 `v*` tag 自动创建 GitHub Release（三资产） |
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
| 添加新命令 | `core/command-registry.ts` + `main.ts` |
| 添加新的设置项 | `core/settings-service.ts` + `ui/appearance-settings.ts` |
| 修改拆解引擎配置（增强级别/维度/向量/LLM/性能） | `services/deconstruction-scheduler.ts`（`DeconstructionEngineSettings`） + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + `ui/settings-tab.ts` / `ui/mini-settings-modal.ts`（`renderDeconstructionSection` / `renderDeconstructionTab`） |
| 修改 Worker 相关 | `services/worker-manager.ts` + `services/worker-protocol.ts` |

### 按问题查找

| 遇到的问题 | 检查文件 |
|------------|----------|
| AI 调用失败 | `engine/ai-engine.ts` |
| 数据读取/写入失败 | `engine/repository/base-markdown-repository.ts` |
| 性能问题 | `engine/performance/performance-monitor.ts` |
| 缓存问题 | `engine/cache/multi-layer-cache.ts` |
| 引擎找不到 | `engine/engine-registry.ts` + `.engine-registry-whitelist.json` |
| 样式问题 | `styles.css` + `design-tokens.css` |
| 测试失败 | `tests/unit/` 对应目录 |
| 拆解质量评分异常 / 交叉验证规则不生效 | `engine/quality-scorer.ts` + `services/deconstruction-scheduler.ts` |
| 拆解引擎设置不生效 / 维度缺失 / 并发不对 / 全文分块未触发 | `services/deconstruction-scheduler.ts`（`addTask` / `breakdownDimensionWithSegments` / `getSegmentedBreakdownConfig`） + `services/scheduler-segment-integration.ts` + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + 设置面板「🧬 拆解引擎」tab |
