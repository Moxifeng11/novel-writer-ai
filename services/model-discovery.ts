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
import { createLogger } from '../shared/logger';
import type { ApiFormat } from '../shared/api-format';
import { buildAuthHeaders, resolveModelsUrl } from '../shared/api-format';

const log = createLogger('ModelDiscovery');

/** 响应体上限：模型列表远达不到这个量级，超出说明端点返回了别的东西 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export interface DiscoveredModel {
    /** 请求时可用的模型 ID */
    id: string;
    /** 人类可读名称，缺省等于 id */
    name?: string;
    /** 端点披露的上下文窗口 */
    contextWindow?: number;
    /** 端点披露的最大输出 */
    maxTokens?: number;
}

export type DiscoveryResult =
    | { kind: 'ok'; models: DiscoveredModel[]; url: string }
    | { kind: 'error'; message: string; url: string };

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
    limit?: { context?: unknown; output?: unknown } | null;
    top_provider?: { max_completion_tokens?: unknown } | null;
}

/**
 * 从单个条目提取模型
 *
 * @param entry - 条目
 * @param fallbackId - 回退 ID
  * @returns DiscoveredModel 或 null
 */
function toModel(entry: unknown, fallbackId?: string): DiscoveredModel | null {
    const raw = entry as ListingEntry | null;
    const id = label(fallbackId, raw?.id, raw?.model);
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
    return {
        id,
        ...(name !== id ? { name } : {}),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
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

    // `data` 不存在时尝试富化 models 映射；两者都没有则不是模型列表
    const models = listing?.models;
    if (models && typeof models === 'object' && !Array.isArray(models)) {
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
  * @returns DiscoveryResult 实例
 */
export async function discoverModels(
    endpoint: string,
    format: ApiFormat,
    apiKey: string,
    request: DiscoverRequestUrlFn = requestUrl as unknown as DiscoverRequestUrlFn,
): Promise<DiscoveryResult> {
    const url = resolveModelsUrl(endpoint, format);
    if (!url) return { kind: 'error', message: '请先填写 Base URL', url: '' };
    try {
        new URL(url);
    } catch {
        return { kind: 'error', message: 'Base URL 不是合法地址', url };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });
        const response = await Promise.race([
            request({
                url,
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    ...buildAuthHeaders(format, apiKey),
                },
                throw: false,
            }),
            timeout,
        ]);

        if (response.status < 200 || response.status >= 300) {
            log.warn('[ModelDiscovery] 请求失败', { status: response.status, url });
            return { kind: 'error', message: describeStatus(response.status), url };
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
        if (timer) clearTimeout(timer);
    }
}
