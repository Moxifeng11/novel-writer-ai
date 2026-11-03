import type { EmbeddingProvider } from './embedding-provider';
import { OllamaEmbeddingProvider } from './ollama-provider';
import { OpenAIEmbeddingProvider } from './openai-provider';
import { DoubaoEmbeddingProvider } from './doubao-provider';
import { QwenEmbeddingProvider } from './qwen-provider';
import { createLogger } from '@/shared/logger';


const log = createLogger('ProviderFactory');
/**
 * 向量提供方类型。
 */
export type VectorProviderType = 'ollama' | 'openai' | 'doubao' | 'qwen';

/**
 * 向量运行模式。
 */
export type EmbeddingMode = 'auto' | 'primary' | 'hybrid';

/**
 * 提供方工厂配置。
 */
export interface ProviderFactoryConfig {
    vectorProviderType: VectorProviderType;
    vectorMode?: EmbeddingMode;
    vectorHybridThreshold?: number;
    vectorOllamaBaseUrl: string;
    vectorOllamaModel: string;
    vectorOpenaiBaseUrl: string;
    vectorOpenaiModel: string;
    vectorOpenaiApiKey: string;
    vectorDoubaoBaseUrl?: string;
    vectorDoubaoModel?: string;
    vectorDoubaoApiKey?: string;
    vectorQwenBaseUrl?: string;
    vectorQwenModel?: string;
    vectorQwenApiKey?: string;
    embeddingEndpoint?: string;
    embeddingModel?: string;
    /** embedding 不可用时的回退策略；默认 local-only，避免本地文本静默发到云端。 */
    embeddingFallbackPolicy?: 'never' | 'local-only' | 'allow-cloud';
}

/**
 * 向量提供方工厂：按配置创建与降级。
 */
export class EmbeddingProviderFactory {
    /**
     * 按插件设置构造 provider（缺省值集中在工厂里，调用方不再各自写死 Ollama）。
     * 不做可用性探测：切章等高频路径直接构造，失败由 embed 调用侧的降级逻辑处理。
     * @param config - 配置
      * @returns EmbeddingProvider 实例
     */
    static fromSettings(config?: Partial<ProviderFactoryConfig>): EmbeddingProvider {
        const c = config ?? {};
        return this.create({
            vectorProviderType: c.vectorProviderType ?? 'ollama',
            vectorMode: c.vectorMode,
            vectorHybridThreshold: c.vectorHybridThreshold,
            vectorOllamaBaseUrl: c.vectorOllamaBaseUrl ?? '',
            vectorOllamaModel: c.vectorOllamaModel ?? '',
            vectorOpenaiBaseUrl: c.vectorOpenaiBaseUrl ?? '',
            vectorOpenaiModel: c.vectorOpenaiModel ?? '',
            vectorOpenaiApiKey: c.vectorOpenaiApiKey ?? '',
            vectorDoubaoBaseUrl: c.vectorDoubaoBaseUrl,
            vectorDoubaoModel: c.vectorDoubaoModel,
            vectorDoubaoApiKey: c.vectorDoubaoApiKey,
            vectorQwenBaseUrl: c.vectorQwenBaseUrl,
            vectorQwenModel: c.vectorQwenModel,
            vectorQwenApiKey: c.vectorQwenApiKey,
            embeddingEndpoint: c.embeddingEndpoint,
            embeddingModel: c.embeddingModel,
            embeddingFallbackPolicy: c.embeddingFallbackPolicy,
        });
    }

    /**
     * 创建。
     * @param config - 配置
      * @returns EmbeddingProvider 实例
     */
    static create(config: ProviderFactoryConfig): EmbeddingProvider {
        const providerType = config.vectorProviderType || this.inferProviderType(config);

        switch (providerType) {
            case 'ollama':
                return this.createOllamaProvider(config);
            case 'openai':
                return this.createOpenAIProvider(config);
            case 'doubao':
                return this.createDoubaoProvider(config);
            case 'qwen':
                return this.createQwenProvider(config);
            default:
                return this.createOllamaProvider(config);
        }
    }

    private static inferProviderType(config: ProviderFactoryConfig): VectorProviderType {
        if (config.vectorProviderType) {
            return config.vectorProviderType;
        }
        return 'ollama';
    }

    private static createOllamaProvider(config: ProviderFactoryConfig): OllamaEmbeddingProvider {
        const baseUrl = config.vectorOllamaBaseUrl || config.embeddingEndpoint || 'http://localhost:11434';
        const model = config.vectorOllamaModel || config.embeddingModel || 'bge-m3';
        return new OllamaEmbeddingProvider({ baseUrl, model });
    }

    private static createOpenAIProvider(config: ProviderFactoryConfig): OpenAIEmbeddingProvider {
        const apiKey = config.vectorOpenaiApiKey || '';
        const baseUrl = config.vectorOpenaiBaseUrl || 'https://api.openai.com/v1';
        const model = config.vectorOpenaiModel || 'text-embedding-3-small';
        return new OpenAIEmbeddingProvider({ apiKey, baseUrl, model });
    }

    private static createDoubaoProvider(config: ProviderFactoryConfig): DoubaoEmbeddingProvider {
        const apiKey = config.vectorDoubaoApiKey || config.vectorOpenaiApiKey || '';
        const baseUrl = config.vectorDoubaoBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
        const model = config.vectorDoubaoModel || 'doubao-embedding-text-240915';
        return new DoubaoEmbeddingProvider({ apiKey, baseUrl, model });
    }

    private static createQwenProvider(config: ProviderFactoryConfig): QwenEmbeddingProvider {
        const apiKey = config.vectorQwenApiKey || '';
        const baseUrl = config.vectorQwenBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        const model = config.vectorQwenModel || 'text-embedding-v3';
        return new QwenEmbeddingProvider({ apiKey, baseUrl, model });
    }

    /**
     * createWithFallback 方法。
     * @param config - 配置
      * @returns EmbeddingProvider 实例
     */
    static async createWithFallback(config: ProviderFactoryConfig): Promise<EmbeddingProvider> {
        const primaryProvider = this.create(config);
        const primaryAvailable = await primaryProvider.isAvailable();

        if (primaryAvailable.available) {
            return primaryProvider;
        }

        log.warn(`[EmbeddingProviderFactory] 主 provider (${config.vectorProviderType}) 不可用: ${primaryAvailable.reason}`);

        const policy = config.embeddingFallbackPolicy ?? 'local-only';
        if (policy === 'never') {
            throw new Error(
                `主向量 provider 不可用，且回退策略为 never。主 provider (${config.vectorProviderType}): ${primaryAvailable.reason || '未知错误'}`
            );
        }
        // local-only：只允许尝试本地 Ollama，绝不把文本静默发到云端。
        const fallbackOrder = this.getFallbackOrder(config.vectorProviderType)
            .filter(t => policy === 'allow-cloud' || t === 'ollama');

        for (const fallbackType of fallbackOrder) {
            try {
                const fallbackConfig: ProviderFactoryConfig = {
                    ...config,
                    vectorProviderType: fallbackType,
                };
                const fallbackProvider = this.create(fallbackConfig);
                const fallbackAvailable = await fallbackProvider.isAvailable();

                if (fallbackAvailable.available) {
                    log.warn(`[EmbeddingProviderFactory] 已按策略 ${policy} 降级到 ${fallbackType}`);
                    return fallbackProvider;
                }
            } catch (e) {
                log.warn(`[EmbeddingProviderFactory] 降级 provider ${fallbackType} 创建失败`, e);
            }
        }

        throw new Error(
            `所有可用的向量 provider 均不可用（策略 ${policy}）。主 provider (${config.vectorProviderType}): ${primaryAvailable.reason || '未知错误'}`
        );
    }

    private static getFallbackOrder(primaryType: VectorProviderType): VectorProviderType[] {
        const allTypes: VectorProviderType[] = ['ollama', 'openai', 'doubao', 'qwen'];
        return allTypes.filter(t => t !== primaryType);
    }

    /**
     * 获取全部提供方类型列表。
     * @returns 结果数组
     */
    static getAllProviderTypes(): VectorProviderType[] {
        return ['ollama', 'openai', 'doubao', 'qwen'];
    }

    /**
     * 获取提供方标签。
     * @param type - 类型
     * @returns 文本结果
     */
    static getProviderLabel(type: VectorProviderType): string {
        const labels: Record<VectorProviderType, string> = {
            ollama: '本地 Ollama',
            openai: 'OpenAI 兼容',
            doubao: '豆包/火山引擎',
            qwen: '通义千问',
        };
        return labels[type];
    }
}
