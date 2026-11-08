import { SidebarComponent } from './sidebar-component';
import { createPanelResizer, type PanelResizerHandle } from './panel-resizer';
import { App, ItemView, WorkspaceLeaf, TFile, TFolder, Modal, Notice } from 'obsidian';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from './components/notice-helpers';
import { AddFanficSettingModal } from './add-fanfic-setting-modal';
import { WizardTab, WizardStep, buildWizardSteps as buildWizardStepsExternal } from './full-writer/wizard-types';
import { buildTemplateVars as buildTemplateVarsExternal } from './full-writer/template-vars-builder';
import { extractCharacterNames } from '@/engine/revision/revision-guard';
import { FullWriterStoreImpl, type WriterTab } from './full-writer/full-writer-store';
import { TabController } from './full-writer/tab-controller';
import { EntityStateController } from './full-writer/entity-state-controller';
import { TitleBarController } from './full-writer/title-bar-controller';
import { StatusBarController } from './full-writer/status-bar-controller';
import { ContextLoaderController } from './full-writer/context-loader-controller';
import { parseChapterFromPath, estimateTotalChars as calcTotalChars, rebuildChapDir, calcResumeStepIndex as calcResumeIdx, findStepByIndex } from './full-writer/full-writer-utils';
import { CoverPickerController } from './full-writer/cover-picker-controller';
import { SettingLibController } from './full-writer/setting-lib-controller';
import { StepRenderController } from './full-writer/step-render-controller';
import { ChapterOrchestrator, countRemainingChapterActions } from './full-writer/chapter-orchestrator';
import { ExecutionRunStore } from './full-writer/execution-run-store';
import { ExecutionLogPanel, ExecutionTimelinePanel, renderStepFailureCard } from './full-writer/execution-panels';
import { writeVaultText } from '@/shared/file-system-port';
import { createStepFailure } from '@/shared/execution-events';
import type { DiagnosticInput, ExecutionEventInput, StepFailure } from '@/shared/execution-events';
import type { ChapterRunMode } from '@/shared/chapter-run';
import { WizardController } from './full-writer/wizard-controller';
import { ProjectSelectorController } from './full-writer/project-selector-controller';
import { FlowPanelController } from './full-writer/flow-panel-controller';
import { UnitWriterController } from './full-writer/unit-writer-controller';
import { ensureFlowTab, flowTabId } from './full-writer/flow-tab';
import { ensureUnitTab, unitTabId } from './full-writer/unit-tab';
import { markFlowExported } from './full-writer/creation-flow-state';
import { resolveProjectMode, rememberProjectMode } from '@/shared/project-mode';
import { isChapterBodyPath } from '@/shared/body-path';
import { PreResearchModal } from './pre-research-modal';
import { ModeDocumentModal } from './mode-document-modal';
import { ExportManuscriptModal } from './export-manuscript-modal';
import { listModeUnits, modeUnitLabel } from '@/shared/mode-content';
import type { CreationMode } from '@/shared/creation-mode';
import { InterventionController } from './full-writer/intervention-controller';
import type { WizardViewAccess } from './full-writer/wizard-view-access';
import { WizardStepRenderers } from './full-writer/wizard-step-renderers';
import { WizardStepExecutors } from './full-writer/wizard-step-executors';
import NovelWriterPlugin from '@/main';
import { AIEngine, APIResponse } from '@/engine/ai-engine';
import { ContextManager, GatheredContext, CharacterData, ForeshadowData, TimelineEvent, MarkdownContent } from '@/engine/context-manager';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { showProgress, hideProgress, showSuccess, showError, mkdirp, stripFrontmatter, applyNwScope } from '@/utils/helpers';
import { resolveStepPrompt } from '@/engine/prompt-resolver';
import { TemplateService } from '@/engine/template-service';
import { getForeshadowWarnings } from '@/engine/foreshadow-manager';
import { filterForeshadowsByChapter, getInvolvedEntities, getEntityStatusLine } from '@/engine/chapter-context-builder';
import { scoreAndFilterEntities, ScoredEntity } from '@/engine/entity-scorer';
import { buildCharacterSoulSummary, getProtagonistSoulDetail } from '@/engine/character-soul';  // V2 P0-1
import { getChapterFile, getChapterFileName, findBodyFileV4 } from '@/engine/chapter-utils';
import { MiniSettingsModal } from './mini-settings-modal';
import { EntityStateManager } from '@/engine/entity-state-manager';
import { SettlementEngine } from '@/engine/settlement-engine';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { ChapterStateManager } from './states/chapter-state-manager';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { StepRunner, ALL_FULL_STEPS, FullStep, StepRunCtx } from '@/engine/step-runner';
import { BODY_CHANGE_INVALIDATED_STEPS } from '@/engine/step-definitions';
import { buildCreationModeGuide, parseCreationModeMeta } from '@/shared/creation-mode';
import {
    buildStoryStructureGuide,
    createDefaultStorySettings,
    getStoryStructure,
    parseStorySettingsFromProjectMeta,
    STORY_STRUCTURES,
    upsertStorySettingsInProjectMeta,
    type StoryStructureId,
} from '@/shared/story-structure';

import { CrossVolumeIntegrator } from '@/engine/cross-volume-integration';
import { ContextPanel } from './rendering/context-panel';
import { RE_VOLUME_RANGE, FIELD_TOTAL_WORDS, FIELD_TOTAL_CHAPTERS, chapterOutlineSection, CHAPTER_STATUS } from '@/shared/format-constants';
import { validateWorldviewOutput, validateOutlineOutput, validateFanficSettings } from '@/shared/template-validator';
import { getWorldviewPath, getSettingLibPath, pjVolumeOutlineDir, readProjectMeta, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, SUBDIR_OUTLINE_ROOT, SUBDIR_TIMELINE, SUBDIR_CONTROL, SUBDIR_FANFIC, SUBDIR_VOLUME_OUTLINE } from '@/shared/paths';
import { PlanBookModal } from './plan-book-modal';
import { BatchCreateModal } from './batch-create-modal';
import { WritingStyleModal } from './writing-style-modal';
import { ChapterOutlineTreeModal } from './chapter-outline-tree-modal';
import { PolishEditor } from './polish-editor';
import { WizardChecker } from './wizard-checker';
import { pjSettingLib, pjWritingStyle, pjStepDir,
    SUBDIR_WORLD_ARCH, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS,
    SUBDIR_WORLDVIEW_FILE, SUBDIR_SETTING_LIB_FILE, SUBDIR_WRITING_STYLE_FILE } from '@/shared/paths';
import { getWritingStyleCandidatePaths } from './writing-style-paths';
import { sortChaptersByNumber, getNextChapter, getProjectCover, getChaptersForProject, deleteProject, updateWritingStyleTemplate, getProjectMeta, type ChapterListEntry } from './project-utils';
import { CHAR_TO_TOKEN_RATIO, getInfoDebtMax, INFO_DEBT_WARN_CRITICAL, INFO_DEBT_WARN_HIGH } from '@/shared/thresholds';
import { createLogger } from '@/shared/logger';
import { ensureTemplateScaffold } from '@/shared/template-scaffold';


import { withWriteLock } from '@/shared/write-lock';
const log = createLogger('FullWriterView');
/**
 * 视图类型常量。
 */
export const VIEW_TYPE = 'novel-writer-full-writer';

/**
 * 工作台注入到 <html> 的响应式 CSS 变量（与 styles.css :root 保底值一致）。
 * onOpen 写入、onClose 移除，避免插件卸载后仍在全局留下 --nw-* 令牌。
 */
const WORKBENCH_ROOT_VARS: Record<string, string> = {
    '--nw-wizard-sidebar-w': 'clamp(200px, 14vw, 240px)',
    '--nw-entity-tree-w': 'min(240px, 16vw)',
    '--nw-modal-max-w': '96vw',
    '--nw-modal-max-h': '90vh',
    '--nw-modal-md-w': 'min(1000px, 85vw)',
    '--nw-project-selector-w': 'min(1000px, 85vw)',
    '--nw-step-min-h': 'max(320px, calc(100vh - 380px))',
    '--nw-scroll-max-h': 'max(450px, 55vh)',
    '--nw-scroll-md-h': 'max(280px, 35vh)',
    '--nw-grid-3col': 'minmax(120px, 160px) 1fr minmax(180px, 240px)',
    '--nw-grid-2col-fm': 'auto 1fr',
    '--nw-panel-pad': '20px',
    '--nw-card-pad': '16px',
};

/**
 * 完整写入器视图。
 */
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
    /** 三栏分隔条句柄（第 4 轮） */
    private workspaceResizers: PanelResizerHandle[] = [];
    private stepAbortController: AbortController | null = null;
    private settlementEngine: SettlementEngine;
    private polishEditor: PolishEditor;
    private wizardChecker: WizardChecker;
    private coverPickerController: CoverPickerController;
    private settingLibController: SettingLibController;
    private stepRenderController: StepRenderController;
    private wizardStepRenderers: WizardStepRenderers;
    private wizardStepExecutors: WizardStepExecutors;
    private outlineTreeModal: ChapterOutlineTreeModal | null = null;
    private wizardController: WizardController;
    private projectSelectorController: ProjectSelectorController;
    private flowPanelController!: FlowPanelController;
    private unitWriterController!: UnitWriterController;
    private interventionController: InterventionController;
    private chapterOrchestrator: ChapterOrchestrator | null = null;
    private chapterRunStrip: HTMLElement | null = null;
    /** 当前一键任务把章节进度同步给任务中心 */
    private activeJobProgress: ((p: { current: number; total: number; message: string }) => void) | null = null;
    private _statusInfoEl: HTMLElement | null = null;
    private readonly executionStore = new ExecutionRunStore();
    private timelinePanel: ExecutionTimelinePanel | null = null;
    private logPanel: ExecutionLogPanel | null = null;
    private lastRunProgressMessage = '';
    private failureRenderTimer: ReturnType<typeof setTimeout> | null = null;
    /** 项目创建后的延迟刷新：视图在 150ms 内关闭时必须取消，否则会往已销毁容器渲染 */
    private projectRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    private mainContainer: HTMLElement | null = null;
    private workspace: HTMLElement | null = null;

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

    get tabs(): WriterTab[] { return this.state.tabs; }
    set tabs(v: WriterTab[]) { this.state.tabs = v; }
    private get activeTabId(): string { return this.state.activeTabId; }
    private set activeTabId(v: string) { this.state.activeTabId = v; }
    private get navStack(): string[] { return this.state.navStack; }
    private set navStack(v: string[]) { this.state.navStack = v; }

    private get wizardStepResults(): Record<string, string> { return this.state.wizardStepResults; }
    get wizardStepExecuting(): Set<string> { return this.state.wizardStepExecuting; }

    /**
     * 供质量仪表盘等外部组件获取当前选中章节（工作台视图活动时 getActiveFile 为 null，需此 fallback）
     *
      * @returns string } 结果
     */
    public getCurrentChapterState(): { project: string; chapterName: string; chapterNum: number; volume: string } {
        return { project: this.project, chapterName: this.chapterName, chapterNum: this.chapterNum, volume: this.volume };
    }

    /**
     * 外部视图（如句级协同写作）保存正文后，重新从磁盘恢复章节步骤状态。
     * 避免回到工作台后仍显示旧的「正文未完成」状态，导致流程卡在步骤 7。
     */
    public async refreshChapterStateFromDisk(): Promise<void> {
        if (!this.project || !this.chapDir) return;
        try {
            await this.chapterStateManager.restoreChapterState(this.chapDir);
            this.chapterStateManager.currentStepIndex = this._calcResumeStepIndex();
            if (this.tabContent) await this.renderInContainer(this.tabContent);
        } catch (e) {
            log.warn('[FullWriter] 刷新章节状态失败:', e);
        }
    }

    private recordUiStepError(message: string): void {
        const step = ALL_FULL_STEPS.find(s => s.index === this.currentStepIndex);
        this.executionStore.recordFailure(createStepFailure({
            stepKey: step?.key || 'current-step',
            stepLabel: step?.label || '当前步骤',
            message,
        }));
        if (step?.key) this.scheduleFailureRender(step.key);
    }

    private recordContextNotice(level: 'success' | 'warning' | 'error', message: string): void {
        this.executionStore.addEvent({
            type: 'context',
            level,
            message,
            stepKey: 'context',
            stepLabel: '上下文加载',
        });
        if (level === 'success') {
            if (message.includes('上下文加载完成')) this.executionStore.clearFailure('context');
            return;
        }
        this.executionStore.recordFailure(createStepFailure({
            stepKey: 'context',
            stepLabel: '上下文加载',
            message,
            kind: level === 'error' ? 'exception' : 'validation',
        }));
        this.scheduleFailureRender('context');
    }

    private scheduleFailureRender(stepKey: string): void {
        const current = ALL_FULL_STEPS.find(s => s.index === this.currentStepIndex);
        const currentKey = current?.index === 0 ? 'context' : current?.index === 10 ? 'settlement' : current?.key;
        if (currentKey !== stepKey) return;
        if (this.failureRenderTimer) clearTimeout(this.failureRenderTimer);
        this.failureRenderTimer = setTimeout(() => {
            this.failureRenderTimer = null;
            if (this.tabContent) void this.renderInContainer(this.tabContent);
        }, 30);
    }

    private async retryFailedStep(stepKey: string): Promise<void> {
        if (stepKey === 'context') {
            this.executionStore.clearFailure('context');
            await this.loadContext();
            if (this.tabContent) await this.renderInContainer(this.tabContent);
            return;
        }
        const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
        if (!step) return;
        if (this.chapterOrchestrator?.isRunning) {
            this.executionStore.addEvent({
                type: 'notice',
                level: 'warning',
                message: '章节任务仍在运行，请等待当前动作结束再重试',
                stepKey,
                stepLabel: step.label,
            });
            return;
        }
        this.executionStore.clearFailure(stepKey);
        this.currentStepIndex = step.index;
        if (this.tabContent) await this.renderInContainer(this.tabContent);
        await this.stepRunner.executeCurrentStep(this._makeStepRunCtx());
    }

    private openExecutionLog(): void {
        if (!this.logPanel) {
            this.logPanel = new ExecutionLogPanel(this.executionStore);
            if (this.mainContainer) this.logPanel.mount(this.mainContainer);
        }
        this.logPanel.setExpanded(true);
    }

    private mountExecutionPanels(host: HTMLElement): void {
        if (!this.logPanel) this.logPanel = new ExecutionLogPanel(this.executionStore);
        this.logPanel.mount(host);
    }

    private async switchNarrativeStructure(id: StoryStructureId): Promise<void> {
        if (!this.project) return;
        if (!STORY_STRUCTURES.some(item => item.id === id)) return;
        if (this.chapterOrchestrator?.isRunning || this.isLoading) {
            this.executionStore.addEvent({
                type: 'structure-switch',
                level: 'warning',
                message: '当前步骤仍在生成，暂不能切换叙事结构；请等待本次生成结束',
            });
            return;
        }
        const structure = getStoryStructure(id);
        try {
            const saved = await withWriteLock(`${this.project}/.project`, async () => {
                const meta = await readProjectMeta(this.app, this.project) || '';
                const mergedSettings = parseStorySettingsFromProjectMeta(meta) || createDefaultStorySettings(id);
                mergedSettings.structureId = id;
                const mergedMeta = upsertStorySettingsInProjectMeta(meta, mergedSettings);
                await this.app.vault.adapter.write(`${this.project}/.project`, mergedMeta);
                return { settings: mergedSettings, nextMeta: mergedMeta };
            });
            const settings = saved.settings;
            const nextMeta = saved.nextMeta;

            const guideDir = `${this.project}/00-系统模板`;
            await writeVaultText(this.app, `${guideDir}/故事结构指南.md`, buildStoryStructureGuide(settings));
            await writeVaultText(
                this.app,
                `${guideDir}/创作模式指南.md`,
                buildCreationModeGuide(parseCreationModeMeta(nextMeta)),
            );

            this.executionStore.addEvent({
                type: 'structure-switch',
                level: 'info',
                message: `叙事结构已切换为「${structure.name}」`,
                detail: '后续生成的步骤使用新结构；已生成内容不会自动改写。',
            });
            if (this.tabContent) await this.renderInContainer(this.tabContent);
        } catch (e) {
            this.executionStore.addEvent({
                type: 'structure-switch',
                level: 'error',
                message: `切换叙事结构失败：${e instanceof Error ? e.message : String(e)}`,
            });
        }
    }

    private getChapterOrchestrator(): ChapterOrchestrator {
        if (this.chapterOrchestrator) return this.chapterOrchestrator;
        this.chapterOrchestrator = new ChapterOrchestrator({
            stepRunner: this.stepRunner,
            state: this.chapterStateManager,
            makeCtx: () => this._makeStepRunCtx(),
            loadContext: () => this.loadContext(),
            render: (container) => this.renderInContainer(container),
            getTabContent: () => this.tabContent,
            settle: async () => {
                await this.stepRunner.executeSettlement(
                    this.project,
                    this.chapDir,
                    this.chapterName,
                    this.stepResults,
                    this.stepCompleted,
                    this.vars,
                    this.plugin,
                    (c) => this.renderInContainer(c),
                    this.tabContent,
                );
            },
            showNotice: (message) => {
                this.executionStore.addEvent({ type: 'run-notice', level: 'warning', message });
            },
            showWarning: (message) => {
                this.executionStore.addEvent({ type: 'run-notice', level: 'warning', message });
            },
            showError: (message) => {
                this.executionStore.addEvent({ type: 'run-error', level: 'error', message });
                this.openExecutionLog();
            },
            showSuccess: (message) => {
                this.executionStore.addEvent({ type: 'run-complete', level: 'success', message });
            },
            onProgress: (p) => {
                this.activeJobProgress?.(p);
                const message = `${p.message}（${p.current}/${p.total} 步，预计 ${p.aiCalls} 次 AI）`;
                this.executionStore.setStatus(p.message, p.current, p.total, p.aiCalls);
                const status = this.chapterRunStrip?.querySelector('.nw-chapter-run-status') as HTMLElement | null;
                if (status) status.setText(message);
                if (message !== this.lastRunProgressMessage) {
                    this.lastRunProgressMessage = message;
                    this.executionStore.addEvent({
                        type: 'run-progress',
                        level: 'info',
                        message: p.message,
                        detail: `进度 ${p.current}/${p.total}，已用 AI ${p.aiCalls} 次`,
                    });
                }
            },
        });
        return this.chapterOrchestrator;
    }

    /**
     * 一键完成本章：步骤仍可见、可编辑、可单独重生成。
     *
     * @param mode - 模式
     */
    public async runChapterOneClick(mode: ChapterRunMode = 'recommended'): Promise<void> {
        if (!this.project || !this.chapterName || !this.chapDir) {
            this.executionStore.addEvent({ type: 'run-error', level: 'error', message: '请先打开一个章节' });
            return;
        }
        const orchestrator = this.getChapterOrchestrator();
        if (orchestrator.isRunning) {
            this.executionStore.addEvent({ type: 'run-error', level: 'warning', message: '章节生成任务已在运行' });
            return;
        }
        this.executionStore.clearAllFailures();
        this.lastRunProgressMessage = '';
        this.executionStore.addEvent({
            type: 'run-start',
            level: 'info',
            message: mode === 'recommended' ? '开始一键完成本章（合并规划）' : '开始逐步完成本章',
        });
        this.showChapterRunStrip(orchestrator, mode);
        const jobs = this.plugin.getJobService();
        const job = jobs.start({
            kind: 'chapter-run',
            title: `完成本章 · ${this.chapterName}`,
            project: this.project,
            onCancel: () => orchestrator.cancel(),
            run: async (ctx) => {
                this.activeJobProgress = p => ctx.update({ current: p.current, total: p.total, label: p.message });
                ctx.update({ current: 0, total: 1, label: '准备开始' });
                const runResult = await orchestrator.run({ mode, pauseBetweenSteps: false });
                if (runResult.status === 'cancelled') {
                    const error = new Error('章节生成已取消') as Error & { jobResult?: unknown };
                    error.name = 'AbortError';
                    error.jobResult = runResult;
                    throw error;
                }
                if (runResult.status === 'failed') {
                    const error = new Error(runResult.message || '章节生成失败') as Error & { jobResult?: unknown };
                    error.jobResult = runResult;
                    throw error;
                }
                ctx.update({ current: 1, total: 1, label: '已完成' });
                return runResult;
            },
        });
        try {
            const final = await jobs.waitFor(job.id);
            const result = (final.result ?? {
                status: final.status === 'cancelled' ? 'cancelled' : 'failed',
                message: final.error || '章节生成失败',
                aiCalls: 0,
            }) as Awaited<ReturnType<ChapterOrchestrator['run']>>;
            if (result.status === 'failed') {
                const failedStep = result.failedStep ? this.executionStore.getFailure(result.failedStep) : undefined;
                if (!failedStep) {
                    this.executionStore.addEvent({
                        type: 'run-error',
                        level: 'error',
                        message: `章节生成中断：${result.message || result.failedStep || '未知错误'}`,
                        stepKey: result.failedStep,
                        detail: '已保留已完成步骤；可在对应步骤的错误卡中重试。',
                    });
                } else {
                    this.executionStore.addEvent({
                        type: 'run-aborted',
                        level: 'warning',
                        message: `流程已停止在「${failedStep.stepLabel}」，请按错误卡处理后重试`,
                    });
                }
                this.openExecutionLog();
            } else if (result.status === 'cancelled') {
                this.executionStore.addEvent({ type: 'run-cancelled', level: 'warning', message: '已取消章节生成' });
            } else if (result.status === 'completed') {
                this.executionStore.addEvent({
                    type: 'run-complete',
                    level: 'success',
                    message: `本章完成（${result.aiCalls} 次 AI 调用）`,
                });
            }
        } finally {
            this.activeJobProgress = null;
            this.hideChapterRunStrip();
            this.executionStore.clearStatus();
            if (this.tabContent) await this.renderInContainer(this.tabContent);
        }
    }

    private showChapterRunStrip(orchestrator: ChapterOrchestrator, mode: ChapterRunMode): void {
        this.hideChapterRunStrip();
        // 运行条必须挂在 tabContent 之外：renderInContainer(tabContent) 每一步都会 empty()，
        // 挂在 mainContainer（tabContent 的子节点）里会在第一步渲染后就消失，
        // 用户再也点不到暂停/取消，也看不到进度。
        const host = this.contentEl;
        if (!host) return;
        const strip = host.createDiv({ cls: 'novel-writer-fw-btn-row' });
        strip.addClass('nw-fw-run-strip');
        strip.createSpan({
            text: mode === 'recommended' ? '🚀 一键完成本章（推荐：合并规划）' : '🐢 逐步完成本章',
            cls: 'novel-writer-fw-warning',
        });
        const status = strip.createSpan({ text: '准备中...', cls: 'nw-chapter-run-status' });
        status.addClass('nw-fw-run-status');
        // P0-5（v4.27）：常驻状态信息——当前模型 / 规则版本 / token 消耗
        const infoSpan = strip.createSpan({ cls: 'nw-chapter-run-info' });
        infoSpan.addClass('nw-fw-run-info');
        const rulesVersion = this.plugin.settings.activeRulesVersion || 'auto';
        const voiceMode = this.plugin.settings.humanVoiceMode === 'quota' ? '配额' : '样文';
        const bodyVariant = (this.plugin.settings.activeBodyTemplate || 'auto').toUpperCase();
        infoSpan.setText(`📐 ${bodyVariant} | 📜 ${rulesVersion} | 🗣 ${voiceMode}`);
        // auto 时补上实际生效版本（此前硬编码「内置 3.6.0」，项目/vault 规则生效时会误报）
        if (!this.plugin.settings.activeRulesVersion) {
            void (async () => {
                try {
                    const { RulesService } = await import('@/services/rules-service');
                    const cfg = await RulesService.getInstance(this.app).getRulesConfig();
                    infoSpan.setText(
                        `📐 ${bodyVariant} | 📜 ${cfg.version}${cfg.path ? '' : '（内置）'} | 🗣 ${voiceMode}`,
                    );
                } catch {
                    // 解析失败时保留 auto 文案
                }
            })();
        }
        // token 消耗在步骤事件中由 prompt-ledger 更新
        this._statusInfoEl = infoSpan;
        const pauseBtn = strip.createEl('button', { text: '⏸ 暂停', cls: 'novel-writer-settings-btn' });
        pauseBtn.onclick = () => {
            if (pauseBtn.textContent === '▶ 继续') {
                orchestrator.resume();
                pauseBtn.setText('⏸ 暂停');
            } else {
                orchestrator.pause();
                pauseBtn.setText('▶ 继续');
            }
        };
        const cancelBtn = strip.createEl('button', { text: '✖ 取消', cls: 'novel-writer-settings-btn' });
        cancelBtn.onclick = () => orchestrator.cancel();
        // 插在 Tab 栏之后、内容区之前（contentEl 不参与 tabContent.empty()）
        if (this.tabBar && this.tabBar.nextSibling) host.insertBefore(strip, this.tabBar.nextSibling);
        else host.prepend(strip);
        this.chapterRunStrip = strip;
    }

    private hideChapterRunStrip(): void {
        this.chapterRunStrip?.remove();
        this.chapterRunStrip = null;
    }

    private tabBar!: HTMLDivElement;
    tabContent!: HTMLDivElement;

    private systemPromptEl!: HTMLTextAreaElement;
    private userPromptEl!: HTMLTextAreaElement;
    private temperatureSlider!: HTMLInputElement;
    /** 用户设定的生成温度（重渲染必须回填，旧实现每次重置成 1.4） */
    private stepTemperature = 1.4;
    private temperatureValueEl!: HTMLSpanElement;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.settlementEngine = plugin.engineRegistry.get(ENGINE_NAMES.SETTLEMENT_ENGINE);
        this.chapterStateManager = new ChapterStateManager(this.app);
        this.state = new FullWriterStoreImpl();

        const stepRunnerCallbacks = {
            showProgress: (message: string) => {
                this.executionStore.setStatus(message);
            },
            hideProgress: () => {
                this.executionStore.clearStatus();
            },
            showSuccess: (message: string) => {
                this.executionStore.addEvent({ type: 'notice', level: 'success', message });
            },
            showError: (message: string) => {
                this.recordUiStepError(message);
            },
            showNotice: (message: string) => {
                this.executionStore.addEvent({ type: 'notice', level: 'warning', message });
            },
            showWarning: (message: string) => {
                this.executionStore.addEvent({ type: 'notice', level: 'warning', message });
            },
            onExecutionEvent: (event: ExecutionEventInput) => {
                this.executionStore.addEvent(event);
                if (event.type === 'step-complete' && event.stepKey) {
                    this.executionStore.clearFailure(event.stepKey);
                } else if (event.type === 'step-start' && event.stepKey) {
                    this.executionStore.clearFailure(event.stepKey);
                }
            },
            onStepFailure: (failure: StepFailure) => {
                this.executionStore.recordFailure(failure);
                const failedStep = ALL_FULL_STEPS.find(s => s.key === failure.stepKey);
                if (failedStep) {
                    this.currentStepIndex = failedStep.index;
                    this.chapterStateManager.currentStepIndex = failedStep.index;
                }
                this.scheduleFailureRender(failure.stepKey);
            },
            onDiagnostic: (entry: DiagnosticInput) => {
                this.executionStore.addLog(entry);
            },
            // A7: 消痕/迭代弹窗内部改写正文后，走同一套失效传播
            invalidateSteps: (keys: string[]) => {
                this.chapterStateManager.invalidateSteps(keys);
            },
        };

        this.stepRunner = new StepRunner(this.app, plugin, stepRunnerCallbacks);
        this.contextPanel = new ContextPanel(this.app);
        this.polishEditor = new PolishEditor(this.stepRunner, this.plugin);
        this.wizardChecker = new WizardChecker(this.app);
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
            getContext: () => this.context,
            getChapterNum: () => this.chapterNum,
            reloadContext: async () => {
                await this.loadContext();
                // loadContext 结束会跳到第一步；重新加载后停在上下文步骤，用户才能看到清单结果
                this.chapterStateManager.currentStepIndex = 0;
                if (this.tabContent) await this.renderInContainer(this.tabContent);
            },
            getTabContent: () => this.tabContent,
            renderInContainer: (c) => this.renderInContainer(c),
            renderInterventionBox: (c) => this.interventionController.render(c),
            renderPolishEditor: (area) => this.renderPolishEditor(area),
            reportStepError: (stepKey, message) => {
                const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
                this.executionStore.recordFailure(createStepFailure({
                    stepKey,
                    stepLabel: step?.label || stepKey,
                    message,
                    kind: 'save',
                }));
                this.scheduleFailureRender(stepKey);
            },
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
                onOpenUnit: (project, mode, unitNumber) => this.openUnitTab(project, unitNumber, mode),
                onOpenFlow: (project) => this.openFlowTab(project),
                onAddFanficSetting: (project) => {
                    new AddFanficSettingModal(this.app, this.plugin, project).open();
                },
                onDeleteProject: () => this.renderProjectSelectorInTab(),
                // 项目页没有 activeFile：把卡片选中同步给命令层，右侧快捷工具才能拿到项目
                onProjectSelected: (project) => {
                    if (project) {
                        this.plugin.setWorkbenchContext({
                            project,
                            volume: '',
                            chapterName: '',
                            chapterNum: 0,
                            chapDir: '',
                        });
                    } else {
                        this.plugin.setWorkbenchContext(null);
                    }
                },
                executeCommand: (cmd) => this.plugin.executeCommand(cmd),
            }
        );

        this.flowPanelController = new FlowPanelController({
            app: this.app,
            // 流程页签可能指向非当前导航项目；此时让采集器直接读 localStorage 的项目分桶
            getWizardResults: (project) => project === this.project ? this.wizardStepResults : undefined,
            subscribeStore: (listener) => this.state.subscribe(() => listener()),
            onOpenWizard: (project) => this.openWizardForProject(project),
            onOpenResearch: (project, mode) => {
                if (mode === 'long') return;
                new PreResearchModal(this.app, this.plugin, mode, { project }).open();
            },
            onOpenDocument: (project, mode, kind) => {
                new ModeDocumentModal(this.app, this.plugin, mode, kind, project).open();
            },
            onCreateUnits: (project) => {
                new BatchCreateModal(this.app, this.plugin, project).open();
            },
            onOpenUnit: (project, mode, unitNumber) => this.openUnitTab(project, unitNumber, mode),
            onBrowseUnits: (project, mode) => this.openAllUnits(project, mode),
            onSettle: (project) => this.openSettlementTarget(project),
            onExport: (project) => {
                new ExportManuscriptModal(this.app, this.plugin, project, {
                    onExported: () => markFlowExported(project),
                }).open();
            },
            onOpenSelector: () => { void this.showProjectSelector(); },
        });

        this.unitWriterController = new UnitWriterController({
            app: this.app,
            plugin: this.plugin,
            aiEngine: this.aiEngine,
            updateTab: (tabId, updates) => this.state.updateTab(tabId, updates),
            refreshTabBar: () => this.renderTabBar(),
            onOpenDocument: (project, mode, kind) => {
                new ModeDocumentModal(this.app, this.plugin, mode, kind, project).open();
            },
            onCreateUnits: (project) => {
                new BatchCreateModal(this.app, this.plugin, project).open();
            },
            onOpenFlow: (project) => { void this.openFlowTab(project); },
        });

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
            renderFlowTabContent: (tab) => this.renderFlowTabContent(tab),
            renderUnitTabContent: (tab) => this.renderUnitTabContent(tab),
            renderInContainer: (c) => this.renderInContainer(c),
            loadContext: () => this.loadContext(),
            getChapterStateManager: () => this.chapterStateManager,
            calcResumeStepIndex: () => this._calcResumeStepIndex(),
            rebuildChapDirIfNeeded: (project, chapterName, volume, chapterNum) =>
                this._rebuildChapDir(project, chapterName, volume, chapterNum),
            cancelActiveRun: () => {
                this.unitWriterController?.cancelActiveGeneration();
                if (this.chapterOrchestrator?.isRunning) {
                    this.chapterOrchestrator.cancel();
                    this.executionStore.addEvent({
                        type: 'run-cancelled',
                        level: 'warning',
                        message: '已切换章节，当前一键任务已取消',
                    });
                }
            },
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
            executeCommand: (commandId) => this.plugin.executeCommand(commandId),
            runChapterOneClick: (mode) => { void this.runChapterOneClick(mode); },
            getRemainingChapterActions: () => countRemainingChapterActions(
                this.stepCompleted,
                this.stepResults['bodyGeneration'] || '',
                this.stepResults['analysisReport'] || '',
            ),
        });

        this.statusBarController = new StatusBarController({
            app: this.app,
            plugin: this.plugin,
            state: this.state,
            getChapterStateManager: () => this.chapterStateManager,
            estimateTotalChars: () => this.estimateTotalChars(),
            getNarrativeStructure: () => (this.vars['narrativeStructure'] as StoryStructureId) || '',
            onChangeNarrativeStructure: (id) => { void this.switchNarrativeStructure(id); },
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
            saveStepResult: (key, content) =>
                this.stepRunner.saveStepResult(key, content, this.chapDir, this.chapterName, this.volume),
            reportProgress: (message) => {
                if (message) this.executionStore.setStatus(message);
                else this.executionStore.clearStatus();
            },
            reportNotice: (level, message) => this.recordContextNotice(level, message),
        });
    }

    private _rebuildChapDir(project: string, chapterName: string, volume: string, chapterNum?: number): string {
        return rebuildChapDir(project, chapterName, volume, chapterNum);
    }

    /**
     * 视图类型标识。
     * @returns 类型
     */
    getViewType(): string {
        return VIEW_TYPE;
    }

    /**
     * 标签页显示名。
     * @returns 名称
     */
    getDisplayText(): string {
        return '📖 完整写作工作台';
    }

    /**
     * 视图图标。
     * @returns 图标
     */
    getIcon(): string {
        return 'book-open';
    }

    /**
     * 视图打开：渲染壳层与恢复状态。
     */
    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        applyNwScope(this);

        // 标记工作台上下文：Modal 不应在 Obsidian 主窗口打开文件
        this.plugin._isWorkbenchContext = true;

        // v3.4.6 flex 容器 + 宽高 100%（防 Obsidian 主题约束）
        contentEl.addClass('nw-flex-column-full');

        // v3.4.5: 注入 CSS 响应式变量（全局生效，一次定义，所有弹窗/面板复用）
        // 注：数值与 styles.css :root 保底值保持一致，仅在未来需要动态计算时才覆盖。
        // onClose 会逐一 removeProperty，插件卸载/视图关闭后不在 <html> 留残余变量。
        const root = document.documentElement;
        for (const [name, value] of Object.entries(WORKBENCH_ROOT_VARS)) {
            root.style.setProperty(name, value);
        }
        // --nw-grid-workspace 由 ThemeManager 统一注入（读 panelSizes），此处不再重复设置，
        // 否则两处各写一套值，谁后执行谁生效，宽度会「看起来随机」。

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
                // 先恢复磁盘状态再加载上下文：自动提取角色灵魂依赖 stepCompleted，
                // 旧顺序（loadContext → restore）会让提取结果被磁盘上的模板骨架覆盖回 ○/◐。
                await this.chapterStateManager.restoreChapterState(this.chapDir);
                await this.loadContext();
                await this.renderTabContent();
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                log.error('[FullWriter] onOpen error:', errMsg);
                // 回到项目页必须说明原因，否则用户只看到「闪一下又回去了」
                showErrorNotice(errMsg, { title: '章节加载失败，已返回项目页', timeout: 8000 });
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
                showErrorNotice('项目加载失败，请检查项目文件是否完整', { title: '加载失败', timeout: 5000 });
            }
        }

        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            // P1-13（v4.27）：打开任意笔记（设定/大纲/旁注）也会触发 file-open，
            // 旧实现无差别 parseActiveFile → project 被解析成笔记名并 reset/render，
            // 当前章节状态被冲掉。只有「章节正文」才切换工作台上下文。
            if (!file || !this.isChapterBodyPath(file.path)) return;
            void this.handleFileChange(file).catch((error) => {
                log.error('[FullWriter] 处理章节切换失败:', error);
            });
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
                if (this.projectRefreshTimer) clearTimeout(this.projectRefreshTimer);
                this.projectRefreshTimer = setTimeout(async () => {
                    this.projectRefreshTimer = null;
                    // 视图已关闭时 contentEl 已脱离 DOM，继续渲染只会写进空容器
                    if (!contentEl.isConnected) return;
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

        // 外部入口（协同写作 / 批量 / 续写）写盘后，刷新本工作台的步骤状态
        this.registerEvent(
            this.app.workspace.on('novel-writer:body-written', (data) => {
                void this.handleBodyWritten(data?.path || '');
            })
        );

        // v4.25：命令面板/Agent 触发当前章的定向修订
        this.registerEvent(
            this.app.workspace.on('novel-writer:run-targeted-revision', () => {
                void (async () => {
                    if (!this.chapDir) {
                        new Notice('请先在工作台打开一个章节', 4000);
                        return;
                    }
                    try {
                        await this.stepRunner.executeTargetedRevision(
                            this.stepResults,
                            this.chapDir,
                            this.chapterName,
                            this.volume,
                            this.stepCompleted,
                            extractCharacterNames(this.vars?.allChars),
                        );
                        await this.renderInContainer(this.tabContent);
                    } catch (e) {
                        showErrorNotice((e as Error).message, { title: '定向修订失败', timeout: 6000 });
                    }
                })();
            })
        );
    }

    /** 正文被其他入口覆写后：只有「当前章节」才重新恢复状态并重渲染 */
    private async handleBodyWritten(bodyPath: string): Promise<void> {
        if (this.isLoading || !this.project || !this.chapterNum || !this.chapDir) return;
        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        if (activeTab && (activeTab.type === 'wizard' || activeTab.type === 'flow' || activeTab.type === 'unit')) return;

        const volNum = parseInt(this.volume.match(/第(\d+)卷/)?.[1] || '0', 10);
        const currentBody = volNum > 0
            ? findBodyFileV4(this.app, this.project, volNum, this.chapterNum)
            : null;
        if (!currentBody || currentBody.path !== bodyPath) return;

        await this.chapterStateManager.restoreChapterState(this.chapDir);
        await this.renderInContainer(this.tabContent);
    }

    /**
     * 视图关闭：释放资源。
     */
    async onClose(): Promise<void> {
        // 一键任务不随视图关闭而停止：不取消会继续调 AI 并往已销毁的容器里渲染
        if (this.chapterOrchestrator?.isRunning) {
            this.chapterOrchestrator.cancel();
        }
        this.stepAbortController?.abort();
        this.stepAbortController = null;
        this.timelinePanel?.destroy();
        this.timelinePanel = null;
        this.logPanel?.destroy();
        this.logPanel = null;
        if (this.failureRenderTimer) {
            clearTimeout(this.failureRenderTimer);
            this.failureRenderTimer = null;
        }
        if (this.projectRefreshTimer) {
            clearTimeout(this.projectRefreshTimer);
            this.projectRefreshTimer = null;
        }
        this.flowPanelController?.dispose();
        this.unitWriterController?.dispose();
        // v4.79.0：销毁 Tab 栏持有的模型切换器（否则 refreshers 集合保留已脱离 DOM 的按钮）
        this.tabController?.dispose();
        // 移除 onOpen 注入到 <html> 的响应式变量（构建脚本无法校验，只能靠这里成对清理）
        for (const name of Object.keys(WORKBENCH_ROOT_VARS)) {
            document.documentElement.style.removeProperty(name);
        }
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
        this.plugin.setWorkbenchContext(null);
    }

    /** 只认章节正文路径（P1-13；长篇 + 短篇/剧本单元），实现在 shared/body-path */
    private isChapterBodyPath(path: string): boolean {
        return isChapterBodyPath(path);
    }

    private async handleFileChange(file: TFile): Promise<void> {
        if (this.isLoading) return;
        // v73: wizard tab 期间跳过文件变更处理，防止 AI 写文件触发 renderInContainer 产生幽灵 UI
        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        if (activeTab && (activeTab.type === 'wizard' || activeTab.type === 'flow' || activeTab.type === 'unit')) return;

        const oldProject = this.project;
        const oldChapter = this.chapterName;

        // P1-13：切章前取消在跑的一键任务，避免旧任务继续按旧章目录写入
        if (this.chapterOrchestrator?.isRunning) {
            this.chapterOrchestrator.cancel();
            this.executionStore.addEvent({
                type: 'run-cancelled',
                level: 'warning',
                message: '检测到切换章节，已取消在跑的生成任务',
            });
        }

        await this.parseActiveFile();

        if (this.project !== oldProject || this.chapterName !== oldChapter) {
            this.chapterStateManager.reset();
            this.context = null;

            // 先恢复磁盘状态再加载上下文，避免自动提取的角色灵魂被磁盘模板覆盖
            await this.chapterStateManager.restoreChapterState(this.chapDir);
            await this.loadContext();
            await this.renderInContainer(this.tabContent);
        }
    }

    // ============================================================
    // Tab 系统（委托给 TabController）
    // ============================================================
    /**
     * 压入导航栈。
     *
     * @param tabId - 页签 ID
     */
    async pushNav(tabId: string): Promise<void> {
        await this.tabController.pushNav(tabId);
    }

    /**
     * 弹出导航栈。
     */
    popNav(): void {
        this.tabController.popNav();
    }

    private renderTabBar(): void {
        this.tabController.renderTabBar();
    }

    private async activateTab(tabId: string): Promise<void> {
        await this.tabController.activateTab(tabId);
    }

    /**
     * 命令层「项目与章节」入口：把工作台切回项目选择页。
     * 已在该页时重新扫描项目列表并提示，避免「点击没有任何反应」。
     */
    async showProjectSelector(): Promise<void> {
        if (this.activeTabId === 'project-selector') {
            await this.renderProjectSelectorInTab();
            showSuccessNotice('已刷新项目与章节', { timeout: 2000 });
            return;
        }
        await this.activateTab('project-selector');
    }

    /**
     * 关闭大纲树弹窗。
     */
    closeOutlineTreeModal(): void {
        if (this.outlineTreeModal) {
            this.outlineTreeModal.close();
            this.outlineTreeModal = null;
        }
    }

    /**
     * 关闭页签。
     *
     * @param tabId - 页签 ID
     */
    closeTab(tabId: string): void {
        this.tabController.closeTab(tabId);
    }

    private _calcResumeStepIndex(): number {
        return calcResumeIdx(this.stepCompleted);
    }

    private async renderTabContent(): Promise<void> {
        this.syncWorkbenchContext();
        await this.tabController.renderTabContent();
    }

    /**
     * 把界面当前项目/章节写回插件：快捷工具在工作台/项目页没有 activeFile，
     * 命令层（getActiveProject / getActiveChapterTarget）依赖这份上下文。
     */
    private syncWorkbenchContext(): void {
        if (this.project && this.chapterNum > 0) {
            this.plugin.setWorkbenchContext({
                project: this.project,
                volume: this.volume,
                chapterName: this.chapterName,
                chapterNum: this.chapterNum,
                chapDir: this.chapDir,
            });
        } else if (this.project) {
            this.plugin.setWorkbenchContext({
                project: this.project,
                volume: '',
                chapterName: '',
                chapterNum: 0,
                chapDir: '',
            });
        } else {
            this.plugin.setWorkbenchContext(null);
        }
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
    private async openChapterInCoWriting(project: string, chapter: { chapter: string; volume: string; file: TFile | null }): Promise<void> {
        const chapterNum = parseInt(chapter.chapter.match(/\d+/)?.[0] || '0', 10);
        if (!chapterNum) {
            showErrorNotice('无法解析章号，请检查章节命名', { title: '打开失败', timeout: 4000 });
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
            stepMeta: {},
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
            saveStepResult: async (key, content, meta) => { await this.stepRunner.saveStepResult(key, content, this.chapDir, this.chapterName, this.volume, meta); },
            renderInContainer: (c) => this.renderInContainer(c),
            refreshAfterStep: () => this.refreshAfterStep(),
            setIsLoading: (v) => {
                this.isLoading = v;
                if (!v) this.stepAbortController = null;
            },
            getAbortController: () => {
                if (!this.stepAbortController) this.stepAbortController = new AbortController();
                return this.stepAbortController;
            },
            refreshWorkspace: () => {},
            invalidateSteps: (keys, markStale) => this.chapterStateManager.invalidateSteps(keys, markStale),

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

    // ============================================================
    // 创作流程 / 单元写作页签
    // ============================================================

    /** 「创作流程」页签内容 */
    private async renderFlowTabContent(tab: WriterTab): Promise<void> {
        if (!this.tabContent || !tab.project) return;
        const mode = tab.mode ?? await resolveProjectMode(this.app, tab.project);
        if (tab.mode !== mode) this.state.updateTab(tab.id, { mode });
        this.state.setNavigationState({
            project: tab.project,
            chapterName: '',
            volume: '',
            chapDir: '',
            chapterNum: 0,
        });
        await this.flowPanelController.render(this.tabContent, tab.project, mode);
    }

    /** 短篇/剧本单元写作页签内容 */
    private async renderUnitTabContent(tab: WriterTab): Promise<void> {
        if (!this.tabContent || !tab.project) return;
        this.state.setNavigationState({
            project: tab.project,
            chapterName: '',
            volume: '',
            chapDir: '',
            chapterNum: 0,
        });
        await this.unitWriterController.render(this.tabContent, tab);
    }

    /**
     * 打开某项目的创作流程页签（不存在则创建）
     *
     * @param project - 项目（路径或对象）
     */
    public async openFlowTab(project?: string): Promise<void> {
        const target = project || this.project || this.plugin.getActiveProject() || '';
        if (!target) {
            await this.showProjectSelector();
            return;
        }
        const mode = await resolveProjectMode(this.app, target);
        rememberProjectMode(target, mode);
        ensureFlowTab(this.state, target, mode, false);
        await this.activateTab(flowTabId(target));
    }

    /**
     * 打开短篇/剧本的单元写作页签
     *
     * @param project - 项目（路径或对象）
     * @param unitNumber - 单元号
     * @param modeArg - 模式参数
     */
    public async openUnitTab(project: string, unitNumber: number, modeArg?: CreationMode): Promise<void> {
        if (!project || unitNumber <= 0) return;
        const mode = modeArg ?? await resolveProjectMode(this.app, project);
        if (mode === 'long') {
            await this.openFirstUnwrittenChapter(project);
            return;
        }
        rememberProjectMode(project, mode);
        ensureUnitTab(this.state, project, mode, unitNumber, false);
        await this.activateTab(unitTabId(project, unitNumber));
    }

    /** 「全部章节 / 全部节集」弹窗；短篇/剧本的点击会落到单元工作台 */
    private openAllUnits(project: string, mode: CreationMode): void {
        if (mode === 'long') {
            const chapters = sortChaptersByNumber(getChaptersForProject(this.app, project));
            this.projectSelectorController.showAllChapters(project, chapters, '章');
            return;
        }
        const units = listModeUnits(this.app, project, mode).map(unit => ({
            chapter: unit.unitName,
            volume: '',
            title: unit.title,
            status: unit.status,
            file: unit.file,
        }));
        this.projectSelectorController.showAllChapters(project, units, modeUnitLabel(mode));
    }

    /** 流程页「章节结算」：定位到第一条已写未结算的章节 */
    private async openSettlementTarget(project: string): Promise<void> {
        const chapters = sortChaptersByNumber(getChaptersForProject(this.app, project));
        const written = chapters.filter(chapter => chapter.written);
        const target = written.find(chapter => (chapter.status || '').toLowerCase() === 'written') ?? written[0];
        if (!target) {
            new Notice('还没有已写章节：先在「创作流程」里完成一章正文', 6000);
            return;
        }
        await this.selectChapter(project, target);
        showSuccessNotice('已定位到该章，可在步骤导航里执行「章节结算」', { timeout: 4000 });
    }

    // v3.4.9 委托: → project-utils.ts
    private getChaptersForProject(project: string): ChapterListEntry[] {
        return getChaptersForProject(this.app, project);
    }

    private async selectChapter(project: string, chapter: { chapter: string; volume: string; file: TFile | null }): Promise<void> {
        // 短篇/剧本的「章节」实际是节/集：统一进单元工作台，不再打开裸 Markdown
        const mode = await resolveProjectMode(this.app, project);
        if (mode !== 'long') {
            const unitNumber = parseInt(chapter.chapter.match(/第\s*(\d+)/)?.[1] || '0', 10);
            if (unitNumber > 0) {
                await this.openUnitTab(project, unitNumber, mode);
                return;
            }
        }
        if (project !== this.project || chapter.chapter !== this.chapterName) {
            this.executionStore.reset();
            this.lastRunProgressMessage = '';
        }
        await this.tabController.selectChapter(project, chapter);
    }

    /**
     * 从外部入口（章节列表、命令等）按路径直接定位章节。
     * 解析路径中的卷名与章名后复用 selectChapter，保证标签页/上下文与手动选择一致。
     * @param project - 项目（路径或对象）
     * @param chapterPath - 章节路径
     */
    async openChapterByPath(project: string, chapterPath: string): Promise<void> {
        // v4.25：外部调用方（Node/E2E/插件 API）可能传 Windows 反斜杠路径；
        // vault 内部路径永远是正斜杠，不归一化会「文件存在却找不到」且静默返回
        const normalized = String(chapterPath || '').split('\\').join('/');
        const file = this.app.vault.getAbstractFileByPath(normalized);
        if (!(file instanceof TFile)) {
            showErrorNotice('未找到章节文件，可能已被移动或删除', { timeout: 5000 });
            return;
        }
        const volume = chapterPath.match(/正文\/(第\d+卷)\//)?.[1] ?? '';
        // 正文可能被按标题重命名（第2章_锁痕_正文.md）：按「第N章」前缀反解，而不是要求紧贴 _正文
        const chapterName = file.basename.match(/^(第\d+章)/)?.[1] ?? file.basename;
        await this.selectChapter(project, { chapter: chapterName, volume, file });
    }

    private showAllChapters(project: string, chapters: ChapterListEntry[]): void {
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

    private getNextChapter(sortedChapters: ChapterListEntry[]): ChapterListEntry | null {
        return getNextChapter(sortedChapters);
    }

    /**
     * v3.4.6: 从向导完成后直接进入写作界面，打开第一个未完稿章节（短篇/剧本落到单元工作台）
     *
     * @param project - 项目（路径或对象）
     */
    async openFirstUnwrittenChapter(project: string): Promise<void> {
        try {
            const mode = await resolveProjectMode(this.app, project);
            if (mode !== 'long') {
                const units = listModeUnits(this.app, project, mode);
                const nextUnit = units.find(unit => unit.status !== 'written' && unit.status !== 'settled');
                if (nextUnit) {
                    await this.openUnitTab(project, nextUnit.number, mode);
                } else if (units.length > 0) {
                    await this.openUnitTab(project, units[0].number, mode);
                } else {
                    new Notice(`该项目还没有${modeUnitLabel(mode)}骨架，请在创作流程里创建`, 6000);
                    await this.openFlowTab(project);
                }
                return;
            }

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
                showWarningNotice('未找到章节文件，请先运行批量建章', { timeout: 5000 });
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('[小说工坊] 进入写作界面失败:', errMsg);
            showErrorNotice(errMsg, { title: '进入写作界面失败', timeout: 5000 });
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
            await ensureTemplateScaffold(this.app);
            const templateCopies = [
                { src: '元文件/00-系统模板/世界观模板.md', dst: `${projectName}/${SUBDIR_WORLDVIEW_FILE}` },
                { src: '元文件/00-系统模板/设定库模板.md', dst: `${projectName}/${SUBDIR_SETTING_LIB_FILE}` },
                { src: '元文件/00-系统模板/文笔风格模板.md', dst: `${projectName}/${SUBDIR_WRITING_STYLE_FILE}` },
            ];
            for (const { src, dst } of templateCopies) {
                if (!(await adapter.exists(dst)) && await adapter.exists(src)) {
                    const content = await adapter.read(src);
                    await writeVaultText(this.app, dst, content);
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
            
            showSuccessNotice(`项目 "${projectName}" 已创建，开始引导向导`, { timeout: 3000 });
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('Quick create project failed:', errMsg);
            showErrorNotice(errMsg, { title: '快速创建项目失败', timeout: 5000 });
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
            showWarningNotice(filePath, { title: '文件不存在', timeout: 4000 });
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

        // 上下文加载放在 try 内：loadContext 抛错时容器已被清空，
        // 旧实现在 catch 之外 await，失败后既不渲染也不提示，界面永久空白。
        try {
            if (!this.project) {
                await this.loadContext();
                return;
            }

            // 上下文未加载时自动加载；若刚失败过则等待用户点错误卡的「重试」，
            // 避免失败 → 重渲染 → 再加载的死循环。
            if (!this.stepCompleted.has('context') && this.chapterName && !this.executionStore.getFailure('context')) {
                await this.loadContext();
            }
            // 上下文加载失败（仍无 context），且没有章节可选，回退到项目选择器
            if (!this.stepCompleted.has('context') && !this.chapterName) {
                await this.renderProjectSelectorInTab();
                return;
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error('[小说工坊] 渲染前加载上下文失败:', e);
            this.executionStore.recordFailure(createStepFailure({
                stepKey: 'context',
                stepLabel: '上下文加载',
                message: `加载上下文失败：${message}`,
                kind: 'exception',
            }));
            const errorBox = container.createDiv({ cls: 'novel-writer-fw-container' });
            errorBox.createEl('p', {
                text: `⚠️ 加载上下文失败：${message}`,
                cls: 'novel-writer-fw-warning',
            });
            const retry = errorBox.createEl('button', { text: '🔄 重试', cls: 'novel-writer-fw-btn' });
            retry.onclick = () => {
                this.executionStore.clearFailure('context');
                void this.renderInContainer(container);
            };
            return;
        }

        try {
            const mainContainer = container.createDiv({ cls: 'novel-writer-fw-container' });
            this.mainContainer = mainContainer;  // 保存引用供 refreshContextBar 使用

            // 标题栏
            await this.renderTitleBar(mainContainer);
            this.mountExecutionPanels(mainContainer);

            // 三栏布局：步骤导航 | 正文写作 | 上下文监控。
            // layout-host 只用于窄屏容器查询：不能把 container-type 放在
            // .novel-writer-fw-container 上（里面的 fixed 执行日志会被 Containment 改锚点并裁掉）。
            const layoutHost = mainContainer.createDiv({ cls: 'novel-writer-fw-layout-host' });
            const workspace = layoutHost.createDiv({ cls: 'novel-writer-fw-workspace' });
            // 仅设置不影响响应式断点的基础尺寸；display/flex 方向交由 styles.css 控制，
            // 否则内联样式会压过 @container nw-fw 的窄屏单列规则（中栏滑块丢失根因）。
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
            } catch (e) { // silent-ok: 面板渲染是旁路，异常跳过不阻塞主流程
                log.warn('[小说工坊] 上下文面板渲染异常（已跳过）:', e);
                workspace.createDiv({ text: '⚠️ 上下文面板渲染失败', cls: 'novel-writer-fw-warning' });
            }
            // 三栏可拖拽：在两个翼与中栏之间插入分隔条（第 4 轮统一原语）
            this.initWorkspaceResizers(workspace);

            // 状态栏
            this.renderStatusBar(mainContainer);

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

    /**
     * 三栏工作区的左右分隔条（2026-10-29 第 4 轮）。
     *
     * 此前三栏用 grid + minmax 区间，宽度只能在设置页填数字；
     * 现在改为 flex + 两个分隔条，拖动即改并持久化到 panelSizes。
     */
    private initWorkspaceResizers(workspace: HTMLElement): void {
        const nav = workspace.querySelector<HTMLElement>('.novel-writer-fw-step-nav');
        const prompt = workspace.querySelector<HTMLElement>('.novel-writer-fw-prompt-area');
        const context = workspace.querySelector<HTMLElement>('.novel-writer-fw-context-panel');
        if (!nav || !prompt || !context) return;

        const settings = this.plugin.settings;
        const sizes = settings.panelSizes ?? (settings.panelSizes = {});

        const leftHandle = createPanelResizer({
            container: workspace,
            element: workspace.createDiv({ cls: 'nw-fw-resizer nw-fw-resizer-left' }),
            target: nav,
            side: 'before',
            unit: 'px',
            cssVar: '--nw-panel-nav',
            min: 100,
            max: 400,
            value: sizes.fwStepNav ?? 140,
            defaultValue: 140,
            ariaLabel: '拖动调整步骤导航宽度（方向键微调，双击复位）',
            onCommit: (width) => {
                sizes.fwStepNav = width;
                void this.plugin.saveSettings();
            },
        });
        workspace.insertBefore(leftHandle.el, prompt);

        const rightHandle = createPanelResizer({
            container: workspace,
            element: workspace.createDiv({ cls: 'nw-fw-resizer nw-fw-resizer-right' }),
            target: context,
            side: 'after',
            unit: 'px',
            cssVar: '--nw-panel-context',
            min: 160,
            max: 560,
            value: sizes.fwRightPanel ?? 220,
            defaultValue: 220,
            ariaLabel: '拖动调整上下文栏宽度（方向键微调，双击复位）',
            onCommit: (width) => {
                sizes.fwRightPanel = width;
                void this.plugin.saveSettings();
            },
        });
        workspace.insertBefore(rightHandle.el, context);

        this.workspaceResizers = [leftHandle, rightHandle];
    }

    // ============================================================
    // 左侧步骤导航
    // ============================================================
    private renderStepNav(workspace: HTMLElement): void {
        // D3: 委托至 StepRenderController（行为逐行等价）
        this.stepRenderController.renderStepNav(workspace);
    }

    // ============================================================
    // 步骤完成后的分片刷新（G6-5）
    // ============================================================

    /** 带 data-nw-region 的可刷新区域 */
    private stepRegion(parent: HTMLElement, name: string): HTMLElement {
        return parent.createDiv({ cls: 'novel-writer-fw-region', attr: { 'data-nw-region': name } });
    }

    /** 前置步骤提醒（完成前置后需要整块消失，所以单独成区） */
    private renderStepNotice(area: HTMLElement, currentStep: FullStep): void {
        if (currentStep.index < 2 || currentStep.index > 9) return;
        const stepPos = ALL_FULL_STEPS.findIndex(s => s.index === currentStep.index);
        const prevStep = stepPos > 0 ? ALL_FULL_STEPS[stepPos - 1] : undefined;
        const prevStepKey = prevStep?.key || (prevStep?.index === 0 ? 'context' : 'settlement');
        if (this.stepCompleted.has(prevStepKey)) return;
        const warning = area.createDiv({ cls: 'novel-writer-fw-warning' });
        warning.createSpan({ text: `⚠️ 建议先完成「${prevStep?.label ?? '前置'}」步骤，再执行当前步骤以确保数据连贯性。` });
    }

    /**
     * 步骤完成后的分片刷新。
     *
     * 旧实现每次都 renderInContainer(tabContent)：标题栏、执行日志浮层、阶段导航、
     * 上下文面板、三栏分隔条、状态栏全部重建，提示词编辑器的展开状态与滚动位置
     * 也会被重置。这里只重绘与本步结果相关的区域，其余 DOM 原样保留。
     * 实测（E2E STEP_REFRESH_CHURN）：分片 71 节点 / 整页 494 节点。
     *
     * 结构不完整（自动步骤/切页/旧渲染）时退回整页渲染：功能正确性优先。
     */
    private refreshAfterStep(): void {
        const area = this.workspace?.querySelector<HTMLElement>('.novel-writer-fw-prompt-area');
        const step = findStepByIndex(this.currentStepIndex);
        const stepKey = step?.key;
        const regionNames = ['notice', 'actions', 'status', 'planning', 'review', 'result', 'extras'];
        const missing = !area
            || !step
            || !stepKey
            || regionNames.some(name => !area.querySelector(`[data-nw-region="${name}"]`));
        if (missing || !area || !step || !stepKey) {
            void this.renderInContainer(this.tabContent);
            return;
        }

        const key = stepKey;
        this.replaceStepRegion(area, 'notice', region => this.renderStepNotice(region, step));
        this.replaceStepRegion(area, 'actions', region => this.renderStepActionBar(region, step, key));
        this.replaceStepRegion(area, 'status', region => this.renderExecutionStatus(region, key));
        this.replaceStepRegion(area, 'planning', region => {
            if (key === 'infoPlan') this.renderPlanningQuickStart(region);
        });
        this.replaceStepRegion(area, 'review', region => {
            if (key === 'qualityControl' || key === 'analysisReport') this.renderReviewPhaseTabs(region, key);
        });
        this.replaceStepRegion(area, 'result', region => this.renderResultArea(region, key));
        this.replaceStepRegion(area, 'extras', region => this.renderStepExtras(region, step, key));
        this.refreshStepNavState();
    }

    private replaceStepRegion(
        area: HTMLElement,
        name: string,
        render: (region: HTMLElement) => void,
    ): void {
        const region = area.querySelector<HTMLElement>(`[data-nw-region="${name}"]`);
        if (!region) return;
        region.empty();
        render(region);
    }

    /** 导航里的步骤完成标记：分片刷新不重建导航，但状态必须跟上 */
    private refreshStepNavState(): void {
        const nav = this.workspace?.querySelector<HTMLElement>('.novel-writer-fw-step-nav');
        if (!nav) return;
        const currentKey = findStepByIndex(this.currentStepIndex)?.key;
        nav.querySelectorAll<HTMLElement>('[data-nw-substep]').forEach(sub => {
            const key = sub.dataset.nwSubstep;
            if (!key) return;
            const done = this.stepCompleted.has(key);
            const partial = !done && (this.chapterStateManager.stepLevels[key] === 'partial' || Boolean(this.stepResults[key]));
            const icon = sub.querySelector<HTMLElement>('.novel-writer-fw-substep-icon');
            if (icon) icon.setText(done ? '✅' : partial ? '◐' : '○');
            sub.setAttr('title', done ? '已完成' : partial ? '部分完成' : '未执行');
            sub.toggleClass('novel-writer-fw-substep-active', key === currentKey);
        });
    }

    // ============================================================
    // 中间提示词工作区
    // ============================================================
    private async renderPromptArea(workspace: HTMLElement): Promise<void> {
        const area = workspace.createDiv({ cls: 'novel-writer-fw-prompt-area' });
        await this.renderPromptAreaInto(area);
    }

    /** 把当前步骤渲染进已存在的提示词区（整页渲染与步骤完成后的分片刷新共用） */
    private async renderPromptAreaInto(area: HTMLElement): Promise<void> {
        // 当前步骤信息
        const currentStep = findStepByIndex(this.currentStepIndex);
        if (!currentStep) {
            area.createEl('p', { text: '未知步骤', cls: 'novel-writer-fw-error-text' });
            return;
        }
        const stepKey = currentStep.key;

        if (!stepKey) {
            // 自动步骤（上下文加载 / 结算）同样展示时间线与错误卡，
            // 否则上下文缺项只能在浮层里一闪而过。
            this.renderExecutionStatus(area, currentStep.index === 0 ? 'context' : 'settlement');
            this.renderAutoStep(area, currentStep);
            return;
        }

        // 检查前置步骤是否完成，未完成则显示提醒（独立区域：步骤完成后可单独刷新移除）
        this.renderStepNotice(this.stepRegion(area, 'notice'), currentStep);

        const vars = await this.buildTemplateVars();
        this.vars = vars;

        // 唯一解析入口：vault 自定义 > 用户覆盖 > 内置；正文 V2/V3/V4 由 resolver 统一选择。
        const template = await resolveStepPrompt(this.app, stepKey, vars);
        if (!template) {
            area.createEl('h3', { text: currentStep.label });
            area.createEl('p', { text: '未知步骤', cls: 'novel-writer-fw-error-text' });
            return;
        }

        // 步骤描述
        const header = area.createDiv({ cls: 'novel-writer-fw-step-header' });
        const headerTitle = header.createEl('h3');
        headerTitle.createSpan({ text: currentStep.label });
        if (currentStep.deprecated) {
            headerTitle.createSpan({ text: ' 〔旧〕', attr: { style: 'color:var(--text-muted); font-size:0.7em; font-weight:400;' } });
        }
        header.createEl('p', { text: template.description, cls: 'novel-writer-fw-step-desc' });

        // 操作栏紧跟标题，避免用户每次滚过整段提示词才能点到生成按钮。
        // 每个动态区块都带 data-nw-region：步骤完成后只重绘这些块（G6-5）。
        this.renderStepActionBar(this.stepRegion(area, 'actions'), currentStep, stepKey);
        this.renderExecutionStatus(this.stepRegion(area, 'status'), stepKey);

        // 区域先建再填：非 infoPlan/质控步骤也要有占位，否则分片刷新只能退回整页渲染
        const planningRegion = this.stepRegion(area, 'planning');
        if (stepKey === 'infoPlan') {
            this.renderPlanningQuickStart(planningRegion);
        }

        const reviewRegion = this.stepRegion(area, 'review');
        if (stepKey === 'qualityControl' || stepKey === 'analysisReport') {
            this.renderReviewPhaseTabs(reviewRegion, stepKey);
        }

        // 结果优先展示：先让用户看到本步实际产出，再决定是否展开提示词编辑。
        this.renderResultArea(this.stepRegion(area, 'result'), stepKey);

        const systemPromptValue = template.systemPrompt;
        const userPromptValue = template.userPrompt;
        this.systemPromptEl = this.renderPromptEditor(area, '系统提示词', systemPromptValue, 12);
        this.userPromptEl = this.renderPromptEditor(area, '用户提示词', userPromptValue, 15);

        // 步骤级附加操作（消痕/精修/定向修订/人味体检）+「继续下一步」，
        // 同样独立成区：步骤完成时只重绘这里，不动提示词编辑器。
        this.renderStepExtras(this.stepRegion(area, 'extras'), currentStep, stepKey);
    }

    /** 步骤完成后的附加按钮区（消痕/精修/定向修订/人味体检 + 继续下一步） */
    private renderStepExtras(area: HTMLElement, currentStep: FullStep, stepKey: string): void {
        // 正文完成后：在正文及其后的质控/分析/结算步骤都保留消痕与迭代入口
        // （旧实现只在当前步骤正好是 bodyGeneration 时显示，自动推进后按钮立刻消失）
        if (currentStep.index >= 7 && this.stepCompleted.has('bodyGeneration')) {
            const deaiBtnRow = area.createDiv({ cls: 'novel-writer-fw-btn-row' });
            
            const deaiBtn = deaiBtnRow.createEl('button', {
                text: '🧹 AI 消痕改写',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            deaiBtn.onclick = () => {
                deaiBtn.disabled = true;
                void this.stepRunner.executeDeaiRewrite(
                    this.stepResults,
                    (c) => this.renderInContainer(c),
                    this.tabContent,
                    (v) => { this.isLoading = v; },
                    this.chapDir,
                    this.chapterName,
                    this.volume,
                    this.stepCompleted,
                ).catch((e) => {
                    log.error('[小说工坊] 消痕入口失败:', e);
                    showErrorNotice(`消痕失败：${e instanceof Error ? e.message : String(e)}`, { timeout: 6000 });
                }).finally(() => { deaiBtn.disabled = false; });
            };

            const refineBtn = deaiBtnRow.createEl('button', {
                text: '🔁 自动迭代精修',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            refineBtn.onclick = () => {
                refineBtn.disabled = true;
                void this.stepRunner.executeIterativeRefine(
                    this.stepResults,
                    this.vars,
                    this.chapterNum,
                    () => this.buildTemplateVars(),
                    (c) => this.renderInContainer(c),
                    this.tabContent,
                    (v) => { this.isLoading = v; },
                    this.chapDir,
                    this.chapterName,
                    this.volume,
                    this.stepCompleted,
                ).catch((e) => {
                    log.error('[小说工坊] 迭代精修入口失败:', e);
                    showErrorNotice(`迭代精修失败：${e instanceof Error ? e.message : String(e)}`, { timeout: 6000 });
                }).finally(() => { refineBtn.disabled = false; });
            };

            const targetedBtn = deaiBtnRow.createEl('button', {
                text: '🎯 定向修订',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary'
            });
            targetedBtn.onclick = async () => {
                targetedBtn.disabled = true;
                targetedBtn.setText('修订中...');
                try {
                    await this.stepRunner.executeTargetedRevision(
                        this.stepResults,
                        this.chapDir,
                        this.chapterName,
                        this.volume,
                        this.stepCompleted,
                        extractCharacterNames(this.vars?.allChars),
                    );
                } finally {
                    targetedBtn.disabled = false;
                    targetedBtn.setText('🎯 定向修订');
                    await this.renderInContainer(this.tabContent);
                }
            };

            const humanizeBtn = deaiBtnRow.createEl('button', {
                text: '📊 人味体检',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-secondary',
            });
            humanizeBtn.onclick = () => {
                const bodyText = this.stepResults['bodyGeneration'] || '';
                if (!bodyText.trim()) {
                    new Notice('当前还没有正文结果，先生成本章正文。');
                    return;
                }
                void import('./humanize-report-modal').then(({ HumanizeReportModal }) => {
                    new HumanizeReportModal(this.app, {
                        bodyText,
                        onApply: async (nextText) => {
                            this.stepResults['bodyGeneration'] = nextText;
                            const saved = await this.stepRunner.saveStepResult(
                                'bodyGeneration',
                                nextText,
                                this.chapDir,
                                this.chapterName,
                                this.volume,
                            );
                            if (!saved) throw new Error('正文保存失败');
                            await this.renderInContainer(this.tabContent);
                        },
                    }).open();
                });
            };
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
        try {
            // 打开已结算章节时，内存里可能没有 bodyGeneration：从正文文件回填，
            // 否则 PolishEditor 会静默 return，用户看到的就是「润色完全失效」。
            if (!this.stepResults['bodyGeneration'] && this.project) {
                const volN = parseInt(this.volume.match(/\d+/)?.[0] || '0', 10);
                const bodyFile = findBodyFileV4(this.app, this.project, volN, this.chapterNum);
                if (bodyFile instanceof TFile) {
                    this.stepResults['bodyGeneration'] = await this.app.vault.read(bodyFile);
                }
            }
            if (!this.stepResults['bodyGeneration']) {
                area.createEl('p', {
                    text: '⚠️ 未找到正文内容，无法打开润色编辑器。请先完成正文生成或打开本章正文。',
                    cls: 'novel-writer-fw-error-text',
                });
                return;
            }
            await this.polishEditor.render(
                area, this.stepResults, this.project, this.chapDir, this.chapterName, this.volume,
                () => {
                    // A7: 润色自动保存写回正文 → 下游审查/分析/结算失效（与手动保存正文口径一致）
                    this.chapterStateManager.invalidateSteps([...BODY_CHANGE_INVALIDATED_STEPS]);
                },
            );
        } catch (e) {
            log.error('[小说工坊] 渲染润色编辑器失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '润色编辑器加载失败', timeout: 6000 });
            const retry = area.createEl('button', { text: '🔄 重试加载润色编辑器', cls: 'novel-writer-fw-btn' });
            retry.onclick = () => {
                retry.disabled = true;
                void this.renderPolishEditor(area).finally(() => { retry.disabled = false; });
            };
        }
    }

    private renderExecutionStatus(area: HTMLElement, stepKey: string): void {
        this.timelinePanel?.destroy();
        this.timelinePanel = new ExecutionTimelinePanel(this.executionStore, {
            onRetry: (key) => void this.retryFailedStep(key),
            onOpenLog: () => this.openExecutionLog(),
        });
        this.timelinePanel.mount(area);

        const currentFailure = this.executionStore.getFailure(stepKey);
        if (currentFailure) {
            renderStepFailureCard(area, currentFailure, {
                onRetry: (key) => void this.retryFailedStep(key),
                onOpenLog: () => this.openExecutionLog(),
            });
        }
    }

    private renderStepActionBar(area: HTMLElement, currentStep: FullStep, stepKey: string): void {
        const bar = area.createDiv({ cls: 'nw-step-actionbar' });
        const status = bar.createDiv({ cls: 'nw-step-actionbar-status' });
        const failure = this.executionStore.getFailure(stepKey);
        const done = this.stepCompleted.has(stepKey);
        const hasResult = (this.stepResults[stepKey] || '').trim().length > 0;

        status.createSpan({ text: currentStep.label, cls: 'nw-step-actionbar-title' });
        const chip = status.createSpan({
            text: failure ? '执行失败' : done ? '已完成' : '未完成',
            cls: 'nw-step-status-chip',
        });
        chip.addClass(failure ? 'nw-step-status-error' : done ? 'nw-step-status-done' : 'nw-step-status-pending');

        const actions = bar.createDiv({ cls: 'nw-step-actions' });
        const runStep = () => {
            void this.stepRunner.executeCurrentStep(this._makeStepRunCtx());
        };

        if (stepKey === 'bodyGeneration') {
            const cowriteBtn = actions.createEl('button', {
                text: '✨ 进入句级协同写作',
                cls: 'nw-step-action nw-step-action-cowrite',
                attr: { title: '逐句生成候选并确认，推荐用于正文' },
            });
            cowriteBtn.addEventListener('click', () => this.openCurrentChapterInCoWriting());

            const draftBtn = actions.createEl('button', {
                text: done ? '🔄 重新生成整章' : '🤖 整章草稿（可选）',
                cls: 'nw-step-action nw-step-action-primary',
                attr: { title: '一次生成整章草稿；出现错误时结果与错误卡会显示在下方' },
            });
            draftBtn.addEventListener('click', runStep);
        } else {
            const label = failure
                ? '🔄 重新生成本步'
                : done
                    ? '🔄 重新生成'
                    : hasResult
                        ? '🚀 继续生成'
                        : '🚀 生成此步';
            const runBtn = actions.createEl('button', {
                text: label,
                cls: 'nw-step-action nw-step-action-primary',
                attr: { title: '使用下方提示词执行本步；错误会直接显示在本步位置' },
            });
            runBtn.addEventListener('click', runStep);
        }

        if (currentStep.canSkip) {
            const skipBtn = actions.createEl('button', {
                text: '跳过',
                cls: 'nw-step-action nw-step-action-ghost',
                attr: { title: '跳过本步' },
            });
            skipBtn.addEventListener('click', () => this.stepRunner.moveToNextStep(this._makeStepRunCtx()));
        }

        const params = bar.createDiv({ cls: 'nw-step-params' });
        params.createSpan({ text: '温度', cls: 'nw-step-params-label' });
        const tempValue = this.stepTemperature.toFixed(1);
        this.temperatureSlider = params.createEl('input', {
            type: 'range',
            cls: 'nw-step-temp-slider',
            attr: { min: '0.1', max: '2.0', step: '0.1', value: tempValue },
        }) as HTMLInputElement;
        this.temperatureValueEl = params.createSpan({ text: tempValue, cls: 'nw-step-temp-value' });
        this.temperatureSlider.oninput = () => {
            // 记住用户的值：任何一次重渲染（保存/切步/错误卡刷新）都不能重置成默认 1.4
            this.stepTemperature = parseFloat(this.temperatureSlider.value) || 1.4;
            this.temperatureValueEl.setText(this.stepTemperature.toFixed(1));
        };
    }

    private renderPromptEditor(area: HTMLElement, label: string, value: string, rows: number): HTMLTextAreaElement {
        const effective = value.trim();
        const details = area.createEl('details', { cls: 'novel-writer-fw-prompt-section nw-prompt-collapsible' });
        const summary = details.createEl('summary', { cls: 'novel-writer-fw-label' });
        summary.createSpan({ text: label });
        summary.createSpan({
            text: effective.length > 0 ? `${effective.length} 字 · 点击展开编辑` : '模板为空 · 点击展开查看',
            cls: 'nw-prompt-summary-meta',
        });
        const textarea = details.createEl('textarea', {
            cls: 'nw-textarea novel-writer-fw-textarea',
            attr: { rows: String(rows) },
        }) as HTMLTextAreaElement;
        textarea.value = value;
        return textarea;
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
    /**
     * 回填设定库。
     */
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

    /**
     * 外部（如对话引导 Agent）打开指定项目的向导。
     * @param project - 项目（路径或对象）
     */
    public async openWizardForProjectById(project: string): Promise<void> {
        await this.wizardController.openWizardForProject(project);
    }

    /**
     * refreshContextBar 方法。
     */
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
                    // 全部完成时 force=true 才是真正的“重新生成全部”
                    await this.stepRunner.executePlanningCombined(this._makeStepRunCtx(), { force: allDone });
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
                // 5 个规划步骤齐全才进入正文；缺任何一步都停在第一个缺失步骤，避免残缺规划写正文
                const missing = planningSteps.filter(s => !this.stepCompleted.has(s.key));
                if (missing.length === 0) {
                    this.chapterStateManager.currentStepIndex = 7;
                    this.executionStore.addEvent({ type: 'run-complete', level: 'success', message: '全章规划完成，已进入正文写作' });
                } else {
                    const first = ALL_FULL_STEPS.find(s => s.key === missing[0].key);
                    if (first) this.chapterStateManager.currentStepIndex = first.index;
                    this.executionStore.addEvent({
                        type: 'run-warning',
                        level: 'warning',
                        message: `规划仍缺少：${missing.map(s => s.label).join('、')}，已停在缺失步骤`,
                        stepKey: missing[0].key,
                        stepLabel: missing[0].label,
                    });
                }
            } catch (e) {
                // P1-18（v4.27）：失败必须可见——旧实现只 console.error，
                // 渲染再抛错时按钮会永久停在「生成中」，用户看不到原因。
                const message = e instanceof Error ? e.message : String(e);
                log.error('[Planning] 一键生成失败:', e);
                this.executionStore.addEvent({
                    type: 'run-error',
                    level: 'error',
                    message: `全章规划失败：${message}`,
                });
                showErrorNotice(message, { title: '全章规划失败', timeout: 8000 });
            } finally {
                generateBtn.disabled = false;
                generateBtn.setText('⚡ 重新生成全章规划');
                try {
                    await this.renderInContainer(this.tabContent);
                } catch (renderError) {
                    log.error('[Planning] 失败后重渲染异常:', renderError);
                }
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
    private async callInterventionUnderstandingAPI(userInput: string): Promise<unknown> {
        // 已迁移至 InterventionController，保留空实现防止引用错误
        return null;
    }

    /**
     * 渲染理解报告
     */
    private renderUnderstandingReport(report: unknown): void {
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

    /**
     * 世界观是否完整。
     *
     * @param project - 项目（路径或对象）
     * @returns 布尔值
     */
    async checkWorldviewComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkWorldviewComplete(project);
    }

    private async autoFillWorldviewNames(project: string, file: TFile, content: string): Promise<void> {
        return this.wizardChecker.autoFillWorldviewNames(project, file, content);
    }

    private async renameProjectFolder(oldPath: string, newName: string): Promise<void> {
        return this.wizardChecker.renameProjectFolder(oldPath, newName);
    }

    /**
     * 设定库是否完整。
     *
     * @param project - 项目（路径或对象）
     * @returns 布尔值
     */
    async checkSettingLibComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkSettingLibComplete(project);
    }

    /**
     * 文笔风格是否完整。
     *
     * @param project - 项目（路径或对象）
     * @returns 布尔值
     */
    async checkWritingStyleComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkWritingStyleComplete(project);
    }

    /**
     * 实体是否完整。
     *
     * @param project - 项目（路径或对象）
     * @returns 布尔值
     */
    async checkEntitiesComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkEntitiesComplete(project);
    }

    /**
     * 大纲是否完整。
     *
     * @param project - 项目（路径或对象）
     * @returns 布尔值
     */
    async checkOutlineComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkOutlineComplete(project);
    }

    private async checkChaptersComplete(project: string): Promise<boolean> {
        return this.wizardChecker.checkChaptersComplete(project);
    }

}
