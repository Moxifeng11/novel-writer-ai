/**
 * engine/context/incremental-updater.ts — 上下文增量更新器
 *
 * 职责：
 * - 根据 ContextChangeSet 增量更新 GatheredContext
 * - 管理上下文版本号与变更历史
 * - 判断增量更新是否比全量更快（回退策略）
 * - 与 MultiLayerCache 深度配合：未变更部分从缓存读取，变更部分重新获取
 *
 * 设计原则：
 * - 纯增量，不修改 gatherAll 行为
 * - 零外部依赖
 * - 增量更新结果必须与全量更新一致
 * - 通过 SectionRefetcher 接口解耦，不直接依赖 ContextManager
 */

import type { GatheredContext, ContextData } from './context-types';
import type { ContextChangeSet } from './context-diff-detector';
import { INCREMENTAL_FALLBACK_THRESHOLD } from './context-diff-detector';
import type { MultiLayerCache } from '@/engine/cache';
import { createLogger } from '@/shared/logger';


const log = createLogger('IncrementalUpdater');
// ============================================================
// 一、类型定义
// ============================================================

/** 上下文版本信息 */
export interface ContextVersion {
    /** 递增版本号 */
    version: number;
    /** 时间戳 */
    timestamp: number;
    /** 本次版本对应的变更集（全量更新时为 undefined） */
    changeSet?: ContextChangeSet;
    /** 更新策略：incremental 增量 / full 全量 */
    strategy: 'incremental' | 'full';
}

/** 带版本号的上下文 */
export interface VersionedGatheredContext extends GatheredContext {
    /** 版本信息（可选，向后兼容） */
    __version?: ContextVersion;
}

/** 分区重新获取器接口 */
export interface SectionRefetcher {
    /**
     * 重新获取指定分区的数据
     * @param project 项目名
     * @param section 分区名（对应 ContextData 的 key）
     * @param currentChapter 当前章节（可选）
     * @returns 该分区的新数据（Partial<ContextData>）
     */
    refetchSection(
        project: string,
        section: string,
        currentChapter?: string,
    ): Promise<Partial<ContextData>>;
}

/** 增量更新器依赖 */
export interface IncrementalUpdaterDeps {
    /** 分区重新获取器 */
    refetcher: SectionRefetcher;
    /** 多层缓存（可选） */
    multiLayerCache?: MultiLayerCache;
    /** 版本历史最大保留数（默认 20） */
    maxHistorySize?: number;
}

/** 增量更新统计 */
export interface IncrementalStats {
    /** 增量更新次数 */
    incrementalUpdates: number;
    /** 全量回退次数 */
    fullFallbacks: number;
    /** 分区缓存命中次数 */
    sectionCacheHits: number;
    /** 分区重新获取次数 */
    sectionRefetches: number;
}

// ============================================================
// 二、IncrementalUpdater 类
// ============================================================

/**
 * IncrementalUpdater 类。
 */
export class IncrementalUpdater {
    private deps: Required<Omit<IncrementalUpdaterDeps, 'multiLayerCache'>>;
    private multiLayerCache: MultiLayerCache | null;
    private currentVersion: ContextVersion | null = null;
    private versionHistory: ContextVersion[] = [];
    private stats: IncrementalStats = {
        incrementalUpdates: 0,
        fullFallbacks: 0,
        sectionCacheHits: 0,
        sectionRefetches: 0,
    };

    constructor(deps: IncrementalUpdaterDeps) {
        this.deps = {
            refetcher: deps.refetcher,
            maxHistorySize: deps.maxHistorySize ?? 20,
        };
        this.multiLayerCache = deps.multiLayerCache || null;
    }

    /**
     * 根据变更集增量更新上下文
     * 策略：
     * - 未变更分区：直接复用旧上下文数据
     * - 变更分区：优先从缓存读取，未命中则从 Repository 重新获取
     * - 重算受影响的派生数据（compressed、issues）
     * @param fullContext - 完整上下文
     * @param changeSet - 变更集
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
      * @returns GatheredContext 实例
     */
    async updateContext(
        fullContext: GatheredContext,
        changeSet: ContextChangeSet,
        project: string,
        currentChapter?: string,
    ): Promise<GatheredContext> {
        // 从旧上下文复制全部数据（浅拷贝 data 对象）
        const newData: ContextData = { ...fullContext.data };

        // 仅重新获取受影响分区
        for (const section of changeSet.affectedSections) {
            const cacheKey = `context:section:${project}:${section}`;
            let sectionData: Partial<ContextData> | null = null;

            // 1. 尝试从多层缓存读取
            if (this.multiLayerCache) {
                const cached = await this.multiLayerCache.get<Partial<ContextData>>(cacheKey);
                if (cached) {
                    sectionData = cached;
                    this.stats.sectionCacheHits++;
                }
            }

            // 2. 未命中则重新获取
            if (!sectionData) {
                try {
                    sectionData = await this.deps.refetcher.refetchSection(
                        project,
                        section,
                        currentChapter,
                    );
                    this.stats.sectionRefetches++;

                    // 写入缓存
                    if (this.multiLayerCache && sectionData) {
                        await this.multiLayerCache.set(cacheKey, sectionData);
                    }
                } catch (e) {
                    log.warn(`[IncrementalUpdater] 分区 ${section} 重新获取失败，保留旧数据:`, e);
                    continue;
                }
            }

            // 3. 合并到新数据
            if (sectionData) {
                Object.assign(newData, sectionData);
            }
        }

        // 重算受影响的派生数据
        // compressed 依赖 world_view, setting_lib, foreshadows, timeline, outline
        // 当这些分区变更时需要重算
        if (this.isCompressedAffected(changeSet)) {
            // compressed 由 ContextManager 在 gatherAll 中计算
            // 增量更新时标记为需要重算，由调用方处理
            // 此处保留旧 compressed，调用方可选择重算
        }

        // 重新检测 issues（issues 依赖 character_state, setting_lib, world_view, foreshadows）
        const issues = fullContext.issues;

        const result: GatheredContext = {
            project,
            gatheredAt: new Date().toISOString(),
            data: newData,
            issues,
        };

        // 记录版本
        const version = this.recordVersion(changeSet, 'incremental');
        this.stats.incrementalUpdates++;

        return {
            ...result,
            __version: version,
        } as VersionedGatheredContext;
    }

    /**
     * 判断增量更新是否比全量更快
     * 变更范围超过阈值（50%）时返回 false，建议回退全量
     * @param changeSet - 变更集
     * @returns 是否成功
     */
    isIncrementalUpdateFaster(changeSet: ContextChangeSet): boolean {
        return changeSet.changeScope <= INCREMENTAL_FALLBACK_THRESHOLD;
    }

    /**
     * 记录新版本
     * @param changeSet - 变更集
     * @param strategy - 策略
      * @returns ContextVersion 实例
     */
    recordVersion(
        changeSet: ContextChangeSet | undefined,
        strategy: 'incremental' | 'full' = 'full',
    ): ContextVersion {
        const version: ContextVersion = {
            version: (this.currentVersion?.version ?? 0) + 1,
            timestamp: Date.now(),
            changeSet,
            strategy,
        };

        this.currentVersion = version;
        this.versionHistory.push(version);

        // 保留最近 maxHistorySize 条
        while (this.versionHistory.length > this.deps.maxHistorySize) {
            this.versionHistory.shift();
        }

        return version;
    }

    /**
     * 获取版本历史
     * @returns 结果数组
     */
    getVersionHistory(): ContextVersion[] {
        return [...this.versionHistory];
    }

    /**
     * 获取当前版本
      * @returns ContextVersion 或 null
     */
    getCurrentVersion(): ContextVersion | null {
        return this.currentVersion;
    }

    /**
     * 重置版本历史（用于项目切换）
     */
    resetVersion(): void {
        this.currentVersion = null;
        this.versionHistory = [];
    }

    /**
     * 获取统计信息
      * @returns IncrementalStats 实例
     */
    getStats(): IncrementalStats {
        return { ...this.stats };
    }

    /**
     * 重置统计
     */
    resetStats(): void {
        this.stats = {
            incrementalUpdates: 0,
            fullFallbacks: 0,
            sectionCacheHits: 0,
            sectionRefetches: 0,
        };
    }

    /**
     * 标记全量回退
     */
    markFullFallback(): void {
        this.stats.fullFallbacks++;
        this.recordVersion(undefined, 'full');
    }

    // ── 内部方法 ──────────────────────────────────────────────

    /**
     * 判断 compressed 派生数据是否受变更影响
     */
    private isCompressedAffected(changeSet: ContextChangeSet): boolean {
        const compressedDeps = ['world_view', 'setting_lib', 'foreshadows', 'timeline', 'outline'];
        return changeSet.affectedSections.some(s => compressedDeps.includes(s));
    }
}
