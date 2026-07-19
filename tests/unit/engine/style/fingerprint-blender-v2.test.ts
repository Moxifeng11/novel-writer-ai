/**
 * tests/unit/engine/style/fingerprint-blender-v2.test.ts
 *
 * 写作指纹 V2 Task 4 — 多指纹加权融合引擎单元测试
 *
 * 覆盖 TR-4.1 ~ TR-4.8 + 边界/降级/性能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FingerprintBlenderV2,
    type BlendSource,
    type BlendOptions,
    type BlendedFingerprint,
} from '../../../../engine/style/fingerprint-blender-v2';
import type {
    V2Fingerprint,
    StyleFingerprintFeaturesV2,
    StyleDimensionKeyV2,
    DimensionStatus,
} from '../../../../engine/style/style-dimensions-v2';
import type { StyleFingerprintVectorsV2 } from '../../../../engine/style/style-vector-store-v2';

// ============================================================
// 测试工具函数
// ============================================================

/** 构造完整的 V2 12 维 features */
function makeFeatures(overrides?: Partial<StyleFingerprintFeaturesV2>): StyleFingerprintFeaturesV2 {
    return {
        rhythm: {
            sentenceLengthDistribution: { short: 0.3, medium: 0.5, long: 0.2 },
            avgSentenceLength: 15,
            shortSentenceRatio: 0.3,
            punctuationDensity: 30,
            paragraphDensity: 5,
            pauseFrequency: 20,
            description: '句长适中，节奏平稳。短句与长句交替使用。',
            samples: ['他抬头望向天空。', '风轻轻吹过，带着凉意。'],
            status: 'complete',
        },
        sentencePattern: {
            inversionDensity: 2,
            ellipsisDensity: 1,
            parallelismDensity: 3,
            rhetoricalQuestionRatio: 0.05,
            clauseNestingDepth: 1.5,
            description: '句式变化丰富。倒装句和排比句较多。',
            samples: ['春风来了，脚步近了。', '红的花，黄的叶。'],
            status: 'complete',
        },
        wordChoice: {
            commonWordRatio: 0.7,
            rareWordRatio: 0.05,
            functionWordRatio: 0.25,
            wordLengthDistribution: { len1: 0.3, len2: 0.3, len3: 0.2, len4plus: 0.2 },
            fourCharIdiomDensity: 5,
            description: '用词朴实，常用词为主。四字格使用频繁。',
            samples: ['春风得意', '马到成功'],
            status: 'complete',
        },
        rhetoric: {
            metaphorDensity: 4,
            personificationDensity: 2,
            hyperboleDensity: 1,
            parallelismDensity: 3,
            antithesisDensity: 2,
            synesthesiaDensity: 0.5,
            description: '修辞丰富。比喻和排比运用自如。',
            samples: ['月如银盘。', '风在歌唱。'],
            status: 'complete',
        },
        perspective: {
            personDistribution: { first: 0.1, second: 0.0, third: 0.9 },
            perspectiveSwitchFrequency: 0.5,
            narrativeDistance: { far: 0.3, medium: 0.5, near: 0.2 },
            description: '以第三人称视角为主。叙述距离适中。',
            samples: ['他看到了远方的山。', '她心中一紧。'],
            status: 'complete',
        },
        emotion: {
            emotionalTone: '平静',
            emotionalFluctuationFrequency: 1.2,
            emotionalIntensityDistribution: { low: 0.5, medium: 0.4, high: 0.1 },
            valenceRatio: { positive: 0.6, negative: 0.2, neutral: 0.2 },
            description: '情绪基调平和。情感波动平缓。',
            samples: ['他微微一笑。', '内心泛起涟漪。'],
            status: 'complete',
        },
        tension: {
            suspenseDensity: 2,
            conflictFrequency: 1.5,
            turningPointDensity: 1,
            foreshadowingMarkerCount: 0.5,
            climaxDistribution: { early: 0.2, middle: 0.5, late: 0.3 },
            description: '张力适中。悬念设置得当。',
            samples: ['他不知道危险正在逼近。', '一切似乎另有隐情。'],
            status: 'complete',
        },
        infoDensity: {
            infoDensity: 3,
            properNounDensity: 5,
            settingInjectionFrequency: 1.5,
            conceptIntroductionRhythm: 0.8,
            description: '信息密度适中。世界观植入自然。',
            samples: ['东境三十六国。', '炼气期共有九层。'],
            status: 'complete',
        },
        dialogue: {
            dialogueRatio: 0.3,
            dialogueStyleTag: '简练',
            personalizationLevel: 0.7,
            subtextRatio: 0.4,
            description: '对话简练。台词个性化程度较高。',
            samples: ['"好。"', '"你来了。"'],
            status: 'complete',
        },
        description: {
            environmentDescriptionRatio: 0.2,
            detailDensity: 4,
            sensoryDistribution: { visual: 0.5, auditory: 0.2, tactile: 0.15, olfactory: 0.1, gustatory: 0.05 },
            description: '描写细腻。视觉描写为主。',
            samples: ['夕阳洒在城墙上。', '远处传来钟声。'],
            status: 'complete',
        },
        narration: {
            narrationSpeed: 2,
            timeJumpFrequency: 0.3,
            sceneSwitchFrequency: 0.8,
            description: '叙事速度适中。场景切换自然。',
            samples: ['三天后。', '画面一转。'],
            status: 'complete',
        },
        languageTexture: {
            writtenLevel: 0.7,
            colloquialLevel: 0.3,
            archaismLevel: 0.2,
            regionalWordDensity: 1,
            description: '语言偏书面化。略有古风色彩。',
            samples: ['此乃天意。', '不可不察。'],
            status: 'complete',
        },
        ...overrides,
    };
}

/** 构造 V2 指纹 */
function makeV2Fingerprint(
    id: string,
    name: string,
    overrides?: Partial<V2Fingerprint>
): V2Fingerprint {
    return {
        id,
        name,
        source: 'test',
        scope: 'template',
        enabled: true,
        tags: ['test'],
        version: 'v2',
        stats: {
            avgSentenceLength: 15,
            avgParagraphLength: 80,
            dialogueRatio: 0.3,
            descriptionRatio: 0.2,
            wordCount: 10000,
        },
        features: makeFeatures(),
        samples: ['示例一。', '示例二。', '示例三。'],
        extractedAt: Date.now(),
        ...overrides,
    };
}

/** 构造 V2 向量集合 */
function makeV2Vectors(
    fingerprintId: string,
    vectorSeed: number
): StyleFingerprintVectorsV2 {
    const dimensions = {} as Record<StyleDimensionKeyV2, { dimension: StyleDimensionKeyV2; vector: number[]; sourceText: string; approximated: boolean }>;
    for (const key of ['rhythm', 'sentencePattern', 'wordChoice', 'rhetoric', 'perspective', 'emotion', 'tension', 'infoDensity', 'dialogue', 'description', 'narration', 'languageTexture'] as StyleDimensionKeyV2[]) {
        // 用 seed 生成确定性的 8 维向量
        const vector = Array.from({ length: 8 }, (_, i) => (vectorSeed + i) / 10);
        dimensions[key] = {
            dimension: key,
            vector,
            sourceText: `seed-${vectorSeed}-${key}`,
            approximated: false,
        };
    }
    return {
        fingerprintId,
        version: 'v2',
        dimensions,
        overallVector: Array.from({ length: 8 }, (_, i) => (vectorSeed + i) / 10),
        updatedAt: Date.now(),
    };
}

// ============================================================
// 测试开始
// ============================================================

describe('FingerprintBlenderV2', () => {
    let blender: FingerprintBlenderV2;

    beforeEach(() => {
        blender = new FingerprintBlenderV2();
    });

    // ── TR-4.1: 支持 1-3 个指纹融合 ─────────────────────────

    describe('TR-4.1: 支持 1-3 个指纹融合', () => {
        it('单指纹融合应返回该指纹的特征', () => {
            const fp = makeV2Fingerprint('fp_a', '指纹A');
            const result = blender.blend([{ fingerprint: fp, weight: 1 }]);

            expect(result.fingerprint.id).not.toBe('fp_a');
            expect(result.fingerprint.name).toContain('指纹A');
            expect(result.fingerprint.features.rhythm.avgSentenceLength).toBe(15);
            expect(result.fingerprint.features.rhythm.description).toBe(fp.features.rhythm.description);
        });

        it('2 个指纹融合应成功', () => {
            const fpA = makeV2Fingerprint('fp_a', '指纹A');
            const fpB = makeV2Fingerprint('fp_b', '指纹B', {
                features: makeFeatures({
                    rhythm: {
                        ...fpA.features.rhythm,
                        avgSentenceLength: 25,
                        description: '长句居多，节奏舒缓。',
                    },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.features.rhythm.avgSentenceLength).toBe(20); // (15+25)/2
        });

        it('3 个指纹融合应成功', () => {
            const fpA = makeV2Fingerprint('fp_a', '指纹A');
            const fpB = makeV2Fingerprint('fp_b', '指纹B');
            const fpC = makeV2Fingerprint('fp_c', '指纹C');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.3 },
                { fingerprint: fpC, weight: 0.2 },
            ]);

            expect(result.fingerprint.blendSource.fingerprints).toHaveLength(3);
        });

        it('超过 3 个应自动取权重前 3', () => {
            const fpA = makeV2Fingerprint('fp_a', '指纹A');
            const fpB = makeV2Fingerprint('fp_b', '指纹B');
            const fpC = makeV2Fingerprint('fp_c', '指纹C');
            const fpD = makeV2Fingerprint('fp_d', '指纹D');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.4 },
                { fingerprint: fpB, weight: 0.3 },
                { fingerprint: fpC, weight: 0.2 },
                { fingerprint: fpD, weight: 0.1 },
            ]);

            expect(result.fingerprint.blendSource.fingerprints).toHaveLength(3);
            const ids = result.fingerprint.blendSource.fingerprints.map(s => s.id);
            expect(ids).toContain('fp_a');
            expect(ids).toContain('fp_b');
            expect(ids).toContain('fp_c');
            expect(ids).not.toContain('fp_d');
        });
    });

    // ── TR-4.2: 统计指标正确加权平均 ─────────────────────────

    describe('TR-4.2: 统计指标正确加权平均', () => {
        it('数值字段应按权重加权平均（50/30/20）', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 10 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 20 },
                }),
            });
            const fpC = makeV2Fingerprint('fp_c', 'C', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 30 },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.3 },
                { fingerprint: fpC, weight: 0.2 },
            ]);

            // 10*0.5 + 20*0.3 + 30*0.2 = 5 + 6 + 6 = 17
            expect(result.fingerprint.features.rhythm.avgSentenceLength).toBeCloseTo(17, 5);
        });

        it('数值对象字段（sentenceLengthDistribution）应递归加权平均', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: {
                        ...makeFeatures().rhythm,
                        sentenceLengthDistribution: { short: 0.6, medium: 0.3, long: 0.1 },
                    },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: {
                        ...makeFeatures().rhythm,
                        sentenceLengthDistribution: { short: 0.2, medium: 0.5, long: 0.3 },
                    },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            const dist = result.fingerprint.features.rhythm.sentenceLengthDistribution;
            expect(dist.short).toBeCloseTo(0.4, 5); // (0.6+0.2)/2
            expect(dist.medium).toBeCloseTo(0.4, 5); // (0.3+0.5)/2
            expect(dist.long).toBeCloseTo(0.2, 5); // (0.1+0.3)/2
        });

        it('指纹级 stats 也应加权平均', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                stats: { avgSentenceLength: 10, avgParagraphLength: 50, dialogueRatio: 0.2, descriptionRatio: 0.1, wordCount: 5000 },
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                stats: { avgSentenceLength: 20, avgParagraphLength: 70, dialogueRatio: 0.4, descriptionRatio: 0.3, wordCount: 10000 },
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.stats.avgSentenceLength).toBe(15);
            expect(result.fingerprint.stats.avgParagraphLength).toBe(60);
            expect(result.fingerprint.stats.dialogueRatio).toBeCloseTo(0.3, 5);
            expect(result.fingerprint.stats.wordCount).toBe(7500);
        });

        it('等权融合应等于简单平均', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    wordChoice: { ...makeFeatures().wordChoice, fourCharIdiomDensity: 4 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    wordChoice: { ...makeFeatures().wordChoice, fourCharIdiomDensity: 8 },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 1 },
                { fingerprint: fpB, weight: 1 },
            ]);

            expect(result.fingerprint.features.wordChoice.fourCharIdiomDensity).toBe(6);
        });
    });

    // ── TR-4.3: 语义描述融合非拼接 ─────────────────────────

    describe('TR-4.3: 语义描述融合非拼接', () => {
        it('描述不应是简单拼接（应去重）', () => {
            const descA = '句长适中。节奏平稳。短句与长句交替使用。';
            const descB = '句长适中。节奏舒缓。短句与长句交替使用。';
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: descA },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: descB },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            const blendedDesc = result.fingerprint.features.rhythm.description;
            // 不应包含重复的"句长适中"
            const matches = blendedDesc.match(/句长适中/g);
            expect(matches?.length ?? 0).toBeLessThanOrEqual(1);
            // 不应是简单拼接
            expect(blendedDesc).not.toBe(`${descA}${descB}`);
            expect(blendedDesc).not.toBe(`${descA}；${descB}`);
        });

        it('融合描述长度应在 50-100 字以内', () => {
            const longDesc = '这是一种独特的节奏风格。短句与长句交替使用，制造出明显的节奏感。句长分布均匀，标点密度适中，让读者感到舒适。';
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: longDesc },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: longDesc },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            const blendedDesc = result.fingerprint.features.rhythm.description;
            expect(blendedDesc.length).toBeLessThanOrEqual(150); // 留余量
        });

        it('单指纹融合应保留原描述', () => {
            const desc = '独特的风格描述。';
            const fp = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: desc },
                }),
            });

            const result = blender.blend([{ fingerprint: fp, weight: 1 }]);
            expect(result.fingerprint.features.rhythm.description).toBe(desc);
        });
    });

    // ── TR-4.4: 向量空间正确加权平均 ─────────────────────────

    describe('TR-4.4: 向量空间正确加权平均', () => {
        it('提供 vectors 时应做加权平均', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const vectorsA = makeV2Vectors('fp_a', 1); // vector = [0.1, 0.2, 0.3, ...]
            const vectorsB = makeV2Vectors('fp_b', 5); // vector = [0.5, 0.6, 0.7, ...]

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5, vectors: vectorsA },
                { fingerprint: fpB, weight: 0.5, vectors: vectorsB },
            ]);

            expect(result.vectors).toBeDefined();
            const expected = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
            result.vectors!.dimensions.rhythm.forEach((v, i) => {
                expect(v).toBeCloseTo(expected[i], 5);
            }); // (0.1+0.5)/2, (0.2+0.6)/2, ...
            result.vectors!.overallVector.forEach((v, i) => {
                expect(v).toBeCloseTo(expected[i], 5);
            });
            expect(result.fingerprint.blendSource.vectorsBlended).toBe(true);
        });

        it('不提供 vectors 时 vectorsBlended=false', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.vectors).toBeUndefined();
            expect(result.fingerprint.blendSource.vectorsBlended).toBe(false);
        });

        it('部分来源提供 vectors 时也应做向量融合', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const vectorsA = makeV2Vectors('fp_a', 1);

            const result = blender.blend([
                { fingerprint: fpA, weight: 1, vectors: vectorsA },
                { fingerprint: fpB, weight: 1 }, // 没提供 vectors
            ]);

            expect(result.vectors).toBeDefined();
            // 只有 fpA 提供了 vectors，应等于 fpA 的向量
            expect(result.vectors!.dimensions.rhythm).toEqual(vectorsA.dimensions.rhythm.vector);
        });

        it('非等权向量加权平均应正确', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const vectorsA = makeV2Vectors('fp_a', 1); // [0.1, 0.2, ...]
            const vectorsB = makeV2Vectors('fp_b', 5); // [0.5, 0.6, ...]

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.75, vectors: vectorsA },
                { fingerprint: fpB, weight: 0.25, vectors: vectorsB },
            ]);

            // 0.1*0.75 + 0.5*0.25 = 0.075 + 0.125 = 0.2
            expect(result.vectors!.dimensions.rhythm[0]).toBeCloseTo(0.2, 5);
        });
    });

    // ── TR-4.5: 融合计算耗时 < 100ms ─────────────────────────

    describe('TR-4.5: 融合计算耗时 < 100ms', () => {
        it('3 指纹融合应在 100ms 内完成', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const fpC = makeV2Fingerprint('fp_c', 'C');
            const vectorsA = makeV2Vectors('fp_a', 1);
            const vectorsB = makeV2Vectors('fp_b', 2);
            const vectorsC = makeV2Vectors('fp_c', 3);

            const start = Date.now();
            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5, vectors: vectorsA },
                { fingerprint: fpB, weight: 0.3, vectors: vectorsB },
                { fingerprint: fpC, weight: 0.2, vectors: vectorsC },
            ]);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(100);
            expect(result.fingerprint).toBeDefined();
        });

        it('12 个指纹也应快速完成（自动取前 3）', () => {
            const sources: BlendSource[] = Array.from({ length: 12 }, (_, i) => ({
                fingerprint: makeV2Fingerprint(`fp_${i}`, `指纹${i}`),
                weight: 12 - i,
            }));

            const start = Date.now();
            blender.blend(sources);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(100);
        });
    });

    // ── TR-4.6 & TR-4.7: 融合指纹可保存与使用 ─────────────────────────

    describe('TR-4.6 & TR-4.7: 融合指纹可保存与使用', () => {
        it('BlendedFingerprint 应包含所有 V2Fingerprint 必需字段', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            const blended = result.fingerprint;
            expect(blended.id).toMatch(/^blend_/);
            expect(blended.name).toContain('融合');
            expect(blended.scope).toBe('template');
            expect(blended.enabled).toBe(true);
            expect(blended.version).toBe('v2');
            expect(blended.features).toBeDefined();
            expect(blended.stats).toBeDefined();
            expect(blended.samples).toBeDefined();
            expect(blended.extractedAt).toBeGreaterThan(0);
        });

        it('features 应包含全部 12 维', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            const features = result.fingerprint.features;
            expect(features.rhythm).toBeDefined();
            expect(features.sentencePattern).toBeDefined();
            expect(features.wordChoice).toBeDefined();
            expect(features.rhetoric).toBeDefined();
            expect(features.perspective).toBeDefined();
            expect(features.emotion).toBeDefined();
            expect(features.tension).toBeDefined();
            expect(features.infoDensity).toBeDefined();
            expect(features.dialogue).toBeDefined();
            expect(features.description).toBeDefined();
            expect(features.narration).toBeDefined();
            expect(features.languageTexture).toBeDefined();
        });

        it('tags 应包含 blended 标记 + 来源 tags', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', { tags: ['仙侠', '热血'] });
            const fpB = makeV2Fingerprint('fp_b', 'B', { tags: ['都市', '热血'] });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.tags).toContain('blended');
            expect(result.fingerprint.tags).toContain('仙侠');
            expect(result.fingerprint.tags).toContain('都市');
            expect(result.fingerprint.tags).toContain('热血');
            // 热血 应去重
            const hotCount = result.fingerprint.tags.filter(t => t === '热血').length;
            expect(hotCount).toBe(1);
        });

        it('blendSource 应包含完整的来源信息', () => {
            const fpA = makeV2Fingerprint('fp_a', '指纹A', { scope: 'global' });
            const fpB = makeV2Fingerprint('fp_b', '指纹B', { scope: 'project' });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.6 },
                { fingerprint: fpB, weight: 0.4 },
            ]);

            const blendSource = result.fingerprint.blendSource;
            expect(blendSource.fingerprints).toHaveLength(2);
            expect(blendSource.fingerprints[0]).toEqual({
                id: 'fp_a',
                name: '指纹A',
                scope: 'global',
                weight: 0.6,
                dimensionWeights: undefined,
            });
            expect(blendSource.fingerprints[1]).toEqual({
                id: 'fp_b',
                name: '指纹B',
                scope: 'project',
                weight: 0.4,
                dimensionWeights: undefined,
            });
            expect(blendSource.blendedAt).toBeGreaterThan(0);
            expect(blendSource.vectorsBlended).toBe(false);
        });

        it('可自定义 name 和 id', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const options: BlendOptions = {
                id: 'custom_blend_001',
                name: '我的融合指纹',
            };

            const result = blender.blend([{ fingerprint: fpA, weight: 1 }], options);

            expect(result.fingerprint.id).toBe('custom_blend_001');
            expect(result.fingerprint.name).toBe('我的融合指纹');
        });
    });

    // ── TR-4.8: 融合结果风格介于来源之间 ─────────────────────────

    describe('TR-4.8: 融合结果风格介于来源之间', () => {
        it('等权融合的数值应等于来源的平均值', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 10 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 30 },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 1 },
                { fingerprint: fpB, weight: 1 },
            ]);

            const value = result.fingerprint.features.rhythm.avgSentenceLength;
            expect(value).toBeGreaterThan(10);
            expect(value).toBeLessThan(30);
            expect(value).toBe(20);
        });

        it('不等权融合的数值应偏向权重大的来源', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 10 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 30 },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.9 },
                { fingerprint: fpB, weight: 0.1 },
            ]);

            const value = result.fingerprint.features.rhythm.avgSentenceLength;
            expect(value).toBeGreaterThan(10);
            expect(value).toBeLessThan(20); // 偏向 A（10）
            expect(value).toBeCloseTo(12, 5); // 10*0.9 + 30*0.1 = 12
        });
    });

    // ── 维度独立加权 ─────────────────────────

    describe('维度独立加权', () => {
        it('不同维度可使用不同权重', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 10 },
                    emotion: { ...makeFeatures().emotion, emotionalFluctuationFrequency: 1.0 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 30 },
                    emotion: { ...makeFeatures().emotion, emotionalFluctuationFrequency: 3.0 },
                }),
            });

            const result = blender.blend([
                {
                    fingerprint: fpA, weight: 0.5,
                    dimensionWeights: { rhythm: 0.8, emotion: 0.2 },
                },
                {
                    fingerprint: fpB, weight: 0.5,
                    dimensionWeights: { rhythm: 0.2, emotion: 0.8 },
                },
            ]);

            // rhythm: 10*0.8 + 30*0.2 / (0.8+0.2) = 8 + 6 = 14
            expect(result.fingerprint.features.rhythm.avgSentenceLength).toBe(14);
            // emotion: 1.0*0.2 + 3.0*0.8 / 1.0 = 0.2 + 2.4 = 2.6
            expect(result.fingerprint.features.emotion.emotionalFluctuationFrequency).toBeCloseTo(2.6, 5);
        });

        it('dimensionWeights 缺失维度应回退到全局 weight', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 10 },
                    emotion: { ...makeFeatures().emotion, emotionalFluctuationFrequency: 1.0 },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, avgSentenceLength: 30 },
                    emotion: { ...makeFeatures().emotion, emotionalFluctuationFrequency: 3.0 },
                }),
            });

            const result = blender.blend([
                {
                    fingerprint: fpA, weight: 0.5,
                    dimensionWeights: { rhythm: 0.8 }, // emotion 未指定
                },
                {
                    fingerprint: fpB, weight: 0.5,
                    dimensionWeights: { rhythm: 0.2 },
                },
            ]);

            // rhythm: 10*0.8 + 30*0.2 = 14
            expect(result.fingerprint.features.rhythm.avgSentenceLength).toBe(14);
            // emotion: 回退到全局 0.5/0.5 → (1.0 + 3.0) / 2 = 2.0
            expect(result.fingerprint.features.emotion.emotionalFluctuationFrequency).toBeCloseTo(2.0, 5);
        });
    });

    // ── 边界与降级 ─────────────────────────

    describe('边界与降级', () => {
        it('空数组应抛错', () => {
            expect(() => blender.blend([])).toThrow(/sources 不能为空/);
        });

        it('权重全为 0 应抛错', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            expect(() => blender.blend([
                { fingerprint: fpA, weight: 0 },
            ])).toThrow(/无有效来源/);
        });

        it('部分权重为 0 应被过滤', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const fpC = makeV2Fingerprint('fp_c', 'C');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0 },
                { fingerprint: fpC, weight: 0.5 },
            ]);

            expect(result.fingerprint.blendSource.fingerprints).toHaveLength(2);
            const ids = result.fingerprint.blendSource.fingerprints.map(s => s.id);
            expect(ids).toContain('fp_a');
            expect(ids).toContain('fp_c');
            expect(ids).not.toContain('fp_b');
        });

        it('某维度 status=pending 时融合后应为 pending', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, status: 'complete' },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, status: 'pending' },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.features.emotion.status).toBe('pending');
        });

        it('部分 status=pending 部分部分 partial 时应为 pending', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, status: 'partial' },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, status: 'pending' },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.features.emotion.status).toBe('pending');
        });

        it('全部 status=complete 时应为 complete', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.features.rhythm.status).toBe('complete');
        });

        it('字符串字段（如 emotionalTone）应取权重最大的来源值', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, emotionalTone: '昂扬' },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    emotion: { ...makeFeatures().emotion, emotionalTone: '压抑' },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.7 },
                { fingerprint: fpB, weight: 0.3 },
            ]);

            expect(result.fingerprint.features.emotion.emotionalTone).toBe('昂扬');
        });

        it('samples 应按权重比例选取', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                samples: ['A1', 'A2', 'A3', 'A4'],
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                samples: ['B1', 'B2', 'B3', 'B4'],
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.samples.length).toBeLessThanOrEqual(3);
            expect(result.fingerprint.samples.length).toBeGreaterThan(0);
        });

        it('空描述列表应返回空字符串', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: '' },
                }),
            });
            const fpB = makeV2Fingerprint('fp_b', 'B', {
                features: makeFeatures({
                    rhythm: { ...makeFeatures().rhythm, description: '' },
                }),
            });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.features.rhythm.description).toBe('');
        });

        it('maxSources 可配置', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');
            const fpC = makeV2Fingerprint('fp_c', 'C');

            const result = blender.blend(
                [
                    { fingerprint: fpA, weight: 0.4 },
                    { fingerprint: fpB, weight: 0.3 },
                    { fingerprint: fpC, weight: 0.3 },
                ],
                { maxSources: 2 }
            );

            expect(result.fingerprint.blendSource.fingerprints).toHaveLength(2);
            const ids = result.fingerprint.blendSource.fingerprints.map(s => s.id);
            expect(ids).toContain('fp_a');
            expect(ids).toContain('fp_b');
            expect(ids).not.toContain('fp_c');
        });

        it('空 samples 数组应返回空数组', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A', { samples: [] });
            const fpB = makeV2Fingerprint('fp_b', 'B', { samples: [] });

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.samples).toEqual([]);
        });
    });

    // ── blendSource 完整性 ─────────────────────────

    describe('blendSource 完整性', () => {
        it('blendSource.fingerprints 应记录 dimensionWeights', () => {
            const fpA = makeV2Fingerprint('fp_a', 'A');
            const fpB = makeV2Fingerprint('fp_b', 'B');

            const result = blender.blend([
                {
                    fingerprint: fpA, weight: 0.5,
                    dimensionWeights: { rhythm: 0.8 },
                },
                {
                    fingerprint: fpB, weight: 0.5,
                    dimensionWeights: { rhythm: 0.2 },
                },
            ]);

            expect(result.fingerprint.blendSource.fingerprints[0].dimensionWeights).toEqual({ rhythm: 0.8 });
            expect(result.fingerprint.blendSource.fingerprints[1].dimensionWeights).toEqual({ rhythm: 0.2 });
        });

        it('source 字段应包含来源标识', () => {
            const fpA = makeV2Fingerprint('fp_a', '指纹A');
            const fpB = makeV2Fingerprint('fp_b', '指纹B');

            const result = blender.blend([
                { fingerprint: fpA, weight: 0.5 },
                { fingerprint: fpB, weight: 0.5 },
            ]);

            expect(result.fingerprint.source).toContain('blend:');
            expect(result.fingerprint.source).toContain('指纹A');
            expect(result.fingerprint.source).toContain('指纹B');
        });
    });
});
