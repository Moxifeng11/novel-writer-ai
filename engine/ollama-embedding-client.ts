import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from './embedding/embedding-provider';
import { createLogger } from '../shared/logger';


const log = createLogger('OllamaEmbeddingClient');
export interface OllamaEmbeddingOptions {
    signal?: AbortSignal;
}

/**
 * 单次 embedding 的最大输入字符数。
 * Ollama 对 /api/embeddings 的输入有硬上限，超长直接 HTTP 500
 * `{"error":"the input length exceeds the context length"}`（传 options.num_ctx 无效）。
 * 实测 bge-m3（bert.context_length=8192）：2348 字符通过、2383 字符 500，
 * 因此留出安全余量截断到 2000；知识库检索用整段文本做向量也没有意义。
 */
const EMBED_MAX_INPUT_CHARS = 2_000;

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

        // 超长输入会让 Ollama 直接 500，必须先截断（见 EMBED_MAX_INPUT_CHARS 说明）
        let input = text ?? '';
        if (input.length > EMBED_MAX_INPUT_CHARS) {
            log.debug(`[OllamaEmbeddingClient] 输入 ${input.length} 字符超过上限，截断至 ${EMBED_MAX_INPUT_CHARS}`);
            input = input.slice(0, EMBED_MAX_INPUT_CHARS);
        }

        // 30s 超时：Ollama 在生成任务排队时可能长时间不返回，无超时会让知识库检索永久挂起
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 30_000);
        if (options?.signal) {
            if (options.signal.aborted) {
                clearTimeout(timeoutId);
                throw new Error('Embedding 已取消');
            }
            options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: input,
                }),
                signal: timeoutController.signal,
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
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Ollama embedding 请求超时（30秒），请检查 Ollama 服务是否正常');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
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
