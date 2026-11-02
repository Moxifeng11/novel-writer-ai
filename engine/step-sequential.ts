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

/**
 * SequentialStepHost 类型定义。
 */
export interface SequentialStepHost {
    executeStep(ctx: StepRunCtx): Promise<void>;
    /** 为当前步骤装配真实 system/user prompt；不提供时沿用宿主输入区。 */
    prepareStepInputs?(stepKey: string, ctx: StepRunCtx): Promise<void> | void;
    createStepInputs(): SequentialStepInputs;
}

/**
 * SequentialStepOptions 类型定义。
 */
export interface SequentialStepOptions {
    onStepStart?: (stepKey: string) => void;
    onStepComplete?: (stepKey: string, content: string) => void;
    onStepError?: (stepKey: string, error: string) => void;
}

/**
 * executeStepsSequential 函数。
 * @param host - 宿主元素
 * @param stepKeys - 步骤键列表
 * @param baseCtx - 基础上下文
 * @param options - 配置项
  * @returns number }> 结果
 */
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

        // 取消后不再启动下一步：旧实现只在当前 AI 调用内部检查 signal，
        // 逐步模式一次传入 5 个规划步骤时，取消后仍会继续跑后续步骤。
        if (baseCtx.getAbortController?.()?.signal.aborted) {
            failed = stepKey;
            failedAt = i;
            options?.onStepError?.(stepKey, '已取消');
            break;
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
            await host.prepareStepInputs?.(stepKey, stepCtx);
            await host.executeStep(stepCtx);
            const content = baseCtx.stepResults[stepKey] || '';
            // 空内容/未达完成标准不能算成功：旧实现只看“没抛异常”，
            // 因此空 prompt 早退、截断草稿都会被计入 successful，调用方以为已补齐。
            if (!content.trim() || !baseCtx.stepCompleted.has(stepKey)) {
                const meta = stepCtx.stepMeta?.[stepKey];
                const reason = meta?.truncated ? '输出被截断' : '未产出完整内容';
                throw new Error(`${step.label} ${reason}`);
            }
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
