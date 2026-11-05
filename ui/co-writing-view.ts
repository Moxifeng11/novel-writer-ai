/**
 * co-writing-view.ts — 句级协同写作视图 (v5.0)
 *
 * 交互闭环：Tab 生成建议 → 接受/编辑 → AI 验证 → 完成度调整方向。
 * （本文件为运行时恢复重建版，逻辑与上一个可用构建一致）
 */

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, TFile } from 'obsidian';
import { SUBDIR_STEP_ROOT, pjBodyFile } from '@/shared/paths';
import { volumeNumber } from '@/shared/chapter-target';
import { CHAPTER_FILE_TYPES, findBodyFileV4 } from '@/engine/chapter-utils';

import NovelWriterPlugin from '@/main';
import { CoWriterEngine, resolveCoWriteLocalModel } from '@/engine/co-writer-engine';
import type { ChapterBriefInput } from '@/engine/chapter-brief';
import { CoWriteFacade } from './services/co-write-facade';
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import { WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import { EndingTractionEngine } from '@/engine/ending-traction-engine';
import { EmotionCurveView } from './components/emotion-curve-view';
import { renderAIDetectionReport } from './components/ai-detection-report';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from './components/notice-helpers';
import { ChapterSettlementModal } from './chapter-settlement-modal';

import { SuggestionEditModal } from './cowrite/suggestion-edit-modal';
import { IterateInstructionModal } from './cowrite/iterate-instruction-modal';
import { HistoryModal } from './cowrite/history-modal';
import { MemoryManagerModal } from './cowrite/memory-manager-modal';
import { RefillModal } from './refill-modal';
import { OutlineExpandModal } from './outline-expand-modal';
import { LiveAnalysisController } from './cowrite/live-analysis-controller';
import type { PlotEvalGateState } from '@/shared/plot-eval-throttle';
import { captureScrollSnapshot, resolveRestoredScrollTop } from '@/shared/preview-scroll';
import { AdaptiveDebounceManager } from '@/shared/adaptive-debounce-manager';
import { getCustomFontFamilies, registerAllCustomFonts, SYSTEM_FONT_PRESETS } from '@/services/font-manager';
import { FontManagerModal } from './font-manager-modal';
import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from './model-quick-switcher';
import { SuggestionHistoryStore } from './cowrite/suggestion-history-store';
import { BodySaveController } from './cowrite/body-save-controller';
import { buildMarkdownToolbar } from './co-writing/markdown-toolbar';
import { parseQualityReport, type QualityIssue } from './co-writing/quality-report';
import {
    buildQualityFixPrompt,
    locateQualityTarget,
    resolveQualityFixApplication,
} from './co-writing/quality-fix';
import {
    clearStreamingPreview,
    ensureStreamingPreview,
    renderAssociationCards,
    renderAssociationLoading,
    renderStreamingSuggestionCard,
    renderSuggestionCards,
    renderValidationResult,
    updateStreamingPreview,
    type SuggestionCardActions,
} from './co-writing/suggestion-cards';
import {
    renderEmptySuggestionMessage,
    renderValidationLoadingMessage,
    showKnowledgeInjectionNotice as showKnowledgeNotice,
} from './co-writing/suggest-feedback';
import { renderSuggestionLoading } from './co-writing/suggestion-loading';
import {
    hideQualityPopup,
    scrollToTextInEditor,
    showQualityContextMenu,
    showQualityPopup,
} from './co-writing/quality-popup';
import { resolveInsertRange, type PendingRewriteRange } from './cowrite/insert-range';
import { BodyWriter } from '@/engine/body-writer';
import {
    DEFAULT_BODY_FORMAT,
    INDENT_TWO_FULL_WIDTH,
    type BodyFormatContract,
} from '@/shared/body-format';
import {
    countParagraphs,
    describeContractShort,
    formatNovelManuscript,
    type TextEdit,
} from '@/shared/novel-format';
import { applyNwScope } from '@/utils/helpers';
import {
    associationToSuggestion,
    emptyMetrics
} from './cowrite/cowrite-mappers';
import { NovelAnalysisModal } from './novel-analysis-modal';
import { BatchImportModal } from './batch-import-modal';
import { KnowledgeMonitorModal } from './knowledge-monitor-modal';
import { UnifiedEntityManagerModal } from './unified-entity-manager-modal';
import {
    SuggestionRecord,
    SuggestionDirection,
    EditValidation,
    PlotCompletionMetrics,
    SentenceEditRecord
} from '@/shared/types';
import { VIEW_TYPE_MONITOR_B } from './monitor-panel-b';
import { AssociationSuggestion } from '@/shared/co-writer-types';
import { ProgressEmitter, type ProgressState } from '@/shared/progress-emitter';
import { StepListComponent } from './components/progress/step-list';
import { TimeEstimator } from '@/shared/time-estimator';
import { RealtimeMonitor } from '@/engine/quality/realtime-monitor';
import { QualityScoreEngine, type CharacterContextInfo } from '@/engine/quality/quality-score-engine';
import { toCharacterContextInfos } from '@/engine/character-context';
import { toForeshadowTrackings, applyPlannedRevealChapters } from '@/engine/foreshadow-context';
import { createPlotDivergenceEngine, createWritingQualityEngine } from '@/engine/quality/quality-engine-factory';

import { CharacterConsistencyChecker } from '@/engine/character-consistency-checker';
import {
    DeviationDetector,
    type ForeshadowTracking,
} from '@/engine/quality/deviation-detector';
import { createLogger } from '@/shared/logger';
import { calculateHumanRate, renderHumanRate, type HumanRateScores } from '@/ui/co-writing/human-rate';
import { getAssetStatus, getCompletenessIcon, renderAssetStatusBar } from '@/ui/co-writing/asset-status';
import { getFriendlyErrorMessage } from '@/ui/co-writing/friendly-error';
import {
    buildBodyDir,
    buildStepFilePath,
    buildStepResultDirs,
    ensureVaultFolder,
    extractChapterTitleFromInfoPlan,
    extractChapterTitleFromOutline,
    isSameChapterIdentity,
} from '@/ui/co-writing/chapter-context';
import { renderGhostSuggestion, resolveGhostTrigger } from '@/ui/co-writing/ghost-association';
import { canColdStart, renderBriefPanel, updateStartButtonState } from '@/ui/co-writing/brief-panel';
import { renderHumanRatePanel, renderStatusBar, updateHumanRatePanel, updateSaveStateDisplay } from '@/ui/co-writing/dashboard-status';
import {
    adjustReferenceWeight,
    setPrimaryReference,
    toggleReferenceBook,
    type KbReferenceHost,
} from '@/ui/co-writing/kb-reference-config';
import { isImeComposingEvent, resolveEditorShortcut } from '@/ui/co-writing/editor-shortcuts';
import { applyQualityHighlights } from '@/ui/co-writing/quality-highlight';
import {
    createScoreCard as createScoreCardFn,
    renderMetricBar as renderMetricBarFn,
    renderMetrics as renderMetricsFn,
    renderMetricsInto as renderMetricsIntoFn,
    type MetricsRenderHost,
} from '@/ui/co-writing/metrics-render';
import {
    checkSettlementDue as checkSettlementDueFn,
    completeChapter,
    markAsWritten as markAsWrittenFn,
    runSettlementConflictCheck as runSettlementConflictCheckFn,
    type SettlementActionsHost,
} from '@/ui/co-writing/settlement-actions';
import {
    runStreamSuggestion,
    runTabSuggest,
    type SuggestionFlowHost,
} from '@/ui/co-writing/suggestion-flow';
import { renderMonitorCards, type ForeshadowSnapshot } from '@/ui/co-writing/monitor-cards';
import { runMetricsRefresh, type MetricsRefreshHost } from '@/ui/co-writing/metrics-refresh';
import { resolveChapterIdentity, stripChapterBody } from '@/ui/co-writing/chapter-switch';
import { handleMarkdownShortcut } from '@/ui/co-writing/markdown-shortcut';
import {
    refreshAdviceInto,
    refreshMatchInto,
    refreshQuoteInto,
    renderAdviceTabContent,
    renderBookList,
    renderBooksTabContent,
    renderMatchTabContent,
    renderQuoteTabContent,
    type KbPanelHost,
} from '@/ui/co-writing/kb-panel';
import { createPanelResizer, type PanelResizerHandle } from './panel-resizer';
import { DEVIATION_CHARACTER_INFO_TTL_MS, GHOST_ASSOCIATION_MIN_INTERVAL_MS } from '@/shared/thresholds';
import { resolveCursorPosition } from '@/shared/cursor-position';
import { describePrerequisiteGaps, PREREQ_MIN_BODY_CHARS, type PrerequisiteCheck } from '@/shared/prereq-check';
import { buildQualityChapterKey } from '@/shared/quality-history';
import { RealtimeQualityController } from './cowrite/realtime-quality-controller';
import { isImeComposing } from '@/shared/keyboard';



import { withButtonBusy } from './button-busy';
const log = createLogger('CoWritingView');

/** 质量问题结构定义（实现见 co-writing/quality-report.ts；保留本文件既有导出路径兼容外部引用）。 */
export type { QualityIssue } from './co-writing/quality-report';

/**
 * VIEW_TYPE_CO_WRITE 常量。
 */
export const VIEW_TYPE_CO_WRITE = 'novel-writer-co-writing';

/**
 * CoWritingView 类。
 */
export class CoWritingView extends ItemView {
  plugin: NovelWriterPlugin;
  engine: CoWriterEngine;
  facade: CoWriteFacade;
  mainContainer!: HTMLElement;
  centerPanel!: HTMLElement;
  resizerEl!: HTMLElement;
  /** 统一拖拽原语句柄（第 4 轮迁移） */
  private layoutResizer: PanelResizerHandle | null = null;
  previewContent!: HTMLElement;
  rightEditor!: HTMLTextAreaElement;
  /** 编辑器容器（前置规划警告横幅挂在此处，才真正位于编辑器上方） */
  private editorWrapEl: HTMLElement | null = null;
  hintInput!: HTMLInputElement;
  suggestionContainer!: HTMLElement;
  suggestionContent!: HTMLElement;
  suggestionStatusText!: HTMLElement;
  ghostSuggestionContainer!: HTMLElement;
  metricsContainer!: HTMLElement;
  statusBar!: HTMLElement;
  wordCountDisplay!: HTMLElement;
  wordGoalDisplay!: HTMLElement;
  saveStateDisplay!: HTMLElement;
  warningContainer!: HTMLElement;
  // A1+D1: OOC警告 + 实体状态变更
  tractionContainer!: HTMLElement;
  // v6.4: 质量控制报告面板
  qualityReportContainer!: HTMLElement;
  qualityIssues: QualityIssue[] = [];
  qualityReportPopup: HTMLElement | null = null;
  private isQualityReportLoading = false;
  // v6.4: 浮窗监控面板
  floatingPanel!: HTMLElement;
  floatingBody!: HTMLElement;
  floatingMetricsSection!: HTMLElement;
  floatingQualitySection!: HTMLElement;
  // 监控面板容器
  monitorContainer!: HTMLElement;
  // D4: 情节牵引
  // v5.1 引擎实例
  tractionEngine: EndingTractionEngine | null = null;
  project = "";
  /** openChapter 代次：快速连切两章时，旧链在关键 await 后必须退出 */
  private openChapterSeq = 0;
  chapterName = "";
  chapterNum = 1;
  volume = "\u7B2C1\u5377";
  cursorHint = "";
  isSuggesting = false;
  isAssociating = false;
  currentSuggestions: SuggestionRecord[] = [];
  ghostSuggestion: SuggestionRecord | null = null;
  currentRecord: SentenceEditRecord | null = null;
  suggestionHistory: SentenceEditRecord[] = [];
  historyLoaded = false;
  /**
   * 改写候选对应的原选区。
   * 旧实现声明了同名字段却从未写入，采纳改写结果时一律读当前光标：
   * 用户在候选生成后点过别处，候选就被插到错误位置、原文留在原地。
   */
  pendingRewriteRange: PendingRewriteRange | null = null;
  /** 采纳进行中：防止双击「接受」/ 连按 Ctrl+1 重复插入同一段文本 */
  acceptInFlight = false;
  /**
   * 联想代次（独立于 suggestionEpoch）。
   * 旧实现用 suggestionEpoch 判断是否复位 isAssociating：
   * 联想在途时按 Tab 生成建议会递增该代次，于是 finally 永远不复位，
   * 之后手动联想与幽灵建议一起失效，直到切章。
   */
  private associationSeq = 0;
  lastSuggestAt = 0;
  lastPreviewAt = 0;
  /** 预览渲染代次：MarkdownRenderer 是异步的，旧渲染不得把内容写进新一章/新一轮 */
  private previewSeq = 0;
  /** 预览节流的尾随渲染定时器（窗口内被节流的刷新不能直接丢弃） */
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上次剧情完成度 AI 评估的章节身份 / 正文签名 / 时间，用于跳过无意义的重复请求 */
  private lastPlotEval: PlotEvalGateState | null = null;
  lastTractionAt = 0;
  private ghostDebounceManager = new AdaptiveDebounceManager({ debug: false });
  private autoSaveDebouncer = new AdaptiveDebounceManager({ debug: false });
  private bodySaveController: BodySaveController;
  /** Markdown 编辑器：当前项目的正文格式契约（写作规则推导） */
  private editorContract: BodyFormatContract = DEFAULT_BODY_FORMAT;
  private editorContractProject = '';
  private bodyWriter: BodyWriter | null = null;
  private mdStatusEl: HTMLElement | null = null;
  private mdStatusModeEl: HTMLElement | null = null;
  private mdStatusContractEl: HTMLElement | null = null;
  private mdStatusWordsEl: HTMLElement | null = null;
  private mdStatusParagraphsEl: HTMLElement | null = null;
  lastGhostSeed = "";
  /** 上一次自动联想请求的时间（0 = 尚未请求）：慢速打字时限频，避免每次停顿都打 AI */
  private lastGhostRequestAt = 0;
  /** 已提示过的同人设定加载失败（项目 + 文案），避免每次打开章节重复弹窗 */
  private lastFanficWarningKey = "";
  liveAnalysis!: LiveAnalysisController;
  historyStore!: SuggestionHistoryStore;
  private suggestAbortController: AbortController | null = null;  // v6.3: 防重复请求
  private metricsAbortController: AbortController | null = null;
  metricsStatus: 'idle' | 'evaluating' | 'error' = 'idle';
  private suggestBtn: HTMLButtonElement | null = null;  // BUG-K fix: 建议按钮引用，用于禁用态
  private briefContent: HTMLElement | null = null;  // 本章简报容器（承接规划成果）
  private briefSummaryEl: HTMLElement | null = null;
  private nextNodeBtn: HTMLButtonElement | null = null;  // v6.4: 推进下一节点按钮引用
  private modelToggleBtn: HTMLButtonElement | null = null;  // v7.2: 模型切换按钮引用
  private precisionModeBtn: HTMLButtonElement | null = null;
  /** 顶栏模型快速切换器（原右下角状态栏浮窗的替代入口） */
  private modelSwitcher: ModelQuickSwitcherHandle | null = null;
  private humanRateDashboard: HTMLElement | null = null;
  private assetStatusBar: HTMLElement | null = null;
  // D2: 实时质量评估管线（评估编排 / 偏离上下文 / 顶栏 / 落盘节流）
  private realtimeQuality: RealtimeQualityController;
  private qualityMonitorBtn: HTMLButtonElement | null = null;
  /** 偏离检测用的人物设定缓存（按项目 + 60s TTL，避免每次评估都全量读人物文件） */
  private characterInfoCache: { project: string; at: number; list: CharacterContextInfo[] } | null = null;
  /** 偏离检测用的伏笔追踪缓存（按项目 + 60s TTL，与人物档案同为项目级静态数据） */
  private foreshadowCache: { project: string; at: number; list: ForeshadowTracking[] } | null = null;

  // v7.3: 进度增强相关
  private suggestProgressEmitter: ProgressEmitter | null = null;
  private suggestStepList: StepListComponent | null = null;
  private suggestProgressContainer: HTMLElement | null = null;
  private suggestCancelBtn: HTMLButtonElement | null = null;
  private suggestRetryBtn: HTMLButtonElement | null = null;
  private suggestErrorContainer: HTMLElement | null = null;
  private suggestEtaDisplay: HTMLElement | null = null;
  private timeEstimator: TimeEstimator | null = null;
  private lastSuggestError: string | null = null;
  private lastSuggestParams: { precedingText: string; cursorHint: string; mode: string; count: number } | null = null;
  // NBI-03: 流式候选预览容器与卡片引用（按候选索引隔离更新）
  private suggestStreamingContainer: HTMLElement | null = null;
  private streamingPreviewCards: HTMLElement[] = [];
  // NBI-04: 临时指令应用状态标识
  private appliedHint: string | null = null;
  private hintStateDisplay: HTMLElement | null = null;
  // NBI-05: 建议上下文代次，切章或新请求开始即递增，异步结果仅在代次一致时写回
  private suggestionEpoch = 0;

  // 知识库 Tab 相关
  private rightTabContainer!: HTMLElement;
  private rightTabHeaders!: HTMLElement;
  private rightTabContents!: HTMLElement;
  private overviewTabContent!: HTMLElement;
  private knowledgeTabContent!: HTMLElement;
  private activeRightTab: 'overview' | 'knowledge' = 'overview';

  // 知识库子 Tab
  private kbSubTabContent!: HTMLElement;
  private activeKbSubTab: 'books' | 'match' | 'quote' | 'advice' = 'books';
  private kbBookListContainer!: HTMLElement;
  private kbBookSearchInput!: HTMLInputElement;
  private kbMatchContainer!: HTMLElement;
  private kbQuoteContainer!: HTMLElement;
  private kbAdviceContainer!: HTMLElement;
  private expandedBookId: string | null = null;
  private kbBooksCache: BookBasicInfo[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.engine = plugin.coWriterEngine;
    this.facade = new CoWriteFacade({ plugin });
    this.liveAnalysis = new LiveAnalysisController(this);
    this.historyStore = new SuggestionHistoryStore(this);
    this.timeEstimator = new TimeEstimator();
    // D2：保存管线收敛到独立 controller（身份快照 / 串行 / 切章冲刷）
    this.bodySaveController = new BodySaveController({
      app: this.app,
      getBodyText: () => this.rightEditor?.value,
      getIdentity: () => ({
        project: this.project,
        volume: this.volume,
        chapterNum: this.chapterNum,
        chapterName: this.chapterName,
        bodyPath: this.getBodyPath(),
      }),
      updateControlState: (state) => this.updateControlState(state),
      getChapterTitle: (identity) => this.getChapterTitle(identity),
      isSameChapterIdentity: (identity) => this.isSameChapterIdentity(identity),
      onSaved: () => {
        this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics());
        this.liveAnalysis.scheduleRefresh("save");
        // 实体卡片读的就是当前正文的 frontmatter：保存后必须重绘，否则一直显示保存前的统计
        this.renderMonitorPanel();
        // P1-4: 保存后检查是否需要结算
        this.checkSettlementDue();
      },
      takePendingAutoSave: () => {
        const hasPending = this.autoSaveDebouncer.hasPending("auto-save");
        this.autoSaveDebouncer.cancel("auto-save");
        return hasPending;
      },
      scheduleAutoSave: () => this.scheduleAutoSave(),
      onProjectMissing: () => {
        showWarningNotice("项目已被删除，已清空章节绑定；未保存内容不会重建项目", { timeout: 8000 });
        void this.clearChapterBinding({ skipFlush: true });
      },
    });
    // D2：评估管线收敛到 controller；视图只提供数据与 DOM 句柄
    this.realtimeQuality = new RealtimeQualityController({
      app: this.app,
      getText: () => this.rightEditor?.value ?? "",
      getProject: () => this.project,
      getVolume: () => this.volume,
      getChapterNum: () => this.chapterNum,
      getChapterName: () => this.chapterName,
      getBodyPath: () => this.getBodyPath(),
      getChapterBrief: () => this.facade.getChapterBrief(),
      getChapPlan: () => this.facade.engine?.getSnapshot?.()?.chapPlan,
      loadCharacterInfos: () => this.loadCharacterInfosForDeviation(),
      loadForeshadows: () => this.loadForeshadowsForDeviation(),
      createMonitor: () => this.createRealtimeQualityMonitor(),
    });
  }

  /**
   * 装配实时质量监控内核（composition root 留在视图，controller 只管生命周期）。
   * 质量分与协同顶栏共用同一个 WQE 内核，避免同一文本两套分。
   */
  private createRealtimeQualityMonitor(): RealtimeMonitor {
    const kernel = createWritingQualityEngine();
    return new RealtimeMonitor({
      scoreEngine: new QualityScoreEngine({ v1Engine: kernel }),
      // 与 quality-worker / heavy-task 对齐：两者都是纯计算引擎，注入后协同实时
      // 偏离才走 V1 人物一致性检测，而不是简化版关键词回退。
      deviationDetector: new DeviationDetector({
        plotDivergenceEngine: createPlotDivergenceEngine(),
        characterChecker: new CharacterConsistencyChecker(),
      }),
    });
  }
  /**
   * 视图类型标识。
   * @returns 视图类型
   */
  getViewType() {
    return VIEW_TYPE_CO_WRITE;
  }
  /**
   * 侧栏/标签页显示名。
   * @returns 显示名
   */
  getDisplayText() {
    return "\u270D\uFE0F \u53E5\u7EA7\u534F\u540C\u5199\u4F5C";
  }
  /**
   * 视图图标。
   * @returns 图标名
   */
  getIcon() {
    return "pen-nib";
  }
  /**
   * 视图打开：渲染布局、绑定事件、恢复章节状态。
   */
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    applyNwScope(this);
    this.renderLayout();
    this.applyLayoutFromSettings();
    this.bindEvents();
    // 字体只在下拉 change 时应用过：重开视图后下拉显示已选字体，正文仍是默认字体
    this.applyEditorFont(this.facade.settings.coWriteEditorFont || '');
    this.renderEmptySuggestions();
    this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics());
    if (this.project && this.chapterName) {
      await this.openChapter(this.project, this.chapterName, this.volume, this.chapterNum);
      await this.historyStore.loadSuggestionHistory();
    }
    const mode = this.facade.settings.coWriteModelMode || 'local';
    if (mode === 'local' && !resolveCoWriteLocalModel(this.facade.settings)) {
      showWarningNotice('协同写作未配置本地模型，请在设置中配置', { timeout: 8000 });
    } else if (mode === 'cloud') {
      const providerId = this.facade.settings.coWriteCloudProvider || '';
      if (!providerId) {
        showWarningNotice('云端模式未选择供应商，请在设置中配置', { timeout: 8000 });
      }
    }
    const precisionMode = this.facade.settings.precisionMode || false;
    this.facade.setPrecisionMode(precisionMode);
    this.updatePrecisionModeBtn();

    if (this.timeEstimator) {
      await this.timeEstimator.loadHistory();
    }
  }
  /**
   * 视图关闭：释放编辑器/监听器/定时器。
   */
  async onClose() {
    this.modelSwitcher?.destroy();
    this.modelSwitcher = null;
    this.clearPreviewTimer();
    // 关闭后仍在途的完成度评估与预览渲染都要作废：
    // 旧实现只 abort 了建议请求，指标请求会继续烧额度并把结果写进已分离的 DOM
    if (this.metricsAbortController) {
      this.metricsAbortController.abort();
      this.metricsAbortController = null;
    }
    this.previewSeq++;
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
      this.suggestProgressEmitter = null;
    }
    if (this.suggestStepList) {
      this.suggestStepList.destroy();
      this.suggestStepList = null;
    }
    if (this.timeEstimator) {
      await this.timeEstimator.saveHistory();
      this.timeEstimator = null;
    }
    this.ghostDebounceManager.dispose();
    this.realtimeQuality.dispose();
    if (this.liveAnalysis && typeof this.liveAnalysis.clearTimers === 'function') {
      this.liveAnalysis.clearTimers();
    }
    // NBI-04: 视图卸载后不残留「指令已应用」状态
    this.appliedHint = null;
    await this.saveBody(false);
    this.autoSaveDebouncer.dispose();
  }
  /**
   * D6：清空章节绑定，回到「未绑定章节」空态。
   * 视图是单例：无显式上下文的入口若只 revealLeaf，上一本书/上一章的
   * project/chapterNum 会继续被保存、建议与面板使用（跨书串数据）。
   */
  /**
   * 清空当前章节绑定。
   *
   * @param options.skipFlush - 项目已删除时跳过落盘冲刷（写入保护会拒绝保存）
   */
  async clearChapterBinding(options?: { skipFlush?: boolean }): Promise<void> {
    if (!this.project && !this.chapterName) {
      this.statusBar?.setText("未绑定章节");
      return;
    }
    // 未落盘的旧正文先按旧身份保存；失败则中止清空，避免丢字。
    // 项目已删除时不能 flush：写入保护会拒绝，且 flush 失败会阻止清空绑定。
    if (!options?.skipFlush) {
      const flushed = await this.flushPendingBodySaveBeforeChapterSwitch();
      if (!flushed) {
        showWarningNotice("上一章正文未能保存，已取消清空章节绑定", { timeout: 4000 });
        return;
      }
    }
    this.clearPreviewTimer();
    this.beginSuggestionEpoch();
    this.abortActiveSuggestion();
    this.clearStaleSuggestions();
    this.isAssociating = false;
    this.lastGhostSeed = "";
    this.lastGhostRequestAt = 0;
    this.renderEmptySuggestions("尚未绑定章节：请先打开某章「正文」文件，或从完整写作工作台选择章节后再进入。");
    this.project = "";
    this.chapterName = "";
    this.volume = "第1卷";
    this.chapterNum = 1;
    this.tractionEngine = null;
    this.historyLoaded = false;
    this.resetQualityMonitorForChapterSwitch();
    this.resetPlotMetricsForChapterSwitch();
    this.liveAnalysis.resetForChapterSwitch();
    this.warningContainer?.empty();
    if (this.rightEditor) this.rightEditor.value = "";
    this.renderMetrics(emptyMetrics());
    this.statusBar?.setText("未绑定章节");
  }
  /** 按章号反查正文实际所在卷；找不到返回 null（调用方回落第 1 卷） */
  private resolveVolumeForChapter(project: string, chapterNum: number): string | null {
    const bodyRoot = `${project}/03-大纲与章节/正文/`;
    const pattern = new RegExp(`/第\\d+卷/第${chapterNum}章[^/]*_正文\\.md$`);
    const hit = this.app.vault.getFiles().find(f => f.path.startsWith(bodyRoot) && pattern.test(f.path));
    return hit ? hit.path.slice(bodyRoot.length).split('/')[0] : null;
  }
  /**
   * 打开指定章节的协同写作视图
   *
   * @param project - 项目（路径或对象）
   * @param chapterName2 - 章节名
   * @param volume2 - 第二卷
   * @param chapterNum - 章号
   */
  async openChapter(project: string, chapterName2: string, volume2?: string, chapterNum?: number) {
    const seq = ++this.openChapterSeq;
    // 只传 2 个参数时旧默认值是「第1卷/第1章」，会把第 3 卷第 12 章绑定成第 1 卷第 1 章、
    // 保存直接写错文件。身份推定集中在 chapter-switch：缺参按章名推定章号，并按正文实际位置反查卷。
    const identity = resolveChapterIdentity({
      chapterName: chapterName2,
      volume: volume2,
      chapterNum,
      resolveVolume: num => this.resolveVolumeForChapter(project, num),
    });
    volume2 = identity.volume;
    chapterNum = identity.chapterNum;
    // 上一章排队中的自动保存必须先用「旧身份」落盘：下面一旦改写 project/chapterNum，
    // 2s 防抖里的保存就会用新章路径写入旧章正文（静默串章）。
    const flushed = await this.flushPendingBodySaveBeforeChapterSwitch();
    if (seq !== this.openChapterSeq) return;
    if (!flushed) {
      showWarningNotice("上一章正文未能保存，已取消切章", { timeout: 4000 });
      return;
    }
    // 切章先取消上一章排队的尾随渲染，避免旧正文在新章加载期间被补渲染一次
    this.clearPreviewTimer();
    // NBI-05: 切换章节即作废旧建议上下文，避免在途生成/联想的旧章结果写回新章
    this.beginSuggestionEpoch();
    this.abortActiveSuggestion();
    this.clearStaleSuggestions();
    this.isAssociating = false;
    this.lastGhostSeed = "";
    this.lastGhostRequestAt = 0;
    this.renderEmptySuggestions();

    this.project = project;
    this.chapterName = chapterName2;
    this.volume = volume2;
    this.chapterNum = chapterNum;
    // 顶栏的质量/偏离属于上一章：切章先清空，避免新章加载期间（或新章正文过短、
    // 不会触发评估时）长期显示上一章的分数。
    this.resetQualityMonitorForChapterSwitch();
    // 完成度评估同理：在途的旧章结果不能写进新章，状态机也不能停在 evaluating
    this.resetPlotMetricsForChapterSwitch();
    // 设定守卫同理：旧章在途的 OOC/实体结果不得写进新章，跨章长度基准也要清零
    this.liveAnalysis.resetForChapterSwitch();
    // 上一章的「送入确认队列」按钮必须一起清掉：
    // 引擎侧 init 已清空待确认变更，留着按钮只会把旧章的变更按新章身份入队。
    this.warningContainer?.empty();
    this.historyLoaded = false; // B3: 章节切换后重新加载历史

    // P0: 前置规划完整性检查 — 确保 AI 建议生成时有充分上下文
    await this.checkPrerequisites(project, chapterName2, volume2);
    if (seq !== this.openChapterSeq) return;

    if (!this.rightEditor)
      return;
    // 切换章节先清空编辑器，避免未写入的新章节沿用上一章内容（关闭视图时会把旧内容误存）
    this.rightEditor.value = '';
    let bodyOnly = '';
    try {
      const bodyPath = this.getBodyPath();
      const file = this.app.vault.getAbstractFileByPath(bodyPath);
      if (file instanceof TFile) {
        const fullContent = await this.app.vault.read(file);
        bodyOnly = stripChapterBody(fullContent);
        this.rightEditor.value = bodyOnly;
      }
    } catch (e) {
      log.warn("[CoWritingView] \u8BFB\u53D6\u5DF2\u6709\u6B63\u6587\u5931\u8D25:", e);
    }
    const volumeNum = parseInt(volume2.replace(/[^\d]/g, '')) || 1;
    this.facade.syncChapterLoaded(project, volumeNum, chapterNum, chapterName2, bodyOnly, bodyOnly.trim().length);
    // 切章会重建/覆写正文容器：字体设置在这里补一次，保证与下拉显示一致
    this.applyEditorFont(this.facade.settings.coWriteEditorFont || '');
    this.updateControlState("\u5DF2\u52A0\u8F7D");
    this.refreshStatusBar();
    this.updateMarkdownStatus();
    void this.resolveEditorContract().then(() => this.updateMarkdownStatus());
    // initEngine 之前 facade 仍是上一章的会话：用旧 metrics 会先渲染一遍旧章完成度
    this.renderMetrics(emptyMetrics());
    if (this.realtimeQuality.isEnabled()) this.scheduleQualityMonitor();
    await this.historyStore.loadSuggestionHistory();
    if (seq !== this.openChapterSeq) return;
    await this.refreshPreview(true);
    if (seq !== this.openChapterSeq) return;
    try {
      await this.facade.initEngine(project, chapterName2, volume2, chapterNum);
      if (seq !== this.openChapterSeq) return;
      // 同人设定缺失/损坏时协同会以「空规则」继续写作：必须让用户看见，而不是只写日志
      this.warnFanficRulesOnce();
      // 承接规划成果：从磁盘读取本章 6 个规划文件 → ChapterBrief
      this.facade.setChapterBrief(await this.loadChapterBriefInput(bodyOnly));
      this.facade.updateSnapshot(this.rightEditor.value);
      this.tractionEngine = await this.facade.createEndingTractionEngine(project);
      await this.renderAllPanels();
      // 切章已清空牵引区（旧章进度不能停留），引擎就绪后立即补一次新章数据
      await this.liveAnalysis.renderTractionPanel();
      this.updatePlotCompletion();
      this.updateStartButtonState();
    } catch (e) {
      log.warn("[CoWritingView] \u4E0A\u4E0B\u6587\u521D\u59CB\u5316\u5931\u8D25:", e);
      showWarningNotice("\u4E0A\u4E0B\u6587\u52A0\u8F7D\u5931\u8D25\uFF0C\u53E5\u7EA7\u5EFA\u8BAE\u53EF\u80FD\u53D7\u9650", { timeout: 4000 });
    }
  }

  /** P0: 前置规划完整性检查 — 确保 CoWritingView 写作时有充分的章节上下文 */
  private async checkPrerequisites(project: string, chapterName: string, volume: string): Promise<void> {
    // v4.5.1 fix: 用 "第N章" 前缀，与 pjStepDir/pjStepFile 规范一致
    const chapterPrefix = `第${this.chapterNum}章`;
    const stepDir = `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapterPrefix}`;

    // 同一视图内可能多次切换章节：先无条件移除旧横幅。
    // 只在「有缺口」分支里移除的话，规划补齐后旧横幅会一直残留。
    this.contentEl.querySelectorAll('.nw-cowrite-prereq-warning').forEach(el => el.remove());

    // 检查关键前置步骤文件是否存在 / 是否只是空模板
    const files = [
      { name: '信息规划', file: `${stepDir}/${chapterPrefix}_信息规划.md` },
      { name: '大纲摘要', file: `${stepDir}/${chapterPrefix}_大纲摘要.md` },
    ];
    const checks: PrerequisiteCheck[] = [];
    for (const item of files) {
      const f = this.app.vault.getAbstractFileByPath(item.file);
      if (!(f instanceof TFile)) {
        checks.push({ name: item.name, exists: false });
        continue;
      }
      try {
        const content = await this.app.vault.read(f);
        const body = content.replace(/^---[\s\S]*?---/, '').trim();
        checks.push({ name: item.name, exists: true, bodyLength: body.length });
      } catch {
        checks.push({ name: item.name, exists: true, readFailed: true });
      }
    }

    const missing = describePrerequisiteGaps(checks, PREREQ_MIN_BODY_CHARS);
    if (missing.length === 0) return;

    // 挂在编辑器容器顶部：此前挂在 contentEl 末尾，实际位于三栏布局下方（多半在视口外）
    const host = this.editorWrapEl ?? this.contentEl;
    const banner = host.createDiv({
      cls: 'nw-cowrite-prereq-warning',
      attr: { style: 'flex:0 0 auto; background: var(--text-warning-bg, #fff3cd); color: var(--text-warning); padding: 8px 12px; margin: 0 0 4px; border-radius: 4px; font-size: 0.82em; border-left: 3px solid var(--text-warning, #f59e0b);' },
    });
    host.insertBefore(banner, host.firstChild);
    banner.createEl('strong', { text: '⚠️ 前置规划未完成：' });
    banner.createEl('span', { text: ` 缺少 ${missing.join('、')}。建议先在「全本写作工作台」中运行前置规划步骤，否则 AI 建议可能缺乏章节上下文和世界观设定信息。` });
    // 8 秒后淡出并移除节点（只把 opacity 设 0 会留下不可见但仍占位的元素）
    setTimeout(() => {
      banner.style.transition = 'opacity 1s';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 1100);
    }, 8000);
    log.warn(`[CoWritingView] 前置规划检查 — 缺失: ${missing.join(', ')}`);
  }

  /**
   * 读取本章规划文件，作为协同写作的输入（磁盘为准，不依赖工作台内存状态）。
   * 对应：信息规划 / 情节蒸馏 / 大纲摘要 / 情绪规划 / Scene展开。
   */
  private async loadChapterBriefInput(bodyText: string): Promise<ChapterBriefInput> {
    const chapterPrefix = `第${this.chapterNum}章`;
    const stepDir = `${this.project}/${SUBDIR_STEP_ROOT}/${this.volume}/${chapterPrefix}`;
    const read = async (stepType: string): Promise<string> => {
      const f = this.app.vault.getAbstractFileByPath(`${stepDir}/${chapterPrefix}_${stepType}.md`);
      if (!(f instanceof TFile)) return '';
      try {
        const raw = await this.app.vault.read(f);
        // 去掉 YAML frontmatter：大纲与情节蒸馏拼接后，第二份 fm 会落在文本中间
        return raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      } catch {
        return '';
      }
    };
    const [sceneExpansion, emotionPlan, infoPlan, outline, plotCore] = await Promise.all([
      read(CHAPTER_FILE_TYPES.sceneExpand),
      read(CHAPTER_FILE_TYPES.emotionPlan),
      read(CHAPTER_FILE_TYPES.infoPlan),
      read(CHAPTER_FILE_TYPES.outline),
      read(CHAPTER_FILE_TYPES.plotDistill),
    ]);
    return {
      sceneExpansion,
      emotionPlan,
      infoPlan,
      outline: [outline, plotCore].filter(Boolean).join('\n\n'),
      bodyText,
    };
  }

  /**
   * 渲染三栏布局（编辑器/建议/辅助面板）。
   */
  renderLayout() {
    this.mainContainer = this.contentEl.createDiv({ cls: "nw-cowrite-root" });
    const header = this.mainContainer.createDiv({ cls: "nw-cowrite-header" });

    // 左区：返回 · 标题 · 章节上下文状态
    const headerLeft = header.createDiv({ cls: "nw-cowrite-header-left" });
    const backBtn = headerLeft.createEl("button", { text: "← 工作台", cls: "nw-float-monitor-toggle nw-cowrite-back-btn" });
    backBtn.setAttribute("title", "返回完整写作工作台");
    backBtn.addEventListener("click", () => { void this.plugin.openFullWriterView(); });
    const titleDiv = headerLeft.createDiv({ cls: "nw-cowrite-title" });
    titleDiv.createSpan({ cls: "nw-cowrite-title-icon", text: "\u{1F4DD}" });
    titleDiv.createSpan({ text: "\u534F\u540C\u5199\u4F5C" });
    // 空态不再显示「加载中...」，改为准确的上下文状态（openChapter 成功后会由 refreshStatusBar 覆盖）
    this.statusBar = headerLeft.createDiv({ cls: "nw-cowrite-status", text: "未绑定章节" });

    // 中区：资源引用入口（知识库 → 指纹库 → 实体，按参考资料使用频率排序）
    const headerTools = header.createDiv({ cls: "nw-cowrite-header-tools" });
    const kbBtn = headerTools.createEl("button", { text: "\u{1F4DA} 知识库管理", cls: "nw-float-monitor-toggle nw-btn-knowledge" });
    kbBtn.setAttribute("title", "打开知识库管理视图");
    kbBtn.addEventListener("click", () => { this.openKnowledgePanel(); });
    const fpBtn = headerTools.createEl("button", { text: "🔍 指纹库", cls: "nw-float-monitor-toggle" });
    fpBtn.setAttribute("title", "打开写作指纹库");
    fpBtn.addEventListener("click", () => { this.plugin.executeCommand("novel-writer-fingerprint-library"); });
    const entityBtn = headerTools.createEl("button", { text: "👥 实体", cls: "nw-float-monitor-toggle" });
    entityBtn.setAttribute("title", "统一实体管理（人物/地点/势力/物品）");
    entityBtn.addEventListener("click", () => {
      if (this.project) {
        new UnifiedEntityManagerModal(this.app, this.plugin, this.project).open();
      } else {
        new Notice("⚠️ 请先打开一个项目章节", 3000);
      }
    });
    // 右区：视图模式（剧情监控 → 精准模式）· 资源状态
    // v8.4: 取消原「⋯ 更多」下拉（与右侧「⚙ 更多工具」功能重复，且其全局 click 监听未随视图卸载）
    //       将「监控 / 分析」并入右侧工具面板，顶栏只保留导航、资源与模式三类入口
    const headerRight = header.createDiv({ cls: "nw-cowrite-header-right" });
    // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到协同顶栏（四个主界面之一）。
    this.modelSwitcher = renderModelQuickSwitcher(headerRight, this.plugin);
    const monBtn = headerRight.createEl("button", { text: "\u{1F4C8} \u5267\u60C5", cls: "nw-float-monitor-toggle nw-btn-monitor" });
    monBtn.setAttribute("title", "打开/关闭剧情监控浮窗");
    monBtn.addEventListener("click", () => { this.toggleFloatingPanel(); });
    const precisionBtn = headerRight.createEl("button", { text: "\uD83C\uDFAF \u7CBE\u51C6\u6A21\u5F0F", cls: "nw-precision-mode-btn nw-float-monitor-toggle", attr: { title: "\u7CBE\u51C6\u6A21\u5F0F\uFF1A\u9010\u53E5\u68C0\u7D22+\u98CE\u683C\u8BC4\u5206+\u53CDAI\u68C0\u6D4B" } });
    precisionBtn.addEventListener("click", () => { this.togglePrecisionMode(); });
    this.precisionModeBtn = precisionBtn;

    this.assetStatusBar = headerRight.createDiv({ cls: "nw-asset-status-bar" });
    void this.renderAssetStatusBar();

    const qualityStatus = headerRight.createDiv({ cls: "nw-cowrite-status nw-quality-live" });
    this.realtimeQuality.attachStatus(qualityStatus);
    const qualityBtn = headerRight.createEl("button", { text: "📊 实时质量", cls: "nw-float-monitor-toggle" });
    qualityBtn.setAttribute("title", "开启/关闭实时质量评估");
    qualityBtn.addEventListener("click", () => this.toggleQualityMonitor());
    this.qualityMonitorBtn = qualityBtn;

    const mainArea = this.mainContainer.createDiv({ cls: "nw-cowrite-main" });

    // 左侧：预览区（可折叠，默认窄）
    const leftPanel = mainArea.createDiv({ cls: "nw-cowrite-left" });
    // 本章简报：把上一步（Scene 展开/大纲/情绪/信息规划）的成果直接摆出来
    const briefSection = leftPanel.createDiv({ cls: "nw-cowrite-brief" });
    const briefHead = briefSection.createDiv({ cls: "nw-cowrite-brief-head" });
    briefHead.createSpan({ cls: "nw-cowrite-brief-title", text: "📋 本章简报" });
    briefSection.createDiv({ cls: "nw-cowrite-brief-summary", text: "等待章节规划…" });
    this.briefSummaryEl = briefSection.querySelector(".nw-cowrite-brief-summary") as HTMLElement | null;
    this.briefContent = briefSection.createDiv({ cls: "nw-cowrite-brief-body" });
    const previewSection = leftPanel.createDiv({ cls: "nw-cowrite-preview" });
    previewSection.createDiv({ cls: "nw-cowrite-preview-label", text: "预览" });
    this.previewContent = previewSection.createDiv({ cls: "nw-cowrite-preview-content" });
    const previewToggle = previewSection.createDiv({ cls: "nw-cowrite-preview-toggle" });
    previewToggle.createSpan({ text: "收起 ▲" });
    previewToggle.addEventListener("click", () => {
        leftPanel.toggleClass("nw-cowrite-left-collapsed", !leftPanel.hasClass("nw-cowrite-left-collapsed"));
        previewToggle.setText(leftPanel.hasClass("nw-cowrite-left-collapsed") ? "展开 ▼" : "收起 ▲");
    });

    // 中央：编辑器 + 拖拽条 + 建议面板（左右分栏）
    const centerPanel = mainArea.createDiv({ cls: "nw-cowrite-center" });
    this.centerPanel = centerPanel;
    const editorWrap = centerPanel.createDiv({ cls: "nw-cowrite-editor-wrap" });
    this.editorWrapEl = editorWrap;
    this.buildMarkdownToolbar(editorWrap);
    this.rightEditor = editorWrap.createEl("textarea", { cls: "nw-cowrite-editor has-md-chrome" });
    this.rightEditor.spellcheck = false;
    this.rightEditor.placeholder = "在此写作……支持 Markdown；Tab 生成 AI 建议";
    this.ghostSuggestionContainer = editorWrap.createDiv({ cls: "nw-cowrite-ghost-suggestion" });
    this.ghostSuggestionContainer.addEventListener("click", () => {
      if (this.ghostSuggestion && !this.isSuggesting)
        void this.handleAcceptSuggestion(this.ghostSuggestion);
    });
    this.buildMarkdownStatus(editorWrap);

    // 拖拽分隔条
    this.resizerEl = centerPanel.createDiv({ cls: "nw-cowrite-resizer" });
    this.initResizer();

    // v7.0: 建议窗口移到编辑器区域右侧，作为独立一栏
    this.suggestionContainer = centerPanel.createDiv({ cls: "nw-cowrite-suggestions-panel" });
    const suggestionHeader = this.suggestionContainer.createDiv({ cls: "nw-cowrite-suggestions-header" });
    const suggestionTitle = suggestionHeader.createDiv({ cls: "nw-cowrite-suggestions-title", text: "AI 建议" });
    this.suggestionStatusText = suggestionHeader.createDiv({ cls: "nw-cowrite-suggestions-status", text: "等待生成" });
    const suggestionCloseBtn = suggestionHeader.createEl("button", { text: "✕", cls: "nw-cowrite-suggestions-close" });
    suggestionCloseBtn.addEventListener("click", () => {
      this.toggleSuggestionPanel(false);
    });
    this.suggestionContent = this.suggestionContainer.createDiv({ cls: "nw-cowrite-suggestions-content" });
    this.humanRateDashboard = this.suggestionContainer.createDiv({ cls: "nw-human-rate-dashboard" });
    this.renderHumanRateDashboard();

    // 右侧：Tab 化面板（概览 + 知识库）
    const rightPanel = mainArea.createDiv({ cls: "nw-cowrite-right" });
    this.rightTabContainer = rightPanel.createDiv({ cls: "nw-cowrite-right-tabs" });

    // Tab 头部
    this.rightTabHeaders = this.rightTabContainer.createDiv({ cls: "nw-cowrite-tab-headers" });
    const overviewTab = this.rightTabHeaders.createDiv({
      cls: "nw-cowrite-tab-header is-active",
      text: "📊 概览",
      attr: { "data-tab": "overview" }
    });
    const knowledgeTab = this.rightTabHeaders.createDiv({
      cls: "nw-cowrite-tab-header",
      text: "📚 知识库",
      attr: { "data-tab": "knowledge", title: "内嵌知识库面板：检索与引用" }
    });
    overviewTab.addEventListener("click", () => this.switchRightTab("overview"));
    knowledgeTab.addEventListener("click", () => this.switchRightTab("knowledge"));

    // Tab 内容容器
    this.rightTabContents = this.rightTabContainer.createDiv({ cls: "nw-cowrite-tab-contents" });

    // Tab 1: 概览（原有内容）
    this.overviewTabContent = this.rightTabContents.createDiv({ cls: "nw-cowrite-tab-content is-active", attr: { "data-tab": "overview" } });

    const cardsArea = this.overviewTabContent.createDiv({ cls: "nw-cowrite-cards" });
    const completionCard = cardsArea.createDiv({ cls: "nw-card" });
    completionCard.createDiv({ cls: "nw-card-title", text: "完成度" });
    const completionValue = completionCard.createDiv({ cls: "nw-card-value", text: "0%" });
    const completionProgress = completionCard.createDiv({ cls: "nw-progress" });
    completionProgress.createDiv({ cls: "nw-progress-fill", attr: { style: "width: 0%" } });
    this.metricsContainer = completionCard;

    const tractionCard = cardsArea.createDiv({ cls: "nw-card" });
    tractionCard.createDiv({ cls: "nw-card-title", text: "情节牵引" });
    tractionCard.createDiv({ cls: "nw-card-value", text: "45%" });
    tractionCard.createDiv({ cls: "nw-card-sub", text: "偏离风险: 低" });
    this.tractionContainer = tractionCard;

    const wordCard = cardsArea.createDiv({ cls: "nw-card nw-cowrite-word-card" });
    wordCard.createDiv({ cls: "nw-card-title", text: "字数" });
    this.wordCountDisplay = wordCard.createDiv({ cls: "nw-card-value", text: "0" });
    this.wordGoalDisplay = wordCard.createDiv({ cls: "nw-card-sub", text: "目标: 3000" });

    // 写作控制台（紧凑模式）
    const controlPanel = this.overviewTabContent.createDiv({ cls: "nw-cowrite-control-panel" });
    const controlHead = controlPanel.createDiv({ cls: "nw-cowrite-control-head" });
    controlHead.createDiv({ cls: "nw-cowrite-control-title", text: "控制台" });
    // NBI-04: 临时指令「已应用」状态标识，默认隐藏
    this.hintStateDisplay = controlHead.createDiv({
      cls: "nw-hint-state",
      text: "指令已应用",
      attr: { style: "display:none;" }
    });
    this.saveStateDisplay = controlHead.createDiv({ cls: "nw-cowrite-control-state", text: "未保存" });

    this.hintInput = controlPanel.createEl("input", {
      type: "text",
      cls: "nw-hint-input",
      placeholder: "临时指令 / 方向（Enter 应用）"
    });

    // 按钮改为竖向 3 分组（核心创作 / 辅助润色 / 更多工具），每按钮带说明 tooltip
    const actionsArea = controlPanel.createDiv({ cls: "nw-cowrite-actions-area" });

    // 模式切换（顶部独立一行）
    const modeRow = actionsArea.createDiv({ cls: "nw-cowrite-action-row" });
    const modeBtn = modeRow.createEl("button", { text: "🖥 本地", cls: "nw-btn nw-btn-ghost", attr: { title: "切换本地/云端模型" } });
    modeBtn.addEventListener("click", () => this.handleModelToggle());
    this.modelToggleBtn = modeBtn;

    // —— 🎯 核心创作 ——
    const coreSection = actionsArea.createDiv({ cls: "nw-cowrite-action-section" });
    coreSection.createDiv({ cls: "nw-cowrite-action-section-title", text: "🎯 核心创作" });
    const coreRow = coreSection.createDiv({ cls: "nw-cowrite-action-row" });
    const nextBtn = coreRow.createEl("button", { text: "⏭ 节点 -/-", cls: "nw-btn nw-btn-primary", attr: { title: "推进到下一剧情节点，生成针对性建议" } });
    nextBtn.addEventListener("click", () => { void withButtonBusy(nextBtn, "⏳ 推进中...", () => this.handleAdvanceNextNode()); });
    this.nextNodeBtn = nextBtn;
    const suggestBtn = coreRow.createEl("button", { text: "\u21E5 建议", cls: "nw-btn nw-btn-primary", attr: { title: "基于上文生成续写建议（方向可在上方临时指令填写）" } });
    suggestBtn.addEventListener("click", () => this.handleTabSuggest(true));
    this.suggestBtn = suggestBtn;
    const sceneBtn = coreRow.createEl("button", { text: "🎬 场景描写", cls: "nw-btn nw-btn-ghost", attr: { title: "用当前 Scene 卡的地点/时间/感官钩子生成环境描写，不推进剧情" } });
    sceneBtn.addEventListener("click", () => {
      const hint = "场景描写：必须使用当前场景卡的地点、时间、sensory_hook 与 body_reaction；只写环境与身体感受，不推进剧情、不写对白、不引入新地点。";
      this.hintInput.value = hint;
      this.cursorHint = hint;
      this.facade.setCursorHint(hint);
      void this.handleTabSuggest(true);
    });
    const completeBtn = coreRow.createEl("button", { text: "📊 结算", cls: "nw-btn nw-btn-primary", attr: { title: "结算本章：更新事实/伏笔/时间线" } });
    completeBtn.addEventListener("click", () => { void withButtonBusy(completeBtn, "⏳ 结算中...", () => this.handleComplete()); });

    // —— ✨ 辅助润色 ——
    const assistSection = actionsArea.createDiv({ cls: "nw-cowrite-action-section" });
    assistSection.createDiv({ cls: "nw-cowrite-action-section-title", text: "✨ 辅助润色" });
    const assistRow = assistSection.createDiv({ cls: "nw-cowrite-action-row" });
    const assocBtn = assistRow.createEl("button", { text: "✨ 联想", cls: "nw-btn nw-btn-ghost", attr: { title: "联想后续情节走向" } });
    assocBtn.addEventListener("click", () => { void withButtonBusy(assocBtn, "⏳ 联想中...", () => this.handleAssociationSuggest()); });
    const expandBtn = assistRow.createEl("button", { text: "✍️ 扩写", cls: "nw-btn nw-btn-ghost", attr: { title: "扩写选中段落" } });
    expandBtn.addEventListener("click", () => { void withButtonBusy(expandBtn, "⏳ 扩写中...", () => this.handleOutlineExpand()); });
    const rewriteBtn = assistRow.createEl("button", { text: "✂ 改写", cls: "nw-btn nw-btn-ghost", attr: { title: "改写选中段落（降 AI 痕迹 / 换文风）" } });
    rewriteBtn.addEventListener("click", () => { void withButtonBusy(rewriteBtn, "⏳ 改写中...", () => this.handleRewriteSelection()); });

    // —— ⚙ 更多工具（可折叠）——
    const toolsSection = actionsArea.createDiv({ cls: "nw-cowrite-action-section" });
    const toolsToggle = toolsSection.createEl("button", { text: "⚙ 更多工具", cls: "nw-btn nw-btn-ghost nw-cowrite-tools-toggle" });
    const toolsPanel = toolsSection.createDiv({ cls: "nw-cowrite-tools-panel nw-cowrite-tools-panel-inline" });

    const toolButtons = [
      { text: "🕘 历史", action: () => this.handleOpenHistory() },
      { text: "🧠 记忆", action: () => this.handleOpenMemoryManager() },
      { text: "📥 批量导入", action: () => this.openBatchImportModal() },
      { text: "📊 监控", action: () => this.openKnowledgeMonitorModal() },
      { text: "🔬 分析", action: () => this.openAnalysisModal() },
      { text: "🛡 检查", action: () => this.liveAnalysis.inspectSettingGuard("manual") },
      { text: "📋 质检", action: () => this.loadQualityReport() },
      { text: "💾 保存", action: () => this.saveBody(true) },
      { text: "✅ 标记完稿", action: () => this.markAsWritten() },
    ];
    for (const btn of toolButtons) {
      const el = toolsPanel.createEl("button", { text: btn.text, cls: "nw-btn nw-btn-ghost" });
      el.addEventListener("click", () => {
        toolsPanel.removeClass("is-open");
        toolsToggle.setText("⚙ 更多工具");
        void withButtonBusy(el, "⏳ 处理中...", () => btn.action());
      });
    }

    // 用 class 驱动显隐（不再依赖内联 style，避免与全局点击监听/闭包引用冲突）
    toolsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = toolsToggle.parentElement?.querySelector(".nw-cowrite-tools-panel");
      if (!panel) return;
      const willOpen = !panel.hasClass("is-open");
      panel.toggleClass("is-open", willOpen);
      toolsToggle.setText(willOpen ? "⚙ 收起工具" : "⚙ 更多工具");
    });
    // 点击面板外收起（幂等：查询 DOM 当前状态，不依赖闭包引用）
    this.registerDomEvent(document, "click", () => {
      this.mainContainer?.querySelectorAll(".nw-cowrite-tools-panel.is-open").forEach((p) => {
        p.removeClass("is-open");
        const t = p.parentElement?.querySelector(".nw-cowrite-tools-toggle");
        if (t) t.setText("⚙ 更多工具");
      });
    });

    this.updateModelToggleBtn();

    // flowContainer 已整合到 metricsContainer，下方空间留给 warningContainer
    this.warningContainer = controlPanel.createDiv({ cls: "nw-warnings" });
    this.monitorContainer = controlPanel.createDiv({ cls: "nw-cowrite-monitor-panel" });
    this.renderMonitorPanel();

    // Tab 2: 知识库
    this.knowledgeTabContent = this.rightTabContents.createDiv({ cls: "nw-cowrite-tab-content", attr: { "data-tab": "knowledge" } });
    this.renderKnowledgeTab();

    this.renderEmptySuggestions();
  }
  /** v6.4: 创建浮窗监控面板 */
  createFloatingPanel() {
    if (this.floatingPanel) return;
    const host = this.mainContainer || this.contentEl;
    this.floatingPanel = host.createDiv({ cls: "nw-float-monitor" });
    this.floatingPanel.style.display = 'none';
    const head = this.floatingPanel.createDiv({ cls: "nw-float-monitor-head" });
    head.createSpan({ cls: "nw-float-monitor-title", text: "\u{1F4CA} \u5267\u60C5\u76D1\u63A7\u4E2D\u5FC3" });
    const closeBtn = head.createSpan({ cls: "nw-float-monitor-close", text: "\u2715" });
    closeBtn.addEventListener('click', () => this.toggleFloatingPanel(false));
    this.floatingBody = this.floatingPanel.createDiv({ cls: "nw-float-monitor-body" });
    this.floatingMetricsSection = this.floatingBody.createDiv({ cls: "nw-float-monitor-section" });
    this.floatingQualitySection = this.floatingBody.createDiv({ cls: "nw-float-monitor-section" });
  }
  /**
   * 展开/收起浮动面板。
   *
   * @param show - 参数
   */
  toggleFloatingPanel(show?: boolean) {
    if (!this.floatingPanel) this.createFloatingPanel();
    if (!this.floatingPanel) return;
    const visible = show !== undefined ? show : this.floatingPanel.style.display !== 'flex';
    this.floatingPanel.style.display = visible ? 'flex' : 'none';
    if (visible) {
      this.renderFloatingMetrics();
      this.renderFloatingQuality();
    }
  }
  /**
   * 渲染浮动指标面板。
   */
  renderFloatingMetrics() {
    if (!this.floatingMetricsSection) return;
    this.floatingMetricsSection.empty();
    const metrics = this.engine?.getSession()?.currentMetrics || { sceneObjectivesMet: 0, characterArcsAdvanced: 0, foreshadowingSeeded: 0, emotionalArcProgress: 0, overallCompletion: 0, suggestionAdvice: '', nextDirectionHints: [], evaluatedAt: 0 };
    this.renderMetricsInto(metrics, this.floatingMetricsSection);
  }
  /**
   * 渲染浮动质量面板。
   */
  renderFloatingQuality() {
    if (!this.floatingQualitySection) return;
    this.floatingQualitySection.empty();
    // AI 味检测报告（对当前正文实时检测，独立于质检报告）
    const aiBody = this.rightEditor?.value || '';
    if (aiBody.trim().length > 0) {
      const aiReport = this.floatingQualitySection.createDiv({ cls: 'nw-ai-report-wrap' });
      renderAIDetectionReport(aiReport, aiBody);
    }
    if (this.qualityIssues.length === 0) {
      this.floatingQualitySection.createDiv({ cls: "nw-quality-report-empty", text: "\u70B9\u51FB\u300C\u8D28\u68C0\u300D\u6309\u94AE\u52A0\u8F7D\u62A5\u544A\u3002" });
      return;
    }
    const head = this.floatingQualitySection.createDiv({ cls: "nw-quality-report-head" });
    head.createSpan({ cls: "nw-quality-report-title", text: "\u{1F4CB} \u8D28\u63A7\u62A5\u544A" });
    head.createSpan({ cls: "nw-quality-report-status", text: `${this.qualityIssues.length} \u9879\u95EE\u9898` });
    const list = this.floatingQualitySection.createDiv({ cls: "nw-quality-report-list" });
    for (const issue of this.qualityIssues) {
      const item = list.createDiv({ cls: `nw-quality-issue nw-quality-issue-${issue.priority}` });
      const textRow = item.createDiv({ cls: "nw-quality-issue-text" });
      textRow.createSpan({ cls: "nw-quality-issue-severity", text: issue.severity });
      textRow.createSpan({ cls: "nw-quality-issue-problem", text: issue.problem });
      const p = item.querySelector('.nw-quality-issue-problem') as HTMLElement;
      if (p) {
        p.addEventListener('click', () => { this.scrollToTextInEditor(issue.locationText); });
        p.addEventListener('mouseenter', (e) => { this.showQualityPopup(e, issue); });
        p.addEventListener('mouseleave', () => { this.hideQualityPopup(); });
        p.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showQualityContextMenu(e, issue);
        });
      }
      item.createDiv({ cls: "nw-quality-issue-suggestion", text: issue.suggestion });
      const actionsRow = item.createDiv({ cls: "nw-quality-issue-actions" });
      const fixBtn = actionsRow.createEl("button", { text: "\u{1F527} \u4FEE\u590D", cls: "nw-quality-fix-btn" });
      fixBtn.addEventListener("click", () => void this.handleQualityFix(issue));
    }
  }
  /**
   * 绑定编辑器与面板事件（含 IME 守卫）。
   */
  bindEvents() {
    this.rightEditor.addEventListener("keydown", (event: KeyboardEvent) => this.handleEditorKeydown(event));
    this.rightEditor.addEventListener("input", () => {
      this.facade.updateSnapshot(this.rightEditor.value);
      this.updateMarkdownStatus();
      this.updateControlState("编辑中");
      void this.refreshPreview(false);
      this.liveAnalysis.scheduleRefresh("input");
      this.scheduleQualityMonitor();
      this.scheduleGhostAssociationRefresh();
      this.updatePlotCompletion();
      this.updateStartButtonState();
      this.autoSaveDebouncer.debounceFixed("brief-panel", () => this.renderBriefPanel(), 800);
      this.scheduleAutoSave();
    });
    this.hintInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter")
        this.applyHint();
    });
    // NBI-04: 输入框内容与已应用指令不一致时，标识即时失效
    this.hintInput.addEventListener("input", () => this.refreshHintState());
  }

  /** P0-2: 开启/关闭实时质量评估（状态与评估在 controller，视图只同步按钮样式） */
  private toggleQualityMonitor(): void {
    const enabled = this.realtimeQuality.toggle();
    this.qualityMonitorBtn?.toggleClass("is-active", enabled);
  }

  /** P0-2: 输入后延迟触发实时质量评估 */
  private scheduleQualityMonitor(): void {
    this.realtimeQuality.schedule();
  }

  /**
   * 切章时清空实时质量顶栏并中止在途评估。
   * 行为与文档见 `RealtimeQualityController#resetForChapterSwitch`。
   */
  private resetQualityMonitorForChapterSwitch(): void {
    this.realtimeQuality.resetForChapterSwitch();
  }

  /**
   * 切章时中止在途的剧情完成度评估并复位状态机。
   * `refreshMetrics` 的返回只校验 `signal.aborted`，切章若不 abort，
   * 旧章结果会 `syncPlotCompletion` 并渲染进新章；状态停在 evaluating
   * 还会让新章顶部一直显示「评估中」。
   */
  private resetPlotMetricsForChapterSwitch(): void {
    if (this.metricsAbortController) {
      this.metricsAbortController.abort();
      this.metricsAbortController = null;
    }
    this.metricsStatus = 'idle';
  }

  /**
   * 读取人物设定供 OOC / 设定矛盾检测使用。
   * 此前协同实时监控不传 characterInfos，导致这两类检测恒返回空。
   * 人物档案不随打字变化，按项目缓存 60s，避免每次评估都全量读盘。
   */
  private async loadCharacterInfosForDeviation(): Promise<CharacterContextInfo[]> {
    if (!this.project) return [];
    const now = Date.now();
    const cached = this.characterInfoCache;
    if (cached && cached.project === this.project && now - cached.at < DEVIATION_CHARACTER_INFO_TTL_MS) {
      return cached.list;
    }

    let list: CharacterContextInfo[] = [];
    try {
      const data = await this.plugin.ctxManager.gatherCharacterState(this.project);
      list = toCharacterContextInfos((data.character_state || []) as Array<Record<string, unknown>>);
    } catch (e) {
      log.warn("[CoWritingView] 读取人物设定失败:", e);
    }

    this.characterInfoCache = { project: this.project, at: now, list };
    return list;
  }

  /**
   * 读取伏笔追踪供「伏笔遗忘」检测使用。
   * 此前协同实时监控不传 foreshadows，且上一章上下文没有 frontmatter，
   * 检测器两条数据来源都为空，该类偏离恒返回空。
   * 伏笔档案不随打字变化，按项目缓存 60s。
   */
  private async loadForeshadowsForDeviation(): Promise<ForeshadowTracking[]> {
    if (!this.project) return [];
    const now = Date.now();
    const cached = this.foreshadowCache;
    if (cached && cached.project === this.project && now - cached.at < DEVIATION_CHARACTER_INFO_TTL_MS) {
      return cached.list;
    }

    let list: ForeshadowTracking[] = [];
    try {
      const tracker = await this.plugin.foreshadowManager.loadTracker(this.project);
      list = toForeshadowTrackings(tracker.items);
      // 追踪器只有埋设章号；计划回收章在伏笔库表格里。补齐后偏离检测才能按
      // 「计划第 N 章回收」分层，而不是所有伏笔都等全局阈值。
      try {
        const { items } = await this.plugin.foreshadowManager.getUnrevealedForeshadows(this.project);
        list = applyPlannedRevealChapters(list, items);
      } catch (e) {
        log.warn("[CoWritingView] 读取伏笔库计划回收章失败:", e);
      }
    } catch (e) {
      log.warn("[CoWritingView] 读取伏笔追踪失败:", e);
    }

    this.foreshadowCache = { project: this.project, at: now, list };
    return list;
  }

  /**
   * 同人设定加载失败时提示一次（同项目同文案不重复），避免无原作约束静默写作。
   * 每次生成收口/联想完成都会复查：设定文件可能在会话中被删除或移动。
   * 警告消失（设定恢复）时清空去重键，否则同一文案再次失效将不再提示。
   */
  private warnFanficRulesOnce(): void {
    const warning = this.engine?.getFanficRulesWarning?.() ?? null;
    if (!warning) {
      this.lastFanficWarningKey = "";
      return;
    }
    const key = `${this.project}|${warning}`;
    if (key === this.lastFanficWarningKey) return;
    this.lastFanficWarningKey = key;
    showWarningNotice(warning.replace(/^⚠️\s*/u, ''), { timeout: 8000 });
  }

  /** NBI-04: 根据输入框与已应用指令的一致性刷新「指令已应用」标识 */
  private refreshHintState(): void {
    if (!this.hintStateDisplay) return;
    const current = this.hintInput?.value.trim() ?? "";
    const visible = this.appliedHint !== null && this.appliedHint !== "" && current === this.appliedHint;
    this.hintStateDisplay.style.display = visible ? "" : "none";
  }
  /** 编辑器顶部：Markdown / 段落 / 一键排版工具条 */
  /** 2026-10-28: 编辑器字体选择下拉 —— 主题变量 + 常见系统字体预设 + 自定义载入字体 */
  private buildFontPicker(wrap: HTMLElement): void {
    const saved = this.facade.settings.coWriteEditorFont || '';
    const group = wrap.createDiv({ cls: 'nw-cowrite-md-group nw-cowrite-font-group' });
    group.createSpan({ cls: 'nw-cowrite-font-label', text: '字体' });
    const select = group.createEl('select', { cls: 'nw-cowrite-font-select' });
    select.createEl('option', { value: '', text: '默认（跟随主题）' });
    for (const preset of SYSTEM_FONT_PRESETS) {
      select.createEl('option', { value: preset.value, text: preset.label });
    }
    const customFamilies = getCustomFontFamilies(this.plugin);
    for (const family of customFamilies) {
      select.createEl('option', {
        value: `"${family}", sans-serif`,
        text: `★ ${family}`,
      });
    }
    select.createEl('option', { value: '__manage__', text: '⚙️ 管理自定义字体…' });
    select.value = saved;
    if (select.value !== saved) select.value = '';
    select.addEventListener('change', () => {
      const value = select.value;
      if (value === '__manage__') {
        select.value = this.facade.settings.coWriteEditorFont || '';
        new FontManagerModal(this.app, this.plugin).open();
        return;
      }
      this.facade.settings.coWriteEditorFont = value;
      void this.facade.settings;
      void this.plugin.saveSettings();
      this.applyEditorFont(value);
    });
  }

  /** 应用编辑器字体（空串=恢复主题默认） */
  private applyEditorFont(fontFamily: string): void {
    const family = fontFamily || '';
    if (this.rightEditor) this.rightEditor.style.fontFamily = family;
    // 幽灵建议层与预览层同步，保持视觉一致
    if (this.ghostSuggestionContainer) this.ghostSuggestionContainer.style.fontFamily = family;
    if (this.previewContent) this.previewContent.style.fontFamily = family;
  }

  private buildMarkdownToolbar(wrap: HTMLElement): void {
    this.buildFontPicker(wrap);
    buildMarkdownToolbar(wrap, {
      getEditor: () => this.rightEditor,
      getContract: () => this.editorContract,
      applyTextEdit: (edit) => this.applyTextEdit(edit),
      applyNovelFormat: () => this.applyNovelFormat(),
    });
  }

  /** 编辑器底部：Markdown / 格式契约 / 字数 / 段落 */
  private buildMarkdownStatus(wrap: HTMLElement): void {
    const status = wrap.createDiv({ cls: 'nw-cowrite-md-status' });
    this.mdStatusEl = status;
    this.mdStatusModeEl = status.createSpan({ cls: 'nw-cowrite-md-status-item', text: 'Markdown' });
    this.mdStatusContractEl = status.createSpan({ cls: 'nw-cowrite-md-status-item nw-cowrite-md-status-contract' });
    this.mdStatusWordsEl = status.createSpan({ cls: 'nw-cowrite-md-status-item' });
    this.mdStatusParagraphsEl = status.createSpan({ cls: 'nw-cowrite-md-status-item' });
    status.createSpan({ cls: 'nw-cowrite-md-status-hint', text: 'Ctrl+Alt+F 一键排版' });
    this.updateMarkdownStatus();
  }

  private updateMarkdownStatus(): void {
    if (!this.mdStatusEl) return;
    const text = this.rightEditor?.value ?? '';
    this.mdStatusModeEl?.setText('Markdown');
    this.mdStatusContractEl?.setText(`格式：${describeContractShort(this.editorContract)}`);
    this.mdStatusWordsEl?.setText(`字数 ${text.replace(/\s+/g, '').length}`);
    this.mdStatusParagraphsEl?.setText(`段落 ${countParagraphs(text)}`);
  }

  private getBodyWriter(): BodyWriter {
    if (!this.bodyWriter) this.bodyWriter = new BodyWriter({ app: this.app });
    return this.bodyWriter;
  }

  /** 读取项目「写作规则.md」推导的正文契约；项目切换时重算 */
  private async resolveEditorContract(): Promise<BodyFormatContract> {
    const project = this.project || '';
    if (project && this.editorContractProject === project) return this.editorContract;
    if (!project) {
      this.editorContract = { ...DEFAULT_BODY_FORMAT };
      this.editorContractProject = '';
      this.updateMarkdownStatus();
      return this.editorContract;
    }
    try {
      this.editorContract = await this.getBodyWriter().resolveContract(project);
      this.editorContractProject = project;
    } catch (e) {
      log.warn('[CoWritingView] 读取写作规则失败，使用默认排版契约:', e);
      this.editorContract = { ...DEFAULT_BODY_FORMAT };
      this.editorContractProject = project;
    }
    this.updateMarkdownStatus();
    return this.editorContract;
  }

  /**
   * 应用一次编辑器文本变更。
   * 优先 execCommand('insertText')，保留原生撤销栈；失败时回退到 value + input。
   */
  private applyTextEdit(edit: TextEdit): void {
    const editor = this.rightEditor;
    if (!editor) return;
    if (edit.text === editor.value) {
      editor.focus();
      editor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      return;
    }
    editor.focus();
    let applied = false;
    try {
      editor.setSelectionRange(0, editor.value.length);
      applied = document.execCommand('insertText', false, edit.text);
    } catch {
      applied = false;
    }
    if (!applied) {
      editor.value = edit.text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const start = Math.min(edit.selectionStart, editor.value.length);
    const end = Math.min(edit.selectionEnd, editor.value.length);
    editor.setSelectionRange(start, end);
    this.updateMarkdownStatus();
  }

  private handleMarkdownShortcut(event: KeyboardEvent): boolean {
    return handleMarkdownShortcut(event, {
      editor: this.rightEditor,
      indent: this.editorContract.indent || INDENT_TWO_FULL_WIDTH,
      applyTextEdit: (edit) => this.applyTextEdit(edit),
      applyNovelFormat: () => { void this.applyNovelFormat(); },
    });
  }

  /** 一键排版：按项目写作规则把全文规整为小说格式 */
  private async applyNovelFormat(): Promise<void> {
    const editor = this.rightEditor;
    if (!editor) return;
    const raw = editor.value;
    if (!raw.trim()) {
      new Notice('编辑器为空，无法排版');
      return;
    }
    const contract = await this.resolveEditorContract();
    const formatted = formatNovelManuscript(raw, contract);
    if (formatted === raw) {
      new Notice('当前正文已是小说格式');
      return;
    }
    this.applyTextEdit({
      text: formatted,
      selectionStart: formatted.length,
      selectionEnd: formatted.length,
    });
    const sourceHint = contract.source === 'writing-rules' ? '' : '（未找到写作规则，使用默认格式）';
    showSuccessNotice(`已按小说格式排版：${describeContractShort(contract)}${sourceHint}`, { timeout: 4000 });
  }

  /**
   * 处理编辑器快捷键（Tab 建议/格式命令）。
   *
   * @param event - 事件
   */
  async handleEditorKeydown(event: KeyboardEvent) {
    // P1-15（v4.27）：中文输入法组合期间不拦截任何按键，
    // 否则 Tab/数字键会被当成「接受建议」，候选词被打断。
    if (isImeComposingEvent(event)) return;
    if (this.handleMarkdownShortcut(event)) return;
    const action = resolveEditorShortcut(event, {
      hasGhost: !!this.ghostSuggestion,
      isSuggesting: this.isSuggesting,
      suggestionCount: this.currentSuggestions.length,
    });
    if (action.kind === 'none') return;
    event.preventDefault();
    switch (action.kind) {
      case 'accept-ghost':
        if (this.ghostSuggestion) await this.handleAcceptSuggestion(this.ghostSuggestion);
        return;
      case 'accept-index':
        await this.acceptByIndex(action.index);
        return;
      case 'suggest':
        await this.handleTabSuggest(action.force);
        return;
      case 'association':
        await this.handleAssociationSuggest();
        return;
      case 'history':
        this.handleOpenHistory();
        return;
      case 'rewrite':
        this.handleRewriteSelection();
        return;
      case 'save':
        await this.saveBody(true);
        return;
      case 'focus-hint':
        this.hintInput.focus();
        return;
      case 'escape':
        this.currentSuggestions = [];
        this.currentRecord = null;
        this.renderEmptySuggestions("\u5DF2\u53D6\u6D88\u5F53\u524D\u5EFA\u8BAE\u3002\u6309 Tab / Ctrl+J \u91CD\u65B0\u751F\u6210\u3002");
        return;
    }
  }
  /**
   * 触发 Tab 建议生成。
   *
   * @param force = false - 参数
   */
  async handleTabSuggest(force = false) {
    await runTabSuggest(this.suggestionFlowHost(), force);
  }

  /** 建议流程宿主：状态通过 getter/setter 与视图字段同步。 */
  private suggestionFlowHost(): SuggestionFlowHost {
    const view = this;
    return {
      get project() { return view.project; },
      get volume() { return view.volume; },
      get chapterNum() { return view.chapterNum; },
      get rightEditor() { return view.rightEditor; },
      get cursorHint() { return view.cursorHint; },
      canColdStart: () => view.canColdStart(),
      get isSuggesting() { return view.isSuggesting; },
      get lastSuggestAt() { return view.lastSuggestAt; },
      get suggestAbortController() { return view.suggestAbortController; },
      get suggestProgressEmitter() { return view.suggestProgressEmitter; },
      get suggestEtaDisplay() { return view.suggestEtaDisplay ?? null; },
      get suggestBtn() { return view.suggestBtn ?? null; },
      get timeEstimator() { return view.timeEstimator ?? null; },
      get facade() { return view.facade; },
      setSuggesting: value => { view.isSuggesting = value; },
      setLastSuggestAt: at => { view.lastSuggestAt = at; },
      setSuggestAbortController: controller => { view.suggestAbortController = controller; },
      setSuggestProgressEmitter: emitter => { view.suggestProgressEmitter = emitter; },
      beginSuggestionEpoch: () => view.beginSuggestionEpoch(),
      isCurrentSuggestionEpoch: epoch => view.isCurrentSuggestionEpoch(epoch),
      isSuggestRequestOwner: signal => view.isSuggestRequestOwner(signal),
      clearStaleSuggestions: () => view.clearStaleSuggestions(),
      renderSuggestionLoading: () => view.renderSuggestionLoading(),
      simulateStepDelay: (ms, signal) => view.simulateStepDelay(ms, signal),
      updateStreamingPreview: (index, cumulative) => view.updateStreamingPreview(index, cumulative),
      clearStreamingPreview: () => view.clearStreamingPreview(),
      renderSuggestionCards: suggestions => view.renderSuggestionCards(suggestions),
      renderStreamingSuggestionCard: (direction, style, index, currentText, isStreaming) => view.renderStreamingSuggestionCard(direction, style, index, currentText, isStreaming),
      showKnowledgeInjectionNotice: () => view.showKnowledgeInjectionNotice(),
      renderEmptySuggestions: message => view.renderEmptySuggestions(message),
      retrySuggestion: () => view.retrySuggestion(),
      openRefillModal: type => view.openRefillModal(type),
      setCurrentSuggestions: suggestions => { view.currentSuggestions = suggestions; },
      setCurrentRecord: record => { view.currentRecord = record; },
      setLastSuggestParams: params => { view.lastSuggestParams = params; },
      setLastSuggestError: error => { view.lastSuggestError = error; },
      getSuggestionStatusText: () => view.suggestionStatusText ?? null,
      getSuggestionContent: () => view.suggestionContent,
      showSuggestionPanel: () => view.showSuggestionPanel(),
      updateStartButtonState: () => view.updateStartButtonState(),
    };
  }

  private async simulateStepDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  /** v7.2: 切换协同写作模型模式（本地/云端） */
  async handleModelToggle() {
    const settings = this.facade.settings;
    const currentMode = settings.coWriteModelMode || 'local';
    const newMode = currentMode === 'local' ? 'cloud' : 'local';
    settings.coWriteModelMode = newMode;
    await this.plugin.saveSettings();
    this.updateModelToggleBtn();

    // 切换后检查配置
    if (newMode === 'local' && !resolveCoWriteLocalModel(settings)) {
      showWarningNotice('未配置本地模型，请在设置中配置', { timeout: 5000 });
    } else if (newMode === 'cloud') {
      const providerId = settings.coWriteCloudProvider || '';
      if (!providerId) {
        showWarningNotice('未配置云端供应商，请在设置中选择', { timeout: 5000 });
      } else {
        const apiKey = settings.providerKeys?.[providerId] || '';
        if (!apiKey) {
          showWarningNotice(`供应商 ${providerId} 未配置 API Key`, { timeout: 5000 });
        }
      }
    }
    showSuccessNotice(`已切换到${newMode === 'local' ? '本地' : '云端'}模型`, { timeout: 2000 });
  }
  /** v7.2: 更新模型切换按钮文字 */
  updateModelToggleBtn() {
    if (!this.modelToggleBtn) return;
    const settings = this.facade.settings;
    const mode = settings.coWriteModelMode || 'local';
    if (mode === 'cloud') {
      const providerId = settings.coWriteCloudProvider || '';
      const providerName = providerId ? (this.facade.settings.customProviders?.find(p => p.id === providerId)?.name || providerId) : '未配置';
      this.modelToggleBtn.textContent = `☁ ${providerName}`;
    } else {
      this.modelToggleBtn.textContent = '🖥 本地';
    }
  }

  /** 切换精准模式 */
  async togglePrecisionMode() {
    const current = this.facade.settings.precisionMode || false;
    const enabled = !current;
    this.facade.settings.precisionMode = enabled;
    await this.plugin.saveSettings();
    this.facade.setPrecisionMode(enabled);
    this.updatePrecisionModeBtn();
    this.updateHumanRateDashboard();
    showSuccessNotice(enabled ? '精准模式已开启' : '精准模式已关闭', { timeout: 2000 });
  }

  /** 更新精准模式按钮文字和高亮 */
  updatePrecisionModeBtn() {
    if (!this.precisionModeBtn) return;
    const enabled = this.facade.settings.precisionMode || false;
    if (enabled) {
      this.precisionModeBtn.textContent = '🎯 精准模式 ✓';
      this.precisionModeBtn.style.background = 'var(--nw-accent)';
      this.precisionModeBtn.style.color = '#fff';
    } else {
      this.precisionModeBtn.textContent = '🎯 精准模式';
      this.precisionModeBtn.style.background = '';
      this.precisionModeBtn.style.color = '';
    }
  }

  /** 渲染人工率仪表盘 */
  renderHumanRateDashboard() {
    renderHumanRatePanel({
      container: this.humanRateDashboard,
      precisionMode: this.facade.settings.precisionMode || false,
      editorText: this.rightEditor?.value || '',
    });
  }

  /**
   * 计算人工率各维度评分
   *
    * @returns number } 结果
   */
  calculateHumanRate(): HumanRateScores {
    return calculateHumanRate(this.rightEditor?.value || '');
  }

  /**
   * 将评分渲染到仪表盘容器
   *
   * @param scores - 分数表
   */
  renderHumanRateInto(scores: HumanRateScores) {
    if (!this.humanRateDashboard) return;
    renderHumanRate(this.humanRateDashboard, scores);
  }

  /** 更新人工率仪表盘 */
  updateHumanRateDashboard() {
    updateHumanRatePanel({
      container: this.humanRateDashboard,
      precisionMode: this.facade.settings.precisionMode || false,
      editorText: this.rightEditor?.value || '',
    });
  }
  /** v6.4: 推进到下一个未完成剧情节点 */
  async handleAdvanceNextNode() {
    const body = this.rightEditor.value;
    const progress = this.facade.getPlotProgress(body);
    if (progress.totalNodes === 0) {
      new Notice("本章未提取到剧情节点");
      return;
    }
    if (progress.allCompleted) {
      new Notice("本章所有剧情节点已推进完毕");
      return;
    }
    const node = progress.nextNode;
    const hintParts: string[] = [];
    if (node?.goal) hintParts.push(`推进剧情：${node.goal}`);
    if (node?.location) hintParts.push(`地点：${node.location}`);
    if (node?.characters) hintParts.push(`人物：${node.characters}`);
    if (node?.conflict) hintParts.push(`冲突：${node.conflict}`);
    const savedHint = this.cursorHint;
    this.cursorHint = hintParts.join("；");
    try {
      await this.handleTabSuggest(true);
    } finally {
      this.cursorHint = savedHint;
    }
  }

  /** v6.4: 根据当前节点进度更新"推进下一节点"按钮文字 */
  updateNextNodeButton() {
    if (!this.nextNodeBtn) return;
    const body = this.rightEditor.value;
    const progress = this.facade.getPlotProgress(body);
    let text: string;
    if (progress.totalNodes === 0) {
      text = "⏭ 无节点";
    } else if (progress.allCompleted) {
      text = "✓ 节点完成";
    } else {
      text = `⏭ 节点 ${progress.currentIndex + 1}/${progress.totalNodes}`;
    }
    this.nextNodeBtn.textContent = text;
  }
  private showSuggestionPanel() {
    this.toggleSuggestionPanel(true);
  }

  private toggleSuggestionPanel(visible: boolean) {
    if (!this.centerPanel) return;
    this.centerPanel.toggleClass('is-panel-collapsed', !visible);
    const settings = this.facade.settings;
    if (settings.coWriteSuggestionPanelVisible !== visible) {
      settings.coWriteSuggestionPanelVisible = visible;
      void this.plugin.saveSettings();
    }
  }

  private applyLayoutFromSettings() {
    if (!this.centerPanel) return;
    const settings = this.facade.settings;
    const layout = settings.coWriteLayout || 'split';
    const ratio = settings.coWriteEditorWidthRatio || 0.65;
    const panelVisible = settings.coWriteSuggestionPanelVisible !== false;

    this.centerPanel.toggleClass('is-stacked', layout === 'stacked');
    this.centerPanel.style.setProperty('--nw-cowrite-editor-percent', `${Math.max(40, Math.min(85, ratio * 100))}%`);
    this.centerPanel.toggleClass('is-panel-collapsed', !panelVisible);
  }

  /**
   * 编辑区 / 建议区 分隔条。
   *
   * 2026-10-29：改用统一原语 createPanelResizer（Pointer Events +
   * 键盘可达 + 双击复位），并复用已就位的节点以保持 DOM 顺序。
   * 比例仍存 coWriteEditorWidthRatio，写入 --nw-cowrite-editor-percent。
   */
  private initResizer() {
    if (!this.resizerEl || !this.centerPanel) return;

    const ratio = this.facade.settings.coWriteEditorWidthRatio || 0.65;
    this.layoutResizer = createPanelResizer({
      container: this.centerPanel,
      element: this.resizerEl,
      target: this.centerPanel,
      orientation: 'horizontal',
      side: 'before',
      unit: 'percent',
      cssVar: '--nw-cowrite-editor-percent',
      min: 40,
      max: 85,
      step: 2,
      value: Math.round(ratio * 100),
      defaultValue: 65,
      ariaLabel: '拖动调整编辑区宽度（方向键微调，双击复位）',
      onCommit: (percent) => {
        this.facade.settings.coWriteEditorWidthRatio = percent / 100;
        void this.plugin.saveSettings();
      },
    });

    this.register(() => {
      this.layoutResizer?.destroy();
      this.layoutResizer = null;
    });
  }

  /**
   * 渲染建议卡片列表。
   *
   * @param suggestions - 建议列表
   */
  renderSuggestionCards(suggestions: SuggestionRecord[]) {
    this.setGhostSuggestion(null);
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = `${suggestions.length} 条建议`;
    renderSuggestionCards(this.suggestionContent, suggestions, this.suggestionCardActions());
  }

  /** 组装建议卡动作宿主（采纳互斥锁仍由视图持有）。 */
  private suggestionCardActions(): SuggestionCardActions {
    return {
      onAccept: suggestion => this.handleAcceptSuggestion(suggestion),
      onEdit: (suggestion, initialText) => this.handleEditSuggestion(suggestion, initialText),
      onIterate: suggestion => this.handleIterateSuggestion(suggestion),
      onReject: suggestionId => this.rejectSuggestion(suggestionId),
      onContinue: async (modifiedText, suggestion, validation, editDurationMs) => {
        await this.insertTextAndRecord(modifiedText, suggestion, validation, editDurationMs);
      },
      tryBeginAccept: () => {
        if (this.acceptInFlight) return false;
        this.acceptInFlight = true;
        return true;
      },
      endAccept: () => {
        this.acceptInFlight = false;
      },
      createScoreCard: (label, value) => this.createScoreCard(label, value),
    };
  }
  // B2: 多轮迭代改写——基于单条候选做定向迭代，不重新生成整组
  /**
   * 对单条建议做迭代精修。
   *
   * @param suggestion - 建议
   */
  async handleIterateSuggestion(suggestion: SuggestionRecord) {
    const instruction = await this.promptIterateInstruction();
    if (!instruction)
      return;
    if (this.isSuggesting)
      return;
    this.isSuggesting = true;
    // Phase 3.2: 迭代与建议共用中止控制器，切章/关闭视图/新请求都会取消在途迭代
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    // NBI-05: 迭代结果受代次约束，切章或新请求开始后不再写回
    const epoch = this.beginSuggestionEpoch();
    try {
      const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
      const precedingText = this.rightEditor.value.slice(0, cursor);
      const iterated = await this.facade.iterateSuggestion(suggestion, instruction, precedingText, this.cursorHint, signal);
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
      if (!iterated) {
        showErrorNotice("\u8FED\u4EE3\u672A\u8FD4\u56DE\u65B0\u5019\u9009\uFF0C\u8BF7\u8C03\u6574\u6307\u4EE4\u540E\u91CD\u8BD5\u3002", { timeout: 2500 });
        return;
      }
      const idx = this.currentSuggestions.findIndex((s) => s.id === suggestion.id);
      if (idx >= 0)
        this.currentSuggestions[idx] = iterated;
      else
        this.currentSuggestions.push(iterated);
      if (this.currentRecord)
        this.currentRecord.suggestions = this.currentSuggestions;
      this.renderSuggestionCards(this.currentSuggestions);
      this.showKnowledgeInjectionNotice();
    } catch (e) {
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
      showErrorNotice("\u8FED\u4EE3\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", { timeout: 2500 });
    } finally {
      // 仅当控制器仍归本次迭代时复位，避免覆盖接管后的新请求状态
      if (this.suggestAbortController?.signal === signal) {
        this.suggestAbortController = null;
      }
      // NBI-05: 旧代次迭代不得清掉接管请求的进行态
      if (this.isCurrentSuggestionEpoch(epoch)) this.isSuggesting = false;
    }
  }
  // B2: 弹出输入框获取迭代指令
  /**
   * 向用户询问迭代指令。
   * @returns 指令文本或 null
   */
  promptIterateInstruction(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const modal = new IterateInstructionModal(this.app, (value) => resolve(value));
      modal.open();
    });
  }
  /**
   * 拒绝一条建议。
   *
   * @param suggestionId - 建议 ID
   */
  rejectSuggestion(suggestionId: string) {
    this.currentSuggestions = this.currentSuggestions.filter((s) => s.id !== suggestionId);
    if (this.ghostSuggestion?.id === suggestionId)
      this.setGhostSuggestion(null);
    if (this.currentRecord)
      this.currentRecord.suggestions = this.currentSuggestions;
    if (this.currentSuggestions.length > 0) {
      this.renderSuggestionCards(this.currentSuggestions);
    } else {
      this.renderEmptySuggestions("\u5DF2\u62D2\u7EDD\u672C\u8F6E\u5EFA\u8BAE\u3002\u6309 Tab / Ctrl+J \u91CD\u65B0\u751F\u6210\u3002");
    }
  }
  /**
   * 对选中文本做定向改写。
   */
  async handleRewriteSelection() {
    const start = this.rightEditor.selectionStart;
    const end = this.rightEditor.selectionEnd;
    if (start === end) {
      new Notice("\u8BF7\u5148\u9009\u4E2D\u9700\u8981\u6539\u5199\u7684\u6587\u672C\uFF0C\u518D\u6309 Ctrl+Shift+R\u3002", 2500);
      return;
    }
    if (this.isSuggesting)
      return;
    this.isSuggesting = true;
    // NBI-06: 改写与建议共用中止控制器，使「✕ 取消生成」与关闭视图对改写同样生效
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    // NBI-05: 改写结果同样受代次约束，切章后不再写回
    const epoch = this.beginSuggestionEpoch();
    // RG-02: 改写期间不允许接受上一轮建议
    this.clearStaleSuggestions();
    this.renderSuggestionLoading();
    const selectedText = this.rightEditor.value.slice(start, end);
    const beforeContext = this.rightEditor.value.slice(0, start);
    const afterContext = this.rightEditor.value.slice(end);
    // 记下改写区间：候选生成后用户可能点/移动到别处，采纳时必须替换这里
    this.pendingRewriteRange = { start, end, originalText: selectedText };
    this.currentRecord = {
      id: `rewrite_${Date.now()}`,
      triggerText: beforeContext.slice(-200),
      cursorPosition: start,
      suggestions: [],
      humanModifiedText: "",
      editDurationMs: 0,
      createdAt: Date.now()
    };
    try {
      const suggestions = await this.facade.rewriteSelection(
        selectedText,
        beforeContext,
        afterContext,
        this.cursorHint,
        3,
        (index, cumulative) => {
          if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
          this.updateStreamingPreview(index, cumulative);
        },
        signal
      );
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) {
        // 改写未产出：区间作废，避免后续普通建议误用
        this.pendingRewriteRange = null;
        if (this.isSuggestRequestOwner(signal)) {
          this.clearStreamingPreview();
          if (this.suggestionStatusText) this.suggestionStatusText.textContent = "已取消";
        }
        return;
      }
      this.currentSuggestions = suggestions;
      this.currentRecord.suggestions = suggestions;
      if (suggestions.length === 0) {
        this.pendingRewriteRange = null;
        this.renderEmptySuggestions("\u6CA1\u6709\u751F\u6210\u6539\u5199\u5019\u9009\u3002\u53EF\u4EE5\u8C03\u6574\u9009\u533A\u6216\u4E34\u65F6\u6307\u4EE4\u540E\u91CD\u8BD5\u3002");
        return;
      }
      this.renderSuggestionCards(suggestions);
      this.showKnowledgeInjectionNotice();
    } catch (e) {
      this.pendingRewriteRange = null;
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) {
        if (this.isSuggestRequestOwner(signal)) {
          this.clearStreamingPreview();
          if (this.suggestionStatusText) this.suggestionStatusText.textContent = "已取消";
        }
        return;
      }
      log.warn("[CoWritingView] \u9009\u533A\u6539\u5199\u5931\u8D25:", e);
      // RG-02: 失败时清理未完成的流式骨架，避免残留半成品状态
      this.clearStreamingPreview();
      this.renderEmptySuggestions("\u9009\u533A\u6539\u5199\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    } finally {
      // NBI-05/06: 仅当控制器仍归本次改写时复位，避免覆盖接管后的新请求状态
      if (this.suggestAbortController?.signal === signal) {
        this.isSuggesting = false;
        this.suggestAbortController = null;
      }
    }
  }
  /**
   * 把大纲节点展开为正文建议。
   */
  handleOutlineExpand() {
    const start = this.rightEditor.selectionStart;
    const end = this.rightEditor.selectionEnd;
    const selectedText = this.rightEditor.value.slice(start, end);
    const allText = this.rightEditor.value;
    const sourceText = selectedText || allText;

    const modal = new OutlineExpandModal(this.app, this.plugin, sourceText, {
      mode: selectedText ? 'paragraph' : 'chapter',
      targetWords: selectedText ? Math.max(500, Math.floor(selectedText.length * 2)) : 3000,
      // 正文为空时，弹窗回退读取本章 Scene 展开，避免左栏空白无法扩写
      chapterContext: {
        project: this.project,
        volumeNum: parseInt(this.volume.replace(/[^\d]/g, '')) || 1,
        chapterNum: this.chapterNum,
      },
    });
    modal.open();
  }
  /**
   * 生成联想/关联建议。
   */
  async handleAssociationSuggest() {
    if (this.isAssociating || this.isSuggesting)
      return;
    // UX 修复：未绑定章节时引擎未初始化，避免空等
    if (!this.project || !this.volume || !this.chapterNum) {
      new Notice("⚠️ 未绑定章节，请先在左侧选择卷/章后再联想", 3e3);
      return;
    }
    if (!this.rightEditor.value.trim() && !this.canColdStart()) {
      new Notice("⚠️ 正文为空且没有章节规划，请先完成 Scene 展开或手写一句再联想", 5000);
      return;
    }
    this.isAssociating = true;
    // 联想归属用独立令牌：其它流程递增 suggestionEpoch 不应让本次 finally 跳过复位
    const associationToken = ++this.associationSeq;
    // Phase 3.2: 联想与建议共用中止控制器，切章/关闭视图/新请求都会取消在途联想
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    // NBI-05: 联想结果受代次约束，切章后不再写回
    const epoch = this.beginSuggestionEpoch();
    // RG-02: 联想开始即作废旧候选，避免联想期间 Ctrl+1~3 插入上一轮建议
    this.clearStaleSuggestions();
    this.renderAssociationLoading();
    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    try {
      const associations = await this.facade.suggestAssociation(cursor, this.rightEditor.value, "manual", signal);
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
      // 联想不经过知识注入收口，这里同样要复查同人设定是否已失效
      this.warnFanficRulesOnce();
      if (associations.length === 0) {
        this.renderEmptySuggestions("\u6682\u65F6\u6CA1\u6709\u8054\u60F3\u5230\u5408\u9002\u7EED\u5199\u3002\u53EF\u4EE5\u591A\u5199\u4E00\u53E5\uFF0C\u6216\u7528 Tab \u751F\u6210\u65B9\u5411\u5EFA\u8BAE\u3002");
        return;
      }
      this.currentSuggestions = associations.map((association, index) => associationToSuggestion(association, index));
      this.currentRecord = {
        id: `assoc_${Date.now()}`,
        triggerText: this.rightEditor.value.slice(Math.max(0, cursor - 200), cursor),
        cursorPosition: cursor,
        suggestions: this.currentSuggestions,
        humanModifiedText: "",
        editDurationMs: 0,
        createdAt: Date.now()
      };
      this.setGhostSuggestion(this.currentSuggestions[0] || null);
      this.renderAssociationCards(associations, this.currentSuggestions);
    } catch (e) {
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
      log.warn("[CoWritingView] \u8054\u60F3\u8F93\u5165\u5931\u8D25:", e);
      this.showSuggestionPanel();
      if (this.suggestionStatusText) this.suggestionStatusText.textContent = "联想失败";
      this.suggestionContent.empty();
      this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-error", text: "\u8054\u60F3\u8F93\u5165\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    } finally {
      // 仅当控制器仍归本次联想时复位，避免覆盖接管后的新请求状态
      if (this.suggestAbortController?.signal === signal) {
        this.suggestAbortController = null;
      }
      // 只要没有更晚的联想接管，就必须复位；旧实现挂在 suggestionEpoch 上，
      // 联想期间按一次 Tab 就永久卡住联想与幽灵建议
      if (associationToken === this.associationSeq) this.isAssociating = false;
    }
  }
  /**
   * 渲染联想建议卡片。
   *
   * @param associations - 关联列表
   * @param suggestions - 建议列表
   */
  renderAssociationCards(associations: AssociationSuggestion[], suggestions: SuggestionRecord[]) {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = `${suggestions.length} 条联想`;
    renderAssociationCards(this.suggestionContent, associations, suggestions, this.suggestionCardActions());
  }
  /**
   * 渲染联想加载态。
   */
  renderAssociationLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "联想中...";
    renderAssociationLoading(this.suggestionContent);
  }
  /**
   * 按序号采纳建议。
   *
   * @param index - 索引
   */
  async acceptByIndex(index: number) {
    // RG-02: 生成/改写进行中时 currentSuggestions 可能仍是上一轮残留，禁止按索引接受
    if (this.isSuggesting) return;
    // 采纳进行中：Tab/Ctrl+1 连发时第二次不能把同一段文本再插一遍
    if (this.acceptInFlight) return;
    const suggestion = this.currentSuggestions[index];
    if (suggestion)
      await this.handleAcceptSuggestion(suggestion);
  }
  /**
   * 采纳建议并写入正文。
   *
   * @param suggestion - 建议
   */
  async handleAcceptSuggestion(suggestion: SuggestionRecord) {
    // 双击「接受」与连按 Tab 都走这里：异步窗口期（历史落盘/预览/指标评估）内必须互斥
    if (this.acceptInFlight) return;
    this.acceptInFlight = true;
    try {
      await this.insertTextAndRecord(suggestion.text, suggestion, void 0, 0);
    } finally {
      this.acceptInFlight = false;
    }
  }
  /**
   * 编辑建议后再采纳。
   *
   * @param suggestion - 建议
   * @param initialText - 参数
   */
  handleEditSuggestion(suggestion: SuggestionRecord, initialText?: string) {
    const startedAt = Date.now();
    const modal = new SuggestionEditModal(
      this.app,
      suggestion,
      initialText || suggestion.text,
      async (modifiedText) => {
        const context = this.getContextBeforeCursor(500);
        this.renderValidationLoading();
        try {
          const validation = await this.facade.validateEdit(modifiedText, suggestion, context);
          this.renderValidationResult(validation, modifiedText, suggestion, Date.now() - startedAt);
        } catch (e) {
          // 旧实现没有 catch：验证请求失败后建议面板永远停在「验证中…」，
          // 原候选卡片也已被 renderValidationLoading 清空，只能重新生成才能恢复。
          log.warn("[CoWritingView] 建议验证失败:", e);
          this.showSuggestionPanel();
          if (this.suggestionStatusText) this.suggestionStatusText.textContent = "验证失败";
          this.suggestionContent.empty();
          const box = this.suggestionContent.createDiv({ cls: "nw-cowrite-error-card novel-writer-cowrite-error" });
          box.createDiv({ cls: "nw-cowrite-error-card__text", text: "验证请求失败，请检查网络或模型配置后重试。" });
          const actions = box.createDiv({ cls: "nw-cowrite-error-card__actions" });
          const retry = actions.createEl("button", { text: "↻ 重新验证", cls: "nw-btn nw-btn-primary" });
          retry.addEventListener("click", () => this.handleEditSuggestion(suggestion, modifiedText));
          const dismiss = actions.createEl("button", { text: "返回建议", cls: "nw-btn nw-btn-ghost" });
          dismiss.addEventListener("click", () => this.renderSuggestionCards(this.currentSuggestions));
        }
      }
    );
    modal.open();
  }
  /**
   * 渲染编辑校验结果。
   *
   * @param validation - 校验结果
   * @param modifiedText - 修改后文本
   * @param suggestion - 建议
   * @param editDurationMs - 编辑耗时（毫秒）
   */
  renderValidationResult(validation: EditValidation, modifiedText: string, suggestion: SuggestionRecord, editDurationMs: number) {
    this.showSuggestionPanel();
    const degraded = validation.degraded === true;
    if (this.suggestionStatusText) {
      this.suggestionStatusText.textContent = degraded ? "校验未完成" : (validation.isValid ? "验证通过" : "存在风险");
    }
    renderValidationResult(this.suggestionContent, validation, modifiedText, suggestion, editDurationMs, this.suggestionCardActions());
  }
  /**
   * 插入文本并记录编辑交互。
   *
   * @param text - 文本内容
   * @param suggestion - 建议
   * @param validation - 校验结果
   * @param editDurationMs - 编辑耗时（毫秒）
   */
  async insertTextAndRecord(text: string, suggestion: SuggestionRecord, validation: EditValidation | undefined, editDurationMs: number) {
    // NBI-05: 记录接受时的代次，收尾时若已开始新一轮生成则不得覆盖其面板
    const epoch = this.suggestionEpoch;
    const editor = this.rightEditor;
    // 改写候选优先替换发起改写时的那段选区；普通建议用当前光标/选区
    const resolved = resolveInsertRange({
      text: editor.value,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      pendingRewrite: this.pendingRewriteRange,
    });
    if (resolved.staleRewrite) {
      // 原文在候选生成后被改动：宁可不应用，也不能覆盖用户新写的内容
      this.pendingRewriteRange = null;
      showWarningNotice("原文已改动，改写结果未应用。请重新选中文本后再改写。", { timeout: 4000 });
      this.finalizeAcceptedInsert(epoch);
      return;
    }
    const before = editor.value.slice(0, resolved.start);
    const after = editor.value.slice(resolved.end);
    const replacesSelection = resolved.end > resolved.start;
    const insertText = replacesSelection || text.startsWith("\n") || before.endsWith("\n") || before.length === 0 ? text : `
${text}`;
    const nextText = before + insertText + after;
    const newCursor = resolved.start + insertText.length;
    // 先取快照再清空候选：历史记录里的 suggestions 需要生成时那一轮
    const record = {
      ...this.currentRecord || {
        id: `rec_${Date.now()}`,
        triggerText: before.slice(-200),
        cursorPosition: resolved.start,
        suggestions: this.currentSuggestions,
        createdAt: Date.now()
      },
      chosenSuggestionId: suggestion.id,
      humanModifiedText: text,
      validationResult: validation,
      editDurationMs,
      acceptedAt: Date.now()
    };
    this.pendingRewriteRange = null;
    // 同步清空候选：后面的 await（历史落盘 / 预览 / 指标评估）窗口期内
    // 不能再按 Ctrl+1 或点「接受」拿到同一条
    this.currentSuggestions = [];
    this.setGhostSuggestion(null);
    this.applyProgrammaticEdit(nextText, newCursor, resolved.fromPendingRewrite ? '改写采纳' : '建议采纳');
    this.facade.recordInteraction(record);
    this.facade.syncEditRecord(record);
    this.facade.syncEditorCursor(newCursor);
    this.facade.syncChapterContent(nextText, nextText.trim().length);
    this.suggestionHistory.push(record);
    if (this.suggestionHistory.length > 20) this.suggestionHistory.shift();
    await this.historyStore.persistSuggestionHistory();
    this.updateStartButtonState();
    await this.refreshPreview(true);
    await this.refreshMetrics(false);
    this.liveAnalysis.scheduleRefresh("insert");
    this.finalizeAcceptedInsert(epoch);
  }

  /** NBI-05: 接受后的收尾；代次已变化说明期间开始了新一轮生成，保留其进度面板 */
  private finalizeAcceptedInsert(epoch: number): void {
    if (!this.isCurrentSuggestionEpoch(epoch)) return;
    this.currentSuggestions = [];
    this.setGhostSuggestion(null);
    this.currentRecord = null;
    this.renderEmptySuggestions("\u5DF2\u63D2\u5165\u3002\u7EE7\u7EED\u5199\u4F5C\u540E\u6309 Tab \u751F\u6210\u4E0B\u4E00\u8F6E\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u4F1A\u76F4\u63A5\u63A5\u53D7\u7B2C\u4E00\u6761\u3002");
    this.updateHumanRateDashboard();
  }
  /** 取消已排队的尾随渲染（强制刷新会立即渲染，视图关闭时也不能留定时器） */
  private clearPreviewTimer(): void {
    if (this.previewTimer !== null) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }
  /** 在节流窗口剩余时间后补一次渲染（连续输入只保留最后一次） */
  private schedulePreviewFlush(delay: number): void {
    this.clearPreviewTimer();
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.refreshPreview(false);
    }, delay);
  }
  /**
   * 刷新预览。
   *
   * @param force - 是否强制
   */
  async refreshPreview(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastPreviewAt < 500) {
      // 节流窗口内不能直接丢弃：最后一次输入往往就落在这里，丢了下一次输入前预览会一直落后
      this.schedulePreviewFlush(500 - (now - this.lastPreviewAt));
      return;
    }
    this.clearPreviewTimer();
    this.lastPreviewAt = now;
    const token = ++this.previewSeq;
    // 全量重渲染会重建 DOM 并把 scrollTop 归零：先记锚点，渲染后恢复
    const scrollSnapshot = this.previewContent
      ? captureScrollSnapshot(this.previewContent.scrollTop, this.previewContent.scrollHeight, this.previewContent.clientHeight)
      : null;
    const content = this.rightEditor?.value?.trim() || '';
    if (!content) {
      this.previewContent.empty();
      this.previewContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u6B63\u6587\u9884\u89C8\u4F1A\u5728\u8FD9\u91CC\u5B9E\u65F6\u540C\u6B65\u3002" });
      return;
    }
    // renderMarkdown 是异步的：直接写常驻 previewContent 时，旧一轮（或切章前）的
    // 渲染结果会追加到已清空/已重建的容器里，与新内容混在一起。先渲染到 detached
    // 容器，代次仍匹配才整体搬运。
    const staging = this.previewContent.ownerDocument.createElement('div');
    await MarkdownRenderer.renderMarkdown(content, staging, this.getBodyPath(), this);
    if (token !== this.previewSeq) return;
    this.previewContent.empty();
    while (staging.firstChild) {
      this.previewContent.appendChild(staging.firstChild);
    }
    this.applyHighlightsToDOM();
    if (scrollSnapshot) {
      this.previewContent.scrollTop = resolveRestoredScrollTop(
        scrollSnapshot,
        this.previewContent.scrollHeight,
        this.previewContent.clientHeight,
      );
    }
  }
  /** v6.4: 在已渲染的预览 DOM 中搜索质量问题文字并高亮 */
  private applyHighlightsToDOM() {
    applyQualityHighlights(this.previewContent, this.qualityIssues, {
      showPopup: (e, issue) => this.showQualityPopup(e, issue),
      hidePopup: () => this.hideQualityPopup(),
      showContextMenu: (e, issue) => this.showQualityContextMenu(e, issue),
    });
  }
  /**
   * 刷新指标。
   *
   * @param force - 是否强制
   */
  async refreshMetrics(force: boolean) {
    return runMetricsRefresh(this.metricsRefreshHost(), force);
  }
  /** 指标刷新宿主：状态读写经 getter/setter 转发，编排逻辑在 metrics-refresh。 */
  private metricsRefreshHost(): MetricsRefreshHost {
    const view = this;
    return {
      getProject: () => view.project,
      getChapterNum: () => view.chapterNum,
      getEditorText: () => view.rightEditor?.value || '',
      getLastPlotEval: () => view.lastPlotEval,
      setLastPlotEval: state => { view.lastPlotEval = state; },
      getAbortController: () => view.metricsAbortController,
      setAbortController: controller => { view.metricsAbortController = controller; },
      getMetricsStatus: () => view.metricsStatus,
      setMetricsStatus: status => { view.metricsStatus = status; },
      getSessionMetrics: () => view.facade.getSession()?.currentMetrics || null,
      evaluatePlotComplete: (text, signal) => view.facade.evaluatePlotComplete(text, signal),
      adjustDirection: metrics => view.facade.adjustDirection(metrics),
      syncPlotCompletion: metrics => view.facade.syncPlotCompletion(metrics),
      updateNextNodeButton: () => view.updateNextNodeButton(),
      renderMetrics: metrics => view.renderMetrics(metrics),
      renderFloatingMetrics: () => view.renderFloatingMetrics(),
    };
  }
  /** 指标渲染宿主：字段通过 getter 实时读取。 */
  private metricsHost(): MetricsRenderHost {
    const view = this;
    return {
      get metricsContainer() { return view.metricsContainer; },
      get rightEditor() { return view.rightEditor ?? null; },
      get metricsStatus() { return view.metricsStatus; },
      get project() { return view.project; },
      get volume() { return view.volume; },
      get chapterName() { return view.chapterName; },
      get targetWordCount() { return view.facade.settings.defaultWordCount || 3000; },
      get saveStateText() { return view.saveStateDisplay?.textContent || "\u672A\u77E5"; },
      refreshMetrics: force => view.refreshMetrics(force),
    };
  }
  /**
   * 渲染情节完成度指标。
   *
   * @param metrics - 指标
   */
  renderMetrics(metrics: PlotCompletionMetrics) {
    renderMetricsFn(this.metricsHost(), metrics);
  }
  /**
   * 渲染指标条。
   *
   * @param label - 显示标签
   * @param value - 值
   */
  renderMetricBar(label: string, value: number) {
    renderMetricBarFn(this.metricsHost(), label, value);
  }
  /**
   * 创建评分卡。
   *
   * @param label - 显示标签
   * @param value - 值
   * @returns 元素
   */
  createScoreCard(label: string, value: number) {
    return createScoreCardFn(label, value);
  }
  /**
   * RG-02: 新一轮生成/改写/联想开始前作废旧候选与幽灵建议。
   * 中止或失败路径不会回填候选，若不清理，Ctrl+1~3 仍能插入与当前面板不符的旧建议。
   */
  private clearStaleSuggestions(): void {
    this.currentSuggestions = [];
    this.setGhostSuggestion(null);
    // 新一轮生成（Tab / 联想 / 改写 / 切章）都会先走到这里：
    // 上一轮的改写区间必须随之作废，否则普通建议会拿它去替换一段无关正文。
    this.pendingRewriteRange = null;
  }

  /** RG-02: 清理动作是否仍归属最新一次生成请求，避免旧请求误清新请求的流式骨架与进度 */
  private isSuggestRequestOwner(signal: AbortSignal): boolean {
    return this.suggestAbortController?.signal === signal;
  }

  /** NBI-05: 开启新的建议上下文代次，使所有在途异步结果失效 */
  private beginSuggestionEpoch(): number {
    return ++this.suggestionEpoch;
  }

  /** NBI-05: 异步结果是否仍属于当前建议上下文（章节 + 最近一次请求） */
  private isCurrentSuggestionEpoch(epoch: number): boolean {
    return epoch === this.suggestionEpoch;
  }

  /** NBI-05: 切章时中止在途建议/改写并复位生成态，避免旧章结果继续写入 */
  private abortActiveSuggestion(): void {
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
      this.suggestProgressEmitter = null;
    }
    this.isSuggesting = false;
    if (this.suggestBtn) {
      this.suggestBtn.disabled = false;
      this.updateStartButtonState();
    }
    this.clearStreamingPreview();
  }

  /**
   * 渲染建议加载态。
   */
  renderSuggestionLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "生成中...";
    this.suggestionContent.empty();
    this.lastSuggestError = null;
    renderSuggestionLoading({
      container: this.suggestionContent,
      onCancel: () => this.cancelSuggestion(),
      onRetry: () => this.retrySuggestion(),
      setProgressContainer: el => { this.suggestProgressContainer = el; },
      setEtaDisplay: el => { this.suggestEtaDisplay = el; },
      setStepList: el => { this.suggestStepList = el; },
      resetStreamingCards: () => { this.streamingPreviewCards = []; },
      setStreamingContainer: el => { this.suggestStreamingContainer = el; },
      setCancelButton: el => { this.suggestCancelBtn = el; },
      setRetryButton: el => { this.suggestRetryBtn = el; },
      setErrorContainer: el => { this.suggestErrorContainer = el; },
      bindProgressEmitter: stepList => {
        if (this.suggestProgressEmitter) {
          stepList.bindEmitter(this.suggestProgressEmitter);
          this.suggestProgressEmitter.on((state: ProgressState) => {
            this.updateSuggestProgressUI(state);
          });
        }
      },
    });
  }

  /**
   * NBI-03: 展开流式候选预览骨架。
   * 首个回调（含空文本重置回调）到达时创建，容器已销毁则跳过。
   */
  private ensureStreamingPreview(): void {
    ensureStreamingPreview(this.suggestStreamingContainer, this.streamingPreviewCards);
  }

  /** NBI-03: 按候选索引更新流式文本，互不干扰 */
  private updateStreamingPreview(index: number, cumulativeText: string): void {
    this.ensureStreamingPreview();
    updateStreamingPreview(this.suggestStreamingContainer, this.streamingPreviewCards, index, cumulativeText);
  }

  /** NBI-03: 中止或异常时移除未完成的「生成中」卡片，避免 DOM 残留 */
  private clearStreamingPreview(): void {
    clearStreamingPreview(this.suggestStreamingContainer);
    this.streamingPreviewCards = [];
    this.suggestStreamingContainer = null;
  }

  private updateSuggestProgressUI(state: ProgressState): void {
    if (!this.suggestEtaDisplay) return;

    if (state.status === 'running' && state.eta !== undefined && state.eta >= 3000) {
      const seconds = Math.ceil(state.eta / 1000);
      if (seconds > 0) {
        this.suggestEtaDisplay.setText(`预估剩余: ${seconds} 秒`);
      }
    }

    if (state.status === 'failed') {
      this.showSuggestError(state.error || '生成失败，请重试');
    }

    if (state.status === 'cancelled') {
      if (this.suggestionStatusText) {
        this.suggestionStatusText.textContent = "已取消";
      }
    }
  }

  private showSuggestError(error: string): void {
    if (!this.suggestErrorContainer || !this.suggestRetryBtn || !this.suggestCancelBtn) return;

    this.suggestErrorContainer.style.display = 'block';
    this.suggestErrorContainer.empty();
    this.suggestErrorContainer.createDiv({
      text: "❌ 生成失败",
      attr: { style: "font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-error, #ef4444);" }
    });
    this.suggestErrorContainer.createDiv({
      text: error,
      attr: { style: "font-size:12px;color:var(--text-muted);" }
    });

    this.suggestRetryBtn.style.display = 'inline-flex';
    this.suggestCancelBtn.style.display = 'none';

    if (this.suggestionStatusText) {
      this.suggestionStatusText.textContent = "生成失败";
    }
  }

  private cancelSuggestion(): void {
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
    }
  }

  private retrySuggestion(): void {
    if (!this.lastSuggestParams) return;
    void this.handleTabSuggest(true);
  }

  /**
   * 渲染流式建议卡。
   *
   * @param direction - 方向
   * @param style - 文风
   * @param index - 索引
   * @param currentText - 当前文本
   * @param isStreaming - 是否流式
    * @returns HTMLElement 实例
   */
  renderStreamingSuggestionCard(
    direction: string,
    style: string,
    index: number,
    currentText: string,
    isStreaming: boolean
  ): HTMLElement {
    this.showSuggestionPanel();
    const statusText = isStreaming ? "生成中..." : `${index + 1} 条建议`;
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = statusText;
    return renderStreamingSuggestionCard(this.suggestionContent, direction, style, index, currentText, isStreaming);
  }

  /**
   * 流式生成建议。
   *
   * @param directionIndex - 方向索引
   */
  async handleStreamSuggestion(directionIndex: number = 0) {
    await runStreamSuggestion(this.suggestionFlowHost(), directionIndex);
  }
  /**
   * 显示知识注入提示。
   */
  showKnowledgeInjectionNotice() {
    // 生成完成后的统一收口：同人设定可能在会话中被删除/移动，这里补一次失效复查
    this.warnFanficRulesOnce();
    showKnowledgeNotice(this.facade.lastKnowledgeCount || 0, this.facade.lastKnowledgeDroppedCount || 0);
  }
  /**
   * 渲染校验加载态。
   */
  renderValidationLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "验证中...";
    this.suggestionContent.empty();
    renderValidationLoadingMessage(this.suggestionContent);
  }
  /**
   * 渲染空建议提示。
   *
   * @param message = "\u6309 Tab \u751F\u6210\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u63A5\u53D7\u7B2C\u4E00\u6761\u3002Ctrl+J \u6362\u4E00\u7EC4\uFF0CCtrl+K/Ctrl+Space \u8054\u60F3\uFF0C\u9009\u4E2D\u6587\u672C\u540E Ctrl+Shift+R \u6539\u5199\u3002" - 参数
   */
  renderEmptySuggestions(message = "\u6309 Tab \u751F\u6210\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u63A5\u53D7\u7B2C\u4E00\u6761\u3002Ctrl+J \u6362\u4E00\u7EC4\uFF0CCtrl+K/Ctrl+Space \u8054\u60F3\uFF0C\u9009\u4E2D\u6587\u672C\u540E Ctrl+Shift+R \u6539\u5199\u3002") {
    this.setGhostSuggestion(null);
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "等待生成";
    this.suggestionContent.empty();
    renderEmptySuggestionMessage(this.suggestionContent, message);
  }

  // ==================== 知识库 Tab 相关方法 ====================

  /**
   * 切换右栏页签。
   *
   * @param tab - 页签
   */
  switchRightTab(tab: 'overview' | 'knowledge') {
    this.activeRightTab = tab;
    this.facade.syncRightPanelTab(tab);
    const headers = this.rightTabHeaders.querySelectorAll('.nw-cowrite-tab-header');
    headers.forEach(h => {
      h.toggleClass('is-active', h.getAttribute('data-tab') === tab);
    });
    const contents = this.rightTabContents.querySelectorAll('.nw-cowrite-tab-content');
    contents.forEach(c => {
      c.toggleClass('is-active', c.getAttribute('data-tab') === tab);
    });
    if (tab === 'knowledge') {
      void this.loadKbBooks();
    }
  }

  /**
   * 渲染知识库页签。
   */
  renderKnowledgeTab() {
    const container = this.knowledgeTabContent;
    container.empty();

    const subTabHeaders = container.createDiv({ cls: "nw-kb-subtab-headers" });
    const subTabs: Array<{ key: 'books' | 'match' | 'quote' | 'advice'; label: string; icon: string }> = [
      { key: 'books', label: '书籍', icon: '📚' },
      { key: 'match', label: '匹配', icon: '🎯' },
      { key: 'quote', label: '引用', icon: '✨' },
      { key: 'advice', label: '建议', icon: '💡' },
    ];
    subTabs.forEach(tab => {
      const btn = subTabHeaders.createDiv({
        cls: `nw-kb-subtab-header${this.activeKbSubTab === tab.key ? ' is-active' : ''}`,
        text: `${tab.icon} ${tab.label}`,
        attr: { "data-subtab": tab.key }
      });
      btn.addEventListener('click', () => this.switchKbSubTab(tab.key));
    });

    this.kbSubTabContent = container.createDiv({ cls: "nw-kb-subtab-contents" });

    this.renderKbBooksTab();
    this.renderKbMatchTab();
    this.renderKbQuoteTab();
    this.renderKbAdviceTab();
  }

  /**
   * 切换知识库子页签。
   *
   * @param tab - 页签
   */
  switchKbSubTab(tab: 'books' | 'match' | 'quote' | 'advice') {
    this.activeKbSubTab = tab;
    const headers = this.knowledgeTabContent.querySelectorAll('.nw-kb-subtab-header');
    headers.forEach(h => {
      h.toggleClass('is-active', h.getAttribute('data-subtab') === tab);
    });
    const contents = this.kbSubTabContent.querySelectorAll('.nw-kb-subtab-content');
    contents.forEach(c => {
      c.toggleClass('is-active', c.getAttribute('data-subtab') === tab);
    });
    if (tab === 'books') {
      void this.loadKbBooks();
    } else if (tab === 'match') {
      this.refreshChapterMatch();
    } else if (tab === 'quote') {
      this.refreshQuotePanel();
    } else if (tab === 'advice') {
      this.refreshWritingAdvice();
    }
  }

  // ========== 子 Tab 1: 参考书籍列表 ==========

  /** 知识库面板宿主：把视图状态与动作以快照方式注入纯渲染模块 */
  private kbPanelHost(): KbPanelHost {
    return {
      books: this.kbBooksCache,
      expandedBookId: this.expandedBookId,
      editorText: this.rightEditor?.value || '',
      activeReferenceIds: this.facade.getReferenceBooks(),
      getKnowledgeBase: () => this.facade.knowledgeBaseManager?.getKnowledgeBase() ?? null,
      insertText: text => this.quickInsertText(text),
      insertTechnique: tech => this.insertTechniqueExample(tech),
      openKnowledgePanel: () => this.openKnowledgePanel(),
      setExpandedBookId: id => { this.expandedBookId = id; },
      refreshBookList: () => this.renderKbBookList(),
      toggleReferenceBook: (id, name, enable) => this.toggleReferenceBook(id, name, enable),
      setPrimaryReference: id => this.setPrimaryReference(id),
      adjustReferenceWeight: (id, weight) => this.adjustReferenceWeight(id, weight),
    };
  }

  /**
   * 渲染知识库书籍页签。
   */
  renderKbBooksTab() {
    const { searchInput, listContainer } = renderBooksTabContent(
      this.kbSubTabContent,
      this.kbPanelHost(),
      () => this.renderKbBookList(),
    );
    this.kbBookSearchInput = searchInput;
    this.kbBookListContainer = listContainer;
  }

  /**
   * 加载知识库书籍。
   */
  async loadKbBooks() {
    if (!this.facade.knowledgeBaseManager) return;
    try {
      this.kbBooksCache = await this.facade.knowledgeBaseManager.getAllBooks();
      this.renderKbBookList();
    } catch (e) {
      log.warn('[CoWritingView] 加载知识库书籍失败:', e);
    }
  }

  /**
   * 渲染书籍列表。
   */
  renderKbBookList() {
    if (!this.kbBookListContainer) return;
    renderBookList(
      this.kbBookListContainer,
      this.kbPanelHost(),
      this.kbBookSearchInput?.value.trim().toLowerCase() || '',
    );
  }

  /**
   * 启用/停用参考书。
   *
   * @param bookId - 书籍 ID
   * @param bookName - 书名
   * @param enable - 是否启用
   */
  toggleReferenceBook(bookId: string, bookName: string, enable: boolean): void {
    toggleReferenceBook(this.kbReferenceHost(), bookId, bookName, enable);
  }

  /**
   * 设置主参考书。
   *
   * @param bookId - 书籍 ID
   */
  setPrimaryReference(bookId: string): void {
    setPrimaryReference(this.kbReferenceHost(), bookId);
  }

  /**
   * 权重滑杆：写进设置并立即作用到注入器
   *
   * @param bookId - 书籍 ID
   * @param weight - 权重
   */
  adjustReferenceWeight(bookId: string, weight: number): void {
    adjustReferenceWeight(this.kbReferenceHost(), bookId, weight);
  }

  /** 参考书配置宿主：插件镜像/设置/引擎同步的唯一接线点。 */
  private kbReferenceHost(): KbReferenceHost {
    return {
      getReferences: () => this.facade.getReferenceBooks(),
      getWeights: () => this.plugin.settings.referenceBookWeights ?? {},
      mirrorReferences: ids => {
        this.plugin.referenceBookIds = ids;
        this.plugin.settings.referenceBookIds = ids;
      },
      setWeights: weights => {
        this.plugin.settings.referenceBookWeights = weights;
      },
      saveSettings: () => { void this.plugin.saveSettings(); },
      applyConfig: config => {
        void this.facade.setReferenceBooksWithWeight(config)
          .catch(e => log.warn('[CoWritingView] 应用参考书籍权重失败:', e));
      },
      renderBookList: () => this.renderKbBookList(),
      refreshChapterMatch: () => this.refreshChapterMatch(),
      refreshWritingAdvice: () => this.refreshWritingAdvice(),
      notifySuccess: message => showSuccessNotice(message, { timeout: 2000 }),
      notifyLimit: message => new Notice(message, 3e3),
    };
  }

  // ========== 子 Tab 2: 当前章节匹配 ==========

  /**
   * 渲染匹配页签。
   */
  renderKbMatchTab() {
    this.kbMatchContainer = renderMatchTabContent(this.kbSubTabContent, this.kbPanelHost());
  }

  /**
   * 刷新本章匹配。
   */
  refreshChapterMatch() {
    if (!this.kbMatchContainer) return;
    refreshMatchInto(this.kbMatchContainer, this.kbPanelHost());
  }

  // ========== 子 Tab 3: 快速引用 ==========

  /**
   * 渲染引用页签。
   */
  renderKbQuoteTab() {
    this.kbQuoteContainer = renderQuoteTabContent(this.kbSubTabContent, this.kbPanelHost());
  }

  /**
   * 刷新技法引用面板。
   */
  refreshQuotePanel() {
    if (!this.kbQuoteContainer) return;
    refreshQuoteInto(this.kbQuoteContainer, this.kbPanelHost());
  }

  /**
   * 插入技法示例。
   *
   * @param tech - 技法
   */
  insertTechniqueExample(tech: { name: string; description: string }) {
    const exampleText = `【${tech.name}】${tech.description}`;
    this.quickInsertText(exampleText);
    showSuccessNotice(`已插入：${tech.name}`, { timeout: 1500 });
  }

  /**
   * 快速插入文本。
   *
   * @param text - 文本内容
   */
  quickInsertText(text: string) {
    const editor = this.rightEditor;
    if (!editor) return;
    const start = resolveCursorPosition(editor.selectionStart, editor.value.length);
    const end = Math.max(start, resolveCursorPosition(editor.selectionEnd, editor.value.length, 'start'));
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const insert = before.endsWith('\n') || before.length === 0 ? text : text;
    const nextText = before + insert + after;
    this.applyProgrammaticEdit(nextText, start + insert.length, '知识库标签插入');
    void this.refreshPreview(false);
  }

  // ========== 子 Tab 4: 写作建议 ==========

  /**
   * 渲染建议页签。
   */
  renderKbAdviceTab() {
    this.kbAdviceContainer = renderAdviceTabContent(this.kbSubTabContent, this.kbPanelHost());
  }

  /**
   * 刷新写作建议。
   */
  refreshWritingAdvice() {
    if (!this.kbAdviceContainer) return;
    refreshAdviceInto(this.kbAdviceContainer, this.kbPanelHost());
  }

  // ==================== 知识库 Tab 方法结束 ====================

  /**
   * 设置幽灵建议。
   *
   * @param suggestion - 建议
   */
  setGhostSuggestion(suggestion: SuggestionRecord | null) {
    this.ghostSuggestion = suggestion;
    renderGhostSuggestion(this.ghostSuggestionContainer, suggestion);
  }
  private isGhostAssociationEnabled(): boolean {
    return this.plugin.settings.autoGhostAssociation !== false;
  }
  /**
   * 安排幽灵联想刷新（防抖）。
   */
  scheduleGhostAssociationRefresh() {
    this.setGhostSuggestion(null);
    if (!this.isGhostAssociationEnabled())
      return;
    this.ghostDebounceManager.debounceFixed('ghost-association', () => {
      void this.refreshGhostAssociation();
    }, 2500);
  }
  /**
   * 刷新幽灵联想。
   */
  async refreshGhostAssociation() {
    if (!this.isGhostAssociationEnabled()) {
      this.setGhostSuggestion(null);
      return;
    }
    const text = this.rightEditor?.value || "";
    const cursor = resolveCursorPosition(this.rightEditor?.selectionStart, text.length);
    const trigger = resolveGhostTrigger({
      enabled: true,
      isAssociating: this.isAssociating,
      isSuggesting: this.isSuggesting,
      suggestionCount: this.currentSuggestions.length,
      text,
      cursor,
      lastSeed: this.lastGhostSeed,
      now: Date.now(),
      lastRequestAt: this.lastGhostRequestAt,
      minIntervalMs: GHOST_ASSOCIATION_MIN_INTERVAL_MS,
    });
    if (!trigger) return;
    const seed = trigger.seed;
    this.lastGhostSeed = seed;
    this.lastGhostRequestAt = trigger.requestedAt;
    // NBI-05: 自动联想结果只在建议上下文未变化时写回
    const epoch = this.suggestionEpoch;
    // Phase 3.2: 自动联想同样可取消（关视图/切章/被新请求接管）
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    try {
      this.isAssociating = true;
      const associations = await this.facade.suggestAssociation(cursor, text, "space", signal);
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch) || this.isSuggesting || this.currentSuggestions.length > 0)
        return;
      // 设置可能在请求在途时被关闭：关闭后不得把结果写回界面
      if (!this.isGhostAssociationEnabled())
        return;
      // 自动联想是高频后台生成，同样要复查同人设定是否已失效
      this.warnFanficRulesOnce();
      this.currentSuggestions = associations.map((association, index) => associationToSuggestion(association, index));
      this.currentRecord = {
        id: `ghost_${Date.now()}`,
        triggerText: seed,
        cursorPosition: cursor,
        suggestions: this.currentSuggestions,
        humanModifiedText: "",
        editDurationMs: 0,
        createdAt: Date.now()
      };
      this.setGhostSuggestion(this.currentSuggestions[0] || null);
      this.renderAssociationCards(associations, this.currentSuggestions);
    } catch (e) {
      if (signal.aborted) return;
      log.warn("[CoWritingView] B1: \u81EA\u52A8\u8054\u60F3\u5931\u8D25:", e);
    } finally {
      if (this.suggestAbortController?.signal === signal) {
        this.suggestAbortController = null;
      }
      // NBI-05: 自动联想结束即释放联想进行态（结果写回已由代次守卫拦截）
      this.isAssociating = false;
    }
  }
  /**
   * 刷新状态栏。
   */
  refreshStatusBar() {
    renderStatusBar({
      statusBar: this.statusBar,
      wordCountDisplay: this.wordCountDisplay,
      wordGoalDisplay: this.wordGoalDisplay,
      project: this.project,
      volume: this.volume,
      chapterName: this.chapterName,
      chapterNum: this.chapterNum,
      editorText: this.rightEditor?.value || '',
      wordGoal: this.facade.settings.defaultWordCount || 3000,
    });
  }
  /**
   * 更新控件状态。
   *
   * @param state - 状态
   */
  updateControlState(state: string) {
    this.refreshStatusBar();
    updateSaveStateDisplay(this.saveStateDisplay, state);
  }
  /**
   * 应用提示。
   */
  applyHint() {
    this.cursorHint = this.hintInput.value.trim();
    this.facade.setCursorHint(this.cursorHint);
    // NBI-04: 记录已应用指令（空字符串同样记录，标识仅在非空且一致时显示）
    this.appliedHint = this.cursorHint;
    this.refreshHintState();
    showSuccessNotice(this.cursorHint ? `\u5DF2\u5E94\u7528\u4E34\u65F6\u6307\u4EE4\uFF1A${this.cursorHint}` : "\u5DF2\u6E05\u7A7A\u4E34\u65F6\u6307\u4EE4", { timeout: 2500 });
  }
  /**
   * 取光标前上下文。
   *
   * @param limit - 上限
   * @returns 文本
   */
  getContextBeforeCursor(limit: number) {
    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    return this.rightEditor.value.slice(0, cursor).slice(-limit);
  }
  /**
   * 取正文路径。
   * @returns 路径
   */
  getBodyPath() {
    // 已存在的正文可能带标题（第3章_风起_正文.md）：先查真实文件，再回退标准裸路径。
    // 旧实现永远拼裸路径，标题化章节会读空、保存时又新建第二个正文文件。
    const volN = volumeNumber(this.volume) || 1;
    return findBodyFileV4(this.app, this.project, volN, this.chapterNum)?.path
      ?? pjBodyFile(this.project, volN, this.chapterNum);
  }
  /**
   * 取正文目录。
   * @returns 目录
   */
  getBodyDir() {
    return buildBodyDir(this.project, this.volume);
  }
  /**
   * 取步骤结果目录列表。
   * @returns 目录数组
   */
  getStepResultDirs() {
    // v4.5.1 fix: 步骤结果目录也用 "第N章" 前缀，与 checkChaptersComplete 正则一致
    return buildStepResultDirs(this.project, this.volume, this.chapterNum);
  }
  private getStepFilePath(
    stepType: string,
    identity?: { project: string; volume: string; chapterNum: number }
  ): string {
    const project = identity?.project ?? this.project;
    const volume = identity?.volume ?? this.volume;
    const chapterNum = identity?.chapterNum ?? this.chapterNum;
    return buildStepFilePath(project, volume, chapterNum, stepType);
  }
  /**
   * 取章节标题。
   *
   * @param identity - 参数
   * @returns 标题
   */
  async getChapterTitle(
    identity?: { project: string; volume: string; chapterNum: number }
  ): Promise<string> {
    const project = identity?.project ?? this.project;
    const volume = identity?.volume ?? this.volume;
    if (!project || !volume) return '';
    try {
      const infoPlanPath = this.getStepFilePath('\u4FE1\u606F\u89C4\u5212', identity);
      const infoPlanFile = this.app.vault.getAbstractFileByPath(infoPlanPath);
      const infoPlanContent = infoPlanFile instanceof TFile ? await this.app.vault.read(infoPlanFile) : null;
      const infoPlanTitle = infoPlanContent ? extractChapterTitleFromInfoPlan(infoPlanContent) : '';
      if (infoPlanTitle) return infoPlanTitle;
      const outlinePath = this.getStepFilePath('\u5927\u7EB2\u6458\u8981', identity);
      const outlineFile = this.app.vault.getAbstractFileByPath(outlinePath);
      const outlineContent = outlineFile instanceof TFile ? await this.app.vault.read(outlineFile) : null;
      return outlineContent ? extractChapterTitleFromOutline(outlineContent) : '';
    } catch (e) {
      log.warn('[CoWritingView] 提取章节标题失败:', e);
    }
    return '';
  }
  /**
   * 确保 vault 目录存在。
   *
   * @param dirPath - 目录路径
   */
  async ensureVaultFolder(dirPath: string) {
    await ensureVaultFolder(this.app.vault, dirPath);
  }
  /**
   * 保存正文。
   *
   * @param showNotice - 提示函数
   * @returns 是否成功
   */
  async saveBody(showNotice: boolean): Promise<boolean> {
    // D2：保存管线已抽到 body-save-controller，方法签名保持不变
    return this.bodySaveController.save(showNotice);
  }

  /** 排一次自动保存（输入与程序化写入共用同一入口） */
  private scheduleAutoSave(): void {
    this.autoSaveDebouncer.debounceFixed("auto-save", () => {
      void this.saveBody(false);
    }, 2000);
  }

  /**
   * 程序化改写正文的唯一入口。
   *
   * 直接给 textarea 赋值不会派发 input，旧实现的自动保存只挂在 input 上，
   * 于是「采纳建议后立刻切章」时 `flushBeforeChapterSwitch` 看到没有 pending
   * 直接放行 → 刚插入的整段文字被新章正文覆盖掉。
   * @param nextText - 下一个文本
   * @param cursorPos - 光标位置
   * @param reason - 原因
   */
  applyProgrammaticEdit(nextText: string, cursorPos: number, reason: string): void {
    if (!this.rightEditor) return;
    this.rightEditor.value = nextText;
    const pos = Math.max(0, Math.min(cursorPos, nextText.length));
    this.rightEditor.selectionStart = this.rightEditor.selectionEnd = pos;
    this.rightEditor.focus();
    this.facade.updateSnapshot(nextText);
    // 快照已更新，但落盘必须显式排程
    this.bodySaveController.markDirty();
    this.updateControlState("编辑中");
    log.info(`[CoWritingView] 程序化写入（${reason}）: ${nextText.length} 字`);
  }

  /** 当前视图是否仍绑定快照里的章节（用于丢弃切章后的旧保存结果） */
  private isSameChapterIdentity(identity: {
    project: string;
    chapterNum: number;
    bodyPath: string;
  }): boolean {
    return isSameChapterIdentity(identity, {
      project: this.project,
      chapterNum: this.chapterNum,
      bodyPath: this.getBodyPath(),
    });
  }

  /**
   * 切章前冲刷上一章排队中的自动保存。
   * 行为与文档见 `BodySaveController#flushBeforeChapterSwitch`。
   */
  private async flushPendingBodySaveBeforeChapterSwitch(): Promise<boolean> {
    return this.bodySaveController.flushBeforeChapterSwitch();
  }

  /** 结算动作宿主：文件/弹窗/指标通过 getter 实时读取。 */
  private settlementHost(): SettlementActionsHost {
    const view = this;
    return {
      get app() { return view.app; },
      get plugin() { return view.plugin; },
      get project() { return view.project; },
      get volume() { return view.volume; },
      get chapterNum() { return view.chapterNum; },
      get chapterName() { return view.chapterName; },
      get rightEditor() { return view.rightEditor ?? null; },
      get statusBar() { return view.statusBar ?? null; },
      getBodyPath: () => view.getBodyPath(),
      saveBody: showNotice => view.saveBody(showNotice),
      renderMetrics: metrics => view.renderMetrics(metrics),
      refreshMetrics: force => view.refreshMetrics(force),
      getSessionMetrics: () => view.facade.getSession()?.currentMetrics || null,
      handleComplete: () => view.handleComplete(),
      openSettlementModal: () => {
        new ChapterSettlementModal(view.app, view.plugin, {
          project: view.project,
          volume: view.volume,
          chapterNum: view.chapterNum,
          chapterName: view.chapterName || `\u7B2C${view.chapterNum}\u7AE0`
        }).open();
      },
    };
  }
  /** P1-4: 检查章节是否需要结算，在状态栏显示提醒 */
  private checkSettlementDue(): void {
    checkSettlementDueFn(this.settlementHost());
  }
  /**
   * 标记本章已写。
   */
  async markAsWritten() {
    await markAsWrittenFn(this.settlementHost());
  }
  /**
   * 完成本章（触发结算/后续流程）。
   */
  async handleComplete() {
    await completeChapter(this.settlementHost());
  }

  /** P0-2: 结算前冲突检测提示（复用 ConflictDetector，失败不阻塞结算） */
  private async runSettlementConflictCheck(): Promise<void> {
    await runSettlementConflictCheckFn(this.settlementHost());
  }

  /**
   * 打开分析报告弹窗。
   */
  openAnalysisModal() {
    const text = this.rightEditor?.value || '';
    new NovelAnalysisModal(this.app, {
      text,
      projectName: this.project,
      plugin: this.plugin
    }).open();
  }

  /** 打开知识库视图 */
  openKnowledgePanel(): void {
    const workspace = this.app.workspace;
    const existingLeaves = workspace.getLeavesOfType('novel-writer-knowledge-base');
    if (existingLeaves.length > 0) {
      workspace.revealLeaf(existingLeaves[0]);
      return;
    }
    const leaf = workspace.getLeaf('tab');
    if (leaf) {
      leaf.setViewState({ type: 'novel-writer-knowledge-base', active: true });
    }
  }

  /** 打开批量导入弹窗 */
  openBatchImportModal() {
    if (!this.facade.knowledgeBaseManager || !this.plugin.knowledgeTagManager || !this.plugin.deconstructionScheduler) {
      new Notice('知识库未初始化，请稍候再试');
      return;
    }
    new BatchImportModal(this.app, {
      knowledgeBaseManager: this.facade.knowledgeBaseManager,
      deconstructionScheduler: this.plugin.deconstructionScheduler,
      tagManager: this.plugin.knowledgeTagManager,
      engineRegistry: this.plugin.engineRegistry,
      onComplete: () => {
        showSuccessNotice('批量导入完成');
      }
    }).open();
  }

  /** 打开知识库监控弹窗 */
  openKnowledgeMonitorModal() {
    if (!this.plugin.deconstructionScheduler || !this.facade.knowledgeBaseManager) {
      new Notice('知识库未初始化，请稍候再试');
      return;
    }
    new KnowledgeMonitorModal(
      this.app,
      this.plugin.deconstructionScheduler,
      this.facade.knowledgeBaseManager
    ).open();
  }

  /**
   * 获取当前光标在章节中的相对位置 (0-1)
   *
   * @returns 数值结果
   */
  getCursorRelativePosition(): number {
    const editor = this.rightEditor;
    if (!editor || !editor.value) return 0;
    const cursor = resolveCursorPosition(editor.selectionStart, editor.value.length, 'start');
    const total = editor.value.length || 1;
    return Math.min(1, Math.max(0, cursor / total));
  }

  /**
   * 获取光标前的文本（用于上下文检索）
   *
   * @param maxLen - 最大长度
   * @returns 文本结果
   */
  getPrecedingText(maxLen: number = 500): string {
    const editor = this.rightEditor;
    if (!editor) return '';
    const cursor = resolveCursorPosition(editor.selectionStart, editor.value.length, 'start');
    const start = Math.max(0, cursor - maxLen);
    return editor.value.slice(start, cursor);
  }

  /** v6.0: 打开质量检查 — 先保存正文，跳转全写作视图并定位到质量控制步骤（index=8） */
  async handleOpenQualityCheck() {
    await this.saveBody(true);
    await this.plugin.openFullWriterView?.();
    setTimeout(() => {
      const leaves = this.app.workspace.getLeavesOfType('novel-writer-full-writer');
      if (leaves.length > 0) {
        const view = leaves[0].view as unknown as {
            chapterStateManager?: { currentStepIndex: number };
            renderInContainer?: (container: HTMLElement) => void;
            tabContent?: HTMLElement;
        };
        if (view?.chapterStateManager) {
          view.chapterStateManager.currentStepIndex = 8;
          if (typeof view.renderInContainer === 'function' && view.tabContent) {
            view.renderInContainer(view.tabContent);
          }
        }
      }
    }, 300);
  }
  /**
   * v6.4: 将指标渲染到指定容器
   *
   * @param metrics - 指标
   * @param container - 容器元素
   */
  renderMetricsInto(metrics: PlotCompletionMetrics, container: HTMLElement) {
    renderMetricsIntoFn(this.metricsHost(), metrics, container);
  }
  /** v6.4: 加载质量控制报告 */
  async loadQualityReport() {
    if (!this.project || !this.volume || !this.chapterNum) {
      new Notice("\u26A0\uFE0F \u672A\u7ED1\u5B9A\u7AE0\u8282", 2000);
      return;
    }
    if (this.isQualityReportLoading) return;
    this.isQualityReportLoading = true;
    try {
      const chapterName = this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`;
      const reportPath = `${this.project}/${SUBDIR_STEP_ROOT}/${this.volume}/${chapterName}/${chapterName}_\u8D28\u91CF\u63A7\u5236.md`;
      const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
      if (!(reportFile instanceof TFile)) {
        new Notice("\u26A0\uFE0F \u8D28\u91CF\u63A7\u5236\u62A5\u544A\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u5728\u300C\u6D41\u7A0B\u89C4\u5212\u300D\u4E2D\u8FD0\u884C\u300C\u8D28\u91CF\u63A7\u5236\u300D\u6B65\u9AA4", 5000);
        return;
      }
      const content = await this.app.vault.read(reportFile);
      this.qualityIssues = this.parseQualityReport(content);
      this.toggleFloatingPanel(true);
      this.renderFloatingQuality();
      const count = this.qualityIssues.filter(i => i.severity === '\u274C').length;
      showSuccessNotice(`\u8D28\u68C0\u5B8C\u6210\uFF1A\u53D1\u73B0 ${count} \u4E2A\u95EE\u9898, ${this.qualityIssues.length} \u9879\u5F85\u5904\u7406`, { timeout: 3000 });
      this.refreshPreview(true);
    } catch (e) {
      log.warn('[CoWritingView] \u52A0\u8F7D\u8D28\u91CF\u63A7\u5236\u62A5\u544A\u5931\u8D25:', e);
      showErrorNotice("\u52A0\u8F7D\u8D28\u91CF\u63A7\u5236\u62A5\u544A\u5931\u8D25", { timeout: 3000 });
    } finally {
      this.isQualityReportLoading = false;
    }
  }

  /** v6.4: 解析质量控制报告 markdown 为结构化问题列表（实现见 co-writing/quality-report.ts） */
  private parseQualityReport(content: string): QualityIssue[] {
    return parseQualityReport(content);
  }

  /** v6.4: 浮窗显示问题详情 */
  private showQualityPopup(event: MouseEvent, issue: QualityIssue) {
    this.hideQualityPopup();
    this.qualityReportPopup = showQualityPopup(issue, event);
  }

  private hideQualityPopup() {
    hideQualityPopup(this.qualityReportPopup);
    this.qualityReportPopup = null;
  }

  /** v6.4: 右键菜单：AI 修复 */
  private showQualityContextMenu(event: MouseEvent, issue: QualityIssue) {
    showQualityContextMenu(event, issue, {
      onFix: () => { void this.handleQualityFix(issue); },
      onLocate: () => this.scrollToTextInEditor(issue.locationText),
    });
  }

  /** v6.4: 在编辑器中定位到包含指定文字的段落 */
  private scrollToTextInEditor(text: string) {
    scrollToTextInEditor(this.rightEditor, text);
  }

  /**
   * v6.4: AI 修复质量问题
   *
   * @param issue - 问题
   */
  async handleQualityFix(issue: QualityIssue) {
    if (!this.rightEditor?.value) {
      new Notice("\u26A0\uFE0F \u6B63\u6587\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u4FEE\u590D", 2000);
      return;
    }
    const fullText = this.rightEditor.value;
    const target = locateQualityTarget(fullText, issue.locationText);

    const fixingNotice = new Notice(`\uD83D\uDD27 \u6B63\u5728\u4FEE\u590D: ${issue.problem.slice(0, 30)}...`, 0);

    try {
      const prompt = buildQualityFixPrompt(issue, target);

      const response = await this.engine.callCoWriteForUi('', prompt, 0.3, 1200);
      const fixedText = response?.content || '';
      const application = resolveQualityFixApplication(this.rightEditor.value, target, fixedText);

      if (application.kind === 'stale') {
        showWarningNotice("\u6B63\u6587\u5DF2\u6539\u52A8\uFF0C\u672C\u6B21\u4FEE\u590D\u672A\u5E94\u7528\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B\u540E\u518D\u8BD5", { timeout: 4000 });
        return;
      }
      if (application.kind === 'replace') {
        this.applyProgrammaticEdit(application.newText, application.selection, 'AI 质量修复');
        void this.refreshPreview(true);
        showSuccessNotice("\u4FEE\u590D\u5B8C\u6210", { timeout: 2000 });
      } else if (application.kind === 'append') {
        this.applyProgrammaticEdit(application.newText, application.selection, 'AI 修复建议追加');
        void this.refreshPreview(true);
        showWarningNotice("\u672A\u5B9A\u4F4D\u5230\u7CBE\u786E\u4F4D\u7F6E\uFF0C\u5EFA\u8BAE\u5DF2\u8FFD\u52A0\u5728\u672B\u5C3E", { timeout: 3000 });
      }
    } catch (e) {
      log.warn('[CoWritingView] AI\u4FEE\u590D\u5931\u8D25:', e);
      showErrorNotice("AI \u4FEE\u590D\u5931\u8D25", { timeout: 2000 });
    } finally {
      fixingNotice.hide();
    }
  }

  // ---- 基础 UI 方法 ----

  /** 渲染左栏「本章简报」：大纲 + 场景列表 + 当前场景卡 + 信息释放 */
  private renderBriefPanel(): void {
    if (!this.briefContent) return;
    renderBriefPanel({
      container: this.briefContent,
      summaryEl: this.briefSummaryEl,
      getBrief: () => this.facade.getChapterBrief(),
      openFullWriterView: () => { void this.plugin.openFullWriterView(); },
      selectScene: index => {
        const brief = this.facade.getChapterBrief();
        const scene = brief?.scenes[index];
        this.facade.setCurrentSceneIndex(index);
        this.renderBriefPanel();
        this.updatePlotCompletion();
        showSuccessNotice(`已切换当前场景：第${scene?.index ?? index + 1}场 ${scene?.name || ""}`, { timeout: 2000 });
      },
    });
  }

  /** 空正文是否可以从章节规划冷启动 */
  private canColdStart(): boolean {
    return canColdStart(this.facade.getChapterBrief());
  }

  /** 空正文时把主按钮改为「生成开头」，避免用户找不到冷启动入口 */
  private updateStartButtonState(): void {
    updateStartButtonState(this.suggestBtn, this.isSuggesting, this.rightEditor?.value || '');
  }

  /**
   * 渲染全部面板。
   */
  async renderAllPanels() {
    const jobs: Array<() => Promise<void> | void> = [
      () => this.renderBriefPanel(),
      () => this.refreshPreview(true),
      () => this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics()),
      () => this.refreshMetrics(false),
      // 右侧监控卡的数据随章节/守卫变化：旧实现只在 renderLayout 时渲染过一次
      () => this.renderMonitorPanel(),
      () => {
        if (this.suggestionContent && !this.suggestionContent.children.length) this.renderEmptySuggestions();
      },
      () => {
        if (this.floatingPanel?.style.display === 'flex') {
          this.renderFloatingMetrics();
          this.renderFloatingQuality();
        }
      }
    ];
    for (const job of jobs) {
      try { await job(); } catch (e) { log.warn('[CoWritingView] 面板刷新失败:', e); }
    }
  }

  /**
   * 打开历史。
   */
  handleOpenHistory() {
    const records = this.engine?.getHistory?.() || this.engine?.getSession()?.interactions || [];
    new HistoryModal(this.app, records.slice(-20).reverse(), (text: string) => {
      if (!this.rightEditor) return;
      const start = this.rightEditor.selectionStart ?? this.rightEditor.value.length;
      const end = this.rightEditor.selectionEnd ?? start;
      const nextText = this.rightEditor.value.slice(0, start) + text + this.rightEditor.value.slice(end);
      this.applyProgrammaticEdit(nextText, start + text.length, '历史回填');
      void this.refreshPreview(true);
    }).open();
  }
  /**
   * 打开记忆管理。
   */
  handleOpenMemoryManager() {
    const snapshot = this.engine?.getMemorySnapshot?.() || { styleGuide: '', stylePatterns: [], preferencePrompt: '', preferences: [] };
    new MemoryManagerModal(this.app, snapshot, async (category: any, key: string, value: string) => {
      await this.facade.addExplicitPreference(category, key, value);
      showSuccessNotice('偏好记忆已写入', { timeout: 2000 });
    }).open();
  }

  private updatePlotCompletion(): void {
    try {
      const workspaceManager = this.plugin.workspaceManager;
      if (!workspaceManager) return;
      const panelB = workspaceManager.getMonitorPanelB();
      if (!panelB) return;

      const text = this.rightEditor?.value || '';
      // 与实时质量落盘共用同一章键构造：本章名可能不含章号（如「初始之痕」），
      // 直接用章节名会让同一章在质量历史里出现两种 key，基线把一章算成两章
      const chapterKey = buildQualityChapterKey(this.project, this.chapterNum, this.chapterName);
      // 协同写作视图不是 Markdown 文件，activeFile 推导不出项目；这里主动注入项目名，
      // 否则面板 B 的质量历史/基线拿不到项目，整章不恢复历史。
      if (this.project) {
        panelB.setActiveProject(this.project);
      }
      panelB.updateCompletion(text, chapterKey);
    } catch (e) {
      log.warn('[CoWritingView] 更新剧情完成度失败:', e);
    }
  }

  private renderMonitorPanel() {
    if (!this.monitorContainer) return;
    renderMonitorCards({
      container: this.monitorContainer,
      getInjectionLedgerText: () => this.facade.engine.getInjectionLedgerText(),
      getForeshadowSnapshot: () => {
        const snapshot = (this.facade.getSession() as unknown as {
          snapshot?: { foreshadows?: ForeshadowSnapshot };
        } | null)?.snapshot?.foreshadows;
        return snapshot || null;
      },
      getBodyPath: () => this.project && this.chapterNum ? this.getBodyPath() : '',
      getProject: () => this.project,
      getFile: path => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
      },
      getFiles: () => this.app.vault.getFiles(),
      getFrontmatter: file => this.app.metadataCache.getFileCache(file)?.frontmatter || {},
      getGuardSummary: () => this.liveAnalysis?.getGuardSummary?.() ?? null,
      getEditorText: () => this.rightEditor?.value || '',
    });
  }

  /** 供实时分析控制器在守卫/保存后刷新监控卡（旧实现只在布局时渲染一次） */
  refreshMonitorPanel(): void {
    this.renderMonitorPanel();
  }

  private async getAssetStatus() {
    return getAssetStatus(this.facade.knowledgeBaseManager, this.facade.getFingerprintLibrary());
  }

  private getCompletenessIcon(completeness: number): { icon: string; color: string } {
    return getCompletenessIcon(completeness);
  }

  private async renderAssetStatusBar(): Promise<void> {
    if (!this.assetStatusBar) return;
    const status = await this.getAssetStatus();
    renderAssetStatusBar(this.assetStatusBar, status, () => this.openRefillModal('knowledge'));
  }

  private openRefillModal(type: 'knowledge' | 'fingerprint'): void {
    if (type === 'knowledge') {
      if (!this.facade.knowledgeBaseManager || !this.plugin.deconstructionScheduler) {
        new Notice('知识库未初始化，请稍候再试');
        return;
      }
      const books = this.facade.knowledgeBaseManager.getAllBooks().then(allBooks => {
        const incompleteBook = allBooks.find(b => b.breakdownStatus !== 'completed');
        if (incompleteBook) {
          new RefillModal(this.app, {
            type: 'knowledge',
            bookId: incompleteBook.id,
            bookName: incompleteBook.name,
            knowledgeBaseManager: this.facade.knowledgeBaseManager!,
            deconstructionScheduler: this.plugin.deconstructionScheduler!,
          }).open();
        } else {
          new Notice('所有知识库书籍已完成拆解');
        }
      }).catch(() => {
        showErrorNotice('获取书籍列表失败');
      });
    }
  }
}
