export { ForeshadowManager, getForeshadowWarnings } from './foreshadow-manager';
export type { ForeshadowItem, ForeshadowWarning } from './foreshadow-manager';

export { KnowledgeBaseManager } from './knowledge-base-manager';
export type { BookBasicInfo } from './knowledge-base-manager';

export { DeconstructionScheduler } from './deconstruction-scheduler';
export type { BreakdownProgress, BreakdownTask, BreakdownDimension, DeconstructionQualityLevel, DimensionQualityScore } from './deconstruction-scheduler';

export { ChapterRecognizer, recognizeChapters, getChapterText } from './chapter-recognizer';
export type { ChapterInfo, BookRecognitionResult } from './chapter-recognizer';

export { BatchImportManager } from './batch-import-manager';
export type {
    ImportTaskStatus,
    ImportSource,
    ImportBookPreview,
    ImportTask,
    ImportHistoryItem,
    ImportBatchSettings,
    ImportPreset,
    BatchImportProgress,
} from './batch-import-manager';

export { TemplateService } from './template-service';
export type { TemplateVariables } from './template-service';

export { SettlementService } from './settlement-service';
export type { SettlementContext, SettlementResult } from './settlement-service';

export { WorldviewCacheService } from './worldview-cache-service';
export type { CacheEntry, CacheStats, WorldviewCacheOptions } from './worldview-cache-service';

export { ChapterVersionService } from './chapter-version-service';
export type { SaveVersionOptions } from './chapter-version-service';

export { PerformanceMonitor, performanceMonitor } from './performance-monitor';
export type {
    PerformanceMark,
    PerformanceCategory,
    PerformanceLogEntry,
    PerformanceStats,
    SlowOperation,
    PerformanceReport,
    PerformanceMonitorOptions,
} from './performance-monitor';

export { PromptManager, PROMPT_CATEGORY_LABELS } from './prompt-manager';
export type { PromptManagerDeps } from './prompt-manager';
export * from './prompt-manager-types';

export { UpdateChecker, compareVersions, isMajorUpdate, DEFAULT_UPDATE_CONFIG } from './update-checker';
export type {
    UpdateSourceType,
    VersionInfo,
    UpdateCheckConfig,
    UpdateCheckResult,
} from './update-checker';

export { WorkerManager } from './worker-manager';
export type {
    WorkerMessageType,
    WorkerMessage,
    WorkerTaskDefinition,
    TaskProgressPayload,
    TaskCompletePayload,
    TaskStartPayload,
    WorkerErrorPayload,
    FallbackHandler,
    WorkerManagerOptions,
    TaskExecutionResult,
    WorkerPoolStats,
} from './worker-protocol';
export {
    registerTaskHandler,
    startWorkerRuntime,
    getRegisteredTaskTypes,
    createInlineWorkerCode,
    createInlineWorker,
    createWorkerFromHandlers,
} from './worker-runtime';
export type { TaskHandlerContext, TaskHandler } from './worker-runtime';
