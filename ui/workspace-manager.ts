/**
 * workspace-manager.ts — v5.5 浮窗管理器
 * 管理所有浮动面板的创建、销毁、布局恢复
 */
import type NovelWriterPlugin from "../main";
import { MonitorPanelA, VIEW_TYPE_MONITOR_A } from "./monitor-panel-a";
import { MonitorPanelB, VIEW_TYPE_MONITOR_B } from "./monitor-panel-b";
import { CoWriteFloatingPanel, VIEW_TYPE_FLOAT_COWRITE } from "./co-write-floating-panel";
import { CoWritingView, VIEW_TYPE_CO_WRITE } from "./co-writing-view";

/**
 * FLOAT_VIEW_TYPES 常量。
 */
export const FLOAT_VIEW_TYPES = [
  VIEW_TYPE_CO_WRITE,
  VIEW_TYPE_FLOAT_COWRITE,
  VIEW_TYPE_MONITOR_A,
  VIEW_TYPE_MONITOR_B,
];

/**
 * FloatWorkspaceManager 类。
 */
export class FloatWorkspaceManager {
  private plugin: NovelWriterPlugin;

  constructor(plugin: NovelWriterPlugin) {
    this.plugin = plugin;
  }

  /** 注册所有浮窗视图 */
  registerAll(): void {
    this.plugin.registerView(
      VIEW_TYPE_MONITOR_A,
      (leaf) => new MonitorPanelA(leaf, this.plugin)
    );
    this.plugin.registerView(
      VIEW_TYPE_MONITOR_B,
      (leaf) => new MonitorPanelB(leaf, this.plugin)
    );
    this.plugin.registerView(
      VIEW_TYPE_FLOAT_COWRITE,
      (leaf) => new CoWriteFloatingPanel(leaf, this.plugin)
    );
  }

  /**
   * 打开所有浮窗
   *
   * @param project - 项目（路径或对象）
   * @param chapterName - 章节名
   */
  async openAll(project?: string, chapterName?: string): Promise<void> {
    const { workspace } = this.plugin.app;

    // 检查是否已经有这些面板打开了
    const openTypes = new Set(
      workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)
        .concat(workspace.getLeavesOfType(VIEW_TYPE_MONITOR_A))
        .concat(workspace.getLeavesOfType(VIEW_TYPE_MONITOR_B))
        .map((l) => l.view.getViewType())
    );

    // 主写作区统一使用句级协同写作视图，避免“写作控制面板”和“协同写作面板”双入口分裂。
    let coWritingLeaf = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)[0];
    if (!openTypes.has(VIEW_TYPE_CO_WRITE) || !coWritingLeaf) {
      coWritingLeaf = workspace.getLeaf("tab");
      if (coWritingLeaf) {
        await coWritingLeaf.setViewState({ type: VIEW_TYPE_CO_WRITE, active: true });
      }
    }
    if (coWritingLeaf && project && chapterName) {
      const view = coWritingLeaf.view as CoWritingView;
      await view.openChapter(project, chapterName);
    }

    // 监控面板A（右侧边栏）
    if (!openTypes.has(VIEW_TYPE_MONITOR_A)) {
      const leafA = workspace.getRightLeaf(false);
      if (leafA) {
        await leafA.setViewState({ type: VIEW_TYPE_MONITOR_A, active: false });
      }
    }

    // 监控面板B（另一个右侧边栏）
    // P1-17（v4.27）：getRightLeaf(false) 会复用刚被 A 占用的同一个 leaf，
    // B 设置后 A 立刻消失。必须 split 出新的右侧 leaf。
    if (!openTypes.has(VIEW_TYPE_MONITOR_B)) {
      const leafB = workspace.getRightLeaf(true);
      if (leafB) {
        await leafB.setViewState({ type: VIEW_TYPE_MONITOR_B, active: false });
      }
    }

    // 显示主协同写作面板
    const coWritingLeaves = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE);
    if (coWritingLeaves.length > 0) {
      workspace.revealLeaf(coWritingLeaves[0]);
    }
  }

  /** 关闭所有浮窗 */
  closeAll(): void {
    const { workspace } = this.plugin.app;
    for (const type of FLOAT_VIEW_TYPES) {
      for (const leaf of workspace.getLeavesOfType(type)) {
        leaf.detach();
      }
    }
  }

  /**
   * 获取主协同写作面板引用
   *
    * @returns CoWritingView 或 null
   */
  getCoWritingView(): CoWritingView | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE);
    return leaves.length > 0 ? (leaves[0].view as CoWritingView) : null;
  }

  /**
   * 获取监控面板A引用
   *
    * @returns MonitorPanelA 或 null
   */
  getMonitorPanelA(): MonitorPanelA | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_MONITOR_A);
    return leaves.length > 0 ? (leaves[0].view as MonitorPanelA) : null;
  }

  /**
   * 获取监控面板B引用
   *
    * @returns MonitorPanelB 或 null
   */
  getMonitorPanelB(): MonitorPanelB | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_MONITOR_B);
    return leaves.length > 0 ? (leaves[0].view as MonitorPanelB) : null;
  }

}
