/**
 * 首启自检：加密锁定态不能被误判为「已配置」
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SetupReadinessService } from '@/services/setup-readiness-service';
import { isStoredCiphertext, usableSecret } from '@/shared/secret-value';

const makeService = (opts: { keys: string[]; locked: boolean }) => {
    const app = new App();
    app.vault = new Vault();
    const usable = opts.keys.some(key => Boolean(usableSecret(key)));
    return new SetupReadinessService(app, {
        hasApiKey: () => usable,
        secretsLocked: () => opts.locked,
        currentModel: () => 'deepseek-flash',
        activeProject: () => '',
        indexEntryCount: async () => 0,
        pendingSettlementCount: async () => 0,
    });
};

describe('SetupReadinessService — 密钥加密锁定态', () => {
    it('密文在锁定态：判定为 missing 并提示解锁', async () => {
        const report = await makeService({ keys: ['aes256v2:1:s:i:ct'], locked: true }).check();
        const provider = report.items.find(item => item.id === 'provider');
        expect(provider?.status).toBe('missing');
        expect(provider?.detail).toContain('口令未解锁');
        expect(provider?.fix).toContain('解锁');
    });

    it('明文 Key：判定为 ok', async () => {
        const report = await makeService({ keys: ['sk-plain'], locked: false }).check();
        expect(report.items.find(item => item.id === 'provider')?.status).toBe('ok');
    });

    it('secret-value 判定一致', () => {
        expect(isStoredCiphertext('aes256:v1')).toBe(true);
        expect(isStoredCiphertext('aes256v2:1:a:b:c')).toBe(true);
        expect(isStoredCiphertext('sk-plain')).toBe(false);
        expect(usableSecret('aes256v2:1:a:b:c')).toBe('');
        expect(usableSecret('sk-plain')).toBe('sk-plain');
    });
});
