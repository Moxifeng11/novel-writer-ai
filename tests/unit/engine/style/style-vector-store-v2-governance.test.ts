import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    StyleVectorStoreV2,
    type StyleFingerprintVectorsV2,
} from '../../../../engine/style/style-vector-store-v2';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import { computeEmbeddingFingerprint } from '../../../../engine/embedding/embedding-fingerprint';
import type { StyleFingerprintFeaturesV2, StyleDimensionKeyV2 } from '../../../../engine/style/style-dimensions-v2';
import { STYLE_DIMENSION_KEYS_V2, STYLE_DIMENSION_LABELS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintVectorsDir } from '../../../../shared/paths';

/** 与生产实现同一套指纹定义：providerType:model@shortHash(baseUrl) */
function fingerprint(model: string, baseUrl = ''): string {
    return computeEmbeddingFingerprint({ type: 'mock', name: 'mock', model }, baseUrl);
}

class MockEmbeddingProvider implements EmbeddingProvider {
    constructor(private model = 'mock-embed', private baseUrl = '') {}
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % 8] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: this.model, dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: this.model, dimensions: 8 };
    }
    getModelName(): string { return this.model; }
    getBaseUrl(): string { return this.baseUrl; }
    async getDimensions(): Promise<number> { return 8; }
}

function makeFeatures(): StyleFingerprintFeaturesV2 {
    const keys: StyleDimensionKeyV2[] = [...STYLE_DIMENSION_KEYS_V2];
    const features = {} as StyleFingerprintFeaturesV2;
    for (const key of keys) {
        (features as any)[key] = {
            description: `desc-${STYLE_DIMENSION_LABELS_V2[key]}`,
            samples: [`sample-${key}`],
            status: 'complete' as const,
        };
    }
    return features;
}

function makeStoredVectors(
    fingerprintId: string,
    modelId: string,
    dimensionCount = 8,
): StyleFingerprintVectorsV2 {
    const dimensions = {} as StyleFingerprintVectorsV2['dimensions'];
    for (const key of STYLE_DIMENSION_KEYS_V2) {
        dimensions[key] = {
            dimension: key,
            vector: new Array(8).fill(0.5),
            sourceText: key,
            approximated: false,
        };
    }
    return {
        fingerprintId,
        version: 'v2',
        dimensions,
        overallVector: new Array(8).fill(0.5),
        modelId,
        dimensionCount,
        updatedAt: Date.now(),
    };
}

describe('StyleVectorStoreV2 — 维度治理（Phase 4.2）', () => {
    let fs: MockFileSystem;
    let store: StyleVectorStoreV2;

    beforeEach(() => {
        fs = new MockFileSystem();
        store = new StyleVectorStoreV2({ vault: {} } as any, 'global', new MockEmbeddingProvider(), undefined, fs as any);
    });

    it('生成向量时记录 embedding 模型指纹与维度', async () => {
        const vectors = await store.buildV2Vectors('fp-1', makeFeatures());
        expect(vectors.modelId).toBe(fingerprint('mock-embed'));
        expect(vectors.dimensionCount).toBe(vectors.overallVector.length);
    });

    it('换 embedding 模型后加载旧向量会被隔离，并给出重建报告', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-old.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(makeStoredVectors('fp-old', fingerprint('old-model'))));

        await store.reload();

        expect(store.getVectors('fp-old')).toBeUndefined();
        expect(await fs.exists(filePath)).toBe(false);
        expect(await fs.exists(`${filePath}.mismatch.bak`)).toBe(true);

        const mismatches = await store.reportModelMismatches();
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].fingerprintId).toBe('fp-old');
        expect(mismatches[0].storedModelId).toBe(fingerprint('old-model'));
        expect(mismatches[0].currentModelId).toBe(fingerprint('mock-embed'));
        expect(mismatches[0].reason).toBe('model');
    });

    it('同模型名换端点（baseUrl）也视为模型不一致', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-endpoint.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(
            makeStoredVectors('fp-endpoint', fingerprint('mock-embed', 'http://127.0.0.1:11434')),
        ));

        const other = new StyleVectorStoreV2(
            { vault: {} } as any,
            'global',
            new MockEmbeddingProvider('mock-embed', 'http://127.0.0.1:11435'),
            undefined,
            fs as any,
        );
        await other.reload();

        expect(other.getVectors('fp-endpoint')).toBeUndefined();
        const mismatches = await other.reportModelMismatches();
        expect(mismatches[0].reason).toBe('model');
    });

    it('模型一致但维度变化时按维度不一致隔离', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-dim.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(
            makeStoredVectors('fp-dim', fingerprint('mock-embed'), 4),
        ));

        await store.reload();

        expect(store.getVectors('fp-dim')).toBeUndefined();
        const mismatches = await store.reportModelMismatches();
        expect(mismatches[0].reason).toBe('dimension');
    });

    it('旧文件没有 modelId 时按兼容策略加载', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-legacy.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(makeStoredVectors('fp-legacy', '')));

        await store.reload();

        expect(store.getVectors('fp-legacy')).toBeDefined();
        expect(await store.reportModelMismatches()).toEqual([]);
    });

    it('旧文件是纯模型名（升级前格式）时按模型名兼容加载', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-legacy-name.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(makeStoredVectors('fp-legacy-name', 'mock-embed')));

        await store.reload();

        expect(store.getVectors('fp-legacy-name')).toBeDefined();
        expect(await store.reportModelMismatches()).toEqual([]);
    });

    it('模型一致时正常加载', async () => {
        const dir = `${globalFingerprintVectorsDir()}/v2`;
        const filePath = `${dir}/style-fp-same.json`;
        await fs.mkdir(dir);
        await fs.write(filePath, JSON.stringify(makeStoredVectors('fp-same', fingerprint('mock-embed'))));

        await store.reload();

        expect(store.getVectors('fp-same')).toBeDefined();
        expect(await store.reportModelMismatches()).toEqual([]);
    });
});
