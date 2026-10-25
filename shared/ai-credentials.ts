/**
 * ai-credentials.ts — 「能否发起 AI 调用」的统一判定
 *
 * 本地推理端点（Ollama / LM Studio / vLLM）无需 API 密钥，
 * `AIApiClient` 早已对 local 端点豁免密钥守卫（isKeylessLocalEndpoint）。
 * 但 UI 层大量入口直接检查 `settings.apiKey`，会把「本地 Ollama + 空密钥」
 * 的内置配置挡在请求之前，表现为「请先配置API密钥」——这与降低云端依赖的目标相反。
 *
 * 所有「生成前守卫」统一走本函数，语义是「密钥存在 或 端点属于本地推理」。
 */

import { resolveProviderSourceType } from './model-source';

export interface AiCredentialSettingsLike {
    apiKey?: string;
    apiEndpoint?: string;
    customProviders?: Array<{
        id?: string;
        endpoint?: string;
        sourceType?: 'local' | 'cloud';
    }>;
}

/** 是否具备发起 AI 调用的凭据：有密钥，或端点是本地免密钥推理服务 */
export function hasUsableAiCredentials(settings: AiCredentialSettingsLike | undefined | null): boolean {
    if (!settings) return false;
    if ((settings.apiKey || '').trim()) return true;

    const endpoint = (settings.apiEndpoint || '').trim();
    if (!endpoint) return false;

    const provider = settings.customProviders?.find(p => (p.endpoint || '').trim() === endpoint);
    return resolveProviderSourceType({
        id: provider?.id || '',
        endpoint,
        sourceType: provider?.sourceType,
    }) === 'local';
}
