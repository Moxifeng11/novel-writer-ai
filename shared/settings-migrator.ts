import { createLogger } from './logger';

const log = createLogger('SettingsMigrator');
/**
 * settings-migrator.ts — 设置版本迁移器
 *
 * 功能：当设置格式升级时，自动迁移用户旧数据，避免数据丢失。
 *
 * 设计原则：
 * 1. 每个 schemaVersion 对应一个迁移函数
 * 2. 迁移链按顺序执行（v0→v1→v2→...）
 * 3. 迁移失败时记录警告，返回原始数据（不崩溃）
 * 4. 新安装用户直接使用最新版本，不执行迁移
 */

export const CURRENT_SCHEMA_VERSION = 4;

export { GITHUB_REPO_SLUG as DEFAULT_UPDATE_GITHUB_REPO } from './github-repo';

import { GITHUB_REPO_SLUG, normalizeGitHubRepo } from './github-repo';

export function normalizeUpdateGithubRepo(value?: string): string {
    const repo = normalizeGitHubRepo(value);
    if (!repo || repo === 'trae-ai/novel-writer-ai') return GITHUB_REPO_SLUG;
    return repo;
}

interface MigrationCustomProvider {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    maxContext: number;
    maxOutput: number;
    sourceType?: 'cloud' | 'local';
    isDefault?: boolean;
    isHidden?: boolean;
}

const DEFAULT_PROVIDERS_TEMPLATE: Record<string, MigrationCustomProvider> = {
    volc:     { id: 'volc',     name: '火山引擎豆包', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', models: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228', 'doubao-seed-2-0-code-preview-260215', 'glm-4-7-251222'], maxContext: 256000, maxOutput: 131072, sourceType: 'cloud', isDefault: true },
    ollama:   { id: 'ollama',   name: '本地 Ollama',  endpoint: 'http://localhost:11434/v1/chat/completions',            models: ['qwen2.5:7b', 'deepseek-r1:7b'],                                      maxContext: 32768,  maxOutput: 8192,   sourceType: 'local', isDefault: true },
    catcat:   { id: 'catcat',   name: 'CatCat Gemini', endpoint: 'https://api.catcat.top/v1/chat/completions',              models: ['gemini-3.1-pro-preview-search'],                                    maxContext: 1048576, maxOutput: 65536,  sourceType: 'cloud', isDefault: true },
    deepseek: { id: 'deepseek', name: 'DeepSeek 官网', endpoint: 'https://api.deepseek.com/v1/chat/completions',            models: ['deepseek-v4-flash', 'deepseek-v4-pro'],                             maxContext: 1048576, maxOutput: 384000, sourceType: 'cloud', isDefault: true },
    sensenova: { id: 'sensenova', name: '日日新/SenseNova', endpoint: 'https://token.sensenova.cn/v1/chat/completions',        models: ['sensenova-6.7-flash-lite', 'deepseek-v4-flash'],                   maxContext: 262144,  maxOutput: 65536,  sourceType: 'cloud', isDefault: true },
};

export interface VersionedData {
    schemaVersion?: number;
    [key: string]: unknown;
}

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations: Array<{ from: number; to: number; migrate: MigrationFn }> = [
    {
        from: 0,
        to: 1,
        migrate: (data) => {
            return {
                ...data,
                schemaVersion: 1,
            };
        },
    },
    {
        from: 1,
        to: 2,
        migrate: (data) => {
            const newData = { ...data, schemaVersion: 2 };
            return newData;
        },
    },
    {
        from: 2,
        to: 3,
        migrate: (data) => {
            const oldOverrides = data.modelOverrides as Record<string, { maxContext?: number; maxOutput?: number }> | undefined;
            const newOverrides: Record<string, Record<string, { maxContext?: number; maxOutput?: number }>> = {};
            // 加固：数组也满足 typeof === 'object'，但 { ...[] } 会产出索引键对象（{0:..}）污染结构，
            // 故显式排除数组；非对象/数组一律视为「无覆盖」。
            if (oldOverrides && typeof oldOverrides === 'object' && !Array.isArray(oldOverrides)) {
                const endpoint = (data as Record<string, unknown>).apiEndpoint as string || '';
                if (endpoint) {
                    newOverrides[endpoint] = { ...oldOverrides };
                }
            }
            return {
                ...data,
                schemaVersion: 3,
                modelOverrides: newOverrides,
            };
        },
    },
    {
        from: 3,
        to: 4,
        migrate: (data) => {
            // 加固：损坏的 data.json 可能把这两个字段写成非数组（如字符串），
            // 直接用 `|| []` 只挡 falsy，真值非数组会在 .map/.includes 处抛 TypeError，
            // 导致迁移中断、schemaVersion 停在 3，且 customProviders 变成字符串污染后续 .find/.filter。
            const customProviders = Array.isArray(data.customProviders)
                ? data.customProviders as MigrationCustomProvider[]
                : [];
            const hiddenPresets = Array.isArray(data.hiddenPresets)
                ? data.hiddenPresets as string[]
                : [];
            // 加固：`modelOverrides` 若不是普通对象（如损坏成字符串 / 数组），下游
            // `provider-manager.setModelOverride` 会执行 `overrides[endpoint] = {}` ——
            // 对字符串赋属性在严格模式下抛 TypeError。此处统一规范为普通对象
            // （`{}` 与 settings-service 的默认值等价，即「无覆盖」）。
            const modelOverrides = (data.modelOverrides
                && typeof data.modelOverrides === 'object'
                && !Array.isArray(data.modelOverrides))
                ? data.modelOverrides as Record<string, unknown>
                : {};
            const customProviderIds = new Set(customProviders.map(p => p.id));
            const newCustomProviders: MigrationCustomProvider[] = [...customProviders];

            for (const [id, preset] of Object.entries(DEFAULT_PROVIDERS_TEMPLATE)) {
                if (!customProviderIds.has(id)) {
                    newCustomProviders.push({ ...preset });
                }
            }

            for (const provider of newCustomProviders) {
                if (hiddenPresets.includes(provider.id)) {
                    provider.isHidden = true;
                }
            }

            const newData: Record<string, unknown> = {
                ...data,
                schemaVersion: 4,
                customProviders: newCustomProviders,
                modelOverrides,
            };
            delete newData.hiddenPresets;
            return newData;
        },
    },
];

export function migrateSettings(rawData: Record<string, unknown>): Record<string, unknown> {
    let data = { ...rawData };
    let currentVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
        return data;
    }

    // 链式迁移：从当前版本一路升级到最新版本
    while (currentVersion < CURRENT_SCHEMA_VERSION) {
        const migration = migrations.find(m => m.from === currentVersion);
        if (!migration) {
            log.warn(
                `[SettingsMigrator] 警告：找不到从 v${currentVersion} 开始的迁移，停止升级`
            );
            break;
        }
        try {
            data = migration.migrate(data);
            currentVersion = migration.to;
        } catch (e) {
            log.warn(
                `[SettingsMigrator] 迁移 v${migration.from}→v${migration.to} 失败:`,
                e instanceof Error ? e.message : String(e)
            );
            break;
        }
    }

    if ((data as VersionedData).schemaVersion !== CURRENT_SCHEMA_VERSION) {
        log.warn(
            `[SettingsMigrator] 警告：数据版本 ${(data as VersionedData).schemaVersion} 与最新版本 ${CURRENT_SCHEMA_VERSION} 不一致`
        );
    }

    return data;
}

export function withCurrentVersion(data: Record<string, unknown>): Record<string, unknown> {
    return {
        ...data,
        schemaVersion: CURRENT_SCHEMA_VERSION,
    };
}
