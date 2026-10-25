/**
 * style-v2-rebuild-b5.test.ts — 「重向量化」必须同步重建 V2 12 维向量
 *
 * V2 向量因换模型被隔离（文件删除 + .mismatch.bak）后，只重建 V1 指纹向量不会恢复
 * V2：相关性排序拿不到候选 → 每次都回退全量注入，3 个上限永久失效。
 * B5 修复：重建后 V2 文件必须重新落盘，searchSimilarStylesV2 恢复非空。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import type { StyleFingerprintFeaturesV2, StyleDimensionKeyV2, V2Fingerprint } from '../../../../engine/style/style-dimensions-v2';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintsFile, globalFingerprintVectorsDir } from '../../../../shared/paths';

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
        return { type: 'mock', name: 'mock', model: 'mock-embed', dimensions: 8 };
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

function v2FilePath(fingerprintId: string): string {
    return `${globalFingerprintVectorsDir()}/v2/style-${fingerprintId}.json`;
}

describe('B5 — 重向量化同步重建 V2 指纹向量', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder(globalFingerprintVectorsDir());
        await vault.createFolder(`${globalFingerprintVectorsDir()}/v2`);
        (vault as any)._seedFile(globalFingerprintsFile(), JSON.stringify([
            makeV2Fingerprint('fp-a', '甲'),
            makeV2Fingerprint('fp-b', '乙'),
        ]));
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();
    });

    it('V2 文件缺失时 rebuildAllV2StyleVectors 重新落盘并可检索', async () => {
        // 先构建一次，确认初始状态
        await library.buildV2VectorsForFingerprint('fp-a', 'global');
        expect((vault as any).exists(v2FilePath('fp-a'))).toBe(true);

        // 模拟换模型后的隔离：原文件被删除
        await vault.adapter.remove(v2FilePath('fp-a'));
        expect((vault as any).exists(v2FilePath('fp-a'))).toBe(false);

        const report = await library.rebuildAllV2StyleVectors();

        expect(report.failed).toEqual([]);
        expect(report.rebuilt).toEqual(expect.arrayContaining(['fp-a', 'fp-b']));
        expect((vault as any).exists(v2FilePath('fp-a'))).toBe(true);
        expect((vault as any).exists(v2FilePath('fp-b'))).toBe(true);

        const results = await library.searchSimilarStylesV2('甲-key-示例', { topN: 5 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].fingerprintId).toBe('fp-a');
    });

    it('两个指纹全部缺失时也能完整重建', async () => {
        // 从未构建过 V2：等价于所有文件都被隔离
        expect((vault as any).exists(v2FilePath('fp-a'))).toBe(false);
        expect((vault as any).exists(v2FilePath('fp-b'))).toBe(false);

        const report = await library.rebuildAllV2StyleVectors();

        expect(report.rebuilt.sort()).toEqual(['fp-a', 'fp-b']);
        expect(report.failed).toEqual([]);
        expect((await library.searchSimilarStylesV2('乙-key-示例', { topN: 5 })).length).toBeGreaterThan(0);
    });
});
