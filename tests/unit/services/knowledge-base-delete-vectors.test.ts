import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeBaseManager } from '../../../services/knowledge-base-manager';
import { kbVectorsDir } from '../../../shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    deleted: string[] = [];

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }
    async delete(path: string): Promise<void> {
        this.deleted.push(path);
        this.files.delete(path);
    }
    async mkdir(): Promise<void> {}
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(): Promise<never[]> { return []; }
    async listAll(): Promise<never[]> { return []; }
    async rename(): Promise<void> {}
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
}

function createManager(fs: FakeFileSystem): KnowledgeBaseManager {
    const manager = new KnowledgeBaseManager({} as any);
    (manager as any).fs = fs;
    (manager as any).books.set('book-1', { id: 'book-1', name: '测试书' });
    (manager as any).books.set('book-2', { id: 'book-2', name: '另一本' });
    return manager;
}

describe('KnowledgeBaseManager.deleteBook — 向量清理', () => {
    let fs: FakeFileSystem;
    let manager: KnowledgeBaseManager;

    beforeEach(() => {
        fs = new FakeFileSystem();
        manager = createManager(fs);
    });

    it('删除向量文件并从索引移除该书籍', async () => {
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, JSON.stringify({ bookId: 'book-1', samples: [] }));
        fs.files.set(`${dir}/index.json`, JSON.stringify({
            version: 1,
            books: [
                { bookId: 'book-1', bookName: '测试书', sampleCount: 10 },
                { bookId: 'book-2', bookName: '另一本', sampleCount: 5 },
            ],
        }));

        await manager.deleteBook('book-1');

        expect(fs.deleted).toContain(`${dir}/book-1.json`);
        const index = JSON.parse(fs.files.get(`${dir}/index.json`)!);
        expect(index.books).toEqual([{ bookId: 'book-2', bookName: '另一本', sampleCount: 5 }]);
    });

    it('索引不存在时不抛错', async () => {
        await expect(manager.deleteBook('book-1')).resolves.toBeUndefined();
        expect(fs.deleted.some(path => path.endsWith('book-1.json'))).toBe(true);
    });

    it('索引中没有该书籍时不重写索引', async () => {
        const dir = kbVectorsDir();
        const original = JSON.stringify({ version: 1, books: [{ bookId: 'book-2' }] });
        fs.files.set(`${dir}/index.json`, original);

        await manager.deleteBook('book-1');

        expect(fs.files.get(`${dir}/index.json`)).toBe(original);
    });
});
