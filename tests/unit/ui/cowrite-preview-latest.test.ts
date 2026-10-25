import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const { renderQueue, markdownMock } = vi.hoisted(() => {
    const renderQueue: Array<{ el: any; resolve: () => void }> = [];
    const markdownMock = vi.fn(
        (_content: string, el: any) => new Promise<void>(resolve => {
            renderQueue.push({ el, resolve });
        }),
    );
    return { renderQueue, markdownMock };
});

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, MarkdownRenderer: { renderMarkdown: markdownMock } };
});

import { CoWritingView } from '../../../ui/co-writing-view';

/**
 * 预览区每次输入（500ms 节流）都会全量重渲染，而 `MarkdownRenderer.renderMarkdown`
 * 是异步的。此前直接写常驻 `previewContent`：连续两次刷新或切章后，旧渲染完成时
 * 会把旧正文追加到已清空/已重建的容器里，与新内容混在一起。
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

function makeCtx(value: string): { ctx: PreviewCtx; appended: any[] } {
    const appended: any[] = [];
    const previewContent: any = {
        scrollTop: 10,
        scrollHeight: 100,
        clientHeight: 50,
        ownerDocument: { createElement: () => ({ firstChild: null }) },
        empty: vi.fn(),
        appendChild: vi.fn((node: any) => { appended.push(node); }),
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
    return { ctx, appended };
}

function completeRender(index: number, child: any, appended: any[], ctx: PreviewCtx): void {
    const call = renderQueue[index];
    call.el.firstChild = child;
    ctx.previewContent.appendChild.mockImplementation((node: any) => {
        appended.push(node);
        if (node === child) call.el.firstChild = null;
    });
    call.resolve();
}

beforeEach(() => {
    renderQueue.length = 0;
    markdownMock.mockClear();
});

describe('CoWritingView — 预览异步渲染的切章/并发代次', () => {
    it('连续两次刷新时，先发出的旧渲染不覆盖后发出的新渲染', async () => {
        const { ctx, appended } = makeCtx('旧正文');
        const first = ctx.refreshPreview(true);

        ctx.rightEditor.value = '新正文';
        const second = ctx.refreshPreview(true);

        const oldChild = { text: '旧正文' };
        const newChild = { text: '新正文' };
        // 后发出的先返回，先写进预览
        completeRender(1, newChild, appended, ctx);
        await second;
        expect(appended).toEqual([newChild]);

        // 先发出的晚返回：代次已过期，不得再写
        completeRender(0, oldChild, appended, ctx);
        await first;
        expect(appended).toEqual([newChild]);
    });

    it('切章清空正文后，旧章的在途渲染不会写回预览', async () => {
        const { ctx, appended } = makeCtx('旧章正文');
        const request = ctx.refreshPreview(true);

        ctx.rightEditor.value = '';
        await ctx.refreshPreview(true);
        expect(ctx.previewContent.empty).toHaveBeenCalled();
        expect(ctx.previewContent.createDiv).toHaveBeenCalled();

        completeRender(0, { text: '旧章正文' }, appended, ctx);
        await request;
        expect(appended).toEqual([]);
    });

    it('正文为空时立即清空并显示占位（回归）', async () => {
        const { ctx, appended } = makeCtx('   ');

        await ctx.refreshPreview(true);

        expect(ctx.previewContent.empty).toHaveBeenCalledTimes(1);
        expect(ctx.previewContent.createDiv).toHaveBeenCalledTimes(1);
        expect(markdownMock).not.toHaveBeenCalled();
        expect(appended).toEqual([]);
    });

    it('正常渲染会搬运节点并执行高亮（回归）', async () => {
        const { ctx, appended } = makeCtx('正文内容');
        const request = ctx.refreshPreview(true);

        const child = { text: '正文内容' };
        completeRender(0, child, appended, ctx);
        await request;

        expect(appended).toEqual([child]);
        expect(ctx.previewContent.empty).toHaveBeenCalledTimes(1);
        expect(ctx.applyHighlightsToDOM).toHaveBeenCalledTimes(1);
    });
});
