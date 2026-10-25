import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

class MockEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % 8] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'mock-embed', dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: 'mock-embed' };
    }
    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

describe('KnowledgeVectorStore — 原文分块与替换（Phase 4.3）', () => {
    let store: KnowledgeVectorStore;

    beforeEach(async () => {
        const vault = new Vault();
        // 向量只在「知识库中仍存在该书目录」时参与检索（删书遗留向量会被跳过）
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/测试书');
        await vault.createFolder('写作知识库/测试书2');
        store = new KnowledgeVectorStore({ vault } as any, new MockEmbeddingProvider());
        await store.init();
    });

    it('replaceBookSamples 会替换旧样本而不是叠加', async () => {
        await store.addBookSamples('book-1', '测试书', [
            { dimension: 'original', category: '原文片段', sample: '旧样本甲旧样本甲旧样本甲', position: 0 },
            { dimension: 'original', category: '原文片段', sample: '旧样本乙旧样本乙旧样本乙', position: 1 },
        ]);
        await store.replaceBookSamples('book-1', '测试书', [
            { dimension: 'original', category: '原文片段', sample: '新样本丙新样本丙新样本丙', position: 0 },
        ]);

        const results = await store.search('旧样本甲旧样本甲旧样本甲', { bookIds: ['book-1'], topN: 10 });
        expect(results.every(r => !r.sample.includes('旧样本'))).toBe(true);

        const newResults = await store.search('新样本丙新样本丙新样本丙', { bookIds: ['book-1'], topN: 10 });
        expect(newResults.length).toBe(1);
        expect(newResults[0].sample).toContain('新样本丙');
        expect(newResults[0].dimension).toBe('original');
    });

    it('原文维度可被检索过滤', async () => {
        await store.replaceBookSamples('book-2', '测试书2', [
            { dimension: 'original', sample: '原文片段内容', position: 0 },
            { dimension: 'style', sample: '风格分析内容', position: 1 },
        ]);

        const originalOnly = await store.search('内容', {
            bookIds: ['book-2'],
            dimensions: ['original'],
            topN: 10,
        });
        expect(originalOnly).toHaveLength(1);
        expect(originalOnly[0].dimension).toBe('original');
    });
});
