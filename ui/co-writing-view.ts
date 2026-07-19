/**
 * co-writing-view.ts — 句级协同写作视图 (v5.0)
 *
 * 交互闭环：Tab 生成建议 → 接受/编辑 → AI 验证 → 完成度调整方向。
 * （本文件为运行时恢复重建版，逻辑与上一个可用构建一致）
 */

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, TFile, Menu } from 'obsidian';
import { SUBDIR_STEP_ROOT } from '../shared/paths';
import { CHAPTER_FILE_TYPES } from '../engine/chapter-utils';

import NovelWriterPlugin from '../main';
import { CoWriterEngine, resolveCoWriteLocalModel } from '../engine/co-writer-engine';
import { CoWriteFacade } from './services/co-write-facade';
import type { BookBasicInfo } from '../services/knowledge-base-manager';
import { WebnovelKnowledgeBase } from '../engine/webnovel-knowledge-base';
import { EmotionCurveAnalyzer } from '../engine/emotion-curve-analyzer';
import { RhythmAnalyzer } from '../engine/rhythm-analyzer';
import { EndingTractionEngine } from '../engine/ending-traction-engine';
import { EmotionCurveView } from './components/emotion-curve-view';
import { ChapterSettlementModal } from './chapter-settlement-modal';
import { SuggestionEditModal } from './cowrite/suggestion-edit-modal';
import { IterateInstructionModal } from './cowrite/iterate-instruction-modal';
import { HistoryModal } from './cowrite/history-modal';
import { MemoryManagerModal } from './cowrite/memory-manager-modal';
import { RefillModal } from './refill-modal';
import { OutlineExpandModal } from './outline-expand-modal';
import { LiveAnalysisController } from './cowrite/live-analysis-controller';
import { AdaptiveDebounceManager } from '../shared/adaptive-debounce-manager';
import { SuggestionHistoryStore } from './cowrite/suggestion-history-store';
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
import { createLogger } from '../shared/logger';


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
  previewContent!: HTMLElement;
  rightEditor!: HTMLTextAreaElement;
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
  emotionCurveAnalyzer: EmotionCurveAnalyzer | null = null;
  rhythmAnalyzer: RhythmAnalyzer | null = null;
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
  pendingRewriteRange: { start: number; end: number } | null = null;
  lastSuggestAt = 0;
  lastPreviewAt = 0;
  lastMetricsAt = 0;
  lastTractionAt = 0;
  private ghostDebounceManager = new AdaptiveDebounceManager({ debug: false });
  private autoSaveDebouncer = new AdaptiveDebounceManager({ debug: false });
  private isSaving = false;
  lastGhostSeed = "";
  liveAnalysis!: LiveAnalysisController;
  historyStore!: SuggestionHistoryStore;
  private suggestAbortController: AbortController | null = null;  // v6.3: 防重复请求
  private metricsAbortController: AbortController | null = null;
  metricsStatus: 'idle' | 'evaluating' | 'error' = 'idle';
  private suggestBtn: HTMLButtonElement | null = null;  // BUG-K fix: 建议按钮引用，用于禁用态
  private nextNodeBtn: HTMLButtonElement | null = null;  // v6.4: 推进下一节点按钮引用
  private modelToggleBtn: HTMLButtonElement | null = null;  // v7.2: 模型切换按钮引用
  private precisionModeBtn: HTMLButtonElement | null = null;
  private humanRateDashboard: HTMLElement | null = null;
  private assetStatusBar: HTMLElement | null = null;

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
  }
  getViewType() {
    return VIEW_TYPE_CO_WRITE;
  }
  getDisplayText() {
    return "\u270D\uFE0F \u53E5\u7EA7\u534F\u540C\u5199\u4F5C";
  }
  getIcon() {
    return "pen-nib";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    applyNwScope(this);
    const wb = this.plugin._workbenchState;
    if (wb) {
      this.project = wb.project || "";
      this.chapterName = wb.chapterName || "";
      this.chapterNum = wb.chapterNum || 1;
      this.volume = wb.volume || "\u7B2C1\u5377";
    }
    this.renderLayout();
    this.bindEvents();
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
  async onClose() {
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
    if (this.liveAnalysis && typeof this.liveAnalysis.clearTimers === 'function') {
      this.liveAnalysis.clearTimers();
    }
    await this.saveBody(false);
    this.autoSaveDebouncer.dispose();
  }
  /** 打开指定章节的协同写作视图 */
  async openChapter(project: string, chapterName2: string, volume2 = "\u7B2C1\u5377", chapterNum = 1) {
    this.project = project;
    this.chapterName = chapterName2;
    this.volume = volume2;
    this.chapterNum = chapterNum;
    this.historyLoaded = false; // B3: 章节切换后重新加载历史

    // P0: 前置规划完整性检查 — 确保 AI 建议生成时有充分上下文
    await this.checkPrerequisites(project, chapterName2, volume2);

    if (!this.rightEditor)
      return;
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
    this.updateControlState("\u5DF2\u52A0\u8F7D");
    this.refreshStatusBar();
    this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics());
    await this.historyStore.loadSuggestionHistory();
    await this.refreshPreview(true);
    try {
      await this.facade.initEngine(project, chapterName2, volume2, chapterNum);
      this.facade.updateSnapshot(this.rightEditor.value);
      this.emotionCurveAnalyzer = this.facade.createEmotionCurveAnalyzer();
      this.rhythmAnalyzer = this.facade.createRhythmAnalyzer();
      this.tractionEngine = await this.facade.createEndingTractionEngine(project);
      await this.renderAllPanels();
      this.updatePlotCompletion();
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
    const missing: string[] = [];

    // 检查关键前置步骤文件是否存在
    const checks = [
      { name: '信息规划', file: `${stepDir}/${chapterPrefix}_信息规划.md` },
      { name: '大纲摘要', file: `${stepDir}/${chapterPrefix}_大纲摘要.md` },
    ];

    for (const check of checks) {
      const f = this.app.vault.getAbstractFileByPath(check.file);
      if (!(f instanceof TFile)) {
        missing.push(check.name);
      } else {
        // 文件存在但检查是否是空模板（内容过短）
        try {
          const content = await this.app.vault.read(f);
          const body = content.replace(/^---[\s\S]*?---/, '').trim();
          if (body.length < 100) missing.push(check.name + '（内容过短）');
        } catch { missing.push(check.name + '（读取失败）'); }
      }
    }

    if (missing.length > 0) {
      // 在编辑器上方显示黄色警告横幅
      const banner = this.contentEl.createDiv({
        cls: 'nw-cowrite-prereq-warning',
        attr: { style: 'background: var(--text-warning-bg, #fff3cd); color: var(--text-warning); padding: 8px 12px; margin: 4px 0; border-radius: 4px; font-size: 0.82em; border-left: 3px solid var(--text-warning, #f59e0b);' },
      });
      banner.createEl('strong', { text: '⚠️ 前置规划未完成：' });
      banner.createEl('span', { text: ` 缺少 ${missing.join('、')}。建议先在「全本写作工作台」中运行前置规划步骤，否则 AI 建议可能缺乏章节上下文和世界观设定信息。` });
      // 5 秒后自动淡出
      setTimeout(() => { banner.style.opacity = '0'; banner.style.transition = 'opacity 1s'; }, 8000);
      log.warn(`[CoWritingView] 前置规划检查 — 缺失: ${missing.join(', ')}`);
    }
  }

  renderLayout() {
    this.mainContainer = this.contentEl.createDiv({ cls: "nw-cowrite-root" });
    const header = this.mainContainer.createDiv({ cls: "nw-cowrite-header" });
    const titleDiv = header.createDiv({ cls: "nw-cowrite-title" });
    titleDiv.createSpan({ cls: "nw-cowrite-title-icon", text: "\u{1F4DD}" });
    titleDiv.createSpan({ text: "\u534F\u540C\u5199\u4F5C" });
    this.statusBar = header.createDiv({ cls: "nw-cowrite-status", text: "加载中..." });
    const kbBtn = header.createEl("button", { text: "\u{1F4DA} 知识库", cls: "nw-float-monitor-toggle nw-btn-knowledge" });
    kbBtn.addEventListener("click", () => { this.openKnowledgePanel(); });
    const entityBtn = header.createEl("button", { text: "👥 实体", cls: "nw-float-monitor-toggle" });
    entityBtn.setAttribute("title", "统一实体管理（人物/地点/势力/物品）");
    entityBtn.addEventListener("click", () => {
      if (this.project) {
        new UnifiedEntityManagerModal(this.app, this.plugin, this.project).open();
      } else {
        new Notice("⚠️ 请先打开一个项目章节", 3000);
      }
    });
    const importBtn = header.createEl("button", { text: "\u{1F4E5} 导入", cls: "nw-float-monitor-toggle nw-btn-import" });
    importBtn.addEventListener("click", () => { this.openBatchImportModal(); });
    const kbMonitorBtn = header.createEl("button", { text: "\u{1F4CA} 监控", cls: "nw-float-monitor-toggle nw-btn-monitor" });
    kbMonitorBtn.addEventListener("click", () => { this.openKnowledgeMonitorModal(); });
    const analyzeBtn = header.createEl("button", { text: "\u{1F52C} \u5206\u6790", cls: "nw-float-monitor-toggle nw-btn-analyze" });
    analyzeBtn.addEventListener("click", () => { this.openAnalysisModal(); });
    const monBtn = header.createEl("button", { text: "\u{1F4C8} \u5267\u60C5", cls: "nw-float-monitor-toggle nw-btn-monitor" });
    monBtn.addEventListener("click", () => { this.toggleFloatingPanel(); });
    const precisionBtn = header.createEl("button", { text: "\uD83C\uDFAF \u7CBE\u51C6\u6A21\u5F0F", cls: "nw-precision-mode-btn nw-btn nw-btn-sm", attr: { title: "\u7CBE\u51C6\u6A21\u5F0F\uFF1A\u9010\u53E5\u68C0\u7D22+\u98CE\u683C\u8BC4\u5206+\u53CDAI\u68C0\u6D4B" } });
    precisionBtn.addEventListener("click", () => { this.togglePrecisionMode(); });
    this.precisionModeBtn = precisionBtn;

    this.assetStatusBar = header.createDiv({ cls: "nw-asset-status-bar" });
    void this.renderAssetStatusBar();

    const mainArea = this.mainContainer.createDiv({ cls: "nw-cowrite-main" });

    // 左侧：预览区（可折叠，默认窄）
    const leftPanel = mainArea.createDiv({ cls: "nw-cowrite-left" });
    const previewSection = leftPanel.createDiv({ cls: "nw-cowrite-preview" });
    previewSection.createDiv({ cls: "nw-cowrite-preview-label", text: "预览" });
    this.previewContent = previewSection.createDiv({ cls: "nw-cowrite-preview-content" });
    const previewToggle = previewSection.createDiv({ cls: "nw-cowrite-preview-toggle" });
    previewToggle.createSpan({ text: "收起 ▲" });
    previewToggle.addEventListener("click", () => {
        leftPanel.toggleClass("nw-cowrite-left-collapsed", !leftPanel.hasClass("nw-cowrite-left-collapsed"));
        previewToggle.setText(leftPanel.hasClass("nw-cowrite-left-collapsed") ? "展开 ▼" : "收起 ▲");
    });

    // 中央：编辑器 + 建议窗口（左右分栏）
    const centerPanel = mainArea.createDiv({ cls: "nw-cowrite-center" });
    const editorWrap = centerPanel.createDiv({ cls: "nw-cowrite-editor-wrap" });
    this.rightEditor = editorWrap.createEl("textarea", { cls: "nw-cowrite-editor" });
    this.rightEditor.spellcheck = false;
    this.rightEditor.placeholder = "在此写作……按 Tab 生成 AI 建议";
    this.ghostSuggestionContainer = editorWrap.createDiv({ cls: "nw-cowrite-ghost-suggestion" });
    this.ghostSuggestionContainer.addEventListener("click", () => {
      if (this.ghostSuggestion)
        void this.handleAcceptSuggestion(this.ghostSuggestion);
    });

    // v7.0: 建议窗口移到编辑器区域右侧，作为独立一栏
    this.suggestionContainer = centerPanel.createDiv({ cls: "nw-cowrite-suggestions-panel" });
    const suggestionHeader = this.suggestionContainer.createDiv({ cls: "nw-cowrite-suggestions-header" });
    const suggestionTitle = suggestionHeader.createDiv({ cls: "nw-cowrite-suggestions-title", text: "AI 建议" });
    this.suggestionStatusText = suggestionHeader.createDiv({ cls: "nw-cowrite-suggestions-status", text: "等待生成" });
    const suggestionCloseBtn = suggestionHeader.createEl("button", { text: "✕", cls: "nw-cowrite-suggestions-close" });
    suggestionCloseBtn.addEventListener("click", () => {
      this.suggestionContainer.style.display = 'none';
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
      attr: { "data-tab": "knowledge" }
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
    this.saveStateDisplay = controlHead.createDiv({ cls: "nw-cowrite-control-state", text: "未保存" });

    this.hintInput = controlPanel.createEl("input", {
      type: "text",
      cls: "nw-hint-input",
      placeholder: "临时指令 / 方向（Enter 应用）"
    });

    // 按钮改为 inline-flex 紧凑布局
    const actionsRow = controlPanel.createDiv({ cls: "nw-cowrite-control-actions" });
    const actions = [
      { text: "🖥 本地", cls: "nw-btn-ghost", action: () => this.handleModelToggle() },
      { text: "⏭ 节点 -/-", cls: "nw-btn-primary", action: () => this.handleAdvanceNextNode() },
      { text: "\u21E5 建议", cls: "nw-btn-primary", action: () => this.handleTabSuggest(true) },
      { text: "✨ 联想", cls: "nw-btn-ghost", action: () => this.handleAssociationSuggest() },
      { text: "✍️ 扩写", cls: "nw-btn-ghost", action: () => this.handleOutlineExpand() },
      { text: "🕘 历史", cls: "nw-btn-ghost", action: () => this.handleOpenHistory() },
      { text: "🧠 记忆", cls: "nw-btn-ghost", action: () => this.handleOpenMemoryManager() },
      { text: "📥 批量导入", cls: "nw-btn-ghost", action: () => this.openBatchImportModal() },
      { text: "✂ 改写", cls: "nw-btn-ghost", action: () => this.handleRewriteSelection() },
      { text: "🛡 检查", cls: "nw-btn-ghost", action: () => this.liveAnalysis.inspectSettingGuard("manual") },
      { text: "📋 质检", cls: "nw-btn-ghost", action: () => void this.loadQualityReport() },
      { text: "💾 保存", cls: "nw-btn-ghost", action: () => this.saveBody(true) },
      { text: "✅ 标记完稿", cls: "nw-btn-ghost", action: () => this.markAsWritten() },
      { text: "📊 结算", cls: "nw-btn-primary", action: () => this.handleComplete() },
    ];
    for (const btn of actions) {
      const el = actionsRow.createEl("button", { text: btn.text, cls: `nw-btn ${btn.cls}` });
      el.addEventListener("click", btn.action);
      // BUG-K fix: 存储"建议"按钮引用以便禁用态控制
      if (btn.text.includes("建议")) {
        this.suggestBtn = el;
      }
      // v6.4: 存储推进下一节点按钮引用，用于刷新节点状态文字
      if (btn.text.includes("⏭")) {
        this.nextNodeBtn = el;
      }
      // v7.2: 存储模型切换按钮引用，用于刷新按钮文字
      if (btn.text.includes("🖥") || btn.text.includes("☁")) {
        this.modelToggleBtn = el;
      }
    }
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
  renderFloatingMetrics() {
    if (!this.floatingMetricsSection) return;
    this.floatingMetricsSection.empty();
    const metrics = this.engine?.getSession()?.currentMetrics || { sceneObjectivesMet: 0, characterArcsAdvanced: 0, foreshadowingSeeded: 0, emotionalArcProgress: 0, overallCompletion: 0, suggestionAdvice: '', nextDirectionHints: [], evaluatedAt: 0 };
    this.renderMetricsInto(metrics, this.floatingMetricsSection);
  }
  renderFloatingQuality() {
    if (!this.floatingQualitySection) return;
    this.floatingQualitySection.empty();
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
  bindEvents() {
    this.rightEditor.addEventListener("keydown", (event: KeyboardEvent) => this.handleEditorKeydown(event));
    this.rightEditor.addEventListener("input", () => {
      this.facade.updateSnapshot(this.rightEditor.value);
      this.updateControlState("编辑中");
      void this.refreshPreview(false);
      this.liveAnalysis.scheduleRefresh("input");
      this.scheduleGhostAssociationRefresh();
      this.updatePlotCompletion();
      this.autoSaveDebouncer.debounceFixed("auto-save", () => {
        void this.saveBody(false);
      }, 2000);
    });
    this.hintInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter")
        this.applyHint();
    });
  }
  async handleEditorKeydown(event: KeyboardEvent) {
    if (event.key === "Tab") {
      event.preventDefault();
      if (this.ghostSuggestion) {
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
  async handleTabSuggest(force = false) {
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

    this.lastSuggestAt = now;
    this.isSuggesting = true;
    this.facade.syncSuggestionsGenerating(true);
    // BUG-K fix: 生成期间禁用建议按钮，给出视觉反馈
    if (this.suggestBtn) {
      this.suggestBtn.disabled = true;
      this.suggestBtn.textContent = "⏳ 生成中...";
    }

    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
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

    this.renderSuggestionLoading();
    this.suggestProgressEmitter.start();

    const startTime = Date.now();
    const wordCount = precedingText.length;

    if (this.timeEstimator) {
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

      const suggestions = await this.facade.suggestNext(precedingText, this.cursorHint, "continue", 3, signal);
      if (signal.aborted) return;

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
        if (this.suggestionStatusText) this.suggestionStatusText.textContent = "无建议";
        this.suggestionContent.empty();

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
      if (signal.aborted) {
        if (this.suggestProgressEmitter) {
          this.suggestProgressEmitter.cancel();
        }
        return;
      }
      log.warn("[CoWritingView] 生成建议失败:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.lastSuggestError = errorMsg;
      this.facade.syncSuggestionsError(errorMsg);

      if (this.suggestProgressEmitter) {
        this.suggestProgressEmitter.fail(this.getFriendlyErrorMessage(errorMsg));
      }
    } finally {
      // v6.3: 仅当本次请求仍是当前 controller 时才清除状态，避免被后续请求的 abort 干扰
      if (this.suggestAbortController?.signal === signal) {
        this.isSuggesting = false;
        this.suggestAbortController = null;
        // BUG-K fix: 恢复建议按钮可用态
        if (this.suggestBtn) {
          this.suggestBtn.disabled = false;
          this.suggestBtn.textContent = "⇥ 建议";
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

  /** 计算人工率各维度评分 */
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

    let style = 75;
    const engine = this.engine;
    if (engine && engine.getPrecisionMode()) {
      style = 75;
    }

    const overall = Math.round(
      style * 0.40 + sentenceLength * 0.20 + opening * 0.15 + punctuation * 0.15 + aiWords * 0.10
    );

    return { overall, style, sentenceLength, opening, punctuation, aiWords };
  }

  /** 将评分渲染到仪表盘容器 */
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
    details.createSpan({ text: `风格 ${scores.style}%` });
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
    this.suggestionContainer.style.display = 'flex';
  }

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
  async handleIterateSuggestion(suggestion: SuggestionRecord) {
    const instruction = await this.promptIterateInstruction();
    if (!instruction)
      return;
    if (this.isSuggesting)
      return;
    this.isSuggesting = true;
    try {
      const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
      const precedingText = this.rightEditor.value.slice(0, cursor);
      const iterated = await this.facade.iterateSuggestion(suggestion, instruction, precedingText, this.cursorHint);
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
      new Notice("\u8FED\u4EE3\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", 2500);
    } finally {
      this.isSuggesting = false;
    }
  }
  // B2: 弹出输入框获取迭代指令
  promptIterateInstruction(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const modal = new IterateInstructionModal(this.app, (value) => resolve(value));
      modal.open();
    });
  }
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
    this.renderSuggestionLoading();
    const selectedText = this.rightEditor.value.slice(start, end);
    const beforeContext = this.rightEditor.value.slice(0, start);
    const afterContext = this.rightEditor.value.slice(end);
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
      const suggestions = await this.facade.rewriteSelection(selectedText, beforeContext, afterContext, this.cursorHint, 3);
      this.currentSuggestions = suggestions;
      this.currentRecord.suggestions = suggestions;
      if (suggestions.length === 0) {
        this.renderEmptySuggestions("\u6CA1\u6709\u751F\u6210\u6539\u5199\u5019\u9009\u3002\u53EF\u4EE5\u8C03\u6574\u9009\u533A\u6216\u4E34\u65F6\u6307\u4EE4\u540E\u91CD\u8BD5\u3002");
        return;
      }
      this.renderSuggestionCards(suggestions);
      this.showKnowledgeInjectionNotice();
    } catch (e) {
      log.warn("[CoWritingView] \u9009\u533A\u6539\u5199\u5931\u8D25:", e);
      this.renderEmptySuggestions("\u9009\u533A\u6539\u5199\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    } finally {
      this.isSuggesting = false;
    }
  }
  handleOutlineExpand() {
    const start = this.rightEditor.selectionStart;
    const end = this.rightEditor.selectionEnd;
    const selectedText = this.rightEditor.value.slice(start, end);
    const allText = this.rightEditor.value;
    const sourceText = selectedText || allText;

    const modal = new OutlineExpandModal(this.app, this.plugin, sourceText, {
      mode: selectedText ? 'paragraph' : 'chapter',
      targetWords: selectedText ? Math.max(500, Math.floor(selectedText.length * 2)) : 3000,
    });
    modal.open();
  }
  async handleAssociationSuggest() {
    if (this.isAssociating || this.isSuggesting)
      return;
    this.isAssociating = true;
    this.renderAssociationLoading();
    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
    try {
      const associations = await this.facade.suggestAssociation(cursor, this.rightEditor.value, "manual");
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
      log.warn("[CoWritingView] \u8054\u60F3\u8F93\u5165\u5931\u8D25:", e);
      this.showSuggestionPanel();
      if (this.suggestionStatusText) this.suggestionStatusText.textContent = "联想失败";
      this.suggestionContent.empty();
      this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-error", text: "\u8054\u60F3\u8F93\u5165\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    } finally {
      this.isAssociating = false;
    }
  }
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
  async acceptByIndex(index: number) {
    const suggestion = this.currentSuggestions[index];
    if (suggestion)
      await this.handleAcceptSuggestion(suggestion);
  }
  async handleAcceptSuggestion(suggestion: SuggestionRecord) {
    await this.insertTextAndRecord(suggestion.text, suggestion, void 0, 0);
  }
  handleEditSuggestion(suggestion: SuggestionRecord, initialText?: string) {
    const startedAt = Date.now();
    const modal = new SuggestionEditModal(
      this.app,
      suggestion,
      initialText || suggestion.text,
      async (modifiedText) => {
        const context = this.getContextBeforeCursor(500);
        this.renderValidationLoading();
        const validation = await this.facade.validateEdit(modifiedText, suggestion, context);
        this.renderValidationResult(validation, modifiedText, suggestion, Date.now() - startedAt);
      }
    );
    modal.open();
  }
  renderValidationResult(validation: EditValidation, modifiedText: string, suggestion: SuggestionRecord, editDurationMs: number) {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = validation.isValid ? "验证通过" : "存在风险";
    this.suggestionContent.empty();
    const panel = this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-validation-panel" });
    const statusClass = validation.isValid ? "is-valid" : "is-warning";
    panel.createDiv({ cls: `novel-writer-cowrite-validation-title ${statusClass}`, text: `${validation.isValid ? "\u2705" : "\u26A0\uFE0F"} ${validation.isValid ? "\u9A8C\u8BC1\u901A\u8FC7" : "\u5B58\u5728\u98CE\u9669"}` });
    const scores = panel.createDiv({ cls: "novel-writer-cowrite-score-grid" });
    scores.appendChild(this.createScoreCard("\u8BBE\u5B9A\u4E00\u81F4\u6027", validation.consistencyScore));
    scores.appendChild(this.createScoreCard("\u6587\u98CE\u5BF9\u9F50", validation.styleScore));
    scores.appendChild(this.createScoreCard("\u5267\u60C5\u5BF9\u9F50", validation.plotAlignmentScore));
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
    useBtn.addEventListener("click", () => this.insertTextAndRecord(modifiedText, suggestion, validation, editDurationMs));
    const editBtn = actions.createEl("button", { text: "\u4FEE\u6539\u540E\u518D\u9A8C\u8BC1", cls: "novel-writer-cowrite-secondary-btn" });
    editBtn.addEventListener("click", () => this.handleEditSuggestion(suggestion, modifiedText));
  }
  async insertTextAndRecord(text: string, suggestion: SuggestionRecord, validation: EditValidation | undefined, editDurationMs: number) {
    const editor = this.rightEditor;
    const selectionStart = editor.selectionStart || editor.value.length;
    const selectionEnd = editor.selectionEnd || selectionStart;
    const before = editor.value.slice(0, selectionStart);
    const after = editor.value.slice(selectionEnd);
    const replacesSelection = selectionEnd > selectionStart;
    const insertText = replacesSelection || text.startsWith("\n") || before.endsWith("\n") || before.length === 0 ? text : `
${text}`;
    editor.value = before + insertText + after;
    const newCursor = selectionStart + insertText.length;
    editor.selectionStart = editor.selectionEnd = newCursor;
    editor.focus();
    const record = {
      ...this.currentRecord || {
        id: `rec_${Date.now()}`,
        triggerText: before.slice(-200),
        cursorPosition: selectionStart,
        suggestions: this.currentSuggestions,
        createdAt: Date.now()
      },
      chosenSuggestionId: suggestion.id,
      humanModifiedText: text,
      validationResult: validation,
      editDurationMs,
      acceptedAt: Date.now()
    };
    this.facade.recordInteraction(record);
    this.facade.syncEditRecord(record);
    this.facade.syncEditorCursor(newCursor);
    this.facade.syncChapterContent(editor.value, editor.value.trim().length);
    this.suggestionHistory.push(record);
    if (this.suggestionHistory.length > 20) this.suggestionHistory.shift();
    await this.historyStore.persistSuggestionHistory();
    this.facade.updateSnapshot(editor.value);
    this.updateControlState("\u7F16\u8F91\u4E2D");
    await this.refreshPreview(true);
    await this.refreshMetrics(false);
    this.liveAnalysis.scheduleRefresh("insert");
    this.currentSuggestions = [];
    this.setGhostSuggestion(null);
    this.currentRecord = null;
    this.renderEmptySuggestions("\u5DF2\u63D2\u5165\u3002\u7EE7\u7EED\u5199\u4F5C\u540E\u6309 Tab \u751F\u6210\u4E0B\u4E00\u8F6E\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u4F1A\u76F4\u63A5\u63A5\u53D7\u7B2C\u4E00\u6761\u3002");
    this.updateHumanRateDashboard();
  }
  async refreshPreview(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastPreviewAt < 500)
      return;
    this.lastPreviewAt = now;
    this.previewContent.empty();
    const content = this.rightEditor?.value?.trim() || '';
    if (!content) {
      this.previewContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u6B63\u6587\u9884\u89C8\u4F1A\u5728\u8FD9\u91CC\u5B9E\u65F6\u540C\u6B65\u3002" });
      return;
    }
    await MarkdownRenderer.renderMarkdown(content, this.previewContent, this.getBodyPath(), this);
    this.applyHighlightsToDOM();
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
  async refreshMetrics(force: boolean) {
    this.updateNextNodeButton();
    const now = Date.now();
    if (!force && now - this.lastMetricsAt < 1e4)
      return;
    if (this.metricsAbortController) {
      this.metricsAbortController.abort();
      this.metricsAbortController = null;
    }
    this.metricsAbortController = new AbortController();
    const signal = this.metricsAbortController.signal;
    this.lastMetricsAt = now;
    this.metricsStatus = 'evaluating';
    const currentMetrics = this.facade.getSession()?.currentMetrics || emptyMetrics();
    this.renderMetrics(currentMetrics);
    this.renderFloatingMetrics();
    try {
      const metrics = await this.facade.evaluatePlotComplete(this.rightEditor.value, signal);
      if (signal.aborted) return;
      const nextDirections = this.facade.adjustDirection(metrics);
      metrics.nextDirectionHints = nextDirections;
      this.metricsStatus = 'idle';
      this.facade.syncPlotCompletion(metrics);
      this.renderMetrics(metrics);
      this.renderFloatingMetrics();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
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
  renderMetricBar(label: string, value: number) {
    const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
    const row = this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-metric-row" });
    row.createSpan({ cls: "novel-writer-cowrite-metric-label", text: label });
    const bar = row.createDiv({ cls: "novel-writer-cowrite-metric-bar" });
    const fill = bar.createDiv({ cls: `novel-writer-cowrite-metric-fill ${safe < 30 ? "low" : safe < 60 ? "mid" : "high"}` });
    fill.style.width = `${safe}%`;
    row.createSpan({ cls: "novel-writer-cowrite-metric-value", text: `${safe}%` });
  }
  createScoreCard(label: string, value: number) {
    const card = createDiv({ cls: "novel-writer-cowrite-score-card" });
    card.createDiv({ cls: "novel-writer-cowrite-score-value", text: `${Math.round(value || 0)}` });
    card.createDiv({ cls: "novel-writer-cowrite-score-label", text: label });
    return card;
  }
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

  private updateSuggestProgressUI(state: ProgressState): void {
    if (!this.suggestEtaDisplay) return;

    if (state.status === 'running' && state.eta !== undefined && state.eta > 0) {
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

    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
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
          this.suggestBtn.textContent = "⇥ 建议";
        }
        this.facade.syncSuggestionsGenerating(false);
      }
    }
  }
  showKnowledgeInjectionNotice() {
    const count = this.facade.lastKnowledgeCount || 0;
    if (count > 0) {
      new Notice(`📚 已注入 ${count} 条知识库片段`);
    }
  }
  renderValidationLoading() {
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "验证中...";
    this.suggestionContent.empty();
    this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u6B63\u5728\u9A8C\u8BC1\u4F60\u7684\u4FEE\u6539\uFF1A\u8BBE\u5B9A\u4E00\u81F4\u6027 / \u6587\u98CE\u5BF9\u9F50 / \u5267\u60C5\u5BF9\u9F50\u2026\u2026" });
  }
  renderEmptySuggestions(message = "\u6309 Tab \u751F\u6210\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u63A5\u53D7\u7B2C\u4E00\u6761\u3002Ctrl+J \u6362\u4E00\u7EC4\uFF0CCtrl+K/Ctrl+Space \u8054\u60F3\uFF0C\u9009\u4E2D\u6587\u672C\u540E Ctrl+Shift+R \u6539\u5199\u3002") {
    this.setGhostSuggestion(null);
    this.showSuggestionPanel();
    if (this.suggestionStatusText) this.suggestionStatusText.textContent = "等待生成";
    this.suggestionContent.empty();
    this.suggestionContent.createDiv({ cls: "novel-writer-cowrite-empty", text: message });
  }

  // ==================== 知识库 Tab 相关方法 ====================

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

  async loadKbBooks() {
    if (!this.facade.knowledgeBaseManager) return;
    try {
      this.kbBooksCache = await this.facade.knowledgeBaseManager.getAllBooks();
      this.renderKbBookList();
    } catch (e) {
      log.warn('[CoWritingView] 加载知识库书籍失败:', e);
    }
  }

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
      this.kbBookListContainer.createDiv({
        cls: "nw-kb-empty",
        text: keyword ? "未找到匹配的书籍" : "暂无书籍，点击上方按钮导入"
      });
      return;
    }

    books.forEach(book => {
      const card = this.createKbBookCard(book);
      this.kbBookListContainer.appendChild(card);
    });
  }

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

  toggleReferenceBook(bookId: string, bookName: string, enable: boolean): void {
    const currentRefs = this.facade.getReferenceBooks();
    if (enable) {
      if (currentRefs.length >= 3) {
        new Notice('最多只能启用 3 本参考书籍', 3000);
        return;
      }
      const newRefs = [...currentRefs, bookId];
      this.facade.setReferenceBooks(newRefs);
      if (this.plugin.referenceBookIds) {
        this.plugin.referenceBookIds = newRefs;
      }
      new Notice(`已启用《${bookName}》作为参考`, 2000);
    } else {
      const newRefs = currentRefs.filter(id => id !== bookId);
      this.facade.setReferenceBooks(newRefs);
      if (this.plugin.referenceBookIds) {
        this.plugin.referenceBookIds = newRefs;
      }
      new Notice(`已停用《${bookName}》的参考`, 2000);
    }
    this.renderKbBookList();
    this.refreshChapterMatch();
    this.refreshWritingAdvice();
  }

  setPrimaryReference(bookId: string): void {
    const currentRefs = this.facade.getReferenceBooks();
    const index = currentRefs.indexOf(bookId);
    if (index <= 0) return;
    
    const newRefs = [bookId, ...currentRefs.filter(id => id !== bookId)];
    this.facade.setReferenceBooks(newRefs);
    if (this.plugin.referenceBookIds) {
      this.plugin.referenceBookIds = newRefs;
    }
    new Notice('已设为主参考书籍', 2000);
    this.renderKbBookList();
    this.refreshWritingAdvice();
  }

  adjustReferenceWeight(bookId: string, weight: number): void {
    log.info('[CoWritingView] 调整参考权重:', bookId, weight);
  }

  getBookTopCharacters(book: BookBasicInfo): string[] {
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
    if (!kb || !book.primaryGenre) return book.themeTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.themeTags.slice(0, 5);
    return genre.personalityTags.slice(0, 5);
  }

  getBookTopTechniques(book: BookBasicInfo): string[] {
    const kb = this.facade.knowledgeBaseManager?.getKnowledgeBase();
    if (!kb || !book.primaryGenre) return book.techniqueTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.techniqueTags.slice(0, 5);
    return genre.techniques.slice(0, 5).map(t => t.name);
  }

  // ========== 子 Tab 2: 当前章节匹配 ==========

  renderKbMatchTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "match" }
    });
    this.kbMatchContainer = tab;
    this.refreshChapterMatch();
  }

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

  renderKbQuoteTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "quote" }
    });
    this.kbQuoteContainer = tab;
    this.refreshQuotePanel();
  }

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

  insertTechniqueExample(tech: { name: string; description: string }) {
    const exampleText = `【${tech.name}】${tech.description}`;
    this.quickInsertText(exampleText);
    new Notice(`已插入：${tech.name}`, 1500);
  }

  quickInsertText(text: string) {
    const editor = this.rightEditor;
    if (!editor) return;
    const start = editor.selectionStart || editor.value.length;
    const end = editor.selectionEnd || start;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const insert = before.endsWith('\n') || before.length === 0 ? text : text;
    editor.value = before + insert + after;
    const newPos = start + insert.length;
    editor.selectionStart = editor.selectionEnd = newPos;
    editor.focus();
    this.facade.updateSnapshot(editor.value);
    this.updateControlState("编辑中");
    void this.refreshPreview(false);
  }

  // ========== 子 Tab 4: 写作建议 ==========

  renderKbAdviceTab() {
    const tab = this.kbSubTabContent.createDiv({
      cls: "nw-kb-subtab-content",
      attr: { "data-subtab": "advice" }
    });
    this.kbAdviceContainer = tab;
    this.refreshWritingAdvice();
  }

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
  scheduleGhostAssociationRefresh() {
    this.setGhostSuggestion(null);
    this.ghostDebounceManager.debounceFixed('ghost-association', () => {
      void this.refreshGhostAssociation();
    }, 1500);
  }
  async refreshGhostAssociation() {
    if (this.isAssociating || this.isSuggesting || this.currentSuggestions.length > 0)
      return;
    const text = this.rightEditor?.value || "";
    const cursor = this.rightEditor?.selectionStart || text.length;
    if (text.trim().length < 40 || cursor < text.length - 3)
      return;
    const seed = text.slice(Math.max(0, cursor - 160), cursor);
    if (!seed.trim() || seed === this.lastGhostSeed)
      return;
    this.lastGhostSeed = seed;
    try {
      this.isAssociating = true;
      const associations = await this.facade.suggestAssociation(cursor, text, "manual");
      if (associations.length === 0 || this.currentSuggestions.length > 0)
        return;
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
      log.warn("[CoWritingView] B1: \u81EA\u52A8\u8054\u60F3\u5931\u8D25:", e);
    } finally {
      this.isAssociating = false;
    }
  }
  refreshStatusBar() {
    if (!this.statusBar)
      return;
    const count = this.rightEditor?.value?.length || 0;
    this.statusBar.empty();
    this.statusBar.createSpan({ text: `\u{1F4CD} ${this.project || "\u672A\u9009\u62E9\u9879\u76EE"} \xB7 ${this.volume} \xB7 ${this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`} \xB7 \u5B57\u6570 ${count}` });
    if (this.wordCountDisplay)
      this.wordCountDisplay.setText(String(count));
    if (this.wordGoalDisplay) {
      const progress = Math.min(100, Math.round(count / 3e3 * 100));
      this.wordGoalDisplay.setText(`\u76EE\u6807: 3000 \xB7 ${progress}%`);
    }
  }
  updateControlState(state: string) {
    this.refreshStatusBar();
    if (this.saveStateDisplay) {
      this.saveStateDisplay.setText(state);
      this.saveStateDisplay.toggleClass("is-dirty", state !== "\u5DF2\u4FDD\u5B58" && state !== "\u5DF2\u52A0\u8F7D");
    }
  }
  applyHint() {
    this.cursorHint = this.hintInput.value.trim();
    this.facade.setCursorHint(this.cursorHint);
    new Notice(this.cursorHint ? `\u5DF2\u5E94\u7528\u4E34\u65F6\u6307\u4EE4\uFF1A${this.cursorHint}` : "\u5DF2\u6E05\u7A7A\u4E34\u65F6\u6307\u4EE4", 2500);
  }
  getContextBeforeCursor(limit: number) {
    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
    return this.rightEditor.value.slice(0, cursor).slice(-limit);
  }
  getBodyPath() {
    // v4.5.1 fix: 必须用 "第N章" 前缀，与 pjBodyFile/findBodyFileV4 规范一致
    // 之前用 chapterName（如"初始之痕"）导致 findBodyFileV4 找不到正文文件
    const chapterPrefix = `第${this.chapterNum}章`;
    return `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}/${chapterPrefix}_\u6B63\u6587.md`;
  }
  getBodyDir() {
    return `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}`;
  }
  getStepResultDirs() {
    // v4.5.1 fix: 步骤结果目录也用 "第N章" 前缀，与 checkChaptersComplete 正则一致
    const chapterPrefix = `第${this.chapterNum}章`;
    return [
      `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B65\u9AA4\u7ED3\u679C/${this.volume}/${chapterPrefix}`,
      `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/${this.volume}/${chapterPrefix}`
    ];
  }
  private getStepFilePath(stepType: string): string {
    // v4.5.1 fix: 用 "第N章" 前缀，与 pjStepDir/pjStepFile 规范一致
    const chapterPrefix = `第${this.chapterNum}章`;
    const stepDir = `${this.project}/${SUBDIR_STEP_ROOT}/${this.volume}/${chapterPrefix}`;
    return `${stepDir}/${stepType}.md`;
  }
  async getChapterTitle(): Promise<string> {
    if (!this.project || !this.volume) return '';
    try {
      const infoPlanPath = this.getStepFilePath('\u4FE1\u606F\u89C4\u5212');
      const infoPlanFile = this.app.vault.getAbstractFileByPath(infoPlanPath);
      if (infoPlanFile instanceof TFile) {
        const content = await this.app.vault.read(infoPlanFile);
        const body = content.replace(/^---[\s\S]*?---\s*/, '');
        const chapterNameMatch = body.match(/##\s*\u7AE0\u540D\s*\n+([^\n#]+)/i);
        if (chapterNameMatch && chapterNameMatch[1].trim()) {
          return chapterNameMatch[1].trim();
        }
      }
      const outlinePath = this.getStepFilePath('\u5927\u7EB2\u6458\u8981');
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
  async saveBody(showNotice: boolean) {
    if (this.isSaving) return;
    const body = this.rightEditor?.value?.trim();
    if (!body || !this.project || !this.volume || !this.chapterNum)
      return;
    this.autoSaveDebouncer.cancel("auto-save");
    this.isSaving = true;
    this.updateControlState("保存中...");
    try {
      const chapterTitle = await this.getChapterTitle();
      const titleLine = chapterTitle
        ? `# 第${this.chapterNum}章 ${chapterTitle}\n\n`
        : `# 第${this.chapterNum}章\n\n`;
      const bodyPath = this.getBodyPath();
      await this.ensureVaultFolder(this.getBodyDir());
      const file = this.app.vault.getAbstractFileByPath(bodyPath);
      // v4.5.1 fix: 保存前备份原 frontmatter，避免 modify 覆盖丢失涉及人物/地点等字段
      let preservedFm: Record<string, any> = {};
      if (file instanceof TFile) {
        try {
          const oldContent = await this.app.vault.read(file);
          const fmMatch = oldContent.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const fmLines = fmMatch[1].split('\n');
            fmLines.forEach(line => {
              const m = line.match(/^([^:]+):\s*(.*)$/);
              if (m) {
                const key = m[1].trim();
                const val = m[2].trim();
                // 解析列表字段
                if (val.startsWith('[') && val.endsWith(']')) {
                  try { preservedFm[key] = JSON.parse(val); } catch { preservedFm[key] = val; }
                } else if (val.startsWith('"') && val.endsWith('"')) {
                  // YAML 双引号包裹的字符串，用 JSON.parse 反序列化
                  try { preservedFm[key] = JSON.parse(val); } catch { preservedFm[key] = val.slice(1, -1); }
                } else if (val.startsWith("'") && val.endsWith("'")) {
                  // YAML 单引号包裹的字符串，直接去除外层引号（YAML 单引号不处理转义）
                  preservedFm[key] = val.slice(1, -1);
                } else {
                  preservedFm[key] = val;
                }
              }
            });
          }
        } catch (e) {
          log.warn("[CoWritingView] 读取原 frontmatter 失败:", e);
        }
        await this.app.vault.modify(file, titleLine + body);
      } else {
        await this.app.vault.create(bodyPath, titleLine + body);
      }
      const savedFile = this.app.vault.getAbstractFileByPath(bodyPath);
      if (savedFile instanceof TFile) {
        await this.app.fileManager.processFrontMatter(savedFile, (fm) => {
          // v4.5.1 fix: 恢复保存前备份的涉及人物/地点/势力/物品功法等字段
          const preserveKeys = ['涉及人物', '涉及地点', '涉及势力', '涉及物品功法', 'chapter', 'volume', 'title', '标题', 'word_count', '涉及伏笔'];
          preserveKeys.forEach(k => {
            if (preservedFm[k] != null && fm[k] == null) {
              fm[k] = preservedFm[k];
            }
          });
          const currentStatus = fm["status"];
          if (!currentStatus || currentStatus === "pending" || currentStatus === "") {
            fm["status"] = "draft";
          }
          fm["tags"] = Array.isArray(fm["tags"]) ? Array.from(new Set([...fm["tags"], "正文"])) : ["正文"];
          fm["卷"] = this.volume;
          fm["章"] = this.chapterName || `第${this.chapterNum}章`;
          fm["writing_mode"] = "co-writer";
          // BUG-J fix: 计算 word_count（正文 body 字符数，去除 # 第X章 标题行）
          const bodyText = body.replace(/^#\s+第\d+章[^\n]*\n+/, '').trim();
          fm["word_count"] = bodyText.length;
        });
      }
      this.updateControlState("\u5DF2\u4FDD\u5B58");
      this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics());
      this.liveAnalysis.scheduleRefresh("save");
      // P1-4: 保存后检查是否需要结算
      this.checkSettlementDue();
      if (showNotice)
        new Notice("\u2705 \u6B63\u6587\u5DF2\u4FDD\u5B58", 3e3);
    } catch (e) {
      log.warn("[CoWritingView] 保存失败:", e);
      if (showNotice)
        new Notice("⚠️ 保存失败，请检查章节路径或文件权限", 4e3);
    } finally {
      this.isSaving = false;
    }
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
  async markAsWritten() {
    if (!this.project || !this.volume || !this.chapterNum) return;
    try {
      await this.saveBody(false);
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
  async handleComplete() {
    await this.saveBody(true);
    await this.refreshMetrics(true);
    new ChapterSettlementModal(this.app, this.plugin, {
      project: this.project,
      volume: this.volume,
      chapterNum: this.chapterNum,
      chapterName: this.chapterName || `\u7B2C${this.chapterNum}\u7AE0`
    }).open();
  }

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

  /** 获取当前光标在章节中的相对位置 (0-1) */
  getCursorRelativePosition(): number {
    const editor = this.rightEditor;
    if (!editor || !editor.value) return 0;
    const cursor = editor.selectionStart || 0;
    const total = editor.value.length || 1;
    return Math.min(1, Math.max(0, cursor / total));
  }

  /** 获取光标前的文本（用于上下文检索） */
  getPrecedingText(maxLen: number = 500): string {
    const editor = this.rightEditor;
    if (!editor) return '';
    const cursor = editor.selectionStart || 0;
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
  /** v6.4: 将指标渲染到指定容器 */
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

  /** v6.4: AI 修复质量问题 */
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

    new Notice(`\uD83D\uDD27 \u6B63\u5728\u4FEE\u590D: ${issue.problem.slice(0, 30)}...`, 0);

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

      const response = await this.facade.aiEngine.callAI('', prompt, void 0, 0.3, 500);
      const fixedText = response?.content || '';

      if (fixedText && targetStart >= 0 && targetEnd > targetStart) {
        const newText = fullText.slice(0, targetStart) + fixedText + fullText.slice(targetEnd);
        this.rightEditor.value = newText;
        this.facade.updateSnapshot(newText);
        this.refreshPreview(true);
        new Notice("\u2705 \u4FEE\u590D\u5B8C\u6210", 2000);
      } else if (fixedText) {
        this.rightEditor.value = fullText + '\n\n\u3010AI\u4FEE\u590D\u5EFA\u8BAE\u3011\n' + fixedText;
        new Notice("\u26A0\uFE0F \u672A\u5B9A\u4F4D\u5230\u7CBE\u786E\u4F4D\u7F6E\uFF0C\u5EFA\u8BAE\u5DF2\u8FFD\u52A0\u5728\u672B\u5C3E", 3000);
      }
    } catch (e) {
      log.warn('[CoWritingView] AI\u4FEE\u590D\u5931\u8D25:', e);
      new Notice("\u274C AI \u4FEE\u590D\u5931\u8D25", 2000);
    }
  }

  // ---- 基础 UI 方法 ----

  async renderAllPanels() {
    const jobs: Array<() => Promise<void> | void> = [
      () => this.refreshPreview(true),
      () => this.renderMetrics(this.facade.getSession()?.currentMetrics || emptyMetrics()),
      () => this.refreshMetrics(false),
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

  handleOpenHistory() {
    const records = this.engine?.getHistory?.() || this.engine?.getSession()?.interactions || [];
    new HistoryModal(this.app, records.slice(-20).reverse(), (text: string) => {
      if (!this.rightEditor) return;
      const start = this.rightEditor.selectionStart ?? this.rightEditor.value.length;
      const end = this.rightEditor.selectionEnd ?? start;
      this.rightEditor.value = this.rightEditor.value.slice(0, start) + text + this.rightEditor.value.slice(end);
      const next = start + text.length;
      this.rightEditor.focus();
      this.rightEditor.setSelectionRange(next, next);
      this.updateControlState("编辑中");
      this.facade.updateSnapshot(this.rightEditor.value);
      void this.refreshPreview(true);
    }).open();
  }
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
      const chapterKey = this.project ? `${this.project}-${this.chapterName}` : '';
      panelB.updateCompletion(text, chapterKey);
    } catch (e) {
      log.warn('[CoWritingView] 更新剧情完成度失败:', e);
    }
  }

  private renderMonitorPanel() {
    this.monitorContainer.empty();

    this.renderForeshadowCard();
    this.renderEntityCard();
    this.renderGuardCard();
    this.renderStatusCard();
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

    const abstractFile = this.app.vault.getAbstractFileByPath(`${this.project}/${this.volume}/${this.chapterName}_正文.md`);
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
      chars.slice(0, 5).forEach((charName: string) => {
        const charFile = this.app.vault.getFiles().find(f =>
          f.path.includes('人物设定') && f.name.includes(charName)
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

    const issues = (this.liveAnalysis as unknown as { issues?: any[] })?.issues || [];
    const highCount = issues.filter((i: any) => i.priority === 'high').length;
    const midCount = issues.filter((i: any) => i.priority === 'medium').length;
    const lowCount = issues.filter((i: any) => i.priority === 'low').length;

    body.createDiv({ cls: "nw-cowrite-monitor-summary", text: `高 ${highCount} · 中 ${midCount} · 低 ${lowCount}` });

    const detail = body.createDiv({ cls: "nw-cowrite-monitor-detail" });
    detail.setCssStyles({ display: 'none' });

    if (issues.length > 0) {
      const ul = detail.createEl("ul", { cls: "nw-cowrite-monitor-list" });
      issues.slice(0, 5).forEach((issue: any) => {
        const priorityColor = issue.priority === 'high' ? '#ef4444' : issue.priority === 'medium' ? '#f59e0b' : '#3b82f6';
        const li = ul.createEl("li");
        const prioritySpan = li.createSpan({ cls: "nw-cowrite-monitor-priority", text: issue.priority.toUpperCase() });
        prioritySpan.setCssStyles({ color: priorityColor });
        li.createSpan({ text: ` ${issue.message || issue}` });
      });
      if (issues.length > 5) ul.createEl("li", { cls: "nw-cowrite-monitor-more", text: `...还有 ${issues.length - 5} 条` });
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
    const totalChars = text.length;
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
