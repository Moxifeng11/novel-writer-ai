/**
 * knowledge-base-manager.ts — 知识库管理器
 *
 * 功能：管理知识库中的书籍，支持增删改查、列表查询和拆解状态管理
 * 存储方式：总索引用 frontmatter 存 JSON，每本书存各自子目录的「基本信息.md」
 *
 * 本次加固主要变更（v4.10.1）：
 * - 递归删除：deleteBook 递归删除书籍目录及所有子文件，避免残留文件堆积
 * - 路径安全：路径穿越防护，过滤非法路径段，防止目录遍历攻击
 * - 同名检测：新增书籍时检测同名，避免覆盖已有书籍
 * - 索引重建：索引文件损坏时自动重建，保证可用性
 * - 改名原子性：renameBook 采用先创建新目录、复制文件、删除旧目录的原子操作流程
 */

import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import {
    kbKnowledgeBaseDir,
    kbIndexFile,
    kbBookDir,
    kbBookSourceFile,
    kbBookBasicInfoFile,
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookCommercialAnalysisFile,
    kbBookReadabilityAnalysisFile,
    kbVectorsDir,
} from '@/shared/paths';
import type { BreakdownDimension } from '@/shared/deconstruction-settings';
import { SerializedWriter } from '@/shared/serialized-writer';
import { WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import { GenreClassifier, type GenreClassificationResult } from './genre-classifier';
import { GenrePreferenceMemory, type GenrePreferenceData } from './genre-preference-memory';
import type { EmbeddingProvider } from '@/shared/embedding-provider';
import { kbConfigDir } from '@/shared/paths';
import { LruCache } from '@/shared/lru-cache';
import { withWriteLock, KNOWLEDGE_VECTOR_STATE_LOCK } from '@/shared/write-lock';
import type { MultiLayerCache } from '@/shared/multi-layer-cache';
import { createLogger } from '@/shared/logger';


const log = createLogger('KnowledgeBaseManager');
const MAX_SOURCE_TEXT_LENGTH = 20_000_000; // 2000 万字：仅作内存安全上限，非功能性截断；正常全本（含数百万字长篇）不会触发
/** 导入源文件大小硬上限（10MB）：manager 与两 UI 入口共用，超限在读取前拒绝（SEC-7） */
export const MAX_SOURCE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * BreakdownStatus 类型定义。
 */
export type BreakdownStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'interrupted';

/** 拆解后的向量化状态：拆解完成 ≠ 检索可用（A5） */
export type VectorStatus = 'pending' | 'done' | 'failed';

/**
 * 质量分数列表结构定义。
 */
export interface QualityScores {
    overall: number;
    style: number;
    rhythm: number;
    technique: number;
    structure: number;
    character: number;
    foreshadow: number;
    commercial?: number;
    readability?: number;
    vectorEnabled: boolean;
}

/**
 * BookBasicInfo 类型定义。
 */
export interface BookBasicInfo {
    id: string;
    name: string;
    author?: string;
    wordCount?: number;
    themeTags: string[];
    techniqueTags: string[];
    customTags: string[];
    synopsis?: string;
    createdAt: number;
    updatedAt: number;
    breakdownStatus: BreakdownStatus;
    breakdownProgress?: number;
    breakdownError?: string;
    /** 向量化状态；旧数据无此字段视为未知（pending） */
    vectorStatus?: VectorStatus;
    /** 向量化失败原因，成功后清空 */
    vectorError?: string;
    sourcePath?: string;
    primaryGenre?: string;
    secondaryGenres?: string[];
    genreConfidence?: number;
    genreChannel?: 'male' | 'female' | 'neutral';
    genreChannelConfidence?: number;
    primaryGenreConfidence?: number;
    primarySubGenre?: string;
    secondarySubGenres?: string[];
    primarySubGenreConfidence?: number;
    genreRecommendations?: Array<{
        genreId: string;
        subGenreId?: string;
        confidence: number;
    }>;
    qualityScores?: QualityScores;
}

interface ListBooksOptions {
    themeTag?: string;
    techniqueTag?: string;
    author?: string;
    keyword?: string;
    status?: BreakdownStatus;
    sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'wordCount';
    sortOrder?: 'asc' | 'desc';
    primaryGenre?: string;
}

function generateId(): string {
    return 'kb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 书籍 ID 只允许作为单个文件名段使用。
 * 索引文件可随 vault 同步/共享，`../data`、`a/b` 等会让向量文件读写/删除越出向量目录。
 * 不强制 `kb_` 前缀，兼容旧索引与测试数据。
 */
function isSafeBookId(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim().length === 0) return false;
    if (value === '.' || value === '..' || value.startsWith('.')) return false;
    if (/[\\/]/.test(value) || value.includes('..')) return false;
    return !/[\u0000-\u001f]/.test(value);
}

interface KnowledgeBaseCacheOptions {
    cacheEnabled?: boolean;
    cacheMaxSize?: number;
    cacheTtlMs?: number;
    breakdownCacheMaxSize?: number;
    breakdownCacheTtlMs?: number;
    multiLayerCache?: MultiLayerCache;
}

/**
 * LruCache 容量可调视图。
 * TS 的 `private readonly` 只是编译期约束，运行时 maxSize/ttlMs 是普通可写字段；
 * 这里只做类型收窄，不新增运行时方法、不改变既有行为。
 */
interface LruCapacityView {
    maxSize: number;
    ttlMs: number;
}

/**
 * 知识基础管理器。
 */
export class KnowledgeBaseManager {
    private app: App;
    private baseDir?: string;
    private fs: FileSystemPort | null = null;
    private books: Map<string, BookBasicInfo> = new Map();
    private indexWriter = new SerializedWriter({ debug: false });
    private bookWriter = new SerializedWriter({ debug: false });
    private kb: WebnovelKnowledgeBase;
    private genreClassifier: GenreClassifier;
    private preferenceMemory: GenrePreferenceMemory;
    private preferenceWriter = new SerializedWriter({ debug: false });

    private bookInfoCache: LruCache<string, BookBasicInfo> | null = null;
    private breakdownCache: LruCache<string, string> | null = null;
    private multiLayerCache: MultiLayerCache | null = null;
    private indexCacheKey = '__index__';
    /**
     * 知识库数据版本号（每次增删改 +1）。
     * 协同写作的参考书检索缓存用它判断「知识库变了没」：
     * 只要版本没变，检索结果就可以复用；重新拆解/改名/改状态都会让缓存失效。
     */
    private mutationSeq = 0;
    private cacheOptions: Required<KnowledgeBaseCacheOptions>;

    constructor(app: App, baseDir?: string, embeddingProvider?: EmbeddingProvider, options?: KnowledgeBaseCacheOptions) {
        this.app = app;
        this.baseDir = baseDir;
        this.kb = new WebnovelKnowledgeBase();
        this.preferenceMemory = new GenrePreferenceMemory();
        this.genreClassifier = new GenreClassifier(this.kb, embeddingProvider, this.preferenceMemory);

        this.cacheOptions = {
            cacheEnabled: options?.cacheEnabled ?? true,
            cacheMaxSize: options?.cacheMaxSize ?? 200,
            cacheTtlMs: options?.cacheTtlMs ?? 10 * 60 * 1000,
            breakdownCacheMaxSize: options?.breakdownCacheMaxSize ?? 100,
            breakdownCacheTtlMs: options?.breakdownCacheTtlMs ?? 30 * 60 * 1000,
            multiLayerCache: options?.multiLayerCache ?? undefined,
        } as Required<KnowledgeBaseCacheOptions>;

        this.multiLayerCache = options?.multiLayerCache ?? null;
        this.initCaches();
    }

    private initCaches(): void {
        if (!this.cacheOptions.cacheEnabled) {
            return;
        }

        this.bookInfoCache = new LruCache<string, BookBasicInfo>({
            maxSize: this.cacheOptions.cacheMaxSize,
            ttlMs: this.cacheOptions.cacheTtlMs,
        });

        this.breakdownCache = new LruCache<string, string>({
            maxSize: this.cacheOptions.breakdownCacheMaxSize,
            ttlMs: this.cacheOptions.breakdownCacheTtlMs,
        });
    }

    private adjustCacheCapacity(bookCount: number): void {
        if (!this.bookInfoCache || !this.breakdownCache) return;

        const infoMaxSize = Math.max(50, Math.min(bookCount * 2, 500));
        const breakdownMaxSize = Math.max(20, Math.min(bookCount * 6, 300));
        const ttlMs = bookCount > 100 ? 5 * 60 * 1000 : 15 * 60 * 1000;

        (this.bookInfoCache as unknown as LruCapacityView).maxSize = infoMaxSize;
        (this.breakdownCache as unknown as LruCapacityView).maxSize = breakdownMaxSize;
        (this.bookInfoCache as unknown as LruCapacityView).ttlMs = ttlMs;
        (this.breakdownCache as unknown as LruCapacityView).ttlMs = ttlMs * 2;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /**
     * 初始化知识库：加载索引、恢复中断任务、预热缓存。
     * @returns 无
     */
    async init(): Promise<void> {
        const fs = this.getFS();
        const kbDir = kbKnowledgeBaseDir(this.baseDir);
        await fs.mkdir(kbDir).catch(() => undefined);
        await this.loadIndex();
        await this.loadPreferenceMemory();
    }

    private async loadPreferenceMemory(): Promise<void> {
        const fs = this.getFS();
        const configDir = kbConfigDir(this.baseDir);
        const prefFile = `${configDir}/genre-preference.json`;

        try {
            await fs.mkdir(configDir).catch(() => undefined);
            const content = await fs.read(prefFile);
            const data = JSON.parse(content) as GenrePreferenceData;
            this.preferenceMemory = new GenrePreferenceMemory(data, async (d) => {
                await this.savePreferenceMemory(d);
            });
            this.genreClassifier.setPreferenceMemory(this.preferenceMemory);
        } catch {
            this.preferenceMemory = new GenrePreferenceMemory(null, async (d) => {
                await this.savePreferenceMemory(d);
            });
            this.genreClassifier.setPreferenceMemory(this.preferenceMemory);
        }
    }

    private async savePreferenceMemory(data: GenrePreferenceData): Promise<void> {
        await this.preferenceWriter.enqueueAutoClean(async () => {
            const fs = this.getFS();
            const configDir = kbConfigDir(this.baseDir);
            const prefFile = `${configDir}/genre-preference.json`;
            try {
                await fs.mkdir(configDir).catch(() => undefined);
                await fs.write(prefFile, JSON.stringify(data, null, 2));
            } catch (e) {
                log.warn('[KnowledgeBaseManager] 分类偏好保存失败:', e);
            }
        }).catch((e: unknown) => log.warn('[KnowledgeBaseManager] 写队列失败:', e));
    }

    private migrateBookData(book: Record<string, unknown>): BookBasicInfo {
        const migrated = { ...book } as unknown as BookBasicInfo;
        if (migrated.themeTags === undefined) migrated.themeTags = [];
        if (migrated.techniqueTags === undefined) migrated.techniqueTags = [];
        if (migrated.customTags === undefined) migrated.customTags = [];
        if (migrated.breakdownStatus === undefined) migrated.breakdownStatus = 'pending';
        if (migrated.secondaryGenres === undefined) migrated.secondaryGenres = [];
        if (migrated.secondarySubGenres === undefined) migrated.secondarySubGenres = [];
        return migrated;
    }

    private async loadIndex(): Promise<void> {
        const fs = this.getFS();
        const indexPath = kbIndexFile(this.baseDir);

        const indexExists = await fs.exists(indexPath);
        if (!indexExists) {
            this.books = new Map();
            await this.saveIndex();
        } else {
            try {
                const content = await fs.read(indexPath);
                const fm = this.parseFrontmatter(content);
                const booksData = fm.books as Record<string, unknown>[] | undefined;
                if (Array.isArray(booksData)) {
                    this.books = new Map();
                    for (const book of booksData) {
                        const migrated = this.migrateBookData(book);
                        if (!isSafeBookId(migrated.id)) {
                            log.warn('[KnowledgeBaseManager] 索引含非法 book.id，已丢弃:', migrated.id);
                            continue;
                        }
                        this.books.set(migrated.id, migrated);
                    }
                } else {
                    // 索引存在但没有 books 数组：要么是空库，要么是结构不认识。
                    // 不能直接当空库——后续任何一次 saveIndex 都会把「读不懂」写成「一本书都没有」。
                    throw new Error('索引缺少 books 数组');
                }
            } catch (e) {
                log.warn('[KnowledgeBaseManager] 索引文件解析失败，正在从书籍目录重建:', e);
                await this.rebuildIndexFromBooks(indexPath);
            }
        }

        this.adjustCacheCapacity(this.books.size);
        // 整表被替换：下游检索缓存必须失效
        this.mutationSeq++;

        if (this.bookInfoCache) {
            for (const [id, book] of this.books) {
                this.bookInfoCache.set(id, book);
            }
        }
    }

    private async rebuildIndexFromBooks(indexPath: string): Promise<void> {
        const fs = this.getFS();
        const kbDir = kbKnowledgeBaseDir(this.baseDir);
        const timestamp = Date.now();
        const backupPath = `${indexPath}.bak-${timestamp}`;

        try {
            await fs.rename(indexPath, backupPath);
            log.warn(`[KnowledgeBaseManager] 损坏的索引文件已备份为: ${backupPath}`);
        } catch (renameError) {
            log.warn('[KnowledgeBaseManager] 备份索引文件失败，继续重建:', renameError);
        }

        this.books = new Map();

        try {
            const allFolders = await fs.listFolders(kbDir);
            const skipDirs = new Set([
                kbConfigDir(this.baseDir),
                `${kbDir}/knowledge-vectors`,
            ]);

            const bookDirs = allFolders.filter(folder => {
                const folderPath = folder.path;
                if (skipDirs.has(folderPath)) return false;
                const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
                return parentPath === kbDir;
            });

            for (const bookFolder of bookDirs) {
                const bookName = bookFolder.name;
                const basicInfoPath = kbBookBasicInfoFile(bookName, this.baseDir);

                try {
                    const basicInfoExists = await fs.exists(basicInfoPath);
                    if (!basicInfoExists) continue;

                    const content = await fs.read(basicInfoPath);
                    const fm = this.parseFrontmatter(content);
                    const bookData = fm as Record<string, unknown>;

                    // v6.3 加固：仅接纳带有效「书名」的条目。历史/损坏的基本信息可能缺少 name
                    // （例如旧版本遗留的 `写作知识库/undefined/基本信息.md`），一旦被接纳，
                    // 后续任何 kbBookDir(book.name) 都会因 undefined.replace 抛 TypeError。
                    const validName = typeof bookData.name === 'string' && bookData.name.trim().length > 0;
                    if (bookData.id && typeof bookData.id === 'string' && validName) {
                        const migrated = this.migrateBookData(bookData);
                        this.books.set(migrated.id, migrated);
                    } else {
                        log.warn(`[KnowledgeBaseManager] 跳过缺少有效书名或 id 的基本信息: ${bookName}`);
                    }
                } catch (bookError) {
                    log.warn(`[KnowledgeBaseManager] 读取书籍基本信息失败: ${bookName}`, bookError);
                }
            }

            log.warn(`[KnowledgeBaseManager] 索引重建完成，共恢复 ${this.books.size} 本书籍`);
        } catch (rebuildError) {
            log.warn('[KnowledgeBaseManager] 索引重建过程出错:', rebuildError);
        }

        await this.saveIndex();
    }

    private async saveIndex(): Promise<void> {
        await this.indexWriter.enqueueAutoClean(async () => {
            const fs = this.getFS();
            const kbDir = kbKnowledgeBaseDir(this.baseDir);
            await fs.mkdir(kbDir).catch(() => undefined);

            const booksArray = Array.from(this.books.values());
            const fmContent = JSON.stringify({ books: booksArray }, null, 2);
            const content = `---\n${fmContent}\n---\n\n# 知识库索引\n\n共 ${booksArray.length} 本书籍。\n`;

            const indexPath = kbIndexFile(this.baseDir);
            await fs.write(indexPath, content);
        }).catch(e => {
            log.warn('[KnowledgeBaseManager] 索引保存失败:', e);
        });
    }

    private parseFrontmatter(content: string): Record<string, unknown> {
        // 兼容 CRLF：索引是用户可见的 .md，用外部编辑器保存后换行会变 \r\n。
        // 旧正则只认 `\n---`，CRLF 文件直接匹配失败 → 被当成「没有 books」→ 空库。
        const match = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
        if (!match) return {};
        try {
            return JSON.parse(match[1]);
        } catch {
            return {};
        }
    }

    private async ensureBookDir(bookName: string): Promise<void> {
        const fs = this.getFS();
        const bookDir = kbBookDir(bookName, this.baseDir);
        await fs.mkdir(bookDir).catch(() => undefined);
    }

    private generateUniqueBookName(desiredName: string, excludeBookId?: string): string {
        const existingNames = new Set(
            Array.from(this.books.values())
                .filter(b => !excludeBookId || b.id !== excludeBookId)
                .map(b => b.name)
        );
        if (!existingNames.has(desiredName)) {
            return desiredName;
        }

        const baseMatch = desiredName.match(/^(.*?)\s*\((\d+)\)$/);
        let baseName: string;
        let startNum: number;
        if (baseMatch) {
            baseName = baseMatch[1];
            startNum = parseInt(baseMatch[2], 10) + 1;
        } else {
            baseName = desiredName;
            startNum = 2;
        }

        for (let num = startNum; num < 10000; num++) {
            const candidate = `${baseName} (${num})`;
            if (!existingNames.has(candidate)) {
                return candidate;
            }
        }

        return `${baseName} (${Date.now()})`;
    }

    /**
     * 添加书籍。
     * @param info - 参数值
     * @param options - 配置项
      * @returns BookBasicInfo 实例
     */
    async addBook(
        info: Omit<BookBasicInfo, 'id' | 'createdAt' | 'updatedAt' | 'breakdownStatus'>,
        options?: { autoClassify?: boolean }
    ): Promise<BookBasicInfo> {
        const uniqueName = this.generateUniqueBookName(info.name);
        const adjustedInfo = { ...info, name: uniqueName };

        const now = Date.now();
        const book: BookBasicInfo = {
            ...adjustedInfo,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
            breakdownStatus: 'pending',
        };

        if (info.sourcePath) {
            try {
                const fs = this.getFS();
                const file = await fs.getFile(info.sourcePath);
                const size = file?.stat?.size;
                if (size !== undefined && size > MAX_SOURCE_FILE_SIZE) {
                    // SEC-7（2026-11-10 审计）：warn+继续改为硬拒绝——超大文件全量读入
                    // 会拖垮内存（MAX_SOURCE_TEXT_LENGTH 兜底发生在读后，为时已晚）
                    throw new Error(`源文件过大: ${Math.round(size / 1024 / 1024)}MB（上限 10MB），建议拆分后导入`);
                }
            } catch (e) {
                if (e instanceof Error && e.message.includes('源文件过大')) throw e;
                // 大小检查自身失败（文件不存在等），不阻止导入
            }
        }

        this.books.set(book.id, book);
        if (this.bookInfoCache) {
            this.bookInfoCache.set(book.id, book);
        }
        this.adjustCacheCapacity(this.books.size);
        await this.ensureBookDir(book.name);
        await this.saveBookInfo(book);
        await this.saveIndex();

        if (options?.autoClassify) {
            try {
                await this.classifyBook(book.id);
            } catch (e) {
                log.warn('[KnowledgeBaseManager] 自动分类失败:', e);
            }
        }

        return book;
    }

    /**
     * 删除书籍及其派生数据。
     *
     * @param bookId - 书籍 ID
     * @returns 无
     */
    async deleteBook(bookId: string): Promise<void> {
        if (!isSafeBookId(bookId)) return;
        const book = this.books.get(bookId);
        if (!book) return;

        this.mutationSeq++;
        this.books.delete(bookId);
        if (this.bookInfoCache) {
            this.bookInfoCache.delete(bookId);
        }
        if (this.breakdownCache) {
            this.breakdownCache.deleteByPrefix(`${bookId}:`);
        }
        this.adjustCacheCapacity(this.books.size);

        const fs = this.getFS();
        const bookDir = kbBookDir(book.name, this.baseDir);
        await fs.delete(bookDir).catch(() => undefined);

        await this.removeVectorArtifacts(bookId);

        await this.saveIndex();
    }

    /**
     * 删除书籍对应的向量文件与索引条目。
     * 向量文件存放在独立的向量目录，递归删除书目录不会带走它们；
     * 不清理会让已删书籍继续出现在检索结果里。
     */
    private async removeVectorArtifacts(bookId: string): Promise<void> {
        if (!isSafeBookId(bookId)) return;
        const fs = this.getFS();
        const dir = kbVectorsDir();
        await fs.delete(`${dir}/${bookId}.json`).catch(() => undefined);

        const indexPath = `${dir}/index.json`;
        try {
            const raw = await fs.read(indexPath);
            const data = JSON.parse(raw) as { version?: number; books?: Array<{ bookId: string }> };
            if (!Array.isArray(data.books)) return;
            const books = data.books.filter(item => item.bookId !== bookId);
            if (books.length === data.books.length) return;
            await fs.write(indexPath, JSON.stringify({ ...data, version: data.version ?? 1, books }, null, 2));
        } catch {
            // 索引不存在或损坏：向量文件已删除，下次重建索引会自动收敛
        }
    }

    /**
     * 书籍改名后同步向量文件与向量索引里的 bookName。
     * 向量文件名是 bookId，不会随目录 rename；只改目录会让向量文件保留旧书名，
     * 下一次加载按旧书名拼目录时整本书被判定为孤儿（检索永久为空）。
     * 与 KnowledgeVectorStore 的加载/写入共用一把状态锁：同书正在拆解或重向量化时，
     * 改名写入不会与「reload → embed → saveBook → saveIndex」交错；写入用「临时文件 + rename」
     * 原子替换，避免中断留下半写 JSON。内存同步交给向量存储的文件签名（path@mtime:size）重载。
     */
    private async renameVectorArtifacts(bookId: string, newName: string): Promise<void> {
        if (!isSafeBookId(bookId)) return;
        await withWriteLock(KNOWLEDGE_VECTOR_STATE_LOCK, async () => {
            const fs = this.getFS();
            const dir = kbVectorsDir();
            const bookPath = `${dir}/${bookId}.json`;

            try {
                if (await fs.exists(bookPath)) {
                    const raw = await fs.read(bookPath);
                    const data = JSON.parse(raw) as {
                        bookName?: string;
                        samples?: Array<{ bookName?: string }>;
                    };
                    data.bookName = newName;
                    if (Array.isArray(data.samples)) {
                        for (const sample of data.samples) {
                            sample.bookName = newName;
                        }
                    }
                    await this.writeJsonAtomic(bookPath, data);
                }
            } catch (e) {
                log.warn(`[KnowledgeBaseManager] 同步向量文件书名失败: ${bookPath}`, e);
            }

            const indexPath = `${dir}/index.json`;
            try {
                if (!(await fs.exists(indexPath))) return;
                const raw = await fs.read(indexPath);
                const data = JSON.parse(raw) as {
                    books?: Array<{ bookId: string; bookName?: string }>;
                };
                if (!Array.isArray(data.books)) return;
                let changed = false;
                for (const item of data.books) {
                    if (item.bookId === bookId && item.bookName !== newName) {
                        item.bookName = newName;
                        changed = true;
                    }
                }
                if (changed) {
                    await this.writeJsonAtomic(indexPath, data);
                }
            } catch (e) {
                log.warn(`[KnowledgeBaseManager] 同步向量索引书名失败: ${indexPath}`, e);
            }
        });
    }

    /** 先写临时文件再 rename，失败时清理临时文件，避免留下半写 JSON。 */
    private async writeJsonAtomic(path: string, data: unknown): Promise<void> {
        const fs = this.getFS();
        // 目标已存在时不能走 rename：Obsidian 的 adapter.rename 在目标存在时抛
        // `Destination file already exists!`（本仓已在断言库/字数台账各踩一次）。
        try {
            const exists = await fs.exists(path);
            if (exists) {
                await fs.write(path, JSON.stringify(data, null, 2));
                return;
            }
            const tmpPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            await fs.write(tmpPath, JSON.stringify(data, null, 2));
            await fs.rename(tmpPath, path);
        } catch (e) {
            throw e;
        }
    }

    /**
     * 更新书籍基础信息。
     *
     * @param bookId - 书籍 ID
     * @param updates - 更新字段
     * @returns 无
     */
    async updateBook(bookId: string, updates: Partial<BookBasicInfo>): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        const oldName = book.name;
        const newName = updates.name;

        if (newName && newName !== oldName) {
            const uniqueNewName = this.generateUniqueBookName(newName, bookId);
            const fs = this.getFS();
            const oldDir = kbBookDir(oldName, this.baseDir);
            const newDir = kbBookDir(uniqueNewName, this.baseDir);

            await fs.rename(oldDir, newDir);
            // 向量文件按 bookId 命名，不随目录改名；文件头里的 bookName 必须同步，
            // 否则下一次启动会按旧书名拼目录、把整本向量判成孤儿。
            await this.renameVectorArtifacts(bookId, uniqueNewName);

            const updated: BookBasicInfo = {
                ...book,
                ...updates,
                name: uniqueNewName,
                id: bookId,
                updatedAt: Date.now(),
            };

            this.books.set(bookId, updated);
            if (this.bookInfoCache) {
                this.bookInfoCache.set(bookId, updated);
            }
            if (this.breakdownCache) {
                this.breakdownCache.deleteByPrefix(`${bookId}:`);
            }

            await this.saveBookInfo(updated);
            await this.saveIndex();
        } else {
            const updated: BookBasicInfo = {
                ...book,
                ...updates,
                id: bookId,
                updatedAt: Date.now(),
            };

            this.books.set(bookId, updated);
            if (this.bookInfoCache) {
                this.bookInfoCache.set(bookId, updated);
            }

            await this.saveBookInfo(updated);
            await this.saveIndex();
        }
    }

    /**
     * 书籍是否仍在知识库中（按 bookId）。
     * 供向量存储做存活判定：书名可改，bookId 不会变。
     */
    /**
     * 知识库数据版本号：任何一次增删改都会递增。
     * 供检索缓存做键的一部分（同步读取，不触发 IO）。
     * @returns 数值结果
     */
    get version(): number {
        return this.mutationSeq;
    }

    /**
     * 书是否存在。
     *
     * @param bookId - 书籍 ID
     * @returns 布尔值
     */
    hasBook(bookId: string): boolean {
        return this.books.has(bookId);
    }

    /**
     * 读取书籍基础信息。
     *
     * @param bookId - 书籍 ID
     * @returns 书籍信息或 undefined
     */
    async getBook(bookId: string): Promise<BookBasicInfo | undefined> {
        if (this.bookInfoCache) {
            const cached = this.bookInfoCache.get(bookId);
            if (cached !== undefined) {
                return cached;
            }
        }
        const book = this.books.get(bookId);
        if (book && this.bookInfoCache) {
            this.bookInfoCache.set(bookId, book);
        }
        return book;
    }

    /**
     * 读取全部书籍。
     * @returns 书籍数组
     */
    async getAllBooks(): Promise<BookBasicInfo[]> {
        return Array.from(this.books.values());
    }

    /**
     * 按选项列出书籍（筛选/排序）。
     *
     * @param options - 配置项
     * @returns 书籍数组
     */
    async listBooks(options: ListBooksOptions = {}): Promise<BookBasicInfo[]> {
        let result = Array.from(this.books.values());

        if (options.themeTag) {
            result = result.filter(book => book.themeTags.includes(options.themeTag!));
        }
        if (options.techniqueTag) {
            result = result.filter(book => book.techniqueTags.includes(options.techniqueTag!));
        }
        if (options.author) {
            result = result.filter(book => book.author === options.author);
        }
        if (options.keyword) {
            const kw = options.keyword.toLowerCase();
            result = result.filter(book =>
                book.name.toLowerCase().includes(kw) ||
                (book.author?.toLowerCase().includes(kw)) ||
                (book.synopsis?.toLowerCase().includes(kw)) ||
                book.customTags.some(t => t.toLowerCase().includes(kw))
            );
        }
        if (options.status) {
            result = result.filter(book => book.breakdownStatus === options.status);
        }
        if (options.primaryGenre) {
            result = result.filter(book => book.primaryGenre === options.primaryGenre);
        }

        const sortBy = options.sortBy ?? 'createdAt';
        const sortOrder = options.sortOrder ?? 'desc';

        result.sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name':
                    cmp = a.name.localeCompare(b.name, 'zh-CN');
                    break;
                case 'wordCount':
                    cmp = (a.wordCount ?? 0) - (b.wordCount ?? 0);
                    break;
                case 'createdAt':
                    cmp = a.createdAt - b.createdAt;
                    break;
                case 'updatedAt':
                    cmp = a.updatedAt - b.updatedAt;
                    break;
            }
            return sortOrder === 'asc' ? cmp : -cmp;
        });

        return result;
    }

    /**
     * 更新拆解状态与进度。
     *
     * @param bookId - 书籍 ID
     * @param status - 状态
     * @param progress - 参数
     * @param error - 参数
     * @returns 无
     */
    async setBreakdownStatus(bookId: string, status: BreakdownStatus, progress?: number, error?: string): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        book.breakdownStatus = status;
        book.updatedAt = Date.now();
        if (progress !== undefined) {
            book.breakdownProgress = progress;
        }
        if (error !== undefined) {
            book.breakdownError = error;
        } else if (status === 'completed' || status === 'pending') {
            book.breakdownError = undefined;
        }

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        if (status === 'completed' && this.breakdownCache) {
            this.breakdownCache.deleteByPrefix(`${bookId}:`);
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 记录向量化结果（A5）。
     * 拆解状态保持 `completed`，向量失败单独落盘，供列表徽标与详情页「重试向量化」使用。
     * @param bookId - 书籍 ID
     * @param status - 状态
     * @param error - 错误
     */
    async setVectorStatus(bookId: string, status: VectorStatus, error?: string): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        book.vectorStatus = status;
        book.vectorError = status === 'failed' ? (error || '未知错误') : undefined;
        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 恢复中断的拆解状态
     * 插件启动时调用，将所有 processing 状态的书籍重置为 interrupted
     * @returns 被恢复的书籍数量
     */
    async recoverInterruptedBooks(): Promise<number> {
        let recovered = 0;
        const recoveredBooks: BookBasicInfo[] = [];

        for (const [bookId, book] of this.books) {
            if (book.breakdownStatus === 'processing') {
                book.breakdownStatus = 'interrupted';
                book.updatedAt = Date.now();

                if (this.bookInfoCache) {
                    this.bookInfoCache.set(bookId, { ...book });
                }

                recoveredBooks.push(book);
                recovered++;
            }
        }

        if (recoveredBooks.length > 0) {
            for (const book of recoveredBooks) {
                await this.saveBookInfo(book);
            }
            await this.saveIndex();
        }

        return recovered;
    }

    private async saveBookInfo(book: BookBasicInfo): Promise<void> {
        // 所有「改书」的路径最终都会走到这里：先递增版本号，让下游检索缓存立即失效
        this.mutationSeq++;
        await this.bookWriter.enqueueAutoClean(async () => {
            const fs = this.getFS();
            await this.ensureBookDir(book.name);

            const fmContent = JSON.stringify({
                id: book.id,
                name: book.name,
                author: book.author,
                wordCount: book.wordCount,
                themeTags: book.themeTags,
                techniqueTags: book.techniqueTags,
                customTags: book.customTags,
                // synopsis 以前只写在正文里，索引损坏后从书籍目录重建时整段丢失。
                synopsis: book.synopsis,
                createdAt: book.createdAt,
                updatedAt: book.updatedAt,
                breakdownStatus: book.breakdownStatus,
                breakdownProgress: book.breakdownProgress,
                breakdownError: book.breakdownError,
                // 向量化状态与失败原因必须落盘：重建索引后列表徽标要能还原
                vectorStatus: book.vectorStatus,
                vectorError: book.vectorError,
                sourcePath: book.sourcePath,
                primaryGenre: book.primaryGenre,
                secondaryGenres: book.secondaryGenres,
                genreConfidence: book.genreConfidence,
                genreChannel: book.genreChannel,
                genreChannelConfidence: book.genreChannelConfidence,
                primaryGenreConfidence: book.primaryGenreConfidence,
                primarySubGenre: book.primarySubGenre,
                secondarySubGenres: book.secondarySubGenres,
                primarySubGenreConfidence: book.primarySubGenreConfidence,
                genreRecommendations: book.genreRecommendations,
                qualityScores: book.qualityScores,
            }, null, 2);

            const content = `---\n${fmContent}\n---\n\n# ${book.name}\n\n${book.synopsis || ''}\n`;

            const infoPath = kbBookBasicInfoFile(book.name, this.baseDir);
            await fs.write(infoPath, content);
        }).catch(e => {
            log.warn('[KnowledgeBaseManager] 书籍信息保存失败:', e);
        });
    }

    /**
     * 读取书籍原文（用于拆解/检索）。
     *
     * @param bookId - 书籍 ID
     * @returns 原文
     */
    async getSourceText(bookId: string): Promise<string> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const fs = this.getFS();
        const sourceTxtFile = kbBookSourceFile(book.name, this.baseDir);

        let text: string;
        try {
            text = await fs.read(sourceTxtFile);
        } catch {
            throw new Error(`源文本文件不存在: ${sourceTxtFile}`);
        }

        if (text.length === 0) {
            throw new Error(`源文本文件为空: ${sourceTxtFile}`);
        }

        if (text.length > MAX_SOURCE_TEXT_LENGTH) {
            log.warn(`[KnowledgeBaseManager] ⚠️ 源文本超过内存安全上限，已截断（非全本）: ${book.name}, 原始长度: ${text.length} 字符, 实际读取: ${MAX_SOURCE_TEXT_LENGTH} 字符, 原因: 超过 MAX_SOURCE_TEXT_LENGTH 内存保护阈值`);
            return text.slice(0, MAX_SOURCE_TEXT_LENGTH);
        }

        return text;
    }

    private async readDimensionFile(bookId: string, bookName: string, dimension: BreakdownDimension): Promise<string | null> {
        const cacheKey = `${bookId}:${dimension}`;
        if (this.breakdownCache) {
            const cached = this.breakdownCache.get(cacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }

        const fs = this.getFS();
        const dimensionFiles: Record<BreakdownDimension, string> = {
            style: kbBookStyleFingerprintFile(bookName, this.baseDir),
            rhythm: kbBookRhythmAnalysisFile(bookName, this.baseDir),
            technique: kbBookWritingTechniquesFile(bookName, this.baseDir),
            structure: kbBookStructureBreakdownFile(bookName, this.baseDir),
            character: kbBookCharacterExtractionFile(bookName, this.baseDir),
            foreshadow: kbBookForeshadowDBFile(bookName, this.baseDir),
            commercial: kbBookCommercialAnalysisFile(bookName, this.baseDir),
            readability: kbBookReadabilityAnalysisFile(bookName, this.baseDir),
        };

        try {
            const content = await fs.read(dimensionFiles[dimension]);
            if (this.breakdownCache) {
                this.breakdownCache.set(cacheKey, content);
            }
            return content;
        } catch {
            return null;
        }
    }

    /**
     * 列出缺失的拆解维度。
     *
     * @param bookId - 书籍 ID
     * @returns 维度数组
     */
    async getMissingDimensions(bookId: string): Promise<BreakdownDimension[]> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const dimensions: BreakdownDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability'];
        const missing: BreakdownDimension[] = [];

        for (const dimension of dimensions) {
            const content = await this.readDimensionFile(bookId, book.name, dimension);
            if (content === null || content.length <= 100) {
                missing.push(dimension);
            }
        }

        return missing;
    }

    /**
     * 读取各维度完成状态。
     *
     * @param bookId - 书籍 ID
     * @returns 维度 → 状态
     */
    async getDimensionStatus(bookId: string): Promise<Record<BreakdownDimension, 'completed' | 'missing' | 'failed'>> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const dimensions: BreakdownDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability'];
        const status: Record<BreakdownDimension, 'completed' | 'missing' | 'failed'> = {
            style: 'missing',
            rhythm: 'missing',
            technique: 'missing',
            structure: 'missing',
            character: 'missing',
            foreshadow: 'missing',
            commercial: 'missing',
            readability: 'missing',
        };

        for (const dimension of dimensions) {
            const content = await this.readDimensionFile(bookId, book.name, dimension);
            if (content !== null && content.length > 100) {
                status[dimension] = 'completed';
            } else {
                status[dimension] = 'missing';
            }
        }

        return status;
    }

    /**
     * 设置书籍题材与置信度。
     *
     * @param bookId - 书籍 ID
     * @param primaryGenre - 主题材
     * @param secondaryGenres - 参数
     * @param confidence - 参数
     * @returns 无
     */
    async setBookGenre(bookId: string, primaryGenre: string, secondaryGenres?: string[], confidence?: number): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        book.primaryGenre = primaryGenre;
        if (secondaryGenres !== undefined) {
            book.secondaryGenres = secondaryGenres;
        }
        if (confidence !== undefined) {
            book.genreConfidence = confidence;
        }
        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 更新质量评分。
     *
     * @param bookId - 书籍 ID
     * @param scores - 分数表
     * @returns 无
     */
    async updateQualityScores(bookId: string, scores: Partial<QualityScores>): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        if (!book.qualityScores) {
            book.qualityScores = {
                overall: 0,
                style: 0,
                rhythm: 0,
                technique: 0,
                structure: 0,
                character: 0,
                foreshadow: 0,
                vectorEnabled: false,
            };
        }

        book.qualityScores = {
            ...book.qualityScores,
            ...scores,
        };
        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 按题材筛选书籍。
     *
     * @param genreId - 题材 ID
     * @returns 书籍数组
     */
    async getBooksByGenre(genreId: string): Promise<BookBasicInfo[]> {
        const result: BookBasicInfo[] = [];
        for (const book of this.books.values()) {
            if (book.primaryGenre === genreId) {
                result.push(book);
            } else if (book.secondaryGenres?.includes(genreId)) {
                result.push(book);
            }
        }
        return result;
    }

    /**
     * 基于规则/模型自动识别题材。
     *
     * @param bookId - 书籍 ID
     * @returns 题材结果或 null
     */
    async autoDetectGenre(bookId: string): Promise<{ primaryGenre: string; secondaryGenres: string[]; confidence: number } | null> {
        const book = this.books.get(bookId);
        if (!book) return null;

        const allTags = [
            ...book.themeTags,
            ...book.techniqueTags,
            ...book.customTags,
            book.name,
            book.synopsis || '',
        ].join(' ').toLowerCase();

        const genreKeywords: Record<string, string[]> = {
            xuanhuan_xianxia: ['修仙', '玄幻', '修真', '仙侠', '修炼', '功法', '法宝', '丹药', '宗门', '境界', '渡劫', '飞升', '灵根', '神识', '洞府', '秘境', '妖兽', '魔族', '仙界', '元婴', '金丹', '筑基', '炼气'],
            dushi_modern: ['都市', '重生', '系统', '神豪', '赘婿', '兵王', '校花', '总裁', '透视', '赌石', '鉴宝', '神医', '职场', '校园', '商战', '官场', '都市重生', '异能', '特种兵', '富二代'],
            keji_weilai: ['科幻', '未来', '星际', '机甲', '末世', '丧尸', '穿越', '时空', '赛博', '虚拟现实', '基因', '人工智能', '太空', '宇宙飞船', '变种人', '超能力', '末世危机', '废土'],
            lishi_junshi: ['历史', '军事', '穿越', '三国', '唐朝', '明朝', '清朝', '抗战', '特种兵', '战争', '古代', '争霸', '权谋', '宫廷', '皇帝', '将军', '谋士', '造反', '起义', '乱世'],
            xuanling_guaitan: ['灵异', '鬼怪', '惊悚', '悬疑', '恐怖', '道士', '风水', '盗墓', '阴阳', '怨灵', '驱魔', '茅山', '天师', '鬼魂', '僵尸', '探灵', '诡异', '民俗', '怪谈', '禁忌'],
            youxi_eSports: ['游戏', '电竞', '网游', '虚拟', '全息', '英雄联盟', '吃鸡', '王者', '攻略', '副本', '打怪', '升级', '装备', '公会', '战队', '职业选手', '排位', '天梯'],
            tongren_yanqing: ['同人', '言情', '爱情', '耽美', 'BL', 'GL', '甜宠', '虐恋', '穿越', '重生', '宫斗', '宅斗', '种田', '豪门', '总裁', '青春', '校园恋爱', '暗恋', '契约婚姻', '先婚后爱'],
        };

        const scores: Record<string, number> = {};
        let maxScore = 0;
        let totalMatches = 0;

        for (const [genreId, keywords] of Object.entries(genreKeywords)) {
            let score = 0;
            for (const kw of keywords) {
                const regex = new RegExp(kw.toLowerCase(), 'g');
                const matches = allTags.match(regex);
                if (matches) {
                    score += matches.length;
                }
            }
            scores[genreId] = score;
            totalMatches += score;
            if (score > maxScore) {
                maxScore = score;
            }
        }

        if (maxScore === 0) {
            return null;
        }

        const sortedGenres = Object.entries(scores)
            .filter(([, score]) => score > 0)
            .sort((a, b) => b[1] - a[1]);

        const primaryGenre = sortedGenres[0][0];
        const confidence = Math.min(maxScore / 20, 1);

        const secondaryGenres = sortedGenres
            .slice(1, 4)
            .filter(([, score]) => score >= maxScore * 0.3)
            .map(([genreId]) => genreId);

        return {
            primaryGenre,
            secondaryGenres,
            confidence,
        };
    }

    /**
     * 对单本书做题材分类。
     *
     * @param bookId - 书籍 ID
     * @returns 分类结果
     */
    async classifyBook(bookId: string): Promise<GenreClassificationResult> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const allTags = [
            ...book.themeTags,
            ...book.techniqueTags,
            ...book.customTags,
        ];

        let sampleText = '';
        try {
            sampleText = await this.getSourceText(bookId);
            sampleText = sampleText.slice(0, 5000);
        } catch {
            // 没有源文本时跳过
        }

        const result = await this.genreClassifier.classify({
            title: book.name,
            synopsis: book.synopsis,
            sampleText,
            tags: allTags,
        });

        book.genreChannel = result.channel.id;
        book.genreChannelConfidence = result.channel.confidence;
        book.primaryGenre = result.primaryGenre.id;
        book.primaryGenreConfidence = result.primaryGenre.confidence;
        book.secondaryGenres = result.secondaryGenres.map(g => g.id);
        book.primarySubGenre = result.primarySubGenre.id;
        book.primarySubGenreConfidence = result.primarySubGenre.confidence;
        book.secondarySubGenres = result.secondarySubGenres.map(sg => sg.id);
        book.genreConfidence = result.primaryGenre.confidence;
        book.genreRecommendations = result.topGenres.slice(0, 3).map(g => ({
            genreId: g.id,
            subGenreId: g.subGenreId,
            confidence: g.total,
        }));
        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();

        return result;
    }

    /**
     * 更新书籍题材。
     * @param bookId - 书籍 ID
     * @param updates - 参数值
     */
    async updateBookGenre(
        bookId: string,
        updates: {
            channel?: 'male' | 'female' | 'neutral';
            primaryGenre?: string;
            primarySubGenre?: string;
        }
    ): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        if (updates.channel !== undefined) {
            book.genreChannel = updates.channel;
        }
        if (updates.primaryGenre !== undefined) {
            book.primaryGenre = updates.primaryGenre;
        }
        if (updates.primarySubGenre !== undefined) {
            book.primarySubGenre = updates.primarySubGenre;
        }

        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 取底层知识库实例。
     * @returns 知识库
     */
    getKnowledgeBase(): WebnovelKnowledgeBase {
        return this.kb;
    }

    /**
     * 取题材分类器。
     * @returns 分类器
     */
    getGenreClassifier(): GenreClassifier {
        return this.genreClassifier;
    }

    /**
     * 取知识库根目录。
     * @returns 根目录或 undefined
     */
    getBaseDir(): string | undefined {
        return this.baseDir;
    }

    /**
     * 替换向量化提供方。
     *
     * @param embeddingProvider - 向量提供方
     * @returns 无
     */
    setEmbeddingProvider(embeddingProvider: EmbeddingProvider): void {
        this.genreClassifier = new GenreClassifier(this.kb, embeddingProvider, this.preferenceMemory);
    }

    /**
     * 批量分类指定书籍。
     *
     * @param bookIds - 书籍 ID 列表
     * @returns 书 id → 结果
     */
    async classifyBatch(bookIds: string[]): Promise<Map<string, GenreClassificationResult>> {
        const results = new Map<string, GenreClassificationResult>();
        for (const bookId of bookIds) {
            try {
                const result = await this.classifyBook(bookId);
                results.set(bookId, result);
            } catch (e) {
                log.warn(`[KnowledgeBaseManager] 批量分类失败 ${bookId}:`, e);
            }
        }
        return results;
    }

    /**
     * 分类所有未分类书籍。
     * @returns 书 id → 结果
     */
    async classifyAllUncategorized(): Promise<Map<string, GenreClassificationResult>> {
        const uncategorized = Array.from(this.books.values()).filter(b => !b.primaryGenre);
        return this.classifyBatch(uncategorized.map(b => b.id));
    }

    /**
     * recordGenreCorrection 方法。
     * @param bookId - 书籍 ID
     * @param corrections - 参数值
     */
    async recordGenreCorrection(
        bookId: string,
        corrections: {
            channel?: 'male' | 'female' | 'neutral';
            primaryGenre?: string;
            primarySubGenre?: string;
        }
    ): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

        const allTags = [
            ...book.themeTags,
            ...book.techniqueTags,
            ...book.customTags,
            book.name,
        ];

        this.preferenceMemory.recordCorrection({
            bookId,
            bookTitle: book.name,
            originalChannel: book.genreChannel,
            correctedChannel: corrections.channel,
            originalGenre: book.primaryGenre,
            correctedGenre: corrections.primaryGenre,
            originalSubGenre: book.primarySubGenre,
            correctedSubGenre: corrections.primarySubGenre,
            bookKeywords: allTags,
        });

        if (corrections.channel !== undefined) {
            book.genreChannel = corrections.channel;
        }
        if (corrections.primaryGenre !== undefined) {
            book.primaryGenre = corrections.primaryGenre;
        }
        if (corrections.primarySubGenre !== undefined) {
            book.primarySubGenre = corrections.primarySubGenre;
        }
        book.updatedAt = Date.now();

        if (this.bookInfoCache) {
            this.bookInfoCache.set(bookId, { ...book });
        }

        await this.saveBookInfo(book);
        await this.saveIndex();
    }

    /**
     * 取题材偏好记忆。
     * @returns 偏好记忆
     */
    getPreferenceMemory(): GenrePreferenceMemory {
        return this.preferenceMemory;
    }

    /**
     * 导出题材偏好为 JSON。
     * @returns JSON 文本
     */
    async exportGenrePreference(): Promise<string> {
        return this.preferenceMemory.exportConfig();
    }

    /**
     * 导入题材偏好。
     *
     * @param jsonStr - JSON 字符串
     * @returns 是否成功
     */
    async importGenrePreference(jsonStr: string): Promise<boolean> {
        const result = await this.preferenceMemory.importConfig(jsonStr);
        if (result) {
            this.genreClassifier.setPreferenceMemory(this.preferenceMemory);
        }
        return result;
    }

    /**
     * 重置题材偏好。
     * @returns 无
     */
    async resetGenrePreference(): Promise<void> {
        this.preferenceMemory.reset();
    }

    /**
     * 清空知识库缓存。
     * @returns 无
     */
    clearCache(): void {
        if (this.bookInfoCache) {
            this.bookInfoCache.clear();
        }
        if (this.breakdownCache) {
            this.breakdownCache.clear();
        }
    }

    /**
     * 失效单本书缓存。
     *
     * @param bookId - 书籍 ID
     * @returns 无
     */
    invalidateBookCache(bookId: string): void {
        if (this.bookInfoCache) {
            this.bookInfoCache.delete(bookId);
        }
        if (this.breakdownCache) {
            this.breakdownCache.deleteByPrefix(`${bookId}:`);
        }
    }

    /**
     * 清理过期缓存。
     * @returns 清理数量
     */
    pruneExpiredCache(): number {
        let count = 0;
        if (this.bookInfoCache) {
            count += this.bookInfoCache.pruneExpired();
        }
        if (this.breakdownCache) {
            count += this.breakdownCache.pruneExpired();
        }
        return count;
    }

    get cacheStats(): { bookInfoSize: number; breakdownSize: number } {
        return {
            bookInfoSize: this.bookInfoCache?.size ?? 0,
            breakdownSize: this.breakdownCache?.size ?? 0,
        };
    }

    /**
     * 把待写数据刷盘。
     * @returns 无
     */
    /** EngineRegistry 卸载契约：冲刷串行写队列 */
    async dispose(): Promise<void> {
        await this.flush();
    }

    /**
     * 冲刷串行写队列（卸载/测试隔离用）。
     *
     * @returns 无
     */
    async flush(): Promise<void> {
        await this.indexWriter.flush();
        await this.bookWriter.flush();
        await this.preferenceWriter.flush();
        await this.preferenceMemory.flush();
    }

    get hasPendingWrites(): boolean {
        return this.indexWriter.isDirty || this.bookWriter.isDirty || this.preferenceWriter.isDirty;
    }
}
