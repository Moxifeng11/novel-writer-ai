/**
 * pet-activity.ts — 桌宠「正在运行什么功能」的活动信号总线
 *
 * 背景：桌宠帧不应自动循环播放，而应跟随**真实运行状态**切换：
 * 正在写作 / AI 思考 / 刚完成（开心）/ 出错。各层（引擎、正文写入、结算）
 * 不直接依赖 UI 宠物实例，统一往这里打标记；宠物轮询/订阅后切对应帧。
 *
 * TTL 语义：每个活动有超时窗口，超过后自动失效，避免「一直显示思考中」。
 */

/** 桌宠可识别的运行状态 */
export type PetActivityKind = 'writing' | 'thinking' | 'happy' | 'error';

/** 一条活动标记 */
export interface PetActivityMark {
    kind: PetActivityKind;
    /** 失效时间（毫秒时间戳） */
    until: number;
}

/** 优先级：出错 > 写作 > 思考 > 开心（同时命中时展示最需要用户注意的） */
const PRIORITY: Record<PetActivityKind, number> = {
    error: 4,
    writing: 3,
    thinking: 2,
    happy: 1,
};

const marks: PetActivityMark[] = [];
const listeners = new Set<(kind: PetActivityKind | null) => void>();

/** 当前对外可见的活动（null = 无活动） */
let visible: PetActivityKind | null = null;

/**
 * 计算当前应展示的活动（纯函数，便于测试）。
 *
 * @param marks - 全部标记
 * @param now - 当前时间戳
 * @returns 命中的最高优先级活动
 */
export function resolvePetActivity(marks: readonly PetActivityMark[], now: number): PetActivityKind | null {
    let best: PetActivityKind | null = null;
    for (const mark of marks) {
        if (mark.until <= now) continue;
        if (!best || PRIORITY[mark.kind] > PRIORITY[best]) best = mark.kind;
    }
    return best;
}

/** 通知订阅者（仅当对外可见值变化时） */
function flush(now = Date.now()): void {
    for (let i = marks.length - 1; i >= 0; i -= 1) {
        if (marks[i].until <= now) marks.splice(i, 1);
    }
    const next = resolvePetActivity(marks, now);
    if (next === visible) return;
    visible = next;
    for (const listener of listeners) {
        try {
            listener(next);
        } catch {
            // silent-ok: 订阅方异常不影响其它订阅者
        }
    }
}

/**
 * 打一个活动标记（覆盖同类的旧标记，保留不同类叠加）。
 *
 * @param kind - 活动类型
 * @param ttlMs - 有效时长（默认按类型给合理值）
 */
export function markPetActivity(kind: PetActivityKind, ttlMs?: number): void {
    const table: Record<PetActivityKind, number> = {
        writing: 8000,
        thinking: 20000,
        happy: 4000,
        error: 5000,
    };
    const ttl = Number.isFinite(ttlMs) && (ttlMs ?? 0) > 0 ? Number(ttlMs) : table[kind];
    const now = Date.now();
    for (let i = marks.length - 1; i >= 0; i -= 1) {
        if (marks[i].kind === kind) marks.splice(i, 1);
    }
    marks.push({ kind, until: now + ttl });
    flush(now);
}

/**
 * 主动清除某类标记（例如 AI 调用结束立即回到常规状态）。
 *
 * @param kind - 活动类型
 */
export function clearPetActivity(kind: PetActivityKind): void {
    for (let i = marks.length - 1; i >= 0; i -= 1) {
        if (marks[i].kind === kind) marks.splice(i, 1);
    }
    flush();
}

/**
 * 当前应展示的活动（顺带清理过期标记）。
 *
 * @returns 活动类型或 null
 */
export function getActivePetActivity(): PetActivityKind | null {
    flush();
    return visible;
}

/**
 * 订阅活动变化（只在可见活动改变时回调）。
 *
 * @param listener - 回调
 * @returns 取消订阅函数
 */
export function subscribePetActivity(listener: (kind: PetActivityKind | null) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 测试用：清空所有标记与订阅 */
export function resetPetActivity(): void {
    marks.length = 0;
    visible = null;
    listeners.clear();
}
