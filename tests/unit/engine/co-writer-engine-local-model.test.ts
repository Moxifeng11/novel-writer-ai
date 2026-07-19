import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine, ContextSnapshot } from '../../../engine/co-writer-engine';

function makeSnapshot(): ContextSnapshot {
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
    };
}

function makeEngine(settings: Record<string, unknown>) {
    const aiEngine = {
        getPlugin: () => ({ settings }),
        callAI: vi.fn(async () => ({ content: '不应调用' })),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
    engine.snapshot = makeSnapshot();
    return { engine, aiEngine };
}

describe('CoWriterEngine 协同写作本地模型约束', () => {
    it('未配置 coWriteModel 时不调用 AI，避免回退远程模型', async () => {
        const { engine, aiEngine } = makeEngine({
            coWriteModel: '',
            defaultModel: 'deepseek-chat',
            availableModels: ['deepseek-chat'],
            coWriteTemperature: 0.7,
            coWriteMaxTokens: 600,
        });

        const suggestions = await engine.suggestNext('前文', '', 'continue', 1);

        expect(suggestions).toEqual([]);
        expect(aiEngine.callAI).not.toHaveBeenCalled();
    });
});
