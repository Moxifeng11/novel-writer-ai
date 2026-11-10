/**
 * settings-service.ts — 设置加载/保存服务
 *
 * 职责：设置迁移、密钥加解密、模型限制同步、自定义提供商同步
 * 从 main.ts 拆分而来
 */

import type { NovelWriterSettings, CustomProvider } from '@/main';
import { DEFAULT_PROVIDERS } from '@/main';
import { migrateSettingsWithStatus, withCurrentVersion, CURRENT_SCHEMA_VERSION, DEFAULT_UPDATE_GITHUB_REPO, normalizeUpdateGithubRepo } from '@/shared/settings-migrator';
import type { CryptoService } from './crypto-service';
import type { ProviderManager } from './provider-manager';
import type { PluginCacheManager } from '@/shared/plugin-cache';
import type { SerializedWriter } from '@/shared/serialized-writer';
import { DEFAULT_PROMPT_MANAGER_CONFIG } from '@/shared/prompt-manager-types';
import { DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from '@/shared/deconstruction-settings';
import { DEFAULT_FORESHADOW_CONFIG } from '@/shared/foreshadow-config';
import { createLogger } from '@/shared/logger';

const log = createLogger('SettingsService');
/** v2 密文前缀（与 crypto-service 保持一致） */
const V2_PREFIX_LOCAL = 'aes256v2:';

/** SettingsService 依赖 */
export interface SettingsServiceDeps {
    crypto: CryptoService;
    providerManager: ProviderManager;
    cacheManager: PluginCacheManager | null;
    settingsWriter: SerializedWriter;
    /**
     * 读取当前设置
     *
      * @returns NovelWriterSettings 实例
     */
    getSettings(): NovelWriterSettings;
    /**
     * 替换设置对象（loadSettings 时）
     *
     * @param s - 字符串
     */
    setSettings(s: NovelWriterSettings): void;
    /**
     * Obsidian loadData
     *
      * @returns unknown 结果（调用方负责判型）
     */
    loadData(): Promise<unknown>;
    /**
     * Obsidian saveData
     *
     * @param data - 数据
     */
    saveData(data: unknown): Promise<void>;
    /**
     * 迁移/回写前备份当前 data.json（可选；实现方负责写 `<pluginDir>/data.json.bak`）。
     * 只在本次确实要写盘时调用，避免每次启动都覆盖备份。
     *
     * @param reason - 备份原因（日志用）
     */
    backupSettings?(reason: string): Promise<void>;
}

/**
 * 设置服务：读写、迁移与默认值合并的唯一入口。
 */
export class SettingsService {
    private readonly deps: SettingsServiceDeps;
    /**
     * 磁盘上密钥字段的原始值快照（解密前）。
     *
     * 用途：保存时如果拿不到口令，就保留这里记下的旧密文，
     * 绝不把已解密的明文（或新输入的明文）写回磁盘——那会把受保护的值降级，
     * 并造成「部分加密、部分明文」的混合状态。
     */
    private rawSecrets: Record<string, string> = {};

    constructor(deps: SettingsServiceDeps) {
        this.deps = deps;
    }

    /**
     * 是否已存在任何 v2 密文（决定能不能走「设定新口令」）
     *
     * @returns 是否成功
     */
    hasEncryptedSecrets(): boolean {
        return Object.values(this.rawSecrets).some(
            v => typeof v === 'string' && v.startsWith('aes256v2:'),
        );
    }

    /**
     * 任意一条已存在的 v2 密文（供 CryptoService 校验候选口令）
     *
      * @returns 文本结果 或 null
     */
    findExistingCiphertext(): string | null {
        for (const v of Object.values(this.rawSecrets)) {
            if (typeof v === 'string' && v.startsWith('aes256v2:')) return v;
        }
        return null;
    }

    /**
     * 候选口令能否解开磁盘上已有的 v2 密文（解锁前校验）。
     * 旧实现输入任意口令都提示「已解锁」，真正调用 AI 时才发现解不开。
     * @param password - 口令
     * @returns 是否成功
     */
    async canDecryptStoredSecret(password: string): Promise<boolean> {
        const existing = this.findExistingCiphertext();
        if (!existing) return true;
        try {
            return await this.deps.crypto.canDecryptWith(password, existing);
        } catch {
            return false;
        }
    }

    /** v4.27：最近一次启动时未完成的设置迁移（null = 正常） */
    private migrationIncomplete: { fromVersion: number; toVersion: number; error?: string } | null = null;
    /** 磁盘上仍为 v1（`aes256:`）的密钥条数：下次有口令时自动升级为 v2 */
    private legacySecretCountValue = 0;

    /**
     * 磁盘上仍处于密文状态、且本次会话未能解开的条目数（UI 用）
     *
     * @returns 数值结果
     */
    lockedSecretCount(): number {
        return Object.values(this.rawSecrets).filter(
            v => typeof v === 'string' && v.startsWith('aes256v2:'),
        ).length;
    }

    /**
     * 磁盘上仍为 v1 密文的密钥条数（v1 seed 是公开常量，等同混淆）。
     * 有会话口令时保存会自动升级为 v2；无口令时保持旧密文，不降级明文。
     *
     * @returns 数值结果
     */
    legacySecretCount(): number {
        return this.legacySecretCountValue;
    }

    /** 加载设置：迁移 → 解密 → 同步自定义模型 */
    async loadSettings(): Promise<void> {
        // Obsidian 磁盘数据是不可信输入：这里按迁移器契约收窄（纯类型断言，零运行时）
        const rawData = (await this.deps.loadData()) as Record<string, unknown>;
        const outcome = migrateSettingsWithStatus(rawData);
        const migratedData = outcome.data;
        // v4.27：迁移未完成时不回写 schemaVersion（旧实现会把失败盖章为已完成，永不重试）
        this.migrationIncomplete = outcome.completed ? null : { ...outcome };
        // D5：统一深合并。旧配置缺失的嵌套字段回落默认值；数组整体替换；undefined 不覆盖。
        const defaults = getDefaultSettings();
        const settings = deepMergeSettings(defaults, migratedData) as NovelWriterSettings;
        const rawUpdateRepo = (migratedData as Record<string, unknown> | null | undefined)?.updateGithubRepo;
        const normalizedUpdateRepo = normalizeUpdateGithubRepo(typeof rawUpdateRepo === 'string' ? rawUpdateRepo : undefined);
        const updateRepoChanged = typeof rawUpdateRepo === 'string' && rawUpdateRepo !== normalizedUpdateRepo;
        if (updateRepoChanged) {
            settings.updateGithubRepo = normalizedUpdateRepo;
            // 旧仓库产生的 404 结果不能继续展示；清空后下一次检查使用新仓库。
            this.deps.cacheManager?.setUpdateLastResult(undefined);
            this.deps.cacheManager?.setUpdateLastCheck('');
        }

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

        // 记录磁盘原始值（解密前），保存时用于「拿不到口令就保留旧密文」
        this.rawSecrets = this.collectRawSecrets(migratedData);
        this.legacySecretCountValue = Object.values(this.rawSecrets).filter(
            v => typeof v === 'string' && v.startsWith('aes256:'),
        ).length;
        if (this.legacySecretCountValue > 0) {
            log.warn(`[SettingsService] 检测到 ${this.legacySecretCountValue} 项 v1 密文，保存时将升级为 v2`);
        }

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
        settings.updateGithubToken = await this.deps.crypto.decryptWithoutPrompt(settings.updateGithubToken || '');
        if (settings.canonResearch && settings.canonResearch.apiKey) {
            settings.canonResearch.apiKey = await this.deps.crypto.decryptWithoutPrompt(settings.canonResearch.apiKey);
        }

        // 同步自定义提供商模型列表
        this.deps.providerManager.syncCustomModelsOnRestart();
        // 同步模型限制
        this.deps.providerManager.updateModelLimits(settings.flashModel);

        // D5：迁移结果回写。旧版本或缺少新字段时写回一次：
        // deepMerge 只补内存，不写回的话下次启动仍要重复迁移，磁盘配置也一直缺字段。
        const rawVersion = (rawData as Record<string, unknown> | null | undefined)?.schemaVersion;
        const missingDefaultKeys = Object.keys(defaults).filter(key => !(key in (migratedData ?? {})));
        if (!outcome.completed) {
            // 迁移失败：保留磁盘原文件（不写 schemaVersion），交给下次启动重试
            log.warn('[SettingsService] 设置迁移未完成，跳过回写以保留原始数据:', outcome.error || `停在 v${outcome.toVersion}`);
            return;
        }
        // v1 密文只在已有会话口令时自动升级；无口令时保存会触发口令框，
        // 不能放在启动路径上（会阻塞 onload），留给用户下次保存设置时处理。
        const migrateLegacy = this.legacySecretCountValue > 0 && this.deps.crypto.hasSessionPassword();
        if (rawVersion !== CURRENT_SCHEMA_VERSION || missingDefaultKeys.length > 0 || updateRepoChanged || migrateLegacy) {
            await this.deps.backupSettings?.(
                migrateLegacy ? 'v1 密钥升级 v2' : `设置迁移 v${String(rawVersion ?? '?')} → v${CURRENT_SCHEMA_VERSION}`,
            );
            await this.saveSettings();
        }
    }

    /**
     * 最近一次启动时未完成的迁移（UI 可据此提示用户）
     *
      * @returns string } 结果 或 null
     */
    getMigrationIncomplete(): { fromVersion: number; toVersion: number; error?: string } | null {
        return this.migrationIncomplete;
    }

    /** 从迁移后的原始数据里取出各密钥字段的磁盘值（未解密） */
    private collectRawSecrets(raw: unknown): Record<string, string> {
        const data = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
        const out: Record<string, string> = {
            apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
            vectorOpenaiApiKey: typeof data.vectorOpenaiApiKey === 'string' ? data.vectorOpenaiApiKey : '',
            vectorDoubaoApiKey: typeof data.vectorDoubaoApiKey === 'string' ? data.vectorDoubaoApiKey : '',
            vectorQwenApiKey: typeof data.vectorQwenApiKey === 'string' ? data.vectorQwenApiKey : '',
            updateGithubToken: typeof data.updateGithubToken === 'string' ? data.updateGithubToken : '',
            'canonResearch.apiKey': (() => {
                const canon = data.canonResearch;
                return canon && typeof canon === 'object' && typeof (canon as Record<string, unknown>).apiKey === 'string'
                    ? (canon as Record<string, string>).apiKey
                    : '';
            })(),
        };
        const providerKeys = (data.providerKeys && typeof data.providerKeys === 'object' && !Array.isArray(data.providerKeys))
            ? data.providerKeys as Record<string, unknown>
            : {};
        for (const [k, v] of Object.entries(providerKeys)) {
            if (typeof v === 'string') out[`providerKeys.${k}`] = v;
        }
        return out;
    }

    /**
     * 决定某个密钥字段最终写到磁盘上的值。
     *
     * 规则（按优先级）：
     * 1. 空值 → 空；
     * 2. 已是密文 → 原样保留（避免二次加密）；
     * 3. 有会话口令 / 本字段原本是密文 / **磁盘上任何字段已有密文** → 必须加密；
     *    拿不到口令时保留旧值（无旧值则拒绝写入），绝不新增明文。
     *    混合态（部分密文 + 部分历史明文）也必须按此执行，否则新 Key 会静默明文落盘；
     * 4. 从未用过口令（磁盘上没有任何密文）→ 沿用「明文保存」的旧行为。
     */
    private async resolveSecret(field: string, value: string): Promise<string> {
        if (!value) return '';
        if (value.startsWith(V2_PREFIX_LOCAL) || value.startsWith('aes256:')) return value;
        const previous = this.rawSecrets[field];
        const previousIsCipher = typeof previous === 'string'
            && (previous.startsWith(V2_PREFIX_LOCAL) || previous.startsWith('aes256:'));
        if (this.deps.crypto.hasSessionPassword() || previousIsCipher || this.hasAnyCiphertext()) {
            const encrypted = await this.deps.crypto.encryptStrict(value);
            if (encrypted) return encrypted;
            if (typeof previous === 'string' && previous) {
                log.warn(`[小说工坊] 未能解锁口令，${field} 保留原值不写明文`);
                return previous;
            }
            // 没有旧值可保留：拒绝把新密钥明文落盘（调用方会读到空值）
            log.warn(`[小说工坊] 未能解锁口令，${field} 未写入（拒绝明文落盘）`);
            return '';
        }
        return value;
    }

    /** 磁盘上是否存在任意密文（v1 或 v2）；混合态据此拒绝新增明文 */
    private hasAnyCiphertext(): boolean {
        return Object.values(this.rawSecrets).some(
            v => typeof v === 'string'
                && (v.startsWith(V2_PREFIX_LOCAL) || v.startsWith('aes256:')),
        );
    }

    /** 保存设置：加密 → 版本号包装 → 持久化 */
    async saveSettings(): Promise<void> {
        const settings = this.deps.getSettings();
        const encryptedApiKey = await this.resolveSecret('apiKey', settings.apiKey);
        const keysToSave: Record<string, string> = {};
        for (const [k, v] of Object.entries(settings.providerKeys || {})) {
            if (typeof v === 'string' && v) {
                keysToSave[k] = await this.resolveSecret(`providerKeys.${k}`, v);
            }
        }
        const encryptedVectorApiKey = await this.resolveSecret('vectorOpenaiApiKey', settings.vectorOpenaiApiKey || '');
        const encryptedDoubaoApiKey = await this.resolveSecret('vectorDoubaoApiKey', settings.vectorDoubaoApiKey || '');
        const encryptedQwenApiKey = await this.resolveSecret('vectorQwenApiKey', settings.vectorQwenApiKey || '');
        const encryptedGithubToken = await this.resolveSecret('updateGithubToken', settings.updateGithubToken || '');
        // 同人考据的搜索 Key 也是第三方凭据：与其它密钥同一套加密策略，不能明文落 data.json
        const encryptedCanonKey = settings.canonResearch?.apiKey
            ? await this.resolveSecret('canonResearch.apiKey', settings.canonResearch.apiKey)
            : '';
        // S-2（v4.27）：迁移未完成时保留磁盘上的旧 schemaVersion，不「盖章」为已完成
        const baseData = {
            ...settings,
            apiKey: encryptedApiKey,
            providerKeys: keysToSave,
            vectorOpenaiApiKey: encryptedVectorApiKey,
            vectorDoubaoApiKey: encryptedDoubaoApiKey,
            vectorQwenApiKey: encryptedQwenApiKey,
            updateGithubToken: encryptedGithubToken,
            canonResearch: settings.canonResearch
                ? { ...settings.canonResearch, apiKey: encryptedCanonKey }
                : settings.canonResearch,
        };
        const dataToSave = this.migrationIncomplete
            ? { ...baseData, schemaVersion: this.migrationIncomplete.toVersion }
            : withCurrentVersion(baseData);
        // 双写缓存
        if (this.deps.cacheManager && settings.panelLayout) {
            this.deps.cacheManager.setPanelLayout(settings.panelLayout);
        }
        return this.deps.settingsWriter.enqueueAutoClean(async () => {
            await this.deps.saveData(dataToSave);
            // 写盘成功后刷新快照：v1 → v2 升级后 legacySecretCount 归零，
            // 后续保存也不会再拿旧密文当兜底。
            this.rawSecrets = this.collectRawSecrets(dataToSave);
            this.legacySecretCountValue = Object.values(this.rawSecrets).filter(
                v => typeof v === 'string' && v.startsWith('aes256:'),
            ).length;
        });
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
 * - null 不覆盖对象默认值：data.json 里 `"modelOverrides": null`（手工编辑/旧版损坏）
 *   会让设置页 `settings.modelOverrides[endpoint]` 直接抛 TypeError。
 * @param base - 基础
 * @param override - 覆盖配置
  * @returns T 实例
 */
export function deepMergeSettings<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : override) as T;
    }
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        if (value === null && isPlainObject(result[key])) continue;
        result[key] = isPlainObject(result[key]) && isPlainObject(value)
            ? deepMergeSettings(result[key], value)
            : value;
    }
    return result as T;
}

/**
 * 默认设置
 *
  * @returns NovelWriterSettings 实例
 */
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
        coWriteNumCtx: 0,
        coWriteCandidateBatching: true,
        coWriteModelMode: 'local',
        coWriteCloudProvider: '',
        coWriteCloudModel: '',
        referenceBookIds: [],
        referenceBookWeights: {},
        // 桌面宠物默认开启（移动端不创建）；每日目标 3000 字，可在设置里改
        petEnabled: true,
        dailyWordTarget: 3000,
        showWordCountInStatusBar: true,
        autoPlotEvaluation: true,
        autoGhostAssociation: true,
        precisionMode: false,
        refineRounds: 3,
        contextTokenCap: 0,
        contextCompressionMode: 'extractive',
        humanVoiceMode: 'exemplar',
        activeRulesVersion: '',
        activeBodyTemplate: 'auto',
        countableHumanHints: false,
        contextHygieneAutoFix: true,
        firstRunComplete: false,
        autoRevisionAfterQC: true,
        autoRecheckAfterRevision: true,
        experimentGroup: '',
        dedupeRulesInStyle: true,
        candidateParallel: true,
        promptCacheEnabled: true,
        antiAiExtraWords: [],
        wordMinRatio: 0.7,
        promptSplitRatio: 0.67,
        naturalParagraphMode: true,
        customFonts: [],
        coWriteEditorFont: '',
        agentWorkbenchLeftWidth: 210,
        agentWorkbenchRightWidth: 360,
        agentWorkbenchLeftCollapsed: false,
        agentWorkbenchRightCollapsed: false,
        settingsUiShowAdvanced: false,
        agentBackend: 'native',
        dshProvider: 'deepseek-official',
        dshModel: '',
        dshVersion: '0.2.1-rc.5',
        dshTurnTimeoutMs: 600_000,
        dshAllowVaultWrite: false,
        agentWriteApproval: 'ask',
        storyContextTier: 'auto',
        /** v4.20 写作指纹注入总预算（字符）；0 = 不限制 */
        fingerprintInjectionBudget: 2000,
        availableModels: DEFAULT_PROVIDERS.volc.models,
        maxContext: 128000,
        maxOutput: 32768,
        modelOverrides: {},
        modelOverrideHistory: [],
        taskBudgets: {},
        thinkingMode: 'auto',
        thinkingBudget: 0,
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
        embeddingFallbackPolicy: 'local-only',
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
        updateGithubRepo: DEFAULT_UPDATE_GITHUB_REPO,
        updateGithubToken: '',
        updateCustomUrl: '',
        updateCheckIntervalHours: 168,
        promptManagerConfig: { ...DEFAULT_PROMPT_MANAGER_CONFIG },
        deconstructionEngine: { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS },
        canonResearch: {
            provider: 'manual',
            apiKey: '',
            allowedDomains: [],
            blockedDomains: [],
            maxSources: 6,
            excerptChars: 1200,
        },
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
        coWriteLayout: 'split',
        coWriteEditorWidthRatio: 0.65,
        coWriteSuggestionPanelVisible: true,
        coWriteShowAdvanced: false,
    };
}
