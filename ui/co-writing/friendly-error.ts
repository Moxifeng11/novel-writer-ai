/**
 * friendly-error.ts — 生成错误文案转换
 *
 * 从 `ui/co-writing-view.ts` 抽出：纯字符串匹配，无视图状态。
 */

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
    // 必须先于 abort 判断：解锁提示里含有「已取消」，否则会被误判成「生成已取消」
    if (lower.includes('未解锁')) {
        return 'API 密钥未解锁：请输入加密口令后重试';
    }
    if (lower.includes('abort') || lower.includes('取消')) {
        return '生成已取消';
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('网络')) {
        return '网络连接失败，请检查网络连接后重试';
    }
    if (lower.includes('timeout') || lower.includes('超时')) {
        return '请求超时，请稍后重试';
    }
    if (lower.includes('api key') || lower.includes('api_key') || lower.includes('密钥') || lower.includes('认证')) {
        return 'API 密钥无效，请检查设置中的 API 配置';
    }
    if (lower.includes('rate limit') || lower.includes('限流') || lower.includes('429')) {
        return '请求过于频繁，请稍后再试';
    }
    if (lower.includes('model') || lower.includes('模型')) {
        return '模型调用失败，请检查模型配置';
    }
    return error || '生成失败，请重试';
}
