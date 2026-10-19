import { SidebarComponent } from './sidebar-component';
import { App, ItemView, WorkspaceLeaf, TFile, TFolder, Modal, Notice } from 'obsidian';
import { EntityOverviewModal } from './full-writer/entity-overview-modal';
import { ToolsModal } from './full-writer/tools-modal';
import { WizardTab, WizardStep, buildWizardSteps as buildWizardStepsExternal } from './full-writer/wizard-types';
import { buildTemplateVars as buildTemplateVarsExternal } from './full-writer/template-vars-builder';
import { FullWriterStoreImpl } from './full-writer/full-writer-store';
import { TabController } from './full-writer/tab-controller';
import { EntityStateController } from './full-writer/entity-state-controller';
import { TitleBarController } from './full-writer/title-bar-controller';
import { StatusBarController } from './full-writer/status-bar-controller';
import { ContextLoaderController } from './full-writer/context-loader-controller';
import { parseChapterFromPath, estimateTotalChars as calcTotalChars, rebuildChapDir, calcResumeStepIndex as calcResumeIdx, findStepByIndex } from './full-writer/full-writer-utils';
import { OutlineTreeController } from './full-writer/outline-tree-controller';
import { CoverPickerController } from './full-writer/cover-picker-controller';
import { SettingLibController } from './full-writer/setting-lib-controller';
import { StepRenderController } from './full-writer/step-render-controller';
import { WizardController } from './full-writer/wizard-controller';
import { ProjectSelectorController } from './full-writer/project-selector-controller';
import { InterventionController } from './full-writer/intervention-controller';
import type { WizardViewAccess } from './full-writer/wizard-view-access';
import { WizardStepRenderers } from './full-writer/wizard-step-renderers';
import { WizardStepExecutors } from './full-writer/wizard-step-executors';
import { injectFullWriterStyles } from './full-writer/fw-styles';
import NovelWriterPlugin from '../main';
import { AIEngine, APIResponse } from '../engine/ai-engine';
import { ContextManager, GatheredContext, CharacterData, ForeshadowData, TimelineEvent, MarkdownContent } from '../engine/context-manager';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { showProgress, hideProgress, showSuccess, showError, mkdirp, stripFrontmatter, applyNwScope } from '../utils/helpers';
import { getStepTemplate, fillTemplate } from '../engine/prompt-templates';
import { TemplateService } from '../services/template-service';
import { getForeshadowWarnings } from '../services/foreshadow-manager';
import { filterForeshadowsByChapter, getInvolvedEntities, getEntityStatusLine } from '../engine/chapter-context-builder';
import { scoreAndFilterEntities, ScoredEntity } from '../engine/entity-scorer';
import { buildCharacterSoulSummary, getProtagonistSoulDetail } from '../engine/character-soul';  // V2 P0-1
import { getChapterFile, getChapterFileName, findBodyFileV4 } from '../engine/chapter-utils';
import { MiniSettingsModal } from './mini-settings-modal';
import { EntityStateManager } from '../engine/entity-state-manager';
import { SettlementEngine } from '../engine/settlement-engine';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { ChapterStateManager } from './states/chapter-state-manager';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { StepRunner, ALL_FULL_STEPS, FullStep, StepRunCtx } from '../engine/step-runner';

import { CrossVolumeIntegrator } from '../engine/cross-volume-integration';
import { ContextPanel } from './rendering/context-panel';
import { RE_VOLUME_RANGE, FIELD_TOTAL_WORDS, FIELD_TOTAL_CHAPTERS, chapterOutlineSection, CHAPTER_STATUS } from '../shared/format-constants';
import { validateWorldviewOutput, validateOutlineOutput, validateFanficSettings } from '../shared/template-validator';
import { getWorldviewPath, getSettingLibPath, pjVolumeOutlineDir, readProjectMeta, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, SUBDIR_OUTLINE_ROOT, SUBDIR_TIMELINE, SUBDIR_CONTROL, SUBDIR_FANFIC, SUBDIR_VOLUME_OUTLINE } from '../shared/paths';
import { PlanBookModal } from './plan-book-modal';
import { BatchCreateModal } from './batch-create-modal';
import { WritingStyleModal } from './writing-style-modal';
import { ChapterOutlineTreeModal } from './chapter-outline-tree-modal';
import { PolishEditor } from './polish-editor';
import { WizardChecker } from './wizard-checker';
import { pjSettingLib, pjWritingStyle, pjStepDir,
    SUBDIR_WORLD_ARCH, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS,
    SUBDIR_WORLDVIEW_FILE, SUBDIR_SETTING_LIB_FILE, SUBDIR_WRITING_STYLE_FILE } from '../shared/paths';
import { getWritingStyleCandidatePaths } from './writing-style-paths';
import { sortChaptersByNumber, getNextChapter, getProjectCover, getChaptersForProject, deleteProject, updateWritingStyleTemplate, getProjectMeta } from './project-utils';
import { CHAR_TO_TOKEN_RATIO, INFO_DEBT_MAX, INFO_DEBT_WARN_CRITICAL, INFO_DEBT_WARN_HIGH } from '../shared/thresholds';
import { createLogger } from '../shared/logger';


const log = createLogger('FullWriterView');
export const VIEW_TYPE = 'novel-writer-full-writer';

export class FullWriterView extends ItemView {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;

    private state: FullWriterStoreImpl;
    private tabController!: TabController;
    private entityStateController!: EntityStateController;
    private titleBarController!: TitleBarController;
    private statusBarController!: StatusBarController;
    private contextLoaderController!: ContextLoaderController;

    private context: GatheredContext | null = null;

    private chapterStateManager: ChapterStateManager;
    private stepRunner: StepRunner;
    private contextPanel: ContextPanel;
    private _progressNotice: Notice | null = null;
    private stepAbortController: AbortController | null = null;
    private settlementEngine: SettlementEngine;
    private polishEditor: PolishEditor;
    private wizardChecker: WizardChecker;
    private outlineTreeController: OutlineTreeController;
    private coverPickerController: CoverPickerController;
    private settingLibController: SettingLibController;
    private stepRenderController: StepRenderController;
    private wizardStepRenderers: WizardStepRenderers;
    private wizardStepExecutors: WizardStepExecutors;
    private outlineTreeModal: ChapterOutlineTreeModal | null = null;
    private wizardController: WizardController;
    private projectSelectorController: ProjectSelectorController;
    private interventionController: InterventionController;

    private mainContainer: HTMLElement | null = null;
    private workspace: HTMLElement | null = null;

    private currentReport: any = null;

    private get stepCompleted(): Set<string> { return this.chapterStateManager.stepCompleted; }
    private get stepResults(): Record<string, string> { return this.chapterStateManager.stepResults; }
    private get currentStepIndex(): number { return this.chapterStateManager.currentStepIndex; }
    private set currentStepIndex(v: number) { this.chapterStateManager.currentStepIndex = v; }

    private get project(): string { return this.state.project; }
    private set project(v: string) { this.state.project = v; }
    private get chapterName(): string { return this.state.chapterName; }
    private set chapterName(v: string) { this.state.chapterName = v; }
    private get chapterNum(): number { return this.state.chapterNum; }
    private set chapterNum(v: number) { this.state.chapterNum = v; }
    private get volume(): string { return this.state.volume; }
    private set volume(v: string) { this.state.volume = v; }
    private get chapDir(): string { return this.state.chapDir; }
    private set chapDir(v: string) { this.state.chapDir = v; }
    private get vars(): Record<string, string> { return this.state.vars; }
    private set vars(v: Record<string, string>) { this.state.vars = v; }
    private get isLoading(): boolean { return this.state.isLoading; }
    private set isLoading(v: boolean) { this.state.isLoading = v; }

    get tabs(): any[] { return this.state.tabs as any[]; }
    set tabs(v: any[]) { this.state.tabs = v; }
    private get activeTabId(): string { return this.state.activeTabId; }
    private set activeTabId(v: string) { this.state.activeTabId = v; }
    private get navStack(): string[] { return this.state.navStack; }
    private set navStack(v: string[]) { this.state.navStack = v; }

    private get wizardStepResults(): Record<string, string> { return this.state.wizardStepResults; }
    get wizardStepExecuting(): Set<string> { return this.state.wizardStepExecuting; }

    /** 供质量仪表盘等外部组件获取当前选中章节（工作台视图活动时 getActiveFile 为 null，需此 fallback） */
    public getCurrentChapterState(): { project: string; chapterName: string; chapterNum: number; volume: string } {
        return { project: this.project, chapterName: this.chapterName, chapterNum: this.chapterNum, volume: this.volume };
    }

    private tabBar!: HTMLDivElement;
    tabContent!: HTMLDivElement;

    private systemPromptEl!: HTMLTextAreaElement;
    private userPromptEl!: HTMLTextAreaElement;
    private temperatureSlider!: HTMLInputElement;
    private temperatureValueEl!: HTMLSpanElement;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.settlementEngine = plugin.engineRegistry.get<SettlementEngine>(ENGINE_NAMES.SETTLEMENT_ENGINE);
        this.chapterStateManager = new ChapterStateManager(this.app);
        this.state = new FullWriterStoreImpl();

        const stepRunnerCallbacks = {
            showProgress: (message: string) => {
                if (this._progressNotice) {
                    this._progressNotice.hide();
                }
                this._progressNotice = new Notice(message, 0);
            },
            hideProgress: () => {
                if (this._progressNotice) {
                    this._progressNotice.hide();
                    this._progressNotice = null;
                }
            },
            showSuccess: (message: string, duration?: number) => {
                new Notice(message, duration);
            },
            showError: (message: string, duration?: number) => {
                new Notice(message, duration);
            },
            showNotice: (message: string, duration?: number) => {
                new Notice(message, duration);
            },
            showWarning: (message: string, duration?: number) => {
                new Notice(message, duration);
            },
        };

        this.stepRunner = new StepRunner(this.app, plugin, stepRunnerCallbacks);
        this.contextPanel = new ContextPanel(this.app);
        this.polishEditor = new PolishEditor(this.stepRunner, this.plugin);
        this.wizardChecker = new WizardChecker(this.app);
        this.outlineTreeController = new OutlineTreeController(this.app, () => this.project);
        this.coverPickerController = new CoverPickerController(this.app);
        this.settingLibController = new SettingLibController(
            this.app,
            this.plugin,
            () => this.project,
            () => this.renderInContainer(this.tabContent),
        );
        this.stepRenderController = new StepRenderController({
            app: this.app,
            plugin: this.plugin,
            stepRunner: this.stepRunner,
            chapterState: this.chapterStateManager,
            getProject: () => this.project,
            getChapDir: () => this.chapDir,
            getChapterName: () => this.chapterName,
            getVolume: () => this.volume,
            getVars: () => this.vars,
            getTabContent: () => this.tabContent,
            renderInContainer: (c) => this.renderInContainer(c),
            renderInterventionBox: (c) => this.interventionController.render(c),
            renderPolishEditor: (area) => this.renderPolishEditor(area),
        });
        this.wizardStepRenderers = new WizardStepRenderers(
            this.wizardStepResults,
            this.wizardStepExecuting,
            this.app,
            this.plugin,
            (container, filePath, title) => this.showFileContentInline(container, filePath, title),
            (tab, step) => this.wizardStepExecutors.executeWizardStep(tab, step),
            (tab, skipAutoAdvance) => this.renderWizardTabContent(tab, skipAutoAdvance),
            (modal) => { this.outlineTreeModal = modal; },
        );
        this.wizardStepExecutors = new WizardStepExecutors(
            this.app,
            this.plugin,
            this.aiEngine,
            this.wizardStepResults,
            this.wizardStepExecuting,
            (id) => this.tabs.find(t => t.id === id) as WizardTab | undefined,
            (tab, skipAutoAdvance) => this.renderWizardTabContent(tab, skipAutoAdvance),
            (project) => this.checkChaptersComplete(project),
            () => this.tabContent,
        );
        this.wizardController = new WizardController(
            this as unknown as WizardViewAccess,
            this.wizardStepRenderers,
            this.wizardStepExecutors,
            this.wizardChecker,
        );

        this.projectSelectorController = new ProjectSelectorController(
            this.app,
            this.plugin,
            {
                getContextManager: () => this.contextManager,
                getCoverPicker: () => this.coverPickerController,
                onSelectChapter: (project, chapter) => this.selectChapter(project, chapter),
                onOpenWizard: (project) => this.openWizardForProject(project),
                onOpenCoWriting: (project, chapter) => this.openChapterInCoWriting(project, chapter),
                onDeleteProject: () => this.renderProjectSelectorInTab(),
                executeCommand: (cmd) => this.plugin.executeCommand(cmd),
            }
        );

        this.interventionController = new InterventionController(
            this.app,
            this.plugin,
            {
                getVars: () => this.vars,
                setVar: (key, value) => { this.vars[key] = value; },
                deleteVar: (key) => { delete this.vars[key]; },
                getStepResults: () => this.stepResults,
                setStepResult: (key, value) => { this.stepResults[key] = value; },
                getAIEngine: () => this.aiEngine,
                getStepRunner: () => this.stepRunner,
                getCurrentStepIndex: () => this.chapterStateManager.currentStepIndex,
                makeStepRunCtx: () => this._makeStepRunCtx(),
                onRenderNeeded: () => this.renderInContainer(this.tabContent),
                getFlashModel: () => this.plugin.settings.flashModel,
            }
        );

        this.tabController = new TabController({
            app: this.app,
            plugin: this.plugin,
            state: this.state,
            getTabBar: () => this.tabBar,
            getTabContent: () => this.tabContent,
            closeOutlineTreeModal: () => this.closeOutlineTreeModal(),
            renderProjectSelector: () => this.renderProjectSelectorInTab(),
            renderWizardTabContent: (tab, skipAutoAdvance) => this.renderWizardTabContent(tab, skipAutoAdvance),
            renderInContainer: (c) => this.renderInContainer(c),
            loadContext: () => this.loadContext(),
            getChapterStateManager: () => this.chapterStateManager,
            calcResumeStepIndex: () => this._calcResumeStepIndex(),
            rebuildChapDirIfNeeded: (project, chapterName, volume, chapterNum) =>
                this._rebuildChapDir(project, chapterName, volume, chapterNum),
        });

        this.entityStateController = new EntityStateController({
            app: this.app,
            plugin: this.plugin,
            aiEngine: this.aiEngine,
            state: this.state,
            getContext: () => this.context,
            getContextPanel: () => this.contextPanel,
            getWorkspace: () => this.workspace || this.mainContainer?.querySelector('.novel-writer-fw-workspace') as HTMLElement || null,
            estimateTotalChars: () => this.estimateTotalChars(),
        });

        this.titleBarController = new TitleBarController({
            app: this.app,
            plugin: this.plugin,
            state: this.state,
            contextManager: this.contextManager,
            activateTab: (tabId) => this.activateTab(tabId),
            switchProjectQuick: () => this.switchProjectQuick(),
            getChaptersForProject: (project) => this.getChaptersForProject(project),
            sortChaptersByNumber: (chapters) => this.sortChaptersByNumber(chapters),
            selectChapter: (project, chapter) => this.selectChapter(project, chapter),
            openCurrentChapterInCoWriting: () => this.openCurrentChapterInCoWriting(),
            openKnowledgeBase: () => this.openKnowledgeBase(),
            openFingerprintLibrary: () => this.openFingerprintLibrary(),
        });

        this.statusBarController = new StatusBarController({
            app: this.app,
            plugin: this.plugin,
            state: this.state,
            getChapterStateManager: () => this.chapterStateManager,
            estimateTotalChars: () => this.estimateTotalChars(),
        });

        this.contextLoaderController = new ContextLoaderController({
            app: this.app,
            plugin: this.plugin,
            state: this.state,
            contextManager: this.contextManager,
            getChapterStateManager: () => this.chapterStateManager,
            getContext: () => this.context,
            setContext: (ctx) => { this.context = ctx; },
            activateTab: (tabId) => this.activateTab(tabId),
            entityStateController: this.entityStateController,
        });
    }

    private _rebuildChapDir(project: string, chapterName: string, volume: string, chapterNum?: number): string {
        return rebuildChapDir(project, chapterName, volume, chapterNum);
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return '📖 完整写作工作台';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        applyNwScope(this);

        // 标记工作台上下文：Modal 不应在 Obsidian 主窗口打开文件
        this.plugin._isWorkbenchContext = true;

        // v3.4.6 flex 容器 + 宽高 100%（防 Obsidian 主题约束）
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.width = '100%';
        contentEl.style.height = '100%';

        // v3.4.5: 注入 CSS 响应式变量（全局生效，一次定义，所有弹窗/面板复用）
        // 注：数值与 styles.css :root 保底值保持一致，仅在未来需要动态计算时才覆盖
        const root = document.documentElement;
        root.style.setProperty('--nw-wizard-sidebar-w', 'clamp(200px, 14vw, 240px)');
        root.style.setProperty('--nw-entity-tree-w', 'min(240px, 16vw)');
        root.style.setProperty('--nw-modal-max-w', '96vw');
        root.style.setProperty('--nw-modal-max-h', '90vh');
        root.style.setProperty('--nw-modal-md-w', 'min(1000px, 85vw)');
        root.style.setProperty('--nw-project-selector-w', 'min(1000px, 85vw)');
        root.style.setProperty('--nw-step-min-h', 'max(320px, calc(100vh - 380px))');
        root.style.setProperty('--nw-scroll-max-h', 'max(450px, 55vh)');
        root.style.setProperty('--nw-scroll-md-h', 'max(280px, 35vh)');
        root.style.setProperty('--nw-grid-3col', 'minmax(120px, 160px) 1fr minmax(180px, 240px)');
        root.style.setProperty('--nw-grid-2col-fm', 'auto 1fr');
        root.style.setProperty('--nw-grid-workspace', 'minmax(120px, 160px) 1fr minmax(180px, 240px)');
        root.style.setProperty('--nw-panel-pad', '20px');
        root.style.setProperty('--nw-card-pad', '16px');

        // 创建 Tab 栏
        this.tabBar = contentEl.createDiv({
            cls: 'novel-writer-fw-tabs-container novel-writer-fw-tabbar nw-fullwriter-tabbar',
        });

        // 创建 Tab 内容区
        this.tabContent = contentEl.createDiv({
            attr: { style: 'flex: 1; width: 100%; overflow: hidden; display: flex; flex-direction: column; min-height: 0;' }
        });

        // 默认创建项目选择 Tab
        this.tabs = [{ id: 'project-selector', label: '📋 项目与章节', type: 'selector' }];
        this.activeTabId = 'project-selector';

        const pendingState = this.plugin._pendingReloadState;
        if (pendingState) {
            // 仅当 main.ts onload 设置了 _pendingReloadState（即用户主动热重载）才恢复正文
            // P0-14: Obsidian 启动加载插件时不会设置此字段 → 自动落在「项目与章节」
            this.project = pendingState.project;
            this.chapterName = pendingState.chapterFileName || '';
            if (pendingState.volume) this.volume = pendingState.volume;
            if (pendingState.chapDir) this.chapDir = pendingState.chapDir;
            this.plugin._pendingReloadState = null;
            if (this.chapterName) {
                this.chapterNum = parseInt(this.chapterName.match(/\d+/)?.[0] || '0');
            }
        } else {
            // P0-14: 默认行为 — 不从活跃文件解析章节，强制停留在「项目与章节」选项卡
            // 用户可在「项目与章节」中手动选择项目和章节进入正文写作
            this.project = '';
            this.chapterName = '';
            this.chapDir = '';
            this.volume = '';
        }

        this.renderTabBar();

        if (this.project && this.chapterName) {
            // 有活跃章节 → 新建章节 Tab
            const chapKey = `${this.project}/${this.chapterName}`;
            this.tabs.push({
                id: `chapter-${Date.now()}`,
                label: `✍️ ${this.chapterName}`,
                type: 'chapter',
                chapterKey: chapKey,
                project: this.project,
                chapterName: this.chapterName,
                volume: this.volume,
                chapDir: this.chapDir,
                chapterNum: this.chapterNum
            });
            this.activeTabId = this.tabs[this.tabs.length - 1].id;
            this.renderTabBar();
            try {
                await this.loadContext();
                await this.chapterStateManager.restoreChapterState(this.chapDir);
                await this.renderTabContent();
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                log.error('[FullWriter] onOpen error:', errMsg);
                this.activateTab('project-selector');
            }
        } else {
            // 无活跃章节 → 显示项目选择
            this.renderTabBar();
            try {
                await this.loadContext();
                await this.renderProjectSelectorInTab();
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                log.error('[FullWriter] onOpen 加载失败:', errMsg);
                new Notice('⚠️ 项目加载失败，请检查项目文件是否完整', 5000);
            }
        }

        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (file) this.handleFileChange(file);
        }));

        // 监听项目创建事件（Obsidian Workspace 内置事件系统）
        this.registerEvent(
            this.app.workspace.on('novel-writer:project-created', async (data: { projectName: string; projectType: 'original' | 'fanfic' }) => {
                log.warn('[FullWriter] project-created 事件触发:', data.projectName, data.projectType);
                // 1. 确保在 project-selector tab（不依赖 activateTab 的提前返回）
                if (this.activeTabId !== 'project-selector') {
                    await this.activateTab('project-selector');
                }
                // 2. 直接调用 renderProjectSelectorInTab 强制重渲染（不依赖 refresh/container）
                //    延迟 150ms 确保 vault.create 已完成
                setTimeout(async () => {
                    try {
                        await this.renderProjectSelectorInTab();
                        // 3. 高亮新项目
                        await this.projectSelectorController.highlightProject(data.projectName);
                    } catch (e: unknown) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        log.error('[FullWriter] 刷新项目列表失败:', errMsg);
                    }
                }, 150);
            })
        );

        // 监听刷新上下文面板事件
        this.registerEvent(
            this.app.workspace.on('novel-writer:refresh-context-panel', () => {
                this.refreshContextBar();
            })
        );
    }

    async onClose(): Promise<void> {
        this.stepAbortController?.abort();
        this.stepAbortController = null;
        await super.onClose();
        const { contentEl } = this;
        contentEl.empty();
        this.tabs = [];
        this.activeTabId = '';
        // v3.4.9: 清理项目选择器的全局监听器
        if (this.projectSelectorCleanup) {
            this.projectSelectorCleanup();
            this.projectSelectorCleanup = null;
        }
        // R3-2: 卸载 ContextPanel 缓存组件，释放 MarkdownRenderer 子资源
        if (this.contextPanel) {
            this.contextPanel.unload();
        }
        // 清除工作台上下文标记
        this.plugin._isWorkbenchContext = false;
    }

    private async handleFileChange(file: TFile): Promise<void> {
        if (this.isLoading) return;
        // v73: wizard tab 期间跳过文件变更处理，防止 AI 写文件触发 renderInContainer 产生幽灵 UI
        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        if (activeTab && activeTab.type === 'wizard') return;

        const oldProject = this.project;
        const oldChapter = this.chapterName;

        await this.parseActiveFile();

        if (this.project !== oldProject || this.chapterName !== oldChapter) {
            this.chapterStateManager.reset();
            this.context = null;

            await this.loadContext();
            await this.chapterStateManager.restoreChapterState(this.chapDir);
            await this.renderInContainer(this.tabContent);
        }
    }

    // ============================================================
    // Tab 系统（委托给 TabController）
    // ============================================================
    async pushNav(tabId: string): Promise<void> {
        await this.tabController.pushNav(tabId);
    }

    popNav(): void {
        this.tabController.popNav();
    }

    private renderTabBar(): void {
        this.tabController.renderTabBar();
    }

    private async activateTab(tabId: string): Promise<void> {
        await this.tabController.activateTab(tabId);
    }

    closeOutlineTreeModal(): void {
        if (this.outlineTreeModal) {
            this.outlineTreeModal.close();
            this.outlineTreeModal = null;
        }
    }

    closeTab(tabId: string): void {
        this.tabController.closeTab(tabId);
    }

    private _calcResumeStepIndex(): number {
        return calcResumeIdx(this.stepCompleted);
    }

    private async renderTabContent(): Promise<void> {
        await this.tabController.renderTabContent();
    }

    private async openCurrentChapterInCoWriting(): Promise<void> {
        if (!this.project || !this.chapterName || !this.chapterNum) {
            new Notice('请先选择具体章节，再进入句级协同写作。');
            return;
        }
        await this.plugin.activateCoWritingView(this.project, this.chapterName, this.volume || '第1卷', this.chapterNum);
    }

    private openKnowledgeBase(): void {
        this.plugin.openKnowledgeBaseView();
    }

    private openFingerprintLibrary(): void {
        this.plugin.executeCommand('novel-writer-fingerprint-library');
    }

    /**
     * v73: 从「项目与章节」卡片一步直达句级协同写作。
     * 接收章节对象（含 chapter/volume/file），解析全书连续章号后带上下文进入协同 view。
     */
    private async openChapterInCoWriting(project: string, chapter: { chapter: string; volume: string; file: TFile }): Promise<void> {
        const chapterNum = parseInt(chapter.chapter.match(/\d+/)?.[0] || '0', 10);
        if (!chapterNum) {
            new Notice('无法解析章号，请检查章节命名。', 4000);
            return;
        }
        await this.plugin.activateCoWritingView(project, chapter.chapter, chapter.volume || '第1卷', chapterNum);
    }

    // ============================================================
    // 步骤运行上下文
    // ============================================================
    private _makeStepRunCtx(): StepRunCtx {
        return {
            stepResults: this.stepResults,
            stepCompleted: this.chapterStateManager.stepCompleted,
            currentStepIndex: this.chapterStateManager.currentStepIndex,
            setCurrentStepIndex: (v: number) => { this.chapterStateManager.currentStepIndex = v; },
            tabContent: this.tabContent,
            systemPromptEl: this.systemPromptEl,
            userPromptEl: this.userPromptEl,
            temperatureSlider: this.temperatureSlider,
            chapDir: this.chapDir,
            chapterName: this.chapterName,
            volume: this.volume,
            chapterNum: this.chapterNum,
            project: this.project,
            vars: this.vars,
            isLoading: this.isLoading,
            buildTemplateVars: () => this.buildTemplateVars(),
            saveStepResult: async (key, content) => { await this.stepRunner.saveStepResult(key, content, this.chapDir, this.chapterName, this.volume); },
            renderInContainer: (c) => this.renderInContainer(c),
            setIsLoading: (v) => {
                this.isLoading = v;
                if (!v) this.stepAbortController = null;
            },
            getAbortController: () => {
                if (!this.stepAbortController) this.stepAbortController = new AbortController();
                return this.stepAbortController;
            },
            refreshWorkspace: () => {},

            // ✅ v1.6.0 实体状态追踪：步骤完成后回调
            onStepComplete: async (stepKey: string, content: string) => {
                // v6.0: 统一更新步骤状态（走结构化校验，更新 stepLevels/stepMissing/stepCompleted）
                this.chapterStateManager.updateStepState(stepKey, content);

                // 只在 Step 4（正文生成）完成后触发状态检测
                // v3.4.8 B7: 扩展 onStepComplete 触发——fix/finalFix 改写正文后也需重新检测实体状态
                if ((stepKey === 'bodyGeneration' || stepKey === 'fix' || stepKey === 'finalFix') && this.project && this.chapterNum) {
                    await this.detectAndUpdateEntityStates(content);
                }
            },

            generatedThisSession: this.chapterStateManager.generatedThisSession,
        };
    }

    // ============================================================
    // 解析当前文件
    // ============================================================
    private async parseActiveFile(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            this.project = '';
            return;
        }

        const parsed = parseChapterFromPath(activeFile.path);
        this.project = parsed.project;
        this.volume = parsed.volume;
        this.chapterName = parsed.chapterName;
        this.chapterNum = parsed.chapterNum;

        if (this.chapterName && this.volume && this.project) {
            const volN = parseInt(this.volume.match(/第(\d+)卷/)?.[1] || '1', 10);
            this.chapDir = pjStepDir(this.project, volN, this.chapterNum);
        } else {
            this.chapDir = '';
        }
    }

    // ============================================================
    // 项目切换
    // ============================================================
    private async resetAndGoToSelector(): Promise<void> {
        this.contextManager = this.plugin.ctxManager;
        const currentProject = this.state.project;
        if (currentProject) {
            this.contextManager.invalidateContextCache(currentProject);
        }
        this.state.resetNavState();
        this.chapterStateManager.reset();
        this.context = null;
        await this.activateTab('project-selector');
    }

    private async onProjectChange(): Promise<void> {
        await this.resetAndGoToSelector();
    }

    private async switchProjectQuick(): Promise<void> {
        await this.resetAndGoToSelector();
    }

    // ============================================================
    // 上下文加载（步骤0）
    // ============================================================
    private async loadContext(): Promise<void> {
        await this.contextLoaderController.loadContext();
    }


    // ============================================================
    // 项目选择界面（委托给 ProjectSelectorController）
    // ============================================================
    private projectSelectorCleanup: (() => void) | null = null;

    private async renderProjectSelectorInTab(): Promise<void> {
        await this.projectSelectorController.render(this.tabContent);
    }

    // v3.4.9 委托: → project-utils.ts
    private getChaptersForProject(project: string): Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }> {
        return getChaptersForProject(this.app, project);
    }

    private async selectChapter(project: string, chapter: { chapter: string; volume: string; file: TFile }): Promise<void> {
        await this.tabController.selectChapter(project, chapter);
    }

    private showAllChapters(project: string, chapters: Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }>): void {
        this.projectSelectorController.showAllChapters(project, chapters);
    }

    // ============================================================
    // 项目管理辅助方法
    // ============================================================
    // v3.4.9: getProjectCover → project-utils.ts 委托

    private getProjectCover(project: string): string | null {
        return getProjectCover(this.app, project);
    }

    private async getProjectMeta(project: string): Promise<{
        genre: string; description: string;
        volumes: Array<{ name: string; range: string }>;
        totalWordsTarget: string; totalChapters: number;
    }> {
        return getProjectMeta(this.app, project);
    }

    // v3.4.8 B11: 章节排序工具函数——消除4处重复的 sort+parseInt+match 模式
    // v3.4.9 委托: → project-utils.ts
    private sortChaptersByNumber<T extends { chapter: string }>(chapters: T[]): T[] {
        return sortChaptersByNumber(chapters);
    }

    private getNextChapter(sortedChapters: Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }>): { chapter: string; volume: string; title: string; status: string; file: TFile } | null {
        return getNextChapter(sortedChapters);
    }

    /** v3.4.6: 从向导完成后直接进入写作界面，打开第一个未完稿章节 */
    async openFirstUnwrittenChapter(project: string): Promise<void> {
        try {
            // 获取项目所有章节
            const chapters = this.getChaptersForProject(project);
            const sortedChapters = this.sortChaptersByNumber(chapters);
            
            // 找到第一个未完稿章节
            const nextChapter = this.getNextChapter(sortedChapters);
            
            if (nextChapter) {
                log.info('[小说工坊] 进入写作界面，定位章节:', nextChapter.chapter, nextChapter.title);
                await this.selectChapter(project, nextChapter);
            } else {
                // 没有章节则提示用户
                new Notice('⚠️ 未找到章节文件，请先运行批量建章', 5000);
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('[小说工坊] 进入写作界面失败:', errMsg);
            new Notice('❌ 进入写作界面失败: ' + errMsg, 5000);
        }
    }

    // ============================================================
    // 向导系统
    // ============================================================

    private buildWizardSteps(projectType: 'original' | 'fanfic'): WizardStep[] {
        return this.wizardController.buildWizardSteps(projectType);
    }

    private async quickCreateProject(projectType: 'original' | 'fanfic'): Promise<void> {
        const timestamp = Date.now();
        const projectName = `新项目-${timestamp}`;
        
        try {
            const adapter = this.app.vault.adapter;

            const wizardTabs = this.tabs.filter(t => t.type === 'wizard');
            for (const wt of wizardTabs) {
                const idx = this.tabs.findIndex(t => t.id === wt.id);
                if (idx >= 0) this.tabs.splice(idx, 1);
            }
            
            // v4.0: 创建标准项目目录结构（正文/ 和 步骤结果/ 分离）
            const dirs = [
                projectName,
                `${projectName}/${SUBDIR_WORLD_ARCH}`,
                `${projectName}/${SUBDIR_CHARS}`,
                `${projectName}/${SUBDIR_LOCS}`,
                `${projectName}/${SUBDIR_FACTIONS}`,
                `${projectName}/${SUBDIR_ITEMS}`,
                `${projectName}/${SUBDIR_TIMELINE}`,
                `${projectName}/${SUBDIR_OUTLINE_ROOT}`,
                `${projectName}/${SUBDIR_BODY_ROOT}`,
                `${projectName}/${SUBDIR_STEP_ROOT}`,
                `${projectName}/${SUBDIR_VOLUME_OUTLINE}`,
                `${projectName}/${SUBDIR_CONTROL}`,
                `${projectName}/${SUBDIR_FANFIC}`,
                `${projectName}/封面`,
            ];
            
            for (const dir of dirs) {
                if (!(await adapter.exists(dir))) {
                    await adapter.mkdir(dir);
                }
            }

            // v4.0: 复制必需模板——AI引擎写入需要文件已存在
            const templateCopies = [
                { src: '元文件/00-系统模板/世界观模板.md', dst: `${projectName}/${SUBDIR_WORLDVIEW_FILE}` },
                { src: '元文件/00-系统模板/设定库模板.md', dst: `${projectName}/${SUBDIR_SETTING_LIB_FILE}` },
                { src: '元文件/00-系统模板/文笔风格模板.md', dst: `${projectName}/${SUBDIR_WRITING_STYLE_FILE}` },
            ];
            for (const { src, dst } of templateCopies) {
                if (!(await adapter.exists(dst)) && await adapter.exists(src)) {
                    const content = await adapter.read(src);
                    await adapter.write(dst, content);
                }
            }

            // 创建 .project 文件
            const projectContent = `# ${projectName}\n\n## 类型\n${projectType}\n\n`;
            await adapter.write(`${projectName}/.project`, projectContent);

            // 构建向导步骤
            const steps = this.buildWizardSteps(projectType);
            
            // 计算起始步骤索引：两种类型都从各自首步开始
            // original: 世界观(idx0) → 实体 → 大纲 → 建章 → 完成
            // fanfic:   原作导入(idx0) → 实体 → 世界观 → 大纲 → 建章 → 完成
            const startIdx = 0;
            
            const wizardId = `wizard-${Date.now()}`;
            this.tabs.push({
                id: wizardId,
                label: '🧙 项目向导',
                type: 'wizard',
                project: projectName,
                projectType,
                currentStepIdx: Math.max(0, startIdx),
                steps,
            });
            await this.pushNav(wizardId);
            // pushNav 内部已调用 activateTab → renderTabBar + renderTabContent，不重复渲染
            
            new Notice(`✅ 项目 "${projectName}" 已创建，开始引导向导`, 3000);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('Quick create project failed:', errMsg);
            new Notice('❌ 快速创建项目失败：' + errMsg, 5000);
        }
    }

    private async openWizardForProject(project: string): Promise<void> {
        await this.wizardController.openWizardForProject(project);
    }

    private async renderWizardTabContent(tab: WizardTab, skipAutoAdvance = false): Promise<void> {
        await this.wizardController.renderTabContent(tab, skipAutoAdvance);
    }

    private async renderWizardCurrentStep(tab: WizardTab, contentArea: HTMLElement, sidebar: HTMLElement): Promise<void> {
        await this.wizardController.renderCurrentStep(tab, contentArea, sidebar);
    }

    private renderWizardNavBar(tab: WizardTab, step: WizardStep, navBar: HTMLElement, contentArea?: HTMLElement): void {
        this.wizardController.renderNavBar(tab, step, navBar, contentArea);
    }

    /**
     * v3.5: 工作台内联文件预览——在工作台内查看文件内容，不跳出到 Obsidian 编辑器
     * 理念：工作台是创作工作区，不是数据层文档编辑器。预览只读，不暴露模板字段。
     */
    private async showFileContentInline(container: HTMLElement, filePath: string, title: string): Promise<void> {
        // 移除已有预览
        const existing = container.querySelector('.novel-writer-inline-preview');
        if (existing) existing.remove();

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`⚠️ 文件不存在: ${filePath}`, 4000);
            return;
        }
        const rawContent = await this.app.vault.read(file);
        // 去 frontmatter，只展示正文内容（保护模板字段不被直接暴露）
        const bodyContent = rawContent.replace(/^---[\s\S]*?---\n*/, '').trim();

        const preview = container.createDiv({ cls: 'novel-writer-inline-preview', attr: { style: 'margin-top:12px; border:1px solid var(--background-modifier-border); border-radius:8px; overflow:hidden;' } });
        
        const header = preview.createDiv({ attr: { style: 'display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--background-secondary); border-bottom:1px solid var(--background-modifier-border);' } });
        header.createSpan({ text: `📄 ${title}`, attr: { style: 'font-weight:600; font-size:0.9em;' } });
        const closeBtn = header.createEl('button', { text: '✕ 关闭', attr: { style: 'padding:2px 10px; background:var(--background-modifier-border); border:none; border-radius:4px; cursor:pointer; font-size:0.8em;' } });
        closeBtn.addEventListener('click', () => preview.remove());

        const contentEl = preview.createDiv({ attr: { style: 'padding:12px; max-height:50vh; overflow-y:auto; font-size:0.85em; line-height:1.6; white-space:pre-wrap; word-break:break-word;' } });
        contentEl.setText(bodyContent.slice(0, 15000));

        // 滚动到预览区
        preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ============================================================
    // 各步骤渲染方法
    // ============================================================

    // v3.4.9 委托: → project-utils.ts
    private async deleteProject(projectName: string): Promise<void> {
        return deleteProject(this.app, projectName);
    }

    private showDeleteProjectModal(projectName: string): void {
        this.projectSelectorController.showDeleteProjectModal(projectName);
    }

    // v3.4.9 委托: → project-utils.ts
    private async updateWritingStyleTemplate(projectName: string): Promise<void> {
        return updateWritingStyleTemplate(this.app, projectName);
    }

    // ============================================================
    // 构建模板变量
    // ============================================================
    /** 构建模板变量：委托 full-writer/template-vars-builder（D 阶段外迁）。 */
    private async buildTemplateVars(): Promise<Record<string, string>> {
        return buildTemplateVarsExternal({
            app: this.app,
            plugin: this.plugin,
            project: this.project,
            chapterName: this.chapterName,
            chapterNum: this.chapterNum,
            volume: this.volume,
            chapDir: this.chapDir,
            context: this.context,
            viewVars: this.vars,
            stepResults: this.stepResults,
        });
    }

    // ============================================================
    // 渲染整个界面
    // ============================================================
    private async renderInContainer(container: HTMLElement): Promise<void> {
        container.empty();

        if (!this.project) {
            await this.loadContext();
            return;
        }

        // 上下文未加载时自动加载，防止渲染死态
        if (!this.stepCompleted.has('context') && this.chapterName) {
            await this.loadContext();
        }
        // 上下文加载失败（仍无 context），且没有章节可选，回退到项目选择器
        if (!this.stepCompleted.has('context') && !this.chapterName) {
            await this.renderProjectSelectorInTab();
            return;
        }

        try {
            const mainContainer = container.createDiv({ cls: 'novel-writer-fw-container' });
            this.mainContainer = mainContainer;  // 保存引用供 refreshContextBar 使用

            // 标题栏
            await this.renderTitleBar(mainContainer);

            // 三栏布局：步骤导航(grid-col:1) | 正文写作(grid-col:2) | 上下文监控(grid-col:3)
            const workspace = mainContainer.createDiv({ cls: 'novel-writer-fw-workspace' });
            // 仅设置不影响响应式断点的基础尺寸；display/grid 模板交由 styles.css 控制，
            // 否则内联 !important 会压过 @media(max-width:1100px) 的窄屏单列规则（中间栏滑块丢失根因）。
            Object.assign(workspace.style, {
                width: '100%',
                height: '100%',
                flex: '1',
                minHeight: '0',
            } as CSSStyleDeclaration);
            this.workspace = workspace;  // 保存引用供 refreshContextBar 使用
            this.renderStepNav(workspace);
            await this.renderPromptArea(workspace);
            try {
                this.contextPanel.render(workspace, this.context, this.project, this.chapterNum, this.plugin, () => this.estimateTotalChars());
            } catch (e) {
                log.warn('[小说工坊] 上下文面板渲染异常（已跳过）:', e);
                workspace.createDiv({ text: '⚠️ 上下文面板渲染失败', cls: 'novel-writer-fw-warning' });
            }

            // 状态栏
            this.renderStatusBar(mainContainer);

            // 注入样式
            injectFullWriterStyles();
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('[小说工坊] 渲染失败:', errMsg);
            container.createEl('div', {
                text: `❌ 渲染失败: ${errMsg}`,
                cls: 'novel-writer-fw-empty'
            });
        }
    }

    // ============================================================
    // 标题栏
    // ============================================================
    private async renderTitleBar(container: HTMLElement): Promise<void> {
        await this.titleBarController.renderTitleBar(container);
    }

    // ============================================================
    // 左侧步骤导航
    // ============================================================
    private renderStepNav(workspace: HTMLElement): void {
        // D3: 委托至 StepRenderController（行为逐行等价）
        this.stepRenderController.renderStepNav(workspace);
    }

    // ============================================================
    // 中间提示词工作区
    // ============================================================
    private async renderPromptArea(workspace: HTMLElement): Promise<void> {
        const area = workspace.createDiv({ cls: 'novel-writer-fw-prompt-area' });

        // 当前步骤信息
        const currentStep = findStepByIndex(this.currentStepIndex);
        if (!currentStep) {
            area.createEl('p', { text: '未知步骤', cls: 'novel-writer-fw-error-text' });
            return;
        }
        const stepKey = currentStep.key;

        if (!stepKey) {
            // 自动步骤
            this.renderAutoStep(area, currentStep);
            return;
        }

        const templateService = this.plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);
        const customTemplate = await templateService.getStepPrompt(stepKey);
        const template = customTemplate || getStepTemplate(stepKey);
        if (!template) {
            area.createEl('h3', { text: currentStep.label });
            area.createEl('p', { text: '未知步骤', cls: 'novel-writer-fw-error-text' });
            return;
        }

        // 检查前置步骤是否完成，未完成则显示提醒
        if (currentStep && currentStep.index >= 2 && currentStep.index <= 9) {
            // V2: 找到当前步骤在数组中的位置，取前一个
            const stepPos = ALL_FULL_STEPS.findIndex(s => s.index === currentStep.index);
            const prevStep = stepPos > 0 ? ALL_FULL_STEPS[stepPos - 1] : undefined;
            const prevStepKey = prevStep?.key || (prevStep?.index === 0 ? 'context' : 'settlement');
            if (!this.stepCompleted.has(prevStepKey)) {
                const warning = area.createDiv({ cls: 'novel-writer-fw-warning' });
                warning.createSpan({ text: `⚠️ 建议先完成「${prevStep?.label ?? '前置'}」步骤，再执行当前步骤以确保数据连贯性。` });
            }
        }

        const vars = await this.buildTemplateVars();
        this.vars = vars;

        // 步骤描述
        const header = area.createDiv({ cls: 'novel-writer-fw-step-header' });
        const headerTitle = header.createEl('h3');
        headerTitle.createSpan({ text: currentStep.label });
        if (currentStep.deprecated) {
            headerTitle.createSpan({ text: ' 〔旧〕', attr: { style: 'color:var(--text-muted); font-size:0.7em; font-weight:400;' } });
        }
        header.createEl('p', { text: template.description, cls: 'novel-writer-fw-step-desc' });

        if (stepKey === 'infoPlan') {
            this.renderPlanningQuickStart(area);
        }

        if (stepKey === 'qualityControl' || stepKey === 'analysisReport') {
            this.renderReviewPhaseTabs(area, stepKey);
        }

        // 系统提示词
        const sysSection = area.createDiv({ cls: 'novel-writer-fw-prompt-section' });
        sysSection.createEl('label', { text: '系统提示词', cls: 'novel-writer-fw-label' });
        this.systemPromptEl = sysSection.createEl('textarea', {
            cls: 'nw-textarea novel-writer-fw-textarea',
            attr: { rows: '12' }
        }) as HTMLTextAreaElement;
        // 对系统提示词也做变量替换
        this.systemPromptEl.value = fillTemplate(template.systemPrompt, vars);

        // 用户提示词
        const userSection = area.createDiv({ cls: 'novel-writer-fw-prompt-section' });
        userSection.createEl('label', { text: '用户提示词', cls: 'novel-writer-fw-label' });
        this.userPromptEl = userSection.createEl('textarea', {
            cls: 'nw-textarea novel-writer-fw-textarea',
            attr: { rows: '15' }
        }) as HTMLTextAreaElement;
        this.userPromptEl.value = fillTemplate(template.userPrompt, vars);

        if (stepKey === 'bodyGeneration') {
            const cowriteCard = area.createDiv({ cls: 'novel-writer-fw-cowrite-entry' });
            const cowriteHeader = cowriteCard.createDiv({ cls: 'novel-writer-fw-cowrite-entry-header' });
            cowriteHeader.createEl('h4', { text: '✨ 推荐方式：句级协同写作', cls: 'novel-writer-fw-cowrite-entry-title' });
            cowriteHeader.createEl('span', { text: '当前主流', cls: 'novel-writer-fw-cowrite-entry-badge' });
            
            const cowriteDesc = cowriteCard.createDiv({ cls: 'novel-writer-fw-cowrite-entry-desc' });
            cowriteDesc.createEl('p', { text: '正文生成阶段建议使用句级协同写作工作台：AI 逐句生成 3 条不同方向的候选，你可以选择接受、编辑或重新生成，完全掌握创作主导权。' });
            
            const cowriteFeatures = cowriteCard.createDiv({ cls: 'novel-writer-fw-cowrite-entry-features' });
            const features = [
                '🎯 逐句精控：每句话都可以选择和调整',
                '🔄 多向候选：3 条不同方向，拓宽创作思路',
                '🛡️ 降低 AI 痕迹：人工参与度高，反检测效果更好',
                '📊 数据兼容：与旧模式共享同一正文文件，可随时切换',
            ];
            features.forEach(f => {
                cowriteFeatures.createEl('div', { text: f, cls: 'novel-writer-fw-cowrite-entry-feature' });
            });
            
            const cowriteBtnRow = cowriteCard.createDiv({ cls: 'novel-writer-fw-cowrite-entry-btn-row' });
            const cowriteBtn = cowriteBtnRow.createEl('button', {
                text: '🚀 进入句级协同写作',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary novel-writer-fw-cowrite-entry-btn'
            });
            cowriteBtn.addEventListener('click', () => this.openCurrentChapterInCoWriting());
            
            const cowriteNote = cowriteCard.createEl('p', { 
                text: '💡 提示：本页下方的「AI 自动生成」为 v5.0 之前的旧模式，仅作兼容保留。', 
                cls: 'novel-writer-fw-cowrite-entry-note' 
            });
        }

        // Temperature 滑块
        const tempRow = area.createDiv({ cls: 'novel-writer-fw-temp-row' });
        tempRow.createSpan({ text: 'Temperature:', cls: 'novel-writer-fw-temp-label' });
        this.temperatureSlider = tempRow.createEl('input', {
            type: 'range',
            cls: 'novel-writer-fw-temp-slider',
            attr: { min: '0.1', max: '2.0', step: '0.1', value: '1.4' }
        }) as HTMLInputElement;
        this.temperatureValueEl = tempRow.createSpan({ text: '1.4', cls: 'novel-writer-fw-temp-value' });
        this.temperatureSlider.oninput = () => {
            this.temperatureValueEl.setText(String(parseFloat(this.temperatureSlider.value).toFixed(1)));
        };

        // 按钮行
        const btnRow = area.createDiv({ cls: 'novel-writer-fw-btn-row' });

        if (currentStep.canSkip) {
            const skipBtn = btnRow.createEl('button', {
                text: '⏭️ 跳过',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            skipBtn.onclick = () => this.stepRunner.moveToNextStep(this._makeStepRunCtx());
        }

        // bodyGeneration: AI 自动生成按钮标注为次选
        const sendBtnText = stepKey === 'bodyGeneration' ? '🤖 AI 自动生成（旧）' : '🚀 发送 AI 请求';
        const sendBtnCls = stepKey === 'bodyGeneration' ? 'novel-writer-fw-btn novel-writer-fw-btn-secondary' : 'novel-writer-fw-btn novel-writer-fw-btn-primary';
        const sendBtn = btnRow.createEl('button', {
            text: sendBtnText,
            cls: sendBtnCls
        });
        sendBtn.onclick = () => this.stepRunner.executeCurrentStep(this._makeStepRunCtx());

        // AI 结果区
        this.renderResultArea(area, stepKey);

        // v6.0: outline 步骤额外显示分卷大纲树状预览（辅助视图，不替代结果编辑器）
        // 已禁用：写作工作台（单章）的 outline 步骤不应显示全书分卷大纲树，那是全书规划向导的功能
        // if (stepKey === 'outline' && this.stepCompleted.has('outline') && this.project) {
        //     const previewSection = area.createDiv({ cls: 'novel-writer-fw-result-section' });
        //     previewSection.createEl('h4', { text: '📚 分卷大纲预览', cls: 'novel-writer-fw-result-title' });
        //     await this.outlineTreeController.render(previewSection);
        // }

        // 步骤4完成后：显示消痕和迭代按钮
        if (stepKey === 'bodyGeneration' && this.stepCompleted.has('bodyGeneration')) {
            const deaiBtnRow = area.createDiv({ cls: 'novel-writer-fw-btn-row' });
            
            const deaiBtn = deaiBtnRow.createEl('button', {
                text: '🧹 AI 消痕改写',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            deaiBtn.onclick = () => this.stepRunner.executeDeaiRewrite(
                this.stepResults,
                (c) => this.renderInContainer(c),
                this.tabContent,
                (v) => { this.isLoading = v; },
                this.chapDir,
                this.chapterName,
                this.volume,
                this.stepCompleted,
            );

            const refineBtn = deaiBtnRow.createEl('button', {
                text: '🔁 自动迭代精修',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            refineBtn.onclick = () => this.stepRunner.executeIterativeRefine(
                this.stepResults,
                this.vars,
                this.chapterNum,
                () => this.buildTemplateVars(),
                (c) => this.renderInContainer(c),
                this.tabContent,
                (v) => { this.isLoading = v; },
                undefined,
                undefined,
                undefined,
                this.stepCompleted,
            );
        }

        // 如果该步骤已执行过，显示「继续下一步」按钮
        if (this.stepCompleted.has(stepKey) && stepKey !== 'context' && stepKey !== 'settlement') {
            const nextBtnRow = area.createDiv({ cls: 'novel-writer-fw-btn-row' });
            const nextBtn = nextBtnRow.createEl('button', {
                text: '▶️ 继续下一步',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-success'
            });
            nextBtn.onclick = () => this.stepRunner.moveToNextStep(this._makeStepRunCtx());
        }
    }

    private renderAutoStep(area: HTMLElement, step: FullStep): void {
        // D3: 委托至 StepRenderController（行为逐行等价）
        this.stepRenderController.renderAutoStep(area, step);
    }


    // v3.4.9 委托: renderPolishEditor → PolishEditor 模块
    private async renderPolishEditor(area: HTMLElement): Promise<void> {
        await this.polishEditor.render(area, this.stepResults, this.project, this.chapDir, this.chapterName, this.volume);
    }

    private renderResultArea(area: HTMLElement, stepKey: string): void {
        // D3: 委托至 StepRenderController（行为逐行等价）
        this.stepRenderController.renderResultArea(area, stepKey);
    }

    private renderStatusBar(container: HTMLElement): void {
        this.statusBarController.renderStatusBar(container);
    }

    // ============================================================
    // 从世界观生成设定库
    // ============================================================
    async populateSettingLib(): Promise<void> {
        return this.settingLibController.populateSettingLib();
    }

    // ============================================================
    // AI 消痕改写
    // ============================================================

    // ============================================================


    // ============================================================
    private estimateTotalChars(): number {
        return calcTotalChars(this.context, this.stepResults, this.systemPromptEl, this.userPromptEl);
    }

    /**
     * ✅ P0修复#2：同步当前章节的涉及实体集到 plugin 实例
     * 上下文面板 (context-panel.ts) 读取这些集来过滤显示
     */
    private syncInvolvedEntitiesToPlugin(): void {
        this.entityStateController.syncInvolvedEntitiesToPlugin();
    }

    private async detectAndUpdateEntityStates(bodyContent: string): Promise<void> {
        await this.entityStateController.detectAndUpdateEntityStates(bodyContent);
    }

    public refreshContextBar(): void {
        this.entityStateController.refreshContextBar();
    }

    private renderReviewPhaseTabs(area: HTMLElement, activeStep: string): void {
        const tabs = [
            { key: 'qualityControl', label: '质量控制', index: 8 },
            { key: 'analysisReport', label: '分析报告', index: 9 },
        ];

        const tabBar = area.createDiv({ cls: 'novel-writer-fw-review-tabs' });
        for (const tab of tabs) {
            const tabEl = tabBar.createDiv({
                cls: 'novel-writer-fw-review-tab' + (activeStep === tab.key ? ' is-active' : ''),
                text: tab.label,
            });
            if (activeStep !== tab.key && this.stepCompleted.has('context')) {
                tabEl.addClass('is-clickable');
                tabEl.addEventListener('click', () => {
                    this.currentStepIndex = tab.index;
                    this.renderInContainer(this.tabContent);
                });
            }
        }
    }
    private renderPlanningQuickStart(area: HTMLElement): void {
        const planningSteps = [
            { key: 'infoPlan', label: '信息规划' },
            { key: 'plotDistill', label: '情节蒸馏' },
            { key: 'outline', label: '大纲摘要' },
            { key: 'emotionPlan', label: '情绪规划' },
            { key: 'sceneExpand', label: 'Scene展开' },
        ];

        const card = area.createDiv({ cls: 'novel-writer-fw-planning-quickstart' });

        const header = card.createDiv({ cls: 'novel-writer-fw-planning-header' });
        header.createEl('h4', { text: '🚀 一键生成全章规划', cls: 'novel-writer-fw-planning-title' });

        const statusList = card.createDiv({ cls: 'novel-writer-fw-planning-status-list' });
        for (const step of planningSteps) {
            const item = statusList.createDiv({ cls: 'novel-writer-fw-planning-status-item' });
            const isDone = this.stepCompleted.has(step.key);
            const icon = item.createSpan({ cls: 'novel-writer-fw-planning-status-icon' });
            icon.setText(isDone ? '✅' : '○');
            if (isDone) item.addClass('is-done');
            item.createSpan({ text: step.label, cls: 'novel-writer-fw-planning-status-label' });
        }

        const btnRow = card.createDiv({ cls: 'novel-writer-fw-planning-btn-row' });
        const generateBtn = btnRow.createEl('button', {
            text: '⚡ 一键生成全部',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary',
        });

        const doneCount = planningSteps.filter(s => this.stepCompleted.has(s.key)).length;
        if (doneCount > 0 && doneCount < planningSteps.length) {
            generateBtn.setText('⚡ 继续生成剩余');
        } else if (doneCount === planningSteps.length) {
            generateBtn.setText('🔄 重新生成全部');
        } else {
            generateBtn.setText('⚡ 一键生成全章规划（更快）');
        }

        generateBtn.addEventListener('click', async () => {
            if (this.isLoading) return;

            const doneCount = planningSteps.filter(s => this.stepCompleted.has(s.key)).length;
            const allDone = doneCount === planningSteps.length;
            const noneDone = doneCount === 0;

            generateBtn.disabled = true;
            generateBtn.setText('⏳ 生成中...');

            try {
                if (noneDone || allDone) {
                    await this.stepRunner.executePlanningCombined(this._makeStepRunCtx());
                } else {
                    const remaining = planningSteps.filter(s => !this.stepCompleted.has(s.key));
                    const stepKeys = remaining.map(s => s.key);
                    await this.stepRunner.executeStepsSequential(
                        stepKeys,
                        this._makeStepRunCtx(),
                        {
                            onStepStart: () => { this.renderInContainer(this.tabContent); },
                            onStepComplete: () => { this.renderInContainer(this.tabContent); },
                            onStepError: () => { this.renderInContainer(this.tabContent); },
                        }
                    );
                }
            } catch (e) {
                console.error('[Planning] 一键生成失败:', e);
            } finally {
                this.renderInContainer(this.tabContent);
            }
        });
    }

    // ============================================================
    // ✅ v1.6.0 干预文本框（委托给 InterventionController）
    // ============================================================
    private renderInterventionBox(container: HTMLElement): void {
        this.interventionController.render(container);
    }

    /**
     * AI 理解干预意见
     */
    private async onInterventionUnderstand(): Promise<void> {
        // 已迁移至 InterventionController，保留空实现防止引用错误
    }

    /**
     * 调用 AI 理解 API
     */
    private async callInterventionUnderstandingAPI(userInput: string): Promise<any> {
        // 已迁移至 InterventionController，保留空实现防止引用错误
        return null;
    }

    /**
     * 渲染理解报告
     */
    private renderUnderstandingReport(report: any): void {
        // 已迁移至 InterventionController，保留空实现防止引用错误
    }

    /**
     * 执行干预
     */
    private async executeIntervention(): Promise<void> {
        // 已迁移至 InterventionController，保留空实现防止引用错误
    }

    /**
     * 获取当前步骤的 key
     */
    private getCurrentStepKey(): string {
        const step = ALL_FULL_STEPS[this.chapterStateManager.currentStepIndex];
        return step?.key || '';
    }

    /**
     * 语音输入
     */
    private startVoiceInput(): void {
        // 已迁移至 InterventionController，保留空实现防止引用错误
    }

    // ============================================================
    // 模态框样式注入
    // ============================================================


    // v3.4.8: CSS 由 Obsidian 自动加载 styles.css + 运行时注入兜底
    // adapter.read 无法访问 .obsidian 隐藏目录，故直接嵌入关键 CSS
    // ============================================================
    // 向导步骤状态恢复 — 实时检测文件完整性（P0 修复）
    // ============================================================
    // v3.4.9: 向导步骤检测 → WizardChecker 模块委托
    // ============================================================

    private async restoreWizardStepStatus(tab: WizardTab, skipAutoAdvance = false): Promise<void> {
        return this.wizardChecker.restoreWizardStepStatus(tab, skipAutoAdvance);
    }

    async checkWorldviewComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkWorldviewComplete(project);
    }

    private async autoFillWorldviewNames(project: string, file: TFile, content: string): Promise<void> {
        return this.wizardChecker.autoFillWorldviewNames(project, file, content);
    }

    private async renameProjectFolder(oldPath: string, newName: string): Promise<void> {
        return this.wizardChecker.renameProjectFolder(oldPath, newName);
    }

    async checkSettingLibComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkSettingLibComplete(project);
    }

    async checkWritingStyleComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkWritingStyleComplete(project);
    }

    async checkEntitiesComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkEntitiesComplete(project);
    }

    async checkOutlineComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkOutlineComplete(project);
    }

    private async checkChaptersComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkChaptersComplete(project);
    }

}
