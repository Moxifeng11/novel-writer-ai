import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import { BaseMarkdownRepository } from '../../../../engine/repository/base-markdown-repository';
import { parseFrontmatter } from '../../../../shared/frontmatter';

// ============================================================
// 测试用实体
// ============================================================

interface TestEntity {
    id: string;
    name: string;
    shouldFail?: boolean;
}

// ============================================================
// 可注入错误的测试 Repository
// ============================================================

class FailableTestRepository extends BaseMarkdownRepository<TestEntity, string> {
    public failOnSave: Set<string> = new Set();
    public failOnDelete: Set<string> = new Set();

    protected idFromEntity(entity: TestEntity): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return `bulk-test/${id}.md`;
    }

    protected deserialize(content: string, filePath: string): TestEntity {
        const fm = parseFrontmatter(content);
        return {
            id: fm.id || filePath.split('/').pop()?.replace('.md', '') || '',
            name: fm.name || '',
        };
    }

    protected serialize(entity: TestEntity): string {
        if (this.failOnSave.has(entity.id)) {
            throw new Error(`Simulated save failure for ${entity.id}`);
        }
        return [
            '---',
            `id: ${entity.id}`,
            `name: ${entity.name}`,
            '---',
            '',
            `# ${entity.name}`,
        ].join('\n');
    }

    async delete(id: string): Promise<boolean> {
        if (this.failOnDelete.has(id)) {
            throw new Error(`Simulated delete failure for ${id}`);
        }
        return super.delete(id);
    }

    protected sampleId(): string {
        return 'sample';
    }
}

// ============================================================
// 测试用例
// ============================================================

describe('Bulk Repository Operations', () => {
    let fs: MockFileSystem;
    let repo: FailableTestRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new FailableTestRepository(fs, { cacheEnabled: false });
    });

    // ── saveAll 批量保存 ─────────────────────────────────────

    describe('saveAll', () => {
        it('全部成功时返回正确结果', async () => {
            const entities: TestEntity[] = [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
                { id: 'c', name: 'C' },
            ];

            const result = await repo.saveAll(entities);

            expect(result.successCount).toBe(3);
            expect(result.failureCount).toBe(0);
            expect(result.success.length).toBe(3);
            expect(result.failures.length).toBe(0);

            expect(await repo.exists('a')).toBe(true);
            expect(await repo.exists('b')).toBe(true);
            expect(await repo.exists('c')).toBe(true);
        });

        it('部分失败时记录错误并继续执行', async () => {
            repo.failOnSave.add('b');

            const entities: TestEntity[] = [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
                { id: 'c', name: 'C' },
            ];

            const result = await repo.saveAll(entities);

            expect(result.successCount).toBe(2);
            expect(result.failureCount).toBe(1);
            expect(result.success.map(e => e.id)).toEqual(['a', 'c']);
            expect(result.failures.length).toBe(1);
            expect(result.failures[0].index).toBe(1);
            expect(result.failures[0].error.message).toContain('Simulated save failure for b');
            expect((result.failures[0].item as TestEntity).id).toBe('b');

            expect(await repo.exists('a')).toBe(true);
            expect(await repo.exists('b')).toBe(false);
            expect(await repo.exists('c')).toBe(true);
        });

        it('全部失败时返回全部失败', async () => {
            repo.failOnSave.add('a');
            repo.failOnSave.add('b');

            const entities: TestEntity[] = [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
            ];

            const result = await repo.saveAll(entities);

            expect(result.successCount).toBe(0);
            expect(result.failureCount).toBe(2);
            expect(result.failures.length).toBe(2);
            expect(result.failures[0].index).toBe(0);
            expect(result.failures[1].index).toBe(1);
        });

        it('空数组返回空结果', async () => {
            const result = await repo.saveAll([]);
            expect(result.successCount).toBe(0);
            expect(result.failureCount).toBe(0);
            expect(result.success).toEqual([]);
            expect(result.failures).toEqual([]);
        });

        it('按顺序执行', async () => {
            const order: string[] = [];
            const originalWrite = fs.write.bind(fs);
            vi.spyOn(fs, 'write').mockImplementation(async (path: string, content: string) => {
                const id = path.split('/').pop()?.replace('.md', '') || '';
                order.push(id);
                return originalWrite(path, content);
            });

            const entities: TestEntity[] = [
                { id: 'first', name: 'First' },
                { id: 'second', name: 'Second' },
                { id: 'third', name: 'Third' },
            ];

            await repo.saveAll(entities);

            expect(order).toEqual(['first', 'second', 'third']);
        });
    });

    // ── deleteAll 批量删除 ───────────────────────────────────

    describe('deleteAll', () => {
        beforeEach(async () => {
            await repo.save({ id: 'a', name: 'A' });
            await repo.save({ id: 'b', name: 'B' });
            await repo.save({ id: 'c', name: 'C' });
        });

        it('全部成功删除', async () => {
            const result = await repo.deleteAll(['a', 'b', 'c']);

            expect(result.successCount).toBe(3);
            expect(result.failureCount).toBe(0);
            expect(result.success).toEqual(['a', 'b', 'c']);

            expect(await repo.exists('a')).toBe(false);
            expect(await repo.exists('b')).toBe(false);
            expect(await repo.exists('c')).toBe(false);
        });

        it('部分失败时记录错误并继续', async () => {
            repo.failOnDelete.add('b');

            const result = await repo.deleteAll(['a', 'b', 'c']);

            expect(result.successCount).toBe(2);
            expect(result.failureCount).toBe(1);
            expect(result.success).toEqual(['a', 'c']);
            expect(result.failures.length).toBe(1);
            expect(result.failures[0].index).toBe(1);
            expect(result.failures[0].item).toBe('b');
            expect(result.failures[0].error.message).toContain('Simulated delete failure for b');

            expect(await repo.exists('a')).toBe(false);
            expect(await repo.exists('b')).toBe(true);
            expect(await repo.exists('c')).toBe(false);
        });

        it('删除不存在的 ID 视为失败', async () => {
            const result = await repo.deleteAll(['a', 'not-exist', 'c']);

            expect(result.successCount).toBe(2);
            expect(result.failureCount).toBe(1);
            expect(result.failures[0].index).toBe(1);
            expect(result.failures[0].item).toBe('not-exist');
            expect(result.failures[0].error.message).toContain('Entity not found');
        });

        it('空数组返回空结果', async () => {
            const result = await repo.deleteAll([]);
            expect(result.successCount).toBe(0);
            expect(result.failureCount).toBe(0);
        });
    });

    // ── findAllById 批量查找 ─────────────────────────────────

    describe('findAllById', () => {
        beforeEach(async () => {
            await repo.save({ id: 'a', name: 'Apple' });
            await repo.save({ id: 'b', name: 'Banana' });
            await repo.save({ id: 'c', name: 'Cherry' });
        });

        it('返回所有找到的实体', async () => {
            const result = await repo.findAllById(['a', 'b', 'c']);
            expect(result.length).toBe(3);
            expect(result.map(e => e.id).sort()).toEqual(['a', 'b', 'c']);
        });

        it('未找到的实体不包含在结果中', async () => {
            const result = await repo.findAllById(['a', 'not-exist', 'c']);
            expect(result.length).toBe(2);
            expect(result.map(e => e.id).sort()).toEqual(['a', 'c']);
        });

        it('全部未找到返回空数组', async () => {
            const result = await repo.findAllById(['x', 'y', 'z']);
            expect(result).toEqual([]);
        });

        it('空数组返回空数组', async () => {
            const result = await repo.findAllById([]);
            expect(result).toEqual([]);
        });

        it('保持输入顺序（已找到的）', async () => {
            const result = await repo.findAllById(['c', 'a', 'b']);
            expect(result.map(e => e.id)).toEqual(['c', 'a', 'b']);
        });
    });

    // ── 边界情况 ─────────────────────────────────────────────

    describe('边界情况', () => {
        it('非 Error 类型的异常被包装为 Error', async () => {
            const repo2 = new class extends BaseMarkdownRepository<TestEntity, string> {
                protected idFromEntity(e: TestEntity): string { return e.id; }
                protected filePathFromId(id: string): string { return `test/${id}.md`; }
                protected deserialize(): TestEntity { return { id: '', name: '' }; }
                protected serialize(): string {
                    throw 'string error';
                }
                protected sampleId(): string { return 'sample'; }
            }(fs, { cacheEnabled: false });

            const result = await repo2.saveAll([{ id: 'a', name: 'A' }]);
            expect(result.failureCount).toBe(1);
            expect(result.failures[0].error).toBeInstanceOf(Error);
            expect(result.failures[0].error.message).toBe('string error');
        });
    });
});
