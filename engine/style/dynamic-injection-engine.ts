/**
 * style/dynamic-injection-engine.ts — 写作指纹 V2 动态风格注入引擎（Task 6）
 *
 * 设计要点：
 *   - ContextAnalyzer：纯规则识别段落功能 / 情绪基调 / 场景类型（无 AI 调用，< 300ms）
 *   - DynamicSampleSelector：基于上下文特征对向量检索结果做二次 rerank
 *   - TieredInjectionBuilder：分级拼装（全局层 + 段落层 + 句子层），总长度 ≤ 2000 字
 *
 * 设计原则：
 *   - 零外部依赖（纯字符串/数值计算，不调用 AI、不依赖网络）
 *   - 纯函数式：所有类无状态，每次调用独立
 *   - 外科手术式：不修改现有 PromptBuilder / StyleFingerprintLibrary
 *   - 向后兼容：direction 缺失时自动识别场景类型，未知场景走默认分支
 *   - 与 styleLearner 不冲突：StyleLearner 通过 getStyleGuide() 注入，本引擎仅消费指纹库 + 向量检索
 *
 * 与 Task 5 强度系统的关系：
 *   - 若调用方传入 intensityConfigs，则 TieredInjectionBuilder 应用强度截断（sampleCount）
 *   - 若未传入，则使用 DEFAULT_INTENSITY_CONFIG（globalIntensity=1.0，即不截断）
 *   - V1 指纹无 V2 12 维 features，强度仅作用于 samples 数量
 */

import type { SuggestionDirection } from '../../shared/types';
import type { StyleFingerprint } from '../style-fingerprint-library';
import type { StyleIntensityConfig } from './style-intensity-engine';
import { DEFAULT_INTENSITY_CONFIG, StyleIntensityEngine } from './style-intensity-engine';

/** 强度映射是纯函数，模块级共享一个实例即可 */
const intensityEngine = new StyleIntensityEngine();

// ============================================================
// 一、上下文特征类型定义
// ============================================================

/** 段落功能类型 */
export type ParagraphFunction =
    | 'dialogue'    // 对话
    | 'description' // 描写
    | 'narration'   // 叙事
    | 'argument'    // 议论
    | 'lyrical'     // 抒情
    | 'unknown';

/** 情绪基调 */
export type EmotionTone = 'positive' | 'negative' | 'neutral' | 'mixed';

/** 场景类型（与 SuggestionDirection 8 个值对齐 + unknown） */
export type SceneType =
    | 'action' | 'emotion' | 'dialogue' | 'description'
    | 'foreshadow' | 'conflict' | 'resolution' | 'surprise'
    | 'unknown';

/**
 * 上下文特征（ContextAnalyzer 的输出）
 */
export interface ContextFeatures {
    /** 段落功能识别结果 */
    paragraphFunction: ParagraphFunction;
    /** 情绪基调 */
    emotionTone: EmotionTone;
    /** 情绪强度 0-1 */
    emotionIntensity: number;
    /** 场景类型识别结果 */
    sceneType: SceneType;
    /** 从调用方传入的 direction（优先于自动识别） */
    directionHint?: SuggestionDirection;
    /** 命中的关键词，便于调试 */
    keywords: string[];
}

/** 动态示例选择结果 */
export interface SelectedSample {
    /** 示例文本 */
    sample: string;
    /** 综合得分（向量分 + 上下文匹配加成） */
    score: number;
    /** 选中原因（便于调试与测试） */
    reason: string;
}

/** 分级注入片段 */
interface TieredInjectionParts {
    /** 全局层：整体风格指引 */
    globalTier: string[];
    /** 段落层：匹配当前段落功能的示例 */
    paragraphTier: string[];
    /** 句子层：特殊句式/修辞提示（可空） */
    sentenceTier: string[];
    /** 总长度（字符数） */
    totalLength: number;
}

// ============================================================
// 二、关键词词典
// ============================================================

/** 段落功能关键词（用于 ParagraphFunction 识别） */
const PARAGRAPH_FUNCTION_KEYWORDS: Record<Exclude<ParagraphFunction, 'unknown'>, string[]> = {
    dialogue: [
        '道：', '说：', '问道', '答道', '喊道', '笑道', '怒道', '冷声道',
        '"', '"', '「', '」', '『', '』', '问道', '回答', '说道',
    ],
    description: [
        '阳光', '月光', '夜色', '风', '雨', '雪', '雾', '云',
        '山', '河', '树', '花', '草', '石', '屋', '门', '窗',
        '光线', '气味', '声音', '温度', '颜色',
    ],
    narration: [
        '于是', '然后', '接着', '随后', '后来', '不久', '此时', '此刻',
        '走', '跑', '坐', '站', '看', '听', '想', '拿',
    ],
    argument: [
        '因为', '所以', '因此', '不过', '但是', '然而', '虽然', '尽管',
        '换言之', '总之', '综上', '可见', '由此',
    ],
    lyrical: [
        '啊', '哎', '唉', '呀', '呢', '吧',
        '心中', '心里', '内心', '深处', '突然', '忽然', '莫名',
    ],
};

/** 情绪关键词（用于 EmotionTone 识别） */
const EMOTION_KEYWORDS: Record<Exclude<EmotionTone, 'neutral' | 'mixed'>, string[]> = {
    positive: [
        '笑', '喜', '乐', '欢', '欣', '慰', '甜', '暖', '温柔', '幸福',
        '安心', '放松', '满足', '期待', '希望', '感激', '感动',
    ],
    negative: [
        '怒', '愤', '恨', '怨', '悲', '哀', '痛', '苦', '冷', '寒',
        '惧', '怕', '慌', '乱', '惊', '震', '颤', '抖', '泪', '哭',
        '压抑', '窒息', '绝望', '孤独', '寂寞',
    ],
};

/** 场景类型关键词（用于 SceneType 自动识别，仅当 direction 缺失时使用） */
const SCENE_TYPE_KEYWORDS: Record<Exclude<SceneType, 'unknown'>, string[]> = {
    action: [
        '冲', '扑', '撞', '打', '踢', '挥', '抓', '扔', '劈', '斩',
        '剑', '刀', '枪', '拳', '掌', '迅捷', '凌厉', '暴起',
    ],
    emotion: [
        '心跳', '呼吸', '颤抖', '眼泪', '心头', '心下', '心头一紧',
        '怔', '愣', '呆', '失神', '出神', '怦然',
    ],
    dialogue: [
        '道：', '说：', '问：', '答：', '"', '"', '「', '」',
        '开口', '答话', '接话', '插嘴',
    ],
    description: [
        '阳光', '月光', '夜色', '云雾', '山色', '水光', '草木',
        '光线', '气味', '声响', '颜色', '轮廓', '阴影',
    ],
    foreshadow: [
        '忽然', '不知为何', '似乎', '仿佛', '隐隐', '莫名',
        '一闪而过', '若有所思', '意味深长', '不动声色',
    ],
    conflict: [
        '冲突', '对抗', '争执', '对峙', '威胁', '逼迫', '挑衅',
        '怒目', '冷哼', '拔剑', '出手', '杀意',
    ],
    resolution: [
        '终于', '尘埃落定', '归于平静', '缓缓', '轻轻', '默默',
        '收起', '放下', '离开', '转身', '远去',
    ],
    surprise: [
        '突然', '忽然', '猛地', '陡然', '骤然', '一瞬间',
        '不料', '没想到', '竟然', '居然', '赫然',
    ],
};

/**
 * direction → sceneType 直接映射（directionHint 优先于关键词识别）
 */
const DIRECTION_TO_SCENE: Record<SuggestionDirection, SceneType> = {
    action: 'action',
    emotion: 'emotion',
    dialogue: 'dialogue',
    description: 'description',
    foreshadow: 'foreshadow',
    conflict: 'conflict',
    resolution: 'resolution',
    surprise: 'surprise',
};

/**
 * sceneType → 段落功能映射（用于在 TieredInjectionBuilder 中选择示例风格）
 */
const SCENE_TO_PARAGRAPH: Record<Exclude<SceneType, 'unknown'>, ParagraphFunction> = {
    action: 'description',
    emotion: 'lyrical',
    dialogue: 'dialogue',
    description: 'description',
    foreshadow: 'narration',
    conflict: 'description',
    resolution: 'lyrical',
    surprise: 'narration',
};

// ============================================================
// 三、ContextAnalyzer 类
// ============================================================

/**
 * 上下文分析器
 * - 纯规则识别，无 AI 调用
 * - 输入：当前已写文本的尾部（建议 500-800 字）
 * - 输出：ContextFeatures
 *
 * 性能目标：单次 analyze < 50ms（纯字符串扫描）
 */
export class ContextAnalyzer {
    /**
     * 分析文本上下文特征
     * @param text 当前已写文本（建议传尾部 500-800 字）
     * @param directionHint 可选的 direction 提示（优先于自动识别）
     */
    analyze(text: string, directionHint?: SuggestionDirection): ContextFeatures {
        const safeText = (text || '').slice(-800);
        const keywords: string[] = [];

        const paragraphFunction = this.detectParagraphFunction(safeText, keywords);
        const { tone, intensity } = this.detectEmotion(safeText, keywords);
        const sceneType = directionHint
            ? DIRECTION_TO_SCENE[directionHint]
            : this.detectSceneType(safeText, keywords);

        return {
            paragraphFunction,
            emotionTone: tone,
            emotionIntensity: intensity,
            sceneType,
            directionHint,
            keywords: Array.from(new Set(keywords)),
        };
    }

    /** 识别段落功能 */
    private detectParagraphFunction(text: string, hitKeywords: string[]): ParagraphFunction {
        const scores: Record<Exclude<ParagraphFunction, 'unknown'>, number> = {
            dialogue: 0,
            description: 0,
            narration: 0,
            argument: 0,
            lyrical: 0,
        };

        for (const fn of Object.keys(PARAGRAPH_FUNCTION_KEYWORDS) as Array<Exclude<ParagraphFunction, 'unknown'>>) {
            const words = PARAGRAPH_FUNCTION_KEYWORDS[fn];
            for (const w of words) {
                if (text.includes(w)) {
                    scores[fn] += 1;
                    hitKeywords.push(w);
                }
            }
        }

        // 取最高分
        let bestFn: ParagraphFunction = 'unknown';
        let bestScore = 0;
        for (const fn of Object.keys(scores) as Array<Exclude<ParagraphFunction, 'unknown'>>) {
            if (scores[fn] > bestScore) {
                bestScore = scores[fn];
                bestFn = fn;
            }
        }
        return bestFn;
    }

    /** 识别情绪基调与强度 */
    private detectEmotion(text: string, hitKeywords: string[]): { tone: EmotionTone; intensity: number } {
        let posCount = 0;
        let negCount = 0;

        for (const w of EMOTION_KEYWORDS.positive) {
            if (text.includes(w)) {
                posCount += 1;
                hitKeywords.push(w);
            }
        }
        for (const w of EMOTION_KEYWORDS.negative) {
            if (text.includes(w)) {
                negCount += 1;
                hitKeywords.push(w);
            }
        }

        const total = posCount + negCount;
        if (total === 0) {
            return { tone: 'neutral', intensity: 0 };
        }
        // 强度 = 命中数 / 10，封顶 1
        const intensity = Math.min(1, total / 10);

        if (posCount > negCount * 2) return { tone: 'positive', intensity };
        if (negCount > posCount * 2) return { tone: 'negative', intensity };
        if (posCount > 0 && negCount > 0) return { tone: 'mixed', intensity };
        // 单边但优势不明显
        return { tone: posCount >= negCount ? 'positive' : 'negative', intensity };
    }

    /** 识别场景类型 */
    private detectSceneType(text: string, hitKeywords: string[]): SceneType {
        const scores: Record<Exclude<SceneType, 'unknown'>, number> = {
            action: 0,
            emotion: 0,
            dialogue: 0,
            description: 0,
            foreshadow: 0,
            conflict: 0,
            resolution: 0,
            surprise: 0,
        };

        for (const st of Object.keys(SCENE_TYPE_KEYWORDS) as Array<Exclude<SceneType, 'unknown'>>) {
            const words = SCENE_TYPE_KEYWORDS[st];
            for (const w of words) {
                if (text.includes(w)) {
                    scores[st] += 1;
                    hitKeywords.push(w);
                }
            }
        }

        let bestSt: SceneType = 'unknown';
        let bestScore = 0;
        for (const st of Object.keys(scores) as Array<Exclude<SceneType, 'unknown'>>) {
            if (scores[st] > bestScore) {
                bestScore = scores[st];
                bestSt = st;
            }
        }
        return bestSt;
    }
}

// ============================================================
// 四、DynamicSampleSelector 类
// ============================================================

/**
 * 动态示例选择器
 * - 对向量检索结果做二次 rerank
 * - 加分规则：示例文本中命中场景关键词、情绪关键词、段落功能关键词
 * - 多样性保障：同一 fingerprintId 的示例最多取 2 条（避免全部来自同一指纹）
 */
export class DynamicSampleSelector {
    /**
     * 选择最匹配的示例
     * @param samples 向量检索结果（已按相似度排序）
     * @param context 上下文特征
     * @param topN 返回的示例数量（默认 3）
     */
    select(
        samples: Array<{ sample: string; score: number; fingerprintId?: string }>,
        context: ContextFeatures,
        topN: number = 3,
    ): SelectedSample[] {
        if (samples.length === 0) return [];

        // 1. 计算每个示例的上下文匹配加分
        const scored: Array<SelectedSample & { fpId?: string }> = samples.map(s => {
            const bonus = this.computeContextBonus(s.sample, context);
            const finalScore = s.score + bonus;
            const reason = this.buildReason(s.score, bonus, context);
            return { sample: s.sample, score: finalScore, reason, fpId: s.fingerprintId };
        });

        // 2. 按综合得分降序排序
        scored.sort((a, b) => b.score - a.score);

        // 3. 多样性筛选：同一 fingerprintId 最多取 2 条
        //    fpId 缺失时不计入上限：否则所有未知来源样本会被当成同一指纹，
        //    topN=3 会静默退化成只能返回 2 条。
        const fpCount: Record<string, number> = {};
        const result: SelectedSample[] = [];
        for (const s of scored) {
            if (s.fpId) {
                const used = fpCount[s.fpId] || 0;
                if (used >= 2) continue;
                fpCount[s.fpId] = used + 1;
            }
            result.push({ sample: s.sample, score: s.score, reason: s.reason });
            if (result.length >= topN) break;
        }

        return result;
    }

    /** 计算示例与上下文的匹配加分 */
    private computeContextBonus(sample: string, context: ContextFeatures): number {
        let bonus = 0;
        // 场景关键词命中：每个 +0.05
        if (context.sceneType !== 'unknown') {
            const sceneWords = SCENE_TYPE_KEYWORDS[context.sceneType];
            for (const w of sceneWords) {
                if (sample.includes(w)) bonus += 0.05;
            }
        }
        // 情绪关键词命中：每个 +0.03
        if (context.emotionTone === 'positive' || context.emotionTone === 'negative') {
            const emotionWords = EMOTION_KEYWORDS[context.emotionTone];
            for (const w of emotionWords) {
                if (sample.includes(w)) bonus += 0.03;
            }
        }
        // 段落功能关键词命中：每个 +0.02
        if (context.paragraphFunction !== 'unknown') {
            const fnWords = PARAGRAPH_FUNCTION_KEYWORDS[context.paragraphFunction];
            for (const w of fnWords) {
                if (sample.includes(w)) bonus += 0.02;
            }
        }
        // 上限 0.3，避免单条示例分数膨胀
        return Math.min(0.3, bonus);
    }

    /** 构建选中原因（便于调试） */
    private buildReason(baseScore: number, bonus: number, context: ContextFeatures): string {
        if (bonus === 0) return `向量得分 ${baseScore.toFixed(3)}`;
        const parts: string[] = [`向量 ${baseScore.toFixed(3)}`];
        if (context.sceneType !== 'unknown') parts.push(`场景:${context.sceneType}`);
        if (context.emotionTone !== 'neutral') parts.push(`情绪:${context.emotionTone}`);
        if (context.paragraphFunction !== 'unknown') parts.push(`功能:${context.paragraphFunction}`);
        return parts.join(' + ') + ` → +${bonus.toFixed(3)}`;
    }
}

// ============================================================
// 五、TieredInjectionBuilder 类
// ============================================================

/** 分级注入默认总长度上限 */
const DEFAULT_MAX_TOTAL_LENGTH = 2000;

/** 各层长度预算分配（总和 2100 略大于默认 2000，留出超长检查空间） */
const TIER_LENGTH_BUDGET = {
    globalTier: 650,    // 全局风格指引
    paragraphTier: 1050, // 段落层示例
    sentenceTier: 400,  // 句子层提示
};

/**
 * 分级注入拼装器
 * - 全局层：12 维 / 7 维特征描述（按指纹顺序聚合）
 * - 段落层：动态选择的示例片段（按上下文匹配度排序）
 * - 句子层：特殊句式/修辞提示（仅当检测到特征时注入）
 *
 * 与 styleLearner 的关系：
 *   - StyleLearner 通过 getStyleGuide() 输出整体风格指引，由 getMemoryPromptParts 注入
 *   - 本引擎的输出也由 getMemoryPromptParts 注入，两者**串联**而非冲突
 *   - 全局层仅包含指纹特征描述，不包含 styleLearner 的内容
 */
/** v4.20 注入溯源：单次分层拼装的统计（prompt-ledger 消费） */
export interface TieredBuildStats {
    budget: number;
    fingerprintCount: number;
    sampleCount: number;
    globalChars: number;
    paragraphChars: number;
    sentenceChars: number;
    totalChars: number;
    /** 句子层因超限被整体丢弃 */
    droppedSentence: boolean;
    /** 段落层因超限被截断 */
    truncatedParagraph: boolean;
}

export class TieredInjectionBuilder {
    /**
     * 构建分级注入片段
     * @param fingerprints 已启用的指纹列表
     * @param samples 动态选择的示例
     * @param context 上下文特征
     * @param intensityConfigs 可选的强度配置（按 fpId 索引）
     * @param maxTotalLength 总长度上限（默认 2000；v4.20 起可由设置 fingerprintInjectionBudget 调整）
     * @param statsOut 可选：填充注入统计（prompt-ledger 消费）
     */
    build(
        fingerprints: StyleFingerprint[],
        samples: SelectedSample[],
        context: ContextFeatures,
        intensityConfigs?: Map<string, StyleIntensityConfig>,
        maxTotalLength: number = DEFAULT_MAX_TOTAL_LENGTH,
        statsOut?: TieredBuildStats,
    ): string[] {
        if (fingerprints.length === 0 && samples.length === 0) {
            if (statsOut) {
                statsOut.budget = maxTotalLength;
                statsOut.fingerprintCount = 0;
                statsOut.sampleCount = 0;
                statsOut.globalChars = 0;
                statsOut.paragraphChars = 0;
                statsOut.sentenceChars = 0;
                statsOut.totalChars = 0;
                statsOut.droppedSentence = false;
                statsOut.truncatedParagraph = false;
            }
            return [];
        }

        const budget = this.distributeBudget(maxTotalLength, samples.length === 0);

        // 1. 全局层：特征描述
        const globalTier = this.buildGlobalTier(fingerprints, intensityConfigs, budget.globalTier);

        // 2. 段落层：示例片段
        const paragraphTier = this.buildParagraphTier(samples, context, budget.paragraphTier, intensityConfigs);

        // 3. 句子层：特殊提示
        const sentenceTier = this.buildSentenceTier(context, fingerprints, budget.sentenceTier);

        // 4. 总长度超限时按优先级丢弃
        const allParts = [...globalTier, ...paragraphTier, ...sentenceTier];
        const totalLen = allParts.reduce((sum, s) => sum + s.length, 0);

        const fillStats = (g: string[], p: string[], c: string[], droppedSentence: boolean, truncatedParagraph: boolean): void => {
            if (!statsOut) return;
            const total = (list: string[]) => list.reduce((sum, item) => sum + item.length, 0);
            statsOut.budget = maxTotalLength;
            statsOut.fingerprintCount = fingerprints.length;
            statsOut.sampleCount = samples.length;
            statsOut.globalChars = total(g);
            statsOut.paragraphChars = total(p);
            statsOut.sentenceChars = total(c);
            statsOut.totalChars = total(g) + total(p) + total(c);
            statsOut.droppedSentence = droppedSentence;
            statsOut.truncatedParagraph = truncatedParagraph;
        };

        if (totalLen <= maxTotalLength) {
            fillStats(globalTier, paragraphTier, sentenceTier, false, false);
            return this.assembleOutput(globalTier, paragraphTier, sentenceTier);
        }

        // 超限：先丢弃句子层
        const withoutSentence = [...globalTier, ...paragraphTier];
        const lenWithoutSentence = withoutSentence.reduce((sum, s) => sum + s.length, 0);
        if (lenWithoutSentence <= maxTotalLength) {
            fillStats(globalTier, paragraphTier, [], true, false);
            return this.assembleOutput(globalTier, paragraphTier, []);
        }

        // 仍超限：截断段落层尾部
        const truncatedParagraph = this.truncateTo(paragraphTier, maxTotalLength - this.calcTotalLength(globalTier));
        fillStats(globalTier, truncatedParagraph, [], true, true);
        return this.assembleOutput(globalTier, truncatedParagraph, []);
    }

    /** 分配各层长度预算 */
    private distributeBudget(maxTotal: number, noSamples: boolean): { globalTier: number; paragraphTier: number; sentenceTier: number } {
        if (noSamples) {
            // 无示例时，预算全部给全局层
            return { globalTier: maxTotal, paragraphTier: 0, sentenceTier: 0 };
        }
        const ratio = maxTotal / DEFAULT_MAX_TOTAL_LENGTH;
        return {
            globalTier: Math.floor(TIER_LENGTH_BUDGET.globalTier * ratio),
            paragraphTier: Math.floor(TIER_LENGTH_BUDGET.paragraphTier * ratio),
            sentenceTier: Math.floor(TIER_LENGTH_BUDGET.sentenceTier * ratio),
        };
    }

    /** 构建全局层：特征描述（按每个指纹的强度配置截断/禁用） */
    private buildGlobalTier(
        fingerprints: StyleFingerprint[],
        intensityConfigs: Map<string, StyleIntensityConfig> | undefined,
        budget: number,
    ): string[] {
        const result: string[] = ['【写作风格指纹】'];

        // 按 scope 排序：project 优先于 global
        const projectFps = fingerprints.filter(fp => fp.scope === 'project');
        const globalFps = fingerprints.filter(fp => fp.scope === 'global');
        const orderedFps = [...projectFps, ...globalFps];

        if (orderedFps.length === 0) return [];

        // 强度配置 → 每个指纹的描述长度上限；强度 0 视为完全禁用
        const limits = new Map<string, { descriptionLength: number; disabled: boolean }>();
        for (const fp of orderedFps) {
            const config = intensityConfigs?.get(fp.id) ?? DEFAULT_INTENSITY_CONFIG;
            const preview = intensityEngine.previewIntensity(config);
            limits.set(fp.id, {
                descriptionLength: preview.global.descriptionLength,
                disabled: preview.disabled,
            });
        }
        const activeFps = orderedFps.filter(fp => !limits.get(fp.id)!.disabled);
        if (activeFps.length === 0) return [];

        // V1 7 维特征标签与字段
        const featureLabels = [
            '句式节奏', '用词偏好', '叙事手法', '修辞风格',
            '对话风格', '段落结构', '整体基调',
        ];
        const featureKeys: Array<keyof StyleFingerprint['features']> = [
            'sentenceRhythm', 'wordPreference', 'narrativeStyle', 'rhetoric',
            'dialogueStyle', 'paragraphStructure', 'overallTone',
        ];

        const featureLines: string[] = [];
        for (let i = 0; i < featureLabels.length; i++) {
            const key = featureKeys[i];
            const values = activeFps
                .map(fp => {
                    const raw = fp.features[key];
                    if (!raw) return '';
                    const len = limits.get(fp.id)!.descriptionLength;
                    return len > 0 ? raw.slice(0, len) : '';
                })
                .filter(Boolean);
            if (values.length > 0) {
                featureLines.push(`- ${featureLabels[i]}：${values.join('；')}`);
            }
        }

        if (featureLines.length > 0) {
            result.push('风格特征：');
            result.push(...featureLines);
        }

        const truncated = this.truncateTo(result, budget);
        return truncated;
    }

    /** 构建段落层：示例片段（受强度配置的 sampleCount 上限约束） */
    private buildParagraphTier(
        samples: SelectedSample[],
        context: ContextFeatures,
        budget: number,
        intensityConfigs?: Map<string, StyleIntensityConfig>,
    ): string[] {
        if (samples.length === 0 || budget <= 0) return [];

        let maxSamples = samples.length;
        if (intensityConfigs && intensityConfigs.size > 0) {
            let cap = 0;
            for (const config of intensityConfigs.values()) {
                const preview = intensityEngine.previewIntensity(config);
                if (preview.disabled) continue;
                cap = Math.max(cap, preview.global.sampleCount);
            }
            maxSamples = Math.min(samples.length, cap);
        }
        if (maxSamples <= 0) return [];

        const used = samples.slice(0, maxSamples);
        const result: string[] = ['', '参考片段：'];

        // 每条示例的长度上限 = budget / 样本数，且单条不超过 300 字
        const perSampleMax = Math.min(300, Math.floor(budget / used.length));

        for (let i = 0; i < used.length; i++) {
            const s = used[i];
            const truncated = s.sample.slice(0, perSampleMax);
            result.push(`${i + 1}. ${truncated}`);
        }

        return result;
    }

    /** 构建句子层：特殊提示（基于上下文特征） */
    private buildSentenceTier(
        context: ContextFeatures,
        fingerprints: StyleFingerprint[],
        budget: number,
    ): string[] {
        if (budget <= 0) return [];

        const tips: string[] = [];

        // 场景类型对应的针对性提示
        if (context.sceneType !== 'unknown' && context.sceneType !== 'description') {
            const tip = this.getSceneTypeTip(context.sceneType);
            if (tip) tips.push(tip);
        }

        // 情绪强度高时添加提示
        if (context.emotionIntensity > 0.5 && context.emotionTone !== 'neutral') {
            const tip = this.getEmotionTip(context.emotionTone, context.emotionIntensity);
            if (tip) tips.push(tip);
        }

        if (tips.length === 0) return [];

        const result: string[] = ['', '【风格提示】'];
        result.push(...tips);

        return this.truncateTo(result, budget);
    }

    /** 场景类型 → 针对性提示 */
    private getSceneTypeTip(sceneType: Exclude<SceneType, 'unknown'>): string | null {
        const tips: Record<Exclude<SceneType, 'unknown'>, string> = {
            action: '动作场面优先模仿句式节奏与短句张力。',
            emotion: '内心段落优先模仿情绪词选择与心理描写距离。',
            dialogue: '对话段落优先模仿台词个性化与潜台词表达。',
            description: '环境描写优先模仿感官细节密度与白描工笔比例。',
            foreshadow: '伏笔段落优先模仿"看似随意"的细节植入节奏。',
            conflict: '冲突段落优先模仿冲突词频率与转折句密度。',
            resolution: '收束段落优先模仿情绪落点与节奏放缓。',
            surprise: '意外段落优先模仿反转句式与节奏突变。',
        };
        return tips[sceneType] || null;
    }

    /** 情绪 → 针对性提示 */
    private getEmotionTip(tone: 'positive' | 'negative' | 'mixed', intensity: number): string | null {
        const level = intensity > 0.7 ? '强' : '中等';
        if (tone === 'positive') return `当前情绪偏正向（${level}），参考指纹中正向情绪词的密度与节奏。`;
        if (tone === 'negative') return `当前情绪偏负向（${level}），参考指纹中负向情绪词与压抑句式的张力。`;
        if (tone === 'mixed') return `当前情绪复杂交错，参考指纹中情绪转折句的写法。`;
        return null;
    }

    /** 字符串数组截断到指定总长度（按尾部丢弃） */
    private truncateTo(parts: string[], maxLength: number): string[] {
        if (maxLength <= 0) return [];
        let total = 0;
        const result: string[] = [];
        for (const p of parts) {
            if (total + p.length > maxLength) {
                // 截断当前字符串到剩余空间
                const remaining = maxLength - total;
                if (remaining > 10) {
                    result.push(p.slice(0, remaining));
                }
                break;
            }
            result.push(p);
            total += p.length;
        }
        return result;
    }

    /** 计算字符串数组的总长度 */
    private calcTotalLength(parts: string[]): number {
        return parts.reduce((sum, s) => sum + s.length, 0);
    }

    /** 组装最终输出（带分级标题） */
    private assembleOutput(globalTier: string[], paragraphTier: string[], sentenceTier: string[]): string[] {
        const result: string[] = [];
        if (globalTier.length > 0) result.push(...globalTier);
        if (paragraphTier.length > 0) result.push(...paragraphTier);
        if (sentenceTier.length > 0) result.push(...sentenceTier);
        return result;
    }
}

// ============================================================
// 六、便捷工厂函数
// ============================================================

/**
 * 创建默认的动态注入引擎组合
 * - 三个组件无状态，可全局复用
 */
export function createDynamicInjectionEngine(): {
    analyzer: ContextAnalyzer;
    selector: DynamicSampleSelector;
    builder: TieredInjectionBuilder;
} {
    return {
        analyzer: new ContextAnalyzer(),
        selector: new DynamicSampleSelector(),
        builder: new TieredInjectionBuilder(),
    };
}

/** 获取默认强度配置（用于未传入 intensityConfigs 时的兜底） */
function getDefaultIntensityConfig(): StyleIntensityConfig {
    return { ...DEFAULT_INTENSITY_CONFIG };
}
