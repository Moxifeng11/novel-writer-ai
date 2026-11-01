/**
 * 统一字数口径（B5）
 *
 * 之前 13 份实现至少四种口径。这里锁住每种口径的明确语义，
 * 防止后续再把「中文+英文词」「加数字」「平台 0.5 折算」混在一起。
 */
import { describe, expect, it } from 'vitest';
import {
    countCjkAndWords,
    countCjkChars,
    countCjkWordsAndNumbers,
    countPlatformWords,
    countTotalChars,
    countWordsByMode,
} from '../../../shared/word-count';

const SAMPLE = '春风十里。Hello world 2026 年';

describe('基础口径', () => {
    it('中文只数汉字', () => {
        expect(countCjkChars('春风十里。Hello 2026')).toBe(4);
    });

    it('中文 + 英文单词，数字不计', () => {
        // 春风十里年 = 5；Hello/world = 2；2026 不计；标点不计
        expect(countCjkAndWords(SAMPLE)).toBe(7);
        expect(countCjkAndWords('一二三')).toBe(3);
        expect(countCjkAndWords('')).toBe(0);
    });

    it('中文 + 英文词 + 数字串（逐 token）', () => {
        // 5 汉字 + 2 英文词 + 1 数字串
        expect(countCjkWordsAndNumbers(SAMPLE)).toBe(8);
        expect(countCjkWordsAndNumbers('共 1,234 字')).toBe(3);
        expect(countCjkWordsAndNumbers("don't stop")).toBe(2);
    });

    it('平台口径：数字逐个 + 英文 0.5 折算后向下取整', () => {
        // 5 汉字 + Hello(2.5) + world(2.5) + 2026(4) = 14
        expect(countPlatformWords(SAMPLE)).toBe(14);
        expect(countPlatformWords('abc')).toBe(1);
        expect(countPlatformWords('中文')).toBe(2);
    });

    it('总字符数包含标点与全角字符，排除空白', () => {
        expect(countTotalChars('你好，世界')).toBe(5);
        expect(countTotalChars('a b')).toBe(2);
    });
});

describe('统一入口', () => {
    it('默认与历史多数实现一致（中文+英文词）', () => {
        expect(countWordsByMode(SAMPLE)).toBe(countCjkAndWords(SAMPLE));
        expect(countWordsByMode(SAMPLE, 'cjk_words')).toBe(7);
    });

    it('各模式可显式选择且互相不串', () => {
        expect(countWordsByMode(SAMPLE, 'cjk_only')).toBe(5);
        expect(countWordsByMode(SAMPLE, 'cjk_words_numbers')).toBe(8);
        expect(countWordsByMode(SAMPLE, 'platform')).toBe(14);
        expect(countWordsByMode(SAMPLE, 'total')).toBe(countTotalChars(SAMPLE));
    });
});
