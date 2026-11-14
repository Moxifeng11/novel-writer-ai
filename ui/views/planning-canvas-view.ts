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
import type NovelWriterPlugin from '@/main';
import {
    addEdge,
    autoLayout,
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
import { FileTxService } from '@/services/file-tx';
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
    /** 连线模式：等待选择目标节点 */
    private pendingEdge: PlanningEdgeType | null = null;
    /** 归入阶段模式 */
    private pendingParent = false;
    private canvasEl: HTMLElement | null = null;
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
    getDisplayText(): string { return '规划画布'; }

    /**
     * 标签页图标。
     *
     * @returns 图标 id
     */
    getIcon(): string { return 'git-branch'; }

    /** 打开视图时加载画布并渲染 */
    async onOpen(): Promise<void> {
        this.project = this.plugin.getActiveProject() || '';
        this.store = new PlanningStore(this.app, new FileTxService(this.app));
        await this.reload();
    }

    /** 关闭视图时清空 DOM */
    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    /** 重新加载画布 */
    private async reload(): Promise<void> {
        if (!this.project) {
            this.contentEl.empty();
            this.contentEl.createEl('p', { text: '请先打开一个项目，再打开规划画布。' });
            return;
        }
        this.canvas = this.store ? await this.store.load(this.project) : emptyCanvas();
        this.render();
    }

    /** 渲染整页 */
    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('nw-planning-canvas');

        const toolbar = container.createDiv({ cls: 'nw-planning-toolbar' });
        toolbar.createEl('h3', { text: '🗺 规划画布' });
        toolbar.createSpan({ cls: 'nw-planning-hint', text: '双击空白新建事件 · 拖动移动 · 选中后可连线/归入阶段' });
        const addButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '＋ 新事件' });
        addButton.addEventListener('click', () => void this.createNode({ x: 120, y: 120 }));
        const layoutButton = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '自动布局' });
        layoutButton.addEventListener('click', () => void this.applyAutoLayout());

        const stats = canvasStats(this.canvas);
        const statsEl = container.createDiv({ cls: 'nw-planning-stats' });
        for (const [status, count] of Object.entries(stats)) {
            statsEl.createSpan({ text: `${PLANNING_STATUS_LABELS[status as PlanningNodeStatus]} ${count}` });
        }

        const canvasEl = container.createDiv({ cls: 'nw-planning-surface' });
        this.canvasEl = canvasEl;
        canvasEl.addEventListener('dblclick', (event) => {
            if (event.target !== canvasEl) return;
            const rect = canvasEl.getBoundingClientRect();
            void this.createNode({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        });

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.addClass('nw-planning-edges');
        canvasEl.appendChild(svg);
        this.edgeLayer = svg;
        this.renderEdges();
        for (const node of this.canvas.nodes) this.renderNode(canvasEl, node);
        this.renderInspector(container);
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
            this.selectedId = node.id;
            this.render();
        });
    }

    /** 渲染右侧检查器 */
    private renderInspector(container: HTMLElement): void {
        const node = this.canvas.nodes.find(item => item.id === this.selectedId);
        const panel = container.createDiv({ cls: 'nw-planning-inspector' });
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

        const actions = panel.createDiv({ cls: 'nw-planning-actions' });
        const nextButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '连线 next' });
        nextButton.addEventListener('click', () => { this.pendingEdge = 'next'; new Notice('请点击目标节点'); });
        const requiresButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '依赖 requires' });
        requiresButton.addEventListener('click', () => { this.pendingEdge = 'requires'; new Notice('请点击目标节点'); });
        const parentButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '归入阶段' });
        parentButton.addEventListener('click', () => { this.pendingParent = true; new Notice('请点击父阶段节点'); });
        const deleteButton = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '删除' });
        deleteButton.addEventListener('click', () => void this.deleteNode(node.id));
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
        this.canvas = { ...this.canvas, nodes: [...this.canvas.nodes, node] };
        this.selectedId = node.id;
        await this.persist();
        this.render();
    }

    /** 更新节点字段 */
    private async updateNode(id: string, patch: Partial<PlanningNode>): Promise<void> {
        const nodes = this.canvas.nodes.map(node => (node.id === id ? { ...node, ...patch } : node));
        const candidate = { ...this.canvas, nodes };
        if (hasContainmentCycle(nodes)) {
            new Notice('❌ 该归属会形成环，已取消');
            return;
        }
        this.canvas = candidate;
        await this.persist();
        this.render();
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
        this.canvas = next;
        await this.persist();
        this.render();
    }

    /** 归入阶段 */
    private async attachTo(target: PlanningNode): Promise<void> {
        this.pendingParent = false;
        if (!this.selectedId || this.selectedId === target.id) return;
        await this.updateNode(this.selectedId, { parentId: target.id });
    }

    /** 删除节点 */
    private async deleteNode(id: string): Promise<void> {
        this.canvas = removeNode(this.canvas, id);
        this.selectedId = null;
        await this.persist();
        this.render();
    }

    /** 自动布局（只改坐标） */
    private async applyAutoLayout(): Promise<void> {
        const layout = autoLayout(this.canvas.nodes);
        const nodes = this.canvas.nodes.map(node => ({ ...node, position: layout.get(node.id) ?? node.position }));
        this.canvas = { ...this.canvas, nodes };
        await this.persist();
        this.render();
    }

    /** 拖动节点（只改坐标，不改层级/关系） */
    private beginDrag(event: PointerEvent, node: PlanningNode, el: HTMLElement): void {
        if (event.button !== 0) return;
        event.preventDefault();
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
            void this.persist();
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
