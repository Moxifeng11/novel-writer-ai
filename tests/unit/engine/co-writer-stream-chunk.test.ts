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

const BASE_SETTINGS = {
    coWriteModel: 'qwen2.5:7b',
    defaultModel: 'deepseek-chat',
    availableModels: ['deepseek-chat'],
    coWriteTemperature: 0.7,
    coWriteMaxTokens: 600,
    candidateParallel: true,
    coWriteCandidateBatching: false,
    customProviders: [{ id: 'ollama', endpoint: 'http://localhost:11434', sourceType: 'local', models: ['qwen2.5:7b'], maxContext: 32768 }],
};

type StreamFactory = (callIndex: number) => AsyncGenerator<string, { content: string; error?: string }, unknown>;

function makeEngine(streamFactory: StreamFactory | null) {
    let callCount = 0;
    const aiEngine = {
        getPlugin: () => ({ settings: { ...BASE_SETTINGS } }),
        callAI: vi.fn(async () => ({ content: `非流式文本-${++callCount}` })),
        callAIAsyncIterator: vi.fn((..._args: unknown[]) => {
            const index = ++callCount;
            return streamFactory
                ? streamFactory(index)
                : (async function* () { yield `流式文本`; return { content: `流式文本` }; })();
        }),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
    engine.snapshot = makeSnapshot();
    return { engine, aiEngine };
}

describe('CoWriterEngine — NBI-03 建议/改写流式分片回调', () => {
    it('TR-S1: suggestNext 传入 onChunk 时逐片回调累计文本，按候选索引隔离', async () => {
        const { engine } = makeEngine((index) =>
            (async function* () {
                yield '候选';
                yield `-${index}`;
                return { content: `候选-${index}` };
            })()
        );

        const chunksByIndex = new Map<number, string[]>();
        const suggestions = await engine.suggestNext('前文', '', 'continue', 3, undefined, (index: number, cumulative: string) => {
            const list = chunksByIndex.get(index) ?? [];
            list.push(cumulative);
            chunksByIndex.set(index, list);
        });

        expect(suggestions).toHaveLength(3);
        expect(chunksByIndex.size).toBe(3);
        for (const [index, list] of chunksByIndex) {
            // 首个回调为空文本（用于重置），随后为累计文本
            expect(list[0]).toBe('');
            expect(list[list.length - 1]).toBe(suggestions[index].text);
            // 累计文本单调增长，且每片都是最终文本的前缀
            for (let k = 1; k < list.length; k++) {
                expect(list[k].length).toBeGreaterThanOrEqual(list[k - 1].length);
                expect(suggestions[index].text.startsWith(list[k])).toBe(true);
            }
        }
    });

    it('TR-S2: 不传 onChunk 时保持非流式路径，不调用流式迭代器', async () => {
        const { engine, aiEngine } = makeEngine(null);

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);

        expect(suggestions).toHaveLength(3);
        expect(aiEngine.callAIAsyncIterator).not.toHaveBeenCalled();
        expect(aiEngine.callAI).toHaveBeenCalledTimes(3);
        expect(suggestions[0].text).toContain('非流式文本');
    });

    it('TR-S3: 降级重启重放全文时以最终响应为准，累计文本不重复', async () => {
        const { engine } = makeEngine(() =>
            (async function* () {
                yield '上半段';
                // 模拟原生流中断后降级到模拟流：最终响应为全文
                return { content: '上半段下半段' };
            })()
        );

        const lastChunk: string[] = [];
        const suggestions = await engine.suggestNext('前文', '', 'continue', 3, undefined, (index: number, cumulative: string) => {
            lastChunk[index] = cumulative;
        });

        for (const suggestion of suggestions) {
            expect(suggestion.text).toBe('上半段下半段');
        }
        for (const text of lastChunk) {
            expect(text).toBe('上半段下半段');
        }
    });

    it('TR-S4: 分片期间 abort → 丢弃半成品，不返回候选', async () => {
        const controller = new AbortController();
        const { engine } = makeEngine(() =>
            (async function* () {
                yield '半截';
                controller.abort();
                yield '更多';
                return { content: '半截更多' };
            })()
        );

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3, controller.signal, () => {});

        expect(suggestions).toHaveLength(0);
    });

    it('TR-S5: rewriteSelection 传入 onChunk 时按方向索引回调，最终仍返回 3 条', async () => {
        const { engine } = makeEngine((index) =>
            (async function* () {
                yield '改写';
                yield `-${index}`;
                return { content: `改写-${index}` };
            })()
        );

        const chunksByIndex = new Map<number, string>();
        const suggestions = await engine.rewriteSelection(
            '选中文本',
            '前文',
            '后文',
            '',
            3,
            (index: number, cumulative: string) => {
                chunksByIndex.set(index, cumulative);
            }
        );

        expect(suggestions).toHaveLength(3);
        expect(suggestions.map((s: { direction: string }) => s.direction)).toEqual(['description', 'emotion', 'dialogue']);
        for (let i = 0; i < suggestions.length; i++) {
            expect(chunksByIndex.get(i)).toBe(suggestions[i].text);
        }
    });

    it('TR-S6: 改写分片期间 abort → 停止后续方向且不返回半成品候选', async () => {
        const controller = new AbortController();
        const { engine, aiEngine } = makeEngine(() =>
            (async function* () {
                yield '半截改写';
                controller.abort();
                return { content: '半截改写' };
            })()
        );

        const suggestions = await engine.rewriteSelection(
            '选中文本',
            '前文',
            '后文',
            '',
            3,
            () => {},
            controller.signal
        );

        expect(suggestions).toHaveLength(0);
        expect(aiEngine.callAIAsyncIterator).toHaveBeenCalledTimes(1);
    });

    it('TR-S7: 改写开始前已 abort → 不发起任何模型调用', async () => {
        const controller = new AbortController();
        controller.abort();
        const { engine, aiEngine } = makeEngine(null);

        const suggestions = await engine.rewriteSelection(
            '选中文本',
            '前文',
            '后文',
            '',
            3,
            undefined,
            controller.signal
        );

        expect(suggestions).toHaveLength(0);
        expect(aiEngine.callAI).not.toHaveBeenCalled();
        expect(aiEngine.callAIAsyncIterator).not.toHaveBeenCalled();
    });
});
