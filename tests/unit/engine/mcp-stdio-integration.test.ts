/**
 * MCP stdio 真实进程集成测试：起一个最小 MCP server，验证 initialize/tools/list/tools/call
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpClient } from '@/engine/agent/harness/mcp-client';
import { createStdioTransport, loadChildProcess } from '@/engine/agent/harness/mcp-stdio-transport';
import type { McpServerConfig } from '@/shared/mcp-config';

const SERVER_SCRIPT = `
let buffer = '';
process.stdin.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\\n');
    buffer = lines.pop();
    for (const line of lines) {
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        if (req.id === undefined) continue; // 通知
        const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
        if (req.method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 't', version: '1' } });
        else if (req.method === 'tools/list') reply({ tools: [{ name: 'echo', description: '回显', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] });
        else if (req.method === 'tools/call') reply({ content: [{ type: 'text', text: 'echo:' + (req.params.arguments.text || '') }] });
        else reply({});
    }
});
`;

const dirs: string[] = [];
let client: McpClient | null = null;

afterEach(() => {
    client?.close();
    client = null;
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('MCP stdio 真实进程', () => {
    it('桌面端可用 child_process', () => {
        expect(loadChildProcess()).not.toBeNull();
    });

    it('握手 → 工具列表 → 调用', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
        dirs.push(dir);
        const script = path.join(dir, 'server.cjs');
        fs.writeFileSync(script, SERVER_SCRIPT);
        const config: McpServerConfig = {
            id: 'demo', name: 'demo', transport: 'stdio',
            command: process.execPath, args: [script], kind: 'read', enabled: true,
        };
        client = new McpClient(config, createStdioTransport(config));
        await client.connect();
        const tools = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['echo']);
        const result = await client.callTool('echo', { text: '你好' });
        expect(result.ok).toBe(true);
        expect(result.content).toBe('echo:你好');
    }, 20_000);
});
