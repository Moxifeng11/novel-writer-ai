import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import { StyleFeaturesAnalyzerV2 } from '../../../../engine/style/style-features-v2';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintsFile } from '../../../../shared/paths';

/**
 * addV2Fingerprint 直存路径（v4.46.0）：
 * 蒸馏样本的本地十二维统计 → 磁盘直接落 `version:'v2'` 全量特征，
 * 不再依赖「先 V1 落盘、等迁移」；同时 V2 逐维向量即时可检索。
 */

class MockEmbeddingProvider implements EmbeddingProvider {
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
        return { available: true, model: 'mock-embed', dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: 'mock-embed' };
    }
    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

const SAMPLE_TEXT = `他突然停下了脚步。

我心中一惊，难道这就是传说中的玄机？然而，转身的瞬间，我却看到了一抹熟悉的微笑。

月光如水，洒在庭院之中。风轻轻地吹过，带来阵阵花香。

「你来了。」他轻声说道。

「嗯。」我回答道，心中却充满了疑惑。

但是，事情并没有那么简单。然而，谁也没有想到，这只是一个开始。`;

async function makeAnalysis() {
    return await new StyleFeaturesAnalyzerV2().analyze(SAMPLE_TEXT);
}

describe('StyleFingerprintLibrary — addV2Fingerprint 直存', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(() => {
        vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
    });

    it('创建后立即具备 V2 条目（12 维）与 V1 投影，且 V2 向量可检索', async () => {
        await library.loadGlobal();
        const analysis = await makeAnalysis();
        const saved = await library.addV2Fingerprint({
            scope: 'global',
            name: '蒸馏样本指纹',
            source: '蒸馏样本',
            analysis,
        });

        const v2 = library.getV2Fingerprint(saved.id);
        expect(v2).toBeDefined();
        expect(v2!.version).toBe('v2');
        expect(Object.keys(v2!.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        expect(v2!.stats.wordCount).toBe(analysis.stats.totalChars);
        expect(v2!.stats.avgSentenceLength).toBe(analysis.features.rhythm.avgSentenceLength);

        // V1 消费方拿到投影（rhythm.description → sentenceRhythm）
        const v1 = library.getGlobal(saved.id);
        expect(v1).toBeDefined();
        expect(v1!.features.sentenceRhythm).toBe(analysis.features.rhythm.description);

        // V2 向量已即时构建，无需整体重建即可检索
        const hits = await library.searchSimilarStylesV2(SAMPLE_TEXT.slice(0, 40), { topN: 3 });
        expect(hits.some(h => h.fingerprintId === saved.id)).toBe(true);
    });

    it('重载后 V2 形态不降级（磁盘即 version v2）', async () => {
        await library.loadGlobal();
        const analysis = await makeAnalysis();
        const saved = await library.addV2Fingerprint({
            scope: 'global',
            name: '重载指纹',
            source: '蒸馏样本',
            analysis,
        });

        const library2 = new StyleFingerprintLibrary({ vault } as any);
        library2.setEmbeddingClient(new MockEmbeddingProvider());
        await library2.loadGlobal();

        const v2 = library2.getV2Fingerprint(saved.id);
        expect(v2).toBeDefined();
        expect(v2!.version).toBe('v2');
        expect(Object.keys(v2!.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);

        // V1 投影与 V2 描述一致（toPersistedFingerprint 的 same 检查在后续保存中仍成立）
        const v1 = library2.getGlobal(saved.id);
        expect(v1!.features.sentenceRhythm).toBe(v2!.features.rhythm.description);

        // 磁盘文件直接是 version:'v2' 全量特征（不经过「先 V1 再迁移」）
        const raw = await (vault as any).readByPath(globalFingerprintsFile());
        const entry = JSON.parse(raw).find((fp: { id: string }) => fp.id === saved.id);
        expect(entry.version).toBe('v2');
        expect(Object.keys(entry.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
    });

    it('未设置项目时拒绝 project 作用域（不做半写）', async () => {
        await library.loadGlobal();
        const analysis = await makeAnalysis();
        await expect(library.addV2Fingerprint({
            scope: 'project',
            name: '无项目指纹',
            source: '蒸馏样本',
            analysis,
        })).rejects.toThrow('未设置项目');
        // 不留半写状态：V2 缓存与 V1 表都没有该条目
        expect(library.listV2Fingerprints('project')).toHaveLength(0);
    });
});


describe('StyleFingerprintLibrary — updateV2FingerprintFeatures 编辑路径', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(() => {
        vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
    });

    it('更新后 V2 / V1 投影 / 磁盘三方一致，重载不降级', async () => {
        await library.loadGlobal();
        const analysis = await makeAnalysis();
        const saved = await library.addV2Fingerprint({
            scope: 'global',
            name: '编辑前指纹',
            source: '蒸馏样本',
            analysis,
        });

        const edited = {
            ...analysis.features,
            rhythm: { ...analysis.features.rhythm, description: '编辑后的节奏描述' },
        };
        const fp = await library.updateV2FingerprintFeatures(saved.id, 'global', edited);
        expect(fp).not.toBeNull();
        expect(fp!.features.sentenceRhythm).toBe('编辑后的节奏描述');
        expect(library.getV2Fingerprint(saved.id)!.features.rhythm.description).toBe('编辑后的节奏描述');

        // 磁盘直读：仍是 v2 且带新描述
        const raw = await (vault as any).readByPath(globalFingerprintsFile());
        const entry = JSON.parse(raw).find((fp: { id: string }) => fp.id === saved.id);
        expect(entry.version).toBe('v2');
        expect(entry.features.rhythm.description).toBe('编辑后的节奏描述');

        // 重载不降级
        const library2 = new StyleFingerprintLibrary({ vault } as any);
        library2.setEmbeddingClient(new MockEmbeddingProvider());
        await library2.loadGlobal();
        expect(library2.getV2Fingerprint(saved.id)!.features.rhythm.description).toBe('编辑后的节奏描述');
        expect(library2.getGlobal(saved.id)!.features.sentenceRhythm).toBe('编辑后的节奏描述');
    });

    it('id 不存在或作用域不符时返回 null', async () => {
        await library.loadGlobal();
        const analysis = await makeAnalysis();
        await expect(library.updateV2FingerprintFeatures('fp-nope', 'global', analysis.features)).resolves.toBeNull();
    });
});
