/**
 * manuscript-compiler.ts — 成稿编译（P0-1）
 *
 * 把项目章节按「卷 → 章」顺序合并为可交付稿：
 * - Markdown：保留结构，供二次编辑/导入其他工具
 * - Text：纯文本，供投稿/粘贴
 * - HTML：带打印样式，可在浏览器中打印为 PDF
 *
 * 纯函数实现，不依赖 Obsidian；章节读取由调用方完成。
 */

import { countWords } from '@/shared/diff-utils';

/**
 * 成稿格式。
 */
export type ManuscriptFormat = 'markdown' | 'text' | 'html';

/**
 * 待编译章节。
 */
export interface ManuscriptChapter {
    /** 卷名，如「第1卷」；可为空 */
    volume: string;
    /** 章名，如「第12章」 */
    chapter: string;
    /** 章号（用于排序） */
    chapterNum: number;
    /** 标题（frontmatter 标题，可为空） */
    title: string;
    /** 原始 Markdown 内容（含 frontmatter） */
    content: string;
    /** 源文件路径（用于诊断） */
    path: string;
}

/**
 * 编译选项。
 */
export interface CompileOptions {
    format: ManuscriptFormat;
    /** 是否输出卷标题 */
    includeVolumeHeadings: boolean;
    /** 是否输出章标题 */
    includeChapterTitles: boolean;
    /** 书名（用于 HTML title 与 Markdown 首行） */
    bookTitle?: string;
    /** 输出单元：长篇=章，短篇=节，剧本=集。仅影响标题显示，不改文件名。 */
    unitLabel?: string;
}

/**
 * 编译结果。
 */
export interface CompiledManuscript {
    content: string;
    format: ManuscriptFormat;
    chapterCount: number;
    volumeCount: number;
    wordCount: number;
    /** 正文为空的章节数 */
    emptyChapters: number;
}

/**
 * 去掉 YAML frontmatter（仅处理文件头部的 `--- ... ---`）
 *
 * @param markdown - Markdown 文本
 * @returns 文本结果
 */
export function stripFrontmatter(markdown: string): string {
    return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * 去掉正文开头重复的 H1 标题（模板中的 `# 第X章`）
 *
 * @param body - 正文
 * @returns 文本结果
 */
export function stripLeadingHeading(body: string): string {
    return body.replace(/^\s*#\s+[^\n]*\r?\n?/, '').replace(/^\s+/, '');
}

/**
 * 章节正文：去 frontmatter、去重复 H1
 *
 * @param markdown - Markdown 文本
 * @returns 文本结果
 */
export function normalizeChapterBody(markdown: string): string {
    return stripLeadingHeading(stripFrontmatter(markdown)).replace(/\s+$/, '');
}

function parseVolumeNumber(volume: string): number {
    const match = volume.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}

/**
 * 按卷号、章号稳定排序（不改动入参）
 *
 * @param chapters - 章节列表
 * @returns 结果数组
 */
export function sortManuscriptChapters(chapters: ManuscriptChapter[]): ManuscriptChapter[] {
    return [...chapters].sort((a, b) => {
        const volumeDiff = parseVolumeNumber(a.volume) - parseVolumeNumber(b.volume);
        if (volumeDiff !== 0) return volumeDiff;
        return a.chapterNum - b.chapterNum;
    });
}

/**
 * 供 EPUB/DOCX 等二进制格式复用同一套标题规则
 *
 * @param chapter - 章节
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatChapterLabel(chapter: ManuscriptChapter, options?: { unitLabel?: string }): string {
    let label = chapter.chapter;
    if (options?.unitLabel && options.unitLabel !== '章') {
        label = label.replace(/^第(\d+)章/, (_match, num) => `第${num}${options.unitLabel}`);
    }
    if (!chapter.title || chapter.title === chapter.chapter) return label;
    return `${label} ${chapter.title}`;
}

/**
 * 成稿统计。
 */
export interface ManuscriptStats {
    sorted: ManuscriptChapter[];
    chapterCount: number;
    volumeCount: number;
    wordCount: number;
    emptyChapters: number;
}

/**
 * 统一统计口径：各格式共用，避免 Markdown 与 EPUB 的「章数/字数」对不上
 *
 * @param chapters - 章节列表
  * @returns ManuscriptStats 实例
 */
export function summarizeManuscriptChapters(chapters: ManuscriptChapter[]): ManuscriptStats {
    const sorted = sortManuscriptChapters(chapters);
    const volumes = new Set(sorted.map((chapter) => chapter.volume).filter(Boolean));
    const emptyChapters = sorted.filter(
        (chapter) => normalizeChapterBody(chapter.content).trim().length === 0
    ).length;
    const wordCount = sorted.reduce(
        (sum, chapter) => sum + countWords(normalizeChapterBody(chapter.content)),
        0
    );
    return {
        sorted,
        chapterCount: sorted.length,
        volumeCount: volumes.size,
        wordCount,
        emptyChapters,
    };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function bodyToHtml(body: string): string {
    return body
        .split(/\r?\n\s*\r?\n/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
        .join('\n');
}

function buildMarkdown(sorted: ManuscriptChapter[], options: CompileOptions): string {
    const blocks: string[] = [];
    if (options.bookTitle) blocks.push(`# ${options.bookTitle}`);

    let currentVolume: string | null = null;
    for (const chapter of sorted) {
        if (options.includeVolumeHeadings && chapter.volume && chapter.volume !== currentVolume) {
            blocks.push(`# ${chapter.volume}`);
            currentVolume = chapter.volume;
        }
        if (options.includeChapterTitles) {
            blocks.push(`## ${formatChapterLabel(chapter, options)}`);
        }
        blocks.push(normalizeChapterBody(chapter.content));
    }

    return `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
}

function buildText(sorted: ManuscriptChapter[], options: CompileOptions): string {
    const blocks: string[] = [];
    if (options.bookTitle) blocks.push(options.bookTitle);

    let currentVolume: string | null = null;
    for (const chapter of sorted) {
        if (options.includeVolumeHeadings && chapter.volume && chapter.volume !== currentVolume) {
            blocks.push(chapter.volume);
            currentVolume = chapter.volume;
        }
        if (options.includeChapterTitles) {
            blocks.push(formatChapterLabel(chapter, options));
        }
        blocks.push(normalizeChapterBody(chapter.content));
    }

    return `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
}

function buildHtml(sorted: ManuscriptChapter[], options: CompileOptions): string {
    const title = escapeHtml(options.bookTitle || '小说稿件');
    const parts: string[] = [];
    let currentVolume: string | null = null;

    for (const chapter of sorted) {
        if (options.includeVolumeHeadings && chapter.volume && chapter.volume !== currentVolume) {
            parts.push(`<h1>${escapeHtml(chapter.volume)}</h1>`);
            currentVolume = chapter.volume;
        }
        if (options.includeChapterTitles) {
            parts.push(`<h2>${escapeHtml(formatChapterLabel(chapter, options))}</h2>`);
        }
        parts.push(bodyToHtml(normalizeChapterBody(chapter.content)));
    }

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { max-width: 42em; margin: 0 auto; padding: 2em 1.5em; font-family: "Songti SC", "SimSun", serif; line-height: 1.9; color: #1a1a1a; }
  h1 { margin-top: 2em; font-size: 1.6em; }
  h2 { font-size: 1.25em; margin-top: 2.4em; page-break-before: always; }
  p { margin: 0 0 0.8em; text-indent: 2em; }
  @media print { body { max-width: none; padding: 0; } @page { margin: 20mm; } }
</style>
</head>
<body>
${parts.filter((part) => part !== '').join('\n')}
</body>
</html>
`;
}

/**
 * 编译成稿；空章节仍保留标题，但在结果中计数
 *
 * @param chapters - 章节列表
 * @param options - 配置项
  * @returns CompiledManuscript 实例
 */
export function compileManuscript(
    chapters: ManuscriptChapter[],
    options: CompileOptions
): CompiledManuscript {
    const { sorted, chapterCount, volumeCount, wordCount, emptyChapters } = summarizeManuscriptChapters(chapters);

    const content =
        options.format === 'markdown'
            ? buildMarkdown(sorted, options)
            : options.format === 'text'
              ? buildText(sorted, options)
              : buildHtml(sorted, options);

    return {
        content,
        format: options.format,
        chapterCount,
        volumeCount,
        wordCount,
        emptyChapters,
    };
}
