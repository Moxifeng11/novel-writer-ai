import { describe, expect, it } from 'vitest';
import {
    chapterDistance,
    chapterNumber,
    parseChapterRange,
    parseChapterRef,
    sameChapter,
} from '../../../shared/chapter-ref';

describe('chapter-ref — 单章解析', () => {
    it('阿拉伯数字与中文数字都能解析', () => {
        expect(chapterNumber('第12章')).toBe(12);
        expect(chapterNumber('第十二章')).toBe(12);
        expect(chapterNumber('第一百零八章')).toBe(108);
        expect(chapterNumber('第3节')).toBe(3);
        expect(chapterNumber('12')).toBe(12);
    });

    it('无法解析时保留原文，不抛错', () => {
        const ref = parseChapterRef('待定');
        expect(ref.num).toBeNull();
        expect(ref.key).toBe('待定');
    });

    it('可解析时 key 归一为 第N章', () => {
        expect(parseChapterRef('第 7 章').key).toBe('第7章');
        expect(parseChapterRef(9).key).toBe('第9章');
    });
});

describe('chapter-ref — 区间与多章', () => {
    it('区间展开为连续章号', () => {
        expect(parseChapterRange('第6-8章').nums).toEqual([6, 7, 8]);
        expect(parseChapterRange('第6至8章').nums).toEqual([6, 7, 8]);
    });

    it('顿号列表去重排序', () => {
        expect(parseChapterRange('第8、6章').nums).toEqual([6, 8]);
        expect(parseChapterRange('第6章,第8章').nums).toEqual([6, 8]);
    });

    it('单章与待定', () => {
        expect(parseChapterRange('第6章').nums).toEqual([6]);
        expect(parseChapterRange('待定').nums).toEqual([]);
    });

    it('异常大区间被夹到安全上限', () => {
        const range = parseChapterRange('第1-99999章');
        expect(range.nums.length).toBe(501);
        expect(range.end).toBe(501);
    });
});

describe('chapter-ref — 比较', () => {
    it('同一章的不同写法视为相同', () => {
        expect(sameChapter('第3章', '第三章')).toBe(true);
        expect(sameChapter('第3章', '第4章')).toBe(false);
    });

    it('距离按章号计算', () => {
        expect(chapterDistance('第9章', '第3章')).toBe(6);
        expect(chapterDistance('待定', '第3章')).toBeNull();
    });
});
