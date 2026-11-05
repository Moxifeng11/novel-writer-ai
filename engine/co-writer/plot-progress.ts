/**
 * plot-progress.ts — 剧情节点进度计算与目标提示（自 co-writer-engine.ts 抽出）
 *
 * 这两个函数依赖引擎的 `plotNodes` 可变状态，抽取时改为显式入参：
 *  - `computePlotProgress(plotNodes, currentBody)`：原地更新节点的 completed 标记，
 *    返回总进度（与抽取前完全一致，包括 30% 信号命中阈值）；
 *  - `buildPlotTargetHint(plotNodes, progress)`：把进度格式化为提示词片段。
 *
 * 不持有任何模块级状态；同一组节点重复调用结果一致。
 */
import type { PlotNode, PlotProgress } from './co-writer-types';

/**
 * 计算当前剧情进度：已完成哪些节点，下一个目标是什么。
 *
 * 命中规则：节点目标/地点/人物/冲突四类信号（长度 ≥ 3）中，
 * 至少命中 30% 且不少于 1 个才算完成。
 *
 * @param plotNodes - 剧情节点列表（会就地更新 completed）
 * @param currentBody - 当前正文
 * @returns 进度摘要
 *
 * @example
 * ```ts
 * const progress = computePlotProgress(nodes, body);
 * // progress.nextNode —— 下一个未完成节点
 * ```
 */
export function computePlotProgress(plotNodes: PlotNode[], currentBody: string): PlotProgress {
    const bodyLower = currentBody.toLowerCase();
    let completedCount = 0;
    let firstIncomplete = -1;

    for (let i = 0; i < plotNodes.length; i++) {
        const node = plotNodes[i];
        const signals = [node.goal, node.location, node.characters, node.conflict]
            .filter(Boolean)
            .map(s => s.toLowerCase())
            .filter(s => s.length >= 3);

        let hitCount = 0;
        for (const sig of signals) {
            if (bodyLower.includes(sig)) hitCount++;
        }

        // 旧实现用 Math.min(1, ...) 把阈值钉死为 1：任一关键词命中即判节点完成。
        // 改为「至少 30% 信号、且不少于 1 个」才有资格算完成。
        const requiredHits = Math.max(1, Math.ceil(signals.length * 0.3));
        const completed = signals.length > 0 && hitCount >= requiredHits;
        node.completed = completed;
        if (completed) {
            completedCount++;
        } else if (firstIncomplete < 0) {
            firstIncomplete = i;
        }
    }

    const total = plotNodes.length;
    const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    const nextNode = firstIncomplete >= 0 && firstIncomplete < total
        ? plotNodes[firstIncomplete]
        : null;

    return {
        totalNodes: total,
        completedNodes: completedCount,
        currentIndex: firstIncomplete >= 0 ? firstIncomplete : total,
        completionPercent: percent,
        nextNode,
        allCompleted: firstIncomplete < 0,
    };
}

/**
 * 获取当前应该推进的剧情节点描述（用于注入 prompt）。
 *
 * @param plotNodes - 剧情节点列表（仅用于判断「是否一个节点都没有」）
 * @param progress - computePlotProgress 的结果
 * @returns 多行提示；无节点且无进度时返回空串
 *
 * @example
 * ```ts
 * const hint = buildPlotTargetHint(nodes, computePlotProgress(nodes, body));
 * ```
 */
export function buildPlotTargetHint(plotNodes: PlotNode[], progress: PlotProgress): string {
    if (!progress.nextNode) {
        const lastNode = plotNodes[plotNodes.length - 1];
        if (lastNode) {
            return `本章所有剧情节点已推进完毕，当前处于收尾阶段。请为当前场景画上句号并自然过渡到章末钩子。`;
        }
        return '';
    }

    const node = progress.nextNode;
    const parts: string[] = [];
    parts.push(`当前进度：第${progress.currentIndex + 1}/${progress.totalNodes}个剧情节点（已完成${progress.completionPercent}%）`);
    parts.push(`下一个剧情目标：${node.goal || '推进当前场景'}`);
    if (node.location) parts.push(`地点：${node.location}`);
    if (node.characters) parts.push(`涉及人物：${node.characters}`);
    if (node.conflict) parts.push(`冲突焦点：${node.conflict}`);

    return parts.join('\n');
}
