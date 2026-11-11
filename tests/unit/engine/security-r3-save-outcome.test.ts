/**
 * S3-8（安全 r3）：设置保存结果必须可观测。
 *
 * 旧实现加密失败时静默保留旧密文/空串，saveSettings() 返回 void，
 * 设置页无条件弹「密钥已保存」——用户以为泄露的旧 Key 已替换。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {
        volc: { id: 'volc', name: '火山引擎', endpoint: '', models: ['volc-model'], maxContext: 1, maxOutput: 1 },
    },
    default: class NovelWriterPlugin {},
}));

import { SettingsService } from '../../../core/settings-service';
import { CURRENT_SCHEMA_VERSION } from '../../../shared/settings-migrator';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CIPHER = 'aes256v2:210000:c2FsdA==:aXY=:Y3Q=';

function harness(raw: Record<string, unknown>, crypto: Record<string, unknown>) {
    let current: Record<string, unknown> | undefined;
    const service = new SettingsService({
        crypto: crypto as never,
        providerManager: {
            syncCustomModelsOnRestart: () => undefined,
            updateModelLimits: () => undefined,
        } as never,
        cacheManager: null,
        settingsWriter: { enqueueAutoClean: (op: () => Promise<unknown>) => op() } as never,
        getSettings: () => current as never,
        setSettings: (v) => { current = v as unknown as Record<string, unknown>; },
        loadData: async () => raw,
        saveData: async () => undefined,
    });
    return { service, current: () => current };
}

describe('S3-8 saveSettings 结果可观测', () => {
    it('口令未解锁 → 返回 droppedSecrets，UI 可提示未保存', async () => {
        const { service, current } = harness(
            { schemaVersion: CURRENT_SCHEMA_VERSION, apiKey: CIPHER, providerKeys: { volc: CIPHER } },
            {
                decryptWithoutPrompt: async (v: string) => v,
                hasSessionPassword: () => false,
                encryptStrict: async () => null,
                encrypt: async (v: string) => v,
            },
        );
        await service.loadSettings();
        (current() as Record<string, unknown>).apiKey = 'sk-new';
        (current() as Record<string, unknown>).providerKeys = { volc: 'sk-new' };

        const outcome = await service.saveSettings();

        expect(outcome.saved).toBe(true);
        expect(outcome.droppedSecrets).toContain('apiKey');
        expect(outcome.droppedSecrets).toContain('providerKeys.volc');
    });

    it('正常明文保存（从未用过口令）→ droppedSecrets 为空', async () => {
        const { service, current } = harness(
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

        const outcome = await service.saveSettings();
        expect(outcome).toEqual({ saved: true, droppedSecrets: [] });
    });
});

describe('S3-8 接线契约', () => {
    it('两个设置页根据结果分支提示', () => {
        for (const rel of ['ui/settings/api-section.ts', 'ui/manage-providers-modal.ts']) {
            const src = read(rel);
            expect(src).toContain('saveSettingsWithOutcome');
            expect(src).toContain('droppedSecrets.length > 0');
            expect(src).toContain('口令未解锁');
        }
    });

    it('main 暴露 saveSettingsWithOutcome（saveSettings 保持 void 兼容）', () => {
        const src = read('main.ts');
        expect(src).toContain('async saveSettingsWithOutcome(): Promise<SaveSettingsOutcome>');
        expect(src).toContain('async saveSettings(): Promise<void>');
    });
});
