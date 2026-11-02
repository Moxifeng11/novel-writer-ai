import { TFile } from 'obsidian';
import { FileSystemPort, VaultMetaPort } from '../shared/file-system-port';
import { getWorldviewPath, getSettingLibPath, pjItemsDir } from '../shared/paths';
import { entityDir } from '../shared/entity-reader';
import { performanceMonitor } from './performance-monitor';
import { createLogger } from '../shared/logger';


const log = createLogger('WorldviewCacheService');
/**
 * 缓存条目。
 */
export interface CacheEntry {
    key: string;
    project: string;
    filePath: string;
    rawText: string;
    parsedData?: Record<string, any>;
    mtime: number;
    size: number;
    lastAccessed: number;
    accessCount: number;
}

/**
 * 缓存统计。
 */
export interface CacheStats {
    hitCount: number;
    missCount: number;
    evictCount: number;
    totalEntries: number;
    totalSize: number;
    hitRate: number;
}

/**
 * 缓存选项。
 */
export interface WorldviewCacheOptions {
    maxProjects?: number;
    maxSizePerProjectMB?: number;
}

const DEFAULT_MAX_PROJECTS = 10;
const DEFAULT_MAX_SIZE_PER_PROJECT_MB = 5;
const BYTES_PER_MB = 1024 * 1024;

/**
 * 世界观缓存服务。
 */
export class WorldviewCacheService {
    private cache: Map<string, CacheEntry> = new Map();
    private projectSizes: Map<string, number> = new Map();
    private maxProjects: number;
    private maxSizePerProject: number;
    private stats: CacheStats = {
        hitCount: 0,
        missCount: 0,
        evictCount: 0,
        totalEntries: 0,
        totalSize: 0,
        hitRate: 0,
    };
    private fs: FileSystemPort;
    private vaultMeta: VaultMetaPort;
    private debugMode: boolean = false;

    constructor(
        fs: FileSystemPort,
        vaultMeta: VaultMetaPort,
        options?: WorldviewCacheOptions
    ) {
        this.fs = fs;
        this.vaultMeta = vaultMeta;
        this.maxProjects = options?.maxProjects || DEFAULT_MAX_PROJECTS;
        this.maxSizePerProject = (options?.maxSizePerProjectMB || DEFAULT_MAX_SIZE_PER_PROJECT_MB) * BYTES_PER_MB;
    }

    /**
     * 开关缓存调试模式。
     *
     * @param enabled - 是否启用
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    private makeKey(project: string, filePath: string): string {
        return `${project}:${filePath}`;
    }

    private estimateSize(text: string, parsedData?: Record<string, any>): number {
        let size = text.length * 2;
        if (parsedData) {
            try {
                size += JSON.stringify(parsedData).length * 2;
            } catch {
            }
        }
        return size;
    }

    private updateStats(): void {
        const total = this.stats.hitCount + this.stats.missCount;
        this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
        this.stats.totalEntries = this.cache.size;
        this.stats.totalSize = 0;
        for (const entry of this.cache.values()) {
            this.stats.totalSize += entry.size;
        }
    }

    private evictLRUForProject(project: string, neededSize: number): void {
        const projectEntries: CacheEntry[] = [];
        for (const entry of this.cache.values()) {
            if (entry.project === project) {
                projectEntries.push(entry);
            }
        }
        projectEntries.sort((a, b) => a.lastAccessed - b.lastAccessed);

        let currentSize = this.projectSizes.get(project) || 0;
        for (const entry of projectEntries) {
            if (currentSize + neededSize <= this.maxSizePerProject) {
                break;
            }
            this.cache.delete(entry.key);
            currentSize -= entry.size;
            this.stats.evictCount++;
            if (this.debugMode) {
                log.info(`[WorldviewCache] Evicted: ${entry.filePath}`);
            }
        }
        this.projectSizes.set(project, currentSize);
    }

    private evictProjectIfNeeded(): void {
        if (this.cache.size <= this.maxProjects) return;

        const projectAccess: Map<string, number> = new Map();
        for (const entry of this.cache.values()) {
            const last = projectAccess.get(entry.project) || 0;
            if (entry.lastAccessed > last) {
                projectAccess.set(entry.project, entry.lastAccessed);
            }
        }

        const sortedProjects = Array.from(projectAccess.entries())
            .sort((a, b) => a[1] - b[1]);

        while (sortedProjects.length > this.maxProjects) {
            const [oldestProject] = sortedProjects.shift()!;
            this.invalidateProject(oldestProject);
        }
    }

    private async getFileMtime(filePath: string): Promise<number> {
        const file = this.vaultMeta.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            return file.stat?.mtime || 0;
        }
        return 0;
    }

    /**
     * 读取缓存。
     *
     * @param project - 项目（路径或对象）
     * @param filePath - 文件路径
     * @param parser - 参数
     * @param any> - 参数
     * @returns 值或 null
     */
    async get(
        project: string,
        filePath: string,
        parser?: (text: string) => Record<string, any>
    ): Promise<{ rawText: string; parsedData?: Record<string, any>; fromCache: boolean }> {
        const perfId = performanceMonitor.start('cacheGet', 'cacheRead', undefined, { project, filePath });
        try {
            const key = this.makeKey(project, filePath);
            const mtime = await this.getFileMtime(filePath);

            let entry = this.cache.get(key);

            if (entry && entry.mtime === mtime && mtime > 0) {
                entry.lastAccessed = Date.now();
                entry.accessCount++;
                this.stats.hitCount++;
                this.updateStats();
                if (this.debugMode) {
                    log.info(`[WorldviewCache] HIT: ${filePath}`);
                }
                performanceMonitor.end(perfId, { hit: true });
                return {
                    rawText: entry.rawText,
                    parsedData: entry.parsedData,
                    fromCache: true,
                };
            }

            this.stats.missCount++;
            this.updateStats();

            if (this.debugMode) {
                log.info(`[WorldviewCache] MISS: ${filePath}`);
            }

            let rawText = '';
            try {
                rawText = await this.fs.read(filePath);
            } catch {
                performanceMonitor.end(perfId, { hit: false, error: 'read_failed' });
                return { rawText: '', fromCache: false };
            }

            let parsedData: Record<string, any> | undefined;
            if (parser) {
                try {
                    parsedData = parser(rawText);
                } catch {
                    parsedData = undefined;
                }
            }

            const size = this.estimateSize(rawText, parsedData);

            const currentProjectSize = this.projectSizes.get(project) || 0;
            if (size > this.maxSizePerProject) {
                performanceMonitor.end(perfId, { hit: false, size });
                return { rawText, parsedData, fromCache: false };
            }

            if (currentProjectSize + size > this.maxSizePerProject) {
                this.evictLRUForProject(project, size);
            }

            const newEntry: CacheEntry = {
                key,
                project,
                filePath,
                rawText,
                parsedData,
                mtime: mtime || Date.now(),
                size,
                lastAccessed: Date.now(),
                accessCount: 1,
            };

            // 驱逐已经改写过 projectSizes；必须以驱逐后的值为基准，
            // 否则会按旧值回写，把刚驱逐掉的字节重新加回来（记账漂移）。
            const baseSize = this.projectSizes.get(project) || 0;
            const replacedSize = this.cache.get(key)?.size || 0;
            this.cache.set(key, newEntry);
            this.projectSizes.set(project, baseSize - replacedSize + size);

            this.evictProjectIfNeeded();
            this.updateStats();

            performanceMonitor.end(perfId, { hit: false, size });
            return { rawText, parsedData, fromCache: false };
        } catch (e) {
            performanceMonitor.end(perfId, { error: String(e) });
            throw e;
        }
    }

    /**
     * 写入缓存。
     *
     * @param project - 项目（路径或对象）
     * @param filePath - 文件路径
     * @param rawText - 原始文本
     * @param parsedData - 参数
     */
    async set(
        project: string,
        filePath: string,
        rawText: string,
        parsedData?: Record<string, any>
    ): Promise<void> {
        const perfId = performanceMonitor.start('cacheSet', 'cacheWrite', undefined, { project, filePath });
        try {
            const key = this.makeKey(project, filePath);
            const size = this.estimateSize(rawText, parsedData);
            const mtime = await this.getFileMtime(filePath);

            if (size > this.maxSizePerProject) {
                performanceMonitor.end(perfId, { size, skipped: true });
                return;
            }

            const currentProjectSize = this.projectSizes.get(project) || 0;
            const existingEntry = this.cache.get(key);
            const oldSize = existingEntry?.size || 0;

            if (currentProjectSize - oldSize + size > this.maxSizePerProject) {
                this.evictLRUForProject(project, size - oldSize);
            }

            const newEntry: CacheEntry = {
                key,
                project,
                filePath,
                rawText,
                parsedData,
                mtime: mtime || Date.now(),
                size,
                lastAccessed: Date.now(),
                accessCount: existingEntry ? existingEntry.accessCount + 1 : 1,
            };

            // 同上：驱逐会重写 projectSizes，回写必须用驱逐后的基数与被驱逐后是否仍在的旧条目
            const baseSize = this.projectSizes.get(project) || 0;
            const replacedSize = this.cache.get(key)?.size || 0;
            this.cache.set(key, newEntry);
            this.projectSizes.set(project, baseSize - replacedSize + size);
            this.evictProjectIfNeeded();
            this.updateStats();

            if (this.debugMode) {
                log.info(`[WorldviewCache] SET: ${filePath}, size: ${size}`);
            }
            performanceMonitor.end(perfId, { size });
        } catch (e) {
            performanceMonitor.end(perfId, { error: String(e) });
            throw e;
        }
    }

    /**
     * 失效单个文件缓存。
     *
     * @param project - 项目（路径或对象）
     * @param filePath - 文件路径
     */
    invalidate(project: string, filePath: string): void {
        const key = this.makeKey(project, filePath);
        const entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            const currentSize = this.projectSizes.get(project) || 0;
            this.projectSizes.set(project, Math.max(0, currentSize - entry.size));
            this.updateStats();
            if (this.debugMode) {
                log.info(`[WorldviewCache] INVALIDATE: ${filePath}`);
            }
        }
    }

    /**
     * 失效整个项目缓存。
     *
     * @param project - 项目（路径或对象）
     */
    invalidateProject(project: string): void {
        const keysToDelete: string[] = [];
        for (const [key, entry] of this.cache.entries()) {
            if (entry.project === project) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
        this.projectSizes.delete(project);
        this.updateStats();
        if (this.debugMode) {
            log.info(`[WorldviewCache] INVALIDATE PROJECT: ${project}`);
        }
    }

    /**
     * 清空全部缓存。
     */
    clearAll(): void {
        this.cache.clear();
        this.projectSizes.clear();
        this.stats = {
            hitCount: 0,
            missCount: 0,
            evictCount: 0,
            totalEntries: 0,
            totalSize: 0,
            hitRate: 0,
        };
        if (this.debugMode) {
            log.info('[WorldviewCache] CLEAR ALL');
        }
    }

    /**
     * 读取缓存统计。
     * @returns 统计
     */
    getStats(): CacheStats {
        this.updateStats();
        return { ...this.stats };
    }

    /**
     * 读取项目级缓存统计。
     *
     * @param project - 项目（路径或对象）
     * @returns 统计
     */
    getProjectStats(project: string): { entries: number; size: number; files: string[] } {
        let entries = 0;
        let size = 0;
        const files: string[] = [];
        for (const entry of this.cache.values()) {
            if (entry.project === project) {
                entries++;
                size += entry.size;
                files.push(entry.filePath);
            }
        }
        return { entries, size, files };
    }

    /**
     * 预加载项目缓存。
     *
     * @param project - 项目（路径或对象）
     * @returns 统计
     */
    async preloadProject(project: string): Promise<{ loaded: number; totalSize: number }> {
        const filesToPreload = [
            getWorldviewPath(project),
            getSettingLibPath(project),
        ];

        let loaded = 0;
        let totalSize = 0;

        for (const filePath of filesToPreload) {
            try {
                const result = await this.get(project, filePath);
                if (result.rawText) {
                    loaded++;
                    totalSize += result.rawText.length * 2;
                }
            } catch {
            }
        }

        if (this.debugMode) {
            log.info(`[WorldviewCache] PRELOAD project=${project}, loaded=${loaded}, size=${totalSize}`);
        }

        return { loaded, totalSize };
    }

    /**
     * 读取世界观（可附解析器）。
     *
     * @param project - 项目（路径或对象）
     * @param parser - 参数
     * @param any> - 参数
     * @returns {rawText,parsedData,fromCache}
     */
    async getWorldview(project: string, parser?: (text: string) => Record<string, any>): Promise<{ rawText: string; parsedData?: Record<string, any>; fromCache: boolean }> {
        const filePath = getWorldviewPath(project);
        return this.get(project, filePath, parser);
    }

    /**
     * 读取设定库（可附解析器）。
     *
     * @param project - 项目（路径或对象）
     * @param parser - 参数
     * @param any> - 参数
     * @returns {rawText,parsedData,fromCache}
     */
    async getSettingLib(project: string, parser?: (text: string) => Record<string, any>): Promise<{ rawText: string; parsedData?: Record<string, any>; fromCache: boolean }> {
        const filePath = getSettingLibPath(project);
        return this.get(project, filePath, parser);
    }

    /**
     * 写入世界观缓存。
     *
     * @param project - 项目（路径或对象）
     * @param rawText - 原始文本
     * @param parsedData - 参数
     */
    async setWorldview(project: string, rawText: string, parsedData?: Record<string, any>): Promise<void> {
        const filePath = getWorldviewPath(project);
        return this.set(project, filePath, rawText, parsedData);
    }

    /**
     * 写入设定库缓存。
     *
     * @param project - 项目（路径或对象）
     * @param rawText - 原始文本
     * @param parsedData - 参数
     */
    async setSettingLib(project: string, rawText: string, parsedData?: Record<string, any>): Promise<void> {
        const filePath = getSettingLibPath(project);
        return this.set(project, filePath, rawText, parsedData);
    }

    /**
     * 读取实体缓存。
     *
     * @param project - 项目（路径或对象）
     * @param entityType - 实体类型
     * @returns 实体
     */
    async getEntities(
        project: string,
        entityType: 'characters' | 'locations' | 'factions' | 'items'
    ): Promise<Array<{ name: string; content: string; fromCache: boolean }>> {
        const dirMap: Record<string, string> = {
            characters: entityDir(project, 'characters'),
            locations: entityDir(project, 'locations'),
            factions: entityDir(project, 'factions'),
            items: entityDir(project, 'items'),
        };

        const dirPath = dirMap[entityType];
        const files = await this.fs.listFiles(dirPath);
        const results: Array<{ name: string; content: string; fromCache: boolean }> = [];

        for (const file of files) {
            try {
                const result = await this.get(project, file.path);
                if (result.rawText) {
                    const name = file.basename || file.name.replace(/\.md$/, '');
                    results.push({ name, content: result.rawText, fromCache: result.fromCache });
                }
            } catch {
            }
        }

        return results;
    }

    /**
     * 写入实体缓存。
     *
     * @param project - 项目（路径或对象）
     * @param entityType - 实体类型
     * @param name - 名称
     * @param content - 内容
     * @param parsedData - 参数
     */
    async setEntity(
        project: string,
        entityType: 'characters' | 'locations' | 'factions' | 'items',
        name: string,
        content: string,
        parsedData?: Record<string, any>
    ): Promise<void> {
        const pathMap: Record<string, (p: string, n: string) => string> = {
            characters: (p, n) => `${entityDir(p, 'characters')}/${n}.md`,
            locations: (p, n) => `${entityDir(p, 'locations')}/${n}.md`,
            factions: (p, n) => `${entityDir(p, 'factions')}/${n}.md`,
            items: (p, n) => `${entityDir(p, 'items')}/${n}.md`,
        };

        const filePath = pathMap[entityType](project, name);
        return this.set(project, filePath, content, parsedData);
    }

    /**
     * 失效世界观缓存。
     *
     * @param project - 项目（路径或对象）
     */
    invalidateWorldview(project: string): void {
        this.invalidate(project, getWorldviewPath(project));
    }

    /**
     * 失效设定库缓存。
     *
     * @param project - 项目（路径或对象）
     */
    invalidateSettingLib(project: string): void {
        this.invalidate(project, getSettingLibPath(project));
    }

    /**
     * 失效项目实体缓存。
     *
     * @param project - 项目（路径或对象）
     * @param entityType - 参数
     */
    invalidateEntities(project: string, entityType?: 'characters' | 'locations' | 'factions' | 'items'): void {
        if (!entityType) {
            this.invalidateProject(project);
            return;
        }

        const keysToDelete: string[] = [];
        const dirMap: Record<string, string> = {
            characters: entityDir(project, 'characters'),
            locations: entityDir(project, 'locations'),
            factions: entityDir(project, 'factions'),
            items: entityDir(project, 'items'),
        };

        const dirPath = dirMap[entityType];
        for (const [key, entry] of this.cache.entries()) {
            if (entry.project === project && entry.filePath.startsWith(dirPath + '/')) {
                keysToDelete.push(key);
            }
        }

        let freedSize = 0;
        for (const key of keysToDelete) {
            const entry = this.cache.get(key);
            if (entry) {
                freedSize += entry.size;
                this.cache.delete(key);
            }
        }

        const currentSize = this.projectSizes.get(project) || 0;
        this.projectSizes.set(project, Math.max(0, currentSize - freedSize));
        this.updateStats();
    }
}
