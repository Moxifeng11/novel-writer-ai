import { describe, expect, it } from 'vitest';
import {
    migrateLegacyPluginData,
    type PluginDataAdapter,
} from '../../../shared/plugin-data-migration';

/**
 * 维度⑤复审（2026-11-10）：路径单源修复后，旧版 `.obsidian/.obsidian/plugins/...`
 * 下的 usage-ledger/writing-stats/knowledge-vectors 成了孤儿。这里锁住迁移契约：
 * 整目录 rename 优先、目标已存在不覆盖、幂等、缺旧目录零开销。
 */
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

const LEGACY = '.obsidian/.obsidian/plugins/novel-writer-ai';
const CURRENT = '.obsidian/plugins/novel-writer-ai';

describe('migrateLegacyPluginData — 旧插件数据目录迁移', () => {
    it('旧目录不存在 / 路径相同：零动作', async () => {
        const { adapter } = makeAdapter({});
        expect(await migrateLegacyPluginData(adapter, LEGACY, CURRENT)).toEqual({ migrated: 0, renamed: false });
        expect(await migrateLegacyPluginData(adapter, CURRENT, CURRENT)).toEqual({ migrated: 0, renamed: false });
    });

    it('目标 data 不存在：优先整目录 rename（O(1)），文件落到新路径', async () => {
        const { adapter, store } = makeAdapter({
            [`${LEGACY}/data/usage-ledger.json`]: '{"cost":1}',
            [`${LEGACY}/data/knowledge-vectors/index.json`]: '{"books":[]}',
        });

        const result = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);

        expect(result).toEqual({ migrated: 1, renamed: true });
        expect(store.get(`${CURRENT}/data/usage-ledger.json`)).toBe('{"cost":1}');
        expect(store.get(`${CURRENT}/data/knowledge-vectors/index.json`)).toBe('{"books":[]}');
    });

    it('rename 不可用：逐文件复制且不覆盖目标已有文件', async () => {
        const { adapter, store } = makeAdapter({
            [`${LEGACY}/data/writing-stats.json`]: '{"old":true}',
            [`${LEGACY}/data/usage-ledger.json`]: '{"cost":1}',
            [`${CURRENT}/data/usage-ledger.json`]: '{"cost":999}',
        }, { withRename: false });

        const result = await migrateLegacyPluginData(adapter, LEGACY, CURRENT);

        expect(result.migrated).toBe(1); // usage-ledger 目标已存在 → 跳过
        expect(store.get(`${CURRENT}/data/writing-stats.json`)).toBe('{"old":true}');
        expect(store.get(`${CURRENT}/data/usage-ledger.json`)).toBe('{"cost":999}');
    });

    it('重复调用幂等：第二次不再复制', async () => {
        const { adapter } = makeAdapter({
            [`${LEGACY}/data/writing-stats.json`]: '{"old":true}',
        }, { withRename: false });
        await migrateLegacyPluginData(adapter, LEGACY, CURRENT);
        expect((await migrateLegacyPluginData(adapter, LEGACY, CURRENT)).migrated).toBe(0);
    });
});
