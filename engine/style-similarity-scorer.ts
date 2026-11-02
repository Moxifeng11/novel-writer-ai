import { VectorEnhancer } from './vector-enhancer';
import { KnowledgeVectorStore } from './knowledge-vector-store';
import { getDegradationNotifier } from '../shared/degradation-notifier';

/**
 * SimilarityScore 类型定义。
 */
export interface SimilarityScore {
    passed: boolean;
    score: number | null;
    degraded: boolean;
    retryHint?: string;
    referenceSamples?: string[];
}

/**
 * StyleSimilarityScorer 类。
 */
export class StyleSimilarityScorer {
    constructor(
        private vectorEnhancer: VectorEnhancer | undefined,
        private knowledgeVectorStore: KnowledgeVectorStore | undefined
    ) {}

    /**
     * 分数。
     * @param candidateSentence - 参数值
     * @param options - 配置项
      * @returns SimilarityScore 实例
     */
    async score(
        candidateSentence: string,
        options?: {
            position?: number;
            bookIds?: string[];
            threshold?: number;
        }
    ): Promise<SimilarityScore> {
        if (!this.vectorEnhancer || !this.knowledgeVectorStore) {
            getDegradationNotifier().notify({
                source: 'vector',
                from: 'vector',
                to: 'unchecked',
                reason: '风格相似度评分依赖未注入（vectorEnhancer/knowledgeVectorStore 缺失），跳过校验',
                severity: 'warning',
                recoverable: false,
            });
            return { passed: false, score: null, degraded: true };
        }

        let _candidateVector: number[];
        try {
            _candidateVector = await this.vectorEnhancer.embedText(candidateSentence);
        } catch (e) {
            getDegradationNotifier().notify({
                source: 'vector',
                from: 'vector',
                to: 'unchecked',
                reason: `风格相似度 embedding 失败: ${e instanceof Error ? e.message : String(e)}`,
                severity: 'warning',
                recoverable: true,
            });
            return { passed: false, score: null, degraded: true };
        }

        const threshold = options?.threshold ?? 0.65;

        const searchResults = await this.knowledgeVectorStore.search(candidateSentence, {
            topN: 100,
            bookIds: options?.bookIds,
            dimensions: ['style'],
        });

        let filtered = searchResults;
        if (options?.position !== undefined) {
            const posMin = options.position - 10;
            const posMax = options.position + 10;
            filtered = searchResults.filter(
                r => r.position !== undefined && r.position >= posMin && r.position <= posMax
            );
        }

        if (filtered.length === 0) {
            return { passed: true, score: 1.0, degraded: false };
        }

        const top3 = filtered.slice(0, 3);
        const avgScore = top3.reduce((sum, r) => sum + r.score, 0) / top3.length;

        if (avgScore < threshold) {
            return {
                passed: false,
                score: avgScore,
                degraded: false,
                retryHint: '请更贴近参考风格',
                referenceSamples: top3.map(r => r.sample),
            };
        }

        return {
            passed: true,
            score: avgScore,
            degraded: false,
            referenceSamples: top3.map(r => r.sample),
        };
    }

    /**
     * cosineSimilarity 方法。
     * @param a - 参与比较的值
     * @param b - 参与比较的值
     * @returns 数值结果
     */
    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            return 0;
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
}
