import { countCjkWordsAndNumbers } from '../shared/word-count';
/**
 * novel-analyzer.ts — 小说内容分析引擎（纯统计）
 *
 * 功能：基于纯统计方法分析小说文本，提供字数、句式、段落、
 *       对话/描写/叙述占比、高频词等多维度分析结果
 * 性能：10万字文本分析耗时 ≤ 3秒，纯同步计算
 */

export interface NovelAnalysisResult {
    basic: {
        charCount: number;
        wordCount: number;
        paragraphCount: number;
        sentenceCount: number;
    };
    length: {
        avgSentenceLength: number;
        avgParagraphLength: number;
        medianSentenceLength: number;
        medianParagraphLength: number;
    };
    ratio: {
        dialogueRatio: number;
        descriptionRatio: number;
        narrationRatio: number;
    };
    distribution: {
        sentenceLength: { label: string; value: number }[];
        paragraphLength: { label: string; value: number }[];
    };
    topWords: { text: string; count: number }[];
    topPunctuations: { text: string; count: number }[];
}

const STOP_WORDS = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人',
    '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
    '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '他',
    '她', '它', '们', '什么', '怎么', '这样', '那样', '因为', '所以',
    '但是', '然后', '还是', '或者', '如果', '虽然', '不过', '已经',
    '还', '又', '再', '才', '只', '而', '且', '并', '及', '与',
    '等', '等等', '之', '乎', '者', '也', '矣', '焉', '哉', '耳',
    '尔', '汝', '吾', '余', '予', '其', '于', '以', '为', '被',
    '把', '将', '从', '向', '往', '由', '自', '自从', '当', '对',
    '对于', '关于', '为了', '由于', '因此', '因而', '以致', '于是',
    '接着', '最后', '首先', '其次', '再次', '第一', '第二', '第三',
    '一是', '二是', '三是', '一方面', '另一方面', '不仅', '而且',
    '不但', '既', '可是', '然而', '却', '只是', '假如', '倘若',
    '要是', '那么', '便', '则', '即使', '就算', '哪怕', '无论',
    '不管', '总', '只要', '只有', '除非', '否则', '以及', '要么',
    '不是', '就是', '地', '得', '过', '吧', '吗', '呢', '啊',
    '呀', '哦', '哈', '嘿', '哼', '嗯', '唉', '喔', '咦', '嗨',
    '喂', '呵', '哇', '噻', '噢', '呃', '哟', '啧', '喏', '喵',
    '汪', '叽', '咔', '咚', '当', '砰', '哗', '轰', '嗡', '嘟',
    '嘀', '嗒', '咻', '唰', '嗖', '叮', '铃', '哐', '锵',
    '里', '外', '中', '间', '内', '旁', '下', '左', '右', '前',
    '后', '来', '个', '些', '每', '各', '某', '每', '该', '此',
    '彼', '这般', '那般', '这么', '那么', '如何', '为何', '为何',
    '谁', '哪', '哪里', '哪儿', '几时', '多少', '几', '多', '少',
    '大', '小', '长', '短', '高', '低', '快', '慢', '新', '旧',
    '老', '少', '男', '女', '能', '能够', '可以', '可能', '应该',
    '必须', '需要', '想', '觉得', '知道', '明白', '清楚', '记得',
    '忘记', '听见', '看到', '发现', '感觉', '感到', '以为', '认为',
    '出来', '进去', '过来', '过去', '起来', '下来', '上来', '下去',
    '进去', '出来', '上去', '下来', '过来', '回去', '起来', '坐下',
    '站起', '打开', '关上', '放下', '拿起', '带上', '脱下', '穿起'
]);

const CHINESE_PUNCTUATIONS = '。，、；：？！\u201c\u201d\u2018\u2019「」『』（）《》【】……—·';

export class NovelAnalyzer {
    analyze(text: string): NovelAnalysisResult {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        const paragraphs = this.splitParagraphs(text);
        const sentences = this.splitSentences(text);
        const charCount = text.length;
        const wordCount = countCjkWordsAndNumbers(text);

        const sentenceLengths = sentences.map(s => countCjkWordsAndNumbers(s));
        const paragraphLengths = paragraphs.map(p => countCjkWordsAndNumbers(p));

        const { dialogueChars, descriptionChars, narrationChars } = this.calculateRatios(text);
        const totalContentChars = dialogueChars + descriptionChars + narrationChars;

        return {
            basic: {
                charCount,
                wordCount,
                paragraphCount: paragraphs.length,
                sentenceCount: sentences.length
            },
            length: {
                avgSentenceLength: sentenceLengths.length > 0
                    ? this.round2(sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length)
                    : 0,
                avgParagraphLength: paragraphLengths.length > 0
                    ? this.round2(paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length)
                    : 0,
                medianSentenceLength: this.median(sentenceLengths),
                medianParagraphLength: this.median(paragraphLengths)
            },
            ratio: {
                dialogueRatio: totalContentChars > 0 ? this.round2(dialogueChars / totalContentChars) : 0,
                descriptionRatio: totalContentChars > 0 ? this.round2(descriptionChars / totalContentChars) : 0,
                narrationRatio: totalContentChars > 0 ? this.round2(narrationChars / totalContentChars) : 0
            },
            distribution: {
                sentenceLength: this.buildSentenceDistribution(sentenceLengths),
                paragraphLength: this.buildParagraphDistribution(paragraphLengths)
            },
            topWords: this.extractTopWords(text, 50),
            topPunctuations: this.extractTopPunctuations(text, 10)
        };
    }

    private getEmptyResult(): NovelAnalysisResult {
        return {
            basic: { charCount: 0, wordCount: 0, paragraphCount: 0, sentenceCount: 0 },
            length: { avgSentenceLength: 0, avgParagraphLength: 0, medianSentenceLength: 0, medianParagraphLength: 0 },
            ratio: { dialogueRatio: 0, descriptionRatio: 0, narrationRatio: 0 },
            distribution: {
                sentenceLength: [
                    { label: '1-10字', value: 0 },
                    { label: '11-20字', value: 0 },
                    { label: '21-30字', value: 0 },
                    { label: '31-50字', value: 0 },
                    { label: '51-100字', value: 0 },
                    { label: '100+字', value: 0 }
                ],
                paragraphLength: [
                    { label: '1-50字', value: 0 },
                    { label: '51-100字', value: 0 },
                    { label: '101-200字', value: 0 },
                    { label: '201-500字', value: 0 },
                    { label: '501-1000字', value: 0 },
                    { label: '1000+字', value: 0 }
                ]
            },
            topWords: [],
            topPunctuations: []
        };
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private splitSentences(text: string): string[] {
        const sentences: string[] = [];
        const sentenceEndRegex = /[。！？!?…]+/g;
        let lastIndex = 0;
        let match;

        while ((match = sentenceEndRegex.exec(text)) !== null) {
            const sentence = text.slice(lastIndex, match.index + match[0].length).trim();
            if (sentence.length > 0) {
                sentences.push(sentence);
            }
            lastIndex = match.index + match[0].length;
        }

        const remaining = text.slice(lastIndex).trim();
        if (remaining.length > 0) {
            sentences.push(remaining);
        }

        return sentences;
    }


    private countChineseChars(text: string): number {
        let count = 0;
        for (let i = 0; i < text.length; i++) {
            if (this.isChineseChar(text[i])) {
                count++;
            }
        }
        return count;
    }

    private isChineseChar(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 0x4E00 && code <= 0x9FFF;
    }

    private isEnglishLetter(char: string): boolean {
        const code = char.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    private isDigit(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 48 && code <= 57;
    }

    private median(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return this.round2((sorted[mid - 1] + sorted[mid]) / 2);
        }
        return sorted[mid];
    }

    private round2(num: number): number {
        return Math.round(num * 100) / 100;
    }

    private calculateRatios(text: string): {
        dialogueChars: number;
        descriptionChars: number;
        narrationChars: number;
    } {
        let dialogueChars = 0;
        let descriptionChars = 0;
        let narrationChars = 0;

        const dialogueRanges: [number, number][] = [];

        const quotePairs = [
            { start: '「', end: '」' },
            { start: '『', end: '』' },
            { start: '"', end: '"' },
            { start: "'", end: "'" },
            { start: '“', end: '”' },
            { start: '‘', end: '’' }
        ];

        for (const pair of quotePairs) {
            let startIdx = 0;
            while (startIdx < text.length) {
                const openIdx = text.indexOf(pair.start, startIdx);
                if (openIdx === -1) break;

                const closeIdx = text.indexOf(pair.end, openIdx + 1);
                if (closeIdx === -1) break;

                dialogueRanges.push([openIdx, closeIdx]);
                startIdx = closeIdx + 1;
            }
        }

        dialogueRanges.sort((a, b) => a[0] - b[0]);

        const mergedDialogueRanges: [number, number][] = [];
        for (const range of dialogueRanges) {
            if (mergedDialogueRanges.length === 0) {
                mergedDialogueRanges.push(range);
            } else {
                const last = mergedDialogueRanges[mergedDialogueRanges.length - 1];
                if (range[0] <= last[1]) {
                    last[1] = Math.max(last[1], range[1]);
                } else {
                    mergedDialogueRanges.push(range);
                }
            }
        }

        const dialogueSet = new Set<number>();
        for (const [start, end] of mergedDialogueRanges) {
            for (let i = start; i <= end; i++) {
                dialogueSet.add(i);
            }
        }

        const sentences = this.splitSentences(text);
        let charOffset = 0;

        for (const sentence of sentences) {
            const sentenceStart = text.indexOf(sentence, charOffset);
            const sentenceEnd = sentenceStart + sentence.length;
            charOffset = sentenceEnd;

            const chineseCharsInSentence = this.countChineseChars(sentence);
            if (chineseCharsInSentence === 0) continue;

            let dialogueInSentence = 0;
            for (let i = sentenceStart; i < sentenceEnd; i++) {
                if (dialogueSet.has(i) && this.isChineseChar(text[i])) {
                    dialogueInSentence++;
                }
            }

            const nonDialogueChars = chineseCharsInSentence - dialogueInSentence;
            dialogueChars += dialogueInSentence;

            if (nonDialogueChars > 0) {
                const deCount = (sentence.match(/的/g) || []).length;
                const deRatio = deCount / nonDialogueChars;

                if (deRatio > 0.08 && nonDialogueChars > 5) {
                    descriptionChars += nonDialogueChars;
                } else {
                    narrationChars += nonDialogueChars;
                }
            }

            const sayMatch = sentence.match(/(说|道|问|答|喊|叫|嚷|吼|骂|笑|哭|叹|哼|哈)[道啊呢吧吗呀了着过的]*/);
            if (sayMatch && dialogueInSentence === 0) {
                const sayIdx = sentence.indexOf(sayMatch[0]);
                const afterSay = sentence.slice(sayIdx + sayMatch[0].length);
                const afterSayChinese = this.countChineseChars(afterSay);
                if (afterSayChinese > 0) {
                    dialogueChars += Math.min(afterSayChinese, nonDialogueChars);
                    const adjustment = Math.min(afterSayChinese, nonDialogueChars);
                    if (descriptionChars >= adjustment) {
                        descriptionChars -= adjustment;
                    } else if (narrationChars >= adjustment - descriptionChars) {
                        narrationChars -= (adjustment - descriptionChars);
                        descriptionChars = 0;
                    }
                }
            }
        }

        return { dialogueChars, descriptionChars, narrationChars };
    }

    private buildSentenceDistribution(lengths: number[]): { label: string; value: number }[] {
        const buckets = [0, 0, 0, 0, 0, 0];
        const labels = ['1-10字', '11-20字', '21-30字', '31-50字', '51-100字', '100+字'];

        for (const len of lengths) {
            if (len <= 10) buckets[0]++;
            else if (len <= 20) buckets[1]++;
            else if (len <= 30) buckets[2]++;
            else if (len <= 50) buckets[3]++;
            else if (len <= 100) buckets[4]++;
            else buckets[5]++;
        }

        return labels.map((label, i) => ({ label, value: buckets[i] }));
    }

    private buildParagraphDistribution(lengths: number[]): { label: string; value: number }[] {
        const buckets = [0, 0, 0, 0, 0, 0];
        const labels = ['1-50字', '51-100字', '101-200字', '201-500字', '501-1000字', '1000+字'];

        for (const len of lengths) {
            if (len <= 50) buckets[0]++;
            else if (len <= 100) buckets[1]++;
            else if (len <= 200) buckets[2]++;
            else if (len <= 500) buckets[3]++;
            else if (len <= 1000) buckets[4]++;
            else buckets[5]++;
        }

        return labels.map((label, i) => ({ label, value: buckets[i] }));
    }

    private extractTopWords(text: string, topN: number): { text: string; count: number }[] {
        const wordCount = new Map<string, number>();

        const cleanText = text.replace(/\s+/g, '');

        for (let n = 2; n <= 3; n++) {
            for (let i = 0; i <= cleanText.length - n; i++) {
                const gram = cleanText.slice(i, i + n);

                let allChinese = true;
                for (let j = 0; j < gram.length; j++) {
                    if (!this.isChineseChar(gram[j])) {
                        allChinese = false;
                        break;
                    }
                }
                if (!allChinese) continue;

                if (STOP_WORDS.has(gram)) continue;

                wordCount.set(gram, (wordCount.get(gram) || 0) + 1);
            }
        }

        const englishWords = text.match(/[a-zA-Z]+['-]?[a-zA-Z]*/g);
        if (englishWords) {
            for (const word of englishWords) {
                const lower = word.toLowerCase();
                if (lower.length < 2) continue;
                wordCount.set(lower, (wordCount.get(lower) || 0) + 1);
            }
        }

        const sorted = Array.from(wordCount.entries())
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN);

        return sorted.map(([text, count]) => ({ text, count }));
    }

    private extractTopPunctuations(text: string, topN: number): { text: string; count: number }[] {
        const punctCount = new Map<string, number>();

        for (const p of CHINESE_PUNCTUATIONS) {
            let count = 0;
            let idx = 0;
            while ((idx = text.indexOf(p, idx)) !== -1) {
                count++;
                idx += p.length;
            }
            if (count > 0) {
                punctCount.set(p, count);
            }
        }

        const sorted = Array.from(punctCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN);

        return sorted.map(([text, count]) => ({ text, count }));
    }
}
