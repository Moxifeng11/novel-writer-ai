/**
 * technique-deconstructor.ts — 写作技巧识别器
 *
 * 功能：基于关键词模式匹配 + 向量语义确认 + 上下文规则，识别小说中的各类写作技巧，
 *       包括结构类、爽点类、情绪类、节奏类、流派类五大分类
 * 性能：10万字取样 + async 协作式让出，避免长文本阻塞主线程（向量增强为异步）
 */

import { kbBookWritingTechniquesFile } from '../../shared/paths';
import { VectorEnhancer } from '../vector-enhancer';
import { WebnovelKnowledgeBase, TechniqueDef, GenreConfig } from '../../shared/webnovel-knowledge-base';
import { GenreDetector, GenreConfigRegistry } from '../genre';
import type { GenreConfig as FrameworkGenreConfig } from '../genre';
import { yieldToUI } from '../../shared/yield';
import { createLogger } from '../../shared/logger';


const log = createLogger('TechniqueDeconstructor');
export type TechniqueCategory = 'structure' | 'cool_point' | 'emotion' | 'rhythm' | 'genre' | 'style';

export interface QualityBreakdown {
    overall: number;
    exampleScore: number;
    confidenceScore: number;
    frequencyScore: number;
    weightScore: number;
    contextScore: number;
}

export interface WritingTechnique {
    id: string;
    name: string;
    category: TechniqueCategory;
    description: string;
    confidence: number;
    count: number;
    genreWeight?: number;
    qualityScore?: number;
    qualityBreakdown?: QualityBreakdown;
    examples: Array<{
        position: number;
        paragraphIndex: number;
        excerpt: string;
        context?: string;
        beforeContext?: string;
        afterContext?: string;
        confidence?: number;
        vectorScore?: number;
        keywordDensity?: number;
        contextRuleScore?: number;
    }>;
}

export interface TechniqueAnalysisResult {
    techniques: WritingTechnique[];
    categoryDistribution: Record<TechniqueCategory, number>;
    topTechniques: WritingTechnique[];
    stats: {
        totalTechniques: number;
        totalExamples: number;
        avgConfidence: number;
        avgQualityScore?: number;
        vectorEnhanced?: boolean;
    };
    genreId?: string;
    genreName?: string;
    aggregation?: {
        segmentCount: number;
        dataStatus: 'complete' | 'partial';
    };
}

interface TechniquePattern {
    id: string;
    name: string;
    category: TechniqueCategory;
    description: string;
    keywords: string[];
    contextRules?: ((text: string) => boolean)[];
    baseConfidence: number;
    // genreWeight 不再硬编码 1.0：题材自适应时动态注入（题材内 1.5，通用基础 1.0）
    genreWeight?: number;
}

const STRUCTURE_TECHNIQUES: TechniquePattern[] = [
    {
        id: 'foreshadowing',
        name: '伏笔',
        category: 'structure',
        description: '前后呼应的概念或事件，前期埋设线索后期回收',
        keywords: ['提到...后来', '之前...现在', '日后', '将来', '总有一天', '以后', '待到', '等...的时候'],
        baseConfidence: 0.6
    },
    {
        id: 'reversal',
        name: '反转',
        category: 'structure',
        description: '出人意料的剧情转折，打破读者预期',
        keywords: ['没想到', '竟然', '居然', '原来', '谁知', '哪知', '不料', '出乎意料'],
        baseConfidence: 0.7
    },
    {
        id: 'setup',
        name: '铺垫',
        category: 'structure',
        description: '为后续重要情节做准备和蓄势',
        keywords: ['这一切都是为了', '为了这一天', '一切才刚刚开始', '好戏还在后头', '这仅仅是', '序幕'],
        baseConfidence: 0.6
    },
    {
        id: 'suspense',
        name: '悬念',
        category: 'structure',
        description: '通过疑问或未知引发读者好奇心',
        keywords: ['究竟是', '到底是', '难道是', '莫非是', '怎么回事', '为什么', '真相是什么', '谜底'],
        baseConfidence: 0.7
    },
    {
        id: 'echo',
        name: '呼应',
        category: 'structure',
        description: '首尾或前后相似的描述、对话或意象',
        keywords: ['一如往昔', '仿佛又回到', '就像当初', '和...一样', '似曾相识', '又一次'],
        baseConfidence: 0.5
    },
    {
        id: 'flashback',
        name: '倒叙/插叙',
        category: 'structure',
        description: '插入过去发生的事件或回忆',
        keywords: ['话说回来', '说起', '回忆起', '记得', '曾记得', '想当年', '那时候', '往事', '回忆'],
        baseConfidence: 0.7
    }
];

const COOL_POINT_TECHNIQUES: TechniquePattern[] = [
    {
        id: 'face_slap',
        name: '打脸',
        category: 'cool_point',
        description: '通过前后对比让轻视主角的人自食其果',
        keywords: ['啪', '耳光', '打脸', '不敢相信', '目瞪口呆', '傻眼', '震惊', '难以置信'],
        baseConfidence: 0.7
    },
    {
        id: 'breakthrough',
        name: '升级/突破',
        category: 'cool_point',
        description: '主角实力提升、境界突破',
        keywords: ['突破了', '晋升', '升级', '进阶', '达到', '瓶颈', '修为大进', '实力暴涨', '顿悟'],
        baseConfidence: 0.75
    },
    {
        id: 'show_off',
        name: '装逼',
        category: 'cool_point',
        description: '主角以淡定从容的姿态展示强大实力',
        keywords: ['淡淡道', '轻描淡写', '不以为然', '不屑', '淡然', '微微一笑', '不过如此', '不值一提'],
        baseConfidence: 0.65
    },
    {
        id: 'hidden_strength',
        name: '扮猪吃虎',
        category: 'cool_point',
        description: '主角隐藏实力，在关键时刻爆发',
        keywords: ['看起来', '没想到竟然', '深藏不露', '隐藏实力', '低调', '不起眼', '其貌不扬'],
        baseConfidence: 0.65
    },
    {
        id: 'comeback',
        name: '反杀',
        category: 'cool_point',
        description: '处于劣势时逆转局势取得胜利',
        keywords: ['以为...却', '就在这时', '突然', '反杀', '逆转', '翻盘', '绝地反击', '以弱胜强'],
        baseConfidence: 0.7
    },
    {
        id: 'system_flow',
        name: '系统流',
        category: 'cool_point',
        description: '带有系统金手指特征的写作模式',
        keywords: ['系统', '叮', '【', '】', '任务', '奖励', '宿主', '面板'],
        baseConfidence: 0.8
    },
    {
        id: 'checkin_flow',
        name: '签到流',
        category: 'cool_point',
        description: '以每日签到获取奖励为核心金手指的模式',
        keywords: ['签到', '打卡', '每日签到', '签到奖励', '签到成功'],
        baseConfidence: 0.75
    },
    {
        id: 'divorce_flow',
        name: '退婚流',
        category: 'cool_point',
        description: '开篇以退婚为切入点，建立逆袭动机',
        keywords: ['退婚', '休妻', '看不起', '莫欺少年穷', '解除婚约'],
        baseConfidence: 0.85
    }
];

const EMOTION_TECHNIQUES: TechniquePattern[] = [
    {
        id: 'tearjerker',
        name: '催泪/感动',
        category: 'emotion',
        description: '引发读者悲伤、感动等情绪的描写',
        keywords: ['眼泪', '落泪', '哽咽', '心酸', '感动', '泪流满面', '泣不成声', '潸然泪下', '心疼'],
        baseConfidence: 0.7
    },
    {
        id: 'humor',
        name: '搞笑',
        category: 'emotion',
        description: '通过幽默诙谐的笔法营造轻松氛围',
        keywords: ['哈哈', '笑', '逗', '滑稽', '搞笑', '好笑', '乐了', '忍俊不禁', '捧腹'],
        baseConfidence: 0.6
    },
    {
        id: 'passion',
        name: '热血',
        category: 'emotion',
        description: '激发读者热血沸腾、激昂澎湃的情绪',
        keywords: ['燃烧', '沸腾', '热血', '冲啊', '战斗', '激昂', '澎湃', '不屈', '斗志'],
        baseConfidence: 0.7
    },
    {
        id: 'sweet_pet',
        name: '甜宠',
        category: 'emotion',
        description: '甜蜜宠溺的互动描写',
        keywords: ['宠溺', '温柔', '摸头', '抱', '吻', '甜', '心动', '脸红', '羞涩', '依偎'],
        baseConfidence: 0.65
    },
    {
        id: 'angst',
        name: '虐恋',
        category: 'emotion',
        description: '痛苦折磨的情感纠葛描写',
        keywords: ['心痛', '折磨', '恨', '误会', '痛苦', '心碎', '煎熬', '伤痕', '泪水', '绝望'],
        baseConfidence: 0.65
    }
];

const RHYTHM_TECHNIQUES: TechniquePattern[] = [
    {
        id: 'fast_paced',
        name: '快节奏',
        category: 'rhythm',
        description: '短句多、对话多、动作多，节奏紧凑',
        keywords: [],
        baseConfidence: 0.5
    },
    {
        id: 'slow_burn',
        name: '慢热',
        category: 'rhythm',
        description: '长句多、描写多、铺垫多，节奏舒缓',
        keywords: [],
        baseConfidence: 0.5
    },
    {
        id: 'climax_after_climax',
        name: '高潮迭起',
        category: 'rhythm',
        description: '高潮点密集，连续不断的刺激',
        keywords: [],
        baseConfidence: 0.5
    },
    {
        id: 'balanced_pace',
        name: '张弛有度',
        category: 'rhythm',
        description: '节奏有快有慢，松紧适度',
        keywords: [],
        baseConfidence: 0.5
    }
];

const GENRE_TECHNIQUES: TechniquePattern[] = [
    {
        id: 'golden_three_chapters',
        name: '黄金三章',
        category: 'genre',
        description: '前三章信息量高，快速抓住读者',
        keywords: [],
        baseConfidence: 0.5
    },
    {
        id: 'underdog_rise',
        name: '废柴逆袭',
        category: 'genre',
        description: '主角从废物/废柴逐渐崛起变强',
        keywords: ['废物', '废柴', '不能修炼', '废人', '垃圾', '人渣', '崛起', '逆袭'],
        baseConfidence: 0.7
    },
    {
        id: 'system_novel',
        name: '系统文',
        category: 'genre',
        description: '以系统为核心金手指的小说类型',
        keywords: ['系统', '宿主', '面板', '任务', '奖励', '叮', '【', '】'],
        baseConfidence: 0.8
    },
    {
        id: 'rebirth',
        name: '重生文',
        category: 'genre',
        description: '主角回到过去重新开始的小说类型',
        keywords: ['重生', '回到', '前世', '上辈子', '再生', '重来一次', '回到过去'],
        baseConfidence: 0.85
    },
    {
        id: 'transmigration',
        name: '穿越文',
        category: 'genre',
        description: '主角穿越到异世界或古代的小说类型',
        keywords: ['穿越', '异世', '这个世界', '异世界', '架空', '古代', '现代', '穿书'],
        baseConfidence: 0.75
    },
    {
        id: 'farming',
        name: '种田文',
        category: 'genre',
        description: '以平淡日常生活为主的小说类型',
        keywords: ['种田', '农家', '日子', '平淡', '烟火气', '家长里短', '发家致富', '田园'],
        baseConfidence: 0.65
    }
];

const BASE_TECHNIQUE_PATTERNS: TechniquePattern[] = [
    ...STRUCTURE_TECHNIQUES,
    ...COOL_POINT_TECHNIQUES,
    ...EMOTION_TECHNIQUES,
    ...RHYTHM_TECHNIQUES,
    ...GENRE_TECHNIQUES
];

/**
 * 题材专属技巧库：补充各题材 genre.json 中 techniqueKeywords 提及但 BASE_TECHNIQUE_PATTERNS 未覆盖的技巧。
 *
 * 这些技巧通过 genreConfig.techniqueKeywords 中的"技巧名"匹配激活，避免硬编码题材归属：
 * - military: 军事谋略 / 政治博弈 / 讽刺幽默 / 战争场面（"热血燃向"复用 EMOTION 的"热血"）
 * - romance: 误会 / 破镜重圆 / 邂逅（"甜宠"/"虐恋"已存在于 EMOTION_TECHNIQUES）
 * - mystery: 诡计 / 线索 / 真相揭露（"反转"/"悬念"已存在于 STRUCTURE_TECHNIQUES）
 *
 * 注：genreWeight 不在此处硬编码，由 applyFrameworkGenreConfig 在题材匹配时动态注入。
 */
const GENRE_SPECIFIC_TECHNIQUE_PATTERNS: TechniquePattern[] = [
    // ===== military（军事题材） =====
    {
        id: 'military_strategy',
        name: '军事谋略',
        category: 'genre',
        description: '运用兵法战术进行作战部署、调兵遣将',
        keywords: ['谋略', '战术', '战略', '调兵遣将', '布阵', '兵分', '佯攻', '诱敌', '埋伏', '运筹', '兵法'],
        baseConfidence: 0.75
    },
    {
        id: 'political_maneuvering',
        name: '政治博弈',
        category: 'genre',
        description: '政治势力间的权谋斗争与权力博弈',
        keywords: ['政治', '权谋', '派系', '夺权', '政变', '权位', '朝堂', '势力', '博弈', '拉拢', '铲除'],
        baseConfidence: 0.7
    },
    {
        id: 'satirical_humor',
        name: '讽刺幽默',
        category: 'emotion',
        description: '通过讽刺、调侃、戏谑营造特殊的幽默氛围',
        keywords: ['讽刺', '调侃', '嘲讽', '讥讽', '冷笑话', '挖苦', '戏谑', '反讽', '一针见血'],
        baseConfidence: 0.7
    },
    {
        id: 'war_scene',
        name: '战争场面',
        category: 'genre',
        description: '大规模战役的场面描写与战斗场面',
        keywords: ['厮杀', '冲锋', '激战', '溃退', '围攻', '血战', '鏖战', '战场', '硝烟', '战鼓', '铁骑'],
        baseConfidence: 0.75
    },
    // ===== romance（言情题材） =====
    {
        id: 'misunderstanding',
        name: '误会',
        category: 'emotion',
        description: '因误解产生的情感冲突与纠葛',
        keywords: ['误会', '误解', '错怪', '冤枉', '误以为', '却不知', '原来不是', '解释不清'],
        baseConfidence: 0.65
    },
    {
        id: 'reconciliation',
        name: '破镜重圆',
        category: 'emotion',
        description: '分离后的重逢与和好',
        keywords: ['重逢', '破镜重圆', '再续前缘', '重新开始', '原谅', '和好', '旧情复燃'],
        baseConfidence: 0.7
    },
    {
        id: 'encounter',
        name: '邂逅',
        category: 'emotion',
        description: '偶然相遇的情感起点',
        keywords: ['邂逅', '偶遇', '初见', '一见钟情', '缘分', '相遇', '初次见面'],
        baseConfidence: 0.7
    },
    // ===== mystery（悬疑题材） =====
    {
        id: 'trick_design',
        name: '诡计',
        category: 'genre',
        description: '精心设计的诡计与圈套',
        keywords: ['诡计', '圈套', '陷阱', '计谋', '布局', '设局', '阴谋', '机关', '骗局'],
        baseConfidence: 0.75
    },
    {
        id: 'clue_discovery',
        name: '线索',
        category: 'structure',
        description: '关键线索的发现与追踪',
        keywords: ['线索', '证据', '蛛丝马迹', '痕迹', '疑点', '破绽', '线索链'],
        baseConfidence: 0.7
    },
    {
        id: 'truth_reveal',
        name: '真相揭露',
        category: 'structure',
        description: '最终真相大白的揭示时刻',
        keywords: ['真相', '揭露', '水落石出', '真相大白', '揭开', '浮出水面', '事实是'],
        baseConfidence: 0.75
    }
];

/**
 * 通用基础技巧库：与题材弱相关，所有题材均保留（结构类、节奏类）。
 */
const UNIVERSAL_BASE_PATTERNS: TechniquePattern[] = [
    ...STRUCTURE_TECHNIQUES,
    ...RHYTHM_TECHNIQUES
];

/**
 * 题材相关技巧库：需要根据 genreConfig.techniqueKeywords 筛选激活。
 */
const GENRE_DEPENDENT_PATTERNS: TechniquePattern[] = [
    ...COOL_POINT_TECHNIQUES,
    ...EMOTION_TECHNIQUES,
    ...GENRE_TECHNIQUES,
    ...GENRE_SPECIFIC_TECHNIQUE_PATTERNS
];

export class TechniqueDeconstructor {
    private patternMap: Map<string, TechniquePattern>;
    private vectorEnhancer?: VectorEnhancer;
    private knowledgeBase?: WebnovelKnowledgeBase;
    private genreId?: string;
    private genreConfig?: GenreConfig;
    private readonly vectorThreshold = 0.3;
    private readonly keywordWeight = 0.35;
    private readonly vectorWeight = 0.4;
    private readonly densityWeight = 0.15;
    private readonly contextRuleWeight = 0.1;
    // P5 题材自适应：基于新框架 GenreConfig 的技巧筛选
    private readonly confidenceFloor = 0.5;        // confidence < 0.5 的技巧不输出
    private readonly minKeywordHits = 2;            // 关键词命中数 < 2 的技巧不输出
    private frameworkGenreConfig?: FrameworkGenreConfig;
    private genreDetector?: GenreDetector;
    private genreResolved: boolean = false;

    constructor(
        vectorEnhancer?: VectorEnhancer,
        knowledgeBase?: WebnovelKnowledgeBase,
        genreId?: string
    ) {
        this.patternMap = new Map();
        this.vectorEnhancer = vectorEnhancer;
        this.knowledgeBase = knowledgeBase;
        this.genreId = genreId;

        if (knowledgeBase && genreId) {
            const genre = knowledgeBase.getGenre(genreId);
            if (genre) {
                this.genreConfig = genre;
                this.initializePatternsWithGenre(genre);
            } else {
                this.initializeBasePatterns();
            }
        } else {
            this.initializeBasePatterns();
        }
    }

    private initializeBasePatterns(): void {
        for (const pattern of BASE_TECHNIQUE_PATTERNS) {
            this.patternMap.set(pattern.id, { ...pattern });
        }
    }

    private initializePatternsWithGenre(genre: GenreConfig): void {
        const mergedPatterns = new Map<string, TechniquePattern>();
        const seenIds = new Set<string>();

        for (const pattern of BASE_TECHNIQUE_PATTERNS) {
            mergedPatterns.set(pattern.id, { ...pattern, keywords: [...pattern.keywords] });
            seenIds.add(pattern.id);
        }

        for (const techDef of genre.techniques) {
            const category = (techDef.category === 'foreshadow' ? 'structure' : techDef.category) as TechniqueCategory;
            if (mergedPatterns.has(techDef.id)) {
                const existing = mergedPatterns.get(techDef.id)!;
                const keywordSet = new Set<string>();
                for (const kw of existing.keywords) keywordSet.add(kw);
                for (const kw of techDef.keywords) keywordSet.add(kw);
                existing.keywords = Array.from(keywordSet);
                existing.genreWeight = techDef.genreWeight;
                if (techDef.baseConfidence > existing.baseConfidence) {
                    existing.baseConfidence = techDef.baseConfidence;
                }
            } else {
                let matchedBase = false;
                for (const basePattern of BASE_TECHNIQUE_PATTERNS) {
                    const nameSimilarity = this.calculateNameSimilarity(basePattern.name, techDef.name);
                    const keywordOverlap = this.calculateKeywordOverlap(basePattern.keywords, techDef.keywords);
                    if (nameSimilarity > 0.6 || keywordOverlap > 0.4) {
                        const existing = mergedPatterns.get(basePattern.id)!;
                        const keywordSet = new Set<string>();
                        for (const kw of existing.keywords) keywordSet.add(kw);
                        for (const kw of techDef.keywords) keywordSet.add(kw);
                        existing.keywords = Array.from(keywordSet);
                        existing.genreWeight = Math.max(existing.genreWeight ?? 1.0, techDef.genreWeight);
                        if (techDef.baseConfidence > existing.baseConfidence) {
                            existing.baseConfidence = techDef.baseConfidence;
                        }
                        matchedBase = true;
                        break;
                    }
                }
                if (!matchedBase) {
                    mergedPatterns.set(techDef.id, {
                        id: techDef.id,
                        name: techDef.name,
                        category,
                        description: techDef.description,
                        keywords: [...techDef.keywords],
                        baseConfidence: techDef.baseConfidence,
                        genreWeight: techDef.genreWeight
                    });
                    seenIds.add(techDef.id);
                }
            }
        }

        this.patternMap = mergedPatterns;
    }

    /**
     * P5 题材自适应：在 analyze 入口调用一次，依据文本题材筛选激活的技巧。
     *
     * 策略：
     * - 通用基础技巧（结构/节奏类）始终保留，genreWeight = 1.0
     * - 题材相关技巧（爽点/情绪/流派/题材专属）仅当其 name 出现在 genreConfig.techniqueKeywords 中才激活，
     *   激活后 genreWeight = 1.5（题材相关提升）
     * - 题材外技巧（如军事题材下的甜宠/虐恋）不放入 patternMap，从根本上不参与检测
     * - GenreDetector 识别失败（generic）时不应用筛选，保持通用行为
     */
    private resolveGenreFromText(text: string): void {
        if (this.genreResolved) return;
        this.genreResolved = true;

        // 已通过旧 API（webnovel-knowledge-base + genreId）注入题材配置时，跳过新框架识别
        if (this.genreConfig) return;

        try {
            if (!this.genreDetector) {
                this.genreDetector = new GenreDetector();
            }
            const detection = this.genreDetector.detect(text);
            if (!detection.genreId || detection.genreId === 'generic') {
                return;
            }
            this.frameworkGenreConfig = GenreConfigRegistry.getInstance().getGenreConfig(detection.genreId);
            this.applyFrameworkGenreConfig();
        } catch (e) {
            // 题材识别失败时静默降级，保持原通用行为
            log.warn('[TechniqueDeconstructor] 题材识别失败，使用通用技巧库', e);
        }
    }

    /**
     * 根据 frameworkGenreConfig.techniqueKeywords 重建 patternMap：
     * - 通用基础技巧（UNIVERSAL_BASE_PATTERNS）全部保留
     * - 题材相关技巧（GENRE_DEPENDENT_PATTERNS）仅保留 name 匹配的，注入 genreWeight=1.5
     */
    private applyFrameworkGenreConfig(): void {
        if (!this.frameworkGenreConfig) return;
        const techKeywords = this.frameworkGenreConfig.techniqueKeywords;
        if (!techKeywords || techKeywords.length === 0) return;

        const newPatterns = new Map<string, TechniquePattern>();

        // 1. 通用基础（结构/节奏类）始终保留，genreWeight = 1.0
        for (const pattern of UNIVERSAL_BASE_PATTERNS) {
            newPatterns.set(pattern.id, {
                ...pattern,
                keywords: [...pattern.keywords],
                genreWeight: 1.0
            });
        }

        // 2. 题材相关技巧：仅激活 name 出现在 techniqueKeywords 中的
        for (const pattern of GENRE_DEPENDENT_PATTERNS) {
            if (this.matchesTechniqueKeyword(pattern.name, techKeywords)) {
                newPatterns.set(pattern.id, {
                    ...pattern,
                    keywords: [...pattern.keywords],
                    genreWeight: 1.5
                });
            }
            // 题材外技巧不放入 patternMap（不参与检测）
        }

        this.patternMap = newPatterns;
    }

    /**
     * 判断技巧名是否匹配 genreConfig.techniqueKeywords 中的某项。
     * 匹配规则：
     *   - 精确相等（如 "打脸" === "打脸"）
     *   - 双向包含（如 "升级" 包含匹配 "升级/突破"，"逆袭" 包含匹配 "废柴逆袭"）
     */
    private matchesTechniqueKeyword(patternName: string, techKeywords: string[]): boolean {
        for (const kw of techKeywords) {
            if (!kw) continue;
            if (patternName === kw) return true;
            if (patternName.includes(kw) || kw.includes(patternName)) return true;
        }
        return false;
    }

    private calculateNameSimilarity(nameA: string, nameB: string): number {
        if (nameA === nameB) return 1.0;
        if (nameA.includes(nameB) || nameB.includes(nameA)) return 0.8;
        let commonChars = 0;
        const setA = new Set(nameA.split(''));
        const setB = new Set(nameB.split(''));
        for (const char of setA) {
            if (setB.has(char)) commonChars++;
        }
        const maxLen = Math.max(setA.size, setB.size);
        return maxLen > 0 ? commonChars / maxLen : 0;
    }

    private calculateKeywordOverlap(keywordsA: string[], keywordsB: string[]): number {
        if (keywordsA.length === 0 || keywordsB.length === 0) return 0;
        const setA = new Set(keywordsA);
        let overlap = 0;
        for (const kw of keywordsB) {
            if (setA.has(kw)) overlap++;
        }
        return overlap / Math.min(keywordsA.length, keywordsB.length);
    }

    getTechniqueWeight(techniqueId: string): number {
        const pattern = this.patternMap.get(techniqueId);
        if (!pattern) return 1.0;
        return pattern.genreWeight ?? 1.0;
    }

    getGenreTechniquesCount(): number {
        return this.patternMap.size;
    }

    async analyze(text: string): Promise<TechniqueAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        // P5 题材自适应：首次调用时识别文本题材并筛选激活的技巧（lazy init，仅执行一次）
        this.resolveGenreFromText(text);

        const paragraphs = this.splitParagraphs(text);
        const totalLength = text.length;

        const techniqueMatches = new Map<string, {
            count: number;
            examples: Array<{
                position: number;
                paragraphIndex: number;
                excerpt: string;
                context?: string;
                beforeContext?: string;
                afterContext?: string;
                confidence?: number;
                keywordDensity?: number;
                contextRuleScore?: number;
            }>;
            confidenceSum: number;
            keywordDensitySum: number;
            contextRuleSum: number;
        }>();

        let charOffset = 0;
        const allPatterns = Array.from(this.patternMap.values());

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraStart = text.indexOf(para, charOffset);
            const position = totalLength > 0 ? paraStart / totalLength : 0;
            const paraWordCount = this.countWords(para);
            const beforeCtx = i > 0 ? this.truncateText(paragraphs[i - 1], 80) : '';
            const afterCtx = i < paragraphs.length - 1 ? this.truncateText(paragraphs[i + 1], 80) : '';

            for (const pattern of allPatterns) {
                if (pattern.keywords.length === 0) continue;

                let matchCount = 0;
                let matchedKeyword = '';

                for (const keyword of pattern.keywords) {
                    if (keyword.includes('...')) {
                        const parts = keyword.split('...');
                        if (parts.length === 2) {
                            const regex = new RegExp(`${parts[0]}[^。！？!?]*${parts[1]}`, 'g');
                            const matches = para.match(regex);
                            if (matches) {
                                matchCount += matches.length;
                                if (!matchedKeyword) matchedKeyword = keyword;
                            }
                        }
                    } else {
                        const count = (para.match(new RegExp(keyword, 'g')) || []).length;
                        if (count > 0) {
                            matchCount += count;
                            if (!matchedKeyword) matchedKeyword = keyword;
                        }
                    }
                }

                if (matchCount > 0) {
                    let contextRuleScore = 1.0;
                    if (pattern.contextRules && pattern.contextRules.length > 0) {
                        let passedRules = 0;
                        for (const rule of pattern.contextRules) {
                            if (rule(para)) passedRules++;
                        }
                        contextRuleScore = passedRules / pattern.contextRules.length;
                    }
                    const contextPass = contextRuleScore > 0.5;

                    if (contextPass) {
                        const keywordDensity = matchCount / Math.max(paraWordCount, 1);
                        const confidence = this.calculateConfidence(pattern, matchCount, para, keywordDensity, contextRuleScore);

                        if (!techniqueMatches.has(pattern.id)) {
                            techniqueMatches.set(pattern.id, {
                                count: 0,
                                examples: [],
                                confidenceSum: 0,
                                keywordDensitySum: 0,
                                contextRuleSum: 0
                            });
                        }

                        const data = techniqueMatches.get(pattern.id)!;
                        data.count += matchCount;
                        data.confidenceSum += confidence * matchCount;
                        data.keywordDensitySum += keywordDensity * matchCount;
                        data.contextRuleSum += contextRuleScore * matchCount;

                        const excerpt = para.length > 200 ? para.slice(0, 200) + '...' : para;
                        data.examples.push({
                            position: this.clamp01(position),
                            paragraphIndex: i,
                            excerpt,
                            context: `关键词：${matchedKeyword}`,
                            beforeContext: beforeCtx,
                            afterContext: afterCtx,
                            confidence: this.round2(confidence),
                            keywordDensity: this.round4(keywordDensity),
                            contextRuleScore: this.round2(contextRuleScore)
                        });
                    }
                }
            }

            charOffset = paraStart + para.length;
        }
        await yieldToUI();

        this.analyzeRhythmTechniques(paragraphs, text, totalLength, techniqueMatches);
        this.analyzeGenreTechniques(paragraphs, text, totalLength, techniqueMatches);
        await yieldToUI();

        const techniques: WritingTechnique[] = [];
        const categoryDistribution: Record<TechniqueCategory, number> = {
            structure: 0,
            cool_point: 0,
            emotion: 0,
            rhythm: 0,
            genre: 0,
            style: 0
        };

        let totalExamples = 0;
        let totalConfidence = 0;

        for (const [id, data] of techniqueMatches) {
            const pattern = this.patternMap.get(id);
            if (!pattern) continue;

            const avgConfidence = data.count > 0 ? data.confidenceSum / data.count : 0;

            // P5 题材自适应过滤：
            //   - confidence < 0.5 的技巧不输出（避免低置信度误判）
            //   - 关键词命中数 < 2 的技巧不输出（避免单次出现误判）
            //   注：节奏类（fast_paced 等）的 count 由结构化分析填充，通常远大于 2
            if (avgConfidence < this.confidenceFloor) continue;
            if (data.count < this.minKeywordHits) continue;

            const avgDensity = data.count > 0 ? data.keywordDensitySum / data.count : 0;
            const avgContextRule = data.contextRuleSum !== undefined && data.count > 0
                ? data.contextRuleSum / data.count : 1.0;
            const selectedExamples = this.selectRepresentativeExamples(data.examples);

            const qualityBreakdown = this.calculateQualityScore(
                selectedExamples.length,
                avgConfidence,
                data.count,
                pattern.genreWeight ?? 1.0,
                avgContextRule
            );

            const technique: WritingTechnique = {
                id,
                name: pattern.name,
                category: pattern.category,
                description: pattern.description,
                confidence: this.round2(this.clamp01(avgConfidence)),
                count: data.count,
                genreWeight: pattern.genreWeight,
                qualityScore: this.round2(qualityBreakdown.overall),
                qualityBreakdown,
                examples: selectedExamples
            };

            techniques.push(technique);
            categoryDistribution[pattern.category]++;
            totalExamples += data.examples.length;
            totalConfidence += avgConfidence;
        }

        techniques.sort((a, b) => {
            const scoreA = (a.qualityScore || 0) * (a.genreWeight || 1);
            const scoreB = (b.qualityScore || 0) * (b.genreWeight || 1);
            return scoreB - scoreA || b.count - a.count;
        });

        const topTechniques = techniques.slice(0, 10).map(t => {
            const topExamples = this.selectTopExamples(t.examples, 3);
            const ensuredExamples = this.ensureExampleCount(topExamples, t.examples, 2);
            return {
                ...t,
                examples: ensuredExamples
            };
        });

        let totalQuality = 0;
        for (const technique of techniques) {
            totalQuality += technique.qualityScore || 0;
        }

        const stats = {
            totalTechniques: techniques.length,
            totalExamples,
            avgConfidence: techniques.length > 0 ? this.round2(totalConfidence / techniques.length) : 0,
            avgQualityScore: techniques.length > 0 ? this.round2(totalQuality / techniques.length) : 0
        };

        const result: TechniqueAnalysisResult = {
            techniques,
            categoryDistribution,
            topTechniques,
            stats
        };

        if (this.genreConfig) {
            result.genreId = this.genreConfig.id;
            result.genreName = this.genreConfig.name;
        } else if (this.frameworkGenreConfig) {
            result.genreId = this.frameworkGenreConfig.genreId;
            result.genreName = this.frameworkGenreConfig.displayName;
        }

        return result;
    }

    async analyzeWithVector(text: string): Promise<TechniqueAnalysisResult> {
        const baseResult = await this.analyze(text);
        await yieldToUI();

        if (!this.vectorEnhancer || baseResult.techniques.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.warn('[TechniqueDeconstructor] 向量模型不可用，返回纯关键词结果');
                return baseResult;
            }
            await yieldToUI();
            return await this.enhanceTechniquesWithVector(baseResult);
        } catch (e) {
            log.error('[TechniqueDeconstructor] 向量增强失败，返回原始结果', e);
            return baseResult;
        }
    }

    private async enhanceTechniquesWithVector(result: TechniqueAnalysisResult): Promise<TechniqueAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const allReferenceTexts: string[] = [];
        const allExampleTexts: string[] = [];
        const techniqueIndexMap: Array<{ techniqueIdx: number; exampleIdx: number }> = [];

        result.techniques.forEach((technique, tIdx) => {
            allReferenceTexts.push(`${technique.name}：${technique.description}`);
            technique.examples.forEach((example, eIdx) => {
                const contextText = example.beforeContext || example.afterContext
                    ? `${example.beforeContext || ''} ${example.excerpt} ${example.afterContext || ''}`.trim()
                    : example.excerpt;
                allExampleTexts.push(contextText);
                techniqueIndexMap.push({ techniqueIdx: tIdx, exampleIdx: eIdx });
            });
        });

        const allTexts = [...allReferenceTexts, ...allExampleTexts];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const referenceVectors = allVectors.slice(0, allReferenceTexts.length);
        const exampleVectors = allVectors.slice(allReferenceTexts.length);

        const enhancedTechniques = result.techniques.map((technique, tIdx) => {
            const refVector = referenceVectors[tIdx];
            const genreWeight = technique.genreWeight || 1.0;

            const enhancedExamples = technique.examples.map((example, eIdx) => {
                const globalIdx = techniqueIndexMap.findIndex(
                    m => m.techniqueIdx === tIdx && m.exampleIdx === eIdx
                );
                if (globalIdx === -1) return example;

                const exVector = exampleVectors[globalIdx];
                const vectorSim = this.vectorEnhancer!.cosineSimilarity(refVector, exVector);
                const keywordConf = example.confidence || 0.6;
                const keywordDensity = example.keywordDensity || 0.01;
                const contextRuleScore = example.contextRuleScore !== undefined ? example.contextRuleScore : 1.0;

                const fusedConf = this.calibrateConfidence(
                    keywordConf,
                    vectorSim,
                    keywordDensity,
                    contextRuleScore,
                    genreWeight
                );

                return {
                    ...example,
                    confidence: this.round2(this.clamp01(fusedConf)),
                    vectorScore: this.round4(vectorSim)
                };
            });

            enhancedExamples.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

            const validExamples = enhancedExamples.filter(e => (e.confidence || 0) >= this.vectorThreshold);
            const finalExamples = validExamples.length > 0 ? validExamples : enhancedExamples;

            const avgConfidence = finalExamples.length > 0
                ? finalExamples.reduce((sum, e) => sum + (e.confidence || 0), 0) / finalExamples.length
                : 0;

            const avgContextRule = finalExamples.length > 0
                ? finalExamples.reduce((sum, e) => sum + (e.contextRuleScore || 1.0), 0) / finalExamples.length
                : 1.0;

            const qualityBreakdown = this.calculateQualityScore(
                finalExamples.length,
                avgConfidence,
                technique.count,
                genreWeight,
                avgContextRule
            );

            return {
                ...technique,
                confidence: this.round2(this.clamp01(avgConfidence)),
                examples: finalExamples,
                qualityScore: this.round2(qualityBreakdown.overall),
                qualityBreakdown
            };
        });

        const filteredTechniques = enhancedTechniques.filter(t => t.confidence >= this.vectorThreshold);
        const finalTechniques = filteredTechniques.length > 0 ? filteredTechniques : enhancedTechniques;

        finalTechniques.sort((a, b) => {
            const scoreA = (a.qualityScore || 0) * (a.genreWeight || 1);
            const scoreB = (b.qualityScore || 0) * (b.genreWeight || 1);
            return scoreB - scoreA || b.count - a.count;
        });

        const categoryDistribution: Record<TechniqueCategory, number> = {
            structure: 0,
            cool_point: 0,
            emotion: 0,
            rhythm: 0,
            genre: 0,
            style: 0
        };

        let totalExamples = 0;
        let totalConfidence = 0;
        let totalQuality = 0;

        for (const technique of finalTechniques) {
            categoryDistribution[technique.category]++;
            totalExamples += technique.examples.length;
            totalConfidence += technique.confidence;
            totalQuality += technique.qualityScore || 0;
        }

        const topTechniques = finalTechniques.slice(0, 10).map(t => {
            const topExamples = this.selectTopExamples(t.examples, 3);
            const ensuredExamples = this.ensureExampleCount(topExamples, t.examples, 2);
            return {
                ...t,
                examples: ensuredExamples
            };
        });

        const stats = {
            totalTechniques: finalTechniques.length,
            totalExamples,
            avgConfidence: finalTechniques.length > 0 ? this.round2(totalConfidence / finalTechniques.length) : 0,
            avgQualityScore: finalTechniques.length > 0 ? this.round2(totalQuality / finalTechniques.length) : 0,
            vectorEnhanced: true
        };

        const resultOut: TechniqueAnalysisResult = {
            techniques: finalTechniques,
            categoryDistribution,
            topTechniques,
            stats
        };

        if (this.genreConfig) {
            resultOut.genreId = this.genreConfig.id;
            resultOut.genreName = this.genreConfig.name;
        }

        return resultOut;
    }

    private calibrateConfidence(
        keywordConf: number,
        vectorScore: number,
        keywordDensity: number,
        contextRuleScore: number,
        genreWeight: number
    ): number {
        const densityScore = Math.min(1, keywordDensity * 20);
        const keywordBase = Math.min(1, keywordConf);
        const baseScore = keywordBase * this.keywordWeight + vectorScore * this.vectorWeight;
        const densityBonus = densityScore * this.densityWeight;
        const contextBonus = contextRuleScore * this.contextRuleWeight;
        const adjustedScore = baseScore + densityBonus + contextBonus;
        const genreFactor = 0.7 + 0.3 * Math.min(genreWeight, 2.0) / 2.0;
        const genreAdjusted = adjustedScore * genreFactor;

        return this.clamp01(genreAdjusted);
    }

    calculateQualityScore(
        exampleCount: number,
        avgConfidence: number,
        totalCount: number,
        genreWeight: number = 1.0,
        contextScore: number = 1.0
    ): QualityBreakdown {
        const exampleScore = Math.min(1, exampleCount / 5);
        const confidenceScore = this.clamp01(avgConfidence);
        const frequencyScore = Math.min(1, totalCount / 20);
        const weightScore = Math.min(1, genreWeight / 2.0);
        const contextScoreClamped = this.clamp01(contextScore);

        const overall = (
            exampleScore * 0.22 +
            confidenceScore * 0.32 +
            frequencyScore * 0.18 +
            weightScore * 0.15 +
            contextScoreClamped * 0.13
        );

        return {
            overall: this.round2(this.clamp01(overall)),
            exampleScore: this.round2(exampleScore),
            confidenceScore: this.round2(confidenceScore),
            frequencyScore: this.round2(frequencyScore),
            weightScore: this.round2(weightScore),
            contextScore: this.round2(contextScoreClamped)
        };
    }

    private selectRepresentativeExamples(
        examples: Array<{
            position: number;
            paragraphIndex: number;
            excerpt: string;
            context?: string;
            confidence?: number;
            keywordDensity?: number;
        }>
    ): Array<{
        position: number;
        paragraphIndex: number;
        excerpt: string;
        context?: string;
        confidence?: number;
        keywordDensity?: number;
    }> {
        if (examples.length <= 5) return examples;

        const sorted = [...examples].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const selected: typeof examples = [];

        selected.push(sorted[0]);

        const byPosition = [...examples].sort((a, b) => a.position - b.position);
        if (byPosition.length >= 3) {
            const midIndex = Math.floor(byPosition.length / 2);
            if (!selected.includes(byPosition[midIndex])) {
                selected.push(byPosition[midIndex]);
            }
            if (!selected.includes(byPosition[byPosition.length - 1])) {
                selected.push(byPosition[byPosition.length - 1]);
            }
        }

        for (let i = 1; i < sorted.length && selected.length < 5; i++) {
            if (!selected.includes(sorted[i])) {
                selected.push(sorted[i]);
            }
        }

        return selected.sort((a, b) => a.position - b.position);
    }

    private selectTopExamples(
        examples: Array<{
            position: number;
            paragraphIndex: number;
            excerpt: string;
            context?: string;
            confidence?: number;
            vectorScore?: number;
            keywordDensity?: number;
        }>,
        count: number
    ): typeof examples {
        if (examples.length <= count) return examples;

        const sorted = [...examples].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        return sorted.slice(0, count).sort((a, b) => a.position - b.position);
    }

    private analyzeRhythmTechniques(
        paragraphs: string[],
        text: string,
        totalLength: number,
        techniqueMatches: Map<string, {
            count: number;
            examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }>;
            confidenceSum: number;
            keywordDensitySum: number;
            contextRuleSum: number;
        }>
    ) {
        if (paragraphs.length < 5) return;

        let totalSentences = 0;
        let shortSentences = 0;
        let longSentences = 0;
        let dialogueCount = 0;
        let actionCount = 0;
        let descriptionCount = 0;

        const rhythmValues: number[] = [];

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const sentences = para.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
            totalSentences += sentences.length;

            const paraShort = sentences.filter(s => s.trim().length < 15).length;
            const paraLong = sentences.filter(s => s.trim().length > 50).length;
            shortSentences += paraShort;
            longSentences += paraLong;

            const dialogueMatches = para.match(/[「『"“‘][^」』"”’]*[」』"”’]/g);
            if (dialogueMatches) dialogueCount += dialogueMatches.length;

            const actionWords = ['冲', '打', '杀', '跑', '跳', '击', '攻', '防', '躲', '闪'];
            for (const word of actionWords) {
                actionCount += (para.match(new RegExp(word, 'g')) || []).length;
            }

            const descWords = ['的', '了', '着', '是', '有', '在', '像', '如', '似'];
            for (const word of descWords) {
                descriptionCount += (para.match(new RegExp(word, 'g')) || []).length;
            }

            const paraRhythm = sentences.length > 0
                ? (paraShort / sentences.length) * 0.5 + (dialogueMatches ? dialogueMatches.length / sentences.length : 0) * 0.3 + 0.2
                : 0;
            rhythmValues.push(paraRhythm);
        }

        const avgRhythm = rhythmValues.reduce((a, b) => a + b, 0) / rhythmValues.length;
        const rhythmVariance = rhythmValues.reduce((a, b) => a + (b - avgRhythm) ** 2, 0) / rhythmValues.length;

        const fastPacedRatio = totalSentences > 0 ? shortSentences / totalSentences : 0;
        const slowBurnRatio = totalSentences > 0 ? longSentences / totalSentences : 0;

        let climaxCount = 0;
        for (let i = 2; i < rhythmValues.length - 2; i++) {
            if (rhythmValues[i] > avgRhythm + rhythmVariance * 0.5 &&
                rhythmValues[i] > rhythmValues[i - 1] &&
                rhythmValues[i] > rhythmValues[i + 1]) {
                climaxCount++;
            }
        }

        const climaxDensity = paragraphs.length > 0 ? climaxCount / paragraphs.length : 0;

        if (fastPacedRatio > 0.4 && avgRhythm > 0.5) {
            const examples = this.findTopRhythmExamples(paragraphs, text, totalLength, rhythmValues, true);
            const conf = Math.min(0.9, 0.5 + fastPacedRatio * 0.5);
            techniqueMatches.set('fast_paced', {
                count: Math.floor(shortSentences / 10),
                examples,
                confidenceSum: conf * examples.length,
                keywordDensitySum: 0,
                contextRuleSum: examples.length
            });
        }

        if (slowBurnRatio > 0.3 && avgRhythm < 0.4) {
            const examples = this.findTopRhythmExamples(paragraphs, text, totalLength, rhythmValues, false);
            const conf = Math.min(0.9, 0.5 + slowBurnRatio * 0.5);
            techniqueMatches.set('slow_burn', {
                count: Math.floor(longSentences / 10),
                examples,
                confidenceSum: conf * examples.length,
                keywordDensitySum: 0,
                contextRuleSum: examples.length
            });
        }

        if (climaxDensity > 0.15) {
            const examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }> = [];
            for (let i = 2; i < Math.min(paragraphs.length - 2, 50); i++) {
                if (rhythmValues[i] > avgRhythm + rhythmVariance * 0.5 && examples.length < 3) {
                    const paraStart = text.indexOf(paragraphs[i]);
                    const position = totalLength > 0 ? paraStart / totalLength : 0;
                    const excerpt = paragraphs[i].length > 200 ? paragraphs[i].slice(0, 200) + '...' : paragraphs[i];
                    const beforeCtx = i > 0 ? this.truncateText(paragraphs[i - 1], 80) : '';
                    const afterCtx = i < paragraphs.length - 1 ? this.truncateText(paragraphs[i + 1], 80) : '';
                    examples.push({
                        position: this.clamp01(position),
                        paragraphIndex: i,
                        excerpt,
                        context: '高潮点',
                        beforeContext: beforeCtx,
                        afterContext: afterCtx,
                        confidence: this.round2(this.clamp01(rhythmValues[i])),
                        keywordDensity: 0,
                        contextRuleScore: 1.0
                    });
                }
            }
            const conf = Math.min(0.9, 0.4 + climaxDensity * 3);
            techniqueMatches.set('climax_after_climax', {
                count: climaxCount,
                examples,
                confidenceSum: conf * examples.length,
                keywordDensitySum: 0,
                contextRuleSum: examples.length
            });
        }

        if (rhythmVariance > 0.02 && rhythmVariance < 0.08) {
            const examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }> = [];
            for (let i = 0; i < Math.min(paragraphs.length, 30); i += Math.floor(paragraphs.length / 3)) {
                if (examples.length >= 3) break;
                const paraStart = text.indexOf(paragraphs[i]);
                const position = totalLength > 0 ? paraStart / totalLength : 0;
                const excerpt = paragraphs[i].length > 200 ? paragraphs[i].slice(0, 200) + '...' : paragraphs[i];
                const beforeCtx = i > 0 ? this.truncateText(paragraphs[i - 1], 80) : '';
                const afterCtx = i < paragraphs.length - 1 ? this.truncateText(paragraphs[i + 1], 80) : '';
                examples.push({
                    position: this.clamp01(position),
                    paragraphIndex: i,
                    excerpt,
                    context: '节奏样本',
                    beforeContext: beforeCtx,
                    afterContext: afterCtx,
                    confidence: this.round2(Math.min(0.9, 0.4 + rhythmVariance * 5)),
                    keywordDensity: 0,
                    contextRuleScore: 1.0
                });
            }
            const conf = Math.min(0.85, 0.4 + rhythmVariance * 5);
            techniqueMatches.set('balanced_pace', {
                count: Math.floor(paragraphs.length * rhythmVariance * 10),
                examples,
                confidenceSum: conf * examples.length,
                keywordDensitySum: 0,
                contextRuleSum: examples.length
            });
        }
    }

    private findTopRhythmExamples(
        paragraphs: string[],
        text: string,
        totalLength: number,
        rhythmValues: number[],
        fastPaced: boolean
    ): Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }> {
        const indexed = rhythmValues.map((v, i) => ({ value: v, index: i }));
        indexed.sort((a, b) => fastPaced ? b.value - a.value : a.value - b.value);

        const examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }> = [];
        for (let i = 0; i < Math.min(3, indexed.length); i++) {
            const idx = indexed[i].index;
            const paraStart = text.indexOf(paragraphs[idx]);
            const position = totalLength > 0 ? paraStart / totalLength : 0;
            const excerpt = paragraphs[idx].length > 200 ? paragraphs[idx].slice(0, 200) + '...' : paragraphs[idx];
            const beforeCtx = idx > 0 ? this.truncateText(paragraphs[idx - 1], 80) : '';
            const afterCtx = idx < paragraphs.length - 1 ? this.truncateText(paragraphs[idx + 1], 80) : '';
            examples.push({
                position: this.clamp01(position),
                paragraphIndex: idx,
                excerpt,
                context: fastPaced ? '快节奏段落' : '慢节奏段落',
                beforeContext: beforeCtx,
                afterContext: afterCtx,
                confidence: this.round2(this.clamp01(indexed[i].value)),
                keywordDensity: 0,
                contextRuleScore: 1.0
            });
        }
        return examples;
    }

    private analyzeGenreTechniques(
        paragraphs: string[],
        text: string,
        totalLength: number,
        techniqueMatches: Map<string, {
            count: number;
            examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }>;
            confidenceSum: number;
            keywordDensitySum: number;
            contextRuleSum: number;
        }>
    ) {
        if (paragraphs.length < 3) return;

        const firstThreeChapters = this.getFirstThreeChaptersText(paragraphs, text);
        if (firstThreeChapters.length > 0) {
            const firstChaptersWordCount = this.countWords(firstThreeChapters);
            const totalWordCount = this.countWords(text);
            const ratio = totalWordCount > 0 ? firstChaptersWordCount / totalWordCount : 0;

            if (ratio > 0.1 && paragraphs.length > 10) {
                const examples: Array<{ position: number; paragraphIndex: number; excerpt: string; context?: string; beforeContext?: string; afterContext?: string; confidence?: number; keywordDensity?: number; contextRuleScore?: number }> = [];
                for (let i = 0; i < Math.min(3, paragraphs.length); i++) {
                    const paraStart = text.indexOf(paragraphs[i]);
                    const position = totalLength > 0 ? paraStart / totalLength : 0;
                    const excerpt = paragraphs[i].length > 200 ? paragraphs[i].slice(0, 200) + '...' : paragraphs[i];
                    const beforeCtx = i > 0 ? this.truncateText(paragraphs[i - 1], 80) : '';
                    const afterCtx = i < paragraphs.length - 1 ? this.truncateText(paragraphs[i + 1], 80) : '';
                    examples.push({
                        position: this.clamp01(position),
                        paragraphIndex: i,
                        excerpt,
                        context: '开篇段落',
                        beforeContext: beforeCtx,
                        afterContext: afterCtx,
                        confidence: this.round2(Math.min(0.8, 0.4 + ratio * 3)),
                        keywordDensity: 0,
                        contextRuleScore: 1.0
                    });
                }
                const conf = Math.min(0.8, 0.4 + ratio * 3);
                techniqueMatches.set('golden_three_chapters', {
                    count: Math.floor(firstChaptersWordCount / 500),
                    examples,
                    confidenceSum: conf * examples.length,
                    keywordDensitySum: 0,
                    contextRuleSum: examples.length
                });
            }
        }
    }

    private getFirstThreeChaptersText(paragraphs: string[], fullText: string): string {
        const chapterRegex = /第[一二三四五六七八九十百千零\d]+[章节部卷]/g;
        let chapterCount = 0;
        let endIndex = fullText.length;

        for (let i = 0; i < paragraphs.length; i++) {
            const matches = paragraphs[i].match(chapterRegex);
            if (matches) {
                chapterCount += matches.length;
                if (chapterCount >= 3) {
                    const paraStart = fullText.indexOf(paragraphs[i]);
                    endIndex = paraStart + paragraphs[i].length;
                    break;
                }
            }
        }

        return fullText.slice(0, endIndex);
    }

    private calculateConfidence(
        pattern: TechniquePattern,
        matchCount: number,
        text: string,
        keywordDensity: number,
        contextRuleScore: number = 1.0
    ): number {
        let confidence = pattern.baseConfidence;

        if (matchCount >= 3) {
            confidence += 0.15;
        } else if (matchCount >= 2) {
            confidence += 0.08;
        }

        if (keywordDensity > 0.05) {
            confidence += 0.1;
        } else if (keywordDensity > 0.02) {
            confidence += 0.05;
        }

        confidence += (contextRuleScore - 1) * 0.1;

        const genreAdjusted = confidence * (0.7 + 0.3 * Math.min(pattern.genreWeight ?? 1.0, 2.0) / 2.0);

        return this.clamp01(genreAdjusted);
    }

    private getEmptyResult(): TechniqueAnalysisResult {
        return {
            techniques: [],
            categoryDistribution: {
                structure: 0,
                cool_point: 0,
                emotion: 0,
                rhythm: 0,
                genre: 0,
                style: 0
            },
            topTechniques: [],
            stats: {
                totalTechniques: 0,
                totalExamples: 0,
                avgConfidence: 0
            },
            genreId: this.genreConfig?.id,
            genreName: this.genreConfig?.name
        };
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private countWords(text: string): number {
        let count = 0;
        let i = 0;

        while (i < text.length) {
            const char = text[i];
            if (this.isChineseChar(char)) {
                count++;
                i++;
            } else if (this.isEnglishLetter(char)) {
                let j = i;
                while (j < text.length && (this.isEnglishLetter(text[j]) || text[j] === "'" || text[j] === '-')) {
                    j++;
                }
                if (j > i) count++;
                i = j;
            } else if (this.isDigit(char)) {
                let j = i;
                while (j < text.length && (this.isDigit(text[j]) || text[j] === '.' || text[j] === ',')) {
                    j++;
                }
                if (j > i) count++;
                i = j;
            } else {
                i++;
            }
        }

        return Math.max(count, 1);
    }

    private isChineseChar(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 0x4E00 && code <= 0x9FFF;
    }

    private isEnglishLetter(char: string): boolean {
        const code = char.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    private isDigit(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 48 && code <= 57;
    }

    async saveToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookWritingTechniquesFile(bookName, baseDir);
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
        result: TechniqueAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookWritingTechniquesFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    private buildFrontmatter(result: TechniqueAnalysisResult): string {
        const data: any = {
            techniques: result.techniques.map(t => ({
                id: t.id,
                name: t.name,
                category: t.category,
                confidence: t.confidence,
                count: t.count,
                genreWeight: t.genreWeight,
                qualityScore: t.qualityScore
            })),
            categoryDistribution: result.categoryDistribution,
            topTechniques: result.topTechniques.map(t => ({
                id: t.id,
                name: t.name,
                count: t.count,
                confidence: t.confidence,
                qualityScore: t.qualityScore
            })),
            stats: result.stats
        };

        if (result.genreId) data.genreId = result.genreId;
        if (result.genreName) data.genreName = result.genreName;

        return JSON.stringify(data, null, 2);
    }

    private buildMarkdownBody(result: TechniqueAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 写作技巧分析报告`);
        lines.push('');

        if (result.genreName) {
            lines.push(`> 题材：**${result.genreName}**`);
            lines.push('');
        }

        lines.push('## 统计概览');
        lines.push('');
        lines.push(`- 识别技巧总数：**${result.stats.totalTechniques}**`);
        lines.push(`- 示例片段总数：**${result.stats.totalExamples}**`);
        lines.push(`- 平均置信度：**${result.stats.avgConfidence.toFixed(2)}**`);
        if (result.stats.avgQualityScore !== undefined) {
            lines.push(`- 平均质量分：**${result.stats.avgQualityScore.toFixed(2)}**`);
        }
        if (result.stats.vectorEnhanced) {
            lines.push(`- 向量增强：**已启用** ✅`);
        }
        lines.push('');

        lines.push('## 分类分布');
        lines.push('');
        lines.push('| 分类 | 数量 |');
        lines.push('|------|------|');
        const categoryLabels: Record<TechniqueCategory, string> = {
            structure: '结构类',
            cool_point: '爽点类',
            emotion: '情绪类',
            rhythm: '节奏类',
            genre: '流派类',
            style: '风格类'
        };
        for (const [category, count] of Object.entries(result.categoryDistribution)) {
            if (count > 0) {
                lines.push(`| ${categoryLabels[category as TechniqueCategory]} | ${count} |`);
            }
        }
        lines.push('');

        lines.push('## Top 10 最常用技巧');
        lines.push('');
        if (result.topTechniques.length === 0) {
            lines.push('暂未检测到明显技巧');
        } else {
            lines.push('| 排名 | 技巧名称 | 分类 | 出现次数 | 置信度 | 质量分 | 题材权重 |');
            lines.push('|------|----------|------|----------|--------|--------|----------|');
            result.topTechniques.forEach((t, idx) => {
                lines.push(`| ${idx + 1} | ${t.name} | ${categoryLabels[t.category]} | ${t.count} | ${(t.confidence * 100).toFixed(0)}% | ${t.qualityScore ? (t.qualityScore * 100).toFixed(0) + '%' : '-'} | ${(t.genreWeight || 1).toFixed(1)}x |`);
            });
        }
        lines.push('');

        const categories: TechniqueCategory[] = ['structure', 'cool_point', 'emotion', 'rhythm', 'genre', 'style'];
        for (const category of categories) {
            const categoryTechniques = result.techniques.filter(t => t.category === category);
            if (categoryTechniques.length === 0) continue;

            lines.push(`## ${categoryLabels[category]}技巧`);
            lines.push('');

            for (const technique of categoryTechniques) {
                lines.push(`### ${technique.name}`);
                lines.push('');
                lines.push(`- **描述**：${technique.description}`);
                lines.push(`- **出现次数**：${technique.count}`);
                lines.push(`- **置信度**：${(technique.confidence * 100).toFixed(0)}%`);
                if (technique.genreWeight && technique.genreWeight !== 1) {
                    lines.push(`- **题材权重**：${technique.genreWeight.toFixed(1)}x`);
                }
                if (technique.qualityScore !== undefined) {
                    lines.push(`- **质量分**：${(technique.qualityScore * 100).toFixed(0)}%`);
                }
                if (technique.qualityBreakdown) {
                    lines.push(`- **质量维度**：示例 ${(technique.qualityBreakdown.exampleScore * 100).toFixed(0)}% · 置信度 ${(technique.qualityBreakdown.confidenceScore * 100).toFixed(0)}% · 频率 ${(technique.qualityBreakdown.frequencyScore * 100).toFixed(0)}% · 权重 ${(technique.qualityBreakdown.weightScore * 100).toFixed(0)}% · 上下文 ${(technique.qualityBreakdown.contextScore * 100).toFixed(0)}%`);
                }
                lines.push('');

                if (technique.examples.length > 0) {
                    lines.push('**示例片段：**');
                    lines.push('');
                    technique.examples.forEach((ex, idx) => {
                        lines.push(`${idx + 1}. 位置：${(ex.position * 100).toFixed(1)}%（第 ${ex.paragraphIndex + 1} 段）`);
                        if (ex.confidence !== undefined) {
                            lines.push(`   - 置信度：${(ex.confidence * 100).toFixed(0)}%`);
                        }
                        if (ex.vectorScore !== undefined) {
                            lines.push(`   - 向量匹配度：${(ex.vectorScore * 100).toFixed(0)}%`);
                        }
                        if (ex.keywordDensity !== undefined) {
                            lines.push(`   - 关键词密度：${(ex.keywordDensity * 100).toFixed(1)}%`);
                        }
                        if (ex.contextRuleScore !== undefined && ex.contextRuleScore < 1.0) {
                            lines.push(`   - 上下文规则分：${(ex.contextRuleScore * 100).toFixed(0)}%`);
                        }
                        if (ex.context) {
                            lines.push(`   - 说明：${ex.context}`);
                        }
                        if (ex.beforeContext) {
                            lines.push(`   - 上文：${ex.beforeContext}`);
                        }
                        lines.push(`   > ${ex.excerpt}`);
                        if (ex.afterContext) {
                            lines.push(`   - 下文：${ex.afterContext}`);
                        }
                        lines.push('');
                    });
                }
            }
        }

        return lines.join('\n');
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    private round4(n: number): number {
        return Math.round(n * 10000) / 10000;
    }

    private truncateText(text: string, maxLen: number): string {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.slice(0, maxLen) + '...';
    }

    private ensureExampleCount(
        selected: Array<{
            position: number;
            paragraphIndex: number;
            excerpt: string;
            context?: string;
            beforeContext?: string;
            afterContext?: string;
            confidence?: number;
            vectorScore?: number;
            keywordDensity?: number;
            contextRuleScore?: number;
        }>,
        allExamples: Array<{
            position: number;
            paragraphIndex: number;
            excerpt: string;
            context?: string;
            beforeContext?: string;
            afterContext?: string;
            confidence?: number;
            vectorScore?: number;
            keywordDensity?: number;
            contextRuleScore?: number;
        }>,
        minCount: number
    ): typeof selected {
        if (selected.length >= minCount || allExamples.length <= selected.length) {
            return selected;
        }
        const result = [...selected];
        const selectedIndices = new Set(selected.map(e => e.paragraphIndex));
        const byPosition = [...allExamples].sort((a, b) => a.position - b.position);
        for (const ex of byPosition) {
            if (result.length >= minCount) break;
            if (!selectedIndices.has(ex.paragraphIndex)) {
                result.push(ex);
                selectedIndices.add(ex.paragraphIndex);
            }
        }
        if (result.length < minCount) {
            for (const ex of allExamples) {
                if (result.length >= minCount) break;
                if (!result.includes(ex)) {
                    result.push(ex);
                }
            }
        }
        return result.sort((a, b) => a.position - b.position);
    }
}
