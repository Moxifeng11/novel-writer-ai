/**
 * 阶段 D1：性能指标格式化与聚合
 *
 * 从 `ui/settings/general-sections.ts` 的 `PerformanceSection` 抽出。
 * `< 1024` / `< 1e6` 这类边界与单位换算是易错点，此前内联在 1100 行的设置页里零测试。
 *
 * 注意与 `kb-format.formatDuration` 的区别：那个是「阅读时长」中文长格式（2小时5分），
 * 本模块是「性能面板」技术格式（2.05s）——语义不同，不能合并。
 */

import { describe, expect, it } from 'vitest';
import {
    aggregateOperationStats,
    formatByteSize,
    formatHitRate,
    formatPerfDuration,
} from '../../../ui/metrics-format';

describe('D1-9：性能耗时格式化', () => {
    it('微秒档（< 1ms）', () => {
        expect(formatPerfDuration(0.5)).toBe('500.00μs');
        expect(formatPerfDuration(0)).toBe('0.00μs');
    });

    it('毫秒档（1ms – 1s）', () => {
        expect(formatPerfDuration(1)).toBe('1.00ms');
        expect(formatPerfDuration(999)).toBe('999.00ms');
    });

    it('秒档（1s – 1min）', () => {
        expect(formatPerfDuration(1000)).toBe('1.00s');
        expect(formatPerfDuration(59999)).toBe('60.00s');
    });

    it('分钟档（>= 1min）', () => {
        expect(formatPerfDuration(60000)).toBe('1.00min');
        expect(formatPerfDuration(120000)).toBe('2.00min');
    });

    it('边界值不串档（1 / 1000 / 60000）', () => {
        expect(formatPerfDuration(0.999)).toContain('μs');
        expect(formatPerfDuration(1)).toContain('ms');
        expect(formatPerfDuration(999.9)).toContain('ms');
        expect(formatPerfDuration(1000)).toContain('s');
        expect(formatPerfDuration(60000)).toContain('min');
    });

    it('非法值兜底为 0ms（不显示 NaN）', () => {
        expect(formatPerfDuration(NaN)).toBe('0ms');
        expect(formatPerfDuration(Infinity)).toBe('0ms');
    });
});

describe('D1-10：字节格式化', () => {
    it('B 档（< 1024）', () => {
        expect(formatByteSize(0)).toBe('0 B');
        expect(formatByteSize(1023)).toBe('1023 B');
    });

    it('KB 档（1024 – 1MB）', () => {
        expect(formatByteSize(1024)).toBe('1.00 KB');
        expect(formatByteSize(1536)).toBe('1.50 KB');
    });

    it('MB 档', () => {
        expect(formatByteSize(1024 * 1024)).toBe('1.00 MB');
        expect(formatByteSize(1024 * 1024 * 1.5)).toBe('1.50 MB');
    });

    it('GB 档', () => {
        expect(formatByteSize(1024 * 1024 * 1024)).toBe('1.00 GB');
        expect(formatByteSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
    });

    it('非法值兜底为 0 B', () => {
        expect(formatByteSize(NaN)).toBe('0 B');
        expect(formatByteSize(Infinity)).toBe('0 B');
    });
});

describe('D1-11：操作统计聚合', () => {
    it('累加各类操作的次数与耗时', () => {
        const totals = aggregateOperationStats({
            render: { count: 3, totalDuration: 300 },
            save: { count: 2, totalDuration: 200 },
        });
        expect(totals.totalOps).toBe(5);
        expect(totals.totalDuration).toBe(500);
        expect(totals.avgDuration).toBe(100);
    });

    it('空统计返回全零（平均不产生 NaN）', () => {
        const totals = aggregateOperationStats({});
        expect(totals.totalOps).toBe(0);
        expect(totals.totalDuration).toBe(0);
        expect(totals.avgDuration).toBe(0);
    });

    it('null/undefined 输入不抛错', () => {
        expect(aggregateOperationStats(null).totalOps).toBe(0);
        expect(aggregateOperationStats(undefined).avgDuration).toBe(0);
    });

    it('缺字段的条目被跳过而不是产生 NaN', () => {
        const totals = aggregateOperationStats({
            good: { count: 2, totalDuration: 100 },
            broken: {} as never,
        });
        expect(totals.totalOps).toBe(2);
        expect(totals.totalDuration).toBe(100);
        expect(Number.isNaN(totals.avgDuration)).toBe(false);
    });
});

describe('D1-12：缓存命中率格式化', () => {
    it('正常百分比（保留 1 位小数）', () => {
        expect(formatHitRate(0.85)).toBe('85.0%');
        expect(formatHitRate(0)).toBe('0.0%');
        expect(formatHitRate(1)).toBe('100.0%');
    });

    it('非法值返回 N/A（不显示 NaN%）', () => {
        expect(formatHitRate(NaN)).toBe('N/A');
        expect(formatHitRate(undefined)).toBe('N/A');
    });
});
