import { describe, expect, it, vi } from 'vitest';

// settings-service 反向引用 main.ts 的 DEFAULT_PROVIDERS；用最小桩替代。
vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {
        volc: { id: 'volc', name: '火山引擎', endpoint: '', models: ['volc-model'], maxContext: 1, maxOutput: 1 },
    },
    default: class NovelWriterPlugin {},
}));

import { SettingsService, getDefaultSettings } from '../../../core/settings-service';
import { CURRENT_SCHEMA_VERSION } from '../../../shared/settings-migrator';

const V1 = 'aes256:aXY=:Y3Q=';
const V2 = 'aes256v2:210000:c2FsdA==:aXY=:Y3Q=';

interface Harness {
    service: SettingsService;
    saved: Array<Record<string, unknown>>;
    backups: string[];
    current: () => Record<string, unknown> | undefined;
}

function harness(raw: Record<string, unknown>, opts: {
    sessionPassword: boolean;
    encryptStrict?: (value: string) => Promise<string | null>;
}): Harness {
    const saved: Array<Record<string, unknown>> = [];
    const backups: string[] = [];
    let current: Record<string, unknown> | undefined;
    const service = new SettingsService({
        crypto: {
            // v1 可静默解密；v2 在无口令时原样返回（模拟真实 CryptoService）
            decryptWithoutPrompt: async (value: string) => value === V1 ? 'sk-legacy' : value,
            hasSessionPassword: () => opts.sessionPassword,
            encryptStrict: opts.encryptStrict ?? (async (v: string) => `enc:${v}`),
            encrypt: async (v: string) => `enc:${v}`,
        } as never,
        providerManager: {
            syncCustomModelsOnRestart: () => undefined,
            updateModelLimits: () => undefined,
        } as never,
        cacheManager: null,
        settingsWriter: {
            enqueueAutoClean: (op: () => Promise<unknown>) => op(),
        } as never,
        getSettings: () => current as never,
        setSettings: (v) => { current = v as unknown as Record<string, unknown>; },
        loadData: async () => raw,
        saveData: async (d: unknown) => { saved.push(d as Record<string, unknown>); },
        backupSettings: async (reason: string) => { backups.push(reason); },
    });
    return { service, saved, backups, current: () => current };
}

describe('v1 密文迁移与设置备份', () => {
    it('已有会话口令时，启动迁移自动把 v1 升级为 v2，并先备份 data.json', async () => {
        const { service, saved, backups } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: V1 },
            { sessionPassword: true, encryptStrict: async () => V2 },
        );

        await service.loadSettings();

        expect(backups).toHaveLength(1);
        expect(backups[0]).toContain('v1');
        expect(saved).toHaveLength(1);
        expect(saved[0].apiKey).toBe(V2);
        expect(service.legacySecretCount()).toBe(0);
    });

    it('没有会话口令时不自动升级（避免启动弹口令框），也不写明文', async () => {
        const { service, saved, backups, current } = harness(
            { ...(getDefaultSettings() as unknown as Record<string, unknown>), schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: V1 },
            { sessionPassword: false, encryptStrict: async () => null },
        );

        await service.loadSettings();
        expect(saved).toHaveLength(0);
        expect(backups).toHaveLength(0);
        expect(service.legacySecretCount()).toBe(1);

        (current() as Record<string, unknown>).apiKey = 'sk-edited';
        await service.saveSettings();

        expect(saved[saved.length - 1].apiKey).toBe(V1);
    });
});
