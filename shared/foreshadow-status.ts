/**
 * foreshadow-status.ts — 伏笔「是否已揭示」的唯一判定
 *
 * 历史问题：多处用 `status.includes('揭示')` 判断已揭示，而「未揭示」「待揭示」
 * 本身也包含「揭示」→ 未回收伏笔被误判为已揭示并跳过（上下文注入/信息债/
 * 结算统计/批量建章各有一份同样的写法）。这里先匹配否定词再匹配肯定词，
 * 并把「判定不明」与「已废弃」留给调用方按 unknown 统计。
 */

/** 伏笔揭示状态。 */
export type ForeshadowRevealState = 'revealed' | 'unrevealed' | 'unknown';

/** 否定语义优先：未揭示 / 待揭示 / 未回收 / 未兑现 / 埋设 / 铺垫中。 */
const UNREVEALED_PATTERN = /未揭示|待揭示|未回收|未兑现|埋设|铺垫中/;

/** 肯定语义：已揭示 / 已回收 / 已兑现 / 揭示 / 回收。 */
const REVEALED_PATTERN = /已揭示|已回收|已兑现|揭示|回收/;

/**
 * 解析伏笔状态。
 *
 * 规则（顺序很重要）：
 * 1. 空状态按「未揭示」处理（与旧统计口径一致）；
 * 2. 先匹配否定词——避免「未揭示」被「揭示」误伤；
 * 3. 再匹配肯定词；
 * 4. 其余（已废弃/已删除/自定义备注）返回 unknown，由调用方决定计入 abandoned 或忽略。
 *
 * @param status - 伏笔库表格里的状态文本
 * @returns 揭示状态
 *
 * @example
 * ```ts
 * parseForeshadowRevealState('未揭示'); // 'unrevealed'
 * parseForeshadowRevealState('待揭示'); // 'unrevealed'
 * parseForeshadowRevealState('已揭示'); // 'revealed'
 * parseForeshadowRevealState('已废弃'); // 'unknown'
 * ```
 */
export function parseForeshadowRevealState(status: unknown): ForeshadowRevealState {
    const value = String(status ?? '').replace(/\s+/g, '');
    if (!value) return 'unrevealed';
    if (UNREVEALED_PATTERN.test(value)) return 'unrevealed';
    if (REVEALED_PATTERN.test(value)) return 'revealed';
    return 'unknown';
}

/**
 * 是否已揭示（供「跳过已揭示」类调用点使用）。
 *
 * @param status - 伏笔状态文本
 * @returns 是否已揭示
 *
 * @example
 * ```ts
 * if (isForeshadowRevealed(row.status)) continue;
 * ```
 */
export function isForeshadowRevealed(status: unknown): boolean {
    return parseForeshadowRevealState(status) === 'revealed';
}
