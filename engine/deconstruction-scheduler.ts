/**
 * deconstruction-scheduler.ts — 小说拆解调度器
 *
 * 功能：管理多本书籍的拆解任务队列，支持并发控制、进度回调、暂停/取消/恢复
 * 拆解维度：风格、节奏、技巧、结构、人设、伏笔
 *
 * 本次加固主要变更（v4.10.1）：
 * - pause 取消：暂停任务时正确取消进行中的拆解，避免后台继续运行
 * - 看门狗：Watchdog 活性检测机制，防止任务假死
 * - destroy：完整的资源销毁机制，插件卸载时清理所有任务和定时器
 * - pending 暂停：待处理任务也支持暂停入队控制
 * - 进度 debounce：进度更新防抖，减少 UI 刷新频率和写放大
 * - Map 清理：任务完成/取消/失败后及时清理内部 Map，防止内存泄漏
 */

import { App, Notice } from 'obsidian';
import { KnowledgeBaseManager, type VectorStatus } from '@/services/knowledge-base-manager';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import { writeVaultText } from '@/shared/file-system-port';
import { VectorEnhancer } from './vector-enhancer';
import { LLMEnhancer, type LLMCaller, type LLMCallOptions } from './llm-enhancer';
import { resolveProviderSourceType } from '@/shared/model-source';
import {
    ALL_BREAKDOWN_DIMENSIONS,
    DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
    DIMENSION_LABELS,
    type BreakdownDimension,
    type DeconstructionEngineSettings,
    type DeconstructionQualityLevel,
} from '@/shared/deconstruction-settings';
import { StyleDeconstructor, StyleAnalysisResult } from './deconstructors/style-deconstructor';
import { RhythmDeconstructor, RhythmAnalysisResult } from './deconstructors/rhythm-deconstructor';
import { TechniqueDeconstructor, TechniqueAnalysisResult } from './deconstructors/technique-deconstructor';
import { ForeshadowDeconstructor, ForeshadowAnalysisResult } from './deconstructors/foreshadow-deconstructor';
import { StructureDeconstructor, StructureAnalysisResult } from './deconstructors/structure-deconstructor';
import { CharacterDeconstructor, CharacterAnalysisResult } from './deconstructors/character-deconstructor';
import { CommercialDeconstructor, CommercialAnalysisResult } from './deconstructors/commercial-deconstructor';
import { ReadabilityDeconstructor, ReadabilityAnalysisResult } from './deconstructors/readability-deconstructor';
import { DeconstructionWorkerManager } from './deconstruction-worker-manager';
import { SchedulerSegmentIntegration } from './scheduler-segment-integration';
import type { AnalysisResult } from './incremental-result-aggregator';
import { SegmentAwareBreakdown } from './segment-aware-breakdown';
import { countTotalChars } from './text-segmenter';
import { ProgressEmitter } from '@/shared/progress-emitter';
import { getDegradationNotifier } from '@/shared/degradation-notifier';
import { resolvePluginWorkerUrl } from '@/shared/plugin-worker-url';
import { TimeEstimator, refineEstimate } from '@/shared/time-estimator';
import { AdaptiveDebounceManager } from '@/shared/adaptive-debounce-manager';
import { QualityScorer, QualityScoringInput } from './quality-scorer';
import { yieldToUI } from '@/shared/yield';
import { createLogger } from '@/shared/logger';
import { chunkOriginalText } from '@/services/knowledge-original-chunker';

const log = createLogger('DeconstructionScheduler');
import {
    kbBookBreakdownLogFile,
    kbBookDir,
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookCommercialAnalysisFile,
    kbBookReadabilityAnalysisFile,
} from '@/shared/paths';

// 维度类型与默认配置已下沉到 shared/deconstruction-settings.ts（core 生成 DEFAULT_SETTINGS 需要），
// 此处仅再导出以兼容既有 ui / main 引用。
export type { BreakdownDimension, DeconstructionEngineSettings, DeconstructionQualityLevel };
export { ALL_BREAKDOWN_DIMENSIONS, DIMENSION_LABELS, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };

/**
 * 拆解维度质量评分。
 */
export interface DimensionQualityScore {
    completeness: number;
    consistency: number;
    confidence: number;
    overall: number;
    level: 'high' | 'medium' | 'low';
    usedLevel: DeconstructionQualityLevel;
}

/**
 * 拆解任务状态。
 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * 拆解进度。
 */
export interface BreakdownProgress {
    taskId: string;
    bookId: string;
    bookName: string;
    status: TaskStatus;
    totalProgress: number;
    currentDimension?: BreakdownDimension;
    dimensionProgress?: number;
    phase?: string;
    message?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
    elapsed?: number;
    eta?: number;
    etaMin?: number;
    etaMax?: number;
    currentStep?: string;
}

/**
 * 拆解任务。
 */
export interface BreakdownTask {
    id: string;
    bookId: string;
    bookName: string;
    sourceText: string;
    dimensions: BreakdownDimension[];
    status: TaskStatus;
    progress: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    /** 向量化状态：拆解完成不等于检索可用（A5） */
    vectorStatus?: VectorStatus;
    /** 向量化失败原因 */
    vectorError?: string;
    preprocessedText?: { cleaned: string; segments: string[]; wordCount: number; paragraphCount: number };
}

/**
 * 拆解完成提示（A5）：向量化失败时必须如实告知，并指路到知识库详情重试，
 * 不能无条件弹「拆解完成」让用户以为检索可用。
 * @param bookName - 书名
 * @param vector - 向量
 * @returns 文本结果
 */
export function buildBreakdownFinishNotice(
    bookName: string,
    vector: { status?: VectorStatus; error?: string },
): string {
    if (vector.status === 'failed') {
        const reason = vector.error ? `（${vector.error}）` : '';
        return `《${bookName}》拆解完成，但向量化失败${reason}，可在知识库详情重试向量化。`;
    }
    return `《${bookName}》拆解完成。可在知识库详情页点击"转为写作指纹"将结果导入指纹库。`;
}

/**
 * 调度器选项。
 */
export interface SchedulerOptions {
    concurrency?: number;
}

const DIMENSION_OPERATION_TYPES: Record<BreakdownDimension, string> = {
    style: 'deconstruction:style',
    rhythm: 'deconstruction:rhythm',
    technique: 'deconstruction:technique',
    structure: 'deconstruction:structure',
    character: 'deconstruction:character',
    foreshadow: 'deconstruction:foreshadow',
    commercial: 'deconstruction:commercial',
    readability: 'deconstruction:readability',
};

const DIMENSION_FILE_MAP: Record<BreakdownDimension, (bookName: string, baseDir?: string) => string> = {
    style: kbBookStyleFingerprintFile,
    rhythm: kbBookRhythmAnalysisFile,
    technique: kbBookWritingTechniquesFile,
    structure: kbBookStructureBreakdownFile,
    character: kbBookCharacterExtractionFile,
    foreshadow: kbBookForeshadowDBFile,
    commercial: kbBookCommercialAnalysisFile,
    readability: kbBookReadabilityAnalysisFile,
};

const DEFAULT_DIMENSIONS: BreakdownDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];

function generateTaskId(): string {
    return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 拆解调度设置。
 */
export interface DeconstructionSchedulerSettings {
    vectorEnhancedDeconstruction?: boolean;
    enableSegmentedBreakdown?: boolean;
    segmentedBreakdownThreshold?: number;
    segmentedBreakdownMaxWords?: number;
    qualityLevel?: DeconstructionQualityLevel;
    deconstructionEngine?: DeconstructionEngineSettings;
    /** 以下字段由插件 settings 透传，用于把拆解 LLM 路由到本地 provider */
    customProviders?: Array<{ id: string; endpoint: string; models?: string[]; sourceType?: 'cloud' | 'local' }>;
    providerKeys?: Record<string, string>;
}

/**
 * 拆解调度器：任务队列、并发、重试与进度上报。
 */
export class DeconstructionScheduler {
    private app: App;
    private knowledgeBaseManager: KnowledgeBaseManager;
    private baseDir?: string;
    private options: Required<SchedulerOptions>;
    private tasks: Map<string, BreakdownTask> = new Map();
    private queue: string[] = [];
    private activeCount = 0;
    private fs: FileSystemPort | null = null;

    private progressCallbacks = new Set<(progress: BreakdownProgress) => void>();
    private completeCallbacks = new Set<(task: BreakdownTask) => void>();
    private failedCallbacks = new Set<(task: BreakdownTask) => void>();

    private abortControllers = new Map<string, AbortController>();
    private pauseResolvers = new Map<string, () => void>();

    private vectorEnhancer?: VectorEnhancer;
    private llmEnhancer?: LLMEnhancer;
    private llmCallerGetter?: () => LLMCaller | undefined;
    private settingsGetter?: () => DeconstructionSchedulerSettings;
    /** 由 EngineRegistry 注入：返回当前共享 embedding 模型名（避免 services→engine 依赖） */
    private vectorModelResolver?: () => string | undefined;

    private styleDeconstructor?: StyleDeconstructor;
    private rhythmDeconstructor?: RhythmDeconstructor;
    private techniqueDeconstructor?: TechniqueDeconstructor;
    private foreshadowDeconstructor?: ForeshadowDeconstructor;
    private structureDeconstructor?: StructureDeconstructor;
    private characterDeconstructor?: CharacterDeconstructor;
    private commercialDeconstructor?: CommercialDeconstructor;
    private readabilityDeconstructor?: ReadabilityDeconstructor;

    private workerManager: DeconstructionWorkerManager;

    private taskEmitters = new Map<string, ProgressEmitter>();
    private timeEstimator: TimeEstimator;
    private dimensionStartTimes = new Map<string, number>();
    private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

    private watchdogTimers = new Map<string, ReturnType<typeof setInterval>>();
    private lastSeenAlive = new Map<string, number>();
    private static readonly WATCHDOG_INTERVAL = 30000; // 30秒检查一次
    private static readonly WATCHDOG_TIMEOUT = 120000; // 120秒无心跳判定为中断

    private progressDebounceManager: AdaptiveDebounceManager;
    private static readonly PROGRESS_DEBOUNCE_DELAY = 500; // 进度落盘防抖延迟（ms）

    private segmentedBreakdown: SegmentAwareBreakdown;
    private segmentIntegration: SchedulerSegmentIntegration;

    private qualityScorer: QualityScorer;
    private pendingWrites: Map<string, string> = new Map();

    private dimensionCache: Map<string, { hash: string; result: unknown }> = new Map();

    constructor(
        app: App,
        knowledgeBaseManager: KnowledgeBaseManager,
        options?: SchedulerOptions & { baseDir?: string },
        private vectorStore?: { addBookSamples?(bookId: string, bookName: string, samples: unknown[]): Promise<unknown>; replaceBookSamples?(bookId: string, bookName: string, samples: unknown[]): Promise<unknown> },
        vectorEnhancer?: VectorEnhancer,
        settingsGetter?: () => DeconstructionSchedulerSettings
    ) {
        this.app = app;
        this.knowledgeBaseManager = knowledgeBaseManager;
        this.baseDir = options?.baseDir;
        this.options = {
            concurrency: options?.concurrency ?? 1,
        };
        this.vectorEnhancer = vectorEnhancer;
        this.settingsGetter = settingsGetter;
        this.timeEstimator = new TimeEstimator();
        this.timeEstimator.loadHistory();
        this.initDeconstructors();
        this.workerManager = new DeconstructionWorkerManager(vectorEnhancer, {
            maxWorkers: 2,
            useWorker: true,
            workerUrl: resolvePluginWorkerUrl(app, 'deconstruction-worker.js') ?? undefined,
        });
        this.segmentIntegration = new SchedulerSegmentIntegration(this.workerManager);
        this.progressDebounceManager = new AdaptiveDebounceManager();
        this.segmentedBreakdown = new SegmentAwareBreakdown();
        this.qualityScorer = new QualityScorer();
    }

    private isSegmentedBreakdownEnabled(): boolean {
        if (!this.settingsGetter) return false;
        const settings = this.settingsGetter();
        if (settings.enableSegmentedBreakdown === false) return false;
        return true;
    }

    private getSegmentedBreakdownConfig(): { threshold: number; maxSegmentWords: number } {
        if (!this.settingsGetter) {
            return { threshold: 100000, maxSegmentWords: 50000 };
        }
        const settings = this.settingsGetter();
        return {
            threshold: settings.segmentedBreakdownThreshold ?? 100000,
            maxSegmentWords: settings.segmentedBreakdownMaxWords ?? 50000,
        };
    }

    private initDeconstructors(): void {
        this.styleDeconstructor = new StyleDeconstructor(this.vectorEnhancer);
        this.rhythmDeconstructor = new RhythmDeconstructor(this.vectorEnhancer);
        this.techniqueDeconstructor = new TechniqueDeconstructor(this.vectorEnhancer);
        this.foreshadowDeconstructor = new ForeshadowDeconstructor(this.vectorEnhancer);
        this.structureDeconstructor = new StructureDeconstructor(this.vectorEnhancer);
        this.characterDeconstructor = new CharacterDeconstructor(this.vectorEnhancer);
        this.commercialDeconstructor = new CommercialDeconstructor(this.vectorEnhancer);
        this.readabilityDeconstructor = new ReadabilityDeconstructor(this.vectorEnhancer);
        if (this.llmEnhancer) {
            this.styleDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.rhythmDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.characterDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.foreshadowDeconstructor.setLLMEnhancer(this.llmEnhancer);
        }
    }

    /**
     * 注入向量增强器（可传空解除）。
     *
     * @param vectorEnhancer - 参数
     */
    setVectorEnhancer(vectorEnhancer?: VectorEnhancer): void {
        this.vectorEnhancer = vectorEnhancer;
        this.initDeconstructors();
        this.workerManager.setVectorEnhancer(vectorEnhancer);
    }

    /**
     * 注入 LLM 增强器。
     *
     * @param llmEnhancer - LLM 增强器
     */
    setLlmEnhancer(llmEnhancer: LLMEnhancer): void {
        this.llmEnhancer = llmEnhancer;
        this.initDeconstructors();
        this.workerManager.setLlmEnhancer(llmEnhancer);
    }

    /**
     * 注入设置读取器。
     *
     * @param settingsGetter - 设置读取函数
     */
    setSettingsGetter(settingsGetter: () => DeconstructionSchedulerSettings): void {
        this.settingsGetter = settingsGetter;
    }

    /**
     * EngineRegistry 注入共享 embedding 模型名解析器。
     *
     * @param resolver - 解析器
     */
    setVectorModelResolver(resolver: () => string | undefined): void {
        this.vectorModelResolver = resolver;
    }

    /**
     * 设置 LLM 调用器获取器。AIEngine 是懒加载的，通过 getter 延迟获取避免在初始化阶段触发创建。
     *
     * @param getter - 读取函数
     */
    setLlmCaller(getter: () => LLMCaller | undefined): void {
        this.llmCallerGetter = getter;
    }

    /**
     * 设置拆解质量档位。
     *
     * @param level - 层级或档位
     */
    setQualityLevel(level: DeconstructionQualityLevel): void {
        if (!this.settingsGetter) return;
        const settings = this.settingsGetter();
        settings.qualityLevel = level;
        if (settings.deconstructionEngine) {
            settings.deconstructionEngine.defaultQualityLevel = level;
        }
    }

    private getQualityLevel(): DeconstructionQualityLevel {
        if (!this.settingsGetter) return 'standard';
        const settings = this.settingsGetter();
        if (settings.deconstructionEngine?.defaultQualityLevel) {
            return settings.deconstructionEngine.defaultQualityLevel;
        }
        return settings.qualityLevel ?? 'standard';
    }

    private isVectorEnhancementEnabled(): boolean {
        if (!this.vectorEnhancer) return false;
        if (!this.settingsGetter) return false;
        const settings = this.settingsGetter();
        if (settings.deconstructionEngine && typeof settings.deconstructionEngine.vectorEnabled === 'boolean') {
            return settings.deconstructionEngine.vectorEnabled;
        }
        return settings.vectorEnhancedDeconstruction ?? false;
    }

    /**
     * 读取拆解引擎设置。
     * @returns 设置对象
     */
    getDeconstructionEngineSettings(): DeconstructionEngineSettings {
        if (!this.settingsGetter) return { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
        const settings = this.settingsGetter();
        const userDe = settings.deconstructionEngine;
        if (!userDe) return { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
        return {
            ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
            ...userDe,
            enabledDimensions: Array.isArray(userDe.enabledDimensions) && userDe.enabledDimensions.length > 0
                ? [...userDe.enabledDimensions]
                : [...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.enabledDimensions],
        };
    }

    private getEnabledDimensions(): BreakdownDimension[] {
        return this.getDeconstructionEngineSettings().enabledDimensions;
    }

    private resolveDefaultDimensions(engineSettings: DeconstructionEngineSettings): BreakdownDimension[] {
        const base = engineSettings.enabledDimensions.length > 0
            ? [...engineSettings.enabledDimensions]
            : [...DEFAULT_DIMENSIONS];
        const set = new Set<BreakdownDimension>(base);
        if (engineSettings.includeCommercial && !set.has('commercial')) {
            set.add('commercial');
        }
        if (engineSettings.includeReadability && !set.has('readability')) {
            set.add('readability');
        }
        const ordered = ALL_BREAKDOWN_DIMENSIONS.filter(d => set.has(d));
        return ordered.length > 0 ? ordered : [...DEFAULT_DIMENSIONS];
    }

    private getTextSampleLimit(): number {
        const limit = this.getDeconstructionEngineSettings().textSampleLimit;
        return limit > 0 ? limit : DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.textSampleLimit;
    }

    private isSampleModeEnabled(): boolean {
        return this.getDeconstructionEngineSettings().sampleMode === true;
    }

    private getEffectiveSourceText(task: BreakdownTask): string {
        return task.preprocessedText?.cleaned ?? task.sourceText;
    }

    private preprocessText(text: string): { cleaned: string; segments: string[]; wordCount: number; paragraphCount: number } {
        const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        const segments = cleaned.split(/\n{2,}/).filter(s => s.trim().length > 0);
        const wordCount = cleaned.replace(/\s/g, '').length;
        const paragraphCount = segments.length;
        return { cleaned, segments, wordCount, paragraphCount };
    }

    /**
     * 最大并发数。
     * @returns 并发数
     */
    getMaxConcurrency(): number {
        const c = this.getDeconstructionEngineSettings().maxConcurrency;
        return c > 0 ? c : DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.maxConcurrency;
    }

    /**
     * 是否启用自动升级。
     * @returns 布尔值
     */
    isAutoUpgradeEnabled(): boolean {
        return this.getDeconstructionEngineSettings().enableAutoUpgrade;
    }

    /**
     * 是否包含商业性拆解。
     * @returns 布尔值
     */
    isCommercialIncluded(): boolean {
        return this.getDeconstructionEngineSettings().includeCommercial;
    }

    /**
     * 是否包含可读性拆解。
     * @returns 布尔值
     */
    isReadabilityIncluded(): boolean {
        return this.getDeconstructionEngineSettings().includeReadability;
    }

    /**
     * 是否启用 LLM 增强。
     * @returns 布尔值
     */
    isLlmEnhancementEnabled(): boolean {
        return this.getDeconstructionEngineSettings().llmEnabled;
    }

    /**
     * 当前向量模型名。
     * @returns 模型名
     */
    getVectorModel(): string {
        // 实际向量由共享 EmbeddingService 生成；拆解设置里的 vectorModel 可能是旧值。
        // 优先返回真实模型，避免 UI/缓存 key 与实际向量模型不一致。
        const sharedModel = this.vectorModelResolver?.();
        if (sharedModel) return sharedModel;
        return this.getDeconstructionEngineSettings().vectorModel || DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.vectorModel;
    }

    /**
     * 向量缓存条目上限。
     * @returns 数量
     */
    getVectorCacheSize(): number {
        const s = this.getDeconstructionEngineSettings().vectorCacheSize;
        return s > 0 ? s : DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.vectorCacheSize;
    }

    /**
     * 向量批大小。
     * @returns 数量
     */
    getVectorBatchSize(): number {
        const s = this.getDeconstructionEngineSettings().vectorBatchSize;
        return s > 0 ? s : DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.vectorBatchSize;
    }

    private async checkVectorAvailability(): Promise<{ available: boolean; reason?: string }> {
        if (!this.isVectorEnhancementEnabled()) {
            return { available: false, reason: '未启用向量增强' };
        }
        if (!this.vectorEnhancer) {
            return { available: false, reason: 'VectorEnhancer 未配置' };
        }
        try {
            const result = await this.vectorEnhancer.checkAvailability();
            return { available: result.available, reason: result.reason };
        } catch (e) {
            return { available: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /**
     * 添加任务。
     * @param bookId - 书籍 ID
     * @param sourceText - 参数值
     * @param dimensions - 参数值
     * @returns 文本结果
     */
    async addTask(
        bookId: string,
        sourceText: string,
        dimensions?: BreakdownDimension[]
    ): Promise<string> {
        const book = await this.knowledgeBaseManager.getBook(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        // 同一本书只允许一个在途任务：并发拆解会各自「读现有 → 逐条 embed → 覆盖」，
        // 后完成者会丢掉先完成者的样本，embedding 也会重复计费。
        const active = this.getActiveTasks().find(t => t.bookId === bookId);
        if (active) {
            log.info(`[DeconstructionScheduler] 《${book.name}》已有在途任务 ${active.id}，不重复创建`);
            return active.id;
        }

        const engineSettings = this.getDeconstructionEngineSettings();
        const resolvedDimensions = dimensions?.length
            ? dimensions
            : this.resolveDefaultDimensions(engineSettings);
        const taskId = generateTaskId();
        const task: BreakdownTask = {
            id: taskId,
            bookId,
            bookName: book.name,
            sourceText,
            dimensions: resolvedDimensions,
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
        };

        this.tasks.set(taskId, task);
        await this.knowledgeBaseManager.setBreakdownStatus(bookId, 'processing', 0);
        this.queue.push(taskId);

        const emitter = new ProgressEmitter(taskId, `《${task.bookName}》拆解`);
        const stepNames = task.dimensions.map(d => DIMENSION_LABELS[d]);
        stepNames.push('向量化');
        emitter.registerSteps(stepNames);
        this.taskEmitters.set(taskId, emitter);

        this.emitProgress(task, {
            phase: '排队中',
            message: '任务已加入队列，等待执行',
        });

        this.scheduleNext();

        return taskId;
    }

    /**
     * 重跑整本书的指定维度。
     *
     * @param bookId - 书籍 ID
     * @param dimensions - 参数
     * @returns 任务 id
     */
    async rerunBook(bookId: string, dimensions?: BreakdownDimension[]): Promise<string> {
        const sourceText = await this.knowledgeBaseManager.getSourceText(bookId);
        return await this.addTask(bookId, sourceText, dimensions);
    }

    /**
     * 取消任务。
     *
     * @param taskId - 任务 ID
     */
    async cancelTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        const emitter = this.taskEmitters.get(taskId);

        if (task.status === 'pending') {
            this.queue = this.queue.filter(id => id !== taskId);
            task.status = 'cancelled';
            task.completedAt = Date.now();
            emitter?.cancel();
            this.cleanupTaskMaps(taskId);
            this.emitProgress(task, {
                phase: '已取消',
                message: '任务已取消',
            });
            return;
        }

        if (task.status === 'paused') {
            const controller = this.abortControllers.get(taskId);
            if (controller) {
                controller.abort();
            }
            this.stopWatchdog(taskId);
            this.stopHeartbeat(taskId);
            this.pauseResolvers.delete(taskId);
            this.abortControllers.delete(taskId);
            this.cleanupTaskMaps(taskId);
            task.status = 'cancelled';
            task.completedAt = Date.now();
            emitter?.cancel();
            this.emitProgress(task, {
                phase: '已取消',
                message: '任务已取消',
            });
            this.activeCount--;
            this.scheduleNext();
            return;
        }

        if (task.status === 'running') {
            const controller = this.abortControllers.get(taskId);
            if (controller) {
                controller.abort();
            }
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.stopHeartbeat(taskId);
            emitter?.cancel();
            this.emitProgress(task, {
                phase: '已取消',
                message: '任务已取消',
            });
        }
    }

    /**
     * 取消某本书所有在途任务（删书时调用，避免任务继续写已删除的书目录/向量）
     *
     * @param bookId - 书籍 ID
     */
    async cancelByBook(bookId: string): Promise<void> {
        const active = this.getActiveTasks().filter(t => t.bookId === bookId);
        for (const task of active) {
            await this.cancelTask(task.id);
        }
    }

    /**
     * 移除任务。
     *
     * @param taskId - 任务 ID
     * @returns 是否移除
     */
    async removeTask(taskId: string): Promise<boolean> {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        if (task.status === 'running' || task.status === 'pending' || task.status === 'paused') {
            return false;
        }

        this.queue = this.queue.filter(id => id !== taskId);
        this.tasks.delete(taskId);
        this.taskEmitters.delete(taskId);
        return true;
    }

    /**
     * 暂停任务。
     *
     * @param taskId - 任务 ID
     */
    async pauseTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.status === 'pending') {
            this.queue = this.queue.filter(id => id !== taskId);
            task.status = 'paused';
            const emitter = this.taskEmitters.get(taskId);
            emitter?.pause();
            this.emitProgress(task, {
                phase: '已暂停',
                message: '任务已暂停',
            });
            return;
        }

        if (task.status === 'running') {
            task.status = 'paused';
            this.stopHeartbeat(taskId);
            this.stopWatchdog(taskId);
            const emitter = this.taskEmitters.get(taskId);
            emitter?.pause();
            this.emitProgress(task, {
                phase: '已暂停',
                message: '任务已暂停',
            });
        }
    }

    /**
     * 恢复任务。
     *
     * @param taskId - 任务 ID
     */
    async resumeTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.status === 'paused') {
            if (task.startedAt !== undefined) {
                task.status = 'running';
                this.startWatchdog(taskId, task.bookId);
                const emitter = this.taskEmitters.get(taskId);
                emitter?.start();
                const resolver = this.pauseResolvers.get(taskId);
                if (resolver) {
                    resolver();
                    this.pauseResolvers.delete(taskId);
                }
                this.emitProgress(task, {
                    phase: '继续执行',
                    message: '任务已恢复',
                });
            } else {
                task.status = 'pending';
                this.queue.push(taskId);
                const emitter = this.taskEmitters.get(taskId);
                emitter?.start();
                this.emitProgress(task, {
                    phase: '排队中',
                    message: '任务已恢复，等待执行',
                });
                this.scheduleNext();
            }
        }
    }

    /**
     * 按 id 取任务。
     *
     * @param taskId - 任务 ID
     * @returns 任务或 undefined
     */
    getTask(taskId: string): BreakdownTask | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * 读取全部任务。
     * @returns 任务数组
     */
    getAllTasks(): BreakdownTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * 读取进行中任务。
     * @returns 任务数组
     */
    getActiveTasks(): BreakdownTask[] {
        return Array.from(this.tasks.values()).filter(
            t => t.status === 'running' || t.status === 'pending' || t.status === 'paused'
        );
    }

    /**
     * 取任务的进度发射器。
     *
     * @param taskId - 任务 ID
     * @returns 发射器或 undefined
     */
    getTaskEmitter(taskId: string): ProgressEmitter | undefined {
        return this.taskEmitters.get(taskId);
    }

    /**
     * 取时间估算器。
     * @returns 估算器
     */
    getTimeEstimator(): TimeEstimator {
        return this.timeEstimator;
    }

    /**
     * estimateDecompositionTime 方法。
     * @param wordCount - 词语数量
     * @param dimensions - 维度列表
     * @param vectorEnabled - 向量启用
     * @param qualityLevel - 质量档位
      * @returns number } 结果
     */
    estimateDecompositionTime(wordCount: number, dimensions?: BreakdownDimension[], vectorEnabled?: boolean, qualityLevel?: DeconstructionQualityLevel): { etaMin: number; etaMax: number; eta: number } {
        const dims = dimensions?.length ? dimensions : DEFAULT_DIMENSIONS;
        const level = qualityLevel ?? this.getQualityLevel();
        const useVector = vectorEnabled ?? (level !== 'fast' && this.isVectorEnhancementEnabled());
        const mode: 'statistical' | 'vector' = useVector ? 'vector' : 'statistical';
        let totalEta = 0;
        let totalEtaMin = 0;
        let totalEtaMax = 0;

        for (const dim of dims) {
            const result = this.timeEstimator.estimate({
                operationType: DIMENSION_OPERATION_TYPES[dim],
                wordCount,
                mode,
            });
            totalEta += result.eta;
            totalEtaMin += result.etaMin;
            totalEtaMax += result.etaMax;
        }

        if (level === 'deep') {
            totalEta = Math.round(totalEta * 1.5);
            totalEtaMin = Math.round(totalEtaMin * 1.5);
            totalEtaMax = Math.round(totalEtaMax * 1.5);
        }

        return { eta: totalEta, etaMin: totalEtaMin, etaMax: totalEtaMax };
    }

    /**
     * 订阅整体进度。
     *
     * @param callback - 回调
     * @returns 取消订阅函数
     */
    onProgress(callback: (progress: BreakdownProgress) => void): () => void {
        this.progressCallbacks.add(callback);
        return () => this.progressCallbacks.delete(callback);
    }

    /**
     * 订阅任务完成。
     *
     * @param callback - 回调
     * @returns 取消订阅函数
     */
    onTaskComplete(callback: (task: BreakdownTask) => void): () => void {
        this.completeCallbacks.add(callback);
        return () => this.completeCallbacks.delete(callback);
    }

    /**
     * 订阅任务失败。
     *
     * @param callback - 回调
     * @returns 取消订阅函数
     */
    onTaskFailed(callback: (task: BreakdownTask) => void): () => void {
        this.failedCallbacks.add(callback);
        return () => this.failedCallbacks.delete(callback);
    }

    private scheduleNext(): void {
        const effectiveConcurrency = Math.max(1, this.getMaxConcurrency() || this.options.concurrency);
        while (this.activeCount < effectiveConcurrency && this.queue.length > 0) {
            const taskId = this.queue.shift();
            if (taskId) {
                this.runTask(taskId);
            }
        }
    }

    private async runTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        this.activeCount++;
        task.status = 'running';
        task.startedAt = Date.now();
        this.startWatchdog(taskId, task.bookId);

        const emitter = this.taskEmitters.get(taskId);
        emitter?.start();

        const controller = new AbortController();
        this.abortControllers.set(taskId, controller);

        const qualityLevel = this.getQualityLevel();
        const vectorEnabled = this.isVectorEnhancementEnabled() && qualityLevel !== 'fast';
        const vectorDimensions: BreakdownDimension[] = [];
        const degradedDimensions: BreakdownDimension[] = [];
        const degradationReasons: Array<{ dimension: string; reason: string }> = [];
        const dimensionQualityScores = new Map<BreakdownDimension, DimensionQualityScore>();
        const dimensionDurations = new Map<BreakdownDimension, number>();
        const dimensionResults = new Map<BreakdownDimension, unknown>();
        const sampleMode = this.isSampleModeEnabled();
        const sampleLimit = this.getTextSampleLimit();
        const rawWordCount = task.sourceText.length;
        const inputText = sampleMode ? task.sourceText.slice(0, sampleLimit) : task.sourceText;
        task.preprocessedText = this.preprocessText(inputText);
        const wordCount = task.preprocessedText.cleaned.length;
        let effectiveLevel: DeconstructionQualityLevel = qualityLevel;

        // 预检向量模型可用性
        const vectorCheck = await this.checkVectorAvailability();
        const vectorAvailable = vectorCheck.available;

        const qualityLevelLabels: Record<DeconstructionQualityLevel, string> = {
            fast: '快速模式',
            standard: '标准模式',
            deep: '深度模式',
        };

        if (qualityLevel !== 'fast' && !vectorAvailable) {
            emitter?.setProgress(0, `⚠️ 向量模型不可用（${vectorCheck.reason}），各维度向量增强将按需局部降级`);
            this.emitProgress(task, {
                phase: '降级提示',
                message: `⚠️ 向量模型不可用（${vectorCheck.reason}），各维度向量增强将按需局部降级`,
                totalProgress: 0,
            });
            await this.appendBreakdownLog(task.bookName, `## ⚠️ 向量模型不可用\n\n档位: ${qualityLevelLabels[qualityLevel]}\n原因: ${vectorCheck.reason}\n策略: 保持档位不变，各维度的向量增强按需局部降级\n\n`, task.bookId);
        } else if (vectorAvailable) {
            emitter?.setProgress(0, `${qualityLevelLabels[qualityLevel]}已就绪，开始拆解`);
            this.emitProgress(task, {
                phase: `${qualityLevelLabels[qualityLevel]}已就绪`,
                message: `${qualityLevelLabels[qualityLevel]}已就绪，开始拆解`,
                totalProgress: 0,
            });
        }

        const workerMode = this.workerManager.isWorkerAvailable();
        const modeLabel = workerMode ? 'Worker 线程' : '⚠️ 主线程模式';

        emitter?.setProgress(0, `开始拆解《${task.bookName}》[${qualityLevelLabels[effectiveLevel]}] [${modeLabel}]`);
        this.emitProgress(task, {
            phase: '开始拆解',
            message: `开始拆解《${task.bookName}》[${qualityLevelLabels[effectiveLevel]}] [${modeLabel}]`,
            totalProgress: 0,
        });

        const segmentThreshold = sampleMode ? Math.min(this.getSegmentedBreakdownConfig().threshold, sampleLimit) : this.getSegmentedBreakdownConfig().threshold;
        const isSegmented = this.isSegmentedBreakdownEnabled() && wordCount > segmentThreshold;
        const estimatedSegments = isSegmented ? this.segmentedBreakdown.estimateSegments(task.preprocessedText.cleaned) : 1;
        const coverageLine = sampleMode
            ? `覆盖字数: ${wordCount} 字（采样模式，前 ${sampleLimit} 字，原文 ${rawWordCount} 字）`
            : `覆盖字数: ${wordCount} 字（全本，原文 ${rawWordCount} 字）`;
        let logContent = `## ${this.formatDate(new Date())} - 开始拆解\n\n任务ID: ${taskId}\n拆解维度: ${task.dimensions.map(d => DIMENSION_LABELS[d]).join('、')}\n${coverageLine}\n分析模式: ${sampleMode ? '采样模式' : '全本模式'}\n质量档位: ${qualityLevelLabels[qualityLevel]}${effectiveLevel !== qualityLevel ? `（实际: ${qualityLevelLabels[effectiveLevel]}）` : ''}\n向量增强: ${vectorAvailable && qualityLevel !== 'fast' ? '已启用' : '未启用'}\n执行模式: ${modeLabel}\n全文分批: ${isSegmented ? `是（预计 ${estimatedSegments} 段）` : '否'}\n结果聚合: ${isSegmented ? '待完成' : '不适用'}\n\n`;
        await this.appendBreakdownLog(task.bookName, logContent, task.bookId);

        try {
            const contentHash = await this.computeContentHash(task.sourceText);
            const totalDimensions = task.dimensions.length;
            const dimConcurrency = Math.max(1, this.getDeconstructionEngineSettings().dimensionConcurrency);
            const completedSet = new Set<BreakdownDimension>();
            let aborted = false;

            const processDimension = async (dimension: BreakdownDimension) => {
                if (controller.signal.aborted || aborted) return;

                const currentStatus = task.status as TaskStatus;
                if (currentStatus === 'paused') {
                    try {
                        await this.waitForResume(taskId, controller.signal);
                    } catch {
                        aborted = true;
                        return;
                    }
                }

                if (controller.signal.aborted) { aborted = true; return; }

                const cacheKey = `${task.bookId}:${dimension}`;
                const cached = this.dimensionCache.get(cacheKey);
                if (cached && cached.hash === contentHash) {
                    const dimResult = { usedVector: false, result: cached.result };
                    dimensionResults.set(dimension, dimResult);
                    completedSet.add(dimension);
                    const progress = Math.round((completedSet.size / totalDimensions) * 100);
                    task.progress = progress;
                    emitter?.nextStep(`${DIMENSION_LABELS[dimension]} (缓存命中)`);
                    this.emitProgress(task, {
                        currentDimension: dimension,
                        dimensionProgress: 100,
                        phase: DIMENSION_LABELS[dimension],
                        message: `${DIMENSION_LABELS[dimension]} (缓存命中)`,
                        totalProgress: progress,
                    });
                    return;
                }

                emitter?.nextStep(`正在进行${DIMENSION_LABELS[dimension]}...`);
                const dimensionStartTime = Date.now();
                this.dimensionStartTimes.set(`${taskId}:${dimension}`, dimensionStartTime);

                this.emitProgress(task, {
                    currentDimension: dimension,
                    dimensionProgress: 0,
                    phase: DIMENSION_LABELS[dimension],
                    message: `正在进行${DIMENSION_LABELS[dimension]}...`,
                    totalProgress: Math.round((completedSet.size / totalDimensions) * 100),
                });

                try {
                    const breakdownOutput = await this.breakdownDimension(task, dimension, (dimProgress, message) => {
                        const overallProgress = Math.round(
                            ((completedSet.size + dimProgress / 100) / totalDimensions) * 100
                        );
                        task.progress = overallProgress;
                        emitter?.setStepProgress(dimProgress, message);
                        this.emitProgress(task, {
                            currentDimension: dimension,
                            dimensionProgress: dimProgress,
                            phase: DIMENSION_LABELS[dimension],
                            message,
                            totalProgress: overallProgress,
                        });
                        this.scheduleProgressPersist(task.bookId, overallProgress);
                    }, controller.signal, vectorAvailable && qualityLevel !== 'fast', degradedDimensions, degradationReasons);

                    const usedVector = breakdownOutput.usedVector;
                    const dimResult = breakdownOutput.result;

                    const dimensionDuration = Date.now() - dimensionStartTime;
                    dimensionDurations.set(dimension, dimensionDuration);
                    this.timeEstimator.record({
                        operationType: DIMENSION_OPERATION_TYPES[dimension],
                        wordCount,
                        mode: usedVector ? 'vector' : 'statistical',
                        duration: dimensionDuration,
                    });
                    this.timeEstimator.saveHistory();

                    if (dimResult !== undefined && dimResult !== null) {
                        dimensionResults.set(dimension, dimResult);
                        this.dimensionCache.set(cacheKey, { hash: contentHash, result: dimResult });
                    }

                    const isDegraded = degradedDimensions.includes(dimension);
                    const scoringInput: QualityScoringInput = {
                        dimension,
                        result: dimResult,
                        textLength: wordCount,
                        usedLevel: effectiveLevel,
                        elapsedTime: dimensionDuration,
                    };
                    const qualityScore = this.qualityScorer.calculateQualityScore(scoringInput);
                    if (isDegraded) {
                        const adjusted: DimensionQualityScore = {
                            ...qualityScore,
                            confidence: Math.max(30, qualityScore.confidence - 15),
                            completeness: Math.max(40, qualityScore.completeness - 10),
                        };
                        adjusted.overall = Math.round(0.4 * adjusted.completeness + 0.3 * adjusted.consistency + 0.3 * adjusted.confidence);
                        adjusted.level = adjusted.overall >= 80 ? 'high' : adjusted.overall >= 50 ? 'medium' : 'low';
                        dimensionQualityScores.set(dimension, adjusted);
                    } else {
                        dimensionQualityScores.set(dimension, qualityScore);
                    }
                    const finalScore = dimensionQualityScores.get(dimension)!;
                    const needUpgrade = this.qualityScorer.shouldUpgrade(finalScore);
                    const suggestedLevel = this.qualityScorer.suggestLevel(finalScore);

                    let dimLog = `### ${DIMENSION_LABELS[dimension]} - 完成\n`;
                    dimLog += `耗时: ${dimensionDuration}ms\n`;
                    dimLog += `向量增强: ${usedVector ? '已使用' : '未使用'}\n`;
                    dimLog += `质量评分: ${finalScore.overall}/100 (${finalScore.level})\n`;
                    dimLog += `  - 完整性: ${finalScore.completeness}/100\n`;
                    dimLog += `  - 一致性: ${finalScore.consistency}/100\n`;
                    dimLog += `  - 置信度: ${finalScore.confidence}/100\n`;
                    dimLog += `实际档位: ${qualityLevelLabels[finalScore.usedLevel]}\n`;
                    if (isDegraded) {
                        const reason = degradationReasons.find(r => r.dimension === dimension)?.reason || '未知原因';
                        dimLog += `降级原因: ${reason}\n`;
                    }
                    if (needUpgrade) {
                        dimLog += `⚠️ 建议升级到 ${qualityLevelLabels[suggestedLevel]}（综合评分 < 60，暂不自动重跑，仅标记）\n`;
                    }
                    dimLog += `\n`;
                    await this.appendBreakdownLog(task.bookName, dimLog, task.bookId);

                    const filePathFn = DIMENSION_FILE_MAP[dimension];
                    if (filePathFn && dimResult !== undefined && dimResult !== null) {
                        const filePath = filePathFn(task.bookName, this.baseDir);
                        await this.injectQualityScoreToFrontmatter(filePath, finalScore);
                    }

                    if (usedVector) {
                        vectorDimensions.push(dimension);
                    }

                    await yieldToUI();
                } catch (dimError) {
                    if (controller.signal.aborted) {
                        aborted = true;
                        return;
                    }
                    log.warn(`[DeconstructionScheduler] 维度 ${dimension} 拆解失败:`, dimError);
                    await this.appendBreakdownLog(task.bookName, `### ${DIMENSION_LABELS[dimension]} - 失败\n\n错误: ${dimError instanceof Error ? dimError.message : String(dimError)}\n\n`, task.bookId);
                }

                completedSet.add(dimension);
                task.progress = Math.round((completedSet.size / totalDimensions) * 100);
            };

            await this.runWithConcurrencyLimit(task.dimensions, dimConcurrency, processDimension);

            if (aborted) {
                throw new Error('任务已取消');
            }

            await this.flushBatchWrites();
            await yieldToUI();
            const crossValidationResults = this.qualityScorer.crossValidate(dimensionResults as unknown as Partial<Record<BreakdownDimension, unknown>>);

            task.status = 'completed';
            task.completedAt = Date.now();
            task.progress = 100;

            const finishMessage = degradedDimensions.length > 0
                ? `《${task.bookName}》拆解完成（${qualityLevelLabels[effectiveLevel]}，向量增强 ${vectorDimensions.length}/${totalDimensions}，${degradedDimensions.length} 维度降级）`
                : `《${task.bookName}》拆解完成（${qualityLevelLabels[effectiveLevel]}，向量增强 ${vectorDimensions.length}/${totalDimensions}）`;

            emitter?.setProgress(100, finishMessage);
            emitter?.complete();
            this.emitProgress(task, {
                totalProgress: 100,
                phase: '拆解完成',
                message: finishMessage,
            });

            this.flushProgressPersist(task.bookId);
            await this.knowledgeBaseManager.setBreakdownStatus(task.bookId, 'completed', 100);
            
            let finishLog = `## 拆解完成\n\n`;
            finishLog += `质量档位: ${qualityLevelLabels[effectiveLevel]}\n`;
            finishLog += `分析模式: ${sampleMode ? '采样模式' : '全本模式'}\n`;
            finishLog += `实际覆盖字数: ${wordCount} 字${sampleMode ? `（采样，原文 ${rawWordCount} 字）` : `（全本，原文 ${rawWordCount} 字）`}\n`;
            finishLog += `全文分批: ${isSegmented ? `是（${estimatedSegments} 段）` : '否'}\n`;
            finishLog += `结果聚合: ${isSegmented ? '已完成' : '不适用'}\n`;
            finishLog += `向量增强维度: ${vectorDimensions.length > 0 ? vectorDimensions.map(d => DIMENSION_LABELS[d]).join('、') : '无'}\n\n`;
            
            finishLog += `### 质量评分总览\n\n| 维度 | 综合评分 | 等级 | 完整性 | 一致性 | 置信度 | 耗时 |\n|------|----------|------|--------|--------|--------|------|\n`;
            for (const dim of task.dimensions) {
                const score = dimensionQualityScores.get(dim);
                const duration = dimensionDurations.get(dim);
                if (score && duration !== undefined) {
                    finishLog += `| ${DIMENSION_LABELS[dim]} | ${score.overall} | ${score.level} | ${score.completeness} | ${score.consistency} | ${score.confidence} | ${duration}ms |\n`;
                }
            }
            finishLog += `\n`;

            if (crossValidationResults.length > 0) {
                const passedCount = crossValidationResults.filter(r => r.passed).length;
                finishLog += `### 交叉验证（${passedCount}/${crossValidationResults.length} 通过）\n\n| 规则 | 维度A→B | 值A | 值B | 结果 | 说明 |\n|------|---------|------|------|------|------|\n`;
                for (const cv of crossValidationResults) {
                    const dimPair = `${cv.rule.dimensionA}→${cv.rule.dimensionB}`;
                    finishLog += `| ${cv.rule.name} | ${dimPair} | ${cv.valueA} | ${cv.valueB} | ${cv.passed ? '✅' : '❌'} | ${cv.message} |\n`;
                }
                finishLog += `\n`;
            } else {
                finishLog += `### 交叉验证\n\n无可执行的交叉验证规则（缺少必要维度结果）\n\n`;
            }

            await this.appendBreakdownLog(task.bookName, finishLog, task.bookId);

            if (degradedDimensions.length > 0) {
                let summary = `## 降级摘要\n\n| 维度 | 降级原因 |\n|------|----------|\n`;
                for (const dr of degradationReasons) {
                    summary += `| ${DIMENSION_LABELS[dr.dimension as BreakdownDimension]} | ${dr.reason} |\n`;
                }
                await this.appendBreakdownLog(task.bookName, summary, task.bookId);
            }

            try {
                if (this.vectorStore && typeof this.vectorStore.addBookSamples === 'function') {
                    emitter?.nextStep('正在向量化...');
                    this.startHeartbeat(taskId, 0, 100, '向量化处理中...', true);
                    await this.vectorizeBook(task.bookId, task.bookName);
                    this.stopHeartbeat(taskId);
                    await this.recordVectorOutcome(task);
                    emitter?.setStepProgress(100, '向量化完成');
                    log.info(`[DeconstructionScheduler] 《${task.bookName}》向量化完成`);
                }
            } catch (vecError) {
                this.stopHeartbeat(taskId);
                await this.recordVectorOutcome(task, vecError);
            }

            for (const cb of this.completeCallbacks) {
                try {
                    cb(task);
                } catch (e) {
                    log.warn('[DeconstructionScheduler] 完成回调执行失败:', e);
                }
            }

            try {
                // A5: 向量化失败不能再提示「拆解完成」了事，必须说明参考内容不可检索并指路重试
                new Notice(
                    buildBreakdownFinishNotice(task.bookName, {
                        status: task.vectorStatus,
                        error: task.vectorError,
                    }),
                    task.vectorStatus === 'failed' ? 10000 : 6000,
                );
            } catch {
            }
        } catch (error) {
            this.stopHeartbeat(taskId);
            const finalStatus = task.status as TaskStatus;
            if (finalStatus === 'cancelled') {
                emitter?.cancel();
                this.cancelProgressPersist(task.bookId);
                await this.knowledgeBaseManager.setBreakdownStatus(task.bookId, 'pending', task.progress);
            } else {
                task.status = 'failed';
                task.completedAt = Date.now();
                task.error = error instanceof Error ? error.message : String(error);

                emitter?.fail(task.error);
                this.emitProgress(task, {
                    phase: '拆解失败',
                    message: `《${task.bookName}》拆解失败`,
                    error: task.error,
                });

                this.flushProgressPersist(task.bookId);
                await this.knowledgeBaseManager.setBreakdownStatus(task.bookId, 'failed', task.progress, task.error);
                await this.appendBreakdownLog(task.bookName, `## 拆解失败\n\n错误: ${task.error}\n\n`, task.bookId);

                for (const cb of this.failedCallbacks) {
                    try {
                        cb(task);
                    } catch (e) {
                        log.warn('[DeconstructionScheduler] 失败回调执行失败:', e);
                    }
                }
            }
        } finally {
            this.stopHeartbeat(taskId);
            this.stopWatchdog(taskId);
            this.abortControllers.delete(taskId);
            this.pauseResolvers.delete(taskId);
            this.cleanupTaskMaps(taskId);
            this.activeCount--;
            this.scheduleNext();
        }
    }

    private async waitForResume(taskId: string, signal: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.pauseResolvers.set(taskId, resolve);

            const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                this.pauseResolvers.delete(taskId);
                reject(new Error('任务已取消'));
            };

            signal.addEventListener('abort', onAbort);
        });
    }

    private shouldUseSegmentedDimension(task: BreakdownTask): boolean {
        const config = this.getSegmentedBreakdownConfig();
        const threshold = this.isSampleModeEnabled()
            ? Math.min(config.threshold, this.getTextSampleLimit())
            : config.threshold;
        const text = this.getEffectiveSourceText(task);
        return text.length > threshold || (this.isSegmentedBreakdownEnabled() && this.segmentIntegration.shouldSegment(text, {
            maxDirectWords: config.threshold,
            maxSegmentWords: config.maxSegmentWords,
        }));
    }

    private async breakdownDimensionWithSegments(
        task: BreakdownTask,
        dimension: BreakdownDimension,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: AnalysisResult | undefined }> {
        const config = this.getSegmentedBreakdownConfig();
        const useVector = vectorAvailable && this.isVectorEnhancementEnabled();
        const maxDirectWords = this.isSampleModeEnabled()
            ? Math.min(config.threshold, this.getTextSampleLimit())
            : config.threshold;
        const llmEnabled = this.isLlmEnhancementEnabled();
        const llmCaller = this.llmCallerGetter?.();
        const llmModel = this.getDeconstructionEngineSettings().llmModel;
        const llmEnhancer = (llmEnabled && llmCaller && llmModel)
            ? new LLMEnhancer(llmCaller, {
                llmModel,
                maxTokens: 4096,
                callOptions: this.resolveLlmCallOptions(llmModel),
            })
            : undefined;
        const text = this.getEffectiveSourceText(task);

        try {
            const result = await this.segmentIntegration.analyzeWithSegments<AnalysisResult>(
                dimension,
                text,
                signal,
                {
                    maxDirectWords,
                    maxSegmentWords: config.maxSegmentWords,
                    useVector,
                    llmEnabled: this.isLlmEnhancementEnabled() && !!llmEnhancer,
                    llmEnhancer,
                    onSegmentProgress: (_dim, segmentIndex, totalSegments, segmentProgress) => {
                        const mappedProgress = Math.round(((segmentIndex + segmentProgress) / Math.max(1, totalSegments)) * 90);
                        onProgress(mappedProgress, `${DIMENSION_LABELS[dimension]} 第 ${segmentIndex + 1}/${totalSegments} 块处理中...`);
                    },
                    onOverallProgress: (_dim, progress, message) => {
                        onProgress(Math.min(90, Math.round(progress * 0.9)), message);
                    },
                }
            );

            if (dimension === 'structure') {
                const structure = result.combinedResult as StructureAnalysisResult;
                if (structure.stats) structure.stats.totalWordCount = countTotalChars(task.sourceText);
            }

            await this.saveSegmentedDimensionResult(task, dimension, result.combinedResult);
            onProgress(100, `${DIMENSION_LABELS[dimension]} 全文分块拆解完成（${result.totalSegments} 块）`);
            return { usedVector: useVector, result: result.combinedResult };
        } catch (error) {
            if (error instanceof TypeError || error instanceof ReferenceError) {
                throw error;
            }
            if (useVector) {
                degradedDimensions.push(dimension);
                degradationReasons.push({ dimension, reason: error instanceof Error ? error.message : String(error) });
                onProgress(45, `⚠️ ${DIMENSION_LABELS[dimension]} 分块向量增强失败，降级到纯统计分块`);
                const fallback = await this.segmentIntegration.analyzeWithSegments<AnalysisResult>(
                    dimension,
                    text,
                    signal,
                    {
                        maxDirectWords,
                        maxSegmentWords: config.maxSegmentWords,
                        useVector: false,
                        onSegmentProgress: (_dim, segmentIndex, totalSegments, segmentProgress) => {
                            const mappedProgress = 45 + Math.round(((segmentIndex + segmentProgress) / Math.max(1, totalSegments)) * 45);
                            onProgress(mappedProgress, `${DIMENSION_LABELS[dimension]} 纯统计第 ${segmentIndex + 1}/${totalSegments} 块处理中...`);
                        },
                    }
                );

                if (dimension === 'structure') {
                    const structure = fallback.combinedResult as StructureAnalysisResult;
                    if (structure.stats) structure.stats.totalWordCount = countTotalChars(task.sourceText);
                }

                await this.saveSegmentedDimensionResult(task, dimension, fallback.combinedResult);
                onProgress(100, `${DIMENSION_LABELS[dimension]} 全文分块拆解完成（纯统计降级，${fallback.totalSegments} 块）`);
                return { usedVector: false, result: fallback.combinedResult };
            }
            throw error;
        }
    }

    private async saveSegmentedDimensionResult(task: BreakdownTask, dimension: BreakdownDimension, result: AnalysisResult | undefined): Promise<void> {
        if (!result) return;
        // 书已删除：不写维度文件，避免把已删除的书目录重新建出来。
        if (!(await this.knowledgeBaseManager.getBook(task.bookId))) {
            log.info(`[DeconstructionScheduler] 书籍已删除，跳过保存${DIMENSION_LABELS[dimension]}结果`);
            return;
        }
        try {
            switch (dimension) {
                case 'style':
                    await this.styleDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as StyleAnalysisResult, this.baseDir);
                    break;
                case 'rhythm':
                    await this.rhythmDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as RhythmAnalysisResult, this.baseDir);
                    break;
                case 'technique':
                    await this.techniqueDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as TechniqueAnalysisResult, this.baseDir);
                    break;
                case 'structure':
                    await this.structureDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as StructureAnalysisResult, this.baseDir);
                    break;
                case 'character':
                    await this.characterDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as CharacterAnalysisResult, this.baseDir);
                    break;
                case 'foreshadow':
                    await this.foreshadowDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as ForeshadowAnalysisResult, this.baseDir);
                    break;
                case 'commercial':
                    await this.commercialDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as CommercialAnalysisResult, this.baseDir);
                    break;
                case 'readability':
                    await this.readabilityDeconstructor!.saveAnalysisToMarkdown(this.app, task.bookName, result as ReadabilityAnalysisResult, this.baseDir);
                    break;
            }
        } catch (e) {
            log.warn(`[DeconstructionScheduler] 保存${DIMENSION_LABELS[dimension]}全文分块结果失败:`, e);
        }
    }

    private async injectQualityScoreToFrontmatter(filePath: string, score: DimensionQualityScore): Promise<void> {
        try {
            const content = await this.app.vault.adapter.read(filePath);
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!match) return;
            let frontmatter: Record<string, unknown>;
            try {
                frontmatter = JSON.parse(match[1]);
            } catch {
                return;
            }
            frontmatter._qualityScore = score;
            const newFrontmatter = JSON.stringify(frontmatter, null, 2);
            const newContent = content.replace(match[0], `---\n${newFrontmatter}\n---`);
            this.pendingWrites.set(filePath, newContent);
        } catch (e) {
            log.warn(`[DeconstructionScheduler] Failed to inject quality score to ${filePath}:`, e);
        }
    }

    private async flushBatchWrites(): Promise<void> {
        if (this.pendingWrites.size === 0) return;
        const entries = Array.from(this.pendingWrites.entries());
        this.pendingWrites.clear();
        await Promise.all(entries.map(([path, content]) =>
            // 注入质量分的对象是用户可见分析报告：走索引写入，避免 metadataCache 陈旧。
            writeVaultText(this.app, path, content).catch(e =>
                log.warn(`[DeconstructionScheduler] 批量写入失败 ${path}:`, e)
            )
        ));
    }

    private resolveLlmCallOptions(model: string): LLMCallOptions | undefined {
        const settings = this.settingsGetter?.();
        if (!settings || !model) return undefined;
        const providers = settings.customProviders || [];
        const local = providers.find(p =>
            Array.isArray(p.models)
            && p.models.includes(model)
            && resolveProviderSourceType({ id: p.id, endpoint: p.endpoint, sourceType: p.sourceType }) === 'local',
        );
        if (!local) return undefined;
        return {
            endpoint: local.endpoint,
            apiKey: settings.providerKeys?.[local.id] || 'ollama',
            disableFallback: true,
        };
    }

    private ensureLlmEnhancer(): void {
        if (this.llmEnhancer) return;
        if (!this.isLlmEnhancementEnabled()) return;
        const caller = this.llmCallerGetter?.();
        const model = this.getDeconstructionEngineSettings().llmModel;
        if (!caller || !model) return;
        this.setLlmEnhancer(new LLMEnhancer(caller, {
            llmModel: model,
            maxTokens: 4096,
            callOptions: this.resolveLlmCallOptions(model),
        }));
    }

    private async breakdownDimension(
        task: BreakdownTask,
        dimension: BreakdownDimension,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: AnalysisResult | undefined }> {
        // 非分块路径此前从未创建 LLMEnhancer：设置里打开“LLM 增强”后，
        // initDeconstructors 的 this.llmEnhancer 永远是 undefined，增强静默不生效。
        this.ensureLlmEnhancer();
        if (this.shouldUseSegmentedDimension(task)) {
            return await this.breakdownDimensionWithSegments(task, dimension, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
        }

        switch (dimension) {
            case 'style':
                return await this.breakdownStyle(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'rhythm':
                return await this.breakdownRhythm(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'technique':
                return await this.breakdownTechnique(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'structure':
                return await this.breakdownStructure(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'character':
                return await this.breakdownCharacter(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'foreshadow':
                return await this.breakdownForeshadow(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'commercial':
                return await this.breakdownCommercial(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            case 'readability':
                return await this.breakdownReadability(task, onProgress, signal, vectorAvailable, degradedDimensions, degradationReasons);
            default:
                return { usedVector: false, result: undefined };
        }
    }

    /**
     * 统一维度向量增强 + 降级执行流程。
     *
     * 消除 8 个 breakdownXxx 方法中重复的「首次尝试 → 失败重试 → 降级到纯统计」控制流。
     * 各维度仅需提供差异化描述符（worker 方法、fallback deconstructor、进度映射）。
     *
     * 降级发生时通过统一降级事件系统（DegradationNotifier）上报，替代散落的 console.warn。
     */
    private async runDimensionWithFallback<T>(
        descriptor: {
            dimension: BreakdownDimension;
            task: BreakdownTask;
            onProgress: (progress: number, message: string) => void;
            signal: AbortSignal;
            vectorAvailable: boolean;
            degradedDimensions: BreakdownDimension[];
            degradationReasons: Array<{ dimension: string; reason: string }>;
            runVector: () => { cancel: () => void } & Promise<T>;
            runPlain: () => { cancel: () => void } & Promise<T>;
            runVectorRetry: () => { cancel: () => void } & Promise<T>;
            runFallback: () => Promise<T>;
        }
    ): Promise<{ usedVector: boolean; result: T }> {
        const {
            dimension,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
        } = descriptor;
        const dimensionName = DIMENSION_LABELS[dimension];

        const useVector = vectorAvailable && this.isVectorEnhancementEnabled();
        let result: T;
        let vectorUsed = false;
        let workerTask: { cancel: () => void } | null = null;

        try {
            const taskPromise = useVector ? descriptor.runVector() : descriptor.runPlain();
            workerTask = taskPromise;

            const abortHandler = () => {
                workerTask?.cancel();
            };
            signal.addEventListener('abort', abortHandler);
            try {
                result = await taskPromise;
            } finally {
                signal.removeEventListener('abort', abortHandler);
            }

            this.checkAbort(signal);
            vectorUsed = useVector;
        } catch (firstError) {
            if (firstError instanceof TypeError || firstError instanceof ReferenceError) {
                log.error('[DeconstructionScheduler] 代码异常，不降级:', firstError);
                throw firstError;
            }

            if (useVector) {
                log.warn(`[DeconstructionScheduler] ${dimensionName}首次失败，2秒后重试:`, firstError);
                onProgress(35, `${dimensionName}向量计算失败，重试中...`);
                await this.delay(2000);
                this.checkAbort(signal);

                try {
                    const retryPromise = descriptor.runVectorRetry();
                    workerTask = retryPromise;

                    const abortHandler = () => {
                        workerTask?.cancel();
                    };
                    signal.addEventListener('abort', abortHandler);
                    try {
                        result = await retryPromise;
                    } finally {
                        signal.removeEventListener('abort', abortHandler);
                    }

                    vectorUsed = true;
                    log.info(`[DeconstructionScheduler] ${dimensionName}重试成功`);
                } catch (retryError) {
                    if (retryError instanceof TypeError || retryError instanceof ReferenceError) {
                        throw retryError;
                    }
                    const reason = retryError instanceof Error ? retryError.message : String(retryError);
                    onProgress(50, `⚠️ ${dimensionName}向量增强失败，已降级到纯统计`);
                    result = await descriptor.runFallback();
                    vectorUsed = false;
                    degradedDimensions.push(dimension);
                    degradationReasons.push({ dimension, reason });
                    getDegradationNotifier().notify({
                        source: 'vector',
                        dimension,
                        from: 'vector',
                        to: 'statistics',
                        reason,
                        severity: 'warning',
                        recoverable: true,
                    });
                }
            } else {
                throw firstError;
            }
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownStyle(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: StyleAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'style';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在分析句式节奏...');
        this.checkAbort(signal);

        if (!this.styleDeconstructor && !this.workerManager) {
            await this.delay(200);
            onProgress(30, '正在分析用词偏好...');
            this.checkAbort(signal);
            await this.delay(200);
            onProgress(50, '正在分析叙事特点...');
            this.checkAbort(signal);
            await this.delay(200);
            onProgress(70, '正在分析修辞手法...');
            this.checkAbort(signal);
            await this.delay(200);
            onProgress(90, '正在生成风格报告...');
            this.checkAbort(signal);
            await this.delay(200);
            onProgress(100, '风格分析完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<StyleAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeStyleWithVector(text, (p, msg) => {
                onProgress(Math.round(25 + p * 0.35), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeStyle(text, (p, msg) => {
                onProgress(Math.round(p * 0.6), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeStyleWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.styleDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(60, vectorUsed ? '向量验证完成，生成报告...' : '正在分析叙事特点...');
        this.checkAbort(signal);

        try {
            await this.styleDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存风格分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `风格分析完成（向量增强，耗时 ${elapsed}ms）` : '风格分析完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 风格维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownRhythm(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: RhythmAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'rhythm';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在分析章节节奏...');
        this.checkAbort(signal);

        if (!this.rhythmDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(50, '正在分析情绪曲线...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(80, '正在生成节奏报告...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '节奏分析完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<RhythmAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeRhythmWithVector(text, (p, msg) => {
                onProgress(Math.round(30 + p * 0.4), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeRhythm(text, (p, msg) => {
                onProgress(Math.round(p * 0.7), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeRhythmWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.rhythmDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(70, vectorUsed ? '向量验证完成，生成报告...' : '正在生成节奏报告...');
        this.checkAbort(signal);

        try {
            await this.rhythmDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存节奏分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `节奏分析完成（向量增强，耗时 ${elapsed}ms）` : '节奏分析完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 节奏维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownTechnique(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: TechniqueAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'technique';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在识别写作技巧...');
        this.checkAbort(signal);

        if (!this.techniqueDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(60, '正在分类整理技巧...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '写作技巧分析完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<TechniqueAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeTechniqueWithVector(text, (p, msg) => {
                onProgress(Math.round(25 + p * 0.45), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeTechnique(text, (p, msg) => {
                onProgress(Math.round(p * 0.7), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeTechniqueWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.techniqueDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(70, vectorUsed ? '向量验证完成，整理结果...' : '正在分类整理技巧...');
        this.checkAbort(signal);

        try {
            await this.techniqueDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存技巧分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `写作技巧分析完成（向量增强，耗时 ${elapsed}ms）` : '写作技巧分析完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 技巧维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownStructure(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: StructureAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'structure';
        const text = this.getEffectiveSourceText(task);

        onProgress(20, '正在分析整体结构...');
        this.checkAbort(signal);

        if (!this.structureDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(50, '正在拆解章节结构...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(80, '正在生成结构导图...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '结构拆解完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<StructureAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeStructureWithVector(text, (p, msg) => {
                onProgress(Math.round(30 + p * 0.3), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeStructure(text, (p, msg) => {
                onProgress(Math.round(20 + p * 0.4), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeStructureWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.structureDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        if (result?.stats) {
            result.stats.totalWordCount = countTotalChars(task.sourceText);
        }

        onProgress(60, vectorUsed ? '向量验证完成，生成结构导图...' : '正在拆解章节结构...');
        this.checkAbort(signal);

        try {
            await this.structureDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存结构分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `结构拆解完成（向量增强，耗时 ${elapsed}ms）` : '结构拆解完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 结构维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownCharacter(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: CharacterAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'character';
        const text = this.getEffectiveSourceText(task);

        onProgress(15, '正在识别主要人物...');
        this.checkAbort(signal);

        if (!this.characterDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(40, '正在提取人物设定...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(70, '正在分析人物关系...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '人设提取完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<CharacterAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeCharacterWithVector(text, (p, msg) => {
                onProgress(Math.round(30 + p * 0.2), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeCharacter(text, (p, msg) => {
                onProgress(Math.round(15 + p * 0.35), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeCharacterWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.characterDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(50, vectorUsed ? '向量验证完成，分析人物关系...' : '正在提取人物设定...');
        this.checkAbort(signal);

        try {
            await this.characterDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存人设分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `人设提取完成（向量增强，耗时 ${elapsed}ms）` : '人设提取完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 人设维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownForeshadow(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: ForeshadowAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'foreshadow';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在识别伏笔线索...');
        this.checkAbort(signal);

        if (!this.foreshadowDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(50, '正在追踪伏笔回收...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(80, '正在整理伏笔库...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '伏笔梳理完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<ForeshadowAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeForeshadowWithVector(text, (p, msg) => {
                onProgress(Math.round(25 + p * 0.35), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeForeshadow(text, (p, msg) => {
                onProgress(Math.round(10 + p * 0.5), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeForeshadowWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.foreshadowDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(60, vectorUsed ? '向量验证完成，追踪回收...' : '正在追踪伏笔回收...');
        this.checkAbort(signal);

        try {
            await this.foreshadowDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存伏笔分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `伏笔梳理完成（向量增强，耗时 ${elapsed}ms）` : '伏笔梳理完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 伏笔维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownCommercial(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: CommercialAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'commercial';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在分析商业价值...');
        this.checkAbort(signal);

        if (!this.commercialDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(40, '正在评估黄金三章...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(70, '正在分析波浪节奏...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '商业价值分析完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<CommercialAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeCommercialWithVector(text, (p, msg) => {
                onProgress(Math.round(20 + p * 0.5), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeCommercial(text, (p, msg) => {
                onProgress(Math.round(p * 0.6), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeCommercialWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.commercialDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(70, vectorUsed ? '向量验证完成，生成报告...' : '正在生成商业价值报告...');
        this.checkAbort(signal);

        try {
            await this.commercialDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存商业价值分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `商业价值分析完成（向量增强，耗时 ${elapsed}ms）` : '商业价值分析完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 商业价值维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private async breakdownReadability(
        task: BreakdownTask,
        onProgress: (progress: number, message: string) => void,
        signal: AbortSignal,
        vectorAvailable: boolean,
        degradedDimensions: BreakdownDimension[],
        degradationReasons: Array<{ dimension: string; reason: string }>
    ): Promise<{ usedVector: boolean; result: ReadabilityAnalysisResult | undefined }> {
        const dimension: BreakdownDimension = 'readability';
        const text = this.getEffectiveSourceText(task);

        onProgress(10, '正在分析可读性...');
        this.checkAbort(signal);

        if (!this.readabilityDeconstructor && !this.workerManager) {
            await this.delay(150);
            onProgress(40, '正在分析 Show vs Tell...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(70, '正在检测 AI 痕迹...');
            this.checkAbort(signal);
            await this.delay(150);
            onProgress(100, '可读性分析完成');
            return { usedVector: false, result: undefined };
        }

        const startTime = Date.now();
        const { usedVector: vectorUsed, result } = await this.runDimensionWithFallback<ReadabilityAnalysisResult>({
            dimension,
            task,
            onProgress,
            signal,
            vectorAvailable,
            degradedDimensions,
            degradationReasons,
            runVector: () => this.workerManager.analyzeReadabilityWithVector(text, (p, msg) => {
                onProgress(Math.round(20 + p * 0.5), msg || '向量计算中...');
            }),
            runPlain: () => this.workerManager.analyzeReadability(text, (p, msg) => {
                onProgress(Math.round(p * 0.6), msg || '分析中...');
            }),
            runVectorRetry: () => this.workerManager.analyzeReadabilityWithVector(text, (p, msg) => {
                onProgress(Math.round(35 + p * 0.15), msg || '重试中...');
            }),
            runFallback: () => this.readabilityDeconstructor!.analyze(text),
        });

        const elapsed = Date.now() - startTime;
        this.checkAbort(signal);

        onProgress(70, vectorUsed ? '向量验证完成，生成报告...' : '正在生成可读性报告...');
        this.checkAbort(signal);

        try {
            await this.readabilityDeconstructor!.saveAnalysisToMarkdown(
                this.app,
                task.bookName,
                result,
                this.baseDir
            );
        } catch (e) {
            log.warn('[DeconstructionScheduler] 保存可读性分析结果失败:', e);
        }

        this.checkAbort(signal);
        onProgress(100, vectorUsed ? `可读性分析完成（向量增强，耗时 ${elapsed}ms）` : '可读性分析完成');

        if (vectorUsed) {
            log.info(`[DeconstructionScheduler] 可读性维度向量增强耗时: ${elapsed}ms`);
        }

        return { usedVector: vectorUsed, result };
    }

    private checkAbort(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new Error('任务已取消');
        }
    }

    private async runWithConcurrencyLimit<T>(
        items: T[],
        concurrency: number,
        fn: (item: T) => Promise<void>
    ): Promise<void> {
        const executing = new Set<Promise<void>>();
        for (const item of items) {
            const p = fn(item).catch(() => {}).then(() => { executing.delete(p); });
            executing.add(p);
            if (executing.size >= concurrency) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private startHeartbeat(taskId: string, minProgress: number, maxProgress: number, message: string, isStepProgress = false): void {
        this.stopHeartbeat(taskId);
        const emitter = this.taskEmitters.get(taskId);
        if (!emitter) return;

        const range = maxProgress - minProgress;
        const duration = 30000;
        const interval = 2000;
        const steps = duration / interval;
        const incrementPerStep = range / steps;
        let currentProgress = minProgress;

        const timer = setInterval(() => {
            currentProgress = Math.min(currentProgress + incrementPerStep, maxProgress - 0.5);
            if (isStepProgress) {
                emitter.setStepProgress(currentProgress, message);
            } else {
                emitter.setProgress(currentProgress, message);
            }
        }, interval);

        this.heartbeatTimers.set(taskId, timer);
    }

    private stopHeartbeat(taskId: string): void {
        const timer = this.heartbeatTimers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.heartbeatTimers.delete(taskId);
        }
    }

    private startWatchdog(taskId: string, bookId: string): void {
        this.stopWatchdog(taskId);
        this.lastSeenAlive.set(taskId, Date.now());
        const timer = setInterval(() => {
            const lastAlive = this.lastSeenAlive.get(taskId);
            if (!lastAlive) return;
            const elapsed = Date.now() - lastAlive;
            if (elapsed > DeconstructionScheduler.WATCHDOG_TIMEOUT) {
                log.warn(`[拆解] Watchdog: 任务 ${taskId} 超过 ${elapsed / 1000}秒 无心跳，判定为中断`);
                this.handleWatchdogTimeout(taskId, bookId);
            }
        }, DeconstructionScheduler.WATCHDOG_INTERVAL);
        this.watchdogTimers.set(taskId, timer);
    }

    private stopWatchdog(taskId: string): void {
        const timer = this.watchdogTimers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.watchdogTimers.delete(taskId);
        }
        this.lastSeenAlive.delete(taskId);
    }

    private scheduleProgressPersist(bookId: string, progress: number): void {
        this.progressDebounceManager.debounceFixed(
            `progress:${bookId}`,
            () => {
                this.knowledgeBaseManager.setBreakdownStatus(bookId, 'processing', progress);
            },
            DeconstructionScheduler.PROGRESS_DEBOUNCE_DELAY
        );
    }

    private flushProgressPersist(bookId: string): void {
        this.progressDebounceManager.flush(`progress:${bookId}`);
    }

    private cancelProgressPersist(bookId: string): void {
        this.progressDebounceManager.cancel(`progress:${bookId}`);
    }

    private cleanupTaskMaps(taskId: string): void {
        for (const key of this.dimensionStartTimes.keys()) {
            if (key.startsWith(`${taskId}:`)) {
                this.dimensionStartTimes.delete(key);
            }
        }
    }

    private async handleWatchdogTimeout(taskId: string, bookId: string): Promise<void> {
        this.stopWatchdog(taskId);
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'failed';
            task.error = '任务心跳超时，可能已中断';
        }
        // 中止任务
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
        }
        // 更新书籍状态为 interrupted
        this.flushProgressPersist(bookId);
        await this.knowledgeBaseManager.setBreakdownStatus(bookId, 'interrupted', task?.progress);
        // 通知用户
        new Notice(`⚠️ 拆解任务可能已中断，请检查或重新拆解`, 5000);
        // 触发进度更新
        if (task) {
            this.emitProgress(task, {
                phase: '已中断',
                message: '任务心跳超时，可能已中断',
                error: task.error,
            });
        }
    }

    private emitProgress(
        task: BreakdownTask,
        extra: Partial<BreakdownProgress> = {}
    ): void {
        this.lastSeenAlive.set(task.id, Date.now());

        const emitter = this.taskEmitters.get(task.id);
        const emitterState = emitter?.getState();

        const progress: BreakdownProgress = {
            taskId: task.id,
            bookId: task.bookId,
            bookName: task.bookName,
            status: task.status,
            totalProgress: task.progress,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            elapsed: emitterState?.elapsed,
            eta: emitterState?.eta,
            etaMin: emitterState?.etaMin,
            etaMax: emitterState?.etaMax,
            currentStep: emitterState?.currentStep,
            ...extra,
        };

        for (const cb of this.progressCallbacks) {
            try {
                cb(progress);
            } catch (e) {
                log.warn('[DeconstructionScheduler] 进度回调执行失败:', e);
            }
        }
    }

    private async appendBreakdownLog(bookName: string, content: string, bookId?: string): Promise<void> {
        // 书已删除：不写日志，避免 fs.mkdir 把已删除的书目录重新建出来。
        if (bookId && !(await this.knowledgeBaseManager.getBook(bookId))) {
            return;
        }
        try {
            const fs = this.getFS();
            const logPath = kbBookBreakdownLogFile(bookName, this.baseDir);
            const bookDir = kbBookDir(bookName, this.baseDir);

            await fs.mkdir(bookDir).catch(() => undefined);

            let existingContent = '';
            try {
                existingContent = await fs.read(logPath);
            } catch {
                existingContent = '# 拆解日志\n\n';
            }

            const newContent = existingContent + content;
            await fs.write(logPath, newContent);
        } catch (e) {
            log.warn('[DeconstructionScheduler] 写入拆解日志失败:', e);
        }
    }

    private formatDate(date: Date): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /**
     * 按当前 embedding 模型重算一本书的向量（不重新拆解、不调用 AI）。
     * 与拆解流程不同，这里在向量存储缺失时抛错：批量重向量化需要把「没做成」如实报给用户，
     * 静默跳过会让人以为已经修好。
     * @param bookId - 书籍 ID
     * @param bookName - 书名
     */
    async revectorizeBook(bookId: string, bookName: string): Promise<void> {
        if (!this.vectorStore || typeof this.vectorStore.addBookSamples !== 'function') {
            throw new Error('拆解调度器未配置向量存储');
        }
        try {
            await this.vectorizeBook(bookId, bookName);
            await this.persistVectorStatus(bookId, 'done');
        } catch (e) {
            await this.persistVectorStatus(bookId, 'failed', e instanceof Error ? e.message : String(e));
            throw e;
        }
    }

    /**
     * 记录向量化结果（A5）：拆解完成不等于检索可用，结果必须写回任务与书籍信息；
     * 失败时走统一降级通知，避免只写日志。
     */
    private async recordVectorOutcome(task: BreakdownTask, error?: unknown): Promise<void> {
        if (error === undefined) {
            task.vectorStatus = 'done';
            task.vectorError = undefined;
            await this.persistVectorStatus(task.bookId, 'done');
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        task.vectorStatus = 'failed';
        task.vectorError = message;
        await this.persistVectorStatus(task.bookId, 'failed', message);
        getDegradationNotifier().notify({
            source: 'vector',
            from: 'vectorized',
            to: 'not_vectorized',
            reason: `《${task.bookName}》拆解后向量化失败：${message}`,
            severity: 'warning',
            recoverable: true,
        });
        log.warn(`[DeconstructionScheduler] 《${task.bookName}》向量化失败:`, error);
    }

    /** 向量状态落盘；旧测试 mock / 未初始化的 manager 缺少该能力时静默跳过 */
    private async persistVectorStatus(bookId: string, status: VectorStatus, error?: string): Promise<void> {
        try {
            if (typeof this.knowledgeBaseManager.setVectorStatus === 'function') {
                await this.knowledgeBaseManager.setVectorStatus(bookId, status, error);
            }
        } catch (e) {
            log.warn('[DeconstructionScheduler] 向量状态落盘失败:', e);
        }
    }

    private async vectorizeBook(bookId: string, bookName: string): Promise<void> {
        if (!this.vectorStore || typeof this.vectorStore.addBookSamples !== 'function') {
            log.info('[DeconstructionScheduler] vectorStore 未配置，跳过向量化');
            return;
        }

        // 拆解过程中书籍可能被删除：此时不要再写向量，否则向量文件会「复活」一本不存在的书。
        const alive = await this.knowledgeBaseManager.getBook(bookId);
        if (!alive) {
            log.info(`[DeconstructionScheduler] 书籍已删除，跳过向量化: ${bookId}`);
            return;
        }

        const samples: Array<{
            dimension: 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'original';
            category?: string;
            sample: string;
            position?: number;
        }> = [];

        // Phase 4.3：原文分块提供真实的句法/叙事质感。
        try {
            const sourceText = await this.knowledgeBaseManager.getSourceText(bookId);
            const chunks = chunkOriginalText(sourceText);
            chunks.forEach(chunk => {
                samples.push({
                    dimension: 'original',
                    category: '原文片段',
                    sample: chunk.sample,
                    position: chunk.position,
                });
            });
            if (chunks.length > 0) {
                log.info(`[DeconstructionScheduler] 《${bookName}》原文分块完成：${chunks.length} 段`);
            }
        } catch (e) {
            log.warn('[DeconstructionScheduler] 读取原文失败，仅向量化拆解报告样本:', e);
        }

        // 原文分块与拆解报告维度是互补关系，不是替代关系：
        // 风格/节奏/技巧/结构/人物/伏笔只存在于报告里，原文只提供句法质感。
        // 二者二选一会让另一类对应的 prompt 段整段消失（有原文时风格/节奏/技巧全空，
        // 无原文时「原文片段」恒空）。各提取器读不到文件时自行返回空数组。
        {
            const styleSamples = await this.extractStyleSamples(bookName);
            samples.push(...styleSamples);

            const rhythmSamples = await this.extractRhythmSamples(bookName);
            samples.push(...rhythmSamples);

            const techniqueSamples = await this.extractTechniqueSamples(bookName);
            samples.push(...techniqueSamples);

            const structureSamples = await this.extractStructureSamples(bookName);
            samples.push(...structureSamples);

            const characterSamples = await this.extractCharacterSamples(bookName);
            samples.push(...characterSamples);

            const foreshadowSamples = await this.extractForeshadowSamples(bookName);
            samples.push(...foreshadowSamples);
        }

        if (samples.length === 0) {
            // v4.83.1：这里曾经只是 log 后 return——调用方随后仍会
            // `recordVectorOutcome(task)` 把状态标成 'done'，于是「向量库实际为空、
            // 界面显示向量化成功、RAG 检索永远召回不到」三者并存。
            // 拆解完成不等于检索可用（A5），没有样本必须如实报失败。
            throw new Error('没有可向量化的内容：原文与拆解报告均未产出片段，检索不可用');
        }

        // 重新拆解时替换整本书向量，避免新旧样本叠加导致索引膨胀
        if (typeof this.vectorStore.replaceBookSamples === 'function') {
            await this.vectorStore.replaceBookSamples(bookId, bookName, samples);
        } else {
            await this.vectorStore.addBookSamples(bookId, bookName, samples);
        }
    }

    private async extractStyleSamples(bookName: string): Promise<Array<{ dimension: 'style'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'style'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookStyleFingerprintFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            let textContent = content;
            try {
                const json = JSON.parse(content);
                textContent = JSON.stringify(json, null, 2);
            } catch {
            }

            const paragraphs = this.extractParagraphs(textContent, 5);
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'style',
                    category: `风格示例${i + 1}`,
                    sample: this.truncateText(p, 200),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取风格示例失败:', e);
        }
        return samples;
    }

    private async extractRhythmSamples(bookName: string): Promise<Array<{ dimension: 'rhythm'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'rhythm'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookRhythmAnalysisFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            const paragraphs = this.extractParagraphs(content, 5);
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'rhythm',
                    category: `节奏示例${i + 1}`,
                    sample: this.truncateText(p, 200),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取节奏示例失败:', e);
        }
        return samples;
    }

    private async extractTechniqueSamples(bookName: string): Promise<Array<{ dimension: 'technique'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'technique'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookWritingTechniquesFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            const paragraphs = this.extractParagraphs(content, 6);
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'technique',
                    category: `技巧示例${i + 1}`,
                    sample: this.truncateText(p, 250),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取技巧示例失败:', e);
        }
        return samples;
    }

    private async extractStructureSamples(bookName: string): Promise<Array<{ dimension: 'structure'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'structure'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookStructureBreakdownFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            const paragraphs = this.extractParagraphs(content, 4);
            const categories = ['起', '承', '转', '合'];
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'structure',
                    category: categories[i] || `结构节点${i + 1}`,
                    sample: this.truncateText(p, 250),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取结构示例失败:', e);
        }
        return samples;
    }

    private async extractCharacterSamples(bookName: string): Promise<Array<{ dimension: 'character'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'character'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookCharacterExtractionFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            const paragraphs = this.extractParagraphs(content, 3);
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'character',
                    category: `人物${i + 1}`,
                    sample: this.truncateText(p, 300),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取人设示例失败:', e);
        }
        return samples;
    }

    private async extractForeshadowSamples(bookName: string): Promise<Array<{ dimension: 'foreshadow'; category?: string; sample: string; position?: number }>> {
        const samples: Array<{ dimension: 'foreshadow'; category?: string; sample: string; position?: number }> = [];
        try {
            const filePath = kbBookForeshadowDBFile(bookName, this.baseDir);
            const content = await this.readFileSafely(filePath);
            if (!content) return samples;

            const paragraphs = this.extractParagraphs(content, 5);
            paragraphs.forEach((p, i) => {
                samples.push({
                    dimension: 'foreshadow',
                    category: `伏笔${i + 1}`,
                    sample: this.truncateText(p, 200),
                    position: i,
                });
            });
        } catch (e) {
            log.warn('[DeconstructionScheduler] 提取伏笔示例失败:', e);
        }
        return samples;
    }

    private async readFileSafely(filePath: string): Promise<string | null> {
        try {
            const fs = this.getFS();
            return await fs.read(filePath);
        } catch {
            return null;
        }
    }

    private extractParagraphs(content: string, maxCount: number): string[] {
        const cleaned = content
            .replace(/^---\n[\s\S]*?\n---\n/, '')
            .replace(/^#.*$/gm, '')
            .trim();

        const paragraphs = cleaned
            .split(/\n\s*\n/)
            .map(p => p.trim())
            .filter(p => p.length > 20 && p.length < 500);

        return paragraphs.slice(0, maxCount);
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    private simpleHash(text: string): string {
        let hash = 0;
        const str = text.slice(0, 100000);
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    private async computeContentHash(text: string): Promise<string> {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(text.slice(0, 100000));
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            return this.simpleHash(text);
        }
    }

    /**
     * 释放资源（EngineRegistry.disposeAll 契约）：先冲刷待写队列，再销毁定时器/Worker。
     *
     * @returns 无
     */
    async dispose(): Promise<void> {
        try {
            await this.flushBatchWrites();
        } catch (e) {
            log.warn('[DeconstructionScheduler] 销毁前冲刷待写队列失败:', e);
        }
        this.destroy();
    }

    /**
     * 销毁调度器并清理资源。
     */
    destroy(): void {
        for (const timer of this.heartbeatTimers.values()) {
            clearInterval(timer);
        }
        this.heartbeatTimers.clear();

        for (const timer of this.watchdogTimers.values()) {
            clearInterval(timer);
        }
        this.watchdogTimers.clear();
        this.lastSeenAlive.clear();

        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
        this.abortControllers.clear();

        this.pauseResolvers.clear();
        this.dimensionStartTimes.clear();
        this.taskEmitters.clear();
        this.dimensionCache.clear();
        this.queue = [];
        this.tasks.clear();
        this.activeCount = 0;
        // v4.79.0（交叉审计 B-1）：防抖队列里的进度回调也要取消——否则卸载后仍会
        // 回调 knowledgeBaseManager.setBreakdownStatus（落在 flush 之后，写已释放对象）。
        this.progressDebounceManager.dispose();

        this.progressCallbacks.clear();
        this.completeCallbacks.clear();
        this.failedCallbacks.clear();

        const disposable = this.workerManager as unknown as { destroy?: () => void };
        if (typeof disposable.destroy === 'function') {
            disposable.destroy();
        }
    }
}
