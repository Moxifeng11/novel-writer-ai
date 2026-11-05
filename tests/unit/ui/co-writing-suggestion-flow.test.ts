import { describe, expect, it } from 'vitest';
import { runStreamSuggestion, runTabSuggest, type SuggestionFlowHost } from '@/ui/co-writing/suggestion-flow';

function guardHost(overrides: Partial<SuggestionFlowHost>): SuggestionFlowHost {
    return {
        project: '',
        volume: '',
        chapterNum: 0,
        rightEditor: { value: '', selectionStart: 0 } as HTMLTextAreaElement,
        cursorHint: '',
        canColdStart: () => false,
        isSuggesting: false,
        lastSuggestAt: 0,
        suggestAbortController: null,
        suggestProgressEmitter: null,
        suggestEtaDisplay: null,
        suggestBtn: null,
        timeEstimator: null,
        facade: {} as never,
        ...overrides,
    } as SuggestionFlowHost;
}

describe('suggestion-flow — 入口守卫', () => {
    it('未绑定章节时 Tab 建议直接返回', async () => {
        await expect(runTabSuggest(guardHost({}), false)).resolves.toBeUndefined();
    });

    it('正文为空且无规划时 Tab 建议直接返回', async () => {
        await expect(runTabSuggest(guardHost({ project: 'p', volume: '第1卷', chapterNum: 1 }), false))
            .resolves.toBeUndefined();
    });

    it('生成中不再启动流式建议', async () => {
        await expect(runStreamSuggestion(guardHost({ isSuggesting: true }), 0)).resolves.toBeUndefined();
    });
});
