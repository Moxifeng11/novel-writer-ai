import { describe, it, expect } from 'vitest';
import {
    describeKeyEncryptionStatus,
    describeSecretForInput,
    isStoredCiphertext,
    resolveSecretInput,
    SECRET_LOCKED_PLACEHOLDER,
} from '../../../shared/secret-display';

describe('isStoredCiphertext', () => {
    it('识别 v1 / v2 密文', () => {
        expect(isStoredCiphertext('aes256v2:210000:s:i:c')).toBe(true);
        expect(isStoredCiphertext('aes256:iv:ct')).toBe(true);
    });

    it('明文与空值不算密文', () => {
        expect(isStoredCiphertext('sk-abc')).toBe(false);
        expect(isStoredCiphertext('')).toBe(false);
        expect(isStoredCiphertext(undefined)).toBe(false);
    });
});

describe('describeSecretForInput', () => {
    it('密文 → 输入框留空 + 解锁提示（不泄露密文）', () => {
        const d = describeSecretForInput('aes256v2:210000:s:i:c');
        expect(d.value).toBe('');
        expect(d.placeholder).toBe(SECRET_LOCKED_PLACEHOLDER);
        expect(d.title).toContain('加密');
    });

    it('明文 → 原样显示', () => {
        const d = describeSecretForInput('sk-abc');
        expect(d.value).toBe('sk-abc');
        expect(d.placeholder).toBe('sk-...');
    });

    it('空值 → 留空 + sk- 占位', () => {
        const d = describeSecretForInput('');
        expect(d.value).toBe('');
        expect(d.placeholder).toBe('sk-...');
    });
});

describe('resolveSecretInput', () => {
    it('空/未输入 = 未修改：保留原值（含密文）', () => {
        expect(resolveSecretInput('', 'aes256v2:210000:s:i:c')).toBe('aes256v2:210000:s:i:c');
        expect(resolveSecretInput(undefined, 'sk-old')).toBe('sk-old');
        expect(resolveSecretInput('   ', 'sk-old')).toBe('sk-old');
    });

    it('输入非空 = 修改：去掉首尾空白后写回', () => {
        expect(resolveSecretInput('  sk-new  ', 'sk-old')).toBe('sk-new');
        expect(resolveSecretInput('sk-new', 'aes256v2:210000:s:i:c')).toBe('sk-new');
    });

    it('原值为空且未输入时返回空字符串，而不是 undefined', () => {
        expect(resolveSecretInput('', undefined)).toBe('');
        expect(resolveSecretInput(null, null)).toBe('');
    });
});

describe('describeKeyEncryptionStatus — S-4 决策 B（明文但标注风险）', () => {
    it('未设口令且从未加密：标记明文并给出风险提示', () => {
        const status = describeKeyEncryptionStatus({ locked: 0, encrypted: false, legacy: 0 });
        expect(status.plaintext).toBe(true);
        expect(status.text).toContain('明文');
        expect(status.text).toContain('同步');
        expect(status.text).toContain('设定口令');
    });

    it('有加密条目且已解锁：不标记明文', () => {
        const status = describeKeyEncryptionStatus({ locked: 0, encrypted: true, legacy: 0 });
        expect(status.plaintext).toBe(false);
        expect(status.text).toContain('已加密');
        expect(status.text).not.toContain('明文');
    });

    it('只有 v1 旧密文：不称「已加密」，如实说明是混淆（S3-10）', () => {
        const status = describeKeyEncryptionStatus({ locked: 0, encrypted: true, legacy: 2 });
        expect(status.plaintext).toBe(false);
        expect(status.text).toContain('旧版混淆');
        expect(status.text).toContain('不等于真正加密');
        expect(status.text).not.toContain('密钥已加密');
    });

    it('有锁定条目：提示输入口令；legacy 追加升级说明', () => {
        const status = describeKeyEncryptionStatus({ locked: 3, encrypted: true, legacy: 2 });
        expect(status.plaintext).toBe(false);
        expect(status.text).toContain('3 项');
        expect(status.text).toContain('旧版加密条目');
    });
});
