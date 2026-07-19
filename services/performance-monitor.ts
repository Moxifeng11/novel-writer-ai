/**
 * performance-monitor.ts — 性能监控服务
 *
 * 轻量级性能监控框架，开销 < 1%：
 * - 打点计时（开始/结束/耗时）
 * - 分层监控（总耗时/阶段耗时/子任务耗时）
 * - 性能指标收集（内存使用/异步操作等待时间）
 * - 性能日志持久化（最近 1000 条）
 * - 性能统计与分析（平均/最大/最小耗时、慢操作识别、趋势分析）
 * - 性能报告生成（文本格式）
 *
 * 用法：
 *   const perf = PerformanceMonitor.getInstance();
 *   const timer = perf.start('chapterGeneration');
 *   // ... do work ...
 *   perf.end(timer);
 */

import { createLogger } from '../shared/logger';

const log = createLogger('PerformanceMonitor');

export interface PerformanceMark {
    id: string;
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    parentId?: string;
    children: string[];
    metadata?: Record<string, unknown>;
    memoryStart?: number;
    memoryEnd?: number;
    memoryDelta?: number;
    timestamp: number;
    category?: PerformanceCategory;
}

export type PerformanceCategory =
    | 'projectLoad'
    | 'chapterGeneration'
    | 'knowledgeDeconstruction'
    | 'vectorCalculation'
    | 'viewRender'
    | 'cacheRead'
    | 'cacheWrite'
    | 'apiCall'
    | 'fileIO'
    | 'other';

export interface PerformanceLogEntry {
    id: string;
    name: string;
    duration: number;
    timestamp: number;
    category: PerformanceCategory;
    memoryDelta?: number;
    metadata?: Record<string, unknown>;
    parentName?: string;
}

export interface PerformanceStats {
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p50: number;
    p95: number;
    p99: number;
}

export interface SlowOperation {
    name: string;
    duration: number;
    timestamp: number;
    category: PerformanceCategory;
    threshold: number;
}

export interface PerformanceReport {
    generatedAt: number;
    timeRange: { start: number; end: number };
    totalOperations: number;
    totalDuration: number;
    categoryBreakdown: Record<PerformanceCategory, { count: number; totalDuration: number; avgDuration: number }>;
    topSlowest: Array<{ name: string; avgDuration: number; count: number }>;
    slowOperations: SlowOperation[];
    statsByOperation: Record<string, PerformanceStats>;
    memoryUsage: {
        current?: number;
        peak?: number;
        avgDelta?: number;
    };
    cacheStats?: {
        hitRate: number;
        totalEntries: number;
        totalSize: number;
    };
}

export interface PerformanceMonitorOptions {
    enabled: boolean;
    maxLogEntries: number;
    slowOperationThresholdMs: number;
    enableMemoryTracking: boolean;
}

const DEFAULT_OPTIONS: PerformanceMonitorOptions = {
    enabled: true,
    maxLogEntries: 1000,
    slowOperationThresholdMs: 1000,
    enableMemoryTracking: true,
};

const CATEGORY_THRESHOLDS: Partial<Record<PerformanceCategory, number>> = {
    apiCall: 3000,
    vectorCalculation: 2000,
    chapterGeneration: 5000,
    knowledgeDeconstruction: 3000,
    viewRender: 500,
    cacheRead: 50,
    cacheWrite: 100,
    fileIO: 200,
};

let markIdCounter = 0;
const generateMarkId = (): string => `perf-${Date.now()}-${++markIdCounter}`;

export class PerformanceMonitor {
    private static instance: PerformanceMonitor | null = null;
    private options: PerformanceMonitorOptions;
    private activeMarks: Map<string, PerformanceMark> = new Map();
    private log: PerformanceLogEntry[] = [];
    private statsByOperation: Map<string, { durations: number[]; total: number; count: number; min: number; max: number }> = new Map();
    private peakMemory: number = 0;
    private memorySamples: number[] = [];

    private constructor(options?: Partial<PerformanceMonitorOptions>) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    static getInstance(options?: Partial<PerformanceMonitorOptions>): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor(options);
        } else if (options) {
            PerformanceMonitor.instance.updateOptions(options);
        }
        return PerformanceMonitor.instance;
    }

    updateOptions(options: Partial<PerformanceMonitorOptions>): void {
        this.options = { ...this.options, ...options };
    }

    getOptions(): PerformanceMonitorOptions {
        return { ...this.options };
    }

    setEnabled(enabled: boolean): void {
        this.options.enabled = enabled;
        if (!enabled) {
            this.activeMarks.clear();
        }
    }

    isEnabled(): boolean {
        return this.options.enabled;
    }

    start(name: string, category: PerformanceCategory = 'other', parentId?: string, metadata?: Record<string, unknown>): string | null {
        if (!this.options.enabled) return null;

        const id = generateMarkId();
        const mark: PerformanceMark = {
            id,
            name,
            startTime: performance.now(),
            children: [],
            metadata,
            timestamp: Date.now(),
            category,
            parentId,
        };

        if (this.options.enableMemoryTracking) {
            mark.memoryStart = this.getCurrentMemory();
        }

        this.activeMarks.set(id, mark);

        if (parentId) {
            const parent = this.activeMarks.get(parentId);
            if (parent) {
                parent.children.push(id);
            }
        }

        return id;
    }

    end(markId: string | null, metadata?: Record<string, unknown>): number | null {
        if (!markId || !this.options.enabled) return null;

        const mark = this.activeMarks.get(markId);
        if (!mark) {
            log.warn(`Mark not found: ${markId}`);
            return null;
        }

        mark.endTime = performance.now();
        mark.duration = mark.endTime - mark.startTime;

        if (this.options.enableMemoryTracking) {
            mark.memoryEnd = this.getCurrentMemory();
            if (mark.memoryStart !== undefined && mark.memoryEnd !== undefined) {
                mark.memoryDelta = mark.memoryEnd - mark.memoryStart;
            }
            if (mark.memoryEnd && mark.memoryEnd > this.peakMemory) {
                this.peakMemory = mark.memoryEnd;
            }
            if (mark.memoryEnd !== undefined) {
                this.memorySamples.push(mark.memoryEnd);
                if (this.memorySamples.length > 100) {
                    this.memorySamples.shift();
                }
            }
        }

        if (metadata) {
            mark.metadata = { ...mark.metadata, ...metadata };
        }

        this.addToLog(mark);
        this.updateStats(mark);

        this.activeMarks.delete(markId);

        return mark.duration;
    }

    wrap<T>(name: string, fn: () => T, category: PerformanceCategory = 'other', metadata?: Record<string, unknown>): T {
        const markId = this.start(name, category, undefined, metadata);
        try {
            const result = fn();
            this.end(markId);
            return result;
        } catch (e) {
            this.end(markId, { error: String(e) });
            throw e;
        }
    }

    async wrapAsync<T>(name: string, fn: () => Promise<T>, category: PerformanceCategory = 'other', metadata?: Record<string, unknown>): Promise<T> {
        const markId = this.start(name, category, undefined, metadata);
        try {
            const result = await fn();
            this.end(markId);
            return result;
        } catch (e) {
            this.end(markId, { error: String(e) });
            throw e;
        }
    }

    measure(name: string, startMarkId: string, category: PerformanceCategory = 'other', metadata?: Record<string, unknown>): number | null {
        if (!this.options.enabled) return null;

        const startMark = this.activeMarks.get(startMarkId);
        if (!startMark) {
            log.warn(`Start mark not found: ${startMarkId}`);
            return null;
        }

        const endTime = performance.now();
        const duration = endTime - startMark.startTime;

        const mark: PerformanceMark = {
            id: generateMarkId(),
            name,
            startTime: startMark.startTime,
            endTime,
            duration,
            children: [],
            metadata,
            timestamp: Date.now(),
            category,
        };

        this.addToLog(mark);
        this.updateStats(mark);

        return duration;
    }

    private addToLog(mark: PerformanceMark): void {
        if (mark.duration === undefined) return;

        const parentName = mark.parentId
            ? this.activeMarks.get(mark.parentId)?.name
            : undefined;

        const entry: PerformanceLogEntry = {
            id: mark.id,
            name: mark.name,
            duration: mark.duration,
            timestamp: mark.timestamp,
            category: mark.category || 'other',
            memoryDelta: mark.memoryDelta,
            metadata: mark.metadata,
            parentName,
        };

        this.log.push(entry);

        if (this.log.length > this.options.maxLogEntries) {
            this.log.shift();
        }
    }

    private updateStats(mark: PerformanceMark): void {
        if (mark.duration === undefined) return;

        const key = `${mark.category || 'other'}:${mark.name}`;
        let stats = this.statsByOperation.get(key);

        if (!stats) {
            stats = { durations: [], total: 0, count: 0, min: Infinity, max: -Infinity };
            this.statsByOperation.set(key, stats);
        }

        stats.durations.push(mark.duration);
        stats.total += mark.duration;
        stats.count++;
        if (mark.duration < stats.min) stats.min = mark.duration;
        if (mark.duration > stats.max) stats.max = mark.duration;

        if (stats.durations.length > 500) {
            stats.durations.shift();
        }
    }

    private getCurrentMemory(): number | undefined {
        if (typeof performance !== 'undefined' && 'memory' in performance) {
            return (performance as any).memory.usedJSHeapSize;
        }
        return undefined;
    }

    getLog(limit?: number, category?: PerformanceCategory): PerformanceLogEntry[] {
        let entries = [...this.log];
        if (category) {
            entries = entries.filter(e => e.category === category);
        }
        if (limit) {
            entries = entries.slice(-limit);
        }
        return entries.reverse();
    }

    getStats(operationName: string, category?: PerformanceCategory): PerformanceStats | null {
        const key = category ? `${category}:${operationName}` : operationName;
        const stats = this.statsByOperation.get(key);

        if (!stats || stats.count === 0) return null;

        const sorted = [...stats.durations].sort((a, b) => a - b);
        const p50 = this.percentile(sorted, 50);
        const p95 = this.percentile(sorted, 95);
        const p99 = this.percentile(sorted, 99);

        return {
            count: stats.count,
            totalDuration: stats.total,
            avgDuration: stats.total / stats.count,
            minDuration: stats.min,
            maxDuration: stats.max,
            p50,
            p95,
            p99,
        };
    }

    getAllStats(): Record<string, PerformanceStats> {
        const result: Record<string, PerformanceStats> = {};
        for (const [key] of this.statsByOperation) {
            const stats = this.getStats(key);
            if (stats) {
                result[key] = stats;
            }
        }
        return result;
    }

    getSlowOperations(threshold?: number): SlowOperation[] {
        const result: SlowOperation[] = [];
        for (const entry of this.log) {
            const t = threshold ?? CATEGORY_THRESHOLDS[entry.category] ?? this.options.slowOperationThresholdMs;
            if (entry.duration > t) {
                result.push({
                    name: entry.name,
                    duration: entry.duration,
                    timestamp: entry.timestamp,
                    category: entry.category,
                    threshold: t,
                });
            }
        }
        return result.sort((a, b) => b.duration - a.duration);
    }

    getCategoryStats(): Record<PerformanceCategory, { count: number; totalDuration: number; avgDuration: number }> {
        const result: Record<string, { count: number; totalDuration: number; avgDuration: number }> = {};

        for (const entry of this.log) {
            if (!result[entry.category]) {
                result[entry.category] = { count: 0, totalDuration: 0, avgDuration: 0 };
            }
            result[entry.category].count++;
            result[entry.category].totalDuration += entry.duration;
        }

        for (const cat of Object.keys(result)) {
            const r = result[cat];
            r.avgDuration = r.count > 0 ? r.totalDuration / r.count : 0;
        }

        return result as Record<PerformanceCategory, { count: number; totalDuration: number; avgDuration: number }>;
    }

    getMemoryInfo(): { current?: number; peak: number; avg?: number } {
        const current = this.getCurrentMemory();
        const avg = this.memorySamples.length > 0
            ? this.memorySamples.reduce((a, b) => a + b, 0) / this.memorySamples.length
            : undefined;
        return { current, peak: this.peakMemory, avg };
    }

    getTrend(operationName: string, category?: PerformanceCategory, windowSize: number = 10): { recent: number[]; trend: 'improving' | 'degrading' | 'stable' } | null {
        const entries = this.log
            .filter(e => e.name === operationName && (!category || e.category === category))
            .slice(-windowSize * 2);

        if (entries.length < windowSize) return null;

        const recent = entries.map(e => e.duration);
        const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
        const secondHalf = recent.slice(Math.floor(recent.length / 2));

        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        const diffPercent = ((secondAvg - firstAvg) / firstAvg) * 100;
        let trend: 'improving' | 'degrading' | 'stable' = 'stable';
        if (diffPercent < -10) trend = 'improving';
        else if (diffPercent > 10) trend = 'degrading';

        return { recent, trend };
    }

    generateReport(cacheStats?: { hitRate: number; totalEntries: number; totalSize: number }): PerformanceReport {
        const categoryBreakdown = this.getCategoryStats();
        const allStats = this.getAllStats();

        const topSlowest = Object.entries(allStats)
            .map(([name, stats]) => ({ name, avgDuration: stats.avgDuration, count: stats.count }))
            .sort((a, b) => b.avgDuration - a.avgDuration)
            .slice(0, 10);

        const slowOps = this.getSlowOperations();

        const memoryInfo = this.getMemoryInfo();

        let totalDuration = 0;
        let totalOperations = 0;
        for (const cat of Object.values(categoryBreakdown)) {
            totalDuration += cat.totalDuration;
            totalOperations += cat.count;
        }

        const timeRange = this.log.length > 0
            ? { start: this.log[0].timestamp, end: this.log[this.log.length - 1].timestamp }
            : { start: Date.now(), end: Date.now() };

        return {
            generatedAt: Date.now(),
            timeRange,
            totalOperations,
            totalDuration,
            categoryBreakdown,
            topSlowest,
            slowOperations: slowOps.slice(0, 20),
            statsByOperation: allStats,
            memoryUsage: {
                current: memoryInfo.current,
                peak: memoryInfo.peak,
                avgDelta: memoryInfo.avg,
            },
            cacheStats,
        };
    }

    generateTextReport(cacheStats?: { hitRate: number; totalEntries: number; totalSize: number }): string {
        const report = this.generateReport(cacheStats);
        const lines: string[] = [];

        lines.push('═══════════════════════════════════════════');
        lines.push('📊 小说工坊 AI 性能报告');
        lines.push(`生成时间: ${new Date(report.generatedAt).toLocaleString()}`);
        lines.push(`统计范围: ${new Date(report.timeRange.start).toLocaleString()} ~ ${new Date(report.timeRange.end).toLocaleString()}`);
        lines.push('═══════════════════════════════════════════');
        lines.push('');

        lines.push('📈 总体概览');
        lines.push(`  总操作数: ${report.totalOperations}`);
        lines.push(`  总耗时: ${this.formatDuration(report.totalDuration)}`);
        lines.push(`  平均耗时: ${report.totalOperations > 0 ? this.formatDuration(report.totalDuration / report.totalOperations) : 'N/A'}`);
        lines.push('');

        lines.push('📂 分类统计');
        for (const [cat, stats] of Object.entries(report.categoryBreakdown)) {
            if (stats.count > 0) {
                const percent = report.totalDuration > 0 ? ((stats.totalDuration / report.totalDuration) * 100).toFixed(1) : '0';
                lines.push(`  ${cat}:`);
                lines.push(`    次数: ${stats.count} (${percent}% 时间)`);
                lines.push(`    总耗时: ${this.formatDuration(stats.totalDuration)}`);
                lines.push(`    平均: ${this.formatDuration(stats.avgDuration)}`);
            }
        }
        lines.push('');

        lines.push('🐢 最慢 Top 10 操作');
        for (let i = 0; i < report.topSlowest.length; i++) {
            const op = report.topSlowest[i];
            lines.push(`  ${i + 1}. ${op.name}`);
            lines.push(`     平均: ${this.formatDuration(op.avgDuration)} | 次数: ${op.count}`);
        }
        lines.push('');

        if (report.slowOperations.length > 0) {
            lines.push('⚠️  慢操作记录 (最近20条)');
            for (const op of report.slowOperations.slice(0, 20)) {
                lines.push(`  - ${op.name} (${op.category})`);
                lines.push(`    耗时: ${this.formatDuration(op.duration)} | 阈值: ${this.formatDuration(op.threshold)}`);
                lines.push(`    时间: ${new Date(op.timestamp).toLocaleString()}`);
            }
            lines.push('');
        }

        if (report.memoryUsage.peak || report.memoryUsage.current) {
            lines.push('💾 内存使用');
            if (report.memoryUsage.current) {
                lines.push(`  当前: ${this.formatBytes(report.memoryUsage.current)}`);
            }
            if (report.memoryUsage.peak) {
                lines.push(`  峰值: ${this.formatBytes(report.memoryUsage.peak)}`);
            }
            lines.push('');
        }

        if (report.cacheStats) {
            lines.push('💾 缓存统计');
            lines.push(`  命中率: ${(report.cacheStats.hitRate * 100).toFixed(1)}%`);
            lines.push(`  条目数: ${report.cacheStats.totalEntries}`);
            lines.push(`  总大小: ${this.formatBytes(report.cacheStats.totalSize)}`);
            lines.push('');
        }

        lines.push('═══════════════════════════════════════════');

        return lines.join('\n');
    }

    clearLog(): void {
        this.log = [];
        this.statsByOperation.clear();
        this.memorySamples = [];
        this.peakMemory = 0;
        log.info('性能日志已清空');
    }

    exportLog(): string {
        return JSON.stringify(this.log, null, 2);
    }

    importLog(json: string): void {
        try {
            const entries = JSON.parse(json) as PerformanceLogEntry[];
            if (Array.isArray(entries)) {
                this.log = entries.slice(-this.options.maxLogEntries);
                for (const entry of this.log) {
                    const key = `${entry.category}:${entry.name}`;
                    let stats = this.statsByOperation.get(key);
                    if (!stats) {
                        stats = { durations: [], total: 0, count: 0, min: Infinity, max: -Infinity };
                        this.statsByOperation.set(key, stats);
                    }
                    stats.durations.push(entry.duration);
                    stats.total += entry.duration;
                    stats.count++;
                    if (entry.duration < stats.min) stats.min = entry.duration;
                    if (entry.duration > stats.max) stats.max = entry.duration;
                }
            }
        } catch (e) {
            log.error('导入性能日志失败:', e);
        }
    }

    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    }

    private formatDuration(ms: number): string {
        if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
        if (ms < 1000) return `${ms.toFixed(2)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
        return `${(ms / 60000).toFixed(2)}min`;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

export const performanceMonitor = PerformanceMonitor.getInstance();
