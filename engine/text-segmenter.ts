/**
 * text-segmenter.ts — 文本分段器
 *
 * 功能：将长篇小说文本按章节/段落/字数切分为合适大小的段，
 *       用于后续分段拆解，支持段间重叠保证上下文连续性。
 *
 * 三级分段策略：
 * 1. 按章节分段（优先）—— 匹配"第X章"、"第X节"、"Chapter X"等
 * 2. 按段落分段 —— 章节不明或单章超长时，按段落切分
 * 3. 按字数硬切 —— 超长单段的兜底策略
 */

import { yieldToUI } from '../shared/yield';
import { countCjkAndWords, countPlatformWords, countTotalChars as sharedTotalChars, countCjkChars } from '../shared/word-count';

/**
 * 文本分段。
 */
export interface TextSegment {
    index: number;
    text: string;
    startOffset: number;
    endOffset: number;
    wordCount: number;
    chapterTitle?: string;
    /** 从前段继承的滚动摘要（前段人物/伏笔/关键事件的简短描述） */
    rollingSummary?: string;
    /** 与前段共享的重叠文本 */
    overlapWithPrev?: string;
}

/**
 * 分段选项。
 */
export interface SegmentOptions {
    maxSegmentWords?: number;
    minSegmentWords?: number;
    overlapWords?: number;
    preferChapter?: boolean;
}

const DEFAULT_OPTIONS: Required<SegmentOptions> = {
    maxSegmentWords: 5000,
    minSegmentWords: 2000,
    overlapWords: 100,
    preferChapter: true,
};

const CHAPTER_PATTERNS = [
    /^第[一二三四五六七八九十百千万零〇0-9]+[章回节卷集篇]/m,
    /^Chapter\s+[0-9]+/im,
    /^第[0-9]+章/m,
    /^第[0-9]+节/m,
    /^第[0-9]+卷/m,
    /^\d+\s*[.、]\s*.{2,}/m,
];

/**
 * 预处理结果。
 */
export interface PreprocessResult {
    text: string;
    isEmpty: boolean;
    charCount: number;
}

export function normalizeText(text: string): string {
    if (!text) {
        return '';
    }

    let normalized = text.replace(/\r\n?/g, '\n');
    normalized = normalized.replace(/[\u200B\uFEFF]/g, '');
    normalized = normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    normalized = normalized.replace(/[\u3000\u00A0]/g, ' ');
    normalized = normalized.replace(/[ \t]+\n/g, '\n');
    normalized = normalized.replace(/[ \t]+$/g, '');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    return normalized;
}

export function preprocess(text: string): PreprocessResult {
    const normalized = normalizeText(text);
    const trimmed = normalized.trim();
    return {
        text: normalized,
        isEmpty: trimmed.length === 0,
        charCount: trimmed.length,
    };
}

/**
 * 从文本中提取关键人物实体名
 *
 * 识别规则：
 * 1. 书名号内的人名：《紫川秀》《帝林》等
 * 2. 对话引语前的说话人名：XX说/问道/笑道 等
 *
 * @returns 去重后的人名列表
 */
export function extractKeyEntities(text: string): string[] {
    const entities = new Set<string>();

    const bookTitlePattern = /《([\u4e00-\u9fa5]{2,4})》/g;
    let match: RegExpExecArray | null;
    while ((match = bookTitlePattern.exec(text)) !== null) {
        entities.add(match[1]);
    }

    const dialoguePattern = /([\u4e00-\u9fa5]{2,4}?)(?:问道|笑道|说道|答道|怒道|冷声道|淡淡道|轻声道|大叫|说|道|问|答|喊|叫|吼|嚷|喝|骂|笑|哭|叹)[：:""]/g;
    const pronouns = new Set(['他', '她', '它', '你', '我', '您', '俺', '咱']);
    while ((match = dialoguePattern.exec(text)) !== null) {
        const name = match[1];
        const hasPronoun = [...name].some(ch => pronouns.has(ch));
        if (!pronouns.has(name) && !hasPronoun) {
            entities.add(name);
        }
    }

    return [...entities];
}

/**
 * 文本分段器。
 */
export class TextSegmenter {
    private options: Required<SegmentOptions>;

    constructor(options: SegmentOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 分段。
     *
     * @param rawText - 参数
     * @returns 分段数组
     */
    async segment(rawText: string): Promise<TextSegment[]> {
        const text = normalizeText(rawText);
        if (!text || text.trim().length === 0) {
            return [];
        }

        const wordCount = countCjkAndWords(text);

        if (this.options.preferChapter) {
            const chapterSegments = await this.segmentByChapter(text);
            if (chapterSegments.length > 1) {
                return this.normalizeChapterSegments(chapterSegments);
            }
        }

        if (wordCount <= this.options.maxSegmentWords) {
            return [this.createSegment(text, 0, 0)];
        }

        const paragraphSegments = await this.segmentByParagraph(text);
        if (paragraphSegments.length > 1) {
            return this.normalizeSegments(paragraphSegments);
        }

        return this.segmentByWordCount(text);
    }

    /**
     * 带滚动上下文的分段——在 segment() 基础上为每段注入前段摘要信息
     *
     * 对第 2 段及之后：
     * - rollingSummary：前段末尾 ~200 字 + 关键人物列表
     * - overlapWithPrev：与前段共享的重叠文本
     */
    async segmentWithContext(text: string): Promise<TextSegment[]> {
        const segments = await this.segment(text);
        if (segments.length <= 1) {
            return segments;
        }

        for (let i = 1; i < segments.length; i++) {
            const prevSeg = segments[i - 1];
            const currSeg = segments[i];

            const tailText = this.getTailWords(prevSeg.text, 200);
            const entities = extractKeyEntities(prevSeg.text);
            const overlapText = this.getTailWords(prevSeg.text, this.options.overlapWords);

            let rollingSummary = tailText;
            if (entities.length > 0) {
                rollingSummary = rollingSummary + '\n\n关键人物：' + entities.join('、');
            }

            currSeg.rollingSummary = rollingSummary;
            currSeg.overlapWithPrev = overlapText;
        }

        return segments;
    }

    private async segmentByChapter(text: string): Promise<TextSegment[]> {
        const segments: TextSegment[] = [];
        const lines = text.split('\n');
        let currentText = '';
        let currentOffset = 0;
        let currentChapter = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (this.isChapterTitle(line)) {
                if (currentText.length > 0) {
                    segments.push(this.createSegment(
                        currentText,
                        segments.length,
                        currentOffset,
                        currentChapter,
                    ));
                }
                currentText = line + '\n';
                currentOffset = text.indexOf(line, currentOffset);
                currentChapter = line.trim();
            } else {
                currentText += line + '\n';
            }

            if (i % 100 === 0) {
                await yieldToUI();
            }
        }

        if (currentText.length > 0) {
            segments.push(this.createSegment(
                currentText,
                segments.length,
                currentOffset,
                currentChapter,
            ));
        }

        return segments;
    }

    private isChapterTitle(line: string): boolean {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.length > 50) {
            return false;
        }

        for (const pattern of CHAPTER_PATTERNS) {
            if (pattern.test(trimmed)) {
                return true;
            }
        }

        return false;
    }

    private async segmentByParagraph(text: string): Promise<TextSegment[]> {
        const segments: TextSegment[] = [];
        const paragraphs = text.split(/\n\s*\n/);
        let currentText = '';
        let currentWordCount = 0;
        let currentOffset = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraWordCount = countCjkAndWords(para);

            if (currentWordCount + paraWordCount > this.options.maxSegmentWords && currentWordCount > 0) {
                segments.push(this.createSegment(currentText, segments.length, currentOffset));
                const overlapText = this.getTailWords(currentText, this.options.overlapWords);
                currentOffset = text.indexOf(para, currentOffset + currentText.length - overlapText.length);
                currentText = overlapText + '\n\n' + para;
                currentWordCount = countCjkAndWords(currentText);
            } else {
                if (currentText.length === 0) {
                    currentOffset = text.indexOf(para, currentOffset);
                }
                currentText += (currentText.length > 0 ? '\n\n' : '') + para;
                currentWordCount += paraWordCount;
            }

            if (i % 50 === 0) {
                await yieldToUI();
            }
        }

        if (currentText.length > 0) {
            segments.push(this.createSegment(currentText, segments.length, currentOffset));
        }

        return segments;
    }

    private segmentByWordCount(text: string): TextSegment[] {
        const segments: TextSegment[] = [];
        const charsPerWord = text.length / Math.max(1, countCjkAndWords(text));
        const maxChars = Math.floor(this.options.maxSegmentWords * charsPerWord);
        const overlapChars = Math.floor(this.options.overlapWords * charsPerWord);

        let offset = 0;
        let index = 0;

        while (offset < text.length) {
            let end = Math.min(offset + maxChars, text.length);

            if (end < text.length) {
                const punctuations = ['。', '！', '？', '；', '\n', '.', '!', '?'];
                let found = -1;
                for (const punct of punctuations) {
                    const pos = text.lastIndexOf(punct, end);
                    if (pos > offset + maxChars * 0.5) {
                        found = Math.max(found, pos + 1);
                    }
                }
                if (found > 0) {
                    end = found;
                }
            }

            const segmentText = text.slice(offset, end);
            segments.push(this.createSegment(segmentText, index, offset));

            if (end >= text.length) {
                break;
            }

            const nextOffset = Math.max(end - overlapChars, offset + 1);
            offset = nextOffset;
            index++;
        }

        return segments;
    }

    private normalizeChapterSegments(segments: TextSegment[]): TextSegment[] {
        const result: TextSegment[] = [];

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];

            if (seg.wordCount > this.options.maxSegmentWords * 1.5) {
                const subSegments = this.segmentByWordCount(seg.text);
                for (const subSeg of subSegments) {
                    result.push({
                        ...subSeg,
                        index: result.length,
                        startOffset: seg.startOffset + subSeg.startOffset,
                        endOffset: seg.startOffset + subSeg.endOffset,
                        chapterTitle: seg.chapterTitle,
                    });
                }
            } else {
                result.push({
                    ...seg,
                    index: result.length,
                });
            }

            if (i > 0 && result.length > 1) {
                const prevSeg = result[result.length - 2];
                const currSeg = result[result.length - 1];
                const overlapText = this.getTailWords(prevSeg.text, this.options.overlapWords);
                if (overlapText.length > 0 && !currSeg.text.startsWith(overlapText)) {
                    currSeg.text = overlapText + currSeg.text;
                    currSeg.startOffset -= overlapText.length;
                    currSeg.wordCount = countCjkAndWords(currSeg.text);
                }
            }
        }

        return result;
    }

    private normalizeSegments(segments: TextSegment[]): TextSegment[] {
        const result: TextSegment[] = [];
        let currentText = '';
        let currentOffset = 0;
        let currentWordCount = 0;
        let currentChapter = '';

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];

            if (seg.wordCount > this.options.maxSegmentWords * 1.5) {
                if (currentText.length > 0) {
                    result.push(this.createSegment(currentText, result.length, currentOffset, currentChapter));
                    currentText = '';
                    currentWordCount = 0;
                }

                const subSegments = this.segmentByWordCount(seg.text);
                for (const subSeg of subSegments) {
                    result.push({
                        ...subSeg,
                        index: result.length,
                        startOffset: seg.startOffset + subSeg.startOffset,
                        endOffset: seg.startOffset + subSeg.endOffset,
                        chapterTitle: seg.chapterTitle,
                    });
                }
                currentChapter = seg.chapterTitle || '';
                continue;
            }

            if (currentWordCount + seg.wordCount > this.options.maxSegmentWords && currentWordCount >= this.options.minSegmentWords) {
                result.push(this.createSegment(currentText, result.length, currentOffset, currentChapter));

                const overlapText = this.getTailWords(currentText, this.options.overlapWords);
                currentOffset = seg.startOffset - overlapText.length;
                currentText = overlapText + seg.text;
                currentWordCount = countCjkAndWords(currentText);
                currentChapter = seg.chapterTitle || currentChapter;
            } else {
                if (currentText.length === 0) {
                    currentOffset = seg.startOffset;
                    currentChapter = seg.chapterTitle || '';
                }
                currentText += seg.text;
                currentWordCount += seg.wordCount;
                if (seg.chapterTitle) {
                    currentChapter = seg.chapterTitle;
                }
            }
        }

        if (currentText.length > 0) {
            result.push(this.createSegment(currentText, result.length, currentOffset, currentChapter));
        }

        return result;
    }

    private createSegment(
        text: string,
        index: number,
        startOffset: number,
        chapterTitle?: string,
    ): TextSegment {
        const trimmed = text;
        return {
            index,
            text: trimmed,
            startOffset,
            endOffset: startOffset + trimmed.length,
            wordCount: countCjkAndWords(trimmed),
            chapterTitle,
        };
    }


    /** 兼容既有调用与单测：私有计数器仍保留，但实现已统一到 shared/word-count */
    private countWords(text: string): number {
        return countCjkAndWords(text);
    }

    private getTailWords(text: string, wordCount: number): string {
        const charsPerWord = text.length / Math.max(1, countCjkAndWords(text));
        const charCount = Math.floor(wordCount * charsPerWord);
        return text.slice(-charCount);
    }
}

export function countTotalChars(text: string): number {
    return sharedTotalChars(text);
}

/**
 * 字数统计口径。
 */
export type WordCountMode = 'total' | 'chinese_only' | 'platform';

export function countWords(text: string, mode: WordCountMode = 'platform'): number {
    if (!text) return 0;
    switch (mode) {
        case 'total':
            return sharedTotalChars(text);
        case 'chinese_only':
            return countCjkChars(text);
        case 'platform':
        default:
            return countPlatformWords(text);
    }
}
