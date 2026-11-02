/**
 * volume-plan.ts — 分卷大纲解析与一致性校验
 *
 * 批量建章不再依赖「手动选一卷」，而是直接消费上一个步骤产出的全书规划
 * （分卷大纲/*_分卷大纲.md 合并文本）。建章前必须先通过本模块的校验，
 * 避免把错误的大纲范围落成章节骨架，导致后续流水线全部错位。
 */

import { RE_CHAPTER_RANGE, RE_VOLUME_HEADER } from './format-constants';
import {
    isChapterTableHeaderLine,
    isTableSeparatorLine,
    parseChapterRow,
} from './chapter-table';

export interface VolumePlan {
    /** 卷号（第N卷 → N） */
    volumeNumber: number;
    /** 卷标签，如「第1卷」 */
    volumeLabel: string;
    /** 卷名，如「《初入宗门》」中的书名号内容 */
    volumeName: string;
    startChapter: number;
    endChapter: number;
    /** 实际要创建的章号列表（来自大纲表格；无表格时回退为范围） */
    chapterNumbers: number[];
    rawSection: string;
}

export interface VolumePlanIssue {
    level: 'error' | 'warning';
    volumeNumber?: number;
    message: string;
}

export interface VolumePlanParseResult {
    volumes: VolumePlan[];
    issues: VolumePlanIssue[];
}

const RE_VOLUME_NAME_FIELD = /-\s*\*\*卷名\*\*[：:]\s*(.+)/;
const RE_CHAPTER_RANGE_FIELD = new RegExp(`-\\s*\\*\\*章节范围\\*\\*[：:]\\s*${RE_CHAPTER_RANGE.source}`);

/**
 * 解析合并后的全书规划文本
 *
 * @param content - 内容
  * @returns VolumePlanParseResult 实例
 */
export function parseVolumePlan(content: string): VolumePlanParseResult {
    const issues: VolumePlanIssue[] = [];
    const volumes: VolumePlan[] = [];
    const text = content || '';

    const headers: Array<{ volumeNumber: number; volumeLabel: string; startIndex: number; endIndex: number }> = [];
    const headerRegex = new RegExp(RE_VOLUME_HEADER.source, 'gm');
    let match: RegExpExecArray | null;
    while ((match = headerRegex.exec(text)) !== null) {
        headers.push({
            volumeNumber: parseInt(match[1].replace(/\D/g, ''), 10) || 0,
            volumeLabel: match[1],
            startIndex: match.index,
            endIndex: -1,
        });
    }

    if (headers.length === 0) {
        issues.push({ level: 'error', message: '未找到任何分卷（期望形如「### 第1卷」的标题）' });
        return { volumes, issues };
    }

    for (let i = 0; i < headers.length; i++) {
        headers[i].endIndex = i + 1 < headers.length ? headers[i + 1].startIndex : text.length;
    }

    const seenVolumeNumbers = new Set<number>();

    for (const header of headers) {
        const section = text.substring(header.startIndex, header.endIndex);
        const volumeNumber = header.volumeNumber;

        if (volumeNumber <= 0) {
            issues.push({ level: 'error', message: `卷标题「${header.volumeLabel}」无法解析卷号` });
            continue;
        }
        if (seenVolumeNumbers.has(volumeNumber)) {
            issues.push({ level: 'error', volumeNumber, message: `卷号重复：${header.volumeLabel}` });
            continue;
        }
        seenVolumeNumbers.add(volumeNumber);

        const nameMatch = section.match(RE_VOLUME_NAME_FIELD);
        const rawName = nameMatch ? nameMatch[1].trim() : '';
        const volumeName = (rawName.match(/《(.+)》/)?.[1] || rawName || '未命名').trim();

        const rangeMatch = section.match(RE_CHAPTER_RANGE_FIELD);
        if (!rangeMatch) {
            issues.push({
                level: 'error',
                volumeNumber,
                message: `第${volumeNumber}卷缺少「- **章节范围**：第X章 - 第Y章」`,
            });
            continue;
        }

        const startChapter = parseInt(rangeMatch[1], 10);
        const endChapter = parseInt(rangeMatch[2], 10);
        if (!Number.isFinite(startChapter) || !Number.isFinite(endChapter) || startChapter <= 0 || endChapter < startChapter) {
            issues.push({
                level: 'error',
                volumeNumber,
                message: `第${volumeNumber}卷章节范围非法：第${rangeMatch[1]}章 - 第${rangeMatch[2]}章`,
            });
            continue;
        }

        const tableNumbers = extractChapterNumbers(section);

        const declaredCount = endChapter - startChapter + 1;
        let chapterNumbers: number[];

        if (tableNumbers.length === 0) {
            chapterNumbers = Array.from({ length: declaredCount }, (_, idx) => startChapter + idx);
            issues.push({
                level: 'warning',
                volumeNumber,
                message: `第${volumeNumber}卷未检测到章节表格，将按声明范围第${startChapter}-${endChapter}章创建`,
            });
        } else {
            chapterNumbers = tableNumbers;
            if (tableNumbers.length !== declaredCount) {
                issues.push({
                    level: 'error',
                    volumeNumber,
                    message: `第${volumeNumber}卷表格 ${tableNumbers.length} 章，与声明范围第${startChapter}-${endChapter}章（${declaredCount} 章）不一致`,
                });
            }
            const mismatch = findSequenceMismatch(tableNumbers, startChapter, endChapter);
            if (mismatch) {
                issues.push({ level: 'error', volumeNumber, message: `第${volumeNumber}卷${mismatch}` });
            }
        }

        volumes.push({
            volumeNumber,
            volumeLabel: header.volumeLabel,
            volumeName,
            startChapter,
            endChapter,
            chapterNumbers,
            rawSection: section,
        });
    }

    checkCrossVolumeRanges(volumes, issues);
    checkDeclaredTotals(text, volumes, issues);
    return { volumes, issues };
}

/**
 * 读取 `- **分卷数**：N` / `- **总章节数**：N` 这类全局声明
 *
 * @param text - 文本内容
 * @param field - 字段
  * @returns 数值结果 或 null
 */
function readDeclaredNumber(text: string, field: string): number | null {
    const match = text.match(new RegExp(`-\\s*\\*\\*${field}\\*\\*[：:]\\s*(\\d+)`));
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 全书总览与分卷明细必须一致，否则说明大纲本身自相矛盾
 *
 * @param text - 文本内容
 * @param volumes - 卷列表
 * @param issues - 问题列表
 */
function checkDeclaredTotals(text: string, volumes: VolumePlan[], issues: VolumePlanIssue[]): void {
    const declaredVolumes = readDeclaredNumber(text, '分卷数');
    if (declaredVolumes !== null && volumes.length > 0 && declaredVolumes !== volumes.length) {
        issues.push({
            level: 'error',
            message: `全书总览声明 ${declaredVolumes} 卷，实际解析到 ${volumes.length} 卷`,
        });
    }

    const declaredChapters = readDeclaredNumber(text, '总章节数');
    const plannedChapters = volumes.reduce((sum, v) => sum + v.chapterNumbers.length, 0);
    if (declaredChapters !== null && volumes.length > 0 && declaredChapters !== plannedChapters) {
        issues.push({
            level: 'error',
            message: `全书总览声明 ${declaredChapters} 章，分卷明细合计 ${plannedChapters} 章`,
        });
    }
}

/**
 * 只解析「| 章号 | 核心冲突 |」这张表的连续数据行。
 * 分隔行可有可无（生成端有时省略），不能依赖「表头后固定跳过两行」。
 * 卷内还可能有其他以数字开头的表格（三幕结构 / 爽点节奏等），
 * 不能把它们误算成章节。
 * @param section - 分区
 * @returns 结果数组
 */
function extractChapterNumbers(section: string): number[] {
    const lines = section.split(/\r?\n/);
    const headerIndex = lines.findIndex(line => isChapterTableHeaderLine(line));
    if (headerIndex < 0) return [];

    const numbers: number[] = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) break;
        if (isTableSeparatorLine(line)) continue;
        const row = parseChapterRow(line);
        if (row) numbers.push(row.chapterNumber);
    }
    return numbers;
}

/**
 * 表格章号必须严格等于声明范围（顺序、连续性、边界）
 *
 * @param numbers - 数值
 * @param start - 起始位置
 * @param end - 结束位置
  * @returns 文本结果 或 null
 */
function findSequenceMismatch(numbers: number[], start: number, end: number): string | null {
    const expectedLength = end - start + 1;
    for (let i = 0; i < Math.min(numbers.length, expectedLength); i++) {
        if (numbers[i] !== start + i) {
            return `表格第 ${i + 1} 行章号为 ${numbers[i]}，期望 ${start + i}`;
        }
    }
    if (numbers.length > expectedLength) {
        return `表格章号超出声明范围（多出 ${numbers.length - expectedLength} 行）`;
    }
    return null;
}

/**
 * 卷与卷之间：重叠是错误（会重复建章），断档是警告
 *
 * @param volumes - 卷列表
 * @param issues - 问题列表
 */
function checkCrossVolumeRanges(volumes: VolumePlan[], issues: VolumePlanIssue[]): void {
    const sorted = [...volumes].sort((a, b) => a.startChapter - b.startChapter);
    if (sorted.length > 0 && sorted[0].startChapter !== 1) {
        issues.push({
            level: 'warning',
            message: `全书章节未从第1章开始（当前起始为第${sorted[0].startChapter}章）`,
        });
    }
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (curr.startChapter <= prev.endChapter) {
            issues.push({
                level: 'error',
                volumeNumber: curr.volumeNumber,
                message: `第${prev.volumeNumber}卷（第${prev.startChapter}-${prev.endChapter}章）与第${curr.volumeNumber}卷（第${curr.startChapter}-${curr.endChapter}章）章节范围重叠`,
            });
        } else if (curr.startChapter > prev.endChapter + 1) {
            const gapStart = prev.endChapter + 1;
            const gapEnd = curr.startChapter - 1;
            issues.push({
                level: 'warning',
                message: gapStart === gapEnd
                    ? `第${prev.volumeNumber}卷与第${curr.volumeNumber}卷之间缺第${gapStart}章`
                    : `第${prev.volumeNumber}卷与第${curr.volumeNumber}卷之间缺第${gapStart}-${gapEnd}章`,
            });
        }
    }
}

export function hasBlockingIssues(result: VolumePlanParseResult): boolean {
    return result.issues.some(i => i.level === 'error');
}

export function countPlannedChapters(result: VolumePlanParseResult): number {
    return result.volumes.reduce((sum, v) => sum + v.chapterNumbers.length, 0);
}
