import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from './embedding/embedding-provider';
import { createLogger } from '../shared/logger';


const log = createLogger('OllamaEmbeddingClient');
export interface OllamaEmbeddingOptions {
    signal?: AbortSignal;
}

export class OllamaEmbeddingClient implements EmbeddingProvider {
    private baseUrl: string;
    private model: string;
    private cachedDimensions: number | null = null;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'bge-m3') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.model = model;
    }

    async embed(text: string, options?: OllamaEmbeddingOptions): Promise<number[]> {
        const endpoint = `${this.baseUrl}/api/embeddings`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                prompt: text,
            }),
            signal: options?.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama embedding API error (HTTP ${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.embedding;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error('Invalid embedding response format');
        }

        if (this.cachedDimensions === null) {
            this.cachedDimensions = embedding.length;
        }

        return embedding as number[];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const text of texts) {
            const embedding = await this.embed(text);
            results.push(embedding);
        }
        return results;
    }

    async isAvailable(): Promise<EmbeddingAvailability> {
        try {
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
            type: 'ollama',
            name: '本地 Ollama',
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
            log.warn('[OllamaEmbeddingClient] 获取向量维度失败，使用默认值 1024', e);
            return 1024;
        }
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    getModel(): string {
        return this.model;
    }
}
