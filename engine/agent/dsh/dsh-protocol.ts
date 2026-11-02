/**
 * dsh-protocol.ts — DeepSeek Harness SDK 的 stdio JSON-RPC 客户端（D）
 *
 * 依据 @deepseek-ai/dsh-sdk-protocol 0.0.1-rc.1：
 *   - 每行一个紧凑 JSON-RPC 2.0 帧；stdout 只走协议，stderr 是日志；
 *   - 客户端→服务端：initialize / session/prompt / shutdown；
 *   - 服务端→客户端：session.event / session.status / subagent.*。
 *
 * 该协议**没有** cancel / session-close / 审批通道：取消只能杀进程。
 * 因此这里不假设「可中断单轮」，只提供帧收发与请求超时。
 */

export interface DshJsonRpcNotification {
    method: string;
    params?: unknown;
}

/**
 * JSON-RPC 客户端选项。
 */
export interface DshJsonRpcClientOptions {
    /**
     * 写一行到子进程 stdin（调用方负责换行）
     *
     * @param line - 行
     */
    write(line: string): void;
    onNotification?: (notification: DshJsonRpcNotification) => void;
    onProtocolError?: (message: string, line?: string) => void;
}

interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * JSON-RPC 错误对象。
 */
export class DshJsonRpcError extends Error {
    constructor(readonly code: number, message: string, readonly data?: unknown) {
        super(message);
        this.name = 'DshJsonRpcError';
    }
}

/**
 * 基于换行分隔 JSON 的 RPC 客户端。
 */
export class DshJsonRpcClient {
    private nextId = 1;
    private pending = new Map<number, PendingCall>();
    private disposed = false;

    constructor(private readonly options: DshJsonRpcClientOptions) {}

    /**
     * 处理一行 stdout；坏行被忽略并回报（stdout 可能混入日志）
     *
     * @param raw - 原始
     */
    handleLine(raw: string): void {
        const line = String(raw ?? '').trim();
        if (!line) return;
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            this.options.onProtocolError?.('无法解析 JSON-RPC 行', line.slice(0, 200));
            return;
        }
        if (!frame || typeof frame !== 'object') return;
        const record = frame as Record<string, unknown>;

        if (typeof record.method === 'string' && record.id === undefined) {
            this.options.onNotification?.({
                method: record.method,
                params: record.params,
            });
            return;
        }

        const id = Number(record.id);
        if (!Number.isFinite(id)) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);

        if (record.error && typeof record.error === 'object') {
            const error = record.error as { code?: number; message?: string; data?: unknown };
            pending.reject(new DshJsonRpcError(
                Number(error.code) || -32603,
                String(error.message || 'JSON-RPC 调用失败'),
                error.data,
            ));
            return;
        }
        pending.resolve(record.result);
    }

    /**
     * 请求。
     * @param method - 参数值
     * @param params - 参数值
     * @param timeoutMs - 超时时间（毫秒）
      * @returns T 实例
     */
    request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
        if (this.disposed) return Promise.reject(new Error('JSON-RPC 连接已关闭'));
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`JSON-RPC ${method} 超时（${timeoutMs}ms）`));
                }, timeoutMs)
                : null;
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
            try {
                this.options.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
            } catch (e) {
                if (timer) clearTimeout(timer);
                this.pending.delete(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }

    /**
     * 发送通知（不等待响应）。
     *
     * @param method - RPC 方法名
     * @param params - 参数集合
     */
    notify(method: string, params?: unknown): void {
        this.options.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    }

    /**
     * 连接断开：所有未完成请求失败（不静默挂起）
     *
     * @param reason - 原因
     */
    dispose(reason = '连接已关闭'): void {
        this.disposed = true;
        for (const [, pending] of this.pending) {
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.pending.clear();
    }

    get pendingCount(): number {
        return this.pending.size;
    }
}
