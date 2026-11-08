import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const { markdownMock } = vi.hoisted(() => ({
    // v4.76.0：新签名 render(app, content, el, path, component) —— content 是第 2 参
    markdownMock: vi.fn(async (_app: unknown, _content: string, _el: unknown) => { /* 渲染立即完成 */ }),
}));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, MarkdownRenderer: { render: markdownMock } };
});

import { CoWritingView } from '../../../ui/co-writing-view';

/**
 * 预览刷新按 500ms 节流。此前窗口内的刷新直接 return，等于丢弃「停手前最后一次输入」：
 * 用户打完最后一个字就停手时，预览会一直停在上一次窗口的正文上，直到再次输入。
 * 修复后窗口内改为排一次尾随渲染。
 */

type PreviewCtx = {
    rightEditor: { value: string };
    previewContent: any;
    lastPreviewAt: number;
    previewSeq: number;
    previewTimer: ReturnType<typeof setTimeout> | null;
    qualityIssues: any[];
    getBodyPath: () => string;
    applyHighlightsToDOM: () => void;
    clearPreviewTimer: () => void;
    schedulePreviewFlush: (delay: number) => void;
    refreshPreview: (force: boolean) => Promise<void>;
};

function makeCtx(value: string): PreviewCtx {
    const previewContent: any = {
        scrollTop: 0,
        scrollHeight: 100,
        clientHeight: 50,
        ownerDocument: { createElement: () => ({ firstChild: null }) },
        empty: vi.fn(),
        appendChild: vi.fn(),
        createDiv: vi.fn(),
    };
    const ctx = {
        rightEditor: { value },
        previewContent,
        lastPreviewAt: 0,
        previewSeq: 0,
        previewTimer: null,
        qualityIssues: [],
        getBodyPath: () => '书甲/第1章_正文.md',
        applyHighlightsToDOM: vi.fn(),
    } as unknown as PreviewCtx;
    ctx.clearPreviewTimer = CoWritingView.prototype['clearPreviewTimer'];
    ctx.schedulePreviewFlush = CoWritingView.prototype['schedulePreviewFlush'];
    ctx.refreshPreview = CoWritingView.prototype['refreshPreview'];
    return ctx;
}

beforeEach(() => {
    vi.useFakeTimers({ now: 1000 });
    markdownMock.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CoWritingView — 预览节流的尾随渲染', () => {
    it('窗口内触发不立即渲染，窗口结束后补渲染最新正文', async () => {
        const ctx = makeCtx('第一段');
        await ctx.refreshPreview(true);
        expect(markdownMock).toHaveBeenCalledTimes(1);

        ctx.rightEditor.value = '第一段+第二段';
        vi.setSystemTime(1200);
        await ctx.refreshPreview(false);
        expect(markdownMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(1500);
        await vi.advanceTimersByTimeAsync(300);
        expect(markdownMock).toHaveBeenCalledTimes(2);
        expect(markdownMock.mock.calls[1][1]).toBe('第一段+第二段');
    });

    it('窗口内连续多次触发只补一次渲染，且用最后一次正文', async () => {
        const ctx = makeCtx('一');
        await ctx.refreshPreview(true);

        ctx.rightEditor.value = '一+二';
        vi.setSystemTime(1100);
        await ctx.refreshPreview(false);
        ctx.rightEditor.value = '一+二+三';
        vi.setSystemTime(1200);
        await ctx.refreshPreview(false);
        ctx.rightEditor.value = '一+二+三+四';
        vi.setSystemTime(1300);
        await ctx.refreshPreview(false);

        await vi.advanceTimersByTimeAsync(1000);
        expect(markdownMock).toHaveBeenCalledTimes(2);
        expect(markdownMock.mock.calls[1][1]).toBe('一+二+三+四');
    });

    it('强制刷新会取消挂起的尾随渲染（不重复渲染）', async () => {
        const ctx = makeCtx('旧');
        await ctx.refreshPreview(true);

        ctx.rightEditor.value = '新';
        vi.setSystemTime(1200);
        await ctx.refreshPreview(false);
        expect(ctx.previewTimer).not.toBeNull();

        vi.setSystemTime(1400);
        await ctx.refreshPreview(true);
        expect(markdownMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1000);
        expect(markdownMock).toHaveBeenCalledTimes(2);
    });

    it('窗口外的输入立即渲染，不再排尾随（回归）', async () => {
        const ctx = makeCtx('甲');
        await ctx.refreshPreview(true);

        ctx.rightEditor.value = '甲乙';
        vi.setSystemTime(1500);
        await ctx.refreshPreview(false);
        expect(markdownMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1000);
        expect(markdownMock).toHaveBeenCalledTimes(2);
    });
});
