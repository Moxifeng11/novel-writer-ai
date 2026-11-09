import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import { kbBookDir, kbKnowledgeBaseDir, kbVectorsDir } from '@/shared/paths';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { cosineSimilarity } from './local-vector-store';
import {
    detectEmbeddingMismatch,
    getEmbeddingDimensionHint,
    getEmbeddingFingerprint,
    getEmbeddingModelName,
    type EmbeddingMismatchReason,
} from './embedding/embedding-fingerprint';
import { performanceMonitor } from '@/services/performance-monitor';
import { filterRetrievalResults, filterRetrievalResultsByScope, type RetrievalFilterScope } from '@/shared/retrieval-filter';
import { createLogger } from '@/shared/logger';
import { withWriteLock, KNOWLEDGE_VECTOR_STATE_LOCK } from '@/shared/write-lock';
import { extractKeywordTokens, keywordOverlapRatio } from '@/shared/keyword-tokens';
import {
    KNOWLEDGE_SEMANTIC_CANDIDATE_FACTOR,
    KNOWLEDGE_SEMANTIC_CANDIDATE_MIN,
} from '@/shared/thresholds';


const log = createLogger('KnowledgeVectorStore');

/**
 * 知识向量样本。
 */
export interface KnowledgeVectorSample {
    id: string;
    bookId: string;
    bookName: string;
    dimension: 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'original';
    category?: string;
    sample: string;
    vector: number[];
    position?: number;
}

/**
 * 知识检索结果。
 */
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
    /** 生成向量时使用的 embedding 模型 ID；旧文件可能没有 */
    modelId?: string;
    /** 向量维度（诊断用） */
    dimensionCount?: number;
    samples: KnowledgeVectorSample[];
}

/** 因更换 embedding 模型被跳过的书籍向量 */
export interface KnowledgeVectorModelMismatch {
    bookId: string;
    bookName: string;
    storedModelId: string;
    currentModelId: string;
    /** 不一致原因：模型指纹变化或维度变化 */
    reason?: EmbeddingMismatchReason;
}

interface KnowledgeVectorIndex {
    version: number;
    books: Array<{
        bookId: string;
        bookName: string;
        sampleCount: number;
    }>;
}

/**
 * 向量库选项。
 */
export interface KnowledgeVectorStoreOptions {
    /**
     * 判断书籍是否仍在知识库中。
     * 必须按 bookId 判定：改名只改目录名、bookId 不变，
     * 用 bookName 拼目录会把改名后的整本向量误判为孤儿。
     * 返回 undefined 表示无法判断（回退到 bookName 目录校验）。
     */
    isBookAlive?: (bookId: string) => boolean | undefined | Promise<boolean | undefined>;
}

/**
 * 知识库向量存储。
 */
export class KnowledgeVectorStore {
    /**
     * 状态锁：加载（reloadIfChanged）与所有写操作共用同一把锁。
     * 写入语义是「读现有 → 逐条 embed（长耗时）→ set → 落盘」，
     * 同一本书并发拆解、重向量化与拆解重叠时，后完成者会整体覆盖先完成者；
     * 不同书并发写也可能被对方的 reload 清空内存样本。
     * 因此这里用全局串行而不是 per-book：reload 会清空 samples，书级并行无法与它共存。
     */
    private static readonly STATE_LOCK = KNOWLEDGE_VECTOR_STATE_LOCK;
    private app: App;
    private embeddingProvider: EmbeddingProvider;
    private baseDir?: string;
    private readonly isBookAlive?: KnowledgeVectorStoreOptions['isBookAlive'];
    private fs: FileSystemPort | null = null;
    private samples: Map<string, KnowledgeVectorSample[]> = new Map();
    /**
     * 查询向量 LRU 缓存（v4.20）：
     * 同一段大纲/情绪弧在同一章的多段注入、以及重复生成时会反复 embed 同一文本，
     * 直接产生重复计费。key = 模型指纹 + 查询文本，命中即复用。
     */
    private queryVectorCache = new Map<string, number[]>();
    private queryCacheHits = 0;
    private queryCacheMisses = 0;
    private static readonly QUERY_CACHE_MAX = 100;
    private loaded = false;
    /** 上次加载时的向量文件签名（路径 + mtime + size），用于感知其他实例的新书/重建 */
    private loadedSignature: string | null = null;
    /** 因 embedding 模型不一致被跳过的书籍 */
    private modelMismatches: KnowledgeVectorModelMismatch[] = [];

    constructor(
        app: App,
        embeddingProvider: EmbeddingProvider,
        baseDir?: string,
        options: KnowledgeVectorStoreOptions = {}
    ) {
        this.app = app;
        this.embeddingProvider = embeddingProvider;
        this.baseDir = baseDir;
        this.isBookAlive = options.isBookAlive;
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

    /** 当前 embedding 指纹（provider:model@baseUrlHash） */
    private getCurrentModelId(): string {
        return getEmbeddingFingerprint(this.embeddingProvider);
    }

    /** 当前 embedding 判定上下文；维度只取 provider 已声明的值，避免加载时发探测请求 */
    private getCurrentEmbeddingContext(): { fingerprint: string; modelName: string; dimension: number | null } {
        return {
            fingerprint: this.getCurrentModelId(),
            modelName: getEmbeddingModelName(this.embeddingProvider),
            dimension: getEmbeddingDimensionHint(this.embeddingProvider),
        };
    }

    /**
     * 向量文件是否与当前 embedding 不一致。
     * B1：同时校验模型指纹与维度；旧文件没有对应字段时按兼容策略加载。
     */
    private detectMismatch(
        data: KnowledgeVectorBookFile,
        current: { fingerprint: string; modelName: string; dimension: number | null },
    ): EmbeddingMismatchReason | null {
        return detectEmbeddingMismatch(data, current);
    }

    /**
     * 因换 embedding 模型被跳过的书籍向量（文件保留，重新拆解即可按新模型重建）
     *
     * @returns 结果数组
     */
    getModelMismatches(): KnowledgeVectorModelMismatch[] {
        return [...this.modelMismatches];
    }

    /**
     * 初始化向量索引。
     */
    async init(): Promise<void> {
        await this.reloadIfChanged();
    }

    /**
     * 查询向量缓存命中统计（遥测/测试用）
     *
      * @returns number } 结果
     */
    getQueryCacheStats(): { hits: number; misses: number; size: number } {
        return { hits: this.queryCacheHits, misses: this.queryCacheMisses, size: this.queryVectorCache.size };
    }

    /** 清空查询向量缓存（切换 embedding 模型/重建索引后调用） */
    clearQueryCache(): void {
        this.queryVectorCache.clear();
        this.queryCacheHits = 0;
        this.queryCacheMisses = 0;
    }

    private async embedQuery(query: string): Promise<number[]> {
        const fingerprint = this.getCurrentEmbeddingContext().fingerprint;
        const key = `${fingerprint}\u0000${query}`;
        const cached = this.queryVectorCache.get(key);
        if (cached) {
            this.queryCacheHits++;
            // LRU：命中后移到队尾
            this.queryVectorCache.delete(key);
            this.queryVectorCache.set(key, cached);
            return cached;
        }
        this.queryCacheMisses++;
        const vector = await this.embeddingProvider.embed(query);
        this.queryVectorCache.set(key, vector);
        while (this.queryVectorCache.size > KnowledgeVectorStore.QUERY_CACHE_MAX) {
            const oldest = this.queryVectorCache.keys().next().value;
            if (oldest === undefined) break;
            this.queryVectorCache.delete(oldest);
        }
        return vector;
    }

    /**
     * 取同书同维度的邻块（v4.20 邻块扩展）：直接读内存 samples，零 I/O。
     * 返回按 position 升序的样本，用于把被 400/40 分块切开的场景拼回完整上下文。
     * @param bookIds - 书籍 ID 列表
     * @param dimension - 维度
     * @param positions - 位置列表
     * @param radius - 半径
     * @returns 结果数组
     */
    async getNeighbors(
        bookIds: string[],
        dimension: string,
        positions: number[],
        radius = 1,
    ): Promise<KnowledgeVectorSample[]> {
        await this.ensureLoaded();
        const positionSet = new Set(positions.filter((value) => Number.isFinite(value)));
        if (positionSet.size === 0) return [];

        const wanted = new Set<number>();
        for (const position of positionSet) {
            for (let offset = -radius; offset <= radius; offset++) {
                if (position + offset >= 0) wanted.add(position + offset);
            }
        }

        const found: KnowledgeVectorSample[] = [];
        for (const bookId of bookIds) {
            const samples = this.samples.get(bookId) || [];
            for (const sample of samples) {
                if (sample.dimension !== dimension) continue;
                if (typeof sample.position !== 'number') continue;
                if (wanted.has(sample.position)) found.push(sample);
            }
        }
        found.sort((a, b) => (a.position || 0) - (b.position || 0));
        return found;
    }

    private async ensureLoaded(): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, () => this.reloadIfChanged());
    }

    /**
     * 向量文件变化时重新加载。
     * 拆解调度器写入的是 EngineRegistry 的单例，协同引擎持有另一个实例；
     * 只认一次 loaded 会让新书/重新拆解后的向量在协同检索里不可见，直到重启。
     * @returns 是否成功
     */
    async reloadIfChanged(): Promise<boolean> {
        const signature = await this.computeSignature();
        if (this.loaded && (signature === null || signature === this.loadedSignature)) return false;
        const ok = await this.loadIndex();
        if (!ok) return false;
        this.loadedSignature = signature;
        this.loaded = true;
        return true;
    }

    /** 向量文件签名；目录不可读时返回 null（保留内存中的旧向量） */
    private async computeSignature(): Promise<string | null> {
        try {
            const files = await this.getFS().listFiles(this.getVectorsDir());
            const fileSignature = files
                .filter(f => f.name.endsWith('.json') && f.name !== 'index.json')
                .map(f => `${f.path}@${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`)
                .sort()
                .join('|');
            // B2：签名包含 embedding 指纹。切换模型/端点后文件本身没变，
            // 只靠 mtime 不会重载，内存里仍是旧模型向量。
            return `${this.getCurrentModelId()}::${fileSignature}`;
        } catch {
            return null;
        }
    }

    private async loadIndex(): Promise<boolean> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();

        const files = await fs.listFiles(dir).catch(() => null);
        if (!files) return false;

        // 读进临时表再整体替换：全部文件读失败时要把内存里的旧向量原样留下
        const previousSamples = this.samples;
        const previousMismatches = this.modelMismatches;
        const nextSamples = new Map<string, KnowledgeVectorSample[]>();
        this.samples = nextSamples;
        this.modelMismatches = [];
        const current = this.getCurrentEmbeddingContext();
        // 只有知识库根目录存在时才做"书还在不在"的校验：
        // 整个知识库被移动/重命名时不做剪枝，避免把仍然有效的向量判成孤儿。
        const kbRootExists = await fs.exists(kbKnowledgeBaseDir(this.baseDir)).catch(() => false);
        let skippedOrphans = 0;
        let skippedModelMismatches = 0;
        let readableFiles = 0;
        let failedFiles = 0;
        for (const file of files) {
            if (!file.name.endsWith('.json') || file.name === 'index.json') continue;
            try {
                const content = await fs.read(file.path);
                const data = JSON.parse(content) as KnowledgeVectorBookFile;
                if (data.bookId && Array.isArray(data.samples)) {
                    // 删书/重新导入后遗留的向量文件仍会被检索到，把已删除的书静默带进 prompt。
                    // 这里只跳过加载，不删文件：用户可能只是临时移走了书目录。
                    // 存活判定优先按 bookId：改名只改目录名、bookId 不变，
                    // 用 bookName 拼目录会把改名后的整本向量误判为孤儿，重启后检索永久为空。
                    const alive = data.bookId && this.isBookAlive
                        ? await this.isBookAlive(data.bookId)
                        : undefined;
                    const orphanByDir = alive === undefined
                        && kbRootExists
                        && !!data.bookName
                        && !(await fs.exists(kbBookDir(data.bookName, this.baseDir)));
                    if (alive === false || orphanByDir) {
                        skippedOrphans++;
                        continue;
                    }
                    // 换 embedding 模型后旧向量不能再参与检索：不同模型（甚至不同维度）的向量
                    // 混算会得到假相似度，维度不同还会让 cosineSimilarity 抛错。
                    // 知识库原文仍在，重新拆解即可按新模型重建，因此只跳过、不删文件。
                    const mismatchReason = this.detectMismatch(data, current);
                    if (mismatchReason) {
                        this.modelMismatches.push({
                            bookId: data.bookId,
                            bookName: data.bookName,
                            storedModelId: data.modelId || '',
                            currentModelId: current.fingerprint,
                            reason: mismatchReason,
                        });
                        skippedModelMismatches++;
                        continue;
                    }
                    this.samples.set(data.bookId, data.samples);
                    readableFiles++;
                }
            } catch (e) {
                failedFiles++;
                log.warn(`[KnowledgeVectorStore] 加载向量文件失败: ${file.path}`, e);
            }
        }
        if (skippedOrphans > 0) {
            log.info(`[KnowledgeVectorStore] 跳过 ${skippedOrphans} 个知识库中已不存在的书籍向量`);
        }
        if (skippedModelMismatches > 0) {
            log.info(`[KnowledgeVectorStore] 跳过 ${skippedModelMismatches} 个 embedding 模型/维度不一致的书籍向量，重新拆解即可按当前模型重建`);
        }
        // 一个有内容的文件都没读到、却有一堆读失败（磁盘被占用/同步冲突/权限）：
        // 不能把「这次没读到」当成「向量库是空的」——旧实现返回 true 会把签名更新到最新，
        // 之后再也不重试，整个会话的知识检索静默为空。
        if (failedFiles > 0 && readableFiles === 0) {
            log.warn(`[KnowledgeVectorStore] ${failedFiles} 个向量文件全部读取失败，保留内存中的旧向量并在下次重试`);
            this.samples = previousSamples;
            this.modelMismatches = previousMismatches;
            return false;
        }
        return true;
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
        const currentModelId = this.getCurrentModelId();
        const data: KnowledgeVectorBookFile = {
            bookId,
            bookName,
            // 模型未知时不落 'unknown'：否则以后模型可识别时会被误判成「不一致」
            ...(currentModelId !== 'unknown' ? { modelId: currentModelId } : {}),
            dimensionCount: samples[0]?.vector?.length ?? 0,
            samples,
        };

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
            // 重建后该书已按当前模型写入，不再算作不一致
            this.modelMismatches = this.modelMismatches.filter(m => m.bookId !== bookId);
        } catch (e) {
            log.warn(`[KnowledgeVectorStore] 保存向量文件失败: ${filePath}`, e);
        }
    }

    /**
     * 添加书籍样本。
     *
     * @param bookId - 书籍 ID
     * @param bookName - 书名
     * @param samples - 样本列表
     */
    async addBookSamples(
        bookId: string,
        bookName: string,
        samples: Array<Omit<KnowledgeVectorSample, 'id' | 'bookId' | 'bookName' | 'vector'> & { vector?: number[] }>
    ): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            const existingSamples = this.samples.get(bookId) || [];
            const newSamples = await this.materializeSamples(bookId, bookName, samples);

            const allSamples = [...existingSamples, ...newSamples];
            this.samples.set(bookId, allSamples);

            await this.saveBook(bookId);
            await this.saveIndex();
        });
    }

    /**
     * 用新样本替换整本书的向量。
     * 重新拆解时使用：避免旧报告样本与新原文分块叠加导致索引膨胀。
     * @param bookId - 书籍 ID
     * @param bookName - 书名
     * @param samples - 样本
     */
    async replaceBookSamples(
        bookId: string,
        bookName: string,
        samples: Array<Omit<KnowledgeVectorSample, 'id' | 'bookId' | 'bookName' | 'vector'> & { vector?: number[] }>
    ): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            const nextSamples = await this.materializeSamples(bookId, bookName, samples);
            this.samples.set(bookId, nextSamples);

            await this.saveBook(bookId);
            await this.saveIndex();
        });
    }

    private async materializeSamples(
        bookId: string,
        bookName: string,
        samples: Array<Omit<KnowledgeVectorSample, 'id' | 'bookId' | 'bookName' | 'vector'> & { vector?: number[] }>
    ): Promise<KnowledgeVectorSample[]> {
        const result: KnowledgeVectorSample[] = [];
        for (const sample of samples) {
            const vector = sample.vector || await this.embeddingProvider.embed(sample.sample);
            result.push({
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
        return result;
    }

    /**
     * 移除书籍样本。
     *
     * @param bookId - 书籍 ID
     */
    async removeBook(bookId: string): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            this.samples.delete(bookId);
            await this.saveBook(bookId);
            await this.saveIndex();
        });
    }

    /**
     * 更新书籍样本。
     *
     * @param bookId - 书籍 ID
     * @param samples - 样本列表
     */
    async updateBookSamples(bookId: string, samples: KnowledgeVectorSample[]): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            this.samples.set(bookId, samples);
            await this.saveBook(bookId);
            await this.saveIndex();
        });
    }

    /**
     * 清空索引。
     */
    async clear(): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            const bookIds = Array.from(this.samples.keys());
            this.samples.clear();

            for (const bookId of bookIds) {
                await this.saveBook(bookId);
            }
            await this.saveIndex();
        });
    }

    /**
     * 检索相似样本。
     *
     * @param query - 查询串
     * @param options - 参数
     * @returns 结果数组
     */
    async search(
        query: string,
        options?: {
            topN?: number;
            bookIds?: string[];
            dimensions?: string[];
            category?: string;
            minScore?: number;
            /**
             * 相关性过滤范围。
             * - global（默认）：所有维度共用一个最高分，保持历史行为；
             * - perDimension：按维度各自过滤。多维度合并检索（style/rhythm/technique）
             *   必须用它，否则低分维度会被高分维度按比例整段丢弃。
             */
            filterScope?: RetrievalFilterScope;
        }
    ): Promise<KnowledgeSearchResult[]> {
        const perfId = performanceMonitor.start('vectorSearch', 'vectorCalculation', undefined, {
            topN: options?.topN,
            bookCount: options?.bookIds?.length,
        });
        try {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const queryVector = await this.embedQuery(query);
        const candidateLimit = Math.max(
            KNOWLEDGE_SEMANTIC_CANDIDATE_MIN,
            topN * KNOWLEDGE_SEMANTIC_CANDIDATE_FACTOR,
        );
        const semanticCandidates: Array<{ item: KnowledgeVectorSample; semanticScore: number }> = [];
        let skippedByDimension = 0;

        // 第一遍只算语义分：大库不再对每个样本做关键词 token 化。
        for (const [bookId, samples] of this.samples) {
            if (options?.bookIds && !options.bookIds.includes(bookId)) continue;

            for (const item of samples) {
                if (options?.dimensions && !options.dimensions.includes(item.dimension)) continue;
                if (options?.category && item.category !== options.category) continue;

                // 旧向量文件没有 modelId，模型治理拦不住：维度不同就跳过，
                // 否则 cosineSimilarity 会抛错，整次知识检索都拿不到结果。
                if (item.vector.length !== queryVector.length) {
                    skippedByDimension++;
                    continue;
                }
                semanticCandidates.push({
                    item,
                    semanticScore: cosineSimilarity(queryVector, item.vector),
                });
            }
        }

        // 保守剪枝：候选不足 limit 时保持原全量行为；超过时只对语义 Top-K
        // 做关键词重排。极端情况下语义很低但关键词精确的样本可能落在 K 外。
        const rankedCandidates = semanticCandidates.length > candidateLimit
            ? semanticCandidates
                .slice()
                .sort((a, b) => b.semanticScore - a.semanticScore)
                .slice(0, candidateLimit)
            : semanticCandidates;

        const queryTokens = extractKeywordTokens(query, 120);
        const results: KnowledgeSearchResult[] = [];

        for (const { item, semanticScore } of rankedCandidates) {
            // 语义为主、关键词为辅：专有名词/标签命中时明显提分，
            // 同时避免纯关键词把语义无关的样本顶上来。
            const lexicalScore = keywordOverlapRatio(queryTokens, item.sample);
            const score = Math.min(1, semanticScore * 0.9 + lexicalScore * 0.1);

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

        const deduped = new Map<string, KnowledgeSearchResult>();
        for (const result of results) {
            const key = `${result.bookId}|${result.dimension}|${result.sample.slice(0, 80)}`;
            const existing = deduped.get(key);
            if (!existing || result.score > existing.score) deduped.set(key, result);
        }
        const ranked = [...deduped.values()];
        ranked.sort((a, b) => b.score - a.score);
        if (skippedByDimension > 0) {
            log.warn(`[KnowledgeVectorStore] 跳过 ${skippedByDimension} 个维度与当前 embedding 模型不一致的样本，请重新拆解对应书籍`);
        }
        // 只保留明显相关的样本：低分尾部在本地 8K 窗口下纯粹挤占预算。
        // 合并检索按维度过滤：单一全局阈值会让 rhythm/technique 被 style 的最高分挤压掉。
        const finalResults = (options?.filterScope === 'perDimension'
            ? filterRetrievalResultsByScope(ranked, 'perDimension')
            : filterRetrievalResults(ranked)
        ).slice(0, topN);
        performanceMonitor.end(perfId, { resultCount: finalResults.length });
        return finalResults;
        } catch (e) {
            performanceMonitor.end(perfId, { error: String(e) });
            throw e;
        }
    }

    /**
     * 重建索引。
     * @returns 重建统计
     */
    async rebuildIndex(): Promise<void> {
        await withWriteLock(KnowledgeVectorStore.STATE_LOCK, async () => {
            await this.reloadIfChanged();

            const fs = this.getFS();
            const dir = this.getVectorsDir();

            this.samples.clear();
            this.modelMismatches = [];
            const current = this.getCurrentEmbeddingContext();

            try {
                const files = await fs.listFiles(dir);
                for (const file of files) {
                    if (!file.name.endsWith('.json') || file.name === 'index.json') continue;
                    try {
                        const content = await fs.read(file.path);
                        const data = JSON.parse(content) as KnowledgeVectorBookFile;
                        if (data.bookId && Array.isArray(data.samples)) {
                            // 与 loadIndex 同一套治理：重建索引不能把旧模型的向量重新装回来
                            const mismatchReason = this.detectMismatch(data, current);
                            if (mismatchReason) {
                                this.modelMismatches.push({
                                    bookId: data.bookId,
                                    bookName: data.bookName,
                                    storedModelId: data.modelId || '',
                                    currentModelId: current.fingerprint,
                                    reason: mismatchReason,
                                });
                                continue;
                            }
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
        });
    }
}
