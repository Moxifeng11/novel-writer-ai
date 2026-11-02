/**
 * insert-range.ts — 协同写作「插入位置」解析
 *
 * 采纳建议有两种来源：
 * 1. 普通建议 / 联想：插到当前光标（有选区则替换选区）；
 * 2. 改写候选：必须替换**发起改写时的那段选区**——候选生成后用户可能
 *    点过别处，用当前光标会把改写结果插到错误位置，原文还留在原地。
 *
 * 旧实现里视图声明了 `pendingRewriteRange` 但从未写入，采纳一律读当前光标；
 * 浮窗则相反——旧改写范围从不清空，普通建议会拿它去替换一段无关正文。
 * 这里把「用哪个区间」收敛成一个纯函数，两边共用。
 */

export interface PendingRewriteRange {
    start: number;
    end: number;
    /** 发起改写时该区间的原文，用于确认区间没被改动 */
    originalText: string;
}

/**
 * ResolveInsertRangeInput 类型定义。
 */
export interface ResolveInsertRangeInput {
    /** 当前正文 */
    text: string;
    /** 编辑器当前选区起点 */
    selectionStart: number;
    /** 编辑器当前选区终点（等于起点表示无选区） */
    selectionEnd: number;
    /** 改写候选对应的原选区；普通建议传 null */
    pendingRewrite?: PendingRewriteRange | null;
}

/**
 * ResolvedInsertRange 类型定义。
 */
export interface ResolvedInsertRange {
    start: number;
    end: number;
    /** true 表示使用改写区间（而不是当前光标） */
    fromPendingRewrite: boolean;
    /** true 表示改写区间已失效（原文被改动），已回退到当前选区 */
    staleRewrite: boolean;
}

/**
 * resolveInsertRange 函数。
 * @param input - 输入
  * @returns ResolvedInsertRange 实例
 */
export function resolveInsertRange(input: ResolveInsertRangeInput): ResolvedInsertRange {
    const { text, selectionStart, selectionEnd, pendingRewrite } = input;
    const length = text.length;
    const clamp = (value: number): number => {
        if (!Number.isFinite(value)) return length;
        return Math.max(0, Math.min(Math.trunc(value), length));
    };

    if (pendingRewrite) {
        const start = clamp(pendingRewrite.start);
        const end = clamp(pendingRewrite.end);
        if (end > start) {
            const unchanged = text.slice(start, end) === pendingRewrite.originalText;
            if (unchanged) {
                return { start, end, fromPendingRewrite: true, staleRewrite: false };
            }
            const fallbackStart = clamp(selectionStart);
            return {
                start: fallbackStart,
                end: Math.max(fallbackStart, clamp(selectionEnd)),
                fromPendingRewrite: false,
                staleRewrite: true,
            };
        }
    }

    const start = clamp(selectionStart);
    return {
        start,
        end: Math.max(start, clamp(selectionEnd)),
        fromPendingRewrite: false,
        staleRewrite: false,
    };
}
