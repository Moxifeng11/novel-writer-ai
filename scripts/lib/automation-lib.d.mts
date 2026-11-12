/**
 * automation-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 默认「过期即失败」阈值（小时） */
export const DEFAULT_MAX_AGE_HOURS: number;
/** 默认「提醒」阈值（小时） */
export const DEFAULT_WARN_AGE_HOURS: number;

/** 台账时效状态 */
export type LedgerFreshnessStatus = 'retired' | 'ok' | 'warn' | 'stale' | 'invalid';

/** 时效评估结果 */
export interface LedgerFreshness {
    status: LedgerFreshnessStatus;
    ageHours: number;
    message: string;
}

/** 解析时间戳 */
export function parseTimestamp(value: string | null | undefined): number;

/** 计算台账年龄（小时） */
export function ledgerAgeHours(updatedAt: string | null | undefined, now: number): number;

/** 评估台账时效 */
export function evaluateLedgerFreshness(input?: {
    updatedAt?: string | null;
    retired?: boolean;
    retiredReason?: string;
    now?: number;
    maxAgeHours?: number;
    warnAgeHours?: number;
}): LedgerFreshness;
