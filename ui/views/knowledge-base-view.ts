import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { KnowledgeBaseManager, type BookBasicInfo, type BreakdownStatus, type QualityScores } from '../../services/knowledge-base-manager';
import { WebnovelKnowledgeBase, type GenreConfig, type SubGenreConfig, type TechniqueDef } from '../../engine/webnovel-knowledge-base';
import { KnowledgeBaseConfigManager } from '../../engine/knowledge-base-config';
import { applyNwScope } from '../../utils/helpers';
import { AdaptiveDebounceManager } from '../../shared/adaptive-debounce-manager';
import { radarChart, barChart, donutChart, wordCloud, lineChart, scatterChart, timelineChart } from '../svg-charts';
import { DeconstructionScheduler, type BreakdownProgress, type BreakdownTask, type BreakdownDimension, type DimensionQualityScore } from '../../services/deconstruction-scheduler';
import { BatchImportModal } from '../batch-import-modal';
import { MiniSettingsModal } from '../mini-settings-modal';
import { OperationConfirmModal, TaskCardComponent } from '../components/progress';
import { createLogger } from '../../shared/logger';

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
    kbBookDir,
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

interface StyleData {
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

interface RhythmData {
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

interface TechniqueData {
    techniques?: Array<{ id: string; name: string; category: string; confidence: number; count: number; genreWeight: number; qualityScore: number }>;
    typeDistribution?: Record<string, number>;
    qualityScore?: { totalScore: number; diversityScore: number; coverageScore: number };
}

interface StructureData {
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

interface CharacterKnowledgeData {
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

interface ForeshadowData {
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

interface CommercialData {
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

interface ReadabilityData {
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

    private expandedGenres: Set<string> = new Set();
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
            text: '📚 知识库',
            attr: { style: 'margin:0;font-size:16px;' }
        });

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
        const isExpanded = this.expandedGenres.has(genre.id);
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
            if (this.expandedGenres.has(genre.id)) {
                this.expandedGenres.delete(genre.id);
            } else {
                this.expandedGenres.add(genre.id);
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
            cls: 'nw-btn nw-btn-primary nw-btn-sm nw-flex-shrink-0'
        });
        importBtn.addEventListener('click', () => this.handleImportBooks());

        const batchImportBtn = topRow.createEl('button', {
            text: '📦 批量导入',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-flex-shrink-0'
        });
        batchImportBtn.addEventListener('click', () => this.handleBatchImport());

        const batchBtn = topRow.createEl('button', {
            text: '⚙️ 批量',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-flex-shrink-0'
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
        const empty = container.createDiv({
            attr: { style: 'text-align:center;padding:60px 20px;color:var(--text-muted);' }
        });
        empty.createDiv({ text: '📚', attr: { style: 'font-size:48px;margin-bottom:16px;' } });
        empty.createDiv({ text: '暂无书籍', attr: { style: 'font-size:16px;margin-bottom:8px;color:var(--text-normal);' } });
        empty.createDiv({ text: '点击「导入书籍」开始添加你的第一本参考书籍', attr: { style: 'font-size:13px;margin-bottom:20px;' } });
        const btnRow = empty.createDiv({ attr: { style: 'display:flex;gap:10px;justify-content:center;' } });
        const btn = btnRow.createEl('button', {
            text: '📥 导入书籍',
            cls: 'nw-btn nw-btn-primary'
        });
        btn.addEventListener('click', () => this.handleImportBooks());
        const batchBtn = btnRow.createEl('button', {
            text: '📦 批量导入',
            cls: 'nw-btn nw-btn-secondary'
        });
        batchBtn.addEventListener('click', () => this.handleBatchImport());
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
                this.renderBookOverviewTab(tabContent as HTMLElement, book);
                break;
            case 'style':
                this.renderBookStyleTab(tabContent as HTMLElement);
                break;
            case 'rhythm':
                this.renderBookRhythmTab(tabContent as HTMLElement);
                break;
            case 'technique':
                this.renderBookTechniqueTab(tabContent as HTMLElement);
                break;
            case 'structure':
                this.renderBookStructureTab(tabContent as HTMLElement);
                break;
            case 'character':
                this.renderBookCharacterTab(tabContent as HTMLElement);
                break;
            case 'foreshadow':
                this.renderBookForeshadowTab(tabContent as HTMLElement);
                break;
            case 'commercial':
                this.renderBookCommercialTab(tabContent as HTMLElement);
                break;
            case 'readability':
                this.renderBookReadabilityTab(tabContent as HTMLElement);
                break;
            case 'tags':
                this.renderBookTagsTab(tabContent as HTMLElement, book);
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

    // ---- 风格分析 Tab ----
    private renderBookStyleTab(container: HTMLElement): void {
        const data = this.styleData;
        if (!data) {
            this.renderDetailEmpty(container, '风格分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const { sentenceRhythm, paragraphStructure, narrativeStyle, overallStyle, wordPreference, rhetoric, dialogueStyle } = data;

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        // 风格特征雷达图
        const radarItems: Array<{ label: string; value: number }> = [];
        if (sentenceRhythm?.avgSentenceLength !== undefined) {
            const normalizedLength = Math.min(100, (sentenceRhythm.avgSentenceLength / 50) * 100);
            radarItems.push({ label: '平均句长', value: normalizedLength });
        }
        if (paragraphStructure?.avgParagraphLength !== undefined) {
            const normalizedPara = Math.min(100, (paragraphStructure.avgParagraphLength / 200) * 100);
            radarItems.push({ label: '平均段长', value: normalizedPara });
        }
        if (narrativeStyle?.dialogueRatio !== undefined) {
            radarItems.push({ label: '对白占比', value: narrativeStyle.dialogueRatio * 100 });
        }
        if (narrativeStyle?.descriptionRatio?.total !== undefined) {
            radarItems.push({ label: '描写占比', value: narrativeStyle.descriptionRatio.total * 100 });
        }
        if (wordPreference?.colloquialismLevel !== undefined) {
            radarItems.push({ label: '口语化程度', value: wordPreference.colloquialismLevel * 100 });
        }
        if (wordPreference?.idiomDensity !== undefined) {
            radarItems.push({ label: '成语密度', value: Math.min(100, wordPreference.idiomDensity / 100 * 100) });
        }

        if (radarItems.length >= 3) {
            const radarSection = this.createDetailSection(container, '风格雷达图');
            const radarDiv = radarSection.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            radarDiv.innerHTML = radarChart(radarItems, { size: 320, title: '写作风格特征' });
        }

        // 基础统计卡片
        if (sentenceRhythm || paragraphStructure || narrativeStyle) {
            const section = this.createDetailSection(container, '基础统计');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;' }
            });
            if (sentenceRhythm?.avgSentenceLength !== undefined) {
                this.addInfoItem(grid, '平均句长', `${sentenceRhythm.avgSentenceLength.toFixed(1)} 字`);
            }
            if (paragraphStructure?.avgParagraphLength !== undefined) {
                this.addInfoItem(grid, '平均段长', `${paragraphStructure.avgParagraphLength.toFixed(1)} 字`);
            }
            if (narrativeStyle?.dialogueRatio !== undefined) {
                this.addInfoItem(grid, '对白占比', `${(narrativeStyle.dialogueRatio * 100).toFixed(1)}%`);
            }
            if (narrativeStyle?.descriptionRatio?.total !== undefined) {
                this.addInfoItem(grid, '描写占比', `${(narrativeStyle.descriptionRatio.total * 100).toFixed(1)}%`);
            }
            if (wordPreference?.idiomDensity !== undefined) {
                this.addInfoItem(grid, '成语密度', `${wordPreference.idiomDensity.toFixed(1)} /千字`);
            }
            if (wordPreference?.colloquialismLevel !== undefined) {
                this.addInfoItem(grid, '口语化程度', `${(wordPreference.colloquialismLevel * 100).toFixed(1)}%`);
            }
        }

        // 风格特征词云（使用高频词）
        if (wordPreference?.topWords && wordPreference.topWords.length > 0) {
            const section = this.createDetailSection(container, '高频词词云');
            const wordItems = wordPreference.topWords.slice(0, 30).map(item => ({
                text: item.word,
                weight: item.count
            }));
            const wordCloudDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            wordCloudDiv.innerHTML = wordCloud(wordItems, { width: 500, height: 200, title: '高频词分布' });
        }

        // 修辞手法柱状图
        if (rhetoric) {
            const section = this.createDetailSection(container, '修辞手法');
            const barData = [
                { label: '比喻', value: rhetoric.metaphor },
                { label: '拟人', value: rhetoric.personification },
                { label: '排比', value: rhetoric.parallelism },
                { label: '反问', value: rhetoric.rhetoricalQuestion },
                { label: '夸张', value: rhetoric.hyperbole },
                { label: '对偶', value: rhetoric.antithesis },
            ];
            const barDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            barDiv.innerHTML = barChart(barData, { width: 500, height: 180, title: '修辞手法统计' });
        }

        // 整体风格
        if (overallStyle) {
            const section = this.createDetailSection(container, '整体风格');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;' }
            });
            const styleCard = grid.createDiv({
                attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;' }
            });
            styleCard.createEl('div', { text: '主要文风', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' } });
            styleCard.createEl('div', { text: overallStyle.primaryStyle, attr: { style: 'font-size:18px;font-weight:700;color:var(--interactive-accent);' } });
            if (overallStyle.secondaryStyle) {
                styleCard.createEl('div', { text: `次要文风: ${overallStyle.secondaryStyle}`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:4px;' } });
            }
            styleCard.createEl('div', { text: `置信度: ${(overallStyle.confidence * 100).toFixed(0)}%`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:4px;' } });

            if (overallStyle.styleScores) {
                const scoresCard = grid.createDiv({
                    attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;' }
                });
                scoresCard.createEl('div', { text: '文风评分', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' } });
                const scoreList = scoresCard.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
                Object.entries(overallStyle.styleScores).slice(0, 5).forEach(([style, score]) => {
                    scoreList.createEl('div', {
                        text: `${style}: ${(score * 100).toFixed(0)}%`,
                        attr: { style: 'font-size:12px;' }
                    });
                });
            }
        }

        if (data.vocabularyRichness) {
            const vr = data.vocabularyRichness;
            const section = this.createDetailSection(container, '词汇丰富度');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
            });
            this.addInfoItem(grid, 'TTR', vr.ttr.toFixed(3));
            this.addInfoItem(grid, 'MTLD', vr.mtld.toFixed(1));
            this.addInfoItem(grid, "Yule's K", vr.yulesK.toFixed(3));
            this.addInfoItem(grid, '词汇量', vr.vocabularySize.toLocaleString());
            const levelItem = grid.createDiv({
                attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;' }
            });
            levelItem.createDiv({ text: '级别', cls: 'nw-text-muted-11', attr: { style: 'margin-bottom:4px;' } });
            levelItem.createDiv({
                text: `${vr.level} (${vr.score.toFixed(1)}分)`,
                attr: { style: 'font-size:13px;color:var(--interactive-accent);font-weight:500;' }
            });
        }

        if (data.fiveSenses) {
            const fs = data.fiveSenses;
            if (fs.distribution && Object.keys(fs.distribution).length >= 3) {
                const senseNameMap: Record<string, string> = {
                    visual: '视觉', auditory: '听觉', olfactory: '嗅觉', gustatory: '味觉', tactile: '触觉'
                };
                const section = this.createDetailSection(container, '五感描写分布');
                const radarData = Object.entries(fs.distribution).map(([k, v]) => ({
                    label: senseNameMap[k] || k,
                    value: Math.min(100, v * 100)
                }));
                const radarDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
                radarDiv.innerHTML = radarChart(radarData, { size: 300, title: '五感雷达图' });

                const statsRow = section.createDiv({
                    attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:16px;' }
                });
                this.addInfoItem(statsRow, '平衡度', `${fs.balanceScore.toFixed(1)}分`);
                this.addInfoItem(statsRow, '级别', fs.level);
                this.addInfoItem(statsRow, '主导感', senseNameMap[fs.dominantSense] || fs.dominantSense);
            }
        }

        if (data.sentenceRhythm?.sentenceTypeDistribution) {
            const std = data.sentenceRhythm.sentenceTypeDistribution;
            const typeNameMap: Record<string, string> = {
                declarative: '陈述句', interrogative: '疑问句', exclamatory: '感叹句', elliptical: '省略句'
            };
            const donutData = Object.entries(std).map(([k, v]) => ({
                label: typeNameMap[k] || k,
                value: v
            }));
            const section = this.createDetailSection(container, '句式类型分布');
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            chartDiv.innerHTML = donutChart(donutData, { size: 260, title: '句式类型' });
        }

        if (data.sentenceRhythm?.lengthDistribution) {
            const sld = data.sentenceRhythm.lengthDistribution;
            const sdNameMap: Record<string, string> = { short: '短句', medium: '中句', long: '长句' };
            const barData = Object.entries(sld).map(([k, v]) => ({ label: sdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '句长分布');
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            chartDiv.innerHTML = barChart(barData, { width: 400, height: 180, title: '句长分布' });
        }

        if (data.paragraphStructure?.lengthDistribution) {
            const pld = data.paragraphStructure.lengthDistribution;
            const pdNameMap: Record<string, string> = { short: '短段', medium: '中段', long: '长段', veryLong: '超长段' };
            const barData = Object.entries(pld).map(([k, v]) => ({ label: pdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '段落长度分布');
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            chartDiv.innerHTML = barChart(barData, { width: 400, height: 180, title: '段落长度' });
        }
    }

    // ---- 节奏分析 Tab ----
    private renderBookRhythmTab(container: HTMLElement): void {
        const data = this.rhythmData;
        if (!data || (!data.emotionPoints && !data.coolPoints && !data.plotStages && !data.structureMatches && !data.chapterRhythm)) {
            this.renderDetailEmpty(container, '节奏分析数据');
            return;
        }

        const { emotionPoints, chapterRhythm } = data;

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        if (data.stats) {
            const statsSection = this.createDetailSection(container, '节奏统计摘要');
            const statsGrid = statsSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;' }
            });
            this.addInfoItem(statsGrid, '平均节奏', data.stats.avgRhythm != null ? data.stats.avgRhythm.toFixed(2) : '-');
            this.addInfoItem(statsGrid, '高潮点', data.stats.climaxCount != null ? String(data.stats.climaxCount) : '-');
            this.addInfoItem(statsGrid, '爽点', data.stats.coolPointCount != null ? String(data.stats.coolPointCount) : '-');
            this.addInfoItem(statsGrid, '钩子率', data.stats.hookRate != null ? `${(data.stats.hookRate * 100).toFixed(1)}%` : '-');
            this.addInfoItem(statsGrid, '平均张力', data.stats.avgTension != null ? data.stats.avgTension.toFixed(2) : '-');
        }

        // 情绪点折线图（使用 emotionPoints）
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, '情绪变化曲线');
            const emotionSeries = [{
                name: '情绪强度',
                data: emotionPoints.slice(0, 50).map(p => ({
                    label: `章节${p.chapterIndex}`,
                    value: p.intensity * 100,
                    annotation: p.type === 'reversal' ? '反转' : p.type === 'small_climax' ? '小高潮' : p.type === 'trough' ? '低谷' : undefined
                })),
                smooth: true
            }];
            const lineDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            lineDiv.innerHTML = lineChart(emotionSeries, { width: 600, height: 200, title: '情绪强度变化', xAxisLabel: '章节', yAxisLabel: '强度(%)' });

            // 情绪类型统计柱状图
            const typeCounts: Record<string, number> = {};
            emotionPoints.forEach(p => {
                typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
            });
            const typeLabels: Record<string, string> = {
                'reversal': '反转',
                'small_climax': '小高潮',
                'trough': '低谷',
                'suspense': '悬念',
                'climax': '高潮'
            };
            const barData = Object.entries(typeCounts).map(([type, count]) => ({
                label: typeLabels[type] || type,
                value: count
            }));
            const barSection = this.createDetailSection(container, '情绪类型分布');
            const barDiv = barSection.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            barDiv.innerHTML = barChart(barData, { width: 400, height: 160, title: '情绪类型统计' });
        }

        // 章节节奏评分折线图
        if (chapterRhythm && chapterRhythm.length > 0) {
            const section = this.createDetailSection(container, '章节节奏评分');
            const series = [
                {
                    name: '情绪分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.emotionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: '紧张分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.tensionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: '密度分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.densityScore * 100
                    })),
                    smooth: true
                }
            ];
            const lineDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            lineDiv.innerHTML = lineChart(series, { width: 600, height: 220, title: '章节节奏多维评分', xAxisLabel: '章节', yAxisLabel: '评分(%)' });
        }

        // 节奏事件散点图（使用 emotionPoints）
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, `节奏事件分布 (${emotionPoints.length})`);
            const scatterPoints = emotionPoints.slice(0, 50).map(p => ({
                x: p.position * 100,
                y: p.intensity * 100,
                label: p.description,
                category: p.type
            }));
            const scatterDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            scatterDiv.innerHTML = scatterChart(scatterPoints, { width: 500, height: 200, title: '节奏事件位置分布', xAxisLabel: '位置(%)', yAxisLabel: '强度(%)' });
        }

        // 爽点/燃点散点图（保留原逻辑）
        if (data.coolPoints && data.coolPoints.length > 0) {
            const section = this.createDetailSection(container, `爽点/燃点分布 (${data.coolPoints.length})`);
            
            const scatterPoints = data.coolPoints.map(p => ({
                x: p.x,
                y: p.y,
                label: p.label,
                category: p.category
            }));
            const scatterDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            scatterDiv.innerHTML = scatterChart(scatterPoints, { width: 500, height: 200, title: '爽点位置分布', xAxisLabel: '章节位置(%)', yAxisLabel: '强度' });

            // 详情卡片
            const grid = section.createDiv({
                attr: { style: 'margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;' }
            });
            data.coolPoints.forEach(p => {
                const card = grid.createDiv({
                    attr: { style: 'padding:10px;background:var(--background-secondary);border-radius:6px;font-size:12px;' }
                });
                card.createEl('div', {
                    text: `${p.category} · 位置 ${p.x.toFixed(1)}%`,
                    attr: { style: 'font-weight:500;color:var(--interactive-accent);margin-bottom:4px;' }
                });
                card.createEl('div', { text: p.label, attr: { style: 'color:var(--text-muted);' } });
            });
        }

        // 剧情阶段
        if (data.plotStages && data.plotStages.length > 0) {
            const section = this.createDetailSection(container, '剧情阶段');
            const wrap = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
            data.plotStages.forEach(p => {
                wrap.createDiv({
                    attr: { style: 'display:flex;gap:12px;align-items:center;padding:8px 12px;background:var(--background-secondary);border-radius:6px;' }
                }).createEl('div', {
                    text: `${p.name} (${p.start}% - ${p.end}%)`,
                    attr: { style: 'font-size:13px;font-weight:500;' }
                });
            });
        }

        // 结构匹配度
        if (data.structureMatches && data.structureMatches.length > 0) {
            const section = this.createDetailSection(container, '结构匹配度');
            const barDiv = section.createDiv();
            barDiv.innerHTML = barChart(data.structureMatches, { width: 500, height: 160 });
        }

        if (data.hookAnalysis) {
            const ha = data.hookAnalysis;
            const section = this.createDetailSection(container, '钩子分析');
            const wrap = section.createDiv({ attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;' } });
            const chartWrap = wrap.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
            const typeDistArr = Object.entries(ha.typeDistribution || {}).map(([k, v]) => ({ label: k, value: v }));
            chartWrap.innerHTML = donutChart(typeDistArr, { size: 240, title: '钩子类型分布' });

            const infoWrap = wrap.createDiv({ attr: { style: 'flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;' } });
            infoWrap.createDiv({
                text: `钩子率: ${(ha.hookRate * 100).toFixed(1)}%`,
                attr: { style: 'font-size:20px;font-weight:700;color:var(--interactive-accent);' }
            });
            infoWrap.createDiv({
                text: `无钩子章节: ${ha.noHookChapters?.length ?? 0} 章`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            infoWrap.createDiv({
                text: `平均强度: ${ha.avgIntensity.toFixed(2)}`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            const distWrap = infoWrap.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
            if (ha.typeDistribution) {
                Object.entries(ha.typeDistribution).forEach(([type, count]) => {
                    distWrap.createDiv({
                        text: `${type}: ${count}`,
                        attr: { style: 'font-size:12px;color:var(--text-normal);padding:2px 8px;background:var(--background-secondary);border-radius:4px;' }
                    });
                });
            }
        }

        if (data.tensionCurve) {
            const tc = data.tensionCurve;
            const section = this.createDetailSection(container, '张力曲线分析');
            const statsRow = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px;' }
            });
            this.addInfoItem(statsRow, '平均张力', tc.overallTensionAvg.toFixed(3));
            this.addInfoItem(statsRow, '张力标准差', tc.overallTensionStd.toFixed(3));
            this.addInfoItem(statsRow, '波形分', tc.waveformScore.toFixed(1));

            if (tc.peaks && tc.valleys) {
                const linePoints = [
                    ...tc.peaks.map(p => ({ label: `C${p.chapterIndex}`, value: p.intensity })),
                    ...tc.valleys.map(v => ({ label: `C${v.chapterIndex}`, value: v.intensity }))
                ].sort((a, b) => {
                    const aNum = parseInt(a.label.replace('C', ''), 10);
                    const bNum = parseInt(b.label.replace('C', ''), 10);
                    return aNum - bNum;
                });
                const lineDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
                lineDiv.innerHTML = lineChart([{ name: '张力', data: linePoints, showPoints: true }], { width: 600, height: 200, title: '张力峰谷' });
            }
        }

        if (data.nrcEmotion) {
            const ne = data.nrcEmotion;
            if (ne.overallDistribution) {
                const nameMap: Record<string, string> = {
                    anger: '愤怒', anticipation: '期待', disgust: '厌恶', fear: '恐惧',
                    joy: '喜悦', sadness: '悲伤', surprise: '惊讶', trust: '信任'
                };
                const section = this.createDetailSection(container, 'NRC 情绪分布');
                const radarData = Object.entries(ne.overallDistribution).map(([k, v]) => ({
                    label: nameMap[k] || k,
                    value: Math.min(100, v * 100)
                }));
                if (radarData.length >= 3) {
                    const radarDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
                    radarDiv.innerHTML = radarChart(radarData, { size: 320, title: 'NRC 八维情绪雷达' });
                }
            }
        }

        if (data.emotionArc) {
            const ea = data.emotionArc;
            const section = this.createDetailSection(container, '情绪弧线');
            const arcTypeMap: Record<string, string> = {
                rags_to_riches: '逆袭上升 (Rags to Riches)',
                riches_to_rags: '盛极而衰 (Riches to Rags)',
                man_in_hole: '跌入谷底回升 (Man in Hole)',
                icarus: '伊卡洛斯 (Icarus)',
                cinderella: '灰姑娘 (Cinderella)',
                oedipus: '俄狄浦斯 (Oedipus)',
                steady: '平稳型 (Steady)',
                complex: '复杂型 (Complex)'
            };
            const card = section.createDiv({
                attr: { style: 'padding:16px;background:var(--background-secondary);border-radius:8px;' }
            });
            card.createDiv({
                text: `弧线类型: ${arcTypeMap[ea.arcType] || ea.arcType}`,
                attr: { style: 'font-size:16px;font-weight:600;color:var(--interactive-accent);margin-bottom:8px;' }
            });
            card.createDiv({
                text: `置信度: ${(ea.confidence * 100).toFixed(0)}%`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            if (ea.description) {
                card.createDiv({
                    text: ea.description,
                    attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:8px;' }
                });
            }
        }
    }

    // ---- 结构拆解 Tab ----
    private renderBookStructureTab(container: HTMLElement): void {
        const data = this.structureData;
        if (!data || (!data.qcchSegments && !data.rhythmUnits && !data.threeLineStructure && !data.structureType)) {
            this.renderDetailEmpty(container, '结构拆解数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        const { qcchSegments, rhythmUnits, threeLineStructure, structureType, stats } = data;

        // 结构类型
        if (structureType) {
            const section = this.createDetailSection(container, '结构类型');
            section.createDiv({
                text: structureType,
                attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;font-size:14px;font-weight:500;' }
            });
        }

        // 统计信息
        if (stats) {
            const section = this.createDetailSection(container, '结构统计');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;' }
            });
            this.addInfoItem(grid, '卷数', stats.volumeCount.toString());
            this.addInfoItem(grid, '章节数', stats.chapterCount.toString());
            this.addInfoItem(grid, '平均章字数', stats.avgChapterWordCount.toString());
            this.addInfoItem(grid, '总字数', stats.totalWordCount.toString());
        }

        // 起承转合结构
        if (qcchSegments && qcchSegments.length > 0) {
            const section = this.createDetailSection(container, '起承转合结构');
            
            const qcchColors: Record<string, string> = {
                '起': '#3b82f6',
                '承': '#10b981',
                '转': '#ef4444',
                '合': '#8b5cf6',
            };
            
            const timelineEvents = qcchSegments.map((seg, i) => ({
                position: seg.startPosition,
                label: seg.type,
                description: seg.type,
                type: seg.type,
                level: 0
            }));
            const timelineDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            timelineDiv.innerHTML = timelineChart(timelineEvents, { width: 500, height: 100, title: '起承转合时间轴' });

            const list = section.createDiv({ attr: { style: 'margin-top:12px;display:flex;flex-direction:column;gap:8px;' } });
            qcchSegments.forEach(seg => {
                const row = list.createDiv({
                    attr: { style: 'display:flex;gap:12px;align-items:center;padding:10px;background:var(--background-secondary);border-radius:6px;' }
                });
                const typeEl = row.createEl('div', {
                    text: seg.type,
                    attr: { style: `min-width:40px;padding:4px 12px;background:${qcchColors[seg.type] || '#6b7280'};color:#fff;border-radius:4px;font-size:13px;font-weight:500;text-align:center;` }
                });
                const content = row.createDiv({ attr: { style: 'flex:1;' } });
                content.createEl('div', {
                    text: `位置: ${(seg.startPosition * 100).toFixed(0)}% - ${(seg.endPosition * 100).toFixed(0)}%`,
                    attr: { style: 'font-size:13px;font-weight:500;margin-bottom:2px;' }
                });
                if (seg.chapterRange && seg.chapterRange.length === 2) {
                    content.createEl('div', {
                        text: `章节范围: 第${seg.chapterRange[0]+1}-${seg.chapterRange[1]+1}章`,
                        attr: { style: 'font-size:12px;color:var(--text-muted);' }
                    });
                }
            });
        }

        // 三线叙事结构
        if (threeLineStructure) {
            const section = this.createDetailSection(container, '三线叙事');
            const lines = [
                { key: 'mainLine', label: '主线', color: '#ef4444' },
                { key: 'subLine', label: '副线', color: '#3b82f6' },
                { key: 'romanceLine', label: '感情线', color: '#ec4899' },
            ];
            
            lines.forEach(({ key, label, color }) => {
                const lineData = threeLineStructure[key as keyof typeof threeLineStructure] as { description: string; keyNodes?: Array<{ position: number; description: string }> };
                if (!lineData) return;
                
                const card = section.createDiv({
                    attr: { style: `border-left:3px solid ${color};padding:12px;background:var(--background-secondary);border-radius:0 6px 6px 0;margin-bottom:8px;` }
                });
                card.createDiv({ text: lineData.description, attr: { style: 'font-size:12px;color:var(--text-normal);line-height:1.5;' } });
                
                if (lineData.keyNodes && lineData.keyNodes.length > 0) {
                    const nodes = card.createDiv({ attr: { style: 'margin-top:8px;display:flex;flex-wrap:gap:4px;' } });
                    lineData.keyNodes.forEach(node => {
                        nodes.createSpan({
                            text: `${(node.position * 100).toFixed(0)}%`,
                            attr: { style: `padding:2px 8px;background:${color}20;color:${color};border-radius:4px;font-size:11px;margin-right:4px;margin-bottom:4px;display:inline-block;` }
                        });
                    });
                }
            });
        }

        // 章节列表
        if (rhythmUnits && rhythmUnits.length > 0) {
            const chapters = rhythmUnits.filter(u => u.level === 'chapter').slice(0, 10);
            if (chapters.length > 0) {
                const section = this.createDetailSection(container, '章节列表（前10章）');
                const list = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
                chapters.forEach(ch => {
                    const row = list.createDiv({
                        attr: { style: 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    row.createSpan({ text: ch.title, attr: { style: 'font-size:13px;font-weight:500;' } });
                    row.createSpan({ text: `${ch.wordCount.toLocaleString()}字`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                });
            }
        }
    }

    // ---- 概览 Tab ----
    private renderBookOverviewTab(container: HTMLElement, book: BookBasicInfo): void {
        const infoSection = this.createDetailSection(container, '基本信息');
        const infoGrid = infoSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;' }
        });
        this.addInfoItem(infoGrid, '书名', book.name);
        this.addInfoItem(infoGrid, '作者', book.author || '未知');
        this.addInfoItem(infoGrid, '字数', this.formatWordCount(book.wordCount));
        this.addInfoItem(infoGrid, '添加时间', this.formatDateTime(book.createdAt));
        this.addInfoItem(infoGrid, '更新时间', this.formatDateTime(book.updatedAt));
        this.addInfoItem(infoGrid, '拆解状态', this.getStatusLabel(book.breakdownStatus));

        if (book.synopsis) {
            const synopsisSection = this.createDetailSection(container, '简介');
            synopsisSection.createDiv({
                text: book.synopsis,
                attr: { style: 'font-size:13px;line-height:1.6;color:var(--text-normal);padding:12px;background:var(--background-secondary);border-radius:6px;' }
            });
        }

        const genreSection = this.createDetailSection(container, '题材分类');
        this.renderGenreInfo(genreSection, book);

        if (book.qualityScores) {
            const qualitySection = this.createDetailSection(container, '质量评分');
            this.renderQualityChart(qualitySection, book);
        }

        const dimSection = this.createDetailSection(container, '拆解维度');

        if (book.breakdownStatus === 'processing') {
            const activeTasks = this.deconstructionScheduler?.getActiveTasks() || [];
            const bookTask = activeTasks.find(t => t.bookId === book.id);
            const emitter = bookTask ? this.deconstructionScheduler?.getTaskEmitter(bookTask.id) : undefined;
            const emitterState = emitter?.getState();

            if (emitterState) {
                const progressHeader = dimSection.createDiv({
                    attr: { style: 'margin-bottom:12px;' }
                });

                const progressInfo = progressHeader.createDiv({
                    attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
                });
                progressInfo.createSpan({
                    text: `拆解进度：${Math.round(emitterState.progress)}%`,
                    attr: { style: 'font-size:13px;font-weight:500;color:var(--text-normal);' }
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        attr: { style: 'font-size:12px;color:#3b82f6;font-weight:500;' }
                    });
                }

                const progressBarWrap = progressHeader.createDiv({
                    attr: { style: 'height:8px;background:var(--background-secondary);border-radius:4px;overflow:hidden;margin-bottom:8px;' }
                });
                progressBarWrap.createDiv({
                    attr: { style: `height:100%;width:${emitterState.progress}%;background:var(--interactive-accent);transition:width 0.3s;` }
                });

                if (emitterState.message) {
                    progressHeader.createDiv({
                        text: emitterState.message,
                        attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' }
                    });
                }

                const timeInfo = progressHeader.createDiv({
                    attr: { style: 'display:flex;gap:20px;font-size:12px;color:var(--text-muted);' }
                });
                if (emitterState.elapsed !== undefined) {
                    timeInfo.createSpan({ text: `⏱️ 已用：${this.formatDuration(emitterState.elapsed)}` });
                }
                if (emitterState.eta !== undefined) {
                    timeInfo.createSpan({ text: `⏳ 剩余：${this.formatDuration(emitterState.eta)}` });
                }
            }
        }

        const dimGrid = dimSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;' }
        });
        const dimensions: { key: BreakdownDimension; label: string; data: unknown }[] = [
            { key: 'style', label: '风格分析', data: this.styleData },
            { key: 'rhythm', label: '节奏分析', data: this.rhythmData },
            { key: 'technique', label: '写作技巧', data: this.techniqueData },
            { key: 'structure', label: '结构拆解', data: this.structureData },
            { key: 'character', label: '人设提取', data: this.characterData },
            { key: 'foreshadow', label: '伏笔梳理', data: this.foreshadowData },
        ];

        const activeTasks = this.deconstructionScheduler?.getActiveTasks() || [];
        const bookTask = activeTasks.find(t => t.bookId === book.id);
        const emitter = bookTask ? this.deconstructionScheduler?.getTaskEmitter(bookTask.id) : undefined;
        const emitterState = emitter?.getState();
        const currentStepName = emitterState?.currentStep;

        dimensions.forEach(dim => {
            const isCurrentStep = currentStepName === DIMENSION_LABELS[dim.key as BreakdownDimension];
            const item = dimGrid.createDiv({
                attr: {
                    style: `padding:12px;border-radius:6px;text-align:center;${
                        dim.data
                            ? 'background:rgba(46,204,113,0.1);'
                            : isCurrentStep
                                ? 'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);'
                                : 'background:var(--background-secondary);'
                    }`
                }
            });
            item.createDiv({
                text: dim.data ? '✓' : isCurrentStep ? '⏳' : '○',
                attr: {
                    style: `font-size:20px;margin-bottom:4px;${
                        dim.data
                            ? 'color:#2ecc71;'
                            : isCurrentStep
                                ? 'color:#3b82f6;'
                                : 'color:var(--text-muted);'
                    }`
                }
            });
            item.createDiv({
                text: dim.label,
                attr: {
                    style: `font-size:12px;${
                        dim.data
                            ? 'color:var(--text-normal);'
                            : isCurrentStep
                                ? 'color:#3b82f6;font-weight:500;'
                                : 'color:var(--text-muted);'
                    }`
                }
            });
        });
    }

    private createDetailSection(container: HTMLElement, title: string): HTMLElement {
        const section = container.createDiv({ attr: { style: 'margin-bottom:24px;' } });
        section.createEl('h3', {
            text: title,
            attr: { style: 'margin:0 0 12px 0;font-size:15px;font-weight:600;' }
        });
        return section;
    }

    private addInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;' }
        });
        item.createDiv({ text: label, cls: 'nw-text-muted-11', attr: { style: 'margin-bottom:4px;' } });
        item.createDiv({ text: value, attr: { style: 'font-size:13px;color:var(--text-normal);font-weight:500;' } });
    }

    private renderGenreInfo(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            attr: { style: 'padding:16px;background:var(--background-secondary);border-radius:8px;' }
        });

        const headerRow = card.createDiv({
            cls: 'nw-flex-between', attr: { style: 'margin-bottom:12px;' }
        });
        headerRow.createSpan({
            text: '分类信息',
            attr: { style: 'font-size:13px;font-weight:600;color:var(--text-normal);' }
        });

        const actionBtns = headerRow.createDiv({ attr: { style: 'display:flex;gap:6px;' } });

        const autoClassifyBtn = actionBtns.createEl('button', {
            text: '🔍 自动分类',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        autoClassifyBtn.addEventListener('click', async () => {
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
        });

        const editBtn = actionBtns.createEl('button', {
            text: '✏️ 编辑',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        editBtn.addEventListener('click', () => this.openEditModal(book));

        const rows: { label: string; value: string; confidence?: number }[] = [
            { label: '频道', value: this.getChannelLabel(book.genreChannel || '未分类'), confidence: book.genreChannelConfidence },
            { label: '大类', value: this.getGenreName(book.primaryGenre), confidence: book.primaryGenreConfidence },
            { label: '细分', value: this.getSubGenreName(book.primaryGenre, book.primarySubGenre), confidence: book.primarySubGenreConfidence },
        ];

        rows.forEach(row => {
            const rowEl = card.createDiv({
                attr: { style: 'display:flex;align-items:center;margin-bottom:8px;last-child{margin-bottom:0;}' }
            });
            rowEl.createSpan({
                text: row.label + '：',
                cls: 'nw-flex-shrink-0', attr: { style: 'font-size:13px;color:var(--text-muted);width:60px;' }
            });
            const valueEl = rowEl.createSpan({
                text: row.value,
                attr: { style: 'font-size:13px;color:var(--text-normal);font-weight:500;flex:1;' }
            });
            if (row.confidence !== undefined) {
                valueEl.createSpan({
                    text: ` ${(row.confidence * 100).toFixed(0)}%`,
                    cls: 'nw-text-muted-11', attr: { style: 'font-weight:400;margin-left:4px;' }
                });
            }
        });

        if (book.genreRecommendations && book.genreRecommendations.length > 0) {
            const recSection = card.createDiv({ attr: { style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--background-modifier-border);' } });
            recSection.createDiv({
                text: '分类建议 (Top 3)',
                cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:8px;' }
            });

            book.genreRecommendations.forEach((rec, idx) => {
                const recRow = recSection.createDiv({
                    attr: { style: 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:4px;cursor:pointer;transition:background 0.15s;margin-bottom:4px;' }
                });
                recRow.addEventListener('mouseenter', () => {
                    recRow.style.background = 'var(--background-primary)';
                });
                recRow.addEventListener('mouseleave', () => {
                    recRow.style.background = 'transparent';
                });
                recRow.addEventListener('click', async () => {
                    if (!this.kbManager) return;
                    const confirmed = await OperationConfirmModal.confirm(this.app, {
                        title: '应用分类建议',
                        description: `确定要应用分类建议吗？`,
                        steps: [`大类：${this.getGenreName(rec.genreId)}`, `细分：${this.getSubGenreName(rec.genreId, rec.subGenreId)}`],
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
                });

                const left = recRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });
                left.createSpan({
                    text: `${idx + 1}.`,
                    cls: 'nw-text-sm-muted', attr: { style: 'width:16px;' }
                });
                left.createSpan({
                    text: `${this.getGenreName(rec.genreId)}${rec.subGenreId ? ' · ' + this.getSubGenreName(rec.genreId, rec.subGenreId) : ''}`,
                    attr: { style: 'font-size:12px;color:var(--text-normal);' }
                });

                const confBar = recRow.createDiv({
                    attr: { style: 'width:80px;height:6px;background:var(--background-primary);border-radius:3px;overflow:hidden;' }
                });
                confBar.createDiv({
                    attr: { style: `height:100%;width:${(rec.confidence * 100).toFixed(0)}%;background:var(--interactive-accent);border-radius:3px;` }
                });
            });
        }

        if (book.secondaryGenres && book.secondaryGenres.length > 0) {
            const row = card.createDiv({ attr: { style: 'display:flex;align-items:flex-start;margin-top:8px;' } });
            row.createSpan({
                text: '次要：',
                cls: 'nw-flex-shrink-0', attr: { style: 'font-size:13px;color:var(--text-muted);width:60px;' }
            });
            const tagsEl = row.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'flex:1;' } });
            book.secondaryGenres.forEach(gid => {
                const g = this.kb?.getGenre(gid);
                if (g) {
                    tagsEl.createSpan({
                        text: g.name,
                        attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);border-radius:10px;color:var(--text-muted);' }
                    });
                }
            });
        }
    }

    private getGenreName(genreId?: string): string {
        if (!genreId || !this.kb) return '未分类';
        const genre = this.kb.getGenre(genreId);
        return genre?.name || genreId;
    }

    private getSubGenreName(genreId?: string, subGenreId?: string): string {
        if (!genreId || !subGenreId || !this.kb) return '未分类';
        const sub = this.kb.getSubGenre(genreId, subGenreId);
        return sub?.name || subGenreId;
    }

    private renderQualityChart(container: HTMLElement, book: BookBasicInfo): void {
        if (!book.qualityScores) return;

        const qs = book.qualityScores;

        const wrap = container.createDiv({
            attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;' }
        });

        const radarCard = wrap.createDiv({
            attr: { style: 'flex:1;min-width:320px;display:flex;justify-content:center;' }
        });
        const radarData = [
            { label: '人设', value: qs.character },
            { label: '伏笔', value: qs.foreshadow },
            { label: '技巧', value: qs.technique },
            { label: '风格', value: qs.style },
            { label: '节奏', value: qs.rhythm },
            { label: '结构', value: qs.structure },
            { label: '商业', value: qs.commercial ?? 0 },
            { label: '可读', value: qs.readability ?? 0 },
        ];
        radarCard.innerHTML = radarChart(radarData, { size: 300, title: '质量雷达图 (8维)' });

        const scoresCard = wrap.createDiv({
            attr: { style: 'flex:1;min-width:200px;' }
        });

        const overall = scoresCard.createDiv({
            attr: { style: 'text-align:center;margin-bottom:20px;padding:16px;background:var(--background-secondary);border-radius:8px;' }
        });
        overall.createDiv({
            text: qs.overall.toFixed(0),
            attr: { style: 'font-size:36px;font-weight:700;color:var(--interactive-accent);' }
        });
        overall.createDiv({ text: '综合评分', attr: { style: 'font-size:13px;color:var(--text-muted);margin-top:4px;' } });

        const scores = [
            { name: '人设', value: qs.character },
            { name: '伏笔', value: qs.foreshadow },
            { name: '技巧', value: qs.technique },
            { name: '风格', value: qs.style },
            { name: '节奏', value: qs.rhythm },
            { name: '结构', value: qs.structure },
            { name: '商业', value: qs.commercial, optional: true },
            { name: '可读', value: qs.readability, optional: true },
        ];
        scores.forEach(s => {
            const item = scoresCard.createDiv({ attr: { style: 'margin-bottom:10px;' } });
            const top = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:4px;' } });
            top.createSpan({ text: s.name, attr: { style: 'font-size:12px;color:var(--text-normal);' } });
            if (s.optional && s.value == null) {
                top.createSpan({ text: 'N/A', attr: { style: 'font-size:12px;color:var(--text-faint);' } });
            } else {
                top.createSpan({ text: `${(s.value ?? 0).toFixed(0)}分`, cls: 'nw-text-sm-muted' });
            }
            const bar = item.createDiv({
                attr: { style: 'height:6px;background:var(--background-secondary);border-radius:3px;overflow:hidden;' }
            });
            const displayVal = s.optional && s.value == null ? 0 : (s.value ?? 0);
            bar.createDiv({
                attr: { style: `height:100%;width:${displayVal}%;background:var(--interactive-accent);border-radius:3px;` }
            });
        });
    }

    // ---- 人设 Tab ----
    private renderBookCharacterTab(container: HTMLElement): void {
        const data = this.characterData;

        if (!data || !data.characters || data.characters.length === 0) {
            this.renderDetailEmpty(container, '人设数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const sortedChars = [...data.characters].sort((a, b) =>
            (b.importance?.totalScore ?? 0) - (a.importance?.totalScore ?? 0)
        );

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.stats) {
            const section = this.createDetailSection(container, '角色统计');
            const statsGrid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
            });
            this.addInfoItem(statsGrid, '总角色数', String(data.stats.totalCharacters));
            this.addInfoItem(statsGrid, '主角数', String(data.stats.mainCharacterCount));
            this.addInfoItem(statsGrid, '人均出场', data.stats.avgAppearancePerCharacter.toFixed(1));
        }

        // 角色重要性排行
        if (sortedChars.length > 0) {
            const rankSection = this.createDetailSection(container, '角色重要度排行');
            const rankTable = rankSection.createDiv({
                attr: { style: 'overflow-x:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
            });
            const table = rankTable.createEl('table', {
                attr: { style: 'width:100%;border-collapse:collapse;font-size:12px;' }
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { attr: { style: 'background:var(--background-secondary);' } });
            ['排名', '姓名', '分级', '综合', '出场', '对话', '剧情', '关系', '视角'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    attr: { style: 'padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid var(--background-modifier-border);' }
                });
            });
            const tbody = table.createEl('tbody');
            sortedChars.slice(0, 10).forEach((char, idx) => {
                const row = tbody.createEl('tr', {
                    attr: { style: idx % 2 === 0 ? '' : 'background:var(--background-secondary-alt);' }
                });
                const imp = char.importance;
                const cells = [
                    idx + 1,
                    char.name,
                    this.getTierLabel(imp?.tier),
                    `${imp?.totalScore ?? 0}`,
                    `${imp?.appearanceFrequency ?? 0}%`,
                    `${imp?.dialogueRatio ?? 0}%`,
                    `${imp?.plotDrivingScore ?? 0}%`,
                    `${imp?.relationshipCentrality ?? 0}%`,
                    `${imp?.perspectiveRatio ?? 0}%`,
                ];
                cells.forEach((c, i) => {
                    row.createEl('td', {
                        text: String(c),
                        attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' + (i === 1 ? 'font-weight:500;' : '') }
                    });
                });
            });
        }

        // 主角重要性雷达图
        if (sortedChars.length > 0) {
            const topChar = sortedChars[0];
            if (topChar.importance) {
                const radarSection = this.createDetailSection(container, `主角重要性分析 - ${topChar.name}`);
                const radarData = [
                    { label: '出场频率', value: topChar.importance.appearanceFrequency },
                    { label: '对白占比', value: topChar.importance.dialogueRatio },
                    { label: '剧情驱动', value: topChar.importance.plotDrivingScore },
                    { label: '关系中心', value: topChar.importance.relationshipCentrality },
                    { label: '视角占比', value: topChar.importance.perspectiveRatio },
                ];
                const radarDiv = radarSection.createDiv({
                    attr: { style: 'display:flex;justify-content:center;' }
                });
                radarDiv.innerHTML = radarChart(radarData, { size: 320, title: '角色重要性维度' });
            }
        }

        // 角色卡片列表
        const mainSection = this.createDetailSection(container, '角色列表');
        const grid = mainSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;' }
        });

        sortedChars.forEach((char, idx) => {
            const key = `char_main_${idx}`;
            const isExpanded = this.expandedItems[key] ?? false;

            const card = grid.createDiv({
                attr: {
                    style: `border:1px solid var(--background-modifier-border);border-radius:8px;overflow:hidden;background:var(--background-primary);`
                }
            });

            const header = card.createDiv({
                attr: { style: 'padding:12px;cursor:pointer;display:flex;align-items:center;gap:10px;' }
            });

            const avatar = header.createDiv({
                text: char.name.charAt(0),
                cls: 'nw-flex-center nw-flex-shrink-0', attr: { style: 'width:40px;height:40px;border-radius:50%;background:var(--interactive-accent);color:var(--text-on-accent);font-size:16px;font-weight:600;' }
            });
            void avatar;

            const info = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            info.createDiv({ text: char.name, attr: { style: 'font-size:14px;font-weight:500;margin-bottom:2px;' } });
            const roleInfo = [char.role || '未知角色', char.gender || ''];
            if (char.importance?.tier) roleInfo.push(this.getTierLabel(char.importance.tier));
            info.createDiv({ text: roleInfo.filter(Boolean).join(' · '), cls: 'nw-text-sm-muted' });

            const toggle = header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-text-sm-muted nw-flex-shrink-0'
            });
            void toggle;

            header.addEventListener('click', () => {
                this.expandedItems[key] = !isExpanded;
                this.renderBookDetail();
            });

            // 标签显示（性格+能力）
            const tagsEl = card.createDiv({
                cls: 'nw-flex-wrap-sm', attr: { style: 'padding:0 12px 12px;' }
            });
            const allTags = [...(char.personality || []), ...(char.abilities || [])];
            allTags.slice(0, 4).forEach(tag => {
                tagsEl.createSpan({
                    text: tag,
                    attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-secondary);color:var(--text-muted);border-radius:10px;' }
                });
            });

            // 角色弧光进度条
            if (char.characterArc) {
                const arcBar = card.createDiv({
                    attr: { style: 'padding:0 12px 10px;display:flex;align-items:center;gap:8px;' }
                });
                arcBar.createSpan({
                    text: this.getArcTypeLabel(char.characterArc.transformationType),
                    cls: 'nw-flex-shrink-0', attr: { style: 'font-size:11px;padding:2px 6px;background:rgba(var(--interactive-accent-rgb),0.1);color:var(--interactive-accent);border-radius:4px;' }
                });
                const barBg = arcBar.createDiv({
                    attr: { style: 'flex:1;height:6px;background:var(--background-secondary);border-radius:3px;overflow:hidden;' }
                });
                barBg.createDiv({
                    attr: { style: `height:100%;width:${char.characterArc.completeness}%;background:var(--interactive-accent);border-radius:3px;` }
                });
                arcBar.createSpan({
                    text: `${char.characterArc.completeness}%`,
                    cls: 'nw-text-muted-11 nw-flex-shrink-0'
                });
            }

            if (isExpanded) {
                const body = card.createDiv({
                    attr: { style: 'padding:12px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);' }
                });

                // 基础统计
                const statsRow = body.createDiv({
                    attr: { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;' }
                });
                const quickStats = [
                    { label: '出场', value: char.appearanceCount ?? '-' },
                    { label: '提及', value: char.mentionCount ?? '-' },
                    { label: '首次', value: char.firstAppearance ? `${(char.firstAppearance * 100).toFixed(0)}%` : '-' },
                    { label: '末次', value: char.lastAppearance ? `${(char.lastAppearance * 100).toFixed(0)}%` : '-' },
                ];
                quickStats.forEach(s => {
                    const item = statsRow.createDiv({
                        attr: { style: 'text-align:center;padding:6px;background:var(--background-primary);border-radius:4px;' }
                    });
                    item.createDiv({ text: String(s.value), attr: { style: 'font-size:14px;font-weight:600;' } });
                    item.createDiv({ text: s.label, attr: { style: 'font-size:10px;color:var(--text-muted);' } });
                });

                // 性格特点
                if (char.personality && char.personality.length > 0) {
                    body.createDiv({ text: '🏷️ 性格特点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const tagsWrap = body.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'margin-bottom:12px;' } });
                    char.personality.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);color:var(--text-normal);border-radius:10px;' }
                        });
                    });
                }

                // 能力特点
                if (char.abilities && char.abilities.length > 0) {
                    body.createDiv({ text: '🛡️ 能力特点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const tagsWrap = body.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'margin-bottom:12px;' } });
                    char.abilities.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);color:var(--text-normal);border-radius:10px;' }
                        });
                    });
                }

                // 角色弧光详情
                if (char.characterArc) {
                    body.createDiv({ text: '⚡ 角色弧光', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const arcInfo = body.createDiv({
                        attr: { style: 'padding:8px;background:var(--background-primary);border-radius:4px;margin-bottom:12px;' }
                    });
                    arcInfo.createDiv({
                        text: `转变类型：${this.getArcTypeLabel(char.characterArc.transformationType)}`,
                        attr: { style: 'font-size:12px;margin-bottom:4px;' }
                    });
                    arcInfo.createDiv({
                        text: `弧光完整度：${char.characterArc.completeness}%`,
                        attr: { style: 'font-size:12px;margin-bottom:4px;' }
                    });
                    if (char.characterArc.initialState?.goals && char.characterArc.initialState.goals.length > 0) {
                        const goalText = char.characterArc.initialState.goals[0];
                        arcInfo.createDiv({
                            text: `初始目标：${goalText.length > 40 ? goalText.substring(0, 40) + '...' : goalText}`,
                            attr: { style: 'font-size:12px;' }
                        });
                    }

                    // 成长节点
                    if (char.characterArc.growthNodes && char.characterArc.growthNodes.length > 0) {
                        body.createDiv({ text: '📈 成长节点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                        const nodesList = body.createDiv({
                            attr: { style: 'margin-bottom:12px;max-height:150px;overflow-y:auto;' }
                        });
                        char.characterArc.growthNodes.slice(0, 5).forEach(node => {
                            const nodeItem = nodesList.createDiv({
                                attr: { style: 'padding:6px 8px;background:var(--background-primary);border-radius:4px;margin-bottom:4px;font-size:11px;' }
                            });
                            const topRow = nodeItem.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:2px;' } });
                            topRow.createSpan({
                                text: `[${node.changeType}]`,
                                attr: { style: 'color:var(--interactive-accent);font-weight:500;' }
                            });
                            topRow.createSpan({
                                text: `${(node.position * 100).toFixed(0)}%`,
                                attr: { style: 'color:var(--text-muted);' }
                            });
                            nodeItem.createDiv({
                                text: node.event.length > 50 ? node.event.substring(0, 50) + '...' : node.event,
                                attr: { style: 'color:var(--text-normal);line-height:1.4;' }
                            });
                        });
                    }
                }
            }
        });

        if (data.relationDetails && data.relationDetails.length > 0) {
            const relSection = this.createDetailSection(container, '关系深度分析');
            const relGrid = relSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;' }
            });
            data.relationDetails.slice(0, 8).forEach((rd, idx) => {
                const relKey = `rel_detail_${idx}`;
                const isExpanded = this.expandedItems[relKey] ?? false;
                const fromChar = data.allCharacters?.find(c => c.name === (data.mainCharacters?.find(m => m.name)?.name)) ||
                    { name: rd.fromId };
                const toChar = { name: rd.toId };
                const fromName = data.mainCharacters?.find(m => m.name === rd.fromId)?.name ||
                    data.allCharacters?.find(c => c.name === rd.fromId)?.name || rd.fromId;
                const toName = data.mainCharacters?.find(m => m.name === rd.toId)?.name ||
                    data.allCharacters?.find(c => c.name === rd.toId)?.name || rd.toId;

                const card = relGrid.createDiv({
                    attr: { style: 'border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;' }
                });
                const header = card.createDiv({
                    attr: { style: 'padding:10px;cursor:pointer;display:flex;align-items:center;gap:8px;background:var(--background-secondary);' }
                });
                header.createDiv({
                    text: `${fromName} ↔ ${toName}`,
                    cls: 'nw-ellipsis', attr: { style: 'flex:1;font-size:13px;font-weight:500;min-width:0;' }
                });
                const strengthBadge = header.createSpan({
                    text: `${rd.strength}%`,
                    cls: 'nw-flex-shrink-0', attr: { style: 'padding:2px 6px;font-size:10px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:4px;' }
                });
                void strengthBadge;
                header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-flex-shrink-0', attr: { style: 'font-size:10px;color:var(--text-muted);' }
                });
                header.addEventListener('click', () => {
                    this.expandedItems[relKey] = !isExpanded;
                    this.renderBookDetail();
                });

                card.createDiv({
                    text: rd.type,
                    cls: 'nw-text-muted-11', attr: { style: 'padding:4px 10px;background:var(--background-primary);' }
                });

                if (isExpanded) {
                    const body = card.createDiv({
                        attr: { style: 'padding:10px;border-top:1px solid var(--background-modifier-border);font-size:12px;' }
                    });
                    if (rd.history && rd.history.length > 0) {
                        body.createDiv({ text: '关系变化', attr: { style: 'font-weight:500;margin-bottom:6px;color:var(--text-muted);' } });
                        rd.history.forEach(h => {
                            body.createDiv({
                                text: `${(h.position * 100).toFixed(0)}%：${h.fromType} → ${h.toType}`,
                                attr: { style: 'padding:4px 0;border-bottom:1px dashed var(--background-modifier-border);' }
                            });
                        });
                    }
                    if (rd.keyEvents && rd.keyEvents.length > 0) {
                        body.createDiv({ text: '关键事件', attr: { style: 'font-weight:500;margin:8px 0 6px;color:var(--text-muted);' } });
                        rd.keyEvents.slice(0, 3).forEach(e => {
                            body.createDiv({
                                text: e.length > 50 ? e.substring(0, 50) + '...' : e,
                                attr: { style: 'padding:4px 0;font-size:11px;line-height:1.4;' }
                            });
                        });
                    }
                }
            });
        }

        if (data.relationships && data.relationships.length > 0) {
            const netSection = this.createDetailSection(container, `人物关系网络 (${data.relationships.length})`);
            const netTable = netSection.createDiv({
                attr: { style: 'max-height:250px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
            });
            const table = netTable.createEl('table', {
                attr: { style: 'width:100%;border-collapse:collapse;font-size:12px;' }
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { attr: { style: 'position:sticky;top:0;background:var(--background-secondary);z-index:1;' } });
            ['人物A', '人物B', '关系类型', '强度'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    attr: { style: 'padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid var(--background-modifier-border);' }
                });
            });
            const tbody = table.createEl('tbody');
            data.relationships.forEach((rel, idx) => {
                const row = tbody.createEl('tr', {
                    attr: { style: idx % 2 === 0 ? '' : 'background:var(--background-secondary-alt);' }
                });
                const fromName = data.mainCharacters?.find(m => m.name === rel.from)?.name ||
                    data.allCharacters?.find(c => c.name === rel.from)?.name || rel.from;
                const toName = data.mainCharacters?.find(m => m.name === rel.to)?.name ||
                    data.allCharacters?.find(c => c.name === rel.to)?.name || rel.to;
                row.createEl('td', { text: fromName, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                row.createEl('td', { text: toName, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                row.createEl('td', { text: rel.type, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                const strength = rel.weight ? Math.round(rel.weight * 100) : '-';
                row.createEl('td', { text: `${strength}${typeof strength === 'number' ? '%' : ''}`, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
            });
        }

        if (data.allCharacters && data.allCharacters.length > 0) {
            const allSection = this.createDetailSection(container, `全部角色 (${data.allCharacters.length})`);
            const list = allSection.createDiv({
                attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
            });
            data.allCharacters.forEach((char, idx) => {
                const item = list.createDiv({
                    attr: {
                        style: `padding:8px 12px;display:flex;align-items:center;gap:10px;${
                            idx < data.allCharacters!.length - 1 ? 'border-bottom:1px solid var(--background-modifier-border);' : ''
                        }`
                    }
                });
                item.createSpan({
                    text: char.name.charAt(0),
                    cls: 'nw-flex-center nw-flex-shrink-0', attr: { style: 'width:24px;height:24px;border-radius:50%;background:var(--background-secondary);font-size:11px;font-weight:500;' }
                });
                item.createSpan({ text: char.name, attr: { style: 'font-size:13px;font-weight:500;flex:1;' } });
                const roleParts = [char.role || ''];
                if (char.tier) roleParts.push(this.getTierLabel(char.tier));
                item.createSpan({ text: roleParts.filter(Boolean).join(' · '), cls: 'nw-text-sm-muted nw-flex-shrink-0' });
                if (char.tags && char.tags.length > 0) {
                    const tagsWrap = item.createDiv({ cls: 'nw-flex-shrink-0', attr: { style: 'display:flex;gap:4px;' } });
                    char.tags.slice(0, 2).forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:1px 6px;font-size:10px;background:var(--background-secondary);color:var(--text-muted);border-radius:8px;' }
                        });
                    });
                }
            });
        }

        if (data.relations && data.relations.length > 0) {
            const relKey = 'char_rel_network';
            const isExpanded = this.expandedItems[relKey] ?? false;
            const section = this.createDetailSection(container, '角色关系网络');
            const header = section.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;' }
            });
            header.createSpan({
                text: isExpanded ? '▼' : '▶',
                attr: { style: 'font-size:12px;color:var(--text-muted);' }
            });
            header.createSpan({
                text: `${data.relations.length} 条关系`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            header.addEventListener('click', () => {
                this.expandedItems[relKey] = !isExpanded;
                this.renderBookDetail();
            });

            if (isExpanded) {
                const list = section.createDiv({
                    attr: { style: 'display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto;' }
                });
                data.relations.slice(0, 15).forEach(rel => {
                    const relItem = list.createDiv({
                        attr: { style: 'padding:8px 12px;background:var(--background-secondary);border-radius:6px;font-size:12px;display:flex;align-items:center;gap:10px;' }
                    });
                    relItem.createSpan({
                        text: `${rel.fromId} → ${rel.toId}`,
                        attr: { style: 'font-weight:500;color:var(--text-normal);min-width:120px;' }
                    });
                    relItem.createSpan({
                        text: rel.type,
                        attr: { style: 'color:var(--interactive-accent);padding:2px 8px;background:rgba(var(--interactive-accent-rgb),0.1);border-radius:4px;' }
                    });
                    const weightPct = rel.weight != null ? `${(rel.weight * 100).toFixed(0)}%` : '-';
                    relItem.createSpan({
                        text: `权重: ${weightPct}`,
                        attr: { style: 'color:var(--text-muted);' }
                    });
                    const eventCount = rel.keyEvents?.length ?? 0;
                    relItem.createSpan({
                        text: `事件: ${eventCount}`,
                        attr: { style: 'color:var(--text-muted);margin-left:auto;' }
                    });
                });
            }
        }

        if (data.networkCentrality?.centrality && data.networkCentrality.centrality.length > 0) {
            const centralityList = [...data.networkCentrality.centrality]
                .sort((a, b) => b.pagerank - a.pagerank);
            const section = this.createDetailSection(container, '角色中心度排名 (PageRank)');
            const barData = centralityList.slice(0, 10).map(c => ({
                label: c.characterName,
                value: c.pagerank
            }));
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            chartDiv.innerHTML = barChart(barData, { width: 500, height: 220, horizontal: true, title: 'PageRank 中心度' });
        }
    }

    private getTierLabel(tier?: string): string {
        const labels: Record<string, string> = {
            protagonist: '主角',
            core_supporting: '核心配角',
            important_supporting: '重要配角',
            minor_supporting: '次要配角',
            extra: '路人角色'
        };
        return labels[tier || 'extra'] || tier || '';
    }

    private getArcTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            growth: '成长型',
            fall: '堕落型',
            awakening: '觉醒型',
            darkening: '黑化型',
            return: '回归型',
            stable: '稳定型'
        };
        return labels[type] || type;
    }

    private getTimelineIcon(type: string): string {
        const icons: Record<string, string> = {
            appearance: '👤',
            growth: '📈',
            relationship: '💞',
            plot: '📌',
            turning_point: '⚡'
        };
        return icons[type] || '•';
    }

    // ---- 伏笔 Tab ----
    private renderBookForeshadowTab(container: HTMLElement): void {
        const data = this.foreshadowData;

        if (!data || !data.foreshadows || data.foreshadows.length === 0) {
            this.renderDetailEmpty(container, '伏笔数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        const { foreshadows, typeDistribution, stats, qualityScore } = data;

        // 质量评分
        if (qualityScore) {
            const scoreSection = this.createDetailSection(container, '伏笔质量评分');
            const scoreGrid = scoreSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;' }
            });
            const scoreItems = [
                { label: '综合评分', value: `${qualityScore.totalScore}分`, color: 'var(--interactive-accent)' },
                { label: '类型多样性', value: `${qualityScore.diversityScore}%`, color: '#2ecc71' },
                { label: '回收率', value: `${qualityScore.resolutionRate}%`, color: '#f59e0b' },
                { label: '信噪比', value: `${qualityScore.signalNoiseRatio}%`, color: '#9b59b6' },
                { label: '覆盖度', value: `${qualityScore.coverageScore}%`, color: '#3b82f6' },
            ];
            scoreItems.forEach(item => {
                const card = scoreGrid.createDiv({
                    attr: { style: 'padding:12px;text-align:center;background:var(--background-secondary);border-radius:6px;' }
                });
                card.createDiv({
                    text: item.value,
                    attr: { style: `font-size:16px;font-weight:700;color:${item.color};margin-bottom:4px;` }
                });
                card.createDiv({ text: item.label, cls: 'nw-text-muted-11' });
            });
        }

        // 统计概览
        const statsSection = this.createDetailSection(container, '伏笔统计');
        
        if (stats) {
            const donutData = [
                { label: '已回收', value: stats.resolvedCount, color: '#2ecc71' },
                { label: '未回收', value: stats.unresolvedCount, color: '#f59e0b' },
            ];
            const donutDiv = statsSection.createDiv({
                attr: { style: 'display:flex;justify-content:center;margin-bottom:16px;' }
            });
            donutDiv.innerHTML = donutChart(donutData, { size: 280, title: '伏笔回收状态' });

            const statsGrid = statsSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;' }
            });
            const statItems = [
                { label: '总伏笔数', value: stats.totalForeshadows, color: 'var(--interactive-accent)' },
                { label: '已回收', value: stats.resolvedCount, color: '#2ecc71' },
                { label: '未回收', value: stats.unresolvedCount, color: '#f59e0b' },
                { label: '平均重要度', value: `${(stats.avgImportance * 100).toFixed(0)}%`, color: '#9b59b6' },
            ];
            statItems.forEach(item => {
                const card = statsGrid.createDiv({
                    attr: { style: 'padding:14px;text-align:center;background:var(--background-secondary);border-radius:8px;' }
                });
                card.createDiv({
                    text: String(item.value),
                    attr: { style: `font-size:20px;font-weight:700;color:${item.color};margin-bottom:4px;` }
                });
                card.createDiv({ text: item.label, cls: 'nw-text-sm-muted' });
            });
        }

        // 类型分布
        if (typeDistribution && Object.keys(typeDistribution).length > 0) {
            const typeSection = this.createDetailSection(container, '类型分布');
            const typeGrid = typeSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;' }
            });
            const typeLabels: Record<string, string> = {
                'item': '物品伏笔',
                'skill': '功法伏笔',
                'character': '人物伏笔',
                'setting': '设定伏笔',
                'event': '事件伏笔',
            };
            Object.entries(typeDistribution).forEach(([type, count]) => {
                typeGrid.createDiv({
                    attr: { style: 'padding:10px;text-align:center;background:var(--background-secondary);border-radius:6px;' }
                }).createDiv({
                    text: `${typeLabels[type] || type}：${count}`,
                    attr: { style: 'font-size:12px;' }
                });
            });
        }

        // 伏笔列表
        const listSection = this.createDetailSection(container, '伏笔列表');

        const filterRow = listSection.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;' }
        });
        const filterOptions: { value: string; label: string }[] = [
            { value: 'all', label: '全部' },
            { value: 'resolved', label: '已回收' },
            { value: 'unresolved', label: '未回收' },
        ];
        const currentFilter = this.foreshadowFilter || 'all';

        filterOptions.forEach(opt => {
            const btn = filterRow.createEl('button', {
                text: opt.label,
                cls: `nw-btn ${currentFilter === opt.value ? 'nw-btn-primary' : 'nw-btn-secondary'} nw-btn-sm`
            });
            btn.addEventListener('click', () => {
                this.foreshadowFilter = opt.value;
                this.renderBookDetail();
            });
        });

        const filteredItems = foreshadows.filter(item => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'resolved') return item.hasResolution;
            return !item.hasResolution;
        });

        const list = listSection.createDiv({
            attr: { style: 'max-height:400px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:8px;' }
        });

        filteredItems.forEach((item, idx) => {
            const key = `fs_${idx}`;
            const isExpanded = this.expandedItems[key] ?? false;

            const itemEl = list.createDiv({
                attr: {
                    style: `border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}`
                }
            });

            const header = itemEl.createDiv({
                attr: { style: 'padding:12px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;' }
            });

            const statusIcon = header.createSpan({
                text: item.hasResolution ? '✓' : '○',
                cls: 'nw-flex-center nw-flex-shrink-0',
                attr: {
                    style: `width:20px;height:20px;border-radius:50%;font-size:12px;margin-top:1px;${
                        item.hasResolution ? 'background:rgba(46,204,113,0.15);color:#2ecc71;' : 'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });
            void statusIcon;

            const content = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            content.createDiv({ text: item.name, attr: { style: 'font-size:13px;font-weight:500;margin-bottom:4px;' } });
            const meta = content.createDiv({ attr: { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' } });
            
            const typeLabels: Record<string, string> = {
                'item': '物品伏笔',
                'skill': '功法伏笔',
                'character': '人物伏笔',
                'setting': '设定伏笔',
                'event': '事件伏笔',
            };
            meta.createSpan({
                text: typeLabels[item.type] || item.type,
                attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-secondary);border-radius:10px;color:var(--text-muted);' }
            });

            const importancePct = (item.importance * 100).toFixed(0);
            meta.createSpan({
                text: `重要度 ${importancePct}%`,
                attr: {
                    style: `padding:2px 8px;font-size:11px;border-radius:10px;${
                        item.importance >= 0.7 ? 'background:rgba(231,76,60,0.1);color:#e74c3c;' :
                        item.importance >= 0.4 ? 'background:rgba(245,158,11,0.1);color:#f59e0b;' :
                        'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });

            meta.createSpan({
                text: `出场 ${item.totalAppearances}次`,
                cls: 'nw-text-muted-11'
            });

            const toggle = header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-text-sm-muted nw-flex-shrink-0', attr: { style: 'margin-top:2px;' }
            });
            void toggle;

            header.addEventListener('click', () => {
                this.expandedItems[key] = !isExpanded;
                this.renderBookDetail();
            });
        });
    }

    // ---- 商业 Tab ----
    private renderBookCommercialTab(container: HTMLElement): void {
        const data = this.commercialData;
        if (!data || (!data.overallScore && !data.goldenThreeChapters && !data.waveRhythm)) {
            this.renderDetailEmpty(container, '商业分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.overallScore !== undefined || data.overallLevel) {
            const section = this.createDetailSection(container, '商业可行性总览');
            const card = section.createDiv({
                attr: { style: 'padding:20px;background:var(--background-secondary);border-radius:10px;display:flex;align-items:center;gap:24px;' }
            });
            const scoreCircle = card.createDiv({
                attr: { style: 'width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,var(--interactive-accent),#7c3aed);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;flex-shrink:0;' }
            });
            scoreCircle.createDiv({ text: data.overallScore !== undefined ? data.overallScore.toString() : '-', attr: { style: 'font-size:28px;font-weight:700;line-height:1;' } });
            scoreCircle.createDiv({ text: '总分', attr: { style: 'font-size:11px;opacity:0.9;' } });
            const infoDiv = card.createDiv({ attr: { style: 'flex:1;' } });
            infoDiv.createDiv({
                text: `等级：${data.overallLevel || '-'}`,
                attr: { style: 'font-size:18px;font-weight:600;margin-bottom:8px;color:var(--interactive-accent);' }
            });
            infoDiv.createDiv({
                text: '综合评估作品的市场竞争力和读者吸引力',
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
        }

        if (data.goldenThreeChapters) {
            const gtc = data.goldenThreeChapters;
            const section = this.createDetailSection(container, '黄金三章分析');

            if (gtc.totalScore !== undefined || gtc.subScores) {
                const scoreRow = section.createDiv({
                    attr: { style: 'display:flex;align-items:center;gap:20px;margin-bottom:16px;padding:14px;background:var(--background-secondary);border-radius:8px;' }
                });
                if (gtc.totalScore !== undefined) {
                    scoreRow.createDiv({
                        text: `黄金三章总分：${gtc.totalScore} 分`,
                        attr: { style: 'font-size:15px;font-weight:600;color:var(--interactive-accent);' }
                    });
                }
                if (gtc.subScores) {
                    const subLabels: Record<string, string> = {
                        openingConflict: '开篇冲突',
                        infoDensity: '信息密度',
                        protagonistGoal: '主角目标',
                        goldenFinger: '金手指',
                        chapterHooks: '章节钩子'
                    };
                    const barData = Object.entries(gtc.subScores)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => ({
                            label: subLabels[k] || k,
                            value: (v as number) * 100
                        }));
                    if (barData.length > 0) {
                        const barDiv = section.createDiv({
                            attr: { style: 'display:flex;justify-content:center;' }
                        });
                        barDiv.innerHTML = barChart(barData, { width: 480, height: 180, title: '五维评分', horizontal: true });
                    }
                }
            }

            if (gtc.improvementSuggestions && gtc.improvementSuggestions.length > 0) {
                const suggSection = this.createDetailSection(container, '改进建议');
                const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sortedSuggestions = [...gtc.improvementSuggestions].sort((a, b) =>
                    (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
                );
                const list = suggSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                const severityColors: Record<string, string> = {
                    high: 'var(--color-red)',
                    medium: 'var(--color-orange)',
                    low: 'var(--color-green)'
                };
                const severityLabels: Record<string, string> = {
                    high: '高',
                    medium: '中',
                    low: '低'
                };
                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' } });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.category, attr: { style: 'font-size:12px;font-weight:500;' } });
                    item.createDiv({ text: s.suggestion, attr: { style: 'font-size:13px;color:var(--text-muted);' } });
                });
            }
        }

        if (data.waveRhythm) {
            const wr = data.waveRhythm;
            const section = this.createDetailSection(container, '波浪节奏验证');

            if (wr.complianceRate !== undefined) {
                const progressWrap = section.createDiv({
                    attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;margin-bottom:12px;' }
                });
                progressWrap.createDiv({
                    text: `节奏合规率：${(wr.complianceRate * 100).toFixed(1)}%`,
                    attr: { style: 'font-size:14px;font-weight:600;margin-bottom:8px;' }
                });
                const barBg = progressWrap.createDiv({
                    attr: { style: 'height:10px;background:var(--background-modifier-border);border-radius:5px;overflow:hidden;' }
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${Math.min(100, Math.max(0, wr.complianceRate * 100))}%;background:linear-gradient(90deg,var(--interactive-accent),#7c3aed);border-radius:5px;transition:width 0.3s;`
                    }
                });
            }

            if (wr.violations && wr.violations.length > 0) {
                const typeLabels: Record<string, string> = {
                    small_cool: '小爽点',
                    medium_reversal: '中反转',
                    big_climax: '大高潮'
                };
                const vSection = this.createDetailSection(container, `违规记录 (${wr.violations.length})`);
                const list = vSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
                wr.violations.forEach((v, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;font-size:12px;' }
                    });
                    item.createEl('div', {
                        text: `#${i + 1} ${typeLabels[v.type] || v.type} · 第${v.startChapter}-${v.endChapter}章`,
                        attr: { style: 'font-weight:500;color:var(--color-orange);margin-bottom:4px;' }
                    });
                    item.createEl('div', {
                        text: `间隔：${v.gap} 章（阈值：${v.threshold} 章）`,
                        attr: { style: 'color:var(--text-muted);' }
                    });
                });
            }
        }
    }

    // ---- 可读性 Tab ----
    private renderBookReadabilityTab(container: HTMLElement): void {
        const data = this.readabilityData;
        if (!data || (!data.overallScore && !data.showTell && !data.aiTrace)) {
            this.renderDetailEmpty(container, '可读性分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.formatWordCount(book.wordCount)} 字`,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.overallScore !== undefined) {
            const section = this.createDetailSection(container, '可读性总览');
            const card = section.createDiv({
                attr: { style: 'padding:20px;background:var(--background-secondary);border-radius:10px;display:flex;align-items:center;gap:24px;' }
            });
            const scoreCircle = card.createDiv({
                attr: { style: 'width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#10b981,#3b82f6);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;flex-shrink:0;' }
            });
            scoreCircle.createDiv({ text: data.overallScore.toString(), attr: { style: 'font-size:28px;font-weight:700;line-height:1;' } });
            scoreCircle.createDiv({ text: '总分', attr: { style: 'font-size:11px;opacity:0.9;' } });
            const infoDiv = card.createDiv({ attr: { style: 'flex:1;' } });
            infoDiv.createDiv({
                text: '可读性综合评分',
                attr: { style: 'font-size:18px;font-weight:600;margin-bottom:8px;color:var(--interactive-accent);' }
            });
            infoDiv.createDiv({
                text: '评估作品的阅读流畅度、代入感和AI痕迹水平',
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
        }

        if (data.showTell) {
            const st = data.showTell;
            const section = this.createDetailSection(container, 'Show vs Tell 分析');

            const hasDonutData = st.showPercentage !== undefined || st.tellPercentage !== undefined || (st.stats && st.stats.mixedCount !== undefined);
            if (hasDonutData) {
                const chartWrap = section.createDiv({
                    attr: { style: 'display:flex;justify-content:center;gap:24px;align-items:flex-start;flex-wrap:wrap;' }
                });
                const donutData = [];
                if (st.showPercentage !== undefined) {
                    donutData.push({ label: 'Show', value: st.showPercentage * 100, color: '#10b981' });
                }
                if (st.tellPercentage !== undefined) {
                    donutData.push({ label: 'Tell', value: st.tellPercentage * 100, color: '#ef4444' });
                }
                if (st.stats?.mixedCount !== undefined && st.stats?.totalSegments !== undefined && st.stats.totalSegments > 0) {
                    const mixedPct = (st.stats.mixedCount / st.stats.totalSegments) * 100;
                    donutData.push({ label: 'Mixed', value: mixedPct, color: '#f59e0b' });
                }
                if (donutData.length > 0) {
                    const donutDiv = chartWrap.createDiv();
                    donutDiv.innerHTML = donutChart(donutData, { size: 260, title: 'Show/Tell 比例' });
                }

                if (st.stats) {
                    const statsDiv = chartWrap.createDiv({
                        attr: { style: 'display:flex;flex-direction:column;gap:10px;min-width:180px;' }
                    });
                    statsDiv.createDiv({ text: '统计数据', attr: { style: 'font-size:14px;font-weight:600;margin-bottom:4px;' } });
                    if (st.stats.totalSegments !== undefined) {
                        this.addInfoItem(statsDiv, '总片段数', st.stats.totalSegments.toString());
                    }
                    if (st.stats.showCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Show 数量', st.stats.showCount.toString());
                    }
                    if (st.stats.tellCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Tell 数量', st.stats.tellCount.toString());
                    }
                    if (st.stats.mixedCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Mixed 数量', st.stats.mixedCount.toString());
                    }
                }
            }

            if (st.highRiskTellSegments && st.highRiskTellSegments.length > 0) {
                const riskSection = this.createDetailSection(container, `高风险 Tell 段落 (${st.highRiskTellSegments.length})`);
                const list = riskSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                st.highRiskTellSegments.slice(0, 10).forEach((seg, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' } });
                    header.createSpan({ text: `#${i + 1}`, attr: { style: 'font-size:12px;font-weight:600;color:var(--color-red);' } });
                    if (seg.confidence !== undefined) {
                        header.createSpan({ text: `置信度：${(seg.confidence * 100).toFixed(0)}%`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                    }
                    item.createDiv({
                        text: seg.excerpt,
                        attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' }
                    });
                });
            }

            if (st.suggestions && st.suggestions.length > 0) {
                const suggSection = this.createDetailSection(container, '改进建议');
                const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sortedSuggestions = [...st.suggestions].sort((a, b) =>
                    (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
                );
                const list = suggSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                const severityColors: Record<string, string> = {
                    high: 'var(--color-red)',
                    medium: 'var(--color-orange)',
                    low: 'var(--color-green)'
                };
                const severityLabels: Record<string, string> = {
                    high: '高',
                    medium: '中',
                    low: '低'
                };
                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' } });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.type, attr: { style: 'font-size:12px;font-weight:500;' } });
                    item.createDiv({ text: s.message, attr: { style: 'font-size:13px;color:var(--text-muted);' } });
                });
            }
        }

        if (data.aiTrace) {
            const ai = data.aiTrace;
            const section = this.createDetailSection(container, 'AI 痕迹检测');

            const overviewRow = section.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:20px;margin-bottom:16px;padding:14px;background:var(--background-secondary);border-radius:8px;' }
            });
            if (ai.overallScore !== undefined) {
                overviewRow.createDiv({
                    text: `AI 痕迹率：${(ai.overallScore * 100).toFixed(1)}%`,
                    attr: { style: 'font-size:15px;font-weight:600;color:var(--color-orange);' }
                });
            }
            if (ai.level) {
                const levelColors: Record<string, string> = {
                    low: 'var(--color-green)',
                    medium: 'var(--color-orange)',
                    high: 'var(--color-red)'
                };
                const levelLabels: Record<string, string> = {
                    low: '低风险',
                    medium: '中风险',
                    high: '高风险'
                };
                overviewRow.createSpan({
                    text: levelLabels[ai.level] || ai.level,
                    attr: {
                        style: `padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;color:white;background:${levelColors[ai.level] || 'var(--text-muted)'};`
                    }
                });
            }

            if (ai.dimensions) {
                const dimLabels: Record<string, string> = {
                    sentenceSimilarity: '句式相似度',
                    connectorDensity: '连接词密度',
                    explanatoryEnding: '说明性结尾',
                    parallelismAbuse: '排比滥用',
                    wordRepetition: '词汇重复',
                    emotionUniformity: '情绪均匀度'
                };
                const barData = Object.entries(ai.dimensions)
                    .filter(([, v]) => v && v.score !== undefined)
                    .map(([k, v]) => ({
                        label: dimLabels[k] || k,
                        value: v.score * 100
                    }));
                if (barData.length > 0) {
                    const barDiv = section.createDiv({
                        attr: { style: 'display:flex;justify-content:center;' }
                    });
                    barDiv.innerHTML = barChart(barData, { width: 500, height: 200, title: '六维分析', horizontal: true });
                }
            }

            if (ai.highRiskParagraphs && ai.highRiskParagraphs.length > 0) {
                const riskSection = this.createDetailSection(container, `高风险段落 (${ai.highRiskParagraphs.length})`);
                const list = riskSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                ai.highRiskParagraphs.slice(0, 10).forEach((p, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' } });
                    header.createSpan({ text: `#${i + 1}`, attr: { style: 'font-size:12px;font-weight:600;color:var(--color-red);' } });
                    if (p.score !== undefined) {
                        header.createSpan({ text: `风险分：${(p.score * 100).toFixed(0)}%`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                    }
                    item.createDiv({
                        text: p.excerpt,
                        attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px;' }
                    });
                    if (p.reasons && p.reasons.length > 0) {
                        const reasonsDiv = item.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:4px;' } });
                        p.reasons.forEach(r => {
                            reasonsDiv.createSpan({
                                text: r,
                                attr: { style: 'padding:2px 6px;background:var(--color-red);opacity:0.2;border-radius:3px;font-size:10px;color:var(--color-red);' }
                            });
                        });
                    }
                });
            }
        }
    }

    // ---- 技巧 Tab ----
    private renderBookTechniqueTab(container: HTMLElement): void {
        const data = this.techniqueData;

        if (!data || !data.techniques || data.techniques.length === 0) {
            this.renderDetailEmpty(container, '写作技巧数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const { techniques, typeDistribution, qualityScore } = data;

        // 技巧分类环形图（使用 typeDistribution 或从 techniques 计算）
        const categoryCounts: Record<string, number> = typeDistribution || {};
        if (!typeDistribution) {
            techniques.forEach(tech => {
                categoryCounts[tech.category] = (categoryCounts[tech.category] || 0) + tech.count;
            });
        }

        const categoryLabels: Record<string, string> = {
            'emotion': '情感',
            'structure': '结构',
            'cool_point': '爽点',
            'character': '人物',
            'setting': '设定',
            'dialogue': '对话',
            'description': '描写',
        };

        if (Object.keys(categoryCounts).length > 0) {
            const section = this.createDetailSection(container, '技巧分类分布');
            const donutData = Object.entries(categoryCounts).map(([label, value]) => ({
                label: categoryLabels[label] || label,
                value
            }));
            const donutDiv = section.createDiv({
                attr: { style: 'display:flex;justify-content:center;' }
            });
            donutDiv.innerHTML = donutChart(donutData, { size: 300, title: '技巧分类占比' });
        }

        // Top技巧排名柱状图（按 count 排序）
        const sortedTechniques = [...techniques].sort((a, b) => b.count - a.count);
        const top10 = sortedTechniques.slice(0, 10);
        
        const chartSection = this.createDetailSection(container, 'Top 10 写作技巧排名');
        const barData = top10.map(t => ({ label: t.name, value: t.count }));
        const barDiv = chartSection.createDiv({
            attr: { style: 'display:flex;justify-content:center;' }
        });
        barDiv.innerHTML = barChart(barData, { width: 500, height: 250, title: '技巧使用频率', horizontal: true });

        // 质量评分卡片
        if (qualityScore) {
            const section = this.createDetailSection(container, '技巧质量评分');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
            });
            this.addInfoItem(grid, '综合评分', `${qualityScore.totalScore} / 100`);
            this.addInfoItem(grid, '多样性', `${qualityScore.diversityScore}%`);
            this.addInfoItem(grid, '覆盖度', `${qualityScore.coverageScore}%`);
        }

            const section = this.createDetailSection(container, '技巧详情');
            top10.forEach((tech, i) => {
                const key = `tech_top_${i}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const item = section.createDiv({
                    attr: {
                        style: `border:1px solid var(--background-modifier-border);border-radius:8px;margin-bottom:8px;overflow:hidden;`
                    }
                });

                const header = item.createDiv({
                    attr: { style: 'padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;' }
                });

                const rank = header.createSpan({
                    text: `${i + 1}`,
                    cls: 'nw-flex-center nw-flex-shrink-0',
                    attr: {
                        style: `width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:600;${
                            i < 3 ? 'background:var(--interactive-accent);color:var(--text-on-accent);' : 'background:var(--background-secondary);color:var(--text-muted);'
                        }`
                    }
                });
                void rank;

                const info = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
                info.createDiv({ text: tech.name, attr: { style: 'font-size:13px;font-weight:500;' } });
                const meta = info.createDiv({ cls: 'nw-text-muted-11', attr: { style: 'display:flex;gap:12px;margin-top:2px;flex-wrap:wrap;' } });
                meta.createSpan({ text: `出现 ${tech.count} 次` });
                meta.createSpan({ text: `分类: ${categoryLabels[tech.category] || tech.category}` });
                meta.createSpan({ text: `置信度 ${(tech.confidence * 100).toFixed(0)}%` });
                meta.createSpan({ text: `质量分 ${(tech.qualityScore * 100).toFixed(0)}%` });

                const toggle = header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-text-sm-muted nw-flex-shrink-0'
                });
                void toggle;

                header.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.renderBookDetail();
                });

                if (isExpanded) {
                    const body = item.createDiv({
                        attr: { style: 'padding:12px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);' }
                    });
                    body.createDiv({ text: `技巧ID: ${tech.id}`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' } });
                    body.createDiv({ text: `题材权重: ${tech.genreWeight.toFixed(1)}x`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                }
            });
    }

    // ---- 标签 Tab ----
    private renderBookTagsTab(container: HTMLElement, book: BookBasicInfo): void {
        const themeSection = this.createDetailSection(container, '主题标签');
        const themeWrap = themeSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;' } });
        if (book.themeTags.length === 0) {
            themeWrap.createSpan({ text: '暂无主题标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.themeTags.forEach(tag => {
                themeWrap.createSpan({
                    text: tag,
                    attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
            });
        }

        const techniqueSection = this.createDetailSection(container, '技巧标签');
        const techWrap = techniqueSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;' } });
        if (book.techniqueTags.length === 0) {
            techWrap.createSpan({ text: '暂无技巧标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.techniqueTags.forEach(tag => {
                techWrap.createSpan({
                    text: tag,
                    attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
            });
        }

        const customSection = this.createDetailSection(container, '自定义标签');
        const customTagsWrap = customSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;' } });

        if (book.customTags.length === 0) {
            customTagsWrap.createSpan({ text: '暂无自定义标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.customTags.forEach((tag, idx) => {
                const tagEl = customTagsWrap.createSpan({
                    cls: 'nw-flex-row-sm', attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
                tagEl.createSpan({ text: tag });
                const delBtn = tagEl.createSpan({
                    text: '×',
                    attr: { style: 'cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;' }
                });
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDeleteCustomTag(book, idx).catch(err => {
                        log.error('删除标签失败:', err);
                    });
                });
            });
        }

        const addWrap = customSection.createDiv({ attr: { style: 'display:flex;gap:8px;' } });
        const addInput = addWrap.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '输入新标签，按回车添加',
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
            }
        });
        const addBtn = addWrap.createEl('button', {
            text: '添加',
            cls: 'nw-btn nw-btn-primary nw-btn-sm'
        });

        const addHandler = async () => {
            const tag = addInput.value.trim();
            if (!tag) return;
            await this.handleAddCustomTag(book, tag);
            addInput.value = '';
        };
        addBtn.addEventListener('click', addHandler);
        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addHandler();
        });
    }

    private renderDetailEmpty(container: HTMLElement, label: string): void {
        const empty = container.createDiv({
            attr: { style: 'text-align:center;padding:60px 20px;color:var(--text-muted);' }
        });
        empty.createDiv({ text: '📭', attr: { style: 'font-size:48px;margin-bottom:16px;' } });
        empty.createDiv({ text: `暂无${label}`, attr: { style: 'font-size:16px;margin-bottom:8px;color:var(--text-normal);' } });
        empty.createDiv({ text: '完成书籍拆解后即可查看详细数据', attr: { style: 'font-size:13px;' } });
    }

    private renderQualityScoreCard(container: HTMLElement, data: Record<string, unknown> | null): void {
        if (!data) return;
        const qs = data._qualityScore as DimensionQualityScore | undefined;
        if (!qs || typeof qs.overall !== 'number') return;

        const levelColor = qs.level === 'high' ? 'var(--color-green)' : qs.level === 'medium' ? 'var(--color-orange)' : 'var(--color-red)';
        const levelLabel = qs.level === 'high' ? '优秀' : qs.level === 'medium' ? '一般' : '较差';
        const usedLevelLabel = qs.usedLevel === 'fast' ? '快速' : qs.usedLevel === 'standard' ? '标准' : '深度';

        const card = container.createDiv({
            attr: { style: 'margin-bottom:16px;padding:12px 16px;background:var(--background-secondary);border-radius:8px;border-left:4px solid var(--interactive-accent);' }
        });

        const header = card.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:12px;margin-bottom:10px;' }
        });
        header.createSpan({ text: '质量评分', attr: { style: 'font-size:13px;font-weight:600;color:var(--text-normal);' } });
        header.createSpan({
            text: `${qs.overall}/100`,
            attr: { style: `font-size:20px;font-weight:700;color:${levelColor};` }
        });
        header.createSpan({
            text: levelLabel,
            attr: { style: `font-size:11px;padding:2px 8px;border-radius:4px;background:${levelColor}22;color:${levelColor};font-weight:600;` }
        });
        header.createSpan({
            text: `档位: ${usedLevelLabel}`,
            attr: { style: 'font-size:10px;color:var(--text-muted);margin-left:auto;' }
        });

        const metrics = card.createDiv({
            attr: { style: 'display:flex;gap:16px;flex-wrap:wrap;' }
        });
        const metricStyle = 'display:flex;flex-direction:column;align-items:center;min-width:60px;';
        const valueStyle = 'font-size:16px;font-weight:600;';
        const labelStyle = 'font-size:10px;color:var(--text-muted);margin-top:2px;';

        const completenessColor = qs.completeness >= 80 ? 'var(--color-green)' : qs.completeness >= 50 ? 'var(--color-orange)' : 'var(--color-red)';
        const consistencyColor = qs.consistency >= 80 ? 'var(--color-green)' : qs.consistency >= 50 ? 'var(--color-orange)' : 'var(--color-red)';
        const confidenceColor = qs.confidence >= 80 ? 'var(--color-green)' : qs.confidence >= 50 ? 'var(--color-orange)' : 'var(--color-red)';

        const m1 = metrics.createDiv({ attr: { style: metricStyle } });
        m1.createSpan({ text: `${qs.completeness}`, attr: { style: `${valueStyle}color:${completenessColor};` } });
        m1.createSpan({ text: '完整性', attr: { style: labelStyle } });

        const m2 = metrics.createDiv({ attr: { style: metricStyle } });
        m2.createSpan({ text: `${qs.consistency}`, attr: { style: `${valueStyle}color:${consistencyColor};` } });
        m2.createSpan({ text: '一致性', attr: { style: labelStyle } });

        const m3 = metrics.createDiv({ attr: { style: metricStyle } });
        m3.createSpan({ text: `${qs.confidence}`, attr: { style: `${valueStyle}color:${confidenceColor};` } });
        m3.createSpan({ text: '置信度', attr: { style: labelStyle } });
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
        exportBtn.addEventListener('click', () => this.handleExportConfig());
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

    private handleExportConfig(): void {
        if (!this.configManager) return;
        const customGenres = this.configManager.getFullCustomGenres();
        if (customGenres.length === 0) {
            new Notice('暂无可导出的自定义题材');
            return;
        }
        const data = JSON.stringify(customGenres, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = createEl('a', {
            attr: { href: url, download: 'custom-genres.json' }
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        new Notice(`📤 已导出 ${customGenres.length} 个自定义题材`);
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
            const empty = content.createDiv({
                attr: { style: 'text-align:center;padding:80px 20px;color:var(--text-muted);' }
            });
            empty.createDiv({ text: '📋', attr: { style: 'font-size:48px;margin-bottom:16px;' } });
            empty.createDiv({ text: '暂无任务', attr: { style: 'font-size:16px;margin-bottom:8px;color:var(--text-normal);' } });
            empty.createDiv({ text: '在参考书籍中选择书籍开始拆解', attr: { style: 'font-size:13px;' } });
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
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
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
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
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
            cls: 'nw-btn nw-btn-danger nw-btn-sm'
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
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
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
            cls: 'nw-btn nw-btn-danger nw-btn-sm'
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
                    cls: 'nw-btn nw-btn-primary nw-btn-sm'
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
                    cls: 'nw-btn nw-btn-danger nw-btn-sm'
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
                    cls: 'nw-btn nw-btn-secondary nw-btn-sm'
                });
                deleteBtn.addEventListener('click', () => {
                    this.handleDeleteTask(task).catch(err => {
                        log.error('删除任务失败:', err);
                    });
                });
            }

            const viewBtn = actions.createEl('button', {
                text: '📖 查看书籍',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm'
            });
            viewBtn.addEventListener('click', () => {
                const book = this.allBooks.find(b => b.id === task.bookId);
                if (book) {
                    this.activeMainTab = 'books';
                    this.renderLeftSidebar();
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
            radarCard.innerHTML = radarChart(radarData, { size: 280, title: '平均质量雷达图' });

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
            chartCard.innerHTML = barChart(genreData, { width: 500, height: 300, title: 'Top 10 题材分布' });
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
            donutCard.innerHTML = donutChart(donutData, { size: 220, title: '状态分布' });
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
                attr: { 'data-action': 'start-deconstruction' }
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
                attr: { 'data-action': 'restart-deconstruction' }
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
                attr: { 'data-action': 'restart-deconstruction' }
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
                attr: { style: 'margin-left: 8px; font-size: 12px; color: #e74c3c;' }
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
                cls: 'nw-btn nw-btn-warning nw-btn-sm'
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
                cls: 'nw-btn nw-btn-secondary nw-btn-sm'
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
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
        });
        editBtn.addEventListener('click', () => this.openEditModal(book));
        const deleteBtn = actionsEl.createEl('button', {
            text: '🗑️ 删除',
            cls: 'nw-btn nw-btn-danger nw-btn-sm'
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

            const dimensions = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'] as BreakdownDimension[];
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

// ============== Modals ==============

class ImportBookModal extends Modal {
    private kbManager: KnowledgeBaseManager | null;
    private onImported: (book: any) => void;
    private nameValue: string = '';
    private authorValue: string = '';
    private sourcePath: string = '';
    private step: 'select' | 'form' = 'select';

    constructor(app: App, kbManager: KnowledgeBaseManager | null, onImported: (book: any) => void) {
        super(app);
        this.kbManager = kbManager;
        this.onImported = onImported;
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '📥 导入参考书籍', cls: 'nw-modal-title' });

        if (this.step === 'select') {
            this.renderSelectStep();
        } else {
            this.renderFormStep();
        }
    }

    private render(): void {
        this.onOpen();
    }

    private renderSelectStep(): void {
        const { contentEl } = this;

        const options = [
            { icon: '📂', label: '从 Vault 选择文件', desc: '选择 vault 中的 .txt 或 .md 文件', action: () => this.selectFromVault() },
            { icon: '📄', label: '从本地文件导入', desc: '从本地文件系统选择文件', action: () => this.importFromFile() },
            { icon: '✏️', label: '手动输入信息', desc: '手动填写书籍信息', action: () => { this.step = 'form'; this.render(); } },
        ];

        options.forEach(opt => {
            const card = contentEl.createDiv({
                attr: {
                    style: 'padding:16px;border:1px solid var(--background-modifier-border);border-radius:8px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all 0.15s;'
                }
            });
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = 'var(--interactive-accent)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = 'var(--background-modifier-border)';
            });

            card.createSpan({ text: opt.icon, attr: { style: 'font-size:28px;' } });
            const info = card.createDiv({ attr: { style: 'flex:1;' } });
            info.createDiv({ text: opt.label, attr: { style: 'font-size:14px;font-weight:500;margin-bottom:4px;' } });
            info.createDiv({ text: opt.desc, cls: 'nw-text-sm-muted' });
            card.createSpan({ text: '→', attr: { style: 'color:var(--text-muted);font-size:16px;' } });

            card.addEventListener('click', opt.action);
        });
    }

    private async selectFromVault(): Promise<void> {
        try {
            const files = this.app.vault.getFiles().filter(f =>
                f.extension === 'txt' || f.extension === 'md'
            );

            if (files.length === 0) {
                new Notice('Vault 中没有找到 .txt 或 .md 文件');
                return;
            }

            const modal = new (class extends Modal {
                private files: TFile[];
                private onSelect: (file: TFile) => void;

                constructor(app: App, files: TFile[], onSelect: (file: TFile) => void) {
                    super(app);
                    this.files = files;
                    this.onSelect = onSelect;
                }

                onOpen() {
                    this.modalEl.addClass('nw-scope');
                    this.modalEl.addClass('nw-modal-sm');
                    const { contentEl } = this;
                    contentEl.empty();
                    contentEl.style.width = '100%';
                    contentEl.createEl('h3', { text: '选择文件' });

                    const searchInput = contentEl.createEl('input', {
                        type: 'text',
                        attr: {
                            placeholder: '搜索文件...',
                            style: 'width:100%;padding:8px;margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:4px;'
                        }
                    });

                    const list = contentEl.createDiv({
                        attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
                    });

                    const renderList = (filter: string) => {
                        list.empty();
                        const filtered = this.files.filter(f =>
                            f.name.toLowerCase().includes(filter.toLowerCase())
                        );
                        filtered.forEach(file => {
                            const item = list.createDiv({
                                attr: { style: 'padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}' }
                            });
                            item.createSpan({ text: '📄 ' + file.name });
                            item.addEventListener('click', () => {
                                this.onSelect(file);
                                this.close();
                            });
                        });
                    };

                    renderList('');
                    searchInput.addEventListener('input', () => {
                        renderList(searchInput.value);
                    });
                }
            })(this.app, files, async (file: TFile) => {
                const content = await this.app.vault.read(file);
                await this.importBook(file.basename, '', file.path, content);
            });
            modal.open();
        } catch (e) {
            new Notice('选择文件失败');
        }
    }

    private importFromFile(): void {
        const input = createEl('input', {
            attr: { type: 'file', accept: '.txt,.md', style: 'display:none;' }
        });
        input.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const name = file.name.replace(/\.(txt|md)$/i, '');
                await this.importBook(name, '', file.name, text);
            } catch (err) {
                new Notice('读取文件失败');
            }
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private renderFormStep(): void {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('书名')
            .addText(t => t
                .setPlaceholder('请输入书名')
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName('作者')
            .addText(t => t
                .setPlaceholder('请输入作者（可选）')
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        const actions = contentEl.createDiv({
            cls: 'nw-flex-end', attr: { style: 'margin-top:20px;' }
        });

        const backBtn = actions.createEl('button', {
            text: '返回',
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.addEventListener('click', () => {
            this.step = 'select';
            this.render();
        });

        const confirmBtn = actions.createEl('button', {
            text: '确认导入',
            cls: 'nw-btn nw-btn-primary'
        });
        confirmBtn.addEventListener('click', () => {
            if (!this.nameValue.trim()) {
                new Notice('请输入书名');
                return;
            }
            this.importBook(this.nameValue.trim(), this.authorValue.trim(), '', '');
        });
    }

    private async importBook(name: string, author: string, sourcePath: string, content: string): Promise<void> {
        if (!this.kbManager) {
            new Notice('知识库管理器未初始化');
            return;
        }

        try {
            const wordCount = content.length;
            const book = await this.kbManager.addBook({
                name,
                author,
                wordCount,
                themeTags: [],
                techniqueTags: [],
                customTags: [],
                synopsis: '',
                sourcePath,
            });

            if (content) {
                const fs = (this.app.vault.adapter as any);
                const baseDir = this.kbManager.getBaseDir();
                const bookDir = kbBookDir(name, baseDir);
                await fs.mkdir(bookDir).catch(() => { });
                await fs.write(`${bookDir}/${name}.txt`, content);
            }

            try {
                await this.kbManager.classifyBook(book.id);
            } catch (e) {
                log.warn('自动分类失败，继续导入:', e);
            }

            this.onImported(book);
            this.close();
        } catch (e) {
            log.error('导入失败:', e);
            new Notice(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class EditBookModal extends Modal {
    private book: BookBasicInfo;
    private kbManager: KnowledgeBaseManager | null;
    private kb: WebnovelKnowledgeBase | null;
    private onSaved: (book: BookBasicInfo) => void;

    private nameValue: string;
    private authorValue: string;
    private synopsisValue: string;
    private channelValue: string;
    private genreValue: string;
    private subGenreValue: string;
    private customTagsList: string[];
    private customTagsInputValue: string = '';

    constructor(
        app: App,
        book: BookBasicInfo,
        kbManager: KnowledgeBaseManager | null,
        kb: WebnovelKnowledgeBase | null,
        onSaved: (book: BookBasicInfo) => void
    ) {
        super(app);
        this.book = book;
        this.kbManager = kbManager;
        this.kb = kb;
        this.onSaved = onSaved;
        this.nameValue = book.name;
        this.authorValue = book.author || '';
        this.synopsisValue = book.synopsis || '';
        this.channelValue = book.genreChannel || '';
        this.genreValue = book.primaryGenre || '';
        this.subGenreValue = book.primarySubGenre || '';
        this.customTagsList = [...book.customTags];
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.renderContent();
    }

    private render(): void {
        this.renderContent();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '✏️ 编辑书籍信息' });

        new Setting(contentEl)
            .setName('书名')
            .addText(t => t
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName('作者')
            .addText(t => t
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        new Setting(contentEl)
            .setName('简介')
            .addTextArea(t => t
                .setValue(this.synopsisValue)
                .onChange(v => this.synopsisValue = v)
                .inputEl.rows = 4);

        contentEl.createEl('h4', { text: '题材分类', attr: { style: 'margin-top:20px;margin-bottom:8px;font-size:14px;' } });

        const channelSetting = new Setting(contentEl)
            .setName('频道')
            .addDropdown(d => {
                d.addOption('', '请选择');
                d.addOption('male', '男频');
                d.addOption('female', '女频');
                d.addOption('neutral', '中性');
                d.setValue(this.channelValue);
                d.onChange(v => {
                    this.channelValue = v;
                    this.genreValue = '';
                    this.subGenreValue = '';
                    this.render();
                });
            });
        void channelSetting;

        const genreSetting = new Setting(contentEl)
            .setName('大类')
            .addDropdown(d => {
                d.addOption('', '请选择');
                if (this.kb && this.channelValue) {
                    this.kb.getGenresByCategory(this.channelValue as any).forEach(g => {
                        d.addOption(g.id, g.name);
                    });
                } else if (this.kb) {
                    this.kb.getAllGenres().forEach(g => {
                        d.addOption(g.id, g.name);
                    });
                }
                d.setValue(this.genreValue);
                d.onChange(v => {
                    this.genreValue = v;
                    this.subGenreValue = '';
                    this.render();
                });
            });
        void genreSetting;

        if (this.genreValue && this.kb) {
            const genre = this.kb.getGenre(this.genreValue);
            if (genre?.subGenres && genre.subGenres.length > 0) {
                const subSetting = new Setting(contentEl)
                    .setName('细分')
                    .addDropdown(d => {
                        d.addOption('', '请选择');
                        genre.subGenres!.forEach(s => {
                            d.addOption(s.id, s.name);
                        });
                        d.setValue(this.subGenreValue);
                        d.onChange(v => {
                            this.subGenreValue = v;
                        });
                    });
                void subSetting;
            }
        }

        contentEl.createEl('h4', { text: '自定义标签', attr: { style: 'margin-top:20px;margin-bottom:8px;font-size:14px;' } });

        const tagsContainer = contentEl.createDiv({
            attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;min-height:30px;' }
        });
        this.renderCustomTags(tagsContainer);

        const addTagContainer = contentEl.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-bottom:12px;' }
        });
        const tagInput = addTagContainer.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '输入标签，按回车添加',
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;'
            }
        });
        const addTagBtn = addTagContainer.createEl('button', {
            text: '添加',
            cls: 'nw-btn nw-btn-primary nw-btn-sm'
        });
        const addTagHandler = () => {
            const tag = tagInput.value.trim();
            if (tag && !this.customTagsList.includes(tag)) {
                this.customTagsList.push(tag);
                tagInput.value = '';
                this.renderCustomTags(tagsContainer);
            }
        };
        addTagBtn.addEventListener('click', addTagHandler);
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addTagHandler();
        });

        const actions = contentEl.createDiv({
            cls: 'nw-flex-end', attr: { style: 'margin-top:20px;' }
        });

        const cancelBtn = actions.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = actions.createEl('button', {
            text: '保存',
            cls: 'nw-btn nw-btn-primary'
        });
        saveBtn.addEventListener('click', () => this.save());
    }

    private renderCustomTags(container: HTMLElement): void {
        container.empty();
        if (this.customTagsList.length === 0) {
            container.createSpan({
                text: '暂无标签',
                attr: { style: 'color:var(--text-muted);font-size:13px;' }
            });
            return;
        }
        this.customTagsList.forEach((tag, idx) => {
            const tagEl = container.createSpan({
                cls: 'nw-flex-row-sm',
                attr: {
                    style: 'padding:4px 10px;font-size:12px;background:var(--background-secondary);border-radius:12px;'
                }
            });
            tagEl.createSpan({ text: tag });
            const delBtn = tagEl.createSpan({
                text: '×',
                attr: { style: 'cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;' }
            });
            delBtn.addEventListener('click', () => {
                this.customTagsList.splice(idx, 1);
                this.renderCustomTags(container);
            });
        });
    }

    private save(): void {
        if (!this.kbManager || !this.nameValue.trim()) {
            new Notice('请填写书名');
            return;
        }

        const channelChanged = (this.channelValue as any) !== (this.book.genreChannel || '');
        const genreChanged = (this.genreValue || '') !== (this.book.primaryGenre || '');
        const subGenreChanged = (this.subGenreValue || '') !== (this.book.primarySubGenre || '');

        this.kbManager.updateBook(this.book.id, {
            name: this.nameValue.trim(),
            author: this.authorValue.trim(),
            synopsis: this.synopsisValue.trim(),
            genreChannel: (this.channelValue as any) || undefined,
            primaryGenre: this.genreValue || undefined,
            primarySubGenre: this.subGenreValue || undefined,
            customTags: this.customTagsList,
        }).then(async () => {
            if (channelChanged || genreChanged || subGenreChanged) {
                try {
                    await this.kbManager!.recordGenreCorrection(this.book.id, {
                        channel: (this.channelValue as any) || undefined,
                        primaryGenre: this.genreValue || undefined,
                        primarySubGenre: this.subGenreValue || undefined,
                    });
                } catch (e) {
                    log.warn('记录分类偏好失败:', e);
                }
            }
            const updated = await this.kbManager!.getBook(this.book.id);
            if (updated) {
                this.onSaved(updated);
            }
            this.close();
            new Notice('✅ 保存成功');
        }).catch(e => {
            new Notice('保存失败');
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class GenreEditModal extends Modal {
    private mode: 'create' | 'edit' | 'view';
    private genre: GenreConfig;
    private onSave?: (genre: GenreConfig) => void;
    private onDelete?: (id: string) => void;

    private tempGenre: GenreConfig;
    private newTagInput: HTMLInputElement | null = null;

    constructor(
        app: App,
        mode: 'create' | 'edit' | 'view',
        genre: GenreConfig,
        onSave?: (genre: GenreConfig) => void,
        onDelete?: (id: string) => void
    ) {
        super(app);
        this.mode = mode;
        this.genre = { ...genre };
        this.tempGenre = JSON.parse(JSON.stringify(genre));
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.modalEl.style.maxHeight = '85vh';
        this.modalEl.style.overflowY = 'auto';
        this.render();
    }

    private isEditable(): boolean {
        return this.mode === 'create' || this.mode === 'edit';
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const titleMap = {
            create: '➕ 新增题材',
            edit: '✏️ 编辑题材',
            view: '📖 题材详情',
        };
        contentEl.createEl('h3', { text: titleMap[this.mode], cls: 'nw-modal-title' });

        this.renderBasicInfo(contentEl);
        this.renderTagSection(contentEl, '性格标签', 'personalityTags');
        this.renderTagSection(contentEl, '能力类型', 'abilityTypes');
        this.renderTagSection(contentEl, '角色定位', 'roleTypes');
        this.renderTagSection(contentEl, '背景类型', 'backgroundTypes');
        this.renderTechniquesSection(contentEl);
        this.renderSubGenresSection(contentEl);
        this.renderWeightsSection(contentEl);
        this.renderActions(contentEl);
    }

    private renderBasicInfo(container: HTMLElement): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        section.createEl('h4', { text: '基本信息', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });

        const form = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:12px;' } });

        const nameRow = form.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
        nameRow.createSpan({ text: '名称', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const input = nameRow.createEl('input', {
                type: 'text',
                value: this.tempGenre.name,
                attr: {
                    style: 'padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
                }
            });
            input.addEventListener('input', () => {
                this.tempGenre.name = input.value.trim();
            });
        } else {
            nameRow.createDiv({ text: this.tempGenre.name, attr: { style: 'font-size:14px;font-weight:500;' } });
        }

        const categoryRow = form.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
        categoryRow.createSpan({ text: '频道', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const select = categoryRow.createEl('select', {
                attr: {
                    style: 'padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
                }
            });
            const options = [
                { value: 'male', label: '男频' },
                { value: 'female', label: '女频' },
                { value: 'neutral', label: '中性' },
            ];
            options.forEach(opt => {
                const option = select.createEl('option', { value: opt.value, text: opt.label });
                if (this.tempGenre.category === opt.value) option.selected = true;
            });
            select.addEventListener('change', () => {
                this.tempGenre.category = select.value as 'male' | 'female' | 'neutral';
            });
        } else {
            const labelMap: Record<string, string> = { male: '男频', female: '女频', neutral: '中性' };
            categoryRow.createDiv({ text: labelMap[this.tempGenre.category] || this.tempGenre.category });
        }

        const descRow = form.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
        descRow.createSpan({ text: '描述', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const textarea = descRow.createEl('textarea', {
                value: this.tempGenre.description,
                attr: {
                    rows: '3',
                    style: 'padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;background:var(--background-primary);color:var(--text-normal);resize:vertical;'
                }
            });
            textarea.addEventListener('input', () => {
                this.tempGenre.description = textarea.value.trim();
            });
        } else {
            descRow.createDiv({
                text: this.tempGenre.description,
                attr: { style: 'font-size:13px;line-height:1.6;color:var(--text-normal);' }
            });
        }
    }

    private renderTagSection(container: HTMLElement, label: string, field: 'personalityTags' | 'abilityTypes' | 'roleTypes' | 'backgroundTypes'): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        section.createEl('h4', {
            text: `${label} (${this.tempGenre[field].length})`,
            attr: { style: 'margin:0 0 8px 0;font-size:14px;' }
        });

        const tagsWrap = section.createDiv({
            attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;padding:12px;background:var(--background-secondary);border-radius:6px;min-height:48px;' }
        });

        this.tempGenre[field].forEach((tag, idx) => {
            const tagEl = tagsWrap.createSpan({
                text: tag,
                attr: { style: 'padding:3px 10px;font-size:12px;background:var(--background-primary);border-radius:10px;color:var(--text-normal);display:flex;align-items:center;gap:4px;' }
            });
            if (this.isEditable()) {
                const removeBtn = tagEl.createSpan({
                    text: '×',
                    attr: { style: 'cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;' }
                });
                removeBtn.addEventListener('click', () => {
                    this.tempGenre[field].splice(idx, 1);
                    this.render();
                });
            }
        });

        if (this.isEditable()) {
            const inputRow = section.createDiv({ attr: { style: 'display:flex;gap:6px;margin-top:8px;' } });
            const input = inputRow.createEl('input', {
                type: 'text',
                attr: {
                    placeholder: `添加${label}...`,
                    style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                }
            });
            const addBtn = inputRow.createEl('button', {
                text: '添加',
                cls: 'nw-btn nw-btn-secondary nw-btn-xs'
            });
            addBtn.addEventListener('click', () => {
                const value = input.value.trim();
                if (value && !this.tempGenre[field].includes(value)) {
                    this.tempGenre[field].push(value);
                    input.value = '';
                    this.render();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addBtn.click();
                }
            });
        }
    }

    private renderTechniquesSection(container: HTMLElement): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        section.createEl('h4', {
            text: `写作技巧 (${this.tempGenre.techniques.length})`,
            attr: { style: 'margin:0 0 8px 0;font-size:14px;' }
        });

        if (this.tempGenre.techniques.length < 5 && this.isEditable()) {
            section.createDiv({
                text: '⚠️ 至少需要 5 个写作技巧',
                attr: { style: 'font-size:12px;color:#e74c3c;margin-bottom:8px;' }
            });
        }

        const techniquesList = section.createDiv({
            attr: { style: 'display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;' }
        });

        this.tempGenre.techniques.forEach((tech, idx) => {
            const techItem = techniquesList.createDiv({
                attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;' }
            });

            if (this.isEditable()) {
                const headerRow = techItem.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;' } });
                const nameInput = headerRow.createEl('input', {
                    type: 'text',
                    value: tech.name,
                    attr: {
                        placeholder: '技巧名称',
                        style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                    }
                });
                nameInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].name = nameInput.value.trim();
                });

                const categorySelect = headerRow.createEl('select', {
                    attr: {
                        style: 'padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                    }
                });
                const categories = [
                    { value: 'structure', label: '结构' },
                    { value: 'cool_point', label: '爽点' },
                    { value: 'emotion', label: '情感' },
                    { value: 'rhythm', label: '节奏' },
                    { value: 'genre', label: '题材' },
                    { value: 'style', label: '风格' },
                    { value: 'foreshadow', label: '伏笔' },
                ];
                categories.forEach(cat => {
                    const opt = categorySelect.createEl('option', { value: cat.value, text: cat.label });
                    if (tech.category === cat.value) opt.selected = true;
                });
                categorySelect.addEventListener('change', () => {
                    this.tempGenre.techniques[idx].category = categorySelect.value as TechniqueDef['category'];
                });

                const deleteBtn = headerRow.createEl('button', {
                    text: '🗑️',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs',
                    attr: { style: 'padding:4px 8px;' }
                });
                deleteBtn.addEventListener('click', () => {
                    this.tempGenre.techniques.splice(idx, 1);
                    this.render();
                });
            } else {
                const categoryMap: Record<string, string> = {
                    structure: '结构', cool_point: '爽点', emotion: '情感', rhythm: '节奏',
                    genre: '题材', style: '风格', foreshadow: '伏笔'
                };
                const headerRow = techItem.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' } });
                headerRow.createDiv({ text: tech.name, attr: { style: 'font-size:13px;font-weight:500;' } });
                headerRow.createSpan({
                    text: categoryMap[tech.category] || tech.category,
                    attr: { style: 'font-size:11px;padding:2px 8px;background:var(--background-primary);border-radius:8px;color:var(--text-muted);' }
                });
            }

            if (this.isEditable()) {
                const descInput = techItem.createEl('textarea', {
                    value: tech.description,
                    attr: {
                        rows: '2',
                        placeholder: '技巧描述',
                        style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);resize:vertical;margin-bottom:6px;box-sizing:border-box;'
                    }
                });
                descInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].description = descInput.value.trim();
                });

                const kwInput = techItem.createEl('input', {
                    type: 'text',
                    value: tech.keywords.join(', '),
                    attr: {
                        placeholder: '关键词（用逗号分隔）',
                        style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
                    }
                });
                kwInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].keywords = kwInput.value.split(',').map(k => k.trim()).filter(k => k);
                });
            } else {
                techItem.createDiv({
                    text: tech.description,
                    attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:4px;' }
                });
                if (tech.keywords.length > 0) {
                    const kwWrap = techItem.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:4px;' } });
                    tech.keywords.forEach(kw => {
                        kwWrap.createSpan({
                            text: kw,
                            attr: { style: 'font-size:11px;padding:1px 6px;background:var(--background-primary);border-radius:8px;color:var(--text-muted);' }
                        });
                    });
                }
            }
        });

        if (this.isEditable()) {
            const addTechBtn = section.createEl('button', {
                text: '➕ 添加技巧',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { style: 'margin-top:8px;width:100%;' }
            });
            addTechBtn.addEventListener('click', () => {
                const newTech: TechniqueDef = {
                    id: `tech_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: '',
                    category: 'structure',
                    description: '',
                    keywords: [],
                    baseConfidence: 0.5,
                    genreWeight: 1.0,
                };
                this.tempGenre.techniques.push(newTech);
                this.render();
            });
        }
    }

    private renderSubGenresSection(container: HTMLElement): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        const subGenres = this.tempGenre.subGenres || [];
        section.createEl('h4', {
            text: `细分题材 (${subGenres.length}) - 可选`,
            attr: { style: 'margin:0 0 8px 0;font-size:14px;' }
        });

        if (subGenres.length > 0) {
            const subList = section.createDiv({
                attr: { style: 'display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;' }
            });
            subGenres.forEach((sub, idx) => {
                const subItem = subList.createDiv({
                    attr: { style: 'padding:8px 10px;background:var(--background-secondary);border-radius:6px;' }
                });

                if (this.isEditable()) {
                    const row1 = subItem.createDiv({ attr: { style: 'display:flex;gap:6px;margin-bottom:4px;' } });
                    const nameInput = row1.createEl('input', {
                        type: 'text',
                        value: sub.name,
                        attr: {
                            placeholder: '子题材名称',
                            style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                        }
                    });
                    nameInput.addEventListener('input', () => {
                        if (this.tempGenre.subGenres) {
                            this.tempGenre.subGenres[idx].name = nameInput.value.trim();
                        }
                    });
                    const delBtn = row1.createEl('button', {
                        text: '🗑️',
                        cls: 'nw-btn nw-btn-ghost nw-btn-xs'
                    });
                    delBtn.addEventListener('click', () => {
                        this.tempGenre.subGenres?.splice(idx, 1);
                        this.render();
                    });

                    const descInput = subItem.createEl('input', {
                        type: 'text',
                        value: sub.description,
                        attr: {
                            placeholder: '描述',
                            style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
                        }
                    });
                    descInput.addEventListener('input', () => {
                        if (this.tempGenre.subGenres) {
                            this.tempGenre.subGenres[idx].description = descInput.value.trim();
                        }
                    });
                } else {
                    subItem.createDiv({ text: sub.name, attr: { style: 'font-size:13px;font-weight:500;margin-bottom:2px;' } });
                    subItem.createDiv({
                        text: sub.description,
                        cls: 'nw-text-muted-11', attr: { style: 'font-size:12px;' }
                    });
                }
            });
        }

        if (this.isEditable()) {
            const addSubBtn = section.createEl('button', {
                text: '➕ 添加细分题材',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { style: 'margin-top:8px;width:100%;' }
            });
            addSubBtn.addEventListener('click', () => {
                if (!this.tempGenre.subGenres) {
                    this.tempGenre.subGenres = [];
                }
                const newSub: SubGenreConfig = {
                    id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: '',
                    description: '',
                    keywords: [],
                    exampleTitles: [],
                };
                this.tempGenre.subGenres.push(newSub);
                this.render();
            });
        }
    }

    private renderWeightsSection(container: HTMLElement): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        section.createEl('h4', { text: '权重配置', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });

        const weightsGrid = section.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:12px;' }
        });

        const weightLabels: { key: keyof GenreConfig['weights']; label: string }[] = [
            { key: 'character', label: '人设' },
            { key: 'foreshadow', label: '伏笔' },
            { key: 'technique', label: '技巧' },
            { key: 'style', label: '风格' },
            { key: 'rhythm', label: '节奏' },
            { key: 'structure', label: '结构' },
        ];

        weightLabels.forEach(({ key, label }) => {
            const weightItem = weightsGrid.createDiv({
                attr: { style: 'padding:10px;background:var(--background-secondary);border-radius:6px;' }
            });
            const labelRow = weightItem.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:6px;' } });
            labelRow.createSpan({ text: label, attr: { style: 'font-size:12px;' } });
            labelRow.createSpan({
                text: (this.tempGenre.weights[key] * 100).toFixed(0) + '%',
                attr: { style: 'font-size:12px;font-weight:600;color:var(--interactive-accent);' }
            });

            if (this.isEditable()) {
                const slider = weightItem.createEl('input', {
                    type: 'range',
                    attr: {
                        min: '0',
                        max: '1',
                        step: '0.05',
                        value: this.tempGenre.weights[key].toString(),
                        style: 'width:100%;'
                    }
                });
                slider.addEventListener('input', () => {
                    this.tempGenre.weights[key] = parseFloat(slider.value);
                    this.render();
                });
            } else {
                const barBg = weightItem.createDiv({
                    attr: { style: 'height:6px;background:var(--background-primary);border-radius:3px;overflow:hidden;' }
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${this.tempGenre.weights[key] * 100}%;background:var(--interactive-accent);border-radius:3px;`
                    }
                });
            }
        });
    }

    private renderActions(container: HTMLElement): void {
        const actions = container.createDiv({
            cls: 'nw-flex-end',
            attr: { style: 'margin-top:20px;display:flex;gap:8px;position:sticky;bottom:0;background:var(--background-primary);padding-top:12px;border-top:1px solid var(--background-modifier-border);' }
        });

        if (this.mode === 'view') {
            const saveAsBtn = actions.createEl('button', {
                text: '💾 另存为自定义',
                cls: 'nw-btn nw-btn-primary'
            });
            saveAsBtn.addEventListener('click', () => {
                const newGenre: GenreConfig = {
                    ...JSON.parse(JSON.stringify(this.tempGenre)),
                    id: `custom_${Date.now()}`,
                    isCustom: true,
                    name: `${this.tempGenre.name} (副本)`,
                };
                this.onSave?.(newGenre);
                this.close();
            });

            const closeBtn = actions.createEl('button', {
                text: '关闭',
                cls: 'nw-btn nw-btn-secondary'
            });
            closeBtn.addEventListener('click', () => this.close());
        } else if (this.mode === 'edit') {
            const deleteBtn = actions.createEl('button', {
                text: '🗑️ 删除',
                cls: 'nw-btn nw-btn-danger'
            });
            deleteBtn.addEventListener('click', () => {
                if (confirm(`确定要删除题材「${this.tempGenre.name}」吗？`)) {
                    this.onDelete?.(this.tempGenre.id);
                    this.close();
                }
            });

            const cancelBtn = actions.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => this.close());

            const saveBtn = actions.createEl('button', {
                text: '保存',
                cls: 'nw-btn nw-btn-primary'
            });
            saveBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.close();
                }
            });
        } else {
            const cancelBtn = actions.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => this.close());

            const createBtn = actions.createEl('button', {
                text: '创建',
                cls: 'nw-btn nw-btn-primary'
            });
            createBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.id = `custom_${Date.now()}`;
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.close();
                }
            });
        }
    }

    private validate(): boolean {
        if (!this.tempGenre.name.trim()) {
            new Notice('请输入题材名称');
            return false;
        }
        if (!this.tempGenre.category) {
            new Notice('请选择频道');
            return false;
        }
        if (this.tempGenre.techniques.length < 5) {
            new Notice('写作技巧至少需要 5 个');
            return false;
        }
        for (let i = 0; i < this.tempGenre.techniques.length; i++) {
            if (!this.tempGenre.techniques[i].name.trim()) {
                new Notice(`第 ${i + 1} 个技巧名称不能为空`);
                return false;
            }
        }
        return true;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class BatchOperationsModal extends Modal {
    private kbManager: KnowledgeBaseManager | null;
    private onCompleted: () => void;
    private selectedBooks: Set<string> = new Set();
    private operation: 'classify' | 'delete' | 'export' = 'classify';
    private processing: boolean = false;
    private books: BookBasicInfo[] = [];
    private loading: boolean = true;

    constructor(app: App, kbManager: KnowledgeBaseManager | null, onCompleted: () => void) {
        super(app);
        this.kbManager = kbManager;
        this.onCompleted = onCompleted;
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.render();
        await this.loadBooks();
    }

    private async loadBooks(): Promise<void> {
        if (!this.kbManager) {
            this.loading = false;
            this.render();
            return;
        }
        try {
            this.books = await this.kbManager.listBooks();
        } catch (e) {
            log.error('加载书籍列表失败:', e);
            this.books = [];
        }
        this.loading = false;
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '⚙️ 批量操作', cls: 'nw-modal-title' });

        if (this.loading) {
            contentEl.createDiv({
                text: '加载中...',
                attr: { style: 'padding:40px;text-align:center;color:var(--text-muted);font-size:13px;' }
            });
            return;
        }

        const opsRow = contentEl.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-bottom:16px;' }
        });

        const operations = [
            { key: 'classify', label: '🏷️ 自动分类', desc: '自动识别书籍分类' },
        ];

        operations.forEach(op => {
            const btn = opsRow.createEl('button', {
                text: op.label,
                cls: `nw-btn ${this.operation === op.key ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
                attr: { style: 'flex:1;padding:12px;text-align:left;' }
            });
            btn.addEventListener('click', () => {
                this.operation = op.key as any;
                this.render();
            });
        });

        const books = this.books;
        const uncategorizedCount = books.filter(b => !b.primaryGenre).length;

        const selectRow = contentEl.createDiv({
            cls: 'nw-flex-between', attr: { style: 'margin-bottom:12px;' }
        });
        selectRow.createSpan({
            text: `共 ${books.length} 本书籍（未分类 ${uncategorizedCount} 本）`,
            cls: 'nw-text-sm-muted'
        });

        const selectBtns = selectRow.createDiv({ attr: { style: 'display:flex;gap:6px;' } });

        const selectAllBtn = selectBtns.createEl('button', {
            text: '全选',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectAllBtn.addEventListener('click', () => {
            books.forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const selectUncategorizedBtn = selectBtns.createEl('button', {
            text: '选择未分类',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectUncategorizedBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            books.filter(b => !b.primaryGenre).forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const clearBtn = selectBtns.createEl('button', {
            text: '清空',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        clearBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            this.render();
        });

        const bookList = contentEl.createDiv({
            attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
        });

        if (books.length === 0) {
            bookList.createDiv({
                text: '暂无书籍',
                attr: { style: 'padding:40px;text-align:center;color:var(--text-muted);font-size:13px;' }
            });
        } else {
            books.forEach((book, idx) => {
                const isSelected = this.selectedBooks.has(book.id);
                const item = bookList.createDiv({
                    attr: {
                        style: `padding:8px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;${idx < books.length - 1 ? 'border-bottom:1px solid var(--background-modifier-border);' : ''}${isSelected ? 'background:rgba(var(--interactive-accent-rgb),0.08);' : ''}`
                    }
                });
                item.addEventListener('click', () => {
                    if (isSelected) {
                        this.selectedBooks.delete(book.id);
                    } else {
                        this.selectedBooks.add(book.id);
                    }
                    this.render();
                });

                const checkbox = item.createSpan({
                    text: isSelected ? '☑' : '☐',
                    cls: 'nw-flex-shrink-0', attr: { style: 'font-size:14px;width:16px;' }
                });
                void checkbox;

                const info = item.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
                info.createDiv({
                    text: book.name,
                    cls: 'nw-ellipsis', attr: { style: 'font-size:13px;color:var(--text-normal);' }
                });
                info.createDiv({
                    text: book.author || '未知作者',
                    cls: 'nw-text-muted-11'
                });

                const genreText = book.primaryGenre
                    ? this.getGenreLabel(book.primaryGenre, book.primarySubGenre)
                    : '未分类';
                item.createSpan({
                    text: genreText,
                    cls: 'nw-text-muted-11 nw-flex-shrink-0'
                });
            });
        }

        const actions = contentEl.createDiv({
            cls: 'nw-flex-between', attr: { style: 'margin-top:16px;padding-top:12px;border-top:1px solid var(--background-modifier-border);' }
        });

        actions.createSpan({
            text: `已选择 ${this.selectedBooks.size} 本`,
            cls: 'nw-text-sm-muted'
        });

        const btnGroup = actions.createDiv({ attr: { style: 'display:flex;gap:8px;' } });

        const cancelBtn = btnGroup.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => this.close());

        const executeBtn = btnGroup.createEl('button', {
            text: this.processing ? '处理中...' : '执行',
            cls: 'nw-btn nw-btn-primary',
            attr: { disabled: this.selectedBooks.size === 0 || this.processing ? 'true' : null as any }
        });
        executeBtn.addEventListener('click', async () => {
            if (this.selectedBooks.size === 0 || this.processing) return;
            this.processing = true;
            this.render();

            try {
                if (this.operation === 'classify') {
                    new Notice(`正在分类 ${this.selectedBooks.size} 本书籍...`);
                    await this.kbManager?.classifyBatch(Array.from(this.selectedBooks));
                    new Notice(`✅ 批量分类完成`);
                }
                this.onCompleted();
                this.close();
            } catch (e) {
                log.error('批量操作失败:', e);
                new Notice('批量操作失败');
                this.processing = false;
                this.render();
            }
        });
    }

    private getGenreLabel(genreId: string, subGenreId?: string): string {
        if (!this.kbManager) return genreId;
        const kb = this.kbManager.getKnowledgeBase();
        const genre = kb.getGenre(genreId);
        if (!genre) return genreId;
        if (!subGenreId) return genre.name;
        const sub = kb.getSubGenre(genreId, subGenreId);
        return sub ? `${genre.name}·${sub.name}` : genre.name;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
