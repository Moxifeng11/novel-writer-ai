import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {};
        app = {};
    },
}));

import { EndingTractionEngine } from '../../../engine/ending-traction-engine';

function makeEngine(callAI: (...args: unknown[]) => Promise<unknown>, settings: Record<string, unknown> = { flashModel: 'deepseek-flash' }) {
    const engine = new EndingTractionEngine({
        app: {} as never,
        aiEngine: { callAI } as never,
        plugin: { settings } as never,
    });
    // parseThreadsWithAI 是私有实现细节，这里直接验证「模型输出 → 情节线」的解析契约
    return engine as unknown as { parseThreadsWithAI: (content: string) => Promise<Array<{ name: string; type: string }>> };
}

describe('EndingTractionEngine.parseThreadsWithAI', () => {
    it('思考型模型带 <think> 前缀与尾部解释时仍能解析出情节线', async () => {
        const callAI = vi.fn(async () => ({
            content: '<think>\n先整理主线。\n</think>\n[{"name":"解环求生","type":"main","startVolume":1,"targetVolume":3}]\n\n以上为提取结果。',
        }));
        const engine = makeEngine(callAI);

        const threads = await engine.parseThreadsWithAI('分卷大纲内容');

        expect(threads).toHaveLength(1);
        expect(threads[0].name).toBe('解环求生');
        expect(threads[0].type).toBe('main');
    });

    it('```json 围栏包裹的数组也能解析', async () => {
        const callAI = vi.fn(async () => ({
            content: '```json\n[{"name":"副线 A","type":"subplot"}]\n```',
        }));
        const engine = makeEngine(callAI);

        const threads = await engine.parseThreadsWithAI('分卷大纲内容');

        expect(threads.map((t) => t.name)).toEqual(['副线 A']);
    });

    it('模型未配置时不回退非法模型名 flash，直接返回空数组', async () => {
        const callAI = vi.fn(async () => ({ content: '[]' }));
        const engine = makeEngine(callAI, { flashModel: '', defaultModel: '' });

        const threads = await engine.parseThreadsWithAI('分卷大纲内容');

        expect(threads).toEqual([]);
        expect(callAI).not.toHaveBeenCalled();
    });
});
