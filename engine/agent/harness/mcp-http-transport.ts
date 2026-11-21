/**
 * mcp-http-transport.ts — MCP HTTP 传输（POST JSON-RPC）
 *
 * 最简实现：每次请求 POST 一个 JSON-RPC 帧，按响应 JSON 解析。
 * 不处理 SSE 流式传输（MCP 的 HTTP+SSE 变体留待后续）。
 */

import { requestUrl } from 'obsidian';
import type { McpServerConfig } from '@/shared/mcp-config';
import { McpError, type McpTransport } from './mcp-client';

/**
 * 创建 HTTP 传输。
 *
 * @param config - 服务配置（需要 url）
 * @returns 传输实例
 */
export function createHttpTransport(config: McpServerConfig): McpTransport {
    const url = String(config.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new McpError('MCP 服务缺少合法 url');
    let closed = false;
    return {
        start: async () => {
            closed = false;
        },
        request: async (payload, timeoutMs) => {
            if (closed) throw new McpError('MCP 连接已关闭');
            // 走 Obsidian requestUrl（移动端有 CORS 豁免；与插件其它 HTTP 调用口径一致）
            const timer = window.setTimeout(() => undefined, 0);
            window.clearTimeout(timer);
            const timeout = new Promise<never>((_, reject) => {
                window.setTimeout(() => reject(new McpError(`MCP HTTP 请求超时（${timeoutMs}ms）`)), timeoutMs);
            });
            try {
                const response = await Promise.race([
                    requestUrl({
                        url,
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(payload),
                        throw: false,
                    }),
                    timeout,
                ]);
                if (response.status < 200 || response.status >= 300) {
                    throw new McpError(`MCP HTTP ${response.status}`);
                }
                const text = String(response.text ?? '');
                if (!text.trim()) return { jsonrpc: '2.0', result: null };
                return JSON.parse(text);
            } catch (error) {
                if (error instanceof McpError) throw error;
                throw new McpError(`MCP HTTP 请求失败：${error instanceof Error ? error.message : String(error)}`);
            }
        },
        close: () => {
            closed = true;
        },
    };
}
