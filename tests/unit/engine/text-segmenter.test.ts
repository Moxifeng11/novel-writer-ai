import { describe, it, expect } from 'vitest';
import { TextSegmenter } from '../../../engine/text-segmenter';

describe('TextSegmenter', () => {
    const segmenter = new TextSegmenter();

    describe('基础分段', () => {
        it('空文本返回空数组', async () => {
            const result = await segmenter.segment('');
            expect(result).toEqual([]);
        });

        it('短文本返回单段', async () => {
            const text = '这是一段很短的文本。';
            const result = await segmenter.segment(text);
            expect(result.length).toBe(1);
            expect(result[0].text).toBe(text);
            expect(result[0].wordCount).toBeGreaterThan(0);
            expect(result[0].startOffset).toBe(0);
            expect(result[0].endOffset).toBe(text.length);
        });
    });

    describe('按章节分段', () => {
        it('识别中文章节标题', async () => {
            const text = `第一章 初入江湖
这是第一章的内容。有很多文字。

第二章 风云再起
这是第二章的内容。也有很多文字。

第三章 大结局
这是第三章的内容。`;

            const result = await segmenter.segment(text);
            expect(result.length).toBe(3);
            expect(result[0].chapterTitle).toBe('第一章 初入江湖');
            expect(result[1].chapterTitle).toBe('第二章 风云再起');
            expect(result[2].chapterTitle).toBe('第三章 大结局');
        });

        it('识别数字章节标题', async () => {
            const text = `第1章 开始
内容一。

第2章 发展
内容二。

第3章 结束
内容三。`;

            const result = await segmenter.segment(text);
            expect(result.length).toBeGreaterThanOrEqual(3);
        });

        it('识别英文章节标题', async () => {
            const text = `Chapter 1: The Beginning
Some content here.

Chapter 2: The Middle
More content.

Chapter 3: The End
Final content.`;

            const result = await segmenter.segment(text);
            expect(result.length).toBeGreaterThanOrEqual(3);
        });

        it('识别节、卷、回等标题', async () => {
            const text = `第一节 开篇
内容。

第二节 发展
内容。

第三节 结尾
内容。`;

            const result = await segmenter.segment(text);
            expect(result.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('按段落分段', () => {
        it('无章节时按段落合并分段', async () => {
            const segmenterSmall = new TextSegmenter({ maxSegmentWords: 50, minSegmentWords: 30 });
            const paragraphs = [];
            for (let i = 0; i < 20; i++) {
                paragraphs.push(`这是第${i}段的内容。有一些中文文字。用来测试分段功能是否正常工作。再加点字。`);
            }
            const text = paragraphs.join('\n\n');

            const result = await segmenterSmall.segment(text);
            expect(result.length).toBeGreaterThan(1);
            expect(result.every(s => s.wordCount <= 50 * 2)).toBe(true);
        });
    });

    describe('按字数硬切', () => {
        it('超长单段按字数硬切', async () => {
            const segmenterSmall = new TextSegmenter({ maxSegmentWords: 100, minSegmentWords: 50, preferChapter: false });
            let text = '';
            for (let i = 0; i < 500; i++) {
                text += '这是一段测试文字。';
            }

            const result = await segmenterSmall.segment(text);
            expect(result.length).toBeGreaterThan(2);
        });

        it('硬切在标点处断开', async () => {
            const segmenterSmall = new TextSegmenter({ maxSegmentWords: 20, minSegmentWords: 10, preferChapter: false });
            const text = '第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。第九句。第十句。';

            const result = await segmenterSmall.segment(text);
            expect(result.length).toBeGreaterThan(1);
            for (const seg of result.slice(0, -1)) {
                const lastChar = seg.text.trim().slice(-1);
                expect(['。', '！', '？', '；', '.', '!', '?']).toContain(lastChar);
            }
        });
    });

    describe('段间重叠', () => {
        it('相邻段之间有重叠', async () => {
            const segmenterSmall = new TextSegmenter({ maxSegmentWords: 30, minSegmentWords: 20, overlapWords: 10, preferChapter: false });
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push(`第${i}段的内容。有一些文字用来测试。`);
            }
            const text = paragraphs.join('\n\n');

            const result = await segmenterSmall.segment(text);
            if (result.length >= 2) {
                const overlap = result[0].endOffset - result[1].startOffset;
                expect(overlap).toBeGreaterThan(0);
            }
        });
    });

    describe('offset 正确性', () => {
        it('startOffset/endOffset 与文本位置一致', async () => {
            const segmenterSmall = new TextSegmenter({ maxSegmentWords: 20, minSegmentWords: 10, preferChapter: false });
            let text = '';
            for (let i = 0; i < 100; i++) {
                text += `句子${i}。`;
            }

            const result = await segmenterSmall.segment(text);
            for (const seg of result) {
                expect(text.slice(seg.startOffset, seg.endOffset)).toBe(seg.text);
            }
        });

        it('第一段 startOffset 为 0', async () => {
            const text = '这是一段测试文字。'.repeat(20);
            const result = await segmenter.segment(text);
            expect(result[0].startOffset).toBe(0);
        });

        it('最后一段 endOffset 等于文本长度', async () => {
            const text = '这是一段测试文字。'.repeat(20);
            const result = await segmenter.segment(text);
            expect(result[result.length - 1].endOffset).toBe(text.length);
        });
    });

    describe('字数统计', () => {
        it('正确统计中文字数', () => {
            const s = new TextSegmenter();
            const result = s['countWords']('你好世界');
            expect(result).toBe(4);
        });

        it('正确统计英文单词数', () => {
            const s = new TextSegmenter();
            const result = s['countWords']('hello world test');
            expect(result).toBe(3);
        });

        it('中英文混合统计', () => {
            const s = new TextSegmenter();
            const result = s['countWords']('你好 world 测试 text');
            expect(result).toBe(6);
        });
    });

    describe('章节标题识别', () => {
        it('识别"第X章"格式', () => {
            const s = new TextSegmenter();
            expect(s['isChapterTitle']('第一章 测试')).toBe(true);
            expect(s['isChapterTitle']('第二十章 标题')).toBe(true);
            expect(s['isChapterTitle']('第100章 章节名')).toBe(true);
        });

        it('识别"第X节"格式', () => {
            const s = new TextSegmenter();
            expect(s['isChapterTitle']('第一节 开篇')).toBe(true);
            expect(s['isChapterTitle']('第三节 发展')).toBe(true);
        });

        it('识别"Chapter X"格式', () => {
            const s = new TextSegmenter();
            expect(s['isChapterTitle']('Chapter 1')).toBe(true);
            expect(s['isChapterTitle']('Chapter 10: Title')).toBe(true);
        });

        it('普通句子不被识别为章节', () => {
            const s = new TextSegmenter();
            expect(s['isChapterTitle']('这是一个普通的句子。')).toBe(false);
            expect(s['isChapterTitle']('第一句话是这样的。')).toBe(false);
            expect(s['isChapterTitle']('')).toBe(false);
        });
    });
});
