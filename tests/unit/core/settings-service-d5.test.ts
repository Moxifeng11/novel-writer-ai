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
