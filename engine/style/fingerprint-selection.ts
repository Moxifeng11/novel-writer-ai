/**
 * style/fingerprint-selection.ts — 启用指纹的注入选择器（协同 / 11 步共用）
 *
 * 旧实现只有协同写作有「最多注入 3 个指纹」的上限，11 步正文生成把全部启用指纹
 * 合并进 system：启用 10 个指纹时 system 线性膨胀，且同一用户在两条链路上得到
 * 不同强度的风格约束。
 *
 * 选择规则：
 * - 启用数 ≤ 上限 → 全量返回，不发起检索；
 * - 否则按 V2 12 维相似度排名挑 topN；
 * - 检索不可用 / 无结果 / 异常 → 按 fallback 策略回退，并回调 onFallback 供调用方
 *   发降级事件（协同选 'all' 保住风格约束，11 步选 'firstN' 保住预算上限）。
 */

import { RETRIEVAL_ABSOLUTE_MIN_SCORE } from '../../shared/thresholds';

export const MAX_INJECTED_STYLE_FINGERPRINTS = 3;

export interface FingerprintRef {
    id: string;
}

export type FingerprintSearchV2 = (
    query: string,
    options: { topN: number; fingerprintIds: string[]; minScore?: number },
) => Promise<Array<{ fingerprintId: string }>>;

export interface FingerprintSelectionOptions<F extends FingerprintRef> {
    query: string;
    /** V2 12 维相似度检索；不可用时直接走 fallback */
    searchV2?: FingerprintSearchV2;
    /** 回退策略：all=保留全部（默认，协同），firstN=只保留前 N（11 步硬上限） */
    fallback?: 'all' | 'firstN';
    /** 回退原因回调（每个调用点自行决定是否只上报一次） */
    onFallback?: (reason: string) => void;
    /** 注入上限，默认 MAX_INJECTED_STYLE_FINGERPRINTS */
    limit?: number;
    /** V2 相关性绝对下限，默认 RETRIEVAL_ABSOLUTE_MIN_SCORE（0.15） */
    minScore?: number;
}

/**
 * 选出本次注入使用的指纹。
 * 返回顺序：命中检索时按启用列表原顺序（稳定），回退时按 fallback 策略。
 */
export async function selectFingerprintsForInjection<F extends FingerprintRef>(
    enabled: F[],
    options: FingerprintSelectionOptions<F>,
): Promise<F[]> {
    const limit = options.limit ?? MAX_INJECTED_STYLE_FINGERPRINTS;
    const fallbackMode = options.fallback ?? 'all';

    if (enabled.length <= limit) return enabled;

    const fallback = (reason: string): F[] => {
        options.onFallback?.(reason);
        return fallbackMode === 'firstN' ? enabled.slice(0, limit) : enabled;
    };

    const searchV2 = options.searchV2;
    if (!searchV2) {
        return fallback('V2 12 维检索不可用（指纹库未注入 searchSimilarStylesV2）');
    }

    try {
        const ranked = await searchV2(options.query, {
            topN: limit,
            // 只在启用指纹内排名：禁用指纹/模板来源库先占满 topN 会让交集为空
            fingerprintIds: enabled.map(fp => fp.id),
            // V2 默认 minScore=0：低相关指纹会挤掉真正相近的风格；与知识检索共用绝对下限
            minScore: options.minScore ?? RETRIEVAL_ABSOLUTE_MIN_SCORE,
        });
        if (!ranked || ranked.length === 0) {
            return fallback('V2 检索无结果');
        }
        const topIds = new Set(ranked.map(r => r.fingerprintId));
        const selected = enabled.filter(fp => topIds.has(fp.id));
        if (selected.length === 0) {
            return fallback('V2 检索结果与启用指纹无交集');
        }
        return selected.slice(0, limit);
    } catch (e) {
        return fallback(`V2 检索异常：${e instanceof Error ? e.message : String(e)}`);
    }
}
