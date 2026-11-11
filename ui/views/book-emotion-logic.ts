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

/** NRC 八维情绪英文键 → 中文 */
export const NRC_EMOTION_NAME_MAP: Record<string, string> = {
    anger: '愤怒',
    anticipation: '期待',
    disgust: '厌恶',
    fear: '恐惧',
    joy: '喜悦',
    sadness: '悲伤',
    surprise: '惊讶',
    trust: '信任',
};

/** 情绪弧线类型 → 展示名 */
export const EMOTION_ARC_TYPE_MAP: Record<string, string> = {
    rags_to_riches: '逆袭上升 (Rags to Riches)',
    riches_to_rags: '盛极而衰 (Riches to Rags)',
    man_in_hole: '跌入谷底回升 (Man in Hole)',
    icarus: '伊卡洛斯 (Icarus)',
    cinderella: '灰姑娘 (Cinderella)',
    oedipus: '俄狄浦斯 (Oedipus)',
    steady: '平稳型 (Steady)',
    complex: '复杂型 (Complex)',
};

/** 建议严重度 → 徽标底色（商业/可读性页签同款） */
export const SEVERITY_COLORS: Record<string, string> = {
    high: 'var(--color-red)',
    medium: 'var(--color-orange)',
    low: 'var(--color-green)',
};

/** 建议严重度 → 中文标签 */
export const SEVERITY_LABELS: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低',
};

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
    return entries.map(([k, v]) => ({
        label: NRC_EMOTION_NAME_MAP[k] || k,
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
    return EMOTION_ARC_TYPE_MAP[arcType ?? ''] || (arcType ?? '');
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
    return SEVERITY_LABELS[severity] || severity;
}
