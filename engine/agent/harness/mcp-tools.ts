/**
 * mcp-tools.ts — 把 MCP 工具桥接成 Harness 工具
 *
 * 命名：mcp__<serverId>__<toolName>
 * 动作分类：按服务配置的 kind（缺省 admin，安全侧），只读模式据此拦截。
 */

import type { McpToolInfo, McpClient } from './mcp-client';
import type { HarnessTool } from './harness-types';
import { mcpToolFullName, type McpServerConfig } from '@/shared/mcp-config';
import { mcpCallAttempts, recordMcpCall } from './mcp-runtime-stats';

/**
 * JSON Schema 的 properties → Harness 参数表（尽力而为，未知类型按 string）。
 *
 * @param schema - inputSchema
 * @returns 参数表与必填列表
 */
export function schemaToParameters(schema: Record<string, unknown> | undefined): {
    parameters: HarnessTool['parameters'];
    required: string[];
} {
    const properties = (schema?.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
    const parameters: HarnessTool['parameters'] = {};
    for (const [name, prop] of Object.entries(properties)) {
        const rawType = String(prop?.type ?? 'string');
        const type = rawType === 'number' || rawType === 'integer'
            ? 'number'
            : rawType === 'boolean'
                ? 'boolean'
                : rawType === 'array'
                    ? 'array'
                    : rawType === 'object'
                        ? 'object'
                        : 'string';
        parameters[name] = {
            type,
            description: String(prop?.description ?? ''),
            ...(Array.isArray(prop?.enum) ? { enum: prop.enum.map(String) } : {}),
            ...(required.includes(name) ? { required: true } : {}),
        };
    }
    return { parameters, required };
}

/**
 * 把单个 MCP 工具桥接成 Harness 工具。
 *
 * @param client - 已连接的 MCP 客户端
 * @param config - 服务配置
 * @param info - MCP 工具信息
 * @returns Harness 工具
 */
export function bridgeMcpTool(client: McpClient, config: McpServerConfig, info: McpToolInfo): HarnessTool {
    const { parameters, required } = schemaToParameters(info.inputSchema);
    return {
        name: mcpToolFullName(config.id, info.name),
        kind: config.kind ?? 'admin',
        description: `[MCP:${config.name}] ${String(info.description || info.name).slice(0, 500)}`,
        parameters,
        required,
        sideEffect: 'write',
        timeoutMs: 30_000,
        execute: async (args) => {
            const attempts = mcpCallAttempts(config.kind);
            let lastError = '';
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
                try {
                    const result = await client.callTool(info.name, args);
                    if (result.ok) {
                        recordMcpCall(config.id, true);
                        return { ok: true, content: result.content };
                    }
                    lastError = result.content;
                } catch (error) {
                    lastError = error instanceof Error ? error.message : String(error);
                }
                // 只读工具失败重试一次；写类不重试，避免重复写入
                if (attempt < attempts) await new Promise(resolve => window.setTimeout(resolve, 250));
            }
            recordMcpCall(config.id, false, lastError);
            return { ok: false, content: lastError || '（MCP 工具调用失败）' };
        },
    };
}

/**
 * 把一个服务的全部工具桥接成 Harness 工具。
 *
 * @param client - MCP 客户端
 * @param config - 服务配置
 * @returns 工具数组
 */
export function bridgeMcpServer(client: McpClient, config: McpServerConfig): HarnessTool[] {
    return client.getTools().map(info => bridgeMcpTool(client, config, info));
}
