/**
 * conversation-engine.ts — 对话引导 Agent 的 Runner
 *
 * 参考 DeepSeek Harness 的分层（Memory / Tools / Planner / Runner）：
 * - 槽位 = Memory；GuideAgentPort = Tools；本文件 = Planner + Runner。
 * - 最前端先选创作类型，再进入长篇原创/长篇同人/短篇/剧本四条专属路径。
 * - 纯逻辑、可测试：不依赖 Obsidian/AI；自由文本优先端口 aiParse，失败回退 chips/序号。
 */
import { validateProjectName } from '../../shared/project-name';
import { trueRandom } from '../harness/true-random';
import { SHORT_STORY_CATEGORIES, SCRIPT_GENRES } from '../../shared/creation-mode';
import { modeFromPathPrefix } from '../../shared/project-mode';
import {
    STORY_STRUCTURES,
    createDefaultStorySettings,
    generateRandomStorySettings,
    getStoryStructure,
} from '../../shared/story-structure';
import type {
    AgentChip,
    AgentContext,
    AgentFlowId,
    AgentIntent,
    AgentMessage,
    AgentSlots,
    AgentTurnResult,
    GuideAgentPort,
} from './agent-types';

type SlotKey = keyof AgentSlots;
type CreateFlow = 'create_long_original' | 'create_long_fanfic' | 'create_short' | 'create_script';

interface SlotSpec {
    key: SlotKey;
    question: string;
    chips: AgentChip[];
    freeText?: boolean;
    randomFill?: (slots: AgentSlots) => string;
    validate?: (raw: string, ctx: AgentContext) => string | null;
    toValue?: (chipValue: string) => string;
}

const GENRES = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情', '奇幻', '武侠', '末世'];
const NAME_PREFIX = ['九霄', '孤灯', '长夜', '碎星', '北望', '青冥', '雾隐', '灼原', '听雪', '断浪'];
const NAME_SUFFIX = ['逆行', '纪事', '录', '行', '志', '谜', '歌', '书'];

const NAME_CHIPS: AgentChip[] = [{ label: '🎲 随机书名', value: '__random__' }];
const GENRE_CHIPS: AgentChip[] = GENRES.map(g => ({ label: g, value: g }));
const CHANNEL_CHIPS: AgentChip[] = [
    { label: '男频', value: '男频', description: '偏升级、竞争、资源与动作', bestFor: '热血/玄幻/都市逆袭', risk: '感情线过重会稀释爽点' },
    { label: '女频', value: '女频', description: '偏关系、情绪、成长与代入', bestFor: '言情/女性成长/家庭', risk: '主线目标过弱会显得散' },
    { label: '通用', value: '通用', description: '不绑定频道，按题材自然适配', bestFor: '悬疑/科幻/历史/群像', risk: '平台标签可能不够精准' },
];
const VARIANT_CHIPS: AgentChip[] = [
    { label: '🎨 原创', value: 'original', description: '完全自建世界观与角色', bestFor: '从零开始、可自由设定', preview: '频道 → 题材 → 故事结构 → 基调/金手指' },
    { label: '📖 同人', value: 'fanfic', description: '沿用原作世界观，写衍生故事', bestFor: '已有明确原作与读者群', risk: '必须遵守原作规则与改动边界', preview: '原作 → 同人类型 → 改动范围 → 故事结构' },
];
const FANFIC_TYPE_CHIPS: AgentChip[] = [
    { label: '原著向', value: '原著向' },
    { label: 'CP 向', value: 'CP向' },
    { label: 'IF 线', value: 'IF线' },
    { label: '衍生/外传', value: '衍生' },
    { label: '群像', value: '群像' },
];
const CANON_SCOPE_CHIPS: AgentChip[] = [
    { label: '只改支线', value: '只改支线' },
    { label: '重写结局', value: '重写结局' },
    { label: '平行世界', value: '平行世界' },
    { label: '前传', value: '前传' },
    { label: '后传', value: '后传' },
];
const STRUCTURE_CHIPS: AgentChip[] = [
    ...STORY_STRUCTURES.map(s => ({
        label: `${s.icon} ${s.name}`,
        value: s.id,
        description: s.description,
        bestFor: `适合：${s.bestFor.join(' / ')}`,
        risk: `硬约束：${s.hardRules[0]}`,
        preview: `阶段：${s.stages.map(stage => `${stage.name} ${stage.ratio}%`).join(' · ')}`,
    })),
    { label: '🎲 智能随机', value: '__random__', description: '按题材权重与组合校验随机选结构', bestFor: '不确定时快速得到自洽组合', preview: '结构 + 基调 + 金手指一起自洽抽样' },
];
const TONE_CHIPS: AgentChip[] = [
    { label: '热血爽文', value: '热血爽文' },
    { label: '悬疑冷峻', value: '悬疑冷峻' },
    { label: '温情治愈', value: '温情治愈' },
    { label: '黑暗史诗', value: '黑暗史诗' },
    { label: '轻松诙谐', value: '轻松诙谐' },
    { label: '悲壮苍凉', value: '悲壮苍凉' },
    { label: '🎲 随机', value: '__random__' },
    { label: '跳过（默认）', value: '__skip__' },
];
const FINGER_CHIPS: AgentChip[] = [
    { label: '系统', value: '系统' },
    { label: '重生记忆', value: '重生记忆' },
    { label: '穿越知识', value: '穿越知识' },
    { label: '血脉觉醒', value: '血脉觉醒' },
    { label: '神秘器物', value: '神秘器物' },
    { label: '读心', value: '读心' },
    { label: '时间回溯', value: '时间回溯' },
    { label: '无金手指', value: '无金手指' },
    { label: '🎲 随机', value: '__random__' },
    { label: '跳过（默认）', value: '__skip__' },
];
const SHORT_CATEGORY_CHIPS: AgentChip[] = SHORT_STORY_CATEGORIES.map(c => ({
    label: c.name,
    value: c.name,
    description: c.definition,
    bestFor: c.gender === '通用' ? '通用频道' : `${c.gender}读者`,
}));
const SCRIPT_GENRE_CHIPS: AgentChip[] = SCRIPT_GENRES.map(g => ({
    label: g.name,
    value: g.name,
    description: `核心钩子：${g.coreHook}`,
    bestFor: `核心冲突：${g.coreConflict}`,
    preview: `兑现：${g.payoff}`,
}));
const MODE_CHIPS: AgentChip[] = [
    {
        label: '🧭 引导模式',
        value: 'guided',
        description: '每个节点由你选择，我解释预期效果与风险',
        bestFor: '想掌控设定、边看边调整',
        preview: '逐步提问 → 确认摘要 → 创建',
    },
    {
        label: '⚡ 自动模式',
        value: 'auto',
        description: '我用自洽随机/默认值填完剩余项并直接创建',
        bestFor: '想快速拿到可开工的项目骨架',
        risk: '不会自动写正文；创建后仍进入原有向导/写作流程',
        preview: '自动填参 → 立即创建 → 打开工作区',
    },
];
const EPISODE_CHIPS: AgentChip[] = [
    { label: '60 集', value: '60' },
    { label: '80 集（推荐）', value: '80' },
    { label: '100 集', value: '100' },
];
const PAYWALL_CHIPS: AgentChip[] = [
    { label: '第 10 集', value: '10' },
    { label: '第 12 集（推荐）', value: '12' },
    { label: '第 15 集', value: '15' },
    { label: '第 20 集', value: '20' },
];

const FLOW_SLOTS: Record<CreateFlow, SlotKey[]> = {
    create_long_original: ['projectName', 'channel', 'genre', 'structureId', 'tone', 'goldenFinger'],
    create_long_fanfic: ['projectName', 'sourceWork', 'genre', 'fanficType', 'canonScope', 'structureId', 'tone'],
    create_short: ['projectName', 'shortCategory', 'premise', 'coreConflict', 'emotionalPromise', 'reversals', 'endingPayoff', 'characterCore'],
    create_script: ['projectName', 'scriptGenre', 'logline', 'hook3s', 'coreConflict', 'payoff', 'characters', 'scenes', 'targetEpisodes', 'paywallEpisode'],
};

function displayProject(projectId: string): string {
    return String(projectId || '').split('\\').join('/').split('/').pop() || String(projectId || '');
}

function textLimit(min: number, max: number, label: string) {
    return (raw: string): string | null => {
        const length = raw.trim().length;
        return length >= min && length <= max ? null : `${label}请控制在 ${min}–${max} 字`;
    };
}

const SLOT_SPECS: Record<SlotKey, SlotSpec> = {
    projectName: {
        key: 'projectName',
        question: '项目名（2–20 字符，中文/字母/数字，不含空格标点；点「随机书名」也可以）：',
        chips: NAME_CHIPS,
        freeText: true,
        validate: (raw, ctx) => {
            const result = validateProjectName(raw, ctx.projects.map(displayProject));
            return result.valid ? null : (result.error || '项目名不可用');
        },
        randomFill: () => `${trueRandom.pick(NAME_PREFIX)}${trueRandom.pick(NAME_SUFFIX)}`,
    },
    channel: {
        key: 'channel',
        question: '目标频道？会影响题材与爽点取向。',
        chips: CHANNEL_CHIPS,
    },
    genre: {
        key: 'genre',
        question: '题材是？（点选，或输入其他题材）',
        chips: GENRE_CHIPS,
        freeText: true,
        validate: textLimit(1, 12, '题材'),
    },
    projectType: {
        key: 'projectType',
        question: '原创还是同人？',
        chips: VARIANT_CHIPS,
        toValue: v => (v === 'fanfic' || v.includes('同人') ? 'fanfic' : 'original'),
    },
    longVariant: {
        key: 'longVariant',
        question: '选择长篇路径：原创或同人？',
        chips: VARIANT_CHIPS,
        toValue: v => (v === 'fanfic' || v.includes('同人') ? 'fanfic' : 'original'),
    },
    sourceWork: {
        key: 'sourceWork',
        question: '同人作品的原作名称是？（例如：斗罗大陆）',
        chips: [],
        freeText: true,
        validate: textLimit(1, 30, '原作名称'),
    },
    fanficType: {
        key: 'fanficType',
        question: '同人类型？',
        chips: FANFIC_TYPE_CHIPS,
    },
    canonScope: {
        key: 'canonScope',
        question: '对原作改动范围？',
        chips: CANON_SCOPE_CHIPS,
    },
    structureId: {
        key: 'structureId',
        question: '选择故事结构（决定阶段比例与硬约束）：',
        chips: STRUCTURE_CHIPS,
        randomFill: slots => generateRandomStorySettings({ genre: slots.genre }).structureId,
        validate: raw => (STORY_STRUCTURES.some(s => s.id === raw || s.name === raw) ? null : '请从五套结构中选择，或回复「智能随机」'),
    },
    tone: {
        key: 'tone',
        question: '叙事基调偏好？',
        chips: TONE_CHIPS,
        randomFill: slots => generateRandomStorySettings({ genre: slots.genre, structureId: slots.structureId }).tone,
    },
    goldenFinger: {
        key: 'goldenFinger',
        question: '主角的金手指（独特变量）？',
        chips: FINGER_CHIPS,
        randomFill: slots => generateRandomStorySettings({ genre: slots.genre, structureId: slots.structureId }).goldenFinger,
    },
    shortCategory: {
        key: 'shortCategory',
        question: '选择番茄短篇分类（会影响情绪承诺与平台标签）：',
        chips: SHORT_CATEGORY_CHIPS,
        validate: raw => (SHORT_STORY_CATEGORIES.some(c => c.name === raw) ? null : '请从平台分类中选择一个'),
    },
    premise: {
        key: 'premise',
        question: '一句话故事：谁、在什么处境、要做什么、最大的阻力是什么？',
        chips: [],
        freeText: true,
        validate: textLimit(10, 200, '一句话故事'),
    },
    coreConflict: {
        key: 'coreConflict',
        question: '核心冲突是什么？（谁和谁/什么规则对抗，为什么不能退）',
        chips: [],
        freeText: true,
        validate: textLimit(6, 160, '核心冲突'),
    },
    emotionalPromise: {
        key: 'emotionalPromise',
        question: '给读者的情绪承诺是什么？（爽/虐/甜/治愈/意难平）',
        chips: [],
        freeText: true,
        validate: textLimit(4, 120, '情绪承诺'),
    },
    reversals: {
        key: 'reversals',
        question: '准备几个反转？分别改变什么认知？',
        chips: [],
        freeText: true,
        validate: textLimit(6, 220, '反转设计'),
    },
    endingPayoff: {
        key: 'endingPayoff',
        question: '结尾如何兑现？请写清最后一个画面/情绪落点。',
        chips: [],
        freeText: true,
        validate: textLimit(6, 180, '结尾兑现'),
    },
    characterCore: {
        key: 'characterCore',
        question: '主角最核心的欲望与软肋是什么？（一句即可）',
        chips: [],
        freeText: true,
        validate: textLimit(4, 160, '角色核心'),
    },
    scriptGenre: {
        key: 'scriptGenre',
        question: '选择红果短剧类型：',
        chips: SCRIPT_GENRE_CHIPS,
        validate: raw => (SCRIPT_GENRES.some(g => g.name === raw) ? null : '请从短剧类型中选择一个'),
    },
    logline: {
        key: 'logline',
        question: '一句话 logline：主角 + 目标 + 阻碍 + 代价。',
        chips: [],
        freeText: true,
        validate: textLimit(10, 160, 'logline'),
    },
    hook3s: {
        key: 'hook3s',
        question: '前 3 秒钩子是什么？（羞辱/危机/身份错位/反常画面）',
        chips: [],
        freeText: true,
        validate: textLimit(6, 120, '3 秒钩子'),
    },
    payoff: {
        key: 'payoff',
        question: '核心爽点/兑现是什么？观众最想看的那一下。',
        chips: [],
        freeText: true,
        validate: textLimit(6, 160, '核心兑现'),
    },
    characters: {
        key: 'characters',
        question: '主要角色与关系：主角、对手、关键盟友各是谁？',
        chips: [],
        freeText: true,
        validate: textLimit(10, 260, '角色设计'),
    },
    scenes: {
        key: 'scenes',
        question: '核心场景/名场面有哪些？写 2–4 个。',
        chips: [],
        freeText: true,
        validate: textLimit(10, 260, '场景设计'),
    },
    targetEpisodes: {
        key: 'targetEpisodes',
        question: '目标集数？',
        chips: EPISODE_CHIPS,
        validate: raw => {
            const n = Number.parseInt(raw, 10);
            return Number.isFinite(n) && n >= 40 && n <= 120 ? null : '集数请填 40–120';
        },
    },
    paywallEpisode: {
        key: 'paywallEpisode',
        question: '强付费卡点放在第几集？',
        chips: PAYWALL_CHIPS,
        validate: raw => {
            const n = Number.parseInt(raw, 10);
            return Number.isFinite(n) && n >= 1 && n <= 120 ? null : '卡点集数请填 1–120';
        },
    },
    mode: { key: 'mode', question: '', chips: [] },
    creationType: { key: 'creationType', question: '', chips: [] },
    executionMode: { key: 'executionMode', question: '', chips: [] },
    useSmartRandom: { key: 'useSmartRandom', question: '', chips: [] },
    pickedProject: { key: 'pickedProject', question: '', chips: [] },
};

const CANCEL_WORDS = ['取消', '退出', '不干了', '算了', 'stop', 'cancel'];
const BACK_WORDS = ['上一步', '返回', 'back'];
const HELP_WORDS = ['帮助', '？', '?', 'help'];
const CONFIRM_WORDS = ['确认', '确认创建', '是', '好', '可以', '创建', 'yes', 'ok', 'confirm'];
/**
 * 否定词：确认阶段必须先排除。CONFIRM_WORDS 含「是/好/可以」且 matchAny 是子串匹配，
 * 「不是这个」「不好，重新来」都会命中确认 → 规则引擎直接创建/覆盖项目。
 */
const NEGATION_WORDS = ['不是', '不要', '不用', '不创建', '不好', '不行', '别', '取消', '算了', '重来', '重新', 'no', 'nope', 'cancel'];
const MODIFY_WORDS = ['修改', '重新配置', '换一个', '重来'];

function chip(label: string, value: string): AgentChip {
    return { label, value };
}

export class GuideAgentEngine {
    private flow: AgentFlowId = 'root';
    private slots: AgentSlots = {};
    private pending: SlotKey[] = [];
    private awaiting: 'slot' | 'confirm' | 'menu' | 'mode' = 'slot';
    private messages: AgentMessage[] = [];
    private lastIntent: AgentIntent = { kind: 'none' };
    private done = false;

    constructor(
        private ctx: AgentContext,
        private readonly port?: GuideAgentPort,
    ) {}

    getSlots(): Readonly<AgentSlots> {
        return { ...this.slots };
    }

    getFlow(): AgentFlowId {
        return this.flow;
    }

    start(): AgentTurnResult {
        const hasProjects = this.ctx.projects.length > 0;
        this.flow = 'root';
        this.slots = {};
        this.pending = [];
        this.done = false;
        this.awaiting = 'slot';
        const hello = hasProjects
            ? `你好！我是小说工坊的对话引导助手 🤖\n检测到你有 ${this.ctx.projects.length} 个项目${this.ctx.activeProject ? `，当前选中「${displayProject(this.ctx.activeProject)}」` : ''}。`
            : '你好！我是小说工坊的对话引导助手 🤖\n先选创作类型，我会带你一步步走完从设定到成稿的流程。';
        this.push(`${hello}\n\n先选择要创作的项目类型：`, this.typeChips());
        this.awaiting = 'slot';
        return this.collect();
    }

    async handle(text: string): Promise<AgentTurnResult> {
        if (this.done) return this.collect();
        const raw = String(text || '').trim();
        if (!raw) {
            this.push('没有收到内容，请再输入一次，或点下面的选项。', this.currentChips());
            return this.collect();
        }
        if (this.matchAny(raw, CANCEL_WORDS)) {
            this.done = true;
            this.flow = 'done';
            this.push('好的，已退出本次引导。随时从命令面板打开「🤖 对话引导」继续。', []);
            return this.collect();
        }
        if (this.matchAny(raw, HELP_WORDS)) {
            this.push(this.hintText(), this.currentChips());
            return this.collect();
        }
        if (raw === '__auto__' || raw.includes('自动完成')) {
            return this.runAuto();
        }
        if (raw.includes('切换模式') || raw === '自动模式' || raw === '引导模式') {
            if (!this.isCreateFlow(this.flow)) {
                this.push('请先选择创作类型和具体路径，再切换执行模式。', this.currentChips());
                return this.collect();
            }
            const auto = raw.includes('自动');
            this.slots.executionMode = auto ? 'auto' : 'guided';
            if (auto) return this.runAuto();
            this.pending = [...this.currentSlots()];
            this.awaiting = 'slot';
            this.push('已切回引导模式，我们继续逐项确认。', []);
            return this.askNext();
        }
        if (this.awaiting === 'slot' && this.matchAny(raw, BACK_WORDS)) {
            this.goBack();
            return this.collect();
        }
        if (this.awaiting === 'mode') return this.handleMode(raw);

        if (this.flow === 'root') return this.handleRoot(raw);
        if (this.flow === 'long_variant') return this.handleLongVariant(raw);
        if (this.isCreateFlow(this.flow)) return this.handleCreate(raw);
        if (this.flow === 'resume') return this.handleResume(raw);
        if (this.flow === 'done' && this.awaiting === 'menu') return this.handlePostCreate(raw);
        this.push('会话已结束。重新打开「🤖 对话引导」即可开始新一轮。', []);
        return this.collect();
    }

    reportAction(
        kind: 'create_project' | 'create_short_project' | 'create_script_project' | 'open_wizard' | 'open_flow' | 'open_story_settings' | 'open_full_writer' | 'open_pre_research',
        outcome: { ok: boolean; detail?: string; projectId?: string },
    ): AgentTurnResult {
        this.lastIntent = { kind: 'none' };
        if (kind === 'create_project' || kind === 'create_short_project' || kind === 'create_script_project') {
            if (outcome.ok) {
                this.slots.pickedProject = outcome.projectId || this.slots.projectName || '';
                this.flow = 'done';
                this.awaiting = 'menu';
                const typeLabel = this.slots.creationType === 'short' ? '短篇' : this.slots.creationType === 'script' ? '剧本' : '长篇';
                this.push(`✅ ${typeLabel}项目「${this.slots.projectName}」创建完成${outcome.detail ? `（${outcome.detail}）` : ''}！`, this.postCreateChips());
            } else {
                this.push(`⚠️ 创建没有完成：${outcome.detail || '未知原因'}。\n可以修改后重试，也可以退出稍后再来。`, [
                    chip('✏️ 修改设定重来', 'retry'),
                    chip('❌ 退出', 'cancel'),
                ]);
            }
        } else if (kind === 'open_wizard') {
            this.done = true;
            this.flow = 'done';
            this.push('🧙 已打开项目向导，按步骤推进即可；需要时再唤醒我。', []);
        } else if (kind === 'open_flow') {
            this.done = true;
            this.flow = 'done';
            this.push('🧭 已打开创作流程：左边能看到当前阶段与下一步，跟着点就行。', []);
        } else if (kind === 'open_story_settings') {
            this.push('🧬 已打开故事结构设置；保存后后续提示词立即使用新结构。', this.postCreateChips());
        } else if (kind === 'open_full_writer') {
            this.push('📖 已打开项目与章节工作台。', this.postCreateChips());
        } else if (kind === 'open_pre_research') {
            this.push('📚 已打开前期调研，可继续补充或修改。', this.postCreateChips());
        }
        return this.collect();
    }

    // ─── 根与类型分支 ──────────────────────────────────────

    private handleRoot(raw: string): AgentTurnResult {
        if (raw === 'long' || raw.includes('长篇')) {
            this.slots.creationType = 'long';
            this.flow = 'long_variant';
            this.awaiting = 'slot';
            this.push('长篇小说分两条路径，先确认创作方式：', VARIANT_CHIPS);
            return this.collect();
        }
        if (raw === 'short' || raw.includes('短篇')) {
            this.slots.creationType = 'short';
            this.flow = 'create_short';
            return this.askMode();
        }
        if (raw === 'script' || raw.includes('剧本') || raw.includes('短剧')) {
            this.slots.creationType = 'script';
            this.flow = 'create_script';
            return this.askMode();
        }
        if (raw === 'resume' || ((raw.includes('继续') || raw.includes('现有')) && this.ctx.projects.length > 0)) {
            this.flow = 'resume';
            this.slots.mode = 'resume';
            if (this.ctx.projects.length === 1) {
                this.slots.pickedProject = this.ctx.projects[0];
                this.awaiting = 'menu';
                this.push(`已选择「${displayProject(this.slots.pickedProject)}」。接下来想做什么？`, this.resumeMenuChips());
                return this.collect();
            }
            this.awaiting = 'slot';
            this.push('请选择一个项目（点选或输入序号）：', this.projectChips());
            return this.collect();
        }
        this.push('我还没识别出项目类型。请选择：长篇小说 / 短篇小说 / 剧本，或继续现有项目。', this.typeChips());
        return this.collect();
    }

    private handleLongVariant(raw: string): AgentTurnResult {
        if (this.matchAny(raw, BACK_WORDS)) {
            this.flow = 'root';
            this.push('已回到类型选择。', this.typeChips());
            return this.collect();
        }
        const isFanfic = raw === 'fanfic' || raw.includes('同人');
        const isOriginal = raw === 'original' || raw.includes('原创');
        if (!isFanfic && !isOriginal) {
            this.push('请选择「原创」或「同人」。', VARIANT_CHIPS);
            return this.collect();
        }
        this.slots.longVariant = isFanfic ? 'fanfic' : 'original';
        this.slots.projectType = isFanfic ? 'fanfic' : 'original';
        this.flow = isFanfic ? 'create_long_fanfic' : 'create_long_original';
        this.push(isFanfic
            ? '同人路径：我会先确认原作、同人类型与改动边界，再配置叙事结构。'
            : '原创路径：我会确认频道、题材与故事结构，再进入创作配置。', []);
        return this.askMode();
    }

    // ─── 执行模式 ──────────────────────────────────────────

    private askMode(): AgentTurnResult {
        this.awaiting = 'mode';
        const label = this.flow === 'create_long_original' || this.flow === 'create_long_fanfic'
            ? '长篇'
            : this.flow === 'create_short' ? '短篇' : '剧本';
        this.push(`已进入${label}路径。选择执行模式：
· 引导模式：每个节点由你选择，我会解释预期效果、适用场景与风险。
· 自动模式：我用自洽随机/默认值填完剩余项并直接创建，不再逐步询问。`, MODE_CHIPS);
        return this.collect();
    }

    private handleMode(raw: string): AgentTurnResult {
        const isAuto = raw === 'auto' || raw.includes('自动');
        const isGuided = raw === 'guided' || raw.includes('引导');
        if (!isAuto && !isGuided) {
            this.push('请选择「引导模式」或「自动模式」。', MODE_CHIPS);
            return this.collect();
        }
        this.slots.executionMode = isAuto ? 'auto' : 'guided';
        if (isAuto) return this.runAuto();
        this.pending = [...this.currentSlots()];
        this.awaiting = 'slot';
        this.push('已进入引导模式：每一步都会给出选项说明，你可以随时输入「自动完成」切到自动模式。', []);
        return this.askNext();
    }

    private runAuto(): AgentTurnResult {
        if (!this.isCreateFlow(this.flow)) {
            this.push('请先选择创作类型和具体路径，再使用自动模式。', this.typeChips());
            return this.collect();
        }
        this.slots.executionMode = 'auto';
        const flowSlots = this.currentSlots();
        const selected: string[] = [];
        for (const key of flowSlots) {
            if (this.filled(key)) continue;
            const value = this.autoValue(key);
            const spec = SLOT_SPECS[key];
            const candidate = spec.toValue ? spec.toValue(value) : value;
            const error = spec.validate?.(candidate, this.ctx);
            if (error) {
                // 自动值必须通过校验；失败就回退到引导，避免写坏项目。
                this.slots.executionMode = 'guided';
                this.pending = [...flowSlots];
                this.awaiting = 'slot';
                this.push(`自动模式在「${spec.key}」处无法生成合法值（${error}），已切回引导模式。`, []);
                return this.askNext();
            }
            (this.slots[key] as string) = candidate;
            selected.push(this.describeSlotValue(key, candidate));
        }
        this.pending = [];
        this.awaiting = 'slot';
        const structure = this.slots.structureId ? getStoryStructure(this.slots.structureId) : null;
        this.push([
            '⚡ 自动模式：已按自洽规则填完剩余项。',
            ...selected.map(line => `· ${line}`),
            structure ? `· 结构说明：${structure.description}` : '',
            '正在创建项目并打开对应工作区，无需你操作。',
        ].filter(Boolean).join('\n'), []);
        this.lastIntent = this.buildIntent();
        return this.collect();
    }

    private autoValue(key: SlotKey): string {
        const generated = generateRandomStorySettings({ genre: this.slots.genre });
        switch (key) {
            case 'projectName': {
                for (let i = 0; i < 20; i++) {
                    const name = `${trueRandom.pick(NAME_PREFIX)}${trueRandom.pick(NAME_SUFFIX)}`;
                    if (!validateProjectName(name, this.ctx.projects.map(displayProject)).valid) continue;
                    return name;
                }
                return `自动项目${trueRandom.randomInt(10000)}`;
            }
            case 'channel':
                return trueRandom.pick(CHANNEL_CHIPS).value;
            case 'genre':
                return trueRandom.pick(GENRES);
            case 'sourceWork':
                return this.slots.sourceWork || '待补充原作';
            case 'fanficType':
                return trueRandom.pick(FANFIC_TYPE_CHIPS).value;
            case 'canonScope':
                return trueRandom.pick(CANON_SCOPE_CHIPS).value;
            case 'structureId':
                return generated.structureId;
            case 'tone':
                return generated.tone;
            case 'goldenFinger':
                return generated.goldenFinger;
            case 'shortCategory':
                return trueRandom.pick(SHORT_STORY_CATEGORIES).name;
            case 'premise': {
                const category = trueRandom.pick(SHORT_STORY_CATEGORIES);
                return `被${category.name}困境逼到墙角的普通人，必须在失去最后依靠前做出反击，并发现真正的对手一直在身边。`;
            }
            case 'coreConflict':
                return trueRandom.pick([
                    '主角与掌握资源的对手正面冲突，退让就会失去最重要的人。',
                    '主角必须在真相与关系之间二选一，任何选择都要付出代价。',
                    '旧秩序与新机会对撞，主角被迫成为两边都不信任的变量。',
                ]);
            case 'emotionalPromise':
                return trueRandom.pick(['先虐后爽，结尾当众清算', '压抑到极点后的情绪释放', '意难平但自洽的收束']);
            case 'reversals':
                return trueRandom.pick([
                    '两次反转：证据反转 + 关系反转，最后翻出真正的操盘者。',
                    '三次反转：身份错位 → 盟友反水 → 主角主动设局反杀。',
                ]);
            case 'endingPayoff':
                return trueRandom.pick([
                    '主角拿回选择权，公开完成兑现，并留下一个可继续的余味。',
                    '反派当众失去筹码，主角保住最重要的人，情绪落点落在“终于被看见”。',
                ]);
            case 'characterCore':
                return trueRandom.pick([
                    '最怕失去家人，也最恨被当成无足轻重的人。',
                    '渴望被认可，但更怕自己变成曾经讨厌的那种人。',
                ]);
            case 'scriptGenre':
                return trueRandom.pick(SCRIPT_GENRES).name;
            case 'logline': {
                const identity = trueRandom.pick(['外卖员', '赘婿', '豪门私生子', '退役战神', '前台小妹']);
                return `被当众羞辱的${identity}，为护住家人被迫暴露隐藏身份，必须在对手反扑前完成反杀。`;
            }
            case 'hook3s':
                return trueRandom.pick(['主角被当众泼酒，全场等着看他出丑。', '亲人被威胁，主角摘下伪装露出真实身份。', '婚礼现场大屏突然放出致命证据。']);
            case 'payoff':
                return trueRandom.pick(['身份曝光、旧部集结、当众反杀。', '证据反杀、对手跪求、主角拿回一切。']);
            case 'characters':
                return '主角（隐忍/有底线）、对手（资源占有者/动机可理解）、关键盟友（掌握证据/旧部）。';
            case 'scenes':
                return '公开羞辱、封闭空间对峙、最终公开反转；每场都改变力量关系。';
            case 'targetEpisodes':
                return '80';
            case 'paywallEpisode':
                return '12';
            default:
                return trueRandom.pick(SLOT_SPECS[key].chips).value || '';
        }
    }

    // ─── 通用创建流程 ──────────────────────────────────────

    private async handleCreate(raw: string): Promise<AgentTurnResult> {
        if (this.awaiting === 'confirm') {
            if (raw === 'retry') {
                this.pending = [...this.currentSlots()];
                this.awaiting = 'slot';
                this.push('好的，重新来一遍。', []);
                return this.askNext();
            }
            // 否定优先于确认：「不是这个」「不好，重新来」含确认词子串，
            // 旧实现据此直接创建/覆盖项目。
            if (this.matchAny(raw, NEGATION_WORDS)) {
                this.pending = [...this.currentSlots()];
                this.awaiting = 'slot';
                this.push('好的，这次不创建。告诉我要修改哪一项，或重新描述你的需求。', []);
                return this.askNext();
            }
            if (this.matchAny(raw, CONFIRM_WORDS)) {
                this.lastIntent = this.buildIntent();
                this.push('收到，正在创建项目，请稍候……', []);
                return this.collect();
            }
            if (raw === 'modify' || this.matchAny(raw, MODIFY_WORDS)) {
                const jump = this.detectJumpTarget(raw);
                if (jump) {
                    this.resetFrom(jump);
                    return this.askNext();
                }
                this.pending = [...this.currentSlots()];
                this.awaiting = 'slot';
                return this.askNext();
            }
            const jump = this.detectJumpTarget(raw);
            if (jump) {
                this.resetFrom(jump);
                return this.askNext();
            }
            this.push('请回复「确认创建」开始，或告诉我要修改哪一项（例如：修改题材/结构/结局）。', this.confirmChips());
            return this.collect();
        }

        const key = this.pending[0];
        if (!key) {
            this.awaiting = 'confirm';
            return this.confirmTurn();
        }
        const spec = SLOT_SPECS[key];

        const applied = await this.tryAiParse(raw);
        if (applied) {
            if (!this.pending.length) {
                this.awaiting = 'confirm';
                return this.confirmTurn();
            }
            return this.askNext();
        }

        let value = this.matchSlotValue(key, raw);
        if (value === null && spec.freeText) value = raw;
        if (value === null) {
            this.push(`没有匹配到「${raw}」。${spec.question}`, spec.chips.length > 0 ? spec.chips : this.currentChips());
            return this.collect();
        }
        if (value === '__random__') {
            const randomValue = spec.randomFill ? spec.randomFill(this.slots) : '';
            if (key === 'structureId') this.slots.useSmartRandom = true;
            return await this.applySlot(key, randomValue, true);
        }
        if (value === '__skip__') {
            return await this.applySlot(key, '', true);
        }
        return await this.applySlot(key, spec.toValue ? spec.toValue(value) : value, false);
    }

    private async applySlot(key: SlotKey, rawValue: string, silent: boolean): Promise<AgentTurnResult> {
        const spec = SLOT_SPECS[key];
        if (rawValue !== '') {
            const error = spec.validate?.(rawValue, this.ctx);
            if (error) {
                this.push(`⚠️ ${error}。${spec.question}`, spec.chips.length > 0 ? spec.chips : this.currentChips());
                return this.collect();
            }
            (this.slots[key] as string) = rawValue;
        } else {
            (this.slots[key] as string) = '';
        }
        if (!silent) {
            this.push(`已记录：${this.describeSlotValue(key, rawValue)}`, []);
        }
        const idx = this.pending.indexOf(key);
        if (idx >= 0) this.pending.splice(idx, 1);
        if (this.pending.length === 0) {
            this.awaiting = 'confirm';
            return this.confirmTurn();
        }
        return this.askNext();
    }

    private async tryAiParse(raw: string): Promise<boolean> {
        const aiParse = this.port?.aiParse;
        if (!aiParse) return false;
        try {
            const parsed = await aiParse(raw, this.ctx, this.pending);
            if (!parsed) return false;
            let applied = false;
            for (const key of [...this.pending]) {
                const value = (parsed as Record<string, unknown>)[key];
                if (typeof value !== 'string' || !value.trim()) continue;
                const spec = SLOT_SPECS[key];
                const candidate = value.trim();
                if (candidate === '__random__') {
                    const randomValue = spec.randomFill ? spec.randomFill(this.slots) : '';
                    if (key === 'structureId') this.slots.useSmartRandom = true;
                    await this.applySlot(key, randomValue, true);
                    applied = true;
                    continue;
                }
                const error = spec.validate?.(candidate, this.ctx);
                if (error) continue;
                await this.applySlot(key, spec.toValue ? spec.toValue(candidate) : candidate, true);
                applied = true;
            }
            return applied;
        } catch {
            return false;
        }
    }

    private matchSlotValue(key: SlotKey, raw: string): string | null {
        const spec = SLOT_SPECS[key];
        const lower = raw.toLowerCase();
        if (raw === '__skip__') return '__skip__';
        if (raw === '__random__') return '__random__';
        if (lower === 'random' || (raw.includes('随机') && spec.chips.some(c => c.value === '__random__'))) return '__random__';
        if ((raw.includes('跳过') || raw.includes('默认')) && spec.chips.some(c => c.value === '__skip__')) return '__skip__';
        for (const c of spec.chips) {
            if (c.value === '__random__' || c.value === '__skip__') continue;
            if (raw === c.value || raw === c.label || c.label.includes(raw) || raw.includes(c.value)) return c.value;
        }
        const index = Number.parseInt(raw, 10);
        if (Number.isFinite(index)) {
            const usable = spec.chips.filter(c => c.value !== '__random__' && c.value !== '__skip__');
            if (index >= 1 && index <= usable.length) return usable[index - 1].value;
        }
        if (key === 'projectType' || key === 'longVariant') {
            if (raw.includes('原创')) return 'original';
            if (raw.includes('同人')) return 'fanfic';
        }
        if (key === 'structureId') {
            const hit = STORY_STRUCTURES.find(s => raw.includes(s.name));
            if (hit) return hit.id;
        }
        return null;
    }

    // ─── 确认与意图 ────────────────────────────────────────

    private confirmTurn(): AgentTurnResult {
        const lines = ['信息收集完毕，请确认：', ''];
        if (this.flow === 'create_long_original') {
            const structure = getStoryStructure(this.slots.structureId!);
            lines.push(
                `· 类型：长篇原创 · ${this.slots.channel || '未选频道'}`,
                `· 项目名：${this.slots.projectName}`,
                `· 题材：${this.slots.genre}`,
                `· 故事结构：${structure.icon} ${structure.name}（${structure.stages.map(s => `${s.name} ${s.ratio}%`).join(' · ')}）`,
                `· 叙事基调：${this.slots.tone || '默认'}`,
                `· 金手指：${this.slots.goldenFinger || '默认'}`,
            );
        } else if (this.flow === 'create_long_fanfic') {
            const structure = getStoryStructure(this.slots.structureId!);
            lines.push(
                `· 类型：长篇同人 · 原作《${this.slots.sourceWork}》`,
                `· 项目名：${this.slots.projectName}`,
                `· 同人类型：${this.slots.fanficType || '未选'}；改动范围：${this.slots.canonScope || '未选'}`,
                `· 题材：${this.slots.genre}`,
                `· 故事结构：${structure.icon} ${structure.name}`,
                `· 叙事基调：${this.slots.tone || '默认'}`,
            );
        } else if (this.flow === 'create_short') {
            lines.push(
                '· 类型：番茄短篇小说（默认 8 万字 / 20 节）',
                `· 项目名：${this.slots.projectName}`,
                `· 分类：${this.slots.shortCategory}`,
                `· 一句话故事：${this.slots.premise}`,
                `· 核心冲突：${this.slots.coreConflict}`,
                `· 情绪承诺：${this.slots.emotionalPromise}`,
                `· 反转：${this.slots.reversals}`,
                `· 结尾兑现：${this.slots.endingPayoff}`,
                `· 主角核心：${this.slots.characterCore}`,
            );
        } else {
            lines.push(
                '· 类型：红果短剧剧本（默认 6 万字 / 90 秒一集）',
                `· 项目名：${this.slots.projectName}`,
                `· 类型：${this.slots.scriptGenre}`,
                `· Logline：${this.slots.logline}`,
                `· 3 秒钩子：${this.slots.hook3s}`,
                `· 核心冲突：${this.slots.coreConflict}`,
                `· 核心兑现：${this.slots.payoff}`,
                `· 角色：${this.slots.characters}`,
                `· 场景：${this.slots.scenes}`,
                `· 集数：${this.slots.targetEpisodes}；付费卡点：第 ${this.slots.paywallEpisode} 集`,
            );
        }
        lines.push('', '确认后我会创建项目、写入前期资料并打开对应工作区。');
        this.push(lines.join('\n'), this.confirmChips());
        return this.collect();
    }

    private buildIntent(): AgentIntent {
        if (this.flow === 'create_long_original' || this.flow === 'create_long_fanfic') {
            const base = createDefaultStorySettings(this.slots.structureId!);
            if (this.slots.tone) base.tone = this.slots.tone;
            if (this.slots.goldenFinger) base.goldenFinger = this.slots.goldenFinger;
            base.randomSeed = this.slots.useSmartRandom ? trueRandom.uuid() : '';
            return {
                kind: 'create_long_project',
                params: {
                    projectName: this.slots.projectName!,
                    genre: this.slots.genre!,
                    projectType: this.slots.projectType || 'original',
                    sourceWork: this.slots.sourceWork,
                    channel: this.slots.channel,
                    fanficType: this.slots.fanficType,
                    canonScope: this.slots.canonScope,
                    storySettings: base,
                },
            };
        }
        if (this.flow === 'create_short') {
            return {
                kind: 'create_short_project',
                params: {
                    projectName: this.slots.projectName!,
                    targetWords: 80000,
                    targetSections: 20,
                    preResearch: {
                        primaryCategory: this.slots.shortCategory || '',
                        premise: this.slots.premise || '',
                        coreConflict: this.slots.coreConflict || '',
                        emotionalPromise: this.slots.emotionalPromise || '',
                        reversals: this.slots.reversals || '',
                        endingPayoff: this.slots.endingPayoff || '',
                        characterCore: this.slots.characterCore || '',
                    },
                },
            };
        }
        return {
            kind: 'create_script_project',
            params: {
                projectName: this.slots.projectName!,
                genre: this.slots.scriptGenre || '短剧',
                preResearch: {
                    scriptGenre: this.slots.scriptGenre || '',
                    logline: this.slots.logline || '',
                    hook3s: this.slots.hook3s || '',
                    coreConflict: this.slots.coreConflict || '',
                    payoff: this.slots.payoff || '',
                    characters: this.slots.characters || '',
                    scenes: this.slots.scenes || '',
                    targetEpisodes: Number.parseInt(this.slots.targetEpisodes || '80', 10) || 80,
                    paywallEpisode: Number.parseInt(this.slots.paywallEpisode || '12', 10) || 12,
                },
            },
        };
    }

    // ─── 继续与管理 ────────────────────────────────────────

    private handleResume(raw: string): AgentTurnResult {
        if (this.awaiting === 'slot') {
            const picked = this.ctx.projects.find(p =>
                p === raw || displayProject(p) === raw || displayProject(p).includes(raw) || raw.includes(displayProject(p)));
            if (!picked) {
                const index = Number.parseInt(raw, 10);
                if (Number.isFinite(index) && index >= 1 && index <= this.ctx.projects.length) {
                    this.slots.pickedProject = this.ctx.projects[index - 1];
                }
            } else {
                this.slots.pickedProject = picked;
            }
            if (!this.slots.pickedProject) {
                this.push('没有匹配到这个项目。可以点选，或输入序号：', this.projectChips());
                return this.collect();
            }
            this.awaiting = 'menu';
            this.push(`已选择「${displayProject(this.slots.pickedProject)}」。接下来想做什么？`, this.resumeMenuChips());
            return this.collect();
        }
        const project = this.slots.pickedProject || '';
        if (raw.includes('创作流程') || raw.includes('flow')) {
            this.lastIntent = { kind: 'open_flow', project };
            this.push('正在打开创作流程……', []);
            return this.collect();
        }
        if (raw.includes('向导') || raw.includes('wizard')) {
            this.lastIntent = { kind: 'open_wizard', project };
            this.push('正在打开项目向导……', []);
            return this.collect();
        }
        if (raw.includes('结构')) {
            this.lastIntent = { kind: 'open_story_settings', project };
            this.push('正在打开故事结构设置……', []);
            return this.collect();
        }
        if (raw.includes('章节') || raw.includes('工作台') || raw.includes('写作')) {
            this.lastIntent = { kind: 'open_full_writer', project };
            this.push('正在打开项目与章节……', []);
            return this.collect();
        }
        this.push('请选择下一步。', this.resumeMenuChips());
        return this.collect();
    }

    private handlePostCreate(raw: string): AgentTurnResult {
        if (raw === 'done' || raw.includes('就到这里')) {
            this.done = true;
            this.push('好的，项目已就绪。随时从命令面板打开「🤖 对话引导」继续。', []);
            return this.collect();
        }
        const project = this.slots.pickedProject || this.slots.projectName || '';
        if (raw.includes('创作流程') || raw.includes('flow')) {
            this.lastIntent = { kind: 'open_flow', project };
            this.push('正在打开创作流程……', []);
            return this.collect();
        }
        if (raw.includes('前期调研') || raw.includes('research')) {
            const mode = this.slots.creationType === 'script' ? 'script' : 'short';
            this.lastIntent = { kind: 'open_pre_research', mode, project };
            this.push('正在打开前期调研……', []);
            return this.collect();
        }
        if (raw.includes('向导') || raw.includes('wizard')) {
            this.lastIntent = { kind: 'open_wizard', project };
            this.push('正在打开项目向导……', []);
            return this.collect();
        }
        if (raw.includes('结构')) {
            this.lastIntent = { kind: 'open_story_settings', project };
            this.push('正在打开故事结构设置……', []);
            return this.collect();
        }
        if (raw.includes('章节') || raw.includes('工作台') || raw.includes('写作')) {
            this.lastIntent = { kind: 'open_full_writer', project };
            this.push('正在打开项目与章节……', []);
            return this.collect();
        }
        this.push('还需要我做什么？', this.postCreateChips());
        return this.collect();
    }

    // ─── 工具 ──────────────────────────────────────────────

    private isCreateFlow(flow: AgentFlowId): flow is CreateFlow {
        return flow === 'create_long_original' || flow === 'create_long_fanfic'
            || flow === 'create_short' || flow === 'create_script';
    }

    private currentSlots(): SlotKey[] {
        return this.isCreateFlow(this.flow) ? FLOW_SLOTS[this.flow] : [];
    }

    private askNext(): AgentTurnResult {
        const key = this.pending[0];
        if (!key) {
            this.awaiting = 'confirm';
            return this.confirmTurn();
        }
        const spec = SLOT_SPECS[key];
        this.push(`${spec.question}${this.slotProgress()}`, [...spec.chips, chip('⚡ 自动完成剩余项', '__auto__')]);
        return this.collect();
    }

    private slotProgress(): string {
        const flowSlots = this.currentSlots();
        const done = flowSlots.filter(k => this.filled(k)).length;
        return `\n\n（进度 ${done}/${flowSlots.length}；输入「上一步」可返回修改，输入「取消」退出）`;
    }

    private filled(key: SlotKey): boolean {
        const v = this.slots[key];
        return typeof v === 'string' && v.length > 0;
    }

    private typeChips(): AgentChip[] {
        const chips = [
            chip('📖 长篇小说', 'long'),
            chip('📄 短篇小说', 'short'),
            chip('🎬 剧本', 'script'),
        ];
        if (this.ctx.projects.length > 0) chips.push(chip('📂 继续现有项目', 'resume'));
        chips.push(chip('❌ 退出', 'cancel'));
        return chips;
    }

    private confirmChips(): AgentChip[] {
        return [
            chip('✅ 确认创建', 'confirm'),
            chip('✏️ 修改设定', 'modify'),
            chip('❌ 取消', 'cancel'),
        ];
    }

    private postCreateChips(): AgentChip[] {
        if (this.slots.creationType === 'long') {
            return [
                chip('🧭 打开创作流程', 'flow'),
                chip('🧙 打开项目向导', 'wizard'),
                chip('🧬 修改故事结构', 'structure'),
                chip('📖 打开项目与章节', 'writer'),
                chip('✅ 就到这里', 'done'),
            ];
        }
        const unitLabel = this.slots.creationType === 'script' ? '集' : '节';
        return [
            chip('🧭 打开创作流程', 'flow'),
            chip('📚 编辑前期调研', 'research'),
            chip(`✍️ 开始写第1${unitLabel}`, 'writer'),
            chip('✅ 就到这里', 'done'),
        ];
    }

    private resumeMenuChips(): AgentChip[] {
        const mode = modeFromPathPrefix(this.slots.pickedProject || '');
        if (mode === 'short' || mode === 'script') {
            const unitLabel = mode === 'script' ? '集' : '节';
            return [
                chip('🧭 打开创作流程', 'flow'),
                chip('📚 编辑前期调研', 'research'),
                chip(`✍️ 继续写${unitLabel}`, 'writer'),
                chip('❌ 退出', 'cancel'),
            ];
        }
        return [
            chip('🧭 打开创作流程', 'flow'),
            chip('🧙 打开项目向导', 'wizard'),
            chip('🧬 修改故事结构', 'structure'),
            chip('📖 打开项目与章节', 'writer'),
            chip('❌ 退出', 'cancel'),
        ];
    }

    private projectChips(): AgentChip[] {
        return this.ctx.projects.slice(0, 9).map((p, i) => chip(`${i + 1}. ${displayProject(p)}`, p));
    }

    private currentChips(): AgentChip[] {
        if (this.awaiting === 'confirm') return this.confirmChips();
        if (this.flow === 'root') return this.typeChips();
        if (this.flow === 'long_variant') return VARIANT_CHIPS;
        if (this.flow === 'resume') return this.awaiting === 'slot' ? this.projectChips() : this.resumeMenuChips();
        if (this.flow === 'done') return this.postCreateChips();
        const key = this.pending[0];
        return key ? [...SLOT_SPECS[key].chips, chip('⚡ 自动完成剩余项', '__auto__')] : [];
    }

    private hintText(): string {
        return [
            '你可以这样和我对话：',
            '· 先选创作类型；长篇还会区分原创/同人；',
            '· 点选按钮，或直接输入选项文字 / 序号；',
            '· 「随机」「智能随机」会按规则生成自洽组合；',
            '· 「上一步」返回修改；「取消」退出；',
            '· 一句话说清多项也可以，例如「叫九霄逆行，玄幻，男频，用三幕式」。',
        ].join('\n');
    }

    private detectJumpTarget(raw: string): SlotKey | null {
        const flowSlots = this.currentSlots();
        const has = (key: SlotKey) => flowSlots.includes(key);
        if ((raw.includes('名字') || raw.includes('书名') || raw.includes('项目名')) && has('projectName')) return 'projectName';
        if (raw.includes('频道') && has('channel')) return 'channel';
        if (raw.includes('题材') && has('genre')) return 'genre';
        if (raw.includes('原作') && has('sourceWork')) return 'sourceWork';
        if (raw.includes('同人类型') && has('fanficType')) return 'fanficType';
        if (raw.includes('改动') && has('canonScope')) return 'canonScope';
        if (raw.includes('结构') && has('structureId')) return 'structureId';
        if (raw.includes('基调') && has('tone')) return 'tone';
        if (raw.includes('金手指') && has('goldenFinger')) return 'goldenFinger';
        if (raw.includes('分类') && has('shortCategory')) return 'shortCategory';
        if (raw.includes('一句话') && has('premise')) return 'premise';
        if (raw.includes('情绪') && has('emotionalPromise')) return 'emotionalPromise';
        if (raw.includes('反转') && has('reversals')) return 'reversals';
        if (raw.includes('结尾') && has('endingPayoff')) return 'endingPayoff';
        if (raw.includes('logline') && has('logline')) return 'logline';
        if (raw.includes('钩子') && has('hook3s')) return 'hook3s';
        if (raw.includes('兑现') && has('payoff')) return 'payoff';
        if (raw.includes('角色') && has('characters')) return 'characters';
        if (raw.includes('场景') && has('scenes')) return 'scenes';
        if (raw.includes('集数') && has('targetEpisodes')) return 'targetEpisodes';
        if (raw.includes('卡点') && has('paywallEpisode')) return 'paywallEpisode';
        return null;
    }

    private resetFrom(key: SlotKey): void {
        const flowSlots = this.currentSlots();
        const idx = flowSlots.indexOf(key);
        this.pending = [...flowSlots.slice(Math.max(0, idx))];
        for (const k of this.pending) (this.slots[k] as string | undefined) = undefined;
        this.awaiting = 'slot';
    }

    private goBack(): void {
        const flowSlots = this.currentSlots();
        if (flowSlots.length === 0) {
            this.flow = 'root';
            this.push('已回到起点。', this.typeChips());
            return;
        }
        const currentIndex = flowSlots.indexOf(this.pending[0]);
        const targetIndex = this.awaiting === 'confirm' ? flowSlots.length - 1 : Math.max(0, currentIndex - 1);
        const key = flowSlots[targetIndex];
        (this.slots[key] as string | undefined) = undefined;
        this.pending = [...flowSlots.slice(targetIndex)];
        this.awaiting = 'slot';
        this.push('已返回上一步。', []);
        this.askNext();
    }

    private describeSlotValue(key: SlotKey, value: string): string {
        if (key === 'structureId') {
            const s = getStoryStructure(value);
            return `故事结构 = ${s.name}（${s.stages.map(stage => `${stage.name} ${stage.ratio}%`).join(' · ')}）`;
        }
        if (key === 'projectType' || key === 'longVariant') {
            return value === 'fanfic' ? '同人' : '原创';
        }
        const spec = SLOT_SPECS[key];
        const hit = spec.chips.find(c => c.value === value);
        return `${spec.key} = ${hit ? hit.label.replace(/^[^ ]+ /, '') : value}`;
    }

    private matchAny(raw: string, words: string[]): boolean {
        return words.some(w => raw === w || raw.includes(w));
    }

    private push(text: string, chips?: AgentChip[]): void {
        this.messages.push({ role: 'agent', text, chips });
    }

    private collect(): AgentTurnResult {
        const messages = this.messages;
        this.messages = [];
        const intent = this.lastIntent;
        this.lastIntent = { kind: 'none' };
        return { messages, intent, done: this.done };
    }
}
