/**
 * vector-signature-b2.test.ts — 缓存签名必须包含 embedding 指纹
 *
 * 只按文件 path@mtime:size 做签名时，切换 embedding 模型/端点后向量文件本身没变，
 * 内存里仍是旧模型向量：同维度会混算出假相似度，维度不同会让检索抛错。
 * B2 修复：签名前缀加入 embedding 指纹，切换后同会话即可重载并隔离旧向量。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import { LocalVectorStore } from '../../../engine/local-vector-store';
import { MockFileSystem } from '../../../shared/file-system-port';
import { StyleVectorStoreV2, type StyleFingerprintVectorsV2 } from '../../../engine/style/style-vector-store-v2';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../engine/style/style-dimensions-v2';
import { computeEmbeddingFingerprint } from '../../../engine/embedding/embedding-fingerprint';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';
import { globalFingerprintVectorsDir } from '../../../shared/paths';

const PROJECT = '签名测试项目';

/** 可变模型名：模拟用户在同一会话里切换 embedding 配置 */
class MutableProvider implements EmbeddingProvider {
    constructor(public model: string, private dims = 8) {}
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
    getDimensions(): Promise<number> { return Promise.resolve(this.dims); }
}

function fingerprint(model: string): string {
    return computeEmbeddingFingerprint({ type: 'mock', name: 'mock', model });
}

function makeV2File(fingerprintId: string, modelId: string): StyleFingerprintVectorsV2 {
    const dimensions = {} as StyleFingerprintVectorsV2['dimensions'];
    for (const key of STYLE_DIMENSION_KEYS_V2) {
        dimensions[key] = { dimension: key, vector: new Array(8).fill(0.5), sourceText: key, approximated: false };
    }
    return {
        fingerprintId,
        version: 'v2',
        dimensions,
        overallVector: new Array(8).fill(0.5),
        modelId,
        dimensionCount: 8,
        updatedAt: Date.now(),
    };
}

describe('B2 — 缓存签名包含 embedding 指纹', () => {
    it('知识库：同会话切换模型后重载并隔离旧向量', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/书签');

        const provider = new MutableProvider('model-a');
        const store = new KnowledgeVectorStore({ vault } as any, provider);
        await store.init();
        await store.replaceBookSamples('book-sig', '书签', [
            { dimension: 'original', sample: '签名测试原文', position: 0 },
        ]);
        expect(await store.search('签名测试原文', { topN: 5 })).toHaveLength(1);

        provider.model = 'model-b';

        // 文件没变，仅指纹变了；签名不含指纹时会继续用内存里的旧向量
        expect(await store.search('签名测试原文', { topN: 5 })).toEqual([]);
        expect(store.getModelMismatches()).toHaveLength(1);
        expect(store.getModelMismatches()[0].currentModelId).toBe(fingerprint('model-b'));
    });

    it('指纹 V1：同会话切换模型后重载并跳过旧向量', async () => {
        const vault = new Vault();
        const provider = new MutableProvider('model-a', 3);
        const store = new LocalVectorStore({ vault } as any, 'project', provider, PROJECT);

        await store.add('fp-sig', ['签名测试样本']);
        expect(await store.search('签名测试样本', 3)).toHaveLength(1);

        provider.model = 'model-b';

        expect(await store.search('签名测试样本', 3)).toEqual([]);
        expect(store.getModelMismatches()).toHaveLength(1);
    });

    it('指纹 V2：同会话切换模型后重载并隔离旧文件', async () => {
        const fs = new MockFileSystem();
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-sig.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(makeV2File('fp-sig', fingerprint('model-a'))));

        const provider = new MutableProvider('model-a');
        const store = new StyleVectorStoreV2({ vault: {} } as any, 'global', provider, undefined, fs as any);
        expect(await store.reportModelMismatches()).toEqual([]);

        provider.model = 'model-b';

        const mismatches = await store.reportModelMismatches();
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].storedModelId).toBe(fingerprint('model-a'));
        expect(mismatches[0].currentModelId).toBe(fingerprint('model-b'));
        expect(await fs.exists(filePath)).toBe(false);
    });
});
