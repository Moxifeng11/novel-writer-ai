import { App } from 'obsidian';
import { LocalVectorStore } from '../engine/local-vector-store';
import { EmbeddingProviderFactory } from '../engine/embedding/provider-factory';
import { getSharedEmbeddingProvider } from '../engine/embedding/embedding-service';
import type { ProviderFactoryConfig } from '../engine/embedding/provider-factory';
import type { EmbeddingProvider } from '../engine/embedding/embedding-provider';

/**
 * 指纹提取/重提的 embedding 与向量存储必须成对构造，且统一跟随「向量提供商」设置。
 * 此前各 UI 入口各自 `new OllamaEmbeddingClient(...)`：用户选云端向量后，写入的向量
 * 与检索侧模型不一致，最终被模型治理跳过，表现为指纹注入静默消失。
 * @param app - Obsidian 应用实例
 * @param scope - 作用域
 * @param settings - 设置
 * @param project - 项目（路径或对象）
  * @returns LocalVectorStore } 实例
 */
export function createFingerprintEmbedding(
    app: App,
    scope: 'global' | 'project',
    settings: Partial<ProviderFactoryConfig> | undefined,
    project?: string,
): { provider: EmbeddingProvider; vectorStore: LocalVectorStore } {
    // 有显式 settings 时必须按当前设置构造：共享 provider 只在插件初始化时创建，
    // 用户切换向量 provider/model 后尚未 reload 时，共享实例可能是旧模型。
    // 用旧 provider 写入新模型向量会造成 modelId/维度不一致，检索时被治理逻辑跳过。
    const provider = settings
        ? EmbeddingProviderFactory.fromSettings(settings)
        : getSharedEmbeddingProvider() ?? EmbeddingProviderFactory.fromSettings(undefined);
    return { provider, vectorStore: new LocalVectorStore(app, scope, provider, project) };
}
