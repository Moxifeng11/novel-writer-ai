/**
 * knowledge-vector-store-refresh.test.ts — 知识向量的跨实例刷新
 *
 * 拆解调度器写入的是 EngineRegistry 的单例；协同引擎持有另一个 KnowledgeVectorStore。
 * 若实例只认一次 loaded 缓存，新书/重新拆解后的向量在协同检索里不可见，直到重启。
 */

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

function makeStore(vault: Vault): KnowledgeVectorStore {
    return new KnowledgeVectorStore({ vault } as any, new MockEmbeddingProvider());
}

describe('KnowledgeVectorStore — 跨实例刷新', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        // 向量只在「知识库中仍存在该书目录」时参与检索（删书遗留向量会被跳过）
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/新书');
        await vault.createFolder('写作知识库/待删书');
        await vault.createFolder('写作知识库/重拆书');
    });

    it('另一实例新增书籍样本后，本实例不重启即可检索到', async () => {
        const reader = makeStore(vault);
        await reader.init();
        expect(await reader.search('新增书的原文片段', { topN: 5 })).toEqual([]);

        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-1', '新书', [
            { dimension: 'original', category: '原文片段', sample: '新增书的原文片段', position: 0 },
        ]);

        const results = await reader.search('新增书的原文片段', { topN: 5 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].bookId).toBe('book-1');
    });

    it('另一实例删除书籍后，本实例检索结果同步消失', async () => {
        const reader = makeStore(vault);
        await reader.init();

        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-1', '待删书', [
            { dimension: 'original', category: '原文片段', sample: '待删除的原文片段', position: 0 },
        ]);
        expect((await reader.search('待删除的原文片段', { topN: 5 })).length).toBeGreaterThan(0);

        await writer.removeBook('book-1');
        expect(await reader.search('待删除的原文片段', { topN: 5 })).toEqual([]);
    });

    it('另一实例重新拆解后，本实例看到新样本而不是旧样本', async () => {
        const reader = makeStore(vault);
        await reader.init();

        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-1', '重拆书', [
            { dimension: 'original', category: '原文片段', sample: '旧报告样本片段', position: 0 },
        ]);
        expect((await reader.search('旧报告样本片段', { topN: 5 })).length).toBe(1);

        await writer.replaceBookSamples('book-1', '重拆书', [
            { dimension: 'original', category: '原文片段', sample: '新原文分块片段', position: 0 },
        ]);

        const results = await reader.search('新原文分块片段', { topN: 5 });
        expect(results.length).toBe(1);
        expect(results[0].sample).toBe('新原文分块片段');
    });

    it('文件未变化时 reloadIfChanged 返回 false', async () => {
        const store = makeStore(vault);
        await store.init();
        await store.reloadIfChanged();
        expect(await store.reloadIfChanged()).toBe(false);
    });
});

describe('KnowledgeVectorStore — 知识库已删除书籍的遗留向量', () => {
    it('知识库根目录存在时，跳过书目录已不存在的向量文件', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/在架书');

        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-live', '在架书', [
            { dimension: 'original', category: '原文片段', sample: '仍在知识库中的原文片段', position: 0 },
        ]);
        await writer.replaceBookSamples('book-gone', '已删书', [
            { dimension: 'original', category: '原文片段', sample: '已被删除的书籍原文片段', position: 0 },
        ]);

        // 新实例模拟重启：只应加载书目录仍在的向量
        const reader = makeStore(vault);
        await reader.init();

        const live = await reader.search('仍在知识库中的原文片段', { topN: 5 });
        expect(live.length).toBe(1);
        expect(live[0].bookId).toBe('book-live');
        expect(await reader.search('已被删除的书籍原文片段', { topN: 5, bookIds: ['book-gone'] })).toEqual([]);
    });

    it('知识库根目录整体缺失时不做剪枝，保留原有检索行为', async () => {
        const vault = new Vault();
        const writer = makeStore(vault);
        await writer.init();
        await writer.replaceBookSamples('book-1', '被移走的书', [
            { dimension: 'original', category: '原文片段', sample: '知识库整体移走后的原文片段', position: 0 },
        ]);

        const reader = makeStore(vault);
        await reader.init();

        const results = await reader.search('知识库整体移走后的原文片段', { topN: 5 });
        expect(results.length).toBe(1);
        expect(results[0].bookId).toBe('book-1');
    });
});
