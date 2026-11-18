/**
 * friendly-error.ts — 生成错误文案转换
 *
 * 从 `ui/co-writing-view.ts` 抽出：纯字符串匹配，无视图状态。
 */

import { t } from '@/i18n';

/**
 * 将底层错误文本转换为用户可读提示。
 *
 * 判断顺序有约束：「未解锁」必须先于「取消」，否则加密解锁提示会被误判为生成已取消。
 *
 * @param error - 原始错误文本
 * @returns 用户可读提示
 * @example
 * ```ts
 * const message = getFriendlyErrorMessage(engineError);
 * showErrorNotice(message);
 * ```
 */
export function getFriendlyErrorMessage(error: string): string {
    const lower = error.toLowerCase();
    // 已解锁但密文与口令不匹配：重输同一口令无用，只能重新填写密钥（2026-11-17）
    if (lower.includes('口令不匹配')) {
        return t('cowrite.err.keyMismatch');
    }
    // 必须先于 abort 判断：解锁提示里含有「已取消」，否则会被误判成「生成已取消」
    if (lower.includes('未解锁')) {
        return t('cowrite.err.keyLocked');
    }
    if (lower.includes('abort') || lower.includes('取消')) {
        return t('cowrite.err.cancelledGen');
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('网络')) {
        return t('cowrite.err.network');
    }
    if (lower.includes('timeout') || lower.includes('超时')) {
        return t('cowrite.err.timeout');
    }
    if (lower.includes('api key') || lower.includes('api_key') || lower.includes('密钥') || lower.includes('认证')) {
        return t('cowrite.err.keyInvalid');
    }
    if (lower.includes('rate limit') || lower.includes('限流') || lower.includes('429')) {
        return t('cowrite.err.rateLimit');
    }
    if (lower.includes('model') || lower.includes('模型')) {
        return t('cowrite.err.modelFailed');
    }
    return error || t('cowrite.genFailedRetry');
}
