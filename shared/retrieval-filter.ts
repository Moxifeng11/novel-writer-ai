/**
 * shared/retrieval-filter.ts — 向量检索结果的相关性过滤（纯函数）
 *
 * 知识库与指纹的向量检索此前只按 topN 截断，相似度多低都会进入 prompt：
 * 本地 8K 窗口下，这些低相关样本会挤占预算，还会干扰模型对任务的理解。
 *
 * 这里只做「明显离群」的修剪，不动排序与业务筛选：
 * - 最高分低于绝对下限 → 整批视为噪声，返回空（查询与库无关）；
 * - 其余样本低于 `最高分 × 相对比例` → 丢弃，至少保留最高分那一条。
 *
 * ⚠️ 约束：多维度合并检索（style/rhythm/technique 一次查出）必须用
 * `filterRetrievalResultsByScope(..., 'perDimension')`。全局阈值会把
 * 「0.45 的 rhythm」按「0.6 的 style × 0.85 = 0.51」整段丢弃，
 * 同一 query 分维度检索有内容、合并检索为空。
 */

import {
    RETRIEVAL_ABSOLUTE_MIN_SCORE,
    RETRIEVAL_RELATIVE_MIN_SCORE,
} from './thresholds';

/**
 * ScoredRetrievalItem 类型定义。
 */
export interface ScoredRetrievalItem {
    score: number;
}

/**
 * RetrievalFilterOptions 类型定义。
 */
export interface RetrievalFilterOptions {
    /** 相对最高分的最低比例，默认 `RETRIEVAL_RELATIVE_MIN_SCORE` */
    relativeRatio?: number;
    /** 绝对最低分，默认 `RETRIEVAL_ABSOLUTE_MIN_SCORE` */
    absoluteMin?: number;
}

/**
 * 过滤低相关检索结果，返回按分数降序的新数组（不修改入参）。
 *
 * 注意：调用方已完成维度/书籍/维度名等业务筛选，这里只处理分数。
 * @param results - 结果列表
 * @param options - 配置项
 * @returns 结果数组
 */
export function filterRetrievalResults<T extends ScoredRetrievalItem>(
    results: T[],
    options: RetrievalFilterOptions = {},
): T[] {
    if (results.length === 0) return [];

    const relativeRatio = options.relativeRatio ?? RETRIEVAL_RELATIVE_MIN_SCORE;
    const absoluteMin = options.absoluteMin ?? RETRIEVAL_ABSOLUTE_MIN_SCORE;

    // NaN 会污染排序比较，直接剔除
    const valid = results.filter(item => Number.isFinite(item.score));
    if (valid.length === 0) return [];

    const sorted = [...valid].sort((a, b) => b.score - a.score);
    const topScore = sorted[0].score;
    if (topScore < absoluteMin) return [];

    const threshold = Math.max(absoluteMin, topScore * relativeRatio);
    return sorted.filter(item => item.score >= threshold);
}

/** 过滤范围：全局共用最高分 / 每个维度各自用最高分 */
export type RetrievalFilterScope = 'global' | 'perDimension';

/**
 * DimensionScoredItem 类型定义。
 */
export interface DimensionScoredItem extends ScoredRetrievalItem {
    dimension?: string;
}

/**
 * 按范围过滤检索结果。
 * - global：保持历史行为（所有维度共用一个最高分）；
 * - perDimension：按 `dimension` 分组各自过滤，再按分数降序合并。
 * @param results - 结果列表
 * @param scope - 作用域
 * @param options - 配置项
 * @returns 结果数组
 */
export function filterRetrievalResultsByScope<T extends DimensionScoredItem>(
    results: T[],
    scope: RetrievalFilterScope = 'global',
    options: RetrievalFilterOptions = {},
): T[] {
    if (scope === 'global') return filterRetrievalResults(results, options);
    if (results.length === 0) return [];

    const groups = new Map<string, T[]>();
    for (const item of results) {
        const key = item.dimension || 'unknown';
        const list = groups.get(key);
        if (list) list.push(item);
        else groups.set(key, [item]);
    }

    const kept: T[] = [];
    for (const group of groups.values()) {
        kept.push(...filterRetrievalResults(group, options));
    }
    return kept.sort((a, b) => b.score - a.score);
}
