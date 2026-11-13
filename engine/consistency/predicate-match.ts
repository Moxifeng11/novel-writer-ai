/**
 * predicate-match.ts — 谓词匹配的唯一入口（替代散落的 `=== '年龄'` / `includes('地点')`）
 *
 * 为什么需要：规则里到处用关键词匹配谓词，而 LLM 产出的谓词是自由文本：
 *  - 同一概念有多种说法：年龄 / 年纪 / 岁数；位置 / 地点 / 所在
 *  - 同一说法可带限定词：**被提亲起始年龄**、请求远嫁时年龄、入初境年龄
 * 前者用严格等值会整类漏报；后者用包含匹配会把回溯叙述当成当前状态，产生假矛盾。
 * （两个坑都在 2026-11-13 的长篇评测里真实踩过。）
 *
 * 本模块提供**唯一**的匹配口径：
 *  1. 概念 → 别名表（前缀锚定，避免"被提亲起始年龄"这类前缀污染）
 *  2. 统一排除**回溯/局部限定词**（起始/当年/时/曾/之前/旧/初/少时…）——
 *     这类谓词描述的是过去或局部状态，不参与"当前状态"比对。
 */

/** 状态类概念 */
export type PredicateConcept =
    | 'age'
    | 'location'
    | 'time'
    | 'alias'
    | 'possession'
    | 'ability'
    | 'memory'
    | 'causal';

/**
 * 概念 → 可接受谓词前缀。
 *
 * 用**前缀**而不是包含：中文限定词通常前置于核心名词
 * （「被提亲起始年龄」的核心是"起始年龄"而非"当前年龄"）。
 */
export const PREDICATE_ALIASES: Record<PredicateConcept, readonly string[]> = {
    age: ['年龄', '年纪', '岁数'],
    location: ['位置', '地点', '所在'],
    time: ['时间', '日期', '时刻', '年份'],
    alias: ['又名', '化名', '道号', '绰号', '外号', '本名', '原名', '真名'],
    possession: ['持有', '拥有', '携带', '手中', '物品'],
    ability: ['修为', '境界', '等级', '能力', '实力'],
    memory: ['记得', '忘了', '记忆', '不记得', '忘却'],
    causal: ['原因'],
};

/**
 * 回溯/局部限定词：出现即表示该谓词描述**过去或局部**状态，不参与当前状态比对。
 *
 * 例：「被提亲起始年龄」「请求远嫁时年龄」「入初境年龄」「七年前年龄尚小」。
 */
export const RETROSPECTIVE_MARKERS: readonly string[] = [
    // 注意：不要放裸「时」「初」——会误杀「时间」「时刻」这类正常谓词
    '起始', '初始', '当年', '当时', '曾', '之前', '以前', '从前',
    '旧称', '少时', '幼时', '儿时', '年前', '此前', '原来',
];

/**
 * 判断谓词是否描述「当前状态」。
 *
 * @param predicate - 谓词文本
 * @returns 是否当前状态（空谓词视为否）
 */
export function isCurrentStatePredicate(predicate: string): boolean {
    const text = (predicate ?? '').trim();
    if (!text) return false;
    return !RETROSPECTIVE_MARKERS.some(marker => text.includes(marker));
}

/**
 * 判断谓词是否属于某概念**且**描述当前状态。
 *
 * @param predicate - 谓词文本
 * @param concept - 概念
 * @returns 是否命中
 */
export function matchesPredicate(predicate: string, concept: PredicateConcept): boolean {
    const text = (predicate ?? '').trim();
    if (!text) return false;
    const aliases = PREDICATE_ALIASES[concept] ?? [];
    const hit = aliases.some(alias => text.startsWith(alias));
    if (!hit) return false;
    return isCurrentStatePredicate(text);
}

/**
 * 判断谓词是否属于某概念（**不**校验回溯限定）。
 *
 * 少数场景需要宽松匹配（例如记忆规则本身就在判断"是否忘了"），
 * 但默认应使用 `matchesPredicate`。
 *
 * @param predicate - 谓词文本
 * @param concept - 概念
 * @returns 是否命中
 */
export function matchesPredicateLoose(predicate: string, concept: PredicateConcept): boolean {
    const text = (predicate ?? '').trim();
    if (!text) return false;
    return (PREDICATE_ALIASES[concept] ?? []).some(alias => text.startsWith(alias));
}

/**
 * 从断言列表里筛出某概念的「当前状态」断言。
 *
 * @param assertions - 断言
 * @param concept - 概念
 * @returns 命中的断言
 */
export function filterByConcept<T extends { predicate: string }>(
    assertions: readonly T[],
    concept: PredicateConcept,
): T[] {
    return assertions.filter(item => matchesPredicate(item.predicate, concept));
}

/** 引文中的回溯/回忆标记（谓词可能中性，但句子说的是过去） */
export const RETROSPECTIVE_QUOTE_MARKERS: readonly string[] = [
    '那年', '那年才', '那年刚刚', '小时候', '幼年', '童年', '少时', '儿时',
    '多年前', '七年前', '几年前', '当年', '那时', '当时', '此前', '从前', '曾经',
];

/**
 * 判断引文是否描述过去（回溯/回忆）。
 *
 * 为什么需要：谓词可能写成「年龄」（看起来是当前状态），但句子是
 * 「我**那年才**四岁」——纯粹的回溯叙述。只看谓词会产生假矛盾
 * （《将夜》第 92 章实例，已核对原文）。
 *
 * @param quote - 原文引文
 * @returns 是否回溯
 */
export function isRetrospectiveQuote(quote: string): boolean {
    const text = (quote ?? '').trim();
    if (!text) return false;
    return RETROSPECTIVE_QUOTE_MARKERS.some(marker => text.includes(marker));
}
