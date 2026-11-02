/**
 * plot-eval-throttle.ts — 协同写作「剧情完成度」AI 评估的触发门槛
 *
 * `evaluatePlotComplete` 会把整章正文拼成约 9.6k token 的 prompt 发给 AI。
 * 侧边栏此前只按「距上次评估 ≥10 秒」节流：开着 `autoPlotEvaluation` 时，
 * 打字期间每分钟最多 6 次请求，而正文往往只多了几十字。
 *
 * 这里把「是否值得再评估一次」收敛成纯函数，便于单测：
 * - 正文没变（同一章节内签名相同）→ 不评估；
 * - 正文有变化，但「新增不足门槛且未到冷却」→ 不评估；
 * - 两次评估之间至少间隔 `PLOT_EVAL_MIN_INTERVAL_MS`；
 * - 手动重试 / 生成完成后强制刷新 → 直接评估。
 */

import {
    PLOT_EVAL_COOLDOWN_MS,
    PLOT_EVAL_MIN_GROWTH_CHARS,
    PLOT_EVAL_MIN_INTERVAL_MS,
} from './thresholds';

export interface PlotEvalGateState {
    /** 评估时的章节身份（项目 + 章号），换章后不再沿用旧章节的门槛状态 */
    chapterKey: string;
    signature: string;
    length: number;
    /** 上次真正发起评估的时间戳 */
    at: number;
}

export interface PlotEvalGateInput {
    /** 章节身份（项目 + 章号），换章后即使正文相同也要重新评估 */
    chapterKey: string;
    text: string;
    last: PlotEvalGateState | null;
    now: number;
    /** 手动重试 / 生成完成：跳过所有门槛 */
    force?: boolean;
}

export interface PlotEvalGateDecision {
    run: boolean;
    next: PlotEvalGateState;
}

/**
 * FNV-1a 32 位哈希：只用于「正文是否变过」的判定，不参与持久化
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function buildPlotEvalSignature(chapterKey: string, text: string): string {
    return `${chapterKey}#${text.length}#${hashText(text)}`;
}

export function shouldRunPlotEval(input: PlotEvalGateInput): PlotEvalGateDecision {
    const { chapterKey, text, last, now } = input;
    const signature = buildPlotEvalSignature(chapterKey, text);
    const next: PlotEvalGateState = { chapterKey, signature, length: text.length, at: now };
    const keep: PlotEvalGateState = last ?? next;

    if (input.force) return { run: true, next };
    if (!last) return { run: true, next };
    // 换章必须重新评估：上一章的时间戳/签名与本章无关，不能被最小间隔挡住
    if (last.chapterKey !== chapterKey) return { run: true, next };
    if (last.signature === signature) return { run: false, next: keep };

    const elapsed = now - last.at;
    if (elapsed < PLOT_EVAL_MIN_INTERVAL_MS) return { run: false, next: keep };

    const grew = text.length - last.length;
    if (grew >= PLOT_EVAL_MIN_GROWTH_CHARS || elapsed >= PLOT_EVAL_COOLDOWN_MS) {
        return { run: true, next };
    }
    return { run: false, next: keep };
}
