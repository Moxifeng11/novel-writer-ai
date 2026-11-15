/**
 * assertion-context-service.ts — 一致性断言 → 场景约束清单
 *
 * 编排：按在场实体筛断言（不设条数）→ 高风险优先排序 → 按 token 分批 →
 * 渲染约束清单 + 覆盖核对。供质控/分析/正文步注入「前馈约束」。
 */

import {
    batchAssertions,
    renderAssertionConstraints,
    selectAssertionsForEntities,
    sortBySeverity,
    verifyAssertionCoverage,
    type AssertionBatches,
    type BatchAssertion,
} from '@/shared/assertion-batch-model';

/** 断言约束包 */
export interface AssertionConstraintPack {
    /** 涉及在场实体的全部断言（未截断） */
    relevant: BatchAssertion[];
    /** 分批结果 */
    batches: AssertionBatches;
    /** 渲染好的约束清单（按批） */
    sections: string[];
    /** 必需断言 ID 中未出现在输入里的（数据缺口） */
    missing: string[];
    /** 总 token 估算 */
    totalTokens: number;
}

/**
 * 构建断言约束包。
 *
 * @param assertions - 全部断言
 * @param entityIds - 在场实体 ID
 * @param options - 每批 token 预算与必需断言 ID
 * @returns 约束包
 */
export function buildAssertionConstraintPack(
    assertions: readonly BatchAssertion[],
    entityIds: readonly string[],
    options: { maxTokensPerBatch?: number; requiredIds?: readonly string[] } = {},
): AssertionConstraintPack {
    const relevant = sortBySeverity(selectAssertionsForEntities(assertions, entityIds));
    const batches = batchAssertions(relevant, { maxTokensPerBatch: options.maxTokensPerBatch });
    const sections = batches.batches.map(batch => renderAssertionConstraints(batch));
    const missing = options.requiredIds
        ? verifyAssertionCoverage(options.requiredIds, relevant.map(assertion => assertion.id))
        : [];
    return {
        relevant,
        batches,
        sections,
        missing,
        totalTokens: relevant.reduce((sum, assertion) => sum + Math.max(8, Math.ceil((assertion.text.length + assertion.id.length + 20) / 2)), 0),
    };
}

/**
 * 渲染完整约束段（所有批次按序拼接，不丢条目）。
 *
 * @param pack - 约束包
 * @returns 文本
 */
export function renderAssertionConstraintSection(pack: AssertionConstraintPack): string {
    if (pack.sections.length === 0) return '';
    const lines = ['【本场一致性约束（按在场要素精确匹配，全量分批）】'];
    pack.sections.forEach((section, index) => {
        lines.push(`批次 ${index + 1}/${pack.sections.length}：`);
        lines.push(section);
    });
    if (pack.missing.length > 0) {
        lines.push(`【数据缺口】以下必需断言未找到：${pack.missing.join('、')}（请勿凭记忆补全，必要时用 request_context 核对）`);
    }
    return lines.join('\n');
}
