/**
 * retrieval-filter-b3.test.ts — 合并检索的相关性过滤与节奏排序
 *
 * 缺陷：style/rhythm/technique 合并成一次检索后共用全局最高分过滤。
 * style 0.6、rhythm 0.45 时，rhythm 被 0.6×0.85=0.51 整段丢弃：
 * 同一 query 分维度检索有内容，协同注入为空。
 * 另一处：情绪方向下节奏结果按 position 排序，与「相关度优先」相悖。
 */

import { describe, it, expect, vi } from 'vitest';
import {
    filterRetrievalResultsByScope,
    type DimensionScoredItem,
} from '../../../shared/retrieval-filter';
import { PromptBuilder } from '../../../engine/prompt-builder';
import type { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';

describe('B3 — 按维度过滤', () => {
    const results: DimensionScoredItem[] = [
        { dimension: 'style', score: 0.6 },
        { dimension: 'rhythm', score: 0.45 },
        { dimension: 'technique', score: 0.41 },
    ];

    it('global：低分维度被高分维度的相对阈值丢弃', () => {
        // 0.6 × 0.85 = 0.51 > 0.45 / 0.41
        expect(filterRetrievalResultsByScope(results, 'global').map(r => r.dimension))
            .toEqual(['style']);
    });

    it('perDimension：每个维度各自过滤，低分维度保留自己的最高分', () => {
        const kept = filterRetrievalResultsByScope(results, 'perDimension');
        expect(kept.map(r => r.dimension)).toEqual(['style', 'rhythm', 'technique']);
        // 合并后仍按分数降序
        expect(kept.map(r => r.score)).toEqual([0.6, 0.45, 0.41]);
    });

    it('perDimension 只在组内淘汰离群值', () => {
        const kept = filterRetrievalResultsByScope([
            { dimension: 'style', score: 0.9 },
            { dimension: 'rhythm', score: 0.45 },
            { dimension: 'rhythm', score: 0.2 },
        ], 'perDimension');

        // rhythm 组内阈值 0.45×0.85=0.3825，0.2 被淘汰；style 不受 rhythm 影响
        expect(kept.map(r => r.score)).toEqual([0.9, 0.45]);
    });

    it('默认 scope 保持 global 行为（向后兼容）', () => {
        expect(filterRetrievalResultsByScope(results).map(r => r.dimension)).toEqual(['style']);
    });
});

describe('B3 — PromptBuilder 合并检索与节奏排序', () => {
    function makeBuilder(search: any): PromptBuilder {
        const builder = new PromptBuilder(() => null, null, null, null, null);
        builder.setReferenceBooks(['book-1']);
        builder.setKnowledgeBase(null, { search } as unknown as KnowledgeVectorStore);
        return builder;
    }

    it('合并检索传入 filterScope=perDimension', async () => {
        const search = vi.fn(async (_q: string, opts?: { dimensions?: string[] }) => {
            if (opts?.dimensions?.includes('original')) return [];
            return [];
        });
        const builder = makeBuilder(search);

        await builder.getKnowledgePromptParts('他推开门，屋里没有人。', 'emotion');

        expect(search.mock.calls[0][1]).toMatchObject({
            dimensions: ['style', 'rhythm', 'technique'],
            filterScope: 'perDimension',
        });
    });

    it('情绪方向的节奏参考按 score 降序，而不是按 position', async () => {
        const search = vi.fn(async (_q: string, opts?: { dimensions?: string[] }) => {
            if (opts?.dimensions?.includes('original')) return [];
            return [
                {
                    sample: '低分节奏样本低分节奏样本',
                    bookId: 'book-1',
                    bookName: '书一',
                    dimension: 'rhythm',
                    score: 0.42,
                    position: 99,
                },
                {
                    sample: '高分节奏样本高分节奏样本',
                    bookId: 'book-1',
                    bookName: '书一',
                    dimension: 'rhythm',
                    score: 0.88,
                    position: 1,
                },
            ];
        });
        const builder = makeBuilder(search);

        const text = (await builder.getKnowledgePromptParts('他推开门。', 'emotion')).join('\n');

        expect(text).toContain('高分节奏样本');
        expect(text.indexOf('高分节奏样本')).toBeLessThan(text.indexOf('低分节奏样本'));
    });
});
