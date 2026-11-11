/**
 * fingerprint-detail-logic.ts — 指纹详情面板的数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/writing-fingerprint-view.ts`（2000+ 行）抽出：统计卡片、特征行、
 * 代表片段截取、注入预算回落。此前内联在渲染方法里零覆盖；抽成单点后可以锁住
 * 「空特征不渲染」「预算非法回落 2000」这类容易静默改坏的规则。
 *
 * 约定：不 import obsidian、不碰 DOM；格式化复用 knowledge-detail-format 的纯函数。
 */

import { formatDetailNumber, formatDetailPercent } from '@/ui/knowledge-detail-format';

/** 指纹统计结构（与 StyleFingerprint.stats 兼容） */
export interface FingerprintStatsLike {
    avgSentenceLength?: number;
    avgParagraphLength?: number;
    dialogueRatio?: number;
    descriptionRatio?: number;
}

/** 统计卡片项 */
export interface StatItem {
    label: string;
    value: string;
}

/** 特征行 */
export interface FeatureRow {
    key: string;
    label: string;
    value: string;
}

/** 默认注入预算（字符） */
export const DEFAULT_INJECTION_BUDGET = 2000;

/**
 * 统计卡片四项（缺失值格式化为占位符，交给 formatDetail* 统一口径）。
 *
 * @param stats - 指纹统计
 * @returns 四个统计项
 */
export function buildStatItems(stats: FingerprintStatsLike | undefined): StatItem[] {
    return [
        { label: '平均句长', value: formatDetailNumber(stats?.avgSentenceLength, 1, ' 字') },
        { label: '平均段长', value: formatDetailNumber(stats?.avgParagraphLength, 0, ' 字') },
        { label: '对话占比', value: formatDetailPercent(stats?.dialogueRatio, 1) },
        { label: '描写占比', value: formatDetailPercent(stats?.descriptionRatio, 1) },
    ];
}

/**
 * 特征行（按固定顺序，空值不渲染）。
 *
 * @param features - 指纹特征对象
 * @param labels - 字段中文名映射（key → label）
 * @returns 非空特征行
 */
export function buildFeatureRows(
    features: Record<string, unknown> | null | undefined,
    labels: readonly { key: string; label: string }[],
): FeatureRow[] {
    if (!features) return [];
    const rows: FeatureRow[] = [];
    for (const { key, label } of labels) {
        const value = features[key];
        if (typeof value !== 'string' || !value) continue;
        rows.push({ key, label, value });
    }
    return rows;
}

/**
 * 代表片段只展示前 N 条（默认 3）。
 *
 * @param samples - 片段列表
 * @param max - 最多条数
 * @returns 截取后的新数组
 */
export function visibleSamples(samples: readonly string[] | null | undefined, max = 3): string[] {
    if (!samples || samples.length === 0) return [];
    return samples.slice(0, Math.max(0, max));
}

/**
 * 注入预算：正数才生效，非法/缺失回落到默认 2000。
 *
 * @param raw - 设置里的原始值
 * @returns 预算字符数
 */
export function resolveInjectionBudget(raw: unknown): number {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_INJECTION_BUDGET;
}
