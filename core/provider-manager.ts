/**
 * provider-manager.ts — AI 提供商管理服务
 *
 * 职责：提供商切换、自定义提供商增删、预设隐藏/恢复、模型覆盖值管理
 * 从 main.ts 拆分而来
 */

import { Notice } from 'obsidian';
import type { NovelWriterSettings, CustomProvider, ModelSourceType } from '../main';
import { DEFAULT_PROVIDERS, resolveProviderSourceType } from '../main';
import { findModelCapability, lookupModelCapability, type ModelSourceKind } from '../shared/model-capabilities';
import { createLogger } from '../shared/logger';


const log = createLogger('ProviderManager');
/** ProviderManager 所需的设置接口 */
export interface ProviderSettings {
    apiEndpoint: string;
    availableModels: string[];
    defaultModel: string;
    flashModel: string;
    proModel: string;
    apiKey: string;
    maxContext: number;
    maxOutput: number;
    modelOverrides: Record<string, Record<string, { maxContext?: number; maxOutput?: number }>>;
    modelOverrideHistory: NovelWriterSettings['modelOverrideHistory'];
    providerKeys: Record<string, string>;
    customProviderName: string;
    customProviders: CustomProvider[];
}

/** ProviderManager 依赖的外部回调 */
export interface ProviderManagerCallbacks {
    getSettings(): ProviderSettings;
    /** 触发设置持久化 */
    saveSettings(): Promise<void>;
    /** 刷新工作台上下文面板 */
    refreshContextPanel(): void;
    /** 更新状态栏文本 */
    updateStatusBar(): void;
    /** 缓存管理器写入历史 */
    addOverrideHistory?(entry: NovelWriterSettings['modelOverrideHistory'][number]): void;
}

export class ProviderManager {
    private readonly cb: ProviderManagerCallbacks;

    constructor(callbacks: ProviderManagerCallbacks) {
        this.cb = callbacks;
    }

    /** 获取当前提供商 ID（从 customProviders 中按 endpoint 查找） */
    getCurrentProviderId(): string | null {
        const s = this.cb.getSettings();
        const custom = s.customProviders?.find(c => c.endpoint === s.apiEndpoint);
        return custom ? custom.id : null;
    }

    /** 根据端点 URL 切换提供商 */
    switchByEndpoint(endpoint: string): boolean {
        const s = this.cb.getSettings();
        const provider = (s.customProviders || []).find(c => c.endpoint === endpoint);
        if (!provider) return false;

        const providerId = provider.id;

        s.providerKeys = s.providerKeys || {};
        const currentId = this.getCurrentProviderId();
        if (currentId) {
            s.providerKeys[currentId] = s.apiKey;
        }
        s.apiEndpoint = provider.endpoint;
        s.availableModels = [...provider.models];
        s.defaultModel = provider.models[0];
        s.flashModel = provider.models[0];
        s.proModel = provider.models[1] || provider.models[0];
        s.apiKey = s.providerKeys[providerId] || '';
        this.updateModelLimits(s.flashModel);
        this.cb.refreshContextPanel();
        this.cb.saveSettings().catch(e => log.warn('[小说工坊] 提供商切换保存失败:', e));
        return true;
    }

    /** 根据模型名称更新 maxContext / maxOutput */
    updateModelLimits(modelName: string): void {
        const s = this.cb.getSettings();
        const resolved = this.resolveModelLimits(modelName);
        s.maxContext = resolved.maxContext;
        s.maxOutput = resolved.maxOutput;
        log.info(`[小说工坊] 模型 "${modelName}" → maxContext=${resolved.maxContext}, maxOutput=${resolved.maxOutput}`);
    }

    /** 根据 endpoint + 模型名确定 maxContext / maxOutput 生效值 */
    resolveModelLimits(modelName: string, endpoint?: string): { maxContext: number; maxOutput: number } {
        const s = this.cb.getSettings();
        const endpointKey = endpoint || s.apiEndpoint;
        const override = s.modelOverrides[endpointKey]?.[modelName];

        // 优先级：用户覆盖 → 静态能力表（最长键优先）→ 提供商预设 → 来源兜底
        const staticCaps = lookupModelCapability(modelName);
        const provider = (s.customProviders || []).find(p => p.endpoint === endpointKey);
        const source: ModelSourceKind = resolveProviderSourceType({
            id: provider?.id || '',
            endpoint: endpointKey,
        }) === 'local' ? 'local' : 'cloud';
        const fallbackCaps = findModelCapability(modelName, source);
        const providerCaps = provider && provider.maxContext > 0
            ? {
                maxContext: provider.maxContext,
                maxOutput: provider.maxOutput > 0 ? provider.maxOutput : fallbackCaps.maxOutput,
            }
            : null;
        // 本地未登记模型优先用保守兜底：内置 ollama 预设的 32768 只适用于它列出的两个模型
        const baseCaps = staticCaps ?? (source === 'local' ? fallbackCaps : providerCaps ?? fallbackCaps);

        return {
            maxContext: override?.maxContext ?? baseCaps.maxContext,
            maxOutput: override?.maxOutput ?? baseCaps.maxOutput,
        };
    }

    /** 设置某个模型的覆盖值并记录历史 */
    setModelOverride(providerId: string, model: string, field: 'maxContext' | 'maxOutput', newValue: number): void {
        if (!Number.isFinite(newValue) || newValue <= 0) return;
        const s = this.cb.getSettings();
        const endpoint = s.apiEndpoint;
        const overrides = s.modelOverrides;
        if (!overrides[endpoint]) overrides[endpoint] = {};
        if (!overrides[endpoint][model]) overrides[endpoint][model] = {};
        const oldValue = overrides[endpoint][model][field] ?? s[field];
        if (oldValue === newValue) return;
        overrides[endpoint][model][field] = newValue;
        s[field] = newValue;
        const entry = {
            timestamp: new Date().toISOString(),
            providerId,
            model,
            field,
            oldValue,
            newValue,
        };
        s.modelOverrideHistory.push(entry);
        if (s.modelOverrideHistory.length > 100) {
            s.modelOverrideHistory = s.modelOverrideHistory.slice(-100);
        }
        this.cb.addOverrideHistory?.(entry);
        this.scheduleSave();
    }

    /** 添加自定义提供商 */
    addCustom(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string): string | null {
        const s = this.cb.getSettings();
        s.customProviders = s.customProviders || [];
        const trimmedEndpoint = endpoint.trim();
        const trimmedName = name.trim() || '自定义提供商';
        if (!trimmedEndpoint) return null;

        const existingByEndpoint = s.customProviders.find(c => c.endpoint.trim().toLowerCase() === trimmedEndpoint.toLowerCase());
        if (existingByEndpoint) {
            new Notice(`已存在相同端点的提供商：${existingByEndpoint.name}`);
            return null;
        }
        const existingByName = s.customProviders.find(c => c.name.trim().toLowerCase() === trimmedName.toLowerCase());
        if (existingByName) {
            new Notice(`已存在相同名称的提供商：${existingByName.name}`);
            return null;
        }

        const existingIds = s.customProviders.map(c => c.id);
        let idx = 1;
        while (existingIds.includes(`custom-${idx}`)) idx++;
        const id = `custom-${idx}`;
        const validModels = (models || []).filter(m => m && m.trim()).map(m => m.trim());
        const safeMaxContext = Number.isFinite(maxContext) && maxContext > 0 ? maxContext : 128000;
        const safeMaxOutput = Number.isFinite(maxOutput) && maxOutput > 0 ? Math.min(maxOutput, safeMaxContext) : 4096;
        s.customProviders.push({
            id, name: trimmedName, endpoint: trimmedEndpoint,
            models: validModels.length > 0 ? validModels : ['gpt-4o-mini'],
            maxContext: safeMaxContext, maxOutput: safeMaxOutput,
            sourceType: resolveProviderSourceType({ id, endpoint: trimmedEndpoint }),
            isDefault: false, isHidden: false,
        });
        if (apiKey) s.providerKeys[id] = apiKey;
        this.switchByEndpoint(trimmedEndpoint);
        return id;
    }

    /** 删除自定义提供商 */
    deleteCustom(id: string): boolean {
        const s = this.cb.getSettings();
        const idx = (s.customProviders || []).findIndex(c => c.id === id);
        if (idx === -1) return false;
        if (this.getCurrentProviderId() === id) {
            const all = this.getAllProviders();
            if (all.length > 0) this.switchByEndpoint(all[0].endpoint);
        }
        s.customProviders.splice(idx, 1);
        delete s.providerKeys[id];
        return true;
    }

    /** 获取所有可用提供商（过滤掉 isHidden 为 true 的） */
    getAllProviders(): Array<{ id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number; sourceType: ModelSourceType; isPreset: boolean; isDefault?: boolean; isHidden?: boolean }> {
        const s = this.cb.getSettings();
        const customProviders = s.customProviders || [];
        return customProviders
            .filter(c => !c.isHidden)
            .map(c => ({
                id: c.id,
                name: c.name,
                endpoint: c.endpoint,
                models: [...c.models],
                maxContext: c.maxContext,
                maxOutput: c.maxOutput,
                sourceType: resolveProviderSourceType(c),
                isPreset: !!c.isDefault,
                isDefault: c.isDefault,
                isHidden: c.isHidden,
            }));
    }

    /** 获取指定源类型（cloud/local）的提供商 */
    getProvidersBySourceType(type: ModelSourceType): Array<{ id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number; sourceType: ModelSourceType; isPreset: boolean; isDefault?: boolean; isHidden?: boolean }> {
        return this.getAllProviders().filter(p => p.sourceType === type);
    }

    /** 判断 provider 是否为本地源 */
    isLocalProvider(provider: Pick<CustomProvider, 'id' | 'endpoint' | 'sourceType'>): boolean {
        return resolveProviderSourceType(provider) === 'local';
    }

    /** 获取当前 provider 的源类型 */
    getCurrentSourceType(): ModelSourceType {
        const s = this.cb.getSettings();
        const provider = (s.customProviders || []).find(c => c.endpoint === s.apiEndpoint);
        return provider ? resolveProviderSourceType(provider) : 'cloud';
    }

    /** 设置供应商的隐藏状态 */
    setHidden(id: string, hidden: boolean): boolean {
        const s = this.cb.getSettings();
        const provider = (s.customProviders || []).find(c => c.id === id);
        if (!provider) return false;
        provider.isHidden = hidden;
        if (hidden && this.getCurrentProviderId() === id) {
            const all = this.getAllProviders();
            if (all.length > 0) this.switchByEndpoint(all[0].endpoint);
        }
        return true;
    }

    /** @deprecated 请使用 setHidden(id, true) */
    hidePreset(presetId: string): boolean {
        log.warn('[ProviderManager] 警告: hidePreset() 已废弃，请使用 setHidden(id, true)');
        return this.setHidden(presetId, true);
    }

    /** @deprecated 请使用 setHidden(id, false) */
    restorePreset(presetId: string): boolean {
        log.warn('[ProviderManager] 警告: restorePreset() 已废弃，请使用 setHidden(id, false)');
        return this.setHidden(presetId, false);
    }

    /** 恢复所有默认供应商（缺失的添加回来，已存在的不覆盖） */
    restoreDefaultProviders(): void {
        const s = this.cb.getSettings();
        s.customProviders = s.customProviders || [];
        const existingIds = new Set(s.customProviders.map(c => c.id));
        for (const [id, defaultProvider] of Object.entries(DEFAULT_PROVIDERS)) {
            if (!existingIds.has(id)) {
                s.customProviders.push({
                    ...defaultProvider,
                    isDefault: true,
                    isHidden: false,
                });
            } else {
                const existing = s.customProviders.find(c => c.id === id);
                if (existing) {
                    existing.isDefault = true;
                    existing.isHidden = false;
                }
            }
        }
    }

    /** @deprecated 请使用 restoreDefaultProviders() */
    restoreAllPresets(): void {
        log.warn('[ProviderManager] 警告: restoreAllPresets() 已废弃，请使用 restoreDefaultProviders()');
        this.restoreDefaultProviders();
    }

    /** 更新供应商信息 */
    updateProvider(id: string, updates: Partial<CustomProvider>): boolean {
        const s = this.cb.getSettings();
        const idx = (s.customProviders || []).findIndex(c => c.id === id);
        if (idx === -1) return false;
        s.customProviders[idx] = { ...s.customProviders[idx], ...updates };
        if (this.getCurrentProviderId() === id) {
            if (updates.endpoint !== undefined) s.apiEndpoint = updates.endpoint;
            if (updates.models !== undefined) s.availableModels = [...updates.models];
            if (updates.maxContext !== undefined) s.maxContext = updates.maxContext;
            if (updates.maxOutput !== undefined) s.maxOutput = updates.maxOutput;
            if (updates.name !== undefined) s.customProviderName = updates.name;
        }
        this.cb.saveSettings().catch(e => log.warn('[小说工坊] 供应商更新保存失败:', e));
        return true;
    }

    /** @deprecated 请使用 updateProvider() */
    savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean {
        log.warn('[ProviderManager] 警告: savePresetOverride() 已废弃，请使用 updateProvider()');
        return this.updateProvider(presetId, { name, endpoint, models: [...models], maxContext, maxOutput });
    }

    /** 重启后同步当前提供商的模型列表到 availableModels */
    syncCustomModelsOnRestart(): void {
        const s = this.cb.getSettings();
        const endpoint = s.apiEndpoint;
        if (!endpoint) return;
        const custom = (s.customProviders || []).find(c => c.endpoint === endpoint);
        if (custom && custom.models?.length > 0) {
            s.availableModels = [...custom.models];
            if (!s.availableModels.includes(s.defaultModel)) s.defaultModel = custom.models[0];
            if (!s.availableModels.includes(s.flashModel)) s.flashModel = custom.models[0];
            if (!s.availableModels.includes(s.proModel)) s.proModel = custom.models[1] || custom.models[0];
        }
    }

    private _saveTimer: ReturnType<typeof setTimeout> | null = null;
    private scheduleSave(): void {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.cb.saveSettings().catch(e => log.warn('[小说工坊] 模型覆盖保存失败:', e));
        }, 500);
    }
}
