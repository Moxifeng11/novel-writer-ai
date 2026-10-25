import { describe, it, expect } from 'vitest';
import { resolveCursorPosition } from '../../../shared/cursor-position';

describe('resolveCursorPosition — 光标位置 0 不再被当成「没有光标」', () => {
    it('TP-1: 光标在开头且正文非空 → 0（回归：旧写法会当成文末）', () => {
        expect(resolveCursorPosition(0, 1200)).toBe(0);
    });

    it('TP-2: selectionStart 为 null → 回退到文末', () => {
        expect(resolveCursorPosition(null, 800)).toBe(800);
    });

    it('TP-3: selectionStart 为 undefined → 回退到文末', () => {
        expect(resolveCursorPosition(undefined, 800)).toBe(800);
    });

    it('TP-4: selectionStart 为 NaN → 回退到文末', () => {
        expect(resolveCursorPosition(Number.NaN, 800)).toBe(800);
    });

    it('TP-5: fallback = start 且无光标信息 → 0', () => {
        expect(resolveCursorPosition(null, 800, 'start')).toBe(0);
    });

    it('TP-6: 超出正文长度 → 夹紧到正文长度', () => {
        expect(resolveCursorPosition(9999, 300)).toBe(300);
    });

    it('TP-7: 负数 → 夹紧到 0', () => {
        expect(resolveCursorPosition(-5, 300)).toBe(0);
    });

    it('TP-8: 小数 → 向下取整', () => {
        expect(resolveCursorPosition(42.7, 300)).toBe(42);
    });

    it('TP-9: 空正文与光标 0 → 0', () => {
        expect(resolveCursorPosition(0, 0)).toBe(0);
    });

    it('TP-10: 正文长度非法 → 视为 0，光标值夹紧为 0', () => {
        expect(resolveCursorPosition(50, Number.NaN)).toBe(0);
    });
});
