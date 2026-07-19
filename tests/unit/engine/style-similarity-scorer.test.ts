import { describe, it, expect, vi } from 'vitest';
import { StyleSimilarityScorer } from '../../../engine/style-similarity-scorer';
import type { VectorEnhancer } from '../../../engine/vector-enhancer';
import type { KnowledgeVectorStore, KnowledgeSearchResult } from '../../../engine/knowledge-vector-store';

function makeVectorEnhancer(embedResult: number[] | Error): VectorEnhancer {
    return {
        embedText: vi.fn().mockImplementation(async (_text: string) => {
            if (embedResult instanceof Error) {
                throw embedResult;
            }
            return embedResult;
        }),
    } as unknown as VectorEnhancer;
}

function makeKnowledgeVectorStore(
    searchResults: KnowledgeSearchResult[] | Error
): KnowledgeVectorStore {
    return {
        search: vi.fn().mockImplementation(async (_query: string, _options?: unknown) => {
            if (searchResults instanceof Error) {
                throw searchResults;
            }
            return searchResults;
        }),
    } as unknown as KnowledgeVectorStore;
}

function makeSearchResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
    return {
        sample: '参考样本句',
        bookId: 'book-1',
        bookName: '测试书籍',
        dimension: 'style',
        score: 0.8,
        position: 50,
        ...overrides,
    };
}

const SAMPLE_VECTOR = [0.1, 0.2, 0.3, 0.4];

describe('StyleSimilarityScorer', () => {
    describe('score', () => {
        it('高相似度候选句通过评分', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const kvs = makeKnowledgeVectorStore([
                makeSearchResult({ score: 0.85 }),
                makeSearchResult({ score: 0.80 }),
                makeSearchResult({ score: 0.78 }),
            ]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const result = await scorer.score('春风拂过湖面，泛起涟漪');

            expect(result.passed).toBe(true);
            expect(result.degraded).toBe(false);
            expect(result.score).toBeCloseTo((0.85 + 0.80 + 0.78) / 3, 4);
            expect(result.referenceSamples).toHaveLength(3);
        });

        it('低相似度候选句触发重试提示', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const kvs = makeKnowledgeVectorStore([
                makeSearchResult({ score: 0.50 }),
                makeSearchResult({ score: 0.45 }),
                makeSearchResult({ score: 0.40 }),
            ]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const result = await scorer.score('这是一句风格迥异的文本');

            expect(result.passed).toBe(false);
            expect(result.degraded).toBe(false);
            expect(result.score).toBeCloseTo((0.50 + 0.45 + 0.40) / 3, 4);
            expect(result.retryHint).toBe('请更贴近参考风格');
            expect(result.referenceSamples).toHaveLength(3);
        });

        it('向量模型不可用时正确降级（vectorEnhancer 为 undefined）', async () => {
            const kvs = makeKnowledgeVectorStore([makeSearchResult()]);
            const scorer = new StyleSimilarityScorer(undefined, kvs);

            const result = await scorer.score('任意文本');

            expect(result.passed).toBe(false);
            expect(result.score).toBeNull();
            expect(result.degraded).toBe(true);
        });

        it('知识库不可用时正确降级（knowledgeVectorStore 为 undefined）', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const scorer = new StyleSimilarityScorer(ve, undefined);

            const result = await scorer.score('任意文本');

            expect(result.passed).toBe(false);
            expect(result.score).toBeNull();
            expect(result.degraded).toBe(true);
        });

        it('embed() 抛出异常时降级', async () => {
            const ve = makeVectorEnhancer(new Error('模型不可用'));
            const kvs = makeKnowledgeVectorStore([makeSearchResult()]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const result = await scorer.score('任意文本');

            expect(result.passed).toBe(false);
            expect(result.score).toBeNull();
            expect(result.degraded).toBe(true);
        });

        it('知识库无匹配结果时默认通过', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const kvs = makeKnowledgeVectorStore([]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const result = await scorer.score('任意文本');

            expect(result.passed).toBe(true);
            expect(result.score).toBe(1.0);
            expect(result.degraded).toBe(false);
        });

        it('position 过滤后无匹配结果时默认通过', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const kvs = makeKnowledgeVectorStore([
                makeSearchResult({ score: 0.9, position: 10 }),
                makeSearchResult({ score: 0.85, position: 20 }),
            ]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const result = await scorer.score('任意文本', { position: 80 });

            expect(result.passed).toBe(true);
            expect(result.score).toBe(1.0);
            expect(result.degraded).toBe(false);
        });

        it('自定义阈值生效', async () => {
            const ve = makeVectorEnhancer(SAMPLE_VECTOR);
            const kvs = makeKnowledgeVectorStore([
                makeSearchResult({ score: 0.70 }),
                makeSearchResult({ score: 0.70 }),
            ]);
            const scorer = new StyleSimilarityScorer(ve, kvs);

            const resultDefault = await scorer.score('文本');
            expect(resultDefault.passed).toBe(true);

            const resultStrict = await scorer.score('文本', { threshold: 0.80 });
            expect(resultStrict.passed).toBe(false);
            expect(resultStrict.retryHint).toBe('请更贴近参考风格');
        });
    });

    describe('cosineSimilarity', () => {
        it('相同向量返回 1', () => {
            const scorer = new StyleSimilarityScorer(undefined, undefined);
            const result = scorer.cosineSimilarity([1, 2, 3], [1, 2, 3]);
            expect(result).toBeCloseTo(1.0, 6);
        });

        it('正交向量返回 0', () => {
            const scorer = new StyleSimilarityScorer(undefined, undefined);
            const result = scorer.cosineSimilarity([1, 0, 0], [0, 1, 0]);
            expect(result).toBeCloseTo(0.0, 6);
        });

        it('已知向量计算正确', () => {
            const scorer = new StyleSimilarityScorer(undefined, undefined);
            const result = scorer.cosineSimilarity([1, 1, 0], [1, 0, 0]);
            expect(result).toBeCloseTo(1 / Math.sqrt(2), 6);
        });

        it('零向量返回 0', () => {
            const scorer = new StyleSimilarityScorer(undefined, undefined);
            const result = scorer.cosineSimilarity([0, 0, 0], [1, 2, 3]);
            expect(result).toBe(0);
        });

        it('维度不匹配返回 0', () => {
            const scorer = new StyleSimilarityScorer(undefined, undefined);
            const result = scorer.cosineSimilarity([1, 2], [1, 2, 3]);
            expect(result).toBe(0);
        });
    });
});
