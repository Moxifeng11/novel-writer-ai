/**
 * P0 回归：API 配置模块重构后的渠道状态——每渠道模型分配 / 任务级参数 / 启用列表 / 思考能力
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {},
    resolveProviderSourceType: (provider: { sourceType?: string }) =>
        provider.sourceType === 'local' ? 'local' : 'cloud',
}));

import { ProviderManager, type ProviderSettings } from '../../../core/provider-manager';

const DEEPSEEK = 'https://api.deepseek.com/v1/chat/completions';
const OLLAMA = 'http://localhost:11434/v1/chat/completions';

function makeSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    return {
        apiEndpoint: DEEPSEEK,
        availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        defaultModel: 'deepseek-v4-flash',
        flashModel: 'deepseek-v4-flash',
        proModel: 'deepseek-v4-pro',
        apiKey: 'sk-deepseek',
        maxContext: 1048576,
        maxOutput: 65536,
        modelOverrides: {},
        modelOverrideHistory: [],
        providerKeys: { deepseek: 'sk-deepseek' },
        customProviderName: '',
        customProviders: [
            {
                id: 'deepseek', name: 'DeepSeek', endpoint: DEEPSEEK,
                models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
                maxContext: 1048576, maxOutput: 65536, sourceType: 'cloud', isDefault: true,
            },
            {
                id: 'ollama', name: 'Ollama', endpoint: OLLAMA,
                models: ['qwen2.5:7b', 'deepseek-r1:7b'],
                maxContext: 32768, maxOutput: 8192, sourceType: 'local', isDefault: true,
            },
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

describe('ProviderManager — 每渠道模型分配', () => {
    it('切换时保存旧渠道分配、恢复目标渠道分配', () => {
        const settings = makeSettings();
        const manager = makeManager(settings);
        // Ollama 存一套自己的分配
        manager.setProviderAssignment('ollama', {
            defaultModel: 'deepseek-r1:7b',
            flashModel: 'qwen2.5:7b',
            proModel: 'deepseek-r1:7b',
        });
        // 切到 Ollama：应用它自己的分配
        expect(manager.switchByEndpoint(OLLAMA)).toBe(true);
        expect(settings.defaultModel).toBe('deepseek-r1:7b');
        expect(settings.flashModel).toBe('qwen2.5:7b');
        // 切回 DeepSeek：恢复原分配，而不是重置成 models[0..1]
        expect(manager.switchByEndpoint(DEEPSEEK)).toBe(true);
        expect(settings.defaultModel).toBe('deepseek-v4-flash');
        expect(settings.proModel).toBe('deepseek-v4-pro');
        // 旧渠道分配已记忆
        expect(settings.providerAssignments?.ollama?.defaultModel).toBe('deepseek-r1:7b');
    });

    it('分配值失效时收敛到该渠道真实模型', () => {
        const settings = makeSettings();
        const manager = makeManager(settings);
        manager.setProviderAssignment('ollama', {
            defaultModel: '不存在的模型',
            flashModel: 'qwen2.5:7b',
            proModel: '也不存在',
        });
        expect(manager.getProviderAssignment('ollama')).toEqual({
            defaultModel: 'qwen2.5:7b',
            flashModel: 'qwen2.5:7b',
            proModel: 'deepseek-r1:7b',
        });
    });
});

describe('ProviderManager — 任务级参数按渠道记忆', () => {
    it('切走时保存、切回时恢复', () => {
        const settings = makeSettings();
        const manager = makeManager(settings);
        settings.taskBudgets = { body: { model: 'deepseek-v4-pro' } };
        expect(manager.switchByEndpoint(OLLAMA)).toBe(true);
        // Ollama 没有自己的任务级参数 → 空
        expect(settings.taskBudgets).toEqual({});
        settings.taskBudgets = { analysis: { maxOutputTokens: 4096 } };
        expect(manager.switchByEndpoint(DEEPSEEK)).toBe(true);
        // DeepSeek 的原参数恢复
        expect(settings.taskBudgets).toEqual({ body: { model: 'deepseek-v4-pro' } });
        expect(settings.providerTaskBudgets?.ollama).toEqual({ analysis: { maxOutputTokens: 4096 } });
    });
});

describe('ProviderManager — 启用语义 / 思考能力', () => {
    it('关闭显示只影响启用列表，不同步切换当前渠道', () => {
        const settings = makeSettings();
        const manager = makeManager(settings);
        expect(manager.getEnabledProviders().length).toBe(2);
        expect(manager.setProviderEnabled('ollama', false)).toBe(true);
        expect(manager.getEnabledProviders().map(p => p.id)).toEqual(['deepseek']);
        expect(settings.apiEndpoint).toBe(DEEPSEEK);
        expect(manager.getCurrentProviderId()).toBe('deepseek');
    });

    it('思考能力按渠道识别：DeepSeek 支持、本地 Ollama 不支持', () => {
        const manager = makeManager(makeSettings());
        expect(manager.getThinkingCapability('deepseek', 'deepseek-v4-pro').kind).toBe('thinking');
        expect(manager.getThinkingCapability('ollama', 'qwen2.5:7b').supported).toBe(false);
    });

    it('渠道思考强度可单独保存', () => {
        const settings = makeSettings();
        const manager = makeManager(settings);
        manager.setProviderThinking('deepseek', { mode: 'on', budget: 7680 });
        expect(manager.getProviderThinking('deepseek')).toEqual({ mode: 'on', budget: 7680 });
        expect(settings.providerThinking?.deepseek?.budget).toBe(7680);
    });
});
