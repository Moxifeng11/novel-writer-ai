/**
 * 嵌入不可用时的关键词兜底检索（v4.83.1）
 *
 * 排查结论：默认 embedding provider 是**本地 Ollama**。用户没装/没启动 Ollama 时：
 * - 拆解后的向量化失败（状态会被标 failed，界面有警示）
 * - 但更糟的是**检索也直接抛错** → 拆解报告明明在库里却完全不可用
 *
 * 本文件锁定兜底行为：嵌入失败时退化为关键词检索，让没有嵌入模型的环境
 * 也能把拆解产物用起来（词面命中人名/地名/功法等专有名词）。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../engine/embedding/embedding-provider';

/** 永远可用的假嵌入（用于写入样本） */
class WorkingEmbeddingProvider implements EmbeddingProvider {
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
        return { available: true, model: 'working', dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'working', model: 'working' };
    }
    getModelName(): string { return 'working'; }
    async getDimensions(): Promise<number> { return 8; }
}

/** 模拟「Ollama 没启动」：embed 直接抛错 */
class BrokenEmbeddingProvider extends WorkingEmbeddingProvider {
    async embed(): Promise<number[]> {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    }
    async embedBatch(): Promise<number[][]> {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: false, reason: 'Ollama 未启动' };
    }
}

describe('关键词兜底检索', () => {
    let vault: Vault;

    beforeEach(async () => {
        vault = new Vault();
        await vault.createFolder('写作知识库');
        await vault.createFolder('写作知识库/参考书');
    });

    /** 先用可用 provider 写入样本，再换成坏 provider 读 */
    async function seedThenBreak(): Promise<KnowledgeVectorStore> {
        const writer = new KnowledgeVectorStore({ vault } as never, new WorkingEmbeddingProvider());
        await writer.init();
        await writer.replaceBookSamples('book-1', '参考书', [
            { dimension: 'character', sample: '韩立是一名出身贫寒的修仙者，性格谨慎。', position: 0 },
            { dimension: 'style', sample: '文风偏冷峻，多用短句与白描。', position: 1 },
            { dimension: 'foreshadow', sample: '掌天瓶的来历与韩立的命运密切相关。', position: 2 },
        ]);
        const reader = new KnowledgeVectorStore({ vault } as never, new BrokenEmbeddingProvider());
        await reader.init();
        return reader;
    }

    it('嵌入失败时不抛错，返回关键词命中的结果', async () => {
        const store = await seedThenBreak();

        const results = await store.search('韩立 掌天瓶', { topN: 5 });

        expect(results.length).toBeGreaterThan(0);
        const samples = results.map(r => r.sample).join('\n');
        expect(samples).toContain('韩立');
        // 完全不相关的风格样本不应排在前面
        expect(results[0].sample).not.toContain('文风偏冷峻');
    });

    it('关键词兜底仍遵守 bookIds / dimensions 过滤', async () => {
        const store = await seedThenBreak();

        const onlyCharacter = await store.search('韩立', { dimensions: ['character'], topN: 5 });
        expect(onlyCharacter.every(r => r.dimension === 'character')).toBe(true);

        const otherBook = await store.search('韩立', { bookIds: ['不存在的书'], topN: 5 });
        expect(otherBook).toHaveLength(0);
    });

    it('查询无有效关键词时返回空（不返回噪声）', async () => {
        const store = await seedThenBreak();
        const results = await store.search('的', { topN: 5 });
        expect(results).toHaveLength(0);
    });

    it('兜底结果带 bookName / dimension，可直接用于 citation', async () => {
        const store = await seedThenBreak();
        const results = await store.search('韩立', { topN: 5 });
        expect(results[0].bookName).toBe('参考书');
        expect(results[0].dimension).toBe('character');
        expect(typeof results[0].score).toBe('number');
    });
});
