/**
 * usage-ledger.ts — AI 调用用量账本（token / 耗时 / 状态）
 *
 * 此前只有“本步耗时/注入估算”，没有跨会话的真实 token 统计；用户无法回答
 * “这章花了多少 token、哪个模型用得最多、失败重试烧了多少”。这里在
 * AIApiClient 的三个入口统一记账，落盘到插件数据目录（不进用户 vault）。
 */
import type { App } from 'obsidian';
import { createLogger } from '@/shared/logger';

const log = createLogger('UsageLedger');

/** 调用来源。 */
export type UsageSource = 'ai' | 'step' | 'unit' | 'agent' | 'document';

/** 单次调用记录。 */
export interface UsageRecord {
    id: string;
    at: number;
    source: UsageSource;
    /** 请求的模型名（fallback 后的实际模型暂不区分） */
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    status: 'ok' | 'error' | 'aborted';
    error?: string;
    /** 可选上下文（项目 / 步骤） */
    project?: string;
    stepKey?: string;
}

/** 按模型聚合。 */
export interface UsageModelSummary {
    model: string;
    calls: number;
    okCalls: number;
    failedCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
}

/** 汇总结果。 */
export interface UsageSummary {
    totalCalls: number;
    okCalls: number;
    failedCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    byModel: UsageModelSummary[];
}

/**
 * 账本落盘路径（configDir 可能被用户改过，不能硬编码 .obsidian）。
 *
 * @param app - Obsidian 应用实例
 * @returns 插件数据目录下的账本文件路径
 */
function ledgerPath(app: App): string {
    const configDir = app.vault.configDir;
    return `${configDir}/plugins/novel-writer-ai/data/usage-ledger.json`;
}
const MAX_RECORDS = 500;

function emptyModelSummary(model: string): UsageModelSummary {
    return {
        model,
        calls: 0,
        okCalls: 0,
        failedCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 0,
    };
}

/**
 * 汇总用量记录（纯函数，便于测试与 UI 复用）。
 *
 * @param records - 记录列表
 * @returns 汇总结果
 *
 * @example
 * ```ts
 * const summary = summarizeUsage(ledger.list());
 * console.log(summary.totalTokens);
 * ```
 */
export function summarizeUsage(records: readonly UsageRecord[]): UsageSummary {
    const byModel = new Map<string, UsageModelSummary>();
    const summary: UsageSummary = {
        totalCalls: 0,
        okCalls: 0,
        failedCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        byModel: [],
    };
    for (const record of records) {
        summary.totalCalls += 1;
        summary.promptTokens += record.promptTokens;
        summary.completionTokens += record.completionTokens;
        summary.totalTokens += record.totalTokens;
        summary.durationMs += record.durationMs;
        if (record.status === 'ok') summary.okCalls += 1;
        else summary.failedCalls += 1;

        const key = record.model || '(unknown)';
        const model = byModel.get(key) ?? emptyModelSummary(key);
        model.calls += 1;
        if (record.status === 'ok') model.okCalls += 1;
        else model.failedCalls += 1;
        model.promptTokens += record.promptTokens;
        model.completionTokens += record.completionTokens;
        model.totalTokens += record.totalTokens;
        model.durationMs += record.durationMs;
        byModel.set(key, model);
    }
    summary.byModel = [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    return summary;
}

/**
 * 用量账本。
 */
export class UsageLedger {
    private records: UsageRecord[] = [];
    private listeners = new Set<() => void>();
    private loaded = false;
    private seq = 0;

    /**
     * @param app - Obsidian 应用实例（用于落盘；测试可传最小对象）
     */
    constructor(private readonly app?: App) {}

    /** 从磁盘加载（幂等）。 */
    async load(): Promise<void> {
        if (this.loaded || !this.app) return;
        this.loaded = true;
        try {
            const adapter = this.app.vault.adapter;
            const path = ledgerPath(this.app);
            if (!(await adapter.exists(path))) return;
            const raw = await adapter.read(path);
            const parsed = JSON.parse(raw) as { records?: UsageRecord[] };
            if (Array.isArray(parsed.records)) {
                this.records = parsed.records.slice(-MAX_RECORDS);
                this.seq = this.records.length;
            }
        } catch (error) {
            log.warn('用量账本读取失败（忽略，按空账本继续）:', error);
        }
    }

    /**
     * 记录一次调用。
     *
     * @param record - 不含 id 的记录
     * @returns 完整记录
     */
    async record(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
        await this.load();
        this.seq += 1;
        const full: UsageRecord = { ...record, id: `usage_${this.seq}` };
        this.records.push(full);
        if (this.records.length > MAX_RECORDS) {
            this.records = this.records.slice(-MAX_RECORDS);
        }
        for (const listener of this.listeners) {
            try { listener(); } catch { /* 监听器异常不影响记账 */ }
        }
        void this.flush();
        return full;
    }

    /**
     * 最近记录（新在前）。
     *
     * @param limit - 数量上限
     * @returns 记录数组
     */
    list(limit = 100): UsageRecord[] {
        return [...this.records].reverse().slice(0, limit);
    }

    /**
     * 汇总。
     *
     * @param limit - 参与汇总的最近记录数
     * @returns 汇总结果
     */
    summary(limit = MAX_RECORDS): UsageSummary {
        return summarizeUsage(this.list(limit));
    }

    /**
     * 订阅变更（UI 刷新用）。
     *
     * @param listener - 变更回调
     * @returns 取消订阅函数
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** 清空账本。 */
    async clear(): Promise<void> {
        this.records = [];
        this.seq = 0;
        await this.flush();
    }

    /** 落盘（失败只记日志）。 */
    async flush(): Promise<void> {
        if (!this.app) return;
        try {
            const adapter = this.app.vault.adapter;
            const path = ledgerPath(this.app);
            const dir = path.substring(0, path.lastIndexOf('/'));
            if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
            // write-entry-allow: 用量账本是 JSON，位于插件数据目录，不在 vault 索引。
            await adapter.write(path, JSON.stringify({ version: 1, records: this.records }));
        } catch (error) {
            log.warn('用量账本写入失败:', error);
        }
    }
}

let ledger: UsageLedger | null = null;

/**
 * 获取全局用量账本（懒加载单例）。
 *
 * @param app - Obsidian 应用实例
 * @returns 账本实例
 */
export function getUsageLedger(app?: App): UsageLedger {
    if (!ledger) ledger = new UsageLedger(app);
    else if (app && !ledger['app']) ledger = new UsageLedger(app);
    return ledger;
}

/** 测试用：重置单例。 */
export function resetUsageLedger(): void {
    ledger = null;
}
