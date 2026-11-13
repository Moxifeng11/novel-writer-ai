/**
 * fact-store-format.ts — 事实库视图的纯展示逻辑
 *
 * 抽出来的原因：视图文件难以单测，展示逻辑（分组/排序/文案）抽成纯函数后可覆盖，
 * 也让 `check:view-tests` 有可验证的落点。
 */

import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';

/** 按主体分组的结果 */
export interface SubjectGroup {
    /** 主体名 */
    subject: string;
    /** 该主体的事实（按章节升序） */
    facts: FactMetadata[];
}

/**
 * 按主体分组并按事实数降序。
 *
 * @param facts - 事实列表
 * @returns 分组
 */
export function groupBySubject(facts: readonly FactMetadata[]): SubjectGroup[] {
    const map = new Map<string, FactMetadata[]>();
    for (const fact of facts) {
        const key = (fact.subject ?? '').trim() || '（未知主体）';
        const list = map.get(key);
        if (list) list.push(fact);
        else map.set(key, [fact]);
    }
    return [...map.entries()]
        .map(([subject, list]) => ({ subject, facts: [...list].sort((a, b) => a.chapter - b.chapter) }))
        .sort((a, b) => b.facts.length - a.facts.length || a.subject.localeCompare(b.subject));
}

/**
 * 格式化单条事实为一行文本。
 *
 * @param fact - 事实
 * @returns 文本，如「年龄=十七（第1章起；置信 0.90）」
 */
export function formatFactLine(fact: FactMetadata): string {
    const range = formatRange(fact);
    const confidence = Number.isFinite(fact.confidence) ? fact.confidence.toFixed(2) : '—';
    return `${fact.predicate}=${fact.value}（${range}；置信 ${confidence}）`;
}

/**
 * 格式化有效区间。
 *
 * @param fact - 事实
 * @returns 文本，如「第1章起」/「第1–10章」
 */
export function formatRange(fact: FactMetadata): string {
    const from = Number.isFinite(fact.validFrom) ? fact.validFrom : fact.chapter;
    if (fact.validTo === null || fact.validTo === undefined) return `第${from}章起`;
    return `第${from}–${fact.validTo}章`;
}

/**
 * 视图头部摘要。
 *
 * @param facts - 事实列表
 * @returns 文本，如「72 条事实 · 18 个主体 · 第1–5章」
 */
export function formatHeader(facts: readonly FactMetadata[]): string {
    if (facts.length === 0) return '事实库为空';
    const subjects = new Set(facts.map(f => f.subject));
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const fact of facts) {
        if (fact.chapter < from) from = fact.chapter;
        if (fact.chapter > to) to = fact.chapter;
    }
    return `${facts.length} 条事实 · ${subjects.size} 个主体 · 第${from}–${to}章`;
}

/**
 * 空态提示（明确说明边界，避免用户以为"没矛盾"）。
 *
 * @returns 文案
 */
export function emptyStateHint(): string {
    return '事实库为空。结算一章后会自动拆解入库，也可在「一致性审核」里查看矛盾报告。';
}

/**
 * 类型徽章文案。
 *
 * @param type - 拆解类型
 * @returns 中文短标签
 */
export function formatTypeBadge(type: string): string {
    switch (type) {
        case 'age': return '年龄';
        case 'location': return '地点';
        case 'possession': return '持有';
        case 'ability': return '能力';
        case 'relationship': return '关系';
        case 'timeline': return '时间';
        case 'world-rule': return '规则';
        case 'knowledge': return '认知';
        case 'memory': return '记忆';
        default: return '其它';
    }
}

/**
 * 事实是否已失效（用于视图淡化显示）。
 *
 * @param fact - 事实
 * @param currentChapter - 当前章节号（0 表示不限）
 * @returns 是否失效
 */
export function isExpired(fact: FactMetadata, currentChapter: number): boolean {
    if (currentChapter <= 0) return false;
    if (fact.validTo === null || fact.validTo === undefined) return false;
    return fact.validTo <= currentChapter;
}
