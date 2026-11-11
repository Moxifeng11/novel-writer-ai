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
import { MEMORY_SLOT_KEYS } from './harness-types';
import type { PlanStep, PlanStepStatus } from './creation-plan';
import { PLAN_STEP_STATUSES } from './creation-plan';

/** 恢复时接受的最大事件条数（防篡改存档塞入超长历史撑爆上下文） */
export const MAX_RESTORED_EVENTS = 2000;

/**
 * 会话快照格式版本。
 */
export const SESSION_SNAPSHOT_VERSION = 1;

/**
 * 快照创建时的项目上下文签名：用于判断旧存档是否仍属于当前 vault 状态。
 */
export interface SessionContextSignature {
    projects: readonly string[];
    activeProject?: string | null;
}

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
    /** 创建快照时的项目集合；旧档没有该字段，恢复时按开场事件兜底校验 */
    context?: SessionContextSignature;
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
    /** 当前项目上下文；用于恢复时判断快照是否已过期 */
    context?: SessionContextSignature;
}

/**
 * 会话标题：首条用户消息前 30 字（跳过系统注入的「会话开始」占位）
 *
 * @param events - 事件列表
 * @returns 文本结果
 */
export function sessionTitleOf(events: readonly AgentSessionEvent[]): string {
    for (const event of events) {
        if (event.type !== 'user_message') continue;
        const text = String(event.text || '').trim();
        if (!text || text.startsWith('（会话开始')) continue;
        return text.length > 30 ? `${text.slice(0, 30)}…` : text;
    }
    return '新会话';
}

/**
 * 构造可恢复的会话快照。
 *
 * 事件、记忆与计划都会做浅拷贝，调用方后续修改原对象不会污染快照。
 *
 * @param input - 快照输入（事件、调用序号、记忆、计划）
 * @returns 带版本号的会话快照
 */
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
        ...(input.context
            ? {
                context: {
                    projects: [...input.context.projects],
                    activeProject: input.context.activeProject ?? null,
                },
            }
            : {}),
    };
}

function sameProjectSet(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every(item => set.has(item));
}

/**
 * 快照是否仍与当前项目状态匹配。
 *
 * 旧档没有 `context` 时，解析首条「（会话开始。用户有 N 个项目）」占位；
 * 与当前项目数量不符即拒绝恢复，避免把已删除项目的欢迎语重新上屏。
 *
 * @param snapshot - 已解析快照
 * @param current - 当前项目上下文
 * @returns 是否可恢复
 */
export function snapshotMatchesContext(
    snapshot: HarnessSessionSnapshot,
    current: SessionContextSignature,
): boolean {
    if (snapshot.context) {
        return sameProjectSet(snapshot.context.projects, current.projects)
            && (snapshot.context.activeProject ?? null) === (current.activeProject ?? null);
    }
    const startup = snapshot.events.find(
        (event): event is Extract<AgentSessionEvent, { type: 'user_message' }> =>
            event.type === 'user_message' && event.text.trim().startsWith('（会话开始'),
    );
    if (!startup) return true;
    const countMatch = /用户有\s*(\d+)\s*个项目/.exec(startup.text);
    if (countMatch) return Number(countMatch[1]) === current.projects.length;
    if (startup.text.includes('用户还没有项目')) return current.projects.length === 0;
    return true;
}

function isEvent(value: unknown): value is AgentSessionEvent {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' && [
        'system_message', 'user_message', 'context_message', 'assistant_message',
        'summary', 'tool_call', 'tool_result', 'turn_marker',
    ].includes(type);
}

/**
 * 宽容解析：坏字段丢弃，整条不可用返回 null（不允许坏存档把工作台打挂）
 *
 * @param text - 文本内容
  * @returns HarnessSessionSnapshot 或 null
 */
export function parseSessionSnapshot(text: string): HarnessSessionSnapshot | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (!data || typeof data !== 'object') return null;
        const version = Number(data.version);
        if (!Number.isFinite(version) || version > SESSION_SNAPSHOT_VERSION) return null;
        // S3-19：条数上限（保留**最近**的若干条，因为恢复价值集中在尾部上下文）
        const events: AgentSessionEvent[] = Array.isArray(data.events)
            ? data.events.filter(isEvent).slice(-MAX_RESTORED_EVENTS)
            : [];
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
        const memoryRaw = data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory)
            ? { ...(data.memory as Record<string, unknown>) }
            : {};
        // S3-19（安全 r3）：存档可能被同步盘/本机篡改。只接受白名单槽位键——
        // 未知键原样恢复等于把攻击者数据预置进模型上下文。
        const memory: Record<string, unknown> = {};
        for (const key of MEMORY_SLOT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(memoryRaw, key)) {
                memory[key] = memoryRaw[key];
            }
        }
        const contextRaw = data.context && typeof data.context === 'object'
            ? data.context as Record<string, unknown>
            : null;
        const context = contextRaw
            ? {
                // S3-19：只接受非空字符串。旧实现 `String(item)` 会把 null/undefined
                // 变成 "null"/"undefined" 字符串混进项目列表，让「已删除项目」继续可解析。
                projects: Array.isArray(contextRaw.projects)
                    ? contextRaw.projects.filter((item): item is string => typeof item === 'string' && item.length > 0)
                    : [],
                activeProject: typeof contextRaw.activeProject === 'string' && contextRaw.activeProject
                    ? contextRaw.activeProject
                    : null,
            }
            : undefined;
        const callSeq = Number(data.callSeq);
        return {
            version: SESSION_SNAPSHOT_VERSION,
            title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 60) : sessionTitleOf(events),
            events,
            callSeq: Number.isFinite(callSeq) && callSeq > 0 ? Math.floor(callSeq) : deriveCallSeq(events),
            memory,
            plan,
            updatedAt: Number(data.updatedAt) || 0,
            ...(context ? { context } : {}),
        };
    } catch {
        return null;
    }
}

/**
 * 从 tool_call 的 callId（`call_<n>_<tool>`）反推计数器，修复缺失的 callSeq
 *
 * @param events - 事件列表
 * @returns 数值结果
 */
export function deriveCallSeq(events: readonly AgentSessionEvent[]): number {
    let max = 0;
    for (const event of events) {
        if (event.type !== 'tool_call') continue;
        const match = /^call_(\d+)_/.exec(event.callId);
        if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return max;
}

/**
 * JSONL 存档的最后一行为最新快照；坏行跳过
 *
 * @param content - 内容
  * @returns HarnessSessionSnapshot 或 null
 */
export function parseSnapshotFromJsonl(content: string): HarnessSessionSnapshot | null {
    const lines = String(content || '').split(/\r?\n/).filter(line => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
        const snapshot = parseSessionSnapshot(lines[i]);
        if (snapshot) return snapshot;
    }
    return null;
}