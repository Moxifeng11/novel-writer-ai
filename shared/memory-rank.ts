/**
 * memory-rank.ts — 长篇记忆（已确认事实）的去重与相关度排序（纯函数）
 *
 * 旧实现按类别取前 12 条：既无去重（同一条事实跨章被反复确认会占满配额），
 * 也无相关性（与本章完全无关的早期事实挤掉当前相关事实）。
 * 这里只改「选哪 12 条」，不改变总量上限与输出格式。
 */

export interface RankableFact {
    category: string;
    name: string;
    content: string;
    /** 章号/时间戳，用于新近度加权（越大越新） */
    recency?: number;
}

/**
 * 字符 2-gram（与 RAG 多样性口径一致，中文无需分词）
 *
 * @param text - 文本内容
 * @returns 集合结果
 */
function bigrams(text: string): Set<string> {
    const normalized = String(text || '').replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 1 < normalized.length; i++) set.add(normalized.slice(i, i + 2));
    return set;
}

function similarity(a: string, b: string): number {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let hit = 0;
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const gram of small) if (large.has(gram)) hit++;
    return hit / (setA.size + setB.size - hit);
}

/** 合并近重复事实：同类别且「名称+内容」相似度 ≥ threshold 时保留信息更全的一条 */
export function dedupeFacts<T extends RankableFact>(facts: T[], threshold = 0.85): T[] {
    const kept: T[] = [];
    for (const fact of facts) {
        const text = `${fact.name}${fact.content}`;
        const duplicateIndex = kept.findIndex((existing) =>
            existing.category === fact.category
            && (existing.name === fact.name || similarity(`${existing.name}${existing.content}`, text) >= threshold),
        );
        if (duplicateIndex < 0) {
            kept.push(fact);
            continue;
        }
        const existing = kept[duplicateIndex];
        if (`${fact.content}`.length > `${existing.content}`.length) kept[duplicateIndex] = fact;
    }
    return kept;
}

export interface RankOptions {
    /** 当前上下文（章纲/大纲/情绪弧），用于相关度打分 */
    query?: string;
    /** 相关度权重（默认 1.0） */
    relevanceWeight?: number;
    /** 新近度权重（默认 0.15） */
    recencyWeight?: number;
}

/**
 * 相关度排序：
 *   score = relevanceWeight × bigram(query, name+content) + recencyWeight × normalizedRecency
 * 无 query 时退化为纯新近度排序（保持确定性，不改变「取前 N 条」的候选集合）。
 */
export function rankFacts<T extends RankableFact>(facts: T[], options: RankOptions = {}): T[] {
    const query = String(options.query || '').trim();
    const relevanceWeight = options.relevanceWeight ?? 1;
    const recencyWeight = options.recencyWeight ?? 0.15;
    if (facts.length <= 1) return [...facts];

    const recencies = facts.map((fact) => fact.recency ?? 0);
    const maxRecency = Math.max(...recencies);
    const minRecency = Math.min(...recencies);
    const span = maxRecency - minRecency || 1;

    return facts
        .map((fact, index) => {
            const relevance = query ? similarity(query, `${fact.name}${fact.content}`) : 0;
            const recency = (recencies[index] - minRecency) / span;
            return { fact, score: relevanceWeight * relevance + recencyWeight * recency };
        })
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.fact);
}