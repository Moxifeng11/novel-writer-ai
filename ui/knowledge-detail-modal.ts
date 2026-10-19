import { App, Modal, Notice } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import { KnowledgeBaseManager, BookBasicInfo } from '../services/knowledge-base-manager';
import { DeconstructionScheduler } from '../services/deconstruction-scheduler';
import { KnowledgeToFingerprintConverter } from '../engine/knowledge-to-fingerprint-converter';
import { StyleFingerprintLibrary } from '../engine/style-fingerprint-library';
import {
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookDir,
} from '../shared/paths';
import { radarChart, barChart, donutChart, lineChart, scatterChart, timelineChart } from './svg-charts';
import { RefillModal } from './refill-modal';
import { KnowledgeMonitorModal } from './knowledge-monitor-modal';
import { createLogger } from '../shared/logger';
import { normalizeDetailNumber } from './knowledge-detail-format';
import { openKnowledgeFolder } from './knowledge-folder-navigation';
import { escapeHtml } from '../utils/helpers';


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

    async onOpen() {
        this.modalEl.addClass('nw-scope');
        await this.loadData();
        this.render();
    }

    onClose() {
        this.contentEl.empty();
    }

    private async loadData(): Promise<void> {
        this.bookInfo = (await this.knowledgeManager.getBook(this.bookId)) ?? null;
        if (!this.bookInfo) return;

        const fs = (this.app.vault.adapter as { exists(p: string): Promise<boolean>; read(p: string): Promise<string> });

        try {
            const stylePath = kbBookStyleFingerprintFile(this.bookInfo.name, this.baseDir);
            if (await fs.exists(stylePath)) {
                const content = await fs.read(stylePath);
                try {
                    this.styleData = JSON.parse(content);
                } catch {
                    this.styleData = {};
                }
            }
        } catch {
            this.styleData = null;
        }

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
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.maxHeight = '88vh';

        if (!this.bookInfo) {
            contentEl.createDiv({ text: '书籍不存在或已被删除', attr: { style: 'padding:40px;text-align:center;color:var(--text-muted);' } });
            return;
        }

        this.renderHeader(contentEl);
        this.renderTabs(contentEl);
        this.renderTabContent(contentEl);
    }

    private getPlugin(): any | null {
        try {
            const plugin = this.app.plugins?.getPlugin('novel-writer-ai');
            if (plugin) return plugin;
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
            new Notice(`已取消《${bookName}》的参考`);
        } else {
            if (!plugin.referenceBookIds.includes(this.bookId)) {
                plugin.referenceBookIds.push(this.bookId);
            }
            new Notice(`已添加《${bookName}》为参考书籍`);
        }

        this.refreshKnowledgePanel();
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
            const activeProject = plugin?.settings?.activeProject;
            if (!activeProject) {
                new Notice('请先打开一个项目');
                return;
            }

            const library = new StyleFingerprintLibrary(this.app, activeProject);
            await library.addFromKnowledge(fingerprint);

            new Notice(`已将《${this.bookInfo.name}》拆解结果转为项目写作指纹`);
            buttonEl.setText('✅ 已转为指纹');
            buttonEl.disabled = true;
        } catch (e) {
            log.error('[KnowledgeDetailModal] 转换指纹失败:', e);
            new Notice(`转换失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private refreshKnowledgePanel(): void {
        try {
            const VIEW_TYPE_KNOWLEDGE = 'nw-float-knowledge';
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE);
            for (const leaf of leaves) {
                const view = leaf.view as unknown as { renderTabContent?: () => void; selectedBooks?: Set<string> };
                if (view && typeof view.renderTabContent === 'function') {
                    if (view.selectedBooks instanceof Set) {
                        const isRef = this.isReferenceBook();
                        if (isRef) {
                            view.selectedBooks.add(this.bookId);
                        } else {
                            view.selectedBooks.delete(this.bookId);
                        }
                    }
                    view.renderTabContent();
                }
            }
        } catch {
        }
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ attr: { style: 'margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;' } });
        
        const titleWrap = header.createDiv({ attr: { style: 'display:flex;align-items:center;gap:12px;flex:1;min-width:0;' } });
        titleWrap.createEl('h3', { text: `📚 ${this.bookInfo!.name}`, attr: { style: 'margin:0;flex-shrink:0;' } });

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
            attr: {
                style: 'display:flex;gap:2px;border-bottom:1px solid var(--background-modifier-border);margin-bottom:16px;overflow-x:auto;'
            }
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
            attr: { style: 'padding:16px;background:var(--background-secondary);border-radius:8px;margin-bottom:16px;' }
        });
        infoCard.createEl('div', { text: '基本信息', cls: 'nw-section-heading' });

        const grid = infoCard.createDiv({ attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;font-size:13px;' } });
        this.renderInfoRow(grid, '书名', book.name);
        this.renderInfoRow(grid, '作者', book.author || '未知');
        this.renderInfoRow(grid, '题材标签', book.themeTags.length ? book.themeTags.join('、') : '暂无');
        this.renderInfoRow(grid, '字数', book.wordCount ? this.formatWordCount(book.wordCount) : '未知');
        this.renderInfoRow(grid, '更新时间', this.formatDateTime(book.updatedAt));
        this.renderInfoRow(grid, '拆解状态', this.getStatusText(book.breakdownStatus));

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
        donutCard.innerHTML += donutChart(donutData, { size: 300 });

        const actionsSection = container.createDiv({ cls: 'nw-mb-lg' });
        actionsSection.createEl('div', { text: '快速操作', cls: 'nw-section-heading' });

        const btnRow = actionsSection.createDiv({ cls: 'nw-flex-gap10-wrap' });

        const reanalyzeBtn = btnRow.createEl('button', {
            text: '🔄 重新拆解',
            attr: { type: 'button' },
            cls: 'nw-btn-outline',
        });
        reanalyzeBtn.addEventListener('click', () => {
            if (!this.deconstructionScheduler) {
                try {
                    const VectorEnhancer = require('../engine/vector-enhancer').VectorEnhancer;
                    const embeddingClient = new (require('../engine/ollama-embedding-client').OllamaEmbeddingClient)(
                        (this.app.plugins.getPlugin('novel-writer-ai') as any)?.settings?.embeddingEndpoint || 'http://localhost:11434',
                        (this.app.plugins.getPlugin('novel-writer-ai') as any)?.settings?.embeddingModel || 'bge-m3'
                    );
                    const vectorEnhancer = new VectorEnhancer(embeddingClient);
                    this.deconstructionScheduler = new (require('../engine/deconstruction-scheduler').DeconstructionScheduler)(
                        this.app,
                        this.knowledgeManager,
                        undefined,
                        undefined,
                        vectorEnhancer,
                        () => (this.app.plugins.getPlugin('novel-writer-ai') as any)?.settings || {}
                    );
                } catch (e) {
                    log.warn('[KnowledgeDetailModal] 创建 deconstructionScheduler 失败:', e);
                    new Notice('无法获取拆解调度器，请在设置中先加载知识库');
                    return;
                }
            }
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
            await this.knowledgeManager.deleteBook(this.bookId);
            new Notice('书籍已删除');
            this.close();
        });

        const descSection = container.createDiv({
            attr: { style: 'padding:12px;background:var(--background-secondary-alt);border-radius:6px;font-size:12px;color:var(--text-muted);line-height:1.6;' }
        });
        descSection.textContent = book.synopsis || '暂无书籍简介。点击各 Tab 查看详细拆解数据。';
    }

    private getDimensionProgress(index: number): number {
        const dataList = [this.styleData, this.rhythmData, this.techniqueData, this.structureData, this.characterData, this.foreshadowData];
        return dataList[index] ? 100 : 0;
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
        radarCard.innerHTML += radarChart(radarData, { size: 320 });

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
            curveCard.innerHTML += lineChart(series, { width: 600, height: 280 });
        } else {
            curveCard.createDiv({ text: '暂无情绪曲线数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        const scatterSection = container.createDiv({ cls: 'nw-mb-lg' });
        scatterSection.createEl('div', { text: '爽点分布', cls: 'nw-section-heading' });

        const scatterCard = scatterSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const scatterPoints = data.coolPoints;
        if (scatterPoints && scatterPoints.length > 0) {
            scatterCard.innerHTML += scatterChart(scatterPoints, { width: 600, height: 250, xAxisLabel: '章节进度', yAxisLabel: '爽感强度' });
        } else {
            scatterCard.createDiv({ text: '暂无爽点数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        const structureSection = container.createDiv({ cls: 'nw-mb-lg' });
        structureSection.createEl('div', { text: '结构理论匹配度', cls: 'nw-section-heading' });

        const structureCard = structureSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const matchData = data.structureMatches;
        if (matchData && matchData.length > 0) {
            structureCard.innerHTML += barChart(matchData, { width: 500, height: 220, horizontal: true });
        } else {
            structureCard.createDiv({ text: '暂无结构匹配数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
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
                    attr: { style: 'display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--background-modifier-border);' }
                });
                item.createEl('span', { text: point.position, cls: 'nw-text-accent-13' });
                item.createEl('span', { text: point.description, cls: 'nw-text-13-normal-flex' });
            }
        } else {
            keyPointsCard.createDiv({ text: '暂无关键情绪点数据', attr: { style: 'padding:10px;text-align:center;color:var(--text-muted);' } });
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
            categoryCard.innerHTML += barChart(barData, { width: 500, height: 220 });
        } else {
            categoryCard.createDiv({ text: '暂无技巧分类数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
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
                    attr: { style: 'display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--background-modifier-border);' }
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
            top10Card.createDiv({ text: '暂无技巧排行数据', attr: { style: 'padding:10px;text-align:center;color:var(--text-muted);' } });
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
                attr: { style: 'margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;' }
            });

            const header = group.createDiv({
                attr: { style: 'padding:10px 14px;background:var(--background-secondary);font-weight:500;font-size:13px;' }
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
                    attr: { style: 'padding:8px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;' }
                });
                itemHeader.createEl('span', { text: tech.name, attr: { style: 'font-size:13px;' } });
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
                        attr: { style: 'padding:0 14px 12px;font-size:12px;line-height:1.6;color:var(--text-muted);' }
                    });
                    body.createEl('div', { text: '示例片段：', attr: { style: 'font-weight:500;margin-bottom:6px;color:var(--text-normal);' } });
                    for (const example of tech.examples) {
                        body.createDiv({
                            text: `• ${example}`,
                            attr: { style: 'padding:4px 0;padding-left:8px;' }
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: '暂无技巧详情数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
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
            timelineCard.innerHTML += timelineChart(timelineEvents, { width: 650, height: 140 });
        } else {
            timelineCard.createDiv({ text: '暂无起承转合数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
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
                const labelRow = row.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;' } });
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
            threeLinesCard.createDiv({ text: '暂无三线并行数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
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
                attr: { style: 'padding:10px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;' }
            });
            header.createEl('span', {
                text: unit.level,
                attr: {
                    style: 'padding:2px 8px;border-radius:4px;font-size:11px;background:var(--interactive-accent);color:var(--text-on-accent);font-weight:500;'
                }
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
                const children = item.createDiv({ attr: { style: 'padding:0 16px 12px 48px;' } });
                for (const child of unit.children) {
                    children.createDiv({
                        text: child,
                        attr: { style: 'padding:4px 0;font-size:12px;color:var(--text-muted);border-bottom:1px dashed var(--background-modifier-border);' }
                    });
                }
            }
        }
        } else {
            rhythmCard.createDiv({ text: '暂无节奏单元数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        const typeSection = container.createDiv({ cls: 'nw-mb-lg' });
        typeSection.createEl('div', { text: '结构类型说明', cls: 'nw-section-heading' });

        const typeCard = typeSection.createDiv({
            cls: 'nw-card-lg-text'
        });

        if (data.structureType) {
            typeCard.createEl('div', { text: data.structureType, attr: { style: 'font-weight:600;margin-bottom:8px;color:var(--interactive-accent);' } });
        }
        typeCard.textContent = data.structureDescription || '暂无结构类型说明';
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
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:12px;' }
        });

        for (const char of mainChars) {
            const card = charsGrid.createDiv({
                cls: 'nw-stat-card'
            });

            const avatar = card.createDiv({
                attr: {
                    style: 'width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg, var(--interactive-accent), #D97706);margin:0 auto 10px;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;font-weight:600;'
                }
            });
            avatar.textContent = char.name.charAt(0);

            card.createEl('div', { text: char.name, cls: 'nw-stat-sm' });
            card.createEl('div', { text: char.role, attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' } });

            const tagsContainer = card.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-bottom:8px;' } });
            for (const tag of char.tags) {
                tagsContainer.createEl('span', {
                    text: tag,
                    attr: {
                        style: 'padding:2px 8px;border-radius:10px;font-size:11px;background:var(--background-primary);color:var(--text-muted);'
                    }
                });
            }

            if (char.growth) {
                card.createEl('div', {
                    text: char.growth,
                    attr: { style: 'font-size:11px;color:var(--text-muted);line-height:1.4;padding-top:8px;border-top:1px solid var(--background-modifier-border);' }
                });
            }
        }
        } else {
            mainSection.createDiv({ text: '暂无主要人物数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        const relationSection = container.createDiv({ cls: 'nw-mb-lg' });
        relationSection.createEl('div', { text: '人物关系网络', cls: 'nw-section-heading' });

        const relationCard = relationSection.createDiv({
            cls: 'nw-p-20-bg2-br8-center'
        });
        relationCard.innerHTML += this.renderRelationshipGraph(data.relationships || [], mainChars || []);

        const searchSection = container.createDiv({ cls: 'nw-mb-md' });
        const searchInput = searchSection.createEl('input', {
            type: 'text',
            placeholder: '搜索人物...',
            attr: {
                style: 'width:100%;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;background:var(--background-secondary);'
            }
        });
        searchInput.value = this.characterFilter;
        searchInput.addEventListener('input', (e) => {
            this.characterFilter = (e.target as HTMLInputElement).value;
            this.render();
        });

        const allSection = container.createDiv({ cls: 'nw-mb-lg' });
        allSection.createEl('div', { text: '全部人物', cls: 'nw-section-heading' });

        const allCard = allSection.createDiv({
            cls: 'nw-scroll-card-300'
        });

        const allChars = data.allCharacters;
        if (allChars && allChars.length > 0) {

        const filtered = allChars.filter(c =>
            c.name.toLowerCase().includes(this.characterFilter.toLowerCase()) ||
            c.role.toLowerCase().includes(this.characterFilter.toLowerCase())
        );

        if (filtered.length === 0) {
            allCard.createDiv({
                text: '没有找到匹配的人物',
                cls: 'nw-empty-text-mini'
            });
        } else {
            for (const char of filtered) {
                const item = allCard.createDiv({
                    cls: 'nw-item-border-b', attr: { style: 'display:flex;align-items:center;gap:12px;padding:10px 16px;' }
                });

                const miniAvatar = item.createDiv({
                    attr: {
                        style: 'width:32px;height:32px;border-radius:50%;background:var(--interactive-accent);opacity:0.8;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:600;flex-shrink:0;'
                    }
                });
                miniAvatar.textContent = char.name.charAt(0);

                const info = item.createDiv({ cls: 'nw-flex-fill' });
                info.createEl('div', { text: char.name, cls: 'nw-text-13-medium' });
                info.createEl('div', { text: char.role, cls: 'nw-text-faint' });

                const tags = item.createDiv({ cls: 'nw-flex-gap4-shrink' });
                for (const tag of char.tags.slice(0, 2)) {
                    tags.createEl('span', {
                        text: tag,
                        attr: {
                            style: 'padding:2px 6px;border-radius:4px;font-size:10px;background:var(--background-primary);color:var(--text-muted);'
                        }
                    });
                }
            }
        }
        } else {
            allCard.createDiv({ text: '暂无全部人物数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }
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
            statsSection.createDiv({ text: '暂无伏笔统计数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        if (data.resolutionQualityStats) {
            const qualitySection = container.createDiv({ cls: 'nw-mb-lg' });
            qualitySection.createEl('div', { text: '回收质量统计', cls: 'nw-section-heading' });

            const qualityCard = qualitySection.createDiv({
                cls: 'nw-card-lg'
            });

            const qualityGrid = qualityCard.createDiv({
                attr: { style: 'display:grid;grid-template-columns:auto 1fr;gap:10px 16px;align-items:center;' }
            });

            qualityGrid.createEl('div', { text: '平均质量', cls: 'nw-text-13-muted' });
            const avgQualityBar = qualityGrid.createDiv({ cls: 'nw-flex-row' });
            avgQualityBar.createEl('div', {
                attr: {
                    style: `flex:1;height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;`
                }
            }).createEl('div', {
                attr: {
                    style: `width:${data.resolutionQualityStats.avgQuality}%;height:100%;background:linear-gradient(90deg, #10b981, #3b82f6);border-radius:4px;`
                }
            });
            avgQualityBar.createEl('span', { text: `${data.resolutionQualityStats.avgQuality}分`, attr: { style: 'font-size:12px;font-weight:500;min-width:40px;text-align:right;' } });

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
                barWrapper.createEl('span', { text: `${q.value}个`, attr: { style: 'font-size:11px;color:var(--text-muted);min-width:30px;text-align:right;' } });
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
            donutCard.innerHTML += donutChart(donutData, { size: 220 });
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

            densityCard.innerHTML += lineChart([
                { name: '埋设', data: setupData, color: '#3b82f6' },
                { name: '回收', data: payoffData, color: '#10b981' },
            ], {
                width: 650,
                height: 180,
                showLegend: true
            });
        }

        const timelineSection = container.createDiv({ cls: 'nw-mb-lg' });
        timelineSection.createEl('div', { text: '伏笔出现时间线', cls: 'nw-section-heading' });

        const timelineCard = timelineSection.createDiv({
            cls: 'nw-card-lg nw-scroll-x'
        });

        const timelineEvents = data.timeline;
        if (timelineEvents && timelineEvents.length > 0) {
            timelineCard.innerHTML += timelineChart(timelineEvents, { width: 650, height: 160 });
        } else {
            timelineCard.createDiv({ text: '暂无伏笔时间线数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }

        if (data.networkAnalysis) {
            const networkSection = container.createDiv({ cls: 'nw-mb-lg' });
            networkSection.createEl('div', { text: '伏笔网络分析', cls: 'nw-section-heading' });

            const networkCard = networkSection.createDiv({
                cls: 'nw-card-lg'
            });

            const netGrid = networkCard.createDiv({
                attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' }
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
                    attr: { style: 'font-size:12px;margin-bottom:6px;' }
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
                    attr: { style: 'padding:10px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;' }
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
                    attr: { style: 'font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }
                });
                info.createEl('div', {
                    text: `${pairTypeLabels[pair.pairType] || pair.pairType}${pair.qualityScore ? ` · 回收质量：${pair.qualityScore}分` : ''}`,
                    attr: { style: 'font-size:10px;color:var(--text-muted);margin-top:2px;' }
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
                        attr: { style: 'padding:0 16px 10px 52px;font-size:11px;line-height:1.8;' }
                    });

                    const dims = [
                        { label: '实体关联', value: pair.matchDimensions.entityMatch },
                        { label: '语义关联', value: pair.matchDimensions.semanticMatch },
                        { label: '时间顺序', value: pair.matchDimensions.temporalMatch },
                        { label: '类型匹配', value: pair.matchDimensions.typeMatch },
                    ];

                    for (const dim of dims) {
                        const dimRow = body.createDiv({ cls: 'nw-flex-row' });
                        dimRow.createEl('span', { text: dim.label, attr: { style: 'min-width:60px;color:var(--text-muted);' } });
                        const bar = dimRow.createEl('div', {
                            cls: 'nw-bar-track-4-flex'
                        });
                        bar.createEl('div', {
                            attr: { style: `width:${dim.value}%;height:100%;background:var(--interactive-accent);border-radius:2px;` }
                        });
                        dimRow.createEl('span', { text: `${dim.value}%`, attr: { style: 'min-width:30px;text-align:right;color:var(--text-muted);' } });
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
                    attr: { style: 'padding:10px 12px;background:rgba(239, 68, 68, 0.1);border-radius:6px;margin-bottom:12px;' }
                });
                warnDiv.createEl('div', {
                    text: `⚠️ 发现 ${data.unresolvedTracker.forgottenForeshadows.length} 个疑似被遗忘的伏笔`,
                    attr: { style: 'font-size:12px;font-weight:500;color:var(--text-error, #ef4444);margin-bottom:4px;' }
                });
                const names = data.unresolvedTracker.forgottenForeshadows.slice(0, 3).map(f => f.name).join('、');
                warnDiv.createEl('div', {
                    text: names + (data.unresolvedTracker.forgottenForeshadows.length > 3 ? '...' : ''),
                    attr: { style: 'font-size:11px;color:var(--text-error, #ef4444);opacity:0.8;' }
                });
            }

            if (data.unresolvedTracker.recallSuggestions && data.unresolvedTracker.recallSuggestions.length > 0) {
                unresolvedCard.createEl('div', { text: '回收建议', attr: { style: 'font-weight:500;font-size:12px;margin-bottom:8px;' } });
                for (const s of data.unresolvedTracker.recallSuggestions.slice(0, 3)) {
                    const sDiv = unresolvedCard.createDiv({
                        attr: { style: 'padding:8px 10px;background:var(--background-primary);border-radius:6px;margin-bottom:6px;' }
                    });
                    sDiv.createEl('div', {
                        text: `📌 第${s.chapter}章附近：${s.reason}`,
                        attr: { style: 'font-size:11px;font-weight:500;margin-bottom:3px;' }
                    });
                    sDiv.createEl('div', {
                        text: s.foreshadows.join('、'),
                        cls: 'nw-text-xs-muted'
                    });
                }
            }
        }

        const filterSection = container.createDiv({ attr: { style: 'margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;' } });
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
                    attr: { style: 'padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;' }
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
                    attr: { style: 'font-size:11px;color:var(--text-muted);margin-top:2px;' }
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
                        attr: { style: 'padding:0 16px 12px 46px;font-size:12px;line-height:1.6;' }
                    });

                    body.createEl('div', { text: '首次出现', cls: 'nw-foreshadow-title' });
                    body.createEl('div', { text: item.firstAppearance, attr: { style: 'color:var(--text-muted);margin-bottom:8px;' } });

                    body.createEl('div', { text: '重要呼应', cls: 'nw-foreshadow-title' });
                    for (const echo of item.echoes) {
                        body.createDiv({ text: `• ${echo}`, attr: { style: 'color:var(--text-muted);padding-left:4px;' } });
                    }

                    body.createEl('div', {
                        text: '回收情况',
                        cls: 'nw-foreshadow-title-mt'
                    });
                    if (item.resolved) {
                        body.createEl('div', {
                            text: `已回收：${item.resolution || '已回收'}`,
                            attr: { style: 'color:var(--interactive-success, #10b981);' }
                        });
                    } else {
                        body.createEl('div', {
                            text: '待回收',
                            attr: { style: 'color:var(--text-warning, #f59e0b);' }
                        });
                    }
                }
            }
        }
        } else {
            listSection.createDiv({ text: '暂无伏笔详情数据', attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);' } });
        }
    }

    // ============== 通用方法 ==============
    private renderEmptyState(container: HTMLElement, dataName: string, dimension: string): void {
        const card = container.createDiv({
            attr: {
                style: 'padding:40px 20px;text-align:center;background:var(--background-secondary);border-radius:8px;'
            }
        });
        card.createEl('div', { text: '📭', attr: { style: 'font-size:40px;margin-bottom:12px;' } });
        card.createEl('div', { text: `暂无${dataName}`, attr: { style: 'font-size:14px;font-weight:500;margin-bottom:8px;' } });
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
        btn.addEventListener('click', () => {
            if (this.deconstructionScheduler) {
                this.deconstructionScheduler.rerunBook(this.bookId);
                new Notice('已开始拆解，正在跳转到监控面板...');
                this.close();
                new KnowledgeMonitorModal(this.app, this.deconstructionScheduler, this.knowledgeManager).open();
            } else {
                new Notice('拆解功能请在知识库监控面板中使用');
            }
        });
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-flex-gap6' });
        row.createEl('span', { text: `${label}:`, attr: { style: 'color:var(--text-muted);min-width:70px;flex-shrink:0;' } });
        row.createEl('span', { text: value, attr: { style: 'color:var(--text-normal);flex:1;min-width:0;' } });
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
}
