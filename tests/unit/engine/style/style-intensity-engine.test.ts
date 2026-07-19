/**
 * style-intensity-engine.test.ts — StyleIntensityEngine 单元测试
 *
 * 覆盖 TR-5.1 ~ TR-5.6 + 强度映射函数 + 边界与降级
 */

import { describe, it, expect } from 'vitest';
import {
    StyleIntensityEngine,
    StyleIntensityConfig,
    IntensityPreset,
    INTENSITY_PRESETS,
    DEFAULT_INTENSITY_CONFIG,
} from '../../../../engine/style/style-intensity-engine';
import {
    StyleFingerprintFeaturesV2,
    StyleDimensionKeyV2,
    STYLE_DIMENSION_KEYS_V2,
} from '../../../../engine/style/style-dimensions-v2';

// ============================================================
// 测试辅助工具
// ============================================================

/** 生成完整 12 维 features */
function makeFeatures(): StyleFingerprintFeaturesV2 {
    const result: Record<StyleDimensionKeyV2, Record<string, unknown>> = {} as Record<StyleDimensionKeyV2, Record<string, unknown>>;
    for (const key of STYLE_DIMENSION_KEYS_V2) {
        result[key] = {
            description: '这是一个测试描述。用于验证强度引擎的截断逻辑。第三句话用于句号边界测试。',
            samples: ['示例一', '示例二', '示例三', '示例四'],
            status: 'complete',
            // 其他字段保持为任意值（测试不关心）
        };
    }
    return result as unknown as StyleFingerprintFeaturesV2;
}

/** 生成超长描述（200+ 字） */
function makeLongDescription(): string {
    return '这是第一句话。' + '这是第二句话用于填充内容。'.repeat(20) + '这是最后一句话。';
}

describe('StyleIntensityEngine', () => {
    const engine = new StyleIntensityEngine();

    // ============================================================
    // 一、预设测试（TR-5.2）
    // ============================================================

    describe('预设（TR-5.2）', () => {
        it('TR-5.2a: light 预设对应 0.25', () => {
            const config = engine.getConfigFromPreset('light');
            expect(config.globalIntensity).toBe(0.25);
            expect(config.preset).toBe('light');
        });

        it('TR-5.2b: medium 预设对应 0.50', () => {
            const config = engine.getConfigFromPreset('medium');
            expect(config.globalIntensity).toBe(0.50);
            expect(config.preset).toBe('medium');
        });

        it('TR-5.2c: deep 预设对应 0.80', () => {
            const config = engine.getConfigFromPreset('deep');
            expect(config.globalIntensity).toBe(0.80);
            expect(config.preset).toBe('deep');
        });

        it('INTENSITY_PRESETS 常量正确', () => {
            expect(INTENSITY_PRESETS.light).toBe(0.25);
            expect(INTENSITY_PRESETS.medium).toBe(0.50);
            expect(INTENSITY_PRESETS.deep).toBe(0.80);
        });
    });

    // ============================================================
    // 二、全局强度调节（TR-5.1）
    // ============================================================

    describe('全局强度调节（TR-5.1）', () => {
        it('TR-5.1a: 强度 0% 可设置', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0 });
            expect(preview.global.effectiveIntensity).toBe(0);
            expect(preview.disabled).toBe(true);
        });

        it('TR-5.1b: 强度 50% 可设置', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0.5 });
            expect(preview.global.effectiveIntensity).toBe(0.5);
            expect(preview.disabled).toBe(false);
        });

        it('TR-5.1c: 强度 100% 可设置', () => {
            const preview = engine.previewIntensity({ globalIntensity: 1.0 });
            expect(preview.global.effectiveIntensity).toBe(1.0);
            expect(preview.disabled).toBe(false);
        });

        it('TR-5.1d: 强度连续可调（0.01 粒度）', () => {
            for (let i = 0; i <= 100; i++) {
                const intensity = i / 100;
                const preview = engine.previewIntensity({ globalIntensity: intensity });
                expect(preview.global.effectiveIntensity).toBeCloseTo(intensity, 5);
            }
        });

        it('超范围值被 clamp 到 [0, 1]', () => {
            expect(engine.previewIntensity({ globalIntensity: -0.5 }).global.effectiveIntensity).toBe(0);
            expect(engine.previewIntensity({ globalIntensity: 1.5 }).global.effectiveIntensity).toBe(1);
        });

        it('NaN 处理为 0', () => {
            expect(engine.previewIntensity({ globalIntensity: NaN }).global.effectiveIntensity).toBe(0);
        });
    });

    // ============================================================
    // 三、维度独立强度调节（TR-5.3）
    // ============================================================

    describe('维度独立强度调节（TR-5.3）', () => {
        it('TR-5.3a: 12 维度可独立设置不同强度', () => {
            const config: StyleIntensityConfig = {
                globalIntensity: 0.5,
                dimensionIntensities: {
                    rhythm: 0.8,
                    emotion: 0.2,
                    tension: 1.0,
                },
            };
            const preview = engine.previewIntensity(config);

            expect(preview.dimensions.rhythm.effectiveIntensity).toBe(0.8);
            expect(preview.dimensions.emotion.effectiveIntensity).toBe(0.2);
            expect(preview.dimensions.tension.effectiveIntensity).toBe(1.0);
            // 未设置的维度回退到 globalIntensity
            expect(preview.dimensions.wordChoice.effectiveIntensity).toBe(0.5);
        });

        it('TR-5.3b: dimensionIntensities 为空时全部用 globalIntensity', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0.7 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(preview.dimensions[key].effectiveIntensity).toBe(0.7);
            }
        });

        it('TR-5.3c: 12 维度全部有预览结果', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0.5 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(preview.dimensions[key]).toBeDefined();
                expect(preview.dimensions[key].descriptionLength).toBe(100);
                expect(preview.dimensions[key].sampleCount).toBe(2);
            }
        });
    });

    // ============================================================
    // 四、强度为 0% 时完全禁用（TR-5.5）
    // ============================================================

    describe('强度为 0% 时完全禁用（TR-5.5）', () => {
        it('TR-5.5a: preview.disabled = true', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0 });
            expect(preview.disabled).toBe(true);
        });

        it('TR-5.5b: descriptionLength = 0', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0 });
            expect(preview.global.descriptionLength).toBe(0);
        });

        it('TR-5.5c: sampleCount = 0', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0 });
            expect(preview.global.sampleCount).toBe(0);
        });

        it('TR-5.5d: promptEmphasis = ""（空）', () => {
            const preview = engine.previewIntensity({ globalIntensity: 0 });
            expect(preview.global.promptEmphasis).toBe('');
        });

        it('TR-5.5e: applyIntensity 返回空描述和空示例', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 0 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(result[key].description).toBe('');
                expect(result[key].samples).toEqual([]);
            }
        });
    });

    // ============================================================
    // 五、强度为 100% 时最大模仿（TR-5.6）
    // ============================================================

    describe('强度为 100% 时最大模仿（TR-5.6）', () => {
        it('TR-5.6a: descriptionLength = 200（最大）', () => {
            const preview = engine.previewIntensity({ globalIntensity: 1.0 });
            expect(preview.global.descriptionLength).toBe(200);
        });

        it('TR-5.6b: sampleCount = 3（最大）', () => {
            const preview = engine.previewIntensity({ globalIntensity: 1.0 });
            expect(preview.global.sampleCount).toBe(3);
        });

        it('TR-5.6c: similarityThreshold = 0.8（最严格）', () => {
            const preview = engine.previewIntensity({ globalIntensity: 1.0 });
            expect(preview.global.similarityThreshold).toBeCloseTo(0.8, 5);
        });

        it('TR-5.6d: promptEmphasis 包含"完全模仿"', () => {
            const preview = engine.previewIntensity({ globalIntensity: 1.0 });
            expect(preview.global.promptEmphasis).toContain('完全模仿');
        });

        it('TR-5.6e: applyIntensity 保留完整描述（≤200字）', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 1.0 });
            // 原描述 < 200 字，应该完整保留
            expect(result.rhythm.description).toBe(features.rhythm.description);
            expect(result.rhythm.samples).toEqual(features.rhythm.samples.slice(0, 3));
        });
    });

    // ============================================================
    // 六、强度映射函数
    // ============================================================

    describe('描述长度映射', () => {
        it('0% → 0 字', () => {
            expect(engine.previewIntensity({ globalIntensity: 0 }).global.descriptionLength).toBe(0);
        });
        it('25% → 50 字', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.25 }).global.descriptionLength).toBe(50);
        });
        it('50% → 100 字', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.5 }).global.descriptionLength).toBe(100);
        });
        it('80% → 160 字', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.8 }).global.descriptionLength).toBe(160);
        });
        it('100% → 200 字', () => {
            expect(engine.previewIntensity({ globalIntensity: 1.0 }).global.descriptionLength).toBe(200);
        });
    });

    describe('示例数量映射', () => {
        it('0% → 0 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0 }).global.sampleCount).toBe(0);
        });
        it('10% → 1 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.1 }).global.sampleCount).toBe(1);
        });
        it('33% → 1 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.33 }).global.sampleCount).toBe(1);
        });
        it('34% → 2 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.34 }).global.sampleCount).toBe(2);
        });
        it('50% → 2 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.5 }).global.sampleCount).toBe(2);
        });
        it('67% → 3 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.67 }).global.sampleCount).toBe(3);
        });
        it('100% → 3 个', () => {
            expect(engine.previewIntensity({ globalIntensity: 1.0 }).global.sampleCount).toBe(3);
        });
    });

    describe('相似度阈值映射', () => {
        it('0% → 0.3（最宽松）', () => {
            expect(engine.previewIntensity({ globalIntensity: 0 }).global.similarityThreshold).toBeCloseTo(0.3, 5);
        });
        it('50% → 0.55', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.5 }).global.similarityThreshold).toBeCloseTo(0.55, 5);
        });
        it('100% → 0.8（最严格）', () => {
            expect(engine.previewIntensity({ globalIntensity: 1.0 }).global.similarityThreshold).toBeCloseTo(0.8, 5);
        });
        it('强度越高，阈值越高（匹配越严格）', () => {
            const low = engine.previewIntensity({ globalIntensity: 0.2 }).global.similarityThreshold;
            const high = engine.previewIntensity({ globalIntensity: 0.9 }).global.similarityThreshold;
            expect(high).toBeGreaterThan(low);
        });
    });

    describe('Prompt 强调文本映射', () => {
        it('0% → 空字符串', () => {
            expect(engine.previewIntensity({ globalIntensity: 0 }).global.promptEmphasis).toBe('');
        });
        it('1% → "可参考以下风格特征"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.01 }).global.promptEmphasis).toBe('可参考以下风格特征');
        });
        it('24% → "可参考以下风格特征"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.24 }).global.promptEmphasis).toBe('可参考以下风格特征');
        });
        it('25% → "建议模仿以下风格"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.25 }).global.promptEmphasis).toBe('建议模仿以下风格');
        });
        it('49% → "建议模仿以下风格"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.49 }).global.promptEmphasis).toBe('建议模仿以下风格');
        });
        it('50% → "严格遵循以下风格"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.5 }).global.promptEmphasis).toBe('严格遵循以下风格');
        });
        it('79% → "严格遵循以下风格"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.79 }).global.promptEmphasis).toBe('严格遵循以下风格');
        });
        it('80% → "完全模仿以下风格，确保风格一致性"', () => {
            expect(engine.previewIntensity({ globalIntensity: 0.8 }).global.promptEmphasis).toBe('完全模仿以下风格，确保风格一致性');
        });
        it('100% → "完全模仿以下风格，确保风格一致性"', () => {
            expect(engine.previewIntensity({ globalIntensity: 1.0 }).global.promptEmphasis).toBe('完全模仿以下风格，确保风格一致性');
        });
    });

    // ============================================================
    // 七、applyIntensity 测试
    // ============================================================

    describe('applyIntensity', () => {
        it('强度 0% → 所有维度描述为空、示例为空', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 0 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(result[key].description).toBe('');
                expect(result[key].samples).toEqual([]);
            }
        });

        it('强度 100% → 描述完整保留（≤200字）', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 1.0 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(result[key].description).toBe(features[key].description);
            }
        });

        it('强度 100% → 示例最多保留 3 个', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 1.0 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(result[key].samples).toHaveLength(3);
                expect(result[key].samples).toEqual(features[key].samples.slice(0, 3));
            }
        });

        it('强度 50% → 描述截断到 100 字以内', () => {
            const features = makeFeatures();
            // 修改描述为超长
            features.rhythm.description = makeLongDescription();
            const result = engine.applyIntensity(features, { globalIntensity: 0.5 });
            expect(result.rhythm.description.length).toBeLessThanOrEqual(101); // 100 + 可能的省略号
        });

        it('强度 50% → 示例截取 2 个', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, { globalIntensity: 0.5 });
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                expect(result[key].samples).toHaveLength(2);
            }
        });

        it('描述截断在句号边界', () => {
            const features = makeFeatures();
            // 描述：第一句。第二句很长很长。第三句。
            features.rhythm.description = '第一句。' + '第二句很长很长很长很长很长很长很长很长很长。' + '第三句。';
            const result = engine.applyIntensity(features, { globalIntensity: 0.2 });
            // 20% → 40 字，应该在句号边界截断
            expect(result.rhythm.description.length).toBeLessThanOrEqual(41);
            // 应该以句号结尾
            expect(result.rhythm.description).toMatch(/[。！？.!?]$/);
        });

        it('不修改原对象（返回新对象）', () => {
            const features = makeFeatures();
            const originalDesc = features.rhythm.description;
            const originalSamples = [...features.rhythm.samples];
            engine.applyIntensity(features, { globalIntensity: 0.5 });
            expect(features.rhythm.description).toBe(originalDesc);
            expect(features.rhythm.samples).toEqual(originalSamples);
        });

        it('维度独立强度生效', () => {
            const features = makeFeatures();
            const result = engine.applyIntensity(features, {
                globalIntensity: 1.0,
                dimensionIntensities: {
                    rhythm: 0, // rhythm 完全禁用
                    emotion: 0.5, // emotion 中等
                },
            });
            // rhythm 被禁用
            expect(result.rhythm.description).toBe('');
            expect(result.rhythm.samples).toEqual([]);
            // emotion 中等强度
            expect(result.emotion.samples).toHaveLength(2);
            // 其他维度用全局 1.0
            expect(result.wordChoice.samples).toHaveLength(3);
        });
    });

    // ============================================================
    // 八、normalizeConfig 测试
    // ============================================================

    describe('normalizeConfig', () => {
        it('超范围 globalIntensity 被 clamp', () => {
            const normalized = engine.normalizeConfig({ globalIntensity: 1.5 });
            expect(normalized.globalIntensity).toBe(1);
        });

        it('超范围 dimensionIntensities 被 clamp', () => {
            const normalized = engine.normalizeConfig({
                globalIntensity: 0.5,
                dimensionIntensities: {
                    rhythm: -0.5,
                    emotion: 2.0,
                },
            });
            expect(normalized.dimensionIntensities?.rhythm).toBe(0);
            expect(normalized.dimensionIntensities?.emotion).toBe(1);
        });

        it('NaN 处理为 0', () => {
            const normalized = engine.normalizeConfig({ globalIntensity: NaN });
            expect(normalized.globalIntensity).toBe(0);
        });

        it('空 dimensionIntensities 返回 undefined', () => {
            const normalized = engine.normalizeConfig({
                globalIntensity: 0.5,
                dimensionIntensities: {},
            });
            expect(normalized.dimensionIntensities).toBeUndefined();
        });

        it('preset 保留', () => {
            const normalized = engine.normalizeConfig({
                globalIntensity: 0.25,
                preset: 'light',
            });
            expect(normalized.preset).toBe('light');
        });
    });

    // ============================================================
    // 九、边界与降级
    // ============================================================

    describe('边界与降级', () => {
        it('DEFAULT_INTENSITY_CONFIG.globalIntensity = 1.0', () => {
            expect(DEFAULT_INTENSITY_CONFIG.globalIntensity).toBe(1.0);
        });

        it('空 features 不崩溃', () => {
            const emptyFeatures = {} as StyleFingerprintFeaturesV2;
            const result = engine.applyIntensity(emptyFeatures, { globalIntensity: 0.5 });
            expect(result).toBeDefined();
        });

        it('description 为空字符串时不崩溃', () => {
            const features = makeFeatures();
            features.rhythm.description = '';
            const result = engine.applyIntensity(features, { globalIntensity: 0.5 });
            expect(result.rhythm.description).toBe('');
        });

        it('samples 为空数组时不崩溃', () => {
            const features = makeFeatures();
            features.rhythm.samples = [];
            const result = engine.applyIntensity(features, { globalIntensity: 1.0 });
            expect(result.rhythm.samples).toEqual([]);
        });

        it('samples 为 undefined 时不崩溃', () => {
            const features = makeFeatures();
            features.rhythm.samples = undefined as unknown as string[];
            const result = engine.applyIntensity(features, { globalIntensity: 1.0 });
            expect(result.rhythm.samples).toEqual([]);
        });

        it('梯度差异：0/25/50/80/100% 有明显区别', () => {
            const intensities = [0, 0.25, 0.5, 0.8, 1.0];
            const previews = intensities.map(i => engine.previewIntensity({ globalIntensity: i }));

            // 描述长度递增
            for (let i = 0; i < previews.length - 1; i++) {
                expect(previews[i].global.descriptionLength).toBeLessThanOrEqual(previews[i + 1].global.descriptionLength);
            }
            // 示例数量递增
            for (let i = 0; i < previews.length - 1; i++) {
                expect(previews[i].global.sampleCount).toBeLessThanOrEqual(previews[i + 1].global.sampleCount);
            }
            // 相似度阈值递增
            for (let i = 0; i < previews.length - 1; i++) {
                expect(previews[i].global.similarityThreshold).toBeLessThanOrEqual(previews[i + 1].global.similarityThreshold);
            }
        });
    });
});
