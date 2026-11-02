/**
 * repository/lru-cache.ts — LRU 缓存实现
 *
 * 特性：
 * - 基于 Map 的 O(1) LRU 淘汰策略
 * - 支持按路径（key）失效
 * - 支持按时间（TTL）失效
 * - 零外部依赖
 *
 * 使用方式：
 *   const cache = new LruCache<string, Entity>({ maxSize: 100, ttlMs: 60_000 });
 *   cache.set('path/to/file.md', entity);
 *   const entity = cache.get('path/to/file.md');
 */

// ============================================================
// 一、缓存配置
// ============================================================

export interface LruCacheOptions {
    /** 最大缓存条目数，超过后淘汰最久未使用的 */
    maxSize?: number;
    /** 缓存存活时间（毫秒），0 或未设置表示永不过期 */
    ttlMs?: number;
}

// ============================================================
// 二、缓存条目
// ============================================================

interface CacheEntry<V> {
    value: V;
    /** 最后访问时间戳（ms） */
    lastAccessedAt: number;
    /** 创建/更新时间戳（ms），用于 TTL 判断 */
    createdAt: number;
}

// ============================================================
// 三、LRU 缓存实现
// ============================================================

/**
 * LRU (Least Recently Used) 缓存
 *
 * 基于 Map 实现，利用 Map 的插入顺序特性：
 * - get 时删除再重新 set，将条目移到末尾（最新）
 * - 淘汰时删除第一个条目（最旧）
 *
 * @typeParam K 键类型
 * @typeParam V 值类型
 */
export class LruCache<K, V> {
    private readonly cache: Map<K, CacheEntry<V>>;
    private readonly maxSize: number;
    private readonly ttlMs: number;

    constructor(options: LruCacheOptions = {}) {
        this.cache = new Map();
        this.maxSize = options.maxSize ?? 100;
        this.ttlMs = options.ttlMs ?? 0;
    }

    // ── 基础操作 ──────────────────────────────────────────────

    /**
     * 获取缓存值
     * 命中时更新访问时间并将条目移到末尾（最新）
     * 未命中或已过期返回 undefined
     * @param key - 键
      * @returns V 或 undefined
     */
    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            return undefined;
        }

        this.cache.delete(key);
        entry.lastAccessedAt = Date.now();
        this.cache.set(key, entry);

        return entry.value;
    }

    /**
     * 设置缓存值
     * 超过 maxSize 时淘汰最久未使用的条目
     * @param key - 键
     * @param value - 值
     */
    set(key: K, value: V): void {
        const now = Date.now();

        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, {
            value,
            lastAccessedAt: now,
            createdAt: now,
        });

        this.evictIfNeeded();
    }

    /**
     * 删除指定缓存条目
     * 返回是否存在并删除成功
     * @param key - 键
     * @returns 是否成功
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * 检查键是否存在（考虑 TTL）
     * @param key - 键
     * @returns 是否成功
     */
    has(key: K): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        this.cache.clear();
    }

    // ── 批量操作 ──────────────────────────────────────────────

    /**
     * 按前缀批量删除缓存
     * 适用于：目录变更时失效该目录下所有文件缓存
     * @param prefix - 前缀
     * @returns 数值结果
     */
    deleteByPrefix(prefix: string): number {
        let count = 0;
        for (const key of this.cache.keys()) {
            if (typeof key === 'string' && key.startsWith(prefix)) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }

    /**
     * 清理所有已过期的条目
     * 返回清理的条目数
     * @returns 数值结果
     */
    pruneExpired(): number {
        if (this.ttlMs <= 0) return 0;

        let count = 0;
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.createdAt > this.ttlMs) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }

    // ── 元信息 ────────────────────────────────────────────────

    /**
     * 当前缓存条目数
     *
     * @returns 数值结果
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * 获取所有键（按访问顺序，最旧在前）
     *
     * @returns 结果数组
     */
    keys(): K[] {
        return Array.from(this.cache.keys());
    }

    // ── 内部方法 ──────────────────────────────────────────────

    /** 判断条目是否已过期 */
    private isExpired(entry: CacheEntry<V>): boolean {
        if (this.ttlMs <= 0) return false;
        return Date.now() - entry.createdAt > this.ttlMs;
    }

    /** 超过最大容量时淘汰最久未使用的条目 */
    private evictIfNeeded(): void {
        while (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
    }
}
