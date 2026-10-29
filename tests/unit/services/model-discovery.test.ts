import { describe, it, expect, vi } from 'vitest';
import { discoverModels, parseModelListing, type DiscoverRequestUrlFn } from '../../../services/model-discovery';

/** 构造一个可断言的假 requestUrl */
function fakeRequest(response: {
    status?: number;
    body?: unknown;
    text?: string;
    headers?: Record<string, string>;
}): { fn: DiscoverRequestUrlFn; calls: Array<{ url: string; method: string; headers?: Record<string, string> }> } {
    const calls: Array<{ url: string; method: string; headers?: Record<string, string> }> = [];
    const fn: DiscoverRequestUrlFn = async (options) => {
        calls.push({ url: options.url, method: options.method, headers: options.headers });
        const text = response.text ?? (response.body === undefined ? '' : JSON.stringify(response.body));
        return { status: response.status ?? 200, text, json: response.body, headers: response.headers };
    };
    return { fn, calls };
}

describe('parseModelListing', () => {
    it('读标准 data 数组', () => {
        const models = parseModelListing({ data: [{ id: 'a' }, { id: 'b' }] });
        expect(models.map(m => m.id)).toEqual(['a', 'b']);
    });

    it('保留端点披露的容量字段（多种命名）', () => {
        const models = parseModelListing({
            data: [
                { id: 'with-limit', limit: { context: 1_000_000, output: 65_536 } },
                { id: 'with-snake', context_length: 200_000, max_tokens: 8_192 },
                { id: 'with-camel', contextWindow: 128_000, maxOutputTokens: 16_384 },
                { id: 'with-top-provider', top_provider: { max_completion_tokens: 32_000 } },
            ],
        });
        const byId = new Map(models.map(m => [m.id, m]));
        expect(byId.get('with-limit')).toMatchObject({ contextWindow: 1_000_000, maxTokens: 65_536 });
        expect(byId.get('with-snake')).toMatchObject({ contextWindow: 200_000, maxTokens: 8_192 });
        expect(byId.get('with-camel')).toMatchObject({ contextWindow: 128_000, maxTokens: 16_384 });
        expect(byId.get('with-top-provider')).toMatchObject({ maxTokens: 32_000 });
    });

    it('读富化 models 映射，属性名作为请求 id', () => {
        const models = parseModelListing({
            models: {
                'alias-name': { id: 'canonical-id', name: '显示名' },
                'plain': { context_window: 32_000 },
            },
        });
        expect(models.map(m => m.id)).toEqual(['alias-name', 'plain']);
        expect(models[0].name).toBe('显示名');
        // name 与 id 相同时不存冗余字段，调用方用 id 兜底
        expect(models[1].name).toBeUndefined();
    });

    it('去重：同一 id 只保留一次', () => {
        const models = parseModelListing({ data: [{ id: 'dup' }, { id: 'dup' }] });
        expect(models).toHaveLength(1);
    });

    it('跳过没有 id 的畸形条目，不放弃整份列表', () => {
        const models = parseModelListing({ data: [{ name: '无 id' }, { id: 'ok' }] });
        expect(models.map(m => m.id)).toEqual(['ok']);
    });

    it('data 与 models 都没有时抛错（说明不是模型列表接口）', () => {
        expect(() => parseModelListing({ result: [] })).toThrow(/不是模型列表/);
    });

    it('容错：data 不是数组时尝试 models', () => {
        const models = parseModelListing({ data: 'oops', models: { m1: {} } });
        expect(models.map(m => m.id)).toEqual(['m1']);
    });
});

describe('discoverModels', () => {
    it('OpenAI 格式请求 {root}/models 并带 Bearer', async () => {
        const { fn, calls } = fakeRequest({ body: { data: [{ id: 'gpt-x' }] } });
        const result = await discoverModels('https://api.example.com/v1', 'openai-chat', 'sk-1', fn);

        expect(result.kind).toBe('ok');
        expect(calls[0].url).toBe('https://api.example.com/models');
        expect(calls[0].method).toBe('GET');
        expect(calls[0].headers?.Authorization).toBe('Bearer sk-1');
    });

    it('Anthropic 格式请求 {root}/v1/models 并带 x-api-key + version', async () => {
        const { fn, calls } = fakeRequest({ body: { data: [{ id: 'claude-x', display_name: 'Claude X' }] } });
        const result = await discoverModels('https://api.anthropic.com', 'anthropic-messages', 'sk-ant', fn);

        expect(result.kind).toBe('ok');
        expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
        expect(calls[0].headers?.['x-api-key']).toBe('sk-ant');
        expect(calls[0].headers?.['anthropic-version']).toBe('2023-06-01');
        expect(calls[0].headers?.Authorization).toBeUndefined();
        if (result.kind === 'ok') {
            expect(result.models[0]).toMatchObject({ id: 'claude-x', name: 'Claude X' });
        }
    });

    it('空地址直接返回可读错误，不发请求', async () => {
        const { fn, calls } = fakeRequest({ body: { data: [] } });
        const result = await discoverModels('', 'openai-chat', 'sk-1', fn);
        expect(result.kind).toBe('error');
        expect(calls).toHaveLength(0);
    });

    it('401 给出鉴权提示而不是空列表', async () => {
        const { fn } = fakeRequest({ status: 401, text: '' });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'bad', fn);
        expect(result).toEqual({ kind: 'error', message: expect.stringContaining('鉴权失败'), url: expect.any(String) });
    });

    it('404 提示端点不提供模型列表', async () => {
        const { fn } = fakeRequest({ status: 404, text: '' });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'k', fn);
        if (result.kind !== 'error') throw new Error('应为错误');
        expect(result.message).toMatch(/404/);
        expect(result.message).toMatch(/模型列表/);
    });

    it('响应不是 JSON 时给出可读原因', async () => {
        const { fn } = fakeRequest({ status: 200, text: '<html>nope</html>' });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'k', fn);
        if (result.kind !== 'error') throw new Error('应为错误');
        expect(result.message).toMatch(/不是 JSON/);
    });

    it('合法但空列表提示手动填写', async () => {
        const { fn } = fakeRequest({ body: { data: [] } });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'k', fn);
        if (result.kind !== 'error') throw new Error('应为错误');
        expect(result.message).toMatch(/空列表/);
    });

    it('网络异常被捕获成错误结果，不向调用方抛出', async () => {
        const fn: DiscoverRequestUrlFn = vi.fn(async () => {
            throw new Error('ECONNREFUSED');
        });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'k', fn);
        expect(result.kind).toBe('error');
        if (result.kind === 'error') expect(result.message).toMatch(/ECONNREFUSED/);
    });

    it('响应体超过上限时拒绝解析', async () => {
        const huge = 'x'.repeat(2 * 1024 * 1024 + 10);
        const { fn } = fakeRequest({ status: 200, text: huge });
        const result = await discoverModels('https://api.example.com', 'openai-chat', 'k', fn);
        if (result.kind !== 'error') throw new Error('应为错误');
        expect(result.message).toMatch(/MB/);
    });

    it('未登记协议的端点仍按传入格式请求（调用方决定格式）', async () => {
        const { fn, calls } = fakeRequest({ body: { data: [{ id: 'm' }] } });
        await discoverModels('https://gateway.example/openai', 'openai-responses', 'k', fn);
        expect(calls[0].url).toBe('https://gateway.example/openai/models');
    });
});
