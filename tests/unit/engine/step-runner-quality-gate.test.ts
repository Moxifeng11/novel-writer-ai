import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('obsidian', () => ({}));
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StepRunner } from '../../../engine/step-runner';
import { QualityGate } from '../../../engine/quality-gate';
import { ENGINE_NAMES } from '../../../engine/engine-registry';

/**
 * 正文保存后的质量门禁接线（审计维度④ C-6）。
 *
 * 旧测试只到「保存成功/内容不完整」，`step-runner.ts` 里 new QualityGate() 的分支
 * 从未执行；这里锁住：
 * - 正文 verdict=complete 时，门禁恰好跑一次，快照来自当前章变量；
 * - 门禁通过/未通过都只发事件与诊断，不阻断正文完成；
 * - 门禁抛错被吞掉且不阻断保存/完成（现状契约）。
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
        showProgress: vi.fn(),
        hideProgress: vi.fn(),
        onExecutionEvent: vi.fn(),
        onStepFailure: vi.fn(),
        onDiagnostic: vi.fn(),
    };
    const engines: Record<string, unknown> = {
        [ENGINE_NAMES.WRITING_PROFILE_MANAGER]: {
            load: vi.fn(async () => ({ fingerprint: { injectionStrength: 0 } })),
        },
        [ENGINE_NAMES.KNOWLEDGE_INJECTOR]: {
            injectForOutline: vi.fn(async () => ''),
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

function makeCtx() {
    const tabContent = makeTabContent();
    return {
        ctx: {
            isLoading: false,
            currentStepIndex: 7,
            project: '书甲',
            chapterNum: 2,
            chapDir: '书甲/03-大纲与章节/正文/第1卷',
            chapterName: '第2章',
            volume: '第1卷',
            vars: {
                outlineContent: '本章大纲',
                protagonistName: '林玄',
                distilledContent: '- 节点1：林玄在演武台被王虎挑衅并反击，冲突升级',
                allChars: '- 林玄：当前情绪 压抑｜伤势 肩头青紫｜当前目标 通过考核',
                timelineEvents: '| 清晨 | 演武台 | 考核开始 |',
                sceneCardDigest: '地点：演武台',
                prevChapEnding: '他抬头看向山门。',
                baseWords: '3000',
            },
            stepResults: { bodyGeneration: '' } as Record<string, string>,
            stepCompleted: new Set<string>(),
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

/** 通过 validateBodyGeneration：≥2100 字、标题、中文对话、句号收尾 */
function validBody(): string {
    return `# 第2章 风起\n${'他抬头看向远处。'.repeat(400)}\n“走吧。”他说。\n`;
}

describe('StepRunner — 正文保存后的质量门禁', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('verdict=complete：门禁跑一次，快照来自当前章变量，通过后标记完成', async () => {
        const { runner, callbacks } = makeRunner();
        const body = validBody();
        vi.spyOn(runner as never as { callAIStreamWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIStreamWithRetry')
            .mockResolvedValue({ content: body, finishReason: 'stop' });
        const gateSpy = vi.spyOn(QualityGate.prototype, 'run').mockResolvedValue({
            passed: true,
            summary: '质量验收通过',
        } as never);
        const { ctx } = makeCtx();

        await runner.executeCurrentStep(ctx as never);

        expect(gateSpy).toHaveBeenCalledTimes(1);
        const [gateBody, snapshot] = gateSpy.mock.calls[0];
        expect(gateBody).toBe(body);
        expect(snapshot).toMatchObject({
            chapterNumber: 2,
            povCharacter: '林玄',
            timeline: { location: '演武台' },
        });
        expect(snapshot.characterStates[0]).toMatchObject({
            name: '林玄',
            emotion: '压抑',
            injury: '肩头青紫',
            goal: '通过考核',
        });
        expect(callbacks.onExecutionEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'step', level: 'success', stepKey: 'bodyGeneration' }),
        );
        expect(callbacks.onDiagnostic).toHaveBeenCalledWith(
            expect.objectContaining({ level: 'info', stepKey: 'bodyGeneration' }),
        );
        expect(ctx.stepCompleted.has('bodyGeneration')).toBe(true);
    });

    it('门禁未通过：只发 warning，不阻断正文完成', async () => {
        const { runner, callbacks } = makeRunner();
        vi.spyOn(runner as never as { callAIStreamWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIStreamWithRetry')
            .mockResolvedValue({ content: validBody(), finishReason: 'stop' });
        vi.spyOn(QualityGate.prototype, 'run').mockResolvedValue({
            passed: false,
            summary: '缺少必要节点',
        } as never);
        const { ctx } = makeCtx();

        await runner.executeCurrentStep(ctx as never);

        expect(callbacks.onExecutionEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'step', level: 'warning', stepKey: 'bodyGeneration' }),
        );
        expect(callbacks.showError).not.toHaveBeenCalled();
        expect(ctx.stepCompleted.has('bodyGeneration')).toBe(true);
    });

    it('门禁抛错：异常被吞掉，正文仍保存并完成', async () => {
        const { runner } = makeRunner();
        const body = validBody();
        const saveSpy = vi.spyOn(runner as never as { saveStepResult: (...args: unknown[]) => Promise<boolean> }, 'saveStepResult')
            .mockResolvedValue(true);
        vi.spyOn(runner as never as { callAIStreamWithRetry: (...args: unknown[]) => Promise<unknown> }, 'callAIStreamWithRetry')
            .mockResolvedValue({ content: body, finishReason: 'stop' });
        vi.spyOn(QualityGate.prototype, 'run').mockRejectedValue(new Error('gate exploded'));
        const { ctx } = makeCtx();

        await expect(runner.executeCurrentStep(ctx as never)).resolves.toBeUndefined();

        expect(saveSpy).toHaveBeenCalled();
        expect(ctx.stepCompleted.has('bodyGeneration')).toBe(true);
    });
});
