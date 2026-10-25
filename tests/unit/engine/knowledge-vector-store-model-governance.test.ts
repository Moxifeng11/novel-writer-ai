/**
 * knowledge-vector-store-model-governance.test.ts — 知识库向量的 embedding 模型治理
 *
 * 向量文件不带模型标识时，换 embedding 模型后旧向量仍会被加载：
 * 同维度会混算出假相似度，不同维度会让 cosineSimilarity 直接抛错。
 * 治理策略：写入时记录 embedding 指纹（provider:model@baseUrlHash）+ 维度；
 * 加载/重建时跳过不一致的书（保留文件，重新拆解即可重建）。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';
import { computeEmbeddingFingerprint } from '../../../engine/embedding/embedding-fingerprint';
import { kbVectorsDir } from '../../../shared/paths';

/** 与生产实现同一套指纹定义：providerType:model@shortHash(baseUrl) */
function fingerprint(model: string, baseUrl = ''): string {
    return computeEmbeddingFingerprint({ type: 'mock', name: 'mock', model }, baseUrl);
}

class MockEmbeddingProvider implements EmbeddingProvider {
    constructor(
        private model = 'mock-embed',
        private dims = 8,
        private baseUrl = '',
    ) {}
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(this.dims).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % this.dims] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: this.model, dimensions: this.dims };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: this.model, dimensions: this.dims };
    }
    getModelName(): string { return this.model; }
    getBaseUrl(): string { return this.baseUrl; }
    async getDimensions(): Promise<number> { return this.dims; }
}

function makeStore(
    vault: Vault,
    model = 'mock-embed',
    dims = 8,
    baseUrl = '',
): KnowledgeVectorStore {
    return new KnowledgeVectorStore({ vault } as any, new MockEmbeddingProvider(model, dims, baseUrl));
}

function makeBookFile(
    bookId: string,
    bookName: string,
    vector: number[],
    modelId?: string,
    dimensionCount?: number,
): string {
    return JSON.stringify({
        bookId,
        bookName,
        ...(modelId ? { modelId } : {}),
        ...(typeof dimensionCount === 'number' ? { dimensionCount } : {}),
        samples: [{
            id: `${bookId}-s1`,
            bookId,
            bookName,
            dimension: 'original',
            sample: `${bookId} 的原文片段`,
            vector,
            position: 0,
        }],
    });
}

describe('KnowledgeVectorStore — embedding 模型治理', () => {
    it('写入向量时记录当前模型指纹与维度', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书甲');

        const store = makeStore(vault);
        await store.init();
        await store.replaceBookSamples('book-a', '书甲', [
            { dimension: 'original', sample: '书甲的原文片段', position: 0 },
        ]);

        const raw = JSON.parse(await (vault as any).readByPath(`${kbVectorsDir()}/book-a.json`));
        expect(raw.modelId).toBe(fingerprint('mock-embed'));
        expect(raw.dimensionCount).toBe(8);
    });

    it('换模型后跳过旧模型向量，文件保留并给出跳过清单', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书乙');

        const writer = makeStore(vault, 'old-model');
        await writer.init();
        await writer.replaceBookSamples('book-b', '书乙', [
            { dimension: 'original', sample: '旧模型生成的原文片段', position: 0 },
        ]);

        const reader = makeStore(vault, 'mock-embed');
        await reader.init();

        expect(await reader.search('旧模型生成的原文片段', { topN: 5 })).toEqual([]);
        expect(reader.getModelMismatches()).toEqual([{
            bookId: 'book-b',
            bookName: '书乙',
            storedModelId: fingerprint('old-model'),
            currentModelId: fingerprint('mock-embed'),
            reason: 'model',
        }]);
        // 只跳过、不删除：知识库原文仍在，重新拆解即可重建
        expect((vault as any).exists(`${kbVectorsDir()}/book-b.json`)).toBe(true);
    });

    it('同模型名换端点（baseUrl）也视为模型不一致', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书端');

        const writer = makeStore(vault, 'mock-embed', 8, 'http://127.0.0.1:11434');
        await writer.init();
        await writer.replaceBookSamples('book-endpoint', '书端', [
            { dimension: 'original', sample: '同模型换端点', position: 0 },
        ]);

        // 同名模型、不同端点：向量空间不可假设一致
        const reader = makeStore(vault, 'mock-embed', 8, 'http://127.0.0.1:11435');
        await reader.init();

        expect(await reader.search('同模型换端点', { topN: 5 })).toEqual([]);
        expect(reader.getModelMismatches()[0].reason).toBe('model');
    });

    it('同模型同端点但维度变化时按维度不一致跳过', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书维');

        const writer = makeStore(vault, 'mock-embed', 8);
        await writer.init();
        await writer.replaceBookSamples('book-dim-change', '书维', [
            { dimension: 'original', sample: '维度变化的旧向量', position: 0 },
        ]);

        const reader = makeStore(vault, 'mock-embed', 4);
        await reader.init();

        expect(await reader.search('维度变化的旧向量', { topN: 5 })).toEqual([]);
        expect(reader.getModelMismatches()[0].reason).toBe('dimension');
    });

    it('旧文件没有 modelId 时按兼容策略加载', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(kbVectorsDir());
        const sample = 'book-legacy 的原文片段';
        const vector = await new MockEmbeddingProvider().embed(sample);
        await (vault as any)._seedFile(
            `${kbVectorsDir()}/book-legacy.json`,
            makeBookFile('book-legacy', '书旧', vector),
        );

        const store = makeStore(vault);
        await store.init();

        const results = await store.search(sample, { topN: 5 });
        expect(results).toHaveLength(1);
        expect(results[0].bookId).toBe('book-legacy');
        expect(store.getModelMismatches()).toEqual([]);
    });

    it('旧文件是纯模型名（升级前格式）时按模型名兼容加载', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(kbVectorsDir());
        const sample = 'book-legacy-name 的原文片段';
        const vector = await new MockEmbeddingProvider().embed(sample);
        await (vault as any)._seedFile(
            `${kbVectorsDir()}/book-legacy-name.json`,
            makeBookFile('book-legacy-name', '书旧名', vector, 'mock-embed'),
        );

        const store = makeStore(vault);
        await store.init();

        const results = await store.search(sample, { topN: 5 });
        expect(results).toHaveLength(1);
        expect(store.getModelMismatches()).toEqual([]);
    });

    it('重新拆解后写回新模型，并移出跳过清单', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书丙');

        const writer = makeStore(vault, 'old-model');
        await writer.init();
        await writer.replaceBookSamples('book-c', '书丙', [
            { dimension: 'original', sample: '旧模型书丙片段', position: 0 },
        ]);

        const reader = makeStore(vault, 'mock-embed');
        await reader.init();
        expect(reader.getModelMismatches()).toHaveLength(1);

        await reader.replaceBookSamples('book-c', '书丙', [
            { dimension: 'original', sample: '新模型书丙片段', position: 0 },
        ]);
        expect(reader.getModelMismatches()).toEqual([]);

        const reloaded = makeStore(vault, 'mock-embed');
        await reloaded.init();
        expect(reloaded.getModelMismatches()).toEqual([]);
        const results = await reloaded.search('新模型书丙片段', { topN: 5 });
        expect(results).toHaveLength(1);
        expect(results[0].bookId).toBe('book-c');
    });

    it('旧文件维度与当前模型不一致时跳过样本而不是抛错', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(kbVectorsDir());
        await (vault as any)._seedFile(
            `${kbVectorsDir()}/book-dim.json`,
            makeBookFile('book-dim', '书维', [1, 0, 0, 0], undefined, 4),
        );

        const store = makeStore(vault);
        await store.init();

        await expect(store.search('book-dim 的原文片段', { topN: 5 })).resolves.toEqual([]);
        expect(store.getModelMismatches()[0].reason).toBe('dimension');
    });
});
