/**
 * engine-registry.ts — 引擎注册表
 *
 * 集中管理所有引擎实例（单例），解决：
 * 1. 引擎实例化分散在 main.ts onload 各处
 * 2. UI 组件直接 new 引擎导致多实例状态不同步
 * 3. 缺乏统一初始化顺序管理
 *
 * 使用方式：
 *   const registry = new EngineRegistry();
 *   await registry.initialize(plugin, { settingsWriter });
 *   const aiEngine = registry.get(ENGINE_NAMES.AI_ENGINE); // 类型由 EngineServiceMap 推导
 *
 * 增强能力（Task 2）：
 * - 作用域系统：Singleton / ProjectScoped / Transient
 * - 依赖声明与拓扑校验：verifyDependencies()
 * - 异步懒加载：registerLazy 支持 () => Promise<T>，getAsync 异步获取
 * - Dispose 机制：dispose / disposeProject / disposeAll
 * - 注册元数据：listEngines / getMetadata
 *
 * 向后兼容：
 * - register / registerLazy / get / getOrNull / has 签名不变
 * - 旧调用方式（不带 options）默认 Singleton 作用域
 * - 旧的 repositoryInstances / styleLearnerInstances 保留，行为不变
 */
import { Notice } from 'obsidian';
import type { SerializedWriter } from '@/shared/serialized-writer';
import type NovelWriterPlugin from '@/main';

// ─── 增强类型定义 ───

/** 引擎作用域 */
export enum EngineScope {
    /** 单例：整个插件生命周期共享一个实例（默认） */
    Singleton = 'singleton',
    /** 项目级：每个项目独立实例，切换项目时释放旧实例 */
    ProjectScoped = 'project-scoped',
    /** 瞬态：每次获取创建新实例，由调用方负责 dispose */
    Transient = 'transient',
}

/** 可释放资源接口（可选实现） */
export interface Disposable {
    /** 释放资源，可同步或异步 */
    dispose(): void | Promise<void>;
}

/** 引擎状态 */
export type EngineStatus = 'active' | 'destroyed' | 'error';

/** 懒加载状态 */
export type LazyState = 'pending' | 'loaded' | 'failed';

/** 引擎注册元数据 */
export interface EngineMetadata {
    /** 引擎显示名称（默认使用注册名） */
    description?: string;
    /** 标签，用于 listEngines 筛选 */
    tags?: string[];
    /** 版本号 */
    version?: string;
    /** 当前状态 */
    status: EngineStatus;
    /** 作用域 */
    scope: EngineScope;
    /** 依赖的其他引擎名 */
    dependencies?: string[];
    /** 是否懒加载 */
    lazy: boolean;
    /** 懒加载状态（仅 lazy=true 时有意义） */
    lazyState?: LazyState;
}

/** register / registerLazy 的可选配置 */
export interface EngineRegisterOptions {
    /** 作用域，默认 Singleton */
    scope?: EngineScope;
    /** 依赖的其他引擎名 */
    dependencies?: string[];
    /** 元数据 */
    description?: string;
    /** 标签 */
    tags?: string[];
    /** 版本号 */
    version?: string;
    /** 实例创建后的初始化钩子（仅懒加载场景） */
    onInit?: (instance: any) => void | Promise<void>;
}

/** listEngines 的筛选条件 */
export interface EngineListFilter {
    /** 按标签筛选（包含任一即匹配） */
    tags?: string[];
    /** 按作用域筛选 */
    scope?: EngineScope;
    /** 按状态筛选 */
    status?: EngineStatus;
    /** 按懒加载筛选 */
    lazy?: boolean;
}

/** 依赖校验结果 */
export interface DependencyCheckResult {
    /** 是否通过 */
    ok: boolean;
    /** 缺失的依赖列表 */
    missing: Array<{ engine: string; missingDependency: string }>;
    /** 检测到的循环依赖（环） */
    cycles: string[][];
}

// 引擎类导入（用于实例化）
import { InternalRegistry } from '@/shared/internal-registry';
import { PluginCacheManager } from '@/shared/plugin-cache';
import { CryptoService } from '@/core/crypto-service';
import { ProviderManager } from '@/core/provider-manager';
import { ThemeManager } from '@/core/theme-manager';
import { SettingsService } from '@/core/settings-service';
import { JobService } from '@/services/job-service';
import { ContextManager } from './context-manager';
import { ForeshadowManager } from './foreshadow-manager';
import { ReviewAgent } from './review-agent';
import { CommandRegistry } from '@/core/command-registry';
import { KnowledgeTagManager } from './knowledge-tags';
import { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import { KnowledgeVectorStore } from './knowledge-vector-store';
import { VectorEnhancer } from './vector-enhancer';
import { TokenBucketRateLimiter } from './token-bucket-rate-limiter';
import { EmbeddingProviderFactory } from './embedding/provider-factory';
import { setSharedEmbeddingProvider, getSharedEmbeddingProvider } from './embedding/embedding-service';
import { GITHUB_REPO_SLUG } from '@/shared/github-repo';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { DeconstructionScheduler } from './deconstruction-scheduler';
import { BatchImportManager } from './batch-import-manager';
import { HeavyTaskWorkerManager } from './heavy-task-worker-manager';
import { WritingProfileManager } from './writing-profile';
import { KnowledgeInjector } from './knowledge-injector';
import { CharacterConsistencyChecker } from './character-consistency-checker';
import { AIEngine } from './ai-engine';
import { CoWriterEngine } from './co-writer-engine';
import { AnalysisReportEngine } from './analysis-report-engine';
import { ChapterSnapshotBuilder } from './chapter-snapshot-builder';
import { SceneGenerationLoop } from './scene-generation-loop';
import { QualityGate } from './quality-gate';
import { FactIndexManager } from './fact-index-manager';
import { VaultFactStorage, VaultFactWriter } from './fact-index-vault';
import { GenerationCheckpointStore } from './generation-checkpoint';
import { VaultCheckpointStorage } from './generation-checkpoint-vault';
import { SettlementEngine } from './settlement-engine';
import { getPromptCache } from './prompt-cache';
import { CharacterGenerator } from './ai-character-generator';
import { AIApiClient } from './ai-api-client';
import { StyleLearner } from './style-learner';
import { WorldviewCacheService } from '@/services/worldview-cache-service';
import { UpdateChecker } from '@/services/update-checker';
import { WritingStatsService, type StatsFileLike, type WritingStatsAppLike } from '@/services/writing-stats-service';
import { isChapterBodyPath, listChapterBodyFiles } from '@/shared/body-path';
import { ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import { pjFactIndexFile } from '@/shared/paths';
import { resolvePluginWorkerUrl } from '@/shared/plugin-worker-url';
import { TemplateService } from './template-service';
import { ChapterVersionService } from '@/services/chapter-version-service';
import { createLogger } from '@/shared/logger';
import { ENGINE_NAMES } from '@/shared/engine-names';

const log = createLogger('EngineRegistry');
import {
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from './repository';

/** 引擎名称常量已下沉到 shared/engine-names.ts，此处仅再导出以兼容既有引用 */
export { ENGINE_NAMES };

/**
 * 引擎名 → 实例类型映射
 *
 * 仅收录本注册表以具体类实例化的 token（复用文件已有的运行时 import，零新增耦合）；
 * 未收录的 token（如由组合根注入的 `TEMPLATE_MANAGER` / `CO_WRITING_SESSION_STORE`）
 * 继续走 `get<T>(string)` 宽泛重载，行为与旧版一致。
 */
export interface EngineServiceMap {
    [ENGINE_NAMES.CACHE_MANAGER]: PluginCacheManager;
    [ENGINE_NAMES.INTERNAL_REGISTRY]: InternalRegistry;
    [ENGINE_NAMES.CRYPTO_SERVICE]: CryptoService;
    [ENGINE_NAMES.PROVIDER_MANAGER]: ProviderManager;
    [ENGINE_NAMES.THEME_MANAGER]: ThemeManager;
    [ENGINE_NAMES.SETTINGS_SERVICE]: SettingsService;
    [ENGINE_NAMES.JOB_SERVICE]: JobService;
    [ENGINE_NAMES.CONTEXT_MANAGER]: ContextManager;
    [ENGINE_NAMES.FORESHADOW_MANAGER]: ForeshadowManager;
    [ENGINE_NAMES.REVIEW_AGENT]: ReviewAgent;
    [ENGINE_NAMES.COMMAND_REGISTRY]: CommandRegistry;
    [ENGINE_NAMES.KNOWLEDGE_TAG_MANAGER]: KnowledgeTagManager;
    [ENGINE_NAMES.KNOWLEDGE_BASE_MANAGER]: KnowledgeBaseManager;
    [ENGINE_NAMES.KNOWLEDGE_VECTOR_STORE]: KnowledgeVectorStore;
    [ENGINE_NAMES.VECTOR_ENHANCER]: VectorEnhancer;
    [ENGINE_NAMES.DECONSTRUCTION_SCHEDULER]: DeconstructionScheduler;
    [ENGINE_NAMES.HEAVY_TASK_WORKER_MANAGER]: HeavyTaskWorkerManager;
    [ENGINE_NAMES.BATCH_IMPORT_MANAGER]: BatchImportManager;
    [ENGINE_NAMES.WRITING_PROFILE_MANAGER]: WritingProfileManager;
    [ENGINE_NAMES.KNOWLEDGE_INJECTOR]: KnowledgeInjector;
    [ENGINE_NAMES.CHARACTER_CONSISTENCY_CHECKER]: CharacterConsistencyChecker;
    [ENGINE_NAMES.AI_ENGINE]: AIEngine;
    [ENGINE_NAMES.CO_WRITER_ENGINE]: CoWriterEngine;
    [ENGINE_NAMES.ANALYSIS_REPORT_ENGINE]: AnalysisReportEngine;
    [ENGINE_NAMES.CHAPTER_SNAPSHOT_BUILDER]: ChapterSnapshotBuilder;
    [ENGINE_NAMES.SCENE_GENERATION_LOOP]: SceneGenerationLoop;
    [ENGINE_NAMES.QUALITY_GATE]: QualityGate;
    [ENGINE_NAMES.GENERATION_CHECKPOINT_STORE]: GenerationCheckpointStore;
    [ENGINE_NAMES.PROMPT_CACHE]: ReturnType<typeof getPromptCache>;
    [ENGINE_NAMES.SETTLEMENT_ENGINE]: SettlementEngine;
    [ENGINE_NAMES.CHARACTER_GENERATOR]: CharacterGenerator;
    [ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE]: WorldviewCacheService;
    [ENGINE_NAMES.UPDATE_CHECKER]: UpdateChecker;
    [ENGINE_NAMES.WRITING_STATS]: WritingStatsService;
    [ENGINE_NAMES.TEMPLATE_SERVICE]: TemplateService;
    [ENGINE_NAMES.CHAPTER_VERSION_SERVICE]: ChapterVersionService;
    [ENGINE_NAMES.PROJECT_REPOSITORY]: ProjectRepository;
}

/** 可静态推导实例类型的引擎名（`EngineServiceMap` 的键） */
export type EngineToken = keyof EngineServiceMap;

/**
 * 引擎初始化选项。
 */
export interface InitializeOptions {
    /** Plugin 的序列化写入器（私有字段，需显式传入） */
    settingsWriter: SerializedWriter;
    /**
     * 口令交互端口 — 由组合根（main.ts）注入。
     * engine 层不得 import ui/ 的 Modal，否则形成 engine → ui 反向依赖。
     */
    passwordPort: PasswordPort;
    /** 模板管理器工厂 — 纯 UI 服务，由组合根注入实例，engine 层只负责注册 */
    createTemplateManager: () => unknown;
}

/** 口令交互端口：询问已有口令 / 设定新口令，取消返回 null */
export interface PasswordPort {
    requestPassword: () => Promise<string | null>;
    requestNewPassword: () => Promise<string | null>;
}

/**
 * 引擎注册表 — 集中管理所有引擎实例（单例）
 *
 * 8 阶段初始化顺序：
 * Phase 1: 缓存管理器 (PluginCacheManager)
 * Phase 2: Core 服务 (InternalRegistry, CryptoService, ProviderManager, ThemeManager, SettingsService)
 * Phase 3: 基础引擎 (ContextManager, ForeshadowManager, ReviewAgent)
 * Phase 4: 命令注册表 (CommandRegistry)
 * Phase 5: 设置加载 (SettingsService.loadSettings)
 * Phase 6: 知识库系统 (KnowledgeTag/Base/Vector, VectorEnhancer, DeconstructionScheduler)
 * Phase 7: 写作配置与注入 (WritingProfileManager, KnowledgeInjector, CharacterConsistencyChecker)
 * Phase 8: 懒加载引擎注册 (AIEngine, CoWriterEngine, AnalysisReportEngine)
 *
 * @example
 * ```ts
 * const registry = new EngineRegistry();
 * registry.register(ENGINE_NAMES.AI_ENGINE, aiEngine);
 * const engine = registry.get(ENGINE_NAMES.AI_ENGINE);
 * if (registry.has(ENGINE_NAMES.AI_ENGINE)) registry.dispose(ENGINE_NAMES.AI_ENGINE);
 * ```
 */
export class EngineRegistry {
    private instances = new Map<string, unknown>();
    private lazyFactories = new Map<string, () => unknown>();
    private styleLearnerInstances = new Map<string, StyleLearner>();
    private repositoryInstances = new Map<string, Map<string, unknown>>();
    private factIndexManagers = new Map<string, FactIndexManager>();
    private plugin: NovelWriterPlugin | null = null;

    // ─── 增强字段（Task 2） ───
    /** 引擎元数据表（与 instances / lazyFactories 一一对应） */
    private metadata = new Map<string, EngineMetadata>();
    /** 懒加载状态追踪 */
    private lazyStates = new Map<string, LazyState>();
    /** onInit 钩子表（仅懒加载场景使用） */
    private onInitHooks = new Map<string, (instance: any) => void | Promise<void>>();
    /** 项目级实例存储：projectKey -> (instanceKey -> instance) */
    private projectInstances = new Map<string, Map<string, unknown>>();
    /** 瞬态工厂表：每次 getTransient 创建新实例 */
    private transientFactories = new Map<string, () => unknown>();
    /** 已 dispose 的引擎名集合（防止 dispose 后再次获取） */
    private destroyed = new Set<string>();
    /** 当前活跃项目 key（用于 disposeProject 自动切换） */
    private currentProjectKey: string | null = null;

    /** 注册引擎实例（单例，重复注册跳过）
     *
     * 向后兼容：register(name, instance) 行为不变，默认 Singleton 作用域。
     * 增强：register(name, instance, { scope, dependencies, ... }) 支持元数据。
     * 类型约束：已知 token 的实例类型须与 EngineServiceMap 一致（未知 token 走宽泛重载）。
     *
     * @param name - 引擎 token（来自 shared/engine-names）
     * @param instance - 实例
     * @param options - 作用域/依赖/初始化回调等元数据
     */
    register<K extends EngineToken>(name: K, instance: EngineServiceMap[K], options?: EngineRegisterOptions): void;
    /**
     * 注册。
     * @param name - 名称
     * @param instance - 引擎实例
     * @param options - 配置项
     */
    register<T>(name: string, instance: T, options?: EngineRegisterOptions): void;
    /**
     * 注册。
     * @param name - 名称
     * @param instance - 引擎实例
     * @param options - 配置项
     */
    register<T>(name: string, instance: T, options?: EngineRegisterOptions): void {
        if (this.instances.has(name)) {
            log.warn(`[EngineRegistry] 引擎 "${name}" 已注册，跳过重复注册`);
            return;
        }
        if (this.destroyed.has(name)) {
            log.warn(`[EngineRegistry] 引擎 "${name}" 已 dispose，禁止重新注册`);
            return;
        }
        const scope = options?.scope ?? EngineScope.Singleton;
        if (scope === EngineScope.Transient) {
            log.warn(`[EngineRegistry] Transient 作用域请使用 registerLazy 注册工厂，已自动降级为 Singleton: ${name}`);
        }
        this.instances.set(name, instance);
        this.recordMetadata(name, false, options);
    }

    /** 注册懒加载工厂（首次 get 时才实例化）
     *
     * 向后兼容：registerLazy(name, factory) 行为不变，默认 Singleton 作用域。
     * 增强：factory 可返回 Promise<T>，需通过 getAsync 获取。
     * 增强：options.scope=Transient 时，每次 getTransient 创建新实例。
     * 增强：options.onInit 在实例创建后调用。
     *
     * @param name - 引擎 token
     * @param factory - 同步或异步工厂；异步工厂需用 getAsync 获取
     * @param options - 作用域/依赖/初始化回调等元数据
     */
    registerLazy<K extends EngineToken>(
        name: K,
        factory: () => EngineServiceMap[K] | Promise<EngineServiceMap[K]>,
        options?: EngineRegisterOptions,
    ): void;
    /**
     * registerLazy 方法。
     * @param name - 名称
     * @param factory - 实例工厂
     * @param options - 配置项
     */
    registerLazy<T>(
        name: string,
        factory: () => T | Promise<T>,
        options?: EngineRegisterOptions,
    ): void;
    /**
     * registerLazy 方法。
     * @param name - 名称
     * @param factory - 实例工厂
     * @param options - 配置项
     */
    registerLazy<T>(
        name: string,
        factory: () => T | Promise<T>,
        options?: EngineRegisterOptions,
    ): void {
        if (this.lazyFactories.has(name) || this.instances.has(name)) {
            return;
        }
        if (this.destroyed.has(name)) {
            log.warn(`[EngineRegistry] 引擎 "${name}" 已 dispose，禁止重新注册`);
            return;
        }
        const scope = options?.scope ?? EngineScope.Singleton;
        if (scope === EngineScope.Transient) {
            // Transient 懒加载走独立存储
            this.transientFactories.set(name, factory as () => unknown);
        } else {
            this.lazyFactories.set(name, factory as () => unknown);
            this.lazyStates.set(name, 'pending');
        }
        if (options?.onInit) {
            this.onInitHooks.set(name, options.onInit);
        }
        this.recordMetadata(name, true, options);
    }

    /** 记录元数据（内部辅助） */
    private recordMetadata(name: string, lazy: boolean, options?: EngineRegisterOptions): void {
        const meta: EngineMetadata = {
            description: options?.description,
            tags: options?.tags,
            version: options?.version,
            status: 'active',
            scope: options?.scope ?? EngineScope.Singleton,
            dependencies: options?.dependencies,
            lazy,
            lazyState: lazy ? 'pending' : undefined,
        };
        this.metadata.set(name, meta);
    }

    /**
     * 检查引擎是否已注册（含懒加载工厂、瞬态工厂）
     *
     * @param name - 名称
     * @returns 是否成功
     */
    has(name: string): boolean {
        return this.instances.has(name)
            || this.lazyFactories.has(name)
            || this.transientFactories.has(name);
    }

    /** 获取引擎实例，未注册则尝试懒加载，都不存在则抛错
     *
     * 注意：仅支持同步工厂。异步工厂请使用 getAsync。
     * 已 dispose 的引擎：返回旧实例（运行时兼容），调用方应优先使用 getAsync 获取 destroyed 状态。
     * 已知 token 由 EngineServiceMap 推导返回类型；未知 token 可继续显式传泛型。
     *
     * @param name - 引擎 token
     * @returns 已注册或懒加载创建的实例
     * @throws 未注册且无工厂时抛出
     */
    get<K extends EngineToken>(name: K): EngineServiceMap[K];
    /**
     * 获取。
     * @param name - 名称
      * @returns T 实例
     */
    get<T>(name: string): T;
    /**
     * 获取。
     * @param name - 名称
      * @returns T 实例
     */
    get<T>(name: string): T {
        if (this.instances.has(name)) {
            return this.instances.get(name) as T;
        }
        const factory = this.lazyFactories.get(name);
        if (factory) {
            // 同步工厂路径（旧逻辑）
            const state = this.lazyStates.get(name);
            if (state === 'failed') {
                // 失败后允许重试：清除失败状态，重新走工厂
                this.lazyStates.set(name, 'pending');
            }
            try {
                const result = factory();
                if (result instanceof Promise) {
                    // 异步工厂不能在 get 中等待，提示使用 getAsync
                    throw new Error(
                        `[EngineRegistry] 引擎 "${name}" 注册的是异步工厂，请使用 getAsync() 获取`,
                    );
                }
                const instance = result as T;
                this.instances.set(name, instance);
                this.lazyFactories.delete(name);
                this.lazyStates.set(name, 'loaded');
                // 更新元数据
                const meta = this.metadata.get(name);
                if (meta) {
                    meta.lazyState = 'loaded';
                }
                log.info(`[EngineRegistry] 懒加载创建引擎: ${name}`);
                // 异步触发 onInit 钩子（不阻塞 get）
                const onInit = this.onInitHooks.get(name);
                if (onInit) {
                    try {
                        const r = onInit(instance);
                        if (r instanceof Promise) {
                            r.catch(e => log.warn(`[EngineRegistry] onInit 异步钩子失败: ${name}`, e));
                        }
                    } catch (e) {
                        log.warn(`[EngineRegistry] onInit 钩子失败: ${name}`, e);
                    }
                }
                return instance;
            } catch (e) {
                this.lazyStates.set(name, 'failed');
                const meta = this.metadata.get(name);
                if (meta) {
                    meta.lazyState = 'failed';
                }
                throw e;
            }
        }
        throw new Error(`[EngineRegistry] 引擎 "${name}" 未注册`);
    }

    /** 获取引擎实例，不存在返回 null（不抛错）
     *
     * 已知 token 由 EngineServiceMap 推导返回类型；未知 token 可继续显式传泛型。
     *
     * @param name - 引擎 token
     * @returns 已注册或懒加载创建的实例
     * @throws 未注册且无工厂时抛出
     */
    getOrNull<K extends EngineToken>(name: K): EngineServiceMap[K] | null;
    /**
     * getOrNull 方法。
     * @param name - 名称
      * @returns T 或 null
     */
    getOrNull<T>(name: string): T | null;
    /**
     * 获取实例；未注册/懒加载失败时返回 null，不抛错。
     *
     * @param name - 引擎 token
     * @returns 实例或 null
     */
    getOrNull<T>(name: string): T | null {
        try {
            return this.get<T>(name);
        } catch {
            return null;
        }
    }

    /** 异步获取引擎实例（支持异步工厂）
     *
     * - 已加载：直接返回
     * - 同步工厂：与 get 行为一致
     * - 异步工厂：等待 Promise resolve 后返回
     * - 加载失败：lazyState='failed'，再次调用可重试
     * - 已 dispose：抛错 `destroyed`
     * - 已 destroyed 的引擎：抛错提示
     */
    /**
     * 获取实例；支持异步工厂，等待初始化完成。
     *
     * @param name - 引擎 token
     * @returns 初始化后的实例
     * @throws 未注册、工厂失败或已销毁时抛出
     */
    async getAsync<T>(name: string): Promise<T> {
        if (this.destroyed.has(name)) {
            throw new Error(`[EngineRegistry] 引擎 "${name}" 已 dispose，禁止获取`);
        }
        if (this.instances.has(name)) {
            return this.instances.get(name) as T;
        }
        const factory = this.lazyFactories.get(name);
        if (!factory) {
            throw new Error(`[EngineRegistry] 引擎 "${name}" 未注册`);
        }
        // 失败后允许重试
        this.lazyStates.set(name, 'pending');
        const meta = this.metadata.get(name);
        if (meta) meta.lazyState = 'pending';
        try {
            const result = await Promise.resolve(factory());
            const instance = result as T;
            this.instances.set(name, instance);
            this.lazyFactories.delete(name);
            this.lazyStates.set(name, 'loaded');
            if (meta) meta.lazyState = 'loaded';
            log.info(`[EngineRegistry] 异步懒加载创建引擎: ${name}`);
            // 触发 onInit 钩子
            const onInit = this.onInitHooks.get(name);
            if (onInit) {
                await onInit(instance);
            }
            return instance;
        } catch (e) {
            this.lazyStates.set(name, 'failed');
            if (meta) meta.lazyState = 'failed';
            throw e;
        }
    }

    /** 获取项目级实例（ProjectScoped 作用域）
     *
     * - 同一 projectKey 共享同一实例
     * - 切换 projectKey 后旧实例可由 disposeProject 释放
     * - 仅对 scope=ProjectScoped 注册的引擎有意义
     * @param name - 名称
     * @param projectKey - 项目键
      * @returns T 实例
     */
    getProject<T>(name: string, projectKey: string): T {
        if (this.destroyed.has(name)) {
            throw new Error(`[EngineRegistry] 引擎 "${name}" 已 dispose，禁止获取`);
        }
        const key = projectKey || '__default__';
        let projectMap = this.projectInstances.get(key);
        if (!projectMap) {
            projectMap = new Map<string, unknown>();
            this.projectInstances.set(key, projectMap);
        }
        const existing = projectMap.get(name);
        if (existing) {
            return existing as T;
        }
        // 项目级懒加载：若注册了同名懒加载工厂，按 projectKey 创建并缓存
        const factory = this.lazyFactories.get(name);
        if (factory) {
            const instance = factory() as T;
            projectMap.set(name, instance);
            log.info(`[EngineRegistry] 创建项目级实例: ${name} [project=${key}]`);
            return instance;
        }
        // 否则回退到单例实例
        if (this.instances.has(name)) {
            return this.instances.get(name) as T;
        }
        throw new Error(`[EngineRegistry] 项目级引擎 "${name}" 未注册`);
    }

    /** 获取瞬态实例（每次创建新实例，调用方负责 dispose）
     *
     * 仅对 scope=Transient 注册的引擎有意义。
     * @param name - 名称
      * @returns T 实例
     */
    getTransient<T>(name: string): T {
        if (this.destroyed.has(name)) {
            throw new Error(`[EngineRegistry] 引擎 "${name}" 已 dispose，禁止获取`);
        }
        const factory = this.transientFactories.get(name)
            ?? this.lazyFactories.get(name);
        if (!factory) {
            throw new Error(`[EngineRegistry] 瞬态引擎 "${name}" 未注册工厂`);
        }
        return factory() as T;
    }

    /**
     * 获取懒加载状态
     *
     * @param name - 名称
      * @returns LazyState 或 null
     */
    getLazyState(name: string): LazyState | null {
        return this.lazyStates.get(name) ?? null;
    }

    /** 设置当前活跃项目 key，并自动释放非活跃项目的项目级实例
     * @param projectKey - 项目键
     * @returns 释放的实例数量
     */
    async setActiveProject(projectKey: string | null): Promise<number> {
        const newKey = projectKey || '__default__';
        let released = 0;
        if (this.currentProjectKey && this.currentProjectKey !== newKey) {
            released = await this.disposeProject(this.currentProjectKey);
        }
        this.currentProjectKey = newKey;
        return released;
    }

    // ─── Dispose 机制 ───

    /** 判断实例是否为 Disposable */
    private isDisposable(instance: unknown): instance is Disposable {
        return instance !== null
            && typeof instance === 'object'
            && typeof (instance as any)?.dispose === 'function';
    }

    /** 释放单个引擎实例
     *
     * - 调用实例的 dispose 方法（若实现 Disposable 接口）
     * - 标记为 destroyed，禁止后续 get
     * - 单个 dispose 失败不影响其他
     * @returns 是否成功 dispose（未实现 dispose 也算成功）
     */
    /**
     * 销毁单个引擎（调用其 dispose），之后禁止重新注册同名实例。
     *
     * @param name - 引擎 token
     * @returns 是否执行了销毁
     */
    async dispose(name: string): Promise<boolean> {
        const instance = this.instances.get(name);
        if (!instance) {
            // 懒加载未触发也算成功 dispose（清理元数据即可）
            this.lazyFactories.delete(name);
            this.transientFactories.delete(name);
            this.lazyStates.delete(name);
            this.onInitHooks.delete(name);
            this.metadata.delete(name);
            this.destroyed.add(name);
            return true;
        }
        try {
            if (this.isDisposable(instance)) {
                await Promise.resolve(instance.dispose());
            }
        } catch (e) {
            log.warn(`[EngineRegistry] dispose "${name}" 失败:`, e);
            // 不抛错，继续清理
        }
        this.instances.delete(name);
        this.lazyFactories.delete(name);
        this.transientFactories.delete(name);
        this.lazyStates.delete(name);
        this.onInitHooks.delete(name);
        const meta = this.metadata.get(name);
        if (meta) {
            meta.status = 'destroyed';
        }
        this.destroyed.add(name);
        log.info(`[EngineRegistry] 已 dispose 引擎: ${name}`);
        return true;
    }

    /** 释放指定项目的所有项目级实例
     *
     * - 释放 projectInstances 中该 projectKey 下的所有实例
     * - 单个 dispose 失败不影响其他
     * - 不影响单例和瞬态实例
     * @returns 释放的实例数量
     */
    /**
     * 销毁某个项目作用域下的全部引擎。
     *
     * @param projectKey - 项目键（通常是项目路径）
     * @returns 销毁的实例数
     */
    async disposeProject(projectKey: string): Promise<number> {
        const key = projectKey || '__default__';
        const projectMap = this.projectInstances.get(key);
        if (!projectMap || projectMap.size === 0) {
            return 0;
        }
        let count = 0;
        // 复制 keys 避免迭代时修改
        const names = Array.from(projectMap.keys());
        for (const name of names) {
            const instance = projectMap.get(name);
            try {
                if (this.isDisposable(instance)) {
                    await Promise.resolve((instance as Disposable).dispose());
                }
            } catch (e) {
                log.warn(`[EngineRegistry] disposeProject "${name}" 失败:`, e);
            }
            projectMap.delete(name);
            count++;
        }
        this.projectInstances.delete(key);
        if (this.currentProjectKey === key) {
            this.currentProjectKey = null;
        }
        log.info(`[EngineRegistry] 已释放项目级实例: ${count} 个 [project=${key}]`);
        return count;
    }

    /** 释放所有实例（按依赖逆序）
     *
     * - 单个 dispose 失败不影响其他
     * - 释放后所有引擎标记为 destroyed
     * @returns 释放的实例数量
     */
    /**
     * 销毁全部引擎（插件卸载时调用）。
     *
     * @returns 销毁的实例数
     */
    async disposeAll(): Promise<number> {
        // 按依赖逆序：先释放有依赖的，再释放被依赖的
        const sortedNames = this.sortByDependencyReverse();
        let count = 0;
        // 1. 释放所有项目级实例
        for (const projectKey of Array.from(this.projectInstances.keys())) {
            count += await this.disposeProject(projectKey);
        }
        // 2. 按依赖逆序释放单例
        for (const name of sortedNames) {
            if (this.instances.has(name) || this.lazyFactories.has(name)) {
                await this.dispose(name);
                count++;
            }
        }
        // 3. 清理瞬态工厂（不持有实例）
        this.transientFactories.clear();
        // 4. 旧 map 里的实例不经过 registry，必须单独冲刷写队列：
        //    StyleLearner 持有 SerializedWriter，不 flush 会让最后一批学习结果随卸载丢失。
        const pendingFlush: Promise<unknown>[] = [];
        for (const learner of this.styleLearnerInstances.values()) {
            if (typeof learner.flush === 'function') {
                pendingFlush.push(learner.flush().catch(e => log.warn('[EngineRegistry] 风格学习器冲刷失败:', e)));
            }
        }
        for (const projectMap of this.repositoryInstances.values()) {
            for (const repo of projectMap.values()) {
                const maybe = repo as { flush?: () => Promise<void> } | null;
                if (maybe && typeof maybe.flush === 'function') {
                    pendingFlush.push(maybe.flush().catch(e => log.warn('[EngineRegistry] 仓库冲刷失败:', e)));
                }
            }
        }
        await Promise.all(pendingFlush);
        this.styleLearnerInstances.clear();
        this.repositoryInstances.clear();
        log.info(`[EngineRegistry] 已释放全部实例: ${count} 个，冲刷 ${pendingFlush.length} 个写队列`);
        return count;
    }

    /** 按依赖逆序排序引擎名（拓扑排序）
     * - 被依赖的排在后面释放
     * - 仅排序已注册的引擎
     */
    private sortByDependencyReverse(): string[] {
        const names = new Set<string>([
            ...this.instances.keys(),
            ...this.lazyFactories.keys(),
        ]);
        // 构建邻接表（name -> 它依赖的引擎列表）
        const deps = new Map<string, string[]>();
        for (const name of names) {
            const meta = this.metadata.get(name);
            deps.set(name, (meta?.dependencies ?? []).filter(d => names.has(d)));
        }
        // DFS 后序：被依赖的入栈在后，dispose 时逆序出栈（先释放依赖者）
        const visited = new Set<string>();
        const result: string[] = [];
        const visiting = new Set<string>();
        const dfs = (name: string): boolean => {
            if (visited.has(name)) return true;
            if (visiting.has(name)) return false; // 环
            visiting.add(name);
            for (const dep of deps.get(name) ?? []) {
                if (!dfs(dep)) return false;
            }
            visiting.delete(name);
            visited.add(name);
            result.push(name); // 后序：依赖在前，被依赖在后
            return true;
        };
        for (const name of names) {
            if (!visited.has(name)) dfs(name);
        }
        // result 是"先依赖后自己"的顺序，dispose 逆序释放（先释放依赖者，再释放被依赖者）
        return result.reverse();
    }

    /**
     * 判断引擎是否已 dispose
     *
     * @param name - 名称
     * @returns 是否成功
     */
    isDestroyed(name: string): boolean {
        return this.destroyed.has(name);
    }

    // ─── 依赖校验 ───

    /** 校验所有已注册引擎的依赖
     *
     * - 检测依赖是否缺失
     * - 检测循环依赖（DFS 找环）
     * - 启动后可手动调用
      * @returns DependencyCheckResult 实例
     */
    verifyDependencies(): DependencyCheckResult {
        const missing: Array<{ engine: string; missingDependency: string }> = [];
        const cycles: string[][] = [];
        // 1. 缺失检测
        for (const [name, meta] of this.metadata) {
            if (!meta.dependencies) continue;
            for (const dep of meta.dependencies) {
                if (!this.has(dep) && !this.destroyed.has(dep)) {
                    missing.push({ engine: name, missingDependency: dep });
                }
            }
        }
        // 2. 环检测（DFS）
        const nodes = new Set<string>([
            ...this.instances.keys(),
            ...this.lazyFactories.keys(),
            ...this.transientFactories.keys(),
        ]);
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map<string, number>();
        for (const n of nodes) color.set(n, WHITE);
        const path: string[] = [];
        const buildDeps = (name: string): string[] => {
            const meta = this.metadata.get(name);
            return (meta?.dependencies ?? []).filter(d => nodes.has(d));
        };
        const dfs = (u: string): void => {
            color.set(u, GRAY);
            path.push(u);
            for (const v of buildDeps(u)) {
                const c = color.get(v);
                if (c === GRAY) {
                    // 找到环：截取从 v 到当前 path 末尾
                    const start = path.indexOf(v);
                    if (start >= 0) {
                        cycles.push([...path.slice(start), v]);
                    }
                } else if (c === WHITE) {
                    dfs(v);
                }
            }
            path.pop();
            color.set(u, BLACK);
        };
        for (const n of nodes) {
            if (color.get(n) === WHITE) {
                dfs(n);
            }
        }
        return {
            ok: missing.length === 0 && cycles.length === 0,
            missing,
            cycles,
        };
    }

    // ─── 元数据查询 ───

    /**
     * 获取单个引擎元数据
     *
     * @param name - 名称
      * @returns EngineMetadata 或 null
     */
    getMetadata(name: string): EngineMetadata | null {
        return this.metadata.get(name) ?? null;
    }

    /** 列出所有已注册引擎，支持筛选
     * @param filter - 过滤条件
     * @returns 引擎名 + 元数据 数组
     */
    listEngines(filter?: EngineListFilter): Array<{ name: string; metadata: EngineMetadata }> {
        const result: Array<{ name: string; metadata: EngineMetadata }> = [];
        for (const [name, meta] of this.metadata) {
            if (!filter) {
                result.push({ name, metadata: meta });
                continue;
            }
            if (filter.scope !== undefined && meta.scope !== filter.scope) continue;
            if (filter.status !== undefined && meta.status !== filter.status) continue;
            if (filter.lazy !== undefined && meta.lazy !== filter.lazy) continue;
            if (filter.tags && filter.tags.length > 0) {
                const metaTags = meta.tags ?? [];
                const hasTag = filter.tags.some(t => metaTags.includes(t));
                if (!hasTag) continue;
            }
            result.push({ name, metadata: meta });
        }
        return result;
    }

    /**
     * 统计已注册引擎数量
     *
     * @returns 数值结果
     */
    size(): number {
        return this.metadata.size;
    }

    /**
     * 获取指定项目的 StyleLearner 实例（项目级单例）
     * 同一 project 共享同一个实例，首次调用时自动创建并加载数据
     * @param project - 项目（路径或对象）
      * @returns StyleLearner 实例
     */
    async getStyleLearner(project: string): Promise<StyleLearner> {
        if (!this.plugin) {
            throw new Error('[EngineRegistry] 未初始化，无法创建 StyleLearner');
        }
        const key = project || '__default__';
        let learner = this.styleLearnerInstances.get(key);
        if (!learner) {
            learner = new StyleLearner({
                app: this.plugin.app,
                aiEngine: this.get(ENGINE_NAMES.AI_ENGINE),
                plugin: this.plugin,
                project,
            });
            await learner.loadPatterns();
            this.styleLearnerInstances.set(key, learner);
            log.info(`[EngineRegistry] 创建项目级 StyleLearner: ${project || 'default'}`);
        }
        return learner;
    }

    /**
     * 获取指定项目的 FactIndexManager（项目级单例，故事质量闭环 Task 11）
     * 同一 project 共享同一实例；落盘到项目事实索引 JSON，确认事实写入正式库。
     * @param project - 项目（路径或对象）
      * @returns FactIndexManager 实例
     */
    async getFactIndexManager(project: string): Promise<FactIndexManager> {
        if (!this.plugin) {
            throw new Error('[EngineRegistry] 未初始化，无法创建 FactIndexManager');
        }
        const key = project || '__default__';
        let mgr = this.factIndexManagers.get(key);
        if (!mgr) {
            const fs = new ObsidianFileSystem(this.plugin.app);
            mgr = new FactIndexManager(
                new VaultFactStorage(fs, pjFactIndexFile(key)),
                new VaultFactWriter(fs, key),
            );
            await mgr.load();
            this.factIndexManagers.set(key, mgr);
            log.info(`[EngineRegistry] 创建项目级 FactIndexManager: ${key}`);
        }
        return mgr;
    }

    /**
     * 获取指定项目的 Repository 实例（项目级单例）
     * 同一 project 共享同一个实例，首次调用时自动创建
     *
     * @param repoName Repository 名称（ENGINE_NAMES 中的 *_REPOSITORY）
     * @param project 项目名称
     * @param factory 创建 Repository 的工厂函数
     */
    private getProjectScopedRepository<T>(
        repoName: string,
        project: string,
        factory: (fs: import('@/shared/file-system-port').FileSystemPort, project: string) => T,
    ): T {
        if (!this.plugin) {
            throw new Error(`[EngineRegistry] 未初始化，无法创建 ${repoName}`);
        }
        const key = project || '__default__';
        let projectMap = this.repositoryInstances.get(repoName);
        if (!projectMap) {
            projectMap = new Map<string, unknown>();
            this.repositoryInstances.set(repoName, projectMap);
        }
        let repo = projectMap.get(key) as T | undefined;
        if (!repo) {
            const fs = new ObsidianFileSystem(this.plugin.app);
            repo = factory(fs, key);
            projectMap.set(key, repo);
            log.info(`[EngineRegistry] 创建项目级 ${repoName}: ${project || 'default'}`);
        }
        return repo;
    }

    /**
     * 获取指定项目的 CharacterRepository
     *
     * @param project - 项目（路径或对象）
      * @returns CharacterRepository 实例
     */
    getCharacterRepository(project: string): CharacterRepository {
        return this.getProjectScopedRepository(
            ENGINE_NAMES.CHARACTER_REPOSITORY,
            project,
            (fs, p) => new CharacterRepository(fs, p),
        );
    }

    /**
     * 获取指定项目的 ChapterRepository
     *
     * @param project - 项目（路径或对象）
      * @returns ChapterRepository 实例
     */
    getChapterRepository(project: string): ChapterRepository {
        return this.getProjectScopedRepository(
            ENGINE_NAMES.CHAPTER_REPOSITORY,
            project,
            (fs, p) => new ChapterRepository(fs, p),
        );
    }

    /**
     * 获取指定项目的 FactionRepository
     *
     * @param project - 项目（路径或对象）
      * @returns FactionRepository 实例
     */
    getFactionRepository(project: string): FactionRepository {
        return this.getProjectScopedRepository(
            ENGINE_NAMES.FACTION_REPOSITORY,
            project,
            (fs, p) => new FactionRepository(fs, p),
        );
    }

    /**
     * 获取指定项目的 LocationRepository
     *
     * @param project - 项目（路径或对象）
      * @returns LocationRepository 实例
     */
    getLocationRepository(project: string): LocationRepository {
        return this.getProjectScopedRepository(
            ENGINE_NAMES.LOCATION_REPOSITORY,
            project,
            (fs, p) => new LocationRepository(fs, p),
        );
    }

    /**
     * 获取指定项目的 ItemRepository
     *
     * @param project - 项目（路径或对象）
      * @returns ItemRepository 实例
     */
    getItemRepository(project: string): ItemRepository {
        return this.getProjectScopedRepository(
            ENGINE_NAMES.ITEM_REPOSITORY,
            project,
            (fs, p) => new ItemRepository(fs, p),
        );
    }

    /**
     * 按 8 阶段顺序初始化所有引擎
     *
     * 注意：
     * - 调用此方法后，需由 main.ts 从注册表获取实例并赋值给 Plugin 的私有字段
     * - aiEngine / coWriterEngine / analysisReportEngine 为懒加载，首次 get 时才创建
     * @param plugin - 插件实例
     * @param opts - 选项
     */
    async initialize(plugin: NovelWriterPlugin, opts: InitializeOptions): Promise<void> {
        this.plugin = plugin;

        // ─── Phase 1: 缓存管理器 ───
        log.info('[EngineRegistry] Phase 1: 初始化缓存管理器...');
        const cacheManager = new PluginCacheManager(plugin.app);
        await cacheManager.load();
        this.register(ENGINE_NAMES.CACHE_MANAGER, cacheManager);

        // ─── Phase 2: Core 服务 ───
        log.info('[EngineRegistry] Phase 2: 初始化 Core 服务...');
        const internalRegistry = new InternalRegistry();
        this.register(ENGINE_NAMES.INTERNAL_REGISTRY, internalRegistry);
        plugin.registry = internalRegistry;

        // F4（技术审计）：注入口令交互回调，启用 v2 口令派生（PBKDF2-SHA256）。
        // 旧版 seed 为公开常量可被任何人推导；v2 口令仅存于 CryptoService 内存（会话级），
        // v1 密文永久兼容读取，用户下次保存密钥时自然升级为 v2。
        // 延迟绑定：SettingsService 在本函数稍后才创建，而「是否已有密文」
        // 必须问它，所以用占位变量在回调里惰性读取。
        let settingsServiceRef: { findExistingCiphertext(): string | null } | null = null;

        const cryptoService = new CryptoService(plugin.app, {
            requestPassword: opts.passwordPort.requestPassword,
            requestNewPassword: opts.passwordPort.requestNewPassword,
            // 只要磁盘上已有 v2 密文，本次会话就禁止「设定新口令」。
            // 否则新口令会覆盖会话口令，旧密文永久解不开
            // —— 这正是「API Key 每次重启/更新后失效」的根因。
            findExistingCiphertext: () => settingsServiceRef?.findExistingCiphertext() ?? null,
        });
        this.register(ENGINE_NAMES.CRYPTO_SERVICE, cryptoService);

        const providerManager = new ProviderManager({
            getSettings: () => plugin.settings,
            saveSettings: () => plugin.saveSettings(),
            refreshContextPanel: () => plugin.refreshFullWriterContextPanel(),
            updateStatusBar: () => plugin.updateStatusBarText(),
            addOverrideHistory: (entry) => cacheManager.addModelOverrideHistory(entry),
        });
        this.register(ENGINE_NAMES.PROVIDER_MANAGER, providerManager);

        // 第二个回调提供面板尺寸（工作台三栏宽度等），由「工作台布局」页写入
        const themeManager = new ThemeManager(
            () => plugin.settings,
            () => plugin.settings.panelSizes ?? {},
        );
        this.register(ENGINE_NAMES.THEME_MANAGER, themeManager);

        const settingsService = new SettingsService({
            crypto: cryptoService,
            providerManager: providerManager,
            cacheManager: cacheManager,
            settingsWriter: opts.settingsWriter,
            getSettings: () => plugin.settings,
            setSettings: (s) => { plugin.settings = s; },
            loadData: () => plugin.loadData(),
            saveData: (d) => plugin.saveData(d),
            // 迁移/回写前保留一份 data.json.bak（仅插件目录内，不含任何用户正文）
            backupSettings: async (reason) => {
                const dir = plugin.manifest.dir;
                if (!dir) return;
                const source = `${dir}/data.json`;
                const adapter = plugin.app.vault.adapter;
                if (!(await adapter.exists(source))) return;
                try {
                    await adapter.write(`${dir}/data.json.bak`, await adapter.read(source));
                    log.info(`[EngineRegistry] 已备份设置：${reason}`);
                } catch (e) {
                    log.warn('[EngineRegistry] 设置备份失败（继续迁移）:', e);
                }
            },
        });
        this.register(ENGINE_NAMES.SETTINGS_SERVICE, settingsService);
        // 长任务统一账本：只保存内存状态，不写用户 vault
        this.register(ENGINE_NAMES.JOB_SERVICE, new JobService());
        // 回填给 CryptoService 的延迟绑定回调
        settingsServiceRef = settingsService;
        log.info('[EngineRegistry] Phase 2 完成');

        // ─── Phase 3: 基础引擎 ───
        log.info('[EngineRegistry] Phase 3: 初始化基础引擎...');
        const projectRepository = new ProjectRepository(new ObsidianFileSystem(plugin.app));
        this.register(ENGINE_NAMES.PROJECT_REPOSITORY, projectRepository);

        const contextManager = new ContextManager({ plugin, engineRegistry: this });
        this.register(ENGINE_NAMES.CONTEXT_MANAGER, contextManager);

        const foreshadowManager = new ForeshadowManager(plugin);
        this.register(ENGINE_NAMES.FORESHADOW_MANAGER, foreshadowManager);

        const reviewAgent = new ReviewAgent(plugin);
        this.register(ENGINE_NAMES.REVIEW_AGENT, reviewAgent);

        const worldviewCacheService = new WorldviewCacheService(
            new ObsidianFileSystem(plugin.app),
            new ObsidianVaultMeta(plugin.app)
        );
        this.register(ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE, worldviewCacheService);
        plugin.worldviewCacheService = worldviewCacheService;

        // TemplateService: 模板服务（无状态，可单例共享）
        const templateService = new TemplateService(plugin.app);
        this.register(ENGINE_NAMES.TEMPLATE_SERVICE, templateService);

        // ChapterVersionService: 章节版本服务（无状态，可单例共享）
        const chapterVersionService = new ChapterVersionService(plugin.app);
        this.register(ENGINE_NAMES.CHAPTER_VERSION_SERVICE, chapterVersionService);

        // TemplateManager: 模板管理器（纯 UI 服务，无状态，可单例共享；实例由组合根创建）
        const templateManager = opts.createTemplateManager();
        this.register(ENGINE_NAMES.TEMPLATE_MANAGER, templateManager);

        log.info('[小说工坊] 引擎初始化完成');

        // ─── Phase 4: 命令注册表 ───
        log.info('[EngineRegistry] Phase 4: 初始化命令注册表...');
        const commandRegistry = new CommandRegistry({
            app: plugin.app,
            registry: internalRegistry,
            aiEngine: { extractElements: (c: string) => plugin.aiEngine.extractElements(c) },
            ctxManager: contextManager,
            foreshadowManager: foreshadowManager,
            plugin: plugin,
            getActiveProject: () => plugin.getActiveProject(),
            openProviderSwitcher: () => plugin.openProviderSwitcher(),
            refreshFullWriterContextPanel: () => plugin.refreshFullWriterContextPanel(),
            populateSettingLib: () => plugin.commandPopulateSettingLib(),
            isWorkbenchContext: () => plugin._isWorkbenchContext,
            ui: plugin.commandUiPort,
        });
        commandRegistry.registerInternalCommands();
        this.register(ENGINE_NAMES.COMMAND_REGISTRY, commandRegistry);
        log.info('[EngineRegistry] Phase 4 完成');

        // ─── Phase 5: 设置加载 ───
        log.info('[小说工坊] 开始加载设置...');
        await settingsService.loadSettings();
        log.info('[小说工坊] 设置加载完成');

        // ─── Phase 6: 知识库系统 ───
        log.info('[小说工坊] 初始化写作知识库...');
        const knowledgeTagManager = new KnowledgeTagManager(plugin.app);
        this.register(ENGINE_NAMES.KNOWLEDGE_TAG_MANAGER, knowledgeTagManager);
        plugin.knowledgeTagManager = knowledgeTagManager;

        const knowledgeBaseManager = new KnowledgeBaseManager(plugin.app);
        this.register(ENGINE_NAMES.KNOWLEDGE_BASE_MANAGER, knowledgeBaseManager);
        plugin.knowledgeBaseManager = knowledgeBaseManager;

        // v4.27 性能修复：embedding 探测从 onload 关键路径移除。
        // 旧实现 `await createWithFallback()` 逐个探测 provider（每个 30s 超时），
        // Ollama 未启动/网络悬空时 onload 被阻塞 30-60 秒，期间用户看不到任何入口。
        // 现改为：立即注册 Ollama 默认 provider（不探测），后台异步探测并按需替换。
        // 首次实际 embed 调用时若探测未完成，会走 Ollama 的自然超时路径。
        const defaultEmbeddingProvider = EmbeddingProviderFactory.create({
            vectorProviderType: 'ollama',
            vectorOllamaBaseUrl: plugin.settings.vectorOllamaBaseUrl,
            vectorOllamaModel: plugin.settings.vectorOllamaModel,
            vectorOpenaiBaseUrl: plugin.settings.vectorOpenaiBaseUrl,
            vectorOpenaiModel: plugin.settings.vectorOpenaiModel,
            vectorOpenaiApiKey: plugin.settings.vectorOpenaiApiKey,
            vectorDoubaoBaseUrl: plugin.settings.vectorDoubaoBaseUrl,
            vectorDoubaoModel: plugin.settings.vectorDoubaoModel,
            vectorDoubaoApiKey: plugin.settings.vectorDoubaoApiKey,
            vectorQwenBaseUrl: plugin.settings.vectorQwenBaseUrl,
            vectorQwenModel: plugin.settings.vectorQwenModel,
            vectorQwenApiKey: plugin.settings.vectorQwenApiKey,
            embeddingEndpoint: plugin.settings.embeddingEndpoint,
            embeddingModel: plugin.settings.embeddingModel,
            embeddingFallbackPolicy: plugin.settings.embeddingFallbackPolicy,
        });
        // 全插件共享同一 embedding provider：指纹库/协同/知识库必须同模型同维度
        setSharedEmbeddingProvider(defaultEmbeddingProvider);

        // 后台探测：完成后如果主 provider 可用则替换（Ollama → 云端优先）
        void (async () => {
            try {
                const best = await EmbeddingProviderFactory.createWithFallback({
                    vectorProviderType: plugin.settings.vectorProviderType,
                    vectorOllamaBaseUrl: plugin.settings.vectorOllamaBaseUrl,
                    vectorOllamaModel: plugin.settings.vectorOllamaModel,
                    vectorOpenaiBaseUrl: plugin.settings.vectorOpenaiBaseUrl,
                    vectorOpenaiModel: plugin.settings.vectorOpenaiModel,
                    vectorOpenaiApiKey: plugin.settings.vectorOpenaiApiKey,
                    vectorDoubaoBaseUrl: plugin.settings.vectorDoubaoBaseUrl,
                    vectorDoubaoModel: plugin.settings.vectorDoubaoModel,
                    vectorDoubaoApiKey: plugin.settings.vectorDoubaoApiKey,
                    vectorQwenBaseUrl: plugin.settings.vectorQwenBaseUrl,
                    vectorQwenModel: plugin.settings.vectorQwenModel,
                    vectorQwenApiKey: plugin.settings.vectorQwenApiKey,
                    embeddingEndpoint: plugin.settings.embeddingEndpoint,
                    embeddingModel: plugin.settings.embeddingModel,
                    embeddingFallbackPolicy: plugin.settings.embeddingFallbackPolicy,
                });
                // 只在与当前不同时替换（避免无意义覆盖）
                if (best !== defaultEmbeddingProvider) {
                    setSharedEmbeddingProvider(best);
                    log.info('[EngineRegistry] embedding provider 已在后台探测后替换');
                }
            } catch (e) {
                // 探测失败保持默认 Ollama；首次实际 embed 时会自然降级
                log.info('[EngineRegistry] embedding 后台探测完成（保留默认 provider）');
            }
        })();

        const knowledgeVectorStore = new KnowledgeVectorStore(plugin.app, defaultEmbeddingProvider, undefined, {
            // 按 bookId 判存活：改名只改目录名，用 bookName 拼目录会误判孤儿
            isBookAlive: (bookId) => knowledgeBaseManager.hasBook(bookId),
        });
        this.register(ENGINE_NAMES.KNOWLEDGE_VECTOR_STORE, knowledgeVectorStore);
        plugin.knowledgeVectorStore = knowledgeVectorStore;

        const rateLimiter = new TokenBucketRateLimiter({
            tokensPerSecond: 5,
            maxTokens: 10,
        });
        const vectorEnhancer = new VectorEnhancer(defaultEmbeddingProvider, { rateLimiter });
        this.register(ENGINE_NAMES.VECTOR_ENHANCER, vectorEnhancer);

        foreshadowManager.vectorEnhancer = vectorEnhancer;

        const deconstructionScheduler = new DeconstructionScheduler(
            plugin.app,
            knowledgeBaseManager,
            undefined,
            knowledgeVectorStore,
            vectorEnhancer,
            () => plugin.settings
        );
        this.register(ENGINE_NAMES.DECONSTRUCTION_SCHEDULER, deconstructionScheduler);
        plugin.deconstructionScheduler = deconstructionScheduler;
        // 将 AIEngine 作为 LLMCaller 注入调度器。AIEngine 是懒加载的，
        // 通过 getter 延迟获取，避免在初始化阶段触发 AIEngine 的创建。
        deconstructionScheduler.setLlmCaller(() => plugin.aiEngine);
        deconstructionScheduler.setVectorModelResolver(() => {
            try {
                return getSharedEmbeddingProvider()?.getModelName();
            } catch {
                return undefined;
            }
        });

        const heavyTaskWorkerManager = new HeavyTaskWorkerManager({
            workerUrl: resolvePluginWorkerUrl(plugin.app, 'quality-worker.js') ?? undefined,
        });
        this.register(ENGINE_NAMES.HEAVY_TASK_WORKER_MANAGER, heavyTaskWorkerManager);

        const batchImportManager = new BatchImportManager(
            plugin.app,
            knowledgeBaseManager,
            deconstructionScheduler,
        );
        this.register(ENGINE_NAMES.BATCH_IMPORT_MANAGER, batchImportManager);
        plugin.batchImportManager = batchImportManager;

        await knowledgeTagManager.init();
        await knowledgeBaseManager.init();
        await knowledgeVectorStore.init();
        await batchImportManager.init();
        log.info('[小说工坊] 写作知识库初始化完成');

        // ─── Phase 7: 写作配置与知识注入 ───
        log.info('[小说工坊] 初始化写作配置与知识注入...');
        const writingProfileManager = new WritingProfileManager(plugin.app);
        this.register(ENGINE_NAMES.WRITING_PROFILE_MANAGER, writingProfileManager);
        plugin.writingProfileManager = writingProfileManager;

        const knowledgeInjector = new KnowledgeInjector(plugin.app, {
            vectorEnhancer: vectorEnhancer,
            foreshadowManager: foreshadowManager,
            // 注入共享的 WritingProfileManager，避免 KnowledgeInjector 内部 new 出多实例
            profileManager: writingProfileManager,
        });
        this.register(ENGINE_NAMES.KNOWLEDGE_INJECTOR, knowledgeInjector);
        plugin.knowledgeInjector = knowledgeInjector;

        const characterConsistencyChecker = new CharacterConsistencyChecker(vectorEnhancer);
        this.register(ENGINE_NAMES.CHARACTER_CONSISTENCY_CHECKER, characterConsistencyChecker);
        plugin.characterConsistencyChecker = characterConsistencyChecker;
        log.info('[小说工坊] 写作配置与知识注入初始化完成');

        // ─── Phase 8: 懒加载引擎注册 ───
        log.info('[EngineRegistry] Phase 8: 注册懒加载引擎...');
        this.registerLazy(ENGINE_NAMES.AI_ENGINE, () => new AIEngine(plugin));
        this.registerLazy(
            ENGINE_NAMES.CO_WRITER_ENGINE,
            () => new CoWriterEngine(plugin.app, plugin.aiEngine, plugin.ctxManager, this)
        );
        this.registerLazy(
            ENGINE_NAMES.ANALYSIS_REPORT_ENGINE,
            () => new AnalysisReportEngine(
                plugin.app,
                plugin.aiEngine,
                plugin.ctxManager,
                vectorEnhancer,
                // 注入共享的 CharacterConsistencyChecker，避免 AnalysisReportEngine 内部 new 出多实例
                characterConsistencyChecker,
            )
        );
        this.registerLazy(
            ENGINE_NAMES.SETTLEMENT_ENGINE,
            () => new SettlementEngine(plugin.app, {
                showNotice: (msg, dur) => new Notice(msg, dur),
            })
        );
        this.registerLazy(
            ENGINE_NAMES.CHAPTER_SNAPSHOT_BUILDER,
            () => new ChapterSnapshotBuilder(),
            { description: '章节故事状态快照构造器（故事质量闭环 P0-1）' }
        );
        this.registerLazy(
            ENGINE_NAMES.SCENE_GENERATION_LOOP,
            () => new SceneGenerationLoop(),
            { description: '场景级生成闭环引擎（故事质量闭环 P1-5）' }
        );
        this.registerLazy(
            ENGINE_NAMES.QUALITY_GATE,
            () => new QualityGate(),
            { description: '三层质量验收编排器（故事质量闭环 P2-9）' }
        );
        this.registerLazy(
            ENGINE_NAMES.GENERATION_CHECKPOINT_STORE,
            () => new GenerationCheckpointStore(new VaultCheckpointStorage(new ObsidianFileSystem(plugin.app))),
            { description: '生成断点存储（故事质量闭环 P1-7/10，vault 落盘）' }
        );
        this.registerLazy(
            ENGINE_NAMES.PROMPT_CACHE,
            () => getPromptCache(),
            { description: 'prompt 响应内存 LRU 缓存（P0 API 效率 P0-3，与 api-client 共享模块单例）' }
        );
        this.registerLazy(
            ENGINE_NAMES.CHARACTER_GENERATOR,
            () => new CharacterGenerator(plugin, new AIApiClient(plugin), {
                showNotice: (msg, dur) => new Notice(msg, dur),
            })
        );
        log.info('[EngineRegistry] Phase 8 完成');

        // ─── Phase 9: 更新检查器 ───
        log.info('[EngineRegistry] Phase 9: 初始化更新检查器...');
        const manifestVersion = (plugin as any).manifest?.version || PLUGIN_VERSION || '4.5.1';
        const updateChecker = new UpdateChecker(
            manifestVersion,
            cacheManager,
            {
                enabled: plugin.settings.autoCheckUpdates ?? false,
                source: (plugin.settings.updateSource as 'github' | 'custom') || 'github',
                githubRepo: plugin.settings.updateGithubRepo || GITHUB_REPO_SLUG,
                githubToken: plugin.settings.updateGithubToken || '',
                customUrl: plugin.settings.updateCustomUrl || '',
                checkIntervalHours: plugin.settings.updateCheckIntervalHours || 168,
            }
        );
        this.register(ENGINE_NAMES.UPDATE_CHECKER, updateChecker);

        // ─── Phase 10: 写作统计台账（桌面宠物 / 状态栏 / 统计弹窗共用） ───
        log.info('[EngineRegistry] Phase 10: 初始化写作统计...');
        const pluginDir = (plugin as unknown as { manifest?: { dir?: string } }).manifest?.dir
            || `${plugin.app.vault.configDir}/plugins/novel-writer-ai`;
        const writingStats = new WritingStatsService({
            app: plugin.app as unknown as WritingStatsAppLike,
            ledgerPath: `${pluginDir}/data/writing-stats.json`,
            // 判定放在 shared：services 不依赖 ui/engine
            isBodyPath: (path: string) => isChapterBodyPath(path),
            // G6-4：扫描只走三个内容根，避免每次刷新都 getFiles() 遍历整库
            listBodyFiles: () => listChapterBodyFiles<StatsFileLike>(plugin.app.vault),
        });
        this.register(ENGINE_NAMES.WRITING_STATS, writingStats);
        log.info('[EngineRegistry] 全部初始化完成');
    }
}
