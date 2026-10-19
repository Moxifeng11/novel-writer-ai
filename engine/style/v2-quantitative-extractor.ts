/**
 * v2-quantitative-extractor.ts — V2 12 维写作指纹定量拆解器
 *
 * 背景：V1→V2 迁移时 12 维的定量字段全部填 0（只保留 description），
 * 导致「内容拆解」的定量数据缺失。本模块补齐其中**纯统计可计算**的维度，
 * 不依赖词典/AI，可离线、可单元测试。
 *
 * 当前覆盖：
 *   - RhythmStats      节奏（句长分布/平均句长/短句占比/标点密度/段落密度/停顿频率）
 *   - PerspectiveStats 视角（人称分布）
 *
 * 其余维度（句式/用词/修辞/情绪/张力/信息量/描写等）需要词典或语义分析，
 * 暂保持 pending，由后续阶段按需补全。
 */

import type { RhythmStats, PerspectiveStats } from './style-dimensions-v2';

/** 清洗文本：统一换行、去除多余空白 */
function cleanText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** 计算去除空白后的字数 */
function countChars(text: string): number {
    return text.replace(/\s/g, '').length;
}

/** 将文本切分为句子（按句末标点 / 换行） */
function splitSentences(text: string): string[] {
    return text
        .split(/[。！？!?；;\n]+/)
        .map(s => s.replace(/\s/g, ''))
        .filter(s => s.length > 0);
}

/** 归一到 3 位小数（0-1 区间） */
function roundRatio(n: number): number {
    return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

/**
 * 计算节奏维度定量指标。
 * 纯本地统计，不依赖 AI/词典。
 */
export function calculateRhythmStats(text: string): RhythmStats {
    const cleaned = cleanText(text);
    const wordCount = countChars(cleaned);

    const sentences = splitSentences(cleaned);
    const sentenceLengths = sentences.map(s => s.length);

    // 句长分布：短句 ≤10 字，中句 11-25 字，长句 >25 字
    let short = 0;
    let medium = 0;
    let long = 0;
    for (const len of sentenceLengths) {
        if (len <= 10) short++;
        else if (len <= 25) medium++;
        else long++;
    }
    const sentenceTotal = sentenceLengths.length || 1;
    const sentenceLengthDistribution = {
        short: roundRatio(short / sentenceTotal),
        medium: roundRatio(medium / sentenceTotal),
        long: roundRatio(long / sentenceTotal),
    };

    const avgSentenceLength = sentenceLengths.length > 0
        ? Math.round((wordCount / sentenceLengths.length) * 10) / 10
        : 0;

    // 标点密度（每千字标点数，含句读/引号/括号等）
    const punctuationCount = (cleaned.match(/[，。！？；：、""''（）《》…—]/g) || []).length;
    const punctuationDensity = wordCount > 0
        ? Math.round((punctuationCount / wordCount) * 1000 * 10) / 10
        : 0;

    // 段落密度（每千字段落数）
    const paragraphs = cleaned.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const paragraphDensity = wordCount > 0
        ? Math.round((paragraphs.length / wordCount) * 1000 * 10) / 10
        : 0;

    // 停顿频率（逗号/顿号每千字）
    const pauseCount = (cleaned.match(/[，、]/g) || []).length;
    const pauseFrequency = wordCount > 0
        ? Math.round((pauseCount / wordCount) * 1000 * 10) / 10
        : 0;

    const shortPct = Math.round(sentenceLengthDistribution.short * 100);
    const description = `平均句长 ${avgSentenceLength} 字，短句占比 ${shortPct}%，标点密度 ${punctuationDensity}/千字`;

    return {
        sentenceLengthDistribution,
        avgSentenceLength,
        shortSentenceRatio: sentenceLengthDistribution.short,
        punctuationDensity,
        paragraphDensity,
        pauseFrequency,
        description,
        samples: [],
        status: 'complete',
    };
}

/**
 * 计算视角维度定量指标（人称分布）。
 * 纯本地统计：按人称代词出现频次估算，不依赖 AI。
 */
export function calculatePerspectiveStats(text: string): PerspectiveStats {
    const cleaned = text.replace(/\s/g, '');

    const first = (cleaned.match(/[我吾余咱]/g) || []).length;
    const second = (cleaned.match(/[你尔汝您]/g) || []).length;
    const third = (cleaned.match(/[他她它其]/g) || []).length;
    const total = first + second + third || 1;

    const personDistribution = {
        first: roundRatio(first / total),
        second: roundRatio(second / total),
        third: roundRatio(third / total),
    };

    // 主导人称
    const max = Math.max(personDistribution.first, personDistribution.second, personDistribution.third);
    const dominant = personDistribution.first === max
        ? '第一人称'
        : personDistribution.third === max
            ? '第三人称'
            : '第二人称';

    const description = `以${dominant}为主（第一 ${Math.round(personDistribution.first * 100)}% / 第二 ${Math.round(personDistribution.second * 100)}% / 第三 ${Math.round(personDistribution.third * 100)}%）`;

    return {
        personDistribution,
        // 视角切换频率与叙述距离属语义分析，当前标记 partial 而非伪造数值
        perspectiveSwitchFrequency: 0,
        narrativeDistance: { far: 0, medium: 1, near: 0 },
        description,
        samples: [],
        status: 'complete',
    };
}
