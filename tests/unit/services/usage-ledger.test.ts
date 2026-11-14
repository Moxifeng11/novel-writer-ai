import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import {
    dailyTrend,
    currentUsageScope,
    getUsageLedger,
    pushUsageScope,
    resetUsageLedger,
    summarizeUsage,
    type UsageRecord,
} from '../../../services/usage-ledger';

function record(overrides: Partial<UsageRecord> = {}): Omit<UsageRecord, 'id'> {
    return {
        at: Date.now(),
        source: 'ai',
        model: 'mock-model',
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        durationMs: 1200,
        status: 'ok',
        ...overrides,
    };
}

describe('usage-ledger — AI 用量账本', () => {
    it('汇总按模型聚合并排序', () => {
        const summary = summarizeUsage([
            record() as UsageRecord,
            record({ model: 'other-model', totalTokens: 50, promptTokens: 20, completionTokens: 30, status: 'error' }) as UsageRecord,
            record() as UsageRecord,
        ]);
        expect(summary.totalCalls).toBe(3);
        expect(summary.okCalls).toBe(2);
        expect(summary.failedCalls).toBe(1);
        expect(summary.totalTokens).toBe(650);
        expect(summary.byModel[0].model).toBe('mock-model');
        expect(summary.byModel[0].calls).toBe(2);
    });

    it('记录、落盘并可在新实例中读回', async () => {
        resetUsageLedger();
        const vault = new Vault();
        const app = { vault } as never;
        const ledger = getUsageLedger(app);
        await ledger.record(record());
        await ledger.record(record({ status: 'aborted', totalTokens: 0 }));

        const store = (vault.adapter as unknown as { _store: Map<string, string> })._store;
        const raw = JSON.parse(store.get('.obsidian/plugins/novel-writer-ai/data/usage-ledger.json') ?? '{}');
        expect(raw.records).toHaveLength(2);

        resetUsageLedger();
        const second = getUsageLedger(app);
        await second.load();
        expect(second.list()).toHaveLength(2);
        expect(second.list()[0].status).toBe('aborted');
        resetUsageLedger();
    });

    it('list 新记录在前且有上限', async () => {
        resetUsageLedger();
        const ledger = getUsageLedger();
        for (let i = 0; i < 3; i++) await ledger.record(record({ totalTokens: i }));
        const list = ledger.list(2);
        expect(list).toHaveLength(2);
        expect(list[0].totalTokens).toBe(2);
        resetUsageLedger();
    });

    it('汇总按项目聚合，空 project 归入未归因，按 token 降序', () => {
        const summary = summarizeUsage([
            record({ project: '项目A', source: 'step', totalTokens: 400 }) as UsageRecord,
            record({ project: '项目A', source: 'step', status: 'error', totalTokens: 100 }) as UsageRecord,
            record({ project: '项目B', source: 'agent', totalTokens: 300 }) as UsageRecord,
            record({ source: 'ai', totalTokens: 50, promptTokens: 30, completionTokens: 20 }) as UsageRecord,
        ]);
        // 排序：项目A(500) > 项目B(300) > 未归因(50)
        expect(summary.byProject.map((p) => p.project)).toEqual(['项目A', '项目B', '(未归因)']);
        expect(summary.byProject[0].calls).toBe(2);
        expect(summary.byProject[0].okCalls).toBe(1);
        expect(summary.byProject[0].failedCalls).toBe(1);
        expect(summary.byProject[0].totalTokens).toBe(500);
        expect(summary.byProject[1].totalTokens).toBe(300);
        expect(summary.byProject[2].calls).toBe(1);
    });

    it('汇总按来源聚合并按 token 降序', () => {
        const summary = summarizeUsage([
            record({ project: '项目A', source: 'step', totalTokens: 400 }) as UsageRecord,
            record({ project: '项目A', source: 'step', status: 'error', totalTokens: 100 }) as UsageRecord,
            record({ project: '项目B', source: 'agent', totalTokens: 300 }) as UsageRecord,
            record({ source: 'ai', totalTokens: 50 }) as UsageRecord,
        ]);
        expect(summary.bySource.map((s) => s.source)).toEqual(['step', 'agent', 'ai']);
        expect(summary.bySource[0].calls).toBe(2);
        expect(summary.bySource[0].totalTokens).toBe(500);
        expect(summary.bySource[1]).toEqual({ source: 'agent', calls: 1, totalTokens: 300, costYuan: 0 });
    });

    it('costYuan 聚合到总计/byModel/byProject/bySource，未配置按 0 计', () => {
        const summary = summarizeUsage([
            record({ model: 'm1', project: '项目A', totalTokens: 300, costYuan: 0.5 }) as UsageRecord,
            record({ model: 'm1', project: '项目A', status: 'error', totalTokens: 100, promptTokens: 50, completionTokens: 50, costYuan: 0.25 }) as UsageRecord,
            record({ model: 'm2', project: '项目B', totalTokens: 300 }) as UsageRecord,
        ]);
        // 合计：0.5 + 0.25 + 未配置(0)
        expect(summary.costYuan).toBeCloseTo(0.75, 6);
        // byModel 按 token 降序：m1(400) > m2(300)；费用只落在 m1 上
        expect(summary.byModel[0].model).toBe('m1');
        expect(summary.byModel[0].costYuan).toBeCloseTo(0.75, 6);
        expect(summary.byModel[1].model).toBe('m2');
        expect(summary.byModel[1].costYuan).toBe(0);
        // byProject：项目A(0.75) > 项目B(0) > —
        expect(summary.byProject[0].project).toBe('项目A');
        expect(summary.byProject[0].costYuan).toBeCloseTo(0.75, 6);
        expect(summary.byProject[1].costYuan).toBe(0);
        // bySource：全部来源 ai，费用随记录累加
        expect(summary.bySource[0].source).toBe('ai');
        expect(summary.bySource[0].costYuan).toBeCloseTo(0.75, 6);
    });

    it('空记录的费用合计为 0（空 summary 工厂补 0）', () => {
        const summary = summarizeUsage([]);
        expect(summary.costYuan).toBe(0);
        expect(summary.byModel).toHaveLength(0);
    });

    it('pushUsageScope 嵌套时栈顶优先，退出后回退到外层', () => {
        // 前置：空栈返回空对象
        expect(currentUsageScope()).toEqual({});

        const exitOuter = pushUsageScope({ source: 'step', project: '外层项目', stepKey: 'bodyGeneration' });
        expect(currentUsageScope()).toEqual({ source: 'step', project: '外层项目', stepKey: 'bodyGeneration' });

        // 内层（Agent 回合内再触发步骤等场景）：栈顶优先
        const exitInner = pushUsageScope({ source: 'agent', project: '内层项目' });
        expect(currentUsageScope().source).toBe('agent');
        expect(currentUsageScope().project).toBe('内层项目');
        expect(currentUsageScope().stepKey).toBeUndefined();

        exitInner();
        expect(currentUsageScope().project).toBe('外层项目');
        exitOuter();
        expect(currentUsageScope()).toEqual({});
    });

    it('pushUsageScope 退出按对象身份删除，不会误删同值的嵌套外层', () => {
        const exitOuter = pushUsageScope({ source: 'step', project: 'P', stepKey: 'a' });
        const exitInner = pushUsageScope({ source: 'step', project: 'P', stepKey: 'a' });

        // 内层退出后外层仍在（结构相等但对象不同）
        exitInner();
        expect(currentUsageScope().stepKey).toBe('a');
        // 重复退出是安全的 no-op
        exitInner();
        expect(currentUsageScope().stepKey).toBe('a');

        exitOuter();
        expect(currentUsageScope()).toEqual({});
    });
});

describe('dailyTrend 按日趋势', () => {
    const now = new Date('2026-11-14T12:00:00').getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const record = (at: number, tokens: number, costYuan?: number) => ({
        id: String(at), at, source: 'ai' as const, model: 'm', promptTokens: tokens,
        completionTokens: 0, totalTokens: tokens, durationMs: 1, status: 'ok' as const, costYuan,
    });

    it('返回连续 N 天（缺数据补 0）', () => {
        const points = dailyTrend([], 7, now);
        expect(points).toHaveLength(7);
        expect(points.every(point => point.tokens === 0)).toBe(true);
        expect(points[6].date).toBe('2026-11-14');
        expect(points[0].date).toBe('2026-11-08');
    });

    it('按日累计 token / 费用 / 次数', () => {
        const points = dailyTrend([record(now, 100, 0.01), record(now - 1000, 50, 0.02), record(now - dayMs, 200, 0.03)], 3, now);
        expect(points[2]).toEqual({ date: '2026-11-14', tokens: 150, costYuan: 0.03, calls: 2 });
        expect(points[1]).toEqual({ date: '2026-11-13', tokens: 200, costYuan: 0.03, calls: 1 });
        expect(points[0].tokens).toBe(0);
    });

    it('区间外的记录被忽略', () => {
        const points = dailyTrend([record(now - 30 * dayMs, 999)], 7, now);
        expect(points.reduce((sum, point) => sum + point.tokens, 0)).toBe(0);
    });

    it('费用缺省按 0 计（不产生 NaN）', () => {
        const points = dailyTrend([record(now, 10)], 1, now);
        expect(points[0].costYuan).toBe(0);
        expect(Number.isFinite(points[0].costYuan)).toBe(true);
    });
});
