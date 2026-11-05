/**
 * ghost-association.ts — 协同写作「幽灵联想」的触发判定与提示渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：前置条件、正文长度、光标位置、句末触发、
 * 同种子去重与最小间隔限频。网络编排、代次守卫与 abort 仍由视图负责。
 */
import { shouldRequestGhostAssociationByInterval } from '@/shared/ghost-trigger';
import type { SuggestionRecord } from '@/shared/types';

/** 幽灵联想触发所需的视图状态快照。 */
export interface GhostTriggerInput {
    /** 设置中的自动联想开关 */
    enabled: boolean;
    /** 是否正在请求联想 */
    isAssociating: boolean;
    /** 是否正在生成建议 */
    isSuggesting: boolean;
    /** 当前已有建议数量 */
    suggestionCount: number;
    /** 编辑器全文 */
    text: string;
    /** 光标位置 */
    cursor: number;
    /** 上次请求使用的种子 */
    lastSeed: string;
    /** 当前时间戳 */
    now: number;
    /** 上次请求时间戳 */
    lastRequestAt: number;
    /** 最小请求间隔（毫秒） */
    minIntervalMs: number;
}

/** 通过判定后的触发参数。 */
export interface GhostTrigger {
    /** 请求种子（光标前 160 字） */
    seed: string;
    /** 光标位置 */
    cursor: number;
    /** 本次请求时间戳 */
    requestedAt: number;
}

/**
 * 判断是否应发起一次幽灵联想，并返回请求参数。
 *
 * @param input - 视图状态快照
 * @returns 触发参数；不满足条件返回 null
 * @example
 * ```ts
 * const trigger = resolveGhostTrigger({ enabled: true, isAssociating: false, ... });
 * ```
 */
export function resolveGhostTrigger(input: GhostTriggerInput): GhostTrigger | null {
    if (!input.enabled) return null;
    if (input.isAssociating || input.isSuggesting || input.suggestionCount > 0) return null;
    if (input.text.trim().length < 40 || input.cursor < input.text.length - 3) return null;
    const seed = input.text.slice(Math.max(0, input.cursor - 160), input.cursor);
    if (!seed.trim() || seed === input.lastSeed) return null;
    // 只在句末/段末触发：句中的每次停顿都请求会让本地模型持续排队
    const beforeCursor = input.text.slice(0, input.cursor).trimEnd();
    const lastChar = beforeCursor.slice(-1);
    if (!/[。！？…]/.test(lastChar) && !beforeCursor.endsWith('\n')) return null;
    // 慢速打字时尾部种子每次只多一个字，1.5s 防抖后仍会连续请求：按最小间隔限频
    if (!shouldRequestGhostAssociationByInterval(input.now, input.lastRequestAt, input.minIntervalMs)) {
        return null;
    }
    return { seed, cursor: input.cursor, requestedAt: input.now };
}

/**
 * 渲染幽灵建议提示（Tab 接受联想）。
 *
 * @param container - 提示容器
 * @param suggestion - 建议；null 表示隐藏
 * @example
 * ```ts
 * renderGhostSuggestion(this.ghostSuggestionContainer, suggestion);
 * ```
 */
export function renderGhostSuggestion(
    container: HTMLElement | null,
    suggestion: SuggestionRecord | null,
): void {
    if (!container) return;
    container.empty();
    container.toggleClass('is-visible', !!suggestion);
    if (!suggestion) return;
    container.createSpan({ cls: 'nw-cowrite-ghost-prefix', text: 'Tab 接受联想：' });
    container.createSpan({ cls: 'nw-cowrite-ghost-text', text: suggestion.text });
}
