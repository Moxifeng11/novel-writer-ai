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

export const CURRENT_SCHEMA_VERSION = 5;

export { GITHUB_REPO_SLUG as DEFAULT_UPDATE_GITHUB_REPO } from './github-repo';

import { GITHUB_REPO_SLUG, normalizeGitHubRepo } from './github-repo';

/**
 * normalizeUpdateGithubRepo 函数。
 * @param value - 值
 * @returns 文本结果
 */
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

/**
 * VersionedData 类型定义。
 */
export interface VersionedData {
    schemaVersion?: number;
    [key: string]: unknown;
}

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

/** v4→v5 迁移时冻结旧观感所用的方案名（幂等判据） */
const LEGACY_PRESET_NAME = '旧配色（v4.21）';

const migrations: Array<{ from: number; to: number; migrate: MigrationFn }> = [    {
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
    {
        from: 4,
        to: 5,
        migrate: (data) => {
            // v4.22 外观重构：颜色配置从 5 层（基底/面板/卡片/强调/文字 + 卡片开关）
            // 收敛为 3 层（基底/卡片/强调）。旧的 panelBg / textPrimary /
            // enableCustomCardBg 会把三层派生结果覆盖掉，表现为「改了还是老样子」。
            //
            // 处理策略：先把旧值冻结成一套命名方案存进 themePresets（用户可随时切回），
            // 再删除这三个字段。这样既彻底收敛结构，又不丢用户现有观感。
            const themeColors = (data.themeColors
                && typeof data.themeColors === 'object'
                && !Array.isArray(data.themeColors))
                ? { ...(data.themeColors as Record<string, unknown>) }
                : null;

            if (!themeColors) {
                return { ...data, schemaVersion: 5 };
            }

            const legacyKeys = ['panelBg', 'textPrimary', 'enableCustomCardBg'] as const;
            const hasLegacy = legacyKeys.some(key => themeColors[key] !== undefined);

            let themePresets = Array.isArray(data.themePresets)
                ? [...(data.themePresets as unknown[])]
                : [];

            if (hasLegacy) {
                const alreadyFrozen = themePresets.some(
                    preset => preset
                        && typeof preset === 'object'
                        && (preset as { name?: unknown }).name === LEGACY_PRESET_NAME,
                );
                if (!alreadyFrozen) {
                    // 冻结的是「旧观感」：把当时的实际生效值全部记下来
                    const frozen: Record<string, unknown> = {
                        id: `theme-legacy-${Date.now()}`,
                        name: LEGACY_PRESET_NAME,
                        createdAt: Date.now(),
                    };
                    if (typeof themeColors.appBg === 'string') frozen.base = themeColors.appBg;
                    if (typeof themeColors.cardBg === 'string') frozen.card = themeColors.cardBg;
                    if (typeof themeColors.panelBg === 'string') frozen.legacyPanel = themeColors.panelBg;
                    if (typeof themeColors.accent === 'string') frozen.accent = themeColors.accent;
                    if (typeof themeColors.textPrimary === 'string') frozen.text = themeColors.textPrimary;
                    if (typeof themeColors.appearancePreset === 'string') frozen.preset = themeColors.appearancePreset;
                    if (typeof data.theme === 'string') frozen.theme = data.theme;
                    themePresets.push(frozen);
                }
            }

            for (const key of legacyKeys) delete themeColors[key];
            // 旧字段清掉后，activePresetId 若指向已不存在的方案则一并清掉
            const stillValid = typeof themeColors.activePresetId === 'string'
                && themePresets.some(
                    preset => preset
                        && typeof preset === 'object'
                        && (preset as { id?: unknown }).id === themeColors.activePresetId,
                );
            if (!stillValid) delete themeColors.activePresetId;

            return {
                ...data,
                schemaVersion: 5,
                themeColors,
                themePresets,
            };
        },
    },
];

/**
 * MigrationOutcome 类型定义。
 */
export interface MigrationOutcome {
    data: Record<string, unknown>;
    /** 是否已完整升级到 CURRENT_SCHEMA_VERSION */
    completed: boolean;
    /** 迁移起点版本 */
    fromVersion: number;
    /** 实际到达的版本 */
    toVersion: number;
    /** 失败原因（completed=false 时非空） */
    error?: string;
}

/**
 * 带状态的迁移（v4.27）：调用方据此决定是否回写 settings。
 *
 * 旧实现里迁移失败只 `break`，而 `saveSettings()` 会无条件写入
 * `schemaVersion: CURRENT`——失败被「盖章完成」，以后不再重试。
 * @param rawData - 原始数据
  * @returns MigrationOutcome 实例
 */
export function migrateSettingsWithStatus(rawData: Record<string, unknown>): MigrationOutcome {
    let data = { ...rawData };
    const fromVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
    let currentVersion = fromVersion;

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
        return { data, completed: true, fromVersion, toVersion: currentVersion };
    }

    let error: string | undefined;
    // 链式迁移：从当前版本一路升级到最新版本
    while (currentVersion < CURRENT_SCHEMA_VERSION) {
        const migration = migrations.find(m => m.from === currentVersion);
        if (!migration) {
            error = `找不到从 v${currentVersion} 开始的迁移`;
            log.warn(`[SettingsMigrator] 警告：${error}，停止升级`);
            break;
        }
        try {
            data = migration.migrate(data);
            currentVersion = migration.to;
        } catch (e) {
            error = `迁移 v${migration.from}→v${migration.to} 失败：${e instanceof Error ? e.message : String(e)}`;
            log.warn('[SettingsMigrator]', error);
            break;
        }
    }

    const completed = currentVersion >= CURRENT_SCHEMA_VERSION;
    if (!completed) {
        log.warn(
            `[SettingsMigrator] 警告：数据版本 ${currentVersion} 未升级到 ${CURRENT_SCHEMA_VERSION}（不会回写 schemaVersion）`
        );
    }
    return { data, completed, fromVersion, toVersion: currentVersion, error };
}

/**
 * migrateSettings 函数。
 * @param rawData - 原始数据
 * @returns 映射结果
 */
export function migrateSettings(rawData: Record<string, unknown>): Record<string, unknown> {
    return migrateSettingsWithStatus(rawData).data;
}

/**
 * 带当前版本。
 * @param data - 数据
 * @returns 映射结果
 */
export function withCurrentVersion(data: Record<string, unknown>): Record<string, unknown> {
    return {
        ...data,
        schemaVersion: CURRENT_SCHEMA_VERSION,
    };
}
