/**
 * creation-mode.ts — 创作模式领域层（长篇 / 短篇 / 剧本）
 *
 * 三个模式共用项目与章节基础设施，但拥有独立的：
 * - 篇幅与单元（章 / 节 / 集）
 * - 平台分类与商业化规格
 * - 提示词覆盖块
 * - 导出规范
 *
 * 长篇默认返回空覆盖，保证原有 11 步与提示词完全不变。
 */

/**
 * 创作模式。
 */
export type CreationMode = 'long' | 'short' | 'script';
/**
 * 性别频道。
 */
export type GenderChannel = '女频' | '男频' | '通用';

import {
    buildLongStoryPromptBlock,
    buildStorySettingsMetaSection,
    getStoryStructure,
    getStructureStageSummary,
    getStoryOptionLabel,
    parseStorySettingsFromProjectMeta,
    type LongStorySettings,
    type StoryStructureId,
} from './story-structure';

/**
 * 创作模式规格。
 */
export interface CreationModeSpec {
    mode: CreationMode;
    label: string;
    icon: string;
    description: string;
    unitLabel: string;
    unitPlural: string;
    targetWords: { min: number; max: number; default: number };
    targetUnits: { min: number; max: number; default: number };
}

/**
 * 模式规格表。
 */
export const CREATION_MODE_SPECS: Record<CreationMode, CreationModeSpec> = {
    long: {
        mode: 'long', label: '长篇小说', icon: '📖',
        description: '分卷、多章、11 步流水线；面向长篇连载。',
        unitLabel: '章', unitPlural: '章',
        targetWords: { min: 100000, max: 5000000, default: 1000000 },
        targetUnits: { min: 10, max: 5000, default: 200 },
    },
    short: {
        mode: 'short', label: '短篇小说', icon: '📄',
        description: '番茄短篇 5–10 万字，快开篇、高密度反转、单线强情绪。',
        unitLabel: '节', unitPlural: '节',
        targetWords: { min: 50000, max: 100000, default: 80000 },
        targetUnits: { min: 8, max: 40, default: 20 },
    },
    script: {
        mode: 'script', label: '短剧剧本', icon: '🎬',
        description: '红果短剧快车道规格：分集、场次、强钩子与可拍对白。',
        unitLabel: '集', unitPlural: '集',
        targetWords: { min: 50000, max: 100000, default: 80000 },
        targetUnits: { min: 40, max: 120, default: 80 },
    },
};

/**
 * 短篇题材。
 */
export interface ShortStoryCategory {
    name: string;
    definition: string;
    gender: GenderChannel;
}

/** 番茄短篇小说分类（以平台分类页为准，保持名称与性别频道一致）。 */
export const SHORT_STORY_CATEGORIES: ShortStoryCategory[] = [
    { name: '婚姻家庭', gender: '女频', definition: '现代背景，以女性视角，讲述婚姻或家庭生活，围绕伴侣、父母、公婆、子女、姑嫂、亲戚矛盾等关系展开的故事。' },
    { name: '女生生活', gender: '女频', definition: '现代背景，以女性视角，围绕真假千金、职场、寝室、同学、师生等关系展开的故事。' },
    { name: '男生生活', gender: '男频', definition: '现代背景，以男性视角，围绕职场、家庭、朋友关系等展开的故事，主线非感情线。' },
    { name: '都市日常', gender: '男频', definition: '现代背景，以男性视角，围绕都市生活、赘婿、逆袭、升级流、退婚流等元素展开的故事，主线非感情线。' },
    { name: '女性成长', gender: '女频', definition: '现代或古代背景，以女性视角，主线非感情线，主要以女主主观意愿上的成长、女性间的互助、救赎等为主线的故事（不包含复仇、打脸、虐渣类故事）。' },
    { name: '现言甜宠', gender: '女频', definition: '现代背景，以女性视角，围绕校园、职场、婚恋等展开，讲述男主宠女主、男女主互相暗恋或明恋类的幸福美满类故事。' },
    { name: '青春虐恋', gender: '女频', definition: '现代背景，以女性视角，讲述男女主恋爱、谈婚论嫁阶段的言情故事，情绪基调为虐恋、先虐后甜或先虐后爽。' },
    { name: '虐心婚恋', gender: '女频', definition: '现代背景，以女性视角，讲述男女主婚姻阶段的言情故事，情绪基调为虐恋、先虐后甜或先虐后爽。' },
    { name: '男生情感', gender: '男频', definition: '现代背景，以男性视角，言情为主线，讲述两性情感的言情类故事。' },
    { name: '宫斗宅斗', gender: '女频', definition: '古代背景，以女性视角，背景发生在宫廷或后宅，情节以宫斗、宅斗、女性权谋为主线推进的故事。' },
    { name: '古风世情', gender: '女频', definition: '古代背景，以女性视角，围绕家庭、朋友、师徒、姐妹等关系展开的故事，主线非感情线。' },
    { name: '古言甜宠', gender: '女频', definition: '古代背景，以女性视角，言情为主线，讲述男女主互相暗恋或明恋的幸福美满类故事。' },
    { name: '古言虐恋', gender: '女频', definition: '古代背景，以女性视角，讲述男女主两性情感的言情故事，情绪基调为虐恋、先虐后甜或先虐后爽。' },
    { name: '历史古代', gender: '男频', definition: '古代背景，以男性视角，围绕历史、武侠、权谋、言情展开的故事。' },
    { name: '年代', gender: '通用', definition: '四五十年代到九十年代背景的文，且年代画风明显。' },
    { name: '民国旧影', gender: '通用', definition: '二十世纪初到新中国成立前的民国背景文，且民国画风明显。' },
    { name: '玄幻仙侠', gender: '通用', definition: '背景为东方玄幻、仙侠世界、西方奇幻，主线围绕非现实设定推进，世界观有虚构成分的故事。' },
    { name: '悬疑惊悚', gender: '通用', definition: '围绕悬疑、推理、规则怪谈、校园怪谈、民俗、诡秘、奇闻、风水、灵异、惊悚类元素展开的故事。' },
    { name: '女频脑洞', gender: '女频', definition: '女性视角，背景非现实向，故事主线以系统、金手指、空间、弹幕、穿书等脑洞元素来推进剧情的故事。' },
    { name: '男频脑洞', gender: '男频', definition: '男性视角，背景非现实向，故事主线以系统、金手指、空间、弹幕、穿书等脑洞元素来推进剧情的故事。' },
    { name: '女频衍生', gender: '女频', definition: '明确游戏、动漫、影视作品、公版书籍等既有作品的女频二次创作故事。' },
    { name: '男频衍生', gender: '男频', definition: '明确游戏、动漫、影视作品、公版书籍等既有作品的男频二次创作故事。' },
    { name: '纯爱', gender: '女频', definition: '以双男主或双女主之间感情发展作为主线的故事。' },
    { name: '其他', gender: '通用', definition: '以上所有主分类无法囊括的故事，可以选择该分类。' },
];

/**
 * 剧本类型规格。
 */
export interface ScriptGenreSpec {
    name: string;
    coreHook: string;
    coreConflict: string;
    payoff: string;
}

/** 红果短剧快车道常见类型；侧重可拍、强冲突、强兑现。 */
export const SCRIPT_GENRES: ScriptGenreSpec[] = [
    { name: '都市逆袭', coreHook: '底层主角被当众羞辱，真实身份/能力即将揭晓', coreConflict: '阶层压制与身份反转', payoff: '当众打脸、身份曝光、资源反杀' },
    { name: '战神归来', coreHook: '退役战神隐姓埋名，家人/爱人被欺辱', coreConflict: '隐藏身份与保护家人', payoff: '旧部集结、强强对峙、碾压反派' },
    { name: '甜宠', coreHook: '契约/闪婚/误会的男女主被迫同居', coreConflict: '先婚后爱与外部阻挠', payoff: '宠溺名场面、公开护短、关系升级' },
    { name: '虐恋', coreHook: '深爱被误解/背叛，主角心死离开', coreConflict: '误会、错过与追悔', payoff: '真相揭开、追妻火葬场、情绪释放' },
    { name: '复仇', coreHook: '主角被害到家破人亡，换身份归来', coreConflict: '复仇计划与旧情牵制', payoff: '逐个击破、真凶现形、反转收网' },
    { name: '家庭伦理', coreHook: '家庭资源/亲情被偏心与算计撕裂', coreConflict: '婆媳、亲子、财产与边界', payoff: '当众对峙、真相摊牌、主角独立' },
    { name: '古装权谋', coreHook: '主角被卷入宫廷/宅斗死局', coreConflict: '权谋站队与自保反击', payoff: '计中计、身份反转、掌权' },
    { name: '悬疑', coreHook: '一桩不可能的案件/规则怪谈开场', coreConflict: '追查真相与自身秘密', payoff: '线索闭环、真凶反转、危机解除' },
    { name: '脑洞', coreHook: '系统/穿书/读心/空间等异常规则降临', coreConflict: '用规则破局与规则代价', payoff: '规则妙用、身份升级、世界真相' },
    { name: '年代', coreHook: '知青/厂矿/供销社背景下的家庭变故', coreConflict: '时代机会与家庭拖累', payoff: '抓住风口、打脸偏心、生活翻盘' },
    { name: '民国', coreHook: '乱世中家族/爱人性命被拿捏', coreConflict: '家国、爱人与生存', payoff: '身份揭露、乱世抉择、复仇/守护' },
    { name: '萌宝', coreHook: '萌宝意外出现，揭开多年前的秘密', coreConflict: '亲子关系与豪门阻挠', payoff: '亲子名场面、豪门认亲、护妈打脸' },
];

/**
 * 短篇规格。
 */
export const SHORT_STORY_SPEC = {
    platform: '番茄小说短篇',
    wordRange: { min: 50000, max: 100000 },
    unitRange: { min: 8, max: 40 },
    sectionWords: { min: 1500, max: 4500 },
    openingRule: '前 3 段必须出现主角、异常处境和第一个悬念；禁止先铺世界观。',
    rhythmRule: '每 1000–1500 字至少一次信息推进、冲突升级或情绪转折；每 3000–5000 字至少一个可感知的反转。',
    structureRule: '单主线、强情绪、3–5 个关键反转；结尾必须完成情绪兑现或留下余味，不写长篇式支线扩张。',
} as const;

/**
 * 剧本规格。
 */
export const SCRIPT_SPEC = {
    platform: '红果短剧',
    wordRange: { min: 50000, max: 100000 },
    episodeRange: { min: 40, max: 120 },
    episodeSeconds: { min: 60, max: 120 },
    scenesPerEpisode: { min: 3, max: 6 },
    hookRule: '前 3 秒必须出现冲突/羞辱/危机/身份错位；前 3 集完成第一轮强钩子与付费点铺垫。',
    episodeRule: '每集一个核心冲突、一次情绪升级、一个可兑现爽点和一个结尾钩子；第 10–15 集设置强付费卡点。',
    formatRule: '场景标题（集-场 日/夜 内/外 地点）→ 人物 → 动作/画面 → 角色对白 → 必要 VO/字幕；对白驱动，少写小说式心理描写。',
} as const;

/**
 * 创作模式元信息。
 */
export interface CreationModeMeta {
    mode: CreationMode;
    shortCategory: string;
    scriptGenre: string;
    targetWords: number;
    targetUnits: number;
    /** 长篇小说故事结构；旧项目为空 */
    storyStructure?: StoryStructureId;
    /** 长篇小说创作前设定；旧项目为空 */
    storySettings?: LongStorySettings;
}

/**
 * 解析创作模式。
 *
 * @param value - 值
 * @returns 模式
 */
export function parseCreationMode(value: unknown): CreationMode {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'short' || raw === '短篇' || raw === '短篇小说') return 'short';
    if (raw === 'script' || raw === '剧本' || raw === '短剧' || raw === '短剧剧本') return 'script';
    return 'long';
}

/**
 * 模式中文名。
 *
 * @param mode - 模式
 * @returns 名称
 */
export function getCreationModeLabel(mode: CreationMode): string {
    return CREATION_MODE_SPECS[mode]?.label || '长篇小说';
}

/**
 * 模式单元单位名。
 *
 * @param mode - 模式
 * @param count - 参数
 * @returns 单位名
 */
export function getCreationUnitLabel(mode: CreationMode, count?: number): string {
    const spec = CREATION_MODE_SPECS[mode] || CREATION_MODE_SPECS.long;
    return count === 1 ? spec.unitLabel : spec.unitPlural;
}

/**
 * 按名称找短篇题材。
 *
 * @param name - 名称
 * @returns 题材或 undefined
 */
export function findShortStoryCategory(name: string): ShortStoryCategory | undefined {
    return SHORT_STORY_CATEGORIES.find(item => item.name === name);
}

/**
 * 按名称找剧本类型。
 *
 * @param name - 名称
 * @returns 类型或 undefined
 */
export function findScriptGenre(name: string): ScriptGenreSpec | undefined {
    return SCRIPT_GENRES.find(item => item.name === name);
}

/**
 * 解析项目元信息中的模式。
 *
 * @param meta - 元数据
 * @returns 模式元信息
 */
export function parseCreationModeMeta(meta: string): CreationModeMeta {
    const read = (key: string): string => {
        const match = meta.match(new RegExp(`^##\\s*${key}\\s*\\r?\\n\\s*(\\S.*)$`, 'm'));
        return match ? match[1].trim() : '';
    };
    const mode = parseCreationMode(read('创作模式'));
    const spec = CREATION_MODE_SPECS[mode];
    const words = parseInt(read('目标字数'), 10);
    const units = parseInt(read('目标集数') || read('目标节数'), 10);
    const storySettings = mode === 'long' ? parseStorySettingsFromProjectMeta(meta) : null;
    return {
        mode,
        shortCategory: read('短篇分类'),
        scriptGenre: read('剧本类型'),
        targetWords: Number.isFinite(words) && words > 0 ? words : spec.targetWords.default,
        targetUnits: Number.isFinite(units) && units > 0 ? units : spec.targetUnits.default,
        storyStructure: storySettings?.structureId,
        storySettings: storySettings || undefined,
    };
}

/**
 * 构建模式元信息分节。
 *
 * @param meta - 元数据
 * @returns Markdown
 */
export function buildCreationModeMetaSection(meta: CreationModeMeta): string {
    const lines = ['## 创作模式', meta.mode];
    if (meta.mode === 'short' && meta.shortCategory) lines.push('', '## 短篇分类', meta.shortCategory);
    if (meta.mode === 'script' && meta.scriptGenre) lines.push('', '## 剧本类型', meta.scriptGenre);
    lines.push('', '## 目标字数', String(meta.targetWords));
    if (meta.mode === 'script') lines.push('', '## 目标集数', String(meta.targetUnits));
    if (meta.mode === 'short') lines.push('', '## 目标节数', String(meta.targetUnits));
    if (meta.mode === 'long' && meta.storySettings) {
        lines.push('', buildStorySettingsMetaSection(meta.storySettings));
    }
    return lines.join('\n');
}

/**
 * 生成项目内可编辑的模式指南（写入 00-系统模板/创作模式指南.md）。
 *
 * @param meta - 元数据
 * @returns 文本结果
 */
export function buildCreationModeGuide(meta: CreationModeMeta): string {
    const spec = CREATION_MODE_SPECS[meta.mode];
    const category = meta.mode === 'short' ? findShortStoryCategory(meta.shortCategory) : undefined;
    const scriptGenre = meta.mode === 'script' ? findScriptGenre(meta.scriptGenre) : undefined;

    if (meta.mode === 'short') {
        return `---
tags: [创作模式, 短篇小说]
模式: short
分类: ${meta.shortCategory || '未选择'}
目标字数: ${meta.targetWords}
---

# 番茄短篇小说创作规则

> 本文件由项目创建时生成，可自由修改；写作时会作为硬约束注入。

## 一、平台与分类
- 平台：${SHORT_STORY_SPEC.platform}
- 分类：${meta.shortCategory || '未选择'}${category ? `（${category.gender}）` : ''}
- 分类释义：${category?.definition || '未选择分类'}

## 二、篇幅与结构
- 总字数：${meta.targetWords} 字（范围 5–10 万字）
- 建议分节：${spec.targetUnits.default} 节（${SHORT_STORY_SPEC.unitRange.min}–${SHORT_STORY_SPEC.unitRange.max} 节）
- 单节字数：${SHORT_STORY_SPEC.sectionWords.min}–${SHORT_STORY_SPEC.sectionWords.max} 字
- ${SHORT_STORY_SPEC.structureRule}

## 三、开篇与节奏
- ${SHORT_STORY_SPEC.openingRule}
- ${SHORT_STORY_SPEC.rhythmRule}

## 四、情绪与商业化
- 标题、首屏和前 3 段必须能独立抓住读者；分类标签与情绪承诺要一致。
- 每节结尾留一个具体钩子；最终章完成情绪兑现，不烂尾、不开放式敷衍。
- 禁止长篇式世界观铺陈、支线膨胀、连续多节无推进。

## 五、输出格式
- 章节标题使用「第N节 标题」
- 使用短段落、对话独立成段；避免大段设定说明。
`;
    }

    if (meta.mode === 'script') {
        return `---
tags: [创作模式, 短剧剧本]
模式: script
类型: ${meta.scriptGenre || '未选择'}
目标字数: ${meta.targetWords}
目标集数: ${meta.targetUnits}
---

# 红果短剧快车道创作规则

> 本文件由项目创建时生成，可自由修改；写作时会作为硬约束注入。

## 一、项目规格
- 平台：${SCRIPT_SPEC.platform}
- 类型：${meta.scriptGenre || '未选择'}${scriptGenre ? `（${scriptGenre.coreHook}）` : ''}
- 总字数：${meta.targetWords} 字（5–10 万字）
- 总集数：${meta.targetUnits} 集（${SCRIPT_SPEC.episodeRange.min}–${SCRIPT_SPEC.episodeRange.max} 集）
- 单集时长：${SCRIPT_SPEC.episodeSeconds.min}–${SCRIPT_SPEC.episodeSeconds.max} 秒
- 单集场次：${SCRIPT_SPEC.scenesPerEpisode.min}–${SCRIPT_SPEC.scenesPerEpisode.max} 场

## 二、钩子与节奏
- ${SCRIPT_SPEC.hookRule}
- ${SCRIPT_SPEC.episodeRule}

## 三、商业化适配
- 前 3 集完成主角处境、核心冲突、金手指/身份悬念和第一次强兑现。
- 第 10–15 集设置强付费卡点；每 5–10 集升级一次冲突/对手/目标。
- 每集必须有可拍摄的动作与可视化冲突，不能靠旁白解释。

## 四、剧本格式
${SCRIPT_SPEC.formatRule}

## 五、输出格式
第N集 标题
N-1 日/内 场景名
人物：主角、对手
△动作/画面描写
主角：（情绪）对白
（VO/字幕：必要信息）
`;
    }

    if (meta.mode === 'long' && meta.storySettings) {
        const structure = getStoryStructure(meta.storySettings.structureId);
        return `# 长篇小说创作模式

本项目使用长篇小说模式：分卷、多章、11 步流水线与既有导出规范保持不变。

## 故事结构
- 模板：${structure.name}（${structure.english}）
- 阶段：${getStructureStageSummary(structure.id)}
- 主角起点：${getStoryOptionLabel('protagonistStart', meta.storySettings.protagonistStart)}
- 核心冲突：${getStoryOptionLabel('coreConflict', meta.storySettings.coreConflict)}
- 力量体系：${getStoryOptionLabel('powerSystem', meta.storySettings.powerSystem)}
- 金手指：${getStoryOptionLabel('goldenFinger', meta.storySettings.goldenFinger)}
- 一句话故事：${meta.storySettings.oneLineStory || '未填写'}

> 写作时该结构会作为硬约束注入；可在「故事结构」向导或项目 .project 文件中修改。
`;
    }

    return `# 长篇小说创作模式

本项目使用长篇小说模式：分卷、多章、11 步流水线与既有导出规范保持不变。
`;
}

/**
 * 模式提示词覆盖块。长篇返回空串，保证原有提示词完全不变。
 * @param mode - 模式
 * @param meta - 元数据
 * @returns 文本结果
 */
export function getCreationModePromptBlock(mode: CreationMode, meta: Partial<CreationModeMeta> = {}): string {
    if (mode === 'short') {
        const category = findShortStoryCategory(meta.shortCategory || '');
        return `【创作模式：番茄短篇小说】
- 分类：${meta.shortCategory || '未选择'}${category ? `（${category.gender}）` : ''}
- 总字数 5–10 万字；单节 ${SHORT_STORY_SPEC.sectionWords.min}–${SHORT_STORY_SPEC.sectionWords.max} 字。
- ${SHORT_STORY_SPEC.openingRule}
- ${SHORT_STORY_SPEC.rhythmRule}
- ${SHORT_STORY_SPEC.structureRule}
- 禁止长篇式铺陈、支线膨胀和连续多节无推进；每节结尾必须有钩子。`;
    }
    if (mode === 'script') {
        const genre = findScriptGenre(meta.scriptGenre || '');
        return `【创作模式：红果短剧剧本】
- 类型：${meta.scriptGenre || '未选择'}${genre ? `；核心钩子：${genre.coreHook}；核心冲突：${genre.coreConflict}；兑现：${genre.payoff}` : ''}
- 总集数 ${SCRIPT_SPEC.episodeRange.min}–${SCRIPT_SPEC.episodeRange.max} 集，单集 ${SCRIPT_SPEC.episodeSeconds.min}–${SCRIPT_SPEC.episodeSeconds.max} 秒。
- ${SCRIPT_SPEC.hookRule}
- ${SCRIPT_SPEC.episodeRule}
- ${SCRIPT_SPEC.formatRule}
- 剧本必须可拍：场景、人物、动作、对白、必要 VO/字幕；禁止小说式大段心理描写。`;
    }
    if (meta.storySettings) {
        return buildLongStoryPromptBlock(meta.storySettings);
    }
    return '';
}
