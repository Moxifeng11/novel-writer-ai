/**
 * secret-redaction.ts — 备份/导出前的密钥脱敏（纯函数）
 *
 * 背景：版本升级会把整份 settings 快照写进 cache.json 的 settingsBackup。
 * 如果当时密钥是明文（或口令会话里已解密），这份快照就成了一处**明文密钥副本**，
 * 且它不受 data.json 的加密治理约束（同步/打包时会被一起带走）。
 *
 * 口径：按字段名识别密钥（apiKey / api_key / token / secret / password），
 * 字符串一律替换成占位符；对象/数组递归处理。非密钥字段原样保留，
 * 保证备份仍可用于"对比旧配置"。
 */

export const REDACTED_VALUE = '***redacted***';

const SECRET_KEY_PATTERN = /(api_?key|token|secret|password|cookie|credential)/i;
/** 「供应商 → 密钥」映射：键名是 provider id，不含 apiKey 字样，需要整表按密钥处理 */
const SECRET_MAP_PATTERN = /provider_?keys/i;

/**
 * 整表按密钥处理：所有非空字符串叶子替换为占位符，保留键名以便排查"配了哪几个供应商"
 *
 * @param map - 映射
 * @returns 映射结果
 */
function redactStringMap(map: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map)) {
        out[key] = typeof value === 'string' ? (value ? REDACTED_VALUE : '') : value;
    }
    return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深拷贝并把密钥字段替换为占位符
 *
 * @param input - 输入
  * @returns T 实例
 */
export function redactSecrets<T>(input: T): T {
    const walk = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(walk);
        if (isPlainObject(value)) {
            const out: Record<string, unknown> = {};
            for (const [key, inner] of Object.entries(value)) {
                if (SECRET_KEY_PATTERN.test(key) && typeof inner === 'string') {
                    out[key] = inner ? REDACTED_VALUE : '';
                    continue;
                }
                if (SECRET_MAP_PATTERN.test(key) && isPlainObject(inner)) {
                    out[key] = redactStringMap(inner);
                    continue;
                }
                out[key] = walk(inner);
            }
            return out;
        }
        return value;
    };
    return walk(input) as T;
}

/**
 * 备份里是否还残留未脱敏的密钥（用于自检/回归）
 *
 * @param input - 输入
 * @returns 是否成功
 */
export function containsPlaintextSecret(input: unknown): boolean {
    const walk = (value: unknown): boolean => {
        if (Array.isArray(value)) return value.some(walk);
        if (isPlainObject(value)) {
            for (const [key, inner] of Object.entries(value)) {
                if (SECRET_KEY_PATTERN.test(key) && typeof inner === 'string' && inner !== REDACTED_VALUE && inner !== '') {
                    return true;
                }
                if (walk(inner)) return true;
            }
        }
        return false;
    };
    return walk(input);
}

/** 密钥在磁盘上的存储形态（用于备份文案/告警，不参与解密） */
export type SecretStorageMode = 'encrypted' | 'obfuscated' | 'plaintext' | 'empty' | 'unknown';

/** 与 core/settings-service 的密文前缀保持一致（v2 会话口令 / v1 旧格式） */
const CIPHER_PREFIX_PATTERN = /^(?:aes256v2:|aes256:)/;
/** 只有 v2 是会话口令派生的真正加密；v1 seed 是公开常量，等同混淆 */
const V2_PREFIX_PATTERN = /^aes256v2:/;

/** 取出顶层已知密钥字段的值（含 providerKeys 映射与 canonResearch.apiKey） */
function collectSecretValues(input: Record<string, unknown>): string[] {
    const values: string[] = [];
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && SECRET_KEY_PATTERN.test(key)) {
            values.push(value);
            continue;
        }
        if (SECRET_MAP_PATTERN.test(key) && isPlainObject(value)) {
            for (const inner of Object.values(value)) {
                if (typeof inner === 'string') values.push(inner);
            }
        }
    }
    if (isPlainObject(input.canonResearch) && typeof input.canonResearch.apiKey === 'string') {
        values.push(input.canonResearch.apiKey);
    }
    return values.filter((value) => value.length > 0 && value !== REDACTED_VALUE);
}

/**
 * 判定一份设置对象里的密钥是密文还是明文。
 *
 * 只要有一个非空密钥不是密文前缀，就按「明文」报告——备份文案不能把
 * 混合/未知状态说成「含密文」；宁可多警告，也不能给用户虚假的安全感。
 *
 * @param input - 已 parse 的 data.json 内容
 * @returns 存储形态；非对象输入返回 `unknown`
 *
 * @example
 * detectSecretStorageMode({ apiKey: 'sk-xxx' }) // 'plaintext'
 * detectSecretStorageMode({ apiKey: 'aes256v2:...' }) // 'encrypted'
 * detectSecretStorageMode({}) // 'empty'
 */
export function detectSecretStorageMode(input: unknown): SecretStorageMode {
    if (!isPlainObject(input)) return 'unknown';
    const values = collectSecretValues(input);
    if (values.length === 0) return 'empty';
    if (!values.every((value) => CIPHER_PREFIX_PATTERN.test(value))) return 'plaintext';
    // S3-10（安全 r3）：v1 密文的 seed 是公开常量，知道库路径即可解密，
    // 不能与 v2（口令派生）一起笼统报「已加密」。
    return values.every((value) => V2_PREFIX_PATTERN.test(value)) ? 'encrypted' : 'obfuscated';
}

/**
 * 从 data.json / data.json.bak 的原始文本判定密钥存储形态。
 *
 * @param raw - 文件文本
 * @returns 存储形态；JSON 解析失败返回 `unknown`
 *
 * @example
 * detectSecretStorageModeFromJson('{"apiKey":"aes256v2:abc"}') // 'encrypted'
 */
export function detectSecretStorageModeFromJson(raw: string): SecretStorageMode {
    try {
        return detectSecretStorageMode(JSON.parse(raw) as unknown);
    } catch {
        return 'unknown';
    }
}
