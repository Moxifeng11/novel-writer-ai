import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StepRunner } from '../../../engine/step-runner';
import { ENGINE_NAMES } from '../../../engine/engine-registry';

/**
 * executeCurrentStep 通用步骤的四类分支行为护栏。
 * 抽取 prompt 装配前后必须保持：
 * - preValidation 失败：提示后直接返回，不调用 AI、不落盘；
 * - postValidation 失败：只提示，不阻断保存（现状）；
 * - abort：提示已取消，且不落盘、不标记完成；
 * - finishReason=length：给出「结果可能不完整」提示，但仍保存。
 */

interface FakeButton {
    textContent: string;
    disabled: boolean;
    classList: { add: () => void; remove: () => void };
}

function makeTabContent() {
    const button: FakeButton = {
        textContent: '发送',
        disabled: false,
        classList: { add: () => {}, remove: () => {} },
    };
    return { querySelectorAll: vi.fn(() => [button]), button };
}

function makeRunner() {
    const callbacks = {
        showError: vi.fn(),
        showSuccess: vi.fn(),
        showNotice: vi.fn(),
        hideProgress: vi.fn(),
        showProgress: vi.fn(),
    };
    const engines: Record<string, unknown> = {
        [ENGINE_NAMES.WRITING_PROFILE_MANAGER]: {
            load: vi.fn(async () => ({ fingerprint: { injectionStrength: 0 } })),
        },
        [ENGINE_NAMES.KNOWLEDGE_INJECTOR]: {
            injectForOutline: vi.fn(async () => '大纲知识注入'),
        },
        [ENGINE_NAMES.SETTLEMENT_ENGINE]: {},
    };
    const plugin = {
        aiEngine: {},
        settings: {
            proModel: 'pro-model',
            flashModel: 'flash-model',
            defaultModel: 'default-model',
            maxContext: 128000,
            maxOutput: 4096,
        },
        resolveModelLimits: vi.fn(() => ({ maxContext: 8000, maxOutput: 2000 })),
        engineRegistry: { get: (name: string) => engines[name] },
        app: { workspace: { trigger: vi.fn() } },
        manifest: { dir: '.obsidian/plugins/novel-writer-ai' },
    };
    const runner = new StepRunner({} as never, plugin as never, callbacks);
    const saveStepResult = vi.spyOn(runner, 'saveStepResult').mockResolvedValue(true);
    return { runner, callbacks, saveStepResult };
}

function makeCtx(stepIndex: number, overrides?: {
    stepCompleted?: Set<string>;
    stepResults?: Record<string, string>;
}) {
    const tabContent = makeTabContent();
    return {
        ctx: {
            isLoading: false,
            currentStepIndex: stepIndex,
            project: '书甲',
            chapterNum: 2,
            chapDir: '书甲/03-大纲与章节/正文/第1卷',
            chapterName: '第2章',
            volume: '第1卷',
            vars: { outlineContent: '本章大纲' },
            stepResults: overrides?.stepResults ?? ({} as Record<string, string>),
            stepCompleted: overrides?.stepCompleted ?? new Set<string>(),
            tabContent,
            systemPromptEl: { value: 'system' },
            userPromptEl: { value: 'user' },
            temperatureSlider: { value: '1.4' },
            renderInContainer: vi.fn(async () => {}),
            setIsLoading: vi.fn(),
            setCurrentStepIndex: vi.fn(),
            onStepComplete: vi.fn(async () => {}),
            getAbortController: () => null,
            buildTemplateVars: async () => ({}),
            saveStepResult: async () => {},
            refreshWorkspace: () => {},
        },
        tabContent,
    };
}

describe('executeCurrentStep — preValidation 失败', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('analysisReport 缺正文前置条件：提示后返回，不调用 AI、不落盘', async () => {
        const { runner, callbacks, saveStepResult } = makeRunner();
        const callAI = vi.spyOn(runner as never as { callAIWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIWithRetry')
            .mockResolvedValue({ content: '不应该出现', finishReason: 'stop' });
        const { ctx, tabContent } = makeCtx(9);

        await runner.executeCurrentStep(ctx as never);

        expect(callAI).not.toHaveBeenCalled();
        expect(callbacks.showError).toHaveBeenCalledWith('请先执行「正文生成」步骤');
        expect(saveStepResult).not.toHaveBeenCalled();
        expect(ctx.stepCompleted.has('analysisReport')).toBe(false);
        expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
        expect((tabContent.button as FakeButton).disabled).toBe(false);
    });
});

describe('executeCurrentStep — postValidation 失败', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('正文生成字数不足：提示错误、仍保存，但不标记完成（Rev 185）', async () => {
        const { runner, callbacks, saveStepResult } = makeRunner();
        vi.spyOn(runner as never as { callAIStreamWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIStreamWithRetry')
            .mockResolvedValue({ content: '太短', finishReason: 'stop' });
        const { ctx } = makeCtx(7);

        await runner.executeCurrentStep(ctx as never);

        expect(callbacks.showError).toHaveBeenCalledWith(expect.stringContaining('字数不足'));
        expect(saveStepResult).toHaveBeenCalledWith(
            'bodyGeneration',
            '太短',
            '书甲/03-大纲与章节/正文/第1卷',
            '第2章',
            '第1卷'
        );
        // 保存成功 ≠ 完成：结构校验未达标时不得标完成，否则导航会显示 ✅
        expect(ctx.stepCompleted.has('bodyGeneration')).toBe(false);
        expect(callbacks.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('已保存但内容不完整'),
            expect.anything()
        );
    });
});

describe('executeCurrentStep — abort 不落盘', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finishReason=aborted：提示已取消，不写结果、不标记完成', async () => {
        const { runner, callbacks, saveStepResult } = makeRunner();
        vi.spyOn(runner as never as { callAIWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIWithRetry')
            .mockResolvedValue({ content: '半截', error: '已取消', finishReason: 'aborted' });
        const { ctx } = makeCtx(4);

        await runner.executeCurrentStep(ctx as never);

        expect(callbacks.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('已取消，结果未保存'),
            expect.anything()
        );
        expect(saveStepResult).not.toHaveBeenCalled();
        expect(ctx.stepCompleted.has('outline')).toBe(false);
        expect(ctx.stepResults.outline).toBeUndefined();
        expect(callbacks.showSuccess).not.toHaveBeenCalled();
    });
});

describe('executeCurrentStep — 截断提示', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finishReason=length：提示结果可能不完整，仍保存但不标完成（Rev 185）', async () => {
        const { runner, callbacks, saveStepResult } = makeRunner();
        vi.spyOn(runner as never as { callAIWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIWithRetry')
            .mockResolvedValue({ content: '被截断的大纲', finishReason: 'length' });
        const { ctx } = makeCtx(4);

        await runner.executeCurrentStep(ctx as never);

        expect(callbacks.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('结果可能不完整'),
            expect.anything()
        );
        expect(saveStepResult).toHaveBeenCalledWith(
            'outline',
            '被截断的大纲',
            '书甲/03-大纲与章节/正文/第1卷',
            '第2章',
            '第1卷'
        );
        expect(ctx.stepCompleted.has('outline')).toBe(false);
    });
});
