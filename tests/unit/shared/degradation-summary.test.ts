/**
 * 降级事件摘要（阶段 B1「可统计」）
 *
 * 长期目标阶段 B：降级必须可统计、可展示。
 *
 * 事件数组只能回答「发生过什么」，摘要回答「**哪类降级最多、最近一条是什么、
 * 其中多少是可恢复的**」——这才是界面与排查需要的。
 */

import { describe, expect, it } from 'vitest';
import {
    summarizeDegradations,
    filterDegradationsBySource,
    type DegradationEvent,
} from '../../../shared/degradation-notifier';

/** 构造事件 */
function event(partial: Partial<DegradationEvent> = {}): DegradationEvent {
    return {
        source: partial.source ?? 'vector',
        dimension: partial.dimension,
        from: partial.from ?? 'vector',
        to: partial.to ?? 'keyword',
        reason: partial.reason ?? '原因',
        severity: partial.severity ?? 'warning',
        recoverable: partial.recoverable ?? false,
        timestamp: partial.timestamp ?? 1,
    };
}

describe('summarizeDegradations', () => {
    it('空事件返回全零摘要且无 latest', () => {
        const summary = summarizeDegradations([]);
        expect(summary.total).toBe(0);
        expect(summary.latest).toBeUndefined();
        expect(summary.bySource.vector).toBe(0);
        expect(summary.bySeverity.warning).toBe(0);
    });

    it('按来源与严重程度计数', () => {
        const summary = summarizeDegradations([
            event({ source: 'vector', severity: 'warning' }),
            event({ source: 'vector', severity: 'critical' }),
            event({ source: 'injection', severity: 'info' }),
        ]);
        expect(summary.total).toBe(3);
        expect(summary.bySource.vector).toBe(2);
        expect(summary.bySource.injection).toBe(1);
        expect(summary.bySeverity.warning).toBe(1);
        expect(summary.bySeverity.critical).toBe(1);
        expect(summary.bySeverity.info).toBe(1);
    });

    it('统计可恢复事件数（用户能重试修复的那部分）', () => {
        const summary = summarizeDegradations([
            event({ recoverable: true }),
            event({ recoverable: false }),
            event({ recoverable: true }),
        ]);
        expect(summary.recoverable).toBe(2);
    });

    it('latest 取时间戳最大的一条（不依赖数组顺序）', () => {
        const summary = summarizeDegradations([
            event({ reason: '较晚', timestamp: 300 }),
            event({ reason: '最早', timestamp: 100 }),
            event({ reason: '中间', timestamp: 200 }),
        ]);
        expect(summary.latest?.reason).toBe('较晚');
    });

    it('未知来源不会让计数变成 NaN', () => {
        // 运行时可能来自旧版本/外部注入的 source，计数要能兜住
        const summary = summarizeDegradations([
            event({ source: 'unknown-source' as never }),
        ]);
        expect(summary.total).toBe(1);
        expect(Number.isNaN(summary.bySource.vector)).toBe(false);
    });
});

describe('filterDegradationsBySource', () => {
    it('只保留关心的来源', () => {
        const events = [
            event({ source: 'vector', reason: 'a' }),
            event({ source: 'llm', reason: 'b' }),
            event({ source: 'worker', reason: 'c' }),
        ];
        const filtered = filterDegradationsBySource(events, ['vector', 'worker']);
        expect(filtered.map(e => e.reason)).toEqual(['a', 'c']);
    });

    it('空来源列表返回空（不误报为「全部」）', () => {
        expect(filterDegradationsBySource([event()], [])).toEqual([]);
    });

    it('没有匹配来源时返回空', () => {
        expect(filterDegradationsBySource([event({ source: 'llm' })], ['vector'])).toEqual([]);
    });
});
