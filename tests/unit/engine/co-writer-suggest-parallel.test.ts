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
    coWriteModelMode: 'cloud',
    defaultModel: 'deepseek-chat',
    availableModels: ['deepseek-chat'],
    coWriteTemperature: 0.7,
    coWriteMaxTokens: 600,
    candidateParallel: true,
    customProviders: [{ id: 'ollama', endpoint: 'http://localhost:11434', sourceType: 'local', models: ['qwen2.5:7b'], maxContext: 32768 }],
};

/** 构造带可控 callAI 的引擎；delayMs 控制每次调用的模拟耗时（默认 0） */
function makeEngine(settingsOverrides: Record<string, unknown> = {}, delayMs: number = 0) {
    const callLog: Array<{ start: number; end: number }> = [];
    let callCount = 0;
    const aiEngine = {
        getPlugin: () => ({ settings: { ...BASE_SETTINGS, ...settingsOverrides } }),
        callAI: vi.fn(async () => {
            const n = ++callCount;
            const start = Date.now();
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            callLog.push({ start, end: Date.now() });
            return { content: `候选文本-${n}` };
        }),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
    engine.snapshot = makeSnapshot();
    return { engine, aiEngine, callLog };
}

describe('CoWriterEngine.suggestNext — P0-1 三候选并行化', () => {
    it('TR-4.1: 三候选并行执行，调用区间相互重叠，总耗接近单次', async () => {
        const { engine, callLog } = makeEngine({}, 80);
        const t0 = Date.now();
        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);
        const elapsed = Date.now() - t0;

        expect(suggestions).toHaveLength(3);
        // 并行判据：3 个调用几乎同时开始（首末 start 差远小于 80ms 延迟）
        const starts = callLog.map((c) => c.start);
        const maxStartSpread = Math.max(...starts) - Math.min(...starts);
        expect(maxStartSpread).toBeLessThan(40);
        // 总耗 < 串行(240ms)的一半
        expect(elapsed).toBeLessThan(160);
    });

    it('TR-4.2: 1 方向失败 → 返回其余 2 条，不抛异常（部分失败降级）', async () => {
        let callSeq = 0;
        const aiEngine = {
            getPlugin: () => ({ settings: { ...BASE_SETTINGS } }),
            callAI: vi.fn(async () => {
                const n = ++callSeq;
                if (n === 2) return { content: '' }; // 第 2 个方向返回空 → 该方向无结果
                return { content: `候选-${n}` };
            }),
        };
        const contextManager = { gatherAll: vi.fn() };
        const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
        engine.snapshot = makeSnapshot();

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);
        expect(suggestions).toHaveLength(2);
    });

    it('TR-4.3: 预先 abort 的 signal → 返回空数组，callAI 未被调用', async () => {
        const { engine, aiEngine } = makeEngine();
        const ac = new AbortController();
        ac.abort();

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3, ac.signal);
        expect(suggestions).toEqual([]);
        expect(aiEngine.callAI).not.toHaveBeenCalled();
    });

    it('TR-4.7: 某方向输出设定库/规划文本 → 该候选丢弃，不进入建议卡片', async () => {
        let callSeq = 0;
        const planning = [
            '#### **世界观底层规则**',
            '1. **物理法则**：灵力守恒',
            '2. **时空特性**：三界分层',
            '3. **因果规则**：行为决定业力',
        ].join('\n');
        const aiEngine = {
            getPlugin: () => ({ settings: { ...BASE_SETTINGS } }),
            callAI: vi.fn(async () => {
                const n = ++callSeq;
                if (n === 1) return { content: planning };
                return { content: `沈砚握紧剑柄，指节发白。这是第${n}段正文。` };
            }),
        };
        const contextManager = { gatherAll: vi.fn() };
        const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
        engine.snapshot = makeSnapshot();

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);

        expect(suggestions).toHaveLength(2);
        expect(suggestions.every((s: { text: string }) => !s.text.includes('世界观底层规则'))).toBe(true);
    });

    it('TR-4.4: candidateParallel=false → 回退串行（调用区间无重叠）', async () => {
        const { engine, callLog } = makeEngine({ candidateParallel: false }, 80);

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);
        expect(suggestions).toHaveLength(3);

        // 串行判据：每个调用的 start 晚于前一个的 end
        for (let i = 1; i < callLog.length; i++) {
            expect(callLog[i].start).toBeGreaterThanOrEqual(callLog[i - 1].end - 5);
        }
    });

    it('TR-4.6: 本地模型模式即使 candidateParallel=true 也串行（Ollama 单槽排队）', async () => {
        const { engine, callLog } = makeEngine({ coWriteModelMode: 'local', candidateParallel: true }, 40);

        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);
        expect(suggestions).toHaveLength(3);

        for (let i = 1; i < callLog.length; i++) {
            expect(callLog[i].start).toBeGreaterThanOrEqual(callLog[i - 1].end - 5);
        }
    });

    it('TR-4.5: 返回候选顺序 = directions 顺序，字段结构与现状一致', async () => {
        const { engine } = makeEngine();
        const suggestions = await engine.suggestNext('前文', '', 'continue', 3);

        expect(suggestions[0]).toMatchObject({ style: 'default' });
        expect(suggestions[1]).toMatchObject({ style: 'creative' });
        expect(suggestions[2]).toMatchObject({ style: 'conservative' });
        for (const s of suggestions) {
            expect(s.id).toMatch(/^sug_/);
            expect(typeof s.text).toBe('string');
            expect(s.temperature).toBeGreaterThanOrEqual(0.7);
        }
    });
});
