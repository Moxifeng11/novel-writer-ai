import { ItemView, WorkspaceLeaf, Notice, Modal, App } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { KnowledgeBaseManager, type BookBasicInfo, type BreakdownStatus, type QualityScores } from '../../services/knowledge-base-manager';
import { WebnovelKnowledgeBase, type GenreConfig } from '../../engine/webnovel-knowledge-base';
import { KnowledgeBaseConfigManager } from '../../engine/knowledge-base-config';
import { applyNwScope } from '../../utils/helpers';
import { AdaptiveDebounceManager } from '../../shared/adaptive-debounce-manager';
import { radarChart, barChart, donutChart, attachChartInteractions } from '../svg-charts';
import { DeconstructionScheduler, ALL_BREAKDOWN_DIMENSIONS, type BreakdownProgress, type BreakdownTask, type BreakdownDimension } from '../../services/deconstruction-scheduler';
import { BatchImportModal } from '../batch-import-modal';
import { MiniSettingsModal } from '../mini-settings-modal';
import { OperationConfirmModal, TaskCardComponent } from '../components/progress';
import { createEmptyState } from '../components/empty-state';
import { createLogger } from '../../shared/logger';
import { exportTextFile } from '../../shared/export-file';
import { ImportBookModal, EditBookModal, GenreEditModal, BatchOperationsModal } from './knowledge-base-modals';
import { BookDetailRenderer } from './book-detail-renderer';

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
} from '../../shared/paths';

export const VIEW_TYPE_KNOWLEDGE_BASE = 'novel-writer-knowledge-base';

type MainTabKey = 'books' | 'config' | 'tasks' | 'stats';
type BookDetailTabKey = 'overview' | 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'commercial' | 'readability' | 'tags';
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

export interface TechniqueData {
    techniques?: Array<{ id: string; name: string; category: string; confidence: number; count: number; genreWeight: number; qualityScore: number }>;
    typeDistribution?: Record<string, number>;
    qualityScore?: { totalScore: number; diversityScore: number; coverageScore: number };
}

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

const MAIN_TABS: { key: MainTabKey; label: string; icon: string }[] = [
    { key: 'books', label: '参考书籍', icon: '📚' },
    { key: 'config', label: '知识参考库', icon: '⚙️' },
    { key: 'tasks', label: '拆解任务', icon: '📋' },
    { key: 'stats', label: '质量统计', icon: '📊' },
];

const BOOK_DETAIL_TABS: Record<BookDetailTabKey, string> = {
    overview: '概览',
    style: '风格',
    rhythm: '节奏',
    technique: '技巧',
    structure: '结构',
    character: '人设',
    foreshadow: '伏笔',
    commercial: '商业',
    readability: '可读性',
    tags: '标签',
};

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
    style: '风格',
    rhythm: '节奏',
    technique: '技巧',
    structure: '结构',
    character: '人设',
    foreshadow: '伏笔',
    commercial: '商业',
    readability: '可读性',
};

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

    private configCategory: ConfigCategoryKey = 'male';
    private selectedGenreId: string | null = null;
    private configEditMode: boolean = false;

    private taskFilter: 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled' = 'all';
    private selectedTaskIds: Set<string> = new Set();
    private isStartingDeconstruction: boolean = false;
    private debounceManager = new AdaptiveDebounceManager({ debug: false });

    private loadToken = 0;
    private viewClosed = false;

    private completeRefreshPending = false;
    private completeRefreshTimer?: ReturnType<typeof setTimeout>;

    private progressRafPending = false;
    private progressRafId?: number;
    private latestProgress?: BreakdownProgress;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_KNOWLEDGE_BASE;
    }

    getDisplayText() {
        return '📚 知识库管理';
    }

    getIcon() {
        return 'book-open';
    }

    async onOpen() {
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
            getDimensionLabels: () => DIMENSION_LABELS,
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
        }

        this.renderLayout();
        await this.loadBooks();
        this.renderLeftSidebar();
        this.renderRightPanel();

        this.setupSchedulerListeners();
    }

    async onClose() {
        this.viewClosed = true;
        if (this.progressUnsubscribe) {
            this.progressUnsubscribe();
            this.progressUnsubscribe = undefined;
        }
        if (this.completeUnsubscribe) {
            this.completeUnsubscribe();
            this.completeUnsubscribe = undefined;
        }
        if (this.completeRefreshTimer) {
            clearTimeout(this.completeRefreshTimer);
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
            this.progressRafId = requestAnimationFrame(() => {
                this.progressRafPending = false;
                this.progressRafId = undefined;
                this.handleProgressUpdate();
            });
        });

        this.completeUnsubscribe = this.deconstructionScheduler.onTaskComplete(() => {
            if (this.viewClosed) return;
            if (this.completeRefreshPending) return;
            this.completeRefreshPending = true;
            this.completeRefreshTimer = setTimeout(() => {
                this.completeRefreshPending = false;
                this.completeRefreshTimer = undefined;
                this.handleCompleteRefresh();
            }, 0);
        });
    }

    private handleProgressUpdate(): void {
        if (this.viewClosed || !this.latestProgress) return;
        const progress = this.latestProgress;
        if (progress.bookId === this.selectedBookId && this.activeMainTab === 'books') {
            this.refreshBookInfo();
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
            return;
        }
        this.allBooks = await this.kbManager.getAllBooks();
    }

    private renderLayout(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('nw-kb-view');

        this.mainLayout = containerEl.createDiv({
            cls: 'nw-kb-main-layout',
            attr: { style: 'display:flex;height:100%;width:100%;' }
        });

        this.leftSidebar = this.mainLayout.createDiv({
            cls: 'nw-kb-left-sidebar',
            attr: { style: 'width:200px;min-width:160px;max-width:280px;border-right:1px solid var(--background-modifier-border);display:flex;flex-direction:column;background:var(--background-secondary);' }
        });

        this.rightPanel = this.mainLayout.createDiv({
            cls: 'nw-kb-right-panel',
            attr: { style: 'flex:1;display:flex;flex-direction:column;overflow:hidden;' }
        });

        this.rightContentEl = this.rightPanel.createDiv({
            cls: 'nw-kb-right-content',
            attr: { style: 'flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;' }
        });

        this.monitorBarEl = this.rightPanel.createDiv({
            cls: 'nw-kb-monitor-bar',
            attr: {
                style: 'height:48px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;align-items:center;padding:0 16px;gap:16px;flex-shrink:0;font-size:12px;'
            }
        });
    }

    private renderLeftSidebar(): void {
        this.leftSidebar.empty();

        const header = this.leftSidebar.createDiv({
            cls: 'nw-kb-sidebar-header',
            attr: { style: 'padding:16px 12px;border-bottom:1px solid var(--background-modifier-border);' }
        });
        header.createEl('h2', {
            text: '📚 知识库管理',
            attr: { style: 'margin:0;font-size:16px;' }
        });

        // 界面流转：直达工作台 / 协同写作 / 指纹库
        const navBtnStyle = 'padding:4px 10px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;cursor:pointer;background:var(--background-primary);color:var(--text-muted);';
        const navRow = header.createDiv({ attr: { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;' } });
        const backBtn = navRow.createEl('button', { text: '← 工作台', attr: { style: navBtnStyle, title: '返回完整写作工作台' } });
        backBtn.addEventListener('click', () => void this.plugin.openFullWriterView());
        const coBtn = navRow.createEl('button', { text: '✍️ 协同写作', attr: { style: navBtnStyle, title: '打开句级协同写作工作台' } });
        coBtn.addEventListener('click', () => void this.plugin.openCoWritingFromActiveContext());
        const fpBtn = navRow.createEl('button', { text: '🔍 指纹库', attr: { style: navBtnStyle, title: '打开写作指纹库' } });
        fpBtn.addEventListener('click', () => this.plugin.executeCommand('novel-writer-fingerprint-library'));

        const nav = this.leftSidebar.createDiv({
            cls: 'nw-kb-sidebar-nav',
            attr: { style: 'flex:1;padding:8px 0;' }
        });

        MAIN_TABS.forEach(tab => {
            const item = nav.createDiv({
                cls: `nw-kb-nav-item${this.activeMainTab === tab.key ? ' is-active' : ''}`,
                attr: {
                    style: `padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:13px;border-left:3px solid ${
                        this.activeMainTab === tab.key ? 'var(--interactive-accent)' : 'transparent'
                    };background:${this.activeMainTab === tab.key ? 'var(--background-secondary-alt)' : 'transparent'};color:${
                        this.activeMainTab === tab.key ? 'var(--text-normal)' : 'var(--text-muted)'
                    };font-weight:${this.activeMainTab === tab.key ? '500' : '400'};`
                }
            });
            item.createSpan({ text: tab.icon, attr: { style: 'font-size:16px;' } });
            item.createSpan({ text: tab.label });

            item.addEventListener('click', () => {
                this.activeMainTab = tab.key;
                this.renderLeftSidebar();
                this.renderRightPanel();
            });
        });

        const footer = this.leftSidebar.createDiv({
            cls: 'nw-kb-sidebar-footer nw-text-muted-11', attr: { style: 'padding:12px;border-top:1px solid var(--background-modifier-border);' }
        });
        footer.createSpan({ text: `共 ${this.allBooks.length} 本书籍` });
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
        const content = this.rightContentEl.createDiv({
            cls: 'nw-kb-books-tab',
            attr: { style: 'display:flex;height:100%;' }
        });

        const genrePanel = content.createDiv({
            cls: 'nw-kb-genre-panel',
            attr: { style: 'width:220px;min-width:180px;border-right:1px solid var(--background-modifier-border);display:flex;flex-direction:column;' }
        });

        const genreHeader = genrePanel.createDiv({
            cls: 'nw-kb-genre-header nw-section-header'
        });
        genreHeader.createEl('h3', { text: '题材分类', attr: { style: 'margin:0;font-size:14px;' } });

        const channelTabs = genrePanel.createDiv({
            cls: 'nw-kb-channel-tabs',
            attr: { style: 'display:flex;border-bottom:1px solid var(--background-modifier-border);' }
        });

        const channels: { id: ConfigCategoryKey | 'all'; name: string }[] = [
            { id: 'all', name: '全部' },
            { id: 'male', name: '男频' },
            { id: 'female', name: '女频' },
            { id: 'neutral', name: '中性' },
        ];

        channels.forEach(ch => {
            const tab = channelTabs.createDiv({
                cls: `nw-kb-channel-tab${this.filter.channel === ch.id ? ' is-active' : ''}`,
                attr: {
                    style: `flex:1;padding:8px 4px;text-align:center;cursor:pointer;font-size:12px;border-bottom:2px solid ${
                        this.filter.channel === ch.id ? 'var(--interactive-accent)' : 'transparent'
                    };color:${this.filter.channel === ch.id ? 'var(--interactive-accent)' : 'var(--text-muted)'};`
                }
            });
            tab.textContent = ch.name;
            tab.addEventListener('click', () => {
                this.filter.channel = ch.id as ConfigCategoryKey | 'all';
                this.filter.primaryGenre = 'all';
                this.filter.subGenre = 'all';
                this.renderRightPanel();
            });
        });

        const genreList = genrePanel.createDiv({
            cls: 'nw-kb-genre-list',
            attr: { style: 'flex:1;overflow-y:auto;padding:4px 0;' }
        });

        this.renderGenreList(genreList);

        const booksPanel = content.createDiv({
            cls: 'nw-kb-books-panel',
            attr: { style: 'flex:1;display:flex;flex-direction:column;min-width:0;' }
        });

        this.renderBooksToolbar(booksPanel);
        this.renderBooksListContent(booksPanel);
    }

    private renderGenreList(container: HTMLElement): void {
        const allItem = this.createGenreNavItem({
            id: 'all',
            name: '全部书籍',
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

        const uncategorizedCount = this.allBooks.filter(b =>
            (this.filter.channel === 'all' || b.genreChannel === this.filter.channel) &&
            !b.primaryGenre
        ).length;

        const uncategorizedItem = this.createGenreNavItem({
            id: 'uncategorized',
            name: '未分类',
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
            attr: { style: 'height:1px;background:var(--background-modifier-border);margin:4px 8px;' }
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
        const item = createDiv({
            attr: {
                style: `padding:6px 12px 6px ${opts.isSub ? '28px' : '12px'};cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:13px;${
                    opts.isActive ? 'background:var(--background-secondary-alt);color:var(--interactive-accent);' : 'color:var(--text-normal);'
                }`
            }
        });

        const left = item.createDiv({ cls: 'nw-flex-row-sm', attr: { style: 'min-width:0;flex:1;' } });
        left.createSpan({ text: opts.icon, cls: 'nw-flex-shrink-0', attr: { style: 'font-size:12px;' } });
        left.createSpan({ text: opts.name, cls: 'nw-ellipsis' });

        item.createSpan({
            text: opts.count.toString(),
            cls: 'nw-text-muted-11 nw-flex-shrink-0'
        });

        item.addEventListener('click', opts.onClick);
        return item;
    }

    private createGenreGroup(genre: GenreConfig): HTMLElement {
        const group = createDiv();
        const isExpanded = !this.collapsedGenres.has(genre.id);
        const count = this.getGenreBookCount(genre.id);

        const header = createDiv({
            attr: {
                style: `padding:6px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:13px;${
                    this.filter.primaryGenre === genre.id ? 'background:var(--background-secondary-alt);color:var(--interactive-accent);' : ''
                }`
            }
        });

        const left = header.createDiv({ cls: 'nw-flex-row-sm', attr: { style: 'min-width:0;flex:1;' } });
        const toggle = left.createSpan({
            text: isExpanded ? '▼' : '▶',
            cls: 'nw-flex-shrink-0', attr: { style: 'font-size:9px;width:12px;color:var(--text-muted);' }
        });
        left.createSpan({ text: '📂', cls: 'nw-flex-shrink-0', attr: { style: 'font-size:12px;' } });
        left.createSpan({ text: genre.name, cls: 'nw-ellipsis' });

        header.createSpan({
            text: count.toString(),
            cls: 'nw-text-muted-11 nw-flex-shrink-0'
        });

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
                name: '全部子类',
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
        return this.allBooks.filter(b => {
            if (this.filter.channel !== 'all' && b.genreChannel !== this.filter.channel) return false;
            return b.primaryGenre === genreId || b.secondaryGenres?.includes(genreId);
        }).length;
    }

    private getSubGenreBookCount(genreId: string, subGenreId: string): number {
        return this.allBooks.filter(b => {
            if (this.filter.channel !== 'all' && b.genreChannel !== this.filter.channel) return false;
            return b.primaryGenre === genreId && b.primarySubGenre === subGenreId;
        }).length;
    }

    private getFilteredBooksCount(scope: 'all'): number {
        return this.allBooks.filter(b =>
            this.filter.channel === 'all' || b.genreChannel === this.filter.channel
        ).length;
    }

    private renderBooksToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({
            cls: 'nw-kb-toolbar nw-section-header',
            attr: { style: 'display:flex;flex-direction:column;gap:8px;' }
        });

        const topRow = toolbar.createDiv({
            attr: { style: 'display:flex;gap:8px;align-items:center;' }
        });

        const searchInput = topRow.createEl('input', {
            type: 'text',
            cls: 'nw-kb-search-input',
            attr: {
                placeholder: '🔍 搜索书名 / 作者 / 标签...',
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
            }
        });
        searchInput.value = this.filter.keyword;
        searchInput.addEventListener('input', () => {
            this.filter.keyword = searchInput.value.trim();
            this.debounceManager.debounceFixed('book-search', () => {
                this.renderBookListOnly();
            }, 200);
        });

        const importBtn = topRow.createEl('button', {
            text: '📥 导入书籍',
            cls: 'nw-btn nw-btn-primary nw-btn-sm nw-flex-shrink-0',
            attr: { title: '导入一本书籍文件（txt / md / epub）' }
        });
        importBtn.addEventListener('click', () => this.handleImportBooks());

        const batchImportBtn = topRow.createEl('button', {
            text: '📦 批量导入',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-flex-shrink-0',
            attr: { title: '从文件夹批量导入多本书籍' }
        });
        batchImportBtn.addEventListener('click', () => this.handleBatchImport());

        const batchBtn = topRow.createEl('button', {
            text: '⚙️ 批量',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-flex-shrink-0',
            attr: { title: '批量操作：批量删除 / 重新拆解等' }
        });
        batchBtn.addEventListener('click', () => this.handleBatchOperations());

        const filterRow = toolbar.createDiv({
            attr: { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;' }
        });

        const statusWrap = filterRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
        statusWrap.createSpan({ text: '状态：', cls: 'nw-text-sm-muted' });
        const statusSelect = statusWrap.createEl('select', {
            cls: 'nw-kb-select',
            attr: { style: 'padding:4px 8px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);' }
        });
        const statusOptions: { value: BreakdownStatus | 'all'; label: string }[] = [
            { value: 'all', label: '全部' },
            { value: 'pending', label: '待拆解' },
            { value: 'processing', label: '拆解中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'interrupted', label: '拆解中断' },
        ];
        statusOptions.forEach(opt => {
            const option = statusSelect.createEl('option', { value: opt.value, text: opt.label });
            if (this.filter.status === opt.value) option.selected = true;
        });
        statusSelect.addEventListener('change', () => {
            this.filter.status = statusSelect.value as BreakdownStatus | 'all';
            this.renderBookListOnly();
        });

        const sortWrap = filterRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
        sortWrap.createSpan({ text: '排序：', cls: 'nw-text-sm-muted' });
        const sortSelect = sortWrap.createEl('select', {
            cls: 'nw-kb-select',
            attr: { style: 'padding:4px 8px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);' }
        });
        const sortOptions: { value: string; label: string }[] = [
            { value: 'createdAt_desc', label: '添加时间 ↓' },
            { value: 'createdAt_asc', label: '添加时间 ↑' },
            { value: 'updatedAt_desc', label: '更新时间 ↓' },
            { value: 'updatedAt_asc', label: '更新时间 ↑' },
            { value: 'wordCount_desc', label: '字数 ↓' },
            { value: 'wordCount_asc', label: '字数 ↑' },
            { value: 'quality_desc', label: '质量评分 ↓' },
            { value: 'quality_asc', label: '质量评分 ↑' },
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

    private renderBooksListContent(container: HTMLElement): void {
        const listContainer = container.createDiv({
            cls: 'nw-kb-book-list-container',
            attr: { style: 'flex:1;overflow-y:auto;padding:12px;' }
        });

        const books = this.getFilteredBooks();

        const header = listContainer.createDiv({
            attr: { style: 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;' }
        });
        header.createSpan({ text: `共 ${books.length} 本书籍`, cls: 'nw-text-sm-muted' });

        if (books.length === 0) {
            this.renderBooksEmptyState(listContainer);
            return;
        }

        const grid = listContainer.createDiv({
            cls: 'nw-kb-book-grid',
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;' }
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
        if (this.activeMainTab !== 'books' || this.selectedBookId) return;

        const listContainer = this.rightPanel.querySelector('.nw-kb-book-list-container');
        if (!listContainer) return;

        const containerEl = listContainer as HTMLElement;
        const scrollTop = containerEl.scrollTop;

        containerEl.empty();

        const books = this.getFilteredBooks();

        const header = containerEl.createDiv({
            attr: { style: 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;' }
        });
        header.createSpan({ text: `共 ${books.length} 本书籍`, cls: 'nw-text-sm-muted' });

        if (books.length === 0) {
            this.renderBooksEmptyState(containerEl);
            containerEl.scrollTop = 0;
            return;
        }

        const grid = containerEl.createDiv({
            cls: 'nw-kb-book-grid',
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;' }
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
            title: '暂无书籍',
            description: '使用上方「📥 导入书籍」或「📦 批量导入」添加你的第一本参考书籍'
        });
        container.appendChild(emptyState);
    }

    private getFilteredBooks(): BookBasicInfo[] {
        let result = [...this.allBooks];

        if (this.filter.channel !== 'all') {
            result = result.filter(b => b.genreChannel === this.filter.channel);
        }

        if (this.filter.primaryGenre === 'uncategorized') {
            result = result.filter(b => !b.primaryGenre);
        } else if (this.filter.primaryGenre !== 'all') {
            result = result.filter(b =>
                b.primaryGenre === this.filter.primaryGenre ||
                b.secondaryGenres?.includes(this.filter.primaryGenre)
            );
            if (this.filter.subGenre !== 'all') {
                result = result.filter(b => b.primarySubGenre === this.filter.subGenre);
            }
        }

        if (this.filter.status !== 'all') {
            result = result.filter(b => b.breakdownStatus === this.filter.status);
        }

        if (this.filter.keyword) {
            const kw = this.filter.keyword.toLowerCase();
            result = result.filter(b =>
                b.name.toLowerCase().includes(kw) ||
                (b.author?.toLowerCase().includes(kw)) ||
                b.themeTags.some(t => t.toLowerCase().includes(kw)) ||
                b.customTags.some(t => t.toLowerCase().includes(kw))
            );
        }

        const { sortBy, sortOrder } = this.filter;
        result.sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'createdAt':
                    cmp = a.createdAt - b.createdAt;
                    break;
                case 'updatedAt':
                    cmp = a.updatedAt - b.updatedAt;
                    break;
                case 'wordCount':
                    cmp = (a.wordCount ?? 0) - (b.wordCount ?? 0);
                    break;
                case 'quality':
                    cmp = (a.qualityScores?.overall ?? 0) - (b.qualityScores?.overall ?? 0);
                    break;
            }
            return sortOrder === 'asc' ? cmp : -cmp;
        });

        return result;
    }

    private createBookCard(book: BookBasicInfo): HTMLElement {
        const card = createDiv({
            cls: `nw-kb-book-card${this.selectedBookId === book.id ? ' is-selected' : ''}`,
            attr: {
                style: `border:1px solid var(--background-modifier-border);border-radius:8px;padding:12px;cursor:pointer;background:var(--background-primary);transition:all 0.15s;${
                    this.selectedBookId === book.id ? 'border-color:var(--interactive-accent);box-shadow:0 0 0 2px rgba(var(--interactive-accent-rgb),0.1);' : ''
                }`
            }
        });

        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--interactive-accent)';
        });
        card.addEventListener('mouseleave', () => {
            if (this.selectedBookId !== book.id) {
                card.style.borderColor = 'var(--background-modifier-border)';
            }
        });

        const header = card.createDiv({ attr: { style: 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px;' } });
        const title = header.createDiv({
            text: book.name,
            attr: { style: 'font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4;flex:1;' }
        });
        void title;

        const statusBadge = header.createSpan({
            text: this.getStatusLabel(book.breakdownStatus),
            cls: 'nw-flex-shrink-0',
            attr: {
                style: `padding:2px 8px;font-size:11px;border-radius:10px;${
                    book.breakdownStatus === 'completed' ? 'background:rgba(46,204,113,0.15);color:#2ecc71;' :
                    book.breakdownStatus === 'processing' ? 'background:rgba(59,130,246,0.15);color:#3b82f6;' :
                    book.breakdownStatus === 'failed' ? 'background:rgba(231,76,60,0.15);color:#e74c3c;' :
                    book.breakdownStatus === 'interrupted' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;' :
                    'background:var(--background-secondary);color:var(--text-muted);'
                }`
            }
        });
        void statusBadge;

        // A5: 拆解完成但向量化失败时，检索实际不可用，列表必须能看出来
        if (book.vectorStatus === 'failed') {
            header.createSpan({
                text: '⚠️ 向量化失败',
                attr: {
                    title: book.vectorError || '检索不可用，请到详情页重试向量化',
                    style: 'padding:2px 8px;font-size:11px;border-radius:10px;background:rgba(231,76,60,0.15);color:#e74c3c;flex-shrink:0;margin-left:4px;'
                }
            });
        }

        const meta = card.createDiv({ cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:8px;' } });
        meta.createSpan({ text: book.author || '未知作者' });
        meta.createSpan({ text: ' · ' + this.formatWordCount(book.wordCount) });

        if (book.breakdownStatus === 'processing' && book.breakdownProgress !== undefined) {
            const progressWrap = card.createDiv({ attr: { style: 'margin-bottom:8px;' } });
            const bar = progressWrap.createDiv({
                attr: { style: 'height:4px;background:var(--background-secondary);border-radius:2px;overflow:hidden;' }
            });
            bar.createDiv({
                attr: { style: `height:100%;width:${book.breakdownProgress}%;background:var(--interactive-accent);transition:width 0.3s;` }
            });
            progressWrap.createSpan({
                text: `拆解中 ${book.breakdownProgress}%`,
                cls: 'nw-text-muted-11'
            });
        }

        const tags = card.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'margin-bottom:8px;' } });
        if (book.primaryGenre && this.kb) {
            const genre = this.kb.getGenre(book.primaryGenre);
            if (genre) {
                tags.createSpan({
                    text: genre.name,
                    attr: { style: 'padding:2px 6px;font-size:10px;background:var(--background-secondary);color:var(--text-muted);border-radius:8px;' }
                });
            }
        }
        book.customTags.slice(0, 2).forEach(tag => {
            tags.createSpan({
                text: tag,
                attr: { style: 'padding:2px 6px;font-size:10px;background:var(--background-secondary);color:var(--text-muted);border-radius:8px;' }
            });
        });

        const footer = card.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid var(--background-modifier-border);' }
        });

        if (book.qualityScores) {
            const quality = footer.createSpan({
                text: `⭐ ${book.qualityScores.overall.toFixed(0)}分`,
                attr: { style: 'font-size:12px;color:#f59e0b;font-weight:500;' }
            });
            void quality;
        } else {
            footer.createSpan();
        }

        footer.createSpan({
            text: this.formatDate(book.createdAt),
            cls: 'nw-text-muted-11'
        });

        card.addEventListener('click', () => this.openBookDetail(book));

        return card;
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

        const detailContainer = (booksPanel as HTMLElement).createDiv({
            cls: 'nw-kb-detail-container',
            attr: { style: 'flex:1;overflow-y:auto;' }
        });

        const backBtn = detailContainer.createEl('button', {
            text: '← 返回列表',
            cls: 'nw-btn nw-btn-ghost nw-btn-sm',
            attr: { style: 'margin-bottom:12px;' }
        });
        backBtn.addEventListener('click', () => this.closeBookDetail());

        const titleRow = detailContainer.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;' }
        });
        titleRow.createEl('h2', { text: book.name, attr: { style: 'margin:0;font-size:20px;' } });

        const actions = titleRow.createDiv({
            cls: 'nw-kb-detail-actions',
            attr: { style: 'display:flex;gap:8px;flex-wrap:wrap;' }
        });
        this.renderDetailActionButtons(book, actions);

        const tabsWrapper = detailContainer.createDiv({
            cls: 'nw-kb-detail-tabs-wrapper',
            attr: { style: 'overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--background-modifier-border);margin-bottom:16px;-webkit-overflow-scrolling:touch;' }
        });
        const tabs = tabsWrapper.createDiv({
            cls: 'nw-kb-detail-tabs',
            attr: { style: 'display:flex;gap:0;min-width:fit-content;' }
        });
        const tabKeys: BookDetailTabKey[] = ['overview', 'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability', 'tags'];
        tabKeys.forEach(key => {
            const tab = tabs.createEl('button', {
                text: BOOK_DETAIL_TABS[key],
                cls: `nw-kb-detail-tab${this.activeBookDetailTab === key ? ' is-active' : ''}`,
                attr: {
                    type: 'button',
                    style: `padding:10px 20px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid ${
                        this.activeBookDetailTab === key ? 'var(--interactive-accent)' : 'transparent'
                    };color:${this.activeBookDetailTab === key ? 'var(--interactive-accent)' : 'var(--text-normal)'};font-weight:${this.activeBookDetailTab === key ? '600' : '500'};white-space:nowrap;flex-shrink:0;min-width:80px;text-align:center;transition:all 0.2s;`
                }
            });
            tab.addEventListener('click', () => {
                this.activeBookDetailTab = key;
                this.renderBookDetail();
            });
        });

        const tabContent = detailContainer.createDiv({
            cls: 'nw-kb-detail-tab-content',
            attr: { style: 'padding-bottom:24px;' }
        });

        const loadingEl = tabContent.createDiv({
            text: '加载中...',
            attr: { style: 'text-align:center;padding:40px;color:var(--text-muted);font-size:14px;' }
        });
        void loadingEl;

        await this.loadBookDetailData(book.id);
        if (this.loadToken !== myToken || this.viewClosed) return;
        this.renderBookDetail();
    }

    private renderBookDetail(): void {
        if (this.viewClosed) return;
        const book = this.getCurrentBook();
        if (!book) return;

        const tabContent = this.rightPanel.querySelector('.nw-kb-detail-tab-content');
        if (!tabContent) return;

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

        const book = await this.kbManager.getBook(bookId);
        if (this.viewClosed) return;
        if (!book) return;

        const idx = this.allBooks.findIndex(b => b.id === bookId);
        if (idx >= 0) {
            this.allBooks[idx] = book;
        }

        const fs = (this.app.vault.adapter as { exists(p: string): Promise<boolean>; read(p: string): Promise<string> });
        const baseDir = this.getKbBaseDir();

        try {
            const stylePath = kbBookStyleFingerprintFile(book.name, baseDir);
            if (await fs.exists(stylePath)) {
                if (this.viewClosed) return;
                const content = await fs.read(stylePath);
                if (this.viewClosed) return;
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

        if (this.viewClosed) return;
        this.rhythmData = await this.loadMarkdownFrontmatter(
            kbBookRhythmAnalysisFile(book.name, baseDir)
        ) as RhythmData | null;

        if (this.viewClosed) return;
        this.techniqueData = await this.loadMarkdownFrontmatter(
            kbBookWritingTechniquesFile(book.name, baseDir)
        ) as TechniqueData | null;

        if (this.viewClosed) return;
        this.structureData = await this.loadMarkdownFrontmatter(
            kbBookStructureBreakdownFile(book.name, baseDir)
        ) as StructureData | null;

        if (this.viewClosed) return;
        this.characterData = await this.loadMarkdownFrontmatter(
            kbBookCharacterExtractionFile(book.name, baseDir)
        ) as CharacterKnowledgeData | null;

        if (this.viewClosed) return;
        this.foreshadowData = await this.loadMarkdownFrontmatter(
            kbBookForeshadowDBFile(book.name, baseDir)
        ) as ForeshadowData | null;

        if (this.viewClosed) return;
        this.commercialData = await this.loadMarkdownFrontmatter(
            kbBookCommercialAnalysisFile(book.name, baseDir)
        ) as CommercialData | null;

        if (this.viewClosed) return;
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
        container.innerHTML = svgHtml;
        const chartContainer = container.querySelector('.nw-chart-container') as HTMLElement;
        if (chartContainer) {
            attachChartInteractions(chartContainer);
        }
    }

    private getGenreName(genreId?: string): string {
        if (!genreId || !this.kb) return '未分类';
        const genre = this.kb.getGenre(genreId);
        return genre?.name || genreId;
    }

    private async autoClassifyBook(book: BookBasicInfo): Promise<void> {
        if (!this.kbManager) return;
        new Notice('正在自动分类...');
        try {
            const result = await this.kbManager.classifyBook(book.id);
            await this.loadBooks();
            await this.refreshBookInfo();
            this.renderBookDetail();
            new Notice(`✅ 分类完成：${result.primaryGenre.name} · ${result.primarySubGenre?.name || ''}`);
        } catch (e) {
            log.error('自动分类失败:', e);
            new Notice('自动分类失败');
        }
    }

    private async applyGenreRecommendation(book: BookBasicInfo, rec: { genreId: string; subGenreId?: string; confidence: number }): Promise<void> {
        if (!this.kbManager) return;
        const genreName = !rec.genreId || !this.kb ? '未分类' : (this.kb.getGenre(rec.genreId)?.name || rec.genreId);
        const subGenreName = !rec.genreId || !rec.subGenreId || !this.kb ? '未分类' : (this.kb.getSubGenre(rec.genreId, rec.subGenreId)?.name || rec.subGenreId);
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '应用分类建议',
            description: `确定要应用分类建议吗？`,
            steps: [`大类：${genreName}`, `细分：${subGenreName}`],
            confirmText: '确认应用',
            cancelText: '取消',
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
            new Notice('✅ 分类已更新');
        } catch (e) {
            log.error('更新分类失败:', e);
            new Notice(`更新分类失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // ============== Tab 2: 知识参考库配置 ==============
    private renderConfigTab(): void {
        const content = this.rightContentEl.createDiv({
            cls: 'nw-kb-config-tab',
            attr: { style: 'display:flex;height:100%;' }
        });

        const categoryPanel = content.createDiv({
            cls: 'nw-kb-config-category-panel',
            attr: { style: 'width:160px;border-right:1px solid var(--background-modifier-border);display:flex;flex-direction:column;' }
        });

        const categoryHeader = categoryPanel.createDiv({
            cls: 'nw-section-header'
        });
        categoryHeader.createEl('h3', { text: '频道分类', attr: { style: 'margin:0;font-size:14px;' } });

        const categories: { key: ConfigCategoryKey; label: string; icon: string }[] = [
            { key: 'male', label: '男频', icon: '♂️' },
            { key: 'female', label: '女频', icon: '♀️' },
            { key: 'neutral', label: '中性', icon: '⚧️' },
        ];

        categories.forEach(cat => {
            const item = categoryPanel.createDiv({
                attr: {
                    style: `padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;border-left:3px solid ${
                        this.configCategory === cat.key ? 'var(--interactive-accent)' : 'transparent'
                    };background:${this.configCategory === cat.key ? 'var(--background-secondary-alt)' : 'transparent'};color:${
                        this.configCategory === cat.key ? 'var(--text-normal)' : 'var(--text-muted)'
                    };`
                }
            });
            item.createSpan({ text: cat.icon });
            item.createSpan({ text: cat.label });
            item.addEventListener('click', () => {
                this.configCategory = cat.key;
                this.selectedGenreId = null;
                this.renderRightPanel();
            });
        });

        const mainContent = content.createDiv({
            cls: 'nw-kb-config-main',
            attr: { style: 'flex:1;display:flex;flex-direction:column;min-width:0;' }
        });

        const toolbar = mainContent.createDiv({
            cls: 'nw-section-header', attr: { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' }
        });
        toolbar.createEl('h3', { text: `${this.getChannelLabel(this.configCategory)}题材配置`, attr: { style: 'margin:0;font-size:15px;' } });

        const actions = toolbar.createDiv({ attr: { style: 'display:flex;gap:8px;flex-wrap:wrap;' } });
        const addGenreBtn = actions.createEl('button', {
            text: '➕ 新增题材',
            cls: 'nw-btn nw-btn-primary nw-btn-sm'
        });
        addGenreBtn.addEventListener('click', () => this.handleAddGenre());
        const importBtn = actions.createEl('button', {
            text: '📥 导入',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
        });
        importBtn.addEventListener('click', () => this.handleImportConfig());
        const exportBtn = actions.createEl('button', {
            text: '📤 导出',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
        });
        exportBtn.addEventListener('click', () => { void this.handleExportConfig(); });
        const resetBtn = actions.createEl('button', {
            text: '↺ 恢复默认',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
        });
        resetBtn.addEventListener('click', () => {
            this.handleResetConfig().catch(err => {
                log.error('恢复默认配置失败:', err);
            });
        });

        const configContent = mainContent.createDiv({
            cls: 'nw-kb-config-content',
            attr: { style: 'flex:1;overflow-y:auto;padding:16px;' }
        });

        const genres = this.kb?.getGenresByCategory(this.configCategory) || [];

        if (genres.length === 0) {
            configContent.createDiv({
                attr: { style: 'text-align:center;padding:60px;color:var(--text-muted);' }
            }).createSpan({ text: '暂无题材配置' });
            return;
        }

        const grid = configContent.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;' }
        });

        genres.forEach(genre => {
            const isCustom = genre.isCustom || this.kb?.isCustomGenre(genre.id);
            const card = grid.createDiv({
                attr: {
                    style: `border:1px solid var(--background-modifier-border);border-radius:8px;padding:16px;cursor:pointer;background:var(--background-primary);transition:all 0.15s;position:relative;${
                        this.selectedGenreId === genre.id ? 'border-color:var(--interactive-accent);box-shadow:0 0 0 2px rgba(var(--interactive-accent-rgb),0.1);' : ''
                    }`
                }
            });
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = 'var(--interactive-accent)';
            });
            card.addEventListener('mouseleave', () => {
                if (this.selectedGenreId !== genre.id) {
                    card.style.borderColor = 'var(--background-modifier-border)';
                }
            });

            const header = card.createDiv({ attr: { style: 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px;' } });
            const titleWrap = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            const titleRow = titleWrap.createDiv({ attr: { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' } });
            titleRow.createDiv({ text: genre.name, attr: { style: 'font-size:15px;font-weight:600;' } });
            if (isCustom) {
                titleRow.createSpan({
                    text: '自定义',
                    attr: { style: 'padding:1px 6px;font-size:10px;background:rgba(46,204,113,0.15);color:#2ecc71;border-radius:8px;flex-shrink:0;' }
                });
            }

            const actions = header.createDiv({ attr: { style: 'display:flex;gap:4px;flex-shrink:0;' } });
            if (isCustom) {
                const deleteIcon = actions.createSpan({
                    text: '🗑️',
                    attr: { style: 'font-size:14px;color:var(--text-muted);cursor:pointer;padding:2px;' }
                });
                deleteIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDeleteGenre(genre.id).catch(err => {
                        log.error('删除题材失败:', err);
                    });
                });
            }

            card.createDiv({
                text: genre.description,
                cls: 'nw-text-sm-muted', attr: { style: 'line-height:1.5;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;' }
            });

            const stats = card.createDiv({ attr: { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;' } });
            const statItems = [
                { label: '性格标签', value: genre.personalityTags.length },
                { label: '能力类型', value: genre.abilityTypes.length },
                { label: '写作技巧', value: genre.techniques.length },
            ];
            statItems.forEach(s => {
                const statItem = stats.createDiv({
                    attr: { style: 'text-align:center;padding:8px;background:var(--background-secondary);border-radius:6px;' }
                });
                statItem.createDiv({ text: s.value.toString(), attr: { style: 'font-size:16px;font-weight:600;color:var(--interactive-accent);' } });
                statItem.createDiv({ text: s.label, attr: { style: 'font-size:10px;color:var(--text-muted);margin-top:2px;' } });
            });

            if (genre.subGenres && genre.subGenres.length > 0) {
                const subSection = card.createDiv({ attr: { style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--background-modifier-border);' } });
                subSection.createDiv({ text: `细分题材 (${genre.subGenres.length})`, cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;' } });
                const subTags = subSection.createDiv({ cls: 'nw-flex-wrap-sm' });
                genre.subGenres.slice(0, 5).forEach(sub => {
                    subTags.createSpan({
                        text: sub.name,
                        attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-secondary);border-radius:10px;color:var(--text-muted);' }
                    });
                });
                if (genre.subGenres.length > 5) {
                    subTags.createSpan({
                        text: `+${genre.subGenres.length - 5}`,
                        cls: 'nw-text-muted-11', attr: { style: 'padding:2px 8px;' }
                    });
                }
            }

            card.addEventListener('click', () => {
                this.selectedGenreId = genre.id;
                this.openGenreEditModal(genre);
            });
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
            async (genre) => {
                try {
                    await this.saveCustomGenre(genre);
                    this.renderRightPanel();
                } catch (e) {
                    log.error('保存题材失败:', e);
                    new Notice(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        ).open();
    }

    private async saveCustomGenre(genre: GenreConfig): Promise<void> {
        if (!this.configManager || !this.kb) return;
        try {
            await this.configManager.saveFullCustomGenre(genre);
            this.kb.addCustomGenre(genre);
            new Notice(`✅ 已保存题材「${genre.name}」`);
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
            title: '删除题材',
            description: `确定要删除题材「${genre.name}」吗？`,
            warning: '此操作不可恢复',
            confirmText: '确认删除',
            cancelText: '取消',
        });

        if (!confirmed) return;

        try {
            const success = await this.configManager.deleteFullCustomGenre(id);
            if (success) {
                this.kb.deleteCustomGenre(id);
                if (this.selectedGenreId === id) {
                    this.selectedGenreId = null;
                }
                new Notice(`🗑️ 已删除题材「${genre.name}」`);
                this.renderRightPanel();
            }
        } catch (e) {
            log.error('删除题材失败:', e);
            new Notice(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private handleImportConfig(): void {
        const input = createEl('input', {
            attr: { type: 'file', accept: '.json', style: 'display:none;' }
        });
        input.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                let genres: GenreConfig[] = [];

                if (Array.isArray(data)) {
                    genres = data;
                } else if (data.customGenres && Array.isArray(data.customGenres)) {
                    genres = data.customGenres;
                } else {
                    throw new Error('文件格式不正确');
                }

                if (genres.length === 0) {
                    new Notice('文件中没有可导入的题材');
                    return;
                }

                await this.processImportGenres(genres);
            } catch (err) {
                new Notice('导入失败：文件格式错误');
            }
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private async processImportGenres(importGenres: GenreConfig[]): Promise<void> {
        if (!this.configManager || !this.kb) return;

        const existingIds = new Set(this.kb.getCustomGenres().map(g => g.id));
        const conflicts: GenreConfig[] = [];
        const newGenres: GenreConfig[] = [];

        importGenres.forEach(genre => {
            if (existingIds.has(genre.id)) {
                conflicts.push(genre);
            } else {
                newGenres.push(genre);
            }
        });

        if (conflicts.length > 0) {
            const action = await this.showImportConflictDialog(conflicts.length);
            if (action === 'cancel') return;

            if (action === 'skip') {
                await this.importGenres(newGenres);
            } else if (action === 'overwrite') {
                const allGenres = [...newGenres, ...conflicts];
                await this.importGenres(allGenres);
            } else if (action === 'rename') {
                const renamedGenres = conflicts.map(g => ({
                    ...g,
                    id: `${g.id}_${Date.now()}`,
                    name: `${g.name} (导入)`,
                    isCustom: true,
                }));
                const allGenres = [...newGenres, ...renamedGenres];
                await this.importGenres(allGenres);
            }
        } else {
            await this.importGenres(newGenres);
        }
    }

    private showImportConflictDialog(conflictCount: number): Promise<'skip' | 'overwrite' | 'rename' | 'cancel'> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.modalEl.addClass('nw-scope');
            modal.modalEl.addClass('nw-modal');
            const { contentEl } = modal;

            contentEl.createEl('h3', { text: '⚠️ 发现重复题材', cls: 'nw-modal-title' });
            contentEl.createDiv({
                text: `检测到 ${conflictCount} 个题材ID已存在，请选择处理方式：`,
                attr: { style: 'margin-bottom:16px;font-size:13px;color:var(--text-muted);' }
            });

            const btnContainer = contentEl.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });

            const overwriteBtn = btnContainer.createEl('button', {
                text: '覆盖现有题材',
                cls: 'nw-btn nw-btn-secondary'
            });
            overwriteBtn.addEventListener('click', () => {
                modal.close();
                resolve('overwrite');
            });

            const skipBtn = btnContainer.createEl('button', {
                text: '跳过重复题材',
                cls: 'nw-btn nw-btn-secondary'
            });
            skipBtn.addEventListener('click', () => {
                modal.close();
                resolve('skip');
            });

            const renameBtn = btnContainer.createEl('button', {
                text: '重命名导入（添加后缀）',
                cls: 'nw-btn nw-btn-secondary'
            });
            renameBtn.addEventListener('click', () => {
                modal.close();
                resolve('rename');
            });

            const cancelBtn = btnContainer.createEl('button', {
                text: '取消导入',
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
            new Notice(`📥 成功导入 ${count} 个题材`);
            this.renderRightPanel();
        } catch (e) {
            log.error('导入题材失败:', e);
            new Notice(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
            throw e;
        }
    }

    private async handleExportConfig(): Promise<void> {
        if (!this.configManager) return;
        const customGenres = this.configManager.getFullCustomGenres();
        if (customGenres.length === 0) {
            new Notice('暂无可导出的自定义题材');
            return;
        }
        const data = JSON.stringify(customGenres, null, 2);
        await exportTextFile(this.app, 'custom-genres.json', data, {
            mime: 'application/json',
            successMessage: `📤 已导出 ${customGenres.length} 个自定义题材`,
        });
    }

    private async handleResetConfig(): Promise<void> {
        if (!this.configManager || !this.kb) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '恢复默认配置',
            description: '确定要恢复默认配置吗？',
            warning: '所有自定义题材将被删除',
            confirmText: '确认恢复',
            cancelText: '取消',
        });

        if (!confirmed) return;

        try {
            const customGenres = this.kb.getCustomGenres();
            for (const genre of customGenres) {
                await this.configManager.deleteFullCustomGenre(genre.id);
                this.kb.deleteCustomGenre(genre.id);
            }

            this.selectedGenreId = null;
            new Notice('↺ 已恢复默认配置');
            this.renderRightPanel();
        } catch (e) {
            log.error('恢复默认配置失败:', e);
            new Notice(`恢复失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private openGenreEditModal(genre: GenreConfig): void {
        const isCustom = genre.isCustom || this.kb?.isCustomGenre(genre.id);
        const mode = isCustom ? 'edit' : 'view';

        new GenreEditModal(
            this.app,
            mode,
            genre,
            async (updatedGenre) => {
                try {
                    if (mode === 'view') {
                        await this.saveCustomGenre(updatedGenre);
                    } else {
                        await this.saveCustomGenre(updatedGenre);
                    }
                    this.renderRightPanel();
                } catch (e) {
                    log.error('保存题材失败:', e);
                    new Notice(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
            async (id) => {
                try {
                    await this.handleDeleteGenre(id);
                } catch (e) {
                    log.error('删除题材失败:', e);
                    new Notice(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        ).open();
    }

    // ============== Tab 3: 拆解任务 ==============
    private renderTasksTab(): void {
        const content = this.rightContentEl.createDiv({
            cls: 'nw-kb-tasks-tab',
            attr: { style: 'padding:16px;overflow-y:auto;height:100%;' }
        });

        const header = content.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;' }
        });
        header.createEl('h2', { text: '拆解任务监控', attr: { style: 'margin:0;font-size:18px;' } });

        const filterBar = header.createDiv({ attr: { style: 'display:flex;gap:8px;align-items:center;' } });
        filterBar.createSpan({ text: '状态筛选：', cls: 'nw-text-sm-muted' });
        const statusSelect = filterBar.createEl('select', {
            cls: 'nw-kb-select',
            attr: { style: 'padding:4px 8px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);' }
        });
        type TaskFilterType = 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled';
        const filterOptions: { value: TaskFilterType; label: string }[] = [
            { value: 'all', label: '全部' },
            { value: 'running', label: '运行中' },
            { value: 'pending', label: '等待中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'cancelled', label: '已取消' },
        ];
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
        let filteredTasks = tasks;

        switch (this.taskFilter) {
            case 'running':
                filteredTasks = tasks.filter(t => t.status === 'running');
                break;
            case 'pending':
                filteredTasks = tasks.filter(t => t.status === 'pending');
                break;
            case 'completed':
                filteredTasks = tasks.filter(t => t.status === 'completed');
                break;
            case 'failed':
                filteredTasks = tasks.filter(t => t.status === 'failed');
                break;
            case 'cancelled':
                filteredTasks = tasks.filter(t => t.status === 'cancelled');
                break;
        }

        filteredTasks.sort((a, b) => b.createdAt - a.createdAt);

        if (filteredTasks.length === 0) {
            const emptyState = createEmptyState({
                icon: 'chart',
                title: '暂无任务',
                description: '在参考书籍中选择书籍开始拆解'
            });
            content.appendChild(emptyState);
            return;
        }

        const statsRow = content.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px;' }
        });
        const allTasks = tasks;
        const statItems = [
            { label: '总任务数', value: allTasks.length, color: 'var(--interactive-accent)' },
            { label: '运行中', value: allTasks.filter(t => t.status === 'running').length, color: '#3b82f6' },
            { label: '等待中', value: allTasks.filter(t => t.status === 'pending').length, color: '#f59e0b' },
            { label: '已完成', value: allTasks.filter(t => t.status === 'completed').length, color: '#2ecc71' },
            { label: '失败', value: allTasks.filter(t => t.status === 'failed').length, color: '#e74c3c' },
            { label: '已取消', value: allTasks.filter(t => t.status === 'cancelled').length, color: '#9ca3af' },
        ];
        statItems.forEach(item => {
            const card = statsRow.createDiv({
                attr: { style: 'padding:12px 8px;background:var(--background-secondary);border-radius:6px;text-align:center;' }
            });
            card.createDiv({ text: item.value.toString(), attr: { style: `font-size:20px;font-weight:700;color:${item.color};margin-bottom:2px;` } });
            card.createDiv({ text: item.label, cls: 'nw-text-sm-muted', attr: { style: 'font-size:11px;' } });
        });

        const toolbar = content.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:10px 12px;background:var(--background-secondary);border-radius:6px;flex-wrap:wrap;gap:8px;' }
        });

        const leftTools = toolbar.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' } });

        const selectAllBtn = leftTools.createEl('button', {
            text: '☑️ 全选',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: '全选 / 取消全选当前任务' }
        });
        selectAllBtn.addEventListener('click', () => {
            if (this.selectedTaskIds.size === filteredTasks.length) {
                this.selectedTaskIds.clear();
            } else {
                filteredTasks.forEach(t => this.selectedTaskIds.add(t.id));
            }
            this.renderRightPanel();
        });

        const invertSelectBtn = leftTools.createEl('button', {
            text: '🔄 反选',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: '反选当前任务' }
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
            text: `已选 ${this.selectedTaskIds.size} / ${filteredTasks.length} 项`,
            cls: 'nw-text-sm-muted',
            attr: { style: 'margin-left:4px;' }
        });
        void selectedCount;

        const rightTools = toolbar.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' } });

        const cancellableSelected = filteredTasks.filter(t =>
            this.selectedTaskIds.has(t.id) && (t.status === 'running' || t.status === 'pending')
        );
        const batchCancelBtn = rightTools.createEl('button', {
            text: '✕ 批量取消',
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            attr: { title: '取消选中的进行中 / 待执行任务' }
        });
        batchCancelBtn.disabled = cancellableSelected.length === 0;
        batchCancelBtn.style.opacity = cancellableSelected.length === 0 ? '0.5' : '1';
        batchCancelBtn.style.cursor = cancellableSelected.length === 0 ? 'not-allowed' : 'pointer';
        batchCancelBtn.addEventListener('click', () => {
            this.handleBatchCancel(cancellableSelected).catch(err => {
                log.error('批量取消任务失败:', err);
            });
        });

        const deletableSelected = filteredTasks.filter(t =>
            this.selectedTaskIds.has(t.id) && (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
        );
        const batchDeleteBtn = rightTools.createEl('button', {
            text: '🗑️ 批量删除',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: '删除选中的已完成 / 失败 / 已取消任务' }
        });
        batchDeleteBtn.disabled = deletableSelected.length === 0;
        batchDeleteBtn.style.opacity = deletableSelected.length === 0 ? '0.5' : '1';
        batchDeleteBtn.style.cursor = deletableSelected.length === 0 ? 'not-allowed' : 'pointer';
        batchDeleteBtn.addEventListener('click', () => {
            this.handleBatchDelete(deletableSelected).catch(err => {
                log.error('批量删除任务失败:', err);
            });
        });

        const activeTasks = allTasks.filter(t => t.status === 'running' || t.status === 'pending');
        const cancelAllBtn = rightTools.createEl('button', {
            text: '⚠️ 一键全部取消',
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            attr: { title: '取消全部进行中 / 待执行任务' }
        });
        cancelAllBtn.disabled = activeTasks.length === 0;
        cancelAllBtn.style.opacity = activeTasks.length === 0 ? '0.5' : '1';
        cancelAllBtn.style.cursor = activeTasks.length === 0 ? 'not-allowed' : 'pointer';
        cancelAllBtn.addEventListener('click', () => {
            this.handleCancelAll(activeTasks).catch(err => {
                log.error('一键取消任务失败:', err);
            });
        });

        const taskList = content.createDiv({
            attr: { style: 'display:flex;flex-direction:column;gap:8px;' }
        });

        filteredTasks.forEach(task => {
            const isSelected = this.selectedTaskIds.has(task.id);
            const card = taskList.createDiv({
                attr: {
                    style: `border:2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'} ;border-radius:8px;padding:16px;background:${isSelected ? 'rgba(var(--interactive-accent-rgb),0.05)' : 'var(--background-primary)'};transition:all 0.15s;`
                }
            });

            const headerRow = card.createDiv({
                attr: { style: 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;' }
            });

            const titleLeft = headerRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;' } });

            const checkbox = titleLeft.createEl('input', {
                type: 'checkbox',
                attr: { style: 'width:16px;height:16px;cursor:pointer;flex-shrink:0;' }
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

            const titleInfo = titleLeft.createDiv({ attr: { style: 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;' } });
            titleInfo.createSpan({
                text: '📖',
                attr: { style: 'font-size:20px;flex-shrink:0;' }
            });
            titleInfo.createDiv({
                text: task.bookName,
                attr: { style: 'font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }
            });

            const statusBadge = headerRow.createSpan({
                text: this.getTaskStatusLabel(task.status),
                attr: {
                    style: `padding:4px 12px;font-size:12px;border-radius:12px;${
                        task.status === 'completed' ? 'background:rgba(46,204,113,0.15);color:#2ecc71;' :
                        task.status === 'running' ? 'background:rgba(59,130,246,0.15);color:#3b82f6;' :
                        task.status === 'failed' ? 'background:rgba(231,76,60,0.15);color:#e74c3c;' :
                        task.status === 'pending' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;' :
                        'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });
            void statusBadge;

            const infoRow = card.createDiv({
                cls: 'nw-text-sm-muted', attr: { style: 'display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;' }
            });
            infoRow.createSpan({ text: `创建时间：${this.formatDateTime(task.createdAt)}` });
            if (task.startedAt) {
                infoRow.createSpan({ text: `开始时间：${this.formatDateTime(task.startedAt)}` });
            }
            if (task.completedAt) {
                infoRow.createSpan({ text: `完成时间：${this.formatDateTime(task.completedAt)}` });
            }
            infoRow.createSpan({ text: `维度：${task.dimensions.map(d => DIMENSION_LABELS[d]).join('、')}` });

            const taskProgress = this.deconstructionScheduler?.getAllTasks().find(t => t.id === task.id);
            const emitter = task.id ? this.deconstructionScheduler?.getTaskEmitter(task.id) : undefined;
            const emitterState = emitter?.getState();

            if ((task.status === 'running' || task.status === 'pending') && emitterState) {
                const progressWrap = card.createDiv({ attr: { style: 'margin-bottom:12px;' } });
                const bar = progressWrap.createDiv({
                    attr: { style: 'height:8px;background:var(--background-secondary);border-radius:4px;overflow:hidden;margin-bottom:6px;' }
                });
                bar.createDiv({
                    attr: { style: `height:100%;width:${emitterState.progress}%;background:var(--interactive-accent);transition:width 0.3s;` }
                });
                const progressInfo = progressWrap.createDiv({
                    attr: { style: 'display:flex;justify-content:space-between;align-items:center;' }
                });
                progressInfo.createSpan({
                    text: `${Math.round(emitterState.progress)}%`,
                    cls: 'nw-text-sm-muted'
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        attr: { style: 'font-size:12px;color:var(--text-normal);font-weight:500;' }
                    });
                }
            }

            if (emitterState?.message && (task.status === 'running' || task.status === 'pending')) {
                const messageEl = card.createDiv({
                    attr: { style: 'padding:8px 12px;background:var(--background-secondary);border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--text-muted);' }
                });
                messageEl.createSpan({ text: '💬 ' });
                messageEl.createSpan({ text: emitterState.message });
            }

            if ((task.status === 'running') && emitterState) {
                const timeRow = card.createDiv({
                    attr: { style: 'display:flex;gap:20px;margin-bottom:12px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;' }
                });
                if (emitterState.elapsed !== undefined) {
                    const elapsedEl = timeRow.createSpan({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
                    elapsedEl.createSpan({ text: '⏱️' });
                    elapsedEl.createSpan({ text: '已用：' });
                    elapsedEl.createSpan({
                        text: this.formatDuration(emitterState.elapsed),
                        attr: { style: 'font-weight:500;color:var(--text-normal);' }
                    });
                }
                if (emitterState.eta !== undefined) {
                    const etaEl = timeRow.createSpan({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
                    etaEl.createSpan({ text: '⏳' });
                    etaEl.createSpan({ text: '剩余：' });
                    etaEl.createSpan({
                        text: this.formatDuration(emitterState.eta),
                        attr: { style: 'font-weight:500;color:var(--text-normal);' }
                    });
                }
            }

            if (task.status === 'failed' && task.error) {
                const errorMsg = card.createDiv({
                    attr: { style: 'padding:10px 12px;background:rgba(231,76,60,0.1);border-radius:6px;margin-bottom:12px;font-size:12px;color:#e74c3c;' }
                });
                errorMsg.createSpan({ text: '错误信息：', attr: { style: 'font-weight:600;' } });
                errorMsg.createSpan({ text: task.error });
            }

            const actions = card.createDiv({
                attr: { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;' }
            });

            if (task.status === 'failed') {
                const retryBtn = actions.createEl('button', {
                    text: '🔄 重试',
                    cls: 'nw-btn nw-btn-primary nw-btn-sm',
                    attr: { title: '重新执行该失败任务' }
                });
                retryBtn.addEventListener('click', () => {
                    this.handleRetryTask(task).catch(err => {
                        log.error('重试任务失败:', err);
                    });
                });
            }

            if (task.status === 'running' || task.status === 'pending') {
                const cancelBtn = actions.createEl('button', {
                    text: '✕ 取消',
                    cls: 'nw-btn nw-btn-danger nw-btn-sm',
                    attr: { title: '取消该任务' }
                });
                cancelBtn.addEventListener('click', () => {
                    this.handleCancelTask(task).catch(err => {
                        log.error('取消任务失败:', err);
                    });
                });
            }

            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                const deleteBtn = actions.createEl('button', {
                    text: '🗑️ 删除',
                    cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    attr: { title: '删除该任务记录' }
                });
                deleteBtn.addEventListener('click', () => {
                    this.handleDeleteTask(task).catch(err => {
                        log.error('删除任务失败:', err);
                    });
                });
            }

            const viewBtn = actions.createEl('button', {
                text: '📖 查看书籍',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { title: '查看该任务对应的书籍' }
            });
            viewBtn.addEventListener('click', () => {
                const book = this.allBooks.find(b => b.id === task.bookId);
                if (book) {
                    this.activeMainTab = 'books';
                    this.renderLeftSidebar();
                    this.renderRightPanel();
                    this.openBookDetail(book);
                }
            });
        });
    }

    private getTaskStatusLabel(status: string): string {
        const map: Record<string, string> = {
            pending: '等待中',
            running: '运行中',
            paused: '已暂停',
            completed: '已完成',
            failed: '失败',
            cancelled: '已取消',
        };
        return map[status] || status;
    }

    private async handleRetryTask(task: BreakdownTask): Promise<void> {
        if (!this.deconstructionScheduler || !this.kbManager) return;
        try {
            const sourceText = await this.kbManager.getSourceText(task.bookId);
            await this.deconstructionScheduler.addTask(task.bookId, sourceText, task.dimensions);
            new Notice('已重新加入拆解队列');
            this.renderRightPanel();
        } catch (e) {
            new Notice(`重试失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async handleCancelTask(task: BreakdownTask): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '取消任务',
            description: `确定要取消《${task.bookName}》的拆解任务吗？`,
            confirmText: '确认取消',
            cancelText: '返回',
        });

        if (!confirmed) return;

        try {
            await this.deconstructionScheduler?.cancelTask(task.id);
            new Notice('任务已取消');
            this.renderRightPanel();
        } catch (e) {
            new Notice(`取消失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async handleDeleteTask(task: BreakdownTask): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除任务',
            description: `确定要删除《${task.bookName}》的任务记录吗？`,
            warning: '此操作不可恢复',
            confirmText: '确认删除',
            cancelText: '返回',
        });

        if (!confirmed) return;

        try {
            const success = await this.deconstructionScheduler?.removeTask(task.id);
            if (success) {
                this.selectedTaskIds.delete(task.id);
                new Notice('任务已删除');
                this.renderRightPanel();
            } else {
                new Notice('删除失败：任务正在进行中');
            }
        } catch (e) {
            new Notice(`删除失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async handleBatchCancel(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const taskNames = tasks.map(t => `• 《${t.bookName}》`).join('\n');
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '批量取消任务',
            description: `确定要取消以下 ${tasks.length} 个任务吗？`,
            steps: tasks.length <= 10 ? tasks.map(t => `《${t.bookName}》`) : undefined,
            warning: '取消后任务将停止执行，已完成的部分不会保留',
            confirmText: '确认取消',
            cancelText: '返回',
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
        new Notice(`已取消 ${successCount}/${tasks.length} 个任务`);
        this.renderRightPanel();
    }

    private async handleBatchDelete(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '批量删除任务',
            description: `确定要删除以下 ${tasks.length} 个任务记录吗？`,
            steps: tasks.length <= 10 ? tasks.map(t => `《${t.bookName}》`) : undefined,
            warning: '删除后任务记录将无法恢复',
            confirmText: '确认删除',
            cancelText: '返回',
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

        new Notice(`已删除 ${successCount}/${tasks.length} 个任务`);
        this.renderRightPanel();
    }

    private async handleCancelAll(tasks: BreakdownTask[]): Promise<void> {
        if (!this.deconstructionScheduler || tasks.length === 0) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '一键全部取消',
            description: `确定要取消所有 ${tasks.length} 个正在进行和等待中的任务吗？`,
            steps: [
                `运行中任务：${tasks.filter(t => t.status === 'running').length} 个`,
                `等待中任务：${tasks.filter(t => t.status === 'pending').length} 个`,
            ],
            warning: '此操作将停止所有正在进行的拆解任务',
            confirmText: '全部取消',
            cancelText: '返回',
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
        new Notice(`已取消 ${successCount}/${tasks.length} 个任务`);
        this.renderRightPanel();
    }

    // ============== Tab 4: 质量统计 ==============
    private renderStatsTab(): void {
        const content = this.rightContentEl.createDiv({
            cls: 'nw-kb-stats-tab',
            attr: { style: 'padding:16px;overflow-y:auto;height:100%;' }
        });

        content.createEl('h2', { text: '质量统计', attr: { style: 'margin:0 0 20px 0;font-size:18px;' } });

        const completedBooks = this.allBooks.filter(b => b.breakdownStatus === 'completed' && b.qualityScores);

        const overviewGrid = content.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;' }
        });
        const overviewItems = [
            { label: '书籍总数', value: this.allBooks.length, icon: '📚', color: 'var(--interactive-accent)' },
            { label: '已拆解', value: completedBooks.length, icon: '✅', color: '#2ecc71' },
            { label: '拆解中', value: this.allBooks.filter(b => b.breakdownStatus === 'processing').length, icon: '⏳', color: '#3b82f6' },
            {
                label: '平均质量分',
                value: completedBooks.length > 0
                    ? (completedBooks.reduce((sum, b) => sum + (b.qualityScores?.overall ?? 0), 0) / completedBooks.length).toFixed(1)
                    : '-',
                icon: '⭐',
                color: '#f59e0b'
            },
        ];
        overviewItems.forEach(item => {
            const card = overviewGrid.createDiv({
                attr: { style: 'padding:20px;background:var(--background-secondary);border-radius:8px;text-align:center;' }
            });
            card.createDiv({ text: item.icon, attr: { style: 'font-size:28px;margin-bottom:8px;' } });
            card.createDiv({ text: item.value.toString(), attr: { style: `font-size:24px;font-weight:700;color:${item.color};margin-bottom:4px;` } });
            card.createDiv({ text: item.label, cls: 'nw-text-sm-muted' });
        });

        if (completedBooks.length > 0) {
            const qualitySection = content.createDiv({
                attr: { style: 'margin-bottom:24px;padding:20px;background:var(--background-secondary);border-radius:8px;' }
            });
            qualitySection.createEl('h3', { text: '各维度质量分布', attr: { style: 'margin:0 0 16px 0;font-size:15px;' } });

            const dimensions: { key: Exclude<keyof QualityScores, 'overall' | 'vectorEnabled'>; label: string }[] = [
                { key: 'character', label: '人设' },
                { key: 'foreshadow', label: '伏笔' },
                { key: 'technique', label: '技巧' },
                { key: 'style', label: '风格' },
                { key: 'rhythm', label: '节奏' },
                { key: 'structure', label: '结构' },
            ];

            const chartWrap = qualitySection.createDiv({
                attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:center;justify-content:center;' }
            });

            const radarData = dimensions.map(d => ({
                label: d.label,
                value: completedBooks.reduce((sum, b) => sum + (b.qualityScores?.[d.key] as number ?? 0), 0) / completedBooks.length
            }));
            const radarCard = chartWrap.createDiv({ attr: { style: 'flex:1;min-width:280px;display:flex;justify-content:center;' } });
            this.renderChart(radarCard, radarChart(radarData, { size: 280, title: '平均质量雷达图' }));

            const avgCard = chartWrap.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
            dimensions.forEach(d => {
                const avg = completedBooks.reduce((sum, b) => sum + (b.qualityScores?.[d.key] as number ?? 0), 0) / completedBooks.length;
                const item = avgCard.createDiv({ attr: { style: 'margin-bottom:14px;' } });
                const top = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:6px;' } });
                top.createSpan({ text: d.label, attr: { style: 'font-size:13px;color:var(--text-normal);' } });
                top.createSpan({ text: avg.toFixed(1) + '分', attr: { style: 'font-size:13px;color:var(--text-muted);font-weight:500;' } });
                const bar = item.createDiv({
                    attr: { style: 'height:8px;background:var(--background-primary);border-radius:4px;overflow:hidden;' }
                });
                bar.createDiv({
                    attr: { style: `height:100%;width:${avg}%;background:var(--interactive-accent);border-radius:4px;` }
                });
            });
        }

        const genreSection = content.createDiv({
            attr: { style: 'margin-bottom:24px;padding:20px;background:var(--background-secondary);border-radius:8px;' }
        });
        genreSection.createEl('h3', { text: '题材分布', attr: { style: 'margin:0 0 16px 0;font-size:15px;' } });

        const genreCounts: Record<string, number> = {};
        this.allBooks.forEach(book => {
            if (book.primaryGenre) {
                genreCounts[book.primaryGenre] = (genreCounts[book.primaryGenre] || 0) + 1;
            }
        });

        const genreData = Object.entries(genreCounts)
            .map(([id, count]) => ({
                label: this.getGenreName(id),
                value: count
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        if (genreData.length > 0) {
            const chartCard = genreSection.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            this.renderChart(chartCard, barChart(genreData, { width: 500, height: 300, title: 'Top 10 题材分布' }));
        } else {
            genreSection.createDiv({
                text: '暂无题材数据',
                attr: { style: 'text-align:center;padding:40px;color:var(--text-muted);' }
            });
        }

        const statusSection = content.createDiv({
            attr: { style: 'margin-bottom:24px;padding:20px;background:var(--background-secondary);border-radius:8px;' }
        });
        statusSection.createEl('h3', { text: '拆解状态分布', attr: { style: 'margin:0 0 16px 0;font-size:15px;' } });

        const statusCounts = {
            pending: this.allBooks.filter(b => b.breakdownStatus === 'pending').length,
            processing: this.allBooks.filter(b => b.breakdownStatus === 'processing').length,
            completed: this.allBooks.filter(b => b.breakdownStatus === 'completed').length,
            failed: this.allBooks.filter(b => b.breakdownStatus === 'failed').length,
            interrupted: this.allBooks.filter(b => b.breakdownStatus === 'interrupted').length,
        };

        const donutData = [
            { label: '待拆解', value: statusCounts.pending, color: '#f59e0b' },
            { label: '拆解中', value: statusCounts.processing, color: '#3b82f6' },
            { label: '已完成', value: statusCounts.completed, color: '#2ecc71' },
            { label: '失败', value: statusCounts.failed, color: '#e74c3c' },
            { label: '拆解中断', value: statusCounts.interrupted, color: '#f97316' },
        ].filter(d => d.value > 0);

        const statusWrap = statusSection.createDiv({
            attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:center;justify-content:center;' }
        });

        if (donutData.length > 0) {
            const donutCard = statusWrap.createDiv({ attr: { style: 'flex:1;min-width:200px;display:flex;justify-content:center;' } });
            this.renderChart(donutCard, donutChart(donutData, { size: 220, title: '状态分布' }));
        }

        const statusList = statusWrap.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
        const statusItems = [
            { label: '待拆解', value: statusCounts.pending, color: '#f59e0b' },
            { label: '拆解中', value: statusCounts.processing, color: '#3b82f6' },
            { label: '已完成', value: statusCounts.completed, color: '#2ecc71' },
            { label: '失败', value: statusCounts.failed, color: '#e74c3c' },
            { label: '拆解中断', value: statusCounts.interrupted, color: '#f97316' },
        ];
        statusItems.forEach(item => {
            const row = statusList.createDiv({
                attr: { style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}' }
            });
            const left = row.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });
            left.createSpan({
                attr: { style: `width:10px;height:10px;border-radius:50%;background:${item.color};` }
            });
            left.createSpan({ text: item.label, attr: { style: 'font-size:13px;color:var(--text-normal);' } });
            row.createSpan({ text: item.value.toString(), attr: { style: 'font-size:13px;font-weight:600;color:var(--text-normal);' } });
        });
    }

    // ============== 操作方法 ==============
    private handleImportBooks(): void {
        new ImportBookModal(this.app, this.kbManager, async (book) => {
            try {
                await this.loadBooks();
                this.renderRightPanel();
                this.renderLeftSidebar();
                new Notice('✅ 书籍导入成功');
            } catch (e) {
                log.error('书籍导入后处理失败:', e);
                new Notice(`导入处理失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        }).open();
    }

    private handleBatchImport(): void {
        if (!this.plugin.batchImportManager || !this.plugin.knowledgeTagManager || !this.deconstructionScheduler) {
            new Notice('⚠️ 批量导入功能未初始化');
            return;
        }

        const modal = new BatchImportModal(this.app, {
            knowledgeBaseManager: this.kbManager!,
            deconstructionScheduler: this.deconstructionScheduler,
            tagManager: this.plugin.knowledgeTagManager,
            batchImportManager: this.plugin.batchImportManager,
            onComplete: async (result) => {
                try {
                    await this.loadBooks();
                    this.renderRightPanel();
                    this.renderLeftSidebar();
                    if (result.success > 0) {
                        new Notice(`✅ 成功导入 ${result.success} 本书籍`);
                    }
                    if (result.failed > 0) {
                        new Notice(`❌ ${result.failed} 本书籍导入失败`);
                    }
                } catch (e) {
                    log.error('批量导入后处理失败:', e);
                    new Notice(`导入后处理失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
            onViewDetail: (bookId, bookName) => {
                const book = this.allBooks.find(b => b.id === bookId);
                if (book) {
                    this.selectedBookId = bookId;
                    this.renderBookDetail();
                }
            },
        });
        modal.open();
    }

    private handleBatchOperations(): void {
        new BatchOperationsModal(this.app, this.kbManager, async () => {
            try {
                await this.loadBooks();
                this.renderRightPanel();
                this.renderLeftSidebar();
            } catch (e) {
                log.error('批量操作后处理失败:', e);
                new Notice(`操作后处理失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        }).open();
    }

    private renderDetailActionButtons(book: BookBasicInfo, actionsEl: HTMLElement): void {
        actionsEl.empty();

        if (book.breakdownStatus === 'pending') {
            const startBtn = actionsEl.createEl('button', {
                text: this.isStartingDeconstruction ? '⏳ 准备中...' : '🚀 开始拆解',
                cls: 'nw-btn nw-btn-primary nw-btn-sm',
                attr: { 'data-action': 'start-deconstruction', title: '拆解本书：分段 + 统计 + 向量增强，提取多维度写作特征' }
            });
            startBtn.disabled = this.isStartingDeconstruction;
            startBtn.style.opacity = this.isStartingDeconstruction ? '0.7' : '1';
            startBtn.style.cursor = this.isStartingDeconstruction ? 'not-allowed' : 'pointer';
            startBtn.addEventListener('click', () => {
                this.handleStartDeconstruction(book).catch(err => {
                    log.error('开始拆解失败:', err);
                });
            });
        } else if (book.breakdownStatus === 'failed') {
            const retryBtn = actionsEl.createEl('button', {
                text: this.isStartingDeconstruction ? '⏳ 准备中...' : '🔄 重新拆解',
                cls: 'nw-btn nw-btn-primary nw-btn-sm',
                attr: { 'data-action': 'restart-deconstruction', title: '上次拆解失败，重新开始拆解' }
            });
            retryBtn.disabled = this.isStartingDeconstruction;
            retryBtn.style.opacity = this.isStartingDeconstruction ? '0.7' : '1';
            retryBtn.style.cursor = this.isStartingDeconstruction ? 'not-allowed' : 'pointer';
            retryBtn.addEventListener('click', () => {
                this.handleRestartDeconstruction(book).catch(err => {
                    log.error('重新拆解失败:', err);
                });
            });
        } else if (book.breakdownStatus === 'completed') {
            const reBtn = actionsEl.createEl('button', {
                text: this.isStartingDeconstruction ? '⏳ 准备中...' : '🔄 重新拆解',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { 'data-action': 'restart-deconstruction', title: '清除已有拆解结果，重新拆解' }
            });
            reBtn.disabled = this.isStartingDeconstruction;
            reBtn.style.opacity = this.isStartingDeconstruction ? '0.7' : '1';
            reBtn.style.cursor = this.isStartingDeconstruction ? 'not-allowed' : 'pointer';
            reBtn.addEventListener('click', () => {
                this.handleRestartDeconstruction(book).catch(err => {
                    log.error('重新拆解失败:', err);
                });
            });
        } else if (book.breakdownStatus === 'processing') {
            const processingBtn = actionsEl.createEl('button', {
                text: '⏳ 拆解中...',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm'
            });
            processingBtn.disabled = true;
            processingBtn.style.opacity = '0.7';
            processingBtn.style.cursor = 'not-allowed';

            const forceCancelBtn = actionsEl.createEl('button', {
                text: '⚠️ 强制取消',
                cls: 'nw-btn nw-btn-sm',
                attr: { style: 'margin-left: 8px; font-size: 12px; color: #e74c3c;', title: '中断当前拆解任务（已完成维度保留）' }
            });
            forceCancelBtn.onclick = async () => {
                try {
                    const confirmed = await OperationConfirmModal.confirm(this.app, {
                        title: '强制取消拆解',
                        description: '强制取消将中断当前拆解任务。已完成的维度会保留，但未完成的维度需要重新拆解。\n\n确定要强制取消吗？',
                        confirmText: '强制取消',
                        cancelText: '不取消',
                        rememberKey: 'force-cancel-deconstruction'
                    });
                    if (confirmed) {
                        if (!this.kbManager) return;
                        const activeTasks = this.deconstructionScheduler?.getActiveTasks() || [];
                        const bookTask = activeTasks.find(t => t.bookId === book.id);
                        if (bookTask) {
                            await this.deconstructionScheduler?.cancelTask(bookTask.id);
                        }
                        await this.kbManager.setBreakdownStatus(book.id, 'interrupted', book.breakdownProgress);
                        if (!this.viewClosed && this.selectedBookId === book.id) {
                            this.refreshDetailActionButtons();
                            this.renderBookDetail();
                        }
                    }
                } catch (e) {
                    log.error('强制取消拆解失败:', e);
                    new Notice(`强制取消失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            };
        } else if (book.breakdownStatus === 'interrupted') {
            const resumeBtn = actionsEl.createEl('button', {
                text: '🔄 恢复拆解',
                cls: 'nw-btn nw-btn-warning nw-btn-sm',
                attr: { title: '从上次中断处继续拆解（已完成的段不再重跑）' }
            });
            resumeBtn.onclick = async () => {
                try {
                    if (!this.kbManager) return;
                    await this.kbManager.setBreakdownStatus(book.id, 'pending');
                    await this.handleStartDeconstruction(book);
                } catch (e) {
                    log.error('恢复拆解失败:', e);
                    new Notice(`恢复拆解失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const clearBtn = actionsEl.createEl('button', {
                text: '🗑️ 清除状态',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { title: '清除拆解状态与进度（不删除书籍）' }
            });
            clearBtn.onclick = async () => {
                try {
                    if (!this.kbManager) return;
                    await this.kbManager.setBreakdownStatus(book.id, 'pending', undefined, undefined);
                    book.breakdownProgress = undefined;
                    book.breakdownError = undefined;
                    if (!this.viewClosed && this.selectedBookId === book.id) {
                        this.refreshDetailActionButtons();
                        this.renderBookDetail();
                    }
                } catch (e) {
                    log.error('清除状态失败:', e);
                    new Notice(`清除状态失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            };
        }

        const editBtn = actionsEl.createEl('button', {
            text: '✏️ 编辑',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: '编辑书籍信息' }
        });
        editBtn.addEventListener('click', () => this.openEditModal(book));
        const deleteBtn = actionsEl.createEl('button', {
            text: '🗑️ 删除',
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            attr: { title: '删除该书籍及其拆解数据' }
        });
        deleteBtn.addEventListener('click', () => {
            this.handleDeleteBook(book).catch(err => {
                log.error('删除书籍失败:', err);
            });
        });
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
            new Notice('拆解调度器未初始化');
            return;
        }

        if (this.isStartingDeconstruction) return;

        this.isStartingDeconstruction = true;
        this.refreshDetailActionButtons();

        try {
            const sourceText = await this.kbManager?.getSourceText(book.id);
            if (!sourceText) {
                new Notice('无法获取书籍源文本');
                return;
            }

            const dimensions = [...ALL_BREAKDOWN_DIMENSIONS] as BreakdownDimension[];
            const dimensionLabels = dimensions.map(d => DIMENSION_LABELS[d]);
            const wordCount = sourceText.length;
            const vectorEnabled = this.deconstructionScheduler['settingsGetter']
                ? this.deconstructionScheduler['settingsGetter']().vectorEnhancedDeconstruction ?? false
                : false;
            const estimation = this.deconstructionScheduler.estimateDecompositionTime(wordCount, dimensions, vectorEnabled);

            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '开始拆解',
                description: `即将开始拆解《${book.name}》，将分析以下 ${dimensions.length} 个维度。`,
                etaMin: estimation.etaMin,
                etaMax: estimation.etaMax,
                steps: [...dimensionLabels, '向量化'],
                confirmText: '开始拆解',
                cancelText: '取消',
                rememberKey: 'kb-start-deconstruction',
            });

            if (!confirmed) {
                return;
            }

            await this.deconstructionScheduler.addTask(book.id, sourceText);
            new Notice(`已开始拆解《${book.name}》`);
            await this.refreshBookInfo();
        } catch (e) {
            log.error('开始拆解失败:', e);
            new Notice(`开始拆解失败: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isStartingDeconstruction = false;
            this.refreshDetailActionButtons();
        }
    }

    private async handleRestartDeconstruction(book: BookBasicInfo): Promise<void> {
        if (!this.deconstructionScheduler) {
            new Notice('拆解调度器未初始化');
            return;
        }

        if (this.isStartingDeconstruction) return;

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '重新拆解',
            description: `确定要重新拆解《${book.name}》吗？`,
            warning: '之前的拆解结果将被覆盖',
            confirmText: '确认重新拆解',
            cancelText: '取消',
        });

        if (!confirmed) {
            return;
        }

        this.isStartingDeconstruction = true;
        this.refreshDetailActionButtons();

        try {
            await this.deconstructionScheduler.rerunBook(book.id);
            new Notice(`已重新开始拆解《${book.name}》`);
            await this.refreshBookInfo();
        } catch (e) {
            log.error('重新拆解失败:', e);
            new Notice(`重新拆解失败: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isStartingDeconstruction = false;
            this.refreshDetailActionButtons();
        }
    }

    private async handleDeleteBook(book: BookBasicInfo): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除书籍',
            description: `确定要删除书籍「${book.name}」吗？`,
            warning: '此操作不可恢复',
            confirmText: '确认删除',
            cancelText: '取消',
        });

        if (!confirmed) return;

        try {
            // 先取消在途拆解，避免任务结束后把已删除的书目录/向量重新写回来
            await this.deconstructionScheduler?.cancelByBook(book.id);
            await this.kbManager?.deleteBook(book.id);
            new Notice('书籍已删除');
            this.selectedBookId = null;
            await this.loadBooks();
            this.closeBookDetail();
            this.renderLeftSidebar();
        } catch (e) {
            log.error('删除书籍失败:', e);
            new Notice(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private openEditModal(book: BookBasicInfo): void {
        new EditBookModal(this.app, book, this.kbManager, this.kb, async (updated) => {
            try {
                await this.loadBooks();
                await this.loadBookDetailData(book.id);
                this.renderBookDetail();
                this.renderLeftSidebar();
            } catch (e) {
                log.error('编辑书籍后处理失败:', e);
                new Notice(`编辑处理失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        }).open();
    }

    private async handleAddCustomTag(book: BookBasicInfo, tag: string): Promise<void> {
        if (!this.kbManager) return;
        if (book.customTags.includes(tag)) {
            new Notice('标签已存在');
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
            new Notice(`添加标签失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async handleDeleteCustomTag(book: BookBasicInfo, index: number): Promise<void> {
        if (!this.kbManager) return;
        try {
            const newTags = book.customTags.filter((_, i) => i !== index);
            await this.kbManager.updateBook(book.id, { customTags: newTags });
            await this.loadBooks();
            await this.loadBookDetailData(book.id);
            this.renderBookDetail();
        } catch (e) {
            log.error('删除标签失败:', e);
            new Notice(`删除标签失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // ============== 工具方法 ==============
    private getStatusLabel(status: BreakdownStatus): string {
        const map: Record<BreakdownStatus, string> = {
            pending: '待拆解',
            processing: '拆解中',
            completed: '已完成',
            failed: '失败',
            interrupted: '拆解中断',
        };
        return map[status] || status;
    }

    private getChannelLabel(channel: string): string {
        const map: Record<string, string> = {
            male: '男频',
            female: '女频',
            neutral: '中性',
        };
        return map[channel] || channel;
    }

    private formatWordCount(count?: number): string {
        if (!count) return '未知';
        if (count >= 10000) {
            return `${(count / 10000).toFixed(1)} 万字`;
        }
        return `${count} 字`;
    }

    private formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private formatDateTime(timestamp: number): string {
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}`;
    }

    private formatDuration(ms: number): string {
        if (ms <= 0) return '0秒';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            const remainingMinutes = minutes % 60;
            return `${hours}小时${remainingMinutes}分`;
        } else if (minutes > 0) {
            const remainingSeconds = seconds % 60;
            return `${minutes}分${remainingSeconds}秒`;
        } else {
            return `${seconds}秒`;
        }
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
            attr: { style: 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;' }
        });

        if (isDeconstructing && this.latestProgress) {
            const progress = this.latestProgress;
            const dimLabel = progress.currentDimension ? DIMENSION_LABELS[progress.currentDimension] : '';
            taskStatusEl.createSpan({
                text: '🔄',
                attr: { style: 'font-size:14px;' }
            });
            const infoEl = taskStatusEl.createDiv({
                attr: { style: 'display:flex;flex-direction:column;min-width:0;overflow:hidden;' }
            });
            infoEl.createEl('div', {
                attr: { style: 'font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' },
                text: `${progress.bookName}${dimLabel ? ' · ' + dimLabel : ''}`
            });
            const barContainer = infoEl.createDiv({
                attr: { style: 'width:120px;height:4px;background:var(--background-modifier-border-hover);border-radius:2px;margin-top:2px;overflow:hidden;' }
            });
            barContainer.createDiv({
                attr: {
                    style: `height:100%;width:${progress.totalProgress}%;background:var(--interactive-accent);transition:width 0.3s;`
                }
            });
            if (pendingCount > 0) {
                infoEl.createEl('div', {
                    attr: { style: 'font-size:10px;color:var(--text-muted);margin-top:1px;' },
                    text: `排队中 ${pendingCount} 个任务`
                });
            }
        } else if (hasPaused) {
            taskStatusEl.createSpan({ text: '⏸️', attr: { style: 'font-size:14px;' } });
            taskStatusEl.createSpan({ text: '拆解已暂停', attr: { style: 'color:var(--text-muted);' } });
        } else {
            taskStatusEl.createSpan({ text: '⏹️', attr: { style: 'font-size:14px;' } });
            taskStatusEl.createSpan({ text: '暂无拆解任务', attr: { style: 'color:var(--text-muted);' } });
        }

        // 中间：模型状态
        const modelStatusEl = this.monitorBarEl.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:8px;' }
        });

        const providerMap: Record<string, string> = {
            ollama: 'Ollama',
            openai: 'OpenAI',
            doubao: '豆包',
            qwen: '通义千问',
        };
        const providerType = (settings as any).vectorProvider || settings.vectorProviderType || 'ollama';
        const providerName = providerMap[providerType] || providerType;
        const modelName = (settings as any).vectorModel || settings.vectorOllamaModel || 'bge-m3';

        const connStatus = (settings as any).vectorConnectionStatus || 'idle';
        const statusColor = connStatus === 'connected'
            ? '#4caf50'
            : connStatus === 'disconnected'
                ? '#f44336'
                : 'var(--text-muted)';
        modelStatusEl.createEl('span', {
            attr: {
                style: `width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;`
            }
        });
        modelStatusEl.createSpan({
            text: `${providerName} · ${modelName}`,
            attr: { style: 'color:var(--text-muted);white-space:nowrap;' }
        });

        // 右侧：设置按钮
        const settingsBtn = this.monitorBarEl.createEl('button', {
            text: '⚙️ 设置',
            attr: {
                style: `padding:4px 10px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);cursor:${isDeconstructing ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${isDeconstructing ? '0.5' : '1'};`
            }
        });
        if (isDeconstructing) {
            settingsBtn.setAttribute('title', '拆解进行中，暂停后可修改设置');
            settingsBtn.disabled = true;
        } else {
            settingsBtn.onclick = () => {
                new MiniSettingsModal(this.app, this.plugin, 'knowledge').open();
            };
        }
    }
}
