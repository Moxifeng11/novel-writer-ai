/**
 * session-snapshot.ts — 会话快照序列化（纯函数）
 *
 * 吸收 dsh `session-persistence-jsonl` / `session-title`：
 * 会话日志 + 记忆槽位 + 创作计划落盘到 `.sessions/agent/<项目>.jsonl`，
 * 重新打开工作台时恢复，而不是每次都从「会话开始」重来。
 *
 * 这里只做「快照 ↔ JSON 文本」的纯转换；写盘节流与文件管理在宿主侧。
 */
import type { AgentSessionEvent } from './harness-types';
import type { PlanStep, PlanStepStatus } from './creation-plan';
import { PLAN_STEP_STATUSES } from './creation-plan';

/**
 * 会话快照格式版本。
 */
export const SESSION_SNAPSHOT_VERSION = 1;

/**
 * Harness 会话快照。
 */
export interface HarnessSessionSnapshot {
    version: number;
    title: string;
    events: AgentSessionEvent[];
    callSeq: number;
    memory: Record<string, unknown>;
    plan: PlanStep[];
    updatedAt: number;
}

/**
 * 快照构建输入。
 */
export interface SnapshotInput {
    events: readonly AgentSessionEvent[];
    callSeq: number;
    memory: Readonly<Record<string, unknown>>;
    plan: readonly PlanStep[];
    now?: number;
}

/** 会话标题：首条用户消息前 30 字（跳过系统注入的「会话开始」占位） */
export function sessionTitleOf(events: readonly AgentSessionEvent[]): string {
    for (const event of events) {
        if (event.type !== 'user_message') continue;
        const text = String(event.text || '').trim();
        if (!text || text.startsWith('（会话开始')) continue;
        return text.length > 30 ? `${text.slice(0, 30)}…` : text;
    }
    return '新会话';
}

export function buildSessionSnapshot(input: SnapshotInput): HarnessSessionSnapshot {
    const events = input.events.map(event => ({ ...event }));
    return {
        version: SESSION_SNAPSHOT_VERSION,
        title: sessionTitleOf(events),
        events,
        callSeq: Math.max(0, Math.round(input.callSeq)),
        memory: { ...input.memory },
        plan: input.plan.map(step => ({ ...step })),
        updatedAt: input.now ?? Date.now(),
    };
}

function isEvent(value: unknown): value is AgentSessionEvent {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' && [
        'system_message', 'user_message', 'context_message', 'assistant_message',
        'summary', 'tool_call', 'tool_result', 'turn_marker',
    ].includes(type);
}

/** 宽容解析：坏字段丢弃，整条不可用返回 null（不允许坏存档把工作台打挂） */
export function parseSessionSnapshot(text: string): HarnessSessionSnapshot | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (!data || typeof data !== 'object') return null;
        const version = Number(data.version);
        if (!Number.isFinite(version) || version > SESSION_SNAPSHOT_VERSION) return null;
        const events = Array.isArray(data.events) ? data.events.filter(isEvent) : [];
        const plan: PlanStep[] = Array.isArray(data.plan)
            ? data.plan
                .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
                .map(step => {
                    const status = String(step.status || '');
                    return {
                        step: String(step.step || '').slice(0, 200),
                        status: (PLAN_STEP_STATUSES as string[]).includes(status) ? status as PlanStepStatus : 'pending',
                    };
                })
                .filter(step => step.step.length > 0)
            : [];
        const memory = data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory)
            ? { ...(data.memory as Record<string, unknown>) }
            : {};
        const callSeq = Number(data.callSeq);
        return {
            version: SESSION_SNAPSHOT_VERSION,
            title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 60) : sessionTitleOf(events),
            events,
            callSeq: Number.isFinite(callSeq) && callSeq > 0 ? Math.floor(callSeq) : deriveCallSeq(events),
            memory,
            plan,
            updatedAt: Number(data.updatedAt) || 0,
        };
    } catch {
        return null;
    }
}

/** 从 tool_call 的 callId（`call_<n>_<tool>`）反推计数器，修复缺失的 callSeq */
export function deriveCallSeq(events: readonly AgentSessionEvent[]): number {
    let max = 0;
    for (const event of events) {
        if (event.type !== 'tool_call') continue;
        const match = /^call_(\d+)_/.exec(event.callId);
        if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return max;
}

/** JSONL 存档的最后一行为最新快照；坏行跳过 */
export function parseSnapshotFromJsonl(content: string): HarnessSessionSnapshot | null {
    const lines = String(content || '').split(/\r?\n/).filter(line => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
        const snapshot = parseSessionSnapshot(lines[i]);
        if (snapshot) return snapshot;
    }
    return null;
}