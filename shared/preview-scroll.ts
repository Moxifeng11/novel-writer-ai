/**
 * shared/preview-scroll.ts — 协同写作右侧预览区的滚动锚点（纯函数）
 *
 * 预览区每次输入后都会全量重渲染（`refreshPreview` → `empty()` + MarkdownRenderer），
 * 重建 DOM 会让 `scrollTop` 归零：用户向下翻看前文时一打字就被拉回顶部。
 * 渲染前记录锚点、渲染后按锚点恢复；原本贴底则继续贴底，跟随最新正文。
 */

export interface ScrollSnapshot {
    /** 归一化后的滚动位置 */
    top: number;
    /** 渲染前是否已贴近底部（应继续跟随最新内容） */
    atBottom: boolean;
}

/** 距底部多近算「贴底」 */
export const PREVIEW_BOTTOM_THRESHOLD_PX = 32;

/**
 * 渲染前抓取滚动锚点。
 * 传入值可能超出可滚动范围（内容刚被删减），先夹紧再判断贴底。
 * @param top - 顶部
 * @param scrollHeight - 滚动高度
 * @param clientHeight - 客户端高度
 * @param threshold - 阈值
  * @returns ScrollSnapshot 实例
 */
export function captureScrollSnapshot(
    top: number,
    scrollHeight: number,
    clientHeight: number,
    threshold: number = PREVIEW_BOTTOM_THRESHOLD_PX,
): ScrollSnapshot {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const normalizedTop = Math.max(0, Math.min(top, maxScrollTop));
    return {
        top: normalizedTop,
        atBottom: maxScrollTop - normalizedTop <= threshold,
    };
}

/**
 * 渲染后计算应恢复到哪个滚动位置。
 * 内容变长时保持原绝对位置（用户看的那段不动）；变短时夹紧到新的最大滚动值。
 * @param snapshot - 快照
 * @param scrollHeight - 滚动高度
 * @param clientHeight - 客户端高度
 * @returns 数值结果
 */
export function resolveRestoredScrollTop(
    snapshot: ScrollSnapshot,
    scrollHeight: number,
    clientHeight: number,
): number {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (snapshot.atBottom) return maxScrollTop;
    return Math.max(0, Math.min(snapshot.top, maxScrollTop));
}
