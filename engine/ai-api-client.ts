
import type NovelWriterPlugin from '../main';
import { computePromptHash } from './prompt-hash';
import { getPromptCache } from './prompt-cache';
import {
    AI_RETRY_BACKOFF_MS,
    AI_RATE_LIMIT_WAIT_MS,
    STREAM_SEMAPHORE_POLL_MS,
    ZAI_MAX_TOKENS,
    NOTICE_ERROR,
    NOTICE_WARNING,
    NOTICE_CRITICAL,
    NOTICE_SUCCESS,
    getTimeoutForModel,
} from '../shared/thresholds';
import { calculateTokenBudget, getModelMaxOutput } from '../shared/token-estimator';
import { resolveProviderSourceType } from '../shared/model-source';
import type { APIResponse } from './ai-engine';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { performanceMonitor } from '../services/performance-monitor';
import { createLogger } from '../shared/logger';


const log = createLogger('AiApiClient');
/** 安全提取 Error 的 message，未知类型返回空串 */
function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
}

/** API JSON 响应结构 */
interface AIApiJsonResponse {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
    };
    // Ollama /api/generate 原生字段
    response?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    done?: boolean;
}

export class AIApiClient {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private _sessionTokens = { input: 0, output: 0 };

    private static activeStreams = 0;
    private static readonly MAX_CONCURRENT_DEFAULT = 2;
    private static readonly MAX_CONCURRENT_LIGHT = 4;
    private static readonly MAX_CONCURRENT_HEAVY = 1;
    private static rateLimitHits = 0;
    private static rateLimitBackoffUntil = 0;

    static getMaxConcurrent(modelId: string): number {
        const m = modelId.toLowerCase();
        // v6.3: 本地 Ollama 模型（如 qwen2.5:7b、deepseek-r1:7b）按轻量并发处理
        if (m.includes('qwen2.5') || m.includes('deepseek-r1:7b') || m.includes('ollama')) {
            return AIApiClient.MAX_CONCURRENT_LIGHT;
        }
        if (m.includes('reasoner') || m.includes('r1') || m.includes('opus') || m.includes('v4-pro')) {
            return AIApiClient.MAX_CONCURRENT_HEAVY;
        }
        if (m.includes('flash') || m.includes('mini') || m.includes('nano') || m.includes('haiku') || m.includes('air') || m.includes('1-8')) {
            return AIApiClient.MAX_CONCURRENT_LIGHT;
        }
        if (Date.now() < AIApiClient.rateLimitBackoffUntil) {
            return 1;
        }
        return AIApiClient.MAX_CONCURRENT_DEFAULT;
    }

    private static onRateLimitHit(): void {
        AIApiClient.rateLimitHits++;
        const backoff = Math.min(2_000 * Math.pow(2, AIApiClient.rateLimitHits), 60_000);
        AIApiClient.rateLimitBackoffUntil = Date.now() + backoff;
        log.warn(`[小说工坊] 速率限制命中 #${AIApiClient.rateLimitHits}，并发降至1，退避 ${backoff}ms`);
    }

    private static onRequestSuccess(): void {
        if (AIApiClient.rateLimitHits > 0) {
            AIApiClient.rateLimitHits = Math.max(0, AIApiClient.rateLimitHits - 0.5);
        }
    }

    get sessionTokens() { return { ...this._sessionTokens }; }

    resetSessionTokens(): void {
        this._sessionTokens = { input: 0, output: 0 };
    }

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
    }

    private isDisconnectionError(error: unknown, statusCode?: number): boolean {
        if (statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) return true;
        if (statusCode === 408) return true;
        if (statusCode && statusCode >= 400 && statusCode < 500) return false;
        if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError') return true;
        const msg = errorMessage(error).toLowerCase();
        if (msg.includes('fetch failed') || msg.includes('networkerror')
            || msg.includes('timeout') || msg.includes('econnrefused')
            || msg.includes('enotfound') || msg.includes('certificate')
            || msg.includes('ssl') || msg.includes('cloudflare')
            || msg.includes('502 bad gateway')) return true;
        return false;
    }

    private getContinuityGuard(fromModel: string, toModel: string): string {
        return `\n⚠️ **模型切换通知**：因 [${fromModel}] 不可用，当前写作任务已切换至 [${toModel}]。\n请严格延续上文已写内容的**文笔风格、人物语气、情节走向**进行创作，避免风格突变。务必和前文保持无缝衔接。\n`;
    }

    private buildFallbackModels(
        effectiveModel: string,
        availableModels: string[],
        fallbackEnabled: boolean,
        includeAllWhenMissing: boolean = true
    ): string[] {
        const models: string[] = [effectiveModel];
        if (!fallbackEnabled) return models;

        const others = availableModels.filter(m => m !== effectiveModel);
        if (includeAllWhenMissing && !availableModels.includes(effectiveModel) && availableModels.length > 0) {
            return models.concat(availableModels);
        }
        return models.concat(others);
    }

    /** 构造请求体（统一 Ollama 原生 / OpenAI 兼容两种格式，消除三份重复实现） */
    private buildRequestBody(
        isOllamaNative: boolean,
        model: string,
        userPrompt: string,
        systemPrompt: string,
        temperature: number,
        maxTokens: number,
        stream: boolean
    ): Record<string, unknown> {
        const safeMaxTokens = Math.min(maxTokens, ZAI_MAX_TOKENS);
        if (isOllamaNative) {
            return {
                model,
                prompt: userPrompt,
                system: systemPrompt,
                stream,
                options: { temperature, num_predict: safeMaxTokens },
            };
        }
        const body: Record<string, unknown> = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: safeMaxTokens,
            temperature,
        };
        if (stream) body.stream = true;
        return body;
    }

    private async handleRateLimit(currentModel: string, hasMoreModels: boolean): Promise<'break' | 'continue'> {
        AIApiClient.onRateLimitHit();
        if (hasMoreModels) {
            log.info(`[小说工坊] ${currentModel} 被限流，跳过到下一个模型`);
            return 'break';
        }
        await new Promise(r => setTimeout(r, AI_RATE_LIMIT_WAIT_MS));
        return 'continue';
    }

    private shouldFallback(error: unknown, statusCode: number | undefined, hasMoreModels: boolean): boolean {
        if (!hasMoreModels) return false;
        return this.isDisconnectionError(error, statusCode);
    }

    /**
     * v6.3: 本地模型源（Ollama / LM Studio / vLLM 等）通常无需 API 密钥。
     * 仅当端点被判定为 local 且未配置任何密钥时豁免密钥守卫；云端端点行为完全不变。
     * （此前 callAI / callAIStream 硬性要求 apiKey，导致「本地 Ollama + 空密钥」
     * 这一内置配置下所有非流式 AI 调用都返回「API密钥未配置」，流水线无法运行。）
     */
    private isKeylessLocalEndpoint(endpoint: string): boolean {
        const provider = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint);
        return resolveProviderSourceType({
            id: provider?.id || '',
            endpoint,
            sourceType: provider?.sourceType,
        }) === 'local';
    }

    async callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean }
    ): Promise<APIResponse> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const apiKey = options?.apiKey || this.plugin.settings.apiKey;
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // P0-3: prompt 五元组哈希缓存——命中时跳过 AI 调用（spec p0-api-efficiency-optimization §4.1，决策 D-3/D-6）
        const cacheEnabled = (this.plugin as any).settings?.promptCacheEnabled !== false;
        const promptCache = cacheEnabled ? getPromptCache() : null;
        const cacheKey = promptCache
            ? computePromptHash(systemPrompt, userPrompt, effectiveModel, temperature, maxTokens)
            : '';
        if (promptCache) {
            const cached = promptCache.get(cacheKey);
            if (cached) {
                log.debug('[小说工坊] prompt 缓存命中，跳过 AI 调用');
                return cached;
            }
        }

        const modelMaxOutput = getModelMaxOutput(effectiveModel);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        if (maxTokens > modelMaxOutput) {
            log.debug(`[小说工坊] maxTokens ${maxTokens} > ${effectiveModel} 上限 ${modelMaxOutput}，自动截断为 ${safeMaxTokens}`);
        }

        if (!endpoint) {
            this.notifier.showNotice('❌ 请先配置API端点', NOTICE_ERROR);
            return { content: '', error: 'API端点未配置' };
        }
        if (!apiKey && !this.isKeylessLocalEndpoint(endpoint)) {
            this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
            return { content: '', error: 'API密钥未配置' };
        }

        let lastError: string | undefined;
        const triedModels: string[] = [];

        if (triedModels.length === 0) {
            const providerName = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint)?.name || '自定义';
            log.debug(`[小说工坊] callAI → ${providerName} | ${effectiveModel}`);
        }

        const availableModels = this.plugin.settings.availableModels || [];
        const fallbackEnabled = this.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
        const isWriting = options?.isWritingTask === true;

        const fallbackModels = this.buildFallbackModels(effectiveModel, availableModels, fallbackEnabled);

        for (const currentModel of fallbackModels) {
            const currentMaxOutput = getModelMaxOutput(currentModel);
            const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
            if (maxTokens > currentMaxOutput) {
                log.debug(`[小说工坊] fallback ${currentModel}: maxTokens ${maxTokens} > 上限 ${currentMaxOutput}，截断为 ${currentSafeMaxTokens}`);
            }
            const finalMaxTokens = currentSafeMaxTokens;

            const isSwitch = triedModels.length > 0;

            const effectiveSystemPrompt = isSwitch && isWriting
                ? systemPrompt + this.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                : systemPrompt;

            if (isSwitch) {
                log.info(`[小说工坊] 🔄 模型切换: ${triedModels[triedModels.length - 1]} → ${currentModel}`);
                this.notifier.showNotice(`⚠️ [${triedModels[triedModels.length - 1]}] 断联，切换至 [${currentModel}] 重试...`, NOTICE_CRITICAL);
            }

            triedModels.push(currentModel);

            if (triedModels.length === 1) {
                const budget = calculateTokenBudget(effectiveSystemPrompt, userPrompt, currentModel);
                if (!budget.isSafe) {
                    log.warn(`[小说工坊] ⚠️ Token预算 — ${currentModel}: 输入~${budget.input}, 可用${budget.available}/${budget.contextWindow}`);
                    if (budget.available < 512) {
                        return { content: '', error: `输入过长(~${budget.input}tokens)，超出${currentModel}窗口，请减少上下文` };
                    }
                }
            }

            const maxRetries = this.plugin.settings.maxApiRetries ?? 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                let ac: AbortController | null = null;
                let timer: ReturnType<typeof setTimeout> | null = null;
                // v6.3: 外部 abort（用户连按 Tab）联动内部 abort，真正中断 fetch。
                // 监听必须存活到响应体读完之后（见下方 finally 解绑），否则「生成中取消」
                // 只能中断建连阶段，无法中断正在读取的响应体。
                const onExternalAbort = () => ac?.abort();
                if (externalSignal) {
                    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                }
                try {
                    ac = new AbortController();
                    timer = setTimeout(() => ac!.abort(), getTimeoutForModel(currentModel));

                    const isOllamaNative = endpoint.includes('/api/generate');

                    const requestBody = this.buildRequestBody(
                        isOllamaNative,
                        currentModel,
                        userPrompt,
                        effectiveSystemPrompt,
                        temperature,
                        finalMaxTokens,
                        false
                    );

                    const perfFetchId = performanceMonitor.start('apiFetch', 'apiCall', undefined, {
                        model: currentModel,
                        endpoint: endpoint.substring(0, 50),
                    });
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody),
                        signal: ac.signal
                    });
                    performanceMonitor.end(perfFetchId, { status: response.status });

                    clearTimeout(timer);
                    timer = null;

                    if (response.status === 429) {
                        const rateLimitResult = await this.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                        if (rateLimitResult === 'break') break;
                        continue;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        log.error(`[小说工坊] API响应错误 - 模型: ${currentModel}, 状态码: ${response.status}, 内容:`, errorText);

                        if (this.shouldFallback(null, response.status, fallbackModels.length > triedModels.length)) {
                            lastError = `HTTP ${response.status} (${currentModel}): ${errorText}`;
                            log.info(`[小说工坊] ${currentModel} 断联 (HTTP ${response.status})，尝试下一个模型`);
                            break;
                        }

                        return { content: '', error: `HTTP ${response.status}: ${errorText}` };
                    }

                    const responseText = await response.text();
                    let data: AIApiJsonResponse;
                    try {
                        data = JSON.parse(responseText) as AIApiJsonResponse;
                    } catch (jsonError) {
                        log.error(`[小说工坊] API 返回非 JSON 响应（模型: ${currentModel}）:`, responseText.slice(0, 500));
                        const isHtml = responseText.includes('<html') || responseText.includes('<!DOCTYPE');
                        const isGateway = responseText.includes('502') || responseText.includes('504') || responseText.includes('Bad Gateway');
                        if ((isHtml || isGateway) && fallbackModels.length > triedModels.length) {
                            lastError = `API 返回非 JSON 响应（${currentModel}）`;
                            log.info(`[小说工坊] ${currentModel} 返回非 JSON（疑似服务端错误），尝试下一个模型`);
                            break;
                        }
                        return { content: '', error: `API 返回格式异常：${responseText.slice(0, 200)}` };
                    }
                    // Ollama /api/generate 响应格式转换：{ model, response, done }
                    if (isOllamaNative) {
                        const ollamaContent = data.response;
                        if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
                            data.usage = {
                                prompt_tokens: data.prompt_eval_count || 0,
                                completion_tokens: data.eval_count || 0,
                                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                            };
                        }
                        data.choices = [{ message: { content: ollamaContent || '' } }];
                    }
                    const content = data.choices?.[0]?.message?.content;

                    if (!content) {
                        if (fallbackModels.length > triedModels.length) {
                            lastError = `AI返回为空 (${currentModel})`;
                            log.info(`[小说工坊] ${currentModel} 返回空内容，尝试下一个模型`);
                            break;
                        }
                        return { content: '', error: 'AI返回为空' };
                    }

                    const usage = data.usage ? {
                        prompt: data.usage.prompt_tokens ?? 0,
                        completion: data.usage.completion_tokens ?? 0,
                        total: data.usage.total_tokens ?? 0
                    } : undefined;

                    const contentLen = content.length;
                    const contentPreview = content.slice(0, 200);
                    log.debug(`[小说工坊] API响应: ${currentModel} | ${contentLen}字 | tok=${usage?.total || '?'}`);

                    if (data.usage) {
                        this._sessionTokens.input += data.usage.prompt_tokens || data.usage.input_tokens || 0;
                        this._sessionTokens.output += data.usage.completion_tokens || data.usage.output_tokens || 0;
                    }

                    if (isSwitch) {
                        log.info(`[小说工坊] ✅ 模型切换成功: ${currentModel}`);
                        this.notifier.showNotice(`✅ 已切换至 [${currentModel}] 并成功返回内容`, NOTICE_CRITICAL);
                    }

                    // P0-3: 成功响应写入缓存（error 响应不会走到此分支，天然不污染缓存）
                    if (promptCache) {
                        promptCache.set(cacheKey, { content, usage }, currentModel);
                    }

                    return { content, usage };
                } catch (error: unknown) {
                    // v6.3: 外部取消优先于断联判定——AbortError 在 isDisconnectionError 中同属
                    // 「断联」特征，若先走回退分支，用户取消会被误判为断联并切换到其他模型继续生成。
                    if (externalSignal?.aborted) {
                        return { content: '', error: 'aborted' };
                    }
                    if (this.shouldFallback(error, undefined, fallbackModels.length > triedModels.length)) {
                        lastError = errorMessage(error) || '网络错误';
                        log.info(`[小说工坊] ${currentModel} 网络断联: ${lastError}`);
                        break;
                    }

                    if (attempt < 2) {
                        const base = AI_RETRY_BACKOFF_MS * Math.pow(2, attempt);
                        const backoff = Math.min(base, 30_000);
                        const jitter = Math.random() * backoff * 0.5;
                        await new Promise(r => setTimeout(r, backoff + jitter));
                    } else {
                        lastError = errorMessage(error) || '网络错误';
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
        return { content: '', error: msg };
    }

    async callAIStream(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        onChunk?: (text: string, done: boolean) => void,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean }
    ): Promise<APIResponse> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        const modelMaxOutput = getModelMaxOutput(effectiveModel);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        if (maxTokens > modelMaxOutput) {
            log.debug(`[小说工坊] callAIStream: maxTokens ${maxTokens} > ${effectiveModel} 上限 ${modelMaxOutput}，自动截断为 ${safeMaxTokens}`);
        }
        const finalMaxTokens = safeMaxTokens;

        const maxConcurrent = AIApiClient.getMaxConcurrent(effectiveModel);
        while (AIApiClient.activeStreams >= maxConcurrent) {
            await new Promise(r => setTimeout(r, STREAM_SEMAPHORE_POLL_MS));
        }
        AIApiClient.activeStreams++;
        let semaphoreReleased = false;
        const releaseSemaphore = () => {
            if (!semaphoreReleased) {
                semaphoreReleased = true;
                AIApiClient.activeStreams--;
            }
        };

        try {
            const apiKey = options?.apiKey || this.plugin.settings.apiKey;
            const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;

            if (!endpoint) {
                this.notifier.showNotice('❌ 请先配置API端点', NOTICE_ERROR);
                return { content: '', error: 'API端点未配置' };
            }
            if (!apiKey && !this.isKeylessLocalEndpoint(endpoint)) {
                this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
                return { content: '', error: 'API密钥未配置' };
            }

            const providerName = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint)?.name || '自定义';
            log.debug(`[小说工坊] 🔗 callAIStream → ${providerName} | ${effectiveModel}`);

            const availableModels = this.plugin.settings.availableModels || [];
            const fallbackEnabled = this.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
            const isWriting = options?.isWritingTask === true;

            const fallbackModels = this.buildFallbackModels(effectiveModel, availableModels, fallbackEnabled, !options?.disableFallback);

            let lastError: string | undefined;
            const triedModels: string[] = [];
            let fullContent = '';

            for (const currentModel of fallbackModels) {
                const currentMaxOutput = getModelMaxOutput(currentModel);
                const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
                if (maxTokens > currentMaxOutput) {
                    log.debug(`[小说工坊] callAIStream fallback ${currentModel}: maxTokens ${maxTokens} > 上限 ${currentMaxOutput}，截断为 ${currentSafeMaxTokens}`);
                }
                const finalMaxTokens = currentSafeMaxTokens;

                const isSwitch = triedModels.length > 0;

                const effectiveSystemPrompt = isSwitch && isWriting
                    ? systemPrompt + this.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                    : systemPrompt;

                if (isSwitch) {
                    log.info(`[小说工坊] 🔄 模型切换(流式): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
                    this.notifier.showNotice(`⚠️ [${triedModels[triedModels.length - 1]}] 断联，切换至 [${currentModel}] 重试...`, NOTICE_CRITICAL);
                }

                triedModels.push(currentModel);

                const maxRetries = this.plugin.settings.maxApiRetries ?? 3;
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
                        timer = setTimeout(() => ac!.abort(), getTimeoutForModel(currentModel));

                        const isOllamaNative = endpoint.includes('/api/generate');

                        const streamRequestBody = this.buildRequestBody(
                            isOllamaNative,
                            currentModel,
                            userPrompt,
                            effectiveSystemPrompt,
                            temperature,
                            finalMaxTokens,
                            true
                        );

                        const perfStreamFetchId = performanceMonitor.start('apiFetchStream', 'apiCall', undefined, {
                            model: currentModel,
                            endpoint: endpoint.substring(0, 50),
                        });
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                                'Accept': 'text/event-stream',
                            },
                            body: JSON.stringify(streamRequestBody),
                            signal: ac.signal
                        });
                        performanceMonitor.end(perfStreamFetchId, { status: response.status });

                        clearTimeout(timer);
                        timer = null;

                        if (response.status === 429) {
                            const rateLimitResult = await this.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                            if (rateLimitResult === 'break') break;
                            continue;
                        }

                        if (!response.ok) {
                            const errorText = await response.text();
                            log.error(`[小说工坊] API响应错误(流式) - 模型: ${currentModel}, 状态码: ${response.status}, 内容:`, errorText);

                            if (this.shouldFallback(null, response.status, fallbackModels.length > triedModels.length)) {
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
                        let isStreamDone = false;
                        let streamFinishReason: 'stop' | 'length' | undefined;

                        while (!isStreamDone) {
                            const { done, value } = await reader.read();
                            if (done) break;

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
                                            streamFinishReason = 'stop';
                                            isStreamDone = true;
                                            break;
                                        }
                                    } catch {
                                        log.warn('[小说工坊] Ollama 流式解析警告: 无法解析行:', trimmed.slice(0, 100));
                                    }
                                    continue;
                                }

                                // OpenAI SSE 格式
                                if (trimmed === 'data: [DONE]') {
                                    isStreamDone = true;
                                    break;
                                }

                                if (!trimmed.startsWith('data: ')) {
                                    continue;
                                }

                                const jsonStr = trimmed.slice(6);
                                try {
                                    const parsed = JSON.parse(jsonStr);

                                    const delta = parsed?.choices?.[0]?.delta?.content;
                                    if (delta) {
                                        accumulatedContent += delta;
                                        onChunk?.(accumulatedContent, false);
                                    }

                                    const finReason = parsed?.choices?.[0]?.finish_reason;
                                    if (finReason === 'stop') {
                                        streamFinishReason = 'stop';
                                        isStreamDone = true;
                                        break;
                                    }
                                    if (finReason === 'length') {
                                        streamFinishReason = 'length';
                                        isStreamDone = true;
                                        break;
                                    }
                                } catch {
                                    log.warn('[小说工坊] SSE 解析警告: 无法解析行:', jsonStr.slice(0, 100));
                                }
                            }
                        }

                        fullContent = accumulatedContent;
                        onChunk?.(fullContent, true);

                        if (!fullContent) {
                            if (fallbackModels.length > triedModels.length) {
                                lastError = `AI流式返回为空 (${currentModel})`;
                                log.info(`[小说工坊] ${currentModel} 流式返回空内容，尝试下一个模型`);
                                break;
                            }
                            return { content: '', error: 'AI流式返回为空' };
                        }

                        const data = { content: fullContent, finishReason: streamFinishReason };

                        if (isSwitch) {
                            log.info(`[小说工坊] ✅ 模型切换成功(流式): ${currentModel}`);
                            this.notifier.showNotice(`✅ 已切换至 [${currentModel}] 并成功返回内容`, NOTICE_CRITICAL);
                        }

                        return data;
                    } catch (error: unknown) {
                        // v6.3: 外部取消优先于断联判定（同 callAI，避免取消被误判为断联后切模型）
                        if (externalSignal?.aborted) {
                            return { content: '', error: 'aborted' };
                        }
                        if (this.shouldFallback(error, undefined, fallbackModels.length > triedModels.length)) {
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

    async *callAIAsyncIterator(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; forceSimulated?: boolean }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const externalSignal = options?.signal;

        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        const modelMaxOutput = getModelMaxOutput(effectiveModel);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        const finalMaxTokens = safeMaxTokens;

        let fallbackStage: 'native' | 'simulated' | 'full' | 'done' = options?.forceSimulated ? 'simulated' : 'native';
        let lastError: string | undefined;

        while (fallbackStage !== ('done' as string)) {
            try {
                if (fallbackStage === 'native') {
                    log.debug('[小说工坊] 流式降级: 尝试原生 SSE 流式');
                    const result = yield* this.nativeStreamIterator(
                        systemPrompt, userPrompt, effectiveModel, temperature, finalMaxTokens, options
                    );
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
                    fallbackStage = 'simulated';
                } else if (fallbackStage === 'simulated') {
                    log.debug('[小说工坊] 流式降级: 尝试模拟流式');
                    const result = yield* this.simulatedStreamIterator(
                        systemPrompt, userPrompt, effectiveModel, temperature, finalMaxTokens, options
                    );
                    if (!result.error || result.content) {
                        return result;
                    }
                    // v6.3: 同 native —— 模拟流式遇取消时 callAI 直接返回 aborted，需在此拦截
                    if (externalSignal?.aborted) {
                        return { content: '', error: 'aborted' };
                    }
                    lastError = result.error;
                    log.warn('[小说工坊] 流式降级: 模拟流式失败，切换到完整响应 -', lastError);
                    fallbackStage = 'full';
                } else {
                    log.debug('[小说工坊] 流式降级: 尝试完整响应（非流式）');
                    const result = await this.callAI(
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

    private async *nativeStreamIterator(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const externalSignal = options?.signal;
        const apiKey = options?.apiKey || this.plugin.settings.apiKey;
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        const availableModels = this.plugin.settings.availableModels || [];
        const fallbackEnabled = this.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
        const isWriting = options?.isWritingTask === true;

        const fallbackModels = this.buildFallbackModels(model, availableModels, fallbackEnabled, !options?.disableFallback);

        let lastError: string | undefined;
        const triedModels: string[] = [];

        for (const currentModel of fallbackModels) {
            const currentMaxOutput = getModelMaxOutput(currentModel);
            const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
            const finalMaxTokens = currentSafeMaxTokens;

            const isSwitch = triedModels.length > 0;

            const effectiveSystemPrompt = isSwitch && isWriting
                ? systemPrompt + this.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                : systemPrompt;

            if (isSwitch) {
                log.info(`[小说工坊] 🔄 模型切换(流式迭代器): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
            }

            triedModels.push(currentModel);

            const maxRetries = this.plugin.settings.maxApiRetries ?? 3;
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
                    timer = setTimeout(() => ac!.abort(), getTimeoutForModel(currentModel));

                    const isOllamaNative = endpoint.includes('/api/generate');

                    const streamRequestBody = this.buildRequestBody(
                        isOllamaNative,
                        currentModel,
                        userPrompt,
                        effectiveSystemPrompt,
                        temperature,
                        finalMaxTokens,
                        true
                    );

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'Accept': 'text/event-stream',
                        },
                        body: JSON.stringify(streamRequestBody),
                        signal: ac.signal
                    });

                    clearTimeout(timer);
                    timer = null;

                    if (response.status === 429) {
                        const rateLimitResult = await this.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                        if (rateLimitResult === 'break') break;
                        continue;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        if (this.shouldFallback(null, response.status, fallbackModels.length > triedModels.length)) {
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
                    let isStreamDone = false;
                    let streamFinishReason: 'stop' | 'length' | undefined;

                    while (!isStreamDone) {
                        const { done, value } = await reader.read();
                        if (done) break;

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
                                        yield delta;
                                    }
                                    if (parsed?.done === true) {
                                        streamFinishReason = 'stop';
                                        isStreamDone = true;
                                        break;
                                    }
                                } catch {
                                }
                                continue;
                            }

                            if (trimmed === 'data: [DONE]') {
                                isStreamDone = true;
                                break;
                            }

                            if (!trimmed.startsWith('data: ')) {
                                continue;
                            }

                            const jsonStr = trimmed.slice(6);
                            try {
                                const parsed = JSON.parse(jsonStr);
                                const delta = parsed?.choices?.[0]?.delta?.content;
                                if (delta) {
                                    accumulatedContent += delta;
                                    yield delta;
                                }
                                const finReason = parsed?.choices?.[0]?.finish_reason;
                                if (finReason === 'stop') {
                                    streamFinishReason = 'stop';
                                    isStreamDone = true;
                                    break;
                                }
                                if (finReason === 'length') {
                                    streamFinishReason = 'length';
                                    isStreamDone = true;
                                    break;
                                }
                            } catch {
                            }
                        }
                    }

                    if (!accumulatedContent) {
                        if (fallbackModels.length > triedModels.length) {
                            lastError = `AI流式返回为空 (${currentModel})`;
                            break;
                        }
                        throw new Error('AI流式返回为空');
                    }

                    return { content: accumulatedContent, finishReason: streamFinishReason };
                } catch (error: unknown) {
                    if (externalSignal?.aborted) {
                        if (timer) { clearTimeout(timer); timer = null; }
                        return { content: '', error: 'aborted' };
                    }

                    if (this.shouldFallback(error, undefined, fallbackModels.length > triedModels.length)) {
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

    private async *simulatedStreamIterator(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const response = await this.callAI(systemPrompt, userPrompt, model, temperature, maxTokens, options);

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
}
