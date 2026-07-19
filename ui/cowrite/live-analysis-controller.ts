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


const log = createLogger('LiveAnalysisController');
type RefreshTrigger = 'input' | 'insert' | 'save';
type GuardTrigger = 'manual' | 'insert' | 'save';

export class LiveAnalysisController {
  view: CoWritingView;
  private debounceManager = new AdaptiveDebounceManager({ debug: false });
  isInspectingGuard = false;

  constructor(view: CoWritingView) {
    this.view = view;
  }

  /** 清理实时分析与守卫定时器（不含 ghost 联想定时器，由主视图管理） */
  clearTimers() {
    this.debounceManager.dispose();
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
      void this.inspectSettingGuard(trigger === "save" ? "save" : "insert");
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
    view.tractionContainer.empty();
    view.tractionContainer.createEl("h4", { text: "\u{1F3AF} \u60C5\u8282\u7275\u5F15" });
    try {
      const state = await view.tractionEngine.checkTraction(
        parseInt(view.volume.replace(/\D/g, "")) || 1,
        view.chapterNum
      );
      const progressDiv = view.tractionContainer.createDiv({ cls: "traction-progress" });
      progressDiv.createSpan({ text: `\u6574\u4F53\u8FDB\u5EA6: ${state.overallProgress}%` });
      const riskClass = `divergence-risk-${state.divergenceRisk}`;
      view.tractionContainer.createDiv({
        cls: riskClass,
        text: `\u504F\u79BB\u98CE\u9669: ${state.divergenceRisk.toUpperCase()}`
      });
      if (state.recommendations.length > 0) {
        const recDiv = view.tractionContainer.createDiv({ cls: "traction-recommendations" });
        for (const rec of state.recommendations) {
          recDiv.createDiv({ cls: "traction-recommendation", text: rec });
        }
      }
    } catch (e) {
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
    if (this.isInspectingGuard || !view.rightEditor?.value?.trim()) return;
    this.isInspectingGuard = true;
    const monitorPanelA = view.plugin.workspaceManager?.getMonitorPanelA?.();
    if (trigger === "manual") this.renderGuardLoading();
    try {
      const report = await view.engine.inspectSettingGuard(view.rightEditor.value);
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
          const panel = view.warningContainer.createDiv({ cls: "ooc-warning-panel" });
          panel.createEl("strong", { text: "⚠️ OOC警告 (一致性: " + report.oocResult.score + "%)" });
          for (const w of report.oocResult.warnings) panel.createDiv({ cls: "warning-item", text: "· " + w });
        }
        if (hasEntityChanges) {
          const panel = view.warningContainer.createDiv({ cls: "entity-state-panel" });
          panel.createEl("strong", { text: "🔄 检测到实体状态变更" });
          const list = panel.createDiv({ cls: "state-change-list" });
          for (const change of report.entityChanges) {
            const item = list.createDiv({ cls: "state-change-item" });
            item.createSpan({ cls: "entity-name", text: change.entityName });
            item.createSpan({ text: " → " });
            item.createSpan({ cls: "new-status", text: change.newStatus });
          }
          const confirmBtn = panel.createEl("button", { text: "确认变更", cls: "novel-writer-cowrite-secondary-btn" });
          confirmBtn.addEventListener("click", async () => {
            await view.engine.confirmStateChanges();
            new Notice("✅ 实体状态已更新", 2e3);
          });
        }
      }
    } catch (e) {
      log.warn("[LiveAnalysisController] 设定守卫检查失败:", e);
    } finally {
      this.isInspectingGuard = false;
    }
  }
}
