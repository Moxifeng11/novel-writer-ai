/**
 * 生成确认弹窗的纯逻辑测试（2026-11-27）
 *
 * 从 generate-confirm-modal.ts 抽出的判定/格式化函数。
 */
import { describe, it, expect } from 'vitest';
import {
    needsConfirm, truncatePreview, formatDelta, PREVIEW_LIMIT,
} from '../../../ui/components/generate-confirm-format';

describe('needsConfirm 三档判定', () => {
    it('off 永不确认（含覆盖已有正文）', () => {
        expect(needsConfirm('off', true)).toBe(false);
        expect(needsConfirm('off', false)).toBe(false);
    });

    it('overwrite 仅在目标已存在时确认（新建不打扰）', () => {
        expect(needsConfirm('overwrite', true)).toBe(true);
        expect(needsConfirm('overwrite', false)).toBe(false);
    });

    it('always 每次都确认', () => {
        expect(needsConfirm('always', true)).toBe(true);
        expect(needsConfirm('always', false)).toBe(true);
    });

    it('undefined 视为 overwrite（默认档）', () => {
        expect(needsConfirm(undefined, true)).toBe(true);
        expect(needsConfirm(undefined, false)).toBe(false);
    });
});

describe('truncatePreview 预览截断', () => {
    it('短文本不截断', () => {
        const r = truncatePreview('abc', 10);
        expect(r.text).toBe('abc');
        expect(r.truncated).toBe(false);
    });

    it('超长文本截断到上限', () => {
        const r = truncatePreview('字'.repeat(20), 10);
        expect(r.text).toHaveLength(10);
        expect(r.truncated).toBe(true);
    });

    it('边界：正好等于上限时不截断', () => {
        const r = truncatePreview('字'.repeat(10), 10);
        expect(r.truncated).toBe(false);
    });

    it('默认上限是 PREVIEW_LIMIT', () => {
        const r = truncatePreview('字'.repeat(PREVIEW_LIMIT + 1));
        expect(r.text).toHaveLength(PREVIEW_LIMIT);
        expect(r.truncated).toBe(true);
    });
});

describe('formatDelta 字数变化', () => {
    it('增加显示 +N', () => {
        expect(formatDelta(2650, 2500)).toBe('+150');
    });

    it('减少显示 -N', () => {
        expect(formatDelta(2400, 2500)).toBe('-100');
    });

    it('差异小于 20 显示「基本持平」', () => {
        expect(formatDelta(2505, 2500)).toBe('基本持平');
        expect(formatDelta(2485, 2500)).toBe('基本持平');
    });

    it('边界：正好 20 差异算变化', () => {
        expect(formatDelta(2520, 2500)).toBe('+20');
    });
});
