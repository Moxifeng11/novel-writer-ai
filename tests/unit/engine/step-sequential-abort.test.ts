import { describe, expect, it, vi } from 'vitest';
import { executeStepsSequential } from '../../../engine/step-sequential';

describe('executeStepsSequential — 取消后不再启动下一步', () => {
    it('signal 已中止时直接停止，不执行任何步骤', async () => {
        const executeStep = vi.fn();
        const controller = { signal: { aborted: true } } as AbortController;
        const ctx = {
            stepCompleted: new Set<string>(),
            stepResults: {},
            currentStepIndex: 0,
            getAbortController: () => controller,
        } as never;

        const result = await executeStepsSequential(
            {
                executeStep,
                createStepInputs: () => ({
                    systemPromptEl: {} as HTMLTextAreaElement,
                    userPromptEl: {} as HTMLTextAreaElement,
                    temperatureSlider: {} as HTMLInputElement,
                }),
            },
            ['infoPlan', 'plotDistill', 'outline'],
            ctx,
        );

        expect(executeStep).not.toHaveBeenCalled();
        expect(result.failed).toBe('infoPlan');
        expect(result.successful).toHaveLength(0);
    });
});
