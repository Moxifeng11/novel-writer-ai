/**
 * monitor-panel-b.ts — v5.5 监控面板B
 * 剧情完成度 + 偏离预警 + 章节结算(G1) + 写作质量
 * （情节牵引由协同写作主视图的「🎯 情节牵引」卡展示，面板不再重复创建引擎）
 */
import { WorkspaceLeaf, Notice } from "obsidian";
import NovelWriterPlugin from "@/main";
import { DraggablePanel } from "./draggable-panel";
import {
  PlotCompletionEngine,
  PlotCompletionResult,
  PlotCompletionEngineOptions,
  getScoreColorClass,
  getScoreLabel,
} from "@/engine/plot-completion-engine";
import type { PlotDivergenceEngine } from "@/engine/plot-divergence-engine";
import type { WritingQualityEngine } from "@/engine/writing-quality-engine";
import {
  DivergenceResult,
  PlotDivergenceEngineOptions,
  getDivergenceLevelColor,
  getDivergenceLevelLabel,
  getDivergenceLevelIcon,
  DivergenceLevel,
} from "@/engine/plot-divergence-engine";
import {
  WritingQualityResult,
  QualitySuggestion,
  getQualityGradeColor,
  getQualityGradeLabel,
  getQualityTrendIcon,
  getQualityTrendLabel,
  getPriorityColor,
  getPriorityLabel,
} from "@/engine/writing-quality-engine";
import { createPlotDivergenceEngine, createWritingQualityEngine } from "@/engine/quality/quality-engine-factory";
import { AdaptiveDebounceManager } from "@/shared/adaptive-debounce-manager";
import { divergenceLevelFromScore, qualityScoreColor } from "@/shared/quality-grade";
import { loadQualityHistory, appendQualityHistory } from "@/services/quality-history-store";
import { aggregateQualityHistoryByChapter, computeChapterTrend, mergeQualityHistory, normalizeChapterKey, type QualityHistoryRecord } from "@/shared/quality-history";
import {
  compareToBaseline,
  computeQualityBaseline,
  type BaselineComparison,
} from "@/shared/quality-baseline";
import { DEVIATION_MIN_EVALUABLE_CHARS, PLOT_COMPLETION_MIN_EVALUABLE_CHARS, QUALITY_HISTORY_MAX_RECORDS, QUALITY_MIN_EVALUABLE_CHARS } from '@/shared/thresholds';
import { isQualitySampleUsable } from '@/shared/quality-history';
import { CoWriteFacade } from "./services/co-write-facade";
import { createLogger } from '@/shared/logger';


const log = createLogger('MonitorPanelB');
/**
 * VIEW_TYPE_MONITOR_B 常量。
 */
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

/** 质量历史条目与落盘记录同构，避免两套结构漂移 */
type QualityHistoryEntry = QualityHistoryRecord;

/**
 * MonitorPanelB 类。
 */
export class MonitorPanelB extends DraggablePanel {
  private completionEngine: PlotCompletionEngine | null = null;
  private divergenceEngine: PlotDivergenceEngine | null = null;
  private qualityEngine: WritingQualityEngine | null = null;
  private debounceManager = new AdaptiveDebounceManager({ debug: false });
  protected facade: CoWriteFacade;

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
  /** 基线样本：磁盘全量历史 + 本次会话增量；展示用的 qualityHistory 只保留近 20 条 */
  private baselineHistory: QualityHistoryRecord[] = [];
  private maxHistory = 50;
  private maxDivergenceHistory = 10;
  private maxQualityHistory = 20;
  private currentChapterKey = "";
  /**
   * 协同写作显式注入的项目名（同步设置）。
   *
   * 协同写作视图不是 Markdown 文件，`getActiveProject()` 依赖 activeFile，切到该视图后
   * 通常为 null。首次切章时若不做同步注入就会退回空串 → 质量历史不恢复、基线缺失。
   */
  private activeProject = "";
  /** 当前基线样本所属项目；切项目时据此清空 baselineHistory，避免两本书的样本混算 */
  private currentBaselineProject = "";
  private lastQualityAlertTime = 0;
  private readonly QUALITY_ALERT_COOLDOWN = 10 * 60 * 1000;
  /** 质量历史落盘节流：编辑期每 500ms 评估一次，不能每次都写盘 */
  private lastQualityPersistAt = 0;
  private qualityHistoryLoadToken = 0;
  private readonly QUALITY_PERSIST_INTERVAL = 30_000;

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "monitor-b", "监控面板B · 完成度/偏离/质量/结算", "layers");
    this.facade = new CoWriteFacade({ plugin });
  }

  protected renderBody(container: HTMLElement): void {
    container.addClass("nw-float-monitor-grid");

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
      // M3-4：走插件命令入口（registry 优先），不再裸调 app.commands 私有派发
      this.plugin.executeCommand('novel-writer-chapter-settlement');
    });

    try {
      this.completionEngine = new PlotCompletionEngine();
      this.divergenceEngine = createPlotDivergenceEngine();
      this.qualityEngine = createWritingQualityEngine();
    } catch (e) {
      log.warn("[MonitorPanelB] 引擎初始化失败:", e);
    }
  }

  /**
   * 同步注入当前项目名（协同写作视图没有 activeFile，必须由调用方显式提供）
   *
   * @param project - 项目（路径或对象）
   */
  setActiveProject(project: string): void {
    this.activeProject = (project || "").trim();
  }

  /** 项目名优先级：显式注入 > activeFile 推导 */
  private resolveProject(): string {
    return this.activeProject || this.facade.getActiveProject() || '';
  }

  /**
   * 面板关闭：先把节流窗口内的最后一条质量记录落盘，再释放防抖资源。
   * 此前 `dispose()` 没有任何调用方，防抖计时器会带着已脱离 DOM 的引用继续跑；
   * `persistQualityHistory` 的注释写着「force 用于切章/关闭」，但关闭路径一直缺失。
   */
  async onClose(): Promise<void> {
    // 与切章冲刷同口径：待写记录属于「产生它时的项目」，而不是关闭时的 activeFile。
    // 用户在 A 书写作后切到 B 书的 Markdown 文件（不经过 updateCompletion 切章），
    // 直接用 resolveProject() 会把 A 书最后一条记录写进 B 书的 质量历史.json。
    this.persistQualityHistory(true, this.currentBaselineProject || this.resolveProject());
    this.dispose();
    await super.onClose();
  }

  /**
   * 实时更新剧情完成度和偏离检测（带防抖）
   *
   * @param text - 文本内容
   * @param chapterKey - 章节键
   */
  updateCompletion(text: string, chapterKey?: string): void {
    if (!this.completionEngine || !this.completionContent) return;

    if (chapterKey && chapterKey !== this.currentChapterKey) {
      // 切章前先把当前章的最后一条落盘。记录属于「当前基线项目」而不是刚注入的新书：
      // 从 A 书切到 B 书时调用方已先 setActiveProject(B)，这里若用 resolveProject()
      // 会把 A 书的最后一条记录写进 B 书的 质量历史.json。
      this.persistQualityHistory(true, this.currentBaselineProject || this.resolveProject());
      const project = this.resolveProject();
      if (project && project !== this.currentBaselineProject) {
        // 基线是项目级样本：换书必须清空，否则 restore 合并时会把上一本书的记录算进基线
        this.currentBaselineProject = project;
        this.baselineHistory = [];
      }
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
      // 恢复项目级历史，让趋势曲线跨会话存活
      this.restoreQualityHistory();
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

      // 正文不足时引擎返回全 0 空结果：这是「无法评估」，不是「完成度 0」。
      // 写入历史会把完成度趋势打成 0，展示也会把新开空章渲染成「0分 · 待开始」。
      if (result.wordCount < PLOT_COMPLETION_MIN_EVALUABLE_CHARS) {
        this.renderCompletionSummary(result);
        return;
      }

      this.addToHistory(result);
      this.renderCompletionSummary(result);

      if (this.completionExpanded && this.completionDetailPanel) {
        this.renderCompletionDetail(result);
      }
    } catch (e) {
      log.warn("[MonitorPanelB] 剧情完成度评估失败:", e);
      if (this.completionContent) {
        this.renderEvalFailure(
          this.completionContent,
          "综合完成度 --",
          "本次评估失败，结果未更新（原因见开发者日志）",
          16
        );
      }
      if (this.completionExpanded) {
        this.ensureCompletionDetailPanel();
        if (this.completionDetailPanel) {
          this.renderEvalFailure(
            this.completionDetailPanel,
            "完成度详情 --",
            "本次评估失败，暂无完成度详情",
            11
          );
        }
      }
    }
  }

  /** 执行偏离检测 */
  private runDivergenceEval(): void {
    if (!this.divergenceEngine || !this.divergenceContent) return;

    try {
      const result = this.divergenceEngine.evaluate(this.currentChapterText);
      this.lastDivergenceResult = result;

      // 正文不足时引擎返回 0% / normal 空结果：直接渲染会被读成「完全贴合大纲」，
      // 写入历史还会让后续真实偏离看起来像突刺。按无数据处理，也不触发预警。
      if (result.wordCount < DEVIATION_MIN_EVALUABLE_CHARS) {
        this.renderDivergenceSummary(result);
        return;
      }

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
      // 保留上一次的百分比会让用户把旧章/旧文本的结论当成当前正文：清空并告知
      if (this.divergenceContent) {
        this.renderEvalFailure(
          this.divergenceContent,
          "整体偏离度 --",
          "本次评估失败，结果未更新（原因见开发者日志）",
          16
        );
      }
      if (this.divergenceExpanded) {
        this.ensureDivergenceDetailPanel();
        if (this.divergenceDetailPanel) {
          this.renderEvalFailure(
            this.divergenceDetailPanel,
            "偏离详情 --",
            "本次评估失败，暂无偏离详情",
            11
          );
        }
      }
    }
  }

  /**
   * 评估异常：清掉旧结果并显式告知。
   * 与 `render*NoData` 的区别是原因不同——「正文过短」是预期内的不评估，
   * 「引擎抛错」是本次没测成，两者都不能继续显示上一次的分数。
   */
  private renderEvalFailure(
    container: HTMLElement,
    title: string,
    reason: string,
    fontSize: number
  ): void {
    container.empty();
    container.createDiv({
      text: title,
      attr: {
        style: `font-weight:700;font-size:${fontSize}px;color:var(--nw-text-muted, var(--text-faint));margin-bottom:6px;`
      }
    });
    container.createDiv({
      text: reason,
      cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
    });
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

    if (result.wordCount < DEVIATION_MIN_EVALUABLE_CHARS) {
      this.renderDivergenceNoData(result.wordCount);
      return;
    }

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
      cls: 'nw-u-h-8px-2 nw-u-bg-nw-bg-muted-background nw-u-brd-4px-2 nw-u-ov-hidden-2 nw-u-marginbottom-10px-2'
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
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-m-3px-0'
      });
      row.createSpan({ text: dim.icon, cls: 'nw-u-fs-12px-2 nw-u-minw-18px' });
      row.createSpan({
        text: dim.label,
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-mut nw-u-minw-40px'
      });
      const miniBar = row.createDiv({
        cls: 'nw-u-flex-1-2 nw-u-h-6px-2 nw-u-bg-nw-bg-muted-background nw-u-brd-3px-2 nw-u-ov-hidden-2'
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
        cls: 'nw-u-margintop-8px-2 nw-u-paddingtop-6px nw-u-bt-1px-dashed-nw-divider-'
      });
      issueRow.createDiv({
        text: `🚨 ${allIssues.length}个问题`,
        cls: 'nw-u-fs-11px-2 nw-u-fwt-600-2 nw-u-c-nw-danger-ef4444 nw-u-marginbottom-4px-2'
      });
      for (const issue of allIssues.slice(0, 2)) {
        issueRow.createDiv({
          text: `• ${issue}`,
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-secondary-text nw-u-m-2px-0 nw-u-lh-1-4-2'
        });
      }
    }

    const metaRow = this.divergenceContent.createDiv({
      cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-margintop-6px nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut'
    });
    metaRow.createSpan({ text: `${result.wordCount}字` });

    if (this.divergenceExpanded) this.ensureDivergenceDetailPanel();
  }

  /** 正文不足可检测长度：显示 -- 与原因，不渲染 0%（0% 会被读成「完全贴合」） */
  private renderDivergenceNoData(wordCount: number): void {
    if (this.divergenceContent) {
      this.divergenceContent.empty();
      this.divergenceContent.createDiv({
        text: "整体偏离度 --",
        cls: 'nw-u-fwt-700-2 nw-u-fs-16px-2 nw-u-c-nw-text-muted-text-fai nw-u-marginbottom-6px-2'
      });
      this.divergenceContent.createDiv({
        text: `正文不足 ${DEVIATION_MIN_EVALUABLE_CHARS} 字，暂不检测（当前 ${wordCount} 字）`,
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
    }
    if (this.divergenceExpanded) {
      this.ensureDivergenceDetailPanel();
      if (this.divergenceDetailPanel) {
        this.divergenceDetailPanel.empty();
        this.divergenceDetailPanel.createDiv({
          text: "正文过短，暂无偏离详情",
          cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
        });
      }
    }
  }

  /** 详情面板若已被 divergenceContent.empty() 移除，则重新挂到容器末尾 */
  private ensureDivergenceDetailPanel(): void {
    if (!this.divergenceContent) return;
    if (this.divergenceDetailPanel && this.divergenceContent.contains(this.divergenceDetailPanel)) return;
    this.divergenceDetailPanel = this.divergenceContent.createDiv({
      cls: "nw-divergence-detail nw-u-margintop-10px nw-u-paddingtop-10px nw-u-bt-1px-solid-nw-divider-b",
      attr: {}
    });
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

    this.ensureDivergenceDetailPanel();

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

    // 空结果各维度 score=0 / level=normal，渲染出来会是「五项均无偏离」的假详情
    if (result.wordCount < DEVIATION_MIN_EVALUABLE_CHARS) {
      this.divergenceDetailPanel.empty();
      this.divergenceDetailPanel.createDiv({
        text: "正文过短，暂无偏离详情",
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
      return;
    }

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
        cls: 'nw-u-marginbottom-10px-2'
      });

      const secHeader = secDiv.createDiv({
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-4px-2'
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
        cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut nw-u-marginbottom-4px-2 nw-u-lh-1-6-2'
      });
      const detailStr = Object.entries(section.dim.details)
        .map(([k, v]) => `${this.formatDivergenceDetailKey(k)}: ${v}`)
        .join(' · ');
      detailsRow.setText(detailStr);

      if (section.dim.issues.length > 0) {
        const issueList = secDiv.createDiv({
          cls: 'nw-u-fs-10px-2 nw-u-marginbottom-4px-2'
        });
        for (const issue of section.dim.issues) {
          const issueRow = issueList.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-flex-start-2 nw-u-gap-4px-2 nw-u-m-2px-0'
          });
          issueRow.createSpan({
            text: "⚠️",
            cls: "nw-suggestion-list"
          });
          issueRow.createSpan({
            text: issue,
            cls: 'nw-u-c-nw-danger-ef4444 nw-u-lh-1-4-2'
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
            cls: 'nw-u-c-nw-text-secondary-text nw-u-m-2px-0 nw-u-lh-1-4-2'
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
        cls: 'nw-u-margintop-6px'
      });
      const recentHistory = [...this.divergenceHistory].reverse().slice(0, 5);
      for (let i = 0; i < recentHistory.length; i++) {
        const entry = recentHistory[i];
        const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const icon = getDivergenceLevelIcon(entry.level);
        historyList.createDiv({
          text: `${icon} ${timeStr} · ${entry.overallDivergence}% · ${entry.wordCount}字`,
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut nw-u-m-2px-0'
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
    svg.addClass('nw-svg-block');

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
    // 此前用 (this.app as any).notice?.addNotice?.()：Obsidian 没有该 API，
    // 可选链让调用恒为 undefined，预警只写进了日志，用户从未看到过提示。
    new Notice(`⚠️ 剧情偏离预警：${reason}`, 5000);
  }

  private getDivergenceLevelFromScore(score: number): DivergenceLevel {
    // 分界与 deviation-detector 的 severity 阈值同源
    return divergenceLevelFromScore(score);
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

    if (result.wordCount < PLOT_COMPLETION_MIN_EVALUABLE_CHARS) {
      this.renderCompletionNoData(result.wordCount);
      return;
    }

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
      cls: 'nw-u-h-8px-2 nw-u-bg-nw-bg-muted-background nw-u-brd-4px-2 nw-u-ov-hidden-2 nw-u-marginbottom-10px-2'
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
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-m-3px-0'
      });
      row.createSpan({ text: dim.icon, cls: 'nw-u-fs-12px-2 nw-u-minw-18px' });
      row.createSpan({
        text: dim.label,
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-mut nw-u-minw-40px'
      });
      const miniBar = row.createDiv({
        cls: 'nw-u-flex-1-2 nw-u-h-6px-2 nw-u-bg-nw-bg-muted-background nw-u-brd-3px-2 nw-u-ov-hidden-2'
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
      cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-margintop-8px-2 nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut'
    });
    metaRow.createSpan({ text: `${result.wordCount}字` });
    metaRow.createSpan({ text: `${result.overallCompletion.details.paragraphs || 0}段` });
    metaRow.createSpan({ text: `${Math.round(result.overallCompletion.details.evalTimeMs as number || 0)}ms` });

    if (this.completionExpanded) this.ensureCompletionDetailPanel();
  }

  /** 正文不足可评估长度：显示 -- 与原因，不渲染 0 分 */
  private renderCompletionNoData(wordCount: number): void {
    if (this.completionContent) {
      this.completionContent.empty();
      this.completionContent.createDiv({
        text: "综合完成度 --",
        cls: 'nw-u-fwt-700-2 nw-u-fs-16px-2 nw-u-c-nw-text-muted-text-fai nw-u-marginbottom-6px-2'
      });
      this.completionContent.createDiv({
        text: `正文不足 ${PLOT_COMPLETION_MIN_EVALUABLE_CHARS} 字，暂不评估（当前 ${wordCount} 字）`,
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
    }
    if (this.completionExpanded) {
      this.ensureCompletionDetailPanel();
      if (this.completionDetailPanel) {
        this.completionDetailPanel.empty();
        this.completionDetailPanel.createDiv({
          text: "正文过短，暂无完成度详情",
          cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
        });
      }
    }
  }

  /** 详情面板若已被 completionContent.empty() 移除，则重新挂到容器末尾 */
  private ensureCompletionDetailPanel(): void {
    if (!this.completionContent) return;
    if (this.completionDetailPanel && this.completionContent.contains(this.completionDetailPanel)) return;
    this.completionDetailPanel = this.completionContent.createDiv({
      cls: "nw-completion-detail nw-u-margintop-10px nw-u-paddingtop-10px nw-u-bt-1px-solid-nw-divider-b",
      attr: {}
    });
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

    this.ensureCompletionDetailPanel();

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

    // 空结果六维全 0，渲染出来就是「每项 0 分」的假详情
    if (result.wordCount < PLOT_COMPLETION_MIN_EVALUABLE_CHARS) {
      this.completionDetailPanel.empty();
      this.completionDetailPanel.createDiv({
        text: "正文过短，暂无完成度详情",
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
      return;
    }

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
        cls: 'nw-u-marginbottom-8px-2'
      });

      const secHeader = secDiv.createDiv({
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-4px-2'
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
        cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut nw-u-marginbottom-4px-2 nw-u-lh-1-6-2'
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
            cls: 'nw-u-c-nw-text-secondary-text nw-u-m-2px-0'
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
    svg.addClass('nw-svg-block');

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
      cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-mut nw-u-margintop-4px-3'
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
    // 与质量分同一套色阶：80 绿 / 60 黄 / 其余红
    return qualityScoreColor(score);
  }


  /**
   * 更新引擎选项
   *
   * @param options - 配置项
   */
  setCompletionOptions(options: Partial<PlotCompletionEngineOptions>): void {
    if (this.completionEngine) {
      this.completionEngine.updateOptions(options);
    }
  }

  /**
   * 获取最新评估结果
   *
    * @returns PlotCompletionResult 或 null
   */
  getLastResult(): PlotCompletionResult | null {
    return this.lastResult;
  }

  /**
   * 获取历史记录
   *
   * @returns 结果数组
   */
  getHistory(): CompletionHistoryEntry[] {
    return [...this.history];
  }

  /**
   * 更新偏离引擎选项
   *
   * @param options - 配置项
   */
  setDivergenceOptions(options: Partial<PlotDivergenceEngineOptions>): void {
    if (this.divergenceEngine) {
      this.divergenceEngine.updateOptions(options);
    }
  }

  /**
   * 获取最新偏离检测结果
   *
    * @returns DivergenceResult 或 null
   */
  getLastDivergenceResult(): DivergenceResult | null {
    return this.lastDivergenceResult;
  }

  /**
   * 获取偏离历史记录
   *
   * @returns 结果数组
   */
  getDivergenceHistory(): DivergenceHistoryEntry[] {
    return [...this.divergenceHistory];
  }

  /**
   * 忽略当前偏离问题
   *
   * @param issueKey - 问题键
   */
  ignoreDivergenceIssue(issueKey: string): void {
    if (this.divergenceEngine) {
      this.divergenceEngine.ignoreIssue(issueKey);
      if (this.lastDivergenceResult) {
        this.runDivergenceEval();
      }
    }
  }

  /** 执行质量评估（直接以 WQE 总分为准；QSE 在 v1 分支透传同一 overallScore，跨视图同分见 quality-score-engine-cross-view.test.ts） */
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
      if (this.qualityContent) {
        this.renderEvalFailure(
          this.qualityContent,
          "综合质量 --",
          "本次评估失败，结果未更新（原因见开发者日志）",
          20
        );
      }
      if (this.qualityExpanded) {
        this.ensureQualityDetailPanel();
        if (this.qualityDetailPanel) {
          this.renderEvalFailure(
            this.qualityDetailPanel,
            "质量详情 --",
            "本次评估失败，暂无质量详情",
            11
          );
        }
      }
    }
  }

  /** 添加质量历史记录 */
  private addToQualityHistory(result: WritingQualityResult): void {
    // 正文过短时 WQE 返回 0 分空结果，写入会污染基线与 200 条历史配额；
    // 与协同实时落盘共用同一门槛
    if (!isQualitySampleUsable(result.wordCount)) return;

    const chapterKey = normalizeChapterKey(this.currentChapterKey);
    const entry: QualityHistoryEntry = {
      // 落盘键统一为「第N章」：协同写作写入的也是该形式，否则同一章在基线里会被算两次
      chapterKey,
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
      // 趋势按「章」比较：引擎的最近 5 次评估只覆盖本章内的打字波动，不能当趋势
      trend: computeChapterTrend(
        { chapterKey, timestamp: result.evaluatedAt, overallScore: result.overallScore },
        this.baselineHistory,
      ),
    };

    this.qualityHistory.push(entry);
    if (this.qualityHistory.length > this.maxQualityHistory) {
      this.qualityHistory = this.qualityHistory.slice(-this.maxQualityHistory);
    }
    // baselineHistory 的所有消费方（基线比较、章级趋势）单位都是「章」：
    // 同章多次评估只保留最后一次。只追不合并时，`QUALITY_HISTORY_MAX_RECORDS = 200`
    // 会被同一章约 200 次打字停顿灌满，其他章样本被挤掉 → 排除当前章后基线没有样本，
    // 「高于/低于基线」整行消失（磁盘侧已在 appendQualityHistory 收敛，内存侧同一口径）。
    const existingIndex = chapterKey
      ? this.baselineHistory.findIndex(e => normalizeChapterKey(e.chapterKey) === chapterKey)
      : -1;
    if (existingIndex >= 0) {
      this.baselineHistory.splice(existingIndex, 1);
    }
    this.baselineHistory.push(entry);
    if (this.baselineHistory.length > QUALITY_HISTORY_MAX_RECORDS) {
      this.baselineHistory = this.baselineHistory.slice(-QUALITY_HISTORY_MAX_RECORDS);
    }
    this.persistQualityHistory();
  }

  /** 从项目磁盘恢复质量历史（跨会话趋势） */
  private restoreQualityHistory(): void {
    const project = this.resolveProject();
    if (!project) return;
    this.currentBaselineProject = project;
    const token = ++this.qualityHistoryLoadToken;
    loadQualityHistory(this.app, project).then(records => {
      // 切章/切项目后旧请求作废
      if (token !== this.qualityHistoryLoadToken) return;
      // load 期间可能已有新评估写入（切章后 500ms 防抖即触发），
      // 直接覆盖会把会话内增量从基线与趋势里抹掉；合并而不是覆盖，重复项由 merge 去重
      this.baselineHistory = mergeQualityHistory(records, this.baselineHistory);
      if (this.baselineHistory.length === 0) return;
      // 基线使用磁盘全量样本 + 会话增量；display 仍只保留近 20 条
      this.qualityHistory = this.baselineHistory.slice(-this.maxQualityHistory);
      if (this.lastQualityResult) {
        this.renderQualitySummary(this.lastQualityResult);
      }
    }).catch(e => {
      log.warn('[MonitorPanelB] 质量历史恢复失败:', e);
    });
  }

  /**
   * 质量历史落盘（默认 30s 节流；force 用于切章/关闭）。
   * `projectOverride` 用于切章冲刷：此时 activeProject 可能已指向新书，而记录仍属于旧书。
   */
  private persistQualityHistory(force = false, projectOverride?: string): void {
    const project = projectOverride || this.resolveProject();
    if (!project) return;
    const latest = this.qualityHistory[this.qualityHistory.length - 1];
    if (!latest) return;

    const now = Date.now();
    if (!force && now - this.lastQualityPersistAt < this.QUALITY_PERSIST_INTERVAL) return;

    this.lastQualityPersistAt = now;
    // 不在这里拦截「上一次落盘仍在途」：切章时 force 落盘若被丢弃，
    // 紧接着 qualityHistory 被清空，这一条记录就永久丢失。
    // 串行化与去重都由 appendQualityHistory / mergeQualityHistory 保证，重复入队不会写出重复记录。
    appendQualityHistory(this.app, project, latest)
      .catch(e => { // silent-ok: 质量历史后台落盘，失败不阻塞面板
        log.warn('[MonitorPanelB] 质量历史落盘失败:', e);
      });
  }

  /** 渲染质量摘要 */
  private renderQualitySummary(result: WritingQualityResult): void {
    if (!this.qualityContent) return;

    // 正文不足可评估长度时 WQE 返回 0 分 / D 的空结果：这是「无法评估」，
    // 不是「写得差」。直接渲染会让空章显示 0 分并被基线判为「低于」。
    if (result.wordCount < QUALITY_MIN_EVALUABLE_CHARS) {
      this.renderQualityNoData(result.wordCount);
      return;
    }

    this.qualityContent.empty();

    const overallScore = result.overallScore;
    const grade = result.grade;
    const gradeColor = getQualityGradeColor(grade);
    const gradeLabel = getQualityGradeLabel(grade);
    // 顶栏趋势同样按「章」比较：result.trend 是本章内最近 5 次评估的方向，
    // 2.5s 一次的实时评估下它只反映打字波动，与「最近历史」里的箭头口径也会不一致。
    const chapterTrend = computeChapterTrend(
      {
        chapterKey: normalizeChapterKey(this.currentChapterKey),
        timestamp: result.evaluatedAt,
        overallScore,
      },
      this.baselineHistory,
    );
    const trendIcon = getQualityTrendIcon(chapterTrend);
    const trendLabel = getQualityTrendLabel(chapterTrend);

    const scoreRow = this.qualityContent.createDiv({
      cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-6px-2'
    });
    scoreRow.createSpan({
      text: "综合质量",
      cls: "nw-text-sm-secondary"
    });
    const scoreValue = scoreRow.createSpan({
      attr: { style: `font-weight:700;font-size:20px;color:${gradeColor};` }
    });
    scoreValue.createSpan({ text: `${overallScore}` });
    scoreValue.createSpan({ text: ` ${grade}`, cls: 'nw-u-fs-14px-2' });

    const gradeRow = this.qualityContent.createDiv({
      cls: "nw-overall-row"
    });
    gradeRow.createSpan({
      text: `${trendIcon} ${trendLabel}`,
      cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
    });
    gradeRow.createSpan({
      text: gradeLabel,
      attr: { style: `font-size:11px;font-weight:600;color:${gradeColor};` }
    });

    this.renderBaselineComparison(result);

    const progressBar = this.qualityContent.createDiv({
      cls: 'nw-u-h-10px-2 nw-u-bg-nw-bg-muted-background nw-u-brd-5px-2 nw-u-ov-hidden-2 nw-u-marginbottom-10px-2'
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
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-m-2px-0'
      });
      row.createSpan({ text: dim.icon, cls: 'nw-u-fs-11px-2 nw-u-minw-16px' });
      row.createSpan({
        text: dim.label,
        cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-fai nw-u-minw-32px'
      });
      const miniBar = row.createDiv({
        cls: 'nw-u-flex-1-2 nw-u-h-5px nw-u-bg-nw-bg-muted-background nw-u-brd-3px-2 nw-u-ov-hidden-2'
      });
      miniBar.createDiv({
        attr: {
          style: `height:100%;width:${dim.score}%;background:${this.getQualityScoreColor(dim.score)};border-radius:3px;`
        }
      });
      row.createSpan({
        cls: 'nw-u-fs-10px-2 nw-u-minw-28px nw-u-ta-right nw-u-c-nw-text-secondary-text',
        text: `${dim.score}分`
      });
    }

    if (result.topSuggestions.length > 0) {
      const sugSection = this.qualityContent.createDiv({
        cls: 'nw-u-margintop-8px-2 nw-u-paddingtop-6px nw-u-bt-1px-dashed-nw-divider-'
      });
      sugSection.createDiv({
        text: `💡 Top 3 改进建议`,
        cls: 'nw-u-fs-11px-2 nw-u-fwt-600-2 nw-u-c-nw-text-secondary-text nw-u-marginbottom-4px-2'
      });
      for (const sug of result.topSuggestions.slice(0, 3)) {
        const sugRow = sugSection.createDiv({
          cls: 'nw-u-d-flex-2 nw-u-ai-flex-start-2 nw-u-gap-4px-2 nw-u-m-3px-0'
        });
        sugRow.createSpan({
          text: sug.priority === 'high' ? '🔴' : sug.priority === 'medium' ? '🟡' : '🟢',
          cls: 'nw-u-fs-9px-2 nw-u-fsh-0-2 nw-u-margintop-1px-2'
        });
        sugRow.createSpan({
          text: sug.content,
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-secondary-text nw-u-lh-1-4-2 nw-u-flex-1-2'
        });
      }
    }

    const metaRow = this.qualityContent.createDiv({
      cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-6px nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-fai'
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

    // qualityContent.empty() 会连带移除详情面板：展开状态下必须重建，
    // 否则每次评估后详情都会被清掉（引用还在，但节点已脱离 DOM）。
    if (this.qualityExpanded) this.ensureQualityDetailPanel();
  }

  /** 正文不足最小可评估长度：渲染「无数据」，不得显示 0 分与基线结论 */
  private renderQualityNoData(wordCount: number): void {
    if (this.qualityContent) {
      this.qualityContent.empty();
      this.qualityContent.createDiv({
        text: "综合质量 --",
        cls: 'nw-u-fwt-700-2 nw-u-fs-20px-2 nw-u-c-nw-text-muted-text-fai nw-u-marginbottom-6px-2'
      });
      this.qualityContent.createDiv({
        text: `正文不足 ${QUALITY_MIN_EVALUABLE_CHARS} 字，暂不评估（当前 ${wordCount} 字）`,
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
    }
    if (this.qualityExpanded) {
      this.ensureQualityDetailPanel();
      if (this.qualityDetailPanel) {
        this.qualityDetailPanel.empty();
        this.qualityDetailPanel.createDiv({
          text: "正文过短，暂无质量详情",
          cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
        });
      }
    }
  }

  /** 详情面板若已被 qualityContent.empty() 移除，则重新挂到容器末尾 */
  private ensureQualityDetailPanel(): void {
    if (!this.qualityContent) return;
    if (this.qualityDetailPanel && this.qualityContent.contains(this.qualityDetailPanel)) return;
    this.qualityDetailPanel = this.qualityContent.createDiv({
      cls: "nw-quality-detail nw-u-margintop-10px nw-u-paddingtop-10px nw-u-bt-1px-solid-nw-divider-b",
      attr: {}
    });
  }

  /** 渲染「高于/低于基线」行（基于项目质量历史的均值与标准差） */
  private renderBaselineComparison(result: WritingQualityResult): void {
    if (!this.qualityContent) return;

    // addToQualityHistory 已把本次结果写入历史，计算基线时排除当前记录；
    // 基线样本单位是「章」：当前章不和自己比，同章多次评估只取最后一次
    const currentKey = normalizeChapterKey(this.currentChapterKey);
    const history = aggregateQualityHistoryByChapter(
      this.baselineHistory.filter(entry =>
        entry.timestamp !== result.evaluatedAt
        && (!currentKey || normalizeChapterKey(entry.chapterKey) !== currentKey)
      )
    );
    const baseline = computeQualityBaseline(history);
    if (!baseline) return;

    const comparison = compareToBaseline({
      overallScore: result.overallScore,
      dimensions: {
        language: result.languageQuality.score,
        rhythm: result.rhythmQuality.score,
        character: result.characterQuality.score,
        plot: result.plotQuality.score,
        atmosphere: result.atmosphereQuality.score,
        structure: result.structureQuality.score,
      },
    }, baseline);

    this.renderBaselineRow(comparison);
  }

  private renderBaselineRow(comparison: BaselineComparison): void {
    if (!this.qualityContent) return;

    const { level, overall, sampleCount } = comparison;
    const label = level === 'above' ? '高于基线' : level === 'below' ? '低于基线' : '与基线持平';
    const color = level === 'above'
      ? 'var(--nw-success, #22c55e)'
      : level === 'below'
        ? 'var(--nw-warning, #d29922)'
        : 'var(--nw-text-muted, var(--text-faint))';
    const deltaText = `${overall.delta > 0 ? '+' : ''}${overall.delta.toFixed(1)}`;
    const zText = `${overall.zScore > 0 ? '+' : ''}${overall.zScore.toFixed(1)}σ`;

    this.qualityContent.createDiv({
      text: `📊 ${label} ${deltaText}（${zText}） · 基线 ${overall.baseline.toFixed(1)}（近${sampleCount}章）`,
      attr: { style: `font-size:10px;color:${color};margin-bottom:8px;` }
    });
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

    // 与 renderQualitySummary 末尾共用同一重建逻辑：节点若已挂载则复用，
    // 避免重复创建两个详情面板（旧引用会指向已被移除的那个）
    this.ensureQualityDetailPanel();

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

    // 与摘要同源：正文不足可评估长度时六维分数全是 0，渲染出来就是「每项 0 分」的假详情
    if (result.wordCount < QUALITY_MIN_EVALUABLE_CHARS) {
      this.qualityDetailPanel.empty();
      this.qualityDetailPanel.createDiv({
        text: "正文过短，暂无质量详情",
        cls: 'nw-u-fs-11px-2 nw-u-c-nw-text-muted-text-fai'
      });
      return;
    }

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
        cls: 'nw-u-marginbottom-8px-2'
      });

      const secHeader = secDiv.createDiv({
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-3px'
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
        cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-fai nw-u-marginbottom-3px nw-u-lh-1-6-2'
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
            cls: 'nw-u-d-flex-2 nw-u-ai-flex-start-2 nw-u-gap-4px-2 nw-u-m-2px-0'
          });
          sugRow.createSpan({
            text: "💡",
            cls: 'nw-u-fs-9px-2'
          });
          sugRow.createSpan({
            text: sug.content,
            cls: 'nw-u-c-nw-text-secondary-text nw-u-lh-1-4-2 nw-u-flex-1-2'
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
        cls: 'nw-u-margintop-6px'
      });
      const recentHistory = [...this.qualityHistory].reverse().slice(0, 5);
      for (let i = 0; i < recentHistory.length; i++) {
        const entry = recentHistory[i];
        const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        historyList.createDiv({
          text: `${getQualityTrendIcon(entry.trend)} ${timeStr} · ${entry.overallScore}分 · ${entry.grade} · ${entry.wordCount}字`,
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-muted-text-fai nw-u-m-2px-0'
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
          cls: 'nw-u-d-flex-2 nw-u-ai-flex-start-2 nw-u-gap-6px-2 nw-u-m-4px-0 nw-u-p-4px-6px nw-u-brd-4px-2 nw-u-bg-nw-bg-muted-background'
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
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-text-secondary-text nw-u-lh-1-4-2 nw-u-flex-1-2'
        });
        void sugContent;
        const effortSpan = sugRow.createSpan({
          text: `改动:${sug.estimatedEffort}`,
          cls: 'nw-u-fs-9px-2 nw-u-c-nw-text-muted-text-fai nw-u-fsh-0-2'
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
          cls: 'nw-u-fs-10px-2 nw-u-c-nw-warning-text-856404 nw-u-m-3px-0 nw-u-lh-1-4-2'
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
    svg.addClass('nw-svg-block');

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
    new Notice(`💡 当前质量分 ${result.overallScore}（${result.grade}），建议关注 Top 改进建议`, 4000);
  }

  /** 显示里程碑通知 */
  private showMilestoneNotice(milestone: string, score: number): void {
    new Notice(`🎉 达成${milestone}！当前质量分：${score}分`, 3000);
  }

  private getQualityScoreColor(score: number): string {
    return qualityScoreColor(score);
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
  /**
   * 获取最新质量评估结果
   *
    * @returns WritingQualityResult 或 null
   */
  getLastQualityResult(): WritingQualityResult | null {
    return this.lastQualityResult;
  }

  /**
   * 获取质量历史记录
   *
   * @returns 结果数组
   */
  getQualityHistory(): QualityHistoryEntry[] {
    return [...this.qualityHistory];
  }

  /**
   * 忽略质量建议
   *
   * @param suggestionId - 建议ID
   */
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
