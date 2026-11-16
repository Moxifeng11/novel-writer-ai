/**
 * text-diff.ts — 建议与正文的行级差异（2026-11-16，E-05）
 *
 * 背景：建议卡只显示整段候选文本，作者看不到「相对当前正文改了什么」，
 * 采纳前判断成本高、容易采纳走形文本。
 *
 * 实现：行级 LCS 差异（行数通常 < 100，O(n*m) 足够），输出 +/‑/空格行。
 * 纯函数，便于单测。
 */

/** 差异行类型 */
export type DiffKind = 'same' | 'add' | 'del';

/** 一行差异 */
export interface DiffRow {
    kind: DiffKind;
    text: string;
    /** 行号（same/del 来自 A，add 来自 B）；1 起 */
    lineA?: number;
    lineB?: number;
}

/** 差异结果 */
export interface TextDiffResult {
    rows: DiffRow[];
    added: number;
    removed: number;
    /** 两段文本是否完全一致 */
    identical: boolean;
}

/**
 * 计算行级差异。
 *
 * @param before - 原文（通常为光标前正文）
 * @param after - 候选文本
 * @returns 差异行与增删统计
 * @example
 * diffLines("a\nb", "a\nc").added; // 1
 */
export function diffLines(before: string, after: string): TextDiffResult {
    const a = String(before ?? '').split('\n');
    const b = String(after ?? '').split('\n');
    const n = a.length;
    const m = b.length;
    // 先剥掉公共前后缀，显著减少 DP 规模
    let start = 0;
    while (start < n && start < m && a[start] === b[start]) start += 1;
    let endA = n - 1;
    let endB = m - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA -= 1;
        endB -= 1;
    }
    const midA = a.slice(start, endA + 1);
    const midB = b.slice(start, endB + 1);

    const rows: DiffRow[] = [];
    for (let index = 0; index < start; index += 1) {
        rows.push({ kind: 'same', text: a[index], lineA: index + 1, lineB: index + 1 });
    }

    const lcs = buildLcsTable(midA, midB);
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
        if (midA[i] === midB[j]) {
            rows.push({ kind: 'same', text: midA[i], lineA: start + i + 1, lineB: start + j + 1 });
            i += 1;
            j += 1;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            rows.push({ kind: 'del', text: midA[i], lineA: start + i + 1 });
            i += 1;
        } else {
            rows.push({ kind: 'add', text: midB[j], lineB: start + j + 1 });
            j += 1;
        }
    }
    while (i < midA.length) {
        rows.push({ kind: 'del', text: midA[i], lineA: start + i + 1 });
        i += 1;
    }
    while (j < midB.length) {
        rows.push({ kind: 'add', text: midB[j], lineB: start + j + 1 });
        j += 1;
    }

    for (let index = 0; index < n - 1 - endA; index += 1) {
        const sourceIndex = endA + 1 + index;
        rows.push({
            kind: 'same',
            text: a[sourceIndex],
            lineA: sourceIndex + 1,
            lineB: endB + 2 + index,
        });
    }

    const added = rows.filter(row => row.kind === 'add').length;
    const removed = rows.filter(row => row.kind === 'del').length;
    return { rows, added, removed, identical: added === 0 && removed === 0 };
}

/**
 * 构建 LCS 长度表（后缀）。
 *
 * @param a - 行数组 A
 * @param b - 行数组 B
 * @returns (n+1)×(m+1) 表
 */
function buildLcsTable(a: readonly string[], b: readonly string[]): number[][] {
    const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i][j] = a[i] === b[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    return table;
}

/**
 * 差异摘要文案（建议卡标题行用）。
 *
 * @param result - 差异结果
 * @returns 摘要，如「+3 −1 行」或「与正文一致」
 * @example
 * describeDiff({ rows: [], added: 2, removed: 1, identical: false }); // '+2 −1 行'
 */
export function describeDiff(result: TextDiffResult): string {
    if (result.identical) return '与正文一致';
    return `+${result.added} −${result.removed} 行`;
}
