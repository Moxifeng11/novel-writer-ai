/**
 * 回合内上下文预算与压缩阈值（C3）
 *
 * 旧实现只在回合开始前压缩；一回合最多 6 次工具结果仍可能撑爆窗口。
 * 这里锁住：预算推导、先裁工具再丢轮次、超预算显式失败、压缩阈值随窗口。
 */
import { describe, expect, it } from 'vitest';
import {
    estimateTokens,
    fitTurnsToBudget,
    resolveCompactionCharThreshold,
    resolveContextBudget,
} from '../../../engine/agent/harness/context-fit';
import { runHarnessTurn } from '../../../engine/agent/harness/agent-loop';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry } from '../../../engine/agent/harness/tool-registry';
import type { HarnessAdapter, HarnessAssistantTurn } from '../../../engine/agent/harness/harness-types';

function scripted(turns: HarnessAssistantTurn[]): HarnessAdapter {
    let index = 0;
    const seen: string[][] = [];
    return {
        complete: async (request) => {
            seen.push(request.turns.map(turn => turn.text));
            const turn = turns[Math.min(index, turns.length - 1)];
            index += 1;
            return turn;
        },
        // 测试辅助
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ seen } as any),
    };
}

describe('预算推导', () => {
    it('按窗口 80% 与输出/预留取较小值', () => {
        expect(resolveContextBudget(10_000, 2_000, 1_000)).toBe(7_000);
        expect(resolveContextBudget(10_000, 7_500, 1_000)).toBe(1_500);
    });

    it('没有窗口信息时返回 null（不裁剪）', () => {
        expect(resolveContextBudget(0, 2_000)).toBeNull();
        expect(resolveContextBudget(undefined, 2_000)).toBeNull();
    });
});

describe('fitTurnsToBudget', () => {
    const turns = [
        { role: 'user' as const, text: '用户问题' },
        { role: 'tool' as const, text: '工'.repeat(3_000) },
        { role: 'assistant' as const, text: '回答' },
        { role: 'tool' as const, text: '具'.repeat(3_000) },
    ];

    it('预算充足时原样返回', () => {
        const result = fitTurnsToBudget(turns, 100_000);
        expect(result.trimmedTurns).toBe(0);
        expect(result.droppedTurns).toBe(0);
        expect(result.turns).toHaveLength(4);
    });

    it('先裁剪最旧工具结果，保留对话结构', () => {
        const result = fitTurnsToBudget(turns, 2_500);
        expect(result.trimmedTurns).toBeGreaterThan(0);
        expect(result.turns).toHaveLength(4);
        expect(result.turns[1].text).toContain('已裁剪');
        expect(result.overBudget).toBe(false);
    });

    it('裁完工具仍超预算时从最旧轮次丢弃，但保留最后一条', () => {
        const result = fitTurnsToBudget([
            { role: 'user', text: '旧'.repeat(2_000) },
            { role: 'assistant', text: '旧回答'.repeat(500) },
            { role: 'user', text: '最新指令' },
        ], 600);
        expect(result.droppedTurns).toBeGreaterThan(0);
        expect(result.turns[result.turns.length - 1].text).toBe('最新指令');
    });

    it('无法再裁时报告 overBudget（调用方显式失败）', () => {
        const result = fitTurnsToBudget([{ role: 'user', text: '单条超长'.repeat(2_000) }], 100);
        expect(result.overBudget).toBe(true);
    });

    it('token 估算与遥测口径一致（字符 ÷ 1.5）', () => {
        expect(estimateTokens('12345')).toBe(4);
    });
});

describe('压缩阈值', () => {
    it('有窗口时按窗口 80% × 1.5 推导，且不低于 4000', () => {
        expect(resolveCompactionCharThreshold(10_000)).toBe(12_000);
        expect(resolveCompactionCharThreshold(1_000)).toBe(4_000);
    });

    it('显式阈值更小时优先（用户可以更早压缩）', () => {
        expect(resolveCompactionCharThreshold(100_000, 8_000)).toBe(8_000);
        expect(resolveCompactionCharThreshold(10_000, 8_000)).toBe(8_000);
    });

    it('无窗口时沿用默认 32000', () => {
        expect(resolveCompactionCharThreshold(undefined)).toBe(32_000);
    });
});

describe('agent loop 集成', () => {
    it('小窗口下第二次模型调用看到的是裁剪后的工具结果', async () => {
        const registry = new HarnessToolRegistry();
        registry.register({
            name: 'reader',
            description: 'reader',
            parameters: {},
            required: [],
            sideEffect: 'none',
            execute: async () => ({ ok: true, content: '数'.repeat(9_000) }),
        });
        const adapter = scripted([
            { tool: { name: 'reader', args: {} } },
            { reply: '完成' },
        ]);

        const log = new AgentSessionLog();
        // 关闭投影裁剪，让「回合内预算」成为唯一裁剪者
        log.setPruneConfig({ thresholdChars: 0 });
        const result = await runHarnessTurn({
            adapter,
            registry,
            log,
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            contextWindowTokens: 6_000,
            maxTokens: 500,
        });

        expect(result.failed).toBe(false);
        expect(result.trimmedTurns).toBeGreaterThan(0);
        const seen = (adapter as unknown as { seen: string[][] }).seen;
        const secondCall = seen[1].join('\n');
        expect(secondCall).toContain('已裁剪');
        expect(secondCall).not.toContain('数'.repeat(9_000));
    });

    it('预算小到无法容纳系统提示时显式失败并给出原因', async () => {
        const registry = new HarnessToolRegistry();
        let calls = 0;
        const adapter: HarnessAdapter = {
            complete: async () => {
                calls += 1;
                return { reply: '不应走到这里' };
            },
        };
        const log = new AgentSessionLog();
        // 关闭投影裁剪，让「回合内预算」成为唯一裁剪者
        log.setPruneConfig({ thresholdChars: 0 });
        const result = await runHarnessTurn({
            adapter,
            registry,
            log,
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            contextWindowTokens: 300,
            maxTokens: 250,
            contextHeadroomTokens: 0,
        });
        expect(calls).toBe(0);
        expect(result.failed).toBe(true);
        expect(result.failReason).toContain('上下文超预算');
    });

    it('provider usage 会累计到回合结果', async () => {
        const registry = new HarnessToolRegistry();
        const result = await runHarnessTurn({
            adapter: {
                complete: async () => ({ reply: '好', usage: { prompt: 100, completion: 20, total: 120 } }),
            },
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
        });
        expect(result.modelSteps).toBe(1);
        expect(result.usage).toEqual({ prompt: 100, completion: 20, total: 120 });
    });
});
