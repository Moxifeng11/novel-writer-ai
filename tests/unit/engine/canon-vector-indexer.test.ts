/**
 * P2：同人考据来源接入 RAG 向量库
 *
 * 目标：考据检索到的原著资料不能只停留在设定弹窗里，要能被创作时的 RAG 检索召回，
 * 否则「同人设定补充」影响不到正文生成。
 *
 * 本文件锁定四件事：
 * 1. canon 虚拟书的 bookId 约定（`canon:<项目>`）
 * 2. 只索引可作依据的来源（官方 / 百科二手），衍生与未知来源跳过
 * 3. 写入走 replaceBookSamples（重复索引整体替换，不叠加）
 * 4. 向量库缺失/失败时优雅降级，不影响考据本身
 */

import { describe, expect, it, vi } from 'vitest';
import {
    CANON_BOOK_PREFIX,
    CANON_DIMENSION,
    canonBookIdFor,
    isCanonBookId,
    projectPathFromCanonBookId,
    isIndexableCanonSource,
    indexCanonSources,
} from '../../../engine/canon-vector-indexer';
import { createCanonSource } from '../../../shared/canon-source';
import type { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';

/** 构造来源 */
function source(url: string, tier?: string, excerpt = '这是原著设定摘录，足够长。') {
    return createCanonSource({ url, title: '资料', excerpt, ...(tier ? { tier: tier as never } : {}) }, 0);
}

const OFFICIAL = () => source('https://www.qidian.com/book/1');
const REFERENCE = () => source('https://baike.baidu.com/item/x');
const DERIVATIVE = () => source('https://archiveofourown.org/works/1');
const UNKNOWN = () => source('https://example.com/x');

/** 构造记录调用的 store 桩 */
function fakeStore() {
    const replaceBookSamples = vi.fn(async () => undefined);
    const store = { replaceBookSamples } as unknown as KnowledgeVectorStore;
    return { store, replaceBookSamples };
}

describe('canon 虚拟书 bookId 约定', () => {
    it('前缀为 canon:', () => {
        expect(CANON_BOOK_PREFIX).toBe('canon:');
        expect(canonBookIdFor('长篇小说/书A')).toBe('canon:长篇小说/书A');
    });

    it('反斜杠与首尾斜杠被归一', () => {
        expect(canonBookIdFor('\\长篇小说\\书A\\')).toBe('canon:长篇小说/书A');
        expect(canonBookIdFor('/长篇小说/书A/')).toBe('canon:长篇小说/书A');
    });

    it('空路径回落 default（不产生 canon: 空串）', () => {
        expect(canonBookIdFor('')).toBe('canon:default');
    });

    it('识别与反解', () => {
        expect(isCanonBookId('canon:长篇小说/书A')).toBe(true);
        expect(isCanonBookId('长篇小说/书A')).toBe(false);
        expect(projectPathFromCanonBookId('canon:长篇小说/书A')).toBe('长篇小说/书A');
        expect(projectPathFromCanonBookId('长篇小说/书A')).toBe('');
    });
});

describe('isIndexableCanonSource — 只索引可作依据的来源', () => {
    it('官方与百科二手可索引', () => {
        expect(isIndexableCanonSource(OFFICIAL())).toBe(true);
        expect(isIndexableCanonSource(REFERENCE())).toBe(true);
    });

    it('衍生作品与未知来源不可索引（与 FAN-2 口径一致）', () => {
        expect(isIndexableCanonSource(DERIVATIVE())).toBe(false);
        expect(isIndexableCanonSource(UNKNOWN())).toBe(false);
    });

    it('空摘录不可索引', () => {
        expect(isIndexableCanonSource(source('https://baike.baidu.com/item/x', undefined, ''))).toBe(false);
    });
});

describe('indexCanonSources — 写入向量库', () => {
    it('写入可索引来源，并统计跳过数', async () => {
        const { store, replaceBookSamples } = fakeStore();
        const outcome = await indexCanonSources(store, '长篇小说/书A', '凡人修仙传', [
            OFFICIAL(), REFERENCE(), DERIVATIVE(), UNKNOWN(),
        ]);

        expect(outcome.indexed).toBe(2);
        expect(outcome.skipped).toBe(2);
        expect(outcome.reason).toBeUndefined();
        expect(replaceBookSamples).toHaveBeenCalledTimes(1);
        const [bookId, bookName, samples] = replaceBookSamples.mock.calls[0] as unknown as [string, string, unknown[]];
        expect(bookId).toBe('canon:长篇小说/书A');
        expect(bookName).toBe('凡人修仙传（考据）');
        expect(samples).toHaveLength(2);
    });

    it('样本用 canon 维度并带等级标注（便于模型判断可信度）', async () => {
        const { store, replaceBookSamples } = fakeStore();
        await indexCanonSources(store, 'p', 'w', [OFFICIAL()]);
        const samples = (replaceBookSamples.mock.calls[0] as unknown as [string, string, Array<{ dimension: string; sample: string; category?: string; position: number }>])[2];
        expect(samples[0].dimension).toBe(CANON_DIMENSION);
        expect(samples[0].sample).toContain('[official]');
        expect(samples[0].category).toBe('official');
        expect(samples[0].position).toBe(0);
    });

    it('走 replaceBookSamples 而不是追加（重复索引不叠加）', async () => {
        const { store, replaceBookSamples } = fakeStore();
        await indexCanonSources(store, 'p', 'w', [OFFICIAL()]);
        await indexCanonSources(store, 'p', 'w', [OFFICIAL()]);
        expect(replaceBookSamples).toHaveBeenCalledTimes(2);
        // 每次只传当次来源数，不做累加
        const secondCall = replaceBookSamples.mock.calls[1] as unknown as [string, string, unknown[]];
        expect(secondCall[2]).toHaveLength(1);
    });

    it('向量库缺失时返回原因而不抛错', async () => {
        const outcome = await indexCanonSources(null, 'p', 'w', [OFFICIAL()]);
        expect(outcome.indexed).toBe(0);
        expect(outcome.reason).toContain('未初始化');
    });

    it('缺项目路径时返回原因', async () => {
        const { store } = fakeStore();
        const outcome = await indexCanonSources(store, '', 'w', [OFFICIAL()]);
        expect(outcome.indexed).toBe(0);
        expect(outcome.reason).toContain('项目路径');
    });

    it('没有可索引来源时返回原因并说明口径', async () => {
        const { store, replaceBookSamples } = fakeStore();
        const outcome = await indexCanonSources(store, 'p', 'w', [DERIVATIVE(), UNKNOWN()]);
        expect(outcome.indexed).toBe(0);
        expect(outcome.skipped).toBe(2);
        expect(outcome.reason).toContain('官方或百科');
        expect(replaceBookSamples).not.toHaveBeenCalled();
    });

    it('写入抛错时降级为 reason，不让考据失败', async () => {
        const replaceBookSamples = vi.fn(async () => { throw new Error('嵌入服务不可用'); });
        const store = { replaceBookSamples } as unknown as KnowledgeVectorStore;
        const outcome = await indexCanonSources(store, 'p', 'w', [OFFICIAL()]);
        expect(outcome.indexed).toBe(0);
        expect(outcome.reason).toContain('向量化失败');
        expect(outcome.reason).toContain('嵌入服务不可用');
    });
});
