/**
 * mcp-stdio-transport.ts — MCP stdio 传输（桌面端子进程）
 *
 * 只在桌面端可用：动态 require child_process，移动端/测试环境返回 null。
 * 协议：每行一个 JSON（NDJSON）。
 */

import type { McpServerConfig } from '@/shared/mcp-config';
import { McpError, type McpTransport } from './mcp-client';

/** child_process 最小接口（避免把 Node 类型带进引擎层） */
interface ChildLike {
    stdin: { write(chunk: string): void; end(): void } | null;
    stdout: { on(event: 'data', handler: (chunk: { toString(): string }) => void): void } | null;
    stderr: { on(event: 'data', handler: (chunk: { toString(): string }) => void): void } | null;
    on(event: 'exit' | 'error', handler: (code?: number | Error) => void): void;
    kill(): void;
}

interface ChildProcessModule {
    spawn(command: string, args: string[], options: Record<string, unknown>): ChildLike;
}

/**
 * 尝试加载 child_process；不可用返回 null。
 *
 * @returns 模块或 null
 */
export function loadChildProcess(): ChildProcessModule | null {
    try {
         
        const mod = require('node:child_process') as ChildProcessModule;
        return mod && typeof mod.spawn === 'function' ? mod : null;
    } catch { // silent-ok: 移动端/受限环境没有 child_process，MCP stdio 不可用属预期
        return null;
    }
}

/**
 * 创建 stdio 传输。
 *
 * @param config - 服务配置（需要 command/args/env）
 * @returns 传输实例
 */
export function createStdioTransport(config: McpServerConfig): McpTransport {
    const cp = loadChildProcess();
    if (!cp) throw new McpError('当前环境不支持启动本地进程（MCP stdio 仅桌面端可用）');
    const command = String(config.command || '').trim();
    if (!command) throw new McpError('MCP 服务缺少 command');

    let child: ChildLike | null = null;
    let buffer = '';
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();

    const settleAll = (error: Error): void => {
        for (const [, entry] of pending) {
            window.clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
    };

    const onLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: { id?: number; result?: unknown; error?: unknown };
        try {
            parsed = JSON.parse(trimmed);
        } catch { // silent-ok: 非 JSON 行（服务端日志）忽略，不影响协议帧
            return;
        }
        // 通知（无 id）忽略
        if (typeof parsed.id !== 'number') return;
        const entry = pending.get(parsed.id);
        if (!entry) return;
        pending.delete(parsed.id);
        window.clearTimeout(entry.timer);
        entry.resolve(parsed);
    };

    return {
        start: async () => {
            child = cp.spawn(command, (config.args ?? []).map(String), {
                env: { ...process.env, ...(config.env ?? {}) },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            child.stdout?.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) onLine(line);
            });
            child.stderr?.on('data', () => {
                // silent-ok: 服务端 stderr 是诊断日志，不进入协议流
            });
            child.on('exit', () => settleAll(new McpError('MCP 进程已退出')));
            child.on('error', (error) => settleAll(new McpError(String(error))));
        },
        request: (payload, timeoutMs) => new Promise((resolve, reject) => {
            const body = payload as { id?: number };
            const id = typeof body.id === 'number' ? body.id : -1;
            if (!child?.stdin) {
                reject(new McpError('MCP 进程未启动'));
                return;
            }
            const timer = window.setTimeout(() => {
                pending.delete(id);
                reject(new McpError(`MCP 请求超时（${timeoutMs}ms）`));
            }, timeoutMs);
            if (id >= 0) pending.set(id, { resolve, reject, timer });
            try {
                child.stdin.write(`${JSON.stringify(payload)}\n`);
            } catch (error) {
                window.clearTimeout(timer);
                pending.delete(id);
                reject(new McpError(String(error)));
            }
            // 通知没有 id：写出去即完成
            if (id < 0) {
                window.clearTimeout(timer);
                resolve({ jsonrpc: '2.0', result: null });
            }
        }),
        close: () => {
            settleAll(new McpError('MCP 连接已关闭'));
            try {
                child?.stdin?.end();
                child?.kill();
            } catch { // silent-ok: 关闭失败不影响后续（进程可能已退出）
            }
            child = null;
        },
    };
}
