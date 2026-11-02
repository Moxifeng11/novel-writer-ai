/**
 * shared/previous-chapter-window.ts — 前文章节上下文窗口（纯函数）
 *
 * 协同实时监控此前只读「同卷上一章」：
 * - 卷首章（如第 291 章在第 3 卷、第 290 章在第 2 卷）按同卷拼路径读不到，前文上下文为空；
 * - 只有 1 章正文，跨章的外貌矛盾与伏笔线索看不到。
 *
 * 这里只做两件事：按章号选出最近的若干章正文文件，并按字符预算裁剪。
 * 文件读取、frontmatter 解析仍由调用方负责。
 */

export const PREVIOUS_CHAPTER_WINDOW_SIZE = 3;
/** 单章进入上下文的字符上限 */
export const PREVIOUS_CHAPTER_CHAR_LIMIT = 12000;
/** 全部前文章节的字符上限 */
export const PREVIOUS_CHAPTER_TOTAL_CHAR_LIMIT = 30000;

/**
 * BodyFileRef 类型定义。
 */
export interface BodyFileRef {
    path: string;
    name: string;
}

/**
 * PreviousChapterFile 类型定义。
 */
export interface PreviousChapterFile {
    chapterNum: number;
    path: string;
}

/**
 * PreviousChapterSource 类型定义。
 */
export interface PreviousChapterSource {
    chapterNum: number;
    raw: string;
}

/**
 * PreviousChapterSlice 类型定义。
 */
export interface PreviousChapterSlice {
    chapterNum: number;
    text: string;
}

/**
 * PreviousChapterWindowOptions 类型定义。
 */
export interface PreviousChapterWindowOptions {
    perChapterLimit?: number;
    totalLimit?: number;
}

const BODY_FILE_NAME = /^第(\d+)章.*_正文\.md$/;

/**
 * 去掉 Markdown frontmatter，只保留正文（元数据不参与矛盾检测）
 *
 * @param content - 内容
 * @returns 文本结果
 */
export function stripFrontmatterBlock(content: string): string {
    if (!content) return '';
    return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
}

/**
 * 从正文文件列表里选出当前章之前最近的 `windowSize` 章。
 * 返回按章号降序（最近优先）；同章多份文件时保留路径最短的正稿。
 * @param files - 文件列表
 * @param currentChapterNum - 当前章节编号
 * @param windowSize - 窗口大小
 * @returns 结果数组
 */
export function selectPreviousChapterFiles(
    files: BodyFileRef[],
    currentChapterNum: number,
    windowSize: number = PREVIOUS_CHAPTER_WINDOW_SIZE,
): PreviousChapterFile[] {
    if (!Number.isFinite(currentChapterNum) || currentChapterNum <= 1 || windowSize <= 0) return [];

    const minChapterNum = Math.max(1, currentChapterNum - windowSize);
    const byChapter = new Map<number, string>();
    for (const file of files) {
        const match = BODY_FILE_NAME.exec(file.name);
        if (!match) continue;
        const chapterNum = Number(match[1]);
        if (!Number.isFinite(chapterNum)) continue;
        if (chapterNum < minChapterNum || chapterNum >= currentChapterNum) continue;

        const existing = byChapter.get(chapterNum);
        if (!existing || file.path.length < existing.length) {
            byChapter.set(chapterNum, file.path);
        }
    }

    return [...byChapter.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([chapterNum, path]) => ({ chapterNum, path }));
}

/**
 * 按预算把前文章节裁剪成上下文片段：最近优先消耗总量预算，
 * 单章超过上限时截断，空正文跳过。
 * @param sources - 来源列表
 * @param options - 配置项
 * @returns 结果数组
 */
export function buildPreviousChapterWindow(
    sources: PreviousChapterSource[],
    options: PreviousChapterWindowOptions = {},
): PreviousChapterSlice[] {
    const perChapterLimit = options.perChapterLimit ?? PREVIOUS_CHAPTER_CHAR_LIMIT;
    const totalLimit = options.totalLimit ?? PREVIOUS_CHAPTER_TOTAL_CHAR_LIMIT;
    if (totalLimit <= 0 || perChapterLimit <= 0) return [];

    const sorted = sources
        .filter(source => Number.isFinite(source.chapterNum))
        .sort((a, b) => b.chapterNum - a.chapterNum);

    const result: PreviousChapterSlice[] = [];
    let used = 0;
    for (const source of sorted) {
        const body = stripFrontmatterBlock(source.raw).trim();
        if (!body) continue;

        const remaining = totalLimit - used;
        if (remaining <= 0) break;

        const text = body.slice(0, Math.min(perChapterLimit, remaining));
        result.push({ chapterNum: source.chapterNum, text });
        used += text.length;
    }
    return result;
}
