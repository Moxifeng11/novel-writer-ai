/**
 * state-advice.ts — 给「正则功能」的第二意见（P2）
 *
 * 背景（用户诉求）：插件里大量功能是正则实现，正则只该**找候选**，
 * 结论应参考已积累的事实（事实库 / 图节点）。时间线、伏笔、实体状态三类尤其重要——
 * 它们一旦判错，剧情逻辑就崩。
 *
 * 本模块提供统一的「查权威状态」入口：
 *   正则给出（主体, 谓词, 章节, 声称值）
 *     → 查事实库中该时点的有效事实
 *     → 返回 一致 / 冲突 / 未知（+ 权威值 + 引文）
 *
 * 原则：
 *  - **未知不报错**：查不到就返回 `unknown`，绝不因为没数据就判冲突；
 *  - **冲突必须给证据**：返回权威事实的原文引文与章节，供用户判断；
 *  - 值比较先归一化（`valuesLookEquivalent`），避免「十五六岁 vs 约摸十五六岁」误报。
 */

import type { FactMetadata } from './knowledge-fact-nodes';
import { valuesLookEquivalent } from '@/engine/consistency/candidate-judge';

/** 建议结论 */
export type AdviceStatus = 'consistent' | 'conflict' | 'unknown';

/** 建议结果 */
export interface StateAdvice {
    /** 结论 */
    status: AdviceStatus;
    /** 权威事实（可能与声称值一致，也可能冲突） */
    authoritative?: FactMetadata;
    /** 说明（给用户看的理由） */
    reason: string;
}

/**
 * 取某主体在某章时的有效事实（同谓词取最晚一条）。
 *
 * 与 `fact-view.stateAt` 语义一致，但输入是扁平事实数组（便于正则功能直接调用）。
 *
 * @param facts - 事实列表
 * @param subject - 主体
 * @param predicate - 谓词（可省略：省略时取该主体全部谓词）
 * @param chapter - 章节号
 * @returns 有效事实
 */
export function effectiveFacts(
    facts: readonly FactMetadata[],
    subject: string,
    predicate: string | undefined,
    chapter: number,
): FactMetadata[] {
    const hits = facts.filter(fact => {
        if (fact.subject !== subject) return false;
        if (predicate && fact.predicate !== predicate) return false;
        if (fact.chapter > chapter) return false;
        if (fact.validFrom > chapter) return false;
        if (fact.validTo !== null && fact.validTo <= chapter) return false;
        return true;
    });
    const byPredicate = new Map<string, FactMetadata>();
    for (const fact of hits.sort((a, b) => a.chapter - b.chapter)) {
        byPredicate.set(fact.predicate, fact);
    }
    return [...byPredicate.values()];
}

/**
 * 对正则得出的声称值给出建议。
 *
 * @param facts - 事实列表（来自事实库）
 * @param claim - 正则得到的候选：主体 / 谓词 / 章节 / 声称值
 * @returns 建议
 */
export function adviseState(
    facts: readonly FactMetadata[],
    claim: { subject: string; predicate?: string; chapter: number; value: string },
): StateAdvice {
    const subject = (claim.subject ?? '').trim();
    const value = (claim.value ?? '').trim();
    if (!subject || !value) {
        return { status: 'unknown', reason: '候选缺少主体或值，无法比对' };
    }
    const effective = effectiveFacts(facts, subject, claim.predicate, claim.chapter);
    if (effective.length === 0) {
        return { status: 'unknown', reason: `第 ${claim.chapter} 章前没有「${subject}」的已记录事实` };
    }
    // 先找同谓词（精准），再退化为任一同主体事实（宽松）
    const samePredicate = claim.predicate
        ? effective.filter(fact => fact.predicate === claim.predicate)
        : effective;
    const pool = samePredicate.length > 0 ? samePredicate : effective;
    for (const fact of pool) {
        if (valuesLookEquivalent(fact.value, value)) {
            return { status: 'consistent', authoritative: fact, reason: `与第 ${fact.chapter} 章记录一致` };
        }
    }
    const authoritative = pool[pool.length - 1];
    return {
        status: 'conflict',
        authoritative,
        reason: `第 ${claim.chapter} 章写「${value}」，但事实库记录第 ${authoritative.chapter} 章为`
            + `「${authoritative.value}」（原文「${authoritative.quote.slice(0, 30)}」）`,
    };
}

/**
 * 批量给出建议（供视图/报告一次处理多条候选）。
 *
 * @param facts - 事实列表
 * @param claims - 候选列表
 * @returns 建议列表（与输入同序）
 */
export function adviseBatch(
    facts: readonly FactMetadata[],
    claims: ReadonlyArray<{ subject: string; predicate?: string; chapter: number; value: string }>,
): StateAdvice[] {
    return claims.map(claim => adviseState(facts, claim));
}

/**
 * 只挑出有冲突的候选（多数正则功能只需要这一步）。
 *
 * @param facts - 事实列表
 * @param claims - 候选列表
 * @returns 冲突候选与建议
 */
export function findConflicts(
    facts: readonly FactMetadata[],
    claims: ReadonlyArray<{ subject: string; predicate?: string; chapter: number; value: string }>,
): Array<{ claim: typeof claims[number]; advice: StateAdvice }> {
    const out: Array<{ claim: typeof claims[number]; advice: StateAdvice }> = [];
    claims.forEach((claim, index) => {
        const advice = adviseBatch(facts, [claim])[0] ?? adviseState(facts, claim);
        void index;
        if (advice.status === 'conflict') out.push({ claim, advice });
    });
    return out;
}
