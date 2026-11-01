import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {},
    resolveProviderSourceType: (provider: { sourceType?: string }) => provider.sourceType === 'local' ? 'local' : 'cloud',
}));

import { ProviderManager, type ProviderSettings } from '../../../core/provider-manager';

function settings(): ProviderSettings {
    return {
        apiEndpoint: 'https://custom.example/v1',
        availableModels: ['m1'],
        defaultModel: 'm1',
        flashModel: 'm1',
        proModel: 'm1',
        apiKey: 'sk-x',
        maxContext: 32768,
        maxOutput: 8192,
        modelOverrides: {},
        modelOverrideHistory: [],
        providerKeys: { custom: 'sk-x' },
        customProviderName: '自定义',
        customProviders: [
            { id: 'preset', name: '预设', endpoint: 'https://preset.example/v1', models: ['p1'], maxContext: 1, maxOutput: 1, sourceType: 'cloud', isDefault: true },
            { id: 'custom', name: '自定义', endpoint: 'https://custom.example/v1', models: ['m1'], maxContext: 1, maxOutput: 1, sourceType: 'cloud', isDefault: false },
        ],
    };
}

function manager(s: ProviderSettings): ProviderManager {
    return new ProviderManager({
        getSettings: () => s,
        saveSettings: async () => {},
        refreshContextPanel: () => {},
        updateStatusBar: () => {},
    });
}

describe('removeCustomProvider', () => {
    it('自定义供应商真删（含密钥与当前选择），预设不可删', () => {
        const s = settings();
        const pm = manager(s);
        expect(pm.removeCustomProvider('preset')).toBe(false);
        expect(pm.removeCustomProvider('custom')).toBe(true);
        expect(s.customProviders.map(p => p.id)).toEqual(['preset']);
        expect(s.providerKeys.custom).toBeUndefined();
        // 删的是当前供应商 → 回退到剩余可用项
        expect(s.apiEndpoint).toBe('https://preset.example/v1');
    });

    it('未知 id 返回 false', () => {
        const s = settings();
        expect(manager(s).removeCustomProvider('nope')).toBe(false);
        expect(s.customProviders).toHaveLength(2);
    });
});
