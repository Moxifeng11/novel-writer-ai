/**
 * timeline-chain — 章节时间轴链式校验（2026-11-28，云笔 T 行设计落地）
 *
 * 背景：云笔要求时间写成 `纪年-年-月-日` 结构化值，并约束
 * ①非闪回章不得时间倒退 ②多章可同日 ③严禁每章 +1 天式机械推进。
 * 本仓此前 `TimelineEvent.time` 是自由文本（「黄昏/三日后」），无法校验。
 */
import { describe, expect, it } from 'vitest';
import {
    parseStructuredDate,
    dateSortKey,
    compareDates,
    dayDelta,
    validateTimelineChain,
    renderTimelineChainSummary,
    type ChapterTimeSpan,
} from '../../../shared/timeline-chain';

const d = (text: string) => parseStructuredDate(text)!;

describe('parseStructuredDate — 三种书写形态', () => {
    it('纪元-年-月-日', () => {
        expect(parseStructuredDate('公元-2-4-15')).toEqual({ era: '公元', year: 2, month: 4, day: 15 });
    });

    it('中文单位 纪元 2年4月15日', () => {
        expect(parseStructuredDate('天启 2年4月15日')).toEqual({ era: '天启', year: 2, month: 4, day: 15 });
    });

    it('无纪元的 2-4-15', () => {
        expect(parseStructuredDate('2-4-15')).toEqual({ era: '', year: 2, month: 4, day: 15 });
    });

    it('相对时间与自由文本返回 null（不瞎猜）', () => {
        expect(parseStructuredDate('三日后')).toBeNull();
        expect(parseStructuredDate('黄昏')).toBeNull();
        expect(parseStructuredDate('')).toBeNull();
    });

    it('非法月日返回 null', () => {
        expect(parseStructuredDate('公元-2-13-1')).toBeNull();
        expect(parseStructuredDate('公元-2-4-32')).toBeNull();
    });
});

describe('排序键与比较', () => {
    it('同年月日的排序键单调', () => {
        expect(dateSortKey(d('公元-2-4-15'))).toBe(20415);
        expect(dateSortKey(d('公元-2-4-16'))! > dateSortKey(d('公元-2-4-15'))!).toBe(true);
    });

    it('compareDates 同纪元可比、跨纪元返回 null', () => {
        expect(compareDates(d('公元-2-4-15'), d('公元-2-4-16'))).toBe(-1);
        expect(compareDates(d('公元-2-4-15'), d('公元-2-4-15'))).toBe(0);
        expect(compareDates(d('公元-2-4-15'), d('天启-2-4-16'))).toBeNull();
    });

    it('dayDelta 只算同月，跨月返回 null（不猜日历）', () => {
        expect(dayDelta(d('公元-2-4-15'), d('公元-2-4-16'))).toBe(1);
        expect(dayDelta(d('公元-2-4-15'), d('公元-2-5-1'))).toBeNull();
        expect(dayDelta(d('公元-2-4-15'), d('公元-3-4-16'))).toBeNull();
    });
});

describe('validateTimelineChain — 链式约束', () => {
    const span = (chapter: number, start: string, end: string, isFlashback = false): ChapterTimeSpan => ({
        chapter, start: d(start), end: d(end), isFlashback,
    });

    it('正常推进无问题', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-12'),
            span(2, '公元-2-4-12', '公元-2-4-13'),
        ]);
        expect(issues).toEqual([]);
    });

    it('同日多章合法（不得误报）', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-10'),
            span(2, '公元-2-4-10', '公元-2-4-10'),
            span(3, '公元-2-4-10', '公元-2-4-11'),
        ]);
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('非闪回章时间倒退 → error', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-20'),
            span(2, '公元-2-4-15', '公元-2-4-18'),
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ kind: 'backwards', chapter: 2, severity: 'error' });
    });

    it('闪回章可早于前章（不报倒退）', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-20'),
            span(2, '公元-2-2-1', '公元-2-2-3', true),
        ]);
        expect(issues).toEqual([]);
    });

    it('本章内部倒置 → error（闪回也要满足 start ≤ end）', () => {
        const issues = validateTimelineChain([span(1, '公元-2-4-20', '公元-2-4-10', true)]);
        expect(issues[0]).toMatchObject({ kind: 'reversed-span', severity: 'error' });
    });

    it('连续每章恰好 +1 天 → warning（机械推进）', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-11'),
            span(2, '公元-2-4-12', '公元-2-4-13'),
            span(3, '公元-2-4-14', '公元-2-4-15'),
            span(4, '公元-2-4-16', '公元-2-4-17'),
        ]);
        const mechanical = issues.filter((i) => i.kind === 'mechanical-advance');
        expect(mechanical).toHaveLength(1);
        expect(mechanical[0].severity).toBe('warning');
    });

    it('跨月推进不计入机械检测（无法确定天数）', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-28', '公元-2-5-1'),
            span(2, '公元-2-5-2', '公元-2-6-1'),
        ]);
        expect(issues.filter((i) => i.kind === 'mechanical-advance')).toEqual([]);
    });

    it('缺日期（null）不误报，也不建立基准', () => {
        const issues = validateTimelineChain([
            { chapter: 1, start: null, end: null },
            span(2, '公元-2-4-10', '公元-2-4-11'),
            span(3, '公元-2-4-9', '公元-2-4-12'),
        ]);
        expect(issues.some((i) => i.kind === 'backwards')).toBe(true);
    });

    it('错误排在告警之前', () => {
        const issues = validateTimelineChain([
            span(1, '公元-2-4-10', '公元-2-4-11'),
            span(2, '公元-2-4-12', '公元-2-4-13'),
            span(3, '公元-2-4-14', '公元-2-4-15'),
            span(4, '公元-2-4-16', '公元-2-4-17'),
            span(5, '公元-2-4-1', '公元-2-4-2'),
        ]);
        expect(issues[0].severity).toBe('error');
    });
});

describe('renderTimelineChainSummary', () => {
    it('无问题返回空串', () => {
        expect(renderTimelineChainSummary([])).toBe('');
    });

    it('有问题时给计数与条目', () => {
        const text = renderTimelineChainSummary([
            { kind: 'backwards', code: 'timeline.backwards', chapter: 2, severity: 'error', message: '第2章起始时间早于第1章结束' },
        ]);
        expect(text).toContain('1 项错误');
        expect(text).toContain('第2章');
    });
});
