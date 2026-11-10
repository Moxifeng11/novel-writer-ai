/**
 * reload-state.ts — 热重载工作台状态的跨实例交接
 *
 * 背景（O-3）：设置页承诺「关闭再启用后工作台状态会自动恢复」，但旧实现只把
 * `_pendingReloadState` 放在内存字段里；disable 后旧实例被销毁，enable 出来的
 * 新实例读到的是 null，承诺从未兑现。
 *
 * 口径：
 * - 用 **sessionStorage** 而不是 data.json：这是同一窗口内的一次性交接，
 *   不该进入设置同步/云盘；窗口关闭即消失。
 * - 带 10 分钟 TTL：用户点完按钮却没去重载时，不会在很久以后突然弹出工作台。
 * - 读取即删除（consume）：一次性消费，避免每次 enable 都重复恢复。
 */

/** 热重载后要恢复的工作台位置 */
export interface PendingReloadState {
    project: string;
    chapterFileName: string;
    volume?: string;
    chapDir?: string;
}

/** 交接有效期：覆盖「打开设置 → 找到第三方插件 → 关闭 → 启用」的操作时间 */
export const PENDING_RELOAD_TTL_MS = 10 * 60 * 1000;

const STORAGE_KEY = 'nw:pending-reload:v1';

function getSessionStorage(): Storage | null {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        // 隐私模式/沙箱下访问 sessionStorage 可能直接抛错
        return null;
    }
}

/**
 * 保存待恢复状态（disable 之前调用）。
 *
 * 存储不可用时静默降级为「不恢复」，不影响重载本身。
 *
 * @param state - 工作台位置
 *
 * @example
 * savePendingReloadState({ project: '长篇小说/书', chapterFileName: '第1章' });
 */
export function savePendingReloadState(state: PendingReloadState): void {
    const storage = getSessionStorage();
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ state, savedAt: Date.now() }));
    } catch {
        // 配额/禁用存储：放弃恢复，不阻断用户操作
    }
}

/**
 * 取出并清除待恢复状态（新实例 onload 调用）。
 *
 * @param now - 当前时间戳（测试注入用）
 * @returns 未过期且结构合法的状态；否则 null
 *
 * @example
 * const state = consumePendingReloadState();
 * if (state) this._pendingReloadState = state;
 */
export function consumePendingReloadState(now: number = Date.now()): PendingReloadState | null {
    const storage = getSessionStorage();
    if (!storage) return null;
    let raw: string | null = null;
    try {
        raw = storage.getItem(STORAGE_KEY);
        storage.removeItem(STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as { state?: Partial<PendingReloadState>; savedAt?: unknown };
        const savedAt = parsed.savedAt;
        if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
        // 过期或时间戳明显来自未来（改系统时钟）都不恢复
        if (now - savedAt > PENDING_RELOAD_TTL_MS || savedAt - now > 60_000) return null;
        const project = String(parsed.state?.project || '');
        if (!project) return null;
        return {
            project,
            chapterFileName: String(parsed.state?.chapterFileName || ''),
            volume: parsed.state?.volume ? String(parsed.state.volume) : undefined,
            chapDir: parsed.state?.chapDir ? String(parsed.state.chapDir) : undefined,
        };
    } catch {
        return null;
    }
}
