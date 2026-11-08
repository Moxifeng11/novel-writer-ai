import { countCjkAndWords } from '@/shared/word-count';
/**
 * chapter-recognizer.ts — 智能章节识别服务
 *
 * 功能：自动识别小说章节标题、提取书名、作者、估算字数
 * 支持多种格式：.txt、.md
 */

export interface ChapterInfo {
    index: number;
    title: string;
    rawTitle: string;
    startIndex: number;
    endIndex: number;
    wordCount: number;
}

/**
 * 书籍识别结果。
 */
export interface BookRecognitionResult {
    title: string;
    author?: string;
    wordCount: number;
    chapterCount: number;
    chapters: ChapterInfo[];
    format: 'txt' | 'md' | 'unknown';
    confidence: number;
}

// 章节标题模式：数字位同时接受 ASCII 与全角（０-９）。
// 第 6/7/8 条旧模式（CHAPTER 大写、第\d+章、第 \d+ 章）已被前两条与 Chapter/i 覆盖，删除以免重复匹配。
const CHAPTER_PATTERNS = [
    /^第[一二三四五六七八九十百千万零〇两\d０-９]+[章节回卷部集篇]/,
    /^第\s*[一二三四五六七八九十百千万零〇两\d０-９]+\s*[章节回卷部集篇]/,
    /^[一二三四五六七八九十百千万零〇两]+[、.]\s*\S/,
    /^[\d０-９]+[、.\s]\s*\S/,
    /^Chapter\s*[\d０-９]+/i,
    /^卷[一二三四五六七八九十百千万零〇两\d０-９]+/,
    /^第[一二三四五六七八九十百千万零〇两\d０-９]+卷/,
];

const MARKDOWN_HEADING_PATTERNS = [
    /^#{1,3}\s+.+/,
    /^.+\n=+\s*$/,
    /^.+\n-+\s*$/,
];

const AUTHOR_PATTERNS = [
    /^作者[:：]\s*(.+)$/m,
    /^作\s*者[:：]\s*(.+)$/m,
    /^[【\[]作者[】\]]\s*(.+)$/m,
    /^著者[:：]\s*(.+)$/m,
];

const TITLE_FROM_CONTENT_PATTERNS = [
    /^《(.+?)》/,
    /^书名[:：]\s*(.+)$/m,
    /^[【\[]书名[】\]]\s*(.+)$/m,
];

function detectFormat(filename: string, content: string): 'txt' | 'md' | 'unknown' {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'md') return 'md';
    if (ext === 'txt') return 'txt';

    const mdIndicators = [
        content.match(/^#{1,3}\s/m),
        content.match(/\*\*[^*]+\*\*/),
        content.match(/\[[^\]]+\]\([^)]+\)/),
    ];
    const mdScore = mdIndicators.filter(Boolean).length;
    if (mdScore >= 2) return 'md';

    return 'txt';
}

function extractTitle(filename: string, content: string): string {
    const baseName = filename.replace(/\.(txt|md)$/i, '');

    for (const pattern of TITLE_FROM_CONTENT_PATTERNS) {
        const match = content.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    const firstLines = content.split('\n').slice(0, 10).filter(l => l.trim());
    if (firstLines.length > 0) {
        const firstLine = firstLines[0].trim();
        if (firstLine.length < 50 && firstLine.length > 0) {
            return firstLine.replace(/^#+\s*/, '').trim();
        }
    }

    return baseName;
}

function extractAuthor(content: string): string | undefined {
    for (const pattern of AUTHOR_PATTERNS) {
        const match = content.match(pattern);
        if (match && match[1]) {
            const author = match[1].trim();
            if (author.length > 0 && author.length < 50) {
                return author;
            }
        }
    }
    return undefined;
}


function isChapterLine(line: string, format: 'txt' | 'md' | 'unknown'): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;

    if (format === 'md') {
        if (/^#{1,3}\s+/.test(trimmed)) {
            return true;
        }
    }

    for (const pattern of CHAPTER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return true;
        }
    }

    return false;
}

function extractChapterTitle(line: string, format: 'txt' | 'md' | 'unknown'): string {
    let title = line.trim();

    if (format === 'md') {
        title = title.replace(/^#{1,3}\s+/, '');
    }

    return title;
}

/**
 * recognizeChapters 函数。
 * @param content - 内容
 * @param filename - 文件名
  * @returns BookRecognitionResult 实例
 */
export function recognizeChapters(
    content: string,
    filename: string = ''
): BookRecognitionResult {
    const format = detectFormat(filename, content);
    const lines = content.split('\n');

    const title = extractTitle(filename, content);
    const author = extractAuthor(content);
    const wordCount = countCjkAndWords(content);

    const chapters: ChapterInfo[] = [];
    let currentChapterIndex = -1;
    let chapterStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isChapterLine(line, format)) {
            if (currentChapterIndex >= 0) {
                const endIndex = i - 1;
                const chapterText = lines.slice(chapterStartLine, endIndex + 1).join('\n');
                chapters[currentChapterIndex].endIndex = endIndex;
                chapters[currentChapterIndex].wordCount = countCjkAndWords(chapterText);
            }

            currentChapterIndex++;
            chapterStartLine = i;
            const chapterTitle = extractChapterTitle(line, format);

            chapters.push({
                index: currentChapterIndex,
                title: chapterTitle,
                rawTitle: line.trim(),
                startIndex: i,
                endIndex: lines.length - 1,
                wordCount: 0,
            });
        }
    }

    if (currentChapterIndex >= 0 && chapters[currentChapterIndex]) {
        const chapterText = lines.slice(chapterStartLine, lines.length).join('\n');
        chapters[currentChapterIndex].endIndex = lines.length - 1;
        chapters[currentChapterIndex].wordCount = countCjkAndWords(chapterText);
    }

    let confidence = 0;
    if (chapters.length > 0) {
        confidence += 0.4;
    }
    if (chapters.length >= 5) {
        confidence += 0.2;
    }
    if (author) {
        confidence += 0.1;
    }
    if (title && title !== filename.replace(/\.(txt|md)$/i, '')) {
        confidence += 0.1;
    }
    if (format !== 'unknown') {
        confidence += 0.2;
    }

    confidence = Math.min(confidence, 1);

    return {
        title,
        author,
        wordCount,
        chapterCount: chapters.length,
        chapters,
        format,
        confidence,
    };
}

/**
 * 获取章节文本。
 * @param content - 内容
 * @param chapter - 章节
 * @returns 文本结果
 */
export function getChapterText(content: string, chapter: ChapterInfo): string {
    const lines = content.split('\n');
    return lines.slice(chapter.startIndex, chapter.endIndex + 1).join('\n');
}

/**
 * 章节识别器。
 */
export class ChapterRecognizer {
    constructor() {}

    /**
     * 识别章节结构。
     *
     * @param content - 内容
     * @param filename - 参数
     * @returns 识别结果
     */
    recognize(content: string, filename?: string): BookRecognitionResult {
        return recognizeChapters(content, filename);
    }

    /**
     * 抽取标题。
     *
     * @param content - 内容
     * @param filename - 参数
     * @returns 标题
     */
    extractTitle(content: string, filename?: string): string {
        return extractTitle(filename || '', content);
    }

    /**
     * 抽取作者。
     *
     * @param content - 内容
     * @returns 作者
     */
    extractAuthor(content: string): string | undefined {
        return extractAuthor(content);
    }

    /**
     * 统计字数。
     *
     * @param text - 文本内容
     * @returns 字数
     */
    countWords(text: string): number {
        return countCjkAndWords(text);
    }

    /**
     * 取章节文本。
     *
     * @param content - 内容
     * @param chapter - 章节
     * @returns 文本
     */
    getChapterText(content: string, chapter: ChapterInfo): string {
        return getChapterText(content, chapter);
    }
}
