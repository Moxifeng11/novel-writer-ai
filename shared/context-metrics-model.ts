/**
 * context-metrics-model.ts — 注入量对比（M14 指标）
 *
 * 从注入账本（injection-ledger）记录计算「改造前 / 改造后」对比：
 * 总 token、截断次数、丢弃段数、每步均值，并给出结论。
 * 纯函数，不读盘。
 */

/** 单步注入记录（与 injection-ledger 字段对齐的最小形状） */
export interface InjectionRecord {
    /** 步骤键 */
    step: string;
    /** 字符数 */
    chars: number;
    /** 估算 token */
    estTokens: number;
    /** 截断段数 */
    truncated?: number;
    /** 丢弃段数 */
    dropped?: number;
}

/** 汇总 */
export interface InjectionSummary {
    /** 记录数 */
    records: number;
    /** 总 token */
    totalTokens: number;
    /** 总字符 */
    totalChars: number;
    /** 截断总次数 */
    truncated: number;
    /** 丢弃总段数 */
    dropped: number;
    /** 每步 token */
    byStep: Record<string, number>;
}

/** 对比结果 */
export interface MetricsComparison {
    /** 改造前 */
    before: InjectionSummary;
    /** 改造后 */
    after: InjectionSummary;
    /** token 变化（after - before，负数表示下降） */
    tokenDelta: number;
    /** token 变化百分比（负数表示下降） */
    tokenDeltaPercent: number;
    /** 截断变化 */
    truncatedDelta: number;
    /** 结论 */
    verdict: string;
}

/**
 * 汇总注入记录。
 *
 * @param records - 记录
 * @returns 汇总
 */
export function summarizeInjection(records: readonly InjectionRecord[]): InjectionSummary {
    const byStep: Record<string, number> = {};
    let totalTokens = 0;
    let totalChars = 0;
    let truncated = 0;
    let dropped = 0;
    for (const record of records) {
        totalTokens += record.estTokens;
        totalChars += record.chars;
        truncated += record.truncated ?? 0;
        dropped += record.dropped ?? 0;
        byStep[record.step] = (byStep[record.step] ?? 0) + record.estTokens;
    }
    return { records: records.length, totalTokens, totalChars, truncated, dropped, byStep };
}

/**
 * 对比改造前后。
 *
 * @param before - 改造前记录
 * @param after - 改造后记录
 * @returns 对比
 */
export function compareMetrics(
    before: readonly InjectionRecord[],
    after: readonly InjectionRecord[],
): MetricsComparison {
    const b = summarizeInjection(before);
    const a = summarizeInjection(after);
    const tokenDelta = a.totalTokens - b.totalTokens;
    const tokenDeltaPercent = b.totalTokens === 0 ? 0 : Math.round((tokenDelta / b.totalTokens) * 1000) / 10;
    const truncatedDelta = a.truncated - b.truncated;
    const parts: string[] = [];
    if (tokenDelta < 0) parts.push(`注入 token 下降 ${Math.abs(tokenDeltaPercent)}%`);
    else if (tokenDelta > 0) parts.push(`注入 token 上升 ${tokenDeltaPercent}%`);
    else parts.push('注入 token 持平');
    if (truncatedDelta < 0) parts.push(`截断减少 ${Math.abs(truncatedDelta)} 次`);
    else if (truncatedDelta > 0) parts.push(`截断增加 ${truncatedDelta} 次`);
    return {
        before: b,
        after: a,
        tokenDelta,
        tokenDeltaPercent,
        truncatedDelta,
        verdict: parts.join('；'),
    };
}

/**
 * 渲染对比报告。
 *
 * @param comparison - 对比
 * @returns 文本
 */
export function renderMetricsReport(comparison: MetricsComparison): string {
    const { before, after } = comparison;
    if (before.records === 0 && after.records === 0) return '暂无注入账本数据（需要真实章节运行记录）';
    const lines = [
        '【注入量对比】',
        `改造前：${before.records} 条记录，${before.totalTokens} token，截断 ${before.truncated} 次，丢弃 ${before.dropped} 段`,
        `改造后：${after.records} 条记录，${after.totalTokens} token，截断 ${after.truncated} 次，丢弃 ${after.dropped} 段`,
        `结论：${comparison.verdict}`,
    ];
    const steps = [...new Set([...Object.keys(before.byStep), ...Object.keys(after.byStep)])];
    if (steps.length > 0) {
        lines.push('按步骤：');
        for (const step of steps) {
            lines.push(`- ${step}：${before.byStep[step] ?? 0} → ${after.byStep[step] ?? 0}`);
        }
    }
    return lines.join('\n');
}
