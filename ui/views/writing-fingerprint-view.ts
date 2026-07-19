import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { StyleFingerprintLibrary, StyleFingerprint } from '../../engine/style-fingerprint-library';
import { FingerprintExtractor, ExtractionProgress } from '../../engine/fingerprint-extractor';
import { applyNwScope } from '../../utils/helpers';
import { AddFingerprintModal } from '../fingerprint-library-modal';
import { OllamaEmbeddingClient } from '../../engine/ollama-embedding-client';
import { LocalVectorStore } from '../../engine/local-vector-store';
import { ENGINE_NAMES } from '../../engine/engine-registry';
import { AIEngine } from '../../engine/ai-engine';
import { FingerprintDetailModal } from '../fingerprint-detail-modal';
import { FingerprintIntensityModal } from '../fingerprint-intensity-modal';
import { FingerprintBlendModal } from '../fingerprint-blend-modal';
import { createLogger } from '../../shared/logger';


const log = createLogger('WritingFingerprintView');
export const VIEW_TYPE_WRITING_FINGERPRINT = 'novel-writer-writing-fingerprint';

type FingerprintScope = 'template' | 'global' | 'project';

interface FilterState {
    searchQuery: string;
    selectedTag: string | null;
    activeScope: FingerprintScope;
}

const SCOPE_LABELS: Record<FingerprintScope, string> = {
    template: '📋 模板层',
    global: '🌐 全局层',
    project: '📁 项目层',
};

const SCOPE_ICONS: Record<FingerprintScope, string> = {
    template: '📋',
    global: '🌐',
    project: '📁',
};

export class WritingFingerprintView extends ItemView {
    plugin: NovelWriterPlugin;
    fingerprintLibrary: StyleFingerprintLibrary | null = null;
    extractor: FingerprintExtractor | null = null;
    vectorStore: LocalVectorStore | null = null;

    private filter: FilterState = {
        searchQuery: '',
        selectedTag: null,
        activeScope: 'project',
    };

    private templateFingerprints: StyleFingerprint[] = [];
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];

    private selectedFingerprintId: string | null = null;
    private selectedFingerprintScope: FingerprintScope | null = null;

    private leftSidebar!: HTMLElement;
    private rightPanel!: HTMLElement;
    private scopeTabs!: HTMLElement;
    private fingerprintList!: HTMLElement;
    private searchInput!: HTMLInputElement;
    private tagFilter!: HTMLElement;
    private toolbar!: HTMLElement;
    private detailPanel!: HTMLElement;

    private isLoading = false;

    get currentProjectPath(): string | null {
        return this.plugin.getActiveProject();
    }

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_WRITING_FINGERPRINT;
    }

    getDisplayText() {
        return '🔍 写作指纹库';
    }

    getIcon() {
        return 'fingerprint';
    }

    async onOpen() {
        applyNwScope(this);
        await this.initLibrary();
        this.renderLayout();
        await this.loadAllFingerprints();
        this.renderScopeTabs();
        this.renderToolbar();
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
    }

    async onClose() {
        await this.fingerprintLibrary?.flush();
    }

    private async initLibrary(): Promise<void> {
        const project = this.plugin.getActiveProject() || undefined;
        this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, project);

        try {
            const aiEngine = this.plugin.engineRegistry.get<AIEngine>(ENGINE_NAMES.AI_ENGINE);
            const embeddingClient = new OllamaEmbeddingClient(
                this.plugin.settings.vectorOllamaBaseUrl,
                this.plugin.settings.vectorOllamaModel,
            );
            this.vectorStore = new LocalVectorStore(this.app, project ? 'project' : 'global', embeddingClient, project || 'default');
            this.extractor = new FingerprintExtractor(aiEngine, embeddingClient, this.vectorStore);
        } catch (e) {
            log.warn('[WritingFingerprintView] 提取器初始化失败:', e);
        }
    }

    private async loadAllFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.isLoading = true;

        try {
            this.templateFingerprints = await this.fingerprintLibrary.loadTemplate();
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();
        } catch (e) {
            log.warn('[WritingFingerprintView] 加载指纹失败:', e);
        } finally {
            this.isLoading = false;
        }
    }

    private getCurrentFingerprints(): StyleFingerprint[] {
        const all = (() => {
            switch (this.filter.activeScope) {
                case 'template': return this.templateFingerprints;
                case 'global': return this.globalFingerprints;
                case 'project': return this.projectFingerprints;
            }
        })();

        let filtered = all;

        if (this.filter.searchQuery) {
            const q = this.filter.searchQuery.toLowerCase();
            filtered = filtered.filter(fp =>
                fp.name.toLowerCase().includes(q) ||
                fp.source.toLowerCase().includes(q) ||
                fp.tags.some(t => t.toLowerCase().includes(q))
            );
        }

        if (this.filter.selectedTag) {
            filtered = filtered.filter(fp => fp.tags.includes(this.filter.selectedTag!));
        }

        return filtered;
    }

    private getAllTags(): string[] {
        const all = [
            ...this.templateFingerprints,
            ...this.globalFingerprints,
            ...this.projectFingerprints,
        ];
        const tagSet = new Set<string>();
        all.forEach(fp => fp.tags.forEach(t => tagSet.add(t)));
        return Array.from(tagSet).sort();
    }

    private renderLayout(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('nw-fingerprint-view');

        const mainLayout = containerEl.createDiv({
            cls: 'nw-fingerprint-main-layout',
            attr: { style: 'display:flex;height:100%;width:100%;' }
        });

        this.leftSidebar = mainLayout.createDiv({
            cls: 'nw-fingerprint-left-sidebar',
            attr: { style: 'width:300px;min-width:240px;max-width:400px;border-right:1px solid var(--background-modifier-border);display:flex;flex-direction:column;' }
        });

        this.rightPanel = mainLayout.createDiv({
            cls: 'nw-fingerprint-right-panel',
            attr: { style: 'flex:1;overflow-y:auto;padding:16px;' }
        });
    }

    private renderScopeTabs(): void {
        if (this.scopeTabs) {
            this.scopeTabs.remove();
        }
        this.scopeTabs = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-scope-tabs',
            attr: { style: 'display:flex;border-bottom:1px solid var(--background-modifier-border);' }
        });

        const scopes: FingerprintScope[] = ['template', 'global', 'project'];
        scopes.forEach(scope => {
            const tab = this.scopeTabs.createDiv({
                cls: 'nw-fingerprint-scope-tab',
                text: SCOPE_LABELS[scope],
                attr: {
                    style: `flex:1;padding:10px 8px;text-align:center;cursor:pointer;font-size:12px;border-bottom:2px solid ${
                        this.filter.activeScope === scope ? 'var(--interactive-accent)' : 'transparent'
                    };color:${this.filter.activeScope === scope ? 'var(--interactive-accent)' : 'var(--text-muted)'};font-weight:${this.filter.activeScope === scope ? '600' : '400'};`
                }
            });
            tab.addEventListener('click', () => {
                this.filter.activeScope = scope;
                this.selectedFingerprintId = null;
                this.selectedFingerprintScope = null;
                this.renderScopeTabs();
                this.renderFingerprintList();
                this.renderDetailPanel();
            });
        });
    }

    private renderToolbar(): void {
        if (this.toolbar) {
            this.toolbar.remove();
        }
        this.toolbar = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-toolbar',
            attr: { style: 'padding:8px;border-bottom:1px solid var(--background-modifier-border);display:flex;flex-wrap:wrap;gap:4px;' }
        });

        const addBtn = this.createToolbarButton('➕ 新建', () => this.handleAddFingerprint());
        const extractBtn = this.createToolbarButton('📝 从文本提取', () => this.handleExtractFromText());
        const extractChapterBtn = this.createToolbarButton('📖 从章节提取', () => this.handleExtractFromChapters());
        const importBtn = this.createToolbarButton('📚 从知识库导入', () => this.handleImportFromKnowledge());
        const blendBtn = this.createToolbarButton('🎨 融合预览', () => this.handleBlendFingerprints());
        const migrateBtn = this.createToolbarButton('⬆ 批量升级 V2', () => this.handleMigrateToV2());
        const deleteBtn = this.createToolbarButton('🗑️ 删除', () => this.handleDeleteFingerprint(), true);
        const toggleBtn = this.createToolbarButton('🔌 启用/禁用', () => this.handleToggleEnabled());

        this.toolbar.appendChild(addBtn);
        this.toolbar.appendChild(extractBtn);
        this.toolbar.appendChild(extractChapterBtn);
        this.toolbar.appendChild(importBtn);
        this.toolbar.appendChild(blendBtn);
        this.toolbar.appendChild(migrateBtn);
        this.toolbar.appendChild(deleteBtn);
        this.toolbar.appendChild(toggleBtn);
    }

    private createToolbarButton(text: string, onClick: () => void, isDanger = false): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-toolbar-btn';
        btn.setAttribute('style', `
            padding:4px 8px;
            font-size:11px;
            cursor:pointer;
            border:1px solid var(--background-modifier-border);
            border-radius:4px;
            background:var(--background-secondary);
            color:var(--text-normal);
            flex:1;
            min-width:70px;
        `);
        btn.addEventListener('click', onClick);
        return btn;
    }

    private renderSearchAndFilter(): void {
        if (this.searchInput) {
            this.searchInput.parentElement?.remove();
        }
        const searchContainer = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-search-container',
            attr: { style: 'padding:8px;border-bottom:1px solid var(--background-modifier-border);' }
        });

        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: '🔍 搜索指纹...',
            attr: {
                style: 'width:100%;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
            }
        });
        this.searchInput.value = this.filter.searchQuery;
        this.searchInput.addEventListener('input', (e) => {
            this.filter.searchQuery = (e.target as HTMLInputElement).value;
            this.renderFingerprintList();
        });

        this.tagFilter = searchContainer.createDiv({
            cls: 'nw-fingerprint-tag-filter',
            attr: { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;' }
        });

        const allTags = this.getAllTags();
        if (allTags.length > 0) {
            const allTag = this.createTagChip('全部', this.filter.selectedTag === null);
            allTag.addEventListener('click', () => {
                this.filter.selectedTag = null;
                this.renderSearchAndFilter();
                this.renderFingerprintList();
            });
            this.tagFilter.appendChild(allTag);

            allTags.slice(0, 10).forEach(tag => {
                const tagEl = this.createTagChip(tag, this.filter.selectedTag === tag);
                tagEl.addEventListener('click', () => {
                    this.filter.selectedTag = this.filter.selectedTag === tag ? null : tag;
                    this.renderSearchAndFilter();
                    this.renderFingerprintList();
                });
                this.tagFilter.appendChild(tagEl);
            });
        }
    }

    private createTagChip(tag: string, isActive: boolean): HTMLElement {
        const el = document.createElement('span');
        el.textContent = tag;
        el.className = 'nw-fingerprint-tag-chip';
        el.setAttribute('style', `
            padding:2px 8px;
            font-size:11px;
            border-radius:10px;
            cursor:pointer;
            ${isActive
                ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                : 'background:var(--background-secondary);color:var(--text-muted);'
            }
        `);
        return el;
    }

    private renderFingerprintList(): void {
        if (this.fingerprintList) {
            this.fingerprintList.remove();
        }

        this.fingerprintList = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-list',
            attr: { style: 'flex:1;overflow-y:auto;' }
        });

        const fingerprints = this.getCurrentFingerprints();

        if (this.isLoading) {
            this.fingerprintList.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '加载中...'
            });
            return;
        }

        if (fingerprints.length === 0) {
            this.fingerprintList.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '暂无指纹'
            });
            return;
        }

        fingerprints.forEach(fp => {
            const isSelected = this.selectedFingerprintId === fp.id;
            const item = this.fingerprintList.createDiv({
                cls: 'nw-fingerprint-list-item',
                attr: {
                    style: `padding:10px 12px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;${
                        isSelected ? 'background:var(--background-secondary-alt);' : ''
                    }`
                }
            });

            const header = item.createDiv({
                attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' }
            });

            const nameRow = header.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;' }
            });

            if (!fp.enabled) {
                nameRow.createEl('span', {
                    text: '🔇',
                    attr: { style: 'font-size:11px;opacity:0.6;' }
                });
            }

            nameRow.createEl('span', {
                text: fp.name,
                attr: {
                    style: `font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${
                        !fp.enabled ? 'opacity:0.5;' : ''
                    }`
                }
            });

            header.createEl('span', {
                text: SCOPE_ICONS[fp.scope],
                attr: { style: 'font-size:11px;flex-shrink:0;' }
            });

            const source = item.createDiv({
                attr: { style: 'font-size:11px;color:var(--text-muted);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }
            });
            source.textContent = fp.source || '未知来源';

            if (fp.tags.length > 0) {
                const tagsRow = item.createDiv({
                    attr: { style: 'display:flex;flex-wrap:wrap;gap:3px;' }
                });
                fp.tags.slice(0, 3).forEach(tag => {
                    tagsRow.createEl('span', {
                        text: tag,
                        attr: {
                            style: 'padding:1px 6px;font-size:10px;background:var(--background-secondary);color:var(--text-muted);border-radius:8px;'
                        }
                    });
                });
            }

            item.addEventListener('click', () => {
                this.selectedFingerprintId = fp.id;
                this.selectedFingerprintScope = fp.scope as FingerprintScope;
                this.renderFingerprintList();
                this.renderDetailPanel();
            });
        });

        const countInfo = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-count',
            attr: { style: 'padding:6px 12px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--background-modifier-border);' }
        });
        countInfo.textContent = `共 ${fingerprints.length} 个指纹`;
    }

    private renderDetailPanel(): void {
        this.rightPanel.empty();

        if (!this.selectedFingerprintId || !this.selectedFingerprintScope) {
            this.rightPanel.createDiv({
                attr: { style: 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-faint);font-size:14px;' },
                text: '👈 请从左侧选择一个指纹查看详情'
            });
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            this.rightPanel.createDiv({
                attr: { style: 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-faint);font-size:14px;' },
                text: '指纹不存在'
            });
            return;
        }

        const header = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-detail-header',
            attr: { style: 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--background-modifier-border);' }
        });

        const titleRow = header.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' }
        });

        titleRow.createEl('h3', {
            text: fp.name,
            attr: { style: 'margin:0;font-size:18px;' }
        });

        const statusBadge = titleRow.createEl('span', {
            text: fp.enabled ? '✅ 已启用' : '🔇 已禁用',
            attr: {
                style: `padding:4px 10px;font-size:12px;border-radius:12px;${
                    fp.enabled
                        ? 'background:rgba(46,204,113,0.15);color:#2ecc71;'
                        : 'background:rgba(0,0,0,0.1);color:var(--text-muted);'
                }`
            }
        });

        const metaRow = header.createDiv({
            attr: { style: 'display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-muted);' }
        });

        metaRow.createEl('span', { text: `${SCOPE_LABELS[fp.scope as FingerprintScope]}` });
        metaRow.createEl('span', { text: `来源: ${fp.source || '未知'}` });
        metaRow.createEl('span', { text: `提取时间: ${new Date(fp.extractedAt).toLocaleString()}` });
        metaRow.createEl('span', { text: `字数: ${fp.stats.wordCount.toLocaleString()}` });

        if (fp.tags.length > 0) {
            const tagsSection = header.createDiv({
                attr: { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;' }
            });
            fp.tags.forEach(tag => {
                tagsSection.createEl('span', {
                    text: tag,
                    attr: {
                        style: 'padding:3px 10px;font-size:11px;background:var(--background-secondary);color:var(--text-normal);border-radius:10px;'
                    }
                });
            });
        }

        this.renderStatsSection(fp);
        this.renderFeaturesSection(fp);
        this.renderSamplesSection(fp);
        this.renderActionsSection(fp);
    }

    private getSelectedFingerprint(): StyleFingerprint | undefined {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope) return undefined;
        return this.fingerprintLibrary?.getFingerprint(this.selectedFingerprintId, this.selectedFingerprintScope);
    }

    private renderStatsSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-stats-section nw-mb-lg'
        });

        section.createEl('h4', {
            text: '📊 统计特征',
            cls: 'nw-fp-section-h4'
        });

        const statsGrid = section.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;' }
        });

        const statsItems = [
            { label: '平均句长', value: fp.stats.avgSentenceLength.toFixed(1) + ' 字' },
            { label: '平均段长', value: fp.stats.avgParagraphLength.toFixed(1) + ' 句' },
            { label: '对话占比', value: (fp.stats.dialogueRatio * 100).toFixed(1) + '%' },
            { label: '描写占比', value: (fp.stats.descriptionRatio * 100).toFixed(1) + '%' },
        ];

        statsItems.forEach(item => {
            const card = statsGrid.createDiv({
                attr: {
                    style: 'padding:12px;background:var(--background-secondary);border-radius:6px;text-align:center;'
                }
            });
            card.createEl('div', {
                text: item.value,
                attr: { style: 'font-size:16px;font-weight:600;margin-bottom:4px;' }
            });
            card.createEl('div', {
                text: item.label,
                attr: { style: 'font-size:11px;color:var(--text-muted);' }
            });
        });
    }

    private renderFeaturesSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-features-section nw-mb-lg'
        });

        section.createEl('h4', {
            text: '🎨 风格特征',
            cls: 'nw-fp-section-h4'
        });

        const features = [
            { key: 'sentenceRhythm', label: '句式节奏' },
            { key: 'wordPreference', label: '用词偏好' },
            { key: 'narrativeStyle', label: '叙事风格' },
            { key: 'rhetoric', label: '修辞特点' },
            { key: 'dialogueStyle', label: '对话风格' },
            { key: 'paragraphStructure', label: '段落结构' },
            { key: 'overallTone', label: '整体基调' },
        ];

        features.forEach(f => {
            const value = (fp.features as unknown as Record<string, string>)[f.key];
            if (!value) return;

            const row = section.createDiv({
                attr: { style: 'margin-bottom:10px;' }
            });
            row.createEl('div', {
                text: f.label,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' }
            });
            row.createEl('div', {
                text: value,
                attr: { style: 'font-size:13px;line-height:1.5;padding:8px 12px;background:var(--background-secondary);border-radius:4px;' }
            });
        });
    }

    private renderSamplesSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-samples-section nw-mb-lg'
        });

        section.createEl('h4', {
            text: '📝 代表片段',
            cls: 'nw-fp-section-h4'
        });

        if (fp.samples.length === 0) {
            section.createEl('div', {
                text: '无代表片段',
                attr: { style: 'font-size:12px;color:var(--text-muted);' }
            });
            return;
        }

        fp.samples.slice(0, 3).forEach((sample, index) => {
            const sampleEl = section.createDiv({
                attr: {
                    style: 'margin-bottom:10px;padding:12px;background:var(--background-secondary);border-radius:4px;font-size:12px;line-height:1.6;border-left:3px solid var(--interactive-accent);'
                }
            });
            sampleEl.createEl('div', {
                text: `片段 ${index + 1}`,
                attr: { style: 'font-size:11px;color:var(--text-muted);margin-bottom:6px;' }
            });
            sampleEl.createEl('div', {
                text: sample,
                attr: { style: 'color:var(--text-normal);' }
            });
        });
    }

    private renderActionsSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-actions-section',
            attr: { style: 'margin-top:20px;padding-top:16px;border-top:1px solid var(--background-modifier-border);' }
        });

        section.createEl('h4', {
            text: '⚙️ 操作',
            cls: 'nw-fp-section-h4'
        });

        const actionsGrid = section.createDiv({
            attr: { style: 'display:flex;flex-wrap:wrap;gap:8px;' }
        });

        const toggleBtn = this.createActionButton(
            fp.enabled ? '🔇 禁用' : '✅ 启用',
            () => this.handleToggleEnabled()
        );
        actionsGrid.appendChild(toggleBtn);

        const editBtn = this.createActionButton('✏️ 编辑', () => this.handleEditFingerprint(fp));
        actionsGrid.appendChild(editBtn);

        // V2 详情查看入口（打开 FingerprintDetailModal，含 12 维详情）
        const detailBtn = this.createActionButton('🔍 V2 详情', () => this.handleOpenDetailModal(fp));
        actionsGrid.appendChild(detailBtn);

        // V2 强度调节入口
        const intensityBtn = this.createActionButton('🎚 强度调节', () => this.handleOpenIntensity(fp));
        actionsGrid.appendChild(intensityBtn);

        if (fp.scope === 'project') {
            const promoteBtn = this.createActionButton('⬆️ 提升为全局', () => this.handlePromoteToGlobal(fp));
            actionsGrid.appendChild(promoteBtn);
        }

        if (fp.scope === 'template') {
            const copyBtn = this.createActionButton('📋 复制到项目', () => this.handleCopyToProject(fp));
            actionsGrid.appendChild(copyBtn);
        }

        if (fp.scope === 'global') {
            const copyBtn = this.createActionButton('📋 复制到项目', () => this.handleCopyToProject(fp));
            actionsGrid.appendChild(copyBtn);
        }

        const deleteBtn = this.createActionButton('🗑️ 删除', () => this.handleDeleteFingerprint(), true);
        actionsGrid.appendChild(deleteBtn);
    }

    /** 打开 V2 详情 Modal（12 维完整展示） */
    private handleOpenDetailModal(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            library: this.fingerprintLibrary || undefined,
            project: this.plugin.getActiveProject() || undefined,
            canEdit: true,
            onToggle: async (updated) => {
                if (!this.fingerprintLibrary) return;
                updated.enabled = !updated.enabled;
                switch (updated.scope) {
                    case 'template': await this.fingerprintLibrary.updateTemplate(updated); break;
                    case 'global': await this.fingerprintLibrary.updateGlobal(updated); break;
                    case 'project': await this.fingerprintLibrary.updateProject(updated); break;
                }
                await this.loadAllFingerprints();
                this.renderFingerprintList();
                this.renderDetailPanel();
            },
            onReextract: () => {
                new Notice('请通过工具栏"从文本提取"或"从章节提取"重新生成');
            },
            onDelete: async () => {
                await this.handleDeleteFingerprint();
            },
            onOpenIntensity: (target) => this.handleOpenIntensity(target),
        }).open();
    }

    private createActionButton(text: string, onClick: () => void, isDanger = false): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-action-btn';
        btn.setAttribute('style', `
            padding:6px 14px;
            font-size:12px;
            cursor:pointer;
            border:1px solid var(--background-modifier-border);
            border-radius:4px;
            background:var(--background-secondary);
            color:${isDanger ? '#e74c3c' : 'var(--text-normal)'};
        `);
        btn.addEventListener('click', onClick);
        return btn;
    }

    private async handleAddFingerprint(): Promise<void> {
        if (!this.extractor || !this.fingerprintLibrary) {
            new Notice('提取器未初始化');
            return;
        }

        const modal = new AddFingerprintModal(this.app, {
            scope: this.filter.activeScope,
            extractor: this.extractor,
            onCompleted: async (fp) => {
                switch (fp.scope) {
                    case 'template':
                        await this.fingerprintLibrary!.addTemplate(fp);
                        break;
                    case 'global':
                        await this.fingerprintLibrary!.addGlobal(fp);
                        break;
                    case 'project':
                        await this.fingerprintLibrary!.addProject(fp);
                        break;
                }
                await this.loadAllFingerprints();
                this.selectedFingerprintId = fp.id;
                this.selectedFingerprintScope = fp.scope as FingerprintScope;
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
                new Notice('✅ 指纹添加成功');
            }
        });
        modal.open();
    }

    private async handleExtractFromText(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        const activeView = this.app.workspace.getActiveViewOfType(ItemView);
        let selectedText = '';

        if (activeView) {
            const editor = (activeView as any).editor;
            if (editor && typeof editor.getSelection === 'function') {
                selectedText = editor.getSelection();
            }
        }

        if (!selectedText && activeFile) {
            const content = await this.app.vault.read(activeFile);
            selectedText = content;
        }

        if (!selectedText || selectedText.length < 100) {
            new Notice('请选择或打开至少 100 字的文本');
            return;
        }

        if (!this.extractor || !this.fingerprintLibrary) {
            new Notice('提取器未初始化');
            return;
        }

        const modal = new AddFingerprintModal(this.app, {
            scope: this.filter.activeScope,
            extractor: this.extractor,
            onCompleted: async (fp) => {
                switch (fp.scope) {
                    case 'template':
                        await this.fingerprintLibrary!.addTemplate(fp);
                        break;
                    case 'global':
                        await this.fingerprintLibrary!.addGlobal(fp);
                        break;
                    case 'project':
                        await this.fingerprintLibrary!.addProject(fp);
                        break;
                }
                await this.loadAllFingerprints();
                this.selectedFingerprintId = fp.id;
                this.selectedFingerprintScope = fp.scope as FingerprintScope;
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
                new Notice('✅ 指纹提取成功');
            }
        });
        modal.textValue = selectedText;
        modal.open();
    }

    private async handleExtractFromChapters(): Promise<void> {
        if (!this.currentProjectPath) {
            new Notice('请先在项目中打开此面板');
            return;
        }

        const projectPath = this.currentProjectPath;
        const bodyDir = `${projectPath}/03-大纲与章节/正文`;

        try {
            const exists = await this.app.vault.adapter.exists(bodyDir);
            if (!exists) {
                new Notice('未找到正文目录，请确保项目结构正确');
                return;
            }

            const chapters: string[] = [];
            const collectChapters = async (dir: string) => {
                try {
                    const list = await this.app.vault.adapter.list(dir);
                    for (const file of list.files) {
                        if (file.endsWith('.md')) {
                            chapters.push(file);
                        }
                    }
                    for (const folder of list.folders) {
                        await collectChapters(folder);
                    }
                } catch (e) {
                    log.warn('遍历章节失败:', dir, e);
                }
            };
            await collectChapters(bodyDir);

            if (chapters.length === 0) {
                new Notice('未找到章节文件');
                return;
            }

            const modal = new ExtractFromChaptersModal(
                this.app,
                chapters,
                async (selectedChapters, fingerprintName) => {
                    if (!this.extractor || !this.fingerprintLibrary) {
                        new Notice('提取器未初始化');
                        return;
                    }

                    new Notice(`正在从 ${selectedChapters.length} 个章节提取指纹...`, 3000);

                    let allText = '';
                    for (const chapPath of selectedChapters) {
                        try {
                            const content = await this.app.vault.adapter.read(chapPath);
                            allText += content + '\n\n';
                        } catch (e) {
                            log.warn('读取章节失败:', chapPath, e);
                        }
                    }

                    if (allText.length < 500) {
                        new Notice('章节内容过少，至少需要 500 字');
                        return;
                    }

                    try {
                        const fp = await this.extractor.extract(allText, {
                            scope: 'project',
                            name: fingerprintName || '从章节提取',
                            source: '章节提取',
                        });

                        await this.fingerprintLibrary.addProject(fp);
                        await this.loadAllFingerprints();
                        this.selectedFingerprintId = fp.id;
                        this.selectedFingerprintScope = 'project';
                        this.filter.activeScope = 'project';
                        this.renderSearchAndFilter();
                        this.renderFingerprintList();
                        this.renderDetailPanel();
                        new Notice('✅ 从章节提取指纹成功');
                    } catch (e) {
                        log.error('提取指纹失败:', e);
                        new Notice(`提取失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            );
            modal.open();
        } catch (e) {
            log.error('读取章节列表失败:', e);
            new Notice('读取章节列表失败');
        }
    }

    private handleImportFromKnowledge(): void {
        new Notice('📚 从知识库导入功能待实现');
    }

    private async handleToggleEnabled(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) return;

        const fp = this.getSelectedFingerprint();
        if (!fp) return;

        if (fp.enabled) {
            switch (this.selectedFingerprintScope) {
                case 'template': await this.fingerprintLibrary.disableTemplate(fp.id); break;
                case 'global': await this.fingerprintLibrary.disableGlobal(fp.id); break;
                case 'project': await this.fingerprintLibrary.disableProject(fp.id); break;
            }
        } else {
            switch (this.selectedFingerprintScope) {
                case 'template': await this.fingerprintLibrary.enableTemplate(fp.id); break;
                case 'global': await this.fingerprintLibrary.enableGlobal(fp.id); break;
                case 'project': await this.fingerprintLibrary.enableProject(fp.id); break;
            }
        }

        await this.loadAllFingerprints();
        this.renderFingerprintList();
        this.renderDetailPanel();
        new Notice(fp.enabled ? '🔇 已禁用' : '✅ 已启用');
    }

    private async handleDeleteFingerprint(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) return;

        const fp = this.getSelectedFingerprint();
        if (!fp) return;

        if (!confirm(`确定要删除指纹「${fp.name}」吗？此操作不可恢复。`)) return;

        switch (this.selectedFingerprintScope) {
            case 'template': await this.fingerprintLibrary.deleteTemplate(fp.id); break;
            case 'global': await this.fingerprintLibrary.deleteGlobal(fp.id); break;
            case 'project': await this.fingerprintLibrary.deleteProject(fp.id); break;
        }

        this.selectedFingerprintId = null;
        this.selectedFingerprintScope = null;
        await this.loadAllFingerprints();
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
        new Notice('🗑️ 指纹已删除');
    }

    private handleEditFingerprint(fp: StyleFingerprint): void {
        new EditFingerprintModal(this.app, fp, async (updated) => {
            if (!this.fingerprintLibrary) return;
            switch (fp.scope) {
                case 'template': await this.fingerprintLibrary.updateTemplate(updated); break;
                case 'global': await this.fingerprintLibrary.updateGlobal(updated); break;
                case 'project': await this.fingerprintLibrary.updateProject(updated); break;
            }
            await this.loadAllFingerprints();
            this.renderSearchAndFilter();
            this.renderFingerprintList();
            this.renderDetailPanel();
            new Notice('✅ 指纹已更新');
        }).open();
    }

    private async handlePromoteToGlobal(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) return;
        const result = await this.fingerprintLibrary.copyFingerprint('project', 'global', fp.id);
        if (result) {
            await this.loadAllFingerprints();
            this.filter.activeScope = 'global';
            this.selectedFingerprintId = result.id;
            this.selectedFingerprintScope = 'global';
            this.renderScopeTabs();
            this.renderSearchAndFilter();
            this.renderFingerprintList();
            this.renderDetailPanel();
            new Notice('⬆️ 已提升为全局指纹');
        }
    }

    private async handleCopyToProject(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) return;
        const project = this.plugin.getActiveProject();
        if (!project) {
            new Notice('请先打开一个项目');
            return;
        }
        const result = await this.fingerprintLibrary.copyFingerprint(
            fp.scope as FingerprintScope,
            'project',
            fp.id,
            project
        );
        if (result) {
            await this.loadAllFingerprints();
            this.filter.activeScope = 'project';
            this.selectedFingerprintId = result.id;
            this.selectedFingerprintScope = 'project';
            this.renderScopeTabs();
            this.renderSearchAndFilter();
            this.renderFingerprintList();
            this.renderDetailPanel();
            new Notice('📋 已复制到项目');
        }
    }

    /** 打开 V2 多指纹融合预览 Modal */
    private handleBlendFingerprints(): void {
        if (!this.fingerprintLibrary) {
            new Notice('指纹库未初始化');
            return;
        }
        const currentFps = this.getCurrentFingerprints();
        if (currentFps.length === 0) {
            new Notice('当前作用域下没有可用指纹');
            return;
        }
        const project = this.plugin.getActiveProject() || undefined;
        new FingerprintBlendModal(this.app, {
            fingerprints: currentFps,
            library: this.fingerprintLibrary,
            scope: this.filter.activeScope,
            project,
            onSaved: async () => {
                await this.loadAllFingerprints();
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
            },
        }).open();
    }

    /** 批量升级当前作用域指纹到 V2 维度 */
    private async handleMigrateToV2(): Promise<void> {
        if (!this.fingerprintLibrary) {
            new Notice('指纹库未初始化');
            return;
        }
        const scope = this.filter.activeScope;
        if (!confirm(`确定要将${SCOPE_LABELS[scope]}下所有 V1 指纹升级到 V2 12 维格式吗？\n\n升级后：\n- 原 V1 7 维扩展为 12 维\n- 新增 5 维标记为"待补充"\n- 自动备份原始数据到 .v1.bak 文件\n- 迁移失败自动回滚`)) {
            return;
        }
        try {
            const result = await this.fingerprintLibrary.migrateV1ToV2Dimensions(scope);
            if (result.success) {
                if (result.migrated > 0) {
                    new Notice(`✅ 已升级 ${result.migrated} 个指纹到 V2 格式`);
                } else {
                    new Notice('ℹ️ 当前作用域无 V1 指纹需要升级');
                }
                await this.loadAllFingerprints();
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
            } else {
                new Notice(`❌ 升级失败：${result.error || '未知错误'}`);
            }
        } catch (e) {
            log.warn('[WritingFingerprintView] V2 升级失败:', e);
            new Notice(`❌ 升级失败：${(e as Error).message}`);
        }
    }

    /** 打开 V2 强度调节 Modal */
    private handleOpenIntensity(fp: StyleFingerprint): void {
        if (!this.fingerprintLibrary) {
            new Notice('指纹库未初始化');
            return;
        }
        const project = this.plugin.getActiveProject() || undefined;
        new FingerprintIntensityModal(this.app, {
            fingerprint: fp,
            library: this.fingerprintLibrary,
            project,
        }).open();
    }

    public async refreshForProject(project: string): Promise<void> {
        if (this.fingerprintLibrary) {
            (this.fingerprintLibrary as any).project = project;
        } else {
            this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, project);
        }
        await this.loadAllFingerprints();
        this.selectedFingerprintId = null;
        this.selectedFingerprintScope = null;
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
    }
}

class EditFingerprintModal extends Modal {
    private fingerprint: StyleFingerprint;
    private onSave: (fp: StyleFingerprint) => void;
    private nameValue: string;
    private sourceValue: string;
    private tagsValue: string;

    constructor(app: App, fingerprint: StyleFingerprint, onSave: (fp: StyleFingerprint) => void) {
        super(app);
        this.fingerprint = { ...fingerprint };
        this.onSave = onSave;
        this.nameValue = fingerprint.name;
        this.sourceValue = fingerprint.source;
        this.tagsValue = fingerprint.tags.join(', ');
    }

    onOpen() {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '✏️ 编辑指纹' });

        new Setting(contentEl)
            .setName('指纹名称')
            .addText(t => t
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName('来源名称')
            .addText(t => t
                .setValue(this.sourceValue)
                .onChange(v => this.sourceValue = v));

        new Setting(contentEl)
            .setName('标签')
            .setDesc('用逗号分隔多个标签')
            .addText(t => t
                .setValue(this.tagsValue)
                .onChange(v => this.tagsValue = v));

        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;' }
        });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            attr: { style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-secondary);' }
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存',
            attr: { style: 'padding:6px 16px;cursor:pointer;border:none;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);' }
        });
        saveBtn.addEventListener('click', () => {
            this.fingerprint.name = this.nameValue.trim() || this.fingerprint.name;
            this.fingerprint.source = this.sourceValue.trim();
            this.fingerprint.tags = this.tagsValue.split(',').map(t => t.trim()).filter(Boolean);
            this.onSave(this.fingerprint);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class ExtractFromChaptersModal extends Modal {
    private chapters: string[];
    private selectedChapters: Set<string> = new Set();
    private fingerprintName: string = '';
    private onConfirm: (selectedChapters: string[], fingerprintName: string) => void;

    constructor(
        app: App,
        chapters: string[],
        onConfirm: (selectedChapters: string[], fingerprintName: string) => void
    ) {
        super(app);
        this.chapters = chapters;
        this.onConfirm = onConfirm;
        this.fingerprintName = `章节指纹_${new Date().toLocaleDateString()}`;
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.width = '100%';

        contentEl.createEl('h3', { text: '📖 从章节提取写作指纹' });

        const desc = contentEl.createEl('p', {
            text: `共找到 ${this.chapters.length} 个章节，选择要提取的章节：`,
            attr: { style: 'font-size:13px;color:var(--text-muted);margin:8px 0 16px 0;' }
        });
        void desc;

        new Setting(contentEl)
            .setName('指纹名称')
            .addText(t => t
                .setValue(this.fingerprintName)
                .onChange(v => this.fingerprintName = v));

        const btnRow1 = contentEl.createDiv({
            attr: { style: 'display:flex;gap:8px;margin:12px 0;' }
        });

        const selectAllBtn = btnRow1.createEl('button', {
            text: '全选',
            cls: 'nw-btn',
            attr: { style: 'flex:1;' }
        });
        selectAllBtn.addEventListener('click', () => {
            this.chapters.forEach(c => this.selectedChapters.add(c));
            this.renderChapterList();
        });

        const deselectAllBtn = btnRow1.createEl('button', {
            text: '取消全选',
            cls: 'nw-btn',
            attr: { style: 'flex:1;' }
        });
        deselectAllBtn.addEventListener('click', () => {
            this.selectedChapters.clear();
            this.renderChapterList();
        });

        const chapterListContainer = contentEl.createDiv({
            attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;margin:8px 0;' }
        });

        const renderChapterList = () => {
            chapterListContainer.empty();
            
            if (this.chapters.length === 0) {
                chapterListContainer.createDiv({
                    text: '未找到章节',
                    attr: { style: 'padding:20px;text-align:center;color:var(--text-faint);' }
                });
                return;
            }

            this.chapters.forEach(chapterPath => {
                const fileName = chapterPath.split('/').pop() || chapterPath;
                const item = chapterListContainer.createDiv({
                    attr: { 
                        style: 'padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--background-modifier-border);' 
                    }
                });

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = this.selectedChapters.has(chapterPath);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        this.selectedChapters.add(chapterPath);
                    } else {
                        this.selectedChapters.delete(chapterPath);
                    }
                });
                item.appendChild(checkbox);

                const nameEl = document.createElement('span');
                nameEl.textContent = fileName;
                nameEl.style.cssText = 'font-size:13px;flex:1;';
                item.appendChild(nameEl);

                item.addEventListener('click', () => {
                    checkbox.checked = !checkbox.checked;
                    if (checkbox.checked) {
                        this.selectedChapters.add(chapterPath);
                    } else {
                        this.selectedChapters.delete(chapterPath);
                    }
                });
            });
        };

        this.renderChapterList = renderChapterList.bind(this);
        renderChapterList();

        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;' }
        });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            cls: 'nw-btn'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = btnRow.createEl('button', {
            text: '开始提取',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
        });
        confirmBtn.addEventListener('click', () => {
            if (this.selectedChapters.size === 0) {
                new Notice('请至少选择一个章节');
                return;
            }
            this.onConfirm([...this.selectedChapters], this.fingerprintName);
            this.close();
        });
    }

    private renderChapterList(): void {
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
