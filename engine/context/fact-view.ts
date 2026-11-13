/**
 * fact-view.ts — 图上的事实视图（时间切片查询）
 *
 * 为什么单独一层：`StoryContextGraph` 提供的是「本章上下文」，
 * 但有两类查询图本身没有：
 *  1. **某主体在某章时的状态**（跨章时间切片）——「写到第 30 章，宁缺修为/位置/持有物是什么」
 *  2. **按条件检索历史事实**（写作参考：这个词/这个人在前文怎么写的）
 *
 * 数据来源只有一处：**图里的事实节点**（不另设事实库）。
 */

import type { StoryContextNode } from './story-context-types';
import { readAllFacts, type FactMetadata } from './knowledge-fact-nodes';

/**
 * 取某主体在某章时的有效状态（同谓词取最晚一条）。
 *
 * @param nodes - 图节点（含事实节点）
 * @param subject - 主体
 * @param chapter - 章节号
 * @returns 有效事实列表
 */
export function stateAt(
    nodes: Iterable<StoryContextNode>,
    subject: string,
    chapter: number,
): FactMetadata[] {
    const target = (subject ?? '').trim();
    if (!target) return [];
    const facts = readAllFacts(nodes).filter(fact => {
        if (fact.subject !== target) return false;
        if (fact.chapter > chapter) return false;
        if (fact.validFrom > chapter) return false;
        if (fact.validTo !== null && fact.validTo <= chapter) return false;
        return true;
    });
    const byPredicate = new Map<string, FactMetadata>();
    for (const fact of facts.sort((a, b) => a.chapter - b.chapter)) {
        byPredicate.set(fact.predicate, fact);
    }
    return [...byPredicate.values()];
}

/**
 * 按条件检索事实（零依赖字段检索，写作参考用）。
 *
 * @param nodes - 图节点
 * @param query - 查询条件（AND）
 * @param query.subject - 主体（含匹配）
 * @param query.predicate - 谓词（含匹配）
 * @param query.type - 拆解类型
 * @param query.fromChapter - 起始章节（含）
 * @param query.toChapter - 结束章节（含）
 * @param query.keyword - 关键词（主体/值/引文）
 * @param query.limit - 上限（默认 50）
 * @returns 命中事实（按章节升序）
 */
export function queryFacts(
    nodes: Iterable<StoryContextNode>,
    query: {
        subject?: string;
        predicate?: string;
        type?: FactMetadata['type'];
        fromChapter?: number;
        toChapter?: number;
        keyword?: string;
        limit?: number;
    } = {},
): FactMetadata[] {
    const subject = (query.subject ?? '').trim();
    const predicate = (query.predicate ?? '').trim();
    const keyword = (query.keyword ?? '').trim();
    const limit = Math.max(1, query.limit ?? 50);
    const hits = readAllFacts(nodes).filter(fact => {
        if (subject && !(fact.subject === subject || fact.subject.includes(subject) || subject.includes(fact.subject))) return false;
        if (predicate && !fact.predicate.includes(predicate)) return false;
        if (query.type && fact.type !== query.type) return false;
        if (query.fromChapter !== undefined && fact.chapter < query.fromChapter) return false;
        if (query.toChapter !== undefined && fact.chapter > query.toChapter) return false;
        if (keyword && !(fact.subject.includes(keyword) || fact.value.includes(keyword) || fact.quote.includes(keyword))) return false;
        return true;
    });
    return hits.sort((a, b) => a.chapter - b.chapter).slice(0, limit);
}

/**
 * 统计事实概况。
 *
 * @param nodes - 图节点
 * @returns 统计
 */
export function summarizeFacts(nodes: Iterable<StoryContextNode>): {
    facts: number;
    subjects: number;
    chapters: { from: number; to: number };
    byType: Record<string, number>;
} {
    const facts = readAllFacts(nodes);
    const byType: Record<string, number> = {};
    const subjects = new Set<string>();
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const fact of facts) {
        byType[fact.type] = (byType[fact.type] ?? 0) + 1;
        subjects.add(fact.subject);
        if (fact.chapter < from) from = fact.chapter;
        if (fact.chapter > to) to = fact.chapter;
    }
    return {
        facts: facts.length,
        subjects: subjects.size,
        chapters: { from: Number.isFinite(from) ? from : 0, to },
        byType,
    };
}
