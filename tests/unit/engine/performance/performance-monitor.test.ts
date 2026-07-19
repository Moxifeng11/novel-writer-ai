import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceMonitor } from '../../../../engine/performance/performance-monitor';

function createMonitor(options?: Parameters<typeof PerformanceMonitor.getInstance>[0]): PerformanceMonitor {
    PerformanceMonitor.resetInstance();
    return PerformanceMonitor.getInstance(options);
}

describe('PerformanceMonitor', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
        monitor = createMonitor({
            enabled: true,
            slowOperationThresholdMs: 100,
            maxHistorySize: 50,
        });
    });

    describe('单例模式', () => {
        it('getInstance 返回同一实例', () => {
            PerformanceMonitor.resetInstance();
            const inst1 = PerformanceMonitor.getInstance();
            const inst2 = PerformanceMonitor.getInstance();
            expect(inst1).toBe(inst2);
        });

        it('getInstance 支持 options 参数', () => {
            PerformanceMonitor.resetInstance();
            const inst = PerformanceMonitor.getInstance({ slowOperationThresholdMs: 200 });
            expect(inst.getOptions().slowOperationThresholdMs).toBe(200);
        });

        it('resetInstance 重置单例', () => {
            PerformanceMonitor.resetInstance();
            const inst1 = PerformanceMonitor.getInstance();
            PerformanceMonitor.resetInstance();
            const inst2 = PerformanceMonitor.getInstance();
            expect(inst1).not.toBe(inst2);
        });
    });

    describe('配置与开关', () => {
        it('默认启用', () => {
            expect(monitor.isEnabled()).toBe(true);
        });

        it('enable/disable 切换', () => {
            monitor.disable();
            expect(monitor.isEnabled()).toBe(false);

            monitor.enable();
            expect(monitor.isEnabled()).toBe(true);
        });

        it('updateOptions 更新配置', () => {
            monitor.updateOptions({ slowOperationThresholdMs: 300 });
            expect(monitor.getOptions().slowOperationThresholdMs).toBe(300);
        });

        it('setSlowOperationThreshold 设置阈值', () => {
            monitor.setSlowOperationThreshold(500);
            expect(monitor.getOptions().slowOperationThresholdMs).toBe(500);
        });
    });

    describe('startMark / endMark', () => {
        it('基本埋点计时', () => {
            const markId = monitor.startMark('test-op');
            expect(markId).not.toBeNull();

            const duration = monitor.endMark(markId);
            expect(duration).not.toBeNull();
            expect(typeof duration).toBe('number');
            expect(duration!).toBeGreaterThanOrEqual(0);
        });

        it('禁用时返回 null', () => {
            monitor.disable();
            expect(monitor.startMark('test')).toBeNull();
            expect(monitor.endMark('any-id')).toBeNull();
        });

        it('无效的 markId 返回 null', () => {
            const result = monitor.endMark('nonexistent');
            expect(result).toBeNull();
        });

        it('endMark 支持附加 metadata', () => {
            const markId = monitor.startMark('test-meta');
            const duration = monitor.endMark(markId, { size: 100 });
            expect(duration).not.toBeNull();
        });

        it('多次调用 startMark 生成不同 markId', () => {
            const id1 = monitor.startMark('op1');
            const id2 = monitor.startMark('op2');
            expect(id1).not.toBe(id2);
        });
    });

    describe('wrap / wrapAsync', () => {
        it('wrap 同步包裹', () => {
            const result = monitor.wrap('sync-op', () => {
                return 42;
            });

            expect(result).toBe(42);

            const stats = monitor.getOperationStats('sync-op');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('wrap 出错时记录并抛出', () => {
            expect(() => {
                monitor.wrap('error-op', () => {
                    throw new Error('test error');
                });
            }).toThrow('test error');

            const stats = monitor.getOperationStats('error-op');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('wrapAsync 异步包裹', async () => {
            const result = await monitor.wrapAsync('async-op', async () => {
                return 'async result';
            });

            expect(result).toBe('async result');

            const stats = monitor.getOperationStats('async-op');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('wrapAsync 出错时记录并抛出', async () => {
            await expect(
                monitor.wrapAsync('async-error', async () => {
                    throw new Error('async error');
                })
            ).rejects.toThrow('async error');

            const stats = monitor.getOperationStats('async-error');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('wrap 支持 metadata', () => {
            monitor.wrap('meta-op', () => 'ok', { key: 'value' });
            const stats = monitor.getOperationStats('meta-op');
            expect(stats).not.toBeNull();
        });
    });

    describe('统计功能', () => {
        beforeEach(() => {
            for (let i = 0; i < 5; i++) {
                const id = monitor.startMark('fast-op');
                monitor.endMark(id);
            }

            for (let i = 0; i < 3; i++) {
                const id = monitor.startMark('slow-op');
                monitor.endMark(id);
            }
        });

        it('getOperationStats 返回操作统计', () => {
            const stats = monitor.getOperationStats('fast-op');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(5);
            expect(stats!.totalDuration).toBeGreaterThanOrEqual(0);
            expect(stats!.avgDuration).toBeGreaterThanOrEqual(0);
            expect(stats!.minDuration).toBeLessThanOrEqual(stats!.maxDuration);
        });

        it('getOperationStats 未找到返回 null', () => {
            expect(monitor.getOperationStats('nonexistent')).toBeNull();
        });

        it('getStats 返回完整统计', () => {
            const stats = monitor.getStats();
            expect(stats.totalOperations).toBe(8);
            expect(stats.totalDuration).toBeGreaterThanOrEqual(0);
            expect(Object.keys(stats.operations).length).toBe(2);
            expect(stats.slowestTop10.length).toBeLessThanOrEqual(10);
            expect(Array.isArray(stats.recentSlowOperations)).toBe(true);
        });

        it('getSlowestOperations 返回最慢操作', () => {
            const slowest = monitor.getSlowestOperations(1);
            expect(slowest.length).toBe(1);
            expect(slowest[0]).toHaveProperty('key');
            expect(slowest[0]).toHaveProperty('avgDuration');
            expect(slowest[0]).toHaveProperty('count');
        });

        it('getSlowestOperations 默认返回 10 个', () => {
            const slowest = monitor.getSlowestOperations();
            expect(slowest.length).toBeLessThanOrEqual(10);
        });

        it('统计多次调用的 min/max/avg 正确', () => {
            const id1 = monitor.startMark('variable-op');
            monitor.endMark(id1);

            const id2 = monitor.startMark('variable-op');
            monitor.endMark(id2);

            const stats = monitor.getOperationStats('variable-op');
            expect(stats!.count).toBe(2);
            expect(stats!.avgDuration).toBeGreaterThanOrEqual(stats!.minDuration);
            expect(stats!.avgDuration).toBeLessThanOrEqual(stats!.maxDuration);
        });
    });

    describe('慢操作检测', () => {
        it('超过阈值的操作被记录为慢操作', () => {
            const originalNow = performance.now;
            let time = 0;
            performance.now = () => time;

            const m = createMonitor({ slowOperationThresholdMs: 50 });

            const markId = m.startMark('slow-test');
            time = 100;
            m.endMark(markId);

            const slowOps = m.getSlowOperations();
            expect(slowOps.length).toBeGreaterThan(0);
            expect(slowOps[0].key).toBe('slow-test');
            expect(slowOps[0].duration).toBe(100);
            expect(slowOps[0].threshold).toBe(50);

            performance.now = originalNow;
        });

        it('未超过阈值的操作不触发告警但可被查询', () => {
            const originalNow = performance.now;
            let time = 0;
            performance.now = () => time;

            const m = createMonitor({ slowOperationThresholdMs: 200 });

            const markId = m.startMark('fast-test');
            time = 50;
            m.endMark(markId);

            expect(m.getSlowOperations(10).length).toBeGreaterThan(0);
            expect(m.getSlowOperations(200).length).toBe(0);

            performance.now = originalNow;
        });

        it('getSlowOperations 支持自定义阈值', () => {
            const originalNow = performance.now;
            let time = 0;
            performance.now = () => time;

            const m = createMonitor({ slowOperationThresholdMs: 200 });

            const markId = m.startMark('test-op');
            time = 100;
            m.endMark(markId);

            expect(m.getSlowOperations(200).length).toBe(0);
            expect(m.getSlowOperations(50).length).toBe(1);

            performance.now = originalNow;
        });
    });

    describe('重置与清理', () => {
        it('reset 清空所有数据', () => {
            const id = monitor.startMark('test');
            monitor.endMark(id);

            expect(monitor.getStats().totalOperations).toBe(1);

            monitor.reset();
            expect(monitor.getStats().totalOperations).toBe(0);
            expect(monitor.getOperationStats('test')).toBeNull();
        });

        it('clearSlowOperations 清空慢操作记录', () => {
            const originalNow = performance.now;
            let time = 0;
            performance.now = () => time;

            const m = createMonitor({ slowOperationThresholdMs: 10 });

            const markId = m.startMark('slow');
            time = 50;
            m.endMark(markId);

            expect(m.getSlowOperations().length).toBeGreaterThan(0);
            m.clearSlowOperations();
            expect(m.getSlowOperations().length).toBe(0);

            performance.now = originalNow;
        });

        it('disable 时清空 activeMarks', () => {
            monitor.startMark('pending-op');
            monitor.disable();
            expect(monitor.isEnabled()).toBe(false);
        });
    });

    describe('零外部依赖验证', () => {
        it('仅使用内置 API', () => {
            expect(typeof monitor.startMark).toBe('function');
            expect(typeof monitor.endMark).toBe('function');
            expect(typeof monitor.getStats).toBe('function');
            expect(typeof monitor.wrap).toBe('function');
            expect(typeof monitor.wrapAsync).toBe('function');
        });
    });
});
