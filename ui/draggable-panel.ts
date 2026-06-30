/**
 * draggable-panel.ts — v5.5 浮窗基础组件
 * 提供可拖动、缩放、折叠、自动保存位置的浮动面板基类
 */
import { ItemView, WorkspaceLeaf } from "obsidian";
import { applyNwScope } from '../utils/helpers';
import type NovelWriterPlugin from "../main";

export interface PanelLayoutConfig {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;
}

export class DraggablePanel extends ItemView {
  protected plugin: NovelWriterPlugin;
  protected panelId: string;
  protected panelTitle: string;
  protected panelIcon: string;

  private dragHandle: HTMLElement | null = null;
  private panelContainer: HTMLElement | null = null;
  private bodyContainer: HTMLElement | null = null;
  private collapseBtn: HTMLElement | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private startLeft = 0;
  private startTop = 0;
  private isCollapsed = false;
  private boundDragMove = (e: PointerEvent) => this.onDragMove(e);
  private boundDragEnd = () => this.onDragEnd();

  constructor(
    leaf: WorkspaceLeaf,
    plugin: NovelWriterPlugin,
    panelId: string,
    panelTitle: string,
    panelIcon = "file-text"
  ) {
    super(leaf);
    this.plugin = plugin;
    this.panelId = panelId;
    this.panelTitle = panelTitle;
    this.panelIcon = panelIcon;
  }

  getViewType(): string {
    return `nw-float-${this.panelId}`;
  }
  getDisplayText(): string {
    return this.panelTitle;
  }
  getIcon(): string {
    return this.panelIcon;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    applyNwScope(this);
    contentEl.addClass("nw-float-panel");
    contentEl.addClass(`nw-float-${this.panelId}`);

    this.panelContainer = contentEl.createDiv({ cls: "nw-float-container" });

    // 标题栏（拖拽手柄）
    this.dragHandle = this.panelContainer.createDiv({
      cls: "nw-float-header",
    });
    const iconSpan = this.dragHandle.createSpan({
      cls: "nw-float-header-icon",
    });
    iconSpan.innerHTML = this.getIconHtml();
    this.dragHandle.createSpan({
      cls: "nw-float-header-title",
      text: this.panelTitle,
    });

    // 折叠按钮
    this.collapseBtn = this.dragHandle.createEl("button", {
      cls: "nw-float-collapse-btn",
      attr: { title: "折叠/展开" },
    });
    this.collapseBtn.innerHTML = "▾";

    // 主体
    this.bodyContainer = this.panelContainer.createDiv({
      cls: "nw-float-body",
    });

    // 渲染子类内容
    this.renderBody(this.bodyContainer);

    // 绑定拖拽事件
    this.dragHandle.addEventListener("pointerdown", (e) =>
      this.onDragStart(e)
    );
    document.addEventListener("pointermove", this.boundDragMove);
    document.addEventListener("pointerup", this.boundDragEnd);

    // 绑定折叠
    this.collapseBtn.addEventListener("click", () => this.toggleCollapse());

    // 恢复保存的位置
    this.restoreLayout();
  }

  async onClose(): Promise<void> {
    document.removeEventListener("pointermove", this.boundDragMove);
    document.removeEventListener("pointerup", this.boundDragEnd);
    // 保存布局
    this.saveLayout();
  }

  /** 子类实现：渲染面板主体 */
  protected renderBody(container: HTMLElement): void {
    container.createDiv({ text: "面板内容" });
  }

  /** 获取面板容器，供子类使用 */
  protected getBody(): HTMLElement | null {
    return this.bodyContainer;
  }

  private getIconHtml(): string {
    const icons: Record<string, string> = {
      "pen-nib": "✍️",
      "file-text": "📄",
      "bar-chart": "📊",
      activity: "📈",
      alert: "🚨",
      target: "🎯",
      "credit-card": "💰",
      palette: "🎨",
      heart: "💖",
      zap: "⚡",
      layers: "📑",
    };
    return icons[this.panelIcon] || "📋";
  }

  private onDragStart(e: PointerEvent): void {
    if ((e.target as HTMLElement)?.closest("button")) return;
    if (!this.panelContainer) return;
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    const rect = this.panelContainer.getBoundingClientRect();
    this.startLeft = rect.left;
    this.startTop = rect.top;
    this.panelContainer.addClass("nw-float-dragging");
    this.panelContainer.style.cursor = "grabbing";
    this.panelContainer.style.setProperty("position", "fixed", "important");
    this.panelContainer.style.setProperty("left", `${this.startLeft}px`, "important");
    this.panelContainer.style.setProperty("top", `${this.startTop}px`, "important");
    this.panelContainer.style.setProperty("width", `${rect.width}px`, "important");
    this.panelContainer.style.setProperty("height", `${rect.height}px`, "important");
    this.panelContainer.style.setProperty("z-index", "1000", "important");
  }

  private onDragMove(e: PointerEvent): void {
    if (!this.isDragging || !this.panelContainer) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.panelContainer.style.setProperty("left", `${this.startLeft + dx}px`, "important");
    this.panelContainer.style.setProperty("top", `${this.startTop + dy}px`, "important");
  }

  private onDragEnd(): void {
    if (!this.isDragging || !this.panelContainer) return;
    this.isDragging = false;
    this.panelContainer.removeClass("nw-float-dragging");
    this.panelContainer.style.cursor = "";
    this.saveLayout();
  }

  private toggleCollapse(): void {
    if (!this.bodyContainer || !this.collapseBtn) return;
    this.isCollapsed = !this.isCollapsed;
    this.bodyContainer.style.display = this.isCollapsed ? "none" : "";
    this.collapseBtn.innerHTML = this.isCollapsed ? "▸" : "▾";
    this.saveLayout();
  }

  private saveLayout(): void {
    if (!this.panelContainer) return;
    const rect = this.panelContainer.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return;
    const layout = this.getLayout();
    const idx = layout.findIndex((p) => p.id === this.panelId);
    const entry: PanelLayoutConfig = {
      id: this.panelId,
      position: { x: Math.max(8, rect.left), y: Math.max(48, rect.top) },
      size: { width: Math.max(280, rect.width), height: Math.max(200, rect.height) },
      collapsed: this.isCollapsed,
    };
    if (idx >= 0) {
      layout[idx] = entry;
    } else {
      layout.push(entry);
    }
    this.persistLayout(layout);
  }

  private restoreLayout(): void {
    const layout = this.getLayout();
    if (!this.panelContainer) return;
    const idx = layout.findIndex((p) => p.id === this.panelId);
    const saved = idx >= 0 ? layout[idx] : null;
    const entry = saved && this.isValidLayoutEntry(saved) ? saved : this.createDefaultLayoutEntry();
    this.applyLayoutEntry(entry);
    if (idx >= 0) {
      layout[idx] = entry;
    } else {
      layout.push(entry);
    }
    this.persistLayout(layout);
  }

  private isValidLayoutEntry(entry: PanelLayoutConfig): boolean {
    return Number.isFinite(entry.position?.x)
      && Number.isFinite(entry.position?.y)
      && Number.isFinite(entry.size?.width)
      && Number.isFinite(entry.size?.height)
      && entry.size.width >= 180
      && entry.size.height >= 120;
  }

  private createDefaultLayoutEntry(): PanelLayoutConfig {
    const viewportWidth = Math.max(window.innerWidth || 1280, 960);
    const viewportHeight = Math.max(window.innerHeight || 800, 640);
    const presets: Record<string, { x: number; y: number; width: number; height: number }> = {
      writing: { x: 24, y: 88, width: Math.min(760, viewportWidth - 360), height: Math.min(680, viewportHeight - 140) },
      "monitor-a": { x: Math.max(360, viewportWidth - 360), y: 88, width: 330, height: Math.min(420, viewportHeight - 140) },
      "monitor-b": { x: Math.max(360, viewportWidth - 360), y: Math.min(530, viewportHeight - 360), width: 330, height: 320 },
    };
    const p = presets[this.panelId] || { x: 80, y: 120, width: 520, height: 420 };
    return {
      id: this.panelId,
      position: { x: Math.max(8, p.x), y: Math.max(48, p.y) },
      size: { width: Math.max(280, p.width), height: Math.max(200, p.height) },
      collapsed: false,
    };
  }

  private applyLayoutEntry(entry: PanelLayoutConfig): void {
    if (!this.panelContainer) return;
    const maxLeft = Math.max(8, (window.innerWidth || 1280) - 120);
    const maxTop = Math.max(48, (window.innerHeight || 800) - 80);
    this.panelContainer.style.setProperty("position", "fixed", "important");
    this.panelContainer.style.setProperty("left", `${Math.min(Math.max(8, entry.position.x), maxLeft)}px`, "important");
    this.panelContainer.style.setProperty("top", `${Math.min(Math.max(48, entry.position.y), maxTop)}px`, "important");
    this.panelContainer.style.setProperty("width", `${Math.max(280, entry.size.width)}px`, "important");
    this.panelContainer.style.setProperty("height", `${Math.max(200, entry.size.height)}px`, "important");
    this.panelContainer.style.setProperty("resize", "both", "important");
    this.panelContainer.style.setProperty("z-index", "1000", "important");
    if (entry.collapsed && this.bodyContainer) {
      this.isCollapsed = true;
      this.bodyContainer.style.display = "none";
      if (this.collapseBtn) this.collapseBtn.innerHTML = "▸";
    }
  }

  private getLayout(): PanelLayoutConfig[] {
    const s = this.plugin.settings;
    if (!s.panelLayout) s.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
    if (!Array.isArray(s.panelLayout.panels)) s.panelLayout.panels = [];
    return s.panelLayout.panels;
  }

  private persistLayout(layout: PanelLayoutConfig[]): void {
    const s = this.plugin.settings;
    if (!s) return;
    if (!s.panelLayout) s.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
    s.panelLayout.panels = layout;
    this.plugin.saveSettings?.();
  }
}
