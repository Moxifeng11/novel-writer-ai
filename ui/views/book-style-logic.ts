/**
 * book-style-logic.ts — 书籍详情「风格页签」的数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/book-detail-renderer.ts#renderBookStyleTab` 抽出：五感分布、
 * 句式/句长/段长分布的中文映射与图表数据组装。此前内联在渲染器里零覆盖，
 * 改一个映射键或 `Math.min(100, v*100)` 的钳制就会让雷达图悄悄空掉/超界。
 *
 * 约定：不 import obsidian、不碰 DOM；英文键缺失时回落原文键（与抽取前一致）。
 */

import { t } from '@/i18n';

/**
 * 五感英文键 → 显示名。
 * @returns 五感键到本地化显示名的映射
 */
export function senseNameMap(): Record<string, string> {
    return {
        visual: t('bookDetail.style.senseDim.visual'),
        auditory: t('bookDetail.style.senseDim.auditory'),
        olfactory: t('bookDetail.style.senseDim.olfactory'),
        gustatory: t('bookDetail.style.senseDim.gustatory'),
        tactile: t('bookDetail.style.senseDim.tactile'),
    };
}

/**
 * 句式类型英文键 → 显示名。
 * @returns 句式键到本地化显示名的映射
 */
export function sentenceTypeNameMap(): Record<string, string> {
    return {
        declarative: t('bookDetail.style.sentenceType.declarative'),
        interrogative: t('bookDetail.style.sentenceType.interrogative'),
        exclamatory: t('bookDetail.style.sentenceType.exclamatory'),
        elliptical: t('bookDetail.style.sentenceType.elliptical'),
    };
}

/**
 * 句长分档 → 显示名。
 * @returns 句长分档键到本地化显示名的映射
 */
export function sentenceLengthNameMap(): Record<string, string> {
    return {
        short: t('bookDetail.style.length.short'),
        medium: t('bookDetail.style.length.medium'),
        long: t('bookDetail.style.length.long'),
    };
}

/**
 * 段落长度分档 → 显示名（多一档「超长段」）。
 * @returns 段落长度分档键到本地化显示名的映射
 */
export function paragraphLengthNameMap(): Record<string, string> {
    return {
        short: t('bookDetail.style.paraLength.short'),
        medium: t('bookDetail.style.paraLength.medium'),
        long: t('bookDetail.style.paraLength.long'),
        veryLong: t('bookDetail.style.paraLength.veryLong'),
    };
}

/** 雷达图数据点 */
export interface ChartPoint {
    label: string;
    value: number;
}

/**
 * 五感分布 → 雷达图数据。
 *
 * - 分布不足 3 维时返回空数组（渲染器据此跳过雷达图，与抽取前 `>=3` 门槛一致）；
 * - 值按 `v*100` 换算成百分比并钳制到 ≤100；
 * - 未知英文键保留原文（不做静默丢弃）。
 *
 * @param fs - 五感分布（distribution 为英文键 → 0..1 比例）
 * @returns 雷达数据点（可能为空）
 */
export function buildFiveSensesRadarData(
    fs: { distribution?: Record<string, number> } | undefined | null,
): ChartPoint[] {
    if (!fs || !fs.distribution) return [];
    const entries = Object.entries(fs.distribution);
    if (entries.length < 3) return [];
    return entries.map(([k, v]) => ({
        label: senseNameMap()[k] || k,
        value: Math.min(100, v * 100),
    }));
}

/**
 * 五感主导感的中文名（未知键保留原文）。
 *
 * @param sense - 英文键
 * @returns 中文名
 */
export function resolveSenseLabel(sense: string | undefined): string {
    return senseNameMap()[sense ?? ''] || (sense ?? '');
}

/**
 * 句式类型分布 → 环图数据（未知键保留原文；空输入返回空数组）。
 *
 * @param std - 英文键 → 数量
 * @returns 环图数据点
 */
export function buildSentenceTypeDonutData(
    std: Record<string, number> | undefined | null,
): ChartPoint[] {
    if (!std) return [];
    return Object.entries(std).map(([k, v]) => ({
        label: sentenceTypeNameMap()[k] || k,
        value: v,
    }));
}

/**
 * 句长分布 → 柱状图数据（未知键保留原文）。
 *
 * @param sld - 分档 → 数量
 * @returns 柱状图数据点
 */
export function buildSentenceLengthBarData(
    sld: Record<string, number> | undefined | null,
): ChartPoint[] {
    if (!sld) return [];
    return Object.entries(sld).map(([k, v]) => ({
        label: sentenceLengthNameMap()[k] || k,
        value: v,
    }));
}

/**
 * 段落长度分布 → 柱状图数据（比句长多 veryLong 档）。
 *
 * @param pld - 分档 → 数量
 * @returns 柱状图数据点
 */
export function buildParagraphLengthBarData(
    pld: Record<string, number> | undefined | null,
): ChartPoint[] {
    if (!pld) return [];
    return Object.entries(pld).map(([k, v]) => ({
        label: paragraphLengthNameMap()[k] || k,
        value: v,
    }));
}

/**
 * 整体风格的文风评分 → 展示行（最多 5 条，`风格: 百分比`）。
 *
 * @param styleScores - 文风 → 0..1 比例
 * @param formatPercent - 百分比格式化（由调用方注入，保持与视图同一口径）
 * @returns 形如 `简洁: 62%` 的行
 */
export function buildStyleScoreLines(
    styleScores: Record<string, number> | undefined,
    formatPercent: (v: number) => string,
): string[] {
    if (!styleScores) return [];
    return Object.entries(styleScores)
        .slice(0, 5)
        .map(([style, score]) => `${style}: ${formatPercent(score)}`);
}
