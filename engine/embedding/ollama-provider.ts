import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo, EmbeddingOptions } from './embedding-provider';
import { createLogger } from '@/shared/logger';
import { requestJson } from '@/shared/http-transport';


const log = createLogger('OllamaProvider');
/**
 * Ollama 向量提供方选项。
 */
export interface OllamaProviderOptions {
    baseUrl?: string;
    model?: string;
    dimensions?: number;
    /** 单次 embedding 最大字符数；超长文本在本地模型上会被服务端静默截断或报错。 */
    maxInputChars?: number;
}

/**
 * Ollama 本地向量提供方。
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private baseUrl: string;
    private model: string;
    private cachedDimensions: number | null = null;
    private maxInputChars: number;

    constructor(options: OllamaProviderOptions = {}) {
        this.baseUrl = (options.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
        this.model = options.model || 'bge-m3';
        this.cachedDimensions = options.dimensions || null;
        this.maxInputChars = options.maxInputChars && options.maxInputChars > 0
            ? options.maxInputChars
            : 6000;
    }

    /**
     * 生成单条向量。
     *
     * @param text - 文本内容
     * @param options - 配置项
     * @returns 向量
     */
    async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
        const endpoint = `${this.baseUrl}/api/embeddings`;
        const safeText = text.length > this.maxInputChars ? text.slice(0, this.maxInputChars) : text;
        if (safeText.length !== text.length) {
            log.debug(`[OllamaProvider] embedding 输入截断 ${text.length} → ${safeText.length} 字符（模型 ${this.model}）`);
        }

        // 创建超时 AbortController
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 30000); // 30秒超时

        // 如果有外部 signal，监听它并转发到 timeoutController
        if (options?.signal) {
            if (options.signal.aborted) {
                clearTimeout(timeoutId);
                throw new Error('Embedding 已取消');
            }
            options.signal.addEventListener('abort', () => timeoutController.abort());
        }

        try {
            // O-1：移动端 fetch 无 CORS 豁免，交由 http-transport 走 requestUrl
            const response = await requestJson(endpoint, {
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: safeText,
                }),
                signal: timeoutController.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama embedding API error (HTTP ${response.status}): ${errorText}`);
            }

            const data = await response.json<{ embedding?: number[] }>();
            const embedding = data.embedding;

            if (!embedding || !Array.isArray(embedding)) {
                throw new Error('Invalid embedding response format');
            }

            if (this.cachedDimensions === null) {
                this.cachedDimensions = embedding.length;
            }

            return embedding as number[];
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error('Ollama embedding 请求超时（30秒），请检查 Ollama 服务是否正常');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * 批量生成向量。
     *
     * @param texts - 文本列表
     * @param options - 配置项
     * @returns 向量数组
     */
    async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
        const MAX_CONCURRENT = 5; // 并发限流

        const executeOne = async (text: string): Promise<number[]> => {
            if (options?.signal?.aborted) {
                throw new Error('Embedding batch 已取消');
            }
            return this.embed(text, options);
        };

        // 简单限流器：最多 MAX_CONCURRENT 个并发
        const results: number[][] = new Array(texts.length);
        let nextIndex = 0;

        const worker = async () => {
            while (nextIndex < texts.length) {
                const currentIndex = nextIndex++;
                if (options?.signal?.aborted) {
                    throw new Error('Embedding batch 已取消');
                }
                results[currentIndex] = await executeOne(texts[currentIndex]);
            }
        };

        // 启动 MAX_CONCURRENT 个 worker
        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(MAX_CONCURRENT, texts.length); i++) {
            workers.push(worker());
        }

        await Promise.all(workers);
        return results;
    }

    /**
     * 提供方是否可用。
     * @returns 布尔值
     */
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

    /**
     * 提供方信息。
     * @returns 信息
     */
    getProviderInfo(): ProviderInfo {
        return {
            type: 'ollama',
            name: '本地 Ollama',
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
            log.warn('[OllamaEmbeddingProvider] 获取向量维度失败，使用默认值 1024', e);
            return 1024;
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
}
