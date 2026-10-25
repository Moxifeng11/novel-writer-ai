import { App } from 'obsidian';
import { LocalVectorStore } from '../engine/local-vector-store';
import { EmbeddingProviderFactory } from '../engine/embedding/provider-factory';
import type { ProviderFactoryConfig } from '../engine/embedding/provider-factory';
import type { EmbeddingProvider } from '../engine/embedding/embedding-provider';

/**
 * 指纹提取/重提的 embedding 与向量存储必须成对构造，且统一跟随「向量提供商」设置。
 * 此前各 UI 入口各自 `new OllamaEmbeddingClient(...)`：用户选云端向量后，写入的向量
 * 与检索侧模型不一致，最终被模型治理跳过，表现为指纹注入静默消失。
 */
export function createFingerprintEmbedding(
    app: App,
    scope: 'global' | 'project',
    settings: Partial<ProviderFactoryConfig> | undefined,
    project?: string,
): { provider: EmbeddingProvider; vectorStore: LocalVectorStore } {
    const provider = EmbeddingProviderFactory.fromSettings(settings);
    return { provider, vectorStore: new LocalVectorStore(app, scope, provider, project) };
}
