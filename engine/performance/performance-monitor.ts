import { createLogger } from '../../shared/logger';

const log = createLogger('PerformanceMonitor');
/**
 * performance/performance-monitor.ts — Engine 层性能监控
 *
 * 轻量级性能监控，专为 engine 层设计：
 * - startMark/endMark - 性能埋点
 * - 统计：平均耗时、调用次数、最慢 Top 10
 * - 慢操作阈值告警
 * - 零外部依赖
 * - 可随时开关
 *
 * 与 services/performance-monitor.ts 的区别：
 * - 更轻量，仅 engine 层核心功能
 * - 不依赖 shared/logger
 * - API 更简洁
 */

// ============================================================
// 一、类型定义
// ============================================================

export interface PerformanceMonitorOptions {
    enabled?: boolean;
    slowOperationThresholdMs?: number;
    maxHistorySize?: number;
}

export interface PerformanceMark {
    key: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata?: Record<string, any>;
}

export interface OperationStats {
    key: string;
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
}

export interface SlowOperation {
    key: string;
    duration: number;
    threshold: number;
    timestamp: number;
}

export interface PerformanceStats {
    totalOperations: number;
    totalDuration: number;
    avgDuration: number;
    operations: Record<string, OperationStats>;
    slowestTop10: Array<{ key: string; avgDuration: number; count: number }>;
    recentSlowOperations: SlowOperation[];
}

const DEFAULT_OPTIONS: Required<PerformanceMonitorOptions> = {
    enabled: true,
    slowOperationThresholdMs: 500,
    maxHistorySize: 1000,
};

// ============================================================
// 二、PerformanceMonitor 单例类
// ============================================================

export class PerformanceMonitor {
    private static instance: PerformanceMonitor | null = null;

    private options: Required<PerformanceMonitorOptions>;
    private activeMarks: Map<string, PerformanceMark> = new Map();
    private operationStats: Map<string, OperationStats> = new Map();
    private slowOperations: SlowOperation[] = [];
    private markCounter = 0;

    private constructor(options?: PerformanceMonitorOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    static getInstance(options?: PerformanceMonitorOptions): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor(options);
        } else if (options) {
            PerformanceMonitor.instance.updateOptions(options);
        }
        return PerformanceMonitor.instance;
    }

    static resetInstance(): void {
        PerformanceMonitor.instance = null;
    }

    // ============================================================
    // 配置
    // ============================================================

    updateOptions(options: Partial<PerformanceMonitorOptions>): void {
        this.options = { ...this.options, ...options };
    }

    getOptions(): PerformanceMonitorOptions {
        return { ...this.options };
    }

    enable(): void {
        this.options.enabled = true;
    }

    disable(): void {
        this.options.enabled = false;
        this.activeMarks.clear();
    }

    isEnabled(): boolean {
        return this.options.enabled;
    }

    setSlowOperationThreshold(thresholdMs: number): void {
        this.options.slowOperationThresholdMs = thresholdMs;
    }

    // ============================================================
    // 埋点 API
    // ============================================================

    /**
     * 开始性能埋点
     * @param key 操作标识
     * @param metadata 附加元数据
     * @returns mark ID
     */
    startMark(key: string, metadata?: Record<string, any>): string | null {
        if (!this.options.enabled) return null;

        const markId = `mark-${++this.markCounter}`;
        const mark: PerformanceMark = {
            key,
            startTime: this.now(),
            metadata,
        };

        this.activeMarks.set(markId, mark);
        return markId;
    }

    /**
     * 结束性能埋点
     * @param markId 埋点 ID
     * @param metadata 附加元数据
     * @returns 耗时（毫秒），未启用或未找到返回 null
     */
    endMark(markId: string | null, metadata?: Record<string, any>): number | null {
        if (!markId || !this.options.enabled) return null;

        const mark = this.activeMarks.get(markId);
        if (!mark) {
            log.warn(`[PerformanceMonitor] Mark not found: ${markId}`);
            return null;
        }

        mark.endTime = this.now();
        mark.duration = mark.endTime - mark.startTime;

        if (metadata) {
            mark.metadata = { ...mark.metadata, ...metadata };
        }

        this.updateStats(mark);
        this.checkSlowOperation(mark);

        this.activeMarks.delete(markId);

        return mark.duration;
    }

    /**
     * 同步包裹函数执行
     */
    wrap<T>(key: string, fn: () => T, metadata?: Record<string, any>): T {
        const markId = this.startMark(key, metadata);
        try {
            const result = fn();
            this.endMark(markId);
            return result;
        } catch (e) {
            this.endMark(markId, { error: String(e) });
            throw e;
        }
    }

    /**
     * 异步包裹函数执行
     */
    async wrapAsync<T>(key: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
        const markId = this.startMark(key, metadata);
        try {
            const result = await fn();
            this.endMark(markId);
            return result;
        } catch (e) {
            this.endMark(markId, { error: String(e) });
            throw e;
        }
    }

    // ============================================================
    // 统计查询
    // ============================================================

    /**
     * 获取指定操作的统计
     */
    getOperationStats(key: string): OperationStats | null {
        return this.operationStats.get(key) || null;
    }

    /**
     * 获取完整性能统计
     */
    getStats(): PerformanceStats {
        const operations: Record<string, OperationStats> = {};
        let totalOperations = 0;
        let totalDuration = 0;

        for (const [key, stats] of this.operationStats) {
            operations[key] = { ...stats };
            totalOperations += stats.count;
            totalDuration += stats.totalDuration;
        }

        const slowestTop10 = Object.values(operations)
            .sort((a, b) => b.avgDuration - a.avgDuration)
            .slice(0, 10)
            .map(s => ({ key: s.key, avgDuration: s.avgDuration, count: s.count }));

        return {
            totalOperations,
            totalDuration,
            avgDuration: totalOperations > 0 ? totalDuration / totalOperations : 0,
            operations,
            slowestTop10,
            recentSlowOperations: [...this.slowOperations].reverse().slice(0, 20),
        };
    }

    /**
     * 获取最慢的操作列表
     */
    getSlowestOperations(limit: number = 10): Array<{ key: string; avgDuration: number; count: number }> {
        return Array.from(this.operationStats.values())
            .sort((a, b) => b.avgDuration - a.avgDuration)
            .slice(0, limit)
            .map(s => ({ key: s.key, avgDuration: s.avgDuration, count: s.count }));
    }

    /**
     * 获取慢操作历史
     */
    getSlowOperations(threshold?: number): SlowOperation[] {
        const t = threshold ?? this.options.slowOperationThresholdMs;
        return this.slowOperations.filter(op => op.duration > t);
    }

    // ============================================================
    // 重置与清理
    // ============================================================

    reset(): void {
        this.activeMarks.clear();
        this.operationStats.clear();
        this.slowOperations = [];
        this.markCounter = 0;
    }

    clearSlowOperations(): void {
        this.slowOperations = [];
    }

    // ============================================================
    // 内部方法
    // ============================================================

    private now(): number {
        if (typeof performance !== 'undefined' && performance.now) {
            return performance.now();
        }
        return Date.now();
    }

    private updateStats(mark: PerformanceMark): void {
        if (mark.duration === undefined) return;

        const existing = this.operationStats.get(mark.key);

        if (!existing) {
            this.operationStats.set(mark.key, {
                key: mark.key,
                count: 1,
                totalDuration: mark.duration,
                avgDuration: mark.duration,
                minDuration: mark.duration,
                maxDuration: mark.duration,
            });
        } else {
            const count = existing.count + 1;
            const totalDuration = existing.totalDuration + mark.duration;
            existing.count = count;
            existing.totalDuration = totalDuration;
            existing.avgDuration = totalDuration / count;
            if (mark.duration < existing.minDuration) {
                existing.minDuration = mark.duration;
            }
            if (mark.duration > existing.maxDuration) {
                existing.maxDuration = mark.duration;
            }
        }
    }

    private checkSlowOperation(mark: PerformanceMark): void {
        if (mark.duration === undefined) return;

        const operationRecord: SlowOperation = {
            key: mark.key,
            duration: mark.duration,
            threshold: this.options.slowOperationThresholdMs,
            timestamp: Date.now(),
        };

        this.slowOperations.push(operationRecord);

        if (this.slowOperations.length > this.options.maxHistorySize) {
            this.slowOperations.shift();
        }

        if (mark.duration > this.options.slowOperationThresholdMs) {
            log.warn(
                `[PerformanceMonitor] Slow operation detected: ${mark.key} ` +
                `(${mark.duration.toFixed(2)}ms > ${this.options.slowOperationThresholdMs}ms)`
            );
        }
    }
}

export const performanceMonitor = PerformanceMonitor.getInstance();
