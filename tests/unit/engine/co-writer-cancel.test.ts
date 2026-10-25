import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine, type ContextSnapshot } from '../../../engine/co-writer-engine';
import { PromptBuilder } from '../../../engine/prompt-builder';
import { estimateInputTokens } from '../../../shared/token-estimator';

function repeat(ch: string, n: number): string {
    return ch.repeat(n);
}

function makeSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
    return {
        project: '测试项目',
        chapterName: '第1章',
        allChars: '',
        allFactions: '',
        allLocs: '',
        allItems: '',
        foreshadows: {},
        relationshipStates: [],
        crossVolumeContext: '',
        worldView: '',
        worldType: '',
        writingStyle: '',
        writingRules: '',
        protagonistSoulDetail: '',
        emotionPlan: '',
        sceneExpansion: '',
        chapPlan: '',
        prevChaptersSummary: '',
        settingLib: '',
        timeline: '',
        characterCores: '',
        triggeredMemories: '',
        precedingText: '',
        cursorHint: '',
        currentMode: 'continue',
        gatheredAt: Date.now(),
        dirtyFields: new Set(),
        ...overrides,
    };
}

function makeEngine(settings: Record<string, unknown>, snapshot?: ContextSnapshot): { engine: any; aiEngine: any } {
    const aiEngine = {
        getPlugin: () => ({ settings }),
        callAI: vi.fn(async () => ({ content: '他抬手推开门。' })),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
    engine.snapshot = snapshot ?? makeSnapshot();
    return { engine, aiEngine };
}

const LOCAL_SETTINGS = {
    coWriteModelMode: 'local',
    coWriteModel: 'my-local-model',
    coWriteTemperature: 0.7,
    coWriteMaxTokens: 600,
    customProviders: [{ id: 'ollama', endpoint: 'http://127.0.0.1:11434' }],
};

describe('CoWriterEngine — 联想/迭代取消链路（Phase 3.2）', () => {
    it('已中止的联想不发起模型调用', async () => {
        const { engine, aiEngine } = makeEngine(LOCAL_SETTINGS);
        const controller = new AbortController();
        controller.abort();

        const result = await engine.suggestAssociation(3, '他推开门。', 'manual', controller.signal);

        expect(result).toEqual([]);
        expect(aiEngine.callAI).not.toHaveBeenCalled();
    });

    it('已中止的迭代不发起模型调用', async () => {
        const { engine, aiEngine } = makeEngine(LOCAL_SETTINGS);
        const controller = new AbortController();
        controller.abort();

        const result = await engine.iterateSuggestion(
            { id: 's1', text: '原候选', direction: 'action', style: 'default', temperature: 0.7, preview: '' } as any,
            '写得更紧张',
            '前文一句。',
            '',
            controller.signal,
        );

        expect(result).toBeNull();
        expect(aiEngine.callAI).not.toHaveBeenCalled();
    });

    it('联想把 AbortSignal 透传给 AI 调用', async () => {
        const { engine, aiEngine } = makeEngine(LOCAL_SETTINGS);
        const controller = new AbortController();

        const result = await engine.suggestAssociation(3, '他推开门。', 'manual', controller.signal);

        expect(result.length).toBeGreaterThan(0);
        expect(aiEngine.callAI).toHaveBeenCalledTimes(1);
        expect(aiEngine.callAI.mock.calls[0][5]?.signal).toBe(controller.signal);
    });
});

describe('CoWriterEngine — 本地小窗口预算（Phase 3.4）', () => {
    it('未登记本地模型按 8K 窗口计算输入预算', () => {
        const { engine } = makeEngine(LOCAL_SETTINGS);
        const budget = engine.getCoWriteInputBudget();
        // 8192 - 600 * 1.2 = 7472
        expect(budget.maxInputTokens).toBe(7472);
        expect(budget.modelId).toBe('my-local-model');
    });

    it('已登记本地模型使用自身窗口', () => {
        const { engine } = makeEngine({ ...LOCAL_SETTINGS, coWriteModel: 'qwen2.5:7b' });
        const budget = engine.getCoWriteInputBudget();
        expect(budget.maxInputTokens).toBe(32768 - 720);
    });

    it('超长上下文会被裁剪到预算内且保留必保片段', () => {
        const snapshot = makeSnapshot({
            allChars: repeat('人', 3000),
            allFactions: repeat('势', 2000),
            allLocs: repeat('地', 2000),
            allItems: repeat('物', 2000),
            writingRules: repeat('规', 3000),
            prevChaptersSummary: repeat('摘', 3000),
            triggeredMemories: repeat('忆', 2000),
            settingLib: repeat('设', 3000),
            timeline: repeat('时', 2000),
        });
        const { engine } = makeEngine(LOCAL_SETTINGS, snapshot);
        engine.promptBuilder = new PromptBuilder(() => snapshot as any);

        const budget = engine.getCoWriteInputBudget();
        const prompt = engine.buildDirectionalPrompt('前文一句。', 'action', '', [], [], '');
        const tokens = estimateInputTokens(prompt.system, prompt.user, budget.modelId);

        expect(tokens).toBeLessThanOrEqual(budget.maxInputTokens);
        expect(prompt.user).toContain('【已写内容】');
        expect(prompt.user).toContain('【写作方向】');
    });
});
