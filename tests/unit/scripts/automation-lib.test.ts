/**
 * 台账时效判定回归（Trae preflight 审计 P1）
 *
 * 审计结论：`check:automation` 只校验台账**格式**，从不看 `updatedAt` 有多旧——
 * 实测 round 123 停在 2026-11-09、落后 3 天，门禁仍然全绿。
 * 「门禁看起来在检查，实际没检查」正是长期目标要消灭的那类缺陷。
 *
 * 但直接加「过期即失败」会误伤：2026-11-12 用户关闭了 30 分钟轮询、改由任务板派发，
 * 这个台账已退役。对退役台账要求「保持新鲜」是荒谬的。
 * 因此本模块锁两条：
 * 1. 未退役 + 超阈值 → stale（失败）
 * 2. retired:true → 跳过时效（但仍受格式校验约束）
 */

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MAX_AGE_HOURS,
    DEFAULT_WARN_AGE_HOURS,
    evaluateLedgerFreshness,
    ledgerAgeHours,
    parseTimestamp,
} from '../../../scripts/lib/automation-lib.mjs';

const NOW = Date.parse('2026-11-12T12:00:00+08:00');
const HOUR = 3_600_000;

/** 造 N 小时前的时间戳字符串 */
function hoursAgo(hours: number): string {
    return new Date(NOW - hours * HOUR).toISOString();
}

describe('时效-1：时间解析与年龄计算', () => {
    it('解析带时区的 ISO 时间', () => {
        expect(parseTimestamp('2026-11-12T12:00:00+08:00')).toBe(NOW);
    });

    it('非法/空值返回 NaN', () => {
        expect(Number.isNaN(parseTimestamp(''))).toBe(true);
        expect(Number.isNaN(parseTimestamp(null))).toBe(true);
        expect(Number.isNaN(parseTimestamp('不是时间'))).toBe(true);
    });

    it('年龄按小时计算', () => {
        expect(ledgerAgeHours(hoursAgo(5), NOW)).toBeCloseTo(5, 1);
        expect(ledgerAgeHours(hoursAgo(0), NOW)).toBeCloseTo(0, 1);
    });

    it('未来时间得到负年龄（不误判为过期）', () => {
        expect(ledgerAgeHours(hoursAgo(-2), NOW)).toBeLessThan(0);
    });
});

describe('时效-2：阈值判定', () => {
    it('默认阈值：失败 72h / 提醒 24h', () => {
        expect(DEFAULT_MAX_AGE_HOURS).toBe(72);
        expect(DEFAULT_WARN_AGE_HOURS).toBe(24);
    });

    it('新鲜（< 24h）→ ok', () => {
        const r = evaluateLedgerFreshness({ updatedAt: hoursAgo(2), now: NOW });
        expect(r.status).toBe('ok');
    });

    it('超过提醒阈值（25h）→ warn 而不是 fail', () => {
        const r = evaluateLedgerFreshness({ updatedAt: hoursAgo(25), now: NOW });
        expect(r.status).toBe('warn');
        expect(r.message).toContain('25.0 小时');
    });

    it('超过失败阈值（73h）→ stale', () => {
        const r = evaluateLedgerFreshness({ updatedAt: hoursAgo(73), now: NOW });
        expect(r.status).toBe('stale');
        expect(r.message).toContain('73.0 小时');
        expect(r.message).toContain('任务板');
    });

    it('临界值：恰好 72h 不算过期（> 才失败）', () => {
        expect(evaluateLedgerFreshness({ updatedAt: hoursAgo(72), now: NOW }).status).not.toBe('stale');
    });

    it('真实场景：审计里那本 92 小时的台账应判 stale', () => {
        const r = evaluateLedgerFreshness({
            updatedAt: '2026-11-09T02:21:29+08:00',
            now: NOW,
            // 2026-11-09T02:21 → 2026-11-12T12:00 约 81.6h
        });
        expect(r.status).toBe('stale');
        expect(r.ageHours).toBeGreaterThan(72);
    });

    it('自定义阈值生效', () => {
        expect(evaluateLedgerFreshness({ updatedAt: hoursAgo(5), now: NOW, maxAgeHours: 4 }).status).toBe('stale');
        expect(evaluateLedgerFreshness({ updatedAt: hoursAgo(5), now: NOW, maxAgeHours: 10 }).status).toBe('ok');
    });
});

describe('时效-3：退役台账跳过时效', () => {
    it('retired:true → status=retired，即使已过期很久', () => {
        const r = evaluateLedgerFreshness({
            updatedAt: hoursAgo(2000),
            retired: true,
            retiredReason: '轮询被任务板取代',
            now: NOW,
        });
        expect(r.status).toBe('retired');
        expect(r.message).toContain('任务板');
    });

    it('退役原因缺省时给出兜底文案', () => {
        const r = evaluateLedgerFreshness({ updatedAt: hoursAgo(200), retired: true, now: NOW });
        expect(r.message).toContain('轮询已被任务板取代');
    });

    it('retired 为 false / 缺省时仍按时效判定（不能被 falsy 蒙混）', () => {
        expect(evaluateLedgerFreshness({ updatedAt: hoursAgo(200), retired: false, now: NOW }).status).toBe('stale');
        expect(evaluateLedgerFreshness({ updatedAt: hoursAgo(200), now: NOW }).status).toBe('stale');
    });
});

describe('时效-4：非法时间戳', () => {
    it('updatedAt 无法解析 → invalid（不静默放过）', () => {
        expect(evaluateLedgerFreshness({ updatedAt: 'garbage', now: NOW }).status).toBe('invalid');
        expect(evaluateLedgerFreshness({ updatedAt: undefined, now: NOW }).status).toBe('invalid');
    });

    it('非法时间戳即使 retired 也走退役分支（格式校验由调用方负责）', () => {
        expect(evaluateLedgerFreshness({ updatedAt: 'garbage', retired: true, now: NOW }).status).toBe('retired');
    });
});
