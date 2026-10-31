/**
 * embedding-provider.ts — 嵌入提供者接口（shared 层）
 *
 * 定义从 engine/embedding 下沉：services 层（`genre-classifier` /
 * `knowledge-base-manager`）只按类型使用该接口，不应反向依赖 engine。
 * `engine/embedding/embedding-provider.ts` 保留再导出，engine 内部引用不变。
 */
export interface EmbeddingAvailability {
    available: boolean;
    reason?: string;
    model?: string;
    dimensions?: number;
}

export interface ProviderInfo {
    type: string;
    name: string;
    model: string;
    dimensions?: number;
}

export interface EmbeddingOptions {
    signal?: AbortSignal;
}

export interface EmbeddingProvider {
    embed(text: string, options?: EmbeddingOptions): Promise<number[]>;
    embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
    isAvailable(): Promise<EmbeddingAvailability>;
    getProviderInfo(): ProviderInfo;
    getModelName(): string;
    getDimensions(): Promise<number>;
}
