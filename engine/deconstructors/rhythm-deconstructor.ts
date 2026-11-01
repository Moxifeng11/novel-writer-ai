/**
 * rhythm-deconstructor.ts — 节奏分析拆解器（纯统计）
 *
 * 功能：基于纯统计方法分析小说节奏，提供情绪曲线、关键情绪点、
 *       剧情阶段划分、结构理论匹配度、爽点分布等多维度分析结果
 * 性能：10万字取样 + async 协作式让出，避免长文本阻塞主线程
 */

import { kbBookRhythmAnalysisFile } from '../../shared/paths';
import { isChineseChar } from '../../shared/text-utils';
import { countCjkWordsAndNumbers } from '../../shared/word-count';
import { yieldToUI } from '../../shared/yield';
import { EMOTION_WORDS, HOOK_WORDS } from '../dimension-keywords';
import { LLMEnhancer, LLM_DEGRADED } from '../llm-enhancer';
import { GenreDetector, GenreConfigRegistry, GenreConfig, TensionKeywords } from '../genre';
import { createLogger } from '../../shared/logger';


const log = createLogger('RhythmDeconstructor');
export type EmotionPointType = 'small_climax' | 'big_climax' | 'trough' | 'reversal' | 'suspense';

export type HookType = 'suspense' | 'foreshadow' | 'conflict';

export type TensionEventType = 'conflict' | 'suspense' | 'reversal' | 'cool_point' | 'setback' | 'climax';

export interface TensionPoint {
    chapterIndex: number;
    position: number;
    intensity: number;
    type: TensionEventType;
    excerpt: string;
    matchedWords: string[];
}

export interface TensionCurveResult {
    points: TensionPoint[];
    chapterTensions: number[];
    overallTensionAvg: number;
    overallTensionStd: number;
    peaks: Array<{
        chapterIndex: number;
        intensity: number;
        type: string;
    }>;
    valleys: Array<{
        chapterIndex: number;
        intensity: number;
    }>;
    waveformScore: number;
}

export interface ChapterHook {
    chapterIndex: number;
    chapterTitle?: string;
    type: HookType;
    intensity: number;
    excerpt: string;
    matchedWords: string[];
}

export interface HookAnalysisResult {
    hooks: ChapterHook[];
    totalChapters: number;
    hookRate: number;
    typeDistribution: Record<HookType, number>;
    noHookChapters: number[];
    avgIntensity: number;
}

export interface EmotionPoint {
    position: number;
    chapterIndex?: number;
    paragraphIndex: number;
    type: EmotionPointType;
    intensity: number;
    description: string;
    excerpt?: string;
    eventDescription?: string;
}

export interface RhythmDataPoint {
    position: number;
    chapterIndex?: number;
    paragraphIndex: number;
    emotionIntensity: number;
    eventDensity: number;
    dialogueRatio: number;
    actionDensity: number;
    overallRhythm: number;
}

export type PlotStage = 'foreshadowing' | 'development' | 'small_climax' | 'big_climax' | 'ending';

export interface PlotStageSegment {
    type: PlotStage;
    startPosition: number;
    endPosition: number;
    description: string;
}

export interface StructureMatch {
    name: string;
    matchScore: number;
    description: string;
}

export interface CoolPoint {
    position: number;
    type: string;
    intensity: number;
    excerpt?: string;
}

export interface MainThreadSwitch {
    position: number;
    type: 'main' | 'sub';
    description: string;
}

export type EmotionArcType =
    | 'rags_to_riches'
    | 'riches_to_rags'
    | 'man_in_hole'
    | 'icarus'
    | 'cinderella'
    | 'oedipus'
    | 'steady'
    | 'complex';

export interface EmotionArcResult {
    arcType: EmotionArcType;
    confidence: number;
    chapterEmotions: number[];
    segments: Array<{
        startChapter: number;
        endChapter: number;
        trend: 'rising' | 'falling' | 'stable';
        avgEmotion: number;
    }>;
    description: string;
}

export type NRCEmotion = 'anger' | 'anticipation' | 'disgust' | 'fear' | 'joy' | 'sadness' | 'surprise' | 'trust';

export interface NRCEmotionResult {
    overallDistribution: Record<NRCEmotion, number>;
    chapterDistribution: Array<Record<NRCEmotion, number>>;
    dominantEmotion: NRCEmotion;
    emotionVolatility: number;
    emotionTransitions: Array<{
        fromChapter: number;
        toChapter: number;
        from: NRCEmotion;
        to: NRCEmotion;
    }>;
}

export interface RhythmCurveResult {
    chapterScores: number[];
    avgScore: number;
    rhythmPattern: 'fast' | 'medium' | 'slow' | 'irregular';
    paceChanges: Array<{
        chapterIndex: number;
        fromPace: 'fast' | 'medium' | 'slow';
        toPace: 'fast' | 'medium' | 'slow';
    }>;
    description: string;
}

export interface RhythmAnalysisResult {
    emotionCurve: RhythmDataPoint[];
    emotionPoints: EmotionPoint[];
    plotStages: PlotStageSegment[];
    structureMatches: StructureMatch[];
    coolPoints: { position: number; type: string; intensity: number }[];
    mainThreadSwitches: { position: number; type: 'main' | 'sub'; description: string }[];
    hooks?: ChapterHook[];
    hookAnalysis?: HookAnalysisResult;
    tensionCurve?: TensionCurveResult;
    emotionArc?: EmotionArcResult;
    nrcEmotion?: NRCEmotionResult;
    rhythmCurve?: RhythmCurveResult;
    stats: {
        avgRhythm: number;
        rhythmVariance: number;
        climaxCount: number;
        coolPointCount: number;
        avgEmotionIntensity: number;
        hookRate?: number;
        chapterHookCount?: number;
        avgTension?: number;
        tensionStd?: number;
        waveformScore?: number;
        tensionPeakCount?: number;
        tensionValleyCount?: number;
    };
}

const POSITIVE_EMOTION_WORDS = [
    '开心', '高兴', '喜悦', '兴奋', '激动', '幸福', '满足', '骄傲', '自豪', '感动',
    '温暖', '舒服', '畅快', '痛快', '爽', '厉害', '牛逼', '牛', '666', '太强了',
    '无敌', '霸气', '装逼', '打脸', '升级', '突破', '成功', '胜利', '赢了', '大胜',
    '凯旋', '狂喜', '惊喜', '欣慰', '得意', '扬眉吐气', '一鸣惊人', '势如破竹',
    'happy', 'excited', 'joyful', 'great', 'awesome', 'amazing', 'cool', 'win', 'victory'
];

const NEGATIVE_EMOTION_WORDS = [
    '难过', '伤心', '悲伤', '痛苦', '绝望', '愤怒', '生气', '害怕', '恐惧', '紧张',
    '焦虑', '担忧', '郁闷', '烦躁', '委屈', '不甘', '悔恨', '遗憾', '失落', '孤独',
    '寂寞', '绝望', '崩溃', '心碎', '痛哭', '惨死', '惨烈', '惨败', '耻辱', '憋屈',
    '咬牙切齿', '心如刀割', '万念俱灰', '走投无路',
    'sad', 'angry', 'afraid', 'scared', 'worried', 'painful', 'sorrow', 'grief', 'lost'
];

const ACTION_VERBS = [
    '冲', '打', '杀', '砍', '劈', '撞', '跃', '跳', '跑', '追',
    '逃', '躲', '闪', '挡', '攻', '防', '击', '踢', '摔', '推',
    '拉', '抓', '捏', '握', '挥', '斩', '刺', '砸', '甩', '蹬',
    '踹', '扑', '咬', '撕', '扯', '拽', '按', '压', '顶', '撞',
    'fight', 'attack', 'run', 'jump', 'strike', 'hit', 'kill', 'chase', 'escape'
];

const COOL_POINT_KEYWORDS: { type: string; words: string[] }[] = [
    { type: '打脸', words: ['打脸', '耳光', '啪啪', '当场', '傻眼', '震惊', '不敢相信', '目瞪口呆'] },
    { type: '升级', words: ['升级', '突破', '进阶', '顿悟', '修为大进', '实力暴涨', '突破瓶颈'] },
    { type: '装逼', words: ['装逼', '霸气', '傲视', '不屑', '淡然', '微微一笑', '不过如此'] },
    { type: '扮猪吃虎', words: ['扮猪吃虎', '深藏不露', '隐藏实力', '低调', '不起眼', '没想到'] },
    { type: '反杀', words: ['反杀', '逆转', '翻盘', '绝地反击', '以弱胜强', '逆袭'] },
    { type: '收获', words: ['获得', '得到', '收获', '宝物', '秘籍', '功法', '天材地宝'] }
];

/**
 * 通用兜底节奏强度关键词（跨题材通用，与具体题材无关）。
 *
 * 题材相关词（如修仙"斗法渡劫"、言情"告白破镜重圆"、悬疑"线索真相"）
 * 通过 genre.json 的 tensionKeywords 字段注入，由 updateTensionSetsFromGenre
 * 在 analyze 时按 GenreDetector 识别结果动态合并到 tensionSets。
 *
 * 合并策略：题材词 + 通用词（并集，保留通用词保证基础覆盖）。
 */
const TENSION_KEYWORDS: Record<TensionEventType, string[]> = {
    conflict: [
        '战斗', '对决', '交手', '厮杀', '激战', '交锋', '对阵', '决斗', '单挑', '大战',
        '攻城', '冲锋', '搏斗', '格斗', '争斗', '大打出手', '拳脚相加', '兵戎相见',
        '争吵', '争执', '对峙', '怒视', '呵斥', '斥责', '怒吼', '咆哮', '怒斥', '厉声',
        '怒不可遏', '火冒三丈', '勃然大怒'
    ],
    suspense: [
        '究竟', '到底', '难道', '殊不知', '未曾想', '没想到', '竟然', '居然', '神秘', '诡异',
        '蹊跷', '古怪', '不对劲', '可疑', '离奇', '怪异', '奇特', '诡异', '匪夷所思',
        '不可思议', '难以想象', '难以置信', '真相', '谜团', '疑团', '悬念', '疑惑', '困惑'
    ],
    reversal: [
        '然而', '但是', '不料', '没想到', '谁知', '岂料', '哪知', '转念一想', '就在这时',
        '突然', '骤然', '猝然', '陡然', '蓦然', '忽然', '猛然', '出乎意料', '意料之外',
        '始料未及', '意想不到', '反转', '逆转', '翻盘', '峰回路转', '柳暗花明'
    ],
    cool_point: [
        '大胜', '完胜', '反杀', '打脸', '碾压', '秒杀', '横扫', '摧枯拉朽', '势如破竹',
        '所向披靡', '扬眉吐气', '大快人心', '痛快', '爽', '厉害', '牛逼', '无敌', '霸气',
        '装逼', '突破', '升级', '顿悟', '修为大进', '实力暴涨', '扮猪吃虎', '深藏不露'
    ],
    setback: [
        '惨败', '大败', '溃败', '失利', '受伤', '重伤', '陨落', '牺牲', '损失', '代价',
        '噩耗', '惨败', '溃败', '败退', '败北', '失利', '受挫', '挫败', '打击', '重创',
        '心如刀割', '万念俱灰', '走投无路', '绝望', '崩溃', '心碎', '痛苦', '悲伤'
    ],
    climax: [
        '决战', '终极', '最终', '生死之战', '宿命对决', '终极一战', '大结局', '终局',
        '巅峰对决', '最后一战', '决一死战', '生死关头', '千钧一发', '命悬一线',
        '生死存亡', '背水一战', '破釜沉舟', '孤注一掷'
    ]
};

const SCENE_SWITCH_KEYWORDS = [
    '话说', '却说', '与此同时', '另一边', '此时', '此刻', '在那',
    '镜头一转', '画面切换', '转场', '与此同时', '另一边', '且说',
    'meanwhile', 'on the other side', 'at the same time'
];

const EMOTION_POINT_TYPE_REFERENCES: { type: EmotionPointType; label: string; text: string }[] = [
    { type: 'small_climax', label: '小高潮', text: '精彩的对决 胜利的喜悦 突破瓶颈 小胜 阶段性成果' },
    { type: 'big_climax', label: '大高潮', text: '最终决战 生死关头 惊天逆转 最高潮 最终的胜利' },
    { type: 'trough', label: '低谷', text: '绝望 失败 跌入谷底 最黑暗的时刻 众叛亲离' },
    { type: 'reversal', label: '反转', text: '意想不到的转折 真相大白 居然是这样 出乎意料' },
    { type: 'suspense', label: '悬念', text: '谜团 疑惑 究竟是谁 真相是什么 等待揭晓' }
];

const POSITIVE_EMOTION_REFERENCE = '非常高兴 兴奋 激动 畅快 满足 幸福';
const NEGATIVE_EMOTION_REFERENCE = '悲伤 难过 痛苦 绝望 愤怒 恐惧';

export class RhythmDeconstructor {
    private positiveSet: Set<string>;
    private negativeSet: Set<string>;
    private actionSet: Set<string>;
    private vectorEnhancer: any;
    private llmEnhancer?: LLMEnhancer;

    private suspenseSet: Set<string>;
    private foreshadowSet: Set<string>;
    private conflictSet: Set<string>;

    private tensionSets: Record<TensionEventType, Set<string>>;
    private adaptiveGenreConfig?: GenreConfig;
    private genreDetector?: GenreDetector;

    private nrcEmotionSets: Record<NRCEmotion, Set<string>>;
    private nrcPositiveSet: Set<string>;
    private nrcNegativeSet: Set<string>;
    private emotionAllSet: Set<string>;

    constructor(vectorEnhancer?: any) {
        this.positiveSet = new Set(POSITIVE_EMOTION_WORDS);
        this.negativeSet = new Set(NEGATIVE_EMOTION_WORDS);
        this.actionSet = new Set(ACTION_VERBS);
        this.suspenseSet = new Set(HOOK_WORDS.suspense);
        this.foreshadowSet = new Set(HOOK_WORDS.foreshadow);
        this.conflictSet = new Set(HOOK_WORDS.conflict);
        this.tensionSets = {
            conflict: new Set(TENSION_KEYWORDS.conflict),
            suspense: new Set(TENSION_KEYWORDS.suspense),
            reversal: new Set(TENSION_KEYWORDS.reversal),
            cool_point: new Set(TENSION_KEYWORDS.cool_point),
            setback: new Set(TENSION_KEYWORDS.setback),
            climax: new Set(TENSION_KEYWORDS.climax)
        };
        this.nrcEmotionSets = {
            anger: new Set(EMOTION_WORDS.anger),
            anticipation: new Set(EMOTION_WORDS.anticipation),
            disgust: new Set(EMOTION_WORDS.disgust),
            fear: new Set(EMOTION_WORDS.fear),
            joy: new Set(EMOTION_WORDS.joy),
            sadness: new Set(EMOTION_WORDS.sadness),
            surprise: new Set(EMOTION_WORDS.surprise),
            trust: new Set(EMOTION_WORDS.trust)
        };
        this.nrcPositiveSet = new Set<string>([
            ...EMOTION_WORDS.joy,
            ...EMOTION_WORDS.trust,
            ...EMOTION_WORDS.anticipation,
            ...EMOTION_WORDS.surprise
        ]);
        this.nrcNegativeSet = new Set<string>([
            ...EMOTION_WORDS.anger,
            ...EMOTION_WORDS.disgust,
            ...EMOTION_WORDS.fear,
            ...EMOTION_WORDS.sadness
        ]);
        this.emotionAllSet = new Set<string>([
            ...this.nrcPositiveSet,
            ...this.nrcNegativeSet
        ]);
        this.vectorEnhancer = vectorEnhancer;
    }

    /**
     * 题材自适应：按 GenreDetector 识别结果合并题材相关 tensionKeywords 到 tensionSets。
     *
     * 合并策略：题材词 + 通用词（并集）。题材词追加到通用兜底词集合，保留通用词保证基础覆盖。
     * 未识别题材或 genre.json 未提供 tensionKeywords 时，保持通用兜底不变。
     * 幂等：重复调用不会重复追加（基于 adaptiveGenreConfig.genreId 去重）。
     */
    private updateTensionSetsFromGenre(text: string): void {
        if (!text || this.adaptiveGenreConfig) return;
        try {
            if (!this.genreDetector) {
                this.genreDetector = new GenreDetector();
            }
            const detection = this.genreDetector.detect(text);
            if (!detection.genreId || detection.genreId === 'generic') {
                return;
            }
            const config = GenreConfigRegistry.getInstance().getGenreConfig(detection.genreId);
            if (!config || !config.tensionKeywords) {
                return;
            }
            this.adaptiveGenreConfig = config;
            const genreTension: TensionKeywords = config.tensionKeywords;
            const types: TensionEventType[] = ['conflict', 'suspense', 'reversal', 'cool_point', 'setback', 'climax'];
            for (const type of types) {
                const genreWords = genreTension[type] || [];
                for (const word of genreWords) {
                    this.tensionSets[type].add(word);
                }
            }
        } catch (e) {
            // 题材识别失败时静默降级，保持通用兜底行为
            log.warn('[RhythmDeconstructor] 题材识别失败，使用通用 tensionKeywords', e);
        }
    }

    async detectChapterHooks(text: string): Promise<HookAnalysisResult> {
        if (!text || text.length === 0) {
            return {
                hooks: [],
                totalChapters: 0,
                hookRate: 0,
                typeDistribution: { suspense: 0, foreshadow: 0, conflict: 0 },
                noHookChapters: [],
                avgIntensity: 0
            };
        }

        const chapters = this.splitChapters(text);
        const totalChapters = chapters.length;

        if (totalChapters === 0) {
            return {
                hooks: [],
                totalChapters: 0,
                hookRate: 0,
                typeDistribution: { suspense: 0, foreshadow: 0, conflict: 0 },
                noHookChapters: [],
                avgIntensity: 0
            };
        }

        const hooks: ChapterHook[] = [];
        const noHookChapters: number[] = [];
        const typeDistribution: Record<HookType, number> = {
            suspense: 0,
            foreshadow: 0,
            conflict: 0
        };

        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            const chapterText = text.slice(ch.startIndex, ch.endIndex);
            const endRegion = chapterText.slice(-200);
            const wordCount = countCjkWordsAndNumbers(endRegion);

            const chapterTitleMatch = chapterText.match(/第[一二三四五六七八九十百千零\d]+[章节部卷][^\n]*/);
            const chapterTitle = chapterTitleMatch ? chapterTitleMatch[0].trim() : undefined;

            const suspenseResult = this.calculateHookIntensity(endRegion, wordCount, this.suspenseSet, 'suspense');
            const foreshadowResult = this.calculateHookIntensity(endRegion, wordCount, this.foreshadowSet, 'foreshadow');
            const conflictResult = this.calculateHookIntensity(endRegion, wordCount, this.conflictSet, 'conflict');

            const results = [suspenseResult, foreshadowResult, conflictResult];
            results.sort((a, b) => b.intensity - a.intensity);

            const bestResult = results[0];
            if (bestResult.intensity > 0.15) {
                typeDistribution[bestResult.type]++;
                hooks.push({
                    chapterIndex: ch.index,
                    chapterTitle,
                    type: bestResult.type,
                    intensity: this.clamp01(bestResult.intensity),
                    excerpt: endRegion.length > 100 ? endRegion.slice(-100) : endRegion,
                    matchedWords: bestResult.matchedWords
                });
            } else {
                noHookChapters.push(ch.index);
            }

            if (i % 5 === 0) {
                await yieldToUI();
            }
        }

        const hookRate = totalChapters > 0 ? hooks.length / totalChapters : 0;
        const avgIntensity = hooks.length > 0
            ? hooks.reduce((sum, h) => sum + h.intensity, 0) / hooks.length
            : 0;

        return {
            hooks,
            totalChapters,
            hookRate: this.round2(hookRate),
            typeDistribution,
            noHookChapters,
            avgIntensity: this.round2(avgIntensity)
        };
    }

    private calculateHookIntensity(
        text: string,
        wordCount: number,
        wordSet: Set<string>,
        type: HookType
    ): { type: HookType; intensity: number; matchedWords: string[] } {
        const matchedWords: string[] = [];
        let matchCount = 0;

        for (const word of wordSet) {
            if (text.includes(word)) {
                matchedWords.push(word);
                const count = (text.match(new RegExp(word, 'g')) || []).length;
                matchCount += count;
            }
        }

        const keywordDensity = Math.min(1, matchCount / Math.max(wordCount * 0.02, 1));

        const questionMarkCount = (text.match(/[？?]/g) || []).length;
        const exclamationMarkCount = (text.match(/[！!]/g) || []).length;
        const punctuationScore = Math.min(1, (questionMarkCount * 2 + exclamationMarkCount) / Math.max(wordCount * 0.03, 1));

        const textLength = text.length;
        const positionWeights: number[] = [];
        for (const word of matchedWords) {
            let idx = 0;
            while ((idx = text.indexOf(word, idx)) !== -1) {
                const position = idx / Math.max(textLength - 1, 1);
                positionWeights.push(position);
                idx += word.length;
            }
        }

        let positionWeight = 0.5;
        if (positionWeights.length > 0) {
            const avgPosition = positionWeights.reduce((a, b) => a + b, 0) / positionWeights.length;
            positionWeight = avgPosition;
        }

        const intensity = 0.4 * keywordDensity + 0.3 * punctuationScore + 0.3 * positionWeight;

        return { type, intensity, matchedWords: matchedWords.slice(0, 10) };
    }

    async calculateTensionCurve(text: string): Promise<TensionCurveResult> {
        if (!text || text.length === 0) {
            return this.getEmptyTensionResult();
        }

        const paragraphs = this.splitParagraphs(text);
        const chapters = this.splitChapters(text);
        const totalLength = text.length;

        if (paragraphs.length === 0) {
            return this.getEmptyTensionResult();
        }

        const points: TensionPoint[] = [];
        const chapterTensions: number[] = chapters.length > 0
            ? new Array(chapters.length).fill(0)
            : [];
        const chapterPointCounts: number[] = chapters.length > 0
            ? new Array(chapters.length).fill(0)
            : [];

        let charOffset = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraStart = text.indexOf(para, charOffset);
            const position = totalLength > 0 ? paraStart / totalLength : 0;

            const chapterIndex = this.findChapterIndex(paraStart, chapters);
            const wordCount = countCjkWordsAndNumbers(para);

            const tensionResult = this.calculateTensionIntensity(para, wordCount);

            if (tensionResult.intensity > 0.2) {
                points.push({
                    chapterIndex: chapterIndex ?? 0,
                    position: this.clamp01(position),
                    intensity: this.clamp01(tensionResult.intensity),
                    type: tensionResult.type,
                    excerpt: para.slice(0, 100),
                    matchedWords: tensionResult.matchedWords.slice(0, 5)
                });
            }

            if (chapterIndex !== undefined && chapters.length > 0) {
                chapterTensions[chapterIndex] += tensionResult.intensity;
                chapterPointCounts[chapterIndex]++;
            }

            charOffset = paraStart + para.length;

            if (i % 20 === 0) {
                await yieldToUI();
            }
        }

        for (let i = 0; i < chapterTensions.length; i++) {
            if (chapterPointCounts[i] > 0) {
                chapterTensions[i] = chapterTensions[i] / chapterPointCounts[i];
            }
        }

        const allIntensities = points.length > 0
            ? points.map(p => p.intensity)
            : [0];
        const overallTensionAvg = allIntensities.reduce((a, b) => a + b, 0) / allIntensities.length;
        const overallTensionStd = Math.sqrt(
            allIntensities.reduce((a, b) => a + (b - overallTensionAvg) ** 2, 0) / allIntensities.length
        );

        const smoothedChapterTensions = this.smoothChapterTensions(chapterTensions);
        const { peaks, valleys } = this.detectTensionPeaksValleys(smoothedChapterTensions, points);
        const waveformScore = this.calculateWaveformScore(
            smoothedChapterTensions,
            overallTensionStd,
            peaks.length,
            valleys.length
        );

        return {
            points: points.sort((a, b) => a.position - b.position),
            chapterTensions: smoothedChapterTensions,
            overallTensionAvg: this.round2(overallTensionAvg),
            overallTensionStd: this.round2(overallTensionStd),
            peaks,
            valleys,
            waveformScore: this.round2(waveformScore)
        };
    }

    private getEmptyTensionResult(): TensionCurveResult {
        return {
            points: [],
            chapterTensions: [],
            overallTensionAvg: 0,
            overallTensionStd: 0,
            peaks: [],
            valleys: [],
            waveformScore: 0
        };
    }

    private calculateTensionIntensity(
        text: string,
        wordCount: number
    ): { type: TensionEventType; intensity: number; matchedWords: string[] } {
        const types: TensionEventType[] = ['conflict', 'suspense', 'reversal', 'cool_point', 'setback', 'climax'];
        const results: Array<{ type: TensionEventType; intensity: number; matchedWords: string[] }> = [];

        for (const type of types) {
            const result = this.calculateSingleTensionType(text, wordCount, type);
            results.push(result);
        }

        results.sort((a, b) => b.intensity - a.intensity);
        return results[0];
    }

    private calculateSingleTensionType(
        text: string,
        wordCount: number,
        type: TensionEventType
    ): { type: TensionEventType; intensity: number; matchedWords: string[] } {
        const wordSet = this.tensionSets[type];
        const matchedWords: string[] = [];
        let matchCount = 0;

        for (const word of wordSet) {
            if (text.includes(word)) {
                matchedWords.push(word);
                const count = (text.match(new RegExp(word, 'g')) || []).length;
                matchCount += count;
            }
        }

        const keywordDensity = Math.min(1, matchCount / Math.max(wordCount * 0.02, 1));

        const questionMarkCount = (text.match(/[？?]/g) || []).length;
        const exclamationMarkCount = (text.match(/[！!]/g) || []).length;
        const punctuationScore = Math.min(1, (questionMarkCount * 2 + exclamationMarkCount) / Math.max(wordCount * 0.03, 1));

        const textLength = text.length;
        let contextWeight = 0.5;

        if (type === 'climax') {
            const climaxBonus = keywordDensity > 0 ? 0.2 : 0;
            contextWeight = Math.min(1, 0.5 + climaxBonus);
        } else if (type === 'cool_point') {
            const coolBonus = keywordDensity > 0.1 ? 0.15 : 0;
            contextWeight = Math.min(1, 0.5 + coolBonus);
        }

        let intensity = 0.5 * keywordDensity + 0.3 * punctuationScore + 0.2 * contextWeight;

        if (type === 'climax' && keywordDensity > 0.1) {
            intensity = Math.min(1, intensity * 1.2);
        }

        return {
            type,
            intensity: this.clamp01(intensity),
            matchedWords: matchedWords.slice(0, 10)
        };
    }

    private smoothChapterTensions(chapterTensions: number[]): number[] {
        if (chapterTensions.length < 3) return chapterTensions;

        const smoothed: number[] = [];
        const windowSize = Math.min(1, Math.floor(chapterTensions.length / 10));

        for (let i = 0; i < chapterTensions.length; i++) {
            let sum = 0;
            let count = 0;

            for (let j = Math.max(0, i - windowSize); j <= Math.min(chapterTensions.length - 1, i + windowSize); j++) {
                const weight = 1 - Math.abs(j - i) / (windowSize + 1);
                sum += chapterTensions[j] * weight;
                count += weight;
            }

            smoothed.push(sum / count);
        }

        return smoothed;
    }

    private detectTensionPeaksValleys(
        chapterTensions: number[],
        points: TensionPoint[]
    ): {
        peaks: Array<{ chapterIndex: number; intensity: number; type: string }>;
        valleys: Array<{ chapterIndex: number; intensity: number }>;
    } {
        const peaks: Array<{ chapterIndex: number; intensity: number; type: string }> = [];
        const valleys: Array<{ chapterIndex: number; intensity: number }> = [];

        if (chapterTensions.length < 5) {
            return { peaks, valleys };
        }

        const mean = chapterTensions.reduce((a, b) => a + b, 0) / chapterTensions.length;
        const std = Math.sqrt(
            chapterTensions.reduce((a, b) => a + (b - mean) ** 2, 0) / chapterTensions.length
        );

        const peakThreshold = Math.max(0.6, mean + std * 0.5);
        const valleyThreshold = Math.min(0.3, mean - std * 0.3);

        for (let i = 1; i < chapterTensions.length - 1; i++) {
            const prev = chapterTensions[i - 1];
            const curr = chapterTensions[i];
            const next = chapterTensions[i + 1];

            const isLocalMax = curr > prev && curr > next && curr > peakThreshold;
            const isLocalMin = curr < prev && curr < next && curr < valleyThreshold;

            if (isLocalMax) {
                const chapterPoints = points.filter(p => p.chapterIndex === i);
                let dominantType = 'conflict';
                if (chapterPoints.length > 0) {
                    const typeCount: Record<string, number> = {};
                    for (const p of chapterPoints) {
                        typeCount[p.type] = (typeCount[p.type] || 0) + 1;
                    }
                    dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'conflict';
                }
                peaks.push({
                    chapterIndex: i,
                    intensity: this.round2(curr),
                    type: dominantType
                });
            } else if (isLocalMin) {
                valleys.push({
                    chapterIndex: i,
                    intensity: this.round2(curr)
                });
            }
        }

        return { peaks, valleys };
    }

    private calculateWaveformScore(
        chapterTensions: number[],
        std: number,
        peakCount: number,
        valleyCount: number
    ): number {
        if (chapterTensions.length < 3) return 0;

        const chapterCount = chapterTensions.length;

        const stdScore = this.calculateStdScore(std);

        const peakRatio = chapterCount > 0 ? peakCount / chapterCount : 0;
        const idealPeakRatio = 0.15;
        const peakScore = Math.max(0, 100 - Math.abs(peakRatio - idealPeakRatio) * 500);

        let rhythmScore = 0;
        if (peakCount >= 2) {
            const peakPositions: number[] = [];
            for (let i = 0; i < chapterTensions.length; i++) {
                if (chapterTensions[i] > 0.6) {
                    peakPositions.push(i);
                }
            }
            if (peakPositions.length >= 2) {
                const intervals: number[] = [];
                for (let i = 1; i < peakPositions.length; i++) {
                    intervals.push(peakPositions[i] - peakPositions[i - 1]);
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const intervalVariance = intervals.reduce((a, b) => a + (b - avgInterval) ** 2, 0) / intervals.length;
                const intervalStd = Math.sqrt(intervalVariance);
                const regularity = avgInterval > 0 ? 1 - Math.min(1, intervalStd / avgInterval) : 0;
                rhythmScore = regularity * 100;
            }
        } else {
            rhythmScore = peakCount > 0 ? 30 : 0;
        }

        const score = stdScore * 0.4 + peakScore * 0.3 + rhythmScore * 0.3;
        return Math.max(0, Math.min(100, score));
    }

    private calculateStdScore(std: number): number {
        const idealStd = 0.2;
        const stdDeviation = Math.abs(std - idealStd);
        const maxDeviation = 0.3;

        if (stdDeviation > maxDeviation) {
            return 20;
        }

        return 100 - (stdDeviation / maxDeviation) * 80;
    }

    async detectEmotionArc(text: string): Promise<EmotionArcResult> {
        if (!text || text.length === 0) {
            return this.getEmptyEmotionArcResult();
        }

        const chapters = this.splitChapters(text);
        if (chapters.length === 0) {
            return this.getEmptyEmotionArcResult();
        }

        const chapterEmotions: number[] = [];
        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            const chapterText = text.slice(ch.startIndex, ch.endIndex);
            chapterEmotions.push(this.calculateChapterEmotionValue(chapterText));
            if (i % 5 === 0) {
                await yieldToUI();
            }
        }

        if (chapterEmotions.length < 2) {
            return {
                arcType: 'steady',
                confidence: 0.3,
                chapterEmotions,
                segments: [],
                description: '章节数不足，无法识别情感弧原型'
            };
        }

        const mean = chapterEmotions.reduce((a, b) => a + b, 0) / chapterEmotions.length;
        const variance = chapterEmotions.reduce((a, b) => a + (b - mean) ** 2, 0) / chapterEmotions.length;

        if (variance < 0.1) {
            const confidence = Math.max(0.5, this.clamp01(1 - variance * 5));
            return {
                arcType: 'steady',
                confidence: this.round2(confidence),
                chapterEmotions: chapterEmotions.map(v => this.round2(v)),
                segments: this.splitEmotionSegments(chapterEmotions),
                description: `情感波动平稳（方差 ${variance.toFixed(3)}），全书情绪稳定`
            };
        }

        const segments = this.splitEmotionSegments(chapterEmotions);
        const { arcType, confidence, description } = this.matchEmotionArcType(segments);

        return {
            arcType,
            confidence: this.round2(confidence),
            chapterEmotions: chapterEmotions.map(v => this.round2(v)),
            segments,
            description
        };
    }

    private getEmptyEmotionArcResult(): EmotionArcResult {
        return {
            arcType: 'steady',
            confidence: 0,
            chapterEmotions: [],
            segments: [],
            description: '无文本或无章节，无法识别情感弧'
        };
    }

    private calculateChapterEmotionValue(chapterText: string): number {
        const wordCount = countCjkWordsAndNumbers(chapterText);
        const positiveCount = this.countWordOccurrences(chapterText, this.nrcPositiveSet);
        const negativeCount = this.countWordOccurrences(chapterText, this.nrcNegativeSet);
        const raw = positiveCount - negativeCount;
        const normalized = raw / Math.max(wordCount * 0.05, 1);
        return Math.max(-1, Math.min(1, normalized));
    }

    private splitEmotionSegments(chapterEmotions: number[]): Array<{
        startChapter: number;
        endChapter: number;
        trend: 'rising' | 'falling' | 'stable';
        avgEmotion: number;
    }> {
        const n = chapterEmotions.length;
        if (n < 2) return [];

        const numSegments = Math.min(4, Math.max(2, Math.floor(n / 5)));
        const segSize = Math.floor(n / numSegments);
        const segments: Array<{
            startChapter: number;
            endChapter: number;
            trend: 'rising' | 'falling' | 'stable';
            avgEmotion: number;
        }> = [];

        let start = 0;
        for (let s = 0; s < numSegments; s++) {
            const end = s === numSegments - 1 ? n : start + segSize;
            const segValues = chapterEmotions.slice(start, end);
            if (segValues.length === 0) {
                start = end;
                continue;
            }
            const avgEmotion = segValues.reduce((a, b) => a + b, 0) / segValues.length;
            segments.push({
                startChapter: start,
                endChapter: end - 1,
                trend: this.calculateSegmentTrend(segValues),
                avgEmotion: this.round2(avgEmotion)
            });
            start = end;
        }

        return segments;
    }

    private calculateSegmentTrend(values: number[]): 'rising' | 'falling' | 'stable' {
        if (values.length < 2) return 'stable';
        const mid = Math.floor(values.length / 2);
        const firstAvg = values.slice(0, mid).reduce((a, b) => a + b, 0) / Math.max(mid, 1);
        const secondAvg = values.slice(mid).reduce((a, b) => a + b, 0) / Math.max(values.length - mid, 1);
        const diff = secondAvg - firstAvg;
        const threshold = 0.1;
        if (diff > threshold) return 'rising';
        if (diff < -threshold) return 'falling';
        return 'stable';
    }

    private matchEmotionArcType(
        segments: Array<{ trend: 'rising' | 'falling' | 'stable' }>
    ): { arcType: EmotionArcType; confidence: number; description: string } {
        const trends = segments.map(s => s.trend);
        const nonStableCount = trends.filter(t => t !== 'stable').length;
        const baseConfidence = segments.length > 0 ? nonStableCount / segments.length : 0;

        const arcType = this.classifyArcTrend(trends);

        if (arcType === 'complex') {
            return {
                arcType: 'complex',
                confidence: 0.3,
                description: '情感走势无明显原型匹配，呈复杂波动'
            };
        }

        const confidence = this.clamp01(Math.max(0.4, baseConfidence));
        return {
            arcType,
            confidence,
            description: this.buildArcDescription(arcType, segments)
        };
    }

    private classifyArcTrend(trends: Array<'rising' | 'falling' | 'stable'>): EmotionArcType {
        const allRising = trends.length > 0 && trends.every(t => t === 'rising');
        const allFalling = trends.length > 0 && trends.every(t => t === 'falling');
        if (allRising) return 'rags_to_riches';
        if (allFalling) return 'riches_to_rags';

        if (trends.length === 2) {
            if (trends[0] === 'falling' && trends[1] === 'rising') return 'man_in_hole';
            if (trends[0] === 'rising' && trends[1] === 'falling') return 'icarus';
        }
        if (trends.length === 3) {
            if (trends[0] === 'rising' && trends[1] === 'falling' && trends[2] === 'rising') return 'cinderella';
            if (trends[0] === 'falling' && trends[1] === 'rising' && trends[2] === 'falling') return 'oedipus';
        }

        return 'complex';
    }

    private buildArcDescription(
        arcType: EmotionArcType,
        segments: Array<{ trend: 'rising' | 'falling' | 'stable' }>
    ): string {
        const trendDesc = segments.map(s => this.trendLabel(s.trend)).join(' → ');
        return `${this.emotionArcTypeLabel(arcType)}：${trendDesc}`;
    }

    private trendLabel(trend: 'rising' | 'falling' | 'stable'): string {
        return trend === 'rising' ? '上升' : trend === 'falling' ? '下降' : '平稳';
    }

    /**
     * 注入 LLM 增强器。注入后 analyze 方法末尾会调用 LLM 做语义提炼。
     * 不注入时 analyze 行为完全不变（纯统计）。
     */
    setLLMEnhancer(llmEnhancer?: LLMEnhancer): void {
        this.llmEnhancer = llmEnhancer;
    }

    async analyzeNRCEmotion(text: string): Promise<NRCEmotionResult> {
        if (!text || text.length === 0) {
            return this.getEmptyNRCEmotionResult();
        }

        const chapters = this.splitChapters(text);
        if (chapters.length === 0) {
            return this.getEmptyNRCEmotionResult();
        }

        const chapterDistribution: Array<Record<NRCEmotion, number>> = [];
        const overallCounts = this.emptyNRCDistribution();

        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            const chapterText = text.slice(ch.startIndex, ch.endIndex);
            const counts = this.countNRCWords(chapterText);
            const total = this.sumNRC(counts);

            const dist = this.emptyNRCDistribution();
            if (total > 0) {
                (Object.keys(dist) as NRCEmotion[]).forEach(k => {
                    dist[k] = counts[k] / total;
                });
            } else {
                (Object.keys(dist) as NRCEmotion[]).forEach(k => {
                    dist[k] = 1 / 8;
                });
            }
            chapterDistribution.push(dist);

            (Object.keys(overallCounts) as NRCEmotion[]).forEach(k => {
                overallCounts[k] += counts[k];
            });

            if (i % 5 === 0) {
                await yieldToUI();
            }
        }

        const grandTotal = this.sumNRC(overallCounts);
        const overallDistribution = this.emptyNRCDistribution();
        if (grandTotal > 0) {
            (Object.keys(overallDistribution) as NRCEmotion[]).forEach(k => {
                overallDistribution[k] = overallCounts[k] / grandTotal;
            });
        } else {
            (Object.keys(overallDistribution) as NRCEmotion[]).forEach(k => {
                overallDistribution[k] = 1 / 8;
            });
        }

        const dominantEmotion = this.argmaxEmotion(overallDistribution);
        const chapterDominants = chapterDistribution.map(d => this.argmaxEmotion(d));

        const emotionTransitions: Array<{
            fromChapter: number;
            toChapter: number;
            from: NRCEmotion;
            to: NRCEmotion;
        }> = [];
        let transitionCount = 0;
        for (let i = 1; i < chapterDominants.length; i++) {
            if (chapterDominants[i] !== chapterDominants[i - 1]) {
                transitionCount++;
                emotionTransitions.push({
                    fromChapter: i - 1,
                    toChapter: i,
                    from: chapterDominants[i - 1],
                    to: chapterDominants[i]
                });
            }
        }
        const emotionVolatility = chapterDominants.length > 1
            ? transitionCount / (chapterDominants.length - 1)
            : 0;

        return {
            overallDistribution,
            chapterDistribution,
            dominantEmotion,
            emotionVolatility: this.round2(emotionVolatility),
            emotionTransitions
        };
    }

    private getEmptyNRCEmotionResult(): NRCEmotionResult {
        return {
            overallDistribution: this.emptyNRCDistribution(),
            chapterDistribution: [],
            dominantEmotion: 'joy',
            emotionVolatility: 0,
            emotionTransitions: []
        };
    }

    private emptyNRCDistribution(): Record<NRCEmotion, number> {
        return {
            anger: 0,
            anticipation: 0,
            disgust: 0,
            fear: 0,
            joy: 0,
            sadness: 0,
            surprise: 0,
            trust: 0
        };
    }

    private countNRCWords(chapterText: string): Record<NRCEmotion, number> {
        const counts = this.emptyNRCDistribution();
        (Object.keys(this.nrcEmotionSets) as NRCEmotion[]).forEach(emotion => {
            counts[emotion] = this.countWordOccurrences(chapterText, this.nrcEmotionSets[emotion]);
        });
        return counts;
    }

    private sumNRC(counts: Record<NRCEmotion, number>): number {
        return (Object.keys(counts) as NRCEmotion[]).reduce((sum, k) => sum + counts[k], 0);
    }

    private argmaxEmotion(dist: Record<NRCEmotion, number>): NRCEmotion {
        let best: NRCEmotion = 'joy';
        let bestVal = -Infinity;
        (Object.keys(dist) as NRCEmotion[]).forEach(k => {
            if (dist[k] > bestVal) {
                bestVal = dist[k];
                best = k;
            }
        });
        return best;
    }

    async calculateRhythmCurve(text: string): Promise<RhythmCurveResult> {
        if (!text || text.length === 0) {
            return this.getEmptyRhythmCurveResult();
        }

        const chapters = this.splitChapters(text);
        if (chapters.length === 0) {
            return this.getEmptyRhythmCurveResult();
        }

        const chapterScores: number[] = [];
        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            const chapterText = text.slice(ch.startIndex, ch.endIndex);
            chapterScores.push(this.calculateChapterRhythmScore(chapterText));
            if (i % 5 === 0) {
                await yieldToUI();
            }
        }

        const avgScore = chapterScores.reduce((a, b) => a + b, 0) / Math.max(chapterScores.length, 1);
        const variance = chapterScores.reduce((a, b) => a + (b - avgScore) ** 2, 0) / Math.max(chapterScores.length, 1);
        const std = Math.sqrt(variance);

        let rhythmPattern: 'fast' | 'medium' | 'slow' | 'irregular';
        if (std > 25) {
            rhythmPattern = 'irregular';
        } else if (avgScore > 70) {
            rhythmPattern = 'fast';
        } else if (avgScore < 40) {
            rhythmPattern = 'slow';
        } else {
            rhythmPattern = 'medium';
        }

        const paceChanges: Array<{
            chapterIndex: number;
            fromPace: 'fast' | 'medium' | 'slow';
            toPace: 'fast' | 'medium' | 'slow';
        }> = [];
        for (let i = 1; i < chapterScores.length; i++) {
            if (Math.abs(chapterScores[i] - chapterScores[i - 1]) > 20) {
                paceChanges.push({
                    chapterIndex: i,
                    fromPace: this.paceLabel(chapterScores[i - 1]),
                    toPace: this.paceLabel(chapterScores[i])
                });
            }
        }

        return {
            chapterScores: chapterScores.map(s => this.round2(s)),
            avgScore: this.round2(avgScore),
            rhythmPattern,
            paceChanges,
            description: this.buildRhythmDescription(rhythmPattern, avgScore, std)
        };
    }

    private getEmptyRhythmCurveResult(): RhythmCurveResult {
        return {
            chapterScores: [],
            avgScore: 0,
            rhythmPattern: 'medium',
            paceChanges: [],
            description: '无文本或无章节，无法计算节奏曲线'
        };
    }

    private calculateChapterRhythmScore(chapterText: string): number {
        const wordCount = countCjkWordsAndNumbers(chapterText);
        const eventDensity = this.clamp01(
            this.countWordOccurrences(chapterText, this.actionSet) / Math.max(wordCount * 0.05, 1)
        );
        const dialogueDensity = this.clamp01(this.calculateDialogueRatio(chapterText));
        const paragraphRhythm = this.calculateParagraphRhythm(chapterText);
        const emotionIntensity = this.clamp01(
            this.countWordOccurrences(chapterText, this.emotionAllSet) / Math.max(wordCount * 0.05, 1)
        );
        const score = (0.3 * eventDensity + 0.3 * dialogueDensity + 0.2 * paragraphRhythm + 0.2 * emotionIntensity) * 100;
        return Math.max(0, Math.min(100, score));
    }

    private calculateParagraphRhythm(chapterText: string): number {
        const paragraphs = chapterText.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
        if (paragraphs.length === 0) return 0;
        const shortCount = paragraphs.filter(p => p.length < 50).length;
        return Math.min(1, shortCount / paragraphs.length);
    }

    private paceLabel(score: number): 'fast' | 'medium' | 'slow' {
        if (score > 70) return 'fast';
        if (score < 40) return 'slow';
        return 'medium';
    }

    private buildRhythmDescription(
        pattern: 'fast' | 'medium' | 'slow' | 'irregular',
        avgScore: number,
        std: number
    ): string {
        const labels: Record<typeof pattern, string> = {
            fast: '快速',
            medium: '中等',
            slow: '缓慢',
            irregular: '不规律'
        };
        return `节奏${labels[pattern]}（平均 ${avgScore.toFixed(1)} 分，标准差 ${std.toFixed(1)}）`;
    }

    async analyzeWithVector(text: string): Promise<RhythmAnalysisResult> {
        const baseResult = await this.analyze(text);
        await yieldToUI();

        if (!this.vectorEnhancer || baseResult.emotionCurve.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                return baseResult;
            }
        } catch (e) {
            log.warn('[RhythmDeconstructor] 向量增强不可用，降级为纯统计', e);
            return baseResult;
        }

        let enhancedResult = { ...baseResult };

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceEmotionIntensity(text, enhancedResult);
        } catch (e) {
            log.warn('[RhythmDeconstructor] 情绪强度语义增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceEmotionPoints(enhancedResult);
        } catch (e) {
            log.warn('[RhythmDeconstructor] 情绪点语义分类失败', e);
        }

        return enhancedResult;
    }

    private async enhanceEmotionIntensity(
        text: string,
        result: RhythmAnalysisResult
    ): Promise<RhythmAnalysisResult> {
        const curve = result.emotionCurve;
        if (curve.length < 3) return result;

        const paragraphs = this.splitParagraphs(text);
        if (paragraphs.length === 0) return result;

        const MAX_SAMPLES = 50;
        const sampleStep = 10;
        let sampleIndices: number[] = [];
        for (let i = 0; i < curve.length; i += sampleStep) {
            sampleIndices.push(i);
        }
        if (sampleIndices[sampleIndices.length - 1] !== curve.length - 1) {
            sampleIndices.push(curve.length - 1);
        }
        // 样本数硬上限 50，超出时均匀采样
        if (sampleIndices.length > MAX_SAMPLES) {
            const sampled: number[] = [];
            const step = sampleIndices.length / MAX_SAMPLES;
            for (let i = 0; i < MAX_SAMPLES; i++) {
                const idx = Math.min(sampleIndices.length - 1, Math.floor(i * step));
                sampled.push(sampleIndices[idx]);
            }
            sampleIndices = sampled;
        }

        const validSampleIndices: number[] = [];
        const validSampleTexts: string[] = [];
        for (let i = 0; i < sampleIndices.length; i++) {
            const paraIdx = curve[sampleIndices[i]].paragraphIndex;
            const para = paragraphs[paraIdx] || '';
            if (para.length > 0) {
                validSampleIndices.push(sampleIndices[i]);
                validSampleTexts.push(para);
            }
        }

        if (validSampleTexts.length === 0) return result;

        const allTexts = [POSITIVE_EMOTION_REFERENCE, NEGATIVE_EMOTION_REFERENCE, ...validSampleTexts];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const posVector = allVectors[0];
        const negVector = allVectors[1];
        const sampleVectors = allVectors.slice(2);

        const semanticScores: { index: number; score: number }[] = [];
        let minScore = Infinity;
        let maxScore = -Infinity;

        for (let i = 0; i < validSampleIndices.length; i++) {
            const posSim = this.vectorEnhancer.cosineSimilarity(sampleVectors[i], posVector);
            const negSim = this.vectorEnhancer.cosineSimilarity(sampleVectors[i], negVector);
            const rawScore = Math.abs(posSim - negSim);
            minScore = Math.min(minScore, rawScore);
            maxScore = Math.max(maxScore, rawScore);
            semanticScores.push({ index: validSampleIndices[i], score: rawScore });
        }

        const scoreRange = maxScore - minScore;
        const normalizedScores = semanticScores.map(s => ({
            index: s.index,
            score: scoreRange > 0 ? (s.score - minScore) / scoreRange : 0.5
        }));

        const newCurve = curve.map((point) => ({ ...point }));

        for (let i = 0; i < normalizedScores.length - 1; i++) {
            const start = normalizedScores[i];
            const end = normalizedScores[i + 1];

            for (let j = start.index; j <= end.index; j++) {
                const t = end.index > start.index ? (j - start.index) / (end.index - start.index) : 0;
                const semanticScore = start.score + t * (end.score - start.score);
                const originalIntensity = newCurve[j].emotionIntensity;
                const fusedIntensity = originalIntensity * 0.6 + semanticScore * 0.4;
                newCurve[j].emotionIntensity = this.clamp01(fusedIntensity);
            }
        }

        const newEmotionPoints = result.emotionPoints.map(p => {
            const curvePoint = newCurve.find(c => c.paragraphIndex === p.paragraphIndex);
            if (curvePoint) {
                return { ...p, intensity: this.clamp01(curvePoint.emotionIntensity) };
            }
            return p;
        });

        const newStats = this.calculateStats(newCurve, newEmotionPoints, result.coolPoints, result.hookAnalysis, result.tensionCurve);

        return {
            ...result,
            emotionCurve: newCurve,
            emotionPoints: newEmotionPoints,
            stats: newStats
        };
    }

    private async enhanceEmotionPoints(
        result: RhythmAnalysisResult
    ): Promise<RhythmAnalysisResult> {
        if (result.emotionPoints.length === 0) return result;

        const refTexts = EMOTION_POINT_TYPE_REFERENCES.map(r => r.text);
        const pointExcerpts = result.emotionPoints.map(p => p.excerpt || '');

        const allTexts = [...refTexts, ...pointExcerpts];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const refVectors = allVectors.slice(0, refTexts.length);
        const pointVectors = allVectors.slice(refTexts.length);

        const newPoints = result.emotionPoints.map((point, idx) => {
            const pointVec = pointVectors[idx];
            if (!pointVec) return point;

            let bestType = point.type;
            let bestLabel = point.description;
            let bestScore = -1;

            for (let i = 0; i < EMOTION_POINT_TYPE_REFERENCES.length; i++) {
                const score = this.vectorEnhancer.cosineSimilarity(pointVec, refVectors[i]);
                if (score > bestScore) {
                    bestScore = score;
                    bestType = EMOTION_POINT_TYPE_REFERENCES[i].type;
                    bestLabel = EMOTION_POINT_TYPE_REFERENCES[i].label;
                }
            }

            const intensityBoost = 1 + (bestScore - 0.5) * 0.3;
            const newIntensity = this.clamp01(point.intensity * intensityBoost);
            const description = bestLabel;
            const eventDescription = point.eventDescription
                || this.extractEventDescription(point.excerpt || '');

            return {
                ...point,
                type: bestType,
                intensity: newIntensity,
                description,
                eventDescription
            };
        });

        return {
            ...result,
            emotionPoints: newPoints
        };
    }

    async analyze(text: string): Promise<RhythmAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        // 题材自适应：按 GenreDetector 识别结果合并题材相关 tensionKeywords 到 tensionSets
        this.updateTensionSetsFromGenre(text);

        const paragraphs = this.splitParagraphs(text);
        const chapters = this.splitChapters(text);
        const totalLength = text.length;

        const emotionCurve: RhythmDataPoint[] = [];
        let charOffset = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraStart = text.indexOf(para, charOffset);
            const position = totalLength > 0 ? paraStart / totalLength : 0;

            const chapterIndex = this.findChapterIndex(paraStart, chapters);
            const wordCount = countCjkWordsAndNumbers(para);

            const emotionIntensity = this.calculateEmotionIntensity(para, wordCount);
            const eventDensity = this.calculateEventDensity(para, wordCount);
            const dialogueRatio = this.calculateDialogueRatio(para);
            const actionDensity = this.calculateActionDensity(para, wordCount);

            const overallRhythm = 0.4 * emotionIntensity + 0.3 * eventDensity
                + 0.2 * dialogueRatio + 0.1 * actionDensity;

            emotionCurve.push({
                position: this.clamp01(position),
                chapterIndex,
                paragraphIndex: i,
                emotionIntensity: this.clamp01(emotionIntensity),
                eventDensity: this.clamp01(eventDensity),
                dialogueRatio: this.clamp01(dialogueRatio),
                actionDensity: this.clamp01(actionDensity),
                overallRhythm: this.clamp01(overallRhythm)
            });

            charOffset = paraStart + para.length;
        }
        await yieldToUI();

        const smoothedCurve = this.smoothCurve(emotionCurve);
        const emotionPoints = this.detectEmotionPoints(smoothedCurve, paragraphs);
        const plotStages = this.detectPlotStages(smoothedCurve);
        const structureMatches = this.calculateStructureMatches(smoothedCurve);
        const coolPoints = this.detectCoolPoints(smoothedCurve, paragraphs);
        await yieldToUI();

        const mainThreadSwitches = this.detectMainThreadSwitches(paragraphs, text, totalLength);

        const hookAnalysis = await this.detectChapterHooks(text);
        await yieldToUI();

        const tensionCurve = await this.calculateTensionCurve(text);
        await yieldToUI();

        const emotionArc = await this.detectEmotionArc(text);
        await yieldToUI();

        const nrcEmotion = await this.analyzeNRCEmotion(text);
        await yieldToUI();

        const rhythmCurve = await this.calculateRhythmCurve(text);

        const stats = this.calculateStats(smoothedCurve, emotionPoints, coolPoints, hookAnalysis, tensionCurve);

        const result: RhythmAnalysisResult = {
            emotionCurve: smoothedCurve,
            emotionPoints,
            plotStages,
            structureMatches,
            coolPoints,
            mainThreadSwitches,
            hooks: hookAnalysis.hooks,
            hookAnalysis,
            tensionCurve,
            emotionArc,
            nrcEmotion,
            rhythmCurve,
            stats
        };

        // 可选 LLM 增强：仅在注入了 llmEnhancer 时调用，失败时优雅降级
        if (this.llmEnhancer) {
            try {
                const contextText = LLMEnhancer.buildContextForDimension('rhythm', text, paragraphs);
                const enhanced = await this.llmEnhancer.enhanceResult(result, contextText, 'rhythm');
                if ((enhanced as any)[LLM_DEGRADED]) {
                    log.warn('[RhythmDeconstructor] LLM 增强降级，使用纯统计结果');
                }
                return enhanced;
            } catch (e) {
                log.warn('[RhythmDeconstructor] LLM 增强失败，使用纯统计结果', e);
                return result;
            }
        }

        return result;
    }

    async saveToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookRhythmAnalysisFile(bookName, baseDir);
        const result = await this.analyze('');

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    async saveAnalysisToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        result: RhythmAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookRhythmAnalysisFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    private getEmptyResult(): RhythmAnalysisResult {
        return {
            emotionCurve: [],
            emotionPoints: [],
            plotStages: [],
            structureMatches: [],
            coolPoints: [],
            mainThreadSwitches: [],
            hooks: [],
            hookAnalysis: {
                hooks: [],
                totalChapters: 0,
                hookRate: 0,
                typeDistribution: { suspense: 0, foreshadow: 0, conflict: 0 },
                noHookChapters: [],
                avgIntensity: 0
            },
            tensionCurve: {
                points: [],
                chapterTensions: [],
                overallTensionAvg: 0,
                overallTensionStd: 0,
                peaks: [],
                valleys: [],
                waveformScore: 0
            },
            emotionArc: {
                arcType: 'steady',
                confidence: 0,
                chapterEmotions: [],
                segments: [],
                description: '无文本或无章节，无法识别情感弧'
            },
            nrcEmotion: {
                overallDistribution: {
                    anger: 0, anticipation: 0, disgust: 0, fear: 0,
                    joy: 0, sadness: 0, surprise: 0, trust: 0
                },
                chapterDistribution: [],
                dominantEmotion: 'joy',
                emotionVolatility: 0,
                emotionTransitions: []
            },
            rhythmCurve: {
                chapterScores: [],
                avgScore: 0,
                rhythmPattern: 'medium',
                paceChanges: [],
                description: '无文本或无章节，无法计算节奏曲线'
            },
            stats: {
                avgRhythm: 0,
                rhythmVariance: 0,
                climaxCount: 0,
                coolPointCount: 0,
                avgEmotionIntensity: 0,
                hookRate: 0,
                chapterHookCount: 0,
                avgTension: 0,
                tensionStd: 0,
                waveformScore: 0,
                tensionPeakCount: 0,
                tensionValleyCount: 0
            }
        };
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private splitChapters(text: string): { startIndex: number; endIndex: number; index: number }[] {
        const chapters: { startIndex: number; endIndex: number; index: number }[] = [];

        // 检测是否存在"第N章"格式：若存在则"节"为章内子单位（如紫川"第一章+第一节"层级），
        // 不应作为分章点；若不存在"章"只有"节"，则"节"作为顶级章节单位
        const hasChapter = /^第[一二三四五六七八九十百千零\d]+章/m.test(text);
        const unitChars = hasChapter ? '章部卷回折' : '章节部卷回折';
        const chapterRegex = new RegExp(`^第[一二三四五六七八九十百千零\\d]+[${unitChars}]`, 'gm');

        let match;
        let index = 0;

        while ((match = chapterRegex.exec(text)) !== null) {
            if (chapters.length > 0) {
                chapters[chapters.length - 1].endIndex = match.index;
            }
            chapters.push({
                startIndex: match.index,
                endIndex: text.length,
                index: index++
            });
        }

        return chapters;
    }

    private findChapterIndex(pos: number, chapters: { startIndex: number; endIndex: number; index: number }[]): number | undefined {
        for (const ch of chapters) {
            if (pos >= ch.startIndex && pos < ch.endIndex) {
                return ch.index;
            }
        }
        return chapters.length > 0 ? chapters.length - 1 : undefined;
    }



    private isEnglishLetter(char: string): boolean {
        const code = char.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    private isDigit(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 48 && code <= 57;
    }

    private countWordOccurrences(text: string, wordSet: Set<string>): number {
        let count = 0;
        const lowerText = text.toLowerCase();

        for (const word of wordSet) {
            const lowerWord = word.toLowerCase();
            if (lowerWord.length === 1) {
                for (let i = 0; i < lowerText.length; i++) {
                    if (lowerText[i] === lowerWord) count++;
                }
            } else {
                let idx = 0;
                while ((idx = lowerText.indexOf(lowerWord, idx)) !== -1) {
                    count++;
                    idx += lowerWord.length;
                }
            }
        }

        return count;
    }

    private calculateEmotionIntensity(text: string, wordCount: number): number {
        const positiveCount = this.countWordOccurrences(text, this.positiveSet);
        const negativeCount = this.countWordOccurrences(text, this.negativeSet);
        const rawIntensity = Math.abs(positiveCount - negativeCount);
        return Math.min(1, rawIntensity / Math.max(wordCount * 0.05, 1));
    }

    private calculateEventDensity(text: string, wordCount: number): number {
        const actionCount = this.countWordOccurrences(text, this.actionSet);
        return Math.min(1, actionCount / Math.max(wordCount * 0.05, 1));
    }

    private calculateDialogueRatio(text: string): number {
        let dialogueChars = 0;
        const quotePairs = [
            { start: '「', end: '」' },
            { start: '『', end: '』' },
            { start: '"', end: '"' },
            { start: "'", end: "'" },
            { start: '“', end: '”' },
            { start: '‘', end: '’' }
        ];

        for (const pair of quotePairs) {
            let startIdx = 0;
            while (startIdx < text.length) {
                const openIdx = text.indexOf(pair.start, startIdx);
                if (openIdx === -1) break;
                const closeIdx = text.indexOf(pair.end, openIdx + 1);
                if (closeIdx === -1) break;
                dialogueChars += closeIdx - openIdx - 1;
                startIdx = closeIdx + 1;
            }
        }

        return text.length > 0 ? Math.min(1, dialogueChars / text.length) : 0;
    }

    private calculateActionDensity(text: string, wordCount: number): number {
        const shortSentences = text.split(/[。！？!?]+/).filter(s => s.trim().length > 0 && s.trim().length < 15);
        const totalSentences = Math.max(text.split(/[。！？!?]+/).filter(s => s.trim().length > 0).length, 1);
        return Math.min(1, shortSentences.length / totalSentences);
    }

    private smoothCurve(curve: RhythmDataPoint[]): RhythmDataPoint[] {
        if (curve.length < 3) return curve;

        const smoothed: RhythmDataPoint[] = [];
        const windowSize = Math.min(5, Math.floor(curve.length / 10));

        for (let i = 0; i < curve.length; i++) {
            let sumEmotion = 0;
            let sumEvent = 0;
            let sumDialogue = 0;
            let sumAction = 0;
            let sumRhythm = 0;
            let count = 0;

            for (let j = Math.max(0, i - windowSize); j <= Math.min(curve.length - 1, i + windowSize); j++) {
                const weight = 1 - Math.abs(j - i) / (windowSize + 1);
                sumEmotion += curve[j].emotionIntensity * weight;
                sumEvent += curve[j].eventDensity * weight;
                sumDialogue += curve[j].dialogueRatio * weight;
                sumAction += curve[j].actionDensity * weight;
                sumRhythm += curve[j].overallRhythm * weight;
                count += weight;
            }

            smoothed.push({
                ...curve[i],
                emotionIntensity: sumEmotion / count,
                eventDensity: sumEvent / count,
                dialogueRatio: sumDialogue / count,
                actionDensity: sumAction / count,
                overallRhythm: sumRhythm / count
            });
        }

        return smoothed;
    }

    private detectEmotionPoints(curve: RhythmDataPoint[], paragraphs: string[]): EmotionPoint[] {
        if (curve.length < 5) return [];

        const points: EmotionPoint[] = [];
        const rhythmValues = curve.map(p => p.overallRhythm);
        const mean = rhythmValues.reduce((a, b) => a + b, 0) / rhythmValues.length;
        const std = Math.sqrt(rhythmValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rhythmValues.length);
        const peakThreshold = mean + std * 0.8;
        const troughThreshold = mean - std * 0.5;

        for (let i = 2; i < curve.length - 2; i++) {
            const prev = curve[i - 1].overallRhythm;
            const curr = curve[i].overallRhythm;
            const next = curve[i + 1].overallRhythm;

            const isLocalMax = curr > prev && curr > next && curr > peakThreshold;
            const isLocalMin = curr < prev && curr < next && curr < troughThreshold;

            if (isLocalMax) {
                const para = paragraphs[curve[i].paragraphIndex] || '';
                const contextText = this.collectEmotionContext(paragraphs, curve[i].paragraphIndex);
                const keywordBoost = this.calculateEmotionKeywordBoost(contextText);
                const intensity = Math.min(1, curr + keywordBoost);
                const isBigClimax = intensity > mean + std * 1.5 && i > curve.length * 0.5;
                const isSuspense = curve[i].emotionIntensity > 0.5 && curve[i].dialogueRatio > 0.3;
                const isReversal = this.checkReversal(curve, i);

                let type: EmotionPointType = 'small_climax';
                let description = '小高潮';

                if (isBigClimax) {
                    type = 'big_climax';
                    description = '大高潮';
                } else if (isReversal) {
                    type = 'reversal';
                    description = '剧情反转';
                } else if (isSuspense) {
                    type = 'suspense';
                    description = '悬念点';
                }

                points.push({
                    position: curve[i].position,
                    chapterIndex: curve[i].chapterIndex,
                    paragraphIndex: curve[i].paragraphIndex,
                    type,
                    intensity: this.clamp01(intensity),
                    description,
                    excerpt: para.slice(0, 100),
                    eventDescription: this.extractEventDescription(para)
                });
            } else if (isLocalMin) {
                const para = paragraphs[curve[i].paragraphIndex] || '';
                const contextText = this.collectEmotionContext(paragraphs, curve[i].paragraphIndex);
                const keywordBoost = this.calculateEmotionKeywordBoost(contextText);
                const intensity = Math.min(1, (1 - curr) + keywordBoost);
                points.push({
                    position: curve[i].position,
                    chapterIndex: curve[i].chapterIndex,
                    paragraphIndex: curve[i].paragraphIndex,
                    type: 'trough',
                    intensity: this.clamp01(intensity),
                    description: '情绪低谷',
                    excerpt: para.slice(0, 100),
                    eventDescription: this.extractEventDescription(para)
                });
            }
        }

        return points.sort((a, b) => a.position - b.position);
    }

    private collectEmotionContext(paragraphs: string[], centerIdx: number): string {
        const parts: string[] = [];
        for (let j = Math.max(0, centerIdx - 2); j <= Math.min(paragraphs.length - 1, centerIdx + 2); j++) {
            parts.push(paragraphs[j] || '');
        }
        return parts.join('');
    }

    private calculateEmotionKeywordBoost(text: string): number {
        if (!text) return 0;
        let matchCount = 0;
        const allTensionTypes: TensionEventType[] = ['conflict', 'suspense', 'reversal', 'cool_point', 'setback', 'climax'];
        for (const type of allTensionTypes) {
            const wordSet = this.tensionSets[type];
            for (const word of wordSet) {
                if (text.includes(word)) {
                    matchCount++;
                }
            }
        }
        return Math.min(0.6, matchCount * 0.1);
    }

    private extractEventDescription(para: string): string {
        if (!para || para.length === 0) return '';
        const sentences = para.split(/[。！？!?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
        if (sentences.length === 0) return '';
        const firstSentence = sentences[0];
        return firstSentence.length > 30 ? firstSentence.slice(0, 30) : firstSentence;
    }

    private checkReversal(curve: RhythmDataPoint[], index: number): boolean {
        if (index < 5 || index >= curve.length - 5) return false;

        const beforeAvg = curve.slice(index - 5, index).reduce((a, b) => a + b.overallRhythm, 0) / 5;
        const afterAvg = curve.slice(index + 1, index + 6).reduce((a, b) => a + b.overallRhythm, 0) / 5;

        return Math.abs(beforeAvg - afterAvg) > 0.2;
    }

    private detectPlotStages(curve: RhythmDataPoint[]): PlotStageSegment[] {
        if (curve.length < 10) return [];

        const stages: PlotStageSegment[] = [];
        const totalLen = curve.length;

        const climaxPoints = curve.filter(p => p.overallRhythm > 0.6).sort((a, b) => b.overallRhythm - a.overallRhythm);
        let bigClimaxPos = 0.8;
        if (climaxPoints.length > 0) {
            const topClimaxes = climaxPoints.slice(0, Math.max(1, Math.floor(climaxPoints.length * 0.3)));
            bigClimaxPos = topClimaxes.reduce((a, b) => a + b.position, 0) / topClimaxes.length;
            bigClimaxPos = Math.max(0.5, Math.min(0.95, bigClimaxPos));
        }

        const firstQuarterRhythm = curve.slice(0, Math.floor(totalLen * 0.25))
            .reduce((a, b) => a + b.overallRhythm, 0) / Math.floor(totalLen * 0.25);
        const midRhythm = curve.slice(Math.floor(totalLen * 0.25), Math.floor(totalLen * 0.5))
            .reduce((a, b) => a + b.overallRhythm, 0) / Math.floor(totalLen * 0.25);

        let foreshadowEnd = 0.15;
        if (firstQuarterRhythm < 0.3) {
            foreshadowEnd = 0.25;
        } else if (firstQuarterRhythm > 0.5) {
            foreshadowEnd = 0.1;
        }

        let developmentEnd = 0.5;
        if (midRhythm > 0.5) {
            developmentEnd = 0.4;
        } else if (midRhythm < 0.3) {
            developmentEnd = 0.6;
        }
        developmentEnd = Math.min(developmentEnd, bigClimaxPos - 0.15);

        let smallClimaxEnd = bigClimaxPos - 0.05;

        let bigClimaxEnd = Math.min(0.95, bigClimaxPos + 0.1);

        stages.push({
            type: 'foreshadowing',
            startPosition: 0,
            endPosition: foreshadowEnd,
            description: '铺垫期：世界观建立、人物登场、初始冲突引入'
        });

        stages.push({
            type: 'development',
            startPosition: foreshadowEnd,
            endPosition: developmentEnd,
            description: '发展期：主线推进、矛盾升级、人物关系展开'
        });

        stages.push({
            type: 'small_climax',
            startPosition: developmentEnd,
            endPosition: smallClimaxEnd,
            description: '小高潮：阶段性冲突爆发，为大高潮蓄势'
        });

        stages.push({
            type: 'big_climax',
            startPosition: smallClimaxEnd,
            endPosition: bigClimaxEnd,
            description: '大高潮：核心冲突总爆发，全书最高潮'
        });

        stages.push({
            type: 'ending',
            startPosition: bigClimaxEnd,
            endPosition: 1,
            description: '结局：冲突解决、人物归宿、余韵收尾'
        });

        return stages;
    }

    private calculateStructureMatches(curve: RhythmDataPoint[]): StructureMatch[] {
        if (curve.length < 10) return [];

        const rhythmValues = curve.map(p => p.overallRhythm);
        const matches: StructureMatch[] = [];

        const threeActTemplate = this.generateTemplate(curve.length, [
            { pos: 0.1, val: 0.3 },
            { pos: 0.25, val: 0.5 },
            { pos: 0.5, val: 0.4 },
            { pos: 0.75, val: 0.6 },
            { pos: 0.9, val: 0.9 },
            { pos: 1.0, val: 0.3 }
        ]);
        matches.push({
            name: '三幕式结构',
            matchScore: this.correlationCoefficient(rhythmValues, threeActTemplate),
            description: '经典三幕剧结构：建置-对抗-结局，节奏先抑后扬'
        });

        const heroJourneyTemplate = this.generateTemplate(curve.length, [
            { pos: 0.05, val: 0.2 },
            { pos: 0.15, val: 0.4 },
            { pos: 0.25, val: 0.3 },
            { pos: 0.4, val: 0.5 },
            { pos: 0.5, val: 0.6 },
            { pos: 0.65, val: 0.5 },
            { pos: 0.75, val: 0.7 },
            { pos: 0.85, val: 0.9 },
            { pos: 0.95, val: 0.4 }
        ]);
        matches.push({
            name: '英雄之旅',
            matchScore: this.correlationCoefficient(rhythmValues, heroJourneyTemplate),
            description: '坎贝尔英雄之旅模型：启程-启蒙-归来，多阶段起伏'
        });

        const fiveActTemplate = this.generateTemplate(curve.length, [
            { pos: 0.1, val: 0.3 },
            { pos: 0.3, val: 0.5 },
            { pos: 0.5, val: 0.4 },
            { pos: 0.7, val: 0.7 },
            { pos: 0.85, val: 0.9 },
            { pos: 1.0, val: 0.2 }
        ]);
        matches.push({
            name: '五幕式结构',
            matchScore: this.correlationCoefficient(rhythmValues, fiveActTemplate),
            description: '五幕剧结构：开端-上升-高潮-回落-结局'
        });

        const webNovelTemplate = this.generateTemplate(curve.length, [
            { pos: 0.05, val: 0.4 },
            { pos: 0.15, val: 0.6 },
            { pos: 0.3, val: 0.5 },
            { pos: 0.45, val: 0.7 },
            { pos: 0.6, val: 0.6 },
            { pos: 0.75, val: 0.8 },
            { pos: 0.9, val: 0.95 },
            { pos: 1.0, val: 0.5 }
        ]);
        matches.push({
            name: '网文节奏模型',
            matchScore: this.correlationCoefficient(rhythmValues, webNovelTemplate),
            description: '典型网文节奏：开局抓眼球，中段密集爽点，结尾大高潮'
        });

        matches.sort((a, b) => b.matchScore - a.matchScore);
        return matches.map(m => ({ ...m, matchScore: this.clamp01(Math.max(0, m.matchScore)) }));
    }

    private generateTemplate(length: number, keyPoints: { pos: number; val: number }[]): number[] {
        const template: number[] = [];
        const sorted = [...keyPoints].sort((a, b) => a.pos - b.pos);

        for (let i = 0; i < length; i++) {
            const pos = i / length;
            let val = 0.5;

            for (let j = 0; j < sorted.length - 1; j++) {
                if (pos >= sorted[j].pos && pos <= sorted[j + 1].pos) {
                    const t = (pos - sorted[j].pos) / (sorted[j + 1].pos - sorted[j].pos);
                    val = sorted[j].val + t * (sorted[j + 1].val - sorted[j].val);
                    break;
                }
            }

            if (pos < sorted[0].pos) val = sorted[0].val;
            if (pos > sorted[sorted.length - 1].pos) val = sorted[sorted.length - 1].val;

            template.push(val);
        }

        return template;
    }

    private correlationCoefficient(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;

        const n = a.length;
        const meanA = a.reduce((s, v) => s + v, 0) / n;
        const meanB = b.reduce((s, v) => s + v, 0) / n;

        let num = 0;
        let denA = 0;
        let denB = 0;

        for (let i = 0; i < n; i++) {
            const da = a[i] - meanA;
            const db = b[i] - meanB;
            num += da * db;
            denA += da * da;
            denB += db * db;
        }

        const den = Math.sqrt(denA * denB);
        return den > 0 ? num / den : 0;
    }

    private detectCoolPoints(curve: RhythmDataPoint[], paragraphs: string[]): { position: number; type: string; intensity: number }[] {
        if (curve.length < 5) return [];

        const coolPoints: { position: number; type: string; intensity: number; excerpt?: string }[] = [];
        const rhythmValues = curve.map(p => p.overallRhythm);
        const mean = rhythmValues.reduce((a, b) => a + b, 0) / rhythmValues.length;
        const std = Math.sqrt(rhythmValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rhythmValues.length);

        for (let i = 1; i < curve.length - 1; i++) {
            const curr = curve[i].overallRhythm;
            const para = paragraphs[curve[i].paragraphIndex] || '';

            if (curr > mean + std * 0.5) {
                for (const category of COOL_POINT_KEYWORDS) {
                    let matched = false;
                    let matchCount = 0;
                    for (const word of category.words) {
                        const count = (para.match(new RegExp(word, 'g')) || []).length;
                        if (count > 0) {
                            matched = true;
                            matchCount += count;
                        }
                    }
                    if (matched) {
                        const intensity = Math.min(1, curr * (1 + matchCount * 0.2));
                        const exists = coolPoints.some(p => Math.abs(p.position - curve[i].position) < 0.05);
                        if (!exists) {
                            coolPoints.push({
                                position: curve[i].position,
                                type: category.type,
                                intensity: this.clamp01(intensity),
                                excerpt: para.slice(0, 80)
                            });
                        }
                        break;
                    }
                }
            }
        }

        return coolPoints
            .sort((a, b) => b.intensity - a.intensity)
            .slice(0, 20)
            .sort((a, b) => a.position - b.position);
    }

    private detectMainThreadSwitches(
        paragraphs: string[],
        fullText: string,
        totalLength: number
    ): { position: number; type: 'main' | 'sub'; description: string }[] {
        if (paragraphs.length < 5) return [];

        const switches: { position: number; type: 'main' | 'sub'; description: string }[] = [];

        for (let i = 1; i < paragraphs.length; i++) {
            const para = paragraphs[i].trim();
            let isSwitch = false;
            let keyword = '';

            for (const kw of SCENE_SWITCH_KEYWORDS) {
                if (para.startsWith(kw) || para.slice(0, 20).includes(kw)) {
                    isSwitch = true;
                    keyword = kw;
                    break;
                }
            }

            if (isSwitch && totalLength > 0) {
                const pos = fullText.indexOf(para) / totalLength;
                const isMain = Math.random() > 0.5;
                switches.push({
                    position: this.clamp01(pos),
                    type: isMain ? 'main' : 'sub',
                    description: `场景切换（${keyword}）：${isMain ? '主线' : '支线'}剧情`
                });
            }
        }

        return switches.slice(0, 15);
    }

    private calculateStats(
        curve: RhythmDataPoint[],
        emotionPoints: EmotionPoint[],
        coolPoints: { position: number; type: string; intensity: number }[],
        hookAnalysis?: HookAnalysisResult,
        tensionCurve?: TensionCurveResult
    ): {
        avgRhythm: number;
        rhythmVariance: number;
        climaxCount: number;
        coolPointCount: number;
        avgEmotionIntensity: number;
        hookRate?: number;
        chapterHookCount?: number;
        avgTension?: number;
        tensionStd?: number;
        waveformScore?: number;
        tensionPeakCount?: number;
        tensionValleyCount?: number;
    } {
        if (curve.length === 0) {
            return {
                avgRhythm: 0,
                rhythmVariance: 0,
                climaxCount: 0,
                coolPointCount: 0,
                avgEmotionIntensity: 0,
                hookRate: hookAnalysis?.hookRate ?? 0,
                chapterHookCount: hookAnalysis?.hooks.length ?? 0,
                avgTension: tensionCurve?.overallTensionAvg ?? 0,
                tensionStd: tensionCurve?.overallTensionStd ?? 0,
                waveformScore: tensionCurve?.waveformScore ?? 0,
                tensionPeakCount: tensionCurve?.peaks.length ?? 0,
                tensionValleyCount: tensionCurve?.valleys.length ?? 0
            };
        }

        const rhythmValues = curve.map(p => p.overallRhythm);
        const emotionValues = curve.map(p => p.emotionIntensity);
        const avgRhythm = rhythmValues.reduce((a, b) => a + b, 0) / rhythmValues.length;
        const avgEmotion = emotionValues.reduce((a, b) => a + b, 0) / emotionValues.length;
        const variance = rhythmValues.reduce((a, b) => a + (b - avgRhythm) ** 2, 0) / rhythmValues.length;

        const climaxCount = emotionPoints.filter(p => p.type === 'big_climax' || p.type === 'small_climax').length;

        return {
            avgRhythm: this.round2(avgRhythm),
            rhythmVariance: this.round2(variance),
            climaxCount,
            coolPointCount: coolPoints.length,
            avgEmotionIntensity: this.round2(avgEmotion),
            hookRate: hookAnalysis?.hookRate,
            chapterHookCount: hookAnalysis?.hooks.length,
            avgTension: tensionCurve?.overallTensionAvg,
            tensionStd: tensionCurve?.overallTensionStd,
            waveformScore: tensionCurve?.waveformScore,
            tensionPeakCount: tensionCurve?.peaks.length,
            tensionValleyCount: tensionCurve?.valleys.length
        };
    }

    private buildFrontmatter(result: RhythmAnalysisResult): string {
        const data = {
            emotionPoints: result.emotionPoints.map(p => ({
                position: p.position,
                type: p.type,
                intensity: p.intensity,
                description: p.description,
                chapterIndex: p.chapterIndex,
                eventDescription: p.eventDescription
            })),
            plotStages: result.plotStages.map(s => ({
                name: s.type,
                start: s.startPosition,
                end: s.endPosition,
                description: s.description
            })),
            structureMatches: result.structureMatches.map(m => ({
                label: m.name,
                value: m.matchScore
            })),
            coolPoints: result.coolPoints.map(p => ({
                x: p.position,
                y: p.intensity,
                label: p.type,
                category: p.type
            })),
            mainThreadSwitches: result.mainThreadSwitches.map(s => ({
                position: s.position,
                type: s.type,
                description: s.description
            })),
            hooks: result.hooks?.map(h => ({
                chapterIndex: h.chapterIndex,
                chapterTitle: h.chapterTitle,
                type: h.type,
                intensity: h.intensity,
                matchedWords: h.matchedWords
            })),
            hookAnalysis: result.hookAnalysis ? {
                totalChapters: result.hookAnalysis.totalChapters,
                hookRate: result.hookAnalysis.hookRate,
                typeDistribution: result.hookAnalysis.typeDistribution,
                noHookChapters: result.hookAnalysis.noHookChapters,
                avgIntensity: result.hookAnalysis.avgIntensity
            } : undefined,
            tensionCurve: result.tensionCurve ? {
                points: result.tensionCurve.points.slice(0, 100).map(p => ({
                    chapterIndex: p.chapterIndex,
                    position: p.position,
                    intensity: p.intensity,
                    type: p.type,
                    matchedWords: p.matchedWords
                })),
                chapterTensions: result.tensionCurve.chapterTensions,
                overallTensionAvg: result.tensionCurve.overallTensionAvg,
                overallTensionStd: result.tensionCurve.overallTensionStd,
                peaks: result.tensionCurve.peaks,
                valleys: result.tensionCurve.valleys,
                waveformScore: result.tensionCurve.waveformScore
            } : undefined,
            emotionArc: result.emotionArc ? {
                arcType: result.emotionArc.arcType,
                confidence: result.emotionArc.confidence,
                chapterEmotions: result.emotionArc.chapterEmotions,
                segments: result.emotionArc.segments,
                description: result.emotionArc.description
            } : undefined,
            nrcEmotion: result.nrcEmotion ? {
                overallDistribution: result.nrcEmotion.overallDistribution,
                chapterDistribution: result.nrcEmotion.chapterDistribution,
                dominantEmotion: result.nrcEmotion.dominantEmotion,
                emotionVolatility: result.nrcEmotion.emotionVolatility,
                emotionTransitions: result.nrcEmotion.emotionTransitions
            } : undefined,
            rhythmCurve: result.rhythmCurve ? {
                chapterScores: result.rhythmCurve.chapterScores,
                avgScore: result.rhythmCurve.avgScore,
                rhythmPattern: result.rhythmCurve.rhythmPattern,
                paceChanges: result.rhythmCurve.paceChanges,
                description: result.rhythmCurve.description
            } : undefined,
            stats: result.stats,
            chapterRhythm: this.buildChapterRhythm(result)
        };
        return JSON.stringify(data, null, 2);
    }

    private buildChapterRhythm(result: RhythmAnalysisResult): Array<{
        chapterIndex: number; emotionScore: number; tensionScore: number;
        densityScore: number; description: string;
    }> {
        const byChapter = new Map<number, { emotions: number[]; tensions: number[]; densities: number[] }>();
        for (const pt of (result.emotionCurve || [])) {
            if (pt.chapterIndex == null) continue;
            let acc = byChapter.get(pt.chapterIndex);
            if (!acc) {
                acc = { emotions: [], tensions: [], densities: [] };
                byChapter.set(pt.chapterIndex, acc);
            }
            acc.emotions.push(pt.emotionIntensity);
            acc.tensions.push(pt.overallRhythm);
            acc.densities.push(pt.eventDensity);
        }
        const entries: Array<{
            chapterIndex: number; emotionScore: number; tensionScore: number;
            densityScore: number; description: string;
        }> = [];
        for (const [chIdx, acc] of byChapter) {
            const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
            entries.push({
                chapterIndex: chIdx,
                emotionScore: Math.round(avg(acc.emotions)),
                tensionScore: Math.round(avg(acc.tensions)),
                densityScore: Math.round(avg(acc.densities)),
                description: `第${chIdx + 1}章：情绪${Math.round(avg(acc.emotions))} 紧张${Math.round(avg(acc.tensions))} 密度${Math.round(avg(acc.densities))}`
            });
        }
        return entries.sort((a, b) => a.chapterIndex - b.chapterIndex);
    }

    private buildMarkdownBody(result: RhythmAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 节奏分析报告`);
        lines.push('');

        lines.push('## 情绪曲线简述');
        lines.push('');
        lines.push(`- 平均节奏强度：**${result.stats.avgRhythm}**`);
        lines.push(`- 节奏波动方差：**${result.stats.rhythmVariance}**`);
        lines.push(`- 平均情绪强度：**${result.stats.avgEmotionIntensity}**`);
        lines.push(`- 高潮点总数：**${result.stats.climaxCount}**`);
        lines.push(`- 爽点总数：**${result.stats.coolPointCount}**`);
        if (result.stats.hookRate !== undefined) {
            lines.push(`- 章末钩子率：**${(result.stats.hookRate * 100).toFixed(1)}%**`);
        }
        if (result.stats.chapterHookCount !== undefined) {
            lines.push(`- 有钩子章节数：**${result.stats.chapterHookCount}**`);
        }
        lines.push('');

        lines.push('## 关键情绪点');
        lines.push('');
        if (result.emotionPoints.length === 0) {
            lines.push('暂未检测到明显情绪点');
        } else {
            lines.push('| 位置 | 类型 | 强度 | 描述 | 具体事件 |');
            lines.push('|------|------|------|------|----------|');
            for (const p of result.emotionPoints) {
                const typeLabel = this.emotionTypeLabel(p.type);
                const eventDesc = p.eventDescription || '';
                lines.push(`| ${(p.position * 100).toFixed(1)}% | ${typeLabel} | ${p.intensity.toFixed(2)} | ${p.description} | ${eventDesc} |`);
            }
        }
        lines.push('');

        lines.push('## 剧情阶段划分');
        lines.push('');
        if (result.plotStages.length === 0) {
            lines.push('文本过短，无法划分阶段');
        } else {
            lines.push('| 阶段 | 起始位置 | 结束位置 | 描述 |');
            lines.push('|------|----------|----------|------|');
            for (const s of result.plotStages) {
                const stageLabel = this.stageTypeLabel(s.type);
                lines.push(`| ${stageLabel} | ${(s.startPosition * 100).toFixed(0)}% | ${(s.endPosition * 100).toFixed(0)}% | ${s.description} |`);
            }
        }
        lines.push('');

        lines.push('## 结构理论匹配度');
        lines.push('');
        if (result.structureMatches.length === 0) {
            lines.push('文本过短，无法计算匹配度');
        } else {
            lines.push('| 理论名称 | 匹配度 | 描述 |');
            lines.push('|----------|--------|------|');
            for (const m of result.structureMatches) {
                lines.push(`| ${m.name} | ${(m.matchScore * 100).toFixed(1)}% | ${m.description} |`);
            }
        }
        lines.push('');

        lines.push('## 爽点分布');
        lines.push('');
        if (result.coolPoints.length === 0) {
            lines.push('暂未检测到明显爽点');
        } else {
            lines.push('| 位置 | 类型 | 强度 |');
            lines.push('|------|------|------|');
            for (const p of result.coolPoints) {
                lines.push(`| ${(p.position * 100).toFixed(1)}% | ${p.type} | ${p.intensity.toFixed(2)} |`);
            }
        }
        lines.push('');

        lines.push('## 主线支线切换点');
        lines.push('');
        if (result.mainThreadSwitches.length === 0) {
            lines.push('暂未检测到明显切换');
        } else {
            lines.push('| 位置 | 类型 | 描述 |');
            lines.push('|------|------|------|');
            for (const s of result.mainThreadSwitches) {
                lines.push(`| ${(s.position * 100).toFixed(1)}% | ${s.type === 'main' ? '主线' : '支线'} | ${s.description} |`);
            }
        }
        lines.push('');

        lines.push('## 张力曲线分析');
        lines.push('');
        if (!result.tensionCurve || result.tensionCurve.points.length === 0) {
            lines.push('文本过短，无法进行张力曲线分析');
        } else {
            const tc = result.tensionCurve;
            lines.push(`- 全书平均张力：**${tc.overallTensionAvg.toFixed(2)}**`);
            lines.push(`- 张力标准差：**${tc.overallTensionStd.toFixed(2)}**（起伏程度）`);
            lines.push(`- 波形质量评分：**${tc.waveformScore.toFixed(1)}分**`);
            lines.push(`- 张力峰值数：**${tc.peaks.length}**`);
            lines.push(`- 张力谷值数：**${tc.valleys.length}**`);
            lines.push('');

            lines.push('### 张力事件类型分布');
            lines.push('');
            const typeDistribution: Record<string, number> = {};
            for (const p of tc.points) {
                typeDistribution[p.type] = (typeDistribution[p.type] || 0) + 1;
            }
            const tensionTypeLabels: Record<TensionEventType, string> = {
                conflict: '冲突事件',
                suspense: '悬念事件',
                reversal: '反转事件',
                cool_point: '爽点事件',
                setback: '挫折事件',
                climax: '高潮事件'
            };
            lines.push('| 类型 | 数量 | 占比 |');
            lines.push('|------|------|------|');
            const sortedTypes = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]);
            for (const [type, count] of sortedTypes) {
                const ratio = tc.points.length > 0 ? (count / tc.points.length * 100).toFixed(1) : '0.0';
                lines.push(`| ${tensionTypeLabels[type as TensionEventType] || type} | ${count} | ${ratio}% |`);
            }
            lines.push('');

            if (tc.peaks.length > 0) {
                lines.push('### 张力峰值（前10个）');
                lines.push('');
                lines.push('| 章节 | 强度 | 主导类型 |');
                lines.push('|------|------|----------|');
                const topPeaks = [...tc.peaks].sort((a, b) => b.intensity - a.intensity).slice(0, 10);
                for (const peak of topPeaks) {
                    const typeLabel = tensionTypeLabels[peak.type as TensionEventType] || peak.type;
                    lines.push(`| 第${peak.chapterIndex + 1}章 | ${peak.intensity.toFixed(2)} | ${typeLabel} |`);
                }
                lines.push('');
            }

            if (tc.valleys.length > 0) {
                lines.push('### 张力谷值（前5个）');
                lines.push('');
                lines.push('| 章节 | 强度 |');
                lines.push('|------|------|');
                const topValleys = [...tc.valleys].sort((a, b) => a.intensity - b.intensity).slice(0, 5);
                for (const valley of topValleys) {
                    lines.push(`| 第${valley.chapterIndex + 1}章 | ${valley.intensity.toFixed(2)} |`);
                }
                lines.push('');
            }
        }
        lines.push('');

        lines.push('## 章末钩子分析');
        lines.push('');
        if (!result.hookAnalysis || result.hookAnalysis.totalChapters === 0) {
            lines.push('文本过短或无章节，无法进行章末钩子分析');
        } else {
            const ha = result.hookAnalysis;
            lines.push(`- 总章节数：**${ha.totalChapters}**`);
            lines.push(`- 有钩子章节数：**${ha.hooks.length}**`);
            lines.push(`- 钩子率：**${(ha.hookRate * 100).toFixed(1)}%**`);
            lines.push(`- 平均钩子强度：**${ha.avgIntensity.toFixed(2)}**`);
            lines.push(`- 无钩子章节数：**${ha.noHookChapters.length}**`);
            lines.push('');

            lines.push('### 钩子类型分布');
            lines.push('');
            lines.push('| 类型 | 数量 | 占比 |');
            lines.push('|------|------|------|');
            const typeLabels: Record<HookType, string> = {
                suspense: '悬念钩子',
                foreshadow: '伏笔钩子',
                conflict: '冲突钩子'
            };
            for (const t of ['suspense', 'foreshadow', 'conflict'] as HookType[]) {
                const count = ha.typeDistribution[t];
                const ratio = ha.hooks.length > 0 ? (count / ha.hooks.length * 100).toFixed(1) : '0.0';
                lines.push(`| ${typeLabels[t]} | ${count} | ${ratio}% |`);
            }
            lines.push('');

            if (ha.hooks.length > 0) {
                lines.push('### 钩子详情');
                lines.push('');
                lines.push('| 章节 | 类型 | 强度 | 匹配词 | 摘录 |');
                lines.push('|------|------|------|--------|------|');
                for (const h of ha.hooks.slice(0, 20)) {
                    const title = h.chapterTitle || `第${h.chapterIndex + 1}章`;
                    const words = h.matchedWords.slice(0, 3).join('、');
                    const excerpt = h.excerpt.replace(/\n/g, ' ').slice(0, 50);
                    lines.push(`| ${title} | ${typeLabels[h.type]} | ${h.intensity.toFixed(2)} | ${words} | ${excerpt}... |`);
                }
                if (ha.hooks.length > 20) {
                    lines.push('');
                    lines.push(`*仅展示前20个钩子，共${ha.hooks.length}个*`);
                }
                lines.push('');
            }

            if (ha.noHookChapters.length > 0) {
                lines.push('### 无钩子章节');
                lines.push('');
                const noHookList = ha.noHookChapters.slice(0, 20).map(i => `第${i + 1}章`).join('、');
                lines.push(noHookList);
                if (ha.noHookChapters.length > 20) {
                    lines.push('');
                    lines.push(`*仅展示前20个，共${ha.noHookChapters.length}个无钩子章节*`);
                }
                lines.push('');
            }
        }
        lines.push('');

        lines.push('## 情感弧分析');
        lines.push('');
        if (!result.emotionArc || result.emotionArc.chapterEmotions.length === 0) {
            lines.push('文本过短或无章节，无法进行情感弧分析');
        } else {
            const ea = result.emotionArc;
            lines.push(`- 情感弧原型：**${this.emotionArcTypeLabel(ea.arcType)}**`);
            lines.push(`- 置信度：**${(ea.confidence * 100).toFixed(1)}%**`);
            lines.push(`- 趋势描述：${ea.description}`);
            lines.push('');

            if (ea.segments.length > 0) {
                lines.push('### 分段趋势');
                lines.push('');
                lines.push('| 起始章 | 结束章 | 趋势 | 平均情感值 |');
                lines.push('|--------|--------|------|------------|');
                for (const seg of ea.segments) {
                    lines.push(`| 第${seg.startChapter + 1}章 | 第${seg.endChapter + 1}章 | ${this.trendLabel(seg.trend)} | ${seg.avgEmotion.toFixed(2)} |`);
                }
                lines.push('');
            }

            lines.push('### 章节情感值');
            lines.push('');
            const emotionsList = ea.chapterEmotions.map((v, i) => `第${i + 1}章:${v.toFixed(2)}`).join('、');
            lines.push(emotionsList);
            lines.push('');
        }
        lines.push('');

        lines.push('## NRC 8 情绪分析');
        lines.push('');
        if (!result.nrcEmotion || result.nrcEmotion.chapterDistribution.length === 0) {
            lines.push('文本过短或无章节，无法进行 NRC 情绪分析');
        } else {
            const ne = result.nrcEmotion;
            lines.push(`- 主导情绪：**${this.nrcEmotionLabel(ne.dominantEmotion)}**`);
            lines.push(`- 情绪波动度：**${(ne.emotionVolatility * 100).toFixed(1)}%**`);
            lines.push('');

            lines.push('### 全书情绪分布');
            lines.push('');
            lines.push('| 情绪 | 占比 |');
            lines.push('|------|------|');
            const nrcOrder: NRCEmotion[] = ['joy', 'trust', 'anticipation', 'surprise', 'anger', 'fear', 'disgust', 'sadness'];
            for (const emo of nrcOrder) {
                lines.push(`| ${this.nrcEmotionLabel(emo)} | ${(ne.overallDistribution[emo] * 100).toFixed(1)}% |`);
            }
            lines.push('');

            if (ne.emotionTransitions.length > 0) {
                lines.push('### 情绪转换');
                lines.push('');
                lines.push('| 起始章 | 目标章 | 从 | 到 |');
                lines.push('|--------|--------|------|------|');
                for (const t of ne.emotionTransitions.slice(0, 20)) {
                    lines.push(`| 第${t.fromChapter + 1}章 | 第${t.toChapter + 1}章 | ${this.nrcEmotionLabel(t.from)} | ${this.nrcEmotionLabel(t.to)} |`);
                }
                if (ne.emotionTransitions.length > 20) {
                    lines.push('');
                    lines.push(`*仅展示前20个转换，共${ne.emotionTransitions.length}个*`);
                }
                lines.push('');
            }
        }
        lines.push('');

        lines.push('## 节奏曲线');
        lines.push('');
        if (!result.rhythmCurve || result.rhythmCurve.chapterScores.length === 0) {
            lines.push('文本过短或无章节，无法计算节奏曲线');
        } else {
            const rc = result.rhythmCurve;
            lines.push(`- 节奏模式：**${this.rhythmPatternLabel(rc.rhythmPattern)}**`);
            lines.push(`- 平均评分：**${rc.avgScore.toFixed(1)}分**`);
            lines.push(`- 描述：${rc.description}`);
            lines.push('');

            lines.push('### 章节节奏评分');
            lines.push('');
            lines.push('| 章节 | 评分 | 节奏 |');
            lines.push('|------|------|------|');
            for (let i = 0; i < rc.chapterScores.length; i++) {
                const score = rc.chapterScores[i];
                lines.push(`| 第${i + 1}章 | ${score.toFixed(1)} | ${this.paceLabelChinese(this.paceLabel(score))} |`);
            }
            lines.push('');

            if (rc.paceChanges.length > 0) {
                lines.push('### 节奏变化');
                lines.push('');
                lines.push('| 章节 | 从 | 到 |');
                lines.push('|------|------|------|');
                for (const pc of rc.paceChanges) {
                    lines.push(`| 第${pc.chapterIndex + 1}章 | ${this.paceLabelChinese(pc.fromPace)} | ${this.paceLabelChinese(pc.toPace)} |`);
                }
                lines.push('');
            }
        }
        lines.push('');

        return lines.join('\n');
    }

    private emotionTypeLabel(type: EmotionPointType): string {
        const labels: Record<EmotionPointType, string> = {
            small_climax: '小高潮',
            big_climax: '大高潮',
            trough: '低谷',
            reversal: '反转',
            suspense: '悬念'
        };
        return labels[type] || type;
    }

    private stageTypeLabel(type: PlotStage): string {
        const labels: Record<PlotStage, string> = {
            foreshadowing: '铺垫期',
            development: '发展期',
            small_climax: '小高潮',
            big_climax: '大高潮',
            ending: '结局'
        };
        return labels[type] || type;
    }

    private emotionArcTypeLabel(type: EmotionArcType): string {
        const labels: Record<EmotionArcType, string> = {
            rags_to_riches: '贫到富（持续上升）',
            riches_to_rags: '富到贫（持续下降）',
            man_in_hole: '井底之人（先降后升）',
            icarus: '伊卡洛斯（先升后降）',
            cinderella: '灰姑娘（升-降-升）',
            oedipus: '俄狄浦斯（降-升-降）',
            steady: '平稳',
            complex: '复杂波动'
        };
        return labels[type] || type;
    }

    private nrcEmotionLabel(emotion: NRCEmotion): string {
        const labels: Record<NRCEmotion, string> = {
            anger: '愤怒',
            anticipation: '期待',
            disgust: '厌恶',
            fear: '恐惧',
            joy: '喜悦',
            sadness: '悲伤',
            surprise: '惊讶',
            trust: '信任'
        };
        return labels[emotion] || emotion;
    }

    private rhythmPatternLabel(pattern: 'fast' | 'medium' | 'slow' | 'irregular'): string {
        const labels: Record<typeof pattern, string> = {
            fast: '快速',
            medium: '中等',
            slow: '缓慢',
            irregular: '不规律'
        };
        return labels[pattern] || pattern;
    }

    private paceLabelChinese(pace: 'fast' | 'medium' | 'slow'): string {
        return pace === 'fast' ? '快速' : pace === 'slow' ? '缓慢' : '中等';
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }
}
