import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

/** 每次 embed 延迟固定时间，放大「读现有 → embed → 落盘」之间的并发窗口 */
class SlowEmbeddingProvider implements EmbeddingProvider {
    constructor(private readonly delayMs: number = 15) {}

    async embed(text: string): Promise<number[]> {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
        return [text.length, 1, 0, 0];
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'slow-embed', dimensions: 4 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'slow', model: 'slow-embed' };
    }
    getModelName(): string { return 'slow-embed'; }
    async getDimensions(): Promise<number> { return 4; }
}

function sample(text: string) {
    return { dimension: 'original' as const, category: '原文片段', sample: text, position: 0 };
}

function stored(store: KnowledgeVectorStore, bookId: string): Array<{ id: string; sample: string }> {
    return ((store as any).samples.get(bookId) ?? []) as Array<{ id: string; sample: string }>;
}

describe('KnowledgeVectorStore — 同书并发写不丢更新（A2）', () => {
    let store: KnowledgeVectorStore;
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        // 与生产一致：向量目录位于 .obsidian/plugins/<id>/data
        (vault as any).configDir = '.obsidian';
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/测试书');
        store = new KnowledgeVectorStore({ vault } as any, new SlowEmbeddingProvider());
        await store.init();
    });

    it('并发两次 addBookSamples 累加到同一本书，不互相覆盖', async () => {
        await Promise.all([
            store.addBookSamples('book-1', '测试书', [sample('甲甲甲'), sample('乙乙乙')]),
            store.addBookSamples('book-1', '测试书', [sample('丙丙丙'), sample('丁丁丁')]),
        ]);

        const all = stored(store, 'book-1');
        expect(all).toHaveLength(4);
        expect(new Set(all.map(s => s.id)).size).toBe(4);
    });

    it('并发 add 后磁盘文件与内存一致', async () => {
        await Promise.all([
            store.addBookSamples('book-1', '测试书', [sample('甲甲甲'), sample('乙乙乙')]),
            store.addBookSamples('book-1', '测试书', [sample('丙丙丙'), sample('丁丁丁')]),
        ]);

        const raw = await vault.adapter.read('.obsidian/plugins/novel-writer-ai/data/knowledge-vectors/book-1.json');
        const onDisk = JSON.parse(raw) as { samples: Array<{ id: string }> };
        expect(onDisk.samples).toHaveLength(stored(store, 'book-1').length);
        expect(new Set(onDisk.samples.map(s => s.id)).size).toBe(onDisk.samples.length);
    });

    it('并发两次 replaceBookSamples 以最后一次为准且无重复 id', async () => {
        await Promise.all([
            store.replaceBookSamples('book-1', '测试书', [sample('一'), sample('二'), sample('三')]),
            store.replaceBookSamples('book-1', '测试书', [sample('四'), sample('五')]),
        ]);

        const all = stored(store, 'book-1');
        expect(all).toHaveLength(2);
        expect(new Set(all.map(s => s.id)).size).toBe(2);
    });

    it('不同书并发写互不覆盖', async () => {
        await vault.createFolder('写作知识库/第二本');
        await Promise.all([
            store.addBookSamples('book-1', '测试书', [sample('甲甲甲')]),
            store.addBookSamples('book-2', '第二本', [sample('乙乙乙')]),
        ]);

        expect(stored(store, 'book-1')).toHaveLength(1);
        expect(stored(store, 'book-2')).toHaveLength(1);
    });
});
