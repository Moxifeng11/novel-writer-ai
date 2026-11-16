/**
 * edit-history.ts — 编辑器撤销/重做栈（2026-11-16，E-04）
 *
 * 背景：协同视图只有 textarea 原生撤销，且换章/重开视图后丢失，
 * 误删一大段只能靠版本历史找回。
 *
 * 这里按「章节键」维护独立历史栈：换章再切回来，撤销栈仍在（会话内）。
 * 纯数据结构，不碰 DOM，便于穷举单测。
 */

/** 单章历史栈 */
export interface ChapterHistory {
    /** 已提交状态（从旧到新，最后一个 = 当前） */
    stack: string[];
    /** 重做指针：stack 中当前状态的下标 */
    index: number;
}

/** 每个章节最多保留的状态数（防止长章节吃内存） */
export const MAX_HISTORY_ENTRIES = 60;

/**
 * 创建空历史。
 *
 * @param initial - 初始正文
 * @returns 历史对象
 * @example
 * createHistory("")
 */
export function createHistory(initial = ''): ChapterHistory {
    return { stack: [initial], index: 0 };
}

/**
 * 提交一个新状态（会自动截断重做分支并限制长度）。
 *
 * 与当前状态相同则不记录，避免重复条目把栈撑满。
 *
 * @param history - 历史对象（就地修改）
 * @param next - 新正文
 * @returns 是否真的记录了
 * @example
 * pushHistory(history, "新内容");
 */
export function pushHistory(history: ChapterHistory, next: string): boolean {
    const current = history.stack[history.index];
    if (next === current) return false;
    // 丢弃重做分支
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(next);
    if (history.stack.length > MAX_HISTORY_ENTRIES) {
        history.stack = history.stack.slice(history.stack.length - MAX_HISTORY_ENTRIES);
    }
    history.index = history.stack.length - 1;
    return true;
}

/**
 * 撤销：返回上一个状态。
 *
 * @param history - 历史对象（就地修改）
 * @returns 上一个状态；已在最旧时返回 null
 * @example
 * undoHistory(history); // "上一版正文"
 */
export function undoHistory(history: ChapterHistory): string | null {
    if (history.index <= 0) return null;
    history.index -= 1;
    return history.stack[history.index];
}

/**
 * 重做：返回下一个状态。
 *
 * @param history - 历史对象（就地修改）
 * @returns 下一个状态；已在最新时返回 null
 * @example
 * redoHistory(history);
 */
export function redoHistory(history: ChapterHistory): string | null {
    if (history.index >= history.stack.length - 1) return null;
    history.index += 1;
    return history.stack[history.index];
}

/**
 * 是否可撤销 / 可重做。
 *
 * @param history - 历史对象
 * @returns 两态可用性
 * @example
 * canUndoRedo(history); // { canUndo: true, canRedo: false }
 */
export function canUndoRedo(history: ChapterHistory): { canUndo: boolean; canRedo: boolean } {
    return {
        canUndo: history.index > 0,
        canRedo: history.index < history.stack.length - 1,
    };
}

/**
 * 多章节历史仓库（会话内）：章节键 → 历史。
 *
 * @example
 * const store = new ChapterHistoryStore();
 * store.get('示例项目|第1章');
 */
export class ChapterHistoryStore {
    private readonly map = new Map<string, ChapterHistory>();

    /**
     * 取某章历史（不存在则按 initial 创建）。
     *
     * @param key - 章节键
     * @param initial - 初始正文
     * @returns 该章历史
     */
    get(key: string, initial = ''): ChapterHistory {
        const existing = this.map.get(key);
        if (existing) return existing;
        const created = createHistory(initial);
        this.map.set(key, created);
        return created;
    }

    /**
     * 是否存在某章历史。
     *
     * @param key - 章节键
     * @returns 是否存在
     */
    has(key: string): boolean {
        return this.map.has(key);
    }

    /**
     * 清空全部历史（视图关闭时）。
     */
    clear(): void {
        this.map.clear();
    }

    /**
     * 当前保存的章节数（诊断/测试用）。
     *
     * @returns 章节数
     */
    size(): number {
        return this.map.size;
    }
}
