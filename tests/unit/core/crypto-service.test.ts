/**
 * crypto-service.test.ts — F4（技术审计）：v2 口令派生加密
 *
 * 验证：
 * - v2 加解密往返（PBKDF2-SHA256 + AES-GCM）
 * - 明文 / 空串直通
 * - 口令取消时加密降级为明文（向下兼容）
 * - 会话口令复用（不重复弹窗）
 * - 错误口令重试一次后原样返回
 * - v1 旧 seed 密文兼容读取
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoService, CryptoServiceDeps } from '../../../core/crypto-service';
import { Notice } from 'obsidian';


const deps: CryptoServiceDeps = {
    vault: {
        adapter: { basePath: '/test/vault' },
        getName: () => 'test-vault',
    },
};

/** 在测试内重现 v1 旧 seed 加密，用于构造存量密文 */
async function legacyEncrypt(plaintext: string): Promise<string> {
    const seed = 'novel-writer-ai:/test/vault:v3.5.0-salt';
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    const key = await crypto.subtle.importKey(
        'raw', hashBuffer, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...Array.from(bytes)));
    return `aes256:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

describe('CryptoService v2（F4 口令派生）', () => {
    it('v2 加密输出新格式前缀，解密往返还原明文', async () => {
        const svc = new CryptoService(deps, {
            requestNewPassword: async () => 'correct-horse',
            requestPassword: async () => 'correct-horse',
        });
        const stored = await svc.encrypt('sk-test-12345');
        expect(stored.startsWith('aes256v2:')).toBe(true);
        // 四段：iterations:salt:iv:ct
        expect(stored.slice('aes256v2:'.length).split(':')).toHaveLength(4);

        // 模拟重启：清除会话口令后解密（走 requestPassword 路径）
        svc.clearSessionPassword();
        const decrypted = await svc.decrypt(stored);
        expect(decrypted).toBe('sk-test-12345');
    });

    it('同口令重复加密产生不同 salt（彩虹表/重放防御）', async () => {
        const svc = new CryptoService(deps, { requestNewPassword: async () => 'pw-123456' });
        const a = await svc.encrypt('same-secret');
        const b = await svc.encrypt('same-secret');
        const saltOf = (s: string) => s.split(':')[2];
        expect(saltOf(a)).not.toBe(saltOf(b));
    });

    it('明文与空串直通（无前缀不视为密文）', async () => {
        const svc = new CryptoService(deps);
        expect(await svc.decrypt('plain-api-key')).toBe('plain-api-key');
        expect(await svc.encrypt('')).toBe('');
        expect(await svc.decrypt('')).toBe('');
    });

    it('首次加密取消口令 → 明文保存（向下兼容）', async () => {
        const svc = new CryptoService(deps, { requestNewPassword: async () => null });
        expect(await svc.encrypt('sk-plain')).toBe('sk-plain');
        expect(svc.hasSessionPassword()).toBe(false);
    });

    it('会话口令设定后 encrypt 不再触发询问回调', async () => {
        const ask = vi.fn(async () => 'pw-123456');
        const svc = new CryptoService(deps, { requestNewPassword: ask, requestPassword: ask });
        await svc.encrypt('secret-1');
        expect(ask).toHaveBeenCalledTimes(1);
        await svc.encrypt('secret-2');
        expect(ask).toHaveBeenCalledTimes(1); // 复用会话口令
        expect(svc.hasSessionPassword()).toBe(true);
    });

    it('错误口令：重问一次仍错 → 原样返回不抛异常', async () => {
        const svc = new CryptoService(deps, { requestNewPassword: async () => 'right-pw' });
        const stored = await svc.encrypt('sk-confidential');
        expect(stored.startsWith('aes256v2:')).toBe(true);

        svc.clearSessionPassword();
        const wrongSvc = new CryptoService(deps, { requestPassword: async () => 'wrong-pw' });
        const result = await wrongSvc.decrypt(stored);
        expect(result).toBe(stored); // 解不开原样返回
    });

    it('v1 旧 seed 密文兼容读取（存量数据不破坏）', async () => {
        const legacyStored = await legacyEncrypt('legacy-key-999');
        expect(legacyStored.startsWith('aes256:')).toBe(true);
        const svc = new CryptoService(deps);
        expect(await svc.decrypt(legacyStored)).toBe('legacy-key-999');
    });

    it('畸形 v2 密文安全返回原文', async () => {
        const svc = new CryptoService(deps);
        expect(await svc.decrypt('aes256v2:bad')).toBe('aes256v2:bad');
    });
});

describe('CryptoService 口令一致性（2026-10-29 修复 API Key 失效）', () => {
    it('已有密文时，即使调用方请求「新口令」也必须问已有口令', async () => {
        // 种子密文必须用「原口令」加密，才能模拟「磁盘上已有旧密文」
        const seed = new CryptoService(deps, { requestNewPassword: async () => 'original-pw' });
        const stored = await seed.encrypt('sk-original');

        // 模拟重启：会话口令清空，但磁盘上仍有密文
        const askNew = vi.fn(async () => 'brand-new-pw');
        const askOld = vi.fn(async () => 'original-pw');
        const restarted = new CryptoService(deps, {
            requestNewPassword: askNew,
            requestPassword: askOld,
            findExistingCiphertext: () => stored,
        });

        // 重启后加密第二个密钥：不得走「设定新口令」
        const second = await restarted.encrypt('sk-second');
        expect(askNew).not.toHaveBeenCalled();
        expect(askOld).toHaveBeenCalled();
        expect(second.startsWith('aes256v2:')).toBe(true);

        // 关键：旧密文仍然可解（会话口令是原来那个）
        expect(await restarted.decrypt(stored)).toBe('sk-original');
    });

    it('候选口令解不开既有密文时重问，不会把错口令设为会话口令', async () => {
        const seed = new CryptoService(deps, { requestNewPassword: async () => 'real-pw' });
        const stored = await seed.encrypt('sk-real');

        let attempt = 0;
        const svc = new CryptoService(deps, {
            requestPassword: async () => (attempt++ === 0 ? 'wrong-pw' : 'real-pw'),
            findExistingCiphertext: () => stored,
        });
        const second = await svc.encrypt('sk-second');
        expect(second.startsWith('aes256v2:')).toBe(true);
        expect(await svc.decrypt(stored)).toBe('sk-real');
    });

    it('两次都解不开 → 返回 null（encryptStrict），不落明文', async () => {
        const seed = new CryptoService(deps, { requestNewPassword: async () => 'real-pw' });
        const stored = await seed.encrypt('sk-real');

        const svc = new CryptoService(deps, {
            requestPassword: async () => 'always-wrong',
            findExistingCiphertext: () => stored,
        });
        expect(await svc.encryptStrict('sk-new')).toBeNull();
        // 兼容入口 encrypt 退回明文，但调用方是 settings-service 的 strict 路径
        expect(await svc.encrypt('sk-new')).toBe('sk-new');
    });

    it('没有既有密文时仍可设定新口令', async () => {
        const askNew = vi.fn(async () => 'first-pw');
        const svc = new CryptoService(deps, {
            requestNewPassword: askNew,
            findExistingCiphertext: () => null,
        });
        const stored = await svc.encrypt('sk-first');
        expect(askNew).toHaveBeenCalledTimes(1);
        expect(stored.startsWith('aes256v2:')).toBe(true);
    });

    it('canDecryptWith 能区分正确与错误口令', async () => {
        const svc = new CryptoService(deps, { requestNewPassword: async () => 'pw-ok' });
        const stored = await svc.encrypt('sk-x');
        expect(await svc.canDecryptWith('pw-ok', stored)).toBe(true);
        expect(await svc.canDecryptWith('pw-no', stored)).toBe(false);
        // 明文不参与口令校验
        expect(await svc.canDecryptWith('anything', 'plaintext')).toBe(true);
    });
});
