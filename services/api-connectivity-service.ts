/**
 * api-connectivity-service.ts — API 配置连通性探测
 *
 * 目标：一键验证「端点可达 + 鉴权可用 + 模型可调用」，而不是只 ping 域名。
 * 使用 Obsidian requestUrl 绕开 CORS；不记录密钥，不把响应正文写入日志。
 */
import { requestUrl } from 'obsidian';
import { createLogger } from '../shared/logger';
import {
    buildAuthHeaders,
    buildChatRequestBody,
    normalizeApiFormat,
    resolveRequestUrl,
    type ApiFormat,
} from '../shared/api-format';

const log = createLogger('ApiConnectivity');

/**
 * 连通性等级。
 */
export type ApiConnectivityLevel = 'ok' | 'warn' | 'error';

/**
 * 连通性状态。
 */
export type ApiConnectivityStatus =
    | 'ok'
    | 'degraded'
    | 'invalid_config'
    | 'auth_failed'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'timeout'
    | 'empty_response'
    | 'unknown_error';

/**
 * 连通性配置。
 */
export interface ApiConnectivityConfig {
    providerName?: string;
    endpoint: string;
    apiKey?: string;
    model: string;
    sourceType?: 'cloud' | 'local';
    /** API 协议格式；缺省按 openai-chat，与运行时保持一致 */
    apiFormat?: ApiFormat;
}

/**
 * 连通性结果。
 */
export interface ApiConnectivityResult {
    level: ApiConnectivityLevel;
    status: ApiConnectivityStatus;
    message: string;
    latencyMs: number;
    httpStatus?: number;
    endpoint: string;
    model: string;
    testedAt: number;
}

/**
 * 探测响应。
 */
export interface ApiProbeResponse {
    status: number;
    text: string;
    json?: unknown;
}

/**
 * 请求函数类型。
 */
export type RequestUrlFn = (options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    throw?: boolean;
}) => Promise<ApiProbeResponse>;

const TIMEOUT_MS = 15_000;
const DEGRADED_LATENCY_MS = 5_000;

/**
 * 规范化 chat 端点 URL。
 *
 * @param endpoint - 参数
 * @returns 端点
 */
export function normalizeChatEndpoint(endpoint: string): string {
    const raw = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    if (/\/chat\/completions$/i.test(raw)) return raw;
    if (/\/api\/chat$/i.test(raw)) return raw;
    if (/\/v1$/i.test(raw)) return `${raw}/chat/completions`;
    if (/\/api\/v3$/i.test(raw)) return `${raw}/chat/completions`;
    return `${raw}/v1/chat/completions`;
}

function isLocalEndpoint(endpoint: string): boolean {
    return /(^https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(endpoint);
}

function shortMessage(text: string, max = 220): string {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseErrorMessage(response: ApiProbeResponse): string {
    try {
        const data = response.json as { error?: { message?: string } | string; message?: string } | undefined;
        if (data) {
            if (typeof data.error === 'string') return data.error;
            if (data.error?.message) return data.error.message;
            if (typeof data.message === 'string') return data.message;
        }
    } catch {
        // 非 JSON 响应，回退到文本
    }
    return shortMessage(response.text || '');
}

function classifyStatus(status: number): { level: ApiConnectivityLevel; status: ApiConnectivityStatus } | null {
    if (status >= 200 && status < 300) return null;
    if (status === 401 || status === 403) return { level: 'error', status: 'auth_failed' };
    if (status === 404) return { level: 'error', status: 'not_found' };
    if (status === 408) return { level: 'error', status: 'timeout' };
    if (status === 429) return { level: 'warn', status: 'rate_limited' };
    if (status >= 500) return { level: 'error', status: 'server_error' };
    return { level: 'error', status: 'unknown_error' };
}

function buildProbeBody(config: ApiConnectivityConfig, endpoint: string, format: ApiFormat): string {
    if (/\/api\/chat$/i.test(endpoint)) {
        return JSON.stringify({
            model: config.model,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            stream: false,
            options: { num_predict: 8, temperature: 0 },
        });
    }
    // Anthropic / Responses 的字段与 Chat Completions 不同，直接复用协议构造器，
    // 避免「格式选对了但连通性测试仍按 OpenAI 发」这种自相矛盾的失败。
    return JSON.stringify(buildChatRequestBody(format, {
        model: config.model,
        systemPrompt: 'You are a connectivity probe.',
        userPrompt: 'Reply with OK.',
        temperature: 0,
        maxTokens: 8,
        stream: false,
    }));
}

function buildHeaders(config: ApiConnectivityConfig, format: ApiFormat): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(format, String(config.apiKey || '')),
    };
}

export async function testProviderConnectivity(
    config: ApiConnectivityConfig,
    request: RequestUrlFn = requestUrl as unknown as RequestUrlFn
): Promise<ApiConnectivityResult> {
    const started = Date.now();
    const testedAt = started;
    const format = normalizeApiFormat(config.apiFormat);
    // Anthropic / Responses 的请求地址与 OpenAI 不同：统一按格式推导，
    // 已写全路径的历史端点由 resolveRequestUrl 原样复用。
    const endpoint = format === 'openai-chat'
        ? normalizeChatEndpoint(config.endpoint)
        : resolveRequestUrl(config.endpoint, format);
    const model = String(config.model || '').trim();
    const base = { endpoint: endpoint || config.endpoint || '', model, testedAt };

    if (!config.endpoint || !endpoint) {
        return { ...base, level: 'error', status: 'invalid_config', message: 'API 端点为空或格式无效', latencyMs: 0 };
    }
    try {
        new URL(endpoint);
    } catch {
        return { ...base, level: 'error', status: 'invalid_config', message: 'API 端点不是合法 URL', latencyMs: 0 };
    }
    if (!model) {
        return { ...base, level: 'error', status: 'invalid_config', message: '未选择模型', latencyMs: 0 };
    }
    const local = config.sourceType === 'local' || isLocalEndpoint(endpoint);
    if (!local && !String(config.apiKey || '').trim()) {
        return { ...base, level: 'error', status: 'auth_failed', message: '缺少 API 密钥', latencyMs: 0 };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });
        const response = await Promise.race([
            request({
                url: endpoint,
                method: 'POST',
                headers: buildHeaders(config, format),
                body: buildProbeBody(config, endpoint, format),
                throw: false,
            }),
            timeout,
        ]);
        const latencyMs = Date.now() - started;

        const classified = classifyStatus(response.status);
        if (classified) {
            const detail = parseErrorMessage(response);
            const label = classified.status === 'auth_failed'
                ? '鉴权失败'
                : classified.status === 'not_found'
                    ? '端点或模型不存在'
                    : classified.status === 'rate_limited'
                        ? '请求被限流'
                        : classified.status === 'server_error'
                            ? '服务端错误'
                            : classified.status === 'timeout'
                                ? '请求超时'
                                : '请求失败';
            log.warn('[ApiConnectivity] probe failed', { status: response.status, classified: classified.status });
            return {
                ...base,
                level: classified.level,
                status: classified.status,
                message: `${label}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
                latencyMs,
                httpStatus: response.status,
            };
        }

        // 部分代理会返回 HTTP 200 + error body，必须识别为失败。
        let hasError = false;
        try {
            const data = response.json as { error?: unknown; choices?: unknown[]; message?: unknown } | undefined;
            hasError = !!data?.error && !Array.isArray(data?.choices);
            if (!hasError && data && !Array.isArray(data.choices) && !data.message) {
                // Ollama /api/chat 返回 message，不要求 choices
                hasError = !/\/api\/chat$/i.test(endpoint);
            }
        } catch {
            // 非 JSON：按空响应处理
        }
        if (hasError) {
            return {
                ...base,
                level: 'error',
                status: 'unknown_error',
                message: `HTTP 200 但返回错误：${parseErrorMessage(response) || '响应格式异常'}`,
                latencyMs,
                httpStatus: response.status,
            };
        }

        if (!String(response.text || '').trim()) {
            return {
                ...base,
                level: 'warn',
                status: 'empty_response',
                message: '端点可达且鉴权通过，但响应为空；请检查模型是否支持该接口',
                latencyMs,
                httpStatus: response.status,
            };
        }

        if (latencyMs > DEGRADED_LATENCY_MS) {
            return {
                ...base,
                level: 'warn',
                status: 'degraded',
                message: `连通正常，但响应较慢（${latencyMs}ms）`,
                latencyMs,
                httpStatus: response.status,
            };
        }

        return {
            ...base,
            level: 'ok',
            status: 'ok',
            message: `连通正常（${latencyMs}ms）`,
            latencyMs,
            httpStatus: response.status,
        };
    } catch (e) {
        const latencyMs = Date.now() - started;
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'timeout') {
            return { ...base, level: 'error', status: 'timeout', message: `请求超时（>${TIMEOUT_MS / 1000}s）`, latencyMs };
        }
        log.warn('[ApiConnectivity] network error', message);
        return {
            ...base,
            level: 'error',
            status: 'network_error',
            message: `网络错误：${shortMessage(message)}`,
            latencyMs,
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
