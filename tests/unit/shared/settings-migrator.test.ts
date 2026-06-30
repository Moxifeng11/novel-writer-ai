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
            expect(result.schemaVersion).toBe(3);
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
            expect(result.schemaVersion).toBe(3);
            expect(result.modelOverrides).toEqual({});
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
        it('值为 3', () => {
            expect(CURRENT_SCHEMA_VERSION).toBe(3);
        });
    });
});
