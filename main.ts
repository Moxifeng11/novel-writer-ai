import { InternalRegistry } from './engine/internal-registry';
import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { AIEngine } from './engine/ai-engine';
import { CoWriterEngine } from './engine/co-writer-engine';
import { ContextManager } from './engine/context-manager';
import { ForeshadowManager } from './services/foreshadow-manager';
import { getExecutionLedger } from './services/execution-ledger';
import { ReviewAgent } from './engine/review-agent';
import { NovelWriterSettingTab } from './ui/settings-tab';
import { CreateProjectModal } from './ui/create-project-modal';
import { PlanBookModal } from './ui/plan-book-modal';
import { WriteChapterModal } from './ui/write-chapter-modal';
import { ReviewChapterModal } from './ui/review-chapter-modal';
import { BatchCreateModal } from './ui/batch-create-modal';
import { GenerateWorldviewModal } from './ui/generate-worldview-modal';
import { GenerateCharacterModal } from './ui/generate-character-modal';
import { GenerateFactionModal } from './ui/generate-faction-modal';
import { GenerateLocationModal } from './ui/generate-location-modal';
import { GenerateItemModal } from './ui/generate-item-modal';
import { CrossVolumeStateModal } from './ui/cross-volume-state-modal';
import { StyleDistillerModal } from './ui/style-distiller-modal';
import { ContextInjectorModal } from './ui/context-injector-modal';
import { ChapterSettlementModal } from './ui/chapter-settlement-modal';
import { VolumeIntroModal } from './ui/volume-intro-modal';
import { BatchChaptersModal } from './ui/batch-chapters-modal';
import { ContinueChaptersModal } from './ui/continue-chapters-modal';
import { AutoWriterModal } from './ui/auto-writer-modal';
import { DiagnoseWriterModal } from './ui/diagnose-writer-modal';
import { TomatoRankModal } from './ui/tomato-rank-modal';
import { RebuildChaptersModal } from './ui/rebuild-chapters-modal';
import { BackupYuanModal } from './ui/backup-yuan-modal';
import { ProtectYuanModal } from './ui/protect-yuan-modal';
import { NovelTagsModal } from './ui/novel-tags-modal';
import { AiBuilderModal } from './ui/ai-builder-modal';
import { AddFanficSettingModal } from './ui/add-fanfic-setting-modal';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from './ui/full-writer-view';
import { CoWritingView, VIEW_TYPE_CO_WRITE } from './ui/co-writing-view';
import { KnowledgeBaseView, VIEW_TYPE_KNOWLEDGE_BASE } from './ui/views/knowledge-base-view';
import { AgentWorkbenchView } from './ui/agent-workbench-view';
import { VIEW_TYPE_AGENT_WORKBENCH } from './shared/view-types';
import { WritingFingerprintView, VIEW_TYPE_WRITING_FINGERPRINT } from './ui/views/writing-fingerprint-view';
import { ProjectSidePanelView, VIEW_TYPE_PROJECT_SIDE_PANEL } from './ui/project-side-panel-view';
import { openModelSwitcherMenu, refreshAllModelSwitchers } from './ui/model-quick-switcher';
import { registerAllCustomFonts } from './services/font-manager';
import { WelcomeModal } from './ui/welcome-modal';
import { ChangelogModal } from './ui/changelog-modal';
import { compareVersions, isMajorUpdate } from './services/update-checker';
import { PromptManager } from './services/prompt-manager';
import type { PromptManagerConfig } from './services/prompt-manager-types';
import { DEFAULT_PROMPT_MANAGER_CONFIG } from './services/prompt-manager-types';

import { FloatWorkspaceManager } from './ui/workspace-manager';
import { KnowledgeBaseManager } from './services/knowledge-base-manager';
import { KnowledgeVectorStore } from './engine/knowledge-vector-store';
import { KnowledgeTagManager } from './engine/knowledge-tags';
import { DeconstructionScheduler, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from './services/deconstruction-scheduler';
import type { DeconstructionEngineSettings } from './services/deconstruction-scheduler';
import { WorldviewCacheService } from './services/worldview-cache-service';
import { WritingProfileManager } from './engine/writing-profile';
import { EngineRegistry, ENGINE_NAMES } from './engine/engine-registry';
import { AnalysisReportEngine } from './engine/analysis-report-engine';
import { KnowledgeInjector } from './engine/knowledge-injector';
import { CharacterConsistencyChecker } from './engine/character-consistency-checker';
import { EntityStateManager } from './engine/entity-state-manager';
import { AdaptiveDebounceManager } from './shared/adaptive-debounce-manager';
import { getDegradationNotifier } from './shared/degradation-notifier';
import { AntiAIDetector } from './engine/anti-ai-detector';
import { setBusinessThresholdOverrides, setInfoDebtMax } from './shared/thresholds';
import { SerializedWriter } from './shared/serialized-writer';
import { migrateSettings, withCurrentVersion, CURRENT_SCHEMA_VERSION } from './shared/settings-migrator';
import { PluginCacheManager } from './shared/plugin-cache';
import { pjNarrativeOverview } from './shared/paths';
import { resolveActiveChapterTarget, type ActiveChapterTarget, type WorkbenchChapterContext } from './shared/chapter-target';
import { ensureTemplateScaffold } from './shared/template-scaffold';
import { RulesService } from './services/rules-service';
import { ForeshadowConfigManager, ForeshadowConfig } from './engine/foreshadow-config-manager';

// ─── core 服务层（从 main.ts 拆出）───
import { CryptoService } from './core/crypto-service';
import { ThemeManager } from './core/theme-manager';
import { ProviderManager } from './core/provider-manager';
import { CommandRegistry, parseChapterFromPath } from './core/command-registry';
import { SettingsService, getDefaultSettings } from './core/settings-service';
import { CommandUiExecutor } from './ui/command-ui-executor';
import type { CommandUiPort } from './shared/command-ui-port';
import { ChapterVersionService } from './services/chapter-version-service';
import { loadHumanSamples } from './ui/services/human-sample-loader';


/** v3.5.0: 用户自定义 API 提供商，可持久化保存 */
export interface CustomProvider {
    id: string;       // 唯一标识（自动生成，如 custom-1）
    name: string;     // 显示名称
    endpoint: string; // API 端点
    models: string[]; // 模型列表
    maxContext: number;
    maxOutput: number;
    /** v4.11: 模型源类型，区分云端与本地（Ollama / LM Studio / vLLM 等 OpenAI 兼容端点） */
    sourceType?: 'cloud' | 'local';
    /** v4.15: 端点协议类型（由 URL 识别或用户手动指定） */
    apiStyle?: 'openai' | 'ollama' | 'custom';
    /** v4.21: API 协议格式，决定请求路径、请求体与响应解析；缺省按 openai-chat 兼容旧配置 */
    apiFormat?: 'openai-chat' | 'anthropic-messages' | 'openai-responses';
    /**
     * v4.21: 被用户关闭的模型。
     * 仍显示在模型列表中（可随时重新启用），但不参与默认/回退候选。
     */
    disabledModels?: string[];
    /**
     * v4.21: 端点披露的模型元数据（上下文窗口/输出上限/是否支持图片）。
     * 只作为展示与默认值，不覆盖用户手填的全局上限。
     */
    modelMeta?: Record<string, { contextWindow?: number; maxTokens?: number; vision?: boolean }>;
    /** v4.15: URL 自动识别出的预设供应商 ID；仅用于提示，不覆盖用户设置 */
    providerIdHint?: string;
    isDefault?: boolean; // 标记是否为初始默认供应商
    isHidden?: boolean;  // 标记是否被隐藏
}

/** 模型源类型与解析（v4.11 架构底座，定义见 shared/model-source.ts） */
export type { ModelSourceType } from './shared/model-source';
export { resolveProviderSourceType } from './shared/model-source';

// 导入集中化的模型能力映射（避免与 token-estimator.ts 重复硬编码）
import { MODEL_CAPABILITIES, findModelCapability } from './shared/model-capabilities';
import type { AiTask, TaskBudgetOverride, ThinkingMode, ThinkingLevel } from './shared/task-model';
export type { AiTask, TaskBudgetOverride, ThinkingMode, ThinkingLevel } from './shared/task-model';
import { hasUsableAiCredentials } from './shared/ai-credentials';
import { MODE_LIBRARY_ROOT_LIST, projectFromFilePath } from './domains/kernel/project-locator';
import { createLogger } from './shared/logger';

const log = createLogger('Main');
export { MODEL_CAPABILITIES, findModelCapability };

/**
 * 默认提供商初始化模板，不作为运行时数据源
 * 新代码应从 ProviderManager 获取供应商列表
 */
export const DEFAULT_PROVIDERS: Record<string, CustomProvider> = {
    volc:     { id: 'volc',     name: '火山引擎豆包', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', models: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228', 'doubao-seed-2-0-code-preview-260215', 'glm-4-7-251222'], maxContext: 256000, maxOutput: 131072, sourceType: 'cloud', isDefault: true },
    ollama:   { id: 'ollama',   name: '本地 Ollama',  endpoint: 'http://localhost:11434/v1/chat/completions',            models: ['qwen2.5:7b', 'deepseek-r1:7b'],                                      maxContext: 32768,  maxOutput: 8192,   sourceType: 'local', isDefault: true },
    catcat:   { id: 'catcat',   name: 'CatCat Gemini', endpoint: 'https://api.catcat.top/v1/chat/completions',              models: ['gemini-3.1-pro-preview', 'gemini-3.1-pro', 'gemini-3.1-pro-preview-search', 'gemini-3.1-pro-search', 'gemini-2.5-pro', 'gemini-2.5-pro-max', 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'], maxContext: 1048576, maxOutput: 65536,  sourceType: 'cloud', isDefault: true },
    deepseek: { id: 'deepseek', name: 'DeepSeek 官网', endpoint: 'https://api.deepseek.com/v1/chat/completions',            models: ['deepseek-v4-flash', 'deepseek-v4-pro'],                             maxContext: 1048576, maxOutput: 384000, sourceType: 'cloud', isDefault: true },
    sensenova: { id: 'sensenova', name: '日日新/SenseNova', endpoint: 'https://token.sensenova.cn/v1/chat/completions',        models: ['sensenova-6.7-flash-lite', 'deepseek-v4-flash'],                   maxContext: 262144,  maxOutput: 65536,  sourceType: 'cloud', isDefault: true },
};

// v3.4.7: 模型能力表已迁移至 shared/model-capabilities.ts，此处 re-export 仅用于向后兼容
// 新代码应直接从 './shared/model-capabilities' 导入

export interface CanonResearchSettings {
    provider: 'manual' | 'bing' | 'brave' | 'serper' | 'tavily';
    apiKey?: string;
    allowedDomains?: string[];
    blockedDomains?: string[];
    maxSources?: number;
    excerptChars?: number;
}

export interface NovelWriterSettings {
    apiKey: string;
    apiEndpoint: string;
    defaultModel: string;
    flashModel: string;
    proModel: string;
    /** v6.3: 协同写作专用模型（可设为本地 Ollama 模型如 qwen2.5:7b，减少远程 API 调用） */
    coWriteModel: string;
    /** v6.5: 协同写作本地模型 temperature（0-2，默认 0.7） */
    coWriteTemperature: number;
    /** v6.5: 协同写作本地模型 max_tokens（默认 600） */
    coWriteMaxTokens: number;
    /** v4.15: 协同写作本地 num_ctx；0=按模型探测窗口自动 */
    coWriteNumCtx?: number;
    /** v4.17: 本地协同候选批量化；true=一次调用返回多方向候选 */
    coWriteCandidateBatching?: boolean;
    /** v7.2: 协同写作模型模式：'local'(本地Ollama) | 'cloud'(云端API) */
    coWriteModelMode: 'local' | 'cloud';
    /** v7.2: 云端模型所属供应商 ID（如 'volc'、'deepseek'、'openai'） */
    coWriteCloudProvider: string;
    /** v7.2: 云端模型名称（留空则使用 defaultModel） */
    coWriteCloudModel: string;
    /** v7.1: 是否启用自动剧情完成度评估（输入时自动刷新） */
    autoPlotEvaluation: boolean;
    /**
     * v7.x: 是否启用自动联想（幽灵建议）。
     * 默认 true；关闭后输入不再发起联想 AI 请求（每 4 秒最多一次），可显著减少本地/云端调用。
     */
    autoGhostAssociation?: boolean;
    /** v7.5: 是否启用精准模式（逐句检索+风格评分+反AI检测） */
    precisionMode: boolean;
    /** P0 效率: 精修迭代轮数（0-5，默认 3，0=跳过精修；调用点 step-modal-controller） */
    refineRounds?: number;
    /**
     * 单步 prompt 输入 token 上限（0 = 按模型真实窗口自动分配）。
     * 实测事故：闸门曾回退到 32768/8192，正文只拿到 24K token，与模型 1M 窗口差 40 倍。
     * 现在默认按模型能力走；只有用户想控成本时才在此夹一个硬上限（硬上限最大 200K）。
     */
    contextTokenCap?: number;
    /** 人味约束模式：'exemplar'（样文优先，默认）| 'quota'（旧版数值配额，回退用） */
    humanVoiceMode?: 'exemplar' | 'quota';
    /**
     * 生效的写作规则版本（id 或版本号；空 = 按「项目 → vault → 内置」优先级）。
     * 支持多版本并存、同一时刻只生效一个，便于做规则消融实验。
     */
    activeRulesVersion?: string;
    /** 正文模板变体：'auto'（有灵魂层用 V2）| 'v1' | 'v2' | 'v3'（节拍先行）| 'v4'（对话主干） */
    activeBodyTemplate?: 'auto' | 'v1' | 'v2' | 'v3' | 'v4';
    /** 追加「可数硬指标」（时间锚点/口语/对话段数）；实验 C9 的组成部分，默认关 */
    countableHumanHints?: boolean;
    /** 上下文体检自动清空重复段（保留权威版本）；默认开，串章只告警不改 */
    contextHygieneAutoFix?: boolean;
    /** 质量控制完成后自动跑一次定向修订（消耗 1 次正文调用）；默认开，闸门拒绝则保留原稿 */
    autoRevisionAfterQC?: boolean;
    /** 定向修订采纳后自动复检（AI味/对话占比对照，不耗调用）；默认开 */
    autoRecheckAfterRevision?: boolean;
    /** 实验分组标签（写进注入账本与步骤 frontmatter，便于归因） */
    experimentGroup?: string;
    /**
     * 是否去掉「文笔风格」里的规则副本（默认 true）。
     * 旧实现把规则编号章再注入 user 一次，规则权重翻倍、且绕过版本管理。
     */
    dedupeRulesInStyle?: boolean;
    /** P0 效率: 句级候选并行生成（默认 true，本地小模型用户可关闭退回串行） */
    candidateParallel?: boolean;
    /** P0 效率: prompt 哈希缓存开关（默认 true，命中相同五元组时跳过 AI 调用） */
    promptCacheEnabled?: boolean;
    /**
     * R2: 用户扩充的 AI 味高频词（每项一个词）。
     * 默认空数组 → AI 味检测/协同写作约束/连接词密度统计与内置词表完全一致；
     * 非空时同时作用于三处（见 engine/anti-ai-detector.ts）。
     */
    antiAiExtraWords?: string[];
    /** R1: 步骤输出最低字数比例（相对目标字数，默认 0.70，见 shared/thresholds.ts） */
    wordMinRatio?: number;
    /** R1: 超长提示词保留头部的比例（默认 0.67，见 shared/thresholds.ts） */
    promptSplitRatio?: number;
    /**
     * 2026-10-27: 自然段模式。
     * true（默认）：AI 写入时把相邻的“一句一段”合并成 2–6 句的自然段；
     * false：保留模型原始分行。只影响 pipeline/batch/auto/continue/scene，不影响 manual/co-writer。
     */
    naturalParagraphMode?: boolean;
    /**
     * 2026-10-28: 自定义字体清单（FontFace API 载入自 vault `元文件/字体/`）。
     * family = FontFace family 名；path = vault 内字体文件路径（ttf/otf/woff/woff2）。
     */
    customFonts?: Array<{ family: string; path: string }>;
    /** 2026-10-28: 协同写作编辑器字体（CSS font-family 值；空 = 跟随主题） */
    coWriteEditorFont?: string;
    /** 2026-10-28: Agent 创作工作台左栏宽度（px，可拖拽调整，160–600） */
    agentWorkbenchLeftWidth?: number;
    /** 2026-10-28: Agent 创作工作台右栏宽度（px，可拖拽调整，280–760） */
    agentWorkbenchRightWidth?: number;
    /** 2026-10-28: Agent 工作台左栏折叠状态 */
    agentWorkbenchLeftCollapsed?: boolean;
    /** 2026-10-28: Agent 工作台右栏折叠状态 */
    agentWorkbenchRightCollapsed?: boolean;
    /**
     * 2026-10-29 第 4 轮：其余面板的可拖拽尺寸（px）。
     * 统一放在 panelSizes 下，避免再加一堆散落字段。
     */
    panelSizes?: {
        /** 完整写作工作台：左侧步骤导航 */
        fwStepNav?: number;
        /** 完整写作工作台：右侧预览/上下文栏 */
        fwRightPanel?: number;
        /** 协同写作：左栏素材区 */
        coWriteLeft?: number;
        /** 协同写作：右栏建议区 */
        coWriteRight?: number;
        /** 知识库 / 指纹库侧栏 */
        kbSidebar?: number;
        /** 实体管理侧栏 */
        entitySide?: number;
    };
    /**
     * 2026-10-27: 故事上下文总线的档位。
     * auto：协同按 coWriteModelMode，一键按默认模型/端点推断；
     * local：强制本地小窗口策略（压缩文本、较少条目）；
     * cloud：强制云端大窗口策略（完整文本、更多条目）。
     */
    storyContextTier?: 'auto' | 'local' | 'cloud';
    /** v4.20 写作指纹注入总预算（字符）；0 = 不限制 */
    fingerprintInjectionBudget?: number;
    availableModels: string[];
    maxContext: number;   // v6.2: 当前生效值（由 modelOverrides 或 MODEL_CAPABILITIES 决定）
    maxOutput: number;    // v6.2: 当前生效值（由 modelOverrides 或 MODEL_CAPABILITIES 决定）
    /**
     * v7.0: 两层索引的模型覆盖值
     * 外层 key = endpoint URL，内层 key = 模型名
     * 切换供应商时自动按 endpoint 索引，不会丢失旧供应商下的覆盖值
     */
    modelOverrides: Record<string, Record<string, { maxContext?: number; maxOutput?: number }>>;
    /**
     * v4.15: 任务级模型/预算覆盖。
     * 不覆盖时按 planning=flash、body/quality/fingerprint=pro 等策略回退。
     */
    taskBudgets?: Partial<Record<AiTask, TaskBudgetOverride>>;
    /**
     * v4.22: 全局预算档位。
     *
     * 任务级参数不再逐个配置——用户只选一个档位，输入/输出/思考预算
     * 由 `shared/task-budget-engine.ts` 按任务类别分发。
     * 缺省 balanced 与旧行为逐值一致；`taskBudgets` 里的手工覆盖仍优先。
     */
    budgetTier?: 'lean' | 'balanced' | 'generous' | 'extreme';
    /** v4.15: 全局思考模式；任务级配置优先。 */
    thinkingMode?: ThinkingMode;
    /** v4.20: 全局四级思考等级与 0–100 强度；未设置时兼容 thinkingMode */
    thinkingLevel?: ThinkingLevel;
    thinkingIntensity?: number;
    /** v4.15: 全局思考预算（token），0 表示不单独预留。 */
    thinkingBudget?: number;
    /**
     * v6.2: 覆盖值修改历史（每次用户手动修改时追加）
     * 用于查看/追溯每次渠道-模型配置变更
     */
    modelOverrideHistory: Array<{
        timestamp: string;    // ISO 时间
        providerId: string;   // 渠道 ID（如 volc / openai / deepseek / custom-1）
        model: string;        // 模型 ID
        field: 'maxContext' | 'maxOutput' | 'both';
        oldValue: number;
        newValue: number;
    }>;
    defaultWordCount: number;
    minWordCount: number;
    maxWordCount: number;
    enableAutoReview: boolean;
    enableAutoCorrect: boolean;
    enableAutoModelFallback: boolean;  // P0-13: AI断联时自动切换同端点下其他模型
    contextScope: 'full' | 'compact';  // 上下文范围：compact=仅本章涉及实体，full=遍历全部实体
    infoDebtThreshold: number;
    maxUnrevealedForeshadow: number;
    foreshadowConfig?: ForeshadowConfig;
    maxApiRetries: number;
    maxEntityBatchRetries: number;
    /** 各提供商的 API Key，key=providerId, value=apiKey */
    providerKeys: Record<string, string>;
    customProviderName: string;
    /** v3.5.0: 用户自定义 API 提供商列表，可持久化保存、切换、删除 */
    customProviders: CustomProvider[];
    theme: 'light' | 'dark' | 'auto';
    /**
     * 三层配色（v4.22 重构）。
     *
     * 只有 基底 / 卡片 / 强调 三项 + 氛围预设。面板由基底按氛围派生，
     * 文字按基底亮度自动取深浅——这两项不再作为配置项存在。
     * 旧版的 panelBg / enableCustomCardBg 已由 schemaVersion 5 迁移清除；
     * textPrimary 仅用于「旧配色」方案的冻结值，不再从 UI 写入。
     */
    themeColors?: {
        accent?: string;
        cardBg?: string;
        textPrimary?: string;
        /** 应用底色（L1 基底） */
        appBg?: string;
        /** 界面氛围预设 */
        appearancePreset?: 'soft' | 'clear' | 'paper';
        /** 当前选中的配色方案 ID（仅用于 UI 回显） */
        activePresetId?: string;
    };
    /** v4.22: 保存的主题配色方案，可一键切换 */
    themePresets?: Array<{
        id: string;
        name: string;
        createdAt: number;
        base?: string;
        card?: string;
        accent?: string;
        text?: string;
        preset?: 'soft' | 'clear' | 'paper';
        theme?: 'auto' | 'light' | 'dark';
        /** 仅「旧配色」这类迁移冻结的方案会带面板直通值 */
        legacyPanel?: string;
    }>;
    /**
     * 协同写作参考书籍（知识库的消费方）。
     * 以前只存在插件实例字段里、从不落盘：重启后选择与主参考全部丢失。
     */
    referenceBookIds?: string[];
    /** 参考书籍权重（bookId → 0.1~1），缺省 0.5；主参考固定按 1 处理 */
    referenceBookWeights?: Record<string, number>;
    /** 浮窗工作台布局（位置/折叠状态/自动恢复） */
    panelLayout?: {
        panels: Array<{
            id: string;
            position: { x: number; y: number };
            size: { width: number; height: number };
            collapsed: boolean;
        }>;
        autoRestore: boolean;
        lastWorkspaceOpen: boolean;
    };
    /** v7.3: 向量嵌入模型名称（用于写作指纹库检索） */
    embeddingModel: string;
    /** v7.3: 向量嵌入 API 端点（Ollama 默认 http://localhost:11434） */
    embeddingEndpoint: string;
    /** v7.4: 是否启用向量增强拆解 */
    vectorEnhancedDeconstruction: boolean;
    /** v7.4: 向量拆解置信度阈值（0.1-0.9） */
    vectorDeconstructionThreshold: number;
    /** v7.6: 向量模型提供商类型 */
    vectorProviderType: 'ollama' | 'openai' | 'doubao' | 'qwen';
    /** v4.15: embedding 不可用时的回退策略。默认 local-only，禁止静默把本地文本发到云端。 */
    embeddingFallbackPolicy?: 'never' | 'local-only' | 'allow-cloud';
    /** v7.6: Ollama 向量模型 baseUrl */
    vectorOllamaBaseUrl: string;
    /** v7.6: Ollama 向量模型名称 */
    vectorOllamaModel: string;
    /** v7.6: OpenAI 兼容向量模型 baseUrl */
    vectorOpenaiBaseUrl: string;
    /** v7.6: OpenAI 兼容向量模型名称 */
    vectorOpenaiModel: string;
    /** v7.6: OpenAI 兼容向量模型 API Key（加密存储） */
    vectorOpenaiApiKey: string;
    /** v7.7: 豆包/火山引擎向量模型 baseUrl */
    vectorDoubaoBaseUrl?: string;
    /** v7.7: 豆包/火山引擎向量模型名称 */
    vectorDoubaoModel?: string;
    /** v7.7: 豆包/火山引擎向量模型 API Key（加密存储） */
    vectorDoubaoApiKey?: string;
    /** v7.7: 通义千问向量模型 baseUrl */
    vectorQwenBaseUrl?: string;
    /** v7.7: 通义千问向量模型名称 */
    vectorQwenModel?: string;
    /** v7.7: 通义千问向量模型 API Key（加密存储） */
    vectorQwenApiKey?: string;
    /** v7.7: 向量模型模式：auto(自动降级) | primary(仅主提供商) | hybrid(混合模式) */
    vectorMode?: 'auto' | 'primary' | 'hybrid';
    /** v7.8: 是否启用自动更新检查 */
    autoCheckUpdates?: boolean;
    /** v7.8: 更新检查源：github / custom */
    updateSource?: 'github' | 'custom';
    /** v7.8: GitHub 仓库地址（owner/repo） */
    updateGithubRepo?: string;
    /** 私有 GitHub 仓库更新检查 Token（可留空） */
    updateGithubToken?: string;
    /** v7.8: 自定义更新检查 URL */
    updateCustomUrl?: string;
    /** v7.8: 更新检查间隔（小时） */
    updateCheckIntervalHours?: number;
    /** v7.9: 提示词管理配置（自定义模板、A/B测试等） */
    promptManagerConfig?: PromptManagerConfig;
    /** v8.0: 拆解引擎配置（增强级别、维度、向量、LLM、性能） */
    deconstructionEngine?: DeconstructionEngineSettings;
    /** v4.18: 同人考据来源检索（默认手动官方来源；可选第三方搜索 API） */
    canonResearch?: CanonResearchSettings;

    /** v8.1: 角色识别 - 启用的识别层 */
    characterRecognitionLayers?: ('rule' | 'vector' | 'llm')[];

    /** v8.1: 角色识别 - 规则层配置 */
    ruleLayer?: {
        minMentionCount: number;
        enableFreqFilter: boolean;
        enableContextCheck: boolean;
        enableVerbFilter: boolean;
    };

    /** v8.1: 角色识别 - 向量层配置 */
    vectorLayer?: {
        enabled: boolean;
        semanticFilterThreshold: number;
        mergeSimilarityThreshold: number;
    };

    /** v8.1: 角色识别 - LLM 层配置 */
    llmLayer?: {
        enabled: boolean;
        verifyBatchSize: number;
        titleBatchSize: number;
        minConfidence: number;
    };

    /** v8.1: 建议采纳相关配置 */
    suggestions?: {
        autoAdoptHighConfidence: boolean;
        autoAdoptThreshold: number;
        showEvidenceByDefault: boolean;
        batchAdoptThreshold: number;
    };

    /** v8.2: 协同写作界面布局配置 */
    coWriteLayout?: 'split' | 'stacked';
    /** v8.2: 协同写作编辑器宽度比例（0.4-0.85，默认 0.65） */
    coWriteEditorWidthRatio?: number;
    /** v8.2: 协同写作建议面板是否可见 */
    coWriteSuggestionPanelVisible?: boolean;
    /** v8.2: 是否显示协同写作高级功能 */
    coWriteShowAdvanced?: boolean;
}

export type { DeconstructionEngineSettings } from './services/deconstruction-scheduler';
export { DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS, ALL_BREAKDOWN_DIMENSIONS, DIMENSION_LABELS } from './services/deconstruction-scheduler';

export const DEFAULT_SETTINGS: NovelWriterSettings = getDefaultSettings();

// 主题 CSS 变量已迁移至 core/theme-manager.ts

export type { WorkbenchChapterContext, ActiveChapterTarget } from './shared/chapter-target';

export default class NovelWriterPlugin extends Plugin {
    settings!: NovelWriterSettings;
    private _degradationSinkUnregister: (() => void) | null = null;
    private contextManager!: ContextManager;
    private _foreshadowManager!: ForeshadowManager;
    public _foreshadowConfigManager!: ForeshadowConfigManager;
    private _reviewAgent!: ReviewAgent;
    registry!: InternalRegistry;
    /** 引擎注册表 — 集中管理所有引擎实例 */
    public engineRegistry!: EngineRegistry;
    // ─── core 服务实例 ───
    private _cryptoService!: CryptoService;
    private _themeManager!: ThemeManager;
    private _providerManager!: ProviderManager;
    private _commandRegistry!: CommandRegistry;
    /** 命令 UI 执行端口（core 只按 id 委托，不直接依赖 ui） */
    public commandUiPort?: CommandUiPort;
    private _settingsService!: SettingsService;
    /** 热重载恢复状态 */
    public _pendingReloadState: { project: string; chapterFileName: string; volume?: string; chapDir?: string } | null = null;
    /** 实体生成弹窗的预选项目（跨 modal 临时传递） */
    public _pendingEntityProject: string | null = null;
    /** 实体生成弹窗的上下文标记（跨 modal 临时传递） */
    public _pendingEntityContext: { project: string; isEarlyStage: boolean } | null = null;
    /** 实体生成弹窗刚关闭标记（向导渲染时检测并刷新步骤状态） */
    public _entityModalJustClosed: boolean = false;
    /** 实体生成弹窗关闭回调列表（向导渲染器注册，Modal onClose 时调用） */
    public _entityModalCloseCallbacks: Array<() => void> = [];
    /** 工作台上下文标记：true=当前工作台视图打开中，Modal 不应在 Obsidian 主窗口打开文件 */
    public _isWorkbenchContext: boolean = false;
    /** 工作台当前章节：由 FullWriterView 每次渲染时写入，关闭时清空 */
    public _workbenchContext: WorkbenchChapterContext | null = null;
    /** 浮窗管理器（运行时注入，可能未初始化） */
    public workspaceManager?: FloatWorkspaceManager;

    public knowledgeBaseManager?: KnowledgeBaseManager;
    public knowledgeVectorStore?: KnowledgeVectorStore;
    public knowledgeTagManager?: KnowledgeTagManager;
    public deconstructionScheduler?: DeconstructionScheduler;
    public batchImportManager?: import('./services/batch-import-manager').BatchImportManager;
    public writingProfileManager?: WritingProfileManager;
    public knowledgeInjector?: KnowledgeInjector;
    public characterConsistencyChecker?: CharacterConsistencyChecker;
    public worldviewCacheService?: WorldviewCacheService;
    /** 当前选中的参考书籍ID列表（用于生成时注入） */
    public referenceBookIds: string[] = [];

    /** 提示词管理器 */
    public promptManager?: PromptManager;

    /** P0修复#2：当前章节涉及的实体集（由 FullWriterView 同步，context-panel 读取以过滤显示） */
    public _involvedChars: Set<string> = new Set<string>();
    public _involvedLocs: Set<string> = new Set<string>();
    public _involvedFactions: Set<string> = new Set<string>();
    public _involvedItems: Set<string> = new Set<string>();

    /**
     * 安全打开文件：工作台上下文中仅显示 Notice，避免跳转到 Obsidian 主窗口
     * 用于替换 Modal 中所有 workspace.getLeaf(false).openFile(file) 调用
     */
    async safeOpenFile(file: TFile): Promise<void> {
        if (this._isWorkbenchContext) {
            new Notice(`📄 文件已保存：${file.name}`);
        } else {
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
        }
    }

    /** 公开访问器 — 供 Modal 层依赖注入使用 */
    public get ctxManager(): ContextManager { return this.contextManager; }

    /**
     * 是否具备发起 AI 调用的凭据：云端密钥，或本地免密钥推理端点（Ollama 等）。
     * UI 的「生成前守卫」必须用它，不能直接看 `settings.apiKey`——本地模型用户本来就无需密钥。
     */
    get hasAiCredentials(): boolean {
        return hasUsableAiCredentials(this.settings);
    }

    /** 从当前活动文件检测所属项目名（非项目目录返回 null） */
    getActiveProject(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const candidates = this.app.vault
                .getRoot()
                .children
                .filter((child): child is TFolder => child instanceof TFolder)
                .flatMap(folder => {
                    if (MODE_LIBRARY_ROOT_LIST.includes(folder.name)) {
                        return folder.children
                            .filter((child): child is TFolder => child instanceof TFolder)
                            .map(child => `${folder.name}/${child.name}`);
                    }
                    return [folder.path];
                });
            const project = projectFromFilePath(activeFile.path, candidates);
            if (project && project !== '元文件' && project !== '文笔风格库' && !project.startsWith('.')) {
                return project;
            }
        }
        // 工作台/项目页激活时没有 activeFile：回退到界面当前选中的项目，
        // 否则快捷工具里的实体管理、批量生成等会拿不到项目。
        return this._workbenchContext?.project || null;
    }

    /** 工作台每次渲染时写入当前章节上下文；关闭工作台时传入 null 清空 */
    setWorkbenchContext(ctx: WorkbenchChapterContext | null): void {
        this._workbenchContext = ctx;
    }

    getWorkbenchContext(): WorkbenchChapterContext | null {
        return this._workbenchContext;
    }

    /**
     * 解析命令层可用的章节目标。
     * 优先级：工作台上下文 > activeFile 标准正文 > activeFile 步骤结果目录 > null。
     * 所有从快捷工具/命令面板触发的章节级操作都应走这里，禁止各自读 getActiveFile。
     */
    getActiveChapterTarget(): ActiveChapterTarget | null {
        return resolveActiveChapterTarget({
            workbench: this._workbenchContext,
            activeFilePath: this.app.workspace.getActiveFile()?.path ?? null,
        });
    }

    async onload() {
        log.info(`[小说工坊] 开始加载插件 v${PLUGIN_VERSION}...`);
        this.engineRegistry = new EngineRegistry();
        // 本地真人样文（仅本机 data 目录）：失败静默，提示词自动退化为弱约束模式
        void loadHumanSamples(this.app);
        // core 层不依赖 ui：命令的 Modal / 视图执行由本端口注入
        this.commandUiPort = new CommandUiExecutor({
            app: this.app,
            plugin: this,
            getVersionService: () => this.engineRegistry.get<ChapterVersionService>(ENGINE_NAMES.CHAPTER_VERSION_SERVICE),
        });
        try {
            // ─── 引擎注册表初始化（Phase 1-8） ───
            await this.engineRegistry.initialize(this, { settingsWriter: this._settingsWriter });
            this._assignEngineFields();

            // R2: 应用用户扩充的 AI 味词表（默认空数组 → 与内置词表行为一致）
            AntiAIDetector.setExtraHighFreqWords(this.settings.antiAiExtraWords ?? []);

            // R1: 应用业务阈值覆盖（未设置/非法值 → 回落内置常量，行为不变）
            setBusinessThresholdOverrides({
                wordMinRatio: this.settings.wordMinRatio,
                promptSplitRatio: this.settings.promptSplitRatio,
            });
            // v4.25：信息债阈值此前零消费方；接上运行时覆盖（非法值回落内置 15）
            setInfoDebtMax(this.settings.infoDebtThreshold);

            // 恢复中断的拆解状态（插件重载时，磁盘上仍为 processing 的书籍需重置为 interrupted）
            if (this.knowledgeBaseManager) {
                const recoveredCount = await this.knowledgeBaseManager.recoverInterruptedBooks();
                if (recoveredCount > 0) {
                    new Notice(`⚠️ ${recoveredCount} 本书拆解被中断，请在知识库中查看`, 5000);
                    log.warn(`[小说工坊] 恢复了 ${recoveredCount} 本中断的拆解书籍`);
                }
            }

            window.novelAI = this.registry;

            // P0 分发自举：全新安装（仅 3 个发布文件）时初始化「元文件」模板树
            try {
                const scaffold = await ensureTemplateScaffold(this.app);
                if (scaffold.created > 0) {
                    new Notice(`📁 已初始化模板目录「元文件」（${scaffold.created} 个文件）`, 5000);
                    log.info('[小说工坊] 模板目录已初始化:', scaffold);
                } else if (scaffold.failed > 0) {
                    new Notice(`⚠️ 模板目录初始化不完整（${scaffold.failed} 个文件失败），详见控制台`, 8000);
                }
            } catch (e) {
                log.error('[小说工坊] 模板目录初始化失败:', e);
                new Notice('⚠️ 模板目录初始化失败，新建项目时仍会重试，详见控制台', 8000);
            }

            await this._checkRulesVersion();

            // 初始化提示词管理器
            this.promptManager = new PromptManager({
                getConfig: () => this.settings.promptManagerConfig || {},
                setConfig: async (config) => {
                    this.settings.promptManagerConfig = {
                        ...DEFAULT_PROMPT_MANAGER_CONFIG,
                        ...this.settings.promptManagerConfig,
                        ...config,
                    } as PromptManagerConfig;
                    await this.saveSettings();
                },
            });

            // 注册 Obsidian 命令（CommandRegistry 已在 initialize 中创建并 registerInternalCommands）
            const commandRegistry = this.engineRegistry.get<CommandRegistry>(ENGINE_NAMES.COMMAND_REGISTRY);
            commandRegistry.registerObsidianCommands((cmd) => this.addCommand(cmd));

            log.info('[小说工坊] 注册命令...');
            const registeredCmds = this.app.commands.listCommands().filter((cmd: { id: string }) => cmd.id.startsWith('novel-writer'));
            log.info('[小说工坊] 命令注册完成，已注册:', registeredCmds.length, '个命令');
            log.info('[小说工坊] 命令列表:', registeredCmds.map((c: { id: string }) => c.id));

            // vault rename 事件监听（从 registerCommands 迁移）
            this.registerEvent(
                this.app.vault.on('rename', (file, oldPath) => {
                    if (file instanceof TFolder) {
                        new Notice(`📁 项目已重命名: ${oldPath} → ${file.path}`, 4000);
                    }
                })
            );

            // 2026-10-28: 移除 Obsidian 全局状态栏浮窗（右下角「提供商 | Flash | Pro」）。
            // 快速切换入口改为装配在四个主界面的两级选择器（ui/model-quick-switcher.ts），
            // 模型/供应商变化时由 updateStatusBarText() 统一刷新各处切换器。

            this._degradationSinkUnregister = getDegradationNotifier().registerSink((event) => {
                if (event.severity === 'info') return;
                const dim = event.dimension ? `[${event.dimension}] ` : '';
                const icon = event.severity === 'critical' ? '❌' : '⚠️';
                new Notice(
                    `${icon} ${dim}能力降级: ${event.from} → ${event.to}（${event.reason}）`,
                    event.severity === 'critical' ? 10000 : 6000
                );
            });

            log.info('[小说工坊] 添加设置面板...');
            this.addSettingTab(new NovelWriterSettingTab(this.app, this));

            // 2026-10-28: 恢复自定义字体（FontFace API，vault 元文件/字体/）
            void registerAllCustomFonts(this).catch(err => log.warn('[小说工坊] 自定义字体恢复失败:', err));

            log.info('[小说工坊] 添加侧边栏图标...');
            this.addRibbonIcon('book-open', '小说工坊 · 项目与章节', () => {
                this.openFullWriterHome().catch(err => log.error('[小说工坊] 打开项目与章节失败:', err));
            });

            // 创作流程：当前项目「进行到哪、下一步做什么」的总入口
            this.addRibbonIcon('list-checks', '小说工坊 · 创作流程', () => {
                this.openCreationFlow().catch(err => log.error('[小说工坊] 打开创作流程失败:', err));
            });

            // v6.0: 第二个 Ribbon 图标，直达句级协同写作工作台（解决「找不到入口」）
            this.addRibbonIcon('pen-line', '小说工坊 · 句级协同写作', () => {
                this.registry.execute('novel-writer-co-writing');
            });

            // 第三个 Ribbon 图标，知识库管理
            this.addRibbonIcon('library', '小说工坊 · 知识库', () => {
                this.openKnowledgeBaseView();
            });

            // 第四个 Ribbon 图标，写作指纹库
            this.addRibbonIcon('fingerprint', '小说工坊 · 写作指纹库', () => {
                this.registry.execute('novel-writer-fingerprint-library');
            });

            // 第五个 Ribbon 图标，Agent 创作工作台（交互革命主入口）
            this.addRibbonIcon('bot', '小说工坊 · Agent 创作工作台', () => {
                void this.openAgentWorkbench();
            });

            // 右侧「项目速览」面板：属性 / 标签 / 快捷动作（可折叠侧栏）
            this.addRibbonIcon('sidebar-right', '小说工坊 · 项目速览面板', () => {
                void this.openProjectSidePanel();
            });

            log.info('[小说工坊] 注册视图...');
            this.registerView(
                FULL_WRITER_VIEW_TYPE,
                (leaf) => new FullWriterView(leaf, this)
            );

            // v4.0: 注册句级协同写作视图
            this.registerView(
                VIEW_TYPE_CO_WRITE,
                (leaf) => new CoWritingView(leaf, this)
            );

            // 注册知识库管理视图
            this.registerView(
                VIEW_TYPE_KNOWLEDGE_BASE,
                (leaf) => new KnowledgeBaseView(leaf, this)
            );

            // 2026-10-28: 注册 Agent 创作工作台（交互革命主载体，取代旧对话引导弹窗）
            this.registerView(
                VIEW_TYPE_AGENT_WORKBENCH,
                (leaf) => new AgentWorkbenchView(leaf, this)
            );

            // 注册写作指纹库视图
            this.registerView(
                VIEW_TYPE_WRITING_FINGERPRINT,
                (leaf) => new WritingFingerprintView(leaf, this)
            );

            // 右侧「项目速览」面板（属性 + 标签 + 快捷动作；接入原生属性/标签能力）
            this.registerView(
                VIEW_TYPE_PROJECT_SIDE_PANEL,
                (leaf) => new ProjectSidePanelView(leaf, this)
            );

            // v5.5: 实例化浮窗管理器并注册监控面板A/B视图
            // （此前 workspaceManager 仅声明字段、从未实例化 -> MONITOR_A/B 永不注册，
            //  导致分离监控面板「丢失」、分析结果回退塞进协同视图内嵌容器造成拥挤）
            this.workspaceManager = new FloatWorkspaceManager(this);
            this.workspaceManager.registerAll();

            log.info('[小说工坊] 注册事件...');
            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file.path.includes('/02-时间线与伏笔/')) {
                        this._foreshadowManager.refreshInfoDebt();
                    }
                    if (file instanceof TFile && /\/03-大纲与章节\/正文\/.*第\d+卷\/第\d+章_正文\.md$/.test(file.path)) {
                        this.handleBodyFileModify(file);
                    }
                    this.contextManager.invalidateCacheByPath(file.path);
                })
            );

            // P0-14/16: 热重载恢复（完全基于内存态 _pendingReloadState，不依赖 localStorage）
            // — Obsidian 启动加载插件：_pendingReloadState 为 null → 不主动打开工作台
            // — 用户点 🔄 热重载按钮：_pendingReloadState 已由按钮 handler 在 disable 前同步设置 → 调用 openFullWriterView 恢复
            // — 用户点 ribbon 图标：_pendingReloadState 为 null → 打开工作台至「项目与章节」
            //
            // 彻底清理所有可能的 localStorage 残留（旧实现遗留），防止跨会话污染
            localStorage.removeItem('novel-writer-reload-state');
            localStorage.removeItem('novel-writer-user-reload');
            if (this._pendingReloadState?.project) {
                const saved = this._pendingReloadState;
                setTimeout(() => {
                    this.openFullWriterView();
                }, 300);
            }

            this.injectThemeVariables();
            this.injectLayoutVariables();  // v3.4.8: 布局变量全插件可用，不再依赖 full-writer-view 打开

            // v7.8: 版本管理 - 静默检查更新 + 欢迎引导 + 数据迁移验证
            this.handleVersionManagement();

            log.info('[小说工坊] 插件加载完成！');
        } catch (error: any) {
            log.error('[小说工坊] 插件加载失败:', error.message);
            log.error('[小说工坊] 错误堆栈:', error.stack);
            new Notice(`❌ 小说工坊插件加载失败: ${error.message}`);
        }
    }

    /**
     * 从引擎注册表获取实例并赋值给 Plugin 的私有字段
     * （私有字段无法从 EngineRegistry 直接赋值，需在 Plugin 内部完成）
     */
    private _assignEngineFields(): void {
        this._cacheManager = this.engineRegistry.get<PluginCacheManager>(ENGINE_NAMES.CACHE_MANAGER);
        this._cryptoService = this.engineRegistry.get<CryptoService>(ENGINE_NAMES.CRYPTO_SERVICE);
        this._providerManager = this.engineRegistry.get<ProviderManager>(ENGINE_NAMES.PROVIDER_MANAGER);
        this._themeManager = this.engineRegistry.get<ThemeManager>(ENGINE_NAMES.THEME_MANAGER);
        this._settingsService = this.engineRegistry.get<SettingsService>(ENGINE_NAMES.SETTINGS_SERVICE);
        this.contextManager = this.engineRegistry.get<ContextManager>(ENGINE_NAMES.CONTEXT_MANAGER);
        this._foreshadowManager = this.engineRegistry.get<ForeshadowManager>(ENGINE_NAMES.FORESHADOW_MANAGER);
        this._reviewAgent = this.engineRegistry.get<ReviewAgent>(ENGINE_NAMES.REVIEW_AGENT);
        this._commandRegistry = this.engineRegistry.get<CommandRegistry>(ENGINE_NAMES.COMMAND_REGISTRY);
    }

    /**
     * 启动时检查生效的写作规则版本。
     * v4.23：从「只比版本号」升级为「版本号 + 内容哈希」——实测事故正是
     * 版本号同为 3.6.0、正文却是旧版（一句一段），旧检查一路通过、无人发现。
     */
    private async _checkRulesVersion(): Promise<void> {
        try {
            const rulesService = RulesService.getInstance(this.app);
            rulesService.setActiveVersion(this.settings.activeRulesVersion);
            const info = await rulesService.checkRulesVersion();
            const isPresent = await rulesService.isRulesFilePresent();

            if (!isPresent) {
                new Notice('⚠️ 未检测到写作规则文件，将使用内置默认规则', 5000);
                log.warn('[小说工坊] 写作规则文件不存在，使用内置默认规则');
                return;
            }
            if (info.warnings.length > 0) {
                new Notice(`⚠️ 写作规则版本异常：${info.warnings[0]}`, 9000);
                log.warn('[小说工坊] 写作规则版本异常:', info.warnings.join('；'));
                return;
            }
            if (info.current !== info.expected && info.current !== 'unknown') {
                new Notice(
                    `⚠️ 写作规则版本不匹配（当前 ${info.current}，内置 ${info.expected}）。`
                    + '可在设置里切换生效版本，或核对文件内容。',
                    7000,
                );
                log.warn(`[小说工坊] 写作规则版本不匹配: 当前 ${info.current}，内置 ${info.expected}`);
            }
        } catch (e) {
            log.warn('[小说工坊] 规则版本检查失败:', e);
            new Notice('⚠️ 写作规则检查异常，请查看控制台', 5000);
        }
    }

    async activateView(): Promise<void> {
        // 重定向到完整写作工作台
        this.openFullWriterView();
    }

    public async openFullWriterView(): Promise<void> {
        const { workspace } = this.app;
        // 优先复用已有视图，避免每次热重载开新窗口（v3.4.7 P0-7）
        const existing = workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE);
        let leaf: any;
        if (existing.length > 0) {
            leaf = existing[0];
            // v4.5.1: 清理重复实例（避免多 leaf 共存导致 tabContent undefined 等问题）
            for (let i = 1; i < existing.length; i++) {
                existing[i].detach();
            }
        } else {
            leaf = workspace.getLeaf('tab');  // 当前窗口新建 tab，而非 getLeaf('window') 开新窗口
        }
        await leaf.setViewState({
            type: FULL_WRITER_VIEW_TYPE,
            active: true
        });
        workspace.revealLeaf(leaf);
        // 复用已有视图时 Obsidian 不会重新触发 onOpen：主动从磁盘恢复步骤状态，
        // 确保从协同写作返回后正文步骤/质量控制状态是最新的。
        if (existing.length > 0) {
            const view = leaf.view as unknown as { refreshChapterStateFromDisk?: () => Promise<void> };
            if (typeof view?.refreshChapterStateFromDisk === 'function') {
                await view.refreshChapterStateFromDisk();
            }
        }
    }

    /**
     * 「项目与章节」入口（快捷工具「流程规划工作台」/ 左侧 ribbon）：
     * 打开或聚焦工作台，并确保落在项目与章节页。
     *
     * 复用已打开视图时 openFullWriterView 只做静默 refresh，没有章节时直接 return，
     * 用户点击后看不到任何变化。这里补一次显式路由：不在项目页 → 切页；
     * 已在项目页 → 重新扫描项目列表并提示，保证点击必有反馈。
     */
    public async openFullWriterHome(): Promise<void> {
        const reused = this.app.workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE).length > 0;
        await this.openFullWriterView();
        if (!reused) return; // 首次打开时 onOpen 已默认落在项目与章节
        const leaf = this.app.workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE)[0];
        const view = leaf?.view as unknown as { showProjectSelector?: () => Promise<void> } | undefined;
        if (typeof view?.showProjectSelector === 'function') {
            await view.showProjectSelector();
        }
    }

    /**
     * 右侧「项目速览」面板：挂在右侧 dock（可折叠界面）。
     * 已打开则聚焦；右栏折叠时先展开，保证点击必有反馈。
     */
    public async openProjectSidePanel(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_PROJECT_SIDE_PANEL);
        if (existing.length > 0) {
            for (let i = 1; i < existing.length; i++) {
                existing[i].detach();
            }
            workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = workspace.getRightLeaf(false);
        if (!leaf) {
            new Notice('当前布局没有右侧栏，可先打开右侧栏再试', 5000);
            return;
        }
        await leaf.setViewState({ type: VIEW_TYPE_PROJECT_SIDE_PANEL, active: true });
        // 右栏若处于折叠状态，展开后用户才能看到
        try {
            (workspace.rightSplit as unknown as { expand?: () => void }).expand?.();
        } catch {
            // 某些布局没有 rightSplit.expand，忽略
        }
        workspace.revealLeaf(leaf);
    }

    /**
     * 「创作流程」入口：打开工作台并停在指定项目的流程页签。
     * 创建短篇/剧本、Agent 引导、命令面板都走这里，避免各自重复实现跳转。
     */
    public async openCreationFlow(project?: string): Promise<void> {
        await this.openFullWriterView();
        const leaf = this.app.workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE)[0];
        if (!leaf) return;
        const view = leaf.view as unknown as { openFlowTab?: (p?: string) => Promise<void> } | undefined;
        if (typeof view?.openFlowTab === 'function') {
            await view.openFlowTab(project);
        }
    }

    /** v4.0: 打开句级协同写作视图 */
    public async activateCoWritingView(project?: string, chapterName?: string, volume?: string, chapterNum?: number): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)[0];

        if (!leaf) {
            // 协同写作是「左预览 / 中编辑 / 右控制台」三栏布局，需要完整宽度。
            // 必须落在主编辑区（tab），不能用 getRightLeaf 放进右侧 dock（约 400px），
            // 否则三栏 grid 把中间编辑栏压成 0px，界面看起来「错乱 / 打不开」。
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CO_WRITE, active: true });
        }

        workspace.revealLeaf(leaf);

        if (project || chapterName) {
            const view = leaf.view as CoWritingView;
            if (view) {
                await view.openChapter(project || '', chapterName || '', volume || '第1卷', chapterNum || 1);
            }
        } else {
            // D6：无显式上下文的入口必须回到空态，不能沿用上一个项目/章节
            const view = leaf.view as CoWritingView;
            if (view && typeof view.clearChapterBinding === 'function') {
                await view.clearChapterBinding();
            }
        }

        // v5.5: 协同写作视图打开后，补开分离式监控面板A/B（节奏/情绪/OOC/实体、结局/风格/偏好）。
        // 不向 openAll 传 project/chapterName，避免其内部以 2 参再次调用 openChapter 覆盖 volume/chapterNum。
        await this.workspaceManager?.openAll();
    }

    /**
     * v6.0: 协同写作直达入口的智能绑定。
     * 优先级：①当前打开的正文文件反解出的章节 → ②空态视图。
     * 这样无论从命令面板、Ribbon 还是快捷键进入，都尽量带着章节上下文，避免打开后一片空白。
     * 注意：不再读 `_workbenchState`（无写入方，恒为 null），章节上下文只认磁盘路径反解。
     */
    public async openCoWritingFromActiveContext(): Promise<void> {
        // ① 从当前打开的正文文件路径反解章节
        const activeFile = this.app.workspace.getActiveFile();
        const ctx = activeFile ? this.parseChapterFromPath(activeFile.path) : null;
        if (ctx) {
            await this.activateCoWritingView(ctx.project, ctx.chapterName, ctx.volume, ctx.chapterNum);
            new Notice(`✍️ 已绑定章节：${ctx.project} · ${ctx.volume} · 第${ctx.chapterNum}章`, 3000);
            return;
        }

        // ② 没有可用上下文：打开空态视图并提示如何绑定
        await this.activateCoWritingView();
        new Notice('已打开句级协同写作工作台。请先打开某章「正文」文件，或从完整写作工作台选择章节后再进入，即可自动绑定。', 6000);
    }

    /** 打开知识库管理视图 */
    public async openKnowledgeBaseView(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_BASE);
        let leaf: any;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) {
                existing[i].detach();
            }
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({
            type: VIEW_TYPE_KNOWLEDGE_BASE,
            active: true
        });
        workspace.revealLeaf(leaf);
        new Notice('📚 已打开知识库管理界面');
    }

    /**
     * 2026-10-28: 打开 Agent 创作工作台（取代旧的对话引导小弹窗）。
     * 全 leaf 三栏布局：左创作导航 / 中对话 / 右监控，Agent 可操作插件全部功能。
     */
    public async openAgentWorkbench(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_AGENT_WORKBENCH);
        if (existing.length > 0) {
            for (let i = 1; i < existing.length; i++) {
                existing[i].detach();
            }
            workspace.revealLeaf(existing[0]);
            // 复用视图不会重新触发 onOpen：重启会话，保证每次入口都是全新引导
            const view = existing[0].view;
            if (view instanceof AgentWorkbenchView) {
                await view.restart();
            }
            return;
        }
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({
            type: VIEW_TYPE_AGENT_WORKBENCH,
            active: true
        });
        workspace.revealLeaf(leaf);
    }

    /**
     * v6.0: 从文件路径反解出协同写作所需的章节上下文。
     * 仅识别标准正文路径：<项目>/03-大纲与章节/正文/第X卷/第Y章_正文.md
     * 反解失败返回 null（交由调用方回退到空态）。
     */
    private parseChapterFromPath(path: string): { project: string; volume: string; chapterNum: number; chapterName: string } | null {
        if (!path) return null;
        // 正文文件名可能被 BodyWriter 按标题重命名（第Y章_标题_正文.md），
        // 旧正则只认「第Y章_正文.md」，导致重命名后协同写作拿不到章节上下文。
        const m = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第(\d+)卷)\/第(\d+)章(?:_[^/]*)?_正文\.md$/);
        if (!m) return null;
        const project = m[1];
        const volume = m[2];
        const chapterNum = parseInt(m[4], 10);
        if (!project || !Number.isFinite(chapterNum)) return null;
        return { project, volume, chapterNum, chapterName: `第${chapterNum}章` };
    }

    async commandPopulateSettingLib() {
        const { workspace } = this.app;
        let leaf = workspace.getLeaf(false);
        if (!leaf) {
            leaf = workspace.createLeafBySplit(workspace.getLeaf(true));
        }
        await leaf.setViewState({
            type: FULL_WRITER_VIEW_TYPE,
            active: true
        });
        workspace.revealLeaf(leaf);
        const view = leaf.view as FullWriterView;
        if (view) await view.populateSettingLib();
    }

    // ─── API 密钥加密（委托至 core/crypto-service）───
    private async encryptKey(plaintext: string): Promise<string> {
        return this._cryptoService.encrypt(plaintext);
    }
    /** 解密单个密钥（供 AIApiClient 在请求前按需解锁） */
    async decryptKey(stored: string): Promise<string> {
        return this._cryptoService.decrypt(stored);
    }
    /**
     * 静默解密：不弹口令框。未解锁时原样返回密文。
     * 供章节打开时的后台分析（如情节线 AI 解析）使用——这类调用失败可以跳过，
     * 不应该用口令弹窗打断用户。
     */
    async decryptKeyWithoutPrompt(stored: string): Promise<string> {
        return this._cryptoService.decryptWithoutPrompt(stored);
    }

    /** 设置页读取加密状态用（未初始化时返回 null） */
    getSettingsService(): { lockedSecretCount(): number; hasEncryptedSecrets(): boolean } | null {
        const service = this.engineRegistry.getOrNull<{
            lockedSecretCount(): number;
            hasEncryptedSecrets(): boolean;
        }>(ENGINE_NAMES.SETTINGS_SERVICE);
        return service ?? null;
    }

    /** 设置会话口令（解锁 / 首次设定口令后调用） */
    setSessionPassword(password: string): void {
        this._cryptoService.setSessionPassword(password);
    }

    /**
     * 重置密钥加密口令（2026-10-29 恢复路径）。
     *
     * 用新口令重新加密所有可读的明文；解不开的旧密文会被清空并列名，
     * 让用户重新填写——避免它们停留在「看起来配好但实际无效」的状态。
     */
    async resetKeyPassword(password: string): Promise<{ reencrypted: number; cleared: string[] }> {
        this._cryptoService.setSessionPassword(password);
        const settings = this.settings;
        let reencrypted = 0;
        const cleared: string[] = [];

        const handle = async (label: string, value: string): Promise<string> => {
            if (!value) return '';
            if (!value.startsWith('aes256v2:') && !value.startsWith('aes256:')) {
                reencrypted += 1;
                return value;
            }
            const ok = await this._cryptoService.canDecryptWith(password, value);
            if (ok) return value;
            cleared.push(label);
            return '';
        };

        settings.apiKey = await handle('当前供应商密钥', settings.apiKey);
        settings.providerKeys = settings.providerKeys || {};
        for (const key of Object.keys(settings.providerKeys)) {
            settings.providerKeys[key] = await handle(key, settings.providerKeys[key]);
        }
        settings.vectorOpenaiApiKey = await handle('向量-OpenAI', settings.vectorOpenaiApiKey || '');
        settings.vectorDoubaoApiKey = await handle('向量-豆包', settings.vectorDoubaoApiKey || '');
        settings.vectorQwenApiKey = await handle('向量-千问', settings.vectorQwenApiKey || '');
        settings.updateGithubToken = await handle('更新令牌', settings.updateGithubToken || '');

        await this.saveSettings();
        return { reencrypted, cleared };
    }

    async loadSettings() {
        await this._settingsService.loadSettings();
        // 参考书籍既存在设置里（落盘），也镜像到实例字段（旧调用方读这里）。
        // 旧版本两者都没落盘，重启后协同写作的参考书籍与主参考会全部丢失。
        this.referenceBookIds = [...(this.settings.referenceBookIds ?? [])];
    }

    async saveSettings() {
        await this._settingsService.saveSettings();
    }

    /**
     * 模型/供应商变化后的统一刷新入口（保留旧方法名，调用方遍布设置/弹窗/引擎层）。
     * 旧版更新 Obsidian 状态栏浮窗；浮窗已移除，现在刷新四个主界面装配的快速切换器。
     */
    public updateStatusBarText(): void {
        refreshAllModelSwitchers();
    }

    // ─── 提供商管理（委托至 core/provider-manager）───
    public getCurrentProviderId(): string | null { return this._providerManager.getCurrentProviderId(); }
    public switchProviderByEndpoint(endpoint: string): boolean { return this._providerManager.switchByEndpoint(endpoint); }
    public resolveModelLimits(modelName: string, endpoint?: string) { return this._providerManager.resolveModelLimits(modelName, endpoint); }
    public updateModelLimitsFromModel(modelName: string): void { this._providerManager.updateModelLimits(modelName); }
    public setCurrentModelOverride(field: 'maxContext' | 'maxOutput', value: number): void {
        this._providerManager.setModelOverride(this.getCurrentProviderId() || 'unknown', this.settings.defaultModel, field, value);
    }
    public addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string, apiFormat?: CustomProvider['apiFormat']): string | null {
        return this._providerManager.addCustom(name, endpoint, models, maxContext, maxOutput, apiKey, apiFormat);
    }
    public deleteCustomProvider(id: string): boolean { return this._providerManager.deleteCustom(id); }
    public getAllProviders() { return this._providerManager.getAllProviders(); }
    public setHidden(id: string, hidden: boolean): boolean { return this._providerManager.setHidden(id, hidden); }
    public restoreDefaultProviders(): void { this._providerManager.restoreDefaultProviders(); }
    public updateProvider(id: string, updates: any): boolean { return this._providerManager.updateProvider(id, updates); }
    public hidePreset(presetId: string): boolean { return this._providerManager.hidePreset(presetId); }
    public restorePreset(presetId: string): boolean { return this._providerManager.restorePreset(presetId); }
    public restoreAllPresets(): void { this._providerManager.restoreAllPresets(); }
    public savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean {
        return this._providerManager.savePresetOverride(presetId, name, endpoint, models, maxContext, maxOutput);
    }

    /**
     * 快速切换入口（命令面板 + 快捷工具「切换 AI 提供商」共用）：
     * 两级菜单 —— 第一级选 API 供应商，第二级选该供应商下的模型 ID。
     */
    public openProviderSwitcher(): void {
        openModelSwitcherMenu(this);
    }

    public refreshFullWriterContextPanel(): void {
        this.app.workspace.trigger('novel-writer:refresh-context-panel', {});
    }

    get aiEngine(): AIEngine {
        return this.engineRegistry.get<AIEngine>(ENGINE_NAMES.AI_ENGINE);
    }

    get coWriterEngine(): CoWriterEngine {
        return this.engineRegistry.get<CoWriterEngine>(ENGINE_NAMES.CO_WRITER_ENGINE);
    }

    /** 公开访问器 — 供 Modal / UI 组件依赖注入使用 */
    public get foreshadowManager(): ForeshadowManager { return this._foreshadowManager; }
    public get reviewAgent(): ReviewAgent { return this._reviewAgent; }

    /** 分析报告引擎（懒加载，首次访问时由注册表创建） */
    get analysisReportEngine(): AnalysisReportEngine {
        return this.engineRegistry.get<AnalysisReportEngine>(ENGINE_NAMES.ANALYSIS_REPORT_ENGINE);
    }

    get cacheManager(): PluginCacheManager {
        if (!this._cacheManager) {
            throw new Error('cacheManager not initialized');
        }
        return this._cacheManager;
    }

    /**
     * 打开本插件的设置页。
     * Obsidian 未提供公开 API，只能用内部的 `app.setting`；不可用时退回提示用户手动进入。
     */
    openPluginSettings(): boolean {
        const appSetting = (this.app as unknown as {
            setting?: { open(): void; openTabById(id: string): void };
        }).setting;
        try {
            if (appSetting?.openTabById) {
                appSetting.open();
                appSetting.openTabById(this.manifest.id);
                return true;
            }
        } catch (e) {
            log.warn('[小说工坊] 打开设置页失败:', e);
        }
        new Notice('请在「设置 → 第三方插件 → 小说工坊 AI」中打开插件设置', 6000);
        return false;
    }

    executeCommand(commandId: string): boolean {
        // 使用内置的 Registry（函数指针）替代 Obsidian 字符串 ID 路由
        if (this.registry.has(commandId)) {
            this.registry.execute(commandId).catch(err => log.error('[小说工坊] Registry 执行失败:', err));
            return true;
        }
        // 临时兼容桥：registry 中不存在时 fallback 到 Obsidian 命令系统
        log.warn('[小说工坊] 命令 ' + commandId + ' 未在 Registry 注册，fallback 到 Obsidian 路由');
        return this.app.commands.executeCommandById(commandId);
    }

    /** 最近的长流程执行记录（诊断/E2E/Agent 端口共用；新→旧） */
    getExecutionLedgerRecords(limit = 20): Array<Record<string, unknown>> {
        return getExecutionLedger().getRecent(limit) as unknown as Array<Record<string, unknown>>;
    }

    /**
     * 可等待的命令执行（Agent 长流程用）。
     *
     * executeCommand 是 fire-and-forget（UI 点击不需要等），Agent 却必须知道
     * 「派发成功还是立刻抛错」。这里对 registry 命令 await 真实完成，
     * 未注册的命令仍走 Obsidian 路由（同步派发，无法等待）。
     */
    async executeCommandAsync(commandId: string): Promise<boolean> {
        if (this.registry.has(commandId)) {
            try {
                await this.registry.execute(commandId);
                return true;
            } catch (err) {
                log.error('[小说工坊] Registry 执行失败:', err);
                return false;
            }
        }
        log.warn('[小说工坊] 命令 ' + commandId + ' 未在 Registry 注册，fallback 到 Obsidian 路由');
        return this.app.commands.executeCommandById(commandId) === true;
    }


    // ─── 自适应防抖管理器 ───

    private _debounceManager = new AdaptiveDebounceManager({ debug: false });
    private _settingsWriter = new SerializedWriter({ debug: false });
    private _cacheManager: PluginCacheManager | null = null;

    // ─── 设置持久化 debounce ───

    private scheduleOverrideSave(): void {
        this._debounceManager.debounceFixed('override-save', () => {
            this.saveSettings().catch(e => log.warn('[小说工坊] 模型覆盖保存失败:', e));
        }, 500);
    }

    // ─── 正文文件变更监听与实体状态重检 ───

    private handleBodyFileModify(file: TFile): void {
        const path = file.path;
        this._debounceManager.debounceFixed(`body-modify:${path}`, () => {
            this.runEntityStateRecheck(file).catch(e =>
                log.warn('[小说工坊] 正文编辑实体状态重检失败:', e)
            );
        }, 3000);
    }

    private async runEntityStateRecheck(file: TFile): Promise<void> {
        try {
            const pathMatch = file.path.match(/^([^/]+\/[^/]+)\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章_正文\.md$/);
            if (!pathMatch) return;

            const project = pathMatch[1];
            const volN = parseInt(pathMatch[2], 10);
            const chapN = parseInt(pathMatch[3], 10);

            const content = await this.app.vault.read(file);
            if (!content || content.length < 50) return;

            const manager = new EntityStateManager({
                app: this.app,
                plugin: this,
                aiEngine: this.aiEngine,
            });

            const changes = await manager.detectStateChanges(
                content,
                project,
                chapN,
                `第${chapN}章`
            );

            if (changes.length > 0) {
                await manager.applyStateChanges(project, changes, chapN, `第${chapN}章`);
                await manager.updateInvolvedEntities(project, file.path, content);
                log.info(`[小说工坊] 正文手动编辑触发实体状态更新: ${changes.length}项变更`);
            }
        } catch (e) {
            log.warn('[小说工坊] 实体状态自动重检异常:', e);
        }
    }

    // ─── 主题变量注入（委托至 core/theme-manager）───
    public injectThemeVariables(): void { this._themeManager.injectThemeVariables(); }
    public injectLayoutVariables(): void { this._themeManager.injectLayoutVariables(); }

    openChapterInFullWriter(project: string, chapterPath: string) {
        // Open the full writer view with this chapter
        this.activateFullWriterView(project, chapterPath);
    }

    async activateFullWriterView(project: string, chapterPath?: string) {
        // Find or create full writer workspace leaf
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType('novel-writer-full-writer');
        let leaf = leaves[0];
        if (!leaf) {
            try {
                leaf = workspace.getLeaf('tab');
            } catch (e) {
                log.warn('[main] getLeaf(tab) 失败，回退到已有 leaf:', e);
            }
            if (!leaf) {
                // 完全回退，创建新的 leaf
                log.warn('[main] 无法获取 workspace leaf，跳过面板创建');
                new Notice('⚠️ 工作台面板创建失败，请检查侧边栏是否已打开', 5000);
                return;
            }
            try {
                await leaf.setViewState({ type: 'novel-writer-full-writer', active: true });
            } catch (e) {
                log.error('[main] setViewState 失败:', e);
                new Notice('⚠️ 工作台面板激活失败，请重试', 5000);
                return;
            }
        }
        if (!leaf) {
            new Notice('⚠️ 工作台面板创建失败', 5000);
            return;
        }
        workspace.revealLeaf(leaf);
        
        if (chapterPath && leaf?.view) {
            const view = leaf.view;
            if (view instanceof FullWriterView) {
                await view.openChapterByPath(project, chapterPath);
            } else {
                log.warn('[小说工坊] 工作台视图类型不匹配，跳过章节自动定位');
            }
        }
    }

    // ─── 版本管理 ───

    /**
     * 处理版本管理相关逻辑：
     * 1. 静默检查更新（如果启用）
     * 2. 首次安装欢迎引导
     * 3. 版本升级时显示更新内容
     * 4. 数据迁移验证和备份
     */
    private handleVersionManagement(): void {
        const currentVersion = PLUGIN_VERSION || '4.5.1';
        const cacheManager = this._cacheManager;
        if (!cacheManager) return;

        const lastVersion = cacheManager.getLastRunVersion();
        const isFirstInstall = !lastVersion;

        // 备份设置（版本升级时）
        if (lastVersion && lastVersion !== currentVersion) {
            try {
                const settingsCopy = JSON.parse(JSON.stringify(this.settings));
                cacheManager.setSettingsBackup({
                    version: lastVersion,
                    timestamp: new Date().toISOString(),
                    settings: settingsCopy,
                });
                log.info(`[版本管理] 已备份 v${lastVersion} 的设置`);
            } catch (e) {
                log.warn('[版本管理] 设置备份失败:', e);
                new Notice('⚠️ 设置备份失败，请查看控制台', 5000);
            }
        }

        // 更新上次运行版本
        cacheManager.setLastRunVersion(currentVersion);
        // 升级后旧 updateLastResult 可能仍记录旧 currentVersion；读取一次会按当前版本纠正并回写。
        try {
            const updateChecker = this.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
            updateChecker?.getLastCheckResult?.();
        } catch (e) {
            log.warn('[版本管理] 更新缓存版本纠正失败:', e);
        }

        // 首次安装：显示欢迎模态框
        if (isFirstInstall) {
            setTimeout(() => {
                this.showWelcomeModal(true);
            }, 1000);
            return;
        }

        // 版本升级时：大版本更新显示更新内容
        if (lastVersion && compareVersions(currentVersion, lastVersion) > 0) {
            const isMajor = isMajorUpdate(lastVersion, currentVersion);
            if (isMajor) {
                setTimeout(() => {
                    this.showWelcomeModal(false);
                }, 1000);
            }
        }

        // 静默检查更新（后台执行，不阻塞）
        if (this.settings.autoCheckUpdates) {
            setTimeout(() => {
                this.silentCheckForUpdates();
            }, 3000);
        }
    }

    /** 静默检查更新（后台运行，不打扰用户） */
    private async silentCheckForUpdates(): Promise<void> {
        try {
            const updateChecker = this.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
            if (!updateChecker) return;

            if (!updateChecker.shouldCheck()) return;

            log.info('[版本管理] 正在后台检查更新...');
            const result = await updateChecker.checkForUpdates(false);

            if (result.hasUpdate && result.latestVersion) {
                log.info(`[版本管理] 发现新版本: v${result.latestVersion}`);
            } else if (result.error) {
                log.warn('[版本管理] 更新检查失败:', result.error);
            } else {
                log.info('[版本管理] 已是最新版本');
            }
        } catch (e) {
            log.warn('[版本管理] 静默检查更新异常:', e);
        }
    }

    /** 显示欢迎/更新模态框 */
    private showWelcomeModal(isNewInstall: boolean): void {
        const cacheManager = this._cacheManager;
        if (!cacheManager) return;

        const modal = new WelcomeModal(this.app, {
            currentVersion: PLUGIN_VERSION || '4.5.1',
            isNewInstall,
            onOpenSettings: () => {
                this.openPluginSettings();
            },
            onStartWriting: () => {
                this.openFullWriterView();
            },
            onChangelog: () => {
                new ChangelogModal(this.app, {
                    highlightVersion: PLUGIN_VERSION || '4.9.0',
                    showWelcomeMessage: isNewInstall,
                }).open();
            },
            onDontShowAgain: () => {
                cacheManager.setWelcomed(true);
            },
        });
        modal.open();
    }

    /** 打开更新日志模态框 */
    public openChangelog(highlightVersion?: string): void {
        new ChangelogModal(this.app, {
            highlightVersion,
        }).open();
    }

    onunload() {
        // 清理拆解调度器资源（定时器、看门狗、事件监听器）
        this.deconstructionScheduler?.destroy();
        // 清理防抖管理器
        this._debounceManager.dispose();
        // 等待设置写入队列完成（不阻塞卸载，尽力而为）
        this._settingsWriter.flush().catch(e =>
            log.warn('[小说工坊] 卸载时设置写入失败:', e)
        );
        // 清理缓存管理器
        this._cacheManager?.dispose();
        // P0-14/16: 不再向 localStorage 保存恢复状态。
        // 热重载恢复完全通过内存态 _pendingReloadState 传递（按钮 handler 在 disable 前设置）。
        // 这样 Obsidian 正常关闭→启动时不会有任何残留，工作台默认不打开。
        localStorage.removeItem('novel-writer-reload-state');
        localStorage.removeItem('novel-writer-user-reload');
        // v5.5: 卸载时关闭分离式浮窗（监控面板A/B + 协同写作视图叶子），避免残留空叶子。
        this.workspaceManager?.closeAll();
        // 2026-10-28: 状态栏浮窗已移除，其点击监听清理随之删除；快速切换器由各视图自行销毁。
        // 注销降级事件 sink
        if (this._degradationSinkUnregister) {
            this._degradationSinkUnregister();
            this._degradationSinkUnregister = null;
        }
        // 清理所有注入的样式标签（匹配 novel-writer 前缀）
        const allStyles = document.querySelectorAll('style[id^="novel-writer-"]');
        allStyles.forEach(el => el.remove());
        // M1（技术审计）：释放 EngineRegistry 全部实例（含 HeavyTaskWorkerManager 的 Worker 池等）。
        // 此前 disposeAll 生产代码零调用，插件卸载/禁用后 Worker 与重资源残留。
        // disposeAll 按依赖逆序逐个释放，单个失败不影响其他；同步清理在前，故置于末尾。
        this.engineRegistry?.disposeAll().catch(e =>
            log.warn('[小说工坊] 卸载时释放引擎实例失败:', e)
        );
        log.info('Novel Writer AI plugin unloaded');
    }
}


