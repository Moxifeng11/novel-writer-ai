/**
 * plugin-cache.ts — 插件缓存管理器
 *
 * 将非核心配置数据从 data.json 分离，避免设置文件膨胀。
 * 缓存数据特征：丢失可重建、频繁更新、体积可能较大。
 *
 * 当前分离的缓存项：
 * - panelLayout: 浮窗工作台布局（位置/大小/折叠状态）
 * - modelOverrideHistory: 模型覆盖修改历史
 */

import { SerializedWriter } from './serialized-writer';
import { pluginDataDir } from './paths';
import { createLogger } from './logger';


const log = createLogger('PluginCache');
export interface PanelLayoutCache {
    panels: Array<{
        id: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        collapsed: boolean;
    }>;
    autoRestore: boolean;
    lastWorkspaceOpen: boolean;
}

export interface ModelOverrideHistoryEntry {
    timestamp: string;
    providerId: string;
    model: string;
    field: 'maxContext' | 'maxOutput' | 'both';
    oldValue: number;
    newValue: number;
}

export interface PluginCacheData {
    panelLayout?: PanelLayoutCache;
    modelOverrideHistory?: ModelOverrideHistoryEntry[];
    entityMetadata?: Record<string, ProjectEntityCache>;
    updateLastCheck?: string;
    updateLastResult?: unknown;
    updateNotifiedVersion?: string;
    lastRunVersion?: string;
    settingsBackup?: unknown;
    welcomed?: boolean;
}

/** 单个项目的实体元数据缓存 */
export interface ProjectEntityCache {
    updatedAt: string;
    entities: Record<string, EntityCacheEntry>;
}

/** 单个实体文件的缓存条目 */
export interface EntityCacheEntry {
    path: string;
    mtime: number;
    frontmatter: Record<string, unknown>;
    entityType: string;
}

const CACHE_FILE = `${pluginDataDir()}/cache.json`;

export class PluginCacheManager {
    private data: PluginCacheData = {};
    private writer = new SerializedWriter({ debug: false });
    private app: { vault: { adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void>; mkdir(p: string): Promise<void>; } } };
    private loaded = false;

    constructor(app: { vault: { adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void>; mkdir(p: string): Promise<void>; } } }) {
        this.app = app;
    }

    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(CACHE_FILE)) {
                const raw = await adapter.read(CACHE_FILE);
                this.data = JSON.parse(raw) as PluginCacheData;
            }
        } catch (e) {
            log.warn('[PluginCache] 缓存文件读取失败，使用空缓存:', e instanceof Error ? e.message : String(e));
            this.data = {};
        }
        this.loaded = true;
    }

    private async ensureDataDir(): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(pluginDataDir()))) {
                await adapter.mkdir(pluginDataDir());
            }
        } catch {
            // 目录可能已存在，忽略
        }
    }

    private save(): void {
        this.writer.enqueueAutoClean(async () => {
            await this.ensureDataDir();
            await this.app.vault.adapter.write(CACHE_FILE, JSON.stringify(this.data, null, 2));
        });
    }

    getPanelLayout(): PanelLayoutCache | undefined {
        return this.data.panelLayout;
    }

    setPanelLayout(layout: PanelLayoutCache): void {
        this.data.panelLayout = layout;
        this.save();
    }

    getModelOverrideHistory(): ModelOverrideHistoryEntry[] {
        return this.data.modelOverrideHistory || [];
    }

    addModelOverrideHistory(entry: ModelOverrideHistoryEntry): void {
        if (!this.data.modelOverrideHistory) {
            this.data.modelOverrideHistory = [];
        }
        this.data.modelOverrideHistory.push(entry);
        // 长会话里无上限累加会让 cache.json 每次全量重写越来越大，只保留最近 200 条
        if (this.data.modelOverrideHistory.length > 200) {
            this.data.modelOverrideHistory = this.data.modelOverrideHistory.slice(-200);
        }
        this.save();
    }

    /** 获取项目实体元数据缓存 */
    getEntityCache(project: string): ProjectEntityCache | undefined {
        return this.data.entityMetadata?.[project];
    }

    /** 获取单个实体的缓存条目 */
    getEntityEntry(project: string, filePath: string): EntityCacheEntry | undefined {
        return this.data.entityMetadata?.[project]?.entities[filePath];
    }

    /** 更新单个实体的缓存条目 */
    updateEntityEntry(
        project: string,
        filePath: string,
        mtime: number,
        frontmatter: Record<string, unknown>,
        entityType: string,
    ): void {
        if (!this.data.entityMetadata) {
            this.data.entityMetadata = {};
        }
        if (!this.data.entityMetadata[project]) {
            this.data.entityMetadata[project] = {
                updatedAt: new Date().toISOString(),
                entities: {},
            };
        }
        this.data.entityMetadata[project].entities[filePath] = {
            path: filePath,
            mtime,
            frontmatter,
            entityType,
        };
        this.data.entityMetadata[project].updatedAt = new Date().toISOString();
        this.save();
    }

    /** 批量更新实体缓存 */
    batchUpdateEntityEntries(
        project: string,
        entries: Array<{ path: string; mtime: number; frontmatter: Record<string, unknown>; entityType: string }>,
    ): void {
        if (!this.data.entityMetadata) {
            this.data.entityMetadata = {};
        }
        if (!this.data.entityMetadata[project]) {
            this.data.entityMetadata[project] = {
                updatedAt: new Date().toISOString(),
                entities: {},
            };
        }
        for (const entry of entries) {
            this.data.entityMetadata[project].entities[entry.path] = {
                path: entry.path,
                mtime: entry.mtime,
                frontmatter: entry.frontmatter,
                entityType: entry.entityType,
            };
        }
        this.data.entityMetadata[project].updatedAt = new Date().toISOString();
        this.save();
    }

    /** 清理已删除文件的缓存条目 */
    cleanupEntityCache(project: string, existingPaths: Set<string>): void {
        const projCache = this.data.entityMetadata?.[project];
        if (!projCache) return;
        let changed = false;
        for (const path of Object.keys(projCache.entities)) {
            if (!existingPaths.has(path)) {
                delete projCache.entities[path];
                changed = true;
            }
        }
        if (changed) {
            projCache.updatedAt = new Date().toISOString();
            this.save();
        }
    }

    /** 清空指定项目的实体缓存 */
    clearEntityCache(project: string): void {
        if (this.data.entityMetadata?.[project]) {
            delete this.data.entityMetadata[project];
            this.save();
        }
    }

    getUpdateLastCheck(): string | undefined {
        return this.data.updateLastCheck;
    }

    setUpdateLastCheck(time: string): void {
        this.data.updateLastCheck = time;
        this.save();
    }

    getUpdateLastResult(): unknown {
        return this.data.updateLastResult;
    }

    setUpdateLastResult(result: unknown): void {
        this.data.updateLastResult = result;
        this.save();
    }

    getUpdateNotifiedVersion(): string | undefined {
        return this.data.updateNotifiedVersion;
    }

    setUpdateNotifiedVersion(version: string): void {
        this.data.updateNotifiedVersion = version;
        this.save();
    }

    getLastRunVersion(): string | undefined {
        return this.data.lastRunVersion;
    }

    setLastRunVersion(version: string): void {
        this.data.lastRunVersion = version;
        this.save();
    }

    setSettingsBackup(backup: unknown): void {
        this.data.settingsBackup = backup;
        this.save();
    }

    hasWelcomed(): boolean {
        return this.data.welcomed === true;
    }

    setWelcomed(welcomed: boolean): void {
        this.data.welcomed = welcomed;
        this.save();
    }

    async flush(): Promise<void> {
        await this.writer.flush();
    }

    dispose(): void {
        this.flush().catch(e =>
            log.warn('[PluginCache] 卸载时缓存写入失败:', e instanceof Error ? e.message : String(e))
        );
    }
}
