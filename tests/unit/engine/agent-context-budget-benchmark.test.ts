/**
 * 阶段 C2：8K 窗口上下文预算量化基准
 *
 * 长期目标阶段 C：8K 窗口下按价值排序注入，**有量化基准**。
 *
 * `context-fit.ts` 已有确定性裁剪策略（裁工具结果 → 丢最旧轮次 → overBudget 显式失败），
 * 但没有任何用例锁住「8K 窗口下到底能装多少、超了会怎样」。
 * 没有基准，改预算参数时就是盲改。
 *
 * 本文件量化三件事：
 * 1. 8K 窗口的实际可用输入预算（扣掉输出与 headroom 后剩多少）
 * 2. 塞满工具结果时裁到什么程度、最终 token 落点
 * 3. 预算不足时是「显式 overBudget」而不是静默截断用户输入
 */

import { describe, expect, it } from 'vitest';
import {
    estimateTokens,
    resolveContextBudget,
    fitTurnsToBudget,
    resolveCompactionCharThreshold,
    type ContextTurn,
} from '../../../engine/agent/harness/context-fit';

/** 8K 窗口（本地小模型常见） */
const WINDOW_8K = 8192;
/** 默认最大输出 */
const MAX_OUTPUT = 2500;
/** 默认 headroom */
const HEADROOM = 2000;

describe('C2-1：8K 窗口的可用输入预算', () => {
    it('预算取「窗口×0.8」与「窗口-输出-headroom」的较小值', () => {
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        // byRatio = 6553；byReserve = 8192-2500-2000 = 3692
        expect(budget).toBe(3692);
    });

    it('输出预算变大时可用输入变小（线性关系）', () => {
        const small = resolveContextBudget(WINDOW_8K, 1000, HEADROOM) ?? 0;
        const large = resolveContextBudget(WINDOW_8K, 4000, HEADROOM) ?? 0;
        expect(large).toBeLessThan(small);
    });

    it('无窗口信息时返回 null（调用方不裁剪）', () => {
        expect(resolveContextBudget(undefined, MAX_OUTPUT, HEADROOM)).toBeNull();
        expect(resolveContextBudget(0, MAX_OUTPUT, HEADROOM)).toBeNull();
    });

    it('预算有下限 256（不会算成 0 或负数）', () => {
        const budget = resolveContextBudget(1024, 2000, 2000);
        expect(budget).toBe(256);
    });

    it('8K 窗口下可用输入约 3692 token ≈ 5538 字符', () => {
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM) ?? 0;
        expect(budget * 1.5).toBeCloseTo(5538, 0);
    });
});

describe('C2-2：塞满工具结果时的裁剪落点', () => {
    it('6 条 6000 字符工具结果在 8K 窗口下被全部裁剪', () => {
        const turns: ContextTurn[] = [];
        for (let i = 0; i < 6; i++) {
            turns.push({ role: 'tool', text: 'x'.repeat(6000) });
        }
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        const result = fitTurnsToBudget(turns, budget, 2000);

        // 6 × 6000 字符 = 36000 字符 ≈ 24000 token，远超 3692 预算 → 全部裁剪
        expect(result.trimmedTurns).toBe(6);
        expect(result.overBudget).toBe(false);
        expect(result.estimatedTokens).toBeLessThanOrEqual(3692);
    });

    it('裁剪后仍保留对话结构（工具轮次变成占位符而不是消失）', () => {
        const turns: ContextTurn[] = [
            { role: 'user', text: '帮我看一下知识库' },
            { role: 'tool', text: 'y'.repeat(8000) },
        ];
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        const result = fitTurnsToBudget(turns, budget, 0);
        expect(result.turns).toHaveLength(2);
        expect(result.turns[1].text).toContain('已裁剪');
    });

    it('预算充足时不裁剪任何内容', () => {
        const turns: ContextTurn[] = [
            { role: 'user', text: '你好' },
            { role: 'assistant', text: '你好，需要我做什么？' },
        ];
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        const result = fitTurnsToBudget(turns, budget, 500);
        expect(result.trimmedTurns).toBe(0);
        expect(result.droppedTurns).toBe(0);
        expect(result.turns).toHaveLength(2);
    });
});

describe('C2-3：预算不足时显式失败而不是静默截断', () => {
    it('system 本身就超预算时返回 overBudget（不假装适配成功）', () => {
        // system 5000 字符 ≈ 3333 token；最后一条用户指令 4000 字符 ≈ 2667 token
        // 合计 6000 token > 3692 预算 —— 即使丢掉所有历史轮次仍然超，必须显式报 overBudget
        const turns: ContextTurn[] = [
            { role: 'assistant', text: '旧回复' },
            { role: 'user', text: '当前这条本身就太长了'.repeat(200) },
        ];
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        const result = fitTurnsToBudget(turns, budget, 5000);
        expect(result.overBudget).toBe(true);
    });

    it('overBudget 时最后一条用户指令仍在（不静默丢当前指令）', () => {
        const last = '当前这条必须保留：帮我写第一章';
        const turns: ContextTurn[] = [
            { role: 'user', text: '很早以前的指令'.repeat(200) },
            { role: 'assistant', text: '很早以前的回复'.repeat(200) },
            { role: 'user', text: last },
        ];
        const budget = resolveContextBudget(WINDOW_8K, MAX_OUTPUT, HEADROOM);
        const result = fitTurnsToBudget(turns, budget, 0);
        expect(result.turns[result.turns.length - 1].text).toBe(last);
    });

    it('无预算信息（null）时一律不裁剪', () => {
        const turns: ContextTurn[] = [
            { role: 'tool', text: 'z'.repeat(100000) },
        ];
        const result = fitTurnsToBudget(turns, null, 0);
        expect(result.trimmedTurns).toBe(0);
        expect(result.overBudget).toBe(false);
        expect(result.turns[0].text).toHaveLength(100000);
    });
});

describe('C2-4：压缩阈值与窗口的对应关系', () => {
    it('8K 窗口的压缩阈值 = 8192×0.8×1.5 ≈ 9830 字符', () => {
        const threshold = resolveCompactionCharThreshold(WINDOW_8K);
        expect(threshold).toBe(9830);
    });

    it('用户显式配置更小时取用户值（可更早压缩）', () => {
        const threshold = resolveCompactionCharThreshold(WINDOW_8K, 4000);
        expect(threshold).toBe(4000);
    });

    it('无窗口信息时用默认 32000', () => {
        expect(resolveCompactionCharThreshold(undefined)).toBe(32000);
    });

    it('阈值有下限 4000（极小窗口不会算出 0）', () => {
        const threshold = resolveCompactionCharThreshold(1024);
        expect(threshold).toBeGreaterThanOrEqual(4000);
    });
});

describe('C2-5：token 估算口径', () => {
    it('字符 ÷ 1.5 向上取整（与 telemetry 同口径）', () => {
        expect(estimateTokens('abc')).toBe(2);       // 3/1.5 = 2
        expect(estimateTokens('abcd')).toBe(3);      // 4/1.5 = 2.67 → 3
        expect(estimateTokens('')).toBe(0);
    });

    it('中文按字符计（不区分宽窄，保守估法）', () => {
        expect(estimateTokens('一二三四五六')).toBe(4);
    });
});
