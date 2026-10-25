import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

vi.mock('../../../ui/components/emotion-curve-view', () => ({
    EmotionCurveView: class {
        render(curve: { id: string }) {
            return `EMO:${curve.id}`;
        }
    },
}));

import { MonitorPanelA } from '../../../ui/monitor-panel-a';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeSink() {
    const state: { entries: string[] } = { entries: [] };
    const el = {
        empty() {
            state.entries = [];
        },
        createDiv(opts?: { text?: string }) {
            state.entries.push(opts?.text ?? '');
            return el;
        },
        set innerHTML(value: string) {
            state.entries = [value];
        },
        get innerHTML() {
            return state.entries.join('');
        },
    };
    return { el, state };
}

function makeCtx() {
    const emotionCalls: Array<{ body: string; d: Deferred<{ id: string }> }> = [];
    const rhythmCalls: string[] = [];
    const emotion = makeSink();
    const rhythm = makeSink();
    const ooc = makeSink();
    const entity = makeSink();
    const ctx = {
        analysisSeq: 0,
        emotionAnalyzer: {
            analyze(body: string) {
                const d = deferred<{ id: string }>();
                emotionCalls.push({ body, d });
                return d.promise;
            },
        },
        rhythmAnalyzer: {
            async analyze(body: string) {
                rhythmCalls.push(body);
                return {
                    segments: [{ type: `节奏-${body[0]}`, pace: 'fast' }],
                    suggestions: [] as string[],
                };
            },
        },
        emotionContent: emotion.el,
        rhythmContent: rhythm.el,
        oocContent: ooc.el,
        entityContent: entity.el,
    } as unknown as {
        analysisSeq: number;
        emotionAnalyzer: { analyze: (body: string) => Promise<{ id: string }> };
        rhythmAnalyzer: { analyze: (body: string) => Promise<{ segments: Array<{ type: string; pace: string }>; suggestions: string[] }> };
        emotionContent: unknown;
        rhythmContent: unknown;
        oocContent: unknown;
        entityContent: unknown;
        refreshWithBody: (body: string) => Promise<void>;
        showEmpty: (msg: string) => void;
    };
    ctx.refreshWithBody = MonitorPanelA.prototype['refreshWithBody'];
    ctx.showEmpty = MonitorPanelA.prototype['showEmpty'];
    return { ctx, emotionCalls, rhythmCalls, emotion, rhythm };
}

describe('MonitorPanelA.refreshWithBody — 并发分析只保留最新结果', () => {
    it('MA-1: 旧请求晚返回时不覆盖新结果，且不再继续跑节奏分析', async () => {
        const { ctx, emotionCalls, rhythmCalls, emotion } = makeCtx();

        const first = ctx.refreshWithBody('A'.repeat(200));
        await Promise.resolve();
        const second = ctx.refreshWithBody('B'.repeat(200));
        await Promise.resolve();

        expect(emotionCalls).toHaveLength(2);
        emotionCalls[1].d.resolve({ id: 'B' });
        await second;
        expect(emotion.state.entries).toEqual(['EMO:B']);

        emotionCalls[0].d.resolve({ id: 'A' });
        await first;

        expect(emotion.state.entries).toEqual(['EMO:B']);
        expect(rhythmCalls).toEqual(['B'.repeat(200)]);
    });

    it('MA-2: 短正文清空后，在途的旧分析不得再把内容写回来', async () => {
        const { ctx, emotionCalls, emotion } = makeCtx();

        const inflight = ctx.refreshWithBody('A'.repeat(200));
        await Promise.resolve();
        expect(emotionCalls).toHaveLength(1);

        await ctx.refreshWithBody('太短');
        expect(emotion.state.entries).toEqual(['正文内容不足，无法分析']);

        emotionCalls[0].d.resolve({ id: 'A' });
        await inflight;
        expect(emotion.state.entries).toEqual(['正文内容不足，无法分析']);
    });

    it('MA-3: 单次请求正常渲染情绪与节奏', async () => {
        const { ctx, emotionCalls, emotion, rhythm } = makeCtx();

        const only = ctx.refreshWithBody('C'.repeat(200));
        await Promise.resolve();
        emotionCalls[0].d.resolve({ id: 'C' });
        await only;

        expect(emotion.state.entries).toEqual(['EMO:C']);
        expect(rhythm.state.entries).toEqual(['节奏-C · fast']);
    });

    it('MA-4: 旧请求抛错时不写入「分析失败」', async () => {
        const { ctx, emotionCalls, emotion } = makeCtx();

        const first = ctx.refreshWithBody('A'.repeat(200));
        await Promise.resolve();
        const second = ctx.refreshWithBody('B'.repeat(200));
        await Promise.resolve();

        emotionCalls[1].d.resolve({ id: 'B' });
        await second;

        emotionCalls[0].d.reject(new Error('old failure'));
        await first;

        expect(emotion.state.entries).toEqual(['EMO:B']);
    });
});
