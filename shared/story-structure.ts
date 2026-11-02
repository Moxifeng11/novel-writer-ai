/**
 * story-structure.ts — 长篇小说故事结构模板与创作前配置
 *
 * 只服务长篇小说：五套结构模板 + 九组创作选项 + 组合校验 + CSPRNG 随机。
 * 结构定义是确定性的；随机只负责在兼容组合中抽样，避免生成自相矛盾的设定。
 */
import { trueRandom, type RandomSource } from './true-random';

/**
 * 故事结构 id。
 */
export type StoryStructureId = 'qichengzhuanhe' | 'three_act' | 'five_act' | 'hero_journey' | 'kishotenketsu';

/**
 * 故事结构阶段。
 */
export interface StoryStructureStage {
    name: string;
    ratio: number;
    purpose: string;
    beats: string[];
}

/**
 * 故事结构定义。
 */
export interface StoryStructureSpec {
    id: StoryStructureId;
    name: string;
    english: string;
    icon: string;
    description: string;
    bestFor: string[];
    stages: StoryStructureStage[];
    hardRules: string[];
}

/**
 * 内置故事结构列表。
 */
export const STORY_STRUCTURES: StoryStructureSpec[] = [
    {
        id: 'qichengzhuanhe',
        name: '起承转合',
        english: 'Kishōtenketsu (Chinese four-part)',
        icon: '🀄',
        description: '最通用的四段式：起铺垫、承发展、转转折、合收束，适合稳定连载。',
        bestFor: ['玄幻', '仙侠', '都市', '历史', '武侠'],
        stages: [
            { name: '起', ratio: 25, purpose: '建立人物、处境与核心悬念', beats: ['主角日常与缺口', '第一个异常', '读者获得继续阅读的问题'] },
            { name: '承', ratio: 35, purpose: '扩大冲突、积累信息与代价', beats: ['对手/规则显形', '连续升级', '一次阶段性兑现'] },
            { name: '转', ratio: 25, purpose: '改变目标或认知，制造最大反转', beats: ['旧目标失效', '真相/立场翻转', '主角做出不可逆选择'] },
            { name: '合', ratio: 15, purpose: '完成兑现并留下余味', beats: ['核心冲突收束', '代价落地', '新秩序或新问题'] },
        ],
        hardRules: ['“转”必须改变读者对前文的理解，不能只是打斗升级', '“合”必须回应开篇埋下的核心问题'],
    },
    {
        id: 'three_act',
        name: '三幕式',
        english: 'Three-Act Structure',
        icon: '🎬',
        description: '经典建置—对抗—解决：目标清晰、节奏稳，适合商业长篇与类型小说。',
        bestFor: ['玄幻', '都市', '悬疑', '科幻', '历史', '武侠'],
        stages: [
            { name: '第一幕：建置', ratio: 25, purpose: '展示常态、打破常态、确立目标', beats: ['开场钩子', '激励事件（约 10%–15%）', '第一个情节点（约 25%）'] },
            { name: '第二幕：对抗', ratio: 50, purpose: '升级阻碍、逼主角付出代价', beats: ['试错与结盟', '中点反转（约 50%）', '至暗时刻（约 75%）'] },
            { name: '第三幕：解决', ratio: 25, purpose: '主角主动反击并完成改变', beats: ['第二个情节点', '高潮对决', '新常态'] },
        ],
        hardRules: ['激励事件不得晚于全书的 20%', '中点必须让主角从被动转为主动', '结局必须由主角的选择决定，不能靠外力收尾'],
    },
    {
        id: 'five_act',
        name: '五幕式',
        english: 'Five-Act Structure',
        icon: '🏛️',
        description: '铺垫—发展—高潮—转折—结局，适合群像、权谋与史诗格局。',
        bestFor: ['历史', '玄幻', '悬疑', '科幻', '末世'],
        stages: [
            { name: '第一幕：铺垫', ratio: 15, purpose: '交代世界规则与裂缝', beats: ['世界常态', '裂缝出现', '主角被卷入'] },
            { name: '第二幕：发展', ratio: 25, purpose: '多方势力行动、矛盾交织', beats: ['盟友与对手登场', '第一次重大损失', '主角获得关键信息'] },
            { name: '第三幕：高潮', ratio: 25, purpose: '冲突集中爆发', beats: ['计划执行', '最大规模对抗', '阶段性胜利/惨胜'] },
            { name: '第四幕：转折', ratio: 20, purpose: '胜利的代价暴露，目标重构', beats: ['隐藏真相揭露', '盟友分裂或背叛', '主角重新选择'] },
            { name: '第五幕：结局', ratio: 15, purpose: '完成终局对决与秩序重建', beats: ['最终对决', '代价兑现', '新秩序落定'] },
        ],
        hardRules: ['每一幕都必须改变力量格局，不能只是换场景', '第四幕必须让前期的胜利付出可见代价'],
    },
    {
        id: 'hero_journey',
        name: '英雄之旅',
        english: "Hero's Journey",
        icon: '🧭',
        description: '平凡世界—召唤—考验—归来，适合成长型主角与冒险史诗。',
        bestFor: ['玄幻', '仙侠', '奇幻', '科幻', '末世', '武侠'],
        stages: [
            { name: '启程', ratio: 20, purpose: '平凡世界、召唤与跨越门槛', beats: ['平凡世界与缺口', '冒险召唤', '拒绝/导师', '跨越第一道门槛'] },
            { name: '试炼', ratio: 30, purpose: '盟友、敌人与连续考验', beats: ['试炼之路', '盟友与对手', '接近最深处'] },
            { name: '磨难', ratio: 25, purpose: '直面最深恐惧，旧自我死亡', beats: ['深渊磨难', '获得奖赏', '带着代价返回'] },
            { name: '归来', ratio: 25, purpose: '最终考验与带回新秩序', beats: ['归途受阻', '复活/最终对决', '带着改变回到日常'] },
        ],
        hardRules: ['主角必须在“磨难”中失去或放弃某种旧东西', '“归来”必须让主角与开篇的平凡世界发生新的关系'],
    },
    {
        id: 'kishotenketsu',
        name: '序破急',
        english: 'Jo-ha-kyū',
        icon: '🎋',
        description: '日式序—破—急：静起、渐变、骤收，适合悬疑、志怪与情绪型故事。',
        bestFor: ['悬疑', '都市', '古风', '言情', '奇幻'],
        stages: [
            { name: '序', ratio: 30, purpose: '缓慢建立日常与暗流', beats: ['日常秩序', '微小异常', '一个无法忽视的细节'] },
            { name: '破', ratio: 40, purpose: '打破日常、连续升级', beats: ['异常扩大', '规则被试探', '中点认知翻转'] },
            { name: '急', ratio: 30, purpose: '节奏骤紧、集中收束', beats: ['连续加速', '最大危机', '意外但自洽的收束'] },
        ],
        hardRules: ['“破”必须改变读者对日常的理解', '“急”要明显加快节奏，但不能靠新设定硬解'],
    },
];

/**
 * 获取故事结构。
 * @param id - 标识
  * @returns StoryStructureSpec 实例
 */
export function getStoryStructure(id: StoryStructureId | string | undefined): StoryStructureSpec {
    return STORY_STRUCTURES.find(item => item.id === id) || STORY_STRUCTURES[0];
}

/**
 * 获取结构阶段摘要。
 * @param id - 标识
 * @returns 文本结果
 */
export function getStructureStageSummary(id: StoryStructureId | string | undefined): string {
    return getStoryStructure(id).stages.map(stage => `${stage.name} ${stage.ratio}%`).join(' · ');
}

/**
 * 故事选项分类。
 */
export type StoryOptionCategory =
    | 'protagonistStart'
    | 'coreConflict'
    | 'powerSystem'
    | 'goldenFinger'
    | 'archetype'
    | 'temperament'
    | 'tone'
    | 'romance'
    | 'pacing';

/**
 * 故事选项。
 */
export interface StoryOption {
    id: string;
    label: string;
    description?: string;
    /** 核心冲突专用：可直接嵌入一句话故事的短语 */
    phrase?: string;
    /** 只在这些结构下参与随机；为空表示全部结构可用 */
    structures?: StoryStructureId[];
}

/**
 * 故事选项分组。
 */
export interface StoryOptionGroup {
    key: StoryOptionCategory;
    label: string;
    hint: string;
    section: '核心设定' | '风格与节奏';
    options: StoryOption[];
}

/**
 * 全部故事选项。
 */
export const STORY_OPTION_GROUPS: StoryOptionGroup[] = [
    {
        key: 'protagonistStart',
        label: '主角起点',
        hint: '决定开局处境与读者代入方式',
        section: '核心设定',
        options: [
            { id: '落魄者', label: '落魄者', description: '失去资源/地位，从低谷开始' },
            { id: '普通人', label: '普通人', description: '没有特殊身份，被事件卷入' },
            { id: '天才', label: '天才', description: '能力出众，但背负更高期待' },
            { id: '继承者', label: '继承者', description: '继承家族/势力，也继承债务' },
            { id: '重生者', label: '重生者', description: '带着上一世记忆重来' },
            { id: '穿越者', label: '穿越者', description: '来自异世界的变量' },
            { id: '被放逐者', label: '被放逐者', description: '被组织/家族驱逐，失去归属' },
            { id: '隐世者', label: '隐世者', description: '主动隐藏实力，避免被看见' },
        ],
    },
    {
        key: 'coreConflict',
        label: '核心冲突',
        hint: '全书主线的驱动力，必须能贯穿到结局',
        section: '核心设定',
        options: [
            { id: '复仇', label: '复仇', phrase: '追查并清算当年血债', description: '亲人/师门/家族被害' },
            { id: '守护', label: '守护', phrase: '守住重要的人与最后的底线', description: '保护具体的人或家园' },
            { id: '生存', label: '生存', phrase: '在绝境中活下去', description: '资源/规则/环境压迫' },
            { id: '争霸', label: '争霸', phrase: '在多方势力中夺取主导权', description: '权力、地盘与秩序' },
            { id: '求真', label: '求真', phrase: '追查一个被所有人掩盖的真相', description: '谜题、身份与历史' },
            { id: '救赎', label: '救赎', phrase: '为自己的过错找到赎罪方式', description: '道德困境与自我审判' },
            { id: '归乡', label: '归乡', phrase: '回到已经改变的故乡', description: '归属、记忆与重建' },
            { id: '反抗命运', label: '反抗命运', phrase: '打破被写好的命运', description: '预言、体制与宿命' },
        ],
    },
    {
        key: 'powerSystem',
        label: '力量体系',
        hint: '决定世界规则与战斗/解决问题的逻辑',
        section: '核心设定',
        options: [
            { id: '修炼', label: '修炼体系', description: '境界、灵气、功法与资源' },
            { id: '武道', label: '武道体系', description: '肉身、招式与实战经验' },
            { id: '科技', label: '科技体系', description: '设备、工程与信息差' },
            { id: '异能', label: '异能体系', description: '觉醒能力与代价' },
            { id: '神话', label: '神话体系', description: '神格、信仰与古老契约' },
            { id: '现实', label: '现实体系', description: '没有超自然力量，靠人性和规则' },
            { id: '混合', label: '混合体系', description: '两条力量线互相制衡' },
        ],
    },
    {
        key: 'goldenFinger',
        label: '金手指',
        hint: '主角的独特变量，必须有边界或代价',
        section: '核心设定',
        options: [
            { id: '系统', label: '系统', description: '任务、面板或规则型外挂' },
            { id: '重生记忆', label: '重生记忆', description: '知道未来，但未来会变化' },
            { id: '穿越知识', label: '穿越知识', description: '现代知识降维应用' },
            { id: '血脉', label: '血脉觉醒', description: '隐藏血脉带来的力量与麻烦' },
            { id: '神秘器物', label: '神秘器物', description: '一件不能完全掌控的物品' },
            { id: '读心', label: '读心', description: '听见他人表层/深层想法' },
            { id: '时间回溯', label: '时间回溯', description: '有限次数回到过去' },
            { id: '无金手指', label: '无金手指', description: '只靠判断、关系与代价换取机会' },
        ],
    },
    {
        key: 'archetype',
        label: '人物原型',
        hint: '决定主角的叙事功能与读者预期',
        section: '风格与节奏',
        options: [
            { id: '废柴逆袭', label: '废柴逆袭' },
            { id: '天才流', label: '天才流' },
            { id: '退婚流', label: '退婚流' },
            { id: '系统流', label: '系统流' },
            { id: '群像', label: '群像' },
            { id: '反英雄', label: '反英雄' },
            { id: '日常流', label: '日常流' },
            { id: '权谋', label: '权谋' },
        ],
    },
    {
        key: 'temperament',
        label: '主角性格',
        hint: '决定他在压力下的选择方式',
        section: '风格与节奏',
        options: [
            { id: '冷静克制', label: '冷静克制' },
            { id: '热血直率', label: '热血直率' },
            { id: '腹黑谋略', label: '腹黑谋略' },
            { id: '温和坚韧', label: '温和坚韧' },
            { id: '偏执疯批', label: '偏执疯批' },
            { id: '幽默洒脱', label: '幽默洒脱' },
        ],
    },
    {
        key: 'tone',
        label: '叙事基调',
        hint: '决定语言密度、情绪承诺与结局质感',
        section: '风格与节奏',
        options: [
            { id: '热血爽文', label: '热血爽文' },
            { id: '悬疑冷峻', label: '悬疑冷峻' },
            { id: '温情治愈', label: '温情治愈' },
            { id: '黑暗史诗', label: '黑暗史诗' },
            { id: '轻松诙谐', label: '轻松诙谐' },
            { id: '悲壮苍凉', label: '悲壮苍凉' },
        ],
    },
    {
        key: 'romance',
        label: '感情线',
        hint: '只影响戏份权重，不强行改变主线',
        section: '风格与节奏',
        options: [
            { id: '无', label: '无' },
            { id: '弱', label: '弱（点缀）' },
            { id: '中', label: '中（并行线）' },
            { id: '强', label: '强（核心线之一）' },
        ],
    },
    {
        key: 'pacing',
        label: '推进节奏',
        hint: '决定信息释放与冲突升级的速度',
        section: '风格与节奏',
        options: [
            { id: '快节奏', label: '快节奏' },
            { id: '中速推进', label: '中速推进' },
            { id: '慢热铺陈', label: '慢热铺陈' },
        ],
    },
];

/**
 * 获取故事选项分组。
 * @param key - 键
  * @returns StoryOptionGroup 实例
 */
export function getStoryOptionGroup(key: StoryOptionCategory): StoryOptionGroup {
    return STORY_OPTION_GROUPS.find(group => group.key === key) || STORY_OPTION_GROUPS[0];
}

/**
 * 查找故事选项。
 * @param key - 键
 * @param value - 值
  * @returns StoryOption 或 undefined
 */
export function findStoryOption(key: StoryOptionCategory, value: string): StoryOption | undefined {
    const group = getStoryOptionGroup(key);
    return group.options.find(option => option.id === value || option.label === value);
}

/**
 * 获取故事选项标签。
 * @param key - 键
 * @param value - 值
 * @returns 文本结果
 */
export function getStoryOptionLabel(key: StoryOptionCategory, value: string): string {
    return findStoryOption(key, value)?.label || value || '未选择';
}

/**
 * 长篇故事设定。
 */
export interface LongStorySettings {
    structureId: StoryStructureId;
    protagonistStart: string;
    coreConflict: string;
    powerSystem: string;
    goldenFinger: string;
    archetype: string;
    temperament: string;
    tone: string;
    romance: string;
    pacing: string;
    oneLineStory: string;
    randomSeed: string;
}

/**
 * createDefaultStorySettings 函数。
 * @param structureId - 结构 ID
  * @returns LongStorySettings 实例
 */
export function createDefaultStorySettings(structureId: StoryStructureId = 'qichengzhuanhe'): LongStorySettings {
    return {
        structureId,
        protagonistStart: '落魄者',
        coreConflict: '守护',
        powerSystem: '修炼',
        goldenFinger: '系统',
        archetype: '废柴逆袭',
        temperament: '冷静克制',
        tone: '热血爽文',
        romance: '弱',
        pacing: '中速推进',
        oneLineStory: '',
        randomSeed: '',
    };
}

/**
 * 校验故事设置列表。
 * @param settings - 设置
 * @returns 结果数组
 */
export function validateStorySettings(settings: Partial<LongStorySettings>): string[] {
    const issues: string[] = [];
    const structure = getStoryStructure(settings.structureId);
    if (!STORY_STRUCTURES.some(item => item.id === settings.structureId)) {
        issues.push('未选择有效的故事结构');
    }

    const power = settings.powerSystem || '';
    const finger = settings.goldenFinger || '';
    const archetype = settings.archetype || '';
    const start = settings.protagonistStart || '';
    const tone = settings.tone || '';
    const temperament = settings.temperament || '';
    const conflict = settings.coreConflict || '';

    if (power === '科技' && finger === '血脉') {
        issues.push('科技体系与血脉觉醒冲突：请改为科技装置/基因改造，或切换力量体系');
    }
    if (power === '现实' && ['血脉', '系统', '时间回溯', '神秘器物'].includes(finger)) {
        issues.push('现实体系不应出现超自然金手指：请改为“无金手指”或切换力量体系');
    }
    if (archetype === '系统流' && finger !== '系统') {
        issues.push('“系统流”要求金手指为“系统”，或把人物原型改为其他类型');
    }
    if (archetype === '天才流' && !['天才', '继承者'].includes(start)) {
        issues.push('“天才流”与当前起点不匹配：请把主角起点改为天才/继承者，或切换人物原型');
    }
    if (archetype === '废柴逆袭' && !['落魄者', '普通人', '被放逐者'].includes(start)) {
        issues.push('“废柴逆袭”需要低谷起点：请改为落魄者/普通人/被放逐者，或切换人物原型');
    }
    if (['黑暗史诗', '悲壮苍凉'].includes(tone) && temperament === '幽默洒脱') {
        issues.push('悲壮/黑暗基调与幽默洒脱的性格容易互相削弱：建议改为冷静克制/偏执疯批');
    }
    if (tone === '轻松诙谐' && ['复仇', '争霸', '生存'].includes(conflict)) {
        issues.push('轻松诙谐基调与复仇/争霸/生存主线冲突：建议改为悬疑冷峻/热血爽文');
    }
    if (archetype === '日常流' && ['复仇', '争霸', '生存'].includes(conflict)) {
        issues.push('日常流不适合复仇/争霸/生存主线：建议改为守护/求真/归乡');
    }
    if (structure.id === 'three_act' && settings.pacing === '慢热铺陈') {
        issues.push('三幕式要求激励事件尽早出现，慢热铺陈会挤压第一幕；建议改为中速推进');
    }
    return issues;
}

function allowed(category: StoryOptionCategory, settings: LongStorySettings, id: string): boolean {
    const option = findStoryOption(category, id);
    if (!option) return false;
    if (option.structures && !option.structures.includes(settings.structureId)) return false;
    return validateStorySettings({ ...settings, [category]: id }).length === 0;
}

function pickAllowed(
    category: StoryOptionCategory,
    settings: LongStorySettings,
    random: RandomSource,
): string {
    const group = getStoryOptionGroup(category);
    const candidates = group.options
        .map(option => option.id)
        .filter(id => allowed(category, settings, id));
    const pool = candidates.length > 0 ? candidates : group.options.map(option => option.id);
    return random.pick(pool);
}

function structureWeight(structure: StoryStructureSpec, genre: string): number {
    if (!genre) return 1;
    return structure.bestFor.some(item => genre.includes(item) || item.includes(genre)) ? 3 : 1;
}

function buildOneLineStory(settings: LongStorySettings, genre: string): string {
    const structure = getStoryStructure(settings.structureId);
    const conflict = findStoryOption('coreConflict', settings.coreConflict)?.phrase || settings.coreConflict;
    const finger = settings.goldenFinger === '无金手指'
        ? '没有外挂，只能靠判断与代价换取机会'
        : `以「${getStoryOptionLabel('goldenFinger', settings.goldenFinger)}」为唯一底牌`;
    return `${getStoryOptionLabel('protagonistStart', settings.protagonistStart)}在${genre || '故事'}世界${conflict}；${finger}，沿${structure.name}的${structure.stages.length}个阶段走向${getStoryOptionLabel('tone', settings.tone)}的结局。`;
}

const FALLBACKS: Record<StoryStructureId, Partial<LongStorySettings>> = {
    qichengzhuanhe: { protagonistStart: '落魄者', coreConflict: '守护', powerSystem: '修炼', goldenFinger: '系统', archetype: '废柴逆袭', temperament: '冷静克制', tone: '热血爽文', romance: '弱', pacing: '中速推进' },
    three_act: { protagonistStart: '普通人', coreConflict: '求真', powerSystem: '现实', goldenFinger: '无金手指', archetype: '反英雄', temperament: '冷静克制', tone: '悬疑冷峻', romance: '弱', pacing: '快节奏' },
    five_act: { protagonistStart: '继承者', coreConflict: '争霸', powerSystem: '混合', goldenFinger: '神秘器物', archetype: '权谋', temperament: '腹黑谋略', tone: '黑暗史诗', romance: '中', pacing: '中速推进' },
    hero_journey: { protagonistStart: '普通人', coreConflict: '反抗命运', powerSystem: '修炼', goldenFinger: '血脉', archetype: '天才流', temperament: '热血直率', tone: '热血爽文', romance: '中', pacing: '中速推进' },
    kishotenketsu: { protagonistStart: '普通人', coreConflict: '求真', powerSystem: '现实', goldenFinger: '读心', archetype: '日常流', temperament: '温和坚韧', tone: '悬疑冷峻', romance: '弱', pacing: '慢热铺陈' },
};

/**
 * 随机设定选项。
 */
export interface RandomStoryOptions {
    genre?: string;
    structureId?: StoryStructureId;
    /** 仅测试用；生产默认 CSPRNG */
    random?: RandomSource;
}

/**
 * CSPRNG 随机组合：先选结构，再在通过校验的候选池中逐项抽样。
 *
 * @param options - 配置项
  * @returns LongStorySettings 实例
 */
export function generateRandomStorySettings(options: RandomStoryOptions = {}): LongStorySettings {
    const random = options.random || trueRandom;
    const genre = String(options.genre || '').trim();
    const structures = options.structureId
        ? [getStoryStructure(options.structureId)]
        : STORY_STRUCTURES;

    const structure = random.weightedPick(structures.map(item => ({
        value: item,
        weight: structureWeight(item, genre),
    })));
    let settings: LongStorySettings = {
        ...createDefaultStorySettings(structure.id),
        randomSeed: random.uuid(),
    };

    for (let attempt = 0; attempt < 80; attempt++) {
        const candidate: LongStorySettings = {
            ...settings,
            powerSystem: pickAllowed('powerSystem', settings, random),
            goldenFinger: '',
            coreConflict: pickAllowed('coreConflict', settings, random),
            tone: '',
            protagonistStart: '',
            archetype: '',
            temperament: '',
            romance: '',
            pacing: '',
        };
        candidate.goldenFinger = pickAllowed('goldenFinger', candidate, random);
        candidate.tone = pickAllowed('tone', candidate, random);
        candidate.protagonistStart = pickAllowed('protagonistStart', candidate, random);
        candidate.archetype = pickAllowed('archetype', candidate, random);
        candidate.temperament = pickAllowed('temperament', candidate, random);
        candidate.romance = pickAllowed('romance', candidate, random);
        candidate.pacing = pickAllowed('pacing', candidate, random);
        candidate.oneLineStory = buildOneLineStory(candidate, genre);
        candidate.randomSeed = settings.randomSeed;

        if (validateStorySettings(candidate).length === 0) {
            settings = candidate;
            return candidate;
        }
    }

    const fallback: LongStorySettings = {
        ...createDefaultStorySettings(structure.id),
        ...FALLBACKS[structure.id],
        randomSeed: settings.randomSeed,
    };
    fallback.oneLineStory = buildOneLineStory(fallback, genre);
    return fallback;
}

const FIELD_LABELS: Array<{ key: keyof LongStorySettings; label: string }> = [
    { key: 'protagonistStart', label: '主角起点' },
    { key: 'coreConflict', label: '核心冲突' },
    { key: 'powerSystem', label: '力量体系' },
    { key: 'goldenFinger', label: '金手指' },
    { key: 'archetype', label: '人物原型' },
    { key: 'temperament', label: '主角性格' },
    { key: 'tone', label: '叙事基调' },
    { key: 'romance', label: '感情线' },
    { key: 'pacing', label: '推进节奏' },
    { key: 'oneLineStory', label: '一句话故事' },
    { key: 'randomSeed', label: '随机种子' },
];

/**
 * parseStorySettingsFromProjectMeta 函数。
 * @param meta - 元数据
  * @returns LongStorySettings 或 null
 */
export function parseStorySettingsFromProjectMeta(meta: string): LongStorySettings | null {
    const structureRaw = meta.match(/^##\s*故事结构\s*\r?\n\s*(\S.*)$/m)?.[1]?.trim();
    if (!structureRaw) return null;
    const structure = STORY_STRUCTURES.find(item => item.id === structureRaw || item.name === structureRaw);
    if (!structure) return null;

    const block = meta.match(/^##\s*故事创作设置\s*\r?\n([\s\S]*?)(?=\r?\n##\s|(?![\s\S]))/m)?.[1] || '';
    const settings = createDefaultStorySettings(structure.id);
    for (const line of block.split(/\r?\n/)) {
        const match = line.match(/^\s*-\s*([^：:]+)[：:]\s*(.*)$/);
        if (!match) continue;
        const label = match[1].trim();
        const value = match[2].trim();
        const field = FIELD_LABELS.find(item => item.label === label);
        if (!field) continue;
        if (field.key === 'oneLineStory' || field.key === 'randomSeed') {
            settings[field.key] = value;
        } else {
            const option = findStoryOption(field.key as StoryOptionCategory, value);
            if (option) (settings[field.key] as string) = option.id;
        }
    }
    return settings;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeSection(meta: string, title: string): string {
    const re = new RegExp(`^##\\s*${escapeRegExp(title)}\\s*\\r?\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'm');
    return meta.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * 构建故事设置列表元数据分区。
 * @param settings - 设置
 * @returns 文本结果
 */
export function buildStorySettingsMetaSection(settings: LongStorySettings): string {
    const structure = getStoryStructure(settings.structureId);
    const lines = [
        '## 故事结构',
        settings.structureId,
        '',
        '## 故事创作设置',
        `- 结构: ${structure.name}`,
    ];
    for (const field of FIELD_LABELS) {
        if (field.key === 'randomSeed' && !settings.randomSeed) continue;
        const value = field.key === 'oneLineStory' || field.key === 'randomSeed'
            ? settings[field.key]
            : getStoryOptionLabel(field.key as StoryOptionCategory, settings[field.key]);
        if (!value) continue;
        lines.push(`- ${field.label}: ${value}`);
    }
    return lines.join('\n');
}

/**
 * upsertStorySettingsInProjectMeta 函数。
 * @param meta - 元数据
 * @param settings - 设置
 * @returns 文本结果
 */
export function upsertStorySettingsInProjectMeta(meta: string, settings: LongStorySettings): string {
    let next = removeSection(meta, '故事结构');
    next = removeSection(next, '故事创作设置');
    return `${next.trimEnd()}\n\n${buildStorySettingsMetaSection(settings)}\n`;
}

/**
 * buildLongStoryPromptBlock 函数。
 * @param settings - 设置
 * @returns 文本结果
 */
export function buildLongStoryPromptBlock(settings: LongStorySettings): string {
    const structure = getStoryStructure(settings.structureId);
    const stages = structure.stages
        .map(stage => `- ${stage.name}（${stage.ratio}%）：${stage.purpose}；关键节点：${stage.beats.join('、')}`)
        .join('\n');
    const fingerprint = [
        `主角起点：${getStoryOptionLabel('protagonistStart', settings.protagonistStart)}`,
        `核心冲突：${getStoryOptionLabel('coreConflict', settings.coreConflict)}`,
        `力量体系：${getStoryOptionLabel('powerSystem', settings.powerSystem)}`,
        `金手指：${getStoryOptionLabel('goldenFinger', settings.goldenFinger)}`,
        `人物原型：${getStoryOptionLabel('archetype', settings.archetype)}`,
        `主角性格：${getStoryOptionLabel('temperament', settings.temperament)}`,
        `叙事基调：${getStoryOptionLabel('tone', settings.tone)}`,
        `感情线：${getStoryOptionLabel('romance', settings.romance)}`,
        `推进节奏：${getStoryOptionLabel('pacing', settings.pacing)}`,
    ].join('；');
    const oneLine = settings.oneLineStory.trim();
    return `【长篇小说故事结构：${structure.name}】
${stages}
- 硬约束：${structure.hardRules.join('；')}
- 本书设定：${fingerprint}${oneLine ? `\n- 一句话故事：${oneLine}` : ''}
- 所有章节必须服务当前结构阶段；不得提前解决核心冲突，也不得用新设定硬解既有矛盾。`;
}

/**
 * buildStoryStructureGuide 函数。
 * @param settings - 设置
 * @returns 文本结果
 */
export function buildStoryStructureGuide(settings: LongStorySettings): string {
    const structure = getStoryStructure(settings.structureId);
    const stageLines = structure.stages.map(stage =>
        `### ${stage.name}（约 ${stage.ratio}%）
- 目标：${stage.purpose}
- 关键节点：${stage.beats.map(beat => `\n  - ${beat}`).join('')}`
    ).join('\n\n');
    const issueLines = validateStorySettings(settings);
    return `---
tags: [故事结构, 长篇小说]
结构: ${structure.name}
结构ID: ${structure.id}
随机种子: ${settings.randomSeed || '未使用'}
---

# 故事结构指南

> 由项目创建/故事结构向导生成，可自由修改；写作时会作为硬约束注入。

## 一、结构模板
- 名称：${structure.name}（${structure.english}）
- 说明：${structure.description}
- 阶段比例：${structure.stages.map(stage => `${stage.name} ${stage.ratio}%`).join(' · ')}

${stageLines}

## 二、本书创作设定
${FIELD_LABELS.filter(field => field.key !== 'randomSeed').map(field => {
    const value = field.key === 'oneLineStory'
        ? settings.oneLineStory
        : getStoryOptionLabel(field.key as StoryOptionCategory, settings[field.key]);
    return value ? `- ${field.label}：${value}` : '';
}).filter(Boolean).join('\n')}

## 三、硬约束
${structure.hardRules.map(rule => `- ${rule}`).join('\n')}
- 当前组合${issueLines.length === 0 ? '自洽' : `存在冲突：${issueLines.join('；')}`}
`;
}
