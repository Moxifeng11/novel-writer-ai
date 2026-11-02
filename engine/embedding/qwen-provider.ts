import { OpenAIEmbeddingProvider, OpenAIProviderOptions } from './openai-provider';
import type { EmbeddingAvailability, ProviderInfo } from './embedding-provider';

/**
 * 通义向量提供方选项。
 */
export interface QwenProviderOptions extends OpenAIProviderOptions {
}

const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_DEFAULT_MODEL = 'text-embedding-v3';

/**
 * 通义（DashScope）向量提供方。
 */
export class QwenEmbeddingProvider extends OpenAIEmbeddingProvider {
    constructor(options: QwenProviderOptions = {}) {
        super({
            apiKey: options.apiKey || '',
            baseUrl: options.baseUrl || QWEN_DEFAULT_BASE_URL,
            model: options.model || QWEN_DEFAULT_MODEL,
            dimensions: options.dimensions,
        });
    }

    override getProviderInfo(): ProviderInfo {
        return {
            type: 'qwen',
            name: '通义千问',
            model: this.getModel(),
            dimensions: this.cachedDimensions ?? undefined,
        };
    }

    override async isAvailable(): Promise<EmbeddingAvailability> {
        const result = await super.isAvailable();
        return {
            ...result,
            model: this.getModel(),
        };
    }
}
