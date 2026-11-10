import { describe, expect, it } from 'vitest';
import { PluginCacheManager } from '../../../shared/plugin-cache';
import { setPluginRootDir } from '../../../shared/paths';

/**
 * 维度①二轮复审（2026-11-10）：`CACHE_FILE` 曾在模块导入期冻结为兜底路径，
 * onload 的 setPluginRootDir 永远晚于 import。自定义 configDir/BRAT 改名时
 * cache 会写到错误目录，布局/实体缓存/欢迎框状态反复丢失。这里锁住「惰性求值」。
 */
function makeAdapter() {
    const files = new Map<string, string>();
    const writes: string[] = [];
    return {
        files,
        writes,
        adapter: {
            exists: async (path: string) => files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`)),
            read: async (path: string) => files.get(path) ?? '',
            write: async (path: string, data: string) => {
                writes.push(path);
                files.set(path, data);
            },
            mkdir: async () => undefined,
        },
    };
}

describe('PluginCacheManager — 缓存路径惰性单源', () => {
    it('setPluginRootDir 晚于模块导入时，save 仍写到注入后的目录', async () => {
        setPluginRootDir('.config/obsidian/plugins/novel-writer-ai');
        const { adapter, writes } = makeAdapter();
        const manager = new PluginCacheManager({ vault: { adapter } } as never);

        await manager.load();
        manager.setPanelLayout({} as never);
        await manager.flush();

        expect(writes).toContain('.config/obsidian/plugins/novel-writer-ai/data/cache.json');
    });

    it('load 从注入目录读取（迁移过去的 cache.json 能被看见）', async () => {
        setPluginRootDir('.obsidian/plugins/obsidian-novel-writer-ai');
        const { adapter, files } = makeAdapter();
        files.set('.obsidian/plugins/obsidian-novel-writer-ai/data/cache.json', JSON.stringify({
            panelLayout: { left: 240 },
        }));
        const manager = new PluginCacheManager({ vault: { adapter } } as never);

        await manager.load();

        expect(manager.getPanelLayout()).toEqual({ left: 240 });
    });
});
