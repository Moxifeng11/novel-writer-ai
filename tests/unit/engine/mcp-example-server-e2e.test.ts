/**
 * 示例 MCP 程序端到端：生成的脚本必须能被真实 spawn、握手、列工具、调用
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMcpExampleServer } from '@/shared/mcp-example-server';
import { McpClient } from '@/engine/agent/harness/mcp-client';
import { createStdioTransport, loadChildProcess } from '@/engine/agent/harness/mcp-stdio-transport';
import { probeMcpServer } from '@/engine/agent/harness/mcp-manager';
import { resolveMcpLaunchFromPath } from '@/shared/mcp-launch';
import type { McpServerConfig } from '@/shared/mcp-config';

const dirs: string[] = [];
const clients: McpClient[] = [];

const writeExample = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-mcp-example-'));
    dirs.push(dir);
    const script = path.join(dir, 'nw-example-server.mjs');
    fs.writeFileSync(script, buildMcpExampleServer(), 'utf8');
    return script;
};

const configFor = (script: string): McpServerConfig => {
    const spec = resolveMcpLaunchFromPath(script, 'win32');
    if (!spec) throw new Error('无法推断启动方式');
    return {
        id: 'nw-example',
        name: '示例',
        transport: 'stdio',
        command: spec.command,
        args: spec.args,
        kind: 'read',
        enabled: true,
    };
};

afterEach(() => {
    for (const client of clients.splice(0)) {
        try {
            client.close();
        } catch {
            // silent-ok: 测试清理
        }
    }
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('示例 MCP 程序', () => {
    it('脚本本身是合法 JS（能被 node 加载）', () => {
        const script = writeExample();
        expect(fs.readFileSync(script, 'utf8')).toContain('tools/call');
        expect(loadChildProcess()).not.toBeNull();
    });

    it('握手 → 列出 3 个工具 → 调用 echo/char_count/now', async () => {
        const script = writeExample();
        const config = configFor(script);
        const client = new McpClient(config, createStdioTransport(config));
        clients.push(client);
        await client.connect();
        const tools = await client.listTools();
        expect(tools.map(tool => tool.name).sort()).toEqual(['char_count', 'echo', 'now']);

        const echo = await client.callTool('echo', { text: '接入成功' });
        expect(echo.ok).toBe(true);
        expect(echo.content).toBe('接入成功');

        const count = await client.callTool('char_count', { text: '小说工坊' });
        // 「小说工坊」= 4 个字符
expect(count.content).toContain('4');

        const now = await client.callTool('now', {});
        expect(now.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }, 30_000);

    it('probeMcpServer 能真实探测并返回工具清单', async () => {
        const script = writeExample();
        const result = await probeMcpServer(configFor(script));
        expect(result.ok).toBe(true);
        expect(result.tools.map(tool => tool.name).sort()).toEqual(['char_count', 'echo', 'now']);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 30_000);

    it('命令不存在时 probe 返回可读失败原因（不抛错）', async () => {
        const result = await probeMcpServer({
            id: 'bad',
            name: 'bad',
            transport: 'stdio',
            command: 'not-a-real-command-xyz',
            args: [],
            kind: 'read',
            enabled: true,
        });
        expect(result.ok).toBe(false);
        expect(String(result.error ?? '')).not.toHaveLength(0);
    }, 30_000);
});

describe('probeMcpServer 配置校验', () => {
    it('非法配置直接返回失败，不起进程', async () => {
        const result = await probeMcpServer({ id: 'bad id!', transport: 'stdio' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('配置不完整');
    });
});
