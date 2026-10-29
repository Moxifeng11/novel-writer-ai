import { describe, expect, it } from 'vitest';
import { hasUsableAiCredentials } from '../../../shared/ai-credentials';

describe('ai-credentials — 生成前守卫（云端密钥或本地免密钥端点）', () => {
    it('配置了密钥即可用，与端点无关', () => {
        expect(hasUsableAiCredentials({ apiKey: 'sk-xxx', apiEndpoint: 'https://api.example.com/v1' })).toBe(true);
    });

    it('空密钥 + 空端点不可用', () => {
        expect(hasUsableAiCredentials({ apiKey: '', apiEndpoint: '' })).toBe(false);
        expect(hasUsableAiCredentials({ apiKey: '   ', apiEndpoint: '  ' })).toBe(false);
        expect(hasUsableAiCredentials(undefined)).toBe(false);
    });

    it('空密钥 + 本地端点可用（Ollama 无需密钥）', () => {
        expect(hasUsableAiCredentials({ apiKey: '', apiEndpoint: 'http://localhost:11434/v1/chat/completions' })).toBe(true);
        expect(hasUsableAiCredentials({ apiKey: '', apiEndpoint: 'http://127.0.0.1:1234/v1' })).toBe(true);
    });

    it('空密钥 + 云端端点不可用', () => {
        expect(hasUsableAiCredentials({ apiKey: '', apiEndpoint: 'https://api.openai.com/v1' })).toBe(false);
    });

    it('自定义 provider 显式标记 local 时，非 localhost 端点也可用', () => {
        const settings = {
            apiKey: '',
            apiEndpoint: 'http://192.168.1.20:8000/v1',
            customProviders: [{ id: 'lan-ollama', endpoint: 'http://192.168.1.20:8000/v1', sourceType: 'local' as const }],
        };
        expect(hasUsableAiCredentials(settings)).toBe(true);
    });

    it('provider 标记 cloud 时不因 localhost 字样误判', () => {
        const settings = {
            apiKey: '',
            apiEndpoint: 'https://localhost.example.com/v1',
            customProviders: [{ id: 'proxy', endpoint: 'https://localhost.example.com/v1', sourceType: 'cloud' as const }],
        };
        expect(hasUsableAiCredentials(settings)).toBe(false);
    });
});

describe('hasUsableAiCredentials — 供应商级密钥（2026-10-29）', () => {
    const provider = { id: 'deepseek', endpoint: 'https://api.deepseek.com/v1', sourceType: 'cloud' as const };

    it('apiKey 为空但 providerKeys 有该供应商密钥 → 视为已配置', () => {
        expect(hasUsableAiCredentials({
            apiKey: '',
            apiEndpoint: provider.endpoint,
            providerKeys: { deepseek: 'sk-per-provider' },
            customProviders: [provider],
        })).toBe(true);
    });

    it('两者都为空且非本地端点 → 未配置', () => {
        expect(hasUsableAiCredentials({
            apiKey: '',
            apiEndpoint: provider.endpoint,
            providerKeys: {},
            customProviders: [provider],
        })).toBe(false);
    });

    it('本地端点无需密钥', () => {
        expect(hasUsableAiCredentials({
            apiKey: '',
            apiEndpoint: 'http://localhost:11434/v1',
            customProviders: [{ id: 'ollama', endpoint: 'http://localhost:11434/v1', sourceType: 'local' }],
        })).toBe(true);
    });
});
