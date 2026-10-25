import { describe, it, expect, vi } from 'vitest';

import { LiveAnalysisController } from '../../../ui/cowrite/live-analysis-controller';

/**
 * 牵引面板（「🎯 情节牵引」）与设定守卫同源：`renderTractionPanel` 先 `empty()`
 * 再 `await checkTraction`，而切章是同步的。切章后旧章结果晚到会写进新章容器，
 * 旧章的「整体进度 / 偏离风险」也会一直停留到下一次输入。
 */

function createFakeEl(texts: string[] = []): any {
    return {
        empty: vi.fn(),
        createEl: (_tag: string, opts?: { text?: string }) => {
            if (opts?.text) texts.push(opts.text);
            return createFakeEl(texts);
        },
        createDiv: (opts?: { text?: string; cls?: string }) => {
            if (opts?.text) texts.push(opts.text);
            return createFakeEl(texts);
        },
        createSpan: (opts?: { text?: string }) => {
            if (opts?.text) texts.push(opts.text);
            return createFakeEl(texts);
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type TractionCtx = {
    view: {
        tractionContainer: any;
        tractionEngine: { checkTraction: any };
        volume: string;
        chapterNum: number;
        rightEditor: { value: string };
        engine: any;
        warningContainer: any;
        plugin: any;
    };
    tractionSeq: number;
    guardSeq: number;
    isInspectingGuard: boolean;
    lastGuardCheck: { length: number; at: number } | null;
};

function makeCtx(checkTraction: any): { ctx: TractionCtx; texts: string[] } {
    const texts: string[] = [];
    const ctx = Object.create(LiveAnalysisController.prototype) as TractionCtx;
    ctx.view = {
        tractionContainer: createFakeEl(texts),
        tractionEngine: { checkTraction },
        volume: '第2卷',
        chapterNum: 3,
        rightEditor: { value: '字'.repeat(1000) },
        engine: { inspectSettingGuard: vi.fn(async () => ({ oocResult: null, entityChanges: [] })) },
        warningContainer: createFakeEl(),
        plugin: { workspaceManager: { getMonitorPanelA: () => null } },
    };
    ctx.tractionSeq = 0;
    ctx.guardSeq = 0;
    ctx.isInspectingGuard = false;
    ctx.lastGuardCheck = null;
    return { ctx, texts };
}

function render(ctx: TractionCtx) {
    return (ctx as unknown as LiveAnalysisController).renderTractionPanel();
}

function switchChapter(ctx: TractionCtx) {
    (ctx as unknown as LiveAnalysisController).resetForChapterSwitch();
}

describe('LiveAnalysisController — 牵引面板的切章代次', () => {
    it('切章后旧章结果晚到不写进新章容器', async () => {
        const pending = deferred<any>();
        const { ctx, texts } = makeCtx(vi.fn(() => pending.promise));

        const request = render(ctx);
        switchChapter(ctx);
        pending.resolve({ overallProgress: 42, divergenceRisk: 'high', recommendations: ['收回伏笔'] });
        await request;

        expect(texts.some(t => t.includes('42%'))).toBe(false);
        expect(texts.some(t => t.includes('HIGH'))).toBe(false);
        expect(texts).not.toContain('收回伏笔');
    });

    it('切章立即清空旧的进度/风险（不留到下一次输入）', () => {
        const { ctx } = makeCtx(vi.fn(async () => ({ overallProgress: 10, divergenceRisk: 'low', recommendations: [] })));
        switchChapter(ctx);
        expect(ctx.view.tractionContainer.empty).toHaveBeenCalledTimes(1);
    });

    it('同一代次正常渲染进度、风险与建议（回归）', async () => {
        const { ctx, texts } = makeCtx(vi.fn(async () => ({
            overallProgress: 42,
            divergenceRisk: 'high',
            recommendations: ['收回伏笔'],
        })));
        await render(ctx);

        expect(texts).toContain('整体进度: 42%');
        expect(texts).toContain('偏离风险: HIGH');
        expect(texts).toContain('收回伏笔');
    });

    it('旧请求抛错时不写「牵引分析失败」', async () => {
        const pending = deferred<any>();
        const { ctx, texts } = makeCtx(vi.fn(() => pending.promise));

        const request = render(ctx);
        switchChapter(ctx);
        pending.reject(new Error('牵引引擎异常'));
        await request;

        expect(texts).not.toContain('牵引分析失败');
    });

    it('checkTraction 收到当前卷号与章号', async () => {
        const checkTraction = vi.fn(async () => ({ overallProgress: 0, divergenceRisk: 'low', recommendations: [] }));
        const { ctx } = makeCtx(checkTraction);
        await render(ctx);
        expect(checkTraction).toHaveBeenCalledWith(2, 3);
    });
});
