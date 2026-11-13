/**
 * consistency-metrics.ts — 一致性指标（S5）
 *
 * 采用 ConStory-Bench 的 **CED（Consistency Error Density，每万词错误数）** 口径：
 *
 *     CED = 错误数 / (词数 / 10000)
 *
 * 为什么用它：直接数错误数会惩罚长文（10 万字自然比 2 千字错得多），
 * 归一化后才可跨章节/跨版本比较，也才能证明「这一版比上一版好」。
 *
 * 中文没有空格分词，这里用**字符数**近似词数（论文对中文亦采用长度归一化思路），
 * 因此本模块输出的 CED 单位是「每万字符」——在插件内一致即可，不做跨语种比较。
 */

import type { AssertionKind, ConsistencyContradiction } from './assertion-model';
import { ASSERTION_KIND_META } from './assertion-model';

/** 按类型分组的指标 */
export interface KindMetric {
    kind: AssertionKind;
    label: string;
    errors: number;
    /** 该类型每万字符错误数 */
    ced: number;
}

/** 一致性指标 */
export interface ConsistencyMetrics {
    /** 总错误数 */
    errors: number;
    /** 参与统计的总字符数 */
    charCount: number;
    /** 每万字符错误数（总） */
    ced: number;
    /** 按类型分组 */
    byKind: KindMetric[];
}

/**
 * 计算 CED。
 *
 * @param errors - 错误数
 * @param charCount - 字符数
 * @returns 每万字符错误数；字符数为 0 时返回 0（不返回 Infinity）
 */
export function computeCed(errors: number, charCount: number): number {
    const safeErrors = Number.isFinite(errors) ? Math.max(0, errors) : 0;
    const safeChars = Number.isFinite(charCount) ? Math.max(0, charCount) : 0;
    if (safeChars === 0) return 0;
    return Number(((safeErrors / safeChars) * 10000).toFixed(4));
}

/**
 * 统计一组矛盾的一致性指标。
 *
 * @param contradictions - 矛盾列表
 * @param charCount - 参与统计的总字符数（通常为全部章节正文长度之和）
 * @returns 指标
 */
export function summarizeConsistencyMetrics(
    contradictions: readonly ConsistencyContradiction[],
    charCount: number,
): ConsistencyMetrics {
    const counts = new Map<AssertionKind, number>();
    for (const c of contradictions) {
        counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    }
    const byKind: KindMetric[] = [...counts.entries()]
        .map(([kind, errors]) => ({
            kind,
            label: ASSERTION_KIND_META[kind].label,
            errors,
            ced: computeCed(errors, charCount),
        }))
        .sort((a, b) => b.errors - a.errors || a.kind.localeCompare(b.kind));

    return {
        errors: contradictions.length,
        charCount: Number.isFinite(charCount) ? Math.max(0, charCount) : 0,
        ced: computeCed(contradictions.length, charCount),
        byKind,
    };
}

/**
 * 把指标压成人类可读的一行（用于看板/报告摘要）。
 *
 * @param metrics - 指标
 * @returns 形如「CED 0.42 处/万字符（3 处 / 7.1 万字）」
 */
export function formatMetricsLine(metrics: ConsistencyMetrics): string {
    const wan = metrics.charCount / 10000;
    const wanText = wan >= 1 ? `${wan.toFixed(1)} 万字` : `${metrics.charCount} 字`;
    return `CED ${metrics.ced.toFixed(2)} 处/万字符（${metrics.errors} 处 / ${wanText}）`;
}

/**
 * 计算两版指标的相对变化（用于趋势/回归判断）。
 *
 * @param before - 旧指标 CED
 * @param after - 新指标 CED
 * @returns 变化率（正数=变差，负数=变好）；旧值为 0 时返回 null（无法比较）
 */
export function cedChangeRate(before: number, after: number): number | null {
    if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
    return Number((((after - before) / before) * 100).toFixed(2));
}
