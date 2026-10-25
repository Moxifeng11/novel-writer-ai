/**
 * quality-calibration.test.ts — Phase 1.2b 校准系数单一事实源
 *
 * 核心契约：
 * 1. 维度权重与维度内子项权重必须归一（和为 1），否则总分会被系统性放大/缩小；
 * 2. QualityScoreEngine 导出的 DIMENSION_WEIGHTS 必须直接引用阈值表，
 *    不允许在引擎内另写一份数值。
 */
import { describe, it, expect } from 'vitest';
import {
    QSE_DIMENSION_WEIGHTS,
    QSE_SUB_WEIGHTS,
    WQE_DIMENSION_WEIGHTS,
    WQE_SUB_WEIGHTS,
} from '../../../shared/thresholds';
import { DIMENSION_WEIGHTS } from '../../../engine/quality/quality-score-engine';

const sum = (values: number[]): number =>
    values.reduce((total, value) => total + value, 0);

describe('质量校准系数 — 权重归一', () => {
    it('WritingQualityEngine 六维总分权重和为 1', () => {
        expect(sum(Object.values(WQE_DIMENSION_WEIGHTS))).toBeCloseTo(1, 10);
    });

    it('QualityScoreEngine 六维总分权重和为 1', () => {
        expect(sum(Object.values(QSE_DIMENSION_WEIGHTS))).toBeCloseTo(1, 10);
    });

    it('WritingQualityEngine 每个维度的子项权重和为 1', () => {
        for (const [dimension, weights] of Object.entries(WQE_SUB_WEIGHTS)) {
            expect(sum(Object.values(weights)), `维度 ${dimension}`).toBeCloseTo(1, 10);
        }
    });

    it('QualityScoreEngine 每组子项权重和为 1', () => {
        for (const [group, weights] of Object.entries(QSE_SUB_WEIGHTS)) {
            expect(sum(Object.values(weights)), `分组 ${group}`).toBeCloseTo(1, 10);
        }
    });
});

describe('质量校准系数 — 单一事实源', () => {
    it('QualityScoreEngine 的 DIMENSION_WEIGHTS 引用阈值表', () => {
        expect(DIMENSION_WEIGHTS).toEqual(QSE_DIMENSION_WEIGHTS);
    });

    it('阈值表数值未在迁移过程中被改动', () => {
        expect(WQE_DIMENSION_WEIGHTS.language).toBe(0.2);
        expect(WQE_DIMENSION_WEIGHTS.rhythm).toBe(0.15);
        expect(QSE_DIMENSION_WEIGHTS.readability).toBe(0.18);
        expect(WQE_SUB_WEIGHTS.language.vocab).toBe(0.3);
        expect(QSE_SUB_WEIGHTS.readability.sentenceLength).toBe(0.3);
    });
});
