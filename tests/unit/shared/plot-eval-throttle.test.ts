/**
 * plot-eval-throttle.test.ts — 协同写作剧情完成度 AI 评估的触发门槛
 *
 * 契约：正文没变不评估；有变化也只在「新增 ≥ 300 字」或「距上次 ≥2 分钟」时评估，
 * 且两次评估至少间隔 30 秒；换章或强制刷新直接评估。
 */
import { describe, it, expect } from 'vitest';
import {
    PLOT_EVAL_COOLDOWN_MS,
    PLOT_EVAL_MIN_GROWTH_CHARS,
    PLOT_EVAL_MIN_INTERVAL_MS,
} from '../../../shared/thresholds';
import {
    buildPlotEvalSignature,
    shouldRunPlotEval,
    type PlotEvalGateState,
} from '../../../shared/plot-eval-throttle';

const CHAPTER = 'A书|3';
const OTHER_CHAPTER = 'A书|4';

function stateOf(text: string, at: number, chapterKey = CHAPTER): PlotEvalGateState {
    return {
        chapterKey,
        signature: buildPlotEvalSignature(chapterKey, text),
        length: text.length,
        at,
    };
}

const BASE_TEXT = '正文'.repeat(500); // 1000 字

describe('剧情完成度评估门槛', () => {
    it('首次没有历史时直接评估，并记录签名与时间', () => {
        const now = 1_000_000;
        const decision = shouldRunPlotEval({
            chapterKey: CHAPTER,
            text: BASE_TEXT,
            last: null,
            now,
        });
        expect(decision.run).toBe(true);
        expect(decision.next.at).toBe(now);
        expect(decision.next.length).toBe(BASE_TEXT.length);
        expect(decision.next.signature).toBe(buildPlotEvalSignature(CHAPTER, BASE_TEXT));
    });

    it('同一章节正文没有变化时跳过，且不推进时间戳', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const decision = shouldRunPlotEval({
            chapterKey: CHAPTER,
            text: BASE_TEXT,
            last,
            now: 1_000_000 + PLOT_EVAL_COOLDOWN_MS * 2,
        });
        expect(decision.run).toBe(false);
        expect(decision.next).toBe(last);
    });

    it('新增不足门槛且未到冷却时跳过', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const text = BASE_TEXT + '新'.repeat(PLOT_EVAL_MIN_GROWTH_CHARS - 1);
        const decision = shouldRunPlotEval({
            chapterKey: CHAPTER,
            text,
            last,
            now: 1_000_000 + PLOT_EVAL_MIN_INTERVAL_MS,
        });
        expect(decision.run).toBe(false);
        // 保持旧状态，新增字数继续累积
        expect(decision.next.length).toBe(BASE_TEXT.length);
        expect(decision.next.at).toBe(last.at);
    });

    it('新增达到门槛且过了最小间隔时评估', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const text = BASE_TEXT + '新'.repeat(PLOT_EVAL_MIN_GROWTH_CHARS);
        const now = 1_000_000 + PLOT_EVAL_MIN_INTERVAL_MS;
        const decision = shouldRunPlotEval({ chapterKey: CHAPTER, text, last, now });
        expect(decision.run).toBe(true);
        expect(decision.next.at).toBe(now);
        expect(decision.next.length).toBe(text.length);
    });

    it('没有新增但冷却到期时评估（删改后停笔也能刷新）', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const text = BASE_TEXT.slice(0, 900); // 变短，但内容变了
        const now = 1_000_000 + PLOT_EVAL_COOLDOWN_MS;
        const decision = shouldRunPlotEval({ chapterKey: CHAPTER, text, last, now });
        expect(decision.run).toBe(true);
    });

    it('最小间隔内即使新增很多也跳过，避免快速打字连续请求', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const text = BASE_TEXT + '新'.repeat(PLOT_EVAL_MIN_GROWTH_CHARS * 5);
        const decision = shouldRunPlotEval({
            chapterKey: CHAPTER,
            text,
            last,
            now: 1_000_000 + PLOT_EVAL_MIN_INTERVAL_MS - 1,
        });
        expect(decision.run).toBe(false);
    });

    it('切章后正文相同也要重新评估', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const decision = shouldRunPlotEval({
            chapterKey: OTHER_CHAPTER,
            text: BASE_TEXT,
            last,
            now: 1_000_000 + 1,
        });
        expect(decision.run).toBe(true);
    });

    it('强制刷新（手动重试 / 生成完成）不受门槛限制', () => {
        const last = stateOf(BASE_TEXT, 1_000_000);
        const now = 1_000_000 + 10;
        const decision = shouldRunPlotEval({
            chapterKey: CHAPTER,
            text: BASE_TEXT,
            last,
            now,
            force: true,
        });
        expect(decision.run).toBe(true);
        expect(decision.next.at).toBe(now);
    });
});
