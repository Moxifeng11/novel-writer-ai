import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

type Suggestion = { id: string; text: string };

type EpochCtx = {
    suggestionEpoch: number;
    beginSuggestionEpoch: () => number;
    isCurrentSuggestionEpoch: (epoch: number) => boolean;
};

function makeEpochCtx(initial = 0): EpochCtx {
    const ctx = { suggestionEpoch: initial } as unknown as EpochCtx;
    ctx.beginSuggestionEpoch = CoWritingView.prototype['beginSuggestionEpoch'];
    ctx.isCurrentSuggestionEpoch = CoWritingView.prototype['isCurrentSuggestionEpoch'];
    return ctx;
}

type KeyCtx = {
    ghostSuggestion: Suggestion | null;
    isSuggesting: boolean;
    currentSuggestions: Suggestion[];
    handleAcceptSuggestion: ReturnType<typeof vi.fn>;
    acceptByIndex: ReturnType<typeof vi.fn>;
    handleTabSuggest: ReturnType<typeof vi.fn>;
    handleMarkdownShortcut: (event: KeyboardEvent) => boolean;
    handleEditorKeydown: (event: KeyboardEvent) => Promise<void>;
};

function makeKeyCtx(options: { isSuggesting: boolean; ghost?: Suggestion | null }): KeyCtx {
    const ctx = {
        ghostSuggestion: options.ghost ?? null,
        isSuggesting: options.isSuggesting,
        currentSuggestions: [],
        handleAcceptSuggestion: vi.fn(),
        acceptByIndex: vi.fn(),
        handleTabSuggest: vi.fn(),
        // 本组只验证 Tab 的异步归属；Markdown 快捷键由编辑器测试覆盖
        handleMarkdownShortcut: () => false,
    } as unknown as KeyCtx;
    ctx.handleEditorKeydown = CoWritingView.prototype['handleEditorKeydown'];
    return ctx;
}

function tabEvent(): KeyboardEvent {
    return { key: 'Tab', preventDefault: () => {} } as unknown as KeyboardEvent;
}

type FinalizeCtx = {
    suggestionEpoch: number;
    currentSuggestions: Suggestion[];
    currentRecord: object | null;
    isCurrentSuggestionEpoch: (epoch: number) => boolean;
    setGhostSuggestion: ReturnType<typeof vi.fn>;
    renderEmptySuggestions: ReturnType<typeof vi.fn>;
    updateHumanRateDashboard: ReturnType<typeof vi.fn>;
    finalizeAcceptedInsert: (epoch: number) => void;
};

function makeFinalizeCtx(currentEpoch: number): FinalizeCtx {
    const ctx = {
        suggestionEpoch: currentEpoch,
        currentSuggestions: [{ id: 's1', text: '旧候选' }],
        currentRecord: { id: 'rec' },
        setGhostSuggestion: vi.fn(),
        renderEmptySuggestions: vi.fn(),
        updateHumanRateDashboard: vi.fn(),
    } as unknown as FinalizeCtx;
    ctx.isCurrentSuggestionEpoch = CoWritingView.prototype['isCurrentSuggestionEpoch'];
    ctx.finalizeAcceptedInsert = CoWritingView.prototype['finalizeAcceptedInsert'];
    return ctx;
}

describe('CoWritingView — NBI-05 异步结果归属', () => {
    it('TR-E1: 代次递增后旧代次立即失效', () => {
        const ctx = makeEpochCtx();
        const oldEpoch = ctx.beginSuggestionEpoch();

        expect(ctx.isCurrentSuggestionEpoch(oldEpoch)).toBe(true);

        const newEpoch = ctx.beginSuggestionEpoch();
        expect(newEpoch).toBe(oldEpoch + 1);
        expect(ctx.isCurrentSuggestionEpoch(oldEpoch)).toBe(false);
        expect(ctx.isCurrentSuggestionEpoch(newEpoch)).toBe(true);
    });

    it('TR-E2: 生成中按 Tab 不消费幽灵建议，转入新一轮生成', async () => {
        const ctx = makeKeyCtx({
            isSuggesting: true,
            ghost: { id: 'g1', text: '生成期间的幽灵建议' },
        });

        await ctx.handleEditorKeydown(tabEvent());

        expect(ctx.handleAcceptSuggestion).not.toHaveBeenCalled();
        expect(ctx.handleTabSuggest).toHaveBeenCalledWith(false);
    });

    it('TR-E3: 空闲态按 Tab 正常接受幽灵建议', async () => {
        const ghost = { id: 'g2', text: '空闲态幽灵建议' };
        const ctx = makeKeyCtx({ isSuggesting: false, ghost });

        await ctx.handleEditorKeydown(tabEvent());

        expect(ctx.handleAcceptSuggestion).toHaveBeenCalledWith(ghost);
        expect(ctx.handleTabSuggest).not.toHaveBeenCalled();
    });

    it('TR-E4: 代次未变化时接受收尾正常清空候选与面板', () => {
        const ctx = makeFinalizeCtx(3);

        ctx.finalizeAcceptedInsert(3);

        expect(ctx.currentSuggestions).toEqual([]);
        expect(ctx.currentRecord).toBeNull();
        expect(ctx.setGhostSuggestion).toHaveBeenCalledWith(null);
        expect(ctx.renderEmptySuggestions).toHaveBeenCalledTimes(1);
        expect(ctx.updateHumanRateDashboard).toHaveBeenCalledTimes(1);
    });

    it('TR-E5: 收尾期间已开始新一轮生成（代次变化）→ 不覆盖其进度面板', () => {
        const ctx = makeFinalizeCtx(4);

        ctx.finalizeAcceptedInsert(3);

        expect(ctx.currentSuggestions).toEqual([{ id: 's1', text: '旧候选' }]);
        expect(ctx.currentRecord).toEqual({ id: 'rec' });
        expect(ctx.renderEmptySuggestions).not.toHaveBeenCalled();
        expect(ctx.updateHumanRateDashboard).not.toHaveBeenCalled();
    });
});
