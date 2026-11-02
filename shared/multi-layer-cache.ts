/**
 * cache/multi-layer-cache.ts — 多层缓存管理器
 *
 * 缓存分层：
 * - L1 内存缓存（快，小）→ LRU + TTL
 * - L2 文件缓存（慢，大）→ .cache 目录
 * - L3 源文件（最慢）→ 原始 Markdown（由调用方处理）
 *
 * 特性：
 * - 统一 API：get/set/invalidate/invalidateByPrefix/clear
 * - 动态自适应策略：根据项目规模自动调整缓存大小
 * - 缓存统计与监控：命中率、大小、失效次数
 * - 慢操作告警
 * - 零外部依赖
 */

import { LruCache } from './lru-cache';
import { FileCache } from './file-cache';
import type { FileSystemPort } from './file-system-port';
import { createLogger } from './logger';


const log = createLogger('MultiLayerCache');
// ============================================================
// 一、类型定义
// ============================================================

/**
 * 缓存层标识。
 */
export type CacheTier = 'L1' | 'L2' | 'L3';

/**
 * 项目规模档位。
 */
export type ProjectSizeTier = 'small' | 'medium' | 'large';

/**
 * 多层缓存选项。
 */
export interface MultiLayerCacheOptions {
    l1MaxSize?: number;
    l1TtlMs?: number;
    l2Enabled?: boolean;
    l2CacheDir?: string;
    l2TtlMs?: number;
    l2MaxFiles?: number;
    slowWarnThresholdMs?: number;
    autoAdapt?: boolean;
    entityCount?: number;
}

/**
 * 写入选项。
 */
export interface CacheSetOptions {
    sourcePath?: string;
    sourceMtime?: number;
    ttlMs?: number;
    tier?: CacheTier | 'all';
}

/**
 * 缓存统计。
 */
export interface CacheStats {
    l1: {
        size: number;
        maxSize: number;
        hitRate: number;
        hits: number;
        misses: number;
        evictions: number;
    };
    l2: {
        size: number;
        maxFiles: number;
        totalSizeBytes: number;
        hitRate: number;
        hits: number;
        misses: number;
        enabled: boolean;
    };
    overall: {
        hitRate: number;
        totalHits: number;
        totalMisses: number;
        totalInvalidations: number;
        tierHitDistribution: Record<CacheTier, number>;
        avgReadTimeMs: number;
        avgWriteTimeMs: number;
    };
    adaptive: {
        projectSizeTier: ProjectSizeTier;
        entityCount: number;
        autoAdaptEnabled: boolean;
    };
    slowOperations: Array<{
        operation: 'get' | 'set' | 'invalidate';
        key: string;
        durationMs: number;
        timestamp: number;
    }>;
}

interface InternalStats {
    l1Hits: number;
    l1Misses: number;
    l2Hits: number;
    l2Misses: number;
    totalInvalidations: number;
    tierHits: Record<CacheTier, number>;
    readTimes: number[];
    writeTimes: number[];
    slowOperations: Array<{
        operation: 'get' | 'set' | 'invalidate';
        key: string;
        durationMs: number;
        timestamp: number;
    }>;
}

const DEFAULT_OPTIONS: Required<Pick<MultiLayerCacheOptions,
    'l1MaxSize' | 'l1TtlMs' | 'l2Enabled' | 'l2TtlMs' | 'l2MaxFiles' | 'slowWarnThresholdMs' | 'autoAdapt'>> = {
    l1MaxSize: 100,
    l1TtlMs: 5 * 60 * 1000,
    l2Enabled: false,
    l2TtlMs: 24 * 60 * 60 * 1000,
    l2MaxFiles: 1000,
    slowWarnThresholdMs: 500,
    autoAdapt: true,
};

// ============================================================
// 二、多层缓存实现
// ============================================================

/**
 * 多层缓存（L1/L2）。
 */
export class MultiLayerCache {
    private l1: LruCache<string, unknown>;
    private l2: FileCache | null = null;
    private fs: FileSystemPort | null = null;
    private options: Required<Pick<MultiLayerCacheOptions,
        'l1MaxSize' | 'l1TtlMs' | 'l2Enabled' | 'l2TtlMs' | 'l2MaxFiles' | 'slowWarnThresholdMs' | 'autoAdapt'>>
        & { l2CacheDir?: string };

    private stats: InternalStats = {
        l1Hits: 0,
        l1Misses: 0,
        l2Hits: 0,
        l2Misses: 0,
        totalInvalidations: 0,
        tierHits: { L1: 0, L2: 0, L3: 0 },
        readTimes: [],
        writeTimes: [],
        slowOperations: [],
    };

    private entityCount = 0;
    private projectSizeTier: ProjectSizeTier = 'small';

    constructor(options: MultiLayerCacheOptions = {}, fs?: FileSystemPort) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.fs = fs || null;

        this.l1 = new LruCache<string, unknown>({
            maxSize: this.options.l1MaxSize,
            ttlMs: this.options.l1TtlMs,
        });

        if (this.options.l2Enabled && this.fs) {
            this.l2 = new FileCache(this.fs, {
                cacheDir: this.options.l2CacheDir,
                ttlMs: this.options.l2TtlMs,
                maxFiles: this.options.l2MaxFiles,
                slowWarnThresholdMs: this.options.slowWarnThresholdMs,
            });
        }

        if (options.entityCount !== undefined) {
            this.setEntityCount(options.entityCount);
        }
    }

    // ── 公共 API ──────────────────────────────────────────────

    /**
     * 获取。
     * @param key - 键
      * @returns T 或 null
     */
    async get<T>(key: string): Promise<T | null> {
        const startTime = Date.now();

        const l1Value = this.l1.get(key);
        if (l1Value !== undefined) {
            this.stats.l1Hits++;
            this.stats.tierHits.L1++;
            this.recordReadTime(Date.now() - startTime);
            return l1Value as T;
        }
        this.stats.l1Misses++;

        if (this.l2) {
            const l2Value = await this.l2.get<T>(key);
            if (l2Value !== null) {
                this.stats.l2Hits++;
                this.stats.tierHits.L2++;
                this.l1.set(key, l2Value);
                this.recordReadTime(Date.now() - startTime);
                return l2Value;
            }
            this.stats.l2Misses++;
        }

        this.stats.tierHits.L3++;
        this.recordReadTime(Date.now() - startTime);
        this.checkSlowOp('get', key, startTime);
        return null;
    }

    /**
     * 设置。
     * @param key - 键
     * @param value - 值
     * @param options - 配置项
     */
    async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
        const startTime = Date.now();
        const tier = options?.tier || 'all';

        if (tier === 'all' || tier === 'L1') {
            this.l1.set(key, value);
        }

        if (this.l2 && (tier === 'all' || tier === 'L2')) {
            await this.l2.set(key, value, {
                sourcePath: options?.sourcePath,
                sourceMtime: options?.sourceMtime,
            });
        }

        this.recordWriteTime(Date.now() - startTime);
        this.checkSlowOp('set', key, startTime);
    }

    /**
     * 失效单个键（所有层）。
     *
     * @param key - 键
     */
    async invalidate(key: string): Promise<void> {
        const startTime = Date.now();

        this.l1.delete(key);

        if (this.l2) {
            await this.l2.delete(key);
        }

        this.stats.totalInvalidations++;
        this.checkSlowOp('invalidate', key, startTime);
    }

    /**
     * 按前缀失效。
     *
     * @param prefix - 前缀
     * @returns 失效数量
     */
    async invalidateByPrefix(prefix: string): Promise<number> {
        const startTime = Date.now();
        let count = 0;

        count += this.l1.deleteByPrefix(prefix);

        if (this.l2) {
            count += await this.l2.deleteByPrefix(prefix);
        }

        this.stats.totalInvalidations += count;
        this.checkSlowOp('invalidate', prefix, startTime);
        return count;
    }

    /**
     * 按来源文件失效。
     *
     * @param sourcePath - 源路径
     * @returns 失效数量
     */
    async invalidateBySourcePath(sourcePath: string): Promise<number> {
        let count = 0;

        if (this.l2) {
            count = this.l2.invalidateBySourcePath(sourcePath);
        }

        this.stats.totalInvalidations += count;
        return count;
    }

    /**
     * 清空全部缓存。
     */
    async clear(): Promise<void> {
        this.l1.clear();
        if (this.l2) {
            await this.l2.clear();
        }
        this.resetStats();
    }

    // ── 动态自适应策略 ────────────────────────────────────────

    /**
     * 更新项目实体数量（用于容量决策）。
     *
     * @param count - 数量
     */
    setEntityCount(count: number): void {
        this.entityCount = count;
        if (this.options.autoAdapt) {
            this.adaptToProjectSize(count);
        }
    }

    /**
     * 读取项目实体数量。
     * @returns 数量
     */
    getEntityCount(): number {
        return this.entityCount;
    }

    /**
     * 按实体数量返回项目规模档位。
     * @returns 档位
     */
    getProjectSizeTier(): ProjectSizeTier {
        return this.projectSizeTier;
    }

    private adaptToProjectSize(entityCount: number): void {
        let tier: ProjectSizeTier;
        let l1MaxSize: number;
        let l2Enabled: boolean;

        if (entityCount < 50) {
            tier = 'small';
            l1MaxSize = 100;
            l2Enabled = false;
        } else if (entityCount <= 200) {
            tier = 'medium';
            l1MaxSize = 300;
            l2Enabled = false;
        } else {
            tier = 'large';
            l1MaxSize = 500;
            l2Enabled = true;
        }

        this.projectSizeTier = tier;

        (this.l1 as any).maxSize = l1MaxSize;

        if (l2Enabled && !this.l2 && this.fs) {
            this.l2 = new FileCache(this.fs, {
                cacheDir: this.options.l2CacheDir,
                ttlMs: this.options.l2TtlMs,
                maxFiles: this.options.l2MaxFiles,
                slowWarnThresholdMs: this.options.slowWarnThresholdMs,
            });
        }

        if (!l2Enabled && this.l2) {
            this.l2 = null;
        }
    }

    /**
     * 按内存压力调整缓存容量。
     *
     * @param memoryUsageRatio - 内存使用比例
     * @returns 建议容量
     */
    adjustForMemoryPressure(memoryUsageRatio: number): number {
        if (memoryUsageRatio < 0.5) return 0;

        const currentSize = this.l1.size;
        let evictCount = 0;

        if (memoryUsageRatio > 0.9) {
            evictCount = Math.floor(currentSize * 0.5);
        } else if (memoryUsageRatio > 0.75) {
            evictCount = Math.floor(currentSize * 0.25);
        } else {
            evictCount = Math.floor(currentSize * 0.1);
        }

        const keys = this.l1.keys();
        for (let i = 0; i < evictCount && i < keys.length; i++) {
            this.l1.delete(keys[i]);
        }

        return evictCount;
    }

    // ── 统计与监控 ────────────────────────────────────────────

    /**
     * 读取缓存命中/容量统计。
     * @returns 统计对象
     */
    getStats(): CacheStats {
        const totalL1Accesses = this.stats.l1Hits + this.stats.l1Misses;
        const totalL2Accesses = this.stats.l2Hits + this.stats.l2Misses;
        const totalAccesses = totalL1Accesses;
        const totalHits = this.stats.l1Hits + this.stats.l2Hits;

        return {
            l1: {
                size: this.l1.size,
                maxSize: (this.l1 as any).maxSize,
                hitRate: totalL1Accesses > 0 ? this.stats.l1Hits / totalL1Accesses : 0,
                hits: this.stats.l1Hits,
                misses: this.stats.l1Misses,
                evictions: this.stats.totalInvalidations,
            },
            l2: {
                size: this.l2?.size || 0,
                maxFiles: this.options.l2MaxFiles,
                totalSizeBytes: this.l2?.totalSizeBytes || 0,
                hitRate: totalL2Accesses > 0 ? this.stats.l2Hits / totalL2Accesses : 0,
                hits: this.stats.l2Hits,
                misses: this.stats.l2Misses,
                enabled: this.l2 !== null,
            },
            overall: {
                hitRate: totalAccesses > 0 ? totalHits / totalAccesses : 0,
                totalHits,
                totalMisses: this.stats.l1Misses + (this.l2 ? this.stats.l2Misses : 0),
                totalInvalidations: this.stats.totalInvalidations,
                tierHitDistribution: { ...this.stats.tierHits },
                avgReadTimeMs: this.avg(this.stats.readTimes),
                avgWriteTimeMs: this.avg(this.stats.writeTimes),
            },
            adaptive: {
                projectSizeTier: this.projectSizeTier,
                entityCount: this.entityCount,
                autoAdaptEnabled: this.options.autoAdapt,
            },
            slowOperations: [...this.stats.slowOperations].slice(-20),
        };
    }

    /**
     * 重置统计。
     */
    resetStats(): void {
        this.stats = {
            l1Hits: 0,
            l1Misses: 0,
            l2Hits: 0,
            l2Misses: 0,
            totalInvalidations: 0,
            tierHits: { L1: 0, L2: 0, L3: 0 },
            readTimes: [],
            writeTimes: [],
            slowOperations: [],
        };
    }

    // ── L1/L2 直接访问（用于高级用法） ───────────────────────

    /**
     * 取 L1 缓存。
     * @returns 缓存
     */
    getL1Cache(): LruCache<string, unknown> {
        return this.l1;
    }

    /**
     * 取 L2 缓存。
     * @returns 缓存
     */
    getL2Cache(): FileCache | null {
        return this.l2;
    }

    /**
     * L2 是否启用。
     * @returns 布尔值
     */
    isL2Enabled(): boolean {
        return this.l2 !== null;
    }

    // ── 内部方法 ──────────────────────────────────────────────

    private recordReadTime(ms: number): void {
        this.stats.readTimes.push(ms);
        if (this.stats.readTimes.length > 100) {
            this.stats.readTimes.shift();
        }
    }

    private recordWriteTime(ms: number): void {
        this.stats.writeTimes.push(ms);
        if (this.stats.writeTimes.length > 100) {
            this.stats.writeTimes.shift();
        }
    }

    private checkSlowOp(operation: 'get' | 'set' | 'invalidate', key: string, startTime: number): void {
        const duration = Date.now() - startTime;
        if (duration > this.options.slowWarnThresholdMs) {
            log.warn(`[MultiLayerCache] 慢操作: ${operation} ${key} (${duration}ms)`);
            this.stats.slowOperations.push({
                operation,
                key,
                durationMs: duration,
                timestamp: Date.now(),
            });
            if (this.stats.slowOperations.length > 100) {
                this.stats.slowOperations.shift();
            }
        }
    }

    private avg(arr: number[]): number {
        if (arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    /**
     * 把待写缓存刷盘。
     */
    async flush(): Promise<void> {
        if (this.l2) {
            await this.l2.flush();
        }
    }
}
