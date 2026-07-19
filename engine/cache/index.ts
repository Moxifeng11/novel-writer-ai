/**
 * cache/index.ts — 缓存模块导出入口
 */

export { FileCache } from './file-cache';
export type { FileCacheOptions, FileCacheEntry } from './file-cache';

export { MultiLayerCache } from './multi-layer-cache';
export type {
    MultiLayerCacheOptions,
    CacheSetOptions,
    CacheStats,
    CacheTier,
    ProjectSizeTier,
} from './multi-layer-cache';

export { PreloadManager, preloadManager } from './preload-manager';
export type {
    PreloadManagerOptions,
    UserBehavior,
    IdleTask,
    PreloadStats,
} from './preload-manager';
