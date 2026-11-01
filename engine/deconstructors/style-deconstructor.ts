/**
 * style-deconstructor.ts — 文风风格拆解器（纯统计）
 *
 * 功能：基于纯统计方法分析小说写作风格，提供句式节奏、用词偏好、
 *       叙事特点、修辞手法、对话风格、段落结构、整体文风七大维度分析
 *       以及词汇丰富度（TTR/MTLD/Yule's K）、五感描写分析两个扩展维度
 * 性能：10万字取样 + async 协作式让出，避免长文本阻塞主线程
 */

import { kbBookStyleFingerprintFile } from '../../shared/paths';
import { isChineseChar } from '../../shared/text-utils';
import { VectorEnhancer } from '../vector-enhancer';
import { yieldToUI } from '../../shared/yield';
import { FIVE_SENSES_WORDS } from '../dimension-keywords';
import { GenreDetector, GenreConfigRegistry } from '../genre';
import type { GenreConfig } from '../genre';
import { LLMEnhancer } from '../llm-enhancer';
import { createLogger } from '../../shared/logger';


const log = createLogger('StyleDeconstructor');
export interface SentenceRhythm {
    avgSentenceLength: number;
    medianSentenceLength: number;
    stdSentenceLength: number;
    sentenceTypeDistribution: {
        declarative: number;
        interrogative: number;
        exclamatory: number;
        elliptical: number;
    };
    lengthDistribution: {
        short: number;
        medium: number;
        long: number;
    };
    dominantVectorStyle?: string;
    vectorStyleScores?: Record<string, number>;
}

export interface GenreTendency {
    genre: string;
    score: number;
}

export interface WordPreference {
    topWords: Array<{ word: string; count: number; frequency: number }>;
    posPreference: {
        verb: number;
        adjective: number;
        adverb: number;
    };
    modalParticles: {
        total: number;
        perThousand: number;
        topParticles: Array<{ word: string; count: number }>;
    };
    idiomDensity: number;
    colloquialismLevel: number;
    genreTendency?: GenreTendency[];
}

export interface NarrativeStyle {
    perspective: 'first_person' | 'third_person_omniscient' | 'third_person_limited' | 'mixed';
    perspectiveConfidence: number;
    descriptionRatio: {
        appearance: number;
        environment: number;
        action: number;
        psychology: number;
        total: number;
    };
    narrationRatio: number;
    dialogueRatio: number;
}

export interface RhetoricStats {
    metaphor: number;
    personification: number;
    parallelism: number;
    rhetoricalQuestion: number;
    hyperbole: number;
    antithesis: number;
    total: number;
    perThousand: number;
}

export interface DialogueStyle {
    dialogueRatio: number;
    promptWordPreference: Array<{ word: string; count: number }>;
    avgDialogueLength: number;
    lengthDistribution: {
        short: number;
        medium: number;
        long: number;
    };
}

export interface ParagraphStructure {
    avgParagraphLength: number;
    medianParagraphLength: number;
    lengthDistribution: {
        short: number;
        medium: number;
        long: number;
        veryLong: number;
    };
    openingFeatures: {
        timeWord: number;
        conjunction: number;
        subject: number;
        other: number;
    };
}

export interface OverallStyle {
    primaryStyle: string;
    secondaryStyle?: string;
    confidence: number;
    styleScores: Record<string, number>;
    vectorVerified?: boolean;
    vectorConfidence?: number;
}

export interface TwoPhaseStyleResult {
    ruleBased: StyleAnalysisResult;
    vectorVerified: StyleAnalysisResult;
    verificationDetails: {
        dimensionsVerified: string[];
        dimensionsAdjusted: string[];
        overallConfidenceChange: number;
    };
}

export type SenseType = 'visual' | 'auditory' | 'olfactory' | 'gustatory' | 'tactile';

export interface VocabularyRichnessResult {
    ttr: number;
    mtld: number;
    yulesK: number;
    hapaxLegomena: number;
    vocabularySize: number;
    totalTokens: number;
    level: 'low' | 'medium' | 'high';
    score: number;
}

export interface FiveSensesResult {
    distribution: Record<SenseType, number>;
    counts: Record<SenseType, number>;
    perThousand: Record<SenseType, number>;
    dominantSense: SenseType;
    balanceScore: number;
    level: 'low' | 'medium' | 'high';
    details: {
        visualWords: string[];
        auditoryWords: string[];
        olfactoryWords: string[];
        gustatoryWords: string[];
        tactileWords: string[];
    };
}

export interface StyleAnalysisResult {
    sentenceRhythm: SentenceRhythm;
    wordPreference: WordPreference;
    narrativeStyle: NarrativeStyle;
    rhetoric: RhetoricStats;
    dialogueStyle: DialogueStyle;
    paragraphStructure: ParagraphStructure;
    overallStyle: OverallStyle;
    vocabularyRichness?: VocabularyRichnessResult;
    fiveSenses?: FiveSensesResult;
    stats: {
        totalChars: number;
        totalSentences: number;
        totalParagraphs: number;
    };
}

const MODAL_PARTICLES = ['啊', '吧', '呢', '吗', '嘛', '哦', '嗯', '哈', '呀', '啦', '呗', '哩', '喽', '罢了'];

const VERB_KEYWORDS = [
    '说', '道', '看', '听', '想', '走', '跑', '跳', '打', '杀',
    '砍', '劈', '刺', '挥', '冲', '退', '躲', '挡', '跃', '落',
    '拿', '放', '推', '拉', '抓', '握', '扔', '抛', '接', '送',
    '吃', '喝', '睡', '醒', '坐', '站', '躺', '跪', '趴', '蹲'
];

const ADJECTIVE_KEYWORDS = [
    '美丽', '漂亮', '英俊', '帅气', '高大', '矮小', '强壮', '瘦弱',
    '聪明', '愚蠢', '善良', '邪恶', '勇敢', '懦弱', '温柔', '冷酷',
    '热情', '冷漠', '开心', '难过', '愤怒', '平静', '紧张', '放松',
    '华丽', '朴素', '豪华', '简陋', '干净', '肮脏', '明亮', '黑暗'
];

const ADVERB_KEYWORDS = [
    '非常', '十分', '极其', '格外', '特别', '相当', '很', '最', '更', '比较',
    '忽然', '突然', '渐渐', '慢慢', '缓缓', '迅速', '快速', '立即', '马上', '顿时',
    '轻轻地', '悄悄地', '默默地', '深深地', '牢牢地', '紧紧地', '狠狠地', '淡淡'
];

const APPEARANCE_KEYWORDS = [
    '长得', '相貌', '面容', '身材', '容貌', '眉目', '眼神', '气质', '身着', '穿着',
    '脸上', '眉宇', '五官', '皮肤', '头发', '身姿', '身形', '外表', '外貌', '长相'
];

const ENVIRONMENT_KEYWORDS = [
    '天空', '大地', '山川', '河流', '森林', '城市', '街道', '房间', '宫殿', '山谷',
    '阳光', '月光', '星光', '风雨', '雷电', '云雾', '花草', '树木', '建筑', '景色'
];

const ACTION_KEYWORDS = [
    '跑', '跳', '打', '砍', '刺', '挥', '冲', '退', '躲', '挡',
    '跃', '落', '攻', '防', '击', '踢', '摔', '推', '拉', '抓',
    '捏', '握', '斩', '砸', '甩', '扑', '咬', '撕', '扯', '拽'
];

const PSYCHOLOGY_KEYWORDS = [
    '心想', '暗道', '暗想', '觉得', '认为', '知道', '明白', '感觉', '感到',
    '思索', '思考', '考虑', '琢磨', '思量', '盘算', '猜测', '怀疑', '相信', '担心'
];

const METAPHOR_KEYWORDS = ['像', '如', '似', '仿佛', '犹如', '好比', '宛如', '宛若', '如同', '好似'];

const RHETORICAL_QUESTION_KEYWORDS = ['难道', '岂', '何不', '何尝', '不是吗', '对不对', '是吗', '对吧'];

const HYPERBOLE_KEYWORDS = ['极度', '无比', '万分', '绝顶', '惊天动地', '泣鬼神', '天崩地裂', '地动山摇'];

const DIALOGUE_PROMPT_WORDS = [
    '说', '道', '问', '喊', '叫', '答', '笑', '叹', '怒道', '冷笑', '低语', '喃喃',
    '轻声', '大声', '心想', '暗道', '回答', '回应', '说道', '问道', '喊道', '叫道'
];

const TIME_OPENING_WORDS = [
    '这日', '那日', '次日', '翌日', '清晨', '傍晚', '深夜', '三年后', '五日后',
    '第二天', '第三天', '一个月后', '一年后', '十年后', '此刻', '此时', '这时', '那时'
];

const CONJUNCTION_OPENING_WORDS = [
    '然而', '但是', '不过', '于是', '因此', '所以', '虽然', '如果', '即使', '况且',
    '何况', '而且', '并且', '然后', '接着', '随后', '终于', '毕竟', '原来', '难怪'
];

const SUBJECT_OPENING_WORDS = ['他', '她', '它', '我', '你', '我们', '你们', '他们', '她们', '它们'];

const COLLOQUIAL_WORDS = [
    '我', '你', '他', '说', '就是', '然后', '可是', '但是', '所以', '因为', '如果',
    '啊', '吧', '呢', '吗', '哦', '嗯', '哈', '呀', '啦', '呗',
    '啥', '咋', '怎么', '什么', '干嘛', '没事儿', '没关系', '不好意思'
];

const STYLE_LABELS: Record<string, string> = {
    concise: '简洁',
    gorgeous: '华丽',
    cold: '冷峻',
    delicate: '细腻',
    passionate: '热血',
    humorous: '幽默',
    heavy: '沉重',
    relaxed: '轻松'
};

const SENSE_TYPES: SenseType[] = ['visual', 'auditory', 'olfactory', 'gustatory', 'tactile'];

const SENSE_LABELS: Record<SenseType, string> = {
    visual: '视觉',
    auditory: '听觉',
    olfactory: '嗅觉',
    gustatory: '味觉',
    tactile: '触觉'
};

const VR_LEVEL_LABELS: Record<'low' | 'medium' | 'high', string> = {
    low: '低',
    medium: '中',
    high: '高'
};

const STYLE_VECTOR_REFERENCES: Record<string, string> = {
    concise: '简洁文风：文字简练干净，短句为主，少修饰多动作，直入主题，不拖泥带水，每一句话都有信息量',
    gorgeous: '华丽文风：辞藻丰富优美，长句多修饰密，描写细腻生动，意境深远，用词讲究富有文采',
    cold: '冷峻文风：客观冷静克制，用词精准犀利，少情绪多叙述，笔锋锐利，不带个人感情色彩',
    delicate: '细腻文风：细节丰富饱满，心理描写深入，情感表达细腻，节奏舒缓，注重内心世界刻画',
    passionate: '热血文风：激情澎湃昂扬，动作场面激烈，情绪高涨饱满，节奏快速，充满斗志与力量感',
    humorous: '幽默文风：语言轻松诙谐，笑点密集有趣，对话生动俏皮，让人会心一笑，充满生活趣味',
    heavy: '沉重文风：氛围压抑凝重，情感深沉厚重，节奏缓慢压抑，引人深思，充满悲剧色彩',
    relaxed: '轻松文风：节奏明快愉悦，氛围轻松愉快，对话活泼有趣，简单快乐，让人感到舒心'
};

const SENTENCE_STYLE_VECTOR_REFERENCES: Record<string, string> = {
    concise: '简洁句式：短句多，用词精炼，少修饰，节奏明快，干脆利落',
    gorgeous: '华丽句式：长句多，辞藻丰富，修饰繁复，意境优美，文采斐然',
    cold: '冷峻句式：句子短促，用词精准，笔锋犀利，客观冷静，不带感情',
    delicate: '细腻句式：句子舒展，细节丰富，描写深入，节奏舒缓，娓娓道来'
};

const PERSPECTIVE_VECTOR_REFERENCES: Record<string, string> = {
    first_person: '第一人称：以"我"的视角叙述，内心独白多，主观感受强，讲述自己的故事',
    third_person_omniscient: '第三人称全知：上帝视角，可切换不同人物，展现全局，知道所有事情',
    third_person_limited: '第三人称限知：跟随主角视角，只能知道主角知道的事，受限的叙述角度'
};

const GENRE_VECTOR_REFERENCES: Record<string, string> = {
    xuanhuan: '玄幻题材：修炼 境界 功法 丹药 法宝 妖兽 宗门 洞天 灵力 神魂 修仙 修真',
    dushi: '都市题材：职场 商战 都市 总裁 豪门 投资 创业 都市丽人 精英 白领',
    yanqing: '言情题材：恋爱 心动 暗恋 霸道总裁 甜宠 虐恋 青梅竹马 日久生情 爱情',
    lishi: '历史题材：朝代 皇帝 大臣 将军 科举 江湖 朝堂 战争 治国 古代',
    kehuan: '科幻题材：星际 机甲 基因 宇宙飞船 外星人 人工智能 未来世界 太空',
    xuanyi: '悬疑题材：推理 侦探 凶手 谜团 线索 真相 阴谋 惊悚 犯罪 破案',
    wuxia: '武侠题材：江湖 门派 武功 秘籍 侠士 剑客 恩怨情仇 武林盟主 功夫',
    youxi: '游戏题材：副本 装备 等级 技能 任务 NPC 公会 玩家 通关 打怪'
};

export class StyleDeconstructor {
    private modalParticleSet: Set<string>;
    private verbSet: Set<string>;
    private adjectiveSet: Set<string>;
    private adverbSet: Set<string>;
    private appearanceSet: Set<string>;
    private environmentSet: Set<string>;
    private actionSet: Set<string>;
    private psychologySet: Set<string>;
    private metaphorSet: Set<string>;
    private rhetoricalQuestionSet: Set<string>;
    private hyperboleSet: Set<string>;
    private dialoguePromptSet: Set<string>;
    private timeOpeningSet: Set<string>;
    private conjunctionOpeningSet: Set<string>;
    private subjectOpeningSet: Set<string>;
    private colloquialSet: Set<string>;
    private senseWordMap: Map<string, SenseType>;
    private senseMaxWordLen: number;
    private vectorEnhancer?: VectorEnhancer;
    private genreDetector: GenreDetector;
    private genreRegistry: GenreConfigRegistry;
    private llmEnhancer?: LLMEnhancer;

    constructor(vectorEnhancer?: VectorEnhancer) {
        this.modalParticleSet = new Set(MODAL_PARTICLES);
        this.verbSet = new Set(VERB_KEYWORDS);
        this.adjectiveSet = new Set(ADJECTIVE_KEYWORDS);
        this.adverbSet = new Set(ADVERB_KEYWORDS);
        this.appearanceSet = new Set(APPEARANCE_KEYWORDS);
        this.environmentSet = new Set(ENVIRONMENT_KEYWORDS);
        this.actionSet = new Set(ACTION_KEYWORDS);
        this.psychologySet = new Set(PSYCHOLOGY_KEYWORDS);
        this.metaphorSet = new Set(METAPHOR_KEYWORDS);
        this.rhetoricalQuestionSet = new Set(RHETORICAL_QUESTION_KEYWORDS);
        this.hyperboleSet = new Set(HYPERBOLE_KEYWORDS);
        this.dialoguePromptSet = new Set(DIALOGUE_PROMPT_WORDS);
        this.timeOpeningSet = new Set(TIME_OPENING_WORDS);
        this.conjunctionOpeningSet = new Set(CONJUNCTION_OPENING_WORDS);
        this.subjectOpeningSet = new Set(SUBJECT_OPENING_WORDS);
        this.colloquialSet = new Set(COLLOQUIAL_WORDS);
        this.vectorEnhancer = vectorEnhancer;
        this.genreDetector = new GenreDetector();
        this.genreRegistry = GenreConfigRegistry.getInstance();

        this.senseWordMap = new Map();
        this.senseMaxWordLen = 1;
        for (const sense of SENSE_TYPES) {
            const words = (FIVE_SENSES_WORDS as Record<SenseType, string[]>)[sense];
            if (!words) continue;
            for (const w of words) {
                if (!this.senseWordMap.has(w)) {
                    this.senseWordMap.set(w, sense);
                }
                if (w.length > this.senseMaxWordLen) {
                    this.senseMaxWordLen = w.length;
                }
            }
        }
    }

    /**
     * 注入 LLM 增强器。注入后 analyze 方法末尾会调用 LLM 做语义提炼。
     * 不注入时 analyze 行为完全不变（纯统计）。
     */
    setLLMEnhancer(llmEnhancer?: LLMEnhancer): void {
        this.llmEnhancer = llmEnhancer;
    }

    async analyze(text: string, genreConfig?: GenreConfig): Promise<StyleAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        const resolvedGenreConfig = genreConfig ?? this.detectGenreConfig(text);

        const paragraphs = this.splitParagraphs(text);
        const totalChars = text.length;
        const sentences = this.splitSentences(text);
        const totalSentences = sentences.length;
        const totalParagraphs = paragraphs.length;

        const sentenceRhythm = this.analyzeSentenceRhythm(text, sentences);
        const wordPreference = this.analyzeWordPreference(text, totalChars);
        await yieldToUI();

        const narrativeStyle = this.analyzeNarrativeStyle(text, paragraphs);
        const rhetoric = this.analyzeRhetoric(text, totalChars);
        await yieldToUI();

        const dialogueStyle = this.analyzeDialogueStyle(text);
        const paragraphStructure = this.analyzeParagraphStructure(paragraphs);
        await yieldToUI();

        const vocabularyRichness = this.analyzeVocabularyRichness(text, totalChars);
        await yieldToUI();

        const fiveSenses = this.analyzeFiveSenses(text, totalChars);
        await yieldToUI();

        const overallStyle = this.classifyOverallStyle(
            sentenceRhythm,
            wordPreference,
            narrativeStyle,
            rhetoric,
            dialogueStyle,
            text,
            resolvedGenreConfig
        );

        const result: StyleAnalysisResult = {
            sentenceRhythm,
            wordPreference,
            narrativeStyle,
            rhetoric,
            dialogueStyle,
            paragraphStructure,
            overallStyle,
            vocabularyRichness,
            fiveSenses,
            stats: {
                totalChars,
                totalSentences,
                totalParagraphs
            }
        };

        // 可选 LLM 增强：仅在注入了 llmEnhancer 时调用，失败时优雅降级
        if (this.llmEnhancer) {
            try {
                const contextText = LLMEnhancer.buildContextForDimension('style', text, paragraphs);
                return await this.llmEnhancer.enhanceResult(result, contextText, 'style', resolvedGenreConfig);
            } catch (e) {
                log.warn('[StyleDeconstructor] LLM 增强失败，使用纯统计结果', e);
                return result;
            }
        }

        return result;
    }

    async analyzeWithVector(text: string, genreConfig?: GenreConfig): Promise<StyleAnalysisResult> {
        const baseResult = await this.analyze(text, genreConfig);
        await yieldToUI();

        if (!this.vectorEnhancer || !text || text.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.warn('[StyleDeconstructor] 向量模型不可用，返回纯统计结果');
                return baseResult;
            }
        } catch (e) {
            log.warn('[StyleDeconstructor] 向量增强不可用，降级为纯统计', e);
            return baseResult;
        }

        let enhancedResult = { ...baseResult };

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceOverallStyle(text, enhancedResult);
        } catch (e) {
            log.warn('[StyleDeconstructor] 整体文风向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceSentenceStyle(text, enhancedResult);
        } catch (e) {
            log.warn('[StyleDeconstructor] 句式风格向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceNarrativeStyle(text, enhancedResult);
        } catch (e) {
            log.warn('[StyleDeconstructor] 叙事风格向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceGenreTendency(text, enhancedResult);
        } catch (e) {
            log.warn('[StyleDeconstructor] 题材倾向向量增强失败', e);
        }

        return enhancedResult;
    }

    async analyzeTwoPhase(text: string, genreConfig?: GenreConfig): Promise<TwoPhaseStyleResult> {
        const ruleBased = await this.analyze(text, genreConfig);

        if (!this.vectorEnhancer || !text || text.length === 0) {
            return {
                ruleBased,
                vectorVerified: ruleBased,
                verificationDetails: {
                    dimensionsVerified: [],
                    dimensionsAdjusted: [],
                    overallConfidenceChange: 0,
                },
            };
        }

        let vectorAvailable = false;
        try {
            vectorAvailable = await this.vectorEnhancer.isAvailable();
        } catch {
            vectorAvailable = false;
        }

        if (!vectorAvailable) {
            return {
                ruleBased,
                vectorVerified: ruleBased,
                verificationDetails: {
                    dimensionsVerified: [],
                    dimensionsAdjusted: [],
                    overallConfidenceChange: 0,
                },
            };
        }

        let verifiedResult = { ...ruleBased };
        const dimensionsVerified: string[] = [];
        const dimensionsAdjusted: string[] = [];

        const originalConfidence = ruleBased.overallStyle.confidence;

        try {
            const beforeStyle = verifiedResult.overallStyle.primaryStyle;
            verifiedResult = await this.enhanceOverallStyle(text, verifiedResult);
            const afterStyle = verifiedResult.overallStyle.primaryStyle;
            dimensionsVerified.push('整体文风');
            if (beforeStyle !== afterStyle) {
                dimensionsAdjusted.push('整体文风');
            }
            verifiedResult.overallStyle.vectorVerified = true;
            verifiedResult.overallStyle.vectorConfidence = verifiedResult.overallStyle.confidence;
        } catch (e) {
            log.warn('[StyleDeconstructor] 整体文风向量验证失败', e);
        }

        try {
            const beforeVectorStyle = verifiedResult.sentenceRhythm.dominantVectorStyle;
            verifiedResult = await this.enhanceSentenceStyle(text, verifiedResult);
            const afterVectorStyle = verifiedResult.sentenceRhythm.dominantVectorStyle;
            dimensionsVerified.push('句式节奏');
            if (beforeVectorStyle !== afterVectorStyle) {
                dimensionsAdjusted.push('句式节奏');
            }
        } catch (e) {
            log.warn('[StyleDeconstructor] 句式风格向量验证失败', e);
        }

        try {
            const beforePerspective = verifiedResult.narrativeStyle.perspective;
            verifiedResult = await this.enhanceNarrativeStyle(text, verifiedResult);
            const afterPerspective = verifiedResult.narrativeStyle.perspective;
            dimensionsVerified.push('叙事风格');
            if (beforePerspective !== afterPerspective) {
                dimensionsAdjusted.push('叙事风格');
            }
        } catch (e) {
            log.warn('[StyleDeconstructor] 叙事风格向量验证失败', e);
        }

        try {
            const beforeGenres = JSON.stringify(verifiedResult.wordPreference.genreTendency);
            verifiedResult = await this.enhanceGenreTendency(text, verifiedResult);
            const afterGenres = JSON.stringify(verifiedResult.wordPreference.genreTendency);
            dimensionsVerified.push('题材倾向');
            if (beforeGenres !== afterGenres) {
                dimensionsAdjusted.push('题材倾向');
            }
        } catch (e) {
            log.warn('[StyleDeconstructor] 题材倾向向量验证失败', e);
        }

        const newConfidence = verifiedResult.overallStyle.confidence;
        const confidenceChange = newConfidence - originalConfidence;

        return {
            ruleBased,
            vectorVerified: verifiedResult,
            verificationDetails: {
                dimensionsVerified,
                dimensionsAdjusted,
                overallConfidenceChange: this.round2(confidenceChange),
            },
        };
    }

    private async enhanceOverallStyle(text: string, result: StyleAnalysisResult): Promise<StyleAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const samples: string[] = [];
        const sampleLen = 1500;

        if (text.length <= sampleLen * 3) {
            samples.push(text);
        } else {
            samples.push(text.slice(0, sampleLen));
            const midStart = Math.floor(text.length / 2) - Math.floor(sampleLen / 2);
            samples.push(text.slice(midStart, midStart + sampleLen));
            samples.push(text.slice(text.length - sampleLen));
        }

        const styleKeys = Object.keys(STYLE_VECTOR_REFERENCES);
        const styleRefs = styleKeys.map(k => STYLE_VECTOR_REFERENCES[k]);

        const allTexts = [...samples, ...styleRefs];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const sampleVectors = allVectors.slice(0, samples.length);
        const refVectors = allVectors.slice(samples.length);

        const vectorScores: Record<string, number> = {};
        for (let i = 0; i < styleKeys.length; i++) {
            let totalSim = 0;
            for (const sampleVec of sampleVectors) {
                totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
            }
            vectorScores[styleKeys[i]] = totalSim / sampleVectors.length;
        }

        const maxVecScore = Math.max(...Object.values(vectorScores));
        const minVecScore = Math.min(...Object.values(vectorScores));
        const vecRange = maxVecScore - minVecScore || 1;
        const normalizedVecScores: Record<string, number> = {};
        for (const [k, v] of Object.entries(vectorScores)) {
            normalizedVecScores[k] = (v - minVecScore) / vecRange;
        }

        const statScores = result.overallStyle.styleScores;
        const fusedScores: Record<string, number> = {};
        for (const key of styleKeys) {
            const statScore = statScores[key] || 0;
            const vecScore = normalizedVecScores[key] || 0;
            fusedScores[key] = statScore * 0.4 + vecScore * 0.6;
        }

        const sortedStyles = Object.entries(fusedScores).sort((a, b) => b[1] - a[1]);
        const primaryStyle = sortedStyles[0]?.[0] || '未知';
        const secondaryStyle = sortedStyles[1]?.[0];

        const totalScore = Object.values(fusedScores).reduce((a, b) => a + b, 0) || 1;
        const confidence = (sortedStyles[0]?.[1] || 0) / totalScore * (styleKeys.length - 1);

        const normalizedFusedScores: Record<string, number> = {};
        for (const [style, score] of Object.entries(fusedScores)) {
            normalizedFusedScores[style] = this.round2(score);
        }

        return {
            ...result,
            overallStyle: {
                primaryStyle: STYLE_LABELS[primaryStyle] || primaryStyle,
                secondaryStyle: secondaryStyle ? (STYLE_LABELS[secondaryStyle] || secondaryStyle) : undefined,
                confidence: this.round2(this.clamp01(confidence)),
                styleScores: normalizedFusedScores
            }
        };
    }

    private async enhanceSentenceStyle(text: string, result: StyleAnalysisResult): Promise<StyleAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const sentences = this.splitSentences(text);
        if (sentences.length === 0) return result;

        const shortSentences = sentences.filter(s => this.countChineseChars(s) <= 10);
        const mediumSentences = sentences.filter(s => {
            const len = this.countChineseChars(s);
            return len > 10 && len <= 30;
        });
        const longSentences = sentences.filter(s => this.countChineseChars(s) > 30);

        const sampleSentences: string[] = [];
        const targetPerType = 5;

        for (let i = 0; i < Math.min(targetPerType, shortSentences.length); i++) {
            const idx = Math.floor(i * shortSentences.length / Math.min(targetPerType, shortSentences.length));
            sampleSentences.push(shortSentences[idx]);
        }
        for (let i = 0; i < Math.min(targetPerType, mediumSentences.length); i++) {
            const idx = Math.floor(i * mediumSentences.length / Math.min(targetPerType, mediumSentences.length));
            sampleSentences.push(mediumSentences[idx]);
        }
        for (let i = 0; i < Math.min(targetPerType, longSentences.length); i++) {
            const idx = Math.floor(i * longSentences.length / Math.min(targetPerType, longSentences.length));
            sampleSentences.push(longSentences[idx]);
        }

        if (sampleSentences.length === 0) return result;

        const sentKeys = Object.keys(SENTENCE_STYLE_VECTOR_REFERENCES);
        const sentRefs = sentKeys.map(k => SENTENCE_STYLE_VECTOR_REFERENCES[k]);

        const allTexts = [...sampleSentences, ...sentRefs];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const sampleVectors = allVectors.slice(0, sampleSentences.length);
        const refVectors = allVectors.slice(sampleSentences.length);

        const sentScores: Record<string, number> = {};
        for (let i = 0; i < sentKeys.length; i++) {
            let totalSim = 0;
            for (const sampleVec of sampleVectors) {
                totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
            }
            sentScores[sentKeys[i]] = totalSim / sampleVectors.length;
        }

        const maxSentScore = Math.max(...Object.values(sentScores));
        const dominantSentStyle = Object.entries(sentScores).find(([, v]) => v === maxSentScore)?.[0];

        const enhancedRhythm: SentenceRhythm = { ...result.sentenceRhythm };
        if (dominantSentStyle && sentScores[dominantSentStyle] > 0.5) {
            enhancedRhythm.dominantVectorStyle = dominantSentStyle;
            enhancedRhythm.vectorStyleScores = sentScores;
        }

        return {
            ...result,
            sentenceRhythm: enhancedRhythm
        };
    }

    private async enhanceNarrativeStyle(text: string, result: StyleAnalysisResult): Promise<StyleAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const paragraphs = this.splitParagraphs(text);
        if (paragraphs.length < 5) return result;

        const sampleParagraphs: string[] = [];
        const sampleCount = Math.min(10, paragraphs.length);

        for (let i = 0; i < sampleCount; i++) {
            const idx = Math.floor(i * paragraphs.length / sampleCount);
            sampleParagraphs.push(paragraphs[idx]);
        }

        const perspKeys = Object.keys(PERSPECTIVE_VECTOR_REFERENCES);
        const perspRefs = perspKeys.map(k => PERSPECTIVE_VECTOR_REFERENCES[k]);

        const allTexts = [...sampleParagraphs, ...perspRefs];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const sampleVectors = allVectors.slice(0, sampleParagraphs.length);
        const refVectors = allVectors.slice(sampleParagraphs.length);

        const perspScores: Record<string, number> = {};
        for (let i = 0; i < perspKeys.length; i++) {
            let totalSim = 0;
            for (const sampleVec of sampleVectors) {
                totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
            }
            perspScores[perspKeys[i]] = totalSim / sampleVectors.length;
        }

        const maxVecScore = Math.max(...Object.values(perspScores));
        const vecPerspective = Object.entries(perspScores).find(([, v]) => v === maxVecScore)?.[0] || 'third_person_omniscient';

        const keywordPerspective = result.narrativeStyle.perspective;
        const keywordConfidence = result.narrativeStyle.perspectiveConfidence;
        const vecConfidence = this.clamp01(maxVecScore);

        const fusedConfidence = keywordConfidence * 0.5 + vecConfidence * 0.5;

        let finalPerspective = keywordPerspective;
        if (vecConfidence > keywordConfidence + 0.1) {
            finalPerspective = vecPerspective as NarrativeStyle['perspective'];
        }

        return {
            ...result,
            narrativeStyle: {
                ...result.narrativeStyle,
                perspective: finalPerspective,
                perspectiveConfidence: this.round2(this.clamp01(fusedConfidence))
            }
        };
    }

    private async enhanceGenreTendency(text: string, result: StyleAnalysisResult): Promise<StyleAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const top20Words = result.wordPreference.topWords.slice(0, 20);
        if (top20Words.length === 0) return result;

        const wordsText = top20Words.map(w => w.word).join(' ');

        const genreKeys = Object.keys(GENRE_VECTOR_REFERENCES);
        const genreRefs = genreKeys.map(k => GENRE_VECTOR_REFERENCES[k]);

        const allTexts = [wordsText, ...genreRefs];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const wordsVector = allVectors[0];
        const refVectors = allVectors.slice(1);

        const genreScores: Array<{ genre: string; score: number }> = [];
        for (let i = 0; i < genreKeys.length; i++) {
            const score = this.vectorEnhancer.cosineSimilarity(wordsVector, refVectors[i]);
            genreScores.push({ genre: genreKeys[i], score: this.round2(score) });
        }

        genreScores.sort((a, b) => b.score - a.score);
        const top3Genres = genreScores.slice(0, 3);

        const genreLabels: Record<string, string> = {
            xuanhuan: '玄幻',
            dushi: '都市',
            yanqing: '言情',
            lishi: '历史',
            kehuan: '科幻',
            xuanyi: '悬疑',
            wuxia: '武侠',
            youxi: '游戏'
        };

        const labeledGenres = top3Genres.map(g => ({
            genre: genreLabels[g.genre] || g.genre,
            score: g.score
        }));

        return {
            ...result,
            wordPreference: {
                ...result.wordPreference,
                genreTendency: labeledGenres
            }
        };
    }

    async saveAnalysisToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        result: StyleAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookStyleFingerprintFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    private getEmptyResult(): StyleAnalysisResult {
        return {
            sentenceRhythm: {
                avgSentenceLength: 0,
                medianSentenceLength: 0,
                stdSentenceLength: 0,
                sentenceTypeDistribution: {
                    declarative: 0,
                    interrogative: 0,
                    exclamatory: 0,
                    elliptical: 0
                },
                lengthDistribution: {
                    short: 0,
                    medium: 0,
                    long: 0
                }
            },
            wordPreference: {
                topWords: [],
                posPreference: {
                    verb: 0,
                    adjective: 0,
                    adverb: 0
                },
                modalParticles: {
                    total: 0,
                    perThousand: 0,
                    topParticles: []
                },
                idiomDensity: 0,
                colloquialismLevel: 0
            },
            narrativeStyle: {
                perspective: 'third_person_omniscient',
                perspectiveConfidence: 0,
                descriptionRatio: {
                    appearance: 0,
                    environment: 0,
                    action: 0,
                    psychology: 0,
                    total: 0
                },
                narrationRatio: 0,
                dialogueRatio: 0
            },
            rhetoric: {
                metaphor: 0,
                personification: 0,
                parallelism: 0,
                rhetoricalQuestion: 0,
                hyperbole: 0,
                antithesis: 0,
                total: 0,
                perThousand: 0
            },
            dialogueStyle: {
                dialogueRatio: 0,
                promptWordPreference: [],
                avgDialogueLength: 0,
                lengthDistribution: {
                    short: 0,
                    medium: 0,
                    long: 0
                }
            },
            paragraphStructure: {
                avgParagraphLength: 0,
                medianParagraphLength: 0,
                lengthDistribution: {
                    short: 0,
                    medium: 0,
                    long: 0,
                    veryLong: 0
                },
                openingFeatures: {
                    timeWord: 0,
                    conjunction: 0,
                    subject: 0,
                    other: 0
                }
            },
            overallStyle: {
                primaryStyle: '未知',
                confidence: 0,
                styleScores: {}
            },
            vocabularyRichness: {
                ttr: 0,
                mtld: 0,
                yulesK: 0,
                hapaxLegomena: 0,
                vocabularySize: 0,
                totalTokens: 0,
                level: 'low',
                score: 0
            },
            fiveSenses: {
                distribution: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
                counts: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
                perThousand: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
                dominantSense: 'visual',
                balanceScore: 0,
                level: 'low',
                details: { visualWords: [], auditoryWords: [], olfactoryWords: [], gustatoryWords: [], tactileWords: [] }
            },
            stats: {
                totalChars: 0,
                totalSentences: 0,
                totalParagraphs: 0
            }
        };
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private splitSentences(text: string): string[] {
        const sentences: string[] = [];
        const regex = /[^。！？…!?]+[。！？…!?]+/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const s = match[0].trim();
            if (s.length > 0) {
                sentences.push(s);
            }
        }
        if (sentences.length === 0 && text.trim().length > 0) {
            sentences.push(text.trim());
        }
        return sentences;
    }

    private analyzeSentenceRhythm(text: string, sentences: string[]): SentenceRhythm {
        if (sentences.length === 0) {
            return {
                avgSentenceLength: 0,
                medianSentenceLength: 0,
                stdSentenceLength: 0,
                sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
                lengthDistribution: { short: 0, medium: 0, long: 0 }
            };
        }

        const lengths = sentences.map(s => this.countChineseChars(s));
        const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const sortedLengths = [...lengths].sort((a, b) => a - b);
        const medianLength = sortedLengths.length % 2 === 0
            ? (sortedLengths[sortedLengths.length / 2 - 1] + sortedLengths[sortedLengths.length / 2]) / 2
            : sortedLengths[Math.floor(sortedLengths.length / 2)];

        const variance = lengths.reduce((sum, len) => sum + (len - avgLength) ** 2, 0) / lengths.length;
        const stdLength = Math.sqrt(variance);

        let declarative = 0;
        let interrogative = 0;
        let exclamatory = 0;
        let elliptical = 0;

        for (const s of sentences) {
            const lastChar = s[s.length - 1];
            if (lastChar === '？' || lastChar === '?') {
                interrogative++;
            } else if (lastChar === '！' || lastChar === '!') {
                exclamatory++;
            } else if (lastChar === '…') {
                elliptical++;
            } else {
                declarative++;
            }
        }

        const total = sentences.length;
        let short = 0;
        let medium = 0;
        let long = 0;

        for (const len of lengths) {
            if (len <= 10) {
                short++;
            } else if (len <= 30) {
                medium++;
            } else {
                long++;
            }
        }

        return {
            avgSentenceLength: this.round2(avgLength),
            medianSentenceLength: this.round2(medianLength),
            stdSentenceLength: this.round2(stdLength),
            sentenceTypeDistribution: {
                declarative: this.round2(declarative / total),
                interrogative: this.round2(interrogative / total),
                exclamatory: this.round2(exclamatory / total),
                elliptical: this.round2(elliptical / total)
            },
            lengthDistribution: {
                short: this.round2(short / total),
                medium: this.round2(medium / total),
                long: this.round2(long / total)
            }
        };
    }

    private analyzeWordPreference(text: string, totalChars: number): WordPreference {

        const wordFreq = new Map<string, number>();

        for (let len = 2; len <= 4; len++) {
            for (let i = 0; i <= text.length - len; i++) {
                const word = text.slice(i, i + len);
                if (this.isAllChinese(word)) {
                    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
                }
            }
        }

        const topWords = Array.from(wordFreq.entries())
            .filter(([word]) => word.length >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([word, count]) => ({
                word,
                count,
                frequency: this.round3(count / Math.max(totalChars, 1))
            }));

        // 子串去重：短词是长词的子串且频次接近（短词频次 ≤ 长词频次 × 1.2）时移除短词
        // 解决 2-4 字滑动窗口产生的 ["紫川","川秀","紫川秀"] 子串重复
        const dedupedTopWords = this.deduplicateTopWords(topWords);

        const verbCount = this.countKeywords(text, this.verbSet);
        const adjCount = this.countKeywords(text, this.adjectiveSet);
        const advCount = this.countKeywords(text, this.adverbSet);
        const posTotal = verbCount + adjCount + advCount || 1;

        const particleCounts = new Map<string, number>();
        let particleTotal = 0;
        for (const p of MODAL_PARTICLES) {
            const count = (text.match(new RegExp(p, 'g')) || []).length;
            if (count > 0) {
                particleCounts.set(p, count);
                particleTotal += count;
            }
        }

        const topParticles = Array.from(particleCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        const idiomCount = this.detectIdioms(text);

        let colloquialCount = 0;
        for (const word of COLLOQUIAL_WORDS) {
            colloquialCount += (text.match(new RegExp(word, 'g')) || []).length;
        }
        const colloquialismLevel = this.clamp01(colloquialCount / Math.max(totalChars * 0.05, 1));

        return {
            topWords: dedupedTopWords,
            posPreference: {
                verb: this.round2(verbCount / posTotal),
                adjective: this.round2(adjCount / posTotal),
                adverb: this.round2(advCount / posTotal)
            },
            modalParticles: {
                total: particleTotal,
                perThousand: this.round2((particleTotal / Math.max(totalChars, 1)) * 1000),
                topParticles
            },
            idiomDensity: this.round2((idiomCount / Math.max(totalChars, 1)) * 1000),
            colloquialismLevel: this.round2(colloquialismLevel)
        };
    }

    /**
     * topWords 子串去重：
     * - 短词是长词的子串，且短词频次 ≤ 长词频次 × 1.2（短词几乎全部来自长词上下文）时移除短词
     * - 3+ 字长词频次 > 50 时优先保留（启发式识别专有名词，如"紫川秀"）
     * - 保持原排序（按频次降序）
     */
    private deduplicateTopWords(
        topWords: Array<{ word: string; count: number; frequency: number }>
    ): Array<{ word: string; count: number; frequency: number }> {
        if (topWords.length === 0) return topWords;

        // 按词长降序排序，便于后续用长词检查短词子串
        const byLenDesc = [...topWords].sort((a, b) => b.word.length - a.word.length);
        const removed = new Set<string>();

        for (let i = 0; i < byLenDesc.length; i++) {
            const longer = byLenDesc[i];
            if (removed.has(longer.word)) continue;
            for (let j = i + 1; j < byLenDesc.length; j++) {
                const shorter = byLenDesc[j];
                if (removed.has(shorter.word)) continue;
                if (shorter.word.length >= longer.word.length) continue;

                // 短词必须是长词的子串
                if (!longer.word.includes(shorter.word)) continue;

                // 3+ 字长词频次 > 50 时视为专有名词，强制保留长词并移除短词
                // 否则按频次接近规则：短词频次 ≤ 长词频次 × 1.2 时移除短词
                const isProperNoun = longer.word.length >= 3 && longer.count > 50;
                const isFreqClose = shorter.count <= longer.count * 1.2;

                if (isProperNoun || isFreqClose) {
                    removed.add(shorter.word);
                }
            }
        }

        // 保持原排序
        return topWords.filter(item => !removed.has(item.word));
    }

    private detectIdioms(text: string): number {
        let count = 0;
        const commonWords = new Set([
            '的是', '了一', '一个', '没有', '不是', '我们', '你们', '他们', '这个', '那个',
            '什么', '怎么', '为什么', '因为', '所以', '但是', '然后', '可以', '可能', '应该',
            '自己', '一样', '一下', '一直', '已经', '还有', '就是', '只是', '只有', '还有'
        ]);

        for (let i = 0; i <= text.length - 4; i++) {
            const word = text.slice(i, i + 4);
            if (this.isAllChinese(word) && !commonWords.has(word)) {
                count++;
            }
        }

        return Math.floor(count * 0.1);
    }

    private analyzeNarrativeStyle(text: string, paragraphs: string[]): NarrativeStyle {
        const firstPersonCount = (text.match(/我[们的]/g) || []).length + (text.match(/^我/gm) || []).length;
        const thirdPersonCount = (text.match(/[他她它][们的]/g) || []).length + (text.match(/^[他她它]/gm) || []).length;

        let perspective: 'first_person' | 'third_person_omniscient' | 'third_person_limited' | 'mixed';
        let perspectiveConfidence: number;

        const totalPersons = firstPersonCount + thirdPersonCount;
        if (totalPersons === 0) {
            perspective = 'third_person_omniscient';
            perspectiveConfidence = 0.3;
        } else {
            const firstRatio = firstPersonCount / totalPersons;
            const thirdRatio = thirdPersonCount / totalPersons;

            if (firstRatio > 0.7) {
                perspective = 'first_person';
                perspectiveConfidence = firstRatio;
            } else if (thirdRatio > 0.8) {
                perspective = 'third_person_omniscient';
                perspectiveConfidence = thirdRatio;
            } else if (firstRatio > 0.3 && thirdRatio > 0.3) {
                perspective = 'mixed';
                perspectiveConfidence = 0.5;
            } else {
                perspective = 'third_person_limited';
                perspectiveConfidence = thirdRatio;
            }
        }

        const totalChars = text.length;
        const appearanceCount = this.countKeywords(text, this.appearanceSet);
        const environmentCount = this.countKeywords(text, this.environmentSet);
        const actionCount = this.countKeywords(text, this.actionSet);
        const psychologyCount = this.countKeywords(text, this.psychologySet);

        const dialogueChars = this.calculateDialogueChars(text);
        const dialogueRatio = dialogueChars / Math.max(totalChars, 1);

        const descriptionTotal = appearanceCount + environmentCount + actionCount + psychologyCount;
        const descriptionRatio = Math.min(1, descriptionTotal / Math.max(totalChars * 0.02, 1));
        const narrationRatio = this.clamp01(1 - dialogueRatio - descriptionRatio * 0.3);

        return {
            perspective,
            perspectiveConfidence: this.round2(perspectiveConfidence),
            descriptionRatio: {
                appearance: this.round2(appearanceCount / Math.max(descriptionTotal, 1)),
                environment: this.round2(environmentCount / Math.max(descriptionTotal, 1)),
                action: this.round2(actionCount / Math.max(descriptionTotal, 1)),
                psychology: this.round2(psychologyCount / Math.max(descriptionTotal, 1)),
                total: this.round2(descriptionRatio)
            },
            narrationRatio: this.round2(narrationRatio),
            dialogueRatio: this.round2(dialogueRatio)
        };
    }

    private analyzeRhetoric(text: string, totalChars: number): RhetoricStats {
        const metaphorCount = this.countKeywords(text, this.metaphorSet);
        const rhetoricalQuestionCount = this.countKeywords(text, this.rhetoricalQuestionSet);
        const hyperboleCount = this.countKeywords(text, this.hyperboleSet);

        const personificationCount = this.detectPersonification(text);
        const parallelismCount = this.detectParallelism(text);
        const antithesisCount = this.detectAntithesis(text);

        const total = metaphorCount + personificationCount + parallelismCount
            + rhetoricalQuestionCount + hyperboleCount + antithesisCount;

        return {
            metaphor: metaphorCount,
            personification: personificationCount,
            parallelism: parallelismCount,
            rhetoricalQuestion: rhetoricalQuestionCount,
            hyperbole: hyperboleCount,
            antithesis: antithesisCount,
            total,
            perThousand: this.round2((total / Math.max(totalChars, 1)) * 1000)
        };
    }

    private detectPersonification(text: string): number {
        const nonHumanThings = ['风', '雨', '山', '水', '天', '地', '树', '花', '夜', '月', '太阳', '星星'];
        const actionWords = ['笑', '哭', '说', '唱', '跳', '舞', '拥抱', '亲吻', '低语', '叹息'];
        let count = 0;

        for (const thing of nonHumanThings) {
            for (const action of actionWords) {
                const pattern = `${thing}[^。！？!?]{0,10}${action}`;
                count += (text.match(new RegExp(pattern, 'g')) || []).length;
            }
        }

        return count;
    }

    private detectParallelism(text: string): number {
        const sentences = this.splitSentences(text);
        let count = 0;

        for (let i = 0; i < sentences.length - 2; i++) {
            const s1 = sentences[i];
            const s2 = sentences[i + 1];
            const s3 = sentences[i + 2];

            const start1 = s1.slice(0, 2);
            const start2 = s2.slice(0, 2);
            const start3 = s3.slice(0, 2);

            if (start1 === start2 && start2 === start3 && isChineseChar(start1[0])) {
                count++;
            }
        }

        return count;
    }

    private detectAntithesis(text: string): number {
        const sentences = this.splitSentences(text);
        let count = 0;

        for (let i = 0; i < sentences.length - 1; i++) {
            const s1 = sentences[i];
            const s2 = sentences[i + 1];
            const len1 = this.countChineseChars(s1);
            const len2 = this.countChineseChars(s2);

            if (Math.abs(len1 - len2) <= 2 && len1 >= 4 && len2 >= 4) {
                const antonymPairs = [
                    ['天', '地'], ['上', '下'], ['大', '小'], ['多', '少'],
                    ['长', '短'], ['高', '低'], ['快', '慢'], ['生', '死']
                ];
                let hasPair = false;
                for (const [a, b] of antonymPairs) {
                    if (s1.includes(a) && s2.includes(b)) {
                        hasPair = true;
                        break;
                    }
                }
                if (hasPair) count++;
            }
        }

        return count;
    }

    private analyzeDialogueStyle(text: string): DialogueStyle {
        const dialogues = this.extractDialogues(text);
        const totalChars = text.length;
        const dialogueChars = dialogues.reduce((sum, d) => sum + d.length, 0);
        const dialogueRatio = dialogueChars / Math.max(totalChars, 1);

        const avgLength = dialogues.length > 0
            ? dialogues.reduce((sum, d) => sum + d.length, 0) / dialogues.length
            : 0;

        let short = 0;
        let medium = 0;
        let long = 0;

        for (const d of dialogues) {
            if (d.length <= 10) {
                short++;
            } else if (d.length <= 30) {
                medium++;
            } else {
                long++;
            }
        }

        const total = dialogues.length || 1;

        const promptCounts = new Map<string, number>();
        for (const word of DIALOGUE_PROMPT_WORDS) {
            const count = (text.match(new RegExp(word + '「|' + word + '『|' + word + '"|' + word + '“', 'g')) || []).length;
            if (count > 0) {
                promptCounts.set(word, count);
            }
        }

        const promptWordPreference = Array.from(promptCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        return {
            dialogueRatio: this.round2(dialogueRatio),
            promptWordPreference,
            avgDialogueLength: this.round2(avgLength),
            lengthDistribution: {
                short: this.round2(short / total),
                medium: this.round2(medium / total),
                long: this.round2(long / total)
            }
        };
    }

    private extractDialogues(text: string): string[] {
        const dialogues: string[] = [];
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
                const content = text.slice(openIdx + 1, closeIdx);
                if (content.length > 0) {
                    dialogues.push(content);
                }
                startIdx = closeIdx + 1;
            }
        }

        return dialogues;
    }

    private calculateDialogueChars(text: string): number {
        return this.extractDialogues(text).reduce((sum, d) => sum + d.length, 0);
    }

    private analyzeParagraphStructure(paragraphs: string[]): ParagraphStructure {
        if (paragraphs.length === 0) {
            return {
                avgParagraphLength: 0,
                medianParagraphLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
                openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 }
            };
        }

        const lengths = paragraphs.map(p => this.countChineseChars(p));
        const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const sortedLengths = [...lengths].sort((a, b) => a - b);
        const medianLength = sortedLengths.length % 2 === 0
            ? (sortedLengths[sortedLengths.length / 2 - 1] + sortedLengths[sortedLengths.length / 2]) / 2
            : sortedLengths[Math.floor(sortedLengths.length / 2)];

        let short = 0;
        let medium = 0;
        let long = 0;
        let veryLong = 0;

        for (const len of lengths) {
            if (len <= 30) {
                short++;
            } else if (len <= 100) {
                medium++;
            } else if (len <= 300) {
                long++;
            } else {
                veryLong++;
            }
        }

        const total = paragraphs.length;

        let timeWord = 0;
        let conjunction = 0;
        let subject = 0;
        let other = 0;

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (trimmed.length === 0) continue;

            let matched = false;

            for (const word of TIME_OPENING_WORDS) {
                if (trimmed.startsWith(word)) {
                    timeWord++;
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                for (const word of CONJUNCTION_OPENING_WORDS) {
                    if (trimmed.startsWith(word)) {
                        conjunction++;
                        matched = true;
                        break;
                    }
                }
            }

            if (!matched) {
                for (const word of SUBJECT_OPENING_WORDS) {
                    if (trimmed.startsWith(word)) {
                        subject++;
                        matched = true;
                        break;
                    }
                }
            }

            if (!matched) {
                other++;
            }
        }

        return {
            avgParagraphLength: this.round2(avgLength),
            medianParagraphLength: this.round2(medianLength),
            lengthDistribution: {
                short: this.round2(short / total),
                medium: this.round2(medium / total),
                long: this.round2(long / total),
                veryLong: this.round2(veryLong / total)
            },
            openingFeatures: {
                timeWord: this.round2(timeWord / total),
                conjunction: this.round2(conjunction / total),
                subject: this.round2(subject / total),
                other: this.round2(other / total)
            }
        };
    }

    private tokenize2Gram(text: string): string[] {
        const tokens: string[] = [];
        for (let i = 0; i < text.length - 1; i++) {
            const token = text.slice(i, i + 2);
            if (this.isAllChinese(token)) {
                tokens.push(token);
            }
        }
        return tokens;
    }

    private analyzeVocabularyRichness(text: string, totalChars: number): VocabularyRichnessResult {
        const allParas = text.split(/\n\n+/);
        const sampledParas: string[] = [];
        for (let pi = 0; pi < allParas.length; pi += 3) {
            sampledParas.push(allParas[pi]);
        }
        const sample = sampledParas.join('\n\n');

        if (sample.length < 2) {
            return this.getEmptyVocabularyRichness();
        }

        const tokens = this.tokenize2Gram(sample);
        if (tokens.length === 0) {
            return this.getEmptyVocabularyRichness();
        }

        const ttr = this.calculateTTRSegmented(sample, 1000);
        const mtld = this.calculateMTLD(tokens, 0.72);
        const yulesK = this.calculateYulesK(tokens);

        const freq = new Map<string, number>();
        for (const t of tokens) {
            freq.set(t, (freq.get(t) || 0) + 1);
        }
        let hapaxCount = 0;
        for (const c of freq.values()) {
            if (c === 1) hapaxCount++;
        }
        const hapax = hapaxCount / tokens.length;
        const vocabularySize = freq.size;

        let level: 'low' | 'medium' | 'high';
        if (ttr > 0.7 && mtld > 50) {
            level = 'high';
        } else if (ttr < 0.4 || mtld < 30) {
            level = 'low';
        } else {
            level = 'medium';
        }

        const ttrNorm = this.clamp01(ttr) * 100;
        const mtldNorm = Math.min(mtld, 100);
        const yulesKNorm = Math.max(0, Math.min(100, 100 - yulesK / 2));
        const hapaxNorm = this.clamp01(hapax) * 100;
        const score = this.clamp01((0.3 * ttrNorm + 0.3 * mtldNorm + 0.2 * yulesKNorm + 0.2 * hapaxNorm) / 100) * 100;

        return {
            ttr: this.round2(ttr),
            mtld: this.round2(mtld),
            yulesK: this.round2(yulesK),
            hapaxLegomena: this.round2(hapax),
            vocabularySize,
            totalTokens: tokens.length,
            level,
            score: this.round2(score)
        };
    }

    private getEmptyVocabularyRichness(): VocabularyRichnessResult {
        return {
            ttr: 0,
            mtld: 0,
            yulesK: 0,
            hapaxLegomena: 0,
            vocabularySize: 0,
            totalTokens: 0,
            level: 'low',
            score: 0
        };
    }

    private calculateTTRSegmented(text: string, windowSize: number): number {
        if (text.length <= windowSize) {
            const tokens = this.tokenize2Gram(text);
            if (tokens.length === 0) return 0;
            const types = new Set(tokens);
            return types.size / tokens.length;
        }

        let totalTTR = 0;
        let segmentCount = 0;
        for (let i = 0; i < text.length; i += windowSize) {
            const segment = text.slice(i, i + windowSize);
            if (segment.length < 2) continue;
            const tokens = this.tokenize2Gram(segment);
            if (tokens.length === 0) continue;
            const types = new Set(tokens);
            totalTTR += types.size / tokens.length;
            segmentCount++;
        }
        return segmentCount > 0 ? totalTTR / segmentCount : 0;
    }

    private calculateMTLD(tokens: string[], threshold: number): number {
        if (tokens.length === 0) return 0;
        const forward = this.calculateMTLDDirection(tokens, threshold);
        const reversed = this.calculateMTLDDirection([...tokens].reverse(), threshold);
        return (forward + reversed) / 2;
    }

    private calculateMTLDDirection(tokens: string[], threshold: number): number {
        if (tokens.length === 0) return 0;

        let factors = 0;
        let tokenCount = 0;
        let types = new Set<string>();
        let lastTTR = 1.0;

        for (const token of tokens) {
            types.add(token);
            tokenCount++;
            const ttr = types.size / tokenCount;
            lastTTR = ttr;

            if (ttr < threshold) {
                factors++;
                types = new Set();
                tokenCount = 0;
                lastTTR = 1.0;
            }
        }

        let partialFactor = 0;
        if (tokenCount > 0 && lastTTR < 1.0) {
            partialFactor = (1 - lastTTR) / (1 - threshold);
        }

        const totalFactors = factors + partialFactor;
        if (totalFactors <= 0) {
            return tokens.length;
        }
        return tokens.length / totalFactors;
    }

    private calculateYulesK(tokens: string[]): number {
        if (tokens.length === 0) return 0;

        const freq = new Map<string, number>();
        for (const t of tokens) {
            freq.set(t, (freq.get(t) || 0) + 1);
        }

        const freqDist = new Map<number, number>();
        for (const c of freq.values()) {
            freqDist.set(c, (freqDist.get(c) || 0) + 1);
        }

        const N = tokens.length;
        let M2 = 0;
        for (const [i, fi] of freqDist.entries()) {
            M2 += i * i * fi;
        }

        return 10000 * (M2 - N) / (N * N);
    }

    private analyzeFiveSenses(text: string, totalChars: number): FiveSensesResult {
        const empty: FiveSensesResult = {
            distribution: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
            counts: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
            perThousand: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
            dominantSense: 'visual',
            balanceScore: 0,
            level: 'low',
            details: { visualWords: [], auditoryWords: [], olfactoryWords: [], gustatoryWords: [], tactileWords: [] }
        };

        if (!text || text.length === 0) return empty;

        const allParas = text.split(/\n\n+/);
        const sampledParas: string[] = [];
        for (let pi = 0; pi < allParas.length; pi += 3) {
            sampledParas.push(allParas[pi]);
        }
        const sample = sampledParas.join('\n\n');

        const counts: Record<SenseType, number> = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
        const matchedWords: Record<SenseType, Set<string>> = {
            visual: new Set(),
            auditory: new Set(),
            olfactory: new Set(),
            gustatory: new Set(),
            tactile: new Set()
        };

        for (let i = 0; i < sample.length; i++) {
            for (let len = this.senseMaxWordLen; len >= 1; len--) {
                if (i + len > sample.length) continue;
                const sub = sample.slice(i, i + len);
                const sense = this.senseWordMap.get(sub);
                if (sense) {
                    counts[sense]++;
                    matchedWords[sense].add(sub);
                    break;
                }
            }
        }

        const totalSenseCount = SENSE_TYPES.reduce((sum, s) => sum + counts[s], 0);

        const distribution: Record<SenseType, number> = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
        if (totalSenseCount > 0) {
            for (const s of SENSE_TYPES) {
                distribution[s] = counts[s] / totalSenseCount;
            }
        }

        const perThousand: Record<SenseType, number> = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
        for (const s of SENSE_TYPES) {
            perThousand[s] = (counts[s] / Math.max(totalChars, 1)) * 1000;
        }

        let dominantSense: SenseType = 'visual';
        let maxCount = -1;
        for (const s of SENSE_TYPES) {
            if (counts[s] > maxCount) {
                maxCount = counts[s];
                dominantSense = s;
            }
        }

        let entropy = 0;
        for (const s of SENSE_TYPES) {
            if (distribution[s] > 0) {
                entropy -= distribution[s] * Math.log2(distribution[s]);
            }
        }
        const maxEntropy = Math.log2(SENSE_TYPES.length);
        const balanceScore = maxEntropy > 0 ? (entropy / maxEntropy) * 100 : 0;

        const totalPerThousand = SENSE_TYPES.reduce((sum, s) => sum + perThousand[s], 0);
        let level: 'low' | 'medium' | 'high';
        if (totalPerThousand > 10) {
            level = 'high';
        } else if (totalPerThousand >= 3) {
            level = 'medium';
        } else {
            level = 'low';
        }

        const sampleWordLimit = 20;
        const roundedDistribution: Record<SenseType, number> = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
        const roundedPerThousand: Record<SenseType, number> = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
        for (const s of SENSE_TYPES) {
            roundedDistribution[s] = this.round2(distribution[s]);
            roundedPerThousand[s] = this.round2(perThousand[s]);
        }

        return {
            distribution: roundedDistribution,
            counts,
            perThousand: roundedPerThousand,
            dominantSense,
            balanceScore: this.round2(balanceScore),
            level,
            details: {
                visualWords: Array.from(matchedWords.visual).slice(0, sampleWordLimit),
                auditoryWords: Array.from(matchedWords.auditory).slice(0, sampleWordLimit),
                olfactoryWords: Array.from(matchedWords.olfactory).slice(0, sampleWordLimit),
                gustatoryWords: Array.from(matchedWords.gustatory).slice(0, sampleWordLimit),
                tactileWords: Array.from(matchedWords.tactile).slice(0, sampleWordLimit)
            }
        };
    }

    private classifyOverallStyle(
        sentenceRhythm: SentenceRhythm,
        wordPreference: WordPreference,
        narrativeStyle: NarrativeStyle,
        rhetoric: RhetoricStats,
        dialogueStyle: DialogueStyle,
        text: string,
        genreConfig?: GenreConfig
    ): OverallStyle {
        // 题材相关风格词命中频次判定（优先级高于通用 8 维评分）
        // 当 genreConfig 提供且 styleKeywords 有命中时，输出题材相关 primaryStyle
        if (genreConfig && genreConfig.styleKeywords && genreConfig.styleKeywords.length > 0) {
            const keywordHits: Array<{ keyword: string; count: number }> = [];
            for (const keyword of genreConfig.styleKeywords) {
                if (!keyword) continue;
                const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const count = (text.match(new RegExp(escaped, 'g')) || []).length;
                if (count > 0) {
                    keywordHits.push({ keyword, count });
                }
            }

            if (keywordHits.length > 0) {
                keywordHits.sort((a, b) => b.count - a.count);
                const totalHits = keywordHits.reduce((sum, h) => sum + h.count, 0);
                const primaryStyle = keywordHits[0].keyword;
                const secondaryStyle = keywordHits[1]?.keyword;
                const confidence = this.round2(this.clamp01(keywordHits[0].count / totalHits));

                const styleScores: Record<string, number> = {};
                for (const hit of keywordHits) {
                    styleScores[hit.keyword] = this.round2(hit.count / totalHits);
                }

                return {
                    primaryStyle,
                    secondaryStyle,
                    confidence,
                    styleScores
                };
            }
        }

        // 回退：通用 8 维评分（与原逻辑一致，保持向后兼容）
        const scores: Record<string, number> = {};

        const shortSentenceRatio = sentenceRhythm.lengthDistribution.short;
        const longSentenceRatio = sentenceRhythm.lengthDistribution.long;
        const adjRatio = wordPreference.posPreference.adjective;
        const descRatio = narrativeStyle.descriptionRatio.total;
        const psychRatio = narrativeStyle.descriptionRatio.psychology;
        const actionRatio = narrativeStyle.descriptionRatio.action;
        const exclamatoryRatio = sentenceRhythm.sentenceTypeDistribution.exclamatory;
        const dialogueRatio = dialogueStyle.dialogueRatio;
        const particleLevel = wordPreference.modalParticles.perThousand / 20;
        const colloquialLevel = wordPreference.colloquialismLevel;
        const rhetoricDensity = rhetoric.perThousand / 5;
        const idiomDensity = wordPreference.idiomDensity / 5;

        scores.concise = shortSentenceRatio * 0.4 + (1 - adjRatio) * 0.3 + (1 - descRatio) * 0.3;

        scores.gorgeous = longSentenceRatio * 0.25 + adjRatio * 0.25 + rhetoricDensity * 0.25 + idiomDensity * 0.25;

        scores.cold = shortSentenceRatio * 0.3 + (1 - adjRatio) * 0.2 + (1 - rhetoric.metaphor / Math.max(rhetoric.total, 1)) * 0.2 + (1 - dialogueRatio) * 0.3;

        scores.delicate = longSentenceRatio * 0.25 + descRatio * 0.35 + psychRatio * 0.25 + adjRatio * 0.15;

        scores.passionate = actionRatio * 0.3 + shortSentenceRatio * 0.2 + exclamatoryRatio * 0.2 + dialogueRatio * 0.15 + rhetoricDensity * 0.15;

        scores.humorous = particleLevel * 0.3 + dialogueRatio * 0.25 + colloquialLevel * 0.25 + rhetoricDensity * 0.2;

        scores.heavy = longSentenceRatio * 0.25 + descRatio * 0.25 + psychRatio * 0.25 + (1 - exclamatoryRatio) * 0.25;

        scores.relaxed = shortSentenceRatio * 0.25 + particleLevel * 0.25 + dialogueRatio * 0.25 + colloquialLevel * 0.25;

        let maxScore = 0;
        let secondMaxScore = 0;
        let primaryStyle = '未知';
        let secondaryStyle: string | undefined;

        for (const [style, score] of Object.entries(scores)) {
            if (score > maxScore) {
                secondMaxScore = maxScore;
                maxScore = score;
                secondaryStyle = primaryStyle;
                primaryStyle = style;
            } else if (score > secondMaxScore) {
                secondMaxScore = score;
                secondaryStyle = style;
            }
        }

        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
        const confidence = maxScore / totalScore * (Object.keys(scores).length - 1);

        const normalizedScores: Record<string, number> = {};
        for (const [style, score] of Object.entries(scores)) {
            normalizedScores[style] = this.round2(score);
        }

        return {
            primaryStyle: STYLE_LABELS[primaryStyle] || primaryStyle,
            secondaryStyle: secondaryStyle ? (STYLE_LABELS[secondaryStyle] || secondaryStyle) : undefined,
            confidence: this.round2(this.clamp01(confidence)),
            styleScores: normalizedScores
        };
    }

    /**
     * 自动检测文本题材并加载对应 GenreConfig。
     * 检测失败或异常时回退到 generic 配置，保证不抛异常。
     */
    private detectGenreConfig(text: string): GenreConfig {
        try {
            const detection = this.genreDetector.detect(text);
            return this.genreRegistry.getGenreConfig(detection.genreId);
        } catch {
            try {
                return this.genreRegistry.getGenreConfig('generic');
            } catch {
                // 极端情况下注册表也访问失败，返回空配置触发回退到 8 维评分
                return {
                    genreId: 'generic',
                    displayName: '通用',
                    behaviorTraits: [],
                    abilityKeywords: [],
                    techniqueKeywords: [],
                    foreshadowTypes: [],
                    conflictKeywords: [],
                    showSignalWords: [],
                    styleKeywords: [],
                    detectorSignals: []
                };
            }
        }
    }

    private countKeywords(text: string, keywordSet: Set<string>): number {
        let count = 0;
        for (const word of keywordSet) {
            count += (text.match(new RegExp(word, 'g')) || []).length;
        }
        return count;
    }

    private countChineseChars(text: string): number {
        let count = 0;
        for (let i = 0; i < text.length; i++) {
            if (isChineseChar(text[i])) {
                count++;
            }
        }
        return count;
    }

    private isAllChinese(text: string): boolean {
        for (let i = 0; i < text.length; i++) {
            if (!isChineseChar(text[i])) {
                return false;
            }
        }
        return text.length > 0;
    }


    private buildFrontmatter(result: StyleAnalysisResult): string {
        const data = {
            overallStyle: {
                primaryStyle: result.overallStyle.primaryStyle,
                secondaryStyle: result.overallStyle.secondaryStyle,
                confidence: result.overallStyle.confidence
            },
            sentenceRhythm: result.sentenceRhythm,
            wordPreference: {
                topWords: result.wordPreference.topWords.slice(0, 20),
                posPreference: result.wordPreference.posPreference,
                modalParticles: result.wordPreference.modalParticles,
                idiomDensity: result.wordPreference.idiomDensity,
                colloquialismLevel: result.wordPreference.colloquialismLevel
            },
            narrativeStyle: result.narrativeStyle,
            rhetoric: result.rhetoric,
            dialogueStyle: result.dialogueStyle,
            paragraphStructure: result.paragraphStructure,
            vocabularyRichness: result.vocabularyRichness,
            fiveSenses: result.fiveSenses,
            stats: result.stats
        };
        return JSON.stringify(data, null, 2);
    }

    private buildMarkdownBody(result: StyleAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 文风风格分析报告`);
        lines.push('');

        lines.push('## 统计概览');
        lines.push('');
        lines.push(`- 总字符数：**${result.stats.totalChars}**`);
        lines.push(`- 总句子数：**${result.stats.totalSentences}**`);
        lines.push(`- 总段落数：**${result.stats.totalParagraphs}**`);
        lines.push('');

        lines.push('## 整体文风');
        lines.push('');
        lines.push(`- 主要文风：**${result.overallStyle.primaryStyle}**`);
        if (result.overallStyle.secondaryStyle) {
            lines.push(`- 次要文风：${result.overallStyle.secondaryStyle}`);
        }
        lines.push(`- 置信度：**${(result.overallStyle.confidence * 100).toFixed(0)}%**`);
        lines.push('');
        lines.push('### 各文风得分');
        lines.push('');
        lines.push('| 文风类型 | 得分 |');
        lines.push('|----------|------|');
        const sortedStyles = Object.entries(result.overallStyle.styleScores)
            .sort((a, b) => b[1] - a[1]);
        for (const [style, score] of sortedStyles) {
            lines.push(`| ${STYLE_LABELS[style] || style} | ${score.toFixed(2)} |`);
        }
        lines.push('');

        lines.push('## 句式节奏');
        lines.push('');
        lines.push(`- 平均句长：**${result.sentenceRhythm.avgSentenceLength}** 字`);
        lines.push(`- 中位数句长：${result.sentenceRhythm.medianSentenceLength} 字`);
        lines.push(`- 标准差：${result.sentenceRhythm.stdSentenceLength}`);
        lines.push('');
        lines.push('### 句型分布');
        lines.push('');
        lines.push('| 句型 | 比例 |');
        lines.push('|------|------|');
        lines.push(`| 陈述句 | ${(result.sentenceRhythm.sentenceTypeDistribution.declarative * 100).toFixed(1)}% |`);
        lines.push(`| 疑问句 | ${(result.sentenceRhythm.sentenceTypeDistribution.interrogative * 100).toFixed(1)}% |`);
        lines.push(`| 感叹句 | ${(result.sentenceRhythm.sentenceTypeDistribution.exclamatory * 100).toFixed(1)}% |`);
        lines.push(`| 省略句 | ${(result.sentenceRhythm.sentenceTypeDistribution.elliptical * 100).toFixed(1)}% |`);
        lines.push('');
        lines.push('### 长短句分布');
        lines.push('');
        lines.push('| 类型 | 比例 |');
        lines.push('|------|------|');
        lines.push(`| 短句 (≤10字) | ${(result.sentenceRhythm.lengthDistribution.short * 100).toFixed(1)}% |`);
        lines.push(`| 中句 (11-30字) | ${(result.sentenceRhythm.lengthDistribution.medium * 100).toFixed(1)}% |`);
        lines.push(`| 长句 (>30字) | ${(result.sentenceRhythm.lengthDistribution.long * 100).toFixed(1)}% |`);
        lines.push('');

        lines.push('## 用词偏好');
        lines.push('');
        lines.push('### 词性偏好');
        lines.push('');
        lines.push('| 词性 | 偏好指数 |');
        lines.push('|------|----------|');
        lines.push(`| 动词 | ${result.wordPreference.posPreference.verb.toFixed(2)} |`);
        lines.push(`| 形容词 | ${result.wordPreference.posPreference.adjective.toFixed(2)} |`);
        lines.push(`| 副词 | ${result.wordPreference.posPreference.adverb.toFixed(2)} |`);
        lines.push('');
        lines.push('### 语气词统计');
        lines.push('');
        lines.push(`- 总次数：**${result.wordPreference.modalParticles.total}**`);
        lines.push(`- 每千字次数：${result.wordPreference.modalParticles.perThousand}`);
        if (result.wordPreference.modalParticles.topParticles.length > 0) {
            lines.push('');
            lines.push('### 常用语气词');
            lines.push('');
            lines.push('| 排名 | 语气词 | 次数 |');
            lines.push('|------|--------|------|');
            result.wordPreference.modalParticles.topParticles.forEach((p, idx) => {
                lines.push(`| ${idx + 1} | ${p.word} | ${p.count} |`);
            });
        }
        lines.push('');
        lines.push(`- 成语密度：**${result.wordPreference.idiomDensity}** /千字`);
        lines.push(`- 口语化程度：**${(result.wordPreference.colloquialismLevel * 100).toFixed(0)}%**`);
        lines.push('');

        if (result.wordPreference.topWords.length > 0) {
            lines.push('### 高频词 TOP20');
            lines.push('');
            lines.push('| 排名 | 词语 | 出现次数 | 频率 |');
            lines.push('|------|------|----------|------|');
            result.wordPreference.topWords.slice(0, 20).forEach((w, idx) => {
                lines.push(`| ${idx + 1} | ${w.word} | ${w.count} | ${(w.frequency * 100).toFixed(2)}% |`);
            });
            lines.push('');
        }

        lines.push('## 叙事特点');
        lines.push('');
        const perspectiveLabels: Record<string, string> = {
            first_person: '第一人称',
            third_person_omniscient: '第三人称全知',
            third_person_limited: '第三人称有限',
            mixed: '混合视角'
        };
        lines.push(`- 叙事视角：**${perspectiveLabels[result.narrativeStyle.perspective] || result.narrativeStyle.perspective}**`);
        lines.push(`- 视角置信度：${(result.narrativeStyle.perspectiveConfidence * 100).toFixed(0)}%`);
        lines.push(`- 叙述占比：${(result.narrativeStyle.narrationRatio * 100).toFixed(1)}%`);
        lines.push(`- 对话占比：${(result.narrativeStyle.dialogueRatio * 100).toFixed(1)}%`);
        lines.push(`- 总描写占比：**${(result.narrativeStyle.descriptionRatio.total * 100).toFixed(1)}%**`);
        lines.push('');
        lines.push('### 描写类型分布');
        lines.push('');
        lines.push('| 描写类型 | 占比 |');
        lines.push('|----------|------|');
        lines.push(`| 外貌描写 | ${(result.narrativeStyle.descriptionRatio.appearance * 100).toFixed(1)}% |`);
        lines.push(`| 环境描写 | ${(result.narrativeStyle.descriptionRatio.environment * 100).toFixed(1)}% |`);
        lines.push(`| 动作描写 | ${(result.narrativeStyle.descriptionRatio.action * 100).toFixed(1)}% |`);
        lines.push(`| 心理描写 | ${(result.narrativeStyle.descriptionRatio.psychology * 100).toFixed(1)}% |`);
        lines.push('');

        lines.push('## 修辞手法');
        lines.push('');
        lines.push(`- 总修辞次数：**${result.rhetoric.total}**`);
        lines.push(`- 每千字次数：${result.rhetoric.perThousand}`);
        lines.push('');
        lines.push('| 修辞类型 | 次数 |');
        lines.push('|----------|------|');
        lines.push(`| 比喻 | ${result.rhetoric.metaphor} |`);
        lines.push(`| 拟人 | ${result.rhetoric.personification} |`);
        lines.push(`| 排比 | ${result.rhetoric.parallelism} |`);
        lines.push(`| 反问 | ${result.rhetoric.rhetoricalQuestion} |`);
        lines.push(`| 夸张 | ${result.rhetoric.hyperbole} |`);
        lines.push(`| 对偶 | ${result.rhetoric.antithesis} |`);
        lines.push('');

        lines.push('## 对话风格');
        lines.push('');
        lines.push(`- 对话占比：**${(result.dialogueStyle.dialogueRatio * 100).toFixed(1)}%**`);
        lines.push(`- 平均对话长度：${result.dialogueStyle.avgDialogueLength} 字`);
        lines.push('');
        lines.push('### 对话长度分布');
        lines.push('');
        lines.push('| 类型 | 比例 |');
        lines.push('|------|------|');
        lines.push(`| 短对话 (≤10字) | ${(result.dialogueStyle.lengthDistribution.short * 100).toFixed(1)}% |`);
        lines.push(`| 中对话 (11-30字) | ${(result.dialogueStyle.lengthDistribution.medium * 100).toFixed(1)}% |`);
        lines.push(`| 长对话 (>30字) | ${(result.dialogueStyle.lengthDistribution.long * 100).toFixed(1)}% |`);
        lines.push('');
        if (result.dialogueStyle.promptWordPreference.length > 0) {
            lines.push('### 提示词偏好 TOP10');
            lines.push('');
            lines.push('| 排名 | 提示词 | 次数 |');
            lines.push('|------|--------|------|');
            result.dialogueStyle.promptWordPreference.forEach((p, idx) => {
                lines.push(`| ${idx + 1} | ${p.word} | ${p.count} |`);
            });
            lines.push('');
        }

        lines.push('## 段落结构');
        lines.push('');
        lines.push(`- 平均段长：**${result.paragraphStructure.avgParagraphLength}** 字`);
        lines.push(`- 中位数段长：${result.paragraphStructure.medianParagraphLength} 字`);
        lines.push('');
        lines.push('### 段长分布');
        lines.push('');
        lines.push('| 类型 | 比例 |');
        lines.push('|------|------|');
        lines.push(`| 短段 (≤30字) | ${(result.paragraphStructure.lengthDistribution.short * 100).toFixed(1)}% |`);
        lines.push(`| 中段 (31-100字) | ${(result.paragraphStructure.lengthDistribution.medium * 100).toFixed(1)}% |`);
        lines.push(`| 长段 (101-300字) | ${(result.paragraphStructure.lengthDistribution.long * 100).toFixed(1)}% |`);
        lines.push(`| 超长段 (>300字) | ${(result.paragraphStructure.lengthDistribution.veryLong * 100).toFixed(1)}% |`);
        lines.push('');
        lines.push('### 段落开头特征');
        lines.push('');
        lines.push('| 特征类型 | 比例 |');
        lines.push('|----------|------|');
        lines.push(`| 时间词开头 | ${(result.paragraphStructure.openingFeatures.timeWord * 100).toFixed(1)}% |`);
        lines.push(`| 连接词开头 | ${(result.paragraphStructure.openingFeatures.conjunction * 100).toFixed(1)}% |`);
        lines.push(`| 主语开头 | ${(result.paragraphStructure.openingFeatures.subject * 100).toFixed(1)}% |`);
        lines.push(`| 其他开头 | ${(result.paragraphStructure.openingFeatures.other * 100).toFixed(1)}% |`);
        lines.push('');

        if (result.vocabularyRichness) {
            const vr = result.vocabularyRichness;
            lines.push('## 词汇丰富度');
            lines.push('');
            lines.push(`- TTR（类型token比）：**${vr.ttr}**`);
            lines.push(`- MTLD（词汇多样性度量）：${vr.mtld}`);
            lines.push(`- Yule's K 常数：${vr.yulesK}`);
            lines.push(`- Hapax Legomena（只出现一次的词比例）：${(vr.hapaxLegomena * 100).toFixed(1)}%`);
            lines.push(`- 独立词数：${vr.vocabularySize}`);
            lines.push(`- 总词数：${vr.totalTokens}`);
            lines.push(`- 丰富度等级：**${VR_LEVEL_LABELS[vr.level]}**`);
            lines.push(`- 综合评分：**${vr.score}** / 100`);
            lines.push('');
        }

        if (result.fiveSenses) {
            const fs = result.fiveSenses;
            lines.push('## 五感分析');
            lines.push('');
            lines.push('### 五感分布');
            lines.push('');
            lines.push('| 感官 | 次数 | 占比 | 每千字 |');
            lines.push('|------|------|------|--------|');
            for (const s of SENSE_TYPES) {
                lines.push(`| ${SENSE_LABELS[s]} | ${fs.counts[s]} | ${(fs.distribution[s] * 100).toFixed(1)}% | ${fs.perThousand[s].toFixed(2)} |`);
            }
            lines.push('');
            lines.push(`- 主导感官：**${SENSE_LABELS[fs.dominantSense]}**`);
            lines.push(`- 平衡度：**${fs.balanceScore}** / 100`);
            lines.push(`- 描写密度等级：**${VR_LEVEL_LABELS[fs.level]}**`);
            lines.push('');
            lines.push('### 各感官词样本');
            lines.push('');
            lines.push(`- 视觉词：${fs.details.visualWords.join('、') || '无'}`);
            lines.push(`- 听觉词：${fs.details.auditoryWords.join('、') || '无'}`);
            lines.push(`- 嗅觉词：${fs.details.olfactoryWords.join('、') || '无'}`);
            lines.push(`- 味觉词：${fs.details.gustatoryWords.join('、') || '无'}`);
            lines.push(`- 触觉词：${fs.details.tactileWords.join('、') || '无'}`);
            lines.push('');
        }

        return lines.join('\n');
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    /**
     * 保留 3 位小数。用于 topWords.frequency 等需要更高精度的统计，
     * 避免 725/100000=0.00725 被压成 0.01 或 0。
     */
    private round3(n: number): number {
        return Math.round(n * 1000) / 1000;
    }
}
