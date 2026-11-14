/**
 * mcp-config.ts — MCP 服务配置模型（纯函数）
 *
 * 支持两种传输：
 * - stdio：本地子进程（command + args + env），功能最全，仅桌面端
 * - http：远程端点（url），无需子进程
 */

/** MCP 传输类型 */
export type McpTransportKind = 'stdio' | 'http';

/** MCP 服务配置 */
export interface McpServerConfig {
    /** 唯一 id（工具名前缀用，仅允许字母数字下划线短横线） */
    id: string;
    /** 显示名 */
    name: string;
    /** 传输类型 */
    transport: McpTransportKind;
    /** stdio：可执行命令（如 node / npx / python） */
    command?: string;
    /** stdio：命令参数 */
    args?: string[];
    /** stdio：额外环境变量 */
    env?: Record<string, string>;
    /** http：端点地址 */
    url?: string;
    /** 该服务工具的默认动作分类（缺省 admin，安全侧） */
    kind?: 'read' | 'write-setting' | 'write-prose' | 'admin';
    /** 是否启用 */
    enabled?: boolean;
}

/** 单个 MCP 工具调用超时（毫秒） */
export const MCP_TOOL_TIMEOUT_MS = 30_000;

/** 初始化超时（毫秒） */
export const MCP_INIT_TIMEOUT_MS = 20_000;

/**
 * id 是否合法（工具名前缀会用到，不能有空格/点）。
 *
 * @param id - 待检查 id
 * @returns 合法返回 true
 */
export function isMcpServerId(id: string): boolean {
    return /^[A-Za-z0-9_-]{1,32}$/.test(String(id || '').trim());
}

/**
 * 规范化单个服务配置；非法返回 null。
 *
 * @param raw - 原始配置
 * @returns 配置或 null
 */
export function normalizeMcpServer(raw: unknown): McpServerConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const input = raw as Partial<McpServerConfig>;
    const id = String(input.id ?? '').trim();
    if (!isMcpServerId(id)) return null;
    const transport: McpTransportKind = input.transport === 'http' ? 'http' : 'stdio';
    const name = String(input.name ?? '').trim() || id;
    if (transport === 'stdio') {
        const command = String(input.command ?? '').trim();
        if (!command) return null;
        return {
            id,
            name,
            transport,
            command,
            args: Array.isArray(input.args) ? input.args.map(String) : [],
            env: input.env && typeof input.env === 'object' ? { ...input.env } : undefined,
            kind: input.kind ?? 'admin',
            enabled: input.enabled !== false,
        };
    }
    const url = String(input.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return { id, name, transport, url, kind: input.kind ?? 'admin', enabled: input.enabled !== false };
}

/**
 * 规范化服务列表；丢弃非法项并去重（同 id 保留第一个）。
 *
 * @param raw - 原始列表
 * @returns 规范化列表
 */
export function normalizeMcpServers(raw: unknown): McpServerConfig[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const list: McpServerConfig[] = [];
    for (const item of raw) {
        const config = normalizeMcpServer(item);
        if (!config || seen.has(config.id)) continue;
        seen.add(config.id);
        list.push(config);
    }
    return list;
}

/**
 * MCP 工具名 → Harness 工具名（`mcp__<server>__<tool>`）。
 *
 * @param serverId - 服务 id
 * @param toolName - MCP 原始工具名
 * @returns 桥接后的工具名
 */
export function mcpToolFullName(serverId: string, toolName: string): string {
    const sanitized = String(toolName || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
    return `mcp__${serverId}__${sanitized}`;
}

/**
 * 描述一个服务（设置页/工具清单展示用）。
 *
 * @param config - 服务配置
 * @returns 文本
 */
export function describeMcpServer(config: McpServerConfig): string {
    const target = config.transport === 'stdio'
        ? `${config.command} ${(config.args ?? []).join(' ')}`.trim()
        : String(config.url ?? '');
    return `${config.name}（${config.transport}）· ${target}`;
}
