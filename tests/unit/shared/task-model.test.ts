import { describe, expect, it, vi } from 'vitest';
import {
    resolveTaskForStep,
    resolveTaskModel,
    resolveTaskModelConfig,
    type TaskModelSettings,
} from '../../../shared/task-model';

const settings: TaskModelSettings = {
    defaultModel: 'default-model',
    flashModel: 'flash-model',
    proModel: 'pro-model',
    deconstructionEngine: { llmModel: 'local-llm' },
    taskBudgets: {
        analysis: { maxOutputTokens: 4096 },
    },
};

function limits(model: string): { maxContext: number; maxOutput: number } {
    if (model === 'flash-model') return { maxContext: 8192, maxOutput: 4096 };
    if (model === 'local-llm') return { maxContext: 32768, maxOutput: 8192 };
    return { maxContext: 1_000_000, maxOutput: 65_536 };
}

describe('task-model — 任务级模型/预算', () => {
    it('规划与正文使用各自模型的预算，不再共享全局值', () => {
        const planning = resolveTaskModelConfig(settings, 'planning', limits);
        const body = resolveTaskModelConfig(settings, 'body', limits);

        expect(planning.model).toBe('flash-model');
        expect(planning.maxOutput).toBe(4096);
        expect(body.model).toBe('pro-model');
        expect(body.maxOutput).toBe(65_536);
    });

    it('任务覆盖优先于默认模型映射', () => {
        const analysis = resolveTaskModelConfig(settings, 'analysis', limits);
        expect(analysis.model).toBe('flash-model');
        expect(analysis.maxOutput).toBe(4096);
    });

    it('拆解任务使用 deconstructionEngine.llmModel', () => {
        expect(resolveTaskModel(settings, 'deconstruction')).toBe('local-llm');
        const cfg = resolveTaskModelConfig(settings, 'deconstruction', limits);
        expect(cfg.maxContext).toBe(32768);
        expect(cfg.maxOutput).toBe(8192);
    });

    it('maxInput 为输出预留余量，且不会超过上下文减输出', () => {
        const cfg = resolveTaskModelConfig(settings, 'planning', limits);
        expect(cfg.maxInput).toBeGreaterThan(0);
        expect(cfg.maxInput + cfg.maxOutput).toBeLessThanOrEqual(cfg.maxContext);
    });

    it('步骤 key 映射到正确任务', () => {
        expect(resolveTaskForStep('infoPlan', 'flash')).toBe('planning');
        expect(resolveTaskForStep('outline', 'flash')).toBe('planning');
        expect(resolveTaskForStep('bodyGeneration', 'pro')).toBe('body');
        expect(resolveTaskForStep('fix', 'pro')).toBe('body');
        expect(resolveTaskForStep('qualityControl', 'pro')).toBe('quality');
        expect(resolveTaskForStep('analysisReport', 'flash')).toBe('analysis');
    });

    it('任务模型跨供应商时，按模型所属 provider 解析 endpoint/apiKey', () => {
        const withProvider: TaskModelSettings = {
            ...settings,
            taskBudgets: { body: { model: 'pro-model' } },
            customProviders: [{
                id: 'local-x',
                endpoint: 'http://192.168.1.8:11434/v1/chat/completions',
                models: ['pro-model'],
                sourceType: 'local',
            }],
        };
        const spy = vi.fn((_model: string, _endpoint?: string) => ({ maxContext: 32768, maxOutput: 8192 }));

        const cfg = resolveTaskModelConfig(withProvider, 'body', spy);

        expect(spy).toHaveBeenCalledWith('pro-model', 'http://192.168.1.8:11434/v1/chat/completions');
        expect(cfg.endpoint).toBe('http://192.168.1.8:11434/v1/chat/completions');
        expect(cfg.providerId).toBe('local-x');
        expect(cfg.apiKey).toBe('ollama');
        expect(cfg.sourceType).toBe('local');
    });

    it('resolveLimits 抛错时回退到保守预算', () => {
        const cfg = resolveTaskModelConfig(settings, 'planning', () => {
            throw new Error('probe failed');
        });
        expect(cfg.maxContext).toBe(32768);
        expect(cfg.maxOutput).toBe(8192);
    });
});
