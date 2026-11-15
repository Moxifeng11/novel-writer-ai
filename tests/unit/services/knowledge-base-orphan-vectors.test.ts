/**
 * 孤儿向量清理（启动维护）
 */

import { describe, expect, it } from 'vitest';
import { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import { kbKnowledgeBaseDir, kbVectorsDir } from '@/shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    folders: string[] = [];
    deleted: string[] = [];
    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
    async exists(path: string): Promise<boolean> { return this.files.has(path); }
    async delete(path: string): Promise<void> { this.deleted.push(path); this.files.delete(path); }
    async mkdir(): Promise<void> {}
    async listFiles(): Promise<Array<{ path: string; stat: { size: number } }>> {
        return Array.from(this.files.keys()).map(path => ({ path, stat: { size: (this.files.get(path) || '').length } }));
    }
    async listFolders(): Promise<Array<{ path: string }>> { return this.folders.map(path => ({ path })); }
    async listAll(): Promise<never[]> { return []; }
    async rename(): Promise<void> {}
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
}

const make = (books: Array<{ id: string; name: string }>) => {
    const fs = new FakeFileSystem();
    const manager = new KnowledgeBaseManager({} as never);
    (manager as unknown as { fs: FakeFileSystem }).fs = fs;
    const map = (manager as unknown as { books: Map<string, unknown> }).books;
    for (const book of books) map.set(book.id, book);
    return { fs, manager };
};

describe('KnowledgeBaseManager.sweepOrphanVectorArtifacts', () => {
    it('删除孤儿向量并移除失效索引条目', async () => {
        const { fs, manager } = make([{ id: 'book-1', name: '有效书' }, { id: 'book-stale', name: '已删书' }]);
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, '{}');
        fs.files.set(`${dir}/book-stale.json`, '{"x":1}');
        fs.files.set(`${dir}/book-orphan.json`, '{"x":2}');
        fs.files.set(`${dir}/index.json`, '{"books":[]}');
        fs.folders = [`${kbKnowledgeBaseDir()}/有效书`];

        const result = await manager.sweepOrphanVectorArtifacts();
        // book-stale：索引有 + 向量有 + 目录无 → 删向量并移除索引；book-orphan：两边都没有 → 删文件
        expect(result.removedFiles).toBe(2);
        expect(result.removedBooks).toBe(1);
        expect(fs.deleted.some(path => path.includes('book-orphan.json'))).toBe(true);
        expect(fs.deleted.some(path => path.includes('book-stale.json'))).toBe(true);
        expect(fs.deleted.some(path => path.includes('book-1.json'))).toBe(false);
        expect((manager as unknown as { books: Map<string, unknown> }).books.has('book-stale')).toBe(false);
    });

    it('索引为空但书籍目录仍有书：跳过清理（防索引损坏误删全部向量）', async () => {
        const { fs, manager } = make([]);
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-a.json`, '{}');
        fs.folders = [`${kbKnowledgeBaseDir()}/某本书`];
        const result = await manager.sweepOrphanVectorArtifacts();
        expect(result.removedFiles).toBe(0);
        expect(fs.deleted).toEqual([]);
    });

    it('索引为空且书籍目录也空：清理无主向量', async () => {
        const { fs, manager } = make([]);
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-a.json`, '{}');
        fs.files.set(`${dir}/index.json`, '{"books":[]}');
        const result = await manager.sweepOrphanVectorArtifacts();
        expect(result.removedFiles).toBe(1);
        expect(fs.deleted.some(path => path.includes('book-a.json'))).toBe(true);
    });

    it('全部有效时零删除', async () => {
        const { fs, manager } = make([{ id: 'book-1', name: '有效书' }]);
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, '{}');
        fs.folders = [`${kbKnowledgeBaseDir()}/有效书`];
        const result = await manager.sweepOrphanVectorArtifacts();
        expect(result).toEqual({ removedFiles: 0, removedBooks: 0, bytes: 0 });
    });
});
