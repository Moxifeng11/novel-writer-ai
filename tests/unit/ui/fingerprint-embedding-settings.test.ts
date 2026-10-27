import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { createFingerprintEmbedding } from '../../../ui/fingerprint-embedding';
import { clearSharedEmbeddingProvider, setSharedEmbeddingProvider } from '../../../engine/embedding/embedding-service';

afterEach(() => clearSharedEmbeddingProvider());

describe('createFingerprintEmbedding — 显式设置优先', () => {
    it('共享 provider 是旧模型时，按当前 settings 构造，避免向量 modelId 不一致', () => {
        setSharedEmbeddingProvider({
            getProviderInfo: () => ({ type: 'ollama', name: 'stale', model: 'stale-model' }),
            getModelName: () => 'stale-model',
        } as never);

        const { provider } = createFingerprintEmbedding(
            new App() as never,
            'global',
            {
                vectorProviderType: 'ollama',
                vectorOllamaBaseUrl: 'http://localhost:11434',
                vectorOllamaModel: 'current-model',
            },
        );

        expect(provider.getProviderInfo().model).toBe('current-model');
    });
});
