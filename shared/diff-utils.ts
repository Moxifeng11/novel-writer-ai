/**
 * diff-utils.ts — Diff 算法工具函数
 *
 * 实现基于 LCS（最长公共子序列）的行级 diff 和字符级 diff，
 * 不引入任何外部依赖。
 */
import type { LineDiff, CharDiff, DiffStats, DiffOp } from './version-types';
import { countCjkAndWords } from './word-count';

/**
 * 计算两个数组的最长公共子序列 (LCS) 长度矩阵
 * 使用动态规划实现
 */
function lcsMatrix<T>(a: T[], b: T[]): number[][] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp;
}

/**
 * 从 LCS 矩阵回溯，生成 diff 操作序列
 */
function backtrackLcs<T>(
    dp: number[][],
    a: T[],
    b: T[],
    i: number,
    j: number,
    result: { op: DiffOp; value: T; oldIdx: number; newIdx: number }[],
): void {
    if (i === 0 && j === 0) return;

    if (i === 0) {
        backtrackLcs(dp, a, b, i, j - 1, result);
        result.push({ op: 'insert', value: b[j - 1], oldIdx: -1, newIdx: j - 1 });
        return;
    }

    if (j === 0) {
        backtrackLcs(dp, a, b, i - 1, j, result);
        result.push({ op: 'delete', value: a[i - 1], oldIdx: i - 1, newIdx: -1 });
        return;
    }

    if (a[i - 1] === b[j - 1]) {
        backtrackLcs(dp, a, b, i - 1, j - 1, result);
        result.push({ op: 'equal', value: a[i - 1], oldIdx: i - 1, newIdx: j - 1 });
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
        backtrackLcs(dp, a, b, i - 1, j, result);
        result.push({ op: 'delete', value: a[i - 1], oldIdx: i - 1, newIdx: -1 });
    } else {
        backtrackLcs(dp, a, b, i, j - 1, result);
        result.push({ op: 'insert', value: b[j - 1], oldIdx: -1, newIdx: j - 1 });
    }
}

/**
 * 行级 Diff 计算
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns 行级 diff 结果数组
 */
export function lineDiff(oldText: string, newText: string): LineDiff[] {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const dp = lcsMatrix(oldLines, newLines);
    const operations: { op: DiffOp; value: string; oldIdx: number; newIdx: number }[] = [];
    backtrackLcs(dp, oldLines, newLines, oldLines.length, newLines.length, operations);

    const result: LineDiff[] = [];
    let i = 0;

    while (i < operations.length) {
        const op = operations[i];

        if (op.op === 'equal') {
            result.push({
                op: 'equal',
                oldLine: op.oldIdx,
                newLine: op.newIdx,
                content: op.value,
            });
            i++;
        } else if (op.op === 'delete') {
            if (i + 1 < operations.length && operations[i + 1].op === 'insert') {
                const next = operations[i + 1];
                result.push({
                    op: 'replace',
                    oldLine: op.oldIdx,
                    newLine: next.newIdx,
                    content: op.value,
                });
                i += 2;
            } else {
                result.push({
                    op: 'delete',
                    oldLine: op.oldIdx,
                    newLine: -1,
                    content: op.value,
                });
                i++;
            }
        } else if (op.op === 'insert') {
            result.push({
                op: 'insert',
                oldLine: -1,
                newLine: op.newIdx,
                content: op.value,
            });
            i++;
        } else {
            i++;
        }
    }

    return result;
}

/**
 * 字符级 Diff 计算
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns 字符级 diff 结果数组
 */
export function charDiff(oldText: string, newText: string): CharDiff[] {
    const oldChars = oldText.split('');
    const newChars = newText.split('');

    if (oldChars.length === 0 && newChars.length === 0) {
        return [];
    }
    if (oldChars.length === 0) {
        return [{ op: 'insert', content: newText }];
    }
    if (newChars.length === 0) {
        return [{ op: 'delete', content: oldText }];
    }

    const dp = lcsMatrix(oldChars, newChars);
    const operations: { op: DiffOp; value: string }[] = [];

    const backtrack = (i: number, j: number): void => {
        if (i === 0 && j === 0) return;
        if (i === 0) {
            backtrack(i, j - 1);
            operations.push({ op: 'insert', value: newChars[j - 1] });
            return;
        }
        if (j === 0) {
            backtrack(i - 1, j);
            operations.push({ op: 'delete', value: oldChars[i - 1] });
            return;
        }
        if (oldChars[i - 1] === newChars[j - 1]) {
            backtrack(i - 1, j - 1);
            operations.push({ op: 'equal', value: oldChars[i - 1] });
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            backtrack(i - 1, j);
            operations.push({ op: 'delete', value: oldChars[i - 1] });
        } else {
            backtrack(i, j - 1);
            operations.push({ op: 'insert', value: newChars[j - 1] });
        }
    };

    backtrack(oldChars.length, newChars.length);

    const result: CharDiff[] = [];
    let currentOp: DiffOp | null = null;
    let currentContent = '';

    for (const op of operations) {
        if (op.op === currentOp) {
            currentContent += op.value;
        } else {
            if (currentOp !== null) {
                result.push({ op: currentOp, content: currentContent });
            }
            currentOp = op.op;
            currentContent = op.value;
        }
    }

    if (currentOp !== null) {
        result.push({ op: currentOp, content: currentContent });
    }

    return result;
}

/**
 * 计算 Diff 统计信息
 * @param diffs 行级 diff 结果
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns 统计信息
 */
export function computeDiffStats(diffs: LineDiff[], oldText: string, newText: string): DiffStats {
    let addedLines = 0;
    let deletedLines = 0;
    let modifiedLines = 0;
    let unchangedLines = 0;

    for (const diff of diffs) {
        switch (diff.op) {
            case 'insert':
                addedLines++;
                break;
            case 'delete':
                deletedLines++;
                break;
            case 'replace':
                modifiedLines++;
                break;
            case 'equal':
                unchangedLines++;
                break;
        }
    }

    const totalLines = newText.split('\n').length;
    const changedLines = addedLines + deletedLines + modifiedLines;
    const changeRatio = totalLines === 0 ? 0 : changedLines / totalLines;

    const oldChars = oldText.length;
    const newChars = newText.length;
    const addedChars = Math.max(0, newChars - oldChars);
    const deletedChars = Math.max(0, oldChars - newChars);

    return {
        addedLines,
        deletedLines,
        modifiedLines,
        unchangedLines,
        totalLines,
        changeRatio,
        addedChars,
        deletedChars,
    };
}


/**
 * 生成版本唯一 ID
 * @returns 版本 ID
 */
export function generateVersionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `v_${timestamp}_${random}`;
}

/**
 * 格式化时间戳为易读的日期时间字符串
 * @param isoString ISO 时间字符串
 * @returns 格式化后的时间
 */
export function formatVersionTime(isoString: string): string {
    const date = new Date(isoString);
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * 版本类型中文映射
 */
export const VERSION_TYPE_LABELS: Record<string, string> = {
    'manual': '手动保存',
    'ai-generate': 'AI生成',
    'polish': '润色',
    'import': '导入',
    'rollback': '回滚保存',
};

/**
 * 内容类型中文映射
 */
export const CONTENT_TYPE_LABELS: Record<string, string> = {
    'chapter': '章节',
    'outline': '大纲',
    'worldview': '世界观',
    'character': '人物设定',
    'setting': '设定',
};

/** 字数统计（中文按字算，英文按词算）——统一实现见 shared/word-count */
export function countWords(text: string): number {
    return countCjkAndWords(text);
}
