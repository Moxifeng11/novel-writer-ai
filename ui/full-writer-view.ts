import { SidebarComponent } from './sidebar-component';
import { App, ItemView, WorkspaceLeaf, TFile, TFolder, Modal, Notice } from 'obsidian';
import { EntityOverviewModal } from './full-writer/entity-overview-modal';
import { ToolsModal } from './full-writer/tools-modal';
import { WizardTab, WizardStep, buildWizardSteps as buildWizardStepsExternal } from './full-writer/wizard-types';
import { createPersistentWizardResults } from './full-writer/wizard-results-store';
import { buildTemplateVars as buildTemplateVarsExternal } from './full-writer/template-vars-builder';
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
import { getStepTemplate, fillTemplate, WRITING_RULES } from '../engine/prompt-templates';
import { TemplateService } from '../services/template-service';
import { getForeshadowWarnings } from '../engine/foreshadow-manager';
import { filterForeshadowsByChapter, getInvolvedEntities, getEntityStatusLine } from '../engine/chapter-context-builder';
import { scoreAndFilterEntities, ScoredEntity } from '../engine/entity-scorer';
import { buildCharacterSoulSummary, getProtagonistSoulDetail } from '../engine/character-soul';  // V2 P0-1
import { getChapterFile, getChapterFileName, findBodyFileV4 } from '../engine/chapter-utils';
import { MiniSettingsModal } from './mini-settings-modal';
import { EntityStateManager } from '../engine/entity-state-manager';
import { SettlementEngine } from '../engine/settlement-engine';
import { ChapterStateManager } from './states/chapter-state-manager';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { StepRunner, ALL_FULL_STEPS, FullStep, StepRunCtx } from '../engine/step-runner';

/** V2: 通过 logicalIndex 查找步骤（非数组下标） */
function findStepByIndex(logicalIndex: number): FullStep | undefined {
    return ALL_FULL_STEPS.find(s => s.index === logicalIndex);
}
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

export const VIEW_TYPE = 'novel-writer-full-writer';

export class FullWriterView extends ItemView {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;

    // === 状态 ===
    private context: GatheredContext | null = null;
    private project = '';
    private chapterName = '';
    private chapterNum = 0;
    private volume = '';
    private chapDir = '';
    private vars: Record<string, string> = {};
    private isLoading = false;

    // === 子模块 ===
    private chapterStateManager: ChapterStateManager;
    private stepRunner: StepRunner;
    private contextPanel: ContextPanel;
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

    // === DOM 引用（由 renderContent 维护）===
    private mainContainer: HTMLElement | null = null;
    private workspace: HTMLElement | null = null;

    // === 干预面板 DOM 引用（由 renderInterventionBox 维护）===
    private interventionContainer!: HTMLElement;
    private interventionInput!: HTMLTextAreaElement;
    private interventionReportEl!: HTMLElement;
    private currentReport: any = null;

    // 便捷访问器（代理到 ChapterStateManager）
    private get stepCompleted(): Set<string> { return this.chapterStateManager.stepCompleted; }
    private get stepResults(): Record<string, string> { return this.chapterStateManager.stepResults; }
    private get currentStepIndex(): number { return this.chapterStateManager.currentStepIndex; }
    private set currentStepIndex(v: number) { this.chapterStateManager.currentStepIndex = v; }

    // === Tab 系统 ===
    tabs: Array<{ id: string; label: string; type: 'selector' | 'chapter' | 'wizard'; chapterKey?: string; project?: string; chapterName?: string; volume?: string; chapDir?: string; chapterNum?: number; file?: TFile; projectType?: 'original' | 'fanfic'; currentStepIdx?: number; steps?: WizardStep[] }> = [];  // wizard-controller 需要访问
    private activeTabId = '';
    private tabBar!: HTMLDivElement;
    tabContent!: HTMLDivElement;  // wizard-controller 需要访问
    private navStack: string[] = [];

    // === 向导状态 ===
    // v3.4.6 localStorage 持久化（防止重启丢失上次执行结果）
    private wizardStepResults: Record<string, string> = createPersistentWizardResults(() => this.project);
    wizardStepExecuting: Set<string> = new Set();  // wizard-controller 需要访问

    // === DOM 缓存 ===
    private systemPromptEl!: HTMLTextAreaElement;
    private userPromptEl!: HTMLTextAreaElement;
    private temperatureSlider!: HTMLInputElement;
    private temperatureValueEl!: HTMLSpanElement;
    private chapterSelectEl!: HTMLSelectElement;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.settlementEngine = new SettlementEngine(this.app);
        this.chapterStateManager = new ChapterStateManager(this.app);
        this.stepRunner = new StepRunner(this.app, plugin);
        this.contextPanel = new ContextPanel(this.app);
        this.polishEditor = new PolishEditor(this.stepRunner);
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
            cls: 'novel-writer-fw-tabs-container',
            attr: { style: 'display: flex; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding: 0 8px 0 4px; background: var(--background-secondary); min-height: 36px; flex-shrink: 0;' }
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
                console.error('[FullWriter] onOpen error:', errMsg);
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
                console.error('[FullWriter] onOpen 加载失败:', errMsg);
                new Notice('⚠️ 项目加载失败，请检查项目文件是否完整', 5000);
            }
        }

        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (file) this.handleFileChange(file);
        }));

        // 监听项目创建事件（Obsidian Workspace 内置事件系统）
        this.registerEvent(
            this.app.workspace.on('novel-writer:project-created', (data: { projectName: string; projectType: 'original' | 'fanfic' }) => {
                console.warn('[FullWriter] project-created 事件触发:', data.projectName, data.projectType);
                // v3.4.8: 直接推入向导 Tab。defer 到下一帧避免与 Modal.close() 竞态
                const steps = this.buildWizardSteps(data.projectType);
                const wizardId = `wizard-${Date.now()}`;
                this.tabs.push({
                    id: wizardId,
                    label: '🧙 项目向导',
                    type: 'wizard',
                    project: data.projectName,
                    projectType: data.projectType,
                    currentStepIdx: 0,
                    steps,
                });
                // v3.4.8: setTimeout 确保 Modal.close() 完成后再渲染向导
                setTimeout(() => {
                    try {
                        console.warn('[FullWriter] pushNav 向导:', wizardId, 'tabs:', this.tabs.map(t => t.id));
                        this.pushNav(wizardId);
                    } catch (e: unknown) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        console.error('[FullWriter] 向导 pushNav 失败:', errMsg);
                    }
                }, 0);
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
    // Tab 系统
    // ============================================================
    async pushNav(tabId: string): Promise<void> {
        this.navStack.push(this.activeTabId);
        await this.activateTab(tabId);
    }

    popNav(): void {
        const prevTabId = this.navStack.pop();
        if (prevTabId) {
            this.activateTab(prevTabId);
        } else {
            this.activateTab('project-selector');
        }
    }

    private renderTabBar(): void {
        this.tabBar.empty();

        // 导航返回按钮（仅在有导航历史时显示）
        if (this.navStack.length > 0) {
            const backBtn = this.tabBar.createEl('button', {
                text: '← 返回',
                attr: {
                    title: '返回上一页',
                    style: 'border: none; background: transparent; cursor: pointer; padding: 4px 8px; margin-right: 4px; font-size: 0.85em; color: var(--text-accent); border-radius: 4px;'
                }
            });
            backBtn.addEventListener('mouseenter', () => { backBtn.style.background = 'var(--background-modifier-hover)'; });
            backBtn.addEventListener('mouseleave', () => { backBtn.style.background = 'transparent'; });
            backBtn.addEventListener('click', () => { this.popNav(); });
        }

        for (const tab of this.tabs) {
            const isSelector = tab.type === 'selector';
            const tabEl = this.tabBar.createDiv({
                cls: 'novel-writer-fw-tab',
                attr: {
                    style: `display: flex; align-items: center; padding: 6px 12px; margin-right: 2px; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 0.85em; ${tab.id === this.activeTabId ? 'background: var(--background-primary); font-weight: 600;' : 'color: var(--text-muted);'}; user-select: none; flex-shrink: 0; white-space: nowrap;${isSelector && tab.id !== this.activeTabId ? ' border: 1px dashed var(--background-modifier-border); border-bottom: none; opacity: 0.7;' : ''}`
                }
            });
            tabEl.createSpan({ text: tab.label });

            // 关闭按钮（项目选择 Tab 不显示）
            if (tab.type !== 'selector') {
                const closeBtn = tabEl.createSpan({
                    text: ' ×',
                    attr: { style: 'margin-left: 8px; font-size: 1.1em; opacity: 0.5;' }
                });
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(tab.id);
                });
                closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
                closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.5'; });
            }

            tabEl.addEventListener('click', () => {
                this.activateTab(tab.id);
            });
        }

        // 弹性填充
        const spacer = this.tabBar.createDiv({ attr: { style: 'flex: 1;' } });

        // 「+」按钮
        const addBtn = this.tabBar.createEl('button', {
            text: '+',
            attr: {
                title: '切换至项目选择页面',
                style: 'width: 28px; height: 28px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: transparent; cursor: pointer; font-size: 1.2em; line-height: 1; display: flex; align-items: center; justify-content: center; flex-shrink: 0;'
            }
        });
        addBtn.addEventListener('click', () => {
            this.activateTab('project-selector');
        });

        // 「⚙️ 设置」按钮 — 打开工作台设置
        const settingsBtn = this.tabBar.createEl('button', {
            text: '⚙️',
            attr: {
                title: '工作台设置（模型选择、上下文范围、热重载等）',
                style: 'width: 28px; height: 28px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: transparent; cursor: pointer; font-size: 0.9em; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-left: 4px;'
            }
        });
        settingsBtn.addEventListener('click', () => {
            new MiniSettingsModal(this.app, this.plugin).open();
        });

        // 「🔄 热重载」按钮 — 与 MiniSettingsModal 一致的正确热重载机制
        const reloadBtn = this.tabBar.createEl('button', {
            text: '🔄',
            attr: {
                title: '热重载插件（按最新文件重新加载 UI 和后端）',
                style: 'width: 28px; height: 28px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: transparent; cursor: pointer; font-size: 0.9em; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-left: 4px;'
            }
        });
        reloadBtn.addEventListener('click', async () => {
            // 在 disable 前保存状态（disablePlugin 会销毁当前实例，必须同步保存）
            this.plugin._pendingReloadState = {
                project: this.project || '',
                chapterFileName: this.chapterName || '',
                volume: this.volume || '',
                chapDir: this.chapDir || ''
            };
            
            // disablePlugin 必须同步调用（不 await），因为调用后会销毁当前插件实例
            this.app.plugins.disablePlugin('novel-writer-ai');
            // enablePlugin 用 await 等待加载完成后恢复工作台
            await this.app.plugins.enablePlugin('novel-writer-ai');
        });
    }

    private async activateTab(tabId: string): Promise<void> {
        // 关闭已打开的大纲树 Modal，避免遮挡切换后的步骤 UI
        this.closeOutlineTreeModal();
        if (this.activeTabId === tabId) return;
        this.activeTabId = tabId;
        this.renderTabBar();
        await this.renderTabContent();
    }

    closeOutlineTreeModal(): void {
        if (this.outlineTreeModal) {
            this.outlineTreeModal.close();
            this.outlineTreeModal = null;
        }
    }

    closeTab(tabId: string): void {
        // Wizard Tab 关闭确认
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab && tab.type === 'wizard') {
            const wizardTab = tab as WizardTab;
            // v3.4.6: complete 步骤是终点页（不需要执行），不参与"是否全部完成"判断
            const allDone = wizardTab.steps
                .filter(s => s.id !== 'complete')
                .every(s => s.status === 'done' || s.status === 'skipped');
            if (!allDone) {
                new Notice('⚠️ 项目已创建但未完成初始化，可在项目选择中手动完成各步骤', 5000);
            }
        }

        const idx = this.tabs.findIndex(t => t.id === tabId);
        if (idx < 0) return;
        this.tabs.splice(idx, 1);

        if (this.activeTabId === tabId) {
            // 切换到左侧相邻 Tab，如果没有则到项目选择
            const targetIdx = Math.min(idx, this.tabs.length - 1);
            this.activeTabId = this.tabs[targetIdx]?.id || 'project-selector';
            this.renderTabBar();
            this.renderTabContent();
        } else {
            this.renderTabBar();
        }
    }

    /**
     * v3.4.7: 根据已完成步骤计算恢复索引 — 跳到第一个未完成的业务步骤
     * 规则：
     *  - context (index 0) 始终完成 → 从 index 1 开始检查
     *  - 遍历 ALL_FULL_STEPS[1..13]，找到第一个 stepCompleted 中没有的步骤 key
     *  - 全部完成 → 回到正文生成(index 7)供用户查看已完稿正文
     *  - settlement(index 14) 是自动步骤，不计入
     *  - P2-5：重排后 bodyGeneration 由 4 → 7
     */
    private _calcResumeStepIndex(): number {
        for (const step of ALL_FULL_STEPS) {
            if (step.index === 0 || step.auto) continue; // 跳过自动步骤（上下文/结算）
            const sk = step.key;
            if (sk && !this.stepCompleted.has(sk)) {
                console.warn('[小说工坊] _calcResumeStepIndex: 第一个未完成 =', step.label, 'stepCompleted=', [...this.stepCompleted]);
                return step.index;
            }
        }
        // 全部步骤完成 → 跳到正文生成步骤查看
        return 7;
    }

    private async renderTabContent(): Promise<void> {
        this.tabContent.empty();

        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        if (!activeTab) return;

        if (activeTab.type === 'selector') {
            await this.renderProjectSelectorInTab();
        } else if (activeTab.type === 'wizard' && activeTab.project) {
            this.project = activeTab.project;
            this.chapterName = '';
            this.chapDir = '';
            this.volume = '';
            this.chapterNum = 0;
            this.context = null;
            this.chapterStateManager.stepCompleted.clear();
            this.chapterStateManager.stepResults = {};
            await this.renderWizardTabContent(activeTab as WizardTab);
            return;
        } else if (activeTab.type === 'chapter' && activeTab.project && activeTab.chapterName) {
            // 恢复该 Tab 对应的项目/章节状态
            this.project = activeTab.project;
            this.chapterName = activeTab.chapterName;
            this.volume = activeTab.volume || '';
            this.chapDir = activeTab.chapDir || '';
            // v4.0: chapDir 为空的容错重建（热重载/tab切换异常时）
            // 注意：v4.0 起 chapDir = 步骤结果目录（步骤结果/第X卷/第X章），正文文件已分离至 正文/ 子目录
            if (!this.chapDir && this.project && this.chapterName && this.volume) {
                const volMatchNum = this.volume.match(/第(\d+)卷/);
                const chapMatchNum = this.chapterName.match(/第(\d+)章/);
                const volN = volMatchNum ? parseInt(volMatchNum[1], 10) : 1;
                const chapN = chapMatchNum ? parseInt(chapMatchNum[1], 10) : (activeTab.chapterNum || 1);
                this.chapDir = pjStepDir(this.project, volN, chapN);
                activeTab.chapDir = this.chapDir;
                console.warn('[小说工坊] chapDir 为空，从上下文重建 (v4.0 步骤结果路径):', this.chapDir);
            }
            console.warn('[小说工坊] renderTabContent: chapDir=', this.chapDir, 'project=', this.project, 'volume=', this.volume, 'chapterName=', this.chapterName);
            this.chapterNum = activeTab.chapterNum || 0;
            
            this.currentStepIndex = 0;
            this.context = null;
            this.chapterStateManager.stepCompleted.clear();
            // v3.4.7: 切章节时清空 stepResults，防止旧章节数据泄漏（restoreChapterState 从磁盘恢复当前章节）
            this.chapterStateManager.stepResults = {};
            
            await this.loadContext();
            await this.chapterStateManager.restoreChapterState(this.chapDir);
            // v3.4.7: 根据已完成步骤自动跳到第一个未完成步骤，而非永远从步骤1开始
            this.currentStepIndex = this._calcResumeStepIndex();
            await this.renderInContainer(this.tabContent);
        }
    }

    private async openCurrentChapterInCoWriting(): Promise<void> {
        if (!this.project || !this.chapterName || !this.chapterNum) {
            new Notice('请先选择具体章节，再进入句级协同写作。');
            return;
        }
        await this.plugin.activateCoWritingView(this.project, this.chapterName, this.volume || '第1卷', this.chapterNum);
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
            setIsLoading: (v) => { this.isLoading = v; },
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

        const path = activeFile.path;

        // 提取项目名（第一级目录）
        this.project = path.split('/')[0] || '';

        // 提取卷名（v4.0：卷目录已下沉至 正文/第N卷 与 步骤结果/第N卷）
        const volMatch = path.match(/03-大纲与章节\/(?:正文\/|步骤结果\/)?(第\d+卷)/);
        this.volume = volMatch ? volMatch[1] : '';

        // 提取章节号和章节目录
        const chapMatch = path.match(/(第\d+章)/);
        this.chapterName = chapMatch ? chapMatch[1] : '';
        this.chapterNum = this.chapterName ? parseInt(this.chapterName.match(/\d+/)![0]) : 0;

        // 计算章节目录（v4.0：chapDir 统一指向 步骤结果/第N卷/第N章）
        // 不能再用活动文件父目录——正文文件父目录是 正文/第N卷，并非步骤结果目录。
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
    private async onProjectChange(): Promise<void> {
        // 复用插件级 ContextManager（项目切换由 ContextManager 内部按 project 参数处理）
        this.contextManager = this.plugin.ctxManager;
        this.chapterName = '';
        this.chapterNum = 0;
        this.volume = '';
        this.chapDir = '';
        this.chapterStateManager.reset();
        this.context = null;
        this.vars = {};
        // 显示项目+章节选择列表
        await this.activateTab('project-selector');
    }

    /**
     * 快速切换项目：仅切换项目上下文，保持在工作台视图（不跳转章节选择页）
     */
    private async switchProjectQuick(): Promise<void> {
        this.contextManager = this.plugin.ctxManager;
        this.chapterName = '';
        this.chapterNum = 0;
        this.volume = '';
        this.chapDir = '';
        this.chapterStateManager.reset();
        this.context = null;
        this.vars = {};
        await this.activateTab('project-selector');
    }

    // ============================================================
    // 上下文加载（步骤0）
    // ============================================================
    private async loadContext(): Promise<void> {
        if (!this.project) {
            this.activateTab('project-selector');
            return;
        }

        showProgress('⏳ 加载上下文数据...');

        try {
            showProgress('⏳ 加载上下文数据...');
            this.context = await this.contextManager.gatherAll(this.project, this.chapterName);

            const failedModules = this.context?.data?.['_failedModules'] as string[] || [];
            if (failedModules.length > 0) {
                new Notice(`⚠️ 以下模块加载失败（已跳过）: ${failedModules.join('、')}`, 6000);
            }

            // v6.0: context 是特殊步骤，加载成功即标记为 complete
            this.chapterStateManager.stepLevels['context'] = 'complete';
            this.chapterStateManager.stepMissing['context'] = [];
            this.stepCompleted.add('context');
            hideProgress();
            showSuccess('上下文加载完成');

            // 生成信息摘要
            const infoSummary = this.contextManager.getInfoSummary(this.context);
            this.vars['infoSummary'] = infoSummary;

            // 检测上下文是否被截断
            if (this.context?.data?.compressed?.truncationApplied) {
                this.vars['contextTruncated'] = 'true';
            } else {
                this.vars['contextTruncated'] = 'false';
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[小说工坊] 上下文加载异常:', errMsg);
            hideProgress();
            // ✅ v1.6.0: 不 return，而是用已加载的部分数据（如果有的话）
            if (!this.context) {
                showError(`上下文加载失败: ${errMsg}`);
                return;
            } else {
                new Notice(`⚠️ 上下文部分加载失败: ${errMsg}`, 6000);
            }
        }

        // v1.4.1: 跨卷状态快照 — 检测新卷首章, 自动生成/注入快照
        await this.ensureCrossVolumeSnapshot();

        // 自动跳到步骤1（render 由调用方负责）
        this.currentStepIndex = 1;

        // ✅ P0修复#2+3：上下文加载后同步涉及实体集到 plugin
        this.syncInvolvedEntitiesToPlugin();
    }

    // v1.4.1: 跨卷状态快照 — 检测新卷首章, 自动生成/注入快照
    private async ensureCrossVolumeSnapshot(): Promise<void> {
        if (!this.chapterNum) return;
        const integrator = new CrossVolumeIntegrator(this.app);
        const isNewVol = await integrator.isNewVolumeFirstChapter(this.project, this.chapterNum);
        if (isNewVol) {
            const volName = this.volume || `第${Math.ceil(this.chapterNum / 10)}卷`;
            const snapshot = await integrator.generateSnapshot(this.project, volName, `${this.project}/04-项目总控`);
            this.vars['crossVolumeSnapshot'] = snapshot.slice(0, 3000);
            new Notice(`📸 已为「${volName}」生成状态快照`, 4000);
        }
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
        const chapKey = `${project}/${chapter.chapter}`;
        
        // 已有 Tab → 直接激活
        const existingTab = this.tabs.find(t => t.chapterKey === chapKey);
        if (existingTab) {
            this.activateTab(existingTab.id);
            return;
        }

        const chapterNum = parseInt(chapter.chapter.match(/\d+/)?.[0] || '0');
        // v4.0: chapDir = 步骤结果目录（步骤结果/第X卷/第Y章），正文文件已分离至 正文/ 子目录。
        // 旧实现用 `03-大纲与章节/{卷}/{章}` 正则反推，在新结构下永不命中 → chapDir 恒空。
        const selVolN = parseInt(chapter.volume.match(/第(\d+)卷/)?.[1] || '1', 10);
        const chapDir = (chapter.volume && chapterNum > 0) ? pjStepDir(project, selVolN, chapterNum) : '';

        const newTab = {
            id: `chapter-${Date.now()}`,
            label: `✍️ ${chapter.chapter}`,
            type: 'chapter' as const,
            chapterKey: chapKey,
            project,
            chapterName: chapter.chapter,
            volume: chapter.volume,
            chapDir,
            chapterNum,
            file: chapter.file
        };

        this.tabs.push(newTab);
        this.activeTabId = newTab.id;
        this.renderTabBar();
        await this.renderTabContent();
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
                console.log('[小说工坊] 进入写作界面，定位章节:', nextChapter.chapter, nextChapter.title);
                await this.selectChapter(project, nextChapter);
            } else {
                // 没有章节则提示用户
                new Notice('⚠️ 未找到章节文件，请先运行批量建章', 5000);
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[小说工坊] 进入写作界面失败:', errMsg);
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
            console.error('Quick create project failed:', errMsg);
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
                console.warn('[小说工坊] 上下文面板渲染异常（已跳过）:', e);
                workspace.createDiv({ text: '⚠️ 上下文面板渲染失败', cls: 'novel-writer-fw-warning' });
            }

            // 状态栏
            this.renderStatusBar(mainContainer);

            // 注入样式
            injectFullWriterStyles();
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[小说工坊] 渲染失败:', errMsg);
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
        const bar = container.createDiv({ cls: 'novel-writer-fw-titlebar' });

        const titleRow = bar.createDiv({ cls: 'novel-writer-fw-title-row' });

        // ← 返回项目与章节界面（v3.4.7 P0-5）
        const backBtn = titleRow.createEl('button', {
            text: '← 返回',
            attr: {
                style: 'padding:4px 10px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; background:var(--background-secondary); color:var(--text-muted); font-size:13px; margin-right:6px; white-space:nowrap;',
                title: '返回项目与章节选择界面'
            }
        });
        backBtn.onclick = () => {
            this.activateTab('project-selector');
        };

        // 项目下拉菜单
        const projectSelect = titleRow.createEl('select', { cls: 'nw-select novel-writer-fw-title' });
        projectSelect.style.cssText = 'width:auto;height:28px;line-height:26px;font-size:14px;font-weight:bold;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:4px;padding:0 8px;color:var(--text-normal);min-width:120px;';

        // 使用 detectProjects 只获取真正的小说项目
        const projects = await this.contextManager.detectProjects();

        if (projects.length === 0) {
            projectSelect.createEl('option', { text: '📖 无项目' });
        } else {
            for (const name of projects) {
                const opt = projectSelect.createEl('option', { text: `📖 ${name}` });
                if (name === this.project) {
                    opt.selected = true;
                }
            }
        }

        projectSelect.addEventListener('change', async () => {
            const rawText = projectSelect.value;
            const selected = rawText.replace('📖 ', '');
            if (selected !== this.project && selected !== '无项目') {
                this.project = selected;
                await this.switchProjectQuick();
            }
        });

        if (this.project) {
            titleRow.createSpan({ text: ' · ', cls: 'novel-writer-fw-title-sep' });

            const selectContainer = titleRow.createDiv({ cls: 'novel-writer-fw-chapter-select-container' });
            this.chapterSelectEl = selectContainer.createEl('select', { cls: 'nw-select novel-writer-fw-chapter-select' });

            const chapters = this.getChaptersForProject(this.project);
            const sortedChapters = this.sortChaptersByNumber(chapters);
            for (const ch of sortedChapters) {
                const statusIcon = ch.status === 'written' || ch.status === 'settled' ? ' ✅' : ' 📝';
                const option = this.chapterSelectEl.createEl('option', {
                    text: `${ch.chapter} ${ch.title || ''}${statusIcon}`,
                    value: `${ch.chapter}|${ch.volume}|${ch.file.path}`
                });
                if (ch.chapter === this.chapterName && (!ch.volume || ch.volume === this.volume)) {
                    option.selected = true;
                }
            }

            this.chapterSelectEl.onchange = async () => {
                const [chapterName, volume, filePath] = this.chapterSelectEl.value.split('|');
                if (!filePath) return;

                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file && file instanceof TFile) {
                    await this.selectChapter(this.project, { chapter: chapterName, volume, file });
                }
            };

            titleRow.createSpan({ text: ' 正文写作', cls: 'novel-writer-fw-title-suffix' });
            titleRow.createDiv({ cls: 'novel-writer-fw-title-spacer' });
        }

        // Task 8.1: 次要控件容器包装「句级协同」和「设置」按钮，支持窄屏换行
        const secondaryRow = titleRow.createDiv({ cls: 'novel-writer-fw-title-secondary' });

        // v73: 正文写作标题栏常驻「句级协同」直达入口（不必进到正文生成步骤）
        if (this.project && this.chapterName) {
            const coBtn = secondaryRow.createEl('button', { text: '✍️ 句级协同', cls: 'novel-writer-settings-btn' });
            coBtn.setAttribute('title', '进入句级协同写作工作台（当前章节）');
            coBtn.onclick = () => this.openCurrentChapterInCoWriting();
        }

        const settingsBtn = secondaryRow.createEl('button', { text: '⚙️ 设置', cls: 'novel-writer-settings-btn' });
        settingsBtn.onclick = () => {
            new MiniSettingsModal(this.app, this.plugin).open();
        };
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

        const templateService = new TemplateService(this.app);
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
            cowriteCard.createEl('h4', { text: '✍️ 推荐：进入句级协同写作工作台' });
            cowriteCard.createEl('p', { text: '按技术规格，正文生成阶段可切换为逐句协同：Tab 生成 3 条候选，用户接受/编辑/验证后写入正文；Step 5-9 不替代人工把关。' });
            const cowriteBtn = cowriteCard.createEl('button', {
                text: '进入句级协同写作',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary'
            });
            cowriteBtn.addEventListener('click', () => this.openCurrentChapterInCoWriting());
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
        if (stepKey === 'outline' && this.stepCompleted.has('outline') && this.project) {
            const previewSection = area.createDiv({ cls: 'novel-writer-fw-result-section' });
            previewSection.createEl('h4', { text: '📚 分卷大纲预览', cls: 'novel-writer-fw-result-title' });
            await this.outlineTreeController.render(previewSection);
        }

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
        const sb = container.createDiv({ cls: 'novel-writer-fw-status-bar' });

        const currentStep = findStepByIndex(this.currentStepIndex);
        const ctxLoaded = this.stepCompleted.has('context');

        sb.createSpan({ text: ctxLoaded ? '🟢 上下文已加载' : '🔴 上下文未加载', cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });
        sb.createSpan({ text: `当前步骤: ${currentStep?.label ?? '—'}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const completedCount = Array.from(this.stepCompleted).filter(k => k !== 'context' && k !== 'settlement').length;
        const totalSteps = ALL_FULL_STEPS.filter(s => s.key && !s.auto).length;
        sb.createSpan({ text: `进度: ${completedCount}/${totalSteps}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const totalChars = this.estimateTotalChars();
        const estimatedTokens = Math.floor(totalChars / 4);
        sb.createSpan({ text: `正文 tokens: ~${estimatedTokens.toLocaleString()}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        // v3.5.0: 上下文窗口 token 估算
        const ctxTokens = parseInt(this.vars['_contextTokens'] || '0') || 0;
        const maxCtx = this.plugin.settings.maxContext || 128000;
        const pct = maxCtx > 0 ? Math.round(ctxTokens / maxCtx * 100) : 0;
        const ctxColor = pct > 70 ? 'var(--text-error)' : pct > 50 ? 'var(--text-warning)' : 'var(--text-muted)';
        const ctxSpan = sb.createSpan({ text: `上下文: ~${ctxTokens.toLocaleString()}t (${pct}%)`, cls: 'novel-writer-fw-status-item', attr: { style: `color:${ctxColor};` } });
        ctxSpan.setAttr('title', `上下文预算: ${ctxTokens}/${maxCtx} tokens`);
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        // v3.5.0: 场景类型 + 节奏模式
        const sceneType = this.vars['_sceneType'] || '';
        const sceneLabel = sceneType === 'battle' ? '⚔️ 战斗' : sceneType === 'emotional' ? '💭 情感' : '💬 对话';
        const rhythm = this.vars['suggestedRhythm']?.split(' — ')[0] || '起承转合';
        sb.createSpan({ text: `${sceneLabel} · ${rhythm}`, cls: 'novel-writer-fw-status-item', attr: { title: `推荐节奏: ${this.vars['suggestedRhythm'] || '起承转合'}` } });
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
        let total = 0;
        if (this.context) {
            total += JSON.stringify(this.context.data).length;
        }
        for (const result of Object.values(this.stepResults)) {
            total += result.length;
        }
        // 加上当前提示词
        if (this.systemPromptEl) total += this.systemPromptEl.value.length;
        if (this.userPromptEl) total += this.userPromptEl.value.length;
        return total;
    }

    /**
     * ✅ P0修复#2：同步当前章节的涉及实体集到 plugin 实例
     * 上下文面板 (context-panel.ts) 读取这些集来过滤显示
     */
    private syncInvolvedEntitiesToPlugin(): void {
        this.plugin._involvedChars = new Set<string>();
        this.plugin._involvedLocs = new Set<string>();
        this.plugin._involvedFactions = new Set<string>();
        this.plugin._involvedItems = new Set<string>();

        if (this.plugin.settings.contextScope !== 'compact') return;

        try {
            // v4.0：正文位于 正文/第V卷/，与 chapDir（步骤结果）分离 → 用 findBodyFileV4 定位。
            const volN = parseInt(this.volume.match(/第(\d+)卷/)?.[1] || '0', 10);
            const bodyFile = findBodyFileV4(this.app, this.project, volN, this.chapterNum);
            if (bodyFile instanceof TFile) {
                const involved = getInvolvedEntities(this.app, bodyFile);
                this.plugin._involvedChars = new Set(involved.chars);
                this.plugin._involvedLocs = new Set(involved.locs);
                this.plugin._involvedFactions = new Set(involved.factions);
                this.plugin._involvedItems = new Set(involved.items);
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn('[FullWriterView] 同步涉及实体失败:', errMsg);
        }
    }

    /**
     * ✅ v1.6.0 实体状态追踪：检测并更新实体状态
     * 在 Step 4（正文生成）完成后自动调用
     */
    private async detectAndUpdateEntityStates(bodyContent: string): Promise<void> {
        if (!this.project || !this.chapterNum) return;

        try {
            const manager = new EntityStateManager({
                app: this.app,
                plugin: this.plugin,
                aiEngine: this.aiEngine,
            });

            // 检测状态变更
            const changes = await manager.detectStateChanges(
                bodyContent,
                this.project,
                this.chapterNum,
                this.chapterName
            );

            if (changes.length > 0) {
                // 写入人物 frontmatter
                await manager.applyStateChanges(
                    this.project,
                    changes,
                    this.chapterNum,
                    this.chapterName
                );

                // 自动更新涉及实体索引（v4.0：正文在 正文/第V卷/，与 chapDir 分离）
                const volN = parseInt(this.volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const bodyFile = findBodyFileV4(this.app, this.project, volN, this.chapterNum);
                if (bodyFile instanceof TFile) {
                    const ctx = this.context;
                    const d = ctx?.data;
                    const bodyPath = bodyFile.path;
                    await manager.updateInvolvedEntities(
                        this.project,
                        bodyPath,
                        bodyContent
                    );
                }

                new Notice(`✅ 已自动更新 ${changes.length} 位角色的状态`);
                
                // 刷新上下文面板
                this.refreshContextBar();
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn('[FullWriterView] 实体状态检测失败:', errMsg);
            new Notice('⚠️ 实体状态自动更新失败，将在结算时重试', 5000);
        }
    }

    public refreshContextBar(): void {
        // v3.4.9 P0-1: try-catch 防止渲染异常导致整个上下文面板不可用
        try {
            // 优先使用缓存的 workspace 引用；fallback 到 DOM 查询
            const workspace = this.workspace || this.mainContainer?.querySelector('.novel-writer-fw-workspace');
            if (!workspace) return;
            // ✅ P0修复#2：预先计算涉及实体集，用于面板过滤显示
            this.syncInvolvedEntitiesToPlugin();
            workspace.querySelectorAll('.novel-writer-fw-context-card').forEach(el => el.remove());
            this.contextPanel.render(workspace as HTMLElement, this.context, this.project, this.chapterNum, this.plugin, () => this.estimateTotalChars());
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn('[FullWriterView] refreshContextBar 异常:', errMsg);
        }
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
