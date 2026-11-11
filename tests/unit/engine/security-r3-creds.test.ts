/**
 * S3-11 / S3-12（安全 r3）回归：
 * 1. 来源 URL 内嵌凭据/signature 参数不得进入 prompt、缓存与审核记录；
 * 2. v2 密文的 PBKDF2 迭代数必须夹在允许范围，越界视为损坏/恶意，不进入解锁流程。
 */

import { describe, expect, it } from 'vitest';
import { createCanonSource, normalizeSourceUrl } from '../../../shared/canon-source';
import { CryptoService, PBKDF2_MAX_ITERATIONS, PBKDF2_MIN_ITERATIONS } from '../../../core/crypto-service';

const deps = { vault: { adapter: { basePath: '/test/vault' }, getName: () => 'test-vault' } };

describe('S3-11 来源 URL 凭据剥离', () => {
    it('剥离 userinfo', () => {
        const url = normalizeSourceUrl('https://user:pass@example.com/page');
        expect(url).not.toBeNull();
        expect(url).not.toContain('user');
        expect(url).not.toContain('pass');
        expect(url).toContain('example.com/page');
    });

    it('敏感 query 值脱敏，普通参数保留', () => {
        const url = normalizeSourceUrl('https://example.com/x?token=abc123&chapter=3&signature=zzz');
        expect(url).toContain('token=REDACTED');
        expect(url).toContain('signature=REDACTED');
        expect(url).toContain('chapter=3');
        expect(url).not.toContain('abc123');
    });

    it('createCanonSource 落库的就是脱敏后的 URL', () => {
        const source = createCanonSource({ url: 'https://u:p@example.com/a?access_token=secret', title: 'x' }, 0);
        expect(source.url).not.toContain('u:p@');
        expect(source.url).toContain('access_token=REDACTED');
        expect(source.url).not.toContain('secret');
    });
});

describe('S3-12 PBKDF2 迭代数夹取', () => {
    it('常量范围覆盖本插件历史参数', () => {
        expect(PBKDF2_MIN_ITERATIONS).toBe(100_000);
        expect(PBKDF2_MAX_ITERATIONS).toBe(1_000_000);
    });

    it('超大迭代数：不弹口令、直接原样返回（不进入 PBKDF2）', async () => {
        let asked = 0;
        const svc = new CryptoService(deps as never, {
            requestPassword: async () => { asked++; return 'pw'; },
        });
        const hostile = `aes256v2:2000000000:c2FsdA==:aXY=:Y3Q=`;

        const result = await svc.decrypt(hostile);
        expect(result).toBe(hostile);
        expect(asked).toBe(0);
    });

    it('过小迭代数同样拒绝进入解锁流程', async () => {
        let asked = 0;
        const svc = new CryptoService(deps as never, {
            requestPassword: async () => { asked++; return 'pw'; },
        });
        const weak = `aes256v2:1:c2FsdA==:aXY=:Y3Q=`;
        expect(await svc.decrypt(weak)).toBe(weak);
        expect(asked).toBe(0);
    });

    it('v2 前缀但参数非法 → 口令校验判失败（不误报正确）', async () => {
        const svc = new CryptoService(deps as never, {
            requestPassword: async () => 'pw',
        });
        await expect(svc.canDecryptWith('pw', 'aes256v2:9:s:i:c')).resolves.toBe(false);
    });
});
