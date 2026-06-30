import { App, TFile, TFolder } from 'obsidian';
import { getChapterFile, getChapterFileName, CHAPTER_FILE_TYPES, findBodyFileV4 } from './chapter-utils';
import NovelWriterPlugin from '../main';
import { extractVolumeFromPath, showProgress, showError, readMergedVolumeOutline } from '../utils/helpers';
import { compressWorldContext, CompressedContext } from './context-compressor';
import { parseFrontmatter as parseFm, parseMarkdownContent as parseMdContent } from '../shared/frontmatter';
import { CharacterFrontmatter, FactionFrontmatter, LocationFrontmatter, ItemFrontmatter, Notifier, NOOP_NOTIFIER } from '../shared/types';
import { CHARACTER_DISPLAY_KEYS, CHARACTER_FILE_EXCLUDE, WRITING_RULE_TITLES, TIMELINE_TABLE_HEADER, FORESHADOW_SECTION_UNREVEALED, FORESHADOW_SECTION_REVEALED, FORESHADOW_SECTION_ABANDONED, WRITING_RULES_PATH_PROJECT, WRITING_RULES_PATH_TEMPLATE, chapterOutlineSection } from '../shared/format-constants';
import { detectTimelineStrategy, loadFanficRules, parseCanonTimelineTable, parseFanTimelineTable, TimelineStrategy, FanficRules, TimelineRow } from '../shared/template-validator';
import { getWorldviewPath, getSettingLibPath, getWritingStylePath, getLegacyWritingStylePath, readProjectMeta,
    pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir,
    pjForeshadowDB, pjTimelineBoard, pjMemoryShardsDir,
    pjFanficFile, pjBodyFile, pjStepDir, pjStepFile, pjWritingRules, pjWritingRulesTemplate,
    isInOutlineDir, SUBDIR_WORLD_ARCH, SUBDIR_OUTLINE_ROOT, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';
import { CONTEXT_LOAD_TIMEOUT_MS, TIMELINE_SLICE, CONTEXT_LONG_SLICE, NOTICE_CRITICAL } from '../shared/thresholds';
import { CharacterSoul, buildCharacterSoulSummary, extractCharacterCoreFromContent } from './character-soul';
import { MemoryShard, gatherTriggeredMemories } from './memory-trigger';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { PluginCapabilities } from '../shared/plugin-capabilities';

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
} from './context/context-types';

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

/** 默认缓存 TTL：30 秒 */
const DEFAULT_CONTEXT_CACHE_TTL_MS = 30_000;

export function detectProjects(app: App): string[] {
    const projects: string[] = [];
    const visited = new Set<string>();
    const vaultMeta = new ObsidianVaultMeta(app);
    
    for (const file of vaultMeta.getFiles()) {
        const path = file.path;
        if (path.startsWith('元文件')) continue;
        if (path.startsWith('.')) continue;
        
        const parts = path.split('/');
        const projectName = parts[0];
        
        // 小说项目的标志：存在 .project 文件、世界观总览.md 或 01-世界架构 子目录
        // 刚创建的项目只有 .project 和空目录，也必须能被检测到
        if (projectName && !visited.has(projectName)) {
            if (
                path === `${projectName}/.project` ||
                path === `${projectName}/世界观总览.md` ||
                path.startsWith(`${projectName}/${SUBDIR_WORLD_ARCH}/`)
            ) {
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

    // ─── gatherAll 内存缓存 ───
    private contextCache = new Map<string, ContextCacheEntry>();
    private contextCacheTTL = DEFAULT_CONTEXT_CACHE_TTL_MS;

    /**
     * 构造函数
     * @param options 构造选项，支持传统模式(plugin)或解耦模式(capabilities+fs)
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
            for (const key of this.contextCache.keys()) {
                if (key.startsWith(`${project}::`)) {
                    this.contextCache.delete(key);
                }
            }
        } else {
            this.contextCache.clear();
        }
    }

    async gatherAll(project: string, currentChapter?: string): Promise<GatheredContext> {
        // ─── 缓存命中检查 ───
        const cacheKey = `${project}::${currentChapter || '_global'}`;
        if (this.contextCacheTTL > 0) {
            const cached = this.contextCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.contextCacheTTL) {
                return cached.result;
            }
            // 过期条目删除
            if (cached) this.contextCache.delete(cacheKey);
        }

        const context: GatheredContext = {
            project,
            gatheredAt: new Date().toISOString(),
            data: {},
            issues: []
        };

        const gatherTasks = [
            { name: '人物状态', task: this.gatherCharacterState(project) },
            { name: '人物灵魂层', task: this.gatherCharacterCores(project) },     // V2
            { name: '记忆碎片', task: this.gatherMemories(project) },               // V2 Phase 3
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

        // ✅ v1.6.0: 每个 gather 独立容错，避免一个失败导致全部丢失
        const results = await Promise.all(
            gatherTasks.map(t =>
                t.task.catch((e: Error) => {
                    console.warn(`[小说工坊] ${t.name} 加载失败（已跳过）:`, e.message);
                    return null;
                })
            )
        );

        // ✅ v1.6.0: 标记失败的模块
        const failedModules = gatherTasks
            .filter((_, i) => results[i] === null)
            .map(t => t.name);
        if (failedModules.length > 0) {
            console.warn('[小说工坊] 以下模块加载失败（已跳过）:', failedModules.join('、'));
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
            this.getSettings().maxContext
        );

        // ─── 写入缓存 ───
        if (this.contextCacheTTL > 0) {
            this.contextCache.set(cacheKey, { result: context, timestamp: Date.now() });
        }

        return context;
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
        if (this.capabilities && (this.capabilities as any).entityCache) {
            return (this.capabilities as any).entityCache;
        }
        return null;
    }

    private async gatherEntityRecords(folderPath: string, entityType: string): Promise<Record<string, string>[]> {
        const items: Record<string, string>[] = [];
        const files = this.getFilesInFolder(folderPath).filter(f => !f.name.includes('模板'));
        const project = this.extractProjectFromPath(folderPath);
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
                console.warn(`Failed to read ${entityType} file:`, file.path, e);
            }
        }
        return items;
    }

    /** 从文件夹路径提取项目名（取第一段） */
    private extractProjectFromPath(folderPath: string): string | null {
        const parts = folderPath.split('/');
        return parts.length > 0 ? parts[0] : null;
    }

    async gatherCharacterState(project: string): Promise<ContextData> {
        const characters: CharacterData[] = [];
        const folderPath = pjCharsDir(project);
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
                console.warn('Failed to read character file:', file.path, e);
            }
        }

        return { character_state: characters };
    }

    /**
     * V2: 收集所有角色的灵魂层（character_core）
     * 从人物/*.md 的 frontmatter 中提取 character_core YAML 嵌套字段
     */
    async gatherCharacterCores(project: string): Promise<ContextData> {
        const souls: CharacterSoul[] = [];
        const folderPath = pjCharsDir(project);

        for (const file of this.getFilesInFolder(folderPath)) {
            if (!file.name.includes(CHARACTER_FILE_EXCLUDE)) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const name = file.name.replace(/\.md$/, '');
                    souls.push(extractCharacterCoreFromContent(name, content));
                } catch (e) {
                    console.warn('Failed to read character soul:', file.path, e);
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
        try {
            const app = this.getApp();
            const fs = this.getFS();
            const vaultMeta = this.getVaultMeta();
            const memDir = pjMemoryShardsDir(project);

            // 首先尝试从目录读取
            const dir = vaultMeta.getAbstractFileByPath(memDir);
            if (!(dir instanceof TFolder)) return result;

            const allShards: MemoryShard[] = [];
            for (const child of dir.children) {
                if (child instanceof TFile && child.name.endsWith('_记忆碎片.md')) {
                    try {
                        const content = await this.app.vault.cachedRead(child);
                        const charName = child.name.replace(/_记忆碎片\.md$/, '');
                        // Parse using the memory-trigger module
                        const { loadCharacterMemories } = await import('./memory-trigger');
                        const shards = await loadCharacterMemories(app, project, charName);
                        allShards.push(...shards);
                    } catch { /* skip malformed files */ }
                }
            }

            result.triggered_memories = allShards;

            // 如果有场景文本，立即匹配触发
            if (sceneText && presentCharacters && presentCharacters.length > 0 && protagonistName) {
                const { promptText } = await gatherTriggeredMemories(
                    app, project, sceneText, presentCharacters,
                    protagonistName, chapterNum || 0,
                );
                result.triggered_memories_prompt = promptText;
            }
        } catch (e) {
            console.warn('[ContextManager] 记忆碎片加载失败（已跳过）:', e);
        }
        return result;
    }

    /**
     * 收集所有地点数据
     * 扫描 01-世界架构/地点/ 目录下的所有 .md 文件
     */
    async gatherLocations(project: string): Promise<ContextData> {
        const locations = await this.gatherEntityRecords(pjLocsDir(project), '地点');
        return { locations };
    }

    /**
     * 收集所有势力数据
     * 扫描 01-世界架构/势力/ 目录下的所有 .md 文件
     */
    async gatherFactions(project: string): Promise<ContextData> {
        const factions = await this.gatherEntityRecords(pjFactionsDir(project), '势力');
        return { factions };
    }

    /**
     * 收集所有物品数据
     * 扫描 01-世界架构/物品功法/ 目录下的所有 .md 文件
     */
    async gatherItems(project: string): Promise<ContextData> {
        const items = await this.gatherEntityRecords(pjItemsDir(project), '物品功法');
        return { items };
    }

    async gatherSettingLib(project: string): Promise<ContextData> {
        try {
            const path = getSettingLibPath(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                return { setting_lib: parseMdContent(content) };
            }
        } catch (e) {
            console.warn('Failed to gather setting lib:', e);
        }
        return { setting_lib: null };
    }

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
            console.warn('Failed to gather writing style:', e);
        }
        return { writing_style: null };
    }

    async gatherForeshadows(project: string): Promise<ContextData> {
        try {
            const path = pjForeshadowDB(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const result = this.parseForeshadowContent(content);
                return { foreshadows: result };
            }
        } catch (e) {
            console.warn('Failed to gather foreshadows:', e);
        }
        return { foreshadows: { unrevealed: [], revealed: [], abandoned: [] } };
    }

    async gatherTimeline(project: string, currentChapter?: string): Promise<ContextData> {
        const ctx: ContextData = {};
        try {
            const path = pjTimelineBoard(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const parsed = this.parseTimelineContent(content);
                let events = parsed.events;

                if (parsed.eraCount > 1) {
                    console.log(`[Timeline] 检测到 ${parsed.eraCount} 个纪元：${parsed.eraNames.join('、')}`);
                }
                if (parsed.inconsistencies.length > 0) {
                    console.warn(`[Timeline] 发现 ${parsed.inconsistencies.length} 处时间线不一致:`, parsed.inconsistencies);
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
            console.warn('Failed to gather timeline:', e);
            ctx.timeline = [];
        }

        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return ctx;
            const strategy = detectTimelineStrategy(dotContent);
            if (strategy.strategy === 'fanfic' && strategy.fanficSettingsPath) {
                const ffPath = pjFanficFile(project, strategy.fanficSettingsPath.replace('.md', ''));
                const ffFile = this.getVaultMeta().getAbstractFileByPath(ffPath);
                if (ffFile instanceof TFile) {
                    const ffContent = await this.app.vault.cachedRead(ffFile);
                    ctx.fanfic_canon_timeline = parseCanonTimelineTable(ffContent);
                    ctx.fanfic_fan_timeline = parseFanTimelineTable(ffContent);
                    ctx.fanfic_rules = loadFanficRules(ffContent);
                }
            }
        } catch (e) {
            console.warn('Failed to gather fanfic timeline:', e);
        }

        return ctx;
    }

    /** 加载同人原作剧情时间线表格 */
    async loadFanficCanonTimeline(project: string): Promise<TimelineRow[]> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return [];
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return [];
            
            const ffPath = pjFanficFile(project, strategy.fanficSettingsPath.replace('.md', ''));
            const ffFile = this.getVaultMeta().getAbstractFileByPath(ffPath);
            if (!(ffFile instanceof TFile)) return [];
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return parseCanonTimelineTable(ffContent);
        } catch (e) { console.warn('loadFanficCanonTimeline failed:', e); return []; }
    }

    /** 加载同人故事背景时间线表格 */
    async loadFanficFanTimeline(project: string): Promise<TimelineRow[]> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return [];
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return [];
            
            const ffPath = pjFanficFile(project, strategy.fanficSettingsPath.replace('.md', ''));
            const ffFile = this.getVaultMeta().getAbstractFileByPath(ffPath);
            if (!(ffFile instanceof TFile)) return [];
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return parseFanTimelineTable(ffContent);
        } catch (e) { console.warn('loadFanficFanTimeline failed:', e); return []; }
    }

    /** 加载同人OOC防护规则 */
    async loadFanficRules(project: string): Promise<FanficRules> {
        try {
            const dotContent = await readProjectMeta(this.app, project);
            if (!dotContent) return { mustFollow: [], adaptScope: '', redlines: [] };
            const strategy = detectTimelineStrategy(dotContent);
            if (!strategy.fanficSettingsPath) return { mustFollow: [], adaptScope: '', redlines: [] };
            
            const ffPath = pjFanficFile(project, strategy.fanficSettingsPath.replace('.md', ''));
            const ffFile = this.getVaultMeta().getAbstractFileByPath(ffPath);
            if (!(ffFile instanceof TFile)) return { mustFollow: [], adaptScope: '', redlines: [] };
            const ffContent = await this.app.vault.cachedRead(ffFile);
            return loadFanficRules(ffContent);
        } catch (e) { console.warn('loadFanficRules failed:', e); return { mustFollow: [], adaptScope: '', redlines: [] }; }
    }

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
                bodySummary: null
            };

            for (const volume of volumes) {
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

                const outlineFile = this.getVaultMeta().getAbstractFileByPath(`${stepBase}/大纲摘要.md`);
                if (outlineFile instanceof TFile) {
                    result.outline = await this.app.vault.cachedRead(outlineFile);
                }

                const analysisFile = this.getVaultMeta().getAbstractFileByPath(`${stepBase}/分析报告.md`);
                if (analysisFile instanceof TFile) {
                    result.analysisReport = await this.app.vault.cachedRead(analysisFile);
                }

                const reviewFile = this.getVaultMeta().getAbstractFileByPath(`${stepBase}/连贯性审查.md`);
                if (reviewFile instanceof TFile) {
                    result.continuityReview = await this.app.vault.cachedRead(reviewFile);
                }

                const infoPlanFile = this.getVaultMeta().getAbstractFileByPath(`${stepBase}/信息规划.md`);
                if (infoPlanFile instanceof TFile) {
                    result.infoPlan = await this.app.vault.cachedRead(infoPlanFile);
                }

                if (result.content || result.outline) {
                    break;
                }
            }

            return { previous_chapter: result };
        } catch (e) {
            console.warn('Failed to gather previous chapter:', e);
            return { previous_chapter: null };
        }
    }

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
            console.warn('Failed to gather writing rules:', e);
        }
        return { writing_rules: null };
    }

    async gatherOutline(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { outline: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) {
                volumes.push('第1卷');
            }

            for (const volume of volumes) {
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const outlineFile = this.findStepFile(stepDir, currentChapter, '大纲摘要');
                if (outlineFile) {
                    const content = await this.app.vault.cachedRead(this.getVaultMeta().getAbstractFileByPath(outlineFile) as TFile);
                    return { outline: parseMdContent(content) };
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
            console.warn('Failed to gather outline:', e);
        }
        return { outline: null };
    }

    async gatherEmotionPlan(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { emotion_plan: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) volumes.push('第1卷');

            for (const volume of volumes) {
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const emoFile = this.findStepFile(stepDir, currentChapter, '情绪规划');
                if (emoFile) {
                    const content = await this.app.vault.cachedRead(this.getVaultMeta().getAbstractFileByPath(emoFile) as TFile);
                    return { emotion_plan: parseMdContent(content) };
                }
            }
        } catch (e) {
            console.warn('Failed to gather emotion plan:', e);
        }
        return { emotion_plan: null };
    }

    async gatherSceneExpansion(project: string, currentChapter: string): Promise<ContextData> {
        try {
            const match = currentChapter.match(/第(\d+)章/);
            if (!match) return { scene_expansion: null };

            const chapterNum = parseInt(match[1]);
            const volumes = this.findVolumes(project);
            if (volumes.length === 0) volumes.push('第1卷');

            for (const volume of volumes) {
                const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const stepDir = volN > 0
                    ? pjStepDir(project, volN, chapterNum)
                    : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${chapterNum}章`;
                const sceneFile = this.findStepFile(stepDir, currentChapter, 'Scene展开');
                if (sceneFile) {
                    const content = await this.app.vault.cachedRead(this.getVaultMeta().getAbstractFileByPath(sceneFile) as TFile);
                    return { scene_expansion: parseMdContent(content) };
                }
            }
        } catch (e) {
            console.warn('Failed to gather scene expansion:', e);
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
        
        for (const file of this.getVaultMeta().getFiles()) {
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

    async gatherWorldView(project: string): Promise<ContextData> {
        try {
            const path = getWorldviewPath(project);
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                return { world_view: parseMdContent(content) };
            }
        } catch (e) {
            console.warn('Failed to gather world view:', e);
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
                const parts = line.split('|').map(s => s.trim()).filter(Boolean);
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
                if (parts.length < 8) continue;
                const idx = parts[1] || '';
                const eventName = parts[2] || '';
                const time = parts[3] || '';
                const location = parts[4] || '';
                const involved = parts[5] || '';
                const chapter = parts[6] || '';
                const type = parts[7] || '';
                if (!eventName && !time) continue;
                if (eventName === '事件名称' && time === '时间') continue;
                if (idx.startsWith('-') && eventName.startsWith('-')) continue;

                const ev: TimelineEvent & { era?: string } = { 
                    time, 
                    chapter, 
                    event: eventName, 
                    eventName,
                    location,
                    involvedEntities: involved ? involved.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [],
                    type,
                    impact: '',
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
                const ruleBlocks = section.split(/^###\s/);
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

    private getChapterEnding(content: string, length: number = 500): string {
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
            tasks.push(this.readRawMdFirst([getWritingStylePath(project), getLegacyWritingStylePath(project)]).then(v => writingStyle = v));
        }
        if (opts.includeSetLib) {
            tasks.push(this.readRawMd(getSettingLibPath(project)).then(v => settingLib = v));
        }
        if (opts.includeCharacters) {
            tasks.push(this.gatherCharacterState(project).then(r => { characters = (r.character_state || []) as CharacterData[]; }));
        }
        if (opts.includeEntities) {
            tasks.push(this.gatherEntityRecords(pjLocsDir(project), '地点').then(r => locations = r));
            tasks.push(this.gatherEntityRecords(pjFactionsDir(project), '势力').then(r => factions = r));
            tasks.push(this.gatherEntityRecords(pjItemsDir(project), '物品功法').then(r => items = r));
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

    private async readRawMdFirst(filePaths: string[]): Promise<string> {
        let placeholderContent = '';
        for (const filePath of filePaths) {
            const content = await this.readRawMd(filePath);
            if (!content) continue;
            if (!this.isPlaceholderWritingStyle(content)) return content;
            placeholderContent = placeholderContent || content;
        }
        return placeholderContent;
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
            console.warn(`Failed to read raw md: ${filePath}`, e);
        }
        return '';
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
