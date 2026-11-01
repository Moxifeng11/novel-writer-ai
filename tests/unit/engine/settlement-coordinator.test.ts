/**
 * 结算后产物统一编排（Wave B-2）
 *
 * 顺序固定「表 → 快照 → 总览」，非关键产物失败只记 warning；
 * 空指令集不写任何产物；轻量结算不重建总览。
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    settlementArtifactNotice,
    writeSettlementArtifacts,
    type SettlementArtifactInput,
} from '../../../engine/settlement/settlement-coordinator';

const RESULT = {
    updatedChars: 1,
    updatedForeshadows: 0,
    createdChars: 1,
    createdLocs: 0,
    createdFactions: 0,
    createdItems: 0,
    createdForeshadows: 0,
    createdTimelines: 0,
};

function input(overrides: Partial<SettlementArtifactInput> = {}): SettlementArtifactInput {
    return { chapterName: '第3章', volume: '第1卷', mode: 'full', result: RESULT, ...overrides };
}

describe('writeSettlementArtifacts', () => {
    it('完整结算按 表→快照→总览 执行', async () => {
        const order: string[] = [];
        const tableTexts: string[] = [];
        const report = await writeSettlementArtifacts(input(), {
            writeSettlementTable: async text => { order.push('table'); tableTexts.push(text); },
            writeSnapshot: async () => { order.push('snapshot'); },
            refreshNarrativeOverview: async () => { order.push('overview'); },
        });
        expect(order).toEqual(['table', 'snapshot', 'overview']);
        expect(report.written).toEqual(['table', 'snapshot', 'overview']);
        expect(report.warnings).toEqual([]);
        expect(tableTexts[0]).toContain('settlement_mode: full');
        expect(tableTexts[0]).toContain('卷: "第1卷"');
    });

    it('轻量结算用调用方表格，不重建总览', async () => {
        const tableTexts: string[] = [];
        const overview = vi.fn(async () => {});
        const report = await writeSettlementArtifacts(input({ mode: 'light', tableText: '轻量表' }), {
            writeSettlementTable: async text => { tableTexts.push(text); },
            writeSnapshot: async () => {},
            refreshNarrativeOverview: overview,
        });
        expect(tableTexts).toEqual(['轻量表']);
        expect(overview).not.toHaveBeenCalled();
        expect(report.written).toEqual(['table', 'snapshot']);
    });

    it('空指令集不写任何产物', async () => {
        const write = vi.fn(async () => {});
        const report = await writeSettlementArtifacts(input({ mode: 'empty' }), {
            writeSettlementTable: write,
            writeSnapshot: write,
            refreshNarrativeOverview: write,
        });
        expect(write).not.toHaveBeenCalled();
        expect(report.written).toEqual([]);
    });

    it('表写入失败不阻断快照/总览，并汇总 warning', async () => {
        const snapshot = vi.fn(async () => {});
        const overview = vi.fn(async () => {});
        const report = await writeSettlementArtifacts(input(), {
            writeSettlementTable: async () => { throw new Error('磁盘只读'); },
            writeSnapshot: snapshot,
            refreshNarrativeOverview: overview,
        });
        expect(snapshot).toHaveBeenCalledOnce();
        expect(overview).toHaveBeenCalledOnce();
        expect(report.written).toEqual(['snapshot', 'overview']);
        expect(report.warnings[0]).toContain('结算表写入失败');
        expect(settlementArtifactNotice(report)).toContain('磁盘只读');
    });

    it('没有表格端口时只写快照与总览（批量路径）', async () => {
        const report = await writeSettlementArtifacts(input(), {
            writeSnapshot: async () => {},
            refreshNarrativeOverview: async () => {},
        });
        expect(report.written).toEqual(['snapshot', 'overview']);
    });
});

describe('源码约束：入口不再各自写产物', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

    it('一键成文与步骤路径都走协调器', () => {
        expect(read('ui/write-chapter-modal.ts')).toContain('writeSettlementArtifacts({');
        expect(read('engine/step-runner.ts')).toContain('writeSettlementArtifacts({');
    });

    it('步骤结算不再自己写叙事总览（避免与协调器重复）', () => {
        const source = read('engine/step-settlement.ts');
        expect(source).not.toContain('generateNarrativeOverview');
        expect(source).not.toContain('pjNarrativeOverview');
    });
});
