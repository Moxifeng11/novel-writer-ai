/**
 * 密钥加密锁定态：守卫放行（便于触发口令解锁），但要能区分「未配置」与「已加密未解锁」
 */

import { describe, expect, it } from 'vitest';
import { aiCredentialsLocked, hasUsableAiCredentials } from '@/shared/ai-credentials';

describe('aiCredentialsLocked', () => {
    it('密文 Key 判定为锁定态', () => {
        expect(aiCredentialsLocked({ apiKey: 'aes256v2:1:s:i:ct' })).toBe(true);
        expect(aiCredentialsLocked({ apiKey: '', providerKeys: { deepseek: 'aes256:1:2:3' } })).toBe(true);
    });

    it('明文/空值不算锁定', () => {
        expect(aiCredentialsLocked({ apiKey: 'sk-live' })).toBe(false);
        expect(aiCredentialsLocked({ apiKey: '' })).toBe(false);
        expect(aiCredentialsLocked(null)).toBe(false);
    });

    it('锁定态仍视为「有凭据」：放行后由 AI 客户端弹口令解锁', () => {
        expect(hasUsableAiCredentials({ apiKey: 'aes256v2:1:s:i:ct' })).toBe(true);
    });

    it('本地端点无需密钥', () => {
        expect(hasUsableAiCredentials({
            apiKey: '',
            apiEndpoint: 'http://localhost:11434/v1/chat/completions',
            customProviders: [{ id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions', sourceType: 'local' }],
        })).toBe(true);
    });
});
