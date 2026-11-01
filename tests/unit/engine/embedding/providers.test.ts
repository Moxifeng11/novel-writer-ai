/**
 * Embedding providers — 请求契约与错误处理（G7-4b）
 *
 * 这些 provider 是「检索恒为空 / 静默降级」的高发点：端点、模型名、
 * 鉴权头、响应形状任一错都不会抛到 UI，只会表现为「检索没结果」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIEmbeddingProvider } from '../../../../engine/embedding/openai-provider';
import { DoubaoEmbeddingProvider } from '../../../../engine/embedding/doubao-provider';
import { QwenEmbeddingProvider } from '../../../../engine/embedding/qwen-provider';
import { OllamaEmbeddingProvider } from '../../../../engine/embedding/ollama-provider';

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function okJson(data: unknown) {
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function errJson(status: number, text: string) {
    return { ok: false, status, json: async () => ({}), text: async () => text };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('OpenAIEmbeddingProvider', () => {
    it('请求端点/鉴权/请求体正确，返回向量并缓存维度', async () => {
        const fetchMock = mockFetch(() => okJson({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
        const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test', model: 'text-embedding-3-small' });

        const vector = await provider.embed('一段文本');

        expect(vector).toEqual([0.1, 0.2, 0.3]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/embeddings');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
        expect(JSON.parse(String(init.body))).toEqual({ model: 'text-embedding-3-small', input: '一段文本' });
        // 已知模型沿用内置维度（1536），不被响应长度覆盖
        expect(provider.getProviderInfo().dimensions).toBe(1536);
    });

    it('未知模型首次调用后按响应长度记录维度', async () => {
        mockFetch(() => okJson({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
        const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test', model: 'my-custom-embed' });

        await provider.embed('文本');

        expect(provider.getProviderInfo().dimensions).toBe(3);
    });

    it('HTTP 错误抛出带状态与响应体', async () => {
        mockFetch(() => errJson(401, 'invalid api key'));
        const provider = new OpenAIEmbeddingProvider({ apiKey: 'bad' });
        await expect(provider.embed('文本')).rejects.toThrow(/HTTP 401.*invalid api key/);
    });

    it('响应形状不对时明确报错（而不是返回空向量）', async () => {
        mockFetch(() => okJson({ data: [] }));
        const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
        await expect(provider.embed('文本')).rejects.toThrow('Invalid embedding response format');
    });

    it('embedBatch 发送数组并按顺序返回', async () => {
        const fetchMock = mockFetch(() => okJson({
            data: [{ embedding: [1] }, { embedding: [2] }],
        }));
        const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });

        const vectors = await provider.embedBatch(['甲', '乙']);

        expect(vectors).toEqual([[1], [2]]);
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).input).toEqual(['甲', '乙']);
    });
});

describe('Doubao / Qwen 默认端点与模型', () => {
    it('豆包使用 ark 端点与 doubao 默认模型', async () => {
        const fetchMock = mockFetch(() => okJson({ data: [{ embedding: [0.5] }] }));
        const provider = new DoubaoEmbeddingProvider({ apiKey: 'ark-key' });

        await provider.embed('文本');

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings');
        expect(JSON.parse(String(init.body)).model).toBe('doubao-embedding-text-240915');
    });

    it('千问使用 dashscope 兼容端点与 text-embedding-v3', async () => {
        const fetchMock = mockFetch(() => okJson({ data: [{ embedding: [0.5] }] }));
        const provider = new QwenEmbeddingProvider({ apiKey: 'qwen-key' });

        await provider.embed('文本');

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
        expect(JSON.parse(String(init.body)).model).toBe('text-embedding-v3');
    });
});

describe('OllamaEmbeddingProvider', () => {
    it('使用 /api/embeddings 与 prompt 字段，解析 embedding', async () => {
        const fetchMock = mockFetch(() => okJson({ embedding: [0.9, 0.8] }));
        const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'bge-m3' });

        const vector = await provider.embed('文本');

        expect(vector).toEqual([0.9, 0.8]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/embeddings');
        expect(JSON.parse(String(init.body))).toEqual({ model: 'bge-m3', prompt: '文本' });
    });

    it('超长输入按 maxInputChars 截断后再发', async () => {
        const fetchMock = mockFetch(() => okJson({ embedding: [0.1] }));
        const provider = new OllamaEmbeddingProvider({ maxInputChars: 10 });

        await provider.embed('字'.repeat(50));

        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).prompt).toHaveLength(10);
    });

    it('HTTP 错误抛出 Ollama 前缀与状态', async () => {
        mockFetch(() => errJson(500, 'model not found'));
        const provider = new OllamaEmbeddingProvider();
        await expect(provider.embed('文本')).rejects.toThrow(/Ollama embedding API error.*500/);
    });

    it('外部 signal 已取消时直接抛「已取消」，不发请求', async () => {
        const fetchMock = mockFetch(() => okJson({ embedding: [0.1] }));
        const provider = new OllamaEmbeddingProvider();
        const controller = new AbortController();
        controller.abort();

        await expect(provider.embed('文本', { signal: controller.signal })).rejects.toThrow('已取消');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
