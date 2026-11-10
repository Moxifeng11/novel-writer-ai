/**
 * D3-7（维度② r3）：回滚终态之后的附加写入失败必须可见。
 *
 * 旧实现：V2 关系/承诺账本/角色弧线失败只设内部 hasPartialFailure，
 * SettlementResult 没有该字段 → 结算表仍写「已完成」、步骤/批量继续按成功推进。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { SettlementEngine, type SettlementResult } from '../../../engine/settlement-engine';
import { writeSettlementArtifacts } from '../../../engine/settlement/settlement-coordinator';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function baseResult(): SettlementResult {
    return {
        updated: 1, created: 0, updatedChars: 1, updatedForeshadows: 0,
        rejectedFields: [], missingEntities: [], linkFieldWrites: 0,
        updatedFactions: 0, updatedLocations: 0, updatedItems: 0,
        updatedRelations: 0, updatedGrowth: 0, updatedEmotions: 0,
        createdChars: 0, createdLocs: 0, createdFactions: 0, createdItems: 0,
        createdForeshadows: 0, createdTimelines: 0,
        chars: [], locs: [], factions: [], items: [],
    };
}

describe('SettlementEngine.markPostStepFailure', () => {
    it('把附加步骤失败写进 result.partialFailure 并置 hasPartialFailure', () => {
        const engine = new SettlementEngine({} as never, { showNotice: () => undefined } as never);
        const ctx = { hasPartialFailure: false, result: baseResult() };

        (engine as unknown as { markPostStepFailure: (c: unknown, label: string) => void })
            .markPostStepFailure(ctx, '承诺账本');

        expect(ctx.hasPartialFailure).toBe(true);
        expect(ctx.result.partialFailure).toEqual(['承诺账本']);
    });

    it('同一标签重复标记不重复入列', () => {
        const engine = new SettlementEngine({} as never, { showNotice: () => undefined } as never);
        const ctx = { hasPartialFailure: false, result: baseResult() };
        const call = (engine as unknown as { markPostStepFailure: (c: unknown, label: string) => void }).markPostStepFailure;

        call(ctx, '关系状态');
        call(ctx, '关系状态');
        call(ctx, '角色弧线');

        expect(ctx.result.partialFailure).toEqual(['关系状态', '角色弧线']);
    });
});

describe('writeSettlementArtifacts — partialFailure', () => {
    it('附加步骤失败时不写表/快照/总览，并给出可重跑提示', async () => {
        const ports = {
            writeSettlementTable: vi.fn(async () => undefined),
            writeSnapshot: vi.fn(async () => undefined),
            refreshNarrativeOverview: vi.fn(async () => undefined),
        };

        const report = await writeSettlementArtifacts({
            chapterName: '第1章',
            volume: '第1卷',
            mode: 'full',
            result: { ...baseResult(), partialFailure: ['承诺账本', '角色弧线'] },
        }, ports);

        expect(report.written).toEqual([]);
        expect(ports.writeSettlementTable).not.toHaveBeenCalled();
        expect(ports.writeSnapshot).not.toHaveBeenCalled();
        expect(ports.refreshNarrativeOverview).not.toHaveBeenCalled();
        expect(report.warnings[0]).toContain('附加步骤失败');
        expect(report.warnings[0]).toContain('承诺账本');
    });
});

describe('D3-7 接线契约', () => {
    it('三个附加步骤的 catch 都走 markPostStepFailure', () => {
        const src = read('engine/settlement-engine.ts');
        expect(src).toContain("this.markPostStepFailure(ctx, '关系状态')");
        expect(src).toContain("this.markPostStepFailure(ctx, '承诺账本')");
        expect(src).toContain("this.markPostStepFailure(ctx, '角色弧线')");
    });

    it('五个调用方都按 partialFailure 判失败', () => {
        for (const rel of [
            'engine/step-settlement.ts',
            'engine/step-runner.ts',
            'ui/chapter-settlement-modal.ts',
            'ui/full-writer/batch-pipeline-runner.ts',
            'ui/write-chapter-modal.ts',
        ]) {
            expect(read(rel)).toContain('partialFailure?.length');
        }
    });
});
