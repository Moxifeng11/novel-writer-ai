/**
 * co-writer-init-and-batch.test.ts — 协同引擎上下文与批量候选
 *
 * 锁定三处真实缺陷：
 * 1. init() 失败时只重建 snapshot，session/soul 仍指向上一个项目/章节；
 * 2. 并发 init 没有代次，慢的旧章节结果会覆盖新章节；
 * 3. 本地批量候选路径完全跳过参考书检索与注入计数（本地模式默认走批量）。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine } from '../../../engine/co-writer-engine';

function makeSnapshot(project: string, chapterName: string) {
    return {
        project,
        chapterName,
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
        currentMode: 'continue' as const,
        gatheredAt: Date.now(),
        dirtyFields: new Set<string>(),
    };
}

function makeEngine(contextManager: any) {
    const aiEngine = {
        getPlugin: () => ({ settings: {} }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager) as any;
    // 这些依赖与本组断言无关：直接打桩，保证 init 只暴露被验证的状态字段
    engine.initializeRepositories = () => undefined;
    engine.maybeRefreshStoryContextPack = () => undefined;
    engine.syncCreationModeContext = async () => undefined;
    engine.buildSnapshot = (_ctx: unknown, project: string, chapterName: string) =>
        makeSnapshot(project, chapterName);
    return engine;
}

function makeSession(project: string, chapterNum: number) {
    return {
        project,
        chapterName: `第${chapterNum}章`,
        volume: '第1卷',
        chapterNum,
        startedAt: 1,
        interactions: [],
        currentMetrics: {},
        totalWordCount: 0,
    };
}

describe('CoWriterEngine.init — 失败与并发时的上下文归属', () => {
    it('gatherAll 失败也会把 session 重建到目标章节，并清掉上一章的灵魂层', async () => {
        const engine = makeEngine({ gatherAll: vi.fn(async () => { throw new Error('vault busy'); }) });
        engine.session = makeSession('旧书', 1);
        engine.soulData = { protagonistName: '旧主角' };
        engine.pendingStateChanges = [{ entityName: '旧人物', newStatus: '重伤' }];

        await engine.init('新书', '第2章', '第2卷', 2);

        expect(engine.session).toMatchObject({ project: '新书', volume: '第2卷', chapterNum: 2 });
        expect(engine.session.interactions).toEqual([]);
        // 旧实现只在 try 里赋值 session：降级后仍指向旧书，实体变更会按旧身份入队
        expect(engine.soulData).toBeNull();
        expect(engine.pendingStateChanges).toEqual([]);
        expect(engine.snapshot.project).toBe('新书');
    });

    it('慢的旧 init 不得覆盖后发起的新章节', async () => {
        let resolveSlow: (value: unknown) => void = () => undefined;
        const slowGather = new Promise(resolve => { resolveSlow = resolve; });
        const engine = makeEngine({
            gatherAll: vi.fn((project: string) => (
                project === 'A书' ? slowGather : Promise.resolve({ project })
            )),
        });

        const initA = engine.init('A书', '第1章', '第1卷', 1);
        const initB = engine.init('B书', '第2章', '第1卷', 2);
        await initB;
        // A 的采集现在才返回：代次已过期，必须整体放弃写入
        resolveSlow({ project: 'A书' });
        await initA;

        expect(engine.session.project).toBe('B书');
        expect(engine.snapshot.project).toBe('B书');
        expect(engine.snapshot.chapterName).toBe('第2章');
    });

    it('init 开头清空上一章的待确认实体变更', async () => {
        const engine = makeEngine({ gatherAll: vi.fn(async () => ({})) });
        engine.pendingStateChanges = [
            { entityName: '甲', newStatus: '一' },
            { entityName: '乙', newStatus: '二' },
        ];

        await engine.init('新书', '第1章', '第1卷', 1);

        expect(engine.pendingStateChanges).toEqual([]);
    });
});

describe('CoWriterEngine.tryBatchedCandidates — 参考书检索与注入计数', () => {
    function makeBatchEngine(parts: string[] | Error) {
        const engine = makeEngine({ gatherAll: vi.fn() });
        engine.referenceBookIds = ['book-1'];
        engine.promptBuilder = {
            getKnowledgePromptParts: vi.fn(async () => {
                if (parts instanceof Error) throw parts;
                return parts;
            }),
        };
        engine.buildDirectionalPrompt = vi.fn(() => ({ system: 'SYS', user: 'USER' }));
        engine.recordKnowledgeInjection = vi.fn();
        engine.callCoWriteAI = vi.fn(async () => ({
            content: JSON.stringify([
                { direction: 'action', text: '他抬起头，看向远处翻涌的云层。' },
                { direction: 'emotion', text: '胸口那点热意慢慢沉下去，像被风吹凉。' },
            ]),
        }));
        return engine;
    }

    const shared = {
        precedingText: '前文一句。',
        cursorHint: '',
        fingerprintParts: [] as string[],
        knowledgeInjection: '',
        kbDeepInjection: '',
        recentSentences: [] as string[],
        settings: { coWriteMaxTokens: 600 },
    };

    it('批量路径会检索参考书、写进 prompt 并记录注入计数', async () => {
        const engine = makeBatchEngine(['片段一', '片段二']);

        const records = await engine.tryBatchedCandidates(['action', 'emotion', 'dialogue'], shared);

        expect(records?.length).toBe(2);
        expect(engine.promptBuilder.getKnowledgePromptParts).toHaveBeenCalledTimes(1);
        // 检索结果必须真的进入 prompt
        const promptArgs = engine.buildDirectionalPrompt.mock.calls[0];
        expect(promptArgs[4]).toEqual(['片段一', '片段二']);
        // 三个方向共用同一份检索结果，计数逐个写入
        expect(engine.directionKnowledgeCounts).toEqual({ action: 2, emotion: 2, dialogue: 2 });
        expect(engine.recordKnowledgeInjection).toHaveBeenCalledWith(2, expect.any(String), ['片段一', '片段二']);
    });

    it('检索失败不阻塞候选生成，计数归零', async () => {
        const engine = makeBatchEngine(new Error('embedding down'));

        const records = await engine.tryBatchedCandidates(['action', 'emotion', 'dialogue'], shared);

        expect(records?.length).toBe(2);
        expect(engine.directionKnowledgeCounts).toEqual({ action: 0, emotion: 0, dialogue: 0 });
    });

    it('没有参考书时不调用检索', async () => {
        const engine = makeBatchEngine(['片段一']);
        engine.referenceBookIds = [];

        await engine.tryBatchedCandidates(['action', 'emotion', 'dialogue'], shared);

        expect(engine.promptBuilder.getKnowledgePromptParts).not.toHaveBeenCalled();
    });
});
