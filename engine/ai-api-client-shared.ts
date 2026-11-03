/**
 * ai-api-client-shared.ts — AI API 客户端的纯工具与响应类型
 *
 * 从 ai-api-client.ts 拆出：错误识别、认证错误、密文识别、JSON 响应结构与端点来源判定。
 * 这些函数无实例状态，可被流式/非流式两条链路及测试独立复用。
 */
import { resolveProviderSourceType } from '@/shared/model-source';

/**
 * 安全提取 Error 的 message，未知类型返回空串
 *
 * @param err - 错误
 * @returns 文本结果
 */
export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
}

/**
 * 认证失败（401/403）专用错误。
 * 单独建模是为了让上层「快速失败」：既不做重试，也不再走模拟流式/完整响应两段降级，
 * 否则同一个失效密钥会被重复发送多次（实测 3 候选 × 3 阶段 × 3 重试 = 15+ 次 401）。
 */
export class AIAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AIAuthError';
    }
}

/**
 * 口令未解锁时 crypto.decrypt 会原样返回密文，据此识别「看起来像密钥但其实是密文」
 *
 * @param secret - 密钥
 * @returns 是否成功
 */
export function isEncryptedSecret(secret: string): boolean {
    return secret.startsWith('aes256v2:') || secret.startsWith('aes256:');
}

/**
 * 判断错误信息是否属于认证失败（用于降级链短路）
 *
 * @param message - 消息
 * @returns 是否成功
 */
export function isAuthErrorMessage(message: string | undefined): boolean {
    if (!message) return false;
    return /HTTP\s+(401|403)\b/.test(message) || message.includes('密钥未解锁');
}

/** API JSON 响应结构 */
export interface AIApiJsonResponse {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
    };
    // Ollama /api/generate 原生字段
    response?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    done?: boolean;
    done_reason?: string;
}

/**
 * 端点来源判定：本地端点未登记模型时使用更保守的能力兜底。
 * 做成模块函数而非类方法，便于在没有完整插件实例的调用场景（测试/工具）复用。
 * @param endpoint - 接口地址
  * @returns 结果
 */
export function resolveEndpointSource(endpoint?: string): 'local' | 'cloud' {
    if (!endpoint) return 'cloud';
    try {
        return resolveProviderSourceType({ id: '', endpoint }) === 'local' ? 'local' : 'cloud';
    } catch {
        return 'cloud';
    }
}
