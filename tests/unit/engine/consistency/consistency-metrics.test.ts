/**
 * 一致性指标单测（S5）
 *
 * CED 是「能证明改进幅度」的指标，口径必须钉死：除零、空集、越界、变化率。
 */

import { describe, expect, it } from 'vitest';
import {
    cedChangeRate,
    computeCed,
    formatMetricsLine,
    summarizeConsistencyMetrics,
} from '../../../../engine/consistency/consistency-metrics';
import type { ConsistencyContradiction } from '../../../../engine/consistency/assertion-model';

/** 造矛盾 */
function contradiction(kind: ConsistencyContradiction['kind'] = 'quantitative'): ConsistencyContradiction {
    return {
        id: `c-${kind}`,
        kind,
        category: 'factual',
        subject: '张三',
        predicate: '年龄',
        reasoning: 'r',
        evidenceA: { quote: 'a', chapterKey: '第1章' },
        evidenceB: { quote: 'b', chapterKey: '第2章' },
        decidedBy: 'rule',
        confidence: 0.9,
    };
}

describe('computeCed · 每万字符错误数', () => {
    it('1 处错误 / 1 万字符 = 1', () => {
        expect(computeCed(1, 10000)).toBe(1);
    });

    it('2 处错误 / 4 万字符 = 0.5', () => {
        expect(computeCed(2, 40000)).toBe(0.5);
    });

    it('字符数为 0 → 0（不返回 Infinity）', () => {
        expect(computeCed(5, 0)).toBe(0);
    });

    it('负值/非有限值按 0 处理', () => {
        expect(computeCed(-3, 10000)).toBe(0);
        expect(computeCed(Number.NaN, 10000)).toBe(0);
        expect(computeCed(1, Number.NaN)).toBe(0);
    });

    it('长文与短文可比较（归一化生效）', () => {
        // 都是 1 处 / 1 万字 → 相同 CED，说明长度已被归一
        expect(computeCed(1, 10000)).toBe(computeCed(1, 10000));
        // 10 万字的 10 处 = 1 万字的 1 处
        expect(computeCed(10, 100000)).toBe(computeCed(1, 10000));
    });
});

describe('summarizeConsistencyMetrics · 汇总', () => {
    it('空集 → 全 0', () => {
        const m = summarizeConsistencyMetrics([], 10000);
        expect(m.errors).toBe(0);
        expect(m.ced).toBe(0);
        expect(m.byKind).toHaveLength(0);
    });

    it('按类型分组并降序', () => {
        const m = summarizeConsistencyMetrics(
            [contradiction('quantitative'), contradiction('quantitative'), contradiction('duration')],
            10000,
        );
        expect(m.errors).toBe(3);
        expect(m.byKind[0]).toMatchObject({ kind: 'quantitative', errors: 2 });
        expect(m.byKind[1]).toMatchObject({ kind: 'duration', errors: 1 });
    });

    it('分组 CED 与总 CED 一致（同一分母）', () => {
        const m = summarizeConsistencyMetrics([contradiction('quantitative')], 20000);
        expect(m.ced).toBe(0.5);
        expect(m.byKind[0].ced).toBe(0.5);
    });

    it('字符数为 0 时不产生 Infinity', () => {
        const m = summarizeConsistencyMetrics([contradiction()], 0);
        expect(m.ced).toBe(0);
        expect(m.byKind[0].ced).toBe(0);
    });
});

describe('formatMetricsLine · 展示', () => {
    it('过万字显示「万字」', () => {
        const m = summarizeConsistencyMetrics([contradiction()], 71000);
        expect(formatMetricsLine(m)).toContain('万字');
        expect(formatMetricsLine(m)).toContain('CED');
    });

    it('不足万字显示「字」', () => {
        const m = summarizeConsistencyMetrics([contradiction()], 5000);
        expect(formatMetricsLine(m)).toContain('5000 字');
    });
});

describe('cedChangeRate · 趋势', () => {
    it('变好为负数', () => {
        expect(cedChangeRate(1, 0.5)).toBe(-50);
    });

    it('变差为正数', () => {
        expect(cedChangeRate(0.5, 1)).toBe(100);
    });

    it('旧值为 0 无法比较 → null', () => {
        expect(cedChangeRate(0, 1)).toBeNull();
    });

    it('非有限值 → null', () => {
        expect(cedChangeRate(Number.NaN, 1)).toBeNull();
    });
});
