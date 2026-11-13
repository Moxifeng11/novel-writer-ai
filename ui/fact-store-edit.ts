/**
 * fact-store-edit.ts — 事实库编辑的纯逻辑（删除 / 改值 / 改区间 / 忽略 / 校验）
 *
 * 视图只负责渲染与调用；所有数据变换都在这里，便于测试与复用。
 *
 * 核心原则（与 readonly 校验同源）：
 *  - **写前必须校验**：非法数据（空主体/空值/区间倒置/置信越界）一律拒绝，
 *    不允许 UI 把用户库里正确的数据写坏；
 *  - **编辑是纯函数**：输入原事实数组 → 输出新数组，不修改入参；
 *  - **忽略而非删除**：`ignored: true` 保留事实但排除出第二意见，便于日后恢复。
 */

import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';

/** 编辑校验结果 */
export interface FactValidation {
    /** 是否可写入 */
    ok: boolean;
    /** 拒绝原因（ok=true 时为空） */
    reason?: string;
}

/**
 * 校验单条事实是否可写入。
 *
 * @param fact - 事实
 * @returns 校验结果
 */
export function validateFactForWrite(fact: FactMetadata): FactValidation {
    const subject = (fact.subject ?? '').trim();
    if (!subject) return { ok: false, reason: '主体不能为空' };
    const predicate = (fact.predicate ?? '').trim();
    if (!predicate) return { ok: false, reason: '谓词不能为空' };
    if (fact.value === undefined || fact.value === null || String(fact.value).trim() === '') {
        return { ok: false, reason: '值不能为空' };
    }
    if (!Number.isFinite(fact.chapter) || fact.chapter <= 0) {
        return { ok: false, reason: '章节号必须是正数' };
    }
    if (!Number.isFinite(fact.validFrom) || fact.validFrom < 0) {
        return { ok: false, reason: '有效起始章不能为负' };
    }
    if (fact.validTo !== null && fact.validTo !== undefined) {
        if (!Number.isFinite(fact.validTo)) return { ok: false, reason: '有效结束章必须是数字或空' };
        if (fact.validTo < fact.validFrom) return { ok: false, reason: '有效结束章不能早于起始章' };
    }
    if (!Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) {
        return { ok: false, reason: '置信度必须在 0–1 之间' };
    }
    return { ok: true };
}

/**
 * 校验整批事实（编辑后保存前调用）。
 *
 * @param facts - 事实列表
 * @returns 第一条不合法事实的索引与原因；全部合法返回 ok
 */
export function validateFactList(facts: readonly FactMetadata[]): FactValidation & { index?: number } {
    for (let i = 0; i < facts.length; i += 1) {
        const result = validateFactForWrite(facts[i]);
        if (!result.ok) return { ok: false, index: i, reason: `第 ${i + 1} 条：${result.reason}` };
    }
    return { ok: true };
}

/**
 * 删除单条事实（按 章节|主体|谓词 定位）。
 *
 * @param facts - 原事实列表
 * @param target - 目标定位
 * @returns 新数组
 */
export function removeFact(
    facts: readonly FactMetadata[],
    target: { chapter: number; subject: string; predicate: string },
): FactMetadata[] {
    return facts.filter(fact => !sameFact(fact, target));
}

/**
 * 用编辑后的值替换目标事实（保持数组顺序）。
 *
 * @param facts - 原事实列表
 * @param target - 目标定位
 * @param patch - 要修改的字段
 * @returns 新数组
 */
export function updateFact(
    facts: readonly FactMetadata[],
    target: { chapter: number; subject: string; predicate: string },
    patch: Partial<Pick<FactMetadata, 'value' | 'numeric' | 'unit' | 'validFrom' | 'validTo' | 'confidence' | 'quote'>>,
): FactMetadata[] {
    return facts.map(fact => (sameFact(fact, target) ? { ...fact, ...patch } : fact));
}

/**
 * 标记/取消忽略。
 *
 * @param facts - 原事实列表
 * @param target - 目标定位
 * @param ignored - 是否忽略（默认 true）
 * @returns 新数组
 */
export function setIgnored(
    facts: readonly FactMetadata[],
    target: { chapter: number; subject: string; predicate: string },
    ignored = true,
): FactMetadata[] {
    return facts.map(fact => (sameFact(fact, target) ? { ...fact, ignored } : fact));
}

/**
 * 取参与判定的有效事实（排除被忽略的）。
 *
 * @param facts - 全部事实
 * @returns 未忽略的事实
 */
export function activeFacts(facts: readonly FactMetadata[]): FactMetadata[] {
    return facts.filter(fact => !fact.ignored);
}

/**
 * 判断两条事实是否同一目标（章节 + 主体 + 谓词）。
 *
 * @param fact - 事实
 * @param target - 目标
 * @returns 是否同一
 */
export function sameFact(
    fact: FactMetadata,
    target: { chapter: number; subject: string; predicate: string },
): boolean {
    return fact.chapter === target.chapter
        && fact.subject === target.subject
        && fact.predicate === target.predicate;
}

/**
 * 统计编辑状态（供视图头部展示）。
 *
 * @param facts - 事实列表
 * @returns 统计
 */
export function summarizeEditState(facts: readonly FactMetadata[]): {
    total: number;
    ignored: number;
    active: number;
} {
    const ignored = facts.filter(fact => fact.ignored).length;
    return { total: facts.length, ignored, active: facts.length - ignored };
}
