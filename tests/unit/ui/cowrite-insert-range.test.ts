/**
 * cowrite-insert-range.test.ts — 插入区间解析
 *
 * 锁定两个真实缺陷：
 * 1. 改写候选必须替换发起改写时的选区；用户中途点过别处也不能插到新光标；
 * 2. 浮窗把过期改写范围套到普通建议上会删掉一段无关正文 ——
 *    普通建议（pendingRewrite = null）永远只能插当前光标。
 */

import { describe, it, expect } from 'vitest';
import { resolveInsertRange } from '../../../ui/cowrite/insert-range';

const TEXT = '第一句话。第二句话。第三句话。';

describe('resolveInsertRange', () => {
    it('无改写区间时用当前光标（无选区 = 纯插入）', () => {
        const range = resolveInsertRange({ text: TEXT, selectionStart: 5, selectionEnd: 5 });
        expect(range).toEqual({ start: 5, end: 5, fromPendingRewrite: false, staleRewrite: false });
    });

    it('无改写区间时替换当前选区', () => {
        const range = resolveInsertRange({ text: TEXT, selectionStart: 6, selectionEnd: 11 });
        expect(range.start).toBe(6);
        expect(range.end).toBe(11);
        expect(range.fromPendingRewrite).toBe(false);
    });

    it('改写区间原文未变时优先使用改写区间（而不是当前光标）', () => {
        const originalText = TEXT.slice(6, 11);
        const range = resolveInsertRange({
            text: TEXT,
            // 用户中途把光标移到了开头
            selectionStart: 0,
            selectionEnd: 0,
            pendingRewrite: { start: 6, end: 11, originalText },
        });
        expect(range).toEqual({ start: 6, end: 11, fromPendingRewrite: true, staleRewrite: false });
    });

    it('改写区间已被改动时回退到当前选区并标记 stale', () => {
        const range = resolveInsertRange({
            text: TEXT.replace('第二句话', '被改过的句子'),
            selectionStart: 3,
            selectionEnd: 3,
            pendingRewrite: { start: 6, end: 11, originalText: '第二句话。' },
        });
        expect(range.fromPendingRewrite).toBe(false);
        expect(range.staleRewrite).toBe(true);
        expect(range.start).toBe(3);
    });

    it('区间越界时按正文长度收敛，不抛错', () => {
        const range = resolveInsertRange({
            text: '短文本',
            selectionStart: 999,
            selectionEnd: 999,
        });
        expect(range.start).toBe(3);
        expect(range.end).toBe(3);
    });

    it('改写区间越界且原文为空时不会误判为「未变」', () => {
        const range = resolveInsertRange({
            text: '短文本',
            selectionStart: 1,
            selectionEnd: 1,
            pendingRewrite: { start: 10, end: 20, originalText: '不存在的原文' },
        });
        expect(range.fromPendingRewrite).toBe(false);
        expect(range.staleRewrite).toBe(false);
    });
});
