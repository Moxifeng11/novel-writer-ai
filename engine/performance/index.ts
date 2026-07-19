/**
 * performance/index.ts — 性能监控模块导出入口
 */

export { PerformanceMonitor, performanceMonitor } from './performance-monitor';
export type {
    PerformanceMonitorOptions,
    PerformanceMark,
    OperationStats,
    SlowOperation,
    PerformanceStats,
} from './performance-monitor';
