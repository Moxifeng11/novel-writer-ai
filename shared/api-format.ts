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
        if (/\/chat\/completions$/i.test(raw) || /\/api\/chat$/i.test(raw)) return raw;
        const root = resolveApiRoot(raw);
        return root ? `${root}/v1/chat/completions` : raw;
    }

    const root = resolveApiRoot(raw);
    if (!root) return raw;
    return format === 'anthropic-messages' ? `${root}/v1/messages` : `${root}/v1/responses`;
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
    const root = resolveApiRoot(raw);
    if (!root) return '';
    if (format === 'anthropic-messages') return `${root}/v1/models?limit=1000`;
    return `${root}/models`;
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
            delta?: unknown;
            response?: { status?: unknown; incomplete_details?: { reason?: unknown } | null };
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
        if (type === 'error') return { done: true, finishReason: 'stop' };
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
