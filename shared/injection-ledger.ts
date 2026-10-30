/**
 * injection-ledger.ts — 注入影响溯源账本
 *
 * 回答一个问题：「这一次 AI 调用，到底有哪些内容影响了它、各占多少、
 * 有没有被预算截断？」
 *
 * 两类影响面（用户口径）：
 * - 事实记忆（防 OOC）：长期记忆 / 实体速览 / 设定库 / 时间线 / 伏笔——写错就是事实矛盾；
 * - 风格指引（指引内容风格）：写作指纹 / 文风预设 / 场景风格 / 人味约束——失效的表现是文风漂移，
 *   而不是事实错误。它们同样是跨章节持续生效的"记忆"，只是维度不同。
 *
 * 纯函数，不依赖 Obsidian。字符 → token 估算沿用 CHAR_TO_TOKEN_RATIO（1.5 字/token）。
 */

/** 影响面：这条注入塑造的是输出的哪一面 */
export type InjectionInfluence =
    | '事实记忆'
    | '风格指引'
    | '流程约束';

/** 注入段类别（影响矩阵的行） */
export type InjectionCategory =
    | '世界观'
    | '设定库'
    | '实体'
    | '文风预设'
    | '写作指纹'
    | '知识注入'
    | '长篇记忆'
    | '实体速览'
    | '章纲'
    | '流程';

export interface InjectionSegmentSpec {
    /** 模板变量名（${key}） */
    key: string;
    label: string;
    category: InjectionCategory;
    influence: InjectionInfluence;
    /** 来源说明（文件/引擎），展示用 */
    source: string;
    /** 注入位置 */
    placement: 'system' | 'user' | 'both';
}

export interface InjectionLedgerEntry extends InjectionSegmentSpec {
    /** 段落字符数（空段为 0） */
    chars: number;
    /** 估算 token（chars / CHAR_TO_TOKEN_RATIO 向上取整） */
    estTokens: number;
    /** 有预算的段标注预算（字符）；无预算段省略 */
    budget?: number;
    /** 本次实际被预算截断 */
    truncated?: boolean;
    /** 指纹/知识等引擎给出的强度或命中说明 */
    strength?: string;
}

export interface InjectionLedger {
    entries: InjectionLedgerEntry[];
    /** 全部段合计字符数（不含空段？含——空段也是信息） */
    totalChars: number;
    totalEstTokens: number;
    /** 被截断的段数 */
    truncatedCount: number;
    /** 生成时间 */
    generatedAt: number;
}

/** token 估算比率（与 shared/thresholds.CHAR_TO_TOKEN_RATIO 一致；此处复制避免 shared→shared 反向依赖环） */
const CHAR_PER_TOKEN = 1.5;

/**
 * V2 正文模板的注入段清单（key 与 BODY_GENERATION_USER_TEMPLATE_V2 / SYSTEM 对应）。
 * 影响矩阵：每段标注它塑造输出 的哪一面。
 * system 段：writingRules/protagonistSoulDetail/emotionPlan(sys)/triggeredMemories/craftConstraints/humanVoice/negativeList/bodyFormat 等。
 */
export const BODY_INJECTION_SEGMENTS: InjectionSegmentSpec[] = [
    { key: 'writingRules', label: '写作规则', category: '流程', influence: '流程约束', source: '项目 写作规则.md / 元文件模板', placement: 'system' },
    { key: 'protagonistSoulDetail', label: '主角灵魂层', category: '实体', influence: '事实记忆', source: '角色灵魂提取（结算/人物卡）', placement: 'system' },
    { key: 'emotionPlan', label: '情绪弧', category: '流程', influence: '流程约束', source: '情绪规划步骤 / 故事总线', placement: 'both' },
    { key: 'triggeredMemories', label: '记忆碎片', category: '实体', influence: '事实记忆', source: '记忆碎片.md 触发', placement: 'system' },
    { key: 'prevChapterStateSnapshot', label: '上一章状态快照', category: '长篇记忆', influence: '事实记忆', source: '上一章结算状态', placement: 'system' },
    { key: 'bodyFormat', label: '正文格式', category: '流程', influence: '流程约束', source: '内置格式约束', placement: 'system' },
    { key: 'craftConstraints', label: '工艺约束', category: '流程', influence: '流程约束', source: '场景工艺约束集', placement: 'system' },
    { key: 'humanVoice', label: '人味约束', category: '流程', influence: '风格指引', source: 'human-voice v3（去AI味实战规则）', placement: 'system' },
    { key: 'negativeList', label: '负面清单', category: '流程', influence: '风格指引', source: '禁用词/禁用句式', placement: 'system' },
    { key: 'outlineContent', label: '本章大纲', category: '流程', influence: '流程约束', source: '大纲摘要步骤', placement: 'user' },
    { key: 'chapPlan', label: '分卷定位', category: '流程', influence: '流程约束', source: '分卷大纲', placement: 'user' },
    { key: 'infoPlan', label: '信息规划（含章纲硬要求）', category: '章纲', influence: '流程约束', source: '信息规划步骤 + 开头承接/钩子/伏笔字段', placement: 'user' },
    { key: 'entityRelations', label: '实体状态速览', category: '实体速览', influence: '事实记忆', source: '结算回写 + 图谱反查（零 AI）', placement: 'user' },
    { key: 'sceneExpansion', label: '场景展开', category: '流程', influence: '流程约束', source: 'Scene 展开步骤', placement: 'user' },
    { key: 'sceneCardDigest', label: '场景卡', category: '流程', influence: '流程约束', source: '场景卡（POV/地点/入场转折离场）', placement: 'user' },
    { key: 'storyContextPack', label: '故事上下文包', category: '长篇记忆', influence: '事实记忆', source: '故事上下文总线（预算 4200/24000 token）', placement: 'user' },
    { key: 'sceneStyleSnippet', label: '场景风格参考', category: '写作指纹', influence: '风格指引', source: '同类型场景句法样本', placement: 'user' },
    { key: 'suggestedRhythm', label: '叙事节奏建议', category: '流程', influence: '风格指引', source: '节奏意图引擎', placement: 'user' },
    { key: 'distilledContent', label: '情节节点', category: '流程', influence: '流程约束', source: '情节蒸馏步骤', placement: 'user' },
    { key: 'prevChaptersSummary', label: '前情提要', category: '长篇记忆', influence: '事实记忆', source: '前文压缩摘要', placement: 'user' },
    { key: 'prevChapEnding', label: '上一章结尾', category: '长篇记忆', influence: '事实记忆', source: '上一章正文末段', placement: 'user' },
    { key: 'longTermMemory', label: '长篇记忆', category: '长篇记忆', influence: '事实记忆', source: '事实索引 confirmed 事实 + 前情提要（≤1500/≤2000 字符）', placement: 'user' },
    { key: 'worldView', label: '世界观', category: '世界观', influence: '事实记忆', source: '世界观.md（总线覆盖后有预算）', placement: 'user' },
    { key: 'settingLib', label: '设定库', category: '设定库', influence: '事实记忆', source: '设定库.md（总线覆盖后有预算）', placement: 'user' },
    { key: 'allChars', label: '人物与势力状态', category: '实体', influence: '事实记忆', source: '实体评分选取（结算回写状态）', placement: 'user' },
    { key: 'allFactions', label: '势力状态', category: '实体', influence: '事实记忆', source: '实体评分选取', placement: 'user' },
    { key: 'allLocs', label: '地点', category: '实体', influence: '事实记忆', source: '实体评分选取', placement: 'user' },
    { key: 'allItems', label: '物品功法', category: '实体', influence: '事实记忆', source: '实体评分选取（含所属/归属链接与当前状态）', placement: 'user' },
    { key: 'timelineEvents', label: '时间线', category: '长篇记忆', influence: '事实记忆', source: '时间线看板（本章时间不得倒退）', placement: 'user' },
    { key: 'unrevealedForeshadow', label: '待处理伏笔', category: '长篇记忆', influence: '事实记忆', source: '伏笔库过滤本章', placement: 'user' },
    { key: 'writingStyleContent', label: '文笔风格预设', category: '文风预设', influence: '风格指引', source: '01-世界架构/文笔风格.md', placement: 'user' },
];

/** 指纹分层的账本段（由 PromptBuilder/引擎运行时填充，不在静态表里） */
export const FINGERPRINT_LEDGER_KEY = 'fingerprintTiers';
export const KNOWLEDGE_LEDGER_KEY = 'knowledgeHits';

function estimateTokens(chars: number): number {
    return Math.ceil(chars / CHAR_PER_TOKEN);
}

/**
 * 从模板变量生成注入账本。
 * 预算与截断信息通过 `budgets` 传入（key → { budget, truncated }），由各引擎运行时填充；
 * 静态表没有的 key（如指纹分层）通过 `extra` 追加。
 */
export function buildInjectionLedger(
    vars: Record<string, string>,
    options: {
        budgets?: Record<string, { budget: number; truncated: boolean; strength?: string }>;
        extra?: InjectionLedgerEntry[];
        segments?: InjectionSegmentSpec[];
    } = {},
): InjectionLedger {
    const segments = options.segments ?? BODY_INJECTION_SEGMENTS;
    const entries: InjectionLedgerEntry[] = [];

    for (const segment of segments) {
        const raw = vars[segment.key];
        const text = typeof raw === 'string' ? raw.trim() : '';
        const chars = text.length;
        const budgetInfo = options.budgets?.[segment.key];
        const entry: InjectionLedgerEntry = {
            ...segment,
            chars,
            estTokens: estimateTokens(chars),
            placement: segment.placement,
        };
        if (budgetInfo) {
            entry.budget = budgetInfo.budget;
            entry.truncated = budgetInfo.truncated;
            if (budgetInfo.strength) entry.strength = budgetInfo.strength;
        }
        entries.push(entry);
    }

    for (const extra of options.extra || []) {
        entries.push(extra);
    }

    const totalChars = entries.reduce((sum, entry) => sum + entry.chars, 0);
    const totalEstTokens = entries.reduce((sum, entry) => sum + entry.estTokens, 0);
    const truncatedCount = entries.filter((entry) => entry.truncated).length;

    return {
        entries,
        totalChars,
        totalEstTokens,
        truncatedCount,
        generatedAt: Date.now(),
    };
}

/** 渲染为可读文本（执行日志 / 调试窗口用） */
export function formatInjectionLedger(ledger: InjectionLedger): string {
    const lines: string[] = [
        `【注入溯源】共 ${ledger.entries.length} 段 / ${ledger.totalChars} 字符 / ~${ledger.totalEstTokens} token` +
            (ledger.truncatedCount > 0 ? ` / ⚠ ${ledger.truncatedCount} 段被截断` : ''),
    ];
    for (const entry of ledger.entries) {
        if (entry.chars === 0) continue;
        const flags: string[] = [];
        if (entry.budget !== undefined) flags.push(`预算 ${entry.budget}`);
        if (entry.truncated) flags.push('⚠截断');
        if (entry.strength) flags.push(entry.strength);
        const suffix = flags.length > 0 ? `（${flags.join('，')}）` : '';
        lines.push(`- [${entry.influence}] ${entry.label}：${entry.chars} 字 ~${entry.estTokens} token${suffix} ← ${entry.source}`);
    }
    return lines.join('\n');
}
