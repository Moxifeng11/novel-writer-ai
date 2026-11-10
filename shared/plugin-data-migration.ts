/**
 * plugin-data-migration.ts — 旧版插件数据目录一次性迁移
 *
 * 背景（2026-11-10 维度⑤复审）：v4.78–v4.81 的 onload 无条件拼
 * `${configDir}/${manifest.dir}`，而 `manifest.dir` 本身已是 vault 相对路径，
 * 实际把 usage-ledger / writing-stats / knowledge-vectors 等写进了
 * `.obsidian/.obsidian/plugins/...`。路径单源修复后新路径为空，旧数据成了孤儿。
 *
 * 口径：
 * - 只迁移插件自己的 `data/`（JSON/向量缓存），不碰用户 vault；
 * - 目标已存在时不覆盖（幂等）；
 * - 优先整目录 rename（同盘 O(1)），失败再逐文件复制；
 * - 旧目录保留作备份，不删除；
 * - 成功后写完成标记（D3-12）：否则每次 onload 都会重新复制，用户在新目录
 *   删掉的文件（损坏台账/重建过的向量索引）会被旧目录复活。
 */

/** 迁移所需的最小适配器能力（Obsidian DataAdapter 的子集） */
export interface PluginDataAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    rename?(oldPath: string, newPath: string): Promise<void>;
}

/** 迁移结果 */
export interface PluginDataMigrationResult {
    /** 迁移的文件数（整目录 rename 时按目录计 1） */
    migrated: number;
    /** 是否整目录 rename 成功 */
    renamed: boolean;
}

async function copyDirectory(
    adapter: PluginDataAdapter,
    source: string,
    target: string,
): Promise<number> {
    if (!(await adapter.exists(target))) {
        await adapter.mkdir(target).catch(() => undefined);
    }
    const listing = await adapter.list(source);
    let copied = 0;
    for (const file of listing.files) {
        const name = file.split('/').pop() || file;
        const targetFile = `${target}/${name}`;
        if (await adapter.exists(targetFile)) continue;
        await adapter.write(targetFile, await adapter.read(file)); // write-entry-allow: 插件 data/ 内的 JSON/向量缓存
        copied++;
    }
    for (const folder of listing.folders) {
        const name = folder.split('/').pop() || folder;
        copied += await copyDirectory(adapter, folder, `${target}/${name}`);
    }
    return copied;
}

/**
 * 把旧插件根目录下的 `data/` 迁移到当前根目录。
 *
 * @param adapter - vault 适配器
 * @param legacyRoot - 旧插件根目录（vault 相对）
 * @param currentRoot - 当前插件根目录（vault 相对）
 * @returns 迁移结果；无需迁移时 migrated=0
 *
 * @example
 * await migrateLegacyPluginData(adapter, '.obsidian/.obsidian/plugins/novel-writer-ai', '.obsidian/plugins/novel-writer-ai')
 */
export async function migrateLegacyPluginData(
    adapter: PluginDataAdapter,
    legacyRoot: string,
    currentRoot: string,
): Promise<PluginDataMigrationResult> {
    const legacy = String(legacyRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const current = String(currentRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!legacy || !current || legacy === current) return { migrated: 0, renamed: false };

    const legacyData = `${legacy}/data`;
    const currentData = `${current}/data`;
    const marker = `${currentData}/.legacy-migrated.json`;
    try {
        if (!(await adapter.exists(legacyData))) return { migrated: 0, renamed: false };
        // D3-12：已完成过一次迁移就不再重放，避免「新目录删掉的文件被旧目录复活」
        if (await adapter.exists(marker)) return { migrated: 0, renamed: false };
        const writeMarker = async (renamed: boolean): Promise<void> => {
            try {
                // write-entry-allow: 插件 data/ 内的迁移完成标记
                await adapter.write(marker, JSON.stringify({
                    from: legacyData,
                    to: currentData,
                    renamed,
                    at: new Date().toISOString(),
                }));
            } catch {
                // 标记写失败不阻断迁移；下次启动会重试（幂等，目标已存在不覆盖）
            }
        };
        if (!(await adapter.exists(currentData))) {
            await adapter.mkdir(current).catch(() => undefined);
            if (typeof adapter.rename === 'function') {
                try {
                    await adapter.rename(legacyData, currentData);
                    await writeMarker(true);
                    return { migrated: 1, renamed: true };
                } catch {
                    // 跨盘/移动端不支持目录 rename → 回退逐文件复制
                }
            }
        }
        const copied = await copyDirectory(adapter, legacyData, currentData);
        await writeMarker(false);
        return { migrated: copied, renamed: false };
    } catch {
        // 迁移失败不能阻断启动：旧目录仍在，下次 onload 会重试
        return { migrated: 0, renamed: false };
    }
}
