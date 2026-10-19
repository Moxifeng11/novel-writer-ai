import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {};
        app = {};
    },
}));

import { AIApiClient } from '../../../engine/ai-api-client';

function callIsDisconnectionError(error: unknown, statusCode?: number): boolean {
    return (AIApiClient.prototype as any).isDisconnectionError.call({}, error, statusCode);
}

describe('isDisconnectionError', () => {
    it('网络类 TypeError（fetch failed）应判为断连', () => {
        expect(callIsDisconnectionError(new TypeError('fetch failed'))).toBe(true);
    });

    it('非网络 TypeError（读取 undefined 属性）不应判为断连', () => {
        expect(
            callIsDisconnectionError(
                new TypeError('Cannot read properties of undefined (reading x)')
            )
        ).toBe(false);
    });

    it('statusCode 500/502/503/504/408 应判为断连', () => {
        for (const code of [500, 502, 503, 504, 408]) {
            expect(callIsDisconnectionError(new Error('x'), code)).toBe(true);
        }
    });

    it('statusCode 400/401/403/404 不应判为断连', () => {
        for (const code of [400, 401, 403, 404]) {
            expect(callIsDisconnectionError(new Error('x'), code)).toBe(false);
        }
    });

    it('AbortError 应判为断连', () => {
        expect(callIsDisconnectionError({ name: 'AbortError' })).toBe(true);
    });

    it('普通 Error 且 message 含 econnrefused 应判为断连', () => {
        expect(callIsDisconnectionError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(true);
    });

    it('普通 Error 且 message 无网络关键字不应判为断连', () => {
        expect(callIsDisconnectionError(new Error('some logic error'))).toBe(false);
    });
});

describe('callAI — 外部取消语义（取消优先于断联回退）', () => {
    function makeClient(overrides: Record<string, unknown> = {}) {
        const plugin = {
            settings: {
                apiKey: 'test-key',
                apiEndpoint: 'https://example.test/v1/chat/completions',
                defaultModel: 'test-model',
                availableModels: ['test-model', 'backup-a', 'backup-b'],
                enableAutoModelFallback: true,
                maxApiRetries: 1,
                promptCacheEnabled: false,
                maxContext: 128000,
                maxOutput: 4096,
                ...overrides,
            },
        };
        return new AIApiClient(plugin as never);
    }

    it('外部取消时不触发模型回退：fetch 仅调用一次且返回 aborted', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) => {
            fetchCalls++;
            return new Promise((_resolve, reject) => {
                const rejectAsAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                const signal = init?.signal;
                if (signal?.aborted) return rejectAsAbort();
                signal?.addEventListener('abort', rejectAsAbort, { once: true });
            });
        });

        try {
            const client = makeClient();
            const ac = new AbortController();
            setTimeout(() => ac.abort(), 20);

            const result = await client.callAI('sys', 'user', 'test-model', 0.7, 64, { signal: ac.signal });

            // 取消前若先走「断联回退」，AbortError 会被判为断连并切到 backup-a/backup-b 继续生成
            expect(result.error).toBe('aborted');
            expect(fetchCalls).toBe(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('未取消时 AbortError 仍按断联处理（保留超时/断联切模型语义）', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', () => {
            fetchCalls++;
            return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });

        try {
            const client = makeClient();
            const result = await client.callAI('sys', 'user', 'test-model', 0.7, 64);

            // 无外部取消信号 → 仍走断联回退，逐个模型尝试后汇总失败
            expect(fetchCalls).toBeGreaterThan(1);
            expect(result.error).not.toBe('aborted');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('流式取消时在迭代器层短路：不再空跑 simulated/full 降级阶段', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) => {
            fetchCalls++;
            // 永不 resolve：仅在外部中止联动到内部 signal 时以 AbortError 拒绝
            return new Promise((_resolve, reject) => {
                const rejectAsAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                const signal = init?.signal;
                if (signal?.aborted) return rejectAsAbort();
                signal?.addEventListener('abort', rejectAsAbort, { once: true });
            });
        });
        const callAISpy = vi.spyOn(
            AIApiClient.prototype as unknown as { callAI: (...args: unknown[]) => unknown },
            'callAI'
        );

        try {
            const client = makeClient();
            const ac = new AbortController();
            setTimeout(() => ac.abort(), 20);

            const it = client.callAIAsyncIterator('sys', 'user', 'test-model', 0.7, 64, { signal: ac.signal });
            let err: string | undefined;
            while (true) {
                const step = await it.next();
                if (step.done) {
                    err = step.value?.error;
                    break;
                }
            }

            expect(err).toBe('aborted');
            expect(fetchCalls).toBe(1);
            // 若无短路，取消会被当成「native 阶段失败」，继续进入 simulated/full 阶段并调用 callAI
            expect(callAISpy).not.toHaveBeenCalled();
        } finally {
            callAISpy.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('本地端点（localhost）且未配置密钥时不拦截，正常发起请求', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', () => {
            fetchCalls++;
            return Promise.resolve(new Response(
                JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
                { status: 200 }
            ));
        });
        try {
            const client = makeClient({ apiKey: '', apiEndpoint: 'http://localhost:11434/v1/chat/completions' });
            const result = await client.callAI('sys', 'user', 'local-model', 0.7, 64, { disableFallback: true });
            // 修复前：本地端点也被「API密钥未配置」拦截，fetch 调用数为 0
            expect(fetchCalls).toBe(1);
            expect(result.error).not.toBe('API密钥未配置');
            expect(result.content).toBe('ok');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('云端端点且未配置密钥时仍拦截（行为不变）', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', () => {
            fetchCalls++;
            return Promise.resolve(new Response('{}', { status: 200 }));
        });
        try {
            const client = makeClient({ apiKey: '', apiEndpoint: 'https://api.example.com/v1/chat/completions' });
            const result = await client.callAI('sys', 'user', 'm', 0.7, 64, { disableFallback: true });
            expect(result.error).toBe('API密钥未配置');
            expect(fetchCalls).toBe(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
