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
 * @param provider - 提供方
  * @returns ModelSourceType 实例
 */
/**
 * 端点是否指向本机/私网（provider 未显式声明 sourceType 时的启发式）。
 *
 * 2026-11-28 修真实缺陷（判定口径漂移）：api-connectivity-service 原来自带一个
 * 只认 localhost/127.0.0.1/0.0.0.0/::1 的 isLocalEndpoint，而本文件认私网段：
 * 192.168.1.8:11434 的 Ollama 在拆解链路判 local、在连通性探测判 cloud，
 * 后者因「无 key」直接报错。两个调用方现共用本函数，口径唯一。
 *
 * @param endpoint - 端点 URL（允许无协议前缀）
 * @returns 是否本机/私网端点
 * @example
 * isPrivateNetworkEndpoint('http://192.168.1.8:11434/v1') // true
 * isPrivateNetworkEndpoint('https://api.example.com/v1') // false
 */
export function isPrivateNetworkEndpoint(endpoint: string): boolean {
    const raw = String(endpoint || '').toLowerCase().trim();
    if (!raw) return false;
    const hostPort = (raw.includes('://') ? raw.split('://')[1] : raw).split('/')[0];
    const host = hostPort.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!host) return false;
    return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.local') ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
}

export function resolveProviderSourceType(provider: ModelSourceLike): ModelSourceType {
    if (provider.sourceType === 'local' || provider.sourceType === 'cloud') {
        return provider.sourceType;
    }
    return provider.id === 'ollama' || isPrivateNetworkEndpoint(provider.endpoint) ? 'local' : 'cloud';
}
