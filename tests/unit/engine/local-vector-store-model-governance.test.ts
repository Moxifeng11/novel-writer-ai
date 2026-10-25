/**
 * local-vector-store-model-governance.test.ts — 指纹 V1 向量的 embedding 模型治理
 *
 * `LocalVectorStore#search` 直接调 `cosineSimilarity`，维度不等会 throw；
 * 上游 `PromptBuilder#getFingerprintPromptParts` 整体 catch 后返回空数组，
 * 表现为「换 embedding 模型后写作指纹风格参考整段静默消失」。
 * 治理策略：写入时记录 embedding 指纹（provider:model@baseUrlHash）+ 维度；
 * 加载时跳过不一致的指纹（保留文件，重新提取即可重建）；
 * 检索时跳过维度不一致样本，避免一个旧文件把整段注入打成空。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { LocalVectorStore } from '../../../engine/local-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';
import { computeEmbeddingFingerprint } from '../../../engine/embedding/embedding-fingerprint';
import { projectFingerprintVectorsDir } from '../../../shared/paths';

const PROJECT = '测试项目';

/** 与生产实现同一套指纹定义：providerType:model@shortHash(baseUrl) */
function fingerprint(model: string, baseUrl = ''): string {
    return computeEmbeddingFingerprint({ type: 'mock', name: 'mock', model }, baseUrl);
}

class MockEmbeddingProvider implements EmbeddingProvider {
    constructor(
        private model = 'mock-embed',
        private dims = 3,
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
    dims = 3,
    baseUrl = '',
): LocalVectorStore {
    return new LocalVectorStore(
        { vault } as any,
        'project',
        new MockEmbeddingProvider(model, dims, baseUrl),
        PROJECT,
    );
}

function filePath(fingerprintId: string): string {
    return `${projectFingerprintVectorsDir(PROJECT)}/fp-${fingerprintId}.json`;
}

describe('LocalVectorStore — embedding 模型治理', () => {
    it('写入向量时记录当前 embedding 模型指纹与维度', async () => {
        const vault = new Vault();
        const store = makeStore(vault);
        await store.add('fp-a', ['样本甲']);

        const raw = JSON.parse(await (vault as any).readByPath(filePath('fp-a')));
        expect(raw.modelId).toBe(fingerprint('mock-embed'));
        expect(raw.dimensionCount).toBe(3);
        expect(raw.samples).toHaveLength(1);
    });

    it('换模型后跳过旧模型向量，文件保留并给出跳过清单', async () => {
        const vault = new Vault();
        const writer = makeStore(vault, 'old-model');
        await writer.add('fp-old', ['旧模型样本']);

        const reader = makeStore(vault, 'mock-embed');
        expect(await reader.search('旧模型样本', 5)).toEqual([]);
        expect(reader.getModelMismatches()).toEqual([{
            fingerprintId: 'fp-old',
            storedModelId: fingerprint('old-model'),
            currentModelId: fingerprint('mock-embed'),
            reason: 'model',
        }]);
        // 只跳过、不删除：向量可从指纹特征重新提取
        expect((vault as any).exists(filePath('fp-old'))).toBe(true);
    });

    it('同模型名换端点（baseUrl）也视为模型不一致', async () => {
        const vault = new Vault();
        const writer = makeStore(vault, 'mock-embed', 3, 'http://127.0.0.1:11434');
        await writer.add('fp-endpoint', ['同模型换端点样本']);

        const reader = makeStore(vault, 'mock-embed', 3, 'http://127.0.0.1:11435');
        expect(await reader.search('同模型换端点样本', 5)).toEqual([]);
        expect(reader.getModelMismatches()[0].reason).toBe('model');
    });

    it('同模型同端点但维度变化时按维度不一致跳过', async () => {
        const vault = new Vault();
        const writer = makeStore(vault, 'mock-embed', 3);
        await writer.add('fp-dim-change', ['维度变化样本']);

        const reader = makeStore(vault, 'mock-embed', 4);
        expect(await reader.search('维度变化样本', 5)).toEqual([]);
        expect(reader.getModelMismatches()[0].reason).toBe('dimension');
    });

    it('旧文件没有 modelId 时按兼容策略加载', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(projectFingerprintVectorsDir(PROJECT));
        await (vault as any)._seedFile(filePath('fp-legacy'), JSON.stringify({
            fingerprintId: 'fp-legacy',
            samples: [{ sample: '旧文件样本', vector: [1, 0, 0] }],
        }));

        const store = makeStore(vault);
        const results = await store.search('旧文件样本', 5);

        expect(results).toHaveLength(1);
        expect(results[0].fingerprintId).toBe('fp-legacy');
        expect(store.getModelMismatches()).toEqual([]);
    });

    it('旧文件是纯模型名（升级前格式）时按模型名兼容加载', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(projectFingerprintVectorsDir(PROJECT));
        await (vault as any)._seedFile(filePath('fp-legacy-name'), JSON.stringify({
            fingerprintId: 'fp-legacy-name',
            modelId: 'mock-embed',
            samples: [{ sample: '纯模型名旧样本', vector: [1, 0, 0] }],
        }));

        const store = makeStore(vault);
        const results = await store.search('纯模型名旧样本', 5);

        expect(results).toHaveLength(1);
        expect(store.getModelMismatches()).toEqual([]);
    });

    it('旧文件维度与当前模型不一致时跳过样本而不是抛错', async () => {
        const vault = new Vault();
        await vault.adapter.mkdir(projectFingerprintVectorsDir(PROJECT));
        await (vault as any)._seedFile(filePath('fp-dim'), JSON.stringify({
            fingerprintId: 'fp-dim',
            dimensionCount: 4,
            samples: [{ sample: '四维旧样本', vector: [1, 0, 0, 0] }],
        }));

        const store = makeStore(vault);
        await expect(store.search('四维旧样本', 5)).resolves.toEqual([]);
        expect(store.getModelMismatches()[0].reason).toBe('dimension');
    });

    it('重新添加样本后写回新模型，并移出跳过清单', async () => {
        const vault = new Vault();
        const writer = makeStore(vault, 'old-model');
        await writer.add('fp-b', ['旧模型样本']);

        const reader = makeStore(vault, 'mock-embed');
        await reader.search('任意查询', 5);
        expect(reader.getModelMismatches()).toHaveLength(1);

        await reader.add('fp-b', ['新模型样本']);

        expect(reader.getModelMismatches()).toEqual([]);
        const raw = JSON.parse(await (vault as any).readByPath(filePath('fp-b')));
        expect(raw.modelId).toBe(fingerprint('mock-embed'));
        const results = await reader.search('新模型样本', 5);
        expect(results).toHaveLength(1);
        expect(results[0].sample).toBe('新模型样本');
    });
});
