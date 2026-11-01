import { describe, expect, it } from 'vitest';
import {
    REDACTED_VALUE,
    containsPlaintextSecret,
    redactSecrets,
} from '../../../shared/secret-redaction';

const SAMPLE = {
    apiKey: 'sk-live-123',
    providerKeys: { volc: 'sk-volc', openai: 'sk-openai' },
    vectorOpenaiApiKey: 'sk-vec',
    vectorDoubaoApiKey: 'sk-doubao',
    vectorQwenApiKey: '',
    updateGithubToken: 'ghp-xxx',
    canonResearch: { provider: 'bing', apiKey: 'bing-key', maxSources: 6 },
    dailyWordTarget: 3000,
    themeColors: { appBg: '#F0EBE4', accent: '#C2410C' },
    list: [{ apiKey: 'nested-key' }, { plain: 1 }],
};

describe('redactSecrets', () => {
    it('把各类密钥字段替换为占位符，非密钥字段保持不变', () => {
        const out = redactSecrets(SAMPLE);
        expect(out.apiKey).toBe(REDACTED_VALUE);
        expect(out.providerKeys).toEqual({ volc: REDACTED_VALUE, openai: REDACTED_VALUE });
        expect(out.vectorOpenaiApiKey).toBe(REDACTED_VALUE);
        expect(out.vectorDoubaoApiKey).toBe(REDACTED_VALUE);
        expect(out.updateGithubToken).toBe(REDACTED_VALUE);
        expect(out.canonResearch.apiKey).toBe(REDACTED_VALUE);
        // 非密钥字段保持原样，备份仍可对比配置
        expect(out.dailyWordTarget).toBe(3000);
        expect(out.canonResearch.provider).toBe('bing');
        expect(out.themeColors).toEqual({ appBg: '#F0EBE4', accent: '#C2410C' });
    });

    it('空字符串保持空（不写成占位符，避免掩盖"本来就没配"）', () => {
        const out = redactSecrets(SAMPLE);
        expect(out.vectorQwenApiKey).toBe('');
    });

    it('数组内对象同样递归脱敏', () => {
        const out = redactSecrets(SAMPLE);
        expect(out.list[0].apiKey).toBe(REDACTED_VALUE);
        expect(out.list[1].plain).toBe(1);
    });

    it('不修改入参（深拷贝语义）', () => {
        const original = { apiKey: 'sk-x', nested: { token: 't' } };
        const out = redactSecrets(original);
        expect(original.apiKey).toBe('sk-x');
        expect(original.nested.token).toBe('t');
        expect(out.apiKey).toBe(REDACTED_VALUE);
    });

    it('containsPlaintextSecret 能检出残留密钥，脱敏后为 false', () => {
        expect(containsPlaintextSecret(SAMPLE)).toBe(true);
        expect(containsPlaintextSecret(redactSecrets(SAMPLE))).toBe(false);
        expect(containsPlaintextSecret({ apiKey: REDACTED_VALUE })).toBe(false);
        expect(containsPlaintextSecret({ apiKey: '' })).toBe(false);
        expect(containsPlaintextSecret({ model: 'gpt-4o' })).toBe(false);
    });
});
