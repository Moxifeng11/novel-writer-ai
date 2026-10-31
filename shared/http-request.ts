/**
 * http-request.ts — 统一网络出口策略（超时 + 可选重试）
 *
 * 背景（审计 E3）：各服务直接调用 Obsidian `requestUrl`，搜索/抓取类请求
 * 一旦卡在服务端就会无限等待，且瞬断失败无重试入口。
 *
 * 语义说明：Obsidian `requestUrl` 不支持 `AbortSignal`，因此这里的「取消」
 * 只能是拒绝等待并丢弃迟到结果（请求本身无法中断）。
 */

import type { RequestUrlResponse } from 'obsidian';

/** 默认单次尝试超时（毫秒） */
export const DEFAULT_HTTP_TIMEOUT_MS = 30000;

/** 搜索类后端的通用策略：15s 超时 + 5xx/429/网络错误重试 1 次（超时不重试） */
export const SEARCH_REQUEST_POLICY: HttpRequestPolicy = { timeoutMs: 15000, retries: 1, retryDelayMs: 1000 };

export interface HttpRequestPolicy {
    /** 单次尝试超时（毫秒），默认 {@link DEFAULT_HTTP_TIMEOUT_MS} */
    timeoutMs?: number;
    /** 失败后额外重试次数，默认 0（不重试） */
    retries?: number;
    /** 重试间隔（毫秒），默认 1000 */
    retryDelayMs?: number;
    /** 判断某次失败是否值得重试；默认只放行 5xx / 429 / 网络类错误 */
    retryOn?: (error: unknown) => boolean;
}

/** 请求超时（含 url 与超时预算，便于调用方拼装提示） */
export class HttpRequestTimeoutError extends Error {
    readonly url: string;
    readonly timeoutMs: number;

    constructor(url: string, timeoutMs: number) {
        super(`请求超时（${timeoutMs}ms）：${url}`);
        this.name = 'HttpRequestTimeoutError';
        this.url = url;
        this.timeoutMs = timeoutMs;
    }
}

export type RequestExecutor<T = RequestUrlResponse> = (params: HttpRequestParams) => Promise<T>;

/** 请求所需的最小参数集（`RequestUrlParam` 的子集，便于注入自定义请求函数） */
export interface HttpRequestParams {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
    pending: Promise<T>,
    url: string,
    timeoutMs: number,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new HttpRequestTimeoutError(url, timeoutMs)), timeoutMs);
        pending.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/** 默认可重试判定：超时不重试；仅 5xx / 429 / 网络类错误放行 */
function isRetryableByDefault(error: unknown): boolean {
    if (error instanceof HttpRequestTimeoutError) return false;
    const message = error instanceof Error ? error.message : String(error);
    return /status\s*(?:429|5\d\d)/i.test(message)
        || /network|ECONN|ETIMEDOUT|ENOTFOUND|socket|fetch failed/i.test(message);
}

/**
 * 统一执行一次 HTTP 请求：单次尝试超时 + 可选重试。
 *
 * 正常路径（未超时、未失败）的返回值与直接调用 `requestUrl` 完全一致。
 */
export async function requestWithPolicy<T = RequestUrlResponse>(
    execute: RequestExecutor<T>,
    params: HttpRequestParams,
    policy: HttpRequestPolicy = {},
): Promise<T> {
    const timeoutMs = policy.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const retries = Math.max(0, policy.retries ?? 0);
    const retryDelayMs = Math.max(0, policy.retryDelayMs ?? 1000);
    const retryOn = policy.retryOn ?? isRetryableByDefault;

    for (let attempt = 0; ; attempt++) {
        try {
            return await withTimeout(execute(params), params.url, timeoutMs);
        } catch (error) {
            if (attempt >= retries || !retryOn(error)) throw error;
            await delay(retryDelayMs);
        }
    }
}
