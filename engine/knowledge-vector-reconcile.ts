/**
 * knowledge-vector-reconcile.ts — 知识库索引 ↔ 向量库对账（纯逻辑，DSH-20261112-14）
 *
 * 缘起（-08 运行层验证）：真实 vault 出现「知识库索引 0 本，向量库 1 本」——
 * 界面「检索」环节显示「已加载 1 本」，用户以为知识库有数据，实际索引是空的。
 * 这是典型「假绿」：每一条用户以为生效的链路都必须可证明。
 *
 * 三类结论：
 * - **孤儿向量**（orphans）：向量库有、索引没有。可能是用户临时移走了书目录，
 *   所以默认只报告，绝不静默删除——清理必须是显式动作（带确认）。
 * - **缺失向量**（missing）：索引有、向量库没有（拆解完成但向量没算/失败）。
 * - **正常**（healthy）：两边都有。
 *
 * 纯函数：不 import obsidian、不碰文件系统；调用方注入两侧 id 列表。
 */

/** 对账报告（三类；数组内 id 保序、去重） */
export interface VectorReconcileReport {
    /** 孤儿向量：向量库有、索引没有 */
    orphans: string[];
    /** 缺失向量：索引有、向量库没有 */
    missing: string[];
    /** 正常：两边都有 */
    healthy: string[];
}

/** 稳定去重保序 */
function uniqueInOrder(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
        if (typeof id !== 'string' || !id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * 索引 ↔ 向量库对账。
 *
 * @param kbBookIds - 知识库索引里的书籍 id（顺序无关，内部去重）
 * @param vectorBookIds - 向量库已加载的书籍 id（顺序无关，内部去重）
 * @returns 三类报告；每个数组保序（按调用方给定的首次出现顺序）
 *
 * @example
 * ```ts
 * const report = reconcileVectorBooks(['a'], ['a', 'ghost']);
 * report.orphans  // ['ghost']  ← 界面据此把「已加载 1 本」降级为带孤儿提示
 * report.missing  // []
 * ```
 */
export function reconcileVectorBooks(
    kbBookIds: readonly string[],
    vectorBookIds: readonly string[],
): VectorReconcileReport {
    const kbSet = new Set(uniqueInOrder(kbBookIds));
    const vectorSet = new Set(uniqueInOrder(vectorBookIds));

    const orphans: string[] = [];
    const healthy: string[] = [];
    for (const id of uniqueInOrder(vectorBookIds)) {
        if (kbSet.has(id)) healthy.push(id);
        else orphans.push(id);
    }

    const missing: string[] = [];
    for (const id of uniqueInOrder(kbBookIds)) {
        if (!vectorSet.has(id)) missing.push(id);
    }

    return { orphans, missing, healthy };
}

/**
 * 把对账结果转成面向用户的一句话摘要（UI 提示与 agent 诊断共用口径）。
 *
 * @param report - 对账报告
 * @returns 空报告返回 null（调用方不提示）；否则返回摘要
 *
 * @example
 * ```ts
 * summarizeVectorReconcile(report) // '向量库 1 本不在知识库索引（孤儿向量，建议清理）'
 * ```
 */
export function summarizeVectorReconcile(report: VectorReconcileReport): string | null {
    const parts: string[] = [];
    if (report.orphans.length > 0) {
        parts.push(`向量库 ${report.orphans.length} 本不在知识库索引（孤儿向量，建议清理）`);
    }
    if (report.missing.length > 0) {
        parts.push(`索引 ${report.missing.length} 本没有向量（缺失向量，建议重向量化）`);
    }
    if (parts.length === 0) return null;
    return parts.join('；');
}
