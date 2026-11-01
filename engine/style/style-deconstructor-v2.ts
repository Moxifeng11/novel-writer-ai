/**
 * style-deconstructor-v2.ts — 文风风格拆解器 V2（12 维）
 *
 * 设计原则：
 * - V1 完全保留不动（向后兼容）
 * - V2 内部实例化 V1，复用其分析结果作为基础
 * - V2 补充 5 个新维度 + 升级 7 个维度的精细统计
 * - 纯统计计算，不依赖 AI API
 * - 每个维度生成 50-100 字自然语言描述 + 2-3 段代表性示例
 *
 * 12 维对应关系：
 * 1. rhythm          (节奏)     ← V1 sentenceRhythm + 升级
 * 2. sentencePattern (句式)     ← 新增
 * 3. wordChoice      (用词)     ← V1 wordPreference + 升级
 * 4. rhetoric        (修辞)     ← V1 rhetoric + 升级
 * 5. perspective     (视角)     ← V1 narrativeStyle + 升级
 * 6. emotion         (情绪)     ← 新增
 * 7. tension         (张力)     ← 新增
 * 8. infoDensity     (信息量)   ← 新增
 * 9. dialogue        (对话)     ← V1 dialogueStyle + 升级
 * 10. description    (描写)     ← 新增
 * 11. narration      (叙事)     ← V1 paragraphStructure + 升级
 * 12. languageTexture(语言质感) ← V1 overallStyle + 升级
 *
 * 性能：12 维拆解不超过 V1 的 1.5 倍耗时
 */

import { StyleDeconstructor, type StyleAnalysisResult } from '../deconstructors/style-deconstructor';
import { isChineseChar } from '../../shared/text-utils';
import type { VectorEnhancer } from '../vector-enhancer';
import type {
    StyleFingerprintFeaturesV2,
    RhythmStats,
    SentencePatternStats,
    WordChoiceStats,
    RhetoricStatsV2,
    PerspectiveStats,
    EmotionStats,
    TensionStats,
    InfoDensityStats,
    DialogueStatsV2,
    DescriptionStats,
    NarrationStats,
    LanguageTextureStats,
} from './style-dimensions-v2';

// ============================================================
// V2 结果接口
// ============================================================

export interface StyleAnalysisResultV2 {
    /** V2 12 维特征 */
    features: StyleFingerprintFeaturesV2;
    /** 基础统计 */
    stats: {
        totalChars: number;
        totalSentences: number;
        totalParagraphs: number;
    };
    /** V1 兼容结果（用于向后兼容，调用方可直接使用 V1 字段） */
    v1Result: StyleAnalysisResult;
}

// ============================================================
// 词表定义
// ============================================================

/** 正向情绪词（约 80 个） */
const POSITIVE_EMOTION_WORDS = [
    '开心', '快乐', '高兴', '喜悦', '欢喜', '欣喜', '欣慰', '满意', '幸福', '甜蜜',
    '激动', '兴奋', '振奋', '雀跃', '欢欣', '愉悦', '舒畅', '畅快', '痛快', '舒心',
    '安心', '放心', '踏实', '宁静', '平静', '安详', '祥和', '温馨', '温暖', '柔和',
    '希望', '期待', '向往', '憧憬', '渴望', '热爱', '钟爱', '喜爱', '喜欢', '钟意',
    '感激', '感恩', '感动', '感谢', '谢意', '敬佩', '敬仰', '尊敬', '崇拜', '仰慕',
    '骄傲', '自豪', '荣耀', '光荣', '辉煌', '胜利', '成功', '成就', '收获', '满足',
    '美丽', '美好', '完美', '精彩', '出色', '优秀', '卓越', '杰出', '非凡', '非凡',
    '灿烂', '辉煌', '光明', '明亮', '明朗', '晴朗', '明媚', '绚烂', '绚丽', '瑰丽',
];

/** 负向情绪词（约 80 个） */
const NEGATIVE_EMOTION_WORDS = [
    '悲伤', '伤心', '难过', '痛苦', '悲痛', '哀伤', '哀愁', '哀痛', '悲恸', '悲切',
    '哭泣', '流泪', '落泪', '啜泣', '抽噎', '哽咽', '呜咽', '哀号', '悲鸣', '悲泣',
    '愤怒', '生气', '恼怒', '恼火', '愤恨', '愤慨', '愤懑', '愤愤', '怒火', '怒气',
    '暴怒', '狂怒', '震怒', '怒吼', '怒斥', '怒视', '怒目', '怒冲冲', '气冲冲', '怒发冲冠',
    '恐惧', '害怕', '畏惧', '惧怕', '惊恐', '惶恐', '惊慌', '慌张', '慌乱', '惊慌失措',
    '焦虑', '焦急', '焦躁', '烦躁', '急躁', '不安', '忐忑', '忧虑', '忧愁', '忧愁',
    '绝望', '失望', '沮丧', '颓丧', '颓废', '消沉', '低落', '失落', '空虚', '孤独',
    '寂寞', '凄凉', '凄惨', '悲惨', '凄冷', '凄清', '凄寂', '悲凉', '苍凉', '荒凉',
];

/** 高强度情绪词（标记用，用于情绪强度分布计算） */
const HIGH_INTENSITY_EMOTION_WORDS = [
    '狂喜', '暴怒', '狂怒', '震怒', '惊恐', '绝望', '悲痛', '悲恸', '哀号', '怒吼',
    '崩溃', '崩溃', '疯狂', '癫狂', '痴狂', '激愤', '亢奋', '澎湃', '汹涌', '澎湃',
];

/** 中强度情绪词 */
const MEDIUM_INTENSITY_EMOTION_WORDS = [
    '激动', '兴奋', '愤怒', '恐惧', '焦虑', '忧伤', '悲伤', '愤怒', '生气', '高兴',
    '失望', '沮丧', '忐忑', '不安', '焦急', '期待', '渴望', '热爱', '憎恨', '厌恶',
];

/** 悬念/转折词 */
const SUSPENSE_WORDS = [
    '突然', '忽然', '猛然', '骤然', '陡然', '瞬间', '霎时', '刹那', '顷刻', '顿然',
    '然而', '但是', '可是', '不过', '只是', '倒是', '却', '但', '可', '只是',
    '竟然', '居然', '果不其然', '果真', '果然', '不出所料', '想不到', '没想到', '岂料', '谁知',
    '谜', '谜团', '谜底', '秘密', '隐秘', '隐情', '隐情', '玄机', '蹊跷', '古怪',
    '诡异', '可疑', '奇怪', '离奇', '奇特', '异常', '反常', '不对劲', '不对', '蹊跷',
];

/** 冲突性词语 */
const CONFLICT_WORDS = [
    '冲突', '对抗', '争执', '争吵', '吵闹', '吵架', '打斗', '战斗', '搏斗', '厮杀',
    '攻击', '进攻', '反击', '回击', '还击', '抵抗', '反抗', '对抗', '对立', '敌对',
    '敌视', '仇视', '仇恨', '怨恨', '怀恨', '记恨', '痛恨', '憎恨', '厌恶', '讨厌',
    '怒骂', '怒斥', '训斥', '斥责', '责骂', '责备', '责怪', '埋怨', '抱怨', '诉苦',
    '反对', '拒绝', '否决', '驳回', '推翻', '否定', '驳回', '抗拒', '违抗', '违背',
];

/** 转折词 */
const TURNING_POINT_WORDS = [
    '但是', '然而', '可是', '不过', '却', '倒是', '只是', '然而', '反之', '相反',
    '出乎意料', '意想不到', '始料未及', '出乎意料', '竟然', '居然', '哪知', '哪料', '谁知', '岂料',
];

/** 伏笔标记 */
const FORESHADOWING_MARKERS = [
    '...', '……', '（注：', '(注:', '【注】', '※', '†', '伏笔', '暗示', '预示',
];

/** 感官词 - 视觉 */
const VISUAL_WORDS = [
    '看', '见', '望', '瞧', '瞥', '盯', '凝视', '注视', '观察', '打量',
    '颜色', '色彩', '光', '亮', '暗', '明', '黑', '白', '红', '蓝',
    '绿', '黄', '紫', '金', '银', '形状', '大小', '高低', '粗细', '长短',
    '美丽', '漂亮', '英俊', '丑陋', '清秀', '俊朗', '秀丽', '明丽', '艳丽', '绚丽',
];

/** 感官词 - 听觉 */
const AUDITORY_WORDS = [
    '听', '闻', '聆听', '倾听', '侧耳', '竖耳', '听见', '听到', '声响', '声音',
    '响', '鸣', '叫', '喊', '吼', '咆哮', '嘶吼', '低语', '呢喃', '喃喃',
    '音乐', '歌声', '曲调', '旋律', '节奏', '嘈杂', '喧闹', '寂静', '安静', '宁静',
    '叮当', '叮咚', '哗啦', '轰隆', '砰', '啪', '嗒', '叮', '咚', '铛',
];

/** 感官词 - 触觉 */
const TACTILE_WORDS = [
    '摸', '触', '碰', '抚摸', '触碰', '触摸', '接触', '感受', '感觉到', '触感',
    '冷', '热', '温', '凉', '冰', '烫', '暖', '寒', '冻', '燥',
    '软', '硬', '滑', '涩', '粗', '细', '腻', '糙', '韧', '脆',
    '痛', '疼', '酸', '麻', '痒', '胀', '紧', '松', '重', '轻',
];

/** 感官词 - 嗅觉 */
const OLFACTORY_WORDS = [
    '闻', '嗅', '嗅到', '闻到', '气味', '味道', '香味', '香气', '芬芳', '芳香',
    '腥', '腥味', '腥气', '腥臭', '臭', '臭味', '恶臭', '腐臭', '酸臭', '腥膻',
    '香', '馨', '馥郁', '清香', '幽香', '暗香', '余香', '檀香', '檀香', '焚香',
];

/** 感官词 - 味觉 */
const GUSTATORY_WORDS = [
    '尝', '品尝', '品', '尝到', '吃到', '味道', '滋味', '口味', '口感', '味儿',
    '甜', '酸', '苦', '辣', '咸', '淡', '鲜', '涩', '麻', '清',
    '甘', '甘甜', '甘醇', '醇厚', '醇香', '美味', '可口', '好吃', '难吃', '恶心',
];

/** 专有名词特征词（人名/地名等开头大写或带特定字） */
const PROPER_NOUN_MARKERS = [
    '宗', '门', '派', '阁', '楼', '宫', '殿', '院', '堂', '庄',
    '国', '城', '镇', '村', '山', '河', '海', '湖', '谷', '林',
    '岛', '洲', '关', '峡', '原', '漠', '沙', '雪', '冰', '火',
];

/** 设定植入词（解释性段落标志） */
const SETTING_INJECTION_WORDS = [
    '所谓', '据说', '传说', '相传', '据说', '据说', '据说', '原是', '本是', '乃是',
    '指的是', '意思是', '代表着', '象征着', '寓意', '含义', '本质', '真相', '实质', '内涵',
    '定义', '规则', '法则', '规律', '原理', '定律', '定理', '公式', '机制', '体系',
];

/** 古风化词 */
const ARCHAISM_WORDS = [
    '之', '其', '所', '者', '也', '矣', '焉', '哉', '乎', '兮',
    '尔', '耳', '夫', '盖', '故', '且', '若', '虽', '则', '诚',
    '乃', '即', '庶', '迺', '爰', '攸', '遐', '邈', '悠', '杳',
    '曰', '谓', '云', '道', '言', '语', '诉', '陈', '述', '告',
    '吾', '余', '予', '朕', '寡人', '孤', '哀家', '本宫', '臣', '妾',
    '汝', '尔', '乃', '尊', '令', '贤', '贵', '高', '宝', '雅',
];

/** 地域特色词 */
const REGIONAL_WORDS = [
    '俺', '咱', '额', '撒', '哈', '嘛', '咧', '哩', '哟', '嗒',
    '咋', '啥', '咋个', '咋样', '咋办', '咋说', '咋整', '咋弄', '咋搞', '咋想',
    '弄啥', '搞啥', '做啥', '干啥', '弄啥子', '搞啥子', '做啥子', '干啥子', '弄啥咧', '搞啥咧',
    '晓得', '晓得伐', '晓得吧', '晓得啦', '晓得咯', '晓得嘞', '晓得喽', '晓得啰', '晓得嘛', '晓得哈',
];

/** 虚词表 */
const FUNCTION_WORDS = [
    '的', '了', '是', '在', '有', '和', '就', '不', '人', '一',
    '上', '也', '很', '到', '说', '要', '去', '会', '着', '没',
    '看', '好', '自己', '这', '那', '你', '他', '她', '它', '们',
    '个', '把', '让', '被', '从', '向', '往', '对', '为', '以',
    '之', '其', '所', '者', '也', '矣', '焉', '哉', '乎', '兮',
];

/** 常用词表（用于常用词比例计算） */
const COMMON_WORDS = [
    '的', '了', '是', '在', '有', '和', '就', '不', '人', '一',
    '上', '也', '很', '到', '说', '要', '去', '会', '着', '没',
    '看', '好', '自己', '这', '那', '你', '他', '她', '它', '们',
    '什么', '怎么', '为什么', '因为', '所以', '但是', '然后', '可以', '可能', '应该',
    '现在', '今天', '明天', '昨天', '以后', '以前', '已经', '正在', '马上', '立刻',
];

/** 设问句标记词 */
const RHETORICAL_QUESTION_MARKERS = [
    '难道', '岂', '何不', '何尝', '岂非', '难道说', '岂不是', '不是吗', '对不对', '是吗',
    '岂不是吗', '难道不是', '岂能', '岂会', '岂可', '怎会', '怎能', '怎可', '怎敢', '怎肯',
];

/** 倒装句模式（正则） */
const INVERSION_PATTERNS = [
    /[^，。！？]{1,8}的[^，。！？]{1,8}了[。！？]/g,
    /[^，。！？]{1,8}地[^，。！？]{1,8}了[。！？]/g,
    /[^，。！？]{1,8}得[^，。！？]{1,8}了[。！？]/g,
    /太[^，。！？]{1,6}了/g,
    /多[^，。！？]{1,6}啊/g,
];

/** 时间跳跃词 */
const TIME_JUMP_WORDS = [
    '三年后', '五年后', '十年后', '数年后', '多年后', '几日后', '数日后', '翌日', '次日',
    '第二天', '第三天', '一周后', '一个月后', '数月后', '半年后', '一年后', '数年后', '许久后',
    '三年前', '五年前', '十年前', '数年前', '多年前', '几天前', '数日前', '前一天', '前日',
    '此时', '彼时', '此刻', '彼刻', '当下', '当时', '那时', '这时', '那日', '今日',
];

/** 场景切换词 */
const SCENE_SWITCH_WORDS = [
    '与此同时', '另一边', '另一处', '另一地', '却说', '且说', '话分两头', '按下不表', '且按下', '回过头来',
    '目光转向', '视线移到', '镜头一转', '话说', '再说', '再说', '回头说', '再说那', '却说那', '话说那',
];

/** 叙述距离近词（贴近主角内心） */
const NARRATIVE_NEAR_WORDS = [
    '我', '心想', '暗想', '暗道', '觉得', '感到', '感觉', '想到', '认为', '心道',
    '心头', '心中', '内心', '心底', '心下', '心里', '脑海中', '脑子里', '意识', '直觉',
];

/** 叙述距离远词（客观叙述） */
const NARRATIVE_FAR_WORDS = [
    '据说', '相传', '传闻', '据说', '据说', '据记载', '据记载', '据传', '据传', '据说',
    '众人皆知', '众所周知', '人人皆知', '天下皆知', '众所周知', '众所周知', '据说', '据说', '据说', '据说',
];

// ============================================================
// V2 风格拆解器
// ============================================================

export class StyleDeconstructorV2 {
    private v1Deconstructor: StyleDeconstructor;
    private vectorEnhancer?: VectorEnhancer;

    // 词表集合（用于快速查找）
    private positiveEmotionSet: Set<string>;
    private negativeEmotionSet: Set<string>;
    private highIntensitySet: Set<string>;
    private mediumIntensitySet: Set<string>;
    private suspenseSet: Set<string>;
    private conflictSet: Set<string>;
    private turningPointSet: Set<string>;
    private foreshadowingSet: Set<string>;
    private visualSet: Set<string>;
    private auditorySet: Set<string>;
    private tactileSet: Set<string>;
    private olfactorySet: Set<string>;
    private gustatorySet: Set<string>;
    private properNounSet: Set<string>;
    private settingInjectionSet: Set<string>;
    private archaismSet: Set<string>;
    private regionalSet: Set<string>;
    private functionWordSet: Set<string>;
    private commonWordSet: Set<string>;
    private rhetoricalQuestionSet: Set<string>;
    private timeJumpSet: Set<string>;
    private sceneSwitchSet: Set<string>;
    private narrativeNearSet: Set<string>;
    private narrativeFarSet: Set<string>;

    // 性能缓存：同一次 analyze 中 text 不变，避免重复遍历
    private _cachedText: string = '';
    private _cachedChineseCharCount: number = -1;
    private _cachedSentenceCharCounts: Map<string, number> = new Map();
    /** 多字词合并正则缓存（按词表 Set 缓存，避免重复构建） */
    private _regexCache: Map<Set<string>, RegExp> = new Map();

    // 跨词表合并优化：一次正则匹配统计所有词表
    private _allKeywordSets: Set<string>[] = [];
    private _allMultiCharRegex: RegExp | null = null;
    private _wordToSets: Map<string, Set<string>[]> = new Map();
    private _allSingleCharSet: Set<string> = new Set();
    private _singleCharToSets: Map<string, Set<string>[]> = new Map();
    private _precomputedCounts: Map<Set<string>, number> | null = null;

    constructor(vectorEnhancer?: VectorEnhancer) {
        this.v1Deconstructor = new StyleDeconstructor(vectorEnhancer);
        this.vectorEnhancer = vectorEnhancer;

        this.positiveEmotionSet = new Set(POSITIVE_EMOTION_WORDS);
        this.negativeEmotionSet = new Set(NEGATIVE_EMOTION_WORDS);
        this.highIntensitySet = new Set(HIGH_INTENSITY_EMOTION_WORDS);
        this.mediumIntensitySet = new Set(MEDIUM_INTENSITY_EMOTION_WORDS);
        this.suspenseSet = new Set(SUSPENSE_WORDS);
        this.conflictSet = new Set(CONFLICT_WORDS);
        this.turningPointSet = new Set(TURNING_POINT_WORDS);
        this.foreshadowingSet = new Set(FORESHADOWING_MARKERS);
        this.visualSet = new Set(VISUAL_WORDS);
        this.auditorySet = new Set(AUDITORY_WORDS);
        this.tactileSet = new Set(TACTILE_WORDS);
        this.olfactorySet = new Set(OLFACTORY_WORDS);
        this.gustatorySet = new Set(GUSTATORY_WORDS);
        this.properNounSet = new Set(PROPER_NOUN_MARKERS);
        this.settingInjectionSet = new Set(SETTING_INJECTION_WORDS);
        this.archaismSet = new Set(ARCHAISM_WORDS);
        this.regionalSet = new Set(REGIONAL_WORDS);
        this.functionWordSet = new Set(FUNCTION_WORDS);
        this.commonWordSet = new Set(COMMON_WORDS);
        this.rhetoricalQuestionSet = new Set(RHETORICAL_QUESTION_MARKERS);
        this.timeJumpSet = new Set(TIME_JUMP_WORDS);
        this.sceneSwitchSet = new Set(SCENE_SWITCH_WORDS);
        this.narrativeNearSet = new Set(NARRATIVE_NEAR_WORDS);
        this.narrativeFarSet = new Set(NARRATIVE_FAR_WORDS);

        // 构建跨词表合并结构（用于一次正则匹配统计所有词表）
        this._allKeywordSets = [
            this.positiveEmotionSet, this.negativeEmotionSet, this.highIntensitySet, this.mediumIntensitySet,
            this.suspenseSet, this.conflictSet, this.turningPointSet, this.foreshadowingSet,
            this.visualSet, this.auditorySet, this.tactileSet, this.olfactorySet, this.gustatorySet,
            this.properNounSet, this.settingInjectionSet, this.archaismSet, this.regionalSet,
            this.functionWordSet, this.commonWordSet, this.rhetoricalQuestionSet,
            this.timeJumpSet, this.sceneSwitchSet, this.narrativeNearSet, this.narrativeFarSet,
        ];
        this._buildMergedKeywordStructures();
    }

    /**
     * 构建跨词表合并结构：
     * - 单字词：合并成一个大 Set，word -> 所属词表列表
     * - 多字词：构建一个大正则，word -> 所属词表列表
     * 这样一次遍历/匹配就能统计所有词表
     */
    private _buildMergedKeywordStructures(): void {
        const allMultiCharWords: string[] = [];
        for (const keywordSet of this._allKeywordSets) {
            for (const word of keywordSet) {
                if (word.length === 0) continue;
                if (word.length === 1) {
                    // 单字词
                    if (!this._allSingleCharSet.has(word)) {
                        this._allSingleCharSet.add(word);
                        this._singleCharToSets.set(word, []);
                    }
                    this._singleCharToSets.get(word)!.push(keywordSet);
                } else {
                    // 多字词
                    if (!this._wordToSets.has(word)) {
                        this._wordToSets.set(word, []);
                        allMultiCharWords.push(word);
                    }
                    this._wordToSets.get(word)!.push(keywordSet);
                }
            }
        }
        // 按长度降序构建大正则（优先匹配长词）
        allMultiCharWords.sort((a, b) => b.length - a.length);
        const pattern = allMultiCharWords.map(w => this.escapeRegex(w)).join('|');
        this._allMultiCharRegex = new RegExp(pattern, 'g');
    }

    /**
     * 预计算所有词表的 countKeywords 结果（一次遍历 + 一次正则匹配）
     */
    private _precomputeAllKeywordCounts(text: string): Map<Set<string>, number> {
        const counts = new Map<Set<string>, number>();
        // 初始化所有词表计数为 0
        for (const set of this._allKeywordSets) {
            counts.set(set, 0);
        }

        // 单字词：一次遍历
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const sets = this._singleCharToSets.get(char);
            if (sets) {
                for (const set of sets) {
                    counts.set(set, counts.get(set)! + 1);
                }
            }
        }

        // 多字词：一次大正则匹配
        if (this._allMultiCharRegex) {
            this._allMultiCharRegex.lastIndex = 0;
            const matches = text.match(this._allMultiCharRegex);
            if (matches) {
                for (const match of matches) {
                    const sets = this._wordToSets.get(match);
                    if (sets) {
                        for (const set of sets) {
                            counts.set(set, counts.get(set)! + 1);
                        }
                    }
                }
            }
        }
        return counts;
    }

    /**
     * V2 12 维分析（异步，纯统计）
     * 兼容 V1：返回结果中包含 v1Result 字段
     */
    async analyze(text: string): Promise<StyleAnalysisResultV2> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        // 清空句子级缓存（每次 analyze 调用句子可能不同）
        this._cachedSentenceCharCounts.clear();
        this._cachedText = '';
        this._cachedChineseCharCount = -1;

        // 预计算所有词表的 countKeywords（一次遍历 + 一次正则匹配）
        this._precomputedCounts = this._precomputeAllKeywordCounts(text);

        // 1. 调用 V1 获取基础 7 维结果（完全向后兼容）
        const v1Result = await this.v1Deconstructor.analyze(text);

        // 2. 预处理：分割句子和段落（复用计算）
        const paragraphs = this.splitParagraphs(text);
        const sentences = this.splitSentences(text);
        const totalChars = text.length;

        // 3. 计算 V2 12 维特征
        const features: StyleFingerprintFeaturesV2 = {
            rhythm: this.analyzeRhythm(text, v1Result, sentences, paragraphs, totalChars),
            sentencePattern: this.analyzeSentencePattern(text, sentences, totalChars),
            wordChoice: this.analyzeWordChoice(text, v1Result, sentences, totalChars),
            rhetoric: this.analyzeRhetoric(text, v1Result, sentences, totalChars),
            perspective: this.analyzePerspective(text, v1Result, paragraphs, totalChars),
            emotion: this.analyzeEmotion(text, sentences, paragraphs, totalChars),
            tension: this.analyzeTension(text, sentences, paragraphs, totalChars),
            infoDensity: this.analyzeInfoDensity(text, sentences, paragraphs, totalChars),
            dialogue: this.analyzeDialogue(text, v1Result, totalChars),
            description: this.analyzeDescription(text, paragraphs, totalChars),
            narration: this.analyzeNarration(text, v1Result, paragraphs, totalChars),
            languageTexture: this.analyzeLanguageTexture(text, v1Result, sentences, totalChars),
        };

        // 清空预计算缓存，避免影响后续独立调用
        this._precomputedCounts = null;

        return {
            features,
            stats: v1Result.stats,
            v1Result,
        };
    }

    /**
     * V1 兼容方法：返回 V1 格式结果
     * 这是 V1 analyze 的包装器，确保完全向后兼容
     */
    async analyzeV1(text: string): Promise<StyleAnalysisResult> {
        return await this.v1Deconstructor.analyze(text);
    }

    // ============================================================
    // 维度 1: RhythmStats — 节奏（V1 升级）
    // ============================================================

    private analyzeRhythm(
        text: string,
        v1: StyleAnalysisResult,
        sentences: string[],
        paragraphs: string[],
        totalChars: number
    ): RhythmStats {
        // 复用 V1 数据
        const v1Rhythm = v1.sentenceRhythm;
        const lengthDistribution = v1Rhythm.lengthDistribution;

        // 新增：标点密度（每千字标点数）
        const punctuationCount = (text.match(/[，。！？、；：…—""''「」『』（）·\-]/g) || []).length;
        const punctuationDensity = this.perThousand(punctuationCount, totalChars);

        // 新增：段落密度（每千字段落数）
        const paragraphDensity = this.perThousand(paragraphs.length, totalChars);

        // 新增：停顿频率（逗号+顿号每千字）
        const pauseCount = (text.match(/[，、]/g) || []).length;
        const pauseFrequency = this.perThousand(pauseCount, totalChars);

        const samples = this.selectRhythmSamples(sentences, lengthDistribution);

        const description = this.generateRhythmDescription(
            lengthDistribution,
            v1Rhythm.avgSentenceLength,
            punctuationDensity,
            paragraphDensity
        );

        return {
            sentenceLengthDistribution: lengthDistribution,
            avgSentenceLength: v1Rhythm.avgSentenceLength,
            shortSentenceRatio: lengthDistribution.short,
            punctuationDensity,
            paragraphDensity,
            pauseFrequency,
            description,
            samples,
            status: 'complete',
        };
    }

    private generateRhythmDescription(
        dist: { short: number; medium: number; long: number },
        avgLen: number,
        punctDensity: number,
        paraDensity: number
    ): string {
        const parts: string[] = [];
        if (dist.short > 0.5) {
            parts.push(`本段节奏偏快，短句占比 ${(dist.short * 100).toFixed(0)}%，适合紧张场景`);
        } else if (dist.long > 0.5) {
            parts.push(`本段节奏舒缓，长句占比 ${(dist.long * 100).toFixed(0)}%，适合描写铺垫`);
        } else {
            parts.push(`节奏均衡，短句 ${(dist.short * 100).toFixed(0)}%、中句 ${(dist.medium * 100).toFixed(0)}%、长句 ${(dist.long * 100).toFixed(0)}%`);
        }
        parts.push(`平均句长 ${avgLen.toFixed(1)} 字`);
        if (punctDensity > 30) {
            parts.push('标点密集');
        } else if (punctDensity < 15) {
            parts.push('标点稀疏');
        }
        if (paraDensity > 5) {
            parts.push('段落短小');
        }
        return parts.join('，') + '。';
    }

    private selectRhythmSamples(
        sentences: string[],
        dist: { short: number; medium: number; long: number }
    ): string[] {
        const samples: string[] = [];
        const shortS = sentences.filter(s => this.countChineseChars(s) <= 10);
        const longS = sentences.filter(s => this.countChineseChars(s) > 30);

        // 选 2-3 段代表性片段
        if (dist.short > dist.long && shortS.length > 0) {
            samples.push(this.truncateSample(shortS[0]));
            if (shortS.length > 1) samples.push(this.truncateSample(shortS[Math.floor(shortS.length / 2)]));
        } else if (longS.length > 0) {
            samples.push(this.truncateSample(longS[0]));
            if (longS.length > 1) samples.push(this.truncateSample(longS[Math.floor(longS.length / 2)]));
        } else if (sentences.length > 0) {
            samples.push(this.truncateSample(sentences[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 2: SentencePatternStats — 句式（新增）
    // ============================================================

    private analyzeSentencePattern(
        text: string,
        sentences: string[],
        totalChars: number
    ): SentencePatternStats {
        // 倒装句检测
        let inversionCount = 0;
        for (const pattern of INVERSION_PATTERNS) {
            const matches = text.match(pattern);
            if (matches) inversionCount += matches.length;
        }
        const inversionDensity = this.perThousand(inversionCount, totalChars);

        // 省略句检测：缺少主语或谓语的短句（少于 6 字且无动词标记）
        let ellipsisCount = 0;
        for (const s of sentences) {
            const len = this.countChineseChars(s);
            if (len < 6 && !/[说看听想走跑是的有在]/.test(s)) {
                ellipsisCount++;
            }
        }
        const ellipsisDensity = this.perThousand(ellipsisCount, totalChars);

        // 排比句密度（从 V1 复用逻辑：连续 3+ 句相同句式开头）
        const parallelismCount = this.detectParallelism(sentences);
        const parallelismDensity = this.perThousand(parallelismCount, totalChars);

        // 设问句比例：含 "？" 的句子中设问句占比
        const interrogativeSentences = sentences.filter(s => /[？?]/.test(s));
        let rhetoricalCount = 0;
        for (const s of interrogativeSentences) {
            if (this.containsAny(s, this.rhetoricalQuestionSet)) {
                rhetoricalCount++;
            }
        }
        const rhetoricalQuestionRatio = interrogativeSentences.length > 0
            ? rhetoricalCount / interrogativeSentences.length
            : 0;

        // 从句嵌套深度：基于逗号数量估算平均嵌套层级
        const nestingDepths = sentences.map(s => {
            const commaCount = (s.match(/[，,]/g) || []).length;
            return Math.min(commaCount + 1, 5); // 上限 5 层
        });
        const clauseNestingDepth = sentences.length > 0
            ? nestingDepths.reduce((a, b) => a + b, 0) / sentences.length
            : 0;

        const samples = this.selectSentencePatternSamples(sentences, rhetoricalQuestionRatio, parallelismDensity);

        const description = this.generateSentencePatternDescription(
            inversionDensity, ellipsisDensity, parallelismDensity,
            rhetoricalQuestionRatio, clauseNestingDepth
        );

        return {
            inversionDensity,
            ellipsisDensity,
            parallelismDensity,
            rhetoricalQuestionRatio: this.round2(rhetoricalQuestionRatio),
            clauseNestingDepth: this.round2(clauseNestingDepth),
            description,
            samples,
            status: 'complete',
        };
    }

    private generateSentencePatternDescription(
        inversion: number, ellipsis: number, parallelism: number,
        rhetorical: number, nesting: number
    ): string {
        const parts: string[] = [];
        if (parallelism > 2) {
            parts.push(`排比句密度高（${parallelism.toFixed(1)}/千字）`);
        }
        if (rhetorical > 0.3) {
            parts.push(`设问句占比高（${(rhetorical * 100).toFixed(0)}%）`);
        }
        if (ellipsis > 5) {
            parts.push(`省略句较多（${ellipsis.toFixed(1)}/千字）`);
        }
        if (inversion > 2) {
            parts.push(`倒装句偶现（${inversion.toFixed(1)}/千字）`);
        }
        if (nesting > 2) {
            parts.push(`从句嵌套较深（平均 ${nesting.toFixed(1)} 层）`);
        } else if (nesting < 1.2) {
            parts.push('句式简单直接');
        }
        if (parts.length === 0) {
            parts.push('句式分布均匀，无明显突出特征');
        }
        return parts.join('，') + '。';
    }

    private selectSentencePatternSamples(
        sentences: string[],
        rhetoricalRatio: number,
        parallelismDensity: number
    ): string[] {
        const samples: string[] = [];
        // 优先选设问句
        if (rhetoricalRatio > 0.1) {
            const rhetorical = sentences.filter(s =>
                /[？?]/.test(s) && this.containsAny(s, this.rhetoricalQuestionSet)
            );
            if (rhetorical.length > 0) {
                samples.push(this.truncateSample(rhetorical[0]));
            }
        }
        // 选排比句
        if (parallelismDensity > 0 && sentences.length >= 3) {
            for (let i = 0; i < sentences.length - 2; i++) {
                const start1 = sentences[i].slice(0, 2);
                const start2 = sentences[i + 1].slice(0, 2);
                const start3 = sentences[i + 2].slice(0, 2);
                if (start1 === start2 && start2 === start3) {
                    samples.push(this.truncateSample(sentences[i]));
                    break;
                }
            }
        }
        // 补充长句
        if (samples.length < 2) {
            const longS = sentences.filter(s => this.countChineseChars(s) > 20);
            if (longS.length > 0) {
                samples.push(this.truncateSample(longS[0]));
            }
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 3: WordChoiceStats — 用词（V1 升级）
    // ============================================================

    private analyzeWordChoice(
        text: string,
        v1: StyleAnalysisResult,
        sentences: string[],
        totalChars: number
    ): WordChoiceStats {
        const v1WordPref = v1.wordPreference;

        // 常用词比例（使用优化后的 countKeywords，单字词一次扫描）
        const commonCount = this.countKeywords(text, this.commonWordSet);
        const totalChineseChars = this.countChineseChars(text);
        const commonWordRatio = totalChineseChars > 0
            ? Math.min(1, (commonCount * 2) / totalChineseChars) // 假设每词 2 字
            : 0;

        // 生僻词比例（非常用词的反比例）
        const rareWordRatio = this.round2(Math.max(0, 1 - commonWordRatio));

        // 虚词比例
        const functionCount = this.countKeywords(text, this.functionWordSet);
        const functionWordRatio = totalChineseChars > 0
            ? Math.min(1, functionCount / totalChineseChars)
            : 0;

        // 词长分布（基于 2-4 字词的频次）
        const wordLengthDistribution = this.calculateWordLengthDistribution(text);

        // 四字格密度（从 V1 复用）
        const fourCharIdiomDensity = v1WordPref.idiomDensity;

        const samples = this.selectWordChoiceSamples(text, sentences, rareWordRatio, fourCharIdiomDensity);

        const description = this.generateWordChoiceDescription(
            commonWordRatio, rareWordRatio, functionWordRatio, fourCharIdiomDensity
        );

        return {
            commonWordRatio: this.round2(commonWordRatio),
            rareWordRatio,
            functionWordRatio: this.round2(functionWordRatio),
            wordLengthDistribution,
            fourCharIdiomDensity,
            description,
            samples,
            status: 'complete',
        };
    }

    private calculateWordLengthDistribution(text: string): { len1: number; len2: number; len3: number; len4plus: number } {
        let len1 = 0, len2 = 0, len3 = 0, len4plus = 0;
        let total = 0;
        // 简化：按字符序列统计
        for (let i = 0; i < text.length; i++) {
            if (!isChineseChar(text[i])) continue;
            // 简化估算：每 2 字一个词
            if (i + 1 < text.length && isChineseChar(text[i + 1])) {
                len2++;
                total++;
                i++; // 跳过下一字
            } else {
                len1++;
                total++;
            }
        }
        const safe = total || 1;
        return {
            len1: this.round2(len1 / safe),
            len2: this.round2(len2 / safe),
            len3: 0,
            len4plus: 0,
        };
    }

    private generateWordChoiceDescription(
        common: number, rare: number, func: number, idiom: number
    ): string {
        const parts: string[] = [];
        if (common > 0.6) {
            parts.push('以常用词为主');
        } else if (rare > 0.4) {
            parts.push('生僻词较多');
        } else {
            parts.push('用词难度适中');
        }
        if (func > 0.3) {
            parts.push(`虚词比例偏高（${(func * 100).toFixed(0)}%）`);
        }
        if (idiom > 3) {
            parts.push(`四字格密集（${idiom.toFixed(1)}/千字）`);
        } else if (idiom < 0.5) {
            parts.push('四字格较少');
        }
        return parts.join('，') + '。';
    }

    private selectWordChoiceSamples(text: string, sentences: string[], rareRatio: number, idiomDensity: number): string[] {
        const samples: string[] = [];
        if (idiomDensity > 1) {
            // 找四字格
            const match = text.match(/[\u4e00-\u9fa5]{4}/);
            if (match) {
                const idx = text.indexOf(match[0]);
                samples.push(this.truncateSample(text.slice(Math.max(0, idx - 10), idx + 14)));
            }
        }
        if (rareRatio > 0.3 && samples.length < 2) {
            // 找长句作为生僻词示例
            const longS = sentences.find(s => this.countChineseChars(s) > 25);
            if (longS) samples.push(this.truncateSample(longS));
        }
        if (samples.length === 0) {
            if (sentences.length > 0) {
                samples.push(this.truncateSample(sentences[0]));
            }
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 4: RhetoricStatsV2 — 修辞（V1 升级）
    // ============================================================

    private analyzeRhetoric(
        text: string,
        v1: StyleAnalysisResult,
        sentences: string[],
        totalChars: number
    ): RhetoricStatsV2 {
        const v1Rhetoric = v1.rhetoric;

        // 从 V1 转换为每千字密度
        const metaphorDensity = this.perThousand(v1Rhetoric.metaphor, totalChars);
        const personificationDensity = this.perThousand(v1Rhetoric.personification, totalChars);
        const hyperboleDensity = this.perThousand(v1Rhetoric.hyperbole, totalChars);
        const parallelismDensity = this.perThousand(v1Rhetoric.parallelism, totalChars);
        const antithesisDensity = this.perThousand(v1Rhetoric.antithesis, totalChars);

        // 新增：通感检测（感官词与情感词/动作词共现）
        const synesthesiaCount = this.detectSynesthesia(text);
        const synesthesiaDensity = this.perThousand(synesthesiaCount, totalChars);

        const samples = this.selectRhetoricSamples(sentences, v1Rhetoric);

        const description = this.generateRhetoricDescription(
            metaphorDensity, personificationDensity, hyperboleDensity,
            parallelismDensity, antithesisDensity, synesthesiaDensity
        );

        return {
            metaphorDensity,
            personificationDensity,
            hyperboleDensity,
            parallelismDensity,
            antithesisDensity,
            synesthesiaDensity,
            description,
            samples,
            status: 'complete',
        };
    }

    private detectSynesthesia(text: string): number {
        // 通感：感官词与不同感官词或情感词共现
        const sensoryWords = [
            ...VISUAL_WORDS.slice(0, 10),
            ...AUDITORY_WORDS.slice(0, 10),
            ...TACTILE_WORDS.slice(0, 10),
        ];
        let count = 0;
        // 简化检测：匹配"听起来...看..."或"声音...颜色"等模式
        const patterns = [
            /听[^。！？]{0,10}(看|见|颜色|色彩|明亮|黑暗)/g,
            /看[^。！？]{0,10}(声音|响|鸣|吵|静)/g,
            /声音[^。！？]{0,6}(冷|热|暖|硬|软|亮|暗)/g,
            /气味[^。！？]{0,6}(甜|苦|酸|辣|冷|热)/g,
        ];
        for (const p of patterns) {
            const m = text.match(p);
            if (m) count += m.length;
        }
        return count;
    }

    private generateRhetoricDescription(
        metaphor: number, personification: number, hyperbole: number,
        parallelism: number, antithesis: number, synesthesia: number
    ): string {
        const parts: string[] = [];
        if (metaphor > 3) parts.push(`比喻密集（${metaphor.toFixed(1)}/千字）`);
        if (personification > 1) parts.push(`拟人较多（${personification.toFixed(1)}/千字）`);
        if (hyperbole > 0.5) parts.push('夸张偶现');
        if (parallelism > 1) parts.push(`排比有力（${parallelism.toFixed(1)}/千字）`);
        if (antithesis > 0.5) parts.push('对偶工整');
        if (synesthesia > 0.3) parts.push('通感手法点缀');
        if (parts.length === 0) parts.push('修辞手法较少，语言朴素');
        return parts.join('，') + '。';
    }

    private selectRhetoricSamples(sentences: string[], v1Rhetoric: { metaphor: number; personification: number; parallelism: number }): string[] {
        const samples: string[] = [];
        // 找比喻句
        if (v1Rhetoric.metaphor > 0) {
            const metaphorS = sentences.find(s => /[像如似仿佛犹如宛如]/.test(s));
            if (metaphorS) samples.push(this.truncateSample(metaphorS));
        }
        // 找排比句
        if (v1Rhetoric.parallelism > 0) {
            for (let i = 0; i < sentences.length - 2; i++) {
                if (sentences[i].slice(0, 2) === sentences[i + 1].slice(0, 2)) {
                    samples.push(this.truncateSample(sentences[i]));
                    break;
                }
            }
        }
        if (samples.length < 2 && sentences.length > 0) {
            samples.push(this.truncateSample(sentences[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 5: PerspectiveStats — 视角（V1 升级）
    // ============================================================

    private analyzePerspective(
        text: string,
        v1: StyleAnalysisResult,
        paragraphs: string[],
        totalChars: number
    ): PerspectiveStats {
        const v1Narrative = v1.narrativeStyle;

        // 人称分布
        const firstCount = (text.match(/我[们们]?/g) || []).length;
        const secondCount = (text.match(/[你妳]们?/g) || []).length;
        const thirdCount = (text.match(/[他她它]们?/g) || []).length;
        const personTotal = firstCount + secondCount + thirdCount || 1;
        const personDistribution = {
            first: this.round2(firstCount / personTotal),
            second: this.round2(secondCount / personTotal),
            third: this.round2(thirdCount / personTotal),
        };

        // 视角切换频率：段落间主语变化次数
        let switchCount = 0;
        for (let i = 1; i < paragraphs.length; i++) {
            const prevStart = paragraphs[i - 1].slice(0, 2);
            const currStart = paragraphs[i].slice(0, 2);
            if (prevStart !== currStart &&
                (/^[我你他她它]/.test(prevStart) || /^[我你他她它]/.test(currStart))) {
                switchCount++;
            }
        }
        const perspectiveSwitchFrequency = this.perThousand(switchCount, totalChars);

        // 叙述距离分布
        const nearCount = this.countKeywords(text, this.narrativeNearSet);
        const farCount = this.countKeywords(text, this.narrativeFarSet);
        const distTotal = nearCount + farCount || 1;
        const narrativeDistance = {
            far: this.round2(farCount / distTotal),
            medium: this.round2(0), // 简化：中等距离取剩余
            near: this.round2(nearCount / distTotal),
        };
        // 修正：medium 为剩余部分
        narrativeDistance.medium = this.round2(Math.max(0, 1 - narrativeDistance.far - narrativeDistance.near));

        const samples = this.selectPerspectiveSamples(paragraphs, personDistribution);

        const description = this.generatePerspectiveDescription(
            personDistribution, perspectiveSwitchFrequency, narrativeDistance, v1Narrative.perspective
        );

        return {
            personDistribution,
            perspectiveSwitchFrequency,
            narrativeDistance,
            description,
            samples,
            status: 'complete',
        };
    }

    private generatePerspectiveDescription(
        person: { first: number; second: number; third: number },
        switchFreq: number,
        distance: { far: number; medium: number; near: number },
        v1Perspective: string
    ): string {
        const parts: string[] = [];
        if (person.first > 0.5) {
            parts.push('第一人称为主，代入感强');
        } else if (person.third > 0.7) {
            parts.push('第三人称叙述');
        } else {
            parts.push('人称视角混合');
        }
        if (switchFreq > 3) {
            parts.push(`视角切换频繁（${switchFreq.toFixed(1)}/千字）`);
        } else if (switchFreq < 0.5) {
            parts.push('视角稳定');
        }
        if (distance.near > 0.6) {
            parts.push('叙述距离贴近内心');
        } else if (distance.far > 0.6) {
            parts.push('叙述距离较远，客观克制');
        }
        return parts.join('，') + '。';
    }

    private selectPerspectiveSamples(
        paragraphs: string[],
        person: { first: number; second: number; third: number }
    ): string[] {
        const samples: string[] = [];
        if (person.first > 0.3) {
            const firstP = paragraphs.find(p => /^我/.test(p.trim()));
            if (firstP) samples.push(this.truncateSample(firstP));
        }
        if (person.third > 0.3) {
            const thirdP = paragraphs.find(p => /^[他她它]/.test(p.trim()));
            if (thirdP) samples.push(this.truncateSample(thirdP));
        }
        if (samples.length === 0 && paragraphs.length > 0) {
            samples.push(this.truncateSample(paragraphs[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 6: EmotionStats — 情绪（新增）
    // ============================================================

    private analyzeEmotion(
        text: string,
        sentences: string[],
        paragraphs: string[],
        totalChars: number
    ): EmotionStats {
        // 情绪词匹配
        const positiveCount = this.countKeywords(text, this.positiveEmotionSet);
        const negativeCount = this.countKeywords(text, this.negativeEmotionSet);
        const highIntensityCount = this.countKeywords(text, this.highIntensitySet);
        const mediumIntensityCount = this.countKeywords(text, this.mediumIntensitySet);
        const totalEmotion = positiveCount + negativeCount;

        // 正负向情绪比例
        const valenceTotal = totalEmotion || 1;
        const valenceRatio = {
            positive: this.round2(positiveCount / valenceTotal),
            negative: this.round2(negativeCount / valenceTotal),
            neutral: this.round2(0), // 简化：中性情绪不单独统计
        };
        valenceRatio.neutral = this.round2(Math.max(0, 1 - valenceRatio.positive - valenceRatio.negative));

        // 情绪基调
        const emotionalTone = this.determineEmotionalTone(positiveCount, negativeCount, highIntensityCount);

        // 情绪波动频率：每千字情绪变化次数（正负交替）
        const fluctuationCount = this.countEmotionFluctuations(sentences);
        const emotionalFluctuationFrequency = this.perThousand(fluctuationCount, totalChars);

        // 情绪强度分布
        const intensityTotal = highIntensityCount + mediumIntensityCount + Math.max(0, totalEmotion - highIntensityCount - mediumIntensityCount) || 1;
        const lowIntensityCount = Math.max(0, totalEmotion - highIntensityCount - mediumIntensityCount);
        const emotionalIntensityDistribution = {
            low: this.round2(lowIntensityCount / intensityTotal),
            medium: this.round2(mediumIntensityCount / intensityTotal),
            high: this.round2(highIntensityCount / intensityTotal),
        };

        const samples = this.selectEmotionSamples(sentences, positiveCount, negativeCount);

        const description = this.generateEmotionDescription(
            emotionalTone, emotionalFluctuationFrequency, emotionalIntensityDistribution, valenceRatio
        );

        return {
            emotionalTone,
            emotionalFluctuationFrequency,
            emotionalIntensityDistribution,
            valenceRatio,
            description,
            samples,
            status: 'complete',
        };
    }

    private determineEmotionalTone(positive: number, negative: number, highIntensity: number): string {
        if (positive + negative === 0) return '平淡';
        const positiveRatio = positive / (positive + negative);
        if (highIntensity > 3) {
            return positiveRatio > 0.5 ? '昂扬' : '激越';
        }
        if (positiveRatio > 0.7) return '愉悦';
        if (negative > positive * 1.5) return '压抑';
        if (positive > negative * 1.5) return '明朗';
        return '平静';
    }

    private countEmotionFluctuations(sentences: string[]): number {
        let fluctuation = 0;
        let prevValence: 'pos' | 'neg' | 'neutral' = 'neutral';
        for (const s of sentences) {
            const hasPos = this.containsAny(s, this.positiveEmotionSet);
            const hasNeg = this.containsAny(s, this.negativeEmotionSet);
            const current: 'pos' | 'neg' | 'neutral' = hasPos && !hasNeg ? 'pos' : (hasNeg && !hasPos ? 'neg' : 'neutral');
            if (current !== 'neutral' && current !== prevValence && prevValence !== 'neutral') {
                fluctuation++;
            }
            if (current !== 'neutral') prevValence = current;
        }
        return fluctuation;
    }

    private generateEmotionDescription(
        tone: string, fluctuation: number,
        intensity: { low: number; medium: number; high: number },
        valence: { positive: number; negative: number; neutral: number }
    ): string {
        const parts: string[] = [];
        parts.push(`情绪基调为${tone}`);
        if (valence.positive > 0.6) {
            parts.push(`正向情绪占主导（${(valence.positive * 100).toFixed(0)}%）`);
        } else if (valence.negative > 0.6) {
            parts.push(`负向情绪突出（${(valence.negative * 100).toFixed(0)}%）`);
        }
        if (intensity.high > 0.3) {
            parts.push('高强度情绪词密集');
        } else if (intensity.low > 0.6) {
            parts.push('情绪强度偏低');
        }
        if (fluctuation > 3) {
            parts.push(`情绪波动频繁（${fluctuation.toFixed(1)}/千字）`);
        }
        return parts.join('，') + '。';
    }

    private selectEmotionSamples(sentences: string[], positiveCount: number, negativeCount: number): string[] {
        const samples: string[] = [];
        if (positiveCount >= negativeCount) {
            const posS = sentences.find(s => this.containsAny(s, this.positiveEmotionSet));
            if (posS) samples.push(this.truncateSample(posS));
        }
        if (negativeCount > 0) {
            const negS = sentences.find(s => this.containsAny(s, this.negativeEmotionSet));
            if (negS) samples.push(this.truncateSample(negS));
        }
        if (samples.length < 2 && sentences.length > 0) {
            samples.push(this.truncateSample(sentences[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 7: TensionStats — 张力（新增）
    // ============================================================

    private analyzeTension(
        text: string,
        sentences: string[],
        paragraphs: string[],
        totalChars: number
    ): TensionStats {
        // 悬念词密度
        const suspenseCount = this.countKeywords(text, this.suspenseSet);
        const suspenseDensity = this.perThousand(suspenseCount, totalChars);

        // 冲突频率
        const conflictCount = this.countKeywords(text, this.conflictSet);
        const conflictFrequency = this.perThousand(conflictCount, totalChars);

        // 转折句密度
        const turningCount = this.countKeywords(text, this.turningPointSet);
        const turningPointDensity = this.perThousand(turningCount, totalChars);

        // 伏笔标记检测
        let foreshadowingCount = 0;
        for (const marker of FORESHADOWING_MARKERS) {
            const count = (text.split(marker).length - 1);
            foreshadowingCount += count;
        }
        const foreshadowingMarkerCount = this.perThousand(foreshadowingCount, totalChars);

        // 高潮分布：基于段落张力值（悬念词+冲突词+转折词密度）
        const climaxDistribution = this.calculateClimaxDistribution(paragraphs);

        const samples = this.selectTensionSamples(sentences, suspenseDensity, turningPointDensity);

        const description = this.generateTensionDescription(
            suspenseDensity, conflictFrequency, turningPointDensity,
            foreshadowingMarkerCount, climaxDistribution
        );

        return {
            suspenseDensity,
            conflictFrequency,
            turningPointDensity,
            foreshadowingMarkerCount,
            climaxDistribution,
            description,
            samples,
            status: 'complete',
        };
    }

    private calculateClimaxDistribution(paragraphs: string[]): { early: number; middle: number; late: number } {
        if (paragraphs.length === 0) {
            return { early: 0, middle: 0, late: 0 };
        }
        const third = Math.max(1, Math.floor(paragraphs.length / 3));
        const earlyParas = paragraphs.slice(0, third);
        const middleParas = paragraphs.slice(third, third * 2);
        const lateParas = paragraphs.slice(third * 2);

        const calcTension = (paras: string[]): number => {
            return paras.reduce((sum, p) => {
                const s = this.countKeywordsInText(p, this.suspenseSet);
                const c = this.countKeywordsInText(p, this.conflictSet);
                const t = this.countKeywordsInText(p, this.turningPointSet);
                return sum + s + c + t;
            }, 0);
        };

        const earlyT = calcTension(earlyParas);
        const middleT = calcTension(middleParas);
        const lateT = calcTension(lateParas);
        const total = earlyT + middleT + lateT || 1;

        return {
            early: this.round2(earlyT / total),
            middle: this.round2(middleT / total),
            late: this.round2(lateT / total),
        };
    }

    private generateTensionDescription(
        suspense: number, conflict: number, turning: number,
        foreshadowing: number, climax: { early: number; middle: number; late: number }
    ): string {
        const parts: string[] = [];
        if (suspense > 5) {
            parts.push(`悬念密集（${suspense.toFixed(1)}/千字）`);
        } else if (suspense > 1) {
            parts.push('悬念适度');
        }
        if (conflict > 3) {
            parts.push(`冲突激烈（${conflict.toFixed(1)}/千字）`);
        }
        if (turning > 2) {
            parts.push(`转折频繁（${turning.toFixed(1)}/千字）`);
        }
        if (foreshadowing > 1) {
            parts.push('伏笔标记较多');
        }
        if (climax.late > 0.5) {
            parts.push('高潮集中于后段');
        } else if (climax.early > 0.4) {
            parts.push('开篇即高潮');
        } else if (climax.middle > 0.4) {
            parts.push('高潮居中');
        }
        if (parts.length === 0) parts.push('张力平缓');
        return parts.join('，') + '。';
    }

    private selectTensionSamples(sentences: string[], suspenseDensity: number, turningDensity: number): string[] {
        const samples: string[] = [];
        if (suspenseDensity > 0.5) {
            const suspS = sentences.find(s => this.containsAny(s, this.suspenseSet));
            if (suspS) samples.push(this.truncateSample(suspS));
        }
        if (turningDensity > 0.5) {
            const turnS = sentences.find(s => this.containsAny(s, this.turningPointSet));
            if (turnS) samples.push(this.truncateSample(turnS));
        }
        if (samples.length < 2 && sentences.length > 0) {
            // 选带感叹号或问号的句子
            const emotional = sentences.find(s => /[！？!?]/.test(s));
            if (emotional) samples.push(this.truncateSample(emotional));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 8: InfoDensityStats — 信息量（新增）
    // ============================================================

    private analyzeInfoDensity(
        text: string,
        sentences: string[],
        paragraphs: string[],
        totalChars: number
    ): InfoDensityStats {
        const totalChineseChars = this.countChineseChars(text);

        // 信息密度：实词（名词+动词）占比，简化为非虚词、非情绪词的字符占比
        const functionCount = this.countKeywords(text, this.functionWordSet);
        const infoDensity = totalChineseChars > 0
            ? Math.max(0, (totalChineseChars - functionCount) / totalChineseChars)
            : 0;

        // 专有名词密度
        const properNounCount = this.countKeywords(text, this.properNounSet);
        const properNounDensity = this.perThousand(properNounCount, totalChars);

        // 设定植入频率
        const settingCount = this.countKeywords(text, this.settingInjectionSet);
        const settingInjectionFrequency = this.perThousand(settingCount, totalChars);

        // 概念引入节奏：新概念（专有名词+设定词）每千字出现数
        const conceptCount = properNounCount + settingCount;
        const conceptIntroductionRhythm = this.perThousand(conceptCount, totalChars);

        const samples = this.selectInfoDensitySamples(sentences, properNounDensity, settingInjectionFrequency);

        const description = this.generateInfoDensityDescription(
            infoDensity, properNounDensity, settingInjectionFrequency, conceptIntroductionRhythm
        );

        return {
            infoDensity: this.round2(infoDensity),
            properNounDensity,
            settingInjectionFrequency,
            conceptIntroductionRhythm,
            description,
            samples,
            status: 'complete',
        };
    }

    private generateInfoDensityDescription(
        info: number, properNoun: number, setting: number, concept: number
    ): string {
        const parts: string[] = [];
        if (info > 0.7) {
            parts.push('信息密度高');
        } else if (info < 0.4) {
            parts.push('信息密度偏低');
        } else {
            parts.push('信息密度适中');
        }
        if (properNoun > 5) {
            parts.push(`专有名词密集（${properNoun.toFixed(1)}/千字）`);
        }
        if (setting > 2) {
            parts.push(`设定植入频繁（${setting.toFixed(1)}/千字）`);
        }
        if (concept > 8) {
            parts.push('概念引入节奏快');
        } else if (concept < 2) {
            parts.push('概念引入节奏舒缓');
        }
        return parts.join('，') + '。';
    }

    private selectInfoDensitySamples(sentences: string[], properNounDensity: number, settingDensity: number): string[] {
        const samples: string[] = [];
        if (settingDensity > 0.5) {
            const settingS = sentences.find(s => this.containsAny(s, this.settingInjectionSet));
            if (settingS) samples.push(this.truncateSample(settingS));
        }
        if (properNounDensity > 2 && samples.length < 2) {
            const properS = sentences.find(s => this.containsAny(s, this.properNounSet));
            if (properS) samples.push(this.truncateSample(properS));
        }
        if (samples.length < 2 && sentences.length > 0) {
            samples.push(this.truncateSample(sentences[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 9: DialogueStatsV2 — 对话（V1 升级）
    // ============================================================

    private analyzeDialogue(
        text: string,
        v1: StyleAnalysisResult,
        totalChars: number
    ): DialogueStatsV2 {
        const v1Dialogue = v1.dialogueStyle;
        const dialogues = this.extractDialogues(text);

        // 对话风格标签
        const dialogueStyleTag = this.determineDialogueStyleTag(v1Dialogue);

        // 台词个性化程度：基于对话长度方差和提示词多样性
        const personalizationLevel = this.calculatePersonalizationLevel(dialogues, v1Dialogue);

        // 潜台词比例：含反问、省略、暗指的对话占比
        const subtextRatio = this.calculateSubtextRatio(dialogues);

        const samples = this.selectDialogueSamples(dialogues);

        const description = this.generateDialogueDescription(
            v1Dialogue.dialogueRatio, dialogueStyleTag, personalizationLevel, subtextRatio
        );

        return {
            dialogueRatio: v1Dialogue.dialogueRatio,
            dialogueStyleTag,
            personalizationLevel,
            subtextRatio,
            description,
            samples,
            status: 'complete',
        };
    }

    private determineDialogueStyleTag(v1Dialogue: { avgDialogueLength: number; lengthDistribution: { short: number; medium: number; long: number } }): string {
        if (v1Dialogue.avgDialogueLength < 8) return '简练';
        if (v1Dialogue.avgDialogueLength > 25) return '啰嗦';
        if (v1Dialogue.lengthDistribution.short > 0.6) return '干脆';
        if (v1Dialogue.lengthDistribution.long > 0.4) return '冗长';
        return '适中';
    }

    private calculatePersonalizationLevel(dialogues: string[], v1Dialogue: { promptWordPreference: Array<{ word: string; count: number }> }): number {
        if (dialogues.length < 2) return 0;
        // 基于对话长度方差
        const lengths = dialogues.map(d => d.length);
        const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / lengths.length;
        const stdDev = Math.sqrt(variance);
        // 标准化到 0-1
        const lengthDiversity = Math.min(1, stdDev / 15);
        // 提示词多样性
        const promptDiversity = v1Dialogue.promptWordPreference.length > 5 ? 0.5 : 0.3;
        return this.round2(Math.min(1, lengthDiversity * 0.6 + promptDiversity));
    }

    private calculateSubtextRatio(dialogues: string[]): number {
        if (dialogues.length === 0) return 0;
        const subtextMarkers = ['...', '……', '？', '?', '难道', '岂', '何必', '何不'];
        let subtextCount = 0;
        for (const d of dialogues) {
            if (subtextMarkers.some(m => d.includes(m))) {
                subtextCount++;
            }
        }
        return this.round2(subtextCount / dialogues.length);
    }

    private generateDialogueDescription(
        ratio: number, tag: string, personalization: number, subtext: number
    ): string {
        const parts: string[] = [];
        if (ratio > 0.4) {
            parts.push(`对话占比高（${(ratio * 100).toFixed(0)}%）`);
        } else if (ratio < 0.1) {
            parts.push('对话较少');
        }
        parts.push(`对话风格${tag}`);
        if (personalization > 0.6) {
            parts.push('台词个性化强');
        } else if (personalization < 0.3) {
            parts.push('台词较为雷同');
        }
        if (subtext > 0.3) {
            parts.push(`潜台词丰富（${(subtext * 100).toFixed(0)}%）`);
        }
        return parts.join('，') + '。';
    }

    private selectDialogueSamples(dialogues: string[]): string[] {
        const samples: string[] = dialogues.slice(0, 3).map(d => this.truncateSample(d));
        return samples;
    }

    // ============================================================
    // 维度 10: DescriptionStats — 描写（新增）
    // ============================================================

    private analyzeDescription(
        text: string,
        paragraphs: string[],
        totalChars: number
    ): DescriptionStats {
        // 环境描写占比
        const envKeywords = ['天空', '大地', '山川', '河流', '森林', '城市', '街道', '房间', '宫殿', '山谷',
            '阳光', '月光', '星光', '风雨', '雷电', '云雾', '花草', '树木', '建筑', '景色'];
        const envSet = new Set(envKeywords);
        const envCount = this.countKeywords(text, envSet);
        const environmentDescriptionRatio = totalChars > 0
            ? Math.min(1, envCount * 10 / totalChars)
            : 0;

        // 细节密度：形容词+副词密度
        const adjCount = (text.match(/美丽|漂亮|英俊|高大|矮小|强壮|聪明|善良|勇敢|温柔|冷酷|热情|开心|难过|愤怒|平静|紧张|华丽|朴素|豪华|简陋|干净|肮脏|明亮|黑暗/g) || []).length;
        const advCount = (text.match(/非常|十分|极其|格外|特别|相当|很|最|更|比较|忽然|突然|渐渐|慢慢|缓缓|迅速|快速|立即|马上|顿时|轻轻地|悄悄地|默默地/g) || []).length;
        const detailDensity = this.perHundred(adjCount + advCount, totalChars);

        // 感官描写分布
        const visualCount = this.countKeywords(text, this.visualSet);
        const auditoryCount = this.countKeywords(text, this.auditorySet);
        const tactileCount = this.countKeywords(text, this.tactileSet);
        const olfactoryCount = this.countKeywords(text, this.olfactorySet);
        const gustatoryCount = this.countKeywords(text, this.gustatorySet);
        const sensoryTotal = visualCount + auditoryCount + tactileCount + olfactoryCount + gustatoryCount || 1;
        const sensoryDistribution = {
            visual: this.round2(visualCount / sensoryTotal),
            auditory: this.round2(auditoryCount / sensoryTotal),
            tactile: this.round2(tactileCount / sensoryTotal),
            olfactory: this.round2(olfactoryCount / sensoryTotal),
            gustatory: this.round2(gustatoryCount / sensoryTotal),
        };

        const samples = this.selectDescriptionSamples(paragraphs, sensoryDistribution);

        const description = this.generateDescriptionDescription(
            environmentDescriptionRatio, detailDensity, sensoryDistribution
        );

        return {
            environmentDescriptionRatio: this.round2(environmentDescriptionRatio),
            detailDensity,
            sensoryDistribution,
            description,
            samples,
            status: 'complete',
        };
    }

    private generateDescriptionDescription(
        envRatio: number, detail: number,
        sensory: { visual: number; auditory: number; tactile: number; olfactory: number; gustatory: number }
    ): string {
        const parts: string[] = [];
        if (envRatio > 0.3) {
            parts.push('环境描写丰富');
        } else if (envRatio < 0.05) {
            parts.push('环境描写较少');
        }
        if (detail > 5) {
            parts.push(`细节密度高（${detail.toFixed(1)}/百字）`);
        }
        const dominantSense = Object.entries(sensory).sort((a, b) => b[1] - a[1])[0];
        const senseNames: Record<string, string> = {
            visual: '视觉', auditory: '听觉', tactile: '触觉', olfactory: '嗅觉', gustatory: '味觉',
        };
        if (dominantSense && dominantSense[1] > 0.5) {
            parts.push(`以${senseNames[dominantSense[0]]}描写为主`);
        } else if (dominantSense && dominantSense[1] > 0) {
            parts.push('多感官描写并存');
        }
        return parts.join('，') + '。';
    }

    private selectDescriptionSamples(
        paragraphs: string[],
        sensory: { visual: number; auditory: number; tactile: number; olfactory: number; gustatory: number }
    ): string[] {
        const samples: string[] = [];
        // 找含感官词的段落
        const envKeywords = ['天空', '大地', '山川', '河流', '森林', '阳光', '月光', '景色'];
        const envPara = paragraphs.find(p => envKeywords.some(k => p.includes(k)));
        if (envPara) samples.push(this.truncateSample(envPara));
        // 找含视觉词的段落
        if (sensory.visual > 0.3) {
            const visualPara = paragraphs.find(p => VISUAL_WORDS.slice(0, 10).some(k => p.includes(k)));
            if (visualPara && samples.length < 2) samples.push(this.truncateSample(visualPara));
        }
        if (samples.length < 2 && paragraphs.length > 0) {
            samples.push(this.truncateSample(paragraphs[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 11: NarrationStats — 叙事（V1 升级）
    // ============================================================

    private analyzeNarration(
        text: string,
        v1: StyleAnalysisResult,
        paragraphs: string[],
        totalChars: number
    ): NarrationStats {
        // 叙事速度：每千字推进的剧情节点数（基于段落+场景切换）
        const sceneSwitchCount = this.countKeywords(text, this.sceneSwitchSet);
        const narrationSpeed = this.perThousand(paragraphs.length + sceneSwitchCount, totalChars);

        // 时间跳跃频率
        const timeJumpCount = this.countKeywords(text, this.timeJumpSet);
        const timeJumpFrequency = this.perThousand(timeJumpCount, totalChars);

        // 场景切换频率
        const sceneSwitchFrequency = this.perThousand(sceneSwitchCount, totalChars);

        const samples = this.selectNarrationSamples(paragraphs, timeJumpFrequency, sceneSwitchFrequency);

        const description = this.generateNarrationDescription(
            narrationSpeed, timeJumpFrequency, sceneSwitchFrequency, v1.paragraphStructure
        );

        return {
            narrationSpeed,
            timeJumpFrequency,
            sceneSwitchFrequency,
            description,
            samples,
            status: 'complete',
        };
    }

    private generateNarrationDescription(
        speed: number, timeJump: number, sceneSwitch: number,
        v1Paragraph: { avgParagraphLength: number; lengthDistribution: { short: number; medium: number; long: number; veryLong: number } }
    ): string {
        const parts: string[] = [];
        if (speed > 10) {
            parts.push('叙事速度快');
        } else if (speed < 3) {
            parts.push('叙事节奏舒缓');
        }
        if (timeJump > 2) {
            parts.push(`时间跳跃频繁（${timeJump.toFixed(1)}/千字）`);
        }
        if (sceneSwitch > 1) {
            parts.push(`场景切换较多（${sceneSwitch.toFixed(1)}/千字）`);
        }
        if (v1Paragraph.lengthDistribution.short > 0.5) {
            parts.push('段落短小，节奏明快');
        } else if (v1Paragraph.lengthDistribution.veryLong > 0.3) {
            parts.push('段落冗长');
        }
        return parts.join('，') + '。';
    }

    private selectNarrationSamples(paragraphs: string[], timeJumpFreq: number, sceneSwitchFreq: number): string[] {
        const samples: string[] = [];
        if (timeJumpFreq > 0.5) {
            const jumpPara = paragraphs.find(p => this.containsAny(p, this.timeJumpSet));
            if (jumpPara) samples.push(this.truncateSample(jumpPara));
        }
        if (sceneSwitchFreq > 0.5 && samples.length < 2) {
            const switchPara = paragraphs.find(p => this.containsAny(p, this.sceneSwitchSet));
            if (switchPara) samples.push(this.truncateSample(switchPara));
        }
        if (samples.length < 2 && paragraphs.length > 0) {
            samples.push(this.truncateSample(paragraphs[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 维度 12: LanguageTextureStats — 语言质感（V1 升级）
    // ============================================================

    private analyzeLanguageTexture(
        text: string,
        v1: StyleAnalysisResult,
        sentences: string[],
        totalChars: number
    ): LanguageTextureStats {
        const v1WordPref = v1.wordPreference;

        // 口语化程度（从 V1 复用）
        const colloquialLevel = v1WordPref.colloquialismLevel;

        // 书面化程度（1 - 口语化程度）
        const writtenLevel = this.round2(1 - colloquialLevel);

        // 古风化程度
        const archaismCount = this.countKeywords(text, this.archaismSet);
        const totalChineseChars = this.countChineseChars(text);
        const archaismLevel = totalChineseChars > 0
            ? Math.min(1, archaismCount / (totalChineseChars * 0.1))
            : 0;

        // 地域特色词检测
        const regionalCount = this.countKeywords(text, this.regionalSet);
        const regionalWordDensity = this.perThousand(regionalCount, totalChars);

        const samples = this.selectLanguageTextureSamples(sentences, archaismLevel, regionalWordDensity);

        const description = this.generateLanguageTextureDescription(
            writtenLevel, colloquialLevel, archaismLevel, regionalWordDensity
        );

        return {
            writtenLevel,
            colloquialLevel,
            archaismLevel: this.round2(archaismLevel),
            regionalWordDensity,
            description,
            samples,
            status: 'complete',
        };
    }

    private generateLanguageTextureDescription(
        written: number, colloquial: number, archaism: number, regional: number
    ): string {
        const parts: string[] = [];
        if (written > 0.7) {
            parts.push('语言书面化');
        } else if (colloquial > 0.5) {
            parts.push('语言口语化');
        } else {
            parts.push('语言雅俗共赏');
        }
        if (archaism > 0.3) {
            parts.push('古风韵味浓厚');
        } else if (archaism > 0.1) {
            parts.push('偶有古风用词');
        }
        if (regional > 2) {
            parts.push(`地域特色明显（${regional.toFixed(1)}/千字）`);
        }
        return parts.join('，') + '。';
    }

    private selectLanguageTextureSamples(sentences: string[], archaismLevel: number, regionalDensity: number): string[] {
        const samples: string[] = [];
        if (archaismLevel > 0.1) {
            const archaismS = sentences.find(s => this.containsAny(s, this.archaismSet));
            if (archaismS) samples.push(this.truncateSample(archaismS));
        }
        if (regionalDensity > 1 && samples.length < 2) {
            const regionalS = sentences.find(s => this.containsAny(s, this.regionalSet));
            if (regionalS) samples.push(this.truncateSample(regionalS));
        }
        if (samples.length < 2 && sentences.length > 0) {
            samples.push(this.truncateSample(sentences[0]));
        }
        return samples.slice(0, 3);
    }

    // ============================================================
    // 工具方法
    // ============================================================

    private getEmptyResult(): StyleAnalysisResultV2 {
        const emptyV1: StyleAnalysisResult = {
            sentenceRhythm: {
                avgSentenceLength: 0, medianSentenceLength: 0, stdSentenceLength: 0,
                sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
                lengthDistribution: { short: 0, medium: 0, long: 0 }
            },
            wordPreference: {
                topWords: [],
                posPreference: { verb: 0, adjective: 0, adverb: 0 },
                modalParticles: { total: 0, perThousand: 0, topParticles: [] },
                idiomDensity: 0, colloquialismLevel: 0
            },
            narrativeStyle: {
                perspective: 'third_person_omniscient', perspectiveConfidence: 0,
                descriptionRatio: { appearance: 0, environment: 0, action: 0, psychology: 0, total: 0 },
                narrationRatio: 0, dialogueRatio: 0
            },
            rhetoric: { metaphor: 0, personification: 0, parallelism: 0, rhetoricalQuestion: 0, hyperbole: 0, antithesis: 0, total: 0, perThousand: 0 },
            dialogueStyle: {
                dialogueRatio: 0, promptWordPreference: [], avgDialogueLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0 }
            },
            paragraphStructure: {
                avgParagraphLength: 0, medianParagraphLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
                openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 }
            },
            overallStyle: { primaryStyle: '未知', confidence: 0, styleScores: {} },
            stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 }
        };

        const emptyFeatures: StyleFingerprintFeaturesV2 = {
            rhythm: {
                sentenceLengthDistribution: { short: 0, medium: 0, long: 0 },
                avgSentenceLength: 0, shortSentenceRatio: 0, punctuationDensity: 0,
                paragraphDensity: 0, pauseFrequency: 0, description: '', samples: [], status: 'pending'
            },
            sentencePattern: {
                inversionDensity: 0, ellipsisDensity: 0, parallelismDensity: 0,
                rhetoricalQuestionRatio: 0, clauseNestingDepth: 0,
                description: '', samples: [], status: 'pending'
            },
            wordChoice: {
                commonWordRatio: 0, rareWordRatio: 0, functionWordRatio: 0,
                wordLengthDistribution: { len1: 0, len2: 0, len3: 0, len4plus: 0 },
                fourCharIdiomDensity: 0, description: '', samples: [], status: 'pending'
            },
            rhetoric: {
                metaphorDensity: 0, personificationDensity: 0, hyperboleDensity: 0,
                parallelismDensity: 0, antithesisDensity: 0, synesthesiaDensity: 0,
                description: '', samples: [], status: 'pending'
            },
            perspective: {
                personDistribution: { first: 0, second: 0, third: 0 },
                perspectiveSwitchFrequency: 0,
                narrativeDistance: { far: 0, medium: 0, near: 0 },
                description: '', samples: [], status: 'pending'
            },
            emotion: {
                emotionalTone: '', emotionalFluctuationFrequency: 0,
                emotionalIntensityDistribution: { low: 0, medium: 0, high: 0 },
                valenceRatio: { positive: 0, negative: 0, neutral: 0 },
                description: '', samples: [], status: 'pending'
            },
            tension: {
                suspenseDensity: 0, conflictFrequency: 0, turningPointDensity: 0,
                foreshadowingMarkerCount: 0, climaxDistribution: { early: 0, middle: 0, late: 0 },
                description: '', samples: [], status: 'pending'
            },
            infoDensity: {
                infoDensity: 0, properNounDensity: 0, settingInjectionFrequency: 0,
                conceptIntroductionRhythm: 0, description: '', samples: [], status: 'pending'
            },
            dialogue: {
                dialogueRatio: 0, dialogueStyleTag: '', personalizationLevel: 0,
                subtextRatio: 0, description: '', samples: [], status: 'pending'
            },
            description: {
                environmentDescriptionRatio: 0, detailDensity: 0,
                sensoryDistribution: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
                description: '', samples: [], status: 'pending'
            },
            narration: {
                narrationSpeed: 0, timeJumpFrequency: 0, sceneSwitchFrequency: 0,
                description: '', samples: [], status: 'pending'
            },
            languageTexture: {
                writtenLevel: 0, colloquialLevel: 0, archaismLevel: 0, regionalWordDensity: 0,
                description: '', samples: [], status: 'pending'
            },
        };

        return {
            features: emptyFeatures,
            stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 },
            v1Result: emptyV1,
        };
    }

    private splitParagraphs(text: string): string[] {
        return text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
    }

    private splitSentences(text: string): string[] {
        const sentences: string[] = [];
        const regex = /[^。！？…!?]+[。！？…!?]+/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const s = match[0].trim();
            if (s.length > 0) sentences.push(s);
        }
        if (sentences.length === 0 && text.trim().length > 0) {
            sentences.push(text.trim());
        }
        return sentences;
    }

    private extractDialogues(text: string): string[] {
        const dialogues: string[] = [];
        const quotePairs = [
            { start: '「', end: '」' }, { start: '『', end: '』' },
            { start: '"', end: '"' }, { start: '\u201C', end: '\u201D' },
            { start: '\u2018', end: '\u2019' },
        ];
        for (const pair of quotePairs) {
            let startIdx = 0;
            while (startIdx < text.length) {
                const openIdx = text.indexOf(pair.start, startIdx);
                if (openIdx === -1) break;
                const closeIdx = text.indexOf(pair.end, openIdx + 1);
                if (closeIdx === -1) break;
                const content = text.slice(openIdx + 1, closeIdx);
                if (content.length > 0) dialogues.push(content);
                startIdx = closeIdx + 1;
            }
        }
        return dialogues;
    }

    private detectParallelism(sentences: string[]): number {
        let count = 0;
        for (let i = 0; i < sentences.length - 2; i++) {
            const start1 = sentences[i].slice(0, 2);
            const start2 = sentences[i + 1].slice(0, 2);
            const start3 = sentences[i + 2].slice(0, 2);
            if (start1 === start2 && start2 === start3 && isChineseChar(start1[0] || '')) {
                count++;
            }
        }
        return count;
    }

    private countKeywords(text: string, keywordSet: Set<string>): number {
        // 优先使用预计算结果（analyze 方法中已预计算所有词表）
        if (this._precomputedCounts && this._precomputedCounts.has(keywordSet)) {
            return this._precomputedCounts.get(keywordSet)!;
        }

        // 降级：分离单字词和多字词，单字词用一次扫描统计
        const singleCharSet: Set<string> = new Set();
        const multiCharWords: string[] = [];
        for (const word of keywordSet) {
            if (word.length === 0) continue;
            if (word.length === 1) singleCharSet.add(word);
            else multiCharWords.push(word);
        }

        let count = 0;
        // 单字词：一次遍历统计所有单字词（O(n)，不论有多少个单字词）
        if (singleCharSet.size > 0) {
            for (let i = 0; i < text.length; i++) {
                if (singleCharSet.has(text[i])) count++;
            }
        }
        // 多字词：用缓存的合并正则一次匹配（替代逐个 indexOf 循环）
        if (multiCharWords.length > 0) {
            let regex = this._regexCache.get(keywordSet);
            if (!regex) {
                // 按长度降序，优先匹配长词（避免短词截断长词）
                multiCharWords.sort((a, b) => b.length - a.length);
                const pattern = multiCharWords.map(w => this.escapeRegex(w)).join('|');
                regex = new RegExp(pattern, 'g');
                this._regexCache.set(keywordSet, regex);
            }
            regex.lastIndex = 0;
            const matches = text.match(regex);
            if (matches) count += matches.length;
        }
        return count;
    }

    private countKeywordsInText(text: string, keywordSet: Set<string>): number {
        return this.countKeywords(text, keywordSet);
    }

    private containsAny(text: string, keywordSet: Set<string>): boolean {
        for (const word of keywordSet) {
            if (word.length === 0) continue;
            if (text.includes(word)) return true;
        }
        return false;
    }

    private countChineseChars(text: string): number {
        // 大文本缓存（同一次 analyze 的 text 不变）
        if (text === this._cachedText && this._cachedChineseCharCount >= 0) {
            return this._cachedChineseCharCount;
        }

        let count = 0;
        for (let i = 0; i < text.length; i++) {
            if (isChineseChar(text[i])) count++;
        }
        this._cachedText = text;
        this._cachedChineseCharCount = count;
        return count;
    }

    private isChineseChar(char: string): boolean {
        if (!char) return false;
        const code = char.charCodeAt(0);
        return code >= 0x4E00 && code <= 0x9FFF;
    }

    private escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private perThousand(count: number, totalChars: number): number {
        return this.round2((count / Math.max(totalChars, 1)) * 1000);
    }

    private perHundred(count: number, totalChars: number): number {
        return this.round2((count / Math.max(totalChars, 1)) * 100);
    }

    private truncateSample(text: string, minLen: number = 50, maxLen: number = 200): string {
        const trimmed = text.trim();
        if (trimmed.length <= maxLen) {
            // 不足 minLen 也不补齐，保持原文
            return trimmed;
        }
        return trimmed.slice(0, maxLen);
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }
}
