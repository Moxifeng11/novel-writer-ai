import { OpenAIEmbeddingProvider, OpenAIProviderOptions } from './openai-provider';
import type { EmbeddingAvailability, ProviderInfo } from './embedding-provider';

export interface DoubaoProviderOptions extends OpenAIProviderOptions {
}

const DOUBAO_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DOUBAO_DEFAULT_MODEL = 'doubao-embedding-text-240915';

export class DoubaoEmbeddingProvider extends OpenAIEmbeddingProvider {
    constructor(options: DoubaoProviderOptions = {}) {
        super({
            apiKey: options.apiKey || '',
            baseUrl: options.baseUrl || DOUBAO_DEFAULT_BASE_URL,
            model: options.model || DOUBAO_DEFAULT_MODEL,
            dimensions: options.dimensions,
        });
    }

    override getProviderInfo(): ProviderInfo {
        return {
            type: 'doubao',
            name: '豆包/火山引擎',
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
