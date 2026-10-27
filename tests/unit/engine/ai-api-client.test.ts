import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {};
        app = {};
    },
}));

import { AIApiClient } from '../../../engine/ai-api-client';
import { clearDetectedModelCapabilities } from '../../../shared/model-capabilities';
import { clearLocalModelProbeCache } from '../../../services/local-model-probe';

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
        vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
            // 未登记本地模型会先探测 /api/show，不纳入业务请求计数
            if (String(input).endsWith('/api/show')) {
                return Promise.resolve(new Response(
                    JSON.stringify({ model_info: { 'qwen2.context_length': 8192 } }),
                    { status: 200 }
                ));
            }
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
            clearDetectedModelCapabilities();
            clearLocalModelProbeCache();
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

describe('callAI — 输出 token 上限', () => {
    function resolveMaxOutput(plugin: unknown, model: string): number {
        return (AIApiClient.prototype as any).resolveMaxOutput.call({ plugin }, model);
    }

    it('用户模型覆盖的 maxOutput 优先生效', () => {
        const plugin = { resolveModelLimits: () => ({ maxContext: 1048576, maxOutput: 131072 }) };
        expect(resolveMaxOutput(plugin, 'deepseek-flash')).toBe(131072);
    });

    it('未登记模型且无覆盖时回退静态能力表（8192）', () => {
        const plugin = { resolveModelLimits: () => ({ maxContext: 1048576, maxOutput: 0 }) };
        expect(resolveMaxOutput(plugin, 'unknown-model')).toBe(8192);
    });

    it('插件未提供 resolveModelLimits 时不影响调用（回退静态表）', () => {
        expect(resolveMaxOutput({}, 'unknown-model')).toBe(8192);
    });

    it('用户覆盖的 maxContext 优先生效（预算检查不再误判 32K）', () => {
        const plugin = { resolveModelLimits: () => ({ maxContext: 1048576, maxOutput: 131072 }) };
        const resolveMaxContext = (AIApiClient.prototype as any).resolveMaxContext;
        expect(resolveMaxContext.call({ plugin }, 'deepseek-flash')).toBe(1048576);
        expect(resolveMaxContext.call({}, 'unknown-model')).toBe(32768);
    });
});

describe('callAI — 截断自动扩容', () => {
    it('finish_reason=length 时在模型上限内扩容并重试一次', async () => {
        const bodies: Array<Record<string, any>> = [];
        const responses = [
            { choices: [{ message: { content: '被截断的前半段' }, finish_reason: 'length' }] },
            { choices: [{ message: { content: '完整内容' }, finish_reason: 'stop' }] },
        ];
        vi.stubGlobal('fetch', vi.fn((_url: string, init: { body?: string }) => {
            bodies.push(JSON.parse(String(init?.body || '{}')));
            return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 }));
        }));

        try {
            const plugin = {
                settings: {
                    apiKey: 'test-key',
                    apiEndpoint: 'https://example.test/v1/chat/completions',
                    defaultModel: 'deepseek-flash',
                    availableModels: ['deepseek-flash'],
                    enableAutoModelFallback: false,
                    maxApiRetries: 3,
                    promptCacheEnabled: false,
                },
                resolveModelLimits: () => ({ maxContext: 1048576, maxOutput: 32768 }),
            };
            const client = new AIApiClient(plugin as never);

            const result = await client.callAI('sys', 'user', 'deepseek-flash', 0.7, 4096);

            expect(result.content).toBe('完整内容');
            expect(result.finishReason).toBe('stop');
            expect(bodies).toHaveLength(2);
            expect(bodies[0].max_tokens).toBe(4096);
            expect(bodies[1].max_tokens).toBe(8192);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('已达模型上限时不再无限扩容', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', vi.fn(() => {
            fetchCalls++;
            return Promise.resolve(new Response(JSON.stringify({
                choices: [{ message: { content: '仍被截断' }, finish_reason: 'length' }],
            }), { status: 200 }));
        }));

        try {
            const plugin = {
                settings: {
                    apiKey: 'test-key',
                    apiEndpoint: 'https://example.test/v1/chat/completions',
                    defaultModel: 'tiny-model',
                    availableModels: ['tiny-model'],
                    enableAutoModelFallback: false,
                    maxApiRetries: 3,
                    promptCacheEnabled: false,
                },
                resolveModelLimits: () => ({ maxContext: 8192, maxOutput: 4096 }),
            };
            const client = new AIApiClient(plugin as never);

            const result = await client.callAI('sys', 'user', 'tiny-model', 0.7, 4096);

            expect(fetchCalls).toBe(1);
            expect(result.finishReason).toBe('length');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('callAIAsyncIterator — 思考型模型预算回收', () => {
    function sseResponse(chunks: string[]): Response {
        const body = chunks.map((c) => `data: ${c}\n\n`).join('') + 'data: [DONE]\n\n';
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    it('思考占满预算（finish_reason=length 且正文为空）时扩容重试同一模型', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let call = 0;
        vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            call++;
            if (call === 1) {
                // 第一次：思考把 2000 token 全吃掉，content 全程为空
                return Promise.resolve(sseResponse([
                    JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '用户要求续写……' }, finish_reason: null }] }),
                    JSON.stringify({ choices: [{ index: 0, delta: { content: null, reasoning_content: '还要注意番茄格式……' }, finish_reason: null }] }),
                    JSON.stringify({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'length' }] }),
                ]));
            }
            return Promise.resolve(sseResponse([
                JSON.stringify({ choices: [{ index: 0, delta: { content: '沈砚踩上栈桥，木板咯了一声。' }, finish_reason: null }] }),
                JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
            ]));
        }));

        try {
            const plugin = {
                settings: {
                    apiKey: 'test-key',
                    apiEndpoint: 'https://example.test/v1/chat/completions',
                    defaultModel: 'deepseek-flash',
                    availableModels: ['deepseek-flash'],
                    enableAutoModelFallback: false,
                    maxApiRetries: 3,
                    promptCacheEnabled: false,
                },
                resolveModelLimits: () => ({ maxContext: 131072, maxOutput: 131072 }),
            };
            const client = new AIApiClient(plugin as never);

            const it = client.callAIAsyncIterator('sys', 'user', 'deepseek-flash', 0.7, 2000);
            let final: { content?: string; error?: string } | undefined;
            while (true) {
                const step = await it.next();
                if (step.done) {
                    final = step.value;
                    break;
                }
            }

            expect(final?.error).toBeUndefined();
            expect(final?.content).toContain('木板');
            // 思考内容绝不能被拼进正文
            expect(final?.content).not.toContain('用户要求续写');
            expect(bodies).toHaveLength(2);
            expect(bodies[0].max_tokens).toBe(2000);
            // 扩容后预算变大，且思考内容不会被当成正文输出
            expect(Number(bodies[1].max_tokens)).toBeGreaterThan(2000);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('既有正文又被截断时不重复请求（避免每条候选多跑一倍时间）', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', vi.fn(() => {
            fetchCalls++;
            return Promise.resolve(sseResponse([
                JSON.stringify({ choices: [{ index: 0, delta: { content: '沈砚踩上栈桥。' }, finish_reason: null }] }),
                JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }),
            ]));
        }));

        try {
            const plugin = {
                settings: {
                    apiKey: 'test-key',
                    apiEndpoint: 'https://example.test/v1/chat/completions',
                    defaultModel: 'deepseek-flash',
                    availableModels: ['deepseek-flash'],
                    enableAutoModelFallback: false,
                    maxApiRetries: 3,
                    promptCacheEnabled: false,
                },
                resolveModelLimits: () => ({ maxContext: 131072, maxOutput: 131072 }),
            };
            const client = new AIApiClient(plugin as never);

            const it = client.callAIAsyncIterator('sys', 'user', 'deepseek-flash', 0.7, 2000);
            while (true) {
                const step = await it.next();
                if (step.done) break;
            }

            expect(fetchCalls).toBe(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('callAI — 密钥未解锁 / 认证失败快速失败', () => {
    function makePlugin(overrides: Record<string, unknown> = {}) {
        return {
            settings: {
                apiKey: 'test-key',
                apiEndpoint: 'https://example.test/v1/chat/completions',
                defaultModel: 'test-model',
                availableModels: ['test-model', 'backup-a'],
                enableAutoModelFallback: true,
                maxApiRetries: 3,
                promptCacheEnabled: false,
                ...overrides,
            },
        };
    }

    it('密文密钥解密失败时不发请求，直接返回可读错误', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        try {
            const plugin = {
                ...makePlugin({ providerKeys: { deepseek: 'aes256:AAAA:BBBB' } }),
                // 模拟用户取消口令框：decrypt 原样返回密文
                decryptKey: async (stored: string) => stored,
            };
            const client = new AIApiClient(plugin as never);

            const result = await client.callAI(
                'sys', 'user', 'test-model', 0.7, 64,
                { apiKey: 'aes256:AAAA:BBBB' } as never
            );

            expect(fetchSpy).not.toHaveBeenCalled();
            expect(result.error).toContain('未解锁');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('后台调用 allowKeyPrompt:false 时不走口令框，未解锁直接失败', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const silentDecrypt = vi.fn(async (stored: string) => stored);

        try {
            const plugin = {
                ...makePlugin({ providerKeys: { deepseek: 'aes256:AAAA:BBBB' } }),
                decryptKey: async () => 'should-not-be-called',
                decryptKeyWithoutPrompt: silentDecrypt,
            };
            const client = new AIApiClient(plugin as never);

            const result = await client.callAI(
                'sys', 'user', 'test-model', 0.7, 64,
                { apiKey: 'aes256:AAAA:BBBB', allowKeyPrompt: false } as never
            );

            expect(silentDecrypt).toHaveBeenCalledTimes(1);
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(result.error).toContain('未解锁');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('401 认证失败不重试也不切换模型（fetch 仅 1 次）', async () => {
        const fetchSpy = vi.fn(() =>
            Promise.resolve(new Response('{"error":"invalid key"}', { status: 401 }))
        );
        vi.stubGlobal('fetch', fetchSpy);

        try {
            const client = new AIApiClient(makePlugin() as never);
            const result = await client.callAI('sys', 'user', 'test-model', 0.7, 64);

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(result.error).toContain('401');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('callAI — Ollama 上下文窗口 numCtx', () => {
    function makeClient(overrides: Record<string, unknown> = {}) {
        return new AIApiClient({
            settings: {
                apiKey: 'ollama',
                apiEndpoint: 'http://localhost:11434/api/generate',
                defaultModel: 'deepseek-r1:7b',
                availableModels: ['deepseek-r1:7b'],
                enableAutoModelFallback: false,
                maxApiRetries: 1,
                promptCacheEnabled: false,
                maxContext: 131072,
                maxOutput: 8192,
                ...overrides,
            },
        } as never);
    }

    function captureBodies() {
        const bodies: Array<Record<string, unknown>> = [];
        vi.stubGlobal('fetch', (_url: string, init: { body?: string }) => {
            bodies.push(JSON.parse(init.body || '{}'));
            return Promise.resolve(new Response(
                JSON.stringify({ response: '他握剑立在崖边。', done: true, done_reason: 'stop' }),
                { status: 200 }
            ));
        });
        return bodies;
    }

    it('传入 numCtx 时写入 Ollama options.num_ctx', async () => {
        const bodies = captureBodies();
        try {
            await makeClient().callAI(
                'sys', 'user', 'deepseek-r1:7b', 0.7, 64,
                { disableFallback: true, numCtx: 32768 }
            );
            expect((bodies[0].options as Record<string, unknown>).num_ctx).toBe(32768);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('未传 numCtx 时按模型画像下发 num_ctx（不再退回 Ollama 默认窗口）', async () => {
        const bodies = captureBodies();
        try {
            await makeClient().callAI('sys', 'user', 'deepseek-r1:7b', 0.7, 64, { disableFallback: true });
            // deepseek-r1:7b 必须命中本地长键（32768），而不是云端 deepseek-r1（131072）
            expect((bodies[0].options as Record<string, unknown>).num_ctx).toBe(32768);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('内置 Ollama 的 /v1 兼容端点自动改写为原生 /api/generate', async () => {
        const urls: string[] = [];
        const bodies: Array<Record<string, unknown>> = [];
        vi.stubGlobal('fetch', (url: string, init: { body?: string }) => {
            urls.push(url);
            bodies.push(JSON.parse(init.body || '{}'));
            return Promise.resolve(new Response(
                JSON.stringify({ response: '他握剑立在崖边。', done: true, done_reason: 'stop' }),
                { status: 200 }
            ));
        });
        try {
            const client = makeClient({ apiEndpoint: 'http://localhost:11434/v1/chat/completions' });
            const result = await client.callAI('sys', 'user', 'deepseek-r1:7b', 0.7, 64, { disableFallback: true });
            expect(urls[0]).toBe('http://localhost:11434/api/generate');
            expect((bodies[0].options as Record<string, unknown>).num_ctx).toBe(32768);
            expect(result.content).toBe('他握剑立在崖边。');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('自定义端口的本机 Ollama 同样改写为原生 /api/generate', async () => {
        const urls: string[] = [];
        const bodies: Array<Record<string, unknown>> = [];
        vi.stubGlobal('fetch', (url: string, init: { body?: string }) => {
            urls.push(url);
            bodies.push(JSON.parse(init.body || '{}'));
            return Promise.resolve(new Response(
                JSON.stringify({ response: '他握剑立在崖边。', done: true, done_reason: 'stop' }),
                { status: 200 }
            ));
        });
        try {
            const client = makeClient({ apiEndpoint: 'http://127.0.0.1:12345/v1/chat/completions' });
            await client.callAI('sys', 'user', 'deepseek-r1:7b', 0.7, 64, { disableFallback: true });
            expect(urls[0]).toBe('http://127.0.0.1:12345/api/generate');
            expect((bodies[0].options as Record<string, unknown>).num_ctx).toBe(32768);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('公网 OpenAI 兼容端点不被误改写', async () => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            urls.push(url);
            return Promise.resolve(new Response(
                JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
                { status: 200 }
            ));
        });
        try {
            const client = makeClient({ apiEndpoint: 'https://api.example.com/v1/chat/completions' });
            await client.callAI('sys', 'user', 'gpt-4o-mini', 0.7, 64, { disableFallback: true });
            expect(urls[0]).toBe('https://api.example.com/v1/chat/completions');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('Ollama 原生 done_reason=length 映射为 finish_reason=length', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(
            JSON.stringify({ response: '写到一半', done: true, done_reason: 'length' }),
            { status: 200 }
        )));
        try {
            // 直接把 max_tokens 设到模型上限，避免触发扩容重试，专测 done_reason 映射
            const result = await makeClient({ maxApiRetries: 3 }).callAI('sys', 'user', 'deepseek-r1:7b', 0.7, 8192, { disableFallback: true });
            expect(result.finishReason).toBe('length');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('normalizeOllamaEndpoint — 只改写 Ollama', () => {
    function make(endpoint: string, providers: Array<Record<string, unknown>>) {
        const client = new AIApiClient({
            settings: {
                apiEndpoint: endpoint,
                customProviders: providers,
                defaultModel: 'qwen2.5:7b',
                availableModels: ['qwen2.5:7b'],
                maxApiRetries: 1,
            },
        } as never);
        return (client as unknown as {
            normalizeOllamaEndpoint: (url: string) => string;
        }).normalizeOllamaEndpoint(endpoint);
    }

    it('Ollama 11434 改写为原生 /api/generate', () => {
        expect(make('http://localhost:11434/v1/chat/completions', [
            { id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions', models: ['qwen2.5:7b'], sourceType: 'local' },
        ])).toBe('http://localhost:11434/api/generate');
    });

    it('局域网 Ollama 11434 同样改写', () => {
        expect(make('http://192.168.1.8:11434/v1/chat/completions', [
            { id: 'custom-1', endpoint: 'http://192.168.1.8:11434/v1/chat/completions', models: ['qwen2.5:7b'], sourceType: 'local' },
        ])).toBe('http://192.168.1.8:11434/api/generate');
    });

    it('LM Studio 1234 不误改写', () => {
        expect(make('http://localhost:1234/v1/chat/completions', [
            { id: 'custom-2', endpoint: 'http://localhost:1234/v1/chat/completions', models: ['qwen2.5:7b'], sourceType: 'local' },
        ])).toBe('http://localhost:1234/v1/chat/completions');
    });
});
