/**
 * semantic-analyzer.ts — 语义分析工具模块
 * 
 * 提供基于规则的中文语义分析能力：
 * - 词性标注（动词、名词、形容词、副词、虚词分类）
 * - 编辑距离算法（Levenshtein distance）进行字符级语义相似度匹配
 * - 语境分析（上下文判断实体类型）
 * - 语义等价实体合并（同指消解）
 * 
 * 所有实现均基于规则，不依赖外部 NLP 库。
 */

import { createLogger } from '../shared/logger';

const log = createLogger('SemanticAnalyzer');

export type WordType = 'noun' | 'verb' | 'adjective' | 'adverb' | 'function' | 'unknown';

export interface WordAnalysis {
    word: string;
    type: WordType;
    confidence: number;
    subType?: string;
}

export interface SemanticMatchResult {
    similarity: number;
    normalizedWord1: string;
    normalizedWord2: string;
    matched: boolean;
    matchType: 'exact' | 'alias' | 'partial' | 'semantic';
}

export interface EntityGroup {
    canonicalName: string;
    aliases: string[];
    confidence: number;
    count: number;
}

const NOUN_SUFFIXES = new Set([
    '人', '者', '师', '生', '士', '家', '客', '徒', '子', '君',
    '王', '皇', '帝', '侯', '相', '将', '帅', '臣', '官', '民',
    '父', '母', '兄', '弟', '姐', '妹', '夫', '妻', '儿', '女',
    '剑', '刀', '枪', '戟', '斧', '钺', '钩', '叉', '鞭', '锏',
    '锤', '抓', '镗', '槊', '棍', '棒', '矛', '盾', '弓', '箭',
    '玉佩', '珠', '宝', '戒', '戒指', '镯', '链', '坠', '簪',
    '瓶', '葫芦', '鼎', '炉', '塔', '印', '玺', '令', '牌', '符',
    '丹', '药', '草', '花', '果', '酒', '茶', '书', '图', '卷',
    '衣', '袍', '甲', '盔', '靴', '扇', '伞', '琴', '棋', '画',
    '诀', '功', '法', '术', '式', '典', '经', '谱', '录', '秘',
    '心法', '秘法', '神功', '绝技', '绝招', '武学', '武道', '剑道',
    '秘境', '禁地', '传说', '神话', '上古', '远古', '太古', '洪荒',
    '仙界', '魔界', '妖界', '鬼界', '神界', '人界', '凡间', '世俗',
    '大阵', '结界', '禁制', '封印', '枷锁', '诅咒', '传承', '遗迹',
    '预言', '约定', '誓言', '承诺', '赌约', '宿命', '前世', '今生',
    '轮回', '转世', '重生', '穿越', '系统', '任务', '大劫', '浩劫',
    '灾变', '乱世', '大战', '决战', '终局', '末日', '城', '镇', '村',
    '山', '河', '湖', '海', '林', '原', '沙漠', '平原', '峡谷', '洞穴',
    '楼', '阁', '殿', '堂', '亭', '台', '轩', '榭', '斋', '院',
    '门', '窗', '墙', '瓦', '梁', '柱', '阶', '梯', '房', '屋',
    '车', '马', '船', '轿', '骑', '乘', '舟', '筏', '艇', '舰',
    '鸟', '兽', '虫', '鱼', '龙', '凤', '虎', '狼', '豹', '熊',
    '金', '银', '铜', '铁', '玉', '石', '木', '布', '丝', '皮',
    '族', '派', '宗', '教', '会', '盟', '帮', '团', '社',
    '国', '邦', '朝', '代', '世', '纪', '年', '载', '岁',
]);

const VERB_SUFFIXES = new Set([
    '了', '过', '着', '化', '变', '成', '为',
]);

const VERB_WORDS = new Set([
    '修炼', '修练', '修行', '战斗', '突破', '渡劫', '飞升', '重生', '穿越', '进化',
    '思考', '回忆', '想象', '决定', '希望', '害怕', '怀疑', '相信',
    '说话', '询问', '回答', '命令', '请求', '拒绝', '说服', '解释',
    '攻击', '防守', '逃跑', '追逐', '寻找', '发现', '行动', '帮助',
    '伤害', '杀死', '复活', '成长', '变强', '变弱', '出现', '消失',
    '获得', '失去', '拥有', '使用', '学习', '领悟', '创造', '毁灭',
    '改变', '进化', '到达', '离开', '返回', '等待', '出发',
    '做', '作', '搞', '弄', '打', '拍', '敲', '踢', '踹', '踩',
    '踏', '撞', '推', '拉', '拽', '扯', '拖', '掀', '揭', '盖',
    '遮', '掩', '闭', '开', '关', '合', '启', '封', '锁', '解',
    '放', '收', '拿', '取', '提', '拎', '扛', '背', '抱', '搂',
    '抓', '握', '举', '挥', '摇', '摆', '晃', '抖', '颤', '震',
    '动', '转', '旋', '走', '跑', '飞', '跳', '游', '爬', '滚',
    '翻', '跌', '摔', '吃', '喝', '吞', '咽', '嚼', '啃', '咬',
    '尝', '品', '啜', '说', '讲', '谈', '聊', '叙', '述', '道',
    '曰', '云', '言', '问', '答', '应', '对', '回', '复', '告',
    '诉', '禀', '报', '看', '瞧', '望', '瞅', '瞟', '瞥', '盯',
    '瞪', '瞄', '窥', '听', '闻', '聆', '嗅', '触', '摸', '捏',
    '想', '思', '念', '虑', '量', '忖', '度', '揣', '摩', '猜',
    '笑', '哭', '叹', '哼', '哈', '嘿', '嘻', '唉', '呜', '啊',
    '死', '活', '生', '灭', '亡', '存', '终', '始', '起', '止',
    '教', '授', '传', '导', '指', '点', '诲', '训', '诫',
    '爱', '恨', '喜', '怒', '哀', '乐', '悲', '欢', '忧', '愁',
    '怕', '慌', '忙', '急', '紧', '松', '闲', '累', '乏', '饿',
    '饱', '渴', '醉', '醒', '困', '倦', '冷', '热', '暖', '凉',
    '疼', '痛', '痒', '酸', '麻', '胀', '沉', '重', '轻', '飘',
]);

const ADJECTIVE_SUFFIXES = new Set([
    '的', '性', '型', '式', '风', '味', '感', '度',
]);

const ADJECTIVE_WORDS = new Set([
    '强大', '弱小', '美丽', '丑陋', '善良', '邪恶', '聪明', '愚蠢',
    '温暖', '寒冷', '明亮', '黑暗', '安静', '喧闹', '干净', '肮脏',
    '快乐', '悲伤', '愤怒', '惊讶', '恐惧', '兴奋', '平静', '紧张',
    '勇敢', '懦弱', '坚强', '软弱', '温柔', '粗暴', '谦虚', '骄傲',
    '诚实', '虚伪', '勤奋', '懒惰', '热情', '冷淡', '友好', '敌对',
    '亲密', '疏远', '信任', '怀疑', '希望', '绝望', '满足', '遗憾',
    '感激', '愧疚', '羞愧', '尴尬', '痛苦', '幸福', '孤独', '迷茫',
    '疲惫', '困倦', '轻松', '焦虑', '失落', '期待', '满意', '欣慰',
    '重要', '次要', '明显', '隐藏', '公开', '神秘', '危险', '安全',
    '容易', '困难', '简单', '顺利', '成功', '失败', '幸运', '不幸',
    '微弱', '强烈', '轻微', '光明', '丑陋', '可爱', '可怕',
    '普通', '平常', '一般', '特殊', '异常', '明显', '显然',
    '神秘', '神奇', '奇妙', '危险', '安全', '容易', '困难', '简单',
    '艰难', '艰苦', '幸运', '不幸', '倒霉', '强大', '弱小', '厉害',
]);

const ADVERB_PREFIXES = new Set([
    '不', '没', '很', '非常', '特别', '十分', '格外', '分外',
    '更', '更加', '越发', '愈', '愈发', '最', '极', '极其',
    '太', '过于', '过分', '稍', '稍微', '略微', '略',
    '甚', '颇为', '相当', '比较', '较为', '大概', '大约',
    '差不多', '几乎', '简直', '根本', '完全', '彻底',
    '绝对', '肯定', '一定', '必定', '必然', '务必',
    '千万', '万万', '切切', '实在', '确实', '的确',
    '真的', '真正', '其实', '事实上', '实际上',
    '果然', '居然', '竟然', '偏偏', '反倒', '反而',
    '突然', '忽然', '猛然', '骤然', '蓦地', '忽地',
    '渐渐', '逐渐', '逐步', '慢慢', '缓缓', '徐徐',
    '立即', '马上', '即刻', '立刻', '旋即', '当即',
    '终于', '最终', '到底', '终究', '终归', '总算',
    '刚刚', '才', '刚', '方才', '刚巧', '恰巧',
    '已经', '曾经', '早已', '早就', '始终', '一直',
    '经常', '时常', '常常', '往往', '总是', '老是',
    '偶尔', '有时', '不时', '间或', '时而',
    '从来', '向来', '一向', '历来', '素来',
    '永远', '永久',
]);

const ADVERB_WORDS = new Set([
    '突然', '忽然', '渐渐', '逐渐', '立即', '马上', '终于', '刚刚',
    '非常', '特别', '十分', '格外', '分外', '更加', '愈发', '极其',
]);

const FUNCTION_WORDS = new Set([
    '的', '了', '着', '过', '和', '与', '及', '或', '而', '且',
    '但', '却', '则', '虽', '然', '所', '为', '被', '把', '将',
    '从', '以', '对', '向', '到', '在', '于', '比', '因', '由',
    '让', '叫', '给', '使', '令', '之', '乎', '者', '也', '矣',
    '焉', '哉', '兮', '尔', '其', '此', '彼', '斯', '是', '乃',
    '即', '皆', '俱', '悉', '于', '诸', '众', '凡', '所', '何',
    '孰', '安', '焉', '谁', '哪', '啥', '怎', '奈', '岂', '奚',
    '胡', '曷', '罢了', '而已', '就是', '便是', '乃是', '却是',
    '也是', '都是', '总是', '不是', '不能', '不会', '不敢', '不要',
    '不用', '不必', '何须', '何妨', '可以', '可能', '能够', '足以',
    '得', '能', '会', '可', '该', '当', '须', '应', '需', '要',
    '个', '些', '等', '某', '各', '每', '另', '本', '此', '该',
    '这', '那', '这些', '那些', '这么', '那么', '这样', '那样',
    '什么', '怎么', '怎样', '如何', '为何', '何以', '因何',
    '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '百', '千', '万', '亿', '兆', '零', '半', '全', '整', '满',
    '上', '下', '左', '右', '前', '后', '里', '外', '中', '内',
    '东', '南', '西', '北', '东北', '西北', '东南', '西南',
    '春', '夏', '秋', '冬', '风', '霜', '雨', '雪', '雷', '电',
]);

const NAME_PREFIXES = new Set([
    '老', '小', '阿', '大', '二', '三', '四', '五', '六', '七',
    '八', '九', '十', '第', '前', '后', '中', '左', '右', '上',
    '下', '东', '南', '西', '北', '新', '旧', '高', '矮', '胖',
    '瘦', '长', '短', '黑', '白', '黄', '红', '绿',
]);

const SURNAMES = new Set([
    '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈',
    '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许',
    '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏',
    '陶', '姜', '戚', '谢', '邹', '喻', '柏', '水', '窦', '章',
    '云', '苏', '潘', '葛', '奚', '范', '彭', '郎', '鲁', '韦',
    '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳',
    '林', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡',
    '凌', '霍', '虞', '万', '支', '柯', '昝', '管', '卢', '莫',
    '尹', '姚', '邵', '湛', '汪', '祁', '毛', '狄', '米', '贝',
    '明', '臧', '计', '伏', '成', '戴', '谈', '宋', '茅', '庞',
    '熊', '纪', '舒', '屈', '项', '祝', '董', '梁', '杜', '阮',
    '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '危',
    '江', '童', '颜', '郭', '梅', '盛', '刁', '钟',
]);

const CULTIVATION_WORDS = new Set(['修炼', '修练', '修行', '修持']);

export class SemanticAnalyzer {
    /**
     * 分析单词的词性与置信度。
     *
     * @param word - 参数
     * @returns 词性分析
     */
    static analyzeWord(word: string): WordAnalysis {
        const normalized = word.trim();
        if (normalized.length === 0) {
            return { word, type: 'function', confidence: 0.99 };
        }

        if (FUNCTION_WORDS.has(normalized)) {
            return { word, type: 'function', confidence: 0.95 };
        }

        if (normalized.length === 1) {
            return { word, type: 'unknown', confidence: 0.3 };
        }

        if (ADVERB_WORDS.has(normalized)) {
            return { word, type: 'adverb', confidence: 0.9 };
        }

        if (ADVERB_PREFIXES.has(normalized)) {
            return { word, type: 'adverb', confidence: 0.85 };
        }

        if (VERB_WORDS.has(normalized)) {
            return { word, type: 'verb', confidence: 0.9 };
        }

        if (ADJECTIVE_WORDS.has(normalized)) {
            return { word, type: 'adjective', confidence: 0.9 };
        }

        if (this.isNoun(normalized)) {
            const subType = this.detectNounSubType(normalized);
            if (subType !== 'unknown') {
                return { word, type: 'noun', confidence: this.calculateNounConfidence(normalized), subType };
            }
            if (this.looksLikePersonName(normalized)) {
                return { word, type: 'noun', confidence: Math.max(this.calculateNounConfidence(normalized), 0.7), subType: 'character' };
            }
            return { word, type: 'noun', confidence: this.calculateNounConfidence(normalized), subType };
        }

        for (const suffix of VERB_SUFFIXES) {
            if (normalized.endsWith(suffix)) {
                return { word, type: 'verb', confidence: 0.7 };
            }
        }

        for (const suffix of ADJECTIVE_SUFFIXES) {
            if (normalized.endsWith(suffix)) {
                return { word, type: 'adjective', confidence: 0.7 };
            }
        }

        if (this.isVerb(normalized)) {
            return { word, type: 'verb', confidence: 0.6 };
        }

        if (this.isAdjective(normalized)) {
            return { word, type: 'adjective', confidence: 0.6 };
        }

        if (this.isAdverb(normalized)) {
            return { word, type: 'adverb', confidence: 0.6 };
        }

        return { word, type: 'unknown', confidence: 0.3 };
    }

    /**
     * 是否名词。
     *
     * @param word - 参数
     * @returns 布尔值
     */
    static isNoun(word: string): boolean {
        for (const suffix of NOUN_SUFFIXES) {
            if (word.endsWith(suffix)) {
                return true;
            }
        }

        if (word.length >= 2 && SURNAMES.has(word.charAt(0))) {
            if (word.length === 2 && this.isCommonSurname(word.charAt(0))) {
                return true;
            }
            if (word.length >= 3) {
                return true;
            }
        }

        if (/^[\u4e00-\u9fa5]{2,8}$/.test(word)) {
            return !VERB_WORDS.has(word) && !ADJECTIVE_WORDS.has(word);
        }

        return false;
    }

    /**
     * 是否动词。
     *
     * @param word - 参数
     * @returns 布尔值
     */
    static isVerb(word: string): boolean {
        const verbPatterns = [
            /^[修练演炼修研]+/,
            /^[战斗攻防杀]+/,
            /^[进退行走跑飞]+/,
            /^[吃喝睡休息]+/,
            /^[说讲谈问答]+/,
            /^[思考想念回忆]+/,
            /^[看听闻嗅触]+/,
            /^[哭笑叹喜怒悲]+/,
            /^[爱憎喜欢讨厌]+/,
            /^[生死存活]+/,
            /^[得到失去拥有]+/,
            /^[学习领悟掌握]+/,
            /^[创造毁灭破坏]+/,
            /^[改变变化转化]+/,
            /^[突破晋升降级]+/,
            /^[出现消失存在]+/,
            /^[决定选择放弃]+/,
            /^[帮助援助支援]+/,
            /^[伤害杀死毁灭]+/,
            /^[保护守卫防御]+/,
            /^[逃跑逃离撤退]+/,
            /^[追逐追赶追杀]+/,
            /^[寻找搜寻搜索]+/,
            /^[发现察觉注意]+/,
            /^[行动举动动作]+/,
            /^[命令指令吩咐]+/,
            /^[请求恳求祈求]+/,
            /^[拒绝推辞推却]+/,
            /^[接受接纳认可]+/,
            /^[背叛出卖反叛]+/,
            /^[忠诚忠心效忠]+/,
            /^[欺骗欺诈哄骗]+/,
            /^[隐瞒隐藏藏匿]+/,
            /^[揭露揭示暴露]+/,
            /^[计划谋划策划]+/,
            /^[执行实施实行]+/,
            /^[完成完结完毕]+/,
            /^[失败受挫失利]+/,
            /^[胜利成功取胜]+/,
            /^[挑战对决应战]+/,
            /^[合作协作配合]+/,
            /^[竞争竞赛角逐]+/,
            /^[谈判协商商议]+/,
            /^[交易买卖交换]+/,
            /^[赠送馈赠赠予]+/,
            /^[收取接收接纳]+/,
            /^[支付付款缴纳]+/,
            /^[赚取获得挣得]+/,
            /^[花费消耗耗费]+/,
            /^[节省节约]+/,
            /^[投资投入倾注]+/,
            /^[回报报答]+/,
            /^[欠债负债欠钱]+/,
            /^[还债偿还清偿]+/,
            /^[借贷借用借入]+/,
            /^[归还退还返还]+/,
            /^[租赁租用租借]+/,
            /^[购买购置选购]+/,
            /^[销售售卖出售]+/,
            /^[批发零售]+/,
            /^[拍卖竞拍]+/,
            /^[收购并购兼并]+/,
            /^[偷窃盗窃盗取]+/,
            /^[抢劫掠夺打劫]+/,
            /^[诈骗欺诈骗取]+/,
            /^[贪污腐败挪用]+/,
            /^[贿赂收买买通]+/,
            /^[走私私运偷运]+/,
            /^[逃税漏税偷税]+/,
            /^[犯罪违法作案]+/,
            /^[被捕被抓被擒]+/,
            /^[越狱逃脱逃走]+/,
            /^[审判裁决判决]+/,
            /^[惩罚惩处制裁]+/,
            /^[赦免宽恕免罪]+/,
            /^[释放放出]+/,
            /^[关押监禁囚禁]+/,
            /^[流放放逐驱逐]+/,
            /^[死刑处决处死]+/,
            /^[变成变为成为]+/,
            /^[保持维持]+/,
            /^[恢复复原]+/,
            /^[增加增多增长]+/,
            /^[减少变少缩减]+/,
            /^[提高提升升高]+/,
            /^[降低下降减少]+/,
            /^[扩大扩展扩张]+/,
            /^[缩小收缩缩减]+/,
            /^[增强加强强化]+/,
            /^[减弱削弱]+/,
            /^[加快加速提速]+/,
            /^[减慢减速]+/,
            /^[延长拉长]+/,
            /^[缩短变短]+/,
            /^[变宽加宽拓宽]+/,
            /^[变窄收窄]+/,
            /^[变高增高]+/,
            /^[变低降低]+/,
            /^[变重增重]+/,
            /^[变轻减重]+/,
            /^[变硬硬化固化]+/,
            /^[变软软化柔化]+/,
            /^[变热升温加热]+/,
            /^[变冷降温冷却]+/,
            /^[变亮增亮]+/,
            /^[变暗减弱]+/,
            /^[变清晰变清楚]+/,
            /^[变模糊变朦胧]+/,
            /^[变年轻变青春]+/,
            /^[变老变衰老]+/,
            /^[变强壮变健壮]+/,
            /^[变虚弱变衰弱]+/,
            /^[变聪明变睿智]+/,
            /^[变愚蠢变愚笨]+/,
            /^[变美丽变漂亮]+/,
            /^[变丑陋变难看]+/,
        ];

        for (const pattern of verbPatterns) {
            if (pattern.test(word)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 是否形容词。
     *
     * @param word - 参数
     * @returns 布尔值
     */
    static isAdjective(word: string): boolean {
        const adjPatterns = [
            /^(大|小|多|少|高|低|长|短|宽|窄|厚|薄|深|浅|远|近){1,2}/,
            /^(好|坏|美|丑|善|恶|真|假|对|错){1,2}/,
            /^(冷|热|暖|凉|温|冰|烫){1,2}/,
            /^(亮|暗|明|黑|白|红|黄|蓝|绿|紫|青|橙|灰){1,2}/,
            /^(软|硬|脆|韧|滑|糙|粘|松|紧){1,2}/,
            /^(清|浊|净|脏|乱|整|齐|密|疏|稀){1,2}/,
            /^(浓|淡|稠){1,2}/,
            /^(轻|重|沉|浮|稳){1,2}/,
            /^(静|闹|吵|响){1,2}/,
            /^(老|少|幼|稚|嫩|熟|生|新|旧|破){1,2}/,
            /^(精|粗|细|巧|笨|傻|聪|明|愚){1,2}/,
            /^(勇|怯|刚|柔|坚|弱|强|猛){1,2}/,
            /^(诚|虚|假|伪){1,2}/,
            /^(勤|懒|俭|奢|豪|爽|抠|吝){1,2}/,
            /^(快|慢|急|缓){1,2}/,
        ];

        for (const pattern of adjPatterns) {
            if (pattern.test(word)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 是否副词。
     *
     * @param word - 参数
     * @returns 布尔值
     */
    static isAdverb(word: string): boolean {
        const adverbPatterns = [
            /^(很|非常|特别|十分|格外|分外)$/,
            /^(更|更加|越发|愈|愈发)$/,
            /^(最|极|极其)$/,
            /^(太|过于|过分)$/,
            /^(稍|稍微|略微|略)$/,
            /^(甚|颇为|相当|比较|较为)$/,
            /^(大概|大约|差不多|几乎|简直)$/,
            /^(根本|完全|彻底|绝对|肯定)$/,
            /^(一定|必定|必然|务必|千万|万万)$/,
            /^(实在|确实|的确|真的|真正)$/,
            /^(其实|事实上|实际上)$/,
            /^(果然|居然|竟然|偏偏|反倒|反而)$/,
            /^(突然|忽然|猛然|骤然|蓦地|忽地)$/,
            /^(渐渐|逐渐|逐步|慢慢|缓缓|徐徐)$/,
            /^(立即|马上|即刻|立刻|旋即|当即)$/,
            /^(终于|最终|到底|终究|终归|总算)$/,
            /^(刚刚|才|刚|方才|刚巧|恰巧)$/,
            /^(已经|曾经|早已|早就|始终|一直)$/,
            /^(经常|时常|常常|往往|总是|老是)$/,
            /^(偶尔|有时|不时|间或|时而)$/,
            /^(从来|向来|一向|历来|素来)$/,
            /^(永远|永久)$/,
        ];

        for (const pattern of adverbPatterns) {
            if (pattern.test(word)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 名词置信度。
     *
     * @param word - 参数
     * @returns 置信度
     */
    static calculateNounConfidence(word: string): number {
        let confidence = 0.5;

        if (word.length >= 2) {
            confidence += 0.1;
        }
        if (word.length >= 3) {
            confidence += 0.1;
        }

        for (const suffix of NOUN_SUFFIXES) {
            if (word.endsWith(suffix)) {
                confidence += 0.2;
                break;
            }
        }

        if (SURNAMES.has(word.charAt(0)) && word.length >= 2) {
            confidence += 0.15;
        }

        if (/^[\u4e00-\u9fa5]{2,8}$/.test(word)) {
            confidence += 0.05;
        }

        return Math.min(1, confidence);
    }

    /**
     * 动词置信度。
     *
     * @param word - 参数
     * @returns 置信度
     */
    static calculateVerbConfidence(word: string): number {
        let confidence = 0.5;

        if (VERB_WORDS.has(word)) {
            confidence = 0.9;
        } else {
            for (const suffix of VERB_SUFFIXES) {
                if (word.endsWith(suffix)) {
                    confidence += 0.3;
                    break;
                }
            }
        }

        return Math.min(1, confidence);
    }

    /**
     * 形容词置信度。
     *
     * @param word - 参数
     * @returns 置信度
     */
    static calculateAdjectiveConfidence(word: string): number {
        let confidence = 0.5;

        if (ADJECTIVE_WORDS.has(word)) {
            confidence = 0.9;
        } else {
            for (const suffix of ADJECTIVE_SUFFIXES) {
                if (word.endsWith(suffix)) {
                    confidence += 0.3;
                    break;
                }
            }
        }

        return Math.min(1, confidence);
    }

    /**
     * 副词置信度。
     *
     * @param word - 参数
     * @returns 置信度
     */
    static calculateAdverbConfidence(word: string): number {
        let confidence = 0.5;

        if (ADVERB_WORDS.has(word) || ADVERB_PREFIXES.has(word)) {
            confidence = 0.9;
        }

        return Math.min(1, confidence);
    }

    /**
     * 名词子类型（人名/地名等）。
     *
     * @param word - 参数
     * @returns 子类型
     */
    static detectNounSubType(word: string): string {
        const itemSuffixes = ['玉佩', '戒指', '葫芦',
            '剑', '刀', '枪', '戟', '斧', '钺', '钩', '叉', '鞭', '锏',
            '锤', '抓', '镗', '槊', '棍', '棒', '矛', '盾', '弓', '箭',
            '珠', '宝', '戒', '镯', '链', '坠', '簪',
            '瓶', '鼎', '炉', '塔', '印', '玺', '令', '牌', '符',
            '丹', '药', '草', '花', '果', '酒', '茶', '书', '图', '卷',
            '衣', '袍', '甲', '盔', '靴', '扇', '伞', '琴', '棋', '画'];

        const skillSuffixes = ['心法', '秘法', '神功', '绝技', '绝招', '武学', '武道', '剑道', '大挪移',
            '诀', '功', '法', '术', '式', '典', '经', '谱', '录', '秘'];

        const settingSuffixes = ['秘境', '禁地', '遗迹', '鬼界', '龙宫', '雷音寺',
            '沙漠', '平原', '峡谷', '洞穴', '仙界', '魔界', '妖界', '神界', '人界', '凡间', '世俗',
            '城', '镇', '村', '山', '河', '湖', '海',
            '楼', '阁', '殿', '堂', '亭', '台', '轩', '榭', '斋', '院'];

        const eventSuffixes = ['预言', '约定', '誓言', '承诺', '赌约', '宿命', '大劫', '浩劫',
            '灾变', '乱世', '大战', '决战', '终局', '末日', '传承', '轮回', '转世',
            '之战', '之劫', '之变'];

        const orgSuffixes = ['联盟', '组织', '教会', '家族', '山庄', '城堡',
            '族', '派', '门', '宗', '教', '会', '盟', '帮', '团', '社'];

        const charSuffixes = ['人', '者', '师', '生', '士', '家', '客', '徒', '子', '君',
            '王', '皇', '帝', '侯', '相', '将', '帅', '臣', '官', '民',
            '父', '母', '兄', '弟', '姐', '妹', '夫', '妻', '儿', '女'];

        const allSuffixChecks: { suffixes: string[], subType: string }[] = [
            { suffixes: itemSuffixes, subType: 'item' },
            { suffixes: skillSuffixes, subType: 'skill' },
            { suffixes: settingSuffixes, subType: 'setting' },
            { suffixes: eventSuffixes, subType: 'event' },
            { suffixes: orgSuffixes, subType: 'organization' },
            { suffixes: charSuffixes, subType: 'character' },
        ];

        for (const { suffixes, subType } of allSuffixChecks) {
            const multiChar = suffixes.filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
            for (const suffix of multiChar) {
                if (word.endsWith(suffix)) return subType;
            }
        }

        for (const { suffixes, subType } of allSuffixChecks) {
            const singleChar = suffixes.filter(s => s.length === 1);
            for (const suffix of singleChar) {
                if (word.endsWith(suffix)) {
                    if (word.length === 2 && SURNAMES.has(word.charAt(0))) {
                        const strongOrgSuffixes = ['族', '派', '门', '宗', '教', '会', '盟', '帮'];
                        const strongItemSuffixes = ['剑', '刀', '丹', '药', '书', '衣', '袍', '甲'];
                        const strongSettingSuffixes = ['山', '河', '湖', '海', '城', '镇', '村', '殿'];
                        const strongSkillSuffixes = ['功', '法', '术', '诀', '典', '经'];
                        if (strongOrgSuffixes.includes(suffix) || 
                            strongItemSuffixes.includes(suffix) ||
                            strongSettingSuffixes.includes(suffix) ||
                            strongSkillSuffixes.includes(suffix)) {
                            return subType;
                        }
                    }
                    if (word.length === 2 && this.looksLikePersonName(word) && subType === 'item') {
                        const weakItemSuffixes = ['丹', '珠', '宝', '花', '草', '果'];
                        if (weakItemSuffixes.includes(suffix)) {
                            return 'character';
                        }
                    }
                    return subType;
                }
            }
        }

        if (SURNAMES.has(word.charAt(0)) && word.length >= 2) {
            return 'character';
        }

        if (this.looksLikePersonName(word)) {
            return 'character';
        }

        return 'unknown';
    }

    /**
     * 是否像人名。
     *
     * @param word - 参数
     * @returns 布尔值
     */
    static looksLikePersonName(word: string): boolean {
        if (word.length < 2 || word.length > 4) return false;

        if (SURNAMES.has(word.charAt(0))) return true;

        if (/^[\u4e00-\u9fa5]{2,4}$/.test(word)) {
            if (VERB_WORDS.has(word) || ADJECTIVE_WORDS.has(word) || FUNCTION_WORDS.has(word)) {
                return false;
            }

            if (word.length === 2) {
                const firstChar = word.charAt(0);
                const secondChar = word.charAt(1);
                
                let firstIsVerb = false;
                for (const vw of VERB_WORDS) {
                    if (vw.length === 1 && vw === firstChar) { firstIsVerb = true; break; }
                }
                let secondIsVerb = false;
                for (const vw of VERB_WORDS) {
                    if (vw.length === 1 && vw === secondChar) { secondIsVerb = true; break; }
                }
                
                if (firstIsVerb || secondIsVerb) {
                    return false;
                }

                let firstIsAdj = false;
                for (const aw of ADJECTIVE_WORDS) {
                    if (aw.length === 1 && aw === firstChar) { firstIsAdj = true; break; }
                }
                if (firstIsAdj) {
                    return false;
                }
            }

            return true;
        }

        return false;
    }

    /**
     * 是否常见姓氏。
     *
     * @param char - 参数
     * @returns 布尔值
     */
    static isCommonSurname(char: string): boolean {
        const commonSurnames = ['李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
            '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高',
            '郑', '梁', '谢', '宋', '唐', '韩', '曹', '许', '邓', '萧'];
        return commonSurnames.includes(char);
    }

    /**
     * 编辑距离。
     *
     * @param a - 参数
     * @param b - 参数
     * @returns 距离
     */
    static levenshteinDistance(a: string, b: string): number {
        const m = a.length;
        const n = b.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,
                        dp[i][j - 1] + 1,
                        dp[i - 1][j - 1] + 1
                    );
                }
            }
        }

        return dp[m][n];
    }

    /**
     * 语义相似度。
     *
     * @param a - 参数
     * @param b - 参数
     * @returns 相似度
     */
    static semanticSimilarity(a: string, b: string): number {
        const normA = a.toLowerCase().trim();
        const normB = b.toLowerCase().trim();

        if (normA === normB) return 1.0;

        const maxLen = Math.max(normA.length, normB.length);
        if (maxLen === 0) return 0;

        const distance = this.levenshteinDistance(normA, normB);
        let similarity = 1 - (distance / maxLen);

        if (normA.startsWith(normB) || normB.startsWith(normA)) {
            similarity = Math.max(similarity, 0.8);
        }

        const shortName = normA.length <= normB.length ? normA : normB;
        const longName = normA.length > normB.length ? normA : normB;

        const nicknamePrefixes = ['小', '老', '阿', '大'];
        for (const prefix of nicknamePrefixes) {
            if (shortName.length === 2 && shortName.startsWith(prefix)) {
                const coreChar = shortName.charAt(1);
                if (longName.includes(coreChar)) {
                    similarity = Math.max(similarity, 0.75);
                }
            }
        }

        const nicknameSuffixes = ['总', '爷', '哥', '姐', '妹', '弟', '叔', '姨', '婆', '公'];
        for (const suffix of nicknameSuffixes) {
            if (shortName.length === 2 && shortName.endsWith(suffix)) {
                const coreChar = shortName.charAt(0);
                if (longName.includes(coreChar)) {
                    similarity = Math.max(similarity, 0.75);
                }
            }
        }

        if (shortName.length === 2 && longName.length >= 3) {
            const shortChars = new Set(shortName);
            let commonCount = 0;
            for (const char of longName) {
                if (shortChars.has(char)) {
                    commonCount++;
                }
            }
            if (commonCount >= 2) {
                similarity = Math.max(similarity, 0.75);
            } else if (commonCount >= 1) {
                similarity = Math.max(similarity, 0.6);
            }
        }

        const setA = new Set(normA);
        const setB = new Set(normB);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        const jaccard = intersection.size / union.size;
        similarity = Math.max(similarity, jaccard * 0.9);

        if (CULTIVATION_WORDS.has(normA) && CULTIVATION_WORDS.has(normB)) {
            similarity = Math.max(similarity, 0.85);
        }

        if (distance === 1 && maxLen >= 2) {
            similarity = Math.max(similarity, 0.75);
        }

        return Math.max(0, Math.min(1, similarity));
    }

    /**
     * 比较两个词的语义匹配。
     *
     * @param word1 - 参数
     * @param word2 - 参数
     * @returns 匹配结果
     */
    static compare(word1: string, word2: string): SemanticMatchResult {
        const norm1 = word1.trim();
        const norm2 = word2.trim();

        if (norm1 === norm2) {
            return { similarity: 1.0, normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'exact' };
        }

        const shortName = norm1.length <= norm2.length ? norm1 : norm2;
        const longName = norm1.length > norm2.length ? norm1 : norm2;

        if (shortName.length === 2 && longName.length >= 3) {
            const shortChars = new Set(shortName);
            let commonCount = 0;
            for (const char of longName) {
                if (shortChars.has(char)) {
                    commonCount++;
                }
            }
            if (commonCount >= 2) {
                const sim = this.semanticSimilarity(norm1, norm2);
                return { similarity: Math.max(sim, 0.75), normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'alias' };
            } else if (commonCount >= 1) {
                const sim = this.semanticSimilarity(norm1, norm2);
                return { similarity: Math.max(sim, 0.6), normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'alias' };
            }
        }

        if (norm1.length >= 2 && norm2.length >= 2) {
            if (norm1.startsWith(norm2) || norm2.startsWith(norm1)) {
                const similarity = this.semanticSimilarity(norm1, norm2);
                if (similarity >= 0.7) {
                    return { similarity, normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'alias' };
                }
            }

            const similarity = this.semanticSimilarity(norm1, norm2);
            if (similarity >= 0.6) {
                return { similarity, normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'semantic' };
            }

            const commonPrefix = this.findCommonPrefix(norm1, norm2);
            if (commonPrefix.length >= 2) {
                return { similarity: 0.5 + commonPrefix.length / Math.max(norm1.length, norm2.length), normalizedWord1: norm1, normalizedWord2: norm2, matched: true, matchType: 'partial' };
            }
        }

        return { similarity: 0, normalizedWord1: norm1, normalizedWord2: norm2, matched: false, matchType: 'semantic' };
    }

    /**
     * 最长公共前缀。
     *
     * @param a - 参数
     * @param b - 参数
     * @returns 前缀
     */
    static findCommonPrefix(a: string, b: string): string {
        let prefix = '';
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) {
            if (a[i] === b[i]) {
                prefix += a[i];
            } else {
                break;
            }
        }
        return prefix;
    }

    /**
     * 按相似度聚合别名。
     *
     * @param names - 参数
     * @param threshold - 参数
     * @returns 实体分组
     */
    static findAliases(names: string[], threshold: number = 0.6): EntityGroup[] {
        const n = names.length;
        const parent: number[] = new Array(n).fill(0).map((_, i) => i);

        const find = (x: number): number => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };

        const union = (x: number, y: number) => {
            const px = find(x);
            const py = find(y);
            if (px !== py) {
                parent[px] = py;
            }
        };

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const result = this.compare(names[i], names[j]);
                if (result.matched && result.similarity >= threshold) {
                    union(i, j);
                }
            }
        }

        const groupMap = new Map<number, string[]>();
        for (let i = 0; i < n; i++) {
            const root = find(i);
            if (!groupMap.has(root)) {
                groupMap.set(root, []);
            }
            groupMap.get(root)!.push(names[i]);
        }

        const groups: EntityGroup[] = [];
        for (const [, group] of groupMap) {
            const canonicalName = this.selectCanonicalName(group);
            groups.push({
                canonicalName,
                aliases: group.filter(n => n !== canonicalName),
                confidence: this.calculateGroupConfidence(group),
                count: group.length
            });
        }

        groups.sort((a, b) => b.count - a.count);
        return groups;
    }

    /**
     * 选择规范名。
     *
     * @param names - 参数
     * @returns 规范名
     */
    static selectCanonicalName(names: string[]): string {
        if (names.length === 0) return '';
        if (names.length === 1) return names[0];

        let canonical = names[0];
        let maxScore = 0;

        for (const name of names) {
            let score = name.length;

            if (SURNAMES.has(name.charAt(0))) {
                score += 3;
            }

            if (!NAME_PREFIXES.has(name.charAt(0))) {
                score += 1;
            }

            if (/^[\u4e00-\u9fa5]{2,4}$/.test(name)) {
                score += 1;
            }

            if (!['小', '老', '阿'].includes(name.charAt(0))) {
                score += 2;
            }

            if (score > maxScore) {
                maxScore = score;
                canonical = name;
            }
        }

        return canonical;
    }

    /**
     * 计算实体分组置信度。
     *
     * @param names - 参数
     * @returns 置信度
     */
    static calculateGroupConfidence(names: string[]): number {
        if (names.length === 1) return 1.0;

        let totalSimilarity = 0;
        let count = 0;

        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const result = this.compare(names[i], names[j]);
                totalSimilarity += result.similarity;
                count++;
            }
        }

        return count > 0 ? totalSimilarity / count : 0;
    }

    /**
     * 在上下文中分析实体词性。
     *
     * @param context - 参数
     * @param entity - 参数
     * @returns 词性分析
     */
    static analyzeContext(context: string, entity: string): WordAnalysis {
        const result = this.analyzeWord(entity);

        if (result.type === 'unknown' || result.type === 'noun') {
            const contextLower = context.toLowerCase();
            const entityLower = entity.toLowerCase();

            const dialoguePatterns = [
                `${entity}道：`,
                `${entity}说道`,
                `${entity}说：`,
                `${entity}说，`,
                `${entity}道,`,
                `${entity}道，`,
                `${entity}的声音`,
                `${entity}的眼神`,
                `${entity}看着`,
                `${entity}看向`,
                `${entity}目光`,
                `${entity}沉默`,
                `${entity}点头`,
                `${entity}摇头`,
                `${entity}微微一笑`,
                `${entity}冷笑`,
                `${entity}大笑`,
                `${entity}叹了口气`,
                `${entity}站起身`,
                `${entity}坐下`,
                `${entity}走到`,
                `${entity}跑向`,
                `${entity}的表情`,
                `${entity}的脸色`,
                `${entity}的身影`,
            ];

            for (const pattern of dialoguePatterns) {
                if (context.includes(pattern)) {
                    return { ...result, type: 'noun', subType: 'character', confidence: Math.max(result.confidence, 0.9) };
                }
            }

            if (contextLower.includes(`名为${entityLower}`) || 
                contextLower.includes(`叫做${entityLower}`) || 
                contextLower.includes(`称作${entityLower}`) ||
                contextLower.includes(`称呼为${entityLower}`)) {
                return { ...result, type: 'noun', subType: 'character', confidence: Math.max(result.confidence, 0.9) };
            }

            if (context.includes(`${entity}的`) && 
                !context.includes(`${entity}的话`) && 
                !context.includes(`${entity}的事`) && 
                !context.includes(`${entity}的人`) && 
                !context.includes(`${entity}的时候`) && 
                !context.includes(`${entity}的地方`)) {
                const analysis = this.analyzeWord(entity);
                if (analysis.type === 'noun') {
                    return analysis;
                }
            }
        }

        return result;
    }

    /**
     * 从文本抽取实体。
     *
     * @param text - 参数
     * @param types - 参数
     * @returns 实体名数组
     */
    static extractEntities(text: string, types: WordType[] = ['noun']): string[] {
        type Candidate = { word: string; pos: number; score: number; subType: string; tier: number };
        const candidates: Candidate[] = [];
        const maxLen = 6;

        const MULTI_CHAR_SUFFIXES = ['玉佩', '戒指', '葫芦', '心法', '秘法', '神功', '绝技', '绝招',
            '武学', '武道', '剑道', '大挪移', '秘境', '禁地', '遗迹', '鬼界', '龙宫', '雷音寺',
            '沙漠', '平原', '峡谷', '洞穴', '仙界', '魔界', '妖界', '神界', '人界', '凡间', '世俗',
            '预言', '约定', '誓言', '承诺', '赌约', '宿命', '大劫', '浩劫', '灾变', '乱世', '大战',
            '决战', '终局', '末日', '传承', '轮回', '转世', '之战', '之劫', '之变',
            '联盟', '组织', '教会', '家族', '山庄', '城堡'];

        const hasMultiCharSuffix = (word: string): boolean => {
            for (const suffix of MULTI_CHAR_SUFFIXES) {
                if (word.endsWith(suffix)) return true;
            }
            return false;
        };

        const calcScore = (word: string, analysis: WordAnalysis): number => {
            let score = analysis.confidence;

            if (hasMultiCharSuffix(word)) {
                score += 0.2;
                if (word.length >= 4) {
                    score += 0.1;
                }
                if (word.length >= 5) {
                    score += 0.05;
                }
                
                if (word.length > 4) {
                    let foundGoodPrefix = false;
                    for (const suffix of MULTI_CHAR_SUFFIXES) {
                        if (word.endsWith(suffix)) {
                            const prefix = word.substring(0, word.length - suffix.length);
                            if (prefix.length >= 2) {
                                const prefixAnalysis = this.analyzeWord(prefix);
                                if (prefixAnalysis.type === 'verb') {
                                    score -= 0.4;
                                } else if (prefixAnalysis.type === 'function') {
                                    score -= 0.3;
                                }
                            }
                            break;
                        }
                    }
                }
            } else {
                if (word.length >= 3 && word.length <= 4) {
                    score += 0.05;
                }
            }

            const first2 = word.substring(0, Math.min(2, word.length));
            const a2 = this.analyzeWord(first2);
            if (a2.type === 'verb') {
                score -= 0.3;
            }
            if (a2.type === 'function') {
                score -= 0.25;
            }

            const first1 = word.charAt(0);
            const a1 = this.analyzeWord(first1);
            if (a1.type === 'verb') {
                score -= 0.15;
            }
            if (a1.type === 'function') {
                score -= 0.1;
            }

            return score;
        };

        for (let len = maxLen; len >= 2; len--) {
            for (let i = 0; i <= text.length - len; i++) {
                const word = text.substring(i, i + len);
                if (!/^[\u4e00-\u9fa5]+$/.test(word)) continue;

                const analysis = this.analyzeWord(word);
                if (!types.includes(analysis.type) || !analysis.subType || analysis.subType === 'unknown') {
                    continue;
                }
                if (analysis.confidence < 0.65) continue;

                if (hasMultiCharSuffix(word) && analysis.subType !== 'character') {
                    if (word.length > 4) continue;
                }

                const score = calcScore(word, analysis);
                if (score < 0.55) continue;

                let tier = 3;
                if (hasMultiCharSuffix(word) && analysis.subType !== 'character' && word.length <= 4) {
                    tier = 1;
                } else if (analysis.subType === 'character' && this.looksLikePersonName(word) && word.length >= 2 && word.length <= 3 && analysis.confidence >= 0.75) {
                    tier = 2;
                }

                candidates.push({ word, pos: i, score, subType: analysis.subType || 'unknown', tier });
            }
        }

        candidates.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return b.score - a.score;
        });

        const result: string[] = [];
        const seen = new Set<string>();
        const usedPositions = new Set<number>();

        for (const c of candidates) {
            if (c.tier > 2) continue;
            if (c.tier === 2 && c.score < 0.7) continue;

            let hasOverlap = false;
            for (let p = c.pos; p < c.pos + c.word.length; p++) {
                if (usedPositions.has(p)) { hasOverlap = true; break; }
            }
            if (hasOverlap) continue;

            for (let p = c.pos; p < c.pos + c.word.length; p++) {
                usedPositions.add(p);
            }
            if (!seen.has(c.word)) {
                result.push(c.word);
                seen.add(c.word);
            }
        }

        return result;
    }

    /**
     * 过滤噪声词。
     *
     * @param words - 参数
     * @returns 词数组
     */
    static filterNoiseWords(words: string[]): string[] {
        const noiseWords = new Set([
            ...FUNCTION_WORDS,
            ...VERB_WORDS,
            ...ADJECTIVE_WORDS,
            ...ADVERB_WORDS,
            ...ADVERB_PREFIXES,
        ]);

        return words.filter(word => {
            if (word.length < 2) return false;
            if (noiseWords.has(word)) return false;
            return true;
        });
    }

    /**
     * 规范化实体名。
     *
     * @param name - 参数
     * @returns 名称
     */
    static normalizeEntityName(name: string): string {
        let normalized = name.trim();

        for (const prefix of NAME_PREFIXES) {
            if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
                const remaining = normalized.substring(prefix.length);
                if (/^[\u4e00-\u9fa5]{1,}$/.test(remaining)) {
                    normalized = remaining;
                    break;
                }
            }
        }

        return normalized;
    }
}