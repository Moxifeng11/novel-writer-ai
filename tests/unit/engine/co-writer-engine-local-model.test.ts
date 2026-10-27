import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine, ContextSnapshot, isLocalModel, resolveCoWriteLocalModel } from '../../../engine/co-writer-engine';

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

    it('显式 coWriteModel 属于云端 provider 时，本地模式返回 undefined', () => {
        const settings = {
            coWriteModel: 'deepseek-chat',
            proModel: 'qwen:7b',
            customProviders: [
                { id: 'deepseek', endpoint: 'https://api.deepseek.com/v1', sourceType: 'cloud', models: ['deepseek-chat'] },
                { id: 'local-x', endpoint: 'http://localhost:1234/v1', sourceType: 'local', models: ['qwen:7b'] },
            ],
        };
        expect(resolveCoWriteLocalModel(settings)).toBeUndefined();
        expect(isLocalModel('deepseek-chat', settings)).toBe(false);
    });

    it('自定义本地 provider（非 id=ollama）也能识别本地模型', () => {
        const settings = {
            coWriteModel: 'qwen:7b',
            customProviders: [
                { id: 'local-x', endpoint: 'http://localhost:1234/v1', sourceType: 'local', models: ['qwen:7b'] },
            ],
        };
        expect(resolveCoWriteLocalModel(settings)).toBe('qwen:7b');
        expect(isLocalModel('qwen:7b', settings)).toBe(true);
    });

    it('本地模式找不到本地 provider 时返回 localRouteError，不使用云端端点', () => {
        const aiEngine = {
            getPlugin: () => ({
                settings: {
                    coWriteModelMode: 'local',
                    coWriteModel: 'qwen:7b',
                    customProviders: [],
                },
            }),
            callAI: vi.fn(async () => ({ content: '不应调用' })),
        };
        const engine = new CoWriterEngine({} as any, aiEngine as any, {} as any) as any;

        const options = engine.getCoWriteOptions();

        expect(options.localRouteError).toContain('未找到可用的本地模型供应商');
        expect(options.endpoint).toBe('http://127.0.0.1:1/v1/chat/completions');
        expect(options.disableFallback).toBe(true);
    });
});
