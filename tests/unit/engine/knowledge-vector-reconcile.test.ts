/**
 * knowledge-vector-reconcile.test.ts — 索引 ↔ 向量库对账回归（DSH-20261112-14）
 *
 * -08 发现的假绿：索引 0 本、向量库 1 本 → 界面「检索：已加载 1 本」。
 * 本文件锁对账纯函数三类结论与 store 层清理的 fail-closed 语义：
 * 孤儿识别 / 缺失识别 / 正常不计 / 清理只删指定 bookId / 无确认时一个不删。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Vault } from 'obsidian';
import {
    reconcileVectorBooks,
    summarizeVectorReconcile,
} from '../../../engine/knowledge-vector-reconcile';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type {
    EmbeddingAvailability,
    EmbeddingProvider,
    ProviderInfo,
} from '../../../engine/embedding/embedding-provider';

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

describe('reconcileVectorBooks 纯函数', () => {
    it('孤儿识别：向量库有、索引没有 → orphans', () => {
        const report = reconcileVectorBooks(['a'], ['a', 'ghost']);
        expect(report.orphans).toEqual(['ghost']);
        expect(report.healthy).toEqual(['a']);
        expect(report.missing).toEqual([]);
    });

    it('缺失识别：索引有、向量库没有 → missing（对应「已拆解但向量没算」）', () => {
        const report = reconcileVectorBooks(['a', 'b'], ['a']);
        expect(report.missing).toEqual(['b']);
        expect(report.orphans).toEqual([]);
        expect(report.healthy).toEqual(['a']);
    });

    it('正常不计：两边都有 → healthy，不出现在 orphans/missing', () => {
        const report = reconcileVectorBooks(['a', 'b', 'c'], ['a', 'b', 'c']);
        expect(report.healthy).toEqual(['a', 'b', 'c']);
        expect(report.orphans).toEqual([]);
        expect(report.missing).toEqual([]);
    });

    it('-08 真实场景复现：索引 0 本 + 向量库 1 本 → 全是孤儿', () => {
        const report = reconcileVectorBooks([], ['kb_mrgel8mq_niign00x']);
        expect(report.orphans).toEqual(['kb_mrgel8mq_niign00x']);
        expect(report.healthy).toEqual([]);
        expect(report.missing).toEqual([]);
    });

    it('两侧都为空：三类全空（无一致性问题）', () => {
        expect(reconcileVectorBooks([], [])).toEqual({ orphans: [], missing: [], healthy: [] });
    });

    it('重复 id 去重保序；空串与非字符串忽略', () => {
        const report = reconcileVectorBooks(
            ['a', 'a', '', 'b'] as unknown as string[],
            ['b', 'b', 'x'] as unknown as string[],
        );
        expect(report.healthy).toEqual(['b']);
        expect(report.orphans).toEqual(['x']);
        expect(report.missing).toEqual(['a']);
    });

    it('summarize：无问题返回 null；孤儿/缺失分别成句', () => {
        expect(summarizeVectorReconcile({ orphans: [], missing: [], healthy: ['a'] })).toBeNull();
        expect(summarizeVectorReconcile({ orphans: ['g'], missing: [], healthy: [] }))
            .toContain('孤儿向量');
        expect(summarizeVectorReconcile({ orphans: ['g'], missing: ['m'], healthy: [] }))
            .toContain('缺失向量');
    });
});



describe('DSH-20261112-15：单锁化与磁盘孤儿', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder('写作知识库');
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
        await writer.init();
        await writer.replaceBookSamples('kb_live', '存活书', [
            { dimension: 'original', category: '原文片段', sample: '晨星在雾里升起来', position: 0 },
        ]);
        await writer.replaceBookSamples('kb_ghost', '孤儿书', [
            { dimension: 'original', category: '原文片段', sample: '孤儿向量样本', position: 0 },
        ]);
        await writer.replaceBookSamples('kb_ghost2', '孤儿书二', [
            { dimension: 'original', category: '原文片段', sample: '第二个孤儿', position: 0 },
        ]);
    });

    function makeReader(): KnowledgeVectorStore {
        return new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
    }

    it('审计 #A4：两本书的清理只写一次索引（N 次 saveIndex 合并为 1 次）', async () => {
        const store = makeReader();
        await store.init();
        const saveIndexSpy = vi.spyOn(store as unknown as { saveIndex: () => Promise<void> }, 'saveIndex');
        const result = await store.removeOrphanVectors(['kb_ghost', 'kb_ghost2'], {
            confirmed: true,
            kbBookIds: ['kb_live'],
        });
        expect(result.removed).toEqual(['kb_ghost', 'kb_ghost2']);
        expect(saveIndexSpy).toHaveBeenCalledTimes(1);
        saveIndexSpy.mockRestore();
    });

    it('审计 #A4 回归：清理与并发 replaceBookSamples 交错不崩溃、最终状态一致', async () => {
        const store = makeReader();
        await store.init();
        // 单锁化后两个操作串行执行：结果要么是「孤儿被删、新书写入」，要么顺序相反
        const results = await Promise.allSettled([
            store.removeOrphanVectors(['kb_ghost'], { confirmed: true, kbBookIds: ['kb_live'] }),
            store.replaceBookSamples('kb_ghost', '复活书', [
                { dimension: 'original', category: '原文片段', sample: '并发写入', position: 0 },
            ]),
        ]);
        expect(results.every(r => r.status === 'fulfilled')).toBe(true);
        const ids = store.getLoadedBookIds();
        // 一致性断言：kb_ghost 要么不在（先删后写失败/未执行到写），要么在且带新样本——不存在「半删半写」
        if (ids.includes('kb_ghost')) {
            const neighbors = await store.getNeighbors(['kb_ghost'], 'original', [0], 0);
            expect(neighbors[0]?.sample).toBe('并发写入');
        }
    });

    it('磁盘孤儿识别：磁盘上有、未加载的文件进 diskUnloaded', async () => {
        const diskJson = JSON.stringify({
            bookId: 'kb_diskonly',
            bookName: '磁盘孤儿',
            samples: [{ id: 's1', bookId: 'kb_diskonly', bookName: '磁盘孤儿', dimension: 'original', category: '原文片段', sample: 'x', position: 0, vector: [1, 0] }],
        });
        // _seedFile 会登记祖先目录与文件索引（raw adapter.write 不进 vault 索引，listFiles 看不见）
        (vault as unknown as { _seedFile: (p: string, c: string) => unknown })._seedFile(
            '.obsidian/plugins/novel-writer-ai/data/knowledge-vectors/kb_diskonly.json',
            diskJson,
        );

        // isBookAlive 对 kb_diskonly 返回 false → loadIndex 跳过该文件（不进 samples）
        const reader = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, {
            isBookAlive: id => id !== 'kb_diskonly',
        });
        await reader.init();
        const report = await reader.reconcileWithIndex(['kb_live']);
        expect(report.diskUnloaded).toContain('kb_diskonly');
        // 已加载文件不进 diskUnloaded
        expect(report.diskUnloaded).not.toContain('kb_live');
        expect(report.diskUnloaded).not.toContain('kb_ghost');
        // summarize 覆盖
        expect(summarizeVectorReconcile(report)).toContain('个向量文件未加载');
    });

    it('removeDiskVectors 未确认：一个不删（fail-closed）', async () => {
        const diskJson = JSON.stringify({
            bookId: 'kb_diskonly',
            bookName: '磁盘孤儿',
            samples: [],
        });
        const path = '.obsidian/plugins/novel-writer-ai/data/knowledge-vectors/kb_diskonly.json';
        (vault as unknown as { _seedFile: (p: string, c: string) => unknown })._seedFile(path, diskJson);
        const store = makeReader();
        await store.init();
        const result = await store.removeDiskVectors(['kb_diskonly']);
        expect(result.removed).toEqual([]);
        expect(result.skipped).toEqual(['kb_diskonly']);
        expect(await vault.adapter.exists(path)).toBe(true);
    });

    it('removeDiskVectors confirmed:true：文件删除、已加载文件进 skipped 不误删', async () => {
        const diskJson = JSON.stringify({ bookId: 'kb_diskonly', bookName: '磁盘孤儿', samples: [] });
        const path = '.obsidian/plugins/novel-writer-ai/data/knowledge-vectors/kb_diskonly.json';
        (vault as unknown as { _seedFile: (p: string, c: string) => unknown })._seedFile(path, diskJson);
        const store = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, {
            isBookAlive: id => id !== 'kb_diskonly',
        });
        await store.init();
        const result = await store.removeDiskVectors(['kb_diskonly', 'kb_live'], { confirmed: true });
        expect(result.removed).toEqual(['kb_diskonly']);
        expect(result.skipped).toEqual(['kb_live']);
        expect(await vault.adapter.exists(path)).toBe(false);
    });
});

describe('审计修复回归（对抗审计 #A2/#A5/#B9）', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder('写作知识库');
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
        await writer.init();
        await writer.replaceBookSamples('kb_live', '存活书', [
            { dimension: 'original', category: '原文片段', sample: '晨星在雾里升起来', position: 0 },
        ]);
        await writer.replaceBookSamples('kb_ghost', '孤儿书', [
            { dimension: 'original', category: '原文片段', sample: '孤儿向量样本', position: 0 },
        ]);
    });

    it('审计 #A2：confirmed:true 但候选里混入已在索引的 id → store 拒绝删除（计入 skipped）', async () => {
        const store = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
        await store.init();
        const result = await store.removeOrphanVectors(['kb_ghost', 'kb_live'], {
            confirmed: true,
            kbBookIds: ['kb_live'], // kb_live 已在索引（调用方缓存陈旧混入）→ 必须拒删
        });
        expect(result.removed).toEqual(['kb_ghost']);
        expect(result.skipped).toEqual(['kb_live']);
        expect(store.getLoadedBookIds()).toContain('kb_live');
    });

    it('审计 #A2：不传 kbBookIds 保持旧行为（向后兼容），候选里的正常书也会被删', async () => {
        const store = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
        await store.init();
        const result = await store.removeOrphanVectors(['kb_live'], { confirmed: true });
        expect(result.removed).toEqual(['kb_live']);
        expect(store.getLoadedBookIds()).toEqual(['kb_ghost']);
    });

    it('审计 #B9：summarize 的 hint 追加在孤儿段末尾，缺失段不受影响', () => {
        const text = summarizeVectorReconcile(
            { orphans: ['g'], missing: ['m'], healthy: [] },
            '点「🔗 向量对账」可清理',
        );
        expect(text).toContain('孤儿向量，建议清理，点「🔗 向量对账」可清理');
        expect(text).toContain('缺失向量，建议重向量化）'); // hint 不影响缺失段
    });
});

describe('KnowledgeVectorStore 对账与显式清理', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder('写作知识库');
        // 书名目录未在 mock vault 里建：注入存活判定，避免 loadIndex 按 orphanByDir 跳过
        const writer = new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
        await writer.init();
        await writer.replaceBookSamples('kb_live', '存活书', [
            { dimension: 'original', category: '原文片段', sample: '晨星在雾里升起来', position: 0 },
        ]);
        await writer.replaceBookSamples('kb_ghost', '孤儿书', [
            { dimension: 'original', category: '原文片段', sample: '孤儿向量样本', position: 0 },
        ]);
    });

    function makeReader(): KnowledgeVectorStore {
        return new KnowledgeVectorStore({ vault } as never, new MockEmbeddingProvider(), undefined, { isBookAlive: () => true });
    }

    it('store.reconcileWithIndex：列出孤儿与正常（存活判定不注入，按 id 对账）', async () => {
        const reader = makeReader();
        await reader.init();
        const report = await reader.reconcileWithIndex(['kb_live']);
        expect(report.healthy).toEqual(['kb_live']);
        expect(report.orphans).toEqual(['kb_ghost']);
        expect(report.missing).toEqual([]);
    });

    it('清理未确认（confirmed 缺省）→ 一个都不删', async () => {
        const store = makeReader();
        await store.init();
        const result = await store.removeOrphanVectors(['kb_ghost']);
        expect(result.removed).toEqual([]);
        expect(result.skipped).toEqual(['kb_ghost']);
        expect(store.getLoadedBookIds()).toContain('kb_ghost');
    });

    it('清理 confirmed:false → 同样一个都不删（fail-closed）', async () => {
        const store = makeReader();
        await store.init();
        const result = await store.removeOrphanVectors(['kb_ghost'], { confirmed: false });
        expect(result.removed).toEqual([]);
        expect(result.skipped).toEqual(['kb_ghost']);
        expect(store.getLoadedBookIds()).toContain('kb_ghost');
    });

    it('清理 confirmed:true → 只删指定 bookId，正常书不受影响', async () => {
        const store = makeReader();
        await store.init();
        const result = await store.removeOrphanVectors(['kb_ghost'], { confirmed: true });
        expect(result.removed).toEqual(['kb_ghost']);
        expect(result.skipped).toEqual([]);
        expect(store.getLoadedBookIds()).toEqual(['kb_live']);
        // 重启后（新实例读盘）孤儿确实消失
        const reloaded = makeReader();
        await reloaded.init();
        expect(reloaded.getLoadedBookIds()).toEqual(['kb_live']);
    });

    it('清理传入未加载的 id → 计入 skipped，不抛错不误删', async () => {
        const store = makeReader();
        await store.init();
        const result = await store.removeOrphanVectors(['kb_live', 'kb_never_existed'], { confirmed: true });
        expect(result.removed).toEqual(['kb_live']);
        expect(result.skipped).toEqual(['kb_never_existed']);
    });

    it('批量清理：混合已加载与未加载，只动已加载的指定项', async () => {
        const store = makeReader();
        await store.init();
        const result = await store.removeOrphanVectors(['kb_ghost', 'kb_noop'], { confirmed: true });
        expect(result.removed).toEqual(['kb_ghost']);
        expect(result.skipped).toEqual(['kb_noop']);
        expect(store.getLoadedBookIds()).toEqual(['kb_live']);
    });
});
