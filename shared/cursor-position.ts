/**
 * shared/cursor-position.ts — 编辑器光标位置的归一化（纯函数）
 *
 * `textarea.selectionStart` 在「光标在最开头」时是 0，与「没有光标信息」用 `||` 判断
 * 会被一起当成假值：于是插入建议插到文末、自动联想按文末取种子、上下文取成整章。
 * 这里只负责把原始值归一化到 [0, 正文长度]，是否回退到文末由调用方显式声明。
 */

export type CursorFallback = 'start' | 'end';

/**
 * 归一化光标位置。
 * - `null` / `undefined` / 非有限数 → 按 `fallback` 回退到开头或文末；
 * - 其余值夹紧到 [0, 正文长度]（`0` 是合法光标位置，不再回退到文末）。
 * @param selectionStart - 选区起始
 * @param textLength - 文本长度
 * @param fallback - 回退值
 * @returns 数值结果
 */
export function resolveCursorPosition(
    selectionStart: number | null | undefined,
    textLength: number,
    fallback: CursorFallback = 'end',
): number {
    const length = Number.isFinite(textLength) && textLength > 0 ? Math.floor(textLength) : 0;
    if (selectionStart === null || selectionStart === undefined || !Number.isFinite(selectionStart)) {
        return fallback === 'end' ? length : 0;
    }
    return Math.min(length, Math.max(0, Math.floor(selectionStart)));
}
