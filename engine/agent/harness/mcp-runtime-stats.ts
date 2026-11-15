/**
 * mcp-runtime-stats.ts — MCP 会话运行时统计（调用可见化）
 *
 * 背景：MCP 二期要回答两个问题——「这次会话调了哪些 MCP 工具？失败了几次？」
 * 以及「只读工具失败要不要自动重试」。统计与重试判定放在这里，
 * 供 `mcp-tools`（执行侧）与「MCP 管理中心」（展示侧）共用。
 */

/** 单个服务的会话统计 */
export interface McpServerRuntimeStats {
    /** 调用次数（含失败与重试） */
    calls: number;
    /** 失败次数（最终失败） */
    failures: number;
    /** 最近一次错误 */
    lastError?: string;
    /** 最近一次调用时间（毫秒时间戳） */
    lastAt?: number;
}

/** 服务 id → 统计 */
const stats = new Map<string, McpServerRuntimeStats>();

/**
 * 记录一次工具调用结果。
 *
 * @param serverId - 服务 id
 * @param ok - 是否成功
 * @param error - 失败原因（成功时忽略）
 * @param now - 时间戳（测试注入）
 * @example
 * ```ts
 * recordMcpCall('nw-example', false, '连接超时');
 * getMcpServerStats('nw-example').failures; // 1
 * ```
 */
export function recordMcpCall(serverId: string, ok: boolean, error?: string, now = Date.now()): void {
    const id = String(serverId ?? '').trim();
    if (!id) return;
    const current = stats.get(id) ?? { calls: 0, failures: 0 };
    current.calls += 1;
    if (!ok) {
        current.failures += 1;
        current.lastError = String(error ?? '未知错误').slice(0, 300);
    }
    current.lastAt = now;
    stats.set(id, current);
}

/**
 * 读取单个服务统计（无记录返回零值）。
 *
 * @param serverId - 服务 id
 * @returns 统计
 * @example
 * ```ts
 * getMcpServerStats('unknown'); // { calls: 0, failures: 0 }
 * ```
 */
export function getMcpServerStats(serverId: string): McpServerRuntimeStats {
    return { ...(stats.get(String(serverId ?? '').trim()) ?? { calls: 0, failures: 0 }) };
}

/**
 * 全部服务统计快照。
 *
 * @returns 服务 id → 统计
 * @example
 * ```ts
 * listMcpServerStats(); // { 'nw-example': { calls: 2, failures: 0 } }
 * ```
 */
export function listMcpServerStats(): Record<string, McpServerRuntimeStats> {
    const out: Record<string, McpServerRuntimeStats> = {};
    for (const [id, value] of stats) out[id] = { ...value };
    return out;
}

/**
 * 清空统计（会话重启/用户手动清除）。
 *
 * @example
 * ```ts
 * resetMcpServerStats();
 * ```
 */
export function resetMcpServerStats(): void {
    stats.clear();
}

/**
 * 工具调用失败后是否重试一次。
 *
 * 规则：只读（`read`）工具重试一次是安全的；写类（write-setting/write-prose/admin）
 * 重试可能重复写入，**不重试**（交给用户重试或 Agent 决策）。
 *
 * @param kind - 服务动作分类
 * @returns 需要重试返回 true
 * @example
 * ```ts
 * shouldRetryMcpCall('read');   // true
 * shouldRetryMcpCall('admin');  // false
 * ```
 */
export function shouldRetryMcpCall(kind: string | undefined): boolean {
    return kind === 'read';
}

/**
 * 单次工具调用最多尝试次数。
 *
 * @param kind - 服务动作分类
 * @returns 尝试次数（只读 2，其余 1）
 * @example
 * ```ts
 * mcpCallAttempts('read'); // 2
 * ```
 */
export function mcpCallAttempts(kind: string | undefined): number {
    return shouldRetryMcpCall(kind) ? 2 : 1;
}
