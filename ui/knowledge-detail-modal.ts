import { App, Modal, Notice } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import { appendSanitizedHtml } from '@/ui/rendering/safe-html';
import { KnowledgeBaseManager, BookBasicInfo } from '@/services/knowledge-base-manager';
import { DeconstructionScheduler } from '@/engine/deconstruction-scheduler';
import { VectorEnhancer } from '@/engine/vector-enhancer';
import { EmbeddingProviderFactory } from '@/engine/embedding/provider-factory';
import { KnowledgeToFingerprintConverter } from '@/engine/knowledge-to-fingerprint-converter';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import {
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookDir,
} from '@/shared/paths';
import { radarChart, barChart, donutChart, lineChart, scatterChart, timelineChart } from './svg-charts';
import { RefillModal } from './refill-modal';
import { KnowledgeMonitorModal } from './knowledge-monitor-modal';
import { createLogger } from '@/shared/logger';
import { t } from '@/i18n';
import { formatWordCount as formatWordCountText } from './views/kb-format';
import { normalizeDetailNumber } from './knowledge-detail-format';
import { openKnowledgeFolder } from './knowledge-folder-navigation';
import { escapeHtml } from '@/utils/helpers';
import type NovelWriterPlugin from '@/main';


const log = createLogger('KnowledgeDetailModal');
type TabKey = 'overview' | 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow';

/** Tab 名随语言变化，必须渲染时取（模块级常量会在加载时冻结语言） */
function tabLabels(): Record<TabKey, string> {
    return {
        overview: t('knowledgebase.dim.overview'),
        style: t('knowledgebase.dim.style'),
        rhythm: t('knowledgebase.dim.rhythm'),
        technique: t('knowledgebase.dim.technique'),
        structure: t('knowledgebase.dim.structure'),
        character: t('knowledgebase.dim.character'),
        foreshadow: t('knowledgebase.dim.foreshadow'),
    };
}

/** 完成度环图的六个维度，顺序与颜色数组一致 */
function dimensionLabelList(): string[] {
    return [
        t('knowledgebase.dim.style'),
        t('knowledgebase.dim.rhythm'),
        t('knowledgebase.dim.technique'),
        t('knowledgebase.dim.structure'),
        t('knowledgebase.dim.character'),
        t('knowledgebase.dim.foreshadow'),
    ];
}

/** 风格七维在拆解文件里是中文字面数据键，这里只映射显示名 */
const STYLE_DIMENSIONS = [
    '句式节奏', '用词偏好', '叙事特点', '修辞手法', '对话风格', '段落结构', '整体文风'
];

function styleDimensionLabel(name: string): string {
    switch (name) {
        case '句式节奏': return t('knowledgeDetail.styleDim.sentenceRhythm');
        case '用词偏好': return t('knowledgeDetail.styleDim.diction');
        case '叙事特点': return t('knowledgeDetail.styleDim.narrative');
        case '修辞手法': return t('knowledgeDetail.styleDim.rhetoric');
        case '对话风格': return t('knowledgeDetail.styleDim.dialogue');
        case '段落结构': return t('knowledgeDetail.styleDim.paragraph');
        case '整体文风': return t('knowledgeDetail.styleDim.overall');
        default: return name;
    }
}

/** 技巧分类同样是中文字面数据键 */
function techniqueCategoryLabel(name: string): string {
    switch (name) {
        case '情感': return t('knowledgeDetail.techCat.emotion');
        case '结构': return t('knowledgeDetail.techCat.structure');
        case '爽点': return t('knowledgeDetail.techCat.coolPoint');
        case '人物': return t('knowledgeDetail.techCat.character');
        case '设定': return t('knowledgeDetail.techCat.setting');
        case '对话': return t('knowledgeDetail.techCat.dialogue');
        case '描写': return t('knowledgeDetail.techCat.description');
        default: return name;
    }
}

/** 伏笔分类：数据里存中文，显示走 t() */
function foreshadowCategoryLabel(name: string): string {
    switch (name) {
        case '物品': return t('knowledgeDetail.fs.catItem');
        case '功法': return t('knowledgeDetail.fs.catSkill');
        case '人物': return t('knowledgeDetail.fs.catPerson');
        case '设定': return t('knowledgeDetail.fs.catSetting');
        case '事件': return t('knowledgeDetail.fs.catEvent');
        default: return name;
    }
}

interface StyleData {
    avgSentenceLength?: number;
    avgParagraphLength?: number;
    dialogueRatio?: number;
    descriptionRatio?: number;
    features?: Record<string, string>;
    description?: string;
}

interface RhythmData {
    emotionCurve?: Array<{ label: string; emotion: number; density: number; overall: number }>;
    coolPoints?: Array<{ x: number; y: number; label: string; category: string }>;
    plotStages?: Array<{ name: string; start: number; end: number }>;
    structureMatches?: Array<{ label: string; value: number }>;
    keyEmotionPoints?: Array<{ position: string; description: string }>;
}

interface TechniqueData {
    categories?: Record<string, number>;
    techniques?: Array<{ name: string; category: string; examples: string[] }>;
    top10?: Array<{ name: string; count: number }>;
}

interface StructureData {
    timeline?: Array<{ position: number; label: string; description: string; type: string }>;
    threeLines?: { main: number; sub: number; romance: number };
    rhythmUnits?: Array<{ level: string; name: string; children?: string[] }>;
    structureType?: string;
    structureDescription?: string;
}

interface CharacterKnowledgeData {
    mainCharacters?: Array<{ name: string; role: string; tags: string[]; growth?: string }>;
    relationships?: Array<{ from: string; to: string; type: string }>;
    allCharacters?: Array<{ name: string; role: string; tags: string[] }>;
}

interface ForeshadowData {
    items?: Array<{
        id: string;
        name: string;
        category: string;
        firstAppearance: string;
        echoes: string[];
        resolved: boolean;
        resolution?: string;
        importance?: number;
    }>;
    timeline?: Array<{ position: number; label: string; type: string; level?: number }>;
    stats?: { resolved: number; unresolved: number };
    pairs?: Array<{
        id: string;
        setupForeshadowName: string;
        payoffForeshadowName?: string;
        pairType: string;
        confidence: number;
        qualityScore?: number;
        matchDimensions?: {
            entityMatch: number;
            semanticMatch: number;
            temporalMatch: number;
            typeMatch: number;
        };
    }>;
    resolutionQualityStats?: {
        avgQuality: number;
        qualityDistribution: { excellent: number; good: number; fair: number; poor: number };
        lowQualityCount: number;
    };
    networkAnalysis?: {
        mainlineCount?: number;
        sidelineCount?: number;
        rhythmBalance?: {
            balanceScore: number;
            isBalanced: boolean;
        };
        densityByChapter?: Array<{
            chapter: number;
            setupCount: number;
            payoffCount: number;
            totalCount: number;
        }>;
    };
    unresolvedTracker?: {
        totalUnresolved: number;
        byImportance?: Array<{
            id: string;
            name: string;
            type: string;
            importance: number;
            plantedChapter: number;
            urgency: string;
            isForgotten?: boolean;
        }>;
        forgottenForeshadows?: Array<{
            name: string;
            plantedChapter: number;
            chaptersSincePlanted: number;
        }>;
        recallSuggestions?: Array<{
            chapter: number;
            foreshadows: string[];
            reason: string;
        }>;
    };
}

/**
 * KnowledgeDetailModal 类。
 */
export class KnowledgeDetailModal extends Modal {
    private bookId: string;
    private knowledgeManager: KnowledgeBaseManager;
    private deconstructionScheduler?: DeconstructionScheduler;
    private baseDir?: string;
    /** M3-4：构造注入的插件实例（替代私有 app.plugins） */
    private plugin?: NovelWriterPlugin;
    private bookInfo: BookBasicInfo | null = null;
    private activeTab: TabKey = 'overview';
    private expandedItems: Record<string, boolean> = {};
    private characterFilter = '';
    private foreshadowFilter = 'all';

    private styleData: StyleData | null = null;
    private rhythmData: RhythmData | null = null;
    private techniqueData: TechniqueData | null = null;
    private structureData: StructureData | null = null;
    private characterData: CharacterKnowledgeData | null = null;
    private foreshadowData: ForeshadowData | null = null;

    constructor(
        app: App,
        bookId: string,
        knowledgeManager: KnowledgeBaseManager,
        options?: {
            baseDir?: string;
            deconstructionScheduler?: DeconstructionScheduler;
            /** M3-4：由调用方注入插件实例，禁止再走私有 app.plugins */
            plugin?: NovelWriterPlugin;
        }
    ) {
        super(app);
        this.bookId = bookId;
        this.knowledgeManager = knowledgeManager;
        this.deconstructionScheduler = options?.deconstructionScheduler;
        this.baseDir = options?.baseDir;
        this.plugin = options?.plugin;
    }

    /**
     * onOpen 方法。
     */
    async onOpen() {
        this.modalEl.addClass('nw-scope');
        await this.loadData();
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose() {
        this.contentEl.empty();
    }

    private async loadData(): Promise<void> {
        this.bookInfo = (await this.knowledgeManager.getBook(this.bookId)) ?? null;
        if (!this.bookInfo) return;

        // 风格指纹文件是 Markdown frontmatter 格式（---\n<JSON>\n---\n\n正文），
        // 直接 JSON.parse 必失败并被吞成 {}，风格维度永远显示空。
        // 与其余维度统一走 loadMarkdownFrontmatter。
        this.styleData = await this.loadMarkdownFrontmatter(
            kbBookStyleFingerprintFile(this.bookInfo.name, this.baseDir)
        ) as StyleData | null;

        this.rhythmData = await this.loadMarkdownFrontmatter(
            kbBookRhythmAnalysisFile(this.bookInfo.name, this.baseDir)
        ) as RhythmData | null;

        this.techniqueData = await this.loadMarkdownFrontmatter(
            kbBookWritingTechniquesFile(this.bookInfo.name, this.baseDir)
        ) as TechniqueData | null;

        this.structureData = await this.loadMarkdownFrontmatter(
            kbBookStructureBreakdownFile(this.bookInfo.name, this.baseDir)
        ) as StructureData | null;

        this.characterData = await this.loadMarkdownFrontmatter(
            kbBookCharacterExtractionFile(this.bookInfo.name, this.baseDir)
        ) as CharacterKnowledgeData | null;

        this.foreshadowData = await this.loadMarkdownFrontmatter(
            kbBookForeshadowDBFile(this.bookInfo.name, this.baseDir)
        ) as ForeshadowData | null;
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
                log.warn(`[KnowledgeDetailModal] Failed to parse frontmatter JSON: ${path}`, e);
                return null;
            }
        } catch (e) {
            log.warn(`[KnowledgeDetailModal] Failed to load frontmatter: ${path}`, e);
            return null;
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-lg');
        }
        contentEl.addClass('nw-modal-content-88');

        if (!this.bookInfo) {
            contentEl.createDiv({ text: t('knowledgeDetail.missing'), cls: 'nw-kd-missing' });
            return;
        }

        this.renderHeader(contentEl);
        this.renderTabs(contentEl);
        this.renderTabContent(contentEl);
    }

    private getPlugin(): NovelWriterPlugin | null {
        // M3-4：app.plugins 是私有 API，审核风险；只使用构造注入的实例
        return this.plugin ?? null;
    }

    private isReferenceBook(): boolean {
        const plugin = this.getPlugin();
        if (!plugin || !Array.isArray(plugin.referenceBookIds)) return false;
        return plugin.referenceBookIds.includes(this.bookId);
    }

    private toggleReferenceBook(): void {
        const plugin = this.getPlugin();
        if (!plugin) return;

        const bookName = this.bookInfo?.name || t('knowledgeDetail.unknownBook');
        const isRef = this.isReferenceBook();

        if (!Array.isArray(plugin.referenceBookIds)) {
            plugin.referenceBookIds = [];
        }

        if (isRef) {
            plugin.referenceBookIds = plugin.referenceBookIds.filter((id: string) => id !== this.bookId);
            showSuccessNotice(t('knowledgeDetail.ref.removed', { book: bookName }));
        } else {
            if (!plugin.referenceBookIds.includes(this.bookId)) {
                plugin.referenceBookIds.push(this.bookId);
            }
            showSuccessNotice(t('knowledgeDetail.ref.added', { book: bookName }));
        }

        // 只改内存镜像的话重启就回退：必须同时写 settings 并落盘
        plugin.settings.referenceBookIds = [...plugin.referenceBookIds];
        void plugin.saveSettings().catch((e: unknown) => {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgeDetail.ref.saveFailed'), timeout: 6000 });
        });

        this.render();
    }

    private async onConvertToFingerprint(buttonEl: HTMLButtonElement): Promise<void> {
        try {
            if (!this.bookInfo) {
                new Notice(t('knowledgeDetail.fp.noBook'));
                return;
            }

            const stylePath = kbBookStyleFingerprintFile(this.bookInfo.name, this.baseDir);
            const adapter = this.app.vault.adapter as { exists(p: string): Promise<boolean> };
            const exists = await adapter.exists(stylePath);
            if (!exists) {
                new Notice(t('knowledgeDetail.fp.noStyle'));
                return;
            }

            const converter = new KnowledgeToFingerprintConverter(this.app);
            const fingerprint = await converter.convert(this.bookId, this.bookInfo.name, this.baseDir);

            const plugin = this.getPlugin();
            // settings 上没有 activeProject 字段；唯一真源是 getActiveProject()（活动文件 / 工作台上下文）
            const activeProject = plugin?.getActiveProject();
            if (!activeProject) {
                new Notice(t('knowledgeDetail.fp.noProject'));
                return;
            }

            const library = StyleFingerprintLibrary.get(this.app, activeProject);
            await library.addFromKnowledge(fingerprint);

            showSuccessNotice(t('knowledgeDetail.fp.done', { book: this.bookInfo.name }));
            buttonEl.setText(t('knowledgeDetail.fp.doneLabel'));
            buttonEl.disabled = true;
        } catch (e) {
            log.error('[KnowledgeDetailModal] 转换指纹失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgeDetail.fp.failed') });
        }
    }


    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'nw-kd-header' });
        
        const titleWrap = header.createDiv({ cls: 'nw-kd-header-main' });
        titleWrap.createEl('h3', { text: `📚 ${this.bookInfo!.name}`, cls: 'nw-kd-title' });

        const isRef = this.isReferenceBook();
        const refBtn = titleWrap.createEl('button', {
            text: isRef ? t('knowledgeDetail.ref.remove') : t('knowledgeDetail.ref.add'),
            attr: { type: 'button' },
            cls: `nw-kd-ref-btn${isRef ? ' nw-kd-ref-btn--on' : ''}`,
        });
        refBtn.addEventListener('click', () => this.toggleReferenceBook());

        const closeBtn = header.createEl('button', {
            text: '✕',
            attr: { type: 'button' },
            cls: 'nw-kd-close-btn',
        });
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderTabs(container: HTMLElement): void {
        const tabsContainer = container.createDiv({
            cls: 'nw-kd-tabs'
        });

        const tabKeys: TabKey[] = ['overview', 'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];
        for (const key of tabKeys) {
            const tab = tabsContainer.createEl('button', {
                text: tabLabels()[key],
                attr: { type: 'button' },
                cls: `nw-kd-tab${this.activeTab === key ? ' nw-kd-tab--active' : ''}`,
            });
            tab.addEventListener('click', () => {
                this.activeTab = key;
                this.render();
            });
        }
    }

    private renderTabContent(container: HTMLElement): void {
        switch (this.activeTab) {
            case 'overview':
                this.renderOverviewTab(container);
                break;
            case 'style':
                this.renderStyleTab(container);
                break;
            case 'rhythm':
                this.renderRhythmTab(container);
                break;
            case 'technique':
                this.renderTechniqueTab(container);
                break;
            case 'structure':
                this.renderStructureTab(container);
                break;
            case 'character':
                this.renderCharacterTab(container);
                break;
            case 'foreshadow':
                this.renderForeshadowTab(container);
                break;
        }
    }

    // ============== Tab 1: 概览 ==============
    private renderOverviewTab(container: HTMLElement): void {
        const book = this.bookInfo!;

        const infoCard = container.createDiv({
            cls: 'nw-kd-info-card'
        });
        infoCard.createEl('div', { text: t('knowledgeDetail.info.title'), cls: 'nw-kd-section-title' });

        const grid = infoCard.createDiv({ cls: 'nw-kd-info-grid' });
        this.renderInfoRow(grid, t('knowledgeDetail.info.bookName'), book.name);
        this.renderInfoRow(grid, t('knowledgeDetail.info.author'), book.author || t('knowledgeDetail.common.unknown'));
        this.renderInfoRow(grid, t('knowledgeDetail.info.themeTags'), book.themeTags.length ? book.themeTags.join(t('knowledgeDetail.common.listSep')) : t('knowledgeDetail.common.none'));
        this.renderInfoRow(grid, t('knowledgeDetail.info.wordCount'), book.wordCount ? this.formatWordCount(book.wordCount) : t('knowledgeDetail.common.unknown'));
        this.renderInfoRow(grid, t('knowledgeDetail.info.updatedAt'), this.formatDateTime(book.updatedAt));
        this.renderInfoRow(grid, t('knowledgeDetail.info.breakdownStatus'), this.getStatusText(book.breakdownStatus));
        this.renderInfoRow(grid, t('knowledgeDetail.info.vectorStatus'), this.getVectorStatusText(book.vectorStatus, book.vectorError));

        const chartSection = container.createDiv({ cls: 'nw-kd-section' });
        chartSection.createEl('div', { text: t('knowledgeDetail.info.completeness'), cls: 'nw-kd-section-title' });

        const donutData = dimensionLabelList().map((label, i) => ({
            label,
            value: this.getDimensionProgress(i),
            color: ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'][i]
        }));

        const donutCard = chartSection.createDiv({
            cls: 'nw-kd-card'
        });
        appendSanitizedHtml(donutCard, donutChart(donutData, { size: 300 }));

        const actionsSection = container.createDiv({ cls: 'nw-kd-section' });
        actionsSection.createEl('div', { text: t('knowledgeDetail.actions.title'), cls: 'nw-kd-section-title' });

        const btnRow = actionsSection.createDiv({ cls: 'nw-kd-actions' });

        const reanalyzeBtn = btnRow.createEl('button', {
            text: t('knowledgeDetail.actions.rerun'),
            attr: { type: 'button' },
            cls: 'nw-kd-btn',
        });
        reanalyzeBtn.addEventListener('click', () => {
            if (!this.ensureScheduler()) return;
            new RefillModal(this.app, {
                    type: 'knowledge',
                    bookId: this.bookId,
                    bookName: this.bookInfo?.name || '',
                    knowledgeBaseManager: this.knowledgeManager,
                    deconstructionScheduler: this.deconstructionScheduler!,
                }).open();
        });

        const convertFingerprintBtn = btnRow.createEl('button', {
            text: t('knowledgeDetail.actions.toFingerprint'),
            attr: { type: 'button' },
            cls: 'nw-kd-btn',
        });
        convertFingerprintBtn.addEventListener('click', () => this.onConvertToFingerprint(convertFingerprintBtn));

        // A5: 向量化失败时给出唯一可恢复入口，复用 revectorizeBook，不必重新拆解
        if (book.vectorStatus === 'failed') {
            const retryVectorBtn = btnRow.createEl('button', {
                text: t('knowledgeDetail.actions.retryVector'),
                attr: { type: 'button', title: book.vectorError || t('knowledgeDetail.actions.retryVectorTip') },
                cls: 'nw-kd-btn',
            });
            retryVectorBtn.addEventListener('click', async () => {
                const scheduler = this.ensureScheduler();
                if (!scheduler) return;
                retryVectorBtn.disabled = true;
                retryVectorBtn.textContent = t('knowledgeDetail.actions.vectorizing');
                try {
                    await scheduler.revectorizeBook(book.id, book.name);
                    showSuccessNotice(t('knowledgeDetail.actions.revectorDone', { book: book.name }));
                    this.bookInfo = (await this.knowledgeManager.getBook(this.bookId)) ?? this.bookInfo;
                    this.render();
                } catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    showErrorNotice(message, { title: t('knowledgeDetail.actions.revectorFailed', { book: book.name }), timeout: 8000 });
                    retryVectorBtn.disabled = false;
                    retryVectorBtn.textContent = t('knowledgeDetail.actions.retryVector');
                }
            });
        }

        const openFolderBtn = btnRow.createEl('button', {
            text: t('knowledgeDetail.actions.openFolder'),
            attr: { type: 'button' },
            cls: 'nw-kd-btn',
        });
        openFolderBtn.addEventListener('click', () => {
            const dir = kbBookDir(book.name, this.baseDir);
            const file = this.app.vault.getAbstractFileByPath(dir);
            if (file) void openKnowledgeFolder(this.app, dir);
        });

        const deleteBtn = btnRow.createEl('button', {
            text: t('knowledgeDetail.actions.delete'),
            attr: { type: 'button' },
            cls: 'nw-kd-btn nw-kd-btn--danger',
        });
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('knowledgeDetail.delete.title'),
                description: t('knowledgeDetail.delete.desc', { book: book.name }),
                warning: t('knowledgebase.common.irreversible'),
                confirmText: t('knowledgebase.common.confirmDelete'),
                cancelText: t('knowledgebase.common.cancel'),
            });
            if (!confirmed) return;
            try {
                // 先取消在途拆解，避免任务结束后把已删除的书目录/向量重新写回来
                await this.deconstructionScheduler?.cancelByBook(this.bookId);
                await this.knowledgeManager.deleteBook(this.bookId);
                showSuccessNotice(t('knowledgeDetail.delete.done'));
                this.close();
            } catch (e) {
                log.error('[KnowledgeDetailModal] 删除书籍失败:', e);
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgeDetail.delete.failed') });
            }
        });

        const descSection = container.createDiv({
            cls: 'nw-kd-synopsis'
        });
        descSection.textContent = book.synopsis || t('knowledgeDetail.overview.noSynopsis');
    }

    private getDimensionProgress(index: number): number {
        const dataList = [this.styleData, this.rhythmData, this.techniqueData, this.structureData, this.characterData, this.foreshadowData];
        const data = dataList[index] as Record<string, unknown> | null | undefined;
        // 空对象不能算「已完成」：解析失败时会得到 {}，旧实现会报 100% 与空数据矛盾
        return data && Object.keys(data).length > 0 ? 100 : 0;
    }

    // ============== Tab 2: 风格 ==============
    private renderStyleTab(container: HTMLElement): void {
        const data = this.styleData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.style.name'), 'style');
            return;
        }

        const radarSection = container.createDiv({ cls: 'nw-kd-section' });
        radarSection.createEl('div', { text: t('knowledgeDetail.style.radar'), cls: 'nw-kd-section-title' });

        const radarCard = radarSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--center'
        });

        const radarData = STYLE_DIMENSIONS.map(name => ({
            label: styleDimensionLabel(name),
            value: this.estimateFeatureScore(data.features?.[name] || '')
        }));
        appendSanitizedHtml(radarCard, radarChart(radarData, { size: 320 }));

        const statsSection = container.createDiv({ cls: 'nw-kd-section' });
        statsSection.createEl('div', { text: t('knowledgeDetail.style.stats'), cls: 'nw-kd-section-title' });

        const statsGrid = statsSection.createDiv({ cls: 'nw-kd-grid-4' });
        const statItems = [
            {
                label: t('knowledgeDetail.style.avgSentence'),
                value: data.avgSentenceLength
                    ? t('knowledgeDetail.common.chars', { count: data.avgSentenceLength })
                    : t('knowledgeDetail.style.pending'),
            },
            {
                label: t('knowledgeDetail.style.avgParagraph'),
                value: data.avgParagraphLength
                    ? t('knowledgeDetail.common.chars', { count: data.avgParagraphLength })
                    : t('knowledgeDetail.style.pending'),
            },
            {
                label: t('knowledgeDetail.style.dialogueRatio'),
                value: data.dialogueRatio !== undefined
                    ? `${Math.round(data.dialogueRatio * 100)}%`
                    : t('knowledgeDetail.style.pending'),
            },
            {
                label: t('knowledgeDetail.style.descriptionRatio'),
                value: data.descriptionRatio !== undefined
                    ? `${Math.round(data.descriptionRatio * 100)}%`
                    : t('knowledgeDetail.style.pending'),
            },
        ];
        for (const stat of statItems) {
            const card = statsGrid.createDiv({
                cls: 'nw-kd-mini-card'
            });
            card.createEl('div', { text: stat.value, cls: 'nw-kd-stat-value' });
            card.createEl('div', { text: stat.label, cls: 'nw-kd-muted-sm' });
        }

        const descSection = container.createDiv({ cls: 'nw-kd-section' });
        descSection.createEl('div', { text: t('knowledgeDetail.style.features'), cls: 'nw-kd-section-title' });

        const descCard = descSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--text'
        });

        if (data.description) {
            descCard.textContent = data.description;
        } else {
            const featureTexts = Object.entries(data.features || {});
            if (featureTexts.length > 0) {
                for (const [key, value] of featureTexts) {
                    const item = descCard.createDiv({ cls: 'nw-kd-feature-row' });
                    item.createEl('span', { text: t('knowledgeDetail.styleDimLine', { label: styleDimensionLabel(key) }), cls: 'nw-kd-strong' });
                    item.createEl('span', { text: value || t('knowledgeDetail.common.noData'), cls: 'nw-kd-muted' });
                }
            } else {
                descCard.createDiv({ text: t('knowledgeDetail.style.noFeatures'), cls: 'nw-kd-muted' });
            }
        }
    }

    private estimateFeatureScore(text: string): number {
        if (!text) return 50;
        const length = text.length;
        const keywordCount = (text.match(/[，。、；：]/g) || []).length;
        const richnessScore = Math.min(100, length * 0.3 + keywordCount * 5);
        return Math.max(30, Math.min(95, Math.round(richnessScore)));
    }

    // ============== Tab 3: 节奏 ==============
    private renderRhythmTab(container: HTMLElement): void {
        const data = this.rhythmData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.rhythm.name'), 'rhythm');
            return;
        }

        const curveSection = container.createDiv({ cls: 'nw-kd-section' });
        curveSection.createEl('div', { text: t('knowledgeDetail.rhythm.curve'), cls: 'nw-kd-section-title' });

        const curveCard = curveSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const curveData = data.emotionCurve;
        if (curveData && curveData.length > 0) {
            const series = [
                { name: t('knowledgeDetail.rhythm.seriesEmotion'), data: curveData.map(d => ({ label: d.label, value: d.emotion })), color: '#ef4444', smooth: true },
                { name: t('knowledgeDetail.rhythm.seriesDensity'), data: curveData.map(d => ({ label: d.label, value: d.density })), color: '#3b82f6', smooth: true },
                { name: t('knowledgeDetail.rhythm.seriesOverall'), data: curveData.map(d => ({ label: d.label, value: d.overall })), color: '#10b981', smooth: true },
            ];
            appendSanitizedHtml(curveCard, lineChart(series, { width: 600, height: 280 }));
        } else {
            curveCard.createDiv({ text: t('knowledgeDetail.rhythm.noCurve'), cls: 'nw-kd-empty' });
        }

        const scatterSection = container.createDiv({ cls: 'nw-kd-section' });
        scatterSection.createEl('div', { text: t('knowledgeDetail.rhythm.cool'), cls: 'nw-kd-section-title' });

        const scatterCard = scatterSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const scatterPoints = data.coolPoints;
        if (scatterPoints && scatterPoints.length > 0) {
            appendSanitizedHtml(scatterCard, scatterChart(scatterPoints, { width: 600, height: 250, xAxisLabel: t('knowledgeDetail.rhythm.axisChapter'), yAxisLabel: t('knowledgeDetail.rhythm.axisCool') }));
        } else {
            scatterCard.createDiv({ text: t('knowledgeDetail.rhythm.noCool'), cls: 'nw-kd-empty' });
        }

        const structureSection = container.createDiv({ cls: 'nw-kd-section' });
        structureSection.createEl('div', { text: t('knowledgeDetail.rhythm.match'), cls: 'nw-kd-section-title' });

        const structureCard = structureSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const matchData = data.structureMatches;
        if (matchData && matchData.length > 0) {
            appendSanitizedHtml(structureCard, barChart(matchData, { width: 500, height: 220, horizontal: true }));
        } else {
            structureCard.createDiv({ text: t('knowledgeDetail.rhythm.noMatch'), cls: 'nw-kd-empty' });
        }

        const keyPointsSection = container.createDiv({ cls: 'nw-kd-section' });
        keyPointsSection.createEl('div', { text: t('knowledgeDetail.rhythm.keyPoints'), cls: 'nw-kd-section-title' });

        const keyPointsCard = keyPointsSection.createDiv({
            cls: 'nw-kd-panel'
        });

        const keyPoints = data.keyEmotionPoints;
        if (keyPoints && keyPoints.length > 0) {
            for (const point of keyPoints) {
                const item = keyPointsCard.createDiv({
                    cls: 'nw-kd-kp-item'
                });
                item.createEl('span', { text: point.position, cls: 'nw-kd-kp-pos' });
                item.createEl('span', { text: point.description, cls: 'nw-kd-desc-flex' });
            }
        } else {
            keyPointsCard.createDiv({ text: t('knowledgeDetail.rhythm.noKeyPoints'), cls: 'nw-kd-empty nw-kd-empty--tight' });
        }
    }



    // ============== Tab 4: 技巧 ==============
    private renderTechniqueTab(container: HTMLElement): void {
        const data = this.techniqueData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.technique.name'), 'technique');
            return;
        }

        const categorySection = container.createDiv({ cls: 'nw-kd-section' });
        categorySection.createEl('div', { text: t('knowledgeDetail.technique.categories'), cls: 'nw-kd-section-title' });

        const categoryCard = categorySection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const categories = data.categories;
        if (categories && Object.keys(categories).length > 0) {
            const barData = Object.entries(categories).map(([label, value]) => ({ label: techniqueCategoryLabel(label), value }));
            appendSanitizedHtml(categoryCard, barChart(barData, { width: 500, height: 220 }));
        } else {
            categoryCard.createDiv({ text: t('knowledgeDetail.technique.noCategories'), cls: 'nw-kd-empty' });
        }

        const top10Section = container.createDiv({ cls: 'nw-kd-section' });
        top10Section.createEl('div', { text: t('knowledgeDetail.technique.top'), cls: 'nw-kd-section-title' });

        const top10Card = top10Section.createDiv({
            cls: 'nw-kd-panel nw-kd-panel--wide'
        });

        const top10 = data.top10;
        if (top10 && top10.length > 0) {
            for (let i = 0; i < top10.length; i++) {
                const item = top10Card.createDiv({
                    cls: 'nw-kd-rank-item'
                });
                const rank = item.createEl('span', {
                    text: `${i + 1}`,
                    cls: `nw-kd-rank-badge${i < 3 ? ' nw-kd-rank-badge--top' : ''}`,
                });
                item.createEl('span', { text: top10[i].name, cls: 'nw-kd-name-flex' });
                item.createEl('span', { text: t('knowledgeDetail.common.times', { count: top10[i].count }), cls: 'nw-kd-count' });
            }
        } else {
            top10Card.createDiv({ text: t('knowledgeDetail.technique.noTop'), cls: 'nw-kd-empty nw-kd-empty--tight' });
        }

        const listSection = container.createDiv({ cls: 'nw-kd-section' });
        listSection.createEl('div', { text: t('knowledgeDetail.technique.details'), cls: 'nw-kd-section-title' });

        const techniques = data.techniques;
        if (techniques && techniques.length > 0) {

        const categoryGroups: Record<string, typeof techniques> = {};
        for (const tech of techniques) {
            if (!categoryGroups[tech.category]) categoryGroups[tech.category] = [];
            categoryGroups[tech.category].push(tech);
        }

        for (const [category, items] of Object.entries(categoryGroups)) {
            const group = listSection.createDiv({
                cls: 'nw-kd-group'
            });

            const header = group.createDiv({
                cls: 'nw-kd-group-head'
            });
            header.textContent = category;

            const list = group.createDiv({ cls: 'nw-kd-list' });
            for (const tech of items) {
                const key = `tech_${tech.name}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const item = list.createDiv({
                    cls: 'nw-kd-row'
                });

                const itemHeader = item.createDiv({
                    cls: 'nw-kd-tech-head'
                });
                itemHeader.createEl('span', { text: tech.name, cls: 'nw-kd-tech-name' });
                itemHeader.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-kd-muted-xs'
                });

                itemHeader.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded) {
                    const body = item.createDiv({
                        cls: 'nw-kd-tech-body'
                    });
                    body.createEl('div', { text: t('knowledgeDetail.technique.sample'), cls: 'nw-kd-body-title' });
                    for (const example of tech.examples) {
                        body.createDiv({
                            text: `• ${example}`,
                            cls: 'nw-kd-example'
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: t('knowledgeDetail.technique.noDetails'), cls: 'nw-kd-empty' });
        }
    }

    // ============== Tab 5: 结构 ==============
    private renderStructureTab(container: HTMLElement): void {
        const data = this.structureData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.structure.name'), 'structure');
            return;
        }

        const timelineSection = container.createDiv({ cls: 'nw-kd-section' });
        timelineSection.createEl('div', { text: t('knowledgeDetail.structure.timeline'), cls: 'nw-kd-section-title' });

        const timelineCard = timelineSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const timelineEvents = data.timeline;
        if (timelineEvents && timelineEvents.length > 0) {
            appendSanitizedHtml(timelineCard, timelineChart(timelineEvents, { width: 650, height: 140 }));
        } else {
            timelineCard.createDiv({ text: t('knowledgeDetail.structure.noTimeline'), cls: 'nw-kd-empty' });
        }

        const threeLinesSection = container.createDiv({ cls: 'nw-kd-section' });
        threeLinesSection.createEl('div', { text: t('knowledgeDetail.structure.threeLines'), cls: 'nw-kd-section-title' });

        const threeLinesCard = threeLinesSection.createDiv({
            cls: 'nw-kd-card'
        });

        const threeLines = data.threeLines;
        if (threeLines) {
            const lineDefs = [
                { label: t('knowledgeDetail.structure.mainLine'), value: threeLines.main, tone: 'nw-kd-fill--danger' },
                { label: t('knowledgeDetail.structure.subLine'), value: threeLines.sub, tone: 'nw-kd-fill--info' },
                { label: t('knowledgeDetail.structure.romanceLine'), value: threeLines.romance, tone: 'nw-kd-fill--rose' },
            ];

            for (const line of lineDefs) {
                const row = threeLinesCard.createDiv({ cls: 'nw-kd-line' });
                const labelRow = row.createDiv({ cls: 'nw-kd-line-label' });
                labelRow.createEl('span', { text: line.label, cls: 'nw-kd-strong' });
                labelRow.createEl('span', { text: `${line.value}%`, cls: 'nw-kd-muted' });
                const barBg = row.createDiv({
                    cls: 'nw-kd-track nw-kd-track--8'
                });
                const fill = barBg.createDiv({ cls: `nw-kd-fill nw-kd-fill--smooth ${line.tone}` });
                fill.style.setProperty('--nw-kd-pct', `${line.value}%`);
            }
        } else {
            threeLinesCard.createDiv({ text: t('knowledgeDetail.structure.noThreeLines'), cls: 'nw-kd-empty' });
        }

        const rhythmSection = container.createDiv({ cls: 'nw-kd-section' });
        rhythmSection.createEl('div', { text: t('knowledgeDetail.structure.rhythmUnits'), cls: 'nw-kd-section-title' });

        const rhythmCard = rhythmSection.createDiv({
            cls: 'nw-kd-scroll nw-kd-scroll--pad'
        });

        const rhythmUnits = data.rhythmUnits;
        if (rhythmUnits && rhythmUnits.length > 0) {
            for (let i = 0; i < rhythmUnits.length; i++) {
            const unit = rhythmUnits[i];
            const key = `unit_${i}`;
            const isExpanded = this.expandedItems[key] ?? true;

            const item = rhythmCard.createDiv({
                cls: 'nw-kd-row'
            });

            const header = item.createDiv({
                cls: 'nw-kd-unit-head'
            });
            header.createEl('span', {
                text: unit.level,
                cls: 'nw-kd-level'
            });
            header.createEl('span', { text: unit.name, cls: 'nw-kd-name-flex nw-kd-strong' });
            header.createEl('span', {
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-kd-muted-xs'
            });

            header.addEventListener('click', () => {
                this.expandedItems[key] = !isExpanded;
                this.render();
            });

            if (isExpanded && unit.children) {
                const children = item.createDiv({ cls: 'nw-kd-unit-body' });
                for (const child of unit.children) {
                    children.createDiv({
                        text: child,
                        cls: 'nw-kd-unit-child'
                    });
                }
            }
        }
        } else {
            rhythmCard.createDiv({ text: t('knowledgeDetail.structure.noRhythmUnits'), cls: 'nw-kd-empty' });
        }

        const typeSection = container.createDiv({ cls: 'nw-kd-section' });
        typeSection.createEl('div', { text: t('knowledgeDetail.structure.type'), cls: 'nw-kd-section-title' });

        const typeCard = typeSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--text'
        });

        if (data.structureType) {
            typeCard.createEl('div', { text: data.structureType, cls: 'nw-kd-type-name' });
        }
        // 不能给 typeCard 赋 textContent：那会清空上面刚创建的 structureType 节点
        typeCard.createEl('div', { text: data.structureDescription || t('knowledgeDetail.structure.noType') });
    }

    // ============== Tab 6: 人设 ==============
    private renderCharacterTab(container: HTMLElement): void {
        const data = this.characterData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.character.name'), 'character');
            return;
        }

        const mainSection = container.createDiv({ cls: 'nw-kd-section' });
        mainSection.createEl('div', { text: t('knowledgeDetail.character.main'), cls: 'nw-kd-section-title' });

        const mainChars = data.mainCharacters;
        if (mainChars && mainChars.length > 0) {

        const charsGrid = mainSection.createDiv({
            cls: 'nw-kd-char-grid'
        });

        for (const char of mainChars) {
            const card = charsGrid.createDiv({
                cls: 'nw-kd-stat-card'
            });

            const avatar = card.createDiv({
                cls: 'nw-kd-avatar'
            });
            avatar.textContent = char.name.charAt(0);

            card.createEl('div', { text: char.name, cls: 'nw-kd-char-name' });
            card.createEl('div', { text: char.role, cls: 'nw-kd-char-role' });

            const tagsContainer = card.createDiv({ cls: 'nw-kd-tag-row' });
            for (const tag of char.tags) {
                tagsContainer.createEl('span', {
                    text: tag,
                    cls: 'nw-kd-tag'
                });
            }

            if (char.growth) {
                card.createEl('div', {
                    text: char.growth,
                    cls: 'nw-kd-char-growth'
                });
            }
        }
        } else {
            mainSection.createDiv({ text: t('knowledgeDetail.character.noMain'), cls: 'nw-kd-empty' });
        }

        const relationSection = container.createDiv({ cls: 'nw-kd-section' });
        relationSection.createEl('div', { text: t('knowledgeDetail.character.relations'), cls: 'nw-kd-section-title' });

        const relationCard = relationSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--center nw-kd-card--roomy'
        });
        appendSanitizedHtml(relationCard, this.renderRelationshipGraph(data.relationships || [], mainChars || []));

        const searchSection = container.createDiv({ cls: 'nw-kd-toolbar' });
        const searchInput = searchSection.createEl('input', {
            type: 'text',
            placeholder: t('knowledgeDetail.character.search'),
            cls: 'nw-kd-search'
        });
        searchInput.value = this.characterFilter;

        const allSection = container.createDiv({ cls: 'nw-kd-section' });
        allSection.createEl('div', { text: t('knowledgeDetail.character.all'), cls: 'nw-kd-section-title' });

        const allCard = allSection.createDiv({
            cls: 'nw-kd-scroll'
        });

        // 只重绘「全部人物」列表：整体 this.render() 会 empty 重建整个弹窗，
        // 搜索框随之销毁 → 每输入一个字就丢焦点，实际只能打一个字。
        const renderCharacterList = () => {
            allCard.empty();
            const allChars = data.allCharacters;
            if (!allChars || allChars.length === 0) {
                allCard.createDiv({ text: t('knowledgeDetail.character.noAll'), cls: 'nw-kd-empty' });
                return;
            }

            const filtered = allChars.filter(c =>
                c.name.toLowerCase().includes(this.characterFilter.toLowerCase()) ||
                c.role.toLowerCase().includes(this.characterFilter.toLowerCase())
            );

            if (filtered.length === 0) {
                allCard.createDiv({
                    text: t('knowledgeDetail.character.noMatch'),
                    cls: 'nw-kd-empty-mini'
                });
                return;
            }

            for (const char of filtered) {
                const item = allCard.createDiv({
                    cls: 'nw-kd-char-row', attr: {}
                });

                const miniAvatar = item.createDiv({
                    cls: 'nw-kd-avatar nw-kd-avatar--sm'
                });
                miniAvatar.textContent = char.name.charAt(0);

                const info = item.createDiv({ cls: 'nw-kd-flex-fill' });
                info.createEl('div', { text: char.name, cls: 'nw-kd-name' });
                info.createEl('div', { text: char.role, cls: 'nw-kd-faint' });

                const tags = item.createDiv({ cls: 'nw-kd-tags' });
                for (const tag of char.tags.slice(0, 2)) {
                    tags.createEl('span', {
                        text: tag,
                        cls: 'nw-kd-tag nw-kd-tag--sm'
                    });
                }
            }
        };

        searchInput.addEventListener('input', (e) => {
            this.characterFilter = (e.target as HTMLInputElement).value;
            renderCharacterList();
        });

        renderCharacterList();
    }

    private renderRelationshipGraph(relationships: Array<{ from: string; to: string; type: string }>, mainChars: Array<{ name: string }>): string {
        if (!mainChars || mainChars.length === 0) {
            return `<div class="nw-kd-empty">${t('knowledgeDetail.character.noRelations')}</div>`;
        }
        const width = 400;
        const height = 300;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = 100;

        const chars = mainChars.length > 0 ? mainChars.map(c => c.name) : [];
        const centerChar = chars[0];
        const surrounding = chars.slice(1, 5);

        let lines = '';
        let nodes = '';

        surrounding.forEach((name, i) => {
            const angle = (i / surrounding.length) * Math.PI * 2 - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            lines += `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="2"/>`;

            nodes += `
                <circle cx="${x}" cy="${y}" r="28" fill="var(--background-primary)" stroke="var(--interactive-accent)" stroke-width="2"/>
                <text x="${x}" y="${y + 4}" text-anchor="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(name.slice(0, 4))}</text>
            `;
        });

        nodes += `
            <circle cx="${centerX}" cy="${centerY}" r="38" fill="var(--interactive-accent)" stroke="var(--background-primary)" stroke-width="3"/>
            <text x="${centerX}" y="${centerY + 4}" text-anchor="middle" fill="var(--text-on-accent)" font-size="13" font-weight="600">${escapeHtml(centerChar.slice(0, 4))}</text>
        `;

        return `
            <svg class="nw-kd-graph" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                ${lines}
                ${nodes}
            </svg>
        `;
    }

    // ============== Tab 7: 伏笔 ==============
    private renderForeshadowTab(container: HTMLElement): void {
        const data = this.foreshadowData;

        if (!data) {
            this.renderEmptyState(container, t('knowledgeDetail.fs.name'), 'foreshadow');
            return;
        }

        const statsSection = container.createDiv({ cls: 'nw-kd-section' });
        statsSection.createEl('div', { text: t('knowledgeDetail.fs.stats'), cls: 'nw-kd-section-title' });

        const statsGrid = statsSection.createDiv({ cls: 'nw-kd-grid-4' });

        const stats = data.stats;
        if (stats) {
            const resolved = normalizeDetailNumber(stats.resolved);
            const unresolved = normalizeDetailNumber(stats.unresolved);
            const total = resolved + unresolved;

            const totalCard = statsGrid.createDiv({
                cls: 'nw-kd-stat-card'
            });
            totalCard.createEl('div', { text: String(total), cls: 'nw-kd-stat-num' });
            totalCard.createEl('div', { text: t('knowledgeDetail.fs.total'), cls: 'nw-kd-muted-sm' });

            const resolvedCard = statsGrid.createDiv({
                cls: 'nw-kd-stat-card'
            });
            resolvedCard.createEl('div', { text: String(resolved), cls: 'nw-kd-stat-num nw-kd-stat-num--success' });
            resolvedCard.createEl('div', { text: t('knowledgeDetail.fs.resolved'), cls: 'nw-kd-muted-sm' });

            const unresolvedCard = statsGrid.createDiv({
                cls: 'nw-kd-stat-card'
            });
            unresolvedCard.createEl('div', { text: String(unresolved), cls: 'nw-kd-stat-num nw-kd-stat-num--warning' });
            unresolvedCard.createEl('div', { text: t('knowledgeDetail.fs.unresolved'), cls: 'nw-kd-muted-sm' });

            const forgottenCount = data.unresolvedTracker?.forgottenForeshadows?.length || 0;
            const forgottenCard = statsGrid.createDiv({
                cls: 'nw-kd-stat-card'
            });
            forgottenCard.createEl('div', { text: forgottenCount.toString(), cls: 'nw-kd-stat-num nw-kd-stat-num--error' });
            forgottenCard.createEl('div', { text: t('knowledgeDetail.fs.forgotten'), cls: 'nw-kd-muted-sm' });
        } else {
            statsSection.createDiv({ text: t('knowledgeDetail.fs.noStats'), cls: 'nw-kd-empty' });
        }

        if (data.resolutionQualityStats) {
            const qualitySection = container.createDiv({ cls: 'nw-kd-section' });
            qualitySection.createEl('div', { text: t('knowledgeDetail.fs.quality'), cls: 'nw-kd-section-title' });

            const qualityCard = qualitySection.createDiv({
                cls: 'nw-kd-card'
            });

            const qualityGrid = qualityCard.createDiv({
                cls: 'nw-kd-quality-grid'
            });

            qualityGrid.createEl('div', { text: t('knowledgeDetail.fs.avgQuality'), cls: 'nw-kd-label' });
            const avgQualityBar = qualityGrid.createDiv({ cls: 'nw-kd-bar-row' });
            const avgTrack = avgQualityBar.createEl('div', {
                cls: 'nw-kd-track nw-kd-track--8 nw-kd-track--grow'
            });
            const avgFill = avgTrack.createEl('div', { cls: 'nw-kd-fill nw-kd-fill--gradient' });
            avgFill.style.setProperty('--nw-kd-pct', `${data.resolutionQualityStats.avgQuality}%`);
            avgQualityBar.createEl('span', { text: t('knowledgeDetail.common.scoreUnit', { score: data.resolutionQualityStats.avgQuality }), cls: 'nw-kd-quality-value' });

            const qd = data.resolutionQualityStats.qualityDistribution;
            const qualityBars = [
                { label: t('knowledgeDetail.fs.qExcellent'), value: qd.excellent, tone: 'nw-kd-fill--success' },
                { label: t('knowledgeDetail.fs.qGood'), value: qd.good, tone: 'nw-kd-fill--info' },
                { label: t('knowledgeDetail.fs.qFair'), value: qd.fair, tone: 'nw-kd-fill--warning' },
                { label: t('knowledgeDetail.fs.qPoor'), value: qd.poor, tone: 'nw-kd-fill--danger' },
            ];
            for (const q of qualityBars) {
                qualityGrid.createEl('div', { text: q.label, cls: 'nw-kd-muted-sm' });
                const barWrapper = qualityGrid.createDiv({ cls: 'nw-kd-bar-row' });
                const qTrack = barWrapper.createEl('div', {
                    cls: 'nw-kd-track nw-kd-track--6 nw-kd-track--grow'
                });
                const qFill = qTrack.createEl('div', { cls: `nw-kd-fill ${q.tone}` });
                qFill.style.setProperty('--nw-kd-pct', `${Math.min(100, q.value * 10)}%`);
                barWrapper.createEl('span', { text: t('knowledgeDetail.common.countUnit', { count: q.value }), cls: 'nw-kd-quality-count' });
            }
        }

        const donutSection = container.createDiv({ cls: 'nw-kd-section' });
        donutSection.createEl('div', { text: t('knowledgeDetail.fs.donut'), cls: 'nw-kd-section-title' });

        const donutCard = donutSection.createDiv({
            cls: 'nw-kd-card'
        });

        if (stats) {
            const donutData = [
                { label: t('knowledgeDetail.fs.resolved'), value: normalizeDetailNumber(stats.resolved), color: '#10b981' },
                { label: t('knowledgeDetail.fs.unresolved'), value: normalizeDetailNumber(stats.unresolved), color: '#f59e0b' },
            ];
            appendSanitizedHtml(donutCard, donutChart(donutData, { size: 220 }));
        }

        if (data.networkAnalysis?.densityByChapter) {
            const densitySection = container.createDiv({ cls: 'nw-kd-section' });
            densitySection.createEl('div', { text: t('knowledgeDetail.fs.density'), cls: 'nw-kd-section-title' });

            const densityCard = densitySection.createDiv({
                cls: 'nw-kd-card nw-kd-card--scroll'
            });

            const setupData = data.networkAnalysis.densityByChapter.map(d => ({
                label: t('knowledgeDetail.fs.segment', { chapter: d.chapter }),
                value: d.setupCount,
            }));
            const payoffData = data.networkAnalysis.densityByChapter.map(d => ({
                label: t('knowledgeDetail.fs.segment', { chapter: d.chapter }),
                value: d.payoffCount,
            }));

            appendSanitizedHtml(densityCard, lineChart([
                { name: t('knowledgeDetail.fs.setup'), data: setupData, color: '#3b82f6' },
                { name: t('knowledgeDetail.fs.payoff'), data: payoffData, color: '#10b981' },
            ], {
                width: 650,
                height: 180,
                showLegend: true
            }));
        }

        const timelineSection = container.createDiv({ cls: 'nw-kd-section' });
        timelineSection.createEl('div', { text: t('knowledgeDetail.fs.timeline'), cls: 'nw-kd-section-title' });

        const timelineCard = timelineSection.createDiv({
            cls: 'nw-kd-card nw-kd-card--scroll'
        });

        const timelineEvents = data.timeline;
        if (timelineEvents && timelineEvents.length > 0) {
            appendSanitizedHtml(timelineCard, timelineChart(timelineEvents, { width: 650, height: 160 }));
        } else {
            timelineCard.createDiv({ text: t('knowledgeDetail.fs.noTimeline'), cls: 'nw-kd-empty' });
        }

        if (data.networkAnalysis) {
            const networkSection = container.createDiv({ cls: 'nw-kd-section' });
            networkSection.createEl('div', { text: t('knowledgeDetail.fs.network'), cls: 'nw-kd-section-title' });

            const networkCard = networkSection.createDiv({
                cls: 'nw-kd-card'
            });

            const netGrid = networkCard.createDiv({
                cls: 'nw-kd-net-grid'
            });

            const mainlineCount = data.networkAnalysis.mainlineCount || 0;
            const sidelineCount = data.networkAnalysis.sidelineCount || 0;
            const rhythmBalance = data.networkAnalysis.rhythmBalance;

            const netItem1 = netGrid.createDiv({ cls: 'nw-kd-center' });
            netItem1.createEl('div', { text: mainlineCount.toString(), cls: 'nw-kd-net-num nw-kd-net-num--accent' });
            netItem1.createEl('div', { text: t('knowledgeDetail.fs.mainNet'), cls: 'nw-kd-faint' });

            const netItem2 = netGrid.createDiv({ cls: 'nw-kd-center' });
            netItem2.createEl('div', { text: sidelineCount.toString(), cls: 'nw-kd-net-num nw-kd-net-num--muted' });
            netItem2.createEl('div', { text: t('knowledgeDetail.fs.subNet'), cls: 'nw-kd-faint' });

            if (rhythmBalance) {
                const rhythmDiv = networkCard.createDiv({ cls: 'nw-kd-balance' });
                rhythmDiv.createEl('div', {
                    text: t('knowledgeDetail.fs.balance', { score: rhythmBalance.balanceScore, state: rhythmBalance.isBalanced ? t('knowledgeDetail.fs.balanced') : t('knowledgeDetail.fs.unbalanced') }),
                    cls: 'nw-kd-balance-note'
                });
                const balanceTrack = rhythmDiv.createEl('div', { cls: 'nw-kd-track nw-kd-track--6' });
                const balanceFill = balanceTrack.createEl('div', {
                    cls: `nw-kd-fill ${rhythmBalance.isBalanced ? 'nw-kd-fill--success' : 'nw-kd-fill--warning'}`
                });
                balanceFill.style.setProperty('--nw-kd-pct', `${rhythmBalance.balanceScore}%`);
            }
        }

        if (data.pairs && data.pairs.length > 0) {
            const pairSection = container.createDiv({ cls: 'nw-kd-section' });
            pairSection.createEl('div', { text: t('knowledgeDetail.fs.pairs'), cls: 'nw-kd-section-title' });

            const pairCard = pairSection.createDiv({
                cls: 'nw-kd-scroll'
            });

            const pairTypeLabels: Record<string, string> = {
                'one-to-one': t('knowledgeDetail.fs.pairOneToOne'),
                'one-to-many': t('knowledgeDetail.fs.pairOneToMany'),
                'many-to-one': t('knowledgeDetail.fs.pairManyToOne')
            };

            for (const pair of data.pairs.slice(0, 15)) {
                const key = `pair_${pair.id}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const row = pairCard.createDiv({
                    cls: 'nw-kd-row'
                });

                const header = row.createDiv({
                    cls: 'nw-kd-item-head'
                });

                const confidenceTone = pair.confidence >= 70 ? 'high' : pair.confidence >= 50 ? 'mid' : 'low';
                header.createEl('span', {
                    text: `${pair.confidence}%`,
                    cls: `nw-kd-confidence nw-kd-confidence--${confidenceTone}`,
                });

                const info = header.createDiv({ cls: 'nw-kd-flex-fill' });
                info.createEl('div', {
                    text: `${pair.setupForeshadowName} → ${pair.payoffForeshadowName || t('knowledgeDetail.common.unknown')}`,
                    cls: 'nw-kd-pair-title'
                });
                info.createEl('div', {
                    text: pair.qualityScore
                        ? t('knowledgeDetail.fs.pairQuality', { type: pairTypeLabels[pair.pairType] || pair.pairType, score: pair.qualityScore })
                        : (pairTypeLabels[pair.pairType] || pair.pairType),
                    cls: 'nw-kd-pair-meta'
                });

                header.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-kd-muted-10'
                });

                header.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded && pair.matchDimensions) {
                    const body = row.createDiv({
                        cls: 'nw-kd-pair-body'
                    });

                    const dims = [
                        { label: t('knowledgeDetail.fs.dimEntity'), value: pair.matchDimensions.entityMatch },
                        { label: t('knowledgeDetail.fs.dimSemantic'), value: pair.matchDimensions.semanticMatch },
                        { label: t('knowledgeDetail.fs.dimTemporal'), value: pair.matchDimensions.temporalMatch },
                        { label: t('knowledgeDetail.fs.dimType'), value: pair.matchDimensions.typeMatch },
                    ];

                    for (const dim of dims) {
                        const dimRow = body.createDiv({ cls: 'nw-kd-bar-row' });
                        dimRow.createEl('span', { text: dim.label, cls: 'nw-kd-dim-label' });
                        const bar = dimRow.createEl('div', {
                            cls: 'nw-kd-track nw-kd-track--4 nw-kd-track--grow'
                        });
                        const dimFill = bar.createEl('div', { cls: 'nw-kd-fill' });
                        dimFill.style.setProperty('--nw-kd-pct', `${dim.value}%`);
                        dimRow.createEl('span', { text: `${dim.value}%`, cls: 'nw-kd-dim-value' });
                    }
                }
            }
        }

        if (data.unresolvedTracker && data.unresolvedTracker.totalUnresolved > 0) {
            const unresolvedSection = container.createDiv({ cls: 'nw-kd-section' });
            unresolvedSection.createEl('div', { text: t('knowledgeDetail.fs.unresolvedTitle'), cls: 'nw-kd-section-title' });

            const unresolvedCard = unresolvedSection.createDiv({
                cls: 'nw-kd-card'
            });

            if (data.unresolvedTracker.forgottenForeshadows && data.unresolvedTracker.forgottenForeshadows.length > 0) {
                const warnDiv = unresolvedCard.createDiv({
                    cls: 'nw-kd-warn'
                });
                warnDiv.createEl('div', {
                    text: t('knowledgeDetail.fs.forgottenWarning', { count: data.unresolvedTracker.forgottenForeshadows.length }),
                    cls: 'nw-kd-warn-title'
                });
                const names = data.unresolvedTracker.forgottenForeshadows.slice(0, 3).map(f => f.name).join('、');
                warnDiv.createEl('div', {
                    text: names + (data.unresolvedTracker.forgottenForeshadows.length > 3 ? '...' : ''),
                    cls: 'nw-kd-warn-names'
                });
            }

            if (data.unresolvedTracker.recallSuggestions && data.unresolvedTracker.recallSuggestions.length > 0) {
                unresolvedCard.createEl('div', { text: t('knowledgeDetail.fs.suggestions'), cls: 'nw-kd-suggest-title' });
                for (const s of data.unresolvedTracker.recallSuggestions.slice(0, 3)) {
                    const sDiv = unresolvedCard.createDiv({
                        cls: 'nw-kd-suggest'
                    });
                    sDiv.createEl('div', {
                        text: t('knowledgeDetail.fs.suggestLine', { chapter: s.chapter, reason: s.reason }),
                        cls: 'nw-kd-suggest-head'
                    });
                    sDiv.createEl('div', {
                        text: s.foreshadows.join(t('knowledgeDetail.common.listSep')),
                        cls: 'nw-kd-muted-xs'
                    });
                }
            }
        }

        const filterSection = container.createDiv({ cls: 'nw-kd-filter' });
        const categories = ['all', '物品', '功法', '人物', '设定', '事件'];
        const categoryLabels: Record<string, string> = {
            all: t('knowledgeDetail.fs.catAll'),
            '物品': t('knowledgeDetail.fs.catItem'),
            '功法': t('knowledgeDetail.fs.catSkill'),
            '人物': t('knowledgeDetail.fs.catPerson'),
            '设定': t('knowledgeDetail.fs.catSetting'),
            '事件': t('knowledgeDetail.fs.catEvent'),
        };

        for (const cat of categories) {
            const btn = filterSection.createEl('button', {
                text: categoryLabels[cat],
                attr: { type: 'button' },
                cls: `nw-kd-filter-btn${this.foreshadowFilter === cat ? ' nw-kd-filter-btn--active' : ''}`,
            });
            btn.addEventListener('click', () => {
                this.foreshadowFilter = cat;
                this.render();
            });
        }

        const listSection = container.createDiv({ cls: 'nw-kd-section' });
        listSection.createEl('div', { text: t('knowledgeDetail.fs.details'), cls: 'nw-kd-section-title' });

        const items = data.items;
        if (items && items.length > 0) {

        const filtered = this.foreshadowFilter === 'all' ? items : items.filter(i => i.category === this.foreshadowFilter);

        const listCard = listSection.createDiv({
            cls: 'nw-kd-scroll nw-kd-scroll--tall'
        });

        if (filtered.length === 0) {
            listCard.createDiv({
                text: t('knowledgeDetail.fs.emptyCategory'),
                cls: 'nw-kd-empty-mini'
            });
        } else {
            for (const item of filtered) {
                const key = `foreshadow_${item.id}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const row = listCard.createDiv({
                    cls: 'nw-kd-row'
                });

                const header = row.createDiv({
                    cls: 'nw-kd-item-head nw-kd-item-head--main'
                });

                header.createEl('span', {
                    text: item.resolved ? '✓' : '○',
                    cls: item.resolved ? 'nw-kd-status nw-kd-status--resolved' : 'nw-kd-status',
                });

                const info = header.createDiv({ cls: 'nw-kd-flex-fill' });
                info.createEl('div', { text: item.name, cls: 'nw-kd-name' });
                info.createEl('div', {
                    text: t('knowledgeDetail.fs.itemMeta', { category: foreshadowCategoryLabel(item.category), chapter: item.firstAppearance }),
                    cls: 'nw-kd-meta'
                });

                header.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-kd-muted-10'
                });

                header.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded) {
                    const body = row.createDiv({
                        cls: 'nw-kd-item-body'
                    });

                    body.createEl('div', { text: t('knowledgeDetail.fs.firstAppearance'), cls: 'nw-kd-field-title' });
                    body.createEl('div', { text: item.firstAppearance, cls: 'nw-kd-body-text' });

                    body.createEl('div', { text: t('knowledgeDetail.fs.echo'), cls: 'nw-kd-field-title' });
                    for (const echo of item.echoes) {
                        body.createDiv({ text: `• ${echo}`, cls: 'nw-kd-body-echo' });
                    }

                    body.createEl('div', {
                        text: t('knowledgeDetail.fs.payoffState'),
                        cls: 'nw-kd-field-title nw-kd-field-title--mt'
                    });
                    if (item.resolved) {
                        body.createEl('div', {
                            text: t('knowledgeDetail.fs.resolvedLine', { detail: item.resolution || t('knowledgeDetail.fs.resolved') }),
                            cls: 'nw-kd-state nw-kd-state--resolved'
                        });
                    } else {
                        body.createEl('div', {
                            text: t('knowledgeDetail.fs.unresolved'),
                            cls: 'nw-kd-state nw-kd-state--pending'
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: t('knowledgeDetail.fs.noDetails'), cls: 'nw-kd-empty' });
        }
    }

    // ============== 通用方法 ==============
    private renderEmptyState(container: HTMLElement, dataName: string, dimension: string): void {
        const card = container.createDiv({
            cls: 'nw-kd-empty-card'
        });
        card.createEl('div', { text: '📭', cls: 'nw-kd-empty-icon' });
        card.createEl('div', { text: t('knowledgeDetail.empty.title', { name: dataName }), cls: 'nw-kd-empty-title' });
        card.createEl('div', {
            text: t('knowledgeDetail.empty.desc'),
            cls: 'nw-kd-muted-sm'
        });

        const btn = card.createEl('button', {
            text: t('knowledgeDetail.empty.start'),
            attr: { type: 'button' },
            cls: 'nw-kd-start-btn',
        });
        btn.addEventListener('click', async () => {
            if (this.deconstructionScheduler) {
                try {
                    await this.deconstructionScheduler.rerunBook(this.bookId);
                    new Notice(t('knowledgeDetail.empty.started'));
                    this.close();
                    new KnowledgeMonitorModal(this.app, this.deconstructionScheduler, this.knowledgeManager).open();
                } catch (e) {
                    // 源文本缺失/调度器拒绝时旧实现照样提示「已开始」并关窗
                    log.error('[KnowledgeDetailModal] 启动拆解失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgeDetail.empty.startFailed') });
                }
            } else {
                new Notice(t('knowledgeDetail.empty.useMonitor'));
            }
        });
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-kd-info-row' });
        row.createEl('span', { text: `${label}:`, cls: 'nw-kd-info-label' });
        row.createEl('span', { text: value, cls: 'nw-kd-info-value' });
    }

    private formatWordCount(count: number): string {
        return formatWordCountText(count);
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

    private getStatusText(status: string): string {
        const map: Record<string, string> = {
            pending: t('knowledgeDetail.status.pending'),
            processing: t('knowledgeDetail.status.processing'),
            completed: t('knowledgeDetail.status.completed'),
            failed: t('knowledgeDetail.status.failed'),
        };
        return map[status] || status;
    }

    /** A5: 向量状态与拆解状态分开显示，失败原因直接挂在值里 */
    private getVectorStatusText(status?: string, error?: string): string {
        if (status === 'failed') return `${t('knowledgeDetail.vector.failed')}${error ? t('knowledgeDetail.vector.failedDetail', { error }) : ''}`;
        if (status === 'done') return t('knowledgeDetail.vector.done');
        if (status === 'pending') return t('knowledgeDetail.vector.pending');
        return t('knowledgeDetail.vector.none');
    }

    /** 详情页与「重新拆解」共用同一个调度器实例；缺依赖时提示并返回 null */
    private ensureScheduler(): DeconstructionScheduler | null {
        if (this.deconstructionScheduler) return this.deconstructionScheduler;
        try {
            const plugin = this.plugin;
            if (!plugin) {
                new Notice(t('knowledgeDetail.empty.noScheduler'));
                return null;
            }
            const embeddingProvider = EmbeddingProviderFactory.fromSettings(plugin.settings);
            const vectorEnhancer = new VectorEnhancer(embeddingProvider);
            this.deconstructionScheduler = new DeconstructionScheduler(
                this.app,
                this.knowledgeManager,
                undefined,
                undefined,
                vectorEnhancer,
                () => plugin.settings || {}
            );
            return this.deconstructionScheduler;
        } catch (e) {
            log.warn('[KnowledgeDetailModal] 创建 deconstructionScheduler 失败:', e);
            new Notice(t('knowledgeDetail.empty.noScheduler'));
            return null;
        }
    }
}
