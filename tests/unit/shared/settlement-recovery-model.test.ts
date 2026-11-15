/**
 * 结算恢复面板：展示逻辑（预览 / 单章 / 汇总）
 */

import { describe, expect, it } from 'vitest';
import {
    describeSettlementOutcome,
    describeSettlementPreview,
    describeSettlementRow,
    hasPendingSettlement,
    type SettlementRecoveryRow,
} from '@/shared/settlement-recovery-model';

const row = (overrides: Partial<SettlementRecoveryRow> = {}): SettlementRecoveryRow => ({
    chapterName: '第一章',
    entries: 2,
    reverted: 0,
    failed: 0,
    cleared: false,
    ...overrides,
});

describe('hasPendingSettlement', () => {
    it('只看 entries > 0', () => {
        expect(hasPendingSettlement([])).toBe(false);
        expect(hasPendingSettlement([row({ entries: 0 })])).toBe(false);
        expect(hasPendingSettlement([row()])).toBe(true);
    });
});

describe('describeSettlementPreview', () => {
    it('无残留时说明上次结算完整', () => {
        expect(describeSettlementPreview([])[0]).toContain('没有发现残留');
    });

    it('有残留时给出章节数与条目总数', () => {
        const lines = describeSettlementPreview([row(), row({ chapterName: '第二章', entries: 3 })]);
        expect(lines[0]).toContain('2 个章节');
        expect(lines[0]).toContain('共 5 条');
    });
});

describe('describeSettlementRow', () => {
    it('预览模式只报待回滚条数', () => {
        expect(describeSettlementRow(row(), true)).toBe('第一章：2 条待回滚');
    });

    it('全部成功时提示日志已清理', () => {
        expect(describeSettlementRow(row({ reverted: 2, cleared: true }), false)).toBe('第一章：回滚 2 条，日志已清理');
    });

    it('有失败时提示日志保留可重试', () => {
        const text = describeSettlementRow(row({ reverted: 1, failed: 1 }), false);
        expect(text).toContain('失败 1');
        expect(text).toContain('可重试');
    });
});

describe('describeSettlementOutcome', () => {
    it('空结果与成功/失败汇总', () => {
        expect(describeSettlementOutcome([])).toBe('没有可恢复的章节。');
        expect(describeSettlementOutcome([row({ reverted: 2, cleared: true })])).toContain('回滚 2 条，日志已清理');
        expect(describeSettlementOutcome([row({ reverted: 1, failed: 1 })])).toContain('1 条失败');
    });
});
