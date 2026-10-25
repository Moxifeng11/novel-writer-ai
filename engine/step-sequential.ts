/**
 * step-sequential.ts — 批量顺序执行
 *
 * 从 step-runner.ts 拆分而来：按传入的步骤 key 顺序执行，跳过已完成与未知步骤，
 * 某步失败即中断。输入元素由宿主注入，本模块不直接调用 document。
 */

import { ALL_FULL_STEPS, type StepRunCtx } from './step-definitions';

/** 批量执行时复用的输入元素（正文/规划 prompt 与温度由各步骤自行读取） */
export interface SequentialStepInputs {
    systemPromptEl: HTMLTextAreaElement;
    userPromptEl: HTMLTextAreaElement;
    temperatureSlider: HTMLInputElement;
}

export interface SequentialStepHost {
    executeStep(ctx: StepRunCtx): Promise<void>;
    createStepInputs(): SequentialStepInputs;
}

export interface SequentialStepOptions {
    onStepStart?: (stepKey: string) => void;
    onStepComplete?: (stepKey: string, content: string) => void;
    onStepError?: (stepKey: string, error: string) => void;
}

export async function executeStepsSequential(
    host: SequentialStepHost,
    stepKeys: string[],
    baseCtx: StepRunCtx,
    options?: SequentialStepOptions
): Promise<{ successful: string[]; failed: string | null; failedAt: number }> {
    const successful: string[] = [];
    let failed: string | null = null;
    let failedAt = -1;

    const { systemPromptEl, userPromptEl, temperatureSlider } = host.createStepInputs();

    const originalIndex = baseCtx.currentStepIndex;

    for (let i = 0; i < stepKeys.length; i++) {
        const stepKey = stepKeys[i];
        if (baseCtx.stepCompleted.has(stepKey)) {
            successful.push(stepKey);
            continue;
        }

        const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
        if (!step) continue;

        options?.onStepStart?.(stepKey);

        const stepCtx: StepRunCtx = {
            ...baseCtx,
            currentStepIndex: step.index,
            setCurrentStepIndex: (v: number) => { stepCtx.currentStepIndex = v; },
            systemPromptEl,
            userPromptEl,
            temperatureSlider,
            isLoading: false,
            setIsLoading: (v: boolean) => { stepCtx.isLoading = v; },
        };

        try {
            await host.executeStep(stepCtx);
            const content = baseCtx.stepResults[stepKey] || '';
            successful.push(stepKey);
            options?.onStepComplete?.(stepKey, content);
        } catch (e) {
            failed = stepKey;
            failedAt = i;
            const errMsg = e instanceof Error ? e.message : String(e);
            options?.onStepError?.(stepKey, errMsg);
            break;
        }
    }

    baseCtx.currentStepIndex = originalIndex;

    return { successful, failed, failedAt };
}
