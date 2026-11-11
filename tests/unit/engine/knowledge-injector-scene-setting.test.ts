/**
 * knowledge-injector-scene-setting.test.ts — 「设定」注入的数据源维度
 *
 * 知识库拆解只产出 style/rhythm/technique/structure/character/foreshadow/original，
 * 没有 worldview 维度。旧实现按 'worldview' 检索会永远返回空，导致场景设定段静默失效。
 */

import { describe, it, expect } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';

interface SearchCall {
    topN?: number;
    bookIds?: string[];
    dimensions?: string[];
}

function makeStore(results: unknown[]): { calls: SearchCall[]; search: (q: string, o: SearchCall) => Promise<unknown[]> } {
    const calls: SearchCall[] = [];
    return {
        calls,
        search: async (_query: string, options: SearchCall) => {
            calls.push(options);
            return results;
        },
    };
}

function makeInjector(store: unknown): KnowledgeInjector {
    const injector = new KnowledgeInjector({} as any, { knowledgeVectorStore: store as any });
    injector.setReferenceBooks([{ bookId: 'b1', bookName: '参考书', weight: 1, isPrimary: true }]);
    return injector;
}

const STRUCTURE_RESULT = {
    sample: '起：主角被逐出宗门，身负禁制',
    bookId: 'b1',
    bookName: '参考书',
    dimension: 'structure',
    score: 0.8,
};

describe('KnowledgeInjector — 设定注入的数据源维度', () => {
    it('场景设定段按 structure 维度检索，不再使用不存在的 worldview', async () => {
        const store = makeStore([STRUCTURE_RESULT]);
        const injector = makeInjector(store);

        const text = await (injector as any).buildSceneWorldviewInjection(
            { outline: '主角被逐出宗门' },
            0.6,
        );

        expect(store.calls).toHaveLength(1);
        expect(store.calls[0].dimensions).toContain('structure');
        expect(store.calls[0].dimensions).not.toContain('worldview');
        expect(text).toContain('起：主角被逐出宗门');
    });

    it('正文路径的设定段使用 structure 并标注结构拆解来源', async () => {
        const store = makeStore([STRUCTURE_RESULT]);
        const injector = makeInjector(store);

        const text = await (injector as any).buildKbWorldviewInjection(
            { outline: '主角被逐出宗门' },
            0.6,
        );

        expect(store.calls[0].dimensions).toContain('structure');
        expect(store.calls[0].dimensions).not.toContain('worldview');
        expect(text).toContain('设定参考（结构拆解）');
        expect(text).toContain('起：主角被逐出宗门');
    });

    it('场景节奏段按 rhythm 维度检索，并保留硬编码节奏模式', async () => {
        const store = makeStore([
            {
                sample: '短句推进，交锋密集，转折前留半拍',
                bookId: 'b1',
                bookName: '参考书',
                dimension: 'rhythm',
                score: 0.82,
            },
        ]);
        const injector = makeInjector(store);

        const text = await (injector as any).buildSceneRhythmInjection(
            { outline: '宗门大战，主角以弱胜强' },
            0.6,
            'battle',
        );

        expect(store.calls).toHaveLength(1);
        expect(store.calls[0].dimensions).toContain('rhythm');
        expect(text).toContain('场景节奏参考模式');
        expect(text).toContain('参考节奏片段');
        expect(text).toContain('短句推进，交锋密集');
    });

    it('节奏检索无结果时回退硬编码模式，不输出空片段标题', async () => {
        const store = makeStore([]);
        const injector = makeInjector(store);

        const text = await (injector as any).buildSceneRhythmInjection(
            { outline: '宗门大战，主角以弱胜强' },
            0.6,
            'battle',
        );

        expect(store.calls).toHaveLength(1);
        expect(text).toContain('场景节奏参考模式');
        expect(text).not.toContain('参考节奏片段');
    });
});
