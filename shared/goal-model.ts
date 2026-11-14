/**
 * goal-model.ts — 长任务目标（goal）模型（纯函数）
 *
 * goal 用于跨回合推进的长任务：记录目标、进度、证据与完成判定。
 * 落盘：<项目>/04-项目总控/goal/<id>.json
 */

/** 目标状态 */
export type GoalStatus = 'active' | 'completed' | 'blocked';

/** 目标进度项 */
export interface GoalProgressItem {
    /** 进展描述 */
    note: string;
    /** 证据（章节版本/文件路径/提交号） */
    evidence?: string;
    /** 时间 */
    at: number;
}

/** 目标定义 */
export interface GoalDefinition {
    version: 1;
    /** 目标 id */
    id: string;
    /** 标题 */
    title: string;
    /** 目标描述 */
    objective: string;
    /** 状态 */
    status: GoalStatus;
    /** 进度记录（按时间追加） */
    progress: GoalProgressItem[];
    /** 完成时间 */
    completedAt?: number;
    /** 阻塞原因 */
    blockedReason?: string;
    /** 创建时间 */
    createdAt: number;
}

/** 格式版本 */
export const GOAL_VERSION = 1 as const;

/** 最大进度条数（防止无限追加） */
export const GOAL_MAX_PROGRESS = 200;

/**
 * 生成 goal id。
 *
 * @param now - 时间戳
 * @returns id
 */
export function goalId(now: number = Date.now()): string {
    return `goal-${now.toString(36)}`;
}

/**
 * 创建目标。
 *
 * @param title - 标题
 * @param objective - 目标描述
 * @param now - 时间戳
 * @returns 目标
 */
export function createGoal(title: string, objective: string, now: number = Date.now()): GoalDefinition {
    return {
        version: GOAL_VERSION,
        id: goalId(now),
        title: String(title || '').trim() || '未命名目标',
        objective: String(objective || '').trim(),
        status: 'active',
        progress: [],
        createdAt: now,
    };
}

/**
 * 追加进度。
 *
 * @param goal - 目标
 * @param note - 进展
 * @param evidence - 证据
 * @param now - 时间戳
 * @returns 新目标（不修改入参）
 */
export function appendProgress(
    goal: GoalDefinition,
    note: string,
    evidence?: string,
    now: number = Date.now(),
): GoalDefinition {
    const item: GoalProgressItem = { note: String(note || '').trim(), at: now, ...(evidence ? { evidence: String(evidence).trim() } : {}) };
    const progress = [...goal.progress, item].slice(-GOAL_MAX_PROGRESS);
    return { ...goal, progress };
}

/**
 * 完成目标（必须有证据，防止空口宣告完成）。
 *
 * @param goal - 目标
 * @param evidence - 完成证据
 * @param now - 时间戳
 * @returns 结果：新目标或错误
 */
export function completeGoal(goal: GoalDefinition, evidence: string, now: number = Date.now()): { goal?: GoalDefinition; error?: string } {
    const proof = String(evidence || '').trim();
    if (!proof) return { error: '完成目标必须提供证据（章节版本/文件路径/提交号）' };
    if (goal.status === 'completed') return { error: '目标已完成' };
    return {
        goal: {
            ...goal,
            status: 'completed',
            completedAt: now,
            progress: [...goal.progress, { note: '目标完成', evidence: proof, at: now }].slice(-GOAL_MAX_PROGRESS),
        },
    };
}

/**
 * 标记阻塞。
 *
 * @param goal - 目标
 * @param reason - 阻塞原因
 * @returns 新目标
 */
export function blockGoal(goal: GoalDefinition, reason: string): GoalDefinition {
    return { ...goal, status: 'blocked', blockedReason: String(reason || '').trim() || '未说明原因' };
}

/**
 * 解析目标 JSON；损坏返回 null。
 *
 * @param raw - 原始 JSON
 * @returns 目标或 null
 */
export function parseGoal(raw: string): GoalDefinition | null {
    try {
        const parsed = JSON.parse(raw) as Partial<GoalDefinition>;
        if (parsed?.version !== GOAL_VERSION || !parsed.id || !parsed.title) return null;
        return {
            version: GOAL_VERSION,
            id: String(parsed.id),
            title: String(parsed.title),
            objective: String(parsed.objective ?? ''),
            status: parsed.status === 'completed' || parsed.status === 'blocked' ? parsed.status : 'active',
            progress: Array.isArray(parsed.progress) ? parsed.progress : [],
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
            ...(typeof parsed.completedAt === 'number' ? { completedAt: parsed.completedAt } : {}),
            ...(parsed.blockedReason ? { blockedReason: String(parsed.blockedReason) } : {}),
        };
    } catch {
        // silent-ok: 目标文件损坏等价于「没有目标」，不影响会话
        return null;
    }
}

/**
 * 渲染目标摘要（注入提示词/工具返回）。
 *
 * @param goal - 目标
 * @returns 文本
 */
export function renderGoal(goal: GoalDefinition): string {
    const status = goal.status === 'completed' ? '✅ 已完成' : goal.status === 'blocked' ? '⛔ 已阻塞' : '🔄 进行中';
    const lines = [`【目标】${goal.title}（${status}）`];
    if (goal.objective) lines.push(goal.objective);
    if (goal.progress.length > 0) {
        lines.push('进度：');
        for (const item of goal.progress.slice(-5)) {
            lines.push(`- ${item.note}${item.evidence ? `（证据：${item.evidence}）` : ''}`);
        }
    }
    if (goal.blockedReason) lines.push(`阻塞原因：${goal.blockedReason}`);
    return lines.join('\n');
}
