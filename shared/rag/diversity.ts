/**
 * diversity.ts — MMR 多样性选择（纯函数）
 *
 * 检索 top-N 常出现「同一段的三种变体」：分数都高，但信息重复。
 * MMR（Maximal Marginal Relevance）在相关性与新颖度之间折中：
 *   score = λ × relevance − (1−λ) × maxSimilarityToSelected
 * 相似度用字符 2-gram Jaccard（中文无需分词，成本可控）。
 */
import type { RagHit } from './neighbors';

/**
 * 字符 2-gram 集合（跳过空白）
 *
 * @param text - 文本内容
 * @returns 集合结果
 */
export function bigrams(text: string): Set<string> {
    const normalized = String(text || '').replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 1 < normalized.length; i++) {
        set.add(normalized.slice(i, i + 2));
    }
    return set;
}

/**
 * Jaccard 相似度（0–1）
 *
 * @param a - 参与比较的值
 * @param b - 参与比较的值
 * @returns 数值结果
 */
export function bigramSimilarity(a: string, b: string): number {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    const smaller = setA.size <= setB.size ? setA : setB;
    const larger = setA.size <= setB.size ? setB : setA;
    for (const gram of smaller) {
        if (larger.has(gram)) intersection++;
    }
    return intersection / (setA.size + setB.size - intersection);
}

export interface MmrOptions {
    /** 相关性权重（默认 0.7；越低越强调多样性） */
    lambda?: number;
    /** 与已选项相似度超过该值视为重复（默认 0.9，硬去重） */
    duplicateThreshold?: number;
}

/**
 * MMR 选择至多 k 条。
 * 第一条永远取分数最高的；之后每轮在「剩余」里选 MMR 最大者。
 * 与已选项相似度 ≥ duplicateThreshold 的直接丢弃（避免近乎重复）。
 * @param hits - 命中
 * @param k - 键或索引
 * @param options - 配置项
 * @returns 结果数组
 */
export function mmrSelect(hits: RagHit[], k: number, options: MmrOptions = {}): RagHit[] {
    const lambda = options.lambda ?? 0.7;
    const duplicateThreshold = options.duplicateThreshold ?? 0.9;
    if (k <= 0 || hits.length === 0) return [];

    const remaining = [...hits].sort((a, b) => b.score - a.score);
    const selected: RagHit[] = [];
    const selectedTexts: string[] = [];

    while (selected.length < k && remaining.length > 0) {
        if (selected.length === 0) {
            const first = remaining.shift()!;
            selected.push(first);
            selectedTexts.push(first.sample);
            continue;
        }

        let bestIndex = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const candidate = remaining[i];
            const maxSim = selectedTexts.reduce((max, text) => Math.max(max, bigramSimilarity(candidate.sample, text)), 0);
            if (maxSim >= duplicateThreshold) continue;
            const mmr = lambda * candidate.score - (1 - lambda) * maxSim;
            if (mmr > bestScore) {
                bestScore = mmr;
                bestIndex = i;
            }
        }

        if (bestIndex < 0) break; // 剩余全是重复项
        const picked = remaining.splice(bestIndex, 1)[0];
        selected.push(picked);
        selectedTexts.push(picked.sample);
    }

    return selected;
}