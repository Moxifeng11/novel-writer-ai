import { describe, expect, it } from 'vitest';
import { shouldShowSettlementBadge } from '@/ui/co-writing/settlement-actions';

describe('settlement-actions — 待结算判定', () => {
    it('written 且未 settled 时显示待结算', () => {
        expect(shouldShowSettlementBadge('---\nstatus: written\n---\n')).toBe(true);
    });

    it('已完稿中文状态同样显示', () => {
        expect(shouldShowSettlementBadge('---\nstatus: 已完稿\n---\n')).toBe(true);
    });

    it('settled 时不显示', () => {
        expect(shouldShowSettlementBadge('---\nstatus: settled\n---\n')).toBe(false);
    });

    it('同时含 written 与 settled 时以 settled 为准', () => {
        expect(shouldShowSettlementBadge('status: written\nstatus: settled')).toBe(false);
    });

    it('draft / 空内容不显示', () => {
        expect(shouldShowSettlementBadge('status: draft')).toBe(false);
        expect(shouldShowSettlementBadge('')).toBe(false);
    });
});
