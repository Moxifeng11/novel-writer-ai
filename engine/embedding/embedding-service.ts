/**
 * embedding-service.ts — 全插件共享的 embedding provider
 *
 * 知识库、协同写作、指纹库、拆解增强如果各自创建 provider，会出现：
 * - 同一个模型被重复探测/重复请求
 * - 本地/云端 provider 混用，向量维度不一致
 * - 指纹库忘记 setEmbeddingClient，V2 检索静默为空
 *
 * EngineRegistry 初始化时写入唯一实例，其他模块优先取共享实例。
 */
import type { EmbeddingProvider } from './embedding-provider';

let sharedProvider: EmbeddingProvider | null = null;

export function setSharedEmbeddingProvider(provider: EmbeddingProvider | null): void {
    sharedProvider = provider;
}

export function getSharedEmbeddingProvider(): EmbeddingProvider | null {
    return sharedProvider;
}

export function clearSharedEmbeddingProvider(): void {
    sharedProvider = null;
}

/** 共享 provider 的身份；用于向量索引元数据/重建判断。 */
export function getSharedEmbeddingIdentity(): { type: string; model: string; dimensions?: number } | null {
    if (!sharedProvider) return null;
    try {
        const info = sharedProvider.getProviderInfo();
        return { type: info.type, model: info.model, dimensions: info.dimensions };
    } catch {
        return null;
    }
}
