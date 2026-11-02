/**
 * call-ledger.ts - distinguish logical feature calls from network attempts.
 *
 * A feature may legitimately retry at transport level or continue a truncated
 * stream; those are networkCalls. logicalCalls must stay 1 for single-call
 * features.
 */
import { createLogger } from '../../shared/logger';

const log = createLogger('CallLedger');

/**
 * 调用账本条目。
 */
export interface CallLedgerEntry {
    taskId: string;
    projectId?: string;
    logicalCalls: number;
    networkCalls: number;
    retriedCalls: number;
    startedAt: number;
    endedAt?: number;
    ok?: boolean;
}

/**
 * 调用账本。
 */
export class CallLedger {
    private entries: CallLedgerEntry[] = [];
    private active = new Map<string, CallLedgerEntry>();

    /**
     * 开始一条调用记录。
     *
     * @param taskId - 参数
     * @param projectId? - 参数
     * @returns id
     */
    start(taskId: string, projectId?: string): string {
        const key = `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const entry: CallLedgerEntry = {
            taskId,
            projectId,
            logicalCalls: 0,
            networkCalls: 0,
            retriedCalls: 0,
            startedAt: Date.now(),
        };
        this.active.set(key, entry);
        return key;
    }

    /**
     * 标记逻辑调用。
     *
     * @param key - 参数
     */
    markLogical(key: string): void {
        const entry = this.active.get(key);
        if (!entry) return;
        entry.logicalCalls += 1;
    }

    /**
     * 标记网络调用。
     *
     * @param key - 参数
     * @param retried = false - 参数
     */
    markNetwork(key: string, retried = false): void {
        const entry = this.active.get(key);
        if (!entry) return;
        entry.networkCalls += 1;
        if (retried) entry.retriedCalls += 1;
    }

    /**
     * 结束调用。
     *
     * @param key - 参数
     * @param ok - 参数
     * @returns 耗时
     */
    end(key: string, ok: boolean): CallLedgerEntry | null {
        const entry = this.active.get(key);
        if (!entry) return null;
        entry.endedAt = Date.now();
        entry.ok = ok;
        this.active.delete(key);
        this.entries.push(entry);
        if (this.entries.length > 200) this.entries.shift();
        log.info('call ledger', entry);
        return entry;
    }

    /**
     * 读取最近记录。
     *
     * @param limit = 20 - 参数
     * @returns 记录数组
     */
    recent(limit = 20): CallLedgerEntry[] {
        return this.entries.slice(-limit).reverse();
    }

    /**
     * 清空账本。
     */
    clear(): void {
        this.entries = [];
        this.active.clear();
    }
}

/**
 * 全局调用账本。
 */
export const callLedger = new CallLedger();
