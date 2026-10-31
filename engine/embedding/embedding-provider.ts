/**
 * embedding-provider.ts — engine 层嵌入接口入口
 *
 * 接口定义已下沉 `shared/embedding-provider.ts`（services 层也要按类型使用）；
 * 本文件仅再导出，engine / ui / tests 既有 `./embedding-provider` 引用不变。
 */
export type {
    EmbeddingAvailability,
    ProviderInfo,
    EmbeddingOptions,
    EmbeddingProvider,
} from '../../shared/embedding-provider';
