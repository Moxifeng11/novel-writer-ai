import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

/**
 * 剧情完成度是异步 AI 评估（整章约 9.6k token）：`refreshMetrics` 返回后
 * 会 `syncPlotCompletion` 并渲染。切章此前既不 abort 也不校验章节身份，
 * 旧章结果会写进新章、状态卡在 evaluating；会话切换前还会先用旧 metrics 渲染一遍。
 */

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type MetricsCtx = {
    project: string;
    chapterNum: number;
    rightEditor: { value: string };
    lastPlotEval: any;
    metricsAbortController: AbortController | null;
    metricsStatus: 'idle' | 'evaluating' | 'error';
    facade: any;
    updateNextNodeButton: () => void;
    renderMetrics: (metrics: any) => void;
    renderFloatingMetrics: () => void;
    refreshMetrics: (force: boolean) => Promise<void>;
    resetPlotMetricsForChapterSwitch: () => void;
};

function makeCtx(project = '书甲', chapterNum = 3): MetricsCtx {
    const ctx = {
        project,
        chapterNum,
        rightEditor: { value: '字'.repeat(500) },
        lastPlotEval: null,
        metricsAbortController: null,
        metricsStatus: 'idle',
        facade: {
            getSession: () => ({ currentMetrics: null }),
            evaluatePlotComplete: vi.fn(),
            adjustDirection: vi.fn(() => []),
            syncPlotCompletion: vi.fn(),
        },
        updateNextNodeButton: vi.fn(),
        renderMetrics: vi.fn(),
        renderFloatingMetrics: vi.fn(),
    } as unknown as MetricsCtx;
    ctx.refreshMetrics = CoWritingView.prototype['refreshMetrics'];
    ctx.resetPlotMetricsForChapterSwitch = CoWritingView.prototype['resetPlotMetricsForChapterSwitch'];
    return ctx;
}

describe('CoWritingView — 剧情完成度的切章代次', () => {
    it('切章后旧章结果晚到不写入新章', async () => {
        const ctx = makeCtx();
        const pending = deferred<any>();
        ctx.facade.evaluatePlotComplete.mockReturnValue(pending.promise);

        const request = ctx.refreshMetrics(false);
        // 模拟切章（不经过 abort 的路径）：身份变化必须由返回值校验兜住
        ctx.project = '书乙';
        ctx.chapterNum = 9;
        pending.resolve({ overallCompletion: 88 });
        await request;

        expect(ctx.facade.syncPlotCompletion).not.toHaveBeenCalled();
        // 只在发起时渲染过一次「评估中」，返回后不得再渲染旧结果
        expect(ctx.renderMetrics).toHaveBeenCalledTimes(1);
    });

    it('切章后旧请求失败不把新章标成「评估失败」', async () => {
        const ctx = makeCtx();
        const pending = deferred<any>();
        ctx.facade.evaluatePlotComplete.mockReturnValue(pending.promise);

        const request = ctx.refreshMetrics(false);
        ctx.project = '书乙';
        ctx.chapterNum = 9;
        ctx.resetPlotMetricsForChapterSwitch();
        pending.reject(new Error('AI 调用失败'));
        await request;

        expect(ctx.metricsStatus).toBe('idle');
        expect(ctx.renderMetrics).toHaveBeenCalledTimes(1);
    });

    it('切章复位会中止在途请求并回到 idle', () => {
        const ctx = makeCtx();
        const controller = new AbortController();
        ctx.metricsAbortController = controller;
        ctx.metricsStatus = 'evaluating';

        ctx.resetPlotMetricsForChapterSwitch();

        expect(controller.signal.aborted).toBe(true);
        expect(ctx.metricsAbortController).toBeNull();
        expect(ctx.metricsStatus).toBe('idle');
    });

    it('同章正常返回写入完成度与方向提示（回归）', async () => {
        const ctx = makeCtx();
        ctx.facade.evaluatePlotComplete.mockResolvedValue({ overallCompletion: 60 });
        ctx.facade.adjustDirection.mockReturnValue(['推进主线']);

        await ctx.refreshMetrics(false);

        expect(ctx.facade.syncPlotCompletion).toHaveBeenCalledWith(
            expect.objectContaining({ overallCompletion: 60, nextDirectionHints: ['推进主线'] }),
        );
        expect(ctx.metricsStatus).toBe('idle');
        expect(ctx.renderMetrics).toHaveBeenCalledTimes(2);
    });

    it('同章失败仍标记 error（回归）', async () => {
        const ctx = makeCtx();
        ctx.facade.evaluatePlotComplete.mockRejectedValue(new Error('AI 调用失败'));

        await ctx.refreshMetrics(false);

        expect(ctx.metricsStatus).toBe('error');
    });
});
