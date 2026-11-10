import { describe, expect, it } from 'vitest';
import {
    buildCoWriteOptions,
    resolveCoWriteModel,
    resolveEffectiveCoWriteMode,
} from '../../../engine/co-writer/co-write-options';

/**
 * M-2（2026-11-10 用户拍板）：本地模式未选择本地模型时**自动切换到云端**，
 * 不再把请求打到 localhost 后必然失败。显式选择本地模型/显式云端模式保持原行为。
 */
const OLLAMA = {
    id: 'ollama',
    name: '本地 Ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: ['qwen2.5:7b', 'deepseek-r1:7b'],
    maxContext: 32768,
    maxOutput: 8192,
    sourceType: 'local',
};

const CLOUD = {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat'],
    maxContext: 128000,
    maxOutput: 8192,
    sourceType: 'cloud',
};

function settings(overrides: Record<string, unknown> = {}) {
    return {
        coWriteModelMode: 'local',
        coWriteModel: '',
        defaultModel: 'deepseek-chat',
        customProviders: [OLLAMA, CLOUD],
        providerKeys: { deepseek: 'sk-demo' },
        ...overrides,
    } as never;
}

describe('协同写作模式 — 本地未选模型自动切云端（M-2）', () => {
    it('本地模式无本地模型：生效模式为 cloud，模型回落到默认云端模型', () => {
        const s = settings();
        expect(resolveEffectiveCoWriteMode(s)).toBe('cloud');
        expect(resolveCoWriteModel(s)).toBe('deepseek-chat');

        const opts = buildCoWriteOptions({ settings: s });
        expect(opts.autoSwitchedToCloud).toBe(true);
        expect(opts.localRouteError).toBeUndefined();
        expect(opts.disableFallback).toBe(false);
        expect(opts.endpoint ?? '').not.toContain('localhost:11434');
    });

    it('显式选择本地模型：仍走本地 provider，不自动切换', () => {
        const s = settings({ coWriteModel: 'qwen2.5:7b' });
        expect(resolveEffectiveCoWriteMode(s)).toBe('local');
        expect(resolveCoWriteModel(s)).toBe('qwen2.5:7b');

        const opts = buildCoWriteOptions({ settings: s });
        expect(opts.autoSwitchedToCloud).toBeUndefined();
        expect(opts.disableFallback).toBe(true);
        expect(opts.endpoint).toBe(OLLAMA.endpoint);
    });

    it('显式云端模式：行为不变，不标记自动切换', () => {
        const s = settings({ coWriteModelMode: 'cloud', coWriteCloudProvider: 'deepseek' });
        expect(resolveEffectiveCoWriteMode(s)).toBe('cloud');
        const opts = buildCoWriteOptions({ settings: s });
        expect(opts.autoSwitchedToCloud).toBeUndefined();
        expect(opts.endpoint).toBe(CLOUD.endpoint);
        expect(opts.apiKey).toBe('sk-demo');
    });
});
