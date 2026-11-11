import { describe, expect, it } from 'vitest';
import {
    buildKnowledgeFlowInput,
    countUncategorizedBooks,
    removeTagAt,
    summarizeTaskCounts,
} from '../../../ui/views/kb-view-logic';

/**
 * 知识库视图数据整形回归（阶段 D2 / DSH-20261112-07）。
 *
 * 锁住链路输入计数口径、未分类过滤、任务计数与标签删除的边界（越界不改数组）。
 */

const books = [
    { breakdownStatus: 'completed', vectorStatus: 'done', genreChannel: 'male', primaryGenre: '玄幻' },
    { breakdownStatus: 'completed', vectorStatus: 'failed', genreChannel: 'male' },
    { breakdownStatus: 'pending', genreChannel: 'female', primaryGenre: '言情' },
    { genreChannel: 'female' },
];

describe('buildKnowledgeFlowInput', () => {
    it('按状态统计拆解/向量数量并携带运行时字段', () => {
        const input = buildKnowledgeFlowInput(books, {
            embeddingReady: true,
            storeLoadedBooks: 2,
            storeReady: false,
            degradations: ['向量检索回退关键词'],
        });

        expect(input).toEqual({
            bookTotal: 4,
            breakdownCompleted: 2,
            vectorDone: 1,
            vectorFailed: 1,
            embeddingReady: true,
            storeLoadedBooks: 2,
            storeReady: false,
            degradations: ['向量检索回退关键词'],
        });
    });

    it('空列表全部为 0', () => {
        const input = buildKnowledgeFlowInput([], {
            embeddingReady: false,
            storeLoadedBooks: 0,
            storeReady: true,
        });
        expect(input.bookTotal).toBe(0);
        expect(input.breakdownCompleted).toBe(0);
        expect(input.vectorDone).toBe(0);
        expect(input.vectorFailed).toBe(0);
    });
});

describe('countUncategorizedBooks', () => {
    it('all 频道统计全部无主题材书籍', () => {
        expect(countUncategorizedBooks(books, 'all')).toBe(2);
    });

    it('指定频道只统计该频道', () => {
        expect(countUncategorizedBooks(books, 'male')).toBe(1);
        expect(countUncategorizedBooks(books, 'female')).toBe(1);
        expect(countUncategorizedBooks(books, 'script')).toBe(0);
    });
});

describe('summarizeTaskCounts', () => {
    it('分别统计 running / pending，忽略其它状态', () => {
        const counts = summarizeTaskCounts([
            { status: 'running' }, { status: 'running' },
            { status: 'pending' },
            { status: 'completed' }, { status: 'failed' },
        ]);
        expect(counts).toEqual({ running: 2, pending: 1 });
    });

    it('空列表返回 0/0', () => {
        expect(summarizeTaskCounts([])).toEqual({ running: 0, pending: 0 });
    });
});

describe('removeTagAt', () => {
    it('删除指定下标且不修改原数组', () => {
        const tags = ['a', 'b', 'c'];
        expect(removeTagAt(tags, 1)).toEqual(['a', 'c']);
        expect(tags).toEqual(['a', 'b', 'c']);
    });

    it('越界/非整数返回原样副本', () => {
        expect(removeTagAt(['a'], 5)).toEqual(['a']);
        expect(removeTagAt(['a'], -1)).toEqual(['a']);
        expect(removeTagAt(['a'], 1.5)).toEqual(['a']);
    });
});
