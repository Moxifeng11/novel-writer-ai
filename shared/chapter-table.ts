/**
 * chapter-table.ts — 章节分配表的统一解析规则
 *
 * 全书规划生成（outline-contract）与批量建章校验（volume-plan）必须使用同一套
 * 表头 / 分隔行 / 章号单元格识别规则，否则会出现「生成端认为合法、建章端校验失败」
 * 的两套算法漂移。
 */

export interface ParsedChapterRow {
    chapterNumber: number;
    description: string;
}

const CHAPTER_HEADER_CELLS = new Set(['章号', '章节', '#', '章', '序号']);

/** 按 Markdown 表格切分单元格（去掉首尾竖线） */
export function splitTableCells(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return [];
    const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    return body.split('|').map(cell => cell.trim());
}

/** 是否为「| 章号 | 核心冲突 |」这类表头行（支持 # / 章节 / 序号） */
export function isChapterTableHeaderLine(line: string): boolean {
    const cells = splitTableCells(line);
    if (cells.length === 0) return false;
    return CHAPTER_HEADER_CELLS.has(cells[0].replace(/\s/g, ''));
}

/** 是否为 Markdown 表格分隔行（|---|---| / |:--|--:|） */
export function isTableSeparatorLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return false;
    return trimmed.includes('-') && /^\|[\s:|-]+\|?$/.test(trimmed);
}

/**
 * 解析章号单元格。容忍 AI 常见写法：
 * `1` / `**1**` / `第1章` / `1.` / `1（开篇）`。
 * 含范围（1-2）或日期（2024-01）的单元格不会被误判为单章。
 */
export function parseChapterNumberCell(cell: string): number | null {
    const cleaned = cell.replace(/\*/g, '').trim();
    const match = cleaned.match(/^(?:第\s*)?(\d+)\s*章?\s*(?:[（(][^）)]*[）)])?[.、]?$/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/** 解析一条章节数据行；表头/分隔行/其它表格行返回 null */
export function parseChapterRow(line: string): ParsedChapterRow | null {
    const cells = splitTableCells(line);
    if (cells.length < 2) return null;
    const chapterNumber = parseChapterNumberCell(cells[0]);
    if (chapterNumber === null) return null;
    const description = cells.slice(1).join(' | ').replace(/\|/g, '／').trim();
    return { chapterNumber, description };
}

/**
 * 提取文本中所有「章节分配表」的数据行。
 * 只识别表头之后的连续表格块，卷内其它数字表格（三幕结构/爽点节奏）不会被误算。
 */
export function extractChapterTableRows(content: string): ParsedChapterRow[] {
    const rows: ParsedChapterRow[] = [];
    let inChapterTable = false;

    for (const raw of content.split(/\r?\n/)) {
        const trimmed = raw.trim();
        if (isChapterTableHeaderLine(trimmed)) {
            inChapterTable = true;
            continue;
        }
        if (!inChapterTable) continue;
        if (!trimmed) {
            inChapterTable = false;
            continue;
        }
        if (!trimmed.startsWith('|')) {
            inChapterTable = false;
            continue;
        }
        if (isTableSeparatorLine(trimmed)) continue;
        const row = parseChapterRow(trimmed);
        if (row) rows.push(row);
    }

    return rows;
}
