/**
 * local-vector-store-refresh.test.ts — 向量文件的跨实例刷新
 *
 * 指纹库 UI 写入向量时用的是自己的 LocalVectorStore 实例，协同引擎持有另一个实例。
 * 若实例只认一次 loaded 缓存，新指纹/重建后的样本要重启 Obsidian 才能被检索到。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { LocalVectorStore } from '../../../engine/local-vector-store';

const PROJECT = '测试项目';

const embeddingProvider = {
    embed: async (text: string) => [text.length, 1, 0],
};

function makeStore(vault: Vault): LocalVectorStore {
    return new LocalVectorStore({ vault } as any, 'project', embeddingProvider as any, PROJECT);
}

describe('LocalVectorStore 跨实例刷新', () => {
    it('另一实例新增向量后，本实例不重启即可检索到，并带回 fingerprintId', async () => {
        const vault = new Vault();
        const reader = makeStore(vault);
        expect(await reader.search('任意查询', 5)).toEqual([]);

        const writer = makeStore(vault);
        await writer.add('fp_new', ['新指纹的样本片段']);

        const results = await reader.search('新指纹的样本片段', 5);
        expect(results).toHaveLength(1);
        expect(results[0].sample).toBe('新指纹的样本片段');
        expect(results[0].fingerprintId).toBe('fp_new');
    });

    it('另一实例删除指纹后，本实例检索结果同步消失', async () => {
        const vault = new Vault();
        const reader = makeStore(vault);
        const writer = makeStore(vault);

        await writer.add('fp_gone', ['待删除的样本片段']);
        expect((await reader.search('待删除的样本片段', 5)).length).toBeGreaterThan(0);

        await writer.delete('fp_gone');
        expect(await reader.search('待删除的样本片段', 5)).toEqual([]);
    });

    it('另一实例追加样本后，本实例能读到新增条数', async () => {
        const vault = new Vault();
        const reader = makeStore(vault);
        const writer = makeStore(vault);

        await writer.add('fp_same', ['第一个样本片段']);
        expect((await reader.search('样本片段', 10)).length).toBe(1);

        await writer.add('fp_same', ['第二个样本片段']);
        expect((await reader.search('样本片段', 10)).length).toBe(2);
    });
});
