import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiLayerCache } from '../../../../shared/multi-layer-cache';
import { MockFileSystem } from '../../../../shared/file-system-port';

describe('MultiLayerCache', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
        fs = new MockFileSystem();
    });

    describe('L1 内存缓存（仅 L1）', () => {
        it('get/set 基本操作', async () => {
            const cache = new MultiLayerCache({ l1MaxSize: 10, autoAdapt: false });
            await cache.set('key1', 'value1');
            expect(await cache.get<string>('key1')).toBe('value1');
        });

        it('未命中返回 null', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            expect(await cache.get('not-exist')).toBeNull();
        });

        it('invalidate 失效指定 key', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            await cache.set('key1', 'value1');
            await cache.invalidate('key1');
            expect(await cache.get('key1')).toBeNull();
        });

        it('invalidateByPrefix 按前缀失效', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            await cache.set('a:1', 1);
            await cache.set('a:2', 2);
            await cache.set('b:1', 3);

            const count = await cache.invalidateByPrefix('a:');
            expect(count).toBe(2);
            expect(await cache.get('a:1')).toBeNull();
            expect(await cache.get('a:2')).toBeNull();
            expect(await cache.get('b:1')).toBe(3);
        });

        it('clear 清空所有缓存', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            await cache.set('key1', 'value1');
            await cache.set('key2', 'value2');
            await cache.clear();
            expect(await cache.get('key1')).toBeNull();
            expect(await cache.get('key2')).toBeNull();
        });
    });

    describe('L1 + L2 双层缓存', () => {
        it('L1 未命中时从 L2 获取并回写到 L1', async () => {
            const cache = new MultiLayerCache({
                l1MaxSize: 5,
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            await cache.set('key1', 'persistent-value');
            expect(cache.isL2Enabled()).toBe(true);

            const l1 = cache.getL1Cache();
            l1.delete('key1');

            expect(await cache.get<string>('key1')).toBe('persistent-value');

            expect(l1.get('key1')).toBe('persistent-value');
        });

        it('L2 也未命中时返回 null（L3 由调用方处理）', async () => {
            const cache = new MultiLayerCache({
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            expect(await cache.get('no-such-key')).toBeNull();
        });
    });

    describe('缓存统计', () => {
        it('记录 L1 命中/未命中', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });

            await cache.set('a', 1);
            await cache.get('a');
            await cache.get('a');
            await cache.get('b');

            const stats = cache.getStats();
            expect(stats.l1.hits).toBe(2);
            expect(stats.l1.misses).toBe(1);
            expect(stats.overall.totalHits).toBe(2);
        });

        it('记录 L2 命中/未命中', async () => {
            const cache = new MultiLayerCache({
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            await cache.set('persisted', 'data');
            cache.getL1Cache().delete('persisted');

            await cache.get('persisted');
            await cache.get('no-such');

            const stats = cache.getStats();
            expect(stats.l2.hits).toBe(1);
            expect(stats.l2.misses).toBe(1);
            expect(stats.l2.enabled).toBe(true);
        });

        it('记录失效次数', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            await cache.set('a', 1);
            await cache.set('b', 2);
            await cache.invalidate('a');
            await cache.invalidateByPrefix('b');

            const stats = cache.getStats();
            expect(stats.overall.totalInvalidations).toBe(2);
        });

        it('resetStats 重置统计数据', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            await cache.set('a', 1);
            await cache.get('a');
            cache.resetStats();

            const stats = cache.getStats();
            expect(stats.l1.hits).toBe(0);
            expect(stats.l1.misses).toBe(0);
            expect(stats.overall.totalInvalidations).toBe(0);
        });
    });

    describe('动态自适应策略', () => {
        it('小项目（<50 实体）：L1=100，L2 关闭', () => {
            const cache = new MultiLayerCache({ autoAdapt: true }, fs);
            cache.setEntityCount(20);

            expect(cache.getProjectSizeTier()).toBe('small');
            expect(cache.isL2Enabled()).toBe(false);
        });

        it('中项目（50-200 实体）：L1=300，L2 关闭', () => {
            const cache = new MultiLayerCache({ autoAdapt: true }, fs);
            cache.setEntityCount(100);

            expect(cache.getProjectSizeTier()).toBe('medium');
            expect(cache.isL2Enabled()).toBe(false);
        });

        it('大项目（>200 实体）：L1=500，启用 L2', () => {
            const cache = new MultiLayerCache({ autoAdapt: true }, fs);
            cache.setEntityCount(300);

            expect(cache.getProjectSizeTier()).toBe('large');
            expect(cache.isL2Enabled()).toBe(true);
        });

        it('动态调整项目规模', () => {
            const cache = new MultiLayerCache({ autoAdapt: true }, fs);

            cache.setEntityCount(20);
            expect(cache.getProjectSizeTier()).toBe('small');
            expect(cache.isL2Enabled()).toBe(false);

            cache.setEntityCount(250);
            expect(cache.getProjectSizeTier()).toBe('large');
            expect(cache.isL2Enabled()).toBe(true);

            cache.setEntityCount(100);
            expect(cache.getProjectSizeTier()).toBe('medium');
        });

        it('autoAdapt=false 时不自动调整', () => {
            const cache = new MultiLayerCache({
                autoAdapt: false,
                l1MaxSize: 50,
                l2Enabled: false,
            }, fs);

            cache.setEntityCount(500);
            expect(cache.getProjectSizeTier()).toBe('small');
        });
    });

    describe('内存压力调整', () => {
        it('低内存压力时不清理', () => {
            const cache = new MultiLayerCache({ l1MaxSize: 100, autoAdapt: false });
            for (let i = 0; i < 50; i++) {
                cache.getL1Cache().set(`key${i}`, i);
            }

            const evicted = cache.adjustForMemoryPressure(0.3);
            expect(evicted).toBe(0);
        });

        it('高内存压力时清理更多缓存', () => {
            const cache = new MultiLayerCache({ l1MaxSize: 100, autoAdapt: false });
            for (let i = 0; i < 100; i++) {
                cache.getL1Cache().set(`key${i}`, i);
            }

            const evicted = cache.adjustForMemoryPressure(0.95);
            expect(evicted).toBeGreaterThan(0);
            expect(cache.getL1Cache().size).toBeLessThan(100);
        });
    });

    describe('源文件路径失效（L2）', () => {
        it('invalidateBySourcePath 失效关联缓存', async () => {
            const cache = new MultiLayerCache({
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            await cache.set('cache1', 'data1', { sourcePath: 'src/file.md' });
            await cache.set('cache2', 'data2', { sourcePath: 'src/other.md' });

            const invalidated = await cache.invalidateBySourcePath('src/file.md');
            expect(invalidated).toBe(1);
        });
    });

    describe('tier 选项', () => {
        it('tier=L1 只写入 L1', async () => {
            const cache = new MultiLayerCache({
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            await cache.set('only-l1', 'value', { tier: 'L1' });
            cache.getL1Cache().delete('only-l1');

            const l2Result = await cache.getL2Cache()?.get('only-l1');
            expect(l2Result).toBeNull();
        });

        it('tier=L2 只写入 L2', async () => {
            const cache = new MultiLayerCache({
                l2Enabled: true,
                l2CacheDir: '.test-cache',
                autoAdapt: false,
            }, fs);

            await cache.set('only-l2', 'value', { tier: 'L2' });
            expect(cache.getL1Cache().has('only-l2')).toBe(false);

            const l2Result = await cache.getL2Cache()?.get<string>('only-l2');
            expect(l2Result).toBe('value');
        });
    });
});
