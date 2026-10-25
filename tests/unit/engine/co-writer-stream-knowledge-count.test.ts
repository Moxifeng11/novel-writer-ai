import { describe, it, expect, vi } from 'vitest';

/**
 * 流式建议（Tab 主路径）生成完成后，协同视图会用 `showKnowledgeInjectionNotice()`
 * 展示「已注入 N 条知识库片段」。但 `suggestStream` 从不写 `lastKnowledgeCount`：
 * 提示显示的是上一次非流式生成（或初始 0）的旧数字，与实际 prompt 不同口径。
 */
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine, ContextSnapshot } from '../../../engine/co-writer-engine';
import { PromptBuilder } from '../../../engine/prompt-builder';

function makeSnapshot(): ContextSnapshot {
    return {
        project: '测试项目',
        chapterName: '第1章',
        allChars: '',
        allFactions: '',
        allLocs: '',
        allItems: '',
        foreshadows: { unrevealed: [], revealed: [], abandoned: [] },
        relationshipStates: [],
        crossVolumeContext: '',
        longTermMemoryContext: '',
        fanficRulesContext: '',
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

function makeEngine() {
    const aiEngine = {
        getPlugin: () => ({
            settings: {
                coWriteModelMode: 'local',
                coWriteModel: 'qwen2.5:7b',
                coWriteLocalModel: 'qwen2.5:7b',
                coWriteMaxTokens: 600,
            },
        }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const engine = new CoWriterEngine({} as any, aiEngine as any, { gatherAll: vi.fn() } as any) as any;
    engine.snapshot = makeSnapshot();
    engine.chapterBrief = null;
    engine.promptBuilder = new PromptBuilder(() => engine.snapshot);
    engine.referenceBookIds = ['参考书'];
    engine.annotateSuggestionRisk = (suggestion: unknown) => suggestion;
    // 不发起真实 AI 调用：直接返回一段正文
    engine.callCoWriteAIStream = async function* () {
        return { content: '他抬头看向星图，低声说了一句。' };
    };
    return engine;
}

async function drainStream(engine: any): Promise<void> {
    const stream = engine.suggestStream('前文一句。', '', 'continue', 0);
    while (true) {
        const result = await stream.next();
        if (result.done) break;
    }
}

describe('CoWriterEngine 流式建议的知识注入条数', () => {
    it('按本次实际注入的片段数写 lastKnowledgeCount', async () => {
        const engine = makeEngine();
        engine.promptBuilder.getKnowledgePromptParts = vi.fn(async () => ['片段一', '片段二']);
        engine.lastKnowledgeCount = 0;

        await drainStream(engine);

        expect(engine.lastKnowledgeCount).toBe(2);
    });

    it('本次检索失败时归零，不沿用上一条建议的旧数字', async () => {
        const engine = makeEngine();
        engine.promptBuilder.getKnowledgePromptParts = vi.fn(async () => {
            throw new Error('向量库不可用');
        });
        engine.lastKnowledgeCount = 3;

        await drainStream(engine);

        expect(engine.lastKnowledgeCount).toBe(0);
    });
});
