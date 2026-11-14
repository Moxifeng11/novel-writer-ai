/**
 * MCP 桥接与配置单测
 */

import { describe, expect, it, vi } from 'vitest';
import {
    describeMcpServer,
    isMcpServerId,
    mcpToolFullName,
    normalizeMcpServer,
    normalizeMcpServers,
} from '@/shared/mcp-config';
import { bridgeMcpServer, bridgeMcpTool, schemaToParameters } from '@/engine/agent/harness/mcp-tools';
import { connectMcpServers, describeMcpResult } from '@/engine/agent/harness/mcp-manager';
import { extractJsonRpcResult, jsonRpcRequest, McpClient, McpError, type McpTransport } from '@/engine/agent/harness/mcp-client';

/** 假传输：按顺序返回预设响应。 */
function fakeTransport(responses: unknown[]): McpTransport & { sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        sent,
        start: async () => undefined,
        request: async (payload) => {
            sent.push(payload);
            return responses.shift() ?? { jsonrpc: '2.0', id: 0, result: {} };
        },
        close: () => undefined,
    };
}

const server = {
    id: 'demo',
    name: '示例服务',
    transport: 'stdio' as const,
    command: 'node',
    args: ['server.js'],
    kind: 'read' as const,
};

describe('MCP 配置', () => {
    it('合法 id 校验', () => {
        expect(isMcpServerId('demo_1')).toBe(true);
        expect(isMcpServerId('demo 1')).toBe(false);
        expect(isMcpServerId('')).toBe(false);
    });

    it('stdio 配置规范化', () => {
        expect(normalizeMcpServer({ id: 'a', command: 'node', args: ['x.js'] }))
            .toMatchObject({ id: 'a', transport: 'stdio', command: 'node', args: ['x.js'], kind: 'admin', enabled: true });
    });

    it('http 配置规范化要求 http(s)', () => {
        expect(normalizeMcpServer({ id: 'a', transport: 'http', url: 'http://localhost:8080/mcp' })).not.toBeNull();
        expect(normalizeMcpServer({ id: 'a', transport: 'http', url: 'ftp://x' })).toBeNull();
    });

    it('缺 command 的 stdio 被拒绝', () => {
        expect(normalizeMcpServer({ id: 'a' })).toBeNull();
    });

    it('列表去重并丢弃非法项', () => {
        const list = normalizeMcpServers([
            { id: 'a', command: 'node' },
            { id: 'a', command: 'node2' },
            { id: 'bad id', command: 'node' },
            null,
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('a');
    });

    it('工具名带服务前缀并清洗非法字符', () => {
        expect(mcpToolFullName('demo', 'read/thing')).toBe('mcp__demo__read_thing');
    });

    it('描述文本含传输与目标', () => {
        expect(describeMcpServer(server)).toContain('stdio');
        expect(describeMcpServer(server)).toContain('server.js');
    });
});

describe('MCP 客户端', () => {
    it('握手 + 拉取工具', async () => {
        const transport = fakeTransport([
            { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } },
            { jsonrpc: '2.0', result: null },
            { jsonrpc: '2.0', id: 3, result: { tools: [{ name: 'ping', description: 'p' }] } },
        ]);
        const client = new McpClient(server, transport);
        await client.connect();
        const tools = await client.listTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('ping');
    });

    it('调用工具拼接文本内容', async () => {
        const transport = fakeTransport([
            { jsonrpc: '2.0', id: 1, result: {} },
            { jsonrpc: '2.0', result: null },
            { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'pong' }] } },
        ]);
        const client = new McpClient(server, transport);
        await client.connect();
        const result = await client.callTool('ping', {});
        expect(result.ok).toBe(true);
        expect(result.content).toBe('pong');
    });

    it('错误响应抛 McpError', async () => {
        const transport = fakeTransport([{ jsonrpc: '2.0', id: 1, error: { message: 'boom' } }]);
        const client = new McpClient(server, transport);
        await expect(client.connect()).rejects.toThrow('boom');
    });

    it('jsonRpcRequest/extractJsonRpcResult 结构正确', () => {
        expect(jsonRpcRequest(7, 'tools/list', {})).toMatchObject({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
        expect(extractJsonRpcResult({ jsonrpc: '2.0', id: 1, result: { ok: 1 } })).toEqual({ ok: 1 });
        expect(() => extractJsonRpcResult({ error: { message: 'x' } })).toThrow(McpError);
    });
});

describe('MCP 工具桥接', () => {
    it('inputSchema → 参数表', () => {
        const { parameters, required } = schemaToParameters({
            type: 'object',
            properties: {
                query: { type: 'string', description: '查询词' },
                limit: { type: 'integer', description: '条数' },
                mode: { type: 'string', enum: ['a', 'b'] },
            },
            required: ['query'],
        });
        expect(parameters.query.type).toBe('string');
        expect(parameters.limit.type).toBe('number');
        expect(parameters.mode.enum).toEqual(['a', 'b']);
        expect(required).toEqual(['query']);
    });

    it('桥接工具用服务 kind 与 mcp 前缀', () => {
        const transport = fakeTransport([]);
        const client = new McpClient(server, transport);
        const tool = bridgeMcpTool(client, server, { name: 'ping', description: 'p', inputSchema: { properties: {} } });
        expect(tool.name).toBe('mcp__demo__ping');
        expect(tool.kind).toBe('read');
        expect(tool.sideEffect).toBe('write');
    });

    it('bridgeMcpServer 桥接全部工具', () => {
        const transport = fakeTransport([]);
        const client = new McpClient(server, transport);
        // 直接注入工具列表
        (client as unknown as { tools: Array<{ name: string; description: string }> }).tools = [
            { name: 'a', description: 'A' },
            { name: 'b', description: 'B' },
        ];
        expect(bridgeMcpServer(client, server)).toHaveLength(2);
    });

    it('执行工具时透传调用结果', async () => {
        const transport = fakeTransport([
            { jsonrpc: '2.0', id: 1, result: {} },
            { jsonrpc: '2.0', result: null },
            { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'ok!' }] } },
        ]);
        const client = new McpClient(server, transport);
        await client.connect();
        const tool = bridgeMcpTool(client, server, { name: 'ping', description: 'p' });
        const result = await tool.execute({}, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toBe('ok!');
    });
});

describe('MCP 连接管理', () => {
    it('未配置任何服务时返回空工具', async () => {
        const result = await connectMcpServers([]);
        expect(result.tools).toHaveLength(0);
        expect(result.failures).toHaveLength(0);
    });

    it('服务不可用时记录失败但不抛', async () => {
        const result = await connectMcpServers([
            { id: 'bad', command: 'definitely-not-a-command-xyz', args: [] },
        ]);
        expect(result.tools).toHaveLength(0);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].id).toBe('bad');
    });

    it('describeMcpResult 汇总成功/失败', () => {
        expect(describeMcpResult({ tools: [{ name: 'a' } as never], failures: [] })).toContain('1 个工具');
        expect(describeMcpResult({
            tools: [],
            failures: [{ id: 'x', reason: '连接超时' }],
        })).toContain('x: 连接超时');
    });
});
