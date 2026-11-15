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
import { isStoredCiphertext } from './secret-value';

/**
 * AiCredentialSettingsLike 类型定义。
 */
export interface AiCredentialSettingsLike {
    apiKey?: string;
    apiEndpoint?: string;
    /** 各供应商独立的密钥（切换供应商时 apiKey 与它同步，但可能只有这边有值） */
    providerKeys?: Record<string, string>;
    customProviders?: Array<{
        id?: string;
        endpoint?: string;
        sourceType?: 'local' | 'cloud';
    }>;
}

/**
 * 取当前端点所属供应商名下的密钥（`settings.providerKeys[providerId]`）。
 *
 * 为什么需要它：`settings.apiKey` 只在 ProviderManager.switchProvider 时
 * 从 providerKeys 同步过来。以下场景 apiKey 为空但 providerKeys 有值：
 * - 插件重载 / Obsidian 重启后从未切换过供应商
 * - 用户只在「供应商管理」里填了密钥，没点过「切换」
 * - 设置迁移清空了 apiKey
 *
 * 这些情况下 UI 守卫 `hasUsableAiCredentials` 能过（它看 providerKeys），
 * 但 AI 调用只读 apiKey 就会误报「API密钥未配置」——表现为「明明配了密钥却无法生成」。
 * 生产环境实测复现过（DeepSeek 官网配置，providerKeys.deepseek 有值、apiKey 为空）。
 *
 * @param settings - 设置
 * @param endpoint - 当前端点
 * @returns 供应商密钥；无匹配返回空串
 */
export function resolveProviderApiKey(
    settings: AiCredentialSettingsLike | undefined | null,
    endpoint: string | undefined,
): string {
    const trimmed = (endpoint || '').trim();
    if (!settings || !trimmed) return '';
    const provider = settings.customProviders?.find(p => (p.endpoint || '').trim() === trimmed);
    const providerKey = provider?.id ? settings.providerKeys?.[provider.id] : undefined;
    return (providerKey || '').trim();
}

/**
 * 密钥是否以密文形式存在且当前未解锁（用于给出「请先解锁口令」而不是「请先配置密钥」）。
 *
 * @param settings - 设置
 * @returns 是否锁定态
 */
export function aiCredentialsLocked(settings: AiCredentialSettingsLike | undefined | null): boolean {
    if (!settings) return false;
    if (isStoredCiphertext(settings.apiKey)) return true;
    return Object.values(settings.providerKeys || {}).some(value => isStoredCiphertext(value));
}

/**
 * 是否具备发起 AI 调用的凭据：有密钥，或端点是本地免密钥推理服务
 *
 * @param settings - 设置
 * @returns 是否成功
 */
export function hasUsableAiCredentials(settings: AiCredentialSettingsLike | undefined | null): boolean {
    if (!settings) return false;
    // 密文也视为「有凭据」：放行后由 AIApiClient.resolveApiKey 弹口令解锁；
    // 若在这里判 false，用户会看到「请先配置密钥」而被挡在解锁流程之外（实测踩坑）。
    // 需要区分「未配置 / 已加密未解锁」的入口请用 aiCredentialsLocked()。
    if ((settings.apiKey || '').trim()) return true;

    const endpoint = (settings.apiEndpoint || '').trim();
    if (!endpoint) return false;

    // 只看 apiKey 会漏掉「密钥只存在供应商名下」的情况（见 resolveProviderApiKey 注释）
    if (resolveProviderApiKey(settings, endpoint)) return true;

    const provider = settings.customProviders?.find(p => (p.endpoint || '').trim() === endpoint);
    return resolveProviderSourceType({
        id: provider?.id || '',
        endpoint,
        sourceType: provider?.sourceType,
    }) === 'local';
}
