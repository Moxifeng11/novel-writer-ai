import type { EmbeddingProvider, EmbeddingAvailability } from './embedding/embedding-provider';
import type { TokenBucketRateLimiter } from './token-bucket-rate-limiter';
import type { CharacterCandidate, AnalysisSuggestion } from './types/analysis-suggestion';
import { createLogger } from '@/shared/logger';


const log = createLogger('VectorEnhancer');
/**
 * SemanticMatchResult 类型定义。
 */
export interface SemanticMatchResult<T = string> {
    item: T;
    score: number;
}

/**
 * SimilarPair 类型定义。
 */
export interface SimilarPair<A = string, B = string> {
    itemA: A;
    itemB: B;
    score: number;
}

/**
 * AvailabilityResult 类型定义。
 */
export interface AvailabilityResult {
    available: boolean;
    reason?: string;
    model?: string;
}

/**
 * CacheStats 类型定义。
 */
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

/**
 * VectorEnhancer 类。
 */
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

    /**
     * 向量服务是否可用（缓存结果）。
     * @returns 布尔值
     */
    async isAvailable(): Promise<boolean> {
        const result = await this.checkAvailability();
        return result.available;
    }

    /**
     * 主动探测向量服务可用性。
     * @returns 探测结果
     */
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

    /**
     * 强制重新探测并更新缓存。
     * @returns 是否可用
     */
    async recheckAvailability(): Promise<boolean> {
        this.availabilityCache = null;
        const result = await this.checkAvailability();
        return result.available;
    }

    /**
     * 不可用原因（用于 UI 提示）。
     * @returns 原因文本
     */
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

    /**
     * 把单段文本转成向量。
     *
     * @param text - 文本内容
     * @returns 向量
     */
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

    /**
     * 批量转向量。
     *
     * @param texts - 文本列表
     * @returns 向量数组
     */
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

    /**
     * 计算两个向量的余弦相似度。
     *
     * @param a - 参与比较的左侧值
     * @param b - 参与比较的右侧值
     * @returns 相似度 0–1
     */
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

    /**
     * semanticMatch 方法。
     * @param text - 文本内容
     * @param candidates - 参数值
     * @param topN - 参数值
     * @param textExtractor - 参数值
     * @returns 结果数组
     */
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

    /**
     * findSimilarPairs 方法。
     * @param textsA - 参数值
     * @param textsB - 参数值
     * @param threshold - 参数值
     * @param topPerA - 参数值
     * @param textExtractorA - 参数值
     * @param textExtractorB - 参数值
     * @returns 结果数组
     */
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

    /**
     * 清空向量缓存。
     * @returns 无
     */
    clearCache(): void {
        this.embedCache.clear();
        this.availabilityCache = null;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * 缓存条目数。
     * @returns 数量
     */
    getCacheSize(): number {
        return this.embedCache.size;
    }

    /**
     * 设置缓存上限。
     *
     * @param size - 尺寸
     * @returns 无
     */
    setMaxSize(size: number): void {
        this.maxCacheSize = size;
        this.evictIfNeeded();
    }

    /**
     * 读取缓存上限。
     * @returns 数量
     */
    getMaxSize(): number {
        return this.maxCacheSize;
    }

    /**
     * 读取缓存命中统计。
     * @returns 统计对象
     */
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

    /**
     * 重置缓存统计。
     * @returns 无
     */
    resetCacheStats(): void {
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * 当前向量提供方。
     * @returns 提供方或 null
     */
    getProvider(): EmbeddingProvider | null {
        return this.provider;
    }

    /**
     * 注入/移除限流器。
     *
     * @param rateLimiter - 限流器
     * @returns 无
     */
    setRateLimiter(rateLimiter: TokenBucketRateLimiter | null): void {
        this.rateLimiter = rateLimiter;
    }

    /**
     * 取当前限流器。
     * @returns 限流器或 null
     */
    getRateLimiter(): TokenBucketRateLimiter | null {
        return this.rateLimiter;
    }

    /**
     * 用语义相似度过滤掉明显不是人名的候选
     * 通过计算候选词上下文与"人名"语义原型的相似度，调整置信度
     * @param candidates 角色候选列表
     * @param text 原文文本（用于提取上下文）
     * @returns 过滤后的候选列表，每个候选的 confidence 会被更新
     */
    async filterCandidatesBySemantics(
        candidates: CharacterCandidate[],
        text: string
    ): Promise<CharacterCandidate[]> {
        if (candidates.length === 0 || !text) {
            return candidates;
        }

        const available = await this.isAvailable();
        if (!available) {
            log.warn('[VectorEnhancer] 向量模型不可用，跳过语义过滤');
            return candidates;
        }

        try {
            const namePrototypes = [
                '他是一个很有才华的人',
                '她微笑着点了点头',
                '这个人性格开朗',
                '那位先生走了过来',
                '这位女士名叫',
            ];

            const prototypeVectors = await this.embedTexts(namePrototypes);
            const prototypeAvg = this.averageVectors(prototypeVectors);

            const result: CharacterCandidate[] = [];
            for (const candidate of candidates) {
                const contextSentences = this.extractContextSentences(text, candidate.name, 3);
                if (contextSentences.length === 0) {
                    result.push({ ...candidate });
                    continue;
                }

                const contextVectors = await this.embedTexts(contextSentences);
                const contextAvg = this.averageVectors(contextVectors);

                const similarity = this.cosineSimilarity(prototypeAvg, contextAvg);

                const factor = 0.5 + similarity * 0.7;
                const clampedFactor = Math.max(0.5, Math.min(1.2, factor));

                const newConfidence = candidate.confidence * clampedFactor;
                const clampedConfidence = Math.max(0.1, Math.min(0.99, newConfidence));

                result.push({
                    ...candidate,
                    confidence: clampedConfidence,
                });
            }

            result.sort((a, b) => b.confidence - a.confidence);
            return result;
        } catch (e) {
            log.error('[VectorEnhancer] 语义过滤失败，返回原候选', e);
            return candidates;
        }
    }

    /**
     * 基于上下文向量相似度合并同一角色的不同称呼（如"克莱恩"和"愚者"）
     * 生成 character_merge 类型的建议，不直接修改候选列表
     * @param candidates 角色候选列表
     * @param text 原文文本
     * @returns 合并建议列表
     */
    async mergeCandidatesByContextSimilarity(
        candidates: CharacterCandidate[],
        text: string
    ): Promise<AnalysisSuggestion[]> {
        if (candidates.length < 2 || !text) {
            return [];
        }

        const available = await this.isAvailable();
        if (!available) {
            log.warn('[VectorEnhancer] 向量模型不可用，跳过上下文合并');
            return [];
        }

        try {
            const contextVectors: number[][] = [];
            const validCandidates: CharacterCandidate[] = [];

            for (const candidate of candidates) {
                const contextSentences = this.extractContextSentences(text, candidate.name, 10);
                if (contextSentences.length < 2) {
                    continue;
                }

                const vectors = await this.embedTexts(contextSentences);
                const avgVector = this.averageVectors(vectors);
                contextVectors.push(avgVector);
                validCandidates.push(candidate);
            }

            if (validCandidates.length < 2) {
                return [];
            }

            const mergeSuggestions: AnalysisSuggestion[] = [];
            const threshold = 0.85;
            const processedPairs = new Set<string>();

            for (let i = 0; i < validCandidates.length; i++) {
                for (let j = i + 1; j < validCandidates.length; j++) {
                    const candA = validCandidates[i];
                    const candB = validCandidates[j];

                    const pairKey = [candA.name, candB.name].sort().join('|');
                    if (processedPairs.has(pairKey)) continue;
                    processedPairs.add(pairKey);

                    if (this.hasCharOverlap(candA.name, candB.name)) {
                        continue;
                    }

                    if (this.appearInSameSentence(text, candA.name, candB.name)) {
                        continue;
                    }

                    const similarity = this.cosineSimilarity(contextVectors[i], contextVectors[j]);
                    if (similarity < threshold) continue;

                    const primary = candA.mentionCount >= candB.mentionCount ? candA : candB;
                    const secondary = candA.mentionCount >= candB.mentionCount ? candB : candA;

                    mergeSuggestions.push({
                        id: '',
                        type: 'character_merge',
                        status: 'pending',
                        confidence: Math.min(0.95, similarity),
                        source: 'vector',
                        payload: {
                            sourceName: secondary.name,
                            targetName: primary.name,
                            similarity,
                        },
                        createdAt: Date.now(),
                        reason: `基于上下文语义相似度（${similarity.toFixed(3)}），"${secondary.name}"与"${primary.name}"可能是同一角色的不同称呼`,
                        evidence: [
                            `上下文向量相似度: ${similarity.toFixed(3)}`,
                            `"${secondary.name}"出现 ${secondary.mentionCount} 次`,
                            `"${primary.name}"出现 ${primary.mentionCount} 次`,
                        ],
                    });
                }
            }

            mergeSuggestions.sort((a, b) => b.confidence - a.confidence);
            return mergeSuggestions;
        } catch (e) {
            log.error('[VectorEnhancer] 上下文合并失败，返回空建议', e);
            return [];
        }
    }

    /**
     * 计算多个向量的平均值
     */
    private averageVectors(vectors: number[][]): number[] {
        if (vectors.length === 0) return [];
        const dim = vectors[0].length;
        const result = new Array(dim).fill(0);
        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) {
                result[i] += vec[i];
            }
        }
        for (let i = 0; i < dim; i++) {
            result[i] /= vectors.length;
        }
        return result;
    }

    /**
     * 提取文本中包含关键词的句子
     * @param text 原文
     * @param keyword 关键词
     * @param maxCount 最大句子数
     */
    private extractContextSentences(text: string, keyword: string, maxCount: number): string[] {
        const sentences: string[] = [];
        let idx = 0;

        while ((idx = text.indexOf(keyword, idx)) !== -1 && sentences.length < maxCount) {
            let start = idx;
            while (start > 0 && !/[。！？!?；;\n]/.test(text[start - 1])) {
                start--;
            }

            let end = idx + keyword.length;
            while (end < text.length && !/[。！？!?\n]/.test(text[end])) {
                end++;
            }
            if (end < text.length && /[。！？!?]/.test(text[end])) end++;

            const sentence = text.substring(start, end).trim();
            if (sentence && !sentences.includes(sentence)) {
                sentences.push(sentence);
            }

            idx = end;
        }

        return sentences;
    }

    /**
     * 检查两个名字是否有字符重叠
     */
    private hasCharOverlap(a: string, b: string): boolean {
        for (const char of a) {
            if (b.includes(char)) return true;
        }
        return false;
    }

    /**
     * 检查两个名字是否出现在同一句话中
     */
    private appearInSameSentence(text: string, nameA: string, nameB: string): boolean {
        const sentences = text.split(/[。！？!?\n]+/);
        for (const sentence of sentences) {
            if (sentence.includes(nameA) && sentence.includes(nameB)) {
                return true;
            }
        }
        return false;
    }
}
