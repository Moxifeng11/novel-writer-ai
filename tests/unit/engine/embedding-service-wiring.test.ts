import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StyleFingerprintLibrary } from '../../../engine/style-fingerprint-library';
import { KnowledgeToFingerprintConverter } from '../../../engine/knowledge-to-fingerprint-converter';
import {
    clearSharedEmbeddingProvider,
    setSharedEmbeddingProvider,
} from '../../../engine/embedding/embedding-service';
import type { EmbeddingProvider } from '../../../engine/embedding/embedding-provider';

function fakeProvider(): EmbeddingProvider {
    return {
        embed: vi.fn(async () => [1, 2, 3]),
        embedBatch: vi.fn(async () => [[1, 2, 3]]),
        isAvailable: vi.fn(async () => ({ available: true })),
        getProviderInfo: vi.fn(() => ({ type: 'ollama', name: 'fake', model: 'bge-m3' })),
        getModelName: vi.fn(() => 'bge-m3'),
        getDimensions: vi.fn(async () => 3),
    } as unknown as EmbeddingProvider;
}

describe('EmbeddingService — 共享 provider 自动注入', () => {
    afterEach(() => clearSharedEmbeddingProvider());

    it('StyleFingerprintLibrary 构造时自动注入共享 embedding', () => {
        const provider = fakeProvider();
        setSharedEmbeddingProvider(provider);

        const library = new StyleFingerprintLibrary({} as never, '项目');

        expect((library as unknown as { embeddingClient?: EmbeddingProvider }).embeddingClient).toBe(provider);
    });

    it('KnowledgeToFingerprintConverter 未显式传 client 时使用共享实例', () => {
        const provider = fakeProvider();
        setSharedEmbeddingProvider(provider);

        const converter = new KnowledgeToFingerprintConverter({} as never);

        expect((converter as unknown as { embeddingClient?: EmbeddingProvider }).embeddingClient).toBe(provider);
    });

    it('显式传入的 client 优先于共享实例', () => {
        const shared = fakeProvider();
        const explicit = fakeProvider();
        setSharedEmbeddingProvider(shared);

        const converter = new KnowledgeToFingerprintConverter({} as never, explicit);

        expect((converter as unknown as { embeddingClient?: EmbeddingProvider }).embeddingClient).toBe(explicit);
    });
});
