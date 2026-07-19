import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { kbVectorsDir } from '../shared/paths';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { cosineSimilarity } from './local-vector-store';
import { performanceMonitor } from '../services/performance-monitor';
import { createLogger } from '../shared/logger';


const log = createLogger('KnowledgeVectorStore');
export interface KnowledgeVectorSample {
    id: string;
    bookId: string;
    bookName: string;
    dimension: 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow';
    category?: string;
    sample: string;
    vector: number[];
    position?: number;
}

export interface KnowledgeSearchResult {
    sample: string;
    bookId: string;
    bookName: string;
    dimension: string;
    category?: string;
    score: number;
    position?: number;
}

interface KnowledgeVectorBookFile {
    bookId: string;
    bookName: string;
    samples: KnowledgeVectorSample[];
}

interface KnowledgeVectorIndex {
    version: number;
    books: Array<{
        bookId: string;
        bookName: string;
        sampleCount: number;
    }>;
}

export class KnowledgeVectorStore {
    private app: App;
    private embeddingProvider: EmbeddingProvider;
    private baseDir?: string;
    private fs: FileSystemPort | null = null;
    private samples: Map<string, KnowledgeVectorSample[]> = new Map();
    private loaded = false;

    constructor(
        app: App,
        embeddingProvider: EmbeddingProvider,
        baseDir?: string
    ) {
        this.app = app;
        this.embeddingProvider = embeddingProvider;
        this.baseDir = baseDir;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private getVectorsDir(): string {
        return kbVectorsDir();
    }

    private getBookFilePath(bookId: string): string {
        return `${this.getVectorsDir()}/${bookId}.json`;
    }

    private getIndexFilePath(): string {
        return `${this.getVectorsDir()}/index.json`;
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    async init(): Promise<void> {
        if (this.loaded) return;
        await this.loadIndex();
        this.loaded = true;
    }

    private async ensureLoaded(): Promise<void> {
        if (!this.loaded) {
            await this.init();
        }
    }

    private async loadIndex(): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();

        try {
            const files = await fs.listFiles(dir);
            for (const file of files) {
                if (!file.name.endsWith('.json') || file.name === 'index.json') continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as KnowledgeVectorBookFile;
                    if (data.bookId && Array.isArray(data.samples)) {
                        this.samples.set(data.bookId, data.samples);
                    }
                } catch (e) {
                    log.warn(`[KnowledgeVectorStore] 加载向量文件失败: ${file.path}`, e);
                }
            }
        } catch {
            // 目录不存在时静默处理
        }
    }

    private async saveIndex(): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const indexPath = this.getIndexFilePath();

        const index: KnowledgeVectorIndex = {
            version: 1,
            books: [],
        };

        for (const [bookId, samples] of this.samples) {
            if (samples.length === 0) continue;
            const firstSample = samples[0];
            index.books.push({
                bookId,
                bookName: firstSample.bookName,
                sampleCount: samples.length,
            });
        }

        try {
            await fs.mkdir(dir);
            await fs.write(indexPath, JSON.stringify(index, null, 2));
        } catch (e) {
            log.warn(`[KnowledgeVectorStore] 保存索引文件失败: ${indexPath}`, e);
        }
    }

    private async saveBook(bookId: string): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const filePath = this.getBookFilePath(bookId);

        const samples = this.samples.get(bookId);
        if (!samples || samples.length === 0) {
            try {
                await fs.delete(filePath);
            } catch {
                // 文件不存在时忽略
            }
            return;
        }

        const bookName = samples[0].bookName;
        const data: KnowledgeVectorBookFile = {
            bookId,
            bookName,
            samples,
        };

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            log.warn(`[KnowledgeVectorStore] 保存向量文件失败: ${filePath}`, e);
        }
    }

    async addBookSamples(
        bookId: string,
        bookName: string,
        samples: Array<Omit<KnowledgeVectorSample, 'id' | 'bookId' | 'bookName' | 'vector'> & { vector?: number[] }>
    ): Promise<void> {
        await this.ensureLoaded();

        const existingSamples = this.samples.get(bookId) || [];
        const newSamples: KnowledgeVectorSample[] = [];

        for (const sample of samples) {
            const vector = sample.vector || await this.embeddingProvider.embed(sample.sample);
            newSamples.push({
                id: this.generateId(),
                bookId,
                bookName,
                dimension: sample.dimension,
                category: sample.category,
                sample: sample.sample,
                vector,
                position: sample.position,
            });
        }

        const allSamples = [...existingSamples, ...newSamples];
        this.samples.set(bookId, allSamples);

        await this.saveBook(bookId);
        await this.saveIndex();
    }

    async removeBook(bookId: string): Promise<void> {
        await this.ensureLoaded();

        this.samples.delete(bookId);
        await this.saveBook(bookId);
        await this.saveIndex();
    }

    async updateBookSamples(bookId: string, samples: KnowledgeVectorSample[]): Promise<void> {
        await this.ensureLoaded();

        this.samples.set(bookId, samples);
        await this.saveBook(bookId);
        await this.saveIndex();
    }

    async clear(): Promise<void> {
        await this.ensureLoaded();

        const bookIds = Array.from(this.samples.keys());
        this.samples.clear();

        for (const bookId of bookIds) {
            await this.saveBook(bookId);
        }
        await this.saveIndex();
    }

    async search(
        query: string,
        options?: {
            topN?: number;
            bookIds?: string[];
            dimensions?: string[];
            category?: string;
            minScore?: number;
        }
    ): Promise<KnowledgeSearchResult[]> {
        const perfId = performanceMonitor.start('vectorSearch', 'vectorCalculation', undefined, {
            topN: options?.topN,
            bookCount: options?.bookIds?.length,
        });
        try {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const queryVector = await this.embeddingProvider.embed(query);
        const results: KnowledgeSearchResult[] = [];

        for (const [bookId, samples] of this.samples) {
            if (options?.bookIds && !options.bookIds.includes(bookId)) continue;

            for (const item of samples) {
                if (options?.dimensions && !options.dimensions.includes(item.dimension)) continue;
                if (options?.category && item.category !== options.category) continue;

                const score = cosineSimilarity(queryVector, item.vector);

                if (options?.minScore !== undefined && score < options.minScore) continue;

                results.push({
                    sample: item.sample,
                    bookId: item.bookId,
                    bookName: item.bookName,
                    dimension: item.dimension,
                    category: item.category,
                    score,
                    position: item.position,
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        const finalResults = results.slice(0, topN);
        performanceMonitor.end(perfId, { resultCount: finalResults.length });
        return finalResults;
        } catch (e) {
            performanceMonitor.end(perfId, { error: String(e) });
            throw e;
        }
    }

    async rebuildIndex(): Promise<void> {
        await this.ensureLoaded();

        const fs = this.getFS();
        const dir = this.getVectorsDir();

        this.samples.clear();

        try {
            const files = await fs.listFiles(dir);
            for (const file of files) {
                if (!file.name.endsWith('.json') || file.name === 'index.json') continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as KnowledgeVectorBookFile;
                    if (data.bookId && Array.isArray(data.samples)) {
                        this.samples.set(data.bookId, data.samples);
                    }
                } catch (e) {
                    log.warn(`[KnowledgeVectorStore] 重建索引时跳过损坏的文件: ${file.path}`, e);
                }
            }

            await this.saveIndex();
            log.info(`[KnowledgeVectorStore] 索引重建完成，共 ${this.samples.size} 本书，${Array.from(this.samples.values()).reduce((sum, s) => sum + s.length, 0)} 个向量样本`);
        } catch (e) {
            log.error('[KnowledgeVectorStore] 重建索引失败:', e);
            throw e;
        }
    }
}
