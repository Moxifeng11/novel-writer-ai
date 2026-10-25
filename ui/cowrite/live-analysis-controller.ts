/**
 * live-analysis-controller.ts — 协同写作实时监控调度（C2 抽离）
 *
 * 从 CoWritingView 抽出的「实时监控」职责块：输入/插入/保存后节流刷新
 * 情节牵引面板、推送 MonitorPanelA，以及设定守卫（OOC + 实体状态变更）。
 * 控制器持有 view 引用，自己管理实时分析定时器；ghost 联想定时器仍由
 * 主视图管理。onClose 时由主视图调用 clearTimers() 清理。
 */

import { Notice } from 'obsidian';
import type { CoWritingView } from '../co-writing-view';
import { AdaptiveDebounceManager } from '../../shared/adaptive-debounce-manager';
import { createLogger } from '../../shared/logger';
import { GUARD_INPUT_COOLDOWN_MS, GUARD_INPUT_MIN_GROWTH_CHARS } from '../../shared/thresholds';


const log = createLogger('LiveAnalysisController');
type RefreshTrigger = 'input' | 'insert' | 'save';
type GuardTrigger = RefreshTrigger | 'manual';

export class LiveAnalysisController {
  view: CoWritingView;
  private debounceManager = new AdaptiveDebounceManager({ debug: false });
  isInspectingGuard = false;
  /** 检查代次：切章/关闭视图/发起新检查时推进，慢的旧结果不得写进当前章 */
  private guardSeq = 0;
  /** 牵引面板代次：同源问题——旧章结果晚到不得覆盖新章 */
  private tractionSeq = 0;
  /** 上一次「输入触发」守卫检查的正文长度与时间，用于增量门槛与冷却 */
  private lastGuardCheck: { length: number; at: number } | null = null;

  constructor(view: CoWritingView) {
    this.view = view;
  }

  /** 清理实时分析与守卫定时器（不含 ghost 联想定时器，由主视图管理） */
  clearTimers() {
    this.debounceManager.dispose();
    // 视图已关闭：在途检查/牵引返回后不得再写警告容器、面板 A 或牵引区
    this.guardSeq++;
    this.tractionSeq++;
    this.isInspectingGuard = false;
  }

  /**
   * 切章时调用：作废在途检查与牵引结果，并清空长度基准。
   * 不清基准时，新章比上一章短会被 `grew` 判定为「没写够」而长期跳过输入检查；
   * 不作废代次时，旧章结果会晚到并写进新章的警告容器、面板 A 与牵引区。
   */
  resetForChapterSwitch() {
    this.guardSeq++;
    this.tractionSeq++;
    this.isInspectingGuard = false;
    this.lastGuardCheck = null;
    // 旧章的进度/风险会一直停留到下一次输入：切章先清空，等新章引擎就绪后重渲染
    this.view.tractionContainer?.empty();
  }

  scheduleRefresh(trigger: RefreshTrigger) {
    const view = this.view;
    if (!view.rightEditor?.value?.trim())
      return;
    const analysisDelay = trigger === "input" ? 2500 : 500;
    this.debounceManager.debounceFixed('live-analysis', () => {
      void this.refresh(trigger);
    }, analysisDelay);
    const guardDelay = trigger === "input" ? 8e3 : 1200;
    this.debounceManager.debounceFixed('guard-check', () => {
      // 必须保留原始触发源：把 input 归成 insert 会让节流无法区分「打字停顿」
      // 与「用户插入建议」，输入路径的高频全量检测就无从收敛。
      void this.inspectSettingGuard(trigger);
    }, guardDelay);
    const metricsDelay = trigger === "input" ? 3000 : 1000;
    if (view.plugin.settings.autoPlotEvaluation) {
      this.debounceManager.debounceFixed('plot-metrics', () => {
        const body = view.rightEditor?.value || "";
        if (body.trim().length < 50) return;
        void view.refreshMetrics(false);
      }, metricsDelay);
    }
  }

  async refresh(trigger: RefreshTrigger) {
    const view = this.view;
    const body = view.rightEditor?.value || "";
    if (body.length < 100) return;
    const monitorPanelA = view.plugin.workspaceManager?.getMonitorPanelA?.();
    if (monitorPanelA) {
      monitorPanelA.refreshWithBody(body);
    }
    await this.renderTractionPanel();
  }

  async renderTractionPanel() {
    const view = this.view;
    if (!view.tractionContainer || !view.tractionEngine)
      return;
    const token = ++this.tractionSeq;
    view.tractionContainer.empty();
    view.tractionContainer.createEl("h4", { text: "\u{1F3AF} \u60C5\u8282\u7275\u5F15" });
    try {
      const state = await view.tractionEngine.checkTraction(
        parseInt(view.volume.replace(/\D/g, "")) || 1,
        view.chapterNum
      );
      if (token !== this.tractionSeq) return;
      const progressDiv = view.tractionContainer.createDiv({ cls: "nw-traction-progress-value" });
      progressDiv.createSpan({ text: `\u6574\u4F53\u8FDB\u5EA6: ${state.overallProgress}%` });
      const riskClass = `nw-divergence-risk-${state.divergenceRisk}`;
      view.tractionContainer.createDiv({
        cls: riskClass,
        text: `\u504F\u79BB\u98CE\u9669: ${state.divergenceRisk.toUpperCase()}`
      });
      if (state.recommendations.length > 0) {
        const recDiv = view.tractionContainer.createDiv({ cls: "nw-traction-recommendations" });
        for (const rec of state.recommendations) {
          recDiv.createDiv({ cls: "nw-traction-recommendation", text: rec });
        }
      }
    } catch (e) {
      if (token !== this.tractionSeq) return;
      log.warn("[LiveAnalysisController] D4: \u7275\u5F15\u9762\u677F\u6E32\u67D3\u5931\u8D25:", e);
      view.tractionContainer.createDiv({ cls: "novel-writer-cowrite-error", text: "\u7275\u5F15\u5206\u6790\u5931\u8D25" });
    }
  }

  /** A1+D1: 渲染守卫加载占位（OOC + 实体状态变更） */
  renderGuardLoading() {
    const view = this.view;
    if (!view.warningContainer)
      return;
    view.warningContainer.empty();
    view.warningContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: "\u{1F6E1}\uFE0F \u6B63\u5728\u68C0\u67E5\u89D2\u8272\u4E00\u81F4\u6027\u4E0E\u5B9E\u4F53\u72B6\u6001\u53D8\u66F4\u2026\u2026" });
  }

  async inspectSettingGuard(trigger: GuardTrigger) {
    const view = this.view;
    if (this.isInspectingGuard) {
      // 自动检查在途时用户点「检查」：此前静默丢弃，看起来像按钮没反应
      if (trigger === "manual") new Notice("⏳ 设定检查正在进行，请稍候…", 2e3);
      return;
    }
    if (!view.rightEditor?.value?.trim()) {
      // UX 修复：正文为空时手动点击「检查」需给出明确反馈
      if (trigger === "manual") {
        new Notice("⚠️ 正文为空，无法执行设定检查", 3e3);
      }
      return;
    }
    // 「输入」路径每停顿 8 秒触发一次，而实体状态检测每次都会把正文前 6000 字
    // 发给 AI。既没有写够新内容、又没过冷却时跳过，避免连续写作变成全量重扫。
    // 插入建议 / 保存 / 手动检查是用户主动动作，保持每次都检测。
    if (trigger === "input") {
      const last = this.lastGuardCheck;
      if (last) {
        const bodyLength = view.rightEditor.value.length;
        const grew = bodyLength - last.length >= GUARD_INPUT_MIN_GROWTH_CHARS;
        const cooled = Date.now() - last.at >= GUARD_INPUT_COOLDOWN_MS;
        if (!grew && !cooled) return;
      }
    }
    this.isInspectingGuard = true;
    const token = ++this.guardSeq;
    // 快照本次检查的正文：await 期间用户可能继续输入或切章，返回后写的必须是这份内容的结果
    const body = view.rightEditor.value;
    const monitorPanelA = view.plugin.workspaceManager?.getMonitorPanelA?.();
    if (trigger === "manual") this.renderGuardLoading();
    try {
      const report = await view.engine.inspectSettingGuard(body);
      if (token !== this.guardSeq) return;
      const hasOOC = !!report.oocResult?.hasOOC;
      const hasEntityChanges = report.entityChanges.length > 0;
      if (monitorPanelA) {
        if (hasOOC && report.oocResult) monitorPanelA.showOOCWarnings(report.oocResult.warnings, report.oocResult.score);
        if (hasEntityChanges) monitorPanelA.showEntityChanges(report.entityChanges);
        view.warningContainer.empty();
        view.warningContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: "🛡️ A1/D1 警告已推送到右侧 MonitorPanelA" });
      } else {
        if (!hasOOC && !hasEntityChanges) {
          if (!view.warningContainer) return;
          view.warningContainer.empty();
          view.warningContainer.createDiv({ cls: "novel-writer-cowrite-empty", text: trigger === "manual" ? "本次检查未发现角色 OOC 或实体状态变更。" : "暂无警告。插入建议或保存正文后会自动检测 OOC 和实体状态变更。" });
          return;
        }
        view.warningContainer.empty();
        if (hasOOC && report.oocResult) {
          const panel = view.warningContainer.createDiv({ cls: "nw-ooc-warning-panel" });
          panel.createEl("strong", { text: "⚠️ OOC警告 (一致性: " + report.oocResult.score + "%)" });
          for (const w of report.oocResult.warnings) panel.createDiv({ cls: "nw-warning-text", text: "· " + w });
        }
        if (hasEntityChanges) {
          const panel = view.warningContainer.createDiv({ cls: "nw-entity-state-panel" });
          panel.createEl("strong", { text: "🔄 检测到实体状态变更" });
          const list = panel.createDiv({ cls: "nw-state-change-list" });
          for (const change of report.entityChanges) {
            const item = list.createDiv({ cls: "nw-state-change-item" });
            item.createSpan({ cls: "nw-entity-name-accent", text: change.entityName });
            item.createSpan({ text: " → " });
            item.createSpan({ cls: "nw-new-status", text: change.newStatus });
          }
          const confirmBtn = panel.createEl("button", { text: "📋 送入确认队列", cls: "novel-writer-cowrite-secondary-btn" });
          confirmBtn.addEventListener("click", async () => {
            const count = await view.engine.confirmStateChanges();
            new Notice(count > 0
              ? `📋 ${count} 项状态变化已进入待确认队列，可在「质量仪表盘」确认写入`
              : "⚠️ 没有可确认的状态变化", 2e3);
          });
        }
      }
    } catch (e) {
      if (token !== this.guardSeq) return;
      log.warn("[LiveAnalysisController] 设定守卫检查失败:", e);
    } finally {
      // 只有仍是最新一次检查时才释放锁：切章时 resetForChapterSwitch 已释放，
      // 且新章的检查可能已持有锁，旧请求不能把它置回 false。
      if (token === this.guardSeq) {
        this.isInspectingGuard = false;
        // 失败也记录：否则一次失败会让后续每次停顿都重试全量检测
        if (trigger === "input") {
          this.lastGuardCheck = { length: view.rightEditor?.value?.length ?? 0, at: Date.now() };
        }
      }
    }
  }
}
