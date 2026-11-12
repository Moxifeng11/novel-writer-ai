/**
 * repair-telemetry.ts — 修复动作的会话遥测（纯逻辑，阶段 E 深化③）
 *
 * 背景：`repair_flow` 修过什么此前只留在会话日志的单条 tool_result 里，
 * 监控面板只看得到「最近工具调用」的一行摘要——用户与 agent 都无法回答
 * 「本会话一共修了几次、成没成、最近修的是哪条链路」。
 *
 * 本模块把「从工具结果提取修复记录」与「汇总成可读状态」抽成纯函数：
 * - 引擎在回合结束时调用 `recordRepairFromToolCall` 累积到 telemetry.repairs；
 * - 监控面板调用 `summarizeRepairs` 渲染一行状态；
 * - 两者共用同一套提取规则（action 来自 `data.action`，缺 action 不记）。
 *
 * 约定：不 import obsidian、不碰 DOM；时间由调用方注入（可测）。
 */

/** repair_flow 的工具名（与 repair-tools.ts 的 REPAIR_FLOW_TOOL 一致；此处避免反向依赖） */
export const REPAIR_TOOL_NAME = 'repair_flow';

/** 单条修复记录 */
export interface RepairTelemetryEntry {
    /** 修复动作（revectorize_book / cleanup_orphan_vectors …） */
    action: string;
    ok: boolean;
    /** 结果摘要（工具 content 的首行，已截断） */
    summary: string;
    /** 记录时刻（ms） */
    at: number;
}

/** 修复遥测汇总（监控面板一行展示用） */
export interface RepairTelemetrySummary {
    attempts: number;
    ok: number;
    failed: number;
    /** 最近一次修复的可读描述；无记录返回 null */
    latest: string | null;
}

/** 修复记录上限（与 lastToolCalls 的 12 条同量级，避免会话无限增长） */
export const MAX_REPAIR_ENTRIES = 12;

/** 工具结果里抽取 action 的最小形状（与 HarnessToolResult.data 兼容） */
export interface RepairToolCallLike {
    tool: string;
    ok: boolean;
    /** 参数摘要（summarizeToolArgs）；没有 resultSummary 时退回它 */
    summary: string;
    /** 工具结果首行（优先用于「修成了什么」） */
    resultSummary?: string;
    data?: Record<string, unknown>;
}

/**
 * 从一条工具调用结果中提取修复记录。
 *
 * 只认 `repair_flow` 且 `data.action` 为非空字符串的调用——诊断/其它工具的
 * 结果不进修复遥测（否则「修过什么」会被读操作污染）。
 *
 * @param call - 工具调用结果
 * @param at - 记录时刻（默认 Date.now()）
 * @returns 修复记录；不属于修复调用时返回 null
 */
export function toRepairEntry(call: RepairToolCallLike, at: number = Date.now()): RepairTelemetryEntry | null {
    if (!call || call.tool !== REPAIR_TOOL_NAME) return null;
    const action = typeof call.data?.action === 'string' ? call.data.action.trim() : '';
    if (!action) return null;
    // 优先用结果首行（「已清理 1 本孤儿向量」），没有则退回参数摘要
    const firstLine = String(call.resultSummary || call.summary || '').split('\n')[0].trim();
    return {
        action,
        ok: call.ok === true,
        summary: firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine,
        at,
    };
}

/**
 * 把一条工具调用结果记入修复遥测（原地追加到队首，超上限截断）。
 *
 * @param repairs - 遥测里的修复列表（会被原地修改）
 * @param call - 工具调用结果
 * @param at - 记录时刻
 * @returns 是否记入
 */
export function recordRepairFromToolCall(
    repairs: RepairTelemetryEntry[],
    call: RepairToolCallLike,
    at: number = Date.now(),
): boolean {
    const entry = toRepairEntry(call, at);
    if (!entry) return false;
    repairs.unshift(entry);
    if (repairs.length > MAX_REPAIR_ENTRIES) repairs.length = MAX_REPAIR_ENTRIES;
    return true;
}

/** 修复动作的中文短语（监控面板与 agent 复述共用） */
export const REPAIR_ACTION_LABELS: Record<string, string> = {
    revectorize_book: '重算单本向量',
    reload_fingerprints: '重载指纹库',
    cleanup_orphan_vectors: '清理孤儿向量',
    fix_zero_intensity: '恢复指纹强度',
    cleanup_disk_vectors: '清理磁盘向量残留',
    rerun_canon_research: '重跑考据',
};

/**
 * 动作名 → 中文短语（未知动作原样返回，不静默丢弃）。
 *
 * @param action - 动作名
 * @returns 中文短语
 */
export function resolveRepairActionLabel(action: string): string {
    return REPAIR_ACTION_LABELS[action] || action;
}

/**
 * 汇总修复遥测：次数、成败、最近一条的可读描述。
 *
 * @param repairs - 修复列表（新→旧）
 * @returns 汇总（无记录时 attempts=0、latest=null）
 */
export function summarizeRepairs(repairs: readonly RepairTelemetryEntry[]): RepairTelemetrySummary {
    if (!repairs || repairs.length === 0) {
        return { attempts: 0, ok: 0, failed: 0, latest: null };
    }
    let ok = 0;
    for (const entry of repairs) {
        if (entry.ok) ok++;
    }
    const latestEntry = repairs[0];
    const verdict = latestEntry.ok ? '成功' : '失败';
    return {
        attempts: repairs.length,
        ok,
        failed: repairs.length - ok,
        latest: `${resolveRepairActionLabel(latestEntry.action)}·${verdict}`,
    };
}
