/**
 * fingerprint-stats.ts — 写作指纹的本地统计口径
 *
 * 独立于 AI 提取器，便于单元测试与复用：句/段切分、对话占比、词汇多样性
 * 都按中文网文正文的实际排版计算，不依赖 Markdown 空行。
 */
import type { StyleFingerprintStats } from './style-fingerprint-library';

/**
 * round1 函数。
 * @param value - 值
 * @returns 数值结果
 */
export function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * round3 函数。
 * @param value - 值
 * @returns 数值结果
 */
export function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function stdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return round1(Math.sqrt(variance));
}

/**
 * 统计成对引号内的字符数；支持中日引号与中英文双引号。
 *
 * @param text - 文本内容
 * @returns 数值结果
 */
export function countDialogueChars(text: string): number {
    const patterns = [
        /「([^」]+)」/g,
        /『([^』]+)』/g,
        /“([^”]+)”/g,
        /"([^"]+)"/g,
    ];
    const counted = new Set<string>();
    let count = 0;

    for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (!matches) continue;
        for (const match of matches) {
            // 同一段可能被多组引号匹配，去重避免对话占比翻倍。
            if (counted.has(match)) continue;
            counted.add(match);
            count += match.replace(/[「」『』“”"]/g, '').length;
        }
    }
    return count;
}

/**
 * computeFingerprintStats 函数。
 * @param text - 文本内容
  * @returns StyleFingerprintStats 实例
 */
export function computeFingerprintStats(text: string): StyleFingerprintStats {
    const wordCount = text.replace(/\s/g, '').length;

    // 分号在中文长句里多为句内停顿，算作句末会虚增句数、拉低平均句长。
    const sentenceEndings = /[。！？!?…]+/g;
    const sentences = text
        .split(sentenceEndings)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    const sentenceLengths = sentences.map(s => s.replace(/\s/g, '').length).filter(n => n > 0);
    const avgSentenceLength = sentenceLengths.length > 0
        ? round1(sentenceLengths.reduce((sum, n) => sum + n, 0) / sentenceLengths.length)
        : 0;
    const sentenceLengthStdDev = stdDev(sentenceLengths, avgSentenceLength);
    const shortSentenceRatio = sentenceLengths.length > 0
        ? round3(sentenceLengths.filter(n => n <= 12).length / sentenceLengths.length)
        : 0;
    const longSentenceRatio = sentenceLengths.length > 0
        ? round3(sentenceLengths.filter(n => n >= 30).length / sentenceLengths.length)
        : 0;

    // 网文正文通常一行一段，只有空行分隔会把整章算成一段。
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
    const paragraphLengths = paragraphs.map(p => p.replace(/\s/g, '').length);
    const avgParagraphLength = paragraphLengths.length > 0
        ? Math.round(paragraphLengths.reduce((sum, n) => sum + n, 0) / paragraphLengths.length)
        : 0;
    const paragraphLengthStdDev = stdDev(paragraphLengths, avgParagraphLength);

    const dialogueChars = countDialogueChars(text);
    const dialogueRatio = wordCount > 0
        ? round3(dialogueChars / wordCount)
        : 0;

    const quotedParagraphs = paragraphs.filter(p => /[「『“"]/.test(p)).length;
    const dialogueTurnRatio = paragraphs.length > 0
        ? round3(quotedParagraphs / paragraphs.length)
        : 0;

    const descriptionRatio = wordCount > 0
        ? round3(Math.max(0, 1 - dialogueRatio - 0.15))
        : 0;

    const uniqueChars = new Set(text.replace(/\s/g, '')).size;
    const lexicalDiversity = wordCount > 0 ? round3(uniqueChars / wordCount) : 0;

    return {
        wordCount,
        avgSentenceLength,
        avgParagraphLength,
        dialogueRatio,
        descriptionRatio,
        sentenceLengthStdDev,
        shortSentenceRatio,
        longSentenceRatio,
        dialogueTurnRatio,
        paragraphLengthStdDev,
        lexicalDiversity,
    };
}
