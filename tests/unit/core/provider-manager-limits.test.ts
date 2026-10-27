import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {},
    resolveProviderSourceType: (provider: { sourceType?: string }) =>
        provider.sourceType === 'local' ? 'local' : 'cloud',
}));

import { ProviderManager, type ProviderSettings } from '../../../core/provider-manager';
import {
    clearDetectedModelCapabilities,
    registerDetectedModelCapability,
} from '../../../shared/model-capabilities';

function makeSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    return {
        apiEndpoint: 'http://localhost:11434/v1/chat/completions',
        availableModels: ['qwen2.5:7b'],
        defaultModel: 'qwen2.5:7b',
        flashModel: 'qwen2.5:7b',
        proModel: 'qwen2.5:7b',
        apiKey: '',
        maxContext: 32768,
        maxOutput: 8192,
        modelOverrides: {},
        modelOverrideHistory: [],
        providerKeys: {},
        customProviderName: '',
        customProviders: [{
            id: 'ollama',
            name: '本地 Ollama',
            endpoint: 'http://localhost:11434/v1/chat/completions',
            models: ['qwen2.5:7b'],
            maxContext: 32768,
            maxOutput: 8192,
            sourceType: 'local',
            isDefault: true,
        }],
        ...overrides,
    };
}

function makeManager(settings: ProviderSettings): ProviderManager {
    return new ProviderManager({
        getSettings: () => settings,
        saveSettings: async () => {},
        refreshContextPanel: () => {},
        updateStatusBar: () => {},
    });
}

describe('ProviderManager — 模型能力优先级', () => {
    afterEach(() => {
        clearDetectedModelCapabilities();
        vi.useRealTimers();
    });

    it('本地探测值优先于静态能力表', () => {
        registerDetectedModelCapability('qwen2.5:7b', { maxContext: 131072, maxOutput: 16384 });
        const manager = makeManager(makeSettings());

        expect(manager.resolveModelLimits('qwen2.5:7b')).toEqual({
            maxContext: 131072,
            maxOutput: 16384,
        });
    });

    it('自定义供应商的显式上限不被静态表吞掉', () => {
        const endpoint = 'https://proxy.example.com/v1/chat/completions';
        const settings = makeSettings({
            apiEndpoint: endpoint,
            customProviders: [{
                id: 'custom-1',
                name: '代理',
                endpoint,
                models: ['gpt-4o'],
                maxContext: 64000,
                maxOutput: 32000,
                sourceType: 'cloud',
                isDefault: false,
            }],
        });
        const manager = makeManager(settings);

        expect(manager.resolveModelLimits('gpt-4o')).toEqual({
            maxContext: 64000,
            maxOutput: 32000,
        });
    });

    it('模型覆盖值按模型所属 endpoint 写入，且不改写全局预算', () => {
        vi.useFakeTimers();
        const settings = makeSettings();
        const manager = makeManager(settings);

        manager.setModelOverride('ollama', 'qwen2.5:7b', 'maxOutput', 1234);

        expect(settings.modelOverrides['http://localhost:11434/v1/chat/completions']?.['qwen2.5:7b'])
            .toEqual({ maxOutput: 1234 });
        expect(settings.maxOutput).toBe(8192);
        expect(manager.resolveModelLimits('qwen2.5:7b').maxOutput).toBe(1234);
    });
});
