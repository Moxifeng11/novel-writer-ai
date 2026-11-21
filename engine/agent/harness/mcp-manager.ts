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
import { normalizeMcpServer, normalizeMcpServers, type McpServerConfig } from '@/shared/mcp-config';

const log = createLogger('McpManager');

/** 连接结果 */
export interface McpConnectResult {
    /** 桥接后的全部工具 */
    tools: HarnessTool[];
    /** 连接失败的服务（id → 原因；attempts=已尝试次数） */
    failures: Array<{ id: string; reason: string; attempts?: number }>;
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
    const failures: Array<{ id: string; reason: string; attempts?: number }> = [];
    const clients: McpClient[] = [];
    for (const config of configs) {
        // 连接失败重试一次（进程冷启动/端点刚起来时常见；不重试会误报「服务不可用」）
        const maxAttempts = 2;
        let lastReason = '';
        let connected = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            let client: McpClient | null = null;
            try {
                const transport = config.transport === 'http'
                    ? createHttpTransport(config)
                    : createStdioTransport(config);
                client = new McpClient(config, transport);
                await client.connect();
                await client.listTools();
                tools.push(...bridgeMcpServer(client, config));
                clients.push(client);
                log.info(`MCP 服务已连接：${config.id}（${client.getTools().length} 个工具，第 ${attempt} 次尝试）`);
                connected = true;
                break;
            } catch (error) {
                lastReason = error instanceof Error ? error.message : String(error);
                try {
                    client?.close();
                } catch { // silent-ok: 重试前关闭失败不影响下一次尝试
                }
                if (attempt < maxAttempts) {
                    log.warn(`MCP 服务连接失败，重试中：${config.id}`, lastReason);
                    await new Promise(resolve => window.setTimeout(resolve, 300));
                }
            }
        }
        if (!connected) {
            failures.push({ id: config.id, reason: lastReason, attempts: maxAttempts });
            log.warn(`MCP 服务连接失败：${config.id}`, lastReason);
        }
    }
    return { tools, failures, clients };
}

/** 探测结果 */
export interface McpProbeResult {
    ok: boolean;
    /** 工具清单（连接成功时） */
    tools: Array<{ name: string; description: string }>;
    /** 失败原因（连接失败时） */
    error?: string;
    /** 耗时（毫秒） */
    durationMs: number;
}

/**
 * 探测单个 MCP 服务：连接 → 拉工具清单 → 关闭。
 *
 * 设置页「测试连接」用；不抛错，失败原因放在返回值里（含子进程报错文本）。
 *
 * @param raw - 服务配置（会先规范化）
 * @returns 探测结果
 */
export async function probeMcpServer(raw: unknown): Promise<McpProbeResult> {
    const startedAt = Date.now();
    const config = normalizeMcpServer(raw);
    if (!config) {
        return { ok: false, tools: [], error: '配置不完整（stdio 需要命令；http 需要 http(s) URL）', durationMs: 0 };
    }
    let client: McpClient | null = null;
    try {
        const transport = config.transport === 'http'
            ? createHttpTransport(config)
            : createStdioTransport(config);
        client = new McpClient(config, transport);
        await client.connect();
        await client.listTools();
        const tools = client.getTools().map(tool => ({
            name: tool.name,
            description: String(tool.description ?? ''),
        }));
        return { ok: true, tools, durationMs: Date.now() - startedAt };
    } catch (error) {
        return {
            ok: false,
            tools: [],
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
        };
    } finally {
        try {
            client?.close();
        } catch { // silent-ok: 探测结束关闭失败不影响结果
        }
    }
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
