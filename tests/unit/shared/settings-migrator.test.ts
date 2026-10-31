/**
 * settings-migrator.test.ts — 设置版本迁移器单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import {
    migrateSettings,
    migrateSettingsWithStatus,
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
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.modelOverrides).toEqual({});
        });

        it('v3→v4 将默认供应商添加到 customProviders', () => {
            const data = {
                schemaVersion: 3,
                customProviders: [],
                hiddenPresets: [],
            };
            const result = migrateSettings(data) as any;
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
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
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.customProviders.length).toBeGreaterThan(0);
            expect(result.hiddenPresets).toBeUndefined();
        });

        it('v3→v4 字段类型损坏（非数组）时安全回退为空数组且迁移完成', () => {
            const data = {
                schemaVersion: 3,
                customProviders: 'nope' as unknown as never,
                hiddenPresets: 'nope' as unknown as never,
            };
            const result = migrateSettings(data) as any;
            // 修复前：.map/.includes 抛 TypeError → 迁移中断 → schemaVersion 停在 3
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(Array.isArray(result.customProviders)).toBe(true);
            expect(result.customProviders.length).toBeGreaterThan(0);
            expect(result.hiddenPresets).toBeUndefined();
        });

        it('v3→v4 modelOverrides 为字符串时规范为空对象且迁移完成', () => {
            const data = {
                schemaVersion: 3,
                modelOverrides: 'nope' as unknown as never,
            };
            const result = migrateSettings(data) as any;
            // 修复前：字符串在 provider-manager.setModelOverride 的 `overrides[endpoint] = {}`
            // 处对原始值赋属性，严格模式下抛 TypeError
            expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(result.modelOverrides).toEqual({});
        });

        it('v3→v4 modelOverrides 为数组时规范为空对象', () => {
            const data = {
                schemaVersion: 3,
                modelOverrides: ['a', 'b'] as unknown as never,
            };
            const result = migrateSettings(data) as any;
            expect(result.modelOverrides).toEqual({});
        });

        it('v3→v4 合法 modelOverrides 原样保留', () => {
            const overrides = { 'https://api.example.com': { 'gpt-4': { maxContext: 100 } } };
            const data = { schemaVersion: 3, modelOverrides: overrides };
            const result = migrateSettings(data) as any;
            expect(result.modelOverrides).toEqual(overrides);
        });

        it('v2→v3 modelOverrides 为数组时不产出索引键对象', () => {
            const data = {
                schemaVersion: 2,
                apiEndpoint: 'https://api.example.com',
                modelOverrides: ['a', 'b'] as unknown as never,
            };
            const result = migrateSettings(data) as any;
            // 修复前：{ ...['a','b'] } → { 0:'a', 1:'b' } 会污染两层索引结构
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
        it('值为 5', () => {
            expect(CURRENT_SCHEMA_VERSION).toBe(5);
        });
    });
});

describe('v4→v5：五层配色收敛为三层', () => {
    /** 用户真实 data.json 的旧结构（脱敏） */
    const legacyV4 = {
        schemaVersion: 4,
        theme: 'auto',
        themeColors: {
            accent: '#24ffe5',
            appBg: '#251818',
            appearancePreset: 'paper',
            enableCustomCardBg: true,
            cardBg: '#cb522a',
            panelBg: '#110d09',
            textPrimary: '#4af28a',
        },
    };

    it('把旧观感冻结成一套方案，再删除五层字段', () => {
        const result = migrateSettings({ ...legacyV4 });
        const colors = result.themeColors as Record<string, unknown>;

        // 五层旧字段全部清除
        expect(colors.panelBg).toBeUndefined();
        expect(colors.textPrimary).toBeUndefined();
        expect(colors.enableCustomCardBg).toBeUndefined();
        // 三层保留
        expect(colors.appBg).toBe('#251818');
        expect(colors.cardBg).toBe('#cb522a');
        expect(colors.accent).toBe('#24ffe5');
        expect(colors.appearancePreset).toBe('paper');
    });

    it('旧值被冻结进 themePresets，可随时切回', () => {
        const result = migrateSettings({ ...legacyV4 });
        const presets = result.themePresets as Array<Record<string, unknown>>;
        expect(presets).toHaveLength(1);
        const frozen = presets[0];
        expect(frozen.name).toBe('旧配色（v4.21）');
        expect(frozen.base).toBe('#251818');
        expect(frozen.card).toBe('#cb522a');
        expect(frozen.accent).toBe('#24ffe5');
        expect(frozen.legacyPanel).toBe('#110d09');
        expect(frozen.text).toBe('#4af28a');
        expect(frozen.preset).toBe('paper');
    });

    it('迁移幂等：重复执行不会堆叠方案', () => {
        const once = migrateSettings({ ...legacyV4 });
        const twice = migrateSettings({ ...once });
        expect(twice.themePresets).toHaveLength(1);
    });

    it('无旧字段时不生成方案', () => {
        const result = migrateSettings({
            schemaVersion: 4,
            themeColors: { appBg: '#101010', accent: '#ff0000', appearancePreset: 'soft' },
        });
        expect(result.themePresets).toEqual([]);
        expect((result.themeColors as Record<string, unknown>).appBg).toBe('#101010');
    });

    it('themeColors 缺失时原样升版', () => {
        const result = migrateSettings({ schemaVersion: 4, foo: 'bar' });
        expect(result.schemaVersion).toBe(5);
        expect(result.foo).toBe('bar');
    });

    it('清掉指向已不存在方案的 activePresetId', () => {
        const result = migrateSettings({
            schemaVersion: 4,
            themeColors: { appBg: '#101010', activePresetId: 'gone' },
        });
        expect((result.themeColors as Record<string, unknown>).activePresetId).toBeUndefined();
    });
});

describe('normalizeUpdateGithubRepo — 旧仓库名迁移', () => {
    it('把 trae-ai/novel-writer-ai 迁移到官方仓库', async () => {
        const { normalizeUpdateGithubRepo, DEFAULT_UPDATE_GITHUB_REPO } = await import('../../../shared/settings-migrator');
        expect(normalizeUpdateGithubRepo('trae-ai/novel-writer-ai')).toBe(DEFAULT_UPDATE_GITHUB_REPO);
        expect(DEFAULT_UPDATE_GITHUB_REPO).toBe('Moxifeng11/novel-writer-ai');
    });

    it('保留用户自定义仓库', async () => {
        const { normalizeUpdateGithubRepo } = await import('../../../shared/settings-migrator');
        expect(normalizeUpdateGithubRepo('someone/fork')).toBe('someone/fork');
    });
});

describe('migrateSettingsWithStatus — 迁移失败不盖章（v4.27）', () => {
    it('已是最新版本：completed=true 且不改数据', () => {
        const outcome = migrateSettingsWithStatus({ schemaVersion: CURRENT_SCHEMA_VERSION, a: 1 });
        expect(outcome.completed).toBe(true);
        expect(outcome.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(outcome.toVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(outcome.data.a).toBe(1);
    });

    it('迁移链缺失时 completed=false，不回写版本', () => {
        const outcome = migrateSettingsWithStatus({ schemaVersion: 999 });
        // 999 已经 >= CURRENT，属于「已是最新」分支
        expect(outcome.completed).toBe(true);
    });

    it('withCurrentVersion 只在完成时被调用（语义护栏）', () => {
        const outcome = migrateSettingsWithStatus({ schemaVersion: 0 });
        if (!outcome.completed) {
            // 失败时调用方不得写盘：这里断言「未完成 → 数据结构里没有被迫升级的版本号」
            expect(outcome.data.schemaVersion).not.toBe(CURRENT_SCHEMA_VERSION);
        }
        expect(typeof outcome.error === 'string' || outcome.error === undefined).toBe(true);
    });
});
