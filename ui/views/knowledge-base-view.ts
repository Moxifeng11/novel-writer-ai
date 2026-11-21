import { ItemView, WorkspaceLeaf, Notice, Modal } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { KnowledgeBaseManager, type BookBasicInfo, type BreakdownStatus } from '@/services/knowledge-base-manager';
import { WebnovelKnowledgeBase, type GenreConfig } from '@/shared/webnovel-knowledge-base';
import { KnowledgeBaseConfigManager } from '@/engine/knowledge-base-config';
import { applyNwScope, progressHandle } from '@/utils/helpers';
import { AdaptiveDebounceManager } from '@/shared/adaptive-debounce-manager';
import { attachChartInteractions } from '@/ui/svg-charts';
import { DeconstructionScheduler, ALL_BREAKDOWN_DIMENSIONS, type BreakdownProgress, type BreakdownTask, type BreakdownDimension } from '@/engine/deconstruction-scheduler';
import { BatchImportModal } from '@/ui/batch-import-modal';
import { MiniSettingsModal } from '@/ui/mini-settings-modal';
import { summarizeVectorReconcile } from '@/engine/knowledge-vector-reconcile';
import { OperationConfirmModal } from '@/ui/components/progress';
import { createEmptyState } from '@/ui/components/empty-state';
import { createViewOpenGuard } from '@/shared/view-open-guard';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { createLogger } from '@/shared/logger';
import { classifyBook, mergeClassificationTags, type ClassificationResult } from '@/shared/content-classifier';
import { exportTextFile } from '@/shared/export-file';
import { ImportBookModal, EditBookModal, GenreEditModal, BatchOperationsModal } from './knowledge-base-modals';
import { canRefreshBookList, detailErrorMessage, emptyDetailData } from './knowledge-detail-state';
import { BookDetailRenderer } from './book-detail-renderer';
import { buildKbBookCard } from './kb-book-card';
import { buildKbStatsPanel } from './kb-stats-panel';
import { buildKbDetailActionButtons } from './kb-detail-actions';
import { buildKbConfigPanel } from './kb-config-panel';
import { renderCapabilityBanner, type CapabilityAction } from './capability-banner';
import { computeKnowledgeCapability, type EmbeddingAvailabilitySnapshot } from './knowledge-capability';
import { computeKnowledgeFlowStatus, renderLinkStatus } from './link-status';
import { filterDegradationsBySource, getDegradationNotifier } from '@/shared/degradation-notifier';
import { getSharedEmbeddingProvider } from '@/engine/embedding/embedding-service';
import { rebuildAllVectorsWithConfirm } from '@/ui/vector-rebuild-action';
import { t } from '@/i18n';
import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal';
import {
    formatBreakdownStatusLabel,
    formatTaskStatusLabel,
    formatChannelLabel,
    formatWordCount as formatWordCountText,
    formatDate as formatDateText,
    formatDateTime as formatDateTimeText,
    formatDuration as formatDurationText,
} from './kb-format';
import type { KbStatusKey } from './kb-panels-logic';
import {
    filterAndSortBooks,
    countBooksInChannel,
    countBooksByGenre,
    countBooksBySubGenre,
} from './kb-book-filter';
import {
    getTaskFilterOptions,
    filterAndSortTasks,
    computeTaskStats,
    selectSelectedCancellable,
    selectSelectedDeletable,
    selectActiveTasks,
    isAllFilteredSelected,
    formatSelectionLabel,
    resolveTaskRowActions,
    resolveTaskStatusTone,
    shouldShowTaskProgress,
    shouldShowTaskMessage,
    shouldShowTaskTiming,
    shouldShowTaskError,
    formatTaskDimensions,
    formatTaskProgressPercent,
    disabledOpacity,
    disabledCursor,
} from './kb-task-panel';

 import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from '@/ui/model-quick-switcher';
import { yieldToUI } from '@/shared/yield';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import {
    buildKnowledgeFlowInput,
    countUncategorizedBooks,
    removeTagAt,
    summarizeTaskCounts,
} from './kb-view-logic';
import {
    buildGenreImportPlan,
    parseGenreImportPayload,
    splitGenreConflicts,
} from './kb-config-import-logic';

const log = createLogger('KnowledgeBaseView');
import {
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookCommercialAnalysisFile,
    kbBookReadabilityAnalysisFile,
} from '@/shared/paths';

/**
 * 知识库视图类型常量。
 */
export const VIEW_TYPE_KNOWLEDGE_BASE = 'novel-writer-knowledge-base';

type MainTabKey = 'books' | 'config' | 'tasks' | 'stats';
type BookDetailTabKey = 'overview' | 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'commercial' | 'readability' | 'tags';

/**
 * 旧版向量设置键视图。
 *
 * 仅用于兼容历史 `data.json`（新键为 `vectorProviderType` / `vectorOllamaModel`），
 * 只读不写，避免为遗留键在设置类型中新增字段。
 */
interface LegacyVectorSettingsView {
    vectorProvider?: string;
    vectorModel?: string;
    vectorConnectionStatus?: string;
}
type ConfigCategoryKey = 'male' | 'female' | 'neutral';

interface FilterState {
    channel: ConfigCategoryKey | 'all';
    primaryGenre: string | 'all' | 'uncategorized';
    subGenre: string | 'all';
    keyword: string;
    status: BreakdownStatus | 'all';
    sortBy: 'createdAt' | 'updatedAt' | 'wordCount' | 'quality';
    sortOrder: 'asc' | 'desc';
}

/**
 * 知识库文风数据。
 */
export interface StyleData {
    sentenceRhythm?: {
        avgSentenceLength: number;
        medianSentenceLength: number;
        stdSentenceLength: number;
        sentenceTypeDistribution: { declarative: number; interrogative: number; exclamatory: number; elliptical: number };
        lengthDistribution: { short: number; medium: number; long: number };
    };
    wordPreference?: {
        topWords: Array<{ word: string; count: number; frequency: number }>;
        posPreference: { verb: number; adjective: number; adverb: number };
        modalParticles: { total: number; perThousand: number; topParticles: Array<{ word: string; count: number }> };
        idiomDensity: number;
        colloquialismLevel: number;
    };
    narrativeStyle?: {
        perspective: string;
        perspectiveConfidence: number;
        descriptionRatio: { appearance: number; environment: number; action: number; psychology: number; total: number };
        narrationRatio: number;
        dialogueRatio: number;
    };
    rhetoric?: {
        metaphor: number;
        personification: number;
        parallelism: number;
        rhetoricalQuestion: number;
        hyperbole: number;
        antithesis: number;
        total: number;
        perThousand: number;
    };
    dialogueStyle?: {
        dialogueRatio: number;
        promptWordPreference: Array<{ word: string; count: number }>;
        avgDialogueLength: number;
        lengthDistribution: { short: number; medium: number; long: number };
    };
    paragraphStructure?: {
        avgParagraphLength: number;
        medianParagraphLength: number;
        lengthDistribution: { short: number; medium: number; long: number; veryLong: number };
    };
    overallStyle?: {
        primaryStyle: string;
        secondaryStyle?: string;
        confidence: number;
        styleScores: Record<string, number>;
    };
    vocabularyRichness?: {
        ttr: number;
        mtld: number;
        yulesK: number;
        hapaxLegomena: number;
        vocabularySize: number;
        level: string;
        score: number;
    };
    fiveSenses?: {
        distribution: Record<string, number>;
        counts: Record<string, number>;
        perThousand: Record<string, number>;
        dominantSense: string;
        balanceScore: number;
        level: string;
    };
    stats?: {
        totalChars: number;
        totalSentences: number;
        totalParagraphs: number;
    };
}

/**
 * 知识库节奏数据。
 */
export interface RhythmData {
    emotionPoints?: Array<{ position: number; type: string; intensity: number; description: string; chapterIndex: number }>;
    chapterRhythm?: Array<{ chapterIndex: number; emotionScore: number; tensionScore: number; densityScore: number; description: string }>;
    coolPoints?: Array<{ x: number; y: number; label: string; category: string }>;
    plotStages?: Array<{ name: string; start: number; end: number; description?: string }>;
    structureMatches?: Array<{ label: string; value: number }>;
    hookAnalysis?: {
        hooks?: Array<{ chapterIndex: number; type: string; intensity: number; excerpt: string }>;
        hookRate: number;
        typeDistribution: Record<string, number>;
        noHookChapters: number[];
        avgIntensity: number;
    };
    tensionCurve?: {
        overallTensionAvg: number;
        overallTensionStd: number;
        waveformScore: number;
        peaks: Array<{ chapterIndex: number; intensity: number; type: string }>;
        valleys: Array<{ chapterIndex: number; intensity: number }>;
    };
    nrcEmotion?: {
        overallDistribution: Record<string, number>;
        dominantEmotion?: string;
        emotionVolatility?: number;
    };
    emotionArc?: {
        arcType: string;
        confidence: number;
        chapterEmotions: number[];
        description?: string;
    };
    stats?: {
        avgRhythm: number;
        rhythmVariance: number;
        climaxCount: number;
        coolPointCount: number;
        avgEmotionIntensity: number;
        hookRate?: number;
        avgTension?: number;
    };
}

/**
 * 知识库技法数据。
 */
export interface TechniqueData {
    techniques?: Array<{ id: string; name: string; category: string; confidence: number; count: number; genreWeight: number; qualityScore: number }>;
    typeDistribution?: Record<string, number>;
    qualityScore?: { totalScore: number; diversityScore: number; coverageScore: number };
}

/**
 * 知识库结构数据。
 */
export interface StructureData {
    qcchSegments?: Array<{ type: string; startPosition: number; endPosition: number; chapterRange: number[] }>;
    rhythmUnits?: Array<{ level: string; index: number; title: string; startPosition: number; endPosition: number; wordCount: number }>;
    threeLineStructure?: {
        mainLine?: { description: string; keyNodes?: Array<{ position: number; description: string }> };
        subLine?: { description: string; keyNodes?: Array<{ position: number; description: string }> };
        romanceLine?: { description: string; keyNodes?: Array<{ position: number; description: string }> };
    };
    structureType?: string;
    stats?: { volumeCount: number; chapterCount: number; avgChapterWordCount: number; totalWordCount: number };
}

/**
 * 知识库人物数据。
 */
export interface CharacterKnowledgeData {
    characters?: Array<{
        id: string;
        name: string;
        aliases: string[];
        role: string;
        gender: string;
        firstAppearance: number;
        lastAppearance: number;
        appearanceCount: number;
        mentionCount: number;
        personality: string[];
        abilities: string[];
        pageRank?: number;
        characterArc?: {
            initialState?: {
                personality: string[];
                abilities: string[];
                goals: string[];
                description?: string;
            };
            growthNodes?: Array<{
                position: number;
                event: string;
                changeType: string;
                trigger?: string;
            }>;
            transformationType: string;
            finalState?: {
                personality: string[];
                abilities: string[];
                description?: string;
            };
            completeness: number;
        };
        importance?: {
            appearanceFrequency: number;
            dialogueRatio: number;
            plotDrivingScore: number;
            relationshipCentrality: number;
            perspectiveRatio: number;
            totalScore: number;
            tier: string;
        };
    }>;
    relations?: Array<{
        fromId: string;
        toId: string;
        type: string;
        weight: number;
        keyEvents?: string[];
    }>;
    relationDetails?: Array<{
        fromId: string;
        toId: string;
        type: string;
        strength: number;
        history?: Array<{ position: number; fromType: string; toType: string; event?: string }>;
        keyEvents: string[];
    }>;
    relationships?: Array<{ from: string; to: string; type: string; weight: number }>;
    allCharacters?: Array<{ name: string; role?: string; tier?: string; tags?: string[] }>;
    mainCharacters?: Array<{ name: string }>;
    networkCentrality?: {
        centrality?: Array<{
            characterName: string;
            degreeCentrality: number;
            closenessCentrality: number;
            betweennessCentrality: number;
            pagerank: number;
            role: string;
        }>;
    };
    stats?: {
        totalCharacters: number;
        mainCharacterCount: number;
        avgAppearancePerCharacter: number;
    };
}

/**
 * 知识库伏笔数据。
 */
export interface ForeshadowData {
    foreshadows?: Array<{
        id: string;
        name: string;
        type: string;
        totalAppearances: number;
        importance: number;
        hasResolution: boolean;
    }>;
    typeDistribution?: Record<string, number>;
    stats?: {
        totalForeshadows: number;
        resolvedCount: number;
        unresolvedCount: number;
        avgImportance: number;
    };
    qualityScore?: {
        totalScore: number;
        diversityScore: number;
        resolutionRate: number;
        signalNoiseRatio: number;
        coverageScore: number;
    };
}

/**
 * 知识库商业数据。
 */
export interface CommercialData {
    overallScore?: number;
    overallLevel?: string;
    goldenThreeChapters?: {
        totalScore?: number;
        subScores?: {
            openingConflict?: number;
            infoDensity?: number;
            protagonistGoal?: number;
            goldenFinger?: number;
            chapterHooks?: number;
        };
        improvementSuggestions?: Array<{
            category: string;
            severity: string;
            suggestion: string;
        }>;
    };
    waveRhythm?: {
        complianceRate?: number;
        violations?: Array<{
            type: string;
            startChapter: number;
            endChapter: number;
            gap: number;
            threshold: number;
        }>;
    };
}

/**
 * 知识库可读性数据。
 */
export interface ReadabilityData {
    overallScore?: number;
    showTell?: {
        overallRatio?: number;
        showPercentage?: number;
        tellPercentage?: number;
        highRiskTellSegments?: Array<{
            excerpt: string;
            confidence: number;
        }>;
        stats?: {
            totalSegments?: number;
            showCount?: number;
            tellCount?: number;
            mixedCount?: number;
        };
        suggestions?: Array<{
            type: string;
            severity: string;
            message: string;
        }>;
    };
    aiTrace?: {
        overallScore?: number;
        level?: string;
        dimensions?: Record<string, { score: number; description: string }>;
        highRiskParagraphs?: Array<{
            excerpt: string;
            score: number;
            reasons: string[];
        }>;
    };
}

/** 主页签（每次调用取当前语言，语言切换后重建侧栏即生效）。 */
function mainTabs(): { key: MainTabKey; label: string; icon: string }[] {
    return [
        { key: 'books', label: t('knowledgebase.tab.books'), icon: '📚' },
        { key: 'config', label: t('knowledgebase.tab.config'), icon: '⚙️' },
        { key: 'tasks', label: t('knowledgebase.tab.tasks'), icon: '📋' },
        { key: 'stats', label: t('knowledgebase.tab.stats'), icon: '📊' },
    ];
}

/** 书籍详情页签（每次调用取当前语言）。 */
function bookDetailTabs(): Record<BookDetailTabKey, string> {
    return {
        overview: t('knowledgebase.dim.overview'),
        style: t('knowledgebase.dim.style'),
        rhythm: t('knowledgebase.dim.rhythm'),
        technique: t('knowledgebase.dim.technique'),
        structure: t('knowledgebase.dim.structure'),
        character: t('knowledgebase.dim.character'),
        foreshadow: t('knowledgebase.dim.foreshadow'),
        commercial: t('knowledgebase.dim.commercial'),
        readability: t('knowledgebase.dim.readability'),
        tags: t('knowledgebase.dim.tags'),
    };
}

/** 拆解维度短标签（每次调用取当前语言；调用处已有 dimensionLabels 局部变量，故不取该名）。 */
function bookDimensionLabels(): Record<BreakdownDimension, string> {
    return {
        style: t('knowledgebase.dim.style'),
        rhythm: t('knowledgebase.dim.rhythm'),
        technique: t('knowledgebase.dim.technique'),
        structure: t('knowledgebase.dim.structure'),
        character: t('knowledgebase.dim.character'),
        foreshadow: t('knowledgebase.dim.foreshadow'),
        commercial: t('knowledgebase.dim.commercial'),
        readability: t('knowledgebase.dim.readability'),
    };
}

/**
 * 知识库视图。
 */
export class KnowledgeBaseView extends ItemView {
    plugin: NovelWriterPlugin;
    kbManager: KnowledgeBaseManager | null = null;
    kb: WebnovelKnowledgeBase | null = null;
    configManager: KnowledgeBaseConfigManager | null = null;
    deconstructionScheduler: DeconstructionScheduler | null = null;
    private progressUnsubscribe?: () => void;
    private completeUnsubscribe?: () => void;

    private activeMainTab: MainTabKey = 'books';
    private mainLayout!: HTMLElement;
    private leftSidebar!: HTMLElement;
    private rightPanel!: HTMLElement;
    private rightContentEl!: HTMLElement;
    private monitorBarEl!: HTMLElement;

    private allBooks: BookBasicInfo[] = [];
    /** 嵌入模型可用性快照（异步探测，供能力横幅提示「去配置」） */
    private embeddingSnapshot?: EmbeddingAvailabilitySnapshot;
    private filter: FilterState = {
        channel: 'all',
        primaryGenre: 'all',
        subGenre: 'all',
        keyword: '',
        status: 'all',
        sortBy: 'createdAt',
        sortOrder: 'desc',
    };

    private collapsedGenres: Set<string> = new Set();
    private selectedBookId: string | null = null;
    private activeBookDetailTab: BookDetailTabKey = 'overview';
    private expandedItems: Record<string, boolean> = {};
    private foreshadowFilter: string = 'all';

    private styleData: StyleData | null = null;
    private rhythmData: RhythmData | null = null;
    private techniqueData: TechniqueData | null = null;
    private structureData: StructureData | null = null;
    private characterData: CharacterKnowledgeData | null = null;
    private foreshadowData: ForeshadowData | null = null;
    private commercialData: CommercialData | null = null;
    private readabilityData: ReadabilityData | null = null;

    private bookDetailRenderer!: BookDetailRenderer;
    /** 侧栏模型快速切换器（原右下角状态栏浮窗的替代入口） */
    private modelSwitcher: ModelQuickSwitcherHandle | null = null;

    private configCategory: ConfigCategoryKey = 'male';
    private selectedGenreId: string | null = null;
    private configEditMode: boolean = false;

    private taskFilter: 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled' = 'all';
    private selectedTaskIds: Set<string> = new Set();
    private isStartingDeconstruction: boolean = false;
    private debounceManager = new AdaptiveDebounceManager({ debug: false });

    private loadToken = 0;
    /** 详情数据加载序号：切换书籍时让旧的异步加载作废 */
    private detailLoadSeq = 0;
    private viewClosed = false;
    /** L3-1：onOpen 代次；onClose 作废，await 续体不再渲染 */
    private readonly openGuard = createViewOpenGuard();
    private booksLoadError: string | null = null;
    private detailLoadError: string | null = null;

    private completeRefreshPending = false;
    private completeRefreshTimer?: number;

    private progressRafPending = false;
    private progressRafId?: number;
    private latestProgress?: BreakdownProgress;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    /**
     * 视图类型。
     * @returns 类型
     */
    getViewType() {
        return VIEW_TYPE_KNOWLEDGE_BASE;
    }

    /**
     * 显示名。
     * @returns 名称
     */
    getDisplayText() {
        return t('knowledgebase.view.title');
    }

    /**
     * 图标。
     * @returns 图标
     */
    getIcon() {
        return 'book-open';
    }

    /**
     * 打开视图并渲染。
     */
    async onOpen() {
        // L3-1：同一 View 实例可能被重新 attach（重开标签/跨窗口移动），
        // onClose 置位的 viewClosed 必须复位，否则调度器订阅回调永久静默。
        this.viewClosed = false;
        const openToken = this.openGuard.begin();
        applyNwScope(this);
        this.kbManager = this.plugin.knowledgeBaseManager ?? null;
        this.kb = this.kbManager?.getKnowledgeBase() ?? null;
        this.deconstructionScheduler = this.plugin.deconstructionScheduler ?? null;

        this.bookDetailRenderer = new BookDetailRenderer({
            app: this.app,
            getKb: () => this.kb,
            getKbManager: () => this.kbManager,
            getStyleData: () => this.styleData,
            getRhythmData: () => this.rhythmData,
            getTechniqueData: () => this.techniqueData,
            getStructureData: () => this.structureData,
            getCharacterData: () => this.characterData,
            getForeshadowData: () => this.foreshadowData,
            getCommercialData: () => this.commercialData,
            getReadabilityData: () => this.readabilityData,
            getCurrentBook: () => this.getCurrentBook(),
            formatWordCount: (c) => this.formatWordCount(c),
            formatDateTime: (ts) => this.formatDateTime(ts),
            formatDuration: (ms) => this.formatDuration(ms),
            getChannelLabel: (ch) => this.getChannelLabel(ch),
            getStatusLabel: (s) => this.getStatusLabel(s),
            getDeconstructionScheduler: () => this.deconstructionScheduler,
            getExpandedItems: () => this.expandedItems,
            getForeshadowFilter: () => this.foreshadowFilter,
            setForeshadowFilter: (v) => { this.foreshadowFilter = v; },
            getDimensionLabels: () => bookDimensionLabels(),

            onClassifyBook: (book) => this.autoClassifyBook(book),
            onEditBook: (book) => this.openEditModal(book),
            onApplyGenreRecommendation: (book, rec) => this.applyGenreRecommendation(book, rec),
            onAddCustomTag: (book, tag) => this.handleAddCustomTag(book, tag),
            onDeleteCustomTag: (book, idx) => this.handleDeleteCustomTag(book, idx),
            onRequestReRender: () => this.renderBookDetail(),
        });

        if (this.kbManager) {
            const baseDir = this.kbManager.getBaseDir();
            this.configManager = new KnowledgeBaseConfigManager(this.app, baseDir);
            await this.loadCustomGenres();
            if (!this.openGuard.isCurrent(openToken)) return;
        }

        this.renderLayout();
        await this.loadBooks();
        if (!this.openGuard.isCurrent(openToken)) return;
        this.renderLeftSidebar();
        this.renderRightPanel();

        this.setupSchedulerListeners();
    }

    /**
     * 关闭视图并释放资源。
     */
    async onClose() {
        this.viewClosed = true;
        // L3-1：作废代次，onOpen 的 await 续体不再渲染
        this.openGuard.invalidate();
        this.modelSwitcher?.destroy();
        this.modelSwitcher = null;
        if (this.progressUnsubscribe) {
            this.progressUnsubscribe();
            this.progressUnsubscribe = undefined;
        }
        if (this.completeUnsubscribe) {
            this.completeUnsubscribe();
            this.completeUnsubscribe = undefined;
        }
        if (this.completeRefreshTimer) {
            window.clearTimeout(this.completeRefreshTimer);
            this.completeRefreshTimer = undefined;
        }
        if (this.progressRafId !== undefined) {
            cancelAnimationFrame(this.progressRafId);
            this.progressRafId = undefined;
        }
        this.debounceManager.dispose();
    }

    private async loadCustomGenres(): Promise<void> {
        if (!this.configManager || !this.kb) return;
        await this.configManager.load();
        const customGenres = this.configManager.getFullCustomGenres();
        customGenres.forEach(genre => {
            this.kb?.addCustomGenre(genre);
        });
    }

    private setupSchedulerListeners(): void {
        if (!this.deconstructionScheduler) return;

        this.progressUnsubscribe?.();
        this.completeUnsubscribe?.();

        this.progressUnsubscribe = this.deconstructionScheduler.onProgress((progress: BreakdownProgress) => {
            if (this.viewClosed) return;
            this.latestProgress = progress;
            if (this.progressRafPending) return;
            this.progressRafPending = true;
            this.progressRafId = window.requestAnimationFrame(() => {
                this.progressRafPending = false;
                this.progressRafId = undefined;
                this.handleProgressUpdate();
            });
        });

        this.completeUnsubscribe = this.deconstructionScheduler.onTaskComplete(() => {
            if (this.viewClosed) return;
            if (this.completeRefreshPending) return;
            this.completeRefreshPending = true;
            this.completeRefreshTimer = window.setTimeout(() => {
                this.completeRefreshPending = false;
                this.completeRefreshTimer = undefined;
                void this.handleCompleteRefresh();
            }, 0);
        });
    }

    private handleProgressUpdate(): void {
        if (this.viewClosed || !this.latestProgress) return;
        const progress = this.latestProgress;
        if (progress.bookId === this.selectedBookId && this.activeMainTab === 'books') {
            void this.refreshBookInfo();
        }
        if (this.activeMainTab === 'tasks') {
            this.renderTasksTab();
        }
        this.renderMonitorBar();
    }

    private async handleCompleteRefresh(): Promise<void> {
        if (this.viewClosed) return;
        const currentBookId = this.selectedBookId;
        if (currentBookId && this.activeMainTab === 'books') {
            await this.loadBookDetailData(currentBookId);
            if (this.viewClosed || this.selectedBookId !== currentBookId) return;
            this.renderBookDetail();
        }
        await this.loadBooks();
        if (this.viewClosed) return;
        if (this.activeMainTab === 'books') {
            this.renderBooksList();
        }
        if (this.activeMainTab === 'stats') {
            this.renderStatsTab();
        }
        if (this.activeMainTab === 'tasks') {
            this.renderTasksTab();
        }
    }

    private async refreshBookInfo(): Promise<void> {
        if (!this.selectedBookId || !this.kbManager) return;
        const currentBookId = this.selectedBookId;
        const book = await this.kbManager.getBook(currentBookId);
        if (this.viewClosed || this.selectedBookId !== currentBookId) return;
        if (book) {
            const idx = this.allBooks.findIndex(b => b.id === book.id);
            if (idx >= 0) {
                this.allBooks[idx] = book;
            }
            this.refreshDetailActionButtons();
            if (this.activeBookDetailTab === 'overview') {
                this.renderBookDetail();
            }
        }
    }

    private async loadBooks(): Promise<void> {
        if (!this.kbManager) {
            this.allBooks = [];
            this.booksLoadError = null;
            this.vectorReconcile = null;
            return;
        }
        try {
            this.allBooks = await this.kbManager.getAllBooks();
            this.booksLoadError = null;
            await this.refreshVectorReconcile();
        } catch (e) {
            this.allBooks = [];
            this.booksLoadError = e instanceof Error ? e.message : String(e);
            this.vectorReconcile = null;
            log.error('[KnowledgeBaseView] 加载书籍列表失败:', e);
        }
        await this.detectEmbeddingAvailability();
    }

    /**
     * 探测嵌入模型可用性（v4.83.1）。
     *
     * 默认 embedding provider 是本地 Ollama；没装/没启动时向量化必然失败，
     * 而旧界面只显示「待处理/失败 N」，用户不知道要去配什么。
     * 探测失败本身也要如实记录（不能因为探测抛错就当作「可用」）。
     */
    private async detectEmbeddingAvailability(): Promise<void> {
        const provider = getSharedEmbeddingProvider();
        if (!provider) {
            this.embeddingSnapshot = { available: false, reason: t('knowledgebase.view.embeddingUninitialized') };
            return;
        }
        let providerLabel: string | undefined;
        try {
            const info = provider.getProviderInfo();
            const type = this.plugin.settings.vectorProviderType || 'ollama';
            const model = info?.model || '';
            providerLabel = model ? `${type} · ${model}` : type;
        } catch {
            // provider 信息拿不到不影响可用性判定
        }
        try {
            const availability = await provider.isAvailable();
            this.embeddingSnapshot = {
                available: availability.available === true,
                reason: availability.available === true ? undefined : availability.reason,
                providerLabel,
            };
        } catch (e) {
            this.embeddingSnapshot = {
                available: false,
                reason: e instanceof Error ? e.message : String(e),
                providerLabel,
            };
        }
    }

    private renderLayout(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('nw-kb-view');

        // 2026-11-16 视觉重构 Slice A：外壳布局改为语义类（规范见
        // docs/design/2026-11-16-visual-refactor-standard.md），样式集中在 27-knowledge-base.css。
        this.mainLayout = containerEl.createDiv({ cls: 'nw-kb-main-layout' });

        this.leftSidebar = this.mainLayout.createDiv({ cls: 'nw-kb-left-sidebar' });

        this.rightPanel = this.mainLayout.createDiv({ cls: 'nw-kb-right-panel' });

        this.rightContentEl = this.rightPanel.createDiv({ cls: 'nw-kb-right-content' });

        this.monitorBarEl = this.rightPanel.createDiv({ cls: 'nw-kb-monitor-bar' });
    }

    private renderLeftSidebar(): void {
        this.leftSidebar.empty();

        const header = this.leftSidebar.createDiv({ cls: 'nw-kb-sidebar-header' });
        header.createEl('h2', { text: t('knowledgebase.view.title'), cls: 'nw-kb-sidebar-title' });

        // 界面流转：直达工作台 / 协同写作 / 指纹库
        const navRow = header.createDiv({ cls: 'nw-kb-nav-row' });
        const backBtn = navRow.createEl('button', { text: t('knowledgebase.view.back'), cls: 'nw-kb-nav-btn', attr: { title: t('knowledgebase.view.backTitle') } });
        backBtn.addEventListener('click', () => void this.plugin.openFullWriterView());
        const coBtn = navRow.createEl('button', { text: t('knowledgebase.view.coWrite'), cls: 'nw-kb-nav-btn', attr: { title: t('knowledgebase.view.coWriteTitle') } });
        coBtn.addEventListener('click', () => void this.plugin.openCoWritingFromActiveContext());
        const fpBtn = navRow.createEl('button', { text: t('knowledgebase.view.fingerprint'), cls: 'nw-kb-nav-btn', attr: { title: t('knowledgebase.view.fingerprintTitle') } });
        fpBtn.addEventListener('click', () => this.plugin.executeCommand('novel-writer-fingerprint-library'));

        // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到知识库侧栏（四个主界面之一）。
        // 侧栏会因页签切换被反复重建：先销毁旧句柄，否则每次切页签都多留一个订阅回调。
        this.modelSwitcher?.destroy();
        this.modelSwitcher = renderModelQuickSwitcher(header, this.plugin);

        const nav = this.leftSidebar.createDiv({ cls: 'nw-kb-sidebar-nav' });

        mainTabs().forEach(tab => {
            // 选中态用修饰类（--active），不再拼内联样式
            const active = this.activeMainTab === tab.key;
            const item = nav.createDiv({
                cls: `nw-kb-nav-item${active ? ' nw-kb-nav-item--active' : ''}`,
            });
            item.createSpan({ text: tab.icon, cls: 'nw-kb-nav-icon' });
            item.createSpan({ text: tab.label });

            item.addEventListener('click', () => {
                this.activeMainTab = tab.key;
                this.renderLeftSidebar();
                this.renderRightPanel();
            });
        });

        // v4.83.1：知识库界面直达「添加同人设定」。
        // 此前该入口只在命令面板、工具目录与项目选择器里，知识库里没有——
        // 而「同人设定」和「参考书籍」是同一件事的两面（一个用来源、一个用拆解素材）。
        const fanficSection = this.leftSidebar.createDiv({ cls: 'nw-kb-fanfic-section' });
        const fanficEntry = fanficSection.createEl('button', {
            text: t('knowledgebase.view.addFanfic'),
            cls: 'nw-btn nw-btn-secondary nw-kb-fanfic-btn',
            attr: {
                title: t('knowledgebase.view.addFanficTitle'),
            },
        });
        fanficEntry.addEventListener('click', () => {
            new AddFanficSettingModal(this.app, this.plugin, this.plugin.getActiveProject() || undefined).open();
        });

        // 注：原来的 nw-text-muted-11 从未在任何样式表中定义（死类），移除后外观不变
        const footer = this.leftSidebar.createDiv({ cls: 'nw-kb-sidebar-footer' });
        footer.createSpan({ text: t('knowledgebase.view.totalBooks', { count: this.allBooks.length }) });
    }

    private renderRightPanel(): void {
        this.rightContentEl.empty();

        switch (this.activeMainTab) {
            case 'books':
                this.renderBooksTab();
                break;
            case 'config':
                this.renderConfigTab();
                break;
            case 'tasks':
                this.renderTasksTab();
                break;
            case 'stats':
                this.renderStatsTab();
                break;
        }

        this.renderMonitorBar();
    }

    // ============== Tab 1: 参考书籍 ==============
    private renderBooksTab(): void {
        // 主 Tab 切回「参考书籍」时这里总是重建列表。若保留上次的详情选中态，
        // renderBookListOnly() 的 `selectedBookId` 守卫会让搜索/状态/排序永久失效。
        this.selectedBookId = null;
        this.activeBookDetailTab = 'overview';
        this.expandedItems = {};
        this.foreshadowFilter = 'all';

        const content = this.rightContentEl.createDiv({ cls: 'nw-kb-books-tab' });

        const genrePanel = content.createDiv({ cls: 'nw-kb-genre-panel' });

        const genreHeader = genrePanel.createDiv({ cls: 'nw-kb-genre-header nw-section-header' });
        genreHeader.createEl('h3', { text: t('knowledgebase.view.genreTitle'), cls: 'nw-kb-genre-title' });

        const channelTabs = genrePanel.createDiv({ cls: 'nw-kb-channel-tabs' });

        const channels: { id: ConfigCategoryKey | 'all'; name: string }[] = [
            { id: 'all', name: t('knowledgebase.view.genreAll') },
            { id: 'male', name: t('knowledgebase.view.genreMale') },
            { id: 'female', name: t('knowledgebase.view.genreFemale') },
            { id: 'neutral', name: t('knowledgebase.view.genreNeutral') },
        ];

        channels.forEach(ch => {
            const tab = channelTabs.createDiv({
                cls: `nw-kb-channel-tab${this.filter.channel === ch.id ? ' nw-kb-channel-tab--active' : ''}`,
            });
            tab.textContent = ch.name;
            tab.addEventListener('click', () => {
                this.filter.channel = ch.id as ConfigCategoryKey | 'all';
                this.filter.primaryGenre = 'all';
                this.filter.subGenre = 'all';
                this.renderRightPanel();
            });
        });

        const genreList = genrePanel.createDiv({ cls: 'nw-kb-genre-list' });

        this.renderGenreList(genreList);

        const booksPanel = content.createDiv({ cls: 'nw-kb-books-panel' });

        // 能力边界：拆解完成 ≠ 检索可用；把当前阶段直接放在列表顶部
        const capability = computeKnowledgeCapability(this.allBooks, this.embeddingSnapshot);
        const bannerActions: CapabilityAction[] = [];
        // 嵌入模型不可用时给「去配置」直达入口（此前用户只能看到「待处理/失败 N」这个数字，
        // 不知道问题出在没配 embedding）
        if (this.embeddingSnapshot && !this.embeddingSnapshot.available) {
            bannerActions.push({
                label: t('knowledgebase.view.configEmbed'),
                primary: true,
                onClick: () => {
                    if (!this.plugin.openPluginSettings()) {
                        new Notice(t('knowledgebase.view.configEmbedNotice'), 7000);
                    }
                },
            });
        }
        bannerActions.push({
            label: t('knowledgebase.view.revectorize'),
            onClick: () => {
                void rebuildAllVectorsWithConfirm(this.app, this.plugin);
            },
        });
        renderCapabilityBanner(booksPanel, {
            title: t('knowledgebase.view.capabilityTitle'),
            ...capability,
            actions: bannerActions,
        });

        // 阶段 A4：链路状态——能力横幅回答「处于什么阶段」，这里回答「断在哪一环」
        // 阶段 B1：同时带上运行时降级（静态检查看不到「配了但在运行中回退」）
        const vectorStore = this.plugin.knowledgeVectorStore;
        const recentDegradations = filterDegradationsBySource(
            getDegradationNotifier().getEvents(),
            ['vector', 'injection'],
        ).map(event => event.reason);
        // DSH-20261112-14：对账结果作为降级提示注入——「已加载 N 本」旁边必须能看到
        // 「其中 M 本是孤儿」，否则就是 -08 指出的假绿。对账在 loadBooks 异步预取。
        const vectorReconcile = this.vectorReconcile;
        // 审计 #B9：文案单源化——与 agent 诊断共用 summarizeVectorReconcile
        const orphanNote = vectorReconcile
            ? summarizeVectorReconcile(vectorReconcile, t('knowledgebase.view.cleanupHint'))
            : null;
        renderLinkStatus(booksPanel, computeKnowledgeFlowStatus(buildKnowledgeFlowInput(this.allBooks, {
            // DSH-20261112-17：环节级呈现——「检索」的 detail 直接带孤儿数并降为 warn
            orphanCount: vectorReconcile?.orphans.length ?? 0,
            embeddingReady: this.embeddingSnapshot?.available === true,
            storeLoadedBooks: vectorStore && typeof vectorStore.getLoadedBookIds === 'function'
                ? vectorStore.getLoadedBookIds().length
                : 0,
            // 区分「尚未加载」与「加载了但没书」——前者是未知，后者才是真断
            storeReady: vectorStore && typeof vectorStore.isLoaded === 'function'
                ? vectorStore.isLoaded()
                : false,
            // 审计 #B1：孤儿提示放队首——link-status 只渲染前 3 条降级，追加会被挤掉
            degradations: orphanNote ? [orphanNote, ...recentDegradations] : recentDegradations,
        })));

        this.renderBooksToolbar(booksPanel);
        this.renderBooksListContent(booksPanel);
    }

    private renderGenreList(container: HTMLElement): void {
        const allItem = this.createGenreNavItem({
            id: 'all',
            name: t('knowledgebase.list.allBooks'),
            icon: '📚',
            count: this.getFilteredBooksCount('all'),
            isActive: this.filter.primaryGenre === 'all',
            onClick: () => {
                this.filter.primaryGenre = 'all';
                this.filter.subGenre = 'all';
                this.renderRightPanel();
            }
        });
        container.appendChild(allItem);

        const uncategorizedCount = countUncategorizedBooks(this.allBooks, this.filter.channel);

        const uncategorizedItem = this.createGenreNavItem({
            id: 'uncategorized',
            name: t('knowledgebase.list.uncategorized'),
            icon: '📁',
            count: uncategorizedCount,
            isActive: this.filter.primaryGenre === 'uncategorized',
            onClick: () => {
                this.filter.primaryGenre = 'uncategorized';
                this.filter.subGenre = 'all';
                this.renderRightPanel();
            }
        });
        container.appendChild(uncategorizedItem);

        const divider = container.createDiv({
            cls: 'nw-kb-nav-divider'
        });
        void divider;

        const genres = this.getGenresForCurrentChannel();
        genres.forEach(genre => {
            const group = this.createGenreGroup(genre);
            container.appendChild(group);
        });
    }

    private createGenreNavItem(opts: {
        id: string;
        name: string;
        icon: string;
        count: number;
        isActive: boolean;
        onClick: () => void;
        isSub?: boolean;
    }): HTMLElement {
        // 2026-11-16：内联样式与死类（nw-text-muted-11 从未定义）改为语义类
        const item = createDiv({
            cls: `nw-kb-genre-item${opts.isSub ? ' nw-kb-genre-item--sub' : ''}${opts.isActive ? ' nw-kb-genre-item--active' : ''}`,
        });

        const left = item.createDiv({ cls: 'nw-kb-genre-item-main' });
        left.createSpan({ text: opts.icon, cls: 'nw-kb-genre-item-icon' });
        left.createSpan({ text: opts.name, cls: 'nw-kb-genre-item-label' });

        item.createSpan({ text: opts.count.toString(), cls: 'nw-kb-genre-count' });

        item.addEventListener('click', opts.onClick);
        return item;
    }

    private createGenreGroup(genre: GenreConfig): HTMLElement {
        const group = createDiv();
        const isExpanded = !this.collapsedGenres.has(genre.id);
        const count = this.getGenreBookCount(genre.id);

        const header = createDiv({
            cls: `nw-kb-genre-group-header${this.filter.primaryGenre === genre.id ? ' nw-kb-genre-group-header--active' : ''}`,
        });

        const left = header.createDiv({ cls: 'nw-kb-genre-item-main' });
        const toggle = left.createSpan({
            text: isExpanded ? '▼' : '▶',
            cls: 'nw-kb-genre-toggle',
        });
        left.createSpan({ text: '📂', cls: 'nw-kb-genre-item-icon' });
        left.createSpan({ text: genre.name, cls: 'nw-kb-genre-item-label' });

        header.createSpan({ text: count.toString(), cls: 'nw-kb-genre-count' });

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.collapsedGenres.has(genre.id)) {
                this.collapsedGenres.delete(genre.id);
            } else {
                this.collapsedGenres.add(genre.id);
            }
            this.renderRightPanel();
        });

        header.addEventListener('click', () => {
            this.filter.primaryGenre = genre.id;
            this.filter.subGenre = 'all';
            this.renderRightPanel();
        });

        group.appendChild(header);

        if (isExpanded && genre.subGenres && genre.subGenres.length > 0) {
            const subList = createDiv();

            const allSubItem = this.createGenreNavItem({
                id: `sub-all-${genre.id}`,
                name: t('knowledgebase.list.allSubgenres'),
                icon: '•',
                count: count,
                isActive: this.filter.primaryGenre === genre.id && this.filter.subGenre === 'all',
                isSub: true,
                onClick: () => {
                    this.filter.primaryGenre = genre.id;
                    this.filter.subGenre = 'all';
                    this.renderRightPanel();
                }
            });
            subList.appendChild(allSubItem);

            genre.subGenres.forEach(sub => {
                const subCount = this.getSubGenreBookCount(genre.id, sub.id);
                const subItem = this.createGenreNavItem({
                    id: sub.id,
                    name: sub.name,
                    icon: '📄',
                    count: subCount,
                    isActive: this.filter.primaryGenre === genre.id && this.filter.subGenre === sub.id,
                    isSub: true,
                    onClick: () => {
                        this.filter.primaryGenre = genre.id;
                        this.filter.subGenre = sub.id;
                        this.renderRightPanel();
                    }
                });
                subList.appendChild(subItem);
            });

            group.appendChild(subList);
        }

        return group;
    }

    private getGenresForCurrentChannel(): GenreConfig[] {
        if (!this.kb) return [];
        if (this.filter.channel === 'all') {
            return this.kb.getAllGenres();
        }
        return this.kb.getGenresByCategory(this.filter.channel);
    }

    private getGenreBookCount(genreId: string): number {
        return countBooksByGenre(this.allBooks, genreId, this.filter.channel);
    }

    private getSubGenreBookCount(genreId: string, subGenreId: string): number {
        return countBooksBySubGenre(this.allBooks, genreId, subGenreId, this.filter.channel);
    }

    private getFilteredBooksCount(scope: 'all'): number {
        void scope;
        return countBooksInChannel(this.allBooks, this.filter.channel);
    }

    private renderBooksToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: 'nw-kb-toolbar nw-section-header' });

        const topRow = toolbar.createDiv({ cls: 'nw-kb-toolbar-row' });

        const searchInput = topRow.createEl('input', {
            type: 'text',
            cls: 'nw-kb-search-input',
            attr: { placeholder: t('knowledgebase.list.searchPlaceholder') },
        });
        searchInput.value = this.filter.keyword;
        searchInput.addEventListener('input', () => {
            this.filter.keyword = searchInput.value.trim();
            this.debounceManager.debounceFixed('book-search', () => {
                this.renderBookListOnly();
            }, 200);
        });

        const importBtn = topRow.createEl('button', {
            text: t('knowledgebase.list.import'),
            cls: 'nw-btn nw-btn-primary nw-btn-sm nw-kb-toolbar-action',
            attr: { title: t('knowledgebase.list.importTitle') }
        });
        importBtn.addEventListener('click', () => this.handleImportBooks());

        const batchImportBtn = topRow.createEl('button', {
            text: t('knowledgebase.list.batchImport'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-toolbar-action',
            attr: { title: t('knowledgebase.list.batchImportTitle') }
        });
        batchImportBtn.addEventListener('click', () => this.handleBatchImport());

        const batchBtn = topRow.createEl('button', {
            text: t('knowledgebase.list.batch'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-toolbar-action',
            attr: { title: t('knowledgebase.list.batchTitle') }
        });
        batchBtn.addEventListener('click', () => this.handleBatchOperations());

        const classifyBtn = topRow.createEl('button', {
            text: t('knowledgebase.list.batchClassify'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-toolbar-action',
            attr: { title: t('knowledgebase.list.batchClassifyTitle') }
        });
        classifyBtn.addEventListener('click', () => void this.handleBatchClassify());

        const reconcileBtn = topRow.createEl('button', {
            text: t('knowledgebase.list.reconcile'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-toolbar-action',
            attr: { title: t('knowledgebase.list.reconcileTitle') }
        });
        reconcileBtn.addEventListener('click', () => void this.handleVectorReconcile());

        const filterRow = toolbar.createDiv({ cls: 'nw-kb-toolbar-filters' });

        const statusWrap = filterRow.createDiv({ cls: 'nw-kb-filter-group' });
        statusWrap.createSpan({ text: t('knowledgebase.list.statusLabel'), cls: 'nw-kb-filter-label' });
        const statusSelect = statusWrap.createEl('select', { cls: 'nw-kb-select' });
        const statusOptions: { value: BreakdownStatus | 'all'; label: string }[] = [
            { value: 'all', label: t('knowledgebase.list.statusAll') },
            { value: 'pending', label: t('knowledgebase.list.statusPending') },
            { value: 'processing', label: t('knowledgebase.list.statusProcessing') },
            { value: 'completed', label: t('knowledgebase.list.statusCompleted') },
            { value: 'failed', label: t('knowledgebase.list.statusFailed') },
            { value: 'interrupted', label: t('knowledgebase.list.statusInterrupted') },
        ];
        statusOptions.forEach(opt => {
            const option = statusSelect.createEl('option', { value: opt.value, text: opt.label });
            if (this.filter.status === opt.value) option.selected = true;
        });
        statusSelect.addEventListener('change', () => {
            this.filter.status = statusSelect.value as BreakdownStatus | 'all';
            this.renderBookListOnly();
        });

        const sortWrap = filterRow.createDiv({ cls: 'nw-kb-filter-group' });
        sortWrap.createSpan({ text: t('knowledgebase.list.sortLabel'), cls: 'nw-kb-filter-label' });
        const sortSelect = sortWrap.createEl('select', { cls: 'nw-kb-select' });
        const sortOptions: { value: string; label: string }[] = [
            { value: 'createdAt_desc', label: t('knowledgebase.list.sortCreatedDesc') },
            { value: 'createdAt_asc', label: t('knowledgebase.list.sortCreatedAsc') },
            { value: 'updatedAt_desc', label: t('knowledgebase.list.sortUpdatedDesc') },
            { value: 'updatedAt_asc', label: t('knowledgebase.list.sortUpdatedAsc') },
            { value: 'wordCount_desc', label: t('knowledgebase.list.sortWordsDesc') },
            { value: 'wordCount_asc', label: t('knowledgebase.list.sortWordsAsc') },
            { value: 'quality_desc', label: t('knowledgebase.list.sortQualityDesc') },
            { value: 'quality_asc', label: t('knowledgebase.list.sortQualityAsc') },
        ];
        sortOptions.forEach(opt => {
            const option = sortSelect.createEl('option', { value: opt.value, text: opt.label });
            const curVal = `${this.filter.sortBy}_${this.filter.sortOrder}`;
            if (curVal === opt.value) option.selected = true;
        });
        sortSelect.addEventListener('change', () => {
            const [sortBy, sortOrder] = sortSelect.value.split('_');
            this.filter.sortBy = sortBy as FilterState['sortBy'];
            this.filter.sortOrder = sortOrder as 'asc' | 'desc';
            this.renderBookListOnly();
        });
    }

    private renderBooksLoadError(container: HTMLElement): boolean {
        if (!this.booksLoadError) return false;
        const box = container.createDiv({ cls: 'nw-kb-error' });
        box.createDiv({ text: t('knowledgebase.list.loadFailed'), cls: 'nw-kb-error-title' });
        box.createDiv({ text: this.booksLoadError, cls: 'nw-kb-error-detail' });
        const retry = box.createEl('button', { text: t('knowledgebase.common.retry'), cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
        retry.addEventListener('click', () => {
            void this.loadBooks().then(() => {
                if (this.viewClosed) return;
                this.renderBookListOnly();
            });
        });
        return true;
    }

    private renderBooksListContent(container: HTMLElement): void {
        const listContainer = container.createDiv({ cls: 'nw-kb-book-list-container' });

        const books = this.getFilteredBooks();

        if (this.renderBooksLoadError(listContainer)) return;

        const header = listContainer.createDiv({ cls: 'nw-kb-book-list-header' });
        header.createSpan({ text: t('knowledgebase.view.totalBooks', { count: books.length }), cls: 'nw-kb-book-list-count' });

        if (books.length === 0) {
            this.renderBooksEmptyState(listContainer);
            return;
        }

        const grid = listContainer.createDiv({
            cls: 'nw-kb-book-grid',
        });

        books.forEach(book => {
            const card = this.createBookCard(book);
            grid.appendChild(card);
        });
    }

    private renderBooksList(): void {
        if (this.activeMainTab !== 'books') return;
        this.renderBookListOnly();
    }

    private renderBookListOnly(): void {
        if (!canRefreshBookList(this.activeMainTab, this.selectedBookId)) return;

        const listContainer = this.rightPanel.querySelector('.nw-kb-book-list-container');
        if (!listContainer) return;

        const containerEl = listContainer as HTMLElement;
        const scrollTop = containerEl.scrollTop;

        containerEl.empty();

        const books = this.getFilteredBooks();

        if (this.renderBooksLoadError(containerEl)) {
            containerEl.scrollTop = scrollTop;
            return;
        }

        const header = containerEl.createDiv({
            cls: 'nw-kb-book-list-header'
        });
        header.createSpan({ text: t('knowledgebase.view.totalBooks', { count: books.length }), cls: 'nw-kb-book-list-count' });

        if (books.length === 0) {
            this.renderBooksEmptyState(containerEl);
            containerEl.scrollTop = 0;
            return;
        }

        const grid = containerEl.createDiv({
            cls: 'nw-kb-book-grid',
        });

        books.forEach(book => {
            const card = this.createBookCard(book);
            grid.appendChild(card);
        });

        containerEl.scrollTop = scrollTop;
    }

    private renderBooksEmptyState(container: HTMLElement): void {
        // NBI-06: 导入入口统一由工具栏提供，空态不再重复渲染同一组按钮
        const emptyState = createEmptyState({
            icon: 'book',
            title: t('knowledgebase.list.emptyTitle'),
            description: t('knowledgebase.list.emptyDesc')
        });
        container.appendChild(emptyState);
    }

    private getFilteredBooks(): BookBasicInfo[] {
        return filterAndSortBooks(this.allBooks, this.filter);
    }

    /**
     * 构建书籍列表卡片。
     *
     * DOM 构建细节已抽到 kb-book-card.ts 的 buildKbBookCard，本方法只负责把
     * 视图的选中状态、文案格式化、内容分类与详情跳转能力注入宿主回调。
     *
     * @param book 书籍基础信息
     * @returns 卡片根元素
     */
    private createBookCard(book: BookBasicInfo): HTMLElement {
        return buildKbBookCard(book, {
            isSelectedBook: id => id === this.selectedBookId,
            getStatusLabel: s => this.getStatusLabel(s as BreakdownStatus),
            formatWordCount: n => this.formatWordCount(n),
            classifyBookInfo: b => this.classifyBookInfo(b),
            getGenreName: id => this.kb?.getGenre(id)?.name ?? '',
            formatDate: ts => this.formatDate(ts),
            openBookDetail: b => this.openBookDetail(b),
            onRetryVectorize: b => { void this.retryVectorizeBook(b); },
        });
    }

    /** 对账缓存（loadBooks 异步预取；render 同步读，避免渲染里 await） */
    private vectorReconcile: { orphans: string[]; missing: string[]; healthy: string[] } | null = null;

    private async refreshVectorReconcile(): Promise<void> {
        const store = this.plugin.knowledgeVectorStore;
        if (!store || typeof store.reconcileWithIndex !== 'function') {
            this.vectorReconcile = null;
            return;
        }
        try {
            this.vectorReconcile = await store.reconcileWithIndex(this.allBooks.map(b => b.id));
        } catch (e) {
            log.warn('[KnowledgeBaseView] 向量对账失败:', e);
            this.vectorReconcile = null;
        }
    }

    /**
     * 索引 ↔ 向量库对账 + 显式清理入口（DSH-20261112-14）。
     *
     * 默认只报告（Notice 摘要）；孤儿存在时弹确认框，用户明确确认才删除，
     * 删除走 store.removeOrphanVectors（fail-closed，未确认一个都不删）。
     */
    /** 重入守卫（审计 #B4）：对账/清理进行中再点按钮直接忽略 */
    private reconcileInFlight = false;

    private async handleVectorReconcile(): Promise<void> {
        if (this.reconcileInFlight) return;
        this.reconcileInFlight = true;
        try {
            const store = this.plugin.knowledgeVectorStore;
            if (!store || typeof store.reconcileWithIndex !== 'function') {
                showErrorNotice(t('knowledgebase.reconcile.notInited'));
                return;
            }
            // 审计 #A3：出报告前先刷新 allBooks——视图打开期间可能有新书入库，
            // 用陈旧列表判孤儿会误删刚入库书的向量。
            await this.loadBooks();
            const report = await store.reconcileWithIndex(this.allBooks.map(b => b.id));
            const healthyNote = t('knowledgebase.reconcile.healthy', { count: report.healthy.length });
            const missingNote = report.missing.length > 0 ? t('knowledgebase.reconcile.missing', { count: report.missing.length }) : '';
            if (report.orphans.length === 0) {
                showSuccessNotice(t('knowledgebase.reconcile.doneNoOrphan', { healthy: healthyNote, missing: missingNote }), { title: t('knowledgebase.reconcile.title') });
                return;
            }
            new Notice(t('knowledgebase.reconcile.doneOrphan', { healthy: healthyNote, missing: missingNote, count: report.orphans.length }), 6000);
            // 审计 #B7：id 列表截断展示，防止撑爆确认弹窗
            const shownIds = report.orphans.slice(0, 5).join('、') + (report.orphans.length > 5 ? ' ' + t('knowledgebase.reconcile.orphanList', { count: report.orphans.length }) : '');
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('knowledgebase.reconcile.cleanTitle'),
                description: t('knowledgebase.reconcile.cleanDesc', { count: report.orphans.length, ids: shownIds }),
                confirmText: t('knowledgebase.reconcile.cleanOk'),
                cancelText: t('knowledgebase.reconcile.reportOnly'),
            });
            if (!confirmed) {
                showSuccessNotice(t('knowledgebase.reconcile.kept'), { title: t('knowledgebase.reconcile.title') });
                return;
            }
            // 审计 #A2：把当前索引 id 一并传给 store，锁外复核孤儿身份——
            // 弹窗期间入库的书即便残留在报告里也会被 store 拒绝删除。
            const result = await store.removeOrphanVectors(report.orphans, {
                confirmed: true,
                kbBookIds: this.allBooks.map(b => b.id),
            });
            if (result.removed.length > 0) {
                showSuccessNotice(t('knowledgebase.reconcile.cleaned', { count: result.removed.length }), { title: t('knowledgebase.reconcile.title') });
            }
            if (result.skipped.length > 0) {
                showWarningNotice(t('knowledgebase.reconcile.skipped', { count: result.skipped.length }), { title: t('knowledgebase.reconcile.title') });
            }
            await this.loadBooks();
            this.renderRightPanel();
        } catch (e) {
            // 审计 #B4：void 点击处理器不能留 unhandled rejection
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.reconcile.failed') });
        } finally {
            this.reconcileInFlight = false;
        }
    }

    /**
     * 单本书重试向量化（v4.83.1）。
     *
     * 只重算向量，不重新拆解、不调用 AI；成功后刷新列表与能力横幅。
     *
     * @param book - 目标书籍
     */
    private async retryVectorizeBook(book: BookBasicInfo): Promise<void> {
        const scheduler = this.deconstructionScheduler;
        if (!scheduler || typeof scheduler.revectorizeBook !== 'function') {
            new Notice(t('knowledgebase.revectorize.noScheduler'), 6000);
            return;
        }
        new Notice(t('knowledgebase.revectorize.running', { name: book.name }), 4000);
        try {
            await scheduler.revectorizeBook(book.id, book.name);
            new Notice(t('knowledgebase.revectorize.done', { name: book.name }), 5000);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            showErrorNotice(message, { title: t('knowledgebase.revectorize.failed', { name: book.name }), timeout: 10000 });
        } finally {
            // 无论成功失败都刷新：状态徽标与能力横幅需要反映最新结果
            await this.loadBooks();
            this.renderRightPanel();
        }
    }

    private classifyBookInfo(book: BookBasicInfo): ClassificationResult {
        return classifyBook({
            name: book.name,
            author: book.author,
            themeTags: book.themeTags,
            techniqueTags: book.techniqueTags,
            customTags: book.customTags,
            primaryGenre: book.primaryGenre,
            genreChannel: book.genreChannel,
            wordCount: book.wordCount,
            synopsis: book.synopsis,
            qualityScores: book.qualityScores,
        });
    }

    private async openBookDetail(book: BookBasicInfo): Promise<void> {
        this.loadToken++;
        const myToken = this.loadToken;

        this.selectedBookId = book.id;
        this.activeBookDetailTab = 'overview';
        this.expandedItems = {};
        this.foreshadowFilter = 'all';

        const booksPanel = this.rightPanel.querySelector('.nw-kb-books-panel');
        if (!booksPanel) return;

        (booksPanel as HTMLElement).empty();

        this.renderBooksToolbar(booksPanel as HTMLElement);

        // 2026-11-16 视觉重构 Slice D：详情外壳与页签条语义化
        const detailContainer = (booksPanel as HTMLElement).createDiv({ cls: 'nw-kb-detail-container' });

        const backBtn = detailContainer.createEl('button', {
            text: t('knowledgebase.detail.backToList'),
            cls: 'nw-btn nw-btn-ghost nw-btn-sm nw-kb-detail-back',
            attr: {},
        });
        backBtn.addEventListener('click', () => this.closeBookDetail());

        const titleRow = detailContainer.createDiv({ cls: 'nw-kb-detail-title-row' });
        titleRow.createEl('h2', { text: book.name, cls: 'nw-kb-detail-title' });

        const actions = titleRow.createDiv({ cls: 'nw-kb-detail-actions' });
        this.renderDetailActionButtons(book, actions);

        const classification = this.classifyBookInfo(book);
        if (classification.tags.length > 0) {
            const strip = detailContainer.createDiv({ cls: 'nw-kb-class-strip' });
            const stripHead = strip.createDiv({ cls: 'nw-kb-class-strip-head' });
            stripHead.createSpan({ text: t('knowledgebase.detail.autoClass', { primary: classification.primary }), cls: 'nw-kb-class-primary' });
            stripHead.createSpan({ text: classification.summary, cls: 'nw-kb-class-summary' });
            const applyBtn = stripHead.createEl('button', {
                text: t('knowledgebase.detail.writeTags'),
                cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-class-apply',
                attr: { title: t('knowledgebase.detail.writeTagsTitle') }
            });
            applyBtn.addEventListener('click', () => {
                void this.handleApplyDimensionTags(book);
            });
            const chipWrap = strip.createDiv({ cls: 'nw-kb-class-chips' });
            classification.tags.forEach(tag => {
                chipWrap.createSpan({
                    text: `${tag.dimension}·${tag.label}`,
                    cls: 'nw-kb-class-tag',
                    attr: { title: t('knowledgebase.detail.tagReason', { reason: tag.reason, pct: (tag.confidence * 100).toFixed(0) }) }
                });
            });
        }

        const tabsWrapper = detailContainer.createDiv({ cls: 'nw-kb-detail-tabs-wrapper' });
        const tabs = tabsWrapper.createDiv({ cls: 'nw-kb-detail-tabs' });
        const tabKeys: BookDetailTabKey[] = ['overview', 'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability', 'tags'];
        tabKeys.forEach(key => {
            const tab = tabs.createEl('button', {
                text: bookDetailTabs()[key],
                cls: `nw-kb-detail-tab${this.activeBookDetailTab === key ? ' nw-kb-detail-tab--active' : ''}`,
                attr: { type: 'button' },
            });
            tab.addEventListener('click', () => {
                this.activeBookDetailTab = key;
                this.renderBookDetail();
            });
        });

        const tabContent = detailContainer.createDiv({
            cls: 'nw-kb-detail-tab-content',
            attr: {}
        });

        const loadingEl = tabContent.createDiv({
            text: t('knowledgebase.detail.loading'),
            cls: 'nw-kb-detail-loading'
        });
        void loadingEl;

        await this.loadBookDetailData(book.id);
        if (this.loadToken !== myToken || this.viewClosed) return;
        if (this.detailLoadError) {
            this.renderDetailLoadError(tabContent as HTMLElement);
            return;
        }
        this.renderBookDetail();
    }

    /** 详情区加载失败框：初次加载与「重试失败」共用，避免渲染上一本书的残留数据 */
    private renderDetailLoadError(tabContent: HTMLElement): void {
        tabContent.empty();
        const errorBox = tabContent.createDiv({ cls: 'nw-kb-error' });
        errorBox.createDiv({ text: t('knowledgebase.detail.loadFailed'), cls: 'nw-kb-error-title' });
        errorBox.createDiv({ text: this.detailLoadError || detailErrorMessage(), cls: 'nw-kb-error-detail' });
        const retry = errorBox.createEl('button', { text: t('knowledgebase.common.retry'), cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
        retry.addEventListener('click', () => this.retryBookDetailLoad());
    }

    private retryBookDetailLoad(): void {
        const bookId = this.selectedBookId;
        if (!bookId) return;
        void this.loadBookDetailData(bookId).then(() => {
            if (this.viewClosed) return;
            const tabContent = this.rightPanel.querySelector('.nw-kb-detail-tab-content');
            if (!(tabContent instanceof HTMLElement)) return;
            if (this.detailLoadError) {
                this.renderDetailLoadError(tabContent);
                return;
            }
            this.renderBookDetail();
        });
    }

    private renderBookDetail(): void {
        if (this.viewClosed) return;
        const book = this.getCurrentBook();
        if (!book) return;

        const tabContent = this.rightPanel.querySelector('.nw-kb-detail-tab-content');
        if (!tabContent) return;

        // 后台刷新（拆解完成等）失败时也走错误框，而不是用已清空的数据渲染「暂无数据」
        if (this.detailLoadError) {
            this.renderDetailLoadError(tabContent as HTMLElement);
            return;
        }

        (tabContent as HTMLElement).empty();

        switch (this.activeBookDetailTab) {
            case 'overview':
                this.bookDetailRenderer.renderBookOverviewTab(tabContent as HTMLElement, book);
                break;
            case 'style':
                this.bookDetailRenderer.renderBookStyleTab(tabContent as HTMLElement);
                break;
            case 'rhythm':
                this.bookDetailRenderer.renderBookRhythmTab(tabContent as HTMLElement);
                break;
            case 'technique':
                this.bookDetailRenderer.renderBookTechniqueTab(tabContent as HTMLElement);
                break;
            case 'structure':
                this.bookDetailRenderer.renderBookStructureTab(tabContent as HTMLElement);
                break;
            case 'character':
                this.bookDetailRenderer.renderBookCharacterTab(tabContent as HTMLElement);
                break;
            case 'foreshadow':
                this.bookDetailRenderer.renderBookForeshadowTab(tabContent as HTMLElement);
                break;
            case 'commercial':
                this.bookDetailRenderer.renderBookCommercialTab(tabContent as HTMLElement);
                break;
            case 'readability':
                this.bookDetailRenderer.renderBookReadabilityTab(tabContent as HTMLElement);
                break;
            case 'tags':
                this.bookDetailRenderer.renderBookTagsTab(tabContent as HTMLElement, book);
                break;
        }
    }

    private closeBookDetail(): void {
        this.selectedBookId = null;
        this.activeBookDetailTab = 'overview';
        this.expandedItems = {};
        this.foreshadowFilter = 'all';
        this.renderRightPanel();
    }

    private async loadBookDetailData(bookId: string): Promise<void> {
        if (!this.kbManager) return;

        // 并发保护：打开 A 的详情后立刻点 B，A 的后半段 await 会晚于 B 完成并覆盖 B 的数据。
        // 每次调用发一个序号，任何一步 await 回来后发现序号已过期就整体放弃。
        const seq = ++this.detailLoadSeq;
        const stale = () => this.viewClosed || seq !== this.detailLoadSeq || this.selectedBookId !== bookId;

        // 先清空上一本书的分析数据：本轮任何一步失败都不会把旧书的数据挂在新书详情页下。
        const emptyDetail = emptyDetailData();
        this.styleData = emptyDetail.styleData;
        this.rhythmData = emptyDetail.rhythmData;
        this.techniqueData = emptyDetail.techniqueData;
        this.structureData = emptyDetail.structureData;
        this.characterData = emptyDetail.characterData;
        this.foreshadowData = emptyDetail.foreshadowData;
        this.commercialData = emptyDetail.commercialData;
        this.readabilityData = emptyDetail.readabilityData;

        let book: BookBasicInfo | undefined;
        try {
            book = await this.kbManager.getBook(bookId);
            this.detailLoadError = null;
        } catch (e) {
            this.detailLoadError = detailErrorMessage({ error: e });
            log.error('[KnowledgeBaseView] 读取书籍详情失败:', e);
            return;
        }
        if (stale()) return;
        if (!book) {
            // 书已被删除 / 列表数据过期：必须落错误态，否则详情区停在「加载中...」
            this.detailLoadError = detailErrorMessage({ missing: true });
            return;
        }

        const idx = this.allBooks.findIndex(b => b.id === bookId);
        if (idx >= 0) {
            this.allBooks[idx] = book;
        }

        const fs = (this.app.vault.adapter as { exists(p: string): Promise<boolean>; read(p: string): Promise<string> });
        const baseDir = this.getKbBaseDir();

        try {
            const stylePath = kbBookStyleFingerprintFile(book.name, baseDir);
            if (await fs.exists(stylePath)) {
                if (stale()) return;
                const content = await fs.read(stylePath);
                if (stale()) return;
                try {
                    // 风格指纹文件是 Markdown frontmatter 格式，需要提取 frontmatter
                    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    if (match) {
                        this.styleData = JSON.parse(match[1]);
                    } else {
                        this.styleData = JSON.parse(content);
                    }
                } catch (e) {
                    log.warn('[KnowledgeBaseView] Failed to parse style fingerprint:', e);
                    this.styleData = {};
                }
            } else {
                this.styleData = null;
            }
        } catch (e) {
            log.warn('[KnowledgeBaseView] Failed to load style fingerprint:', e);
            this.styleData = null;
        }

        if (stale()) return;
        this.rhythmData = await this.loadMarkdownFrontmatter(
            kbBookRhythmAnalysisFile(book.name, baseDir)
        ) as RhythmData | null;

        if (stale()) return;
        this.techniqueData = await this.loadMarkdownFrontmatter(
            kbBookWritingTechniquesFile(book.name, baseDir)
        ) as TechniqueData | null;

        if (stale()) return;
        this.structureData = await this.loadMarkdownFrontmatter(
            kbBookStructureBreakdownFile(book.name, baseDir)
        ) as StructureData | null;

        if (stale()) return;
        this.characterData = await this.loadMarkdownFrontmatter(
            kbBookCharacterExtractionFile(book.name, baseDir)
        ) as CharacterKnowledgeData | null;

        if (stale()) return;
        this.foreshadowData = await this.loadMarkdownFrontmatter(
            kbBookForeshadowDBFile(book.name, baseDir)
        ) as ForeshadowData | null;

        if (stale()) return;
        this.commercialData = await this.loadMarkdownFrontmatter(
            kbBookCommercialAnalysisFile(book.name, baseDir)
        ) as CommercialData | null;

        if (stale()) return;
        this.readabilityData = await this.loadMarkdownFrontmatter(
            kbBookReadabilityAnalysisFile(book.name, baseDir)
        ) as ReadabilityData | null;
    }

    private async loadMarkdownFrontmatter(path: string): Promise<Record<string, unknown> | null> {
        const fs = (this.app.vault.adapter as { exists(p: string): Promise<boolean>; read(p: string): Promise<string> });
        try {
            if (!(await fs.exists(path))) return null;
            const content = await fs.read(path);
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch (e) {
                log.warn(`[KnowledgeBaseView] Failed to parse frontmatter JSON: ${path}`, e);
                return null;
            }
        } catch (e) {
            log.warn(`[KnowledgeBaseView] Failed to load frontmatter: ${path}`, e);
            return null;
        }
    }

    private getCurrentBook(): BookBasicInfo | undefined {
        if (!this.selectedBookId) return undefined;
        return this.allBooks.find(b => b.id === this.selectedBookId);
    }

    private getKbBaseDir(): string | undefined {
        return this.kbManager?.getBaseDir();
    }

    private renderChart(container: HTMLElement, svgHtml: string): void {
        setSanitizedHtml(container, svgHtml);
        const chartContainer = container.querySelector('.nw-chart-container') as HTMLElement;
        if (chartContainer) {
            attachChartInteractions(chartContainer);
        }
    }

    private getGenreName(genreId?: string): string {
        if (!genreId || !this.kb) return t('knowledgebase.list.uncategorized');
        const genre = this.kb.getGenre(genreId);
        return genre?.name || genreId;
    }

    private async autoClassifyBook(book: BookBasicInfo): Promise<void> {
        if (!this.kbManager) return;
        new Notice(t('knowledgebase.detail.classifying'));
        try {
            const result = await this.kbManager.classifyBook(book.id);
            await this.loadBooks();
            await this.refreshBookInfo();
            this.renderBookDetail();
            showSuccessNotice(`${result.primaryGenre.name} · ${result.primarySubGenre?.name || ''}`, { title: t('knowledgebase.detail.classifyDoneTitle') });
        } catch (e) {
            log.error('自动分类失败:', e);
            showErrorNotice(t('knowledgebase.detail.classifyFailed'));
        }
    }

    private async handleApplyDimensionTags(book: BookBasicInfo): Promise<void> {
        if (!this.kbManager) {
            new Notice(t('knowledgebase.detail.kbNotInited'));
            return;
        }
        const result = this.classifyBookInfo(book);
        if (result.tags.length === 0) {
            new Notice(t('knowledgebase.detail.insufficient'));
            return;
        }
        const existing = book.customTags || [];
        const merged = mergeClassificationTags(existing, result);
        if (merged.length === existing.length) {
            new Notice(t('knowledgebase.detail.tagsUpToDate'));
            return;
        }
        try {
            await this.kbManager.updateBook(book.id, { customTags: merged });
            await this.loadBooks();
            await this.refreshBookInfo();
            if (!this.viewClosed) {
                this.renderLeftSidebar();
                this.renderBookListOnly();
                this.renderBookDetail();
            }
            showSuccessNotice(t('knowledgebase.detail.tagsWritten', { count: result.tags.length, summary: result.summary }), { timeout: 4000 });
        } catch (e) {
            log.error('[KnowledgeBaseView] 写入维度标签失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.detail.writeTagsFailedTitle') });
        }
    }

    private async handleBatchClassify(): Promise<void> {
        if (!this.kbManager || this.allBooks.length === 0) {
            new Notice(t('knowledgebase.detail.noClassifiable'));
            return;
        }
        const total = this.allBooks.length;
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.batchClassify.title'),
            description: t('knowledgebase.batchClassify.desc', { total }),
            confirmText: t('knowledgebase.batchClassify.ok'),
            cancelText: t('knowledgebase.common.cancel'),
        });
        if (!confirmed || this.viewClosed) return;

        let updated = 0;
        let skipped = 0;
        let processed = 0;
        const progress = progressHandle('kb-batch-classify', t('knowledgebase.batchClassify.progressZero', { total }));
        try {
            for (const book of [...this.allBooks]) {
                if (this.viewClosed) break;
                const result = this.classifyBookInfo(book);
                processed++;
                if (result.tags.length === 0) {
                    skipped++;
                } else {
                    const existing = book.customTags || [];
                    const merged = mergeClassificationTags(existing, result);
                    if (merged.length === existing.length) {
                        skipped++;
                    } else {
                        try {
                            await this.kbManager.updateBook(book.id, { customTags: merged });
                            updated++;
                        } catch (e) {
                            skipped++;
                            log.warn(`[KnowledgeBaseView] 批量归类失败: ${book.name}`, e);
                        }
                    }
                }
                if (processed % 20 === 0) {
                    progress.setMessage(t('knowledgebase.batchClassify.progress', { done: processed, total }));
                    await yieldToUI();
                }
            }
        } finally {
            progress.hide();
        }
        await this.loadBooks();
        if (this.viewClosed) return;
        this.renderLeftSidebar();
        this.renderBookListOnly();
        showSuccessNotice(t('knowledgebase.batchClassify.done', { updated, skipped }), { title: t('knowledgebase.batchClassify.doneTitle'), timeout: 4000 });
    }

    private async applyGenreRecommendation(book: BookBasicInfo, rec: { genreId: string; subGenreId?: string; confidence: number }): Promise<void> {
        if (!this.kbManager) return;
        const genreName = !rec.genreId || !this.kb ? t('knowledgebase.list.uncategorized') : (this.kb.getGenre(rec.genreId)?.name || rec.genreId);
        const subGenreName = !rec.genreId || !rec.subGenreId || !this.kb ? t('knowledgebase.list.uncategorized') : (this.kb.getSubGenre(rec.genreId, rec.subGenreId)?.name || rec.subGenreId);
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.detail.applyTitle'),
            description: t('knowledgebase.detail.applyDesc'),
            steps: [t('knowledgebase.detail.applyStepGenre', { name: genreName }), t('knowledgebase.detail.applyStepSub', { name: subGenreName })],
            confirmText: t('knowledgebase.detail.applyOk'),
            cancelText: t('knowledgebase.common.cancel'),
        });
        if (!confirmed) return;
        try {
            await this.kbManager.recordGenreCorrection(book.id, {
                primaryGenre: rec.genreId,
                primarySubGenre: rec.subGenreId,
            });
            await this.loadBooks();
            await this.refreshBookInfo();
            this.renderBookDetail();
            this.renderLeftSidebar();
            showSuccessNotice(t('knowledgebase.detail.updated'));
        } catch (e) {
            log.error('更新分类失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.detail.updateFailed') });
        }
    }

    // ============== Tab 2: 知识参考库配置 ==============
    /**
     * 渲染知识参考库配置页签。
     *
     * DOM 构建细节已抽到 kb-config-panel.ts 的 buildKbConfigPanel，本方法只负责
     * 把可写状态回调（分类切换 / 题材选中）与其余宿主能力注入面板。
     *
     * 可写状态保留在视图：configCategory 的切换写入与 selectedGenreId 的选中
     * 写入均由下方 host 回调完成，面板自身不持有任何状态。
     */
    private renderConfigTab(): void {
        buildKbConfigPanel(this.rightContentEl, {
            configCategory: this.configCategory,
            kb: this.kb,
            isSelectedGenre: genreId => genreId === this.selectedGenreId,
            getChannelLabel: channel => this.getChannelLabel(channel),
            switchCategory: category => {
                this.configCategory = category;
                this.selectedGenreId = null;
                this.renderRightPanel();
            },
            selectGenre: genre => {
                this.selectedGenreId = genre.id;
                this.openGenreEditModal(genre);
            },
            addGenre: () => this.handleAddGenre(),
            importConfig: () => this.handleImportConfig(),
            exportConfig: () => this.handleExportConfig(),
            resetConfig: () => {
                this.handleResetConfig().catch(err => {
                    log.error('恢复默认配置失败:', err);
                });
            },
            deleteGenre: genreId => {
                this.handleDeleteGenre(genreId).catch(err => { // silent-ok: handleDeleteGenre 内部已有失败 Notice
                    log.error('删除题材失败:', err);
                });
            },
        });
    }

    private handleAddGenre(): void {
        const defaultGenre: GenreConfig = {
            id: '',
            name: '',
            category: this.configCategory,
            description: '',
            personalityTags: [],
            abilityTypes: [],
            roleTypes: [],
            backgroundTypes: [],
            techniques: [],
            subGenres: [],
            weights: {
                character: 0.2,
                foreshadow: 0.1,
                technique: 0.2,
                style: 0.15,
                rhythm: 0.15,
                structure: 0.2,
            },
            isCustom: true,
        };

        new GenreEditModal(
            this.app,
            'create',
            defaultGenre,
            (genre) => { void (async () => {
                try {
                    await this.saveCustomGenre(genre);
                    this.renderRightPanel();
                } catch (e) {
                    log.error('保存题材失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.genre.saveFailed') });
                }
            })(); }
        ).open();
    }

    private async saveCustomGenre(genre: GenreConfig): Promise<void> {
        if (!this.configManager || !this.kb) return;
        try {
            await this.configManager.saveFullCustomGenre(genre);
            this.kb.addCustomGenre(genre);
            showSuccessNotice(t('knowledgebase.genre.saved', { name: genre.name }));
        } catch (e) {
            log.error('保存题材失败:', e);
            throw e;
        }
    }

    private async handleDeleteGenre(id: string): Promise<void> {
        if (!this.configManager || !this.kb) return;
        const genre = this.kb.getGenre(id);
        if (!genre) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.genre.deleteTitle'),
            description: t('knowledgebase.genre.deleteDesc', { name: genre.name }),
            warning: t('knowledgebase.common.irreversible'),
            confirmText: t('knowledgebase.common.confirmDelete'),
            cancelText: t('knowledgebase.common.cancel'),
        });

        if (!confirmed) return;

        try {
            const success = await this.configManager.deleteFullCustomGenre(id);
            if (success) {
                this.kb.deleteCustomGenre(id);
                if (this.selectedGenreId === id) {
                    this.selectedGenreId = null;
                }
                showSuccessNotice(t('knowledgebase.genre.deleted', { name: genre.name }));
                this.renderRightPanel();
            }
        } catch (e) {
            log.error('删除题材失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.common.deleteFailed') });
        }
    }

    private handleImportConfig(): void {
        const input = createEl('input', {
            cls: 'nw-kb-hidden-input',
            attr: { type: 'file', accept: '.json' }
        });
        input.addEventListener('change', (e) => { void (async () => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const genres = parseGenreImportPayload(JSON.parse(text));
                if (genres.length === 0) {
                    new Notice(t('knowledgebase.genre.noGenresInFile'));
                    return;
                }

                await this.processImportGenres(genres);
            } catch {
                showErrorNotice(t('knowledgebase.genre.badFormat'), { title: t('knowledgebase.genre.importFailed') });
            }
        })(); });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private async processImportGenres(importGenres: GenreConfig[]): Promise<void> {
        if (!this.configManager || !this.kb) return;

        const existingIds = new Set(this.kb.getCustomGenres().map(g => g.id));
        const { conflicts, newGenres } = splitGenreConflicts(importGenres, existingIds);

        if (conflicts.length === 0) {
            await this.importGenres(newGenres);
            return;
        }
        const action = await this.showImportConflictDialog(conflicts.length);
        if (action === 'cancel') return;
        await this.importGenres(buildGenreImportPlan(action, newGenres, conflicts));
    }

    private showImportConflictDialog(conflictCount: number): Promise<'skip' | 'overwrite' | 'rename' | 'cancel'> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.modalEl.addClass('nw-scope');
            modal.modalEl.addClass('nw-modal');
            const { contentEl } = modal;

            contentEl.createEl('h3', { text: t('knowledgebase.genre.dupTitle'), cls: 'nw-modal-title' });
            contentEl.createDiv({
                text: t('knowledgebase.genre.dupDesc', { count: conflictCount }),
                cls: 'nw-kb-conflict-hint'
            });

            const btnContainer = contentEl.createDiv({ cls: 'nw-kb-conflict-actions' });

            const overwriteBtn = btnContainer.createEl('button', {
                text: t('knowledgebase.genre.dupOverwrite'),
                cls: 'nw-btn nw-btn-secondary'
            });
            overwriteBtn.addEventListener('click', () => {
                modal.close();
                resolve('overwrite');
            });

            const skipBtn = btnContainer.createEl('button', {
                text: t('knowledgebase.genre.dupSkip'),
                cls: 'nw-btn nw-btn-secondary'
            });
            skipBtn.addEventListener('click', () => {
                modal.close();
                resolve('skip');
            });

            const renameBtn = btnContainer.createEl('button', {
                text: t('knowledgebase.genre.dupRename'),
                cls: 'nw-btn nw-btn-secondary'
            });
            renameBtn.addEventListener('click', () => {
                modal.close();
                resolve('rename');
            });

            const cancelBtn = btnContainer.createEl('button', {
                text: t('knowledgebase.genre.dupCancel'),
                cls: 'nw-btn nw-btn-ghost'
            });
            cancelBtn.addEventListener('click', () => {
                modal.close();
                resolve('cancel');
            });

            modal.open();
        });
    }

    private async importGenres(genres: GenreConfig[]): Promise<void> {
        if (!this.configManager || !this.kb) return;
        let count = 0;
        try {
            for (const genre of genres) {
                const genreWithCustom = { ...genre, isCustom: true };
                await this.configManager.saveFullCustomGenre(genreWithCustom);
                this.kb.addCustomGenre(genreWithCustom);
                count++;
            }
            showSuccessNotice(t('knowledgebase.genre.imported', { count }));
            this.renderRightPanel();
        } catch (e) {
            log.error('导入题材失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.genre.importFailed') });
            throw e;
        }
    }

    private async handleExportConfig(): Promise<void> {
        if (!this.configManager) return;
        const customGenres = this.configManager.getFullCustomGenres();
        if (customGenres.length === 0) {
            new Notice(t('knowledgebase.genre.noExportable'));
            return;
        }
        const data = JSON.stringify(customGenres, null, 2);
        await exportTextFile(this.app, 'custom-genres.json', data, {
            mime: 'application/json',
            successMessage: t('knowledgebase.genre.exported', { count: customGenres.length }),
        });
    }

    private async handleResetConfig(): Promise<void> {
        if (!this.configManager || !this.kb) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.genre.resetTitle'),
            description: t('knowledgebase.genre.resetDesc'),
            warning: t('knowledgebase.genre.resetWarning'),
            confirmText: t('knowledgebase.genre.resetOk'),
            cancelText: t('knowledgebase.common.cancel'),
        });

        if (!confirmed) return;

        try {
            const customGenres = this.kb.getCustomGenres();
            for (const genre of customGenres) {
                await this.configManager.deleteFullCustomGenre(genre.id);
                this.kb.deleteCustomGenre(genre.id);
            }

            this.selectedGenreId = null;
            showSuccessNotice(t('knowledgebase.genre.resetDone'));
            this.renderRightPanel();
        } catch (e) {
            log.error('恢复默认配置失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.genre.resetFailed') });
        }
    }

    private openGenreEditModal(genre: GenreConfig): void {
        const isCustom = genre.isCustom || this.kb?.isCustomGenre(genre.id);
        const mode = isCustom ? 'edit' : 'view';

        new GenreEditModal(
            this.app,
            mode,
            genre,
            (updatedGenre) => { void (async () => {
                try {
                    if (mode === 'view') {
                        await this.saveCustomGenre(updatedGenre);
                    } else {
                        await this.saveCustomGenre(updatedGenre);
                    }
                    this.renderRightPanel();
                } catch (e) {
                    log.error('保存题材失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.genre.saveFailed') });
                }
            })(); },
            (id) => { void (async () => {
                try {
                    await this.handleDeleteGenre(id);
                } catch (e) {
                    log.error('删除题材失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.common.deleteFailed') });
                }
            })(); }
        ).open();
    }

    // ============== Tab 3: 拆解任务 ==============
    private renderTasksTab(): void {
        // 进度回调与完成回调会直接调用本方法做增量刷新（不走 renderRightPanel），
        // 不先清空就会每个进度事件都追加一整套任务页。
        this.rightContentEl.empty();
        const content = this.rightContentEl.createDiv({
            cls: 'nw-kb-tasks-tab'
        });

        const header = content.createDiv({
            cls: 'nw-kb-tasks-header'
        });
        header.createEl('h2', { text: t('knowledgebase.tasks.title'), cls: 'nw-kb-tasks-title' });

        const filterBar = header.createDiv({ cls: 'nw-kb-tasks-filter-bar' });
        filterBar.createSpan({ text: t('knowledgebase.tasks.filterLabel'), cls: 'nw-text-sm-muted' });
        const statusSelect = filterBar.createEl('select', {
            cls: 'nw-kb-select'
        });
        type TaskFilterType = 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled';
        const filterOptions = getTaskFilterOptions();
        filterOptions.forEach(opt => {
            const option = statusSelect.createEl('option', { value: opt.value, text: opt.label });
            if (this.taskFilter === opt.value) option.selected = true;
        });
        statusSelect.addEventListener('change', () => {
            this.taskFilter = statusSelect.value as TaskFilterType;
            this.selectedTaskIds.clear();
            this.renderRightPanel();
        });

        const tasks = this.deconstructionScheduler?.getAllTasks() || [];
        // 筛选 + 按创建时间降序（规则在 kb-task-panel，有单测）
        const filteredTasks = filterAndSortTasks(tasks, this.taskFilter);

        if (filteredTasks.length === 0) {
            const emptyState = createEmptyState({
                icon: 'chart',
                title: t('knowledgebase.tasks.noTitle'),
                description: t('knowledgebase.tasks.noDesc')
            });
            content.appendChild(emptyState);
            return;
        }

        const statsRow = content.createDiv({
            cls: 'nw-kb-tasks-stats'
        });
        const allTasks = tasks;
        const statItems = computeTaskStats(allTasks);
        statItems.forEach(item => {
            const card = statsRow.createDiv({
                cls: 'nw-kb-tasks-stat'
            });
            card.createDiv({
                text: item.value.toString(),
                cls: `nw-kb-tasks-stat-value nw-kb-tasks-stat-value--${item.tone}`
            });
            card.createDiv({ text: item.label, cls: 'nw-kb-tasks-stat-label' });
        });

        const toolbar = content.createDiv({
            cls: 'nw-kb-tasks-toolbar'
        });

        const leftTools = toolbar.createDiv({ cls: 'nw-kb-tasks-tool-group' });

        const selectAllBtn = leftTools.createEl('button', {
            text: t('knowledgebase.tasks.selectAll'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: t('knowledgebase.tasks.selectAllTitle') }
        });
        selectAllBtn.addEventListener('click', () => {
            if (isAllFilteredSelected(this.selectedTaskIds.size, filteredTasks.length)) {
                this.selectedTaskIds.clear();
            } else {
                filteredTasks.forEach(t => this.selectedTaskIds.add(t.id));
            }
            this.renderRightPanel();
        });

        const invertSelectBtn = leftTools.createEl('button', {
            text: t('knowledgebase.tasks.invert'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: t('knowledgebase.tasks.invertTitle') }
        });
        invertSelectBtn.addEventListener('click', () => {
            filteredTasks.forEach(t => {
                if (this.selectedTaskIds.has(t.id)) {
                    this.selectedTaskIds.delete(t.id);
                } else {
                    this.selectedTaskIds.add(t.id);
                }
            });
            this.renderRightPanel();
        });

        const selectedCount = leftTools.createSpan({
            text: formatSelectionLabel(this.selectedTaskIds.size, filteredTasks.length),
            cls: 'nw-kb-tasks-selected-count',
        });
        void selectedCount;

        const rightTools = toolbar.createDiv({ cls: 'nw-kb-tasks-tool-group' });

        // 批量取消：只针对 running | pending（不同于批量删除，见 kb-task-panel 文件头）
        const cancellableSelected = selectSelectedCancellable(filteredTasks, this.selectedTaskIds);
        const batchCancelBtn = rightTools.createEl('button', {
            text: t('knowledgebase.tasks.batchCancel'),
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            attr: { title: t('knowledgebase.tasks.batchCancelTitle') }
        });
        batchCancelBtn.disabled = cancellableSelected.length === 0;
        batchCancelBtn.style.opacity = disabledOpacity(cancellableSelected.length > 0);
        batchCancelBtn.style.cursor = disabledCursor(cancellableSelected.length > 0);
        batchCancelBtn.addEventListener('click', () => {
            this.handleBatchCancel(cancellableSelected).catch(err => {
                log.error('批量取消任务失败:', err);
            });
        });

        // 批量删除：只针对已终结任务（completed | failed | cancelled）
        const deletableSelected = selectSelectedDeletable(filteredTasks, this.selectedTaskIds);
        const batchDeleteBtn = rightTools.createEl('button', {
            text: t('knowledgebase.tasks.batchDelete'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: t('knowledgebase.tasks.batchDeleteTitle') }
        });
        batchDeleteBtn.disabled = deletableSelected.length === 0;
        batchDeleteBtn.style.opacity = disabledOpacity(deletableSelected.length > 0);
        batchDeleteBtn.style.cursor = disabledCursor(deletableSelected.length > 0);
        batchDeleteBtn.addEventListener('click', () => {
            this.handleBatchDelete(deletableSelected).catch(err => { // silent-ok: handleBatchDelete 内部已汇总提示
                log.error('批量删除任务失败:', err);
            });
        });

        const activeTasks = selectActiveTasks(allTasks);
        const cancelAllBtn = rightTools.createEl('button', {
            text: t('knowledgebase.tasks.cancelAll'),
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            attr: { title: t('knowledgebase.tasks.cancelAllTitle') }
        });
        cancelAllBtn.disabled = activeTasks.length === 0;
        cancelAllBtn.style.opacity = disabledOpacity(activeTasks.length > 0);
        cancelAllBtn.style.cursor = disabledCursor(activeTasks.length > 0);
        cancelAllBtn.addEventListener('click', () => {
            this.handleCancelAll(activeTasks).catch(err => {
                log.error('一键取消任务失败:', err);
            });
        });

        const taskList = content.createDiv({

            cls: 'nw-kb-tasks-list'
        });

        filteredTasks.forEach(task => {
            const isSelected = this.selectedTaskIds.has(task.id);
            const card = taskList.createDiv({
                cls: `nw-kb-tasks-card${isSelected ? ' nw-kb-tasks-card--selected' : ''}`
            });

            const headerRow = card.createDiv({
                cls: 'nw-kb-tasks-card-head'
            });

            const titleLeft = headerRow.createDiv({ cls: 'nw-kb-tasks-title-row' });

            const checkbox = titleLeft.createEl('input', {
                type: 'checkbox',
                cls: 'nw-kb-tasks-check'
            });
            checkbox.checked = isSelected;
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedTaskIds.add(task.id);
                } else {
                    this.selectedTaskIds.delete(task.id);
                }
                this.renderRightPanel();
            });

            const titleInfo = titleLeft.createDiv({ cls: 'nw-kb-tasks-title-info' });
            titleInfo.createSpan({
                text: '📖',
                cls: 'nw-kb-tasks-book-icon'
            });
            titleInfo.createDiv({
                text: task.bookName,
                cls: 'nw-kb-tasks-book-name'
            });

            const statusTone = resolveTaskStatusTone(task.status);
            const statusBadge = headerRow.createSpan({
                text: this.getTaskStatusLabel(task.status),
                cls: `nw-kb-task-status nw-kb-task-status--${statusTone}`
            });
            void statusBadge;

            const infoRow = card.createDiv({
                cls: 'nw-kb-tasks-info-row'
            });
            infoRow.createSpan({ text: t('knowledgebase.tasks.createdAt', { time: this.formatDateTime(task.createdAt) }) });
            if (task.startedAt) {
                infoRow.createSpan({ text: t('knowledgebase.tasks.startedAt', { time: this.formatDateTime(task.startedAt) }) });
            }
            if (task.completedAt) {
                infoRow.createSpan({ text: t('knowledgebase.tasks.completedAt', { time: this.formatDateTime(task.completedAt) }) });
            }
            infoRow.createSpan({ text: t('knowledgebase.tasks.dimensions', { list: formatTaskDimensions(task.dimensions, bookDimensionLabels()) }) });

            const taskProgress = this.deconstructionScheduler?.getAllTasks().find(t => t.id === task.id);
            const emitter = task.id ? this.deconstructionScheduler?.getTaskEmitter(task.id) : undefined;
            const emitterState = emitter?.getState();

            if (shouldShowTaskProgress(task.status, Boolean(emitterState)) && emitterState) {
                const progressWrap = card.createDiv({ cls: 'nw-kb-tasks-progress' });
                const bar = progressWrap.createDiv({
                    cls: 'nw-kb-tasks-progress-track'
                });
                const fill = bar.createDiv({ cls: 'nw-kb-tasks-progress-fill' });
                fill.style.setProperty('--nw-kb-pct', `${emitterState.progress}%`);
                const progressInfo = progressWrap.createDiv({
                    cls: 'nw-kb-tasks-progress-info'
                });
                progressInfo.createSpan({
                    text: formatTaskProgressPercent(emitterState.progress),
                    cls: 'nw-text-sm-muted'
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        cls: 'nw-kb-tasks-current-step'
                    });
                }
            }

            if (shouldShowTaskMessage(task.status, emitterState?.message) && emitterState) {
                const messageEl = card.createDiv({
                    cls: 'nw-kb-tasks-message'
                });
                messageEl.createSpan({ text: '💬 ' });
                messageEl.createSpan({ text: emitterState.message });
            }

            if (shouldShowTaskTiming(task.status, Boolean(emitterState)) && emitterState) {
                const timeRow = card.createDiv({
                    cls: 'nw-kb-tasks-time-row'
                });
                if (emitterState.elapsed !== undefined) {
                    const elapsedEl = timeRow.createSpan({ cls: 'nw-kb-tasks-time-item' });
                    elapsedEl.createSpan({ text: '⏱️' });
                    elapsedEl.createSpan({ text: t('knowledgebase.tasks.elapsed') });
                    elapsedEl.createSpan({
                        text: this.formatDuration(emitterState.elapsed),
                        cls: 'nw-kb-tasks-time-value'
                    });
                }
                if (emitterState.eta !== undefined) {
                    const etaEl = timeRow.createSpan({ cls: 'nw-kb-tasks-time-item' });
                    etaEl.createSpan({ text: '⏳' });
                    etaEl.createSpan({ text: t('knowledgebase.tasks.eta') });
                    etaEl.createSpan({
                        text: this.formatDuration(emitterState.eta),
                        cls: 'nw-kb-tasks-time-value'
                    });
                }
            }

            if (shouldShowTaskError(task.status, task.error) && task.error) {
                const errorMsg = card.createDiv({
                    cls: 'nw-kb-tasks-error'
                });
                errorMsg.createSpan({ text: t('knowledgebase.tasks.error'), cls: 'nw-kb-tasks-error-label' });
                errorMsg.createSpan({ text: task.error });
            }

            const actions = card.createDiv({
                cls: 'nw-kb-tasks-actions'
            });

            // 每个状态该出现哪些按钮由 kb-task-panel.resolveTaskRowActions 决定（有单测）
            for (const actionKey of resolveTaskRowActions(task.status)) {
                if (actionKey === 'retry') {
                    const retryBtn = actions.createEl('button', {
                        text: t('knowledgebase.tasks.retry'),
                        cls: 'nw-btn nw-btn-primary nw-btn-sm',
                        attr: { title: t('knowledgebase.tasks.retryTitle') }
                    });
                    retryBtn.addEventListener('click', () => {
                        this.handleRetryTask(task).catch(err => {
                            log.error('重试任务失败:', err);
                        });
                    });
                    continue;
                }

                if (actionKey === 'cancel') {
                    const cancelBtn = actions.createEl('button', {
                        text: t('knowledgebase.tasks.cancel'),
                        cls: 'nw-btn nw-btn-danger nw-btn-sm',
                        attr: { title: t('knowledgebase.tasks.cancelTitle') }
                    });
                    cancelBtn.addEventListener('click', () => {
                        this.handleCancelTask(task).catch(err => {
                            log.error('取消任务失败:', err);
                        });
                    });
                    continue;
                }

                if (actionKey === 'delete') {
                    const deleteBtn = actions.createEl('button', {
                        text: t('knowledgebase.tasks.delete'),
                        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                        attr: { title: t('knowledgebase.tasks.deleteTitle') }
                    });
                    deleteBtn.addEventListener('click', () => {
                        this.handleDeleteTask(task).catch(err => { // silent-ok: handleDeleteTask 内部已有失败 Notice
                            log.error('删除任务失败:', err);
                        });
                    });
                    continue;
                }

                const viewBtn = actions.createEl('button', {
                    text: t('knowledgebase.tasks.viewBook'),
                    cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    attr: { title: t('knowledgebase.tasks.viewBookTitle') }
                });
                viewBtn.addEventListener('click', () => {
                    const book = this.allBooks.find(b => b.id === task.bookId);
                    if (book) {
                        this.activeMainTab = 'books';
                        this.renderLeftSidebar();
                        this.renderRightPanel();
                        void this.openBookDetail(book);
                    }
                });
            }
        });
    }

    private getTaskStatusLabel(status: string): string {
        return formatTaskStatusLabel(status);
    }

    private async handleRetryTask(task: BreakdownTask): Promise<void> {
        if (!this.deconstructionScheduler || !this.kbManager) return;
        try {
            const sourceText = await this.kbManager.getSourceText(task.bookId);
            await this.deconstructionScheduler.addTask(task.bookId, sourceText, task.dimensions);
            showSuccessNotice(t('knowledgebase.tasks.requeued'));
            this.renderRightPanel();
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.tasks.retryFailed') });
        }
    }

    private async handleCancelTask(task: BreakdownTask): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.tasks.cancelModalTitle'),
            description: t('knowledgebase.tasks.cancelModalDesc', { name: task.bookName }),
            confirmText: t('knowledgebase.common.confirmCancel'),
            cancelText: t('knowledgebase.common.back'),
        });

        if (!confirmed) return;

        try {
            await this.deconstructionScheduler?.cancelTask(task.id);
            showSuccessNotice(t('knowledgebase.tasks.cancelled'));
            this.renderRightPanel();
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.tasks.cancelFailed') });
        }
    }

    private async handleDeleteTask(task: BreakdownTask): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.tasks.deleteModalTitle'),
            description: t('knowledgebase.tasks.deleteModalDesc', { name: task.bookName }),
            warning: t('knowledgebase.common.irreversible'),
            confirmText: t('knowledgebase.common.confirmDelete'),
            cancelText: t('knowledgebase.common.back'),
        });

        if (!confirmed) return;

        try {
            const success = await this.deconstructionScheduler?.removeTask(task.id);
            if (success) {
                this.selectedTaskIds.delete(task.id);
                showSuccessNotice(t('knowledgebase.tasks.deleted'));
                this.renderRightPanel();
            } else {
                showErrorNotice(t('knowledgebase.tasks.running'), { title: t('knowledgebase.common.deleteFailed') });
            }
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.common.deleteFailed') });
        }
    }

    private async handleBatchCancel(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const taskNames = tasks.map(t => `• 《${t.bookName}》`).join('\n');
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.tasks.batchCancelModalTitle'),
            description: t('knowledgebase.tasks.batchCancelDesc', { count: tasks.length }),
            steps: tasks.length <= 10 ? tasks.map(t => `《${t.bookName}》`) : undefined,
            warning: t('knowledgebase.tasks.batchCancelWarning'),
            confirmText: t('knowledgebase.common.confirmCancel'),
            cancelText: t('knowledgebase.common.back'),
        });

        if (!confirmed) return;

        let successCount = 0;
        for (const task of tasks) {
            try {
                await this.deconstructionScheduler.cancelTask(task.id);
                successCount++;
            } catch (e) {
                log.warn(`取消任务 ${task.bookName} 失败:`, e);
            }
        }

        this.selectedTaskIds.clear();
        showSuccessNotice(t('knowledgebase.tasks.batchCancelled', { done: successCount, total: tasks.length }));
        this.renderRightPanel();
    }

    private async handleBatchDelete(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.tasks.batchDeleteModalTitle'),
            description: t('knowledgebase.tasks.batchDeleteDesc', { count: tasks.length }),
            steps: tasks.length <= 10 ? tasks.map(t => `《${t.bookName}》`) : undefined,
            warning: t('knowledgebase.tasks.batchDeleteWarning'),
            confirmText: t('knowledgebase.common.confirmDelete'),
            cancelText: t('knowledgebase.common.back'),
        });

        if (!confirmed) return;

        let successCount = 0;
        for (const task of tasks) {
            try {
                const success = await this.deconstructionScheduler.removeTask(task.id);
                if (success) {
                    this.selectedTaskIds.delete(task.id);
                    successCount++;
                }
            } catch (e) {
                log.warn(`删除任务 ${task.bookName} 失败:`, e);
            }
        }

        showSuccessNotice(t('knowledgebase.tasks.batchDeleted', { done: successCount, total: tasks.length }));
        this.renderRightPanel();
    }

    private async handleCancelAll(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.tasks.cancelAllModalTitle'),
            description: t('knowledgebase.tasks.cancelAllDesc', { count: tasks.length }),
            steps: (() => {
                const counts = summarizeTaskCounts(tasks);
                return [t('knowledgebase.tasks.cancelAllRunning', { count: counts.running }), t('knowledgebase.tasks.cancelAllPending', { count: counts.pending })];
            })(),
            warning: t('knowledgebase.tasks.cancelAllWarning'),
            confirmText: t('knowledgebase.tasks.cancelAllOk'),
            cancelText: t('knowledgebase.common.back'),
        });

        if (!confirmed) return;

        let successCount = 0;
        for (const task of tasks) {
            try {
                await this.deconstructionScheduler.cancelTask(task.id);
                successCount++;
            } catch (e) {
                log.warn(`取消任务 ${task.bookName} 失败:`, e);
            }
        }

        this.selectedTaskIds.clear();
        showSuccessNotice(t('knowledgebase.tasks.batchCancelled', { done: successCount, total: tasks.length }));
        this.renderRightPanel();
    }

    // ============== Tab 4: 质量统计 ==============
    /**
     * 渲染质量统计页签。
     *
     * DOM 构建细节已抽到 kb-stats-panel.ts 的 buildKbStatsPanel，本方法只负责
     * 把书籍数据与图表挂载、题材命名能力注入宿主回调。
     */
    private renderStatsTab(): void {
        buildKbStatsPanel(this.rightContentEl, {
            allBooks: this.allBooks,
            renderChart: (container, svgHtml) => this.renderChart(container, svgHtml),
            getGenreName: genreId => this.getGenreName(genreId),
            onStatusClick: status => this.openBookShelfWithStatus(status),
        });
    }

    /**
     * 从质量统计的状态清单跳到书架，并按该状态筛选。
     *
     * 统计口径是「全部书籍」，所以这里必须先清掉频道/题材/关键词筛选，
     * 否则书架条数会小于用户刚才看到的图例数字（看起来像筛选错了）。
     *
     * @param status - 目标拆解状态（来自图例行）
     */
    private openBookShelfWithStatus(status: KbStatusKey): void {
        this.activeMainTab = 'books';
        this.filter.channel = 'all';
        this.filter.primaryGenre = 'all';
        this.filter.subGenre = 'all';
        this.filter.keyword = '';
        this.filter.status = status;
        this.renderLeftSidebar();
        this.renderRightPanel();
    }

    // ============== 操作方法 ==============
    private handleImportBooks(): void {
        new ImportBookModal(this.app, this.kbManager, (book) => { void (async () => {
            try {
                await this.loadBooks();
                this.renderRightPanel();
                this.renderLeftSidebar();
                showSuccessNotice(t('knowledgebase.books.imported'));
            } catch (e) {
                log.error('书籍导入后处理失败:', e);
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.books.importPostFailed') });
            }
        })(); }).open();
    }

    private handleBatchImport(): void {
        if (!this.plugin.batchImportManager || !this.plugin.knowledgeTagManager || !this.deconstructionScheduler) {
            new Notice(t('knowledgebase.books.batchNotInited'));
            return;
        }

        const modal = new BatchImportModal(this.app, {
            knowledgeBaseManager: this.kbManager!,
            deconstructionScheduler: this.deconstructionScheduler,
            tagManager: this.plugin.knowledgeTagManager,
            batchImportManager: this.plugin.batchImportManager,
            onComplete: (result) => { void (async () => {
                try {
                    await this.loadBooks();
                    this.renderRightPanel();
                    this.renderLeftSidebar();
                    if (result.success > 0) {
                        showSuccessNotice(t('knowledgebase.books.batchImported', { count: result.success }));
                    }
                    if (result.failed > 0) {
                        showErrorNotice(t('knowledgebase.books.batchImportFailed', { count: result.failed }));
                    }
                } catch (e) {
                    log.error('批量导入后处理失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.books.batchImportPostFailed') });
                }
            })(); },
            onViewDetail: (bookId, bookName) => {
                // 旧实现只设 selectedBookId 就 renderBookDetail()：
                // 列表态下没有 .nw-kb-detail-tab-content（直接 return），
                // 而 selectedBookId 非空又会让 renderBookListOnly() 永久跳过刷新。
                // 这里改走正常入口：先刷列表拿到刚导入的书，再挂载详情容器。
                void (async () => {
                    try {
                        await this.loadBooks();
                        if (this.viewClosed) return;
                        if (this.activeMainTab !== 'books') {
                            this.activeMainTab = 'books';
                            this.renderLeftSidebar();
                            this.renderRightPanel();
                        } else {
                            this.renderBookListOnly();
                        }
                        const book = this.allBooks.find(b => b.id === bookId)
                            ?? this.allBooks.find(b => b.name === bookName);
                        if (!book) {
                            new Notice(t('knowledgebase.books.notFound'));
                            return;
                        }
                        await this.openBookDetail(book);
                    } catch (e) {
                        log.error('[KnowledgeBaseView] 查看导入详情失败:', e);
                        showErrorNotice(t('knowledgebase.books.openDetailFailed'));
                    }
                })();
            },
        });
        modal.open();
    }

    private handleBatchOperations(): void {
        new BatchOperationsModal(this.app, this.kbManager, () => { void (async () => {
            try {
                await this.loadBooks();
                this.renderRightPanel();
                this.renderLeftSidebar();
            } catch (e) {
                log.error('批量操作后处理失败:', e);
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.books.opPostFailed') });
            }
        })(); }).open();
    }

    /**
     * 渲染详情页操作按钮区。
     *
     * DOM 构建细节已抽到 kb-detail-actions.ts 的 buildKbDetailActionButtons，
     * 本方法只负责把视图的拆解控制、弹窗与详情刷新能力注入宿主回调。
     *
     * @param book 当前详情书籍
     * @param actionsEl 操作按钮容器
     */
    private renderDetailActionButtons(book: BookBasicInfo, actionsEl: HTMLElement): void {
        buildKbDetailActionButtons(book, actionsEl, {
            app: this.app,
            kbManager: this.kbManager,
            deconstructionScheduler: this.deconstructionScheduler,
            isStartingDeconstruction: this.isStartingDeconstruction,
            startDeconstruction: b => this.handleStartDeconstruction(b),
            restartDeconstruction: b => this.handleRestartDeconstruction(b),
            refreshDetailIfSelected: b => this.refreshDetailIfSelected(b),
            applyDimensionTags: b => this.handleApplyDimensionTags(b),
            openEditModal: b => this.openEditModal(b),
            deleteBook: b => this.handleDeleteBook(b),
        });
    }

    /**
     * 拆解状态变更后的刷新入口：仅当视图未关闭且该书仍被选中时，
     * 重建操作按钮区并整页刷新详情。
     *
     * @param book 状态发生变化的书籍
     */
    private refreshDetailIfSelected(book: BookBasicInfo): void {
        if (!this.viewClosed && this.selectedBookId === book.id) {
            this.refreshDetailActionButtons();
            this.renderBookDetail();
        }
    }

    private refreshDetailActionButtons(): void {
        if (this.viewClosed) return;
        const book = this.getCurrentBook();
        if (!book) return;
        const actionsEl = this.rightPanel.querySelector('.nw-kb-detail-actions') as HTMLElement | null;
        if (actionsEl) {
            this.renderDetailActionButtons(book, actionsEl);
        }
    }

    private async handleStartDeconstruction(book: BookBasicInfo): Promise<void> {
        if (!this.deconstructionScheduler) {
            new Notice(t('knowledgebase.deconstruct.schedulerNotInited'));
            return;
        }

        if (this.isStartingDeconstruction) return;

        this.isStartingDeconstruction = true;
        this.refreshDetailActionButtons();

        try {
            const sourceText = await this.kbManager?.getSourceText(book.id);
            if (!sourceText) {
                new Notice(t('knowledgebase.deconstruct.noSource'));
                return;
            }

            const dimensions = [...ALL_BREAKDOWN_DIMENSIONS] as BreakdownDimension[];
            const dimensionLabels = dimensions.map(d => bookDimensionLabels()[d]);
            const wordCount = sourceText.length;
            const vectorEnabled = this.deconstructionScheduler['settingsGetter']
                ? this.deconstructionScheduler['settingsGetter']().vectorEnhancedDeconstruction ?? false
                : false;
            const estimation = this.deconstructionScheduler.estimateDecompositionTime(wordCount, dimensions, vectorEnabled);

            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('knowledgebase.deconstruct.startTitle'),
                description: t('knowledgebase.deconstruct.startDesc', { name: book.name, count: dimensions.length }),
                etaMin: estimation.etaMin,
                etaMax: estimation.etaMax,
                steps: [...dimensionLabels, t('knowledgebase.deconstruct.vectorStep')],
                confirmText: t('knowledgebase.deconstruct.startOk'),
                cancelText: t('knowledgebase.common.cancel'),
                rememberKey: 'kb-start-deconstruction',
            });

            if (!confirmed) {
                return;
            }

            await this.deconstructionScheduler.addTask(book.id, sourceText);
            showSuccessNotice(t('knowledgebase.deconstruct.started', { name: book.name }));
            await this.refreshBookInfo();
        } catch (e) {
            log.error('开始拆解失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.deconstruct.startFailed') });
        } finally {
            this.isStartingDeconstruction = false;
            this.refreshDetailActionButtons();
        }
    }

    private async handleRestartDeconstruction(book: BookBasicInfo): Promise<void> {
        if (!this.deconstructionScheduler) {
            new Notice(t('knowledgebase.deconstruct.schedulerNotInited'));
            return;
        }

        if (this.isStartingDeconstruction) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.deconstruct.restartTitle'),
            description: t('knowledgebase.deconstruct.restartDesc', { name: book.name }),
            warning: t('knowledgebase.deconstruct.restartWarning'),
            confirmText: t('knowledgebase.deconstruct.restartOk'),
            cancelText: t('knowledgebase.common.cancel'),
        });

        if (!confirmed) {
            return;
        }

        this.isStartingDeconstruction = true;
        this.refreshDetailActionButtons();

        try {
            await this.deconstructionScheduler.rerunBook(book.id);
            showSuccessNotice(t('knowledgebase.deconstruct.restarted', { name: book.name }));
            await this.refreshBookInfo();
        } catch (e) {
            log.error('重新拆解失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.deconstruct.restartFailed') });
        } finally {
            this.isStartingDeconstruction = false;
            this.refreshDetailActionButtons();
        }
    }

    private async handleDeleteBook(book: BookBasicInfo): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('knowledgebase.deleteBook.title'),
            description: t('knowledgebase.deleteBook.desc', { name: book.name }),
            warning: t('knowledgebase.common.irreversible'),
            confirmText: t('knowledgebase.common.confirmDelete'),
            cancelText: t('knowledgebase.common.cancel'),
        });

        if (!confirmed) return;

        try {
            // 先取消在途拆解，避免任务结束后把已删除的书目录/向量重新写回来
            await this.deconstructionScheduler?.cancelByBook(book.id);
            await this.kbManager?.deleteBook(book.id);
            showSuccessNotice(t('knowledgebase.deleteBook.done'));
            this.selectedBookId = null;
            await this.loadBooks();
            this.closeBookDetail();
            this.renderLeftSidebar();
        } catch (e) {
            log.error('删除书籍失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.common.deleteFailed') });
        }
    }

    private openEditModal(book: BookBasicInfo): void {
        new EditBookModal(this.app, book, this.kbManager, this.kb, (updated) => { void (async () => {
            try {
                await this.loadBooks();
                await this.loadBookDetailData(book.id);
                this.renderBookDetail();
                this.renderLeftSidebar();
            } catch (e) {
                log.error('编辑书籍后处理失败:', e);
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.books.editPostFailed') });
            }
        })(); }).open();
    }

    private async handleAddCustomTag(book: BookBasicInfo, tag: string): Promise<void> {
        if (!this.kbManager) return;
        if (book.customTags.includes(tag)) {
            new Notice(t('knowledgebase.tags.exists'));
            return;
        }
        try {
            const newTags = [...book.customTags, tag];
            await this.kbManager.updateBook(book.id, { customTags: newTags });
            await this.loadBooks();
            await this.loadBookDetailData(book.id);
            this.renderBookDetail();
        } catch (e) {
            log.error('添加标签失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.tags.addFailed') });
        }
    }

    private async handleDeleteCustomTag(book: BookBasicInfo, index: number): Promise<void> {
        if (!this.kbManager) return;
        try {
            const newTags = removeTagAt(book.customTags, index);
            await this.kbManager.updateBook(book.id, { customTags: newTags });
            await this.loadBooks();
            await this.loadBookDetailData(book.id);
            this.renderBookDetail();
        } catch (e) {
            log.error('删除标签失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.tags.deleteFailed') });
        }
    }

    // ============== 工具方法 ==============
    private getStatusLabel(status: BreakdownStatus): string {
        return formatBreakdownStatusLabel(status);
    }

    private getChannelLabel(channel: string): string {
        return formatChannelLabel(channel);
    }

    private formatWordCount(count?: number): string {
        return formatWordCountText(count);
    }

    private formatDate(timestamp: number): string {
        return formatDateText(timestamp);
    }

    private formatDateTime(timestamp: number): string {
        return formatDateTimeText(timestamp);
    }

    private formatDuration(ms: number): string {
        return formatDurationText(ms);
    }

    private renderMonitorBar(): void {
        if (!this.monitorBarEl) return;
        this.monitorBarEl.empty();

        const settings = this.plugin.settings;
        const scheduler = this.deconstructionScheduler;

        // 获取任务状态
        let runningTask: BreakdownTask | null = null;
        let pendingCount = 0;
        let hasPaused = false;
        if (scheduler) {
            const activeTasks = scheduler.getActiveTasks();
            for (const task of activeTasks) {
                if (task.status === 'running') {
                    runningTask = task;
                } else if (task.status === 'pending') {
                    pendingCount++;
                } else if (task.status === 'paused') {
                    hasPaused = true;
                }
            }
        }

        const isDeconstructing = runningTask !== null;

        // 左侧：拆解任务状态
        const taskStatusEl = this.monitorBarEl.createDiv({
            cls: 'nw-kb-monitor-task'
        });

        if (isDeconstructing && this.latestProgress) {
            const progress = this.latestProgress;
            const dimLabel = progress.currentDimension ? bookDimensionLabels()[progress.currentDimension] : '';
            taskStatusEl.createSpan({
                text: '🔄',
                cls: 'nw-kb-monitor-icon'
            });
            const infoEl = taskStatusEl.createDiv({
                cls: 'nw-kb-monitor-info'
            });
            infoEl.createDiv({
                cls: 'nw-kb-monitor-book',
                text: `${progress.bookName}${dimLabel ? ' · ' + dimLabel : ''}`
            });
            const barContainer = infoEl.createDiv({
                cls: 'nw-kb-monitor-progress'
            });
            const barFill = barContainer.createDiv({ cls: 'nw-kb-monitor-progress-fill' });
            barFill.style.setProperty('--nw-kb-pct', `${progress.totalProgress}%`);
            if (pendingCount > 0) {
                infoEl.createDiv({
                    cls: 'nw-kb-monitor-queued',
                    text: t('knowledgebase.monitor.queuePending', { count: pendingCount })
                });
            }
        } else if (hasPaused) {
            taskStatusEl.createSpan({ text: '⏸️', cls: 'nw-kb-monitor-icon' });
            taskStatusEl.createSpan({ text: t('knowledgebase.monitor.paused'), cls: 'nw-kb-monitor-text' });
        } else {
            taskStatusEl.createSpan({ text: '⏹️', cls: 'nw-kb-monitor-icon' });
            taskStatusEl.createSpan({ text: t('knowledgebase.monitor.noTasks'), cls: 'nw-kb-monitor-text' });
        }

        // 中间：模型状态
        const modelStatusEl = this.monitorBarEl.createDiv({
            cls: 'nw-kb-monitor-model'
        });

        const providerMap: Record<string, string> = {
            ollama: 'Ollama',
            openai: 'OpenAI',
            doubao: t('knowledgebase.provider.doubao'),
            qwen: t('knowledgebase.provider.qwen'),
        };
        const providerType = (settings as unknown as LegacyVectorSettingsView).vectorProvider || settings.vectorProviderType || 'ollama';
        const providerName = providerMap[providerType] || providerType;
        const modelName = (settings as unknown as LegacyVectorSettingsView).vectorModel || settings.vectorOllamaModel || 'bge-m3';

        const connStatus = (settings as unknown as LegacyVectorSettingsView).vectorConnectionStatus || 'idle';
        const connTone = connStatus === 'connected'
            ? 'connected'
            : connStatus === 'disconnected'
                ? 'disconnected'
                : 'idle';
        modelStatusEl.createSpan({
            cls: `nw-kb-monitor-dot nw-kb-monitor-dot--${connTone}`
        });
        modelStatusEl.createSpan({
            text: `${providerName} · ${modelName}`,
            cls: 'nw-kb-monitor-model-text'
        });

        // 右侧：设置按钮
        const settingsBtn = this.monitorBarEl.createEl('button', {
            text: t('knowledgebase.monitor.settings'),
            cls: 'nw-kb-monitor-settings'
        });
        if (isDeconstructing) {
            settingsBtn.setAttribute('title', t('knowledgebase.monitor.settingsDisabled'));
            settingsBtn.disabled = true;
        } else {
            settingsBtn.onclick = () => {
                new MiniSettingsModal(this.app, this.plugin, 'knowledge').open();
            };
        }
    }
}
