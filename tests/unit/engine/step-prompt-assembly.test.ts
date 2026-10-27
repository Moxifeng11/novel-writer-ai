import { describe, it, expect, vi, afterEach } from 'vitest';
import { assembleStepPrompt, type StepPromptAssemblyHost } from '../../../engine/step-prompt-assembly';
import type { StepRunCtx } from '../../../engine/step-definitions';

/**
 * step-prompt-assembly 模块级护栏。
 *
 * 上一轮（Rev 173）只经 StepRunner 间接覆盖，这里直接锁定模块契约：
 * - 非 outline / bodyGeneration 步骤不读取知识注入，预算充足时 user prompt 原样返回；
 * - outline 步骤把知识注入拼在 user prompt 之后（作为可丢弃尾部）；
 * - bodyGeneration 步骤注入文笔指纹（Rev 176），不再误调大纲注入；
 * - 超预算时先丢注入、再头尾截断主体，并记录两条降级日志。
 */

/** 装配模块只把 ctx 透传给宿主，不读取字段 */
function makeCtx(): StepRunCtx {
    return {} as StepRunCtx;
}

function makeHost(overrides: Partial<StepPromptAssemblyHost> = {}): StepPromptAssemblyHost {
    return {
        loadOutlineKnowledge: vi.fn(async () => ''),
        loadBodyKnowledge: vi.fn(async () => ''),
        resolveStepBudgetLimits: vi.fn(() => ({ maxContext: 128000, maxOutput: 4096 })),
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('assembleStepPrompt', () => {
    it('非 outline 步骤不读取知识注入，预算充足时原样返回 user prompt', async () => {
        const host = makeHost();

        const result = await assembleStepPrompt(
            host,
            makeCtx(),
            'infoPlan',
            '系统约束',
            '用户任务正文',
            'flash-model',
        );

        expect(host.loadOutlineKnowledge).not.toHaveBeenCalled();
        expect(host.loadBodyKnowledge).not.toHaveBeenCalled();
        expect(host.resolveStepBudgetLimits).toHaveBeenCalledWith('flash-model');
        expect(result.effectiveUserPrompt).toBe('用户任务正文');
        expect(result.truncated).toBe(false);
        expect(result.droppedExtra).toBe(false);
        expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it('outline 步骤把知识注入作为额外尾部拼在 user prompt 之后', async () => {
        const injection = '【设定库】主角惯用左手';
        const host = makeHost({ loadOutlineKnowledge: vi.fn(async () => injection) });

        const result = await assembleStepPrompt(
            host,
            makeCtx(),
            'outline',
            '系统约束',
            '用户任务正文',
            'flash-model',
        );

        expect(host.loadOutlineKnowledge).toHaveBeenCalledTimes(1);
        expect(host.loadBodyKnowledge).not.toHaveBeenCalled();
        expect(result.effectiveUserPrompt).toBe(`用户任务正文\n\n${injection}`);
        expect(result.droppedExtra).toBe(false);
        expect(result.truncated).toBe(false);
    });

    it('bodyGeneration 步骤注入文笔指纹，不误调大纲注入', async () => {
        const injection = '【风格要求】短句为主，对话独立成段';
        const host = makeHost({ loadBodyKnowledge: vi.fn(async () => injection) });

        const result = await assembleStepPrompt(
            host,
            makeCtx(),
            'bodyGeneration',
            '系统约束',
            '用户任务正文',
            'flash-model',
        );

        expect(host.loadBodyKnowledge).toHaveBeenCalledTimes(1);
        expect(host.loadOutlineKnowledge).not.toHaveBeenCalled();
        expect(result.effectiveUserPrompt).toBe(`用户任务正文\n\n${injection}`);
        expect(result.droppedExtra).toBe(false);
    });

    it('bodyGeneration 的样章硬约束进 system，不被 extraTail 预算裁掉', async () => {
        const host = makeHost({
            loadBodyKnowledgeParts: vi.fn(async () => ({
                extra: '【知识注入】可裁剪',
                system: '【参考片段（只模仿句法/质感）】\n1. 他推开门，风灌进来。',
            })),
        });

        const result = await assembleStepPrompt(
            host,
            makeCtx(),
            'bodyGeneration',
            '系统约束',
            '用户任务正文',
            'flash-model',
        );

        expect(result.effectiveSystemPrompt).toContain('【参考片段');
        expect(result.effectiveSystemPrompt).toContain('系统约束');
        expect(result.effectiveUserPrompt).toContain('【知识注入】可裁剪');
        expect(host.loadBodyKnowledge).not.toHaveBeenCalled();
    });

    it('超预算时先丢知识注入，再头尾截断主体，并记录两条降级日志', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const userPrompt = '正'.repeat(2000);
        const injection = '【设定库注入】' + '设'.repeat(1000);
        // maxContext 1200 - maxOutput 100 - 安全余量 500 = 可用 600 tokens，主体本身就超
        const host = makeHost({
            loadOutlineKnowledge: vi.fn(async () => injection),
            resolveStepBudgetLimits: vi.fn(() => ({ maxContext: 1200, maxOutput: 100 })),
        });

        const result = await assembleStepPrompt(
            host,
            makeCtx(),
            'outline',
            '系统约束',
            userPrompt,
            'flash-model',
        );

        expect(result.droppedExtra).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.effectiveUserPrompt).not.toContain(injection);
        expect(result.effectiveUserPrompt).toContain('上下文过长');
        expect(result.effectiveUserPrompt.length).toBeLessThan(userPrompt.length);
        expect(result.estimatedTokens).toBeGreaterThan(0);
        // 丢注入 + 截断主体各一条 warn
        expect(warn).toHaveBeenCalledTimes(2);
        const logs = warn.mock.calls.map((call) => String(call[1] ?? ''));
        expect(logs.some((line) => line.includes('已跳过知识注入'))).toBe(true);
        expect(logs.some((line) => line.includes('中间资料截断'))).toBe(true);
    });
});
