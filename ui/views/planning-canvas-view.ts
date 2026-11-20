/**
 * planning-canvas-view.ts — 规划事件画布视图（机制③）
 *
 * 借鉴催更姬 domain/planning：**节点是事件/选择/阶段，不是章节**。
 *  - 双击空白新建事件；拖动移动（只改坐标，不改层级/关系）
 *  - 选中节点后可改标题/状态/类型，可设为「已落文」需填正文证据
 *  - 连线：选中 A 后点「连线」再点 B（next/requires/alternative）
 *  - 阶段包含：选中子节点后点「归入阶段」再点父节点
 */

import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { t } from '@/i18n';
import type NovelWriterPlugin from '@/main';
import {
    addEdge,
    addNote,
    autoLayout,
    normalizeCanvas,
    removeNote,
    updateNote,
    type PlanningNote,
    canvasStats,
    emptyCanvas,
    hasContainmentCycle,
    planningId,
    PLANNING_KIND_LABELS,
    PLANNING_STATUS_LABELS,
    removeNode,
    type PlanningCanvas,
    type PlanningEdgeType,
    type PlanningNode,
    type PlanningNodeKind,
    type PlanningNodeStatus,
} from '@/domains/planning/model';
import { PlanningStore } from '@/services/planning-store';
import {
    clampZoom,
    filterPlanningNodes,
    formatZoom,
    nextMatch,
    stepZoom,
} from '@/ui/planning/canvas-tools';
import { FileTxService } from '@/services/file-tx';
import { listProjectIds } from '@/shared/project-catalog';
import { createLogger } from '@/shared/logger';

const log = createLogger('PlanningCanvas');

/** 视图类型 id */
export const PLANNING_CANVAS_VIEW_TYPE = 'novel-writer-planning-canvas';

/** 节点卡片宽高（用于布局与连线锚点） */
const NODE_W = 180;
const NODE_H = 76;

/**
 * 计算两个节点之间的连线端点（节点右侧中点到目标左侧中点）。
 *
 * @param from - 起点节点坐标
 * @param to - 终点节点坐标
 * @returns 连线端点
 */
export function planningEdgeLine(
    from: { x: number; y: number },
    to: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
    return {
        x1: from.x + NODE_W,
        y1: from.y + NODE_H / 2,
        x2: to.x,
        y2: to.y + NODE_H / 2,
    };
}

/**
 * 状态变更守卫：标记「已落文」必须有正文版本证据。
 *
 * @param node - 目标节点
 * @param status - 目标状态
 * @returns 允许返回 null，否则返回拒绝原因
 */
export function guardStatusChange(node: PlanningNode, status: PlanningNodeStatus): string | null {
    if (status === 'written' && (node.chapterRefs?.length ?? 0) === 0) {
        return '标记「已落文」需要正文证据：请先在章节里保存正文版本';
    }
    return null;
}

/**
 * 规划画布视图。
 */
export class PlanningCanvasView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private canvas: PlanningCanvas = emptyCanvas();
    private project = '';
    private selectedId: string | null = null;
    /** 撤销栈（画布 JSON 快照） */
    private undoStack: string[] = [];
    /** 重做栈 */
    private redoStack: string[] = [];
    /** 连线模式：等待选择目标节点 */
    private pendingEdge: PlanningEdgeType | null = null;
    /** 归入阶段模式 */
    private pendingParent = false;
    private canvasEl: HTMLElement | null = null;
    /** 缩放层（transform 应用在它上面，节点坐标保持画布坐标） */
    private zoomEl: HTMLElement | null = null;
    /** 画布缩放（1 = 100%） */
    private zoom = 1;
    /** 搜索关键字与命中列表 */
    private searchQuery = '';
    private searchMatches: string[] = [];
    /** 拖动开始前的画布快照（拖动结束统一压撤销栈） */
    private dragSnapshot: string | null = null;
    /** 删除二次确认的节点 id（点第一次「删除」后进入待确认） */
    private pendingDeleteId: string | null = null;
    private pendingDeleteTimer: number | null = null;
    /** 检查器宿主（只重绘检查器时需要引用） */
    private inspectorHost: HTMLElement | null = null;
    private edgeLayer: SVGSVGElement | null = null;
    private store: PlanningStore | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    /**
     * 视图类型 id。
     *
     * @returns 视图类型
     */
    getViewType(): string { return PLANNING_CANVAS_VIEW_TYPE; }

    /**
     * 标签页显示名。
     *
     * @returns 显示名
     */
    getDisplayText(): string { return t('shellView.planning'); }

    /**
     * 标签页图标。
     *
     * @returns 图标 id
     */
    getIcon(): string { return 'git-branch'; }

    /** 打开视图时加载画布并渲染 */
    async onOpen(): Promise<void> {
        this.project = this.resolveProject();
        this.store = new PlanningStore(this.app, new FileTxService(this.app));
        this.bindKeyboard();
        await this.reload();
    }

    /**
     * 解析要展示的项目：优先活动项目；只有一个项目时直接用；否则交给用户选。
     *
     * @returns 项目 id；无法确定时返回空串（渲染项目选择器）
     */
    private resolveProject(): string {
        const active = this.plugin.getActiveProject();
        if (active) return active;
        if (this.project && listProjectIds(this.app).includes(this.project)) return this.project;
        const projects = listProjectIds(this.app);
        // 只有一个项目时别让用户多点一次
        return projects.length === 1 ? projects[0] : '';
    }

    /** 关闭视图时清空 DOM */
    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    /**
     * 外部写入画布后重新加载（例如协同视图「记为事件」）。
     *
     * 视图是单例复用：不复用会读到旧画布，用户看不到刚登记的事件。
     *
     * @returns 无
     * @example
     * await view.refreshFromDisk();
     */
    async refreshFromDisk(): Promise<void> {
        this.project = this.resolveProject();
        if (!this.store) this.store = new PlanningStore(this.app, new FileTxService(this.app));
        await this.reload();
    }

    /** 重新加载画布 */
    private async reload(): Promise<void> {
        if (!this.project) {
            this.renderProjectPicker();
            return;
        }
        this.canvas = this.store ? await this.store.load(this.project) : emptyCanvas();
        this.render();
    }

    /**
     * 没有活动项目时：列出项目让用户选，而不是只提示一句话（P-04 同类断头）。
     */
    private renderProjectPicker(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('nw-planning-canvas');
        const panel = container.createDiv({ cls: 'nw-planning-picker' });
        panel.createEl('h3', { text: '🗺 规划画布' });
        const projects = listProjectIds(this.app);
        if (projects.length === 0) {
            panel.createEl('p', { cls: 'nw-planning-hint', text: '还没有项目。先在工作台创建或导入一个项目，再回来画规划。' });
            return;
        }
        panel.createEl('p', { cls: 'nw-planning-hint', text: '选择要规划的项目：' });
        const select = panel.createEl('select', { cls: 'nw-planning-select', attr: { 'aria-label': '选择项目' } });
        for (const project of projects) {
            select.createEl('option', { text: project, attr: { value: project } });
        }
        const openButton = panel.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '打开规划画布' });
        openButton.addEventListener('click', () => {
            this.project = select.value;
            void this.reload();
        });
    }

    /** 渲染整页 */
    /** 渲染整页 */
    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('nw-planning-canvas');

        this.renderToolbar(container);

        const stats = canvasStats(this.canvas);
        const statsEl = container.createDiv({ cls: 'nw-planning-stats' });
        for (const [status, count] of Object.entries(stats)) {
            statsEl.createSpan({ text: `${PLANNING_STATUS_LABELS[status as PlanningNodeStatus]} ${count}` });
        }

        const body = container.createDiv({ cls: 'nw-planning-body' });
        const canvasEl = body.createDiv({ cls: 'nw-planning-surface' });
        this.canvasEl = canvasEl;

        // 缩放层：transform 只作用于这一层，节点仍用画布坐标，拖动/命中不受缩放影响
        const zoomEl = canvasEl.createDiv({ cls: 'nw-planning-zoom' });
        this.zoomEl = zoomEl;
        this.applyZoom();

        canvasEl.addEventListener('dblclick', (event) => {
            if (event.target !== canvasEl && event.target !== zoomEl) return;
            const point = this.surfaceToCanvas(event.clientX, event.clientY);
            void this.createNode(point);
        });
        // 平移：中键拖动空白处（左键保留给选择/拖动节点，双击新建）
        this.bindPan(canvasEl);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.addClass('nw-planning-edges');
        zoomEl.appendChild(svg);
        this.edgeLayer = svg;
        this.renderEdges();
        for (const note of this.canvas.notes ?? []) this.renderNote(zoomEl, note);
        for (const node of this.canvas.nodes) this.renderNode(zoomEl, node);
        this.applySearchHighlight();
        this.renderInspector(body);
    }

    /** 渲染顶部工具栏（新建/便签/撤销/重做/布局/搜索/缩放） */
    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: 'nw-planning-toolbar' });
        toolbar.createEl('h3', { text: '🗺 规划画布' });
        toolbar.createSpan({ cls: 'nw-planning-hint', text: '双击空白新建事件 · 拖动移动 · 中键拖动平移 · Ctrl+滚轮缩放' });

        const addButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '＋ 新事件', attr: { title: '在画布中央新建一个事件节点' } });
        addButton.addEventListener('click', () => void this.createNode(this.centerPoint()));
        const noteButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '＋ 便签', attr: { title: '新建便签（记台词/未决问题）' } });
        noteButton.addEventListener('click', () => void this.createNote());
        const undoButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '↶ 撤销', attr: { title: '撤销上一步画布操作（Ctrl+Z）' } });
        undoButton.addEventListener('click', () => void this.undo());
        const redoButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '↷ 重做', attr: { title: '重做（Ctrl+Shift+Z）' } });
        redoButton.addEventListener('click', () => void this.redo());
        const layoutButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '自动布局', attr: { title: '按包含/因果关系重新排布所有节点' } });
        layoutButton.addEventListener('click', () => void this.applyAutoLayout());

        // 搜索：按标题/摘要过滤并高亮命中，Enter 循环定位
        const searchWrap = toolbar.createDiv({ cls: 'nw-planning-search' });
        const searchInput = searchWrap.createEl('input', {
            cls: 'nw-planning-search-input',
            attr: { type: 'search', placeholder: '搜索事件…', value: this.searchQuery, 'aria-label': '搜索规划事件' },
        }) as HTMLInputElement;
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            this.searchMatches = filterPlanningNodes(this.canvas.nodes, this.searchQuery);
            this.renderSearchCount();
            this.applySearchHighlight();
        });
        searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const target = nextMatch(this.searchMatches, this.selectedId, event.shiftKey ? -1 : 1);
                if (target) this.selectNode(target);
            } else if (event.key === 'Escape') {
                searchInput.value = '';
                this.searchQuery = '';
                this.searchMatches = [];
                this.renderSearchCount();
                this.applySearchHighlight();
            }
        });
        const searchCount = searchWrap.createSpan({ cls: 'nw-planning-search-count' });
        searchCount.dataset.role = 'search-count';

        // 缩放：按钮 + 百分比（Ctrl+滚轮也可）
        const zoomWrap = toolbar.createDiv({ cls: 'nw-planning-zoom-controls' });
        const zoomOut = zoomWrap.createEl('button', { cls: 'nw-planning-zoom-btn', text: '−', attr: { title: '缩小画布（滚轮配合修饰键）' } });
        zoomOut.addEventListener('click', () => this.setZoom(stepZoom(this.zoom, -1)));
        const zoomLabel = zoomWrap.createEl('button', { cls: 'nw-planning-zoom-btn nw-planning-zoom-label', text: formatZoom(this.zoom), attr: { title: '点击恢复 100%' } });
        zoomLabel.dataset.role = 'zoom-label';
        zoomLabel.addEventListener('click', () => this.setZoom(1));
        const zoomIn = zoomWrap.createEl('button', { cls: 'nw-planning-zoom-btn', text: '＋', attr: { title: '放大画布（滚轮配合修饰键）' } });
        zoomIn.addEventListener('click', () => this.setZoom(stepZoom(this.zoom, 1)));

        this.canvasEl?.addEventListener('wheel', (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            this.setZoom(stepZoom(this.zoom, event.deltaY > 0 ? -1 : 1));
        }, { passive: false });
    }

    /** 刷新搜索命中数 */
    private renderSearchCount(): void {
        const el = this.contentEl.querySelector('[data-role="search-count"]');
        if (!el) return;
        el.textContent = this.searchQuery.trim()
            ? `${this.searchMatches.length} 个命中`
            : '';
    }

    /** 应用搜索高亮：非命中节点变淡 */
    private applySearchHighlight(): void {
        if (!this.zoomEl) return;
        const active = this.searchMatches.length > 0;
        const hit = new Set(this.searchMatches);
        this.zoomEl.querySelectorAll<HTMLElement>('.nw-planning-node').forEach(nodeEl => {
            const id = nodeEl.dataset.nodeId ?? '';
            nodeEl.toggleClass('nw-planning-node-dim', active && !hit.has(id));
            nodeEl.toggleClass('nw-planning-node-hit', active && hit.has(id));
        });
    }

    /** 屏幕坐标 → 画布坐标（考虑缩放） */
    private surfaceToCanvas(clientX: number, clientY: number): { x: number; y: number } {
        const rect = (this.canvasEl ?? this.contentEl).getBoundingClientRect();
        return {
            x: Math.max(0, (clientX - rect.left) / this.zoom),
            y: Math.max(0, (clientY - rect.top) / this.zoom),
        };
    }

    /** 画布中央坐标（新节点落点） */
    private centerPoint(): { x: number; y: number } {
        const el = this.canvasEl;
        if (!el) return { x: 120, y: 120 };
        return { x: Math.round(el.clientWidth / 2 / this.zoom), y: Math.round(el.clientHeight / 2 / this.zoom) };
    }

    /**
     * 设置缩放并刷新。
     *
     * @param next - 目标缩放（会被夹紧到合法范围）
     */
    private setZoom(next: number): void {
        this.zoom = clampZoom(next);
        this.applyZoom();
        const label = this.contentEl.querySelector('[data-role="zoom-label"]');
        if (label) label.textContent = formatZoom(this.zoom);
    }

    /** 把缩放写到 transform 上（缩放原点左上，便于坐标换算） */
    private applyZoom(): void {
        if (!this.zoomEl) return;
        // 缩放通过 CSS 变量驱动（transform-origin 在样式表里固定为 0 0）：
        // 直接写 style.transformOrigin 会被 obsidianmd/no-static-styles-assignment 拦截。
        this.zoomEl.style.setProperty('--nw-planning-zoom', String(this.zoom));
    }

    /**
     * 中键拖动平移画布。
     *
     * @param canvasEl - 画布容器
     */
    private bindPan(canvasEl: HTMLElement): void {
        let panning = false;
        let lastX = 0;
        let lastY = 0;
        canvasEl.addEventListener('pointerdown', (event: PointerEvent) => {
            if (event.button !== 1) return;
            event.preventDefault();
            panning = true;
            lastX = event.clientX;
            lastY = event.clientY;
            canvasEl.setPointerCapture(event.pointerId);
            canvasEl.addClass('nw-planning-panning');
        });
        canvasEl.addEventListener('pointermove', (event: PointerEvent) => {
            if (!panning) return;
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            canvasEl.scrollLeft -= dx;
            canvasEl.scrollTop -= dy;
        });
        const stop = (): void => {
            panning = false;
            canvasEl.removeClass('nw-planning-panning');
        };
        canvasEl.addEventListener('pointerup', stop);
        canvasEl.addEventListener('pointercancel', stop);
    }

    /**
     * 选中节点：只更新选中样式与检查器，不做整页重建（P-08）。
     *
     * @param nodeId - 节点 id
     */
    private selectNode(nodeId: string): void {
        this.selectedId = nodeId;
        // 用户主动切到别的节点时取消「待确认删除」
        if (this.pendingDeleteId !== nodeId) {
            this.pendingDeleteId = null;
            if (this.pendingDeleteTimer !== null) {
                window.clearTimeout(this.pendingDeleteTimer);
                this.pendingDeleteTimer = null;
            }
        }
        this.applySelectionStyles();
        this.refreshInspector();
    }

    /** 只刷新节点选中样式（不动检查器、不清待确认状态） */
    private applySelectionStyles(): void {
        const selected = this.selectedId;
        this.zoomEl?.querySelectorAll<HTMLElement>('.nw-planning-node').forEach(el => {
            el.toggleClass('nw-is-selected', el.dataset.nodeId === selected);
        });
    }

    /** 只重绘检查器 */
    private refreshInspector(): void {
        if (!this.inspectorHost) return;
        this.inspectorHost.empty();
        this.buildInspector(this.inspectorHost);
    }

    /** 渲染便签（双击编辑，拖动移动） */
    private renderNote(canvasEl: HTMLElement, note: PlanningNote): void {
        const el = canvasEl.createDiv({ cls: `nw-planning-note nw-planning-note-${note.color ?? 'yellow'}` });
        el.style.left = `${note.position.x}px`;
        el.style.top = `${note.position.y}px`;
        el.setText(note.text || '双击编辑');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-label', `便签：${note.text.slice(0, 20)}`);
        el.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            this.beginNoteEdit(el, note);
        });
        el.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault();
                event.stopPropagation();
                this.beginNoteEdit(el, note);
            }
        });
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;
        el.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            startX = event.clientX;
            startY = event.clientY;
            originX = note.position.x;
            originY = note.position.y;
            el.setPointerCapture(event.pointerId);
        });
        el.addEventListener('pointermove', (event) => {
            if (!el.hasPointerCapture(event.pointerId)) return;
            const x = Math.max(0, originX + event.clientX - startX);
            const y = Math.max(0, originY + event.clientY - startY);
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        });
        el.addEventListener('pointerup', (event) => {
            if (!el.hasPointerCapture(event.pointerId)) return;
            el.releasePointerCapture(event.pointerId);
            const x = Math.max(0, originX + event.clientX - startX);
            const y = Math.max(0, originY + event.clientY - startY);
            if (x === note.position.x && y === note.position.y) return;
            void this.mutate(canvas => updateNote(canvas, note.id, { position: { x, y } }));
        });
    }

    /**
     * 就地编辑便签：用内联 textarea 替代 window.prompt。
     *
     * 交互：双击/Enter 进入编辑；Esc 取消；Ctrl+Enter 或失焦保存；清空保存即删除。
     *
     * @param el - 便签元素
     * @param note - 便签数据
     */
    private beginNoteEdit(el: HTMLElement, note: PlanningNote): void {
        if (el.querySelector('textarea')) return;
        const original = note.text;
        const textarea = el.createEl('textarea', { cls: 'nw-planning-note-input' }) as HTMLTextAreaElement;
        textarea.value = original;
        textarea.dataset.noteEditing = '1';
        el.setText('');
        // setText 会清空子节点，重新挂回 textarea
        el.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(original.length, original.length);
        let finished = false;
        const finish = (save: boolean): void => {
            if (finished) return;
            finished = true;
            const next = textarea.value;
            if (!save) {
                this.render();
                return;
            }
            if (!next.trim()) {
                void this.mutate(canvas => removeNote(canvas, note.id));
                return;
            }
            if (next === original) {
                this.render();
                return;
            }
            void this.mutate(canvas => updateNote(canvas, note.id, { text: next }));
        };
        textarea.addEventListener('keydown', (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                finish(true);
            } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                finish(true);
            }
        });
        textarea.addEventListener('blur', () => finish(true));
    }

    /** 新建便签 */
    private async createNote(): Promise<void> {
        const position = { x: 160, y: 160 };
        await this.mutate(canvas => addNote(canvas, '双击编辑便签', position));
    }

    /**
     * 压一次撤销快照（同一份画布状态不重复压栈）。
     *
     * @param snapshot - 变更前的画布 JSON；省略时自动序列化当前画布
     */
    private pushUndo(snapshot?: string): void {
        const serialized = snapshot ?? JSON.stringify(this.canvas);
        if (this.undoStack[this.undoStack.length - 1] === serialized) return;
        this.undoStack.push(serialized);
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
    }

    /**
     * 统一变更入口：先压撤销栈，再改画布并落盘。
     *
     * 2026-11-16（P-01）：旧实现只有便签走这里，节点的新建/删除/改标题/
     * 改状态/连线/归入阶段/拖动/自动布局全走 persist()（不压栈），
     * 于是「↶ 撤销」对事件节点完全无效，且撤销到旧快照会静默丢掉新节点。
     * 现在所有变更都必须经过这里。
     *
     * @param updater - 画布变更函数
     * @param options - snapshot 指定变更前快照（拖动用）；silent 不重绘（拖动结束）
     */
    private async mutate(
        updater: (canvas: PlanningCanvas) => PlanningCanvas,
        options: { snapshot?: string; skipUndo?: boolean } = {},
    ): Promise<void> {
        if (!this.store || !this.project) return;
        if (!options.skipUndo) this.pushUndo(options.snapshot);
        this.canvas = await this.store.save(this.project, updater(this.canvas));
        this.render();
    }

    /**
     * 画布级键盘快捷键（Ctrl+Z 撤销 / Ctrl+Shift+Z 重做）。
     *
     * 注册在视图容器上，避免全局监听影响其它视图。
     */
    private bindKeyboard(): void {
        this.containerEl.addEventListener('keydown', (event: KeyboardEvent) => {
            const mod = event.ctrlKey || event.metaKey;
            if (!mod) return;
            const key = event.key.toLowerCase();
            if (key === 'z') {
                event.preventDefault();
                if (event.shiftKey) void this.redo();
                else void this.undo();
            } else if (key === 'y') {
                event.preventDefault();
                void this.redo();
            }
        });
    }

    /** 撤销上一步 */
    private async undo(): Promise<void> {
        if (!this.store || !this.project || this.undoStack.length === 0) return;
        const previous = this.undoStack.pop() as string;
        this.redoStack.push(JSON.stringify(this.canvas));
        this.canvas = await this.store.save(this.project, normalizeCanvas(JSON.parse(previous) as PlanningCanvas));
        if (this.selectedId && !this.canvas.nodes.some(node => node.id === this.selectedId)) this.selectedId = null;
        this.render();
    }

    /** 重做 */
    private async redo(): Promise<void> {
        if (!this.store || !this.project || this.redoStack.length === 0) return;
        const next = this.redoStack.pop() as string;
        this.undoStack.push(JSON.stringify(this.canvas));
        this.canvas = await this.store.save(this.project, normalizeCanvas(JSON.parse(next) as PlanningCanvas));
        this.render();
    }

    /** 渲染连线层 */
    private renderEdges(): void {
        const svg = this.edgeLayer;
        if (!svg) return;
        svg.empty();
        const byId = new Map(this.canvas.nodes.map(node => [node.id, node]));
        for (const edge of this.canvas.edges) {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) continue;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const geometry = planningEdgeLine(from.position, to.position);
            line.setAttribute('x1', String(geometry.x1));
            line.setAttribute('y1', String(geometry.y1));
            line.setAttribute('x2', String(geometry.x2));
            line.setAttribute('y2', String(geometry.y2));
            line.setAttribute('class', `nw-planning-edge nw-planning-edge-${edge.type}`);
            svg.appendChild(line);
        }
    }

    /** 渲染单个节点卡片 */
    private renderNode(canvasEl: HTMLElement, node: PlanningNode): void {
        const el = canvasEl.createDiv({ cls: `nw-planning-node nw-is-${node.status}` });
        if (node.id === this.selectedId) el.addClass('nw-is-selected');
        el.style.left = `${node.position.x}px`;
        el.style.top = `${node.position.y}px`;
        el.createDiv({ cls: 'nw-planning-node-kind', text: `${PLANNING_KIND_LABELS[node.kind]} · ${PLANNING_STATUS_LABELS[node.status]}` });
        el.createDiv({ cls: 'nw-planning-node-title', text: node.title });
        if (node.summary) el.createDiv({ cls: 'nw-planning-node-summary', text: node.summary });

        el.dataset.nodeId = node.id;
        // 键盘可达（P-11）：Tab 聚焦，方向键微移，Enter 选中，Delete 删除
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute(
            'aria-label',
            `${PLANNING_KIND_LABELS[node.kind]}：${node.title}（${PLANNING_STATUS_LABELS[node.status]}）`,
        );
        el.addEventListener('pointerdown', (event) => this.beginDrag(event, node, el));
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.pendingEdge) {
                void this.connectTo(node);
                return;
            }
            if (this.pendingParent) {
                void this.attachTo(node);
                return;
            }
            // 只更新选中样式与检查器，不整页重建（P-08：保住焦点/滚动/输入内容）
            this.selectNode(node.id);
        });
        el.addEventListener('keydown', (event: KeyboardEvent) => {
            if (this.pendingEdge || this.pendingParent) return;
            const step = event.shiftKey ? 1 : 10;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const position = {
                    x: Math.max(0, node.position.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
                    y: Math.max(0, node.position.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)),
                };
                void this.updateNode(node.id, { position });
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                this.selectNode(node.id);
                return;
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                void this.requestDelete(node.id);
            }
        });
    }

    /** 渲染右侧检查器容器（内容由 buildInspector 填充，便于只重绘检查器） */
    private renderInspector(host: HTMLElement): void {
        this.inspectorHost = host.createDiv({ cls: 'nw-planning-inspector' });
        this.buildInspector(this.inspectorHost);
    }

    /** 填充检查器内容 */
    private buildInspector(panel: HTMLElement): void {
        const node = this.canvas.nodes.find(item => item.id === this.selectedId);
        if (!node) {
            panel.createEl('p', { cls: 'nw-planning-hint', text: '选中一个节点后可编辑。' });
            return;
        }
        const titleInput = panel.createEl('input', { cls: 'nw-planning-input', attr: { type: 'text', value: node.title } });
        titleInput.addEventListener('change', () => void this.updateNode(node.id, { title: titleInput.value.trim() || node.title }));
        const summaryInput = panel.createEl('textarea', { cls: 'nw-planning-textarea', attr: { rows: '3' } });
        summaryInput.value = node.summary;
        summaryInput.addEventListener('change', () => void this.updateNode(node.id, { summary: summaryInput.value }));

        const kindSelect = panel.createEl('select', { cls: 'nw-planning-select' });
        for (const [kind, label] of Object.entries(PLANNING_KIND_LABELS)) {
            const option = kindSelect.createEl('option', { text: label, attr: { value: kind } });
            if (kind === node.kind) option.selected = true;
        }
        kindSelect.addEventListener('change', () => void this.updateNode(node.id, { kind: kindSelect.value as PlanningNodeKind }));

        const statusSelect = panel.createEl('select', { cls: 'nw-planning-select' });
        for (const [status, label] of Object.entries(PLANNING_STATUS_LABELS)) {
            const option = statusSelect.createEl('option', { text: label, attr: { value: status } });
            if (status === node.status) option.selected = true;
        }
        statusSelect.addEventListener('change', () => void this.setStatus(node.id, statusSelect.value as PlanningNodeStatus));

        // 规划 ↔ 正文：关联章节号，并可跳到该章正文（P-07）
        const chapterRow = panel.createDiv({ cls: 'nw-planning-chapter-row' });
        chapterRow.createSpan({ cls: 'nw-planning-hint', text: '关联章节' });
        const chapterInput = chapterRow.createEl('input', {
            cls: 'nw-planning-input nw-planning-chapter-input',
            attr: { type: 'number', min: '1', step: '1', value: node.chapterNum ? String(node.chapterNum) : '', 'aria-label': '关联章节号' },
        }) as HTMLInputElement;
        chapterInput.addEventListener('change', () => {
            const parsed = Number(chapterInput.value);
            const chapterNum = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
            void this.updateNode(node.id, { chapterNum });
        });
        const openChapterBtn = chapterRow.createEl('button', {
            cls: 'nw-btn nw-btn-secondary',
            text: '打开该章',
            attr: { title: '在协同写作视图打开关联章节的正文' },
        });
        openChapterBtn.addEventListener('click', () => {
            if (!node.chapterNum) {
                new Notice('先填关联章节号');
                return;
            }
            void this.openChapterOfNode(node.chapterNum);
        });

        const actions = panel.createDiv({ cls: 'nw-planning-actions' });
        const nextButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '连线 next' });
        nextButton.addEventListener('click', () => { this.pendingEdge = 'next'; new Notice('请点击目标节点'); });
        const requiresButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '依赖 requires' });
        requiresButton.addEventListener('click', () => { this.pendingEdge = 'requires'; new Notice('请点击目标节点'); });
        const parentButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '归入阶段' });
        parentButton.addEventListener('click', () => { this.pendingParent = true; new Notice('请点击父阶段节点'); });
        // 删除改为两步确认（P-02）：误点不会直接丢节点
        const deleteButton = actions.createEl('button', {
            cls: 'nw-btn nw-btn-secondary nw-planning-danger',
            text: this.pendingDeleteId === node.id ? '再点一次确认删除' : '删除',
            attr: { title: '删除事件节点（需二次确认，可撤销）' },
        });
        deleteButton.addEventListener('click', () => void this.requestDelete(node.id));
    }

    /**
     * 请求删除节点：第一次点击进入待确认，3 秒后自动复位。
     *
     * @param nodeId - 节点 id
     */
    private async requestDelete(nodeId: string): Promise<void> {
        if (this.pendingDeleteId !== nodeId) {
            this.pendingDeleteId = nodeId;
            if (this.pendingDeleteTimer !== null) window.clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = window.setTimeout(() => {
                this.pendingDeleteId = null;
                this.pendingDeleteTimer = null;
                this.refreshInspector();
            }, 3000);
            // 注意：这里不能调用 selectNode —— 它会认为「切到别的节点」而清掉刚设的待确认
            this.selectedId = nodeId;
            this.applySelectionStyles();
            this.refreshInspector();
            return;
        }
        if (this.pendingDeleteTimer !== null) {
            window.clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = null;
        }
        this.pendingDeleteId = null;
        await this.deleteNode(nodeId);
    }

    /**
     * 打开节点关联的章节正文。
     *
     * @param chapterNum - 章节号
     */
    private async openChapterOfNode(chapterNum: number): Promise<void> {
        try {
            await this.plugin.activateCoWritingView(this.project, `第${chapterNum}章`, '', chapterNum);
        } catch (error) {
            log.warn('打开关联章节失败:', error);
            new Notice('❌ 打开章节失败，请确认该章已创建');
        }
    }

    /** 双击空白新建节点 */
    private async createNode(position: { x: number; y: number }): Promise<void> {
        const node: PlanningNode = {
            id: planningId('node'),
            title: '新事件',
            summary: '',
            kind: 'event',
            status: 'idea',
            parentId: null,
            position,
        };
        this.selectedId = node.id;
        await this.mutate(canvas => ({ ...canvas, nodes: [...canvas.nodes, node] }));
    }

    /** 更新节点字段 */
    private async updateNode(id: string, patch: Partial<PlanningNode>): Promise<void> {
        const nodes = this.canvas.nodes.map(node => (node.id === id ? { ...node, ...patch } : node));
        const candidate = { ...this.canvas, nodes };
        if (hasContainmentCycle(nodes)) {
            new Notice('❌ 该归属会形成环，已取消');
            return;
        }
        // 状态/归属变更同样要可撤销
        void candidate;
        await this.mutate(() => candidate);
    }

    /** 改状态：written 需要正文证据 */
    private async setStatus(id: string, status: PlanningNodeStatus): Promise<void> {
        const node = this.canvas.nodes.find(item => item.id === id);
        if (!node) return;
        const rejection = guardStatusChange(node, status);
        if (rejection) {
            new Notice(`⚠️ ${rejection}`);
            return;
        }
        await this.updateNode(id, { status });
    }

    /** 连线到目标节点 */
    private async connectTo(target: PlanningNode): Promise<void> {
        const type = this.pendingEdge;
        this.pendingEdge = null;
        if (!type || !this.selectedId) return;
        const next = addEdge(this.canvas, { id: planningId('edge'), from: this.selectedId, to: target.id, type });
        if (!next) {
            new Notice('❌ 连线无效（自连或重复）');
            return;
        }
        await this.mutate(() => next);
    }

    /** 归入阶段 */
    private async attachTo(target: PlanningNode): Promise<void> {
        this.pendingParent = false;
        if (!this.selectedId || this.selectedId === target.id) return;
        await this.updateNode(this.selectedId, { parentId: target.id });
    }

    /** 删除节点 */
    private async deleteNode(id: string): Promise<void> {
        this.selectedId = null;
        await this.mutate(canvas => removeNode(canvas, id));
    }

    /** 自动布局（只改坐标） */
    private async applyAutoLayout(): Promise<void> {
        const layout = autoLayout(this.canvas.nodes);
        const nodes = this.canvas.nodes.map(node => ({ ...node, position: layout.get(node.id) ?? node.position }));
        await this.mutate(canvas => ({ ...canvas, nodes }));
    }

    /** 拖动节点（只改坐标，不改层级/关系） */
    private beginDrag(event: PointerEvent, node: PlanningNode, el: HTMLElement): void {
        if (event.button !== 0) return;
        event.preventDefault();
        // 拖动前的快照：整段拖动只记一步撤销（而不是每个 pointermove 一步）
        this.dragSnapshot = JSON.stringify(this.canvas);
        const startX = event.clientX;
        const startY = event.clientY;
        const origin = { ...node.position };
        const doc = el.ownerDocument;
        const move = (moveEvent: PointerEvent): void => {
            const next = {
                x: Math.max(0, origin.x + (moveEvent.clientX - startX)),
                y: Math.max(0, origin.y + (moveEvent.clientY - startY)),
            };
            node.position = next;
            el.style.left = `${next.x}px`;
            el.style.top = `${next.y}px`;
            this.renderEdges();
        };
        const up = (): void => {
            doc.removeEventListener('pointermove', move);
            doc.removeEventListener('pointerup', up);
            const snapshot = this.dragSnapshot;
            this.dragSnapshot = null;
            // 没真正移动就不入撤销栈（避免「点一下节点」产生空快照）
            if (!snapshot || JSON.stringify(this.canvas) === snapshot) {
                void this.persist();
                return;
            }
            void this.mutate(() => this.canvas, { snapshot });
        };
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', up);
    }

    /** 保存画布 */
    private async persist(): Promise<void> {
        if (!this.store || !this.project) return;
        try {
            this.canvas = await this.store.save(this.project, this.canvas);
        } catch (error) {
            new Notice('❌ 规划画布保存失败，请重试');
            log.error('画布保存失败:', error);
        }
    }
}
