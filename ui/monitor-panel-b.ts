/**
 * monitor-panel-b.ts — v5.5 监控面板B
 * 结局牵引(D4) + 章节结算(G1) + 风格自学习(E1) + 偏好记忆(E3)
 */
import { WorkspaceLeaf, Notice } from "obsidian";
import NovelWriterPlugin from "../main";
import { DraggablePanel } from "./draggable-panel";
import { EndingTractionEngine } from "../engine/ending-traction-engine";
import { StyleLearner } from "../engine/style-learner";
import { PreferenceMemory } from "../engine/preference-memory";

export const VIEW_TYPE_MONITOR_B = "nw-float-monitor-b";

export class MonitorPanelB extends DraggablePanel {
  private tractionEngine: EndingTractionEngine | null = null;
  private styleLearner: StyleLearner | null = null;
  private prefMemory: PreferenceMemory | null = null;

  private tractionContent!: HTMLElement;
  private styleContent!: HTMLElement;
  private prefContent!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "monitor-b", "监控面板B · 结局/结算/风格/偏好", "layers");
  }

  protected renderBody(container: HTMLElement): void {
    container.addClass("nw-float-monitor-grid");

    // 4列网格
    const tractionCard = container.createDiv({ cls: "nw-float-card" });
    tractionCard.createEl("h5", { text: "🏁 结局牵引(D4)" });
    this.tractionContent = tractionCard.createDiv({ cls: "nw-float-card-body" });
    this.tractionContent.createDiv({ cls: "nw-float-empty", text: "打开章节后分析" });

    const styleCard = container.createDiv({ cls: "nw-float-card" });
    styleCard.createEl("h5", { text: "🎨 风格自学习(E1)" });
    this.styleContent = styleCard.createDiv({ cls: "nw-float-card-body" });
    this.styleContent.createDiv({ cls: "nw-float-empty", text: "写作中自动学习" });

    const prefCard = container.createDiv({ cls: "nw-float-card" });
    prefCard.createEl("h5", { text: "💾 偏好记忆(E3)" });
    this.prefContent = prefCard.createDiv({ cls: "nw-float-card-body" });
    this.prefContent.createDiv({ cls: "nw-float-empty", text: "写作中自动记录" });

    // 剩余一个位置留给章节结算快捷卡片
    const settleCard = container.createDiv({ cls: "nw-float-card" });
    settleCard.createEl("h5", { text: "💰 章节结算(G1)" });
    const settleContent = settleCard.createDiv({ cls: "nw-float-card-body" });
    const settleBtn = settleContent.createEl("button", {
      cls: "nw-float-btn",
      text: "📊 执行结算",
    });
    settleBtn.addEventListener("click", () => {
      new Notice("章节结算功能需在编辑器中触发");
    });

    // 初始化引擎
    try {
      this.tractionEngine = new EndingTractionEngine({
        app: this.app,
        aiEngine: this.plugin.aiEngine,
        plugin: this.plugin,
      });
      const project = this.plugin.getActiveProject() || '';
      this.styleLearner = new StyleLearner({
        app: this.app,
        aiEngine: this.plugin.aiEngine,
        plugin: this.plugin,
        project,
      });
      this.prefMemory = new PreferenceMemory({
        app: this.app,
        plugin: this.plugin,
        project,
      });
    } catch (e) {
      console.warn("[MonitorPanelB] 引擎初始化失败:", e);
    }
  }

  /** 刷新结局牵引 */
  async refreshTraction(volume: number, chapterNum: number): Promise<void> {
    if (!this.tractionEngine || !this.tractionContent) return;
    try {
      this.tractionContent.empty();
      this.tractionContent.createDiv({ text: "正在分析..." });
      const state = await this.tractionEngine.checkTraction(volume, chapterNum);
      this.tractionContent.empty();
      this.tractionContent.createDiv({
        cls: "nw-float-progress",
        text: `整体进度: ${state.overallProgress}%`,
      });
      const riskCls = state.divergenceRisk === "high" ? "nw-float-danger" : state.divergenceRisk === "medium" ? "nw-float-warn-text" : "nw-float-ok";
      this.tractionContent.createDiv({
        cls: riskCls,
        text: `偏离风险: ${state.divergenceRisk.toUpperCase()}`,
      });
      for (const rec of state.recommendations.slice(0, 3)) {
        this.tractionContent.createDiv({ cls: "nw-float-rec", text: `💡 ${rec}` });
      }
    } catch (e) {
      this.tractionContent.empty();
      this.tractionContent.createDiv({ cls: "nw-float-error", text: "分析失败" });
    }
  }

  /** 刷新风格学习状态 */
  refreshStyle(styleInfo: string): void {
    if (!this.styleContent) return;
    this.styleContent.empty();
    this.styleContent.createDiv({ cls: "nw-float-ok", text: styleInfo || "✅ 风格学习中" });
  }

  /** 刷新偏好记忆状态 */
  refreshPref(prefInfo: string): void {
    if (!this.prefContent) return;
    this.prefContent.empty();
    this.prefContent.createDiv({ cls: "nw-float-ok", text: prefInfo || "✅ 偏好已记录" });
  }
}
