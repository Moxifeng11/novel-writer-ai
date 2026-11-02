/**
 * shared/quality-grade.ts — 质量等级 / 着色 / 文案的唯一实现
 *
 * 质量内核只有一套：WritingQualityEngine 六维规则评分。
 * 本模块只负责把「分数」翻译成「等级、颜色、标签」，避免各视图各写一套分界
 * （历史问题：同一分数在监控面板 70/40 与 80/60 两套着色规则下显示不同颜色）。
 */
import {
    DIVERGENCE_CRITICAL,
    DIVERGENCE_WARNING,
    QUALITY_GRADE_A,
    QUALITY_GRADE_B,
    QUALITY_GRADE_C,
    QUALITY_GRADE_S,
    QUALITY_SCORE_GOOD,
    QUALITY_SCORE_WARNING,
} from './thresholds';

/**
 * QualityGrade 类型定义。
 */
export type QualityGrade = 'S' | 'A' | 'B' | 'C' | 'D';
/**
 * 质量分数层级结构定义。
 */
export type QualityScoreLevel = 'good' | 'warning' | 'danger';
/**
 * 偏离层级结构定义。
 */
export type DivergenceLevel = 'normal' | 'warning' | 'danger';

/**
 * 分数 → 质量等级
 *
 * @param score - 分数
  * @returns QualityGrade 实例
 */
export function gradeFromScore(score: number): QualityGrade {
    if (score >= QUALITY_GRADE_S) return 'S';
    if (score >= QUALITY_GRADE_A) return 'A';
    if (score >= QUALITY_GRADE_B) return 'B';
    if (score >= QUALITY_GRADE_C) return 'C';
    return 'D';
}

/**
 * 分数 → 三档色阶（全插件唯一口径）
 *
 * @param score - 分数
  * @returns QualityScoreLevel 实例
 */
export function scoreLevelFromScore(score: number): QualityScoreLevel {
    if (score >= QUALITY_SCORE_GOOD) return 'good';
    if (score >= QUALITY_SCORE_WARNING) return 'warning';
    return 'danger';
}

/**
 * 分数 → CSS 颜色变量
 *
 * @param score - 分数
 * @returns 文本结果
 */
export function qualityScoreColor(score: number): string {
    switch (scoreLevelFromScore(score)) {
        case 'good': return 'var(--nw-success, #22c55e)';
        case 'warning': return 'var(--nw-warning, #f59e0b)';
        default: return 'var(--nw-danger, #ef4444)';
    }
}

/**
 * 质量等级 → CSS 颜色变量
 *
 * @param grade - 等级
 * @returns 文本结果
 */
export function qualityGradeColor(grade: QualityGrade): string {
    const colors: Record<QualityGrade, string> = {
        'S': 'var(--nw-accent, #8b5cf6)',
        'A': 'var(--nw-success, #22c55e)',
        'B': 'var(--nw-warning, #f59e0b)',
        'C': 'var(--nw-warning, #f97316)',
        'D': 'var(--nw-danger, #ef4444)',
    };
    return colors[grade];
}

/**
 * 质量等级 → 中文标签
 *
 * @param grade - 等级
 * @returns 文本结果
 */
export function qualityGradeLabel(grade: QualityGrade): string {
    const labels: Record<QualityGrade, string> = {
        'S': '绝世佳作',
        'A': '优秀',
        'B': '良好',
        'C': '及格',
        'D': '待提升',
    };
    return labels[grade];
}

/**
 * 偏离度 → 预警等级（与 deviation-detector 的 severity 阈值同源）
 *
 * @param score - 分数
  * @returns DivergenceLevel 实例
 */
export function divergenceLevelFromScore(score: number): DivergenceLevel {
    if (score >= DIVERGENCE_CRITICAL) return 'danger';
    if (score >= DIVERGENCE_WARNING) return 'warning';
    return 'normal';
}
