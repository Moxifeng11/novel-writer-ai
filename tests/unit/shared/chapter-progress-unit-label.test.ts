import { describe, expect, it } from 'vitest';
import { chapterNumber, summarizeChapterProgress } from '../../../shared/chapter-progress';

describe('chapter-progress — 单元号解析（节/集/回/幕）', () => {
    it('支持章/节/集/回/幕', () => {
        expect(chapterNumber('第12章')).toBe(12);
        expect(chapterNumber('第3节')).toBe(3);
        expect(chapterNumber('第 12 集')).toBe(12);
        expect(chapterNumber('第5回')).toBe(5);
        expect(chapterNumber('第2幕')).toBe(2);
    });

    it('中文数字与其它文本返回 0', () => {
        expect(chapterNumber('第三章')).toBe(0);
        expect(chapterNumber('楔子')).toBe(0);
        expect(chapterNumber('')).toBe(0);
    });
});

describe('chapter-progress — 短篇/剧本进度汇总', () => {
    const shortEntries = [
        { chapter: '第1节', status: 'written', hasBody: true, size: 4200 },
        { chapter: '第2节', status: 'settled', hasBody: true, size: 5200 },
        { chapter: '第3节', status: 'pending', hasBody: true, size: 287 },
        { chapter: '第4节', status: 'pending', hasBody: true, size: 300 },
    ];

    it('最新已写取已写单元，而不是文件列表最后一条', () => {
        const progress = summarizeChapterProgress(shortEntries, { unitLabel: '节' });
        expect(progress.written).toBe(2);
        expect(progress.skeletons).toBe(2);
        expect(progress.latestWrittenChapter).toBe('第2节');
        expect(progress.nextChapterToWrite).toBe('第3节');
        expect(progress.plannedChapters).toBe(4);
    });

    it('全部未写时建议从第 1 集开始', () => {
        const progress = summarizeChapterProgress(
            [{ chapter: '第1集', status: 'pending', hasBody: true, size: 200 }],
            { unitLabel: '集' },
        );
        expect(progress.latestWrittenChapter).toBe('');
        expect(progress.nextChapterToWrite).toBe('第1集');
    });

    it('不传 unitLabel 时保持「章」，兼容长篇既有调用', () => {
        const progress = summarizeChapterProgress([
            { chapter: '第1章', status: 'written', hasBody: true, size: 5000 },
        ]);
        expect(progress.nextChapterToWrite).toBe('第2章');
    });
});
