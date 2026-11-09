/**
 * knowledge-base-integrity.test.ts — 知识库数据面回归
 *
 * 锁定四条会静默损坏用户数据的路径：
 * 1. 索引 frontmatter 解析失败 / CRLF → 旧实现当成「空库」，下一次保存把整库写成 0 本；
 * 2. 基本信息.md 的字段白名单漏字段 → 索引损坏后从目录重建时向量状态/简介/分类推荐全丢；
 * 3. knowledge-base-config 读取失败 → 旧实现立刻用默认值覆盖磁盘，用户自定义分类被抹掉；
 * 4. 批量导入重试 → 旧实现每次重试都 addBook，产生「书名 (2)」「书名 (3)」重复书籍。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeBaseManager } from '../../../services/knowledge-base-manager';
import { KnowledgeBaseConfigManager } from '../../../engine/knowledge-base-config';
import { BatchImportManager } from '../../../engine/batch-import-manager';
import { kbBookBasicInfoFile, kbIndexFile, kbKnowledgeBaseDir } from '../../../shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    folders = new Set<string>();
    renames: Array<{ from: string; to: string }> = [];
    /** 前 N 次写 .txt 抛错（模拟磁盘占用/同步冲突） */
    failSourceWrite = 0;

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        if (path.endsWith('.txt') && this.failSourceWrite > 0) {
            this.failSourceWrite--;
            throw new Error('disk busy');
        }
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }
    async delete(path: string): Promise<void> {
        this.files.delete(path);
        this.folders.delete(path);
    }
    async mkdir(path: string): Promise<void> {
        this.folders.add(path);
    }
    async rename(from: string, to: string): Promise<void> {
        this.renames.push({ from, to });
        const value = this.files.get(from);
        if (value !== undefined) {
            this.files.delete(from);
            this.files.set(to, value);
        }
    }
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
    async listAll(): Promise<never[]> { return []; }
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(dirPath: string): Promise<Array<{ path: string; name: string }>> {
        return Array.from(this.folders)
            .filter(path => path.startsWith(`${dirPath}/`))
            .map(path => ({ path, name: path.split('/').pop()! }));
    }
}

function makeManager(fs: FakeFileSystem): KnowledgeBaseManager {
    const manager = new KnowledgeBaseManager({} as any);
    (manager as any).fs = fs;
    return manager;
}

function indexContent(books: unknown[]): string {
    return `---\n${JSON.stringify({ books }, null, 2)}\n---\n\n# 知识库索引\n`;
}

function seedBookDir(fs: FakeFileSystem, name: string, extra: Record<string, unknown> = {}): void {
    const dir = `${kbKnowledgeBaseDir()}/${name}`;
    fs.folders.add(dir);
    // 基本信息.md 的 frontmatter 直接是书籍对象（不是索引那种 { books: [] } 包装）
    const book = {
        id: `id-${name}`,
        name,
        author: '作者',
        themeTags: [],
        techniqueTags: [],
        customTags: [],
        createdAt: 1,
        updatedAt: 1,
        breakdownStatus: 'completed',
        ...extra,
    };
    fs.files.set(kbBookBasicInfoFile(name), `---\n${JSON.stringify(book, null, 2)}\n---\n\n# ${name}\n`);
}

describe('KnowledgeBaseManager.init — 索引损坏不得清空知识库', () => {
    let fs: FakeFileSystem;
    let manager: KnowledgeBaseManager;

    beforeEach(() => {
        fs = new FakeFileSystem();
        manager = makeManager(fs);
    });

    it('frontmatter JSON 损坏时从书籍目录重建，并把坏索引改名留档', async () => {
        seedBookDir(fs, '书甲');
        fs.files.set(kbIndexFile(), '---\n{ books: [ 这不是 JSON\n---\n');

        await manager.init();

        expect(manager.hasBook('id-书甲')).toBe(true);
        expect(fs.renames.some(r => r.from === kbIndexFile() && r.to.includes('.bak-'))).toBe(true);
        // 重建后的索引写回的是「恢复出来的书」，不是空数组
        const rewritten = JSON.parse(fs.files.get(kbIndexFile())!.match(/^---\n([\s\S]*?)\n---/)![1]);
        expect(rewritten.books.map((b: { id: string }) => b.id)).toEqual(['id-书甲']);
    });

    it('索引中的越界 book.id 被丢弃，其余书籍正常加载（安全审计 SEC-3）', async () => {
        const base = { name: '书', themeTags: [], techniqueTags: [], customTags: [], createdAt: 1, updatedAt: 1, breakdownStatus: 'pending' };
        fs.files.set(kbIndexFile(), indexContent([
            { ...base, id: '../data', name: '越界书' },
            { ...base, id: 'book-1', name: '正常书' },
        ]));

        await manager.init();

        expect(manager.hasBook('../data')).toBe(false);
        expect(manager.hasBook('book-1')).toBe(true);
    });

    it('索引是 CRLF 换行时仍能正常读取（不触发重建）', async () => {
        const books = [{ id: 'book-1', name: '书一', themeTags: [], techniqueTags: [], customTags: [], createdAt: 1, updatedAt: 1, breakdownStatus: 'pending' }];
        fs.files.set(kbIndexFile(), indexContent(books).replace(/\n/g, '\r\n'));

        await manager.init();

        expect(manager.hasBook('book-1')).toBe(true);
        expect(fs.renames.length).toBe(0);
    });

    it('索引缺少 books 字段时同样走重建，而不是当成空库', async () => {
        seedBookDir(fs, '书乙');
        fs.files.set(kbIndexFile(), '---\n{ "version": 2 }\n---\n');

        await manager.init();

        expect(manager.hasBook('id-书乙')).toBe(true);
    });

    it('真空库（books: []）不重建', async () => {
        fs.files.set(kbIndexFile(), indexContent([]));

        await manager.init();

        expect(await manager.getAllBooks()).toEqual([]);
        expect(fs.renames.length).toBe(0);
    });
});

describe('KnowledgeBaseManager.saveBookInfo — 重建后状态不丢', () => {
    it('向量状态/简介/分类推荐都会写进基本信息.md', async () => {
        const fs = new FakeFileSystem();
        const manager = makeManager(fs);
        fs.files.set(kbIndexFile(), indexContent([]));
        await manager.init();

        (manager as any).books.set('book-1', {
            id: 'book-1',
            name: '书丙',
            author: '作者',
            themeTags: [],
            techniqueTags: [],
            customTags: [],
            synopsis: '一段简介',
            createdAt: 1,
            updatedAt: 1,
            breakdownStatus: 'completed',
            vectorStatus: 'failed',
            vectorError: '模型不一致',
            genreRecommendations: [{ genreId: 'xuanhuan_xianxia', confidence: 0.8 }],
        });

        await (manager as any).saveBookInfo((manager as any).books.get('book-1'));
        await manager.flush();

        const raw = fs.files.get(kbBookBasicInfoFile('书丙'))!;
        const fm = JSON.parse(raw.match(/^---\n([\s\S]*?)\n---/)![1]);

        expect(fm.synopsis).toBe('一段简介');
        expect(fm.vectorStatus).toBe('failed');
        expect(fm.vectorError).toBe('模型不一致');
        expect(fm.genreRecommendations).toEqual([{ genreId: 'xuanhuan_xianxia', confidence: 0.8 }]);
    });
});

describe('KnowledgeBaseConfigManager — 读失败不得覆盖磁盘', () => {
    function makeConfigManager(fs: FakeFileSystem) {
        const manager = new KnowledgeBaseConfigManager({} as any);
        (manager as any).fs = fs;
        return manager;
    }

    it('配置文件损坏时使用默认值但不写盘', async () => {
        const fs = new FakeFileSystem();
        const manager = makeConfigManager(fs);

        const { kbConfigFile } = await import('../../../shared/paths');
        fs.files.set(kbConfigFile(), '{ 这是坏 JSON');

        const config = await manager.load();

        expect(config).toBeTruthy();
        // 磁盘内容原样保留，等用户/后续版本修复
        expect(fs.files.get(kbConfigFile())).toBe('{ 这是坏 JSON');
    });

    it('配置文件不存在时写入默认配置', async () => {
        const fs = new FakeFileSystem();
        const manager = makeConfigManager(fs);
        const { kbConfigFile } = await import('../../../shared/paths');

        await manager.load();

        expect(fs.files.has(kbConfigFile())).toBe(true);
    });
});

describe('BatchImportManager — 重试不得重复建书', () => {
    it('写源文件失败后自动重试，addBook 只调用一次', async () => {
        const fs = new FakeFileSystem();
        fs.failSourceWrite = 1; // 第一次写 .txt 失败，触发自动重试

        const books = new Map<string, Record<string, unknown>>();
        const addBook = vi.fn(async (info: Record<string, unknown>) => {
            const id = `book-${books.size + 1}`;
            const book = { id, ...info, createdAt: Date.now(), updatedAt: Date.now(), breakdownStatus: 'pending' };
            books.set(id, book);
            return book;
        });
        const kbManager = {
            addBook,
            getBook: vi.fn(async (id: string) => books.get(id)),
            getBaseDir: () => undefined,
        } as any;
        const scheduler = { addTask: vi.fn(async () => 'task-1') } as any;

        const manager = new BatchImportManager({} as any, kbManager, scheduler);
        (manager as any).fs = fs;
        (manager as any).settings = { ...(manager as any).settings, autoStartDeconstruction: false, concurrency: 1 };

        manager.addPreview({ filename: '重试书.txt', content: '正文内容', source: 'local-file' });
        manager.getSelectedPreviews().forEach(p => manager.updatePreview(p.id, { selected: true }));
        manager.startImport();

        // runTask 不返回句柄：轮询到队列清空
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            const tasks = manager.getAllTasks();
            const settled = tasks.every(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled');
            if (settled && tasks.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const tasks = manager.getAllTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe('completed');
        expect(tasks[0].retryCount).toBe(1);
        // 核心回归：重试复用了同一个 bookId，没有第二次 addBook
        expect(addBook).toHaveBeenCalledTimes(1);
        expect(books.size).toBe(1);
    });

    it('新批次会清掉上一批的终态任务，进度不累计', () => {
        const fs = new FakeFileSystem();
        const kbManager = { addBook: vi.fn(), getBook: vi.fn(), getBaseDir: () => undefined } as any;
        const scheduler = { addTask: vi.fn() } as any;
        const manager = new BatchImportManager({} as any, kbManager, scheduler);
        (manager as any).fs = fs;

        // 手工塞一条上一批的终态任务
        (manager as any).tasks.set('old-task', {
            id: 'old-task', previewId: 'p-old', bookName: '旧书', status: 'completed',
            progress: 100, retryCount: 0, maxRetries: 3, createdAt: 1, priority: 0,
            dimensions: [], autoStartDeconstruction: false,
        });

        manager.addPreview({ filename: '新书.txt', content: '正文', source: 'local-file' });
        manager.getSelectedPreviews().forEach(p => manager.updatePreview(p.id, { selected: true }));
        manager.startImport();

        expect(manager.getAllTasks().some(t => t.id === 'old-task')).toBe(false);
        expect(manager.getProgress().totalTasks).toBe(1);
    });
});
