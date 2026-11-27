/**
 * generate-confirm-format.ts — 生成确认弹窗的纯格式化逻辑（2026-11-27）
 *
 * 从 `generate-confirm-modal.ts` 抽出：判定与格式化是纯函数，与 DOM 无关。
 * 抽出的理由：视图文件超过 200 行且没有单测会被门禁拦下；
 * 把逻辑抽成纯函数后可以独立单测（本仓 `kb-format.ts` 是同样做法）。
 */
import { t } from '@/i18n';

/** 预览截断长度（超过则只显示前 N 字） */
export const PREVIEW_LIMIT = 1200;

/**
 * 判定某次写入是否需要用户确认。
 *
 * - `off`：永不确认（直接写）
 * - `overwrite`：仅当目标文件已存在时确认（新建章节不打扰）
 * - `always`：每次都确认
 *
 * @param mode - 设置项
 * @param targetExists - 目标正文文件是否已存在
 * @returns 是否需要确认
 * @example
 * needsConfirm('overwrite', false) // false —— 新建章节，不打扰
 * needsConfirm('overwrite', true)  // true  —— 会覆盖原稿，确认
 * needsConfirm('always', false)    // true
 */
export function needsConfirm(
    mode: 'off' | 'overwrite' | 'always' | undefined,
    targetExists: boolean,
): boolean {
    const m = mode ?? 'overwrite';
    if (m === 'off') return false;
    if (m === 'always') return true;
    return targetExists;
}

/**
 * 截断预览文本。
 *
 * @param text - 完整正文
 * @param limit - 上限（默认 PREVIEW_LIMIT）
 * @returns 截断后的文本与是否发生截断
 * @example
 * truncatePreview('abc', 10) // { text: 'abc', truncated: false }
 */
export function truncatePreview(text: string, limit = PREVIEW_LIMIT): { text: string; truncated: boolean } {
    if (text.length <= limit) return { text, truncated: false };
    return { text: text.slice(0, limit), truncated: true };
}

/**
 * 格式化字数变化描述。
 *
 * @param newWords - 新字数
 * @param oldChars - 原字数（近似）
 * @returns 变化描述（如 `+120` / `-56` / `基本持平`）
 * @example
 * formatDelta(2650, 2500) // '+150'
 * formatDelta(2505, 2500) // '基本持平'
 */
export function formatDelta(newWords: number, oldChars: number): string {
    const delta = newWords - oldChars;
    if (Math.abs(delta) < 20) return t('cowrite.generateConfirm.deltaSame');
    return delta > 0 ? `+${delta}` : String(delta);
}
