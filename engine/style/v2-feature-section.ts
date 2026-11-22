/**
 * style/v2-feature-section.ts — V2 独有 5 维的提示词段落（唯一实现）
 *
 * ADR：`docs/design/2026-11-21-style-fingerprint-v2-canonical.md` R3 ——
 * 「现有 7 段注入（V1 投影）继续生效 + V2 独有 5 维追加为『V2 深化特征（量化）：』」。
 *
 * 为什么单独抽一个模块：正文有两条入口，都必须吃到同一段 V2 注入 ——
 *   - 协同写作：`style/dynamic-injection-engine.ts` 的 `TieredInjectionBuilder#buildGlobalTier`
 *   - 11 步流水线：`knowledge-injector.ts` 的 `buildFingerprintLines`（正文生成的唯一指纹注入口）
 * 两边各自拼一遍文案迟早漂移，所以摘要文案与段落格式只在这里写一次。
 *
 * 强度语义（与 ADR 一致）：
 *   - 强度 0（globalIntensity=0）的指纹在调用方就被过滤，整段消失；
 *   - 每个指纹的描述长度由调用方给出的 `descriptionLength` 决定，返回 0 表示只要定量摘要；
 *   - `status !== 'complete'` 的维度跳过（没分析完的维度不注入，避免 prompt 里出现半成品）。
 */

import type { StyleFingerprint } from '../style-fingerprint-library';
import type {
    DescriptionStats,
    EmotionStats,
    InfoDensityStats,
    SentencePatternStats,
    StyleDimensionKeyV2,
    StyleFingerprintFeaturesV2,
    TensionStats,
} from './style-dimensions-v2';
import { STYLE_DIMENSION_LABELS_V2, V2_NEW_DIMENSIONS } from './style-dimensions-v2';

/** V2 段落的标题行（调用方按它做断言/日志检索，不要在别处另写一份） */
export const V2_FEATURE_SECTION_TITLE = 'V2 深化特征（量化）：';

/** 把 0-1 的比例格式化为整数百分比 */
function v2Pct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

/**
 * 把 V2 新增维度的定量字段压成一句摘要（供提示词注入）。
 *
 * 只处理 V2 独有的 5 维；V1 已有的 7 维仍走原有文案，避免同一维度说两遍。
 *
 * @param key - V2 维度键（限 V2_NEW_DIMENSIONS）
 * @param dim - 该维度的特征
 * @returns 定量摘要
 */
export function summarizeV2Dimension(
    key: StyleDimensionKeyV2,
    dim: StyleFingerprintFeaturesV2[StyleDimensionKeyV2],
): string {
    switch (key) {
        case 'sentencePattern': {
            const d = dim as SentencePatternStats;
            return `倒装 ${d.inversionDensity.toFixed(1)}/千字 · 省略 ${d.ellipsisDensity.toFixed(1)}/千字 · 排比 ${d.parallelismDensity.toFixed(1)}/千字 · 设问 ${v2Pct(d.rhetoricalQuestionRatio)} · 嵌套 ${d.clauseNestingDepth.toFixed(1)} 层`;
        }
        case 'emotion': {
            const d = dim as EmotionStats;
            return `基调 ${d.emotionalTone || '未判定'} · 波动 ${d.emotionalFluctuationFrequency.toFixed(1)}/千字 · 强度 低${v2Pct(d.emotionalIntensityDistribution.low)}/中${v2Pct(d.emotionalIntensityDistribution.medium)}/高${v2Pct(d.emotionalIntensityDistribution.high)} · 取向 正${v2Pct(d.valenceRatio.positive)}/负${v2Pct(d.valenceRatio.negative)}`;
        }
        case 'tension': {
            const d = dim as TensionStats;
            return `悬念 ${d.suspenseDensity.toFixed(1)}/千字 · 冲突 ${d.conflictFrequency.toFixed(1)}/千字 · 转折 ${d.turningPointDensity.toFixed(1)}/千字 · 伏笔 ${d.foreshadowingMarkerCount.toFixed(1)}/千字 · 高潮 前${v2Pct(d.climaxDistribution.early)}/中${v2Pct(d.climaxDistribution.middle)}/后${v2Pct(d.climaxDistribution.late)}`;
        }
        case 'infoDensity': {
            const d = dim as InfoDensityStats;
            return `信息密度 ${d.infoDensity.toFixed(1)}/百字 · 专名 ${d.properNounDensity.toFixed(1)}/千字 · 设定植入 ${d.settingInjectionFrequency.toFixed(1)}/千字 · 新概念 ${d.conceptIntroductionRhythm.toFixed(1)}/千字`;
        }
        case 'description': {
            const d = dim as DescriptionStats;
            const s = d.sensoryDistribution;
            return `环境描写 ${v2Pct(d.environmentDescriptionRatio)} · 细节密度 ${d.detailDensity.toFixed(1)}/百字 · 感官 视${v2Pct(s.visual)}/听${v2Pct(s.auditory)}/触${v2Pct(s.tactile)}/嗅${v2Pct(s.olfactory)}/味${v2Pct(s.gustatory)}`;
        }
        default:
            return '';
    }
}

/** `buildV2FeatureSection` 的可选项 */
export interface V2FeatureSectionOptions {
    /**
     * 每个指纹的维度描述字数上限（与强度配置对齐）。
     * 返回 0 表示只注入定量摘要；不传则视为 0。
     */
    descriptionLength?: (fingerprintId: string) => number;
}

/**
 * 构建「V2 深化特征（量化）：」段落。
 *
 * @param fingerprints - 已按启用状态与强度过滤后的指纹（顺序即注入顺序）
 * @param v2Features - 指纹 id → V2 十二维特征；缺失/空的指纹跳过
 * @param options - 可选项（描述长度上限）
 * @returns 段落行数组；没有任何可注入维度时返回空数组
 *
 * @example
 * ```ts
 * const v2 = library.getV2FeaturesMap(fps.map(fp => fp.id));
 * const lines = buildV2FeatureSection(fps, v2);
 * if (lines.length) prompt.push('', ...lines);
 * ```
 */
export function buildV2FeatureSection(
    fingerprints: StyleFingerprint[],
    v2Features: Map<string, StyleFingerprintFeaturesV2> | undefined,
    options: V2FeatureSectionOptions = {},
): string[] {
    if (!v2Features || v2Features.size === 0 || fingerprints.length === 0) return [];

    const resolveLength = options.descriptionLength ?? (() => 0);
    const lines: string[] = [];

    for (const key of V2_NEW_DIMENSIONS) {
        const values = fingerprints
            .map(fp => {
                const dim = v2Features.get(fp.id)?.[key];
                if (!dim || dim.status !== 'complete') return '';
                const len = resolveLength(fp.id);
                const summary = summarizeV2Dimension(key, dim);
                const desc = dim.description && len > 0 ? dim.description.slice(0, len) : '';
                return [summary, desc].filter(Boolean).join('；');
            })
            .filter(Boolean);
        if (values.length > 0) {
            lines.push(`- ${STYLE_DIMENSION_LABELS_V2[key]}：${values.join('；')}`);
        }
    }

    if (lines.length === 0) return [];
    return [V2_FEATURE_SECTION_TITLE, ...lines];
}
