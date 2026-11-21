import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, type Editor } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';
import { StyleFeaturesAnalyzerV2, type StyleAnalysisResultV2 } from '@/engine/style/style-features-v2';
import { FingerprintExtractor } from '@/engine/fingerprint-extractor';
import { applyNwScope } from '@/utils/helpers';
import { AddFingerprintModal } from '@/ui/fingerprint-library-modal';
import { createEmptyState } from '@/ui/components/empty-state';
import { OperationConfirmModal } from '@/ui/components/progress';
import { EmbeddingProviderFactory } from '@/engine/embedding/provider-factory';
import type { EmbeddingProvider } from '@/engine/embedding/embedding-provider';
import { LocalVectorStore } from '@/engine/local-vector-store';
import { ENGINE_NAMES } from '@/engine/engine-registry';
import { AIEngine } from '@/engine/ai-engine';
import { FingerprintDetailModal } from '@/ui/fingerprint-detail-modal';
import { isSourceOnlyFingerprintScope, dimensionNameV2 } from '@/ui/fingerprint-utils';
import { FingerprintIntensityModal } from '@/ui/fingerprint-intensity-modal';
import { FingerprintBlendModal } from '@/ui/fingerprint-blend-modal';
import { KnowledgeToFingerprintConverter } from '@/engine/knowledge-to-fingerprint-converter';
import { chunkOriginalText } from '@/services/knowledge-original-chunker';
import { classifyFingerprint, mergeClassificationTags } from '@/shared/content-classifier';
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import { createLogger } from '@/shared/logger';
import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from '@/ui/model-quick-switcher';
import { formatDetailCount } from '@/ui/knowledge-detail-format';
import * as scopeLogic from './fingerprint-scope-logic';
import { scopeLabel } from './fingerprint-scope-logic';
import { t } from '@/i18n';
import {
    buildFeatureRows,
    buildStatItems,
    resolveInjectionBudget,
    visibleSamples,
} from './fingerprint-detail-logic';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { renderV2FeaturesSection, V2_FEATURE_LABELS } from './fingerprint-v2-detail';
import { renderCapabilityBanner } from './capability-banner';
import { computeFingerprintCapability } from './fingerprint-capability';
import { computeStyleFlowStatus, renderLinkStatus } from './link-status';
import {
    collectFingerprintTags,
    filterFingerprints,
    resolveEffectiveEnabled,
} from './fingerprint-view-logic';
import { filterDegradationsBySource, getDegradationNotifier } from '@/shared/degradation-notifier';
import type { V2Fingerprint, StyleFingerprintFeaturesV2 } from '@/engine/style/style-dimensions-v2';


const log = createLogger('WritingFingerprintView');
/**
 * 写作指纹视图类型。
 */
export const VIEW_TYPE_WRITING_FINGERPRINT = 'novel-writer-writing-fingerprint';

type FingerprintScope = 'template' | 'global' | 'project';

interface FilterState {
    searchQuery: string;
    selectedTag: string | null;
    activeScope: FingerprintScope;
}

const { SCOPE_LABELS, SCOPE_ICONS } = scopeLogic;

/**
 * 写作指纹视图。
 */
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
    private capabilityEl!: HTMLElement;
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

    /**
     * 获取视图类型。
     */
    getViewType() {
        return VIEW_TYPE_WRITING_FINGERPRINT;
    }

    /**
     * getDisplayText 方法。
     */
    getDisplayText() {
        return t('fingerprint.view.title');
    }

    /**
     * getIcon 方法。
     */
    getIcon() {
        return 'fingerprint';
    }

    /**
     * onOpen 方法。
     */
    async onOpen() {
        applyNwScope(this);
        await this.initLibrary();
        this.renderLayout();
        await this.loadAllFingerprints();
        this.renderScopeTabs();
        this.renderToolbar();
        this.capabilityEl = this.leftSidebar.createDiv({ cls: 'nw-fingerprint-capability-host' });
        this.renderCapabilityBanner();
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
    }

    /**
     * onClose 方法。
     */
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

        this.fingerprintLibrary = StyleFingerprintLibrary.get(this.app, project || undefined);

        try {
            const aiEngine = this.plugin.engineRegistry.get(ENGINE_NAMES.AI_ENGINE);
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
            // 阶段 B3：强度配置必须在这里加载。
            // `getIntensityConfig` 是同步 getter，未加载时恒返回默认 1.0，
            // 会让「强度为 0 等于禁用」的检测永远查不出来（能力横幅/链路状态都失效）。
            await this.fingerprintLibrary.loadIntensityConfigs(projectForState);
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
        return resolveEffectiveEnabled(fp, this.effectiveGlobalEnabled);
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
        return filterFingerprints(this.getScopeFingerprints(this.filter.activeScope), {
            searchQuery: this.filter.searchQuery,
            selectedTag: this.filter.selectedTag,
        });
    }

    private getAllTags(): string[] {
        return collectFingerprintTags([
            ...this.templateFingerprints,
            ...this.globalFingerprints,
            ...this.projectFingerprints,
        ]);
    }

    private renderLayout(): void {        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('nw-fingerprint-view');

        const mainLayout = containerEl.createDiv({
            cls: 'nw-fingerprint-main-layout',
            attr: {}
        });

        this.leftSidebar = mainLayout.createDiv({
            cls: 'nw-fingerprint-left-sidebar',
            attr: {}
        });

        // 界面流转：直达工作台 / 协同写作 / 知识库
        const navRow = this.leftSidebar.createDiv({ cls: 'nw-fp-nav-row' });
        const backBtn = navRow.createEl('button', { text: t('fingerprint.view.navWorkbench'), cls: 'nw-fp-nav-btn', attr: { title: t('fingerprint.view.navWorkbenchTitle') } });
        backBtn.addEventListener('click', () => void this.plugin.openFullWriterView());
        const coBtn = navRow.createEl('button', { text: t('fingerprint.view.navCoWrite'), cls: 'nw-fp-nav-btn', attr: { title: t('fingerprint.view.navCoWriteTitle') } });
        coBtn.addEventListener('click', () => void this.plugin.openCoWritingFromActiveContext());
        const kbBtn = navRow.createEl('button', { text: t('fingerprint.view.navKb'), cls: 'nw-fp-nav-btn', attr: { title: t('fingerprint.view.navKbTitle') } });
        kbBtn.addEventListener('click', () => void this.plugin.openKnowledgeBaseView());

        // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到指纹库侧栏（四个主界面之一）。
        this.modelSwitcher = renderModelQuickSwitcher(this.leftSidebar, this.plugin);

        this.rightPanel = mainLayout.createDiv({
            cls: 'nw-fingerprint-right-panel',
            attr: {}
        });
    }

    /** 能力边界说明：注入是否生效、样本/向量是否就绪 */
    private renderCapabilityBanner(): void {
        if (!this.capabilityEl) return;
        this.capabilityEl.empty();
        const all = [
            ...this.templateFingerprints,
            ...this.globalFingerprints,
            ...this.projectFingerprints,
        ];
        const capability = computeFingerprintCapability({
            templateCount: this.templateFingerprints.length,
            globalCount: this.globalFingerprints.length,
            projectCount: this.projectFingerprints.length,
            enabledCount: all.filter(fp => this.isEffectivelyEnabled(fp)).length,
            totalSamples: all.reduce((sum, fp) => sum + (fp.samples?.length || 0), 0),
            v2Count: all.filter(fp => Boolean(this.fingerprintLibrary?.getV2Fingerprint(fp.id))).length,
            vectorReady: Boolean(this.vectorStore),
            embeddingReady: Boolean(this.extractionProvider),
        });
        renderCapabilityBanner(this.capabilityEl, {
            title: t('fingerprint.view.capabilityTitle'),
            ...capability,
        });

        // 阶段 A4：链路状态——回答「断在哪一环」（能力横幅回答「处于什么阶段」）
        const enabledFingerprints = all.filter(fp => this.isEffectivelyEnabled(fp));
        // 阶段 B3：同步 getter 未加载时返回默认 1.0，会把「强度 0」误判成「正常」。
        // `loadAllFingerprints` 已加载强度配置，这里再做一次断言：未加载时按 0 计
        // （偏保守——不把「不知道」误报成「强度被禁用」）。
        const intensityLoaded = this.fingerprintLibrary?.isIntensityLoaded() === true;
        const intensityDisabledCount = intensityLoaded
            ? enabledFingerprints.filter(fp => {
                const config = this.fingerprintLibrary?.getIntensityConfig(fp.id);
                return config ? config.globalIntensity <= 0 : false;
            }).length
            : 0;
        renderLinkStatus(this.capabilityEl, computeStyleFlowStatus({
            templateCount: this.templateFingerprints.length,
            globalCount: this.globalFingerprints.length,
            projectCount: this.projectFingerprints.length,
            enabledCount: enabledFingerprints.length,
            intensityDisabledCount,
            embeddingReady: Boolean(this.extractionProvider),
            // 阶段 B1：风格流相关降级（V2 检索回退全量等）
            degradations: filterDegradationsBySource(
                getDegradationNotifier().getEvents(),
                ['vector'],
            ).map(event => event.reason),
        }));
    }

    private renderScopeTabs(): void {
        // 记住原位置：createDiv 会追加到侧栏末尾，重渲染后标签会掉到工具栏下面。
        const previous = this.scopeTabs;
        const nextSibling = previous?.nextSibling ?? null;
        if (previous) previous.remove();

        const container = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-scope-tabs',
            attr: {}
        });

        this.scopeTabs = container;
        if (nextSibling && nextSibling.parentElement === this.leftSidebar) {
            this.leftSidebar.insertBefore(container, nextSibling);
        }

        const scopes: FingerprintScope[] = ['template', 'global', 'project'];
        scopes.forEach(scope => {
            const tab = container.createDiv({
                cls: scopeLogic.buildScopeTabClass(this.filter.activeScope, scope),
                text: scopeLabel(scope),
            });
            tab.addEventListener('click', () => {
                const next = scopeLogic.resetScopeSelection(scope);
                this.filter.activeScope = next.activeScope;
                this.selectedFingerprintId = next.selectedFingerprintId;
                this.selectedFingerprintScope = next.selectedFingerprintScope;
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
            attr: {}
        });

        const addBtn = this.createToolbarButton(t('fingerprint.view.tbAdd'), () => this.handleAddFingerprint(), false, t('fingerprint.view.tbAddTip'));
        const extractBtn = this.createToolbarButton(t('fingerprint.view.tbExtractText'), () => this.handleExtractFromText(), false, t('fingerprint.view.tbExtractTextTip'));
        const extractChapterBtn = this.createToolbarButton(t('fingerprint.view.tbExtractChapters'), () => this.handleExtractFromChapters(), false, t('fingerprint.view.tbExtractChaptersTip'));
        const importBtn = this.createToolbarButton(t('fingerprint.view.tbImportKb'), () => this.handleImportFromKnowledge(), false, t('fingerprint.view.tbImportKbTip'));
        const blendBtn = this.createToolbarButton(t('fingerprint.view.tbBlend'), () => this.handleBlendFingerprints(), false, t('fingerprint.view.tbBlendTip'));
        const fillSamplesBtn = this.createToolbarButton(t('fingerprint.view.tbFillSamples'), () => { void this.handleBatchFillSamples(); }, false, t('fingerprint.view.tbFillSamplesTip'));
        const migrateBtn = this.createToolbarButton(t('fingerprint.view.tbMigrateV2'), () => this.handleMigrateToV2(), false, t('fingerprint.view.tbMigrateV2Tip'));
        const deleteBtn = this.createToolbarButton(t('fingerprint.view.tbDelete'), () => this.handleDeleteFingerprint(), true, t('fingerprint.view.tbDeleteTip'));
        const toggleBtn = this.createToolbarButton(t('fingerprint.view.tbToggle'), () => this.handleToggleEnabled(), false, t('fingerprint.view.tbToggleTip'));
        const classifyBtn = this.createToolbarButton(t('fingerprint.view.tbClassify'), () => void this.handleAutoClassify(), false, t('fingerprint.view.tbClassifyTip'));

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
        const btn = createEl('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-toolbar-btn';
        if (title) btn.setAttribute('title', title);

        btn.addEventListener('click', onClick);
        return btn;
    }

    private renderSearchAndFilter(): void {
        const previous = this.searchInput?.parentElement ?? null;
        if (previous) previous.remove();
        const anchor = this.fingerprintList ?? null;

        const searchContainer = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-search-container',
            attr: {}
        });

        // 重渲染要插回指纹列表之前：直接 append 会把搜索框挤到列表下面。
        if (anchor && anchor.parentElement === this.leftSidebar) {
            this.leftSidebar.insertBefore(searchContainer, anchor);
        }

        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: t('fingerprint.view.searchPlaceholder'),
            cls: 'nw-fingerprint-search-input'
        });
        this.searchInput.value = this.filter.searchQuery;
        this.searchInput.addEventListener('input', (e) => {
            this.filter.searchQuery = (e.target as HTMLInputElement).value;
            this.renderFingerprintList();
        });

        this.tagFilter = searchContainer.createDiv({
            cls: 'nw-fingerprint-tag-filter',
            attr: {}
        });

        const allTags = this.getAllTags();
        if (allTags.length > 0) {
            const allTag = this.createTagChip(t('fingerprint.view.tagAll'), this.filter.selectedTag === null);
            allTag.addEventListener('click', () => {
                this.filter.selectedTag = null;
                this.renderSearchAndFilter();
                this.renderFingerprintList();
            });
            this.tagFilter.appendChild(allTag);

            scopeLogic.visibleTagChips(allTags).forEach(tag => {
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
        const el = createSpan();
        el.textContent = tag;
        el.className = 'nw-fingerprint-tag-chip';
        el.toggleClass('nw-is-active', isActive);
        return el;
    }

    private renderFingerprintList(): void {
        this.renderCapabilityBanner();
        if (this.fingerprintList) {
            this.fingerprintList.remove();
        }

        this.fingerprintList = this.leftSidebar.createDiv({
            cls: 'nw-fingerprint-list',
            attr: {}
        });

        const fingerprints = this.getCurrentFingerprints();

        if (this.isLoading) {
            this.updateCountLabel(null);
            this.fingerprintList.createDiv({
                cls: 'nw-fp-list-loading',
                text: t('fingerprint.view.loading')
            });
            return;
        }

        if (this.loadError) {
            this.updateCountLabel(null);
            const errorBox = this.fingerprintList.createDiv({ cls: 'nw-fingerprint-error' });
            errorBox.createDiv({ text: t('fingerprint.view.loadFailedTitle'), cls: 'nw-fingerprint-error-title' });
            errorBox.createDiv({ text: this.loadError, cls: 'nw-fingerprint-error-detail' });
            const retry = errorBox.createEl('button', { text: t('fingerprint.view.retry'), cls: 'nw-btn nw-btn-secondary nw-btn-sm' });
            retry.onclick = () => { void this.loadAllFingerprints().then(() => this.renderFingerprintList()); };
            return;
        }

        if (fingerprints.length === 0) {
            this.updateCountLabel(0);
            // NBI-01: 当前层为空时给出可执行引导，优先指向已有数据的其它层
            const description = scopeLogic.buildEmptyScopeGuidance(this.filter.activeScope, {
                template: this.getScopeFingerprints('template').length,
                global: this.getScopeFingerprints('global').length,
                project: this.getScopeFingerprints('project').length,
            });
            const emptyState = createEmptyState({
                icon: 'default',
                title: t('fingerprint.view.emptyTitle'),
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
                cls: `nw-fingerprint-list-item${isSelected ? ' nw-fingerprint-list-item--selected' : ''}`,
            });

            const header = item.createDiv({
                cls: 'nw-fp-item-head'
            });

            const nameRow = header.createDiv({
                cls: 'nw-fp-item-name-row'
            });

            if (!fp.enabled) {
                nameRow.createSpan({
                    text: '🔇',
                    cls: 'nw-fp-item-mute'
                });
            }

            nameRow.createSpan({
                text: fp.name,
                cls: `nw-fp-item-name${!fp.enabled ? ' nw-fp-item-name--muted' : ''}`,
            });

            header.createSpan({
                text: SCOPE_ICONS[fp.scope],
                cls: 'nw-fp-item-scope-icon'
            });

            const source = item.createDiv({
                cls: 'nw-fp-item-source'
            });
            source.textContent = fp.source || t('fingerprint.view.unknownSource');

            const classification = classifyFingerprint(fp);
            if (classification.tags.length > 0) {
                const classRow = item.createDiv({ cls: 'nw-fingerprint-class-row' });
                classRow.createSpan({ text: classification.primary, cls: 'nw-fingerprint-class-primary' });
                classRow.createSpan({ text: t('fingerprint.view.tagCount', { count: classification.tags.length }), cls: 'nw-fingerprint-class-count' });
            }

            if (fp.tags.length > 0) {
                const tagsRow = item.createDiv({
                    cls: 'nw-fp-item-tags'
                });
                fp.tags.slice(0, 3).forEach(tag => {
                    tagsRow.createSpan({
                        text: tag,
                        cls: 'nw-fp-item-tag'
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
            cls: 'nw-fingerprint-count',
            attr: {}
        });
        this.countEl.textContent = t('fingerprint.view.countLabel', { count });
    }

    private renderDetailPanel(): void {
        this.rightPanel.empty();

        if (!this.selectedFingerprintId || !this.selectedFingerprintScope) {
            this.rightPanel.createDiv({
                cls: 'nw-fp-detail-empty',
                text: t('fingerprint.view.detailEmpty')
            });
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            this.rightPanel.createDiv({
                cls: 'nw-fp-detail-empty',
                text: t('fingerprint.view.detailMissing')
            });
            return;
        }

        const header = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-detail-header',
            attr: {}
        });

        const titleRow = header.createDiv({
            cls: 'nw-fp-title-row'
        });

        titleRow.createEl('h3', {
            text: fp.name,
            cls: 'nw-fp-detail-title'
        });

        const effectiveEnabled = this.isEffectivelyEnabled(fp);
        const statusBadge = titleRow.createSpan({
            text: effectiveEnabled ? t('fingerprint.view.statusOn') : t('fingerprint.view.statusOff'),
            cls: effectiveEnabled ? 'nw-fp-status-badge nw-fp-status-badge--on' : 'nw-fp-status-badge nw-fp-status-badge--off',
        });

        const metaRow = header.createDiv({
            cls: 'nw-fp-meta-row'
        });

        metaRow.createSpan({ text: scopeLabel(fp.scope as FingerprintScope) });
        metaRow.createSpan({ text: t('fingerprint.view.metaSource', { source: fp.source || t('fingerprint.view.unknown') }) });
        metaRow.createSpan({ text: t('fingerprint.view.metaExtractedAt', { time: new Date(fp.extractedAt).toLocaleString() }) });
        metaRow.createSpan({ text: t('fingerprint.view.metaWordCount', { count: formatDetailCount(fp.stats?.wordCount) }) });
        metaRow.createSpan({ text: t('fingerprint.view.metaSamples', { count: (fp.samples || []).length }) });

        if (fp.tags.length > 0) {
            const tagsSection = header.createDiv({
                cls: 'nw-fp-meta-tags'
            });
            fp.tags.forEach(tag => {
                tagsSection.createSpan({
                    text: tag,
                    cls: 'nw-fp-meta-tag'
                });
            });
        }

        this.renderInjectionCard(fp);
        this.renderClassificationSection(fp);
        this.renderStatsSection(fp);
        this.renderFeaturesSection(fp);
        const v2 = this.fingerprintLibrary?.getV2Fingerprint(fp.id);
        if (v2 && v2.scope === fp.scope) {
            renderV2FeaturesSection(this.rightPanel, v2);
        }
        this.renderSamplesSection(fp);
        this.renderActionsSection(fp);
    }

    /**
     * v4.20 注入影响卡：让「这条指纹对生成的指引有多强」可见。
     * - 无原文样本 → 段落层 few-shot 不会注入（只剩特征描述），黄条提示 + 一键从知识库补样本；
     * - 注入预算：默认 2000 字符（可在设置改 fingerprintInjectionBudget），指纹多时按相似度挑选。
     */
    /** 注入预算与真实生成链路同源（设置 fingerprintInjectionBudget，缺省 2000） */
    private injectionBudget(): number {
        return resolveInjectionBudget(this.plugin.settings?.fingerprintInjectionBudget);
    }

    private renderInjectionCard(fp: StyleFingerprint): void {        const card = this.rightPanel.createDiv({ cls: 'nw-fingerprint-inject-card nw-mb-lg' });
        card.createEl('h4', { text: t('fingerprint.view.injectTitle'), cls: 'nw-fp-inject-title' });

        const sampleCount = (fp.samples || []).length;
        const rows = card.createDiv({ cls: 'nw-fp-inject-rows' });
        rows.createSpan({ text: t('fingerprint.view.injectSamples', { count: sampleCount }) });
        rows.createSpan({ text: t('fingerprint.view.injectLayers') });
        rows.createSpan({ text: t('fingerprint.view.injectBudget', { budget: this.injectionBudget() }) });
        if (sampleCount === 0) {
            const warn = card.createDiv({
                cls: 'nw-fingerprint-sample-warn nw-fp-inject-warn'
            });
            warn.setText(t('fingerprint.view.injectWarn'));
            const fixBtn = card.createEl('button', {
                text: t('fingerprint.view.injectFixBtn'),
                cls: 'nw-btn nw-btn-secondary nw-fp-inject-fix',
            });
            fixBtn.onclick = () => { void this.handleImportFromKnowledge(); };
        }

        card.createDiv({
            cls: 'nw-fp-inject-note',
            text: t('fingerprint.view.injectNote'),
        });
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
            cls: 'nw-fp-title-row'
        });
        titleRow.createEl('h4', {
            text: t('fingerprint.view.classTitle'),
            cls: 'nw-fp-section-h4 nw-fp-section-title'
        });
        titleRow.createSpan({
            text: classification.primary,
            cls: 'nw-fingerprint-class-primary'
        });

        section.createDiv({
            text: classification.summary,
            cls: 'nw-fp-class-summary'
        });

        if (classification.tags.length === 0) {
            section.createDiv({
                text: t('fingerprint.view.classEmpty'),
                cls: 'nw-fp-class-empty'
            });
            return;
        }

        const tagWrap = section.createDiv({
            cls: 'nw-fp-class-tags'
        });
        classification.tags.forEach(tag => {
            const chip = tagWrap.createSpan({
                cls: 'nw-fingerprint-class-chip',
                attr: { title: t('fingerprint.view.tagTitle', { dimension: tag.dimension, reason: tag.reason, confidence: (tag.confidence * 100).toFixed(0) }) }
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
            text: t('fingerprint.view.statsTitle'),
            cls: 'nw-fp-section-h4'
        });

        const statsGrid = section.createDiv({
            cls: 'nw-fp-stats-grid'
        });

        buildStatItems(fp.stats).forEach(item => {
            const card = statsGrid.createDiv({
                cls: 'nw-fp-stat-card'
            });
            card.createDiv({
                text: item.value,
                cls: 'nw-fp-stat-value'
            });
            card.createDiv({
                text: item.label,
                cls: 'nw-fp-stat-label'
            });
        });
    }

    private renderFeaturesSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-features-section nw-mb-lg'
        });

        section.createEl('h4', {
            text: t('fingerprint.view.featuresTitle'),
            cls: 'nw-fp-section-h4'
        });

        const featureLabels = [
            { key: 'sentenceRhythm', labelKey: 'fingerprint.view.v1dim.sentenceRhythm' },
            { key: 'wordPreference', labelKey: 'fingerprint.view.v1dim.wordPreference' },
            { key: 'narrativeStyle', labelKey: 'fingerprint.view.v1dim.narrativeStyle' },
            { key: 'rhetoric', labelKey: 'fingerprint.view.v1dim.rhetoric' },
            { key: 'dialogueStyle', labelKey: 'fingerprint.view.v1dim.dialogueStyle' },
            { key: 'paragraphStructure', labelKey: 'fingerprint.view.v1dim.paragraphStructure' },
            { key: 'overallTone', labelKey: 'fingerprint.view.v1dim.overallTone' },
        ];

        buildFeatureRows(fp.features as unknown as Record<string, unknown>, featureLabels.map(l => ({ key: l.key, label: t(l.labelKey) }))).forEach(f => {
            const row = section.createDiv({
                cls: 'nw-fp-feature'
            });
            row.createDiv({
                text: f.label,
                cls: 'nw-fp-feature-label'
            });
            row.createDiv({
                text: f.value,
                cls: 'nw-fp-feature-value'
            });
        });
    }

    private renderSamplesSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-samples-section nw-mb-lg'
        });

        section.createEl('h4', {
            text: t('fingerprint.view.samplesTitle'),
            cls: 'nw-fp-section-h4'
        });

        if (fp.samples.length === 0) {
            section.createDiv({
                text: t('fingerprint.view.samplesEmpty'),
                cls: 'nw-fp-samples-empty'
            });
            return;
        }

        visibleSamples(fp.samples).forEach((sample, index) => {
            const sampleEl = section.createDiv({
                cls: 'nw-fp-sample-card'
            });
            sampleEl.createDiv({
                text: t('fingerprint.view.sampleIndex', { n: index + 1 }),
                cls: 'nw-fp-sample-index'
            });
            sampleEl.createDiv({
                text: sample,
                cls: 'nw-fp-sample-text'
            });
        });
    }

    private renderActionsSection(fp: StyleFingerprint): void {
        const section = this.rightPanel.createDiv({
            cls: 'nw-fingerprint-actions-section',
            attr: {}
        });

        section.createEl('h4', {
            text: t('fingerprint.view.actionsTitle'),
            cls: 'nw-fp-section-h4'
        });

        const actionsGrid = section.createDiv({
            cls: 'nw-fp-actions-grid'
        });

        const sourceOnly = isSourceOnlyFingerprintScope(fp.scope);

        if (sourceOnly) {
            section.createDiv({
                text: t('fingerprint.view.templateNote'),
                cls: 'nw-fp-actions-note'
            });
        } else {
            const toggleBtn = this.createActionButton(
                fp.enabled ? t('fingerprint.view.actionDisable') : t('fingerprint.view.actionEnable'),
                () => this.handleToggleEnabled(),
                false,
                t('fingerprint.view.actionToggleTip')
            );
            actionsGrid.appendChild(toggleBtn);
        }

        const editBtn = this.createActionButton(t('fingerprint.view.actionEdit'), () => this.handleEditFingerprint(fp), false, t('fingerprint.view.actionEditTip'));
        actionsGrid.appendChild(editBtn);

        // V2 详情查看入口（打开 FingerprintDetailModal，含 12 维详情）
        const detailBtn = this.createActionButton(t('fingerprint.view.actionV2Detail'), () => this.handleOpenDetailModal(fp), false, t('fingerprint.view.actionV2DetailTip'));
        actionsGrid.appendChild(detailBtn);

        // V2 强度调节入口（模板层不参与注入，强度无消费方）
        if (!sourceOnly) {
            const intensityBtn = this.createActionButton(t('fingerprint.view.actionIntensity'), () => this.handleOpenIntensity(fp), false, t('fingerprint.view.actionIntensityTip'));
            actionsGrid.appendChild(intensityBtn);
        }

        if (fp.scope === 'project') {
            const promoteBtn = this.createActionButton(t('fingerprint.view.actionPromote'), () => this.handlePromoteToGlobal(fp), false, t('fingerprint.view.actionPromoteTip'));
            actionsGrid.appendChild(promoteBtn);
        }

        if (fp.scope === 'template') {
            const copyBtn = this.createActionButton(t('fingerprint.view.actionCopy'), () => this.handleCopyToProject(fp), false, t('fingerprint.view.actionCopyTip'));
            actionsGrid.appendChild(copyBtn);
        }

        if (fp.scope === 'global') {
            const copyBtn = this.createActionButton(t('fingerprint.view.actionCopy'), () => this.handleCopyToProject(fp), false, t('fingerprint.view.actionCopyTip'));
            actionsGrid.appendChild(copyBtn);
        }

        const deleteBtn = this.createActionButton(t('fingerprint.view.actionDelete'), () => this.handleDeleteFingerprint(), true, t('fingerprint.view.actionDeleteTip'));
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
            new Notice(t('fingerprint.view.extractorNotReady'));
            return;
        }
        if (!fp.sourceText) {
            new Notice(t('fingerprint.view.reextractNoText'));
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
            showSuccessNotice(t('fingerprint.view.reextractDone'));
        } catch (e) {
            log.error('重新提取失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('fingerprint.view.reextractFailedTitle') });
        }
    }

    private createActionButton(text: string, onClick: () => void, isDanger = false, title = ''): HTMLElement {
        const btn = createEl('button');
        btn.textContent = text;
        btn.className = 'nw-fingerprint-action-btn';
        if (title) btn.setAttribute('title', title);
        if (isDanger) btn.addClass('nw-is-danger');
        btn.addEventListener('click', onClick);
        return btn;
    }

    private async handleAddFingerprint(): Promise<void> {
        if (!this.extractor || !this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.extractorNotInit'));
            return;
        }

        const modal = new AddFingerprintModal(this.app, {
            scope: this.filter.activeScope,
            extractor: this.extractor,
            onCompleted: (fp) => this.saveExtractedFingerprint(fp, t('fingerprint.view.fpAdded'))
        });
        modal.open();
    }

    private async handleExtractFromText(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        const activeView = this.app.workspace.getActiveViewOfType(ItemView);
        let selectedText = '';

        if (activeView) {
            const editor = (activeView as { editor?: Editor }).editor;
            if (editor && typeof editor.getSelection === 'function') {
                selectedText = editor.getSelection();
            }
        }

        if (!selectedText && activeFile) {
            const content = await this.app.vault.read(activeFile);
            selectedText = content;
        }

        if (!selectedText || selectedText.length < 100) {
            new Notice(t('fingerprint.view.need100Chars'));
            return;
        }

        if (!this.extractor || !this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.extractorNotInit'));
            return;
        }

        const modal = new AddFingerprintModal(this.app, {
            scope: this.filter.activeScope,
            extractor: this.extractor,
            onCompleted: (fp) => void this.saveExtractedFingerprintWithLocalV2(fp, selectedText)
        });
        modal.textValue = selectedText;
        modal.open();
    }

    /** 提取结果落库：Modal 已关闭，写失败必须兜住并提示，不能静默丢数据 */
    private async saveExtractedFingerprint(fp: StyleFingerprint, successMessage: string): Promise<void> {
        if (!this.fingerprintLibrary) {
            showWarningNotice(t('fingerprint.view.libNotInitNoSave'), { timeout: 8000 });
            return;
        }
        try {
            switch (fp.scope) {
                case 'template':
                    await this.fingerprintLibrary.addTemplate(fp);
                    break;
                case 'global':
                    await this.fingerprintLibrary.addGlobal(fp);
                    break;
                case 'project':
                    await this.fingerprintLibrary.addProject(fp);
                    break;
            }
        } catch (e) {
            log.error('[FingerprintView] 保存指纹失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('fingerprint.view.saveFailedTitle'), timeout: 8000 });
            return;
        }
        await this.afterFingerprintSaved(fp, successMessage.replace(/^✅\s*/u, ''));
    }

    /**
     * V2 直存路径：样本文本可用的本地十二维统计 → `addV2Fingerprint`
     * （磁盘直接写 version:'v2' 全量特征，不再依赖「先 V1 落盘再迁移」）。
     * 统计或落库失败时回落既有 V1 通道，绝不静默丢数据。
     */
    private async saveExtractedFingerprintWithLocalV2(
        fp: StyleFingerprint,
        sampleText: string,
    ): Promise<void> {
        if (!this.fingerprintLibrary) {
            showWarningNotice(t('fingerprint.view.libNotInitNoSave'), { timeout: 8000 });
            return;
        }
        let analysis: StyleAnalysisResultV2 | null = null;
        try {
            analysis = await new StyleFeaturesAnalyzerV2().analyze(sampleText);
        } catch (e) {
            log.warn('[FingerprintView] 本地十二维统计失败，按 V1 通道保存:', e);
            showWarningNotice(t('fingerprint.view.v2StatsFailed'), { timeout: 6000 });
        }
        if (analysis) {
            try {
                const saved = await this.fingerprintLibrary.addV2Fingerprint({
                    scope: fp.scope,
                    name: fp.name,
                    source: fp.source,
                    tags: fp.tags,
                    samples: fp.samples,
                    sourceText: fp.sourceText ?? sampleText,
                    analysis,
                });
                await this.afterFingerprintSaved(saved, t('fingerprint.view.fpExtractedV2'));
                return;
            } catch (e) {
                log.warn('[FingerprintView] V2 直存失败，回落 V1 通道:', e);
                showWarningNotice(t('fingerprint.view.v2SaveFailed'), { timeout: 6000 });
            }
        }
        await this.saveExtractedFingerprint(fp, t('fingerprint.view.fpExtracted'));
    }

    /** 保存成功后的公共收尾：刷新缓存、选中新指纹并重绘三块区域。 */
    private async afterFingerprintSaved(fp: StyleFingerprint, successMessage: string): Promise<void> {
        await this.loadAllFingerprints();
        this.selectedFingerprintId = fp.id;
        this.selectedFingerprintScope = fp.scope as FingerprintScope;
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
        showSuccessNotice(successMessage);
    }

    private async handleExtractFromChapters(): Promise<void> {
        if (!this.currentProjectPath) {
            new Notice(t('fingerprint.view.needProjectOpen'));
            return;
        }

        const projectPath = this.currentProjectPath;
        const bodyDir = `${projectPath}/03-大纲与章节/正文`;

        try {
            const exists = await this.app.vault.adapter.exists(bodyDir);
            if (!exists) {
                new Notice(t('fingerprint.view.noBodyDir'));
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
                new Notice(t('fingerprint.view.noChapterFiles'));
                return;
            }

            const modal = new ExtractFromChaptersModal(
                this.app,
                chapters,
                async (selectedChapters, fingerprintName) => {
                    if (!this.extractor || !this.fingerprintLibrary) {
                        new Notice(t('fingerprint.view.extractorNotInit'));
                        return;
                    }

                    new Notice(t('fingerprint.view.extractingFromChapters', { count: selectedChapters.length }), 3000);

                    // 提取只需代表性样本：全选几百章会拼出百万字，超时且费用暴涨
                    const MAX_EXTRACT_CHARS = 60000;
                    let allText = '';
                    let truncated = false;
                    for (const chapPath of selectedChapters) {
                        if (allText.length >= MAX_EXTRACT_CHARS) {
                            truncated = true;
                            break;
                        }
                        try {
                            const content = await this.app.vault.adapter.read(chapPath);
                            allText += content + '\n\n';
                        } catch (e) {
                            log.warn('读取章节失败:', chapPath, e);
                        }
                    }
                    if (allText.length > MAX_EXTRACT_CHARS) {
                        allText = allText.slice(0, MAX_EXTRACT_CHARS);
                        truncated = true;
                    }
                    if (truncated) {
                        showWarningNotice(t('fingerprint.view.truncatedNotice', { max: MAX_EXTRACT_CHARS }), { timeout: 6000 });
                    }

                    if (allText.length < 500) {
                        new Notice(t('fingerprint.view.chapterTooShort'));
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
                        showSuccessNotice(t('fingerprint.view.chapterExtractDone'));
                    } catch (e) {
                        log.error('提取指纹失败:', e);
                        showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('fingerprint.view.extractFailedTitle') });
                    }
                }
            );
            modal.open();
        } catch (e) {
            log.error('读取章节列表失败:', e);
            showErrorNotice(t('fingerprint.view.readChaptersFailed'));
        }
    }

    private async handleImportFromKnowledge(): Promise<void> {
        const knowledgeManager = this.plugin.knowledgeBaseManager;
        if (!knowledgeManager) {
            new Notice(t('fingerprint.view.kbNotInit'));
            return;
        }
        if (!this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.libNotInit'));
            return;
        }
        if (!this.plugin.getActiveProject()) {
            new Notice(t('fingerprint.view.needOpenProject'));
            return;
        }

        let books: BookBasicInfo[] = [];
        try {
            books = await knowledgeManager.getAllBooks();
        } catch (e) {
            log.error('读取知识库书籍列表失败:', e);
            showErrorNotice(t('fingerprint.view.readBooksFailed'));
            return;
        }
        if (books.length === 0) {
            new Notice(t('fingerprint.view.kbEmpty'));
            return;
        }

        const library = this.fingerprintLibrary;
        new KnowledgeBookPickerModal(this.app, books, async (book) => {
            try {
                // v4.20 补样本断链：从知识库原文取真实 prose 分块作为 few-shot 样本。
                // 没有样本的指纹只剩特征描述，段落层（真实文风 few-shot）不会注入。
                let originalSamples: string[] = [];
                try {
                    const sourceText = await knowledgeManager.getSourceText(book.id);
                    originalSamples = chunkOriginalText(sourceText)
                        .map((chunk) => chunk.sample.trim())
                        .filter((sample) => sample.length >= 80)
                        .slice(0, 12);
                } catch (sampleError) {
                    log.warn('读取知识库原文失败，指纹将不含样本:', sampleError);
                }

                const converter = new KnowledgeToFingerprintConverter(this.app);
                const fingerprint = await converter.convert(book.id, book.name, undefined, originalSamples);
                await library.addFromKnowledge(fingerprint);
                await this.loadAllFingerprints();
                this.renderFingerprintList();
                this.renderDetailPanel();
                showSuccessNotice(t('fingerprint.view.kbImported', { book: book.name, count: originalSamples.length }));
            } catch (e) {
                log.error('从知识库导入指纹失败:', e);
                showErrorNotice(t('fingerprint.view.importFailed', { msg: e instanceof Error ? e.message : String(e) }));
            }
        }).open();
    }

    /**
     * v4.20 批量补样本：为「知识库导入且样本为空」的指纹从原文补 few-shot 样本。
     * 涉及向量化（embedding 额度），先确认再执行；逐条更新并汇总结果。
     */
    private async handleBatchFillSamples(): Promise<void> {
        const knowledgeManager = this.plugin.knowledgeBaseManager;
        if (!knowledgeManager) {
            new Notice(t('fingerprint.view.kbNotInit'));
            return;
        }
        if (!this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.libNotInit'));
            return;
        }

        const targets = this.fingerprintLibrary.listProject().filter(
            (fp) => (fp.samples || []).length === 0 && (fp.source || '').startsWith('knowledge-base:'),
        );
        if (targets.length === 0) {
            new Notice(t('fingerprint.view.noFillTargets'));
            return;
        }

        const books = await knowledgeManager.getAllBooks().catch(() => []);
        const bookIdByName = new Map(books.map((book) => [book.name, book.id] as const));

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('fingerprint.view.fillTitle'),
            description: t('fingerprint.view.fillDesc', { count: targets.length, names: targets.slice(0, 5).map((fp) => fp.name).join('、') + (targets.length > 5 ? t('fingerprint.view.nameListMore') : '') }),
            warning: t('fingerprint.view.fillWarning'),
            confirmText: t('fingerprint.view.fillConfirm'),
            cancelText: t('common.cancel'),
        });
        if (!confirmed) return;

        let filled = 0;
        let skipped = 0;
        for (const fp of targets) {
            const bookName = (fp.source || '').slice('knowledge-base:'.length);
            const bookId = bookIdByName.get(bookName);
            if (!bookId) { skipped++; continue; }
            try {
                const sourceText = await knowledgeManager.getSourceText(bookId);
                const samples = chunkOriginalText(sourceText)
                    .map((chunk) => chunk.sample.trim())
                    .filter((sample) => sample.length >= 80)
                    .slice(0, 12);
                if (samples.length === 0) { skipped++; continue; }
                fp.samples = samples;
                await this.fingerprintLibrary.updateProject(fp);
                filled++;
            } catch (e) {
                log.warn(`[指纹库] 补样本失败: ${fp.name}`, e);
                skipped++;
            }
        }
        await this.loadAllFingerprints();
        this.renderFingerprintList();
        this.renderDetailPanel();
        showSuccessNotice(t('fingerprint.view.fillDoneSummary', { ok: filled, skipped }), { title: t('fingerprint.view.fillDoneTitle'), timeout: 6000 });
    }

    private async handleToggleEnabled(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) {
            // UX 修复：未选中指纹时静默返回会让用户误以为按钮失效
            new Notice(t('fingerprint.view.needSelectFirst'));
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            new Notice(t('fingerprint.view.needSelectFirst'));
            return;
        }

        // 模板层仅用于复制/同步到项目，启用状态没有消费方
        if (isSourceOnlyFingerprintScope(fp.scope)) {
            showWarningNotice(t('fingerprint.view.templateNoInjectWarn'));
            return;
        }

        const wasEnabled = this.isEffectivelyEnabled(fp);
        await this.persistEnabledToggle(fp);

        await this.loadAllFingerprints();
        this.renderFingerprintList();
        this.renderDetailPanel();
        showSuccessNotice(wasEnabled ? t('fingerprint.view.toggledOff') : t('fingerprint.view.toggledOn'));
    }

    private async handleAutoClassify(): Promise<void> {
        const fp = this.getSelectedFingerprint();
        if (!fp || !this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.needSelectFirst'));
            return;
        }
        const result = classifyFingerprint(fp);
        const nextTags = mergeClassificationTags(fp.tags || [], result);
        if (nextTags.length === (fp.tags || []).length && nextTags.every((tag, index) => tag === fp.tags[index])) {
            new Notice(t('fingerprint.view.classUnchanged', { summary: result.summary }));
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
            showSuccessNotice(t('fingerprint.view.classified', { summary: result.summary }), { timeout: 4000 });
        } catch (e) {
            log.error('[WritingFingerprintView] 自动归类写入失败:', e);
            showErrorNotice(t('fingerprint.view.classifyFailed', { msg: e instanceof Error ? e.message : String(e) }));
        }
    }

    private async handleDeleteFingerprint(): Promise<void> {
        if (!this.selectedFingerprintId || !this.selectedFingerprintScope || !this.fingerprintLibrary) {
            // UX 修复：未选中指纹时静默返回会让用户误以为按钮失效
            new Notice(t('fingerprint.view.needSelectFirst'));
            return;
        }

        const fp = this.getSelectedFingerprint();
        if (!fp) {
            new Notice(t('fingerprint.view.needSelectFirst'));
            return;
        }

        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('fingerprint.view.deleteTitle'),
            description: t('fingerprint.view.deleteDesc', { name: fp.name }),
            warning: t('fingerprint.view.deleteWarning'),
            confirmText: t('fingerprint.view.deleteOk'),
            cancelText: t('common.cancel'),
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
        showSuccessNotice(t('fingerprint.view.fpDeleted'));
    }

    private handleEditFingerprint(fp: StyleFingerprint): void {
        // V2 指纹带十二维编辑；V1 指纹仅元信息
        const v2 = this.fingerprintLibrary?.getV2Fingerprint(fp.id) ?? null;
        new EditFingerprintModal(
            this.app,
            fp,
            (updated) => {
            // 保存失败必须让用户看见：Modal 已关闭，静默 rejection 会表现为「看起来更新成功」
            void (async () => {
                if (!this.fingerprintLibrary) {
                    showErrorNotice(t('fingerprint.view.libNotInitNoSave2'));
                    return;
                }
                try {
                    switch (fp.scope) {
                        case 'template': await this.fingerprintLibrary.updateTemplate(updated); break;
                        case 'global': await this.fingerprintLibrary.updateGlobal(updated); break;
                        case 'project': await this.fingerprintLibrary.updateProject(updated); break;
                    }
                } catch (e) {
                    log.error('[FingerprintView] 更新指纹失败:', e);
                    showErrorNotice(t('fingerprint.view.updateFailed', { msg: e instanceof Error ? e.message : String(e) }), { timeout: 8000 });
                    return;
                }
                await this.loadAllFingerprints();
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
                showSuccessNotice(t('fingerprint.view.fpUpdated'));
            })();
            },
            v2,
            async (updated, features) => {
                // V2 路径：十二维与 V1 投影同步更新，磁盘保持 version:'v2'
                if (!this.fingerprintLibrary) {
                    showErrorNotice(t('fingerprint.view.libNotInitNoSave2'));
                    return;
                }
                try {
                    const saved = await this.fingerprintLibrary.updateV2FingerprintFeatures(updated.id, fp.scope, features);
                    if (!saved) throw new Error('V2 指纹条目不存在');
                } catch (e) {
                    log.error('[FingerprintView] V2 指纹更新失败:', e);
                    showErrorNotice(t('fingerprint.view.v2UpdateFailed', { msg: e instanceof Error ? e.message : String(e) }), { timeout: 8000 });
                    return;
                }
                await this.loadAllFingerprints();
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
                showSuccessNotice(t('fingerprint.view.fpUpdatedV2'));
            },
        ).open();
    }

    private async handlePromoteToGlobal(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) return;
        const result = await this.fingerprintLibrary.copyFingerprint('project', 'global', fp.id);
        if (!result) {
            showErrorNotice(t('fingerprint.view.promoteFailed'));
            return;
        }
        await this.loadAllFingerprints();
        this.filter.activeScope = 'global';
        this.selectedFingerprintId = result.id;
        this.selectedFingerprintScope = 'global';
        this.renderScopeTabs();
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
        showSuccessNotice(t('fingerprint.view.promoted'));
    }

    private async handleCopyToProject(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) return;
        const project = this.plugin.getActiveProject();
        if (!project) {
            new Notice(t('fingerprint.view.needOpenProject'));
            return;
        }
        const result = await this.fingerprintLibrary.copyFingerprint(
            fp.scope as FingerprintScope,
            'project',
            fp.id,
            project
        );
        if (!result) {
            showErrorNotice(t('fingerprint.view.copyFailed'));
            return;
        }
        await this.loadAllFingerprints();
        this.filter.activeScope = 'project';
        this.selectedFingerprintId = result.id;
        this.selectedFingerprintScope = 'project';
        this.renderScopeTabs();
        this.renderSearchAndFilter();
        this.renderFingerprintList();
        this.renderDetailPanel();
        showSuccessNotice(t('fingerprint.view.copied'));
    }

    /** 打开 V2 多指纹融合预览 Modal */
    private handleBlendFingerprints(): void {
        if (!this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.libNotInit'));
            return;
        }
        const currentFps = this.getCurrentFingerprints();
        if (currentFps.length === 0) {
            new Notice(t('fingerprint.view.noFpsInScope'));
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
            new Notice(t('fingerprint.view.libNotInit'));
            return;
        }
        const scope = this.filter.activeScope;
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('fingerprint.view.upgradeTitle'),
            description: t('fingerprint.view.upgradeDesc', { scope: scopeLabel(scope) }),
            steps: [
                t('fingerprint.view.upgradeBullet1'),
                t('fingerprint.view.upgradeBullet2'),
                t('fingerprint.view.upgradeBullet3'),
                t('fingerprint.view.upgradeBullet4'),
            ],
            confirmText: t('fingerprint.view.upgradeOk'),
            cancelText: t('common.cancel'),
        });
        if (!confirmed) return;
        try {
            const result = await this.fingerprintLibrary.migrateV1ToV2Dimensions(scope);
            if (result.success) {
                if (result.migrated > 0) {
                    showSuccessNotice(t('fingerprint.view.upgraded', { count: result.migrated }));
                } else {
                    new Notice(t('fingerprint.view.nothingToUpgrade'));
                }
                await this.loadAllFingerprints();
                this.renderSearchAndFilter();
                this.renderFingerprintList();
                this.renderDetailPanel();
            } else {
                showErrorNotice(t('fingerprint.view.upgradeFailedWith', { msg: result.error || t('fingerprint.view.unknownError') }));
            }
        } catch (e) {
            log.warn('[WritingFingerprintView] V2 升级失败:', e);
            showErrorNotice(t('fingerprint.view.upgradeFailedWith', { msg: (e as Error).message }));
        }
    }

    /** 打开 V2 强度调节 Modal */
    private async handleOpenIntensity(fp: StyleFingerprint): Promise<void> {
        if (!this.fingerprintLibrary) {
            new Notice(t('fingerprint.view.libNotInit'));
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

    /**
     * refreshForProject 方法。
     * @param project - 项目（路径或对象）
     */
    public async refreshForProject(project: string): Promise<void> {
        if (this.fingerprintLibrary) {
            this.fingerprintLibrary.setProject(project);
        } else {
            this.fingerprintLibrary = StyleFingerprintLibrary.get(this.app, project);
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
    /** V2 指纹的十二维可编辑副本；null 表示该指纹无 V2 数据（仅元信息编辑） */
    private v2Features: StyleFingerprintFeaturesV2 | null;
    private onSaveV2: ((fp: StyleFingerprint, features: StyleFingerprintFeaturesV2) => void) | null;
    private nameValue: string;
    private sourceValue: string;
    private tagsValue: string;

    constructor(
        app: App,
        fingerprint: StyleFingerprint,
        onSave: (fp: StyleFingerprint) => void,
        v2?: V2Fingerprint | null,
        onSaveV2?: (fp: StyleFingerprint, features: StyleFingerprintFeaturesV2) => void,
    ) {
        super(app);
        this.fingerprint = { ...fingerprint };
        this.onSave = onSave;
        this.nameValue = fingerprint.name;
        this.sourceValue = fingerprint.source;
        this.tagsValue = fingerprint.tags.join(', ');
        this.v2Features = v2 ? { ...v2.features } : null;
        this.onSaveV2 = onSaveV2 ?? null;
    }

    /**
     * onOpen 方法。
     */
    onOpen() {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('fingerprint.view.editModalTitle') });

        new Setting(contentEl)
            .setName(t('fingerprint.view.fpName'))
            .addText(t => t
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName(t('fingerprint.view.sourceName'))
            .addText(t => t
                .setValue(this.sourceValue)
                .onChange(v => this.sourceValue = v));

        new Setting(contentEl)
            .setName(t('fingerprint.view.tagsName'))
            .setDesc(t('fingerprint.view.tagsDesc'))
            .addText(t => t
                .setValue(this.tagsValue)
                .onChange(v => this.tagsValue = v));

        if (this.v2Features) {
            const dims = contentEl.createDiv({ cls: 'nw-fp-edit-dims' });
            dims.createEl('h4', {
                text: t('fingerprint.view.v2EditTitle'),
                cls: 'nw-fp-section-h4 nw-fp-edit-dims-title'
            });
            for (const { key } of V2_FEATURE_LABELS) {
                const dim = this.v2Features[key];
                const dimSetting = new Setting(dims).setName(dimensionNameV2(key));
                if (dim.status !== 'complete') dimSetting.setDesc(t('fingerprint.view.dimPendingDesc'));
                dimSetting.addTextArea(t => {
                        const area = t
                            .setValue(dim.description || '')
                            .onChange(v => {
                                dim.description = v;
                                dim.status = v.trim() ? 'complete' : dim.status;
                            });
                        return area;
                    });
            }
        }

        const btnRow = contentEl.createDiv({
            cls: 'nw-fp-btn-row'
        });

        const cancelBtn = btnRow.createEl('button', {
            text: t('common.cancel'),
            cls: 'nw-fp-modal-btn'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnRow.createEl('button', {
            text: t('fingerprint.view.save'),
            cls: 'nw-fp-modal-btn nw-fp-modal-btn--primary'
        });
        saveBtn.addEventListener('click', () => {
            this.fingerprint.name = this.nameValue.trim() || this.fingerprint.name;
            this.fingerprint.source = this.sourceValue.trim();
            this.fingerprint.tags = this.tagsValue.split(',').map(t => t.trim()).filter(Boolean);
            if (this.v2Features && this.onSaveV2) {
                this.onSaveV2(this.fingerprint, this.v2Features);
            } else {
                this.onSave(this.fingerprint);
            }
            this.close();
        });
    }

    /**
     * onClose 方法。
     */
    onClose() {
        this.contentEl.empty();
    }
}

/**
 * 从章节抽取指纹弹窗。
 */
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

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('fingerprint.view.chapterModalTitle') });

        const desc = contentEl.createEl('p', {
            text: t('fingerprint.view.chapterListDesc', { count: this.chapters.length }),
            cls: 'nw-fp-extract-desc'
        });
        void desc;

        new Setting(contentEl)
            .setName(t('fingerprint.view.fpName'))
            .addText(t => t
                .setValue(this.fingerprintName)
                .onChange(v => this.fingerprintName = v));

        const btnRow1 = contentEl.createDiv({
            cls: 'nw-fp-extract-actions'
        });

        const selectAllBtn = btnRow1.createEl('button', {
            text: t('fingerprint.view.selectAll'),
            cls: 'nw-btn nw-fp-extract-btn',
            attr: {}
        });
        selectAllBtn.addEventListener('click', () => {
            this.chapters.forEach(c => this.selectedChapters.add(c));
            this.renderChapterList();
        });

        const deselectAllBtn = btnRow1.createEl('button', {
            text: t('fingerprint.view.selectNone'),
            cls: 'nw-btn nw-fp-extract-btn',
            attr: {}
        });
        deselectAllBtn.addEventListener('click', () => {
            this.selectedChapters.clear();
            this.renderChapterList();
        });

        const chapterListContainer = contentEl.createDiv({
            cls: 'nw-fp-chapter-list'
        });

        const renderChapterList = () => {
            chapterListContainer.empty();
            
            if (this.chapters.length === 0) {
                chapterListContainer.createDiv({
                    text: t('fingerprint.view.noChapters'),
                    cls: 'nw-fp-chapter-empty'
                });
                return;
            }

            this.chapters.forEach(chapterPath => {
                const fileName = chapterPath.split('/').pop() || chapterPath;
                const item = chapterListContainer.createDiv({
                    cls: 'nw-fp-chapter-row'
                });

                const checkbox = createEl('input');
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

                const nameEl = createSpan();
                nameEl.textContent = fileName;
                nameEl.addClass('nw-fp-chapter-name');
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
            cls: 'nw-fp-btn-row'
        });

        const cancelBtn = btnRow.createEl('button', {
            text: t('common.cancel'),
            cls: 'nw-btn'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = btnRow.createEl('button', {
            text: t('fingerprint.view.startExtract'),
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
        });
        confirmBtn.addEventListener('click', () => {
            if (this.selectedChapters.size === 0) {
                new Notice(t('fingerprint.view.needOneChapter'));
                return;
            }
            this.onConfirm([...this.selectedChapters], this.fingerprintName);
            this.close();
        });
    }

    private renderChapterList(): void {
    }

    /**
     * onClose 方法。
     */
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

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: t('fingerprint.view.kbModalTitle') });

        const list = contentEl.createDiv();
        list.addClass('nw-kb-picker-list');

        for (const book of this.books) {
            const row = list.createDiv();
            row.addClass('nw-kb-picker-row');

            const info = row.createDiv();
            info.createDiv({ text: book.name });
            if (book.author) {
                const author = info.createDiv({ text: book.author });
                author.addClass('nw-kb-picker-author');
            }

            const btn = row.createEl('button', { text: t('fingerprint.view.importRowBtn'), cls: 'mod-cta' });
            btn.addEventListener('click', () => {
                this.onSelect(book);
                this.close();
            });
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
