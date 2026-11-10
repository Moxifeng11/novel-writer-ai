/**
 * D3-12（维度② r3）：旧插件数据目录迁移必须留完成标记。
 *
 * 复制模式旧目录永久保留且无标记 → 每次 onload 重放，用户在新 data/ 里删掉的
 * 文件（损坏台账、重建的向量索引）会被旧目录复活。
 */

import { describe, expect, it } from 'vitest';
import { migrateLegacyPluginData, type PluginDataAdapter } from '../../../shared/plugin-data-migration';

const LEGACY = '.obsidian/.obsidian/plugins/novel-writer-ai';
const CURRENT = '.obsidian/plugins/novel-writer-ai';

function makeAdapter(files: Record<string, string>, opts: { withRename?: boolean } = {}) {
    const store = new Map(Object.entries(files));
    const adapter: PluginDataAdapter = {
        exists: async (path) => store.has(path) || [...store.keys()].some((key) => key.startsWith(`${path}/`)),
        mkdir: async () => undefined,
        read: async (path) => {
            const value = store.get(path);
            if (value === undefined) throw new Error(`missing ${path}`);
            return value;
        },
        write: async (path, data) => { store.set(path, data); },
        list: async (path) => {
            const prefix = `${path}/`;
            const files: string[] = [];
            const folders = new Set<string>();
            for (const key of store.keys()) {
                if (!key.startsWith(prefix)) continue;
                const rest = key.slice(prefix.length);
                if (rest.includes('/')) folders.add(`${path}/${rest.split('/')[0]}`);
                else files.push(key);
            }
            return { files, folders: [...folders] };
        },
    };
    if (opts.withRename !== false) {
        adapter.rename = async (oldPath, newPath) => {
            const moved: Array<[string, string]> = [];
            for (const [key, value] of store) {
                if (key === oldPath || key.startsWith(`${oldPath}/`)) {
                    moved.push([newPath + key.slice(oldPath.length), value]);
                }
            }
            if (moved.length === 0) throw new Error('rename source missing');
            for (const [key] of moved) store.delete(key);
            for (const [key, value] of moved) store.set(key, value);
        };
    }
    return { adapter, store };
}

describe('migrateLegacyPluginData — 完成标记（D3-12）', () => {
    it('复制成功后写标记，之后新目录删掉的文件不会被旧目录复活', async () => {
        const { adapter, store } = makeAdapter({
            [`${LEGACY}/data/writing-stats.json`]: '{"old":true}',
            [`${LEGACY}/data/usage-ledger.json`]: '{"cost":1}',
        }, { withRename: false });

        const first = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);
        expect(first.migrated).toBe(2);
        expect(store.has(`${CURRENT}/data/.legacy-migrated.json`)).toBe(true);

        // 用户在新目录删掉损坏台账
        store.delete(`${CURRENT}/data/writing-stats.json`);
        const second = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);

        expect(second).toEqual({ migrated: 0, renamed: false });
        expect(store.has(`${CURRENT}/data/writing-stats.json`)).toBe(false);
    });

    it('整目录 rename 成功同样写标记', async () => {
        const { adapter, store } = makeAdapter({
            [`${LEGACY}/data/usage-ledger.json`]: '{"cost":1}',
        });

        const result = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);
        expect(result).toEqual({ migrated: 1, renamed: true });
        expect(store.has(`${CURRENT}/data/.legacy-migrated.json`)).toBe(true);
    });

    it('迁移失败（无标记）时下次仍会重试', async () => {
        const { adapter, store } = makeAdapter({}, { withRename: false });
        store.set(`${LEGACY}/data/usage-ledger.json`, '{"cost":1}');
        // 让 copy 阶段读失败
        adapter.read = async () => { throw new Error('io'); };

        const first = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);
        expect(first.migrated).toBe(0);
        expect(store.has(`${CURRENT}/data/.legacy-migrated.json`)).toBe(false);

        adapter.read = async (path: string) => store.get(path) ?? '';
        const second = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);
        expect(second.migrated).toBe(1);
        expect(store.has(`${CURRENT}/data/.legacy-migrated.json`)).toBe(true);
    });
});
