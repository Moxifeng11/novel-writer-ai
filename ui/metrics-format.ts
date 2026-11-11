/**
 * metrics-format.ts — 性能指标的格式化与聚合（阶段 D1）
 *
 * 从 `ui/settings/general-sections.ts` 的 `PerformanceSection` 抽出。
 *
 * 注意与 `ui/views/kb-format.ts#formatDuration` 的区别——**两者不能合并**：
 * - `kb-format.formatDuration` 是「阅读时长」的中文长格式（`2小时5分`）
 * - 本模块的 `formatPerfDuration` 是「性能面板」的技术格式（`2.05s`）
 * 语义不同，合并会改变界面显示。
 *
 * 抽出的理由：`< 1024` / `< 1e6` 这类边界与单位换算是易错点，
 * 内联在 1100 行的设置页里没有任何测试。
 */

/** 单类操作的统计 */
export interface OperationStat {
    count: number;
    totalDuration: number;
}

/** 操作统计聚合结果 */
export interface OperationTotals {
    /** 总操作数 */
    totalOps: number;
    /** 总耗时（ms） */
    totalDuration: number;
    /** 平均耗时（ms）；无操作时为 0 */
    avgDuration: number;
}

/**
 * 格式化性能耗时（技术口径：μs / ms / s / min）。
 *
 * 阈值：
 * - `< 1` → μs（`0.50μs`）
 * - `< 1000` → ms
 * - `< 60000` → s
 * - 其它 → min
 *
 * @param ms - 毫秒数
 * @returns 格式化字符串
 */
export function formatPerfDuration(ms: number): string {
    const value = Number(ms);
    if (!Number.isFinite(value)) return '0ms';
    if (value < 1) return `${(value * 1000).toFixed(2)}μs`;
    if (value < 1000) return `${value.toFixed(2)}ms`;
    if (value < 60000) return `${(value / 1000).toFixed(2)}s`;
    return `${(value / 60000).toFixed(2)}min`;
}

/**
 * 格式化字节数（B / KB / MB / GB，1024 进制）。
 *
 * @param bytes - 字节数
 * @returns 格式化字符串
 */
export function formatByteSize(bytes: number): string {
    const value = Number(bytes);
    if (!Number.isFinite(value)) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 聚合分类统计（总操作数 / 总耗时 / 平均耗时）。
 *
 * @param categoryStats - 分类统计表
 * @returns 聚合结果
 */
export function aggregateOperationStats(
    categoryStats: Record<string, OperationStat> | null | undefined,
): OperationTotals {
    const stats = categoryStats ? Object.values(categoryStats) : [];
    let totalOps = 0;
    let totalDuration = 0;
    for (const stat of stats) {
        const count = Number(stat?.count);
        const duration = Number(stat?.totalDuration);
        if (Number.isFinite(count)) totalOps += count;
        if (Number.isFinite(duration)) totalDuration += duration;
    }
    return {
        totalOps,
        totalDuration,
        avgDuration: totalOps > 0 ? totalDuration / totalOps : 0,
    };
}

/**
 * 格式化缓存命中率（0–1 → 百分比）。
 *
 * @param hitRate - 命中率（0–1）
 * @returns 百分比字符串；非法值返回 `N/A`
 */
export function formatHitRate(hitRate: number | undefined): string {
    const value = Number(hitRate);
    if (!Number.isFinite(value)) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
}
