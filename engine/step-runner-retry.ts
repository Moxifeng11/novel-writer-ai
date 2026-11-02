/**
 * step-runner-retry.ts — 步骤 AI 调用原语
 *
 * 从 step-runner.ts 拆分而来：业务级重试、流式续写与截断提示。
 * 只依赖注入的 AI 引擎与回调，不持有步骤状态，便于单测与复用。
 */

import type { AIEngine, APIResponse } from './ai-engine';
import { NOTICE_CRITICAL } from '../shared/thresholds';
import { createLogger } from '../shared/logger';
import type { ThinkingMode } from '../shared/task-model';

const log = createLogger('StepRunnerRetry');

/**
 * P0-2 重试去叠加（spec p0-api-efficiency-optimization 决策 D-1 备用方案）：
 * 前置验证结论——api-client 已对网络错误/429 做同模型指数退避重试（maxApiRetries）+ 跨模型 fallback，
 * 但对业务 error（HTTP 5xx 无 fallback / 空响应 / 非 JSON）不重试。
 * 故此层从 3 降为 2（保留 1 次业务重试），最坏网络请求 3×3=9 → 2×3=6，常规业务失败仅 2 次调用。
 */
export const STEP_RUNNER_MAX_RETRIES = 2;
export const STEP_RUNNER_RETRY_DELAY_MS = 1000;

/** 重试原语依赖的最小宿主能力 */
export interface StepRunnerRetryHost {
    aiEngine: Pick<AIEngine, 'callAI' | 'callAIStream'>;
    showProgress(message: string): void;
    showNotice(message: string, duration?: number): void;
}

export async function callAIWithRetry(
    host: StepRunnerRetryHost,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    temperature: number,
    maxTokens: number,
    stepLabel: string,
    signal?: AbortSignal,
    options?: { thinkingMode?: ThinkingMode; thinkingBudget?: number; endpoint?: string; apiKey?: string; disableFallback?: boolean }
): Promise<APIResponse> {
    let lastError: Error | undefined;
    const maxRetries = STEP_RUNNER_MAX_RETRIES;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
            return { content: '', error: '已取消', finishReason: 'aborted' };
        }
        try {
            if (attempt > 1) {
                const delay = STEP_RUNNER_RETRY_DELAY_MS * Math.pow(2, attempt - 2);
                host.showProgress(`⏳ ${stepLabel} 重试中 (${attempt}/${maxRetries})，等待 ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                if (signal?.aborted) {
                    return { content: '', error: '已取消', finishReason: 'aborted' };
                }
            }

            const result = await host.aiEngine.callAI(
                systemPrompt,
                userPrompt,
                model,
                temperature,
                maxTokens,
                { ...options, ...(signal ? { signal } : {}) }
            );

            if (!result.error) {
                return result;
            }
            if (result.finishReason === 'aborted' || signal?.aborted) {
                return { content: result.content || '', error: '已取消', finishReason: 'aborted' };
            }

            lastError = new Error(result.error);
        } catch (e) {
            // 取消不是失败：不重试、不打印错误日志，直接返回
            if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
                return { content: '', error: '已取消', finishReason: 'aborted' };
            }
            lastError = e instanceof Error ? e : new Error(String(e));
        }

        if (attempt < maxRetries) {
            log.warn(`[StepRunner] ${stepLabel} 第 ${attempt} 次调用失败:`, lastError?.message);
        }
    }

    log.error(`[StepRunner] ${stepLabel} 调用失败，已重试 ${maxRetries} 次:`, lastError?.message);
    throw lastError || new Error('AI 调用失败');
}

export async function callAIStreamWithRetry(
    host: StepRunnerRetryHost,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    temperature: number,
    maxTokens: number,
    stepLabel: string,
    onChunk: (text: string, done: boolean) => void,
    signal?: AbortSignal,
    options?: { thinkingMode?: ThinkingMode; thinkingBudget?: number; endpoint?: string; apiKey?: string; disableFallback?: boolean }
): Promise<APIResponse> {
    const MAX_CONTINUATIONS = 3;
    const CONTINUE_PROMPT = '\n\n[继续无缝衔接上述内容，保持相同的风格、语气和叙事视角，不要重复已写内容，直接从中断处接续：]\n\n';

    let fullContent = '';
    let totalUsage = { prompt: 0, completion: 0, total: 0 };
    let finalFinishReason: 'stop' | 'length' | 'error' | 'aborted' | undefined;

    let currentUserPrompt = userPrompt;
    let previousChunkContent = '';

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
        if (signal?.aborted) {
            finalFinishReason = 'aborted';
            break;
        }

        const result = await host.aiEngine.callAIStream(
            systemPrompt,
            currentUserPrompt,
            model,
            temperature,
            maxTokens,
            (chunkText, _isDone) => {
                if (!signal?.aborted) {
                    onChunk(fullContent + chunkText, false);
                }
            },
            { isWritingTask: true, ...options, signal }
        );

        // A6: 取消时返回 aborted 语义，由调用方决定不落盘
        if (result.finishReason === 'aborted' || signal?.aborted) {
            return { content: fullContent, finishReason: 'aborted', usage: totalUsage };
        }

        if (result.error) {
            return { content: fullContent, error: result.error, finishReason: 'error' };
        }

        const chunkContent = result.content || '';
        fullContent += chunkContent;
        finalFinishReason = (result as any).finishReason || 'stop';

        if (result.usage) {
            totalUsage.prompt += result.usage.prompt;
            totalUsage.completion += result.usage.completion;
            totalUsage.total += result.usage.total;
        }

        if (finalFinishReason !== 'length') {
            break;
        }

        if (chunkContent.length < 50 || chunkContent === previousChunkContent) {
            break;
        }

        previousChunkContent = chunkContent;
        currentUserPrompt = `${fullContent.slice(-500)}${CONTINUE_PROMPT}`;
    }

    onChunk(fullContent, true);

    return {
        content: fullContent,
        finishReason: finalFinishReason,
        usage: totalUsage,
    };
}

/**
 * 输出仍被截断时给用户可见提示。
 * 只写日志会让「半章」被当成完整章节保存，用户无从判断结尾是否缺失。
 * @param host - 宿主元素
 * @param result - 结果
 * @param label - 标签
 */
export function warnIfTruncated(
    host: Pick<StepRunnerRetryHost, 'showNotice'>,
    result: APIResponse,
    label: string
): void {
    if (result.finishReason !== 'length') return;
    host.showNotice(
        `⚠️ ${label} 输出达到模型上限仍未写完（已尝试自动续写），结果可能不完整。请检查结尾，或在设置中提高「最大输出」/精简提示词。`,
        NOTICE_CRITICAL
    );
}
