import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * B9 架构契约：把「单一入口」写成可执行断言，防止后续批次又绕回旧实现。
 * 只做源码级存在性/禁用模式检查，不启动 Obsidian。
 */

const ROOT = path.resolve(__dirname, '../../..');

function source(relative: string): string {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('架构契约 — 故事台账单源', () => {
    it('结算与分析报告通过 ledger-write 写时间线/伏笔', () => {
        const settlement = source('engine/settlement-engine.ts');
        const analysis = source('engine/analysis-report-engine.ts');
        for (const text of [settlement, analysis]) {
            expect(text).toContain('appendEventToContent');
            expect(text).toContain('appendForeshadowToContent');
            expect(text).toContain("from './ledger/ledger-write'");
        }
    });

    it('上下文读取通过 ledger-io，而不是各自解析', () => {
        const manager = source('engine/context-manager.ts');
        expect(manager).toContain("from './ledger/ledger-io'");
        expect(manager).toContain('loadStoryLedger');
        expect(manager).toContain('toForeshadowData');
        expect(manager).toContain('toTimelineEvents');
    });

    it('旧 NW-LINKAGE 块不再写入业务文件', () => {
        const manager = source('engine/context-manager.ts');
        expect(manager).not.toContain('upsertLinkageBlock');
        expect(manager).toContain('pjStoryLedgerIndex');
    });
});

describe('架构契约 — 关系与一致性', () => {
    it('关系机器读取只走 loadRelationshipStates，且 V2 合并待确认队列', () => {
        const settlement = source('engine/settlement-engine.ts');
        expect(settlement).toContain('loadRelationshipStates');
        expect(settlement).toContain('loadPendingRelationshipChanges');
        expect(settlement).toContain('consumePendingRelationshipChanges');
    });

    it('分析报告与正文门禁都会跑人物一致性', () => {
        const analysis = source('engine/analysis-report-engine.ts');
        const runner = source('engine/step-runner.ts');
        expect(analysis).toContain('attachCharacterConsistencyToReport');
        expect(analysis).toContain('writeConsistencyReport');
        expect(runner).toContain('runProjectCharacterConsistency');
        expect(runner).toContain('characterReport');
    });
});

describe('架构契约 — 超长上下文不静默截断', () => {
    it('步骤装配使用 recoverOverflow 并在仍超预算时抛错', () => {
        const assembly = source('engine/step-prompt-assembly.ts');
        expect(assembly).toContain('recoverOverflow');
        expect(assembly).toContain('ContextOverflowError');
    });

    it('短篇/剧本写入都有预算闸门', () => {
        expect(source('engine/mode-unit-writer.ts')).toContain('recoverOverflow');
        expect(source('engine/mode-document-writer.ts')).toContain('recoverOverflow');
    });

    it('压缩器不再按“扩尾”退化 / 不再先砍世界观', () => {
        const compressor = source('engine/context-compressor.ts');
        expect(compressor).not.toContain('tailCount += 1');
        expect(compressor).toContain('cutHalfAtBoundary');
    });
});
