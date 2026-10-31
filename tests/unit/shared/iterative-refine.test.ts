import { describe, expect, it, vi } from 'vitest';
import { formatRefineRounds, runIterativeRefine, type RefineRoundScore } from '../../../shared/iterative-refine';

function score(composite: number, fidelityOk = true): RefineRoundScore {
    return { antiAI: Math.round((1 - composite) * 100), humanSim: composite, fidelityOk, composite };
}

describe('iterative-refine — 多轮调度与验收', () => {
    it('轮数为 0 时直接返回原文', async () => {
        const refine = vi.fn();
        const result = await runIterativeRefine({
            original: '原文', rounds: 0, refine, score: () => score(0.3),
        });
        expect(result.stoppedReason).toBe('no-rounds');
        expect(refine).not.toHaveBeenCalled();
        expect(result.best).toBe('原文');
    });

    it('只接受分数更高的轮次，分数下降会回滚', async () => {
        const candidates = ['第一轮（更差）', '第二轮（更好）', '第三轮（又差）'];
        let index = 0;
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 3,
            refine: async () => ({ content: candidates[index++], networkCalls: 1 }),
            score: (candidate) => {
                if (candidate === '第二轮（更好）') return score(0.8);
                if (candidate === '原文') return score(0.5);
                return score(0.4);
            },
            patience: 5,
        });
        expect(result.best).toBe('第二轮（更好）');
        expect(result.improved).toBe(true);
        expect(result.rounds.map((r) => r.accepted)).toEqual([false, true, false]);
        expect(result.rounds[0].rejectedReason).toContain('综合分未提升');
    });

    it('保真不过直接拒收（哪怕分更高）', async () => {
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 1,
            refine: async () => ({ content: '改坏了', networkCalls: 1 }),
            score: () => score(0.95, false),
        });
        expect(result.best).toBe('原文');
        expect(result.rounds[0].accepted).toBe(false);
        expect(result.rounds[0].rejectedReason).toContain('保真');
    });

    it('连续无提升到达耐心值提前停，省调用', async () => {
        const refine = vi.fn(async () => ({ content: '每轮都一样', networkCalls: 1 }));
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 5,
            refine,
            score: () => score(0.4),
            patience: 2,
        });
        expect(refine).toHaveBeenCalledTimes(2);
        expect(result.stoppedReason).toBe('no-improvement');
    });

    it('空返回计入无提升，不算接受', async () => {
        let call = 0;
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 3,
            refine: async () => {
                call += 1;
                return call === 1 ? { content: '   ', networkCalls: 1 } : { content: '更好的一版', networkCalls: 1 };
            },
            score: (candidate) => (candidate === '更好的一版' ? score(0.9) : score(0.3)),
            patience: 3,
        });
        expect(result.rounds[0].rejectedReason).toContain('空内容');
        expect(result.best).toBe('更好的一版');
    });

    it('改写抛错时停止并保留 best', async () => {
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 3,
            refine: async () => { throw new Error('网络错误'); },
            score: () => score(0.3),
        });
        expect(result.stoppedReason).toBe('refine-failed');
        expect(result.best).toBe('原文');
    });

    it('轮数上限被夹到 5，累计网络调用数正确', async () => {
        let call = 0;
        const result = await runIterativeRefine({
            original: '原文',
            rounds: 99,
            refine: async () => ({ content: `版本${++call}`, networkCalls: 2 }),
            score: (candidate) => score(0.2 + call * 0.1),
            patience: 5,
        });
        expect(result.rounds.length).toBeLessThanOrEqual(5);
        expect(result.totalNetworkCalls).toBe(result.rounds.length * 2);
    });

    it('formatRefineRounds 输出逐轮可读摘要', () => {
        const text = formatRefineRounds([
            { round: 1, accepted: false, rejectedReason: '综合分未提升', chars: 10, networkCalls: 1, ...score(0.62) },
            { round: 2, accepted: true, chars: 12, networkCalls: 1, ...score(0.68) },
        ]);
        expect(text).toContain('R1: 62.0（综合分未提升）');
        expect(text).toContain('R2: 68.0（接受）');
    });
});
