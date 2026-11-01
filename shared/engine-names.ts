/**
 * 引擎名称常量 — 注册表的跨层契约
 *
 * 为什么放在 shared 层：core/ui/engine 都需要按 key 取引擎实例，若常量定义在
 * engine/engine-registry.ts，则 core/command-registry、engine/ai-engine、
 * engine/co-writer-engine 等都会被拉出一条指向 engine-registry 的运行时依赖，
 * 与「engine-registry → 具体引擎」的构造依赖闭合成循环。
 * 常量本身无任何 import，下沉到 shared 后不再产生分层违规与循环。
 */
export const ENGINE_NAMES = {
    CACHE_MANAGER: 'cacheManager',
    INTERNAL_REGISTRY: 'internalRegistry',
    CRYPTO_SERVICE: 'cryptoService',
    PROVIDER_MANAGER: 'providerManager',
    THEME_MANAGER: 'themeManager',
    SETTINGS_SERVICE: 'settingsService',
    CONTEXT_MANAGER: 'contextManager',
    FORESHADOW_MANAGER: 'foreshadowManager',
    REVIEW_AGENT: 'reviewAgent',
    COMMAND_REGISTRY: 'commandRegistry',
    KNOWLEDGE_TAG_MANAGER: 'knowledgeTagManager',
    KNOWLEDGE_BASE_MANAGER: 'knowledgeBaseManager',
    KNOWLEDGE_VECTOR_STORE: 'knowledgeVectorStore',
    VECTOR_ENHANCER: 'vectorEnhancer',
    DECONSTRUCTION_SCHEDULER: 'deconstructionScheduler',
    HEAVY_TASK_WORKER_MANAGER: 'heavyTaskWorkerManager',
    BATCH_IMPORT_MANAGER: 'batchImportManager',
    WRITING_PROFILE_MANAGER: 'writingProfileManager',
    KNOWLEDGE_INJECTOR: 'knowledgeInjector',
    CHARACTER_CONSISTENCY_CHECKER: 'characterConsistencyChecker',
    AI_ENGINE: 'aiEngine',
    CO_WRITER_ENGINE: 'coWriterEngine',
    CO_WRITING_SESSION_STORE: 'coWritingSessionStore',
    ANALYSIS_REPORT_ENGINE: 'analysisReportEngine',
    CHAPTER_SNAPSHOT_BUILDER: 'chapterSnapshotBuilder',
    SCENE_GENERATION_LOOP: 'sceneGenerationLoop',
    QUALITY_GATE: 'qualityGate',
    GENERATION_CHECKPOINT_STORE: 'generationCheckpointStore',
    PROMPT_CACHE: 'promptCache',
    SETTLEMENT_ENGINE: 'settlementEngine',
    CHARACTER_GENERATOR: 'characterGenerator',
    WORLDVIEW_CACHE_SERVICE: 'worldviewCacheService',
    UPDATE_CHECKER: 'updateChecker',
    TEMPLATE_SERVICE: 'templateService',
    CHAPTER_VERSION_SERVICE: 'chapterVersionService',
    TEMPLATE_MANAGER: 'templateManager',
    CHARACTER_REPOSITORY: 'characterRepository',
    CHAPTER_REPOSITORY: 'chapterRepository',
    PROJECT_REPOSITORY: 'projectRepository',
    FACTION_REPOSITORY: 'factionRepository',
    LOCATION_REPOSITORY: 'locationRepository',
    ITEM_REPOSITORY: 'itemRepository',
    /** 每日/周/月字数产出台账（桌面宠物与统计弹窗的数据源） */
    WRITING_STATS: 'writingStats',
} as const;
