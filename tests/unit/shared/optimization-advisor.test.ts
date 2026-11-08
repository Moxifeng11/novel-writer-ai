/**
 * optimization-advisor 纯函数契约测试
 *
 * 锁定自动化方向判断的四类硬规则：决策阶梯、评分惩罚、强制换型、
 * 输出稳定性。测试只依赖纯函数，不读写文件系统。
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_ADVISOR_PARAMS,
    decideOptimizationAdvice,
    detectAdvisorCandidates,
    isFreshDispatch,
    normalizeAdvisorType,
    resolveMetricWithFallback,
    scoreAdvisorCandidates,
} from '@/shared/optimization-advisor';
import type {
    AdvisorFacts,
    AdvisorParams,
    AdvisorRoundRecord,
} from '@/shared/optimization-advisor';

function makeParams(overrides: Partial<AdvisorParams> = {}): AdvisorParams {
    return {
        ...DEFAULT_ADVISOR_PARAMS,
        typeWeights: { ...DEFAULT_ADVISOR_PARAMS.typeWeights },
        failurePenalty: { ...DEFAULT_ADVISOR_PARAMS.failurePenalty },
        ...overrides,
    };
}

function makeFacts(overrides: Partial<AdvisorFacts> = {}): AdvisorFacts {
    return {
        round: 87,
        params: makeParams(),
        recentRounds: [],
        worktree: { modified: 0, untracked: 0 },
        gates: {
            preflightOk: true,
            anyRemaining: 0,
            bundleBytes: 4_869_777,
            startupBaselineBytes: 4_869_777,
        },
        docs: { versionMismatch: false, handoffStale: false },
        tests: { files: 592, cases: 6_500 },
        ...overrides,
    };
}

function makeRounds(type: string, count: number, extra: Partial<AdvisorRoundRecord> = {}): AdvisorRoundRecord[] {
    return Array.from({ length: count }, (_, index) => ({
        round: 80 + index,
        type,
        ...extra,
    }));
}

describe('normalizeAdvisorType', () => {
    it('从复合描述中识别首个已知类型', () => {
        expect(normalizeAdvisorType('test-hardening + docs-correction')).toBe('test-hardening');
        expect(normalizeAdvisorType('v5-product / docs-correction')).toBe('v5-product');
    });

    it('无法识别时归为 audit-only', () => {
        expect(normalizeAdvisorType('mystery')).toBe('audit-only');
    });
});

describe('isFreshDispatch', () => {
    it('派工轮次不小于当前轮次即新鲜，旧轮次视为陈旧', () => {
        expect(isFreshDispatch('第 87 轮派工：补 entity 测试', 86, '', 1_000)).toBe(true);
        expect(isFreshDispatch('第 86 轮派工：补 entity 测试', 86, '', 1_000)).toBe(true);
        expect(isFreshDispatch('第 85 轮派工：补 entity 测试', 86, '', 1_000)).toBe(false);
    });

    it('主题含多个轮次时按最大轮次判断', () => {
        expect(isFreshDispatch('第 85 轮已收单 + 第 87 轮派工', 86, '', 1_000)).toBe(true);
    });

    it('无轮次时六小时内有效', () => {
        const now = Date.parse('2026-11-07T22:00:00+08:00');
        expect(isFreshDispatch('请执行体积审计', 86, '2026-11-07T19:00:00+08:00', now)).toBe(true);
        expect(isFreshDispatch('请执行体积审计', 86, '2026-11-07T10:00:00+08:00', now)).toBe(false);
    });

    it('同一消息 id 已执行过则去重', () => {
        expect(isFreshDispatch('第 92 轮派工：浅拷贝修复', 92, '', 1_000, {
            messageId: 'm-1',
            lastDispatchId: 'm-1',
        })).toBe(false);
        expect(isFreshDispatch('第 92 轮派工：浅拷贝修复', 92, '', 1_000, {
            messageId: 'm-2',
            lastDispatchId: 'm-1',
        })).toBe(true);
    });
});

describe('detectAdvisorCandidates', () => {
    it('派工生成最高优先级候选', () => {
        const facts = makeFacts({
            dispatch: { subject: '第 87 轮派工：补 entity 测试', hintType: 'test-hardening', sourceId: 'm-1' },
        });
        const candidates = detectAdvisorCandidates(facts);
        expect(candidates[0].dispatchPriority).toBe(true);
        expect(candidates[0].type).toBe('test-hardening');
    });

    it('工作树非空生成在途收口候选，类型取最近一轮', () => {
        const facts = makeFacts({
            worktree: { modified: 3, untracked: 1 },
            recentRounds: makeRounds('test-hardening', 1),
        });
        const backlog = detectAdvisorCandidates(facts).find(candidate => candidate.backlog);
        expect(backlog).toBeDefined();
        expect(backlog?.type).toBe('test-hardening');
        expect(backlog?.evidence).toContain('3 modified + 1 untracked');
    });

    it('脏路径全部已在台账登记时不再生成在途收口候选', () => {
        const facts = makeFacts({ worktree: { modified: 3, untracked: 1, unrecorded: 0 } });
        const ids = detectAdvisorCandidates(facts).map(candidate => candidate.id);
        expect(ids).not.toContain('backlog:worktree');
        expect(ids).toContain('audit:explore');
    });

    it('部分路径未登记时证据区分未登记条数', () => {
        const facts = makeFacts({ worktree: { modified: 3, untracked: 1, unrecorded: 2 } });
        const backlog = detectAdvisorCandidates(facts).find(candidate => candidate.backlog);
        expect(backlog?.title).toContain('2 路径未登记');
        expect(backlog?.evidence).toContain('未台账登记 2 条');
    });

    it('preflight 红灯生成 gate 候选且不再生成 any 收口', () => {
        const facts = makeFacts({
            gates: { preflightOk: false, anyRemaining: 5, bundleBytes: 1, startupBaselineBytes: 1 },
        });
        const ids = detectAdvisorCandidates(facts).map(candidate => candidate.id);
        expect(ids).toContain('gate:preflight');
        expect(ids).not.toContain('gate:any');
    });

    it('any 有存量时生成 gate-fix 候选', () => {
        const facts = makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        });
        const anyCandidate = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'gate:any');
        expect(anyCandidate?.type).toBe('gate-fix');
        expect(anyCandidate?.evidence).toContain('存量 4');
    });

    it('any 存量分桶后按可动面生成候选并给出分桶证据', () => {
        const facts = makeFacts({
            gates: {
                preflightOk: true,
                anyRemaining: 133,
                anyBuckets: { redline: 100, design: 6, movable: 27 },
                bundleBytes: 1,
                startupBaselineBytes: 1,
            },
        });
        const anyCandidate = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'gate:any');
        expect(anyCandidate?.title).toContain('可动 27/133');
        expect(anyCandidate?.evidence).toContain('红线 100');
        expect(anyCandidate?.evidence).toContain('设计性 6');
        expect(anyCandidate?.evidence).not.toContain('已降权');
    });

    it('可动面低于阈值时 gate:any 自动降权', () => {
        const facts = makeFacts({
            gates: {
                preflightOk: true,
                anyRemaining: 133,
                anyBuckets: { redline: 100, design: 6, movable: 27 },
                bundleBytes: 1,
                startupBaselineBytes: 1,
            },
            params: makeParams({ anyMovableDownweightThreshold: 30 }),
        });
        const anyCandidate = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'gate:any');
        expect(anyCandidate?.evidence).toContain('低于阈值 30，已降权');
        const scored = scoreAdvisorCandidates([anyCandidate!], facts)[0];
        expect(scored.factors.downweight).toBe(0.5);
    });

    it('可动面为 0 时不再生成 gate:any 候选', () => {
        const facts = makeFacts({
            gates: {
                preflightOk: true,
                anyRemaining: 106,
                anyBuckets: { redline: 100, design: 6, movable: 0 },
                bundleBytes: 1,
                startupBaselineBytes: 1,
            },
        });
        const ids = detectAdvisorCandidates(facts).map(candidate => candidate.id);
        expect(ids).not.toContain('gate:any');
    });

    it('冻结路径从可动面扣除后按有效可动面计分并标注冻结处数', () => {
        const facts = makeFacts({
            gates: {
                preflightOk: true,
                anyRemaining: 108,
                anyBuckets: { redline: 100, design: 6, movable: 12, frozen: 10 },
                bundleBytes: 1,
                startupBaselineBytes: 1,
            },
        });
        const anyCandidate = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'gate:any');
        expect(anyCandidate?.title).toContain('可动 2/108');
        expect(anyCandidate?.evidence).toContain('冻结 10');
        expect(anyCandidate?.evidence).toContain('已降权');
    });

    it('可动面全部为冻结路径时不再生成 gate:any 候选', () => {
        const facts = makeFacts({
            gates: {
                preflightOk: true,
                anyRemaining: 108,
                anyBuckets: { redline: 100, design: 6, movable: 2, frozen: 2 },
                bundleBytes: 1,
                startupBaselineBytes: 1,
            },
        });
        const ids = detectAdvisorCandidates(facts).map(candidate => candidate.id);
        expect(ids).not.toContain('gate:any');
    });

    it('体积超过启动基线时生成 perf 候选并给出百分比', () => {
        const facts = makeFacts({
            gates: { preflightOk: true, anyRemaining: 0, bundleBytes: 4_900_000, startupBaselineBytes: 4_850_000 },
        });
        const perf = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'perf:bundle');
        expect(perf?.type).toBe('perf');
        expect(perf?.evidence).toContain('+50000B');
    });

    it('无高置信信号时补一个低风险审计候选', () => {
        const facts = makeFacts();
        const candidates = detectAdvisorCandidates(facts);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].type).toBe('audit-only');
    });

    it('engine 与 ui/views 脏路径属 ZCode 分工红线，不产生在途收口候选', () => {
        const worktree = {
            modified: 2,
            untracked: 0,
            unrecorded: 2,
            unrecordedPaths: [
                'engine/repository/domain/serializers/frontmatter-serializer.ts',
                'ui/views/writing-fingerprint-view.ts',
            ],
        };
        const facts = makeFacts({ worktree });
        expect(detectAdvisorCandidates(facts).some(candidate => candidate.id === 'backlog:worktree')).toBe(false);
        expect(decideOptimizationAdvice(facts).tier).toBe('score');
    });

    it('混合红线与非红线脏路径时只按非红线计数', () => {
        const facts = makeFacts({
            worktree: {
                modified: 2,
                untracked: 0,
                unrecorded: 2,
                unrecordedPaths: ['engine/repository/domain/index.ts', 'shared/optimization-advisor.ts'],
            },
        });
        const backlog = detectAdvisorCandidates(facts).find(candidate => candidate.id === 'backlog:worktree');
        expect(backlog?.title).toContain('1 路径');
        expect(backlog?.evidence).toContain('未台账登记 1 条');
    });
});

describe('scoreAdvisorCandidates', () => {
    it('同型连续轮次越多，多样性系数越低', () => {
        const candidateFacts = makeFacts();
        const candidates = detectAdvisorCandidates(makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        const fresh = scoreAdvisorCandidates(candidates, makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        const repeated = scoreAdvisorCandidates(candidates, makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
            recentRounds: makeRounds('gate-fix', 2),
        }));
        expect(candidateFacts.round).toBe(87);
        const freshGate = fresh.find(candidate => candidate.id === 'gate:any');
        const repeatedGate = repeated.find(candidate => candidate.id === 'gate:any');
        expect(repeatedGate?.factors.diversity).toBeLessThan(freshGate?.factors.diversity ?? 0);
        expect(repeatedGate?.score).toBeLessThan(freshGate?.score ?? 0);
    });

    it('最近一轮回退时同型候选受回退惩罚', () => {
        const candidates = detectAdvisorCandidates(makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        const normal = scoreAdvisorCandidates(candidates, makeFacts());
        const reverted = scoreAdvisorCandidates(candidates, makeFacts({
            recentRounds: makeRounds('gate-fix', 1, { reverted: true }),
        }));
        const normalGate = normal.find(candidate => candidate.id === 'gate:any');
        const revertedGate = reverted.find(candidate => candidate.id === 'gate:any');
        expect(revertedGate?.factors.failure).toBeCloseTo(0.75);
        expect(revertedGate?.factors.failure).toBeLessThan(normalGate?.factors.failure ?? 0);
    });

    it('连续同型达到阈值后标记强制换型并减半', () => {
        const candidates = detectAdvisorCandidates(makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        const scored = scoreAdvisorCandidates(candidates, makeFacts({
            recentRounds: makeRounds('gate-fix', 3),
        }));
        const gate = scored.find(candidate => candidate.id === 'gate:any');
        expect(gate?.forcedSwitch).toBe(true);
        expect(gate?.factors.diversity).toBeCloseTo(0.4);
    });

    it('探索掷值命中时给非连续类型加成', () => {
        const candidates = detectAdvisorCandidates(makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        const nonExplore = scoreAdvisorCandidates(candidates, makeFacts());
        const explore = scoreAdvisorCandidates(candidates, makeFacts({
            params: makeParams({ explorationRoll: 0.05 }),
        }));
        expect(explore[0].factors.exploration).toBe(1.15);
        expect(explore[0].score).toBeGreaterThan(nonExplore[0].score);
    });
});

describe('decideOptimizationAdvice', () => {
    it('派工压过在途收口与门禁红灯', () => {
        const decision = decideOptimizationAdvice(makeFacts({
            dispatch: { subject: '派工：补测试', hintType: 'test-hardening', sourceId: 'm-2' },
            worktree: { modified: 2, untracked: 0 },
            gates: { preflightOk: false, anyRemaining: 0, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        expect(decision.tier).toBe('dispatch');
        expect(decision.recommended[0].dispatchPriority).toBe(true);
        expect(decision.warnings).toContain('工作树有 2 条在途路径，执行前先确认归属');
    });

    it('无派工时在途收口排在门禁红灯之前', () => {
        const decision = decideOptimizationAdvice(makeFacts({
            worktree: { modified: 1, untracked: 0 },
            gates: { preflightOk: false, anyRemaining: 0, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        expect(decision.tier).toBe('backlog');
        expect(decision.recommended.map(candidate => candidate.id)).toEqual([
            'backlog:worktree',
            'gate:preflight',
        ]);
    });

    it('在途路径全部登记后层级继续按评分选择，不再锁定 backlog', () => {
        const decision = decideOptimizationAdvice(makeFacts({
            worktree: { modified: 3, untracked: 1, unrecorded: 0 },
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
        }));
        expect(decision.tier).toBe('score');
        expect(decision.warnings).toContain('工作树 4 条在途路径均已在台账登记，待收单不锁定层级');
    });

    it('连续三轮同型且无派工时强制换型', () => {
        const decision = decideOptimizationAdvice(makeFacts({
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 1, startupBaselineBytes: 1 },
            recentRounds: makeRounds('gate-fix', 3, { testsAdded: 1 }),
        }));
        const gateInRecommendation = decision.recommended.some(candidate => candidate.type === 'gate-fix');
        expect(gateInRecommendation).toBe(false);
        expect(decision.recommended[0].type).toBe('audit-only');
    });

    it('无任何信号时仍给出不动手轮建议', () => {
        const decision = decideOptimizationAdvice(makeFacts());
        expect(decision.tier).toBe('score');
        expect(decision.recommended).toHaveLength(1);
        expect(decision.recommended[0].type).toBe('audit-only');
    });

    it('推荐数量不超过 maxActionsPerRound', () => {
        const decision = decideOptimizationAdvice(makeFacts({
            worktree: { modified: 1, untracked: 0 },
            gates: { preflightOk: true, anyRemaining: 4, bundleBytes: 5_000_000, startupBaselineBytes: 4_000_000 },
            docs: { versionMismatch: true, handoffStale: true },
        }));
        expect(decision.recommended.length).toBeLessThanOrEqual(2);
        expect(decision.alternatives.length).toBeGreaterThan(0);
    });
});

describe('采集面回退（resolveMetricWithFallback）', () => {
    it('bundle 体积实文件优先，缺失/非法时回退基线值且不抛错', () => {
        expect(resolveMetricWithFallback(4_870_903, 4_870_663)).toBe(4_870_903);
        expect(resolveMetricWithFallback(undefined, 4_870_663)).toBe(4_870_663);
        expect(resolveMetricWithFallback(Number.NaN, 4_870_663)).toBe(4_870_663);
        expect(resolveMetricWithFallback(undefined, 0)).toBe(0);
    });

    it('any 存量基线 total 优先，缺失/非法时回退台账存量且不抛错', () => {
        expect(resolveMetricWithFallback(144, 0)).toBe(144);
        expect(resolveMetricWithFallback(undefined, 4)).toBe(4);
        expect(resolveMetricWithFallback(Number.NaN, 4)).toBe(4);
        expect(resolveMetricWithFallback(undefined, 0)).toBe(0);
    });
});
