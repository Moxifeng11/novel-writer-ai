/**
 * 显示参数与光标信息测试（2026-11-16，E-06 / E-10）
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FONT_SIZE,
    DEFAULT_LINE_HEIGHT,
    formatCursorInfo,
    getCursorPosition,
    getSelectionCount,
    normalizeFontSize,
    normalizeLineHeight,
} from '../../../ui/co-writing/editor-display';

describe('normalizeFontSize', () => {
    it('合法值原样返回', () => {
        expect(normalizeFontSize(18)).toBe(18);
    });

    it('非法值回退默认', () => {
        expect(normalizeFontSize(undefined)).toBe(DEFAULT_FONT_SIZE);
        expect(normalizeFontSize(0)).toBe(DEFAULT_FONT_SIZE);
        expect(normalizeFontSize('abc')).toBe(DEFAULT_FONT_SIZE);
    });

    it('越界/非列表值取最近合法值', () => {
        expect(normalizeFontSize(19)).toBe(18);
        expect(normalizeFontSize(100)).toBe(24);
        expect(normalizeFontSize(1)).toBe(14);
    });
});

describe('normalizeLineHeight', () => {
    it('合法值原样返回', () => {
        expect(normalizeLineHeight(1.8)).toBe(1.8);
    });

    it('非法值回退默认', () => {
        expect(normalizeLineHeight(null)).toBe(DEFAULT_LINE_HEIGHT);
    });

    it('取最近合法值', () => {
        expect(normalizeLineHeight(1.7)).toBe(1.6);
        expect(normalizeLineHeight(9)).toBe(2.2);
    });
});

describe('getCursorPosition', () => {
    it('首行首列', () => {
        expect(getCursorPosition('abc', 0)).toEqual({ line: 1, column: 1 });
    });

    it('第二行某列', () => {
        expect(getCursorPosition('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    });

    it('换行符后即新行首', () => {
        expect(getCursorPosition('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    });

    it('越界偏移被夹紧', () => {
        expect(getCursorPosition('ab', 99)).toEqual({ line: 1, column: 3 });
        expect(getCursorPosition('ab', -5)).toEqual({ line: 1, column: 1 });
    });
});

describe('getSelectionCount / formatCursorInfo', () => {
    it('无选区为 0', () => {
        expect(getSelectionCount('abcdef', 2, 2)).toBe(0);
    });

    it('反向选区也能算长度', () => {
        expect(getSelectionCount('abcdef', 4, 1)).toBe(3);
    });

    it('文案包含行列', () => {
        expect(formatCursorInfo('ab', 0, 0)).toBe('第 1 行 第 1 列');
    });

    it('有选区时补选中字数', () => {
        expect(formatCursorInfo('abcdef', 1, 4)).toBe('第 1 行 第 2 列 · 选中 3 字');
    });
});
