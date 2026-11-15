/**
 * rebuild-guard.ts — 「重建章节」覆盖判定（对抗审查 P1）
 *
 * 背景：重建章节把「信息规划 ≤150 字 / 大纲 <100 字」一律当骨架整篇覆盖，
 * 会吃掉用户手写的短稿。数据安全优先：只有「空内容或明确占位符」才算骨架，
 * 其余一律保留（宁可少重建，也不覆盖用户内容）。
 */

/** 模板占位符标记（命中任一即视为未填写的骨架） */
const PLACEHOLDER_MARKERS = [
    '（待定）',
    '待定）',
    '（待 auto_writer',
    '（待填写）',
    '请填写',
    'TODO',
    '本节待补充',
    '此处填写',
] as const;

/**
 * 内容是否只是模板占位（可安全重建）。
 *
 * @param body - 去掉 frontmatter 的正文
 * @returns 是否可重建
 */
export function isRebuildableSkeleton(body: string): boolean {
    const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) return true;
    return PLACEHOLDER_MARKERS.some(marker => text.includes(marker));
}

/**
 * 是否必须保留既有内容（非占位即保留）。
 *
 * @param body - 去掉 frontmatter 的正文
 * @returns 是否保留
 */
export function shouldPreserveExisting(body: string): boolean {
    return !isRebuildableSkeleton(body);
}
