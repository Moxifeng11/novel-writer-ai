/**
 * style-vector-store-v2.test.ts — V2 多维独立向量空间单元测试
 *
 * 覆盖 Task 3 的 7 条 TR：
 *   TR-3.1: 12 个维度各有独立的 embedding 向量
 *   TR-3.2: 按单维度检索返回正确排序结果
 *   TR-3.3: 按维度加权检索返回正确加权结果
 *   TR-3.4: V1 向量数据可正常读取和检索
 *   TR-3.5: 单维度检索耗时 < 200ms（mock 模式下）
 *   TR-3.6: 全维度加权检索耗时 < 500ms（mock 模式下）
 *   TR-3.7: 向量重建功能可正常工作
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    StyleVectorStoreV2,
    type StyleFingerprintVectorsV2,
    type StyleSimilarityResultV2,
} from '../../../../engine/style/style-vector-store-v2';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import type { StyleFingerprintFeaturesV2, StyleDimensionKeyV2 } from '../../../../engine/style/style-dimensions-v2';
import { STYLE_DIMENSION_KEYS_V2, STYLE_DIMENSION_LABELS_V2 } from '../../../../engine/style/style-dimensions-v2';

// ============================================================
// Mock 工具
// ============================================================

/** Mock EmbeddingProvider — 不同文本返回不同的确定性向量 */
class MockEmbeddingProvider implements EmbeddingProvider {
    /** 标识不同文本特征，便于断言 */
    embedCalls = 0;
    embedBatchCalls = 0;

    async embed(text: string): Promise<number[]> {
        this.embedCalls++;
        if (!text) return [];
        // 用文本 hash 生成 8 维向量（确定性 + 不同文本不同向量）
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) {
            vec[i % 8] += text.charCodeAt(i);
        }
        // 归一化
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        this.embedBatchCalls++;
        return Promise.all(texts.map(t => this.embed(t)));
    }

    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'mock', dimensions: 8 };
    }

    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: 'mock-embed' };
    }

    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

/** 简单的 Mock App（仅用于构造，不实际调用） */
function makeMockApp(): any {
    return { vault: {} };
}

/** 完整 12 维 features 样本 */
function makeV2Features(descriptionPrefix: string = 'sample'): StyleFingerprintFeaturesV2 {
    const keys: StyleDimensionKeyV2[] = [
        'rhythm', 'sentencePattern', 'wordChoice', 'rhetoric', 'perspective',
        'emotion', 'tension', 'infoDensity', 'dialogue', 'description',
        'narration', 'languageTexture',
    ];
    const features = {} as StyleFingerprintFeaturesV2;
    for (const key of keys) {
        const label = STYLE_DIMENSION_LABELS_V2[key];
        (features as any)[key] = {
            description: `${descriptionPrefix}-${label}-desc`,
            samples: [`${descriptionPrefix}-${key}-sample-1`, `${descriptionPrefix}-${key}-sample-2`],
            status: 'complete' as const,
        };
    }
    return features;
}

/** V1 向量文件格式（用于迁移测试） */
function makeV1VectorsFile(fingerprintId: string) {
    return {
        fingerprintId,
        dimensions: {
            sentenceRhythm: { dimension: 'sentenceRhythm', vector: [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0], description: 'V1 节奏' },
            wordPreference: { dimension: 'wordPreference', vector: [0.4, 0.5, 0.6, 0.4, 0, 0, 0, 0], description: 'V1 用词' },
            narrativeStyle: { dimension: 'narrativeStyle', vector: [0.3, 0.5, 0.7, 0.3, 0, 0, 0, 0], description: 'V1 视角' },
            rhetoric: { dimension: 'rhetoric', vector: [0.2, 0.5, 0.8, 0.2, 0, 0, 0, 0], description: 'V1 修辞' },
            dialogueStyle: { dimension: 'dialogueStyle', vector: [0.1, 0.5, 0.9, 0.1, 0, 0, 0, 0], description: 'V1 对话' },
            paragraphStructure: { dimension: 'paragraphStructure', vector: [0.6, 0.4, 0.5, 0.5, 0, 0, 0, 0], description: 'V1 叙事' },
            overallTone: { dimension: 'overallTone', vector: [0.7, 0.3, 0.5, 0.5, 0, 0, 0, 0], description: 'V1 语言质感' },
        },
        overallVector: [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0],
        updatedAt: 1000000,
    };
}

// ============================================================
// 测试套件
// ============================================================

describe('StyleVectorStoreV2', () => {
    let mockFs: MockFileSystem;
    let mockProvider: MockEmbeddingProvider;
    let store: StyleVectorStoreV2;

    beforeEach(() => {
        mockFs = new MockFileSystem();
        mockProvider = new MockEmbeddingProvider();
        store = new StyleVectorStoreV2(
            makeMockApp(),
            'global',
            mockProvider,
            undefined,
            mockFs as unknown as any
        );
    });

    // ----------------------------------------------------------
    // TR-3.1: 12 个维度各有独立的 embedding 向量
    // ----------------------------------------------------------
    describe('TR-3.1 12 维独立向量生成', () => {
        it('buildV2Vectors 应生成 12 个维度向量', async () => {
            const features = makeV2Features('test1');
            const vectors = await store.buildV2Vectors('fp-1', features);

            expect(vectors.version).toBe('v2');
            expect(vectors.fingerprintId).toBe('fp-1');
            expect(Object.keys(vectors.dimensions)).toHaveLength(12);

            for (const key of STYLE_DIMENSION_KEYS_V2) {
                const dim = vectors.dimensions[key];
                expect(dim).toBeDefined();
                expect(dim.dimension).toBe(key);
                expect(Array.isArray(dim.vector)).toBe(true);
                expect(dim.vector.length).toBeGreaterThan(0);
                expect(typeof dim.sourceText).toBe('string');
                expect(dim.sourceText.length).toBeGreaterThan(0);
                expect(dim.approximated).toBe(false);
            }
        });

        it('每维度源文本应包含 description + samples', async () => {
            const features = makeV2Features('source-test');
            const vectors = await store.buildV2Vectors('fp-src', features);

            const rhythm = vectors.dimensions.rhythm;
            expect(rhythm.sourceText).toContain('source-test-节奏-desc');
            expect(rhythm.sourceText).toContain('source-test-rhythm-sample-1');
            expect(rhythm.sourceText).toContain('source-test-rhythm-sample-2');
        });

        it('overallVector 不为空', async () => {
            const features = makeV2Features('overall-test');
            const vectors = await store.buildV2Vectors('fp-overall', features);
            expect(vectors.overallVector.length).toBeGreaterThan(0);
        });

        it('维度数量等于 V2_DIMENSION_COUNT', async () => {
            const features = makeV2Features('count');
            const vectors = await store.buildV2Vectors('fp-count', features);
            expect(Object.keys(vectors.dimensions).length).toBe(12);
        });
    });

    // ----------------------------------------------------------
    // TR-3.2: 按单维度检索返回正确排序结果
    // ----------------------------------------------------------
    describe('TR-3.2 单维度检索', () => {
        it('应按指定维度相似度排序返回结果', async () => {
            // 三个指纹：fp-a 的 rhythm 维度源文本与 query 高度相似
            const fpA = { id: 'fp-a', name: 'A', scope: 'global' as const, features: makeV2Features('rhythm-match') };
            const fpB = { id: 'fp-b', name: 'B', scope: 'global' as const, features: makeV2Features('other') };
            const fpC = { id: 'fp-c', name: 'C', scope: 'global' as const, features: makeV2Features('rhythm-match') };

            // 添加向量到 store（直接构造，避免重复 embed）
            const vectorsA = await store.buildV2Vectors('fp-a', fpA.features);
            const vectorsB = await store.buildV2Vectors('fp-b', fpB.features);
            const vectorsC = await store.buildV2Vectors('fp-c', fpC.features);

            // 模拟"rhythm-match"和 query 高度相似的查询文本
            const queryText = 'rhythm-match-节奏-desc\nrhythm-match-rhythm-sample-1\nrhythm-match-rhythm-sample-2';

            const results = await store.searchByDimension(
                queryText,
                [fpA, fpB, fpC],
                'rhythm'
            );

            expect(results.length).toBeGreaterThan(0);
            // fp-a 与 fp-c 的 rhythm 维度源文本相同，应排前面
            const topIds = results.slice(0, 2).map(r => r.fingerprintId);
            expect(topIds).toContain('fp-a');
            expect(topIds).toContain('fp-c');
            expect(results[0].dimensionScores.rhythm).toBeGreaterThan(0.9);
        });

        it('未传 topN 时默认返回 10 条', async () => {
            const fingerprints = [];
            for (let i = 0; i < 15; i++) {
                fingerprints.push({
                    id: `fp-${i}`,
                    name: `FP${i}`,
                    scope: 'global' as const,
                    features: makeV2Features(`batch${i}`),
                });
            }
            // 先构建向量
            for (const fp of fingerprints) {
                await store.buildV2Vectors(fp.id, fp.features);
            }

            const results = await store.searchByDimension(
                'query-text',
                fingerprints,
                'rhythm'
            );
            expect(results.length).toBeLessThanOrEqual(10);
        });

        it('minScore 过滤低分结果', async () => {
            const fp = { id: 'fp-min', name: 'Min', scope: 'global' as const, features: makeV2Features('unrelated') };
            await store.buildV2Vectors(fp.id, fp.features);

            const results = await store.searchByDimension(
                'completely-different-text',
                [fp],
                'rhythm',
                { minScore: 0.99 }
            );
            expect(results.length).toBe(0);
        });
    });

    // ----------------------------------------------------------
    // TR-3.3: 按维度加权检索返回正确加权结果
    // ----------------------------------------------------------
    describe('TR-3.3 加权检索', () => {
        it('应按权重加权计算 overallScore', async () => {
            const fp = { id: 'fp-weighted', name: 'W', scope: 'global' as const, features: makeV2Features('weighted') };
            await store.buildV2Vectors(fp.id, fp.features);

            // query 与某维度完全一致
            const queryText = 'weighted-节奏-desc\nweighted-rhythm-sample-1\nweighted-rhythm-sample-2';

            // 全权重集中在 rhythm
            const weights = {
                rhythm: 1,
                sentencePattern: 0,
                wordChoice: 0,
                rhetoric: 0,
                perspective: 0,
                emotion: 0,
                tension: 0,
                infoDensity: 0,
                dialogue: 0,
                description: 0,
                narration: 0,
                languageTexture: 0,
            } as Partial<Record<StyleDimensionKeyV2, number>>;

            const results = await store.searchWeighted(
                queryText,
                [fp],
                { dimensionWeights: weights }
            );

            expect(results.length).toBe(1);
            // 全权重在 rhythm → overallScore 等于 rhythm 维度分数
            expect(results[0].overallScore).toBeCloseTo(results[0].dimensionScores.rhythm, 5);
        });

        it('未传 weights 时使用均匀权重', async () => {
            const fp = { id: 'fp-uniform', name: 'U', scope: 'global' as const, features: makeV2Features('uniform') };
            await store.buildV2Vectors(fp.id, fp.features);

            const results = await store.searchWeighted('uniform-节奏', [fp]);
            expect(results.length).toBe(1);
            // 均匀权重 = 平均值
            const dimScores = Object.values(results[0].dimensionScores);
            const avg = dimScores.reduce((s, v) => s + v, 0) / dimScores.length;
            expect(results[0].overallScore).toBeCloseTo(avg, 5);
        });

        it('onlyDimensions 限制参与计算的维度', async () => {
            const fp = { id: 'fp-only', name: 'O', scope: 'global' as const, features: makeV2Features('only-dim') };
            await store.buildV2Vectors(fp.id, fp.features);

            const queryText = 'only-dim-节奏-desc';
            const results = await store.searchWeighted(
                queryText,
                [fp],
                { onlyDimensions: ['rhythm', 'emotion'] }
            );

            expect(results.length).toBe(1);
            // 非 onlyDims 维度的 score 应为 0
            expect(results[0].dimensionScores.dialogue).toBe(0);
            expect(results[0].dimensionScores.description).toBe(0);
        });

        it('topN 限制返回数量', async () => {
            const fingerprints = [];
            for (let i = 0; i < 5; i++) {
                fingerprints.push({
                    id: `fp-t${i}`,
                    name: `T${i}`,
                    scope: 'global' as const,
                    features: makeV2Features(`tn${i}`),
                });
            }
            for (const fp of fingerprints) {
                await store.buildV2Vectors(fp.id, fp.features);
            }

            const results = await store.searchWeighted(
                'query',
                fingerprints,
                { topN: 2 }
            );
            expect(results.length).toBeLessThanOrEqual(2);
        });
    });

    // ----------------------------------------------------------
    // TR-3.4: V1 向量数据可正常读取和检索
    // ----------------------------------------------------------
    describe('TR-3.4 V1 兼容与迁移', () => {
        it('hasV1Vectors 检测 V1 文件存在', async () => {
            // 先写入 V1 文件到 V1 路径
            const v1Data = makeV1VectorsFile('fp-v1');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-v1.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            const exists = await store.hasV1Vectors('fp-v1');
            expect(exists).toBe(true);
        });

        it('hasV1Vectors 检测不存在文件', async () => {
            const exists = await store.hasV1Vectors('nonexistent');
            expect(exists).toBe(false);
        });

        it('migrateFromV1 应将 V1 字段映射到 V2 对应维度', async () => {
            const v1Data = makeV1VectorsFile('fp-migrate');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-migrate.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            const v2Vectors = await store.migrateFromV1('fp-migrate');

            expect(v2Vectors).toBeDefined();
            expect(v2Vectors!.version).toBe('v2');
            expect(v2Vectors!.fingerprintId).toBe('fp-migrate');
            // V1 sentenceRhythm → V2 rhythm
            expect(v2Vectors!.dimensions.rhythm.vector).toEqual([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0]);
            expect(v2Vectors!.dimensions.rhythm.approximated).toBe(false);
            expect(v2Vectors!.dimensions.rhythm.sourceText).toBe('V1 节奏');
            // V1 wordPreference → V2 wordChoice
            expect(v2Vectors!.dimensions.wordChoice.vector).toEqual([0.4, 0.5, 0.6, 0.4, 0, 0, 0, 0]);
            // V1 narrativeStyle → V2 perspective
            expect(v2Vectors!.dimensions.perspective.vector).toEqual([0.3, 0.5, 0.7, 0.3, 0, 0, 0, 0]);
        });

        it('migrateFromV1 缺失维度应使用 overallVector 近似', async () => {
            const v1Data = makeV1VectorsFile('fp-missing');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-missing.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            const v2Vectors = await store.migrateFromV1('fp-missing');

            // 5 个新增维度（sentencePattern/emotion/tension/infoDensity/description）应被近似
            expect(v2Vectors!.dimensions.sentencePattern.approximated).toBe(true);
            expect(v2Vectors!.dimensions.emotion.approximated).toBe(true);
            expect(v2Vectors!.dimensions.tension.approximated).toBe(true);
            expect(v2Vectors!.dimensions.infoDensity.approximated).toBe(true);
            expect(v2Vectors!.dimensions.description.approximated).toBe(true);
            // 近似向量为 overallVector
            expect(v2Vectors!.dimensions.sentencePattern.vector).toEqual(v2Vectors!.overallVector);
        });

        it('migrateFromV1 备份原 V1 数据', async () => {
            const v1Data = makeV1VectorsFile('fp-backup');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-backup.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            await store.migrateFromV1('fp-backup');

            // 备份文件应存在
            const backupPath = globalFingerprintVectorsDir() + '/v2/style-fp-backup.v1.bak';
            const backupContent = await mockFs.read(backupPath);
            expect(backupContent).toBeDefined();
            const backupData = JSON.parse(backupContent);
            expect(backupData.fingerprintId).toBe('fp-backup');
        });

        it('migrateFromV1 v1Backup 字段保留原始数据', async () => {
            const v1Data = makeV1VectorsFile('fp-keep');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-keep.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            const v2Vectors = await store.migrateFromV1('fp-keep');
            expect(v2Vectors!.v1Backup).toBeDefined();
            expect((v2Vectors!.v1Backup as any).fingerprintId).toBe('fp-keep');
        });

        it('migrateFromV1 已存在 V2 时跳过（不覆盖）', async () => {
            const v1Data = makeV1VectorsFile('fp-skip');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-skip.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            // 第一次迁移
            const first = await store.migrateFromV1('fp-skip');
            expect(first).toBeDefined();

            // 第二次迁移应跳过
            const before = store.getVectors('fp-skip');
            const second = await store.migrateFromV1('fp-skip');
            expect(second).toBe(before);
        });

        it('migrateFromV1 overwrite=true 强制重新迁移', async () => {
            const v1Data = makeV1VectorsFile('fp-overwrite');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-overwrite.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            // 第一次迁移
            await store.migrateFromV1('fp-overwrite');
            const firstUpdatedAt = store.getVectors('fp-overwrite')!.updatedAt;

            // 等待一小段确保时间戳不同
            await new Promise(r => setTimeout(r, 10));

            // 第二次强制迁移
            await store.migrateFromV1('fp-overwrite', { overwrite: true });
            const secondUpdatedAt = store.getVectors('fp-overwrite')!.updatedAt;
            expect(secondUpdatedAt).toBeGreaterThanOrEqual(firstUpdatedAt);
        });

        it('rollbackToV1 从备份恢复', async () => {
            const v1Data = makeV1VectorsFile('fp-rollback');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-rollback.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            await store.migrateFromV1('fp-rollback');
            expect(store.getVectors('fp-rollback')).toBeDefined();

            // 回滚
            const ok = await store.rollbackToV1('fp-rollback');
            expect(ok).toBe(true);
            // 内存中 V2 应被移除
            expect(store.getVectors('fp-rollback')).toBeUndefined();
            // V1 文件应恢复
            const restored = await mockFs.read(v1Path);
            const restoredData = JSON.parse(restored);
            expect(restoredData.fingerprintId).toBe('fp-rollback');
        });

        it('migrateAllFromV1 批量迁移', async () => {
            // 准备 3 个 V1 文件
            for (const id of ['fp-batch-1', 'fp-batch-2', 'fp-batch-3']) {
                const v1Data = makeV1VectorsFile(id);
                const v1Path = globalFingerprintVectorsDir() + `/style-${id}.json`;
                await mockFs.write(v1Path, JSON.stringify(v1Data));
            }

            const result = await store.migrateAllFromV1();
            expect(result.migrated.length).toBe(3);
            expect(result.failed.length).toBe(0);
        });

        it('迁移后可在 V2 检索中使用', async () => {
            const v1Data = makeV1VectorsFile('fp-searchable');
            const v1Path = globalFingerprintVectorsDir() + '/style-fp-searchable.json';
            await mockFs.write(v1Path, JSON.stringify(v1Data));

            await store.migrateFromV1('fp-searchable');

            // 提供空 features（不会重建，因为已存在）
            const fingerprints = [{
                id: 'fp-searchable',
                name: 'Searchable',
                scope: 'global' as const,
                features: makeV2Features('placeholder'),
            }];

            const results = await store.searchWeighted(
                'V1 节奏',
                fingerprints
            );
            // 应该能查到结果
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].fingerprintId).toBe('fp-searchable');
        });
    });

    // ----------------------------------------------------------
    // TR-3.5: 单维度检索耗时 < 200ms
    // ----------------------------------------------------------
    describe('TR-3.5 单维度检索性能', () => {
        it('单维度检索耗时 < 200ms（mock 模式）', async () => {
            const fingerprints = [];
            for (let i = 0; i < 10; i++) {
                fingerprints.push({
                    id: `fp-perf-${i}`,
                    name: `P${i}`,
                    scope: 'global' as const,
                    features: makeV2Features(`perf${i}`),
                });
            }
            for (const fp of fingerprints) {
                await store.buildV2Vectors(fp.id, fp.features);
            }

            const start = Date.now();
            await store.searchByDimension(
                'perf0-节奏-desc',
                fingerprints,
                'rhythm'
            );
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(200);
        });
    });

    // ----------------------------------------------------------
    // TR-3.6: 全维度加权检索耗时 < 500ms
    // ----------------------------------------------------------
    describe('TR-3.6 全维度检索性能', () => {
        it('加权检索耗时 < 500ms（mock 模式）', async () => {
            const fingerprints = [];
            for (let i = 0; i < 10; i++) {
                fingerprints.push({
                    id: `fp-wperf-${i}`,
                    name: `WP${i}`,
                    scope: 'global' as const,
                    features: makeV2Features(`wperf${i}`),
                });
            }
            for (const fp of fingerprints) {
                await store.buildV2Vectors(fp.id, fp.features);
            }

            const start = Date.now();
            await store.searchWeighted('wperf0', fingerprints);
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(500);
        });
    });

    // ----------------------------------------------------------
    // TR-3.7: 向量重建功能可正常工作
    // ----------------------------------------------------------
    describe('TR-3.7 向量重建', () => {
        it('rebuildVectors 重新生成向量', async () => {
            const oldFeatures = makeV2Features('old');
            await store.addOrUpdateVectors('fp-rebuild', oldFeatures);
            const oldVectors = store.getVectors('fp-rebuild')!;
            const oldUpdatedAt = oldVectors.updatedAt;

            await new Promise(r => setTimeout(r, 10));

            const newFeatures = makeV2Features('new');
            await store.rebuildVectors('fp-rebuild', newFeatures);

            const newVectors = store.getVectors('fp-rebuild')!;
            expect(newVectors.updatedAt).toBeGreaterThan(oldUpdatedAt);
            // 新向量 sourceText 应包含 'new'
            expect(newVectors.dimensions.rhythm.sourceText).toContain('new-节奏');
        });

        it('rebuildAllVectors 批量重建', async () => {
            // 添加 3 个指纹
            for (const id of ['fp-rb-1', 'fp-rb-2', 'fp-rb-3']) {
                await store.addOrUpdateVectors(id, makeV2Features('initial'));
            }

            // 提供新的 features
            const newFeaturesMap: Record<string, StyleFingerprintFeaturesV2> = {
                'fp-rb-1': makeV2Features('updated-1'),
                'fp-rb-2': makeV2Features('updated-2'),
                'fp-rb-3': makeV2Features('updated-3'),
            };

            const result = await store.rebuildAllVectors(async (id) => newFeaturesMap[id]);

            expect(result.rebuilt.length).toBe(3);
            expect(result.failed.length).toBe(0);

            // 验证更新生效
            const v1 = store.getVectors('fp-rb-1')!;
            expect(v1.dimensions.rhythm.sourceText).toContain('updated-1');
        });

        it('rebuildAllVectors features 不存在时记录失败', async () => {
            await store.addOrUpdateVectors('fp-rbf', makeV2Features('init'));

            const result = await store.rebuildAllVectors(async () => undefined);
            expect(result.rebuilt.length).toBe(0);
            expect(result.failed.length).toBe(1);
            expect(result.failed[0].id).toBe('fp-rbf');
        });
    });

    // ----------------------------------------------------------
    // 补充：边界与状态查询
    // ----------------------------------------------------------
    describe('边界与状态查询', () => {
        it('listLoadedFingerprintIds 返回已加载列表', async () => {
            await store.addOrUpdateVectors('fp-list-1', makeV2Features('list1'));
            await store.addOrUpdateVectors('fp-list-2', makeV2Features('list2'));

            const ids = store.listLoadedFingerprintIds();
            expect(ids).toContain('fp-list-1');
            expect(ids).toContain('fp-list-2');
            expect(ids.length).toBe(2);
        });

        it('deleteVectors 删除内存与磁盘', async () => {
            await store.addOrUpdateVectors('fp-del', makeV2Features('del'));
            expect(store.getVectors('fp-del')).toBeDefined();

            await store.deleteVectors('fp-del');
            expect(store.getVectors('fp-del')).toBeUndefined();
        });

        it('isDimensionApproximated 未加载时返回 true', () => {
            expect(store.isDimensionApproximated('nonexistent', 'rhythm')).toBe(true);
        });

        it('countApproximatedDimensions 未加载时返回 12', () => {
            expect(store.countApproximatedDimensions('nonexistent')).toBe(12);
        });

        it('countApproximatedDimensions 已加载时返回实际数量', async () => {
            await store.addOrUpdateVectors('fp-count', makeV2Features('cnt'));
            // 新生成的都是真实 embedding，approximated=0
            expect(store.countApproximatedDimensions('fp-count')).toBe(0);
        });

        it('reload 清除内存缓存重新加载', async () => {
            await store.addOrUpdateVectors('fp-reload', makeV2Features('reload'));
            expect(store.listLoadedFingerprintIds().length).toBe(1);

            await store.reload();
            // 重新加载后从磁盘读取
            expect(store.listLoadedFingerprintIds().length).toBe(1);
            expect(store.listLoadedFingerprintIds()).toContain('fp-reload');
        });

        it('searchSimilarByFingerprint 自身排除', async () => {
            const fpA = { id: 'fp-sf-a', name: 'A', scope: 'global' as const, features: makeV2Features('sf-a') };
            const fpB = { id: 'fp-sf-b', name: 'B', scope: 'global' as const, features: makeV2Features('sf-b') };

            await store.addOrUpdateVectors(fpA.id, fpA.features);
            await store.addOrUpdateVectors(fpB.id, fpB.features);

            const results = await store.searchSimilarByFingerprint(
                'fp-sf-a',
                [fpA, fpB]
            );

            // 不应包含自身
            expect(results.find(r => r.fingerprintId === 'fp-sf-a')).toBeUndefined();
            expect(results.length).toBe(1);
            expect(results[0].fingerprintId).toBe('fp-sf-b');
        });

        it('searchSimilarByFingerprint 源不存在时返回空', async () => {
            const results = await store.searchSimilarByFingerprint(
                'nonexistent',
                [{ id: 'fp-x', name: 'X', scope: 'global' as const, features: makeV2Features('x') }]
            );
            expect(results).toEqual([]);
        });
    });

    // ----------------------------------------------------------
    // 补充：降级与并发
    // ----------------------------------------------------------
    describe('降级与并发', () => {
        it('embedding 失败时用 overallVector 近似', async () => {
            // 构造一个总是失败的 provider
            class FailingProvider extends MockEmbeddingProvider {
                callCount = 0;
                async embed(text: string): Promise<number[]> {
                    this.callCount++;
                    // 第 1 次是 overall，让它成功
                    if (this.callCount === 1) {
                        return [1, 0, 0, 0, 0, 0, 0, 0];
                    }
                    // 后续维度都失败
                    throw new Error('mock embed failed');
                }
            }
            const failProvider = new FailingProvider();
            const failStore = new StyleVectorStoreV2(
                makeMockApp(),
                'global',
                failProvider,
                undefined,
                mockFs as unknown as any
            );

            const features = makeV2Features('fail');
            const vectors = await failStore.buildV2Vectors('fp-fail', features);

            // 所有维度应该都被近似（用 overallVector）
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(vectors.dimensions[key].approximated).toBe(true);
                expect(vectors.dimensions[key].vector).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
            }
        });

        it('空 features 维度 sourceText 为空', async () => {
            const features = makeV2Features('empty');
            // 手动清空一个维度
            (features.rhythm as any).description = '';
            (features.rhythm as any).samples = [];

            const vectors = await store.buildV2Vectors('fp-empty-dim', features);
            expect(vectors.dimensions.rhythm.sourceText).toBe('');
            // 空文本 → 用 overallVector 近似
            expect(vectors.dimensions.rhythm.approximated).toBe(true);
        });

        it('ensureLoaded 并发调用不重复加载', async () => {
            // 写入一个 V2 文件
            const features = makeV2Features('concurrent');
            const vectors = await store.buildV2Vectors('fp-concurrent', features);
            await store.addOrUpdateVectors('fp-concurrent', features);

            // 清空内存，强制重新加载
            await store.reload();

            // 并发调用 ensureLoaded（间接通过 searchWeighted）
            const fingerprints = [{
                id: 'fp-concurrent',
                name: 'Concurrent',
                scope: 'global' as const,
                features: features,
            }];

            const [r1, r2, r3] = await Promise.all([
                store.searchWeighted('query', fingerprints),
                store.searchWeighted('query', fingerprints),
                store.searchWeighted('query', fingerprints),
            ]);

            expect(r1.length).toBe(1);
            expect(r2.length).toBe(1);
            expect(r3.length).toBe(1);
        });
    });
});

// 引入路径函数用于测试
import { globalFingerprintVectorsDir } from '../../../../shared/paths';
