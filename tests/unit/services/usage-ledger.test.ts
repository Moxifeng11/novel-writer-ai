import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import {
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
        expect(summary.bySource[1]).toEqual({ source: 'agent', calls: 1, totalTokens: 300 });
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
