/**
 * retrieval-filter.test.ts — 检索结果相关性过滤
 *
 * 知识库/指纹检索此前只按 topN 截断，低分尾部也会注入 prompt。
 * 过滤只做「明显离群」修剪：相对最高分 + 绝对下限，至少保留最高分。
 */

import { describe, it, expect } from 'vitest';
import { filterRetrievalResults } from '../../../shared/retrieval-filter';

function items(...scores: number[]) {
    return scores.map((score, i) => ({ id: i, score }));
}

describe('filterRetrievalResults — 检索结果相关性过滤', () => {
    it('空结果返回空数组', () => {
        expect(filterRetrievalResults([])).toEqual([]);
    });

    it('丢弃明显低于最高分的尾部，保留相近结果', () => {
        const result = filterRetrievalResults(items(0.9, 0.88, 0.5));
        expect(result.map(r => r.score)).toEqual([0.9, 0.88]);
    });

    it('只有一条明显领先时至少保留它', () => {
        const result = filterRetrievalResults(items(0.6, 0.1));
        expect(result.map(r => r.score)).toEqual([0.6]);
    });

    it('最高分低于绝对下限时整批视为噪声', () => {
        expect(filterRetrievalResults(items(0.1, 0.05))).toEqual([]);
    });

    it('未排序输入返回降序结果，且不修改入参', () => {
        const input = items(0.5, 0.9, 0.88);
        const result = filterRetrievalResults(input);
        expect(result.map(r => r.score)).toEqual([0.9, 0.88]);
        expect(input.map(r => r.score)).toEqual([0.5, 0.9, 0.88]);
    });

    it('支持自定义相对比例与绝对下限', () => {
        const result = filterRetrievalResults(items(0.9, 0.5, 0.4), {
            relativeRatio: 0.5,
            absoluteMin: 0.42,
        });
        expect(result.map(r => r.score)).toEqual([0.9, 0.5]);
    });

    it('非法分数（NaN）被剔除，不影响其余结果', () => {
        const result = filterRetrievalResults(items(Number.NaN, 0.5));
        expect(result.map(r => r.score)).toEqual([0.5]);
    });
});
