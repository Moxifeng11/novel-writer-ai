import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LruCache } from '../../../shared/lru-cache';

describe('LruCache', () => {
    describe('基础操作 (get/set/delete/has)', () => {
        it('设置后可以获取', () => {
            const cache = new LruCache<string, number>();
            cache.set('a', 1);
            expect(cache.get('a')).toBe(1);
        });

        it('获取不存在的键返回 undefined', () => {
            const cache = new LruCache<string, number>();
            expect(cache.get('not-exist')).toBeUndefined();
        });

        it('覆盖已存在的键', () => {
            const cache = new LruCache<string, number>();
            cache.set('a', 1);
            cache.set('a', 2);
            expect(cache.get('a')).toBe(2);
            expect(cache.size).toBe(1);
        });

        it('has 检查键是否存在', () => {
            const cache = new LruCache<string, number>();
            expect(cache.has('a')).toBe(false);
            cache.set('a', 1);
            expect(cache.has('a')).toBe(true);
        });

        it('delete 删除键', () => {
            const cache = new LruCache<string, number>();
            cache.set('a', 1);
            expect(cache.delete('a')).toBe(true);
            expect(cache.has('a')).toBe(false);
            expect(cache.delete('a')).toBe(false);
        });

        it('clear 清空所有缓存', () => {
            const cache = new LruCache<string, number>();
            cache.set('a', 1);
            cache.set('b', 2);
            expect(cache.size).toBe(2);
            cache.clear();
            expect(cache.size).toBe(0);
        });

        it('size 返回缓存条目数', () => {
            const cache = new LruCache<string, number>();
            expect(cache.size).toBe(0);
            cache.set('a', 1);
            expect(cache.size).toBe(1);
            cache.set('b', 2);
            expect(cache.size).toBe(2);
        });
    });

    describe('LRU 淘汰策略', () => {
        it('超过 maxSize 时淘汰最久未使用的条目', () => {
            const cache = new LruCache<string, number>({ maxSize: 3 });

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);
            expect(cache.size).toBe(3);

            cache.set('d', 4);
            expect(cache.size).toBe(3);
            expect(cache.has('a')).toBe(false);
            expect(cache.has('b')).toBe(true);
            expect(cache.has('c')).toBe(true);
            expect(cache.has('d')).toBe(true);
        });

        it('get 操作更新访问顺序', () => {
            const cache = new LruCache<string, number>({ maxSize: 3 });

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            cache.get('a');

            cache.set('d', 4);

            expect(cache.has('a')).toBe(true);
            expect(cache.has('b')).toBe(false);
            expect(cache.has('c')).toBe(true);
            expect(cache.has('d')).toBe(true);
        });

        it('set 已存在的键更新访问顺序', () => {
            const cache = new LruCache<string, number>({ maxSize: 3 });

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            cache.set('a', 10);

            cache.set('d', 4);

            expect(cache.has('a')).toBe(true);
            expect(cache.get('a')).toBe(10);
            expect(cache.has('b')).toBe(false);
        });

        it('maxSize 默认为 100', () => {
            const cache = new LruCache<string, number>();
            for (let i = 0; i < 100; i++) {
                cache.set(`key-${i}`, i);
            }
            expect(cache.size).toBe(100);
            cache.set('extra', 999);
            expect(cache.size).toBe(100);
            expect(cache.has('key-0')).toBe(false);
        });
    });

    describe('TTL 过期策略', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('未过期时可以正常获取', () => {
            const cache = new LruCache<string, number>({ ttlMs: 1000 });
            cache.set('a', 1);
            vi.advanceTimersByTime(500);
            expect(cache.get('a')).toBe(1);
        });

        it('过期后返回 undefined', () => {
            const cache = new LruCache<string, number>({ ttlMs: 1000 });
            cache.set('a', 1);
            vi.advanceTimersByTime(1001);
            expect(cache.get('a')).toBeUndefined();
        });

        it('has 对过期条目返回 false', () => {
            const cache = new LruCache<string, number>({ ttlMs: 1000 });
            cache.set('a', 1);
            vi.advanceTimersByTime(1001);
            expect(cache.has('a')).toBe(false);
        });

        it('ttlMs 为 0 表示永不过期', () => {
            const cache = new LruCache<string, number>({ ttlMs: 0 });
            cache.set('a', 1);
            vi.advanceTimersByTime(999999);
            expect(cache.get('a')).toBe(1);
        });

        it('未设置 ttlMs 时永不过期', () => {
            const cache = new LruCache<string, number>();
            cache.set('a', 1);
            vi.advanceTimersByTime(999999);
            expect(cache.get('a')).toBe(1);
        });

        it('pruneExpired 清理所有过期条目', () => {
            const cache = new LruCache<string, number>({ ttlMs: 1000 });
            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            vi.advanceTimersByTime(500);
            cache.set('c', 30);

            vi.advanceTimersByTime(600);

            const pruned = cache.pruneExpired();
            expect(pruned).toBe(2);
            expect(cache.size).toBe(1);
            expect(cache.has('a')).toBe(false);
            expect(cache.has('b')).toBe(false);
            expect(cache.has('c')).toBe(true);
        });
    });

    describe('按前缀删除', () => {
        it('deleteByPrefix 删除匹配前缀的所有条目', () => {
            const cache = new LruCache<string, number>();
            cache.set('dir/a.md', 1);
            cache.set('dir/b.md', 2);
            cache.set('other/c.md', 3);

            const deleted = cache.deleteByPrefix('dir/');
            expect(deleted).toBe(2);
            expect(cache.has('dir/a.md')).toBe(false);
            expect(cache.has('dir/b.md')).toBe(false);
            expect(cache.has('other/c.md')).toBe(true);
        });

        it('deleteByPrefix 无匹配时返回 0', () => {
            const cache = new LruCache<string, number>();
            cache.set('a.md', 1);
            const deleted = cache.deleteByPrefix('not-exist/');
            expect(deleted).toBe(0);
        });
    });

    describe('keys 方法', () => {
        it('返回所有键（按访问顺序）', () => {
            const cache = new LruCache<string, number>({ maxSize: 5 });
            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            expect(cache.keys()).toEqual(['a', 'b', 'c']);

            cache.get('a');
            expect(cache.keys()).toEqual(['b', 'c', 'a']);
        });
    });
});
