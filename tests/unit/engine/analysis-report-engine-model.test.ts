import { describe, expect, it, vi } from 'vitest';
import { AnalysisReportEngine } from '../../../engine/analysis-report-engine';

describe('AnalysisReportEngine — 结构化提取模型解析', () => {
    it('使用 settings.flashModel 与模型上限，不再传字面量 flash', async () => {
        const callAI = vi.fn().mockResolvedValue({ content: '[]', finishReason: 'stop' });
        const plugin = {
            settings: {
                defaultModel: 'default-model',
                flashModel: 'flash-real',
                proModel: 'pro-real',
            },
            resolveModelLimits: vi.fn(() => ({ maxContext: 8192, maxOutput: 4096 })),
        };
        const engine = new AnalysisReportEngine(
            {} as never,
            { getPlugin: () => plugin, callAI } as never,
            {} as never,
        );

        await (engine as unknown as {
            callAnalysisExtraction: (prompt: string, temperature: number) => Promise<unknown>;
        }).callAnalysisExtraction('请提取', 0.7);

        expect(callAI).toHaveBeenCalledWith(
            '',
            '请提取',
            'flash-real',
            0.7,
            4096,
            expect.objectContaining({ thinkingMode: 'auto', thinkingBudget: 0 }),
        );
        expect(callAI.mock.calls[0][2]).not.toBe('flash');
    });

    it('结构化提取输出上限封顶 8192，避免异常大预算', async () => {
        const callAI = vi.fn().mockResolvedValue({ content: '[]', finishReason: 'stop' });
        const plugin = {
            settings: {
                defaultModel: 'default-model',
                flashModel: 'flash-real',
                proModel: 'pro-real',
            },
            resolveModelLimits: vi.fn(() => ({ maxContext: 1_000_000, maxOutput: 65_536 })),
        };
        const engine = new AnalysisReportEngine(
            {} as never,
            { getPlugin: () => plugin, callAI } as never,
            {} as never,
        );

        await (engine as unknown as {
            callAnalysisExtraction: (prompt: string, temperature: number) => Promise<unknown>;
        }).callAnalysisExtraction('请提取', 0.6);

        expect(callAI).toHaveBeenCalledWith(
            '',
            '请提取',
            'flash-real',
            0.6,
            8192,
            expect.objectContaining({ thinkingMode: 'auto', thinkingBudget: 0 }),
        );
    });
});
