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
import { normalizeDetailNumber } from './knowledge-detail-format';
import { openKnowledgeFolder } from './knowledge-folder-navigation';
import { escapeHtml } from '@/utils/helpers';
import type NovelWriterPlugin from '@/main';


const log = createLogger('KnowledgeDetailModal');
type TabKey = 'overview' | 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow';

const TAB_LABELS: Record<TabKey, string> = {
    overview: '概览',
    style: '风格',
    rhythm: '节奏',
    technique: '技巧',
    structure: '结构',
    character: '人设',
    foreshadow: '伏笔',
};

const DIMENSION_LABELS = ['风格', '节奏', '技巧', '结构', '人设', '伏笔'];

const STYLE_DIMENSIONS = [
    '句式节奏', '用词偏好', '叙事特点', '修辞手法', '对话风格', '段落结构', '整体文风'
];

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
        options?: { baseDir?: string; deconstructionScheduler?: DeconstructionScheduler }
    ) {
        super(app);
        this.bookId = bookId;
        this.knowledgeManager = knowledgeManager;
        this.deconstructionScheduler = options?.deconstructionScheduler;
        this.baseDir = options?.baseDir;
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
            contentEl.createDiv({ text: '书籍不存在或已被删除', cls: 'nw-u-p-40px nw-u-ta-center nw-u-c-text-muted' });
            return;
        }

        this.renderHeader(contentEl);
        this.renderTabs(contentEl);
        this.renderTabContent(contentEl);
    }

    private getPlugin(): NovelWriterPlugin | null {
        try {
            const plugin = this.app.plugins?.getPlugin('novel-writer-ai');
            if (plugin) return plugin as NovelWriterPlugin;
        } catch {
        }
        return null;
    }

    private isReferenceBook(): boolean {
        const plugin = this.getPlugin();
        if (!plugin || !Array.isArray(plugin.referenceBookIds)) return false;
        return plugin.referenceBookIds.includes(this.bookId);
    }

    private toggleReferenceBook(): void {
        const plugin = this.getPlugin();
        if (!plugin) return;

        const bookName = this.bookInfo?.name || '未知书籍';
        const isRef = this.isReferenceBook();

        if (!Array.isArray(plugin.referenceBookIds)) {
            plugin.referenceBookIds = [];
        }

        if (isRef) {
            plugin.referenceBookIds = plugin.referenceBookIds.filter((id: string) => id !== this.bookId);
            showSuccessNotice(`已取消《${bookName}》的参考`);
        } else {
            if (!plugin.referenceBookIds.includes(this.bookId)) {
                plugin.referenceBookIds.push(this.bookId);
            }
            showSuccessNotice(`已添加《${bookName}》为参考书籍`);
        }

        // 只改内存镜像的话重启就回退：必须同时写 settings 并落盘
        plugin.settings.referenceBookIds = [...plugin.referenceBookIds];
        void plugin.saveSettings().catch((e: unknown) => {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '参考书籍保存失败', timeout: 6000 });
        });

        this.render();
    }

    private async onConvertToFingerprint(buttonEl: HTMLButtonElement): Promise<void> {
        try {
            if (!this.bookInfo) {
                new Notice('书籍信息不存在');
                return;
            }

            const stylePath = kbBookStyleFingerprintFile(this.bookInfo.name, this.baseDir);
            const adapter = this.app.vault.adapter as { exists(p: string): Promise<boolean> };
            const exists = await adapter.exists(stylePath);
            if (!exists) {
                new Notice('风格维度拆解缺失，无法转换指纹，请先完成风格维度拆解');
                return;
            }

            const converter = new KnowledgeToFingerprintConverter(this.app);
            const fingerprint = await converter.convert(this.bookId, this.bookInfo.name, this.baseDir);

            const plugin = this.getPlugin();
            // settings 上没有 activeProject 字段；唯一真源是 getActiveProject()（活动文件 / 工作台上下文）
            const activeProject = plugin?.getActiveProject();
            if (!activeProject) {
                new Notice('请先打开一个项目');
                return;
            }

            const library = StyleFingerprintLibrary.get(this.app, activeProject);
            await library.addFromKnowledge(fingerprint);

            showSuccessNotice(`已将《${this.bookInfo.name}》拆解结果转为项目写作指纹`);
            buttonEl.setText('✅ 已转为指纹');
            buttonEl.disabled = true;
        } catch (e) {
            log.error('[KnowledgeDetailModal] 转换指纹失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '转换失败' });
        }
    }


    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'nw-u-marginbottom-16px nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-gap-12px' });
        
        const titleWrap = header.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-12px nw-u-flex-1 nw-u-minw-0' });
        titleWrap.createEl('h3', { text: `📚 ${this.bookInfo!.name}`, cls: 'nw-u-m-0 nw-u-fsh-0' });

        const isRef = this.isReferenceBook();
        const refBtn = titleWrap.createEl('button', {
            text: isRef ? '⭐ 取消参考' : '⭐ 设为参考书籍',
            attr: {
                type: 'button',
                style: `
                    padding:6px 14px;
                    cursor:pointer;
                    border:1px solid ${isRef ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                    border-radius:6px;
                    font-size:12px;
                    background:${isRef ? 'var(--interactive-accent)' : 'transparent'};
                    color:${isRef ? 'var(--text-on-accent)' : 'var(--text-muted)'};
                    flex-shrink:0;
                `
            }
        });
        refBtn.addEventListener('click', () => this.toggleReferenceBook());

        const closeBtn = header.createEl('button', {
            text: '✕',
            attr: {
                type: 'button',
                style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:transparent;font-size:14px;flex-shrink:0;'
            }
        });
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderTabs(container: HTMLElement): void {
        const tabsContainer = container.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-2px nw-u-bb-1px-solid-background-m nw-u-marginbottom-16px nw-u-ovx-auto'
        });

        const tabKeys: TabKey[] = ['overview', 'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];
        for (const key of tabKeys) {
            const tab = tabsContainer.createEl('button', {
                text: TAB_LABELS[key],
                attr: {
                    type: 'button',
                    style: `
                        padding:8px 16px;
                        cursor:pointer;
                        border:none;
                        background:transparent;
                        font-size:13px;
                        white-space:nowrap;
                        border-bottom:2px solid ${this.activeTab === key ? 'var(--interactive-accent)' : 'transparent'};
                        color: ${this.activeTab === key ? 'var(--interactive-accent)' : 'var(--text-muted)'};
                        font-weight: ${this.activeTab === key ? '600' : '400'};
                    `
                }
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
            cls: 'nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px nw-u-marginbottom-16px'
        });
        infoCard.createEl('div', { text: '基本信息', cls: 'nw-section-heading' });

        const grid = infoCard.createDiv({ cls: 'nw-u-d-grid nw-u-gtc-1fr-1fr nw-u-gap-10px-20px nw-u-fs-13px' });
        this.renderInfoRow(grid, '书名', book.name);
        this.renderInfoRow(grid, '作者', book.author || '未知');
        this.renderInfoRow(grid, '题材标签', book.themeTags.length ? book.themeTags.join('、') : '暂无');
        this.renderInfoRow(grid, '字数', book.wordCount ? this.formatWordCount(book.wordCount) : '未知');
        this.renderInfoRow(grid, '更新时间', this.formatDateTime(book.updatedAt));
        this.renderInfoRow(grid, '拆解状态', this.getStatusText(book.breakdownStatus));
        this.renderInfoRow(grid, '向量状态', this.getVectorStatusText(book.vectorStatus, book.vectorError));

        const chartSection = container.createDiv({ cls: 'nw-mb-lg' });
        chartSection.createEl('div', { text: '拆解完成度', cls: 'nw-section-heading' });

        const donutData = DIMENSION_LABELS.map((label, i) => ({
            label,
            value: this.getDimensionProgress(i),
            color: ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'][i]
        }));

        const donutCard = chartSection.createDiv({
            cls: 'nw-card-lg'
        });
        appendSanitizedHtml(donutCard, donutChart(donutData, { size: 300 }));

        const actionsSection = container.createDiv({ cls: 'nw-mb-lg' });
        actionsSection.createEl('div', { text: '快速操作', cls: 'nw-section-heading' });

        const btnRow = actionsSection.createDiv({ cls: 'nw-flex-gap10-wrap' });

        const reanalyzeBtn = btnRow.createEl('button', {
            text: '🔄 重新拆解',
            attr: { type: 'button' },
            cls: 'nw-btn-outline',
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
            text: '🎨 转为写作指纹',
            attr: { type: 'button' },
            cls: 'nw-btn-outline',
        });
        convertFingerprintBtn.addEventListener('click', () => this.onConvertToFingerprint(convertFingerprintBtn));

        // A5: 向量化失败时给出唯一可恢复入口，复用 revectorizeBook，不必重新拆解
        if (book.vectorStatus === 'failed') {
            const retryVectorBtn = btnRow.createEl('button', {
                text: '🧠 重试向量化',
                attr: { type: 'button', title: book.vectorError || '按当前 embedding 模型重新生成向量' },
                cls: 'nw-btn-outline',
            });
            retryVectorBtn.addEventListener('click', async () => {
                const scheduler = this.ensureScheduler();
                if (!scheduler) return;
                retryVectorBtn.disabled = true;
                retryVectorBtn.textContent = '⏳ 向量化中…';
                try {
                    await scheduler.revectorizeBook(book.id, book.name);
                    showSuccessNotice(`《${book.name}》重向量化完成`);
                    this.bookInfo = (await this.knowledgeManager.getBook(this.bookId)) ?? this.bookInfo;
                    this.render();
                } catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    showErrorNotice(message, { title: `《${book.name}》重向量化失败`, timeout: 8000 });
                    retryVectorBtn.disabled = false;
                    retryVectorBtn.textContent = '🧠 重试向量化';
                }
            });
        }

        const openFolderBtn = btnRow.createEl('button', {
            text: '📁 打开文件夹',
            attr: { type: 'button' },
            cls: 'nw-btn-outline',
        });
        openFolderBtn.addEventListener('click', () => {
            const dir = kbBookDir(book.name, this.baseDir);
            const file = this.app.vault.getAbstractFileByPath(dir);
            if (file) void openKnowledgeFolder(this.app, dir);
        });

        const deleteBtn = btnRow.createEl('button', {
            text: '🗑 删除',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;border:1px solid var(--background-modifier-error);border-radius:6px;font-size:13px;color:var(--text-error);background:transparent;'
            }
        });
        deleteBtn.addEventListener('click', async () => {
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
                await this.deconstructionScheduler?.cancelByBook(this.bookId);
                await this.knowledgeManager.deleteBook(this.bookId);
                showSuccessNotice('书籍已删除');
                this.close();
            } catch (e) {
                log.error('[KnowledgeDetailModal] 删除书籍失败:', e);
                showErrorNotice(e instanceof Error ? e.message : String(e), { title: '删除失败' });
            }
        });

        const descSection = container.createDiv({
            cls: 'nw-u-p-12px nw-u-bg-background-secondary-a nw-u-brd-6px nw-u-fs-12px nw-u-c-text-muted nw-u-lh-1-6'
        });
        descSection.textContent = book.synopsis || '暂无书籍简介。点击各 Tab 查看详细拆解数据。';
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
            this.renderEmptyState(container, '风格分析数据', 'style');
            return;
        }

        const radarSection = container.createDiv({ cls: 'nw-mb-lg' });
        radarSection.createEl('div', { text: '风格维度雷达图', cls: 'nw-section-heading' });

        const radarCard = radarSection.createDiv({
            cls: 'nw-p-16-bg2-br8-center'
        });

        const radarData = STYLE_DIMENSIONS.map(label => ({
            label,
            value: this.estimateFeatureScore(data.features?.[label] || '')
        }));
        appendSanitizedHtml(radarCard, radarChart(radarData, { size: 320 }));

        const statsSection = container.createDiv({ cls: 'nw-mb-lg' });
        statsSection.createEl('div', { text: '统计数据', cls: 'nw-section-heading' });

        const statsGrid = statsSection.createDiv({ cls: 'nw-grid-4' });
        const statItems = [
            { label: '平均句长', value: data.avgSentenceLength ? `${data.avgSentenceLength} 字` : '待分析' },
            { label: '平均段长', value: data.avgParagraphLength ? `${data.avgParagraphLength} 字` : '待分析' },
            { label: '对话占比', value: data.dialogueRatio !== undefined ? `${Math.round(data.dialogueRatio * 100)}%` : '待分析' },
            { label: '描写占比', value: data.descriptionRatio !== undefined ? `${Math.round(data.descriptionRatio * 100)}%` : '待分析' },
        ];
        for (const stat of statItems) {
            const card = statsGrid.createDiv({
                cls: 'nw-p-12-bg2-br6-center'
            });
            card.createEl('div', { text: stat.value, cls: 'nw-stat-md' });
            card.createEl('div', { text: stat.label, cls: 'nw-text-sm-muted' });
        }

        const descSection = container.createDiv({ cls: 'nw-mb-lg' });
        descSection.createEl('div', { text: '风格特征描述', cls: 'nw-section-heading' });

        const descCard = descSection.createDiv({
            cls: 'nw-card-lg-text'
        });

        if (data.description) {
            descCard.textContent = data.description;
        } else {
            const featureTexts = Object.entries(data.features || {});
            if (featureTexts.length > 0) {
                for (const [key, value] of featureTexts) {
                    const item = descCard.createDiv({ cls: 'nw-mb-sm' });
                    item.createEl('span', { text: `${key}：`, cls: 'nw-font-medium' });
                    item.createEl('span', { text: value || '暂无数据', cls: 'nw-color-muted' });
                }
            } else {
                descCard.createDiv({ text: '暂无详细风格特征描述', cls: 'nw-color-muted' });
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
            this.renderEmptyState(container, '节奏分析数据', 'rhythm');
            return;
        }

        const curveSection = container.createDiv({ cls: 'nw-mb-lg' });
        curveSection.createEl('div', { text: '情绪强度曲线', cls: 'nw-section-heading' });

        const curveCard = curveSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const curveData = data.emotionCurve;
        if (curveData && curveData.length > 0) {
            const series = [
                { name: '情绪强度', data: curveData.map(d => ({ label: d.label, value: d.emotion })), color: '#ef4444', smooth: true },
                { name: '事件密度', data: curveData.map(d => ({ label: d.label, value: d.density })), color: '#3b82f6', smooth: true },
                { name: '综合节奏', data: curveData.map(d => ({ label: d.label, value: d.overall })), color: '#10b981', smooth: true },
            ];
            appendSanitizedHtml(curveCard, lineChart(series, { width: 600, height: 280 }));
        } else {
            curveCard.createDiv({ text: '暂无情绪曲线数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const scatterSection = container.createDiv({ cls: 'nw-mb-lg' });
        scatterSection.createEl('div', { text: '爽点分布', cls: 'nw-section-heading' });

        const scatterCard = scatterSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const scatterPoints = data.coolPoints;
        if (scatterPoints && scatterPoints.length > 0) {
            appendSanitizedHtml(scatterCard, scatterChart(scatterPoints, { width: 600, height: 250, xAxisLabel: '章节进度', yAxisLabel: '爽感强度' }));
        } else {
            scatterCard.createDiv({ text: '暂无爽点数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const structureSection = container.createDiv({ cls: 'nw-mb-lg' });
        structureSection.createEl('div', { text: '结构理论匹配度', cls: 'nw-section-heading' });

        const structureCard = structureSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const matchData = data.structureMatches;
        if (matchData && matchData.length > 0) {
            appendSanitizedHtml(structureCard, barChart(matchData, { width: 500, height: 220, horizontal: true }));
        } else {
            structureCard.createDiv({ text: '暂无结构匹配数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const keyPointsSection = container.createDiv({ cls: 'nw-mb-lg' });
        keyPointsSection.createEl('div', { text: '关键情绪点', cls: 'nw-section-heading' });

        const keyPointsCard = keyPointsSection.createDiv({
            cls: 'nw-p-12-bg2-br8'
        });

        const keyPoints = data.keyEmotionPoints;
        if (keyPoints && keyPoints.length > 0) {
            for (const point of keyPoints) {
                const item = keyPointsCard.createDiv({
                    cls: 'nw-u-d-flex nw-u-gap-12px nw-u-p-8px-0 nw-u-bb-1px-solid-background-m'
                });
                item.createEl('span', { text: point.position, cls: 'nw-text-accent-13' });
                item.createEl('span', { text: point.description, cls: 'nw-text-13-normal-flex' });
            }
        } else {
            keyPointsCard.createDiv({ text: '暂无关键情绪点数据', cls: 'nw-u-p-10px nw-u-ta-center nw-u-c-text-muted' });
        }
    }



    // ============== Tab 4: 技巧 ==============
    private renderTechniqueTab(container: HTMLElement): void {
        const data = this.techniqueData;

        if (!data) {
            this.renderEmptyState(container, '写作技巧数据', 'technique');
            return;
        }

        const categorySection = container.createDiv({ cls: 'nw-mb-lg' });
        categorySection.createEl('div', { text: '技巧分类分布', cls: 'nw-section-heading' });

        const categoryCard = categorySection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const categories = data.categories;
        if (categories && Object.keys(categories).length > 0) {
            const barData = Object.entries(categories).map(([label, value]) => ({ label, value }));
            appendSanitizedHtml(categoryCard, barChart(barData, { width: 500, height: 220 }));
        } else {
            categoryCard.createDiv({ text: '暂无技巧分类数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const top10Section = container.createDiv({ cls: 'nw-mb-lg' });
        top10Section.createEl('div', { text: 'Top 10 技巧排行', cls: 'nw-section-heading' });

        const top10Card = top10Section.createDiv({
            cls: 'nw-p-12-16-bg2-br8'
        });

        const top10 = data.top10;
        if (top10 && top10.length > 0) {
            for (let i = 0; i < top10.length; i++) {
                const item = top10Card.createDiv({
                    cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-12px nw-u-p-6px-0 nw-u-bb-1px-solid-background-m'
                });
                const rank = item.createEl('span', {
                    text: `${i + 1}`,
                    attr: {
                        style: `
                            width:24px;
                            height:24px;
                            border-radius:50%;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            font-size:12px;
                            font-weight:600;
                            ${i < 3 ? 'background:var(--interactive-accent);color:var(--text-on-accent);' : 'background:var(--background-primary);color:var(--text-muted);'}
                        `
                    }
                });
                item.createEl('span', { text: top10[i].name, cls: 'nw-text-13-flex' });
                item.createEl('span', { text: `${top10[i].count} 次`, cls: 'nw-text-12-muted' });
            }
        } else {
            top10Card.createDiv({ text: '暂无技巧排行数据', cls: 'nw-u-p-10px nw-u-ta-center nw-u-c-text-muted' });
        }

        const listSection = container.createDiv({ cls: 'nw-mb-lg' });
        listSection.createEl('div', { text: '技巧详情', cls: 'nw-section-heading' });

        const techniques = data.techniques;
        if (techniques && techniques.length > 0) {

        const categoryGroups: Record<string, typeof techniques> = {};
        for (const tech of techniques) {
            if (!categoryGroups[tech.category]) categoryGroups[tech.category] = [];
            categoryGroups[tech.category].push(tech);
        }

        for (const [category, items] of Object.entries(categoryGroups)) {
            const group = listSection.createDiv({
                cls: 'nw-u-marginbottom-12px nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-ov-hidden'
            });

            const header = group.createDiv({
                cls: 'nw-u-p-10px-14px-2 nw-u-bg-background-secondary-2 nw-u-fwt-500-2 nw-u-fs-13px-2'
            });
            header.textContent = category;

            const list = group.createDiv({ cls: 'nw-py-4' });
            for (const tech of items) {
                const key = `tech_${tech.name}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const item = list.createDiv({
                    cls: 'nw-item-border-b'
                });

                const itemHeader = item.createDiv({
                    cls: 'nw-u-p-8px-14px nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-cur-pointer-2'
                });
                itemHeader.createEl('span', { text: tech.name, cls: 'nw-u-fs-13px-2' });
                itemHeader.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-text-xs-muted'
                });

                itemHeader.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded) {
                    const body = item.createDiv({
                        cls: 'nw-u-p-0-14px-12px nw-u-fs-12px-2 nw-u-lh-1-6-2 nw-u-c-text-muted-2'
                    });
                    body.createEl('div', { text: '示例片段：', cls: 'nw-u-fwt-500-2 nw-u-marginbottom-6px-2 nw-u-c-text-normal-2' });
                    for (const example of tech.examples) {
                        body.createDiv({
                            text: `• ${example}`,
                            cls: 'nw-u-p-4px-0-2 nw-u-paddingleft-8px'
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: '暂无技巧详情数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }
    }

    // ============== Tab 5: 结构 ==============
    private renderStructureTab(container: HTMLElement): void {
        const data = this.structureData;

        if (!data) {
            this.renderEmptyState(container, '结构拆解数据', 'structure');
            return;
        }

        const timelineSection = container.createDiv({ cls: 'nw-mb-lg' });
        timelineSection.createEl('div', { text: '起承转合时间线', cls: 'nw-section-heading' });

        const timelineCard = timelineSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const timelineEvents = data.timeline;
        if (timelineEvents && timelineEvents.length > 0) {
            appendSanitizedHtml(timelineCard, timelineChart(timelineEvents, { width: 650, height: 140 }));
        } else {
            timelineCard.createDiv({ text: '暂无起承转合数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const threeLinesSection = container.createDiv({ cls: 'nw-mb-lg' });
        threeLinesSection.createEl('div', { text: '三线并行示意', cls: 'nw-section-heading' });

        const threeLinesCard = threeLinesSection.createDiv({
            cls: 'nw-card-lg'
        });

        const threeLines = data.threeLines;
        if (threeLines) {
            const lineDefs = [
                { label: '主线', value: threeLines.main, color: '#ef4444' },
                { label: '副线', value: threeLines.sub, color: '#3b82f6' },
                { label: '感情线', value: threeLines.romance, color: '#ec4899' },
            ];

            for (const line of lineDefs) {
                const row = threeLinesCard.createDiv({ attr: { style: 'margin-bottom:12px;&:last-child { margin-bottom:0; }' } });
                const labelRow = row.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-marginbottom-6px-2 nw-u-fs-12px-2' });
                labelRow.createEl('span', { text: line.label, cls: 'nw-font-medium' });
                labelRow.createEl('span', { text: `${line.value}%`, cls: 'nw-color-muted' });
                const barBg = row.createDiv({
                    cls: 'nw-bar-track-8'
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${line.value}%;background:${line.color};border-radius:4px;transition:width 0.3s;`
                    }
                });
            }
        } else {
            threeLinesCard.createDiv({ text: '暂无三线并行数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const rhythmSection = container.createDiv({ cls: 'nw-mb-lg' });
        rhythmSection.createEl('div', { text: '节奏单元', cls: 'nw-section-heading' });

        const rhythmCard = rhythmSection.createDiv({
            cls: 'nw-scroll-card-300 nw-py-4'
        });

        const rhythmUnits = data.rhythmUnits;
        if (rhythmUnits && rhythmUnits.length > 0) {
            for (let i = 0; i < rhythmUnits.length; i++) {
            const unit = rhythmUnits[i];
            const key = `unit_${i}`;
            const isExpanded = this.expandedItems[key] ?? true;

            const item = rhythmCard.createDiv({
                cls: 'nw-item-border-b'
            });

            const header = item.createDiv({
                cls: 'nw-u-p-10px-16px nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-cur-pointer-2'
            });
            header.createEl('span', {
                text: unit.level,
                cls: 'nw-u-p-2px-8px-2 nw-u-brd-4px-2 nw-u-fs-11px-2 nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2 nw-u-fwt-500-2'
            });
            header.createEl('span', { text: unit.name, cls: 'nw-text-13-flex nw-font-medium' });
            header.createEl('span', {
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-text-xs-muted'
            });

            header.addEventListener('click', () => {
                this.expandedItems[key] = !isExpanded;
                this.render();
            });

            if (isExpanded && unit.children) {
                const children = item.createDiv({ cls: 'nw-u-p-0-16px-12px-48px' });
                for (const child of unit.children) {
                    children.createDiv({
                        text: child,
                        cls: 'nw-u-p-4px-0-2 nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-bb-1px-dashed-background--2'
                    });
                }
            }
        }
        } else {
            rhythmCard.createDiv({ text: '暂无节奏单元数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const typeSection = container.createDiv({ cls: 'nw-mb-lg' });
        typeSection.createEl('div', { text: '结构类型说明', cls: 'nw-section-heading' });

        const typeCard = typeSection.createDiv({
            cls: 'nw-card-lg-text'
        });

        if (data.structureType) {
            typeCard.createEl('div', { text: data.structureType, cls: 'nw-u-fwt-600-2 nw-u-marginbottom-8px-2 nw-u-c-interactive-accent-2' });
        }
        // 不能给 typeCard 赋 textContent：那会清空上面刚创建的 structureType 节点
        typeCard.createEl('div', { text: data.structureDescription || '暂无结构类型说明' });
    }

    // ============== Tab 6: 人设 ==============
    private renderCharacterTab(container: HTMLElement): void {
        const data = this.characterData;

        if (!data) {
            this.renderEmptyState(container, '人设提取数据', 'character');
            return;
        }

        const mainSection = container.createDiv({ cls: 'nw-mb-lg' });
        mainSection.createEl('div', { text: '主要人物', cls: 'nw-section-heading' });

        const mainChars = data.mainCharacters;
        if (mainChars && mainChars.length > 0) {

        const charsGrid = mainSection.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-7 nw-u-gap-12px-2'
        });

        for (const char of mainChars) {
            const card = charsGrid.createDiv({
                cls: 'nw-stat-card'
            });

            const avatar = card.createDiv({
                cls: 'nw-u-w-60px-2 nw-u-h-60px nw-u-brd-50-2 nw-u-bg-linear-gradient-135deg-4 nw-u-m-0-auto-10px nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-center-2 nw-u-c-white-2 nw-u-fs-24px nw-u-fwt-600-2'
            });
            avatar.textContent = char.name.charAt(0);

            card.createEl('div', { text: char.name, cls: 'nw-stat-sm' });
            card.createEl('div', { text: char.role, cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-8px' });

            const tagsContainer = card.createDiv({ cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-4px-2 nw-u-jc-center-2 nw-u-marginbottom-8px-2' });
            for (const tag of char.tags) {
                tagsContainer.createEl('span', {
                    text: tag,
                    cls: 'nw-u-p-2px-8px-2 nw-u-brd-10px-2 nw-u-fs-11px-2 nw-u-bg-background-primary-2 nw-u-c-text-muted-2'
                });
            }

            if (char.growth) {
                card.createEl('div', {
                    text: char.growth,
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-lh-1-4-2 nw-u-paddingtop-8px-2 nw-u-bt-1px-solid-background-m-2'
                });
            }
        }
        } else {
            mainSection.createDiv({ text: '暂无主要人物数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        const relationSection = container.createDiv({ cls: 'nw-mb-lg' });
        relationSection.createEl('div', { text: '人物关系网络', cls: 'nw-section-heading' });

        const relationCard = relationSection.createDiv({
            cls: 'nw-p-20-bg2-br8-center'
        });
        appendSanitizedHtml(relationCard, this.renderRelationshipGraph(data.relationships || [], mainChars || []));

        const searchSection = container.createDiv({ cls: 'nw-mb-md' });
        const searchInput = searchSection.createEl('input', {
            type: 'text',
            placeholder: '搜索人物...',
            cls: 'nw-u-w-100-2 nw-u-p-8px-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2'
        });
        searchInput.value = this.characterFilter;

        const allSection = container.createDiv({ cls: 'nw-mb-lg' });
        allSection.createEl('div', { text: '全部人物', cls: 'nw-section-heading' });

        const allCard = allSection.createDiv({
            cls: 'nw-scroll-card-300'
        });

        // 只重绘「全部人物」列表：整体 this.render() 会 empty 重建整个弹窗，
        // 搜索框随之销毁 → 每输入一个字就丢焦点，实际只能打一个字。
        const renderCharacterList = () => {
            allCard.empty();
            const allChars = data.allCharacters;
            if (!allChars || allChars.length === 0) {
                allCard.createDiv({ text: '暂无全部人物数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
                return;
            }

            const filtered = allChars.filter(c =>
                c.name.toLowerCase().includes(this.characterFilter.toLowerCase()) ||
                c.role.toLowerCase().includes(this.characterFilter.toLowerCase())
            );

            if (filtered.length === 0) {
                allCard.createDiv({
                    text: '没有找到匹配的人物',
                    cls: 'nw-empty-text-mini'
                });
                return;
            }

            for (const char of filtered) {
                const item = allCard.createDiv({
                    cls: "nw-item-border-b nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-12px-2 nw-u-p-10px-16px", attr: {}
                });

                const miniAvatar = item.createDiv({
                    cls: 'nw-u-w-32px nw-u-h-32px nw-u-brd-50-2 nw-u-bg-interactive-accent-2 nw-u-op-0-8 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-center-2 nw-u-c-white-2 nw-u-fs-14px-2 nw-u-fwt-600-2 nw-u-fsh-0-2'
                });
                miniAvatar.textContent = char.name.charAt(0);

                const info = item.createDiv({ cls: 'nw-flex-fill' });
                info.createEl('div', { text: char.name, cls: 'nw-text-13-medium' });
                info.createEl('div', { text: char.role, cls: 'nw-text-faint' });

                const tags = item.createDiv({ cls: 'nw-flex-gap4-shrink' });
                for (const tag of char.tags.slice(0, 2)) {
                    tags.createEl('span', {
                        text: tag,
                        cls: 'nw-u-p-2px-6px-2 nw-u-brd-4px-2 nw-u-fs-10px-2 nw-u-bg-background-primary-2 nw-u-c-text-muted-2'
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
            return '<div style="padding:20px;text-align:center;color:var(--text-muted);">暂无人物关系数据</div>';
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
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
                ${lines}
                ${nodes}
            </svg>
        `;
    }

    // ============== Tab 7: 伏笔 ==============
    private renderForeshadowTab(container: HTMLElement): void {
        const data = this.foreshadowData;

        if (!data) {
            this.renderEmptyState(container, '伏笔数据', 'foreshadow');
            return;
        }

        const statsSection = container.createDiv({ cls: 'nw-mb-lg' });
        statsSection.createEl('div', { text: '伏笔统计', cls: 'nw-section-heading' });

        const statsGrid = statsSection.createDiv({ cls: 'nw-grid-4' });

        const stats = data.stats;
        if (stats) {
            const resolved = normalizeDetailNumber(stats.resolved);
            const unresolved = normalizeDetailNumber(stats.unresolved);
            const total = resolved + unresolved;

            const totalCard = statsGrid.createDiv({
                cls: 'nw-stat-card'
            });
            totalCard.createEl('div', { text: String(total), cls: 'nw-stat-num-normal' });
            totalCard.createEl('div', { text: '伏笔总数', cls: 'nw-text-sm-muted' });

            const resolvedCard = statsGrid.createDiv({
                cls: 'nw-stat-card'
            });
            resolvedCard.createEl('div', { text: String(resolved), cls: 'nw-stat-num-success' });
            resolvedCard.createEl('div', { text: '已回收', cls: 'nw-text-sm-muted' });

            const unresolvedCard = statsGrid.createDiv({
                cls: 'nw-stat-card'
            });
            unresolvedCard.createEl('div', { text: String(unresolved), cls: 'nw-stat-num-warning' });
            unresolvedCard.createEl('div', { text: '待回收', cls: 'nw-text-sm-muted' });

            const forgottenCount = data.unresolvedTracker?.forgottenForeshadows?.length || 0;
            const forgottenCard = statsGrid.createDiv({
                cls: 'nw-stat-card'
            });
            forgottenCard.createEl('div', { text: forgottenCount.toString(), cls: 'nw-stat-num-error' });
            forgottenCard.createEl('div', { text: '疑似遗忘', cls: 'nw-text-sm-muted' });
        } else {
            statsSection.createDiv({ text: '暂无伏笔统计数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        if (data.resolutionQualityStats) {
            const qualitySection = container.createDiv({ cls: 'nw-mb-lg' });
            qualitySection.createEl('div', { text: '回收质量统计', cls: 'nw-section-heading' });

            const qualityCard = qualitySection.createDiv({
                cls: 'nw-card-lg'
            });

            const qualityGrid = qualityCard.createDiv({
                cls: 'nw-u-d-grid-2 nw-u-gtc-auto-1fr nw-u-gap-10px-16px nw-u-ai-center-2'
            });

            qualityGrid.createEl('div', { text: '平均质量', cls: 'nw-text-13-muted' });
            const avgQualityBar = qualityGrid.createDiv({ cls: 'nw-flex-row' });
            avgQualityBar.createEl('div', {
                cls: 'nw-u-flex-1-2 nw-u-h-8px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-4px-2 nw-u-ov-hidden-2'
            }).createEl('div', {
                attr: {
                    style: `width:${data.resolutionQualityStats.avgQuality}%;height:100%;background:linear-gradient(90deg, var(--nw-success-soft), var(--nw-info));border-radius:4px;`
                }
            });
            avgQualityBar.createEl('span', { text: `${data.resolutionQualityStats.avgQuality}分`, cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-minw-40px nw-u-ta-right' });

            const qd = data.resolutionQualityStats.qualityDistribution;
            const qualityBars = [
                { label: '优秀', value: qd.excellent, color: '#10b981' },
                { label: '良好', value: qd.good, color: '#3b82f6' },
                { label: '一般', value: qd.fair, color: '#f59e0b' },
                { label: '低质', value: qd.poor, color: '#ef4444' },
            ];
            for (const q of qualityBars) {
                qualityGrid.createEl('div', { text: q.label, cls: 'nw-text-sm-muted' });
                const barWrapper = qualityGrid.createDiv({ cls: 'nw-flex-row' });
                barWrapper.createEl('div', {
                    cls: 'nw-bar-track-6-flex'
                }).createEl('div', {
                    attr: { style: `width:${Math.min(100, q.value * 10)}%;height:100%;background:${q.color};border-radius:3px;` }
                });
                barWrapper.createEl('span', { text: `${q.value}个`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-minw-30px nw-u-ta-right' });
            }
        }

        const donutSection = container.createDiv({ cls: 'nw-mb-lg' });
        donutSection.createEl('div', { text: '回收进度', cls: 'nw-section-heading' });

        const donutCard = donutSection.createDiv({
            cls: 'nw-card-lg'
        });

        if (stats) {
            const donutData = [
                { label: '已回收', value: normalizeDetailNumber(stats.resolved), color: '#10b981' },
                { label: '待回收', value: normalizeDetailNumber(stats.unresolved), color: '#f59e0b' },
            ];
            appendSanitizedHtml(donutCard, donutChart(donutData, { size: 220 }));
        }

        if (data.networkAnalysis?.densityByChapter) {
            const densitySection = container.createDiv({ cls: 'nw-mb-lg' });
            densitySection.createEl('div', { text: '伏笔密度趋势', cls: 'nw-section-heading' });

            const densityCard = densitySection.createDiv({
                cls: 'nw-card-lg nw-scroll-x'
            });

            const setupData = data.networkAnalysis.densityByChapter.map(d => ({
                label: `第${d.chapter}段`,
                value: d.setupCount,
            }));
            const payoffData = data.networkAnalysis.densityByChapter.map(d => ({
                label: `第${d.chapter}段`,
                value: d.payoffCount,
            }));

            appendSanitizedHtml(densityCard, lineChart([
                { name: '埋设', data: setupData, color: '#3b82f6' },
                { name: '回收', data: payoffData, color: '#10b981' },
            ], {
                width: 650,
                height: 180,
                showLegend: true
            }));
        }

        const timelineSection = container.createDiv({ cls: 'nw-mb-lg' });
        timelineSection.createEl('div', { text: '伏笔出现时间线', cls: 'nw-section-heading' });

        const timelineCard = timelineSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const timelineEvents = data.timeline;
        if (timelineEvents && timelineEvents.length > 0) {
            appendSanitizedHtml(timelineCard, timelineChart(timelineEvents, { width: 650, height: 160 }));
        } else {
            timelineCard.createDiv({ text: '暂无伏笔时间线数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }

        if (data.networkAnalysis) {
            const networkSection = container.createDiv({ cls: 'nw-mb-lg' });
            networkSection.createEl('div', { text: '伏笔网络分析', cls: 'nw-section-heading' });

            const networkCard = networkSection.createDiv({
                cls: 'nw-card-lg'
            });

            const netGrid = networkCard.createDiv({
                cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-12px-2'
            });

            const mainlineCount = data.networkAnalysis.mainlineCount || 0;
            const sidelineCount = data.networkAnalysis.sidelineCount || 0;
            const rhythmBalance = data.networkAnalysis.rhythmBalance;

            const netItem1 = netGrid.createDiv({ cls: 'nw-text-center' });
            netItem1.createEl('div', { text: mainlineCount.toString(), cls: 'nw-stat-lg-accent' });
            netItem1.createEl('div', { text: '主线伏笔', cls: 'nw-text-faint' });

            const netItem2 = netGrid.createDiv({ cls: 'nw-text-center' });
            netItem2.createEl('div', { text: sidelineCount.toString(), cls: 'nw-stat-lg-muted' });
            netItem2.createEl('div', { text: '支线伏笔', cls: 'nw-text-faint' });

            if (rhythmBalance) {
                const rhythmDiv = networkCard.createDiv({ cls: 'nw-mt-sm' });
                rhythmDiv.createEl('div', {
                    text: `节奏平衡度：${rhythmBalance.balanceScore}% ${rhythmBalance.isBalanced ? '✅ 平衡' : '⚠️ 需调整'}`,
                    cls: 'nw-u-fs-12px-2 nw-u-marginbottom-6px-2'
                });
                rhythmDiv.createEl('div', {
                    cls: 'nw-bar-track-6-static'
                }).createEl('div', {
                    attr: { style: `width:${rhythmBalance.balanceScore}%;height:100%;background:${rhythmBalance.isBalanced ? '#10b981' : '#f59e0b'};border-radius:3px;` }
                });
            }
        }

        if (data.pairs && data.pairs.length > 0) {
            const pairSection = container.createDiv({ cls: 'nw-mb-lg' });
            pairSection.createEl('div', { text: '伏笔-回收配对', cls: 'nw-section-heading' });

            const pairCard = pairSection.createDiv({
                cls: 'nw-scroll-card-300'
            });

            const pairTypeLabels: Record<string, string> = {
                'one-to-one': '一对一',
                'one-to-many': '一对多',
                'many-to-one': '多对一'
            };

            for (const pair of data.pairs.slice(0, 15)) {
                const key = `pair_${pair.id}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const row = pairCard.createDiv({
                    cls: 'nw-item-border-b'
                });

                const header = row.createDiv({
                    cls: 'nw-u-p-10px-16px nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-10px-2 nw-u-cur-pointer-2'
                });

                const confidenceColor = pair.confidence >= 70 ? '#10b981' : pair.confidence >= 50 ? '#f59e0b' : '#ef4444';
                header.createEl('span', {
                    text: `${pair.confidence}%`,
                    attr: {
                        style: `
                            font-size:12px;
                            font-weight:600;
                            color:${confidenceColor};
                            padding:2px 8px;
                            background:${confidenceColor}22;
                            border-radius:10px;
                            flex-shrink:0;
                        `
                    }
                });

                const info = header.createDiv({ cls: 'nw-flex-fill' });
                info.createEl('div', {
                    text: `${pair.setupForeshadowName} → ${pair.payoffForeshadowName || '未知'}`,
                    cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2'
                });
                info.createEl('div', {
                    text: `${pairTypeLabels[pair.pairType] || pair.pairType}${pair.qualityScore ? ` · 回收质量：${pair.qualityScore}分` : ''}`,
                    cls: 'nw-u-fs-10px nw-u-c-text-muted nw-u-margintop-2px'
                });

                header.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-text-10-muted-shrink'
                });

                header.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded && pair.matchDimensions) {
                    const body = row.createDiv({
                        cls: 'nw-u-p-0-16px-10px-52px nw-u-fs-11px-2 nw-u-lh-1-8'
                    });

                    const dims = [
                        { label: '实体关联', value: pair.matchDimensions.entityMatch },
                        { label: '语义关联', value: pair.matchDimensions.semanticMatch },
                        { label: '时间顺序', value: pair.matchDimensions.temporalMatch },
                        { label: '类型匹配', value: pair.matchDimensions.typeMatch },
                    ];

                    for (const dim of dims) {
                        const dimRow = body.createDiv({ cls: 'nw-flex-row' });
                        dimRow.createEl('span', { text: dim.label, cls: 'nw-u-minw-60px nw-u-c-text-muted-2' });
                        const bar = dimRow.createEl('div', {
                            cls: 'nw-bar-track-4-flex'
                        });
                        bar.createEl('div', {
                            attr: { style: `width:${dim.value}%;height:100%;background:var(--interactive-accent);border-radius:2px;` }
                        });
                        dimRow.createEl('span', { text: `${dim.value}%`, cls: 'nw-u-minw-30px nw-u-ta-right nw-u-c-text-muted-2' });
                    }
                }
            }
        }

        if (data.unresolvedTracker && data.unresolvedTracker.totalUnresolved > 0) {
            const unresolvedSection = container.createDiv({ cls: 'nw-mb-lg' });
            unresolvedSection.createEl('div', { text: '未回收伏笔追踪', cls: 'nw-section-heading' });

            const unresolvedCard = unresolvedSection.createDiv({
                cls: 'nw-card-lg'
            });

            if (data.unresolvedTracker.forgottenForeshadows && data.unresolvedTracker.forgottenForeshadows.length > 0) {
                const warnDiv = unresolvedCard.createDiv({
                    cls: 'nw-u-p-10px-12px-2 nw-u-bg-nw-danger-bright-bg nw-u-brd-6px-2 nw-u-marginbottom-12px-2'
                });
                warnDiv.createEl('div', {
                    text: `⚠️ 发现 ${data.unresolvedTracker.forgottenForeshadows.length} 个疑似被遗忘的伏笔`,
                    cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-c-text-error-nw-danger-b nw-u-marginbottom-4px-2'
                });
                const names = data.unresolvedTracker.forgottenForeshadows.slice(0, 3).map(f => f.name).join('、');
                warnDiv.createEl('div', {
                    text: names + (data.unresolvedTracker.forgottenForeshadows.length > 3 ? '...' : ''),
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-error-nw-danger-b nw-u-op-0-8'
                });
            }

            if (data.unresolvedTracker.recallSuggestions && data.unresolvedTracker.recallSuggestions.length > 0) {
                unresolvedCard.createEl('div', { text: '回收建议', cls: 'nw-u-fwt-500-2 nw-u-fs-12px-2 nw-u-marginbottom-8px-2' });
                for (const s of data.unresolvedTracker.recallSuggestions.slice(0, 3)) {
                    const sDiv = unresolvedCard.createDiv({
                        cls: 'nw-u-p-8px-10px-2 nw-u-bg-background-primary-2 nw-u-brd-6px-2 nw-u-marginbottom-6px-2'
                    });
                    sDiv.createEl('div', {
                        text: `📌 第${s.chapter}章附近：${s.reason}`,
                        cls: 'nw-u-fs-11px-2 nw-u-fwt-500-2 nw-u-marginbottom-3px'
                    });
                    sDiv.createEl('div', {
                        text: s.foreshadows.join('、'),
                        cls: 'nw-text-xs-muted'
                    });
                }
            }
        }

        const filterSection = container.createDiv({ cls: 'nw-u-marginbottom-12px-2 nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-fwr-wrap-2' });
        const categories = ['all', '物品', '功法', '人物', '设定', '事件'];
        const categoryLabels: Record<string, string> = {
            all: '全部',
            '物品': '物品',
            '功法': '功法',
            '人物': '人物',
            '设定': '设定',
            '事件': '事件',
        };

        for (const cat of categories) {
            const btn = filterSection.createEl('button', {
                text: categoryLabels[cat],
                attr: {
                    type: 'button',
                    style: `
                        padding:6px 12px;
                        cursor:pointer;
                        border:1px solid ${this.foreshadowFilter === cat ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                        border-radius:16px;
                        font-size:12px;
                        background:${this.foreshadowFilter === cat ? 'var(--interactive-accent)' : 'transparent'};
                        color:${this.foreshadowFilter === cat ? 'var(--text-on-accent)' : 'var(--text-muted)'};
                    `
                }
            });
            btn.addEventListener('click', () => {
                this.foreshadowFilter = cat;
                this.render();
            });
        }

        const listSection = container.createDiv({ cls: 'nw-mb-lg' });
        listSection.createEl('div', { text: '伏笔详情', cls: 'nw-section-heading' });

        const items = data.items;
        if (items && items.length > 0) {

        const filtered = this.foreshadowFilter === 'all' ? items : items.filter(i => i.category === this.foreshadowFilter);

        const listCard = listSection.createDiv({
            cls: 'nw-scroll-card-400'
        });

        if (filtered.length === 0) {
            listCard.createDiv({
                text: '该分类下暂无伏笔',
                cls: 'nw-empty-text-mini'
            });
        } else {
            for (const item of filtered) {
                const key = `foreshadow_${item.id}`;
                const isExpanded = this.expandedItems[key] ?? false;

                const row = listCard.createDiv({
                    cls: 'nw-item-border-b'
                });

                const header = row.createDiv({
                    cls: 'nw-u-p-12px-16px-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-10px-2 nw-u-cur-pointer-2'
                });

                header.createEl('span', {
                    text: item.resolved ? '✓' : '○',
                    attr: {
                        style: `
                            font-size:16px;
                            color:${item.resolved ? 'var(--interactive-success, #10b981)' : 'var(--text-muted)'};
                            flex-shrink:0;
                        `
                    }
                });

                const info = header.createDiv({ cls: 'nw-flex-fill' });
                info.createEl('div', { text: item.name, cls: 'nw-text-13-medium' });
                info.createEl('div', {
                    text: `${item.category} · 首次出现：${item.firstAppearance}`,
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-margintop-2px-2'
                });

                header.createEl('span', {
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-text-10-muted-shrink'
                });

                header.addEventListener('click', () => {
                    this.expandedItems[key] = !isExpanded;
                    this.render();
                });

                if (isExpanded) {
                    const body = row.createDiv({
                        cls: 'nw-u-p-0-16px-12px-46px nw-u-fs-12px-2 nw-u-lh-1-6-2'
                    });

                    body.createEl('div', { text: '首次出现', cls: 'nw-foreshadow-title' });
                    body.createEl('div', { text: item.firstAppearance, cls: 'nw-u-c-text-muted-2 nw-u-marginbottom-8px-2' });

                    body.createEl('div', { text: '重要呼应', cls: 'nw-foreshadow-title' });
                    for (const echo of item.echoes) {
                        body.createDiv({ text: `• ${echo}`, cls: 'nw-u-c-text-muted-2 nw-u-paddingleft-4px' });
                    }

                    body.createEl('div', {
                        text: '回收情况',
                        cls: 'nw-foreshadow-title-mt'
                    });
                    if (item.resolved) {
                        body.createEl('div', {
                            text: `已回收：${item.resolution || '已回收'}`,
                            cls: 'nw-u-c-interactive-success-nw'
                        });
                    } else {
                        body.createEl('div', {
                            text: '待回收',
                            cls: 'nw-u-c-text-warning-nw-warnin'
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: '暂无伏笔详情数据', cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted' });
        }
    }

    // ============== 通用方法 ==============
    private renderEmptyState(container: HTMLElement, dataName: string, dimension: string): void {
        const card = container.createDiv({
            cls: 'nw-u-p-40px-20px nw-u-ta-center-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2'
        });
        card.createEl('div', { text: '📭', cls: 'nw-u-fs-40px nw-u-marginbottom-12px-2' });
        card.createEl('div', { text: `暂无${dataName}`, cls: 'nw-u-fs-14px-2 nw-u-fwt-500-2 nw-u-marginbottom-8px-2' });
        card.createEl('div', {
            text: '该维度数据待拆解，请先运行书籍拆解功能。',
            cls: 'nw-text-sm-muted'
        });

        const btn = card.createEl('button', {
            text: '🔄 开始拆解',
            attr: {
                type: 'button',
                style: 'margin-top:16px;padding:8px 20px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;'
            }
        });
        btn.addEventListener('click', async () => {
            if (this.deconstructionScheduler) {
                try {
                    await this.deconstructionScheduler.rerunBook(this.bookId);
                    new Notice('已开始拆解，正在跳转到监控面板...');
                    this.close();
                    new KnowledgeMonitorModal(this.app, this.deconstructionScheduler, this.knowledgeManager).open();
                } catch (e) {
                    // 源文本缺失/调度器拒绝时旧实现照样提示「已开始」并关窗
                    log.error('[KnowledgeDetailModal] 启动拆解失败:', e);
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: '开始拆解失败' });
                }
            } else {
                new Notice('拆解功能请在知识库监控面板中使用');
            }
        });
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-flex-gap6' });
        row.createEl('span', { text: `${label}:`, cls: 'nw-u-c-text-muted-2 nw-u-minw-70px nw-u-fsh-0-2' });
        row.createEl('span', { text: value, cls: 'nw-u-c-text-normal-2 nw-u-flex-1-2 nw-u-minw-0-2' });
    }

    private formatWordCount(count: number): string {
        if (count >= 10000) {
            return (count / 10000).toFixed(1) + ' 万字';
        }
        return count.toLocaleString() + ' 字';
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
            pending: '⏳ 待拆解',
            processing: '⚙️ 拆解中',
            completed: '✅ 已完成',
            failed: '❌ 失败',
        };
        return map[status] || status;
    }

    /** A5: 向量状态与拆解状态分开显示，失败原因直接挂在值里 */
    private getVectorStatusText(status?: string, error?: string): string {
        if (status === 'failed') return `⚠️ 向量化失败${error ? `（${error}）` : ''}`;
        if (status === 'done') return '✅ 已向量化';
        if (status === 'pending') return '⏳ 待向量化';
        return '— 未记录';
    }

    /** 详情页与「重新拆解」共用同一个调度器实例；缺依赖时提示并返回 null */
    private ensureScheduler(): DeconstructionScheduler | null {
        if (this.deconstructionScheduler) return this.deconstructionScheduler;
        try {
            const plugin = this.app.plugins.getPlugin('novel-writer-ai') as NovelWriterPlugin;
            const embeddingProvider = EmbeddingProviderFactory.fromSettings(plugin?.settings);
            const vectorEnhancer = new VectorEnhancer(embeddingProvider);
            this.deconstructionScheduler = new DeconstructionScheduler(
                this.app,
                this.knowledgeManager,
                undefined,
                undefined,
                vectorEnhancer,
                () => plugin?.settings || {}
            );
            return this.deconstructionScheduler;
        } catch (e) {
            log.warn('[KnowledgeDetailModal] 创建 deconstructionScheduler 失败:', e);
            new Notice('无法获取拆解调度器，请在设置中先加载知识库');
            return null;
        }
    }
}
