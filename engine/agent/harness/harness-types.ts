/**
 * harness-types.ts — 对话 Agent Harness 的类型层
 *
 * 架构移植自 DeepSeek Harness（everything-is-a-plugin / agent loop）的核心思想：
 *   - Session Log：append-only 事件日志是模型上下文的唯一事实源；
 *   - Tool Registry：受守卫的工具注册表，模型通过工具调用宿主能力；
 *   - Agent Loop：「调用模型 → 执行工具 → 回填结果 → 再调用模型」，直到产出最终回复；
 *   - System Prompt：按序分段组装（身份 / 工具目录 / 记忆 / 上下文 / 策略 / 协议）。
 *
 * 本模块只放类型；引擎不依赖 Obsidian，宿主能力全部通过端口与适配器注入。
 */

// ============================================================
// 会话事件（dsh session log 的精简移植）
// ============================================================

/**
 * 事件元数据（dsh：日志即事实源，事件要可排序、可审计）。
 * ts 为写入时刻；seq 为会话内单调序号，旧存档没有时由恢复逻辑补齐。
 */
export interface HarnessEventMeta {
    readonly ts?: number;
    readonly seq?: number;
}

/**
 * Agent 会话事件联合类型。
 */
export type AgentSessionEvent =
    | ({ readonly type: 'system_message'; readonly text: string } & HarnessEventMeta)
    | ({ readonly type: 'user_message'; readonly text: string } & HarnessEventMeta)
    /** 系统/守卫注入的上下文（进转写、按 user 角色呈现；dsh 的 context message） */
    | ({ readonly type: 'context_message'; readonly text: string } & HarnessEventMeta)
    | ({ readonly type: 'assistant_message'; readonly text: string } & HarnessEventMeta)
    /** 压缩摘要：独立事件类型，不再伪装成 user_message 靠前缀识别 */
    | ({ readonly type: 'summary'; readonly text: string } & HarnessEventMeta)
    | ({ readonly type: 'tool_call'; readonly callId: string; readonly tool: string; readonly args: Record<string, unknown> } & HarnessEventMeta)
    | ({
        readonly type: 'tool_result';
        readonly callId: string;
        readonly tool: string;
        readonly ok: boolean;
        readonly content: string;
        /** 工具产出的结构化结果（给 UI/后续步骤用，不写进模型转写） */
        readonly data?: Record<string, unknown>;
        /** 执行耗时（毫秒） */
        readonly durationMs?: number;
    } & HarnessEventMeta)
    | ({ readonly type: 'turn_marker'; readonly marker: 'turn_start' | 'turn_end' } & HarnessEventMeta);

/** 从日志推导模型可见的对话转写（dsh deriveMessages 的移植） */
export interface DerivedTurn {
    role: 'user' | 'assistant' | 'tool';
    text: string;
}

// ============================================================
// 工具（dsh ToolDefinition 的精简移植：schema + 受守卫执行）
// ============================================================

/**
 * 工具参数定义。
 */
export interface HarnessToolParameter {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    enum?: string[];
    /** array 类型时元素类型（可选，声明后会被校验） */
    items?: 'string' | 'number' | 'boolean';
    /** 缺省时工具自行决定（如从记忆回填） */
    required?: boolean;
}

/**
 * 工具执行结果。
 */
export interface HarnessToolResult {
    ok: boolean;
    /** 给模型看的文本结果（会写回会话日志） */
    content: string;
    /** 给 UI 看的结构化数据（可选） */
    data?: Record<string, unknown>;
}

/**
 * 工具执行上下文。
 */
export interface HarnessToolContext {
    /** 当前记忆状态（含 slots；只读快照） */
    memory: { slots: Readonly<Record<string, unknown>> };
    /** 创作计划状态（update_plan 工具读写） */
    plan?: { steps: Array<{ step: string; status: string }> };
    /** 中止信号（用户关闭弹窗/取消） */
    signal?: AbortSignal;
    /** 本回合该工具已通过宿主审批（避免工具内部二次弹窗） */
    approvalGranted?: boolean;
}

/** 工具审批请求（dsh approval 的移植：缺省即拒绝） */
export interface HarnessApprovalRequest {
    tool: string;
    args: Record<string, unknown>;
    sideEffect: 'write' | 'dangerous';
    reason: string;
}

/**
 * Harness 工具定义。
 */
export interface HarnessTool {
    name: string;
    description: string;
    parameters: Record<string, HarnessToolParameter>;
    /** 必填参数名列表 */
    required: string[];
    /**
     * 副作用等级（dsh tool metadata 的移植）：
     * - none：只读/本地状态查询，重复调用允许（超阈值只提醒）；
     * - write：会创建/修改宿主数据，重复调用直接拦截；
     * - dangerous：高成本或难以撤销（批量生成/结算/导出/删除），需用户确认。
     */
    sideEffect?: 'none' | 'write' | 'dangerous';
    /** 单次执行预算（毫秒）；超时返回结构化失败而不是让回合挂死 */
    timeoutMs?: number;
    execute(args: Record<string, unknown>, ctx: HarnessToolContext): Promise<HarnessToolResult>;
}

// ============================================================
// 模型适配器（dsh LLM adapter seam 的移植）
// ============================================================

/**
 * 模型适配器请求。
 */
export interface HarnessAdapterRequest {
    system: string;
    turns: DerivedTurn[];
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
}

/**
 * 助手回合输出。
 */
export interface HarnessAssistantTurn {
    /** 给用户看的回复文本（raw 缺失时的兜底来源） */
    reply?: string;
    /** 模型请求执行的工具调用（无则视为最终回复） */
    tool?: { name: string; args: Record<string, unknown> };
    /** 模型建议的选项按钮 */
    chips?: Array<{ label: string; value: string; description?: string }>;
    /** 原始文本（日志/调试用；协议解析的事实来源） */
    raw?: string;
    /** 模型返回的用量（provider 支持时用于成本遥测） */
    usage?: { prompt?: number; completion?: number; total?: number };
}

/**
 * 模型适配器接口。
 */
export interface HarnessAdapter {
    /**
     * 返回 null 表示适配失败（网络/凭据/解析全部失败），由 loop 决定降级
     *
     * @param request - 请求
      * @returns HarnessAssistantTurn 或 null
     */
    complete(request: HarnessAdapterRequest): Promise<HarnessAssistantTurn | null>;
}

// ============================================================
// 记忆（dsh memory 的移植：槽位 + update_memory 工具）
// ============================================================

/**
 * Harness 记忆状态。
 */
export interface HarnessMemoryState {
    slots: Record<string, unknown>;
}

// ============================================================
// 回合结果（与既有 AgentTurnResult 对齐的对外表面）
// ============================================================

/**
 * 选择卡（用户可选项）。
 */
export interface HarnessChip {
    label: string;
    value: string;
    description?: string;
    bestFor?: string;
    risk?: string;
    preview?: string;
}

/**
 * 回合结果（文本/工具/状态）。
 */
export interface HarnessTurnOutcome {
    messages: Array<{ role: 'agent' | 'system'; text: string; chips?: HarnessChip[] }>;
    chips: HarnessChip[];
    done: boolean;
    /** 本次回合是否调用了 AI（遥测/降级判断用） */
    usedAi: boolean;
    /** 适配器连续失败，建议宿主降级到规则引擎 */
    degraded: boolean;
    /** 执行过的工具调用摘要（UI 展示） */
    toolCalls: Array<{ tool: string; ok: boolean; summary: string }>;
}
