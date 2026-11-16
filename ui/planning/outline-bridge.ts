/**
 * outline-bridge.ts — 分卷大纲 → 规划画布事件节点（2026-11-16）
 *
 * 背景：分卷大纲（md，按章）与规划画布（json，按事件）是两套数据，
 * 用户在大纲树里排好章，画布里还得手敲一遍。
 *
 * 这里把「章节 + 场景」映射成事件节点：
 *  - 一章 = 一个事件节点（chapterNum 关联正文）
 *  - 首场景名作为节点标题的补充，场景目标合并成摘要
 *  - 同章已有节点则跳过（可反复点，不会重复堆节点）
 *
 * 纯函数便于单测；写盘由调用方（模态框/协同视图）负责。
 */
import type { PlanningNode } from '@/domains/planning/model';
import { planningId } from '@/domains/planning/model';

/** 大纲里的一章（桥接输入） */
export interface OutlineChapterInput {
    /** 章号 */
    chapterNum: number;
    /** 卷名（如「第1卷」）；用于分列布局 */
    volumeLabel?: string;
    /** 该章冲突摘要 */
    conflict?: string;
    /** 场景列表 */
    scenes?: Array<{ name?: string; objective?: string; isKeyScene?: boolean }>;
}

/** 桥接结果 */
export interface OutlineBridgeResult {
    /** 新建的节点（未写入画布，调用方负责合并） */
    nodes: PlanningNode[];
    /** 因已存在而跳过的章数 */
    skipped: number;
}

/** 节点宽度占位（布局列距） */
const COLUMN_GAP = 220;
/** 行距 */
const ROW_GAP = 110;

/**
 * 把分卷大纲映射为事件节点。
 *
 * @param chapters - 大纲章节
 * @param existingNodes - 画布已有节点（用于去重与布局避让）
 * @returns 新节点与跳过数
 * @example
 * const { nodes, skipped } = buildNodesFromOutline(chapters, canvas.nodes);
 */
export function buildNodesFromOutline(
    chapters: readonly OutlineChapterInput[],
    existingNodes: readonly PlanningNode[],
): OutlineBridgeResult {
    const usedChapters = new Set(
        existingNodes
            .map(node => node.chapterNum)
            .filter((value): value is number => typeof value === 'number'),
    );
    // 已有节点占用的最大 y，避免新节点压在上面
    const baseY = existingNodes.length > 0
        ? Math.max(...existingNodes.map(node => node.position.y)) + ROW_GAP
        : 20;
    const columnOf = new Map<string, number>();
    const rowOf = new Map<number, number>();
    const nodes: PlanningNode[] = [];
    let skipped = 0;

    for (const chapter of chapters) {
        if (!Number.isFinite(chapter.chapterNum) || chapter.chapterNum <= 0) continue;
        if (usedChapters.has(chapter.chapterNum)) {
            skipped += 1;
            continue;
        }
        usedChapters.add(chapter.chapterNum);
        const volumeLabel = chapter.volumeLabel || '未分卷';
        if (!columnOf.has(volumeLabel)) columnOf.set(volumeLabel, columnOf.size);
        const column = columnOf.get(volumeLabel) ?? 0;
        const row = rowOf.get(column) ?? 0;
        rowOf.set(column, row + 1);

        nodes.push({
            id: planningId('node'),
            title: describeChapterTitle(chapter),
            summary: describeChapterSummary(chapter),
            kind: 'event',
            status: 'idea',
            parentId: null,
            position: { x: 20 + column * (COLUMN_GAP * 2), y: baseY + row * ROW_GAP },
            chapterNum: chapter.chapterNum,
        });
    }
    return { nodes, skipped };
}

/**
 * 节点标题：优先首个场景名，其次冲突摘要，最后「第N章」。
 *
 * @param chapter - 章节输入
 * @returns 标题
 * @example
 * describeChapterTitle({ chapterNum: 3, scenes: [{ name: '初入山门' }] }); // '第3章 · 初入山门'
 */
export function describeChapterTitle(chapter: OutlineChapterInput): string {
    const firstSceneName = chapter.scenes?.find(scene => (scene.name || '').trim())?.name?.trim();
    if (firstSceneName) return `第${chapter.chapterNum}章 · ${firstSceneName}`.slice(0, 60);
    const conflict = (chapter.conflict || '').trim();
    if (conflict) return `第${chapter.chapterNum}章 · ${conflict}`.slice(0, 60);
    return `第${chapter.chapterNum}章`;
}

/**
 * 节点摘要：场景目标串联（最多 4 条、共 200 字），没有场景时用冲突摘要。
 *
 * @param chapter - 章节输入
 * @returns 摘要
 * @example
 * describeChapterSummary({ chapterNum: 1, scenes: [{ objective: '拿到钥匙' }] });
 */
export function describeChapterSummary(chapter: OutlineChapterInput): string {
    const objectives = (chapter.scenes ?? [])
        .map(scene => (scene.objective || '').trim())
        .filter(Boolean)
        .slice(0, 4);
    if (objectives.length > 0) return objectives.join('；').slice(0, 200);
    return (chapter.conflict || '').trim().slice(0, 200);
}
