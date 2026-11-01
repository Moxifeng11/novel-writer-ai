/**
 * settlement-journal.ts — 结算回滚日志（run 级）
 *
 * 背景：旧回滚只恢复 frontmatter 字段与删除新建文件，关系/伏笔/时间线/成长/账本
 * 这些「追加类写入」全部回滚不到 → hasPartialFailure 时留下半套数据。
 *
 * 三类条目（见 docs/design/g1-authority-decisions.md §2.2）：
 * - frontmatter-field：恢复字段原值
 * - whole-file-before：恢复整份文件前值（关系状态/伏笔库/时间线/承诺账本/弧线）
 * - append-marker：精确移除本次追加的内容（成长行/账本片段/互信息行/行为日志行）
 *
 * 关键：append-marker 只删自己写的那一段，不回退整文件——
 * 结算期间用户或其它入口的合法写入不会被误伤。
 */

import { createLogger } from '../../shared/logger';

const log = createLogger('SettlementJournal');

export type JournalEntry =
    | { kind: 'frontmatter-field'; path: string; field: string; before: string }
    | { kind: 'whole-file-before'; path: string; before: string }
    | { kind: 'append-marker'; path: string; marker: string };

export interface JournalFilePort {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}

export interface JournalFrontmatterPort {
    /** 读取单个字段的当前值 */
    readField(path: string, field: string): Promise<string>;
    /** 把字段恢复为指定值 */
    restoreField(path: string, field: string, value: string): Promise<void>;
}

export interface RollbackReport {
    reverted: number;
    failed: number;
    failures: Array<{ entry: JournalEntry; error: string }>;
}

export class SettlementJournal {
    private entries: JournalEntry[] = [];
    /** 同一文件只保留第一份前值（后续写入不覆盖回滚点） */
    private wholeFileSeen = new Set<string>();
    private fieldSeen = new Set<string>();
    private markerSeen = new Set<string>();

    get size(): number {
        return this.entries.length;
    }

    get isEmpty(): boolean {
        return this.entries.length === 0;
    }

    recordField(path: string, field: string, before: string): void {
        const key = `${path}\u0000${field}`;
        if (this.fieldSeen.has(key)) return;
        this.fieldSeen.add(key);
        this.entries.push({ kind: 'frontmatter-field', path, field, before });
    }

    recordWholeFile(path: string, before: string): void {
        if (this.wholeFileSeen.has(path)) return;
        this.wholeFileSeen.add(path);
        this.entries.push({ kind: 'whole-file-before', path, before });
    }

    recordAppend(path: string, marker: string): void {
        const normalized = marker.trim();
        if (!normalized) return;
        const key = `${path}\u0000${normalized}`;
        if (this.markerSeen.has(key)) return;
        this.markerSeen.add(key);
        this.entries.push({ kind: 'append-marker', path, marker: normalized });
    }

    /** 按逆序回滚；单条失败不影响其余条目，但会计入 failed 供调用方告警 */
    async rollback(fs: JournalFilePort, frontmatter: JournalFrontmatterPort): Promise<RollbackReport> {
        const report: RollbackReport = { reverted: 0, failed: 0, failures: [] };
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            try {
                if (entry.kind === 'frontmatter-field') {
                    await frontmatter.restoreField(entry.path, entry.field, entry.before);
                } else if (entry.kind === 'whole-file-before') {
                    await fs.write(entry.path, entry.before);
                } else {
                    if (!(await fs.exists(entry.path))) {
                        report.reverted++;
                        continue;
                    }
                    const current = await fs.read(entry.path);
                    const next = removeMarkerOnce(current, entry.marker);
                    if (next !== current) await fs.write(entry.path, next);
                }
                report.reverted++;
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                log.warn(`[SettlementJournal] 回滚条目失败（${entry.kind} ${entry.path}）:`, message);
                report.failed++;
                report.failures.push({ entry, error: message });
            }
        }
        this.entries = [];
        this.wholeFileSeen.clear();
        this.fieldSeen.clear();
        this.markerSeen.clear();
        return report;
    }
}

/**
 * 从内容里移除第一次出现的 marker。
 *
 * 支持两种形态：
 * - 整行标记（成长/互信息/行为日志）：按行精确匹配，去掉整行（含其换行）
 * - 行内片段（连续性账本「；值（第N章）」）：删掉 marker 文本，并清理残留分隔符
 */
export function removeMarkerOnce(content: string, marker: string): string {
    const lines = content.split('\n');
    const exactLineIdx = lines.findIndex(line => line.trim() === marker);
    if (exactLineIdx >= 0) {
        lines.splice(exactLineIdx, 1);
        return lines.join('\n');
    }
    const idx = content.indexOf(marker);
    if (idx < 0) return content;
    let before = content.slice(0, idx);
    let after = content.slice(idx + marker.length);
    // 清理连续性账本的分隔符：'；值（第N章）；下一项' → '；下一项'
    if (before.endsWith('；') && after.startsWith('；')) {
        after = after.slice(1);
    } else if (before.endsWith('；') && !after.trim()) {
        before = before.slice(0, -1);
    }
    return `${before}${after}`;
}
