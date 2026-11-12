/**
 * 向量落盘失败必须让调用方感知（回归锁 · 测试标准 3）
 *
 * 真实缺陷（2026-11-12 对抗性审查）：
 * `saveBook()` 内部把写盘异常 catch 成 `return false`，但 `addBookSamples` /
 * `replaceBookSamples` / `updateBookSamples` / `clear` 都写成
 * `await this.saveBook(bookId); await this.saveIndex();`——返回值被丢弃。
 *
 * 后果链：拆解完成 → `recordVectorOutcome(task)` 标 `vectorStatus='done'` →
 * 界面打 ✅ 并弹「拆解完成」→ 但向量文件从未写成功 → 重启后向量消失、
 * RAG 对这本书恒召回为空，用户以为知识库可用。
 *
 * 本文件锁定「写失败 → 抛错」：如果谁把 `saveBook` 的 false 重新吞掉，这里会红。
 */

import { describe, it, expect } from 'vitest';
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

/** 造一个可用 store，并返回「让后续写盘全部失败」的开关 */
async function makeStoreWithFailingWrites(): Promise<{
    store: KnowledgeVectorStore;
    failWrites: () => void;
}> {
    const vault = new Vault();
    await vault.createFolder('写作知识库');
    await vault.createFolder('写作知识库/测试书');

    const store = new KnowledgeVectorStore({ vault } as unknown as ConstructorParameters<typeof KnowledgeVectorStore>[0], new MockEmbeddingProvider());
    await store.init();

    const originalCreate = vault.create.bind(vault);
    const originalAdapterWrite = vault.adapter.write.bind(vault.adapter);
    let failing = false;

    (vault as unknown as { create: typeof vault.create }).create = async (path: string, data: string) => {
        if (failing) throw new Error('disk full（模拟磁盘满/只读/同步冲突）');
        return originalCreate(path, data);
    };
    (vault.adapter as unknown as { write: typeof vault.adapter.write }).write = async (path: string, data: string) => {
        if (failing) throw new Error('disk full（模拟磁盘满/只读/同步冲突）');
        return originalAdapterWrite(path, data);
    };

    return { store, failWrites: () => { failing = true; } };
}

const SAMPLE = [{ dimension: 'original' as const, category: '原文片段', sample: '样本内容样本内容', position: 0 }];

describe('KnowledgeVectorStore — 写盘失败不得谎报成功', () => {
    it('addBookSamples 写盘失败 → 抛错（不能标 done）', async () => {
        const { store, failWrites } = await makeStoreWithFailingWrites();
        failWrites();

        await expect(store.addBookSamples('book-1', '测试书', SAMPLE))
            .rejects.toThrow(/向量文件落盘失败/);
    });

    it('replaceBookSamples 写盘失败 → 抛错', async () => {
        const { store, failWrites } = await makeStoreWithFailingWrites();
        failWrites();

        await expect(store.replaceBookSamples('book-1', '测试书', SAMPLE))
            .rejects.toThrow(/向量文件落盘失败/);
    });

    it('updateBookSamples 写盘失败 → 抛错', async () => {
        const { store, failWrites } = await makeStoreWithFailingWrites();
        failWrites();

        await expect(store.updateBookSamples('book-1', [
            {
                id: 's1', bookId: 'book-1', bookName: '测试书',
                dimension: 'original', category: '原文片段',
                sample: '样本内容', position: 0, vector: [1, 0, 0, 0, 0, 0, 0, 0],
            },
        ])).rejects.toThrow(/向量文件落盘失败/);
    });

    it('写盘正常时仍然成功（守卫不能误伤正常路径）', async () => {
        const { store } = await makeStoreWithFailingWrites();
        await expect(store.addBookSamples('book-1', '测试书', SAMPLE)).resolves.toBeUndefined();
    });
});
