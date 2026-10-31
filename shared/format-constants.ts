/**
 * 格式常量 —— 所有模板字段名和正则模式的唯一真相源。
 *
 * 所有解析器、校验器、UI 渲染器必须从此文件导入字段名/正则，
 * 禁止在业务代码中硬编码字段名或正则模式。
 *
 * 修改模板字段时只需修改此文件，编译器自动保证所有引用点同步。
 *
 * @see 元文件/04-项目总控/格式规范知识图谱.md
 */

// ============================================================
// 一、分卷大纲（Volumes & Chapters）
// ============================================================

/** 卷头：### 第N卷 */
export const RE_VOLUME_HEADER = /^###\s+(第\d+卷)/;

/** 卷名字段 */
export const FIELD_VOLUME_NAME = '卷名';

/** 卷名解析：《卷名》 */
export const RE_VOLUME_NAME = /《(.+)》/;

/** 章节范围字段 */
export const FIELD_CHAPTER_RANGE = '章节范围';

/** 章节范围：第X章 - 第Y章 */
export const RE_CHAPTER_RANGE = /第(\d+)章\s*-\s*第(\d+)章/;

/** 章节范围解析（数字提取，兼容 - ~ 至） */
export const RE_RANGE_NUMBERS = /(\d+)[\-~至](\d+)/;

/** 表格行：| 章号 | 核心冲突 | */
export const RE_OUTLINE_TABLE_ROW = /^\|\s*(\d+)\s*\|(.+)\|/;

/** 总字数目标字段 */
export const FIELD_TOTAL_WORDS = '总字数目标';

/** 总章节数字段 */
export const FIELD_TOTAL_CHAPTERS = '总章节数';

/** 分卷数字段 */
export const FIELD_VOLUME_COUNT = '分卷数';

/** 每章字数 */
export const FIELD_WORDS_PER_CHAPTER = '每章字数';

/** 卷范围解析（用于项目总览，不提取数字） */
export const RE_VOLUME_RANGE = /章节范围[：:]\s*(.+?)(?:\n\|$)/;

/** 大纲中按章号查找段落 */
export const chapterOutlineSection = (chapterNum: number) =>
    new RegExp(`###?\\s*第${chapterNum}章[\\s\\S]*?(?=\\n###|$)|\\|\\s*${chapterNum}\\s*\\|[\\s\\S]*?(?=\\n\\|\\s*\\d+\\s*\\||$)`);

/**
 * 从「合并后的分卷大纲」里截出指定卷的段落。
 * chapPlan 若在全部卷拼接内容里按章号取段，同号章（重编号/残留旧卷）会取到别卷的规划；
 * 先按 `### 第N卷` 切出当前卷，再在其中按章号匹配。找不到卷头时返回全文（行为不变）。
 */
export function volumeSectionSlice(content: string, volume: string | undefined): string {
    const text = String(content || '');
    const volName = String(volume || '').trim();
    if (!volName) return text;
    // 注意：\b 对 CJK 无效（「卷」不是 \w），用 (?![0-9]) 防止「第1卷」匹配到「第11卷」
    const start = text.search(new RegExp(`^###?[ \\t]*${volName}(?![0-9])`, 'm'));
    if (start < 0) return text;
    const rest = text.slice(start);
    // 逐行找下一个卷头（跳过当前行，避免 slice 偏移把当前卷头错配成下一卷）
    const lines = rest.split('\n');
    let end = lines.length;
    for (let i = 1; i < lines.length; i++) {
        if (/^###?[ \t]*第[0-9]+卷(?![0-9])/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(0, end).join('\n');
}

// ============================================================
// 二、人物（Characters）
// ============================================================

/** 人物显示字段（formatCharacters 使用的 14 个 key） */
export const CHARACTER_DISPLAY_KEYS = [
    '年龄', '身份', '性格标签', '核心动机', '核心驱动力_软肋',
    '习惯性小动作', '当前状态', '当前情绪', '金手指/特殊能力',
    '功法/技能树', '所属势力', '性别', '外貌特征', '当前目标',
] as const;

/** 人物文件排除关键词 */
export const CHARACTER_FILE_EXCLUDE = '人物模板';

// ============================================================
// 三、大纲摘要完整性检查（Outline Integrity）
// ============================================================

export const OUTLINE_CHECK_FIELDS = [
    { label: '本章在全书中的位置', minLen: 10 },
    { label: '关键场景', minLen: 3 },
    { label: '需要呈现的信息', minLen: 10 },
    { label: '情感基调', minLen: 5 },
    { label: '结尾钩子', minLen: 5 },
] as const;

// ============================================================
// 四、信息规划完整性检查（Info Plan Integrity）
// ============================================================

export const INFOPLAN_CHECK_FIELDS = [
    '章名',
    '核心冲突',
    '熵预算',
    '自信息目标',
    '互信息强化',
    '伏笔操作',
] as const;

/** 旧格式回退字段 */
export const INFOPLAN_LEGACY_FIELDS = ['章名', '核心冲突'] as const;

// ============================================================
// 五、写作规则（Writing Rules）
// ============================================================

/** 写作规则 section 匹配关键词 */
export const WRITING_RULE_TITLES = [
    '格式参考',
    '写作自检',
    '写作前默念',
] as const;

/** 写作规则文件路径（项目内） */
export const WRITING_RULES_PATH_PROJECT = '00-系统模板/写作规则.md';

/** 写作规则文件路径（元文件回退） */
export const WRITING_RULES_PATH_TEMPLATE = '元文件/00-系统模板/写作规则.md';

// ============================================================
// 六、时间线（Timeline）
// ============================================================

/** 时间线表格列名 */
export const TIMELINE_COLUMNS = ['#', '事件名称', '时间', '地点', '涉及人物', '章节', '类型'] as const;

/** 时间线表格 Markdown 表头 */
export const TIMELINE_TABLE_HEADER = '| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |\n|---|---|---|---|---|---|---|';

// ============================================================
// 七、伏笔（Foreshadow）
// ============================================================

/** 伏笔区块分类关键词 */
export const FORESHADOW_SECTION_UNREVEALED = '未回收';
export const FORESHADOW_SECTION_REVEALED = '已回收';
export const FORESHADOW_SECTION_ABANDONED = '废弃';

// ============================================================
// 八、章节状态（Chapter Status）
// ============================================================

/** 章节状态枚举（v4.0: 英文值 + 旧值保留兼容） */
export const CHAPTER_STATUS = {
    PENDING: 'pending',           // v4.0: 新建/待写
    WRITTEN: 'written',           // v4.0: AI/用户已写完
    SETTLED: 'settled',           // v4.0: 已结算
    /** v3 旧值，保留向后兼容 */
    DRAFT: '草稿',
    /** v3 旧值，保留向后兼容 */
    DONE: '已完稿',
    REVISE: '需修改',
} as const;

export type ChapterStatus = typeof CHAPTER_STATUS[keyof typeof CHAPTER_STATUS];

// ============================================================
// 九、同人设定库（Fanfic Settings）
// ============================================================

/** 同人设定 frontmatter 必填字段 */
export const FF_FRONTMATTER_KEYS = ['作品名称', '作品类型', '作者'] as const;

/** 原作核心设定字段 */
export const FF_CORE_KEYS = ['世界观类型', '力量体系', '核心规则'] as const;

/** 创作规则字段 */
export const FF_RULE_KEYS = ['必须遵守的原作规则', '允许改编的范围', '禁止触及的红线'] as const;

/** 原作剧情时间线表格列名 */
export const FF_CANON_TIMELINE_COLS = ['时间节点', '原作事件', '涉及人物', '章节参考', '你的同人如何切入'] as const;

/** 故事背景时间线表格列名 */
export const FF_FAN_TIMELINE_COLS = ['你的时间节点', '你的事件', '对应原作时间', '涉及人物'] as const;

/** 人物/势力子字段 */
export const FF_CHARACTER_SUB_KEYS = ['原作定位', '在同人中的变化'] as const;

/** FF KV 字段正则生成器 */
export const RE_FF_KV = (key: string) => new RegExp(`- \\*\\*${key}\\*\\*[：:]\\s*(.+)`);

/** FF 人物行正则 */
export const RE_FF_CHARACTER = /^- \*\*(.+?)\*\*[：:]/;

/** FF 势力行正则 */
export const RE_FF_FACTION = /^- \*\*(.+?)\*\*[：:](\s*\n\s*- \*\*原作定位\*\*)/;

// ============================================================
// 十、世界观总览（Worldview）
// ============================================================

/** 世界观 9 个模块名 */
export const WV_SECTIONS = [
    '世界层级体系',
    '力量体系',
    '货币体系',
    '势力分类',
    '地理格局',
    '历史大事记',
    '特殊规则',
    '文化与社会',
    '与主线关联',
] as const;

/** 设定库 8 个模块名（与 AI 模板一致） */
export const SL_SECTIONS = [
    '世界观底层规则',
    '核心设定（不可变更）',
    '力量体系详情',
    '科技水平',
    '势力分布',
    '地理/区域',
    '关键历史事件',
    '当前故事阶段',
] as const;

/** 世界观 frontmatter 字段 */
export const WV_FRONTMATTER_KEYS = ['世界名称', '项目名称'] as const;

/** 世界观每个模块的必填字段 map */
export const WV_SECTION_FIELDS: Record<string, string[]> = {
    '世界层级体系': ['层级数量', '各层级概要', '跨层级关系'],
    '力量体系': ['修炼体系名称', '境界划分', '力量来源', '特殊力量规则'],
    '货币体系': ['通用货币', '各层级货币', '兑换关系'],
    '势力分类': ['主要势力类型', '势力分布', '势力关系格局'],
    '地理格局': ['地理概要', '重要区域'],
    '历史大事记': [],  // 使用子标题 ### 远古/近代/近期
    '特殊规则': ['世界法则', '禁忌/限制'],
    '文化与社会': ['社会结构', '价值观念', '风俗禁忌'],
    '与主线关联': ['世界观对主线的推动', '世界观的潜在变化'],
};

/** 散文检测阈值（连续中文字符数，超过即判定为 prose） */
export const WV_PROSE_MAX_LENGTH = 200;

/** 世界观 section 正则 */
export const RE_WV_SECTION = (name: string) => new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`);

/** 世界观 KV 字段正则生成器 */
export const RE_WV_KV = (key: string) => new RegExp(`- \\*\\*${key}\\*\\*[：:]\\s*(.+)`);

// ============================================================
// 十一、分卷大纲 + 时间线看板补充
// ============================================================

/** 每卷必填的 12 个字段名 */
export const OUTLINE_REQUIRED_KEYS = [
    '卷名', '章节范围', '核心冲突', '主要事件', '人物弧光',
    '本卷字数', '本卷高潮', '结尾过渡',
    '三幕结构', '爽点节奏', '反转路线', '情绪曲线',
] as const;

/** 分卷大纲表格表头 */
export const OUTLINE_TABLE_HEADER = '| 章号 | 核心冲突 |';

/** 分卷大纲 KV 正则生成器 */
export const RE_OUTLINE_KV = (key: string) => new RegExp(`- \\*\\*${key}\\*\\*[：:]\\s*(.+)`);

/** 时间线看板表头正则 */
export const RE_TIMELINE_BOARD_SECTION = /##\s+纪元\s*\/\s*时间轴/;

/** 时间线看板表格列名 */
export const TIMELINE_BOARD_COLS = ['#', '事件名称', '时间', '地点', '涉及人物', '章节', '类型'] as const;

// ============================================================
// 十二、人物卡字段常量（对应元文件/00-系统模板/人物模板.md）
// ============================================================

/** 人物卡 YAML frontmatter 全部字段（18个，含 tags） */
export const CHARACTER_MANDATORY_FIELDS = [
    'tags',
    '姓名',
    '年龄',
    '身份',
    '人物背景',
    '外貌特征',
    '当前目标',
    '核心动机',
    '核心驱动力_软肋',
    '习惯性小动作',
    '当前状态',
    '当前情绪',
    '性格标签',
    '金手指/特殊能力',
    '功法/技能树',
    '所属势力',
    'entity_status',
    'entity_created_at',
] as const;

/** V2 角色灵魂层字段（YAML 嵌套对象 character_core: 下的9个字段） */
export const CHARACTER_SOUL_FIELDS = [
    'desire',
    'fear',
    'obsession',
    'shame',
    'trauma',
    'weakness',
    'soft_spot',
    'rage_trigger',
    'moral_boundary',
] as const;

/**
 * 人物卡 YAML 嵌套必填组：父键 → 子键列表。
 * 生成提示词强制要求这些嵌套结构，模板与校验器必须保持一致，
 * 否则会出现「提示词要求了、模板没写、校验也不查」的信息缺口。
 */
export const CHARACTER_NESTED_FIELD_GROUPS: Record<string, readonly string[]> = {
    character_core: CHARACTER_SOUL_FIELDS,
    性格三层: ['表层_面具', '中层_真实', '深层_内核'],
    角色弧光: ['起点状态', '成长触发点', '终点状态', '弧光类型'],
};

/**
 * 人物卡中「模板提供但 AI 可按上下文推断」的字段。
 * 不纳入硬校验（首次出场等系统信息允许留空），但生成提示词应尽量填写。
 */
export const CHARACTER_CONTEXTUAL_FIELDS = [
    '性别',
    '首次出场',
    '修为等级',
    '当前位置',
] as const;

/** 人物卡正文分节（7个 ## 标题，V2增加「角色灵魂层」） */
export const CHARACTER_BODY_SECTIONS_V2 = [
    '确定性设定（已揭露，不可违背）',
    '不确定性（未解之谜 / 角色弧光）',
    '与其他角色的互信息',
    '自信息事件储备（低概率但合理的惊喜行为）',
    '功法/技能树',
    '角色灵魂层（欲望/恐惧/创伤/底线）',
    '变更记录',
] as const;

/** 人物卡正文分节（6个 ## 标题，V1 兼容） */
export const CHARACTER_BODY_SECTIONS = [
    '确定性设定（已揭露，不可违背）',
    '不确定性（未解之谜 / 角色弧光）',
    '与其他角色的互信息',
    '自信息事件储备（低概率但合理的惊喜行为）',
    '功法/技能树',
    '变更记录',
] as const;

// ============================================================
// 十三、地点 fields（对应 元文件/00-系统模板/地点模板.md）
// ============================================================

export const LOCATION_FRONTMATTER_KEYS = [
    'tags',
    '名称',
    '别称',
    '类型',
    '描述',
    '重要程度',
    '地理特征',
    '主要居民/势力',
    '所在世界/区域',
] as const;

/** 地点卡必须有非空值的字段（系统字段不在此列，允许初始为空） */
export const LOCATION_REQUIRED_VALUE_KEYS = [
    '名称',
    '类型',
    '描述',
    '重要程度',
    '地理特征',
    '主要居民/势力',
    '所在世界/区域',
] as const;

// ============================================================
// 十四、势力 fields（对应 元文件/00-系统模板/势力模板.md）
// ============================================================

export const FACTION_FRONTMATTER_KEYS = [
    'tags',
    '名称',
    '别称',
    '类型',
    '描述',
    '领袖',
    '地位/排名',
    'entity_status',
    'entity_created_at',
] as const;

/** 势力卡必须有非空值的字段（系统字段不在此列，允许初始为空） */
export const FACTION_REQUIRED_VALUE_KEYS = [
    '名称',
    '类型',
    '描述',
    '领袖',
    '地位/排名',
] as const;

// ============================================================
// 十五、物品功法 fields（对应 元文件/00-系统模板/物品功法模板.md）
// ============================================================

export const ITEM_FRONTMATTER_KEYS = [
    'tags',
    '名称',
    '类型',
    '描述',
    '效果',
    '品阶/等级',
    '所属/归属',
    'entity_status',
    'entity_created_at',
] as const;

/** 物品功法卡必须有非空值的字段（系统字段不在此列，允许初始为空） */
export const ITEM_REQUIRED_VALUE_KEYS = [
    '名称',
    '类型',
    '描述',
    '效果',
    '品阶/等级',
    '所属/归属',
] as const;

// ============================================================
// 十六、通用实体正文分节
// ============================================================

/** 地点/势力/物品功法 共用的正文分节（4个 ## 标题） */
export const ENTITY_BODY_SECTIONS = [
    '确定性设定（已揭露，不可违背）',
    '不确定性（未解之谜 / 剧情潜力）',
    '与其他元素的互信息',
    '变更记录',
] as const;

/**
 * 短标题别名映射：校验器同时接受实体模板中的短标题和生成器中的长标题。
 * 真实模板使用短标题（如「## 确定性设定」），生成器要求长标题（如「## 确定性设定（已揭露，不可违背）」）。
 * 此映射使校验器不因标题形式差异而误判有效实体为不完整。
 */
export const ENTITY_SHORT_TITLE_ALIASES: Record<string, string[]> = {
    '确定性设定（已揭露，不可违背）': ['确定性设定'],
    '不确定性（未解之谜 / 剧情潜力）': ['不确定性'],
};

/**
 * 人物正文章节短标题别名映射：校验器同时接受正文中的短标题和 CHARACTER_BODY_SECTIONS_V2 中的长标题。
 * 人物模板正文使用短标题（如「## 关系网」），生成器要求长标题（如「## 与其他角色的互信息」）。
 */
export const CHARACTER_SHORT_TITLE_ALIASES: Record<string, string[]> = {
    '确定性设定（已揭露，不可违背）': ['确定性设定'],
    '不确定性（未解之谜 / 角色弧光）': ['不确定性'],
    '自信息事件储备（低概率但合理的惊喜行为）': ['自信息事件储备'],
    '与其他角色的互信息': ['关系网'],
    '功法/技能树': ['功法/技能'],
    '角色灵魂层（欲望/恐惧/创伤/底线）': ['灵魂层'],
};
