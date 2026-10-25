import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual };
});

import { CoWritingView } from '../../../ui/co-writing-view';

/**
 * 自动联想（幽灵建议）此前没有任何 UI 开关：只要输入停顿 1.5 秒就会发起 AI 请求
 * （4 秒限频），重度写作时等于持续的云端/本地调用。新增 `autoGhostAssociation`
 * 设置后，关闭必须真正停发请求、清掉残留建议，且在途结果不得写回。
 */

type GhostCtx = {
    plugin: { settings: { autoGhostAssociation?: boolean } };
    isAssociating: boolean;
    isSuggesting: boolean;
    currentSuggestions: any[];
    rightEditor: { value: string; selectionStart: number };
    lastGhostSeed: string;
    lastGhostRequestAt: number;
    suggestionEpoch: number;
    suggestAbortController: AbortController | null;
    facade: { suggestAssociation: ReturnType<typeof vi.fn> };
    ghostSuggestionContainer: any;
    ghostDebounceManager: { debounceFixed: ReturnType<typeof vi.fn> };
    setGhostSuggestion: (suggestion: any) => void;
    renderAssociationCards: ReturnType<typeof vi.fn>;
    isCurrentSuggestionEpoch: () => boolean;
    isGhostAssociationEnabled: () => boolean;
    scheduleGhostAssociationRefresh: () => void;
    refreshGhostAssociation: () => Promise<void>;
};

function makeCtx(autoGhostAssociation?: boolean): GhostCtx {
    const ghostSuggestionContainer = {
        empty: vi.fn(),
        toggleClass: vi.fn(),
        createSpan: vi.fn(),
    };
    const ctx = {
        plugin: { settings: { autoGhostAssociation } },
        isAssociating: false,
        isSuggesting: false,
        currentSuggestions: [],
        rightEditor: { value: 'a'.repeat(60), selectionStart: 60 },
        lastGhostSeed: '',
        lastGhostRequestAt: 0,
        suggestionEpoch: 0,
        suggestAbortController: null,
        facade: { suggestAssociation: vi.fn().mockResolvedValue([]) },
        ghostSuggestionContainer,
        ghostDebounceManager: { debounceFixed: vi.fn() },
        renderAssociationCards: vi.fn(),
        isCurrentSuggestionEpoch: () => true,
    } as unknown as GhostCtx;

    ctx.setGhostSuggestion = CoWritingView.prototype['setGhostSuggestion'].bind(ctx);
    ctx.isGhostAssociationEnabled = CoWritingView.prototype['isGhostAssociationEnabled'].bind(ctx);
    ctx.scheduleGhostAssociationRefresh = CoWritingView.prototype['scheduleGhostAssociationRefresh'].bind(ctx);
    ctx.refreshGhostAssociation = CoWritingView.prototype['refreshGhostAssociation'].bind(ctx);
    return ctx;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CoWritingView — 自动联想开关', () => {
    it('关闭时不发起联想请求，并清空已显示的幽灵建议', async () => {
        const ctx = makeCtx(false);

        await ctx.refreshGhostAssociation();

        expect(ctx.facade.suggestAssociation).not.toHaveBeenCalled();
        expect(ctx.ghostSuggestionContainer.empty).toHaveBeenCalled();
        expect(ctx.ghostSuggestionContainer.toggleClass).toHaveBeenCalledWith('is-visible', false);
        expect(ctx.lastGhostSeed).toBe('');
    });

    it('默认（未设置）时保持开启并正常请求（回归）', async () => {
        const ctx = makeCtx(undefined);

        await ctx.refreshGhostAssociation();

        expect(ctx.facade.suggestAssociation).toHaveBeenCalledTimes(1);
        expect(ctx.lastGhostSeed).toBe('a'.repeat(60));
        expect(ctx.isAssociating).toBe(false);
    });

    it('请求在途时关闭设置，返回结果不写回界面', async () => {
        const ctx = makeCtx(true);
        let resolveRequest: (value: any[]) => void = () => {};
        ctx.facade.suggestAssociation.mockImplementation(
            () => new Promise<any[]>(resolve => { resolveRequest = resolve; }),
        );

        const pending = ctx.refreshGhostAssociation();
        ctx.plugin.settings.autoGhostAssociation = false;
        resolveRequest([{ text: '联想结果', type: 'continuation' }]);
        await pending;

        expect(ctx.currentSuggestions).toEqual([]);
        expect(ctx.renderAssociationCards).not.toHaveBeenCalled();
    });

    it('关闭时 schedule 不排防抖任务并清空建议', () => {
        const ctx = makeCtx(false);

        ctx.scheduleGhostAssociationRefresh();

        expect(ctx.ghostDebounceManager.debounceFixed).not.toHaveBeenCalled();
        expect(ctx.ghostSuggestionContainer.empty).toHaveBeenCalled();
    });

    it('开启时 schedule 仍按 1.5 秒防抖排队（回归）', () => {
        const ctx = makeCtx(true);

        ctx.scheduleGhostAssociationRefresh();

        expect(ctx.ghostDebounceManager.debounceFixed).toHaveBeenCalledWith(
            'ghost-association',
            expect.any(Function),
            1500,
        );
    });
});
