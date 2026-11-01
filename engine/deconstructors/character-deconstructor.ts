/**
 * character-deconstructor.ts — 人物角色拆解器
 *
 * 功能：基于纯统计方法分析小说人物，提供角色识别、特征提取、
 *       关系网络、成长曲线等多维度人物分析结果
 * 性能：10万字取样 + async 协作式让出，避免长文本阻塞主线程
 */

import { kbBookCharacterExtractionFile } from '../../shared/paths';
import { isChineseChar } from '../../shared/text-utils';
import { VectorEnhancer } from '../vector-enhancer';
import { WebnovelKnowledgeBase, GenreConfig } from '../../shared/webnovel-knowledge-base';
import { yieldToUI } from '../../shared/yield';
import { EMOTION_WORDS } from '../dimension-keywords';
import { GenreConfig as AdaptiveGenreConfig, GenreConfigRegistry } from '../genre';
import { LLMEnhancer } from '../llm-enhancer';
import { SemanticAnalyzer } from '../semantic-analyzer';
import { createLogger } from '../../shared/logger';


const log = createLogger('CharacterDeconstructor');
export interface CharacterArc {
    initialState: {
        personality: string[];
        abilities: string[];
        goals: string[];
        description?: string;
    };
    growthNodes: Array<{
        position: number;
        event: string;
        changeType: string;
        trigger?: string;
    }>;
    transformationType: 'growth' | 'fall' | 'awakening' | 'darkening' | 'return' | 'stable';
    finalState: {
        personality: string[];
        abilities: string[];
        description?: string;
    };
    completeness: number;
}

export interface CharacterImportance {
    appearanceFrequency: number;
    dialogueRatio: number;
    plotDrivingScore: number;
    relationshipCentrality: number;
    perspectiveRatio: number;
    totalScore: number;
    tier: 'protagonist' | 'core_supporting' | 'important_supporting' | 'minor_supporting' | 'extra';
}

export interface CharacterRelationDetail {
    fromId: string;
    toId: string;
    type: string;
    strength: number;
    history?: Array<{
        position: number;
        fromType: string;
        toType: string;
        event?: string;
    }>;
    keyEvents: string[];
}

export interface RelationshipNetworkStats {
    protagonistCentrality: number;
    networkDensity: number;
    hubCharacters: string[];
    averageDegree: number;
}

export interface CharacterTimelineEvent {
    position: number;
    type: 'appearance' | 'growth' | 'relationship' | 'plot' | 'turning_point';
    title: string;
    description?: string;
}

export interface Character {
    id: string;
    name: string;
    aliases: string[];
    role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'minor';
    gender?: 'male' | 'female' | 'unknown';
    appearance?: string;
    personality: string[];
    abilities: string[];
    background?: string;
    firstAppearance: number;
    lastAppearance: number;
    appearanceCount: number;
    mentionCount: number;
    growthStages: Array<{ position: number; description: string }>;
    relationships: Array<{
        targetId: string;
        targetName: string;
        type: string;
        description?: string;
    }>;
    characterArc?: CharacterArc;
    importance?: CharacterImportance;
    timeline?: CharacterTimelineEvent[];
    dialogueCount?: number;
    perspectiveCount?: number;
    keyEventCount?: number;
}

export interface CharacterRelation {
    fromId: string;
    toId: string;
    type: string;
    weight: number;
}

export interface CharacterAnalysisResult {
    characters: Character[];
    mainCharacter?: Character;
    relations: CharacterRelation[];
    relationDetails?: CharacterRelationDetail[];
    networkStats?: RelationshipNetworkStats;
    networkCentrality?: CharacterNetworkResult;
    voiceFingerprint?: VoiceFingerprintResult;
    stats: {
        totalCharacters: number;
        mainCharacterCount: number;
        avgAppearancePerCharacter: number;
    };
}

export interface CharacterNetworkCentrality {
    characterName: string;
    degreeCentrality: number;
    closenessCentrality: number;
    betweennessCentrality: number;
    pagerank: number;
    role: 'protagonist' | 'major' | 'supporting' | 'minor';
}

export interface CharacterNetworkResult {
    nodes: string[];
    edges: Array<{
        source: string;
        target: string;
        weight: number;
    }>;
    centrality: CharacterNetworkCentrality[];
    communities: Array<{
        id: number;
        members: string[];
    }>;
    networkDensity: number;
    avgPathLength: number;
    description: string;
}

export interface VoiceFingerprint {
    characterName: string;
    dialogueCount: number;
    avgDialogueLength: number;
    vocabularyRichness: number;
    toneWords: string[];
    sentencePattern: {
        short: number;
        medium: number;
        long: number;
    };
    uniqueExpressions: string[];
    personalityMarkers: {
        formality: number;
        emotionality: number;
        directness: number;
    };
    fingerprint: string;
}

export interface VoiceFingerprintResult {
    characters: VoiceFingerprint[];
    distinctness: number;
    description: string;
}

const DIALOGUE_VERBS = [
    '说', '道', '喊', '叫', '问', '答', '笑', '叹', '怒道', '冷笑',
    '低语', '喃喃', '轻声', '大声', '心想', '暗道', '暗想', '默念'
];

const APPEARANCE_KEYWORDS = [
    '长得', '相貌', '面容', '身材', '容貌', '眉目', '眼神', '气质',
    '身着', '穿着', '打扮', '模样', '样子', '形容', '相貌堂堂',
    '英俊', '美丽', '漂亮', '帅气', '清秀', '魁梧', '瘦小', '高大'
];

const BACKGROUND_KEYWORDS = [
    '出身', '来自', '原本是', '曾经', '以前', '过去', '小时候', '少年时',
    '家境', '家世', '背景', '来历', '身份', '原是', '本是'
];

const GROWTH_KEYWORDS = [
    '突破', '晋升', '变强', '提升', '升级', '进阶', '顿悟', '觉醒',
    '蜕变', '成长', '进步', '超越', '打破', '踏入', '迈入'
];

const RELATION_KEYWORDS: { type: string; words: string[] }[] = [
    { type: '父亲', words: ['父亲', '爹', '爸爸', '家父', '父上'] },
    { type: '母亲', words: ['母亲', '娘', '妈妈', '家母', '母上'] },
    { type: '师父', words: ['师父', '师傅', '恩师', '老师', '先生'] },
    { type: '徒弟', words: ['徒弟', '徒儿', '弟子', '学生', '门生'] },
    { type: '师兄', words: ['师兄', '师姐', '师弟', '师妹'] },
    { type: '朋友', words: ['朋友', '好友', '知己', '兄弟', '姐妹', '挚友'] },
    { type: '敌人', words: ['敌人', '仇人', '仇家', '对手', '仇敌'] },
    { type: '恋人', words: ['喜欢', '爱', '心上人', '恋人', '情人', '意中人'] },
    { type: '亲人', words: ['亲人', '家人', '亲戚', '亲属', '血缘'] }
];

const COMMON_WORDS = new Set([
    '什么', '怎么', '为什么', '哪里', '这个', '那个', '这些', '那些',
    '自己', '他们', '我们', '你们', '大家', '别人', '有人', '没人',
    '时候', '地方', '东西', '事情', '问题', '办法', '主意', '心思',
    '知道', '明白', '理解', '清楚', '记得', '忘记', '发现', '觉得',
    '可以', '可能', '应该', '必须', '需要', '想要', '希望', '打算',
    '一个', '两个', '三个', '一些', '一点', '很多', '不少', '几乎',
    '然后', '可是', '但是', '所以', '因此', '因为', '如果', '虽然',
    '已经', '正在', '刚刚', '马上', '立刻', '突然', '渐渐', '慢慢',
    '没有', '不是', '就是', '只是', '还是', '还有', '也是', '才是',
    '真是', '更是', '便是', '于是', '因而',
    '而且', '并且', '或者', '要么', '不但', '不仅',
    '尽管', '即使', '就算', '只要', '只有', '无论', '不管',
    '今天', '明天', '昨天', '现在', '以前', '以后', '后来', '从前',
    '刚才', '顿时', '忽然', '缓缓',
    '这里', '那里', '这边', '那边', '里面', '外面', '上面', '下面',
    '中间', '旁边', '面前', '身后', '左右', '前后', '上下', '内外',
    '眼睛', '心里', '口中', '手里', '脚下', '头上', '脸上', '身上',
    '声音', '样子', '感觉', '想法', '意思', '态度', '表情', '语气',
    '力量', '气势', '气息', '光芒', '火焰', '寒气', '热气', '雾气',
    '时间', '空间', '世界', '天地', '乾坤', '阴阳', '五行', '八卦',
    '第一', '第二', '第三', '最后', '终于', '到底', '究竟', '毕竟',
    '各种', '各样', '一切', '所有', '全部', '整个', '完整',
    '不同', '相同', '一样', '一般', '普通', '特别', '非常', '十分',
    '更加', '越发', '比较', '相当', '最', '太', '更', '很',
    '过来', '过去', '起来', '下去', '上来', '下来', '出去', '进来',
    '看到', '听到', '闻到', '摸到', '感到', '想到', '说道', '喊道',
    '点头', '摇头', '微笑', '大笑', '冷笑', '苦笑', '叹息', '叹气',
    '紧张', '放松', '高兴', '难过', '愤怒', '害怕', '惊讶', '疑惑',
    '着急', '担心', '放心', '开心', '郁闷', '烦躁', '平静', '激动',
    '厉害', '强大', '弱小', '恐怖', '可怕', '惊人',
    '不错', '挺好', '还好', '糟糕', '倒霉', '幸运', '可惜',
    '当然', '显然', '果然', '居然', '竟然', '难道', '莫非', '大概',
    '差不多', '简直', '根本', '完全', '绝对', '肯定', '也许',
    '恐怕', '估计', '据说', '听说', '看来', '想来', '按理', '说起来',
    '不好意思', '没办法', '不知道', '不清楚', '不明白', '不理解',
    '不得不', '不能不', '不会', '不敢', '不愿', '不肯', '不要', '不用',
    '的', '了', '着', '过', '和', '与', '及', '或', '而', '且',
    '但', '却', '则', '虽', '然', '所', '为', '被', '把', '将',
    '从', '以', '对', '向', '到', '在', '于', '比', '因', '由',
    '让', '给', '使', '令', '之', '乎', '者', '也', '矣',
    '焉', '哉', '兮', '尔', '其', '此', '彼', '斯', '是', '乃',
    '即', '皆', '俱', '悉', '诸', '众', '凡', '何',
    '孰', '安', '谁', '哪', '啥', '怎', '奈', '岂', '奚',
    '胡', '曷', '罢了', '而已', '乃是', '却是',
    '都是', '总是', '不能', '能够', '足以',
    '得', '能', '会', '可', '该', '当', '须', '应', '需', '要',
    '个', '些', '等', '某', '各', '每', '另', '本', '该',
    '这么', '那么', '这样', '那样',
    '怎样', '如何', '为何', '何以', '因何',
    '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '百', '千', '万', '亿', '兆', '零', '半', '全', '整', '满',
    '左', '右', '里', '外', '中', '内',
    '东', '南', '西', '北', '东北', '西北', '东南', '西南',
    '春', '夏', '秋', '冬', '风', '霜', '雨', '雪', '雷', '电',
    '我', '他', '她', '它', '们', '不', '人', '都', '也', '很', '去',
    '你', '好', '不过', '已经', '还', '又', '再', '才', '只', '并',
    '等等', '耳', '汝', '吾', '余', '予',
    '往', '自', '自从', '对于', '关于', '为了', '由于',
    '接着', '首先', '其次', '再次',
    '一是', '二是', '三是', '一方面', '另一方面',
    '既', '然而', '假如', '倘若',
    '要是', '便', '哪怕', '总', '除非', '否则', '以及',
    '地', '吧', '吗', '呢', '啊',
    '呀', '哦', '哈', '嘿', '哼', '嗯', '唉', '喔', '咦', '嗨',
    '喂', '呵', '哇', '噻', '噢', '呃', '哟', '啧', '喏', '喵',
    '汪', '叽', '咔', '咚', '当', '砰', '哗', '轰', '嗡', '嘟',
    '嘀', '嗒', '咻', '唰', '嗖', '叮', '铃', '哐', '锵',
    '间', '旁', '来',
    '这般', '那般',
    '哪里', '哪儿', '几时', '多少', '几', '多', '少',
    '大', '小', '长', '短', '高', '低', '快', '慢', '新', '旧',
    '老', '少', '男', '女',
    '听见', '感到', '以为', '认为',
    '进去', '上去', '回去', '坐下',
    '站起', '打开', '关上', '放下', '拿起', '带上', '脱下', '穿起'
]);

const NAME_STOP_CHARS = new Set([
    '有', '么', '是', '的', '了', '吗', '呢', '啊', '吧', '啦',
    '这', '那', '哪', '什', '怎', '为', '何', '如', '若', '虽',
    '但', '而', '且', '或', '还', '也', '都', '就', '才', '又',
    '在', '于', '从', '向', '对', '给', '把', '被', '让', '使',
    '说', '道', '喊', '叫', '问', '答', '笑', '叹', '想', '暗道',
    '看', '听', '走', '跑', '飞', '打', '杀', '死', '伤', '败',
    '来', '去', '进', '出', '上', '下', '起', '落', '开', '关'
]);

const ENABLE_NGRAM_FREQ_FILTER = true;
const ENABLE_CONTEXT_FUNC_WORD_CHECK = true;
const ENABLE_VERB_PREFIX_SUFFIX_FILTER = true;

const NGRAM_FREQ_THRESHOLD = 0.01;
const NGRAM_FREQ_PENALTY = 3;

const CONTEXT_FUNC_WORD_FRONT = new Set([
    '的', '了', '在', '是', '有', '和', '与', '及', '等', '也',
    '都', '就', '才', '又', '还', '而', '但', '如', '若'
]);

const CONTEXT_FUNC_WORD_BACK = new Set([
    '的', '了', '着', '过', '地', '得', '是', '在', '有', '吗',
    '呢', '啊', '吧', '啦'
]);

const CONTEXT_FUNC_WORD_PENALTY = 2;

const VERB_PREFIX_CHARS = new Set([
    '看', '听', '说', '走', '跑', '想', '知', '明', '感', '觉',
    '吃', '喝', '睡', '醒', '做', '打', '杀', '死', '伤', '败',
    '来', '去', '进', '出', '上', '下', '起', '落', '开', '关',
    '读', '写', '画', '唱', '跳', '飞', '游', '爬', '站', '坐',
    '笑', '哭', '怒', '喜', '悲', '恐', '惊', '思', '念', '忘',
    '记', '懂', '会', '能', '可', '该', '当', '须', '应', '需'
]);

const VERB_SUFFIX_CHARS = new Set([
    '了', '着', '过', '得', '地', '的', '是', '在', '有', '没',
    '不', '也', '就', '都', '还', '又', '才', '只', '很', '最',
    '更', '太', '真', '挺', '好', '坏', '对', '错', '行', '完'
]);

const VERB_PREFIX_PENALTY = 2;
const VERB_SUFFIX_PENALTY = 1;

const TITLE_SUFFIXES = [
    '先生', '小姐', '公子', '姑娘', '少爷', '夫人', '老爷', '太太',
    '前辈', '晚辈', '师兄', '师弟', '师姐', '师妹', '师父', '徒儿',
    '长老', '掌门', '门主', '教主', '宫主', '城主', '国王', '皇帝',
    '太子', '公主', '王爷', '侯爷', '将军', '丞相', '尚书', '大人'
];

const NEGATIVE_RELATION_WORDS = [
    '敌人', '仇人', '仇敌', '仇家', '对手', '敌手', '大敌', '死敌',
    '杀', '灭', '斩', '诛', '除', '剿', '伐', '讨', '攻', '击',
    '仇恨', '怨恨', '痛恨', '憎恨', '仇视', '敌对', '对抗', '对立',
    '害死', '杀死', '斩杀', '诛杀', '灭杀', '消灭', '铲除', '除掉',
    '不共戴天', '血海深仇', '深仇大恨', '报仇雪恨', '复仇', '报仇'
];

const ALLY_RELATION_WORDS = [
    '兄弟', '结拜', '战友', '同伴', '同盟', '挚友', '袍泽', '同盟军',
    '生死之交', '并肩', '携手', '同盟关系'
];

const ABILITY_PATTERN_WORDS = new Set([
    '能力', '才能', '擅长', '精通', '掌握', '本事', '技能'
]);

const ABILITY_NOUN_PREFIXES = new Set([
    '军事', '领导', '战斗', '艺术', '商业', '医术', '占卜', '谋略', '指挥', '创造',
    '预知', '控制', '感知', '治愈', '隐匿', '炼金', '制药', '魔法', '剑术', '刀法',
    '枪法', '箭术', '厨艺', '音律', '书法', '绘画', '雕刻', '辩论', '演讲', '谈判',
    '管理', '组织', '设计', '发明', '编程', '破解', '追踪', '潜行', '伪装', '易容',
    '变身', '召唤', '契约', '封印', '献祭', '祈祷', '祝福', '诅咒', '催眠', '通灵',
    '读心', '瞬移', '飞行', '潜水', '鉴定', '复制', '掠夺', '吞噬'
]);

const TIME_ADVERB_CHARS = new Set([
    '晚', '天', '周', '月', '年', '日', '时', '后', '前',
    '才', '就', '也', '还', '又', '再', '常', '总', '每', '各', '某',
    '只', '仅', '刚', '已', '将', '正', '在', '便', '即'
]);

const SURNAMES = [
    '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
    '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
    '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧',
    '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕',
    '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎',
    '余', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜',
    '范', '方', '石', '姚', '谭', '廖', '邹', '熊', '金', '陆',
    '郝', '孔', '白', '崔', '康', '毛', '邱', '秦', '江', '史',
    '顾', '侯', '邵', '孟', '龙', '万', '段', '漕', '钱', '汤',
    '尹', '黎', '易', '常', '武', '乔', '贺', '赖', '龚', '文',
    '欧阳', '司马', '上官', '端木', '独孤', '南宫', '东方', '皇甫',
    '尉迟', '公孙', '慕容', '轩辕', '令狐', '宇文', '司徒', '司空'
];

const TONE_WORDS = [
    '啊', '呢', '吧', '嘛', '呀', '哦', '哼', '呸', '切', '唉',
    '嗯', '嘿', '嗨', '喂', '哎呀', '哎哟', '哇', '哟', '嘎', '嗖',
    '噢', '嗷', '呜', '嘶', '呼', '呵', '嘁', '嗤', '咯', '哒'
];

const COLLOQUIAL_WORDS = [
    '咋', '啥', '俺', '咱', '恁', '你这', '你这人', '别', '嘛', '呗',
    '咋办', '咋整', '咋说', '啥子', '啥事', '啥意思', '咋样', '咋的',
    '搞啥', '搞什么', '弄啥', '瞎搞', '乱来', '胡说', '瞎说', '废话',
    '少废话', '别说了', '别说', '少说', '快点儿', '慢点', '等等',
    '过来', '过去', '起来', '下去', '你看', '你听', '我说', '他说的',
    '怎么搞的', '搞不懂', '搞明白', '搞清楚', '搞啥名堂', '咋回事'
];

const FORMAL_MARKERS = [
    '请', '劳烦', '敢问', '请问', '在下', '鄙人', '不才', '贱妾',
    '微臣', '老朽', '小可', '晚辈', '前辈', '阁下', '尊驾', '台端',
    '贵', '令', '宝', '高', '尊', '令尊', '令堂', '贵庚', '贵姓',
    '拜托', '承蒙', '赐教', '请教', '斧正', '雅正', '海涵', '包涵',
    '幸会', '久仰', '失敬', '冒昧', '唐突', '叨扰', '见谅', '恕罪'
];

const ALL_EMOTION_WORDS: string[] = (() => {
    const set = new Set<string>();
    for (const key of Object.keys(EMOTION_WORDS)) {
        for (const w of (EMOTION_WORDS as unknown as Record<string, string[]>)[key]) {
            set.add(w);
        }
    }
    return Array.from(set);
})();

export interface QualityScore {
    totalScore: number;
    characterCountScore: number;
    personalityQualityScore: number;
    abilityQualityScore: number;
    mainCharacterConfidence: number;
    roleDistributionScore: number;
}

export class CharacterDeconstructor {
    private dialogueVerbSet: Set<string>;
    private appearanceKeywordSet: Set<string>;
    private backgroundKeywordSet: Set<string>;
    private growthKeywordSet: Set<string>;
    private toneWordSet: Set<string>;
    private colloquialWordSet: Set<string>;
    private formalMarkerSet: Set<string>;
    private emotionWordSet: Set<string>;
    private vectorEnhancer?: VectorEnhancer;
    private knowledgeBase: WebnovelKnowledgeBase;
    private genreId: string;
    private genreConfig: GenreConfig;
    private adaptiveGenreConfig: AdaptiveGenreConfig;
    private readonly vectorThreshold = 0.35;
    private llmEnhancer?: LLMEnhancer;

    constructor(vectorEnhancer?: VectorEnhancer, genreId?: string, adaptiveGenreConfig?: AdaptiveGenreConfig) {
        this.dialogueVerbSet = new Set(DIALOGUE_VERBS);
        this.appearanceKeywordSet = new Set(APPEARANCE_KEYWORDS);
        this.backgroundKeywordSet = new Set(BACKGROUND_KEYWORDS);
        this.growthKeywordSet = new Set(GROWTH_KEYWORDS);
        this.toneWordSet = new Set(TONE_WORDS);
        this.colloquialWordSet = new Set(COLLOQUIAL_WORDS);
        this.formalMarkerSet = new Set(FORMAL_MARKERS);
        this.emotionWordSet = new Set(ALL_EMOTION_WORDS);
        this.vectorEnhancer = vectorEnhancer;
        this.knowledgeBase = new WebnovelKnowledgeBase();
        this.genreId = genreId || 'xuanhuan_xianxia';
        this.genreConfig = this.knowledgeBase.getGenre(this.genreId) || this.knowledgeBase.getDefaultGenre();
        // 题材自适应配置：优先使用传入的，未传入时从注册表获取 generic 兜底
        this.adaptiveGenreConfig = adaptiveGenreConfig ?? this.loadDefaultAdaptiveConfig();
    }

    /**
     * 注入 LLM 增强器。注入后 analyze 方法末尾会调用 LLM 做语义提炼。
     * 不注入时 analyze 行为完全不变（纯统计）。
     */
    setLLMEnhancer(llmEnhancer?: LLMEnhancer): void {
        this.llmEnhancer = llmEnhancer;
    }

    private loadDefaultAdaptiveConfig(): AdaptiveGenreConfig {
        try {
            return GenreConfigRegistry.getInstance().getGenreConfig('generic');
        } catch (e) {
            // 注册表未初始化时返回最小兜底配置，避免构造失败
            return {
                genreId: 'generic',
                displayName: '通用',
                behaviorTraits: [
                    { word: '大笑', trait: '开朗' },
                    { word: '怒', trait: '易怒' },
                    { word: '沉思', trait: '理性' },
                    { word: '微笑', trait: '温和' }
                ],
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

    async analyze(text: string): Promise<CharacterAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        const totalLength = text.length;
        const paragraphs = this.splitParagraphs(text);

        const nameCandidates = this.extractNameCandidates(text);
        const characterMentions = this.countCharacterMentions(text, nameCandidates);
        await yieldToUI();

        let characters = this.buildCharacters(text, paragraphs, characterMentions, totalLength);
        characters = this.mergeDuplicateCharacters(characters, text);
        const mainCharacter = this.determineMainCharacter(characters, text);
        // 强制主角 role 为 'protagonist'，并基于负面关系判定 antagonist
        if (mainCharacter) {
            const mainIdx = characters.findIndex(c => c.id === mainCharacter.id);
            if (mainIdx !== -1) {
                characters[mainIdx].role = 'protagonist';
            }
            // 对其他角色：降级错误的 protagonist，并判定 antagonist
            for (let i = 0; i < characters.length; i++) {
                if (i === mainIdx) continue;
                const char = characters[i];
                // 降级被错误设为 protagonist 的角色（buildCharacters 中 charIndex===0 可能不是真正主角）
                if (char.role === 'protagonist') {
                    char.role = 'deuteragonist';
                }
                // 判定 antagonist（盟友前置检查 + 提高阈值）
                const isAntagonist = this.hasNegativeRelationWithMain(text, char.name, mainCharacter.name);
                if (isAntagonist) {
                    char.role = 'antagonist';
                }
            }
        }
        await yieldToUI();

        const relations = this.analyzeRelations(text, characters, totalLength);

        this.analyzeCharacterArcs(text, characters, totalLength);
        await yieldToUI();
        this.analyzeCharacterImportance(text, characters, relations, totalLength);
        await yieldToUI();
        this.buildCharacterTimelines(text, characters, totalLength);
        await yieldToUI();
        const relationDetails = this.analyzeRelationDetails(text, characters, totalLength);
        const networkStats = this.calculateNetworkStats(characters, relations);

        const networkCentrality = await this.analyzeNetworkCentrality(text, paragraphs, characters);
        await yieldToUI();
        const voiceFingerprint = await this.analyzeVoiceFingerprint(text, characters);
        await yieldToUI();

        const stats = this.calculateStats(characters);

        const result: CharacterAnalysisResult = {
            characters,
            mainCharacter,
            relations,
            relationDetails,
            networkStats,
            networkCentrality,
            voiceFingerprint,
            stats
        };

        // 可选 LLM 增强：仅在注入了 llmEnhancer 时调用，失败时优雅降级
        if (this.llmEnhancer) {
            try {
                return await this.enhanceCharacterPersonalityWithLLM(text, paragraphs, result);
            } catch (e) {
                log.warn('[CharacterDeconstructor] LLM 增强失败，使用纯统计结果', e);
                return result;
            }
        }

        return result;
    }

    async analyzeWithVector(text: string): Promise<CharacterAnalysisResult> {
        const baseResult = await this.analyze(text);
        await yieldToUI();

        if (!this.vectorEnhancer || !text || text.length === 0 || baseResult.characters.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.warn('[CharacterDeconstructor] 向量模型不可用，返回纯关键词结果');
                return baseResult;
            }
        } catch (e) {
            log.warn('[CharacterDeconstructor] 向量增强不可用，降级为纯统计', e);
            return baseResult;
        }

        let enhancedResult = { ...baseResult };

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceCharacterRelations(text, enhancedResult);
        } catch (e) {
            log.warn('[CharacterDeconstructor] 人物关系向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceCharacterFeatures(text, enhancedResult);
        } catch (e) {
            log.warn('[CharacterDeconstructor] 人物特征向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceGrowthStages(text, enhancedResult);
        } catch (e) {
            log.warn('[CharacterDeconstructor] 成长阶段向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult = await this.enhanceCharacterRoles(text, enhancedResult);
        } catch (e) {
            log.warn('[CharacterDeconstructor] 角色分类向量增强失败', e);
        }

        return enhancedResult;
    }

    async saveToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookCharacterExtractionFile(bookName, baseDir);
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
        result: CharacterAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookCharacterExtractionFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    private getEmptyResult(): CharacterAnalysisResult {
        return {
            characters: [],
            mainCharacter: undefined,
            relations: [],
            stats: {
                totalCharacters: 0,
                mainCharacterCount: 0,
                avgAppearancePerCharacter: 0
            }
        };
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }


    private isPlausibleName(name: string): boolean {
        if (name.length < 2 || name.length > 4) return false;
        if (COMMON_WORDS.has(name)) return false;

        const lastChar = name[name.length - 1];
        if (NAME_STOP_CHARS.has(lastChar)) return false;

        if (name.length === 2) {
            const firstChar = name[0];
            if (NAME_STOP_CHARS.has(firstChar)) return false;
        }

        let verbCount = 0;
        for (const char of name) {
            if (NAME_STOP_CHARS.has(char)) {
                verbCount++;
            }
        }
        if (verbCount >= name.length / 2) return false;

        return true;
    }

    private calculateParagraphStartWeight(text: string, name: string): number {
        const paragraphs = text.split(/\r?\n\r?\n/);
        let startCount = 0;
        for (const p of paragraphs) {
            const trimmed = p.trim();
            if (trimmed.startsWith(name)) {
                startCount++;
            }
        }
        return startCount * 2;
    }

    private calculateTitleCooccurrenceWeight(text: string, name: string): number {
        let weight = 0;
        const contextWindow = 10;
        let idx = 0;
        while ((idx = text.indexOf(name, idx)) !== -1) {
            const start = Math.max(0, idx - contextWindow);
            const end = Math.min(text.length, idx + name.length + contextWindow);
            const context = text.substring(start, end);
            for (const title of TITLE_SUFFIXES) {
                if (context.includes(title)) {
                    weight += 1;
                    break;
                }
            }
            idx += name.length;
        }
        return weight;
    }

    private buildBigramFrequencyMap(text: string): Map<string, number> {
        const freqMap = new Map<string, number>();
        const chars = text.replace(/[^\u4e00-\u9fa5]/g, '');
        let totalBigrams = 0;
        for (let i = 0; i < chars.length - 1; i++) {
            const bigram = chars.substring(i, i + 2);
            freqMap.set(bigram, (freqMap.get(bigram) || 0) + 1);
            totalBigrams++;
        }
        (freqMap as Map<string, number> & { _total?: number })._total = totalBigrams;
        return freqMap;
    }

    private calculateNgramFrequencyPenalty(name: string, freqMap: Map<string, number>): number {
        if (!ENABLE_NGRAM_FREQ_FILTER) return 0;
        if (name.length !== 2) return 0;
        const freq = freqMap.get(name) || 0;
        const total = (freqMap as Map<string, number> & { _total?: number })._total || 1;
        const ratio = freq / total;
        if (ratio > NGRAM_FREQ_THRESHOLD) {
            return NGRAM_FREQ_PENALTY;
        }
        return 0;
    }

    private calculateContextFuncWordPenalty(text: string, name: string): number {
        if (!ENABLE_CONTEXT_FUNC_WORD_CHECK) return 0;
        let penalty = 0;
        let idx = 0;
        let occurrenceCount = 0;
        let bothSidesCount = 0;
        while ((idx = text.indexOf(name, idx)) !== -1) {
            occurrenceCount++;
            const frontChar = idx > 0 ? text[idx - 1] : '';
            const backChar = idx + name.length < text.length ? text[idx + name.length] : '';
            const frontIsFunc = frontChar && CONTEXT_FUNC_WORD_FRONT.has(frontChar);
            const backIsFunc = backChar && CONTEXT_FUNC_WORD_BACK.has(backChar);
            if (frontIsFunc && backIsFunc) {
                bothSidesCount++;
            }
            idx += name.length;
        }
        if (occurrenceCount > 0 && bothSidesCount / occurrenceCount >= 0.3) {
            penalty = CONTEXT_FUNC_WORD_PENALTY;
        }
        return penalty;
    }

    private calculateVerbPrefixSuffixPenalty(name: string): number {
        if (!ENABLE_VERB_PREFIX_SUFFIX_FILTER) return 0;
        let penalty = 0;
        const surnameSet = new Set(SURNAMES.filter(s => s.length === 1));
        const firstChar = name[0];
        const lastChar = name[name.length - 1];
        if (name.length >= 2 && VERB_PREFIX_CHARS.has(firstChar)) {
            const secondChar = name[1];
            if (!surnameSet.has(secondChar)) {
                penalty += VERB_PREFIX_PENALTY;
            }
        }
        if (VERB_SUFFIX_CHARS.has(lastChar)) {
            penalty += VERB_SUFFIX_PENALTY;
        }
        return penalty;
    }

    private extractNameCandidates(text: string): string[] {
        const candidates = new Map<string, number>();
        const bigramFreqMap = ENABLE_NGRAM_FREQ_FILTER ? this.buildBigramFrequencyMap(text) : new Map<string, number>();

        for (const surname of SURNAMES) {
            const regex = new RegExp(surname + '[\\u4e00-\\u9fa5]{1,2}', 'g');
            let match;
            while ((match = regex.exec(text)) !== null) {
                const name = match[0];
                if (this.isPlausibleName(name)) {
                    candidates.set(name, (candidates.get(name) || 0) + 2);
                }
            }
        }

        const dialoguePattern = /([\u4e00-\u9fa5]{2,4})(说|道|喊|叫|问|答|笑|叹|怒道|冷笑|低语|喃喃|轻声|大声|心想|暗道|暗想|默念)/g;
        let match;
        while ((match = dialoguePattern.exec(text)) !== null) {
            const name = match[1];
            if (this.isPlausibleName(name)) {
                candidates.set(name, (candidates.get(name) || 0) + 5);
            }
        }

        for (const [name, baseWeight] of candidates.entries()) {
            const paraWeight = this.calculateParagraphStartWeight(text, name);
            const titleWeight = this.calculateTitleCooccurrenceWeight(text, name);
            const ngramPenalty = this.calculateNgramFrequencyPenalty(name, bigramFreqMap);
            const contextPenalty = this.calculateContextFuncWordPenalty(text, name);
            const verbPenalty = this.calculateVerbPrefixSuffixPenalty(name);
            const finalWeight = baseWeight + paraWeight + titleWeight - ngramPenalty - contextPenalty - verbPenalty;
            candidates.set(name, Math.max(0, finalWeight));
        }

        const sortedCandidates = Array.from(candidates.entries())
            .filter(([_, count]) => count >= 5)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);

        // 复用语义分析器的噪声词过滤，剔除动词/形容词/虚词伪人名
        return SemanticAnalyzer.filterNoiseWords(sortedCandidates).slice(0, 50);
    }

    private countCharacterMentions(text: string, names: string[]): Map<string, { count: number; positions: number[] }> {
        const result = new Map<string, { count: number; positions: number[] }>();

        for (const name of names) {
            const positions: number[] = [];
            let count = 0;
            let idx = 0;
            while ((idx = text.indexOf(name, idx)) !== -1) {
                count++;
                positions.push(idx);
                idx += name.length;
            }
            if (count > 0) {
                result.set(name, { count, positions });
            }
        }

        return result;
    }

    private buildCharacters(
        text: string,
        paragraphs: string[],
        mentions: Map<string, { count: number; positions: number[] }>,
        totalLength: number
    ): Character[] {
        const characters: Character[] = [];
        const totalMentions = Array.from(mentions.values()).reduce((sum, m) => sum + m.count, 0);
        let charIndex = 0;

        for (const [name, data] of mentions.entries()) {
            const firstAppearance = data.positions[0] / totalLength;
            const lastAppearance = data.positions[data.positions.length - 1] / totalLength;
            const mentionCount = data.count;

            const mentionRatio = mentionCount / Math.max(totalMentions, 1);
            let role: Character['role'] = 'minor';

            if (charIndex === 0) {
                role = 'protagonist';
            } else if (mentionRatio > 0.15) {
                role = 'deuteragonist';
            } else if (mentionRatio > 0.05) {
                role = 'supporting';
            }

            const appearanceDesc = this.extractAppearance(text, name);
            const personality = this.extractPersonality(text, name);
            const abilities = this.extractAbilities(text, name);
            const background = this.extractBackground(text, name);
            const gender = this.detectGender(text, name);
            const aliases = this.findAliases(text, name);
            const growthStages = this.extractGrowthStages(text, name, totalLength);

            characters.push({
                id: `char_${charIndex}`,
                name,
                aliases,
                role,
                gender,
                appearance: appearanceDesc,
                personality,
                abilities,
                background,
                firstAppearance: this.clamp01(firstAppearance),
                lastAppearance: this.clamp01(lastAppearance),
                appearanceCount: data.positions.length,
                mentionCount,
                growthStages,
                relationships: []
            });

            charIndex++;
        }

        return characters.sort((a, b) => b.mentionCount - a.mentionCount);
    }

    private extractAppearance(text: string, name: string): string | undefined {
        const descriptions: string[] = [];
        const contextWindow = 100;

        for (const keyword of this.appearanceKeywordSet) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);

                if (context.includes(name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence && !descriptions.includes(sentence)) {
                        descriptions.push(sentence);
                    }
                }
                idx += keyword.length;
            }
        }

        return descriptions.length > 0 ? descriptions.join('；') : undefined;
    }

    private extractPersonality(text: string, name: string): string[] {
        const evidenceMap = this.collectPersonalityEvidence(text, name);
        if (evidenceMap.size === 0) {
            return [];
        }

        const allowedTags = this.buildAllowedPersonalityTags();
        const candidates = Array.from(evidenceMap.values())
            .map(item => ({
                trait: item.trait,
                score: this.scorePersonalityEvidence(item),
                evidenceCount: item.evidence.length,
            }))
            .filter(item => this.isValidPersonalityTag(item.trait, allowedTags) && item.score >= 1.5)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount;
                return a.trait.localeCompare(b.trait, 'zh-CN');
            })
            .slice(0, 8)
            .map(item => item.trait);

        return candidates;
    }

    /**
     * 判断行为词是否以该角色为主体发起。
     * 主体判定规则（按优先级）：
     * 1. 行为词紧邻角色名（"紫川秀大笑"、"秀儿沉思"）→ 强主体
     * 2. 同一句子中角色名在行为词之前，且中间没有他人名/代词隔断 → 中主体
     * 3. 仅在段落共现但句子不含角色名 → 弱主体（观察者/被提及）
     */
    private judgeBehaviorSubject(paragraph: string, name: string, behaviorWord: string): 'strong' | 'medium' | 'weak' {
        // 强主体：紧邻匹配（允许"道/说/喊"等言说动词和标点间隔）
        const strongPattern = new RegExp(
            `${name}(?:道|说|喊|叫|问|答|笑|叹|怒|想|心想|暗道|低声|高声|沉声|轻声|缓缓|突然|转身|抬头|低头|皱眉|摇头|点头|站起|坐下|沉默|沉思)?[，。！？：；、\\s]*${behaviorWord}`,
            'u'
        );
        if (strongPattern.test(paragraph)) {
            return 'strong';
        }

        // 中主体：同一句子中角色名在行为词之前
        const sentences = paragraph.split(/(?<=[。！？；])/u);
        for (const sentence of sentences) {
            const nameIdx = sentence.indexOf(name);
            const wordIdx = sentence.indexOf(behaviorWord);
            if (nameIdx !== -1 && wordIdx !== -1 && nameIdx < wordIdx) {
                return 'medium';
            }
        }

        return 'weak';
    }

    private collectPersonalityEvidence(text: string, name: string): Map<string, { trait: string; evidence: string[]; hits: number; paragraphs: Set<number>; subjectScore: number }> {
        const behaviorTraits = this.adaptiveGenreConfig.behaviorTraits;
        const evidenceMap = new Map<string, { trait: string; evidence: string[]; hits: number; paragraphs: Set<number>; subjectScore: number }>();

        if (!behaviorTraits || behaviorTraits.length === 0) {
            return evidenceMap;
        }

        const paragraphs = this.splitParagraphs(text);
        for (const { word, trait } of behaviorTraits) {
            for (let i = 0; i < paragraphs.length; i++) {
                const paragraph = paragraphs[i];
                if (!paragraph.includes(name) || !paragraph.includes(word)) {
                    continue;
                }

                const context = this.extractSentence(paragraph, word) || paragraph;
                if (!context.includes(name)) {
                    continue;
                }

                const subject = this.judgeBehaviorSubject(paragraph, name, word);
                // 弱主体（观察者/被提及）不计入性格证据，避免把他人行为误贴到角色身上
                if (subject === 'weak') {
                    continue;
                }

                const normalized = this.normalizeTraitText(trait);
                if (!normalized) {
                    continue;
                }

                const current = evidenceMap.get(normalized) ?? {
                    trait: normalized,
                    evidence: [],
                    hits: 0,
                    paragraphs: new Set<number>(),
                    subjectScore: 0
                };

                // 强主体权重 2，中主体权重 1
                const weight = subject === 'strong' ? 2 : 1;
                current.hits += weight;
                current.subjectScore += weight;
                current.paragraphs.add(i);
                if (!current.evidence.includes(context)) {
                    current.evidence.push(context);
                }
                evidenceMap.set(normalized, current);
            }
        }

        return evidenceMap;
    }

    private scorePersonalityEvidence(item: { evidence: string[]; hits: number; paragraphs: Set<number>; subjectScore?: number }): number {
        // 兼容旧调用（无 subjectScore 字段）
        const subjectBonus = (item.subjectScore ?? item.hits) * 0.5;
        return item.hits + item.paragraphs.size * 0.75 + Math.min(item.evidence.length, 3) * 0.5 + subjectBonus;
    }

    private buildAllowedPersonalityTags(): Set<string> {
        const allowed = new Set<string>();
        for (const tag of this.genreConfig.personalityTags || []) {
            const normalized = this.normalizeTraitText(tag);
            if (normalized) {
                allowed.add(normalized);
            }
        }
        for (const { trait } of this.adaptiveGenreConfig.behaviorTraits || []) {
            const normalized = this.normalizeTraitText(trait);
            if (normalized) {
                allowed.add(normalized);
            }
        }
        return allowed;
    }

    private normalizeTraitText(text: string): string {
        return text.trim().replace(/[“”"'‘’\s。、，,；;：:!?！？·•]/g, '');
    }

    private isValidPersonalityTag(tag: string, allowedTags: Set<string>): boolean {
        const normalized = this.normalizeTraitText(tag);
        if (!normalized) return false;
        if (normalized.length < 2 || normalized.length > 8) return false;
        if (/[0-9]/.test(normalized)) return false;
        if (/^(?:的|了|呢|吗|吧|啊|呀|嘛|和|与|及|在|是|有|很|更|最|还|才|就|被|把)$/.test(normalized)) return false;
        if (/(?:一面|方面|样子|感觉|状态|气质|角色|人格|性格|知的一面|那才是|和镇定万)$/u.test(normalized)) return false;
        return allowedTags.size === 0 || allowedTags.has(normalized);
    }

    /**
     * 为 LLM 增强构造角色上下文。
     *
     * 将 behaviorTraits 命中的段落按全文均匀采样（避免只取开头 5 段），
     * 确保 LLM 能看到全文中后期的行为变化。
     *
     * 采样策略：
     * - 对命中段落按原文顺序排列
     * - 从首、中 1/3、中 2/3、尾四个区间各取最多 2 段
     * - 总字符上限 2000 字
     */
    private buildPersonalityContext(text: string, name: string, maxChars: number = 2000): string {
        const paragraphs = this.splitParagraphs(text);
        const behaviorTraits = this.adaptiveGenreConfig.behaviorTraits || [];

        // 收集所有命中的段落（含 name + 至少一个行为词）
        const scored: { paragraph: string; index: number }[] = [];
        for (let i = 0; i < paragraphs.length; i++) {
            const paragraph = paragraphs[i];
            if (!paragraph.includes(name)) continue;

            let score = 0;
            for (const { word } of behaviorTraits) {
                if (paragraph.includes(word)) score += 1;
            }
            if (score > 0) {
                scored.push({ paragraph, index: i });
            }
        }

        // 无命中时取全文均匀采样含 name 的段落
        if (scored.length === 0) {
            for (let i = 0; i < paragraphs.length; i++) {
                if (paragraphs[i].includes(name)) {
                    scored.push({ paragraph: paragraphs[i], index: i });
                }
            }
        }

        if (scored.length === 0) return '';
        if (scored.length <= 5) {
            return scored.map(s => s.paragraph).join('\n\n').slice(0, maxChars);
        }

        // 均匀采样：首、中 1/3、中 2/3、尾四个区间各取最多 2 段
        const sampled: string[] = [];
        const total = scored.length;
        const intervals = [
            [0, Math.floor(total * 0.25)],
            [Math.floor(total * 0.25), Math.floor(total * 0.5)],
            [Math.floor(total * 0.5), Math.floor(total * 0.75)],
            [Math.floor(total * 0.75), total]
        ];

        for (const [start, end] of intervals) {
            const slice = scored.slice(start, Math.max(end, start + 1));
            // 每区间取首尾各 1 段
            if (slice.length > 0) {
                sampled.push(slice[0].paragraph);
            }
            if (slice.length > 1) {
                sampled.push(slice[slice.length - 1].paragraph);
            }
        }

        return sampled.join('\n\n').slice(0, maxChars);
    }

    private async enhanceCharacterPersonalityWithLLM(
        text: string,
        paragraphs: string[],
        result: CharacterAnalysisResult
    ): Promise<CharacterAnalysisResult> {
        const target = result.mainCharacter ?? result.characters[0];
        if (!target) {
            return result;
        }

        const contextText = this.buildPersonalityContext(text, target.name) || LLMEnhancer.buildContextForDimension('personality', text, paragraphs);
        if (!contextText.trim()) {
            return result;
        }

        const enhanced = await this.llmEnhancer!.enhanceWithLLM<{ personality?: string[]; evidence?: string[] }>({
            dimension: 'personality',
            text: contextText,
            genreConfig: this.adaptiveGenreConfig,
            existingResult: {
                personality: target.personality,
                evidence: []
            }
        });

        if (!enhanced.success || !enhanced.data) {
            return result;
        }

        const allowedTags = this.buildAllowedPersonalityTags();
        const merged = [
            ...target.personality,
            ...(enhanced.data.personality || [])
        ]
            .map(tag => this.normalizeTraitText(tag))
            .filter(tag => this.isValidPersonalityTag(tag, allowedTags))
            .filter((tag, index, array) => array.indexOf(tag) === index)
            .slice(0, 8);

        if (merged.length === 0) {
            return result;
        }

        const characters = result.characters.map(char =>
            char.id === target.id ? { ...char, personality: merged } : char
        );
        const mainCharacter = result.mainCharacter?.id === target.id
            ? { ...result.mainCharacter, personality: merged }
            : result.mainCharacter;

        return {
            ...result,
            characters,
            mainCharacter,
        };
    }

    private extractAbilities(text: string, name: string): string[] {
        // 从 adaptiveGenreConfig.abilityKeywords 读取能力词
        const abilityKeywords = this.adaptiveGenreConfig.abilityKeywords;
        if (!abilityKeywords || abilityKeywords.length === 0) {
            return [];
        }

        const abilities: string[] = [];
        const contextWindow = 80;

        for (const keyword of abilityKeywords) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);

                if (context.includes(name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence) {
                        const ability = this.extractAbilityName(sentence, keyword);
                        if (ability && !abilities.includes(ability)) {
                            abilities.push(ability);
                        }
                    }
                }
                idx += keyword.length;
            }
        }

        return abilities.slice(0, 10);
    }

    private extractBackground(text: string, name: string): string | undefined {
        const descriptions: string[] = [];
        const contextWindow = 120;

        for (const keyword of this.backgroundKeywordSet) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);

                if (context.includes(name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence && !descriptions.includes(sentence)) {
                        descriptions.push(sentence);
                    }
                }
                idx += keyword.length;
            }
        }

        return descriptions.length > 0 ? descriptions.join('；') : undefined;
    }

    private detectGender(text: string, name: string): 'male' | 'female' | 'unknown' {
        let maleScore = 0;
        let femaleScore = 0;

        const malePronouns = ['他', '先生', '公子', '少爷', '男子', '汉子', '男人', '小哥'];
        const femalePronouns = ['她', '小姐', '姑娘', '女子', '少女', '妇人', '女人', '妹妹'];

        const contextWindow = 50;
        let idx = 0;

        while ((idx = text.indexOf(name, idx)) !== -1) {
            const start = Math.max(0, idx - contextWindow);
            const end = Math.min(text.length, idx + name.length + contextWindow);
            const context = text.substring(start, end);

            for (const p of malePronouns) {
                if (context.includes(p)) maleScore++;
            }
            for (const p of femalePronouns) {
                if (context.includes(p)) femaleScore++;
            }

            idx += name.length;
        }

        if (maleScore > femaleScore * 2) return 'male';
        if (femaleScore > maleScore * 2) return 'female';
        return 'unknown';
    }

    private findAliases(text: string, name: string): string[] {
        const aliases: string[] = [];
        const aliasPatterns = [
            new RegExp(`(${name})[，,].*?又名[“"]([^"”]+)[”"]`, 'g'),
            new RegExp(`(${name})[，,].*?又称[“"]([^"”]+)[”"]`, 'g'),
            new RegExp(`[“"]([^"”]+)[”"].*?即[是]?[，,]?${name}`, 'g'),
            new RegExp(`${name}.*?外号[叫]?[“"]([^"”]+)[”"]`, 'g')
        ];

        for (const pattern of aliasPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const alias = match[2] || match[1];
                if (alias && alias !== name && !aliases.includes(alias) && alias.length <= 6) {
                    aliases.push(alias);
                }
            }
        }

        return aliases.slice(0, 5);
    }

    private mergeDuplicateCharacters(characters: Character[], text: string): Character[] {
        if (characters.length <= 1) return characters;

        const parent = new Map<string, string>();
        const find = (name: string): string => {
            if (!parent.has(name)) parent.set(name, name);
            if (parent.get(name) !== name) {
                parent.set(name, find(parent.get(name)!));
            }
            return parent.get(name)!;
        };
        const union = (nameA: string, nameB: string) => {
            const rootA = find(nameA);
            const rootB = find(nameB);
            if (rootA !== rootB) {
                const charA = characters.find(c => c.name === rootA);
                const charB = characters.find(c => c.name === rootB);
                if (charA && charB) {
                    if (charA.mentionCount >= charB.mentionCount) {
                        parent.set(rootB, rootA);
                    } else {
                        parent.set(rootA, rootB);
                    }
                }
            }
        };

        const nameToChar = new Map(characters.map(c => [c.name, c]));
        for (const char of characters) {
            find(char.name);
        }

        for (let i = 0; i < characters.length; i++) {
            for (let j = i + 1; j < characters.length; j++) {
                const charA = characters[i];
                const charB = characters[j];

                if (this.isSameCharacter(charA.name, charB.name, text)) {
                    union(charA.name, charB.name);
                }
            }
        }

        for (const char of characters) {
            const aliases = this.findAliases(text, char.name);
            for (const alias of aliases) {
                if (nameToChar.has(alias)) {
                    union(char.name, alias);
                }
            }
        }

        const mergedMap = new Map<string, Character>();
        for (const char of characters) {
            const rootName = find(char.name);
            if (!mergedMap.has(rootName)) {
                mergedMap.set(rootName, { ...char, aliases: [...char.aliases] });
            } else {
                const merged = mergedMap.get(rootName)!;
                merged.aliases = Array.from(new Set([...merged.aliases, char.name, ...char.aliases]))
                    .filter(a => a !== merged.name)
                    .slice(0, 10);
                merged.mentionCount = Math.max(merged.mentionCount, char.mentionCount);
                merged.appearanceCount = Math.max(merged.appearanceCount, char.appearanceCount);
                merged.firstAppearance = Math.min(merged.firstAppearance, char.firstAppearance);
                merged.lastAppearance = Math.max(merged.lastAppearance, char.lastAppearance);
                merged.personality = Array.from(new Set([...merged.personality, ...char.personality])).slice(0, 8);
                merged.abilities = Array.from(new Set([...merged.abilities, ...char.abilities])).slice(0, 10);
                if (char.role === 'protagonist') merged.role = 'protagonist';
                else if (char.role === 'antagonist' && merged.role !== 'protagonist') merged.role = 'antagonist';
                else if (char.role === 'deuteragonist' && merged.role !== 'protagonist' && merged.role !== 'antagonist') merged.role = 'deuteragonist';
                if (!merged.gender || merged.gender === 'unknown') {
                    merged.gender = char.gender;
                }
                if (!merged.appearance && char.appearance) {
                    merged.appearance = char.appearance;
                }
                if (!merged.background && char.background) {
                    merged.background = char.background;
                }
                merged.growthStages = [...merged.growthStages, ...char.growthStages]
                    .sort((a, b) => a.position - b.position)
                    .slice(0, 15);
            }
        }

        return Array.from(mergedMap.values()).sort((a, b) => b.mentionCount - a.mentionCount);
    }

    private isSameCharacter(nameA: string, nameB: string, text: string): boolean {
        if (nameA === nameB) return true;
        if (nameA.includes(nameB) || nameB.includes(nameA)) {
            const shorter = nameA.length <= nameB.length ? nameA : nameB;
            const longer = nameA.length > nameB.length ? nameA : nameB;
            if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
                const minLen = Math.min(nameA.length, nameB.length);
                if (minLen >= 2) {
                    return true;
                }
            }
        }

        const surnameA = nameA[0];
        const surnameB = nameB[0];
        if (surnameA === surnameB && nameA.length >= 2 && nameB.length >= 2) {
            const cooc = this.calculateSimpleCooccurrence(text, nameA, nameB);
            if (cooc > 0.5) {
                return false;
            }
        }

        const aliasPatterns = [
            new RegExp(`${nameA}[，,].*?又名[“"]${nameB}[”"]`, 'g'),
            new RegExp(`${nameB}[，,].*?又名[“"]${nameA}[”"]`, 'g'),
            new RegExp(`${nameA}[，,].*?又称[“"]${nameB}[”"]`, 'g'),
            new RegExp(`${nameB}[，,].*?又称[“"]${nameA}[”"]`, 'g'),
            new RegExp(`[“"]${nameB}[”"].*?即[是]?[，,]?${nameA}`, 'g'),
            new RegExp(`[“"]${nameA}[”"].*?即[是]?[，,]?${nameB}`, 'g'),
        ];
        for (const pattern of aliasPatterns) {
            if (pattern.test(text)) {
                return true;
            }
        }

        const similarity = this.calculateNameSimilarity(nameA, nameB);
        if (similarity >= 0.6) {
            const cooc = this.calculateSimpleCooccurrence(text, nameA, nameB);
            if (cooc < 0.1) {
                return true;
            }
        }

        return false;
    }

    private calculateNameSimilarity(nameA: string, nameB: string): number {
        if (nameA === nameB) return 1;
        const setA = new Set(nameA.split(''));
        const setB = new Set(nameB.split(''));
        let intersection = 0;
        for (const ch of setA) {
            if (setB.has(ch)) intersection++;
        }
        const union = setA.size + setB.size - intersection;
        const jaccard = union > 0 ? intersection / union : 0;
        // 仅对长度不同的名称启用语义补充，避免同长名字一字之差被误合并
        const semantic = nameA.length === nameB.length
            ? 0
            : SemanticAnalyzer.semanticSimilarity(nameA, nameB);
        return Math.max(jaccard, semantic);
    }

    private calculateSimpleCooccurrence(text: string, nameA: string, nameB: string): number {
        const windowSize = 200;
        let coocCount = 0;
        let totalA = 0;
        let idx = 0;
        while ((idx = text.indexOf(nameA, idx)) !== -1) {
            totalA++;
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(text.length, idx + nameA.length + windowSize);
            const window = text.substring(start, end);
            if (window.includes(nameB)) {
                coocCount++;
            }
            idx += nameA.length;
        }
        return totalA > 0 ? coocCount / totalA : 0;
    }

    private extractGrowthStages(text: string, name: string, totalLength: number): Array<{ position: number; description: string }> {
        const stages: Array<{ position: number; description: string }> = [];
        const contextWindow = 80;

        for (const keyword of this.growthKeywordSet) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);

                if (context.includes(name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence) {
                        const position = idx / totalLength;
                        stages.push({
                            position: this.clamp01(position),
                            description: sentence
                        });
                    }
                }
                idx += keyword.length;
            }
        }

        return stages
            .sort((a, b) => a.position - b.position)
            .slice(0, 10);
    }

    private extractSentence(context: string, keyword: string): string {
        const keywordIdx = context.indexOf(keyword);
        if (keywordIdx === -1) return '';

        let start = keywordIdx;
        while (start > 0 && !/[。！？!?，,；;]/.test(context[start - 1])) {
            start--;
        }

        let end = keywordIdx + keyword.length;
        while (end < context.length && !/[。！？!?]/.test(context[end])) {
            end++;
        }
        if (end < context.length) end++;

        return context.substring(start, end).trim();
    }

    private extractAbilityName(sentence: string, keyword: string): string {
        const keywordIdx = sentence.indexOf(keyword);
        if (keywordIdx === -1) return '';

        // 模式1: "XX才能" - 提取"XX才能"（如"军事才能"）
        // 仅当"才能"是名词（天赋）而非副词"才+能"时才提取：
        // 前缀必须在名词白名单中，或前缀不含时间/副词噪声字且非虚词。
        const abilityMatch = sentence.match(/([\u4e00-\u9fa5]{2,4})才能/);
        if (abilityMatch) {
            const prefix = abilityMatch[1];
            const candidate = prefix + '才能';
            if (candidate.length >= 3 && candidate.length <= 6) {
                if (ABILITY_NOUN_PREFIXES.has(prefix)) return candidate;
                if (prefix.length > 0 &&
                    !COMMON_WORDS.has(prefix) &&
                    !Array.from(prefix).some(ch => TIME_ADVERB_CHARS.has(ch))) {
                    return candidate;
                }
            }
        }

        // 模式2: "擅长XX" / "精通XX" / "掌握XX" - 提取后的 2-4 字
        const skillMatch = sentence.match(/(?:擅长|精通|掌握)([\u4e00-\u9fa5]{2,4})/);
        if (skillMatch && skillMatch[1]) {
            return skillMatch[1];
        }

        // 模式3: 引号包裹的能力名
        const quotedMatch = sentence.match(/[“"]([^"”]{2,8})[”"]/);
        if (quotedMatch && quotedMatch[1]) {
            return quotedMatch[1];
        }

        // 模式4: 关键词 + 后续 1-2 字组合（如"蛊惑"→"蛊惑人心"）
        if (keywordIdx + keyword.length < sentence.length) {
            const afterKeyword = sentence.substring(keywordIdx + keyword.length);
            const nextMatch = afterKeyword.match(/^([\u4e00-\u9fa5]{1,2})/);
            if (nextMatch && nextMatch[1] && nextMatch[1].length >= 1) {
                const combined = keyword + nextMatch[1];
                if (!COMMON_WORDS.has(combined) && !COMMON_WORDS.has(nextMatch[1]) &&
                    combined.length >= 2 && combined.length <= 6) {
                    return combined;
                }
            }
        }

        // 模式5: 关键词本身（仅当不是模式词且长度 >= 2 时）
        if (keyword.length >= 2 && !ABILITY_PATTERN_WORDS.has(keyword)) {
            return keyword;
        }

        return '';
    }

    private calculateProtagonistScore(char: Character, text: string): number {
        let score = 0;

        score += char.mentionCount * 2;

        score += (1 - char.firstAppearance) * 50;

        const perspectivePatterns = [`${char.name}心想`, `${char.name}暗道`, `${char.name}暗想`, `${char.name}默念`, `${char.name}心中`];
        for (const pattern of perspectivePatterns) {
            let idx = 0;
            let count = 0;
            while ((idx = text.indexOf(pattern, idx)) !== -1) {
                count++;
                idx += pattern.length;
            }
            score += count * 5;
        }

        const paragraphs = text.split(/\r?\n\r?\n/);
        let titleMentionCount = 0;
        for (const p of paragraphs.slice(0, 20)) {
            const trimmed = p.trim();
            if (trimmed.length < 30 && trimmed.includes(char.name)) {
                titleMentionCount++;
            }
        }
        score += titleMentionCount * 10;

        return score;
    }

    private hasNegativeRelationWithMain(text: string, charName: string, mainName: string): boolean {
        const windowSize = 150;
        let negativeCount = 0;
        let coOccurrenceCount = 0;
        let idx = 0;

        while ((idx = text.indexOf(charName, idx)) !== -1) {
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(text.length, idx + charName.length + windowSize);
            const context = text.substring(start, end);

            if (context.includes(mainName)) {
                coOccurrenceCount++;

                // 盟友判定前置检查：若存在盟友关系词，跳过 antagonist 判定
                const hasAllyRelation = ALLY_RELATION_WORDS.some(w => context.includes(w));
                if (hasAllyRelation) {
                    idx += charName.length;
                    continue;
                }

                for (const negWord of NEGATIVE_RELATION_WORDS) {
                    if (context.includes(negWord)) {
                        negativeCount++;
                        break;
                    }
                }
            }
            idx += charName.length;
        }

        // 新阈值：negativeCount >= 3 且 negativeRatio > 0.3
        const negativeRatio = coOccurrenceCount > 0 ? negativeCount / coOccurrenceCount : 0;
        return negativeCount >= 3 && negativeRatio > 0.3;
    }

    private determineMainCharacter(characters: Character[], text?: string): Character | undefined {
        if (characters.length === 0) return undefined;

        if (!text) {
            return characters[0];
        }

        let bestChar = characters[0];
        let bestScore = -Infinity;

        for (const char of characters) {
            const score = this.calculateProtagonistScore(char, text);
            if (score > bestScore) {
                bestScore = score;
                bestChar = char;
            }
        }

        return bestChar;
    }

    private analyzeRelations(
        text: string,
        characters: Character[],
        totalLength: number
    ): CharacterRelation[] {
        const relations: CharacterRelation[] = [];
        const relationSet = new Set<string>();

        if (characters.length < 2) return relations;

        for (let i = 0; i < characters.length; i++) {
            for (let j = i + 1; j < characters.length; j++) {
                const charA = characters[i];
                const charB = characters[j];

                const coOccurrenceScore = this.calculateCoOccurrence(text, charA.name, charB.name, totalLength);
                const relationType = this.detectRelationType(text, charA.name, charB.name);

                if (coOccurrenceScore > 0.01 || relationType) {
                    const weight = this.clamp01(coOccurrenceScore * 5 + (relationType ? 0.3 : 0));
                    const key = `${charA.id}_${charB.id}`;

                    if (!relationSet.has(key)) {
                        relationSet.add(key);
                        relations.push({
                            fromId: charA.id,
                            toId: charB.id,
                            type: relationType || '互动',
                            weight: this.round2(weight)
                        });

                        charA.relationships.push({
                            targetId: charB.id,
                            targetName: charB.name,
                            type: relationType || '互动'
                        });
                        charB.relationships.push({
                            targetId: charA.id,
                            targetName: charA.name,
                            type: relationType || '互动'
                        });
                    }
                }
            }
        }

        return relations
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 30);
    }

    private calculateCoOccurrence(text: string, nameA: string, nameB: string, totalLength: number): number {
        const windowSize = 200;
        let coCount = 0;
        let totalA = 0;

        let idx = 0;
        while ((idx = text.indexOf(nameA, idx)) !== -1) {
            totalA++;
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(text.length, idx + nameA.length + windowSize);
            const window = text.substring(start, end);

            if (window.includes(nameB)) {
                coCount++;
            }
            idx += nameA.length;
        }

        return totalA > 0 ? coCount / totalA : 0;
    }

    private detectRelationType(text: string, nameA: string, nameB: string): string | null {
        const contextWindow = 150;
        let idx = 0;

        while ((idx = text.indexOf(nameA, idx)) !== -1) {
            const start = Math.max(0, idx - contextWindow);
            const end = Math.min(text.length, idx + nameA.length + contextWindow);
            const context = text.substring(start, end);

            if (context.includes(nameB)) {
                for (const rel of RELATION_KEYWORDS) {
                    for (const word of rel.words) {
                        if (context.includes(word)) {
                            return rel.type;
                        }
                    }
                }
            }
            idx += nameA.length;
        }

        return null;
    }

    private analyzeCharacterArcs(text: string, characters: Character[], totalLength: number): void {
        for (const char of characters) {
            const initialState = this.extractInitialState(text, char, totalLength);
            const growthNodes = this.extractGrowthNodes(text, char, totalLength);
            const finalState = this.extractFinalState(text, char, totalLength);
            const transformationType = this.determineTransformationType(char, growthNodes);
            const completeness = this.calculateArcCompleteness(char, growthNodes, totalLength);

            char.characterArc = {
                initialState,
                growthNodes,
                transformationType,
                finalState,
                completeness
            };
        }
    }

    private extractInitialState(text: string, char: Character, totalLength: number): CharacterArc['initialState'] {
        const startPortion = text.substring(0, Math.floor(totalLength * 0.2));
        const personality = this.extractPersonality(startPortion, char.name);
        const abilities = this.extractAbilities(startPortion, char.name);
        const goals = this.extractGoals(startPortion, char.name);
        const description = this.extractFirstSentenceDescription(text, char.name);

        return {
            personality: personality.slice(0, 5),
            abilities: abilities.slice(0, 5),
            goals,
            description
        };
    }

    private extractFinalState(text: string, char: Character, totalLength: number): CharacterArc['finalState'] {
        const startIdx = Math.floor(totalLength * 0.7);
        const endPortion = text.substring(startIdx);
        const personality = this.extractPersonality(endPortion, char.name);
        const abilities = this.extractAbilities(endPortion, char.name);
        const description = this.extractFirstSentenceDescription(endPortion, char.name);

        return {
            personality: personality.slice(0, 5),
            abilities: abilities.slice(0, 5),
            description
        };
    }

    /**
     * 从角色首次出现的上下文中提取第一句话作为 description（1-2 句概述）
     * 不再截取原文段落，避免 description 过长
     */
    private extractFirstSentenceDescription(text: string, name: string): string | undefined {
        const contextWindow = 100;
        let idx = 0;
        while ((idx = text.indexOf(name, idx)) !== -1) {
            const start = Math.max(0, idx - contextWindow);
            const end = Math.min(text.length, idx + name.length + contextWindow);
            const context = text.substring(start, end);
            // 提取第一句话
            const sentenceMatch = context.match(/[^。！？]+[。！？]/);
            if (sentenceMatch && sentenceMatch[0].includes(name)) {
                const sentence = sentenceMatch[0].trim();
                return sentence.length > 60 ? sentence.substring(0, 60) + '...' : sentence;
            }
            idx += name.length;
        }
        return undefined;
    }

    private extractGoals(text: string, name: string): string[] {
        const goals: string[] = [];
        const goalKeywords = ['想要', '必须', '为了', '目标', '梦想', '愿望', '希望', '立志', '发誓', '决心', '追求', '理想'];
        const contextWindow = 80;

        for (const keyword of goalKeywords) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence) {
                        // 提炼：截取前 30 字作为简短目标描述
                        const refined = sentence.length > 30 ? sentence.substring(0, 30) + '...' : sentence;
                        if (!goals.includes(refined)) {
                            goals.push(refined);
                        }
                    }
                }
                idx += keyword.length;
            }
        }

        return goals.slice(0, 5);
    }

    private extractGrowthNodes(text: string, char: Character, totalLength: number): CharacterArc['growthNodes'] {
        const nodes: CharacterArc['growthNodes'] = [];
        const contextWindow = 100;

        const changeKeywords = [
            { keyword: '突破', type: '能力提升' },
            { keyword: '觉醒', type: '觉醒' },
            { keyword: '顿悟', type: '顿悟' },
            { keyword: '蜕变', type: '蜕变' },
            { keyword: '成长', type: '成长' },
            { keyword: '变强', type: '实力提升' },
            { keyword: '晋升', type: '晋升' },
            { keyword: '升级', type: '升级' },
            { keyword: '黑化', type: '黑化' },
            { keyword: '堕落', type: '堕落' },
            { keyword: '醒悟', type: '醒悟' },
            { keyword: '后悔', type: '反思' },
            { keyword: '改变', type: '转变' },
            { keyword: '学会', type: '新技能' },
            { keyword: '掌握', type: '掌握能力' },
            { keyword: '获得', type: '获得' },
            { keyword: '失去', type: '失去' },
            { keyword: '背叛', type: '背叛' },
            { keyword: '复仇', type: '复仇' },
            { keyword: '牺牲', type: '牺牲' }
        ];

        for (const { keyword, type } of changeKeywords) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(char.name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence) {
                        const position = idx / totalLength;
                        const trigger = this.findTrigger(context, keyword);
                        // 提炼：截取前 30 字作为简短事件描述
                        const refinedEvent = sentence.length > 30 ? sentence.substring(0, 30) + '...' : sentence;
                        nodes.push({
                            position: this.clamp01(position),
                            event: refinedEvent,
                            changeType: type,
                            trigger
                        });
                    }
                }
                idx += keyword.length;
            }
        }

        return nodes
            .sort((a, b) => a.position - b.position)
            .slice(0, 15);
    }

    private findTrigger(context: string, keyword: string): string | undefined {
        const triggerPatterns = [
            /因为(.+?)[，。！？]/,
            /由于(.+?)[，。！？]/,
            /在(.+?)之后/,
            /经过(.+?)[，。！？]/,
            /通过(.+?)[，。！？]/
        ];
        for (const pattern of triggerPatterns) {
            const match = context.match(pattern);
            if (match && match[1].length < 50) {
                return match[1].trim();
            }
        }
        return undefined;
    }

    private determineTransformationType(char: Character, growthNodes: CharacterArc['growthNodes']): CharacterArc['transformationType'] {
        if (growthNodes.length === 0) return 'stable';

        let growthCount = 0;
        let fallCount = 0;
        let awakeningCount = 0;
        let darkeningCount = 0;

        for (const node of growthNodes) {
            const t = node.changeType;
            if (['能力提升', '成长', '晋升', '升级', '新技能', '掌握能力', '获得', '顿悟', '蜕变'].includes(t)) {
                growthCount++;
            } else if (['堕落', '失去', '背叛'].includes(t)) {
                fallCount++;
            } else if (['觉醒', '醒悟', '反思', '转变'].includes(t)) {
                awakeningCount++;
            } else if (['黑化', '复仇'].includes(t)) {
                darkeningCount++;
            }
        }

        const total = growthNodes.length;
        const growthRatio = growthCount / total;
        const fallRatio = fallCount / total;
        const awakeningRatio = awakeningCount / total;
        const darkeningRatio = darkeningCount / total;

        if (darkeningRatio > 0.4) return 'darkening';
        if (awakeningRatio > 0.4) return 'awakening';
        if (fallRatio > 0.4) return 'fall';
        if (growthRatio > 0.3) return 'growth';
        if (char.growthStages.length > 3) return 'growth';
        return 'stable';
    }

    private calculateArcCompleteness(char: Character, growthNodes: CharacterArc['growthNodes'], totalLength: number): number {
        if (growthNodes.length === 0) return 0;

        const hasStart = char.firstAppearance < 0.3;
        const hasEnd = char.lastAppearance > 0.7;
        const nodeCount = Math.min(growthNodes.length, 10);
        const spreadScore = this.calculateNodeSpread(growthNodes);
        const varietyScore = new Set(growthNodes.map(n => n.changeType)).size / 5;

        let score = 0;
        score += hasStart ? 15 : 5;
        score += hasEnd ? 15 : 5;
        score += Math.min(nodeCount * 5, 30);
        score += spreadScore * 25;
        score += Math.min(varietyScore * 20, 20);

        return Math.round(Math.min(score, 100));
    }

    private calculateNodeSpread(nodes: CharacterArc['growthNodes']): number {
        if (nodes.length < 2) return 0;
        const positions = nodes.map(n => n.position).sort((a, b) => a - b);
        const first = positions[0];
        const last = positions[positions.length - 1];
        const span = last - first;

        let gaps = 0;
        for (let i = 1; i < positions.length; i++) {
            gaps += positions[i] - positions[i - 1];
        }
        const avgGap = gaps / (positions.length - 1);
        const evenness = 1 - Math.abs(avgGap - span / (positions.length - 1)) / span;

        return Math.max(0, Math.min(1, span * 0.6 + evenness * 0.4));
    }

    private analyzeCharacterImportance(
        text: string,
        characters: Character[],
        relations: CharacterRelation[],
        totalLength: number
    ): void {
        const totalDialogues = this.countTotalDialogues(text, characters);
        const totalPerspective = this.countTotalPerspective(text, characters);
        const totalMentions = characters.reduce((sum, c) => sum + c.mentionCount, 0);

        for (const char of characters) {
            const appearanceFrequency = totalMentions > 0 ? char.mentionCount / totalMentions : 0;
            const dialogueCount = this.countCharacterDialogues(text, char.name);
            const dialogueRatio = totalDialogues > 0 ? dialogueCount / totalDialogues : 0;
            const plotDrivingScore = this.calculatePlotDrivingScore(text, char, totalLength);
            const relationshipCentrality = this.calculateRelationshipCentrality(char, relations, characters);
            const perspectiveCount = this.countCharacterPerspective(text, char.name);
            const perspectiveRatio = totalPerspective > 0 ? perspectiveCount / totalPerspective : 0;
            // firstAppearance 权重：越早出场分越高（0-1 归一化）
            const firstAppearanceScore = 1 - char.firstAppearance;

            const totalScore = this.round2(
                appearanceFrequency * 0.30 +
                firstAppearanceScore * 0.20 +
                dialogueRatio * 0.20 +
                plotDrivingScore * 0.15 +
                relationshipCentrality * 0.10 +
                perspectiveRatio * 0.05
            );

            const tier = this.determineImportanceTier(totalScore, char);

            char.dialogueCount = dialogueCount;
            char.perspectiveCount = perspectiveCount;
            char.importance = {
                appearanceFrequency: this.round2(appearanceFrequency * 100),
                dialogueRatio: this.round2(dialogueRatio * 100),
                plotDrivingScore: this.round2(plotDrivingScore * 100),
                relationshipCentrality: this.round2(relationshipCentrality * 100),
                perspectiveRatio: this.round2(perspectiveRatio * 100),
                totalScore: this.round2(totalScore * 100),
                tier
            };
        }

        characters.sort((a, b) => (b.importance?.totalScore ?? 0) - (a.importance?.totalScore ?? 0));
    }

    private countTotalDialogues(text: string, characters: Character[]): number {
        let total = 0;
        for (const char of characters) {
            total += this.countCharacterDialogues(text, char.name);
        }
        return total || 1;
    }

    private countCharacterDialogues(text: string, name: string): number {
        let count = 0;
        for (const verb of DIALOGUE_VERBS) {
            const pattern = name + verb;
            let idx = 0;
            while ((idx = text.indexOf(pattern, idx)) !== -1) {
                count++;
                idx += pattern.length;
            }
        }
        return count;
    }

    private countTotalPerspective(text: string, characters: Character[]): number {
        let total = 0;
        for (const char of characters) {
            total += this.countCharacterPerspective(text, char.name);
        }
        return total || 1;
    }

    private countCharacterPerspective(text: string, name: string): number {
        const perspectiveMarkers = [`${name}心想`, `${name}暗道`, `${name}暗想`, `${name}默念`, `${name}心中`, `${name}觉得`, `${name}知道`];
        let count = 0;
        for (const marker of perspectiveMarkers) {
            let idx = 0;
            while ((idx = text.indexOf(marker, idx)) !== -1) {
                count++;
                idx += marker.length;
            }
        }
        return count;
    }

    private calculatePlotDrivingScore(text: string, char: Character, totalLength: number): number {
        const plotKeywords = [
            '决定', '计划', '命令', '带领', '发起', '阻止', '成功', '失败',
            '杀死', '击败', '战胜', '拯救', '帮助', '背叛', '复仇', '突破',
            '获得', '失去', '发现', '揭开', '秘密', '真相', '阴谋', '危机'
        ];
        const contextWindow = 100;
        let hitCount = 0;

        for (const keyword of plotKeywords) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(char.name)) {
                    hitCount++;
                }
                idx += keyword.length;
            }
        }

        char.keyEventCount = hitCount;
        return Math.min(hitCount / 50, 1);
    }

    private calculateRelationshipCentrality(
        char: Character,
        relations: CharacterRelation[],
        characters: Character[]
    ): number {
        const directRelations = relations.filter(
            r => r.fromId === char.id || r.toId === char.id
        );
        const degree = directRelations.length;
        const maxDegree = Math.max(characters.length - 1, 1);

        let weightedSum = 0;
        for (const rel of directRelations) {
            weightedSum += rel.weight;
        }

        const degreeScore = degree / maxDegree;
        const weightScore = Math.min(weightedSum / 3, 1);

        return degreeScore * 0.6 + weightScore * 0.4;
    }

    private determineImportanceTier(score: number, char: Character): CharacterImportance['tier'] {
        if (char.role === 'protagonist') return 'protagonist';
        if (score > 0.5) return 'core_supporting';
        if (score > 0.25) return 'important_supporting';
        if (score > 0.1) return 'minor_supporting';
        return 'extra';
    }

    private buildCharacterTimelines(text: string, characters: Character[], totalLength: number): void {
        for (const char of characters) {
            const events: CharacterTimelineEvent[] = [];

            events.push({
                position: char.firstAppearance,
                type: 'appearance',
                title: '首次出场',
                description: `${char.name} 首次登场`
            });

            if (char.growthStages) {
                for (const stage of char.growthStages) {
                    events.push({
                        position: stage.position,
                        type: 'growth',
                        title: stage.description.length > 30 ? stage.description.substring(0, 30) + '...' : stage.description,
                        description: stage.description
                    });
                }
            }

            if (char.characterArc?.growthNodes) {
                for (const node of char.characterArc.growthNodes) {
                    events.push({
                        position: node.position,
                        type: 'turning_point',
                        title: node.changeType,
                        description: node.event
                    });
                }
            }

            const relationEvents = this.extractRelationTimelineEvents(text, char, totalLength);
            events.push(...relationEvents);

            events.push({
                position: char.lastAppearance,
                type: 'appearance',
                title: '最后出场',
                description: `${char.name} 最后一次出场`
            });

            char.timeline = events
                .sort((a, b) => a.position - b.position)
                .slice(0, 20);
        }
    }

    private extractRelationTimelineEvents(text: string, char: Character, totalLength: number): CharacterTimelineEvent[] {
        const events: CharacterTimelineEvent[] = [];
        const relationEventKeywords = ['相遇', '认识', '结识', '结拜', '决裂', '反目', '和好', '和解', '告白', '订婚'];
        const contextWindow = 120;

        for (const keyword of relationEventKeywords) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(char.name)) {
                    const sentence = this.extractSentence(context, keyword);
                    if (sentence) {
                        events.push({
                            position: this.clamp01(idx / totalLength),
                            type: 'relationship',
                            title: keyword,
                            description: sentence
                        });
                    }
                }
                idx += keyword.length;
            }
        }

        return events;
    }

    private analyzeRelationDetails(text: string, characters: Character[], totalLength: number): CharacterRelationDetail[] {
        const details: CharacterRelationDetail[] = [];
        const processed = new Set<string>();

        for (let i = 0; i < characters.length; i++) {
            for (let j = i + 1; j < characters.length; j++) {
                const charA = characters[i];
                const charB = characters[j];
                const key = `${charA.id}_${charB.id}`;
                if (processed.has(key)) continue;

                const coOccurrenceScore = this.calculateCoOccurrence(text, charA.name, charB.name, totalLength);
                const relationType = this.detectRelationType(text, charA.name, charB.name);
                const strength = this.calculateRelationStrength(text, charA.name, charB.name, totalLength);

                if (coOccurrenceScore > 0.02 || relationType || strength > 0.15) {
                    const history = this.extractRelationHistory(text, charA.name, charB.name, totalLength);
                    const keyEvents = this.extractKeyRelationEvents(text, charA.name, charB.name, totalLength);

                    details.push({
                        fromId: charA.id,
                        toId: charB.id,
                        type: relationType || '互动',
                        strength: this.round2(strength * 100),
                        history,
                        keyEvents
                    });
                    processed.add(key);
                }
            }
        }

        return details
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 30);
    }

    private calculateRelationStrength(text: string, nameA: string, nameB: string, totalLength: number): number {
        const windowSize = 200;
        let coCount = 0;
        let totalA = 0;
        let totalB = 0;
        let closeInteraction = 0;

        let idx = 0;
        while ((idx = text.indexOf(nameA, idx)) !== -1) {
            totalA++;
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(text.length, idx + nameA.length + windowSize);
            const window = text.substring(start, end);
            if (window.includes(nameB)) {
                coCount++;
                const smallWindow = text.substring(
                    Math.max(0, idx - 50),
                    Math.min(text.length, idx + nameA.length + 50)
                );
                if (smallWindow.includes(nameB)) {
                    closeInteraction++;
                }
            }
            idx += nameA.length;
        }

        idx = 0;
        while ((idx = text.indexOf(nameB, idx)) !== -1) {
            totalB++;
            idx += nameB.length;
        }

        const cooccurrenceRatio = totalA > 0 ? coCount / totalA : 0;
        const closeRatio = coCount > 0 ? closeInteraction / coCount : 0;
        const mentionBalance = Math.min(totalA, totalB) / Math.max(totalA, totalB, 1);

        return this.clamp01(cooccurrenceRatio * 0.5 + closeRatio * 0.3 + mentionBalance * 0.2);
    }

    private extractRelationHistory(
        text: string,
        nameA: string,
        nameB: string,
        totalLength: number
    ): CharacterRelationDetail['history'] {
        const history: CharacterRelationDetail['history'] = [];
        const changeEvents = [
            { keyword: '相遇', from: '陌生', to: '认识' },
            { keyword: '认识', from: '陌生', to: '认识' },
            { keyword: '朋友', from: '认识', to: '朋友' },
            { keyword: '结拜', from: '朋友', to: '兄弟' },
            { keyword: '师父', from: '认识', to: '师徒' },
            { keyword: '徒弟', from: '认识', to: '师徒' },
            { keyword: '喜欢', from: '朋友', to: '暧昧' },
            { keyword: '告白', from: '暧昧', to: '情侣' },
            { keyword: '在一起', from: '暧昧', to: '情侣' },
            { keyword: '结为道侣', from: '暧昧', to: '情侣' },
            { keyword: '敌人', from: '认识', to: '敌对' },
            { keyword: '仇人', from: '认识', to: '敌对' },
            { keyword: '决裂', from: '朋友', to: '敌对' },
            { keyword: '反目', from: '朋友', to: '敌对' },
            { keyword: '和好', from: '敌对', to: '朋友' },
            { keyword: '和解', from: '敌对', to: '朋友' },
            { keyword: '原谅', from: '敌对', to: '朋友' }
        ];

        const contextWindow = 120;
        for (const { keyword, from, to } of changeEvents) {
            let idx = 0;
            while ((idx = text.indexOf(keyword, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + keyword.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(nameA) && context.includes(nameB)) {
                    const sentence = this.extractSentence(context, keyword);
                    history.push({
                        position: this.clamp01(idx / totalLength),
                        fromType: from,
                        toType: to,
                        event: sentence
                    });
                    break;
                }
                idx += keyword.length;
            }
        }

        return history.sort((a, b) => a.position - b.position).slice(0, 5);
    }

    private extractKeyRelationEvents(text: string, nameA: string, nameB: string, totalLength: number): string[] {
        const events: string[] = [];
        const contextWindow = 150;
        const windowSize = 300;

        let idx = 0;
        while ((idx = text.indexOf(nameA, idx)) !== -1 && events.length < 5) {
            const start = Math.max(0, idx - contextWindow);
            const end = Math.min(text.length, idx + nameA.length + contextWindow);
            const window = text.substring(start, end);
            if (window.includes(nameB)) {
                const sentence = this.extractSentence(window, nameA);
                if (sentence && sentence.length > 10 && !events.some(e => e === sentence)) {
                    events.push(sentence);
                }
            }
            idx += nameA.length;
        }

        return events.slice(0, 5);
    }

    private calculateNetworkStats(characters: Character[], relations: CharacterRelation[]): RelationshipNetworkStats {
        const n = characters.length;
        if (n <= 1) {
            return {
                protagonistCentrality: 0,
                networkDensity: 0,
                hubCharacters: [],
                averageDegree: 0
            };
        }

        const degreeMap = new Map<string, number>();
        for (const char of characters) {
            degreeMap.set(char.id, 0);
        }
        for (const rel of relations) {
            degreeMap.set(rel.fromId, (degreeMap.get(rel.fromId) || 0) + 1);
            degreeMap.set(rel.toId, (degreeMap.get(rel.toId) || 0) + 1);
        }

        const totalDegree = Array.from(degreeMap.values()).reduce((s, d) => s + d, 0);
        const averageDegree = this.round2(totalDegree / n);

        const maxPossibleEdges = n * (n - 1) / 2;
        const networkDensity = this.round2((relations.length / maxPossibleEdges) * 100);

        const protagonist = characters.find(c => c.role === 'protagonist');
        const protagDegree = protagonist ? degreeMap.get(protagonist.id) || 0 : 0;
        const protagonistCentrality = this.round2((protagDegree / (n - 1)) * 100);

        const sortedByDegree = Array.from(degreeMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        const hubCharacters = sortedByDegree
            .map(([id]) => {
                const char = characters.find(c => c.id === id);
                return char?.name || id;
            })
            .filter(Boolean);

        return {
            protagonistCentrality,
            networkDensity,
            hubCharacters,
            averageDegree
        };
    }

    async analyzeNetworkCentrality(
        text: string,
        paragraphs: string[],
        characters: Character[]
    ): Promise<CharacterNetworkResult> {
        const empty: CharacterNetworkResult = {
            nodes: [],
            edges: [],
            centrality: [],
            communities: [],
            networkDensity: 0,
            avgPathLength: 0,
            description: '角色不足，无法构建网络'
        };
        if (characters.length < 2) return empty;

        const names = characters.map(c => c.name);
        const nameSet = new Set(names);
        const adjacency = this.buildCooccurrenceAdjacency(paragraphs, names, nameSet);
        await yieldToUI();

        const n = names.length;
        const degreeCentrality = this.calculateDegreeCentrality(adjacency, names, n);
        await yieldToUI();
        const closenessCentrality = this.calculateClosenessCentrality(adjacency, names, n);
        await yieldToUI();
        const betweennessCentrality = this.calculateBetweennessCentrality(adjacency, names, n);
        await yieldToUI();
        const pagerank = this.calculatePageRank(adjacency, names, n);
        await yieldToUI();

        const pagerankEntries = names.map((name, i) => ({ name, value: pagerank[i] }));
        const sortedByPR = [...pagerankEntries].sort((a, b) => b.value - a.value);
        const topPrName = sortedByPR.length > 0 ? sortedByPR[0].name : '';

        const centrality: CharacterNetworkCentrality[] = names.map((name, i) => {
            const deg = degreeCentrality[i];
            const pr = pagerank[i];
            const role = this.inferNetworkRole(name === topPrName, deg);
            return {
                characterName: name,
                degreeCentrality: this.round4(deg),
                closenessCentrality: this.round4(closenessCentrality[i]),
                betweennessCentrality: this.round4(betweennessCentrality[i]),
                pagerank: this.round4(pr),
                role
            };
        });

        const edges: CharacterNetworkResult['edges'] = [];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const w = adjacency[i][j];
                if (w > 0) {
                    edges.push({ source: names[i], target: names[j], weight: w });
                }
            }
        }

        const communities = this.detectCommunities(adjacency, names);
        const networkDensity = this.calculateNetworkDensity(adjacency, n);
        const avgPathLength = this.calculateAvgPathLength(adjacency, names, n);

        const description = this.buildNetworkDescription(centrality, networkDensity, avgPathLength, communities);

        return {
            nodes: names,
            edges,
            centrality,
            communities,
            networkDensity: this.round4(networkDensity),
            avgPathLength: this.round2(avgPathLength),
            description
        };
    }

    private buildCooccurrenceAdjacency(
        paragraphs: string[],
        names: string[],
        nameSet: Set<string>
    ): number[][] {
        const n = names.length;
        const nameToIdx = new Map<string, number>();
        names.forEach((name, i) => nameToIdx.set(name, i));

        const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

        for (const para of paragraphs) {
            const present: number[] = [];
            for (let i = 0; i < n; i++) {
                if (para.includes(names[i])) {
                    present.push(i);
                }
            }
            if (present.length < 2) continue;
            for (let i = 0; i < present.length; i++) {
                for (let j = i + 1; j < present.length; j++) {
                    adj[present[i]][present[j]] += 1;
                    adj[present[j]][present[i]] += 1;
                }
            }
        }
        return adj;
    }

    private buildBinaryAdjacency(adjacency: number[][], n: number): number[][] {
        const bin: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j && adjacency[i][j] > 0) {
                    bin[i][j] = 1;
                }
            }
        }
        return bin;
    }

    private calculateDegreeCentrality(adjacency: number[][], _names: string[], n: number): number[] {
        const result = new Array(n).fill(0);
        if (n <= 1) return result;
        const denom = n - 1;
        for (let i = 0; i < n; i++) {
            let degree = 0;
            for (let j = 0; j < n; j++) {
                if (i !== j && adjacency[i][j] > 0) degree++;
            }
            result[i] = degree / denom;
        }
        return result;
    }

    private bfsDistances(adjacency: number[][], start: number, n: number): number[] {
        const dist = new Array(n).fill(-1);
        dist[start] = 0;
        const queue: number[] = [start];
        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            for (let v = 0; v < n; v++) {
                if (u !== v && adjacency[u][v] > 0 && dist[v] === -1) {
                    dist[v] = dist[u] + 1;
                    queue.push(v);
                }
            }
        }
        return dist;
    }

    private calculateClosenessCentrality(adjacency: number[][], _names: string[], n: number): number[] {
        const result = new Array(n).fill(0);
        if (n <= 1) return result;
        for (let i = 0; i < n; i++) {
            const dist = this.bfsDistances(adjacency, i, n);
            let sum = 0;
            let reachable = 0;
            for (let j = 0; j < n; j++) {
                if (i !== j && dist[j] > 0) {
                    sum += dist[j];
                    reachable++;
                }
            }
            if (sum > 0 && reachable > 0) {
                result[i] = (reachable) / sum;
                const normalizationFactor = reachable / (n - 1);
                result[i] *= normalizationFactor;
            } else {
                result[i] = 0;
            }
        }
        return result;
    }

    private calculateBetweennessCentrality(adjacency: number[][], _names: string[], n: number): number[] {
        const result = new Array(n).fill(0);
        if (n <= 2) return result;

        for (let s = 0; s < n; s++) {
            for (let t = 0; t < n; t++) {
                if (s === t) continue;
                const paths = this.findAllShortestPaths(adjacency, s, t, n);
                if (paths.length === 0) continue;
                const sigmaSt = paths.length;
                const onPathCount = new Array(n).fill(0);
                for (const path of paths) {
                    for (const node of path) {
                        if (node !== s && node !== t) {
                            onPathCount[node]++;
                        }
                    }
                }
                for (let v = 0; v < n; v++) {
                    if (v !== s && v !== t) {
                        result[v] += onPathCount[v] / sigmaSt;
                    }
                }
            }
        }

        const normFactor = 2 / ((n - 1) * (n - 2));
        for (let i = 0; i < n; i++) {
            result[i] *= normFactor;
            result[i] = this.clamp01(result[i]);
        }
        return result;
    }

    private findAllShortestPaths(adjacency: number[][], start: number, target: number, n: number): number[][] {
        const dist = new Array(n).fill(-1);
        dist[start] = 0;
        const queue: number[] = [start];
        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            if (u === target) break;
            for (let v = 0; v < n; v++) {
                if (u !== v && adjacency[u][v] > 0 && dist[v] === -1) {
                    dist[v] = dist[u] + 1;
                    queue.push(v);
                }
            }
        }
        if (dist[target] === -1) return [];

        const paths: number[][] = [];
        const currentPath: number[] = [start];
        const dfs = (node: number, targetDist: number) => {
            if (node === target) {
                paths.push([...currentPath]);
                return;
            }
            for (let v = 0; v < n; v++) {
                if (v === node) continue;
                if (adjacency[node][v] > 0 && dist[v] === dist[node] + 1 && dist[v] <= targetDist) {
                    currentPath.push(v);
                    dfs(v, targetDist);
                    currentPath.pop();
                }
            }
        };
        dfs(start, dist[target]);
        return paths;
    }

    private calculatePageRank(adjacency: number[][], _names: string[], n: number): number[] {
        const result = new Array(n).fill(1 / n);
        if (n <= 1) return result;

        const outDegree = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j && adjacency[i][j] > 0) outDegree[i]++;
            }
        }

        const d = 0.85;
        const maxIter = 100;
        const tolerance = 1e-6;

        for (let iter = 0; iter < maxIter; iter++) {
            const newPR = new Array(n).fill((1 - d) / n);
            for (let v = 0; v < n; v++) {
                let incoming = 0;
                for (let u = 0; u < n; u++) {
                    if (u === v) continue;
                    if (adjacency[u][v] > 0 && outDegree[u] > 0) {
                        incoming += result[u] / outDegree[u];
                    }
                }
                newPR[v] += d * incoming;
            }

            let diff = 0;
            for (let i = 0; i < n; i++) {
                diff += Math.abs(newPR[i] - result[i]);
            }
            for (let i = 0; i < n; i++) {
                result[i] = newPR[i];
            }
            if (diff < tolerance) break;
        }

        const sum = result.reduce((s, v) => s + v, 0);
        if (sum > 0) {
            for (let i = 0; i < n; i++) {
                result[i] = result[i] / sum;
            }
        }
        return result;
    }

    private inferNetworkRole(isTopPagerank: boolean, degreeCentrality: number): 'protagonist' | 'major' | 'supporting' | 'minor' {
        if (isTopPagerank) return 'protagonist';
        if (degreeCentrality > 0.5) return 'major';
        if (degreeCentrality >= 0.2) return 'supporting';
        return 'minor';
    }

    private detectCommunities(adjacency: number[][], names: string[]): Array<{ id: number; members: string[] }> {
        const n = names.length;
        const visited = new Array(n).fill(false);
        const communities: Array<{ id: number; members: string[] }> = [];
        let communityId = 0;

        for (let i = 0; i < n; i++) {
            if (visited[i]) continue;
            const members: number[] = [];
            const queue: number[] = [i];
            visited[i] = true;
            let head = 0;
            while (head < queue.length) {
                const u = queue[head++];
                members.push(u);
                for (let v = 0; v < n; v++) {
                    if (u !== v && !visited[v] && adjacency[u][v] > 0) {
                        visited[v] = true;
                        queue.push(v);
                    }
                }
            }
            communities.push({
                id: communityId++,
                members: members.map(idx => names[idx])
            });
        }
        return communities;
    }

    private calculateNetworkDensity(adjacency: number[][], n: number): number {
        if (n <= 1) return 0;
        const maxPossible = n * (n - 1) / 2;
        let actualEdges = 0;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (adjacency[i][j] > 0) actualEdges++;
            }
        }
        return actualEdges / maxPossible;
    }

    private calculateAvgPathLength(adjacency: number[][], _names: string[], n: number): number {
        if (n <= 1) return 0;
        let totalPathLength = 0;
        let pathCount = 0;
        for (let i = 0; i < n; i++) {
            const dist = this.bfsDistances(adjacency, i, n);
            for (let j = 0; j < n; j++) {
                if (i !== j && dist[j] > 0) {
                    totalPathLength += dist[j];
                    pathCount++;
                }
            }
        }
        return pathCount > 0 ? totalPathLength / pathCount : 0;
    }

    private buildNetworkDescription(
        centrality: CharacterNetworkCentrality[],
        density: number,
        avgPath: number,
        communities: Array<{ id: number; members: string[] }>
    ): string {
        if (centrality.length === 0) return '无角色网络数据';
        const sorted = [...centrality].sort((a, b) => b.pagerank - a.pagerank);
        const top = sorted[0];
        const communityCount = communities.length;
        const densityPct = (density * 100).toFixed(1);
        return `共 ${centrality.length} 个角色，${communityCount} 个社区，网络密度 ${densityPct}%，平均路径长度 ${avgPath.toFixed(2)}，核心角色：${top.characterName}（PageRank=${top.pagerank.toFixed(3)}）`;
    }

    private round4(n: number): number {
        return Math.round(n * 10000) / 10000;
    }

    async analyzeVoiceFingerprint(
        text: string,
        characters: Character[]
    ): Promise<VoiceFingerprintResult> {
        const empty: VoiceFingerprintResult = {
            characters: [],
            distinctness: 0,
            description: '无角色对话数据'
        };
        if (characters.length === 0 || !text) return empty;

        const dialoguesByChar = new Map<string, string[]>();
        for (const char of characters) {
            dialoguesByChar.set(char.name, this.extractCharacterDialogues(text, char.name));
        }
        await yieldToUI();

        const fingerprints: VoiceFingerprint[] = [];
        for (const char of characters) {
            const dialogues = dialoguesByChar.get(char.name) || [];
            fingerprints.push(this.buildVoiceFingerprint(char.name, dialogues, dialoguesByChar));
            await yieldToUI();
        }

        const distinctness = this.calculateVoiceDistinctness(fingerprints);
        const description = this.buildVoiceDescription(fingerprints, distinctness);

        return {
            characters: fingerprints,
            distinctness: this.round2(distinctness),
            description
        };
    }

    private extractCharacterDialogues(text: string, name: string): string[] {
        const dialogues: string[] = [];
        const patterns: RegExp[] = [
            new RegExp(`${this.escapeRegExp(name)}(?:${DIALOGUE_VERBS.join('|')})\\s*[“"]([^"”]+)[”"]`, 'g'),
            new RegExp(`[“"]([^"”]+)[”"]\\s*(?:，|,)?\\s*${this.escapeRegExp(name)}(?:${DIALOGUE_VERBS.join('|')})`, 'g'),
            new RegExp(`${this.escapeRegExp(name)}(?:${DIALOGUE_VERBS.join('|')})[：:]\\s*[“"]([^"”]+)[”"]`, 'g')
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const content = match[1];
                if (content && content.length > 0 && content.length < 500) {
                    dialogues.push(content);
                }
            }
        }

        const unique = Array.from(new Set(dialogues));
        return unique.slice(0, 200);
    }

    private escapeRegExp(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private buildVoiceFingerprint(
        name: string,
        dialogues: string[],
        allDialogues: Map<string, string[]>
    ): VoiceFingerprint {
        const dialogueCount = dialogues.length;
        const totalLen = dialogues.reduce((s, d) => s + d.length, 0);
        const avgDialogueLength = dialogueCount > 0 ? this.round2(totalLen / dialogueCount) : 0;
        const vocabularyRichness = this.calculateTTR(dialogues);
        const toneWords = this.detectToneWords(dialogues);
        const sentencePattern = this.analyzeSentencePattern(dialogues);
        const otherDialogues: string[] = [];
        for (const [otherName, otherDials] of allDialogues.entries()) {
            if (otherName !== name) otherDialogues.push(...otherDials);
        }
        const uniqueExpressions = this.findUniqueExpressions(dialogues, otherDialogues);
        const personalityMarkers = this.calculatePersonalityMarkers(dialogues);
        const fingerprint = this.buildFingerprintString(sentencePattern, personalityMarkers, toneWords);

        return {
            characterName: name,
            dialogueCount,
            avgDialogueLength,
            vocabularyRichness: this.round4(vocabularyRichness),
            toneWords: toneWords.slice(0, 10),
            sentencePattern,
            uniqueExpressions: uniqueExpressions.slice(0, 5),
            personalityMarkers,
            fingerprint
        };
    }

    private calculateTTR(dialogues: string[]): number {
        if (dialogues.length === 0) return 0;
        const tokens: string[] = [];
        for (const d of dialogues) {
            for (let i = 0; i < d.length - 1; i++) {
                if (isChineseChar(d[i]) && isChineseChar(d[i + 1])) {
                    tokens.push(d.substring(i, i + 2));
                }
            }
        }
        if (tokens.length === 0) return 0;
        const unique = new Set(tokens).size;
        return unique / tokens.length;
    }

    private detectToneWords(dialogues: string[]): string[] {
        const counts = new Map<string, number>();
        for (const d of dialogues) {
            for (const word of this.toneWordSet) {
                let idx = 0;
                let count = 0;
                while ((idx = d.indexOf(word, idx)) !== -1) {
                    count++;
                    idx += word.length;
                }
                if (count > 0) {
                    counts.set(word, (counts.get(word) || 0) + count);
                }
            }
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([w]) => w);
    }

    private analyzeSentencePattern(dialogues: string[]): { short: number; medium: number; long: number } {
        if (dialogues.length === 0) return { short: 0, medium: 0, long: 0 };
        const sentences: string[] = [];
        for (const d of dialogues) {
            const parts = d.split(/[。！？!?；;]/).map(s => s.trim()).filter(s => s.length > 0);
            sentences.push(...parts);
        }
        if (sentences.length === 0) return { short: 0, medium: 0, long: 0 };
        let short = 0, medium = 0, long = 0;
        for (const s of sentences) {
            if (s.length < 10) short++;
            else if (s.length <= 30) medium++;
            else long++;
        }
        const total = sentences.length;
        return {
            short: this.round4(short / total),
            medium: this.round4(medium / total),
            long: this.round4(long / total)
        };
    }

    private findUniqueExpressions(dialogues: string[], otherDialogues: string[]): string[] {
        if (dialogues.length === 0) return [];
        const otherText = otherDialogues.join('');
        const candidateCounts = new Map<string, number>();
        for (const d of dialogues) {
            for (let n = 2; n <= 4; n++) {
                for (let i = 0; i <= d.length - n; i++) {
                    const gram = d.substring(i, i + n);
                    let allChinese = true;
                    for (const ch of gram) {
                        if (!isChineseChar(ch)) {
                            allChinese = false;
                            break;
                        }
                    }
                    if (!allChinese) continue;
                    if (this.toneWordSet.has(gram)) continue;
                    if (COMMON_WORDS.has(gram)) continue;
                    candidateCounts.set(gram, (candidateCounts.get(gram) || 0) + 1);
                }
            }
        }

        const candidates = Array.from(candidateCounts.entries())
            .filter(([gram, count]) => count >= 2 && !otherText.includes(gram))
            .sort((a, b) => b[1] - a[1])
            .map(([gram]) => gram);

        const result: string[] = [];
        const seen = new Set<string>();
        for (const gram of candidates) {
            let isSub = false;
            for (const seenGram of seen) {
                if (seenGram.includes(gram) || gram.includes(seenGram)) {
                    isSub = true;
                    break;
                }
            }
            if (!isSub) {
                result.push(gram);
                seen.add(gram);
            }
            if (result.length >= 5) break;
        }
        return result;
    }

    private calculatePersonalityMarkers(dialogues: string[]): { formality: number; emotionality: number; directness: number } {
        if (dialogues.length === 0) {
            return { formality: 0, emotionality: 0, directness: 0 };
        }
        const allText = dialogues.join('');
        const totalChars = allText.length;

        let colloquialCount = 0;
        for (const word of this.colloquialWordSet) {
            let idx = 0;
            while ((idx = allText.indexOf(word, idx)) !== -1) {
                colloquialCount++;
                idx += word.length;
            }
        }
        let formalCount = 0;
        for (const word of this.formalMarkerSet) {
            let idx = 0;
            while ((idx = allText.indexOf(word, idx)) !== -1) {
                formalCount++;
                idx += word.length;
            }
        }

        let emotionCount = 0;
        for (const word of this.emotionWordSet) {
            let idx = 0;
            while ((idx = allText.indexOf(word, idx)) !== -1) {
                emotionCount++;
                idx += word.length;
            }
        }

        let toneCount = 0;
        for (const word of this.toneWordSet) {
            let idx = 0;
            while ((idx = allText.indexOf(word, idx)) !== -1) {
                toneCount++;
                idx += word.length;
            }
        }

        const totalMarkers = colloquialCount + formalCount;
        const formality = totalMarkers > 0
            ? this.clamp01(formalCount / totalMarkers)
            : 0.5;

        const emotionality = totalChars > 0
            ? this.clamp01(emotionCount / (totalChars / 10))
            : 0;

        const toneDensity = totalChars > 0 ? toneCount / totalChars : 0;
        const sentencePattern = this.analyzeSentencePattern(dialogues);
        const directness = this.clamp01(sentencePattern.short * 0.5 + (1 - Math.min(toneDensity * 10, 1)) * 0.5);

        return {
            formality: this.round4(formality),
            emotionality: this.round4(emotionality),
            directness: this.round4(directness)
        };
    }

    private buildFingerprintString(
        pattern: { short: number; medium: number; long: number },
        markers: { formality: number; emotionality: number; directness: number },
        toneWords: string[]
    ): string {
        const lengthTag = pattern.short >= 0.5 ? '简短' : (pattern.long >= 0.4 ? '冗长' : '适中');
        const formalityTag = markers.formality > 0.6 ? '正式' : (markers.formality < 0.3 ? '口语' : '中性');
        const emotionTag = markers.emotionality > 0.3 ? '情绪化' : (markers.emotionality < 0.1 ? '冷静' : '理性');
        const directTag = markers.directness > 0.6 ? '直率' : (markers.directness < 0.4 ? '委婉' : '折中');
        const toneTag = toneWords.length > 0 ? `语气词多(${toneWords.slice(0, 2).join('/')})` : '语气词少';
        return `${directTag}-${lengthTag}-${emotionTag}-${formalityTag}-${toneTag}`;
    }

    private calculateVoiceDistinctness(fingerprints: VoiceFingerprint[]): number {
        if (fingerprints.length < 2) return 0;
        const vectors = fingerprints.map(f => this.fingerprintToVector(f));
        let totalDistance = 0;
        let pairCount = 0;
        for (let i = 0; i < vectors.length; i++) {
            for (let j = i + 1; j < vectors.length; j++) {
                totalDistance += this.cosineDistance(vectors[i], vectors[j]);
                pairCount++;
            }
        }
        return pairCount > 0 ? (totalDistance / pairCount) * 100 : 0;
    }

    private fingerprintToVector(f: VoiceFingerprint): number[] {
        return [
            f.avgDialogueLength / 100,
            f.vocabularyRichness,
            f.sentencePattern.short,
            f.sentencePattern.medium,
            f.sentencePattern.long,
            f.personalityMarkers.formality,
            f.personalityMarkers.emotionality,
            f.personalityMarkers.directness,
            Math.min(f.toneWords.length / 10, 1)
        ];
    }

    private cosineDistance(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 1;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        if (denom === 0) return 1;
        const similarity = dot / denom;
        return 1 - similarity;
    }

    private buildVoiceDescription(fingerprints: VoiceFingerprint[], distinctness: number): string {
        if (fingerprints.length === 0) return '无角色声音数据';
        const withDialogue = fingerprints.filter(f => f.dialogueCount > 0);
        if (withDialogue.length === 0) return '未检测到角色对话';
        const topFingerprint = withDialogue[0];
        return `共分析 ${withDialogue.length} 个有对话的角色，区分度 ${distinctness.toFixed(1)}/100，代表声音：${topFingerprint.characterName}（${topFingerprint.fingerprint}）`;
    }

    private calculateStats(characters: Character[]): {
        totalCharacters: number;
        mainCharacterCount: number;
        avgAppearancePerCharacter: number;
    } {
        const totalCharacters = characters.length;
        const mainCharacterCount = characters.filter(c => c.role === 'protagonist').length;
        const totalAppearances = characters.reduce((sum, c) => sum + c.appearanceCount, 0);
        const avgAppearancePerCharacter = totalCharacters > 0
            ? this.round2(totalAppearances / totalCharacters)
            : 0;

        return {
            totalCharacters,
            mainCharacterCount,
            avgAppearancePerCharacter
        };
    }

    private buildFrontmatter(result: CharacterAnalysisResult): string {
        const data = {
            characters: result.characters.map(c => ({
                id: c.id,
                name: c.name,
                aliases: c.aliases,
                role: c.role,
                gender: c.gender,
                firstAppearance: c.firstAppearance,
                lastAppearance: c.lastAppearance,
                appearanceCount: c.appearanceCount,
                mentionCount: c.mentionCount,
                personality: c.personality,
                abilities: c.abilities,
                characterArc: c.characterArc,
                importance: c.importance,
                timeline: c.timeline,
                dialogueCount: c.dialogueCount,
                perspectiveCount: c.perspectiveCount,
                keyEventCount: c.keyEventCount
            })),
            mainCharacter: result.mainCharacter ? {
                id: result.mainCharacter.id,
                name: result.mainCharacter.name
            } : undefined,
            relations: result.relations.map(r => ({
                fromId: r.fromId,
                toId: r.toId,
                type: r.type,
                weight: r.weight
            })),
            relationDetails: result.relationDetails,
            networkStats: result.networkStats,
            networkCentrality: result.networkCentrality,
            voiceFingerprint: result.voiceFingerprint,
            stats: result.stats
        };
        return JSON.stringify(data, null, 2);
    }

    private buildMarkdownBody(result: CharacterAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 人设提取报告`);
        lines.push('');

        lines.push('## 人物统计');
        lines.push('');
        lines.push(`- 总人物数：**${result.stats.totalCharacters}**`);
        lines.push(`- 主角数量：**${result.stats.mainCharacterCount}**`);
        lines.push(`- 人均出场次数：**${result.stats.avgAppearancePerCharacter}**`);
        if (result.networkStats) {
            lines.push(`- 关系网密度：**${result.networkStats.networkDensity}%**`);
            lines.push(`- 主角中心度：**${result.networkStats.protagonistCentrality}%**`);
            lines.push(`- 平均关系数：**${result.networkStats.averageDegree}**`);
            if (result.networkStats.hubCharacters.length > 0) {
                lines.push(`- 关键枢纽：**${result.networkStats.hubCharacters.join('、')}**`);
            }
        }
        lines.push('');

        lines.push('## 角色重要度排行');
        lines.push('');
        if (result.characters.length === 0) {
            lines.push('暂未检测到人物');
        } else {
            const sortedByImportance = [...result.characters]
                .sort((a, b) => (b.importance?.totalScore ?? 0) - (a.importance?.totalScore ?? 0));
            lines.push('| 排名 | 姓名 | 分级 | 综合得分 | 出场占比 | 对话占比 | 剧情推动 | 关系中心 | 视角占比 |');
            lines.push('|------|------|------|----------|----------|----------|----------|----------|----------|');
            sortedByImportance.slice(0, 10).forEach((c, idx) => {
                lines.push(`| ${idx + 1} | ${c.name} | ${this.tierLabel(c.importance?.tier)} | ${c.importance?.totalScore ?? 0} | ${c.importance?.appearanceFrequency ?? 0}% | ${c.importance?.dialogueRatio ?? 0}% | ${c.importance?.plotDrivingScore ?? 0}% | ${c.importance?.relationshipCentrality ?? 0}% | ${c.importance?.perspectiveRatio ?? 0}% |`);
            });
        }
        lines.push('');

        lines.push('## 主要人物');
        lines.push('');
        if (result.characters.length === 0) {
            lines.push('暂未检测到人物');
        } else {
            const mainChars = result.characters.filter(c =>
                c.role === 'protagonist' || c.role === 'deuteragonist' || c.importance?.tier === 'core_supporting'
            );
            for (const char of mainChars) {
                lines.push(`### ${char.name}`);
                lines.push('');
                lines.push(`- **角色定位**：${this.roleLabel(char.role)}`);
                lines.push(`- **角色分级**：${this.tierLabel(char.importance?.tier)}`);
                lines.push(`- **综合重要度**：${char.importance?.totalScore ?? 0}分`);
                lines.push(`- **性别**：${this.genderLabel(char.gender)}`);
                if (char.aliases.length > 0) {
                    lines.push(`- **别名**：${char.aliases.join('、')}`);
                }
                lines.push(`- **首次出场**：${(char.firstAppearance * 100).toFixed(1)}%`);
                lines.push(`- **最后出场**：${(char.lastAppearance * 100).toFixed(1)}%`);
                lines.push(`- **出场次数**：${char.appearanceCount}`);
                lines.push(`- **提及次数**：${char.mentionCount}`);
                lines.push(`- **对话次数**：${char.dialogueCount ?? 0}`);
                lines.push(`- **视角次数**：${char.perspectiveCount ?? 0}`);
                if (char.appearance) {
                    lines.push(`- **外貌**：${char.appearance}`);
                }
                if (char.personality.length > 0) {
                    lines.push(`- **性格**：${char.personality.join('、')}`);
                }
                if (char.abilities.length > 0) {
                    lines.push(`- **能力**：${char.abilities.join('、')}`);
                }
                if (char.background) {
                    lines.push(`- **背景**：${char.background}`);
                }

                if (char.characterArc) {
                    lines.push(`- **角色弧光**：`);
                    lines.push(`  - 转变类型：${this.transformationLabel(char.characterArc.transformationType)}`);
                    lines.push(`  - 弧光完整度：${char.characterArc.completeness}分`);
                    if (char.characterArc.initialState.goals.length > 0) {
                        lines.push(`  - 初始目标：${char.characterArc.initialState.goals[0]}`);
                    }
                }

                if (char.growthStages.length > 0) {
                    lines.push(`- **成长阶段**：`);
                    for (const stage of char.growthStages.slice(0, 5)) {
                        lines.push(`  - ${(stage.position * 100).toFixed(1)}%：${stage.description}`);
                    }
                }

                if (char.characterArc?.growthNodes && char.characterArc.growthNodes.length > 0) {
                    lines.push(`- **成长节点**：`);
                    for (const node of char.characterArc.growthNodes.slice(0, 5)) {
                        const trigger = node.trigger ? `（触发：${node.trigger}）` : '';
                        lines.push(`  - ${(node.position * 100).toFixed(1)}% [${node.changeType}]${trigger}：${node.event.length > 50 ? node.event.substring(0, 50) + '...' : node.event}`);
                    }
                }

                if (char.relationships.length > 0) {
                    lines.push(`- **人物关系**：`);
                    for (const rel of char.relationships.slice(0, 5)) {
                        lines.push(`  - ${rel.targetName}（${rel.type}）`);
                    }
                }

                if (char.timeline && char.timeline.length > 0) {
                    lines.push(`- **成长时间线**：`);
                    for (const event of char.timeline.slice(0, 8)) {
                        const icon = this.timelineEventIcon(event.type);
                        lines.push(`  - ${(event.position * 100).toFixed(1)}% ${icon} ${event.title}`);
                    }
                }
                lines.push('');
            }
        }

        lines.push('## 全部人物列表');
        lines.push('');
        if (result.characters.length === 0) {
            lines.push('暂未检测到人物');
        } else {
            lines.push('| 姓名 | 定位 | 分级 | 出场次数 | 提及次数 | 首次出场 | 最后出场 |');
            lines.push('|------|------|------|----------|----------|----------|----------|');
            for (const c of result.characters) {
                lines.push(`| ${c.name} | ${this.roleLabel(c.role)} | ${this.tierLabel(c.importance?.tier)} | ${c.appearanceCount} | ${c.mentionCount} | ${(c.firstAppearance * 100).toFixed(1)}% | ${(c.lastAppearance * 100).toFixed(1)}% |`);
            }
        }
        lines.push('');

        lines.push('## 人物关系网络');
        lines.push('');
        if (result.relations.length === 0) {
            lines.push('暂未检测到明显人物关系');
        } else {
            lines.push('| 人物A | 人物B | 关系类型 | 关系强度 |');
            lines.push('|-------|-------|----------|----------|');
            for (const r of result.relations) {
                const fromChar = result.characters.find(c => c.id === r.fromId);
                const toChar = result.characters.find(c => c.id === r.toId);
                lines.push(`| ${fromChar?.name || '-'} | ${toChar?.name || '-'} | ${r.type} | ${(r.weight * 100).toFixed(0)}% |`);
            }
        }
        lines.push('');

        if (result.relationDetails && result.relationDetails.length > 0) {
            lines.push('## 关系深度分析');
            lines.push('');
            for (const rd of result.relationDetails.slice(0, 10)) {
                const fromChar = result.characters.find(c => c.id === rd.fromId);
                const toChar = result.characters.find(c => c.id === rd.toId);
                lines.push(`### ${fromChar?.name || rd.fromId} ↔ ${toChar?.name || rd.toId}`);
                lines.push('');
                lines.push(`- **关系类型**：${rd.type}`);
                lines.push(`- **关系强度**：${rd.strength}%`);
                if (rd.history && rd.history.length > 0) {
                    lines.push(`- **关系变化**：`);
                    for (const h of rd.history) {
                        lines.push(`  - ${(h.position * 100).toFixed(1)}%：${h.fromType} → ${h.toType}`);
                    }
                }
                if (rd.keyEvents && rd.keyEvents.length > 0) {
                    lines.push(`- **关键事件**：`);
                    for (const e of rd.keyEvents) {
                        lines.push(`  - ${e.length > 60 ? e.substring(0, 60) + '...' : e}`);
                    }
                }
                lines.push('');
            }
        }

        if (result.networkCentrality) {
            lines.push('## 角色网络分析');
            lines.push('');
            const nc = result.networkCentrality;
            lines.push(`- **网络密度**：${(nc.networkDensity * 100).toFixed(1)}%`);
            lines.push(`- **平均路径长度**：${nc.avgPathLength}`);
            lines.push(`- **社区数量**：${nc.communities.length}`);
            lines.push(`- **概览**：${nc.description}`);
            lines.push('');
            if (nc.centrality.length > 0) {
                lines.push('### 中心性排名');
                lines.push('');
                lines.push('| 角色 | 角色定位 | 度中心性 | 接近中心性 | 介数中心性 | PageRank |');
                lines.push('|------|----------|----------|------------|------------|----------|');
                const sortedByPR = [...nc.centrality].sort((a, b) => b.pagerank - a.pagerank);
                for (const c of sortedByPR) {
                    lines.push(`| ${c.characterName} | ${this.networkRoleLabel(c.role)} | ${(c.degreeCentrality * 100).toFixed(1)}% | ${(c.closenessCentrality * 100).toFixed(1)}% | ${(c.betweennessCentrality * 100).toFixed(1)}% | ${c.pagerank.toFixed(4)} |`);
                }
                lines.push('');
            }
            if (nc.communities.length > 0) {
                lines.push('### 社区划分');
                lines.push('');
                for (const comm of nc.communities) {
                    lines.push(`- **社区 ${comm.id + 1}**（${comm.members.length}人）：${comm.members.join('、')}`);
                }
                lines.push('');
            }
            if (nc.edges.length > 0) {
                lines.push('### 共现边（权重 Top 10）');
                lines.push('');
                lines.push('| 角色 A | 角色 B | 共现次数 |');
                lines.push('|--------|--------|----------|');
                const sortedEdges = [...nc.edges].sort((a, b) => b.weight - a.weight).slice(0, 10);
                for (const e of sortedEdges) {
                    lines.push(`| ${e.source} | ${e.target} | ${e.weight} |`);
                }
                lines.push('');
            }
        }

        if (result.voiceFingerprint) {
            lines.push('## 角色声音指纹');
            lines.push('');
            const vf = result.voiceFingerprint;
            lines.push(`- **区分度**：${vf.distinctness}/100`);
            lines.push(`- **概览**：${vf.description}`);
            lines.push('');
            const withDialogue = vf.characters.filter(f => f.dialogueCount > 0);
            if (withDialogue.length === 0) {
                lines.push('暂未检测到角色对话');
                lines.push('');
            } else {
                for (const f of withDialogue) {
                    lines.push(`### ${f.characterName}`);
                    lines.push('');
                    lines.push(`- **指纹**：\`${f.fingerprint}\``);
                    lines.push(`- **对话次数**：${f.dialogueCount}`);
                    lines.push(`- **平均对话长度**：${f.avgDialogueLength} 字`);
                    lines.push(`- **词汇丰富度（TTR）**：${(f.vocabularyRichness * 100).toFixed(1)}%`);
                    if (f.toneWords.length > 0) {
                        lines.push(`- **语气词**：${f.toneWords.join('、')}`);
                    }
                    lines.push(`- **句式分布**：短句 ${(f.sentencePattern.short * 100).toFixed(0)}% / 中句 ${(f.sentencePattern.medium * 100).toFixed(0)}% / 长句 ${(f.sentencePattern.long * 100).toFixed(0)}%`);
                    lines.push(`- **性格标记**：正式度 ${(f.personalityMarkers.formality * 100).toFixed(0)}% / 情感度 ${(f.personalityMarkers.emotionality * 100).toFixed(0)}% / 直接度 ${(f.personalityMarkers.directness * 100).toFixed(0)}%`);
                    if (f.uniqueExpressions.length > 0) {
                        lines.push(`- **独特表达**：${f.uniqueExpressions.join('、')}`);
                    }
                    lines.push('');
                }
            }
        }

        return lines.join('\n');
    }

    private networkRoleLabel(role: 'protagonist' | 'major' | 'supporting' | 'minor'): string {
        const labels: Record<string, string> = {
            protagonist: '主角',
            major: '主要',
            supporting: '配角',
            minor: '边缘'
        };
        return labels[role] || role;
    }

    private tierLabel(tier?: CharacterImportance['tier']): string {
        const labels: Record<string, string> = {
            protagonist: '主角',
            core_supporting: '核心配角',
            important_supporting: '重要配角',
            minor_supporting: '次要配角',
            extra: '路人角色'
        };
        return labels[tier || 'extra'] || '未知';
    }

    private transformationLabel(type: CharacterArc['transformationType']): string {
        const labels: Record<CharacterArc['transformationType'], string> = {
            growth: '成长型',
            fall: '堕落型',
            awakening: '觉醒型',
            darkening: '黑化型',
            return: '回归型',
            stable: '稳定型'
        };
        return labels[type] || type;
    }

    private timelineEventIcon(type: CharacterTimelineEvent['type']): string {
        const icons: Record<CharacterTimelineEvent['type'], string> = {
            appearance: '👤',
            growth: '📈',
            relationship: '💞',
            plot: '📌',
            turning_point: '⚡'
        };
        return icons[type] || '•';
    }

    private roleLabel(role: Character['role']): string {
        const labels: Record<Character['role'], string> = {
            protagonist: '主角',
            deuteragonist: '主要配角',
            antagonist: '反派',
            supporting: '配角',
            minor: '小角色'
        };
        return labels[role] || role;
    }

    private genderLabel(gender?: 'male' | 'female' | 'unknown'): string {
        const labels: Record<string, string> = {
            male: '男',
            female: '女',
            unknown: '未知'
        };
        return labels[gender || 'unknown'] || '未知';
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    private async enhanceCharacterRelations(
        text: string,
        result: CharacterAnalysisResult
    ): Promise<CharacterAnalysisResult> {
        if (!this.vectorEnhancer || result.relations.length === 0) return result;

        const RELATION_TYPE_REFERENCES: { type: string; description: string }[] = [
            { type: '父亲', description: '父子关系 父女关系 父亲和孩子' },
            { type: '母亲', description: '母子关系 母女关系 母亲和孩子' },
            { type: '师父', description: '师徒关系 师父和徒弟 传授技艺' },
            { type: '徒弟', description: '徒弟和师父 学习技艺的人' },
            { type: '师兄', description: '同门师兄弟 师姐师妹 同门关系' },
            { type: '朋友', description: '朋友关系 好友 知己 志同道合' },
            { type: '敌人', description: '敌对关系 仇人 对手 互相敌视' },
            { type: '恋人', description: '恋人关系 情侣 爱人 喜欢的人' },
            { type: '亲人', description: '亲属关系 家人 亲戚 血缘关系' },
            { type: '君臣', description: '君臣关系 君主和臣子 上下级' },
            { type: '兄弟', description: '兄弟关系 兄弟情深 结拜兄弟' },
            { type: '姐妹', description: '姐妹关系 姐妹情深 结拜姐妹' },
            { type: '夫妻', description: '夫妻关系 丈夫和妻子 配偶' },
            { type: '对手', description: '竞争关系 竞争对手 棋逢对手' },
            { type: '恩人', description: '施恩与报恩 救命恩人 提携之恩' },
            { type: '仇人', description: '仇恨关系 不共戴天 血海深仇' }
        ];

        const relationContexts: string[] = [];
        const relationIndices: number[] = [];

        for (let i = 0; i < result.relations.length; i++) {
            const rel = result.relations[i];
            const charA = result.characters.find(c => c.id === rel.fromId);
            const charB = result.characters.find(c => c.id === rel.toId);
            if (!charA || !charB) continue;

            const contextWindow = 200;
            let contextFound = '';
            let idx = 0;
            while ((idx = text.indexOf(charA.name, idx)) !== -1) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + charA.name.length + contextWindow);
                const context = text.substring(start, end);
                if (context.includes(charB.name)) {
                    contextFound = context;
                    break;
                }
                idx += charA.name.length;
            }

            if (contextFound) {
                relationContexts.push(contextFound);
                relationIndices.push(i);
            }
        }

        if (relationContexts.length === 0) return result;

        const refTexts = RELATION_TYPE_REFERENCES.map(r => r.description);
        const allTexts = [...refTexts, ...relationContexts];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const refVectors = allVectors.slice(0, refTexts.length);
        const contextVectors = allVectors.slice(refTexts.length);

        const newRelations = [...result.relations];
        const newCharacters = result.characters.map(c => ({ ...c, relationships: [...c.relationships] }));

        for (let i = 0; i < relationContexts.length; i++) {
            const globalIdx = relationIndices[i];
            const contextVec = contextVectors[i];

            let bestType = newRelations[globalIdx].type;
            let bestScore = 0;

            for (let j = 0; j < RELATION_TYPE_REFERENCES.length; j++) {
                const score = this.vectorEnhancer!.cosineSimilarity(contextVec, refVectors[j]);
                if (score > bestScore && score > this.vectorThreshold) {
                    bestScore = score;
                    bestType = RELATION_TYPE_REFERENCES[j].type;
                }
            }

            if (bestScore > this.vectorThreshold && bestType !== newRelations[globalIdx].type) {
                newRelations[globalIdx].type = bestType;
                newRelations[globalIdx].weight = this.clamp01(newRelations[globalIdx].weight + bestScore * 0.2);

                const fromChar = newCharacters.find(c => c.id === newRelations[globalIdx].fromId);
                const toChar = newCharacters.find(c => c.id === newRelations[globalIdx].toId);

                if (fromChar) {
                    const relIdx = fromChar.relationships.findIndex(r => r.targetId === newRelations[globalIdx].toId);
                    if (relIdx !== -1) {
                        fromChar.relationships[relIdx].type = bestType;
                    }
                }
                if (toChar) {
                    const relIdx = toChar.relationships.findIndex(r => r.targetId === newRelations[globalIdx].fromId);
                    if (relIdx !== -1) {
                        toChar.relationships[relIdx].type = bestType;
                    }
                }
            }
        }

        return {
            ...result,
            characters: newCharacters,
            relations: newRelations
        };
    }

    private buildPersonalityTagDescriptions(tags: string[]): Array<{ tag: string; description: string }> {
        return tags.map(tag => ({
            tag,
            description: `${tag} 性格特点 人物性格 ${tag}的人`
        }));
    }

    private buildAbilityTypeDescriptions(types: string[]): Array<{ type: string; description: string }> {
        return types.map(type => ({
            type,
            description: `${type} 能力类型 修炼 ${type}能力 精通${type}`
        }));
    }

    private async enhanceCharacterFeatures(
        text: string,
        result: CharacterAnalysisResult
    ): Promise<CharacterAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const personalityTags = this.genreConfig.personalityTags;
        const abilityTypes = this.genreConfig.abilityTypes;
        const backgroundTypes = this.genreConfig.backgroundTypes;

        const PERSONALITY_TRAITS = this.buildPersonalityTagDescriptions(personalityTags);
        const ABILITY_CATEGORIES = this.buildAbilityTypeDescriptions(abilityTypes);
        const BACKGROUND_TYPES = backgroundTypes.map(bg => ({
            type: bg,
            description: `${bg} 背景出身 来自${bg} ${bg}出身`
        }));

        const newCharacters = result.characters.map(char => ({ ...char }));

        const personalityRefTexts = PERSONALITY_TRAITS.map(p => p.description);
        const abilityRefTexts = ABILITY_CATEGORIES.map(a => a.description);
        const backgroundRefTexts = BACKGROUND_TYPES.map(b => b.description);

        const [personalityVectors, abilityVectors, backgroundVectors] = await Promise.all([
            this.vectorEnhancer.embedTexts(personalityRefTexts),
            this.vectorEnhancer.embedTexts(abilityRefTexts),
            this.vectorEnhancer.embedTexts(backgroundRefTexts)
        ]);
        await yieldToUI();

        // 先收集所有角色的上下文文本，再批量向量化
        const charContexts: Array<{ char: typeof newCharacters[0]; allContextText: string }> = [];
        for (const char of newCharacters) {
            const contextWindow = 150;
            const contexts: string[] = [];
            let idx = 0;
            while ((idx = text.indexOf(char.name, idx)) !== -1 && contexts.length < 10) {
                const start = Math.max(0, idx - contextWindow);
                const end = Math.min(text.length, idx + char.name.length + contextWindow);
                contexts.push(text.substring(start, end));
                idx += char.name.length;
            }

            if (contexts.length === 0) continue;
            charContexts.push({ char, allContextText: contexts.join(' ') });
        }

        if (charContexts.length === 0) {
            return { ...result, characters: newCharacters };
        }

        // 批量向量化所有角色上下文
        const contextVectors = await this.vectorEnhancer.embedTexts(
            charContexts.map(c => c.allContextText)
        );

        for (let ci = 0; ci < charContexts.length; ci++) {
            const char = charContexts[ci].char;
            const contextVector = contextVectors[ci];

            const personalityScores: Array<{ tag: string; score: number }> = [];
            for (let i = 0; i < PERSONALITY_TRAITS.length; i++) {
                const score = this.vectorEnhancer.cosineSimilarity(contextVector, personalityVectors[i]);
                if (score > this.vectorThreshold) {
                    personalityScores.push({ tag: PERSONALITY_TRAITS[i].tag, score });
                }
            }
            personalityScores.sort((a, b) => b.score - a.score);
            const topPersonality = personalityScores.slice(0, 8).map(p => p.tag);

            const mergedPersonality = [...new Set([...char.personality.filter(t => personalityTags.includes(t)), ...topPersonality])];
            char.personality = mergedPersonality.slice(0, 8);

            const abilityScores: Array<{ type: string; score: number }> = [];
            for (let i = 0; i < ABILITY_CATEGORIES.length; i++) {
                const score = this.vectorEnhancer.cosineSimilarity(contextVector, abilityVectors[i]);
                if (score > this.vectorThreshold) {
                    abilityScores.push({ type: ABILITY_CATEGORIES[i].type, score });
                }
            }
            abilityScores.sort((a, b) => b.score - a.score);
            const topAbilities = abilityScores.slice(0, 8).map(a => a.type);

            const mergedAbilities = [...new Set([...char.abilities.filter(a => abilityTypes.includes(a)), ...topAbilities])];
            char.abilities = mergedAbilities.slice(0, 8);

            if (!char.background) {
                let bestType = '';
                let bestScore = 0;

                for (let i = 0; i < BACKGROUND_TYPES.length; i++) {
                    const score = this.vectorEnhancer.cosineSimilarity(contextVector, backgroundVectors[i]);
                    if (score > bestScore && score > this.vectorThreshold) {
                        bestScore = score;
                        bestType = BACKGROUND_TYPES[i].type;
                    }
                }

                if (bestType) {
                    char.background = `${bestType}（语义识别）`;
                }
            }
        }

        return {
            ...result,
            characters: newCharacters
        };
    }

    private async enhanceGrowthStages(
        text: string,
        result: CharacterAnalysisResult
    ): Promise<CharacterAnalysisResult> {
        if (!this.vectorEnhancer) return result;

        const GROWTH_STAGE_REFERENCES: { stage: string; description: string }[] = [
            { stage: '初出茅庐', description: '刚刚出道 初入江湖 稚嫩青涩 经验不足' },
            { stage: '崭露头角', description: '小试牛刀 初露锋芒 开始出名 小有名气' },
            { stage: '成长历练', description: '历经磨难 不断成长 积累经验 逐步变强' },
            { stage: '实力大增', description: '实力暴涨 修为大进 突破瓶颈 实力飞跃' },
            { stage: '独当一面', description: '独挑大梁 独当一面 能够自立 独步天下' },
            { stage: '巅峰对决', description: '巅峰之战 最强对决 生死较量 终极一战' },
            { stage: '功成名就', description: '功成名就 名满天下 成就伟业 达到巅峰' }
        ];

        const newCharacters = result.characters.map(char => ({
            ...char,
            growthStages: char.growthStages.map(s => ({ ...s }))
        }));

        for (const char of newCharacters) {
            if (char.growthStages.length === 0) continue;

            const stageExcerpts = char.growthStages.map(s => s.description);
            const refTexts = GROWTH_STAGE_REFERENCES.map(g => g.description);
            const allTexts = [...refTexts, ...stageExcerpts];
            const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

            const refVectors = allVectors.slice(0, refTexts.length);
            const stageVectors = allVectors.slice(refTexts.length);

            for (let i = 0; i < char.growthStages.length; i++) {
                const stageVec = stageVectors[i];
                if (!stageVec) continue;

                let bestStage = '';
                let bestScore = 0;

                for (let j = 0; j < GROWTH_STAGE_REFERENCES.length; j++) {
                    const score = this.vectorEnhancer.cosineSimilarity(stageVec, refVectors[j]);
                    if (score > bestScore && score > this.vectorThreshold) {
                        bestScore = score;
                        bestStage = GROWTH_STAGE_REFERENCES[j].stage;
                    }
                }

                if (bestStage) {
                    char.growthStages[i].description = `${bestStage}：${char.growthStages[i].description}`;
                }
            }
        }

        return {
            ...result,
            characters: newCharacters
        };
    }

    private async enhanceCharacterRoles(
        text: string,
        result: CharacterAnalysisResult
    ): Promise<CharacterAnalysisResult> {
        if (!this.vectorEnhancer || result.characters.length === 0) return result;

        const ROLE_REFERENCES: { role: Character['role']; description: string }[] = [
            { role: 'protagonist', description: '主角 主人公 故事核心 第一主角' },
            { role: 'deuteragonist', description: '主要配角 重要配角 第二主角' },
            { role: 'antagonist', description: '反派 敌人 对立面 邪恶角色 仇敌 对手' },
            { role: 'supporting', description: '配角 辅助角色 次要角色' },
            { role: 'minor', description: '小角色 龙套 出场很少' }
        ];

        const characterDescriptions: string[] = [];

        for (const char of result.characters) {
            const parts: string[] = [];
            parts.push(`姓名：${char.name}`);
            if (char.personality.length > 0) {
                parts.push(`性格：${char.personality.join('、')}`);
            }
            if (char.abilities.length > 0) {
                parts.push(`能力：${char.abilities.join('、')}`);
            }
            if (char.background) {
                parts.push(`背景：${char.background}`);
            }
            if (char.relationships.length > 0) {
                parts.push(`关系：${char.relationships.map(r => `${r.targetName}(${r.type})`).join('、')}`);
            }
            parts.push(`出场次数：${char.appearanceCount}`);
            parts.push(`提及次数：${char.mentionCount}`);
            characterDescriptions.push(parts.join('；'));
        }

        const refTexts = ROLE_REFERENCES.map(r => r.description);
        const allTexts = [...refTexts, ...characterDescriptions];
        const allVectors = await this.vectorEnhancer.embedTexts(allTexts);

        const refVectors = allVectors.slice(0, refTexts.length);
        const charVectors = allVectors.slice(refTexts.length);

        const mainChar = result.mainCharacter;
        const mainName = mainChar?.name || '';

        const newCharacters = result.characters.map((char, idx) => {
            const charVec = charVectors[idx];
            if (!charVec) return char;

            let bestRole = char.role;
            let bestScore = 0;

            for (let j = 0; j < ROLE_REFERENCES.length; j++) {
                const score = this.vectorEnhancer!.cosineSimilarity(charVec, refVectors[j]);
                if (score > bestScore) {
                    bestScore = score;
                    bestRole = ROLE_REFERENCES[j].role;
                }
            }

            if (mainName && char.name !== mainName) {
                const isAntagonist = this.hasNegativeRelationWithMain(text, char.name, mainName);
                if (isAntagonist) {
                    bestRole = 'antagonist';
                }
            }

            return { ...char, role: bestRole };
        });

        const protagonist = this.determineMainCharacter(newCharacters, text);
        if (protagonist) {
            const protIdx = newCharacters.findIndex(c => c.id === protagonist.id);
            if (protIdx !== -1) {
                newCharacters[protIdx] = { ...newCharacters[protIdx], role: 'protagonist' };
            }
        }

        newCharacters.sort((a, b) => {
            const roleOrder: Record<Character['role'], number> = {
                protagonist: 0,
                deuteragonist: 1,
                antagonist: 2,
                supporting: 3,
                minor: 4
            };
            const roleDiff = roleOrder[a.role] - roleOrder[b.role];
            if (roleDiff !== 0) return roleDiff;
            return b.mentionCount - a.mentionCount;
        });

        const mainCharacter = newCharacters.find(c => c.role === 'protagonist') || newCharacters[0];

        return {
            ...result,
            characters: newCharacters,
            mainCharacter
        };
    }

    calculateQualityScore(result: CharacterAnalysisResult): QualityScore {
        const characterCountScore = this.clamp01(result.characters.length / 10) * 100;

        let personalityQuality = 0;
        let abilityQuality = 0;
        const mainChars = result.characters.filter(c =>
            c.role === 'protagonist' || c.role === 'deuteragonist'
        );

        if (mainChars.length > 0) {
            for (const char of mainChars) {
                const personalityInGenre = char.personality.filter(t =>
                    this.genreConfig.personalityTags.includes(t)
                ).length;
                personalityQuality += this.clamp01(personalityInGenre / 5) * 100;

                const abilityInGenre = char.abilities.filter(a =>
                    this.genreConfig.abilityTypes.includes(a)
                ).length;
                abilityQuality += this.clamp01(abilityInGenre / 5) * 100;
            }
            personalityQuality /= mainChars.length;
            abilityQuality /= mainChars.length;
        }

        let mainCharacterConfidence = 0;
        if (result.mainCharacter && result.characters.length > 1) {
            const mainMentionRatio = result.mainCharacter.mentionCount /
                Math.max(result.characters[1]?.mentionCount || 1, 1);
            mainCharacterConfidence = this.clamp01(mainMentionRatio / 3) * 100;
        } else if (result.mainCharacter) {
            mainCharacterConfidence = 100;
        }

        const roleTypes = new Set(result.characters.map(c => c.role));
        const roleDistributionScore = this.clamp01(roleTypes.size / 4) * 100;

        const totalScore = Math.round(
            characterCountScore * 0.2 +
            personalityQuality * 0.25 +
            abilityQuality * 0.25 +
            mainCharacterConfidence * 0.2 +
            roleDistributionScore * 0.1
        );

        return {
            totalScore,
            characterCountScore: Math.round(characterCountScore),
            personalityQualityScore: Math.round(personalityQuality),
            abilityQualityScore: Math.round(abilityQuality),
            mainCharacterConfidence: Math.round(mainCharacterConfidence),
            roleDistributionScore: Math.round(roleDistributionScore)
        };
    }
}
