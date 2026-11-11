/**
 * S3-15 / S3-16（安全 r3 第四批）回归：
 * 1. S3-15：设置页不回填密文；更新检查不把密文当 Bearer；重置口令覆盖考据密钥；
 * 2. S3-16：路径 helper 拒绝 `..`/绝对路径/盘符；版本目录 contentType 白名单；
 *    设置深合并拒绝原型键；插件缓存动态键走 own property 且写入不污染原型。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
    DEFAULT_PROVIDERS: {},
}));

import {
    setPluginRootDir,
    pluginRootDirPath,
    resolvePluginRootDir,
    pjContentTypeVersionsDir,
} from '../../../shared/paths';
import { deepMergeSettings } from '../../../core/settings-service';
import { PluginCacheManager } from '../../../shared/plugin-cache';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 记录写盘的最小 adapter；本组测试只关心是否会写出危险内容 */
function makeCache(): PluginCacheManager {
    const adapter = {
        exists: async (): Promise<boolean> => false,
        read: async (): Promise<string> => '',
        write: async (): Promise<void> => undefined,
        mkdir: async (): Promise<void> => undefined,
    };
    return new PluginCacheManager({ vault: { adapter } } as never);
}

describe('S3-16 路径 helper 拒绝越界目录', () => {
    it('setPluginRootDir 忽略 .. / 盘符 / 绝对路径，保留原值', () => {
        setPluginRootDir('.obsidian/plugins/novel-writer-ai');
        const good = pluginRootDirPath();
        expect(good).toBe('.obsidian/plugins/novel-writer-ai');

        for (const bad of ['../../evil', '..', '.', 'C:/Windows', '/etc', '//server/share', 'a/../../b', 'file:///x']) {
            setPluginRootDir(bad);
            expect(pluginRootDirPath(), bad).toBe(good);
        }
    });

    it('setPluginRootDir 接受正常相对目录', () => {
        setPluginRootDir('.obsidian/plugins/novel-writer-ai');
        expect(pluginRootDirPath()).toBe('.obsidian/plugins/novel-writer-ai');
    });

    it('resolvePluginRootDir 对被污染的 manifest.dir 回退到安全根目录', () => {
        setPluginRootDir('.obsidian/plugins/novel-writer-ai');
        const safe = pluginRootDirPath();

        expect(resolvePluginRootDir('.obsidian', '../../evil')).toBe(safe);
        expect(resolvePluginRootDir('.obsidian', 'C:/Windows')).toBe(safe);
        expect(resolvePluginRootDir('.obsidian', '/etc/passwd')).toBe(safe);
        // 正常形态保持原有语义
        expect(resolvePluginRootDir('.obsidian', '.obsidian/plugins/novel-writer-ai'))
            .toBe('.obsidian/plugins/novel-writer-ai');
        expect(resolvePluginRootDir('.obsidian', 'plugins/novel-writer-ai'))
            .toBe('.obsidian/plugins/novel-writer-ai');
    });

    it('版本目录的 contentType 走白名单，越界值回退 chapter', () => {
        for (const bad of ['../../evil', '/etc', 'C:', 'chapter/../../x', '', 'unknown-type']) {
            const dir = pjContentTypeVersionsDir('书A', bad);
            expect(dir.endsWith('/chapter'), `${bad} -> ${dir}`).toBe(true);
            expect(dir).not.toContain('..');
        }
        for (const good of ['chapter', 'outline', 'worldview', 'character', 'setting']) {
            expect(pjContentTypeVersionsDir('书A', good)).toContain(`/${good}`);
        }
    });
});

describe('S3-16 设置深合并拒绝原型键', () => {
    it('__proto__ / constructor / prototype 被忽略，原型未被污染', () => {
        const polluted = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":2}},"prototype":{"polluted3":3},"safe":7}');
        const merged = deepMergeSettings({ safe: 1 } as Record<string, unknown>, polluted) as Record<string, unknown>;

        expect(merged.safe).toBe(7);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
        expect(({} as Record<string, unknown>).polluted3).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    });

    it('正常嵌套合并与数组替换保持原语义', () => {
        const base = { a: { b: 1, c: 2 }, list: [1, 2, 3], keep: 'x' };
        const merged = deepMergeSettings(base, { a: { c: 9 }, list: [4], extra: true });
        expect(merged.a).toEqual({ b: 1, c: 9 });
        expect(merged.list).toEqual([4]);
        expect(merged.keep).toBe('x');
        expect((merged as Record<string, unknown>).extra).toBe(true);
    });
});

describe('S3-16 插件缓存动态键', () => {
    it('读取 __proto__ / constructor / toString 不返回原型成员', () => {
        const cache = makeCache();
        for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
            expect(cache.getEntityCache(key), key).toBeUndefined();
            expect(cache.getEntityEntry(key, 'x.md'), key).toBeUndefined();
        }
    });

    it('写入 __proto__ 不污染全局原型', () => {
        const cache = makeCache();
        cache.updateEntityEntry('__proto__', 'a.md', 1, {}, 'character');
        cache.batchUpdateEntityEntries('constructor', [{ path: 'b.md', mtime: 2, frontmatter: {}, entityType: 'item' }]);

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(cache.getEntityCache('__proto__')).toBeUndefined();
        expect(cache.getEntityCache('constructor')).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'entities')).toBe(false);
    });

    it('正常项目读写仍然工作', () => {
        const cache = makeCache();
        cache.updateEntityEntry('书A', '书A/人物/甲.md', 100, { name: '甲' }, 'character');
        const entry = cache.getEntityEntry('书A', '书A/人物/甲.md');
        expect(entry?.mtime).toBe(100);
        expect(entry?.entityType).toBe('character');
        expect(cache.getEntityCache('书A')?.updatedAt).toBeTruthy();

        cache.clearEntityCache('书A');
        expect(cache.getEntityCache('书A')).toBeUndefined();
    });
});

describe('S3-15 密钥展示与重置清单', () => {
    it('GitHub Token 输入框不回填密文', () => {
        const src = read('ui/settings/general-sections.ts');
        expect(src).toContain('isStoredCiphertext');
        expect(src).toContain('tokenLocked ? \'\' : storedToken');
        expect(src).toContain('口令未解锁，不显示');
    });

    it('更新检查只发送明文令牌（密文视为未配置）', () => {
        const src = read('services/update-checker.ts');
        expect(src).toContain('usableSecret(this.config.githubToken)');
        expect(src).toContain('headers.Authorization = `Bearer ${githubToken}`');
    });

    it('重置口令覆盖 canonResearch.apiKey', () => {
        const src = read('main.ts');
        const start = src.indexOf('async resetKeyPassword(');
        expect(start).toBeGreaterThan(0);
        const body = src.slice(start, start + 2400);
        expect(body).toContain('canonResearch');
        expect(body).toContain('settings.canonResearch.apiKey = await handle(');
    });
});
