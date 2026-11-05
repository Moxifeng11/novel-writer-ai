/**
 * co-write-floating-panel.ts — V2 Phase 3 协同写作浮窗
 *
 * 基于 DraggablePanel 的浮动窗口版本，提供三栏布局（编辑器+建议+控制台）。
 * 与 Tab 版 CoWritingView 共享同一个 CoWriterEngine 实例（由 plugin 管理）。
 *
 * 注册类型：nw-float-cowrite
 */
import { WorkspaceLeaf, Notice, TFile } from "obsidian";
import NovelWriterPlugin from "@/main";
import { DraggablePanel } from "./draggable-panel";
import { CoWriterEngine } from "@/engine/co-writer-engine";
import { SuggestionRecord, SentenceEditRecord } from "@/shared/types";
import { AssociationSuggestion } from "@/shared/co-writer-types";
import { associationToSuggestion, getDirectionLabel, getStyleLabel } from "./cowrite/cowrite-mappers";
import { CharacterConsistencyChecker, ConsistencyCheckResult } from "@/engine/character-consistency-checker";
import { toCharacterContextInfos } from "@/engine/character-context";
import { ProgressEmitter, type ProgressState } from "@/shared/progress-emitter";
import { StepListComponent } from "./components/progress/step-list";
import { showErrorNotice, showSuccessNotice, showWarningNotice } from "./components/notice-helpers";
import { TimeEstimator } from "@/shared/time-estimator";
import { createLogger } from '@/shared/logger';
import { resolveCursorPosition } from '@/shared/cursor-position';
import { BodyWriter } from '@/engine/body-writer';
import { findBodyFileV4 } from '@/engine/chapter-utils';
import { pjBodyFile } from '@/shared/paths';
import { volumeNumber } from '@/shared/chapter-target';
import { isImeComposing } from '@/shared/keyboard';


const log = createLogger('CoWriteFloatingPanel');
/**
 * 浮动协同面板视图类型。
 */
export const VIEW_TYPE_FLOAT_COWRITE = "nw-float-cowrite";

/**
 * 浮动协同面板。
 */
export class CoWriteFloatingPanel extends DraggablePanel {
  // === DOM 容器 ===
  private rightEditor!: HTMLTextAreaElement;
  private hintInput!: HTMLInputElement;
  private suggestionContainer!: HTMLElement;
  private ghostSuggestionContainer!: HTMLElement;
  private metricsContainer!: HTMLElement;
  private wordCountDisplay!: HTMLElement;
  private wordGoalDisplay!: HTMLElement;
  private saveStateDisplay!: HTMLElement;
  private statusBar!: HTMLElement;
  private tractionContainer!: HTMLElement;
  private flowContainer!: HTMLElement;
  private logicCheckContainer!: HTMLElement;

  // === 状态 ===
  private engine: CoWriterEngine;
  project = "";
  chapterName = "";
  chapterNum = 1;
  volume = "\u7B2C1\u5377";
  isSuggesting = false;
  currentSuggestions: SuggestionRecord[] = [];
  ghostSuggestion: SuggestionRecord | null = null;
  suggestionHistory: SentenceEditRecord[] = [];
  pendingRewriteRange: { start: number; end: number } | null = null;

  // v7.3: 进度增强相关
  private suggestAbortController: AbortController | null = null;
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
  /** 用户通过「临时指令」输入框（Enter 应用）设置的方向提示，随下次建议/改写传入引擎 */
  private cursorHint: string = '';
  private suggestBtn: HTMLButtonElement | null = null;
  private actionButtons: HTMLButtonElement[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "cowrite", "\u270D\uFE0F \u534F\u540C\u5199\u4F5C\u6D6E\u7A97", "pen-nib");
    this.engine = plugin.coWriterEngine;
    this.timeEstimator = new TimeEstimator();
  }

  protected renderBody(container: HTMLElement): void {
    const root = container.createDiv({ cls: "nw-cowrite-root nw-float-cowrite-root" });

    // === 头部 ===
    const header = root.createDiv({ cls: "nw-cowrite-header" });
    header.createSpan({ cls: "nw-cowrite-title", text: "\u{1F4DD} \u534F\u540C\u5199\u4F5C" });
    this.statusBar = header.createDiv({ cls: "nw-cowrite-status", text: "\u52A0\u8F7D\u4E2D..." });

    // === 三栏主区 ===
    const mainArea = root.createDiv({ cls: "nw-cowrite-main" });

    // 中央：编辑器
    const centerPanel = mainArea.createDiv({ cls: "nw-cowrite-center" });
    const editorWrap = centerPanel.createDiv({ cls: "nw-cowrite-editor-wrap" });
    this.rightEditor = editorWrap.createEl("textarea", {
      cls: "nw-cowrite-editor",
      placeholder: "\u5728\u6B64\u5199\u4F5C\u2026\u2026\u6309 Tab \u751F\u6210 AI \u5EFA\u8BAE",
    });
    this.rightEditor.spellcheck = false;
    this.suggestionContainer = centerPanel.createDiv({ cls: "nw-suggestions" });

    // 右侧：控制台
    const rightPanel = mainArea.createDiv({ cls: "nw-cowrite-right" });
    const cardsArea = rightPanel.createDiv({ cls: "nw-cowrite-cards" });

    // 字数卡
    const wordCard = cardsArea.createDiv({ cls: "nw-card nw-cowrite-word-card" });
    wordCard.createDiv({ cls: "nw-card-title", text: "\u5B57\u6570" });
    this.wordCountDisplay = wordCard.createDiv({ cls: "nw-card-value", text: "0" });
    this.wordGoalDisplay = wordCard.createDiv({ cls: "nw-card-sub", text: "\u76EE\u6807: 3000" });

    // 完成度卡
    const completionCard = cardsArea.createDiv({ cls: "nw-card" });
    completionCard.createDiv({ cls: "nw-card-title", text: "\u5B8C\u6210\u5EA6" });
    completionCard.createDiv({ cls: "nw-card-value", text: "0%" });
    const cp = completionCard.createDiv({ cls: "nw-progress" });
    cp.createDiv({ cls: "nw-progress-fill", attr: { style: "width: 0%" } });
    this.metricsContainer = completionCard;

    // 牵引卡
    const tractionCard = cardsArea.createDiv({ cls: "nw-card" });
    tractionCard.createDiv({ cls: "nw-card-title", text: "\u60C5\u8282\u7275\u5F15" });
    tractionCard.createDiv({ cls: "nw-card-value", text: "\u2014" });
    this.tractionContainer = tractionCard;

    // 控制台按钮
    const controlPanel = rightPanel.createDiv({ cls: "nw-cowrite-control-panel" });
    const controlHead = controlPanel.createDiv({ cls: "nw-cowrite-control-head" });
    controlHead.createDiv({ cls: "nw-cowrite-control-title", text: "\u63A7\u5236\u53F0" });
    this.saveStateDisplay = controlHead.createDiv({ cls: "nw-cowrite-control-state", text: "\u672A\u4FDD\u5B58" });

    this.hintInput = controlPanel.createEl("input", {
      type: "text",
      cls: "nw-hint-input",
      placeholder: "\u4E34\u65F6\u6307\u4EE4 / \u65B9\u5411\uFF08Enter \u5E94\u7528\uFF09",
    });

    const actionsRow = controlPanel.createDiv({ cls: "nw-cowrite-control-actions" });
    const actions: Array<{ text: string; cls: string; action: () => void | Promise<unknown> }> = [
      { text: "\u21E5 \u5EFA\u8BAE", cls: "nw-btn-primary", action: () => this.handleTabSuggest() },
      { text: "\u2728 \u8054\u60F3", cls: "nw-btn-ghost", action: () => this.handleAssociationSuggest() },
      { text: "\u2702 \u6539\u5199", cls: "nw-btn-ghost", action: () => this.handleRewriteSelection() },
      { text: "\uD83D\uDD0D \u903B\u8F91\u68C0\u67E5", cls: "nw-btn-ghost", action: () => this.handleLogicCheck() },
      { text: "\uD83E\uDDFE \u5267\u60C5\u5197\u4F59", cls: "nw-btn-ghost", action: () => this.handleRedundancyCheck() },
      { text: "\uD83D\uDCA1 \u4FDD\u5B58", cls: "nw-btn-ghost", action: () => this.saveBody() },
      { text: "\u2705 \u7ED3\u7B97", cls: "nw-btn-primary", action: () => this.handleComplete() },
    ];
    this.actionButtons = [];
    for (const a of actions) {
      const btn = actionsRow.createEl("button", { text: a.text, cls: `nw-btn ${a.cls}` });
      btn.addEventListener("click", () => {
        void Promise.resolve(a.action()).catch((e) => {
          log.warn("[CoWriteFloating] 操作失败:", e);
          showErrorNotice(e instanceof Error ? e.message : String(e), { title: '操作失败', timeout: 5000 });
        });
      });
      this.actionButtons.push(btn);
      if (a.text.includes("\u5EFA\u8BAE")) {
        this.suggestBtn = btn;
      }
    }

    this.flowContainer = controlPanel.createDiv({ cls: "nw-cowrite-flow-panel" });

    // 逻辑检查结果容器（默认隐藏，检查后显示）
    this.logicCheckContainer = controlPanel.createDiv({ cls: "nw-cowrite-logic-check-panel" });
    this.logicCheckContainer.style.display = "none";

    // === 事件绑定 ===
    this.bindEditorEvents();
  }

  /** 统一设置底部操作按钮的忙碌态（建议按钮文案由 suggest 流程单独维护） */
  private setActionsBusy(busy: boolean): void {
    for (const btn of this.actionButtons) {
      btn.disabled = busy;
    }
  }

  /** 绑定编辑器事件 */
  private bindEditorEvents(): void {
    this.rightEditor.addEventListener("keydown", (event: KeyboardEvent) => {
      // IME 组字期间 Tab 用于选候选/结束组字，不能被劫持成「生成建议」
      if (isImeComposing(event)) return;
      if (event.key === "Tab") {
        event.preventDefault();
        void this.handleTabSuggest();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        this.saveBody();
        return;
      }
    });

    this.rightEditor.addEventListener("input", () => {
      this.engine.updateSnapshot(this.rightEditor.value);
      this.updateSaveState("\u7F16\u8F91\u4E2D");
      this.updateWordCount();
    });

    this.hintInput.addEventListener("keydown", (event: KeyboardEvent) => {
      // 组字中回车是确认候选，不能把半截指令应用掉
      if (isImeComposing(event)) return;
      if (event.key === "Enter") this.applyHint();
    });
  }

  /**
   * 打开章节
   *
   * @param project - 项目（路径或对象）
   * @param chapterName - 章节名
   * @param volume - 卷
   * @param chapterNum - 章号
   */
  async openChapter(project: string, chapterName: string, volume: string, chapterNum: number): Promise<void> {
    // 切章先把上一章的候选/幽灵/改写范围与在途请求全部作废：
    // 旧实现只换身份读文件，残留卡片仍可点击，旧章建议会被插进新章；
    // 若上一轮是改写候选，还会叠加 pendingRewriteRange 的错误区间替换。
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
      this.suggestProgressEmitter = null;
    }
    this.currentSuggestions = [];
    this.pendingRewriteRange = null;
    this.ghostSuggestion = null;
    this.isSuggesting = false;
    this.suggestionContainer?.empty();

    this.project = project;
    this.chapterName = chapterName;
    this.volume = volume;
    this.chapterNum = chapterNum;

    const bodyPath = this.getBodyPath();
    const file = this.app.vault.getAbstractFileByPath(bodyPath);
    if (file instanceof TFile) {
      try {
        this.rightEditor.value = await this.app.vault.read(file);
      } catch (e) {
        log.warn("[CoWriteFloating] \u8BFB\u53D6\u6B63\u6587\u5931\u8D25:", e);
      }
    }

    this.statusBar.setText(`\u270D\uFE0F ${chapterName} \u00B7 ${volume}`);
    this.updateSaveState("\u5DF2\u52A0\u8F7D");
    this.updateWordCount();

    try {
      await this.engine.init(project, chapterName, volume, chapterNum);
      this.engine.updateSnapshot(this.rightEditor.value);
      await this.renderFlowPanel();
    } catch (e) {
      log.warn("[CoWriteFloating] \u521D\u59CB\u5316\u5931\u8D25:", e);
    }
  }

  // === 保存 ===
  private getBodyPath(): string {
    const volN = volumeNumber(this.volume) || 1;
    return findBodyFileV4(this.app, this.project, volN, this.chapterNum)?.path
      ?? pjBodyFile(this.project, volN, this.chapterNum);
  }
  /**
   * 保存正文。
   * @returns 是否成功
   */
  async saveBody(): Promise<boolean> {
    const content = this.rightEditor.value;
    if (!content.trim()) return false;
    const path = this.getBodyPath();
    try {
      // 与主视图共用同一落盘入口：保留 frontmatter 原文、统一标题、按格式契约规整。
      // 旧实现直接 vault.modify，会把 YAML 一起写回并绕过契约。
      await new BodyWriter({ app: this.app }).write({
        path,
        raw: content,
        chapterNum: this.chapterNum,
        chapterName: this.chapterName,
        volume: this.volume,
        project: this.project,
        writingMode: 'co-writer',
      });
      this.updateSaveState("\u5DF2\u4FDD\u5B58");
      await this.renderFlowPanel();
      return true;
    } catch (e) {
      log.warn("[CoWriteFloating] \u4FDD\u5B58\u5931\u8D25:", e);
      this.updateSaveState("\u4FDD\u5B58\u5931\u8D25");
      showErrorNotice(e instanceof Error ? e.message : String(e), { title: '保存失败', timeout: 6000 });
      return false;
    }
  }

  // === 建议生成（进度增强版） ===
  /**
   * 处理 Tab 建议。
   */
  async handleTabSuggest(): Promise<void> {
    if (this.isSuggesting) return;

    // 普通续写建议与改写候选是两种语义：上一轮的改写区间必须作废，
    // 否则 acceptByIndex 会拿它去替换一段与本轮建议无关的正文。
    this.pendingRewriteRange = null;

    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    if (this.suggestProgressEmitter) {
      this.suggestProgressEmitter.cancel();
      this.suggestProgressEmitter = null;
    }

    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;

    this.isSuggesting = true;
    this.setActionsBusy(true);
    if (this.suggestBtn) {
      this.suggestBtn.disabled = true;
      this.suggestBtn.setText("⏳ 生成中...");
    }

    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    const precedingText = this.rightEditor.value.slice(0, cursor);

    this.lastSuggestParams = {
      precedingText,
      cursorHint: this.cursorHint,
      mode: 'continue',
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

      const response = await this.engine.suggestNext(precedingText, this.cursorHint, 'continue', 3, signal);
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

      if (Array.isArray(response)) {
        this.currentSuggestions = response;
        this.renderSuggestions(response);
      }
      success = true;
    } catch (e) {
      if (signal.aborted) {
        if (this.suggestProgressEmitter) {
          this.suggestProgressEmitter.cancel();
        }
        return;
      }
      log.warn("[CoWriteFloating] 建议生成失败:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.lastSuggestError = errorMsg;
      if (this.suggestProgressEmitter) {
        this.suggestProgressEmitter.fail(this.getFriendlyErrorMessage(errorMsg));
      }
    } finally {
      if (this.suggestAbortController?.signal === signal) {
        this.isSuggesting = false;
        this.suggestAbortController = null;
        if (this.suggestBtn) {
          this.suggestBtn.disabled = false;
          this.suggestBtn.setText("⇥ 建议");
        }
        this.setActionsBusy(false);
      }
    }
  }

  private renderSuggestionLoading(): void {
    this.suggestionContainer.empty();
    this.lastSuggestError = null;

    this.suggestProgressContainer = this.suggestionContainer.createDiv({
      cls: "nw-suggest-progress-container",
      attr: { style: "padding: 12px 16px;" }
    });

    const headerRow = this.suggestProgressContainer.createDiv({
      attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;" }
    });
    headerRow.createSpan({
      text: "🤖 AI 正在生成建议",
      attr: { style: "font-weight:600;font-size:13px;" }
    });

    this.suggestEtaDisplay = headerRow.createSpan({
      text: "预估时间: 计算中...",
      attr: { style: "font-size:11px;color:var(--text-muted);" }
    });

    const stepListContainer = this.suggestProgressContainer.createDiv({
      attr: { style: "margin-bottom:12px;" }
    });
    this.suggestStepList = new StepListComponent(stepListContainer, [
      "检索知识库内容",
      "分析写作上下文",
      "生成写作建议"
    ]);

    const actionsRow = this.suggestProgressContainer.createDiv({
      attr: { style: "display:flex;gap:8px;justify-content:flex-end;" }
    });

    this.suggestCancelBtn = actionsRow.createEl("button", {
      text: "✕ 取消",
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
        style: "display:none;margin-top:10px;padding:10px;background:var(--background-secondary);border-radius:6px;border-left:3px solid var(--text-error, #ef4444);"
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
      this.suggestionContainer.createDiv({
        cls: "nw-suggestion-empty",
        text: "已取消生成。按 Tab 重新生成。",
        attr: { style: "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;" }
      });
    }
  }

  private showSuggestError(error: string): void {
    if (!this.suggestErrorContainer || !this.suggestRetryBtn || !this.suggestCancelBtn) return;

    this.suggestErrorContainer.style.display = 'block';
    this.suggestErrorContainer.empty();
    this.suggestErrorContainer.createDiv({
      text: "❌ 生成失败",
      attr: { style: "font-weight:600;font-size:12px;margin-bottom:4px;color:var(--text-error, #ef4444);" }
    });
    this.suggestErrorContainer.createDiv({
      text: error,
      attr: { style: "font-size:11px;color:var(--text-muted);" }
    });

    this.suggestRetryBtn.style.display = 'inline-flex';
    this.suggestCancelBtn.style.display = 'none';
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
    void this.handleTabSuggest();
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

  // === 建议渲染 ===
  private renderSuggestions(suggestions: SuggestionRecord[]): void {
    this.suggestionContainer.empty();
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const card = this.suggestionContainer.createDiv({ cls: "nw-suggestion-card" });

      const header = card.createDiv({ cls: "nw-suggestion-header" });
      header.createDiv({ cls: "nw-suggestion-index", text: String(i + 1) });
      header.createDiv({ cls: "nw-suggestion-tag", text: getDirectionLabel(s.direction) });
      if (s.style && s.style !== "default") {
        header.createDiv({ cls: "nw-suggestion-tag secondary", text: getStyleLabel(s.style) });
      }

      card.createDiv({ cls: "nw-suggestion-text", text: s.text });

      const actions = card.createDiv({ cls: "nw-suggestion-actions" });
      const acceptBtn = actions.createEl("button", { text: "\u2713 \u63A5\u53D7", cls: "nw-btn nw-btn-primary" });
      acceptBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void this.acceptByIndex(i);
      });
      const rejectBtn = actions.createEl("button", { text: "\u2715 \u62D2\u7EDD", cls: "nw-btn nw-btn-ghost" });
      rejectBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.rejectSuggestion(s.id);
      });

      card.addEventListener("click", () => this.acceptByIndex(i));
    }
  }

  /** 拒绝单条建议；全部拒绝后展示空态提示 */
  private rejectSuggestion(suggestionId: string): void {
    this.currentSuggestions = this.currentSuggestions.filter((s) => s.id !== suggestionId);
    if (this.currentSuggestions.length > 0) {
      this.renderSuggestions(this.currentSuggestions);
    } else {
      this.suggestionContainer.empty();
      this.suggestionContainer.createDiv({
        cls: "nw-suggestion-empty",
        text: "\u5DF2\u62D2\u7EDD\u672C\u8F6E\u5EFA\u8BAE\u3002\u6309 Tab \u91CD\u65B0\u751F\u6210\u3002",
        attr: { style: "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;" },
      });
    }
  }

  private async acceptByIndex(index: number): Promise<void> {
    const s = this.currentSuggestions[index];
    if (!s) return;
    const ed = this.rightEditor;
    if (this.pendingRewriteRange) {
      const { start, end } = this.pendingRewriteRange;
      const before = ed.value.slice(0, start);
      const after = ed.value.slice(end);
      ed.value = before + s.text + after;
      ed.setSelectionRange(start + s.text.length, start + s.text.length);
      this.pendingRewriteRange = null;
    } else {
      const pos = ed.selectionStart;
      const before = ed.value.slice(0, pos);
      const after = ed.value.slice(pos);
      ed.value = before + s.text + after;
      ed.setSelectionRange(pos + s.text.length, pos + s.text.length);
    }
    this.currentSuggestions = [];
    this.suggestionContainer.empty();
    this.engine.updateSnapshot(ed.value);
    this.updateWordCount();
  }

  // === 辅助方法 ===
  private updateWordCount(): void {
    const count = this.rightEditor.value.replace(/\s/g, "").length;
    this.wordCountDisplay.setText(String(count));
  }

  private updateSaveState(state: string): void {
    this.saveStateDisplay.setText(state);
  }

  private async renderFlowPanel(): Promise<void> {
    this.flowContainer.empty();
    this.flowContainer.createDiv({
      text: `\u25CF \u7B2C${this.chapterNum}\u7AE0 \u00B7 \u5B57\u6570 ${this.rightEditor.value.replace(/\s/g, "").length}`,
      attr: { style: "font-size: 0.78em; color: var(--text-muted);" },
    });
  }

  // === 联想功能 ===
  /**
   * 处理联想建议。
   */
  async handleAssociationSuggest(): Promise<void> {
    if (this.isSuggesting) return;
    this.isSuggesting = true;
    this.setActionsBusy(true);
    // Phase 3.2: 联想与建议共用中止控制器，关闭浮窗/新请求都会取消在途联想
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
    this.suggestAbortController = new AbortController();
    const signal = this.suggestAbortController.signal;
    const cursor = resolveCursorPosition(this.rightEditor.selectionStart, this.rightEditor.value.length);
    try {
      const associations = await this.engine.suggestAssociation(cursor, this.rightEditor.value, "manual", signal);
      if (signal.aborted) return;
      if (associations.length === 0) {
        new Notice("暂时没有联想到合适续写");
        return;
      }
      this.currentSuggestions = associations.map((association, index) => associationToSuggestion(association, index));
      this.pendingRewriteRange = null;
      this.renderSuggestions(this.currentSuggestions);
    } catch (e) {
      if (signal.aborted) return;
      log.warn("[CoWriteFloating] 联想输入失败:", e);
      showErrorNotice("联想输入失败，请稍后重试");
    } finally {
      if (this.suggestAbortController?.signal === signal) {
        this.suggestAbortController = null;
      }
      this.isSuggesting = false;
      this.setActionsBusy(false);
    }
  }

  // === 改写功能 ===
  /**
   * 处理选中改写。
   */
  async handleRewriteSelection(): Promise<void> {
    const start = this.rightEditor.selectionStart;
    const end = this.rightEditor.selectionEnd;
    if (start === end) {
      new Notice("请先选中需要改写的文本");
      return;
    }
    if (this.isSuggesting) return;
    this.isSuggesting = true;
    this.setActionsBusy(true);
    const selectedText = this.rightEditor.value.slice(start, end);
    const beforeContext = this.rightEditor.value.slice(0, start);
    const afterContext = this.rightEditor.value.slice(end);
    try {
      const suggestions = await this.engine.rewriteSelection(selectedText, beforeContext, afterContext, this.cursorHint, 3);
      if (suggestions.length === 0) {
        new Notice("没有生成改写候选");
        return;
      }
      this.currentSuggestions = suggestions;
      this.pendingRewriteRange = { start, end };
      this.renderSuggestions(suggestions);
    } catch (e) {
      log.warn("[CoWriteFloating] 选区改写失败:", e);
      showErrorNotice("选区改写失败，请稍后重试");
    } finally {
      this.isSuggesting = false;
      this.setActionsBusy(false);
    }
  }

  /**
   * 处理完成本章。
   */
  async handleComplete(): Promise<void> {
    this.setActionsBusy(true);
    try {
      const saved = await this.saveBody();
      if (!saved) {
        showWarningNotice("正文未保存，本次结算已取消");
        return;
      }
      showSuccessNotice("章节保存已完成，请在全本写作视图中执行结算");
    } finally {
      this.setActionsBusy(false);
    }
  }

  // === 逻辑检查（人设一致性） ===
  /**
   * 处理逻辑检查。
   */
  async handleLogicCheck(): Promise<void> {
    const body = this.rightEditor.value;
    if (!body.trim()) {
      new Notice("\u26A0\uFE0F \u6B63\u6587\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u6267\u884C\u903B\u8F91\u68C0\u67E5");
      return;
    }
    if (!this.project) {
      new Notice("\u26A0\uFE0F \u672A\u7ED1\u5B9A\u9879\u76EE\uFF0C\u65E0\u6CD5\u83B7\u53D6\u4EBA\u7269\u4FE1\u606F");
      return;
    }

    const checker: CharacterConsistencyChecker | undefined = this.plugin.characterConsistencyChecker;
    if (!checker) {
      new Notice("\u26A0\uFE0F \u903B\u8F91\u68C0\u67E5\u5668\u672A\u521D\u59CB\u5316");
      return;
    }

    new Notice("\uD83D\uDD0D \u6B63\u5728\u6267\u884C\u903B\u8F91\u68C0\u67E5...");
    this.setActionsBusy(true);

    try {
      const ctxData = await this.plugin.ctxManager.gatherCharacterState(this.project);
      const rawCharacters = (ctxData.character_state || []) as Array<Record<string, unknown>>;
      if (rawCharacters.length === 0) {
        new Notice("\u26A0\uFE0F \u672A\u627E\u5230\u4EBA\u7269\u8BBE\u5B9A\u4FE1\u606F");
        return;
      }

      const characterInfos = toCharacterContextInfos(rawCharacters);

      if (characterInfos.length === 0) {
        new Notice("\u26A0\uFE0F \u672A\u627E\u5230\u6709\u6548\u4EBA\u7269\u4FE1\u606F");
        return;
      }

      const result = await checker.check(body, characterInfos);
      this.renderLogicCheckResult(result);
      showSuccessNotice(`逻辑检查完成，一致性得分: ${result.overallScore}`);
    } catch (e) {
      log.warn("[CoWriteFloating] \u903B\u8F91\u68C0\u67E5\u5931\u8D25:", e);
      showErrorNotice("逻辑检查失败，请稍后重试");
    } finally {
      this.setActionsBusy(false);
    }
  }

  /**
   * 剧情冗余检查：比较本章与已写章节的场景/冲突/短语重复。
   * 引擎已有 checkPlotRedundancy，此前没有 UI 入口，属于「有核心能力但不可用」。
   */
  async handleRedundancyCheck(): Promise<void> {
    const body = this.rightEditor.value;
    if (!body.trim()) {
      new Notice("\u26A0\uFE0F \u6B63\u6587\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u68C0\u67E5\u5197\u4F59");
      return;
    }
    this.setActionsBusy(true);
    try {
      const report = await this.engine.checkPlotRedundancy(body);
      this.renderRedundancyResult(report);
      showSuccessNotice(
        report.issues.length > 0
          ? `冗余检查完成，发现 ${report.issues.length} 处重复`
          : "冗余检查完成，未发现明显重复",
        { timeout: 5000 },
      );
    } catch (e) {
      log.warn("[CoWriteFloating] \u5197\u4F59\u68C0\u67E5\u5931\u8D25:", e);
      showErrorNotice("冗余检查失败，请稍后重试");
    } finally {
      this.setActionsBusy(false);
    }
  }

  private renderRedundancyResult(report: { issues: Array<{ message: string; sample: string; count: number }>; comparedChapters: number }): void {
    this.logicCheckContainer.empty();
    this.logicCheckContainer.style.display = "block";
    const header = this.logicCheckContainer.createDiv({ cls: "nw-logic-check-header" });
    header.createSpan({ text: `\uD83E\uDDFE \u5267\u60C5\u5197\u4F59\uFF08\u5BF9\u6BD4 ${report.comparedChapters} \u7AE0\uFF09` });
    const closeBtn = header.createEl("button", { text: "\u2715", cls: "nw-btn nw-btn-ghost" });
    closeBtn.addEventListener("click", () => { this.logicCheckContainer.style.display = "none"; });
    if (report.issues.length === 0) {
      this.logicCheckContainer.createDiv({ text: "\u672A\u53D1\u73B0\u4E0E\u524D\u6587\u91CD\u590D\u7684\u573A\u666F\u3001\u51B2\u7A81\u6216\u77ED\u8BED\u3002", cls: "nw-u-fs-12px-2" });
      return;
    }
    const list = this.logicCheckContainer.createDiv({ cls: "nw-logic-check-list" });
    for (const issue of report.issues.slice(0, 20)) {
      const row = list.createDiv({ cls: "nw-logic-check-item" });
      row.createDiv({ text: `\u2022 ${issue.message} \u00D7${issue.count}` });
      if (issue.sample) {
        row.createDiv({ text: `\u300C${issue.sample}\u300D`, cls: "nw-u-fs-11px-2 nw-u-c-text-muted-2" });
      }
    }
  }

  private renderLogicCheckResult(result: ConsistencyCheckResult): void {
    this.logicCheckContainer.empty();
    this.logicCheckContainer.style.display = "block";

    // 头部：标题 + 关闭按钮
    const header = this.logicCheckContainer.createDiv({ cls: "nw-logic-check-header" });
    header.createSpan({ text: "\uD83D\uDD0D \u903B\u8F91\u68C0\u67E5\u7ED3\u679C" });
    const closeBtn = header.createEl("button", { text: "\u2715", cls: "nw-btn nw-btn-ghost" });
    closeBtn.setCssStyles({ fontSize: "0.75em", padding: "0 4px", lineHeight: "1" });
    closeBtn.addEventListener("click", () => { this.logicCheckContainer.style.display = "none"; });

    // 总体一致性评分
    const scoreColor =
      result.overallScore >= 80 ? "#10b981" : result.overallScore >= 60 ? "#f59e0b" : "#ef4444";
    const scoreRow = this.logicCheckContainer.createDiv({ cls: "nw-logic-check-score" });
    scoreRow.createSpan({ text: "\u603B\u4F53\u4E00\u81F4\u6027" });
    scoreRow.createSpan({
      text: `${result.overallScore} \u5206`,
      attr: { style: `color: ${scoreColor}; font-weight: 600; margin-left: 6px;` },
    });

    // 摘要
    if (result.summary) {
      this.logicCheckContainer.createDiv({
        text: result.summary,
        cls: "nw-logic-check-summary",
        attr: { style: "font-size: 0.78em; color: var(--text-muted); margin-top: 4px;" },
      });
    }

    // 每个人物的检测结果
    const charNames = Object.keys(result.characterResults);
    if (charNames.length === 0) {
      this.logicCheckContainer.createDiv({
        text: "\u65E0\u4EBA\u7269\u68C0\u6D4B\u7ED3\u679C",
        attr: { style: "font-size: 0.8em; color: var(--text-muted); padding: 8px 0;" },
      });
      return;
    }

    for (const name of charNames) {
      const charResult = result.characterResults[name];
      const charCard = this.logicCheckContainer.createDiv({ cls: "nw-logic-check-char" });
      charCard.setCssStyles({
        borderTop: "1px solid var(--background-modifier-border)",
        paddingTop: "6px",
        marginTop: "6px",
      });

      // 人物名 + 得分
      const charHead = charCard.createDiv({ cls: "nw-logic-check-char-head" });
      charHead.createSpan({ text: name, attr: { style: "font-weight: 600; font-size: 0.85em;" } });
      const charScoreColor =
        charResult.score >= 80 ? "#10b981" : charResult.score >= 60 ? "#f59e0b" : "#ef4444";
      charHead.createSpan({
        text: `${charResult.score} \u5206`,
        attr: { style: `color: ${charScoreColor}; font-weight: 600; margin-left: 6px; font-size: 0.82em;` },
      });

      if (charResult.inconsistencies.length === 0) {
        charCard.createDiv({
          text: "\u2705 \u672A\u53D1\u73B0\u4E0D\u4E00\u81F4",
          attr: { style: "font-size: 0.78em; color: #10b981; padding: 2px 0;" },
        });
        continue;
      }

      // 不一致项列表
      for (const item of charResult.inconsistencies) {
        const sevColor =
          item.severity === "high" ? "#ef4444" : item.severity === "medium" ? "#f59e0b" : "#3b82f6";
        const sevLabel =
          item.severity === "high" ? "\uD83D\uDD34" : item.severity === "medium" ? "\uD83D\uDFE1" : "\uD83D\uDFE2";
        const typeLabels: Record<string, string> = {
          personality: "\u6027\u683C\u8BED\u6C14",
          behavior: "\u884C\u4E3A\u903B\u8F91",
          ability: "\u80FD\u529B\u8FB9\u754C",
          appearance: "\u5916\u8C8C\u63CF\u8FF0",
        };
        const typeLabel = typeLabels[item.type] || item.type;

        const itemEl = charCard.createDiv({ cls: "nw-logic-check-item" });
        itemEl.setCssStyles({ padding: "3px 0", borderLeft: `3px solid ${sevColor}`, paddingLeft: "6px", margin: "3px 0" });

        const descRow = itemEl.createDiv({ attr: { style: "display: flex; align-items: baseline; gap: 4px;" } });
        descRow.createSpan({ text: sevLabel, attr: { style: `color: ${sevColor};` } });
        descRow.createSpan({
          text: `[${typeLabel}]`,
          attr: { style: `font-size: 0.72em; color: ${sevColor}; font-weight: 600;` },
        });
        descRow.createSpan({ text: item.description, attr: { style: "font-size: 0.78em;" } });

        if (item.location) {
          itemEl.createDiv({
            text: `\uD83D\uDCCD ${item.location}`,
            attr: { style: "font-size: 0.72em; color: var(--text-muted); margin-left: 18px; margin-top: 1px;" },
          });
        }
        if (item.suggestion) {
          itemEl.createDiv({
            text: `\uD83D\uDCA1 ${item.suggestion}`,
            attr: { style: "font-size: 0.72em; color: var(--text-success, #10b981); margin-left: 18px; margin-top: 1px;" },
          });
        }
      }
    }
  }

  private applyHint(): void {
    const hint = this.hintInput.value.trim();
    if (!hint) {
      new Notice("请先输入临时指令或方向", 3000);
      return;
    }
    // 修复死代码：原先 Enter 仅 Notice 展示、从未真正应用指令。
    // 现在把方向提示存到 cursorHint，供 suggestNext / rewriteSelection 实际传入引擎。
    this.cursorHint = hint;
    this.hintInput.value = "";
    showSuccessNotice(`已应用指令，将在下次生成时生效: ${hint}`);
  }

  /**
   * 关闭并清理。
   */
  async onClose(): Promise<void> {
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
      void this.timeEstimator.saveHistory();
      this.timeEstimator = null;
    }
    await super.onClose();
    await this.saveBody();
  }
}
