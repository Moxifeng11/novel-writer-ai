import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreloadManager } from '../../../../engine/cache/preload-manager';
import { Chapter } from '../../../../engine/repository/domain/aggregates';

function createMockChapter(id: string, volN: number, chapN: number, title: string = `第${chapN}章`): Chapter {
    return Chapter.create(id, title, volN, chapN, `/test/v${volN}/第${chapN}章_正文.md`, '测试内容');
}

function createMockChapterRepository(chapters: Chapter[] = []) {
    const chapterMap = new Map(chapters.map(c => [c.id, c]));
    return {
        findById: vi.fn(async (id: string) => chapterMap.get(id) || null),
        findAll: vi.fn(async () => Array.from(chapterMap.values())),
        save: vi.fn(async (entity: Chapter) => {
            chapterMap.set(entity.id, entity);
            return entity;
        }),
        delete: vi.fn(async (id: string) => chapterMap.delete(id)),
        exists: vi.fn(async (id: string) => chapterMap.has(id)),
    };
}

describe('PreloadManager', () => {
    let preloadManager: PreloadManager;

    beforeEach(() => {
        preloadManager = new PreloadManager({
            enabled: true,
            chapterCacheSize: 10,
            entityCacheSize: 20,
            idleQueueMaxSize: 10,
            adjacentChapterCount: 1,
            behaviorHistoryMaxSize: 10,
        });
    });

    describe('基础配置', () => {
        it('默认启用状态', () => {
            const pm = new PreloadManager();
            expect(pm.isEnabled()).toBe(true);
        });

        it('enable/disable 切换', () => {
            preloadManager.disable();
            expect(preloadManager.isEnabled()).toBe(false);

            preloadManager.enable();
            expect(preloadManager.isEnabled()).toBe(true);
        });

        it('setOptions 更新配置', () => {
            preloadManager.setOptions({ adjacentChapterCount: 2 });
            const options = preloadManager.getOptions();
            expect(options.adjacentChapterCount).toBe(2);
        });
    });

    describe('章节缓存', () => {
        it('cacheChapter / getCachedChapter 基本操作', () => {
            const chapter = createMockChapter('v1-c1', 1, 1);
            preloadManager.cacheChapter(chapter);

            const cached = preloadManager.getCachedChapter('v1-c1');
            expect(cached).not.toBeNull();
            expect(cached!.id).toBe('v1-c1');
            expect(cached!.title).toBe('第1章');
        });

        it('getCachedChapter 未命中返回 null', () => {
            const result = preloadManager.getCachedChapter('not-exist');
            expect(result).toBeNull();
        });

        it('invalidateChapter 失效缓存', () => {
            const chapter = createMockChapter('v1-c1', 1, 1);
            preloadManager.cacheChapter(chapter);
            expect(preloadManager.getCachedChapter('v1-c1')).not.toBeNull();

            preloadManager.invalidateChapter('v1-c1');
            expect(preloadManager.getCachedChapter('v1-c1')).toBeNull();
        });

        it('缓存命中统计正确', () => {
            const chapter = createMockChapter('v1-c1', 1, 1);
            preloadManager.cacheChapter(chapter);

            preloadManager.getCachedChapter('v1-c1');
            preloadManager.getCachedChapter('v1-c1');
            preloadManager.getCachedChapter('not-exist');

            const stats = preloadManager.getStats();
            expect(stats.chapterCacheHits).toBe(2);
            expect(stats.chapterCacheMisses).toBe(1);
        });
    });

    describe('preloadAdjacentChapters', () => {
        it('禁用时返回空数组', async () => {
            preloadManager.disable();
            const result = await preloadManager.preloadAdjacentChapters('v1-c5');
            expect(result).toEqual([]);
        });

        it('未设置 repository 时返回空数组', async () => {
            const result = await preloadManager.preloadAdjacentChapters('v1-c5');
            expect(result).toEqual([]);
        });

        it('预加载相邻章节（前后各1章）', async () => {
            const ch4 = createMockChapter('v1-c4', 1, 4);
            const ch5 = createMockChapter('v1-c5', 1, 5);
            const ch6 = createMockChapter('v1-c6', 1, 6);

            const mockRepo = createMockChapterRepository([ch4, ch5, ch6]);
            preloadManager.setChapterRepository(mockRepo as any);

            preloadManager.cacheChapter(ch5);

            const preloaded = await preloadManager.preloadAdjacentChapters('v1-c5');

            expect(preloaded).toContain('v1-c4');
            expect(preloaded).toContain('v1-c6');
            expect(preloaded.length).toBe(2);

            expect(preloadManager.getCachedChapter('v1-c4')).not.toBeNull();
            expect(preloadManager.getCachedChapter('v1-c6')).not.toBeNull();
        });

        it('已缓存的章节不重复预加载', async () => {
            const ch4 = createMockChapter('v1-c4', 1, 4);
            const ch5 = createMockChapter('v1-c5', 1, 5);
            const ch6 = createMockChapter('v1-c6', 1, 6);

            const mockRepo = createMockChapterRepository([ch4, ch5, ch6]);
            preloadManager.setChapterRepository(mockRepo as any);

            preloadManager.cacheChapter(ch4);
            preloadManager.cacheChapter(ch5);

            const preloaded = await preloadManager.preloadAdjacentChapters('v1-c5');
            expect(preloaded).toEqual(['v1-c6']);
        });

        it('第一章时只预加载下一章', async () => {
            const ch1 = createMockChapter('v1-c1', 1, 1);
            const ch2 = createMockChapter('v1-c2', 1, 2);

            const mockRepo = createMockChapterRepository([ch1, ch2]);
            preloadManager.setChapterRepository(mockRepo as any);

            const preloaded = await preloadManager.preloadAdjacentChapters('v1-c1');
            expect(preloaded).toContain('v1-c2');
            expect(preloaded.length).toBe(1);
        });

        it('无效的章节 ID 返回空数组', async () => {
            const result = await preloadManager.preloadAdjacentChapters('invalid-id');
            expect(result).toEqual([]);
        });
    });

    describe('实体懒加载', () => {
        it('registerEntityLoader + lazyLoadEntity', async () => {
            const mockLoader = vi.fn(async (id: string) => {
                return { id, name: `实体${id}` };
            });

            preloadManager.registerEntityLoader('character', mockLoader);

            const result = await preloadManager.lazyLoadEntity<{ id: string; name: string }>('character', 'char-1');
            expect(result).not.toBeNull();
            expect(result!.id).toBe('char-1');
            expect(mockLoader).toHaveBeenCalledTimes(1);

            const cached = await preloadManager.lazyLoadEntity<{ id: string; name: string }>('character', 'char-1');
            expect(cached).not.toBeNull();
            expect(mockLoader).toHaveBeenCalledTimes(1);
        });

        it('lazyLoadEntities 批量加载', async () => {
            const mockLoader = vi.fn(async (id: string) => {
                if (id === 'missing') return null;
                return { id, name: `实体${id}` };
            });

            preloadManager.registerEntityLoader('character', mockLoader);

            const results = await preloadManager.lazyLoadEntities<{ id: string }>('character', ['c1', 'c2', 'missing']);
            expect(results.length).toBe(2);
            expect(results.map(r => r.id)).toContain('c1');
            expect(results.map(r => r.id)).toContain('c2');
        });

        it('未注册的实体类型返回 null', async () => {
            const result = await preloadManager.lazyLoadEntity('unknown', 'id-1');
            expect(result).toBeNull();
        });

        it('invalidateEntity 失效单个实体', async () => {
            let callCount = 0;
            const mockLoader = vi.fn(async (id: string) => {
                callCount++;
                return { id, value: callCount };
            });

            preloadManager.registerEntityLoader('test', mockLoader);

            await preloadManager.lazyLoadEntity('test', 'id-1');
            expect(callCount).toBe(1);

            preloadManager.invalidateEntity('test', 'id-1');
            await preloadManager.lazyLoadEntity('test', 'id-1');
            expect(callCount).toBe(2);
        });

        it('invalidateEntityType 失效全部实体', async () => {
            let callCount = 0;
            const mockLoader = vi.fn(async (id: string) => {
                callCount++;
                return { id };
            });

            preloadManager.registerEntityLoader('test', mockLoader);

            await preloadManager.lazyLoadEntity('test', 'id-1');
            await preloadManager.lazyLoadEntity('test', 'id-2');
            expect(callCount).toBe(2);

            preloadManager.invalidateEntityType('test');
            await preloadManager.lazyLoadEntity('test', 'id-1');
            expect(callCount).toBe(3);
        });

        it('禁用时仍然加载但不使用缓存', async () => {
            let callCount = 0;
            const mockLoader = vi.fn(async (id: string) => {
                callCount++;
                return { id };
            });

            preloadManager.registerEntityLoader('test', mockLoader);
            preloadManager.disable();

            await preloadManager.lazyLoadEntity('test', 'id-1');
            await preloadManager.lazyLoadEntity('test', 'id-1');
            expect(callCount).toBe(2);
        });
    });

    describe('空闲任务队列', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('enqueueIdleTask 添加任务', () => {
            const taskId = preloadManager.enqueueIdleTask({
                id: 'task-1',
                priority: 1,
                execute: () => {},
                description: '测试任务',
            });

            expect(taskId).toBe('task-1');
            expect(preloadManager.getIdleQueueSize()).toBe(1);
        });

        it('cancelIdleTask 取消任务', () => {
            preloadManager.enqueueIdleTask({
                id: 'task-1',
                priority: 1,
                execute: () => {},
            });

            const result = preloadManager.cancelIdleTask('task-1');
            expect(result).toBe(true);
            expect(preloadManager.getIdleQueueSize()).toBe(0);
        });

        it('clearIdleQueue 清空队列', () => {
            for (let i = 0; i < 5; i++) {
                preloadManager.enqueueIdleTask({
                    id: `task-${i}`,
                    priority: i,
                    execute: () => {},
                });
            }

            preloadManager.clearIdleQueue();
            expect(preloadManager.getIdleQueueSize()).toBe(0);
        });

        it('任务按优先级排序', () => {
            preloadManager.enqueueIdleTask({ id: 'low', priority: 1, execute: () => {} });
            preloadManager.enqueueIdleTask({ id: 'high', priority: 10, execute: () => {} });
            preloadManager.enqueueIdleTask({ id: 'mid', priority: 5, execute: () => {} });

            expect(preloadManager.getIdleQueueSize()).toBe(3);
        });

        it('超过队列大小时丢弃最低优先级任务', () => {
            const pm = new PreloadManager({ idleQueueMaxSize: 3 });

            for (let i = 0; i < 5; i++) {
                pm.enqueueIdleTask({
                    id: `task-${i}`,
                    priority: i,
                    execute: () => {},
                });
            }

            expect(pm.getIdleQueueSize()).toBe(3);
        });

        it('禁用时任务不执行但不报错', () => {
            preloadManager.disable();
            const taskId = preloadManager.enqueueIdleTask({
                id: 'task-1',
                priority: 1,
                execute: () => {},
            });
            expect(taskId).toBe('task-1');
        });
    });

    describe('行为预测', () => {
        it('recordBehavior 记录行为', () => {
            preloadManager.recordBehavior({ action: 'navigate', chapterId: 'v1-c1' });
            preloadManager.recordBehavior({ action: 'read', chapterId: 'v1-c1', durationMs: 1000 });

            const stats = preloadManager.getStats();
            expect(stats.predictionsTotal).toBe(0);
        });

        it('predictNextAction 导航时预加载相邻章节', async () => {
            const ch1 = createMockChapter('v1-c1', 1, 1);
            const ch2 = createMockChapter('v1-c2', 1, 2);
            const ch3 = createMockChapter('v1-c3', 1, 3);

            const mockRepo = createMockChapterRepository([ch1, ch2, ch3]);
            preloadManager.setChapterRepository(mockRepo as any);

            const result = await preloadManager.predictNextAction({
                action: 'navigate',
                chapterId: 'v1-c2',
            });

            expect(result.predicted.length).toBeGreaterThan(0);
            expect(result.prewarmed.length).toBeGreaterThan(0);
        });

        it('禁用时预测返回空', async () => {
            preloadManager.disable();
            const result = await preloadManager.predictNextAction({
                action: 'navigate',
                chapterId: 'v1-c2',
            });

            expect(result.predicted).toEqual([]);
            expect(result.prewarmed).toEqual([]);
        });
    });

    describe('统计信息', () => {
        it('getStats 返回完整统计', () => {
            const stats = preloadManager.getStats();
            expect(stats).toHaveProperty('chapterCacheHits');
            expect(stats).toHaveProperty('chapterCacheMisses');
            expect(stats).toHaveProperty('entityCacheHits');
            expect(stats).toHaveProperty('entityCacheMisses');
            expect(stats).toHaveProperty('idleTasksExecuted');
            expect(stats).toHaveProperty('predictionsHit');
            expect(stats).toHaveProperty('predictionsTotal');
        });

        it('getChapterCacheStats 返回缓存统计', () => {
            const chapter = createMockChapter('v1-c1', 1, 1);
            preloadManager.cacheChapter(chapter);

            preloadManager.getCachedChapter('v1-c1');
            preloadManager.getCachedChapter('not-exist');

            const stats = preloadManager.getChapterCacheStats();
            expect(stats.size).toBe(1);
            expect(stats.maxSize).toBe(10);
            expect(stats.hitRate).toBe(0.5);
        });

        it('resetStats 重置统计', () => {
            const chapter = createMockChapter('v1-c1', 1, 1);
            preloadManager.cacheChapter(chapter);
            preloadManager.getCachedChapter('v1-c1');
            preloadManager.getCachedChapter('not-exist');

            preloadManager.resetStats();
            const stats = preloadManager.getStats();
            expect(stats.chapterCacheHits).toBe(0);
            expect(stats.chapterCacheMisses).toBe(0);
        });
    });
});
