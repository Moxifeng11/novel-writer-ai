/**
 * 阶段 D1：提示词管理的 A/B 指标行
 *
 * 从 `ui/prompt-manager-settings.ts` 的 `renderVariantStats` 抽出。
 * 抽出的理由：指标行是否显示取决于「样本数 > 0」的守卫，
 * 守卫写错就会显示 `NaN/10` 或「0.0%」这种假数据——此前零测试覆盖。
 */

import { describe, expect, it } from 'vitest';
import {
    buildVariantStatRows,
    formatOneDecimal,
    hasVariantFeedback,
} from '../../../ui/prompt-manager-logic';
import type { ABTestMetrics } from '../../../shared/prompt-manager-types';

/** 构造指标 */
function metrics(partial: Partial<ABTestMetrics> = {}): ABTestMetrics {
    return {
        totalCalls: 10,
        avgRating: 8.5,
        ratingCount: 4,
        avgQuality: 7.2,
        qualityCount: 3,
        modificationRate: 0.25,
        modificationCount: 2,
        ...partial,
    };
}

/** 取某一行的值 */
function rowValue(rows: ReturnType<typeof buildVariantStatRows>, label: string): string | undefined {
    return rows.find(r => r.label === label)?.value;
}

describe('D1-19：指标行按样本数显示', () => {
    it('有全部样本时显示所有指标', () => {
        const rows = buildVariantStatRows(metrics(), 50);
        expect(rowValue(rows, '调用次数')).toBe('10');
        expect(rowValue(rows, '平均评分')).toBe('8.5/10');
        expect(rowValue(rows, '平均质量')).toBe('7.2/10');
        expect(rowValue(rows, '修改率')).toBe('25.0%');
        expect(rowValue(rows, '流量占比')).toBe('50.0%');
    });

    it('无评分样本时不显示平均评分（避免 0 样本显示 NaN/10）', () => {
        const rows = buildVariantStatRows(metrics({ ratingCount: 0, avgRating: NaN }), 0);
        expect(rowValue(rows, '平均评分')).toBeUndefined();
        expect(rows.map(r => r.label)).not.toContain('平均评分');
    });

    it('无质量样本时不显示平均质量', () => {
        const rows = buildVariantStatRows(metrics({ qualityCount: 0, avgQuality: NaN }), 0);
        expect(rows.map(r => r.label)).not.toContain('平均质量');
    });

    it('无修改样本时不显示修改率', () => {
        const rows = buildVariantStatRows(metrics({ modificationCount: 0 }), 0);
        expect(rows.map(r => r.label)).not.toContain('修改率');
    });

    it('调用次数与流量占比始终显示（即使全是 0 样本）', () => {
        const rows = buildVariantStatRows(metrics({
            totalCalls: 0, ratingCount: 0, qualityCount: 0, modificationCount: 0,
        }), 0);
        expect(rowValue(rows, '调用次数')).toBe('0');
        expect(rowValue(rows, '流量占比')).toBe('0.0%');
    });
});

describe('D1-20：非法值兜底', () => {
    it('formatOneDecimal 对 NaN/undefined 返回 0.0（不显示 NaN）', () => {
        expect(formatOneDecimal(NaN)).toBe('0.0');
        expect(formatOneDecimal(undefined)).toBe('0.0');
        expect(formatOneDecimal(Infinity)).toBe('0.0');
    });

    it('formatOneDecimal 正常保留一位', () => {
        expect(formatOneDecimal(8.456)).toBe('8.5');
        expect(formatOneDecimal(0)).toBe('0.0');
        expect(formatOneDecimal(10)).toBe('10.0');
    });

    it('指标对象缺失时仍能构造行（不抛错）', () => {
        const rows = buildVariantStatRows(undefined as unknown as ABTestMetrics, 30);
        expect(rowValue(rows, '调用次数')).toBe('0');
        expect(rowValue(rows, '流量占比')).toBe('30.0%');
    });
});

describe('D1-21：是否有评价数据', () => {
    it('任一评价计数 > 0 即为有数据', () => {
        expect(hasVariantFeedback(metrics())).toBe(true);
        expect(hasVariantFeedback(metrics({ ratingCount: 1, qualityCount: 0, modificationCount: 0 }))).toBe(true);
        expect(hasVariantFeedback(metrics({ qualityCount: 1, ratingCount: 0, modificationCount: 0 }))).toBe(true);
        expect(hasVariantFeedback(metrics({ modificationCount: 1, ratingCount: 0, qualityCount: 0 }))).toBe(true);
    });

    it('全部为 0 时无评价数据', () => {
        expect(hasVariantFeedback(metrics({ ratingCount: 0, qualityCount: 0, modificationCount: 0 }))).toBe(false);
    });

    it('undefined 视为无数据', () => {
        expect(hasVariantFeedback(undefined)).toBe(false);
    });
});
