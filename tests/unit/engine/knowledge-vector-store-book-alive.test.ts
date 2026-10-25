import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

/**
 * 书籍改名只改目录名、bookId 不变；向量文件里的 bookName 仍是旧名。
 * 若存活校验按 bookName 拼目录，改名后整本书向量会被判孤儿（重启后检索为空）。
 * 这里锁定「按 bookId 判存活」与「无法判断时回退旧行为」。
 */

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

function makeStore(vault: Vault, isBookAlive?: (bookId: string) => boolean): KnowledgeVectorStore {
    return new KnowledgeVectorStore(
        { vault } as any,
        new MockEmbeddingProvider(),
        undefined,
        isBookAlive ? { isBookAlive } : undefined,
    );
}

describe('KnowledgeVectorStore — 书籍存活判定改用 bookId', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder('写作知识库');
    });

    async function seedVector(): Promise<void> {
        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-renamed', '旧书名', [
            { dimension: 'original', category: '原文片段', sample: '林默推门，雨声灌了进来', position: 0 },
        ]);
    }

    it('bookId 仍存活时，即使 bookName 目录不存在也参与检索', async () => {
        await seedVector();

        const reader = makeStore(vault, bookId => bookId === 'book-renamed');
        await reader.init();

        const results = await reader.search('林默推门，雨声灌了进来', { topN: 3 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].bookId).toBe('book-renamed');
    });

    it('bookId 已被删除时跳过向量', async () => {
        await seedVector();

        const reader = makeStore(vault, () => false);
        await reader.init();

        expect(await reader.search('林默推门，雨声灌了进来', { topN: 3 })).toEqual([]);
    });

    it('没有存活判定函数时回退到 bookName 目录校验（旧行为）', async () => {
        await seedVector();

        const reader = makeStore(vault);
        await reader.init();

        expect(await reader.search('林默推门，雨声灌了进来', { topN: 3 })).toEqual([]);
    });
});
