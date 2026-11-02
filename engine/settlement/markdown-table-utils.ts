import { splitTableCells } from '../../shared/chapter-table';
/**
 * engine/settlement/markdown-table-utils.ts
 * Markdown 表格通用工具 — 纯函数，无副作用，可单测。
 *
 * 从 settlement-engine.ts 提取（2026-06-30 P1-2 拆分阶段一）。
 * 保持原始逻辑 1:1 复制，仅去掉 `this.` 前缀。
 */

/**
 * 扫描 Markdown 表格内容，返回下一个可用的行号（第 1 列为递增 #）。
 * 空内容或无表格返回 1。
 * @param content - 内容
 * @returns 数值结果
 */
export function getNextRowNum(content: string): number {
    let maxNum = 0;
    if (!content) return 1;
    for (const l of content.split('\n')) {
        if (!l.match(/^\|.*\|/)) continue;
        const cols = splitTableCells(l);
        if (cols.length >= 1 && /^\d+$/.test(cols[0])) {
            const n = parseInt(cols[0]);
            if (n > maxNum) maxNum = n;
        }
    }
    return maxNum + 1;
}

/**
 * 判断 Markdown 内容是否包含表格分隔线（`|---`）。
 * @param content - 内容
 * @returns 是否成功
 */
export function hasTableSeparator(content: string): boolean {
    return content.includes('|---');
}

/**
 * 在表格分隔线后追加新行；若无分隔线则附加到末尾。
 * @param content - 内容
 * @param newRow - 新行
 * @returns 文本结果
 */
export function appendAfterSeparator(content: string, newRow: string): string {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|---')) {
            lines.splice(i + 1, 0, newRow);
            return lines.join('\n');
        }
    }
    return content.trimEnd() + '\n' + newRow + '\n';
}

/**
 * 在 Markdown 文档特定标题下表格分隔行后插入新行；若无表格则新建。
 * 仅在标题之后 15 行内查找分隔行；超过则视为"有标题无表格"，自动新建时间线表格。
 * @param content - 内容
 * @param sectionTitle - 分区标题
 * @param newRow - 新行
 * @returns 文本结果
 */
export function appendAfterSectionHeader(content: string, sectionTitle: string, newRow: string): string {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(sectionTitle)) {
            for (let j = i + 1; j < lines.length && j < i + 15; j++) {
                if (lines[j].match(/^\|[-\s]+\|/)) {
                    lines.splice(j + 1, 0, newRow);
                    return lines.join('\n');
                }
            }
            // 有标题无表格 → 新建表格
            lines.splice(i + 1, 0, '| 时间 | 对应章节 | 事件 | 影响 |', '|------|---------|------|------|', newRow);
            return lines.join('\n');
        }
    }
    return content.trimEnd() + '\n' + newRow + '\n';
}

/**
 * 重新编号表格的 # 列（顺序 1, 2, 3...）。原地修改 lines。
 * 遇到下一个 `## ` 或 `### ` 标题（且不含 sectionTitle）即停止。
 * @param lines - 行列表
 * @param sectionTitle - 分区标题
 */
export function renumberTable(lines: string[], sectionTitle: string): void {
    let inSection = false, pastSep = false, num = 1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(sectionTitle)) { inSection = true; pastSep = false; num = 1; continue; }
        if (inSection && lines[i].match(/^\|[-\s]+\|/)) { pastSep = true; continue; }
        if (inSection && pastSep && lines[i].match(/^\|.*\|/)) {
            const cols = lines[i].split('|');
            if (cols.length >= 2 && /^\d+$/.test(cols[1].trim())) {
                cols[1] = ` ${num} `;
                lines[i] = cols.join('|');
                num++;
            }
        }
        if (inSection && lines[i].match(/^#{2,3}\s/) && !lines[i].includes(sectionTitle)) break;
    }
}

/**
 * 取指定章节标题下表格分隔线之后的最大 # 编号 + 1（用于 NEW_FORESHADOW 编号）。
 * 遇到非表格行即停止。
 * @param lines - 行列表
 * @param sepIdx - 分隔符索引
 * @returns 数值结果
 */
export function getNextRowNumInSection(lines: string[], sepIdx: number): number {
    let maxNum = 0;
    for (let i = sepIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l.match(/^\|.*\|/)) break;
        const cols = splitTableCells(l);
        if (cols.length >= 1 && /^\d+$/.test(cols[0])) {
            const n = parseInt(cols[0]);
            if (n > maxNum) maxNum = n;
        }
    }
    return maxNum + 1;
}
