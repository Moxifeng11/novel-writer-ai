/**
 * MCP 二期：会话调用统计 + 失败重试策略 + 桥接层行为
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
    getMcpServerStats,
    listMcpServerStats,
    mcpCallAttempts,
    recordMcpCall,
    resetMcpServerStats,
    shouldRetryMcpCall,
} from '@/engine/agent/harness/mcp-runtime-stats';
import { bridgeMcpTool } from '@/engine/agent/harness/mcp-tools';
import type { McpClient, McpToolInfo } from '@/engine/agent/harness/mcp-client';
import type { McpServerConfig } from '@/shared/mcp-config';

afterEach(() => resetMcpServerStats());

const toolInfo: McpToolInfo = {
    name: 'echo',
    description: '回显',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

const config = (kind: McpServerConfig['kind']): McpServerConfig => ({
    id: 'demo', name: 'demo', transport: 'stdio', command: 'node', args: [], kind, enabled: true,
});

/** 假客户端：按队列返回结果（true=成功） */
const fakeClient = (queue: Array<boolean>): { client: McpClient; calls: () => number } => {
    let index = 0;
    const client = {
        callTool: async () => {
            const ok = queue[Math.min(index, queue.length - 1)];
            index += 1;
            return { ok, content: ok ? 'ok' : 'boom' };
        },
    } as unknown as McpClient;
    return { client, calls: () => index };
};

describe('重试策略', () => {
    it('只读工具重试一次，写类不重试', () => {
        expect(shouldRetryMcpCall('read')).toBe(true);
        expect(mcpCallAttempts('read')).toBe(2);
        expect(shouldRetryMcpCall('admin')).toBe(false);
        expect(mcpCallAttempts('admin')).toBe(1);
        expect(mcpCallAttempts(undefined)).toBe(1);
    });
});

describe('会话调用统计', () => {
    it('累加调用/失败并记录最近错误', () => {
        recordMcpCall('a', true, undefined, 1000);
        recordMcpCall('a', false, '超时', 2000);
        const stats = getMcpServerStats('a');
        expect(stats.calls).toBe(2);
        expect(stats.failures).toBe(1);
        expect(stats.lastError).toBe('超时');
        expect(stats.lastAt).toBe(2000);
    });

    it('未知服务返回零值；list/reset 生效', () => {
        expect(getMcpServerStats('nope')).toEqual({ calls: 0, failures: 0 });
        recordMcpCall('a', true, undefined, 1);
        recordMcpCall('b', true, undefined, 2);
        expect(Object.keys(listMcpServerStats()).sort()).toEqual(['a', 'b']);
        resetMcpServerStats();
        expect(listMcpServerStats()).toEqual({});
    });

    it('空 id 不记录', () => {
        recordMcpCall('', true);
        expect(listMcpServerStats()).toEqual({});
    });
});

describe('bridgeMcpTool 执行行为', () => {
    it('只读工具首次失败后自动重试并成功（统计 calls=2/failures=0）', async () => {
        const fake = fakeClient([false, true]);
        const tool = bridgeMcpTool(fake.client, config('read'), toolInfo);
        const result = await tool.execute({ text: 'hi' }, {} as never);
        expect(result.ok).toBe(true);
        expect(fake.calls()).toBe(2);
        expect(getMcpServerStats('demo')).toMatchObject({ calls: 1, failures: 0 });
    });

    it('写类工具失败不重试（防重复写入），统计记失败', async () => {
        const fake = fakeClient([false]);
        const tool = bridgeMcpTool(fake.client, config('admin'), toolInfo);
        const result = await tool.execute({ text: 'hi' }, {} as never);
        expect(result.ok).toBe(false);
        expect(fake.calls()).toBe(1);
        expect(getMcpServerStats('demo')).toMatchObject({ calls: 1, failures: 1 });
    });

    it('工具名带服务前缀，参数表从 schema 转换', () => {
        const fake = fakeClient([true]);
        const tool = bridgeMcpTool(fake.client, config('read'), toolInfo);
        expect(tool.name).toBe('mcp__demo__echo');
        expect(tool.parameters.text.type).toBe('string');
        expect(tool.required).toEqual(['text']);
    });
});
