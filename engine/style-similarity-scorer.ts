import { VectorEnhancer } from './vector-enhancer';
import { KnowledgeVectorStore } from './knowledge-vector-store';
import type { StyleFingerprintLibrary } from './style-fingerprint-library';
import { getDegradationNotifier } from '@/shared/degradation-notifier';

/**
 * SimilarityScore 类型定义。
 */
export interface SimilarityScore {
    passed: boolean;
    score: number | null;
    degraded: boolean;
    retryHint?: string;
    referenceSamples?: string[];
    /** 本次评分实际使用的参考源 */
    referenceSource: 'fingerprint' | 'knowledge' | 'none';
}

/**
 * StyleSimilarityScorer 类。
 */
export class StyleSimilarityScorer {
    constructor(
        private vectorEnhancer: VectorEnhancer | undefined,
        private knowledgeVectorStore: KnowledgeVectorStore | undefined,
        private fingerprintLibrary?: StyleFingerprintLibrary,
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
        const threshold = options?.threshold ?? 0.65;

        // 1) 指纹优先：用户配置的写作指纹就是最直接的目标风格。
        const fingerprintRef = await this.scoreByFingerprint(candidateSentence);
        if (fingerprintRef) {
            if (fingerprintRef.score < threshold) {
                return {
                    passed: false,
                    score: fingerprintRef.score,
                    degraded: false,
                    retryHint: '请更贴近参考指纹风格',
                    referenceSamples: fingerprintRef.names,
                    referenceSource: 'fingerprint',
                };
            }
            return {
                passed: true,
                score: fingerprintRef.score,
                degraded: false,
                referenceSamples: fingerprintRef.names,
                referenceSource: 'fingerprint',
            };
        }

        // 2) 知识库 style 向量兜底。
        if (!this.vectorEnhancer || !this.knowledgeVectorStore) {
            getDegradationNotifier().notify({
                source: 'vector',
                from: 'vector',
                to: 'unchecked',
                reason: '风格相似度评分依赖未注入（vectorEnhancer/knowledgeVectorStore 缺失），跳过校验',
                severity: 'warning',
                recoverable: false,
            });
            return { passed: true, score: null, degraded: true, referenceSource: 'none' };
        }

        try {
            await this.vectorEnhancer.embedText(candidateSentence);
        } catch (e) {
            getDegradationNotifier().notify({
                source: 'vector',
                from: 'vector',
                to: 'unchecked',
                reason: `风格相似度 embedding 失败: ${e instanceof Error ? e.message : String(e)}`,
                severity: 'warning',
                recoverable: true,
            });
            return { passed: true, score: null, degraded: true, referenceSource: 'none' };
        }

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
            // 没有参考样本时不能伪装成 1.0 通过；放行但不重试，并标记降级。
            return { passed: true, score: null, degraded: true, referenceSource: 'none' };
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
                referenceSource: 'knowledge',
            };
        }

        return {
            passed: true,
            score: avgScore,
            degraded: false,
            referenceSamples: top3.map(r => r.sample),
            referenceSource: 'knowledge',
        };
    }

    /**
     * 指纹参考评分：只使用实际启用的指纹，取 top3 平均。
     *
     * @param candidateSentence - 待评分文本
     * @returns 分数与指纹名；无启用指纹或无向量时返回 null
     */
    private async scoreByFingerprint(candidateSentence: string): Promise<{ score: number; names: string[] } | null> {
        const library = this.fingerprintLibrary;
        if (!library) return null;
        try {
            const results = await library.searchSimilarStyles(candidateSentence, {
                topN: 3,
                scopes: ['template', 'global', 'project'],
            });
            const enabled = results.filter(result =>
                library.isFingerprintEnabledForInjection(result.fingerprintId, result.scope),
            );
            if (enabled.length === 0) return null;
            const top = enabled.slice(0, 3);
            return {
                score: top.reduce((sum, result) => sum + result.overallScore, 0) / top.length,
                names: top.map(result => result.fingerprintName),
            };
        } catch {
            return null;
        }
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
