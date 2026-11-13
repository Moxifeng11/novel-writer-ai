import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeBaseManager } from '../../../services/knowledge-base-manager';
import { kbVectorsDir } from '../../../shared/paths';
import { withWriteLock, KNOWLEDGE_VECTOR_STATE_LOCK } from '../../../shared/write-lock';

/**
 * 书籍改名时 bookId 不变，向量文件（按 bookId 命名）不会被动重命名。
 * 若不重写文件里的 bookName，旧名目录不存在会让整本书向量被判定为孤儿。
 */

class FakeFileSystem {
    files = new Map<string, string>();
    renamed: Array<[string, string]> = [];
    /** P3：按发生顺序记录写/rename，供原子写与串行化断言 */
    log: string[] = [];

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        this.log.push(`write:${path}`);
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }
    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }
    async mkdir(): Promise<void> {}
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(): Promise<never[]> { return []; }
    async listAll(): Promise<never[]> { return []; }
    async rename(from: string, to: string): Promise<void> {
        this.renamed.push([from, to]);
        this.log.push(`rename:${from}->${to}`);
        const exact = this.files.get(from);
        if (exact !== undefined) {
            this.files.delete(from);
            this.files.set(to, exact);
            return;
        }
        for (const [path, content] of Array.from(this.files)) {
            if (path.startsWith(`${from}/`)) {
                this.files.delete(path);
                this.files.set(`${to}/${path.slice(from.length + 1)}`, content);
            }
        }
    }
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
}

function createManager(fs: FakeFileSystem): KnowledgeBaseManager {
    const manager = new KnowledgeBaseManager({} as any);
    (manager as any).fs = fs;
    (manager as any).books.set('book-1', {
        id: 'book-1',
        name: '旧书名',
        themeTags: [],
        techniqueTags: [],
        customTags: [],
        createdAt: 1,
        updatedAt: 1,
        breakdownStatus: 'completed',
    });
    return manager;
}

describe('KnowledgeBaseManager.updateBook — 改名同步向量书名', () => {
    let fs: FakeFileSystem;
    let manager: KnowledgeBaseManager;

    beforeEach(() => {
        fs = new FakeFileSystem();
        manager = createManager(fs);
    });

    it('重写向量文件与向量索引中的 bookName，bookId 不变', async () => {
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, JSON.stringify({
            bookId: 'book-1',
            bookName: '旧书名',
            modelId: 'mock-embed',
            dimensionCount: 8,
            samples: [
                { id: 's1', bookId: 'book-1', bookName: '旧书名', dimension: 'style', sample: '短句', vector: [1, 0] },
            ],
        }));
        fs.files.set(`${dir}/index.json`, JSON.stringify({
            version: 1,
            books: [{ bookId: 'book-1', bookName: '旧书名', sampleCount: 1 }],
        }));

        await manager.updateBook('book-1', { name: '新书名' });

        const vector = JSON.parse(fs.files.get(`${dir}/book-1.json`)!);
        expect(vector.bookId).toBe('book-1');
        expect(vector.bookName).toBe('新书名');
        expect(vector.samples[0].bookName).toBe('新书名');
        expect(vector.samples[0].sample).toBe('短句');

        const index = JSON.parse(fs.files.get(`${dir}/index.json`)!);
        expect(index.books).toEqual([{ bookId: 'book-1', bookName: '新书名', sampleCount: 1 }]);
    });

    it('向量文件缺失时改名仍成功（不抛错）', async () => {
        await expect(manager.updateBook('book-1', { name: '新书名' })).resolves.toBeUndefined();
        expect((manager as any).books.get('book-1').name).toBe('新书名');
    });

    it('P3：目标已存在时直接覆盖写（rename 目标存在会抛 Destination file already exists）', async () => {
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, JSON.stringify({
            bookId: 'book-1',
            bookName: '旧书名',
            samples: [],
        }));

        await manager.updateBook('book-1', { name: '新书名' });

        // 目标已存在 → 不得再走 rename（否则抛错、索引永远写不进去）
        expect(fs.log.some(e => e.startsWith('rename:') && e.endsWith(`->${dir}/book-1.json`))).toBe(false);
        // 内容确实更新了
        const saved = JSON.parse(fs.files.get(`${dir}/book-1.json`) as string) as { bookName: string };
        expect(saved.bookName).toBe('新书名');
        // 不残留 tmp
        expect([...fs.files.keys()].filter(k => k.startsWith(`${dir}/`) && k.includes('.tmp-'))).toEqual([]);
    });


    it('P3：改名写入与向量状态锁串行，不会插进持锁任务中间', async () => {
        const dir = kbVectorsDir();
        fs.files.set(`${dir}/book-1.json`, JSON.stringify({
            bookId: 'book-1',
            bookName: '旧书名',
            samples: [],
        }));

        const blocker = withWriteLock(KNOWLEDGE_VECTOR_STATE_LOCK, async () => {
            fs.log.push('blocker:start');
            await new Promise(resolve => setTimeout(resolve, 20));
            fs.log.push('blocker:end');
        });
        const renaming = manager.updateBook('book-1', { name: '新书名' });
        await Promise.all([blocker, renaming]);

        const firstWrite = fs.log.findIndex(e => e.startsWith('write:'));
        expect(firstWrite).toBeGreaterThan(fs.log.indexOf('blocker:end'));
    });
});
