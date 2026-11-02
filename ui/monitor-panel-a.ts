/**
 * monitor-panel-a.ts — v5.5 监控面板A
 * 节奏(C2) + 情绪曲线(F3) + OOC警告(A1) + 实体追踪(D1)
 */
import { WorkspaceLeaf, Notice } from "obsidian";
import NovelWriterPlugin from "../main";
import { DraggablePanel } from "./draggable-panel";
import { EmotionCurveAnalyzer } from "../engine/emotion-curve-analyzer";
import { RhythmAnalyzer } from "../engine/rhythm-analyzer";
import { EmotionCurveView } from "./components/emotion-curve-view";
import { CoWriteFacade } from "./services/co-write-facade";

export const VIEW_TYPE_MONITOR_A = "nw-float-monitor-a";

export class MonitorPanelA extends DraggablePanel {
  private emotionAnalyzer: EmotionCurveAnalyzer | null = null;
  private rhythmAnalyzer: RhythmAnalyzer | null = null;
  protected facade: CoWriteFacade;

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "monitor-a", "监控面板A · 节奏/情绪/OOC/实体", "bar-chart");
    this.facade = new CoWriteFacade({ plugin });
  }

  protected renderBody(container: HTMLElement): void {
    container.addClass("nw-float-monitor-grid");

    // 4列网格：节奏 | 情绪 | OOC | 实体
    const rhythmCard = container.createDiv({ cls: "nw-float-card" });
    rhythmCard.createEl("h5", { text: "🎯 节奏分析(C2)" });
    this.rhythmContent = rhythmCard.createDiv({ cls: "nw-float-card-body" });

    const emotionCard = container.createDiv({ cls: "nw-float-card" });
    emotionCard.createEl("h5", { text: "📈 情绪曲线(F3)" });
    this.emotionContent = emotionCard.createDiv({ cls: "nw-float-card-body" });

    const oocCard = container.createDiv({ cls: "nw-float-card" });
    oocCard.createEl("h5", { text: "🚨 OOC警告(A1)" });
    this.oocContent = oocCard.createDiv({ cls: "nw-float-card-body" });

    const entityCard = container.createDiv({ cls: "nw-float-card" });
    entityCard.createEl("h5", { text: "🔗 实体追踪(D1)" });
    this.entityContent = entityCard.createDiv({ cls: "nw-float-card-body" });

    // 初始化引擎
    this.emotionAnalyzer = this.facade.createEmotionCurveAnalyzer();
    this.rhythmAnalyzer = this.facade.createRhythmAnalyzer();

    // 默认提示
    this.rhythmContent.createDiv({
      cls: "nw-float-empty",
      text: "打开章节后自动分析",
    });
    this.emotionContent.createDiv({
      cls: "nw-float-empty",
      text: "打开章节后自动分析",
    });
    this.oocContent.createDiv({
      cls: "nw-float-empty",
      text: "编辑正文后自动检测OOC",
    });
    this.entityContent.createDiv({
      cls: "nw-float-empty",
      text: "编辑正文后自动检测实体变更",
    });
  }

  // 子容器引用
  private rhythmContent!: HTMLElement;
  private emotionContent!: HTMLElement;
  private oocContent!: HTMLElement;
  private entityContent!: HTMLElement;
  /** 分析代次：连续输入会并发触发 refreshWithBody，慢的旧结果不得覆盖新结果 */
  private analysisSeq = 0;

  /**
   * 外部调用：用正文内容刷新所有分析
   *
   * @param body - 正文
   * @param modelName - 模型名
   */
  async refreshWithBody(body: string, modelName?: string): Promise<void> {
    const token = ++this.analysisSeq;
    if (!body || body.length < 100) {
      this.showEmpty("正文内容不足，无法分析");
      return;
    }

    // 情绪曲线
    if (this.emotionAnalyzer && this.emotionContent) {
      try {
        this.emotionContent.empty();
        this.emotionContent.createDiv({ text: "正在分析情绪..." });
        const curve = await this.emotionAnalyzer.analyze(body);
        if (token !== this.analysisSeq) return;
        this.emotionContent.empty();
        const view = new EmotionCurveView();
        this.emotionContent.innerHTML += view.render(curve);
      } catch (e) {
        if (token !== this.analysisSeq) return;
        this.emotionContent.empty();
        this.emotionContent.createDiv({ cls: "nw-float-error", text: "分析失败" });
      }
    }

    // 节奏分析
    if (this.rhythmAnalyzer && this.rhythmContent) {
      try {
        this.rhythmContent.empty();
        this.rhythmContent.createDiv({ text: "正在分析节奏..." });
        const analysis = await this.rhythmAnalyzer.analyze(body);
        if (token !== this.analysisSeq) return;
        this.rhythmContent.empty();
        for (const seg of analysis.segments.slice(0, 6)) {
          this.rhythmContent.createDiv({
            cls: `nw-float-rhythm-seg ${seg.pace}`,
            text: `${seg.type} · ${seg.pace}`,
          });
        }
        if (analysis.suggestions.length > 0) {
          for (const iss of analysis.suggestions.slice(0, 3)) {
            this.rhythmContent.createDiv({
              cls: "nw-float-rhythm-issue",
              text: `⚠ ${iss}`,
            });
          }
        }
      } catch (e) {
        if (token !== this.analysisSeq) return;
        this.rhythmContent.empty();
        this.rhythmContent.createDiv({ cls: "nw-float-error", text: "分析失败" });
      }
    }
  }

  /**
   * OOC警告
   *
   * @param warnings - 警告
   * @param score - 分数
   */
  showOOCWarnings(warnings: string[], score: number): void {
    if (!this.oocContent) return;
    this.oocContent.empty();
    if (warnings.length === 0) {
      this.oocContent.createDiv({
        cls: "nw-float-ok",
        text: `✅ 一致性 ${score}% · 无OOC`,
      });
      return;
    }
    this.oocContent.createEl("strong", {
      text: `⚠ 一致性 ${score}%`,
      cls: "nw-float-warn-title",
    });
    for (const w of warnings.slice(0, 4)) {
      this.oocContent.createDiv({ cls: "nw-float-warn-item", text: `· ${w}` });
    }
  }

  /**
   * 实体状态变更
   *
   * @param changes - 变更
   */
  showEntityChanges(changes: { entityName: string; newStatus: string }[]): void {
    if (!this.entityContent) return;
    this.entityContent.empty();
    if (!changes || changes.length === 0) {
      this.entityContent.createDiv({
        cls: "nw-float-ok",
        text: "✅ 无实体状态变更",
      });
      return;
    }
    for (const c of changes.slice(0, 5)) {
      const row = this.entityContent.createDiv({ cls: "nw-float-entity-row" });
      row.createSpan({ cls: "nw-float-entity-name", text: c.entityName });
      row.createSpan({ text: " → " });
      row.createSpan({ cls: "nw-float-entity-status", text: c.newStatus });
    }
  }

  private showEmpty(msg: string): void {
    for (const el of [this.rhythmContent, this.emotionContent, this.oocContent, this.entityContent]) {
      if (el) {
        el.empty();
        el.createDiv({ cls: "nw-float-empty", text: msg });
      }
    }
  }
}
