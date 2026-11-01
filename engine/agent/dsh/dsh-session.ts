/**
 * dsh-session.ts — dsh SDK 会话（D）
 *
 * 协议事实（@deepseek-ai/dsh-sdk-protocol 0.0.1-rc.1）：
 *   initialize {cwd, provider, model, maxTokens?}
 *   session/prompt {sessionId, contentBlocks:[{type:'text', text}]} → {messageId}
 *   session.event / session.status 通知；**没有** cancel、session-close、审批通道。
 *
 * 因此：
 * - 取消 = 终止子进程（会话由 DSH_HOME 持久化，下次同 sessionId 可续）；
 * - 写入安全靠 sandbox 模式（默认 read-only），协议层无法逐次批准。
 */
import { DshJsonRpcClient, type DshJsonRpcNotification } from './dsh-protocol';

export interface DshTransport {
    /** 写一行到子进程 stdin */
    write(line: string): void;
    /** 订阅 stdout 的完整行 */
    onLine(listener: (line: string) => void): void;
    /** 订阅 stderr（诊断用） */
    onStderr?(listener: (line: string) => void): void;
    /** 订阅进程退出 */
    onExit(listener: (code: number | null, signal: string | null) => void): void;
    kill(): void;
}

export interface DshSessionEvent {
    type: string;
    seq?: number;
    time?: number;
    data?: Record<string, unknown>;
}

export interface DshSessionSink {
    onAssistantText?(text: string): void;
    onToolCall?(call: { callId: string; name: string; args: string }): void;
    onToolResult?(result: { callId: string; name?: string; ok: boolean; text: string }): void;
    onStatus?(status: 'idle' | 'running'): void;
    onEvent?(event: DshSessionEvent): void;
    onStderr?(line: string): void;
}

export interface DshInitializeOptions {
    cwd: string;
    provider: string;
    model: string;
    maxTokens?: number;
}

export interface DshSessionOptions {
    transport: DshTransport;
    sessionId: string;
    sink?: DshSessionSink;
    /** 单次请求超时（默认 30s） */
    requestTimeoutMs?: number;
}

/** 从 contentBlocks 里抽取可见文本（跳过 reasoning/image） */
export function textOfContentBlocks(blocks: unknown): string {
    if (!Array.isArray(blocks)) return '';
    const parts: string[] = [];
    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const record = block as { type?: unknown; text?: unknown };
        if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    }
    return parts.join('\n').trim();
}

export class DshSession {
    private readonly client: DshJsonRpcClient;
    private initialized = false;
    private disposed = false;
    private idleWaiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> | null }> = [];
    private readonly pendingTools = new Map<string, { name: string }>();

    constructor(private readonly options: DshSessionOptions) {
        this.client = new DshJsonRpcClient({
            write: line => options.transport.write(line),
            onNotification: notification => this.handleNotification(notification),
        });
        options.transport.onLine(line => this.client.handleLine(line));
        options.transport.onStderr?.(line => options.sink?.onStderr?.(line));
        options.transport.onExit((code, signal) => {
            this.disposed = true;
            this.client.dispose(`dsh 进程已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`);
            this.flushIdle();
        });
    }

    async initialize(options: DshInitializeOptions): Promise<void> {
        await this.client.request('initialize', {
            cwd: options.cwd,
            provider: options.provider,
            model: options.model,
            ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        }, this.options.requestTimeoutMs);
        this.initialized = true;
    }

    /** 发送一条用户消息，返回入队回执（不代表 assistant 已回复） */
    async prompt(text: string): Promise<string> {
        if (!this.initialized) throw new Error('dsh 会话尚未 initialize');
        const result = await this.client.request<{ messageId?: string }>('session/prompt', {
            sessionId: this.options.sessionId,
            contentBlocks: [{ type: 'text', text: String(text ?? '') }],
        }, this.options.requestTimeoutMs);
        return String(result?.messageId || '');
    }

    /** 等待该会话回到 idle（dsh 没有 per-prompt 结果，只能看 agent 级状态） */
    waitForIdle(timeoutMs = 120_000): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {
                resolve();
                return;
            }
            const waiter: { resolve: () => void; timer: ReturnType<typeof setTimeout> | null } = {
                resolve,
                timer: null,
            };
            if (timeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    this.idleWaiters = this.idleWaiters.filter(item => item !== waiter);
                    reject(new Error(`等待 dsh 空闲超时（${timeoutMs}ms）`));
                }, timeoutMs);
            }
            this.idleWaiters.push(waiter);

            // rc.5 起服务端提供 session/wait：只有根会话空闲且受管子任务推进完成才返回，
            // 比单看 session.status 更确定。旧版本返回 -32601，忽略后仍以状态信号为准。
            this.client
                .request('session/wait', { sessionId: this.options.sessionId }, timeoutMs)
                .then(() => this.flushIdle())
                .catch(() => { /* 旧版本无该方法或已超时：状态信号兜底 */ });
        });
    }

    async shutdown(): Promise<void> {
        try {
            await this.client.request('shutdown', undefined, 5_000);
        } catch {
            // 进程可能已退出；关闭语义由 kill 兜底
        } finally {
            this.close();
        }
    }

    /** 取消/结束：协议无 cancel，只能杀进程 */
    close(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.client.dispose('会话已关闭');
        this.options.transport.kill();
        this.flushIdle();
    }

    get isClosed(): boolean {
        return this.disposed;
    }

    private flushIdle(): void {
        for (const waiter of this.idleWaiters.splice(0)) {
            if (waiter.timer) clearTimeout(waiter.timer);
            waiter.resolve();
        }
    }

    private handleNotification(notification: DshJsonRpcNotification): void {
        if (notification.method === 'session.status') {
            const params = notification.params as { sessionId?: string; status?: string } | undefined;
            if (params?.sessionId && params.sessionId !== this.options.sessionId) return;
            if (params?.status === 'idle') {
                this.options.sink?.onStatus?.('idle');
                this.flushIdle();
            } else if (params?.status === 'running') {
                this.options.sink?.onStatus?.('running');
            }
            return;
        }
        if (notification.method !== 'session.event') return;
        const params = notification.params as { sessionId?: string; event?: DshSessionEvent } | undefined;
        if (!params?.event) return;
        if (params.sessionId && params.sessionId !== this.options.sessionId) return;
        this.handleSessionEvent(params.event);
    }

    private handleSessionEvent(event: DshSessionEvent): void {
        this.options.sink?.onEvent?.(event);
        const data = (event.data || {}) as Record<string, unknown>;
        switch (event.type) {
            case 'assistant/message': {
                const message = data.message as { content?: unknown } | undefined;
                const text = textOfContentBlocks(message?.content);
                if (text) this.options.sink?.onAssistantText?.(text);
                return;
            }
            case 'tool/call': {
                const callId = String(data.callId || '');
                const name = String(data.name || '');
                this.pendingTools.set(callId, { name });
                this.options.sink?.onToolCall?.({
                    callId,
                    name,
                    args: String(data.arguments || ''),
                });
                return;
            }
            case 'tool/result': {
                const message = data.message as { content?: unknown; toolCallId?: string } | undefined;
                const callId = String(message?.toolCallId || '');
                const pending = this.pendingTools.get(callId);
                this.pendingTools.delete(callId);
                this.options.sink?.onToolResult?.({
                    callId,
                    name: pending?.name,
                    ok: !data.error,
                    text: textOfContentBlocks(message?.content),
                });
                return;
            }
            case 'turn/end':
                // 回合结束不等于 agent idle；状态仍以 session.status 为准
                return;
            default:
                return;
        }
    }
}
