/**
 * mcp-example-server.ts — 示例 MCP 程序（可直接接入并调用）
 *
 * 用途：用户还没有自己的 MCP 程序时，一键生成一个能跑的最小服务，
 * 用来验证「插件 ↔ MCP 程序」链路，也可作为自己扩展的起点。
 *
 * 协议：MCP over stdio，每行一个 JSON-RPC 2.0 报文。
 */

/** 示例服务在 vault 里的默认相对路径 */
export const MCP_EXAMPLE_SERVER_PATH = 'mcp-servers/nw-example-server.mjs';

/**
 * 生成示例 MCP 服务脚本内容（纯 Node，无第三方依赖）。
 *
 * @returns 脚本源码
 * @example
 * ```ts
 * const content = buildMcpExampleServer();
 * await app.vault.create(MCP_EXAMPLE_SERVER_PATH, content);
 * ```
 */
export function buildMcpExampleServer(): string {
    return `#!/usr/bin/env node
/**
 * 小说工坊 · 示例 MCP 服务
 *
 * 这是一个最小可用的 MCP（Model Context Protocol）stdio 服务：
 * 每行读一个 JSON-RPC 2.0 报文，支持 initialize / tools/list / tools/call。
 *
 * 想接自己的工具时：改下方 TOOLS 与 callTool 的实现即可，其余不用动。
 */
const TOOLS = [
  {
    name: 'echo',
    description: '回显你输入的文字（用来验证链路是否打通）',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要回显的文字' } },
      required: ['text'],
    },
  },
  {
    name: 'char_count',
    description: '统计一段文字的字符数（按 Unicode 字符计，中文一个字算一个）',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要统计的文字' } },
      required: ['text'],
    },
  },
  {
    name: 'now',
    description: '返回当前本地时间（ISO 8601）',
    inputSchema: { type: 'object', properties: {} },
  },
];

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function failure(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

function callTool(name, args) {
  if (name === 'echo') return String((args && args.text) || '');
  if (name === 'char_count') {
    const text = String((args && args.text) || '');
    return '字符数：' + Array.from(text).length;
  }
  if (name === 'now') return new Date().toISOString();
  throw new Error('未知工具：' + name);
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    const id = request.id;
    // 通知（无 id）不回复
    if (id === undefined) continue;
    const method = request.method;
    try {
      if (method === 'initialize') {
        result(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'nw-example-mcp', version: '1.0.0' },
        });
      } else if (method === 'tools/list') {
        result(id, { tools: TOOLS });
      } else if (method === 'tools/call') {
        const params = request.params || {};
        const text = callTool(params.name, params.arguments || {});
        result(id, { content: [{ type: 'text', text }], isError: false });
      } else {
        result(id, {});
      }
    } catch (error) {
      failure(id, error && error.message ? error.message : String(error));
    }
  }
});

process.stdin.on('end', () => process.exit(0));
`;
}
