/**
 * http-transport.ts — 移动端 HTTP 传输兜底（requestUrl）
 *
 * 背景（O-1）：Obsidian 移动端的 WebView 没有 Electron 的 CORS 豁免，直接 `fetch`
 * 第三方 API 会在预检阶段失败（表现为 "Failed to fetch"），于是「生成/向量化」
 * 在手机上整体不可用。官方推荐的 `requestUrl` 由原生层代发，不受 CORS 限制。
 *
 * 策略：
 * - **移动端**：一律走 `requestUrl`。它不支持流式，因此流式调用退化为
 *   「缓冲整段 SSE → 一次性喂给现有解析循环」，功能等价、只是没有逐字动效。
 * - **桌面端**：保持原生 `fetch`（支持 ReadableStream、AbortSignal 与取消语义），
 *   避免为了移动端把桌面链路也改成缓冲模式。
 * - `requestUrl` 不支持 AbortSignal：这里用 Promise.race 实现「拒绝等待」，
 *   请求本身无法中断（与 shared/http-request.ts 的既有语义一致）。
 */
import { Platform, requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { HttpRequestTimeoutError } from './http-request';

/**
 * 缓冲式「流式」请求的超时预算。
 *
 * 缓冲模式下首字节 = 整段生成完成，不能用常规 60s 预算（长章节必超）。
 * 取 10 分钟：与引擎侧长文本生成的看门狗同一量级。
 */
const STREAM_BUFFER_TIMEOUT_MS = 600_000;


/** 传输请求参数（fetch 与 requestUrl 的公共子集） */
export interface HttpTransportOptions {
    /** HTTP 方法，默认 POST */
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** 取消信号；requestUrl 路径只能做到「不再等待」 */
    signal?: AbortSignal;
    /** 超时预算；仅 requestUrl 路径与桌面 fetch 封装使用 */
    timeoutMs?: number;
}

/** 非流式响应（与 Response 的常用成员同形，便于调用方少改） */
export interface TransportResponse {
    status: number;
    ok: boolean;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
}

/** 字节流读取器的最小子集（原生 reader 与本模块的缓冲 reader 都满足） */
export interface ByteReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
}

/** 流式响应：移动端由缓冲文本合成 body，桌面端原样返回 fetch Response */
export interface StreamTransportResponse {
    status: number;
    ok: boolean;
    text(): Promise<string>;
    body: { getReader(): ByteReader } | null;
    /**
     * 本次流式是否已降级为「缓冲整段再解析」（无逐字动效）。
     *
     * 桌面端 fetch 被 CORS 拦时回退 `requestUrl`，此时仍能正常生成，
     * 但内容是在请求结束后一次性出现的。UI 可据此给出「已降级」提示。
     */
    buffered?: boolean;
}

function isMobile(): boolean {
    return Platform.isMobile === true;
}

function abortError(): Error {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
}

/** 让一个 Promise 响应 abort/timeout；requestUrl 本身无法被中断，只能放弃等待 */
function abortable<T>(
    task: Promise<T>,
    url: string,
    signal?: AbortSignal,
    timeoutMs?: number,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: number | null = null;

        const cleanup = (): void => {
            if (timer) {
                window.clearTimeout(timer);
                timer = null;
            }
            signal?.removeEventListener('abort', onAbort);
        };
        const finish = (action: () => void): void => {
            if (settled) return;
            settled = true;
            cleanup();
            action();
        };
        const onAbort = (): void => finish(() => reject(abortError()));

        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        if (timeoutMs && timeoutMs > 0) {
            timer = window.setTimeout(
                () => finish(() => reject(new HttpRequestTimeoutError(url, timeoutMs))),
                timeoutMs,
            );
        }
        task.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
        );
    });
}

function toTransportResponse(response: RequestUrlResponse): TransportResponse {
    const text = typeof response.text === 'string' ? response.text : '';
    return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        text: async () => text,
        json: async <T = unknown>() => {
            if (response.json !== undefined && response.json !== null) return response.json as T;
            return (text ? JSON.parse(text) : {}) as T;
        },
    };
}

async function requestViaUrl(url: string, options: HttpTransportOptions): Promise<TransportResponse> {
    // L2-6：signal 已 abort 时不要先把请求发出去——requestUrl 不可中断，会白耗一次计费调用
    if (options.signal?.aborted) throw abortError();
    const params: RequestUrlParam = {
        url,
        method: options.method ?? 'POST',
        headers: options.headers,
        body: options.body,
        // 非 2xx 也返回响应：调用方需要 status/text 走 429/401/断联分支
        throw: false,
    };
    const response = await abortable(Promise.resolve(requestUrl(params)), url, options.signal, options.timeoutMs);
    return toTransportResponse(response);
}

async function fetchOnDesktop(url: string, options: HttpTransportOptions, allowUrlFallback = true): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = options.timeoutMs && options.timeoutMs > 0
        ? window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, options.timeoutMs)
        : null;
    const onAbort = (): void => controller.abort();
    if (options.signal?.aborted) {
        controller.abort();
    } else {
        options.signal?.addEventListener('abort', onAbort, { once: true });
    }
    try {
        return await fetch(url, {
            method: options.method ?? 'POST',
            headers: options.headers,
            body: options.body,
            signal: controller.signal,
        });
    } catch (error) {
        if (timedOut && options.timeoutMs) throw new HttpRequestTimeoutError(url, options.timeoutMs);
        // 2026-11-28 修真实缺陷：桌面端原生 fetch 会被 CORS 拦（TypeError: Failed to fetch），
        // 实测 opencode.ai 在 Obsidian 渲染进程里 fetch 直接失败，而同一 requestUrl 能通。
        // 旧实现只在移动端用 requestUrl，桌面遇到 CORS 就完全没救。
        //
        // 回退条件：仅非流式（allowUrlFallback）。流式由 openStreamResponse 自己
        // 捕获后调用 bufferedStreamViaUrl（同样走 requestUrl 缓冲），不复用这条分支。
        //
        // signal 要原样传下去：requestUrl 本身不可中断，但 abortable() 至少能做到
        // 「用户取消后立即不再等待」。此前这里传 `signal: undefined`，等于连这一点
        // 都放弃了——取消后仍会挂到请求自然结束才返回。
        if (allowUrlFallback && isNetworkLevelFailure(error)) {
            return (await requestViaUrl(url, options)) as unknown as Response;
        }
        throw error;
    } finally {
        if (timer) window.clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * 判断是否为「网络层失败」（而非 HTTP 状态错误或业务错误）。
 *
 * 只在真正的连接级失败时回退 `requestUrl`——
 * 不能把 4xx/5xx 也当网络失败重发（那会重复计费且掩盖真实状态码）。
 *
 * @param error - 捕获的错误
 * @returns 是否应回退到 requestUrl
 * @example
 * isNetworkLevelFailure(new TypeError('Failed to fetch')) // true
 * isNetworkLevelFailure(new HttpRequestTimeoutError(url, 1000)) // false
 */
function isNetworkLevelFailure(error: unknown): boolean {
    if (error instanceof HttpRequestTimeoutError) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return /Failed to fetch|NetworkError|ERR_NETWORK|ERR_CONNECTION|net::|ECONNREFUSED|ECONNRESET|CORS/i.test(msg);
}

/**
 * 发送一次非流式 HTTP 请求。
 *
 * 移动端走 `requestUrl`（无 CORS 限制），桌面端走 `fetch`（保留取消语义）。
 *
 * @param url - 请求地址
 * @param options - 方法/头/体/取消/超时
 * @returns 与 Response 同形的响应
 *
 * @example
 * const res = await requestJson('https://api.example.com/v1/embeddings', {
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ input: 'text' }),
 *     timeoutMs: 60_000,
 * });
 */
export async function requestJson(
    url: string,
    options: HttpTransportOptions = {},
): Promise<TransportResponse> {
    if (isMobile()) return requestViaUrl(url, options);
    return await fetchOnDesktop(url, options);
}

function createOneShotReader(text: string): ByteReader {
    let consumed = false;
    return {
        read: async () => {
            if (consumed) return { done: true };
            consumed = true;
            return { done: false, value: new TextEncoder().encode(text) };
        },
        releaseLock: () => {
            consumed = true;
        },
    };
}

/**
 * 打开一个「流式」响应。
 *
 * 桌面端优先返回原生 fetch Response（保留 ReadableStream 与取消语义）；
 * 若渲染进程被 CORS 拦（TypeError: Failed to fetch），回退 `requestUrl`
 * 缓冲整段 SSE，再合成一次性 reader 交给同一个解析循环——功能等价，
 * 只是没有逐字动效（`buffered: true`）。
 * 移动端一律走 `requestUrl`。
 *
 * @param url - 请求地址
 * @param options - 方法/头/体/取消
 * @returns 流式响应（body 可能为 null）
 *
 * @example
 * const response = await openStreamResponse(url, { body, signal });
 * const reader = response.body?.getReader();
 */
export async function openStreamResponse(
    url: string,
    options: HttpTransportOptions = {},
): Promise<StreamTransportResponse> {
    if (!isMobile()) {
        try {
            return await fetchOnDesktop(url, options, false);
        } catch (e) {
            // 2026-11-28 修真实缺陷：此前这里只抛「请改用非流式」的指引，等于把
            // 一个本可工作的路径彻底关掉。requestUrl 拿不到 ReadableStream，但
            // SSE 是一段完整文本，缓冲后一次性喂给现有解析循环完全够用（移动端
            // 分支早就这么做了）。真正不可恢复的只有「用户主动取消」。
            if (options.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
            if (!isNetworkLevelFailure(e)) throw e;
            return await bufferedStreamViaUrl(url, options);
        }
    }
    return await bufferedStreamViaUrl(url, options);
}

/**
 * 用 `requestUrl` 缓冲整段 SSE 并合成为一次性 reader。
 *
 * 超时用 `options.timeoutMs`（缺省 10 分钟）：非流式请求的首字节延迟就是
 * 整段生成耗时，沿用常规 60s 预算会在长章节上稳定误杀。
 */
async function bufferedStreamViaUrl(
    url: string,
    options: HttpTransportOptions,
): Promise<StreamTransportResponse> {
    const buffered = await requestViaUrl(url, {
        ...options,
        timeoutMs: options.timeoutMs ?? STREAM_BUFFER_TIMEOUT_MS,
    });
    const text = await buffered.text();
    return {
        status: buffered.status,
        ok: buffered.ok,
        text: async () => text,
        body: { getReader: () => createOneShotReader(text) },
        buffered: true,
    };
}
