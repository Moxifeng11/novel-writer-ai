/**
 * cache/preload-manager.ts — 智能预加载与懒加载管理器
 *
 * 作为可选增强层，提供：
 * - 相邻章节预加载：用户阅读/编辑当前章节时，提前加载前后章节
 * - 实体懒加载：实体信息按需加载，避免一次性加载全部
 * - 空闲队列：浏览器空闲时后台预计算任务
 * - 行为预测：基于用户行为模式预测下一步操作，提前预热数据
 *
 * 设计原则：
 * - 纯增量，不修改现有代码
 * - 零外部依赖
 * - 失败静默，不影响主流程
 * - 可随时启用/禁用
 */

import { LruCache } from '../../shared/lru-cache';
import type { Chapter } from '../repository/domain/aggregates';
import type { ChapterRepository } from '../repository';

// ============================================================
// 一、类型定义
// ============================================================

/**
 * 预加载管理器选项。
 */
export interface PreloadManagerOptions {
    /** 是否启用预加载 */
    enabled?: boolean;
    /** 预加载章节缓存大小 */
    chapterCacheSize?: number;
    /** 实体懒加载缓存大小 */
    entityCacheSize?: number;
    /** 空闲队列最大任务数 */
    idleQueueMaxSize?: number;
    /** 预加载相邻章节数量（前后各N章） */
    adjacentChapterCount?: number;
    /** 行为历史记录最大条数 */
    behaviorHistoryMaxSize?: number;
}

/**
 * 用户行为记录。
 */
export interface UserBehavior {
    /** 行为类型 */
    action: 'read' | 'edit' | 'navigate' | 'search' | 'generate';
    /** 目标章节 ID */
    chapterId?: string;
    /** 目标实体 ID */
    entityId?: string;
    /** 行为发生时间戳 */
    timestamp: number;
    /** 停留时长（毫秒） */
    durationMs?: number;
    /** 额外元数据 */
    metadata?: Record<string, any>;
}

/**
 * 空闲任务。
 */
export interface IdleTask {
    /** 任务唯一标识 */
    id: string;
    /** 任务优先级，数值越大优先级越高 */
    priority: number;
    /** 任务执行函数 */
    execute: () => Promise<void> | void;
    /** 任务描述（用于调试） */
    description?: string;
    /** 任务创建时间 */
    createdAt: number;
}

/**
 * 预加载统计。
 */
export interface PreloadStats {
    /** 章节预加载缓存命中数 */
    chapterCacheHits: number;
    /** 章节预加载缓存未命中数 */
    chapterCacheMisses: number;
    /** 实体懒加载缓存命中数 */
    entityCacheHits: number;
    /** 实体懒加载缓存未命中数 */
    entityCacheMisses: number;
    /** 空闲队列已执行任务数 */
    idleTasksExecuted: number;
    /** 行为预测成功次数 */
    predictionsHit: number;
    /** 行为预测总次数 */
    predictionsTotal: number;
}

interface LazyEntityLoader<T> {
    (id: string): Promise<T | null>;
}

const DEFAULT_OPTIONS: Required<PreloadManagerOptions> = {
    enabled: true,
    chapterCacheSize: 20,
    entityCacheSize: 100,
    idleQueueMaxSize: 50,
    adjacentChapterCount: 1,
    behaviorHistoryMaxSize: 50,
};

// ============================================================
// 二、PreloadManager 类
// ============================================================

/**
 * 空闲预加载管理器。
 */
export class PreloadManager {
    private options: Required<PreloadManagerOptions>;
    private chapterCache: LruCache<string, Chapter>;
    private entityCaches: Map<string, LruCache<string, any>> = new Map();
    private entityLoaders: Map<string, LazyEntityLoader<any>> = new Map();
    private idleQueue: IdleTask[] = [];
    private idleTimer: number | null = null;
    private behaviorHistory: UserBehavior[] = [];
    private stats: PreloadStats = {
        chapterCacheHits: 0,
        chapterCacheMisses: 0,
        entityCacheHits: 0,
        entityCacheMisses: 0,
        idleTasksExecuted: 0,
        predictionsHit: 0,
        predictionsTotal: 0,
    };
    private chapterRepository: ChapterRepository | null = null;
    private preloadingChapters: Set<string> = new Set();

    constructor(options?: PreloadManagerOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.chapterCache = new LruCache<string, Chapter>({ maxSize: this.options.chapterCacheSize });
    }

    // ============================================================
    // 配置与生命周期
    // ============================================================

    /**
     * 更新预加载选项。
     *
     * @param options - 配置项
     */
    setOptions(options: Partial<PreloadManagerOptions>): void {
        this.options = { ...this.options, ...options };
        if (options.chapterCacheSize !== undefined) {
            this.chapterCache = new LruCache<string, Chapter>({ maxSize: this.options.chapterCacheSize });
        }
    }

    /**
     * 读取预加载选项。
     * @returns 选项
     */
    getOptions(): PreloadManagerOptions {
        return { ...this.options };
    }

    /**
     * 启用预加载。
     */
    enable(): void {
        this.options.enabled = true;
        this.startIdleProcessor();
    }

    /**
     * 停用预加载。
     */
    disable(): void {
        this.options.enabled = false;
        this.stopIdleProcessor();
    }

    /**
     * 是否启用。
     * @returns 布尔值
     */
    isEnabled(): boolean {
        return this.options.enabled;
    }

    /**
     * 注入章节仓储。
     *
     * @param repo - 仓储
     */
    setChapterRepository(repo: ChapterRepository): void {
        this.chapterRepository = repo;
    }

    // ============================================================
    // 章节预加载
    // ============================================================

    /**
     * 预加载相邻章节
     * @param currentChapterId 当前章节 ID
     * @returns 预加载的章节 ID 列表
     */
    async preloadAdjacentChapters(currentChapterId: string): Promise<string[]> {
        if (!this.options.enabled || !this.chapterRepository) return [];

        const adjacent = this.getAdjacentChapterIds(currentChapterId);
        const toPreload = adjacent.filter(id =>
            !this.chapterCache.has(id) && !this.preloadingChapters.has(id)
        );

        if (toPreload.length === 0) return [];

        for (const id of toPreload) {
            this.preloadingChapters.add(id);
        }

        try {
            await Promise.all(
                toPreload.map(async (id) => {
                    try {
                        const chapter = await this.chapterRepository!.findById(id);
                        if (chapter) {
                            this.chapterCache.set(id, chapter);
                        }
                    } catch {
                        // 静默失败，不影响主流程
                    } finally {
                        this.preloadingChapters.delete(id);
                    }
                })
            );
        } catch {
            // 静默失败
        }

        return toPreload;
    }

    /**
     * 从缓存获取章节（未命中返回 null）
     * @param chapterId - 章节ID
      * @returns Chapter 或 null
     */
    getCachedChapter(chapterId: string): Chapter | null {
        const cached = this.chapterCache.get(chapterId);
        if (cached) {
            this.stats.chapterCacheHits++;
            return cached;
        }
        this.stats.chapterCacheMisses++;
        return null;
    }

    /**
     * 将章节放入预加载缓存
     * @param chapter - 章节
     */
    cacheChapter(chapter: Chapter): void {
        this.chapterCache.set(chapter.id, chapter);
    }

    /**
     * 失效章节缓存
     * @param chapterId - 章节ID
     */
    invalidateChapter(chapterId: string): void {
        this.chapterCache.delete(chapterId);
    }

    private getAdjacentChapterIds(currentId: string): string[] {
        const parsed = this.parseChapterId(currentId);
        if (!parsed) return [];

        const { volN, chapN } = parsed;
        const result: string[] = [];
        const count = this.options.adjacentChapterCount;

        for (let i = 1; i <= count; i++) {
            if (chapN - i >= 1) {
                result.push(this.buildChapterId(volN, chapN - i));
            }
        }

        for (let i = 1; i <= count; i++) {
            result.push(this.buildChapterId(volN, chapN + i));
        }

        return result;
    }

    private parseChapterId(chapterId: string): { volN: number; chapN: number } | null {
        const match = chapterId.match(/^v(\d+)-c(\d+)$/);
        if (!match) return null;
        return {
            volN: parseInt(match[1], 10),
            chapN: parseInt(match[2], 10),
        };
    }

    private buildChapterId(volN: number, chapN: number): string {
        return `v${volN}-c${chapN}`;
    }

    // ============================================================
    // 实体懒加载
    // ============================================================

    /**
     * 注册实体加载器
     * @param entityType 实体类型标识
     * @param loader 加载函数
     * @param cacheSize 缓存大小
     */
    registerEntityLoader<T>(
        entityType: string,
        loader: LazyEntityLoader<T>,
        cacheSize?: number
    ): void {
        this.entityLoaders.set(entityType, loader);
        this.entityCaches.set(
            entityType,
            new LruCache<string, T>({ maxSize: cacheSize || this.options.entityCacheSize })
        );
    }

    /**
     * 懒加载实体（带缓存）
     * @param entityType 实体类型
     * @param entityId 实体 ID
      * @returns T 或 null
     */
    async lazyLoadEntity<T>(entityType: string, entityId: string): Promise<T | null> {
        if (!this.options.enabled) {
            const loader = this.entityLoaders.get(entityType);
            return loader ? loader(entityId) : null;
        }

        const cache = this.entityCaches.get(entityType);
        if (cache) {
            const cached = cache.get(entityId);
            if (cached !== undefined) {
                this.stats.entityCacheHits++;
                return cached as T;
            }
        }

        this.stats.entityCacheMisses++;

        const loader = this.entityLoaders.get(entityType);
        if (!loader) return null;

        try {
            const entity = await loader(entityId);
            if (entity && cache) {
                cache.set(entityId, entity);
            }
            return entity;
        } catch {
            return null;
        }
    }

    /**
     * 批量懒加载实体
     * @param entityType 实体类型
     * @param entityIds 实体 ID 列表
     * @returns 结果数组
     */
    async lazyLoadEntities<T>(entityType: string, entityIds: string[]): Promise<T[]> {
        const results = await Promise.all(
            entityIds.map(id => this.lazyLoadEntity<T>(entityType, id))
        );
        return results.filter((e): e is Awaited<T> => e !== null) as T[];
    }

    /**
     * 失效实体缓存
     * @param entityType - 实体类型
     * @param entityId - 实体ID
     */
    invalidateEntity(entityType: string, entityId: string): void {
        const cache = this.entityCaches.get(entityType);
        if (cache) {
            cache.delete(entityId);
        }
    }

    /**
     * 失效某类型所有实体缓存
     * @param entityType - 实体类型
     */
    invalidateEntityType(entityType: string): void {
        const cache = this.entityCaches.get(entityType);
        if (cache) {
            cache.clear();
        }
    }

    // ============================================================
    // 空闲任务队列
    // ============================================================

    /**
     * 添加空闲任务
     * @param task 任务配置
     * @returns 任务 ID
     */
    enqueueIdleTask(task: Omit<IdleTask, 'createdAt'>): string {
        if (!this.options.enabled) return task.id;

        if (this.idleQueue.length >= this.options.idleQueueMaxSize) {
            this.idleQueue.sort((a, b) => b.priority - a.priority);
            this.idleQueue.pop();
        }

        const newTask: IdleTask = {
            ...task,
            createdAt: Date.now(),
        };

        this.idleQueue.push(newTask);
        this.idleQueue.sort((a, b) => b.priority - a.priority);

        this.startIdleProcessor();

        return task.id;
    }

    /**
     * 取消空闲任务
     * @param taskId - 任务ID
     * @returns 是否成功
     */
    cancelIdleTask(taskId: string): boolean {
        const index = this.idleQueue.findIndex(t => t.id === taskId);
        if (index !== -1) {
            this.idleQueue.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * 清空空闲队列
     */
    clearIdleQueue(): void {
        this.idleQueue = [];
    }

    /**
     * 获取空闲队列长度
     * @returns 数值结果
     */
    getIdleQueueSize(): number {
        return this.idleQueue.length;
    }

    private startIdleProcessor(): void {
        if (this.idleTimer !== null) return;
        if (!this.options.enabled) return;

        const processNext = () => {
            if (!this.options.enabled || this.idleQueue.length === 0) {
                this.idleTimer = null;
                return;
            }

            const task = this.idleQueue.shift();
            if (!task) {
                this.idleTimer = null;
                return;
            }

            Promise.resolve()
                .then(() => task.execute())
                .then(() => {
                    this.stats.idleTasksExecuted++;
                })
                .catch(() => {
                    // 静默失败
                })
                .finally(() => {
                    this.idleTimer = setTimeout(processNext, 50) as unknown as number;
                });
        };

        this.idleTimer = setTimeout(processNext, 100) as unknown as number;
    }

    private stopIdleProcessor(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    // ============================================================
    // 行为预测
    // ============================================================

    /**
     * 记录用户行为
     * @param behavior - 行为
     */
    recordBehavior(behavior: Omit<UserBehavior, 'timestamp'>): void {
        const entry: UserBehavior = {
            ...behavior,
            timestamp: Date.now(),
        };

        this.behaviorHistory.push(entry);

        if (this.behaviorHistory.length > this.options.behaviorHistoryMaxSize) {
            this.behaviorHistory.shift();
        }
    }

    /**
     * 基于用户行为预测下一步操作，提前预热数据
     * @param currentBehavior 当前行为
     * @returns 预测结果与预热状态
     */
    async predictNextAction(currentBehavior: Omit<UserBehavior, 'timestamp'>): Promise<{
        predicted: string[];
        prewarmed: string[];
    }> {
        this.stats.predictionsTotal++;

        const predicted: string[] = [];
        const prewarmed: string[] = [];

        if (!this.options.enabled) {
            return { predicted, prewarmed };
        }

        this.recordBehavior(currentBehavior);

        if (currentBehavior.action === 'navigate' && currentBehavior.chapterId) {
            const adjacent = await this.preloadAdjacentChapters(currentBehavior.chapterId);
            predicted.push(...this.getAdjacentChapterIds(currentBehavior.chapterId));
            prewarmed.push(...adjacent);

            if (adjacent.length > 0) {
                this.stats.predictionsHit++;
            }
        }

        if (currentBehavior.action === 'edit' && currentBehavior.entityId) {
            this.enqueueIdleTask({
                id: `preload-entity-relations-${currentBehavior.entityId}`,
                priority: 2,
                description: `预加载实体 ${currentBehavior.entityId} 的关联数据`,
                execute: () => {
                    // 由调用方注册具体任务
                },
            });
        }

        const patternPrediction = this.analyzeBehaviorPattern();
        if (patternPrediction) {
            predicted.push(patternPrediction);
        }

        return { predicted, prewarmed };
    }

    private analyzeBehaviorPattern(): string | null {
        if (this.behaviorHistory.length < 3) return null;

        const recent = this.behaviorHistory.slice(-5);
        const chapterNavigations = recent.filter(
            b => b.action === 'navigate' && b.chapterId
        );

        if (chapterNavigations.length >= 3) {
            const ids = chapterNavigations.map(b => this.parseChapterId(b.chapterId!)).filter(Boolean);
            if (ids.length >= 3) {
                const allIncrementing = ids.every((id, i) =>
                    i === 0 || (id!.chapN === ids[i - 1]!.chapN + 1 && id!.volN === ids[i - 1]!.volN)
                );

                if (allIncrementing) {
                    const last = ids[ids.length - 1]!;
                    return this.buildChapterId(last.volN, last.chapN + 1);
                }

                const allDecrementing = ids.every((id, i) =>
                    i === 0 || (id!.chapN === ids[i - 1]!.chapN - 1 && id!.volN === ids[i - 1]!.volN)
                );

                if (allDecrementing) {
                    const last = ids[ids.length - 1]!;
                    if (last.chapN - 1 >= 1) {
                        return this.buildChapterId(last.volN, last.chapN - 1);
                    }
                }
            }
        }

        return null;
    }

    // ============================================================
    // 统计与诊断
    // ============================================================

    /**
     * 读取统计。
     * @returns 统计
     */
    getStats(): PreloadStats {
        return { ...this.stats };
    }

    /**
     * 章节缓存统计。
     * @returns 统计
     */
    getChapterCacheStats(): { size: number; maxSize: number; hitRate: number } {
        const total = this.stats.chapterCacheHits + this.stats.chapterCacheMisses;
        return {
            size: this.chapterCache.size,
            maxSize: this.options.chapterCacheSize,
            hitRate: total > 0 ? this.stats.chapterCacheHits / total : 0,
        };
    }

    /**
     * 实体缓存统计。
     *
     * @param entityType - 实体类型
     * @returns 统计
     */
    getEntityCacheStats(entityType: string): { size: number; hitRate: number } | null {
        const cache = this.entityCaches.get(entityType);
        if (!cache) return null;

        const total = this.stats.entityCacheHits + this.stats.entityCacheMisses;
        return {
            size: cache.size,
            hitRate: total > 0 ? this.stats.entityCacheHits / total : 0,
        };
    }

    /**
     * 重置统计。
     */
    resetStats(): void {
        this.stats = {
            chapterCacheHits: 0,
            chapterCacheMisses: 0,
            entityCacheHits: 0,
            entityCacheMisses: 0,
            idleTasksExecuted: 0,
            predictionsHit: 0,
            predictionsTotal: 0,
        };
    }
}

/**
 * 全局预加载管理器实例。
 */
export const preloadManager = new PreloadManager();
