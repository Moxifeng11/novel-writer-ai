import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StepRunner } from '../../../engine/step-runner';

/**
 * 批量顺序执行（executeStepsSequential）行为护栏。
 * 抽取到 engine/step-sequential.ts 前后必须保持：
 * - 已完成步骤直接计入 successful，不重复执行；
 * - 未知 stepKey 静默跳过；
 * - 按传入顺序执行，回调顺序与结果一致；
 * - 某步抛错即中断后续步骤，并回报 failedAt；
 * - 无论成功失败，结束后恢复 baseCtx.currentStepIndex。
 */

function stubDocument() {
    vi.stubGlobal('document', {
        createElement: (tag: string) => ({
            tag,
            value: '',
            type: '',
        }),
    });
}

function makeRunner() {
    const plugin = {
        aiEngine: {},
        settings: {
            proModel: 'pro-model',
            flashModel: 'flash-model',
            defaultModel: 'default-model',
            maxContext: 128000,
            maxOutput: 4096,
        },
        engineRegistry: { get: () => ({}) },
        app: { workspace: { trigger: vi.fn() } },
        manifest: { dir: '.obsidian/plugins/novel-writer-ai' },
    };
    return new StepRunner({} as never, plugin as never, {});
}

function makeCtx(overrides?: {
    stepCompleted?: Set<string>;
    stepResults?: Record<string, string>;
    currentStepIndex?: number;
}) {
    return {
        stepResults: overrides?.stepResults ?? ({} as Record<string, string>),
        stepCompleted: overrides?.stepCompleted ?? new Set<string>(),
        currentStepIndex: overrides?.currentStepIndex ?? 2,
        setCurrentStepIndex: vi.fn(),
        tabContent: {} as never,
        systemPromptEl: { value: '' } as never,
        userPromptEl: { value: '' } as never,
        temperatureSlider: { value: '1.4' } as never,
        chapDir: '书甲/03-大纲与章节/正文/第1卷',
        chapterName: '第2章',
        volume: '第1卷',
        chapterNum: 2,
        project: '书甲',
        vars: {},
        isLoading: false,
        buildTemplateVars: async () => ({}),
        saveStepResult: async () => {},
        renderInContainer: async () => {},
        setIsLoading: () => {},
        refreshWorkspace: () => {},
    };
}

describe('StepRunner.executeStepsSequential — 顺序编排', () => {
    beforeEach(() => {
        stubDocument();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('已完成步骤计入成功但不重复执行；未知步骤静默跳过', async () => {
        const runner = makeRunner();
        const execute = vi.spyOn(runner, 'executeCurrentStep').mockResolvedValue(undefined);
        const ctx = makeCtx({ stepCompleted: new Set(['infoPlan']) });

        const result = await runner.executeStepsSequential(['infoPlan', 'notAStep', 'plotDistill'], ctx as never);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][0].currentStepIndex).toBe(2);
        expect(result.successful).toEqual(['infoPlan', 'plotDistill']);
        expect(result.failed).toBeNull();
        expect(result.failedAt).toBe(-1);
    });

    it('按传入顺序执行，onStepStart / onStepComplete 与结果内容对应', async () => {
        const runner = makeRunner();
        const ctx = makeCtx({ stepResults: { infoPlan: '信息规划', plotDistill: '情节蒸馏' } });
        const order: string[] = [];
        vi.spyOn(runner, 'executeCurrentStep').mockImplementation(async (stepCtx) => {
            order.push(`run:${stepCtx.currentStepIndex}`);
        });
        const onStepStart = vi.fn((key: string) => order.push(`start:${key}`));
        const onStepComplete = vi.fn();

        const result = await runner.executeStepsSequential(
            ['plotDistill', 'infoPlan'],
            ctx as never,
            { onStepStart, onStepComplete }
        );

        expect(order).toEqual(['start:plotDistill', 'run:2', 'start:infoPlan', 'run:1']);
        expect(onStepComplete).toHaveBeenNthCalledWith(1, 'plotDistill', '情节蒸馏');
        expect(onStepComplete).toHaveBeenNthCalledWith(2, 'infoPlan', '信息规划');
        expect(result.successful).toEqual(['plotDistill', 'infoPlan']);
    });

    it('某步抛错：中断后续步骤，回报 failed / failedAt 并调用 onStepError', async () => {
        const runner = makeRunner();
        const ctx = makeCtx();
        vi.spyOn(runner, 'executeCurrentStep').mockImplementation(async (stepCtx) => {
            if (stepCtx.currentStepIndex === 2) throw new Error('第二步失败');
        });
        const onStepError = vi.fn();
        const onStepComplete = vi.fn();

        const result = await runner.executeStepsSequential(
            ['infoPlan', 'plotDistill', 'outline'],
            ctx as never,
            { onStepError, onStepComplete }
        );

        expect(result.successful).toEqual(['infoPlan']);
        expect(result.failed).toBe('plotDistill');
        expect(result.failedAt).toBe(1);
        expect(onStepError).toHaveBeenCalledWith('plotDistill', '第二步失败');
        expect(onStepComplete).toHaveBeenCalledTimes(1);
    });

    it('结束后恢复 baseCtx.currentStepIndex，即使步骤内部推进了索引', async () => {
        const runner = makeRunner();
        const ctx = makeCtx({ currentStepIndex: 2 });
        vi.spyOn(runner, 'executeCurrentStep').mockImplementation(async (stepCtx) => {
            stepCtx.currentStepIndex = 7;
        });

        await runner.executeStepsSequential(['infoPlan', 'plotDistill'], ctx as never);

        expect(ctx.currentStepIndex).toBe(2);
    });

    it('同一个批次内所有步骤共享注入的输入元素', async () => {
        const runner = makeRunner();
        const ctx = makeCtx();
        const seen: unknown[] = [];
        vi.spyOn(runner, 'executeCurrentStep').mockImplementation(async (stepCtx) => {
            seen.push(stepCtx.systemPromptEl, stepCtx.userPromptEl, stepCtx.temperatureSlider);
        });

        await runner.executeStepsSequential(['infoPlan', 'plotDistill'], ctx as never);

        expect(seen[0]).toBe(seen[3]);
        expect(seen[1]).toBe(seen[4]);
        expect(seen[2]).toBe(seen[5]);
    });
});
