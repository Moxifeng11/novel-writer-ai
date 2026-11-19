/**
 * 撤销/重做栈测试（2026-11-16，E-04）
 */
import { describe, expect, it } from 'vitest';
import {
    canUndoRedo,
    ChapterHistoryStore,
    createHistory,
    MAX_HISTORY_ENTRIES,
    pushHistory,
    redoHistory,
    undoHistory,
} from '../../../shared/edit-history';

describe('pushHistory / undo / redo', () => {
    it('初始不可撤销不可重做', () => {
        const history = createHistory('a');
        expect(canUndoRedo(history)).toEqual({ canUndo: false, canRedo: false });
    });

    it('提交后可撤销', () => {
        const history = createHistory('a');
        pushHistory(history, 'b');
        expect(undoHistory(history)).toBe('a');
    });

    it('重复内容不记录', () => {
        const history = createHistory('a');
        expect(pushHistory(history, 'a')).toBe(false);
        expect(history.stack).toHaveLength(1);
    });

    it('撤销后可重做', () => {
        const history = createHistory('a');
        pushHistory(history, 'b');
        undoHistory(history);
        expect(canUndoRedo(history).canRedo).toBe(true);
        expect(redoHistory(history)).toBe('b');
    });

    it('新提交会截断重做分支', () => {
        const history = createHistory('a');
        pushHistory(history, 'b');
        undoHistory(history);
        pushHistory(history, 'c');
        expect(canUndoRedo(history).canRedo).toBe(false);
        expect(history.stack).toEqual(['a', 'c']);
    });

    it('最旧/最新边界返回 null', () => {
        const history = createHistory('a');
        expect(undoHistory(history)).toBeNull();
        expect(redoHistory(history)).toBeNull();
    });

    it('超过上限时丢弃最旧条目', () => {
        const history = createHistory('start');
        for (let index = 0; index < MAX_HISTORY_ENTRIES + 10; index += 1) {
            pushHistory(history, `v${index}`);
        }
        expect(history.stack).toHaveLength(MAX_HISTORY_ENTRIES);
        expect(history.stack[0]).not.toBe('start');
    });
});

describe('ChapterHistoryStore（跨章保留）', () => {
    it('同一章返回同一历史对象', () => {
        const store = new ChapterHistoryStore();
        const first = store.get('p|第1章', 'a');
        const second = store.get('p|第1章', 'a');
        expect(first).toBe(second);
    });

    it('不同章节互不影响', () => {
        const store = new ChapterHistoryStore();
        const first = store.get('p|第1章', 'a');
        pushHistory(first, 'a2');
        const second = store.get('p|第2章', 'b');
        expect(second.stack).toEqual(['b']);
        expect(store.size()).toBe(2);
    });

    it('切回旧章仍可撤销（核心诉求）', () => {
        const store = new ChapterHistoryStore();
        const history = store.get('p|第1章', 'a');
        pushHistory(history, 'a2');
        const again = store.get('p|第1章', 'a2');
        expect(undoHistory(again)).toBe('a');
    });

    it('clear 清空全部', () => {
        const store = new ChapterHistoryStore();
        store.get('p|a', '');
        store.clear();
        expect(store.size()).toBe(0);
    });
});
