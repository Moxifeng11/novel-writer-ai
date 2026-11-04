import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import { getUsageLedger, resetUsageLedger, summarizeUsage, type UsageRecord } from '../../../services/usage-ledger';

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
});
