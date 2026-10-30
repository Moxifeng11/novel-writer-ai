/**
 * budget-pack.ts — 检索结果预算打包（纯函数）
 *
 * 旧实现每段固定「N 条 × 固定字符」，完全不看总预算：
 * 本地 8K 窗口下经常超支，云端窗口下又浪费。
 * 这里按「分数 / 长度」性价比装包，装不下就停，并报告丢弃数。
 */
import type { RagHit } from './neighbors';

export interface PackResult {
    picked: RagHit[];
    /** 因预算未装入的条数 */
    dropped: number;
    /** 实际占用字符（不含拼接符号） */
    chars: number;
}

/** 单条最小可用长度：低于此值的样本信息量不足，直接丢 */
const MIN_SAMPLE_CHARS = 40;

/**
 * 按预算装包。
 * - 先保底：分数最高的 1 条无论多长都装入（截断到 maxChars）；
 * - 其余按 value = score / sqrt(chars) 排序（性价比），能装就装；
 * - 每条超过「剩余预算」时尝试截断到剩余（至少保留 MIN_SAMPLE_CHARS）。
 */
export function packByBudget(hits: RagHit[], maxChars: number): PackResult {
    if (maxChars <= 0 || hits.length === 0) return { picked: [], dropped: hits.length, chars: 0 };

    const sorted = [...hits].sort((a, b) => b.score - a.score);
    const picked: RagHit[] = [];
    let chars = 0;
    let dropped = 0;

    const first = sorted[0];
    if (first) {
        const text = first.sample.length > maxChars ? first.sample.slice(0, maxChars) : first.sample;
        picked.push({ ...first, sample: text });
        chars += text.length;
    }

    const rest = sorted.slice(1).map((hit) => ({
        hit,
        value: hit.score / Math.sqrt(Math.max(MIN_SAMPLE_CHARS, hit.sample.length)),
    })).sort((a, b) => b.value - a.value);

    for (const item of rest) {
        const remaining = maxChars - chars;
        if (remaining < MIN_SAMPLE_CHARS) {
            dropped++;
            continue;
        }
        if (item.hit.sample.length <= remaining) {
            picked.push(item.hit);
            chars += item.hit.sample.length;
        } else {
            picked.push({ ...item.hit, sample: item.hit.sample.slice(0, remaining) });
            chars += remaining;
            // 剩余预算已用尽，后面全部计为丢弃
            dropped += rest.length - (rest.findIndex((entry) => entry.hit === item.hit) + 1);
            break;
        }
    }

    return { picked, dropped, chars };
}

/** 每条结果的固定开销（标题/序号/书名），用于从字符预算里预留 */
export const RESULT_OVERHEAD_CHARS = 24;

/** 把总预算换成「用于样本正文」的预算 */
export function sampleBudgetOf(totalChars: number, itemCount: number): number {
    return Math.max(0, totalChars - RESULT_OVERHEAD_CHARS * Math.max(1, itemCount));
}