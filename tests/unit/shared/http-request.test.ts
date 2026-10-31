import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';
import { HttpRequestTimeoutError, requestWithPolicy } from '../../../shared/http-request';

function response(status = 200): RequestUrlResponse {
    return { status, headers: {}, arrayBuffer: new ArrayBuffer(0), json: {}, text: '' };
}

const NEVER = new Promise<RequestUrlResponse>(() => {});

describe('requestWithPolicy — 统一网络出口', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('正常返回时原样透传响应，只调用一次', async () => {
        const executor = vi.fn(async () => response(200));
        const result = await requestWithPolicy(executor, { url: 'https://example.com' }, { timeoutMs: 1000 });
        expect(result.status).toBe(200);
        expect(executor).toHaveBeenCalledTimes(1);
    });

    it('超时抛 HttpRequestTimeoutError 且不重试', async () => {
        vi.useFakeTimers();
        const executor = vi.fn(() => NEVER);
        const pending = requestWithPolicy(executor, { url: 'https://slow.example.com' }, {
            timeoutMs: 100,
            retries: 2,
            retryDelayMs: 10,
        });
        const rejection = expect(pending).rejects.toBeInstanceOf(HttpRequestTimeoutError);
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(executor).toHaveBeenCalledTimes(1);
    });

    it('5xx 错误重试一次后成功', async () => {
        vi.useFakeTimers();
        let calls = 0;
        const executor = vi.fn(async () => {
            calls += 1;
            if (calls === 1) throw new Error('Request failed, status 500');
            return response(200);
        });
        const pending = requestWithPolicy(executor, { url: 'https://example.com' }, {
            timeoutMs: 5000,
            retries: 1,
            retryDelayMs: 50,
        });
        await vi.advanceTimersByTimeAsync(80);
        const result = await pending;
        expect(result.status).toBe(200);
        expect(executor).toHaveBeenCalledTimes(2);
    });

    it('401 不在默认可重试范围，立即抛出', async () => {
        const executor = vi.fn(async () => {
            throw new Error('Request failed, status 401');
        });
        await expect(requestWithPolicy(executor, { url: 'https://example.com' }, {
            timeoutMs: 1000,
            retries: 2,
            retryDelayMs: 10,
        })).rejects.toThrow('401');
        expect(executor).toHaveBeenCalledTimes(1);
    });
});
