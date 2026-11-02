import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo, EmbeddingOptions } from './embedding-provider';
import { createLogger } from '../../shared/logger';


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

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
        if (controller.signal.aborted) {
            throw new Error(`嵌入请求超时（${EMBED_TIMEOUT_MS / 1000}s）：请检查网络或端点响应`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
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

    async embed(text: string, _options?: EmbeddingOptions): Promise<number[]> {
        const endpoint = `${this.baseUrl}/embeddings`;

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: text,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI embedding API error (HTTP ${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error('Invalid embedding response format');
        }

        if (this.cachedDimensions === null) {
            this.cachedDimensions = embedding.length;
        }

        return embedding as number[];
    }

    async embedBatch(texts: string[], _options?: EmbeddingOptions): Promise<number[][]> {
        const endpoint = `${this.baseUrl}/embeddings`;

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: texts,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI embedding API error (HTTP ${response.status}): ${errorText}`);
        }

        const data = await response.json();
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

    getProviderInfo(): ProviderInfo {
        return {
            type: 'openai',
            name: 'OpenAI 兼容',
            model: this.model,
            dimensions: this.cachedDimensions ?? undefined,
        };
    }

    getModelName(): string {
        return this.model;
    }

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

    getBaseUrl(): string {
        return this.baseUrl;
    }

    getModel(): string {
        return this.model;
    }

    getApiKey(): string {
        return this.apiKey;
    }
}
