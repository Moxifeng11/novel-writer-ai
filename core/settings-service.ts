/**
 * settings-service.ts — 设置加载/保存服务
 *
 * 职责：设置迁移、密钥加解密、模型限制同步、自定义提供商同步
 * 从 main.ts 拆分而来
 */

import type { NovelWriterSettings, CustomProvider } from '../main';
import { DEFAULT_PROVIDERS } from '../main';
import { migrateSettings, withCurrentVersion, CURRENT_SCHEMA_VERSION } from '../shared/settings-migrator';
import type { CryptoService } from './crypto-service';
import type { ProviderManager } from './provider-manager';
import type { PluginCacheManager } from '../shared/plugin-cache';
import type { SerializedWriter } from '../shared/serialized-writer';
import { DEFAULT_PROMPT_MANAGER_CONFIG } from '../services/prompt-manager-types';
import { DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from '../services/deconstruction-scheduler';
import { DEFAULT_FORESHADOW_CONFIG } from '../engine/foreshadow-config-manager';

/** SettingsService 依赖 */
export interface SettingsServiceDeps {
    crypto: CryptoService;
    providerManager: ProviderManager;
    cacheManager: PluginCacheManager | null;
    settingsWriter: SerializedWriter;
    /** 读取当前设置 */
    getSettings(): NovelWriterSettings;
    /** 替换设置对象（loadSettings 时） */
    setSettings(s: NovelWriterSettings): void;
    /** Obsidian loadData */
    loadData(): Promise<any>;
    /** Obsidian saveData */
    saveData(data: any): Promise<void>;
}

export class SettingsService {
    private readonly deps: SettingsServiceDeps;

    constructor(deps: SettingsServiceDeps) {
        this.deps = deps;
    }

    /** 加载设置：迁移 → 解密 → 同步自定义模型 */
    async loadSettings(): Promise<void> {
        const rawData = await this.deps.loadData();
        const migratedData = migrateSettings(rawData);
        // D5：统一深合并。旧配置缺失的嵌套字段回落默认值；数组整体替换；undefined 不覆盖。
        const defaults = getDefaultSettings();
        const settings = deepMergeSettings(defaults, migratedData) as NovelWriterSettings;

        if (migratedData && typeof migratedData === 'object') {
            if (typeof (migratedData as Record<string, unknown>).coWriteLayout === 'string') {
                settings.coWriteLayout = (migratedData as Record<string, unknown>).coWriteLayout as 'split' | 'stacked';
            }
            if (typeof (migratedData as Record<string, unknown>).coWriteEditorWidthRatio === 'number') {
                const ratio = (migratedData as Record<string, unknown>).coWriteEditorWidthRatio as number;
                settings.coWriteEditorWidthRatio = Math.max(0.4, Math.min(0.85, ratio));
            }
            if (typeof (migratedData as Record<string, unknown>).coWriteSuggestionPanelVisible === 'boolean') {
                settings.coWriteSuggestionPanelVisible = (migratedData as Record<string, unknown>).coWriteSuggestionPanelVisible as boolean;
            }
            if (typeof (migratedData as Record<string, unknown>).coWriteShowAdvanced === 'boolean') {
                settings.coWriteShowAdvanced = (migratedData as Record<string, unknown>).coWriteShowAdvanced as boolean;
            }
        }
        this.deps.setSettings(settings);

        // 解密所有密钥（启动期静默：未解锁时保留密文，避免弹口令阻塞 onload）
        settings.apiKey = await this.deps.crypto.decryptWithoutPrompt(settings.apiKey);
        settings.providerKeys = settings.providerKeys || {};
        for (const [k, v] of Object.entries(settings.providerKeys)) {
            if (typeof v === 'string' && v) {
                settings.providerKeys[k] = await this.deps.crypto.decryptWithoutPrompt(v);
            }
        }
        // 解密向量模型 API Key
        settings.vectorOpenaiApiKey = await this.deps.crypto.decryptWithoutPrompt(settings.vectorOpenaiApiKey || '');
        settings.vectorDoubaoApiKey = await this.deps.crypto.decryptWithoutPrompt(settings.vectorDoubaoApiKey || '');
        settings.vectorQwenApiKey = await this.deps.crypto.decryptWithoutPrompt(settings.vectorQwenApiKey || '');

        // 同步自定义提供商模型列表
        this.deps.providerManager.syncCustomModelsOnRestart();
        // 同步模型限制
        this.deps.providerManager.updateModelLimits(settings.flashModel);

        // D5：迁移结果回写。旧版本或缺少新字段时写回一次：
        // deepMerge 只补内存，不写回的话下次启动仍要重复迁移，磁盘配置也一直缺字段。
        const rawVersion = (rawData as Record<string, unknown> | null | undefined)?.schemaVersion;
        const missingDefaultKeys = Object.keys(defaults).filter(key => !(key in (migratedData ?? {})));
        if (rawVersion !== CURRENT_SCHEMA_VERSION || missingDefaultKeys.length > 0) {
            await this.saveSettings();
        }
    }

    /**
     * 已是密文的值原样保存，避免「启动静默保留密文 → 用户改设置触发保存」时二次加密，
     * 导致下次解密得到另一段密文而无法使用。
     * 无会话口令时保持明文，不主动弹「设置加密口令」——后台保存（切面板、存布局、
     * 视图初始化）也会走 saveSettings，弹窗会打断写作并阻塞 onload。
     */
    private async encryptIfPlain(value: string): Promise<string> {
        if (!value) return '';
        if (value.startsWith('aes256v2:') || value.startsWith('aes256:')) return value;
        if (!this.deps.crypto.hasSessionPassword()) return value;
        return this.deps.crypto.encrypt(value);
    }

    /** 保存设置：加密 → 版本号包装 → 持久化 */
    async saveSettings(): Promise<void> {
        const settings = this.deps.getSettings();
        const encryptedApiKey = await this.encryptIfPlain(settings.apiKey);
        const keysToSave: Record<string, string> = {};
        for (const [k, v] of Object.entries(settings.providerKeys || {})) {
            if (typeof v === 'string' && v) {
                keysToSave[k] = await this.encryptIfPlain(v);
            }
        }
        const encryptedVectorApiKey = await this.encryptIfPlain(settings.vectorOpenaiApiKey || '');
        const encryptedDoubaoApiKey = await this.encryptIfPlain(settings.vectorDoubaoApiKey || '');
        const encryptedQwenApiKey = await this.encryptIfPlain(settings.vectorQwenApiKey || '');
        const dataToSave = withCurrentVersion({
            ...settings,
            apiKey: encryptedApiKey,
            providerKeys: keysToSave,
            vectorOpenaiApiKey: encryptedVectorApiKey,
            vectorDoubaoApiKey: encryptedDoubaoApiKey,
            vectorQwenApiKey: encryptedQwenApiKey,
        });
        // 双写缓存
        if (this.deps.cacheManager && settings.panelLayout) {
            this.deps.cacheManager.setPanelLayout(settings.panelLayout);
        }
        return this.deps.settingsWriter.enqueueAutoClean(() => this.deps.saveData(dataToSave));
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * D5：设置深合并。
 * - 嵌套对象递归合并，旧配置缺失的字段回落默认值
 * - 数组整体替换（模型列表、自定义提供商等不能按索引合并）
 * - undefined 不覆盖默认值
 */
export function deepMergeSettings<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : override) as T;
    }
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        result[key] = isPlainObject(result[key]) && isPlainObject(value)
            ? deepMergeSettings(result[key], value)
            : value;
    }
    return result as T;
}

/** 默认设置 */
export function getDefaultSettings(): NovelWriterSettings {
    return {
        apiKey: '',
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        defaultModel: 'deepseek-v3-2-251201',
        flashModel: 'deepseek-v3-2-251201',
        proModel: 'doubao-seed-2-0-pro-260215',
        coWriteModel: '',
        coWriteTemperature: 0.7,
        coWriteMaxTokens: 600,
        coWriteModelMode: 'local',
        coWriteCloudProvider: '',
        coWriteCloudModel: '',
        autoPlotEvaluation: true,
        autoGhostAssociation: true,
        precisionMode: false,
        refineRounds: 3,
        candidateParallel: true,
        promptCacheEnabled: true,
        antiAiExtraWords: [],
        wordMinRatio: 0.7,
        promptSplitRatio: 0.67,
        availableModels: DEFAULT_PROVIDERS.volc.models,
        maxContext: 128000,
        maxOutput: 32768,
        modelOverrides: {},
        modelOverrideHistory: [],
        defaultWordCount: 3000,
        minWordCount: 2500,
        maxWordCount: 5000,
        enableAutoReview: true,
        enableAutoCorrect: true,
        enableAutoModelFallback: true,
        contextScope: 'compact',
        infoDebtThreshold: 10,
        maxUnrevealedForeshadow: 20,
        foreshadowConfig: { ...DEFAULT_FORESHADOW_CONFIG },
        maxApiRetries: 3,
        maxEntityBatchRetries: 2,
        providerKeys: {},
        customProviderName: '',
        customProviders: Object.values(DEFAULT_PROVIDERS),
        theme: 'auto',
        embeddingModel: 'bge-m3',
        embeddingEndpoint: 'http://localhost:11434',
        vectorEnhancedDeconstruction: true,
        vectorDeconstructionThreshold: 0.3,
        vectorProviderType: 'ollama',
        vectorOllamaBaseUrl: 'http://localhost:11434',
        vectorOllamaModel: 'bge-m3',
        vectorOpenaiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        vectorOpenaiModel: 'doubao-embedding-text-240915',
        vectorOpenaiApiKey: '',
        vectorDoubaoBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        vectorDoubaoModel: 'doubao-embedding-text-240915',
        vectorDoubaoApiKey: '',
        vectorQwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        vectorQwenModel: 'text-embedding-v3',
        vectorQwenApiKey: '',
        vectorMode: 'auto',
        autoCheckUpdates: false,
        updateSource: 'github',
        updateGithubRepo: 'trae-ai/novel-writer-ai',
        updateCustomUrl: '',
        updateCheckIntervalHours: 168,
        promptManagerConfig: { ...DEFAULT_PROMPT_MANAGER_CONFIG },
        deconstructionEngine: { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS },
        characterRecognitionLayers: ['rule', 'vector'],
        ruleLayer: {
            minMentionCount: 5,
            enableFreqFilter: true,
            enableContextCheck: true,
            enableVerbFilter: true,
        },
        vectorLayer: {
            enabled: true,
            semanticFilterThreshold: 0.5,
            mergeSimilarityThreshold: 0.85,
        },
        llmLayer: {
            enabled: false,
            verifyBatchSize: 20,
            titleBatchSize: 8,
            minConfidence: 0.3,
        },
        suggestions: {
            autoAdoptHighConfidence: false,
            autoAdoptThreshold: 0.9,
            showEvidenceByDefault: false,
            batchAdoptThreshold: 0.7,
        },
        charts: {
            defaultDensity: 'normal',
            enableAnimations: true,
            defaultChartType: 'scatter',
            labelRotationThreshold: 8,
        },
        coWriteLayout: 'split',
        coWriteEditorWidthRatio: 0.65,
        coWriteSuggestionPanelVisible: true,
        coWriteShowAdvanced: false,
    };
}
