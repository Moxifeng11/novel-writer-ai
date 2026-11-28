/**
 * timeline-chain.ts — 结构化时间与「章节时间轴链式校验」
 *
 * 来源与动机：云笔（aixiaoshuojia.cn）的 T 行时间轴设计——
 * 时间必须是 `纪年-年-月-日` 的结构化值而非自由文本，并对相邻章做链式约束：
 * 「严禁每章 +1 天式机械推进」，多章可同日，闪回章可回退但不得越界。
 * 本仓此前的 `TimelineEvent.time` 是自由文本（如「黄昏/三日后」），
 * 无法做任何机械校验（见 docs/audits/2026-11-25-yunbi-writing-flow.md §九）。
 *
 * 本模块只做**纯计算**：解析、排序键、相邻章链式校验。不读盘、不调用模型。
 * 硬错误只给「时间倒退」；「机械推进」是软告警（作者可能真的一天一章）。
 */

/** 结构化日期（纪元 + 年月日） */
export interface StructuredDate {
    /** 纪元名，如「公元」「天启」「开国」；空串表示未声明纪元 */
    era: string;
    year: number;
    /** 1-12 */
    month: number;
    /** 1-31（不做月份天数校验，见文件头「不猜日历」） */
    day: number;
}

/** 一次章节时间跨度（起始/结束；闪回章可整体早于前章） */
export interface ChapterTimeSpan {
    chapter: number;
    start: StructuredDate | null;
    end: StructuredDate | null;
    /** 闪回/插叙：允许时间早于前章，但仍需 start ≤ end */
    isFlashback?: boolean;
}

/** 链式校验问题 */
export interface TimelineChainIssue {
    kind: 'reversed-span' | 'backwards' | 'mechanical-advance';
    /** 稳定机器码（与 kind 一一对应，便于非中文消费方判定与统计） */
    code: 'timeline.reversedSpan' | 'timeline.backwards' | 'timeline.mechanicalAdvance';
    /** 相关章节号（mechanical 时为连续段的末章） */
    chapter: number;
    severity: 'error' | 'warning';
    message: string;
}

const CN_ERA_HINTS = ['纪元', '纪年'];

/**
 * 解析结构化日期文本。
 *
 * 接受三种书写：`公元-2-4-15`、`公元 2年4月15日`、`2-4-15`（无纪元）。
 * 解析失败返回 null（调用方按「未标注」处理，不要瞎猜）。
 *
 * @param text - 原始时间文本
 * @returns 结构化日期或 null
 * @example
 * parseStructuredDate('公元-2-4-15') // { era: '公元', year: 2, month: 4, day: 15 }
 * parseStructuredDate('三日后') // null
 */
export function parseStructuredDate(text: string): StructuredDate | null {
    const raw = String(text ?? '').trim();
    if (!raw) return null;

    // 形态一：纪元-年-月-日（分隔符允许 - / . _ 混用）
    const dashed = raw.match(/^([^\s\-/._\d][^\s\-/._]*)[-/._](\d{1,4})[-/._](\d{1,2})[-/._](\d{1,2})$/);
    if (dashed) {
        const d = toDate(dashed[1], dashed[2], dashed[3], dashed[4]);
        if (d) return d;
    }

    // 形态二：纪元 2年4月15日（中文单位）
    const cn = raw.match(/^([^\s\d]*)\s*(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
    if (cn) {
        const era = cn[1].replace(new RegExp(`[${CN_ERA_HINTS.join('')}]`, 'g'), '').trim();
        const d = toDate(era, cn[2], cn[3], cn[4]);
        if (d) return d;
    }

    // 形态三：纯数字 年-月-日（无纪元）
    const bare = raw.match(/^(\d{1,4})[-/._](\d{1,2})[-/._](\d{1,2})$/);
    if (bare) {
        const d = toDate('', bare[1], bare[2], bare[3]);
        if (d) return d;
    }

    return null;
}

function toDate(era: string, y: string, m: string, d: string): StructuredDate | null {
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    return { era: String(era ?? '').trim(), year, month, day };
}

/**
 * 日期排序键：同纪元内 `年*10000 + 月*100 + 日`。
 *
 * 跨纪元不可比（纪元名不同时由调用方视为「不可比」，返回 null），
 * 避免为不存在的纪年顺序瞎猜。
 *
 * @param d - 结构化日期
 * @returns 整数排序键，或 null（含非法值）
 * @example
 * dateSortKey({ era: '公元', year: 2, month: 4, day: 15 }) // 20415
 */
export function dateSortKey(d: StructuredDate | null): number | null {
    if (!d) return null;
    if (!Number.isFinite(d.year) || !Number.isFinite(d.month) || !Number.isFinite(d.day)) return null;
    return d.year * 10000 + d.month * 100 + d.day;
}

/**
 * 比较两个日期（必须同纪元）。
 *
 * @param a - 日期 A
 * @param b - 日期 B
 * @returns 负数 A<B，0 相同，正数 A>B；纪元不同或非法返回 null
 * @example
 * compareDates(parseStructuredDate('公元-2-4-15'), parseStructuredDate('公元-2-4-16')) // -1
 */
export function compareDates(a: StructuredDate | null, b: StructuredDate | null): number | null {
    const ka = dateSortKey(a);
    const kb = dateSortKey(b);
    if (ka === null || kb === null) return null;
    if ((a as StructuredDate).era !== (b as StructuredDate).era) return null;
    return ka === kb ? 0 : ka < kb ? -1 : 1;
}

/**
 * 同月内的天数差。
 *
 * 不猜日历：跨月/跨年返回 null（只做能确定的部分），
 * 因此「机械 +1 天」检测只在同月相邻章之间生效——宁可漏报不误报。
 *
 * @param from - 起始日期
 * @param to - 结束日期
 * @returns 天数差，无法确定时 null
 * @example
 * dayDelta(parseStructuredDate('公元-2-4-15'), parseStructuredDate('公元-2-4-16')) // 1
 */
export function dayDelta(from: StructuredDate | null, to: StructuredDate | null): number | null {
    if (!from || !to) return null;
    if (from.era !== to.era) return null;
    if (from.year !== to.year || from.month !== to.month) return null;
    return to.day - from.day;
}

/**
 * 章节时间轴链式校验。
 *
 * 规则（来自云笔 T 行设计，按本仓「宁可漏报不误报」取舍）：
 * 1. **reversed-span（error）**：同一章 start > end —— 数据自相矛盾
 * 2. **backwards（error）**：非闪回章的 start 早于前一非闪回章的 end —— 时间倒退
 * 3. **mechanical-advance（warning）**：连续 3 段及以上、每段恰好 +1 天 ——
 *    疑似机械推进；同日（0 天）与跨月（不可比）不计入
 *
 * 闪回章：允许整体回退，但仍需满足规则 1；且不参与规则 2 的「前章基准」继承。
 *
 * @param spans - 按章节升序的章节时间跨度
 * @returns 问题列表（按严重级降序、章节升序）
 * @example
 * validateTimelineChain([
 *   { chapter: 1, start: parseStructuredDate('公元-2-4-15'), end: parseStructuredDate('公元-2-4-16') },
 *   { chapter: 2, start: parseStructuredDate('公元-2-4-15'), end: parseStructuredDate('公元-2-4-17') },
 * ]) // [{ kind: 'backwards', chapter: 2, severity: 'error', ... }]
 */
export function validateTimelineChain(spans: ChapterTimeSpan[]): TimelineChainIssue[] {
    const issues: TimelineChainIssue[] = [];
    const ordered = [...spans].sort((a, b) => a.chapter - b.chapter);

    let prevEnd: StructuredDate | null = null;
    let prevChapter = 0;
    let plusOneRun = 0;

    for (const span of ordered) {
        // 规则 1：本章内部矛盾
        if (span.start && span.end) {
            const cmp = compareDates(span.start, span.end);
            if (cmp !== null && cmp > 0) {
                issues.push({
                    kind: 'reversed-span',
                    code: 'timeline.reversedSpan',
                    chapter: span.chapter,
                    severity: 'error',
                    message: `第${span.chapter}章时间跨度倒置：起始晚于结束`,
                });
            }
        }

        if (span.isFlashback) {
            // 闪回不继承基准、不参与机械推进检测
            plusOneRun = 0;
            continue;
        }

        // 规则 2：与前章比较（仅在能比较时）
        if (prevEnd && span.start) {
            const cmp = compareDates(span.start, prevEnd);
            if (cmp !== null && cmp < 0) {
                issues.push({
                    kind: 'backwards',
                    code: 'timeline.backwards',
                    chapter: span.chapter,
                    severity: 'error',
                    message: `第${span.chapter}章起始时间早于第${prevChapter}章结束（非闪回章不得倒流）`,
                });
            }
        }

        // 规则 3：机械 +1 天（仅同月可判定）
        if (prevEnd && span.start) {
            const delta = dayDelta(prevEnd, span.start);
            if (delta === 1) {
                plusOneRun += 1;
                if (plusOneRun >= 3) {
                    issues.push({
                        kind: 'mechanical-advance',
                        code: 'timeline.mechanicalAdvance',
                        chapter: span.chapter,
                        severity: 'warning',
                        message: `第${span.chapter - plusOneRun}–${span.chapter}章连续每章恰好推进 1 天，疑似机械推进；请核对是否该有同日或跳跃`,
                    });
                    plusOneRun = 0; // 报一次即可，避免刷屏
                }
            } else {
                plusOneRun = 0;
            }
        }

        if (span.end) {
            prevEnd = span.end;
            prevChapter = span.chapter;
        } else if (span.start) {
            prevEnd = span.start;
            prevChapter = span.chapter;
        }
    }

    return issues.sort((a, b) => {
        const w = severityWeight(b.severity) - severityWeight(a.severity);
        return w !== 0 ? w : a.chapter - b.chapter;
    });
}

function severityWeight(s: 'error' | 'warning'): number {
    return s === 'error' ? 2 : 1;
}

/**
 * 渲染校验结论为一行摘要（用于待确认清单/日志）。
 *
 * @param issues - 校验结果
 * @returns 摘要文本；无问题时返回空串
 * @example
 * renderTimelineChainSummary([]) // ''
 */
export function renderTimelineChainSummary(issues: TimelineChainIssue[]): string {
    if (issues.length === 0) return '';
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const head = `时间轴链式校验：${errors.length} 项错误 / ${warnings.length} 项告警`;
    return [head, ...issues.map((i) => `- [${i.severity === 'error' ? '错误' : '告警'}] ${i.message}`)].join('\n');
}
