/**
 * P0 回归：切换供应商时不得把已保存的 API Key 抹成空串
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {},
    resolveProviderSourceType: (provider: { sourceType?: string }) =>
        provider.sourceType === 'local' ? 'local' : 'cloud',
}));

import { ProviderManager, type ProviderSettings } from '../../../core/provider-manager';

const ENDPOINT_A = 'https://api.deepseek.com/v1/chat/completions';
const ENDPOINT_B = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

function makeSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    return {
        apiEndpoint: ENDPOINT_A,
        availableModels: ['deepseek-chat'],
        defaultModel: 'deepseek-chat',
        flashModel: 'deepseek-chat',
        proModel: 'deepseek-chat',
        apiKey: '',
        maxContext: 128000,
        maxOutput: 8192,
        modelOverrides: {},
        modelOverrideHistory: [],
        providerKeys: {},
        customProviderName: '',
        customProviders: [
            { id: 'deepseek', name: 'DeepSeek', endpoint: ENDPOINT_A, models: ['deepseek-chat'], maxContext: 128000, maxOutput: 8192, sourceType: 'cloud', isDefault: true },
            { id: 'volc', name: '火山方舟', endpoint: ENDPOINT_B, models: ['doubao-pro'], maxContext: 128000, maxOutput: 8192, sourceType: 'cloud', isDefault: false },
        ],
        ...overrides,
    };
}

function makeManager(settings: ProviderSettings): ProviderManager {
    return new ProviderManager({
        getSettings: () => settings,
        saveSettings: async () => {},
        refreshContextPanel: () => {},
        updateStatusBar: () => {},
    } as never);
}

describe('ProviderManager — 切换不丢 Key（首启 P0）', () => {
    it('当前 apiKey 为空时切到自身，不能抹掉已保存的 Key', () => {
        const settings = makeSettings({ apiKey: '', providerKeys: { deepseek: 'SK-deepseek' } });
        const manager = makeManager(settings);
        expect(manager.switchByEndpoint(ENDPOINT_A)).toBe(true);
        expect(settings.providerKeys.deepseek).toBe('SK-deepseek');
        expect(settings.apiKey).toBe('SK-deepseek');
    });

    it('切到另一个供应商时，不覆盖当前供应商的空 Key', () => {
        const settings = makeSettings({ apiKey: '', providerKeys: { deepseek: 'SK-deepseek', volc: 'SK-volc' } });
        const manager = makeManager(settings);
        expect(manager.switchByEndpoint(ENDPOINT_B)).toBe(true);
        expect(settings.providerKeys.deepseek).toBe('SK-deepseek');
        expect(settings.apiKey).toBe('SK-volc');
    });

    it('当前有 Key 时切换会正确归档到原供应商', () => {
        const settings = makeSettings({ apiKey: 'SK-deepseek', providerKeys: { volc: 'SK-volc' } });
        const manager = makeManager(settings);
        expect(manager.switchByEndpoint(ENDPOINT_B)).toBe(true);
        expect(settings.providerKeys.deepseek).toBe('SK-deepseek');
        expect(settings.apiKey).toBe('SK-volc');
    });
});
