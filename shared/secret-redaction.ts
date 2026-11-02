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

/** 深拷贝并把密钥字段替换为占位符 */
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
