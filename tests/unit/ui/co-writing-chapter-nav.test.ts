/**
 * 章节流转测试（2026-11-16，E-02 / C1）
 *
 * 缺陷背景：视图内没有切章入口，每写完一章都要回工作台再进来。
 */
import { describe, expect, it } from 'vitest';
import {
    findChapterNeighbors,
    parseChapterNumber,
    type NavChapter,
} from '../../../ui/co-writing/chapter-nav';

const list: NavChapter[] = [
    { chapter: '第1章', volume: '第1卷', title: '起', number: 1 },
    { chapter: '第2章', volume: '第1卷', title: '承', number: 2 },
    { chapter: '第3章', volume: '第2卷', title: '转', number: 3 },
];

describe('parseChapterNumber', () => {
    it('解析「第N章」', () => {
        expect(parseChapterNumber('第12章')).toBe(12);
    });

    it('支持节/集/回/幕', () => {
        expect(parseChapterNumber('第3节')).toBe(3);
        expect(parseChapterNumber('第4集')).toBe(4);
        expect(parseChapterNumber('第5回')).toBe(5);
        expect(parseChapterNumber('第6幕')).toBe(6);
    });

    it('无法解析返回 0', () => {
        expect(parseChapterNumber('序章')).toBe(0);
        expect(parseChapterNumber('')).toBe(0);
    });
});

describe('findChapterNeighbors', () => {
    it('中间章节有上一章与下一章', () => {
        const result = findChapterNeighbors(list, '第2章');
        expect(result.previous?.chapter).toBe('第1章');
        expect(result.next?.chapter).toBe('第3章');
        expect(result.total).toBe(3);
        expect(result.index).toBe(1);
    });

    it('首章没有上一章', () => {
        expect(findChapterNeighbors(list, '第1章').previous).toBeNull();
    });

    it('末章没有下一章', () => {
        expect(findChapterNeighbors(list, '第3章').next).toBeNull();
    });

    it('跨卷时下一章正确（第1卷 → 第2卷）', () => {
        const result = findChapterNeighbors(list, '第2章');
        expect(result.next?.volume).toBe('第2卷');
    });

    it('乱序输入也能正确排序', () => {
        const shuffled = [list[2], list[0], list[1]];
        const result = findChapterNeighbors(shuffled, '第2章');
        expect(result.previous?.chapter).toBe('第1章');
        expect(result.next?.chapter).toBe('第3章');
    });

    it('当前章不在列表时按章号推断邻居', () => {
        const result = findChapterNeighbors(list, '第2章');
        expect(result.index).toBeGreaterThanOrEqual(0);
        const missing = findChapterNeighbors([list[0], list[2]], '第2章');
        expect(missing.index).toBe(-1);
        expect(missing.previous?.chapter).toBe('第1章');
        expect(missing.next?.chapter).toBe('第3章');
    });

    it('空列表安全', () => {
        const result = findChapterNeighbors([], '第1章');
        expect(result).toEqual({ index: -1, total: 0, previous: null, next: null });
    });

    it('章名无数字时下一章为首章', () => {
        const result = findChapterNeighbors(list, '序章');
        expect(result.next?.chapter).toBe('第1章');
        expect(result.previous).toBeNull();
    });
});
