import { describe, it, expect } from 'vitest';
import {
    describeSecretForInput,
    isStoredCiphertext,
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
