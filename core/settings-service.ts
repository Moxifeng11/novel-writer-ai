/**
 * settings-service.ts — 设置加载/保存服务
 *
 * 职责：设置迁移、密钥加解密、模型限制同步、自定义提供商同步
 * 从 main.ts 拆分而来
 */

import type { NovelWriterSettings, CustomProvider } from '../main';
import { PROVIDERS } from '../main';
import { migrateSettings, withCurrentVersion, CURRENT_SCHEMA_VERSION } from '../shared/settings-migrator';
import type { CryptoService } from './crypto-service';
import type { ProviderManager } from './provider-manager';
import type { PluginCacheManager } from '../shared/plugin-cache';
import type { SerializedWriter } from '../shared/serialized-writer';

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
        const settings = Object.assign({}, getDefaultSettings(), migratedData) as NovelWriterSettings;
        this.deps.setSettings(settings);

        // 解密所有密钥
        settings.apiKey = await this.deps.crypto.decrypt(settings.apiKey);
        settings.providerKeys = settings.providerKeys || {};
        for (const [k, v] of Object.entries(settings.providerKeys)) {
            if (typeof v === 'string' && v) {
                settings.providerKeys[k] = await this.deps.crypto.decrypt(v);
            }
        }

        // 同步自定义提供商模型列表
        this.deps.providerManager.syncCustomModelsOnRestart();
        // 同步模型限制
        this.deps.providerManager.updateModelLimits(settings.flashModel);
    }

    /** 保存设置：加密 → 版本号包装 → 持久化 */
    async saveSettings(): Promise<void> {
        const settings = this.deps.getSettings();
        const encryptedApiKey = await this.deps.crypto.encrypt(settings.apiKey);
        const keysToSave: Record<string, string> = {};
        for (const [k, v] of Object.entries(settings.providerKeys || {})) {
            if (typeof v === 'string' && v) {
                keysToSave[k] = await this.deps.crypto.encrypt(v);
            }
        }
        const dataToSave = withCurrentVersion({
            ...settings,
            apiKey: encryptedApiKey,
            providerKeys: keysToSave,
        });
        // 双写缓存
        if (this.deps.cacheManager && settings.panelLayout) {
            this.deps.cacheManager.setPanelLayout(settings.panelLayout);
        }
        return this.deps.settingsWriter.enqueueAutoClean(() => this.deps.saveData(dataToSave));
    }
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
        availableModels: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228'],
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
        maxApiRetries: 3,
        maxEntityBatchRetries: 2,
        providerKeys: {},
        customProviderName: '',
        customProviders: [],
        hiddenPresets: [],
        theme: 'auto',
    };
}
