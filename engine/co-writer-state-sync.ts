/**
 * co-writer-state-sync.ts — co-writer 状态变化同步（进待确认队列）
 * 对应 spec: story-quality-closed-loop-optimization Task 12。
 *
 * 复用 CoWriterEngine 的 `EntityStateChange`（trackEntityStates 产物），
 * 将状态变化转为 `PendingFact` 进 Task 11 待确认队列（source='co-writer'），
 * 未确认前不写正式库——防止 co-writer 接受建议后自动污染世界观 / 人物库。
 *
 * 覆盖六类变化（Task 12 扩展）：人物状态 / 新地点 / 新道具 / 关系 / 新伏笔 / 已完成节点，
 * 按 entityType 映射到事实类别（character / world / plot）。
 */

import type { EntityStateChange, EntityChangeType } from './entity-state-manager';
import type { PendingFact, FactCategory } from './fact-index-manager';

/** 六类变化 → 事实类别映射 */
const TYPE_TO_CATEGORY: Record<EntityChangeType, FactCategory> = {
    character: 'character',
    relationship: 'character',
    location: 'world',
    prop: 'world',
    foreshadow: 'plot',
    plotNode: 'plot',
};

/**
 * 将 CoWriterEngine 检测到的实体状态变化转为待确认事实（PendingFact）。
 * @param changes EntityStateChange 列表（CoWriterEngine.trackEntityStates 输出）
 * @param source 事实来源（默认 'co-writer'）
 * @returns PendingFact 列表（status='pending'）
 */
export function entityStateChangesToFacts(
    changes: EntityStateChange[],
    source: string = 'co-writer',
): PendingFact[] {
    if (!Array.isArray(changes) || changes.length === 0) return [];

    return changes
        .filter((c) => Boolean(c.entityName) && Boolean(c.newStatus))
        .map((c) => {
            const category = TYPE_TO_CATEGORY[c.entityType || 'character'] || 'character';
            return {
                id: `${category}:${c.entityName}`,
                category,
                name: c.entityName,
                content: c.newStatus,
                source,
                createdAt: Date.now(),
                status: 'pending' as const,
            };
        });
}
