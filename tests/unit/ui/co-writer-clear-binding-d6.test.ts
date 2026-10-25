import { describe, it, expect, vi } from 'vitest';

// engine-registry 等会反向引用 main.ts；先 mock 掉，避免加载构建产物 main.js。
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

/**
 * D6 — 无显式章节上下文的入口必须回到「未绑定章节」空态。
 * 协同写作视图是单例：若只 revealLeaf 不重建，上一本书/上一章的
 * project/chapterNum 会继续被保存与建议逻辑使用（跨书串数据）。
 */

type Ctx = {
    project: string;
    chapterName: string;
    volume: string;
    chapterNum: number;
    statusBar: { setText: ReturnType<typeof vi.fn> };
    rightEditor: { value: string };
    tractionEngine: unknown;
    historyLoaded: boolean;
    isAssociating: boolean;
    lastGhostSeed: string;
    lastGhostRequestAt: number;
    liveAnalysis: { resetForChapterSwitch: ReturnType<typeof vi.fn> };
    clearPreviewTimer: ReturnType<typeof vi.fn>;
    beginSuggestionEpoch: ReturnType<typeof vi.fn>;
    abortActiveSuggestion: ReturnType<typeof vi.fn>;
    clearStaleSuggestions: ReturnType<typeof vi.fn>;
    renderEmptySuggestions: ReturnType<typeof vi.fn>;
    resetQualityMonitorForChapterSwitch: ReturnType<typeof vi.fn>;
    resetPlotMetricsForChapterSwitch: ReturnType<typeof vi.fn>;
    renderMetrics: ReturnType<typeof vi.fn>;
    flushPendingBodySaveBeforeChapterSwitch: ReturnType<typeof vi.fn>;
    clearChapterBinding: () => Promise<void>;
};

function makeCtx(): Ctx {
    const ctx = {
        project: 'A书',
        chapterName: '第1章',
        volume: '第2卷',
        chapterNum: 3,
        statusBar: { setText: vi.fn() },
        rightEditor: { value: '旧章正文' },
        tractionEngine: { stale: true },
        historyLoaded: true,
        isAssociating: true,
        lastGhostSeed: 'seed',
        lastGhostRequestAt: 123,
        liveAnalysis: { resetForChapterSwitch: vi.fn() },
        clearPreviewTimer: vi.fn(),
        beginSuggestionEpoch: vi.fn(() => 1),
        abortActiveSuggestion: vi.fn(),
        clearStaleSuggestions: vi.fn(),
        renderEmptySuggestions: vi.fn(),
        resetQualityMonitorForChapterSwitch: vi.fn(),
        resetPlotMetricsForChapterSwitch: vi.fn(),
        renderMetrics: vi.fn(),
        flushPendingBodySaveBeforeChapterSwitch: vi.fn(async () => true),
    } as unknown as Ctx;
    ctx.clearChapterBinding = CoWritingView.prototype['clearChapterBinding'].bind(ctx) as Ctx['clearChapterBinding'];
    return ctx;
}

describe('D6 CoWritingView — 无上下文回到空态', () => {
    it('已绑定章节时清空项目/章节身份与编辑器内容', async () => {
        const ctx = makeCtx();

        await ctx.clearChapterBinding();

        expect(ctx.project).toBe('');
        expect(ctx.chapterName).toBe('');
        expect(ctx.volume).toBe('第1卷');
        expect(ctx.chapterNum).toBe(1);
        expect(ctx.rightEditor.value).toBe('');
        expect(ctx.tractionEngine).toBeNull();
        expect(ctx.historyLoaded).toBe(false);
        expect(ctx.statusBar.setText).toHaveBeenCalledWith('未绑定章节');
        expect(ctx.liveAnalysis.resetForChapterSwitch).toHaveBeenCalledTimes(1);
        expect(ctx.resetQualityMonitorForChapterSwitch).toHaveBeenCalledTimes(1);
        expect(ctx.resetPlotMetricsForChapterSwitch).toHaveBeenCalledTimes(1);
        expect(ctx.renderMetrics).toHaveBeenCalledTimes(1);
        expect(ctx.renderEmptySuggestions).toHaveBeenCalledWith(
            expect.stringContaining('尚未绑定章节'),
        );
    });

    it('清空前先按旧身份冲刷排队保存', async () => {
        const ctx = makeCtx();

        await ctx.clearChapterBinding();

        expect(ctx.flushPendingBodySaveBeforeChapterSwitch).toHaveBeenCalledTimes(1);
    });

    it('上一章未能保存时中止清空，保留旧身份', async () => {
        const ctx = makeCtx();
        ctx.flushPendingBodySaveBeforeChapterSwitch.mockResolvedValue(false);

        await ctx.clearChapterBinding();

        expect(ctx.project).toBe('A书');
        expect(ctx.chapterName).toBe('第1章');
        expect(ctx.chapterNum).toBe(3);
        expect(ctx.rightEditor.value).toBe('旧章正文');
        expect(ctx.renderMetrics).not.toHaveBeenCalled();
    });

    it('本来就未绑定章节时不重置、不写盘', async () => {
        const ctx = makeCtx();
        ctx.project = '';
        ctx.chapterName = '';

        await ctx.clearChapterBinding();

        expect(ctx.flushPendingBodySaveBeforeChapterSwitch).not.toHaveBeenCalled();
        expect(ctx.statusBar.setText).toHaveBeenCalledWith('未绑定章节');
        expect(ctx.renderMetrics).not.toHaveBeenCalled();
    });
});
