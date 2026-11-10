import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O-1（2026-11-10 安全/生命周期审计）：移动端 fetch 无 CORS 豁免，
 * 生成/向量化必须改走 requestUrl。本文件锁住传输层的分流契约：
 *  - 桌面端仍用 fetch（保留取消/流式语义），不触碰 requestUrl；
 *  - 移动端一律 requestUrl，且 `throw:false` 让 429/401 分支能拿到 status/text；
 *  - 移动端流式：整段 SSE 缓冲后合成一次性 reader，现有解析循环无需改协议；
 *  - 取消/超时在两条路径上都表现为拒绝，不会无限等待。
 */

const { platformMock, requestUrlMock } = vi.hoisted(() => ({
    platformMock: { isMobile: false, isDesktop: true, isDesktopApp: true, isMobileApp: false },
    requestUrlMock: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        Platform: platformMock,
        requestUrl: (...args: unknown[]) => requestUrlMock(...args),
    };
});

import { HttpRequestTimeoutError } from '../../../shared/http-request';
import { openStreamResponse, requestJson } from '../../../shared/http-transport';

function jsonResponse(body: unknown, status = 200): Response {
    return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(body),
        json: async () => body,
    } as unknown as Response;
}

describe('requestJson — 桌面端 fetch / 移动端 requestUrl', () => {
    beforeEach(() => {
        platformMock.isMobile = false;
        platformMock.isDesktop = true;
        requestUrlMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('桌面端走 fetch，不调用 requestUrl', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await requestJson('https://api.test/v1', {
            headers: { 'Content-Type': 'application/json' },
            body: '{"x":1}',
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('{"ok":true}');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it('移动端走 requestUrl（throw:false），不触碰 fetch', async () => {
        platformMock.isMobile = true;
        platformMock.isDesktop = false;
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        requestUrlMock.mockResolvedValue({ status: 200, text: '{"value":42}', json: { value: 42 } });

        const response = await requestJson('https://api.test/v1', {
            headers: { Authorization: 'Bearer k' },
            body: '{"input":"x"}',
        });

        expect(response.ok).toBe(true);
        expect(await response.json<{ value: number }>()).toEqual({ value: 42 });
        expect(fetchMock).not.toHaveBeenCalled();
        const params = requestUrlMock.mock.calls[0][0] as {
            url: string; method: string; throw: boolean; headers: Record<string, string>; body: string;
        };
        expect(params.url).toBe('https://api.test/v1');
        expect(params.method).toBe('POST');
        expect(params.throw).toBe(false);
        expect(params.headers.Authorization).toBe('Bearer k');
        expect(params.body).toBe('{"input":"x"}');
    });

    it('移动端 429 不抛错：status/text 原样交给调用方走限流分支', async () => {
        platformMock.isMobile = true;
        requestUrlMock.mockResolvedValue({ status: 429, text: 'rate limited', json: null });

        const response = await requestJson('https://api.test/v1', { body: '{}' });
        expect(response.ok).toBe(false);
        expect(response.status).toBe(429);
        expect(await response.text()).toBe('rate limited');
    });

    it('桌面端超时 → HttpRequestTimeoutError（不会永久挂起）', async () => {
        vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            }, { once: true });
        }));

        await expect(requestJson('https://api.test/v1', { body: '{}', timeoutMs: 10 }))
            .rejects.toBeInstanceOf(HttpRequestTimeoutError);
    });

    it('移动端外部取消 → 拒绝等待（requestUrl 本身无法中断）', async () => {
        platformMock.isMobile = true;
        requestUrlMock.mockImplementation(() => new Promise(() => { /* 永不返回 */ }));
        const controller = new AbortController();

        const pending = requestJson('https://api.test/v1', { body: '{}', signal: controller.signal });
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('signal 已 abort 时不发出 requestUrl（L2-6）', async () => {
        platformMock.isMobile = true;
        const controller = new AbortController();
        controller.abort();

        await expect(requestJson('https://api.test/v1', { body: '{}', signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(requestUrlMock).not.toHaveBeenCalled();
    });
});

describe('openStreamResponse — 移动端缓冲 SSE 兼容', () => {
    beforeEach(() => {
        platformMock.isMobile = false;
        requestUrlMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('桌面端原样返回 fetch Response（保留原生 body 流）', async () => {
        const native = jsonResponse({ stream: true });
        vi.stubGlobal('fetch', vi.fn(async () => native));

        const response = await openStreamResponse('https://api.test/v1', { body: '{}' });
        expect(response.status).toBe(200);
        expect(response.body).toBe(native.body);
    });

    it('移动端把整段 SSE 合成为一次性 reader，解析循环可完整读完', async () => {
        platformMock.isMobile = true;
        const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n';
        requestUrlMock.mockResolvedValue({ status: 200, text: sse, json: null });

        const response = await openStreamResponse('https://api.test/v1', {
            headers: { Accept: 'text/event-stream' },
            body: '{"stream":true}',
        });

        expect(response.ok).toBe(true);
        expect(await response.text()).toBe(sse);
        const reader = response.body?.getReader();
        const first = await reader!.read();
        expect(first.done).toBe(false);
        expect(new TextDecoder().decode(first.value)).toBe(sse);
        expect((await reader!.read()).done).toBe(true);
        reader!.releaseLock();
    });
});
