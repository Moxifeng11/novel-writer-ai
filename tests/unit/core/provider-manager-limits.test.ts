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

    // 2026-11-16（M-16）：用户在「编辑模型」或「从 URL 获取」时写入的 modelMeta
    // 之前只做列表徽章，预算解析完全无视它（填 393216 仍按 32768 算）。
    it('modelMeta 的上下文/输出进入预算解析', () => {
        const endpoint = 'https://opencode.ai/zen/v1/chat/completions';
        const settings = makeSettings({
            apiEndpoint: endpoint,
            availableModels: ['deepseek-v4.1-flash'],
            defaultModel: 'deepseek-v4.1-flash',
            flashModel: 'deepseek-v4.1-flash',
            proModel: 'deepseek-v4.1-flash',
            customProviders: [{
                id: 'opencode',
                name: 'OpenCode Zen',
                endpoint,
                models: ['deepseek-v4.1-flash'],
                maxContext: 1048576,
                maxOutput: 65536,
                sourceType: 'cloud',
                isDefault: true,
                modelMeta: {
                    'deepseek-v4.1-flash': { contextWindow: 1000000, maxTokens: 384000 },
                },
            }],
        });
        const manager = makeManager(settings);

        expect(manager.resolveModelLimits('deepseek-v4.1-flash')).toEqual({
            maxContext: 1000000,
            maxOutput: 384000,
        });
    });

    it('模型覆盖值仍然优先于 modelMeta', () => {
        vi.useFakeTimers();
        const endpoint = 'https://opencode.ai/zen/v1/chat/completions';
        const settings = makeSettings({
            apiEndpoint: endpoint,
            availableModels: ['deepseek-v4.1-flash'],
            defaultModel: 'deepseek-v4.1-flash',
            customProviders: [{
                id: 'opencode',
                name: 'OpenCode Zen',
                endpoint,
                models: ['deepseek-v4.1-flash'],
                maxContext: 1048576,
                maxOutput: 65536,
                sourceType: 'cloud',
                isDefault: true,
                modelMeta: { 'deepseek-v4.1-flash': { contextWindow: 1000000, maxTokens: 384000 } },
            }],
            modelOverrides: { [endpoint]: { 'deepseek-v4.1-flash': { maxOutput: 8192 } } },
        });
        const manager = makeManager(settings);

        expect(manager.resolveModelLimits('deepseek-v4.1-flash')).toEqual({
            maxContext: 1000000,
            maxOutput: 8192,
        });
    });

    // 2026-11-16（M-35 方案 C）：改 Base URL 必须清掉旧的「实际请求 URL」覆盖，
    // 否则用户改完地址仍打旧地址。
    it('改 Base URL 清空 requestUrlOverride', () => {
        const endpoint = 'https://a.example.com/v1/chat/completions';
        const settings = makeSettings({
            apiEndpoint: endpoint,
            customProviders: [{
                id: 'custom-1',
                name: '自建',
                endpoint,
                models: ['m'],
                maxContext: 128000,
                maxOutput: 8192,
                sourceType: 'cloud',
                isDefault: false,
                requestUrlOverride: 'https://a.example.com/custom/chat',
            }],
        });
        const manager = makeManager(settings);
        manager.updateProvider('custom-1', { endpoint: 'https://b.example.com/v1/chat/completions' });
        const provider = settings.customProviders[0] as { requestUrlOverride?: string };
        expect(provider.requestUrlOverride).toBeUndefined();
    });
});
