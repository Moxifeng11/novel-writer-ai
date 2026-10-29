import { describe, expect, it } from 'vitest';
import { naturalizeBodyText } from '../../../shared/prose-naturalizer';

describe('prose-naturalizer', () => {
    it('合并相邻叙述短段', () => {
        const result = naturalizeBodyText('他抬手。\n风从袖口灌进来。\n砂打在脸上。');
        expect(result.text).toBe('他抬手。风从袖口灌进来。砂打在脸上。');
        expect(result.mergedParagraphs).toBe(2);
    });

    it('把对话和紧跟其后的说话人动作并段', () => {
        const result = naturalizeBodyText('“站直了。”\n沈铁山的声音压得极低，从牙缝里往外挤。');
        expect(result.text).toBe('“站直了。”沈铁山的声音压得极低，从牙缝里往外挤。');
    });

    it('连续对话按说话人分段，不强行合并', () => {
        const result = naturalizeBodyText('“爹。”\n“嗯。”\n“那袋子够不够。”');
        expect(result.text).toBe('“爹。”\n“嗯。”\n“那袋子够不够。”');
        expect(result.mergedParagraphs).toBe(0);
    });

    it('保留空行作为硬边界', () => {
        const result = naturalizeBodyText('他抬手。\n\n风从袖口灌进来。');
        expect(result.text).toBe('他抬手。\n\n风从袖口灌进来。');
        expect(result.mergedParagraphs).toBe(0);
    });

    it('场景转换句另起一段', () => {
        const result = naturalizeBodyText('他抬手。\n第二天，风停了。');
        expect(result.text).toBe('他抬手。\n第二天，风停了。');
        expect(result.mergedParagraphs).toBe(0);
    });

    it('超过段长上限时不合并', () => {
        const first = '他抬手。'.repeat(30);
        const second = '风从袖口灌进来。'.repeat(30);
        const result = naturalizeBodyText(`${first}\n${second}`, { maxParagraphChars: 100 });
        expect(result.text).toBe(`${first}\n${second}`);
    });

    it('幂等：第二次运行不再合并', () => {
        const once = naturalizeBodyText('他抬手。\n风从袖口灌进来。').text;
        const twice = naturalizeBodyText(once);
        expect(twice.text).toBe(once);
        expect(twice.mergedParagraphs).toBe(0);
    });

    it('传入 indent 时先剥离再补回', () => {
        const result = naturalizeBodyText('　　他抬手。\n　　风从袖口灌进来。', { indent: '　　' });
        expect(result.text).toBe('　　他抬手。风从袖口灌进来。');
    });

    it('空文本返回空结果', () => {
        const result = naturalizeBodyText('');
        expect(result.text).toBe('');
        expect(result.mergedParagraphs).toBe(0);
    });
});
