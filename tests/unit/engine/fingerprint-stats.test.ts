import { describe, it, expect } from 'vitest';
import { computeFingerprintStats, countDialogueChars } from '../../../engine/fingerprint-stats';

describe('computeFingerprintStats', () => {
    it('网文单行分段按段统计，而不是把整章算成一段', () => {
        const text = [
            '第一段只有一句话。',
            '第二段也很短。',
            '第三段同样短。',
        ].join('\n');

        const stats = computeFingerprintStats(text);
        expect(stats.avgParagraphLength).toBeLessThan(20);
        expect(stats.dialogueTurnRatio).toBe(0);
    });

    it('分号不当作句末，避免虚增句数、拉低平均句长', () => {
        const withSemicolon = computeFingerprintStats('他停下脚步；她回过头来。');
        const twoSentences = computeFingerprintStats('他停下脚步。她回过头来。');

        expect(withSemicolon.avgSentenceLength).toBeGreaterThan(twoSentences.avgSentenceLength);
    });

    it('短句/长句占比按 12 与 30 字阈值统计', () => {
        const stats = computeFingerprintStats([
            '短句。',
            '这是一个长度明显超过三十个字的句子用来验证长句占比统计是否按阈值正确工作。',
        ].join(''));

        expect(stats.shortSentenceRatio).toBeCloseTo(0.5, 3);
        expect(stats.longSentenceRatio).toBeCloseTo(0.5, 3);
        expect(stats.sentenceLengthStdDev).toBeGreaterThan(0);
    });

    it('对话占比只统计引号内文字且不会因重复规则翻倍', () => {
        const text = '"abcdef"';
        const chars = countDialogueChars(text);
        const stats = computeFingerprintStats(text);

        expect(chars).toBe(6);
        expect(stats.dialogueRatio).toBeLessThanOrEqual(1);
        expect(stats.dialogueRatio).toBeCloseTo(6 / 8, 3);
    });

    it('支持中文直角引号、书名号与弯引号', () => {
        expect(countDialogueChars('「你好」')).toBe(2);
        expect(countDialogueChars('『世界』')).toBe(2);
        expect(countDialogueChars('“再见”')).toBe(2);
    });

    it('空文本返回全零而不是 NaN', () => {
        const stats = computeFingerprintStats('');
        expect(stats).toMatchObject({
            wordCount: 0,
            avgSentenceLength: 0,
            avgParagraphLength: 0,
            dialogueRatio: 0,
            descriptionRatio: 0,
            lexicalDiversity: 0,
        });
        expect(Number.isNaN(stats.sentenceLengthStdDev)).toBe(false);
    });

    it('词汇多样性等于去重字符数/非空白字符数', () => {
        const stats = computeFingerprintStats('一二三四五六七八九十');
        expect(stats.lexicalDiversity).toBeCloseTo(1, 3);

        const repeated = computeFingerprintStats('一一一一一一一一一一');
        expect(repeated.lexicalDiversity).toBeCloseTo(0.1, 3);
    });
});
