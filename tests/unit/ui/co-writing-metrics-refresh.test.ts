import { describe, expect, it, vi } from 'vitest';
import type { SuggestionDirection } from '@/shared/types';
import type { PlotEvalGateState } from '@/shared/plot-eval-throttle';
import { emptyMetrics } from '@/ui/cowrite/cowrite-mappers';
import {
    runMetricsRefresh,
    type MetricsEvalStatus,
    type MetricsRefreshHost,
} from '@/ui/co-writing/metrics-refresh';

interface HostState {
    project: string;
    chapterNum: number;
    text: string;
    lastPlotEval: PlotEvalGateState | null;
    controller: AbortController | null;
    status: MetricsEvalStatus;
}

function createHost(overrides: Partial<MetricsRefreshHost> = {}) {
    const state: HostState = {
        project: '项目A',
        chapterNum: 1,
        text: '正文内容',
        lastPlotEval: null,
        controller: null,
        status: 'idle',
    };
    const renders: number[] = [];
    const synced: number[] = [];
    const host: MetricsRefreshHost = {
        getProject: () => state.project,
        getChapterNum: () => state.chapterNum,
        getEditorText: () => state.text,
        getLastPlotEval: () => state.lastPlotEval,
        setLastPlotEval: next => { state.lastPlotEval = next; },
        getAbortController: () => state.controller,
        setAbortController: next => { state.controller = next; },
        getMetricsStatus: () => state.status,
        setMetricsStatus: next => { state.status = next; },
        getSessionMetrics: () => ({ ...emptyMetrics(), overallCompletion: 40 }),
        evaluatePlotComplete: vi.fn(async () => ({ ...emptyMetrics(), overallCompletion: 55 })),
        adjustDirection: vi.fn((): SuggestionDirection[] => ['action']),
        syncPlotCompletion: vi.fn(metrics => { synced.push(metrics.overallCompletion); }),
        updateNextNodeButton: vi.fn(),
        renderMetrics: vi.fn(metrics => { renders.push(metrics.overallCompletion); }),
        renderFloatingMetrics: vi.fn(),
        ...overrides,
    };
    return { host, state, renders, synced };
}

describe('metrics-refresh — 刷新编排', () => {
    it('强制刷新：评估成功写回会话指标并回到 idle', async () => {
        const { host, state, renders, synced } = createHost();
        await runMetricsRefresh(host, true);
        expect(host.evaluatePlotComplete).toHaveBeenCalledTimes(1);
        expect(host.updateNextNodeButton).toHaveBeenCalledTimes(1);
        expect(state.lastPlotEval).not.toBeNull();
        expect(state.status).toBe('idle');
        expect(synced).toEqual([55]);
        // 发起前先渲染兜底值（40），成功后渲染结果（55）
        expect(renders).toEqual([40, 55]);
        expect(state.controller).toBeNull();
    });

    it('节流门未命中：正文未变且非强制时不发起评估', async () => {
        const { host, state, renders } = createHost();
        await runMetricsRefresh(host, true);
        const firstGate = state.lastPlotEval;
        await runMetricsRefresh(host, false);
        expect(host.evaluatePlotComplete).toHaveBeenCalledTimes(1);
        expect(state.lastPlotEval).toBe(firstGate);
        expect(renders).toEqual([40, 55]);
    });

    it('正文增长达标：非强制也会重新评估', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const { host, state } = createHost();
        await runMetricsRefresh(host, true);
        state.text = `${state.text}${'新内容'.repeat(200)}`;
        vi.setSystemTime(new Date('2026-01-01T00:00:40Z'));
        await runMetricsRefresh(host, false);
        vi.useRealTimers();
        expect(host.evaluatePlotComplete).toHaveBeenCalledTimes(2);
    });

    it('评估期间切章：旧章结果被丢弃', async () => {
        const { host, state, synced } = createHost({
            evaluatePlotComplete: vi.fn(async () => {
                state.chapterNum = 2;
                return { ...emptyMetrics(), overallCompletion: 55 };
            }),
        });
        await runMetricsRefresh(host, true);
        expect(synced).toEqual([]);
        expect(state.status).toBe('evaluating');
    });

    it('AbortError：不写回也不进入错误态', async () => {
        const { host, state, synced } = createHost({
            evaluatePlotComplete: vi.fn(async () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                throw error;
            }),
        });
        await runMetricsRefresh(host, true);
        expect(synced).toEqual([]);
        expect(state.status).toBe('evaluating');
        expect(state.controller).toBeNull();
    });

    it('普通失败：进入 error 态并渲染会话缓存', async () => {
        const { host, state, renders } = createHost({
            evaluatePlotComplete: vi.fn(async () => {
                throw new Error('network');
            }),
        });
        await runMetricsRefresh(host, true);
        expect(state.status).toBe('error');
        expect(renders).toEqual([40, 40]);
        expect(state.controller).toBeNull();
    });

    it('发起前中止上一次在途评估', async () => {
        const previous = new AbortController();
        // 首次刷新会建立控制器；手动塞入一个旧控制器模拟在途评估
        const { host, state } = createHost();
        await runMetricsRefresh(host, true);
        state.controller = previous;
        const abortSpy = vi.spyOn(previous, 'abort');
        await runMetricsRefresh(host, true);
        expect(abortSpy).toHaveBeenCalledTimes(1);
        expect(state.controller).not.toBe(previous);
    });
});
