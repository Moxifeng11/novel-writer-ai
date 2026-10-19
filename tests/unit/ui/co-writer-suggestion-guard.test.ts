import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

type Suggestion = { id: string; text: string };

type GuardCtx = {
    isSuggesting: boolean;
    currentSuggestions: Suggestion[];
    suggestAbortController: { signal: AbortSignal } | null;
    handleAcceptSuggestion: ReturnType<typeof vi.fn>;
    setGhostSuggestion: ReturnType<typeof vi.fn>;
    acceptByIndex: (index: number) => Promise<void>;
    clearStaleSuggestions: () => void;
    isSuggestRequestOwner: (signal: AbortSignal) => boolean;
};

function makeCtx(options: {
    isSuggesting?: boolean;
    suggestions?: Suggestion[];
    controller?: { signal: AbortSignal } | null;
} = {}): GuardCtx {
    const ctx = {
        isSuggesting: options.isSuggesting ?? false,
        currentSuggestions: options.suggestions ?? [],
        suggestAbortController: options.controller ?? null,
        handleAcceptSuggestion: vi.fn(),
        setGhostSuggestion: vi.fn(),
    } as unknown as GuardCtx;
    ctx.acceptByIndex = CoWritingView.prototype['acceptByIndex'];
    ctx.clearStaleSuggestions = CoWritingView.prototype['clearStaleSuggestions'];
    ctx.isSuggestRequestOwner = CoWritingView.prototype['isSuggestRequestOwner'];
    return ctx;
}

describe('CoWritingView — RG-02 旧候选接受守卫', () => {
    it('TR-R1: 生成中按 Ctrl+1~3 → 不插入任何候选', async () => {
        const ctx = makeCtx({
            isSuggesting: true,
            suggestions: [{ id: 's1', text: '上一轮旧候选' }],
        });

        await ctx.acceptByIndex(0);

        expect(ctx.handleAcceptSuggestion).not.toHaveBeenCalled();
    });

    it('TR-R2: 就绪态按 Ctrl+2 → 插入索引 1 的候选', async () => {
        const second = { id: 's2', text: '第二条候选' };
        const ctx = makeCtx({
            isSuggesting: false,
            suggestions: [{ id: 's1', text: '第一条候选' }, second],
        });

        await ctx.acceptByIndex(1);

        expect(ctx.handleAcceptSuggestion).toHaveBeenCalledTimes(1);
        expect(ctx.handleAcceptSuggestion).toHaveBeenCalledWith(second);
    });

    it('TR-R3: 就绪态但索引越界 → 不插入', async () => {
        const ctx = makeCtx({
            isSuggesting: false,
            suggestions: [{ id: 's1', text: '唯一候选' }],
        });

        await ctx.acceptByIndex(2);

        expect(ctx.handleAcceptSuggestion).not.toHaveBeenCalled();
    });

    it('TR-R4: 新一轮生成开始 → 清空旧候选与幽灵建议', () => {
        const ctx = makeCtx({
            isSuggesting: true,
            suggestions: [{ id: 's1', text: '旧候选' }, { id: 's2', text: '旧候选 2' }],
        });

        ctx.clearStaleSuggestions();

        expect(ctx.currentSuggestions).toEqual([]);
        expect(ctx.setGhostSuggestion).toHaveBeenCalledWith(null);
    });

    it('TR-R5: 旧请求不再被视为最新请求 → 不得清理新请求状态', () => {
        const oldController = new AbortController();
        const newController = new AbortController();
        const ctx = makeCtx({ controller: newController });

        expect(ctx.isSuggestRequestOwner(newController.signal)).toBe(true);
        expect(ctx.isSuggestRequestOwner(oldController.signal)).toBe(false);

        ctx.suggestAbortController = null;
        expect(ctx.isSuggestRequestOwner(oldController.signal)).toBe(false);
    });
});
