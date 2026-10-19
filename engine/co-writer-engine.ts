/**
 * co-writer-engine.ts — 句级协同写作引擎 (v5.0)
 *
 * 核心职责：
 * - suggestNext(): 基于上下文+完成度，生成 3 条不同方向的续写建议
 * - validateEdit(): 验证用户手动编辑的一致性/风格/剧情对齐
 * - evaluatePlotComplete(): 评估四维剧情完成度
 * - adjustDirection(): 基于完成度短板动态调整建议方向
 * - recordInteraction(): 记录完整交互历史
 *
 * 设计原则：只调用现有模块的公开方法，不修改任何现有代码。
 *
 * ============================================================
 * 与 StepRunner 的关系
 * ============================================================
 * 本引擎是正文生成的推荐路径，与 StepRunner 中的旧 bodyGeneration 步骤
 * （AI 一次性整章生成）是两条平行的正文生成路径。
 *
 * 数据兼容性：
 * - 共享同一正文文件和 stepResults['bodyGeneration'] 存储
 * - 共享同一套 frontmatter 元数据格式（status / entityNames 等）
 * - 后续步骤（qualityControl / analysisReport / settlement）均无需区分来源
 * - 用户可随时在两条路径间切换，不会丢失数据
 *
 * @see step-definitions.ts — 完整的架构说明与废弃声明
 * ============================================================
 */

import { App, TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import NovelWriterPlugin from '../main';
import { ContextManager } from './context-manager';
import { StyleLearner } from './style-learner';
import { PreferenceMemory } from './preference-memory';
import { PromptBuilder, type PromptSnapshot } from './prompt-builder';
import { StyleFingerprintLibrary } from './style-fingerprint-library';
import { OllamaEmbeddingClient } from './ollama-embedding-client';
import { LocalVectorStore } from './local-vector-store';
import { KnowledgeBaseManager } from '../services/knowledge-base-manager';
import { KnowledgeVectorStore } from './knowledge-vector-store';
import { KnowledgeInjector } from './knowledge-injector';
import { WritingProfileManager } from './writing-profile';
import { ENGINE_NAMES } from './engine-registry';
import { entityStateChangesToFacts } from './co-writer-state-sync';
import { CharacterPairRelation, loadRelationshipStates } from './relationship-engine';
import { CrossVolumeIntegrator } from './cross-volume-integration';
import { analyzeCoherence, CoherenceReport } from './coherence-checker';
import { analyzePlotRedundancy, loadPreviousChapterBodies, PlotRedundancyReport } from './plot-redundancy-checker';
import { analyzeLogicConsistency, LogicConsistencyReport } from './logic-consistency-checker';
import { analyzeContentSafety, ContentSafetyReport } from './content-safety-checker';
import { AntiAIDetector } from './anti-ai-detector';
import { SentenceDiversityEngine } from './sentence-diversity-engine';
import { StyleSimilarityScorer } from './style-similarity-scorer';
import { VectorEnhancer } from './vector-enhancer';
import { PRECISION_MODE_SYSTEM_APPEND } from './prompts/co-write-prompts';
import { pjCharsDir } from '../shared/paths';
import { 
     CharacterSoul, 
     CharacterSoulSummary, 
     gatherAllCharacterCores, 
     buildCharacterSoulSummary, 
     formatSoulForPrompt, 
     getProtagonistSoulDetail,
     extractCharacterCoreFromContent
 } from './character-soul';
 import { EntityStateManager, EntityStateChange } from './entity-state-manager';
 import { OOCCheckResult, EmotionCurve, RhythmAnalysis, AssociationSuggestion } from '../shared/co-writer-types';
import {
    SuggestionRecord,
    SuggestionDirection,
    EditValidation,
    PlotCompletionMetrics,
    SentenceEditRecord,
    CoWritingSession
} from '../shared/types';
import { extractResponseText } from '../shared/api-response-utils';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import type { EngineRegistry } from './engine-registry';
import type { CharacterRepository, ChapterRepository } from './repository';
import { FrontmatterSerializer } from './repository/domain/serializers';
import { createLogger } from '../shared/logger';
import { resolveProviderSourceType } from '../shared/model-source';
import { getDegradationNotifier } from '../shared/degradation-notifier';


const log = createLogger('CoWriterEngine');
let ollamaModelCache: string[] | null = null;
let ollamaCacheTime: number = 0;
const OLLAMA_CACHE_TTL = 5 * 60 * 1000;
const OLLAMA_ENDPOINT = 'http://localhost:11434';

// ============================================================
// 类型导出 — 已迁移至 ./co-writer/co-writer-types.ts (P1-4 拆分阶段一)
// 此处通过 re-export 保持外部 import 路径向后兼容。
// ============================================================
export type {
    WritingMode,
    PlotNode,
    PlotProgress,
    Suggestion,
    ContextSnapshot,
    SettingGuardReport,
} from './co-writer/co-writer-types';
import type {
    WritingMode,
    PlotNode,
    PlotProgress,
    Suggestion,
    ContextSnapshot,
    SettingGuardReport,
} from './co-writer/co-writer-types';

// ============================================================
// CoWriterEngine
// ============================================================

/**
 * v6.3: 协同写作交互历史上限。
 * 此前 interactionHistory / session.interactions 只增不减（长会话下线性增长）；
 * 与 UI 侧 suggestionHistory（限 20）保持同一量级思路，同时保留足够的回溯上下文。
 */
const MAX_INTERACTION_HISTORY = 200;

export class CoWriterEngine {
    private app: App;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private snapshot: ContextSnapshot | null = null;
    private session: CoWritingSession | null = null;
    private interactionHistory: SentenceEditRecord[] = [];
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;
     
     // A1: 角色灵魂数据
     private soulData: CharacterSoulSummary | null = null;
     
     // D1: 实体状态管理器
     private entityStateManager: EntityStateManager | null = null;
     private pendingStateChanges: EntityStateChange[] = [];

     // E1/E3: 风格自学习与偏好记忆
     private styleLearner: StyleLearner | null = null;
     private preferenceMemory: PreferenceMemory | null = null;
    private promptBuilder: PromptBuilder | null = null;

    // E4: 写作指纹库
    private fingerprintLibrary: StyleFingerprintLibrary | null = null;
    private vectorStore: LocalVectorStore | null = null;

    // E5: 写作知识库
    private knowledgeManager: KnowledgeBaseManager | null = null;
    private knowledgeVectorStore: KnowledgeVectorStore | null = null;
    private referenceBookIds: string[] = [];
    public lastKnowledgeCount: number = 0;
    public directionKnowledgeCounts: Record<string, number> = {};

    // E6: 知识注入器（全流程知识一致性）
    private knowledgeInjector: KnowledgeInjector | null = null;
    private writingProfileManager: WritingProfileManager | null = null;

    // 精准模式
    private precisionMode: boolean = false;
    private antiAIDetector: AntiAIDetector;
    private diversityEngine: SentenceDiversityEngine;
    private styleScorer?: StyleSimilarityScorer;
    private vectorEnhancer?: VectorEnhancer;

    // Task 2.1: Repository 接入
    private engineRegistry: EngineRegistry | null = null;
    private characterRepo: CharacterRepository | null = null;
    private chapterRepo: ChapterRepository | null = null;

    // 性能埋点统计
    private repoPerfStats = {
        totalAccesses: 0,
        charRepoHits: 0,
        charRepoMisses: 0,
        chapRepoHits: 0,
        chapRepoMisses: 0,
    };

    constructor(app: App, aiEngine: AIEngine, contextManager: ContextManager, engineRegistry?: EngineRegistry) {
        this.app = app;
        this.aiEngine = aiEngine;
        this.contextManager = contextManager;
        this.antiAIDetector = new AntiAIDetector();
        this.diversityEngine = new SentenceDiversityEngine();
        if (engineRegistry) {
            this.engineRegistry = engineRegistry;
        }
    }

    setPrecisionMode(enabled: boolean): void {
        this.precisionMode = enabled;
    }

    getPrecisionMode(): boolean {
        return this.precisionMode;
    }

    getFingerprintLibrary(): StyleFingerprintLibrary | null {
        return this.fingerprintLibrary;
    }

    /**
     * v6.5: 获取协同写作使用的模型（强制本地，不回退远程）
     */
    private getCoWriteModel(): string | undefined {
        const settings = this.aiEngine.getPlugin()?.settings;
        if (!settings) return undefined;
        const mode = settings.coWriteModelMode || 'local';
        if (mode === 'cloud') {
            return settings.coWriteCloudModel || settings.defaultModel || undefined;
        }
        return resolveCoWriteLocalModel(settings);
    }

    private async callCoWriteAI(
        prompt: { system: string; user: string },
        tempDelta: number,
        signal?: AbortSignal
    ): ReturnType<AIEngine['callAI']> {
        const settings = this.aiEngine.getPlugin()?.settings;
        const temperature = (settings?.coWriteTemperature ?? 0.7) + tempDelta;
        const maxTokens = settings?.coWriteMaxTokens ?? 600;
        return this.aiEngine.callAI(
            prompt.system,
            prompt.user,
            this.getCoWriteModel(),
            temperature,
            maxTokens,
            this.getCoWriteOptions({ signal })
        );
    }

    /**
     * v6.5: 获取协同写作的 callAI options（本地模型使用 Ollama 端点 + settings 参数）
     */
    private getCoWriteOptions(base?: { signal?: AbortSignal }): { signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean } {
        const opts: { signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean } = {};
        if (base?.signal) opts.signal = base.signal;
        const settings = this.aiEngine.getPlugin()?.settings;
        if (!settings) return opts;

        const mode = settings.coWriteModelMode || 'local';

        if (mode === 'cloud') {
            // 云端模式：根据供应商查找端点和 API Key
            const providerId = settings.coWriteCloudProvider || '';
            if (providerId) {
                // 从自定义供应商查找
                const custom = settings.customProviders?.find(p => p.id === providerId);
                if (custom?.endpoint) {
                    opts.endpoint = custom.endpoint;
                }
                // API Key
                const apiKey = settings.providerKeys?.[providerId] || '';
                if (apiKey) {
                    opts.apiKey = apiKey;
                }
            }
            // 云端模式允许 fallback
            opts.disableFallback = false;
        } else {
            // 本地模式：使用 Ollama 端点
            const model = settings.coWriteModel;
            if (model) {
                const ollamaProvider = settings.customProviders?.find(p => p.id === 'ollama');
                if (ollamaProvider?.endpoint) {
                    opts.endpoint = ollamaProvider.endpoint;
                    opts.apiKey = 'ollama';
                }
            }
            opts.disableFallback = true;
        }
        return opts;
    }

    private hasCoWriteModel(): boolean {
        const settings = this.aiEngine.getPlugin()?.settings;
        if (!settings) return false;
        const mode = settings.coWriteModelMode || 'local';
        if (mode === 'cloud') {
            return !!(settings.coWriteCloudModel || settings.defaultModel);
        }
        return !!resolveCoWriteLocalModel(settings);
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

    // ============================================================
    // Task 2.1: Repository 初始化与访问
    // ============================================================

    /**
     * 初始化 Repository 实例
     * 优先从构造函数传入的 engineRegistry 获取，其次从 plugin.engineRegistry 获取
     */
    private initializeRepositories(project: string): void {
        try {
            // 优先使用构造函数传入的 engineRegistry
            let registry = this.engineRegistry;
            
            // 其次从 plugin 获取
            if (!registry) {
                const plugin = this.aiEngine.getPlugin();
                if (plugin && (plugin as any).engineRegistry) {
                    registry = (plugin as any).engineRegistry as EngineRegistry;
                    this.engineRegistry = registry;
                }
            }

            if (registry && project) {
                this.characterRepo = registry.getCharacterRepository(project);
                this.chapterRepo = registry.getChapterRepository(project);
                log.info('[CoWriterEngine] Repository 初始化完成');
            }
        } catch (e) {
            log.warn('[CoWriterEngine] Repository 初始化失败，使用回退模式:', e);
            this.characterRepo = null;
            this.chapterRepo = null;
        }
    }

    /**
     * 获取 Repository 性能统计
     */
    getRepositoryPerfStats(): typeof this.repoPerfStats {
        return { ...this.repoPerfStats };
    }

    /**
     * 重置 Repository 性能统计
     */
    resetRepositoryPerfStats(): void {
        this.repoPerfStats = {
            totalAccesses: 0,
            charRepoHits: 0,
            charRepoMisses: 0,
            chapRepoHits: 0,
            chapRepoMisses: 0,
        };
    }

    // ============================================================
    // 初始化
    // ============================================================

    async init(
        project: string,
        chapterName: string,
        volume: string = '第1卷',
        chapterNum: number = 1
    ): Promise<void> {
        // Task 2.1: 初始化 Repository（优先从 engineRegistry 获取，其次从 plugin 获取）
        this.initializeRepositories(project);

        try {
            // 1. 采集上下文
            const ctx = await this.contextManager.gatherAll(project, chapterName);
            this.snapshot = this.buildSnapshot(ctx, project, chapterName);

            // 2. 初始化会话
            this.session = {
                project,
                chapterName,
                volume,
                chapterNum,
                startedAt: Date.now(),
                interactions: [],
                currentMetrics: this.getEmptyMetrics(),
                totalWordCount: 0
            };

            log.info('[CoWriterEngine] 初始化完成:', project, chapterName);
        } catch (e) {
            log.warn('[CoWriterEngine] 初始化失败，使用降级模式:', e);
            // 降级：创建一个最小 snapshot
            this.snapshot = {
                project,
                chapterName,
                allChars: '',
                allFactions: '',
                allLocs: '',
                allItems: '',
                foreshadows: { unrevealed: [], revealed: [], abandoned: [] },
                relationshipStates: [],
                crossVolumeContext: '',
                worldView: '',
                worldType: '',
                writingStyle: '',
                writingRules: '',
                protagonistSoulDetail: '',
                emotionPlan: '',
                sceneExpansion: '',
                chapPlan: '',
                prevChaptersSummary: '',
                settingLib: '',
                timeline: '',
                characterCores: '',
                triggeredMemories: '',
                precedingText: '',
                cursorHint: '',
                currentMode: 'continue',
                gatheredAt: Date.now(),
                dirtyFields: new Set()
            };
        }
        
        // ===== A1: 角色灵魂层采集 =====
        try {
            let souls: CharacterSoul[] = [];
            
            // Task 2.1: 优先通过 CharacterRepository 读取（利用缓存）
            if (this.characterRepo) {
                const allChars = await this.characterRepo.findAll();
                this.repoPerfStats.totalAccesses++;
                if (allChars.length > 0) {
                    this.repoPerfStats.charRepoHits++;
                    for (const char of allChars) {
                        const fmYaml = FrontmatterSerializer.serialize(char.frontmatter);
                        const fullContent = fmYaml ? `---\n${fmYaml}---\n${char.body}` : char.body;
                        const soul = extractCharacterCoreFromContent(char.name, fullContent);
                        souls.push(soul);
                    }
                    log.info('[CoWriterEngine] A1: 通过 CharacterRepository 采集灵魂层:', souls.length, '个角色');
                } else {
                    this.repoPerfStats.charRepoMisses++;
                }
            }
            
            // Fallback: 原有的文件直接读取方式
            if (souls.length === 0) {
                const charFolderPath = pjCharsDir(project);
                const mdFiles = this.getVaultMeta().getFiles().filter((f: TFile) =>
                    f.path.startsWith(charFolderPath + '/') && f.path.endsWith('.md'));

                if (mdFiles.length > 0) {
                    souls = await gatherAllCharacterCores(mdFiles, this.app.vault);
                    log.info('[CoWriterEngine] A1: 通过文件直接读取采集灵魂层:', souls.length, '个角色');
                }
            }

            if (souls.length > 0) {
                const protagonistName = this.getProtagonistName(project);
                this.soulData = buildCharacterSoulSummary(souls, protagonistName);
                log.info('[CoWriterEngine] A1: 角色灵魂层采集完成:', souls.length, '个角色');
            }
        } catch (e) {
            log.warn('[CoWriterEngine] A1: 灵魂层采集失败，继续无灵魂模式:', e);
        }

        // ===== A4: 加载角色关系状态 =====
        try {
            if (this.snapshot) {
                this.snapshot.relationshipStates = await loadRelationshipStates(this.app, project);
                log.info('[CoWriterEngine] A4: 关系状态加载完成:', this.snapshot.relationshipStates.length, '组关系');
            }
        } catch (e) {
            log.warn('[CoWriterEngine] A4: 关系状态加载失败，继续无关系驱动:', e);
        }

        // ===== D2: 加载跨卷状态快照上下文（仅非首卷需要） =====
        try {
            if (this.snapshot && volume && volume !== '第1卷') {
                const integrator = new CrossVolumeIntegrator(this.app);
                const ctx = await integrator.getSnapshotContext(project, volume);
                if (ctx && ctx.trim()) {
                    this.snapshot.crossVolumeContext = ctx.trim();
                    log.info('[CoWriterEngine] D2: 跨卷状态快照加载完成，', this.snapshot.crossVolumeContext.length, '字');
                }
            }
        } catch (e) {
            log.warn('[CoWriterEngine] D2: 跨卷状态快照加载失败，继续无跨卷上下文:', e);
        }
        
        // ===== D1: 初始化实体状态管理器 =====
        try {
            this.entityStateManager = new EntityStateManager({
                app: this.app,
                plugin: this.aiEngine.getPlugin(),
                aiEngine: this.aiEngine,
                characterRepository: this.characterRepo,
                engineRegistry: this.engineRegistry,
            });
        } catch (e) {
            log.warn('[CoWriterEngine] D1: 实体状态管理器初始化失败:', e);
        }

        // ===== E1/E3: 初始化风格自学习与偏好记忆 =====
        try {
            const plugin = this.aiEngine.getPlugin();
            this.styleLearner = await plugin.engineRegistry.getStyleLearner(project);

            this.preferenceMemory = new PreferenceMemory({ app: this.app, plugin, project });
            await this.preferenceMemory.loadPreferences();

            // ===== E4: 初始化写作指纹库 =====
            try {
                const settings = plugin?.settings;
                const embeddingEndpoint = settings?.embeddingEndpoint || 'http://localhost:11434';
                const embeddingModel = settings?.embeddingModel || 'bge-m3';

                this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, project);
                await this.fingerprintLibrary.loadGlobal();
                await this.fingerprintLibrary.loadProject();
                await this.fingerprintLibrary.loadGlobalState(project);

                const embeddingClient = new OllamaEmbeddingClient(embeddingEndpoint, embeddingModel);
                this.vectorStore = new LocalVectorStore(this.app, 'project', embeddingClient, project);

                log.info('[CoWriterEngine] E4: 写作指纹库加载完成');
            } catch (fpErr) {
                log.warn('[CoWriterEngine] E4: 写作指纹库初始化失败，继续无指纹模式:', fpErr);
                this.fingerprintLibrary = null;
                this.vectorStore = null;
            }

            // 装配 PromptBuilder：此前仅声明字段从未实例化，导致 A2/A3/A4/D2/E1/E3
            // 所有注入片段在协同写作中被 ?. 短路成空数组（注入逻辑长期静默失效）。
            this.promptBuilder = new PromptBuilder(
                () => this.snapshot as unknown as PromptSnapshot | null,
                this.styleLearner,
                this.preferenceMemory,
                this.fingerprintLibrary,
                this.vectorStore
            );

            // ===== E5: 初始化写作知识库 =====
            try {
                const settings = plugin?.settings;
                const embeddingEndpoint = settings?.embeddingEndpoint || 'http://localhost:11434';
                const embeddingModel = settings?.embeddingModel || 'bge-m3';

                // 通过 EngineRegistry 获取共享实例（registry 已在 initialize 阶段调用 init()）
                this.knowledgeManager = plugin.engineRegistry.get<KnowledgeBaseManager>(ENGINE_NAMES.KNOWLEDGE_BASE_MANAGER);

                const kbEmbeddingClient = new OllamaEmbeddingClient(embeddingEndpoint, embeddingModel);
                this.knowledgeVectorStore = new KnowledgeVectorStore(this.app, kbEmbeddingClient);
                await this.knowledgeVectorStore.init();

                try {
                    this.vectorEnhancer = new VectorEnhancer(kbEmbeddingClient);
                    if (this.vectorEnhancer && this.knowledgeVectorStore) {
                        this.styleScorer = new StyleSimilarityScorer(this.vectorEnhancer, this.knowledgeVectorStore);
                    }
                    log.info('[CoWriterEngine] 精准模式: 向量增强器与风格相似度评分器初始化完成');
                } catch (veErr) {
                    log.warn('[CoWriterEngine] 精准模式: 向量增强器初始化失败，精准模式降级:', veErr);
                    // A3: 精准模式是用户主动选择的档位，初始化失败原先只写日志（黑箱）。
                    // 上报统一降级事件，让用户明确知道精准模式已退化为统计模式。
                    getDegradationNotifier().notify({
                        source: 'vector',
                        dimension: 'co-write',
                        from: 'vector',
                        to: 'statistics',
                        reason: veErr instanceof Error ? veErr.message : String(veErr),
                        severity: 'warning',
                        recoverable: true,
                    });
                    this.vectorEnhancer = undefined;
                    this.styleScorer = undefined;
                }

                if (this.promptBuilder) {
                    this.promptBuilder.setKnowledgeBase(this.knowledgeManager, this.knowledgeVectorStore);
                }

                // 从 plugin 同步 referenceBookIds
                const pluginRef = plugin?.referenceBookIds;
                if (pluginRef && pluginRef.length > 0) {
                    this.referenceBookIds = [...pluginRef];
                    if (this.promptBuilder) {
                        this.promptBuilder.setReferenceBooks(this.referenceBookIds);
                    }
                }

                log.info('[CoWriterEngine] E5: 写作知识库加载完成');
            } catch (kbErr) {
                log.warn('[CoWriterEngine] E5: 写作知识库初始化失败，继续无知识库模式:', kbErr);
                this.knowledgeManager = null;
                this.knowledgeVectorStore = null;
            }

            // ===== E6: 初始化知识注入器（全流程知识一致性） =====
            try {
                // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
                this.writingProfileManager = plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
                this.knowledgeInjector = plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
                log.info('[CoWriterEngine] E6: 知识注入器初始化完成');
            } catch (kiErr) {
                log.warn('[CoWriterEngine] E6: 知识注入器初始化失败，继续无注入模式:', kiErr);
                this.knowledgeInjector = null;
                this.writingProfileManager = null;
            }

            log.info('[CoWriterEngine] E1/E3: 风格与偏好记忆加载完成');
        } catch (e) {
            log.warn('[CoWriterEngine] E1/E3: 风格与偏好记忆初始化失败:', e);
        }

        // ===== v6.4: 提取剧情节点，初始化进度追踪 =====
        try {
            this.plotNodes = this.extractPlotNodes();
            log.info('[CoWriterEngine] v6.4: 剧情节点提取完成，共', this.plotNodes.length, '个节点');
        } catch (e) {
            log.warn('[CoWriterEngine] v6.4: 剧情节点提取失败:', e);
            this.plotNodes = [];
        }
    }

    // ============================================================
    // 核心 API 1：生成 3 条建议（含方向标记）
    // ============================================================

    async suggestNext(
        precedingText: string,
        cursorHint: string = '',
        mode: WritingMode = 'continue',
        count: number = 3,
        signal?: AbortSignal,
        onChunk?: (index: number, cumulativeText: string) => void
    ): Promise<SuggestionRecord[]> {
        if (!this.snapshot) {
            log.warn('[CoWriterEngine] 未初始化，返回空建议');
            return [];
        }
        if (!this.hasCoWriteModel()) {
            log.warn('[CoWriterEngine] 协同写作未配置本地模型，跳过建议生成');
            return [];
        }

        // 获取推荐方向（基于完成度动态调整）
        const directions = this.getRecommendDirections(count);

        const settings = this.aiEngine.getPlugin()?.settings;
        this.directionKnowledgeCounts = {};

        let fingerprintParts: string[] = [];
        try {
            if (this.promptBuilder) {
                fingerprintParts = await this.promptBuilder.getFingerprintPromptParts(precedingText);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 指纹 prompt 生成失败，跳过:', e);
        }

        // E6: 全流程知识一致性注入 + 知识库深度注入
        let knowledgeInjection = '';
        let kbDeepInjection = '';
        try {
            if (this.knowledgeInjector && this.writingProfileManager && this.session) {
                if (this.fingerprintLibrary) {
                    (this.knowledgeInjector as any).fingerprintLibrary = this.fingerprintLibrary;
                }
                if (this.knowledgeManager && this.knowledgeVectorStore) {
                    this.knowledgeInjector.setKnowledgeBase(this.knowledgeManager, this.knowledgeVectorStore);
                }
                const profile = await this.writingProfileManager.load(this.session.project);
                if (profile && profile.fingerprint.injectionStrength > 0) {
                    const chapterMatch = this.session.chapterName.match(/第(\d+)章/);
                    const chapterIndex = chapterMatch ? parseInt(chapterMatch[1], 10) : undefined;
                    knowledgeInjection = await this.knowledgeInjector.injectForBodyGeneration(profile, {
                        projectPath: this.session.project,
                        chapterIndex,
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    });

                    kbDeepInjection = await this.knowledgeInjector.injectKnowledgeBase({
                        projectPath: this.session.project,
                        chapterIndex,
                        sceneType: this.detectSceneType(precedingText),
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    }, profile.fingerprint.injectionStrength);
                }
            }
        } catch (e) {
            log.warn('[CoWriterEngine] E6: 知识注入失败，跳过:', e);
        }

        const recentSentences = this.precisionMode
            ? this.extractRecentSentences(precedingText)
            : [];

        // P0-1: 三候选并行化（spec p0-api-efficiency-optimization AC-1.*，决策 D-4）
        // 原为 for 循环串行逐方向 await 完整 AI 调用；现抽为独立任务并行执行。
        // candidateParallel=false 时回退串行（本地小模型并发能力弱时可关闭）。
        // 注意：工厂函数惰性启动，避免 map 阶段就把所有任务并发跑出去。
        const makeTasks = directions.slice(0, Math.min(count, directions.length)).map((direction, i) => () =>
            this.generateDirectionalCandidate(i, direction, {
                precedingText,
                cursorHint,
                fingerprintParts,
                knowledgeInjection,
                kbDeepInjection,
                recentSentences,
                signal,
                settings,
                onChunk,
            })
        );

        const collected: Array<SuggestionRecord | null> = [];
        if (settings?.candidateParallel !== false) {
            const results = await Promise.allSettled(makeTasks.map((make) => make()));
            for (const r of results) {
                collected.push(r.status === 'fulfilled' ? r.value : null);
            }
        } else {
            for (const make of makeTasks) {
                try {
                    collected.push(await make());
                } catch (e) {
                    // 单方向失败不影响其余（与原 catch-continue 语义一致）
                    log.warn('[CoWriterEngine] 串行候选生成失败，跳过该方向:', e);
                }
            }
        }

        const suggestions = collected.filter((s): s is SuggestionRecord => s !== null);

        // C1: 提前剧透检测——为每条建议标注剧透/越界风险
        return suggestions.map(s => this.annotateSuggestionRisk(s));
    }

    /**
     * P0-1: 单方向候选生成任务（原 suggestNext for 循环体抽离，逻辑保持不变）。
     * 返回 null 表示该方向未产出（失败/中断/空响应），由调用方丢弃。
     */
    private async generateDirectionalCandidate(
        i: number,
        direction: SuggestionDirection,
        shared: {
            precedingText: string;
            cursorHint: string;
            fingerprintParts: string[];
            knowledgeInjection: string;
            kbDeepInjection: string;
            recentSentences: string[];
            signal?: AbortSignal;
            settings?: { coWriteTemperature?: number };
            onChunk?: (index: number, cumulativeText: string) => void;
        },
    ): Promise<SuggestionRecord | null> {
        let knowledgeParts: string[] = [];
        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(shared.precedingText, direction);
            }
        } catch (e) {
            log.warn(`[CoWriterEngine] 知识库检索失败 (方向: ${direction}):`, e);
            knowledgeParts = [];
        }
        const kpCount = knowledgeParts.filter(p => p && p.trim().length > 0).length;
        this.lastKnowledgeCount = kpCount;
        this.directionKnowledgeCounts[direction] = kpCount;

        const combinedInjection = [shared.knowledgeInjection, shared.kbDeepInjection].filter(Boolean).join('\n\n');
        const prompt = this.buildDirectionalPrompt(shared.precedingText, direction, shared.cursorHint, shared.fingerprintParts, knowledgeParts, combinedInjection);

        if (this.precisionMode) {
            try {
                prompt.system += PRECISION_MODE_SYSTEM_APPEND;

                const antiAIResult = this.antiAIDetector.buildAntiAIConstraints({ recentSentences: shared.recentSentences });
                if (antiAIResult.constraints) {
                    prompt.system += '\n\n【反AI约束】\n' + antiAIResult.constraints;
                }

                const diversityResult = this.diversityEngine.analyzeDiversity(shared.recentSentences);
                if (diversityResult.needsAdjustment && diversityResult.mergedHint) {
                    prompt.system += '\n\n【多样性调整】\n' + diversityResult.mergedHint;
                }

                log.info('[CoWriterEngine] 精准模式: 约束已注入 (方向:', direction, ')');
            } catch (pmErr) {
                log.warn('[CoWriterEngine] 精准模式: 约束注入失败，继续生成:', pmErr);
            }
        }

        let retryCount = 0;
        const maxRetries = this.precisionMode ? 2 : 0;
        let generatedText = '';

        while (retryCount <= maxRetries) {
            try {
                if (shared.signal?.aborted) return null;
                const tempDelta = i * 0.05 - retryCount * 0.1;
                // NBI-03: 有分片回调时走流式，无回调保持原非流式路径（兼容浮动面板与既有调用）
                if (shared.onChunk) shared.onChunk(i, '');
                generatedText = await this.callCoWriteText(
                    prompt,
                    tempDelta,
                    shared.signal,
                    shared.onChunk ? (text) => shared.onChunk!(i, text) : undefined
                );

                if (!generatedText) break;

                if (this.precisionMode && this.styleScorer) {
                    try {
                        const scoreResult = await this.styleScorer.score(generatedText, {
                            position: shared.precedingText.length
                        });

                        if (!scoreResult.passed && !scoreResult.degraded && retryCount < maxRetries) {
                            log.info('[CoWriterEngine] 精准模式: 相似度不足 (', scoreResult.score, '), 重试', retryCount + 1, '/', maxRetries);
                            if (scoreResult.retryHint) {
                                prompt.system += '\n' + scoreResult.retryHint;
                            }
                            retryCount++;
                            continue;
                        }

                        if (scoreResult.passed) {
                            log.info('[CoWriterEngine] 精准模式: 相似度通过 (', scoreResult.score, ')');
                        }
                    } catch (scoreErr) {
                        log.warn('[CoWriterEngine] 精准模式: 相似度评分失败，跳过评分:', scoreErr);
                    }
                }

                break;
            } catch (e) {
                log.warn(`[CoWriterEngine] 建议生成失败 (方向: ${direction}):`, e);
                break;
            }
        }

        // 分片期间被中止时丢弃半成品，避免生成不完整候选
        if (shared.signal?.aborted) return null;
        if (!generatedText) return null;
        return {
            id: `sug_${Date.now()}_${i}`,
            text: generatedText,
            direction,
            style: i === 0 ? 'default' : (i === 1 ? 'creative' : 'conservative'),
            temperature: (shared.settings?.coWriteTemperature ?? 0.7) + i * 0.05,
            preview: generatedText.slice(0, 30) + (generatedText.length > 30 ? '...' : ''),
        };
    }

    async *suggestStream(
        precedingText: string,
        cursorHint: string = '',
        mode: WritingMode = 'continue',
        directionIndex: number = 0,
        signal?: AbortSignal
    ): AsyncGenerator<string, SuggestionRecord | null, unknown> {
        if (!this.snapshot) {
            log.warn('[CoWriterEngine] 未初始化，返回空建议');
            return null;
        }
        if (!this.hasCoWriteModel()) {
            log.warn('[CoWriterEngine] 协同写作未配置本地模型，跳过建议生成');
            return null;
        }

        const directions = this.getRecommendDirections(3);
        if (directionIndex >= directions.length) {
            directionIndex = 0;
        }
        const direction = directions[directionIndex];
        const settings = this.aiEngine.getPlugin()?.settings;

        let fingerprintParts: string[] = [];
        try {
            if (this.promptBuilder) {
                fingerprintParts = await this.promptBuilder.getFingerprintPromptParts(precedingText, direction);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 指纹 prompt 生成失败，跳过:', e);
        }

        let knowledgeParts: string[] = [];
        let knowledgeInjection = '';
        let kbDeepInjection = '';
        try {
            if (this.knowledgeInjector && this.writingProfileManager && this.session) {
                if (this.fingerprintLibrary) {
                    (this.knowledgeInjector as any).fingerprintLibrary = this.fingerprintLibrary;
                }
                if (this.knowledgeManager && this.knowledgeVectorStore) {
                    this.knowledgeInjector.setKnowledgeBase(this.knowledgeManager, this.knowledgeVectorStore);
                }
                const profile = await this.writingProfileManager.load(this.session.project);
                if (profile && profile.fingerprint.injectionStrength > 0) {
                    const chapterMatch = this.session.chapterName.match(/第(\d+)章/);
                    const chapterIndex = chapterMatch ? parseInt(chapterMatch[1], 10) : undefined;
                    knowledgeInjection = await this.knowledgeInjector.injectForBodyGeneration(profile, {
                        projectPath: this.session.project,
                        chapterIndex,
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    });

                    kbDeepInjection = await this.knowledgeInjector.injectKnowledgeBase({
                        projectPath: this.session.project,
                        chapterIndex,
                        sceneType: this.detectSceneType(precedingText),
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    }, profile.fingerprint.injectionStrength);
                }
            }
        } catch (e) {
            log.warn('[CoWriterEngine] E6: 知识注入失败，跳过:', e);
        }

        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(precedingText, direction);
            }
        } catch (e) {
            log.warn(`[CoWriterEngine] 知识库检索失败 (方向: ${direction}):`, e);
            knowledgeParts = [];
        }

        const combinedInjection = [knowledgeInjection, kbDeepInjection].filter(Boolean).join('\n\n');
        const prompt = this.buildDirectionalPrompt(precedingText, direction, cursorHint, fingerprintParts, knowledgeParts, combinedInjection);

        if (this.precisionMode) {
            try {
                const { PRECISION_MODE_SYSTEM_APPEND } = await import('./prompts/co-write-prompts');
                prompt.system += PRECISION_MODE_SYSTEM_APPEND;
            } catch {
            }
        }

        const tempDelta = directionIndex * 0.05;
        let generatedText = '';

        try {
            const finalResponse = yield* this.callCoWriteAIStream(prompt, tempDelta, signal);
            generatedText = finalResponse.content;

            if (!generatedText) {
                return null;
            }

            if (this.precisionMode && this.styleScorer) {
                try {
                    const scoreResult = await this.styleScorer.score(generatedText, {
                        position: precedingText.length
                    });
                    log.info('[CoWriterEngine] 精准模式: 流式生成相似度评分 (', scoreResult.score, ')');
                } catch (scoreErr) {
                    log.warn('[CoWriterEngine] 精准模式: 相似度评分失败，跳过评分:', scoreErr);
                }
            }

            const suggestion: SuggestionRecord = {
                id: `sug_stream_${Date.now()}_${directionIndex}`,
                text: generatedText,
                direction,
                style: directionIndex === 0 ? 'default' : (directionIndex === 1 ? 'creative' : 'conservative'),
                temperature: (settings?.coWriteTemperature ?? 0.7) + tempDelta,
                preview: generatedText.slice(0, 30) + (generatedText.length > 30 ? '...' : '')
            };

            return this.annotateSuggestionRisk(suggestion);
        } catch (e) {
            log.warn(`[CoWriterEngine] 流式建议生成失败 (方向: ${direction}):`, e);
            return null;
        }
    }

    suggestParallel(
        precedingText: string,
        cursorHint: string = '',
        mode: WritingMode = 'continue',
        count: number = 3,
        options?: { timeoutMs?: number; maxRetries?: number }
    ): import('./co-writer/parallel-suggestions').ParallelSuggestionResult {
        const { ParallelSuggestionGenerator } = require('./co-writer/parallel-suggestions');

        if (!this.snapshot) {
            log.warn('[CoWriterEngine] 未初始化，返回空结果');
            return {
                handles: [],
                allCompleted: Promise.resolve([]),
                cancel: () => {},
            };
        }
        if (!this.hasCoWriteModel()) {
            log.warn('[CoWriterEngine] 协同写作未配置本地模型，跳过并行建议生成');
            return {
                handles: [],
                allCompleted: Promise.resolve([]),
                cancel: () => {},
            };
        }

        const directions = this.getRecommendDirections(count);

        const factory: import('./co-writer/parallel-suggestions').StreamGeneratorFactory = (
            direction,
            directionIndex,
            signal
        ) => {
            return this.suggestStreamInternal(
                precedingText,
                cursorHint,
                mode,
                direction,
                directionIndex,
                signal
            );
        };

        const generator = new ParallelSuggestionGenerator(factory, directions, {
            count,
            timeoutMs: options?.timeoutMs ?? 30000,
            maxRetries: options?.maxRetries ?? 1,
        });

        return generator.generate(precedingText);
    }

    private async *suggestStreamInternal(
        precedingText: string,
        cursorHint: string,
        mode: WritingMode,
        direction: SuggestionDirection,
        directionIndex: number,
        signal?: AbortSignal
    ): AsyncGenerator<string, SuggestionRecord | null, unknown> {
        if (!this.snapshot) {
            return null;
        }

        const settings = this.aiEngine.getPlugin()?.settings;

        let fingerprintParts: string[] = [];
        try {
            if (this.promptBuilder) {
                fingerprintParts = await this.promptBuilder.getFingerprintPromptParts(precedingText, direction);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 指纹 prompt 生成失败，跳过:', e);
        }

        let knowledgeParts: string[] = [];
        let knowledgeInjection = '';
        let kbDeepInjection = '';
        try {
            if (this.knowledgeInjector && this.writingProfileManager && this.session) {
                if (this.fingerprintLibrary) {
                    (this.knowledgeInjector as any).fingerprintLibrary = this.fingerprintLibrary;
                }
                if (this.knowledgeManager && this.knowledgeVectorStore) {
                    this.knowledgeInjector.setKnowledgeBase(this.knowledgeManager, this.knowledgeVectorStore);
                }
                const profile = await this.writingProfileManager.load(this.session.project);
                if (profile && profile.fingerprint.injectionStrength > 0) {
                    const chapterMatch = this.session.chapterName.match(/第(\d+)章/);
                    const chapterIndex = chapterMatch ? parseInt(chapterMatch[1], 10) : undefined;
                    knowledgeInjection = await this.knowledgeInjector.injectForBodyGeneration(profile, {
                        projectPath: this.session.project,
                        chapterIndex,
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    });

                    kbDeepInjection = await this.knowledgeInjector.injectKnowledgeBase({
                        projectPath: this.session.project,
                        chapterIndex,
                        sceneType: this.detectSceneType(precedingText),
                        outline: this.snapshot?.chapPlan || '',
                        emotionPlan: this.snapshot?.emotionPlan || '',
                        currentText: precedingText,
                    }, profile.fingerprint.injectionStrength);
                }
            }
        } catch (e) {
            log.warn('[CoWriterEngine] E6: 知识注入失败，跳过:', e);
        }

        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(precedingText, direction);
            }
        } catch (e) {
            log.warn(`[CoWriterEngine] 知识库检索失败 (方向: ${direction}):`, e);
            knowledgeParts = [];
        }

        const combinedInjection = [knowledgeInjection, kbDeepInjection].filter(Boolean).join('\n\n');
        const prompt = this.buildDirectionalPrompt(precedingText, direction, cursorHint, fingerprintParts, knowledgeParts, combinedInjection);

        if (this.precisionMode) {
            try {
                const { PRECISION_MODE_SYSTEM_APPEND } = require('./prompts/co-write-prompts');
                prompt.system += PRECISION_MODE_SYSTEM_APPEND;
            } catch {
            }
        }

        const tempDelta = directionIndex * 0.05;
        let generatedText = '';

        try {
            const finalResponse = yield* this.callCoWriteAIStream(prompt, tempDelta, signal);
            generatedText = finalResponse.content;

            if (!generatedText) {
                return null;
            }

            if (this.precisionMode && this.styleScorer) {
                try {
                    const scoreResult = await this.styleScorer.score(generatedText, {
                        position: precedingText.length
                    });
                    log.info('[CoWriterEngine] 精准模式: 并行流式生成相似度评分 (', scoreResult.score, ')');
                } catch (scoreErr) {
                    log.warn('[CoWriterEngine] 精准模式: 相似度评分失败，跳过评分:', scoreErr);
                }
            }

            const suggestion: SuggestionRecord = {
                id: `sug_para_${Date.now()}_${directionIndex}`,
                text: generatedText,
                direction,
                style: directionIndex === 0 ? 'default' : (directionIndex === 1 ? 'creative' : 'conservative'),
                temperature: (settings?.coWriteTemperature ?? 0.7) + tempDelta,
                preview: generatedText.slice(0, 30) + (generatedText.length > 30 ? '...' : '')
            };

            return this.annotateSuggestionRisk(suggestion);
        } catch (e) {
            log.warn(`[CoWriterEngine] 并行流式建议生成失败 (方向: ${direction}):`, e);
            return null;
        }
    }

    private async *callCoWriteAIStream(
        prompt: { system: string; user: string },
        tempDelta: number,
        signal?: AbortSignal
    ): AsyncGenerator<string, { content: string; error?: string }, unknown> {
        const settings = this.aiEngine.getPlugin()?.settings;
        const temperature = (settings?.coWriteTemperature ?? 0.7) + tempDelta;
        const maxTokens = settings?.coWriteMaxTokens ?? 600;
        const model = this.getCoWriteModel();
        const options = this.getCoWriteOptions({ signal });

        return yield* this.aiEngine.callAIAsyncIterator(
            prompt.system,
            prompt.user,
            model,
            temperature,
            maxTokens,
            { isWritingTask: true, ...options }
        );
    }

    /**
     * NBI-03: 统一的协同写作文本获取入口。
     * 传入 onChunk 时走流式链路（逐片累积后回调累计文本），不传则保持原非流式调用，
     * 以兼容浮动面板等既有调用方。
     */
    private async callCoWriteText(
        prompt: { system: string; user: string },
        tempDelta: number,
        signal?: AbortSignal,
        onChunk?: (cumulativeText: string) => void
    ): Promise<string> {
        if (!onChunk) {
            const response = await this.callCoWriteAI(prompt, tempDelta, signal);
            return extractResponseText(response);
        }

        let accumulated = '';
        const iterator = this.callCoWriteAIStream(prompt, tempDelta, signal);
        while (true) {
            const step = await iterator.next();
            if (step.done) {
                const finalText = extractResponseText(step.value);
                // 以最终响应为准：原生流失败后降级重启会重放全文，直接用累计值会重复
                if (finalText && finalText !== accumulated) {
                    accumulated = finalText;
                    onChunk(accumulated);
                }
                break;
            }
            if (!step.value) continue;
            accumulated += step.value;
            onChunk(accumulated);
        }
        return accumulated;
    }

    async rewriteSelection(
        selectedText: string,
        beforeContext: string,
        afterContext: string,
        cursorHint: string = '',
        count: number = 3,
        onChunk?: (index: number, cumulativeText: string) => void,
        signal?: AbortSignal
    ): Promise<SuggestionRecord[]> {
        if (!this.snapshot || !selectedText.trim() || !this.hasCoWriteModel()) return [];
        // NBI-06: 已中止则不再发起任何模型调用
        if (signal?.aborted) return [];

        const directions: SuggestionDirection[] = ['description', 'emotion', 'dialogue'];
        const suggestions: SuggestionRecord[] = [];
        const settings = this.aiEngine.getPlugin()?.settings;

        let fingerprintParts: string[] = [];
        try {
            if (this.promptBuilder) {
                fingerprintParts = await this.promptBuilder.getFingerprintPromptParts(beforeContext);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 指纹 prompt 生成失败，跳过:', e);
        }

        let knowledgeParts: string[] = [];
        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(beforeContext);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 知识库 prompt 生成失败，跳过:', e);
        }
        this.lastKnowledgeCount = knowledgeParts.filter(p => p && p.trim().length > 0).length;

        for (let i = 0; i < Math.min(count, directions.length); i++) {
            // NBI-06: 中止后停止后续方向，避免继续消耗调用
            if (signal?.aborted) break;
            const direction = directions[i];
            const prompt = this.promptBuilder
                ? this.promptBuilder.buildRewritePrompt(selectedText, beforeContext, afterContext, cursorHint, direction, fingerprintParts, knowledgeParts)
                : [
                    '你是小说协同编辑。请对用户选中的片段给出一个可直接替换的改写版本。',
                    '',
                    '【前文】',
                    beforeContext.slice(-500),
                    '',
                    '【选中文本】',
                    selectedText,
                    '',
                    '【后文】',
                    afterContext.slice(0, 300),
                    '',
                    '请输出 1 个改写版本，保持剧情事实不变，不要解释。'
                ].filter(Boolean).join('\n');

            try {
                // NBI-03: 有分片回调时走流式渲染，无回调保持原非流式路径
                if (onChunk) onChunk(i, '');
                const text = await this.callCoWriteText(
                    { system: '', user: prompt },
                    i * 0.1,
                    signal,
                    onChunk ? (cumulative) => onChunk(i, cumulative) : undefined
                );
                if (text) {
                    suggestions.push({
                        id: `rewrite_${Date.now()}_${i}`,
                        text,
                        direction,
                        style: i === 0 ? 'default' : (i === 1 ? 'creative' : 'conservative'),
                        temperature: (settings?.coWriteTemperature ?? 0.7) + i * 0.1,
                        reasoning: '选区改写候选',
                        preview: text.slice(0, 30) + (text.length > 30 ? '...' : '')
                    });
                }
            } catch (e) {
                log.warn(`[CoWriterEngine] 选区改写失败 (方向: ${direction}):`, e);
                // NBI-06: 中止引发的失败不继续后续方向
                if (signal?.aborted) break;
            }
        }
        // NBI-06: 中止后不返回半成品候选
        if (signal?.aborted) return [];
        return suggestions.map(sg => this.annotateSuggestionRisk(sg));
    }

    async iterateSuggestion(
        originalSuggestion: SuggestionRecord,
        instruction: string,
        precedingContext: string,
        cursorHint: string = ''
    ): Promise<SuggestionRecord | null> {
        if (!this.snapshot || !instruction.trim() || !this.hasCoWriteModel()) return null;

        const settings = this.aiEngine.getPlugin()?.settings;

        let fingerprintParts: string[] = [];
        try {
            if (this.promptBuilder) {
                fingerprintParts = await this.promptBuilder.getFingerprintPromptParts(precedingContext);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 指纹 prompt 生成失败，跳过:', e);
        }

        let knowledgeParts: string[] = [];
        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(precedingContext);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 知识库 prompt 生成失败，跳过:', e);
        }
        this.lastKnowledgeCount = knowledgeParts.filter(p => p && p.trim().length > 0).length;

        const prompt = [
            '你是小说句级协同写作助手。用户不想重新生成整组建议，而是要基于当前候选做一次定向迭代。',
            '',
            ...this.promptBuilder?.getMemoryPromptParts(fingerprintParts) ?? [],
            ...(knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []),
            ...this.promptBuilder?.getNarrativeDriverPromptParts(precedingContext) ?? [],
            '【已写前文】',
            precedingContext.slice(-800),
            '',
            '【原候选】',
            originalSuggestion.text,
            '',
            '【用户迭代指令】',
            instruction,
            cursorHint ? `\n【临时写作方向】\n${cursorHint}` : '',
            '',
            '请只输出 1 个新版候选，保持剧情事实连续，不要解释，不要列点。'
        ].filter(Boolean).join('\n');

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
            const text = extractResponseText(response);
            if (!text) return null;

            return this.annotateSuggestionRisk({
                ...originalSuggestion,
                id: `iter_${Date.now()}`,
                text,
                temperature: settings?.coWriteTemperature ?? 0.7,
                reasoning: `基于指令迭代：${instruction}`,
                preview: text.slice(0, 30) + (text.length > 30 ? '...' : '')
            });
        } catch (e) {
            log.warn('[CoWriterEngine] B2: 建议迭代失败:', e);
            return null;
        }
    }

    // ============================================================
    // 核心 API 2：验证用户编辑
    // ============================================================

    async validateEdit(
        modifiedText: string,
        originalSuggestion: SuggestionRecord,
        precedingContext: string
    ): Promise<EditValidation> {
        if (!this.hasCoWriteModel()) {
            return {
                isValid: false,
                consistencyScore: 0,
                styleScore: 0,
                plotAlignmentScore: 0,
                overallScore: 0,
                warnings: ['协同写作未配置本地模型，无法验证编辑'],
                suggestions: [],
                validatedAt: Date.now()
            };
        }
        // 先进行基础验证
        const prompt = this.buildValidationPrompt(modifiedText, originalSuggestion, precedingContext);

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);

            const raw = extractResponseText(response);
            const baseValidation = this.parseValidationResponse(raw);
            
            // A1: OOC 检测
            if (this.soulData?.protagonist?.hasSoul) {
                const oocResult = await this.checkOOC(modifiedText, this.soulData.protagonist);
                if (oocResult.hasOOC) {
                    baseValidation.warnings.push(...oocResult.warnings);
                    baseValidation.consistencyScore = Math.min(baseValidation.consistencyScore, oocResult.score);
                    baseValidation.overallScore = Math.round(
                        (baseValidation.consistencyScore + baseValidation.styleScore + baseValidation.plotAlignmentScore) / 3
                    );
                    log.info('[CoWriterEngine] A1: OOC检测警告:', oocResult.warnings);
                }
            }
            
            return baseValidation;
        } catch (e) {
            log.warn('[CoWriterEngine] 验证失败，默认通过:', e);
            return {
                isValid: true,
                consistencyScore: 70,
                styleScore: 70,
                plotAlignmentScore: 70,
                overallScore: 70,
                warnings: ['验证服务暂时不可用，默认通过'],
                suggestions: [],
                validatedAt: Date.now()
            };
        }
    }

    // ============================================================
    // 核心 API 3：评估剧情完成度
    // ============================================================

    async evaluatePlotComplete(currentBody: string, signal?: AbortSignal): Promise<PlotCompletionMetrics> {
        if (!this.snapshot || !this.hasCoWriteModel()) return this.getEmptyMetrics();

        const nodeProgress = this.computePlotProgress(currentBody);

        if (nodeProgress.totalNodes === 0) {
            return this.getEmptyMetrics();
        }

        const prompt = this.buildEvaluationPrompt(currentBody, nodeProgress);

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0, signal);

            const raw = extractResponseText(response);
            const aiMetrics = this.parseEvaluationResponse(raw);

            const baseCompletion = nodeProgress.completionPercent;
            const aiAdjustment = (aiMetrics.overallCompletion - 50) * 0.2;
            const overallCompletion = Math.max(0, Math.min(100, Math.round(baseCompletion + aiAdjustment)));

            const metrics: PlotCompletionMetrics = {
                sceneObjectivesMet: Math.round((nodeProgress.completedNodes / nodeProgress.totalNodes) * 100),
                characterArcsAdvanced: aiMetrics.characterArcsAdvanced,
                foreshadowingSeeded: aiMetrics.foreshadowingSeeded,
                emotionalArcProgress: aiMetrics.emotionalArcProgress,
                overallCompletion,
                suggestionAdvice: nodeProgress.nextNode
                    ? `当前推进到第 ${nodeProgress.currentIndex + 1}/${nodeProgress.totalNodes} 个节点：${nodeProgress.nextNode.goal}。${aiMetrics.suggestionAdvice}`
                    : aiMetrics.suggestionAdvice,
                nextDirectionHints: aiMetrics.nextDirectionHints,
                evaluatedAt: Date.now()
            };

            if (this.session) {
                this.session.currentMetrics = metrics;
                this.session.totalWordCount = currentBody.length;
            }

            return metrics;
        } catch (e) {
            log.warn('[CoWriterEngine] 完成度评估失败:', e);
            if (nodeProgress.totalNodes > 0) {
                const fallbackMetrics: PlotCompletionMetrics = {
                    sceneObjectivesMet: nodeProgress.completionPercent,
                    characterArcsAdvanced: 0,
                    foreshadowingSeeded: 0,
                    emotionalArcProgress: 0,
                    overallCompletion: nodeProgress.completionPercent,
                    suggestionAdvice: nodeProgress.nextNode
                        ? `当前推进到第 ${nodeProgress.currentIndex + 1}/${nodeProgress.totalNodes} 个节点：${nodeProgress.nextNode.goal}`
                        : '所有剧情节点已完成',
                    nextDirectionHints: ['action', 'dialogue', 'description'],
                    evaluatedAt: Date.now()
                };
                if (this.session) {
                    this.session.currentMetrics = fallbackMetrics;
                    this.session.totalWordCount = currentBody.length;
                }
                return fallbackMetrics;
            }
            return this.session?.currentMetrics || this.getEmptyMetrics();
        }
    }

    // ============================================================
    // 核心 API 4：动态调整建议方向
    // ============================================================

    adjustDirection(metrics: PlotCompletionMetrics): SuggestionDirection[] {
        const directions: SuggestionDirection[] = [];

        // 短板优先
        if (metrics.sceneObjectivesMet < 50) directions.push('action');
        if (metrics.emotionalArcProgress < 40 || metrics.characterArcsAdvanced < 45) directions.push('emotion');
        if (metrics.foreshadowingSeeded < 30) directions.push('foreshadow');

        // 如果 AI 推荐的方向和短板不重复，加入
        if (metrics.nextDirectionHints) {
            for (const hint of metrics.nextDirectionHints) {
                if (!directions.includes(hint)) {
                    directions.push(hint);
                }
            }
        }

        // 确保至少 3 个方向
        const fallbacks: SuggestionDirection[] = ['dialogue', 'description', 'conflict'];
        while (directions.length < 3) {
            const next = fallbacks.shift()!;
            if (!directions.includes(next)) directions.push(next);
        }

        // 更新到 session
        if (this.session) {
            this.session.currentMetrics.nextDirectionHints = directions.slice(0, 3);
        }

        return directions.slice(0, 3);
    }

    // ============================================================
    // 核心 API 5：记录交互
    // ============================================================

    recordInteraction(record: SentenceEditRecord): void {
        this.interactionHistory.push(record);
        // v6.3: 加上限，避免长会话下无界增长（仅保留最近 MAX_INTERACTION_HISTORY 条）
        if (this.interactionHistory.length > MAX_INTERACTION_HISTORY) {
            this.interactionHistory.splice(0, this.interactionHistory.length - MAX_INTERACTION_HISTORY);
        }
        if (this.session) {
            this.session.interactions.push(record);
            if (this.session.interactions.length > MAX_INTERACTION_HISTORY) {
                this.session.interactions.splice(0, this.session.interactions.length - MAX_INTERACTION_HISTORY);
            }
        }
        void this.learnFromInteraction(record);
    }

    getMemorySnapshot(): {
        styleGuide: string;
        stylePatterns: ReturnType<StyleLearner['getAllPatterns']>;
        preferencePrompt: string;
        preferences: ReturnType<PreferenceMemory['getAllPreferences']>;
    } {
        return {
            styleGuide: this.styleLearner?.getStyleGuide() || '',
            stylePatterns: this.styleLearner?.getAllPatterns() || [],
            preferencePrompt: this.preferenceMemory?.generatePreferencePrompt() || '',
            preferences: this.preferenceMemory?.getAllPreferences() || []
        };
    }

    async addExplicitPreference(
        category: Parameters<PreferenceMemory['recordPreference']>[0],
        key: string,
        value: string
    ): Promise<void> {
        await this.preferenceMemory?.recordPreference(category, key, value, 'explicit');
    }

    /** E5: 设置参考书籍（用于知识库注入） */
    setReferenceBooks(bookIds: string[]): void {
        this.referenceBookIds = bookIds || [];
        if (this.promptBuilder) {
            this.promptBuilder.setReferenceBooks(this.referenceBookIds);
        }
        if (this.knowledgeInjector && this.knowledgeManager) {
            this.syncReferenceBooksToInjector();
        }
    }

    /** E5: 获取当前参考书籍 ID 列表 */
    getReferenceBooks(): string[] {
        return [...this.referenceBookIds];
    }

    /** E7: 设置参考书籍配置（带权重） */
    async setReferenceBooksWithWeight(books: Array<{ bookId: string; weight: number; isPrimary: boolean }>): Promise<void> {
        const bookIds = books.map(b => b.bookId);
        this.referenceBookIds = bookIds;
        if (this.promptBuilder) {
            this.promptBuilder.setReferenceBooks(bookIds);
        }
        if (this.knowledgeInjector && this.knowledgeManager) {
            const refConfigs = [];
            for (const b of books) {
                const bookInfo = await this.knowledgeManager.getBook(b.bookId);
                if (bookInfo) {
                    refConfigs.push({
                        bookId: b.bookId,
                        bookName: bookInfo.name,
                        weight: b.weight,
                        isPrimary: b.isPrimary,
                    });
                }
            }
            this.knowledgeInjector.setReferenceBooks(refConfigs);
        }
    }

    /** E7: 获取知识注入器实例 */
    getKnowledgeInjector(): typeof this.knowledgeInjector {
        return this.knowledgeInjector;
    }

    /** E7: 获取知识匹配分数 */
    getKnowledgeMatchScore(text: string): Array<{ bookName: string; score: number; dimensions: string[] }> {
        if (!this.knowledgeInjector) return [];
        return this.knowledgeInjector.getKnowledgeMatchScore(text);
    }

    /** E7: 同步参考书籍到注入器 */
    private async syncReferenceBooksToInjector(): Promise<void> {
        if (!this.knowledgeInjector || !this.knowledgeManager) return;
        try {
            const refConfigs = [];
            for (let i = 0; i < this.referenceBookIds.length; i++) {
                const bookId = this.referenceBookIds[i];
                const bookInfo = await this.knowledgeManager.getBook(bookId);
                if (bookInfo) {
                    refConfigs.push({
                        bookId,
                        bookName: bookInfo.name,
                        weight: i === 0 ? 1.0 : 0.5,
                        isPrimary: i === 0,
                    });
                }
            }
            this.knowledgeInjector.setReferenceBooks(refConfigs);
        } catch (e) {
            log.warn('[CoWriterEngine] 同步参考书籍到注入器失败:', e);
        }
    }

    /** E7: 检测当前场景类型 */
    private detectSceneType(text: string): string {
        if (!text || text.trim().length < 50) return '';
        const tail = text.slice(-500);
        const battleKeywords = ['战斗', '打斗', '交手', '对战', '攻击', '防御', '功法', '武技', '剑', '拳', '掌'];
        const emotionKeywords = ['伤心', '感动', '愤怒', '恐惧', '喜悦', '悲伤', '思念', '回忆', '眼泪', '痛'];
        const dialogueKeywords = ['说', '道', '问', '答', '喊', '叫', '对话', '交谈'];
        const suspenseKeywords = ['秘密', '阴谋', '谜团', '调查', '追踪', '发现', '真相', '伏笔', '暗示'];

        let battleScore = 0, emotionScore = 0, dialogueScore = 0, suspenseScore = 0;
        for (const kw of battleKeywords) if (tail.includes(kw)) battleScore++;
        for (const kw of emotionKeywords) if (tail.includes(kw)) emotionScore++;
        for (const kw of dialogueKeywords) if (tail.includes(kw)) dialogueScore++;
        for (const kw of suspenseKeywords) if (tail.includes(kw)) suspenseScore++;

        const maxScore = Math.max(battleScore, emotionScore, dialogueScore, suspenseScore);
        if (maxScore < 2) return '';
        if (battleScore === maxScore) return '战斗';
        if (emotionScore === maxScore) return '情感';
        if (dialogueScore === maxScore) return '对话';
        if (suspenseScore === maxScore) return '悬疑';
        return '';
    }

    private async learnFromInteraction(record: SentenceEditRecord): Promise<void> {
        try {
            const chosen = record.suggestions.find(s => s.id === record.chosenSuggestionId);
            const finalText = record.humanModifiedText?.trim();
            if (!chosen || !finalText) return;

            const chosenText = chosen.text.trim();
            if (finalText !== chosenText) {
                await this.styleLearner?.learnFromEdit(chosenText, finalText, record.triggerText || '');
                await this.preferenceMemory?.recordPreference('style', '接受建议后的人工编辑', {
                    direction: chosen.direction,
                    style: chosen.style,
                    editedLength: finalText.length
                }, 'learned');
            } else {
                await this.preferenceMemory?.recordPreference('style', `偏好方向:${chosen.direction}`, {
                    direction: chosen.direction,
                    style: chosen.style,
                    acceptedWithoutEdit: true
                }, 'learned');
            }
        } catch (e) {
            log.warn('[CoWriterEngine] E1/E3: 从协同交互学习失败:', e);
        }
    }

    // ============================================================
    // 上下文快照方法
    // ============================================================

    updateSnapshot(confirmedText: string): void {
        if (this.snapshot) {
            this.snapshot.precedingText = confirmedText.slice(-2000);
        }
        if (this.session) {
            this.session.totalWordCount = confirmedText.length;
        }
    }

    setCursorHint(hint: string): void {
        if (this.snapshot) this.snapshot.cursorHint = hint;
    }

    getSnapshot(): ContextSnapshot | null {
        return this.snapshot;
    }

    getSession(): CoWritingSession | null {
        return this.session;
    }

    getHistory(): SentenceEditRecord[] {
        return this.interactionHistory;
    }

    async refreshStaticContext(): Promise<void> {
        if (!this.snapshot) return;
        try {
            const ctx = await this.contextManager.gatherAll(
                this.snapshot.project,
                this.snapshot.chapterName
            );
            this.snapshot = this.buildSnapshot(ctx, this.snapshot.project, this.snapshot.chapterName);
            log.info('[CoWriterEngine] 静态上下文已刷新');
        } catch (e) {
            log.warn('[CoWriterEngine] 刷新静态上下文失败:', e);
        }
    }

    // ============================================================
    // 私有方法：构建 Snapshot
    // ============================================================

    private buildSnapshot(ctx: any, project: string, chapterName: string): ContextSnapshot {
        const data = ctx?.data || {};
        const getRaw = (obj: any) => obj?.raw || '';
        const getCharSummary = (chars: any[]) => {
            if (!Array.isArray(chars) || chars.length === 0) return '';
            return chars.map((c: any) => `${c.name || ''}：${c.description || c.state || ''}`.trim()).join('\n');
        };
        const worldViewRaw = getRaw(data.world_view);
        let worldType = '';
        const typeMatch = worldViewRaw.match(/题材[：:]\s*([^\n]+)/);
        if (typeMatch) worldType = typeMatch[1].trim();
        return {
            project,
            chapterName,
            allChars: getCharSummary(data.character_state),
            allFactions: getCharSummary(data.factions),
            allLocs: getCharSummary(data.locations),
            allItems: getCharSummary(data.items),
            foreshadows: data.foreshadows || { unrevealed: [], revealed: [], abandoned: [] },
            relationshipStates: [],
            crossVolumeContext: '',
            worldView: worldViewRaw,
            worldType,
            writingStyle: getRaw(data.writing_style),
            writingRules: data.writing_rules?.mandatory?.join('\n') || '',
            protagonistSoulDetail: '',
            emotionPlan: getRaw(data.emotion_plan),
            sceneExpansion: getRaw(data.scene_expansion),
            chapPlan: getRaw(data.outline),
            prevChaptersSummary: (() => {
                const prev = data.previous_chapter;
                if (!prev) return '';
                return [
                    prev.bodySummary ? `【前章概要】\n${prev.bodySummary}` : '',
                    prev.outline ? `【前章大纲】\n${prev.outline}` : '',
                    prev.ending ? `【前章结尾】\n${prev.ending}` : '',
                    prev.analysisReport ? `【前章分析报告】\n${prev.analysisReport}` : '',
                ].filter(Boolean).join('\n\n');
            })(),
            settingLib: getRaw(data.setting_lib),
            timeline: (() => {
                const tl = data.timeline as Array<{ time?: string; chapter?: string; event?: string; impact?: string }>;
                if (!Array.isArray(tl) || tl.length === 0) return '';
                return tl.map(t => `${t.time || ''}|${t.chapter || ''}|${t.event || ''}|${t.impact || ''}`).join('\n');
            })(),
            characterCores: (() => {
                const cores = data.character_cores;
                if (!cores) return '';
                if (typeof cores === 'string') return cores;
                if (Array.isArray(cores)) {
                    return cores.map((c: any) => `${c.name || ''}: ${c.coreTraits || c.summary || ''}`).join('\n');
                }
                return String(cores);
            })(),
            triggeredMemories: data.triggered_memories_prompt || (Array.isArray(data.triggered_memories)
                ? (data.triggered_memories as Array<{ character?: string; content?: string; text?: string }>).map(m => `${m.character || ''}: ${m.content || m.text || ''}`).join('\n')
                : ''),
            precedingText: '',
            cursorHint: '',
            currentMode: 'continue',
            gatheredAt: Date.now(),
            dirtyFields: new Set()
        };
    }

    // ============================================================
    // 私有方法：获取推荐方向
    // ============================================================

    private getRecommendDirections(count: number): SuggestionDirection[] {
        // 优先使用 session 中的动态方向
        if (this.session?.currentMetrics?.nextDirectionHints?.length) {
            return this.session.currentMetrics.nextDirectionHints.slice(0, count);
        }

        // 默认方向：动作、情绪、对话
        return ['action', 'emotion', 'dialogue'].slice(0, count) as SuggestionDirection[];
    }

    // ============================================================
    // C3：连贯 / 冗余轻审查（同步，不走 AI）
    checkCoherence(body: string): CoherenceReport {
        return analyzeCoherence(body);
    }

    // C1：逻辑一致性轻审查（同步，不走 AI）
    checkLogicConsistency(body: string): LogicConsistencyReport {
        return analyzeLogicConsistency(body);
    }

    // C4：敏感 / 违和内容预警（同步，不走 AI）
    checkContentSafety(body: string): ContentSafetyReport {
        return analyzeContentSafety(body);
    }

    // D3：跨章节剧情冗余度检查（只读当前项目/当前卷前 10 章）
    async checkPlotRedundancy(body: string): Promise<PlotRedundancyReport> {
        if (!this.session) {
            return analyzePlotRedundancy(body, []);
        }
        const previousBodies = await loadPreviousChapterBodies(
            this.app,
            this.session.project,
            this.session.volume,
            this.session.chapterNum,
            10
        );
        return analyzePlotRedundancy(body, previousBodies);
    }

    // ============================================================
    // C1：提前剧透 / 越界风险检测（同步启发式，不走 AI）
    // ============================================================

    // 为单条建议标注 riskLevel / riskWarnings，不修改文本本身
    annotateSuggestionRisk(suggestion: SuggestionRecord): SuggestionRecord {
        try {
            const warnings: string[] = [];
            const text = (suggestion.text || '').trim();
            if (!text) return suggestion;

            // 1. 未揭示伏笔被提前点名（高风险）
            const fs: any = this.snapshot?.foreshadows;
            const unrevealed: any[] = Array.isArray(fs?.unrevealed) ? fs.unrevealed : [];
            for (const item of unrevealed) {
                const name = (item?.name || '').trim();
                if (name.length >= 2 && text.includes(name)) {
                    warnings.push(`可能提前揭示未揭示伏笔：「${name}」（计划揭示：${item?.plannedReveal || '未定'}）`);
                }
            }

            // 2. 越界“上帝视角/提前下结论”剧透句式（中高风险）
            const spoilerPatterns: Array<{ re: RegExp; msg: string }> = [
                { re: /(其实|原来)[^。！？]{0,12}(就是|才是|是|并非)/, msg: '“其实/原来…是…”可能提前揭谜' },
                { re: /(最终|结局|到最后|多年后|日后)[^。！？]{0,16}(死|胜|败|分开|在一起|统一|灭亡)/, msg: '提前交代结局走向，可能越界剧透' },
                { re: /(会发现|将会|日后会|未来会)[^。！？]{0,12}(背叛|死去|真相|身世)/, msg: '预告未来关键转折，谨防提前剧透' },
            ];
            for (const { re, msg } of spoilerPatterns) {
                if (re.test(text)) warnings.push(msg);
            }

            if (warnings.length === 0) {
                suggestion.riskLevel = 'low';
                suggestion.riskWarnings = [];
                return suggestion;
            }

            // 命中伏笔点名視为高风险；仅句式命中为中风险
            const hitsForeshadow = warnings.some(w => w.startsWith('可能提前揭示未揭示伏笔'));
            suggestion.riskLevel = hitsForeshadow ? 'high' : 'medium';
            suggestion.riskWarnings = warnings;
        } catch (e) {
            log.warn('[CoWriterEngine] C1: 剧透风险标注失败:', e);
        }
        return suggestion;
    }

    // ============================================================
    // 剧情节点提取与进度追踪 (v6.4)
    // ============================================================

    private plotNodes: PlotNode[] = [];
    private currentNodeIndex: number = 0;

    /** 从大纲摘要和Scene展开中提取剧情节点 */
    private extractPlotNodes(): PlotNode[] {
        const nodes: PlotNode[] = [];
        const outline = this.snapshot?.chapPlan || '';
        const sceneExp = this.snapshot?.sceneExpansion || '';

        // 1. 从大纲摘要的"关键场景"表格提取
        const keySceneSection = this.extractSection(outline, /##\s*关键场景/i);
        if (keySceneSection) {
            const tableRows = keySceneSection.match(/^\|\s*\d+\s*\|.*$/gm) || [];
            for (const row of tableRows) {
                const cells = row.split('|').map(c => c.trim()).filter(Boolean);
                if (cells.length >= 3) {
                    nodes.push({
                        id: `outline_${nodes.length + 1}`,
                        index: nodes.length + 1,
                        location: cells[1] || '',
                        characters: cells[2] || '',
                        conflict: cells[3] || '',
                        goal: cells[4] || cells[3] || '',
                        infoIncrement: cells[5] || '',
                        source: 'outline',
                        completed: false
                    });
                }
            }
        }

        // 2. 从Scene展开中提取场景（按## 场景N拆分）
        if (sceneExp) {
            const sceneSections = sceneExp.split(/##\s*场景\s*\d+/i).slice(1);
            let sceneIdx = 0;
            for (const section of sceneSections) {
                sceneIdx++;
                const titleMatch = section.match(/^[^\n]+/);
                const title = titleMatch ? titleMatch[0].trim() : `场景${sceneIdx}`;
                const locationMatch = section.match(/地点[：:]\s*([^\n]+)/i);
                const charMatch = section.match(/人物[：:]\s*([^\n]+)/i);
                const goalMatch = section.match(/(叙事目标|场景目标|核心事件)[：:]\s*([^\n]+)/i);

                nodes.push({
                    id: `scene_${sceneIdx}`,
                    index: nodes.length + 1,
                    location: locationMatch ? locationMatch[1].trim() : '',
                    characters: charMatch ? charMatch[1].trim() : '',
                    conflict: '',
                    goal: goalMatch ? goalMatch[2].trim() : title,
                    infoIncrement: '',
                    source: 'scene_expand',
                    completed: false
                });
            }
        }

        // 3. 如果都没有，从情节蒸馏的"情节节点规划"提取
        if (nodes.length === 0) {
            const plotDistill = this.snapshot?.chapPlan || '';
            const nodeSection = this.extractSection(plotDistill, /##\s*情节节点规划/i);
            if (nodeSection) {
                const nodeMatches = nodeSection.match(/^-\s*节点\d+[：:]\s*.+$/gm) || [];
                let idx = 0;
                for (const m of nodeMatches) {
                    idx++;
                    const text = m.replace(/^-\s*节点\d+[：:]\s*/, '').trim();
                    nodes.push({
                        id: `node_${idx}`,
                        index: idx,
                        location: '',
                        characters: '',
                        conflict: '',
                        goal: text,
                        infoIncrement: '',
                        source: 'plot_distill',
                        completed: false
                    });
                }
            }
        }

        return nodes;
    }

    /** 提取Markdown中指定标题下的内容 */
    private extractSection(content: string, headingRegex: RegExp): string | null {
        const lines = content.split('\n');
        let start = -1;
        for (let i = 0; i < lines.length; i++) {
            if (headingRegex.test(lines[i])) {
                start = i + 1;
                break;
            }
        }
        if (start < 0) return null;
        const result: string[] = [];
        for (let i = start; i < lines.length; i++) {
            if (/^##+\s+/.test(lines[i])) break;
            result.push(lines[i]);
        }
        return result.join('\n').trim();
    }

    /** 计算当前剧情进度：已完成哪些节点，下一个目标是什么 */
    private computePlotProgress(currentBody: string): PlotProgress {
        if (this.plotNodes.length === 0) {
            this.plotNodes = this.extractPlotNodes();
        }

        const bodyLower = currentBody.toLowerCase();
        let completedCount = 0;
        let firstIncomplete = -1;

        for (let i = 0; i < this.plotNodes.length; i++) {
            const node = this.plotNodes[i];
            const signals = [node.goal, node.location, node.characters, node.conflict]
                .filter(Boolean)
                .map(s => s.toLowerCase())
                .filter(s => s.length >= 3);

            let hitCount = 0;
            for (const sig of signals) {
                if (bodyLower.includes(sig)) hitCount++;
            }

            const completed = signals.length > 0 && hitCount >= Math.min(1, Math.ceil(signals.length * 0.3));
            node.completed = completed;
            if (completed) {
                completedCount++;
            } else if (firstIncomplete < 0) {
                firstIncomplete = i;
            }
        }

        const total = this.plotNodes.length;
        const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        const nextNode = firstIncomplete >= 0 && firstIncomplete < total
            ? this.plotNodes[firstIncomplete]
            : null;

        return {
            totalNodes: total,
            completedNodes: completedCount,
            currentIndex: firstIncomplete >= 0 ? firstIncomplete : total,
            completionPercent: percent,
            nextNode,
            allCompleted: firstIncomplete < 0
        };
    }

    /** v6.4: 暴露剧情节点进度供 UI 显示按钮状态（不触发 AI 评估） */
    getPlotProgress(currentBody: string): PlotProgress {
        return this.computePlotProgress(currentBody);
    }

    /** 获取当前应该推进的剧情节点描述（用于注入prompt） */
    private getCurrentPlotTarget(precedingText: string): string {
        const progress = this.computePlotProgress(precedingText);
        if (!progress.nextNode) {
            const lastNode = this.plotNodes[this.plotNodes.length - 1];
            if (lastNode) {
                return `本章所有剧情节点已推进完毕，当前处于收尾阶段。请为当前场景画上句号并自然过渡到章末钩子。`;
            }
            return '';
        }

        const node = progress.nextNode;
        const parts: string[] = [];
        parts.push(`当前进度：第${progress.currentIndex + 1}/${progress.totalNodes}个剧情节点（已完成${progress.completionPercent}%）`);
        parts.push(`下一个剧情目标：${node.goal || '推进当前场景'}`);
        if (node.location) parts.push(`地点：${node.location}`);
        if (node.characters) parts.push(`涉及人物：${node.characters}`);
        if (node.conflict) parts.push(`冲突焦点：${node.conflict}`);

        return parts.join('\n');
    }

    // ============================================================
    // 私有方法：构建 AI 提示词
    // ============================================================

    private buildDirectionalPrompt(
        precedingText: string,
        direction: SuggestionDirection,
        cursorHint: string,
        fingerprintParts?: string[],
        knowledgeParts?: string[],
        knowledgeInjection?: string
    ): { system: string; user: string } {
        let soulInjection = '';
        if (this.soulData?.protagonist?.hasSoul) {
            soulInjection = getProtagonistSoulDetail(this.soulData.protagonist);
        }

        const plotTarget = this.getCurrentPlotTarget(precedingText);

        if (this.promptBuilder) {
            return this.promptBuilder.buildSuggestionPrompt(
                precedingText,
                direction,
                cursorHint,
                soulInjection,
                plotTarget,
                fingerprintParts,
                knowledgeParts,
                knowledgeInjection
            );
        }

        const dirPrompt = '请根据当前写作方向自然地续写一段。';
        const snap = this.snapshot;
        const systemPrompt = [
            '你是一位第三人称限知视角的叙事者。你不是在"写小说"，你是在用镜头紧贴主角，把他/她正在经历的一切原样呈现出来。',
            '',
            '【叙事视角规则】',
            '- 严格第三人称限知：只写主角能看到、听到、摸到、感受到的东西。',
            '- 不跳其他角色的内心，不写上帝视角的全局解释。',
            '- 严禁使用第一人称「我」叙事。所有描写必须是第三人称（他/她/它），这是硬性规则，不可违反。',
            '- 心理活动用自由间接引语，不用"他心想""他觉得"这种标签。',
            '- 所有认知都从主角的感官出发，有温度、有重量、有气味。',
            '',
            '【怎么写才像活人经历的】',
            '- 不说教，不总结，不解释。事情在发生，不是在被讲述。',
            '- 情绪不说出口。不讲"他很难过"，讲"他指尖无意识掐进掌心"。',
            '- 不用排比，不用华丽辞藻堆砌。活人眼里的世界没那么多修辞。',
            '- 每句只讲一件事。一句话就是一个画面。',
            '- 不重复。同样的意思不说第二遍。',
            '- 不用"然后""接着""就在这时"这种过渡词。画面直接跳。',
            '',
            '【番茄小说分段格式】',
            '- 段落极短，大多只有一句话。',
            '- 一句话就是一段，换行直接切下一个画面。',
            '- 段落之间只用一个换行，不要留空行，不要用两个回车。',
            '- 每段首行缩进一个制表符（Tab）。',
            '- 对话单独成段，前后不要留空行。',
            '- 感官细节单独成段，一个细节就是一记重锤。',
        ].filter(Boolean).join('\n');

        const userParts: string[] = [
            '【已写内容】',
            precedingText.slice(-800),
            '',
            '【写作方向】',
            dirPrompt
        ].filter(Boolean);

        if (cursorHint) {
            userParts.push('', '【特别指令】', cursorHint);
        }

        userParts.push('', (precedingText || '').trim().length < 10
            ? '这是本章的开头。请根据本章大纲和设定，开始写正文。不需要多，但要让人感觉这一瞬间是真实的。只输出正文，不要标注、不要解释、不要写标题。'
            : '请自然地续写一段。不需要多，但要让人感觉这一瞬间是真实的。只输出正文，不要标注、不要解释、不要写标题。');
        return { system: systemPrompt, user: userParts.join('\n') };
    }
    // D2: 跨卷一致性——注入前面卷的状态快照（人物/势力/伏笔/时间线）
    getCrossVolumePromptParts(): string[] {
        const ctx = (this.snapshot?.crossVolumeContext || '').trim();
        if (!ctx) return [];
        return ['【D2 跨卷状态快照（请保持与前面卷的人物/势力/伏笔/时间线一致）】', ctx.slice(0, 1200), ''];
    }

    private buildValidationPrompt(
        modifiedText: string,
        original: SuggestionRecord,
        context: string
    ): string {
        if (this.promptBuilder) {
            return this.promptBuilder.buildValidationPrompt(modifiedText, original.text, context);
        }
        return [
            '你是一个小说编辑。请验证以下编辑是否符合故事的整体一致性。',
            '',
            '【原文建议】',
            original.text,
            '',
            '【用户修改后】',
            modifiedText,
            '',
            '【上下文】',
            context.slice(-500),
            '',
            '请评估三个方面（各 0-100 分）：',
            '1. 设定一致性：是否与已有世界观/人物设定冲突',
            '2. 文风对齐：是否与整体文风一致',
            '3. 剧情对齐：是否推动当前场景目标',
            '',
            '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
            '{',
            '  "consistencyScore": 85,',
            '  "styleScore": 78,',
            '  "plotAlignmentScore": 90,',
            '  "warnings": ["警告信息"],',
            '  "suggestions": ["改进建议"]',
            '}'
        ].join('\n');
    }

    private buildEvaluationPrompt(body: string, progress: PlotProgress): string {
        const wordCount = body.length;
        const chapterPlan = this.snapshot?.chapPlan || '';
        const fs: any = this.snapshot?.foreshadows;
        const unrevealed: any[] = Array.isArray(fs?.unrevealed) ? fs.unrevealed : [];
        const revealed: any[] = Array.isArray(fs?.revealed) ? fs.revealed : [];

        const nodeList = this.plotNodes.map((node, i) => {
            const status = i < progress.currentIndex ? '✓ 已完成' : (i === progress.currentIndex ? '→ 进行中' : '○ 未开始');
            return `${i + 1}. [${status}] ${node.goal}${node.location ? `（${node.location}）` : ''}`;
        }).join('\n');

        let foreshadowSection = '';
        if (unrevealed.length > 0 || revealed.length > 0) {
            const lines: string[] = ['【伏笔库（请交叉比对正文中的伏笔埋设与回收情况）】'];
            if (unrevealed.length > 0) {
                lines.push('未揭示伏笔（应埋设/铺垫，尚未回收）：');
                unrevealed.slice(0, 10).forEach((item: any, i: number) => {
                    lines.push(`  ${i + 1}. ${item?.name || '未命名'}（计划揭示：${item?.plannedReveal || '未定'}）`);
                });
            }
            if (revealed.length > 0) {
                lines.push('已揭示伏笔（已回收）：');
                revealed.slice(0, 5).forEach((item: any, i: number) => {
                    lines.push(`  ${i + 1}. ${item?.name || '未命名'}（揭示章节：${item?.revealChapter || '?'}）`);
                });
            }
            foreshadowSection = lines.join('\n') + '\n';
        }

        return [
            '你是一个小说结构分析师。所有分析和建议必须使用中文输出。请评估当前正文的剧情完成度。',
            '',
            '【本章剧情节点（按顺序）】',
            nodeList || '（暂无节点信息）',
            '',
            '【章节目标】',
            chapterPlan.slice(0, 500) || '（暂无章节目标信息）',
            '',
            foreshadowSection,
            foreshadowSection ? '' : '',
            `【当前正文】（约 ${wordCount} 字符）`,
            body.slice(-1500),
            '',
            '请评估以下维度（各 0-100 分）：',
            '1. sceneObjectivesMet：场景目标完成度（基于剧情节点完成情况）',
            '2. characterArcsAdvanced：人物弧推进度（主角内心变化/成长推进了多少）',
            '3. foreshadowingSeeded：伏笔埋设程度（对比伏笔库，正文中实际埋设/推进了多少伏笔，是否有应回收而未回收的）',
            '4. emotionalArcProgress：情绪弧进度（情绪变化是否按预期推进）',
            '5. overallCompletion：总体完成度（综合以上所有维度的加权平均）',
            '',
            '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
            '{',
            '  "sceneObjectivesMet": 80,',
            '  "characterArcsAdvanced": 52,',
            '  "foreshadowingSeeded": 30,',
            '  "emotionalArcProgress": 65,',
            '  "overallCompletion": 57,',
            '  "suggestionAdvice": "一句话建议，指出当前最应该推进的内容",',
            '  "nextDirectionHints": ["action", "dialogue", "description"]',
            '}'
        ].filter(Boolean).join('\n');
    }

    // ============================================================
    // 私有方法：解析 AI 返回
    // ============================================================

    private parseValidationResponse(raw: string): EditValidation {
        try {
            // 清理可能的 markdown 代码块标记
            const cleaned = raw
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            const json = JSON.parse(cleaned);

            const consistencyScore = Number(json.consistencyScore) || 0;
            const styleScore = Number(json.styleScore) || 0;
            const plotAlignmentScore = Number(json.plotAlignmentScore) || 0;

            return {
                isValid: consistencyScore >= 60 && styleScore >= 60 && plotAlignmentScore >= 60,
                consistencyScore,
                styleScore,
                plotAlignmentScore,
                overallScore: Math.round((consistencyScore + styleScore + plotAlignmentScore) / 3),
                warnings: Array.isArray(json.warnings) ? json.warnings : [],
                suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
                validatedAt: Date.now()
            };
        } catch (e) {
            log.warn('[CoWriterEngine] 验证结果 JSON 解析失败，使用默认值:', e);
            return {
                isValid: true,
                consistencyScore: 70,
                styleScore: 70,
                plotAlignmentScore: 70,
                overallScore: 70,
                warnings: [],
                suggestions: ['验证结果解析失败，默认通过'],
                validatedAt: Date.now()
            };
        }
    }

    private parseEvaluationResponse(raw: string): PlotCompletionMetrics {
        try {
            const cleaned = raw
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            const json = JSON.parse(cleaned);

            const scores = [
                Number(json.sceneObjectivesMet) || 0,
                Number(json.characterArcsAdvanced) || 0,
                Number(json.foreshadowingSeeded) || 0,
                Number(json.emotionalArcProgress) || 0
            ];

            const aiOverall = Number(json.overallCompletion);
            const avgOverall = Math.round(scores.reduce((a, b) => a + b, 0) / 4);
            const overallCompletion = !isNaN(aiOverall) && aiOverall > 0 ? aiOverall : avgOverall;

            return {
                sceneObjectivesMet: scores[0],
                characterArcsAdvanced: scores[1],
                foreshadowingSeeded: scores[2],
                emotionalArcProgress: scores[3],
                overallCompletion,
                suggestionAdvice: json.suggestionAdvice || '',
                nextDirectionHints: Array.isArray(json.nextDirectionHints)
                    ? json.nextDirectionHints as SuggestionDirection[]
                    : ['action', 'emotion', 'dialogue'],
                evaluatedAt: Date.now()
            };
        } catch (e) {
            log.warn('[CoWriterEngine] 完成度 JSON 解析失败，使用默认值:', e);
            return this.getEmptyMetrics();
        }
    }

    // ============================================================
   // 私有方法：空指标
   // ============================================================

   private getEmptyMetrics(): PlotCompletionMetrics {
       return {
           sceneObjectivesMet: 0,
           characterArcsAdvanced: 0,
           foreshadowingSeeded: 0,
           emotionalArcProgress: 0,
           overallCompletion: 0,
           suggestionAdvice: '尚未评估',
           nextDirectionHints: ['action', 'emotion', 'dialogue'],
           evaluatedAt: Date.now()
       };
   }
    
    // ============================================================
    // A1: OOC 检测方法
    // ============================================================
    
    /**
     * 检测文本是否违背角色灵魂层设定
     */
    private async checkOOC(text: string, soul: CharacterSoul): Promise<OOCCheckResult> {
        if (!soul.hasSoul || !this.hasCoWriteModel()) {
            return { hasOOC: false, warnings: [], score: 100, violatedFields: [], checkedAt: Date.now() };
        }

        const prompt = this.promptBuilder
            ? this.promptBuilder.buildOOCPrompt(text, soul)
            : [
                '你是角色设定审查员。检查以下文本是否违背角色的核心特质。',
                '',
                '【角色灵魂层】',
                `- 最渴望: ${soul.desire}`,
                `- 最恐惧: ${soul.fear}`,
                `- 执念: ${soul.obsession}`,
                `- 创伤: ${soul.trauma}`,
                `- 弱点: ${soul.weakness}`,
                `- 软处: ${soul.soft_spot}`,
                `- 暴走红线: ${soul.rage_trigger}`,
                `- 底线: ${soul.moral_boundary}`,
                '',
                '【待检查文本】',
                text,
                '',
                '请判断：该角色在此文本中的行为/心理是否符合其核心特质？',
                '以 JSON 格式返回（不要包含 markdown 代码块）：',
                '{',
                '  "hasOOC": false,',
                '  "warnings": ["如果违背，列出具体问题"],',
                '  "score": 85,',
                '  "violatedFields": ["desire", "fear"] // 违背的字段名',
                '}'
            ].join('\n');
        
        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
            const raw = extractResponseText(response);
            const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const json = JSON.parse(cleaned);
            
            return {
                hasOOC: json.hasOOC || false,
                warnings: json.warnings || [],
                score: Number(json.score) || 70,
                violatedFields: json.violatedFields || [],
                checkedAt: Date.now()
            };
        } catch (e) {
            log.warn('[CoWriterEngine] A1: OOC检测解析失败:', e);
            return { hasOOC: false, warnings: ['OOC检测解析失败'], score: 70, violatedFields: [], checkedAt: Date.now() };
        }
    }
    
    // ============================================================
    // D1: 实体状态追踪方法
    // ============================================================
    
    /**
     * 追踪当前正文中的实体状态变化
     */
    async trackEntityStates(bodyContent: string): Promise<EntityStateChange[]> {
        if (!this.entityStateManager || !this.session) return [];
        
        try {
            const changes = await this.entityStateManager.detectStateChanges(
                bodyContent,
                this.session.project,
                this.session.chapterNum,
                this.session.chapterName
            );
            this.pendingStateChanges = changes;
            return changes;
        } catch (e) {
            log.warn('[CoWriterEngine] D1: 实体状态追踪失败:', e);
            return [];
        }
    }
    
    /**
     * 确认待处理的状态变更（Task 12 / AC-7：不直写正式库）。
     * 确认动作把变化转为 PendingFact 进入 Task 11 待确认队列，
     * 用户后续在质量仪表盘确认后才写入正式库。
     * @returns 入队事实数量（0 = 无待处理项或入队失败，失败时保留待处理项可重试）
     */
    async confirmStateChanges(): Promise<number> {
        if (!this.pendingStateChanges.length || !this.session) return 0;

        const facts = entityStateChangesToFacts(this.pendingStateChanges);
        if (facts.length === 0) {
            this.pendingStateChanges = [];
            return 0;
        }

        try {
            let registry = this.engineRegistry;
            if (!registry) {
                const plugin = this.aiEngine.getPlugin();
                if (plugin && (plugin as any).engineRegistry) {
                    registry = (plugin as any).engineRegistry as EngineRegistry;
                    this.engineRegistry = registry;
                }
            }
            if (!registry) {
                log.warn('[CoWriterEngine] D1: EngineRegistry 不可用，状态变化入队跳过（保留待处理项）');
                return 0;
            }
            const manager = await registry.getFactIndexManager(this.session.project);
            await manager.enqueue(facts);
            this.pendingStateChanges = [];
            log.info('[CoWriterEngine] D1: 状态变化已进入待确认队列:', facts.length);
            return facts.length;
        } catch (e) {
            log.warn('[CoWriterEngine] D1: 状态变化入队失败（保留待处理项可重试）:', e);
            return 0;
        }
    }
    
    /**
     * A1+D1: 检查正文是否触发角色 OOC 或实体状态变更。
     */
    async inspectSettingGuard(bodyContent: string): Promise<SettingGuardReport> {
        let oocResult: OOCCheckResult | null = null;
        let entityChanges: EntityStateChange[] = [];

        if (this.soulData?.protagonist?.hasSoul && bodyContent.trim()) {
            oocResult = await this.checkOOC(bodyContent.slice(-1200), this.soulData.protagonist);
        }

        if (bodyContent.trim()) {
            entityChanges = await this.trackEntityStates(bodyContent);
        }

        return {
            oocResult,
            entityChanges,
            checkedAt: Date.now()
        };
    }
    /**
     * 获取待处理的状态变更列表
     */
    getPendingStateChanges(): EntityStateChange[] {
        return [...this.pendingStateChanges];
    }
    
    // ============================================================
    // 辅助方法
    // ============================================================
    
    private extractRecentSentences(text: string): string[] {
        if (!text) return [];
        const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 0);
        return sentences.slice(-10);
    }

    private getProtagonistName(project: string): string {
        // 优先：扫描 01-世界架构/人物/*.md 的 frontmatter，
        // 若「身份」字段含「主角」/「主人公」，取该文件名（去 .md）作为主角名。
        const charsDir = pjCharsDir(project);
        try {
            const files = this.getVaultMeta().getFiles();
            for (const f of files) {
                if (!f.path.startsWith(charsDir + '/') || !f.path.endsWith('.md')) continue;
                const cache = this.app.metadataCache.getFileCache(f);
                const role = cache?.frontmatter?.['身份'];
                const roleStr = Array.isArray(role) ? role.join('') : String(role || '');
                if (roleStr.includes('主角') || roleStr.includes('主人公')) {
                    const name = f.name.replace(/\.md$/, '');
                    if (name) return name;
                }
            }
        } catch { /* 回退到下方默认逻辑 */ }

        // 回退1：工作台状态（保留向后兼容）
        const state = this.aiEngine.getPlugin()?._workbenchState;
        if (state?.protagonistName) return state.protagonistName;
        if (state?.protagonist) return state.protagonist;
        return '主角'; // 回退2：默认值
    }
 
    // ============================================================
    // B1: 联想输入 Copilot
    // ============================================================
    
    /**
     * 基于上下文的智能联想输入
     */
    async suggestAssociation(
        cursorPosition: number,
        fullText: string,
        trigger: 'space' | 'enter' | 'period' | 'manual' = 'manual'
    ): Promise<AssociationSuggestion[]> {
        if (!this.snapshot || !this.hasCoWriteModel()) return [];
        
        // 获取光标前后的上下文
        const beforeCursor = fullText.slice(Math.max(0, cursorPosition - 500), cursorPosition);
        const afterCursor = fullText.slice(cursorPosition, cursorPosition + 200);
        
        // 分析可能的联想方向
        const hints = await this.analyzeAssociationContext(beforeCursor);
        
        // 生成联想建议
        const suggestions: AssociationSuggestion[] = [];
        
        for (let i = 0; i < Math.min(3, hints.length); i++) {
            const hint = hints[i];
            try {
                const text = await this.generateAssociationText(beforeCursor, hint);
                suggestions.push({
                    text,
                    type: hint.type,
                    confidence: hint.confidence,
                    preview: text.slice(0, 50) + (text.length > 50 ? '...' : '')
                });
            } catch (e) {
                log.warn('[CoWriterEngine] B1: 联想生成失败:', e);
            }
        }
        
        return suggestions;
    }
    
    /**
     * 分析联想上下文
     */
    private async analyzeAssociationContext(text: string): Promise<import('../shared/co-writer-types').AssociationHint[]> {
        const hints: import('../shared/co-writer-types').AssociationHint[] = [];
        
        // 检测最后提及的实体
        const recentEntities = this.extractRecentEntities(text);
        if (recentEntities.length > 0) {
            hints.push({ type: 'entity-action', entity: recentEntities[0], confidence: 0.8 });
        }
        
        // 检测当前情绪走向
        const lastPunctuation = Math.max(
            text.lastIndexOf('。'),
            text.lastIndexOf('！'),
            text.lastIndexOf('？')
        );
        const lastSentence = lastPunctuation >= 0 ? text.slice(lastPunctuation) : text;
        
        // 简单情绪检测
        if (/[愤怒恨杀]/.test(lastSentence)) {
            hints.push({ type: 'escalate', emotion: 'anger', confidence: 0.7 });
        } else if (/[恐惧怕惊]/.test(lastSentence)) {
            hints.push({ type: 'escalate', emotion: 'fear', confidence: 0.7 });
        }
        
        // 检测未完成的对话
        const hasOpenDialogue = /["「『"][^"'」』]*$/.test(text);
        if (hasOpenDialogue) {
            hints.push({ type: 'dialogue', confidence: 0.9 });
        }
        
        // 默认建议
        if (hints.length === 0) {
            hints.push({ type: 'emotion', emotion: 'neutral', confidence: 0.5 });
        }
        
        return hints;
    }
    
    /**
     * 提取最近提及的实体
     */
    private extractRecentEntities(text: string): string[] {
        const entities: string[] = [];
        
        // 从灵魂数据中获取所有角色名
        const allChars = this.soulData?.allSouls || '';
        const charNames = allChars.match(/【[^】]+】/g)?.map(s => s.replace(/[【】]/g, '')) || [];
        
        // 找出最近提及的角色
        for (const name of charNames) {
             const lastMention = text.lastIndexOf(name);
             if (lastMention >= 0 && lastMention >= text.length - 200) {
                 entities.push(name);
             }
        }
        
        return entities;
    }
    
    /**
     * 生成联想文本
     */
    private async generateAssociationText(
        context: string, 
        hint: import('../shared/co-writer-types').AssociationHint
    ): Promise<string> {
        let knowledgeParts: string[] = [];
        try {
            if (this.promptBuilder && this.referenceBookIds.length > 0) {
                knowledgeParts = await this.promptBuilder.getKnowledgePromptParts(context);
            }
        } catch (e) {
            log.warn('[CoWriterEngine] 知识库 prompt 生成失败，跳过:', e);
        }

        const prompt = this.promptBuilder
            ? this.promptBuilder.buildAssociationPrompt(context, hint, undefined, knowledgeParts)
            : [
                '根据上下文，续写1-2句话（30-80字）。',
                '',
                ...(knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []),
                '【上下文】',
                context.slice(-300),
                '',
                '直接输出续写内容，不要解释：'
            ].join('\n');
        
        const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
        
        return extractResponseText(response);
    }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 判断 provider 的 endpoint 是否指向本地
 * 统一复用 model-source 的源类型解析（含 sourceType 显式标记 + endpoint 启发式兜底）
 */
export function isLocalProviderEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;
    return resolveProviderSourceType({ id: '', endpoint }) === 'local';
}

/**
 * 判断当前 settings 中是否存在本地 provider（sourceType=local 或 endpoint 指向本地）
 * 用于在本地模式下放宽模型名识别：只要存在本地 provider，所有候选模型都视为本地模型
 */
function hasLocalProvider(settings: any): boolean {
    if (!settings) return false;
    const providers = settings.customProviders;
    if (!Array.isArray(providers)) return false;
    return providers.some((p: any) => p && resolveProviderSourceType(p) === 'local');
}

/**
 * 判断模型是否为本地模型
 * 判断规则：
 *   1. 模型名包含 ':' 或 'local'（不区分大小写）—— 原有规则
 *   2. 若传入 settings 且存在 endpoint 指向本地的 provider，则视为本地模型
 *      （Ollama /api/tags 返回的模型名如 deepseek-r1、qwen25 可能不带 ':' 或 'local' 特征）
 *
 * @param modelName 模型名
 * @param settings 可选，插件 settings，用于检查当前 provider 的 endpoint
 */
export function isLocalModel(modelName: string, settings?: any): boolean {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    if (lower.includes(':') || lower.includes('local')) return true;
    if (settings && hasLocalProvider(settings)) return true;
    return false;
}

/**
 * 解析协同写作本地模型（含回退逻辑）
 *
 * 信任用户显式配置：
 *   - 如果用户显式配置了 coWriteModel（非空），直接返回该模型，不再经过 isLocalModel 判断。
 *     用户在本地模式下显式选择某个模型，意味着已确认该模型可用，无需重复校验。
 *
 * 回退选择（用户未配置 coWriteModel 时）：
 *   - 从 proModel / defaultModel / flashModel 中按优先级取第一个被 isLocalModel 识别为本地的模型。
 *
 * 回退优先级：coWriteModel（用户显式） > proModel（本地） > defaultModel（本地） > flashModel（本地）
 */
export function resolveCoWriteLocalModel(settings: any): string | undefined {
    if (!settings) return undefined;
    // 用户显式配置了 coWriteModel，直接信任
    if (settings.coWriteModel && String(settings.coWriteModel).trim()) {
        return settings.coWriteModel;
    }
    // 回退：从候选模型中找本地模型
    const candidates = [
        settings.proModel,
        settings.defaultModel,
        settings.flashModel,
    ];
    for (const model of candidates) {
        if (model && isLocalModel(model, settings)) {
            return model;
        }
    }
    return undefined;
}

/**
 * 模型列表去重并保持顺序
 * 使用 Set 去重，保持原有顺序
 */
export function dedupeModels(models: string[]): string[] {
    if (!Array.isArray(models)) return [];
    return Array.from(new Set(models));
}

export async function fetchOllamaModels(): Promise<string[] | null> {
    const now = Date.now();
    if (ollamaModelCache && now - ollamaCacheTime < OLLAMA_CACHE_TTL) {
        return ollamaModelCache;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const models: string[] = (data.models || []).map((m: any) => m.name).filter(Boolean);

        ollamaModelCache = models;
        ollamaCacheTime = now;

        return models;
    } catch (e) {
        // S2: 原本静默 return null，Ollama 探测失败时无任何痕迹；
        // 补诊断日志便于排查「本地模型列表为空」类问题，返回契约保持不变。
        log.warn('[CoWriterEngine] Ollama 模型列表获取失败，降级为本地模型配置:', e);
        return null;
    }
}

export function getFallbackLocalModels(settings: any): string[] {
    if (!settings || !Array.isArray(settings.availableModels)) return [];
    return settings.availableModels.filter((m: string) => isLocalModel(m, settings));
}

export async function getOllamaModelsWithFallback(settings: any): Promise<string[]> {
    const ollamaModels = await fetchOllamaModels();
    if (ollamaModels && ollamaModels.length > 0) {
        return ollamaModels;
    }
    return getFallbackLocalModels(settings);
}
