/**
 * api-format.ts — API 协议格式（纯函数，可测）
 *
 * 背景（2026-10-29）：设置页此前只有一个「OpenAI 兼容端点」输入框，
 * 运行时也只认 Chat Completions 与 Ollama 原生两种协议。用户接入
 * Anthropic Messages（部分中转站只开这个）或 OpenAI Responses 时只能失败。
 *
 * 这里把「协议」提升为显式配置项：
 *   - 端点在设置页按 **Base URL** 填（可带也可不带 path），请求 URL 由格式推导；
 *   - 请求体、非流式响应、SSE 增量都按格式分派，避免在调用链里散落 if。
 *
 * 约定：存储的 endpoint 保持用户原样，不改写。历史配置存的是完整
 * `/chat/completions` 地址，推导函数要能识别并原样复用。
 */

/** 支持的 API 协议格式 */
export type ApiFormat = 'openai-chat' | 'anthropic-messages' | 'openai-responses';

/**
 * ApiFormatOption 类型定义。
 */
export interface ApiFormatOption {
    value: ApiFormat;
    /** 下拉里显示的短名（不含路径，避免窄面板被截断） */
    label: string;
    /** 协议路径，单独作为说明文字展示 */
    path: string;
    /** 探测模型列表时的相对路径（相对 Base URL 的根） */
    listingHint: string;
}

/**
 * 下拉标签只放协议短名。
 *
 * 旧版把路径塞进 label（`Chat Completions (/chat/completions)`，36 字符），
 * 在窄面板里必然被 `<select>` 截断——实测面板宽 240px 时溢出 38px。
 * 路径改由 `path` 单独展示在提示行，并作为 title 供悬停查看。
 */
export const API_FORMAT_OPTIONS: readonly ApiFormatOption[] = [
    { value: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages', listingHint: '/v1/models' },
    { value: 'openai-chat', label: 'Chat Completions', path: '/chat/completions', listingHint: '/models' },
    { value: 'openai-responses', label: 'Responses', path: '/responses', listingHint: '/models' },
];

const FORMAT_VALUES = new Set<string>(API_FORMAT_OPTIONS.map(option => option.value));

/**
 * 任意输入 → 合法格式；未知/空值回落到 OpenAI Chat Completions
 *
 * @param value - 值
  * @returns ApiFormat 实例
 */
export function normalizeApiFormat(value: unknown): ApiFormat {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (FORMAT_VALUES.has(text)) return text as ApiFormat;
    // 兼容旧字段 apiStyle（'openai' | 'ollama' | 'custom'）
    if (text === 'ollama') return 'openai-chat';
    return 'openai-chat';
}

/**
 * 是否为 Anthropic 协议（请求头与非流式响应结构都不同）
 *
 * @param format - 格式
 * @returns 是否成功
 */
export function isAnthropicFormat(format: ApiFormat): boolean {
    return format === 'anthropic-messages';
}

/**
 * 去掉尾部斜杠
 *
 * @param url - 地址
 * @returns 文本结果
 */
function trimSlash(url: string): string {
    return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 是否为 Ollama 原生端点（`/api/generate` 或 `/api/chat`）。
 *
 * 这两个路径本身就是完整请求地址，不能再补 `/v1/chat/completions`；
 * 模型列表也走 Ollama 自己的 `/api/tags` 而不是 OpenAI 的 `/models`。
 *
 * @param endpoint - 用户填写的 Base URL 或完整端点
 * @returns 是否原生端点
 * @example
 * isNativeOllamaEndpoint('http://localhost:11434/api/generate'); // true
 * isNativeOllamaEndpoint('http://localhost:11434/v1/chat/completions'); // false
 */
export function isNativeOllamaEndpoint(endpoint: string): boolean {
    return /\/api\/(?:generate|chat)$/i.test(trimSlash(endpoint));
}

/**
 * 把 Base URL 规范成「协议根」：
 * 去掉已经写进来的 `/{chat/completions|messages|responses}` 与结尾 `/v1`。
 *
 * 例：
 *   https://api.deepseek.com/anthropic          → https://api.deepseek.com/anthropic
 *   https://api.deepseek.com/anthropic/v1       → https://api.deepseek.com/anthropic
 *   https://api.openai.com/v1/chat/completions  → https://api.openai.com
 * @param endpoint - 接口地址
 * @returns 文本结果
 */
export function resolveApiRoot(endpoint: string): string {
    let root = trimSlash(endpoint);
    if (!root) return '';
    root = root.replace(/\/(?:v1\/)?chat\/completions$/i, '');
    root = root.replace(/\/(?:v1\/)?responses$/i, '');
    root = root.replace(/\/(?:v1\/)?messages$/i, '');
    root = root.replace(/\/api\/chat$/i, '');
    root = root.replace(/\/v1$/i, '');
    return trimSlash(root);
}

/**
 * 把用户填写的端点还原成「API 基址」——保留渠道自己的路径前缀。
 *
 * 这是「从 URL 获取模型」能否工作的关键：很多渠道把 API 挂在子路径下
 * （OpenCode `/zen/v1`、`/inference/go/openai/v1`，SenseNova `/v1`）。
 * 旧实现先剥掉 `/chat/completions` 再剥掉结尾 `/v1`，于是一路退到站点根，
 * 请求 `/models` 直接 404（实测 SenseNova 正确地址 401、错误推导 404）。
 *
 * 规则：
 * - 完整地址（`.../chat/completions`、`.../responses`、`.../messages`）→ 去掉末段协议路径；
 * - 已带版本段的基址（`.../v1`、`.../openai/v1`、`.../api/v3`）→ 原样保留；
 * - 纯站点根 → 原样，由调用方补 `/v1/...`。
 *
 * @param endpoint - 用户填写的端点
 * @returns API 基址
 * @example
 * resolveApiBaseUrl('https://opencode.ai/zen/v1/chat/completions'); // 'https://opencode.ai/zen/v1'
 * resolveApiBaseUrl('https://opencode.ai/inference/go/openai/v1');  // 'https://opencode.ai/inference/go/openai/v1'
 * resolveApiBaseUrl('https://api.deepseek.com');                    // 'https://api.deepseek.com'
 */
export function resolveApiBaseUrl(endpoint: string): string {
    let base = trimSlash(endpoint);
    if (!base) return '';
    // 去掉已写全的协议路径，保留版本段
    base = base.replace(/\/(?:chat\/completions|responses|messages)$/i, '');
    return trimSlash(base);
}

/**
 * 端点是否已经指向某个版本段（`/v1`、`/api/v3`、`/openai/v1` 等）。
 *
 * @param endpoint - 端点或基址
 * @returns 是否已带版本段
 * @example
 * hasVersionSegment('https://x.com/v1');      // true
 * hasVersionSegment('https://x.com');         // false
 */
export function hasVersionSegment(endpoint: string): boolean {
    return /\/(?:v\d+(?:beta\d*)?|api\/v\d+)$/i.test(trimSlash(endpoint));
}

/**
 * 推导实际请求 URL。
 *
 * - openai-chat：端点已指向 chat/completions 或 Ollama `/api/chat` 时原样复用，
 *   否则在根上补 `/v1/chat/completions`；
 * - anthropic-messages：根 + `/v1/messages`；
 * - openai-responses：根 + `/v1/responses`。
 * @param endpoint - 接口地址
 * @param format - 格式
 * @returns 文本结果
 */
export function resolveRequestUrl(endpoint: string, format: ApiFormat): string {
    const raw = trimSlash(endpoint);
    if (!raw) return '';

    if (format === 'openai-chat') {
        // Ollama 原生端点（/api/generate、/api/chat）本身就是完整地址，不能再追加路径
        if (isNativeOllamaEndpoint(raw)) return raw;
        if (/\/chat\/completions$/i.test(raw)) return raw;
        // 已带版本段的基址（/v1、/openai/v1、/zen/v1）保留原样，不能再加一层 /v1
        const base = resolveApiBaseUrl(raw);
        if (!base) return raw;
        return hasVersionSegment(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    }

    const base = resolveApiBaseUrl(raw);
    if (!base) return raw;
    const path = format === 'anthropic-messages' ? '/messages' : '/responses';
    return hasVersionSegment(base) ? `${base}${path}` : `${base}/v1${path}`;
}

/**
 * 计算「实际生效的请求 URL」：用户显式覆盖优先，否则按协议推导。
 *
 * 方案 C：设置页展示推导结果并允许直接改；一旦覆盖就以用户填的为准，
 * 运行时不可再拼接/推导，避免「显示的地址和实际请求的地址不一致」。
 *
 * @param endpoint - Base URL 或完整端点
 * @param format - 协议格式
 * @param override - 用户显式覆盖的完整 URL（空 = 自动推导）
 * @returns 实际请求 URL
 * @example
 * resolveEffectiveRequestUrl('https://a.com', 'openai-chat', undefined);
 * // 'https://a.com/v1/chat/completions'
 * resolveEffectiveRequestUrl('https://a.com', 'openai-chat', 'https://a.com/custom/chat');
 * // 'https://a.com/custom/chat'
 */
export function resolveEffectiveRequestUrl(
    endpoint: string,
    format: ApiFormat,
    override?: string,
): string {
    const explicit = String(override ?? '').trim();
    if (explicit) return explicit;
    return resolveRequestUrl(endpoint, format);
}

/**
 * 推导模型列表 URL（用于「从 URL 获取模型」）。
 *
 * OpenAI 系在根上补 `/models`；Anthropic 用 `/v1/models`（官方同时接受带与不带 /v1
 * 两种写法，这里统一按官方文档口径）。
 * @param endpoint - 接口地址
 * @param format - 格式
 * @returns 文本结果
 */
export function resolveModelsUrl(endpoint: string, format: ApiFormat): string {
    const raw = trimSlash(endpoint);
    if (!raw) return '';
    // Ollama 原生协议没有 /models，模型列表在 /api/tags（返回 { models: [{ name }] }）
    if (isNativeOllamaEndpoint(raw)) {
        try {
            const url = new URL(raw);
            return `${url.origin}/api/tags`;
        } catch {
            return '';
        }
    }
    const candidates = resolveModelsUrlCandidates(raw, format);
    return candidates[0] ?? '';
}

/**
 * 推导模型列表 URL 的候选序列（按优先级）。
 *
 * 各渠道把 `/models` 挂在不同的路径下（DeepSeek 官方是站点根 `/models`，
 * SenseNova/OpenCode 是 `/v1/models`、`/zen/v1/models`）。与其猜一个，
 * 不如按用户填写时体现的意图排序、失败再回退，避免「换个渠道就 404」。
 *
 * @param endpoint - 用户填写的 Base URL 或完整端点
 * @param format - 协议格式
 * @returns 候选 URL（去重；空端点返回空数组）
 * @example
 * resolveModelsUrlCandidates('https://token.sensenova.cn/v1', 'openai-chat');
 * // ['https://token.sensenova.cn/v1/models', 'https://token.sensenova.cn/models']
 */
export function resolveModelsUrlCandidates(endpoint: string, format: ApiFormat): string[] {
    const raw = trimSlash(endpoint);
    if (!raw) return [];
    if (isNativeOllamaEndpoint(raw)) {
        try {
            return [`${new URL(raw).origin}/api/tags`];
        } catch {
            return [];
        }
    }
    const base = resolveApiBaseUrl(raw);
    if (!base) return [];
    const suffix = format === 'anthropic-messages' ? '/models?limit=1000' : '/models';
    const candidates: string[] = [];
    const push = (url: string): void => {
        const trimmed = trimSlash(url.split('?')[0]);
        if (!candidates.some(item => trimSlash(item.split('?')[0]) === trimmed)) candidates.push(url);
    };
    if (hasVersionSegment(base)) {
        push(`${base}${suffix}`);
        const stripped = base.replace(/\/v\d+(?:beta\d*)?$/i, '').replace(/\/api\/v\d+$/i, '');
        if (stripped && stripped !== base) push(`${stripped}${suffix}`);
    } else if (format === 'anthropic-messages') {
        // Anthropic 官方基址不带版本段（https://api.anthropic.com），列表在 /v1/models
        push(`${base}/v1${suffix}`);
        push(`${base}${suffix}`);
    } else {
        push(`${base}${suffix}`);
        push(`${base}/v1${suffix}`);
    }
    return candidates;
}

/**
 * ChatRequestInput 类型定义。
 */
export interface ChatRequestInput {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    maxTokens: number;
    stream: boolean;
    /** Anthropic 思考预算（仅 anthropic-messages 生效） */
    thinkingBudget?: number | undefined;
}

/**
 * 按格式构造请求体。
 * 非 Anthropic 的额外思考参数（reasoning_effort / thinking.type）由调用方补，
 * 这里只保证三套基础骨架正确。
 * @param format - 格式
 * @param input - 输入
 * @returns 映射结果
 */
export function buildChatRequestBody(format: ApiFormat, input: ChatRequestInput): Record<string, unknown> {
    if (format === 'anthropic-messages') {
        const body: Record<string, unknown> = {
            model: input.model,
            system: input.systemPrompt,
            messages: [{ role: 'user', content: input.userPrompt }],
            max_tokens: input.maxTokens,
            temperature: input.temperature,
        };
        if (input.stream) body.stream = true;
        if (input.thinkingBudget && input.thinkingBudget > 0) {
            // Anthropic 要求 budget_tokens < max_tokens，否则直接 400
            const budget = Math.max(1024, Math.min(input.thinkingBudget, Math.max(1024, input.maxTokens - 1)));
            if (budget < input.maxTokens) body.thinking = { type: 'enabled', budget_tokens: budget };
        }
        return body;
    }

    if (format === 'openai-responses') {
        const body: Record<string, unknown> = {
            model: input.model,
            instructions: input.systemPrompt,
            input: input.userPrompt,
            max_output_tokens: input.maxTokens,
            temperature: input.temperature,
        };
        if (input.stream) body.stream = true;
        return body;
    }

    const body: Record<string, unknown> = {
        model: input.model,
        messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
        ],
        max_tokens: input.maxTokens,
        temperature: input.temperature,
    };
    if (input.stream) body.stream = true;
    return body;
}

/**
 * 按格式生成鉴权头（不含 Content-Type）
 *
 * @param format - 格式
 * @param apiKey - API 密钥
 * @returns 映射结果
 */
export function buildAuthHeaders(format: ApiFormat, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const key = String(apiKey || '').trim();
    if (format === 'anthropic-messages') {
        headers['anthropic-version'] = '2023-06-01';
        if (key) headers['x-api-key'] = key;
        return headers;
    }
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
}

/**
 * ParsedChatReply 类型定义。
 */
export interface ParsedChatReply {
    /** 正文文本；无正文时为空串 */
    content: string;
    /** 归一化结束原因：length 表示被输出上限截断 */
    finishReason?: 'stop' | 'length';
    /** 思考增量（只用于判断预算是否被吃掉，不并入正文） */
    reasoning?: string;
}

/**
 * Responses API 的 output 数组里可能有多段 output_text
 *
 * @param payload - 载荷
 * @returns 文本结果
 */
function readResponsesOutput(payload: unknown): string {
    const data = payload as {
        output_text?: unknown;
        output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
    } | null;
    if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
    const parts: string[] = [];
    for (const item of data?.output ?? []) {
        for (const part of item?.content ?? []) {
            if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
        }
    }
    return parts.join('');
}

/**
 * 解析非流式响应
 *
 * @param format - 格式
 * @param payload - 载荷
  * @returns ParsedChatReply 实例
 */
export function parseChatResponse(format: ApiFormat, payload: unknown): ParsedChatReply {
    if (format === 'anthropic-messages') {
        const data = payload as {
            content?: Array<{ type?: string; text?: unknown }>;
            stop_reason?: unknown;
            usage?: { output_tokens?: number };
        } | null;
        const content = (data?.content ?? [])
            .filter(part => part?.type === 'text' && typeof part.text === 'string')
            .map(part => String(part.text))
            .join('');
        const stop = typeof data?.stop_reason === 'string' ? data.stop_reason : '';
        return {
            content,
            finishReason: stop === 'max_tokens' ? 'length' : stop ? 'stop' : undefined,
        };
    }

    if (format === 'openai-responses') {
        const data = payload as {
            status?: unknown;
            incomplete_details?: { reason?: unknown } | null;
        } | null;
        const status = typeof data?.status === 'string' ? data.status : '';
        const incomplete = data?.incomplete_details?.reason === 'max_output_tokens';
        return {
            content: readResponsesOutput(payload),
            finishReason: incomplete ? 'length' : status === 'incomplete' ? 'length' : status ? 'stop' : undefined,
        };
    }

    // OpenAI Chat Completions（含 Ollama 兼容层）
    const data = payload as {
        choices?: Array<{
            message?: { content?: unknown; reasoning_content?: unknown };
            finish_reason?: unknown;
        }>;
    } | null;
    const choice = data?.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const reasoning = typeof choice?.message?.reasoning_content === 'string'
        ? choice.message.reasoning_content
        : '';
    const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
    return {
        content,
        finishReason: finish === 'length' ? 'length' : finish ? 'stop' : undefined,
        ...(reasoning ? { reasoning } : {}),
    };
}

/**
 * SseUpdate 类型定义。
 */
export interface SseUpdate {
    /** 本帧新增正文 */
    delta?: string;
    /** 本帧新增思考内容 */
    reasoning?: string;
    /** 本帧是否为结束帧 */
    done?: boolean;
    /** 结束原因，仅结束帧可能带 */
    finishReason?: 'stop' | 'length';
    /**
     * 协议层错误（DSH-20261113-20）：responses 协议的 error / response.failed
     * 事件不再是「正常结束」——消费方见到此字段必须抛错走重试/回退路径。
     */
    error?: string;
}

/**
 * 从 responses 协议的 error / response.failed 事件中提取人类可读的错误消息。
 *
 * 事件形态有两类：
 *   - `{ type: 'error', code, message }`（顶层 message）
 *   - `{ type: 'response.failed', response: { error: { code, message } } }`
 *
 * 提取不到结构化消息时回落到事件类型本身，绝不返回空串。
 *
 * @param data - 已解析的事件对象
 * @returns 错误消息
 */
function extractResponsesErrorMessage(data: {
    type?: unknown;
    message?: unknown;
    error?: { message?: unknown } | null;
    response?: { error?: { message?: unknown } | null } | null;
}): string {
    const topMessage = typeof data?.message === 'string' && data.message ? data.message : undefined;
    const nestedMessage = typeof data?.response?.error?.message === 'string' && data.response.error.message
        ? data.response.error.message
        : undefined;
    const message = topMessage ?? nestedMessage;
    const type = typeof data?.type === 'string' ? data.type : 'error';
    return message || `${type} 事件（服务端未提供错误详情）`;
}

/**
 * 解析单个 SSE 数据帧。
 *
 * 返回值约定：
 *   - `null` 表示这帧与本协议无关（心跳、ping、未知事件），调用方跳过；
 *   - 空对象 `{}` 表示帧合法但没有正文增量。
 *
 * 传入的是 `data:` 之后的 JSON 文本已解析对象，不负责切行。
 * @param format - 格式
 * @param payload - 载荷
  * @returns SseUpdate 或 null
 */
export function parseSseFrame(format: ApiFormat, payload: unknown): SseUpdate | null {
    if (format === 'anthropic-messages') {
        const data = payload as {
            type?: unknown;
            delta?: { type?: unknown; text?: unknown; stop_reason?: unknown };
        } | null;
        const type = typeof data?.type === 'string' ? data.type : '';
        if (type === 'content_block_delta') {
            const text = data?.delta?.type === 'text_delta' ? data.delta.text : undefined;
            return typeof text === 'string' && text ? { delta: text } : {};
        }
        if (type === 'message_delta') {
            const stop = typeof data?.delta?.stop_reason === 'string' ? data.delta.stop_reason : '';
            if (stop) return { done: true, finishReason: stop === 'max_tokens' ? 'length' : 'stop' };
            return {};
        }
        if (type === 'message_stop') return { done: true, finishReason: 'stop' };
        return null;
    }

    if (format === 'openai-responses') {
        const data = payload as {
            type?: unknown;
            message?: unknown;
            delta?: unknown;
            error?: { message?: unknown } | null;
            response?: {
                status?: unknown;
                incomplete_details?: { reason?: unknown } | null;
                error?: { message?: unknown } | null;
            } | null;
        } | null;
        const type = typeof data?.type === 'string' ? data.type : '';
        if (type === 'response.output_text.delta') {
            const delta = data?.delta;
            return typeof delta === 'string' && delta ? { delta } : {};
        }
        if (type === 'response.completed') return { done: true, finishReason: 'stop' };
        if (type === 'response.incomplete') {
            const truncated = data?.response?.incomplete_details?.reason === 'max_output_tokens';
            return { done: true, finishReason: truncated ? 'length' : 'stop' };
        }
        // DSH-20261113-20：error / response.failed 是协议层失败，不是「正常结束」——
        // 限流/内容审核/服务端错误映射为带 error 的结束帧，消费方必须抛错走重试/回退。
        if (type === 'error' || type === 'response.failed') {
            const message = extractResponsesErrorMessage(data ?? {});
            return { done: true, finishReason: 'stop', error: message };
        }
        return null;
    }

    // OpenAI Chat Completions SSE
    const data = payload as {
        choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown };
            finish_reason?: unknown;
        }>;
    } | null;
    const choice = data?.choices?.[0];
    const update: SseUpdate = {};
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) update.delta = delta;
    const reasoning = choice?.delta?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning) update.reasoning = reasoning;
    const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
    if (finish) {
        update.done = true;
        update.finishReason = finish === 'length' ? 'length' : 'stop';
    }
    return update;
}

/**
 * 判断该格式的流是否以 `data: [DONE]` 收尾。
 * Anthropic 与 Responses 都用语义事件结束，不发 [DONE]。
 * @param format - 格式
 * @returns 是否成功
 */
export function usesDoneSentinel(format: ApiFormat): boolean {
    return format === 'openai-chat';
}
