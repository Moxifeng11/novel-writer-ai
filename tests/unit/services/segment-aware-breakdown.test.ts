import { describe, it, expect, vi } from 'vitest';
import { SegmentAwareBreakdown } from '../../../services/segment-aware-breakdown';

describe('SegmentAwareBreakdown', () => {
    describe('短文本直通', () => {
        it('短文本不分段', async () => {
            const sa = new SegmentAwareBreakdown({ maxDirectWords: 1000 });
            const text = '这是一段短文本。'.repeat(10);

            const result = await sa.run(
                text,
                async (seg) => ({ length: seg.text.length, words: seg.wordCount }),
                (results) => results[0],
            );

            expect(result.totalSegments).toBe(1);
            expect(result.segments.length).toBe(1);
            expect(result.combinedResult.length).toBe(text.length);
        });

        it('短文本不调用分段器', async () => {
            const sa = new SegmentAwareBreakdown({ maxDirectWords: 1000000 });
            let analyzeCalls = 0;

            await sa.run(
                '短文本',
                async () => {
                    analyzeCalls++;
                    return { v: 1 };
                },
                (r) => r[0],
            );

            expect(analyzeCalls).toBe(1);
        });
    });

    describe('长文本分段', () => {
        it('超长文本自动分段', async () => {
            const sa = new SegmentAwareBreakdown({
                maxDirectWords: 100,
                maxSegmentWords: 50,
            });

            const longText = '测试文本内容。'.repeat(50);

            const result = await sa.run<any>(
                longText,
                async (seg) => ({ words: seg.wordCount, text: seg.text }),
                (results) => ({ totalWords: results.reduce((sum, r) => sum + r.words, 0), parts: results.length }),
            );

            expect(result.totalSegments).toBeGreaterThan(1);
            expect(result.segments.length).toBeGreaterThan(1);
        });

        it('分段结果合并', async () => {
            const sa = new SegmentAwareBreakdown({
                maxDirectWords: 100,
                maxSegmentWords: 50,
            });

            const longText = '内容文字。'.repeat(80);

            const result = await sa.run<any>(
                longText,
                async (seg) => seg.wordCount,
                (results, totalWords) => ({
                    partCount: results.length,
                    sumWords: results.reduce((s, w) => s + w, 0),
                    totalWords,
                }),
            );

            expect(result.combinedResult.partCount).toBeGreaterThan(1);
            expect(result.combinedResult.sumWords).toBeGreaterThan(0);
        });
    });

    describe('进度回调', () => {
        it('onSegmentProgress 被调用', async () => {
            const sa = new SegmentAwareBreakdown({
                maxDirectWords: 100,
                maxSegmentWords: 30,
            });

            const progresses: Array<{ idx: number; total: number; prog: number }> = [];

            const longText = '内容文字。'.repeat(60);

            await sa.run<any>(
                longText,
                async (seg) => seg.wordCount,
                (r) => r,
                undefined,
            );

            sa['options'].onSegmentProgress = (idx, total, prog) => {
                progresses.push({ idx, total, prog });
            };

            await sa.run<any>(
                longText,
                async (seg) => seg.wordCount,
                (r) => r,
                undefined,
            );

            expect(progresses.length).toBeGreaterThan(0);
        });
    });

    describe('取消', () => {
        it('signal abort 时抛出错误', async () => {
            const sa = new SegmentAwareBreakdown({
                maxDirectWords: 100,
                maxSegmentWords: 30,
            });

            const controller = new AbortController();
            const longText = '内容文字。'.repeat(80);

            const promise = sa.run<any>(
                longText,
                async (seg) => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return seg.wordCount;
                },
                (r) => r,
                controller.signal,
            );

            controller.abort();

            await expect(promise).rejects.toThrow('任务已取消');
        });
    });

    describe('工具方法', () => {
        it('shouldUseSegmented 判断是否需要分段', () => {
            const sa = new SegmentAwareBreakdown({ maxDirectWords: 100 });
            expect(sa.shouldUseSegmented('短')).toBe(false);
            expect(sa.shouldUseSegmented('字'.repeat(200))).toBe(true);
        });

        it('estimateSegments 估算段数', () => {
            const sa = new SegmentAwareBreakdown({
                maxDirectWords: 100,
                maxSegmentWords: 30,
            });
            expect(sa.estimateSegments('短')).toBe(1);
            const longText = '字'.repeat(150);
            expect(sa.estimateSegments(longText)).toBeGreaterThan(1);
        });
    });
});
