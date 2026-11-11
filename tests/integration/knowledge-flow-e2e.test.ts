/**
 * 阶段 A1：知识流端到端（拆解 → 向量 → 检索 → 注入 → 归因）
 *
 * 长期目标（docs/LONG-TERM-GOAL.md）阶段 A 的第一条链路自证。
 *
 * **与既有测试的区别**：`linked-scenarios.test.ts` 把检索结果直接 mock 成
 * `KnowledgeSearchResult` 数组，只验证「注入器拿到命中之后」的上报与落盘；
 * 本文件**不 mock 中间层**——真实的 KnowledgeVectorStore 写入、真实的
 * retrieval-service 检索、真实的 KnowledgeInjector 注入。
 *
 * 这样才抓得到「各段单测都绿、整条链路却是断的」这类缺陷。事实上本文件
 * 首跑就抓到一个：`injectKnowledgeBase` 主守卫修好之后，内部 10 个 buildKb*
 * 子方法仍各自保留 `bookIds.length === 0 → return ''`，导致「没勾参考书」
 * 时整条注入链仍然静默为空。
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { KnowledgeVectorStore } from '../../engine/knowledge-vector-store';
import { KnowledgeInjector } from '../../engine/knowledge-injector';
import type { RagSource } from '../../shared/rag-sources';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../engine/embedding/embedding-provider';

const PROJECT = '长篇小说/测试书';

/** 确定性嵌入：同样的文本得到同样的向量，保证检索结果可预测 */
class DeterministicEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(16).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % 16] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'deterministic', dimensions: 16 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'deterministic', model: 'deterministic' };
    }
    getModelName(): string { return 'deterministic'; }
    async getDimensions(): Promise<number> { return 16; }
}

/** 建立「已完成拆解」的真实向量库 */
async function seedVectorStore(): Promise<KnowledgeVectorStore> {
    const vault = new Vault();
    await vault.createFolder('写作知识库');
    await vault.createFolder('写作知识库/参考书甲');
    await vault.createFolder('写作知识库/参考书乙');

    const store = new KnowledgeVectorStore({ vault } as never, new DeterministicEmbeddingProvider());
    await store.init();

    // 模拟拆解产物：technique / character / style 三个维度
    await store.replaceBookSamples('book-a', '参考书甲', [
        { dimension: 'technique', category: '伏笔', sample: '开篇埋下玉佩的来路，第三次出现时才回收，读者回看才发现早已写好。', position: 0 },
        { dimension: 'technique', category: '反转', sample: '把读者以为是盟友的人写成真正的推手，反转前给足三处暗示。', position: 1 },
        { dimension: 'character', category: '主角', sample: '主角表面散漫，实则每句话都在试探对方的底线。', position: 2 },
    ]);
    await store.replaceBookSamples('book-b', '参考书乙', [
        { dimension: 'style', category: '叙述', sample: '叙述克制，几乎不用形容词，靠动作与对白推进情绪。', position: 0 },
    ]);
    return store;
}

/** 构造只开 technique 维度的注入器（避免同一份样本被多维度重复消费） */
function makeInjector(store: KnowledgeVectorStore): KnowledgeInjector {
    const injector = new KnowledgeInjector(null as never, { knowledgeVectorStore: store });
    injector.setDimensionWeights({ character: 0, worldview: 0, style: 0, rhythm: 0, technique: 1 });
    return injector;
}

describe('阶段 A1：知识流端到端', () => {
    it('拆解样本写入向量库后，未勾参考书也能检索并注入', async () => {
        const store = await seedVectorStore();
        const injector = makeInjector(store);
        // 关键前提：**不**调用 addReferenceBook —— 模拟「用户拆解了书但没在协同写作里勾选参考书」

        const text = await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            sceneType: 'suspense',
            currentText: '他盯着那枚玉佩，第三次在同一个位置看到那道裂纹。',
        }, 0.8);

        // 链路自证：拆解样本真的出现在注入文本里
        expect(text).toBeTruthy();
        expect(text).toContain('玉佩');
        expect(text).toContain('参考书甲');
    });

    it('注入的每条来源都通过 ragSink 上报，可归因到书/维度/片段', async () => {
        const store = await seedVectorStore();
        const injector = makeInjector(store);
        const sources: RagSource[] = [];

        await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            sceneType: 'suspense',
            currentText: '他盯着那枚玉佩，第三次在同一个位置看到那道裂纹。',
            ragSink: (source) => sources.push(source),
        }, 0.8);

        expect(sources.length).toBeGreaterThan(0);
        const first = sources[0];
        expect(first.book).toBe('参考书甲');
        expect(first.dimension).toBeTruthy();
        expect(typeof first.score).toBe('number');
        expect(first.excerpt).toBeTruthy();
        // 归因必须能指回真实样本，而不是占位串
        expect(sources.some(s => s.excerpt.includes('玉佩'))).toBe(true);
    });

    it('多本书都写入时，未勾参考书也能跨书召回', async () => {
        const store = await seedVectorStore();
        // 开 style 维度，验证「不限制 bookIds」时另一本书也能被检索到
        const injector = new KnowledgeInjector(null as never, { knowledgeVectorStore: store });
        injector.setDimensionWeights({ character: 0, worldview: 0, style: 1, rhythm: 0, technique: 0 });

        const text = await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            sceneType: 'daily',
            currentText: '叙述克制，几乎不用形容词，靠动作与对白推进情绪。',
        }, 0.9);

        expect(text).toContain('参考书乙');
    });

    it('向量库为空时不注入空段（不产生噪声）', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        const store = new KnowledgeVectorStore({ vault } as never, new DeterministicEmbeddingProvider());
        await store.init();
        const injector = makeInjector(store);

        const text = await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            sceneType: 'daily',
            currentText: '任意正文内容，库里没有对应样本。',
        }, 0.8);

        expect(text).toBe('');
    });

    it('检索不可用时整条注入降级为空而不是抛错（调用方不被拖垮）', async () => {
        const brokenStore = {
            search: async () => { throw new Error('嵌入服务不可用'); },
        } as unknown as KnowledgeVectorStore;
        const injector = makeInjector(brokenStore);

        await expect(injector.injectKnowledgeBase({
            projectPath: PROJECT,
            sceneType: 'daily',
            currentText: '任意正文内容。',
        }, 0.8)).resolves.toBe('');
    });
});
