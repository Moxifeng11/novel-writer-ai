/**
 * mcp-client.ts — MCP 客户端（JSON-RPC 2.0 over stdio / http）
 *
 * 传输层抽象成接口，便于单测注入假传输；stdio 实现只在桌面端动态加载
 * child_process（移动端/测试环境不可用时不报错，由调用方降级）。
 */

import type { McpServerConfig } from '@/shared/mcp-config';
import { MCP_INIT_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS } from '@/shared/mcp-config';

/** MCP 工具描述 */
export interface McpToolInfo {
    name: string;
    description: string;
    /** JSON Schema（原样透传，桥接时尽量转成简单参数表） */
    inputSchema?: Record<string, unknown>;
}

/** 传输接口：发送一行 JSON，返回响应行 */
export interface McpTransport {
    /** 启动/连接 */
    start(): Promise<void>;
    /** 发送 JSON-RPC 请求并等待响应 */
    request(payload: unknown, timeoutMs: number): Promise<unknown>;
    /** 关闭 */
    close(): void;
}

/** 客户端错误 */
export class McpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'McpError';
    }
}

/**
 * 生成 JSON-RPC 请求体。
 *
 * @param id - 请求 id
 * @param method - 方法名
 * @param params - 参数
 * @returns 请求对象
 */
export function jsonRpcRequest(id: number, method: string, params?: unknown): Record<string, unknown> {
    return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

/**
 * 从 JSON-RPC 响应里取 result；错误抛 McpError。
 *
 * @param response - 响应体
 * @returns result
 */
export function extractJsonRpcResult(response: unknown): unknown {
    const body = response as { result?: unknown; error?: { message?: string } } | null;
    if (!body || typeof body !== 'object') throw new McpError('MCP 响应不是对象');
    if (body.error) throw new McpError(`MCP 错误：${body.error.message || '未知错误'}`);
    return body.result;
}

/**
 * MCP 客户端：initialize → tools/list → tools/call。
 */
export class McpClient {
    private nextId = 1;
    private tools: McpToolInfo[] = [];

    /**
     * 构造 MCP 客户端。
     *
     * @param config - 服务配置
     * @param transport - 传输实现
     */
    constructor(private readonly config: McpServerConfig, private readonly transport: McpTransport) {}

    /**
     * 连接并握手（initialize + initialized 通知）。
     *
     * @returns 完成 Promise
     */
    async connect(): Promise<void> {
        await this.transport.start();
        const init = await this.call('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'novel-writer-ai', version: '1.0.0' },
        }, MCP_INIT_TIMEOUT_MS);
        void init;
        // 通知（无 id）：MCP 规范要求 initialize 后发 initialized
        await this.notify('notifications/initialized', {});
    }

    /**
     * 拉取工具清单。
     *
     * @returns 工具数组
     */
    async listTools(): Promise<McpToolInfo[]> {
        const result = await this.call('tools/list', {}, MCP_INIT_TIMEOUT_MS) as { tools?: McpToolInfo[] };
        this.tools = Array.isArray(result?.tools) ? result.tools : [];
        return this.tools;
    }

    /**
     * 已拉取的工具清单。
     *
     * @returns 工具数组
     */
    getTools(): McpToolInfo[] {
        return this.tools;
    }

    /**
     * 调用 MCP 工具。
     *
     * @param name - MCP 工具名
     * @param args - 参数
     * @returns 结果
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: string }> {
        const result = await this.call('tools/call', { name, arguments: args }, MCP_TOOL_TIMEOUT_MS) as {
            content?: Array<{ type?: string; text?: string }>;
            isError?: boolean;
        };
        const texts = (result?.content ?? [])
            .map(item => (item?.type === 'text' ? String(item.text ?? '') : ''))
            .filter(Boolean);
        return {
            ok: result?.isError !== true,
            content: texts.join('\n') || '（MCP 工具无文本输出）',
        };
    }

    /** 关闭连接（释放子进程/连接） */
    close(): void {
        this.transport.close();
    }

    /**
     * 当前服务配置。
     *
     * @returns 服务配置
     */
    get serverConfig(): McpServerConfig {
        return this.config;
    }

    private async call(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        const id = this.nextId++;
        const response = await this.transport.request(jsonRpcRequest(id, method, params), timeoutMs);
        return extractJsonRpcResult(response);
    }

    private async notify(method: string, params: unknown): Promise<void> {
        // 通知不需要响应；失败不影响后续（服务端可能不支持）
        try {
            await this.transport.request({ jsonrpc: '2.0', method, params }, 5_000);
        } catch {
            // silent-ok: initialized 通知失败不阻断工具列表拉取
        }
    }
}
