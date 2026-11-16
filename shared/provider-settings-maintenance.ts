/**
 * provider-settings-maintenance.ts — 供应商相关设置的一次性清理（幂等）
 *
 * 背景（2026-11-16 验收遗留）：
 * - 同一渠道的模型上限覆盖可能因历史写法不同存在两条 key
 *   （`https://a.com` 与 `https://a.com/v1/chat/completions`）。
 *   运行时与 UI 已能跨写法读取，但数据本身应合并成一条，避免以后再次踩坑。
 * - `enabledProviderIds`（在其他模块显示）里会残留已删除渠道的 id，
 *   导致「恢复默认」等操作后仍有幽灵项。
 *
 * 两个清理都必须是幂等的：重复执行结果不变、不丢任何用户配置。
 */

import { normalizeEndpointKey } from './endpoint-key';

/** 模型上限覆盖表 */
export type ModelOverrides = Record<string, Record<string, {
    maxContext?: number;
    maxOutput?: number;
}>>;

/** 清理结果 */
export interface MaintenanceResult<T> {
    /** 是否有变化（无变化时调用方不必保存） */
    changed: boolean;
    /** 清理后的值 */
    value: T;
}

/**
 * 合并「归一化后相同」的覆盖 key。
 *
 * 保留 key 的优先级：与任一渠道 endpoint 完全一致的 key > 条目最多的 key > 最先出现的 key。
 * 合并时**先出现的值优先**，与运行时「精确命中后按遍历顺序取第一个」的读取语义一致，
 * 因此清理不会改变任何模型的生效上限。
 *
 * @param overrides - 现有覆盖表
 * @param providerEndpoints - 当前渠道端点列表（用于挑选保留 key）
 * @returns 合并结果（幂等）
 * @example
 * mergeDuplicateOverrideKeys({
 *   'https://a.com': { m: { maxContext: 1 } },
 *   'https://a.com/v1': { m: { maxOutput: 2 } },
 * }, ['https://a.com']);
 * // { changed: true, value: { 'https://a.com': { m: { maxContext: 1, maxOutput: 2 } } } }
 */
export function mergeDuplicateOverrideKeys(
    overrides: ModelOverrides | undefined,
    providerEndpoints: readonly string[] = [],
): MaintenanceResult<ModelOverrides> {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const entries = Object.entries(source);
    if (entries.length === 0) return { changed: false, value: source };

    // 按归一化端点分组（保持出现顺序）
    const groups = new Map<string, Array<[string, Record<string, { maxContext?: number; maxOutput?: number }>]>>();
    for (const [key, models] of entries) {
        const normalized = normalizeEndpointKey(key);
        const bucket = groups.get(normalized) ?? [];
        bucket.push([key, models]);
        groups.set(normalized, bucket);
    }
    if (groups.size === entries.length) return { changed: false, value: source };

    const exactEndpoints = new Set(providerEndpoints.map(endpoint => String(endpoint || '')).filter(Boolean));
    const merged: ModelOverrides = {};
    for (const bucket of groups.values()) {
        // 选保留 key：精确端点 > 条目数最多 > 第一个
        const keeper = [...bucket].sort((a, b) => {
            const aExact = exactEndpoints.has(a[0]) ? 1 : 0;
            const bExact = exactEndpoints.has(b[0]) ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;
            const aCount = Object.keys(a[1] || {}).length;
            const bCount = Object.keys(b[1] || {}).length;
            if (aCount !== bCount) return bCount - aCount;
            return 0;
        })[0][0];
        const models: Record<string, { maxContext?: number; maxOutput?: number }> = {};
        for (const [, modelsOfKey] of bucket) {
            for (const [model, entry] of Object.entries(modelsOfKey || {})) {
                const target = models[model] ?? (models[model] = {});
                // 先出现的值优先（与运行时读取顺序一致）
                for (const field of ['maxContext', 'maxOutput'] as const) {
                    const value = entry?.[field];
                    if (typeof value === 'number' && Number.isFinite(value) && target[field] === undefined) {
                        target[field] = value;
                    }
                }
            }
        }
        // 合并后空条目直接丢弃
        for (const [model, entry] of Object.entries(models)) {
            if (entry.maxContext === undefined && entry.maxOutput === undefined) delete models[model];
        }
        merged[keeper] = models;
    }
    return { changed: true, value: merged };
}

/**
 * 清理 `enabledProviderIds` 里已不存在的渠道 id。
 *
 * `undefined` 表示「全部显示」，保持不变；否则按现有渠道顺序过滤。
 *
 * @param enabledProviderIds - 现有列表（undefined = 全部显示）
 * @param providerIds - 当前渠道 id 列表
 * @returns 清理结果（幂等）
 * @example
 * pruneUnknownProviderIds(['a', 'gone'], ['a', 'b']);
 * // { changed: true, value: ['a'] }
 */
export function pruneUnknownProviderIds(
    enabledProviderIds: readonly string[] | undefined,
    providerIds: readonly string[],
): MaintenanceResult<string[] | undefined> {
    if (!Array.isArray(enabledProviderIds)) {
        return { changed: false, value: enabledProviderIds as string[] | undefined };
    }
    const list = [...enabledProviderIds];
    const allowed = new Set(providerIds);
    const next = list.filter(id => allowed.has(id));
    const changed = next.length !== list.length;
    return { changed, value: changed ? next : list };
}
