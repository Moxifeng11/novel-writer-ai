/**
 * model-source.ts — 模型源类型定义与解析
 *
 * v4.11 架构底座：统一「云端 / 本地」模型源抽象。
 * cloud=云端 API（豆包/Gemini/DeepSeek/SenseNova），
 * local=本地推理服务（Ollama / LM Studio / vLLM 等 OpenAI 兼容端点）。
 */

/** 模型源类型：cloud=云端 API，local=本地推理服务 */
export type ModelSourceType = 'cloud' | 'local';

/** 模型源类型的最小描述（用于解析，避免引入 CustomProvider 完整类型） */
export interface ModelSourceLike {
    id: string;
    endpoint: string;
    sourceType?: ModelSourceType;
}

/**
 * 解析模型源类型。
 * 优先使用显式 sourceType 字段；旧数据缺失时按 id/endpoint 启发式兜底，保证向后兼容。
 */
export function resolveProviderSourceType(provider: ModelSourceLike): ModelSourceType {
    if (provider.sourceType === 'local' || provider.sourceType === 'cloud') {
        return provider.sourceType;
    }
    const endpoint = (provider.endpoint || '').toLowerCase();
    const isLocal =
        provider.id === 'ollama' ||
        endpoint.includes('localhost') ||
        endpoint.includes('127.0.0.1');
    return isLocal ? 'local' : 'cloud';
}
