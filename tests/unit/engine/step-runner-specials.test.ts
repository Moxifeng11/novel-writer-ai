import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const specialMocks = vi.hoisted(() => ({
    generateEmotionPlan: vi.fn(),
    generateSceneExpansion: vi.fn(),
    validateEmotionPlan: vi.fn(() => ({ valid: true, errors: [] as string[] })),
    validateSceneExpansion: vi.fn(() => ({ valid: true, errors: [] as string[], warnings: [] as string[] })),
}));

vi.mock('../../../engine/emotion-planner', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../engine/emotion-planner')>();
    return {
        ...actual,
        generateEmotionPlan: specialMocks.generateEmotionPlan,
        validateEmotionPlan: specialMocks.validateEmotionPlan,
    };
});

vi.mock('../../../engine/scene-expander', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../engine/scene-expander')>();
    return {
        ...actual,
        generateSceneExpansion: specialMocks.generateSceneExpansion,
        validateSceneExpansion: specialMocks.validateSceneExpansion,
    };
});

import { StepRunner } from '../../../engine/step-runner';
import { ENGINE_NAMES } from '../../../engine/engine-registry';

/**
 * 特例步骤（characterSoul / emotionPlan / sceneExpand）行为护栏。
 * 这三个分支不经过通用 callAI 流程，抽取到独立模块前后都必须保持：
 * - 保存成功才标记 stepCompleted 并回调 onStepComplete；
 * - 保存失败/缺少输入时给出可见错误且不标记完成；
 * - sceneExpand 必须带本步模型预算。
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

interface Harness {
    runner: StepRunner;
    ctx: Record<string, any>;
    callbacks: {
        showError: any;
        showSuccess: any;
        showNotice: any;
        hideProgress: any;
    };
    saveStepResult: any;
    profileLoad: any;
    injectForEmotionPlan: any;
    injectForSceneExpand: any;
}

function makeHarness(overrides?: {
    characterCores?: string;
    stepIndex?: number;
    saveResult?: boolean;
}): Harness {
    const callbacks = {
        showError: vi.fn(),
        showSuccess: vi.fn(),
        showNotice: vi.fn(),
        hideProgress: vi.fn(),
    };
    const profileLoad = vi.fn(async () => ({ fingerprint: { injectionStrength: 0 } }));
    const injectForEmotionPlan = vi.fn(async () => '情绪知识');
    const injectForSceneExpand = vi.fn(async () => '场景知识');

    const engines: Record<string, unknown> = {
        [ENGINE_NAMES.WRITING_PROFILE_MANAGER]: { load: profileLoad },
        [ENGINE_NAMES.KNOWLEDGE_INJECTOR]: { injectForEmotionPlan, injectForSceneExpand },
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
        manifest: { dir: '.obsidian/plugins/novel-writer-ai' },
        app: { workspace: { trigger: vi.fn() } },
    };

    const runner = new StepRunner({} as never, plugin as never, callbacks);
    const saveStepResult = vi
        .spyOn(runner, 'saveStepResult')
        .mockResolvedValue(overrides?.saveResult ?? true);

    const tabContent = makeTabContent();
    const ctx = {
        isLoading: false,
        currentStepIndex: overrides?.stepIndex ?? 3,
        project: '书甲',
        chapterNum: 2,
        chapDir: '书甲/03-大纲与章节/正文/第1卷',
        chapterName: '第2章',
        volume: '第1卷',
        vars: { characterCores: overrides?.characterCores ?? '主角核心：坚韧' },
        stepResults: {} as Record<string, string>,
        stepCompleted: new Set<string>(),
        tabContent,
        systemPromptEl: { value: 'system' },
        userPromptEl: { value: 'user' },
        temperatureSlider: { value: '1.4' },
        renderInContainer: vi.fn(async () => {}),
        setIsLoading: vi.fn(),
        onStepComplete: vi.fn(async () => {}),
    };

    return { runner, ctx, callbacks, saveStepResult, profileLoad, injectForEmotionPlan, injectForSceneExpand };
}

describe('StepRunner.executeCurrentStep — characterSoul 特例', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('缺少角色灵魂层数据：不写空文件、不标记完成，并提示去实体生成补全', async () => {
        const h = makeHarness({ characterCores: '   ', stepIndex: 3 });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(h.saveStepResult).not.toHaveBeenCalled();
        expect(h.ctx.stepCompleted.has('characterSoul')).toBe(false);
        expect(h.callbacks.showError).toHaveBeenCalledWith(
            expect.stringContaining('未找到角色灵魂层数据')
        );
        expect(h.ctx.renderInContainer).toHaveBeenCalled();
    });

    it('保存成功：写入 stepResults、标记完成并回调 onStepComplete', async () => {
        const h = makeHarness({ characterCores: '主角核心：坚韧', stepIndex: 3 });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(h.saveStepResult).toHaveBeenCalledWith(
            'characterSoul',
            '主角核心：坚韧',
            '书甲/03-大纲与章节/正文/第1卷',
            '第2章',
            '第1卷'
        );
        expect(h.ctx.stepCompleted.has('characterSoul')).toBe(true);
        expect(h.ctx.stepResults.characterSoul).toBe('主角核心：坚韧');
        expect(h.ctx.onStepComplete).toHaveBeenCalledWith('characterSoul', '主角核心：坚韧');
        expect(h.callbacks.showSuccess).toHaveBeenCalled();
    });

    it('保存失败：不标记完成，提示重试', async () => {
        const h = makeHarness({ characterCores: '主角核心：坚韧', stepIndex: 3, saveResult: false });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(h.ctx.stepCompleted.has('characterSoul')).toBe(false);
        expect(h.callbacks.showError).toHaveBeenCalledWith(expect.stringContaining('保存失败'));
        expect(h.callbacks.hideProgress).toHaveBeenCalled();
    });
});

describe('StepRunner.executeCurrentStep — emotionPlan 特例', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        specialMocks.generateEmotionPlan.mockResolvedValue('### scene1：开场\nemotion_start: 平静(3/10)');
    });

    it('生成后回填 stepResults / vars，保存成功才标记完成', async () => {
        const h = makeHarness({ stepIndex: 5 });

        await h.runner.executeCurrentStep(h.ctx as never);

        const expected = '### scene1：开场\nemotion_start: 平静(3/10)';
        expect(h.saveStepResult).toHaveBeenCalledWith(
            'emotionPlan',
            expected,
            '书甲/03-大纲与章节/正文/第1卷',
            '第2章',
            '第1卷'
        );
        expect(h.ctx.stepResults.emotionPlan).toBe(expected);
        expect(h.ctx.vars.emotionPlan).toBe(expected);
        expect(h.ctx.stepCompleted.has('emotionPlan')).toBe(true);
        expect(h.ctx.onStepComplete).toHaveBeenCalledWith('emotionPlan', expected);
    });

    it('知识注入失败时降级继续生成，不阻断步骤', async () => {
        const h = makeHarness({ stepIndex: 5 });
        h.profileLoad.mockRejectedValueOnce(new Error('画像损坏'));

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(specialMocks.generateEmotionPlan).toHaveBeenCalled();
        expect(h.ctx.stepCompleted.has('emotionPlan')).toBe(true);
    });

    it('校验不通过只提示，仍保存并标记完成', async () => {
        const h = makeHarness({ stepIndex: 5 });
        specialMocks.validateEmotionPlan.mockReturnValueOnce({ valid: false, errors: ['缺少场景'] });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(h.callbacks.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('情绪规划校验异常'),
            expect.anything()
        );
        expect(h.ctx.stepCompleted.has('emotionPlan')).toBe(true);
    });
});

describe('StepRunner.executeCurrentStep — sceneExpand 特例', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        specialMocks.generateSceneExpansion.mockResolvedValue('## scene1：开场\nobjective: 测试');
    });

    it('生成时按本步实际模型传入窗口预算（B6 护栏）', async () => {
        const h = makeHarness({ stepIndex: 6 });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(specialMocks.generateSceneExpansion).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(Object),
            'flash-model',
            undefined,
            { maxContext: 8000, maxOutput: 2000 },
            undefined,
            expect.objectContaining({ maxTokens: 2000 }),
        );
    });

    it('保存成功：回填 stepResults / vars 并标记完成', async () => {
        const h = makeHarness({ stepIndex: 6 });

        await h.runner.executeCurrentStep(h.ctx as never);

        const expected = '## scene1：开场\nobjective: 测试';
        expect(h.ctx.stepResults.sceneExpand).toBe(expected);
        expect(h.ctx.vars.sceneExpansion).toBe(expected);
        expect(h.ctx.stepCompleted.has('sceneExpand')).toBe(true);
        expect(h.ctx.onStepComplete).toHaveBeenCalledWith('sceneExpand', expected);
    });

    it('保存失败：不标记完成并提示重试', async () => {
        const h = makeHarness({ stepIndex: 6, saveResult: false });

        await h.runner.executeCurrentStep(h.ctx as never);

        expect(h.ctx.stepCompleted.has('sceneExpand')).toBe(false);
        expect(h.callbacks.showError).toHaveBeenCalledWith(expect.stringContaining('保存失败'));
    });
});
