/**
 * repository/base-markdown-repository.ts — 基于 Markdown + Frontmatter 的仓储基类
 *
 * 特性：
 * - 基于 FileSystemPort 抽象，与 Obsidian 平台解耦
 * - 封装 Markdown + frontmatter 的通用读写逻辑
 * - 内置 LRU 缓存层，支持按路径、按时间的缓存失效
 * - 实现 IRepository + IBulkRepository 接口
 *
 * 子类需要实现的抽象方法：
 * - idFromEntity(entity): TId          从实体提取 ID
 * - filePathFromId(id): string          ID → 文件路径映射
 * - deserialize(content, filePath): T   Markdown → 实体
 * - serialize(entity): string           实体 → Markdown
 *
 * 使用方式：
 *   class CharacterRepository extends BaseMarkdownRepository<CharacterDomainModel, string> {
 *       protected idFromEntity(e: CharacterDomainModel): string { return e.id; }
 *       protected filePathFromId(id: string): string { return `characters/${id}.md`; }
 *       protected deserialize(content: string, filePath: string): CharacterDomainModel {
 *           return characterFromMarkdown(content, filePath);
 *       }
 *       protected serialize(entity: CharacterDomainModel): string {
 *           return characterToMarkdown(entity);
 *       }
 *   }
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { LruCache } from '../../shared/lru-cache';
import type { IRepository, IBulkRepository, BulkResult, BulkFailure } from './interfaces';
import type { MultiLayerCache } from '../cache';

// ============================================================
// 一、配置选项
// ============================================================

/**
 * Markdown 仓储基类选项。
 */
export interface BaseMarkdownRepositoryOptions {
    /** 缓存最大条目数，默认 100 */
    cacheMaxSize?: number;
    /** 缓存 TTL（毫秒），默认 5 分钟，0 表示永不过期 */
    cacheTtlMs?: number;
    /** 是否启用缓存，默认 true */
    cacheEnabled?: boolean;
    /** 多层缓存（可选，作为 L2 缓存增强） */
    multiLayerCache?: MultiLayerCache;
    /** 缓存键前缀（用于多层缓存隔离不同仓储） */
    cacheKeyPrefix?: string;
}

// ============================================================
// 二、抽象基类
// ============================================================

/**
 * 基于 Markdown 文件的仓储抽象基类
 *
 * @typeParam T    实体类型
 * @typeParam TId  实体 ID 类型（通常为 string）
 */
export abstract class BaseMarkdownRepository<T, TId = string>
    implements IBulkRepository<T, TId>
{
    protected readonly fs: FileSystemPort;
    protected readonly cache: LruCache<string, T> | null;
    protected readonly multiLayerCache: MultiLayerCache | null;
    protected readonly cacheKeyPrefix: string;
    protected readonly options: Required<BaseMarkdownRepositoryOptions>;

    constructor(fs: FileSystemPort, options: BaseMarkdownRepositoryOptions = {}) {
        this.fs = fs;
        this.options = {
            cacheMaxSize: options.cacheMaxSize ?? 100,
            cacheTtlMs: options.cacheTtlMs ?? 5 * 60 * 1000,
            cacheEnabled: options.cacheEnabled ?? true,
            multiLayerCache: options.multiLayerCache ?? undefined,
            cacheKeyPrefix: options.cacheKeyPrefix ?? '',
        } as Required<BaseMarkdownRepositoryOptions>;

        this.cache = this.options.cacheEnabled
            ? new LruCache<string, T>({
                  maxSize: this.options.cacheMaxSize,
                  ttlMs: this.options.cacheTtlMs,
              })
            : null;

        this.multiLayerCache = options.multiLayerCache ?? null;
        this.cacheKeyPrefix = options.cacheKeyPrefix ?? '';
    }

    // ============================================================
    // 抽象方法（子类必须实现）
    // ============================================================

    /** 从实体中提取 ID */
    protected abstract idFromEntity(entity: T): TId;

    /** 将 ID 映射为文件路径（相对于 vault 根目录） */
    protected abstract filePathFromId(id: TId): string;

    /** 从 Markdown 内容反序列化为实体 */
    protected abstract deserialize(content: string, filePath: string): T;

    /** 将实体序列化为 Markdown 内容 */
    protected abstract serialize(entity: T): string;

    // ============================================================
    // IRepository 接口实现
    // ============================================================

    /**
     * 根据 ID 查找实体
     * 优先从 L1 缓存读取，其次 L2 多层缓存，最后读取文件
     */
    async findById(id: TId): Promise<T | null> {
        const filePath = this.filePathFromId(id);
        const mlcKey = `${this.cacheKeyPrefix}${filePath}`;

        if (this.cache) {
            const cached = this.cache.get(filePath);
            if (cached !== undefined) {
                return cached;
            }
        }

        if (this.multiLayerCache) {
            const mlcCached = await this.multiLayerCache.get<T>(mlcKey);
            if (mlcCached !== null) {
                if (this.cache) {
                    this.cache.set(filePath, mlcCached);
                }
                return mlcCached;
            }
        }

        try {
            const content = await this.fs.read(filePath);
            const entity = this.deserialize(content, filePath);

            if (this.cache) {
                this.cache.set(filePath, entity);
            }
            if (this.multiLayerCache) {
                await this.multiLayerCache.set(mlcKey, entity);
            }

            return entity;
        } catch (e) {
            return null;
        }
    }

    /**
     * 查找所有实体
     * 扫描目录下所有 .md 文件并转换为实体
     *
     * 注意：子类可以覆盖此方法以提供更高效的目录扫描实现
     */
    async findAll(): Promise<T[]> {
        const basePath = this.getBasePath();
        const files = await this.fs.listFiles(basePath);
        const mdFiles = files.filter(f => f.path.endsWith('.md'));

        const results: T[] = [];
        for (const file of mdFiles) {
            const entity = await this.findById(this.idFromFilePath(file.path));
            if (entity) {
                results.push(entity);
            }
        }

        return results;
    }

    /**
     * 保存实体（新增或更新）
     * 保存后更新缓存
     */
    async save(entity: T): Promise<T> {
        const id = this.idFromEntity(entity);
        const filePath = this.filePathFromId(id);
        const mlcKey = `${this.cacheKeyPrefix}${filePath}`;
        const content = this.serialize(entity);

        await this.ensureParentDir(filePath);
        await this.fs.write(filePath, content);

        if (this.cache) {
            this.cache.set(filePath, entity);
        }
        if (this.multiLayerCache) {
            await this.multiLayerCache.set(mlcKey, entity);
        }

        return entity;
    }

    /**
     * 根据 ID 删除实体
     * 删除后同时清除缓存
     */
    async delete(id: TId): Promise<boolean> {
        const filePath = this.filePathFromId(id);
        const mlcKey = `${this.cacheKeyPrefix}${filePath}`;

        try {
            const exists = await this.fs.exists(filePath);
            if (!exists) return false;

            await this.fs.delete(filePath);

            if (this.cache) {
                this.cache.delete(filePath);
            }
            if (this.multiLayerCache) {
                await this.multiLayerCache.invalidate(mlcKey);
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 检查实体是否存在
     * 优先检查缓存，再检查文件系统
     */
    async exists(id: TId): Promise<boolean> {
        const filePath = this.filePathFromId(id);

        if (this.cache && this.cache.has(filePath)) {
            return true;
        }

        return await this.fs.exists(filePath);
    }

    // ============================================================
    // IBulkRepository 接口实现
    // ============================================================

    /**
     * 批量保存实体
     * 按顺序逐个执行，失败记录错误，不中断后续操作
     */
    async saveAll(entities: T[]): Promise<BulkResult<T>> {
        const success: T[] = [];
        const failures: BulkFailure<T>[] = [];

        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            try {
                const saved = await this.save(entity);
                success.push(saved);
            } catch (error) {
                failures.push({
                    item: entity,
                    error: error instanceof Error ? error : new Error(String(error)),
                    index: i,
                });
            }
        }

        return {
            success,
            failures,
            successCount: success.length,
            failureCount: failures.length,
        };
    }

    /**
     * 批量删除实体
     * 按顺序逐个执行，失败记录错误，不中断后续操作
     */
    async deleteAll(ids: TId[]): Promise<BulkResult<TId>> {
        const success: TId[] = [];
        const failures: BulkFailure<TId>[] = [];

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            try {
                const deleted = await this.delete(id);
                if (deleted) {
                    success.push(id);
                } else {
                    failures.push({
                        item: id,
                        error: new Error(`Entity not found: ${String(id)}`),
                        index: i,
                    });
                }
            } catch (error) {
                failures.push({
                    item: id,
                    error: error instanceof Error ? error : new Error(String(error)),
                    index: i,
                });
            }
        }

        return {
            success,
            failures,
            successCount: success.length,
            failureCount: failures.length,
        };
    }

    /**
     * 批量查找实体
     * 返回所有找到的实体，未找到的不包含在结果中
     */
    async findAllById(ids: TId[]): Promise<T[]> {
        const results: T[] = [];

        for (const id of ids) {
            const entity = await this.findById(id);
            if (entity) {
                results.push(entity);
            }
        }

        return results;
    }

    // ============================================================
    // 缓存管理
    // ============================================================

    /** 清空所有缓存 */
    clearCache(): void {
        if (this.cache) {
            this.cache.clear();
        }
        if (this.multiLayerCache) {
            this.multiLayerCache.invalidateByPrefix(this.cacheKeyPrefix).catch(() => {});
        }
    }

    /** 使指定 ID 的缓存失效 */
    invalidateCache(id: TId): void {
        if (this.cache) {
            const filePath = this.filePathFromId(id);
            this.cache.delete(filePath);
        }
        if (this.multiLayerCache) {
            const filePath = this.filePathFromId(id);
            const mlcKey = `${this.cacheKeyPrefix}${filePath}`;
            this.multiLayerCache.invalidate(mlcKey).catch(() => {});
        }
    }

    /** 使指定前缀的所有缓存失效（如目录级失效） */
    invalidateCacheByPrefix(prefix: string): void {
        if (this.cache) {
            this.cache.deleteByPrefix(prefix);
        }
        if (this.multiLayerCache) {
            const mlcPrefix = `${this.cacheKeyPrefix}${prefix}`;
            this.multiLayerCache.invalidateByPrefix(mlcPrefix).catch(() => {});
        }
    }

    /** 清理已过期的缓存条目 */
    pruneExpiredCache(): number {
        if (this.cache) {
            return this.cache.pruneExpired();
        }
        return 0;
    }

    /** 当前缓存条目数 */
    get cacheSize(): number {
        return this.cache?.size ?? 0;
    }

    // ============================================================
    // 辅助方法（可被子类覆盖）
    // ============================================================

    /**
     * 获取基础目录路径
     * 默认从 filePathFromId 推断（取第一个文件的目录）
     * 子类可以覆盖以提供更准确的基础路径
     */
    protected getBasePath(): string {
        const samplePath = this.filePathFromId(this.sampleId());
        const parts = samplePath.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    }

    /**
     * 从文件路径提取 ID
     * 默认实现：取文件名（不含 .md 后缀）
     * 子类可以覆盖以实现不同的 ID 映射策略
     */
    protected idFromFilePath(filePath: string): TId {
        const fileName = filePath.split('/').pop() || '';
        const id = fileName.replace(/\.md$/, '');
        return id as unknown as TId;
    }

    /**
     * 确保父目录存在
     */
    protected async ensureParentDir(filePath: string): Promise<void> {
        const parts = filePath.split('/');
        if (parts.length > 1) {
            const dirPath = parts.slice(0, -1).join('/');
            await this.fs.mkdir(dirPath);
        }
    }

    /**
     * 生成一个示例 ID（用于推断基础路径）
     * 默认返回空字符串，子类可覆盖
     */
    protected sampleId(): TId {
        return '' as unknown as TId;
    }
}
