/**
 * monitor-panel-b.ts — v5.5 监控面板B
 * 结局牵引(D4) + 剧情完成度 + 偏离预警 + 章节结算(G1) + 风格自学习(E1) + 偏好记忆(E3)
 */
import { WorkspaceLeaf } from "obsidian";
import NovelWriterPlugin from "../main";
import { DraggablePanel } from "./draggable-panel";
import { EndingTractionEngine } from "../engine/ending-traction-engine";
import { StyleLearner } from "../engine/style-learner";
import { PreferenceMemory } from "../engine/preference-memory";
import {
  PlotCompletionEngine,
  PlotCompletionResult,
  PlotCompletionEngineOptions,
  getScoreColorClass,
  getScoreLabel,
} from "../engine/plot-completion-engine";
import {
  PlotDivergenceEngine,
  DivergenceResult,
  PlotDivergenceEngineOptions,
  getDivergenceLevelColor,
  getDivergenceLevelLabel,
  getDivergenceLevelIcon,
  DivergenceLevel,
} from "../engine/plot-divergence-engine";
import {
  WritingQualityEngine,
  WritingQualityResult,
  WritingQualityEngineOptions,
  QualitySuggestion,
  QualityGrade,
  QualityTrend,
  getQualityGradeColor,
  getQualityGradeLabel,
  getQualityTrendIcon,
  getQualityTrendLabel,
  getPriorityColor,
  getPriorityLabel,
} from "../engine/writing-quality-engine";
import { AdaptiveDebounceManager } from "../shared/adaptive-debounce-manager";
import { CoWriteFacade } from "./services/co-write-facade";
import { createLogger } from '../shared/logger';


const log = createLogger('MonitorPanelB');
export const VIEW_TYPE_MONITOR_B = "nw-float-monitor-b";

interface CompletionHistoryEntry {
  timestamp: number;
  wordCount: number;
  overallScore: number;
  sceneScore: number;
  goalScore: number;
  characterScore: number;
  foreshadowScore: number;
  emotionScore: number;
  tractionScore: number;
}

interface DivergenceHistoryEntry {
  timestamp: number;
  wordCount: number;
  overallDivergence: number;
  mainlineDivergence: number;
  characterDivergence: number;
  rhythmDivergence: number;
  foreshadowDivergence: number;
  settingDivergence: number;
  level: DivergenceLevel;
}

interface QualityHistoryEntry {
  timestamp: number;
  wordCount: number;
  overallScore: number;
  languageScore: number;
  rhythmScore: number;
  characterScore: number;
  plotScore: number;
  atmosphereScore: number;
  structureScore: number;
  grade: QualityGrade;
  trend: QualityTrend;
}

export class MonitorPanelB extends DraggablePanel {
  private tractionEngine: EndingTractionEngine | null = null;
  private styleLearner: StyleLearner | null = null;
  private prefMemory: PreferenceMemory | null = null;
  private completionEngine: PlotCompletionEngine | null = null;
  private divergenceEngine: PlotDivergenceEngine | null = null;
  private qualityEngine: WritingQualityEngine | null = null;
  private debounceManager = new AdaptiveDebounceManager({ debug: false });
  protected facade: CoWriteFacade;

  private tractionContent!: HTMLElement;
  private styleContent!: HTMLElement;
  private prefContent!: HTMLElement;
  private completionContent!: HTMLElement;
  private completionDetailPanel: HTMLElement | null = null;
  private completionExpanded = false;
  private divergenceContent!: HTMLElement;
  private divergenceDetailPanel: HTMLElement | null = null;
  private divergenceExpanded = false;
  private qualityContent!: HTMLElement;
  private qualityDetailPanel: HTMLElement | null = null;
  private qualityExpanded = false;

  private currentChapterText = "";
  private lastResult: PlotCompletionResult | null = null;
  private lastDivergenceResult: DivergenceResult | null = null;
  private lastQualityResult: WritingQualityResult | null = null;
  private history: CompletionHistoryEntry[] = [];
  private divergenceHistory: DivergenceHistoryEntry[] = [];
  private qualityHistory: QualityHistoryEntry[] = [];
  private maxHistory = 50;
  private maxDivergenceHistory = 10;
  private maxQualityHistory = 20;
  private currentChapterKey = "";
  private lastQualityAlertTime = 0;
  private readonly QUALITY_ALERT_COOLDOWN = 10 * 60 * 1000;

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "monitor-b", "监控面板B · 结局/完成度/结算/风格/偏好", "layers");
    this.facade = new CoWriteFacade({ plugin });
  }

  protected renderBody(container: HTMLElement): void {
    container.addClass("nw-float-monitor-grid");

    const tractionCard = container.createDiv({ cls: "nw-float-card" });
    tractionCard.createEl("h5", { text: "🏁 结局牵引(D4)" });
    this.tractionContent = tractionCard.createDiv({ cls: "nw-float-card-body" });
    this.tractionContent.createDiv({ cls: "nw-float-empty", text: "打开章节后分析" });

    const completionCard = container.createDiv({ cls: "nw-float-card nw-completion-card" });
    const completionHeader = completionCard.createDiv({
      cls: "nw-monitor-card-header"
    });
    completionHeader.createEl("h5", { text: "📊 剧情完成度", cls: "nw-m0" });
    const expandBtn = completionHeader.createEl("button", {
      text: "展开",
      cls: "nw-float-btn nw-btn-mini",
    });
    expandBtn.addEventListener("click", () => this.toggleCompletionDetail());
    this.completionContent = completionCard.createDiv({ cls: "nw-float-card-body" });
    this.completionContent.createDiv({ cls: "nw-float-empty", text: "开始写作后自动评估" });

    const styleCard = container.createDiv({ cls: "nw-float-card" });
    styleCard.createEl("h5", { text: "🎨 风格自学习(E1)" });
    this.styleContent = styleCard.createDiv({ cls: "nw-float-card-body" });
    this.styleContent.createDiv({ cls: "nw-float-empty", text: "写作中自动学习" });

    const prefCard = container.createDiv({ cls: "nw-float-card" });
    prefCard.createEl("h5", { text: "💾 偏好记忆(E3)" });
    this.prefContent = prefCard.createDiv({ cls: "nw-float-card-body" });
    this.prefContent.createDiv({ cls: "nw-float-empty", text: "写作中自动记录" });

    const divergenceCard = container.createDiv({ cls: "nw-float-card nw-divergence-card" });
    const divergenceHeader = divergenceCard.createDiv({
      cls: "nw-monitor-card-header"
    });
    divergenceHeader.createEl("h5", { text: "⚠️ 偏离预警", cls: "nw-m0" });
    const divExpandBtn = divergenceHeader.createEl("button", {
      text: "展开",
      cls: "nw-float-btn nw-btn-mini",
    });
    divExpandBtn.addEventListener("click", () => this.toggleDivergenceDetail());
    this.divergenceContent = divergenceCard.createDiv({ cls: "nw-float-card-body" });
    this.divergenceContent.createDiv({ cls: "nw-float-empty", text: "开始写作后自动检测" });

    const qualityCard = container.createDiv({ cls: "nw-float-card nw-quality-card" });
    const qualityHeader = qualityCard.createDiv({
      cls: "nw-monitor-card-header"
    });
    qualityHeader.createEl("h5", { text: "✨ 写作质量", cls: "nw-m0" });
    const qualityExpandBtn = qualityHeader.createEl("button", {
      text: "展开",
      cls: "nw-float-btn nw-btn-mini",
    });
    qualityExpandBtn.addEventListener("click", () => this.toggleQualityDetail());
    this.qualityContent = qualityCard.createDiv({ cls: "nw-float-card-body" });
    this.qualityContent.createDiv({ cls: "nw-float-empty", text: "开始写作后自动评估" });

    const settleCard = container.createDiv({ cls: "nw-float-card" });
    settleCard.createEl("h5", { text: "💰 章节结算(G1)" });
    const settleContent = settleCard.createDiv({ cls: "nw-float-card-body" });
    const settleBtn = settleContent.createEl("button", {
      cls: "nw-float-btn nw-btn-settle",
      text: "📊 执行结算",
    });
    settleBtn.addEventListener("click", () => {
      this.app.commands.executeCommandById('novel-writer-chapter-settlement');
    });

    try {
      this.completionEngine = new PlotCompletionEngine();
      this.divergenceEngine = new PlotDivergenceEngine();
      this.qualityEngine = new WritingQualityEngine();
      const project = this.facade.getActiveProject() || '';
      this.facade.createEndingTractionEngine(project).then(engine => {
        this.tractionEngine = engine;
      }).catch(e => {
        log.warn("[MonitorPanelB] EndingTractionEngine 初始化失败:", e);
      });
      this.facade.getStyleLearner(project).then(learner => {
        if (learner) {
          this.styleLearner = learner;
        }
      }).catch(e => {
        log.warn("[MonitorPanelB] StyleLearner 初始化失败:", e);
      });
      this.prefMemory = new PreferenceMemory({
        app: this.app,
        plugin: this.plugin,
        project,
      });
    } catch (e) {
      log.warn("[MonitorPanelB] 引擎初始化失败:", e);
    }
  }

  /** 实时更新剧情完成度和偏离检测（带防抖） */
  updateCompletion(text: string, chapterKey?: string): void {
    if (!this.completionEngine || !this.completionContent) return;

    if (chapterKey && chapterKey !== this.currentChapterKey) {
      this.currentChapterKey = chapterKey;
      this.history = [];
      this.lastResult = null;
      this.divergenceHistory = [];
      this.lastDivergenceResult = null;
      this.qualityHistory = [];
      this.lastQualityResult = null;
      if (this.divergenceEngine) {
        this.divergenceEngine.clearHistory();
      }
      if (this.qualityEngine) {
        this.qualityEngine.clearHistory();
      }
    }

    this.currentChapterText = text;

    this.debounceManager.debounceFixed('completion-eval', () => {
      this.runCompletionEval();
      this.runDivergenceEval();
      this.runQualityEval();
    }, 500);
  }

  /** 执行完成度评估 */
  private runCompletionEval(): void {
    if (!this.completionEngine || !this.completionContent) return;

    try {
      const result = this.completionEngine.evaluate(this.currentChapterText);
      this.lastResult = result;

      this.addToHistory(result);
      this.renderCompletionSummary(result);

      if (this.completionExpanded && this.completionDetailPanel) {
        this.renderCompletionDetail(result);
      }
    } catch (e) {
      log.warn("[MonitorPanelB] 剧情完成度评估失败:", e);
    }
  }

  /** 执行偏离检测 */
  private runDivergenceEval(): void {
    if (!this.divergenceEngine || !this.divergenceContent) return;

    try {
      const result = this.divergenceEngine.evaluate(this.currentChapterText);
      this.lastDivergenceResult = result;

      this.addToDivergenceHistory(result);
      this.renderDivergenceSummary(result);

      if (this.divergenceExpanded && this.divergenceDetailPanel) {
        this.renderDivergenceDetail(result);
      }

      if (result.shouldAlert && result.alertReason) {
        this.showDivergenceAlert(result.alertReason);
      }
    } catch (e) {
      log.warn("[MonitorPanelB] 剧情偏离检测失败:", e);
    }
  }

  /** 添加偏离历史记录 */
  private addToDivergenceHistory(result: DivergenceResult): void {
    const entry: DivergenceHistoryEntry = {
      timestamp: result.evaluatedAt,
      wordCount: result.wordCount,
      overallDivergence: result.overallDivergence,
      mainlineDivergence: result.mainlineDivergence.score,
      characterDivergence: result.characterDivergence.score,
      rhythmDivergence: result.rhythmDivergence.score,
      foreshadowDivergence: result.foreshadowDivergence.score,
      settingDivergence: result.settingDivergence.score,
      level: result.overallLevel,
    };

    this.divergenceHistory.push(entry);
    if (this.divergenceHistory.length > this.maxDivergenceHistory) {
      this.divergenceHistory = this.divergenceHistory.slice(-this.maxDivergenceHistory);
    }
  }

  /** 渲染偏离摘要 */
  private renderDivergenceSummary(result: DivergenceResult): void {
    if (!this.divergenceContent) return;

    this.divergenceContent.empty();

    const overallDivergence = result.overallDivergence;
    const level = result.overallLevel;
    const icon = getDivergenceLevelIcon(level);
    const label = getDivergenceLevelLabel(level);

    const overallRow = this.divergenceContent.createDiv({
      cls: "nw-overall-row"
    });
    overallRow.createSpan({
      text: "整体偏离度",
      cls: "nw-text-sm-secondary"
    });
    overallRow.createSpan({
      attr: {
        style: `font-weight:600;font-size:16px;color:${getDivergenceLevelColor(level)};`
      },
      text: `${icon} ${overallDivergence}% · ${label}`
    });

    const progressBar = this.divergenceContent.createDiv({
      attr: {
        style: "height:8px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:4px;overflow:hidden;margin-bottom:10px;"
      }
    });
    progressBar.createDiv({
      attr: {
        style: `height:100%;width:${overallDivergence}%;background:${getDivergenceLevelColor(level)};border-radius:4px;transition:width 0.3s ease;`
      }
    });

    const dimensions = [
      { key: 'mainline', label: '主线', score: result.mainlineDivergence.score, icon: '🧭' },
      { key: 'character', label: '角色', score: result.characterDivergence.score, icon: '👤' },
      { key: 'rhythm', label: '节奏', score: result.rhythmDivergence.score, icon: '🎵' },
      { key: 'foreshadow', label: '伏笔', score: result.foreshadowDivergence.score, icon: '🔮' },
      { key: 'setting', label: '设定', score: result.settingDivergence.score, icon: '🌍' },
    ];

    for (const dim of dimensions) {
      const row = this.divergenceContent.createDiv({
        attr: { style: "display:flex;align-items:center;gap:6px;margin:3px 0;" }
      });
      row.createSpan({ text: dim.icon, attr: { style: "font-size:12px;min-width:18px;" } });
      row.createSpan({
        text: dim.label,
        attr: { style: "font-size:11px;color:var(--nw-text-muted, var(--text-muted));min-width:40px;" }
      });
      const miniBar = row.createDiv({
        attr: {
          style: "flex:1;height:6px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:3px;overflow:hidden;"
        }
      });
      const dimLevel = this.getDivergenceLevelFromScore(dim.score);
      miniBar.createDiv({
        attr: {
          style: `height:100%;width:${dim.score}%;background:${getDivergenceLevelColor(dimLevel)};border-radius:3px;`
        }
      });
      row.createSpan({
        attr: { style: `font-size:11px;min-width:30px;text-align:right;color:${getDivergenceLevelColor(dimLevel)};` },
        text: `${dim.score}%`
      });
    }

    const allIssues = [
      ...result.mainlineDivergence.issues,
      ...result.characterDivergence.issues,
      ...result.rhythmDivergence.issues,
      ...result.foreshadowDivergence.issues,
      ...result.settingDivergence.issues,
    ];

    if (allIssues.length > 0) {
      const issueRow = this.divergenceContent.createDiv({
        attr: { style: "margin-top:8px;padding-top:6px;border-top:1px dashed var(--nw-divider, var(--background-modifier-border-hover));" }
      });
      issueRow.createDiv({
        text: `🚨 ${allIssues.length}个问题`,
        attr: { style: "font-size:11px;font-weight:600;color:var(--nw-danger, #ef4444);margin-bottom:4px;" }
      });
      for (const issue of allIssues.slice(0, 2)) {
        issueRow.createDiv({
          text: `• ${issue}`,
          attr: { style: "font-size:10px;color:var(--nw-text-secondary, var(--text-muted));margin:2px 0;line-height:1.4;" }
        });
      }
    }

    const metaRow = this.divergenceContent.createDiv({
      attr: { style: "display:flex;gap:10px;margin-top:6px;font-size:10px;color:var(--nw-text-muted, var(--text-muted));" }
    });
    metaRow.createSpan({ text: `${result.wordCount}字` });
  }

  /** 切换偏离详情面板 */
  private toggleDivergenceDetail(): void {
    this.divergenceExpanded = !this.divergenceExpanded;

    if (this.divergenceExpanded) {
      this.showDivergenceDetail();
    } else {
      this.hideDivergenceDetail();
    }
  }

  /** 显示偏离详情面板 */
  private showDivergenceDetail(): void {
    if (!this.divergenceContent) return;

    this.divergenceDetailPanel = this.divergenceContent.createDiv({
      cls: "nw-divergence-detail",
      attr: {
        style: "margin-top:10px;padding-top:10px;border-top:1px solid var(--nw-divider, var(--background-modifier-border-hover));"
      }
    });

    if (this.lastDivergenceResult) {
      this.renderDivergenceDetail(this.lastDivergenceResult);
    }
  }

  /** 隐藏偏离详情面板 */
  private hideDivergenceDetail(): void {
    if (this.divergenceDetailPanel) {
      this.divergenceDetailPanel.remove();
      this.divergenceDetailPanel = null;
    }
  }

  /** 渲染偏离详情 */
  private renderDivergenceDetail(result: DivergenceResult): void {
    if (!this.divergenceDetailPanel) return;

    this.divergenceDetailPanel.empty();

    const sections: Array<{ label: string; dim: typeof result.mainlineDivergence; icon: string }> = [
      { label: '🧭 主线偏离', dim: result.mainlineDivergence, icon: '🧭' },
      { label: '👤 角色偏离', dim: result.characterDivergence, icon: '👤' },
      { label: '🎵 节奏偏离', dim: result.rhythmDivergence, icon: '🎵' },
      { label: '🔮 伏笔偏离', dim: result.foreshadowDivergence, icon: '🔮' },
      { label: '🌍 设定偏离', dim: result.settingDivergence, icon: '🌍' },
    ];

    for (const section of sections) {
      const secDiv = this.divergenceDetailPanel.createDiv({
        attr: { style: "margin-bottom:10px;" }
      });

      const secHeader = secDiv.createDiv({
        attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;" }
      });
      secHeader.createSpan({
        text: section.label,
        cls: "nw-section-label"
      });
      secHeader.createSpan({
        attr: { style: `font-size:11px;font-weight:600;color:${getDivergenceLevelColor(section.dim.level)};` },
        text: `${section.dim.score}% · ${getDivergenceLevelLabel(section.dim.level)}`
      });

      const detailsRow = secDiv.createDiv({
        attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-muted));margin-bottom:4px;line-height:1.6;" }
      });
      const detailStr = Object.entries(section.dim.details)
        .map(([k, v]) => `${this.formatDivergenceDetailKey(k)}: ${v}`)
        .join(' · ');
      detailsRow.setText(detailStr);

      if (section.dim.issues.length > 0) {
        const issueList = secDiv.createDiv({
          attr: { style: "font-size:10px;margin-bottom:4px;" }
        });
        for (const issue of section.dim.issues) {
          const issueRow = issueList.createDiv({
            attr: { style: "display:flex;align-items:flex-start;gap:4px;margin:2px 0;" }
          });
          issueRow.createSpan({
            text: "⚠️",
            cls: "nw-suggestion-list"
          });
          issueRow.createSpan({
            text: issue,
            attr: { style: "color:var(--nw-danger, #ef4444);line-height:1.4;" }
          });
        }
      }

      if (section.dim.suggestions.length > 0) {
        const sugList = secDiv.createDiv({
          cls: "nw-suggestion-list"
        });
        for (const sug of section.dim.suggestions.slice(0, 2)) {
          sugList.createDiv({
            text: `💡 ${sug}`,
            attr: { style: "color:var(--nw-text-secondary, var(--text-muted));margin:2px 0;line-height:1.4;" }
          });
        }
      }
    }

    if (this.divergenceHistory.length >= 2) {
      const historySection = this.divergenceDetailPanel.createDiv({
        cls: "nw-dashed-sep"
      });
      historySection.createDiv({
        text: "📈 偏离趋势（最近10次）",
        cls: "nw-section-title-sm"
      });

      this.renderDivergenceHistoryChart(historySection);

      const historyList = historySection.createDiv({
        attr: { style: "margin-top:6px;" }
      });
      const recentHistory = [...this.divergenceHistory].reverse().slice(0, 5);
      for (let i = 0; i < recentHistory.length; i++) {
        const entry = recentHistory[i];
        const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const icon = getDivergenceLevelIcon(entry.level);
        historyList.createDiv({
          text: `${icon} ${timeStr} · ${entry.overallDivergence}% · ${entry.wordCount}字`,
          attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-muted));margin:2px 0;" }
        });
      }
    }
  }

  /** 渲染偏离历史曲线图 */
  private renderDivergenceHistoryChart(container: HTMLElement): void {
    const chartH = 50;
    const chartW = 260;
    const padding = 4;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", chartW.toString());
    svg.setAttribute("height", chartH.toString());
    svg.setAttribute("viewBox", `0 0 ${chartW} ${chartH}`);
    svg.style.display = "block";

    const scores = this.divergenceHistory.map(h => h.overallDivergence);
    const minScore = Math.max(0, Math.min(...scores) - 10);
    const maxScore = Math.min(100, Math.max(...scores) + 10);
    const scoreRange = Math.max(1, maxScore - minScore);

    const points: string[] = [];
    const stepX = (chartW - padding * 2) / Math.max(1, scores.length - 1);

    scores.forEach((score, i) => {
      const x = padding + i * stepX;
      const y = chartH - padding - ((score - minScore) / scoreRange) * (chartH - padding * 2);
      points.push(`${x},${y}`);
    });

    const polyline = document.createElementNS(svgNS, "polyline");
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "var(--nw-danger, #ef4444)");
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    if (points.length > 0) {
      const lastPoint = points[points.length - 1].split(",");
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", lastPoint[0]);
      circle.setAttribute("cy", lastPoint[1]);
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "var(--nw-danger, #ef4444)");
      svg.appendChild(circle);
    }

    container.appendChild(svg);
  }

  /** 显示偏离预警提示 */
  private showDivergenceAlert(reason: string): void {
    if (!this.plugin) return;
    try {
      const notice = (this.app as any).notice?.addNotice?.(`⚠️ 剧情偏离预警：${reason}`, 5000);
      if (!notice) {
        log.warn('[MonitorPanelB] 偏离预警:', reason);
      }
    } catch (e) {
      log.warn('[MonitorPanelB] 显示预警失败:', reason, e);
    }
  }

  private getDivergenceLevelFromScore(score: number): DivergenceLevel {
    if (score >= 60) return 'danger';
    if (score >= 30) return 'warning';
    return 'normal';
  }

  private formatDivergenceDetailKey(key: string): string {
    const labels: Record<string, string> = {
      outlineMatched: '大纲匹配',
      outlineTotal: '大纲总数',
      outlineMatchRate: '大纲匹配率',
      mainlineMatched: '主线匹配',
      mainlineCoverage: '主线覆盖率',
      conflictIndicators: '冲突信号',
      charactersAnalyzed: '分析角色数',
      avgConsistency: '平均一致性',
      avgSentenceLen: '平均句长',
      actionDensity: '动作密度',
      dialogueRatio: '对话占比',
      descriptionDensity: '描写密度',
      actualPace: '实际节奏',
      expectedPace: '预期节奏',
      sceneShifts: '场景切换',
      recoverySignals: '回收信号',
      plantSignals: '埋设信号',
      toRecover: '待回收',
      recovered: '已回收',
      activeForeshadows: '活跃伏笔',
      mentionedActive: '提及活跃',
      detectedSettings: '检测到设定',
      settingCoverage: '设定覆盖率',
      settingMatched: '设定匹配',
      note: '备注',
    };
    return labels[key] || key;
  }

  /** 添加历史记录 */
  private addToHistory(result: PlotCompletionResult): void {
    const entry: CompletionHistoryEntry = {
      timestamp: result.evaluatedAt,
      wordCount: result.wordCount,
      overallScore: result.overallCompletion.score,
      sceneScore: result.sceneCompletion.score,
      goalScore: result.goalCompletion.score,
      characterScore: result.characterEngagement.score,
      foreshadowScore: result.foreshadowProgress.score,
      emotionScore: result.emotionArcProgress.score,
      tractionScore: result.plotTraction.score,
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /** 渲染完成度摘要 */
  private renderCompletionSummary(result: PlotCompletionResult): void {
    if (!this.completionContent) return;

    this.completionContent.empty();

    const overallScore = result.overallCompletion.score;
    const colorCls = getScoreColorClass(overallScore);
    const label = getScoreLabel(overallScore);

    const overallRow = this.completionContent.createDiv({
      cls: "nw-overall-row"
    });
    overallRow.createSpan({
      text: "综合完成度",
      cls: "nw-text-sm-secondary"
    });
    overallRow.createSpan({
      cls: colorCls,
      attr: { style: "font-weight:600;font-size:16px;" },
      text: `${overallScore}分 · ${label}`
    });

    const progressBar = this.completionContent.createDiv({
      attr: {
        style: "height:8px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:4px;overflow:hidden;margin-bottom:10px;"
      }
    });
    const progressFill = progressBar.createDiv({
      attr: {
        style: `height:100%;width:${overallScore}%;background:${this.getScoreColor(overallScore)};border-radius:4px;transition:width 0.3s ease;`
      }
    });
    void progressFill;

    const dimensions = [
      { key: 'scene', label: '场景', score: result.sceneCompletion.score, icon: '🏔️' },
      { key: 'goal', label: '目标', score: result.goalCompletion.score, icon: '🎯' },
      { key: 'character', label: '人物', score: result.characterEngagement.score, icon: '👤' },
      { key: 'foreshadow', label: '伏笔', score: result.foreshadowProgress.score, icon: '🔮' },
      { key: 'emotion', label: '情绪弧', score: result.emotionArcProgress.score, icon: '💭' },
      { key: 'traction', label: '牵引', score: result.plotTraction.score, icon: '🧭' },
    ];

    for (const dim of dimensions) {
      const row = this.completionContent.createDiv({
        attr: { style: "display:flex;align-items:center;gap:6px;margin:3px 0;" }
      });
      row.createSpan({ text: dim.icon, attr: { style: "font-size:12px;min-width:18px;" } });
      row.createSpan({
        text: dim.label,
        attr: { style: "font-size:11px;color:var(--nw-text-muted, var(--text-muted));min-width:40px;" }
      });
      const miniBar = row.createDiv({
        attr: {
          style: "flex:1;height:6px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:3px;overflow:hidden;"
        }
      });
      miniBar.createDiv({
        attr: {
          style: `height:100%;width:${dim.score}%;background:${this.getScoreColor(dim.score)};border-radius:3px;`
        }
      });
      row.createSpan({
        cls: getScoreColorClass(dim.score),
        attr: { style: "font-size:11px;min-width:30px;text-align:right;" },
        text: `${dim.score}分`
      });
    }

    const metaRow = this.completionContent.createDiv({
      attr: { style: "display:flex;gap:10px;margin-top:8px;font-size:10px;color:var(--nw-text-muted, var(--text-muted));" }
    });
    metaRow.createSpan({ text: `${result.wordCount}字` });
    metaRow.createSpan({ text: `${result.overallCompletion.details.paragraphs || 0}段` });
    metaRow.createSpan({ text: `${Math.round(result.overallCompletion.details.evalTimeMs as number || 0)}ms` });
  }

  /** 切换详情面板 */
  private toggleCompletionDetail(): void {
    this.completionExpanded = !this.completionExpanded;

    if (this.completionExpanded) {
      this.showCompletionDetail();
    } else {
      this.hideCompletionDetail();
    }
  }

  /** 显示详情面板 */
  private showCompletionDetail(): void {
    if (!this.completionContent) return;

    this.completionDetailPanel = this.completionContent.createDiv({
      cls: "nw-completion-detail",
      attr: {
        style: "margin-top:10px;padding-top:10px;border-top:1px solid var(--nw-divider, var(--background-modifier-border-hover));"
      }
    });

    if (this.lastResult) {
      this.renderCompletionDetail(this.lastResult);
    }
  }

  /** 隐藏详情面板 */
  private hideCompletionDetail(): void {
    if (this.completionDetailPanel) {
      this.completionDetailPanel.remove();
      this.completionDetailPanel = null;
    }
  }

  /** 渲染完成度详情 */
  private renderCompletionDetail(result: PlotCompletionResult): void {
    if (!this.completionDetailPanel) return;

    this.completionDetailPanel.empty();

    const sections: Array<{ label: string; dim: typeof result.sceneCompletion; icon: string }> = [
      { label: '🏔️ 场景完成度', dim: result.sceneCompletion, icon: '🏔️' },
      { label: '🎯 目标完成度', dim: result.goalCompletion, icon: '🎯' },
      { label: '👤 人物参与度', dim: result.characterEngagement, icon: '👤' },
      { label: '🔮 伏笔进度', dim: result.foreshadowProgress, icon: '🔮' },
      { label: '💭 情绪弧进度', dim: result.emotionArcProgress, icon: '💭' },
      { label: '🧭 情节牵引', dim: result.plotTraction, icon: '🧭' },
    ];

    for (const section of sections) {
      const secDiv = this.completionDetailPanel.createDiv({
        attr: { style: "margin-bottom:8px;" }
      });

      const secHeader = secDiv.createDiv({
        attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;" }
      });
      secHeader.createSpan({
        text: section.label,
        cls: "nw-section-label"
      });
      secHeader.createSpan({
        cls: getScoreColorClass(section.dim.score),
        attr: { style: "font-size:11px;font-weight:600;" },
        text: `${section.dim.score}分 · ${getScoreLabel(section.dim.score)}`
      });

      const detailsRow = secDiv.createDiv({
        attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-muted));margin-bottom:4px;line-height:1.6;" }
      });
      const detailStr = Object.entries(section.dim.details)
        .map(([k, v]) => `${this.formatDetailKey(k)}: ${v}`)
        .join(' · ');
      detailsRow.setText(detailStr);

      if (section.dim.suggestions.length > 0) {
        const sugList = secDiv.createDiv({
          cls: "nw-suggestion-list"
        });
        for (const sug of section.dim.suggestions.slice(0, 2)) {
          sugList.createDiv({
            text: `💡 ${sug}`,
            attr: { style: "color:var(--nw-text-secondary, var(--text-muted));margin:2px 0;" }
          });
        }
      }
    }

    if (this.history.length >= 2) {
      const historySection = this.completionDetailPanel.createDiv({
        cls: "nw-dashed-sep"
      });
      historySection.createDiv({
        text: "📈 写作进度曲线",
        cls: "nw-section-title-sm"
      });

      this.renderHistoryChart(historySection);
    }
  }

  /** 渲染简易历史曲线图 */
  private renderHistoryChart(container: HTMLElement): void {
    const chartH = 60;
    const chartW = 280;
    const padding = 4;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", chartW.toString());
    svg.setAttribute("height", chartH.toString());
    svg.setAttribute("viewBox", `0 0 ${chartW} ${chartH}`);
    svg.style.display = "block";

    const scores = this.history.map(h => h.overallScore);
    const minScore = Math.max(0, Math.min(...scores) - 10);
    const maxScore = Math.min(100, Math.max(...scores) + 10);
    const scoreRange = Math.max(1, maxScore - minScore);

    const points: string[] = [];
    const stepX = (chartW - padding * 2) / Math.max(1, scores.length - 1);

    scores.forEach((score, i) => {
      const x = padding + i * stepX;
      const y = chartH - padding - ((score - minScore) / scoreRange) * (chartH - padding * 2);
      points.push(`${x},${y}`);
    });

    const polyline = document.createElementNS(svgNS, "polyline");
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "var(--nw-accent, var(--interactive-accent))");
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    if (points.length > 0) {
      const lastPoint = points[points.length - 1].split(",");
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", lastPoint[0]);
      circle.setAttribute("cy", lastPoint[1]);
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "var(--nw-accent, var(--interactive-accent))");
      svg.appendChild(circle);
    }

    container.appendChild(svg);

    const historyMeta = container.createDiv({
      attr: { style: "display:flex;justify-content:space-between;font-size:10px;color:var(--nw-text-muted, var(--text-muted));margin-top:4px;" }
    });
    historyMeta.createSpan({ text: `起点: ${scores[0]}分` });
    historyMeta.createSpan({ text: `当前: ${scores[scores.length - 1]}分` });
    historyMeta.createSpan({ text: `Δ${scores[scores.length - 1] - scores[0] >= 0 ? '+' : ''}${scores[scores.length - 1] - scores[0]}` });
  }

  private formatDetailKey(key: string): string {
    const labels: Record<string, string> = {
      locationMentions: '地点',
      timeMentions: '时间',
      envMentions: '环境',
      atmosphereMentions: '氛围',
      goalIndicators: '目标信号',
      obstacleIndicators: '阻碍信号',
      resultIndicators: '结果信号',
      outlineMatchRate: '大纲匹配',
      characterMentions: '角色提及',
      dialogRatio: '对话占比',
      actionDensity: '动作密度',
      uniqueCharacters: '角色数',
      detectedForeshadows: '埋设信号',
      detectedReveals: '回收信号',
      arcCompleteness: '弧完整度',
      intensity: '情绪强度',
      emotionShifts: '情绪起伏',
      mainlineKeywordMatches: '主线匹配',
      conflictIndicators: '冲突信号',
      forwardIndicators: '前瞻信号',
      wordCount: '字数',
      paragraphs: '段落',
      sentences: '句子',
      evalTimeMs: '耗时',
    };
    return labels[key] || key;
  }

  private getScoreColor(score: number): string {
    if (score >= 70) return 'var(--nw-success, #22c55e)';
    if (score >= 40) return 'var(--nw-warning, #f59e0b)';
    return 'var(--nw-danger, #ef4444)';
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

  /** 更新引擎选项 */
  setCompletionOptions(options: Partial<PlotCompletionEngineOptions>): void {
    if (this.completionEngine) {
      this.completionEngine.updateOptions(options);
    }
  }

  /** 获取最新评估结果 */
  getLastResult(): PlotCompletionResult | null {
    return this.lastResult;
  }

  /** 获取历史记录 */
  getHistory(): CompletionHistoryEntry[] {
    return [...this.history];
  }

  /** 更新偏离引擎选项 */
  setDivergenceOptions(options: Partial<PlotDivergenceEngineOptions>): void {
    if (this.divergenceEngine) {
      this.divergenceEngine.updateOptions(options);
    }
  }

  /** 获取最新偏离检测结果 */
  getLastDivergenceResult(): DivergenceResult | null {
    return this.lastDivergenceResult;
  }

  /** 获取偏离历史记录 */
  getDivergenceHistory(): DivergenceHistoryEntry[] {
    return [...this.divergenceHistory];
  }

  /** 忽略当前偏离问题 */
  ignoreDivergenceIssue(issueKey: string): void {
    if (this.divergenceEngine) {
      this.divergenceEngine.ignoreIssue(issueKey);
      if (this.lastDivergenceResult) {
        this.runDivergenceEval();
      }
    }
  }

  /** 执行质量评估 */
  private runQualityEval(): void {
    if (!this.qualityEngine || !this.qualityContent) return;

    try {
      const result = this.qualityEngine.evaluate(this.currentChapterText);
      this.lastQualityResult = result;

      this.addToQualityHistory(result);
      this.renderQualitySummary(result);

      if (this.qualityExpanded && this.qualityDetailPanel) {
        this.renderQualityDetail(result);
      }

      if (result.milestoneReached) {
        this.showMilestoneNotice(result.milestoneReached, result.overallScore);
      }

      if (result.overallScore < 50 && result.wordCount > 500) {
        this.checkQualityAlert(result);
      }
    } catch (e) {
      log.warn("[MonitorPanelB] 写作质量评估失败:", e);
    }
  }

  /** 添加质量历史记录 */
  private addToQualityHistory(result: WritingQualityResult): void {
    const entry: QualityHistoryEntry = {
      timestamp: result.evaluatedAt,
      wordCount: result.wordCount,
      overallScore: result.overallScore,
      languageScore: result.languageQuality.score,
      rhythmScore: result.rhythmQuality.score,
      characterScore: result.characterQuality.score,
      plotScore: result.plotQuality.score,
      atmosphereScore: result.atmosphereQuality.score,
      structureScore: result.structureQuality.score,
      grade: result.grade,
      trend: result.trend,
    };

    this.qualityHistory.push(entry);
    if (this.qualityHistory.length > this.maxQualityHistory) {
      this.qualityHistory = this.qualityHistory.slice(-this.maxQualityHistory);
    }
  }

  /** 渲染质量摘要 */
  private renderQualitySummary(result: WritingQualityResult): void {
    if (!this.qualityContent) return;

    this.qualityContent.empty();

    const overallScore = result.overallScore;
    const grade = result.grade;
    const gradeColor = getQualityGradeColor(grade);
    const gradeLabel = getQualityGradeLabel(grade);
    const trendIcon = getQualityTrendIcon(result.trend);
    const trendLabel = getQualityTrendLabel(result.trend);

    const scoreRow = this.qualityContent.createDiv({
      attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;" }
    });
    scoreRow.createSpan({
      text: "综合质量",
      cls: "nw-text-sm-secondary"
    });
    const scoreValue = scoreRow.createSpan({
      attr: { style: `font-weight:700;font-size:20px;color:${gradeColor};` }
    });
    scoreValue.createSpan({ text: `${overallScore}` });
    scoreValue.createSpan({ text: ` ${grade}`, attr: { style: "font-size:14px;" } });

    const gradeRow = this.qualityContent.createDiv({
      cls: "nw-overall-row"
    });
    gradeRow.createSpan({
      text: `${trendIcon} ${trendLabel}`,
      attr: { style: "font-size:11px;color:var(--nw-text-muted, var(--text-faint));" }
    });
    gradeRow.createSpan({
      text: gradeLabel,
      attr: { style: `font-size:11px;font-weight:600;color:${gradeColor};` }
    });

    const progressBar = this.qualityContent.createDiv({
      attr: {
        style: "height:10px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:5px;overflow:hidden;margin-bottom:10px;"
      }
    });
    progressBar.createDiv({
      attr: {
        style: `height:100%;width:${overallScore}%;background:${gradeColor};border-radius:5px;transition:width 0.3s ease;`
      }
    });

    const dimensions = [
      { key: 'language', label: '语言', score: result.languageQuality.score, icon: '📝' },
      { key: 'rhythm', label: '节奏', score: result.rhythmQuality.score, icon: '🎵' },
      { key: 'character', label: '人物', score: result.characterQuality.score, icon: '👤' },
      { key: 'plot', label: '情节', score: result.plotQuality.score, icon: '📖' },
      { key: 'atmosphere', label: '氛围', score: result.atmosphereQuality.score, icon: '🌫️' },
      { key: 'structure', label: '结构', score: result.structureQuality.score, icon: '🏗️' },
    ];

    for (const dim of dimensions) {
      const row = this.qualityContent.createDiv({
        attr: { style: "display:flex;align-items:center;gap:6px;margin:2px 0;" }
      });
      row.createSpan({ text: dim.icon, attr: { style: "font-size:11px;min-width:16px;" } });
      row.createSpan({
        text: dim.label,
        attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-faint));min-width:32px;" }
      });
      const miniBar = row.createDiv({
        attr: {
          style: "flex:1;height:5px;background:var(--nw-bg-muted, var(--background-modifier-cover));border-radius:3px;overflow:hidden;"
        }
      });
      miniBar.createDiv({
        attr: {
          style: `height:100%;width:${dim.score}%;background:${this.getQualityScoreColor(dim.score)};border-radius:3px;`
        }
      });
      row.createSpan({
        attr: { style: "font-size:10px;min-width:28px;text-align:right;color:var(--nw-text-secondary, var(--text-muted));" },
        text: `${dim.score}分`
      });
    }

    if (result.topSuggestions.length > 0) {
      const sugSection = this.qualityContent.createDiv({
        attr: { style: "margin-top:8px;padding-top:6px;border-top:1px dashed var(--nw-divider, var(--background-modifier-border-hover));" }
      });
      sugSection.createDiv({
        text: `💡 Top 3 改进建议`,
        attr: { style: "font-size:11px;font-weight:600;color:var(--nw-text-secondary, var(--text-muted));margin-bottom:4px;" }
      });
      for (const sug of result.topSuggestions.slice(0, 3)) {
        const sugRow = sugSection.createDiv({
          attr: { style: "display:flex;align-items:flex-start;gap:4px;margin:3px 0;" }
        });
        sugRow.createSpan({
          text: sug.priority === 'high' ? '🔴' : sug.priority === 'medium' ? '🟡' : '🟢',
          attr: { style: "font-size:9px;flex-shrink:0;margin-top:1px;" }
        });
        sugRow.createSpan({
          text: sug.content,
          attr: { style: "font-size:10px;color:var(--nw-text-secondary, var(--text-muted));line-height:1.4;flex:1;" }
        });
      }
    }

    const metaRow = this.qualityContent.createDiv({
      attr: { style: "display:flex;gap:8px;margin-top:6px;font-size:10px;color:var(--nw-text-muted, var(--text-faint));" }
    });
    metaRow.createSpan({ text: `${result.wordCount}字` });
    metaRow.createSpan({ text: `${result.evalTimeMs}ms` });
    if (result.comparedToAverage !== 0) {
      const diffText = result.comparedToAverage > 0 ? `+${result.comparedToAverage}` : result.comparedToAverage;
      metaRow.createSpan({
        text: `均${diffText}`,
        attr: { style: `color:${result.comparedToAverage > 0 ? 'var(--nw-success, #22c55e)' : 'var(--nw-danger, #ef4444)'};` }
      });
    }
  }

  /** 切换质量详情面板 */
  private toggleQualityDetail(): void {
    this.qualityExpanded = !this.qualityExpanded;

    if (this.qualityExpanded) {
      this.showQualityDetail();
    } else {
      this.hideQualityDetail();
    }
  }

  /** 显示质量详情面板 */
  private showQualityDetail(): void {
    if (!this.qualityContent) return;

    this.qualityDetailPanel = this.qualityContent.createDiv({
      cls: "nw-quality-detail",
      attr: {
        style: "margin-top:10px;padding-top:10px;border-top:1px solid var(--nw-divider, var(--background-modifier-border-hover));"
      }
    });

    if (this.lastQualityResult) {
      this.renderQualityDetail(this.lastQualityResult);
    }
  }

  /** 隐藏质量详情面板 */
  private hideQualityDetail(): void {
    if (this.qualityDetailPanel) {
      this.qualityDetailPanel.remove();
      this.qualityDetailPanel = null;
    }
  }

  /** 渲染质量详情 */
  private renderQualityDetail(result: WritingQualityResult): void {
    if (!this.qualityDetailPanel) return;

    this.qualityDetailPanel.empty();

    const sections: Array<{ label: string; dim: typeof result.languageQuality; icon: string; key: string }> = [
      { label: '📝 语言质量', dim: result.languageQuality, icon: '📝', key: 'language' },
      { label: '🎵 节奏质量', dim: result.rhythmQuality, icon: '🎵', key: 'rhythm' },
      { label: '👤 人物质量', dim: result.characterQuality, icon: '👤', key: 'character' },
      { label: '📖 情节质量', dim: result.plotQuality, icon: '📖', key: 'plot' },
      { label: '🌫️ 氛围质量', dim: result.atmosphereQuality, icon: '🌫️', key: 'atmosphere' },
      { label: '🏗️ 结构质量', dim: result.structureQuality, icon: '🏗️', key: 'structure' },
    ];

    for (const section of sections) {
      const secDiv = this.qualityDetailPanel.createDiv({
        attr: { style: "margin-bottom:8px;" }
      });

      const secHeader = secDiv.createDiv({
        attr: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;" }
      });
      secHeader.createSpan({
        text: section.label,
        cls: "nw-section-label"
      });
      secHeader.createSpan({
        attr: { style: `font-size:11px;font-weight:600;color:${this.getQualityScoreColor(section.dim.score)};` },
        text: `${section.dim.score}分`
      });

      const detailsRow = secDiv.createDiv({
        attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-faint));margin-bottom:3px;line-height:1.6;" }
      });
      const detailStr = Object.entries(section.dim.details)
        .map(([k, v]) => `${this.formatQualityDetailKey(k)}: ${v}`)
        .join(' · ');
      detailsRow.setText(detailStr);

      if (section.dim.suggestions.length > 0) {
        const sugList = secDiv.createDiv({
          cls: "nw-suggestion-list"
        });
        for (const sug of section.dim.suggestions.slice(0, 2)) {
          const sugRow = sugList.createDiv({
            attr: { style: "display:flex;align-items:flex-start;gap:4px;margin:2px 0;" }
          });
          sugRow.createSpan({
            text: "💡",
            attr: { style: "font-size:9px;" }
          });
          sugRow.createSpan({
            text: sug.content,
            attr: { style: "color:var(--nw-text-secondary, var(--text-muted));line-height:1.4;flex:1;" }
          });
        }
      }
    }

    if (this.qualityHistory.length >= 3) {
      const historySection = this.qualityDetailPanel.createDiv({
        cls: "nw-dashed-sep"
      });
      historySection.createDiv({
        text: "📈 质量趋势（最近10次）",
        cls: "nw-section-title-sm"
      });

      this.renderQualityHistoryChart(historySection);

      const historyList = historySection.createDiv({
        attr: { style: "margin-top:6px;" }
      });
      const recentHistory = [...this.qualityHistory].reverse().slice(0, 5);
      for (let i = 0; i < recentHistory.length; i++) {
        const entry = recentHistory[i];
        const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        historyList.createDiv({
          text: `${getQualityTrendIcon(entry.trend)} ${timeStr} · ${entry.overallScore}分 · ${entry.grade} · ${entry.wordCount}字`,
          attr: { style: "font-size:10px;color:var(--nw-text-muted, var(--text-faint));margin:2px 0;" }
        });
      }
    }

    const allSuggestions = this.collectAllSuggestions(result);
    if (allSuggestions.length > 3) {
      const allSugSection = this.qualityDetailPanel.createDiv({
        cls: "nw-dashed-sep"
      });
      allSugSection.createDiv({
        text: "📋 全部改进建议",
        cls: "nw-section-title-sm"
      });
      for (const sug of allSuggestions) {
        const sugRow = allSugSection.createDiv({
          attr: { style: "display:flex;align-items:flex-start;gap:6px;margin:4px 0;padding:4px 6px;border-radius:4px;background:var(--nw-bg-muted, var(--background-modifier-cover));" }
        });
        const priorityBadge = sugRow.createSpan({
          attr: {
            style: `font-size:9px;padding:1px 4px;border-radius:3px;color:white;background:${getPriorityColor(sug.priority)};flex-shrink:0;`
          },
          text: getPriorityLabel(sug.priority)
        });
        void priorityBadge;
        const sugContent = sugRow.createSpan({
          text: sug.content,
          attr: { style: "font-size:10px;color:var(--nw-text-secondary, var(--text-muted));line-height:1.4;flex:1;" }
        });
        void sugContent;
        const effortSpan = sugRow.createSpan({
          text: `改动:${sug.estimatedEffort}`,
          attr: { style: "font-size:9px;color:var(--nw-text-muted, var(--text-faint));flex-shrink:0;" }
        });
        void effortSpan;
      }
    }

    this.render联动提示(result);
  }

  /** 渲染联动提示 */
  private render联动提示(result: WritingQualityResult): void {
    if (!this.qualityDetailPanel) return;

    const tips: string[] = [];

    if (this.lastResult && this.lastResult.overallCompletion.score > 70 && result.overallScore < 50) {
      tips.push("⚠️ 完成度较高但质量偏低，建议放慢节奏打磨内容质量");
    }

    if (this.lastDivergenceResult && this.lastDivergenceResult.overallDivergence > 50 && result.plotQuality.score < 50) {
      tips.push("🔗 剧情偏离度较高，可能是导致情节质量偏低的原因");
    }

    if (tips.length > 0) {
      const linkSection = this.qualityDetailPanel.createDiv({
        cls: "nw-dashed-sep"
      });
      linkSection.createDiv({
        text: "🔗 联动分析",
        cls: "nw-section-title-sm"
      });
      for (const tip of tips) {
        linkSection.createDiv({
          text: tip,
          attr: { style: "font-size:10px;color:var(--nw-warning-text, #856404);margin:3px 0;line-height:1.4;" }
        });
      }
    }
  }

  /** 收集所有建议 */
  private collectAllSuggestions(result: WritingQualityResult): QualitySuggestion[] {
    const all = [
      ...result.languageQuality.suggestions,
      ...result.rhythmQuality.suggestions,
      ...result.characterQuality.suggestions,
      ...result.plotQuality.suggestions,
      ...result.atmosphereQuality.suggestions,
      ...result.structureQuality.suggestions,
    ];
    return all.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /** 渲染质量历史曲线图 */
  private renderQualityHistoryChart(container: HTMLElement): void {
    const chartH = 50;
    const chartW = 260;
    const padding = 4;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", chartW.toString());
    svg.setAttribute("height", chartH.toString());
    svg.setAttribute("viewBox", `0 0 ${chartW} ${chartH}`);
    svg.style.display = "block";

    const scores = this.qualityHistory.map(h => h.overallScore).slice(-10);
    if (scores.length < 2) return;

    const minScore = Math.max(0, Math.min(...scores) - 10);
    const maxScore = Math.min(100, Math.max(...scores) + 10);
    const scoreRange = Math.max(1, maxScore - minScore);

    const points: string[] = [];
    const stepX = (chartW - padding * 2) / Math.max(1, scores.length - 1);

    scores.forEach((score, i) => {
      const x = padding + i * stepX;
      const y = chartH - padding - ((score - minScore) / scoreRange) * (chartH - padding * 2);
      points.push(`${x},${y}`);
    });

    const polyline = document.createElementNS(svgNS, "polyline");
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "var(--nw-accent, var(--interactive-accent))");
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    if (points.length > 0) {
      const lastPoint = points[points.length - 1].split(",");
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", lastPoint[0]);
      circle.setAttribute("cy", lastPoint[1]);
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "var(--nw-accent, var(--interactive-accent))");
      svg.appendChild(circle);
    }

    container.appendChild(svg);
  }

  /** 检查质量提醒 */
  private checkQualityAlert(result: WritingQualityResult): void {
    const now = Date.now();
    if (now - this.lastQualityAlertTime < this.QUALITY_ALERT_COOLDOWN) return;

    this.lastQualityAlertTime = now;
    const notice = (this.app as any).notice?.addNotice?.(
      `💡 当前质量分 ${result.overallScore}（${result.grade}），建议关注 Top 改进建议`,
      4000
    );
    if (!notice) {
      log.warn('[MonitorPanelB] 质量提醒:', result.overallScore, result.grade);
    }
  }

  /** 显示里程碑通知 */
  private showMilestoneNotice(milestone: string, score: number): void {
    const notice = (this.app as any).notice?.addNotice?.(
      `🎉 达成${milestone}！当前质量分：${score}分`,
      3000
    );
    if (!notice) {
      log.info('[MonitorPanelB] 里程碑:', milestone, '质量分:', score);
    }
  }

  private getQualityScoreColor(score: number): string {
    if (score >= 80) return 'var(--nw-success, #22c55e)';
    if (score >= 60) return 'var(--nw-warning, #f59e0b)';
    return 'var(--nw-danger, #ef4444)';
  }

  private formatQualityDetailKey(key: string): string {
    const labels: Record<string, string> = {
      uniqueChars: '字汇量',
      vocabRichness: '词汇丰富度',
      avgSentenceLen: '平均句长',
      sentenceVariety: '句式变化',
      rhetoricCount: '修辞数',
      typoIssues: '用字问题',
      repetitionCount: '重复次数',
      actionDensity: '动作密度',
      dialogueRatio: '对话占比',
      descriptionDensity: '描写密度',
      paceVariety: '节奏变化',
      sceneShifts: '场景切换',
      characterMentions: '角色提及',
      actionDescriptions: '动作描写',
      uniqueCharacters: '角色数',
      characterDepth: '角色立体度',
      dialoguePersonality: '对话辨识度',
      suspenseIndicators: '悬念信号',
      coolMoments: '爽点数量',
      conflictIndicators: '冲突信号',
      causalityIndicators: '因果信号',
      foreshadowCount: '伏笔数量',
      environmentMentions: '环境描写',
      positiveEmotions: '正面情绪',
      negativeEmotions: '负面情绪',
      senseDescriptions: '感官描写',
      immersion: '代入感',
      openingAttraction: '开头吸引力',
      middleRichness: '中段饱满度',
      endingStrength: '结尾力道',
      structureBalance: '结构均衡',
      note: '备注',
      estimation: '估算方式',
    };
    return labels[key] || key;
  }

  /** 更新质量引擎选项 */
  setQualityOptions(options: Partial<WritingQualityEngineOptions>): void {
    if (this.qualityEngine) {
      this.qualityEngine.updateOptions(options);
    }
  }

  /** 获取最新质量评估结果 */
  getLastQualityResult(): WritingQualityResult | null {
    return this.lastQualityResult;
  }

  /** 获取质量历史记录 */
  getQualityHistory(): QualityHistoryEntry[] {
    return [...this.qualityHistory];
  }

  /** 忽略质量建议 */
  ignoreQualitySuggestion(suggestionId: string): void {
    if (this.qualityEngine) {
      this.qualityEngine.ignoreSuggestion(suggestionId);
      if (this.lastQualityResult) {
        this.runQualityEval();
      }
    }
  }

  /** 清理资源 */
  dispose(): void {
    this.debounceManager.dispose();
  }
}
