import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {
        volc: { id: 'volc', name: '火山引擎', endpoint: '', models: ['volc-model'], maxContext: 1, maxOutput: 1 },
    },
    default: class NovelWriterPlugin {},
}));

import { SettingsService } from '../../../core/settings-service';

function service(canDecrypt: (pw: string, stored: string) => Promise<boolean>, rawKey: string) {
    let current: Record<string, unknown> = {};
    return new SettingsService({
        crypto: {
            decryptWithoutPrompt: async (value: string) => value,
            hasSessionPassword: () => true,
            encrypt: async (value: string) => value,
            encryptStrict: async (value: string) => `enc:${value}`,
            canDecryptWith: canDecrypt,
        } as never,
        providerManager: {
            getCurrentProviderId: () => null,
            syncCustomModelsOnRestart: () => {},
            updateModelLimits: () => {},
        } as never,
        cacheManager: null,
        settingsWriter: {
            write: async () => {},
            enqueueAutoClean: async (fn: () => Promise<void>) => fn(),
        } as never,
        getSettings: () => current as never,
        setSettings: (value) => { current = value as unknown as Record<string, unknown>; },
        loadData: async () => ({ apiKey: rawKey }),
        saveData: async () => {},
    });
}

describe('canDecryptStoredSecret', () => {
    it('有密文时用候选口令实际验证', async () => {
        const calls: string[] = [];
        const svc = service(async (pw) => { calls.push(pw); return pw === 'right'; }, 'aes256v2:1:s:i:c');
        await svc.loadSettings();
        await expect(svc.canDecryptStoredSecret('wrong')).resolves.toBe(false);
        await expect(svc.canDecryptStoredSecret('right')).resolves.toBe(true);
        expect(calls).toEqual(['wrong', 'right']);
    });

    it('没有密文时直接通过', async () => {
        const svc = service(async () => false, 'sk-plain');
        await svc.loadSettings();
        await expect(svc.canDecryptStoredSecret('whatever')).resolves.toBe(true);
    });
});
