/**
 * api-connectivity-service.ts — API 配置连通性探测
 *
 * 目标：一键验证「端点可达 + 鉴权可用 + 模型可调用」，而不是只 ping 域名。
 * 使用 Obsidian requestUrl 绕开 CORS；不记录密钥，不把响应正文写入日志。
 */
import { requestUrl } from 'obsidian';
import { resolveUiMessage, uiMessage } from '@/shared/ui-message';
import { createLogger } from '@/shared/logger';
import { isStoredCiphertext } from '@/shared/secret-value';
import {
    buildAuthHeaders,
    buildChatRequestBody,
    isNativeOllamaEndpoint,
    normalizeApiFormat,
    resolveRequestUrl,
    type ApiFormat,
} from '@/shared/api-format';

const log = createLogger('ApiConnectivity');

/**
 * 连通性等级。
 */

/**
 * 连通性测试的用户可见消息（i18n engine 分层②）。
 *
 * 集中在表里而不是散在 12 个 return 分支：这个函数的返回值会被
 * `ui/onboarding-modal.ts` 直接显示给用户，把文案集中后，
 * 「这个模块对用户说了什么」可以一次读完。
 */
const CONN_MSG = {
    endpointEmpty: uiMessage('engineMsg.conn.endpointEmpty', 'API 端点为空或格式无效'),
    endpointInvalid: uiMessage('engineMsg.conn.endpointInvalid', 'API 端点不是合法 URL'),
    noModel: uiMessage('engineMsg.conn.noModel', '未选择模型'),
    keyLocked: uiMessage('engineMsg.conn.keyLocked', '密钥处于加密锁定状态：请先在页面顶部「输入口令解锁」，再测试连通性'),
    noKey: uiMessage('engineMsg.conn.noKey', '缺少 API 密钥'),
    httpOkButError: uiMessage('engineMsg.conn.httpOkButError', 'HTTP 200 但返回错误：{detail}'),
    formatAbnormal: uiMessage('engineMsg.conn.formatAbnormal', '响应格式异常'),
    emptyResponse: uiMessage('engineMsg.conn.emptyResponse', '端点可达且鉴权通过，但响应为空；请检查模型是否支持该接口'),
    slow: uiMessage('engineMsg.conn.slow', '连通正常，但响应较慢（{ms}ms）'),
    ok: uiMessage('engineMsg.conn.ok', '连通正常（{ms}ms）'),
    timeout: uiMessage('engineMsg.conn.timeout', '请求超时（>{seconds}s）'),
    networkError: uiMessage('engineMsg.conn.networkError', '网络错误：{detail}'),
    httpError: uiMessage('engineMsg.conn.httpError', '{label}（HTTP {status}）：{detail}'),
} as const;

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
    /** 余额/额度不足（402）：与「密钥无效」是两回事，提示要分开 */
    | 'quota_exceeded'
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
    /**
     * 渠道请求头（内置适配 + 用户自定义），与真实调用同源。
     * 缺失会让「测试通过但生成 400」的渠道（如 OpenCode Go 要求 x-opencode-session）测不出来。
     */
    headers?: Record<string, string>;
    /**
     * 用户显式覆盖的「实际请求 URL」（方案 C）。
     *
     * 非空时直接用它发请求，不再按 endpoint + 协议推导，保证「测试的地址 = 生成用的地址」。
     */
    requestUrl?: string;
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
    /** 可执行的下一步建议（例如「Go 订阅请换成 go 端点」），UI 第二行展示 */
    hint?: string;
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
 * @param endpoint - 接口地址
 * @returns 端点
 */
export function normalizeChatEndpoint(endpoint: string): string {
    const raw = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    // Ollama 原生端点本身就是完整地址，不能再补 /v1/chat/completions
    if (isNativeOllamaEndpoint(raw)) return raw;
    if (/\/chat\/completions$/i.test(raw)) return raw;
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
    if (status === 402) return { level: 'error', status: 'quota_exceeded' };
    if (status >= 500) return { level: 'error', status: 'server_error' };
    return { level: 'error', status: 'unknown_error' };
}

/**
 * 按失败类型给出可执行的下一步建议。
 *
 * 渠道语义差异靠这里兜住：同样是 401，可能是密钥没解锁、可能是密钥无效；
 * 同样是 402，可能是余额不足（Zen 按量付费）而不是 Go 订阅失效。
 *
 * @param status - 分类后的状态
 * @param endpoint - 实际请求地址
 * @returns 建议文本；无建议返回 undefined
 * @example
 * suggestFix('quota_exceeded', 'https://opencode.ai/zen/v1/chat/completions');
 * // '余额不足：Zen 是按量付费端点…'
 */
export function suggestFix(status: ApiConnectivityStatus, endpoint: string): string | undefined {
    const url = String(endpoint || '').toLowerCase();
    if (status === 'quota_exceeded') {
        if (url.includes('opencode.ai/zen')) {
            return 'OpenCode Zen 采用按量付费：余额不足会返回 402。若你买的是 Go 订阅，'
                + '请把 Base URL 改成 https://opencode.ai/inference/go/openai/v1 后重试。';
        }
        return '余额/额度不足：请到该渠道控制台充值，或确认订阅是否到期。';
    }
    if (status === 'auth_failed') {
        if (url.includes('opencode.ai/zen')) {
            return 'Zen 与 Go 的 Key/端点不能混用：Go 订阅请用 https://opencode.ai/inference/go/openai/v1。';
        }
        return '请确认 Key 是否有效、是否已过期，以及该 Key 是否属于当前端点对应的账号。';
    }
    if (status === 'rate_limited') {
        return '请求被限流（TPM/RPM）：账号额度用满，稍后重试或到控制台提高限额；'
            + '不是配置错误，也不需要改 Key。';
    }
    if (status === 'not_found') {
        return '检查 Base URL 与 API 格式是否匹配：可展开「实际请求 URL」核对最终地址，路径不对时改成完整地址即可。';
    }
    return undefined;
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
    // Ollama native /api/generate：无 messages，用 prompt；字段与 Chat Completions 不同
    if (/\/api\/generate$/i.test(endpoint)) {
        return JSON.stringify({
            model: config.model,
            prompt: 'Reply with OK.',
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
        // 渠道自定义/内置头放最后：用户显式配置优先于协议默认
        ...(config.headers && typeof config.headers === 'object' ? config.headers : {}),
    };
}

/**
 * testProviderConnectivity 函数。
 * @param config - 配置
 * @param request - 请求
  * @returns ApiConnectivityResult 实例
 */
export async function testProviderConnectivity(
    config: ApiConnectivityConfig,
    request: RequestUrlFn = requestUrl
): Promise<ApiConnectivityResult> {
    const started = Date.now();
    const testedAt = started;
    const format = normalizeApiFormat(config.apiFormat);
    // 方案 C：用户显式填写的实际请求 URL 优先；否则按格式推导
    const explicitUrl = String(config.requestUrl ?? '').trim();
    const endpoint = explicitUrl
        ? explicitUrl
        : format === 'openai-chat'
            ? normalizeChatEndpoint(config.endpoint)
            : resolveRequestUrl(config.endpoint, format);
    const model = String(config.model || '').trim();
    const base = { endpoint: endpoint || config.endpoint || '', model, testedAt };

    if (!config.endpoint || !endpoint) {
        return { ...base, level: 'error', status: 'invalid_config', message: resolveUiMessage(CONN_MSG.endpointEmpty), latencyMs: 0 };
    }
    try {
        new URL(endpoint);
    } catch {
        return { ...base, level: 'error', status: 'invalid_config', message: resolveUiMessage(CONN_MSG.endpointInvalid), latencyMs: 0 };
    }
    if (!model) {
        return { ...base, level: 'error', status: 'invalid_config', message: resolveUiMessage(CONN_MSG.noModel), latencyMs: 0 };
    }
    const local = config.sourceType === 'local' || isLocalEndpoint(endpoint);
    const key = String(config.apiKey || '').trim();
    // S3-4：锁定态密文绝不能当凭据外发。旧实现直接把 `aes256v2:...` 当 Bearer 发出去，
    // 服务端返回 401 "Invalid credential / Forbidden"，把「没解锁」伪装成「密钥错误」，
    // 用户只能瞎猜（实测 OpenCode / SenseNova 都栽在这）。
    if (key && isStoredCiphertext(key)) {
        return {
            ...base,
            level: 'error',
            status: 'auth_failed',
            message: resolveUiMessage(CONN_MSG.keyLocked),
            latencyMs: 0,
        };
    }
    if (!local && !key) {
        return { ...base, level: 'error', status: 'auth_failed', message: resolveUiMessage(CONN_MSG.noKey), latencyMs: 0 };
    }

    let timer: number | undefined;
    try {
        const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
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
                    : classified.status === 'quota_exceeded'
                        ? '余额/额度不足'
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
                hint: suggestFix(classified.status, endpoint),
            };
        }

        // 部分代理会返回 HTTP 200 + error body，必须识别为失败。
        let hasError = false;
        try {
            const data = response.json as {
                error?: unknown;
                choices?: unknown[];
                message?: unknown;
                response?: unknown;
            } | undefined;
            hasError = !!data?.error && !Array.isArray(data?.choices);
            if (!hasError && data && !Array.isArray(data.choices) && !data.message) {
                // Ollama /api/chat 返回 message；/api/generate 返回 response，都不要求 choices
                const ollamaNative = /\/api\/(?:chat|generate)$/i.test(endpoint);
                hasError = !ollamaNative || (typeof data.response !== 'string' && !data.message);
            }
        } catch {
            // 非 JSON：按空响应处理
        }
        if (hasError) {
            return {
                ...base,
                level: 'error',
                status: 'unknown_error',
                message: resolveUiMessage(uiMessage('engineMsg.conn.httpOkButError', 'HTTP 200 但返回错误：{detail}', { detail: parseErrorMessage(response) || resolveUiMessage(CONN_MSG.formatAbnormal) })),
                latencyMs,
                httpStatus: response.status,
            };
        }

        if (!String(response.text || '').trim()) {
            return {
                ...base,
                level: 'warn',
                status: 'empty_response',
                message: resolveUiMessage(CONN_MSG.emptyResponse),
                latencyMs,
                httpStatus: response.status,
            };
        }

        if (latencyMs > DEGRADED_LATENCY_MS) {
            return {
                ...base,
                level: 'warn',
                status: 'degraded',
                message: resolveUiMessage(uiMessage('engineMsg.conn.slow', '连通正常，但响应较慢（{ms}ms）', { ms: latencyMs })),
                latencyMs,
                httpStatus: response.status,
            };
        }

        return {
            ...base,
            level: 'ok',
            status: 'ok',
            message: resolveUiMessage(uiMessage('engineMsg.conn.ok', '连通正常（{ms}ms）', { ms: latencyMs })),
            latencyMs,
            httpStatus: response.status,
        };
    } catch (e) {
        const latencyMs = Date.now() - started;
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'timeout') {
            return { ...base, level: 'error', status: 'timeout', message: resolveUiMessage(uiMessage('engineMsg.conn.timeout', '请求超时（>{seconds}s）', { seconds: TIMEOUT_MS / 1000 })), latencyMs };
        }
        log.warn('[ApiConnectivity] network error', message);
        return {
            ...base,
            level: 'error',
            status: 'network_error',
            message: resolveUiMessage(uiMessage('engineMsg.conn.networkError', '网络错误：{detail}', { detail: shortMessage(message) })),
            latencyMs,
        };
    } finally {
        if (timer) window.clearTimeout(timer);
    }
}
