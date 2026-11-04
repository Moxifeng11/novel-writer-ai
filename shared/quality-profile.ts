/**
 * quality-profile.ts — 三种创作模式的质量口径
 *
 * 同一套 QualityScoreEngine 六维评分，但长篇章节、短篇「节」、剧本「集」的
 * 通过线、额外检查与修订闸门不同。集中在这里，避免 UI/结算/修订各写一份阈值。
 */
import type { CreationMode } from './creation-mode';

/** 六维评分键（与 QualityScoreEngine 的 QualityDimension 结构一致）。 */
export type ModeQualityDimension =
    | 'readability'
    | 'rhythm'
    | 'emotion'
    | 'characterConsistency'
    | 'coherence'
    | 'languageTexture';

/** 六维中文名（shared 不反向依赖 engine，故在此保留一份契约）。 */
export const MODE_QUALITY_DIMENSION_LABELS: Record<ModeQualityDimension, string> = {
    readability: '可读性',
    rhythm: '节奏',
    emotion: '情绪饱满度',
    characterConsistency: '人物一致性',
    coherence: '情节连贯性',
    languageTexture: '语言质感',
};

/** 模式质量配置。 */
export interface ModeQualityProfile {
    mode: CreationMode;
    /** 界面标题，例如「短篇六维质检」/「剧本可拍质检」 */
    label: string;
    dimensions: readonly ModeQualityDimension[];
    /** 综合分通过线 */
    minOverall: number;
    /** 任一维度低于该值即不通过 */
    minDimension: number;
    /** 模式专属检查（展示用，不直接并入六维） */
    extraChecks: readonly string[];
    /** 修订闸门参数 */
    revision: {
        minLengthRatio: number;
        maxLengthRatio: number;
        maxDialogueDrop: number;
    };
}

/**
 * 三模式质量配置。
 *
 * 短篇更看开篇钩子与结尾兑现；剧本更看场次可拍、对白与动作行，
 * 因此修订允许的对话跌幅更宽（剧本本来就是对白驱动）。
 */
export const MODE_QUALITY_PROFILES: Record<CreationMode, ModeQualityProfile> = {
    long: {
        mode: 'long',
        label: '章节六维质检',
        dimensions: ['readability', 'rhythm', 'emotion', 'characterConsistency', 'coherence', 'languageTexture'],
        minOverall: 65,
        minDimension: 50,
        extraChecks: ['章节承接', '结尾钩子'],
        revision: { minLengthRatio: 0.9, maxLengthRatio: 1.1, maxDialogueDrop: 0.05 },
    },
    short: {
        mode: 'short',
        label: '短篇六维质检',
        dimensions: ['readability', 'rhythm', 'emotion', 'characterConsistency', 'coherence', 'languageTexture'],
        minOverall: 70,
        minDimension: 55,
        extraChecks: ['开篇钩子', '结尾兑现'],
        revision: { minLengthRatio: 0.88, maxLengthRatio: 1.12, maxDialogueDrop: 0.06 },
    },
    script: {
        mode: 'script',
        label: '剧本可拍质检',
        dimensions: ['readability', 'rhythm', 'emotion', 'characterConsistency', 'coherence', 'languageTexture'],
        minOverall: 70,
        minDimension: 55,
        extraChecks: ['场次可拍', '对白占比', '动作行'],
        revision: { minLengthRatio: 0.85, maxLengthRatio: 1.15, maxDialogueDrop: 0.1 },
    },
};

/**
 * 修订闸门参数。
 *
 * @param mode - 创作模式
 * @param lockedNames - 必须保留的人物名
 * @returns evaluateRevision 的选项
 */
export function modeRevisionOptions(
    mode: CreationMode,
    lockedNames: readonly string[] = [],
): { lockedNames: string[]; minLengthRatio: number; maxLengthRatio: number; maxDialogueDrop: number } {
    const profile = MODE_QUALITY_PROFILES[mode];
    return { lockedNames: [...lockedNames], ...profile.revision };
}
