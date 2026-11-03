/**
 * cache/index.ts — 缓存模块导出入口
 */

export { FileCache } from '@/shared/file-cache';
export type { FileCacheOptions, FileCacheEntry } from '@/shared/file-cache';

export { MultiLayerCache } from '@/shared/multi-layer-cache';
export type {
    MultiLayerCacheOptions,
    CacheSetOptions,
    CacheStats,
    CacheTier,
    ProjectSizeTier,
} from '@/shared/multi-layer-cache';

export { PreloadManager, preloadManager } from './preload-manager';
export type {
    PreloadManagerOptions,
    UserBehavior,
    IdleTask,
    PreloadStats,
} from './preload-manager';
