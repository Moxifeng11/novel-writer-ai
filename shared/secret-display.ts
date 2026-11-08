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

/**
 * 该值是否是磁盘上的密文（v1 或 v2）
 *
 * @param value - 值
 * @returns 是否成功
 */
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
 *
 * @param value - 原始密钥值
 * @returns 输入框显示文案与提示
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
 * @param pending - 待处理项
 * @param current - 当前
 * @returns 文本结果
 */
export function resolveSecretInput(pending: string | undefined | null, current: unknown): string {
    const trimmed = String(pending ?? '').trim();
    if (trimmed) return trimmed;
    return typeof current === 'string' ? current : '';
}

/** 密钥落盘状态的输入（来自 SettingsService 的只读计数） */
export interface KeyEncryptionStatusInput {
    /** 磁盘上处于加密状态、当前不可读的条目数 */
    locked: number;
    /** 磁盘上是否存在任何加密的密钥条目（含本次会话已解锁的） */
    encrypted: boolean;
    /** v1 旧格式条目数（下次保存会升级） */
    legacy: number;
}

/** 密钥落盘状态的展示文案 */
export interface KeyEncryptionStatusDescription {
    /** 设置页展示的状态说明 */
    text: string;
    /** true = 当前密钥以明文落盘（未设口令且从未加密过） */
    plaintext: boolean;
}

/**
 * 描述密钥落盘状态（S-4 决策 B，2026-11-09 用户拍板）。
 *
 * 背景：未设置口令且密钥从未加密过时，插件会把 Key **明文**写进 data.json，
 * 并随 vault 同步/备份扩散。用户拍板「保持明文，但必须明确标注风险」。
 * 状态文案集中在这里，保证设置页只有一处口径、且可单测。
 *
 * @param input - 加密条目计数
 * @returns 展示文案与「是否明文」标记
 */
export function describeKeyEncryptionStatus(input: KeyEncryptionStatusInput): KeyEncryptionStatusDescription {
    const legacyHint = input.legacy > 0 ? ` 另有 ${input.legacy} 项旧版加密条目，下次保存时自动升级。` : '';
    if (input.locked > 0) {
        return {
            text: `磁盘上有 ${input.locked} 项密钥处于加密状态。重启或更新后需要输入口令才能读取。${legacyHint}`,
            plaintext: false,
        };
    }
    if (input.encrypted) {
        return {
            text: `密钥已加密（本次会话已解锁）。重启或更新后需要输入口令才能读取。${legacyHint}`,
            plaintext: false,
        };
    }
    return {
        text: '⚠️ 未设置口令：API Key 等密钥会以**明文**保存在插件 data.json，'
            + '并随 vault 同步/备份扩散。共享或公开库请勿填写真实 Key；建议点击右侧设定口令。'
            + legacyHint,
        plaintext: true,
    };
}
