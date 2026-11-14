/**
 * memory-graph-view.ts — 设定实体图视图（机制④）
 *
 * 借鉴催更姬 domain/memory：**实体卡 + 关系边**。
 * 卡片正文仍在 Markdown（用户可继续手写），本视图维护的是关系边：
 *  - 左侧按类型分组列出实体（来自项目索引），可搜索
 *  - 右侧显示选中实体的关系，可加/删关系
 *  - 「重新扫描」重建卡片索引（关系保留，孤儿边自动清理）
 */

import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import {
    addEdge,
    groupCards,
    MEMORY_EDGE_LABELS,
    MEMORY_TYPE_LABELS,
    memoryEdgeId,
    removeEdge,
    searchCards,
    validateEdge,
    type MemoryCard,
    type MemoryEdge,
    type MemoryEdgeType,
    type MemoryEntityType,
    type MemoryGraph,
} from '@/domains/memory/model';
import { MemoryGraphService } from '@/services/memory-graph-service';
import { describeSnapshot, type MemoryHistorySnapshot } from '@/domains/memory/history';
import { FileTxService } from '@/services/file-tx';
import { ProjectIndexService } from '@/services/project-index-service';
import { createLogger } from '@/shared/logger';

const log = createLogger('MemoryGraphView');

/** 视图类型 id */
export const MEMORY_GRAPH_VIEW_TYPE = 'novel-writer-memory-graph';

/**
 * 关系边的展示文本。
 *
 * @param edge - 关系边
 * @param cards - 卡片（用于解析名称）
 * @param perspective - 当前卡片 id（决定方向显示）
 * @returns 展示文本
 */
export function describeEdge(
    edge: MemoryEdge,
    cards: readonly MemoryCard[],
    perspective: string,
): string {
    const byId = new Map(cards.map(card => [card.id, card]));
    const isFrom = edge.from === perspective;
    const other = byId.get(isFrom ? edge.to : edge.from);
    const name = other?.name ?? '（已删除实体）';
    const label = edge.label || MEMORY_EDGE_LABELS[edge.type];
    return isFrom ? `${label} → ${name}` : `${name} → ${label}`;
}

/**
 * 设定实体图视图。
 */
export class MemoryGraphView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private project = '';
    private cards: MemoryCard[] = [];
    private graph: MemoryGraph | null = null;
    private selectedId: string | null = null;
    private query = '';
    private service: MemoryGraphService | null = null;
    /** 是否展开历史快照面板 */
    private showHistory = false;
    /** 历史快照（按需加载） */
    private history: MemoryHistorySnapshot[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    /**
     * 视图类型 id。
     *
     * @returns 视图类型
     */
    getViewType(): string { return MEMORY_GRAPH_VIEW_TYPE; }

    /**
     * 标签页显示名。
     *
     * @returns 显示名
     */
    getDisplayText(): string { return '设定实体图'; }

    /**
     * 标签页图标。
     *
     * @returns 图标 id
     */
    getIcon(): string { return 'share-2'; }

    /** 打开时加载数据并渲染 */
    async onOpen(): Promise<void> {
        this.project = this.plugin.getActiveProject() || '';
        const app = this.app;
        this.service = new MemoryGraphService(app, new ProjectIndexService(app), new FileTxService(app));
        await this.reload();
    }

    /** 关闭时清空 */
    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    /** 重新加载卡片与关系 */
    private async reload(): Promise<void> {
        if (!this.project || !this.service) {
            this.contentEl.empty();
            this.contentEl.createEl('p', { text: '请先打开一个项目，再打开设定实体图。' });
            return;
        }
        const loaded = await this.service.load(this.project);
        this.cards = loaded.cards;
        this.graph = loaded.graph;
        this.render();
    }

    /** 渲染整页 */
    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('nw-memory-graph');

        const toolbar = container.createDiv({ cls: 'nw-memory-toolbar' });
        toolbar.createEl('h3', { text: '🕸 设定实体图' });
        const search = toolbar.createEl('input', { cls: 'nw-memory-search', attr: { type: 'search', placeholder: '搜索实体…' } });
        search.value = this.query;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.render();
        });
        const historyButton = toolbar.createEl('button', {
            cls: 'nw-btn nw-btn-secondary',
            text: this.showHistory ? '收起历史' : '历史',
        });
        historyButton.addEventListener('click', () => {
            this.showHistory = !this.showHistory;
            if (this.showHistory) void this.loadHistory();
            else this.render();
        });
        const rescan = toolbar.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '重新扫描' });
        rescan.addEventListener('click', () => {
            void this.reload().then(() => new Notice('✅ 已重新扫描设定卡片'));
        });

        if (this.showHistory) this.renderHistoryPanel(container);

        const body = container.createDiv({ cls: 'nw-memory-body' });
        this.renderCardList(body.createDiv({ cls: 'nw-memory-cards' }));
        this.renderDetail(body.createDiv({ cls: 'nw-memory-detail' }));
    }

    /** 左侧卡片列表 */
    private renderCardList(container: HTMLElement): void {
        const matched = searchCards(this.cards, this.query, 200);
        const groups = groupCards(matched);
        for (const type of Object.keys(groups) as MemoryEntityType[]) {
            const list = groups[type];
            if (list.length === 0) continue;
            container.createDiv({ cls: 'nw-memory-group-title', text: `${MEMORY_TYPE_LABELS[type]}（${list.length}）` });
            for (const card of list) {
                const item = container.createDiv({ cls: 'nw-memory-card' });
                if (card.id === this.selectedId) item.addClass('nw-is-selected');
                item.createDiv({ cls: 'nw-memory-card-name', text: card.name });
                if (card.summary) item.createDiv({ cls: 'nw-memory-card-summary', text: card.summary });
                item.addEventListener('click', () => {
                    this.selectedId = card.id;
                    this.render();
                });
            }
        }
        if (matched.length === 0) {
            container.createEl('p', { cls: 'nw-memory-hint', text: '没有匹配的实体。检查项目里是否有 01-世界架构/人物 等设定文件。' });
        }
    }

    /** 右侧详情与关系编辑 */
    private renderDetail(container: HTMLElement): void {
        const card = this.cards.find(item => item.id === this.selectedId);
        if (!card || !this.graph) {
            container.createEl('p', { cls: 'nw-memory-hint', text: '选中左侧实体后，可查看并编辑它的关系。' });
            return;
        }
        container.createEl('h4', { text: `${card.name} · ${MEMORY_TYPE_LABELS[card.type]}` });
        container.createDiv({ cls: 'nw-memory-path', text: card.path });

        const edges = this.graph.edges.filter(edge => edge.from === card.id || edge.to === card.id);
        container.createDiv({ cls: 'nw-memory-group-title', text: `关系（${edges.length}）` });
        for (const edge of edges) {
            const row = container.createDiv({ cls: 'nw-memory-edge' });
            row.createSpan({ text: describeEdge(edge, this.cards, card.id) });
            const del = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '删除' });
            del.addEventListener('click', () => void this.deleteEdge(edge.id));
        }
        if (edges.length === 0) container.createEl('p', { cls: 'nw-memory-hint', text: '还没有关系。' });

        const form = container.createDiv({ cls: 'nw-memory-form' });
        const target = form.createEl('select', { cls: 'nw-memory-select' });
        for (const other of this.cards.filter(item => item.id !== card.id)) {
            target.createEl('option', { text: `${MEMORY_TYPE_LABELS[other.type]} · ${other.name}`, attr: { value: other.id } });
        }
        const typeSelect = form.createEl('select', { cls: 'nw-memory-select' });
        for (const [type, label] of Object.entries(MEMORY_EDGE_LABELS)) {
            typeSelect.createEl('option', { text: label, attr: { value: type } });
        }
        const add = form.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '添加关系' });
        add.addEventListener('click', () => void this.createEdge(card.id, target.value, typeSelect.value as MemoryEdgeType));
    }

    /** 加载历史快照并重渲染 */
    private async loadHistory(): Promise<void> {
        if (!this.service) return;
        this.history = await this.service.listHistory(this.project, 20);
        this.render();
    }

    /** 渲染历史快照面板（可恢复到某个快照） */
    private renderHistoryPanel(container: HTMLElement): void {
        const panel = container.createDiv({ cls: 'nw-memory-history' });
        panel.createDiv({ cls: 'nw-memory-group-title', text: `历史快照（${this.history.length}）` });
        if (this.history.length === 0) {
            panel.createEl('p', { cls: 'nw-memory-hint', text: '还没有历史快照。每次保存关系时会自动留档。' });
            return;
        }
        for (const snapshot of this.history) {
            const row = panel.createDiv({ cls: 'nw-memory-history-row' });
            row.createSpan({ text: describeSnapshot(snapshot) });
            const restore = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '恢复' });
            restore.addEventListener('click', () => void this.restoreSnapshot(snapshot.id));
        }
    }

    /** 恢复历史快照 */
    private async restoreSnapshot(snapshotId: string): Promise<void> {
        if (!this.service) return;
        const restored = await this.service.restoreHistory(this.project, snapshotId);
        if (!restored) {
            new Notice('❌ 找不到该快照');
            return;
        }
        this.graph = restored;
        this.history = await this.service.listHistory(this.project, 20);
        this.render();
        new Notice('✅ 已恢复到该快照（当前状态也留了历史）');
    }

    /** 新建关系 */
    private async createEdge(from: string, to: string, type: MemoryEdgeType): Promise<void> {
        if (!this.graph || !this.service) return;
        const edge: MemoryEdge = { id: memoryEdgeId(), from, to, type, label: '' };
        const rejection = validateEdge(edge, this.cards, this.graph.edges);
        if (rejection) {
            new Notice(`❌ ${rejection}`);
            return;
        }
        const next = addEdge(this.graph, edge, this.cards);
        if (!next) return;
        await this.persist(next);
    }

    /** 删除关系 */
    private async deleteEdge(edgeId: string): Promise<void> {
        if (!this.graph) return;
        await this.persist(removeEdge(this.graph, edgeId));
    }

    /** 保存并重渲染 */
    private async persist(next: MemoryGraph): Promise<void> {
        if (!this.service) return;
        try {
            this.graph = await this.service.save(this.project, next, '编辑关系');
            this.render();
        } catch (error) {
            new Notice('❌ 关系保存失败，请重试');
            log.error('关系保存失败:', error);
        }
    }
}
