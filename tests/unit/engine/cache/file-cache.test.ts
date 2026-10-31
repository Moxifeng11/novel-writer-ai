import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileCache } from '../../../../shared/file-cache';
import { MockFileSystem } from '../../../../shared/file-system-port';

describe('FileCache', () => {
    let fs: MockFileSystem;
    let cache: FileCache;

    beforeEach(() => {
        fs = new MockFileSystem();
        cache = new FileCache(fs, {
            cacheDir: '.test-cache',
            ttlMs: 60 * 1000,
            maxFiles: 100,
        });
    });

    describe('基础操作 (get/set/delete/has)', () => {
        it('设置后可以获取', async () => {
            await cache.set('key1', { name: 'test', value: 42 });
            const result = await cache.get<{ name: string; value: number }>('key1');
            expect(result).toEqual({ name: 'test', value: 42 });
        });

        it('获取不存在的键返回 null', async () => {
            const result = await cache.get('not-exist');
            expect(result).toBeNull();
        });

        it('覆盖已存在的键', async () => {
            await cache.set('key1', 'v1');
            await cache.set('key1', 'v2');
            const result = await cache.get<string>('key1');
            expect(result).toBe('v2');
            expect(cache.size).toBe(1);
        });

        it('has 检查键是否存在', async () => {
            expect(await cache.has('key1')).toBe(false);
            await cache.set('key1', 'value');
            expect(await cache.has('key1')).toBe(true);
        });

        it('delete 删除键', async () => {
            await cache.set('key1', 'value');
            const deleted = await cache.delete('key1');
            expect(deleted).toBe(true);
            expect(await cache.has('key1')).toBe(false);
            expect(await cache.delete('key1')).toBe(false);
        });

        it('clear 清空所有缓存', async () => {
            await cache.set('a', 1);
            await cache.set('b', 2);
            expect(cache.size).toBe(2);
            await cache.clear();
            expect(cache.size).toBe(0);
        });

        it('size 返回缓存条目数', async () => {
            expect(cache.size).toBe(0);
            await cache.set('a', 1);
            expect(cache.size).toBe(1);
            await cache.set('b', 2);
            expect(cache.size).toBe(2);
        });
    });

    describe('TTL 过期策略', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('未过期时可以正常获取', async () => {
            cache = new FileCache(fs, { ttlMs: 1000, cacheDir: '.test-cache' });
            await cache.set('a', 1);
            vi.advanceTimersByTime(500);
            expect(await cache.get('a')).toBe(1);
        });

        it('过期后返回 null', async () => {
            cache = new FileCache(fs, { ttlMs: 1000, cacheDir: '.test-cache' });
            await cache.set('a', 1);
            vi.advanceTimersByTime(1001);
            expect(await cache.get('a')).toBeNull();
        });

        it('ttlMs 为 0 表示永不过期', async () => {
            cache = new FileCache(fs, { ttlMs: 0, cacheDir: '.test-cache' });
            await cache.set('a', 1);
            vi.advanceTimersByTime(999999);
            expect(await cache.get('a')).toBe(1);
        });

        it('pruneExpired 清理所有过期条目', async () => {
            cache = new FileCache(fs, { ttlMs: 1000, cacheDir: '.test-cache' });
            await cache.set('a', 1);
            await cache.set('b', 2);
            await cache.set('c', 3);

            vi.advanceTimersByTime(500);
            await cache.set('c', 30);

            vi.advanceTimersByTime(600);

            const pruned = await cache.pruneExpired();
            expect(pruned).toBe(2);
            expect(cache.size).toBe(1);
            expect(await cache.has('a')).toBe(false);
            expect(await cache.has('b')).toBe(false);
            expect(await cache.has('c')).toBe(true);
        });
    });

    describe('按前缀删除', () => {
        it('deleteByPrefix 删除匹配前缀的所有条目', async () => {
            await cache.set('dir/a.md', 1);
            await cache.set('dir/b.md', 2);
            await cache.set('other/c.md', 3);

            const deleted = await cache.deleteByPrefix('dir/');
            expect(deleted).toBe(2);
            expect(await cache.has('dir/a.md')).toBe(false);
            expect(await cache.has('dir/b.md')).toBe(false);
            expect(await cache.has('other/c.md')).toBe(true);
        });
    });

    describe('源文件 mtime 失效', () => {
        it('invalidateBySourcePath 按源文件路径失效', async () => {
            await cache.set('key1', 'value1', { sourcePath: 'src/file1.md', sourceMtime: 1000 });
            await cache.set('key2', 'value2', { sourcePath: 'src/file2.md', sourceMtime: 1000 });
            await cache.set('key3', 'value3', { sourcePath: 'src/file1.md', sourceMtime: 1000 });

            const invalidated = cache.invalidateBySourcePath('src/file1.md');
            expect(invalidated).toBe(2);
            expect(await cache.has('key1')).toBe(false);
            expect(await cache.has('key2')).toBe(true);
            expect(await cache.has('key3')).toBe(false);
        });
    });

    describe('文件损坏恢复', () => {
        it('损坏的缓存文件自动删除并返回 null', async () => {
            await cache.set('good-key', { valid: true });
            expect(await cache.get('good-key')).toEqual({ valid: true });

            fs.setFile('.test-cache/bad-key.json', 'this is not valid json {{{');
            const indexData = JSON.stringify([['bad-key', {
                value: null,
                createdAt: Date.now(),
                accessedAt: Date.now(),
                size: 100,
            }]]);
            fs.setFile('.test-cache/index.json', indexData);

            cache = new FileCache(fs, { cacheDir: '.test-cache', ttlMs: 60 * 1000 });
            const result = await cache.get('bad-key');
            expect(result).toBeNull();
        });
    });

    describe('容量限制', () => {
        it('超过 maxFiles 时淘汰最久未访问的条目', async () => {
            cache = new FileCache(fs, { cacheDir: '.test-cache', maxFiles: 3, ttlMs: 0 });

            await cache.set('a', 1);
            await cache.set('b', 2);
            await cache.set('c', 3);
            expect(cache.size).toBe(3);

            await cache.get('a');

            await cache.set('d', 4);
            expect(cache.size).toBeLessThanOrEqual(3);
        });
    });

    describe('keys 方法', () => {
        it('返回所有键', async () => {
            await cache.set('a', 1);
            await cache.set('b', 2);
            await cache.set('c', 3);

            const keys = cache.keys();
            expect(keys).toHaveLength(3);
            expect(keys).toContain('a');
            expect(keys).toContain('b');
            expect(keys).toContain('c');
        });
    });

    describe('totalSizeBytes', () => {
        it('返回缓存内容总字节数', async () => {
            await cache.set('a', 'hello');
            await cache.set('b', { nested: 'world' });

            const size = cache.totalSizeBytes;
            expect(size).toBeGreaterThan(0);
        });
    });
});
