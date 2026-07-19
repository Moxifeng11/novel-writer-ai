import { TFile } from 'obsidian';
import { FileSystemPort, VaultMetaPort } from '../shared/file-system-port';
import { getWorldviewPath, getSettingLibPath, pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir } from '../shared/paths';
import { performanceMonitor } from './performance-monitor';
import { createLogger } from '../shared/logger';


const log = createLogger('WorldviewCacheService');
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

export interface CacheStats {
    hitCount: number;
    missCount: number;
    evictCount: number;
    totalEntries: number;
    totalSize: number;
    hitRate: number;
}

export interface WorldviewCacheOptions {
    maxProjects?: number;
    maxSizePerProjectMB?: number;
}

const DEFAULT_MAX_PROJECTS = 10;
const DEFAULT_MAX_SIZE_PER_PROJECT_MB = 5;
const BYTES_PER_MB = 1024 * 1024;

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

            if (entry) {
                const oldSize = entry.size;
                this.cache.set(key, newEntry);
                this.projectSizes.set(project, currentProjectSize - oldSize + size);
            } else {
                this.cache.set(key, newEntry);
                this.projectSizes.set(project, currentProjectSize + size);
            }

            this.evictProjectIfNeeded();
            this.updateStats();

            performanceMonitor.end(perfId, { hit: false, size });
            return { rawText, parsedData, fromCache: false };
        } catch (e) {
            performanceMonitor.end(perfId, { error: String(e) });
            throw e;
        }
    }

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

            this.cache.set(key, newEntry);
            this.projectSizes.set(project, currentProjectSize - oldSize + size);
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

    getStats(): CacheStats {
        this.updateStats();
        return { ...this.stats };
    }

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

    async getWorldview(project: string, parser?: (text: string) => Record<string, any>): Promise<{ rawText: string; parsedData?: Record<string, any>; fromCache: boolean }> {
        const filePath = getWorldviewPath(project);
        return this.get(project, filePath, parser);
    }

    async getSettingLib(project: string, parser?: (text: string) => Record<string, any>): Promise<{ rawText: string; parsedData?: Record<string, any>; fromCache: boolean }> {
        const filePath = getSettingLibPath(project);
        return this.get(project, filePath, parser);
    }

    async setWorldview(project: string, rawText: string, parsedData?: Record<string, any>): Promise<void> {
        const filePath = getWorldviewPath(project);
        return this.set(project, filePath, rawText, parsedData);
    }

    async setSettingLib(project: string, rawText: string, parsedData?: Record<string, any>): Promise<void> {
        const filePath = getSettingLibPath(project);
        return this.set(project, filePath, rawText, parsedData);
    }

    async getEntities(
        project: string,
        entityType: 'characters' | 'locations' | 'factions' | 'items'
    ): Promise<Array<{ name: string; content: string; fromCache: boolean }>> {
        const dirMap: Record<string, string> = {
            characters: pjCharsDir(project),
            locations: pjLocsDir(project),
            factions: pjFactionsDir(project),
            items: pjItemsDir(project),
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

    async setEntity(
        project: string,
        entityType: 'characters' | 'locations' | 'factions' | 'items',
        name: string,
        content: string,
        parsedData?: Record<string, any>
    ): Promise<void> {
        const pathMap: Record<string, (p: string, n: string) => string> = {
            characters: (p, n) => `${pjCharsDir(p)}/${n}.md`,
            locations: (p, n) => `${pjLocsDir(p)}/${n}.md`,
            factions: (p, n) => `${pjFactionsDir(p)}/${n}.md`,
            items: (p, n) => `${pjItemsDir(p)}/${n}.md`,
        };

        const filePath = pathMap[entityType](project, name);
        return this.set(project, filePath, content, parsedData);
    }

    invalidateWorldview(project: string): void {
        this.invalidate(project, getWorldviewPath(project));
    }

    invalidateSettingLib(project: string): void {
        this.invalidate(project, getSettingLibPath(project));
    }

    invalidateEntities(project: string, entityType?: 'characters' | 'locations' | 'factions' | 'items'): void {
        if (!entityType) {
            this.invalidateProject(project);
            return;
        }

        const keysToDelete: string[] = [];
        const dirMap: Record<string, string> = {
            characters: pjCharsDir(project),
            locations: pjLocsDir(project),
            factions: pjFactionsDir(project),
            items: pjItemsDir(project),
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
