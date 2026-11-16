/**
 * canvas-link.ts — 正文 ↔ 规划画布的双向链接（2026-11-16）
 *
 * 现状：规划画布（事件节点）与正文章节是两套数据，之前只有画布单向的
 * chapterRefs 守卫，无法从正文回写规划。
 *
 * 这里提供：
 *  1. buildChapterEventNode：纯函数，按章节信息构造事件节点（去重）；
 *  2. addChapterEventNode：读画布 → 追加节点 → 落盘。
 */
import type { App } from 'obsidian';
import { planningId, type PlanningCanvas, type PlanningNode } from '@/domains/planning/model';
import { FileTxService } from '@/services/file-tx';
import { PlanningStore } from '@/services/planning-store';

/** 章节事件的默认节点类型 */
const DEFAULT_KIND: PlanningNode['kind'] = 'event';

/**
 * 按章节构造事件节点（纯函数，便于单测）。
 *
 * 已有章节号相同的节点时返回 null：同一章重复点「记为事件」不应该造出两个节点。
 *
 * @param nodes - 现有节点
 * @param chapterNum - 章节号
 * @param title - 节点标题（通常是章节标题）
 * @param summary - 摘要
 * @param position - 画布坐标
 * @returns 新节点；已存在同章节点时返回 null
 * @example
 * buildChapterEventNode([], 3, '初入山门', '', { x: 0, y: 0 });
 */
export function buildChapterEventNode(
    nodes: readonly PlanningNode[],
    chapterNum: number,
    title: string,
    summary: string,
    position: { x: number; y: number },
): PlanningNode | null {
    if (!Number.isFinite(chapterNum) || chapterNum <= 0) return null;
    if (nodes.some(node => node.chapterNum === chapterNum)) return null;
    return {
        id: planningId('node'),
        title: String(title ?? '').trim() || `第${chapterNum}章`,
        summary: String(summary ?? '').slice(0, 500),
        kind: DEFAULT_KIND,
        status: 'selected',
        parentId: null,
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        chapterNum: Math.floor(chapterNum),
    };
}

/** 追加结果 */
export interface AddChapterEventResult {
    /** 是否新增 */
    added: boolean;
    /** 未新增的原因（展示给用户） */
    reason?: string;
}

/**
 * 把一章正文登记为规划画布的事件节点。
 *
 * @param app - Obsidian 应用
 * @param project - 项目 id
 * @param chapterNum - 章节号
 * @param title - 标题
 * @param summary - 摘要
 * @returns 结果
 * @example
 * await addChapterEventNode(app, '示例项目', 3, '初入山门', '');
 */
export async function addChapterEventNode(
    app: App,
    project: string,
    chapterNum: number,
    title: string,
    summary = '',
): Promise<AddChapterEventResult> {
    if (!project) return { added: false, reason: '未绑定项目' };
    const store = new PlanningStore(app, new FileTxService(app));
    const canvas: PlanningCanvas = await store.load(project);
    const node = buildChapterEventNode(canvas.nodes, chapterNum, title, summary, nextFreePosition(canvas));
    if (!node) {
        return {
            added: false,
            reason: Number.isFinite(chapterNum) && chapterNum > 0
                ? `第${chapterNum}章已在规划画布中`
                : '章节号无效',
        };
    }
    await store.save(project, { ...canvas, nodes: [...canvas.nodes, node] });
    return { added: true };
}

/**
 * 找一个不与现有节点重叠的落点（右下角依次错开）。
 *
 * @param canvas - 画布
 * @returns 坐标
 */
function nextFreePosition(canvas: PlanningCanvas): { x: number; y: number } {
    if (canvas.nodes.length === 0) return { x: 80, y: 80 };
    const maxY = Math.max(...canvas.nodes.map(node => node.position.y));
    return { x: 80, y: maxY + 110 };
}
