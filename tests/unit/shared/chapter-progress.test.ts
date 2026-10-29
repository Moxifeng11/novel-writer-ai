import { describe, expect, it } from 'vitest';
import {
    chapterNumber,
    isChapterWritten,
    summarizeChapterProgress,
    SKELETON_BYTE_THRESHOLD,
} from '../../../shared/chapter-progress';

describe('chapter-progress — 章节完成度判定（BUG 回归）', () => {
    it('status 为 written / settled 视为已写', () => {
        expect(isChapterWritten('written', true, 3000)).toBe(true);
        expect(isChapterWritten('settled', true, 3000)).toBe(true);
        expect(isChapterWritten(' SETTLED ', true, 3000)).toBe(true);
    });

    it('status 为 pending / draft 视为待写，即使有正文文件', () => {
        expect(isChapterWritten('pending', true, 287)).toBe(false);
        // 骨架即便被手动撑大也不算已写（以 status 为准）
        expect(isChapterWritten('pending', true, 99_999)).toBe(false);
        expect(isChapterWritten('draft', true, 5000)).toBe(false);
    });

    it('没有 status 的旧文件按体量兜底', () => {
        expect(isChapterWritten('', true, SKELETON_BYTE_THRESHOLD + 1)).toBe(true);
        expect(isChapterWritten('', true, SKELETON_BYTE_THRESHOLD)).toBe(false);
        expect(isChapterWritten('custom-status', true, SKELETON_BYTE_THRESHOLD + 1)).toBe(true);
    });

    it('没有正文文件的骨架目录一律不算已写', () => {
        expect(isChapterWritten('settled', false, 0)).toBe(false);
    });

    it('章号解析', () => {
        expect(chapterNumber('第12章')).toBe(12);
        expect(chapterNumber('第 300 章')).toBe(300);
        expect(chapterNumber('楔子')).toBe(0);
    });

    it('400 个骨架 + 1 章已写：进度是 1/400，最新已写第1章，下一章第2章', () => {
        const entries = [
            { chapter: '第1章', status: 'settled', hasBody: true, size: 14538 },
            ...Array.from({ length: 399 }, (_, index) => ({
                chapter: `第${index + 2}章`,
                status: 'pending',
                hasBody: true,
                size: 287,
            })),
        ];
        const summary = summarizeChapterProgress(entries);

        expect(summary.total).toBe(400);
        expect(summary.plannedChapters).toBe(400);
        expect(summary.written).toBe(1);
        expect(summary.skeletons).toBe(399);
        expect(summary.latestWrittenChapter).toBe('第1章');
        // 关键回归点：不能把第400章的骨架当成最新章
        expect(summary.nextChapterToWrite).toBe('第2章');
    });

    it('多章已写：取最大已写章号，不取数组末元素', () => {
        const summary = summarizeChapterProgress([
            { chapter: '第1章', status: 'settled', hasBody: true, size: 12000 },
            { chapter: '第2章', status: 'written', hasBody: true, size: 11000 },
            { chapter: '第3章', status: 'pending', hasBody: true, size: 287 },
            { chapter: '第4章', status: 'pending', hasBody: true, size: 287 },
        ]);
        expect(summary.written).toBe(2);
        expect(summary.latestWrittenChapter).toBe('第2章');
        expect(summary.nextChapterToWrite).toBe('第3章');
        expect(summary.byStatus).toEqual({ settled: 1, written: 1, pending: 2 });
    });

    it('完全没有已写章节时建议从第1章开始', () => {
        const summary = summarizeChapterProgress([
            { chapter: '第1章', status: 'pending', hasBody: true, size: 287 },
        ]);
        expect(summary.written).toBe(0);
        expect(summary.latestWrittenChapter).toBe('');
        expect(summary.nextChapterToWrite).toBe('第1章');
    });

    it('只有真实正文、没有骨架时计划章数取最大章号', () => {
        const summary = summarizeChapterProgress([
            { chapter: '第1章', status: 'settled', hasBody: true, size: 12000 },
            { chapter: '第5章', status: 'written', hasBody: true, size: 9000 },
        ]);
        expect(summary.total).toBe(2);
        expect(summary.plannedChapters).toBe(5);
        expect(summary.nextChapterToWrite).toBe('第6章');
    });

    it('空列表返回零值', () => {
        const summary = summarizeChapterProgress([]);
        expect(summary.total).toBe(0);
        expect(summary.written).toBe(0);
        expect(summary.nextChapterToWrite).toBe('第1章');
        expect(summary.byStatus).toEqual({});
    });
});
