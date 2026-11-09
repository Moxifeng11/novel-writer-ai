/**
 * frontmatter-schema.ts — 笔记属性 Schema（单一事实源）
 *
 * 三处共用：
 *  1. 右侧速览面板：按类型渲染可编辑属性（下拉/数字/列表/文本）；
 *  2. Bases 看板：列的显示名与顺序；
 *  3. 「补齐笔记属性」命令：找出旧文件缺失的必填属性。
 *
 * 只描述「插件自己写进 frontmatter 的键」，不接管用户自定义属性。
 * 纯函数，不依赖 Obsidian。
 */
import type { CreationMode } from './creation-mode';

/** 文件类型（属性面板与看板的分组依据） */
export type NotebookFileKind =
    | 'body'
    | 'character'
    | 'location'
    | 'faction'
    | 'item'
    | 'worldview'
    | 'settingLib'
    | 'foreshadow'
    | 'timeline'
    | 'relationship'
    | 'event'
    | 'foreshadowItem'
    | 'relation'
    | 'chapterDigest'
    | 'step'
    | 'unknown';

/**
 * PropertyValueType 类型定义。
 */
export type PropertyValueType = 'text' | 'number' | 'select' | 'list' | 'date';

/**
 * PropertySpec 类型定义。
 */
export interface PropertySpec {
    key: string;
    label: string;
    type: PropertyValueType;
    /** select 类型的候选值 */
    options?: string[];
    /** 必填：缺失时进入「补齐属性」清单 */
    required?: boolean;
    /** 缺省值（补齐命令写入；列表/数字按类型给默认值） */
    defaultValue?: string | number | string[];
    /** 一句话说明（面板 tooltip） */
    describe?: string;
}

/** 章节/单元状态的三态（与 ExecutionRunStore / 归档逻辑共用口径） */
export const BODY_STATUS_OPTIONS = ['pending', 'written', 'settled'] as const;
/**
 * 实体状态选项列表常量。
 */
export const ENTITY_STATUS_OPTIONS = ['active', 'inactive', 'dead', 'hidden'] as const;
/**
 * 角色角色选项列表常量。
 */
export const CHARACTER_ROLE_OPTIONS = ['主角', '配角', '反派', '路人'] as const;

const BODY_PROPERTIES: PropertySpec[] = [
    { key: '卷', label: '卷', type: 'text', describe: '所属卷（短篇/剧本可留空）' },
    { key: '章', label: '章/节/集', type: 'text' },
    { key: '标题', label: '标题', type: 'text' },
    { key: 'status', label: '状态', type: 'select', options: [...BODY_STATUS_OPTIONS], required: true, defaultValue: 'pending', describe: 'pending=骨架 / written=已写 / settled=已结算' },
    { key: 'word_count', label: '字数', type: 'number', required: true, defaultValue: 0, describe: '由保存与结算自动回写' },
    { key: 'writing_mode', label: '写作模式', type: 'select', options: ['pipeline', 'co-writer'], defaultValue: 'pipeline' },
    { key: '涉及人物', label: '涉及人物', type: 'list' },
    { key: '涉及地点', label: '涉及地点', type: 'list' },
    { key: '涉及势力', label: '涉及势力', type: 'list' },
    { key: '涉及物品功法', label: '涉及物品功法', type: 'list' },
];

const CHARACTER_PROPERTIES: PropertySpec[] = [
    { key: '姓名', label: '姓名', type: 'text', required: true },
    { key: '身份', label: '身份', type: 'select', options: [...CHARACTER_ROLE_OPTIONS] },
    { key: '性别', label: '性别', type: 'text' },
    { key: '年龄', label: '年龄', type: 'text' },
    { key: '修为等级', label: '修为等级', type: 'text', describe: '结算回写：当前境界' },
    { key: '所属势力', label: '所属势力', type: 'text', describe: '结算自动转 [[wiki-link]]' },
    { key: '当前位置', label: '当前位置', type: 'text', describe: '结算自动转 [[wiki-link]]' },
    { key: '当前状态', label: '当前状态', type: 'text' },
    { key: '当前情绪', label: '当前情绪', type: 'text' },
    { key: 'entity_status', label: '实体状态', type: 'select', options: [...ENTITY_STATUS_OPTIONS], defaultValue: 'active' },
    { key: '核心动机', label: '核心动机', type: 'text' },
    { key: '当前目标', label: '当前目标', type: 'text' },
    { key: '首次出场', label: '首次出场', type: 'text' },
    // 人物一致性（OOC）与连续性检查的输入字段：结算/分析会写，属性面板与 Bases 必须可见
    { key: '性格标签', label: '性格标签', type: 'text', describe: 'OOC 检测输入；多个标签用顿号分隔' },
    { key: '外貌特征', label: '外貌特征', type: 'text', describe: '外貌矛盾检测输入' },
    { key: '人物背景', label: '人物背景', type: 'text' },
    { key: '金手指/特殊能力', label: '金手指/特殊能力', type: 'text' },
    { key: '功法/技能树', label: '功法/技能树', type: 'text' },
    { key: '核心驱动力_软肋', label: '核心驱动力/软肋', type: 'text' },
    { key: '习惯性小动作', label: '习惯性小动作', type: 'text' },
    { key: '已知信息', label: '已知信息', type: 'text', describe: '连续性账本：角色当前知道什么' },
    { key: '伤势', label: '伤势', type: 'text' },
    { key: '持有物品', label: '持有物品', type: 'text' },
    { key: 'entity_last_changed_at', label: '最后变更时间', type: 'text', describe: 'ISO 时间；跨入口统一语义' },
    { key: 'entity_last_changed_chapter', label: '最后变更章', type: 'text' },
    { key: 'entity_last_seen_at', label: '最后出场章', type: 'text' },
];

const ITEM_PROPERTIES: PropertySpec[] = [
    { key: '名称', label: '名称', type: 'text', required: true },
    { key: '别称', label: '别称', type: 'text' },
    { key: '类型', label: '类型', type: 'text' },
    { key: '品阶/等级', label: '品阶/等级', type: 'text' },
    { key: '所属/归属', label: '所属/归属', type: 'text', describe: '结算自动转 [[wiki-link]]（所有权单侧写入）' },
    { key: '当前状态', label: '当前状态', type: 'text', describe: '在谁手里/封印/损毁' },
    { key: '效果', label: '效果', type: 'text', describe: '与结算写入的 frontmatter 键一致' },
    { key: '描述', label: '描述', type: 'text' },
    { key: 'entity_status', label: '实体状态', type: 'select', options: [...ENTITY_STATUS_OPTIONS], defaultValue: 'active' },
];

const LOCATION_PROPERTIES: PropertySpec[] = [
    { key: '名称', label: '名称', type: 'text', required: true },
    { key: '别称', label: '别称', type: 'text' },
    { key: '类型', label: '类型', type: 'text' },
    { key: '重要程度', label: '重要程度', type: 'text' },
    { key: '所在世界/区域', label: '所在世界/区域', type: 'text' },
    { key: '主要居民/势力', label: '主要居民/势力', type: 'text' },
    { key: '地理特征', label: '地理特征', type: 'text' },
    { key: '描述', label: '描述', type: 'text' },
    { key: 'entity_status', label: '实体状态', type: 'select', options: [...ENTITY_STATUS_OPTIONS], defaultValue: 'active' },
];

const FACTION_PROPERTIES: PropertySpec[] = [
    { key: '名称', label: '名称', type: 'text', required: true },
    { key: '别称', label: '别称', type: 'text' },
    { key: '类型', label: '类型', type: 'text' },
    { key: '领袖', label: '领袖', type: 'text', describe: '结算自动转 [[wiki-link]]' },
    { key: '地位/排名', label: '地位/排名', type: 'text' },
    { key: '描述', label: '描述', type: 'text' },
    { key: 'entity_status', label: '实体状态', type: 'select', options: [...ENTITY_STATUS_OPTIONS], defaultValue: 'active' },
];

const STEP_PROPERTIES: PropertySpec[] = [
    { key: '卷', label: '卷', type: 'text' },
    { key: '章', label: '章/节/集', type: 'text' },
    { key: 'step_status', label: '步骤状态', type: 'select', options: ['pending', 'generated', 'reviewed', 'stale'], required: true, defaultValue: 'pending' },
    { key: 'step_model', label: '生成模型', type: 'text' },
    { key: 'step_timestamp', label: '生成时间', type: 'text' },
];

/** 台账文件级摘要（时间线看板）：让 Bases/属性搜索能筛到看板 */
const TIMELINE_PROPERTIES: PropertySpec[] = [
    { key: '最后更新', label: '最后更新', type: 'text' },
    { key: '事件总数', label: '事件总数', type: 'number' },
    { key: '主线事件数', label: '主线事件数', type: 'number' },
    { key: '最新事件章节', label: '最新事件章节', type: 'text' },
];

/** 台账文件级摘要（伏笔库） */
const FORESHADOW_PROPERTIES: PropertySpec[] = [
    { key: '最后更新', label: '最后更新', type: 'text' },
    { key: '未回收数', label: '未回收数', type: 'number' },
    { key: '已回收数', label: '已回收数', type: 'number' },
    { key: '已废弃数', label: '已废弃数', type: 'number' },
];

/** 关系状态文件级摘要（逐对关系仍以正文表格为权威） */
const RELATIONSHIP_PROPERTIES: PropertySpec[] = [
    { key: '关系对数', label: '关系对数', type: 'number' },
    { key: '最后更新章节', label: '最后更新章节', type: 'text' },
    { key: '最后更新', label: '最后更新', type: 'text' },
];

/** 事件镜像笔记（可选，派生数据） */
const EVENT_PROPERTIES: PropertySpec[] = [
    { key: '事件名称', label: '事件名称', type: 'text', required: true },
    { key: '事件ID', label: '事件ID', type: 'text' },
    { key: '时间', label: '时间', type: 'text' },
    { key: '章节', label: '章节', type: 'text' },
    { key: '纪元', label: '纪元', type: 'select', options: ['background', 'main', 'unknown'] },
    { key: '地点', label: '地点', type: 'text' },
    { key: '涉及人物', label: '涉及人物', type: 'list' },
    { key: '类型', label: '类型', type: 'text' },
    { key: '重要程度', label: '重要程度', type: 'select', options: ['high', 'medium', 'low', 'unknown'] },
    { key: '状态', label: '状态', type: 'select', options: ['planned', 'occurred', 'unknown'] },
    { key: '影响', label: '影响', type: 'text' },
    { key: '关联伏笔', label: '关联伏笔', type: 'list' },
];

/** 伏笔条目镜像笔记（可选，派生数据） */
const FORESHADOW_ITEM_PROPERTIES: PropertySpec[] = [
    { key: '伏笔名称', label: '伏笔名称', type: 'text', required: true },
    { key: '伏笔ID', label: '伏笔ID', type: 'text' },
    { key: '重要程度', label: '重要程度', type: 'text' },
    { key: '埋设章节', label: '埋设章节', type: 'text' },
    { key: '计划回收', label: '计划回收', type: 'text' },
    { key: '当前状态', label: '当前状态', type: 'select', options: ['未回收', '已回收', '已废弃'] },
    { key: '相关人物', label: '相关人物', type: 'list' },
    { key: '关联主线', label: '关联主线', type: 'text' },
    { key: '回收章节', label: '回收章节', type: 'text' },
    { key: '回收方式', label: '回收方式', type: 'text' },
    { key: '关联事件', label: '关联事件', type: 'list' },
];

/** 关系对镜像笔记（可选，派生数据；权威仍是 关系状态.md） */
const RELATION_PROPERTIES: PropertySpec[] = [
    { key: '人物A', label: '人物A', type: 'text', required: true },
    { key: '人物B', label: '人物B', type: 'text', required: true },
    { key: '关系ID', label: '关系ID', type: 'text' },
    { key: '关系类型', label: '关系类型', type: 'text' },
    { key: 'trust', label: '信任', type: 'number' },
    { key: 'attraction', label: '吸引', type: 'number' },
    { key: 'fear', label: '恐惧', type: 'number' },
    { key: 'resentment', label: '怨恨', type: 'number' },
    { key: 'dependence', label: '依赖', type: 'number' },
    { key: '关系状态', label: '关系状态', type: 'text' },
    { key: '最后更新章节', label: '最后更新章节', type: 'text' },
];

/** 章节摘要（剧情记忆） */
const CHAPTER_DIGEST_PROPERTIES: PropertySpec[] = [
    { key: '章', label: '章', type: 'text', required: true },
    { key: '标题', label: '标题', type: 'text' },
    { key: '在场人物', label: '在场人物', type: 'list' },
    { key: '关键事件', label: '关键事件', type: 'list' },
    { key: '未回收线索', label: '未回收线索', type: 'list' },
    { key: '新事实', label: '新事实', type: 'list' },
    { key: '未兑现承诺', label: '未兑现承诺', type: 'list' },
    { key: '结尾钩子', label: '结尾钩子', type: 'text' },
    { key: '时间跨度', label: '时间跨度', type: 'text' },
];

/** 类型 → 属性清单（顺序即面板与看板的列顺序） */
export const FRONTMATTER_SCHEMAS: Record<NotebookFileKind, PropertySpec[]> = {
    body: BODY_PROPERTIES,
    character: CHARACTER_PROPERTIES,
    location: LOCATION_PROPERTIES,
    faction: FACTION_PROPERTIES,
    item: ITEM_PROPERTIES,
    worldview: [
        { key: '世界名称', label: '世界名称', type: 'text' },
        { key: '世界类型', label: '世界类型', type: 'text' },
        { key: '时代背景', label: '时代背景', type: 'text' },
        { key: '核心规则', label: '核心规则', type: 'text' },
    ],
    settingLib: [{ key: '名称', label: '名称', type: 'text' }],
    foreshadow: FORESHADOW_PROPERTIES,
    timeline: TIMELINE_PROPERTIES,
    relationship: RELATIONSHIP_PROPERTIES,
    event: EVENT_PROPERTIES,
    foreshadowItem: FORESHADOW_ITEM_PROPERTIES,
    relation: RELATION_PROPERTIES,
    chapterDigest: CHAPTER_DIGEST_PROPERTIES,
    step: STEP_PROPERTIES,
    unknown: [],
};

/** 面板标题文案 */
export const FILE_KIND_LABELS: Record<NotebookFileKind, string> = {
    body: '章节正文',
    character: '人物',
    location: '地点',
    faction: '势力',
    item: '物品功法',
    worldview: '世界观',
    settingLib: '设定库',
    foreshadow: '伏笔库',
    timeline: '时间线',
    relationship: '关系状态',
    event: '时间线事件',
    foreshadowItem: '伏笔条目',
    relation: '关系对',
    chapterDigest: '章节摘要',
    step: '步骤结果',
    unknown: '其他笔记',
};

const TAG_TO_KIND: Record<string, NotebookFileKind> = {
    '正文': 'body',
    '短篇正文': 'body',
    '剧本': 'body',
    '人物': 'character',
    '地点': 'location',
    '势力': 'faction',
    '物品功法': 'item',
    '物品': 'item',
    '世界观': 'worldview',
    '设定库': 'settingLib',
    '伏笔库': 'foreshadow',
    '时间线': 'timeline',
    '关系状态': 'relationship',
    '事件': 'event',
    '伏笔': 'foreshadowItem',
    '剧情记忆': 'chapterDigest',
    '信息规划': 'step',
    '大纲摘要': 'step',
    '情节蒸馏': 'step',
    '分析报告': 'step',
    '结算表': 'step',
    '质量控制': 'step',
    '情绪规划': 'step',
    '角色灵魂': 'step',
    '审查报告': 'step',
    '自检报告': 'step',
    '修正记录': 'step',
    '最终修正': 'step',
    '连贯性审查': 'step',
};

/** 路径兜底（旧文件没有标签时） */
const PATH_RULES: Array<{ test: RegExp; kind: NotebookFileKind }> = [
    // 内容目录位于项目目录之下（`短篇小说/书名/短篇创作/03-正文/`），
    // 匹配任意层级，兼容顶层与嵌套两种放置方式。
    { test: /(^|\/)03-大纲与章节\/正文\//, kind: 'body' },
    { test: /(^|\/)短篇创作\/(?:.*\/)?03-正文\//, kind: 'body' },
    { test: /(^|\/)剧本创作\/(?:.*\/)?03-剧本\//, kind: 'body' },
    { test: /(^|\/)03-大纲与章节\/步骤结果\//, kind: 'step' },
    { test: /(^|\/)01-世界架构\/人物\//, kind: 'character' },
    { test: /(^|\/)01-世界架构\/地点\//, kind: 'location' },
    { test: /(^|\/)01-世界架构\/势力\//, kind: 'faction' },
    { test: /(^|\/)01-世界架构\/物品功法\//, kind: 'item' },
    { test: /(^|\/)01-世界架构\/.*世界观/, kind: 'worldview' },
    { test: /(^|\/)01-世界架构\/.*设定库/, kind: 'settingLib' },
    // 台账与记忆：没有标签的旧项目也能被识别（顺序：具体文件在目录规则之前）
    { test: /(^|\/)02-时间线与伏笔\/时间线看板\.md$/, kind: 'timeline' },
    { test: /(^|\/)02-时间线与伏笔\/伏笔库\.md$/, kind: 'foreshadow' },
    { test: /(^|\/)01-世界架构\/关系状态\.md$/, kind: 'relationship' },
    { test: /(^|\/)02-时间线与伏笔\/时间线事件\//, kind: 'event' },
    { test: /(^|\/)02-时间线与伏笔\/伏笔\//, kind: 'foreshadowItem' },
    { test: /(^|\/)01-世界架构\/关系\//, kind: 'relation' },
    { test: /(^|\/)04-项目总控\/剧情记忆\//, kind: 'chapterDigest' },
];

/**
 * frontmatter.tags 可能是数组或逗号串
 *
 * @param tags - 标签列表
 * @returns 结果数组
 */
export function readTagList(tags: unknown): string[] {
    if (Array.isArray(tags)) return tags.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean);
    if (typeof tags === 'string') {
        return tags.split(/[,，\s]+/).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean);
    }
    return [];
}

/**
 * `nw/实体/人物` → 人物；`nw/步骤/分析报告` → step
 *
 * @param tag - 标签
  * @returns NotebookFileKind 或 null
 */
function kindFromNamespaceTag(tag: string): NotebookFileKind | null {
    if (!tag.startsWith('nw/')) return null;
    const rest = tag.slice(3);
    if (rest === '正文') return 'body';
    if (rest.startsWith('实体/')) {
        const entity = rest.slice(3);
        if (entity === '人物') return 'character';
        if (entity === '地点') return 'location';
        if (entity === '势力') return 'faction';
        if (entity === '物品') return 'item';
        if (entity === '事件') return 'event';
        if (entity === '伏笔') return 'foreshadowItem';
        if (entity === '关系') return 'relation';
        return null;
    }
    if (rest.startsWith('设定/')) {
        const setting = rest.slice(3);
        if (setting === '世界观') return 'worldview';
        if (setting === '设定库') return 'settingLib';
        if (setting === '伏笔库') return 'foreshadow';
        if (setting === '时间线') return 'timeline';
        if (setting === '关系状态') return 'relationship';
        if (setting === '剧情记忆') return 'chapterDigest';
        return null;
    }
    if (rest.startsWith('步骤/')) return 'step';
    return null;
}

/**
 * 判定文件类型：`nw/*` 标签优先 → 旧标签 → 路径兜底 → unknown。
 * @param frontmatter - frontmatter
 * @param path - 路径
  * @returns NotebookFileKind 实例
 */
export function resolveFileKind(frontmatter: Record<string, unknown> | null | undefined, path = ''): NotebookFileKind {
    const tags = readTagList(frontmatter?.['tags']);
    for (const tag of tags) {
        const kind = kindFromNamespaceTag(tag);
        if (kind) return kind;
    }
    for (const tag of tags) {
        const kind = TAG_TO_KIND[tag];
        if (kind) return kind;
    }
    for (const rule of PATH_RULES) {
        if (rule.test.test(path)) return rule.kind;
    }
    return 'unknown';
}

/**
 * 缺失的必填属性（只查 required；null/undefined/空串都算缺失）
 *
 * @param kind - 种类
 * @param frontmatter - frontmatter
 * @returns 结果数组
 */
export function findMissingProperties(kind: NotebookFileKind, frontmatter: Record<string, unknown> | null | undefined): PropertySpec[] {
    const schema = FRONTMATTER_SCHEMAS[kind] || [];
    const fm = frontmatter || {};
    return schema.filter((spec) => {
        if (!spec.required) return false;
        const value = fm[spec.key];
        if (value === undefined || value === null) return true;
        if (typeof value === 'string') return value.trim() === '';
        return false;
    });
}

/**
 * 某类型的全部必填属性（补齐命令用）
 *
 * @param kind - 种类
 * @returns 结果数组
 */
export function requiredProperties(kind: NotebookFileKind): PropertySpec[] {
    return (FRONTMATTER_SCHEMAS[kind] || []).filter((spec) => spec.required);
}

/**
 * 模式 → 正文标签（写入端与看板 filter 共用）
 *
 * @param mode - 模式
 * @returns 文本结果
 */
export function bodyLegacyTagForMode(mode: CreationMode): string {
    if (mode === 'short') return '短篇正文';
    if (mode === 'script') return '剧本';
    return '正文';
}