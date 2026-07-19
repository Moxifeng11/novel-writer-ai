import { describe, it, expect } from 'vitest';
import { TextSegmenter, normalizeText, preprocess } from '../../../engine/text-segmenter';

describe('normalizeText', () => {
    describe('TR-1.1 混合脏文本归一化', () => {
        it('统一 CRLF/CR 为 LF', () => {
            const result = normalizeText('第一行\r\n第二行\r第三行');
            expect(result).toBe('第一行\n第二行\n第三行');
        });

        it('折叠 3 个以上连续空行为最多 2 个空行', () => {
            const result = normalizeText('段落一\n\n\n\n\n段落二');
            expect(result).toBe('段落一\n\n段落二');
        });

        it('去除每行行尾空白', () => {
            const result = normalizeText('第一行   \n第二行\t\t\n第三行');
            expect(result).toBe('第一行\n第二行\n第三行');
        });

        it('清除无意义控制字符与零宽字符', () => {
            const result = normalizeText('正文\u0000内容\u200B文本\uFEFF结束\u007F');
            expect(result).toBe('正文内容文本结束');
        });

        it('保留 \\t 制表符', () => {
            const result = normalizeText('列一\t列二');
            expect(result).toBe('列一\t列二');
        });

        it('全角空格归一化为普通空格', () => {
            const result = normalizeText('前\u3000后');
            expect(result).toBe('前 后');
        });

        it('混合脏文本一次性输出干净结果', () => {
            const dirty = '第一行  \r\n\r\n\r\n\r\n第二行\u0000\u200B  \r第三行\uFEFF   ';
            const result = normalizeText(dirty);
            expect(result).toBe('第一行\n\n第二行\n第三行');
        });
    });

    describe('TR-1.2 边界输入不抛异常', () => {
        const segmenter = new TextSegmenter();

        it('空字符串', async () => {
            expect(normalizeText('')).toBe('');
            await expect(segmenter.segment('')).resolves.toEqual([]);
        });

        it('纯空白', async () => {
            expect(normalizeText('   \n\n  \t  ').trim()).toBe('');
            await expect(segmenter.segment('   \n\n  \t  ')).resolves.toEqual([]);
        });

        it('超短文本', async () => {
            expect(normalizeText('嗯。')).toBe('嗯。');
            const result = await segmenter.segment('嗯。');
            expect(result.length).toBe(1);
        });

        it('纯噪声文本', async () => {
            const noise = '\u0000\u0001\u200B\uFEFF\u007F';
            expect(normalizeText(noise)).toBe('');
            await expect(segmenter.segment(noise)).resolves.toEqual([]);
        });

        it('preprocess 返回可判定的边界结果', () => {
            expect(preprocess('').isEmpty).toBe(true);
            expect(preprocess('   \n\n  ').isEmpty).toBe(true);
            expect(preprocess('\u0000\u200B').isEmpty).toBe(true);
            const ok = preprocess('第一章 内容');
            expect(ok.isEmpty).toBe(false);
            expect(ok.charCount).toBeGreaterThan(0);
            expect(ok.text).toBe('第一章 内容');
        });
    });

    describe('TR-1.3 预处理后章节切分不被破坏', () => {
        const segmenter = new TextSegmenter();

        it('含脏字符的多章文本仍按章节正确切分', async () => {
            const dirty = '第一章 初入江湖\r\n\r\n\r\n\r\n这是第一章内容。\u200B  \r\n\r\n第二章 风云再起\uFEFF\r\n这是第二章内容。   \r\n\r\n\r\n第三章 大结局\r\n这是第三章内容。';
            const result = await segmenter.segment(dirty);
            expect(result.length).toBe(3);
            expect(result[0].chapterTitle).toBe('第一章 初入江湖');
            expect(result[1].chapterTitle).toBe('第二章 风云再起');
            expect(result[2].chapterTitle).toBe('第三章 大结局');
        });
    });
});
