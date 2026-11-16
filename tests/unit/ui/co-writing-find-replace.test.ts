/**
 * 查找/替换测试（2026-11-16，E-01 / B1）
 *
 * 缺陷背景：协同视图没有查找替换，Ctrl+F 被 Obsidian 全局搜索接管。
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FIND_OPTIONS,
    findMatches,
    isWholeWordAt,
    nextMatchIndex,
    replaceAll,
    replaceOne,
} from '../../../ui/co-writing/find-replace';

describe('findMatches', () => {
    it('默认不区分大小写', () => {
        const matches = findMatches('abc ABC', 'abc');
        expect(matches).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }]);
    });

    it('区分大小写', () => {
        const matches = findMatches('abc ABC', 'abc', { ...DEFAULT_FIND_OPTIONS, caseSensitive: true });
        expect(matches).toEqual([{ start: 0, end: 3 }]);
    });

    it('中文匹配', () => {
        const matches = findMatches('他抬起头，看向远方。他抬起头。', '他抬起头');
        expect(matches).toHaveLength(2);
        expect(matches[0].start).toBe(0);
    });

    it('全词匹配排除子串', () => {
        const text = 'cat category cat';
        const matches = findMatches(text, 'cat', { ...DEFAULT_FIND_OPTIONS, wholeWord: true });
        expect(matches.map(m => m.start)).toEqual([0, 13]);
    });

    it('空查询返回空数组', () => {
        expect(findMatches('abc', '')).toEqual([]);
    });

    it('正则模式', () => {
        const matches = findMatches('a1 b2 c3', '\\b[a-z]\\d\\b', { ...DEFAULT_FIND_OPTIONS, regex: true });
        expect(matches).toHaveLength(3);
    });

    it('非法正则静默返回空数组', () => {
        expect(findMatches('abc', '([', { ...DEFAULT_FIND_OPTIONS, regex: true })).toEqual([]);
    });

    it('零宽正则不进入死循环', () => {
        const matches = findMatches('abc', '(?=b)', { ...DEFAULT_FIND_OPTIONS, regex: true });
        expect(matches.length).toBeLessThanOrEqual(1);
    });

    it('重复命中全部返回', () => {
        expect(findMatches('aaaa', 'aa')).toHaveLength(2);
    });
});

describe('isWholeWordAt', () => {
    it('独立单词为真', () => {
        expect(isWholeWordAt('a cat b', 2, 5)).toBe(true);
    });

    it('子串为假', () => {
        expect(isWholeWordAt('category', 0, 3)).toBe(false);
    });

    it('中文边界按汉字判定', () => {
        expect(isWholeWordAt('说文字', 1, 2)).toBe(false);
    });
});

describe('nextMatchIndex', () => {
    const matches = [{ start: 0, end: 1 }, { start: 5, end: 6 }, { start: 10, end: 11 }];

    it('向下找下一个', () => {
        expect(nextMatchIndex(matches, 2, 1)).toBe(1);
    });

    it('末尾回绕到第一个', () => {
        expect(nextMatchIndex(matches, 10, 1)).toBe(0);
    });

    it('向上找上一个', () => {
        expect(nextMatchIndex(matches, 6, -1)).toBe(1);
    });

    it('开头回绕到最后一个', () => {
        expect(nextMatchIndex(matches, 0, -1)).toBe(2);
    });

    it('无命中返回 -1', () => {
        expect(nextMatchIndex([], 0, 1)).toBe(-1);
    });
});

describe('replaceOne / replaceAll', () => {
    it('替换一处并给出新光标', () => {
        const result = replaceOne('abc def', { start: 0, end: 3 }, 'X');
        expect(result.text).toBe('X def');
        expect(result.cursor).toBe(1);
    });

    it('替换全部并计数', () => {
        const text = 'a b a b a';
        const matches = findMatches(text, 'a');
        const result = replaceAll(text, matches, 'z');
        expect(result.text).toBe('z b z b z');
        expect(result.count).toBe(3);
    });

    it('替换文本含查找词也不重复替换', () => {
        const text = 'aa';
        const matches = findMatches(text, 'a');
        const result = replaceAll(text, matches, 'aa');
        expect(result.text).toBe('aaaa');
        expect(result.count).toBe(2);
    });

    it('空命中列表不改变正文', () => {
        expect(replaceAll('abc', [], 'X')).toEqual({ text: 'abc', count: 0 });
    });
});
