/**
 * execution-ledger.ts — 长流程执行登记表（插件级，内存）
 *
 * 背景：`run_command` 派发长流程后只有 boolean 出口（main.ts 的 fire-and-forget），
 * 批量生成/结算/导出跑完的结果无处可读，Agent 只能让用户「去界面看」。
 * 结算的 `SettlementResult` 三条路径（写章弹窗/结算弹窗/步骤式结算）也都是用完即弃。
 *
 * 这里提供一个与 FullWriterView 私有的 ExecutionRunStore 解耦的轻量登记表：
 * UI 在关键完成点登记一条记录，Agent 通过 `get_execution_status` 读取并汇报。
 * 只存最近 20 条、不落盘——它是「刚才那次长流程怎么样了」的短期记忆，不是审计日志。
 *
 * 纯内存 + 纯投影，不依赖 Obsidian。
 */

export type CommandRunStatus = 'running' | 'done' | 'failed';

/** 结算结果的结构化投影（字段来自 SettlementResult，见 engine/settlement-engine.ts） */
export interface SettlementSummary {
    /** 更新条目数（人物/地点/势力/物品合计） */
    updated: number;
    /** 新建实体数 */
    created: number;
    updatedChars: number;
    updatedForeshadows: number;
    /** 被字段白名单拒绝的条数 */
    rejected: number;
    /** 目标实体缺失而搁置的条数 */
    missingEntities: number;
    /** 归属字段链接化写入数 */
    linkFieldWrites: number;
    /** 写入出场记录的行为摘要条数 */
    recordedBehaviors: number;
    /** 伏笔闭环核对（章纲计划 vs 结算指令） */
    foreshadowLoop?: { pass: boolean; summary: string };
}

export interface CommandRunRecord {
    id: string;
    commandId: string;
    /** 人类可读的命令名（可缺省，界面/Agent 用 commandId 兜底） */
    label?: string;
    project: string;
    source: 'agent' | 'ui';
    startedAt: number;
    finishedAt?: number;
    status: CommandRunStatus;
    /** 完成时的补充说明（如「已写入 3 章」） */
    detail?: string;
    /** 失败原因（含建议） */
    failure?: string;
    settlement?: SettlementSummary;
}

/** 结算结果的最小结构（避免 services 反向依赖 engine 的具体类型） */
export interface SettlementLike {
    updated?: number;
    created?: number;
    updatedChars?: number;
    updatedForeshadows?: number;
    rejectedFields?: unknown[];
    missingEntities?: unknown[];
    linkFieldWrites?: number;
    recordedBehaviors?: number;
    foreshadowLoop?: { pass?: boolean; summary?: string };
}

const MAX_RECORDS = 20;
/** 单条记录保留的最大文本长度（避免把整段 AI 错误原文塞进 Agent 上下文） */
const MAX_TEXT_CHARS = 400;

function clampText(value: unknown, maxChars = MAX_TEXT_CHARS): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return undefined;
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function countOf(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

/** 把 SettlementResult 投影成摘要（结算弹窗/写章弹窗/步骤式结算共用） */
export function summarizeSettlement(result: SettlementLike | null | undefined): SettlementSummary {
    const loop = result?.foreshadowLoop;
    const summary: SettlementSummary = {
        updated: countOf(result?.updated),
        created: countOf(result?.created),
        updatedChars: countOf(result?.updatedChars),
        updatedForeshadows: countOf(result?.updatedForeshadows),
        rejected: countOf(result?.rejectedFields),
        missingEntities: countOf(result?.missingEntities),
        linkFieldWrites: countOf(result?.linkFieldWrites),
        recordedBehaviors: countOf(result?.recordedBehaviors),
    };
    if (loop) {
        summary.foreshadowLoop = {
            pass: loop.pass === true,
            summary: clampText(loop.summary) || (loop.pass === true ? '伏笔闭环通过' : '伏笔闭环未通过'),
        };
    }
    return summary;
}

export class ExecutionLedger {
    private records: CommandRunRecord[] = [];
    private seq = 0;

    /** 开始一次长流程，返回记录 id */
    begin(input: { commandId: string; project?: string; source?: 'agent' | 'ui'; label?: string; at?: number }): string {
        const commandId = String(input.commandId || '').trim();
        this.seq += 1;
        const record: CommandRunRecord = {
            id: `run_${this.seq}`,
            commandId: commandId || 'unknown',
            label: clampText(input.label, 60),
            project: String(input.project || '').trim(),
            source: input.source === 'agent' ? 'agent' : 'ui',
            startedAt: input.at ?? Date.now(),
            status: 'running',
        };
        this.records.unshift(record);
        this.trim();
        return record.id;
    }

    /** 结束一次长流程（成功或失败）；记录不存在时返回 false */
    finish(
        id: string,
        outcome: { status?: 'done' | 'failed'; detail?: string; failure?: string; settlement?: SettlementSummary; at?: number } = {},
    ): boolean {
        const record = this.records.find(item => item.id === id);
        if (!record) return false;
        const status = outcome.status === 'failed' || (!outcome.status && outcome.failure) ? 'failed' : 'done';
        record.status = status;
        record.finishedAt = outcome.at ?? Date.now();
        record.detail = clampText(outcome.detail);
        record.failure = clampText(outcome.failure);
        if (outcome.settlement) record.settlement = outcome.settlement;
        return true;
    }

    /** 一步登记「已完成」的流程（导出/看板等没有明确开始点的场景） */
    recordCompleted(input: {
        commandId: string;
        project?: string;
        source?: 'agent' | 'ui';
        label?: string;
        detail?: string;
        settlement?: SettlementSummary;
        at?: number;
    }): string {
        const id = this.begin(input);
        this.finish(id, { status: 'done', detail: input.detail, settlement: input.settlement, at: input.at });
        return id;
    }

    /** 一步登记「失败」的流程（派发失败/立即抛错的场景） */
    recordFailed(input: {
        commandId: string;
        project?: string;
        source?: 'agent' | 'ui';
        label?: string;
        failure: string;
        at?: number;
    }): string {
        const id = this.begin(input);
        this.finish(id, { status: 'failed', failure: input.failure, at: input.at });
        return id;
    }

    /** 绑定结算摘要到指定记录；未给 id 时取该项目最近一条结算类记录 */
    attachSettlement(idOrProject: string, settlement: SettlementSummary): boolean {
        const record = this.records.find(item => item.id === idOrProject)
            || this.records.find(item => item.project === idOrProject && /settle/i.test(item.commandId))
            || this.records[0];
        if (!record) return false;
        record.settlement = settlement;
        return true;
    }

    /** 最近 N 条（新的在前；不传则全部，最多 20） */
    getRecent(limit = MAX_RECORDS): CommandRunRecord[] {
        const count = Math.max(0, Math.min(MAX_RECORDS, Math.round(limit)));
        return this.records.slice(0, count).map(record => ({ ...record }));
    }

    /** 仍在运行的记录 */
    getRunning(): CommandRunRecord[] {
        return this.records.filter(record => record.status === 'running').map(record => ({ ...record }));
    }

    /** 是否有任何记录（工作台/测试用） */
    get isEmpty(): boolean {
        return this.records.length === 0;
    }

    clear(): void {
        this.records = [];
        this.seq = 0;
    }

    private trim(): void {
        if (this.records.length > MAX_RECORDS) {
            this.records = this.records.slice(0, MAX_RECORDS);
        }
    }
}

let singleton: ExecutionLedger | null = null;

/** 插件级单例（UI 埋点与 Agent 端口共用同一实例） */
export function getExecutionLedger(): ExecutionLedger {
    if (!singleton) singleton = new ExecutionLedger();
    return singleton;
}

/** 测试用：丢弃单例 */
export function resetExecutionLedger(): void {
    singleton = null;
}

/** 记录时长（毫秒；未结束时返回 undefined） */
export function runDurationMs(record: CommandRunRecord): number | undefined {
    if (typeof record.finishedAt !== 'number') return undefined;
    return Math.max(0, record.finishedAt - record.startedAt);
}

/** 一行摘要（Agent 工具与执行日志共用口径） */
export function formatRunRecord(record: CommandRunRecord): string {
    const statusText = record.status === 'running' ? '进行中' : record.status === 'done' ? '完成' : '失败';
    const duration = runDurationMs(record);
    const parts = [
        `${statusText} · ${record.commandId}${record.project ? ` · ${record.project}` : ''}`,
        duration === undefined ? '' : `耗时 ${Math.round(duration / 1000)}s`,
        record.detail ? `说明：${record.detail}` : '',
        record.failure ? `失败：${record.failure}` : '',
    ].filter(Boolean);
    if (record.settlement) {
        const s = record.settlement;
        const settlementParts = [
            `更新 ${s.updated}`,
            `新建 ${s.created}`,
            `伏笔推进 ${s.updatedForeshadows}`,
        ];
        if (s.missingEntities > 0) settlementParts.push(`搁置 ${s.missingEntities}`);
        if (s.rejected > 0) settlementParts.push(`拒绝字段 ${s.rejected}`);
        if (s.linkFieldWrites > 0) settlementParts.push(`链接化 ${s.linkFieldWrites}`);
        if (s.recordedBehaviors > 0) settlementParts.push(`出场记录 ${s.recordedBehaviors}`);
        if (s.foreshadowLoop) settlementParts.push(`伏笔闭环 ${s.foreshadowLoop.pass ? '通过' : '未通过'}`);
        parts.push(`结算：${settlementParts.join('、')}`);
    }
    return parts.join('；');
}