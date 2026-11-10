/**
 * secret-value.ts — 存储态密钥的边界判定（S3-4 安全 r3）。
 *
 * 设置里的密钥在启用口令后以 `aes256:` / `aes256v2:` 密文形式存在；锁定态下
 * `decryptWithoutPrompt` 会原样返回密文。密文**绝不能**当凭据发给任何服务：
 * 既会静默 401，也等于把可离线爆破的密文交给第三方日志。
 */

/**
 * 值是否为存储态密文（v1/v2）。
 *
 * @param value - 设置里的原始值
 * @returns 是否为 `aes256:` / `aes256v2:` 前缀的密文
 */
export function isStoredCiphertext(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return /^aes256v2:|^aes256:/.test(value.trim());
}

/**
 * 网络边界取密钥：密文一律视为「未解锁」，返回空串由调用方按未配置处理。
 *
 * @param value - 设置里的原始值
 * @returns 可直接用于请求头的明文密钥；密文/空值返回 ''
 */
export function usableSecret(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || isStoredCiphertext(text)) return '';
    return text;
}
