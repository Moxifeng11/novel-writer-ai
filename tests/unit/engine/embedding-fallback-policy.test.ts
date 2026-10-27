import { describe, expect, it, vi } from 'vitest';
import { EmbeddingProviderFactory, type ProviderFactoryConfig } from '../../../engine/embedding/provider-factory';
import type { EmbeddingProvider } from '../../../engine/embedding/embedding-provider';

function config(overrides: Partial<ProviderFactoryConfig> = {}): ProviderFactoryConfig {
    return {
        vectorProviderType: 'openai',
        vectorOllamaBaseUrl: 'http://localhost:11434',
        vectorOllamaModel: 'bge-m3',
        vectorOpenaiBaseUrl: 'https://api.openai.com/v1',
        vectorOpenaiModel: 'text-embedding-3-small',
        vectorOpenaiApiKey: 'k',
        ...overrides,
    };
}

function fakeProvider(available: boolean): EmbeddingProvider {
    return {
        embed: vi.fn(async () => [1, 2, 3]),
        embedBatch: vi.fn(async () => [[1, 2, 3]]),
        isAvailable: vi.fn(async () => ({ available, reason: available ? undefined : 'down' })),
        getProviderInfo: vi.fn(() => ({ type: 'ollama', name: 'fake', model: 'fake' })),
        getModelName: vi.fn(() => 'fake'),
        getDimensions: vi.fn(async () => 3),
    } as unknown as EmbeddingProvider;
}

describe('EmbeddingProviderFactory — 回退策略', () => {
    it('local-only 只回退到 Ollama，不尝试云端 provider', async () => {
        const primary = fakeProvider(false);
        const ollama = fakeProvider(true);
        const create = vi.spyOn(EmbeddingProviderFactory, 'create').mockImplementation((cfg) => {
            return cfg.vectorProviderType === 'ollama' ? ollama : primary;
        });

        try {
            const provider = await EmbeddingProviderFactory.createWithFallback(
                config({ embeddingFallbackPolicy: 'local-only' }),
            );
            expect(provider).toBe(ollama);
            const tried = create.mock.calls.map(c => c[0].vectorProviderType);
            expect(tried).toContain('ollama');
            expect(tried).not.toContain('doubao');
            expect(tried).not.toContain('qwen');
        } finally {
            create.mockRestore();
        }
    });

    it('never 策略下主 provider 不可用直接抛错，不回退', async () => {
        const create = vi.spyOn(EmbeddingProviderFactory, 'create').mockReturnValue(fakeProvider(false));
        try {
            await expect(
                EmbeddingProviderFactory.createWithFallback(
                    config({ embeddingFallbackPolicy: 'never' }),
                ),
            ).rejects.toThrow(/never/);
            expect(create).toHaveBeenCalledTimes(1);
        } finally {
            create.mockRestore();
        }
    });

    it('allow-cloud 才允许回退到云端 provider', async () => {
        const primary = fakeProvider(false);
        const fallback = fakeProvider(true);
        const order: string[] = [];
        const create = vi.spyOn(EmbeddingProviderFactory, 'create').mockImplementation((cfg) => {
            order.push(cfg.vectorProviderType);
            if (cfg.vectorProviderType === 'qwen') return primary;
            if (cfg.vectorProviderType === 'ollama') return fakeProvider(false);
            return fallback;
        });

        try {
            const provider = await EmbeddingProviderFactory.createWithFallback(
                config({ vectorProviderType: 'qwen', embeddingFallbackPolicy: 'allow-cloud' }),
            );
            expect(provider).toBe(fallback);
            expect(order).toContain('openai');
        } finally {
            create.mockRestore();
        }
    });
});
