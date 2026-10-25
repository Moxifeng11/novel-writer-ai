/**
 * knowledge-injector-original-dedup.test.ts — 文风注入的相邻原文块去重
 *
 * 原文按 400 字 / 40 字重叠分块，相邻块同时命中时会把重叠文字重复注入，
 * 直接浪费本地小窗口的 prompt 预算。
 */

import { describe, it, expect } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';

function makeResult(sample: string, position: number | undefined, score: number, dimension = 'original') {
    return { sample, bookId: 'b1', bookName: '参考书', dimension, position, score };
}

describe('KnowledgeInjector — 文风注入去重', () => {
    it('相邻原文块只注入一条，并多取候选避免去重后条数不足', async () => {
        const calls: Array<{ topN?: number; dimensions?: string[] }> = [];
        const store = {
            search: async (_q: string, options: { topN?: number; dimensions?: string[] }) => {
                calls.push(options);
                // style 与 original 分别检索：风格样本不会再被原文分块挤掉
                if (options.dimensions?.includes('style')) {
                    return [makeResult('风格特征样本', undefined, 0.7, 'style')];
                }
                return [
                    makeResult('第一段原文（含重叠尾部）', 0, 0.9),
                    makeResult('第二段原文（含重叠头部）', 1, 0.85),
                    makeResult('第三段原文', 2, 0.8),
                ];
            },
        };
        const injector = new KnowledgeInjector({} as any, { knowledgeVectorStore: store as any });
        injector.setReferenceBooks([{ bookId: 'b1', bookName: '参考书', weight: 1, isPrimary: true }]);

        const text = await (injector as any).buildKbStyleInjection(
            { currentText: '他推开门，屋里没有人。' },
            0.8,
        );

        // strength 0.8 → topN = 4、风格配额 1、原文配额 3，原文多取一倍 = 6 条候选
        const styleCall = calls.find(c => c.dimensions?.includes('style'));
        const originalCall = calls.find(c => c.dimensions?.includes('original'));
        expect(styleCall?.topN).toBe(4);
        expect(originalCall?.topN).toBe(6);
        expect(text).toContain('第一段原文');
        expect(text).not.toContain('第二段原文');
        expect(text).toContain('第三段原文');
        expect(text).toContain('风格特征样本');
    });
});
