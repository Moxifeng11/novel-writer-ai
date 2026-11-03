
import type NovelWriterPlugin from '@/main';
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
} from '@/shared/thresholds';
import { calculateTokenBudget, getModelContextWindow, getModelMaxOutput } from '@/shared/token-estimator';
import { resolveProviderSourceType } from '@/shared/model-source';
import type { ThinkingMode } from '@/shared/task-model';
import type { APIResponse } from './ai-engine';

import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
import { performanceMonitor } from '@/services/performance-monitor';
import { ensureLocalModelCapability } from '@/services/local-model-probe';
import { recordBudgetSnapshot } from '@/shared/budget-telemetry';
import {
    buildAuthHeaders,
    buildChatRequestBody,
    normalizeApiFormat,
    parseChatResponse,
    parseSseFrame,
    resolveRequestUrl,
    usesDoneSentinel,
    type ApiFormat,
} from '@/shared/api-format';
import { createLogger } from '@/shared/logger';


const log = createLogger('AiApiClient');
/**
 * 安全提取 Error 的 message，未知类型返回空串
 *
 * @param err - 错误
 * @returns 文本结果
 */
function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
}

/**
 * 认证失败（401/403）专用错误。
 * 单独建模是为了让上层「快速失败」：既不做重试，也不再走模拟流式/完整响应两段降级，
 * 否则同一个失效密钥会被重复发送多次（实测 3 候选 × 3 阶段 × 3 重试 = 15+ 次 401）。
 */
class AIAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AIAuthError';
    }
}

/**
 * 口令未解锁时 crypto.decrypt 会原样返回密文，据此识别「看起来像密钥但其实是密文」
 *
 * @param secret - 密钥
 * @returns 是否成功
 */
function isEncryptedSecret(secret: string): boolean {
    return secret.startsWith('aes256v2:') || secret.startsWith('aes256:');
}

/**
 * 判断错误信息是否属于认证失败（用于降级链短路）
 *
 * @param message - 消息
 * @returns 是否成功
 */
function isAuthErrorMessage(message: string | undefined): boolean {
    if (!message) return false;
    return /HTTP\s+(401|403)\b/.test(message) || message.includes('密钥未解锁');
}

/** API JSON 响应结构 */
interface AIApiJsonResponse {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
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
    done_reason?: string;
}

/**
 * 端点来源判定：本地端点未登记模型时使用更保守的能力兜底。
 * 做成模块函数而非类方法，便于在没有完整插件实例的调用场景（测试/工具）复用。
 * @param endpoint - 接口地址
  * @returns 结果
 */
function resolveEndpointSource(endpoint?: string): 'local' | 'cloud' {
    if (!endpoint) return 'cloud';
    try {
        return resolveProviderSourceType({ id: '', endpoint }) === 'local' ? 'local' : 'cloud';
    } catch {
        return 'cloud';
    }
}

/**
 * AI API 客户端：并发控制、重试、token 统计与流式/非流式调用。
 *
 * @example
 * ```ts
 * const client = new AIApiClient(plugin);
 * const res = await client.callAI('你是资深网文编辑', '润色这段对话……', 'gpt-4o-mini');
 * if (res.error) console.error(res.error);
 * ```
 */
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

    /**
     * 当前最大并发数。
     *
     * @param modelId - 模型 ID
     * @returns 并发数
     */
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

    /**
     * 重置会话 token 计数。
     */
    resetSessionTokens(): void {
        this._sessionTokens = { input: 0, output: 0 };
    }

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
    }

    /**
     * 模型输出上限：优先使用用户在「模型覆盖」里配置的值，再回退静态能力表。
     * 只查静态表会把「deepseek-flash」这类自定义模型误判为默认 4096，
     * 导致长实体补全被静默截断。
     */
    private resolveMaxOutput(model: string, endpoint?: string): number {
        try {
            const limits = this.plugin.resolveModelLimits(model, endpoint);
            if (limits && Number.isFinite(limits.maxOutput) && limits.maxOutput > 0) {
                return limits.maxOutput;
            }
        } catch {
            // 插件未初始化时回退静态表
        }
        return getModelMaxOutput(model, resolveEndpointSource(endpoint));
    }

    /**
     * 上下文窗口同样优先使用用户「模型覆盖」。
     * 预算检查若只查静态表，未登记模型会被误判为 32K，长上下文请求被直接拒绝。
     */
    private resolveMaxContext(model: string, endpoint?: string): number {
        try {
            const limits = this.plugin.resolveModelLimits(model, endpoint);
            if (limits && Number.isFinite(limits.maxContext) && limits.maxContext > 0) {
                return limits.maxContext;
            }
        } catch {
            // 插件未初始化时回退静态表
        }
        return getModelContextWindow(model, resolveEndpointSource(endpoint));
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

    /**
     * 网络层不可达（CORS 被拦、DNS 失败、本地服务未启动）。
     * 这类错误在同一端点上重试、切换模型都不会自愈；实测 mock 端点缺 CORS 头时，
     * 3 候选 × 2 模型 × 3 重试 × 降级链会打出 55 次请求，表现就是「一直卡在调用」。
     */
    private isUnreachableError(error: unknown): boolean {
        const msg = errorMessage(error).toLowerCase();
        return msg.includes('failed to fetch') || msg.includes('fetch failed')
            || msg.includes('econnrefused') || msg.includes('enotfound')
            || msg.includes('networkerror');
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

    /** 构造请求体（统一 Ollama 原生 / OpenAI 兼容 / Anthropic Messages / Responses 四种格式） */
    private buildRequestBody(
        isOllamaNative: boolean,
        model: string,
        userPrompt: string,
        systemPrompt: string,
        temperature: number,
        maxTokens: number,
        stream: boolean,
        numCtx?: number | undefined,
        endpoint?: string,
        thinkingMode?: ThinkingMode,
        thinkingBudget?: number,
        format: ApiFormat = 'openai-chat',
    ): Record<string, unknown> {
        const safeMaxTokens = Math.min(maxTokens, ZAI_MAX_TOKENS);
        if (isOllamaNative) {
            // 未显式指定时按模型画像下发 num_ctx：不传会退回 Ollama 自身的默认窗口
            // （常见 2048/4096），超长 prompt 会被静默截断，表现为「设定丢失」。
            const effectiveNumCtx = numCtx ?? this.resolveMaxContext(model, endpoint);
            const ollamaOptions: Record<string, unknown> = {
                temperature,
                num_predict: safeMaxTokens,
                num_ctx: effectiveNumCtx,
            };
            const body: Record<string, unknown> = {
                model,
                prompt: userPrompt,
                system: systemPrompt,
                stream,
                options: ollamaOptions,
            };
            // Ollama 新版原生 API 支持 think；auto 时不发，交给服务端默认
            if (thinkingMode === 'on' || thinkingMode === 'off') {
                body.think = thinkingMode === 'on';
            }
            return body;
        }

        const thinkingOn = thinkingMode === 'on';
        const body = buildChatRequestBody(format, {
            model,
            systemPrompt,
            userPrompt,
            temperature,
            maxTokens: safeMaxTokens,
            stream,
            thinkingBudget: thinkingOn ? thinkingBudget : undefined,
        });

        // 思考参数只在用户显式开启时下发；auto 交给供应商默认，避免未知端点收到不支持的字段。
        // Anthropic 的 thinking 已由 buildChatRequestBody 按 budget_tokens 规则构造。
        if (thinkingOn && format === 'openai-chat') {
            const thinking = this.buildThinkingPayload(model, endpoint, thinkingBudget);
            if (thinking) Object.assign(body, thinking);
        }
        return body;
    }

    /**
     * 按供应商协议生成思考参数。
     * - OpenAI o 系列：reasoning_effort
     * - 火山/DeepSeek/SenseNova：thinking.type=enabled
     * - 未知供应商：不下发，避免 400
     */
    private buildThinkingPayload(
        model: string,
        endpoint: string | undefined,
        budget: number | undefined,
    ): Record<string, unknown> | null {
        const lowerModel = (model || '').toLowerCase();
        const lowerEndpoint = (endpoint || '').toLowerCase();

        if (/^(o1|o3|o4|gpt-5)/.test(lowerModel)) {
            const amount = budget && budget > 0 ? budget : 0;
            const effort = amount > 8192 ? 'high' : amount > 2048 ? 'medium' : 'low';
            return { reasoning_effort: effort };
        }

        if (lowerEndpoint.includes('volces.com')
            || lowerEndpoint.includes('deepseek.com')
            || lowerEndpoint.includes('sensenova.cn')) {
            const thinking: Record<string, unknown> = { type: 'enabled' };
            if (budget && budget > 0) thinking.budget_tokens = budget;
            return { thinking };
        }

        return null;
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
        return this.isLocalEndpoint(endpoint);
    }

    /** 是否本地推理端点（Ollama / LM Studio / vLLM）：本地模型重试代价高，需要单独的容错策略 */
    private isLocalEndpoint(endpoint: string): boolean {
        const provider = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint);
        return resolveProviderSourceType({
            id: provider?.id || '',
            endpoint,
            sourceType: provider?.sourceType,
        }) === 'local';
    }

    /**
     * 解析端点对应的 API 协议格式。
     * 显式配置优先；旧配置（无 apiFormat）按 openai-chat 处理，保持既有行为。
     */
    private resolveApiFormat(endpoint: string): ApiFormat {
        const provider = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint);
        if (provider?.apiFormat) return normalizeApiFormat(provider.apiFormat);
        // 未登记格式的 Ollama 原生端点仍走 /api/generate，由 normalizeOllamaEndpoint 处理
        return 'openai-chat';
    }

    /**
     * Ollama 的 OpenAI 兼容层（/v1/chat/completions）会丢弃 num_ctx，
     * 导致本地模型按自身默认窗口截断 prompt，超长上下文静默丢失。
     * 内置本地端点统一改写为原生 /api/generate，让 num_ctx 真正生效。
     * 仅匹配 Ollama 默认端口，避免误伤 LM Studio / vLLM 等其它本地服务。
     */
    private normalizeOllamaEndpoint(endpoint: string): string {
        // 只改写 Ollama：LM Studio/vLLM 等本地 OpenAI 兼容服务没有 /api/generate。
        // 识别依据：provider 标记 apiStyle=ollama / id=ollama，或本地 11434 端口。
        // 无 provider 记录的旧配置（直接填 localhost 端点）保留历史改写行为。
        const provider = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint);
        let isOllama = provider?.apiStyle === 'ollama' || provider?.id === 'ollama';
        if (!isOllama) {
            try {
                const url = new URL(endpoint);
                isOllama = url.port === '11434' && this.isLocalEndpoint(endpoint);
                if (!provider && this.isLocalEndpoint(endpoint)) {
                    isOllama = true;
                }
            } catch {
                isOllama = false;
            }
        }
        if (!isOllama) return endpoint;
        return endpoint.replace(/\/v1\/chat\/completions\/?$/i, '/api/generate');
    }

    /**
     * 解析实际请求地址。
     * Ollama 原生端点优先改写（需要 num_ctx）；其余按协议格式推导，
     * 兼容历史配置里已写全路径（…/chat/completions）的情况。
     */
    private resolveRequestEndpoint(endpoint: string, format: ApiFormat): string {
        const ollama = this.normalizeOllamaEndpoint(endpoint);
        if (ollama !== endpoint) return ollama;
        return resolveRequestUrl(endpoint, format);
    }

    /**
     * 请求超时：本地模型（尤其 7B 量化模型 + 长上下文）单次生成常超过 3 分钟，
     * 沿用云端的 120/180s 会在快完成时被中止并触发重试，反而表现为「一直卡住」。
     */
    private resolveTimeout(model: string, endpoint: string): number {
        const base = getTimeoutForModel(model);
        return this.isLocalEndpoint(endpoint) ? Math.max(base, 300_000) : base;
    }

    /** 本地端点只重试 1 次：单次已可能需要数分钟，3 次重试会把等待放大到十几分钟 */
    private resolveMaxRetries(endpoint: string): number {
        return this.isLocalEndpoint(endpoint) ? 1 : (this.plugin.settings.maxApiRetries ?? 3);
    }

    /**
     * 请求前解析真实密钥。
     * 口令未输入/取消时 settings 里保留的是 `aes256…` 密文，直接发给服务端只会得到 401，
     * 并在降级链里重复放大。这里先尝试解密（会复用会话口令，必要时弹一次口令框），
     * 解密失败则返回可读错误，让调用方立即中止。
     */
    private async resolveApiKey(rawKey: string | undefined, allowPrompt = true): Promise<{ key: string; error?: string }> {
        const key = rawKey || '';
        if (!key || !isEncryptedSecret(key)) return { key };

        let decrypted = key;
        try {
            // 后台分析类调用（如情节线解析）不允许弹口令框，未解锁时直接按失败返回
            decrypted = allowPrompt
                ? await this.plugin.decryptKey(key)
                : await this.plugin.decryptKeyWithoutPrompt(key);
        } catch (e) {
            log.warn('[小说工坊] API 密钥解密失败:', e);
        }
        if (isEncryptedSecret(decrypted)) {
            return {
                key: '',
                error: 'API 密钥未解锁：请在口令框中输入加密口令后重试（若已取消，请重新生成建议）',
            };
        }
        return { key: decrypted };
    }

    /**
     * 发起单次非流式调用。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 模型标识
     * @param temperature - 采样温度
     * @param maxTokens - 最大 token 数
     * @param options - 配置项
     * @returns 模型返回文本
     */
    async callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; bypassCache?: boolean; allowKeyPrompt?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): Promise<APIResponse> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        let apiKey = options?.apiKey || this.plugin.settings.apiKey;
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        // 协议格式决定请求路径/头/解析；Ollama 原生端点由 normalizeOllamaEndpoint 单独改写
        const apiFormat = this.resolveApiFormat(endpoint);
        // 本地 Ollama 的 /v1 兼容层不接收 num_ctx，请求前统一改写为原生端点
        const requestEndpoint = this.resolveRequestEndpoint(endpoint, apiFormat);
        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // P0-3: prompt 五元组哈希缓存——命中时跳过 AI 调用（spec p0-api-efficiency-optimization §4.1，决策 D-3/D-6）
        // 创意类调用（随机构思 / 文笔预设）必须显式 bypassCache，否则相同提示词会永远返回同一结果。
        const cacheEnabled = (this.plugin as any).settings?.promptCacheEnabled !== false && options?.bypassCache !== true;
        const promptCache = cacheEnabled ? getPromptCache() : null;
        const cacheScope = `${endpoint}|${options?.thinkingMode || ''}|${options?.thinkingBudget || 0}`;
        const cacheKey = promptCache
            ? computePromptHash(systemPrompt, userPrompt, effectiveModel, temperature, maxTokens, cacheScope)
            : '';
        if (promptCache) {
            const cached = promptCache.get(cacheKey);
            if (cached) {
                log.debug('[小说工坊] prompt 缓存命中，跳过 AI 调用');
                return cached;
            }
        }

        // 本地未登记模型：首次调用前读取 Ollama /api/show 的真实上下文窗口
        if (endpoint && this.isLocalEndpoint(endpoint)) {
            await ensureLocalModelCapability(endpoint, effectiveModel);
        }

        const modelMaxOutput = this.resolveMaxOutput(effectiveModel, endpoint);
        const safeMaxTokens = Math.min(maxTokens, modelMaxOutput);
        if (maxTokens > modelMaxOutput) {
            log.debug(`[小说工坊] maxTokens ${maxTokens} > ${effectiveModel} 上限 ${modelMaxOutput}，自动截断为 ${safeMaxTokens}`);
        }

        if (!endpoint) {
            this.notifier.showNotice('❌ 请先配置API端点', NOTICE_ERROR);
            return { content: '', error: 'API端点未配置' };
        }
        // 本地 Ollama 无需密钥：跳过解析，避免误报「密钥解密失败」并触发无谓的口令流程
        const keylessEndpoint = this.isKeylessLocalEndpoint(endpoint);
        if (!apiKey && !keylessEndpoint) {
            this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
            return { content: '', error: 'API密钥未配置' };
        }

        // 密文密钥前置解析：解密失败直接返回可读错误，避免把密文当 Bearer token 发出去
        if (!keylessEndpoint) {
            const resolvedKey = await this.resolveApiKey(apiKey, options?.allowKeyPrompt !== false);
            if (resolvedKey.error) {
                this.notifier.showNotice(`🔒 ${resolvedKey.error}`, NOTICE_ERROR);
                return { content: '', error: resolvedKey.error };
            }
            apiKey = resolvedKey.key;
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
            const currentMaxOutput = this.resolveMaxOutput(currentModel, endpoint);
            const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
            if (maxTokens > currentMaxOutput) {
                log.debug(`[小说工坊] fallback ${currentModel}: maxTokens ${maxTokens} > 上限 ${currentMaxOutput}，截断为 ${currentSafeMaxTokens}`);
            }
            const finalMaxTokens = currentSafeMaxTokens;
            // finish_reason=length 时在模型上限内自动扩容重试一次，避免 4096 静态预算白丢一次生成
            let attemptMaxTokens = finalMaxTokens;
            let expandedForTruncation = false;
            // 思考型模型偶尔把预算全花在 reasoning 上、正文为空但 finish_reason=stop；
            // 这种请求重试同模型（关闭思考）比直接切模型更可能救回来（真实链路实测）。
            let thinkingRetryUsed = false;
            let thinkingExtraAttempts = 0;
            let attemptThinkingMode = options?.thinkingMode;

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
                const budget = calculateTokenBudget(effectiveSystemPrompt, userPrompt, currentModel, {
                    maxContext: this.resolveMaxContext(currentModel, endpoint),
                    maxOutput: currentMaxOutput,
                });
                recordBudgetSnapshot({
                    source: 'api',
                    model: currentModel,
                    inputTokens: budget.input,
                    availableTokens: budget.available,
                    contextWindow: budget.contextWindow,
                    maxOutput: currentMaxOutput,
                    overBudget: !budget.isSafe,
                });
                if (!budget.isSafe) {
                    log.warn(`[小说工坊] ⚠️ Token预算 — ${currentModel}: 输入~${budget.input}, 可用${budget.available}/${budget.contextWindow}`);
                    if (budget.available < 512) {
                        return { content: '', error: `输入过长(~${budget.input}tokens)，超出${currentModel}窗口，请减少上下文` };
                    }
                }
            }

            const maxRetries = this.resolveMaxRetries(endpoint);
            // 本地端点只重试 1 次，但截断扩容不应被重试上限吃掉：单独放宽 1 次
            let truncationExtraAttempts = 0;
            for (let attempt = 0; attempt < maxRetries + truncationExtraAttempts + thinkingExtraAttempts; attempt++) {
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
                    timer = setTimeout(() => ac!.abort(), this.resolveTimeout(currentModel, endpoint));

                    const isOllamaNative = requestEndpoint.includes('/api/generate');

                    const requestBody = this.buildRequestBody(
                        isOllamaNative,
                        currentModel,
                        userPrompt,
                        effectiveSystemPrompt,
                        temperature,
                        attemptMaxTokens,
                        false,
                        options?.numCtx,
                        endpoint,
                        attemptThinkingMode,
                        options?.thinkingBudget,
                        apiFormat,
                    );

                    const perfFetchId = performanceMonitor.start('apiFetch', 'apiCall', undefined, {
                        model: currentModel,
                        endpoint: endpoint.substring(0, 50),
                    });
                    const response = await fetch(requestEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...buildAuthHeaders(apiFormat, apiKey),
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

                        // 401/403 属于配置问题，重试和切换模型都不会自愈，直接快速失败
                        if (response.status === 401 || response.status === 403) {
                            const authError = `API 密钥无效或无权限 (HTTP ${response.status})：${errorText}`;
                            this.notifier.showNotice('🔒 API 密钥无效或无权限，请检查设置中的密钥', NOTICE_ERROR);
                            return { content: '', error: authError };
                        }

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
                    // 只有携带 response 字段时才走原生化转换，避免把兼容层返回的
                    // OpenAI 结构误清空。
                    if (isOllamaNative && data.response !== undefined) {
                        const ollamaContent = data.response;
                        if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
                            data.usage = {
                                prompt_tokens: data.prompt_eval_count || 0,
                                completion_tokens: data.eval_count || 0,
                                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                            };
                        }
                        // done_reason=length 是 Ollama 原生唯一可靠的截断信号，
                        // 丢弃它会让下游把「被截断」误判成「正常结束」。
                        data.choices = [{
                            message: { content: ollamaContent || '' },
                            finish_reason: data.done_reason === 'length' ? 'length' : 'stop',
                        }];
                    } else if (apiFormat !== 'openai-chat') {
                        // Anthropic Messages / Responses 的结构与 Chat Completions 完全不同，
                        // 统一归一到 choices[0].message.content，下游截断/用量逻辑无需分叉。
                        const parsed = parseChatResponse(apiFormat, data);
                        const usage = (data as { usage?: Record<string, unknown> }).usage;
                        if (usage) {
                            const inputTokens = Number(usage['input_tokens'] ?? usage['input_tokens_count'] ?? 0) || 0;
                            const outputTokens = Number(usage['output_tokens'] ?? 0) || 0;
                            if (inputTokens || outputTokens) {
                                data.usage = {
                                    prompt_tokens: inputTokens,
                                    completion_tokens: outputTokens,
                                    total_tokens: inputTokens + outputTokens,
                                };
                            }
                        }
                        data.choices = [{
                            message: { content: parsed.content },
                            finish_reason: parsed.finishReason === 'length' ? 'length' : 'stop',
                        }];
                    }
                    const content = data.choices?.[0]?.message?.content;
                    // 截断检测：finish_reason=length 说明本次输出被 max_tokens 截断。
                    // 思考型模型（deepseek 系 flash/pro）的思考与正文共用同一预算，
                    // 思考占满时 content 会直接为空——旧实现先判空再判截断，于是
                    // 「预算不足」被误报成「AI返回为空」，重试/切模型都不会自愈。
                    const finishReason = data.choices?.[0]?.finish_reason;
                    const isLengthTruncated = finishReason === 'length' || finishReason === 'max_tokens';
                    if (isLengthTruncated && !expandedForTruncation && attemptMaxTokens < currentMaxOutput) {
                        const nextMaxTokens = Math.min(
                            currentMaxOutput,
                            Math.max(attemptMaxTokens * 2, 8192)
                        );
                        if (nextMaxTokens > attemptMaxTokens) {
                            expandedForTruncation = true;
                            truncationExtraAttempts = 1;
                            log.info(`[小说工坊] ${currentModel} 输出被截断（finish_reason=length${content ? '' : '，正文为空'}），max_tokens ${attemptMaxTokens} → ${nextMaxTokens} 重试`);
                            attemptMaxTokens = nextMaxTokens;
                            continue;
                        }
                    }

                    if (!content) {
                        // 空正文 + 正常结束 + 思考开启：先关思考重试一次（不占用模型切换名额）
                        if (!isLengthTruncated && !thinkingRetryUsed && attemptThinkingMode === 'on') {
                            thinkingRetryUsed = true;
                            thinkingExtraAttempts = 1;
                            attemptThinkingMode = 'off';
                            log.info(`[小说工坊] ${currentModel} 返回空正文（finish_reason=stop，疑似思考占满预算），关闭思考重试一次`);
                            continue;
                        }
                        if (fallbackModels.length > triedModels.length) {
                            lastError = `AI返回为空 (${currentModel})`;
                            log.info(`[小说工坊] ${currentModel} 返回空内容，尝试下一个模型`);
                            break;
                        }
                        return {
                            content: '',
                            error: isLengthTruncated
                                ? `模型输出被 max_tokens=${attemptMaxTokens} 截断且未产出正文（思考占满预算），请提高模型输出上限`
                                : 'AI返回为空',
                        };
                    }

                    if (isLengthTruncated) {
                        log.warn(`[小说工坊] ${currentModel} 输出仍被截断（已达 max_tokens=${attemptMaxTokens}），请提高模型上限或精简提示词`);
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
                        promptCache.set(cacheKey, { content, usage, finishReason: isLengthTruncated ? 'length' : 'stop' }, currentModel);
                    }

                    return { content, usage, finishReason: isLengthTruncated ? 'length' : 'stop' };
                } catch (error: unknown) {
                    // v6.3: 外部取消优先于断联判定——AbortError 在 isDisconnectionError 中同属
                    // 「断联」特征，若先走回退分支，用户取消会被误判为断联并切换到其他模型继续生成。
                    if (externalSignal?.aborted) {
                        return { content: '', error: 'aborted' };
                    }
                    if (this.isUnreachableError(error)) {
                        const msg = errorMessage(error) || '网络不可达';
                        log.error(`[小说工坊] ${endpoint} 无法连接，停止重试: ${msg}`);
                        return { content: '', error: `无法连接模型服务（${endpoint}）：${msg}` };
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

    /**
     * 发起流式调用并按块回调。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 模型标识
     * @param temperature - 采样温度
     * @param maxTokens - 最大 token 数
     * @param onChunk - 流式分片回调
     * @param options - 调用选项（端点、密钥、思考模式等）
     * @returns 完整文本
     */
    async callAIStream(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        onChunk?: (text: string, done: boolean) => void,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; allowKeyPrompt?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): Promise<APIResponse> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // 本地未登记模型：流式调用同样先探测真实上下文窗口
        if (endpoint && this.isLocalEndpoint(endpoint)) {
            await ensureLocalModelCapability(endpoint, effectiveModel);
        }

        const modelMaxOutput = this.resolveMaxOutput(effectiveModel, endpoint);
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
            const apiFormat = this.resolveApiFormat(endpoint);
            const requestEndpoint = this.resolveRequestEndpoint(endpoint, apiFormat);

            if (!endpoint) {
                this.notifier.showNotice('❌ 请先配置API端点', NOTICE_ERROR);
                return { content: '', error: 'API端点未配置' };
            }
            if (!apiKey && !this.isKeylessLocalEndpoint(endpoint)) {
                this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
                return { content: '', error: 'API密钥未配置' };
            }

            const resolvedKey = await this.resolveApiKey(apiKey, options?.allowKeyPrompt !== false);
            if (resolvedKey.error) {
                this.notifier.showNotice(`🔒 ${resolvedKey.error}`, NOTICE_ERROR);
                return { content: '', error: resolvedKey.error };
            }
            options = { ...(options || {}), apiKey: resolvedKey.key };

            const providerName = this.plugin.settings.customProviders?.find(p => p.endpoint === endpoint)?.name || '自定义';
            log.debug(`[小说工坊] 🔗 callAIStream → ${providerName} | ${effectiveModel}`);

            const availableModels = this.plugin.settings.availableModels || [];
            const fallbackEnabled = this.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
            const isWriting = options?.isWritingTask === true;

            const fallbackModels = this.buildFallbackModels(effectiveModel, availableModels, fallbackEnabled, !options?.disableFallback);

            let lastError: string | undefined;
            const triedModels: string[] = [];
            let fullContent = '';

            // 流式路径此前没有输入预算闸门：超长 prompt 会原样发给本地小窗口模型，
            // 被静默截断后表现为「设定丢失」。与非流式 callAI 保持同一判定口径。
            const streamBudgetModel = fallbackModels[0];
            const streamBudget = calculateTokenBudget(systemPrompt, userPrompt, streamBudgetModel, {
                maxContext: this.resolveMaxContext(streamBudgetModel, endpoint),
                maxOutput: this.resolveMaxOutput(streamBudgetModel, endpoint),
            });
            recordBudgetSnapshot({
                source: 'api',
                model: streamBudgetModel,
                inputTokens: streamBudget.input,
                availableTokens: streamBudget.available,
                contextWindow: streamBudget.contextWindow,
                maxOutput: this.resolveMaxOutput(streamBudgetModel, endpoint),
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
                const currentMaxOutput = this.resolveMaxOutput(currentModel, endpoint);
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
                    ? systemPrompt + this.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                    : systemPrompt;

                if (isSwitch) {
                    log.info(`[小说工坊] 🔄 模型切换(流式): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
                    this.notifier.showNotice(`⚠️ [${triedModels[triedModels.length - 1]}] 断联，切换至 [${currentModel}] 重试...`, NOTICE_CRITICAL);
                }

                triedModels.push(currentModel);

                const maxRetries = this.resolveMaxRetries(endpoint);
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
                        timer = setTimeout(() => ac!.abort(), this.resolveTimeout(currentModel, endpoint));

                        const isOllamaNative = requestEndpoint.includes('/api/generate');

                        const streamRequestBody = this.buildRequestBody(
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
                        const response = await fetch(requestEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...buildAuthHeaders(apiFormat, apiKey),
                                'Accept': 'text/event-stream',
                            },
                            body: JSON.stringify(streamRequestBody),
                            signal: ac.signal
                        });
                        performanceMonitor.end(perfStreamFetchId, { status: response.status });

                        // 同 nativeStreamIterator：头部到达后保留空闲超时看门狗，避免读流永久挂起
                        const armIdleTimer = () => {
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(() => ac?.abort(), this.resolveTimeout(currentModel, endpoint));
                        };
                        armIdleTimer();

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
                        // 思考型模型的 reasoning_content 与 nativeStreamIterator 同处理：只统计不并入正文
                        let accumulatedReasoning = '';
                        let isStreamDone = false;
                        let streamFinishReason: 'stop' | 'length' | undefined;

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
                            this.notifier.showNotice(`✅ 已切换至 [${currentModel}] 并成功返回内容`, NOTICE_CRITICAL);
                        }

                        return data;
                    } catch (error: unknown) {
                        // v6.3: 外部取消优先于断联判定（同 callAI，避免取消被误判为断联后切模型）
                        if (externalSignal?.aborted) {
                            return { content: '', error: 'aborted' };
                        }
                        if (this.isUnreachableError(error)) {
                            const msg = errorMessage(error) || '网络不可达';
                            log.error(`[小说工坊] ${endpoint} 无法连接，停止重试(流式): ${msg}`);
                            return { content: '', error: `无法连接模型服务（${endpoint}）：${msg}` };
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

    /**
     * 发起流式调用并返回异步迭代器。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 模型标识
     * @param temperature - 采样温度
     * @param maxTokens - 最大 token 数
     * @param options - 调用选项
     * @returns 逐块产出文本，最终返回完整响应
     */
    async *callAIAsyncIterator(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; forceSimulated?: boolean; allowKeyPrompt?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const effectiveModel = model || this.plugin.settings.defaultModel || 'gpt-3.5-turbo';
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        const apiFormat = this.resolveApiFormat(endpoint);
        const requestEndpoint = this.resolveRequestEndpoint(endpoint, apiFormat);
        const externalSignal = options?.signal;

        if (externalSignal?.aborted) {
            return { content: '', error: 'aborted' };
        }

        // 密文密钥前置解析（同 callAI）：未解锁就不进入流式降级链，避免重复 401。
        // 本地 Ollama 无需密钥，直接跳过，避免误报解密失败。
        const keylessEndpoint = !!endpoint && this.isKeylessLocalEndpoint(endpoint);
        if (!keylessEndpoint) {
            const rawKey = options?.apiKey || this.plugin.settings.apiKey;
            const resolvedKey = await this.resolveApiKey(rawKey, options?.allowKeyPrompt !== false);
            if (resolvedKey.error) {
                this.notifier.showNotice(`🔒 ${resolvedKey.error}`, NOTICE_ERROR);
                return { content: '', error: resolvedKey.error };
            }
            if (resolvedKey.key !== rawKey) {
                options = { ...(options || {}), apiKey: resolvedKey.key };
            }
        }

        const modelMaxOutput = this.resolveMaxOutput(effectiveModel);
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
                    // 认证失败换阶段也不会成功，且会重复发送无效密钥，直接终止降级链
                    if (isAuthErrorMessage(lastError)) {
                        return { content: '', error: lastError };
                    }
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
                    if (isAuthErrorMessage(lastError)) {
                        return { content: '', error: lastError };
                    }
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

                if (error instanceof AIAuthError || isAuthErrorMessage(errMsg)) {
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

    private async *nativeStreamIterator(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; numCtx?: number; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const externalSignal = options?.signal;
        const apiKey = options?.apiKey || this.plugin.settings.apiKey;
        const endpoint = options?.endpoint || this.plugin.settings.apiEndpoint;
        const apiFormat = this.resolveApiFormat(endpoint);
        const requestEndpoint = this.resolveRequestEndpoint(endpoint, apiFormat);
        const availableModels = this.plugin.settings.availableModels || [];
        const fallbackEnabled = this.plugin.settings.enableAutoModelFallback !== false && options?.disableFallback !== true;
        const isWriting = options?.isWritingTask === true;

        const fallbackModels = this.buildFallbackModels(model, availableModels, fallbackEnabled, !options?.disableFallback);

        // 与 callAIStream 共用同一输入预算口径，避免本地小窗口被静默截断
        const iteratorBudgetModel = fallbackModels[0];
        const iteratorBudget = calculateTokenBudget(systemPrompt, userPrompt, iteratorBudgetModel, {
            maxContext: this.resolveMaxContext(iteratorBudgetModel, endpoint),
            maxOutput: this.resolveMaxOutput(iteratorBudgetModel, endpoint),
        });
        recordBudgetSnapshot({
            source: 'api',
            model: iteratorBudgetModel,
            inputTokens: iteratorBudget.input,
            availableTokens: iteratorBudget.available,
            contextWindow: iteratorBudget.contextWindow,
            maxOutput: this.resolveMaxOutput(iteratorBudgetModel, endpoint),
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
            const currentMaxOutput = this.resolveMaxOutput(currentModel, endpoint);
            const currentSafeMaxTokens = Math.min(maxTokens, currentMaxOutput);
            // finish_reason=length 且正文为空时，在模型上限内扩容重试一次：
            // 思考型模型（deepseek-flash / r1）的思考与正文共用预算，思考占满时正文为空。
            let attemptMaxTokens = currentSafeMaxTokens;
            let expandedForTruncation = false;

            const isSwitch = triedModels.length > 0;

            const effectiveSystemPrompt = isSwitch && isWriting
                ? systemPrompt + this.getContinuityGuard(triedModels[triedModels.length - 1], currentModel)
                : systemPrompt;

            if (isSwitch) {
                log.info(`[小说工坊] 🔄 模型切换(流式迭代器): ${triedModels[triedModels.length - 1]} → ${currentModel}`);
            }

            triedModels.push(currentModel);

            const maxRetries = this.resolveMaxRetries(endpoint);
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
                    timer = setTimeout(() => ac!.abort(), this.resolveTimeout(currentModel, endpoint));

                    const isOllamaNative = requestEndpoint.includes('/api/generate');

                    const streamRequestBody = this.buildRequestBody(
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

                    const response = await fetch(requestEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...buildAuthHeaders(apiFormat, apiKey),
                            'Accept': 'text/event-stream',
                        },
                        body: JSON.stringify(streamRequestBody),
                        signal: ac.signal
                    });

                    // 响应头到达后不清除计时器，改为「空闲超时」看门狗：
                    // 旧实现头部一到就 clearTimeout，若服务端保持连接却不再产出，
                    // reader.read() 会永久挂起（本地 Ollama 排队/卡死时表现为一直「生成中」）。
                    const armIdleTimer = () => {
                        if (timer) clearTimeout(timer);
                        timer = setTimeout(() => ac?.abort(), this.resolveTimeout(currentModel, endpoint));
                    };
                    armIdleTimer();

                    if (response.status === 429) {
                        const rateLimitResult = await this.handleRateLimit(currentModel, fallbackModels.length > triedModels.length);
                        if (rateLimitResult === 'break') break;
                        continue;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        if (response.status === 401 || response.status === 403) {
                            // 认证失败：不重试、不换模型、不降级，直接抛给上层显示
                            throw new AIAuthError(`API 密钥无效或无权限 (HTTP ${response.status})：${errorText}`);
                        }
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
                    // 思考型模型的 reasoning_content：不算正文，但要记录是否发生了思考，
                    // 用于区分「模型什么都没说」和「思考把预算吃光了」。
                    let accumulatedReasoning = '';
                    let isStreamDone = false;
                    let streamFinishReason: 'stop' | 'length' | undefined;

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

                                if (update.delta) {
                                    accumulatedContent += update.delta;
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

                    // 认证失败不进入重试（重试只会重复 401）
                    if (error instanceof AIAuthError) {
                        throw error;
                    }

                    if (this.isUnreachableError(error)) {
                        const msg = errorMessage(error) || '网络不可达';
                        log.error(`[小说工坊] ${endpoint} 无法连接，停止重试(原生流): ${msg}`);
                        return { content: '', error: `无法连接模型服务（${endpoint}）：${msg}` };
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
