import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import { BaseMarkdownRepository } from '../../../../engine/repository/base-markdown-repository';
import { parseFrontmatter } from '../../../../shared/frontmatter';

// ============================================================
// 测试用实体
// ============================================================

interface TestEntity {
    id: string;
    name: string;
    value: number;
    tags: string[];
}

// ============================================================
// 测试用 Repository 实现
// ============================================================

class TestRepository extends BaseMarkdownRepository<TestEntity, string> {
    protected idFromEntity(entity: TestEntity): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return `test-entities/${id}.md`;
    }

    protected deserialize(content: string, filePath: string): TestEntity {
        const fm = parseFrontmatter(content);
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
        return {
            id: fm.id || filePath.split('/').pop()?.replace('.md', '') || '',
            name: fm.name || '',
            value: parseInt(fm.value || '0', 10),
            tags: fm.tags ? fm.tags.split(',').map(t => t.trim()) : [],
        };
    }

    protected serialize(entity: TestEntity): string {
        const fm = [
            '---',
            `id: ${entity.id}`,
            `name: ${entity.name}`,
            `value: ${entity.value}`,
            `tags: ${entity.tags.join(', ')}`,
            '---',
            '',
            `# ${entity.name}`,
            '',
            `Value: ${entity.value}`,
        ].join('\n');
        return fm;
    }

    protected sampleId(): string {
        return 'sample';
    }
}

// ============================================================
// 测试用例
// ============================================================

describe('BaseMarkdownRepository', () => {
    let fs: MockFileSystem;
    let repo: TestRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new TestRepository(fs, { cacheEnabled: false });
    });

    // ── CRUD 基础操作 ─────────────────────────────────────────

    describe('save / findById', () => {
        it('保存新实体后可以通过 ID 查找', async () => {
            const entity: TestEntity = {
                id: 'test-1',
                name: '测试实体',
                value: 42,
                tags: ['tag1', 'tag2'],
            };

            const saved = await repo.save(entity);
            expect(saved).toEqual(entity);

            const found = await repo.findById('test-1');
            expect(found).not.toBeNull();
            expect(found?.id).toBe('test-1');
            expect(found?.name).toBe('测试实体');
            expect(found?.value).toBe(42);
            expect(found?.tags).toEqual(['tag1', 'tag2']);
        });

        it('更新已存在的实体', async () => {
            const entity: TestEntity = {
                id: 'test-1',
                name: '旧名称',
                value: 10,
                tags: ['old'],
            };

            await repo.save(entity);

            const updated: TestEntity = {
                id: 'test-1',
                name: '新名称',
                value: 20,
                tags: ['new'],
            };

            const saved = await repo.save(updated);
            expect(saved.name).toBe('新名称');

            const found = await repo.findById('test-1');
            expect(found?.name).toBe('新名称');
            expect(found?.value).toBe(20);
        });

        it('查找不存在的 ID 返回 null', async () => {
            const found = await repo.findById('not-exist');
            expect(found).toBeNull();
        });
    });

    describe('findAll', () => {
        it('查找所有实体', async () => {
            await repo.save({ id: 'a', name: 'A', value: 1, tags: [] });
            await repo.save({ id: 'b', name: 'B', value: 2, tags: [] });
            await repo.save({ id: 'c', name: 'C', value: 3, tags: [] });

            const all = await repo.findAll();
            expect(all.length).toBe(3);
            const ids = all.map(e => e.id).sort();
            expect(ids).toEqual(['a', 'b', 'c']);
        });

        it('空目录返回空数组', async () => {
            const all = await repo.findAll();
            expect(all).toEqual([]);
        });
    });

    describe('delete', () => {
        it('删除已存在的实体返回 true', async () => {
            await repo.save({ id: 'to-delete', name: '将被删除', value: 0, tags: [] });
            expect(await repo.exists('to-delete')).toBe(true);

            const result = await repo.delete('to-delete');
            expect(result).toBe(true);
            expect(await repo.exists('to-delete')).toBe(false);
        });

        it('删除不存在的实体返回 false', async () => {
            const result = await repo.delete('not-exist');
            expect(result).toBe(false);
        });
    });

    describe('exists', () => {
        it('存在返回 true', async () => {
            await repo.save({ id: 'exist', name: '存在', value: 1, tags: [] });
            expect(await repo.exists('exist')).toBe(true);
        });

        it('不存在返回 false', async () => {
            expect(await repo.exists('not-exist')).toBe(false);
        });
    });

    // ── 缓存功能 ──────────────────────────────────────────────

    describe('LRU 缓存', () => {
        let cachedRepo: TestRepository;

        beforeEach(() => {
            cachedRepo = new TestRepository(fs, {
                cacheEnabled: true,
                cacheMaxSize: 10,
                cacheTtlMs: 0,
            });

        });

        it('首次读取从文件系统加载', async () => {
            const entity = { id: 'cached', name: '缓存测试', value: 100, tags: [] };
            const content = [
                '---',
                `id: ${entity.id}`,
                `name: ${entity.name}`,
                `value: ${entity.value}`,
                `tags: ${entity.tags.join(', ')}`,
                '---',
                '',
                `# ${entity.name}`,
                '',
                `Value: ${entity.value}`,
            ].join('\n');
            await fs.mkdir('test-entities');
            await fs.write('test-entities/cached.md', content);

            const readCount = { count: 0 };
            const originalRead = fs.read.bind(fs);
            vi.spyOn(fs, 'read').mockImplementation(async (path: string) => {
                readCount.count++;
                return originalRead(path);
            });

            await cachedRepo.findById('cached');
            expect(readCount.count).toBe(1);
        });

        it('二次读取命中缓存，不访问文件系统', async () => {
            const entity = { id: 'cached', name: '缓存测试', value: 100, tags: [] };
            const content = [
                '---',
                `id: ${entity.id}`,
                `name: ${entity.name}`,
                `value: ${entity.value}`,
                `tags: ${entity.tags.join(', ')}`,
                '---',
                '',
                `# ${entity.name}`,
                '',
                `Value: ${entity.value}`,
            ].join('\n');
            await fs.mkdir('test-entities');
            await fs.write('test-entities/cached.md', content);

            const readCount = { count: 0 };
            const originalRead = fs.read.bind(fs);
            vi.spyOn(fs, 'read').mockImplementation(async (path: string) => {
                readCount.count++;
                return originalRead(path);
            });

            await cachedRepo.findById('cached');
            await cachedRepo.findById('cached');
            await cachedRepo.findById('cached');

            expect(readCount.count).toBe(1);
        });

        it('save 后更新缓存', async () => {
            const readCount = { count: 0 };
            const originalRead = fs.read.bind(fs);
            vi.spyOn(fs, 'read').mockImplementation(async (path: string) => {
                readCount.count++;
                return originalRead(path);
            });

            const entity = { id: 'cached', name: '初始', value: 1, tags: [] };
            await cachedRepo.save(entity);

            const found = await cachedRepo.findById('cached');
            expect(found?.name).toBe('初始');
            expect(readCount.count).toBe(0);

            await cachedRepo.save({ ...entity, name: '更新后', value: 2 });
            const found2 = await cachedRepo.findById('cached');
            expect(found2?.name).toBe('更新后');
            expect(readCount.count).toBe(0);
        });

        it('delete 后清除缓存', async () => {
            await cachedRepo.save({ id: 'cached', name: '将删除', value: 1, tags: [] });

            const readCount = { count: 0 };
            const originalRead = fs.read.bind(fs);
            vi.spyOn(fs, 'read').mockImplementation(async (path: string) => {
                readCount.count++;
                return originalRead(path);
            });

            await cachedRepo.findById('cached');
            expect(readCount.count).toBe(0);

            await cachedRepo.delete('cached');

            const found = await cachedRepo.findById('cached');
            expect(found).toBeNull();
        });

        it('exists 优先检查缓存', async () => {
            await cachedRepo.save({ id: 'cached', name: '缓存测试', value: 1, tags: [] });

            const existsCount = { count: 0 };
            const originalExists = fs.exists.bind(fs);
            vi.spyOn(fs, 'exists').mockImplementation(async (path: string) => {
                existsCount.count++;
                return originalExists(path);
            });

            await cachedRepo.exists('cached');
            expect(existsCount.count).toBe(0);
        });

        it('clearCache 清空所有缓存', async () => {
            await cachedRepo.save({ id: 'a', name: 'A', value: 1, tags: [] });
            await cachedRepo.save({ id: 'b', name: 'B', value: 2, tags: [] });

            await cachedRepo.findById('a');
            await cachedRepo.findById('b');
            expect(cachedRepo.cacheSize).toBe(2);

            cachedRepo.clearCache();
            expect(cachedRepo.cacheSize).toBe(0);
        });

        it('invalidateCache 使指定 ID 缓存失效', async () => {
            await cachedRepo.save({ id: 'a', name: 'A', value: 1, tags: [] });
            await cachedRepo.save({ id: 'b', name: 'B', value: 2, tags: [] });

            await cachedRepo.findById('a');
            await cachedRepo.findById('b');
            expect(cachedRepo.cacheSize).toBe(2);

            cachedRepo.invalidateCache('a');
            expect(cachedRepo.cacheSize).toBe(1);
        });

        it('invalidateCacheByPrefix 按前缀失效缓存', async () => {
            const repo2 = new TestRepository(fs, { cacheEnabled: true });
            await repo2.save({ id: 'a', name: 'A', value: 1, tags: [] });
            await repo2.save({ id: 'b', name: 'B', value: 2, tags: [] });

            await repo2.findById('a');
            await repo2.findById('b');
            expect(repo2.cacheSize).toBe(2);

            repo2.invalidateCacheByPrefix('test-entities/');
            expect(repo2.cacheSize).toBe(0);
        });

        it('超过 cacheMaxSize 时淘汰旧缓存', async () => {
            const smallCacheRepo = new TestRepository(fs, {
                cacheEnabled: true,
                cacheMaxSize: 2,
                cacheTtlMs: 0,
            });

            await smallCacheRepo.save({ id: 'a', name: 'A', value: 1, tags: [] });
            await smallCacheRepo.save({ id: 'b', name: 'B', value: 2, tags: [] });
            await smallCacheRepo.save({ id: 'c', name: 'C', value: 3, tags: [] });

            await smallCacheRepo.findById('a');
            await smallCacheRepo.findById('b');
            expect(smallCacheRepo.cacheSize).toBe(2);

            await smallCacheRepo.findById('c');
            expect(smallCacheRepo.cacheSize).toBe(2);
        });
    });

    // ── 目录操作 ──────────────────────────────────────────────

    describe('目录创建', () => {
        it('保存时自动创建父目录', async () => {
            const entity: TestEntity = {
                id: 'nested',
                name: '嵌套目录测试',
                value: 1,
                tags: [],
            };

            await repo.save(entity);

            const exists = await fs.exists('test-entities/nested.md');
            expect(exists).toBe(true);
        });
    });
});


afterEach(() => {
    vi.restoreAllMocks();
});
