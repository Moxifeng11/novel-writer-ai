/**
 * book-emotion-logic.ts — 书籍详情「角色页签」的情绪数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/book-detail-renderer.ts`（角色页签 NRC 情绪分布与情绪弧线两块）
 * 抽出：NRC 八维中文映射 + 百分比钳制 + ≥3 维门槛、八种弧线类型中文名、
 * 严重度配色/文案。这些映射此前内联在渲染器里零覆盖——键名拼错一个字母，
 * 图表会静默退化成英文键或空图。
 *
 * 约定：不 import obsidian、不碰 DOM；未知键保留原文（与抽取前一致）。
 */

import { t } from '@/i18n';

/**
 * NRC 八维情绪英文键 → 显示名。
 * @returns 英文情绪键到本地化显示名的映射
 */
export function nrcEmotionNameMap(): Record<string, string> {
    return {
        anger: t('bookDetail.emotion.nrc.anger'),
        anticipation: t('bookDetail.emotion.nrc.anticipation'),
        disgust: t('bookDetail.emotion.nrc.disgust'),
        fear: t('bookDetail.emotion.nrc.fear'),
        joy: t('bookDetail.emotion.nrc.joy'),
        sadness: t('bookDetail.emotion.nrc.sadness'),
        surprise: t('bookDetail.emotion.nrc.surprise'),
        trust: t('bookDetail.emotion.nrc.trust'),
    };
}

/**
 * 情绪弧线类型 → 展示名。
 * @returns 情绪弧线类型键到本地化展示名的映射
 */
export function emotionArcTypeMap(): Record<string, string> {
    return {
        rags_to_riches: t('bookDetail.emotion.arc.ragsToRiches'),
        riches_to_rags: t('bookDetail.emotion.arc.richesToRags'),
        man_in_hole: t('bookDetail.emotion.arc.manInHole'),
        icarus: t('bookDetail.emotion.arc.icarus'),
        cinderella: t('bookDetail.emotion.arc.cinderella'),
        oedipus: t('bookDetail.emotion.arc.oedipus'),
        steady: t('bookDetail.emotion.arc.steady'),
        complex: t('bookDetail.emotion.arc.complex'),
    };
}

/** 建议严重度 → 徽标底色（商业/可读性页签同款） */
export const SEVERITY_COLORS: Record<string, string> = {
    high: 'var(--color-red)',
    medium: 'var(--color-orange)',
    low: 'var(--color-green)',
};

/**
 * 建议严重度 → 显示标签。
 * @returns 严重度键（high/medium/low）到本地化标签的映射
 */
export function severityLabels(): Record<string, string> {
    return {
        high: t('bookDetail.emotion.severity.high'),
        medium: t('bookDetail.emotion.severity.medium'),
        low: t('bookDetail.emotion.severity.low'),
    };
}

/** 雷达图数据点 */
export interface ChartPoint {
    label: string;
    value: number;
}

/**
 * NRC 情绪分布 → 雷达图数据。
 *
 * - 值按 `v*100` 换算并钳制到 ≤100；
 * - 不足 3 维返回空数组（渲染器据此跳过雷达图，与抽取前 `>=3` 门槛一致）；
 * - 未知键保留原文。
 *
 * @param ne - NRC 情绪分析（overallDistribution 为英文键 → 0..1 比例）
 * @returns 雷达数据点（可能为空）
 */
export function buildNrcEmotionRadarData(
    ne: { overallDistribution?: Record<string, number> } | undefined | null,
): ChartPoint[] {
    if (!ne || !ne.overallDistribution) return [];
    const entries = Object.entries(ne.overallDistribution);
    if (entries.length < 3) return [];
    const labels = nrcEmotionNameMap();
    return entries.map(([k, v]) => ({
        label: labels[k] || k,
        value: Math.min(100, v * 100),
    }));
}

/**
 * 情绪弧线类型中文名（未知键保留原文键）。
 *
 * @param arcType - 英文键
 * @returns 展示名
 */
export function resolveEmotionArcLabel(arcType: string | undefined): string {
    return emotionArcTypeMap()[arcType ?? ''] || (arcType ?? '');
}

/**
 * 建议严重度徽标底色（未知档位回落 text-muted）。
 *
 * @param severity - high/medium/low 或未知
 * @returns CSS 颜色值
 */
export function resolveSeverityColor(severity: string): string {
    return SEVERITY_COLORS[severity] || 'var(--text-muted)';
}

/**
 * 建议严重度中文标签（未知档位保留原文）。
 *
 * @param severity - high/medium/low 或未知
 * @returns 中文标签
 */
export function resolveSeverityLabel(severity: string): string {
    return severityLabels()[severity] || severity;
}
