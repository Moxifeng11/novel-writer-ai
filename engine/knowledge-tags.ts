import { kbTagSystemFile } from '../shared/paths';

export interface KnowledgeTag {
    id: string;
    name: string;
    parentId?: string;
    category: 'theme' | 'technique';
    type?: string;
    description?: string;
}

function generateId(): string {
    return 'tag_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const DEFAULT_TAGS: Omit<KnowledgeTag, 'id'>[] = [
    // ========== 题材标签 - 男频 ==========
    { name: '男频', category: 'theme', type: '男频', description: '男频小说大类' },
    { name: '玄幻', category: 'theme', type: '男频', description: '玄幻类小说' },
    { name: '东方玄幻', category: 'theme', type: '男频', description: '东方背景玄幻' },
    { name: '异世大陆', category: 'theme', type: '男频', description: '异世大陆背景' },
    { name: '高武世界', category: 'theme', type: '男频', description: '高武世界观' },
    { name: '王朝争霸', category: 'theme', type: '男频', description: '王朝争霸题材' },
    { name: '传统玄幻', category: 'theme', type: '男频', description: '传统玄幻风格' },
    { name: '奇幻', category: 'theme', type: '男频', description: '奇幻类小说' },
    { name: '西方奇幻', category: 'theme', type: '男频', description: '西方背景奇幻' },
    { name: '史诗奇幻', category: 'theme', type: '男频', description: '史诗级奇幻' },
    { name: '都市奇幻', category: 'theme', type: '男频', description: '都市背景奇幻' },
    { name: '武侠', category: 'theme', type: '男频', description: '武侠类小说' },
    { name: '传统武侠', category: 'theme', type: '男频', description: '传统武侠风格' },
    { name: '新派武侠', category: 'theme', type: '男频', description: '新派武侠风格' },
    { name: '国术武侠', category: 'theme', type: '男频', description: '国术流武侠' },
    { name: '仙侠', category: 'theme', type: '男频', description: '仙侠类小说' },
    { name: '古典仙侠', category: 'theme', type: '男频', description: '古典仙侠风格' },
    { name: '现代修真', category: 'theme', type: '男频', description: '现代背景修真' },
    { name: '洪荒封神', category: 'theme', type: '男频', description: '洪荒封神题材' },
    { name: '修仙', category: 'theme', type: '男频', description: '修仙类小说' },
    { name: '都市', category: 'theme', type: '男频', description: '都市类小说' },
    { name: '都市生活', category: 'theme', type: '男频', description: '都市生活题材' },
    { name: '都市异能', category: 'theme', type: '男频', description: '都市异能题材' },
    { name: '都市重生', category: 'theme', type: '男频', description: '都市重生题材' },
    { name: '商业大亨', category: 'theme', type: '男频', description: '商战题材' },
    { name: '校园', category: 'theme', type: '男频', description: '校园题材' },
    { name: '职场', category: 'theme', type: '男频', description: '职场题材' },
    { name: '官场', category: 'theme', type: '男频', description: '官场题材' },
    { name: '都市修仙', category: 'theme', type: '男频', description: '都市修仙题材' },
    { name: '神豪流', category: 'theme', type: '男频', description: '神豪流小说' },
    { name: '赘婿流', category: 'theme', type: '男频', description: '赘婿流小说' },
    { name: '历史', category: 'theme', type: '男频', description: '历史类小说' },
    { name: '架空历史', category: 'theme', type: '男频', description: '架空历史题材' },
    { name: '秦汉三国', category: 'theme', type: '男频', description: '秦汉三国背景' },
    { name: '隋唐五代', category: 'theme', type: '男频', description: '隋唐五代背景' },
    { name: '两宋元明', category: 'theme', type: '男频', description: '两宋元明背景' },
    { name: '历史传记', category: 'theme', type: '男频', description: '历史传记题材' },
    { name: '清史民国', category: 'theme', type: '男频', description: '清史民国背景' },
    { name: '军事', category: 'theme', type: '男频', description: '军事类小说' },
    { name: '军事战争', category: 'theme', type: '男频', description: '军事战争题材' },
    { name: '谍战特工', category: 'theme', type: '男频', description: '谍战特工题材' },
    { name: '抗战烽火', category: 'theme', type: '男频', description: '抗战题材' },
    { name: '军旅生涯', category: 'theme', type: '男频', description: '军旅生活题材' },
    { name: '游戏', category: 'theme', type: '男频', description: '游戏类小说' },
    { name: '电子竞技', category: 'theme', type: '男频', description: '电竞题材' },
    { name: '游戏异界', category: 'theme', type: '男频', description: '游戏异界题材' },
    { name: '虚拟网游', category: 'theme', type: '男频', description: '虚拟网游题材' },
    { name: '游戏竞技', category: 'theme', type: '男频', description: '游戏竞技题材' },
    { name: '科幻', category: 'theme', type: '男频', description: '科幻类小说' },
    { name: '末世危机', category: 'theme', type: '男频', description: '末世危机题材' },
    { name: '进化变异', category: 'theme', type: '男频', description: '进化变异题材' },
    { name: '星际科幻', category: 'theme', type: '男频', description: '星际科幻题材' },
    { name: '古武机甲', category: 'theme', type: '男频', description: '古武机甲题材' },
    { name: '未来世界', category: 'theme', type: '男频', description: '未来世界题材' },
    { name: '科幻末世', category: 'theme', type: '男频', description: '科幻末世题材' },
    { name: '悬疑', category: 'theme', type: '男频', description: '悬疑类小说' },
    { name: '诡秘悬疑', category: 'theme', type: '男频', description: '诡秘悬疑风格' },
    { name: '侦探推理', category: 'theme', type: '男频', description: '侦探推理题材' },
    { name: '恐怖惊悚', category: 'theme', type: '男频', description: '恐怖惊悚题材' },
    { name: '民间奇闻', category: 'theme', type: '男频', description: '民间奇闻题材' },
    { name: '探险生存', category: 'theme', type: '男频', description: '探险生存题材' },
    { name: '同人', category: 'theme', type: '男频', description: '同人类小说' },
    { name: '小说同人', category: 'theme', type: '男频', description: '小说同人' },
    { name: '动漫同人', category: 'theme', type: '男频', description: '动漫同人' },
    { name: '影视同人', category: 'theme', type: '男频', description: '影视同人' },
    { name: '游戏同人', category: 'theme', type: '男频', description: '游戏同人' },
    { name: '轻小说', category: 'theme', type: '男频', description: '轻小说风格' },
    { name: '体育', category: 'theme', type: '男频', description: '体育题材' },
    { name: '灵异', category: 'theme', type: '男频', description: '灵异题材' },
    { name: '二次元', category: 'theme', type: '男频', description: '二次元题材' },
    { name: '现实', category: 'theme', type: '男频', description: '现实题材' },

    // ========== 题材标签 - 女频 ==========
    { name: '女频', category: 'theme', type: '女频', description: '女频小说大类' },
    { name: '现代言情', category: 'theme', type: '女频', description: '现代言情类' },
    { name: '总裁豪门', category: 'theme', type: '女频', description: '总裁豪门题材' },
    { name: '都市生活', category: 'theme', type: '女频', description: '都市生活题材' },
    { name: '校园青春', category: 'theme', type: '女频', description: '校园青春题材' },
    { name: '职场丽人', category: 'theme', type: '女频', description: '职场丽人题材' },
    { name: '婚恋情缘', category: 'theme', type: '女频', description: '婚恋情缘题材' },
    { name: '古代言情', category: 'theme', type: '女频', description: '古代言情类' },
    { name: '宫斗宅斗', category: 'theme', type: '女频', description: '宫斗宅斗题材' },
    { name: '经商种田', category: 'theme', type: '女频', description: '经商种田题材' },
    { name: '穿越奇情', category: 'theme', type: '女频', description: '穿越奇情题材' },
    { name: '重生异能', category: 'theme', type: '女频', description: '重生异能题材' },
    { name: '快意江湖', category: 'theme', type: '女频', description: '快意江湖题材' },
    { name: '古典架空', category: 'theme', type: '女频', description: '古典架空题材' },
    { name: '幻想言情', category: 'theme', type: '女频', description: '幻想言情类' },
    { name: '仙侠奇缘', category: 'theme', type: '女频', description: '仙侠奇缘题材' },
    { name: '玄幻言情', category: 'theme', type: '女频', description: '玄幻言情题材' },
    { name: '异世传说', category: 'theme', type: '女频', description: '异世传说题材' },
    { name: '星际恋歌', category: 'theme', type: '女频', description: '星际恋歌题材' },
    { name: '末世危机', category: 'theme', type: '女频', description: '末世危机题材' },
    { name: '科幻空间', category: 'theme', type: '女频', description: '科幻空间题材' },
    { name: '悬疑推理', category: 'theme', type: '女频', description: '悬疑推理题材' },
    { name: '同人', category: 'theme', type: '女频', description: '同人类小说' },
    { name: '轻小说', category: 'theme', type: '女频', description: '轻小说风格' },
    { name: '青春校园', category: 'theme', type: '女频', description: '青春校园题材' },
    { name: '耽美言情', category: 'theme', type: '女频', description: '耽美言情题材' },
    { name: '百合言情', category: 'theme', type: '女频', description: '百合言情题材' },
    { name: '甜宠文', category: 'theme', type: '女频', description: '甜宠文风格' },
    { name: '虐文', category: 'theme', type: '女频', description: '虐文风格' },

    // ========== 题材标签 - 短篇 ==========
    { name: '短篇', category: 'theme', type: '短篇', description: '短篇小说大类' },
    { name: '短篇言情', category: 'theme', type: '短篇', description: '短篇言情' },
    { name: '短篇悬疑', category: 'theme', type: '短篇', description: '短篇悬疑' },
    { name: '短篇玄幻', category: 'theme', type: '短篇', description: '短篇玄幻' },
    { name: '短篇奇幻', category: 'theme', type: '短篇', description: '短篇奇幻' },
    { name: '短篇武侠', category: 'theme', type: '短篇', description: '短篇武侠' },
    { name: '短篇仙侠', category: 'theme', type: '短篇', description: '短篇仙侠' },
    { name: '短篇都市', category: 'theme', type: '短篇', description: '短篇都市' },
    { name: '短篇历史', category: 'theme', type: '短篇', description: '短篇历史' },
    { name: '短篇游戏', category: 'theme', type: '短篇', description: '短篇游戏' },
    { name: '短篇科幻', category: 'theme', type: '短篇', description: '短篇科幻' },
    { name: '短篇同人', category: 'theme', type: '短篇', description: '短篇同人' },
    { name: '微小说', category: 'theme', type: '短篇', description: '微小说' },
    { name: '故事', category: 'theme', type: '短篇', description: '故事类' },
    { name: '散文随笔', category: 'theme', type: '短篇', description: '散文随笔' },
    { name: '诗歌', category: 'theme', type: '短篇', description: '诗歌' },

    // ========== 题材标签 - 衍生 ==========
    { name: '衍生', category: 'theme', type: '衍生', description: '衍生小说大类' },
    { name: '影视衍生', category: 'theme', type: '衍生', description: '影视衍生' },
    { name: '动漫衍生', category: 'theme', type: '衍生', description: '动漫衍生' },
    { name: '小说衍生', category: 'theme', type: '衍生', description: '小说衍生' },
    { name: '游戏衍生', category: 'theme', type: '衍生', description: '游戏衍生' },
    { name: '明星同人', category: 'theme', type: '衍生', description: '明星同人' },
    { name: '综艺衍生', category: 'theme', type: '衍生', description: '综艺衍生' },
    { name: '二次元衍生', category: 'theme', type: '衍生', description: '二次元衍生' },

    // ========== 写作技巧标签 - 结构类 ==========
    { name: '结构类', category: 'technique', type: '结构类', description: '结构类写作技巧' },
    { name: '伏笔', category: 'technique', type: '结构类', description: '伏笔手法' },
    { name: '反转', category: 'technique', type: '结构类', description: '剧情反转' },
    { name: '铺垫', category: 'technique', type: '结构类', description: '情节铺垫' },
    { name: '悬念', category: 'technique', type: '结构类', description: '设置悬念' },
    { name: '呼应', category: 'technique', type: '结构类', description: '前后呼应' },
    { name: '双线并行', category: 'technique', type: '结构类', description: '双线叙事' },
    { name: '三线结构', category: 'technique', type: '结构类', description: '三线叙事结构' },
    { name: '单元剧', category: 'technique', type: '结构类', description: '单元剧结构' },
    { name: '连续剧', category: 'technique', type: '结构类', description: '连续剧结构' },
    { name: '起承转合', category: 'technique', type: '结构类', description: '起承转合结构' },
    { name: '三幕式', category: 'technique', type: '结构类', description: '三幕式结构' },
    { name: '五幕式', category: 'technique', type: '结构类', description: '五幕式结构' },
    { name: '四幕式', category: 'technique', type: '结构类', description: '四幕式结构' },
    { name: '黄金三章', category: 'technique', type: '结构类', description: '黄金三章开篇' },
    { name: '倒叙', category: 'technique', type: '结构类', description: '倒叙手法' },
    { name: '插叙', category: 'technique', type: '结构类', description: '插叙手法' },
    { name: '补叙', category: 'technique', type: '结构类', description: '补叙手法' },
    { name: '环形结构', category: 'technique', type: '结构类', description: '环形叙事结构' },
    { name: '多线叙事', category: 'technique', type: '结构类', description: '多线叙事' },
    { name: 'POV切换', category: 'technique', type: '结构类', description: 'POV视角切换' },

    // ========== 写作技巧标签 - 爽点类 ==========
    { name: '爽点类', category: 'technique', type: '爽点类', description: '爽点类写作技巧' },
    { name: '打脸', category: 'technique', type: '爽点类', description: '打脸爽点' },
    { name: '升级', category: 'technique', type: '爽点类', description: '升级爽点' },
    { name: '装逼', category: 'technique', type: '爽点类', description: '装逼爽点' },
    { name: '扮猪吃虎', category: 'technique', type: '爽点类', description: '扮猪吃虎' },
    { name: '退婚流', category: 'technique', type: '爽点类', description: '退婚流开局' },
    { name: '废柴流', category: 'technique', type: '爽点类', description: '废柴流开局' },
    { name: '系统流', category: 'technique', type: '爽点类', description: '系统流金手指' },
    { name: '签到流', category: 'technique', type: '爽点类', description: '签到流金手指' },
    { name: '无限流', category: 'technique', type: '爽点类', description: '无限流题材' },
    { name: '诸天流', category: 'technique', type: '爽点类', description: '诸天流题材' },
    { name: '无敌流', category: 'technique', type: '爽点类', description: '无敌流设定' },
    { name: '凡人流', category: 'technique', type: '爽点类', description: '凡人流设定' },
    { name: '儒道流', category: 'technique', type: '爽点类', description: '儒道流设定' },
    { name: '盗墓流', category: 'technique', type: '爽点类', description: '盗墓流题材' },
    { name: '赘婿流', category: 'technique', type: '爽点类', description: '赘婿流设定' },
    { name: '神豪流', category: 'technique', type: '爽点类', description: '神豪流设定' },
    { name: '都市修仙', category: 'technique', type: '爽点类', description: '都市修仙设定' },
    { name: '灵气复苏', category: 'technique', type: '爽点类', description: '灵气复苏设定' },
    { name: '血脉觉醒', category: 'technique', type: '爽点类', description: '血脉觉醒设定' },
    { name: '金手指', category: 'technique', type: '爽点类', description: '金手指设定' },

    // ========== 写作技巧标签 - 情绪类 ==========
    { name: '情绪类', category: 'technique', type: '情绪类', description: '情绪类写作技巧' },
    { name: '催泪', category: 'technique', type: '情绪类', description: '催泪向' },
    { name: '搞笑', category: 'technique', type: '情绪类', description: '搞笑风格' },
    { name: '热血', category: 'technique', type: '情绪类', description: '热血风格' },
    { name: '治愈', category: 'technique', type: '情绪类', description: '治愈向' },
    { name: '致郁', category: 'technique', type: '情绪类', description: '致郁向' },
    { name: '甜宠', category: 'technique', type: '情绪类', description: '甜宠风格' },
    { name: '虐恋', category: 'technique', type: '情绪类', description: '虐恋风格' },
    { name: '爽文', category: 'technique', type: '情绪类', description: '爽文风格' },
    { name: '虐文', category: 'technique', type: '情绪类', description: '虐文风格' },
    { name: '温馨', category: 'technique', type: '情绪类', description: '温馨风格' },
    { name: '轻松', category: 'technique', type: '情绪类', description: '轻松风格' },
    { name: '压抑', category: 'technique', type: '情绪类', description: '压抑风格' },
    { name: '爆笑', category: 'technique', type: '情绪类', description: '爆笑风格' },
    { name: '轻松幽默', category: 'technique', type: '情绪类', description: '轻松幽默风格' },
    { name: '正剧', category: 'technique', type: '情绪类', description: '正剧风格' },
    { name: '悲剧', category: 'technique', type: '情绪类', description: '悲剧风格' },
    { name: '喜剧', category: 'technique', type: '情绪类', description: '喜剧风格' },
    { name: '腹黑', category: 'technique', type: '情绪类', description: '腹黑属性' },
    { name: '傲娇', category: 'technique', type: '情绪类', description: '傲娇属性' },
    { name: '病娇', category: 'technique', type: '情绪类', description: '病娇属性' },

    // ========== 写作技巧标签 - 节奏类 ==========
    { name: '节奏类', category: 'technique', type: '节奏类', description: '节奏类写作技巧' },
    { name: '快节奏', category: 'technique', type: '节奏类', description: '快节奏叙事' },
    { name: '慢热', category: 'technique', type: '节奏类', description: '慢热型叙事' },
    { name: '高潮迭起', category: 'technique', type: '节奏类', description: '高潮迭起' },
    { name: '平淡如水', category: 'technique', type: '节奏类', description: '平淡叙事' },
    { name: '张弛有度', category: 'technique', type: '节奏类', description: '张弛有度' },
    { name: '紧凑', category: 'technique', type: '节奏类', description: '节奏紧凑' },
    { name: '拖沓', category: 'technique', type: '节奏类', description: '节奏拖沓' },
    { name: '单元剧节奏', category: 'technique', type: '节奏类', description: '单元剧节奏' },
    { name: '连续剧节奏', category: 'technique', type: '节奏类', description: '连续剧节奏' },
    { name: '一波三折', category: 'technique', type: '节奏类', description: '一波三折' },
    { name: '层层递进', category: 'technique', type: '节奏类', description: '层层递进' },
    { name: '欲扬先抑', category: 'technique', type: '节奏类', description: '欲扬先抑' },
    { name: '欲抑先扬', category: 'technique', type: '节奏类', description: '欲抑先扬' },

    // ========== 写作技巧标签 - 流派类 ==========
    { name: '流派类', category: 'technique', type: '流派类', description: '流派类写作风格' },
    { name: '废柴逆袭', category: 'technique', type: '流派类', description: '废柴逆袭流' },
    { name: '霸道总裁', category: 'technique', type: '流派类', description: '霸道总裁流' },
    { name: '甜宠文', category: 'technique', type: '流派类', description: '甜宠文流派' },
    { name: '虐文', category: 'technique', type: '流派类', description: '虐文流派' },
    { name: '爽文', category: 'technique', type: '流派类', description: '爽文流派' },
    { name: '种田文', category: 'technique', type: '流派类', description: '种田文流派' },
    { name: '宅斗文', category: 'technique', type: '流派类', description: '宅斗文流派' },
    { name: '宫斗文', category: 'technique', type: '流派类', description: '宫斗文流派' },
    { name: '末世文', category: 'technique', type: '流派类', description: '末世文流派' },
    { name: '星际文', category: 'technique', type: '流派类', description: '星际文流派' },
    { name: '穿书文', category: 'technique', type: '流派类', description: '穿书文流派' },
    { name: '快穿文', category: 'technique', type: '流派类', description: '快穿文流派' },
    { name: '重生文', category: 'technique', type: '流派类', description: '重生文流派' },
    { name: '穿越文', category: 'technique', type: '流派类', description: '穿越文流派' },
    { name: '系统文', category: 'technique', type: '流派类', description: '系统文流派' },
    { name: '签到文', category: 'technique', type: '流派类', description: '签到文流派' },
    { name: '无限流', category: 'technique', type: '流派类', description: '无限流流派' },
    { name: '诸天流', category: 'technique', type: '流派类', description: '诸天流流派' },
    { name: '凡人流', category: 'technique', type: '流派类', description: '凡人流流派' },
    { name: '无敌流', category: 'technique', type: '流派类', description: '无敌流流派' },
];

function buildDefaultTags(): KnowledgeTag[] {
    const tags: KnowledgeTag[] = [];
    const nameToId = new Map<string, string>();

    const categoryRoots: Record<string, Record<string, string>> = {
        theme: {
            '男频': '',
            '女频': '',
            '短篇': '',
            '衍生': '',
        },
        technique: {
            '结构类': '',
            '爽点类': '',
            '情绪类': '',
            '节奏类': '',
            '流派类': '',
        },
    };

    for (const tagData of DEFAULT_TAGS) {
        const id = generateId();
        nameToId.set(`${tagData.category}:${tagData.name}`, id);
        let parentId: string | undefined;

        const roots = categoryRoots[tagData.category];
        if (roots && tagData.name in roots) {
            parentId = undefined;
        } else {
            const typeKey = `${tagData.category}:${tagData.type}`;
            if (nameToId.has(typeKey)) {
                parentId = nameToId.get(typeKey);
            }
        }

        tags.push({
            id,
            name: tagData.name,
            parentId,
            category: tagData.category,
            type: tagData.type,
            description: tagData.description,
        });
    }

    return tags;
}

export class KnowledgeTagManager {
    private app: { vault: { adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void>; mkdir(p: string): Promise<void> } } };
    private baseDir?: string;
    private tags: KnowledgeTag[] = [];
    private initialized = false;

    constructor(app: { vault: { adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void>; mkdir(p: string): Promise<void> } } }, baseDir?: string) {
        this.app = app;
        this.baseDir = baseDir;
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        const filePath = kbTagSystemFile(this.baseDir);
        const exists = await this.app.vault.adapter.exists(filePath);

        if (exists) {
            try {
                await this.load();
            } catch (e) {
                // 读取失败（权限/同步冲突）时旧实现让 init 直接抛出，知识库整体初始化中断；
                // 这里退回默认标签继续工作，并把读不到的原文件改名留档，
                // 避免「一读失败，下一次 save 就把整份自定义标签覆盖成默认」。
                console.warn('[KnowledgeTagManager] 标签体系读取失败，本次使用默认标签:', e);
                try {
                    await (this.app.vault.adapter as unknown as {
                        rename(oldPath: string, newPath: string): Promise<void>;
                    }).rename(filePath, `${filePath}.corrupt-${Date.now()}.bak`);
                } catch {
                    // 改名失败不阻塞：仍用默认标签继续
                }
                this.tags = buildDefaultTags();
            }
        } else {
            this.tags = buildDefaultTags();
            await this.save();
        }

        this.initialized = true;
    }

    getAllTags(): KnowledgeTag[] {
        return [...this.tags];
    }

    getTagsByCategory(category: 'theme' | 'technique'): KnowledgeTag[] {
        return this.tags.filter(t => t.category === category);
    }

    getTagsByType(type: string): KnowledgeTag[] {
        return this.tags.filter(t => t.type === type);
    }

    getTagById(id: string): KnowledgeTag | undefined {
        return this.tags.find(t => t.id === id);
    }

    getTagByName(name: string): KnowledgeTag | undefined {
        return this.tags.find(t => t.name === name);
    }

    getChildTags(parentId: string): KnowledgeTag[] {
        return this.tags.filter(t => t.parentId === parentId);
    }

    async addTag(tag: Omit<KnowledgeTag, 'id'>): Promise<KnowledgeTag> {
        const newTag: KnowledgeTag = {
            ...tag,
            id: generateId(),
        };
        this.tags.push(newTag);
        await this.save();
        return newTag;
    }

    async updateTag(id: string, updates: Partial<KnowledgeTag>): Promise<void> {
        const idx = this.tags.findIndex(t => t.id === id);
        if (idx === -1) return;
        this.tags[idx] = { ...this.tags[idx], ...updates, id };
        await this.save();
    }

    async deleteTag(id: string): Promise<void> {
        const toDelete = new Set<string>([id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const tag of this.tags) {
                if (tag.parentId && toDelete.has(tag.parentId) && !toDelete.has(tag.id)) {
                    toDelete.add(tag.id);
                    changed = true;
                }
            }
        }
        this.tags = this.tags.filter(t => !toDelete.has(t.id));
        await this.save();
    }

    async save(): Promise<void> {
        const filePath = kbTagSystemFile(this.baseDir);
        const content = this.serializeToMarkdown();
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await this.app.vault.adapter.exists(dirPath))) {
            await this.app.vault.adapter.mkdir(dirPath);
        }
        await this.app.vault.adapter.write(filePath, content);
    }

    async load(): Promise<void> {
        const filePath = kbTagSystemFile(this.baseDir);
        const content = await this.app.vault.adapter.read(filePath);
        this.tags = this.parseFromMarkdown(content);
    }

    private serializeToMarkdown(): string {
        const lines: string[] = [];
        lines.push('---');
        lines.push('title: 标签体系');
        lines.push('version: 1.0');
        lines.push(`total: ${this.tags.length}`);
        lines.push(`updated: ${new Date().toISOString()}`);
        lines.push('---');
        lines.push('');
        lines.push('# 标签体系');
        lines.push('');

        const themeRoots = this.tags.filter(t => t.category === 'theme' && !t.parentId);
        const techniqueRoots = this.tags.filter(t => t.category === 'technique' && !t.parentId);

        lines.push('## 题材标签');
        lines.push('');
        for (const root of themeRoots) {
            this.appendTagTree(lines, root, 0);
        }

        lines.push('');
        lines.push('## 写作技巧标签');
        lines.push('');
        for (const root of techniqueRoots) {
            this.appendTagTree(lines, root, 0);
        }

        return lines.join('\n');
    }

    private appendTagTree(lines: string[], tag: KnowledgeTag, depth: number): void {
        const indent = '  '.repeat(depth);
        const desc = tag.description ? ` — ${tag.description}` : '';
        const typeInfo = tag.type && !tag.parentId ? ` [${tag.type}]` : '';
        lines.push(`${indent}- ${tag.name}${typeInfo}${desc}`);
        const children = this.tags.filter(t => t.parentId === tag.id);
        for (const child of children) {
            this.appendTagTree(lines, child, depth + 1);
        }
    }

    private parseFromMarkdown(content: string): KnowledgeTag[] {
        const tags: KnowledgeTag[] = [];
        const lines = content.split('\n');

        let inFrontmatter = false;
        let inBody = false;
        let currentCategory: 'theme' | 'technique' = 'theme';

        const stack: { depth: number; tag: KnowledgeTag }[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            if (inFrontmatter) continue;

            if (trimmed.startsWith('## ')) {
                inBody = true;
                const heading = trimmed.substring(3).trim();
                if (heading.includes('题材')) {
                    currentCategory = 'theme';
                } else if (heading.includes('技巧')) {
                    currentCategory = 'technique';
                }
                stack.length = 0;
                continue;
            }

            if (!inBody) continue;

            const listMatch = trimmed.match(/^(\s*)-\s+(.+)$/);
            if (!listMatch) continue;

            const indentStr = listMatch[1];
            const namePart = listMatch[2];
            const depth = Math.floor(indentStr.length / 2);

            let name = namePart;
            let description: string | undefined;
            let type: string | undefined;

            const descMatch = name.match(/^(.+?)\s+—\s+(.+)$/);
            if (descMatch) {
                name = descMatch[1].trim();
                description = descMatch[2].trim();
            }

            const typeMatch = name.match(/^(.+?)\s*\[(.+?)\]\s*$/);
            if (typeMatch) {
                name = typeMatch[1].trim();
                type = typeMatch[2].trim();
            }

            while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
                stack.pop();
            }

            const parent = stack.length > 0 ? stack[stack.length - 1].tag : undefined;
            const parentId = parent?.id;
            const tagType = type || parent?.type;

            const id = generateId();
            const tag: KnowledgeTag = {
                id,
                name,
                parentId,
                category: currentCategory,
                type: tagType,
                description,
            };

            tags.push(tag);
            stack.push({ depth, tag });
        }

        return tags.length > 0 ? tags : buildDefaultTags();
    }
}
