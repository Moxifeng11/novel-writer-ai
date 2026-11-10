import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo, EmbeddingOptions } from './embedding-provider';
import { createLogger } from '@/shared/logger';
import { HttpRequestTimeoutError } from '@/shared/http-request';
import { requestJson, type TransportResponse } from '@/shared/http-transport';


const log = createLogger('OpenaiProvider');
/**
 * OpenAI 兼容向量提供方选项。
 */
export interface OpenAIProviderOptions {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    dimensions?: number;
}

/** 嵌入请求超时：服务端挂起时不能让批量向量化永久等待 */
const EMBED_TIMEOUT_MS = 60_000;

/**
 * 发送嵌入请求。
 *
 * O-1：移动端 fetch 无 CORS 豁免，统一交给 http-transport 走 requestUrl；
 * 桌面端仍是原生 fetch（保留取消/流式语义）。
 */
async function postEmbedding(
    url: string,
    headers: Record<string, string>,
    body: string,
): Promise<TransportResponse> {
    try {
        return await requestJson(url, { headers, body, timeoutMs: EMBED_TIMEOUT_MS });
    } catch (e) {
        if (e instanceof HttpRequestTimeoutError) {
            throw new Error(`嵌入请求超时（${EMBED_TIMEOUT_MS / 1000}s）：请检查网络或端点响应`);
        }
        throw e;
    }
}

const MODEL_DIMENSIONS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    'doubao-embedding-text-240915': 2048,
    'doubao-embedding-text-large-250415': 4096,
    'text-embedding-v1': 1024,
    'text-embedding-v2': 1536,
    'text-embedding-v3': 1024,
};

/**
 * OpenAI 兼容向量提供方。
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private apiKey: string;
    private baseUrl: string;
    private model: string;
    protected cachedDimensions: number | null = null;

    constructor(options: OpenAIProviderOptions = {}) {
        this.apiKey = options.apiKey || '';
        this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        this.model = options.model || 'text-embedding-3-small';
        this.cachedDimensions = options.dimensions || MODEL_DIMENSIONS[this.model] || null;
    }

    /**
     * 生成单条向量。
     *
     * @param text - 文本内容
     * @param _options - 参数
     * @returns 向量
     */
    async embed(text: string, _options?: EmbeddingOptions): Promise<number[]> {
        const endpoint = `${this.baseUrl}/embeddings`;

        const response = await postEmbedding(
            endpoint,
            {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            JSON.stringify({
                model: this.model,
                input: text,
            }),
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI embedding API error (HTTP ${response.status}): ${errorText}`);
        }

        const data = await response.json<{ data?: Array<{ embedding?: number[] }> }>();
        const embedding = data.data?.[0]?.embedding;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error('Invalid embedding response format');
        }

        if (this.cachedDimensions === null) {
            this.cachedDimensions = embedding.length;
        }

        return embedding as number[];
    }

    /**
     * 批量生成向量。
     *
     * @param texts - 文本列表
     * @param _options - 参数
     * @returns 向量数组
     */
    async embedBatch(texts: string[], _options?: EmbeddingOptions): Promise<number[][]> {
        const endpoint = `${this.baseUrl}/embeddings`;

        const response = await postEmbedding(
            endpoint,
            {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            JSON.stringify({
                model: this.model,
                input: texts,
            }),
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI embedding API error (HTTP ${response.status}): ${errorText}`);
        }

        const data = await response.json<{ data?: Array<{ index: number; embedding: number[] }> }>();
        const embeddings = data.data;

        if (!Array.isArray(embeddings) || embeddings.length === 0) {
            throw new Error('Invalid embedding response format');
        }

        const sortedEmbeddings = embeddings
            .sort((a: any, b: any) => a.index - b.index)
            .map((item: any) => item.embedding as number[]);

        if (this.cachedDimensions === null && sortedEmbeddings[0]?.length) {
            this.cachedDimensions = sortedEmbeddings[0].length;
        }

        return sortedEmbeddings;
    }

    /**
     * 提供方是否可用。
     * @returns 布尔值
     */
    async isAvailable(): Promise<EmbeddingAvailability> {
        try {
            if (!this.apiKey) {
                return { available: false, reason: 'API Key 未设置' };
            }
            const testVector = await this.embed('test');
            const available = Array.isArray(testVector) && testVector.length > 0;
            return {
                available,
                model: this.model,
                dimensions: testVector.length,
                reason: available ? undefined : '返回的向量为空',
            };
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            return { available: false, reason };
        }
    }

    /**
     * 提供方信息。
     * @returns 信息
     */
    getProviderInfo(): ProviderInfo {
        return {
            type: 'openai',
            name: 'OpenAI 兼容',
            model: this.model,
            dimensions: this.cachedDimensions ?? undefined,
        };
    }

    /**
     * 模型名。
     * @returns 名称
     */
    getModelName(): string {
        return this.model;
    }

    /**
     * 向量维度。
     * @returns 维度
     */
    async getDimensions(): Promise<number> {
        if (this.cachedDimensions !== null) {
            return this.cachedDimensions;
        }
        try {
            const testVector = await this.embed('test');
            this.cachedDimensions = testVector.length;
            return testVector.length;
        } catch (e) {
            log.warn('[OpenAIEmbeddingProvider] 获取向量维度失败，使用默认值 1536', e);
            return 1536;
        }
    }

    /**
     * Base URL。
     * @returns URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * 模型标识。
     * @returns 模型
     */
    getModel(): string {
        return this.model;
    }

    /**
     * API Key 引用。
     * @returns Key
     */
    getApiKey(): string {
        return this.apiKey;
    }
}
