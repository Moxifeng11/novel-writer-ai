/**
 * ai-api-stream.ts — AI API 流式调用（原生 SSE / 异步迭代器 / 模拟流）
 *
 * 从 ai-api-client.ts 拆出，非流式 callAI 仍留在原文件。
 * 两条链路共享同一个 host 接口（插件设置、模型解析、重试与请求体构造），
 * 这样拆分只移动职责，不复制协议实现。
 */
import type NovelWriterPlugin from '@/main';
import type { Notifier } from '@/shared/types';
import type { ThinkingMode } from '@/shared/task-model';
import type { APIResponse } from './ai-engine';
import {
    AI_RETRY_BACKOFF_MS,
    NOTICE_CRITICAL,
    NOTICE_ERROR,
} from '@/shared/thresholds';
import { calculateTokenBudget } from '@/shared/token-estimator';
import { ensureLocalModelCapability } from '@/services/local-model-probe';
import { recordBudgetSnapshot } from '@/shared/budget-telemetry';
import { buildAuthHeaders, parseSseFrame, usesDoneSentinel, type ApiFormat } from '@/shared/api-format';
import { performanceMonitor } from '@/services/performance-monitor';
import { createLogger } from '@/shared/logger';
import { openStreamResponse } from '@/shared/http-transport';
import { AIAuthError, errorMessage, isAuthErrorMessage } from './ai-api-client-shared';

const log = createLogger('AiApiStream');

/** 流式调用可复用的请求选项（完整版供 host.callAI 回退） */
export interface AIRequestOptions {
    isWritingTask?: boolean;
    forceSimulated?: boolean;
    signal?: AbortSignal;
    endpoint?: string;
    apiKey?: string;
    disableFallback?: boolean;
    bypassCache?: boolean;
    allowKeyPrompt?: boolean;
    numCtx?: number;
    thinkingMode?: ThinkingMode;
    thinkingBudget?: number;
}

/**
 * 流式链路依赖的宿主能力。
 *
 * AIApiClient 在运行时提供这些成员；拆出模块后仍由同一个实例承担设置读取、
 * 模型解析、请求体构造和重试策略，避免出现第二套协议实现。
 */
export interface AIStreamHost {
    plugin: NovelWriterPlugin;
    notifier: Notifier;
    /** 获取流式并发槽；返回幂等的 release */
    acquireStreamSlot(modelId: string, signal?: AbortSignal): Promise<() => void>;
    buildFallbackModels(effectiveModel: string, availableModels: string[], fallbackEnabled: boolean, includeAllWhenMissing?: boolean): string[];
    buildRequestBody(
        isOllamaNative: boolean,
        model: string,
        userPrompt: string,
        systemPrompt: string,
        temperature: number,
        maxTokens: number,
        stream: boolean,
        numCtx?: number,
        endpoint?: string,
        thinkingMode?: ThinkingMode,
        thinkingBudget?: number,
        format?: ApiFormat,
    ): Record<string, unknown>;
    callAI(systemPrompt: string, userPrompt: string, model?: string, temperature?: number, maxTokens?: number, options?: AIRequestOptions): Promise<APIResponse>;
    getContinuityGuard(fromModel: string, toModel: string): string;
    handleRateLimit(currentModel: string, hasMoreModels: boolean): Promise<'break' | 'continue'>;
    isKeylessLocalEndpoint(endpoint: string): boolean;
    isLocalEndpoint(endpoint: string): boolean;
    isUnreachableError(error: unknown): boolean;
    resolveApiFormat(endpoint: string): ApiFormat;
    resolveApiKey(rawKey: string | undefined, allowPrompt?: boolean): Promise<{ key: string; error?: string }>;
    resolveMaxContext(model: string, endpoint?: string): number;
    resolveMaxOutput(model: string, endpoint?: string): number;
    resolveMaxRetries(endpoint: string): number;
    resolveRequestEndpoint(endpoint: string, format: ApiFormat): string;
    resolveTimeout(model: string, endpoint: string): number;
    shouldFallback(error: unknown, statusCode: number | undefined, hasMoreModels: boolean): boolean;
}

/**
 * 发起流式调用（原生 SSE，失败时按阶段降级到模拟流/完整响应）。
 *
 * @param host - 宿主能力（设置、模型解析、请求体构造与重试）
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param model - 模型标识
 * @param temperature - 采样温度
 * @param maxTokens - 最大 token 数
 * @param onChunk - 流式分片回调
 * @param options - 调用选项
 * @returns 完整响应
 */
export async function callAIStream(
    host: AIStreamHost,
    systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        onChunk?: (text: string, done: boolean) => void,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; allowKeyPrompt?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): Promise<APIResponse> {
        const effectiveModel = model || host.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const endpoint = options?.endpoint || host.plugin.settings.apiEndpoint;
        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // 本地未登记模型：流式调用同样先探测真实上下文窗口
        if (endpoint && host.isLocalEndpoint(endpoint)) {
            await ensureLocalModelCapability(endpoint, effectiveModel);
        }

        const modelMaxOutput = host.resolveMaxOutput(effectiveModel, endpoint);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        if (maxTokens > modelMaxOutput) {
            log.debug(`[小说工坊] callAIStream: maxTokens ${maxTokens} > ${effectiveModel} 上限 ${modelMaxOutput}，自动截断为 ${safeMaxTokens}`);
        }
        const finalMaxTokens = safeMaxTokens;

        const releaseSemaphore = await host.acquireStreamSlot(effectiveModel, externalSignal);

        try {
            const apiKey = options?.apiKey || host.plugin.settings.apiKey;
            const apiFormat = host.resolveApiFormat(endpoint);
            const requestEndpoint = host.resolveRequestEndpoint(endpoint, apiFormat);

            if (!endpoint) {
                host.notifier.showNotice('❌ 请先配置API端点', NOTICE_ERROR);
                return { content: '', error: 'API端点未配置' };
            }
            if (!apiKey && !host.isKeylessLocalEndpoint(endpoint)) {
                host.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
                return { content: '', error: 'API密钥未配置' };
            }

            const resolvedKey = await host.resolveApiKey(apiKey, options?.allowKeyPrompt !== false);
            if (resolvedKey.error) {
                host.notifier.showNotice(`🔒 ${resolvedKey.error}`, NOTICE_ERROR);
                return { content: '', error: resolvedKey.error };
            }
            options = { ...(options || {}), apiKey: resolvedKey.key };

            const providerName = host.plugin.settings.customProviders?.find(p => p.endpoint === endpoint)?.name || '自定义';
            log.debug(`[小说工坊] 🔗 callAIStream → ${providerName} | ${effectiveModel}`);

            const availableModels = host.plugin.settings.availableModels || [];
            const fallbackEnabled = host.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
            const isWriting = options?.isWritingTask === true;

            const fallbackModels = host.buildFallbackModels(effectiveModel, availableModels, fallbackEnabled, !options?.disableFallback);

            let lastError: string | undefined;
            const triedModels: string[] = [];
            let fullContent = '';

            // 流式路径此前没有输入预算闸门：超长 prompt 会原样发给本地小窗口模型，
            // 被静默截断后表现为「设定丢失」。与非流式 callAI 保持同一判定口径。
            const streamBudgetModel = fallbackModels[0];
            const streamBudget = calculateTokenBudget(systemPrompt, userPrompt, streamBudgetModel, {
                maxContext: host.resolveMaxContext(streamBudgetModel, endpoint),
                maxOutput: host.resolveMaxOutput(streamBudgetModel, endpoint),
            });
            recordBudgetSnapshot({
                source: 'api',
                model: streamBudgetModel,
                inputTokens: streamBudget.input,
                availableTokens: streamBudget.available,
                contextWindow: streamBudget.contextWindow,
                maxOutput: host.resolveMaxOutput(streamBudgetModel, endpoint),
                overBudget: streamBudget.available < 512,
            });
            if (streamBudget.available < 512) {
                log.warn(`[小说工坊] ⚠️ 流式 Token预算不足 — ${streamBudgetModel}: 输入~${streamBudget.input}, 可用${streamBudget.available}/${streamBudget.contextWindow}`);
                return {
                    content: '',
                    error: `输入过长(~${streamBudget.input}tokens)，超出${streamBudgetModel}窗口，请减少上下文`,
                };
            }

            for (const currentModel of fallbackModels) {
                const currentMaxOutput = host.resolveMaxOutput(currentModel, endpoint);
                const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
                if (maxTokens > currentMaxOutput) {
                    log.debug(`[小说工坊] callAIStream fallback ${currentModel}: maxTokens ${maxTokens} > 上限 ${currentMaxOutput}，截断为 ${currentSafeMaxTokens}`);
                }
                const finalMaxTokens = currentSafeMaxTokens;
                // 同 nativeStreamIterator：思考占满预算时正文为空，需在模型上限内扩容重试
                let attemptMaxTokens = finalMaxTokens;
                let expandedForTruncation = false;
                // 与非流式同源：空正文 + 正常结束 → 关思考重试一次
                let streamThinkingRetryUsed = false;
                let streamAttemptThinkingMode = options?.thinkingMode;

                const isSwitch = triedModels.length > 0;

                const effectiveSystemPrompt = isSwitch && isWriting
                    ? systemPrompt + host.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                    : systemPrompt;

                if (isSwitch) {
                    log.info(`[小说工坊] 🔄 模型切换(流式): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
                    host.notifier.showNotice(`⚠️ [${triedModels[triedModels.length - 1]}] 断联，切换至 [${currentModel}] 重试...`, NOTICE_CRITICAL);
                }

                triedModels.push(currentModel);

                const maxRetries = host.resolveMaxRetries(endpoint);
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                    let ac: AbortController | null = null;
                    let timer: ReturnType<typeof setTimeout> | null = null;

                    // v6.3: 取消联动覆盖到响应体读取结束（finally 解绑），与 callAI 保持一致
                    const onExternalAbort = () => ac?.abort();
                    if (externalSignal) {
                        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                    }
                    try {
                        ac = new AbortController();
                        timer = setTimeout(() => ac!.abort(), host.resolveTimeout(currentModel, endpoint));

                        const isOllamaNative = requestEndpoint.includes('/api/generate');

                        const streamRequestBody = host.buildRequestBody(
                            isOllamaNative,
                            currentModel,
                            userPrompt,
                            effectiveSystemPrompt,
                            temperature,
                            attemptMaxTokens,
                            true,
                            options?.numCtx,
                            endpoint,
                            streamAttemptThinkingMode,
                            options?.thinkingBudget,
                            apiFormat,
                        );

                        const perfStreamFetchId = performanceMonitor.start('apiFetchStream', 'apiCall', undefined, {
                            model: currentModel,
                            endpoint: endpoint.substring(0, 50),
                        });
                        // O-1：移动端由 http-transport 缓冲 SSE 后合成 reader，
                        // 桌面端仍是原生 fetch（ReadableStream + 取消语义不变）。
                        const response = await openStreamResponse(requestEndpoint, {
                            headers: {
                                'Content-Type': 'application/json',
                                ...buildAuthHeaders(apiFormat, apiKey),
                                'Accept': 'text/event-stream',
                            },
                            body: JSON.stringify(streamRequestBody),
                            signal: ac.signal,
                        });
                        performanceMonitor.end(perfStreamFetchId, { status: response.status });

                        // 同 nativeStreamIterator：头部到达后保留空闲超时看门狗，避免读流永久挂起
                        const armIdleTimer = () => {
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(() => ac?.abort(), host.resolveTimeout(currentModel, endpoint));
                        };
                        armIdleTimer();

                        if (response.status === 429) {
                            const rateLimitResult = await host.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                            if (rateLimitResult === 'break') break;
                            continue;
                        }

                        if (!response.ok) {
                            const errorText = await response.text();
                            log.error(`[小说工坊] API响应错误(流式) - 模型: ${currentModel}, 状态码: ${response.status}, 内容:`, errorText);

                            if (host.shouldFallback(null, response.status, fallbackModels.length > triedModels.length)) {
                                lastError = `HTTP ${response.status} (${currentModel}): ${errorText}`;
                                log.info(`[小说工坊] ${currentModel} 断联 (HTTP ${response.status})，尝试下一个模型`);
                                break;
                            }

                            return { content: '', error: `HTTP ${response.status}: ${errorText}` };
                        }

                        const reader = response.body?.getReader();
                        if (!reader) {
                            throw new Error('ReadableStream 不可用');
                        }

                        const decoder = new TextDecoder();
                        let buffer = '';
                        let accumulatedContent = '';
                        // 思考型模型的 reasoning_content 与 nativeStreamIterator 同处理：只统计不并入正文
                        let accumulatedReasoning = '';
                        let isStreamDone = false;
                        let streamFinishReason: 'stop' | 'length' | undefined;
                        // DSH-20261113-20 缺陷③：responses 协议的 error/failed 事件在此落地，
                        // 抛给 attempt 级 catch 走重试/回退（限流/审核/服务端错误不是正常结束）。
                        let protocolError: string | null = null;

                        while (!isStreamDone) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            armIdleTimer();

                            buffer += decoder.decode(value, { stream: true });

                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;

                                // Ollama /api/generate 流式格式：每行是裸 JSON {"model":"...","response":"...","done":false}
                                if (isOllamaNative) {
                                    try {
                                        const parsed = JSON.parse(trimmed);
                                        const delta = parsed?.response;
                                        if (delta) {
                                            accumulatedContent += delta;
                                            onChunk?.(accumulatedContent, false);
                                        }
                                        if (parsed?.done === true) {
                                            // 与 OpenAI 路径对齐：length 必须能传到上层，供续写/扩容判定
                                            streamFinishReason = parsed?.done_reason === 'length' ? 'length' : 'stop';
                                            isStreamDone = true;
                                            break;
                                        }
                                    } catch {
                                        log.warn('[小说工坊] Ollama 流式解析警告: 无法解析行:', trimmed.slice(0, 100));
                                    }
                                    continue;
                                }

                                // OpenAI SSE 格式（兜底分支，协议解析见下方通用路径）
                                if (usesDoneSentinel(apiFormat) && trimmed === 'data: [DONE]') {
                                    isStreamDone = true;
                                    break;
                                }

                                if (!trimmed.startsWith('data: ')) {
                                    continue;
                                }

                                const jsonStr = trimmed.slice(6);
                                try {
                                    const parsed = JSON.parse(jsonStr);
                                    const update = parseSseFrame(apiFormat, parsed);
                                    if (update === null) continue;

                                    if (update.error) {
                                        // 协议层失败（限流/审核/服务端错误）：跳出循环抛给
                                        // attempt 级 catch，走重试/回退——不是正常结束。
                                        protocolError = update.error;
                                        isStreamDone = true;
                                        break;
                                    }

                                    if (update.delta) {
                                        accumulatedContent += update.delta;
                                        onChunk?.(accumulatedContent, false);
                                    }
                                    if (update.reasoning) {
                                        accumulatedReasoning += update.reasoning;
                                    }
                                    if (update.done) {
                                        streamFinishReason = update.finishReason ?? 'stop';
                                        isStreamDone = true;
                                        break;
                                    }
                                } catch {
                                    log.warn('[小说工坊] SSE 解析警告: 无法解析行:', jsonStr.slice(0, 100));
                                }
                            }
                        }

                        if (protocolError) {
                            throw new Error(`流式响应错误：${protocolError}`);
                        }

                        // DSH-20261113-20 缺陷①：流在结束标记前被对端干净关闭（网关空闲
                        // 超时关流、Ollama 进程被 kill、兼容层不发 [DONE]）时，不得把半截
                        // 内容当「成功完整响应」返回——必须走报错路径。
                        if (!isStreamDone && accumulatedContent) {
                            fullContent = accumulatedContent;
                            onChunk?.(fullContent, true);
                            log.warn('[小说工坊] 流式连接在结束标记前中断，内容可能不完整');
                            return {
                                content: fullContent,
                                error: '流式连接中断（未收到正常结束标记），内容可能被截断',
                            };
                        }

                        fullContent = accumulatedContent;
                        onChunk?.(fullContent, true);

                        if (!fullContent) {
                            // 思考占满预算（finish_reason=length + 有思考增量）：同模型扩容重试
                            if (
                                streamFinishReason === 'length'
                                && accumulatedReasoning
                                && !expandedForTruncation
                                && attemptMaxTokens < currentMaxOutput
                            ) {
                                const nextMaxTokens = Math.min(currentMaxOutput, Math.max(attemptMaxTokens * 2, 8192));
                                if (nextMaxTokens > attemptMaxTokens) {
                                    expandedForTruncation = true;
                                    log.info(`[小说工坊] ${currentModel} 流式正文为空（思考 ${accumulatedReasoning.length} 字占满预算），max_tokens ${attemptMaxTokens} → ${nextMaxTokens} 重试`);
                                    attemptMaxTokens = nextMaxTokens;
                                    attempt -= 1;
                                    continue;
                                }
                            }
                            if (
                                streamFinishReason !== 'length'
                                && !streamThinkingRetryUsed
                                && streamAttemptThinkingMode === 'on'
                            ) {
                                streamThinkingRetryUsed = true;
                                streamAttemptThinkingMode = 'off';
                                attempt -= 1;
                                log.info(`[小说工坊] ${currentModel} 流式空正文（finish_reason=${streamFinishReason || 'stop'}，疑似思考占满预算），关闭思考重试一次`);
                                continue;
                            }
                            if (fallbackModels.length > triedModels.length) {
                                lastError = `AI流式返回为空 (${currentModel})`;
                                log.info(`[小说工坊] ${currentModel} 流式返回空内容，尝试下一个模型`);
                                break;
                            }
                            return {
                                content: '',
                                error: streamFinishReason === 'length'
                                    ? `模型思考占满输出上限（max_tokens=${attemptMaxTokens}）未产出正文，请提高模型输出上限`
                                    : 'AI流式返回为空',
                            };
                        }

                        const data = { content: fullContent, finishReason: streamFinishReason };

                        if (isSwitch) {
                            log.info(`[小说工坊] ✅ 模型切换成功(流式): ${currentModel}`);
                            host.notifier.showNotice(`✅ 已切换至 [${currentModel}] 并成功返回内容`, NOTICE_CRITICAL);
                        }

                        return data;
                    } catch (error: unknown) {
                        // v6.3: 外部取消优先于断联判定（同 callAI，避免取消被误判为断联后切模型）
                        if (externalSignal?.aborted) {
                            return { content: '', error: 'aborted' };
                        }
                        if (host.isUnreachableError(error)) {
                            const msg = errorMessage(error) || '网络不可达';
                            log.error(`[小说工坊] ${endpoint} 无法连接，停止重试(流式): ${msg}`);
                            return { content: '', error: `无法连接模型服务（${endpoint}）：${msg}` };
                        }
                        if (host.shouldFallback(error, undefined, fallbackModels.length > triedModels.length)) {
                            lastError = errorMessage(error) || '网络错误(流式)';
                            log.info(`[小说工坊] ${currentModel} 网络断联(流式): ${lastError}`);
                            break;
                        }

                        if (attempt < 2) {
                            const base = AI_RETRY_BACKOFF_MS * Math.pow(2, attempt);
                            const backoff = Math.min(base, 30_000);
                            const jitter = Math.random() * backoff * 0.5;
                            await new Promise(r => setTimeout(r, backoff + jitter));
                        } else {
                            lastError = errorMessage(error) || '网络错误(流式)';
                        }
                    } finally {
                        // v6.3: 解绑放在 finally，保证取消联动覆盖整个请求生命周期（含响应体读取）
                        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                    }
                }
            }

            const msg = fallbackModels.length > 1
                ? `所有模型均不可用（已尝试: ${triedModels.join(', ')}），最后错误: ${lastError || '未知'}`
                : (lastError || '重试耗尽');
            return { content: fullContent || '', error: msg };
        } finally {
            releaseSemaphore();
        }
    }

/**
 * 发起流式调用并返回异步迭代器。
 *
 * @param host - 宿主能力（设置、模型解析、请求体构造与重试）
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param model - 模型标识
 * @param temperature - 采样温度
 * @param maxTokens - 最大 token 数
 * @param options - 调用选项
 * @returns 逐块产出文本，最终返回完整响应
 */
export async function* callAIAsyncIterator(
    host: AIStreamHost,
    systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; forceSimulated?: boolean; allowKeyPrompt?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const effectiveModel = model || host.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const endpoint = options?.endpoint || host.plugin.settings.apiEndpoint;
        const apiFormat = host.resolveApiFormat(endpoint);
        const requestEndpoint = host.resolveRequestEndpoint(endpoint, apiFormat);
        const externalSignal = options?.signal;

        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // 密文密钥前置解析（同 callAI）：未解锁就不进入流式降级链，避免重复 401。
        // 本地 Ollama 无需密钥，直接跳过，避免误报解密失败。
        const keylessEndpoint = !!endpoint && host.isKeylessLocalEndpoint(endpoint);
        if (!keylessEndpoint) {
            const rawKey = options?.apiKey || host.plugin.settings.apiKey;
            const resolvedKey = await host.resolveApiKey(rawKey, options?.allowKeyPrompt !== false);
            if (resolvedKey.error) {
                host.notifier.showNotice(`🔒 ${resolvedKey.error}`, NOTICE_ERROR);
                return { content: '', error: resolvedKey.error };
            }
            if (resolvedKey.key !== rawKey) {
                options = { ...(options || {}), apiKey: resolvedKey.key };
            }
        }

        const modelMaxOutput = host.resolveMaxOutput(effectiveModel);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        const finalMaxTokens = safeMaxTokens;

        let fallbackStage: 'native' | 'simulated' | 'full' | 'done' = options?.forceSimulated ? 'simulated' : 'native';
        let lastError: string | undefined;
        // DSH-20261113-20 缺陷②：跨阶段 yield 追踪——任一阶段已向消费者产出分片后，
        // 该阶段失败时不得降级到后续阶段（后续阶段从零重发全文，消费者累加后
        // 出现重复正文），必须如实报错让消费方走 catch（回退一次性调用/报错路径）。
        let nativeHasYielded = false;
        let simulatedHasYielded = false;

        while (fallbackStage !== ('done' as string)) {
            try {
                if (fallbackStage === 'native') {
                    log.debug('[小说工坊] 流式降级: 尝试原生 SSE 流式');
                    const nativeInner = nativeStreamIterator(
                        host, systemPrompt, userPrompt, effectiveModel, temperature, finalMaxTokens, options
                    );
                    let nativeStep = await nativeInner.next();
                    while (!nativeStep.done) {
                        nativeHasYielded = true;
                        yield nativeStep.value;
                        nativeStep = await nativeInner.next();
                    }
                    const result = nativeStep.value;
                    if (!result.error || result.content) {
                        return result;
                    }
                    // v6.3: 用户取消优先短路——原生阶段中止时「返回」而非「抛出」aborted，
                    // 若不在此拦截，会被误判为阶段失败并继续空跑 simulated/full 两阶段、
                    // 打印误导性的「流式降级」警告。
                    if (externalSignal?.aborted) {
                        return { content: '', error: 'aborted' };
                    }
                    lastError = result.error;
                    log.warn('[小说工坊] 流式降级: 原生 SSE 失败，切换到模拟流式 -', lastError);
                    // 认证失败换阶段也不会成功，且会重复发送无效密钥，直接终止降级链
                    if (isAuthErrorMessage(lastError)) {
                        return { content: '', error: lastError };
                    }
                    fallbackStage = 'simulated';
                } else if (fallbackStage === 'simulated') {
                    log.debug('[小说工坊] 流式降级: 尝试模拟流式');
                    const simulatedInner = simulatedStreamIterator(
                        host, systemPrompt, userPrompt, effectiveModel, temperature, finalMaxTokens, options
                    );
                    let simulatedStep = await simulatedInner.next();
                    while (!simulatedStep.done) {
                        simulatedHasYielded = true;
                        yield simulatedStep.value;
                        simulatedStep = await simulatedInner.next();
                    }
                    const result = simulatedStep.value;
                    if (!result.error || result.content) {
                        return result;
                    }
                    // v6.3: 同 native —— 模拟流式遇取消时 callAI 直接返回 aborted，需在此拦截
                    if (externalSignal?.aborted) {
                        return { content: '', error: 'aborted' };
                    }
                    lastError = result.error;
                    log.warn('[小说工坊] 流式降级: 模拟流式失败，切换到完整响应 -', lastError);
                    if (isAuthErrorMessage(lastError)) {
                        return { content: '', error: lastError };
                    }
                    fallbackStage = 'full';
                } else {
                    log.debug('[小说工坊] 流式降级: 尝试完整响应（非流式）');
                    const result = await host.callAI(
                        systemPrompt, userPrompt, effectiveModel, temperature, finalMaxTokens, options
                    );
                    if (result.content) {
                        yield result.content;
                    }
                    return result;
                }
            } catch (error: unknown) {
                if (externalSignal?.aborted) {
                    return { content: '', error: 'aborted' };
                }
                const errMsg = error instanceof Error ? error.message : String(error);
                lastError = errMsg;
                log.warn(`[小说工坊] 流式降级: ${fallbackStage} 阶段异常 -`, errMsg);

                if (error instanceof AIAuthError || isAuthErrorMessage(errMsg)) {
                    return { content: '', error: errMsg };
                }

                // DSH-20261113-20 缺陷②：该阶段已向消费者产出过分片——降级到下一阶段
                // 会从零重发全文，消费者累加后出现重复正文。如实报错收场。
                const yielded = fallbackStage === 'native' ? nativeHasYielded
                    : fallbackStage === 'simulated' ? simulatedHasYielded
                        : false;
                if (yielded) {
                    return { content: '', error: errMsg };
                }

                if (fallbackStage === 'native') {
                    fallbackStage = 'simulated';
                } else if (fallbackStage === 'simulated') {
                    fallbackStage = 'full';
                } else {
                    return { content: '', error: lastError };
                }
            }
        }

        return { content: '', error: lastError || '流式生成失败' };
    }

async function* nativeStreamIterator(
    host: AIStreamHost,
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const externalSignal = options?.signal;
        const apiKey = options?.apiKey || host.plugin.settings.apiKey;
        const endpoint = options?.endpoint || host.plugin.settings.apiEndpoint;
        const apiFormat = host.resolveApiFormat(endpoint);
        const requestEndpoint = host.resolveRequestEndpoint(endpoint, apiFormat);
        const availableModels = host.plugin.settings.availableModels || [];
        const fallbackEnabled = host.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
        const isWriting = options?.isWritingTask === true;

        const fallbackModels = host.buildFallbackModels(model, availableModels, fallbackEnabled, !options?.disableFallback);

        // 与 callAIStream 共用同一输入预算口径，避免本地小窗口被静默截断
        const iteratorBudgetModel = fallbackModels[0];
        const iteratorBudget = calculateTokenBudget(systemPrompt, userPrompt, iteratorBudgetModel, {
            maxContext: host.resolveMaxContext(iteratorBudgetModel, endpoint),
            maxOutput: host.resolveMaxOutput(iteratorBudgetModel, endpoint),
        });
        recordBudgetSnapshot({
            source: 'api',
            model: iteratorBudgetModel,
            inputTokens: iteratorBudget.input,
            availableTokens: iteratorBudget.available,
            contextWindow: iteratorBudget.contextWindow,
            maxOutput: host.resolveMaxOutput(iteratorBudgetModel, endpoint),
            overBudget: iteratorBudget.available < 512,
        });
        if (iteratorBudget.available < 512) {
            log.warn(`[小说工坊] ⚠️ 迭代器 Token预算不足 — ${iteratorBudgetModel}: 输入~${iteratorBudget.input}, 可用${iteratorBudget.available}/${iteratorBudget.contextWindow}`);
            return {
                content: '',
                error: `输入过长(~${iteratorBudget.input}tokens)，超出${iteratorBudgetModel}窗口，请减少上下文`,
            };
        }

        let lastError: string | undefined;
        const triedModels: string[] = [];

        for (const currentModel of fallbackModels) {
            const currentMaxOutput = host.resolveMaxOutput(currentModel, endpoint);
            const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
            // finish_reason=length 且正文为空时，在模型上限内扩容重试一次：
            // 思考型模型（deepseek-flash / r1）的思考与正文共用预算，思考占满时正文为空。
            let attemptMaxTokens = currentSafeMaxTokens;
            let expandedForTruncation = false;

            const isSwitch = triedModels.length > 0;

            const effectiveSystemPrompt = isSwitch && isWriting
                ? systemPrompt + host.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                : systemPrompt;

            if (isSwitch) {
                log.info(`[小说工坊] 🔄 模型切换(流式迭代器): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
            }

            triedModels.push(currentModel);

            const maxRetries = host.resolveMaxRetries(endpoint);
            // 审计缺陷②守卫：只要本生成器曾向消费者 yield 过正文分片，
            // 后续任何失败都不能再走内部重试——重试会从零重发，消费者
            // 累加后出现重复正文。hasYielded 跨 attempt 存续，永不复位。
            let hasYielded = false;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                let ac: AbortController | null = null;
                let timer: ReturnType<typeof setTimeout> | null = null;

                // v6.3: 取消联动覆盖到响应体读取结束（finally 解绑），与 callAI 保持一致
                const onExternalAbort = () => ac?.abort();
                if (externalSignal) {
                    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                }
                try {
                    ac = new AbortController();
                    timer = setTimeout(() => ac!.abort(), host.resolveTimeout(currentModel, endpoint));

                    const isOllamaNative = requestEndpoint.includes('/api/generate');

                    const streamRequestBody = host.buildRequestBody(
                        isOllamaNative,
                        currentModel,
                        userPrompt,
                        effectiveSystemPrompt,
                        temperature,
                        attemptMaxTokens,
                        true,
                        options?.numCtx,
                        endpoint,
                        options?.thinkingMode,
                        options?.thinkingBudget,
                        apiFormat,
                    );

                    // O-1：移动端走 requestUrl 缓冲（无 CORS 限制），桌面端保持原生流式
                    const response = await openStreamResponse(requestEndpoint, {
                        headers: {
                            'Content-Type': 'application/json',
                            ...buildAuthHeaders(apiFormat, apiKey),
                            'Accept': 'text/event-stream',
                        },
                        body: JSON.stringify(streamRequestBody),
                        signal: ac.signal,
                    });

                    // 响应头到达后不清除计时器，改为「空闲超时」看门狗：
                    // 旧实现头部一到就 clearTimeout，若服务端保持连接却不再产出，
                    // reader.read() 会永久挂起（本地 Ollama 排队/卡死时表现为一直「生成中」）。
                    const armIdleTimer = () => {
                        if (timer) clearTimeout(timer);
                        timer = setTimeout(() => ac?.abort(), host.resolveTimeout(currentModel, endpoint));
                    };
                    armIdleTimer();

                    if (response.status === 429) {
                        const rateLimitResult = await host.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                        if (rateLimitResult === 'break') break;
                        continue;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        if (response.status === 401 || response.status === 403) {
                            // 认证失败：不重试、不换模型、不降级，直接抛给上层显示
                            throw new AIAuthError(`API 密钥无效或无权限 (HTTP ${response.status})：${errorText}`);
                        }
                        if (host.shouldFallback(null, response.status, fallbackModels.length > triedModels.length)) {
                            lastError = `HTTP ${response.status} (${currentModel}): ${errorText}`;
                            break;
                        }
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }

                    const reader = response.body?.getReader();
                    if (!reader) {
                        throw new Error('ReadableStream 不可用');
                    }

                    const decoder = new TextDecoder();
                    let buffer = '';
                    let accumulatedContent = '';
                    // 思考型模型的 reasoning_content：不算正文，但要记录是否发生了思考，
                    // 用于区分「模型什么都没说」和「思考把预算吃光了」。
                    let accumulatedReasoning = '';
                    let isStreamDone = false;
                    let streamFinishReason: 'stop' | 'length' | undefined;
                    let protocolError: string | null = null;

                    while (!isStreamDone) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        // 收到分片 → 重置空闲计时，正常流式不会被看门狗误杀
                        armIdleTimer();

                        if (externalSignal?.aborted) {
                            try { reader.releaseLock(); } catch { }
                            return { content: accumulatedContent, error: 'aborted' };
                        }

                        buffer += decoder.decode(value, { stream: true });

                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed) continue;

                            if (isOllamaNative) {
                                try {
                                    const parsed = JSON.parse(trimmed);
                                    const delta = parsed?.response;
                                    if (delta) {
                                        accumulatedContent += delta;
                                        hasYielded = true;
                                        yield delta;
                                    }
                                    if (parsed?.done === true) {
                                        streamFinishReason = parsed?.done_reason === 'length' ? 'length' : 'stop';
                                        isStreamDone = true;
                                        break;
                                    }
                                } catch {
                                }
                                continue;
                            }

                            if (usesDoneSentinel(apiFormat) && trimmed === 'data: [DONE]') {
                                isStreamDone = true;
                                break;
                            }

                            if (!trimmed.startsWith('data: ')) {
                                continue;
                            }

                            const jsonStr = trimmed.slice(6);
                            try {
                                const parsed = JSON.parse(jsonStr);
                                const update = parseSseFrame(apiFormat, parsed);
                                if (update === null) continue;

                                if (update.error) {
                                    protocolError = update.error;
                                    isStreamDone = true;
                                    break;
                                }

                                if (update.delta) {
                                    accumulatedContent += update.delta;
                                    hasYielded = true;
                                    yield update.delta;
                                }
                                // 思考型模型（deepseek-flash / -pro / reasoner）的思考增量，
                                // 只用于判断「思考是否吃满预算」，绝不并入正文。
                                if (update.reasoning) {
                                    accumulatedReasoning += update.reasoning;
                                }
                                if (update.done) {
                                    streamFinishReason = update.finishReason ?? 'stop';
                                    isStreamDone = true;
                                    break;
                                }
                            } catch {
                            }
                        }
                    }

                    // DSH-20261113-20 缺陷③：协议层失败抛给 attempt 级 catch——
                    // 有 hasYielded 守卫在，消费者已收到的分片不会被重试轮污染。
                    if (protocolError) {
                        throw new Error(`流式响应错误：${protocolError}`);
                    }

                    // DSH-20261113-20 缺陷①（生成器侧）：流在结束标记前被对端干净关闭
                    // 且已产出部分正文时，不得以 {content, finishReason} 成功收尾——
                    // 抛错让消费方走 catch（单元写作回退一次性调用 / 报错路径）。
                    if (!isStreamDone && accumulatedContent) {
                        throw new Error('流式连接中断（未收到正常结束标记），内容可能被截断');
                    }

                    // 正文为空且被截断 → 在模型上限内扩容重试一次（与 callAI 非流式行为一致）：
                    // 思考型模型的思考与正文共用预算，思考占满时正文为空；
                    // 有正文的截断仍按原逻辑直接返回，避免每条候选都多跑一倍时间。
                    if (!accumulatedContent && streamFinishReason === 'length' && !expandedForTruncation && attemptMaxTokens < currentMaxOutput) {
                        const nextMaxTokens = Math.min(currentMaxOutput, Math.max(attemptMaxTokens * 2, 8192));
                        if (nextMaxTokens > attemptMaxTokens) {
                            expandedForTruncation = true;
                            log.info(`[小说工坊] ${currentModel} 流式正文为空（思考 ${accumulatedReasoning.length} 字占满预算），max_tokens ${attemptMaxTokens} → ${nextMaxTokens} 重试`);
                            attemptMaxTokens = nextMaxTokens;
                            // 扩容重试是同一模型的追加预算，不应消耗正常的重试次数
                            attempt -= 1;
                            continue;
                        }
                    }

                    if (!accumulatedContent) {
                        if (fallbackModels.length > triedModels.length) {
                            lastError = `AI流式返回为空 (${currentModel})`;
                            break;
                        }
                        throw new Error(streamFinishReason === 'length'
                            ? `模型思考占满输出上限（max_tokens=${attemptMaxTokens}）未产出正文，请提高模型输出上限`
                            : 'AI流式返回为空');
                    }

                    return { content: accumulatedContent, finishReason: streamFinishReason };
                } catch (error: unknown) {
                    if (externalSignal?.aborted) {
                        if (timer) { clearTimeout(timer); timer = null; }
                        return { content: '', error: 'aborted' };
                    }

                    // DSH-20261113-20 缺陷②守卫：消费者已经累加了本生成器此前 yield
                    // 的分片——任何内部重试都会从零重发，消费者累加后出现重复正文。
                    // 必须把错误如实抛给消费方（单元写作回退一次性调用 / 报错路径）。
                    if (hasYielded) {
                        if (timer) { clearTimeout(timer); timer = null; }
                        throw error;
                    }

                    // 认证失败不进入重试（重试只会重复 401）
                    if (error instanceof AIAuthError) {
                        throw error;
                    }

                    if (host.isUnreachableError(error)) {
                        const msg = errorMessage(error) || '网络不可达';
                        log.error(`[小说工坊] ${endpoint} 无法连接，停止重试(原生流): ${msg}`);
                        return { content: '', error: `无法连接模型服务（${endpoint}）：${msg}` };
                    }

                    if (host.shouldFallback(error, undefined, fallbackModels.length > triedModels.length)) {
                        lastError = error instanceof Error ? error.message : String(error);
                        break;
                    }

                    if (attempt < 2) {
                        const base = AI_RETRY_BACKOFF_MS * Math.pow(2, attempt);
                        const backoff = Math.min(base, 30_000);
                        const jitter = Math.random() * backoff * 0.5;
                        await new Promise(r => setTimeout(r, backoff + jitter));
                    } else {
                        lastError = error instanceof Error ? error.message : String(error);
                    }
                } finally {
                    // v6.3: 解绑放在 finally，保证取消联动覆盖整个请求生命周期（含响应体读取）
                    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    ac = null;
                }
            }
        }

        const msg = fallbackModels.length > 1
            ? `所有模型均不可用（已尝试: ${triedModels.join(', ')}），最后错误: ${lastError || '未知'}`
            : (lastError || '重试耗尽');
        throw new Error(msg);
    }

async function* simulatedStreamIterator(
    host: AIStreamHost,
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const response = await host.callAI(systemPrompt, userPrompt, model, temperature, maxTokens, options);

        if (response.error && !response.content) {
            return response;
        }

        if (!response.content) {
            return { content: '', error: 'AI返回为空' };
        }

        const { createSimulatedStreamWithSignal } = await import('./streaming/simulated-stream');

        const result = yield* createSimulatedStreamWithSignal(response.content, options?.signal, {
            splitBy: 'sentence',
            minDelayMs: 20,
            maxDelayMs: 50,
        });

        return {
            content: result,
            usage: response.usage,
        };
    }
