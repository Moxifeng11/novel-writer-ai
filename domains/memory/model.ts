/**
 * memory-model.ts — 设定实体图模型（纯函数）
 *
 * 借鉴催更姬 domain/memory：设定不是「一堆 Markdown 文件」，而是
 * **实体卡 + 关系边**；关系是独立数据（可增删、可查询），不埋在正文里。
 *
 * 本实现采取**非破坏**策略：Markdown 仍是卡片正文真源（用户可继续手写），
 * 关系边与卡片摘要单独存 `<项目>/04-项目总控/设定图/关系.json`，
 * 卡片由项目索引自动派生（名称/类型/路径），不需要迁移现有文件。
 */

/** 实体类型（与项目目录对应） */
export type MemoryEntityType = 'character' | 'location' | 'faction' | 'item' | 'setting';

/** 实体类型中文名 */
export const MEMORY_TYPE_LABELS: Record<MemoryEntityType, string> = {
    character: '人物',
    location: '地点',
    faction: '势力',
    item: '物品',
    setting: '设定',
};

/** 实体卡（摘要，正文在 Markdown 文件里） */
export interface MemoryCard {
    /** 稳定 id（由类型 + 路径派生） */
    id: string;
    /** 显示名 */
    name: string;
    /** 实体类型 */
    type: MemoryEntityType;
    /** vault 相对路径（正文真源） */
    path: string;
    /** 检索摘要 */
    summary: string;
}

/** 关系类型 */
export type MemoryEdgeType =
    | 'ally'
    | 'enemy'
    | 'family'
    | 'belongs'
    | 'owns'
    | 'located'
    | 'custom';

/** 关系类型中文名 */
export const MEMORY_EDGE_LABELS: Record<MemoryEdgeType, string> = {
    ally: '盟友',
    enemy: '敌对',
    family: '亲属',
    belongs: '归属',
    owns: '持有',
    located: '位于',
    custom: '其他',
};

/** 关系边 */
export interface MemoryEdge {
    id: string;
    /** 起点卡 id */
    from: string;
    /** 终点卡 id */
    to: string;
    type: MemoryEdgeType;
    /** 展示标签（可空，默认用类型名） */
    label: string;
}

/** 设定图（只存边；卡片由索引派生） */
export interface MemoryGraph {
    version: 1;
    updatedAt: number;
    edges: MemoryEdge[];
}

/** 设定图格式版本 */
export const MEMORY_GRAPH_VERSION = 1 as const;

/**
 * 由实体类型与路径派生稳定 id。
 *
 * @param type - 实体类型
 * @param path - vault 相对路径
 * @returns 稳定 id
 */
export function memoryCardId(type: MemoryEntityType, path: string): string {
    return `${type}:${path}`;
}

/**
 * 由文件摘要构造卡片。
 *
 * @param file - 路径与名称
 * @param type - 实体类型
 * @param summary - 摘要（默认空）
 * @returns 卡片
 */
export function buildCard(
    file: { path: string; name: string },
    type: MemoryEntityType,
    summary = '',
): MemoryCard {
    return {
        id: memoryCardId(type, file.path),
        name: file.name,
        type,
        path: file.path,
        summary,
    };
}

/**
 * 空设定图。
 *
 * @param now - 时间戳
 * @returns 空图
 */
export function emptyGraph(now: number = Date.now()): MemoryGraph {
    return { version: MEMORY_GRAPH_VERSION, updatedAt: now, edges: [] };
}

/**
 * 生成关系 id。
 *
 * @param now - 时间戳
 * @param random - 随机数
 * @returns id
 */
export function memoryEdgeId(now: number = Date.now(), random: number = Math.random()): string {
    return `edge-${now}-${Math.floor(random * 36 ** 3).toString(36).padStart(3, '0')}`;
}

/**
 * 校验关系边：两端必须存在、不能自连、不能重复（同起点终点类型）。
 *
 * @param edge - 关系边
 * @param cards - 现有卡片
 * @param edges - 现有边
 * @returns 合法返回 null，否则返回原因
 */
export function validateEdge(
    edge: Pick<MemoryEdge, 'from' | 'to' | 'type'>,
    cards: readonly MemoryCard[],
    edges: readonly MemoryEdge[],
): string | null {
    if (edge.from === edge.to) return '不能把实体连到自己';
    const ids = new Set(cards.map(card => card.id));
    if (!ids.has(edge.from)) return '起点实体不存在';
    if (!ids.has(edge.to)) return '终点实体不存在';
    if (edges.some(item => item.from === edge.from && item.to === edge.to && item.type === edge.type)) {
        return '同类型关系已存在';
    }
    return null;
}

/**
 * 添加关系边（返回新图；非法返回 null）。
 *
 * @param graph - 设定图
 * @param edge - 关系边
 * @param cards - 现有卡片
 * @returns 新图或 null
 */
export function addEdge(
    graph: MemoryGraph,
    edge: MemoryEdge,
    cards: readonly MemoryCard[],
): MemoryGraph | null {
    if (validateEdge(edge, cards, graph.edges)) return null;
    return { ...graph, edges: [...graph.edges, edge], updatedAt: Date.now() };
}

/**
 * 删除关系边。
 *
 * @param graph - 设定图
 * @param edgeId - 边 id
 * @returns 新图
 */
export function removeEdge(graph: MemoryGraph, edgeId: string): MemoryGraph {
    const edges = graph.edges.filter(edge => edge.id !== edgeId);
    if (edges.length === graph.edges.length) return graph;
    return { ...graph, edges, updatedAt: Date.now() };
}

/**
 * 取与某卡片相关的全部边（作为起点或终点）。
 *
 * @param graph - 设定图
 * @param cardId - 卡片 id
 * @returns 相关边
 */
export function edgesOf(graph: MemoryGraph, cardId: string): MemoryEdge[] {
    return graph.edges.filter(edge => edge.from === cardId || edge.to === cardId);
}

/**
 * 清理指向已不存在卡片的边（卡片被删/改名后调用）。
 *
 * @param graph - 设定图
 * @param cards - 当前卡片
 * @returns 清理后的图与移除数量
 */
export function pruneEdges(
    graph: MemoryGraph,
    cards: readonly MemoryCard[],
): { graph: MemoryGraph; removed: number } {
    const ids = new Set(cards.map(card => card.id));
    const edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const removed = graph.edges.length - edges.length;
    if (removed === 0) return { graph, removed };
    return { graph: { ...graph, edges, updatedAt: Date.now() }, removed };
}

/**
 * 按类型分组卡片。
 *
 * @param cards - 卡片
 * @returns 类型 → 卡片
 */
export function groupCards(cards: readonly MemoryCard[]): Record<MemoryEntityType, MemoryCard[]> {
    const groups: Record<MemoryEntityType, MemoryCard[]> = {
        character: [], location: [], faction: [], item: [], setting: [],
    };
    for (const card of cards) groups[card.type].push(card);
    for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
}

/**
 * 按关键字搜索卡片（名称/摘要，忽略大小写）。
 *
 * @param cards - 卡片
 * @param query - 关键字
 * @param limit - 最多返回条数（默认 50）
 * @returns 匹配卡片
 */
export function searchCards(cards: readonly MemoryCard[], query: string, limit = 50): MemoryCard[] {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return cards.slice(0, limit);
    return cards
        .filter(card => card.name.toLowerCase().includes(needle) || card.summary.toLowerCase().includes(needle))
        .slice(0, limit);
}
