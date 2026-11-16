/**
 * editor-display.ts — 编辑器显示参数与光标信息（2026-11-16，E-06 / E-10）
 *
 * 背景：只能选字体，不能调字号/行距；状态栏也没有光标位置与选中字数。
 * 这里集中管理取值范围、CSS 应用与文案格式化，便于单测。
 */

/** 字号可选值（px） */
export const FONT_SIZE_OPTIONS: readonly number[] = [14, 15, 16, 17, 18, 20, 22, 24];

/** 行距可选值 */
export const LINE_HEIGHT_OPTIONS: readonly number[] = [1.4, 1.6, 1.8, 2, 2.2];

/** 默认字号 */
export const DEFAULT_FONT_SIZE = 16;

/** 默认行距 */
export const DEFAULT_LINE_HEIGHT = 1.8;

/**
 * 归一化字号（不在可选列表时取最近的合法值）。
 *
 * @param value - 用户设置值
 * @returns 合法字号
 * @example
 * normalizeFontSize(19); // 18
 */
export function normalizeFontSize(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_FONT_SIZE;
    if (FONT_SIZE_OPTIONS.includes(numeric)) return numeric;
    const clamped = Math.min(Math.max(numeric, FONT_SIZE_OPTIONS[0]), FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1]);
    return FONT_SIZE_OPTIONS.reduce((best, option) =>
        Math.abs(option - clamped) < Math.abs(best - clamped) ? option : best, FONT_SIZE_OPTIONS[0]);
}

/**
 * 归一化行距（不在可选列表时取最近的合法值）。
 *
 * @param value - 用户设置值
 * @returns 合法行距
 * @example
 * normalizeLineHeight(1.7); // 1.6 或 1.8（取更近者）
 */
export function normalizeLineHeight(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_LINE_HEIGHT;
    if (LINE_HEIGHT_OPTIONS.includes(numeric)) return numeric;
    return LINE_HEIGHT_OPTIONS.reduce((best, option) =>
        Math.abs(option - numeric) < Math.abs(best - numeric) ? option : best, LINE_HEIGHT_OPTIONS[0]);
}

/**
 * 应用字号/行距到编辑器与镜像层（三层必须一致，否则高亮层会错位）。
 *
 * @param targets - 目标元素（编辑器 / 幽灵层 / 预览 / 高亮镜像层）
 * @param fontSize - 字号（px）
 * @param lineHeight - 行距倍数
 * @example
 * applyEditorMetrics({ editor, backdrop }, 16, 1.8);
 */
export function applyEditorMetrics(
    targets: { editor: HTMLElement | null; ghost?: HTMLElement | null; preview?: HTMLElement | null; backdrop?: HTMLElement | null },
    fontSize: number,
    lineHeight: number,
): void {
    const size = normalizeFontSize(fontSize);
    const height = normalizeLineHeight(lineHeight);
    for (const el of [targets.editor, targets.ghost, targets.preview, targets.backdrop]) {
        if (!el) continue;
        el.style.fontSize = `${size}px`;
        el.style.lineHeight = String(height);
    }
}

/**
 * 计算光标所在行列（1 起）。
 *
 * @param text - 正文
 * @param offset - 光标偏移
 * @returns 行、列（列按字符计，不是像素）
 * @example
 * getCursorPosition("ab\ncd", 4); // { line: 2, column: 2 }
 */
export function getCursorPosition(text: string, offset: number): { line: number; column: number } {
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, text.length));
    const before = text.slice(0, safeOffset);
    const line = before.split('\n').length;
    const lastBreak = before.lastIndexOf('\n');
    const column = safeOffset - lastBreak;
    return { line, column };
}

/**
 * 选中字数（去首尾空白的字符数）。
 *
 * @param text - 正文
 * @param start - 选区起点
 * @param end - 选区终点
 * @returns 选中字符数；无选区返回 0
 * @example
 * getSelectionCount("abcdef", 0, 3); // 3
 */
export function getSelectionCount(text: string, start: number, end: number): number {
    const from = Math.max(0, Math.min(start, end));
    const to = Math.min(text.length, Math.max(start, end));
    if (to <= from) return 0;
    return to - from;
}

/**
 * 光标信息文案（状态栏用）。
 *
 * @param text - 正文
 * @param start - 选区起点
 * @param end - 选区终点
 * @returns 文案，如「第 3 行 第 12 列」或「第 3 行 第 12 列 · 选中 25 字」
 * @example
 * formatCursorInfo("ab", 0, 0); // '第 1 行 第 1 列'
 */
export function formatCursorInfo(text: string, start: number, end: number): string {
    const position = getCursorPosition(text, start);
    const base = `第 ${position.line} 行 第 ${position.column} 列`;
    const selected = getSelectionCount(text, start, end);
    return selected > 0 ? `${base} · 选中 ${selected} 字` : base;
}
