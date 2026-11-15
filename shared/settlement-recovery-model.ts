/**
 * settlement-recovery-model.ts — 结算恢复面板的纯展示逻辑
 *
 * `SettlementJournalStore.listPending()` 只给章节名；真正恢复前先用 dryRun
 * 拿到每章残留条目数，再让用户确认。这里的函数只做格式化/汇总。
 */

/** 单章恢复结果 */
export interface SettlementRecoveryRow {
    chapterName: string;
    /** 日志条目数 */
    entries: number;
    /** 已回滚条数（dryRun 时为 0） */
    reverted: number;
    /** 失败条数 */
    failed: number;
    /** 是否已清理日志（恢复成功） */
    cleared: boolean;
}

/**
 * 是否有待恢复章节。
 *
 * @param rows - 行
 * @returns 是则 true
 * @example
 * ```ts
 * hasPendingSettlement([]); // false
 * ```
 */
export function hasPendingSettlement(rows: readonly SettlementRecoveryRow[]): boolean {
    return rows.some(row => row.entries > 0);
}

/**
 * 汇总预览行（dryRun 结果）。
 *
 * @param rows - 行
 * @returns 文本行
 * @example
 * ```ts
 * describeSettlementPreview([]); // ['没有发现残留的结算回滚日志：上次结算都完整结束了。']
 * ```
 */
export function describeSettlementPreview(rows: readonly SettlementRecoveryRow[]): string[] {
    if (!hasPendingSettlement(rows)) {
        return ['没有发现残留的结算回滚日志：上次结算都完整结束了。'];
    }
    const totalEntries = rows.reduce((sum, row) => sum + row.entries, 0);
    const lines = [
        `发现 ${rows.filter(row => row.entries > 0).length} 个章节有残留结算日志（共 ${totalEntries} 条回滚记录）。`,
        '恢复会把这些记录涉及的实体字段/整份文件/追加内容回退到结算前状态；恢复成功后会删除对应日志。',
    ];
    return lines;
}

/**
 * 单行描述。
 *
 * @param row - 行
 * @param dryRun - 是否预览模式
 * @returns 文本
 * @example
 * ```ts
 * describeSettlementRow({ chapterName: '第一章', entries: 2, reverted: 0, failed: 0, cleared: false }, true);
 * // '第一章：2 条待回滚'
 * ```
 */
export function describeSettlementRow(row: SettlementRecoveryRow, dryRun: boolean): string {
    if (dryRun) return `${row.chapterName}：${row.entries} 条待回滚`;
    if (row.failed > 0) return `${row.chapterName}：回滚 ${row.reverted}，失败 ${row.failed}（日志保留，可重试）`;
    return `${row.chapterName}：回滚 ${row.reverted} 条${row.cleared ? '，日志已清理' : ''}`;
}

/**
 * 恢复完成后的汇总文本。
 *
 * @param rows - 行
 * @returns 文本
 * @example
 * ```ts
 * describeSettlementOutcome([]); // '没有可恢复的章节。'
 * ```
 */
export function describeSettlementOutcome(rows: readonly SettlementRecoveryRow[]): string {
    if (rows.length === 0) return '没有可恢复的章节。';
    const reverted = rows.reduce((sum, row) => sum + row.reverted, 0);
    const failed = rows.reduce((sum, row) => sum + row.failed, 0);
    if (failed > 0) return `恢复完成：回滚 ${reverted} 条，${failed} 条失败（日志已保留，可再次恢复）。`;
    return `恢复完成：回滚 ${reverted} 条，日志已清理。`;
}
