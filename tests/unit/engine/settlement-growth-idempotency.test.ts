/**
 * 结算重复执行的幂等性——成长记录追加
 *
 * 背景：弹窗结算此前没有 settled 守卫，同章重复结算会把「变更记录」重复 append。
 * 现在按「章 + 类型 + 新值」去重，且整段读改写走 withWriteLock。
 */
import { describe, expect, it } from 'vitest';
import { TFile } from '../../__mocks__/obsidian';
import { SettlementEngine } from '../../../engine/settlement-engine';

type GrowthCtx = {
    project: string;
    chapName: string;
    instr: { growth: Array<{ name: string; type: string; value: string; desc: string }> };
    result: { updatedGrowth: number };
    hasPartialFailure: boolean;
};

function makeStub(initial: string) {
    const writes: string[] = [];
    let content = initial;
    const file = new TFile();
    const stub = {
        getVaultMeta: () => ({ getAbstractFileByPath: () => file }),
        getFS: () => ({
            read: async () => content,
            write: async (_path: string, next: string) => { content = next; writes.push(next); },
        }),
    };
    return { stub, writes, getContent: () => content };
}

const GROWTH = {
    growth: [{ name: '林惊鸿', type: '境界', value: '筑基中期', desc: '突破' }],
};

describe('SettlementEngine — 成长追加幂等', () => {
    it('同章同类型同值重复结算只写一次', async () => {
        const { stub, writes, getContent } = makeStub('# 林惊鸿\n\n## 变更记录\n');
        const fn = (SettlementEngine.prototype as unknown as {
            settleStep_updateGrowth: (this: unknown, ctx: GrowthCtx) => Promise<void>;
        }).settleStep_updateGrowth;

        const ctx1: GrowthCtx = { project: 'P', chapName: '第1章', instr: GROWTH, result: { updatedGrowth: 0 }, hasPartialFailure: false };
        await fn.call(stub, ctx1);
        const ctx2: GrowthCtx = { project: 'P', chapName: '第1章', instr: GROWTH, result: { updatedGrowth: 0 }, hasPartialFailure: false };
        await fn.call(stub, ctx2);

        expect(writes).toHaveLength(1);
        expect(ctx1.result.updatedGrowth).toBe(1);
        expect(ctx2.result.updatedGrowth).toBe(0);
        const occurrences = getContent().split('第1章 | 境界 | 筑基中期').length - 1;
        expect(occurrences).toBe(1);
    });

    it('不同章可以继续追加', async () => {
        const { stub, writes } = makeStub('# 林惊鸿\n\n## 变更记录\n');
        const fn = (SettlementEngine.prototype as unknown as {
            settleStep_updateGrowth: (this: unknown, ctx: GrowthCtx) => Promise<void>;
        }).settleStep_updateGrowth;

        await fn.call(stub, { project: 'P', chapName: '第1章', instr: GROWTH, result: { updatedGrowth: 0 }, hasPartialFailure: false });
        await fn.call(stub, { project: 'P', chapName: '第2章', instr: GROWTH, result: { updatedGrowth: 0 }, hasPartialFailure: false });

        expect(writes).toHaveLength(2);
    });

    it('没有「变更记录」区块时自动补区块', async () => {
        const { stub, getContent } = makeStub('# 林惊鸿\n');
        const fn = (SettlementEngine.prototype as unknown as {
            settleStep_updateGrowth: (this: unknown, ctx: GrowthCtx) => Promise<void>;
        }).settleStep_updateGrowth;

        await fn.call(stub, { project: 'P', chapName: '第3章', instr: GROWTH, result: { updatedGrowth: 0 }, hasPartialFailure: false });

        expect(getContent()).toContain('## 变更记录');
        expect(getContent()).toContain('第3章 | 境界 | 筑基中期');
    });
});
