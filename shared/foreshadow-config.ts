/**
 * foreshadow-config.ts — 伏笔配置的类型与默认值
 *
 * 为什么放在 shared：core/settings-service 生成 DEFAULT_SETTINGS 时需要默认配置，
 * ui 设置面板读取默认值、engine 配置管理器也共用。放 engine 会让 core 产生
 * core → engine 反向边。管理器（读写 vault）仍留在 engine/foreshadow-config-manager.ts。
 */

export interface ForeshadowTypeConfig {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    priority: number;
    enabled: boolean;
    color?: string;
}

export interface ForeshadowConfig {
    types: ForeshadowTypeConfig[];
    version: string;
}

export const DEFAULT_FORESHADOW_TYPES: ForeshadowTypeConfig[] = [
    {
        id: 'item',
        name: '物品',
        description: '武器、道具、丹药、书籍等实体物品',
        keywords: ['剑', '刀', '枪', '玉佩', '玉', '珠', '宝', '戒', '戒指', '镯', '链', '坠', '簪', '瓶', '葫芦', '鼎', '炉', '塔', '印', '玺', '令', '牌', '符', '丹', '药', '草', '花', '果', '酒', '茶', '书', '图', '卷', '衣', '袍', '甲', '盔', '靴', '扇', '伞', '琴', '棋', '画'],
        priority: 100,
        enabled: true,
        color: '#4CAF50'
    },
    {
        id: 'skill',
        name: '功法/技能',
        description: '武功秘籍、法术、修炼功法、特殊技能',
        keywords: ['诀', '功', '法', '术', '式', '典', '经', '谱', '录', '秘', '心法', '秘法', '神功', '绝技', '绝招', '武学', '武道', '剑道', '刀法', '枪法', '拳法', '掌法', '指法', '腿法', '身法', '步法'],
        priority: 90,
        enabled: true,
        color: '#2196F3'
    },
    {
        id: 'character',
        name: '人物',
        description: '重要角色、神秘人物、关键NPC',
        keywords: ['神秘人', '神秘老者', '神秘女子', '神秘少年', '黑衣人', '白衣人', '灰衣人', '面具人', '斗篷人', '来历不明', '身份成谜', '背景不详'],
        priority: 80,
        enabled: true,
        color: '#FF9800'
    },
    {
        id: 'setting',
        name: '地点/秘境',
        description: '神秘地点、秘境、禁地、传送阵',
        keywords: ['秘境', '禁地', '传说', '神话', '上古', '远古', '太古', '洪荒', '仙界', '魔界', '妖界', '鬼界', '神界', '人界', '凡间', '世俗', '大阵', '结界', '禁制', '封印', '传承', '遗迹'],
        priority: 70,
        enabled: true,
        color: '#9C27B0'
    },
    {
        id: 'event',
        name: '事件/预言',
        description: '预言、诅咒、约定、大事件',
        keywords: ['预言', '诅咒', '约定', '誓言', '承诺', '赌约', '宿命', '前世', '今生', '轮回', '转世', '重生', '穿越', '系统', '任务', '大劫', '浩劫', '灾变', '乱世', '大战', '决战', '终局', '末日'],
        priority: 60,
        enabled: true,
        color: '#E91E63'
    },
    {
        id: 'secret',
        name: '秘密/阴谋',
        description: '隐藏的秘密、阴谋、计划',
        keywords: ['秘密', '阴谋', '计划', '布局', '算计', '图谋', '诡计', '圈套', '陷阱', '暗谋', '秘辛', '隐秘'],
        priority: 50,
        enabled: true,
        color: '#607D8B'
    },
    {
        id: 'organization',
        name: '势力/组织',
        description: '门派、势力、组织、家族',
        keywords: ['族', '派', '门', '宗', '教', '会', '盟', '帮', '团', '社', '世家', '家族', '商会', '佣兵团'],
        priority: 40,
        enabled: true,
        color: '#00BCD4'
    },
    {
        id: 'bloodline',
        name: '血脉/体质',
        description: '特殊血脉、体质、天赋',
        keywords: ['血脉', '体质', '天赋', '灵根', '道体', '圣体', '仙体', '魔体', '神体', '血脉之力', '天赋神通'],
        priority: 30,
        enabled: true,
        color: '#8BC34A'
    }
];

export const DEFAULT_FORESHADOW_CONFIG: ForeshadowConfig = {
    types: [...DEFAULT_FORESHADOW_TYPES],
    version: '1.0.0'
};
