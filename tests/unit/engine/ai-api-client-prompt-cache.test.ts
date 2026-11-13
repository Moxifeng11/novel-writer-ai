import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIApiClient } from '../../../engine/ai-api-client';
import { getPromptCache } from '../../../engine/prompt-cache';

/** 构造 mock plugin（不 import main/engine-registry，避免 obsidian 编译产物加载） */
function makePlugin(settingsOverrides: Record<string, any> = {}) {
    const settings = {
        defaultModel: 'test-model',
        apiKey: 'test-key',
        apiEndpoint: 'https://api.test.example/v1/chat/completions',
        availableModels: ['test-model'],
        enableAutoModelFallback: false,
        promptCacheEnabled: true,
        ...settingsOverrides,
    };
    const plugin = { settings } as any;
    return { plugin, settings };
}

function okResponse(content: string) {
    return new Response(
        JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200 }
    );
}

describe('AIApiClient.callAI — P0-3 prompt 缓存', () => {
    beforeEach(() => {
        getPromptCache().clear(); // 清空模块单例，防止跨用例污染
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('TR-3.1: 相同五元组二次调用命中缓存，fetch 仅 1 次，返回相同内容', async () => {
        const { plugin } = makePlugin();
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse('第一次生成的内容')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        const r1 = await client.callAI('系统提示', '用户提示', 'test-model', 0.7, 1024);
        const r2 = await client.callAI('系统提示', '用户提示', 'test-model', 0.7, 1024);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(r1.content).toBe('第一次生成的内容');
        expect(r2.content).toBe('第一次生成的内容');
        expect(r1).toEqual(r2); // 同一缓存对象（含 actualModel——DSH-20261114-08②）
    });

    it('TR-3.2: model 变化 → miss 重新发起调用', async () => {
        const { plugin } = makePlugin();
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse('内容')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        await client.callAI('s', 'u', 'test-model', 0.7, 1024);
        await client.callAI('s', 'u', 'another-model', 0.7, 1024);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('TR-3.3: error 响应不写入缓存，后续调用仍发起真实请求', async () => {
        const { plugin } = makePlugin();
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => Promise.resolve(new Response('server boom', { status: 500 })))
            .mockImplementation(() => Promise.resolve(okResponse('恢复后的内容')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        const r1 = await client.callAI('s', 'u', 'test-model', 0.7, 1024);
        expect(r1.error).toBeTruthy();
        expect(getPromptCache().size).toBe(0); // error 未入缓存

        const r2 = await client.callAI('s', 'u', 'test-model', 0.7, 1024);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(r2.content).toBe('恢复后的内容');
    });

    it('TR-3.4: promptCacheEnabled=false 时零缓存行为', async () => {
        const { plugin } = makePlugin({ promptCacheEnabled: false });
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse('x')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        await client.callAI('s', 'u', 'test-model', 0.7, 1024);
        await client.callAI('s', 'u', 'test-model', 0.7, 1024);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getPromptCache().size).toBe(0);
    });

    it('bypassCache=true 时既不读缓存也不写缓存（创意类随机调用）', async () => {
        const { plugin } = makePlugin();
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => Promise.resolve(okResponse('第一次')))
            .mockImplementationOnce(() => Promise.resolve(okResponse('第二次')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        const r1 = await client.callAI('s', 'u', 'test-model', 0.95, 1024, { bypassCache: true });
        const r2 = await client.callAI('s', 'u', 'test-model', 0.95, 1024, { bypassCache: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(r1.content).toBe('第一次');
        expect(r2.content).toBe('第二次');
        expect(getPromptCache().size).toBe(0);
    });

    it('temperature / maxTokens / prompt 变化均 miss（D-6 五元组维度）', async () => {
        const { plugin } = makePlugin();
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse('x')));
        vi.stubGlobal('fetch', fetchMock);

        const client = new AIApiClient(plugin);
        await client.callAI('s', 'u', 'test-model', 0.7, 1024);
        await client.callAI('s', 'u', 'test-model', 0.8, 1024); // temperature
        await client.callAI('s', 'u', 'test-model', 0.8, 2048);  // maxTokens
        await client.callAI('s2', 'u', 'test-model', 0.8, 2048); // system
        await client.callAI('s2', 'u2', 'test-model', 0.8, 2048);// user

        expect(fetchMock).toHaveBeenCalledTimes(5);
    });
});
