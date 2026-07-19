import type { EmbeddingProvider, EmbeddingAvailability } from './embedding/embedding-provider';
import type { TokenBucketRateLimiter } from './token-bucket-rate-limiter';
import { createLogger } from '../shared/logger';


const log = createLogger('VectorEnhancer');
export interface SemanticMatchResult<T = string> {
    item: T;
    score: number;
}

export interface SimilarPair<A = string, B = string> {
    itemA: A;
    itemB: B;
    score: number;
}

export interface AvailabilityResult {
    available: boolean;
    reason?: string;
    model?: string;
}

export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    maxSize: number;
}

interface LegacyEmbeddingClient {
    embed(text: string): Promise<number[]>;
}

interface LruCacheEntry {
    value: number[];
    lastAccessed: number;
}

export class VectorEnhancer {
    private provider: EmbeddingProvider | null = null;
    private legacyClient: LegacyEmbeddingClient | null = null;
    private batchSize: number;
    private embedCache: Map<string, LruCacheEntry>;
    private maxCacheSize: number;
    private cacheHits: number = 0;
    private cacheMisses: number = 0;
    private availabilityCache: { available: boolean; timestamp: number; reason?: string; model?: string } | null;
    private readonly availabilityCacheTTL = 120_000;
    private lastUnavailableReason: string = '';
    private rateLimiter: TokenBucketRateLimiter | null = null;
    private lshHyperplanes: number[][] | null = null;
    private lshDimension: number = 0;

    constructor(
        embeddingClient: EmbeddingProvider | LegacyEmbeddingClient,
        options: { batchSize?: number; rateLimiter?: TokenBucketRateLimiter; maxCacheSize?: number } = {}
    ) {
        if ('isAvailable' in embeddingClient && 'getProviderInfo' in embeddingClient) {
            this.provider = embeddingClient as EmbeddingProvider;
        } else {
            this.legacyClient = embeddingClient as LegacyEmbeddingClient;
        }
        this.batchSize = options.batchSize ?? 50;
        this.rateLimiter = options.rateLimiter ?? null;
        this.maxCacheSize = options.maxCacheSize ?? 10000;
        this.embedCache = new Map();
        this.availabilityCache = null;
    }

    private simpleHash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    private getModelName(): string | null {
        if (this.provider) {
            try {
                return this.provider.getModelName();
            } catch {
                return null;
            }
        }
        return null;
    }

    private getCacheKey(text: string): string {
        const textHash = this.simpleHash(text);
        const modelName = this.getModelName();
        if (modelName) {
            return `${textHash}:${modelName}`;
        }
        return textHash;
    }

    private getFromCache(key: string): number[] | undefined {
        const entry = this.embedCache.get(key);
        if (entry) {
            this.embedCache.delete(key);
            entry.lastAccessed = Date.now();
            this.embedCache.set(key, entry);
            return entry.value;
        }
        return undefined;
    }

    private setInCache(key: string, value: number[]): void {
        if (this.embedCache.has(key)) {
            this.embedCache.delete(key);
        }
        this.embedCache.set(key, {
            value,
            lastAccessed: Date.now(),
        });
        this.evictIfNeeded();
    }

    private evictIfNeeded(): void {
        while (this.embedCache.size > this.maxCacheSize) {
            const firstKey = this.embedCache.keys().next().value;
            if (firstKey !== undefined) {
                this.embedCache.delete(firstKey);
            }
        }
    }

    async isAvailable(): Promise<boolean> {
        const result = await this.checkAvailability();
        return result.available;
    }

    async checkAvailability(): Promise<AvailabilityResult> {
        const now = Date.now();
        if (this.availabilityCache && (now - this.availabilityCache.timestamp) < this.availabilityCacheTTL) {
            return {
                available: this.availabilityCache.available,
                reason: this.availabilityCache.reason,
                model: this.availabilityCache.model,
            };
        }
        return this.performAvailabilityCheck();
    }

    private async performAvailabilityCheck(): Promise<AvailabilityResult> {
        try {
            let result: AvailabilityResult;
            if (this.provider) {
                const avail: EmbeddingAvailability = await this.provider.isAvailable();
                result = { available: avail.available, reason: avail.reason, model: avail.model };
            } else if (this.legacyClient) {
                const testVector = await this.legacyClient.embed('test');
                const available = Array.isArray(testVector) && testVector.length > 0;
                result = { available };
                if (!available) {
                    result.reason = '返回的向量为空';
                }
            } else {
                result = { available: false, reason: '未设置向量模型' };
            }

            if (!result.available && !result.reason) {
                result.reason = '返回的向量为空';
            }
            if (result.reason) {
                this.lastUnavailableReason = result.reason;
            }
            this.availabilityCache = {
                available: result.available,
                timestamp: Date.now(),
                reason: result.reason,
                model: result.model,
            };
            return result;
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            log.warn('[VectorEnhancer] 向量模型可用性检测失败', e);
            this.availabilityCache = {
                available: false,
                timestamp: Date.now(),
                reason,
            };
            this.lastUnavailableReason = reason;
            return { available: false, reason };
        }
    }

    async recheckAvailability(): Promise<boolean> {
        this.availabilityCache = null;
        const result = await this.checkAvailability();
        return result.available;
    }

    getUnavailableReason(): string {
        return this.lastUnavailableReason;
    }

    private async doEmbed(text: string): Promise<number[]> {
        if (this.provider) {
            return this.provider.embed(text);
        }
        if (this.legacyClient) {
            return this.legacyClient.embed(text);
        }
        throw new Error('未设置向量模型 provider');
    }

    private async doEmbedBatch(texts: string[]): Promise<number[][]> {
        if (this.provider && 'embedBatch' in this.provider) {
            try {
                return await this.provider.embedBatch(texts);
            } catch (e) {
                log.warn('[VectorEnhancer] embedBatch 失败，回退到逐个嵌入', e);
            }
        }
        const results: number[][] = [];
        for (const text of texts) {
            results.push(await this.doEmbed(text));
        }
        return results;
    }

    async embedText(text: string): Promise<number[]> {
        const cacheKey = this.getCacheKey(text);
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            this.cacheHits++;
            return cached;
        }

        this.cacheMisses++;
        try {
            if (this.rateLimiter) {
                await this.rateLimiter.acquire(1);
            }
            const vector = await this.doEmbed(text);
            this.setInCache(cacheKey, vector);
            return vector;
        } catch (e) {
            log.error('[VectorEnhancer] 文本向量化失败', e);
            throw e;
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        const results: number[][] = new Array(texts.length);
        const uncachedIndices: number[] = [];
        const uncachedTexts: string[] = [];

        for (let i = 0; i < texts.length; i++) {
            const cacheKey = this.getCacheKey(texts[i]);
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                this.cacheHits++;
                results[i] = cached;
            } else {
                this.cacheMisses++;
                uncachedIndices.push(i);
                uncachedTexts.push(texts[i]);
            }
        }

        if (uncachedTexts.length === 0) {
            return results;
        }

        for (let i = 0; i < uncachedTexts.length; i += this.batchSize) {
            const batch = uncachedTexts.slice(i, i + this.batchSize);
            let batchVectors: number[][] = [];

            try {
                if (this.rateLimiter) {
                    await this.rateLimiter.acquire(batch.length);
                }
                batchVectors = await this.doEmbedBatch(batch);
                for (let j = 0; j < batch.length; j++) {
                    const cacheKey = this.getCacheKey(batch[j]);
                    this.setInCache(cacheKey, batchVectors[j]);
                }
            } catch (e) {
                log.error(`[VectorEnhancer] 批量向量化失败，索引 ${i}`, e);
                throw e;
            }

            for (let j = 0; j < batchVectors.length; j++) {
                results[uncachedIndices[i + j]] = batchVectors[j];
            }
        }

        return results;
    }

    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async semanticMatch<T = string>(
        text: string,
        candidates: T[],
        topN: number = 10,
        textExtractor?: (item: T) => string
    ): Promise<SemanticMatchResult<T>[]> {
        try {
            const candidateTexts = candidates.map(item =>
                textExtractor ? textExtractor(item) : String(item)
            );

            const queryVector = await this.embedText(text);
            const candidateVectors = await this.embedTexts(candidateTexts);

            const results: SemanticMatchResult<T>[] = [];
            for (let i = 0; i < candidates.length; i++) {
                const score = this.cosineSimilarity(queryVector, candidateVectors[i]);
                results.push({ item: candidates[i], score });
            }

            results.sort((a, b) => b.score - a.score);
            return results.slice(0, topN);
        } catch (e) {
            log.error('[VectorEnhancer] 语义匹配失败', e);
            throw e;
        }
    }

    async findSimilarPairs<A = string, B = string>(
        textsA: A[],
        textsB: B[],
        threshold: number = 0.7,
        topPerA: number = 3,
        textExtractorA?: (item: A) => string,
        textExtractorB?: (item: B) => string
    ): Promise<SimilarPair<A, B>[]> {
        try {
            const strA = textsA.map(item =>
                textExtractorA ? textExtractorA(item) : String(item)
            );
            const strB = textsB.map(item =>
                textExtractorB ? textExtractorB(item) : String(item)
            );

            const vectorsA = await this.embedTexts(strA);
            const vectorsB = await this.embedTexts(strB);

            const useLSH = textsA.length * textsB.length > 1000;
            const effectiveThreshold = useLSH ? Math.max(threshold - 0.05, 0.5) : threshold;

            if (useLSH && vectorsA.length > 0) {
                this.ensureLSH(vectorsA[0].length);

                const hashesA = vectorsA.map(v => this.lshHash(v));
                const hashesB = vectorsB.map(v => this.lshHash(v));

                const bucketB = new Map<number, number[]>();
                for (let j = 0; j < vectorsB.length; j++) {
                    const h = hashesB[j];
                    if (!bucketB.has(h)) bucketB.set(h, []);
                    bucketB.get(h)!.push(j);
                }

                const pairs: SimilarPair<A, B>[] = [];
                let anyBucketHit = false;

                for (let i = 0; i < textsA.length; i++) {
                    const hA = hashesA[i];
                    const scores: Array<{ indexB: number; score: number }> = [];

                    const bucketsToCheck = [hA];
                    for (let bit = 0; bit < 16; bit++) {
                        bucketsToCheck.push(hA ^ (1 << bit));
                    }

                    const checkedB = new Set<number>();
                    for (const bucket of bucketsToCheck) {
                        const indices = bucketB.get(bucket);
                        if (!indices) continue;
                        for (const j of indices) {
                            if (checkedB.has(j)) continue;
                            checkedB.add(j);
                            anyBucketHit = true;
                            const score = this.cosineSimilarity(vectorsA[i], vectorsB[j]);
                            if (score >= effectiveThreshold) {
                                scores.push({ indexB: j, score });
                            }
                        }
                    }

                    scores.sort((a, b) => b.score - a.score);
                    for (const s of scores.slice(0, topPerA)) {
                        pairs.push({
                            itemA: textsA[i],
                            itemB: textsB[s.indexB],
                            score: s.score,
                        });
                    }
                }

                if (!anyBucketHit) {
                    return this.findSimilarPairsBrute(textsA, textsB, vectorsA, vectorsB, threshold, topPerA);
                }

                pairs.sort((a, b) => b.score - a.score);
                return pairs;
            }

            return this.findSimilarPairsBrute(textsA, textsB, vectorsA, vectorsB, threshold, topPerA);
        } catch (e) {
            log.error('[VectorEnhancer] 查找相似对失败', e);
            throw e;
        }
    }

    private findSimilarPairsBrute<A, B>(
        textsA: A[],
        textsB: B[],
        vectorsA: number[][],
        vectorsB: number[][],
        threshold: number,
        topPerA: number,
    ): SimilarPair<A, B>[] {
        const pairs: SimilarPair<A, B>[] = [];

        for (let i = 0; i < textsA.length; i++) {
            const scores: Array<{ indexB: number; score: number }> = [];

            for (let j = 0; j < textsB.length; j++) {
                const score = this.cosineSimilarity(vectorsA[i], vectorsB[j]);
                if (score >= threshold) {
                    scores.push({ indexB: j, score });
                }
            }

            scores.sort((a, b) => b.score - a.score);
            const topScores = scores.slice(0, topPerA);

            for (const { indexB, score } of topScores) {
                pairs.push({
                    itemA: textsA[i],
                    itemB: textsB[indexB],
                    score,
                });
            }
        }

        pairs.sort((a, b) => b.score - a.score);
        return pairs;
    }

    private ensureLSH(dimension: number): void {
        if (this.lshHyperplanes && this.lshDimension === dimension) return;

        const numBits = 16;
        this.lshHyperplanes = [];
        for (let i = 0; i < numBits; i++) {
            const plane: number[] = [];
            for (let j = 0; j < dimension; j++) {
                const u = Math.random();
                const v = Math.random();
                plane.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
            }
            this.lshHyperplanes.push(plane);
        }
        this.lshDimension = dimension;
    }

    private lshHash(vector: number[]): number {
        if (!this.lshHyperplanes) return 0;

        let hash = 0;
        for (let i = 0; i < this.lshHyperplanes.length; i++) {
            let dot = 0;
            const plane = this.lshHyperplanes[i];
            for (let j = 0; j < vector.length; j++) {
                dot += vector[j] * plane[j];
            }
            if (dot >= 0) {
                hash |= (1 << i);
            }
        }
        return hash;
    }

    clearCache(): void {
        this.embedCache.clear();
        this.availabilityCache = null;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    getCacheSize(): number {
        return this.embedCache.size;
    }

    setMaxSize(size: number): void {
        this.maxCacheSize = size;
        this.evictIfNeeded();
    }

    getMaxSize(): number {
        return this.maxCacheSize;
    }

    getCacheStats(): CacheStats {
        const total = this.cacheHits + this.cacheMisses;
        const hitRate = total > 0 ? this.cacheHits / total : 0;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate,
            size: this.embedCache.size,
            maxSize: this.maxCacheSize,
        };
    }

    resetCacheStats(): void {
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    getProvider(): EmbeddingProvider | null {
        return this.provider;
    }

    setRateLimiter(rateLimiter: TokenBucketRateLimiter | null): void {
        this.rateLimiter = rateLimiter;
    }

    getRateLimiter(): TokenBucketRateLimiter | null {
        return this.rateLimiter;
    }
}
