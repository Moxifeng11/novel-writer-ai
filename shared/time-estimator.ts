import { createLogger } from './logger';

const log = createLogger('TimeEstimator');
/**
 * time-estimator.ts — 精准时间估算引擎
 *
 * 功能：
 * - 基于历史数据 + 字数分桶 + 中位数统计的时间估算
 * - 支持统计模式和向量模式两种估算模式
 * - 实时修正估算（根据已用时间和进度加权调整）
 * - localStorage 持久化历史数据
 * - 置信度评估（基于历史数据量）
 *
 * 设计原则：
 * - 纯 TypeScript，零依赖（不依赖 Obsidian API）
 * - 中位数统计，稳健抗异常
 * - 字数分桶，粒度可控
 * - 渐进式修正，进度越高越准确
 */

// ============================================================
// 1. 类型定义
// ============================================================

/** 估算配置 */
export interface EstimationConfig {
    operationType: string;
    wordCount: number;
    mode?: 'statistical' | 'vector';
}

/** 估算结果 */
export interface EstimationResult {
    eta: number;
    etaMin: number;
    etaMax: number;
    confidence: number;
}

/** 历史记录 */
export interface HistoryRecord {
    operationType: string;
    wordCount: number;
    mode: 'statistical' | 'vector';
    duration: number;
    timestamp: number;
}

/** 时间估算器选项 */
export interface TimeEstimatorOptions {
    storageKey?: string;
    maxHistoryPerType?: number;
    bucketSize?: number;
}

// ============================================================
// 2. 常量
// ============================================================

const DEFAULT_STORAGE_KEY = 'novel-writer-time-estimator-history';
const DEFAULT_MAX_HISTORY_PER_TYPE = 50;
const DEFAULT_BUCKET_SIZE = 10000;
const MIN_SAMPLES_FOR_CONFIDENCE = 10;

const DEFAULT_SPEED_STATISTICAL = 5000;
const DEFAULT_SPEED_VECTOR = 500;

// ============================================================
// 3. TimeEstimator 类
// ============================================================

/**
 * 精准时间估算器
 *
 * 基于历史数据和字数分桶的中位数统计算法，提供：
 * - 乐观/中性/悲观三档预估
 * - 置信度评估
 * - 实时进度修正
 * - 本地持久化
 *
 * @example
 * ```ts
 * const estimator = new TimeEstimator();
 * await estimator.loadHistory();
 *
 * const result = estimator.estimate({
 *     operationType: 'outline_generation',
 *     wordCount: 50000,
 *     mode: 'statistical'
 * });
 *
 * log.info(`预估: ${result.eta / 1000}s`);
 * log.info(`置信度: ${(result.confidence * 100).toFixed(0)}%`);
 * ```
 */
export class TimeEstimator {
    private readonly storageKey: string;
    private readonly maxHistoryPerType: number;
    private readonly bucketSize: number;

    private history: Map<string, HistoryRecord[]> = new Map();

    constructor(options?: TimeEstimatorOptions) {
        this.storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
        this.maxHistoryPerType = options?.maxHistoryPerType ?? DEFAULT_MAX_HISTORY_PER_TYPE;
        this.bucketSize = options?.bucketSize ?? DEFAULT_BUCKET_SIZE;
    }

    // ========================================================
    // 3.1 核心估算方法
    // ========================================================

    /**
     * 估算操作耗时
     * @param config 估算配置
     * @returns 估算结果（eta, etaMin, etaMax, confidence）
     */
    estimate(config: EstimationConfig): EstimationResult {
        const { operationType, wordCount, mode = 'statistical' } = config;
        const records = this.getRecords(operationType, mode);

        if (records.length === 0) {
            return this.fallbackEstimate(wordCount, mode);
        }

        const targetBucket = this.getBucketIndex(wordCount);

        const nearbyRecords = this.findNearbyBucketRecords(records, targetBucket);

        if (nearbyRecords.length === 0) {
            return this.fallbackEstimate(wordCount, mode);
        }

        const durations = nearbyRecords.map(r => this.scaleDuration(r, wordCount));
        durations.sort((a, b) => a - b);

        const median = this.percentile(durations, 50);
        const p25 = this.percentile(durations, 25);
        const p75 = this.percentile(durations, 75);

        const confidence = Math.min(1, nearbyRecords.length / MIN_SAMPLES_FOR_CONFIDENCE);

        return {
            eta: Math.round(median),
            etaMin: Math.round(p25),
            etaMax: Math.round(p75),
            confidence,
        };
    }

    /**
     * 记录实际耗时
     * @param config 操作配置 + 实际耗时
     */
    record(config: EstimationConfig & { duration: number }): void {
        const { operationType, wordCount, mode = 'statistical', duration } = config;

        const record: HistoryRecord = {
            operationType,
            wordCount,
            mode,
            duration,
            timestamp: Date.now(),
        };

        const key = this.getHistoryKey(operationType, mode);
        const records = this.history.get(key) ?? [];

        records.push(record);

        if (records.length > this.maxHistoryPerType) {
            records.sort((a, b) => a.timestamp - b.timestamp);
            records.splice(0, records.length - this.maxHistoryPerType);
        }

        this.history.set(key, records);
    }

    // ========================================================
    // 3.2 持久化
    // ========================================================

    /**
     * 从 localStorage 加载历史数据
     */
    async loadHistory(): Promise<void> {
        try {
            const raw = typeof localStorage !== 'undefined'
                ? localStorage.getItem(this.storageKey)
                : null;

            if (!raw) return;

            const parsed = JSON.parse(raw) as Record<string, HistoryRecord[]>;
            this.history = new Map(Object.entries(parsed));
        } catch (e) {
            log.warn('[TimeEstimator] 加载历史数据失败:', e);
            this.history.clear();
        }
    }

    /**
     * 保存历史数据到 localStorage
     */
    async saveHistory(): Promise<void> {
        try {
            if (typeof localStorage === 'undefined') return;

            const obj: Record<string, HistoryRecord[]> = {};
            this.history.forEach((records, key) => {
                obj[key] = records;
            });

            localStorage.setItem(this.storageKey, JSON.stringify(obj));
        } catch (e) {
            log.warn('[TimeEstimator] 保存历史数据失败:', e);
        }
    }

    /**
     * 清空历史数据
     * @param operationType 可选，指定操作类型；不传则清空所有
     */
    clearHistory(operationType?: string): void {
        if (operationType) {
            for (const mode of ['statistical', 'vector'] as const) {
                const key = this.getHistoryKey(operationType, mode);
                this.history.delete(key);
            }
        } else {
            this.history.clear();
        }
    }

    // ========================================================
    // 3.3 统计信息
    // ========================================================

    /**
     * 获取统计摘要
     * @param operationType 可选，指定操作类型
     * @param mode 可选，指定模式
     * @returns 统计摘要对象
     */
    getStats(operationType?: string, mode?: 'statistical' | 'vector'): object {
        const result: Record<string, unknown> = {};

        const keys: string[] = [];
        if (operationType && mode) {
            keys.push(this.getHistoryKey(operationType, mode));
        } else if (operationType) {
            keys.push(this.getHistoryKey(operationType, 'statistical'));
            keys.push(this.getHistoryKey(operationType, 'vector'));
        } else {
            this.history.forEach((_, key) => keys.push(key));
        }

        for (const key of keys) {
            const records = this.history.get(key);
            if (!records || records.length === 0) continue;

            const durations = records.map(r => r.duration).sort((a, b) => a - b);
            const wordCounts = records.map(r => r.wordCount);

            result[key] = {
                count: records.length,
                avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
                medianDuration: this.percentile(durations, 50),
                minDuration: durations[0],
                maxDuration: durations[durations.length - 1],
                avgWordCount: wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
                minWordCount: Math.min(...wordCounts),
                maxWordCount: Math.max(...wordCounts),
                oldest: records[0]?.timestamp,
                newest: records[records.length - 1]?.timestamp,
            };
        }

        return result;
    }

    // ========================================================
    // 3.4 内部辅助方法
    // ========================================================

    private getHistoryKey(operationType: string, mode: 'statistical' | 'vector'): string {
        return `${operationType}:${mode}`;
    }

    private getRecords(operationType: string, mode: 'statistical' | 'vector'): HistoryRecord[] {
        const key = this.getHistoryKey(operationType, mode);
        return this.history.get(key) ?? [];
    }

    private getBucketIndex(wordCount: number): number {
        return Math.floor(wordCount / this.bucketSize);
    }

    private findNearbyBucketRecords(records: HistoryRecord[], targetBucket: number): HistoryRecord[] {
        const sameBucket = records.filter(r => this.getBucketIndex(r.wordCount) === targetBucket);
        if (sameBucket.length >= 3) {
            return sameBucket;
        }

        const result: HistoryRecord[] = [...sameBucket];

        let offset = 1;
        while (result.length < 10 && offset <= 10) {
            const lower = records.filter(r => this.getBucketIndex(r.wordCount) === targetBucket - offset);
            const higher = records.filter(r => this.getBucketIndex(r.wordCount) === targetBucket + offset);
            result.push(...lower, ...higher);
            offset++;
        }

        return result.length > 0 ? result : records.slice(0, 10);
    }

    private scaleDuration(record: HistoryRecord, targetWordCount: number): number {
        if (record.wordCount === 0) return record.duration;
        const ratio = targetWordCount / record.wordCount;
        return record.duration * ratio;
    }

    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        if (sorted.length === 1) return sorted[0];

        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);

        if (lower === upper) return sorted[lower];

        const weight = index - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }

    private fallbackEstimate(wordCount: number, mode: 'statistical' | 'vector'): EstimationResult {
        const speed = mode === 'statistical' ? DEFAULT_SPEED_STATISTICAL : DEFAULT_SPEED_VECTOR;
        const baseEta = (wordCount / speed) * 1000;

        return {
            eta: Math.round(baseEta),
            etaMin: Math.round(baseEta * 0.5),
            etaMax: Math.round(baseEta * 2),
            confidence: 0,
        };
    }
}

// ============================================================
// 4. 进度修正工具函数
// ============================================================

/**
 * 根据当前进度和已用时间修正估算
 *
 * 与历史估算取加权平均：进度越高，实时估算权重越大
 *
 * @param baseEstimate 基础估算结果（来自历史数据）
 * @param elapsed 已用时间（毫秒）
 * @param progress 当前进度（0-100）
 * @returns 修正后的估算结果
 *
 * @example
 * ```ts
 * const base = estimator.estimate(config);
 *
 * // 执行一段时间后...
 * const refined = refineEstimate(base, elapsedMs, currentProgress);
 * log.info(`修正后预估: ${refined.eta / 1000}s`);
 * ```
 */
export function refineEstimate(
    baseEstimate: EstimationResult,
    elapsed: number,
    progress: number
): EstimationResult {
    const clampedProgress = Math.max(0, Math.min(100, progress));

    if (clampedProgress <= 0 || clampedProgress >= 100 || elapsed <= 0) {
        return { ...baseEstimate };
    }

    const realtimeEta = (elapsed / clampedProgress) * (100 - clampedProgress);

    const progressRatio = clampedProgress / 100;
    const realtimeWeight = Math.min(0.9, progressRatio * progressRatio);
    const baseWeight = 1 - realtimeWeight;

    const blendedEta = baseEstimate.eta * baseWeight + realtimeEta * realtimeWeight;

    const spreadRatio = (baseEstimate.etaMax - baseEstimate.etaMin) / baseEstimate.eta / 2;
    const adjustedSpread = spreadRatio * blendedEta;

    return {
        eta: Math.round(blendedEta),
        etaMin: Math.round(blendedEta - adjustedSpread),
        etaMax: Math.round(blendedEta + adjustedSpread),
        confidence: baseEstimate.confidence,
    };
}

// ============================================================
// 5. 使用示例
// ============================================================

/*
// 示例 1: 基本用法
const estimator = new TimeEstimator();

// 加载历史数据
await estimator.loadHistory();

// 预估时间
const result = estimator.estimate({
    operationType: 'deconstruction_style',
    wordCount: 30000,
    mode: 'statistical'
});

log.info(`预估耗时: ${(result.eta / 1000).toFixed(1)}s`);
log.info(`最快: ${(result.etaMin / 1000).toFixed(1)}s`);
log.info(`最慢: ${(result.etaMax / 1000).toFixed(1)}s`);
log.info(`置信度: ${(result.confidence * 100).toFixed(0)}%`);

// 记录实际耗时
estimator.record({
    operationType: 'deconstruction_style',
    wordCount: 30000,
    mode: 'statistical',
    duration: 8500
});

// 保存历史数据
await estimator.saveHistory();

// 示例 2: 进度实时修正
const baseEstimate = estimator.estimate({
    operationType: 'outline_generation',
    wordCount: 50000,
    mode: 'vector'
});

// 模拟执行 2 秒，进度 30%
const elapsed = 2000;
const progress = 30;

const refined = refineEstimate(baseEstimate, elapsed, progress);
log.info(`基础预估: ${(baseEstimate.eta / 1000).toFixed(1)}s`);
log.info(`修正预估: ${(refined.eta / 1000).toFixed(1)}s`);

// 示例 3: 查看统计信息
const stats = estimator.getStats('deconstruction_style', 'statistical');
log.info('统计信息:', stats);

// 示例 4: 清空指定操作的历史
estimator.clearHistory('old_operation_type');

// 示例 5: 自定义配置
const customEstimator = new TimeEstimator({
    storageKey: 'my-custom-history',
    maxHistoryPerType: 100,
    bucketSize: 5000
});
*/
