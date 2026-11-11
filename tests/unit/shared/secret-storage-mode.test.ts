import { describe, expect, it } from 'vitest';
import {
    detectSecretStorageMode,
    detectSecretStorageModeFromJson,
} from '../../../shared/secret-redaction';

/**
 * SEC-11（2026-11-10 安全审计）：data.json.bak 是逐字节副本，
 * 未启用会话口令时它就是一份明文 API Key 副本。备份中心不能再固定写「含密文」，
 * 判定函数必须把明文/密文/空/损坏分清楚（混合状态按明文报告）。
 */
describe('detectSecretStorageMode', () => {
    it('空密钥 → empty', () => {
        expect(detectSecretStorageMode({})).toBe('empty');
        expect(detectSecretStorageMode({ apiKey: '', providerKeys: {} })).toBe('empty');
    });

    it('aes256v2 → encrypted；仅有 aes256 旧格式 → obfuscated（S3-10）', () => {
        expect(detectSecretStorageMode({ apiKey: 'aes256v2:abc:def' })).toBe('encrypted');
        expect(detectSecretStorageMode({ canonResearch: { apiKey: 'aes256v2:x' } })).toBe('encrypted');
        // v1 seed 是公开常量，不能与口令派生密文同样称「已加密」
        expect(detectSecretStorageMode({ providerKeys: { openai: 'aes256:legacy' } })).toBe('obfuscated');
        expect(detectSecretStorageMode({
            apiKey: 'aes256v2:a:b',
            providerKeys: { openai: 'aes256:legacy' },
        })).toBe('obfuscated');
    });

    it('明文/混合状态 → plaintext（不能把混合说成密文）', () => {
        expect(detectSecretStorageMode({ apiKey: 'sk-live-123' })).toBe('plaintext');
        expect(detectSecretStorageMode({
            apiKey: 'aes256v2:encrypted',
            vectorQwenApiKey: 'sk-plain',
        })).toBe('plaintext');
        expect(detectSecretStorageMode({ providerKeys: { deepseek: 'sk-plain' } })).toBe('plaintext');
        expect(detectSecretStorageMode({ canonResearch: { apiKey: 'sk-plain' } })).toBe('plaintext');
    });

    it('非对象输入 → unknown', () => {
        expect(detectSecretStorageMode(null)).toBe('unknown');
        expect(detectSecretStorageMode('aes256v2:x')).toBe('unknown');
    });
});

describe('detectSecretStorageModeFromJson', () => {
    it('解析失败 → unknown（损坏的 .bak 不冒充密文）', () => {
        expect(detectSecretStorageModeFromJson('{')).toBe('unknown');
        expect(detectSecretStorageModeFromJson('')).toBe('unknown');
    });

    it('真实文本 → 对应模式', () => {
        expect(detectSecretStorageModeFromJson(JSON.stringify({ apiKey: 'sk-plain' }))).toBe('plaintext');
        expect(detectSecretStorageModeFromJson(JSON.stringify({ apiKey: 'aes256v2:x' }))).toBe('encrypted');
    });
});
