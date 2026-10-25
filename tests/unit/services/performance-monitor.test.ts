import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceMonitor } from '../../../services/performance-monitor';

function freshMonitor(): PerformanceMonitor {
    const monitor = PerformanceMonitor.getInstance({
        enabled: true,
        maxLogEntries: 100,
        slowOperationThresholdMs: 100,
        enableMemoryTracking: false,
    });
    monitor.clearLog();
    (monitor as any).activeMarks.clear();
    return monitor;
}

describe('PerformanceMonitor（services 唯一实现）', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
        monitor = freshMonitor();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getInstance 返回单例', () => {
        expect(PerformanceMonitor.getInstance()).toBe(monitor);
    });

    it('start/end 记录耗时与统计', () => {
        const id = monitor.start('op-a', 'fileIO');
        const duration = monitor.end(id);

        expect(duration).not.toBeNull();
        expect(duration!).toBeGreaterThanOrEqual(0);
        expect(monitor.getStats('op-a', 'fileIO')!.count).toBe(1);
        expect(monitor.getLog(10)).toHaveLength(1);
    });

    it('禁用时 start/end/measure 均返回 null', () => {
        monitor.setEnabled(false);
        expect(monitor.start('op')).toBeNull();
        expect(monitor.end('any')).toBeNull();
        expect(monitor.measure('op', 'any')).toBeNull();
    });

    it('无效 markId 返回 null', () => {
        expect(monitor.end('missing')).toBeNull();
        expect(monitor.measure('op', 'missing')).toBeNull();
    });

    it('measure 会消费起始 mark，不泄漏 activeMarks', () => {
        const active = (monitor as any).activeMarks as Map<string, unknown>;

        for (let i = 0; i < 50; i++) {
            const startId = monitor.start('measured', 'apiCall');
            expect(active.size).toBe(1);
            expect(monitor.measure('measured-done', startId!, 'apiCall')).not.toBeNull();
            expect(active.size).toBe(0);
        }

        expect(monitor.getStats('measured-done', 'apiCall')!.count).toBe(50);
    });

    it('measure 后再次 end 同一 mark 不会重复计数', () => {
        const startId = monitor.start('dup-check', 'other');
        monitor.measure('dup-done', startId!, 'other');
        expect(monitor.end(startId)).toBeNull();
        expect(monitor.getStats('dup-done', 'other')!.count).toBe(1);
    });

    it('父 mark 结束时从 children 中摘除子 mark', () => {
        const parentId = monitor.start('parent', 'other');
        const parent = (monitor as any).activeMarks.get(parentId) as { children: string[] };
        const childId = monitor.start('child', 'other', parentId!);
        expect(parent.children).toContain(childId);

        monitor.end(childId);
        expect(parent.children).not.toContain(childId);

        monitor.end(parentId);
        expect((monitor as any).activeMarks.size).toBe(0);
    });

    it('wrap 与 wrapAsync 异常路径仍记录指标', async () => {
        expect(() => monitor.wrap('sync-error', () => { throw new Error('boom'); })).toThrow('boom');
        await expect(monitor.wrapAsync('async-error', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

        expect(monitor.getStats('sync-error')!.count).toBe(1);
        expect(monitor.getStats('async-error')!.count).toBe(1);
        expect(monitor.getLog(10).every(e => e.metadata?.error)).toBe(true);
    });

    it('慢操作按分类阈值识别', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        const id = monitor.start('slow-save', 'fileIO');
        now = 500;
        monitor.end(id);

        const slow = monitor.getSlowOperations();
        expect(slow).toHaveLength(1);
        expect(slow[0].name).toBe('slow-save');
        expect(slow[0].threshold).toBe(200);
    });

    it('日志条目不超过 maxLogEntries', () => {
        for (let i = 0; i < 150; i++) {
            monitor.end(monitor.start(`op-${i}`));
        }
        expect(monitor.getLog().length).toBeLessThanOrEqual(100);
    });

    it('statsByOperation 的 key 数量有上限', () => {
        for (let i = 0; i < 520; i++) {
            monitor.end(monitor.start(`unique-op-${i}`));
        }
        const statsMap = (monitor as any).statsByOperation as Map<string, unknown>;
        expect(statsMap.size).toBeLessThanOrEqual(500);
        expect(monitor.getStats('unique-op-519')).not.toBeNull();
        expect(monitor.getStats('unique-op-0')).toBeNull();
    });
});
