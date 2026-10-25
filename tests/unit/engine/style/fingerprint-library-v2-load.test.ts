import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import type { StyleFingerprintFeaturesV2, StyleDimensionKeyV2, V2Fingerprint } from '../../../../engine/style/style-dimensions-v2';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintsFile } from '../../../../shared/paths';

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

function makeFeatures(seed: string): StyleFingerprintFeaturesV2 {
    const features = {} as StyleFingerprintFeaturesV2;
    for (const key of STYLE_DIMENSION_KEYS_V2 as readonly StyleDimensionKeyV2[]) {
        (features as any)[key] = {
            description: `${seed}-${key} 的描述，用于生成独立向量。`,
            samples: [`${seed}-${key}-示例`],
            status: 'complete' as const,
        };
    }
    return features;
}

function makeV2Fingerprint(id: string, seed: string): V2Fingerprint {
    return {
        id,
        name: `${seed} 风格`,
        source: 'test',
        scope: 'global',
        enabled: true,
        tags: [],
        version: 'v2',
        stats: {
            avgSentenceLength: 12,
            avgParagraphLength: 40,
            dialogueRatio: 0.3,
            descriptionRatio: 0.2,
            wordCount: 10000,
        },
        features: makeFeatures(seed),
        samples: [`${seed} 示例文本`],
        extractedAt: Date.now(),
        // 真实迁移文件都会带 v1Backup；V1 消费方从备份里取 7 维字符串
        v1Backup: {
            features: {
                sentenceRhythm: '节奏描述',
                wordPreference: '用词描述',
                narrativeStyle: '叙事描述',
                rhetoric: '修辞描述',
                dialogueStyle: '对话描述',
                paragraphStructure: '段落描述',
                overallTone: '基调描述',
            },
            extractedAt: Date.now(),
            migratedAt: Date.now(),
        },
    };
}

describe('StyleFingerprintLibrary — V2 加载不再降级（Phase 4.1）', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        (vault as any)._seedFile(globalFingerprintsFile(), JSON.stringify([
            makeV2Fingerprint('fp-a', '甲'),
            makeV2Fingerprint('fp-b', '乙'),
        ]));
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
    });

    it('加载后保留 12 维特征，而不是只留 V1 7 维', async () => {
        await library.loadGlobal();

        const v2 = library.getV2Fingerprint('fp-a');
        expect(v2).toBeDefined();
        expect(Object.keys(v2!.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        expect(library.listV2Fingerprints('global').map(fp => fp.id).sort()).toEqual(['fp-a', 'fp-b']);

        // V1 消费方仍拿到 7 维字符串指纹
        const v1 = library.getGlobal('fp-a');
        expect(v1).toBeDefined();
        expect(v1!.features.sentenceRhythm).toBeTruthy();
    });

    it('12 维可检索：searchSimilarStylesV2 返回候选', async () => {
        await library.loadGlobal();

        const results = await library.searchSimilarStylesV2('甲-key-示例', { topN: 5 });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].fingerprintId).toBe('fp-a');
        expect(Object.keys(results[0].dimensionScores)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
    });

    it('12 维单维度可检索：searchByDimensionV2 只返回该维度分数', async () => {
        await library.loadGlobal();

        const results = await library.searchByDimensionV2('甲-rhythm-示例', 'rhythm', { topN: 5 });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].dimensionScores.rhythm).toBeGreaterThan(0);
        expect(results[0].dimensionScores.dialogue).toBe(0);
    });

    it('可限制在指定指纹集合内排名（禁用/模板指纹不得挤占启用指纹的 topN）', async () => {
        await library.loadGlobal();

        const results = await library.searchSimilarStylesV2('甲-key-示例', {
            topN: 5,
            fingerprintIds: ['fp-b'],
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.every(r => r.fingerprintId === 'fp-b')).toBe(true);
    });
});
