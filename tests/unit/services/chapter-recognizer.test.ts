/**
 * chapter-recognizer 真实行为回归（test-hardening 批次，v4.79.0 候选）。
 *
 * 覆盖：format 判定、章节标题多形态、index/startIndex/endIndex 切片、
 * 章节字数与 countCjkAndWords 口径对账、书名/作者提取、无章节回退。
 * 只加测试不改生产代码；全角数字不识别属当前真实行为，已在信箱报备。
 */
import { describe, expect, it } from 'vitest';
import {
    ChapterRecognizer,
    getChapterText,
    recognizeChapters,
} from '../../../services/chapter-recognizer';
import { countCjkAndWords } from '../../../shared/word-count';

describe('chapter-recognizer — format 判定', () => {
    it('扩展名 .md 直接判定为 md', () => {
        const result = recognizeChapters('# 第一章 开端\n正文。', 'book.md');
        expect(result.format).toBe('md');
    });

    it('扩展名 .txt 直接判定为 txt', () => {
        const result = recognizeChapters('第一章 开端\n正文。', 'book.txt');
        expect(result.format).toBe('txt');
    });

    it('无扩展名时按至少 2 个 markdown 特征判定为 md', () => {
        const result = recognizeChapters('# 标题\n\n**加粗**段落', 'book');
        expect(result.format).toBe('md');
    });

    it('无扩展名且无 markdown 特征时回退为 txt', () => {
        const result = recognizeChapters('这是一段普通文本。', 'book');
        expect(result.format).toBe('txt');
    });

    it('无扩展名且只有 1 个 markdown 特征时仍判为 txt（阈值 >= 2）', () => {
        const result = recognizeChapters('# 标题\n普通段落', 'book');
        expect(result.format).toBe('txt');
    });
});

describe('chapter-recognizer — 章节标题多形态', () => {
    it('md 标题行去除 # 前缀后作为 title', () => {
        const result = recognizeChapters('## 第一章 开端\n正文内容。', 'book.md');
        expect(result.chapterCount).toBe(1);
        expect(result.chapters[0].title).toBe('第一章 开端');
        expect(result.chapters[0].rawTitle).toBe('## 第一章 开端');
    });

    it('md 文件中的无 # 章节行同样识别', () => {
        const result = recognizeChapters('第一章 开端\n正文。', 'book.md');
        expect(result.chapterCount).toBe(1);
        expect(result.chapters[0].title).toBe('第一章 开端');
    });

    it('txt 支持 第N章 / 第 N 章 / 第N节 三种写法', () => {
        const content = '第一章 开端\n甲。\n第 2 章 发展\n乙。\n第3节 转折\n丙。';
        const result = recognizeChapters(content, 'book.txt');
        expect(result.chapters.map(c => c.title)).toEqual([
            '第一章 开端',
            '第 2 章 发展',
            '第3节 转折',
        ]);
    });

    it('卷X 第N章 以整行作为单章标题', () => {
        const result = recognizeChapters('卷二 第五章 决战\n内容。', 'book.txt');
        expect(result.chapterCount).toBe(1);
        expect(result.chapters[0].title).toBe('卷二 第五章 决战');
    });

    it('纯数字标题（1、/2.）可识别', () => {
        const content = '1、楔子\n序。\n2. 正篇\n正文。';
        const result = recognizeChapters(content, 'book.txt');
        expect(result.chapters.map(c => c.title)).toEqual(['1、楔子', '2. 正篇']);
    });

    it('全角数字标题当前不识别（\\d 仅匹配 ASCII，真实行为，已在信箱报备）', () => {
        const result = recognizeChapters('第１２章 全角\n正文。', 'book.txt');
        expect(result.chapterCount).toBe(0);
        expect(result.chapters).toEqual([]);
    });
});

describe('chapter-recognizer — index 连续性与切片', () => {
    it('三章 index 连续，startIndex/endIndex 按行切片正确', () => {
        const content = [
            '第一章 开端',
            '甲。',
            '第二章 发展',
            '乙。',
            '第3节 转折',
            '丙。',
        ].join('\n');
        const result = recognizeChapters(content, 'book.txt');

        expect(result.chapters.map(c => c.index)).toEqual([0, 1, 2]);
        expect(result.chapters.map(c => c.startIndex)).toEqual([0, 2, 4]);
        expect(result.chapters.map(c => c.endIndex)).toEqual([1, 3, 5]);
        expect(result.chapters.map(c => c.wordCount)).toEqual([6, 6, 5]);
    });

    it('getChapterText 返回章节标题行到下一标题前一行的原文', () => {
        const content = '第一章 开端\n甲。\n第二章 发展\n乙。';
        const result = recognizeChapters(content, 'book.txt');
        expect(getChapterText(content, result.chapters[1])).toBe('第二章 发展\n乙。');
    });
});

describe('chapter-recognizer — 无章节回退与单章', () => {
    it('无章节文本返回 chapterCount=0 与空 chapters', () => {
        const result = recognizeChapters('这是一段没有章节的正文。\n继续。', 'story.txt');
        expect(result.chapterCount).toBe(0);
        expect(result.chapters).toEqual([]);
        expect(result.format).toBe('txt');
    });

    it('单章文本返回 1 章，且不把前言算进章节', () => {
        const result = recognizeChapters('第一章 开端\n正文。', 'story.txt');
        expect(result.chapterCount).toBe(1);
        expect(result.chapters[0]).toMatchObject({ index: 0, startIndex: 0, endIndex: 1 });
    });

    it('空内容不抛错：沿用文件名作为标题', () => {
        const result = recognizeChapters('', 'empty.md');
        expect(result.chapterCount).toBe(0);
        expect(result.title).toBe('empty');
        expect(result.wordCount).toBe(0);
        expect(result.format).toBe('md');
        expect(result.confidence).toBeCloseTo(0.2, 5);
    });
});

describe('chapter-recognizer — 书名与作者提取', () => {
    it('从 《书名》 与 作者： 行提取 title/author', () => {
        const result = recognizeChapters('《星河纪元》\n作者：林墨\n第一章 开端\n正文。', 'download.txt');
        expect(result.title).toBe('星河纪元');
        expect(result.author).toBe('林墨');
    });

    it('支持 书名： 写法提取标题', () => {
        const result = recognizeChapters('书名：风起长林\n正文。', 'download.txt');
        expect(result.title).toBe('风起长林');
    });

    it('支持 【作者】 写法提取作者', () => {
        const result = recognizeChapters('【作者】王五\n正文。', 'download.txt');
        expect(result.author).toBe('王五');
    });

    it('超长作者名不采纳（>= 50 字）', () => {
        const result = recognizeChapters(`作者：${'甲'.repeat(60)}\n正文。`, 'download.txt');
        expect(result.author).toBeUndefined();
    });

    it('无书名且首行超长时回退为文件名', () => {
        const result = recognizeChapters(`${'啊'.repeat(60)}\n正文。`, '长篇.txt');
        expect(result.title).toBe('长篇');
    });
});

describe('chapter-recognizer — 字数口径', () => {
    it('总字数与 countCjkAndWords 一致：中文 + 英文单词，数字不计', () => {
        const content = '第一章 Start 2026 年\nAlpha beta。';
        const result = recognizeChapters(content, 'mix.txt');
        expect(result.wordCount).toBe(7);
        expect(result.wordCount).toBe(countCjkAndWords(content));
    });

    it('章节字数按切片重算，与 countCjkAndWords 口径一致，且不含前言', () => {
        const content = '前言文字。\n第一章 开端\n正文。';
        const result = recognizeChapters(content, 'book.txt');
        const chapterText = getChapterText(content, result.chapters[0]);

        expect(result.chapters[0].wordCount).toBe(7);
        expect(result.chapters[0].wordCount).toBe(countCjkAndWords(chapterText));
        expect(result.wordCount).toBe(11);
        expect(result.wordCount).toBe(countCjkAndWords(content));
    });

    it('confidence 封顶为 1（5 章 + 作者 + 书名 + format）', () => {
        const content = [
            '《九州志》',
            '作者：墨白',
            '第一章 风起',
            '一。',
            '第二章 云涌',
            '二。',
            '第三章 雷动',
            '三。',
            '第四章 山崩',
            '四。',
            '第五章 海啸',
            '五。',
        ].join('\n');
        const result = recognizeChapters(content, 'cap.txt');
        expect(result.chapterCount).toBe(5);
        expect(result.confidence).toBeCloseTo(1, 5);
    });
});

describe('chapter-recognizer — 类实例 API', () => {
    const recognizer = new ChapterRecognizer();
    const sample = '第一章 开端\n甲。\n第二章 发展\n乙。';

    it('recognize 与函数式入口结果一致', () => {
        expect(recognizer.recognize(sample, 'demo.txt')).toEqual(recognizeChapters(sample, 'demo.txt'));
    });

    it('extractTitle/extractAuthor 实例方法可用', () => {
        expect(recognizer.extractTitle('《星河纪元》\n正文。', 'x.txt')).toBe('星河纪元');
        expect(recognizer.extractAuthor('作者：林墨')).toBe('林墨');
    });

    it('countWords 与 getChapterText 实例方法可用', () => {
        expect(recognizer.countWords('中文 abc 123')).toBe(3);
        const result = recognizer.recognize(sample, 'demo.txt');
        expect(recognizer.getChapterText(sample, result.chapters[1])).toBe('第二章 发展\n乙。');
    });
});
