/**
 * prompt-manager-logic.ts — 提示词管理的展示逻辑（阶段 D1）
 *
 * 从 `ui/prompt-manager-settings.ts` 的 `renderVariantStats` 抽出。
 *
 * 抽出的理由：指标行是否显示取决于「样本数 > 0」的守卫
 * （`ratingCount > 0` / `qualityCount > 0` / `modificationCount > 0`），
 * 守卫写错就会显示 `NaN/10` 或「0.0%」这种假数据——此前零测试覆盖。
 */

import type { ABTestMetrics } from '@/shared/prompt-manager-types';

/** 一行指标展示 */
export interface VariantStatRow {
    label: string;
    value: string;
}

/**
 * 构造 A/B 变体的指标行。
 *
 * 规则：
 * - 调用次数始终显示
 * - 平均评分 / 平均质量 / 修改率**只在有样本时显示**（避免 0 样本时显示 NaN）
 * - 流量占比始终显示
 *
 * @param metrics - 变体指标
 * @param traffic - 流量占比（百分比数值，0–100）
 * @returns 指标行
 */
export function buildVariantStatRows(
    metrics: ABTestMetrics,
    traffic: number,
): VariantStatRow[] {
    const rows: VariantStatRow[] = [
        { label: '调用次数', value: String(metrics?.totalCalls ?? 0) },
    ];
    if ((metrics?.ratingCount ?? 0) > 0) {
        rows.push({ label: '平均评分', value: `${formatOneDecimal(metrics.avgRating)}/10` });
    }
    if ((metrics?.qualityCount ?? 0) > 0) {
        rows.push({ label: '平均质量', value: `${formatOneDecimal(metrics.avgQuality)}/10` });
    }
    if ((metrics?.modificationCount ?? 0) > 0) {
        rows.push({
            label: '修改率',
            value: `${formatOneDecimal((metrics.modificationRate ?? 0) * 100)}%`,
        });
    }
    rows.push({ label: '流量占比', value: `${formatOneDecimal(traffic)}%` });
    return rows;
}

/**
 * 保留一位小数；非法值返回 `0.0`（不显示 NaN）。
 *
 * @param value - 数值
 * @returns 一位小数字符串
 */
export function formatOneDecimal(value: number | undefined): string {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.0';
    return num.toFixed(1);
}

/**
 * 判断变体是否有任何评价数据（用于「暂无数据」空态）。
 *
 * @param metrics - 变体指标
 * @returns 是否有评价数据
 */
export function hasVariantFeedback(metrics: ABTestMetrics | undefined): boolean {
    if (!metrics) return false;
    return metrics.ratingCount > 0 || metrics.qualityCount > 0 || metrics.modificationCount > 0;
}
