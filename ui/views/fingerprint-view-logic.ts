/**
 * fingerprint-view-logic.ts — 指纹视图的筛选与生效状态（纯逻辑，阶段 D1）
 *
 * 从 `ui/views/writing-fingerprint-view.ts` 抽出。这些判断此前内联在视图里，
 * 没有任何测试能覆盖——改一个 `includes` 就可能让搜索失效而无人察觉。
 *
 * 与 `kb-*-logic` / `book-detail-metrics` 同一思路：**把能抽的纯逻辑抽出来**，
 * 视图只负责把结果画到 DOM 上。
 */

import type { StyleFingerprint } from '@/engine/style-fingerprint-library';

/** 指纹筛选条件 */
export interface FingerprintFilter {
    /** 搜索词（匹配名称/来源/标签，大小写不敏感） */
    searchQuery: string;
    /** 选中的标签（null = 不按标签过滤） */
    selectedTag: string | null;
}

/**
 * 按搜索词过滤指纹。
 *
 * 匹配范围：名称、来源、标签（三者任一命中即保留）。
 *
 * @param fingerprints - 指纹列表
 * @param query - 搜索词（空串返回原列表）
 * @returns 过滤后的列表
 */
export function filterFingerprintsByQuery(
    fingerprints: readonly StyleFingerprint[],
    query: string,
): StyleFingerprint[] {
    const trimmed = String(query || '').trim().toLowerCase();
    if (!trimmed) return [...fingerprints];
    return fingerprints.filter(fp =>
        (fp.name || '').toLowerCase().includes(trimmed)
        || (fp.source || '').toLowerCase().includes(trimmed)
        || (fp.tags || []).some(tag => tag.toLowerCase().includes(trimmed)),
    );
}

/**
 * 按标签过滤指纹。
 *
 * @param fingerprints - 指纹列表
 * @param tag - 标签（null/空串返回原列表）
 * @returns 过滤后的列表
 */
export function filterFingerprintsByTag(
    fingerprints: readonly StyleFingerprint[],
    tag: string | null,
): StyleFingerprint[] {
    if (!tag) return [...fingerprints];
    return fingerprints.filter(fp => (fp.tags || []).includes(tag));
}

/**
 * 依次应用搜索词与标签过滤。
 *
 * @param fingerprints - 指纹列表
 * @param filter - 筛选条件
 * @returns 过滤后的列表
 */
export function filterFingerprints(
    fingerprints: readonly StyleFingerprint[],
    filter: FingerprintFilter,
): StyleFingerprint[] {
    const byQuery = filterFingerprintsByQuery(fingerprints, filter.searchQuery);
    return filterFingerprintsByTag(byQuery, filter.selectedTag);
}

/**
 * 收集指纹用到的全部标签（去重并排序）。
 *
 * @param fingerprints - 指纹列表
 * @returns 标签数组
 */
export function collectFingerprintTags(fingerprints: readonly StyleFingerprint[]): string[] {
    const tagSet = new Set<string>();
    for (const fp of fingerprints) {
        for (const tag of fp.tags || []) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
}

/**
 * 判断指纹在**当前项目下**是否真的生效。
 *
 * 全局指纹的真实生效状态是「项目级覆盖优先」：项目里改过覆盖时以覆盖为准，
 * 否则回落到指纹自身的 `enabled`。非全局指纹直接看自身。
 *
 * @param fp - 指纹
 * @param globalState - 全局指纹的项目级覆盖表（fpId → 是否启用）
 * @returns 是否生效
 */
export function resolveEffectiveEnabled(
    fp: StyleFingerprint,
    globalState: ReadonlyMap<string, boolean>,
): boolean {
    if (fp.scope !== 'global') return fp.enabled;
    return globalState.get(fp.id) ?? fp.enabled;
}

/**
 * 渲染用投影：把项目级覆盖写进 `enabled`，不改动库内对象。
 *
 * @param fingerprints - 指纹列表
 * @param globalState - 全局指纹的项目级覆盖表
 * @returns 投影后的列表（未变化的指纹复用原对象）
 */
export function withEffectiveEnabled(
    fingerprints: readonly StyleFingerprint[],
    globalState: ReadonlyMap<string, boolean>,
): StyleFingerprint[] {
    return fingerprints.map(fp => {
        const enabled = resolveEffectiveEnabled(fp, globalState);
        return enabled === fp.enabled ? fp : { ...fp, enabled };
    });
}
