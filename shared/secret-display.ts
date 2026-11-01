/**
 * secret-display.ts — 密钥字段的展示辅助（纯函数，可测）
 *
 * 背景（2026-10-29）：
 * 加密启用后，`settings.providerKeys[id]` 在未解锁时保存的是密文
 * （`aes256v2:...`）。设置页此前直接把内存值塞进输入框，用户会看到一长串
 * 密文；一旦误编辑并失焦，还会把这段乱码当成新密钥保存。
 *
 * 展示层应把密文当成「已加密但未解锁」的状态来处理：输入框留空 + 提示语，
 * 而不是把密文露出来。
 */

/** 与 crypto-service 保持一致的密文前缀 */
const V2_PREFIX = 'aes256v2:';
const V1_PREFIX = 'aes256:';

/** 该值是否是磁盘上的密文（v1 或 v2） */
export function isStoredCiphertext(value: unknown): boolean {
    return typeof value === 'string'
        && (value.startsWith(V2_PREFIX) || value.startsWith(V1_PREFIX));
}

/** 输入框留空，用这个作为占位提示 */
export const SECRET_LOCKED_PLACEHOLDER = '已加密 · 输入口令解锁后可修改';

/**
 * 决定密钥输入框该如何显示：
 * - 密文 → 输入框留空（不泄露密文），给出提示与说明
 * - 明文 → 直接显示
 */
export function describeSecretForInput(value: unknown): {
    /** 输入框应显示的值 */
    value: string;
    /** 占位提示 */
    placeholder: string;
    /** 悬停说明 */
    title: string;
} {
    if (isStoredCiphertext(value)) {
        return {
            value: '',
            placeholder: SECRET_LOCKED_PLACEHOLDER,
            title: '磁盘上保存的是加密密钥。输入口令解锁后才能看到明文；直接输入新密钥会要求先解锁。',
        };
    }
    const text = typeof value === 'string' ? value : '';
    return {
        value: text,
        placeholder: 'sk-...',
        title: text ? '当前密钥（已保存）' : '尚未填写密钥',
    };
}

/**
 * 合并一次「可能未修改」的密钥输入。
 *
 * 加密锁定态下输入框是空的；用户只是切页签/保存时，不能把空值当成
 * 「清空密钥」写回去。规则与主 API Key 一致：只有输入了非空内容才算修改。
 */
export function resolveSecretInput(pending: string | undefined | null, current: unknown): string {
    const trimmed = String(pending ?? '').trim();
    if (trimmed) return trimmed;
    return typeof current === 'string' ? current : '';
}
