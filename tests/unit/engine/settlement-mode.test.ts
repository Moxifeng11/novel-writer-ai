/**
 * 结算形态（full / light / empty）语义回归
 *
 * 决策依据：docs/design/g1-authority-decisions.md §2
 * - settle 解析出 0 条指令 → mode=empty，且不执行任何写入
 * - settle 正常执行 → mode=full
 * - settleLight = 出场确认 → mode=light
 */
import { describe, expect, it, vi } from 'vitest';
import { SettlementEngine } from '../../../engine/settlement-engine';

const STEP_METHODS = [
    'settleStep_updateCharacters',
    'settleStep_updateFactions',
    'settleStep_updateLocations',
    'settleStep_updateItems',
    'settleStep_updateForeshadows',
    'settleStep_createCharacters',
    'settleStep_createLocations',
    'settleStep_createFactions',
    'settleStep_createItems',
    'settleStep_createForeshadows',
    'settleStep_createTimelines',
    'settleStep_verifyForeshadowLoop',
    'settleStep_recordBehaviors',
    'settleStep_updateRelations',
    'settleStep_updateGrowth',
    'settleStep_updateEmotions',
    'settleStep_updateBodyFrontmatter',
    'settleStep_deleteEntities',
    'settleStep_finalizeRollback',
    'settleStep_updateV2Relations',
    'settleStep_updatePromiseLedger',
    'settleStep_updateCharacterArcs',
    'refreshInfoDebt',
] as const;

function makeSettleStub() {
    const calls: string[] = [];
    const stub: Record<string, unknown> = {
        settleStep_reportGuards: () => undefined,
        settleStep_aggregateAndMaybeRollback: () => undefined,
    };
    for (const name of STEP_METHODS) {
        stub[name] = async () => { calls.push(name); };
    }
    return { stub, calls };
}

const settleFn = (SettlementEngine.prototype as unknown as {
    settle: (this: unknown, project: string, chapDir: string, chapName: string, report: string, body: string, options?: unknown) => Promise<{ mode?: string; updated: number }>;
}).settle;

describe('settle — 空指令集守卫', () => {
    it('报告为空 → mode=empty 且不执行任何结算步骤', async () => {
        const { stub, calls } = makeSettleStub();
        const result = await settleFn.call(stub, 'P', 'P/03-大纲与章节/步骤结果/第1卷/第1章', '第1章', '', '正文');
        expect(result.mode).toBe('empty');
        expect(calls).toEqual([]);
        expect(result.updated).toBe(0);
    });

    it('报告只有无关文本（无可解析指令）→ 同样是 empty', async () => {
        const { stub, calls } = makeSettleStub();
        const result = await settleFn.call(stub, 'P', 'P/03-大纲与章节/步骤结果/第1卷/第1章', '第1章', '这是一段普通分析文字，没有指令行。', '正文');
        expect(result.mode).toBe('empty');
        expect(calls).toEqual([]);
    });

    it('有指令 → 走完整结算并标记 mode=full', async () => {
        const { stub, calls } = makeSettleStub();
        const report = 'UPDATE_CHARACTER: [[甲]] | 当前状态 | 受伤';
        const result = await settleFn.call(stub, 'P', 'P/03-大纲与章节/步骤结果/第1卷/第1章', '第1章', report, '正文');
        expect(result.mode).toBe('full');
        expect(calls.length).toBeGreaterThan(0);
        expect(calls).toContain('settleStep_updateCharacters');
    });

    it('只有强制揭示也算有指令（不能判成 empty）', async () => {
        const { stub } = makeSettleStub();
        const result = await settleFn.call(
            stub, 'P', 'P/03-大纲与章节/步骤结果/第1卷/第1章', '第1章', '', '正文',
            { forceReveal: ['玉佩'] },
        );
        expect(result.mode).toBe('full');
    });
});

describe('settleLight — 出场确认语义', () => {
    it('返回 mode=light，且不触碰关系/伏笔/时间线步骤', async () => {
        const calls: string[] = [];
        const stub = {
            getVaultMeta: () => ({ getAbstractFileByPath: () => null }),
            getFrontmatter: () => ({ processFrontmatter: async () => undefined }),
            getFS: () => ({ read: async () => '', write: async () => undefined }),
            refreshInfoDebt: async () => { calls.push('refreshInfoDebt'); },
            moveForeshadowToRevealed: () => null,
        };
        const fn = (SettlementEngine.prototype as unknown as {
            settleLight: (this: unknown, project: string, chapDir: string, chapName: string, body: string, options?: unknown) => Promise<{ mode?: string; updated: number }>;
        }).settleLight;

        const result = await fn.call(stub, 'P', 'P/03-大纲与章节/步骤结果/第1卷/第1章', '第1章', '---\nstatus: written\n---\n正文', undefined);

        expect(result.mode).toBe('light');
        expect(result.updated).toBe(0);
        expect(calls).toContain('refreshInfoDebt');
    });
});

void vi;
