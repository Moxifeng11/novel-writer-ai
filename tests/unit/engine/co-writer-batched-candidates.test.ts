import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({ default: class NovelWriterPlugin {} }));

import { CoWriterEngine } from '../../../engine/co-writer-engine';

function makeEngine(callAI: any) {
    const settings = {
        coWriteModel: 'qwen2.5:7b',
        coWriteModelMode: 'local',
        coWriteTemperature: 0.7,
        coWriteMaxTokens: 600,
        coWriteCandidateBatching: true,
        customProviders: [{ id: 'ollama', endpoint: 'http://localhost:11434', sourceType: 'local', models: ['qwen2.5:7b'], maxContext: 32768 }],
    };
    const aiEngine = {
        getPlugin: () => ({ settings }),
        callAI,
        callAIAsyncIterator: vi.fn(),
    };
    const engine = new CoWriterEngine({} as never, aiEngine as never, {} as never) as any;
    engine.snapshot = { project: '测试', chapterName: '第1章' };
    return { engine, aiEngine };
}

describe('CoWriterEngine — 本地候选批量化', () => {
    it('一次调用返回 3 个方向候选，不再逐方向串行', async () => {
        const callAI = vi.fn(async () => ({
            content: JSON.stringify([
                { direction: 'action', text: '他推开门，风灌进来。' },
                { direction: 'emotion', text: '他握紧门把，指节发白。' },
                { direction: 'dialogue', text: '“谁在外面？”他压低声音问。' },
            ]),
        }));
        const { engine, aiEngine } = makeEngine(callAI);

        const suggestions = await engine.suggestNext('前文。', '', 'continue', 3);

        expect(suggestions).toHaveLength(3);
        expect(callAI).toHaveBeenCalledTimes(1);
        expect(aiEngine.callAIAsyncIterator).not.toHaveBeenCalled();
    });

    it('批量 JSON 解析失败时回退原逐方向路径', async () => {
        let calls = 0;
        const callAI = vi.fn(async () => {
            calls++;
            return calls === 1
                ? { content: '不是 JSON' }
                : { content: `候选文本-${calls}` };
        });
        const { engine } = makeEngine(callAI);

        const suggestions = await engine.suggestNext('前文。', '', 'continue', 3);

        expect(suggestions).toHaveLength(3);
        expect(callAI).toHaveBeenCalledTimes(4); // 1 次批量失败 + 3 次逐方向
    });
});

describe('CoWriterEngine — 本地改写批量化', () => {
    it('一次调用返回 3 个方向的改写，不再逐方向串行', async () => {
        const callAI = vi.fn(async () => ({
            content: JSON.stringify([
                { direction: 'description', text: '门轴吱呀一声，冷风卷着雨丝扑进来。' },
                { direction: 'emotion', text: '他攥紧门把，掌心全是汗。' },
                { direction: 'dialogue', text: '“把门关上。”他的声音比雨更冷。' },
            ]),
        }));
        const { engine } = makeEngine(callAI);

        const suggestions = await engine.rewriteSelection('他推开门。', '前文。', '后文。', '', 3);

        expect(suggestions).toHaveLength(3);
        expect(callAI).toHaveBeenCalledTimes(1);
    });

    it('批量改写 JSON 非法时回退逐方向调用', async () => {
        let calls = 0;
        const callAI = vi.fn(async () => {
            calls++;
            return calls === 1 ? { content: 'not-json' } : { content: `改写-${calls}` };
        });
        const { engine } = makeEngine(callAI);

        const suggestions = await engine.rewriteSelection('他推开门。', '前文。', '后文。', '', 3);

        expect(suggestions).toHaveLength(3);
        expect(callAI).toHaveBeenCalledTimes(4);
    });
});

describe('CoWriterEngine — 本地调用队列', () => {
    it('并发调用在本地模式下串行执行，最多 1 个在途', async () => {
        const { resetLocalAiQueueForTests } = await import('../../../shared/local-ai-queue');
        resetLocalAiQueueForTests();
        let active = 0;
        let maxActive = 0;
        const callAI = vi.fn(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
            return { content: 'ok' };
        });
        const { engine } = makeEngine(callAI);

        await Promise.all([
            (engine as any).callCoWriteAI({ system: '', user: 'a' }, 0),
            (engine as any).callCoWriteAI({ system: '', user: 'b' }, 0),
            (engine as any).callCoWriteAI({ system: '', user: 'c' }, 0),
        ]);

        expect(maxActive).toBe(1);
        expect(callAI).toHaveBeenCalledTimes(3);
        resetLocalAiQueueForTests();
    });
});
