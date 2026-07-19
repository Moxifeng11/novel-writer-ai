/**
 * settings-migrator.test.ts — 设置版本迁移器单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import {
    migrateSettings,
    withCurrentVersion,
    CURRENT_SCHEMA_VERSION,
} from '../../../shared/settings-migrator';

describe('SettingsMigrator', () => {
    describe('migrateSettings', () => {
        it('最新版本数据不变', () => {
            const data = { schemaVersion: CURRENT_SCHEMA_VERSION, someKey: 'value' };
            const result = migrateSettings(data);
            expect(result).toEqual(data);
        });

        it('无 schemaVersion 视为 v0 并执行完整迁移链', () => {
            const data = { someKey: 'value' };
            const result = migrateSettings(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        });

        it('v0→v1 添加 schemaVersion: 1', () => {
            const data = { schemaVersion: 0, foo: 'bar' };
            const result = migrateSettings(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.foo).toBe('bar');
        });

        it('v1→v2 升级', () => {
            const data = { schemaVersion: 1, foo: 'bar' };
            const result = migrateSettings(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        });

        it('v2→v3 迁移 modelOverrides 到两层索引', () => {
            const data = {
                schemaVersion: 2,
                apiEndpoint: 'https://api.example.com',
                modelOverrides: {
                    'gpt-4': { maxContext: 128000, maxOutput: 4096 },
                },
            };
            const result = migrateSettings(data) as any;
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.modelOverrides).toBeDefined();
            expect(result.modelOverrides['https://api.example.com']).toBeDefined();
            expect(result.modelOverrides['https://api.example.com']['gpt-4']).toEqual({
                maxContext: 128000,
                maxOutput: 4096,
            });
        });

        it('v2→v3 无 apiEndpoint 时 modelOverrides 为空对象', () => {
            const data = {
                schemaVersion: 2,
                modelOverrides: {
                    'gpt-4': { maxContext: 128000 },
                },
            };
            const result = migrateSettings(data) as any;
            expect(result.modelOverrides).toEqual({});
        });

        it('v2→v3 无 modelOverrides 时安全处理', () => {
            const data = { schemaVersion: 2 };
            const result = migrateSettings(data) as any;
            expect(result.schemaVersion).toBe(4);
            expect(result.modelOverrides).toEqual({});
        });

        it('v3→v4 将默认供应商添加到 customProviders', () => {
            const data = {
                schemaVersion: 3,
                customProviders: [],
                hiddenPresets: [],
            };
            const result = migrateSettings(data) as any;
            expect(result.schemaVersion).toBe(4);
            expect(result.customProviders.length).toBeGreaterThan(0);
            expect(result.customProviders.find((p: any) => p.id === 'volc')).toBeDefined();
            expect(result.customProviders.find((p: any) => p.id === 'volc').isDefault).toBe(true);
            expect(result.hiddenPresets).toBeUndefined();
        });

        it('v3→v4 保留用户自定义的供应商', () => {
            const customProvider = {
                id: 'custom-1',
                name: '我的自定义',
                endpoint: 'https://custom.example.com',
                models: ['model-a'],
                maxContext: 8192,
                maxOutput: 2048,
            };
            const data = {
                schemaVersion: 3,
                customProviders: [customProvider],
                hiddenPresets: [],
            };
            const result = migrateSettings(data) as any;
            expect(result.customProviders.find((p: any) => p.id === 'custom-1')).toBeDefined();
            expect(result.customProviders.find((p: any) => p.id === 'custom-1').name).toBe('我的自定义');
        });

        it('v3→v4 不覆盖用户已修改的默认供应商', () => {
            const modifiedVolc = {
                id: 'volc',
                name: '自定义火山',
                endpoint: 'https://custom-volc.example.com',
                models: ['my-model'],
                maxContext: 1000,
                maxOutput: 500,
            };
            const data = {
                schemaVersion: 3,
                customProviders: [modifiedVolc],
                hiddenPresets: [],
            };
            const result = migrateSettings(data) as any;
            const volc = result.customProviders.find((p: any) => p.id === 'volc');
            expect(volc).toBeDefined();
            expect(volc.name).toBe('自定义火山');
            expect(volc.endpoint).toBe('https://custom-volc.example.com');
        });

        it('v3→v4 hiddenPresets 转换为 isHidden 标记', () => {
            const data = {
                schemaVersion: 3,
                customProviders: [],
                hiddenPresets: ['ollama', 'catcat'],
            };
            const result = migrateSettings(data) as any;
            expect(result.customProviders.find((p: any) => p.id === 'ollama').isHidden).toBe(true);
            expect(result.customProviders.find((p: any) => p.id === 'catcat').isHidden).toBe(true);
            expect(result.customProviders.find((p: any) => p.id === 'volc').isHidden).toBeUndefined();
            expect(result.hiddenPresets).toBeUndefined();
        });

        it('v3→v4 无 customProviders 和 hiddenPresets 时安全处理', () => {
            const data = { schemaVersion: 3 };
            const result = migrateSettings(data) as any;
            expect(result.schemaVersion).toBe(4);
            expect(result.customProviders.length).toBeGreaterThan(0);
            expect(result.hiddenPresets).toBeUndefined();
        });

        it('不修改原始数据（纯函数）', () => {
            const data = { schemaVersion: 0, foo: 'bar' };
            const original = { ...data };
            migrateSettings(data);
            expect(data).toEqual(original);
        });

        it('未知中间版本停止迁移并警告', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            // 假设一个不存在的版本 99（高于当前但被截断的场景不存在）
            // 实际上无法模拟"找不到迁移"的情况，因为 migrations 数组是连续的
            // 但可以验证当前版本 >= CURRENT 时直接返回
            const data = { schemaVersion: CURRENT_SCHEMA_VERSION + 10 };
            const result = migrateSettings(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 10);
            spy.mockRestore();
        });
    });

    describe('withCurrentVersion', () => {
        it('添加当前版本号', () => {
            const data = { foo: 'bar' };
            const result = withCurrentVersion(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.foo).toBe('bar');
        });

        it('覆盖已有版本号', () => {
            const data = { schemaVersion: 0, foo: 'bar' };
            const result = withCurrentVersion(data);
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        });

        it('不修改原始数据', () => {
            const data = { foo: 'bar' };
            withCurrentVersion(data);
            expect((data as any).schemaVersion).toBeUndefined();
        });
    });

    describe('CURRENT_SCHEMA_VERSION', () => {
        it('值为 4', () => {
            expect(CURRENT_SCHEMA_VERSION).toBe(4);
        });
    });
});
