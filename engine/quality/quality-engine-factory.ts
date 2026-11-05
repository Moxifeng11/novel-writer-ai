/**
 * quality-engine-factory.ts — 有状态质量引擎的构造与作用域
 *
 * `WritingQualityEngine` / `PlotDivergenceEngine` 都持有**可变状态**：
 * - 评分历史 / 里程碑；
 * - 偏离历史 / 告警冷却 / 忽略项；
 * - 章节上下文（人物、主线关键词、大纲）。
 *
 * 因此**不能**做全局单例：不同章节/视图共享会串历史与冷却。
 * 但它们也不该在各处直接 `new`——构造点分散会导致：
 * - 引擎守卫统计失真；
 * - 生命周期（reset/clear）没有统一入口。
 *
 * 本模块提供两类入口：
 * - `createXxx()`：为「每个视图/每个监控面板」创建**独立实例**（默认语义）；
 * - `getScopedXxx(scope)`：为「长期存在的消费者」提供按 scope 缓存的实例
 *   （如 heavy-task 管理器、Worker 线程）。
 */
import { WritingQualityEngine, type WritingQualityEngineOptions } from '@/engine/writing-quality-engine';
import { PlotDivergenceEngine, type PlotDivergenceEngineOptions } from '@/engine/plot-divergence-engine';

const writingScopes = new Map<string, WritingQualityEngine>();
const divergenceScopes = new Map<string, PlotDivergenceEngine>();

/**
 * 创建一份独立的写作质量引擎（每个视图/面板一份，历史互不串）。
 *
 * @param options - 初始评估上下文
 * @returns 新引擎实例
 *
 * @example
 * ```ts
 * const kernel = createWritingQualityEngine();
 * const result = kernel.evaluate(text);
 * ```
 */
export function createWritingQualityEngine(options: WritingQualityEngineOptions = {}): WritingQualityEngine {
    return new WritingQualityEngine(options);
}

/**
 * 按 scope 取写作质量引擎；同 scope 返回同一实例，不同 scope 隔离。
 *
 * 只用于长期存在的消费者（Worker、heavy-task 管理器）。
 *
 * @param scope - 作用域键（如 'heavy-task'、'quality-worker'）
 * @param options - 首次创建时的初始上下文
 * @returns 作用域内共享实例
 *
 * @example
 * ```ts
 * const kernel = getScopedWritingQualityEngine('heavy-task');
 * ```
 */
export function getScopedWritingQualityEngine(
    scope: string,
    options: WritingQualityEngineOptions = {},
): WritingQualityEngine {
    const key = String(scope || 'default');
    let engine = writingScopes.get(key);
    if (!engine) {
        engine = createWritingQualityEngine(options);
        writingScopes.set(key, engine);
    }
    return engine;
}

/**
 * 创建一份独立的剧情偏离引擎（每个视图/面板一份）。
 *
 * @param options - 初始评估上下文
 * @returns 新引擎实例
 *
 * @example
 * ```ts
 * const divergence = createPlotDivergenceEngine();
 * ```
 */
export function createPlotDivergenceEngine(options: PlotDivergenceEngineOptions = {}): PlotDivergenceEngine {
    return new PlotDivergenceEngine(options);
}

/**
 * 按 scope 取剧情偏离引擎；同 scope 返回同一实例。
 *
 * @param scope - 作用域键
 * @param options - 首次创建时的初始上下文
 * @returns 作用域内共享实例
 *
 * @example
 * ```ts
 * const divergence = getScopedPlotDivergenceEngine('heavy-task');
 * ```
 */
export function getScopedPlotDivergenceEngine(
    scope: string,
    options: PlotDivergenceEngineOptions = {},
): PlotDivergenceEngine {
    const key = String(scope || 'default');
    let engine = divergenceScopes.get(key);
    if (!engine) {
        engine = createPlotDivergenceEngine(options);
        divergenceScopes.set(key, engine);
    }
    return engine;
}

/** 清空作用域缓存（测试用；插件卸载时也可调用）。 */
export function resetQualityEngineScopes(): void {
    writingScopes.clear();
    divergenceScopes.clear();
}
