/**
 * model-discovery.ts — 从端点 URL 拉取可用模型列表
 *
 * 参照 dsh `llm/llm-pi-ai/src/discovery.ts` 的「问端点它提供哪些模型」思路，
 * 适配插件的两套协议：
 *   - OpenAI 系：`GET {root}/models`，Bearer 鉴权，读 `data[]` 或 `models{}`；
 *   - Anthropic：`GET {root}/v1/models?limit=1000`，`x-api-key` + `anthropic-version`，
 *     读 `data[]`（字段为 `id` / `display_name`），`has_more` 不翻页。
 *
 * 设计边界（与 dsh 一致）：
 *   - 只回答「候选」，绝不替用户写配置；用户确认后才保存；
 *   - 响应有体量上限，防止把任意 URL 的响应整个读进内存；
 *   - 失败要给出可读原因（鉴权失败 / 不是模型列表 / 网络不通），而不是静默返回空数组。
 */
import { requestUrl } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { ApiFormat } from '@/shared/api-format';
import { buildAuthHeaders, resolveModelsUrl, resolveModelsUrlCandidates } from '@/shared/api-format';
import { isStoredCiphertext } from '@/shared/secret-value';

const log = createLogger('ModelDiscovery');

/** 响应体上限：模型列表远达不到这个量级，超出说明端点返回了别的东西 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * DiscoveredModel 类型定义。
 */
export interface DiscoveredModel {
    /** 请求时可用的模型 ID */
    id: string;
    /** 人类可读名称，缺省等于 id */
    name?: string;
    /** 端点披露的上下文窗口 */
    contextWindow?: number;
    /** 端点披露的最大输出 */
    maxTokens?: number;
    /** 端点披露支持图片输入（modalities.input 含 image） */
    vision?: boolean;
    /**
     * 端点披露的单价（每百万 tokens）。
     *
     * OpenCode Go / Zen 返回 `cost.text.input.price`（美元/百万）；
     * OpenRouter 返回 `pricing.prompt`（美元/token，会换算成每百万）。
     * 币种随价格一起保存，记账时按汇率折算，避免把美元当人民币。
     */
    pricing?: { inputPerM?: number; outputPerM?: number; currency: 'USD' | 'CNY' };
    /** 端点披露的思考档位（如 low/high/max）；空数组表示支持思考但未分级 */
    reasoningEfforts?: string[];
}

/**
 * DiscoveryResult 类型定义。
 */
export type DiscoveryResult =
    | { kind: 'ok'; models: DiscoveredModel[]; url: string }
    | { kind: 'error'; message: string; url: string };

/**
 * DiscoverRequestUrlFn 类型定义。
 */
export type DiscoverRequestUrlFn = (options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    throw?: boolean;
}) => Promise<{ status: number; text: string; json?: unknown; headers?: Record<string, string> }>;

/**
 * 一个可用的正整数容量字段
 *
  * @returns 数值结果 或 undefined
 */
function capacity(...candidates: unknown[]): number | undefined {
    for (const value of candidates) {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isInteger(n) && n > 0) return n;
    }
    return undefined;
}

function label(...candidates: unknown[]): string | undefined {
    for (const value of candidates) {
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return undefined;
}

/** 模型列表条目（兼容各中转站的扩展字段） */
interface ListingEntry {
    id?: unknown;
    name?: unknown;
    display_name?: unknown;
    displayName?: unknown;
    model?: unknown;
    contextWindow?: unknown;
    context_window?: unknown;
    context_length?: unknown;
    max_input_tokens?: unknown;
    maxOutputTokens?: unknown;
    max_tokens?: unknown;
    max_output_tokens?: unknown;
    maxTokens?: unknown;
    limit?: { context?: unknown; output?: unknown; input?: unknown } | null;
    top_provider?: { max_completion_tokens?: unknown } | null;
    /** OpenRouter：美元/token */
    pricing?: { prompt?: unknown; completion?: unknown } | null;
    /** OpenCode：美元/百万 tokens，形如 { text: { input: { price }, output: { price } } } */
    cost?: { text?: { input?: { price?: unknown } | null; output?: { price?: unknown } | null } | null } | null;
    /** 模态声明：{ input: ['text', 'image/png'] } */
    modalities?: { input?: unknown; output?: unknown } | null;
    /** 能力声明（OpenCode）：{ reasoning: { supported, effort }, vision: { supported } } */
    capabilities?: {
        reasoning?: { supported?: unknown; effort?: unknown } | null;
        vision?: { supported?: unknown } | null;
    } | null;
    /** 部分网关用 input: ['text','image'] 声明模态 */
    input?: unknown;
    /** DeepSeek 官方 /models：输入模态 */
    input_modalities?: unknown;
    /** DeepSeek 官方 /models：思考档位 { supported_levels, default_level } */
    effort?: { supported_levels?: unknown; default_level?: unknown } | null;
}

/**
 * 价格数值归一化：统一成「每百万 tokens」。
 *
 * - OpenCode 直接给每百万价（0.15）；
 * - OpenRouter 给每 token 价（0.00000015），小于 0.01 视为 per-token 并放大。
 *
 * @param value - 原始价格
 * @returns 每百万 tokens 价格；无法解析返回 undefined
 */
function perMillionPrice(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    if (n === 0) return 0;
    return n < 0.01 ? Number((n * 1_000_000).toFixed(6)) : n;
}

/**
 * 从端点条目提取单价（含币种）。
 *
 * @param raw - 条目
 * @returns 单价；未披露返回 undefined
 */
function toPricing(raw: ListingEntry | null): DiscoveredModel['pricing'] | undefined {
    const costInput = raw?.cost?.text?.input?.price;
    const costOutput = raw?.cost?.text?.output?.price;
    if (costInput !== undefined || costOutput !== undefined) {
        return {
            inputPerM: perMillionPrice(costInput),
            outputPerM: perMillionPrice(costOutput),
            currency: 'USD',
        };
    }
    const openRouterInput = raw?.pricing?.prompt;
    const openRouterOutput = raw?.pricing?.completion;
    if (openRouterInput !== undefined || openRouterOutput !== undefined) {
        return {
            inputPerM: perMillionPrice(openRouterInput),
            outputPerM: perMillionPrice(openRouterOutput),
            currency: 'USD',
        };
    }
    return undefined;
}

/**
 * 从端点条目提取「是否支持图片输入」。
 *
 * @param raw - 条目
 * @returns true/false；未披露返回 undefined
 */
function toVision(raw: ListingEntry | null): boolean | undefined {
    const declared = raw?.capabilities?.vision?.supported;
    if (typeof declared === 'boolean') return declared;
    const modalInput = raw?.modalities?.input;
    if (Array.isArray(modalInput)) {
        return modalInput.some(item => typeof item === 'string' && item.toLowerCase().startsWith('image'));
    }
    const legacyInput = raw?.input;
    if (Array.isArray(legacyInput)) {
        return legacyInput.some(item => typeof item === 'string' && item.toLowerCase().startsWith('image'));
    }
    // DeepSeek 官方 /models：input_modalities: ['text','image']
    const declInput = raw?.input_modalities;
    if (Array.isArray(declInput)) {
        return declInput.some(item => typeof item === 'string' && item.toLowerCase().startsWith('image'));
    }
    return undefined;
}

/**
 * 从端点条目提取思考档位。
 *
 * @param raw - 条目
 * @returns 档位列表；不支持思考返回 undefined
 */
function toReasoningEfforts(raw: ListingEntry | null): string[] | undefined {
    const reasoning = raw?.capabilities?.reasoning;
    if (reasoning && reasoning.supported !== false) {
        const effort = reasoning.effort;
        if (Array.isArray(effort)) {
            const levels = effort.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
            return levels.length > 0 ? levels : [];
        }
        if (reasoning.supported === true) return [];
    }
    // DeepSeek 官方 /models：effort: { supported_levels: [...] }（顶层，不在 capabilities 里）
    const deepseekLevels = raw?.effort?.supported_levels;
    if (Array.isArray(deepseekLevels)) {
        const levels = deepseekLevels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        return levels.length > 0 ? levels : [];
    }
    return undefined;
}

/**
 * 从单个条目提取模型
 *
 * @param entry - 条目
 * @param fallbackId - 回退 ID
  * @returns DiscoveredModel 或 null
 */
function toModel(entry: unknown, fallbackId?: string, idFromName = false): DiscoveredModel | null {
    const raw = entry as ListingEntry | null;
    // Ollama /api/tags 的条目用 name 表示请求时使用的模型名（如 qwen2.5:7b）；
    // OpenAI 的 data[] 条目 name 只是展示名，不能当 id，否则畸形条目会被误收。
    const id = label(fallbackId, raw?.id, raw?.model, idFromName ? raw?.name : undefined);
    if (!id) return null;
    const name = label(raw?.name, raw?.display_name, raw?.displayName) ?? id;
    const contextWindow = capacity(
        raw?.contextWindow,
        raw?.context_window,
        raw?.context_length,
        raw?.max_input_tokens,
        raw?.limit?.context,
    );
    const maxTokens = capacity(
        raw?.maxOutputTokens,
        raw?.max_output_tokens,
        raw?.maxTokens,
        raw?.max_tokens,
        raw?.limit?.output,
        raw?.top_provider?.max_completion_tokens,
    );
    const vision = toVision(raw);
    const pricing = toPricing(raw);
    const reasoningEfforts = toReasoningEfforts(raw);
    return {
        id,
        ...(name !== id ? { name } : {}),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(vision === undefined ? {} : { vision }),
        ...(pricing === undefined ? {} : { pricing }),
        ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
    };
}

/**
 * 解析模型列表响应。
 *
 * 支持两种形态：
 *   - 标准 `{ data: [...] }`（OpenAI / Anthropic 官方）；
 *   - 部分网关的 `{ models: { id: {...} } }` 富化映射。
 *
 * 单个条目畸形不影响整体：跳过它，而不是让整个端点看起来没有模型。
 * @param payload - 载荷
 * @returns 结果数组
 */
export function parseModelListing(payload: unknown): DiscoveredModel[] {
    const listing = payload as { data?: unknown; models?: unknown } | null;
    const collected: DiscoveredModel[] = [];
    const seen = new Set<string>();
    const push = (model: DiscoveredModel | null): void => {
        if (!model || seen.has(model.id)) return;
        seen.add(model.id);
        collected.push(model);
    };

    const data = listing?.data;
    if (Array.isArray(data)) {
        for (const entry of data) push(toModel(entry));
        return collected;
    }

    // `data` 不存在时处理 `models`：
    //   - Ollama /api/tags：数组 `[{ name: 'qwen2.5:7b', model: '...' }]`；
    //   - 部分网关：富化映射 `{ id: {...} }`（属性名才是请求可用的 id）。
    const models = listing?.models;
    if (Array.isArray(models)) {
        // Ollama /api/tags：条目只有 name（请求时使用的模型名）
        for (const entry of models) push(toModel(entry, undefined, true));
        return collected;
    }
    if (models && typeof models === 'object') {
        for (const [key, entry] of Object.entries(models as Record<string, unknown>)) {
            if (entry === null || typeof entry !== 'object') continue;
            // 属性名就是请求时可用的 id，条目内 id 只作兜底
            push(toModel(entry, key));
        }
        return collected;
    }

    // Anthropic 与 OpenAI 都用 data；走到这里说明响应结构不对
    throw new Error('响应里既没有 data 数组也没有 models 对象，可能不是模型列表接口');
}

/**
 * 常见 HTTP 状态的用户可读解释
 *
 * @param status - 状态
 * @returns 文本结果
 */
function describeStatus(status: number): string {
    if (status === 401 || status === 403) return `鉴权失败（HTTP ${status}），请检查 API Key`;
    if (status === 404) return `接口不存在（HTTP 404），可能该端点不提供模型列表，或 Base URL 填错`;
    if (status === 429) return `请求被限流（HTTP 429），请稍后再试`;
    if (status >= 500) return `服务端错误（HTTP ${status}）`;
    return `请求失败（HTTP ${status}）`;
}

/**
 * 读取响应文本并做体量约束
 *
 * @param raw - 原始
 * @returns 文本结果
 */
function boundedText(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    if (raw.length > MAX_RESPONSE_BYTES) {
        throw new Error(`响应超过 ${MAX_RESPONSE_BYTES / 1024 / 1024}MB，已中止（端点可能返回了非模型列表内容）`);
    }
    return raw;
}

/**
 * 从端点拉取模型列表。
 *
 * @param endpoint 用户填写的 Base URL（可带 path）
 * @param format   协议格式，决定列表 URL 与鉴权头
 * @param apiKey   API Key；Anthropic 走 x-api-key，其余走 Bearer
 * @param request - 请求
 * @param headers - 渠道请求头（内置适配 + 用户自定义），与真实调用同源
  * @returns DiscoveryResult 实例
 */
export async function discoverModels(
    endpoint: string,
    format: ApiFormat,
    apiKey: string,
    request: DiscoverRequestUrlFn = requestUrl,
    headers?: Record<string, string>,
): Promise<DiscoveryResult> {
    // S3-4（安全 r3）：锁定态密文不得当凭据发送
    if (isStoredCiphertext(apiKey)) {
        return { kind: 'error', message: 'API Key 处于加密锁定状态，请先在设置中解锁口令', url: resolveModelsUrl(endpoint, format) || '' };
    }
    const candidates = resolveModelsUrlCandidates(endpoint, format);
    const url = candidates[0] ?? resolveModelsUrl(endpoint, format);
    if (!url) return { kind: 'error', message: '请先填写 Base URL', url: '' };
    try {
        new URL(url);
    } catch {
        return { kind: 'error', message: 'Base URL 不是合法地址', url };
    }

    let timer: number | undefined;
    try {
        // 各渠道把 /models 挂在不同路径下：按候选序列逐个尝试，
        // 只有 404（路径不对）才继续下一个；401/429/5xx 说明地址已对，直接报原因。
        let response: { status: number; text: string; json?: unknown } | null = null;
        let usedUrl = url;
        let lastStatus = 0;
        for (const candidate of candidates) {
            const attempt = await Promise.race([
                request({
                    url: candidate,
                    method: 'GET',
                    headers: {
                        accept: 'application/json',
                        ...buildAuthHeaders(format, apiKey),
                        ...(headers && typeof headers === 'object' ? headers : {}),
                    },
                    throw: false,
                }),
                new Promise<never>((_, reject) => {
                    timer = window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
                }),
            ]);
            lastStatus = attempt.status;
            if (attempt.status >= 200 && attempt.status < 300) {
                response = attempt;
                usedUrl = candidate;
                break;
            }
            if (attempt.status !== 404) {
                log.warn('[ModelDiscovery] 请求失败', { status: attempt.status, url: candidate });
                return { kind: 'error', message: describeStatus(attempt.status), url: candidate };
            }
            log.info('[ModelDiscovery] 候选地址 404，尝试下一个', { url: candidate });
        }
        if (!response) {
            return { kind: 'error', message: describeStatus(lastStatus || 404), url: usedUrl };
        }

        const text = boundedText(response.text);
        let payload: unknown = response.json;
        if (payload === undefined || payload === null) {
            try {
                payload = JSON.parse(text);
            } catch {
                return { kind: 'error', message: '响应不是 JSON，端点可能不支持模型列表', url };
            }
        }

        const models = parseModelListing(payload);
        if (models.length === 0) {
            return { kind: 'error', message: '端点返回了合法的空列表，请手动填写模型名', url };
        }
        log.info(`[ModelDiscovery] ${url} 返回 ${models.length} 个模型`);
        return { kind: 'ok', models, url };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'timeout') {
            return { kind: 'error', message: `请求超时（>${TIMEOUT_MS / 1000}s）`, url };
        }
        log.warn('[ModelDiscovery] 异常', message);
        return { kind: 'error', message: `无法获取模型列表：${message}`, url };
    } finally {
        if (timer) window.clearTimeout(timer);
    }
}
