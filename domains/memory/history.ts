/**
 * memory-history.ts — 设定图历史快照模型（纯函数）
 *
 * 借鉴催更姬 history/settings：每次改设定图前留一份快照，
 * 可列出、可对比、可恢复。快照只存关系边（卡片正文在 Markdown，另有版本历史）。
 */

import type { MemoryEdge, MemoryGraph } from './model';

/** 历史快照 */
export interface MemoryHistorySnapshot {
    version: 1;
    /** 快照 id（时间戳字符串，文件名同源） */
    id: string;
    /** 创建时间 */
    createdAt: number;
    /** 变更原因 */
    reason: string;
    /** 当时的关系边 */
    edges: MemoryEdge[];
}

/** 快照格式版本 */
export const MEMORY_HISTORY_VERSION = 1 as const;

/** 默认保留快照数 */
export const MEMORY_HISTORY_KEEP = 30;

/**
 * 生成快照 id。
 *
 * @param now - 时间戳
 * @returns id
 */
export function memoryHistoryId(now: number = Date.now()): string {
    return String(now);
}

/**
 * 由当前图创建快照。
 *
 * @param graph - 设定图
 * @param reason - 变更原因
 * @param now - 时间戳
 * @returns 快照
 */
export function createHistorySnapshot(
    graph: MemoryGraph,
    reason: string,
    now: number = Date.now(),
): MemoryHistorySnapshot {
    return {
        version: MEMORY_HISTORY_VERSION,
        id: memoryHistoryId(now),
        createdAt: now,
        reason: String(reason || '').trim() || '未注明原因',
        edges: graph.edges.map(edge => ({ ...edge })),
    };
}

/**
 * 解析快照文件；损坏返回 null。
 *
 * @param raw - 原始 JSON
 * @returns 快照或 null
 */
export function parseHistorySnapshot(raw: string): MemoryHistorySnapshot | null {
    try {
        const parsed = JSON.parse(raw) as Partial<MemoryHistorySnapshot>;
        if (parsed?.version !== MEMORY_HISTORY_VERSION) return null;
        if (!Array.isArray(parsed.edges)) return null;
        return {
            version: MEMORY_HISTORY_VERSION,
            id: String(parsed.id ?? ''),
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
            reason: String(parsed.reason ?? ''),
            edges: parsed.edges,
        };
    } catch {
        // silent-ok: 历史快照损坏等价于「没有该快照」，不影响当前设定图
        return null;
    }
}

/**
 * 计算需要删除的旧快照（保留最近 N 个）。
 *
 * @param snapshots - 全部快照（顺序不限）
 * @param keep - 保留数量
 * @returns 需要删除的快照 id
 */
export function expiredSnapshotIds(
    snapshots: readonly MemoryHistorySnapshot[],
    keep: number = MEMORY_HISTORY_KEEP,
): string[] {
    const limit = Math.max(1, Math.floor(keep));
    if (snapshots.length <= limit) return [];
    return [...snapshots]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(limit)
        .map(snapshot => snapshot.id);
}

/**
 * 快照恢复为图。
 *
 * @param snapshot - 快照
 * @returns 设定图（只含边，卡片仍来自索引）
 */
export function snapshotToGraph(snapshot: MemoryHistorySnapshot): MemoryGraph {
    return {
        version: 1,
        updatedAt: Date.now(),
        edges: snapshot.edges.map(edge => ({ ...edge })),
    };
}

/**
 * 快照展示文本。
 *
 * @param snapshot - 快照
 * @returns 展示文本
 */
export function describeSnapshot(snapshot: MemoryHistorySnapshot): string {
    const time = new Date(snapshot.createdAt).toLocaleString();
    return `${time} · ${snapshot.edges.length} 条关系 · ${snapshot.reason}`;
}
