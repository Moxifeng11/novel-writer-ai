/**
 * provider-manager.ts — AI 提供商管理服务
 *
 * 职责：提供商切换、自定义提供商增删、预设隐藏/恢复、模型覆盖值管理
 * 从 main.ts 拆分而来
 */

import { Notice } from 'obsidian';
import type { NovelWriterSettings, CustomProvider, ProviderPreset } from '../main';
import { PROVIDERS } from '../main';
import { findModelCapability } from '../shared/model-capabilities';

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
    hiddenPresets: string[];
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

    /** 获取当前提供商 ID（预设优先，再查自定义） */
    getCurrentProviderId(): string | null {
        const s = this.cb.getSettings();
        const presetId = Object.keys(PROVIDERS).find(k => PROVIDERS[k].endpoint === s.apiEndpoint);
        if (presetId) return presetId;
        const custom = s.customProviders?.find(c => c.endpoint === s.apiEndpoint);
        return custom ? custom.id : null;
    }

    /** 根据端点 URL 切换提供商 */
    switchByEndpoint(endpoint: string): boolean {
        const s = this.cb.getSettings();
        let providerId: string | null = null;
        let preset: ProviderPreset | null = null;

        const presetEntry = Object.entries(PROVIDERS).find(([_, p]) => p.endpoint === endpoint);
        if (presetEntry) {
            [providerId, preset] = presetEntry;
        } else {
            const custom = s.customProviders?.find(c => c.endpoint === endpoint);
            if (custom) {
                providerId = custom.id;
                preset = { name: custom.name, endpoint: custom.endpoint, models: custom.models, maxContext: custom.maxContext, maxOutput: custom.maxOutput };
            }
        }
        if (!providerId || !preset) return false;

        // 保存当前密钥
        s.providerKeys = s.providerKeys || {};
        const currentId = this.getCurrentProviderId();
        if (currentId) {
            s.providerKeys[currentId] = s.apiKey;
        }
        // 更新为新提供商配置
        s.apiEndpoint = preset.endpoint;
        s.availableModels = [...preset.models];
        s.defaultModel = preset.models[0];
        s.flashModel = preset.models[0];
        s.proModel = preset.models[1] || preset.models[0];
        s.apiKey = s.providerKeys[providerId] || '';
        this.updateModelLimits(s.flashModel);
        this.cb.refreshContextPanel();
        this.cb.saveSettings().catch(e => console.warn('[小说工坊] 提供商切换保存失败:', e));
        return true;
    }

    /** 根据模型名称更新 maxContext / maxOutput */
    updateModelLimits(modelName: string): void {
        const s = this.cb.getSettings();
        const resolved = this.resolveModelLimits(modelName);
        s.maxContext = resolved.maxContext;
        s.maxOutput = resolved.maxOutput;
        console.log(`[小说工坊] 模型 "${modelName}" → maxContext=${resolved.maxContext}, maxOutput=${resolved.maxOutput}`);
    }

    /** 根据 endpoint + 模型名确定 maxContext / maxOutput 生效值 */
    resolveModelLimits(modelName: string): { maxContext: number; maxOutput: number } {
        const s = this.cb.getSettings();
        const override = s.modelOverrides[s.apiEndpoint]?.[modelName];
        const caps = findModelCapability(modelName);
        return {
            maxContext: override?.maxContext ?? caps.maxContext,
            maxOutput: override?.maxOutput ?? caps.maxOutput,
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
        const existing = s.customProviders.find(c => c.endpoint.trim().toLowerCase() === trimmedEndpoint.toLowerCase());
        if (existing) {
            new Notice(`已存在相同端点的提供商：${existing.name}`);
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

    /** 获取所有可用提供商 */
    getAllProviders(): Array<{ id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number; isPreset: boolean; isHidden?: boolean }> {
        const s = this.cb.getSettings();
        const result: Array<{ id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number; isPreset: boolean; isHidden?: boolean }> = [];
        const hidden = s.hiddenPresets || [];
        const customProviders = s.customProviders || [];

        for (const [id, preset] of Object.entries(PROVIDERS)) {
            if (hidden.includes(id)) continue;
            const customOverride = customProviders.find(c => c.id === id);
            if (customOverride) {
                result.push({ ...customOverride, isPreset: false });
            } else {
                result.push({ id, ...preset, isPreset: true });
            }
        }
        for (const cp of customProviders) {
            if (PROVIDERS[cp.id]) continue;
            result.push({ ...cp, isPreset: false });
        }
        return result;
    }

    /** 隐藏预设提供商 */
    hidePreset(presetId: string): boolean {
        const s = this.cb.getSettings();
        if (!PROVIDERS[presetId]) return false;
        if (!s.hiddenPresets) s.hiddenPresets = [];
        if (!s.hiddenPresets.includes(presetId)) s.hiddenPresets.push(presetId);
        if (this.getCurrentProviderId() === presetId) {
            const all = this.getAllProviders();
            if (all.length > 0) this.switchByEndpoint(all[0].endpoint);
        }
        return true;
    }

    /** 恢复被隐藏的预设 */
    restorePreset(presetId: string): boolean {
        const s = this.cb.getSettings();
        if (!PROVIDERS[presetId]) return false;
        if (!s.hiddenPresets) return true;
        const idx = s.hiddenPresets.indexOf(presetId);
        if (idx >= 0) s.hiddenPresets.splice(idx, 1);
        return true;
    }

    /** 恢复所有预设 */
    restoreAllPresets(): void {
        this.cb.getSettings().hiddenPresets = [];
    }

    /** 保存预设的自定义覆盖 */
    savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean {
        if (!PROVIDERS[presetId]) return false;
        const s = this.cb.getSettings();
        s.customProviders = s.customProviders || [];
        const existingIdx = s.customProviders.findIndex(c => c.id === presetId);
        const override: CustomProvider = { id: presetId, name, endpoint, models: [...models], maxContext, maxOutput };
        if (existingIdx >= 0) {
            s.customProviders[existingIdx] = override;
        } else {
            s.customProviders.push(override);
        }
        if (this.getCurrentProviderId() === presetId) {
            s.apiEndpoint = endpoint;
            s.availableModels = [...models];
            s.maxContext = maxContext;
            s.maxOutput = maxOutput;
            s.customProviderName = name;
        }
        this.cb.saveSettings().catch(e => console.warn('[小说工坊] 预设覆盖保存失败:', e));
        return true;
    }

    /** 重启后同步自定义提供商的模型列表到 availableModels */
    syncCustomModelsOnRestart(): void {
        const s = this.cb.getSettings();
        const endpoint = s.apiEndpoint;
        const isPreset = Object.values(PROVIDERS).some(p => p.endpoint === endpoint);
        if (isPreset || !endpoint) return;
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
            this.cb.saveSettings().catch(e => console.warn('[小说工坊] 模型覆盖保存失败:', e));
        }, 500);
    }
}
