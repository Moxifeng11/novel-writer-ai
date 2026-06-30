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
import { CoWriterEngine } from '../engine/co-writer-engine';
import { EmotionCurveAnalyzer } from '../engine/emotion-curve-analyzer';
import { RhythmAnalyzer } from '../engine/rhythm-analyzer';
import { EndingTractionEngine } from '../engine/ending-traction-engine';
import { EmotionCurveView } from './components/emotion-curve-view';
import { ChapterSettlementModal } from './chapter-settlement-modal';
import { SuggestionEditModal } from './cowrite/suggestion-edit-modal';
import { IterateInstructionModal } from './cowrite/iterate-instruction-modal';
import { HistoryModal } from './cowrite/history-modal';
import { MemoryManagerModal } from './cowrite/memory-manager-modal';
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
import {
    SuggestionRecord,
    SuggestionDirection,
    EditValidation,
    PlotCompletionMetrics,
    SentenceEditRecord
} from '../shared/types';
import { AssociationSuggestion } from '../shared/co-writer-types';

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
  mainContainer!: HTMLElement;
  previewContent!: HTMLElement;
  rightEditor!: HTMLTextAreaElement;
  hintInput!: HTMLInputElement;
  suggestionContainer!: HTMLElement;
  ghostSuggestionContainer!: HTMLElement;
  metricsContainer!: HTMLElement;
  statusBar!: HTMLElement;
  wordCountDisplay!: HTMLElement;
  wordGoalDisplay!: HTMLElement;
  saveStateDisplay!: HTMLElement;
  flowContainer!: HTMLElement;
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
  lastGhostSeed = "";
  liveAnalysis!: LiveAnalysisController;
  historyStore!: SuggestionHistoryStore;
  private suggestAbortController: AbortController | null = null;  // v6.3: 防重复请求
  private suggestBtn: HTMLButtonElement | null = null;  // BUG-K fix: 建议按钮引用，用于禁用态
  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.engine = plugin.coWriterEngine;
    this.liveAnalysis = new LiveAnalysisController(this);
    this.historyStore = new SuggestionHistoryStore(this);
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
    this.renderMetrics(this.engine.getSession()?.currentMetrics || emptyMetrics());
    if (this.project && this.chapterName) {
      await this.openChapter(this.project, this.chapterName, this.volume, this.chapterNum);
      await this.historyStore.loadSuggestionHistory();
    }
    if (!this.plugin.settings.coWriteModel) {
      new Notice('⚠️ 协同写作未配置本地模型，请在设置中配置「协同写作本地模型」', 8000);
    }
  }
  async onClose() {
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    this.ghostDebounceManager.dispose();
    if (this.liveAnalysis && typeof this.liveAnalysis.clearTimers === 'function') {
      this.liveAnalysis.clearTimers();
    }
    await this.saveBody(false);
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
    try {
      const bodyPath = this.getBodyPath();
      const file = this.app.vault.getAbstractFileByPath(bodyPath);
      if (file instanceof TFile) {
        const fullContent = await this.app.vault.read(file);
        let bodyOnly = fullContent.replace(/^---[\s\S]*?---\s*/, '');
        bodyOnly = bodyOnly.replace(/^#\s+第\d+章[^\n]*\n+/, '');
        bodyOnly = bodyOnly.replace(/<!--\s*正文区域.*?-->\s*/g, '');
        this.rightEditor.value = bodyOnly;
      }
    } catch (e) {
      console.warn("[CoWritingView] \u8BFB\u53D6\u5DF2\u6709\u6B63\u6587\u5931\u8D25:", e);
    }
    this.updateControlState("\u5DF2\u52A0\u8F7D");
    this.refreshStatusBar();
    await this.renderWritingFlowPanel();
    await this.historyStore.loadSuggestionHistory();
    await this.refreshPreview(true);
    try {
      await this.engine.init(project, chapterName2, volume2, chapterNum);
      this.engine.updateSnapshot(this.rightEditor.value);
      this.emotionCurveAnalyzer = new EmotionCurveAnalyzer({
        app: this.app,
        aiEngine: this.plugin.aiEngine,
        plugin: this.plugin
      });
      this.rhythmAnalyzer = new RhythmAnalyzer({
        app: this.app,
        aiEngine: this.plugin.aiEngine,
        plugin: this.plugin
      });
      this.tractionEngine = new EndingTractionEngine({
        app: this.app,
        aiEngine: this.plugin.aiEngine,
        plugin: this.plugin
      });
      await this.tractionEngine.initialize(project);
      await this.renderAllPanels();
    } catch (e) {
      console.warn("[CoWritingView] \u4E0A\u4E0B\u6587\u521D\u59CB\u5316\u5931\u8D25:", e);
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
      console.warn(`[CoWritingView] 前置规划检查 — 缺失: ${missing.join(', ')}`);
    }
  }

  renderLayout() {
    this.mainContainer = this.contentEl.createDiv({ cls: "nw-cowrite-root" });
    const header = this.mainContainer.createDiv({ cls: "nw-cowrite-header" });
    const titleDiv = header.createDiv({ cls: "nw-cowrite-title" });
    titleDiv.createSpan({ cls: "nw-cowrite-title-icon", text: "\u{1F4DD}" });
    titleDiv.createSpan({ text: "\u534F\u540C\u5199\u4F5C" });
    this.statusBar = header.createDiv({ cls: "nw-cowrite-status", text: "加载中..." });
    const monBtn = header.createEl("button", { text: "\u{1F4CA} \u76D1\u63A7", cls: "nw-float-monitor-toggle" });
    monBtn.addEventListener("click", () => { this.toggleFloatingPanel(); });

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

    // 中央：编辑器 + 建议
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
    // 右侧：精简卡片 + 控制台
    const rightPanel = mainArea.createDiv({ cls: "nw-cowrite-right" });
    const cardsArea = rightPanel.createDiv({ cls: "nw-cowrite-cards" });
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

    // v6.5: 建议卡片移到右侧面板，不遮挡编辑器
    this.suggestionContainer = rightPanel.createDiv({ cls: "nw-cowrite-suggestions-panel" });

    // 写作控制台（紧凑模式）
    const controlPanel = rightPanel.createDiv({ cls: "nw-cowrite-control-panel" });
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
      { text: "\u21E5 建议", cls: "nw-btn-primary", action: () => this.handleTabSuggest(true) },
      { text: "✨ 联想", cls: "nw-btn-ghost", action: () => this.handleAssociationSuggest() },
      { text: "🕘 历史", cls: "nw-btn-ghost", action: () => this.handleOpenHistory() },
      { text: "🧠 记忆", cls: "nw-btn-ghost", action: () => this.handleOpenMemoryManager() },
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
    }

    this.flowContainer = controlPanel.createDiv({ cls: "nw-cowrite-flow-panel" });
    this.renderWritingFlowPanel();
    this.warningContainer = controlPanel.createDiv({ cls: "nw-warnings" });
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
      this.engine.updateSnapshot(this.rightEditor.value);
      this.updateControlState("\u7F16\u8F91\u4E2D");
      void this.refreshPreview(false);
      this.liveAnalysis.scheduleRefresh("input");
      this.scheduleGhostAssociationRefresh();
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
    if (this.isSuggesting) {
      // 旧请求刚被 abort，isSuggesting 会在其 finally 块自行清除；此处不阻塞新请求
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;

    this.lastSuggestAt = now;
    this.isSuggesting = true;
    // BUG-K fix: 生成期间禁用建议按钮，给出视觉反馈
    if (this.suggestBtn) {
      this.suggestBtn.disabled = true;
      this.suggestBtn.textContent = "⏳ 生成中...";
    }
    this.renderSuggestionLoading();
    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
    const precedingText = this.rightEditor.value.slice(0, cursor);
    this.currentRecord = {
      id: `rec_${Date.now()}`,
      triggerText: precedingText.slice(-200),
      cursorPosition: cursor,
      suggestions: [],
      humanModifiedText: "",
      editDurationMs: 0,
      createdAt: Date.now()
    };
    try {
      if (signal.aborted) return;
      const suggestions = await this.engine.suggestNext(precedingText, this.cursorHint, "continue", 3, signal);
      if (signal.aborted) return;
      this.currentSuggestions = suggestions;
      this.currentRecord.suggestions = suggestions;
      if (suggestions.length === 0) {
        this.suggestionContainer.empty();
        this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u8FD9\u6B21\u6CA1\u6709\u62FF\u5230\u5EFA\u8BAE\u3002\u53EF\u4EE5\u6362\u4E00\u6279\uFF0C\u6216\u8005\u68C0\u67E5 API \u914D\u7F6E\u3002" });
        return;
      }
      this.renderSuggestionCards(suggestions);
    } catch (e) {
      if (signal.aborted) return;
      console.warn("[CoWritingView] \u751F\u6210\u5EFA\u8BAE\u5931\u8D25:", e);
      this.showSuggestionPanel();
      this.suggestionContainer.empty();
      this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-error", text: "\u751F\u6210\u5EFA\u8BAE\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
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
  private showSuggestionPanel() {
    this.suggestionContainer.style.display = 'flex';
  }

  renderSuggestionCards(suggestions: SuggestionRecord[]) {
    this.setGhostSuggestion(null);
    this.showSuggestionPanel();
    this.suggestionContainer.empty();
    const closeBtn = this.suggestionContainer.createEl("button", { text: "\u2715", cls: "nw-cowrite-suggestions-close" });
    closeBtn.addEventListener("click", () => {
      this.suggestionContainer.style.display = 'none';
    });
    const row = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-card-row" });
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
      const iterated = await this.engine.iterateSuggestion(suggestion, instruction, precedingText, this.cursorHint);
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
    } catch (e) {
      console.warn("[CoWritingView] B2: \u8FED\u4EE3\u5931\u8D25:", e);
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
      const suggestions = await this.engine.rewriteSelection(selectedText, beforeContext, afterContext, this.cursorHint, 3);
      this.currentSuggestions = suggestions;
      this.currentRecord.suggestions = suggestions;
      if (suggestions.length === 0) {
        this.renderEmptySuggestions("\u6CA1\u6709\u751F\u6210\u6539\u5199\u5019\u9009\u3002\u53EF\u4EE5\u8C03\u6574\u9009\u533A\u6216\u4E34\u65F6\u6307\u4EE4\u540E\u91CD\u8BD5\u3002");
        return;
      }
      this.renderSuggestionCards(suggestions);
    } catch (e) {
      console.warn("[CoWritingView] \u9009\u533A\u6539\u5199\u5931\u8D25:", e);
      this.renderEmptySuggestions("\u9009\u533A\u6539\u5199\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    } finally {
      this.isSuggesting = false;
    }
  }
  async handleAssociationSuggest() {
    if (this.isAssociating || this.isSuggesting)
      return;
    this.isAssociating = true;
    this.renderAssociationLoading();
    const cursor = this.rightEditor.selectionStart || this.rightEditor.value.length;
    try {
      const associations = await this.engine.suggestAssociation(cursor, this.rightEditor.value, "manual");
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
      console.warn("[CoWritingView] \u8054\u60F3\u8F93\u5165\u5931\u8D25:", e);
      this.showSuggestionPanel();
      this.suggestionContainer.empty();
      this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-error", text: "\u8054\u60F3\u8F93\u5165\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    } finally {
      this.isAssociating = false;
    }
  }
  renderAssociationCards(associations: AssociationSuggestion[], suggestions: SuggestionRecord[]) {
    this.showSuggestionPanel();
    this.suggestionContainer.empty();
    const header = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-association-header" });
    header.createSpan({ text: "\u2728 \u8054\u60F3\u8F93\u5165" });
    header.createSpan({ cls: "novel-writer-cowrite-association-tip", text: "Ctrl+1/2/3 \u63D2\u5165\uFF0CCtrl+Space \u6362\u4E00\u7EC4" });
    const row = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-card-row" });
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
    this.suggestionContainer.empty();
    const header = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-association-header" });
    header.createSpan({ text: "\u2728 \u6B63\u5728\u8054\u60F3\u4E0B\u4E00\u53E5\u2026\u2026" });
    const row = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-card-row" });
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
        const validation = await this.engine.validateEdit(modifiedText, suggestion, context);
        this.renderValidationResult(validation, modifiedText, suggestion, Date.now() - startedAt);
      }
    );
    modal.open();
  }
  renderValidationResult(validation: EditValidation, modifiedText: string, suggestion: SuggestionRecord, editDurationMs: number) {
    this.showSuggestionPanel();
    this.suggestionContainer.empty();
    const panel = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-validation-panel" });
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
    this.engine.recordInteraction(record);
    this.suggestionHistory.push(record);
    if (this.suggestionHistory.length > 20) this.suggestionHistory.shift();
    await this.historyStore.persistSuggestionHistory();
    this.engine.updateSnapshot(editor.value);
    this.updateControlState("\u7F16\u8F91\u4E2D");
    await this.refreshPreview(true);
    await this.refreshMetrics(false);
    this.liveAnalysis.scheduleRefresh("insert");
    this.currentSuggestions = [];
    this.setGhostSuggestion(null);
    this.currentRecord = null;
    this.renderEmptySuggestions("\u5DF2\u63D2\u5165\u3002\u7EE7\u7EED\u5199\u4F5C\u540E\u6309 Tab \u751F\u6210\u4E0B\u4E00\u8F6E\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u4F1A\u76F4\u63A5\u63A5\u53D7\u7B2C\u4E00\u6761\u3002");
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
    const now = Date.now();
    if (!force && now - this.lastMetricsAt < 1e4)
      return;
    this.lastMetricsAt = now;
    try {
      const metrics = await this.engine.evaluatePlotComplete(this.rightEditor.value);
      const nextDirections = this.engine.adjustDirection(metrics);
      metrics.nextDirectionHints = nextDirections;
      this.renderMetrics(metrics);
    } catch (e) {
      console.warn("[CoWritingView] \u5B8C\u6210\u5EA6\u5237\u65B0\u5931\u8D25:", e);
    }
  }
  renderMetrics(metrics: PlotCompletionMetrics) {
    this.metricsContainer.empty();
    this.metricsContainer.createEl("h4", { text: "\u{1F4CA} \u5267\u60C5\u5B8C\u6210\u5EA6", cls: "nw-cowrite-metrics-title" });
    const rows: Array<[string, number]> = [
      ["\u573A\u666F\u76EE\u6807", metrics.sceneObjectivesMet],
      ["\u4EBA\u7269\u5F27", metrics.characterArcsAdvanced],
      ["\u4F0F\u7B14\u57CB\u8BBE", metrics.foreshadowingSeeded],
      ["\u60C5\u7EEA\u5F27", metrics.emotionalArcProgress],
    ];
    // v6.0: 前4项用 2x2 grid 布局，节省高度
    const grid = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-grid" });
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
    // 综合完成度单独一行，加大显示
    const overall = this.metricsContainer.createDiv({ cls: "nw-cowrite-metrics-overall" });
    const overallHead = overall.createDiv({ cls: "nw-cowrite-metrics-head" });
    overallHead.createSpan({ cls: "nw-cowrite-metrics-label", text: "\u7EFC\u5408\u5B8C\u6210\u5EA6" });
    const overallSafe = Math.max(0, Math.min(100, Math.round(metrics.overallCompletion || 0)));
    overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value", text: `${overallSafe}%` });
    const overallBar = overall.createDiv({ cls: "nw-progress nw-cowrite-metrics-bar" });
    const overallFill = overallBar.createDiv({ cls: `nw-progress-fill ${overallSafe < 30 ? "low" : overallSafe < 60 ? "mid" : "high"}` });
    overallFill.style.width = `${overallSafe}%`;
    if (metrics.suggestionAdvice) {
      this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-advice", text: `\u{1F4A1} ${metrics.suggestionAdvice}` });
    }
    if (metrics.nextDirectionHints?.length) {
      const labels = metrics.nextDirectionHints.map((d: SuggestionDirection) => getDirectionLabel(d)).join(" \u2192 ");
      this.metricsContainer.createDiv({ cls: "novel-writer-cowrite-next-directions", text: `\u4E0B\u4E00\u8F6E\u65B9\u5411\uFF1A${labels}` });
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
    this.suggestionContainer.empty();
    const row = this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-card-row" });
    for (let i = 0; i < 3; i++) {
      const card = row.createDiv({ cls: "novel-writer-cowrite-skeleton-card" });
      card.createDiv();
      card.createDiv();
      card.createDiv();
    }
  }
  renderValidationLoading() {
    this.showSuggestionPanel();
    this.suggestionContainer.empty();
    this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u6B63\u5728\u9A8C\u8BC1\u4F60\u7684\u4FEE\u6539\uFF1A\u8BBE\u5B9A\u4E00\u81F4\u6027 / \u6587\u98CE\u5BF9\u9F50 / \u5267\u60C5\u5BF9\u9F50\u2026\u2026" });
  }
  renderEmptySuggestions(message = "\u6309 Tab \u751F\u6210\u4E3B\u5EFA\u8BAE\uFF1B\u6709\u5EFA\u8BAE\u65F6 Tab \u63A5\u53D7\u7B2C\u4E00\u6761\u3002Ctrl+J \u6362\u4E00\u7EC4\uFF0CCtrl+K/Ctrl+Space \u8054\u60F3\uFF0C\u9009\u4E2D\u6587\u672C\u540E Ctrl+Shift+R \u6539\u5199\u3002") {
    this.setGhostSuggestion(null);
    this.showSuggestionPanel();
    this.suggestionContainer.empty();
    this.suggestionContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: message });
  }
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
      const associations = await this.engine.suggestAssociation(cursor, text, "manual");
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
      console.warn("[CoWritingView] B1: \u81EA\u52A8\u8054\u60F3\u5931\u8D25:", e);
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
    this.engine.setCursorHint(this.cursorHint);
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
      console.warn('[CoWritingView] 提取章节标题失败:', e);
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
    try {
      const body = this.rightEditor?.value?.trim();
      if (!body || !this.project || !this.volume || !this.chapterNum)
        return;
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
                } else {
                  preservedFm[key] = val;
                }
              }
            });
          }
        } catch (e) {
          console.warn("[CoWritingView] 读取原 frontmatter 失败:", e);
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
      await this.renderWritingFlowPanel();
      this.liveAnalysis.scheduleRefresh("save");
      // P1-4: 保存后检查是否需要结算
      this.checkSettlementDue();
      if (showNotice)
        new Notice("\u2705 \u6B63\u6587\u5DF2\u4FDD\u5B58", 3e3);
    } catch (e) {
      console.warn("[CoWritingView] \u4FDD\u5B58\u5931\u8D25:", e);
      if (showNotice)
        new Notice("\u26A0\uFE0F \u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7AE0\u8282\u8DEF\u5F84\u6216\u6587\u4EF6\u6743\u9650", 4e3);
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
        await this.renderWritingFlowPanel();
        this.checkSettlementDue();
      }
    } catch (e) {
      console.warn("[CoWritingView] 标记完稿失败:", e);
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

  /** v6.0: 打开质量检查 — 先保存正文，跳转全写作视图并定位到质量控制步骤（index=8） */
  async handleOpenQualityCheck() {
    await this.saveBody(true);
    await this.plugin.openFullWriterView?.();
    setTimeout(() => {
      const leaves = this.app.workspace.getLeavesOfType('novel-writer-full-writer');
      if (leaves.length > 0) {
        const view = leaves[0].view as any;
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
    container.createEl("h4", { text: "\u{1F4CA} \u5267\u60C5\u5B8C\u6210\u5EA6", cls: "nw-cowrite-metrics-title" });
    const grid = container.createDiv({ cls: "nw-cowrite-metrics-grid" });
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
    overallHead.createSpan({ cls: "nw-cowrite-metrics-value nw-cowrite-metrics-overall-value", text: `${metrics.overallCompletion}%` });
    const overallBar = overall.createDiv({ cls: "nw-cowrite-metrics-bar" });
    overallBar.style.cssText = `width:100%;height:6px;background:var(--background-modifier-border);border-radius:3px;margin-top:4px;`;
    overallBar.createDiv({ cls: "nw-progress-fill", attr: { style: `width:${metrics.overallCompletion}%;height:100%;` } });
    if (metrics.suggestionAdvice) {
      container.createDiv({ cls: "novel-writer-cowrite-advice", text: `\u{1F4A1} ${metrics.suggestionAdvice}` });
    }
    if (metrics.nextDirectionHints?.length) {
      const labels = metrics.nextDirectionHints.join('、');
      container.createDiv({ cls: "novel-writer-cowrite-next-directions", text: `\u4E0B\u4E00\u8F6E\u65B9\u5411\uFF1A${labels}` });
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
      console.warn('[CoWritingView] \u52A0\u8F7D\u8D28\u91CF\u63A7\u5236\u62A5\u544A\u5931\u8D25:', e);
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

      const response = await this.plugin.aiEngine.callAI('', prompt, void 0, 0.3, 500);
      const fixedText = response?.content || '';

      if (fixedText && targetStart >= 0 && targetEnd > targetStart) {
        const newText = fullText.slice(0, targetStart) + fixedText + fullText.slice(targetEnd);
        this.rightEditor.value = newText;
        this.engine.updateSnapshot(newText);
        this.refreshPreview(true);
        new Notice("\u2705 \u4FEE\u590D\u5B8C\u6210", 2000);
      } else if (fixedText) {
        this.rightEditor.value = fullText + '\n\n\u3010AI\u4FEE\u590D\u5EFA\u8BAE\u3011\n' + fixedText;
        new Notice("\u26A0\uFE0F \u672A\u5B9A\u4F4D\u5230\u7CBE\u786E\u4F4D\u7F6E\uFF0C\u5EFA\u8BAE\u5DF2\u8FFD\u52A0\u5728\u672B\u5C3E", 3000);
      }
    } catch (e) {
      console.warn('[CoWritingView] AI\u4FEE\u590D\u5931\u8D25:', e);
      new Notice("\u274C AI \u4FEE\u590D\u5931\u8D25", 2000);
    }
  }

  // ---- 基础 UI 方法 ----

  async renderWritingFlowPanel() {
    if (!this.flowContainer) return;
    this.flowContainer.empty();
    const session = this.engine?.getSession();
    const metrics = session?.currentMetrics || emptyMetrics();
    const title = this.flowContainer.createDiv({ cls: "nw-cowrite-flow-title" });
    title.createSpan({ text: "剧情流程" });
    const meta = this.flowContainer.createDiv({ cls: "nw-cowrite-flow-meta" });
    meta.createDiv({ text: `项目：${this.project || session?.project || "未绑定"}` });
    meta.createDiv({ text: `章节：${this.volume || session?.volume || "-"} / ${this.chapterName || session?.chapterName || "未绑定章节"}` });
    const editorText = this.rightEditor?.value || "";
    const target = this.plugin.settings.defaultWordCount || 3000;
    meta.createDiv({ text: `字数：${editorText.length} / ${target}` });
    meta.createDiv({ text: `保存：${this.saveStateDisplay?.textContent || "未知"}` });
    const progress = this.flowContainer.createDiv({ cls: "nw-cowrite-flow-progress" });
    const progressHead = progress.createDiv({ cls: "nw-cowrite-metrics-head" });
    progressHead.createSpan({ cls: "nw-cowrite-metrics-label", text: "综合完成度" });
    progressHead.createSpan({ cls: "nw-cowrite-metrics-value", text: `${metrics.overallCompletion || 0}%` });
    const bar = progress.createDiv({ cls: "nw-cowrite-metrics-bar" });
    bar.style.cssText = "width:100%;height:6px;background:var(--background-modifier-border);border-radius:3px;margin-top:4px;";
    bar.createDiv({ cls: "nw-progress-fill", attr: { style: `width:${Math.max(0, Math.min(100, metrics.overallCompletion || 0))}%;height:100%;` } });
    const hints = metrics.nextDirectionHints?.length ? metrics.nextDirectionHints.map(getDirectionLabel).join("、") : "暂无方向提示";
    this.flowContainer.createDiv({ cls: "nw-cowrite-flow-hints", text: `下一轮：${hints}` });
    if (metrics.suggestionAdvice) {
      this.flowContainer.createDiv({ cls: "novel-writer-cowrite-advice", text: metrics.suggestionAdvice });
    }
  }
  async renderAllPanels() {
    const jobs: Array<() => Promise<void> | void> = [
      () => this.refreshPreview(true),
      () => this.renderWritingFlowPanel(),
      () => this.refreshMetrics(false),
      () => {
        if (this.suggestionContainer && !this.suggestionContainer.children.length) this.renderEmptySuggestions();
      },
      () => {
        if (this.floatingPanel?.style.display === 'flex') {
          this.renderFloatingMetrics();
          this.renderFloatingQuality();
        }
      }
    ];
    for (const job of jobs) {
      try { await job(); } catch (e) { console.warn('[CoWritingView] 面板刷新失败:', e); }
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
      this.engine.updateSnapshot(this.rightEditor.value);
      void this.refreshPreview(true);
      void this.renderWritingFlowPanel();
    }).open();
  }
  handleOpenMemoryManager() {
    const snapshot = this.engine?.getMemorySnapshot?.() || { styleGuide: '', stylePatterns: [], preferencePrompt: '', preferences: [] };
    new MemoryManagerModal(this.app, snapshot, async (category: any, key: string, value: string) => {
      await this.engine.addExplicitPreference(category, key, value);
      new Notice('偏好记忆已写入', 2000);
    }).open();
  }
}
