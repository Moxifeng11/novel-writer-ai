/**
 * deconstruction-dimension-failure.test.ts — 拆解维度失败不得算完成（DSH-20261113-21）
 *
 * 对抗性审查（high）：维度拆解抛错只 log.warn 后仍进 completedSet → 任务无条件
 * completed/100% 弹「拆解完成」；写入失败被 saveSegmentedDimensionResult 吞成
 * log.warn；runWithConcurrencyLimit 二次吞掉逃逸异常。
 *
 * 本文件锁：
 *  - resolveDimensionTaskOutcome 纯函数：全失败 / 部分失败 / 全成功 / 进度按成功计数
 *  - runWithConcurrencyLimit：逃逸异常向上传播（不再二次吞）
 *  - saveSegmentedDimensionResult：写入失败向上抛（不再吞成 log.warn）
 *  - 源码契约回归锁：catch 块内不得再出现 completedSet.add / 旧吞异常 / 旧吞写入
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    DeconstructionScheduler,
    resolveDimensionTaskOutcome,
} from '../../../engine/deconstruction-scheduler';

const SCHEDULER_SOURCE = readFileSync('engine/deconstruction-scheduler.ts', 'utf8');

function createSchedulerForSave(saveBehavior: 'ok' | 'throw'): DeconstructionScheduler {
    const scheduler = new DeconstructionScheduler(
        { vault: { adapter: { read: async () => '---\n{}\n---\n正文' } } } as any,
        {
            getBook: async () => ({ id: 'book-1', name: '测试书籍' }),
            setBreakdownStatus: async () => {},
        } as any,
        undefined,
        undefined,
        undefined,
        () => ({
            deconstructionEngine: {
                defaultQualityLevel: 'fast' as const,
                enableAutoUpgrade: true,
                enabledDimensions: ['style'] as any[],
                includeCommercial: false,
                includeReadability: false,
                vectorEnabled: false,
                vectorModel: 'bge-m3',
                vectorCacheSize: 5000,
                vectorBatchSize: 32,
                llmEnabled: false,
                llmModel: 'deepseek-r1:7b',
                maxConcurrency: 1,
                textSampleLimit: 10,
                dimensionConcurrency: 3,
            },
        }),
    );
    // 注入 style 拆解器桩：saveAnalysisToMarkdown 按 saveBehavior 表现
    (scheduler as any).styleDeconstructor = {
        saveAnalysisToMarkdown:
            saveBehavior === 'throw'
                ? vi.fn(async () => { throw new Error('磁盘只读'); })
                : vi.fn(async () => {}),
    };
    return scheduler;
}

describe('resolveDimensionTaskOutcome：结局判定纯函数', () => {
    it('全成功：completed / 100% / message「拆解完成」', () => {
        const outcome = resolveDimensionTaskOutcome(8, []);
        expect(outcome.status).toBe('completed');
        expect(outcome.progress).toBe(100);
        expect(outcome.allFailed).toBe(false);
        expect(outcome.message).toBe('拆解完成');
        expect(outcome.errorSummary).toBe('');
    });

    it('全失败：failed / 进度 0 / allFailed / 提示指路重试', () => {
        const outcome = resolveDimensionTaskOutcome(2, [
            { dimension: 'style' as never, error: 'Worker 崩溃' },
            { dimension: 'rhythm' as never, error: 'OOM' },
        ]);
        expect(outcome.status).toBe('failed');
        expect(outcome.progress).toBe(0);
        expect(outcome.allFailed).toBe(true);
        expect(outcome.message).toContain('全部失败');
        expect(outcome.message).toContain('重试');
        expect(outcome.errorSummary).toContain('风格分析: Worker 崩溃');
        expect(outcome.errorSummary).toContain('2/2');
    });

    it('部分失败：failed / 进度按成功维度计数（不得 100%）/ 列出失败维度名', () => {
        const outcome = resolveDimensionTaskOutcome(8, [
            { dimension: 'style' as never, error: 'analyzer 抛错' },
            { dimension: 'rhythm' as never, error: '超时' },
        ]);
        expect(outcome.status).toBe('failed');
        expect(outcome.progress).toBe(75); // (8-2)/8
        expect(outcome.allFailed).toBe(false);
        expect(outcome.message).toContain('成功 6/8');
        expect(outcome.message).toContain('失败维度');
        expect(outcome.errorSummary).toContain('维度拆解失败（2/8）');
    });

    it('进度不得停在 100%：任何失败维度都让 progress < 100', () => {
        // 8 维度失败 1 个 → 7/8 = 88%（不是 100%）
        expect(resolveDimensionTaskOutcome(8, [{ dimension: 'style' as never, error: 'x' }]).progress).toBe(88);
        // 单维度任务失败 1 个 → 0%
        expect(resolveDimensionTaskOutcome(1, [{ dimension: 'style' as never, error: 'x' }]).progress).toBe(0);
    });
});

describe('runWithConcurrencyLimit：不再二次吞逃逸异常', () => {
    it('任务函数抛错 → runWithConcurrencyLimit 向上拒绝（回归锁：旧代码 .catch(()=>{}) 会吞掉）', async () => {
        const scheduler = new DeconstructionScheduler({} as any, {} as any);
        const boom = vi.fn(async (_item: number) => { throw new Error('逃逸异常'); });
        await expect(
            (scheduler as unknown as { runWithConcurrencyLimit: (items: number[], c: number, fn: (i: number) => Promise<void>) => Promise<void> })
                .runWithConcurrencyLimit([1], 1, boom)
        ).rejects.toThrow('逃逸异常');
        expect(boom).toHaveBeenCalledTimes(1);
    });

    it('全部成功时正常完成（回归：不误伤并发能力）', async () => {
        const scheduler = new DeconstructionScheduler({} as any, {} as any);
        const executed: number[] = [];
        await (scheduler as unknown as { runWithConcurrencyLimit: (items: number[], c: number, fn: (i: number) => Promise<void>) => Promise<void> })
            .runWithConcurrencyLimit([1, 2, 3, 4], 2, async (i: number) => { executed.push(i); });
        expect(executed.sort()).toEqual([1, 2, 3, 4]);
    });

    it('源码契约：runWithConcurrencyLimit 内不得再有 .catch(() => {}) 吞异常', () => {
        const fnStart = SCHEDULER_SOURCE.indexOf('private async runWithConcurrencyLimit');
        expect(fnStart).toBeGreaterThan(0);
        const body = SCHEDULER_SOURCE.slice(fnStart, SCHEDULER_SOURCE.indexOf('private delay', fnStart));
        expect(body.length).toBeGreaterThan(200); // 确认窗口覆盖函数体
        expect(body).not.toContain('.catch(() => {})');
    });
});

describe('saveSegmentedDimensionResult：写入失败向上抛', () => {
    it('deconstructor.saveAnalysisToMarkdown 抛错 → 本方法拒绝（回归锁：旧代码吞成 log.warn）', async () => {
        const scheduler = createSchedulerForSave('throw');
        await expect(
            (scheduler as unknown as {
                saveSegmentedDimensionResult: (
                    task: { bookId: string; bookName: string },
                    dimension: string,
                    result: unknown,
                ) => Promise<void>;
            }).saveSegmentedDimensionResult(
                { bookId: 'book-1', bookName: '测试书籍' },
                'style',
                { summary: 'x' },
            )
        ).rejects.toThrow('保存风格分析结果失败: 磁盘只读');
    });

    it('写入成功 → 正常 resolve（不误伤）', async () => {
        const scheduler = createSchedulerForSave('ok');
        await expect(
            (scheduler as unknown as {
                saveSegmentedDimensionResult: (
                    task: { bookId: string; bookName: string },
                    dimension: string,
                    result: unknown,
                ) => Promise<void>;
            }).saveSegmentedDimensionResult(
                { bookId: 'book-1', bookName: '测试书籍' },
                'style',
                { summary: 'x' },
            )
        ).resolves.toBeUndefined();
    });
});

describe('源码契约回归锁：processDimension 失败路径不得进 completedSet', () => {
    it('catch (dimError) 块内不得出现 completedSet.add（旧代码失败后仍计入完成）', () => {
        const catchStart = SCHEDULER_SOURCE.indexOf('catch (dimError)');
        expect(catchStart).toBeGreaterThan(0);
        // catch 块到「completedSet.add(dimension);」之间的区段：失败路径先 return，
        // 不得再执行 completedSet.add。
        // 新代码：catch 内 return（失败路径），completedSet.add 只出现在 catch 闭合之后
        const addIndex = SCHEDULER_SOURCE.indexOf('completedSet.add(dimension)', catchStart);
        const returnIndex = SCHEDULER_SOURCE.indexOf('return;', catchStart);
        expect(addIndex).toBeGreaterThan(-1);
        expect(returnIndex).toBeGreaterThan(-1);
        expect(returnIndex).toBeLessThan(addIndex); // return 在 add 之前 → 失败路径不 add
    });

    it('失败分支调用 resolveDimensionTaskOutcome（接线断言：拆了函数必须真用上）', () => {
        expect(SCHEDULER_SOURCE.includes('resolveDimensionTaskOutcome(totalDimensions, failedDimensions)')).toBe(true);
        // post-loop 不得再有无条件 completed（旧代码：循环结束直接 task.status='completed'）
        const outcomeCall = SCHEDULER_SOURCE.indexOf('resolveDimensionTaskOutcome(totalDimensions, failedDimensions)');
        const afterOutcome = SCHEDULER_SOURCE.slice(outcomeCall, outcomeCall + 1200);
        expect(afterOutcome).toContain("outcome.status === 'failed'");
        expect(afterOutcome).toContain('return;');
    });
});
