/**
 * creative-frameworks.ts - codified short-story / script craft frameworks.
 *
 * The frameworks are research-backed, deterministic structures. Random factors
 * are layered on top by creative-randomizer.ts; frameworks never change with
 * randomness.
 */
import type { CreationMode } from '../../shared/creation-mode';

/**
 * 框架节拍结构定义。
 */
export interface FrameworkBeat {
    id: string;
    title: string;
    purpose: string;
    requiredOutputs: string[];
    qualityGate: string;
}

/**
 * CreativeFramework 类型定义。
 */
export interface CreativeFramework {
    id: string;
    mode: CreationMode;
    name: string;
    industryBasis: string;
    structure: string[];
    beats: FrameworkBeat[];
    hardConstraints: string[];
}

/**
 * SHORT_STORY_FRAMEWORK 常量。
 */
export const SHORT_STORY_FRAMEWORK: CreativeFramework = {
    id: 'short.fanqie.v1',
    mode: 'short',
    name: '番茄短篇 · 高密度单线框架',
    industryBasis: '番茄短篇主流范式：5–10 万字、单主线、强情绪、8–40 节、每节带钩子、3–5 个关键反转。',
    structure: [
        '定位：平台主分类 + 情节/角色/情绪/背景四维标签',
        '故事核：主角 + 目标 + 阻力 + 反转 + 情绪承诺 + 终局兑现',
        '结构：开篇 3 段钩子 → 3–5 反转 → 中段小兑现 → 后段大反转 → 结局兑现',
        '节奏：每 1000–1500 字一次推进；每节结尾一个钩子',
    ],
    beats: [
        {
            id: 'S1',
            title: '定位与故事核',
            purpose: '锁定分类、读者、主角欲望与阻力，形成可写的一句话故事。',
            requiredOutputs: ['主分类', '五维标签', '一句话故事', '情绪承诺'],
            qualityGate: '五维齐全；故事核包含主角/目标/阻力/反转/兑现',
        },
        {
            id: 'S2',
            title: '人物与反转骨架',
            purpose: '用 2–4 个核心人物支撑单主线，设计 3–5 个反转。',
            requiredOutputs: ['主角原型', '对手/阻力', '关系结构', '反转表'],
            qualityGate: '每个反转改变关系/权力/信息/目标/身份之一',
        },
        {
            id: 'S3',
            title: '分节大纲',
            purpose: '把反转铺进 8–40 节，每节有冲突、信息增量和钩子。',
            requiredOutputs: ['节级目标', '冲突', '结尾钩子', '预计字数'],
            qualityGate: '无纯过渡节；总字数在 5–10 万',
        },
        {
            id: 'S4',
            title: '开篇三屏',
            purpose: '前 3 段完成主角、异常处境、第一个悬念。',
            requiredOutputs: ['第 1 节开篇'],
            qualityGate: '前 3 段无设定铺陈；出现冲突或悬念',
        },
        {
            id: 'S5',
            title: '成稿与节级质检',
            purpose: '逐节生成并校验钩子、推进、冲突、情绪与连贯性。',
            requiredOutputs: ['第 NN 节正文', '节级质检'],
            qualityGate: '六维质检 ≥80；钩子/推进/冲突 ≥12',
        },
        {
            id: 'S6',
            title: '收束与交付',
            purpose: '完成主冲突与主情绪兑现，生成书名、简介与导出稿。',
            requiredOutputs: ['最后 1–2 节', '全篇质检', '书名/简介'],
            qualityGate: '主冲突解决；伏笔回收 ≥80%',
        },
    ],
    hardConstraints: [
        '禁止长篇式世界观铺陈与多线并行',
        '禁止没有钩子的节结尾',
        '禁止开放式敷衍结局',
        '禁止用复仇/打脸主线冒充「女性成长」分类',
    ],
};

/**
 * SCRIPT_FRAMEWORK 常量。
 */
export const SCRIPT_FRAMEWORK: CreativeFramework = {
    id: 'script.hongguo.v1',
    mode: 'script',
    name: '红果短剧 · 3 秒钩子分场框架',
    industryBasis: '红果短剧快车道范式：40–120 集、60–120 秒/集、3–6 场/集、3 秒钩子、每集兑现、第 10–15 集付费卡点。',
    structure: [
        '定位：12 类题材 + 集数/时长 + 目标受众',
        '卖点：一句话卖点 + 前 3 秒钩子 + 核心冲突 + 爽点',
        '结构：前 3 集强钩子 → 第 10–15 集付费卡点 → 每 5–10 集升级',
        '组织：集 → 场 → 镜 → 节拍',
    ],
    beats: [
        {
            id: 'T1',
            title: '定位与卖点',
            purpose: '锁定题材、受众、商业钩子与身份/金手指悬念。',
            requiredOutputs: ['类型', '一句话卖点', '3 秒钩子', '核心冲突'],
            qualityGate: '3 秒钩子必须可见：冲突/羞辱/危机/身份错位',
        },
        {
            id: 'T2',
            title: '人物与场景圣经',
            purpose: '控制核心人物与主场景数量，明确可拍条件。',
            requiredOutputs: ['人物小传', '关系图', '场景圣经'],
            qualityGate: '核心人物 ≤8；主场景 2–4 个',
        },
        {
            id: 'T3',
            title: '分集大纲',
            purpose: '每集写清冲突、升级、爽点、钩子、场次与秒数。',
            requiredOutputs: ['集级冲突', '爽点', '结尾钩子', '场次/秒数'],
            qualityGate: '每集都有冲突与钩子；前 3 集完成第一轮兑现',
        },
        {
            id: 'T4',
            title: '分场剧本',
            purpose: '写出可拍场景：人物、动作、对白、道具、环境声。',
            requiredOutputs: ['N-N 场', '△动作', '对白', 'VO/字幕'],
            qualityGate: '每场有冲突或信息变化；无小说式心理铺陈',
        },
        {
            id: 'T5',
            title: '分镜表',
            purpose: '按镜号拆解画面、景别、运镜、时长、台词与音效。',
            requiredOutputs: ['镜号', '景别/角度/运镜', '时长', '台词/音效'],
            qualityGate: '3 秒内强钩子；镜头总时长误差 ≤5 秒',
        },
        {
            id: 'T6',
            title: '质检与纯文本交付',
            purpose: '检查商业节奏、可拍性与连续性，导出剧本与分镜表。',
            requiredOutputs: ['集级质检', '全剧质检', '纯文本剧本', '分镜 CSV/MD'],
            qualityGate: '八维 ≥80；3 秒钩子/冲突/钩子 ≥12',
        },
    ],
    hardConstraints: [
        '禁止靠旁白解释核心冲突',
        '禁止无法拍摄的心理描写或抽象比喻',
        '禁止单集没有冲突',
        '禁止结尾没有钩子',
    ],
};

/**
 * 获取框架。
 * @param mode - 模式
  * @returns CreativeFramework 或 null
 */
export function getFramework(mode: CreationMode): CreativeFramework | null {
    if (mode === 'short') return SHORT_STORY_FRAMEWORK;
    if (mode === 'script') return SCRIPT_FRAMEWORK;
    return null;
}

/**
 * frameworkPromptBlock 函数。
 * @param mode - 模式
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function frameworkPromptBlock(mode: CreationMode, project?: string): string {
    const framework = getFramework(mode);
    if (!framework) return '';
    return [
        `【${framework.name} · 固化创作框架】`,
        `项目：${project || '未命名'}`,
        `行业依据：${framework.industryBasis}`,
        '',
        '【结构】',
        ...framework.structure.map(item => `- ${item}`),
        '',
        '【阶段与交付】',
        ...framework.beats.map(beat => `- ${beat.id} ${beat.title}：${beat.purpose}；必须输出 ${beat.requiredOutputs.join('/')}；校验：${beat.qualityGate}`),
        '',
        '【硬约束】',
        ...framework.hardConstraints.map(item => `- ${item}`),
    ].join('\n');
}
