/**
 * shared/ghost-trigger.ts — 协同自动联想（幽灵建议）的触发间隔（纯函数）
 *
 * 自动联想在输入停顿 1.5 秒后触发，尾部种子多一个字就会重新请求；
 * 慢速打字时等于每隔一两秒发一次 AI 请求。这里只负责「距上次请求是否已过最小间隔」，
 * 其余触发条件（正文长度、光标是否在尾部、在途请求、已有建议）仍由视图判断。
 */

/**
 * 是否已过最小请求间隔。
 * `lastRequestAt <= 0` 视为「尚未请求过」，立即放行；`minIntervalMs <= 0` 关闭限频。
 * @param now - 当前时间
 * @param lastRequestAt - 上次请求时间
 * @param minIntervalMs - 最小间隔（毫秒）
 * @returns 是否成功
 */
export function shouldRequestGhostAssociationByInterval(
    now: number,
    lastRequestAt: number,
    minIntervalMs: number,
): boolean {
    if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) return true;
    if (!Number.isFinite(lastRequestAt) || lastRequestAt <= 0) return true;
    return now - lastRequestAt >= minIntervalMs;
}
