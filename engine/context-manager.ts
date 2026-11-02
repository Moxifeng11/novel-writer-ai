import { App, TFile, TFolder } from 'obsidian';
import { splitTableCells } from '../shared/chapter-table';
import { getChapterFile, getChapterFileName, CHAPTER_FILE_TYPES, findBodyFileV4, findBodyFileByChapterNum } from './chapter-utils';
import NovelWriterPlugin from '../main';
import { extractVolumeFromPath, showProgress, showError, readMergedVolumeOutline } from '../utils/helpers';
import { compressWorldContext, CompressedContext } from './context-compressor';
import { parseFrontmatter as parseFm, parseMarkdownContent as parseMdContent } from '../shared/frontmatter';
import { CharacterFrontmatter, FactionFrontmatter, LocationFrontmatter, ItemFrontmatter, Notifier, NOOP_NOTIFIER } from '../shared/types';
import { CHARACTER_DISPLAY_KEYS, CHARACTER_FILE_EXCLUDE, WRITING_RULE_TITLES, TIMELINE_TABLE_HEADER, FORESHADOW_SECTION_UNREVEALED, FORESHADOW_SECTION_REVEALED, FORESHADOW_SECTION_ABANDONED, WRITING_RULES_PATH_PROJECT, WRITING_RULES_PATH_TEMPLATE, chapterOutlineSection } from '../shared/format-constants';
import { detectTimelineStrategy, loadFanficRules, parseCanonTimelineTable, parseFanTimelineTable, TimelineStrategy, FanficRules, TimelineRow } from '../shared/template-validator';
import { getWorldviewPath, getSettingLibPath, getWritingStylePath, getLegacyWritingStylePath, readProjectMeta,
    pjCharsDir,
    pjForeshadowDB, pjTimelineBoard, pjMemoryShardsDir,
    pjFanficFile, pjBodyFile, pjStepDir, pjStepFile, pjWritingRules, pjWritingRulesTemplate,
    pjChapterStateSnapshot,
    pjChapterStateSnapshotDir,
    isInOutlineDir, matchProjectFromPath, SUBDIR_WORLD_ARCH, SUBDIR_OUTLINE_ROOT, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjBodyDir } from '../shared/paths';
import { CONTEXT_LOAD_TIMEOUT_MS, TIMELINE_SLICE, CONTEXT_LONG_SLICE, NOTICE_CRITICAL } from '../shared/thresholds';
import { CharacterSoul, buildCharacterSoulSummary, extractCharacterCoreFromContent } from './character-soul';
import { MemoryShard, gatherTriggeredMemories } from './memory-trigger';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { MODE_LIBRARY_ROOT_LIST } from '../domains/kernel/project-locator';
import { buildStoryLinkage, type StoryLinkage } from './story-linkage';
import { buildForeshadowIndexBlock, buildTimelineIndexBlock, upsertLinkageBlock, LINKAGE_BEGIN, LINKAGE_END } from './story-linkage-writer';
import { PluginCapabilities } from '../shared/plugin-capabilities';
import type {
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from './repository';
import type { EngineRegistry } from './engine-registry';

/**
 * ContextManager 全部类型已迁移至 ./context/context-types.ts（P1-3 拆分阶段一）
 * 通过 export type 重新导出，保持原有 import 路径向后兼容。
 */
export type {
    ContextManagerOptions,
    PromptContextOptions,
    PromptContextSection,
    GatheredContext,
    ContextData,
    CharacterData,
    MarkdownContent,
    MarkdownSection,
    ForeshadowData,
    ForeshadowItem,
    TimelineEvent,
    PreviousChapterData,
    WritingRules,
    RuleItem,
    ContextIssue,
    SmartEntityContextOptions,
    SmartEntityContextResult,
    ScoredEntity,
    TrimmedEntityInfo,
    RelationContext,
    EntityAppearanceRecord,
    CharacterImportance,
    EntitySelectionReason,
} from './context/context-types';
import type {
    ContextManagerOptions,
    PromptContextOptions,
    PromptContextSection,
    GatheredContext,
    ContextData,
    CharacterData,
    MarkdownContent,
    MarkdownSection,
    ForeshadowData,
    ForeshadowItem,
    TimelineEvent,
    PreviousChapterData,
    WritingRules,
    RuleItem,
    ContextIssue,
    SmartEntityContextOptions,
    SmartEntityContextResult,
    ScoredEntity,
    TrimmedEntityInfo,
    RelationContext,
    EntityAppearanceRecord,
    CharacterImportance,
    EntitySelectionReason,
} from './context/context-types';
import type { MultiLayerCache } from './cache';
import type { AnyEntityDomainModel } from '../shared/entity-models';
import type { CharacterPairRelation } from './relationship-engine';
import { ContextDiffDetector } from './context/context-diff-detector';
import type { ContextChangeSet } from './context/context-diff-detector';
import { IncrementalUpdater } from './context/incremental-updater';
import { createLogger } from '../shared/logger';
import { listEntityFiles, entityDir, ENTITY_KIND_LABEL, type EntityKind } from '../shared/entity-reader';
import { activeContextQuotas } from '../shared/context-budget-policy';
import { withWriteLock } from '../shared/write-lock';

const log = createLogger('ContextManager');
import type {
    VersionedGatheredContext,
    SectionRefetcher,
    IncrementalUpdaterDeps,
} from './context/incremental-updater';

const DEFAULT_PROMPT_OPTIONS: Required<PromptContextOptions> = {
    includeWorldView: true,
    includeWritingStyle: true,
    includeCharacters: true,
    includeEntities: true,
    includeSetLib: true,
    includeTimeline: true,
    maxCharsPerSection: 10000,
};

/** gatherAll 结果缓存条目 */
interface ContextCacheEntry {
    result: GatheredContext;
    timestamp: number;
}

/** 默认缓存 TTL：300 秒（5 分钟） */
const DEFAULT_CONTEXT_CACHE_TTL_MS = 300_000;

export function detectProjects(app: App): string[] {
    const projects: string[] = [];
    const visited = new Set<string>();
    const vaultMeta = new ObsidianVaultMeta(app);

    const isProjectMarker = (projectId: string, path: string): boolean =>
        path === `${projectId}/.project` ||
        path === `${projectId}/作品信息.md` ||
        path === `${projectId}/世界观总览.md` ||
        path.startsWith(`${projectId}/${SUBDIR_WORLD_ARCH}/`) ||
        path.startsWith(`${projectId}/短篇创作/`) ||
        path.startsWith(`${projectId}/剧本创作/`);

    for (const file of vaultMeta.getFiles()) {
        const path = file.path;
        if (path.startsWith('元文件')) continue;
        if (path.startsWith('.')) continue;

        const parts = path.split('/');
        // 模式库项目：`长篇小说/项目名/...`；项目 ID 使用前两段
        for (const libraryRoot of MODE_LIBRARY_ROOT_LIST) {
            if (!path.startsWith(`${libraryRoot}/`)) continue;
            const relative = path.slice(libraryRoot.length + 1);
            const name = relative.split('/')[0];
            if (!name) continue;
            const projectId = `${libraryRoot}/${name}`;
            if (visited.has(projectId)) break;
            if (isProjectMarker(projectId, path)) {
                projects.push(projectId);
                visited.add(projectId);
            }
            break;
        }
        if (MODE_LIBRARY_ROOT_LIST.includes(parts[0])) continue;

        const projectName = parts[0];

        // 小说项目的标志：存在 .project、作品信息.md、世界观总览.md、01-世界架构，
// 或短篇/剧本独立内容目录。刚创建的模式项目只有 .project 和空目录，也必须能被检测到。
        if (projectName && !visited.has(projectName)) {
            if (isProjectMarker(projectName, path)) {
                // 确认为小说项目
                projects.push(projectName);
                visited.add(projectName);
            }
        }
    }

    return projects.sort();
}

export class ContextManager {
    public getCurrentChapterDir(): string {
        const app = this.getApp();
        const file = app.workspace.getActiveFile();
        if (!file) return '';
        // 强制递归查找包含 "03-大纲与章节" 的父目录
        let parent = file.parent;
        while (parent && !parent.path.includes(SUBDIR_OUTLINE_ROOT)) {
            parent = parent.parent;
        }
        return parent ? parent.path : '';
    }
    private plugin: NovelWriterPlugin | null = null;
    private capabilities: PluginCapabilities | null = null;
    private notifier: Notifier;
    private app: App;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    // ─── Repository 实例（可选，优先使用） ───
    private characterRepo: CharacterRepository | null = null;
    private chapterRepo: ChapterRepository | null = null;
    private projectRepo: ProjectRepository | null = null;
    private factionRepo: FactionRepository | null = null;
    private locationRepo: LocationRepository | null = null;
    private itemRepo: ItemRepository | null = null;
    private engineRegistry: EngineRegistry | null = null;
    private multiLayerCache: MultiLayerCache | null = null;

    // ─── gatherAll 内存缓存 ───
    private contextCache = new Map<string, ContextCacheEntry>();
    private contextCacheTTL = DEFAULT_CONTEXT_CACHE_TTL_MS;

    // ─── 缓存统计 ───
    private cacheStats = { hits: 0, misses: 0, evictions: 0 };

    // ─── 增量更新支持（Task 4.3） ───
    // M2（技术审计）：原 incrementalContextCache 每次 gatherAll 无上限写入完整 GatheredContext，
    // 而唯一读取方 gatherIncremental 与清理方 invalidateIncrementalCache 生产代码零调用（纯死写，
    // 长会话可积累数十 MB），已连同两个死方法与 fileChangeTracker 一并移除。
    // diffDetector / incrementalUpdater 仍被 invalidateCacheByPath / gatherAll 的活路径使用，保留。
    /** 上下文变更检测器 */
    private diffDetector = new ContextDiffDetector();
    /** 增量更新器实例（懒初始化） */
    private incrementalUpdater: IncrementalUpdater | null = null;

    // ─── 性能埋点统计 ───
    private perfStats = {
        totalAccesses: 0,
        repoHits: 0,
        fallbackHits: 0,
        totalLoadTimeMs: 0,
        repoLoadTimeMs: 0,
        fallbackLoadTimeMs: 0,
    };

    private _partialFailures: string[] = [];

    /**
     * 构造函数
     * @param options 构造选项，支持传统模式(plugin)、解耦模式(capabilities+fs)或Repository模式
     */
    constructor(options: ContextManagerOptions);
    /** @deprecated 请使用 ContextManagerOptions 形式 */
    constructor(plugin: NovelWriterPlugin, notifier?: Notifier);
    constructor(optionsOrPlugin: ContextManagerOptions | NovelWriterPlugin, notifier?: Notifier) {
        this.notifier = NOOP_NOTIFIER;

        if ('plugin' in optionsOrPlugin || 'capabilities' in optionsOrPlugin) {
            // 新式构造：ContextManagerOptions
            const options = optionsOrPlugin as ContextManagerOptions;
            this.notifier = options.notifier || NOOP_NOTIFIER;
            if (options.plugin) {
                this.plugin = options.plugin;
                this.app = options.plugin.app;
            } else if (options.capabilities) {
                this.capabilities = options.capabilities;
                this.app = options.capabilities.app;
            } else {
                throw new Error('ContextManager: 必须提供 plugin 或 capabilities');
            }
            this.fs = options.fs || null;
            this.characterRepo = options.characterRepository || null;
            this.chapterRepo = options.chapterRepository || null;
            this.projectRepo = options.projectRepository || null;
            this.factionRepo = options.factionRepository || null;
            this.locationRepo = options.locationRepository || null;
            this.itemRepo = options.itemRepository || null;
            this.engineRegistry = options.engineRegistry || null;
            this.multiLayerCache = options.multiLayerCache || null;
        } else {
            // 旧式构造：NovelWriterPlugin（兼容）
            const plugin = optionsOrPlugin as NovelWriterPlugin;
            this.plugin = plugin;
            this.app = plugin.app;
            this.notifier = notifier || NOOP_NOTIFIER;
        }
    }

    /** 获取 App 实例 */
    private getApp(): App {
        return this.app;
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    /** 获取插件设置 */
    private getSettings(): { maxContext: number; maxUnrevealedForeshadow?: number } {
        if (this.capabilities) {
            return {
                maxContext: this.capabilities.settings.maxContext || 8000,
                maxUnrevealedForeshadow: this.capabilities.settings.maxUnrevealedForeshadow,
            };
        }
        if (this.plugin) {
            return {
                maxContext: this.plugin.settings.maxContext,
                maxUnrevealedForeshadow: this.plugin.settings.maxUnrevealedForeshadow,
            };
        }
        return { maxContext: 8000 };
    }

    // ============================================================
    // 性能埋点辅助方法
    // ============================================================

    /** 记录性能统计（开发模式输出调试信息） */
    private recordPerf(useRepo: boolean, loadTimeMs: number): void {
        this.perfStats.totalAccesses++;
        this.perfStats.totalLoadTimeMs += loadTimeMs;
        if (useRepo) {
            this.perfStats.repoHits++;
            this.perfStats.repoLoadTimeMs += loadTimeMs;
        } else {
            this.perfStats.fallbackHits++;
            this.perfStats.fallbackLoadTimeMs += loadTimeMs;
        }
    }

    /** 获取性能统计信息（用于调试） */
    getPerfStats(): {
        totalAccesses: number;
        repoHits: number;
        fallbackHits: number;
        repoHitRate: string;
        avgLoadTimeMs: string;
        avgRepoLoadTimeMs: string;
        avgFallbackLoadTimeMs: string;
    } {
        const total = this.perfStats.totalAccesses || 1;
        const repoHits = this.perfStats.repoHits;
        const fallbackHits = this.perfStats.fallbackHits;
        return {
            totalAccesses: this.perfStats.totalAccesses,
            repoHits,
            fallbackHits,
            repoHitRate: ((repoHits / total) * 100).toFixed(1) + '%',
            avgLoadTimeMs: (this.perfStats.totalLoadTimeMs / total).toFixed(2),
            avgRepoLoadTimeMs: repoHits > 0 ? (this.perfStats.repoLoadTimeMs / repoHits).toFixed(2) : 'N/A',
            avgFallbackLoadTimeMs: fallbackHits > 0 ? (this.perfStats.fallbackLoadTimeMs / fallbackHits).toFixed(2) : 'N/A',
        };
    }

    // ============================================================
    // Repository 转换辅助方法
    // ============================================================

    /**
     * 获取指定项目的 CharacterRepository（优先使用构造时注入的，其次从 engineRegistry 获取）
     */
    private getCharacterRepo(project: string): CharacterRepository | null {
        if (this.characterRepo) return this.characterRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getCharacterRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 获取指定项目的 FactionRepository
     */
    private getFactionRepo(project: string): FactionRepository | null {
        if (this.factionRepo) return this.factionRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getFactionRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 获取指定项目的 LocationRepository
     */
    private getLocationRepo(project: string): LocationRepository | null {
        if (this.locationRepo) return this.locationRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getLocationRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 获取指定项目的 ItemRepository
     */
    private getItemRepo(project: string): ItemRepository | null {
        if (this.itemRepo) return this.itemRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getItemRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 获取指定项目的 ChapterRepository
     */
    private getChapterRepo(project: string): ChapterRepository | null {
        if (this.chapterRepo) return this.chapterRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getChapterRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 将 Character 领域对象转换为 CharacterData (CharacterFrontmatter) 格式
     */
    private characterToFrontmatter(character: {
        id: string;
        name: string;
        filePath: string;
        frontmatter: { toObject(): Record<string, any> };
    }): CharacterData {
        const fm = character.frontmatter.toObject();
        const fileName = character.filePath.split('/').pop() || '';
        return {
            ...fm,
            name: fm.name || fm['姓名'] || character.name,
            姓名: fm['姓名'] || character.name,
            fileName,
            filePath: character.filePath,
        } as CharacterData;
    }

    /**
     * 将 Faction 领域对象转换为 FactionFrontmatter 格式
     */
    private factionToFrontmatter(faction: {
        id: string;
        name: string;
        filePath: string;
        frontmatter: { toObject(): Record<string, any> };
    }): FactionFrontmatter {
        const fm = faction.frontmatter.toObject();
        return {
            ...fm,
            名称: fm['名称'] || faction.name,
        } as FactionFrontmatter;
    }

    /**
     * 将 Location 领域对象转换为 LocationFrontmatter 格式
     */
    private locationToFrontmatter(location: {
        id: string;
        name: string;
        filePath: string;
        frontmatter: { toObject(): Record<string, any> };
    }): LocationFrontmatter {
        const fm = location.frontmatter.toObject();
        return {
            ...fm,
            名称: fm['名称'] || location.name,
        } as LocationFrontmatter;
    }

    /**
     * 将 Item 领域对象转换为 ItemFrontmatter 格式
     */
    private itemToFrontmatter(item: {
        id: string;
        name: string;
        filePath: string;
        frontmatter: { toObject(): Record<string, any> };
    }): ItemFrontmatter {
        const fm = item.frontmatter.toObject();
        return {
            ...fm,
            名称: fm['名称'] || item.name,
        } as ItemFrontmatter;
    }

    /**
     * 扫描 vault 中可识别的项目。
     * @returns 项目路径数组
     */
    async detectProjects(): Promise<string[]> {
        return detectProjects(this.app);
    }

    /**
     * 设置上下文缓存 TTL（毫秒）
     * @param ttl 缓存有效期，0 表示禁用缓存
     */
    setContextCacheTTL(ttl: number): void {
        this.contextCacheTTL = ttl;
    }

    /**
     * 使上下文缓存失效
     * @param project 指定项目名则只清除该项目缓存，不传则清除全部
     */
    invalidateContextCache(project?: string): void {
        if (project) {
            let evicted = 0;
            for (const key of this.contextCache.keys()) {
                if (key.startsWith(`${project}::`)) {
                    this.contextCache.delete(key);
                    evicted++;
                }
            }
            this.cacheStats.evictions += evicted;
            log.debug(`[ContextManager] 项目缓存失效 | project=${project} | 失效条目=${evicted}`);

            if (this.multiLayerCache) {
                this.multiLayerCache.invalidateByPrefix(`context:gatherAll:${project}::`);
            }
        } else {
            const evicted = this.contextCache.size;
            this.cacheStats.evictions += evicted;
            this.contextCache.clear();
            log.debug(`[ContextManager] 全部缓存失效 | 失效条目=${evicted}`);

            if (this.multiLayerCache) {
                this.multiLayerCache.invalidateByPrefix('context:gatherAll:');
            }
        }
    }

    /**
     * 根据文件路径增量失效缓存
     * 当实体/设定库/世界观等文件修改时调用，自动识别项目并失效该项目缓存
     *
     * 智能失效策略：
     * 1. 精确失效 MultiLayerCache 中的分区级缓存（context:section:*）
     * 2. 常规全量缓存仍按原逻辑失效（向后兼容 gatherAll）
     *
     * @param filePath 修改的文件路径
     * @returns 是否触发了缓存失效
     */
    invalidateCacheByPath(filePath: string): boolean {
        const project = this.extractProjectFromPath(filePath);
        if (!project) return false;

        const shouldInvalidate = this.isContextRelatedPath(filePath, project);
        if (shouldInvalidate) {
            // 1. 精确失效分区级缓存（智能失效策略）
            if (this.multiLayerCache) {
                const changeSet = this.diffDetector.createChangeSetFromPaths([filePath], project);
                for (const section of changeSet.affectedSections) {
                    const sectionCacheKey = `context:section:${project}:${section}`;
                    this.multiLayerCache.invalidate(sectionCacheKey);
                }
            }

            // 2. 常规全量缓存失效（保持原有行为，向后兼容 gatherAll）
            this.invalidateContextCache(project);
            return true;
        }
        return false;
    }

    /**
     * 判断文件路径是否与上下文数据相关
     */
    private isContextRelatedPath(filePath: string, project: string): boolean {
        const worldArchDir = `${project}/${SUBDIR_WORLD_ARCH}/`;
        const outlineDir = `${project}/${SUBDIR_OUTLINE_ROOT}/`;
        const stepDir = `${project}/${SUBDIR_STEP_ROOT}/`;
        const bodyDir = `${project}/${SUBDIR_BODY_ROOT}/`;

        const worldViewPath = getWorldviewPath(project);
        const settingLibPath = getSettingLibPath(project);
        const foreshadowPath = pjForeshadowDB(project);
        const timelinePath = pjTimelineBoard(project);
        const writingRulesPath = pjWritingRules(project);
        const writingStylePath = getWritingStylePath(project);
        const legacyWritingStylePath = getLegacyWritingStylePath(project);
        const fanficPath = pjFanficFile(project, '');
        const chapterStateSnapshotDir = `${pjChapterStateSnapshotDir(project)}/`;

        if (filePath === worldViewPath) return true;
        if (filePath === settingLibPath) return true;
        if (filePath === foreshadowPath) return true;
        if (filePath === timelinePath) return true;
        if (filePath === writingRulesPath) return true;
        if (filePath === writingStylePath) return true;
        if (filePath === legacyWritingStylePath) return true;
        if (filePath.startsWith(worldArchDir)) return true;
        if (filePath.startsWith(outlineDir)) return true;
        if (filePath.startsWith(stepDir)) return true;
        if (filePath.startsWith(bodyDir)) return true;
        if (filePath.startsWith(chapterStateSnapshotDir)) return true;
        if (filePath.startsWith(fanficPath.replace(/\/[^\/]*$/, '/'))) return true;

        return false;
    }

    /** 获取缓存统计信息（用于调试和监控） */
    getCacheStats(): { hits: number; misses: number; evictions: number; size: number; ttl: number } {
        return {
            hits: this.cacheStats.hits,
            misses: this.cacheStats.misses,
            evictions: this.cacheStats.evictions,
            size: this.contextCache.size,
            ttl: this.contextCacheTTL,
        };
    }

    /**
     * 装配项目全量上下文（可含进度回调）。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 参数
     * @param onProgress - 参数
     * @returns 聚合上下文
     */
    async gatherAll(project: string, currentChapter?: string, onProgress?: (completedCount: number, totalCount: number, currentTaskName: string) => void): Promise<GatheredContext> {
        // ─── 缓存命中检查 ───
        const cacheKey = `context:gatherAll:${project}::${currentChapter || '_global'}`;
        const legacyCacheKey = `${project}::${currentChapter || '_global'}`;

        if (this.multiLayerCache) {
            const cached = await this.multiLayerCache.get<GatheredContext>(cacheKey);
            if (cached) {
                this.cacheStats.hits++;
                log.debug(
                    `[ContextManager] 多层缓存命中 | key=${cacheKey} | 命中=${this.cacheStats.hits} | 未命中=${this.cacheStats.misses} | 命中率=${((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(1)}%`
                );
                return cached;
            }
        }

        if (this.contextCacheTTL > 0) {
            const cached = this.contextCache.get(legacyCacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.contextCacheTTL) {
                this.cacheStats.hits++;
                log.debug(
                    `[ContextManager] 缓存命中 | key=${legacyCacheKey} | 命中=${this.cacheStats.hits} | 未命中=${this.cacheStats.misses} | 命中率=${((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(1)}%`
                );
                return cached.result;
            }
            if (cached) {
                this.contextCache.delete(legacyCacheKey);
                this.cacheStats.evictions++;
                log.debug(`[ContextManager] 缓存过期失效 | key=${legacyCacheKey}`);
            }
        }
        this.cacheStats.misses++;
        log.debug(
            `[ContextManager] 缓存未命中 | key=${cacheKey} | 命中=${this.cacheStats.hits} | 未命中=${this.cacheStats.misses} | 命中率=${((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(1)}%`
        );

        this._partialFailures = [];

        const context: GatheredContext = {
            project,
            gatheredAt: new Date().toISOString(),
            data: {},
            issues: []
        };

        const gatherTasks = [
            { name: '人物状态', task: this.gatherCharacterState(project) },
            { name: '人物灵魂层', task: this.gatherCharacterCores(project) },
            { name: '记忆碎片', task: this.gatherMemories(project) },
            { name: '地点', task: this.gatherLocations(project) },
            { name: '势力', task: this.gatherFactions(project) },
            { name: '物品功法', task: this.gatherItems(project) },
            { name: '设定库', task: this.gatherSettingLib(project) },
            { name: '文笔风格', task: this.gatherWritingStyle(project) },
            { name: '伏笔', task: this.gatherForeshadows(project) },
            { name: '时间线', task: this.gatherTimeline(project, currentChapter) },
            { name: '写作规则', task: this.gatherWritingRules(project) },
            { name: '世界观', task: this.gatherWorldView(project) },
        ];

        if (currentChapter) {
            gatherTasks.push({ name: '前章摘要', task: this.gatherPreviousChapter(project, currentChapter) });
            gatherTasks.push({ name: '大纲', task: this.gatherOutline(project, currentChapter) });
            gatherTasks.push({ name: '情绪规划', task: this.gatherEmotionPlan(project, currentChapter) });
            gatherTasks.push({ name: 'Scene展开', task: this.gatherSceneExpansion(project, currentChapter) });
        }

        const totalCount = gatherTasks.length;
        let completedCount = 0;

        const results = await Promise.all(
            gatherTasks.map(t => {
                const wrappedTask = t.task
                    .then(result => {
                completedCount++;
                onProgress?.(completedCount, totalCount, t.name);
                return result;
            })
            .catch((e: Error) => {
                completedCount++;
                onProgress?.(completedCount, totalCount, t.name);
                log.warn(`[小说工坊] ${t.name} 加载失败（已跳过）:`, e.message);
                return null;
            });
                return wrappedTask;
            })
        );

        const failedModules = gatherTasks
            .filter((_, i) => results[i] === null)
            .map(t => t.name);

        if (this._partialFailures.length > 0) {
            failedModules.push(...this._partialFailures);
        }

        if (failedModules.length > 0) {
            log.warn('[小说工坊] 以下模块加载失败（已跳过）:', failedModules.join('、'));
            this.notifier.showNotice(`⚠️ 上下文加载不完整：${failedModules.join('、')} 加载失败，AI 可能遗漏对应设定。请检查对应模块文件是否损坏或缺失。`, NOTICE_CRITICAL);
        }

        results.forEach(r => {
            if (r) {
                context.data = { ...context.data, ...r };
            }
        });

        context.issues = this.detectIssues(context);

        // ✅ v1.6.0: 把失败模块写入 context.data，方便面板给出提示
        context.data['_failedModules'] = failedModules;

        // 上下文智能压缩
        const outlineText = (context.data.outline as MarkdownContent)?.raw || '';
        const chapterNum = currentChapter ? (parseInt(currentChapter.match(/第(\d+)章/)?.[1] || '0') || 0) : 0;

        const fsData = context.data.foreshadows as ForeshadowData;
        const foreshadowStr = fsData ? [
            ...fsData.unrevealed.map(f =>
                `${f.id || ''}|${f.name || ''}|${f.importance || '中'}|${f.buryChapter || '?'}|${f.plannedReveal || '待定'}|${f.status || '未揭示'}`
            ),
            ...fsData.revealed.map(f =>
                `${f.id || ''}|${f.name || ''}|${f.importance || '中'}|${f.buryChapter || '?'}|${f.revealChapter || '?'}|已揭示`
            ),
            ...fsData.abandoned.map(f =>
                `${f.id || ''}|${f.name || ''}|${f.reason || ''}|${f.abandonChapter || '?'}|废弃|废弃`
            )
        ].join('\n') : '';

        const tlData = context.data.timeline as TimelineEvent[];
        const timelineStr = tlData ? tlData.map(t =>
            `${t.time || ''}|${t.chapter || ''}|${t.event || ''}|${t.impact || ''}`
        ).join('\n') : '';

        context.data.compressed = compressWorldContext(
            (context.data.world_view as MarkdownContent)?.raw || '',
            (context.data.setting_lib as MarkdownContent)?.raw || '',
            foreshadowStr,
            timelineStr,
            outlineText,
            chapterNum,
            this.resolveEffectiveContextWindow()
        );

        if (context.data.compressed.truncationApplied) {
            log.warn('【重要】世界观/设定数据因过长被硬截断，当前内容可能不完整');
        }

        // ─── 写入缓存 ───
        if (this.contextCacheTTL > 0) {
            // S-3（v4.27）：LRU 化——上限 16 章，超限先淘汰最旧条目
            if (this.contextCache.size >= 16) {
                const oldestKey = this.contextCache.keys().next().value;
                if (oldestKey) {
                    this.contextCache.delete(oldestKey);
                    this.cacheStats.evictions++;
                }
            }
            this.contextCache.set(legacyCacheKey, { result: context, timestamp: Date.now() });
        }
        if (this.multiLayerCache) {
            await this.multiLayerCache.set(cacheKey, context);
        }

        // Task 4.3: 记录全量版本
        const updater = this.getIncrementalUpdater();
        updater.markFullFallback();

        return context;
    }

    // ============================================================
    // Task 4.3: 上下文增量更新
    // ============================================================

    /**
     * 获取版本历史
     */
    getVersionHistory() {
        return this.getIncrementalUpdater().getVersionHistory();
    }

    /**
     * 获取当前版本
     */
    getCurrentContextVersion() {
        return this.getIncrementalUpdater().getCurrentVersion();
    }

    /**
     * 获取增量更新统计
     */
    getIncrementalStats() {
        return this.getIncrementalUpdater().getStats();
    }

    // ─── Task 4.3 内部方法 ───────────────────────────────────

    /**
     * 获取或创建 IncrementalUpdater 实例（懒初始化）
     */
    private getIncrementalUpdater(): IncrementalUpdater {
        if (!this.incrementalUpdater) {
            const refetcher: SectionRefetcher = {
                refetchSection: async (
                    project: string,
                    section: string,
                    currentChapter?: string,
                ) => {
                    return this.refetchSection(project, section, currentChapter);
                },
            };

            const deps: IncrementalUpdaterDeps = {
                refetcher,
                multiLayerCache: this.multiLayerCache || undefined,
            };

            this.incrementalUpdater = new IncrementalUpdater(deps);
        }
        return this.incrementalUpdater;
    }

    /**
     * 重新获取指定分区的数据（实现 SectionRefetcher 接口）
     */
    private async refetchSection(
        project: string,
        section: string,
        currentChapter?: string,
    ): Promise<Partial<ContextData>> {
        switch (section) {
            case 'character_state':
                return this.gatherCharacterState(project);
            case 'character_cores':
                return this.gatherCharacterCores(project);
            case 'triggered_memories':
                return this.gatherMemories(project);
            case 'locations':
                return this.gatherLocations(project);
            case 'factions':
                return this.gatherFactions(project);
            case 'items':
                return this.gatherItems(project);
            case 'setting_lib':
                return this.gatherSettingLib(project);
            case 'writing_style':
                return this.gatherWritingStyle(project);
            case 'foreshadows':
                return this.gatherForeshadows(project);
            case 'timeline':
            case 'timeline_eras':
            case 'timeline_inconsistencies':
                return this.gatherTimeline(project, currentChapter);
            case 'writing_rules':
                return this.gatherWritingRules(project);
            case 'world_view':
                return this.gatherWorldView(project);
            case 'previous_chapter':
                return currentChapter
                    ? this.gatherPreviousChapter(project, currentChapter)
                    : {};
            case 'outline':
                return currentChapter
                    ? this.gatherOutline(project, currentChapter)
                    : {};
            case 'emotion_plan':
                return currentChapter
                    ? this.gatherEmotionPlan(project, currentChapter)
                    : {};
            case 'scene_expansion':
                return currentChapter
                    ? this.gatherSceneExpansion(project, currentChapter)
                    : {};
            default:
                log.warn(`[ContextManager] 未知分区，无法重新获取: ${section}`);
                return {};
        }
    }

    /**
     * 通用实体收集：扫描指定目录下的 .md 文件，解析 frontmatter
     * 被 gatherLocations / gatherFactions / gatherItems 共享
     */

    /**
     * v5.5: 项目隔离扫描 — 只返回指定文件夹下的 .md 文件
     * 替代 app.vault.getFiles() + startsWith 的全库扫描模式
     */
    private getFilesInFolder(folderPath: string): TFile[] {
        const folder = this.getVaultMeta().getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];
        const results: TFile[] = [];
        const stack: import('obsidian').TAbstractFile[] = [...folder.children];
        while (stack.length > 0) {
            const item = stack.pop();
            if (!item) continue;
            if (item instanceof TFolder) {
                stack.push(...item.children);
            } else if (item instanceof TFile && item.extension === 'md') {
                results.push(item);
            }
        }
        return results;
    }

    /** 获取实体缓存管理器（如果可用） */
    private getEntityCache(): {
        getEntry: (project: string, path: string) => { mtime: number; frontmatter: Record<string, any> } | undefined;
        updateEntry: (project: string, path: string, mtime: number, frontmatter: Record<string, any>, entityType: string) => void;
        cleanup: (project: string, existingPaths: Set<string>) => void;
    } | null {
        if (this.plugin && this.plugin.cacheManager) {
            const cm = this.plugin.cacheManager;
            return {
                getEntry: (p, path) => cm.getEntityEntry(p, path),
                updateEntry: (p, path, mtime, fm, type) => cm.updateEntityEntry(p, path, mtime, fm, type),
                cleanup: (p, paths) => cm.cleanupEntityCache(p, paths),
            };
        }
        if (this.capabilities && this.capabilities.entityCache) {
            return this.capabilities.entityCache;
        }
        return null;
    }

    private async gatherEntityRecords(project: string, kind: EntityKind): Promise<Record<string, string>[]> {
        const items: Record<string, string>[] = [];
        // P0-3：文件清单统一走 entity-reader（排除模板 + 路径升序），与统计/实体管理同口径
        const files = listEntityFiles(this.app, project, kind);
        const entityType = ENTITY_KIND_LABEL[kind];
        const cache = this.getEntityCache();
        const existingPaths = new Set(files.map(f => f.path));

        if (project && cache) {
            cache.cleanup(project, existingPaths);
        }

        for (const file of files) {
            try {
                let fm: Record<string, any> | null = null;
                const mtime = file.stat?.mtime || 0;

                if (project && cache) {
                    const cached = cache.getEntry(project, file.path);
                    if (cached && cached.mtime === mtime && mtime > 0) {
                        fm = cached.frontmatter;
                    }
                }

                if (!fm) {
                    fm = this.app.metadataCache.getFileCache(file)?.frontmatter || null;
                }

                if (!fm || Object.keys(fm).length === 0) {
                    const content = await this.app.vault.cachedRead(file);
                    fm = parseFm(content) as Record<string, any>;
                }

                if (!fm || !Object.keys(fm).length) continue;

                if (project && cache && mtime > 0) {
                    cache.updateEntry(project, file.path, mtime, fm, entityType);
                }

                const item: Record<string, string> = { name: file.name.replace('.md', '') };
                for (const [key, value] of Object.entries(fm)) {
                    if (key !== 'tags') {
                        item[key] = value;
                    }
                }
                items.push(item);
            } catch (e) {
                log.warn(`Failed to read ${entityType} file:`, file.path, e);
            }
        }
        return items;
    }

    /**
     * 从文件路径解析项目根。
     * v4.27（P1-4）：优先用「已缓存的项目键」做最长前缀匹配——旧实现取首段，
     * `长篇小说/书名` 会被解析成 `长篇小说`，失效键永远对不上，编辑设定后仍用旧上下文。
     */
    private extractProjectFromPath(folderPath: string): string | null {
        const knownProjects = new Set<string>();
        for (const key of this.contextCache.keys()) {
            const sep = key.indexOf('::');
            if (sep > 0) knownProjects.add(key.slice(0, sep));
        }
        return matchProjectFromPath(folderPath, knownProjects);
    }

    /**
     * 装配角色当前状态。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherCharacterState(project: string): Promise<ContextData> {
        const startTime = Date.now();
        const repo = this.getCharacterRepo(project);

        if (repo) {
            try {
                const chars = await repo.findAll();
                const characters = chars
                    .filter(c => !c.id.includes(CHARACTER_FILE_EXCLUDE))
                    .map(c => this.characterToFrontmatter(c));
                const loadTime = Date.now() - startTime;
                this.recordPerf(true, loadTime);
                log.debug(`[ContextManager] gatherCharacterState via Repository | project=${project} | count=${characters.length} | time=${loadTime}ms`);
                return { character_state: characters };
            } catch (e) {
                log.warn('[ContextManager] CharacterRepository 不可用，回退到直接读文件:', e);
            }
        }

        const characters: CharacterData[] = [];
        const folderPath = entityDir(project, 'characters');
        const files = this.getFilesInFolder(folderPath).filter(f => !f.name.includes(CHARACTER_FILE_EXCLUDE));
        const cache = this.getEntityCache();
        const existingPaths = new Set(files.map(f => f.path));

        if (cache) {
            cache.cleanup(project, existingPaths);
        }

        for (const file of files) {
            try {
                let data: CharacterData | null = null;
                const mtime = file.stat?.mtime || 0;

                if (cache) {
                    const cached = cache.getEntry(project, file.path);
                    if (cached && cached.mtime === mtime && mtime > 0) {
                        data = cached.frontmatter as CharacterData;
                    }
                }

                if (!data) {
                    data = (this.app.metadataCache.getFileCache(file)?.frontmatter as CharacterData) || null;
                }

                if (!data || Object.keys(data).length === 0) {
                    const content = await this.app.vault.cachedRead(file);
                    data = parseFm(content) as CharacterData;
                }

                if (cache && mtime > 0) {
                    cache.updateEntry(project, file.path, mtime, data as Record<string, any>, 'character');
                }

                data.fileName = file.name;
                data.filePath = file.path;
                data.name = data.name || data.姓名 || file.name.replace('.md', '');
                characters.push(data);
            } catch (e) {
                log.warn('Failed to read character file:', file.path, e);
            }
        }

        const loadTime = Date.now() - startTime;
        this.recordPerf(false, loadTime);
        log.debug(`[ContextManager] gatherCharacterState via fallback | project=${project} | count=${characters.length} | time=${loadTime}ms`);
        return { character_state: characters };
    }

    /**
     * V2: 收集所有角色的灵魂层（character_core）
     * 从人物/*.md 的 frontmatter 中提取 character_core YAML 嵌套字段
     */
    async gatherCharacterCores(project: string): Promise<ContextData> {
        const souls: CharacterSoul[] = [];
        const folderPath = entityDir(project, 'characters');

        for (const file of this.getFilesInFolder(folderPath)) {
            if (!file.name.includes(CHARACTER_FILE_EXCLUDE)) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const name = file.name.replace(/\.md$/, '');
                    souls.push(extractCharacterCoreFromContent(name, content));
                } catch (e) {
                    log.warn('Failed to read character soul:', file.path, e);
                }
            }
        }

        return { character_cores: souls };
    }

    /**
     * V2 Phase 3: 收集所有角色的记忆碎片
     * 扫描 {project}/02-时间线与伏笔/记忆碎片/ 目录下的 _记忆碎片.md 文件
     */
    async gatherMemories(project: string, sceneText?: string, presentCharacters?: string[], protagonistName?: string, chapterNum?: number): Promise<ContextData> {
        const result: ContextData = {};
        let damagedFiles = 0;
        let totalFiles = 0;
        try {
            const app = this.getApp();
            const fs = this.getFS();
            const vaultMeta = this.getVaultMeta();
            const memDir = pjMemoryShardsDir(project);

            const dir = vaultMeta.getAbstractFileByPath(memDir);
            if (!(dir instanceof TFolder)) return result;

            const allShards: MemoryShard[] = [];
            for (const child of dir.children) {
                if (child instanceof TFile && child.name.endsWith('_记忆碎片.md')) {
                    totalFiles++;
                    try {
                        const content = await this.app.vault.cachedRead(child);
                        const charName = child.name.replace(/_记忆碎片\.md$/, '');
                        const { loadCharacterMemories } = await import('./memory-trigger');
                        const shards = await loadCharacterMemories(app, project, charName);
                        allShards.push(...shards);
                    } catch (e) {
                        damagedFiles++;
                        log.warn('[ContextManager] 记忆碎片文件损坏，已跳过:', child.name, e);
                    }
                }
            }

            result.triggered_memories = allShards;

            if (damagedFiles > 0) {
                this._partialFailures.push(`记忆碎片（${damagedFiles}/${totalFiles}个文件损坏）`);
            }

            if (sceneText && presentCharacters && presentCharacters.length > 0 && protagonistName) {
                const { triggered, promptText } = await gatherTriggeredMemories(
                    app, project, sceneText, presentCharacters,
                    protagonistName, chapterNum || 0,
                );
                result.triggered_memories_matched = triggered;
                result.triggered_memories_prompt = promptText;
            }
        } catch (e) {
            log.warn('[ContextManager] 记忆碎片加载失败（已跳过）:', e);
            throw e;
        }
        return result;
    }

    /**
     * 收集所有地点数据
     * 扫描 01-世界架构/地点/ 目录下的所有 .md 文件
     */
    async gatherLocations(project: string): Promise<ContextData> {
        const startTime = Date.now();
        const repo = this.getLocationRepo(project);

        if (repo) {
            try {
                const locs = await repo.findAll();
                const locations = locs.map(l => this.locationToFrontmatter(l));
                const loadTime = Date.now() - startTime;
                this.recordPerf(true, loadTime);
                log.debug(`[ContextManager] gatherLocations via Repository | project=${project} | count=${locations.length} | time=${loadTime}ms`);
                return { locations };
            } catch (e) {
                log.warn('[ContextManager] LocationRepository 不可用，回退到直接读文件:', e);
            }
        }

        const locations = await this.gatherEntityRecords(project, 'locations');
        const loadTime = Date.now() - startTime;
        this.recordPerf(false, loadTime);
        log.debug(`[ContextManager] gatherLocations via fallback | project=${project} | count=${locations.length} | time=${loadTime}ms`);
        return { locations };
    }

    /**
     * 收集所有势力数据
     * 扫描 01-世界架构/势力/ 目录下的所有 .md 文件
     */
    async gatherFactions(project: string): Promise<ContextData> {
        const startTime = Date.now();
        const repo = this.getFactionRepo(project);

        if (repo) {
            try {
                const factions = await repo.findAll();
                const result = factions.map(f => this.factionToFrontmatter(f));
                const loadTime = Date.now() - startTime;
                this.recordPerf(true, loadTime);
                log.debug(`[ContextManager] gatherFactions via Repository | project=${project} | count=${result.length} | time=${loadTime}ms`);
                return { factions: result };
            } catch (e) {
                log.warn('[ContextManager] FactionRepository 不可用，回退到直接读文件:', e);
            }
        }

        const factions = await this.gatherEntityRecords(project, 'factions');
        const loadTime = Date.now() - startTime;
        this.recordPerf(false, loadTime);
        log.debug(`[ContextManager] gatherFactions via fallback | project=${project} | count=${factions.length} | time=${loadTime}ms`);
        return { factions };
    }

    /**
     * 收集所有物品数据
     * 扫描 01-世界架构/物品功法/ 目录下的所有 .md 文件
     */
    async gatherItems(project: string): Promise<ContextData> {
        const startTime = Date.now();
        const repo = this.getItemRepo(project);

        if (repo) {
            try {
                const items = await repo.findAll();
                const result = items.map(i => this.itemToFrontmatter(i));
                const loadTime = Date.now() - startTime;
                this.recordPerf(true, loadTime);
                log.debug(`[ContextManager] gatherItems via Repository | project=${project} | count=${result.length} | time=${loadTime}ms`);
                return { items: result };
            } catch (e) {
                log.warn('[ContextManager] ItemRepository 不可用，回退到直接读文件:', e);
            }
        }

        const items = await this.gatherEntityRecords(project, 'items');
        const loadTime = Date.now() - startTime;
        this.recordPerf(false, loadTime);
        log.debug(`[ContextManager] gatherItems via fallback | project=${project} | count=${items.length} | time=${loadTime}ms`);
        return { items };
    }

    /**
     * 装配设定库。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherSettingLib(project: string): Promise<ContextData> {
        try {
            const path = getSettingLibPath(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                return { setting_lib: parseMdContent(content) };
            }
        } catch (e) {
            log.warn('Failed to gather setting lib:', e);
        }
        return { setting_lib: null };
    }

    /**
     * 装配文笔风格。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherWritingStyle(project: string): Promise<ContextData> {
        try {
            const paths = [getWritingStylePath(project), getLegacyWritingStylePath(project)];
            let placeholderContent = '';
            for (const path of paths) {
                const file = this.getVaultMeta().getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.cachedRead(file);
                    if (!this.isPlaceholderWritingStyle(content)) {
                        return { writing_style: parseMdContent(content) };
                    }
                    placeholderContent = placeholderContent || content;
                }
            }
            if (placeholderContent) return { writing_style: parseMdContent(placeholderContent) };
        } catch (e) {
            log.warn('Failed to gather writing style:', e);
        }
        return { writing_style: null };
    }

    /**
     * 去掉回写生成的 NW-LINKAGE 自动块，避免「关联索引」表格被再次解析成伏笔/时间线事件
     * （二次回写时数据自我污染、块内容不再幂等）。
     */
    private stripLinkageBlock(content: string): string {
        const begin = content.indexOf(LINKAGE_BEGIN);
        const end = content.indexOf(LINKAGE_END);
        if (begin >= 0 && end > begin) {
            return content.slice(0, begin) + content.slice(end + LINKAGE_END.length);
        }
        return content;
    }

    /**
     * 装配伏笔库。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherForeshadows(project: string): Promise<ContextData> {
        try {
            const path = pjForeshadowDB(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const result = this.parseForeshadowContent(this.stripLinkageBlock(content));
                return { foreshadows: result };
            }
        } catch (e) {
            log.warn('Failed to gather foreshadows:', e);
        }
        return { foreshadows: { unrevealed: [], revealed: [], abandoned: [] } };
    }

    /**
     * 装配时间线（可限定当前章）。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 参数
     * @returns 上下文数据
     */
    async gatherTimeline(project: string, currentChapter?: string): Promise<ContextData> {
        const ctx: ContextData = {};
        try {
            const path = pjTimelineBoard(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const parsed = this.parseTimelineContent(this.stripLinkageBlock(content));
                let events = parsed.events;

                if (parsed.eraCount > 1) {
                    log.info(`[Timeline] 检测到 ${parsed.eraCount} 个纪元：${parsed.eraNames.join('、')}`);
                }
                if (parsed.inconsistencies.length > 0) {
                    log.warn(`[Timeline] 发现 ${parsed.inconsistencies.length} 处时间线不一致:`, parsed.inconsistencies);
                }

                if (currentChapter) {
                    const currentNum = parseInt(currentChapter.match(/第(\d+)章/)?.[1] || '0');
                    const filtered = events
                        .filter(e => {
                            const eventChNum = parseInt(e.chapter.match(/第(\d+)章/)?.[1] || '0');
                            return eventChNum <= currentNum;
                        })
                        .sort((a, b) => {
                            const aNum = parseInt(a.chapter.match(/第(\d+)章/)?.[1] || '0');
                            const bNum = parseInt(b.chapter.match(/第(\d+)章/)?.[1] || '0');
                            return bNum - aNum;
                        })
                        .slice(0, TIMELINE_SLICE);
                    ctx.timeline = filtered;
                } else {
                    ctx.timeline = events;
                }

                if (parsed.eraCount > 0) {
                    ctx.timeline_eras = parsed.eraNames;
                    ctx.timeline_inconsistencies = parsed.inconsistencies;
                }
            } else {
                ctx.timeline = [];
            }
        } catch (e) {
            log.warn('Failed to gather timeline:', e);
            ctx.timeline = [];
        }

        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return ctx;
            const strategy = detectTimelineStrategy(dotContent);
            if (strategy.strategy === 'fanfic' && strategy.fanficSettingsPath) {
                const ffFile = this.resolveFanficSettingsFile(project, strategy.fanficSettingsPath);
                if (ffFile) {
                    try {
                        const ffContent = await this.app.vault.cachedRead(ffFile);
                        ctx.fanfic_canon_timeline = parseCanonTimelineTable(ffContent);
                        ctx.fanfic_fan_timeline = parseFanTimelineTable(ffContent);
                        ctx.fanfic_rules = loadFanficRules(ffContent);
                    } catch (e) {
                        log.warn('Failed to parse fanfic timeline file:', strategy.fanficSettingsPath, e);
                        this._partialFailures.push('同人设定（文件损坏）');
                    }
                }
            }
        } catch (e) {
            log.warn('Failed to gather fanfic timeline:', e);
        }

        return ctx;
    }

    /**
     * 定位同人设定文件。
     *
     * `.project` 的「## 同人设定路径」由 `attachFanficPathToProject` / 向导写入，
     * 是完整的 vault 相对路径。早先这里把该值当文件名再拼一次 `05-同人设定库`，
     * 得到「项目/05-同人设定库/项目_05-同人设定库_名字.md」，永远读不到文件——
     * 上下文面板的原作时间线与 OOC 规则对同人项目一直静默为空。
     * 旧数据只写文件名时，回退到项目自己的同人设定库。
     */
    private resolveFanficSettingsFile(project: string, recordedPath: string): TFile | null {
        const direct = this.getVaultMeta().getAbstractFileByPath(recordedPath);
        if (direct instanceof TFile) return direct;
        const baseName = recordedPath.split('/').pop()?.replace(/\.md$/i, '') || recordedPath;
        const legacy = this.getVaultMeta().getAbstractFileByPath(pjFanficFile(project, baseName));
        return legacy instanceof TFile ? legacy : null;
    }

    /** 加载同人原作剧情时间线表格 */
    async loadFanficCanonTimeline(project: string): Promise<TimelineRow[]> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return [];
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return [];
            
            const ffFile = this.resolveFanficSettingsFile(project, strategy.fanficSettingsPath);
            if (!ffFile) return [];
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return parseCanonTimelineTable(ffContent);
        } catch (e) { log.warn('loadFanficCanonTimeline failed:', e); return []; }
    }

    /** 加载同人故事背景时间线表格 */
    async loadFanficFanTimeline(project: string): Promise<TimelineRow[]> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return [];
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return [];
            
            const ffFile = this.resolveFanficSettingsFile(project, strategy.fanficSettingsPath);
            if (!ffFile) return [];
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return parseFanTimelineTable(ffContent);
        } catch (e) { log.warn('loadFanficFanTimeline failed:', e); return []; }
    }

    /** 加载同人OOC防护规则 */
    async loadFanficRules(project: string): Promise<FanficRules> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return { mustFollow: [], adaptScope: '', redlines: [] };
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return { mustFollow: [], adaptScope: '', redlines: [] };
            
            const ffFile = this.resolveFanficSettingsFile(project, strategy.fanficSettingsPath);
            if (!ffFile) return { mustFollow: [], adaptScope: '', redlines: [] };
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return loadFanficRules(ffContent);
        } catch (e) { log.warn('loadFanficRules failed:', e); return { mustFollow: [], adaptScope: '', redlines: [] }; }
    }

    /**
     * 装配上一章状态快照。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
     * @returns 上下文数据
     */
    async gatherPreviousChapter(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { previous_chapter: null };

            const currentNum = parseInt(match[1]);
            const prevNum = currentNum - 1;

            if (prevNum < 1) return { previous_chapter: null };

            const volumes = this.findVolumes(project);
            if (volumes.length === 0) {
                volumes.push('第1卷');
            }

            const result: PreviousChapterData = {
                chapterNumber: prevNum,
                content: null,
                outline: null,
                ending: null,
                analysisReport: null,
                continuityReview: null,
                infoPlan: null,
                bodySummary: null,
                stateSnapshot: null
            };

            const snapshotPath = pjChapterStateSnapshot(project, prevNum);
            const snapshotFile = this.getVaultMeta().getAbstractFileByPath(snapshotPath);
            if (snapshotFile instanceof TFile) {
                try {
                    result.stateSnapshot = await this.app.vault.cachedRead(snapshotFile);
                } catch {
                    result.stateSnapshot = null;
                }
            }

            // 上一章正文所在卷优先（残卷/重编号时避免拿到别卷的同号章数据）
            const { ordered: prevOrdered, preferred: prevPreferred } = this.orderVolumesByBody(volumes, project, prevNum);
            for (const volume of prevOrdered) {
                if (prevPreferred && volume !== prevPreferred) {
                    log.warn(`[ContextManager] 第${prevNum}章 在首选卷 ${prevPreferred} 未命中，跨卷回退到 ${volume}`);
                }
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const bodyPath = volN > 0 ? pjBodyFile(project, volN, prevNum) : `${project}/${SUBDIR_BODY_ROOT}/${volume}/第${prevNum}章_正文.md`;
                const stepBase = volN > 0 ? pjStepDir(project, volN, prevNum) : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${prevNum}章`;
                
                let contentFile = this.getVaultMeta().getAbstractFileByPath(bodyPath);
                if (!(contentFile instanceof TFile)) {
                    const fallback = volN > 0 ? findBodyFileV4(this.app, project, volN, prevNum) : undefined;
                    if (fallback) contentFile = fallback;
                }
                if (contentFile instanceof TFile) {
                    const content = await this.app.vault.cachedRead(contentFile);
                    result.content = content;
                    result.ending = this.getChapterEnding(content);
                    const cleaned = content.replace(/---[\s\S]*?---/, '').trim();
                    if (cleaned.length > CONTEXT_LONG_SLICE) {
                        result.bodySummary = cleaned.slice(0, 2000) + '\n...\n' + cleaned.slice(-1000);
                    } else {
                        result.bodySummary = cleaned;
                    }
                }

                // findStepFile 只返回路径：扫描与读取之间文件可能被删/移，必须判空，
                // 否则 cachedRead(null) 会把整章上下文加载打断。
                const outlineFile = this.findStepFile(stepBase, `第${prevNum}章`, '大纲摘要');
                if (outlineFile) {
                    result.outline = await this.readStepFileContent(outlineFile);
                }

                const analysisFile = this.findStepFile(stepBase, `第${prevNum}章`, '分析报告');
                if (analysisFile) {
                    result.analysisReport = await this.readStepFileContent(analysisFile);
                }

                const reviewFile = this.findStepFile(stepBase, `第${prevNum}章`, '连贯性审查');
                if (reviewFile) {
                    result.continuityReview = await this.readStepFileContent(reviewFile);
                }

                const infoPlanFile = this.findStepFile(stepBase, `第${prevNum}章`, '信息规划');
                if (infoPlanFile) {
                    result.infoPlan = await this.readStepFileContent(infoPlanFile);
                }

                if (result.content || result.outline) {
                    // v4.25 快照过期检测：上一章正文在结算（快照写入）之后被改过，
                    // 旧快照与「上一章结尾」会互相矛盾 → 不注入旧快照，改给提示文案。
                    if (result.stateSnapshot && contentFile instanceof TFile && snapshotFile instanceof TFile) {
                        const bodyMtime = contentFile.stat?.mtime ?? 0;
                        const snapshotMtime = snapshotFile.stat?.mtime ?? 0;
                        if (bodyMtime > snapshotMtime) {
                            log.warn('[ContextManager] 上一章状态快照过期（正文在结算后被修改），本轮不注入旧快照');
                            result.stateSnapshot =
                                '（⚠️ 上一章状态快照已过期：上一章正文在结算后被修改过。'
                                + '本章开头请只依据【上一章结尾】衔接，不要引用快照里的旧状态。）';
                        }
                    }
                    break;
                }
            }

            return { previous_chapter: result };
        } catch (e) {
            log.warn('Failed to gather previous chapter:', e);
            return { previous_chapter: null };
        }
    }

    /**
     * 装配写作规则。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherWritingRules(project: string): Promise<ContextData> {
        try {
            let path = pjWritingRules(project);
            let file = this.getVaultMeta().getAbstractFileByPath(path);

            if (!file) {
                path = pjWritingRulesTemplate();
                file = this.getVaultMeta().getAbstractFileByPath(path);
            }

                if (file instanceof TFile) {
                    const content = await this.app.vault.cachedRead(file);
                    return { writing_rules: this.parseWritingRules(content) };
            }
        } catch (e) {
            log.warn('Failed to gather writing rules:', e);
        }
        return { writing_rules: null };
    }

    /**
     * 找出「第N章正文」实际所在的卷（正文位置是章节归属的最强信号）。
     * 大纲/情绪/场景展开的分卷遍历用它在最前优先查找，避免残留旧卷里的同号章被命中。
     */
    private findBodyVolumeForChapter(project: string, chapterNum: number): string | null {
        try {
            for (const volume of this.findVolumes(project)) {
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                if (volN <= 0) continue;
                const hit = findBodyFileByChapterNum(this.getFilesInFolder(pjBodyDir(project, volN)), `${pjBodyDir(project, volN)}/`, chapterNum);
                if (hit) return volume;
            }
        } catch { /* 目录不可读时退化为原顺序 */ }
        return null;
    }

    /** 卷优先级排序：正文所在卷最前；跨卷命中时由调用方告警 */
    private orderVolumesByBody(volumes: string[], project: string, chapterNum: number): { ordered: string[]; preferred: string | null } {
        const preferred = this.findBodyVolumeForChapter(project, chapterNum);
        const ordered = preferred ? [preferred, ...volumes.filter(v => v !== preferred)] : volumes;
        return { ordered, preferred };
    }

    /**
     * 装配大纲/章纲。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
     * @returns 上下文数据
     */
    async gatherOutline(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { outline: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) {
                volumes.push('第1卷');
            }
            const { ordered, preferred } = this.orderVolumesByBody(volumes, project, chapterNum);

            for (const volume of ordered) {
                if (preferred && volume !== preferred) {
                    log.warn(`[ContextManager] ${currentChapter} 在首选卷 ${preferred} 未命中，跨卷回退到 ${volume}（疑似残留旧卷数据）`);
                }
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const outlineFile = this.findStepFile(stepDir, currentChapter, '大纲摘要');
                if (outlineFile) {
                    const content = await this.readStepFileContent(outlineFile);
                    if (content !== null) return { outline: parseMdContent(content) };
                }
            }

            // 回退：从分卷大纲中提取当前章节的规划段落（v4.0 合并全部分卷文件）
            const volumeOutlineContent = await readMergedVolumeOutline(this.app, project);
            if (volumeOutlineContent) {
                const chapRegex = chapterOutlineSection(chapterNum);
                const chapMatch = volumeOutlineContent.match(chapRegex);
                if (chapMatch) {
                    return { outline: parseMdContent(chapMatch[0]) };
                }
            }
        } catch (e) {
            log.warn('Failed to gather outline:', e);
        }
        return { outline: null };
    }

    /**
     * 装配情绪规划。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
     * @returns 上下文数据
     */
    async gatherEmotionPlan(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { emotion_plan: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) volumes.push('第1卷');
            const { ordered, preferred } = this.orderVolumesByBody(volumes, project, chapterNum);

            for (const volume of ordered) {
                if (preferred && volume !== preferred) {
                    log.warn(`[ContextManager] ${currentChapter} 在首选卷 ${preferred} 未命中，跨卷回退到 ${volume}（疑似残留旧卷数据）`);
                }
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const emoFile = this.findStepFile(stepDir, currentChapter, '情绪规划');
                if (emoFile) {
                    const content = await this.readStepFileContent(emoFile);
                    if (content !== null) return { emotion_plan: parseMdContent(content) };
                }
            }
        } catch (e) {
            log.warn('Failed to gather emotion plan:', e);
        }
        return { emotion_plan: null };
    }

    /**
     * 装配场景扩写底稿。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
     * @returns 上下文数据
     */
    async gatherSceneExpansion(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { scene_expansion: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) volumes.push('第1卷');
            const { ordered, preferred } = this.orderVolumesByBody(volumes, project, chapterNum);

            for (const volume of ordered) {
                if (preferred && volume !== preferred) {
                    log.warn(`[ContextManager] ${currentChapter} 在首选卷 ${preferred} 未命中，跨卷回退到 ${volume}（疑似残留旧卷数据）`);
                }
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const sceneFile = this.findStepFile(stepDir, currentChapter, 'Scene展开');
                if (sceneFile) {
                    const content = await this.readStepFileContent(sceneFile);
                    if (content !== null) return { scene_expansion: parseMdContent(content) };
                }
            }
        } catch (e) {
            log.warn('Failed to gather scene expansion:', e);
        }
        return { scene_expansion: null };
    }

    private findStepFile(stepDir: string, chapterName: string, type: string): string | null {
        const standardName = getChapterFileName(chapterName, type);
        const legacyName = `${type}.md`;
        const vaultMeta = this.getVaultMeta();

        const standardFile = vaultMeta.getAbstractFileByPath(`${stepDir}/${standardName}`);
        if (standardFile instanceof TFile) return `${stepDir}/${standardName}`;

        const legacyFile = vaultMeta.getAbstractFileByPath(`${stepDir}/${legacyName}`);
        if (legacyFile instanceof TFile) return `${stepDir}/${legacyName}`;

        return null;
    }

    private findVolumes(project: string): string[] {
        const volumes: string[] = [];
        const visited = new Set<string>();
        
        // 只列本项目大纲/正文目录（递归），不再全库扫
        for (const file of this.getFilesInFolder(`${project}/${SUBDIR_OUTLINE_ROOT}`)) {
            if (isInOutlineDir(project, file.path)) {
                const volume = extractVolumeFromPath(file.path);
                if (volume && !visited.has(volume)) {
                    volumes.push(volume);
                    visited.add(volume);
                }
            }
        }
        
        return volumes.sort((a, b) => {
            const numA = parseInt(a.match(/第(\d+)卷/)?.[1] || '0');
            const numB = parseInt(b.match(/第(\d+)卷/)?.[1] || '0');
            return numA - numB;
        });
    }

    /**
     * 装配世界观。
     *
     * @param project - 项目（路径或对象）
     * @returns 上下文数据
     */
    async gatherWorldView(project: string): Promise<ContextData> {
        try {
            const path = getWorldviewPath(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                return { world_view: parseMdContent(content) };
            }
        } catch (e) {
            log.warn('Failed to gather world view:', e);
        }
        return { world_view: null };
    }

    private parseForeshadowContent(content: string): ForeshadowData {
        const unrevealed: ForeshadowItem[] = [];
        const revealed: ForeshadowItem[] = [];
        const abandoned: ForeshadowItem[] = [];

        const sections = content.split(/^##\s/m);

        for (const section of sections) {
            const lines = section.split('\n');
            const title = lines[0]?.trim();

            if (!title) continue;

            const tableLines = lines.filter(l => l.includes('|'));
            if (tableLines.length < 3) continue;

            for (let i = 2; i < tableLines.length; i++) {
                const line = tableLines[i];
                const parts = splitTableCells(line);
                if (parts.length < 4) continue;

                if (title.includes(FORESHADOW_SECTION_UNREVEALED)) {
                    unrevealed.push({
                        id: parts[0] || `F${unrevealed.length + 1}`,
                        name: parts[1],
                        importance: parts[2],
                        buryChapter: parts[3],
                        plannedReveal: parts[4],
                        relatedChars: parts[5],
                        relatedMainline: parts[6],
                        status: parts[7] || '未揭示'
                    });
                } else if (title.includes(FORESHADOW_SECTION_REVEALED)) {
                    revealed.push({
                        id: parts[0] || `F${revealed.length + 1}`,
                        name: parts[1],
                        importance: parts[2],
                        buryChapter: parts[3],
                        relatedChars: parts[4],
                        relatedMainline: parts[5],
                        revealChapter: parts[6],
                        method: parts[7]
                    });
                } else if (title.includes(FORESHADOW_SECTION_ABANDONED)) {
                    abandoned.push({
                        id: parts[0] || `F${abandoned.length + 1}`,
                        name: parts[1],
                        reason: parts[2],
                        abandonChapter: parts[3]
                    });
                }
            }
        }

        return { unrevealed, revealed, abandoned };
    }

    private parseTimelineContent(content: string): {
        events: TimelineEvent[];
        eraCount: number;
        eraNames: string[];
        inconsistencies: string[];
    } {
        const events: TimelineEvent[] = [];
        const eraNames: string[] = [];
        const inconsistencies: string[] = [];

        const sections = content.split(/^###\s/m);

        for (let si = 0; si < sections.length; si++) {
            const section = sections[si];
            const secLines = section.split('\n');
            const firstLine = secLines[0]?.trim();

            let eraName = '';
            let tableStartIdx = 0;

            if (si > 0 && firstLine && !firstLine.includes('|')) {
                eraName = firstLine.replace(/^#+\s*/, '').trim();
                if (eraName && !eraName.includes('时间线') && !eraName.includes('纪元') === false) {
                    eraNames.push(eraName);
                } else if (eraName) {
                    eraNames.push(eraName);
                }
                tableStartIdx = 1;
            } else if (si === 0) {
                tableStartIdx = 0;
            }

            const tableLines = secLines.slice(tableStartIdx).filter(l => l.includes('|'));

            let prevChapterNum = -1;
            let prevTimeStr = '';

            for (let i = 0; i < tableLines.length; i++) {
                const line = tableLines[i];
                const parts = line.split('|').map(s => s.trim());
                if (parts.length < 6) continue;

                // Rev 186：兼容两种真实表头。
                // 富表（7 列）：| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |
                // 简表（4 列）：| 时间 | 对应章节 | 事件 | 影响 |（历史项目/模板默认）
                let idx = '';
                let eventName = '';
                let time = '';
                let location = '';
                let involved = '';
                let chapter = '';
                let type = '';
                let impact = '';

                if (parts.length >= 8) {
                    idx = parts[1] || '';
                    eventName = parts[2] || '';
                    time = parts[3] || '';
                    location = parts[4] || '';
                    involved = parts[5] || '';
                    chapter = parts[6] || '';
                    type = parts[7] || '';
                    if (!eventName && !time) continue;
                    if (eventName === '事件名称' && time === '时间') continue;
                    if (idx.startsWith('-') && eventName.startsWith('-')) continue;
                } else {
                    time = parts[1] || '';
                    chapter = parts[2] || '';
                    eventName = parts[3] || '';
                    impact = parts[4] || '';
                    if (time === '时间' && chapter === '对应章节') continue;
                    if ([time, chapter, eventName].every(v => !v || /^[-:\s]+$/.test(v))) continue;
                    if (!eventName && !time) continue;
                }

                const ev: TimelineEvent & { era?: string } = { 
                    time, 
                    chapter, 
                    event: eventName, 
                    eventName,
                    location,
                    involvedEntities: involved ? involved.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [],
                    type,
                    impact,
                    idx
                };
                if (eraName) ev.era = eraName;
                events.push(ev);

                const chMatch = chapter.match(/第(\d+)章/);
                if (chMatch) {
                    const chNum = parseInt(chMatch[1], 10);
                    if (prevChapterNum > 0 && chNum < prevChapterNum) {
                        inconsistencies.push(
                            `${eraName || '默认纪元'}: 章节倒序 — 第${prevChapterNum}章(${prevTimeStr}) → 第${chNum}章(${time})`
                        );
                    }
                    prevChapterNum = chNum;
                    prevTimeStr = time;
                }
            }
        }

        if (eraNames.length === 0 && events.length > 0) {
            eraNames.push('默认纪元');
        }

        return {
            events,
            eraCount: eraNames.length,
            eraNames,
            inconsistencies
        };
    }

    private parseWritingRules(content: string): WritingRules {
        const rules: WritingRules = {
            mandatory: [],
            checklist: [],
            style: ''
        };

        const sections = content.split(/^##\s/m);
        const ruleSections: string[] = [];

        for (const section of sections) {
            const lines = section.split('\n');
            const title = lines[0]?.trim();

            if (!title) continue;

            if (title.includes(WRITING_RULE_TITLES[0])) {
                // 必须带 m 标志：`^` 否则只匹配整串开头，而段首是「格式参考（最低要求）」而非 `### `，
                // 会导致 mandatory 恒为空（格式类强制规则无法进入提示词）。
                const ruleBlocks = section.split(/^###\s/m);
                for (let i = 1; i < ruleBlocks.length; i++) {
                    const ruleLines = ruleBlocks[i].split('\n');
                    const ruleTitle = ruleLines[0]?.trim();
                    const ruleContent = ruleLines.slice(1).filter(l => l.trim() && !l.startsWith('- '));
                    const bulletPoints = ruleLines.filter(l => l.startsWith('- '));

                    rules.mandatory.push({
                        title: ruleTitle,
                        description: ruleContent.join('\n'),
                        points: bulletPoints.map(p => p.replace(/^-\s*/, ''))
                    });
                }
            } else if (title.includes(WRITING_RULE_TITLES[1])) {
                rules.checklist = lines.filter(l => l.startsWith('- [ ]')).map(l =>
                    l.replace('- [ ]', '').trim()
                );
            } else if (title.includes(WRITING_RULE_TITLES[2])) {
                rules.style = lines.filter(l => l.trim() && !l.startsWith('-')).join('\n');
            } else if (/^[一二三四五六七八九十]+[、.]/.test(title)) {
                ruleSections.push(section.trim());
            }
        }

        if (ruleSections.length > 0) {
            const ruleText = ruleSections.join('\n\n');
            rules.style = rules.style ? rules.style + '\n\n' + ruleText : ruleText;
        }

        return rules;
    }

    /**
     * 世界观/设定库压缩用的窗口：优先真实模型能力，其次设置值。
     * 旧实现直接用 settings.maxContext（实测 32768），而模型 1M，
     * 于是世界观被压到 3932 字、设定库 1966 字——设定库原文 5000+ 字直接砍掉六成。
     */
    private resolveEffectiveContextWindow(): number {
        try {
            const plugin = this.plugin;
            if (plugin) {
                const model = plugin.settings.defaultModel || '';
                const resolved = plugin.resolveModelLimits(model, plugin.settings.apiEndpoint);
                if (resolved && resolved.maxContext > 0) return resolved.maxContext;
            }
        } catch {
            // 取不到就用设置值
        }
        return this.getSettings().maxContext || 32768;
    }

    private getChapterEnding(content: string, length: number = activeContextQuotas().prevChapterEndingChars): string {
        const cleanContent = content.replace(/---[\s\S]*?---/, '').trim();
        if (cleanContent.length <= length) return cleanContent;
        return cleanContent.slice(-length);
    }

    private detectIssues(context: GatheredContext): ContextIssue[] {
        const issues: ContextIssue[] = [];

        if (!context.data.setting_lib) {
            issues.push({
                type: 'warning',
                message: '设定库未找到',
                suggestion: '请先创建设定库.md文件'
            });
        }

        if (!context.data.world_view) {
            issues.push({
                type: 'warning',
                message: '世界观总览未找到',
                suggestion: '请先创建世界观总览.md文件'
            });
        }

        const characters = context.data.character_state as CharacterData[];
        if (!characters || characters.length === 0) {
            issues.push({
                type: 'warning',
                message: '未找到人物设定',
                suggestion: '请在01-世界架构/人物/目录下创建人物文件'
            });
        }

        const foreshadows = context.data.foreshadows as ForeshadowData;
        const maxUnrevealed = this.getSettings().maxUnrevealedForeshadow ?? 20;
        if (foreshadows && foreshadows.unrevealed.length > maxUnrevealed) {
            issues.push({
                type: 'error',
                message: `信息债过高: ${foreshadows.unrevealed.length}个未揭示伏笔`,
                suggestion: '请尽快揭示一些伏笔'
            });
        }

        return issues;
    }

    /**
     * 生成上下文信息摘要（账本/调试用）。
     *
     * @param context - 上下文
     * @returns 摘要文本
     */
    getInfoSummary(context: GatheredContext): string {
        const summary: string[] = [];

        const characters = context.data.character_state as CharacterData[];
        if (characters) {
            summary.push(`人物: ${characters.length}人`);
        }

        const foreshadows = context.data.foreshadows as ForeshadowData;
        if (foreshadows) {
            summary.push(`伏笔: ${foreshadows.unrevealed.length}未揭示 / ${foreshadows.revealed.length}已揭示`);
        }

        const timeline = context.data.timeline as TimelineEvent[];
        if (timeline) {
            summary.push(`时间线事件: ${timeline.length}个`);
        }

        if (context.data.previous_chapter) {
            summary.push(`前文: 已加载`);
        }

        return summary.join(' | ');
    }

    /**
     * v5.0: 构建智能实体上下文
     * 基于当前场景智能选择相关实体，并按重要度裁剪信息
     */
    async buildSmartEntityContext(
        project: string,
        options: SmartEntityContextOptions,
    ): Promise<SmartEntityContextResult> {
        const { getEntityContextEngine } = await import('./entity-context-engine');
        const { entityFromFrontmatter } = await import('../shared/entity-models');
        const { loadRelationshipStates } = await import('./relationship-engine');
        const engine = getEntityContextEngine();

        const [charData, locData, facData, itemData] = await Promise.all([
            this.gatherCharacterState(project),
            this.gatherLocations(project),
            this.gatherFactions(project),
            this.gatherItems(project),
        ]);

        const allEntities: AnyEntityDomainModel[] = [];

        const chars = charData.character_state as CharacterData[] || [];
        for (const ch of chars) {
            try {
                const model = entityFromFrontmatter('character', ch as any, '', ch.filePath || '');
                allEntities.push(model);
            } catch (e) {
                log.warn('[ContextManager] 人物实体转换失败:', ch.name || ch.姓名, e);
            }
        }

        const locs = locData.locations as Record<string, any>[] || [];
        for (const loc of locs) {
            try {
                const model = entityFromFrontmatter('location', loc, '', '');
                allEntities.push(model);
            } catch (e) {
                log.warn('[ContextManager] 地点实体转换失败:', loc.name || loc.名称, e);
            }
        }

        const factions = facData.factions as Record<string, any>[] || [];
        for (const fac of factions) {
            try {
                const model = entityFromFrontmatter('faction', fac, '', '');
                allEntities.push(model);
            } catch (e) {
                log.warn('[ContextManager] 势力实体转换失败:', fac.name || fac.名称, e);
            }
        }

        const items = itemData.items as Record<string, any>[] || [];
        for (const item of items) {
            try {
                const model = entityFromFrontmatter('item', item, '', '');
                allEntities.push(model);
            } catch (e) {
                log.warn('[ContextManager] 物品实体转换失败:', item.name || item.名称, e);
            }
        }

        let relations: CharacterPairRelation[] = [];
        try {
            relations = await loadRelationshipStates(this.app, project);
        } catch (e) {
            log.warn('[ContextManager] 加载关系状态失败:', e);
        }

        const scored = engine.selectRelevantEntities(allEntities, options, relations);
        const result = engine.buildSmartContext(scored, options, relations);

        return result;
    }

    /**
     * 获取实体上下文引擎实例
     */
    async getEntityContextEngineInstance() {
        const { getEntityContextEngine } = await import('./entity-context-engine');
        return getEntityContextEngine();
    }

    /**
     * v5.0: 获取格式化后的智能实体上下文（用于 AI 提示词注入）
     */
    async getSmartEntityContextText(
        project: string,
        options: SmartEntityContextOptions,
    ): Promise<string> {
        const result = await this.buildSmartEntityContext(project, options);
        const engine = await this.getEntityContextEngineInstance();
        return engine.formatSmartContextForPrompt(result);
    }

    /** 统一上下文构建：返回 AI-ready 的格式化文本，保留 Markdown 结构（标题、表格等） */
    async buildPromptSection(project: string, options?: PromptContextOptions): Promise<PromptContextSection> {
        const opts = { ...DEFAULT_PROMPT_OPTIONS, ...options };
        const max = opts.maxCharsPerSection;

        const tasks: Promise<any>[] = [];
        let worldView = '', writingStyle = '', settingLib = '';
        let characters: CharacterData[] = [];
        let locations: Record<string, string>[] = [];
        let factions: Record<string, string>[] = [];
        let items: Record<string, string>[] = [];
        let timeline: TimelineEvent[] = [];
        let fanficCanonTimeline: TimelineRow[] = [];
        let fanficFanTimeline: TimelineRow[] = [];
        let fanficRules: FanficRules | undefined;

        // 并行加载所有无需额外处理的文件
        if (opts.includeWorldView) {
            tasks.push(this.readRawMd(getWorldviewPath(project)).then(v => worldView = v));
        }
        if (opts.includeWritingStyle) {
            tasks.push(this.readRawMdFirst(
                [getWritingStylePath(project), getLegacyWritingStylePath(project)],
                `${project}/01-世界架构/文笔风格模板.md`,
            ).then(v => writingStyle = v));
        }
        if (opts.includeSetLib) {
            tasks.push(this.readRawMd(getSettingLibPath(project)).then(v => settingLib = v));
        }
        if (opts.includeCharacters) {
            tasks.push(this.gatherCharacterState(project).then(r => { characters = (r.character_state || []) as CharacterData[]; }));
        }
        if (opts.includeEntities) {
            tasks.push(this.gatherEntityRecords(project, 'locations').then(r => locations = r));
            tasks.push(this.gatherEntityRecords(project, 'factions').then(r => factions = r));
            tasks.push(this.gatherEntityRecords(project, 'items').then(r => items = r));
        }
        if (opts.includeTimeline) {
            tasks.push(this.gatherTimeline(project).then(r => { timeline = (r.timeline || []) as TimelineEvent[]; }));
        }

        // 同人流程：加载同人时间线与规则
        tasks.push(this.loadFanficCanonTimeline(project).then(r => { fanficCanonTimeline = r; }));
        tasks.push(this.loadFanficFanTimeline(project).then(r => { fanficFanTimeline = r; }));
        tasks.push(this.loadFanficRules(project).then(r => { fanficRules = r; }));

        await Promise.all(tasks);

        return {
            worldView: worldView.slice(0, max),
            writingStyle: writingStyle.slice(0, max),
            settingLib: settingLib.slice(0, max),
            timeline: ContextManager.formatTimeline(timeline),
            characters: ContextManager.formatCharacters(characters),
            locations: ContextManager.formatEntities(locations, 'location'),
            factions: ContextManager.formatEntities(factions, 'faction'),
            items: ContextManager.formatEntities(items, 'item'),
            rawCharacters: characters,
            rawLocations: locations,
            rawFactions: factions,
            rawItems: items,
            rawTimeline: timeline,
            fanficCanonTimeline: ContextManager.formatFanficCanonTimeline(fanficCanonTimeline),
            fanficFanTimeline: ContextManager.formatFanficFanTimeline(fanficFanTimeline),
            fanficRules: ContextManager.formatFanficRules(fanficRules),
        };
    }

    private async readRawMdFirst(filePaths: string[], sampleFallbackPath?: string): Promise<string> {
        let placeholderContent = '';
        for (const filePath of filePaths) {
            const content = await this.readRawMd(filePath);
            if (!content) continue;
            if (!this.isPlaceholderWritingStyle(content)) {
                return sampleFallbackPath
                    ? await this.augmentWritingStyleSamples(content, sampleFallbackPath)
                    : content;
            }
            placeholderContent = placeholderContent || content;
        }
        return placeholderContent;
    }

    /**
     * 双文件陷阱（实测）：项目里 `文笔风格.md`（被主路径读取）没有样文，
     * 而 `文笔风格模板.md` 里有 3 段真人样文（《雪中悍刀行》），于是 few-shot 永远为空。
     * 这里在主文件缺样文时，把模板文件里的「零、参考样本」补进正文（只补样文，不覆盖别的）。
     */
    private async augmentWritingStyleSamples(content: string, samplePath: string): Promise<string> {
        if (this.hasUsableStyleSamples(content)) return content;
        try {
            const template = await this.readRawMd(samplePath);
            if (!template) return content;
            const section = this.extractTopSection(template, '零、参考样本');
            if (!section || section.trim().length < 120) return content;
            const usable = section.replace(/（在此粘贴样本）/g, '').trim();
            if (usable.length < 120) return content;
            log.info('[ContextManager] 文笔风格.md 无样文，已从 文笔风格模板.md 补入参考样本');
            return `${content.trim()}

## 零、参考样本（来自项目模板文件）
${usable}`;
        } catch {
            return content;
        }
    }

    /** 主文件里是否有可用的样文段落（非占位） */
    private hasUsableStyleSamples(content: string): boolean {
        const section = this.extractTopSection(content, '零、参考样本');
        if (!section) return false;
        const usable = section.replace(/（在此粘贴样本）/g, '').trim();
        return usable.length >= 120;
    }

    /**
     * findStepFile 只返回路径，读之前必须判空：
     * 批量流水线清理 / 用户移动文件时，扫描与读取之间文件可能已经不存在。
     */
    private async readStepFileContent(path: string): Promise<string | null> {
        const file = this.getVaultMeta().getAbstractFileByPath(path);
        return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
    }

    /** 取 `## 标题` 小节正文（到下一个 ## 或文件尾） */    private extractTopSection(content: string, title: string): string {
        const lines = String(content || '').split('\n');
        // 注意：模板字符串里的 `\s` 会退化成字面量 `s`，必须写 `\\s`；
        // 标题也要转义，否则「零、参考样本」以外的元字符会让定位整体失效。
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startPattern = new RegExp(`^##\\s*${escaped}`);
        const start = lines.findIndex((line) => startPattern.test(line));
        if (start < 0) return '';
        const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
        return (end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end)).join('\n');
    }

    private isPlaceholderWritingStyle(content: string): boolean {
        return content.includes('> ⚠️ 填充完此文件后删除本行') ||
            content.includes('<!-- 填入一段') ||
            (content.includes('template_version: 2') && !content.includes('source: manual') && !content.includes('source: ai-generated'));
    }

    /** 读取 Markdown 文件原始内容，仅去除 frontmatter，保留所有标题/表格/格式 */
    private async readRawMd(filePath: string): Promise<string> {
        try {
            const file = this.getVaultMeta().getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                return content.replace(/^---[\s\S]*?---\n/, '').trim();
            }
        } catch (e) {
            log.warn(`Failed to read raw md: ${filePath}`, e);
        }
        return '';
    }

    /**
     * Rev 186：生成某章的「关联索引」——伏笔到期/逾期、时间线事件、命中的设定条目、
     * 全书规划中本章定位。任一数据源缺失都返回 null，调用方回退旧行为，不阻塞写作。
     */
    async buildStoryLinkage(project: string, chapterName: string): Promise<StoryLinkage | null> {
        try {
            const chapterNum = parseInt(chapterName.match(/第(\d+)章/)?.[1] || '0', 10);
            if (chapterNum <= 0) return null;

            const [foreshadowData, timelineData, settingLib, worldView, planningText, characterData, locations, factions, items] = await Promise.all([
                this.gatherForeshadows(project),
                this.gatherTimeline(project),
                this.readRawMd(getSettingLibPath(project)),
                this.readRawMd(getWorldviewPath(project)),
                readMergedVolumeOutline(this.app, project),
                this.gatherCharacterState(project),
                this.gatherEntityRecords(project, 'locations'),
                this.gatherEntityRecords(project, 'factions'),
                this.gatherEntityRecords(project, 'items'),
            ]);

            const foreshadows = foreshadowData.foreshadows?.unrevealed ?? [];
            const timeline = timelineData.timeline ?? [];
            if (foreshadows.length === 0 && timeline.length === 0) return null;

            // 设定条目 = 世界观/设定库的标题 + 项目实体名（人物/地点/势力/物品）。
            // 真实项目的设定库标题是「一、世界观底层规则」这类分类，不含具体条目，
            // 只用标题会让关联永远命中不到人/地/物；实体名才是可交叉的设定条目。
            const entityNames = [
                ...(characterData.character_state ?? []).map(c => String(c.name || c['姓名'] || '')),
                ...locations.map(e => String(e.name || '')),
                ...factions.map(e => String(e.name || '')),
                ...items.map(e => String(e.name || '')),
            ];
            const settingTitles = [
                ...this.extractSettingTitles(`${settingLib}\n${worldView}`),
                ...entityNames,
            ];

            return buildStoryLinkage({
                chapterName,
                chapterNum,
                foreshadows,
                timeline,
                settingTitles,
                planningText,
            });
        } catch (e) {
            log.warn('[ContextManager] buildStoryLinkage failed:', e);
            return null;
        }
    }

    /**
     * Rev 186：把关联索引回写到 伏笔库.md / 时间线看板.md 的标记块。
     * 只替换 NW-LINKAGE 标记之间内容，用户表格一行不动；文件缺失则跳过。
     */
    async writeStoryLinkageIndex(project: string): Promise<{ foreshadow: boolean; timeline: boolean }> {
        const result = { foreshadow: false, timeline: false };
        const referenceChapter = Math.max(1, this.resolveLatestBodyChapterNum(project));
        const linkage = await this.buildStoryLinkage(project, `第${referenceChapter}章`);
        if (!linkage) return result;

        const generatedAt = this.formatTimestamp();
        const foreshadowPath = pjForeshadowDB(project);
        // 关联索引是「读整份 → 替换 NW-LINKAGE 块 → 写整份」，与结算/分析报告共写同一文件，
        // 必须按路径加锁并在锁内重读，否则会把对方刚写的表格行整段覆盖掉。
        await withWriteLock(foreshadowPath, async () => {
            const foreshadowFile = this.getVaultMeta().getAbstractFileByPath(foreshadowPath);
            if (!(foreshadowFile instanceof TFile)) return;
            const original = await this.app.vault.read(foreshadowFile);
            const block = buildForeshadowIndexBlock(
                [...linkage.due, ...linkage.overdue, ...linkage.upcoming],
                linkage.warnings,
                generatedAt,
                referenceChapter,
            );
            await this.app.vault.modify(foreshadowFile, upsertLinkageBlock(original, block));
            result.foreshadow = true;
        });

        const timelinePath = pjTimelineBoard(project);
        await withWriteLock(timelinePath, async () => {
            const timelineFile = this.getVaultMeta().getAbstractFileByPath(timelinePath);
            if (!(timelineFile instanceof TFile)) return;
            const original = await this.app.vault.read(timelineFile);
            const block = buildTimelineIndexBlock(linkage.timelineAll, linkage.warnings, generatedAt);
            await this.app.vault.modify(timelineFile, upsertLinkageBlock(original, block));
            result.timeline = true;
        });

        return result;
    }

    /** 从设定库 / 世界观原文抽取 2–6 级标题作为设定条目名 */
    private extractSettingTitles(raw: string): string[] {
        const titles: string[] = [];
        for (const line of raw.split('\n')) {
            const match = line.match(/^#{2,6}\s+(.+)$/);
            if (!match) continue;
            const title = match[1].replace(/[#*`]/g, '').trim();
            if (!title || title.length > 40) continue;
            if (!titles.includes(title)) titles.push(title);
        }
        return titles;
    }

    /** 项目内已有正文的最大章号（无正文返回 0） */
    private resolveLatestBodyChapterNum(project: string): number {
        let max = 0;
        for (const file of this.getFilesInFolder(`${project}/${SUBDIR_BODY_ROOT}`)) {
            const match = file.path.match(/第(\d+)章/);
            if (!match) continue;
            max = Math.max(max, parseInt(match[1], 10) || 0);
        }
        return max;
    }

    private formatTimestamp(): string {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    /** 将人物数据格式化为 AI 提示文本（与 Modal 端现有格式一致） */
    static formatCharacters(characters: CharacterData[]): string {
        if (!characters || characters.length === 0) return '';
        const keys: readonly string[] = CHARACTER_DISPLAY_KEYS;
        return characters.map(ch => {
            const name = ch.name || ch.姓名 || ch.fileName?.replace('.md', '') || '';
            if (!name) return '';
            const parts = keys.map(k => `${k}=${ch[k] || ch[k.replace('/', '_')] || '—'}`);
            return `\n- ${name}：${parts.join('，')}`;
        }).join('');
    }

    /** 将实体数据（地点/势力/物品功法）格式化为 AI 提示文本 */
    static formatEntities(entities: Record<string, string>[], type: 'location' | 'faction' | 'item'): string {
        if (!entities || entities.length === 0) return '';

        const labelMap: Record<string, string[]> = {
            location: ['类型', '地理特征', '重要程度'],
            faction: ['类型', '领袖', '地位/排名'],
            item: ['类型', '品阶/等级', '效果'],
        };
        const labels = labelMap[type];

        return entities.map(e => {
            const name = e.name || '';
            if (!name) return '';
            const parts = labels.map(k => {
                const v = e[k] || '—';
                return `${k}=${v}`;
            });
            return `\n- ${name}：${parts.join('，')}`;
        }).join('');
    }

    /** 将时间线事件格式化为 Markdown 表格 */
    static formatTimeline(events: TimelineEvent[]): string {
        if (!events || events.length === 0) return '';
        let table = TIMELINE_TABLE_HEADER;
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const involvedStr = e.involvedEntities?.join('、') || '';
            table += `\n| ${i + 1} | ${e.event || ''} | ${e.time || ''} | ${e.location || ''} | ${involvedStr} | ${e.chapter || ''} | ${e.type || ''} |`;
        }
        return table;
    }

    /** 格式化同人原作剧情时间线 */
    static formatFanficCanonTimeline(rows: TimelineRow[]): string {
        if (!rows || rows.length === 0) return '';
        let table = '| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |\n| --- | --- | --- | --- | --- |';
        for (const row of rows.slice(0, 20)) {
            table += `\n| ${row['时间节点'] || ''} | ${row['原作事件'] || ''} | ${row['涉及人物'] || ''} | ${row['章节参考'] || ''} | ${row['你的同人如何切入'] || ''} |`;
        }
        return table;
    }

    /** 格式化同人故事背景时间线 */
    static formatFanficFanTimeline(rows: TimelineRow[]): string {
        if (!rows || rows.length === 0) return '';
        let table = '| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |\n| --- | --- | --- | --- |';
        for (const row of rows.slice(0, 20)) {
            table += `\n| ${row['你的时间节点'] || ''} | ${row['你的事件'] || ''} | ${row['对应原作时间'] || ''} | ${row['涉及人物'] || ''} |`;
        }
        return table;
    }

    /** 格式化同人OOC防护规则 */
    static formatFanficRules(rules?: FanficRules): string {
        if (!rules) return '';
        const parts: string[] = [];
        if (rules.mustFollow?.length > 0) {
            parts.push('必须遵守的原作规则：\n' + rules.mustFollow.map(r => `- ${r}`).join('\n'));
        }
        if (rules.adaptScope) {
            parts.push('允许改编的范围：' + rules.adaptScope);
        }
        if (rules.redlines?.length > 0) {
            parts.push('禁止触及的红线：\n' + rules.redlines.map(r => `- ${r}`).join('\n'));
        }
        return parts.join('\n\n');
    }
}

// 类型定义已全部迁移至 ./context/context-types.ts (P1-3 拆分阶段一)
// 文件头有 re-export，外部 import 路径不变。
