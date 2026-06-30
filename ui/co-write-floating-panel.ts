/**
 * co-write-floating-panel.ts — V2 Phase 3 协同写作浮窗
 *
 * 基于 DraggablePanel 的浮动窗口版本，提供三栏布局（编辑器+建议+控制台）。
 * 与 Tab 版 CoWritingView 共享同一个 CoWriterEngine 实例（由 plugin 管理）。
 *
 * 注册类型：nw-float-cowrite
 */
import { WorkspaceLeaf, Notice, TFile } from "obsidian";
import NovelWriterPlugin from "../main";
import { DraggablePanel } from "./draggable-panel";
import { CoWriterEngine } from "../engine/co-writer-engine";
import { SuggestionRecord, SentenceEditRecord } from "../shared/types";

export const VIEW_TYPE_FLOAT_COWRITE = "nw-float-cowrite";

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

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "cowrite", "\u270D\uFE0F \u534F\u540C\u5199\u4F5C\u6D6E\u7A97", "pen-nib");
    this.engine = plugin.coWriterEngine;
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
    const actions: Array<{ text: string; cls: string; action: () => void | Promise<void> }> = [
      { text: "\u21E5 \u5EFA\u8BAE", cls: "nw-btn-primary", action: () => this.handleTabSuggest() },
      { text: "\u2728 \u8054\u60F3", cls: "nw-btn-ghost", action: () => this.handleAssociationSuggest() },
      { text: "\u2702 \u6539\u5199", cls: "nw-btn-ghost", action: () => this.handleRewriteSelection() },
      { text: "\uD83D\uDCA1 \u4FDD\u5B58", cls: "nw-btn-ghost", action: () => this.saveBody() },
      { text: "\u2705 \u7ED3\u7B97", cls: "nw-btn-primary", action: () => this.handleComplete() },
    ];
    for (const a of actions) {
      const btn = actionsRow.createEl("button", { text: a.text, cls: `nw-btn ${a.cls}` });
      btn.addEventListener("click", () => a.action());
    }

    this.flowContainer = controlPanel.createDiv({ cls: "nw-cowrite-flow-panel" });

    // === 事件绑定 ===
    this.bindEditorEvents();
  }

  /** 绑定编辑器事件 */
  private bindEditorEvents(): void {
    this.rightEditor.addEventListener("keydown", (event: KeyboardEvent) => {
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
      if (event.key === "Enter") this.applyHint();
    });
  }

  /** 打开章节 */
  async openChapter(project: string, chapterName: string, volume: string, chapterNum: number): Promise<void> {
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
        console.warn("[CoWriteFloating] \u8BFB\u53D6\u6B63\u6587\u5931\u8D25:", e);
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
      console.warn("[CoWriteFloating] \u521D\u59CB\u5316\u5931\u8D25:", e);
    }
  }

  // === 保存 ===
  private getBodyPath(): string {
    const chapDir = this.chapterName.match(/^\u7B2C\d+\u7AE0/)
      ? `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}/${this.chapterName}_\u6B63\u6587.md`
      : `${this.project}/03-\u5927\u7EB2\u4E0E\u7AE0\u8282/\u6B63\u6587/${this.volume}/${this.chapterName}.md`;
    return chapDir;
  }

  async saveBody(): Promise<void> {
    const content = this.rightEditor.value;
    if (!content.trim()) return;
    const path = this.getBodyPath();
    const existing = this.app.vault.getAbstractFileByPath(path);
    try {
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(path, content);
      }
      this.updateSaveState("\u5DF2\u4FDD\u5B58");
      await this.renderFlowPanel();
    } catch (e) {
      new Notice("\u26A0\uFE0F \u4FDD\u5B58\u5931\u8D25");
    }
  }

  // === 建议生成（简化版） ===
  async handleTabSuggest(): Promise<void> {
    if (this.isSuggesting) return;
    this.isSuggesting = true;
    try {
      const body = this.rightEditor.value;
      const cursor = this.rightEditor.selectionStart;
      const preceding = body.slice(0, cursor);
      const response = await this.engine.suggestNext(preceding, '', 'continue', 3);
      if (Array.isArray(response)) {
        this.currentSuggestions = response;
        this.renderSuggestions(response);
      }
    } catch (e) {
      console.warn("[CoWriteFloating] \u5EFA\u8BAE\u751F\u6210\u5931\u8D25:", e);
    } finally {
      this.isSuggesting = false;
    }
  }

  // === 建议渲染 ===
  private renderSuggestions(suggestions: SuggestionRecord[]): void {
    this.suggestionContainer.empty();
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const card = this.suggestionContainer.createDiv({ cls: "nw-suggestion-card" });
      card.createDiv({ cls: "nw-suggestion-index", text: String(i + 1) });
      card.createDiv({ cls: "nw-suggestion-text", text: s.text });
      card.addEventListener("click", () => this.acceptByIndex(i));
    }
  }

  private async acceptByIndex(index: number): Promise<void> {
    const s = this.currentSuggestions[index];
    if (!s) return;
    const ed = this.rightEditor;
    const pos = ed.selectionStart;
    const before = ed.value.slice(0, pos);
    const after = ed.value.slice(pos);
    ed.value = before + s.text + after;
    ed.setSelectionRange(pos + s.text.length, pos + s.text.length);
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

  // === 未完全实现的方法（后续扩展） ===
  async handleAssociationSuggest(): Promise<void> {
    new Notice("\u2728 \u8054\u60F3\u529F\u80FD\u5F85\u5B9E\u73B0");
  }

  async handleRewriteSelection(): Promise<void> {
    new Notice("\u2702 \u6539\u5199\u529F\u80FD\u5F85\u5B9E\u73B0");
  }

  async handleComplete(): Promise<void> {
    await this.saveBody();
    new Notice("\u2705 \u7AE0\u8282\u4FDD\u5B58\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u5728\u5168\u672C\u5199\u4F5C\u89C6\u56FE\u4E2D\u6267\u884C\u7ED3\u7B97");
  }

  private applyHint(): void {
    const hint = this.hintInput.value.trim();
    if (!hint) return;
    this.hintInput.value = "";
    new Notice(`\uD83D\uDCA1 \u6307\u4EE4: ${hint}`);
  }

  async onClose(): Promise<void> {
    await super.onClose();
    await this.saveBody();
  }
}
