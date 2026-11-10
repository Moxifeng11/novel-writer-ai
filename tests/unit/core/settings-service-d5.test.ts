import { describe, it, expect, vi } from 'vitest';

// settings-service 反向引用 main.ts 的 DEFAULT_PROVIDERS；用最小桩替代，避免加载构建产物。
vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {
        volc: { id: 'volc', name: '火山引擎', endpoint: '', models: ['volc-model'], maxContext: 1, maxOutput: 1 },
    },
    default: class NovelWriterPlugin {},
}));

import {
    SettingsService,
    deepMergeSettings,
    getDefaultSettings,
} from '../../../core/settings-service';
import { CURRENT_SCHEMA_VERSION } from '../../../shared/settings-migrator';

/**
 * D5 — 设置嵌套字段深合并 + 迁移结果回写。
 */

describe('deepMergeSettings', () => {
    it('嵌套对象递归补齐默认值，用户已设字段保留', () => {
        const merged = deepMergeSettings(
            { nested: { x: 1, y: 2 }, top: 'default' },
            { nested: { y: 9 } },
        );

        expect(merged).toEqual({ nested: { x: 1, y: 9 }, top: 'default' });
    });

    it('数组整体替换，不按索引合并', () => {
        const merged = deepMergeSettings({ models: ['a', 'b', 'c'] }, { models: ['z'] });

        expect(merged.models).toEqual(['z']);
    });

    it('undefined 不覆盖默认值', () => {
        const merged = deepMergeSettings({ keep: 'default', x: 1 }, { keep: undefined, x: 2 });

        expect(merged).toEqual({ keep: 'default', x: 2 });
    });
});

interface Harness {
    service: SettingsService;
    saved: Array<Record<string, unknown>>;
    current: () => Record<string, unknown> | undefined;
}

function createService(rawData: Record<string, unknown> | null): Harness {
    const saved: Array<Record<string, unknown>> = [];
    let current: Record<string, unknown> | undefined;

    const service = new SettingsService({
        crypto: {
            decryptWithoutPrompt: async (value: string) => value,
            hasSessionPassword: () => false,
            encrypt: async (value: string) => value,
        } as never,
        providerManager: {
            syncCustomModelsOnRestart: () => undefined,
            updateModelLimits: () => undefined,
        } as never,
        cacheManager: null,
        settingsWriter: {
            enqueueAutoClean: (operation: () => Promise<unknown>) => operation(),
        } as never,
        getSettings: () => current as never,
        setSettings: (value) => { current = value as unknown as Record<string, unknown>; },
        loadData: async () => rawData,
        saveData: async (data: unknown) => { saved.push(data as Record<string, unknown>); },
    });

    return { service, saved, current: () => current };
}

describe('SettingsService.loadSettings — D5 迁移回写', () => {
    it('旧版配置缺少新字段 → 内存补全默认值，并回写一次磁盘', async () => {
        const { service, saved, current } = createService({
            schemaVersion: 3,
            maxContext: 64000,
            promptManagerConfig: {},
        });

        await service.loadSettings();

        const defaults = getDefaultSettings();
        const loaded = current()!;
        // 用户显式设置保留
        expect(loaded.maxContext).toBe(64000);
        // 嵌套对象缺失字段回落默认值（deepMerge 生效，不再是 undefined）
        expect(Object.keys(loaded.promptManagerConfig as object).sort())
            .toEqual(Object.keys(defaults.promptManagerConfig as object).sort());

        expect(saved).toHaveLength(1);
        expect(saved[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('已是当前版本且字段完整 → 不重复回写', async () => {
        const { service, saved } = createService({
            ...(getDefaultSettings() as unknown as Record<string, unknown>),
            schemaVersion: CURRENT_SCHEMA_VERSION,
        });

        await service.loadSettings();

        expect(saved).toHaveLength(0);
    });
});

describe('SettingsService — 密钥不降级（2026-10-29 修复 API Key 失效）', () => {
    const CIPHER = 'aes256v2:210000:c2FsdA==:aXY=:Y3Q=';

    function harness(raw: Record<string, unknown>, crypto: Record<string, unknown>) {
        const saved: Array<Record<string, unknown>> = [];
        let current: Record<string, unknown> | undefined;
        const service = new SettingsService({
            crypto: crypto as never,
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
        });
        return { service, saved, current: () => current };
    }

    it('磁盘上原本是密文、本次未解锁 → 保存时保留旧密文，绝不写明文', async () => {
        const { service, saved, current } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: CIPHER, providerKeys: { volc: CIPHER } },
            {
                // 未解锁：静默解密原样返回密文
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => false,
                // 拿不到口令 → strict 返回 null
                encryptStrict: async () => null,
                encrypt: async (v: string) => v,
            },
        );

        await service.loadSettings();
        // 用户在界面上把密钥改成了明文（模拟编辑后保存）
        (current() as Record<string, unknown>).apiKey = 'sk-brand-new';
        (current() as Record<string, unknown>).providerKeys = { volc: 'sk-brand-new' };
        await service.saveSettings();

        const written = saved[saved.length - 1];
        // 关键：不能把明文写回磁盘（否则加密值被降级）
        expect(written.apiKey).toBe(CIPHER);
        expect((written.providerKeys as Record<string, string>).volc).toBe(CIPHER);
    });

    it('混合态：已有密文时新增密钥不得明文落盘（2026-11-10 安全审计 F1）', async () => {
        const { service, saved, current } = harness(
            // 一个字段是 v2 密文、另一个是历史明文：混合态
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: CIPHER, providerKeys: { volc: 'sk-old-plain' } },
            {
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => false,
                // 未解锁且用户取消口令
                encryptStrict: async () => null,
                encrypt: async (v: string) => v,
            },
        );

        await service.loadSettings();
        (current() as Record<string, unknown>).providerKeys = {
            volc: 'sk-old-plain',
            newProvider: 'sk-demo-new',
        };
        await service.saveSettings();

        const written = saved[saved.length - 1];
        const keys = written.providerKeys as Record<string, string>;
        // 新密钥没有旧值可保留 → 拒绝写入，而不是明文落盘
        expect(keys.newProvider).toBe('');
        expect(JSON.stringify(written)).not.toContain('sk-demo-new');
        // 历史明文保持原样，不因本次保存丢失
        expect(keys.volc).toBe('sk-old-plain');
    });

    it('磁盘上原本是明文（从没用过口令）→ 仍按明文保存（兼容旧行为）', async () => {        const { service, saved, current } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: 'sk-plain' },
            {
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => false,
                encryptStrict: async () => null,
                encrypt: async (v: string) => v,
            },
        );

        await service.loadSettings();
        (current() as Record<string, unknown>).apiKey = 'sk-plain-2';
        await service.saveSettings();

        expect(saved[saved.length - 1].apiKey).toBe('sk-plain-2');
    });

    it('有会话口令 → 明文会被加密后落盘', async () => {
        const { service, saved, current } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: CIPHER },
            {
                decryptWithoutPrompt: async () => 'sk-decrypted',
                hasSessionPassword: () => true,
                encryptStrict: async (v: string) => 'enc:' + v,
                encrypt: async (v: string) => 'enc:' + v,
            },
        );

        await service.loadSettings();
        (current() as Record<string, unknown>).apiKey = 'sk-typed';
        await service.saveSettings();

        expect(saved[saved.length - 1].apiKey).toBe('enc:sk-typed');
    });

    it('hasEncryptedSecrets / lockedSecretCount 反映磁盘密文', async () => {
        const { service } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: CIPHER, providerKeys: { volc: 'sk-plain' } },
            {
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => false,
                encryptStrict: async () => null,
                encrypt: async (v: string) => v,
            },
        );
        await service.loadSettings();
        expect(service.hasEncryptedSecrets()).toBe(true);
        expect(service.lockedSecretCount()).toBe(1);
        expect(service.findExistingCiphertext()).toBe(CIPHER);
    });

    it('三个向量密钥各写各的字段，互不覆盖（曾把豆包写成 OpenAI）', async () => {
        const { service, saved, current } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION },
            {
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => true,
                encryptStrict: async (v: string) => 'enc:' + v,
                encrypt: async (v: string) => v,
            },
        );

        await service.loadSettings();
        Object.assign(current() as Record<string, unknown>, {
            vectorOpenaiApiKey: 'sk-openai',
            vectorDoubaoApiKey: 'sk-doubao',
            vectorQwenApiKey: 'sk-qwen',
        });
        await service.saveSettings();

        const written = saved[saved.length - 1];
        expect(written.vectorOpenaiApiKey).toBe('enc:sk-openai');
        expect(written.vectorDoubaoApiKey).toBe('enc:sk-doubao');
        expect(written.vectorQwenApiKey).toBe('enc:sk-qwen');
    });
});
