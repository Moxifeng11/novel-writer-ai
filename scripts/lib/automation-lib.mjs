/**
 * automation-lib.mjs — 自动化台账的时效判定（可测试）
 *
 * 背景（Trae preflight 审计 P1）：`check:automation` 只校验台账**格式**
 * （schemaVersion / round 正整数 / updatedAt 带时区 / 轮次单调 / 三处一致），
 * 却从不看 `updatedAt` 有多旧——实测 round 123 停在 2026-11-09、落后 3 天，
 * 门禁仍然全绿。这正是「门禁看起来在检查，实际没检查」的典型。
 *
 * 但直接加「过期即失败」会误伤：2026-11-12 用户关闭了 ZCode/Trae 的 30 分钟轮询，
 * 改由任务板（`.trae/board`）派发任务，这个台账**已经退役**。
 * 对一个已退役的台账要求「保持新鲜」是荒谬的。
 *
 * 因此引入显式退役语义：
 * - `retired: true` → 跳过时效校验（但仍校验格式，防止退役台账被写坏）
 * - 未退役且超过 `maxAgeHours` → 失败（轮询可能已停摆）
 * - 未退役但超过 `warnAgeHours` → 告警
 */

/** 默认「过期即失败」阈值（小时） */
export const DEFAULT_MAX_AGE_HOURS = 72;
/** 默认「提醒」阈值（小时） */
export const DEFAULT_WARN_AGE_HOURS = 24;

/**
 * 解析时间戳（ISO 8601，带时区）。
 *
 * @param value - 时间字符串
 * @returns 毫秒时间戳；非法返回 NaN
 */
export function parseTimestamp(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return NaN;
    return Date.parse(raw);
}

/**
 * 计算台账年龄（小时）。
 *
 * @param updatedAt - updatedAt 字符串
 * @param now - 当前时间戳（毫秒）
 * @returns 小时数；无法解析返回 NaN
 */
export function ledgerAgeHours(updatedAt, now) {
    const ts = parseTimestamp(updatedAt);
    if (!Number.isFinite(ts)) return NaN;
    return (Number(now) - ts) / 3_600_000;
}

/**
 * 评估台账时效。
 *
 * 返回 `status`：
 * - `retired`：已退役，跳过时效校验
 * - `ok`：在提醒阈值内
 * - `warn`：超过提醒阈值但未超失败阈值
 * - `stale`：超过失败阈值
 * - `invalid`：updatedAt 无法解析
 *
 * @param input - 评估输入
 * @param input.updatedAt - 台账 updatedAt
 * @param input.retired - 是否已退役
 * @param input.retiredReason - 退役原因（用于提示文案）
 * @param input.now - 当前时间戳
 * @param input.maxAgeHours - 失败阈值（小时）
 * @param input.warnAgeHours - 提醒阈值（小时）
 * @returns 评估结果
 */
export function evaluateLedgerFreshness({
    updatedAt,
    retired = false,
    retiredReason = '',
    now,
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
    warnAgeHours = DEFAULT_WARN_AGE_HOURS,
} = {}) {
    if (retired === true) {
        return {
            status: 'retired',
            ageHours: ledgerAgeHours(updatedAt, now),
            message: `活跃状态台账已退役（${retiredReason || '轮询已被任务板取代'}），跳过时效校验`,
        };
    }
    const ageHours = ledgerAgeHours(updatedAt, now);
    if (!Number.isFinite(ageHours)) {
        return {
            status: 'invalid',
            ageHours: NaN,
            message: `状态台账 updatedAt 无法解析：${String(updatedAt ?? '')}`,
        };
    }
    if (ageHours > maxAgeHours) {
        return {
            status: 'stale',
            ageHours,
            message: `状态台账已 ${ageHours.toFixed(1)} 小时未更新（阈值 ${maxAgeHours}h）：轮询可能已停摆。`
                + '若已改用任务板，请在台账加 retired:true 与 retiredReason；确需放宽用 --max-age-hours',
        };
    }
    if (ageHours > warnAgeHours) {
        return {
            status: 'warn',
            ageHours,
            message: `状态台账已 ${ageHours.toFixed(1)} 小时未更新（提醒阈值 ${warnAgeHours}h）`,
        };
    }
    return {
        status: 'ok',
        ageHours,
        message: `状态台账 ${ageHours.toFixed(1)} 小时前更新`,
    };
}
