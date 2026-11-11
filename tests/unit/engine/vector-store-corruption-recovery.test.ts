/**
 * 阶段 C3：常见失败的自恢复矩阵
 *
 * 长期目标阶段 C：常见失败要有**既定降级路径**，不能把「这次没读到」当成「数据不存在」。
 *
 * 本文件锁知识向量库的三类损坏场景（其余场景已在各自文件中覆盖）：
 * 1. 单个向量文件损坏 → 跳过该本，其余正常加载
 * 2. 全部向量文件损坏 → **保留内存中的旧向量**并允许下次重试
 *    （旧实现会把签名更新到最新，之后再也不重试，整个会话检索静默为空）
 * 3. 损坏文件不被删除（用户数据，可能只是同步冲突）
 *
 * 其余已覆盖的降级路径（对照）：
 * - 嵌入不可用 → 关键词兜底检索（`knowledge-vector-store-keyword-fallback.test.ts`）
 * - 指纹库坏文件 → 保留内存数据（`fingerprint-library-persist-guard.test.ts`）
 * - 知识库索引损坏 → 重建 + 留档（`knowledge-base-integrity.test.ts`）
 * - 同人设定损坏 → loadError + 注入为空（`constraint-flow-e2e.test.ts`）
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import { kbVectorsDir } from '../../../shared/paths';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

/** 确定性嵌入 */
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
        return { type: 'mock', provider: 'mock', model: 'mock-embed' } as never;
    }
    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

/** 建 vault 与书目录 */
async function makeVault(bookNames: string[]): Promise<Vault> {
    const vault = new Vault();
    await vault.createFolder('写作知识库');
    for (const name of bookNames) {
        await vault.createFolder(`写作知识库/${name}`);
    }
    return vault;
}

/** 用真实写入 API 造一本向量数据（避免手写文件格式） */
async function seedBook(store: KnowledgeVectorStore, bookId: string, bookName: string): Promise<void> {
    await store.replaceBookSamples(bookId, bookName, [{
        dimension: 'technique',
        sample: '样本内容：开篇埋下伏笔',
        position: 0,
    }]);
}

/** 取某本书的向量文件路径 */
function vectorFilePath(bookId: string): string {
    return `${kbVectorsDir()}/${bookId}.json`;
}

describe('C3-1：单个向量文件损坏', () => {
    it('跳过损坏的那本，其余正常加载', async () => {
        const vault = await makeVault(['书甲', '书乙']);
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await writer.init();
        await seedBook(writer, 'book-a', '书甲');
        await seedBook(writer, 'book-b', '书乙');

        // 把 book-b 的向量文件改坏
        const target = vault.getAbstractFileByPath(vectorFilePath('book-b'));
        expect(target).toBeTruthy();
        await vault.modify(target as never, '{ 这不是合法 JSON');

        const reader = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await reader.init();

        expect(reader.getLoadedBookIds()).toContain('book-a');
        expect(reader.getLoadedBookIds()).not.toContain('book-b');
        expect(reader.isLoaded()).toBe(true);
    });

    it('损坏文件不被删除（用户数据，可能只是同步冲突）', async () => {
        const vault = await makeVault(['书甲']);
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await writer.init();
        await seedBook(writer, 'book-a', '书甲');

        const path = vectorFilePath('book-a');
        await vault.modify(vault.getAbstractFileByPath(path) as never, '{ 坏文件');

        const reader = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await reader.init();
        // 文件仍在（只跳过加载，不删）
        expect(vault.getAbstractFileByPath(path)).toBeTruthy();
    });
});

describe('C3-2：全部向量文件损坏', () => {
    it('保留内存中的旧向量，而不是把库清空', async () => {
        const vault = await makeVault(['书甲']);
        const store = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await store.init();
        await seedBook(store, 'book-a', '书甲');
        expect(store.getLoadedBookIds()).toContain('book-a');

        // 磁盘文件改坏，触发重新加载
        await vault.modify(vault.getAbstractFileByPath(vectorFilePath('book-a')) as never, '{ 已损坏');
        await store.reloadIfChanged();

        // 全失败 → 保留内存旧数据，不清空
        expect(store.getLoadedBookIds()).toContain('book-a');
    });

    it('全部失败时允许下次重试（修复后能读到）', async () => {
        const vault = await makeVault(['书甲']);
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await writer.init();
        await seedBook(writer, 'book-a', '书甲');

        const path = vectorFilePath('book-a');
        await vault.modify(vault.getAbstractFileByPath(path) as never, '{ 坏文件');

        const reader = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await reader.init();
        expect(reader.getLoadedBookIds()).toEqual([]);

        // 修复文件后重试应能读到（没有被永久判死）
        const writer2 = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await writer2.init();
        await seedBook(writer2, 'book-a', '书甲');

        await reader.reloadIfChanged();
        expect(reader.getLoadedBookIds()).toContain('book-a');
    });
});

describe('C3-3：降级路径不会误报「库是空的」', () => {
    it('无向量文件 = 合法空库（isLoaded 为 true，数据为空）', async () => {
        const vault = await makeVault(['书甲']);
        const store = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider());
        await store.init();
        expect(store.isLoaded()).toBe(true);
        expect(store.getLoadedBookIds()).toEqual([]);
    });
});
