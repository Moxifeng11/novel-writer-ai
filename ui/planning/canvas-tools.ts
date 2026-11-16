/**
 * canvas-tools.ts — 规划画布的纯计算工具（2026-11-16）
 *
 * 从视图里抽出来的可单测逻辑：节点搜索、缩放步进、命中循环。
 * 不碰 DOM，不依赖 Obsidian API。
 */
import type { PlanningNode } from '@/domains/planning/model';

/** 缩放上下限（低于 0.4 文字不可读，高于 2 失去全局感） */
export const ZOOM_MIN = 0.4;
/** 缩放上限 */
export const ZOOM_MAX = 2;
/** 缩放档位 */
export const ZOOM_STEPS: readonly number[] = [0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2];

/**
 * 夹紧缩放值。
 *
 * @param value - 原始值
 * @returns 夹紧后的值；非法值回退 1
 * @example
 * clampZoom(9); // 2
 */
export function clampZoom(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/**
 * 按方向取下一档缩放。
 *
 * @param current - 当前缩放
 * @param direction - 1 放大 / -1 缩小
 * @returns 新缩放值
 * @example
 * stepZoom(1, 1); // 1.25
 */
export function stepZoom(current: number, direction: 1 | -1): number {
    const safe = clampZoom(current);
    if (direction > 0) {
        return ZOOM_STEPS.find(step => step > safe + 1e-6) ?? ZOOM_MAX;
    }
    const lower = [...ZOOM_STEPS].reverse().find(step => step < safe - 1e-6);
    return lower ?? ZOOM_MIN;
}

/**
 * 缩放百分比文案。
 *
 * @param zoom - 缩放值
 * @returns 如 "100%"
 * @example
 * formatZoom(1.25); // '125%'
 */
export function formatZoom(zoom: number): string {
    return `${Math.round(clampZoom(zoom) * 100)}%`;
}

/**
 * 搜索节点：标题或摘要包含关键字（不区分大小写）。
 *
 * @param nodes - 节点列表
 * @param query - 关键字（空串返回空数组）
 * @returns 命中节点 id（按列表顺序）
 * @example
 * filterPlanningNodes(nodes, '开门');
 */
export function filterPlanningNodes(nodes: readonly PlanningNode[], query: string): string[] {
    const keyword = String(query ?? '').trim().toLowerCase();
    if (!keyword) return [];
    return nodes
        .filter(node =>
            String(node.title ?? '').toLowerCase().includes(keyword)
            || String(node.summary ?? '').toLowerCase().includes(keyword))
        .map(node => node.id);
}

/**
 * 在命中列表里循环取下一个。
 *
 * @param matches - 命中 id 列表
 * @param current - 当前选中 id（可为 null）
 * @param direction - 1 下一个 / -1 上一个
 * @returns 下一个 id；无命中返回 null
 * @example
 * nextMatch(['a','b'], 'a', 1); // 'b'
 */
export function nextMatch(
    matches: readonly string[],
    current: string | null,
    direction: 1 | -1,
): string | null {
    if (matches.length === 0) return null;
    const index = current ? matches.indexOf(current) : -1;
    if (index < 0) return direction > 0 ? matches[0] : matches[matches.length - 1];
    const nextIndex = (index + direction + matches.length) % matches.length;
    return matches[nextIndex];
}
