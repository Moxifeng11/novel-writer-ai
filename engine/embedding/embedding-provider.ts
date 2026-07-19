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
