import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { StyleFingerprintLibrary, StyleFingerprint } from '../../engine/style-fingerprint-library';
import { FingerprintExtractor, ExtractionProgress } from '../../engine/fingerprint-extractor';
import { applyNwScope } from '../../utils/helpers';
import { AddFingerprintModal } from '../fingerprint-library-modal';
import { createEmptyState } from '../components/empty-state';
import { OperationConfirmModal } from '../components/progress';
import { EmbeddingProviderFactory } from '../../engine/embedding/provider-factory';
import type { EmbeddingProvider } from '../../engine/embedding/embedding-provider';
import { LocalVectorStore } from '../../engine/local-vector-store';
import { ENGINE_NAMES } from '../../engine/engine-registry';
import { AIEngine } from '../../engine/ai-engine';
import { FingerprintDetailModal } from '../fingerprint-detail-modal';
import { isSourceOnlyFingerprintScope } from '../fingerprint-utils';
import { FingerprintIntensityModal } from '../fingerprint-intensity-modal';
import { FingerprintBlendModal } from '../fingerprint-blend-modal';
import { KnowledgeToFingerprintConverter } from '../../engine/knowledge-to-fingerprint-converter';
import { classifyFingerprint, mergeClassificationTags } from '../../shared/content-classifier';
import type { BookBasicInfo } from '../../services/knowledge-base-manager';
import { createLogger } from '../../shared/logger';
import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from '../model-quick-switcher';


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
    /** 项目切换后重建向量库/提取器要用（两者都绑定项目路径） */
    private extractionProvider: EmbeddingProvider | null = null;
    private extractionEngine: AIEngine | null = null;

    private filter: FilterState = {
        searchQuery: '',
        selectedTag: null,
        activeScope: 'project',
    };

    private templateFingerprints: StyleFingerprint[] = [];
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];

    /** 全局指纹在本项目下的生效启用状态（项目级覆盖优先于全局默认） */
    private effectiveGlobalEnabled = new Map<string, boolean>();

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
    private countEl: HTMLElement | null = null;
    /** 侧栏模型快速切换器（原右下角状态栏浮窗的替代入口） */
    private modelSwitcher: ModelQuickSwitcherHandle | null = null;

    private isLoading = false;
    private loadError: string | null = null;

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
        this.modelSwitcher?.destroy();
        this.modelSwitcher = null;
        await this.fingerprintLibrary?.flush();
    }

    private async initLibrary(): Promise<void> {
        let project: string | null = null;
        try {
            project = this.plugin.getActiveProject();
        } catch (e) {
            // 边界：项目解析异常不应阻断指纹库打开，按无项目处理并回落全局层
            log.warn('[WritingFingerprintView] 活动项目解析失败，按无项目处理:', e);
        }
        this.filter.activeScope = project ? 'project' : 'global';
        log.info(`[WritingFingerprintView] 初始化作用域: project=${project ?? '(none)'}, scope=${this.filter.activeScope}`);

        this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, project || undefined);

        try {
            const aiEngine = this.plugin.engineRegistry.get<AIEngine>(ENGINE_NAMES.AI_ENGINE);
            const embeddingProvider = EmbeddingProviderFactory.create(this.plugin.settings);
            this.extractionEngine = aiEngine;
            this.extractionProvider = embeddingProvider;
            this.vectorStore = new LocalVectorStore(this.app, project ? 'project' : 'global', embeddingProvider, project || 'default');
            this.extractor = new FingerprintExtractor(aiEngine, embeddingProvider, this.vectorStore);
        } catch (e) {
            log.warn('[WritingFingerprintView] 提取器初始化失败:', e);
        }
    }

    /** 活动项目变化后重建向量库与提取器（它们构造时就把项目路径固化进去了） */
    private rebindExtractionTarget(project?: string): void {
        if (!this.extractionProvider || !this.extractionEngine) return;
        try {
            this.vectorStore = new LocalVectorStore(
                this.app,
                project ? 'project' : 'global',
                this.extractionProvider,
                project || 'default',
            );
            this.extractor = new FingerprintExtractor(this.extractionEngine, this.extractionProvider, this.vectorStore);
        } catch (e) {
            log.warn('[WritingFingerprintView] 项目切换后重建提取器失败:', e);
        }
    }

    private async loadAllFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.isLoading = true;
        this.loadError = null;

        try {
            // 活动项目跟着当前文件走：每次重载先把库绑定的项目同步过来，
            // 否则切换项目后仍会读写上一个项目的指纹文件（提取、导入、删除全错位）。
            const activeProject = this.plugin.getActiveProject() || undefined;
            if (activeProject !== this.fingerprintLibrary.activeProject) {
                this.fingerprintLibrary.setProject(activeProject);
                this.rebindExtractionTarget(activeProject);
            }

            this.templateFingerprints = await this.fingerprintLibrary.loadTemplate();
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();

            // 全局指纹的真实生效状态是「项目级覆盖优先」（注入侧用
            // isGlobalEnabledForProject）。旧实现直接渲染 fp.enabled（全局默认），
            // 项目里改过覆盖时视图显示错、点开关也改不到当前项目在用的状态。
            const projectForState = activeProject;
            await this.fingerprintLibrary.loadGlobalState(projectForState);
            this.effectiveGlobalEnabled.clear();
            for (const fp of this.globalFingerprints) {
                this.effectiveGlobalEnabled.set(
                    fp.id,
                    this.fingerprintLibrary.isGlobalEnabledForProject(fp.id, projectForState),
                );
            }
            if (this.selectedFingerprintId && !this.getSelectedFingerprint()) {
                this.selectedFingerprintId = null;
                this.selectedFingerprintScope = null;
            }
        } catch (e) {
            this.loadError = e instanceof Error ? e.message : String(e);
            log.warn('[WritingFingerprintView] 加载指纹失败:', e);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 翻转并持久化启用状态。
     *
     * 全局层在有项目时写「项目级覆盖」——注入侧读的就是 isGlobalEnabledForProject，
     * 直接改全局默认不会影响当前项目，表现为开关点了没反应。
     * 没有打开项目时才退回修改全局默认。
     */
    private async persistEnabledToggle(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) return;
        const next = !this.isEffectivelyEnabled(fp);
        const project = this.plugin.getActiveProject() || undefined;

        if (fp.scope === 'global') {
            if (project) {
                await this.fingerprintLibrary.setGlobalEnabledForProject(fp.id, next, project);
            } else if (next) {
                await this.fingerprintLibrary.enableGlobal(fp.id);
            } else {
                await this.fingerprintLibrary.disableGlobal(fp.id);
            }
            return;
        }
        if (fp.scope === 'project') {
            if (next) await this.fingerprintLibrary.enableProject(fp.id);
            else await this.fingerprintLibrary.disableProject(fp.id);
        }
    }

    /** 该指纹在当前项目下是否真的生效（全局层看项目覆盖，其它层看自身） */
    private isEffectivelyEnabled(fp: StyleFingerprint): boolean {
        if (fp.scope !== 'global') return fp.enabled;
        return this.effectiveGlobalEnabled.get(fp.id) ?? fp.enabled;
    }

    /** 渲染用投影：把项目级覆盖写进 enabled，不改动库内对象 */
    private withEffectiveEnabled(fp: StyleFingerprint): StyleFingerprint {
        const enabled = this.isEffectivelyEnabled(fp);
        return enabled === fp.enabled ? fp : { ...fp, enabled };
    }

    private getScopeFingerprints(scope: FingerprintScope): StyleFingerprint[] {
        switch (scope) {
            case 'template': return this.templateFingerprints;
            case 'global': return this.globalFingerprints;
            case 'project': return this.projectFingerprints;
        }
    }

    private getCurrentFingerprints(): StyleFingerprint[] {
        let filtered = this.getScopeFingerprints(this.filter.activeScope);

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
            cls: "nw-fingerprint-main-layout nw-u-d-flex-2 nw-u-h-100-2 nw-u-w-100-2",
            attr: {}
        });

        this.leftSidebar = mainLayout.createDiv({
            cls: "nw-fingerprint-left-sidebar nw-u-w-300px nw-u-minw-240px nw-u-maxw-400px nw-u-brt-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-fd-column-2",
            attr: {}
        });

        // 界面流转：直达工作台 / 协同写作 / 知识库
        const navBtnStyle = 'padding:4px 10px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;cursor:pointer;background:var(--background-primary);color:var(--text-muted);';
        const navRow = this.leftSidebar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-p-8px-2 nw-u-bb-1px-solid-background-m-2 nw-u-fwr-wrap-2' });
        const backBtn = navRow.createEl('button', { text: '← 工作台', attr: { style: navBtnStyle, title: '返回完整写作工作台' } });
        backBtn.addEventListener('click', () => void this.plugin.openFullWriterView());
        const coBtn = navRow.createEl('button', { text: '✍️ 协同', attr: { style: navBtnStyle, title: '打开句级协同写作工作台' } });
        coBtn.addEventListener('click', () => void this.plugin.openCoWritingFromActiveContext());
        const kbBtn = navRow.createEl('button', { text: '📚 知识库管理', attr: { style: navBtnStyle, title: '打开知识库管理视图' } });
        kbBtn.addEventListener('click', () => void this.plugin.openKnowledgeBaseView());

        // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到指纹库侧栏（四个主界面之一）。
        this.modelSwitcher = renderModelQuickSwitcher(this.leftSidebar, this.plugin);

        this.rightPanel = mainLayout.createDiv({
            cls: "nw-fingerprint-right-panel nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-16px-2",
            attr: {}
        });
    }

    private renderScopeTabs(): void {
        // 记住原位置：createDiv 会追加到侧栏末尾，重渲染后标签会掉到工具栏下面。
        const previous = this.scopeTabs;
        const nextSibling = previous?.nextSibling ?? null;
        if (previous) previous.remove();

        const container = this.leftSidebar.createDiv({
            cls: "nw-fingerprint-scope-tabs nw-u-d-flex-2 nw-u-bb-1px-solid-background-m-2",
            attr: {}
        });

        this.scopeTabs = container;
        if (nextSibling && nextSibling.parentElement === this.leftSidebar) {
            this.leftSidebar.insertBefore(container, nextSibling);
        }

        const scopes: FingerprintScope[] = ['template', 'global', 'project'];
        scopes.forEach(scope => {
            const tab = container.createDiv({
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
            cls: "nw-fingerprint-toolbar nw-u-p-8px-2 nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-4px-2",
            attr: {}
        });

        const addBtn = this.createToolbarButton('➕ 新建', () => this.handleAddFingerprint(), false, '新建一个写作指纹（手动填写特征）');
        const extractBtn = this.createToolbarButton('📝 从文本提取', () => this.handleExtractFromText(), false, '粘贴文本，AI 提取写作指纹');
        const extractChapterBtn = this.createToolbarButton('📖 从章节提取', () => this.handleExtractFromChapters(), false, '从已有章节正文提取写作指纹');
        const importBtn = this.createToolbarButton('📚 从知识库导入', () => this.handleImportFromKnowledge(), false, '从知识库书籍拆解结果导入为写作指纹');
        const blendBtn = this.createToolbarButton('🎨 融合预览', () => this.handleBlendFingerprints(), false, '预览多个指纹融合后的效果');
        const migrateBtn = this.createToolbarButton('⬆ 批量升级 V2', () => this.handleMigrateToV2(), false, '批量升级指纹到 V2 12 维维度');
        const deleteBtn = this.createToolbarButton('🗑️ 删除', () => this.handleDeleteFingerprint(), true, '删除选中指纹（不可恢复）');
        const toggleBtn = this.createToolbarButton('🔌 启用/禁用', () => this.handleToggleEnabled(), false, '启用或禁用选中指纹');
        const classifyBtn = this.createToolbarButton('🏷️ 自动归类', () => void this.handleAutoClassify(), false, '按本地规则为选中指纹归类并写入标签');

        this.toolbar.appendChild(addBtn);
        this.toolbar.appendChild(extractBtn);
        this.toolbar.appendChild(extractChapterBtn);
        this.toolbar.appendChild(importBtn);
        this.toolbar.appendChild(blendBtn);
        this.toolbar.appendChild(migrateBtn);
        this.toolbar.appendChild(classifyBtn);
        this.toolbar.appendChild(deleteBtn);
        this.toolbar.appendChild(toggleBtn);
    }

    private createToolbarButton(text: string, onClick: () => void, isDanger = false, title = ''): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-toolbar-btn';
        if (title) btn.setAttribute('title', title);
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
        const previous = this.searchInput?.parentElement ?? null;
        if (previous) previous.remove();
        const anchor = this.fingerprintList ?? null;

        const searchContainer = this.leftSidebar.createDiv({
            cls: "nw-fingerprint-search-container nw-u-p-8px-2 nw-u-bb-1px-solid-background-m-2",
            attr: {}
        });

        // 重渲染要插回指纹列表之前：直接 append 会把搜索框挤到列表下面。
        if (anchor && anchor.parentElement === this.leftSidebar) {
            this.leftSidebar.insertBefore(searchContainer, anchor);
        }

        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: '🔍 搜索指纹...',
            cls: 'nw-u-w-100-2 nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2 nw-u-bx-border-box'
        });
        this.searchInput.value = this.filter.searchQuery;
        this.searchInput.addEventListener('input', (e) => {
            this.filter.searchQuery = (e.target as HTMLInputElement).value;
            this.renderFingerprintList();
        });

        this.tagFilter = searchContainer.createDiv({
            cls: "nw-fingerprint-tag-filter nw-u-margintop-8px-2 nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-4px-2",
            attr: {}
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
            cls: "nw-fingerprint-list nw-u-flex-1-2 nw-u-ovy-auto-2",
            attr: {}
        });

        const fingerprints = this.getCurrentFingerprints();

        if (this.isLoading) {
            this.updateCountLabel(null);
            this.fingerprintList.createDiv({
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
                text: '加载中...'
            });
            return;
        }

        if (this.loadError) {
            this.updateCountLabel(null);
            const errorBox = this.fingerprintList.createDiv({ cls: 'nw-fingerprint-error' });
            errorBox.createDiv({ text: '⚠️ 指纹加载失败', cls: 'nw-fingerprint-error-title' });
            errorBox.createDiv({ text: this.loadError, cls: 'nw-fingerprint-error-detail' });
            const retry = errorBox.createEl('button', { text: '重试', cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
            retry.onclick = () => { void this.loadAllFingerprints().then(() => this.renderFingerprintList()); };
            return;
        }

        if (fingerprints.length === 0) {
            this.updateCountLabel(0);
            // NBI-01: 当前层为空时给出可执行引导，优先指向已有数据的其它层
            const otherScopes = (['template', 'global', 'project'] as FingerprintScope[])
                .filter(scope => scope !== this.filter.activeScope && this.getScopeFingerprints(scope).length > 0);
            const description = otherScopes.length > 0
                ? `当前层暂无指纹，可切换到${otherScopes.map(scope => SCOPE_LABELS[scope]).join(' / ')}查看`
                : '从章节文本提取写作指纹，用于风格对齐与参考';
            const emptyState = createEmptyState({
                icon: 'default',
                title: '暂无指纹',
                description
            });
            this.fingerprintList.appendChild(emptyState);
            return;
        }

        fingerprints.forEach(rawFp => {
            // 全局层按项目级覆盖显示生效状态（渲染用投影，不改库内对象）
            const fp = this.withEffectiveEnabled(rawFp);
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
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-4px-2'
            });

            const nameRow = header.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-flex-1-2 nw-u-minw-0-2'
            });

            if (!fp.enabled) {
                nameRow.createEl('span', {
                    text: '🔇',
                    cls: 'nw-u-fs-11px-2 nw-u-op-0-6'
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
                cls: 'nw-u-fs-11px-2 nw-u-fsh-0-2'
            });

            const source = item.createDiv({
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2'
            });
            source.textContent = fp.source || '未知来源';

            const classification = classifyFingerprint(fp);
            if (classification.tags.length > 0) {
                const classRow = item.createDiv({ cls: 'nw-fingerprint-class-row' });
                classRow.createSpan({ text: classification.primary, cls: 'nw-fingerprint-class-primary' });
                classRow.createSpan({ text: `${classification.tags.length} 项`, cls: 'nw-fingerprint-class-count' });
            }

            if (fp.tags.length > 0) {
                const tagsRow = item.createDiv({
                    cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-3px'
                });
                fp.tags.slice(0, 3).forEach(tag => {
                    tagsRow.createEl('span', {
                        text: tag,
                        cls: 'nw-u-p-1px-6px-2 nw-u-fs-10px-2 nw-u-bg-background-secondary-2 nw-u-c-text-muted-2 nw-u-brd-8px-2'
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

        this.updateCountLabel(fingerprints.length);
    }

    private updateCountLabel(count: number | null): void {
        this.countEl?.remove();
        this.countEl = null;
        if (count === null) return;
        this.countEl = this.leftSidebar.createDiv({
            cls: "nw-fingerprint-count nw-u-p-6px-12px nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-bt-1px-solid-background-m-2",
            attr: {}
        });
        this.countEl.textContent = `共 ${count} 个指纹`;
    }

    private renderDetailPanel(): void {
        this.rightPanel.empty();

        if (!this.selectedFingerprintId || !this.selectedFingerprintScope) {
            this.rightPanel.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-center-2 nw-u-h-100-2 nw-u-c-text-faint-2 nw-u-fs-14px-2',
                text: '👈 请从左侧选择一个指纹查看详情'
            });
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            this.rightPanel.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-center-2 nw-u-h-100-2 nw-u-c-text-faint-2 nw-u-fs-14px-2',
                text: '指纹不存在'
            });
            return;
        }

        const header = this.rightPanel.createDiv({
            cls: "nw-fingerprint-detail-header nw-u-marginbottom-16px-2 nw-u-paddingbottom-12px nw-u-bb-1px-solid-background-m-2",
            attr: {}
        });

        const titleRow = header.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2'
        });

        titleRow.createEl('h3', {
            text: fp.name,
            cls: 'nw-u-m-0-2 nw-u-fs-18px-2'
        });

        const effectiveEnabled = this.isEffectivelyEnabled(fp);
        const statusBadge = titleRow.createEl('span', {
            text: effectiveEnabled ? '✅ 已启用' : '🔇 已禁用',
            attr: {
                style: `padding:4px 10px;font-size:12px;border-radius:12px;${
                    effectiveEnabled
                        ? 'background:rgba(46,204,113,0.15);color:#2ecc71;'
                        : 'background:rgba(0,0,0,0.1);color:var(--text-muted);'
                }`
            }
        });

        const metaRow = header.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-12px-2 nw-u-fs-12px-2 nw-u-c-text-muted-2'
        });

        metaRow.createEl('span', { text: `${SCOPE_LABELS[fp.scope as FingerprintScope]}` });
        metaRow.createEl('span', { text: `来源: ${fp.source || '未知'}` });
        metaRow.createEl('span', { text: `提取时间: ${new Date(fp.extractedAt).toLocaleString()}` });
        metaRow.createEl('span', { text: `字数: ${fp.stats.wordCount.toLocaleString()}` });

        if (fp.tags.length > 0) {
            const tagsSection = header.createDiv({
                cls: 'nw-u-margintop-8px-2 nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-6px-2'
            });
            fp.tags.forEach(tag => {
                tagsSection.createEl('span', {
                    text: tag,
                    cls: 'nw-u-p-3px-10px-2 nw-u-fs-11px-2 nw-u-bg-background-secondary-2 nw-u-c-text-normal-2 nw-u-brd-10px-2'
                });
            });
        }

        this.renderClassificationSection(fp);
        this.renderStatsSection(fp);
        this.renderFeaturesSection(fp);
        this.renderSamplesSection(fp);
        this.renderActionsSection(fp);
    }

    private getSelectedFingerprint(): StyleFingerprint | undefined {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope) return undefined;
        return this.fingerprintLibrary?.getFingerprint(this.selectedFingerprintId, this.selectedFingerprintScope);
    }

    private renderClassificationSection(fp: StyleFingerprint): void {
        const classification = classifyFingerprint(fp);
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-class-section nw-mb-lg'
        });

        const titleRow = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2'
        });
        titleRow.createEl('h4', {
            text: '🏷️ 自动分类',
            cls: 'nw-fp-section-h4 nw-u-m-0-2'
        });
        titleRow.createEl('span', {
            text: classification.primary,
            cls: 'nw-fingerprint-class-primary nw-u-fs-12px-2'
        });

        section.createDiv({
            text: classification.summary,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2'
        });

        if (classification.tags.length === 0) {
            section.createDiv({
                text: '当前统计特征不足以规则归类，可先用 AI 提取特征后重新归类。',
                cls: 'nw-u-fs-12px-2 nw-u-c-text-faint-2'
            });
            return;
        }

        const tagWrap = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-6px-2'
        });
        classification.tags.forEach(tag => {
            const chip = tagWrap.createSpan({
                cls: 'nw-fingerprint-class-chip',
                attr: { title: `${tag.dimension} · ${tag.reason}（置信度 ${(tag.confidence * 100).toFixed(0)}%）` }
            });
            chip.createSpan({ text: tag.dimension, cls: 'nw-fingerprint-class-dim' });
            chip.createSpan({ text: tag.label, cls: 'nw-fingerprint-class-label' });
        });
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
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fit-minmax-6 nw-u-gap-8px-2'
        });

        const statsItems = [
            { label: '平均句长', value: fp.stats.avgSentenceLength.toFixed(1) + ' 字' },
            { label: '平均段长', value: fp.stats.avgParagraphLength.toFixed(0) + ' 字' },
            { label: '对话占比', value: (fp.stats.dialogueRatio * 100).toFixed(1) + '%' },
            { label: '描写占比', value: (fp.stats.descriptionRatio * 100).toFixed(1) + '%' },
        ];

        statsItems.forEach(item => {
            const card = statsGrid.createDiv({
                cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-ta-center-2'
            });
            card.createEl('div', {
                text: item.value,
                cls: 'nw-u-fs-16px-2 nw-u-fwt-600-2 nw-u-marginbottom-4px-2'
            });
            card.createEl('div', {
                text: item.label,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2'
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
                cls: 'nw-u-marginbottom-10px-2'
            });
            row.createEl('div', {
                text: f.label,
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2'
            });
            row.createEl('div', {
                text: value,
                cls: 'nw-u-fs-13px-2 nw-u-lh-1-5-2 nw-u-p-8px-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2'
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
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2'
            });
            return;
        }

        fp.samples.slice(0, 3).forEach((sample, index) => {
            const sampleEl = section.createDiv({
                cls: 'nw-u-marginbottom-10px-2 nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-lh-1-6-2 nw-u-blt-3px-solid-interactive-'
            });
            sampleEl.createEl('div', {
                text: `片段 ${index + 1}`,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-6px-2'
            });
            sampleEl.createEl('div', {
                text: sample,
                cls: 'nw-u-c-text-normal-2'
            });
        });
    }

    private renderActionsSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: "nw-fingerprint-actions-section nw-u-margintop-20px-2 nw-u-paddingtop-16px nw-u-bt-1px-solid-background-m-2",
            attr: {}
        });

        section.createEl('h4', {
            text: '⚙️ 操作',
            cls: 'nw-fp-section-h4'
        });

        const actionsGrid = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-8px-2'
        });

        const sourceOnly = isSourceOnlyFingerprintScope(fp.scope);

        if (sourceOnly) {
            section.createEl('div', {
                text: '📋 模板层是来源库：复制/同步到项目后才会影响正文，本层的启用状态与强度不参与注入。',
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2 nw-u-lh-1-5-2'
            });
        } else {
            const toggleBtn = this.createActionButton(
                fp.enabled ? '🔇 禁用' : '✅ 启用',
                () => this.handleToggleEnabled(),
                false,
                '启用或禁用该指纹'
            );
            actionsGrid.appendChild(toggleBtn);
        }

        const editBtn = this.createActionButton('✏️ 编辑', () => this.handleEditFingerprint(fp), false, '编辑指纹内容');
        actionsGrid.appendChild(editBtn);

        // V2 详情查看入口（打开 FingerprintDetailModal，含 12 维详情）
        const detailBtn = this.createActionButton('🔍 V2 详情', () => this.handleOpenDetailModal(fp), false, '查看 V2 12 维详情');
        actionsGrid.appendChild(detailBtn);

        // V2 强度调节入口（模板层不参与注入，强度无消费方）
        if (!sourceOnly) {
            const intensityBtn = this.createActionButton('🎚 强度调节', () => this.handleOpenIntensity(fp), false, '调节指纹强度');
            actionsGrid.appendChild(intensityBtn);
        }

        if (fp.scope === 'project') {
            const promoteBtn = this.createActionButton('⬆️ 提升为全局', () => this.handlePromoteToGlobal(fp), false, '从项目提升为全局指纹');
            actionsGrid.appendChild(promoteBtn);
        }

        if (fp.scope === 'template') {
            const copyBtn = this.createActionButton('📋 复制到项目', () => this.handleCopyToProject(fp), false, '复制到项目');
            actionsGrid.appendChild(copyBtn);
        }

        if (fp.scope === 'global') {
            const copyBtn = this.createActionButton('📋 复制到项目', () => this.handleCopyToProject(fp), false, '复制到项目');
            actionsGrid.appendChild(copyBtn);
        }

        const deleteBtn = this.createActionButton('🗑️ 删除', () => this.handleDeleteFingerprint(), true, '删除该指纹（不可恢复）');
        actionsGrid.appendChild(deleteBtn);
    }

    /** 打开 V2 详情 Modal（12 维完整展示） */
    private handleOpenDetailModal(fp: StyleFingerprint): void {
        const sourceOnly = isSourceOnlyFingerprintScope(fp.scope);
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            library: this.fingerprintLibrary || undefined,
            project: this.plugin.getActiveProject() || undefined,
            canEdit: true,
            // 全局层的生效状态以项目覆盖为准，详情页徽标必须与列表同源
            resolveEffectiveEnabled: (target) => this.isEffectivelyEnabled(target),
            // 模板层不参与注入：不提供无效的启用开关与强度入口
            onToggle: sourceOnly ? undefined : async (updated) => {
                if (!this.fingerprintLibrary) return;
                await this.persistEnabledToggle(updated);
                await this.loadAllFingerprints();
                this.renderFingerprintList();
                this.renderDetailPanel();
            },
            onReextract: () => {
                void this.handleReextract();
            },
            onDelete: async () => {
                await this.handleDeleteFingerprint();
            },
            onOpenIntensity: sourceOnly ? undefined : (target) => this.handleOpenIntensity(target),
        }).open();
    }

    private async handleReextract(): Promise<void> {
        const fp = this.getSelectedFingerprint();
        if (!fp) return;
        if (!this.fingerprintLibrary || !this.extractor || !this.vectorStore) {
            new Notice('提取器未就绪');
            return;
        }
        if (!fp.sourceText) {
            new Notice('该指纹缺少原始文本，无法重新提取，请通过"从文本提取"或"从章节提取"重新生成');
            return;
        }
        try {
            await this.fingerprintLibrary.refillFingerprint(
                fp.id,
                fp.scope,
                {},
                fp.sourceText,
                this.extractor,
                this.vectorStore,
            );
            await this.loadAllFingerprints();
            this.renderFingerprintList();
            this.renderDetailPanel();
            new Notice('✅ 重新提取完成');
        } catch (e) {
            log.error('重新提取失败:', e);
            new Notice(`重新提取失败: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private createActionButton(text: string, onClick: () => void, isDanger = false, title = ''): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-action-btn';
        if (title) btn.setAttribute('title', title);
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

    private async handleImportFromKnowledge(): Promise<void> {
        const knowledgeManager = this.plugin.knowledgeBaseManager;
        if (!knowledgeManager) {
            new Notice('知识库未初始化');
            return;
        }
        if (!this.fingerprintLibrary) {
            new Notice('指纹库未初始化');
            return;
        }
        if (!this.plugin.getActiveProject()) {
            new Notice('请先打开一个项目');
            return;
        }

        let books: BookBasicInfo[] = [];
        try {
            books = await knowledgeManager.getAllBooks();
        } catch (e) {
            log.error('读取知识库书籍列表失败:', e);
            new Notice('读取知识库书籍列表失败');
            return;
        }
        if (books.length === 0) {
            new Notice('知识库为空，请先在知识库导入参考书籍');
            return;
        }

        const library = this.fingerprintLibrary;
        new KnowledgeBookPickerModal(this.app, books, async (book) => {
            try {
                const converter = new KnowledgeToFingerprintConverter(this.app);
                const fingerprint = await converter.convert(book.id, book.name);
                await library.addFromKnowledge(fingerprint);
                await this.loadAllFingerprints();
                this.renderFingerprintList();
                this.renderDetailPanel();
                new Notice(`✅ 已将《${book.name}》拆解结果转为项目写作指纹`);
            } catch (e) {
                log.error('从知识库导入指纹失败:', e);
                new Notice(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        }).open();
    }

    private async handleToggleEnabled(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) {
            // UX 修复：未选中指纹时静默返回会让用户误以为按钮失效
            new Notice('⚠️ 请先在左侧选择一个指纹');
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            new Notice('⚠️ 请先在左侧选择一个指纹');
            return;
        }

        // 模板层仅用于复制/同步到项目，启用状态没有消费方
        if (isSourceOnlyFingerprintScope(fp.scope)) {
            new Notice('📋 模板层指纹不参与注入：请先「复制到项目」或「从模板同步到项目」');
            return;
        }

        const wasEnabled = this.isEffectivelyEnabled(fp);
        await this.persistEnabledToggle(fp);

        await this.loadAllFingerprints();
        this.renderFingerprintList();
        this.renderDetailPanel();
        new Notice(wasEnabled ? '🔇 已禁用' : '✅ 已启用');
    }

    private async handleAutoClassify(): Promise<void> {
        const fp = this.getSelectedFingerprint();
        if (!fp || !this.fingerprintLibrary) {
            new Notice('⚠️ 请先在左侧选择一个指纹');
            return;
        }
        const result = classifyFingerprint(fp);
        const nextTags = mergeClassificationTags(fp.tags || [], result);
        if (nextTags.length === (fp.tags || []).length && nextTags.every((tag, index) => tag === fp.tags[index])) {
            new Notice(`🏷️ 分类未变化：${result.summary}`);
            return;
        }
        const updated: StyleFingerprint = { ...fp, tags: nextTags };
        try {
            switch (fp.scope) {
                case 'template': await this.fingerprintLibrary.updateTemplate(updated); break;
                case 'global': await this.fingerprintLibrary.updateGlobal(updated); break;
                case 'project': await this.fingerprintLibrary.updateProject(updated); break;
            }
            await this.loadAllFingerprints();
            this.renderSearchAndFilter();
            this.renderFingerprintList();
            this.renderDetailPanel();
            new Notice(`🏷️ 已归类：${result.summary}`, 4000);
        } catch (e) {
            log.error('[WritingFingerprintView] 自动归类写入失败:', e);
            new Notice(`自动归类失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async handleDeleteFingerprint(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) {
            // UX 修复：未选中指纹时静默返回会让用户误以为按钮失效
            new Notice('⚠️ 请先在左侧选择一个指纹');
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            new Notice('⚠️ 请先在左侧选择一个指纹');
            return;
        }

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除指纹',
            description: `确定要删除指纹「${fp.name}」吗？`,
            warning: '此操作不可恢复',
            confirmText: '确认删除',
            cancelText: '取消',
        });
        if (!confirmed) return;

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
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '升级指纹到 V2',
            description: `确定要将${SCOPE_LABELS[scope]}下所有 V1 指纹升级到 V2 12 维格式吗？`,
            steps: [
                '原 V1 7 维扩展为 12 维',
                '新增 5 维标记为"待补充"',
                '自动备份原始数据到 .v1.bak 文件',
                '迁移失败自动回滚',
            ],
            confirmText: '确认升级',
            cancelText: '取消',
        });
        if (!confirmed) return;
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
    private async handleOpenIntensity(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) {
            new Notice('指纹库未初始化');
            return;
        }
        const project = this.plugin.getActiveProject() || undefined;
        // 弹窗构造时同步读取强度配置；不先加载，用户会看到默认值而不是上次保存的设置
        await this.fingerprintLibrary.loadIntensityConfigs(project);
        new FingerprintIntensityModal(this.app, {
            fingerprint: fp,
            library: this.fingerprintLibrary,
            project,
        }).open();
    }

    public async refreshForProject(project: string): Promise<void> {
        if (this.fingerprintLibrary) {
            this.fingerprintLibrary.setProject(project);
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
            cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-gap-8px-2 nw-u-margintop-20px-2'
        });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            cls: 'nw-u-p-6px-16px nw-u-cur-pointer-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-bg-background-secondary-2'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存',
            cls: 'nw-u-p-6px-16px nw-u-cur-pointer-2 nw-u-b-none nw-u-brd-4px-2 nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2'
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
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-m-8px-0-16px-0'
        });
        void desc;

        new Setting(contentEl)
            .setName('指纹名称')
            .addText(t => t
                .setValue(this.fingerprintName)
                .onChange(v => this.fingerprintName = v));

        const btnRow1 = contentEl.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-m-12px-0'
        });

        const selectAllBtn = btnRow1.createEl('button', {
            text: '全选',
            cls: "nw-btn nw-u-flex-1-2",
            attr: {}
        });
        selectAllBtn.addEventListener('click', () => {
            this.chapters.forEach(c => this.selectedChapters.add(c));
            this.renderChapterList();
        });

        const deselectAllBtn = btnRow1.createEl('button', {
            text: '取消全选',
            cls: "nw-btn nw-u-flex-1-2",
            attr: {}
        });
        deselectAllBtn.addEventListener('click', () => {
            this.selectedChapters.clear();
            this.renderChapterList();
        });

        const chapterListContainer = contentEl.createDiv({
            cls: 'nw-u-maxh-300px-2 nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-m-8px-0'
        });

        const renderChapterList = () => {
            chapterListContainer.empty();
            
            if (this.chapters.length === 0) {
                chapterListContainer.createDiv({
                    text: '未找到章节',
                    cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-faint-2'
                });
                return;
            }

            this.chapters.forEach(chapterPath => {
                const fileName = chapterPath.split('/').pop() || chapterPath;
                const item = chapterListContainer.createDiv({
                    cls: 'nw-u-p-6px-12px nw-u-cur-pointer-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-bb-1px-solid-background-m-2'
                });

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = this.selectedChapters.has(chapterPath);

                const setSelected = (checked: boolean) => {
                    checkbox.checked = checked;
                    if (checked) {
                        this.selectedChapters.add(chapterPath);
                    } else {
                        this.selectedChapters.delete(chapterPath);
                    }
                };
                checkbox.addEventListener('change', () => setSelected(checkbox.checked));
                item.appendChild(checkbox);

                const nameEl = document.createElement('span');
                nameEl.textContent = fileName;
                nameEl.style.cssText = 'font-size:13px;flex:1;';
                item.appendChild(nameEl);

                item.addEventListener('click', (event) => {
                    // 直接点到复选框时，click 会冒泡上来再翻一次：
                    // 勾选被 change 加成 selected，冒泡又翻回去 → 看起来完全没反应。
                    if (event.target === checkbox) return;
                    setSelected(!checkbox.checked);
                });
            });
        };

        this.renderChapterList = renderChapterList.bind(this);
        renderChapterList();

        const btnRow = contentEl.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-gap-8px-2 nw-u-margintop-20px-2'
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

/** 知识库书籍选择弹窗（从知识库导入指纹用） */
class KnowledgeBookPickerModal extends Modal {
    private books: BookBasicInfo[];
    private onSelect: (book: BookBasicInfo) => void;

    constructor(app: App, books: BookBasicInfo[], onSelect: (book: BookBasicInfo) => void) {
        super(app);
        this.books = books;
        this.onSelect = onSelect;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '📚 选择要导入的知识库书籍' });

        const list = contentEl.createEl('div');
        list.style.maxHeight = '400px';
        list.style.overflowY = 'auto';

        for (const book of this.books) {
            const row = list.createEl('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px 4px';
            row.style.borderBottom = '1px solid var(--background-modifier-border)';

            const info = row.createEl('div');
            info.createEl('div', { text: book.name });
            if (book.author) {
                const author = info.createEl('div', { text: book.author });
                author.style.fontSize = '12px';
                author.style.color = 'var(--text-muted)';
            }

            const btn = row.createEl('button', { text: '导入', cls: 'mod-cta' });
            btn.addEventListener('click', () => {
                this.onSelect(book);
                this.close();
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
