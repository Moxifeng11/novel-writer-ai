/**
 * co-writing-view.ts — 句级协同写作视图 (v5.0)
 *
 * 交互闭环：Tab 生成建议 → 接受/编辑 → AI 验证 → 完成度调整方向。
 * （本文件为运行时恢复重建版，逻辑与上一个可用构建一致）
 */

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, TFile, Menu } from 'obsidian';
import { SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';
import { CHAPTER_FILE_TYPES } from '../engine/chapter-utils';

import NovelWriterPlugin from '../main';
import { CoWriterEngine, resolveCoWriteLocalModel } from '../engine/co-writer-engine';
import type { ChapterBriefInput } from '../engine/chapter-brief';
import { CoWriteFacade } from './services/co-write-facade';
import type { BookBasicInfo } from '../services/knowledge-base-manager';
import { WebnovelKnowledgeBase } from '../shared/webnovel-knowledge-base';
import { EndingTractionEngine } from '../engine/ending-traction-engine';
import { EmotionCurveView } from './components/emotion-curve-view';
import { createEmptyState } from './components/empty-state';
import { renderAIDetectionReport } from './components/ai-detection-report';
import { ChapterSnapshotBuilder } from '../engine/chapter-snapshot-builder';
import { ConflictDetector } from '../engine/conflict-detector';
import { ChapterSettlementModal } from './chapter-settlement-modal';
import { SuggestionEditModal } from './cowrite/suggestion-edit-modal';
import { IterateInstructionModal } from './cowrite/iterate-instruction-modal';
import { HistoryModal } from './cowrite/history-modal';
import { MemoryManagerModal } from './cowrite/memory-manager-modal';
import { RefillModal } from './refill-modal';
import { OutlineExpandModal } from './outline-expand-modal';
import { LiveAnalysisController } from './cowrite/live-analysis-controller';
import { shouldRunPlotEval, type PlotEvalGateState } from '../shared/plot-eval-throttle';
import { captureScrollSnapshot, resolveRestoredScrollTop } from '../shared/preview-scroll';
import { AdaptiveDebounceManager } from '../shared/adaptive-debounce-manager';
import { getCustomFontFamilies, registerAllCustomFonts, SYSTEM_FONT_PRESETS } from '../services/font-manager';
import { FontManagerModal } from './font-manager-modal';
import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from './model-quick-switcher';
import { SuggestionHistoryStore } from './cowrite/suggestion-history-store';
import { BodySaveController } from './cowrite/body-save-controller';
import { resolveInsertRange, type PendingRewriteRange } from './cowrite/insert-range';
import { BodyWriter } from '../engine/body-writer';
import {
    DEFAULT_BODY_FORMAT,
    INDENT_TWO_FULL_WIDTH,
    type BodyFormatContract,
} from '../shared/body-format';
import {
    countParagraphs,
    convertToChineseQuotes,
    describeContractShort,
    formatNovelManuscript,
    indentParagraphs,
    insertBlock,
    mergeSelectedParagraphs,
    splitParagraphAtCursor,
    toggleFirstLineIndent,
    toggleLinePrefix,
    wrapSelection,
    type TextEdit,
} from '../shared/novel-format';
import { applyNwScope } from '../utils/helpers';
import {
    associationTypeToDirection,
    getAssociationLabel,
    associationToSuggestion,
    getDirectionLabel,
    getStyleLabel,
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
} from '../shared/types';
import { VIEW_TYPE_MONITOR_B } from './monitor-panel-b';
import { AssociationSuggestion } from '../shared/co-writer-types';
import { ProgressEmitter, type ProgressState } from '../shared/progress-emitter';
import { StepListComponent } from './components/progress/step-list';
import { TimeEstimator } from '../shared/time-estimator';
import { RealtimeMonitor } from '../engine/quality/realtime-monitor';
import { QualityScoreEngine, type CharacterContextInfo } from '../engine/quality/quality-score-engine';
import { toCharacterContextInfos } from '../engine/character-context';
import { toForeshadowTrackings, applyPlannedRevealChapters } from '../engine/foreshadow-context';
import { WritingQualityEngine } from '../engine/writing-quality-engine';
import { PlotDivergenceEngine } from '../engine/plot-divergence-engine';
import { CharacterConsistencyChecker } from '../engine/character-consistency-checker';
import {
    DeviationDetector,
    type ForeshadowTracking,
} from '../engine/quality/deviation-detector';
import { createLogger } from '../shared/logger';
import { createPanelResizer, type PanelResizerHandle } from './panel-resizer';
import { DEVIATION_CHARACTER_INFO_TTL_MS, GHOST_ASSOCIATION_MIN_INTERVAL_MS } from '../shared/thresholds';
import { shouldRequestGhostAssociationByInterval } from '../shared/ghost-trigger';
import { resolveCursorPosition } from '../shared/cursor-position';
import { describePrerequisiteGaps, PREREQ_MIN_BODY_CHARS, type PrerequisiteCheck } from '../shared/prereq-check';
import { buildQualityChapterKey } from '../shared/quality-history';
import { RealtimeQualityController } from './cowrite/realtime-quality-controller';
import { isImeComposing } from '../shared/keyboard';


const log = createLogger('CoWritingView');
export interface QualityIssue {
    id: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
    problem: string;
    suggestion: string;
    locationText: string;
    severity: '❌' | '⚠️' | '✅';
}

export const VIEW_TYPE_CO_WRITE = 'novel-writer-co-writing';

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
    const kernel = new WritingQualityEngine();
    return new RealtimeMonitor({
      scoreEngine: new QualityScoreEngine({ v1Engine: kernel }),
      // 与 quality-worker / heavy-task 对齐：两者都是纯计算引擎，注入后协同实时
      // 偏离才走 V1 人物一致性检测，而不是简化版关键词回退。
      deviationDetector: new DeviationDetector({
        plotDivergenceEngine: new PlotDivergenceEngine(),
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
      new Notice('⚠️ 协同写作未配置本地模型，请在设置中配置', 8000);
    } else if (mode === 'cloud') {
      const providerId = this.facade.settings.coWriteCloudProvider || '';
      if (!providerId) {
        new Notice('⚠️ 云端模式未选择供应商，请在设置中配置', 8000);
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
  async clearChapterBinding(): Promise<void> {
    if (!this.project && !this.chapterName) {
      this.statusBar?.setText("未绑定章节");
      return;
    }
    // 未落盘的旧正文先按旧身份保存；失败则中止清空，避免丢字
    const flushed = await this.flushPendingBodySaveBeforeChapterSwitch();
    if (!flushed) {
      new Notice("⚠️ 上一章正文未能保存，已取消清空章节绑定", 4e3);
      return;
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
    // 只传 2 个参数时旧默认值是「第1卷/第1章」，会把第 3 卷第 12 章绑定成第 1 卷第 1 章、
    // 保存直接写错文件。缺失参数时按章名推定章号，并按正文实际位置反查卷。
    const parsedChapterNum = parseInt(chapterName2.match(/第(\d+)章/)?.[1] || '', 10);
    const resolvedChapterNum = chapterNum && chapterNum > 0
      ? chapterNum
      : (Number.isFinite(parsedChapterNum) && parsedChapterNum > 0 ? parsedChapterNum : 1);
    const resolvedVolume = volume2 || this.resolveVolumeForChapter(project, resolvedChapterNum) || "\u7B2C1\u5377";
    volume2 = resolvedVolume;
    chapterNum = resolvedChapterNum;
    // 上一章排队中的自动保存必须先用「旧身份」落盘：下面一旦改写 project/chapterNum，
    // 2s 防抖里的保存就会用新章路径写入旧章正文（静默串章）。
    const flushed = await this.flushPendingBodySaveBeforeChapterSwitch();
    if (!flushed) {
      new Notice("⚠️ 上一章正文未能保存，已取消切章", 4e3);
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
        bodyOnly = fullContent.replace(/^---[\s\S]*?---\s*/, '');
        bodyOnly = bodyOnly.replace(/^#\s+第\d+章[^\n]*\n+/, '');
        bodyOnly = bodyOnly.replace(/<!--\s*正文区域.*?-->\s*/g, '');
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
    await this.refreshPreview(true);
    try {
      await this.facade.initEngine(project, chapterName2, volume2, chapterNum);
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
      new Notice("\u26A0\uFE0F \u4E0A\u4E0B\u6587\u52A0\u8F7D\u5931\u8D25\uFF0C\u53E5\u7EA7\u5EFA\u8BAE\u53EF\u80FD\u53D7\u9650", 4e3);
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
    nextBtn.addEventListener("click", () => this.handleAdvanceNextNode());
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
    completeBtn.addEventListener("click", () => this.handleComplete());

    // —— ✨ 辅助润色 ——
    const assistSection = actionsArea.createDiv({ cls: "nw-cowrite-action-section" });
    assistSection.createDiv({ cls: "nw-cowrite-action-section-title", text: "✨ 辅助润色" });
    const assistRow = assistSection.createDiv({ cls: "nw-cowrite-action-row" });
    const assocBtn = assistRow.createEl("button", { text: "✨ 联想", cls: "nw-btn nw-btn-ghost", attr: { title: "联想后续情节走向" } });
    assocBtn.addEventListener("click", () => this.handleAssociationSuggest());
    const expandBtn = assistRow.createEl("button", { text: "✍️ 扩写", cls: "nw-btn nw-btn-ghost", attr: { title: "扩写选中段落" } });
    expandBtn.addEventListener("click", () => this.handleOutlineExpand());
    const rewriteBtn = assistRow.createEl("button", { text: "✂ 改写", cls: "nw-btn nw-btn-ghost", attr: { title: "改写选中段落（降 AI 痕迹 / 换文风）" } });
    rewriteBtn.addEventListener("click", () => this.handleRewriteSelection());

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
      { text: "📋 质检", action: () => void this.loadQualityReport() },
      { text: "💾 保存", action: () => this.saveBody(true) },
      { text: "✅ 标记完稿", action: () => this.markAsWritten() },
    ];
    for (const btn of toolButtons) {
      const el = toolsPanel.createEl("button", { text: btn.text, cls: "nw-btn nw-btn-ghost" });
      el.addEventListener("click", () => {
        toolsPanel.removeClass("is-open");
        toolsToggle.setText("⚙ 更多工具");
        btn.action();
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
    new Notice(warning, 8000);
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
    const toolbar = wrap.createDiv({ cls: 'nw-cowrite-md-toolbar' });
    let group = toolbar.createDiv({ cls: 'nw-cowrite-md-group' });
    const addSeparator = () => {
      toolbar.createDiv({ cls: 'nw-cowrite-md-sep' });
      group = toolbar.createDiv({ cls: 'nw-cowrite-md-group' });
    };
    const addButton = (label: string, title: string, handler: () => void, cls = '') => {
      const button = group.createEl('button', {
        text: label,
        cls: `nw-cowrite-md-btn ${cls}`.trim(),
        attr: { type: 'button', title, 'aria-label': title },
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        handler();
      });
    };
    const selection = () => ({
      start: this.rightEditor?.selectionStart ?? 0,
      end: this.rightEditor?.selectionEnd ?? 0,
    });
    const indent = () => this.editorContract.indent || INDENT_TWO_FULL_WIDTH;
    const applyEdit = (fn: (text: string, start: number, end: number) => TextEdit) => {
      const editor = this.rightEditor;
      if (!editor) return;
      const { start, end } = selection();
      this.applyTextEdit(fn(editor.value, start, end));
    };

    addButton('B', '加粗（Ctrl+B）', () => applyEdit((text, s, e) => wrapSelection(text, s, e, '**')));
    addButton('I', '斜体（Ctrl+I）', () => applyEdit((text, s, e) => wrapSelection(text, s, e, '*')));
    addButton('H', '二级标题（Ctrl+Alt+2）', () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '## ')));
    addButton('❝', '引用（Ctrl+Alt+Q）', () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '> ')));
    addButton('•', '无序列表（Ctrl+Alt+L）', () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '- ')));
    addButton('―', '分隔线', () => {
      const { start } = selection();
      const editor = this.rightEditor;
      if (editor) this.applyTextEdit(insertBlock(editor.value, start, '---'));
    });

    addSeparator();
    addButton('⇥', '首行缩进/取消（Ctrl+Alt+I）', () => applyEdit((text, s, e) => toggleFirstLineIndent(text, s, e, indent())));
    addButton('↹', '增加段落缩进（Ctrl+]）', () => applyEdit((text, s, e) => indentParagraphs(text, s, e, indent(), 1)));
    addButton('⇤', '减少段落缩进（Ctrl+[）', () => applyEdit((text, s, e) => indentParagraphs(text, s, e, indent(), -1)));
    addButton('¶', '合并选中段落', () => applyEdit((text, s, e) => mergeSelectedParagraphs(text, s, e)));
    addButton('↵', '在光标处拆分段落', () => {
      const { start } = selection();
      const editor = this.rightEditor;
      if (editor) this.applyTextEdit(splitParagraphAtCursor(editor.value, start, this.editorContract));
    });
    addButton('“”', '选中文本转中文引号', () => applyEdit((text, s, e) => convertToChineseQuotes(text, s, e)));

    addSeparator();
    addButton('⚡ 一键排版', '按项目写作规则排版全文（Ctrl+Alt+F）', () => void this.applyNovelFormat(), 'is-primary');
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
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && event.altKey) {
      if (key === '1' || key === '2' || key === '3') {
        event.preventDefault();
        const prefix = `${'#'.repeat(Number(key))} `;
        const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
        this.applyTextEdit(toggleLinePrefix(this.rightEditor.value, start, end, prefix));
        return true;
      }
      if (key === 'q') {
        event.preventDefault();
        const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
        this.applyTextEdit(toggleLinePrefix(this.rightEditor.value, start, end, '> '));
        return true;
      }
      if (key === 'l') {
        event.preventDefault();
        const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
        this.applyTextEdit(toggleLinePrefix(this.rightEditor.value, start, end, '- '));
        return true;
      }
      if (key === 'i') {
        event.preventDefault();
        const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
        this.applyTextEdit(toggleFirstLineIndent(this.rightEditor.value, start, end, this.editorContract.indent || INDENT_TWO_FULL_WIDTH));
        return true;
      }
      if (key === 'f') {
        event.preventDefault();
        void this.applyNovelFormat();
        return true;
      }
      return false;
    }
    if (!mod || event.shiftKey || event.altKey) return false;
    if (key === 'b' || key === 'i') {
      event.preventDefault();
      const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
      this.applyTextEdit(wrapSelection(this.rightEditor.value, start, end, key === 'b' ? '**' : '*'));
      return true;
    }
    if (event.key === '`') {
      event.preventDefault();
      const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
      this.applyTextEdit(wrapSelection(this.rightEditor.value, start, end, '`'));
      return true;
    }
    if (event.key === ']' || event.key === '[') {
      event.preventDefault();
      const start = this.rightEditor.selectionStart;
        const end = this.rightEditor.selectionEnd;
      this.applyTextEdit(indentParagraphs(
        this.rightEditor.value,
        start,
        end,
        this.editorContract.indent || INDENT_TWO_FULL_WIDTH,
        event.key === ']' ? 1 : -1,
      ));
      return true;
    }
    return false;
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
    new Notice(`已按小说格式排版：${describeContractShort(contract)}${sourceHint}`, 4000);
  }

  /**
   * 处理编辑器快捷键（Tab 建议/格式命令）。
   *
   * @param event - 事件
   */
  async handleEditorKeydown(event: KeyboardEvent) {
    // P1-15（v4.27）：中文输入法组合期间不拦截任何按键，
    // 否则 Tab/数字键会被当成「接受建议」，候选词被打断。
    if (event.isComposing || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229) return;
    if (this.handleMarkdownShortcut(event)) return;
    if (event.key === "Tab") {
      event.preventDefault();
      // NBI-05: 生成中不接受幽灵建议，避免绕过候选就绪守卫
      if (this.ghostSuggestion && !this.isSuggesting) {
        await this.handleAcceptSuggestion(this.ghostSuggestion);
      } else if (this.currentSuggestions.length > 0) {
        await this.acceptByIndex(0);
      } else {
        await this.handleTabSuggest(false);
      }
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "1") {
      event.preventDefault();
      await this.acceptByIndex(0);
      return;
    }
    if (mod && event.key === "2") {
      event.preventDefault();
      await this.acceptByIndex(1);
      return;
    }
    if (mod && event.key === "3") {
      event.preventDefault();
      await this.acceptByIndex(2);
      return;
    }
    if (mod && event.key === " ") {
      event.preventDefault();
      await this.handleAssociationSuggest();
      return;
    }
    if (mod && event.key.toLowerCase() === "j") {
      event.preventDefault();
      await this.handleTabSuggest(true);
      return;
    }
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      await this.handleAssociationSuggest();
      return;
    }
    if (mod && event.key.toLowerCase() === "h") {
      event.preventDefault();
      this.handleOpenHistory();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.handleRewriteSelection();
      return;
    }
    if (mod && event.key.toLowerCase() === "r") {
      event.preventDefault();
      await this.handleTabSuggest(true);
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      await this.saveBody(true);
      return;
    }
    if (mod && event.key === ".") {
      event.preventDefault();
      this.hintInput.focus();
      return;
    }
    if (event.key === "Escape") {
      this.currentSuggestions = [];
      this.currentRecord = null;
      this.renderEmptySuggestions("\u5DF2\u53D6\u6D88\u5F53\u524D\u5EFA\u8BAE\u3002\u6309 Tab / Ctrl+J \u91CD\u65B0\u751F\u6210\u3002");
    }
  }
  /**
   * 触发 Tab 建议生成。
   *
   * @param force = false - 参数
   */
  async handleTabSuggest(force = false) {
    // UX 修复：未绑定章节时 CoWriterEngine 未初始化，原逻辑会空等数十秒才显示「无建议」
    if (!this.project || !this.volume || !this.chapterNum) {
      new Notice("⚠️ 未绑定章节，请先在左侧选择卷/章后再生成建议", 3e3);
      return;
    }
    if (!this.rightEditor?.value?.trim() && !this.canColdStart()) {
      new Notice("⚠️ 本章还没有 Scene 展开/大纲，请先完成步骤 6「Scene 展开」，或直接手写一句再生成建议", 6000);
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastSuggestAt < 500)
      return;
    // v6.3: 先 abort 旧请求（即使 isSuggesting=true 也允许覆盖），再设新请求
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
      this.suggestProgressEmitter = null;
    }
    if (this.isSuggesting) {
      // 旧请求刚被 abort，isSuggesting 会在其 finally 块自行清除；此处不阻塞新请求
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    // NBI-05: 本次请求代次，切章或后续请求会使旧代次失效
    const epoch = this.beginSuggestionEpoch();

    this.lastSuggestAt = now;
    this.isSuggesting = true;
    this.facade.syncSuggestionsGenerating(true);
    // BUG-K fix: 生成期间禁用建议按钮，给出视觉反馈
    if (this.suggestBtn) {
      this.suggestBtn.disabled = true;
      this.suggestBtn.textContent = "⏳ 生成中...";
    }

    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    const precedingText = this.rightEditor.value.slice(0, cursor);

    this.lastSuggestParams = {
      precedingText,
      cursorHint: this.cursorHint,
      mode: "continue",
      count: 3
    };

    this.suggestProgressEmitter = new ProgressEmitter(`suggest_${Date.now()}`, '生成建议');
    this.suggestProgressEmitter.registerSteps([
      '检索知识库内容',
      '分析写作上下文',
      '生成写作建议'
    ]);

    // RG-02: 新一轮生成开始即作废旧候选，避免中止/失败后快捷键仍能插入上一轮建议
    this.clearStaleSuggestions();
    this.renderSuggestionLoading();
    this.suggestProgressEmitter.start();

    const startTime = Date.now();
    const wordCount = precedingText.length;
    // 本地模型（Ollama）耗时高度不确定，统计 ETA 会给出「预估剩余 1 秒」这类误导信息，直接跳过
    const isLocalModelMode = (this.facade.settings?.coWriteModelMode || 'local') !== 'cloud';
    // 串行生成时展示「第 N/M 条」，避免单条耗时较长被误认为卡死
    let suggestProgressTimer: number | null = null;
    if (isLocalModelMode && this.suggestEtaDisplay) {
      this.suggestEtaDisplay.setText("本地模型生成需要一些时间，请耐心等待…");
      suggestProgressTimer = window.setInterval(() => {
        const progress = this.facade.getSuggestProgress();
        if (progress && progress.total > 0 && this.suggestEtaDisplay) {
          this.suggestEtaDisplay.setText(`正在生成第 ${progress.current}/${progress.total} 条建议…`);
        }
      }, 1000);
    }

    if (this.timeEstimator && !isLocalModelMode) {
      const est = this.timeEstimator.estimate({
        operationType: 'co_write_suggest',
        wordCount,
        mode: 'statistical'
      });
      if (est.confidence > 0) {
        this.suggestProgressEmitter.setProgress(1, `预计约 ${Math.ceil(est.eta / 1000)} 秒`);
      }
    }
    this.currentRecord = {
      id: `rec_${Date.now()}`,
      triggerText: precedingText.slice(-200),
      cursorPosition: cursor,
      suggestions: [],
      humanModifiedText: "",
      editDurationMs: 0,
      createdAt: Date.now()
    };
    let success = false;
    try {
      if (signal.aborted) return;
      this.suggestProgressEmitter.nextStep('正在检索知识库...');

      await this.simulateStepDelay(300, signal);
      if (signal.aborted) return;

      this.suggestProgressEmitter.setStepProgress(50, '正在匹配相关知识片段...');
      await this.simulateStepDelay(200, signal);
      if (signal.aborted) return;

      this.suggestProgressEmitter.nextStep('正在分析写作上下文...');
      this.suggestProgressEmitter.setStepProgress(30, '分析剧情进度与角色状态...');

      await this.simulateStepDelay(200, signal);
      if (signal.aborted) return;

      this.suggestProgressEmitter.setStepProgress(70, '调整建议方向...');
      await this.simulateStepDelay(200, signal);
      if (signal.aborted) return;

      this.suggestProgressEmitter.nextStep('正在生成写作建议...');
      this.suggestProgressEmitter.setStepProgress(10, '调用 AI 模型...');

      const suggestions = await this.facade.suggestNext(
        precedingText,
        this.cursorHint,
        "continue",
        3,
        signal,
        (index, cumulative) => {
          if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) return;
          this.updateStreamingPreview(index, cumulative);
        }
      );
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) {
        // NBI-03: 中止时引擎可能已回流空数组，这里主动清理未完成的流式骨架
        // RG-02: 仅最新请求可清理，避免被新请求中止的旧请求误清新请求的骨架
        // NBI-05: 切章后旧代次结果一律丢弃，不回填新章节
        if (this.isSuggestRequestOwner(signal)) this.clearStreamingPreview();
        return;
      }

      this.suggestProgressEmitter.setStepProgress(100, '生成完成');
      this.suggestProgressEmitter.complete();

      const duration = Date.now() - startTime;
      if (this.timeEstimator) {
        this.timeEstimator.record({
          operationType: 'co_write_suggest',
          wordCount,
          mode: 'statistical',
          duration
        });
        void this.timeEstimator.saveHistory();
      }

      this.currentSuggestions = suggestions;
      this.currentRecord.suggestions = suggestions;
      this.facade.syncSuggestionsReady(suggestions, 'action');
      success = true;
      if (suggestions.length === 0) {
        const engineError = this.facade.getLastSuggestError();
        if (this.suggestionStatusText) this.suggestionStatusText.textContent = engineError ? "生成失败" : "无建议";
        this.suggestionContent.empty();

        // 引擎已捕获到具体失败原因（密钥未解锁/401/超时等）时直接展示，不再误报成「知识库未拆解」
        if (engineError) {
          // 注意：上面的 empty() 已经把进度容器（含错误区与重试按钮）摘掉，
          // 旧实现继续调用 showSuggestError 会写进脱离文档的节点：
          // 用户只看到「生成失败」，既没有原因也没有重试入口。
          const message = this.getFriendlyErrorMessage(engineError);
          const box = this.suggestionContent.createDiv({ cls: "nw-cowrite-error-card" });
          box.createDiv({ cls: "nw-cowrite-error-card__text", text: `生成失败：${message}` });
          const actions = box.createDiv({ cls: "nw-cowrite-error-card__actions" });
          const notNow = actions.createEl("button", { text: "知道了", cls: "nw-btn nw-btn-ghost" });
          notNow.addEventListener("click", () => this.renderEmptySuggestions());
          const retry = actions.createEl("button", { text: "↻ 重试", cls: "nw-btn nw-btn-primary" });
          retry.addEventListener("click", () => this.retrySuggestion());
          return;
        }

        const dirCounts = this.facade.directionKnowledgeCounts || {};
        const directions = ['action', 'emotion', 'dialogue'];
        const allZero = directions.every(dir => (dirCounts[dir] || 0) === 0);

        if (allZero) {
          const noticeBar = this.suggestionContent.createDiv({
            cls: 'nw-knowledge-empty-notice',
            attr: {
              style: 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-bottom:12px;border-radius:6px;background:rgba(var(--background-modifier-warning-rgb), 0.15);border:1px solid var(--background-modifier-warning);'
            }
          });
          noticeBar.createSpan({
            text: '⚠️ 未检索到知识库参考，可能知识库未完成拆解',
            attr: { style: 'font-size:13px;color:var(--text-warning);' }
          });
          const refillBtn = noticeBar.createEl('button', {
            text: '补全知识库',
            attr: {
              style: 'padding:4px 12px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);font-size:12px;font-weight:600;border:none;cursor:pointer;transition:opacity 0.2s;'
            }
          });
          refillBtn.addEventListener('click', () => {
            this.openRefillModal('knowledge');
          });
          refillBtn.addEventListener('mouseenter', () => {
            refillBtn.style.opacity = '0.8';
          });
          refillBtn.addEventListener('mouseleave', () => {
            refillBtn.style.opacity = '1';
          });
        }

        this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u8FD9\u6B21\u6CA1\u6709\u62FF\u5230\u5EFA\u8BAE\u3002\u53EF\u4EE5\u6362\u4E00\u6279\uFF0C\u6216\u8005\u68C0\u67E5 API \u914D\u7F6E\u3002" });
        return;
      }
      this.renderSuggestionCards(suggestions);
      this.showKnowledgeInjectionNotice();
    } catch (e) {
      if (signal.aborted || !this.isCurrentSuggestionEpoch(epoch)) {
        // RG-02: 旧请求（已被新请求接管）不得取消新请求的进度条或清理其骨架
        // NBI-05: 切章后旧代次的错误也不写入新章节面板
        if (this.isSuggestRequestOwner(signal)) {
          if (this.suggestProgressEmitter) {
            this.suggestProgressEmitter.cancel();
          }
          this.clearStreamingPreview();
        }
        return;
      }
      log.warn("[CoWritingView] 生成建议失败:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.lastSuggestError = errorMsg;
      this.facade.syncSuggestionsError(errorMsg);

      this.clearStreamingPreview();
      if (this.suggestProgressEmitter) {
        this.suggestProgressEmitter.fail(this.getFriendlyErrorMessage(errorMsg));
      }
    } finally {
      if (suggestProgressTimer !== null) {
        window.clearInterval(suggestProgressTimer);
        suggestProgressTimer = null;
      }
      // v6.3: 仅当本次请求仍是当前 controller 时才清除状态，避免被后续请求的 abort 干扰
      if (this.suggestAbortController?.signal === signal) {
        this.isSuggesting = false;
        this.suggestAbortController = null;
        // BUG-K fix: 恢复建议按钮可用态
        if (this.suggestBtn) {
          this.suggestBtn.disabled = false;
          this.updateStartButtonState();
        }
      }
    }
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

  private getFriendlyErrorMessage(error: string): string {
    const lower = error.toLowerCase();
    // 必须先于 abort 判断：解锁提示里含有「已取消」，否则会被误判成「生成已取消」
    if (lower.includes('未解锁')) {
      return 'API 密钥未解锁：请输入加密口令后重试';
    }
    if (lower.includes('abort') || lower.includes('取消')) {
      return '生成已取消';
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('网络')) {
      return '网络连接失败，请检查网络连接后重试';
    }
    if (lower.includes('timeout') || lower.includes('超时')) {
      return '请求超时，请稍后重试';
    }
    if (lower.includes('api key') || lower.includes('api_key') || lower.includes('密钥') || lower.includes('认证')) {
      return 'API 密钥无效，请检查设置中的 API 配置';
    }
    if (lower.includes('rate limit') || lower.includes('限流') || lower.includes('429')) {
      return '请求过于频繁，请稍后再试';
    }
    if (lower.includes('model') || lower.includes('模型')) {
      return '模型调用失败，请检查模型配置';
    }
    return error || '生成失败，请重试';
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
      new Notice('⚠️ 未配置本地模型，请在设置中配置', 5000);
    } else if (newMode === 'cloud') {
      const providerId = settings.coWriteCloudProvider || '';
      if (!providerId) {
        new Notice('⚠️ 未配置云端供应商，请在设置中选择', 5000);
      } else {
        const apiKey = settings.providerKeys?.[providerId] || '';
        if (!apiKey) {
          new Notice(`⚠️ 供应商 ${providerId} 未配置 API Key`, 5000);
        }
      }
    }
    new Notice(`已切换到${newMode === 'local' ? '本地' : '云端'}模型`, 2000);
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
    new Notice(enabled ? '🎯 精准模式已开启' : '🎯 精准模式已关闭', 2000);
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
    if (!this.humanRateDashboard) return;
    this.humanRateDashboard.empty();

    const enabled = this.facade.settings.precisionMode || false;
    if (!enabled) {
      this.humanRateDashboard.createDiv({ cls: 'nw-hr-header' });
      this.humanRateDashboard.createDiv({ cls: 'nw-hr-disabled', text: '精准模式未开启' });
      return;
    }

    const scores = this.calculateHumanRate();
    this.renderHumanRateInto(scores);
  }

  /**
   * 计算人工率各维度评分
   *
    * @returns number } 结果
   */
  calculateHumanRate(): { overall: number; style: number; sentenceLength: number; opening: number; punctuation: number; aiWords: number } {
    const text = this.rightEditor?.value || '';

    const sentences = text.split(/[。！？；.!?;]/).filter(s => s.trim().length > 0);
    const recent3 = sentences.slice(-3);
    const recent5 = sentences.slice(-5);

    let sentenceLength = 100;
    if (recent3.length >= 2) {
      const lengths = recent3.map(s => s.length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 0;
      sentenceLength = Math.max(0, Math.min(100, Math.round(100 - cv * 100)));
    }

    let opening = 100;
    if (recent3.length >= 2) {
      const openings = recent3.map(s => s.trim().slice(0, 2)).filter(o => o.length >= 1);
      const unique = new Set(openings);
      const diversity = openings.length > 0 ? unique.size / openings.length : 1;
      opening = Math.round(diversity * 100);
    }

    let punctuation = 100;
    if (recent5.length >= 2) {
      const punctTypes = new Set<string>();
      let totalPunct = 0;
      for (const s of recent5) {
        const matches = s.match(/[，。！？、；：""''《》…—,\.!\?;:'"\-]/g);
        if (matches) {
          totalPunct += matches.length;
          matches.forEach(m => punctTypes.add(m));
        }
      }
      const variety = totalPunct > 0 ? punctTypes.size / Math.min(totalPunct, 10) : 0;
      punctuation = Math.max(30, Math.min(100, Math.round(variety * 100)));
    }

    let aiWords = 100;
    const aiHighFreqWords = ['然而', '于是', '随后', '紧接着', '与此同时', '不知为何', '仿佛', '似乎', '某种', '莫名', '陡然', '蓦地', '倏地', '旋即', '不由得'];
    const recentText = recent5.join('');
    let aiWordCount = 0;
    for (const word of aiHighFreqWords) {
      if (recentText.includes(word)) aiWordCount++;
    }
    aiWords = Math.max(40, Math.min(100, Math.round(100 - aiWordCount * 12)));

    // 风格分只能由指纹比对/AI 评估得出，输入时同步计算会阻塞编辑，
    // 因此这里返回 -1 表示「未评估」，并从总分权重中剔除，避免用常数 75 冒充真实分。
    const style = -1;

    const measured = sentenceLength * 0.20 + opening * 0.15 + punctuation * 0.15 + aiWords * 0.10;
    const overall = Math.round(measured / 0.60);

    return { overall, style, sentenceLength, opening, punctuation, aiWords };
  }

  /**
   * 将评分渲染到仪表盘容器
   *
   * @param scores - 分数表
   */
  renderHumanRateInto(scores: { overall: number; style: number; sentenceLength: number; opening: number; punctuation: number; aiWords: number }) {
    if (!this.humanRateDashboard) return;
    this.humanRateDashboard.empty();

    const colorClass = scores.overall >= 85 ? 'nw-hr-high' : scores.overall >= 60 ? 'nw-hr-mid' : 'nw-hr-low';

    const header = this.humanRateDashboard.createDiv({ cls: 'nw-hr-header' });
    header.createSpan({ cls: 'nw-hr-label', text: '人工率' });
    header.createSpan({ cls: `nw-hr-score ${colorClass}`, text: `${scores.overall}%` });

    const bar = this.humanRateDashboard.createDiv({ cls: 'nw-hr-bar' });
    bar.createDiv({ cls: `nw-hr-bar-fill ${colorClass}`, attr: { style: `width: ${scores.overall}%` } });

    const details = this.humanRateDashboard.createDiv({ cls: 'nw-hr-details' });
    details.createSpan({ text: scores.style < 0 ? '风格 未评估' : `风格 ${scores.style}%` });
    details.createSpan({ text: `句长 ${scores.sentenceLength}%` });
    details.createSpan({ text: `开头 ${scores.opening}%` });
    details.createSpan({ text: `标点 ${scores.punctuation}%` });
    details.createSpan({ text: `AI词 ${scores.aiWords}%` });
  }

  /** 更新人工率仪表盘 */
  updateHumanRateDashboard() {
    if (!this.humanRateDashboard) return;
    const enabled = this.facade.settings.precisionMode || false;
    if (!enabled) {
      this.renderHumanRateDashboard();
      return;
    }
    const scores = this.calculateHumanRate();
    this.renderHumanRateInto(scores);
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
    this.suggestionContent.empty();
    const row = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-card-row" });
    suggestions.forEach((suggestion: SuggestionRecord, index: number) => {
      const card = row.createDiv({ cls: "novel-writer-cowrite-suggestion-card" });
      const tags = card.createDiv({ cls: "novel-writer-cowrite-card-tags" });
      tags.createSpan({ cls: "novel-writer-cowrite-direction-tag", text: getDirectionLabel(suggestion.direction) });
      tags.createSpan({ cls: "novel-writer-cowrite-style-tag", text: getStyleLabel(suggestion.style) });
      tags.createSpan({ cls: "novel-writer-cowrite-index-tag", text: `Ctrl+${index + 1}` });
      card.createDiv({ cls: "novel-writer-cowrite-suggestion-text", text: suggestion.text });
      if (suggestion.riskLevel && suggestion.riskLevel !== "low" && (suggestion.riskWarnings?.length || 0) > 0) {
        const riskBox = card.createDiv({ cls: `novel-writer-cowrite-risk novel-writer-cowrite-risk-${suggestion.riskLevel}` });
        const label = suggestion.riskLevel === "high" ? "\u26A0\uFE0F \u5267\u900F\u98CE\u9669\uFF08\u9AD8\uFF09" : "\u26A0\uFE0F \u5267\u900F\u98CE\u9669\uFF08\u4E2D\uFF09";
        riskBox.createDiv({ cls: "novel-writer-cowrite-risk-title", text: label });
        const ul = riskBox.createEl("ul", { cls: "novel-writer-cowrite-risk-list" });
        (suggestion.riskWarnings || []).slice(0, 3).forEach((w: string) => ul.createEl("li", { text: w }));
      }
      const actions = card.createDiv({ cls: "novel-writer-cowrite-card-actions" });
      const acceptBtn = actions.createEl("button", { text: "\u2713 \u63A5\u53D7", cls: "novel-writer-cowrite-primary-btn" });
      acceptBtn.addEventListener("click", () => this.handleAcceptSuggestion(suggestion));
      const editBtn = actions.createEl("button", { text: "\u270F\uFE0F \u7F16\u8F91\u5E76\u9A8C\u8BC1", cls: "novel-writer-cowrite-secondary-btn" });
      editBtn.addEventListener("click", () => this.handleEditSuggestion(suggestion));
      const iterateBtn = actions.createEl("button", { text: "\u21BB \u8FED\u4EE3", cls: "novel-writer-cowrite-secondary-btn" });
      iterateBtn.addEventListener("click", () => this.handleIterateSuggestion(suggestion));
      const rejectBtn = actions.createEl("button", { text: "\xD7 \u62D2\u7EDD", cls: "novel-writer-cowrite-secondary-btn" });
      rejectBtn.addEventListener("click", () => this.rejectSuggestion(suggestion.id));
    });
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
        new Notice("\u8FED\u4EE3\u672A\u8FD4\u56DE\u65B0\u5019\u9009\uFF0C\u8BF7\u8C03\u6574\u6307\u4EE4\u540E\u91CD\u8BD5\u3002", 2500);
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
      new Notice("\u8FED\u4EE3\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", 2500);
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
    this.suggestionContent.empty();
    const header = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-association-header" });
    header.createSpan({ text: "\u2728 \u8054\u60F3\u8F93\u5165" });
    header.createSpan({ cls: "novel-writer-cowrite-association-tip", text: "Ctrl+1/2/3 \u63D2\u5165\uFF0CCtrl+Space \u6362\u4E00\u7EC4" });
    const row = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-card-row" });
    suggestions.forEach((suggestion: SuggestionRecord, index: number) => {
      const association = associations[index];
      const card = row.createDiv({ cls: "novel-writer-cowrite-suggestion-card novel-writer-cowrite-association-card" });
      const tags = card.createDiv({ cls: "novel-writer-cowrite-card-tags" });
      tags.createSpan({ cls: "novel-writer-cowrite-direction-tag", text: getAssociationLabel(association.type) });
      tags.createSpan({ cls: "novel-writer-cowrite-style-tag", text: `\u7F6E\u4FE1 ${Math.round((association.confidence || 0) * 100)}%` });
      tags.createSpan({ cls: "novel-writer-cowrite-index-tag", text: `Ctrl+${index + 1}` });
      card.createDiv({ cls: "novel-writer-cowrite-suggestion-text", text: association.text });
      const actions = card.createDiv({ cls: "novel-writer-cowrite-card-actions" });
      const acceptBtn = actions.createEl("button", { text: "\u21B5 \u63D2\u5165\u8054\u60F3", cls: "novel-writer-cowrite-primary-btn" });
      acceptBtn.addEventListener("click", () => this.handleAcceptSuggestion(suggestion));
      const editBtn = actions.createEl("button", { text: "\u270F\uFE0F \u7F16\u8F91", cls: "novel-writer-cowrite-secondary-btn" });
      editBtn.addEventListener("click", () => this.handleEditSuggestion(suggestion));
      const rejectBtn = actions.createEl("button", { text: "\xD7 \u62D2\u7EDD", cls: "novel-writer-cowrite-secondary-btn" });
      rejectBtn.addEventListener("click", () => this.rejectSuggestion(suggestion.id));
    });
  }
  /**
   * 渲染联想加载态。
   */
  renderAssociationLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "联想中...";
    this.suggestionContent.empty();
    const header = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-association-header" });
    header.createSpan({ text: "\u2728 \u6B63\u5728\u8054\u60F3\u4E0B\u4E00\u53E5\u2026\u2026" });
    const row = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-card-row" });
    for (let i = 0; i < 3; i++) {
      const card = row.createDiv({ cls: "novel-writer-cowrite-skeleton-card novel-writer-cowrite-association-card" });
      card.createDiv();
      card.createDiv();
      card.createDiv();
    }
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
    this.suggestionContent.empty();
    const panel = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-validation-panel" });
    const statusClass = !degraded && validation.isValid ? "is-valid" : "is-warning";
    const titleText = degraded
      ? "\u26A0\uFE0F \u6821\u9A8C\u672A\u5B8C\u6210\uFF08\u7ED3\u679C\u65E0\u6CD5\u89E3\u6790\uFF09"
      : (validation.isValid ? "\u2705 \u9A8C\u8BC1\u901A\u8FC7" : "\u26A0\uFE0F \u5B58\u5728\u98CE\u9669");
    panel.createDiv({ cls: `novel-writer-cowrite-validation-title ${statusClass}`, text: titleText });
    if (!degraded) {
      const scores = panel.createDiv({ cls: "novel-writer-cowrite-score-grid" });
      scores.appendChild(this.createScoreCard("\u8BBE\u5B9A\u4E00\u81F4\u6027", validation.consistencyScore));
      scores.appendChild(this.createScoreCard("\u6587\u98CE\u5BF9\u9F50", validation.styleScore));
      scores.appendChild(this.createScoreCard("\u5267\u60C5\u5BF9\u9F50", validation.plotAlignmentScore));
    }
    if (validation.warnings.length > 0) {
      const warnings = panel.createDiv({ cls: "novel-writer-cowrite-validation-list" });
      warnings.createEl("strong", { text: "\u26A0\uFE0F \u8B66\u544A" });
      validation.warnings.forEach((w: string) => warnings.createDiv({ text: `\xB7 ${w}` }));
    }
    if (validation.suggestions.length > 0) {
      const tips = panel.createDiv({ cls: "novel-writer-cowrite-validation-list" });
      tips.createEl("strong", { text: "\u{1F4A1} \u6539\u8FDB\u5EFA\u8BAE" });
      validation.suggestions.forEach((t: string) => tips.createDiv({ text: `\xB7 ${t}` }));
    }
    const actions = panel.createDiv({ cls: "novel-writer-cowrite-card-actions" });
    const useBtn = actions.createEl("button", { text: "\u7EE7\u7EED\u4F7F\u7528", cls: "novel-writer-cowrite-primary-btn" });
    // 与「✓ 接受」同一把采纳互斥锁：连点两次不能重复插入同一段校验后的文本
    useBtn.addEventListener("click", async () => {
      if (this.acceptInFlight) return;
      this.acceptInFlight = true;
      try {
        await this.insertTextAndRecord(modifiedText, suggestion, validation, editDurationMs);
      } finally {
        this.acceptInFlight = false;
      }
    });
    const editBtn = actions.createEl("button", { text: "\u4FEE\u6539\u540E\u518D\u9A8C\u8BC1", cls: "novel-writer-cowrite-secondary-btn" });
    editBtn.addEventListener("click", () => this.handleEditSuggestion(suggestion, modifiedText));
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
      new Notice("\u26A0\uFE0F 原文已改动，改写结果未应用。请重新选中文本后再改写。", 4e3);
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
    if (this.qualityIssues.length === 0) return;
    this.walkTextNodes(this.previewContent, (textNode) => {
      const text = textNode.textContent || '';
      if (text.length < 3) return;
      for (const issue of this.qualityIssues) {
        if (!issue.locationText || issue.locationText.length < 2) continue;
        const idx = text.indexOf(issue.locationText);
        if (idx < 0) continue;
        const parent = textNode.parentNode;
        if (!parent) continue;
        const before = text.slice(0, idx);
        const match = text.slice(idx, idx + issue.locationText.length);
        const after = text.slice(idx + issue.locationText.length);
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        const hColor = issue.priority === 'high' ? '#ff4444' : issue.priority === 'medium' ? '#ffaa00' : '#88ccff';
        const mark = document.createElement('mark');
        mark.className = 'nw-quality-highlight';
        mark.textContent = match;
        mark.style.cssText = `background:${hColor}33; border-bottom:2px solid ${hColor}; cursor:pointer; border-radius:2px; padding:0 1px;`;
        mark.dataset.issueId = issue.id;
        mark.addEventListener('mouseenter', (e) => { this.showQualityPopup(e, issue); });
        mark.addEventListener('mouseleave', () => { this.hideQualityPopup(); });
        mark.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showQualityContextMenu(e, issue);
        });
        frag.appendChild(mark);
        if (after) frag.appendChild(document.createTextNode(after));
        parent.replaceChild(frag, textNode);
        return;
      }
    });
  }
  /** 递归遍历 DOM 文本节点 */
  private walkTextNodes(node: Node, fn: (textNode: Text) => void) {
    if (node.nodeType === Node.TEXT_NODE) {
      fn(node as Text);
      return;
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeName === 'SCRIPT' || child.nodeName === 'STYLE' || child.nodeName === 'MARK') continue;
      if (child.nodeType === Node.TEXT_NODE) {
        fn(child as Text);
      } else {
        this.walkTextNodes(child, fn);
      }
    }
  }
  /**
   * 刷新指标。
   *
   * @param force - 是否强制
   */
  async refreshMetrics(force: boolean) {
    this.updateNextNodeButton();
    const now = Date.now();
    // `evaluatePlotComplete` 会把整章正文拼成约 9.6k token 的 prompt 发给 AI。
    // 此前只按 10 秒节流，开着自动评估时打字期间每分钟最多 6 次请求，
    // 而正文往往只多了几十字；这里要求「正文变过 + 新增达标或冷却到期」才评估。
    const gate = shouldRunPlotEval({
      chapterKey: `${this.project}|${this.chapterNum}`,
      text: this.rightEditor?.value || '',
      last: this.lastPlotEval,
      now,
      force,
    });
    if (!gate.run) return;
    this.lastPlotEval = gate.next;
    if (this.metricsAbortController) {
      this.metricsAbortController.abort();
      this.metricsAbortController = null;
    }
    this.metricsAbortController = new AbortController();
    const signal = this.metricsAbortController.signal;
    this.metricsStatus = 'evaluating';
    const currentMetrics = this.facade.getSession()?.currentMetrics || emptyMetrics();
    this.renderMetrics(currentMetrics);
    this.renderFloatingMetrics();
    // 完成度是异步 AI 评估：先记发起时的章节身份，返回后若已切章则丢弃
    const evalTarget = `${this.project}|${this.chapterNum}`;
    try {
      const metrics = await this.facade.evaluatePlotComplete(this.rightEditor.value, signal);
      if (signal.aborted) return;
      if (evalTarget !== `${this.project}|${this.chapterNum}`) return;
      const nextDirections = this.facade.adjustDirection(metrics);
      metrics.nextDirectionHints = nextDirections;
      this.metricsStatus = 'idle';
      this.facade.syncPlotCompletion(metrics);
      this.renderMetrics(metrics);
      this.renderFloatingMetrics();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (evalTarget !== `${this.project}|${this.chapterNum}`) return;
      log.warn("[CoWritingView] \u5B8C\u6210\u5EA6\u5237\u65B0\u5931\u8D25:", e);
      this.metricsStatus = 'error';
      const errorMetrics = this.facade.getSession()?.currentMetrics || emptyMetrics();
      this.renderMetrics(errorMetrics);
      this.renderFloatingMetrics();
    } finally {
      if (this.metricsAbortController?.signal === signal) {
        this.metricsAbortController = null;
      }
    }
  }
  /**
   * 渲染情节完成度指标。
   *
   * @param metrics - 指标
   */
  renderMetrics(metrics: PlotCompletionMetrics) {
    this.metricsContainer.empty();
    const isEvaluating = this.metricsStatus === 'evaluating';
    const isError = this.metricsStatus === 'error';
    const contentLength = this.rightEditor?.value?.trim().length || 0;
    const hasAnyMetric = metrics.sceneObjectivesMet > 0 || metrics.characterArcsAdvanced > 0 ||
      metrics.foreshadowingSeeded > 0 || metrics.emotionalArcProgress > 0 || metrics.overallCompletion > 0;
    const isInsufficient = contentLength < 50 && !hasAnyMetric;

    this.metricsContainer.createEl("h4", { text: "\u{1F4CA} \u5267\u60C5\u5B8C\u6210\u5EA6", cls: "nw-cowrite-metrics-title" });
    // 上下文信息：项目 · 章节 · 字数 · 保存状态
    const contextRow = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-context" });
    const editorText = this.rightEditor?.value || "";
    const wordCount = editorText.trim().length;
    const target = this.facade.settings.defaultWordCount || 3000;
    contextRow.createSpan({ text: `${this.project || "\u672A\u7ED1\u5B9A"} \u00B7 ${this.volume || ""} ${this.chapterName || ""}` });
    contextRow.createSpan({ text: `${wordCount}/${target}\u5B57` });
    contextRow.createSpan({ cls: "nw-cowrite-control-state", text: this.saveStateDisplay?.textContent || "\u672A\u77E5" });
    const rows: Array<[string, number]> = [
      ["\u573A\u666F\u76EE\u6807", metrics.sceneObjectivesMet],
      ["\u4EBA\u7269\u5F27", metrics.characterArcsAdvanced],
      ["\u4F0F\u7B14\u57CB\u8BBE", metrics.foreshadowingSeeded],
      ["\u60C5\u7EEA\u5F27", metrics.emotionalArcProgress],
    ];
    const grid = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-grid" });
    if (isEvaluating) grid.addClass("nw-cowrite-metrics-evaluating-dim");
    rows.forEach(([label, value]: [string, number]) => {
      const item = grid.createDiv({ cls: "nw-cowrite-metrics-item" });
      const head = item.createDiv({ cls: "nw-cowrite-metrics-head" });
      head.createSpan({ cls: "nw-cowrite-metrics-label", text: label });
      head.createSpan({ cls: "nw-cowrite-metrics-value", text: `${Math.max(0, Math.min(100, Math.round(value || 0)))}%` });
      const bar = item.createDiv({ cls: "nw-progress nw-cowrite-metrics-bar" });
      const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
      const fill = bar.createDiv({ cls: `nw-progress-fill ${safe < 30 ? "low" : safe < 60 ? "mid" : "high"}` });
      fill.style.width = `${safe}%`;
    });
    const overall = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-overall" });
    const overallHead = overall.createDiv({ cls: "nw-cowrite-metrics-head" });
    overallHead.createSpan({ cls: "nw-cowrite-metrics-label", text: "\u7EFC\u5408\u5B8C\u6210\u5EA6" });
    if (isEvaluating) {
      overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value nw-cowrite-metrics-evaluating", text: "\u8BC4\u4F30\u4E2D..." });
      const overallBar = overall.createDiv({ cls: "nw-progress nw-cowrite-metrics-bar nw-cowrite-metrics-loading-bar" });
      const overallFill = overallBar.createDiv({ cls: "nw-progress-fill" });
      overallFill.style.width = "100%";
    } else {
      const overallSafe = Math.max(0, Math.min(100, Math.round(metrics.overallCompletion || 0)));
      overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value", text: `${overallSafe}%` });
      const overallBar = overall.createDiv({ cls: "nw-progress nw-cowrite-metrics-bar" });
      const overallFill = overallBar.createDiv({ cls: `nw-progress-fill ${overallSafe < 30 ? "low" : overallSafe < 60 ? "mid" : "high"}` });
      overallFill.style.width = `${overallSafe}%`;
    }
    if (metrics.suggestionAdvice && !isEvaluating) {
      this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-advice", text: `\u{1F4A1} ${metrics.suggestionAdvice}` });
    }
    if (metrics.nextDirectionHints?.length && !isEvaluating) {
      const labels = metrics.nextDirectionHints.map((d: SuggestionDirection) => getDirectionLabel(d)).join(" \u2192 ");
      this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-next-directions", text: `\u4E0B\u4E00\u8F6E\u65B9\u5411\uFF1A${labels}` });
    }
    if (isError) {
      const errorEl = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-error", text: "\u274C \u8BC4\u4F30\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5" });
      errorEl.style.cursor = "pointer";
      errorEl.addEventListener("click", () => this.refreshMetrics(true));
    }
    if (isInsufficient && !isEvaluating && !isError) {
      this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-hint", text: "\uD83D\uDCDD \u5185\u5BB9\u4E0D\u8DB3\uFF0C\u7EE7\u7EED\u5199\u4F5C\u540E\u81EA\u52A8\u8BC4\u4F30" });
    }
  }
  /**
   * 渲染指标条。
   *
   * @param label - 显示标签
   * @param value - 值
   */
  renderMetricBar(label: string, value: number) {
    const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
    const row = this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-metric-row" });
    row.createSpan({ cls: "novel-writer-cowrite-metric-label", text: label });
    const bar = row.createDiv({ cls: "novel-writer-cowrite-metric-bar" });
    const fill = bar.createDiv({ cls: `novel-writer-cowrite-metric-fill ${safe < 30 ? "low" : safe < 60 ? "mid" : "high"}` });
    fill.style.width = `${safe}%`;
    row.createSpan({ cls: "novel-writer-cowrite-metric-value", text: `${safe}%` });
  }
  /**
   * 创建评分卡。
   *
   * @param label - 显示标签
   * @param value - 值
   * @returns 元素
   */
  createScoreCard(label: string, value: number) {
    const card = createDiv({ cls: "novel-writer-cowrite-score-card" });
    card.createDiv({ cls: "novel-writer-cowrite-score-value", text: `${Math.round(value || 0)}` });
    card.createDiv({ cls: "novel-writer-cowrite-score-label", text: label });
    return card;
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

    this.suggestProgressContainer = this.suggestionContent.createDiv({
      cls: "nw-suggest-progress-container",
      attr: { style: "padding: 16px 20px;" }
    });

    const headerRow = this.suggestProgressContainer.createDiv({
      attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;" }
    });
    headerRow.createSpan({
      text: "🤖 AI 正在生成建议",
      attr: { style: "font-weight:600;font-size:14px;" }
    });

    this.suggestEtaDisplay = headerRow.createSpan({
      text: "预估时间: 计算中...",
      attr: { style: "font-size:12px;color:var(--text-muted);" }
    });

    const stepListContainer = this.suggestProgressContainer.createDiv({
      attr: { style: "margin-bottom:16px;" }
    });
    this.suggestStepList = new StepListComponent(stepListContainer, [
      "检索知识库内容",
      "分析写作上下文",
      "生成写作建议"
    ]);

    // NBI-03: 流式候选预览区（生成开始即展开骨架，非流式 provider 也仅在调用期展示）
    this.streamingPreviewCards = [];
    this.suggestStreamingContainer = this.suggestProgressContainer.createDiv({
      cls: "nw-cowrite-stream-preview",
      attr: { style: "display:none;margin-bottom:16px;" }
    });

    const actionsRow = this.suggestProgressContainer.createDiv({
      attr: { style: "display:flex;gap:12px;justify-content:flex-end;" }
    });

    this.suggestCancelBtn = actionsRow.createEl("button", {
      text: "✕ 取消生成",
      cls: "nw-btn nw-btn-ghost"
    });
    this.suggestCancelBtn.addEventListener("click", () => this.cancelSuggestion());

    this.suggestRetryBtn = actionsRow.createEl("button", {
      text: "↻ 重试",
      cls: "nw-btn nw-btn-primary",
      attr: { style: "display:none;" }
    });
    this.suggestRetryBtn.addEventListener("click", () => this.retrySuggestion());

    this.suggestErrorContainer = this.suggestProgressContainer.createDiv({
      cls: "nw-suggest-error-container",
      attr: {
        style: "display:none;margin-top:12px;padding:12px;background:var(--background-secondary);border-radius:6px;border-left:3px solid var(--text-error, #ef4444);"
      }
    });

    if (this.suggestProgressEmitter) {
      this.suggestStepList.bindEmitter(this.suggestProgressEmitter);
      this.suggestProgressEmitter.on((state: ProgressState) => {
        this.updateSuggestProgressUI(state);
      });
    }
  }

  /**
   * NBI-03: 展开流式候选预览骨架。
   * 首个回调（含空文本重置回调）到达时创建，容器已销毁则跳过。
   */
  private ensureStreamingPreview(): void {
    const container = this.suggestStreamingContainer;
    if (!container || !container.isConnected) return;
    if (this.streamingPreviewCards.length > 0) {
      container.style.display = "block";
      return;
    }
    const row = container.createDiv({ cls: "novel-writer-cowrite-card-row nw-cowrite-stream-row" });
    for (let i = 0; i < 3; i++) {
      const card = row.createDiv({ cls: "novel-writer-cowrite-suggestion-card nw-cowrite-streaming-card" });
      const tags = card.createDiv({ cls: "novel-writer-cowrite-card-tags" });
      tags.createSpan({ cls: "novel-writer-cowrite-direction-tag", text: `候选 ${i + 1} · 生成中` });
      const textEl = card.createDiv({ cls: "novel-writer-cowrite-suggestion-text nw-cowrite-streaming-text" });
      textEl.createSpan({ cls: "nw-cowrite-stream-cursor", text: "▍" });
      this.streamingPreviewCards.push(card);
    }
    container.style.display = "block";
  }

  /** NBI-03: 按候选索引更新流式文本，互不干扰 */
  private updateStreamingPreview(index: number, cumulativeText: string): void {
    this.ensureStreamingPreview();
    const card = this.streamingPreviewCards[index];
    if (!card) return;
    const textEl = card.querySelector<HTMLElement>(".nw-cowrite-streaming-text");
    if (!textEl) return;
    textEl.setText(cumulativeText);
    if (cumulativeText.length > 0) {
      textEl.createSpan({ cls: "nw-cowrite-stream-cursor", text: "▍" });
    }
  }

  /** NBI-03: 中止或异常时移除未完成的「生成中」卡片，避免 DOM 残留 */
  private clearStreamingPreview(): void {
    this.streamingPreviewCards = [];
    if (this.suggestStreamingContainer?.isConnected) {
      this.suggestStreamingContainer.empty();
      this.suggestStreamingContainer.style.display = "none";
    }
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
    this.suggestionContent.empty();
    const row = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-card-row" });
    const card = row.createDiv({ cls: "novel-writer-cowrite-suggestion-card" });
    const tags = card.createDiv({ cls: "novel-writer-cowrite-card-tags" });
    tags.createSpan({ cls: "novel-writer-cowrite-direction-tag", text: direction });
    tags.createSpan({ cls: "novel-writer-cowrite-style-tag", text: style });
    tags.createSpan({ cls: "novel-writer-cowrite-index-tag", text: `Ctrl+${index + 1}` });
    const textEl = card.createDiv({ cls: "novel-writer-cowrite-suggestion-text", text: currentText });
    if (isStreaming) {
      const cursor = card.createSpan({ cls: "nw-streaming-cursor", text: "▋" });
      textEl.appendChild(cursor);
    }
    return card;
  }

  /**
   * 流式生成建议。
   *
   * @param directionIndex - 方向索引
   */
  async handleStreamSuggestion(directionIndex: number = 0) {
    if (this.isSuggesting) return;
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;

    this.isSuggesting = true;
    this.facade.syncSuggestionsGenerating(true);
    if (this.suggestBtn) {
      this.suggestBtn.disabled = true;
      this.suggestBtn.textContent = "⏳ 生成中...";
    }

    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    const precedingText = this.rightEditor.value.slice(0, cursor);

    try {
      if (signal.aborted) return;

      const directionLabels: Record<string, string> = {
        action: "剧情推进",
        emotion: "情感深化",
        dialogue: "人物对话",
        description: "场景描写",
        foreshadow: "伏笔铺垫",
        conflict: "冲突升级",
      };
      const styleLabels = ["默认", "创意", "保守"];

      let currentText = "";
      const card = this.renderStreamingSuggestionCard(
        "生成中...",
        styleLabels[directionIndex] || "默认",
        directionIndex,
        "",
        true
      );
      let textEl = card.querySelector(".novel-writer-cowrite-suggestion-text") as HTMLElement;

      const stream = this.facade.suggestStream(
        precedingText,
        this.cursorHint,
        "continue",
        directionIndex,
        signal
      );

      let finalSuggestion: SuggestionRecord | null = null;
      let result: IteratorResult<string, SuggestionRecord | null>;

      while (true) {
        result = await stream.next();
        if (signal.aborted) return;

        if (result.done) {
          finalSuggestion = result.value as SuggestionRecord | null;
          break;
        }

        const chunk = result.value;
        if (chunk) {
          currentText += chunk;
          if (textEl) {
            const cursorEl = textEl.querySelector(".nw-streaming-cursor");
            if (cursorEl) {
              cursorEl.remove();
            }
            textEl.textContent = currentText;
            const newCursor = document.createElement("span");
            newCursor.className = "nw-streaming-cursor";
            newCursor.textContent = "▋";
            textEl.appendChild(newCursor);
          }
        }
      }

      if (signal.aborted) return;

      if (finalSuggestion) {
        currentText = finalSuggestion.text;
        const directionLabel = directionLabels[finalSuggestion.direction] || finalSuggestion.direction;
        const styleLabel = finalSuggestion.style === 'default' ? '默认' :
          finalSuggestion.style === 'creative' ? '创意' : '保守';

        this.currentSuggestions = [finalSuggestion];
        this.currentRecord = {
          id: `rec_stream_${Date.now()}`,
          triggerText: precedingText.slice(-200),
          cursorPosition: cursor,
          suggestions: [finalSuggestion],
          humanModifiedText: "",
          editDurationMs: 0,
          createdAt: Date.now()
        };

        this.renderSuggestionCards([finalSuggestion]);
        this.facade.syncSuggestionsReady([finalSuggestion], finalSuggestion.direction as any);
        this.showKnowledgeInjectionNotice();
      } else {
        if (this.suggestionStatusText) this.suggestionStatusText.textContent = "无建议";
        this.suggestionContent.empty();
        this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "这次没有拿到建议。可以换一批，或者检查 API 配置。" });
      }
    } catch (e) {
      if (signal.aborted) return;
      log.warn("[CoWritingView] 流式生成建议失败:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.facade.syncSuggestionsError(errorMsg);
      this.showSuggestionPanel();
      if (this.suggestionStatusText) this.suggestionStatusText.textContent = "生成失败";
      this.suggestionContent.empty();
      this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-error", text: "生成建议失败，请稍后重试。" });
    } finally {
      if (this.suggestAbortController?.signal === signal) {
        this.isSuggesting = false;
        this.suggestAbortController = null;
        if (this.suggestBtn) {
          this.suggestBtn.disabled = false;
          this.updateStartButtonState();
        }
        this.facade.syncSuggestionsGenerating(false);
      }
    }
  }
  /**
   * 显示知识注入提示。
   */
  showKnowledgeInjectionNotice() {
    // 生成完成后的统一收口：同人设定可能在会话中被删除/移动，这里补一次失效复查
    this.warnFanficRulesOnce();
    const count = this.facade.lastKnowledgeCount || 0;
    const dropped = this.facade.lastKnowledgeDroppedCount || 0;
    if (count > 0) {
      new Notice(dropped > 0
        ? `📚 已注入 ${count} 条知识库片段（另 ${dropped} 条因预算不足未注入）`
        : `📚 已注入 ${count} 条知识库片段`);
    } else if (dropped > 0) {
      new Notice(`⚠️ 知识库片段因预算不足未注入（${dropped} 条）`);
    }
  }
  /**
   * 渲染校验加载态。
   */
  renderValidationLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "验证中...";
    this.suggestionContent.empty();
    this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u6B63\u5728\u9A8C\u8BC1\u4F60\u7684\u4FEE\u6539\uFF1A\u8BBE\u5B9A\u4E00\u81F4\u6027 / \u6587\u98CE\u5BF9\u9F50 / \u5267\u60C5\u5BF9\u9F50\u2026\u2026" });
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
    this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: message });
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

  /**
   * 渲染知识库书籍页签。
   */
  renderKbBooksTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content is-active",
      attr: { "data-subtab": "books" }
    });

    const searchWrap = tab.createDiv({ cls: "nw-kb-search-wrap" });
    this.kbBookSearchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "nw-kb-search-input",
      attr: { placeholder: "🔍 搜索书名..." }
    });
    this.kbBookSearchInput.addEventListener("input", () => {
      this.renderKbBookList();
    });

    this.kbBookListContainer = tab.createDiv({ cls: "nw-kb-book-list-panel" });

    const openFullBtn = tab.createEl("button", {
      text: "📂 打开完整知识库",
      cls: "nw-btn nw-btn-ghost nw-btn-sm nw-kb-open-full"
    });
    openFullBtn.addEventListener("click", () => this.openKnowledgePanel());
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
    this.kbBookListContainer.empty();

    const keyword = this.kbBookSearchInput?.value.trim().toLowerCase() || '';
    let books = this.kbBooksCache;
    if (keyword) {
      books = books.filter(b =>
        b.name.toLowerCase().includes(keyword) ||
        (b.author?.toLowerCase().includes(keyword)) ||
        b.themeTags.some(t => t.toLowerCase().includes(keyword))
      );
    }

    if (books.length === 0) {
      const emptyState = createEmptyState({
        icon: keyword ? 'search' : 'book',
        title: keyword ? '未找到匹配的书籍' : '暂无书籍',
        description: keyword ? '尝试更换关键词或清空搜索' : '点击上方按钮导入书籍'
      });
      this.kbBookListContainer.appendChild(emptyState);
      return;
    }

    books.forEach(book => {
      const card = this.createKbBookCard(book);
      this.kbBookListContainer.appendChild(card);
    });
  }

  /**
   * 创建书籍卡片。
   *
   * @param book - 书籍
   * @returns 元素
   */
  createKbBookCard(book: BookBasicInfo): HTMLElement {
    const isExpanded = this.expandedBookId === book.id;
    const card = createDiv({
      cls: `nw-kb-mini-card${isExpanded ? ' is-expanded' : ''}`,
      attr: { "data-book-id": book.id }
    });

    const header = card.createDiv({ cls: "nw-kb-mini-card-header" });
    const titleInfo = header.createDiv({ cls: "nw-kb-mini-card-title" });
    titleInfo.createSpan({ cls: "nw-kb-mini-card-name", text: book.name });
    if (book.author) {
      titleInfo.createSpan({ cls: "nw-kb-mini-card-author", text: book.author });
    }

    const quality = book.qualityScores?.overall;
    if (quality !== undefined) {
      header.createSpan({ cls: "nw-kb-mini-card-score", text: `⭐ ${quality.toFixed(0)}` });
    }

    const toggle = header.createSpan({
      cls: "nw-kb-mini-card-toggle",
      text: isExpanded ? '▼' : '▶'
    });

    header.addEventListener("click", () => {
      this.expandedBookId = isExpanded ? null : book.id;
      this.renderKbBookList();
    });

    if (isExpanded) {
      const body = card.createDiv({ cls: "nw-kb-mini-card-body" });

      if (book.primaryGenre) {
        const genreRow = body.createDiv({ cls: "nw-kb-mini-row" });
        genreRow.createSpan({ cls: "nw-kb-mini-label", text: "题材：" });
        const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
        const genreName = kb?.getGenre(book.primaryGenre)?.name || book.primaryGenre;
        genreRow.createSpan({ cls: "nw-kb-tag nw-kb-tag-genre", text: genreName });
      }

      if (book.qualityScores) {
        const scoreRow = body.createDiv({ cls: "nw-kb-mini-row" });
        scoreRow.createSpan({ cls: "nw-kb-mini-label", text: "质量：" });
        scoreRow.createSpan({ text: `${book.qualityScores.overall.toFixed(0)}分` });
      }

      const topChars = this.getBookTopCharacters(book);
      if (topChars.length > 0) {
        const charRow = body.createDiv({ cls: "nw-kb-mini-section" });
        charRow.createDiv({ cls: "nw-kb-mini-section-title", text: "🏷 主要人设 Top 5" });
        const tagsWrap = charRow.createDiv({ cls: "nw-kb-mini-tags" });
        topChars.forEach(tag => {
          const tagEl = tagsWrap.createSpan({
            cls: "nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable",
            text: tag
          });
          tagEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.quickInsertText(tag);
          });
        });
      }

      const topTechniques = this.getBookTopTechniques(book);
      if (topTechniques.length > 0) {
        const techRow = body.createDiv({ cls: "nw-kb-mini-section" });
        techRow.createDiv({ cls: "nw-kb-mini-section-title", text: "💡 核心技巧 Top 5" });
        const tagsWrap = techRow.createDiv({ cls: "nw-kb-mini-tags" });
        topTechniques.forEach(tag => {
          const tagEl = tagsWrap.createSpan({
            cls: "nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable",
            text: tag
          });
          tagEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.quickInsertText(tag);
          });
        });
      }

      const actionRow = body.createDiv({ cls: "nw-kb-mini-section nw-kb-action-row" });
      const activeRefs = this.facade.getReferenceBooks();
      const isActive = activeRefs.includes(book.id);
      const isPrimary = activeRefs.indexOf(book.id) === 0;

      const toggleBtn = actionRow.createEl("button", {
        cls: `nw-btn nw-btn-sm ${isActive ? 'nw-btn-primary' : 'nw-btn-ghost'}`,
        text: isActive ? '✓ 已启用参考' : '启用参考'
      });
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleReferenceBook(book.id, book.name, !isActive);
      });

      if (isActive) {
        const primaryBtn = actionRow.createEl("button", {
          cls: `nw-btn nw-btn-sm ${isPrimary ? 'nw-btn-accent' : 'nw-btn-ghost'}`,
          text: isPrimary ? '★ 主参考' : '设为主参考'
        });
        primaryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setPrimaryReference(book.id);
        });

        if (activeRefs.length > 1) {
          const weightWrap = actionRow.createDiv({ cls: "nw-kb-weight-wrap" });
          weightWrap.createSpan({ cls: "nw-kb-weight-label", text: "权重:" });
          const weightSlider = weightWrap.createEl("input", {
            type: "range",
            cls: "nw-kb-weight-slider",
            attr: { min: "10", max: "100", value: String(isPrimary ? 100 : 50) }
          });
          weightSlider.addEventListener("input", (e) => {
            e.stopPropagation();
            const value = parseInt(weightSlider.value, 10);
            this.adjustReferenceWeight(book.id, value / 100);
          });
        }
      }
    }

    return card;
  }

  /**
   * 启用/停用参考书。
   *
   * @param bookId - 书籍 ID
   * @param bookName - 书名
   * @param enable - 是否启用
   */
  toggleReferenceBook(bookId: string, bookName: string, enable: boolean): void {
    const currentRefs = this.facade.getReferenceBooks();
    if (enable) {
      if (currentRefs.length >= 3) {
        new Notice('最多只能启用 3 本参考书籍', 3000);
        return;
      }
      const newRefs = [...currentRefs, bookId];
      this.persistReferenceBookIds(newRefs);
      new Notice(`已启用《${bookName}》作为参考`, 2000);
    } else {
      const newRefs = currentRefs.filter(id => id !== bookId);
      this.persistReferenceBookIds(newRefs);
      new Notice(`已停用《${bookName}》的参考`, 2000);
    }
    this.renderKbBookList();
    this.refreshChapterMatch();
    this.refreshWritingAdvice();
  }

  /**
   * 参考书籍的唯一写入点：设置（落盘）+ 插件镜像 + 引擎/注入器（带权重）。
   * 旧实现只改实例字段且从不 saveSettings，重启后选择全丢。
   */
  private persistReferenceBookIds(newRefs: string[]): void {
    this.plugin.referenceBookIds = newRefs;
    this.plugin.settings.referenceBookIds = newRefs;
    void this.plugin.saveSettings();
    this.applyReferenceBookConfig(newRefs);
  }

  /** 把「顺序 + 权重」推给引擎与知识注入器；首位即主参考，权重固定 1 */
  private applyReferenceBookConfig(ids: string[]): void {
    const weights = this.plugin.settings.referenceBookWeights ?? {};
    void this.facade.setReferenceBooksWithWeight(
      ids.map((id, index) => ({
        bookId: id,
        weight: index === 0 ? 1 : (weights[id] ?? 0.5),
        isPrimary: index === 0,
      }))
    ).catch(e => log.warn('[CoWritingView] 应用参考书籍权重失败:', e));
  }

  /**
   * 设置主参考书。
   *
   * @param bookId - 书籍 ID
   */
  setPrimaryReference(bookId: string): void {
    const currentRefs = this.facade.getReferenceBooks();
    const index = currentRefs.indexOf(bookId);
    if (index <= 0) return;

    const newRefs = [bookId, ...currentRefs.filter(id => id !== bookId)];
    this.persistReferenceBookIds(newRefs);
    new Notice('已设为主参考书籍', 2000);
    this.renderKbBookList();
    this.refreshWritingAdvice();
  }

  /**
   * 权重滑杆：以前只打日志，滑了等于没滑；现在写进设置并立即作用到注入器
   *
   * @param bookId - 书籍 ID
   * @param weight - 权重
   */
  adjustReferenceWeight(bookId: string, weight: number): void {
    const clamped = Math.max(0.1, Math.min(1, Math.round(weight * 100) / 100));
    this.plugin.settings.referenceBookWeights = {
      ...(this.plugin.settings.referenceBookWeights ?? {}),
      [bookId]: clamped,
    };
    void this.plugin.saveSettings();
    this.applyReferenceBookConfig(this.facade.getReferenceBooks());
    this.refreshWritingAdvice();
  }

  /**
   * 取书籍高频人物。
   *
   * @param book - 书籍
   * @returns 名称数组
   */
  getBookTopCharacters(book: BookBasicInfo): string[] {
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
    if (!kb || !book.primaryGenre) return book.themeTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.themeTags.slice(0, 5);
    return genre.personalityTags.slice(0, 5);
  }

  /**
   * 取书籍高频技法。
   *
   * @param book - 书籍
   * @returns 名称数组
   */
  getBookTopTechniques(book: BookBasicInfo): string[] {
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
    if (!kb || !book.primaryGenre) return book.techniqueTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.techniqueTags.slice(0, 5);
    return genre.techniques.slice(0, 5).map(t => t.name);
  }

  // ========== 子 Tab 2: 当前章节匹配 ==========

  /**
   * 渲染匹配页签。
   */
  renderKbMatchTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "match" }
    });
    this.kbMatchContainer = tab;
    this.refreshChapterMatch();
  }

  /**
   * 刷新本章匹配。
   */
  refreshChapterMatch() {
    if (!this.kbMatchContainer) return;
    this.kbMatchContainer.empty();

    const header = this.kbMatchContainer.createDiv({ cls: "nw-kb-section-header" });
    header.createSpan({ text: "🎯 当前章节最相关" });
    header.createSpan({ cls: "nw-kb-section-desc", text: "基于内容自动匹配" });

    const matches = this.calculateChapterMatches();
    if (matches.length === 0) {
      this.kbMatchContainer.createDiv({
        cls: "nw-kb-empty",
        text: "暂无匹配的参考书籍"
      });
      return;
    }

    matches.slice(0, 3).forEach(match => {
      const card = this.createMatchCard(match);
      this.kbMatchContainer.appendChild(card);
    });
  }

  /**
   * 计算本章与书籍匹配度。
   * @returns 匹配数组
   */
  calculateChapterMatches(): Array<{ book: BookBasicInfo; score: number; topChars: string[]; topTechs: string[] }> {
    const text = this.rightEditor?.value || '';
    if (!text || this.kbBooksCache.length === 0) return [];

    const results: Array<{ book: BookBasicInfo; score: number; topChars: string[]; topTechs: string[] }> = [];
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();

    for (const book of this.kbBooksCache) {
      let score = 0;
      const topChars: string[] = [];
      const topTechs: string[] = [];

      const genre = kb && book.primaryGenre ? kb.getGenre(book.primaryGenre) : null;

      if (genre) {
        for (const tag of genre.personalityTags) {
          const count = (text.match(new RegExp(tag, 'g')) || []).length;
          if (count > 0) {
            score += count * 2;
            if (topChars.length < 3) topChars.push(tag);
          }
        }
        for (const tech of genre.techniques) {
          for (const kw of tech.keywords) {
            const count = (text.match(new RegExp(kw, 'g')) || []).length;
            if (count > 0) {
              score += count;
              if (topTechs.length < 3 && !topTechs.includes(tech.name)) {
                topTechs.push(tech.name);
              }
              break;
            }
          }
        }
      }

      for (const tag of book.themeTags) {
        const count = (text.match(new RegExp(tag, 'g')) || []).length;
        if (count > 0) score += count;
      }

      if (score > 0 || book.breakdownStatus === 'completed') {
        results.push({
          book,
          score: Math.round(score + (book.qualityScores?.overall || 0) * 0.1),
          topChars: topChars.length > 0 ? topChars : genre?.personalityTags.slice(0, 3) || [],
          topTechs: topTechs.length > 0 ? topTechs : genre?.techniques.slice(0, 3).map(t => t.name) || []
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * 创建匹配卡片。
   *
   * @param match - 匹配结果
   * @returns 元素
   */
  createMatchCard(match: { book: BookBasicInfo; score: number; topChars: string[]; topTechs: string[] }): HTMLElement {
    const card = createDiv({ cls: "nw-kb-match-card" });

    const header = card.createDiv({ cls: "nw-kb-match-header" });
    const title = header.createDiv({ cls: "nw-kb-match-title" });
    title.createSpan({ cls: "nw-kb-match-name", text: match.book.name });
    const matchPct = Math.min(95, Math.round(match.score * 3 + 20));
    header.createSpan({
      cls: "nw-kb-match-score",
      text: `${matchPct}%`
    });

    const bar = card.createDiv({ cls: "nw-kb-match-bar" });
    bar.createDiv({
      cls: "nw-kb-match-bar-fill",
      attr: { style: `width: ${matchPct}%` }
    });

    if (match.topChars.length > 0) {
      const chars = card.createDiv({ cls: "nw-kb-match-section" });
      chars.createSpan({ cls: "nw-kb-match-label", text: "相关人设：" });
      const tags = chars.createDiv({ cls: "nw-kb-mini-tags" });
      match.topChars.forEach(tag => {
        const tagEl = tags.createSpan({
          cls: "nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable",
          text: tag
        });
        tagEl.addEventListener("click", () => this.quickInsertText(tag));
      });
    }

    if (match.topTechs.length > 0) {
      const techs = card.createDiv({ cls: "nw-kb-match-section" });
      techs.createSpan({ cls: "nw-kb-match-label", text: "相关技巧：" });
      const tags = techs.createDiv({ cls: "nw-kb-mini-tags" });
      match.topTechs.forEach(tag => {
        const tagEl = tags.createSpan({
          cls: "nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable",
          text: tag
        });
        tagEl.addEventListener("click", () => this.quickInsertText(tag));
      });
    }

    return card;
  }

  // ========== 子 Tab 3: 快速引用 ==========

  /**
   * 渲染引用页签。
   */
  renderKbQuoteTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "quote" }
    });
    this.kbQuoteContainer = tab;
    this.refreshQuotePanel();
  }

  /**
   * 刷新技法引用面板。
   */
  refreshQuotePanel() {
    if (!this.kbQuoteContainer) return;
    this.kbQuoteContainer.empty();

    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
    if (!kb) {
      this.kbQuoteContainer.createDiv({ cls: "nw-kb-empty", text: "知识库未初始化" });
      return;
    }

    const header = this.kbQuoteContainer.createDiv({ cls: "nw-kb-section-header" });
    header.createSpan({ text: "✨ 快速引用" });
    header.createSpan({ cls: "nw-kb-section-desc", text: "点击插入编辑器" });

    const currentBook = this.kbBooksCache[0];
    const genreId = currentBook?.primaryGenre || 'xuanhuan_xianxia';
    const genre = kb.getGenre(genreId);

    if (!genre) {
      this.kbQuoteContainer.createDiv({ cls: "nw-kb-empty", text: "无可用的参考数据" });
      return;
    }

    const charSection = this.kbQuoteContainer.createDiv({ cls: "nw-kb-quote-section" });
    charSection.createDiv({ cls: "nw-kb-quote-section-title", text: "🎭 性格标签" });
    const charTags = charSection.createDiv({ cls: "nw-kb-quote-tags" });
    genre.personalityTags.slice(0, 12).forEach(tag => {
      const tagEl = charTags.createSpan({
        cls: "nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable",
        text: tag
      });
      tagEl.addEventListener("click", () => {
        this.quickInsertText(tag);
        new Notice(`已插入：${tag}`, 1500);
      });
    });

    const techSection = this.kbQuoteContainer.createDiv({ cls: "nw-kb-quote-section" });
    techSection.createDiv({ cls: "nw-kb-quote-section-title", text: "💡 写作技巧" });
    const techTags = techSection.createDiv({ cls: "nw-kb-quote-tags" });
    genre.techniques.slice(0, 10).forEach(tech => {
      const tagEl = techTags.createSpan({
        cls: "nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable",
        text: tech.name
      });
      tagEl.addEventListener("click", () => {
        this.insertTechniqueExample(tech);
      });
      tagEl.title = tech.description;
    });

    const hint = this.kbQuoteContainer.createDiv({ cls: "nw-kb-quote-hint" });
    hint.createSpan({ text: "💡 点击标签即可插入到编辑器光标位置" });
  }

  /**
   * 插入技法示例。
   *
   * @param tech - 技法
   */
  insertTechniqueExample(tech: { name: string; description: string }) {
    const exampleText = `【${tech.name}】${tech.description}`;
    this.quickInsertText(exampleText);
    new Notice(`已插入：${tech.name}`, 1500);
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
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "advice" }
    });
    this.kbAdviceContainer = tab;
    this.refreshWritingAdvice();
  }

  /**
   * 刷新写作建议。
   */
  refreshWritingAdvice() {
    if (!this.kbAdviceContainer) return;
    this.kbAdviceContainer.empty();

    const header = this.kbAdviceContainer.createDiv({ cls: "nw-kb-section-header" });
    header.createSpan({ text: "💡 写作建议" });
    header.createSpan({ cls: "nw-kb-section-desc", text: "基于内容和参考书籍" });

    const adviceList = this.generateWritingAdvice();
    if (adviceList.length === 0) {
      this.kbAdviceContainer.createDiv({
        cls: "nw-kb-empty",
        text: "多写一些内容后会生成建议"
      });
      return;
    }

    const list = this.kbAdviceContainer.createDiv({ cls: "nw-kb-advice-list" });
    adviceList.forEach(advice => {
      const item = list.createDiv({ cls: "nw-kb-advice-item" });
      const icon = item.createSpan({ cls: "nw-kb-advice-icon", text: advice.icon });
      const content = item.createDiv({ cls: "nw-kb-advice-content" });
      content.createDiv({ cls: "nw-kb-advice-title", text: advice.title });
      content.createDiv({ cls: "nw-kb-advice-desc", text: advice.desc });
      if (advice.source) {
        content.createDiv({ 
          cls: "nw-kb-advice-source", 
          text: `来源：${advice.source}` 
        });
      }
    });
  }

  /**
   * 生成写作建议。
   * @returns 建议数组
   */
  generateWritingAdvice(): Array<{ icon: string; title: string; desc: string; source?: string; category?: string }> {
    const text = this.rightEditor?.value || '';
    const advice: Array<{ icon: string; title: string; desc: string; source?: string; category?: string }> = [];
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();

    if (text.length < 300) {
      advice.push({
        icon: "📝",
        title: "继续充实内容",
        desc: `当前 ${text.length} 字，建议至少写到 500 字让情节展开。`,
        category: "general"
      });
    }

    const completedBooks = this.kbBooksCache.filter(b => b.breakdownStatus === 'completed');
    const activeRefs = this.facade.getReferenceBooks();
    
    if (completedBooks.length > 0) {
      for (const refBook of completedBooks.slice(0, 2)) {
        const genre = kb && refBook.primaryGenre ? kb.getGenre(refBook.primaryGenre) : null;
        if (genre) {
          const isActive = activeRefs.includes(refBook.id);
          const sourceLabel = isActive ? `《${refBook.name}》（启用中）` : `《${refBook.name}》`;

          const rhythmTech = genre.techniques.find(t => t.category === 'rhythm');
          if (rhythmTech) {
            advice.push({
              icon: "📈",
              title: `节奏建议：${rhythmTech.name}`,
              desc: rhythmTech.description,
              source: sourceLabel,
              category: "rhythm"
            });
          }

          const coolTech = genre.techniques.find(t => t.category === 'cool_point');
          if (coolTech) {
            advice.push({
              icon: "🔥",
              title: `爽点建议：${coolTech.name}`,
              desc: coolTech.description,
              source: sourceLabel,
              category: "technique"
            });
          }

          const emotionTech = genre.techniques.find(t => t.category === 'emotion');
          if (emotionTech) {
            advice.push({
              icon: "💖",
              title: `情感建议：${emotionTech.name}`,
              desc: emotionTech.description,
              source: sourceLabel,
              category: "emotion"
            });
          }

          if (genre.personalityTags.length > 0) {
            const charTag = genre.personalityTags[0];
            advice.push({
              icon: "🎭",
              title: `人设参考：${charTag}`,
              desc: `可借鉴${sourceLabel}中「${charTag}」类型的角色塑造方式，让人物更立体。`,
              source: sourceLabel,
              category: "character"
            });
          }
        }
      }
    } else if (this.kbBooksCache.length > 0) {
      const first = this.kbBooksCache[0];
      advice.push({
        icon: "⏳",
        title: "等待书籍拆解完成",
        desc: `《${first.name}》正在拆解中，完成后可获得更多建议。`,
        category: "general"
      });
    } else {
      advice.push({
        icon: "📚",
        title: "添加参考书籍",
        desc: "导入参考书籍并拆解后，可获得个性化写作建议。",
        category: "general"
      });
    }

    const sentenceCount = (text.match(/[。！？.!?]/g) || []).length;
    if (sentenceCount > 0 && text.length / sentenceCount > 40) {
      advice.push({
        icon: "✂️",
        title: "句子偏长，建议拆分",
        desc: "当前平均句长较长，适当使用短句可以加快节奏。",
        category: "style"
      });
    }

    const dialogueCount = (text.match(/["""「『]/g) || []).length;
    if (sentenceCount > 5 && dialogueCount < sentenceCount * 0.1) {
      advice.push({
        icon: "💬",
        title: "增加对话互动",
        desc: "对话可以让场景更生动，人物更鲜活，建议适当增加。",
        category: "dialogue"
      });
    }

    const battleKeywords = ['战斗', '打斗', '交手', '对战', '攻击', '防御'];
    let battleScore = 0;
    for (const kw of battleKeywords) if (text.includes(kw)) battleScore++;
    if (battleScore >= 2 && completedBooks.length > 0) {
      const refBook = completedBooks[0];
      advice.push({
        icon: "⚔️",
        title: "战斗场景优化",
        desc: `当前是战斗场景，可参考《${refBook.name}》的战斗节奏和动作描写方式。`,
        source: `《${refBook.name}》`,
        category: "scene"
      });
    }

    const emotionKeywords = ['伤心', '感动', '愤怒', '恐惧', '喜悦', '悲伤', '思念'];
    let emotionScore = 0;
    for (const kw of emotionKeywords) if (text.includes(kw)) emotionScore++;
    if (emotionScore >= 2 && completedBooks.length > 0) {
      const refBook = completedBooks[0];
      advice.push({
        icon: "💕",
        title: "情感场景深化",
        desc: `当前是情感场景，可借鉴《${refBook.name}》的情感表达方式，让情绪更有层次。`,
        source: `《${refBook.name}》`,
        category: "scene"
      });
    }

    return advice.slice(0, 6);
  }

  // ==================== 知识库 Tab 方法结束 ====================

  /**
   * 设置幽灵建议。
   *
   * @param suggestion - 建议
   */
  setGhostSuggestion(suggestion: SuggestionRecord | null) {
    this.ghostSuggestion = suggestion;
    if (!this.ghostSuggestionContainer)
      return;
    this.ghostSuggestionContainer.empty();
    this.ghostSuggestionContainer.toggleClass("is-visible", !!suggestion);
    if (!suggestion)
      return;
    this.ghostSuggestionContainer.createSpan({ cls: "nw-cowrite-ghost-prefix", text: "Tab \u63A5\u53D7\u8054\u60F3\uFF1A" });
    this.ghostSuggestionContainer.createSpan({ cls: "nw-cowrite-ghost-text", text: suggestion.text });
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
    if (this.isAssociating || this.isSuggesting || this.currentSuggestions.length > 0)
      return;
    const text = this.rightEditor?.value || "";
    const cursor = resolveCursorPosition(this.rightEditor?.selectionStart, text.length);
    if (text.trim().length < 40 || cursor < text.length - 3)
      return;
    const seed = text.slice(Math.max(0, cursor - 160), cursor);
    if (!seed.trim() || seed === this.lastGhostSeed)
      return;
    // 只在句末/段末触发：句中的每次停顿都请求会让本地模型持续排队
    const beforeCursor = text.slice(0, cursor).trimEnd();
    const lastChar = beforeCursor.slice(-1);
    if (!/[。！？…]/.test(lastChar) && !beforeCursor.endsWith(String.fromCharCode(10)))
      return;
    // 慢速打字时尾部种子每次只多一个字，1.5s 防抖后仍会连续请求：按最小间隔限频
    const now = Date.now();
    if (!shouldRequestGhostAssociationByInterval(now, this.lastGhostRequestAt, GHOST_ASSOCIATION_MIN_INTERVAL_MS))
      return;
    this.lastGhostSeed = seed;
    this.lastGhostRequestAt = now;
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
    if (!this.statusBar)
      return;
    const count = this.rightEditor?.value?.trim().length || 0;
    this.statusBar.empty();
    this.statusBar.createSpan({ text: `\u{1F4CD} ${this.project || "\u672A\u9009\u62E9\u9879\u76EE"} \xB7 ${this.volume} \xB7 ${this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`} \xB7 \u5B57\u6570 ${count}` });
    if (this.wordCountDisplay)
      this.wordCountDisplay.setText(String(count));
    if (this.wordGoalDisplay) {
      const goal = this.facade.settings.defaultWordCount || 3000;
      const progress = Math.min(100, Math.round(count / goal * 100));
      this.wordGoalDisplay.setText(`\u76EE\u6807: ${goal} \xB7 ${progress}%`);
    }
  }
  /**
   * 更新控件状态。
   *
   * @param state - 状态
   */
  updateControlState(state: string) {
    this.refreshStatusBar();
    if (this.saveStateDisplay) {
      this.saveStateDisplay.setText(state);
      this.saveStateDisplay.toggleClass("is-dirty", state !== "\u5DF2\u4FDD\u5B58" && state !== "\u5DF2\u52A0\u8F7D");
    }
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
    new Notice(this.cursorHint ? `\u5DF2\u5E94\u7528\u4E34\u65F6\u6307\u4EE4\uFF1A${this.cursorHint}` : "\u5DF2\u6E05\u7A7A\u4E34\u65F6\u6307\u4EE4", 2500);
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
    // v4.5.1 fix: 必须用 "第N章" 前缀，与 pjBodyFile/findBodyFileV4 规范一致
    // 之前用 chapterName（如"初始之痕"）导致 findBodyFileV4 找不到正文文件
    const chapterPrefix = `第${this.chapterNum}章`;
    return `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}/${chapterPrefix}_\u6B63\u6587.md`;
  }
  /**
   * 取正文目录。
   * @returns 目录
   */
  getBodyDir() {
    return `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}`;
  }
  /**
   * 取步骤结果目录列表。
   * @returns 目录数组
   */
  getStepResultDirs() {
    // v4.5.1 fix: 步骤结果目录也用 "第N章" 前缀，与 checkChaptersComplete 正则一致
    const chapterPrefix = `第${this.chapterNum}章`;
    return [
      `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B65\u9AA4\u7ED3\u679C/${this.volume}/${chapterPrefix}`,
      `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/${this.volume}/${chapterPrefix}`
    ];
  }
  private getStepFilePath(
    stepType: string,
    identity?: { project: string; volume: string; chapterNum: number }
  ): string {
    // 与 pjStepFile 规范一致：目录和文件名都要带「第N章」前缀。
    // 之前文件名漏了前缀（.../第1章/信息规划.md），而磁盘上永远是 .../第1章/第1章_信息规划.md，
    // 导致 getChapterTitle 恒为空、保存后 H1 丢标题。
    const project = identity?.project ?? this.project;
    const volume = identity?.volume ?? this.volume;
    const chapterNum = identity?.chapterNum ?? this.chapterNum;
    const chapterPrefix = `第${chapterNum}章`;
    const stepDir = `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapterPrefix}`;
    return `${stepDir}/${chapterPrefix}_${stepType}.md`;
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
      if (infoPlanFile instanceof TFile) {
        const content = await this.app.vault.read(infoPlanFile);
        const body = content.replace(/^---[\s\S]*?---\s*/, '');
        const chapterNameMatch = body.match(/##\s*\u7AE0\u540D\s*\n+([^\n#]+)/i);
        if (chapterNameMatch && chapterNameMatch[1].trim()) {
          return chapterNameMatch[1].trim();
        }
        // 步骤生成器实际写的是「**章名**：九脉逆行」，不匹配上面的 ## 标题格式，
        // 结果保存时 H1 丢标题（只剩「# 第1章」）。
        const boldChapterName = body.match(/^\*\*\u7AE0\u540D\*\*\s*[：:]\s*(.+)$/m);
        if (boldChapterName && boldChapterName[1].trim()) {
          return boldChapterName[1].trim();
        }
      }
      const outlinePath = this.getStepFilePath('\u5927\u7EB2\u6458\u8981', identity);
      const outlineFile = this.app.vault.getAbstractFileByPath(outlinePath);
      if (outlineFile instanceof TFile) {
        const content = await this.app.vault.read(outlineFile);
        const body = content.replace(/^---[\s\S]*?---\s*/, '');
        const firstLine = body.split('\n')[0] || '';
        const titleMatch1 = firstLine.match(/^#\s*《([^》]+)》/);
        if (titleMatch1 && titleMatch1[1].trim()) {
          return titleMatch1[1].trim();
        }
        const titleMatch2 = firstLine.match(/^#\s*\u7B2C\d+\u7AE0\s+(.+?)\s*(\u5927\u7EB2\u6458\u8981|\u5927\u7EB2|\u7AE0\u8282\u5927\u7EB2)?\s*$/);
        if (titleMatch2 && titleMatch2[1].trim()) {
          return titleMatch2[1].trim();
        }
      }
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
    if (!dirPath)
      return;
    const parts = dirPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
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
    return identity.project === this.project
      && identity.chapterNum === this.chapterNum
      && identity.bodyPath === this.getBodyPath();
  }

  /**
   * 切章前冲刷上一章排队中的自动保存。
   * 行为与文档见 `BodySaveController#flushBeforeChapterSwitch`。
   */
  private async flushPendingBodySaveBeforeChapterSwitch(): Promise<boolean> {
    return this.bodySaveController.flushBeforeChapterSwitch();
  }

  /** P1-4: 检查章节是否需要结算，在状态栏显示提醒 */
  private checkSettlementDue(): void {
    if (!this.statusBar || !this.project || !this.chapterName) return;
    try {
      const bodyPath = this.getBodyPath();
      const file = this.app.vault.getAbstractFileByPath(bodyPath);
      if (!(file instanceof TFile)) return;
      // 异步读取 frontmatter，不阻塞UI
      this.app.vault.read(file).then(content => {
        const isSettled = content.includes('status: settled');
        const isWritten = content.includes('status: written') || content.includes('status: 已完稿');
        if (isWritten && !isSettled && this.statusBar) {
          this.statusBar.createSpan({
            text: ' ⚠️ 待结算',
            attr: { style: 'color: var(--text-warning, #f59e0b); font-weight: 600; cursor: pointer; margin-left: 8px;' },
          }).addEventListener('click', () => {
            this.handleComplete();
          });
        }
      }).catch(() => {});
    } catch { /* 静默忽略 */ }
  }
  /**
   * 标记本章已写。
   */
  async markAsWritten() {
    if (!this.project || !this.volume || !this.chapterNum) {
      new Notice("⚠️ 未绑定章节，请先在左侧选择卷/章", 3e3);
      return;
    }
    try {
      // 保存失败时旧实现照样把 status 改成 written 并提示成功，
      // 结算会基于磁盘上的旧正文执行，事实/伏笔被按错误内容更新
      const saved = await this.saveBody(false);
      if (!saved) {
        new Notice("⚠️ 正文未能保存（可能为空或写入失败），未标记为完稿", 4e3);
        return;
      }
      const bodyPath = this.getBodyPath();
      const file = this.app.vault.getAbstractFileByPath(bodyPath);
      if (file instanceof TFile) {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          if (fm["status"] !== "settled") {
            fm["status"] = "written";
          }
        });
        new Notice("✅ 已标记为完稿", 3000);
        this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics());
        this.checkSettlementDue();
      }
    } catch (e) {
      log.warn("[CoWritingView] 标记完稿失败:", e);
      new Notice("⚠️ 标记完稿失败", 4000);
    }
  }
  /**
   * 完成本章（触发结算/后续流程）。
   */
  async handleComplete() {
    // 保存失败仍弹结算：结算读的是磁盘正文，会和编辑器里看到的不一致
    const saved = await this.saveBody(true);
    if (!saved) {
      new Notice("⚠️ 正文未能保存，已取消结算", 4e3);
      return;
    }
    await this.refreshMetrics(true);
    await this.runSettlementConflictCheck();
    new ChapterSettlementModal(this.app, this.plugin, {
      project: this.project,
      volume: this.volume,
      chapterNum: this.chapterNum,
      chapterName: this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`
    }).open();
  }

  /** P0-2: 结算前冲突检测提示（复用 ConflictDetector，失败不阻塞结算） */
  private async runSettlementConflictCheck(): Promise<void> {
    try {
      const snapshot = new ChapterSnapshotBuilder().buildFromContext(
        this.chapterNum,
        await this.plugin.ctxManager.gatherAll(this.project, this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`),
      );
      const body = this.rightEditor?.value || '';
      if (body.trim().length === 0) return;
      const conflicts = new ConflictDetector().detect(snapshot, body);
      if (conflicts.length > 0) {
        const preview = conflicts.slice(0, 3).map(c => c.message).join('\uFF1B');
        new Notice(`\u26A0\uFE0F \u7ED3\u7B97\u524D\u68C0\u6D4B\u5230 ${conflicts.length} \u9879\u4E00\u81F4\u6027\u51B2\u7A81\uFF1A${preview}`, 8000);
      }
    } catch (e) {
      log.warn('[CoWritingView] \u7ED3\u7B97\u524D\u51B2\u7A81\u68C0\u6D4B\u5931\u8D25:', e);
    }
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
        new Notice('批量导入完成');
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
    container.empty();
    const isEvaluating = this.metricsStatus === 'evaluating';
    const isError = this.metricsStatus === 'error';
    const contentLength = this.rightEditor?.value?.trim().length || 0;
    const hasAnyMetric = metrics.sceneObjectivesMet > 0 || metrics.characterArcsAdvanced > 0 ||
      metrics.foreshadowingSeeded > 0 || metrics.emotionalArcProgress > 0 || metrics.overallCompletion > 0;
    const isInsufficient = contentLength < 50 && !hasAnyMetric;

    container.createEl("h4", { text: "\u{1F4CA} \u5267\u60C5\u5B8C\u6210\u5EA6", cls: "nw-cowrite-metrics-title" });
    const grid = container.createDiv({ cls: "nw-cowrite-metrics-grid" });
    if (isEvaluating) grid.addClass("nw-cowrite-metrics-evaluating-dim");
    const labels = ['场景目标', '人物弧', '伏笔', '情绪弧'];
    const values = [metrics.sceneObjectivesMet, metrics.characterArcsAdvanced, metrics.foreshadowingSeeded, metrics.emotionalArcProgress];
    for (let i = 0; i < 4; i++) {
      const item = grid.createDiv({ cls: "nw-cowrite-metrics-item" });
      const head = item.createDiv({ cls: "nw-cowrite-metrics-head" });
      head.createSpan({ cls: "nw-cowrite-metrics-label", text: labels[i] });
      head.createSpan({ cls: "nw-cowrite-metrics-value", text: `${values[i]}%` });
      const bar = item.createDiv({ cls: "nw-cowrite-metrics-bar" });
      bar.style.cssText = `width:100%;height:4px;background:var(--background-modifier-border);border-radius:2px;margin-top:2px;`;
      bar.createDiv({ cls: "nw-progress-fill", attr: { style: `width:${values[i]}%;height:100%;` } });
    }
    const overall = container.createDiv({ cls: "nw-cowrite-metrics-overall" });
    const overallHead = overall.createDiv({ cls: "nw-cowrite-metrics-head" });
    overallHead.createSpan({ cls: "nw-cowrite-metrics-label", text: "综合完成度" });
    if (isEvaluating) {
      overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value nw-cowrite-metrics-evaluating", text: "\u8BC4\u4F30\u4E2D..." });
      const overallBar = overall.createDiv({ cls: "nw-cowrite-metrics-bar nw-cowrite-metrics-loading-bar" });
      overallBar.style.cssText = `width:100%;height:6px;background:var(--background-modifier-border);border-radius:3px;margin-top:4px;`;
      overallBar.createDiv({ cls: "nw-progress-fill", attr: { style: `width:100%;height:100%;` } });
    } else {
      overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value", text: `${metrics.overallCompletion}%` });
      const overallBar = overall.createDiv({ cls: "nw-cowrite-metrics-bar" });
      overallBar.style.cssText = `width:100%;height:6px;background:var(--background-modifier-border);border-radius:3px;margin-top:4px;`;
      overallBar.createDiv({ cls: "nw-progress-fill", attr: { style: `width:${metrics.overallCompletion}%;height:100%;` } });
    }
    if (metrics.suggestionAdvice && !isEvaluating) {
      container.createDiv({ cls: "novel-writer-cowrite-advice", text: `\u{1F4A1} ${metrics.suggestionAdvice}` });
    }
    if (metrics.nextDirectionHints?.length && !isEvaluating) {
      const labels = metrics.nextDirectionHints.join('、');
      container.createDiv({ cls: "novel-writer-cowrite-next-directions", text: `\u4E0B\u4E00\u8F6E\u65B9\u5411\uFF1A${labels}` });
    }
    if (isError) {
      const errorEl = container.createDiv({ cls: "nw-cowrite-metrics-error", text: "\u274C \u8BC4\u4F30\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5" });
      errorEl.style.cursor = "pointer";
      errorEl.addEventListener("click", () => this.refreshMetrics(true));
    }
    if (isInsufficient && !isEvaluating && !isError) {
      container.createDiv({ cls: "nw-cowrite-metrics-hint", text: "\uD83D\uDCDD \u5185\u5BB9\u4E0D\u8DB3\uFF0C\u7EE7\u7EED\u5199\u4F5C\u540E\u81EA\u52A8\u8BC4\u4F30" });
    }
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
      new Notice(`\u2705 \u8D28\u68C0\u5B8C\u6210\uFF1A\u53D1\u73B0 ${count} \u4E2A\u95EE\u9898, ${this.qualityIssues.length} \u9879\u5F85\u5904\u7406`, 3000);
      this.refreshPreview(true);
    } catch (e) {
      log.warn('[CoWritingView] \u52A0\u8F7D\u8D28\u91CF\u63A7\u5236\u62A5\u544A\u5931\u8D25:', e);
      new Notice("\u274C \u52A0\u8F7D\u8D28\u91CF\u63A7\u5236\u62A5\u544A\u5931\u8D25", 3000);
    } finally {
      this.isQualityReportLoading = false;
    }
  }

  /** v6.4: 解析质量控制报告 markdown 为结构化问题列表 */
  private parseQualityReport(content: string): QualityIssue[] {
    if (!content || content.length < 50) return [];
    const issues: QualityIssue[] = [];
    const lines = content.split('\n');
    let currentCategory = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (/^#{1,3}\s+/.test(line)) {
        currentCategory = line.replace(/^#+\s*/, '').trim();
        continue;
      }

      let severity: '\u274C' | '\u26A0\uFE0F' | '\u2705' | null = null;
      if (line.startsWith('\u274C')) severity = '\u274C';
      else if (line.startsWith('\u26A0\uFE0F')) severity = '\u26A0\uFE0F';
      else if (line.startsWith('\u2705')) severity = '\u2705';
      if (!severity) continue;

      const priority: 'high' | 'medium' | 'low' = severity === '\u274C' ? 'high' : severity === '\u26A0\uFE0F' ? 'medium' : 'low';

      const problemText = line.replace(/^[\u274C\u26A0\u2705]\s*/, '').trim();

      if (severity === '\u2705') continue;

      const locationMatch = problemText.match(/\u7B2C(\d+)\u6BB5|\u7B2C(\d+)\u5B57|\u300C([^\u300D]+)\u300D|\u3010([^\u3011]+)\u3011/);
      const locationText = locationMatch
        ? (locationMatch[3] || locationMatch[4] || problemText.slice(0, 20))
        : '';

      const nextLines = lines.slice(i + 1, Math.min(i + 4, lines.length));
      let suggestion = nextLines
        .filter(l => l.trim() && !l.trim().startsWith('\u274C') && !l.trim().startsWith('\u26A0') && !l.trim().startsWith('\u2705'))
        .map(l => l.trim())
        .join(' ');

      if (!suggestion && problemText.length > 10) {
        suggestion = problemText;
      }

      issues.push({
        id: `qc_${issues.length + 1}`,
        priority,
        category: currentCategory,
        problem: problemText,
        suggestion: suggestion.slice(0, 120) + (suggestion.length > 120 ? '...' : ''),
        locationText: locationText || (problemText.length > 8 ? problemText.slice(0, 8) : problemText),
        severity,
      });
    }

    if (issues.length === 0) {
      const sugMatch = content.match(/\u3010[\u4FEE\u6539\u5EFA\u8BAE\u6C47\u603B|\u4FEE\u6539\u5EFA\u8BAE|\u5EFA\u8BAE].*?\u3011\s*([\s\S]*)/i);
      if (sugMatch) {
        const sugLines = sugMatch[1].split('\n').filter(l => l.trim());
        for (const s of sugLines) {
          const trimmed = s.trim();
          if (!trimmed || trimmed.startsWith('---')) continue;
          const hasPriority = trimmed.includes('\uD83D\uDD34') || trimmed.includes('\uD83D\uDFE1') || trimmed.includes('\uD83D\uDFE2');
          if (!hasPriority) continue;
          const priority: 'high' | 'medium' | 'low' = trimmed.includes('\uD83D\uDD34') ? 'high' : trimmed.includes('\uD83D\uDFE1') ? 'medium' : 'low';
          const text = trimmed.replace(/^-\s*/, '').replace(/[\uD83D\uDD34\uD83D\uDFE1\uD83D\uDFE2]/g, '').trim();
          if (text.length < 5) continue;
          issues.push({
            id: `qc_sum_${issues.length + 1}`,
            priority,
            category: '\u4FEE\u6539\u5EFA\u8BAE',
            problem: text.slice(0, 80),
            suggestion: text,
            locationText: '',
            severity: priority === 'high' ? '\u274C' : '\u26A0\uFE0F',
          });
        }
      }
    }

    return issues;
  }

  /** v6.4: 浮窗显示问题详情 */
  private showQualityPopup(event: MouseEvent, issue: QualityIssue) {
    this.hideQualityPopup();
    const popup = document.body.createDiv({ cls: "nw-quality-popup" });
    popup.style.left = `${Math.min(event.clientX + 10, window.innerWidth - 320)}px`;
    popup.style.top = `${Math.min(event.clientY - 10, window.innerHeight - 200)}px`;
    const header = popup.createDiv({ cls: "nw-quality-popup-header" });
    header.createSpan({ text: `${issue.severity} ${issue.category}` });
    const body = popup.createDiv({ cls: "nw-quality-popup-body" });
    body.createDiv({ cls: "nw-quality-popup-label", text: "\u95EE\u9898" });
    body.createDiv({ cls: "nw-quality-popup-text", text: issue.problem });
    body.createDiv({ cls: "nw-quality-popup-label", text: "\u5EFA\u8BAE" });
    body.createDiv({ cls: "nw-quality-popup-text", text: issue.suggestion });
    if (issue.locationText) {
      body.createDiv({ cls: "nw-quality-popup-label", text: "\u5B9A\u4F4D" });
      body.createDiv({ cls: "nw-quality-popup-location", text: `\u9644\u8FD1\u6587\u5B57\uFF1A${issue.locationText}` });
    }
    this.qualityReportPopup = popup;
  }

  private hideQualityPopup() {
    if (this.qualityReportPopup) {
      this.qualityReportPopup.remove();
      this.qualityReportPopup = null;
    }
  }

  /** v6.4: 右键菜单：AI 修复 */
  private showQualityContextMenu(event: MouseEvent, issue: QualityIssue) {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("\uD83D\uDD27 AI \u4FEE\u590D\u6B64\u95EE\u9898");
      item.setIcon("wand");
      item.onClick(() => void this.handleQualityFix(issue));
    });
    menu.addItem((item) => {
      item.setTitle("\uD83D\uDCCD \u5B9A\u4F4D\u5230\u7F16\u8F91\u5668");
      item.setIcon("go-to-file");
      item.onClick(() => this.scrollToTextInEditor(issue.locationText));
    });
    menu.showAtMouseEvent(event);
  }

  /** v6.4: 在编辑器中定位到包含指定文字的段落 */
  private scrollToTextInEditor(text: string) {
    if (!text || !this.rightEditor) return;
    const value = this.rightEditor.value;
    const idx = value.indexOf(text);
    if (idx >= 0) {
      this.rightEditor.focus();
      this.rightEditor.setSelectionRange(idx, idx + text.length);
      this.rightEditor.scrollTop = Math.max(0, this.getLineTop(this.rightEditor, idx) - 60);
      return;
    }
    const words = text.slice(0, 6);
    const fuzzyIdx = value.indexOf(words);
    if (fuzzyIdx >= 0) {
      this.rightEditor.focus();
      this.rightEditor.setSelectionRange(fuzzyIdx, fuzzyIdx + words.length);
      this.rightEditor.scrollTop = Math.max(0, this.getLineTop(this.rightEditor, fuzzyIdx) - 60);
      return;
    }
    new Notice(`\u26A0\uFE0F \u6B63\u6587\u4E2D\u672A\u627E\u5230 "${text.slice(0, 10)}..."`, 2000);
  }

  private getLineTop(textarea: HTMLTextAreaElement, charIndex: number): number {
    const text = textarea.value;
    const lineHeight = 20;
    const lines = text.slice(0, charIndex).split('\n');
    return lines.length * lineHeight;
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
    let targetStart = -1;
    let targetEnd = -1;

    if (issue.locationText && issue.locationText.length >= 2) {
      targetStart = fullText.indexOf(issue.locationText);
      if (targetStart >= 0) targetEnd = targetStart + issue.locationText.length;
    }

    const contextBefore = targetStart > 0 ? fullText.slice(Math.max(0, targetStart - 200), targetStart) : '';
    const targetText = targetStart >= 0 ? fullText.slice(targetStart, targetEnd) : '';
    const contextAfter = targetEnd > 0 ? fullText.slice(targetEnd, Math.min(fullText.length, targetEnd + 200)) : '';

    const fixingNotice = new Notice(`\uD83D\uDD27 \u6B63\u5728\u4FEE\u590D: ${issue.problem.slice(0, 30)}...`, 0);

    try {
      const prompt = [
        '\u4F60\u662F\u4E00\u4E2A\u5C0F\u8BF4\u7F16\u8F91AI\u3002\u8BF7\u6839\u636E\u8D28\u91CF\u62A5\u544A\u5BF9\u6B63\u6587\u4E2D\u7684\u95EE\u9898\u8FDB\u884C\u4FEE\u590D\u3002',
        '',
        '\u3010\u95EE\u9898\u3011',
        issue.problem,
        '',
        '\u3010\u4FEE\u6539\u5EFA\u8BAE\u3011',
        issue.suggestion,
        '',
        contextBefore ? '\u3010\u524D\u6587\u3011' : '',
        contextBefore ? contextBefore.slice(-150) : '',
        '',
        targetText ? '\u3010\u9700\u4FEE\u6539\u7684\u6587\u672C\u3011' : '',
        targetText || '\uFF08\u672A\u5B9A\u4F4D\u5230\u5177\u4F53\u6587\u672C\uFF0C\u5C06\u57FA\u4E8E\u4E0A\u4E0B\u6587\u5224\u65AD\uFF09',
        '',
        contextAfter ? '\u3010\u540E\u6587\u3011' : '',
        contextAfter ? contextAfter.slice(0, 150) : '',
        '',
        '\u8BF7\u76F4\u63A5\u8F93\u51FA\u4FEE\u6539\u540E\u7684\u6587\u672C\u7247\u6BB5\u3002\u53EA\u8F93\u51FA\u6B63\u6587\uFF0C\u4E0D\u52A0\u89E3\u91CA\u3002',
      ].filter(Boolean).join('\n');

      const response = await this.engine.callCoWriteForUi('', prompt, 0.3, 1200);
      const fixedText = response?.content || '';

      if (fixedText && targetStart >= 0 && targetEnd > targetStart) {
        // 请求期间用户可能继续输入：旧实现用请求前的全文快照重建整篇，
        // 把这段时间的输入全部抹掉。这里只在目标区间原文未变时替换该区间。
        const current = this.rightEditor.value;
        const currentSlice = current.slice(targetStart, targetEnd);
        if (currentSlice !== targetText) {
          new Notice("\u26A0\uFE0F \u6B63\u6587\u5DF2\u6539\u52A8\uFF0C\u672C\u6B21\u4FEE\u590D\u672A\u5E94\u7528\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B\u540E\u518D\u8BD5", 4e3);
          return;
        }
        const newText = current.slice(0, targetStart) + fixedText + current.slice(targetEnd);
        this.applyProgrammaticEdit(newText, targetStart + fixedText.length, 'AI 质量修复');
        void this.refreshPreview(true);
        new Notice("\u2705 \u4FEE\u590D\u5B8C\u6210", 2000);
      } else if (fixedText) {
        // 未定位到原文时只追加建议，绝不覆盖用户正文
        const current = this.rightEditor.value;
        const appended = current + '\n\n\u3010AI\u4FEE\u590D\u5EFA\u8BAE\u3011\n' + fixedText;
        this.applyProgrammaticEdit(appended, appended.length, 'AI 修复建议追加');
        void this.refreshPreview(true);
        new Notice("\u26A0\uFE0F \u672A\u5B9A\u4F4D\u5230\u7CBE\u786E\u4F4D\u7F6E\uFF0C\u5EFA\u8BAE\u5DF2\u8FFD\u52A0\u5728\u672B\u5C3E", 3000);
      }
    } catch (e) {
      log.warn('[CoWritingView] AI\u4FEE\u590D\u5931\u8D25:', e);
      new Notice("\u274C AI \u4FEE\u590D\u5931\u8D25", 2000);
    } finally {
      fixingNotice.hide();
    }
  }

  // ---- 基础 UI 方法 ----

  /** 渲染左栏「本章简报」：大纲 + 场景列表 + 当前场景卡 + 信息释放 */
  private renderBriefPanel(): void {
    if (!this.briefContent) return;
    const brief = this.facade.getChapterBrief();
    this.briefContent.empty();

    if (!brief || (brief.scenes.length === 0 && !brief.outlineSummary)) {
      this.briefSummaryEl?.setText("未找到章节规划");
      const empty = this.briefContent.createDiv({ cls: "nw-cowrite-brief-empty" });
      empty.createDiv({ text: "未找到 Scene 展开，无法从规划直接开头。可先回工作台完成步骤 6，或直接手写第一句。" });
      const btn = empty.createEl("button", { text: "去工作台", cls: "nw-btn nw-btn-ghost" });
      btn.addEventListener("click", () => { void this.plugin.openFullWriterView(); });
      return;
    }

    const total = brief.scenes.length;
    const currentNo = total > 0 ? Math.min(brief.currentIndex + 1, total) : 0;
    this.briefSummaryEl?.setText(
      total > 0 ? `场景 ${currentNo}/${total} · 已写 ${brief.writtenWords} 字` : `已写 ${brief.writtenWords} 字`
    );

    if (brief.outlineSummary) {
      const outline = this.briefContent.createDiv({ cls: "nw-cowrite-brief-outline" });
      outline.createDiv({ cls: "nw-cowrite-brief-label", text: "本章大纲" });
      outline.createDiv({ cls: "nw-cowrite-brief-text", text: brief.outlineSummary.slice(0, 240) });
    }

    if (total > 0) {
      const list = this.briefContent.createDiv({ cls: "nw-cowrite-brief-scenes" });
      brief.scenes.forEach((s, i) => {
        const done = i < brief.currentIndex;
        const active = i === brief.currentIndex;
        const item = list.createDiv({
          cls: `nw-cowrite-brief-scene${active ? " is-active" : ""}${done ? " is-done" : ""}`,
          attr: { title: s.objective || s.name || "" },
        });
        item.createSpan({
          cls: "nw-cowrite-brief-scene-name",
          text: `${done ? "✅" : active ? "▶" : "·"} 第${s.index}场 ${s.name || "未命名"}`,
        });
        item.addEventListener("click", () => {
          this.facade.setCurrentSceneIndex(i);
          this.renderBriefPanel();
          this.updatePlotCompletion();
          new Notice(`已切换当前场景：第${s.index}场 ${s.name || ""}`, 2000);
        });
      });
    }

    const cur = brief.currentScene;
    if (cur) {
      const card = this.briefContent.createDiv({ cls: "nw-cowrite-brief-card" });
      card.createDiv({ cls: "nw-cowrite-brief-label", text: `当前场景：${cur.name || "未命名"}` });
      const rows: Array<[string, string]> = [
        ["目标", cur.objective],
        ["冲突", cur.conflict],
        ["感官", cur.sensoryHook],
        ["记忆", cur.memoryTrigger],
        ["身体", cur.bodyReaction],
        ["潜台词", cur.subtext],
        ["关系", cur.relationshipShift],
        ["名场面", cur.keyScene],
      ];
      for (const [label, value] of rows) {
        if (!value) continue;
        const row = card.createDiv({ cls: "nw-cowrite-brief-row" });
        row.createSpan({ cls: "nw-cowrite-brief-row-label", text: label });
        row.createSpan({ cls: "nw-cowrite-brief-row-value", text: value });
      }
      if (cur.emotionStart || cur.emotionEnd) {
        card.createDiv({
          cls: "nw-cowrite-brief-emotion",
          text: `情绪：${cur.emotionStart || "—"} → ${cur.emotionEnd || "—"}${cur.emotionDelta ? `（${cur.emotionDelta}）` : ""}`,
        });
      }
      if (cur.cliffhanger) {
        card.createDiv({ cls: "nw-cowrite-brief-hook", text: `钩子：${cur.cliffhanger}` });
      }
    }

    if (brief.infoRelease) {
      const info = this.briefContent.createDiv({ cls: "nw-cowrite-brief-info" });
      info.createDiv({ cls: "nw-cowrite-brief-label", text: "信息释放" });
      info.createDiv({ cls: "nw-cowrite-brief-text", text: brief.infoRelease.slice(0, 220) });
    }
  }

  /** 空正文是否可以从章节规划冷启动 */
  private canColdStart(): boolean {
    const brief = this.facade.getChapterBrief();
    return !!brief && (brief.scenes.length > 0 || !!brief.outlineSummary);
  }

  /** 空正文时把主按钮改为「生成开头」，避免用户找不到冷启动入口 */
  private updateStartButtonState(): void {
    if (!this.suggestBtn) return;
    // 生成期间按钮文案由 handleTabSuggest 维护为「⏳ 生成中...」，
    // 重渲染（保存、切章预览等）不能把它覆盖回「✍️ 生成开头 / ⇥ 建议」。
    if (this.isSuggesting) return;
    const empty = !this.rightEditor?.value?.trim();
    this.suggestBtn.textContent = empty ? "✍️ 生成开头" : "⇥ 建议";
    this.suggestBtn.setAttribute(
      "title",
      empty ? "由本章 Scene 展开生成开头候选（不自动写入正文）" : "基于上文生成续写建议（方向可在上方临时指令填写）"
    );
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
      new Notice('偏好记忆已写入', 2000);
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
    this.monitorContainer.empty();

    this.renderLedgerCard();
    this.renderForeshadowCard();
    this.renderEntityCard();
    this.renderGuardCard();
    this.renderStatusCard();
  }

  /** v4.20 注入溯源卡：本次会话各注入段的字符/预算/截断情况（结算回写 + 指纹分层） */
  private renderLedgerCard() {
    // Facade 有 engine getter（CoWriterEngine）；getInjectionLedgerText 定义在引擎上
    const text = this.facade.engine.getInjectionLedgerText();
    const card = this.monitorContainer.createDiv({ cls: "nw-cowrite-monitor-card" });
    const header = card.createDiv({ cls: "nw-cowrite-monitor-card-header" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-icon", text: "🧾" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-title", text: "注入溯源" });
    const toggle = header.createSpan({ cls: "nw-cowrite-monitor-card-toggle", text: "▶" });
    const body = card.createDiv({ cls: "nw-cowrite-monitor-card-body" });

    if (!text) {
      body.createDiv({ cls: "nw-cowrite-monitor-summary", text: "注入账本尚未生成" });
      return;
    }
    const lines = text.split("\n");
    body.createDiv({ cls: "nw-cowrite-monitor-summary", text: lines[0] || "" });
    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });
    const list = detail.createEl("ul", { cls: "nw-cowrite-monitor-list" });
    for (const line of lines.slice(1)) {
      if (line.trim()) list.createEl("li", { text: line.replace(/^- /, "") });
    }

    header.addEventListener("click", () => {
      const isExpanded = detail.style.display === "block";
      detail.style.display = isExpanded ? "none" : "block";
      toggle.textContent = isExpanded ? "▶" : "▼";
      card.toggleClass("nw-cowrite-monitor-card-expanded", !isExpanded);
    });
  }

  /** 供实时分析控制器在守卫/保存后刷新监控卡（旧实现只在布局时渲染一次） */
  refreshMonitorPanel(): void {
    this.renderMonitorPanel();
  }

  private renderForeshadowCard() {
    const foreshadows: { unrevealed: any[]; revealed: any[]; abandoned: any[] } =
        (this.facade.getSession() as unknown as { snapshot?: { foreshadows?: { unrevealed: any[]; revealed: any[]; abandoned: any[] } } } | null)?.snapshot?.foreshadows
        || { unrevealed: [], revealed: [], abandoned: [] };
    const unrevealed = foreshadows.unrevealed || [];
    const revealed = foreshadows.revealed || [];
    const abandoned = foreshadows.abandoned || [];

    const card = this.monitorContainer.createDiv({ cls: "nw-cowrite-monitor-card" });
    const header = card.createDiv({ cls: "nw-cowrite-monitor-card-header" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-icon", text: "📌" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-title", text: "伏笔状态追踪" });
    const toggle = header.createSpan({ cls: "nw-cowrite-monitor-card-toggle", text: "▶" });
    const body = card.createDiv({ cls: "nw-cowrite-monitor-card-body" });

    body.createDiv({ cls: "nw-cowrite-monitor-summary", text: `未揭示 ${unrevealed.length} · 已揭示 ${revealed.length} · 已放弃 ${abandoned.length}` });

    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });
    if (unrevealed.length > 0) {
      detail.createDiv({ cls: "nw-cowrite-monitor-detail-title", text: "未揭示伏笔:" });
      const ul = detail.createEl("ul", { cls: "nw-cowrite-monitor-list" });
      unrevealed.slice(0, 5).forEach((f: any) => {
        ul.createEl("li", { text: `${f.name || f}${f.plannedReveal ? ` (预计: ${f.plannedReveal})` : ''}` });
      });
      if (unrevealed.length > 5) ul.createEl("li", { cls: "nw-cowrite-monitor-more", text: `...还有 ${unrevealed.length - 5} 条` });
    }

    header.addEventListener("click", () => {
      const isExpanded = detail.style.display === "block";
      detail.style.display = isExpanded ? "none" : "block";
      toggle.textContent = isExpanded ? "▶" : "▼";
      card.toggleClass("nw-cowrite-monitor-card-expanded", !isExpanded);
    });
  }

  private renderEntityCard() {
    const card = this.monitorContainer.createDiv({ cls: "nw-cowrite-monitor-card" });
    const header = card.createDiv({ cls: "nw-cowrite-monitor-card-header" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-icon", text: "🧑" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-title", text: "实体动态" });
    const toggle = header.createSpan({ cls: "nw-cowrite-monitor-card-toggle", text: "▶" });
    const body = card.createDiv({ cls: "nw-cowrite-monitor-card-body" });

    // 正文路径必须走 getBodyPath()：旧实现拼的是 `${project}/${volume}/${chapterName}_正文.md`，
    // 真实落盘路径是 03-大纲与章节/正文/...，拼接结果永远不存在 → 卡片恒为全 0。
    const bodyPath = this.project && this.chapterNum ? this.getBodyPath() : '';
    const abstractFile = bodyPath ? this.app.vault.getAbstractFileByPath(bodyPath) : null;
    const file = abstractFile instanceof TFile ? abstractFile : null;
    const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {};
    const chars = (fm['涉及人物'] || []) as string[];
    const locs = (fm['涉及地点'] || []) as string[];
    const factions = (fm['涉及势力'] || []) as string[];
    const items = (fm['涉及物品功法'] || []) as string[];

    body.createDiv({ cls: "nw-cowrite-monitor-summary", text: `人物 ${chars.length} · 地点 ${locs.length} · 势力 ${factions.length} · 物品 ${items.length}` });

    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });

    if (chars.length > 0) {
      detail.createDiv({ cls: "nw-cowrite-monitor-detail-title", text: "涉及人物:" });
      const ul = detail.createEl("ul", { cls: "nw-cowrite-monitor-list" });
      // 只在本项目的人物设定目录里找：全库 includes 匹配会把同名角色的别书状态显示出来
      const projectPrefix = this.project ? `${this.project}/` : '';
      chars.slice(0, 5).forEach((charName: string) => {
        const charFile = this.app.vault.getFiles().find(f =>
          f.path.startsWith(projectPrefix) && f.path.includes('人物设定') && f.name.includes(charName)
        );
        const charFm: Record<string, unknown> = charFile ? (this.app.metadataCache.getFileCache(charFile)?.frontmatter || {}) : {};
        const status = (charFm['当前状态'] as string | undefined) || '未知';
        const realm = (charFm['境界'] as string | undefined) || (charFm['修为'] as string | undefined) || '';
        const lastChange = charFm['entity_last_changed_at'] ? `(${charFm['entity_last_changed_at'] as string})` : '';
        ul.createEl("li", { text: `${charName}${realm ? ` · ${realm}` : ''} · ${status} ${lastChange}` });
      });
      if (chars.length > 5) ul.createEl("li", { cls: "nw-cowrite-monitor-more", text: `...还有 ${chars.length - 5} 人` });
    }

    if (locs.length > 0) {
      detail.createDiv({ cls: "nw-cowrite-monitor-detail-title", text: "涉及地点:" });
      detail.createDiv({ cls: "nw-cowrite-monitor-tags", text: locs.slice(0, 8).join(', ') + (locs.length > 8 ? `...` : '') });
    }
    if (factions.length > 0) {
      detail.createDiv({ cls: "nw-cowrite-monitor-detail-title", text: "涉及势力:" });
      detail.createDiv({ cls: "nw-cowrite-monitor-tags", text: factions.slice(0, 8).join(', ') + (factions.length > 8 ? `...` : '') });
    }

    header.addEventListener("click", () => {
      const isExpanded = detail.style.display === "block";
      detail.style.display = isExpanded ? "none" : "block";
      toggle.textContent = isExpanded ? "▶" : "▼";
      card.toggleClass("nw-cowrite-monitor-card-expanded", !isExpanded);
    });
  }

  private renderGuardCard() {
    const card = this.monitorContainer.createDiv({ cls: "nw-cowrite-monitor-card" });
    const header = card.createDiv({ cls: "nw-cowrite-monitor-card-header" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-icon", text: "⚠️" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-title", text: "设定守卫" });
    const toggle = header.createSpan({ cls: "nw-cowrite-monitor-card-toggle", text: "▶" });
    const body = card.createDiv({ cls: "nw-cowrite-monitor-card-body" });

    // 数据源是 LiveAnalysisController 的真实守卫结果。
    // 旧实现读 `liveAnalysis.issues` —— 该字段从来没有存在过，卡片恒显示「高 0 · 中 0 · 低 0」。
    const summary = this.liveAnalysis?.getGuardSummary?.() ?? null;
    const oocCount = summary?.oocWarnings.length ?? 0;
    const changeCount = summary?.entityChanges.length ?? 0;
    const scoreText = summary?.consistencyScore != null ? `一致性 ${summary.consistencyScore}% · ` : '';

    if (!summary) {
      body.createDiv({ cls: "nw-cowrite-monitor-summary", text: "本章尚未检查（输入停顿或点「设定检查」后自动执行）" });
      return;
    }

    body.createDiv({
      cls: "nw-cowrite-monitor-summary",
      text: `${scoreText}OOC ${oocCount} · 实体变更 ${changeCount}`
    });

    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });

    if (oocCount > 0 || changeCount > 0) {
      const ul = detail.createEl("ul", { cls: "nw-cowrite-monitor-list" });
      summary.oocWarnings.slice(0, 5).forEach(warning => {
        const li = ul.createEl("li");
        const tag = li.createSpan({ cls: "nw-cowrite-monitor-priority", text: "OOC" });
        tag.setCssStyles({ color: '#ef4444' });
        li.createSpan({ text: ` ${warning}` });
      });
      summary.entityChanges.slice(0, 5).forEach(change => {
        const li = ul.createEl("li");
        const tag = li.createSpan({ cls: "nw-cowrite-monitor-priority", text: "变更" });
        tag.setCssStyles({ color: '#3b82f6' });
        li.createSpan({ text: ` ${change.entityName} → ${change.newStatus}` });
      });
    }

    header.addEventListener("click", () => {
      const isExpanded = detail.style.display === "block";
      detail.style.display = isExpanded ? "none" : "block";
      toggle.textContent = isExpanded ? "▶" : "▼";
      card.toggleClass("nw-cowrite-monitor-card-expanded", !isExpanded);
    });
  }

  private renderStatusCard() {
    const card = this.monitorContainer.createDiv({ cls: "nw-cowrite-monitor-card" });
    const header = card.createDiv({ cls: "nw-cowrite-monitor-card-header" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-icon", text: "📊" });
    header.createSpan({ cls: "nw-cowrite-monitor-card-title", text: "状态监控" });
    const toggle = header.createSpan({ cls: "nw-cowrite-monitor-card-toggle", text: "▶" });
    const body = card.createDiv({ cls: "nw-cowrite-monitor-card-body" });

    const text = this.rightEditor?.value || '';
    const paragraphs = text.split('\n').filter(p => p.trim()).length;
    const dialogueCount = (text.match(/["“‘『」』][^"“”‘’『』]*["“”‘’『』]/g) || []).length;
    const totalChars = text.trim().length;
    const dialogueRatio = totalChars > 0 ? Math.round((dialogueCount * 20 / totalChars) * 100) : 0;

    body.createDiv({ cls: "nw-cowrite-monitor-summary", text: `段落 ${paragraphs} · 对话 ${dialogueRatio}% · 字数 ${totalChars}` });

    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });
    detail.createDiv({ cls: "nw-cowrite-monitor-detail-title", text: "详细统计:" });
    detail.createDiv({ cls: "nw-cowrite-monitor-stat", text: `平均段落长度: ${totalChars > 0 ? Math.round(totalChars / Math.max(1, paragraphs)) : 0} 字` });
    detail.createDiv({ cls: "nw-cowrite-monitor-stat", text: `对话片段数: ${dialogueCount}` });
    const actionWords = ['打', '杀', '战', '攻', '守', '逃', '追', '躲', '闪', '挡'];
    const actionCount = actionWords.reduce((acc, word) => acc + (text.match(new RegExp(word, 'g')) || []).length, 0);
    detail.createDiv({ cls: "nw-cowrite-monitor-stat", text: `动作描写频次: ${actionCount}` });

    header.addEventListener("click", () => {
      const isExpanded = detail.style.display === "block";
      detail.style.display = isExpanded ? "none" : "block";
      toggle.textContent = isExpanded ? "▶" : "▼";
      card.toggleClass("nw-cowrite-monitor-card-expanded", !isExpanded);
    });
  }

  private async getAssetStatus(): Promise<{
    knowledgeBase: { completed: number; total: number; completeness: number };
    fingerprint: { completed: number; total: number; completeness: number };
  }> {
    const kbResult = await this.calculateKnowledgeBaseCompleteness();
    const fpResult = await this.calculateFingerprintCompleteness();
    return {
      knowledgeBase: kbResult,
      fingerprint: fpResult,
    };
  }

  private async calculateKnowledgeBaseCompleteness(): Promise<{ completed: number; total: number; completeness: number }> {
    if (!this.facade.knowledgeBaseManager) {
      return { completed: 0, total: 0, completeness: 0 };
    }
    try {
      const books = await this.facade.knowledgeBaseManager.getAllBooks();
      const total = books.length;
      let completed = 0;
      for (const book of books) {
        if (book.breakdownStatus === 'completed') {
          completed++;
        }
      }
      const completeness = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { completed, total, completeness };
    } catch {
      return { completed: 0, total: 0, completeness: 0 };
    }
  }

  private async calculateFingerprintCompleteness(): Promise<{ completed: number; total: number; completeness: number }> {
    const fpLibrary = this.facade.getFingerprintLibrary();
    if (!fpLibrary) {
      return { completed: 0, total: 0, completeness: 0 };
    }
    try {
      await fpLibrary.loadGlobal();
      await fpLibrary.loadProject();
      const projectFps = fpLibrary.listProject();
      const globalFps = fpLibrary.listGlobal();
      const allFps = [...projectFps, ...globalFps];
      const enabledFps = allFps.filter(fp => fp.enabled);
      const total = enabledFps.length;
      let completed = 0;
      for (const fp of enabledFps) {
        const features = fp.features;
        const featureKeys = ['sentenceRhythm', 'wordPreference', 'narrativeStyle', 'rhetoric', 'dialogueStyle', 'paragraphStructure', 'overallTone'] as const;
        const filledFeatures = featureKeys.filter(k => features[k] && features[k].length > 0).length;
        const hasSamples = fp.samples.length >= 15;
        const hasSource = fp.sourceText && fp.sourceText.length > 0;
        const score = Math.round((filledFeatures / 7) * 40) + (hasSamples ? 30 : fp.samples.length > 0 ? Math.round((fp.samples.length / 15) * 30) : 0) + (hasSource ? 30 : 0);
        if (score >= 85) {
          completed++;
        }
      }
      const completeness = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { completed, total, completeness };
    } catch {
      return { completed: 0, total: 0, completeness: 0 };
    }
  }

  private getCompletenessIcon(completeness: number): { icon: string; color: string } {
    if (completeness >= 100) {
      return { icon: '✓', color: 'var(--text-success, #10b981)' };
    } else if (completeness >= 60) {
      return { icon: '⚠', color: 'var(--text-warning, #f59e0b)' };
    } else {
      return { icon: '✗', color: 'var(--text-error, #ef4444)' };
    }
  }

  private async renderAssetStatusBar(): Promise<void> {
    if (!this.assetStatusBar) return;
    this.assetStatusBar.empty();

    const status = await this.getAssetStatus();

    const kbIcon = this.getCompletenessIcon(status.knowledgeBase.completeness);
    const fpIcon = this.getCompletenessIcon(status.fingerprint.completeness);

    const badge = this.assetStatusBar.createDiv({
      cls: 'nw-asset-status-badge',
      attr: {
        style: 'display:flex;align-items:center;gap:12px;padding:6px 12px;border-radius:6px;background:var(--background-secondary);cursor:pointer;transition:background 0.2s;'
      }
    });

    const kbPart = badge.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:4px;' }
    });
    kbPart.createSpan({ text: '📚', attr: { style: 'font-size:14px;' } });
    kbPart.createSpan({ text: `知识库 ${status.knowledgeBase.completed}/${status.knowledgeBase.total}`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
    kbPart.createSpan({ text: kbIcon.icon, attr: { style: `font-size:12px;color:${kbIcon.color};font-weight:600;` } });

    badge.createSpan({ text: '|', attr: { style: 'color:var(--background-modifier-border);' } });

    const fpPart = badge.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:4px;' }
    });
    fpPart.createSpan({ text: '🎨', attr: { style: 'font-size:14px;' } });
    fpPart.createSpan({ text: `指纹 ${status.fingerprint.completed}/${status.fingerprint.total}`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
    fpPart.createSpan({ text: fpIcon.icon, attr: { style: `font-size:12px;color:${fpIcon.color};font-weight:600;` } });

    badge.addEventListener('mouseenter', () => {
      badge.style.background = 'var(--background-secondary-alt)';
    });
    badge.addEventListener('mouseleave', () => {
      badge.style.background = 'var(--background-secondary)';
    });
    badge.addEventListener('click', () => {
      this.openRefillModal('knowledge');
    });
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
        new Notice('获取书籍列表失败');
      });
    }
  }
}
