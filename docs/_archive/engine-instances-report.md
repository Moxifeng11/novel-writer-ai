---
⚠️  **文档已过期 · 仅供历史参考** ⚠️

**过期原因**：本报告数据基于 2026-07-13 扫描（325个.ts文件），与当前代码库状态（458个.ts文件）存在显著差异。
**当前状态**：EngineRegistry 实际注册 30 个类（非报告中声称的 36 个），详细数据请以最新代码扫描为准。
**替代参考**：.trae/specs/project-audit-2026q3/spec.md
**归档时间**：2026-07-15
---

# 引擎实例化扫描报告

> 本报告由 `scripts/scan-engine-instances.mjs` 自动生成。

## 总览

| 指标 | 值 |
|------|-----|
| 扫描时间 | 2026-07-13T05:40:23.542Z |
| 项目根目录 | D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai |
| 扫描 .ts 文件数 | 325 |
| 总实例化数 | 97 |
| 涉及类名数 | 65 |
| 应该单例 (singleton) | 36 |
| 可能多实例 (transient) | 1 |
| 不确定 (unknown) | 28 |
| 已注册到 EngineRegistry | 23 |
| 未注册 | 42 |
| 多实例类数 (totalCount > 1) | 8 |
| 多实例单例问题数 | 6 |
| 已注册但仍被直接实例化（绕过 registry） | 2 |

## 分类规则

- **singleton**（应该单例）：类名以 Engine/Manager/Service/Store 结尾
- **transient**（可能允许多实例）：类名以 Result/DTO/Builder/Config 结尾
- **unknown**（不确定）：其他情况

## 已注册到 EngineRegistry 的类

来源：`engine/engine-registry.ts` 中所有 `new Xxx(` 调用

- `StyleLearner`
- `CharacterRepository`
- `ChapterRepository`
- `FactionRepository`
- `LocationRepository`
- `ItemRepository`
- `PluginCacheManager`
- `InternalRegistry`
- `CryptoService`
- `ProviderManager`
- `ThemeManager`
- `SettingsService`
- `ProjectRepository`
- `ContextManager`
- `ForeshadowManager`
- `ReviewAgent`
- `WorldviewCacheService`
- `TemplateService`
- `ChapterVersionService`
- `TemplateManager`
- `CommandRegistry`
- `KnowledgeTagManager`
- `KnowledgeBaseManager`
- `KnowledgeVectorStore`
- `VectorEnhancer`
- `DeconstructionScheduler`
- `BatchImportManager`
- `WritingProfileManager`
- `KnowledgeInjector`
- `CharacterConsistencyChecker`
- `AIEngine`
- `CoWriterEngine`
- `AnalysisReportEngine`
- `SettlementEngine`
- `CharacterGenerator`
- `UpdateChecker`

## 实例化详情（按实例化次数降序）

### AbortController

- **实例化次数**: 14
- **文件数**: 9
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/ai-api-client.ts | 230 | `ac = new AbortController();` | `(none)` |
| engine/ai-api-client.ts | 482 | `ac = new AbortController();` | `(none)` |
| engine/ai-api-client.ts | 802 | `ac = new AbortController();` | `(none)` |
| engine/co-writer/parallel-suggestions.ts | 145 | `this.abortController = new AbortController();` | `(none)` |
| engine/co-writer/parallel-suggestions.ts | 198 | `const attemptController = new AbortController();` | `(none)` |
| engine/co-writer-engine.ts | 2624 | `const controller = new AbortController();` | `(none)` |
| services/batch-import-manager.ts | 342 | `const controller = new AbortController();` | `(none)` |
| services/deconstruction-scheduler.ts | 324 | `const controller = new AbortController();` | `(none)` |
| ui/co-writing-view.ts | 646 | `this.suggestAbortController = new AbortController();` | `(none)` |
| ui/co-writing-view.ts | 1341 | `this.metricsAbortController = new AbortController();` | `(none)` |
| ui/co-writing-view.ts | 1496 | `this.suggestAbortController = new AbortController();` | `(none)` |
| ui/fingerprint-library-modal.ts | 243 | `this.abortController = new AbortController();` | `(none)` |
| ui/generate-character-modal.ts | 176 | `this._abortController = new AbortController();` | `(none)` |
| ui/unified-entity-generate-modal.ts | 604 | `this._abortController = new AbortController();` | `(none)` |

### LocalVectorStore

- **实例化次数**: 8
- **文件数**: 6
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 511 | `this.vectorStore = new LocalVectorStore(this.app, 'project', embeddingClient, project);` | `this.app, 'project', embeddingClient, project` |
| ui/mini-settings-modal.ts | 728 | `const vectorStore = new LocalVectorStore(this.app, scope, embeddingClient, activeProject \|\| undefined);` | `this.app, scope, embeddingClient, activeProject \|\| undefined` |
| ui/novel-analysis-modal.ts | 232 | `const vectorStore = new LocalVectorStore(this.app, 'project', embeddingClient, projectName);` | `this.app, 'project', embeddingClient, projectName` |
| ui/refill-modal.ts | 657 | `const vectorStore = new LocalVectorStore(this.app, vectorScope, embeddingClient);` | `this.app, vectorScope, embeddingClient` |
| ui/settings-tab.ts | 966 | `const vectorStore = new LocalVectorStore(this.app, 'global', embeddingProvider);` | `this.app, 'global', embeddingProvider` |
| ui/settings-tab.ts | 1052 | `const vectorStore = new LocalVectorStore(this.app, 'global', embeddingProvider);` | `this.app, 'global', embeddingProvider` |
| ui/settings-tab.ts | 1090 | `const vectorStore = new LocalVectorStore(this.app, 'project', embeddingProvider, activeProject);` | `this.app, 'project', embeddingProvider, activeProject` |
| ui/views/writing-fingerprint-view.ts | 111 | `this.vectorStore = new LocalVectorStore(this.app, project ? 'project' : 'global', embeddingClient, project \|\| 'default` | `this.app, project ? 'project' : 'global', embeddingClient, project \|\| 'default` |

### AdaptiveDebounceManager

- **实例化次数**: 6
- **文件数**: 5
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| main.ts | 835 | `private _debounceManager = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |
| ui/co-writing-view.ts | 120 | `private ghostDebounceManager = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |
| ui/co-writing-view.ts | 121 | `private autoSaveDebouncer = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |
| ui/cowrite/live-analysis-controller.ts | 19 | `private debounceManager = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |
| ui/monitor-panel-b.ts | 91 | `private debounceManager = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |
| ui/polish-editor.ts | 101 | `private debounceManager = new AdaptiveDebounceManager({ debug: false });` | `{ debug: false }` |

### EntityStateManager

- **实例化次数**: 3
- **文件数**: 3
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 480 | `this.entityStateManager = new EntityStateManager({` | `{` |
| main.ts | 870 | `const manager = new EntityStateManager({` | `{` |
| ui/full-writer/entity-state-controller.ts | 56 | `const manager = new EntityStateManager({` | `{` |

### StyleVectorStore

- **实例化次数**: 3
- **文件数**: 2
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/knowledge-to-fingerprint-converter.ts | 97 | `const tempStore = new StyleVectorStore(` | `(none)` |
| engine/style-fingerprint-library.ts | 127 | `this.styleVectorStoreGlobal = new StyleVectorStore(` | `(none)` |
| engine/style-fingerprint-library.ts | 139 | `this.styleVectorStoreProject = new StyleVectorStore(` | `(none)` |

### ChapterVersionService

- **实例化次数**: 2
- **文件数**: 2
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 929 | `const chapterVersionService = new ChapterVersionService(plugin.app);` | `plugin.app` |
| ui/chapter-version-modal.ts | 58 | `?? new ChapterVersionService(app);` | `app` |

### KnowledgeVectorStore

- **实例化次数**: 2
- **文件数**: 2
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 540 | `this.knowledgeVectorStore = new KnowledgeVectorStore(this.app, kbEmbeddingClient);` | `this.app, kbEmbeddingClient` |
| engine/engine-registry.ts | 1011 | `const knowledgeVectorStore = new KnowledgeVectorStore(plugin.app, embeddingProvider);` | `plugin.app, embeddingProvider` |

### RhythmAnalyzer

- **实例化次数**: 2
- **文件数**: 2
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/polish-editor.ts | 302 | `const analyzer = new RhythmAnalyzer({` | `{` |
| ui/services/co-write-facade.ts | 358 | `return new RhythmAnalyzer({` | `{` |

### AIEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1067 | `this.registerLazy(ENGINE_NAMES.AI_ENGINE, () => new AIEngine(plugin));` | `plugin` |

### AnalysisReportEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1074 | `() => new AnalysisReportEngine(` | `(none)` |

### BatchEntityGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/ai-engine.ts | 69 | `this.batchEntityGen = new BatchEntityGenerator(plugin, this.apiClient, this.notifier);` | `plugin, this.apiClient, this.notifier` |

### BatchImportManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1031 | `const batchImportManager = new BatchImportManager(` | `(none)` |

### ChapterStateManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 146 | `this.chapterStateManager = new ChapterStateManager(this.app);` | `this.app` |

### CharacterConsistencyChecker

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1060 | `const characterConsistencyChecker = new CharacterConsistencyChecker(vectorEnhancer);` | `vectorEnhancer` |

### CharacterGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1091 | `() => new CharacterGenerator(plugin, new AIApiClient(plugin), {` | `plugin, new AIApiClient(plugin` |

### ContextLoaderController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 313 | `this.contextLoaderController = new ContextLoaderController({` | `{` |

### ContextManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 908 | `const contextManager = new ContextManager({ plugin, engineRegistry: this });` | `{ plugin, engineRegistry: this }` |

### CoverPickerController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 181 | `this.coverPickerController = new CoverPickerController(this.app);` | `this.app` |

### CoWriterEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1070 | `() => new CoWriterEngine(plugin.app, plugin.aiEngine, plugin.ctxManager, this)` | `plugin.app, plugin.aiEngine, plugin.ctxManager, this` |

### CryptoService

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 875 | `const cryptoService = new CryptoService(plugin.app);` | `plugin.app` |

### EmotionCurveAnalyzer

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/services/co-write-facade.ts | 350 | `return new EmotionCurveAnalyzer({` | `{` |

### EndingTractionEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/services/co-write-facade.ts | 366 | `const engine = new EndingTractionEngine({` | `{` |

### EntityContextEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/entity-context-engine.ts | 1056 | `globalEntityContextEngine = new EntityContextEngine();` | `(none)` |

### EntityGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/ai-engine.ts | 68 | `this.entityGen = new EntityGenerator(plugin, this.apiClient, this.notifier);` | `plugin, this.apiClient, this.notifier` |

### EntityStateController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 280 | `this.entityStateController = new EntityStateController({` | `{` |

### FloatWorkspaceManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| main.ts | 491 | `this.workspaceManager = new FloatWorkspaceManager(this);` | `this` |

### ForeshadowManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 911 | `const foreshadowManager = new ForeshadowManager(plugin);` | `plugin` |

### InterventionController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 245 | `this.interventionController = new InterventionController(` | `(none)` |

### KnowledgeBaseManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 969 | `const knowledgeBaseManager = new KnowledgeBaseManager(plugin.app);` | `plugin.app` |

### KnowledgeTagManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 965 | `const knowledgeTagManager = new KnowledgeTagManager(plugin.app);` | `plugin.app` |

### LiveAnalysisController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/co-writing-view.ts | 160 | `this.liveAnalysis = new LiveAnalysisController(this);` | `this` |

### NovelAnalyzer

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/novel-analysis-modal.ts | 26 | `this.analyzer = new NovelAnalyzer();` | `(none)` |

### OutlineGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/ai-engine.ts | 66 | `this.outlineGen = new OutlineGenerator(plugin, this.apiClient, this.notifier);` | `plugin, this.apiClient, this.notifier` |

### OutlineTreeController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 180 | `this.outlineTreeController = new OutlineTreeController(this.app, () => this.project);` | `this.app, (` |

### ParallelSuggestionGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 951 | `const generator = new ParallelSuggestionGenerator(factory, directions, {` | `factory, directions, {` |

### PlotCompletionEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/monitor-panel-b.ts | 195 | `this.completionEngine = new PlotCompletionEngine();` | `(none)` |

### PlotDivergenceEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/monitor-panel-b.ts | 196 | `this.divergenceEngine = new PlotDivergenceEngine();` | `(none)` |

### PluginCacheManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 865 | `const cacheManager = new PluginCacheManager(plugin.app);` | `plugin.app` |

### PreloadManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/cache/preload-manager.ts | 597 | `export const preloadManager = new PreloadManager();` | `(none)` |

### ProjectSelectorController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 231 | `this.projectSelectorController = new ProjectSelectorController(` | `(none)` |

### PromptBuilder

- **实例化次数**: 1
- **文件数**: 1
- **分类**: transient
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 522 | `this.promptBuilder = new PromptBuilder(` | `(none)` |

### PromptManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| main.ts | 402 | `this.promptManager = new PromptManager({` | `{` |

### ProviderManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 878 | `const providerManager = new ProviderManager({` | `{` |

### RulesService

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| services/rules-service.ts | 24 | `RulesService.instance = new RulesService(app);` | `app` |

### SceneOutlineController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer/step-render-controller.ts | 250 | `const sceneController = new SceneOutlineController({` | `{` |

### SentenceDiversityEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/co-writer-engine.ts | 174 | `this.diversityEngine = new SentenceDiversityEngine();` | `(none)` |

### SettingLibController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 182 | `this.settingLibController = new SettingLibController(` | `(none)` |

### SettingsService

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 890 | `const settingsService = new SettingsService({` | `{` |

### SettlementEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1085 | `() => new SettlementEngine(plugin.app, {` | `plugin.app, {` |

### StatusBarController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 305 | `this.statusBarController = new StatusBarController({` | `{` |

### StepModalController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/step-runner.ts | 78 | `this.modalController = new StepModalController(app, {` | `app, {` |

### StepRenderController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 188 | `this.stepRenderController = new StepRenderController({` | `{` |

### SuggestionHistoryStore

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/co-writing-view.ts | 161 | `this.historyStore = new SuggestionHistoryStore(this);` | `this` |

### TabController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 263 | `this.tabController = new TabController({` | `{` |

### TemplateManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 933 | `const templateManager = new TemplateManager(plugin.app);` | `plugin.app` |

### TemplateService

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 925 | `const templateService = new TemplateService(plugin.app);` | `plugin.app` |

### ThemeManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 887 | `const themeManager = new ThemeManager(() => plugin.settings);` | `(` |

### TitleBarController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 291 | `this.titleBarController = new TitleBarController({` | `{` |

### UpdateChecker

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1100 | `const updateChecker = new UpdateChecker(` | `(none)` |

### WizardChecker

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 179 | `this.wizardChecker = new WizardChecker(this.app);` | `this.app` |

### WizardController

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/full-writer-view.ts | 224 | `this.wizardController = new WizardController(` | `(none)` |

### WorldviewCacheService

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 917 | `const worldviewCacheService = new WorldviewCacheService(` | `(none)` |

### WorldviewGenerator

- **实例化次数**: 1
- **文件数**: 1
- **分类**: unknown
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/ai-engine.ts | 65 | `this.worldviewGen = new WorldviewGenerator(plugin, this.apiClient, this.notifier);` | `plugin, this.apiClient, this.notifier` |

### WritingProfileManager

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 是

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| engine/engine-registry.ts | 1047 | `const writingProfileManager = new WritingProfileManager(plugin.app);` | `plugin.app` |

### WritingQualityEngine

- **实例化次数**: 1
- **文件数**: 1
- **分类**: singleton
- **已注册到 EngineRegistry**: 否

| 文件 | 行号 | 代码 | 参数（粗略） |
|------|------|------|--------------|
| ui/monitor-panel-b.ts | 197 | `this.qualityEngine = new WritingQualityEngine();` | `(none)` |
