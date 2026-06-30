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

export const CURRENT_SCHEMA_VERSION = 3;

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
            // v7.0: modelOverrides 从单层索引（modelName→values）升级为两层索引（endpoint→modelName→values）
            const oldOverrides = data.modelOverrides as Record<string, { maxContext?: number; maxOutput?: number }> | undefined;
            const newOverrides: Record<string, Record<string, { maxContext?: number; maxOutput?: number }>> = {};
            if (oldOverrides && typeof oldOverrides === 'object') {
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
            console.warn(
                `[SettingsMigrator] 警告：找不到从 v${currentVersion} 开始的迁移，停止升级`
            );
            break;
        }
        try {
            data = migration.migrate(data);
            currentVersion = migration.to;
        } catch (e) {
            console.warn(
                `[SettingsMigrator] 迁移 v${migration.from}→v${migration.to} 失败:`,
                e instanceof Error ? e.message : String(e)
            );
            break;
        }
    }

    if ((data as VersionedData).schemaVersion !== CURRENT_SCHEMA_VERSION) {
        console.warn(
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
