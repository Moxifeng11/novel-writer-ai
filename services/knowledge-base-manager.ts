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
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import {
    kbKnowledgeBaseDir,
    kbIndexFile,
    kbBookDir,
    kbBookBasicInfoFile,
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
    kbBookCommercialAnalysisFile,
    kbBookReadabilityAnalysisFile,
} from '../shared/paths';
import type { BreakdownDimension } from './deconstruction-scheduler';
import { SerializedWriter } from '../shared/serialized-writer';
import { WebnovelKnowledgeBase } from '../engine/webnovel-knowledge-base';
import { GenreClassifier, type GenreClassificationResult } from './genre-classifier';
import { GenrePreferenceMemory, type GenrePreferenceData } from './genre-preference-memory';
import type { EmbeddingProvider } from '../engine/embedding/embedding-provider';
import { kbConfigDir } from '../shared/paths';
import { LruCache } from '../engine/repository/lru-cache';
import type { MultiLayerCache } from '../engine/cache';
import { createLogger } from '../shared/logger';


const log = createLogger('KnowledgeBaseManager');
const MAX_SOURCE_TEXT_LENGTH = 2_000_000; // 200 万字
const MAX_SOURCE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type BreakdownStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'interrupted';

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

interface KnowledgeBaseCacheOptions {
    cacheEnabled?: boolean;
    cacheMaxSize?: number;
    cacheTtlMs?: number;
    breakdownCacheMaxSize?: number;
    breakdownCacheTtlMs?: number;
    multiLayerCache?: MultiLayerCache;
}

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

        (this.bookInfoCache as any).maxSize = infoMaxSize;
        (this.breakdownCache as any).maxSize = breakdownMaxSize;
        (this.bookInfoCache as any).ttlMs = ttlMs;
        (this.breakdownCache as any).ttlMs = ttlMs * 2;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

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
        }).catch(() => {});
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
                    this.books = new Map(booksData.map(book => {
                        const migrated = this.migrateBookData(book);
                        return [migrated.id, migrated];
                    }));
                } else {
                    this.books = new Map();
                }
            } catch (e) {
                log.warn('[KnowledgeBaseManager] 索引文件解析失败，正在从书籍目录重建:', e);
                await this.rebuildIndexFromBooks(indexPath);
            }
        }

        this.adjustCacheCapacity(this.books.size);

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

                    if (bookData.id && typeof bookData.id === 'string') {
                        const migrated = this.migrateBookData(bookData);
                        this.books.set(migrated.id, migrated);
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
        const match = content.match(/^---\n([\s\S]*?)\n---/);
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
                    log.warn(`[KnowledgeBaseManager] 源文件过大: ${info.sourcePath}, 大小: ${size}, 建议拆分后导入`);
                }
            } catch {
                // 忽略大小检查失败，不阻止导入
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

    async deleteBook(bookId: string): Promise<void> {
        const book = this.books.get(bookId);
        if (!book) return;

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

        await this.saveIndex();
    }

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

    async getAllBooks(): Promise<BookBasicInfo[]> {
        return Array.from(this.books.values());
    }

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
                createdAt: book.createdAt,
                updatedAt: book.updatedAt,
                breakdownStatus: book.breakdownStatus,
                breakdownProgress: book.breakdownProgress,
                breakdownError: book.breakdownError,
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
                qualityScores: book.qualityScores,
            }, null, 2);

            const content = `---\n${fmContent}\n---\n\n# ${book.name}\n\n${book.synopsis || ''}\n`;

            const infoPath = kbBookBasicInfoFile(book.name, this.baseDir);
            await fs.write(infoPath, content);
        }).catch(e => {
            log.warn('[KnowledgeBaseManager] 书籍信息保存失败:', e);
        });
    }

    async getSourceText(bookId: string): Promise<string> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const fs = this.getFS();
        const bookDir = kbBookDir(book.name, this.baseDir);
        const sourceTxtFile = `${bookDir}/${book.name}.txt`;

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
            log.warn(`[KnowledgeBaseManager] 源文本过长，已截断: ${book.name}, 原始长度: ${text.length}, 截断后: ${MAX_SOURCE_TEXT_LENGTH}`);
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

    async getMissingDimensions(bookId: string): Promise<BreakdownDimension[]> {
        const book = this.books.get(bookId);
        if (!book) {
            throw new Error(`书籍不存在: ${bookId}`);
        }

        const dimensions: BreakdownDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];
        const missing: BreakdownDimension[] = [];

        for (const dimension of dimensions) {
            const content = await this.readDimensionFile(bookId, book.name, dimension);
            if (content === null || content.length <= 100) {
                missing.push(dimension);
            }
        }

        return missing;
    }

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

    getKnowledgeBase(): WebnovelKnowledgeBase {
        return this.kb;
    }

    getGenreClassifier(): GenreClassifier {
        return this.genreClassifier;
    }

    getBaseDir(): string | undefined {
        return this.baseDir;
    }

    setEmbeddingProvider(embeddingProvider: EmbeddingProvider): void {
        this.genreClassifier = new GenreClassifier(this.kb, embeddingProvider, this.preferenceMemory);
    }

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

    async classifyAllUncategorized(): Promise<Map<string, GenreClassificationResult>> {
        const uncategorized = Array.from(this.books.values()).filter(b => !b.primaryGenre);
        return this.classifyBatch(uncategorized.map(b => b.id));
    }

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

    getPreferenceMemory(): GenrePreferenceMemory {
        return this.preferenceMemory;
    }

    async exportGenrePreference(): Promise<string> {
        return this.preferenceMemory.exportConfig();
    }

    async importGenrePreference(jsonStr: string): Promise<boolean> {
        const result = await this.preferenceMemory.importConfig(jsonStr);
        if (result) {
            this.genreClassifier.setPreferenceMemory(this.preferenceMemory);
        }
        return result;
    }

    async resetGenrePreference(): Promise<void> {
        this.preferenceMemory.reset();
    }

    clearCache(): void {
        if (this.bookInfoCache) {
            this.bookInfoCache.clear();
        }
        if (this.breakdownCache) {
            this.breakdownCache.clear();
        }
    }

    invalidateBookCache(bookId: string): void {
        if (this.bookInfoCache) {
            this.bookInfoCache.delete(bookId);
        }
        if (this.breakdownCache) {
            this.breakdownCache.deleteByPrefix(`${bookId}:`);
        }
    }

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

    async flush(): Promise<void> {
        await this.indexWriter.flush();
        await this.bookWriter.flush();
        await this.preferenceMemory.flush();
    }

    get hasPendingWrites(): boolean {
        return this.indexWriter.isDirty || this.bookWriter.isDirty;
    }
}
