/**
 * usage-ledger.ts — AI 调用用量账本（token / 耗时 / 状态）
 *
 * 此前只有“本步耗时/注入估算”，没有跨会话的真实 token 统计；用户无法回答
 * “这章花了多少 token、哪个模型用得最多、失败重试烧了多少”。这里在
 * AIApiClient 的三个入口统一记账，落盘到插件数据目录（不进用户 vault）。
 */
import type { App } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pluginDataFile } from '@/shared/paths';

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
    /** 估算费用（元）；模型未配置单价时缺省（不计费） */
    costYuan?: number;
    /**
     * 流式响应未返回 usage 帧时置 true（DSH-20261113-25 ④）：
     * 0 token 是「未统计」而非「真实消耗为 0」，汇总/展示方据此区分。
     */
    usageUnavailable?: boolean;
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
    /** 估算费用合计（元）；无单价记录按 0 计 */
    costYuan: number;
}

/** 按项目聚合（无归因的记录归入 `(未归因)` 一行）。 */
export interface UsageProjectSummary {
    project: string;
    calls: number;
    okCalls: number;
    failedCalls: number;
    totalTokens: number;
    durationMs: number;
    /** 估算费用合计（元）；无单价记录按 0 计 */
    costYuan: number;
}

/** 按来源聚合（ai/step/unit/agent/document）。 */
export interface UsageSourceSummary {
    source: UsageSource;
    calls: number;
    totalTokens: number;
    /** 估算费用合计（元）；无单价记录按 0 计 */
    costYuan: number;
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
    /** 估算费用合计（元）；全部记录都未配置单价时为 0 */
    costYuan: number;
    byModel: UsageModelSummary[];
    /** 按项目聚合，token 总量降序；空 project 归 `(未归因)`。 */
    byProject: UsageProjectSummary[];
    /** 按来源聚合，token 总量降序。 */
    bySource: UsageSourceSummary[];
}

/**
 * 账本落盘路径（configDir 可能被用户改过，不能硬编码 .obsidian）。
 *
 * v4.76.0：改为走 shared/paths 的插件数据目录——`_onload` 用
 * `${vault.configDir}/${manifest.dir}` 注入，兼容自定义配置目录与 BRAT 插件文件夹名。
 *
 * @returns 插件数据目录下的账本文件路径
 */
function ledgerPath(): string {
    return pluginDataFile('usage-ledger.json');
}
const MAX_RECORDS = 500;

// ============================================================
// 调用归因 scope（Obsidian 单线程：用栈保存嵌套作用域即可）
// ============================================================

/** 一次 AI 调用群的归因信息（谁发起、哪个项目/步骤）。 */
export interface UsageScope {
    source?: UsageSource;
    project?: string;
    stepKey?: string;
}

const usageScopeStack: UsageScope[] = [];

/**
 * 进入一个用量归因作用域；返回退出函数（必须调用，建议 try/finally）。
 *
 * @param scope - 归因信息（source/project/stepKey）
 * @returns 退出函数
 *
 * @example
 * ```ts
 * const exit = pushUsageScope({ source: 'step', project, stepKey });
 * try { await callAI(...); } finally { exit(); }
 * ```
 */
export function pushUsageScope(scope: UsageScope): () => void {
    usageScopeStack.push(scope);
    return (): void => {
        const index = usageScopeStack.lastIndexOf(scope);
        if (index >= 0) usageScopeStack.splice(index, 1);
    };
}

/**
 * 当前生效的归因信息（栈顶；空栈返回空对象）。
 *
 * @returns 当前 scope
 */
export function currentUsageScope(): UsageScope {
    return usageScopeStack.length > 0 ? usageScopeStack[usageScopeStack.length - 1] : {};
}

/** 项目未归因（record.project 为空）时在 byProject 里使用的占位名。 */
const UNATTRIBUTED_PROJECT = '(未归因)';

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
        costYuan: 0,
    };
}

function emptyProjectSummary(project: string): UsageProjectSummary {
    return {
        project,
        calls: 0,
        okCalls: 0,
        failedCalls: 0,
        totalTokens: 0,
        durationMs: 0,
        costYuan: 0,
    };
}

function emptySourceSummary(source: UsageSource): UsageSourceSummary {
    return {
        source,
        calls: 0,
        totalTokens: 0,
        costYuan: 0,
    };
}

/**
 * 汇总用量记录（纯函数，便于测试与 UI 复用）。
 *
 * 除总计与按模型分布外，还给出按项目与按来源两个维度：
 * - `byProject` 依赖调用方的 pushUsageScope 归因（step/unit/agent 三条链），
 *   未归因（project 为空）的记录统一归入 `(未归因)`，用于发现漏挂 scope 的调用点；
 * - `bySource` 按发起方（ai/step/unit/agent/document）聚合，看哪条链最烧 token。
 * 两个列表均按 totalTokens 降序。
 *
 * @param records - 记录列表
 * @returns 汇总结果
 *
 * @example
 * ```ts
 * const summary = summarizeUsage(ledger.list());
 * console.log(summary.totalTokens);
 * console.log(summary.costYuan); // 估算费用合计（元）；未配置单价的记录按 0 计
 * console.log(summary.byModel[0]?.model, summary.byModel[0]?.totalTokens);
 * console.log(summary.byProject[0]?.project, summary.byProject[0]?.calls);
 * console.log(summary.bySource.map((s) => `${s.source}:${s.calls}`).join(','));
 * ```
 */
export function summarizeUsage(records: readonly UsageRecord[]): UsageSummary {
    const byModel = new Map<string, UsageModelSummary>();
    const byProject = new Map<string, UsageProjectSummary>();
    const bySource = new Map<UsageSource, UsageSourceSummary>();
    const summary: UsageSummary = {
        totalCalls: 0,
        okCalls: 0,
        failedCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costYuan: 0,
        byModel: [],
        byProject: [],
        bySource: [],
    };
    for (const record of records) {
        summary.totalCalls += 1;
        summary.promptTokens += record.promptTokens;
        summary.completionTokens += record.completionTokens;
        summary.totalTokens += record.totalTokens;
        summary.durationMs += record.durationMs;
        // 未配置单价的记录 costYuan 缺省，按 0 计入费用合计
        summary.costYuan += record.costYuan ?? 0;
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
        model.costYuan += record.costYuan ?? 0;
        byModel.set(key, model);

        // 按项目：project 缺失（未挂 scope 或链路未覆盖）时归入「未归因」桶
        const projectKey = record.project || UNATTRIBUTED_PROJECT;
        const project = byProject.get(projectKey) ?? emptyProjectSummary(projectKey);
        project.calls += 1;
        if (record.status === 'ok') project.okCalls += 1;
        else project.failedCalls += 1;
        project.totalTokens += record.totalTokens;
        project.durationMs += record.durationMs;
        project.costYuan += record.costYuan ?? 0;
        byProject.set(projectKey, project);

        // 按来源：source 由 client 兜底为 'ai'，必然有值
        const source = bySource.get(record.source) ?? emptySourceSummary(record.source);
        source.calls += 1;
        source.totalTokens += record.totalTokens;
        source.costYuan += record.costYuan ?? 0;
        bySource.set(record.source, source);
    }
    summary.byModel = [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    summary.byProject = [...byProject.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    summary.bySource = [...bySource.values()].sort((a, b) => b.totalTokens - a.totalTokens);
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
            const path = ledgerPath();
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
            const path = ledgerPath();
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
