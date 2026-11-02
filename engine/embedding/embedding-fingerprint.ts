/**
 * embedding-fingerprint.ts — embedding 向量身份的唯一定义
 *
 * 只比较模型名无法区分「同名模型换了端点」：本地 Ollama 换端口、云端换代理
 * 都会让旧向量被当成有效向量混算。指纹 = `providerType:model@shortHash(baseUrl)`。
 *
 * 兼容策略：旧向量文件的 modelId 是不含 `@` 的纯模型名，判定时退化为按模型名比较；
 * 首次重建/写入后会落成新指纹。
 */

import type { EmbeddingProvider, ProviderInfo } from './embedding-provider';

/**
 * FNV-1a 32 位短哈希（稳定、无依赖，足够区分端点）
 *
 * @param input - 输入
 * @returns 文本结果
 */
function shortHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 由 provider 信息计算指纹；模型缺失时返回 unknown（调用方跳过一致性判断）
 *
 * @param info - 信息
 * @param baseUrl - 基础 URL
 * @returns 文本结果
 */
export function computeEmbeddingFingerprint(info: ProviderInfo, baseUrl?: string): string {
    const model = (info.model || '').trim();
    if (!model) return 'unknown';
    return `${info.type || 'unknown'}:${model}@${shortHash(baseUrl || '')}`;
}

/**
 * 旧文件没有 `@` 后缀 → 纯模型名格式
 *
 * @param modelId - 模型ID
 * @returns 是否成功
 */
export function isLegacyModelId(modelId: string): boolean {
    return !modelId.includes('@');
}

/**
 * 从 provider 读取指纹（不触发网络请求）
 *
 * @param provider - 提供方
 * @returns 文本结果
 */
export function getEmbeddingFingerprint(provider: EmbeddingProvider): string {
    try {
        const info = provider.getProviderInfo();
        const getBaseUrl = (provider as { getBaseUrl?: () => string }).getBaseUrl;
        const baseUrl = typeof getBaseUrl === 'function' ? getBaseUrl.call(provider) : '';
        return computeEmbeddingFingerprint(info, baseUrl);
    } catch {
        return 'unknown';
    }
}

/**
 * provider 已声明的向量维度；未知返回 null（不触发 `getDimensions()` 的网络探测）
 *
 * @param provider - 提供方
  * @returns 数值结果 或 null
 */
export function getEmbeddingDimensionHint(provider: EmbeddingProvider): number | null {
    try {
        const dimensions = provider.getProviderInfo()?.dimensions;
        return typeof dimensions === 'number' && dimensions > 0 ? dimensions : null;
    } catch {
        return null;
    }
}

/**
 * 当前模型名（用于旧格式 modelId 的兼容比较）
 *
 * @param provider - 提供方
 * @returns 文本结果
 */
export function getEmbeddingModelName(provider: EmbeddingProvider): string {
    try {
        return provider.getModelName?.() || provider.getProviderInfo()?.model || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * 向量模型不匹配原因（模型/维度）。
 */
export type EmbeddingMismatchReason = 'model' | 'dimension';

/**
 * 判断落盘向量是否与当前 embedding 配置不一致。
 * - model：指纹不同（含同模型换端点）；旧格式 modelId 只比较模型名
 * - dimension：模型相同但维度变化
 * 返回 null 表示一致或无法判断（旧文件缺字段）。
 * @param stored - 已存储值
 * @param current - 当前
  * @returns EmbeddingMismatchReason 或 null
 */
export function detectEmbeddingMismatch(
    stored: { modelId?: string; dimensionCount?: number },
    current: { fingerprint: string; modelName: string; dimension: number | null },
): EmbeddingMismatchReason | null {
    if (stored.modelId && current.fingerprint !== 'unknown') {
        const same = stored.modelId === current.fingerprint
            || (isLegacyModelId(stored.modelId) && stored.modelId === current.modelName);
        if (!same) return 'model';
    }
    if (
        typeof stored.dimensionCount === 'number' && stored.dimensionCount > 0
        && typeof current.dimension === 'number' && current.dimension > 0
        && stored.dimensionCount !== current.dimension
    ) {
        return 'dimension';
    }
    return null;
}
