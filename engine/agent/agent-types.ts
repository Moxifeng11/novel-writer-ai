/**
 * agent-types.ts — 对话引导 Agent 的纯类型与流定义
 *
 * 参考 DeepSeek Harness 的分层：Memory（会话槽位）/ Tools（Port 注入的宿主能力）
 * / Planner（guide-flow 阶段定义）/ Runner（ConversationEngine）。
 * 引擎层不依赖 Obsidian 与 UI：宿主能力通过 GuideAgentPort 注入。
 */
import type { LongStorySettings, StoryStructureId } from '@/shared/story-structure';

/**
 * Agent 引导流程 id。
 */
export type AgentFlowId =
    | 'root'
    | 'long_variant'
    | 'create_long_original'
    | 'create_long_fanfic'
    | 'create_short'
    | 'create_script'
    | 'resume'
    | 'done';

/**
 * Agent 选择卡。
 */
export interface AgentChip {
    label: string;
    value: string;
    /** 预期效果/说明 */
    description?: string;
    /** 适用场景 */
    bestFor?: string;
    /** 风险提示 */
    risk?: string;
    /** 操作预览 */
    preview?: string;
}

/**
 * Agent 消息。
 */
export interface AgentMessage {
    role: 'agent' | 'system';
    text: string;
    chips?: AgentChip[];
}

/**
 * Agent 槽位集合。
 */
export interface AgentSlots {
    mode?: 'create' | 'resume';
    /** 用户在最前端选择的创作类型 */
    creationType?: 'long' | 'short' | 'script';
    /** 引导模式 / 自动模式 */
    executionMode?: 'guided' | 'auto';
    projectName?: string;
    genre?: string;
    projectType?: 'original' | 'fanfic';
    /** 长篇小说原创/同人两条路径 */
    longVariant?: 'original' | 'fanfic';
    channel?: string;
    sourceWork?: string;
    fanficType?: string;
    canonScope?: string;
    structureId?: StoryStructureId;
    tone?: string;
    goldenFinger?: string;
    shortCategory?: string;
    premise?: string;
    coreConflict?: string;
    emotionalPromise?: string;
    reversals?: string;
    endingPayoff?: string;
    characterCore?: string;
    scriptGenre?: string;
    logline?: string;
    hook3s?: string;
    payoff?: string;
    characters?: string;
    scenes?: string;
    targetEpisodes?: string;
    paywallEpisode?: string;
    /** 结构槽位上点了「智能随机」时置位 */
    useSmartRandom?: boolean;
    /** 继续现有项目时选中的项目 */
    pickedProject?: string;
}

/**
 * Agent 上下文。
 */
export interface AgentContext {
    projects: string[];
    activeProject: string | null;
}

/**
 * 新建长篇意图参数。
 */
export interface CreateLongIntentParams {
    projectName: string;
    genre: string;
    projectType: 'original' | 'fanfic';
    sourceWork?: string;
    channel?: string;
    fanficType?: string;
    canonScope?: string;
    storySettings: LongStorySettings;
}

/**
 * 短篇前期调研槽位。
 */
export interface ShortPreResearchSlots {
    primaryCategory: string;
    premise: string;
    coreConflict: string;
    emotionalPromise: string;
    reversals: string;
    endingPayoff: string;
    characterCore: string;
}

/**
 * 新建短篇意图参数。
 */
export interface CreateShortIntentParams {
    projectName: string;
    targetWords: number;
    targetSections: number;
    preResearch: ShortPreResearchSlots;
}

/**
 * 剧本前期调研槽位。
 */
export interface ScriptPreResearchSlots {
    scriptGenre: string;
    logline: string;
    hook3s: string;
    coreConflict: string;
    payoff: string;
    characters: string;
    scenes: string;
    targetEpisodes: number;
    paywallEpisode: number;
}

/**
 * 新建剧本意图参数。
 */
export interface CreateScriptIntentParams {
    projectName: string;
    genre: string;
    preResearch: ScriptPreResearchSlots;
}

/**
 * Agent 意图联合类型。
 */
export type AgentIntent =
    | { kind: 'create_long_project'; params: CreateLongIntentParams }
    | { kind: 'create_short_project'; params: CreateShortIntentParams }
    | { kind: 'create_script_project'; params: CreateScriptIntentParams }
    | { kind: 'open_wizard'; project: string }
    | { kind: 'open_flow'; project: string }
    | { kind: 'open_story_settings'; project: string }
    | { kind: 'open_full_writer'; project: string }
    | { kind: 'open_pre_research'; mode: 'short' | 'script'; project?: string }
    | { kind: 'none' };

/**
 * Agent 单回合结果。
 */
export interface AgentTurnResult {
    messages: AgentMessage[];
    intent: AgentIntent;
    /** 会话是否已结束（用户取消或完成全部菜单） */
    done: boolean;
}

/**
 * Agent 动作类型。
 */
export type AgentActionKind = 'create_project' | 'open_wizard' | 'open_flow' | 'open_story_settings' | 'open_full_writer' | 'open_pre_research';

/**
 * 章节摘要。
 */
export interface AgentChapterSummary {
    chapter: string;
    volume: string;
    title: string;
    status: string;
    hasBody: boolean;
    /** 是否已写（仅 written/settled 或旧文件按体量判定）；骨架 false */
    written: boolean;
    /** 正文文件字节数 */
    size: number;
}

/**
 * 项目状态摘要。
 */
export interface AgentProjectStatus {
    project: string;
    mode: 'long' | 'short' | 'script';
    structureId: string;
    /** 章节条目总数（已写 + 骨架） */
    totalChapters: number;
    /** 规划章数（条目总数与最大章号取较大值） */
    plannedChapters: number;
    /** 已写章节数 */
    writtenChapters: number;
    /** 待写骨架数 */
    skeletonChapters: number;
    /** status -> 数量（pending/written/settled） */
    byStatus: Record<string, number>;
    /** 最后一章已写章节名；无已写时为 '' */
    latestWrittenChapter: string;
    /** 建议续写的章名（最新已写 + 1） */
    nextChapterToWrite: string;
}

/**
 * 命令摘要。
 */
export interface AgentCommandSummary {
    id: string;
    name: string;
    group: string;
}

/** read_file 的结果（吸收 dsh context/file-reference：按需读取，不整库进上下文） */
export interface AgentFileReadResult {
    path: string;
    content: string;
    /** 本次返回的起止行（1-based） */
    startLine: number;
    endLine: number;
    /** 文件总行数 */
    totalLines: number;
    /** 是否还有未返回的内容（用 offset 继续读） */
    truncated: boolean;
    /** 文件字节数 */
    size: number;
}

/** search_vault 的一条命中 */
export interface AgentVaultSearchHit {
    path: string;
    /** 1-based 行号 */
    line: number;
    /** 该行摘要（已压空白/截断） */
    text: string;
}

/**
 * 对话引导 Agent 端口。
 */
export interface GuideAgentPort {
    createProject(params: CreateLongIntentParams): Promise<{ created: boolean; projectId: string; fileCount: number; reason?: string }>;
    createShortProject?(params: CreateShortIntentParams): Promise<{ created: boolean; projectId: string; fileCount: number; reason?: string }>;
    createScriptProject?(params: CreateScriptIntentParams): Promise<{ created: boolean; projectId: string; fileCount: number; reason?: string }>;
    openWizard(project: string): Promise<boolean>;
    /** 打开「创作流程」页（三模式通用）；非长篇没有初始化向导时用它 */
    openFlow?(project?: string): boolean | Promise<boolean>;
    openStorySettings(project: string): boolean;
    /**
     * 打开工作台；传 project 时定位到该项目的第一个未写章节（返回值可异步）
     *
     * @param project - 项目（路径或对象）
      * @returns 结果
     */
    openFullWriter(project?: string): boolean | Promise<boolean>;
    openPreResearch(mode: 'short' | 'script', project?: string): boolean;
    /** 可选：用 AI 把自然语言解析成槽位；失败/未提供时回退到 chips 匹配 */
    aiParse?(text: string, ctx: AgentContext, missing: string[]): Promise<Partial<AgentSlots> | null>;
    // ─── 工作台扩展（创作工作台 / Harness 工具使用；规则引擎可忽略）───
    /** 打开句级协同写作（有活动章节时） */
    openCoWriting?(): boolean;
    /** 列出项目章节与状态 */
    listChapters?(project: string): Promise<AgentChapterSummary[]>;
    /** 在工作台打开指定章节 */
    openChapter?(project: string, chapterName: string): boolean;
    /** 项目状态摘要（模式/结构/章节统计/最新章） */
    getProjectStatus?(project: string): Promise<AgentProjectStatus | null>;
    /** 执行任意插件命令（命令面板全集）；长流程命令可返回 Promise（Agent 可等待派发结果） */
    runCommand?(commandId: string): boolean | Promise<boolean>;
    /**
     * 高成本/破坏性命令的用户确认（吸收 dsh user-approval）。
     * 未提供时，这类命令会被直接拒绝，而不是静默执行。
     */
    confirmDangerousAction?(request: { title: string; detail: string }): Promise<boolean>;
    /** 可用命令清单（按分组） */
    listCommands?(): AgentCommandSummary[];
    // ─── 文件检索（吸收 dsh context/file-reference 与 search）───
    /** 读取库内文本文件的指定行窗口；路径校验与截断由实现负责 */
    readFile?(path: string, options?: { offset?: number; limit?: number }): Promise<AgentFileReadResult | null>;
    /** 在库内做关键词检索（只搜文本文件），返回命中的行 */
    searchVault?(query: string, options?: { limit?: number; folder?: string }): Promise<AgentVaultSearchHit[]>;
    // ─── 长流程执行登记表（v4.21）───
    /** 最近的命令执行记录（新→旧），供 Agent 汇报「刚才那次跑得怎么样」 */
    getExecutionLedger?(limit?: number): AgentCommandRunRecord[];
}

/** 长流程执行记录（services/execution-ledger 的只读投影） */
export interface AgentCommandRunRecord {
    commandId: string;
    label?: string;
    project: string;
    source: 'agent' | 'ui';
    status: 'running' | 'done' | 'failed';
    startedAt: number;
    finishedAt?: number;
    detail?: string;
    failure?: string;
    settlement?: {
        updated: number;
        created: number;
        updatedForeshadows: number;
        rejected: number;
        missingEntities: number;
        linkFieldWrites: number;
        recordedBehaviors: number;
        foreshadowLoop?: { pass: boolean; summary: string };
    };
}
