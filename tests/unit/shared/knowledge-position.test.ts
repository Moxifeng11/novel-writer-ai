import { describe, expect, it } from 'vitest';
import { dedupeAdjacentChunks, formatKnowledgeChunkLabel } from '../../../shared/knowledge-position';

describe('formatKnowledgeChunkLabel', () => {
    it('下标 0 显示为片段#1（position 是 0 基下标，不是比例）', () => {
        expect(formatKnowledgeChunkLabel(0)).toBe('片段#1');
    });

    it('大下标不乘 100，避免出现「位置4500%」', () => {
        expect(formatKnowledgeChunkLabel(44)).toBe('片段#45');
        expect(formatKnowledgeChunkLabel(119)).toBe('片段#120');
    });

    it('缺失 position 时返回空串，调用方不再追加位置信息', () => {
        expect(formatKnowledgeChunkLabel(undefined)).toBe('');
    });

    it('非法值（负数 / NaN / Infinity）返回空串', () => {
        expect(formatKnowledgeChunkLabel(-1)).toBe('');
        expect(formatKnowledgeChunkLabel(Number.NaN)).toBe('');
        expect(formatKnowledgeChunkLabel(Number.POSITIVE_INFINITY)).toBe('');
    });

    it('小数向下取整，不产生「片段#2.5」', () => {
        expect(formatKnowledgeChunkLabel(1.9)).toBe('片段#2');
    });
});

describe('dedupeAdjacentChunks', () => {
    const chunk = (bookId: string, position: number, score: number) => ({
        bookId, dimension: 'original', position, score,
    });

    it('同一本书 position 相邻（差 1）只保留分数更高的一条', () => {
        const result = dedupeAdjacentChunks([
            chunk('b1', 0, 0.9),
            chunk('b1', 1, 0.8),
            chunk('b1', 2, 0.7),
        ]);
        expect(result.map(r => r.position)).toEqual([0, 2]);
    });

    it('跨书不互相影响', () => {
        const result = dedupeAdjacentChunks([
            chunk('b1', 0, 0.9),
            chunk('b2', 1, 0.8),
        ]);
        expect(result).toHaveLength(2);
    });

    it('非原文维度（如 style）与缺 position 的结果原样保留', () => {
        const result = dedupeAdjacentChunks([
            { bookId: 'b1', dimension: 'style', position: 0, score: 0.9 },
            { bookId: 'b1', dimension: 'style', position: 1, score: 0.8 },
            { bookId: 'b1', dimension: 'original', score: 0.7 },
        ]);
        expect(result).toHaveLength(3);
    });

    it('maxGap 可放宽相邻判定', () => {
        const result = dedupeAdjacentChunks([
            chunk('b1', 0, 0.9),
            chunk('b1', 1, 0.8),
            chunk('b1', 2, 0.7),
        ], { maxGap: 2 });
        expect(result.map(r => r.position)).toEqual([0]);
    });
});
