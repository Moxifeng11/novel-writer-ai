/**
 * planning-model.ts — 规划事件画布模型（纯函数）
 *
 * 借鉴催更姬 domain/planning：**节点是事件/选择/阶段，不是章节**。
 *  - 阶段用 parentId「包含」子情节（包含 ≠ 因果）
 *  - 因果/顺序用 edge（next / requires / alternative）
 *  - 画布坐标与语义分离：拖动只改 position，不改层级与关系
 *  - written 状态必须有正文版本证据（chapterRefs）
 *
 * 纯函数：不碰 Obsidian API。
 */

/** 节点类型 */
export type PlanningNodeKind = 'event' | 'stage' | 'choice';

/** 节点状态 */
export type PlanningNodeStatus = 'idea' | 'selected' | 'written' | 'dropped';

/** 正文版本引用 */
export interface ChapterRef {
    chapterId: string;
    revision: number;
}

/** 规划节点 */
export interface PlanningNode {
    id: string;
    /** 标题 */
    title: string;
    /** 一句话摘要 */
    summary: string;
    kind: PlanningNodeKind;
    status: PlanningNodeStatus;
    /** 父阶段（包含关系；null 为顶层） */
    parentId: string | null;
    /** 画布坐标 */
    position: { x: number; y: number };
    /** 已落正文的证据（written 必填） */
    chapterRefs?: ChapterRef[];
}

/** 连线类型 */
export type PlanningEdgeType = 'next' | 'requires' | 'alternative';

/** 连线 */
export interface PlanningEdge {
    id: string;
    from: string;
    to: string;
    type: PlanningEdgeType;
}

/** 规划画布 */
/** 画布便签（记台词、未决问题、灵感；不参与因果，只是贴纸） */
export interface PlanningNote {
    /** 便签 id */
    id: string;
    /** 文本 */
    text: string;
    /** 画布坐标 */
    position: { x: number; y: number };
    /** 配色（默认黄） */
    color?: 'yellow' | 'blue' | 'pink' | 'green';
}

/**
 * 规划画布数据（事件节点 + 因果连线 + 便签）。
 */
export interface PlanningCanvas {
    version: 1;
    /** 更新时间 */
    updatedAt: number;
    /** 节点 */
    nodes: PlanningNode[];
    /** 连线 */
    edges: PlanningEdge[];
    /** 便签（旧数据可能没有） */
    notes: PlanningNote[];
}

/** 规划画布格式版本 */
export const PLANNING_CANVAS_VERSION = 1 as const;

/** 状态中文名 */
export const PLANNING_STATUS_LABELS: Record<PlanningNodeStatus, string> = {
    idea: '想法',
    selected: '已选定',
    written: '已落文',
    dropped: '已放弃',
};

/** 节点类型中文名 */
export const PLANNING_KIND_LABELS: Record<PlanningNodeKind, string> = {
    event: '事件',
    stage: '阶段',
    choice: '选择',
};

/**
 * 空画布。
 *
 * @param now - 时间戳
 * @returns 空画布
 */
export function emptyCanvas(now: number = Date.now()): PlanningCanvas {
    return { version: PLANNING_CANVAS_VERSION, updatedAt: now, nodes: [], edges: [], notes: [] };
}

/**
 * 生成节点/连线 id。
 *
 * @param prefix - 前缀（node/edge）
 * @param now - 时间戳
 * @param random - 随机数
 * @returns id
 */
export function planningId(prefix: string, now: number = Date.now(), random: number = Math.random()): string {
    return `${prefix}-${now}-${Math.floor(random * 36 ** 3).toString(36).padStart(3, '0')}`;
}

/**
 * 校验节点是否满足状态约束：written 必须有正文证据。
 *
 * @param node - 节点
 * @returns 合法返回 null，否则返回原因
 */
export function validateNode(node: PlanningNode): string | null {
    if (!node.title.trim()) return '标题不能为空';
    if (node.status === 'written' && (node.chapterRefs?.length ?? 0) === 0) {
        return '标记「已落文」必须提供正文版本证据（chapterRefs）';
    }
    return null;
}

/**
 * 构建包含树（parentId → 子节点），并检测孤儿与环。
 *
 * @param nodes - 节点列表
 * @returns 顶层节点与「节点 id → 子节点」映射
 */
export function buildContainmentTree(nodes: readonly PlanningNode[]): {
    roots: PlanningNode[];
    childrenOf: Map<string, PlanningNode[]>;
    orphans: PlanningNode[];
} {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const childrenOf = new Map<string, PlanningNode[]>();
    const roots: PlanningNode[] = [];
    const orphans: PlanningNode[] = [];
    for (const node of nodes) {
        if (node.parentId === null) {
            roots.push(node);
            continue;
        }
        if (!byId.has(node.parentId)) {
            orphans.push(node);
            continue;
        }
        const siblings = childrenOf.get(node.parentId) ?? [];
        siblings.push(node);
        childrenOf.set(node.parentId, siblings);
    }
    return { roots, childrenOf, orphans };
}

/**
 * 检测包含关系中的环（A 包含 B，B 又包含 A）。
 *
 * @param nodes - 节点列表
 * @returns 存在环返回 true
 */
export function hasContainmentCycle(nodes: readonly PlanningNode[]): boolean {
    const parentOf = new Map(nodes.map(node => [node.id, node.parentId]));
    for (const node of nodes) {
        const seen = new Set<string>([node.id]);
        let current = node.parentId;
        while (current) {
            if (seen.has(current)) return true;
            seen.add(current);
            current = parentOf.get(current) ?? null;
        }
    }
    return false;
}

/**
 * 添加连线（自环与重复连线被拒绝）。
 *
 * @param canvas - 画布
 * @param edge - 连线
 * @returns 新画布；非法返回 null
 */
export function addEdge(canvas: PlanningCanvas, edge: PlanningEdge): PlanningCanvas | null {
    if (edge.from === edge.to) return null;
    const ids = new Set(canvas.nodes.map(node => node.id));
    if (!ids.has(edge.from) || !ids.has(edge.to)) return null;
    if (canvas.edges.some(item => item.from === edge.from && item.to === edge.to && item.type === edge.type)) {
        return null;
    }
    return { ...canvas, edges: [...canvas.edges, edge], updatedAt: Date.now() };
}

/**
 * 删除节点及其相关连线；子节点上移到被删节点的父级（不连带删除子树）。
 *
 * @param canvas - 画布
 * @param nodeId - 节点 id
 * @returns 新画布
 */
export function removeNode(canvas: PlanningCanvas, nodeId: string): PlanningCanvas {
    const target = canvas.nodes.find(node => node.id === nodeId);
    if (!target) return canvas;
    const nodes = canvas.nodes
        .filter(node => node.id !== nodeId)
        .map(node => (node.parentId === nodeId ? { ...node, parentId: target.parentId } : node));
    const edges = canvas.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
    return { ...canvas, nodes, edges, updatedAt: Date.now() };
}

/**
 * 简单网格自动布局：按包含层级分列、同层纵向排开（只在节点缺坐标时使用）。
 *
 * @param nodes - 节点列表
 * @param origin - 起点
 * @param gap - 间距
 * @returns 节点 id → 坐标
 */
export function autoLayout(
    nodes: readonly PlanningNode[],
    origin: { x: number; y: number } = { x: 80, y: 80 },
    gap = { x: 240, y: 120 },
): Map<string, { x: number; y: number }> {
    const depthOf = new Map<string, number>();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const depth = (node: PlanningNode): number => {
        const cached = depthOf.get(node.id);
        if (cached !== undefined) return cached;
        let current = node;
        let value = 0;
        const seen = new Set<string>();
        while (current.parentId && !seen.has(current.id)) {
            seen.add(current.id);
            const parent = byId.get(current.parentId);
            if (!parent) break;
            value += 1;
            current = parent;
        }
        depthOf.set(node.id, value);
        return value;
    };
    const rows = new Map<number, number>();
    const layout = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
        const level = depth(node);
        const row = rows.get(level) ?? 0;
        rows.set(level, row + 1);
        layout.set(node.id, { x: origin.x + level * gap.x, y: origin.y + row * gap.y });
    }
    return layout;
}

/**
 * 统计各状态节点数。
 *
 * @param canvas - 画布
 * @returns 状态 → 数量
 */
export function canvasStats(canvas: PlanningCanvas): Record<PlanningNodeStatus, number> {
    const stats: Record<PlanningNodeStatus, number> = { idea: 0, selected: 0, written: 0, dropped: 0 };
    for (const node of canvas.nodes) stats[node.status] += 1;
    return stats;
}

/**
 * 生成便签 id。
 *
 * @param now - 时间戳
 * @param random - 随机数
 * @returns id
 */
export function planningNoteId(now: number = Date.now(), random: number = Math.random()): string {
    return `note-${now.toString(36)}-${Math.floor(random * 1e6).toString(36)}`;
}

/**
 * 归一化画布：补齐旧数据缺失的 notes 字段。
 *
 * @param canvas - 原始画布
 * @returns 补全后的画布
 */
export function normalizeCanvas(canvas: PlanningCanvas): PlanningCanvas {
    return { ...canvas, notes: Array.isArray(canvas.notes) ? canvas.notes : [] };
}

/**
 * 新增便签。
 *
 * @param canvas - 画布
 * @param text - 文本
 * @param position - 坐标
 * @param color - 配色
 * @returns 新画布（不修改入参）
 */
export function addNote(
    canvas: PlanningCanvas,
    text: string,
    position: { x: number; y: number },
    color: PlanningNote['color'] = 'yellow',
): PlanningCanvas {
    const note: PlanningNote = {
        id: planningNoteId(),
        text: String(text ?? '').slice(0, 2000),
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        color,
    };
    return { ...canvas, updatedAt: Date.now(), notes: [...(canvas.notes ?? []), note] };
}

/**
 * 修改便签文本/坐标。
 *
 * @param canvas - 画布
 * @param noteId - 便签 id
 * @param patch - 要修改的字段
 * @returns 新画布；找不到便签时原样返回
 */
export function updateNote(
    canvas: PlanningCanvas,
    noteId: string,
    patch: Partial<Pick<PlanningNote, 'text' | 'position' | 'color'>>,
): PlanningCanvas {
    const notes = canvas.notes ?? [];
    if (!notes.some(note => note.id === noteId)) return canvas;
    return {
        ...canvas,
        updatedAt: Date.now(),
        notes: notes.map(note => (note.id === noteId ? { ...note, ...patch } : note)),
    };
}

/**
 * 删除便签。
 *
 * @param canvas - 画布
 * @param noteId - 便签 id
 * @returns 新画布
 */
export function removeNote(canvas: PlanningCanvas, noteId: string): PlanningCanvas {
    const notes = canvas.notes ?? [];
    if (!notes.some(note => note.id === noteId)) return canvas;
    return { ...canvas, updatedAt: Date.now(), notes: notes.filter(note => note.id !== noteId) };
}

/**
 * 画布统计（含便签数）。
 *
 * @param canvas - 画布
 * @returns 统计
 */
export function noteCount(canvas: PlanningCanvas): number {
    return (canvas.notes ?? []).length;
}
