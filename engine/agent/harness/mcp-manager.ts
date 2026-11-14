/**
 * mcp-manager.ts — MCP 服务连接管理
 *
 * 负责：按配置连接启用中的服务、拉取工具、桥接成 Harness 工具、统一关闭。
 * 连接失败只记录不抛（一个服务挂了不影响其它工具与会话）。
 */

import { createLogger } from '@/shared/logger';
import type { HarnessTool } from './harness-types';
import { McpClient } from './mcp-client';
import { createStdioTransport } from './mcp-stdio-transport';
import { createHttpTransport } from './mcp-http-transport';
import { bridgeMcpServer } from './mcp-tools';
import { normalizeMcpServers, type McpServerConfig } from '@/shared/mcp-config';

const log = createLogger('McpManager');

/** 连接结果 */
export interface McpConnectResult {
    /** 桥接后的全部工具 */
    tools: HarnessTool[];
    /** 连接失败的服务（id → 原因） */
    failures: Array<{ id: string; reason: string }>;
}

/**
 * 连接所有启用的 MCP 服务并返回桥接工具。
 *
 * @param servers - 服务配置（原始，会先规范化）
 * @returns 工具与失败列表
 */
export async function connectMcpServers(servers: unknown): Promise<McpConnectResult & { clients: McpClient[] }> {
    const configs = normalizeMcpServers(servers).filter(config => config.enabled !== false);
    const tools: HarnessTool[] = [];
    const failures: Array<{ id: string; reason: string }> = [];
    const clients: McpClient[] = [];
    for (const config of configs) {
        try {
            const transport = config.transport === 'http'
                ? createHttpTransport(config)
                : createStdioTransport(config);
            const client = new McpClient(config, transport);
            await client.connect();
            await client.listTools();
            tools.push(...bridgeMcpServer(client, config));
            clients.push(client);
            log.info(`MCP 服务已连接：${config.id}（${client.getTools().length} 个工具）`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push({ id: config.id, reason });
            log.warn(`MCP 服务连接失败：${config.id}`, reason);
        }
    }
    return { tools, failures, clients };
}

/**
 * 关闭全部 MCP 客户端。
 *
 * @param clients - 客户端列表
 */
export function closeMcpClients(clients: readonly McpClient[]): void {
    for (const client of clients) {
        try {
            client.close();
        } catch {
            // silent-ok: 关闭失败不影响会话退出
        }
    }
}

/**
 * 描述连接结果（设置页/日志用）。
 *
 * @param result - 连接结果
 * @returns 文本
 */
export function describeMcpResult(result: { failures: Array<{ id: string; reason: string }>; tools: HarnessTool[] }): string {
    const ok = result.tools.length;
    const failed = result.failures.length;
    if (failed === 0) return `MCP：${ok} 个工具已就绪`;
    return `MCP：${ok} 个工具已就绪，${failed} 个服务连接失败（${result.failures.map(item => `${item.id}: ${item.reason}`).join('；')}）`;
}

/** 服务配置数组类型别名（供设置页使用） */
export type { McpServerConfig };
