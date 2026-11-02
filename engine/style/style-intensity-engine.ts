/**
 * style/style-intensity-engine.ts — 写作指纹 V2 风格迁移强度调节引擎（Task 5）
 *
 * 设计要点：
 *   - 强度是一个 0-1 的数值：0% 完全禁用指纹影响，100% 最大程度模仿参考风格
 *   - 强度影响 4 个方面：
 *     1. 描述长度：0-200 字线性映射（强度越高，描述越详细）
 *     2. 示例数量：0-3 个阶梯映射（强度越高，示例越多）
 *     3. 相似度阈值：0.3-0.8 线性映射（强度越高，匹配越严格）
 *     4. Prompt 强调文本：5 档分级（无/参考/模仿/遵循/完全模仿）
 *   - 支持全局强度 + 12 维度独立强度（高级模式）
 *   - 三档预设：轻微（25%）、中等（50%）、深度（80%）
 *   - 强度预览：实时计算各维度的效果参数
 *
 * 设计原则：
 *   - 零外部依赖（纯算术计算，不调用 AI、不依赖网络、不修改磁盘）
 *   - 纯函数式：StyleIntensityEngine 无状态，每次调用独立
 *   - 外科手术式：不修改现有 PromptBuilder / StyleFingerprintLibrary
 *   - 向后兼容：V1 无强度概念时使用默认值 1.0（完全启用）
 */

import {
    StyleDimensionKeyV2,
    StyleFingerprintFeaturesV2,
    STYLE_DIMENSION_KEYS_V2,
} from './style-dimensions-v2';

// ============================================================
// 一、强度配置类型
// ============================================================

/** 强度预设 */
export type IntensityPreset = 'light' | 'medium' | 'deep';

/** 预设值映射 */
export const INTENSITY_PRESETS: Record<IntensityPreset, number> = {
    light: 0.25,
    medium: 0.50,
    deep: 0.80,
};

/** 预设中文标签 */
export const INTENSITY_PRESET_LABELS: Record<IntensityPreset, string> = {
    light: '轻微',
    medium: '中等',
    deep: '深度',
};

/**
 * 风格迁移强度配置
 * - globalIntensity: 全局强度（0-1），必填
 * - dimensionIntensities: 各维度独立强度（0-1），可选，缺省维度用 globalIntensity
 * - preset: 预设标记（设置预设时自动填充 globalIntensity）
 */
export interface StyleIntensityConfig {
    /** 全局强度（0-1，0% 完全禁用，100% 最大模仿） */
    globalIntensity: number;
    /** 维度独立强度（可选，缺省维度回退到 globalIntensity） */
    dimensionIntensities?: Partial<Record<StyleDimensionKeyV2, number>>;
    /** 预设标记（设置预设时自动填充 globalIntensity） */
    preset?: IntensityPreset;
}

/** 单维度强度效果 */
export interface StyleIntensityEffect {
    /** 实际生效的强度（维度强度 ?? 全局强度） */
    effectiveIntensity: number;
    /** 描述长度上限（0-200 字） */
    descriptionLength: number;
    /** 示例数量上限（0-3 个） */
    sampleCount: number;
    /** 相似度匹配阈值（0.3-0.8，强度越高阈值越高，匹配越严格） */
    similarityThreshold: number;
    /** Prompt 强调文本（空字符串表示不添加） */
    promptEmphasis: string;
}

/** 强度预览结果 */
export interface StyleIntensityPreview {
    /** 全局效果 */
    global: StyleIntensityEffect;
    /** 12 维各自效果 */
    dimensions: Record<StyleDimensionKeyV2, StyleIntensityEffect>;
    /** 是否完全禁用（globalIntensity === 0） */
    disabled: boolean;
}

// ============================================================
// 二、强度映射常量
// ============================================================

/** 描述长度映射参数 */
const DESC_LENGTH_MAX = 200;

/** 示例数量映射参数 */
const SAMPLE_COUNT_MAX = 3;

/** 相似度阈值映射参数（强度越高，阈值越高，匹配越严格） */
const SIMILARITY_THRESHOLD_BASE = 0.3;
const SIMILARITY_THRESHOLD_RANGE = 0.5; // 0.3 + intensity * 0.5 → [0.3, 0.8]

/** Prompt 强调文本分档 */
const PROMPT_EMPHASIS_LEVELS: Array<{ threshold: number; text: string }> = [
    { threshold: 0.0, text: '' },
    { threshold: 0.01, text: '可参考以下风格特征' },
    { threshold: 0.25, text: '建议模仿以下风格' },
    { threshold: 0.50, text: '严格遵循以下风格' },
    { threshold: 0.80, text: '完全模仿以下风格，确保风格一致性' },
];

/** 默认强度配置（完全启用） */
export const DEFAULT_INTENSITY_CONFIG: StyleIntensityConfig = {
    globalIntensity: 1.0,
};

// ============================================================
// 三、StyleIntensityEngine 主类
// ============================================================

/**
 * 风格迁移强度调节引擎
 *
 * 使用方式：
 *   const engine = new StyleIntensityEngine();
 *
 *   // 1. 预览强度效果
 *   const preview = engine.previewIntensity({ globalIntensity: 0.5 });
 *   // preview.global.descriptionLength → 100
 *   // preview.global.sampleCount → 2
 *
 *   // 2. 应用强度到指纹特征（调整描述长度和示例数量）
 *   const adjusted = engine.applyIntensity(features, { globalIntensity: 0.5 });
 *
 *   // 3. 获取预设
 *   const config = engine.getConfigFromPreset('deep');
 *   // config.globalIntensity → 0.8
 */
export class StyleIntensityEngine {
    /**
     * 预览强度效果（不修改指纹，只计算参数）
     * @param config 强度配置
     * @returns 强度预览（含全局和各维度效果）
     */
    previewIntensity(config: StyleIntensityConfig): StyleIntensityPreview {
        const globalIntensity = this.clampIntensity(config.globalIntensity);
        const globalEffect = this.computeEffect(globalIntensity);

        const dimensions = {} as Record<StyleDimensionKeyV2, StyleIntensityEffect>;
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            const dimIntensity = this.clampIntensity(
                config.dimensionIntensities?.[key] ?? globalIntensity
            );
            dimensions[key] = this.computeEffect(dimIntensity);
        }

        return {
            global: globalEffect,
            dimensions,
            disabled: globalIntensity === 0,
        };
    }

    /**
     * 应用强度到指纹特征
     * - 截断描述到指定长度
     * - 截取指定数量的示例
     * - 强度为 0 时描述截断为空、示例截断为空数组（自然禁用）
     * @param features 原始指纹特征
     * @param config 强度配置
     * @returns 调整后的指纹特征（新对象，不修改原对象）
     */
    applyIntensity(
        features: StyleFingerprintFeaturesV2,
        config: StyleIntensityConfig
    ): StyleFingerprintFeaturesV2 {
        const preview = this.previewIntensity(config);

        const result: Record<StyleDimensionKeyV2, Record<string, unknown>> = {} as Record<StyleDimensionKeyV2, Record<string, unknown>>;
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            const dimFeatures = features[key];
            // 维度缺失时跳过（保持空对象）
            if (!dimFeatures) continue;
            const effect = preview.dimensions[key];
            result[key] = {
                ...dimFeatures,
                description: this.truncateDescription(dimFeatures.description, effect.descriptionLength),
                samples: this.truncateSamples(dimFeatures.samples, effect.sampleCount),
            };
        }
        return result as unknown as StyleFingerprintFeaturesV2;
    }

    /**
     * 从预设获取强度配置
     * @param preset - 预设
      * @returns StyleIntensityConfig 实例
     */
    getConfigFromPreset(preset: IntensityPreset): StyleIntensityConfig {
        return {
            globalIntensity: INTENSITY_PRESETS[preset],
            preset,
        };
    }

    /**
     * 校验强度配置
     * @param config - 配置
     * @returns 校验后的配置（globalIntensity 在 [0,1] 范围内）
     */
    normalizeConfig(config: StyleIntensityConfig): StyleIntensityConfig {
        const globalIntensity = this.clampIntensity(config.globalIntensity);
        const dimensionIntensities: Partial<Record<StyleDimensionKeyV2, number>> = {};
        if (config.dimensionIntensities) {
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                const v = config.dimensionIntensities[key];
                if (v !== undefined) {
                    dimensionIntensities[key] = this.clampIntensity(v);
                }
            }
        }
        return {
            globalIntensity,
            dimensionIntensities: Object.keys(dimensionIntensities).length > 0 ? dimensionIntensities : undefined,
            preset: config.preset,
        };
    }

    // ============================================================
    // 四、私有方法 - 强度映射函数
    // ============================================================

    /** 限制强度在 [0, 1] 范围内 */
    private clampIntensity(intensity: number): number {
        if (typeof intensity !== 'number' || isNaN(intensity)) return 0;
        return Math.max(0, Math.min(1, intensity));
    }

    /**
     * 计算单个强度的效果参数
     */
    private computeEffect(intensity: number): StyleIntensityEffect {
        return {
            effectiveIntensity: intensity,
            descriptionLength: this.getDescriptionLength(intensity),
            sampleCount: this.getSampleCount(intensity),
            similarityThreshold: this.getSimilarityThreshold(intensity),
            promptEmphasis: this.getPromptEmphasis(intensity),
        };
    }

    /**
     * 描述长度映射（0-200 字线性）
     * - 0% → 0 字
     * - 100% → 200 字
     */
    private getDescriptionLength(intensity: number): number {
        return Math.round(intensity * DESC_LENGTH_MAX);
    }

    /**
     * 示例数量映射（0-3 个阶梯）
     * - 0% → 0 个
     * - 1-33% → 1 个
     * - 34-66% → 2 个
     * - 67-100% → 3 个
     */
    private getSampleCount(intensity: number): number {
        if (intensity <= 0) return 0;
        return Math.min(SAMPLE_COUNT_MAX, Math.ceil(intensity * SAMPLE_COUNT_MAX));
    }

    /**
     * 相似度阈值映射（0.3-0.8 线性）
     * - 强度越高 → 阈值越高 → 匹配越严格（只用非常相似的指纹）
     * - 0% → 0.3（最宽松）
     * - 100% → 0.8（最严格）
     */
    private getSimilarityThreshold(intensity: number): number {
        return SIMILARITY_THRESHOLD_BASE + intensity * SIMILARITY_THRESHOLD_RANGE;
    }

    /**
     * Prompt 强调文本映射（5 档分级）
     * - 0% → ''（不添加）
     * - 1-24% → '可参考以下风格特征'
     * - 25-49% → '建议模仿以下风格'
     * - 50-79% → '严格遵循以下风格'
     * - 80-100% → '完全模仿以下风格，确保风格一致性'
     */
    private getPromptEmphasis(intensity: number): string {
        for (let i = PROMPT_EMPHASIS_LEVELS.length - 1; i >= 0; i--) {
            if (intensity >= PROMPT_EMPHASIS_LEVELS[i].threshold) {
                return PROMPT_EMPHASIS_LEVELS[i].text;
            }
        }
        return '';
    }

    /**
     * 截断描述到指定长度
     * - 在句号边界截断，避免截断半句话
     */
    private truncateDescription(description: string, maxLength: number): string {
        if (maxLength <= 0) return '';
        if (!description) return '';
        if (description.length <= maxLength) return description;

        // 在句号边界截断
        const truncated = description.slice(0, maxLength);
        const lastSentenceEnd = Math.max(
            truncated.lastIndexOf('。'),
            truncated.lastIndexOf('！'),
            truncated.lastIndexOf('？'),
            truncated.lastIndexOf('.'),
            truncated.lastIndexOf('!'),
            truncated.lastIndexOf('?'),
        );

        if (lastSentenceEnd > maxLength * 0.5) {
            return truncated.slice(0, lastSentenceEnd + 1);
        }
        return truncated + '…';
    }

    /**
     * 截取指定数量的示例
     */
    private truncateSamples(samples: string[], maxCount: number): string[] {
        if (maxCount <= 0) return [];
        if (!samples || samples.length === 0) return [];
        return samples.slice(0, Math.min(maxCount, samples.length));
    }
}
