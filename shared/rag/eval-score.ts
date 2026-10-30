/**
 * eval-score.ts — 检索质量评分（hit@k / MRR / 近重复占比）
 *
 * 与 `scripts/eval-fingerprint-retrieval.mjs` 同口径（hit@k + MRR），
 * 额外加一个「近重复占比」：RAG 管线用 MMR 压重复，如果没有指标，
 * λ 调错时表现是「前三条都在说同一件事」却看不出来。
 *
 * 纯函数，不读文件、不依赖运行时；CLI 只负责读 JSON 与打印。
 */

export interface EvalQuery {
    id: string;
    /** 相关结果 id（一条查询可以有多个正确项） */
    relevant: string[];
    /** 检索返回的有序 id 列表（top-k 从头部取） */
    ranked: string[];
}

export interface EvalQueryRow {
    id: string;
    /** top-k 内是否命中任一 relevant */
    hit: boolean;
    /** 首个命中位次（1-based；未命中为 null） */
    firstRank: number | null;
    /** 本次返回里近重复（与更早的一条相似度 ≥ 阈值）的占比 0–1 */
    duplicateRatio: number;
}

export interface EvalReport {
    queries: number;
    k: number;
    /** hit@k 百分比（0–100） */
    hitRate: number;
    /** 平均倒数排名 */
    mrr: number;
    /** 全部返回结果的平均近重复占比（0–1） */
    duplicateRatio: number;
    rows: EvalQueryRow[];
}

const DEFAULT_K = 5;
/** 近重复判定阈值：与 shared/rag/diversity 的 duplicateThreshold 对齐 */
const DEFAULT_DUPLICATE_THRESHOLD = 0.9;

function bigrams(text: string): Set<string> {
    const normalized = String(text || '').replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 1 < normalized.length; i++) set.add(normalized.slice(i, i + 2));
    return set;
}

/** 2-gram Jaccard（与 MMR 同口径；空文本返回 0） */
export function textSimilarity(a: string, b: string): number {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let hit = 0;
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const gram of small) if (large.has(gram)) hit++;
    return hit / (setA.size + setB.size - hit);
}

/**
 * 2-gram 重叠系数（|A∩B| / min(|A|,|B|)）。
 *
 * 判「近重复」用重叠而不是 Jaccard：400/40 重叠分块产生的重复对是
 * 「一段是另一段的超集/子集」，Jaccard 会因为长度差把 0.95 的重叠压到 0.7，
 * 而重叠系数能正确识别「短的那段被长的那段包住」。
 */
export function overlapSimilarity(a: string, b: string): number {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    let hit = 0;
    for (const gram of small) if (large.has(gram)) hit++;
    return hit / small.size;
}

/**
 * 计算一个用例的近重复占比。
 * `texts` 可选：给出时按文本相似度判定，否则只按 id 判重（id 相同即重复）。
 */
export function duplicateRatioOf(ranked: readonly string[], texts?: readonly string[], threshold = DEFAULT_DUPLICATE_THRESHOLD): number {
    if (ranked.length === 0) return 0;
    const seen: string[] = [];
    let duplicates = 0;
    ranked.forEach((id, index) => {
        const text = texts?.[index];
        const isDuplicate = text !== undefined && seen.length > 0
            ? seen.some(previous => overlapSimilarity(previous, text) >= threshold)
            : seen.includes(id);
        if (isDuplicate) duplicates++;
        else if (text !== undefined) seen.push(text);
        else seen.push(id);
    });
    return duplicates / ranked.length;
}

/** 评分单条用例 */
export function scoreQuery(query: EvalQuery, k = DEFAULT_K, texts?: readonly string[], duplicateThreshold = DEFAULT_DUPLICATE_THRESHOLD): EvalQueryRow {
    const ranked = Array.isArray(query.ranked) ? query.ranked : [];
    const relevant = new Set(Array.isArray(query.relevant) ? query.relevant : []);
    const topK = ranked.slice(0, Math.max(1, k));
    const firstRank = ranked.findIndex(id => relevant.has(id));
    return {
        id: query.id,
        hit: topK.some(id => relevant.has(id)),
        firstRank: firstRank >= 0 ? firstRank + 1 : null,
        duplicateRatio: duplicateRatioOf(ranked, texts, duplicateThreshold),
    };
}

/** 汇总一批用例；空输入不抛错（CI 友好） */
export function scoreRetrieval(
    queries: readonly EvalQuery[],
    options: { k?: number; textsByQuery?: Record<string, readonly string[]>; duplicateThreshold?: number } = {},
): EvalReport {
    const k = Number.isInteger(options.k) && (options.k as number) > 0 ? options.k as number : DEFAULT_K;
    const threshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
    const rows = queries.map(query => scoreQuery(query, k, options.textsByQuery?.[query.id], threshold));
    const hits = rows.filter(row => row.hit).length;
    const reciprocalRankSum = rows.reduce((sum, row) => sum + (row.firstRank ? 1 / row.firstRank : 0), 0);
    const duplicateSum = rows.reduce((sum, row) => sum + row.duplicateRatio, 0);
    return {
        queries: rows.length,
        k,
        hitRate: rows.length === 0 ? 0 : (hits / rows.length) * 100,
        mrr: rows.length === 0 ? 0 : reciprocalRankSum / rows.length,
        duplicateRatio: rows.length === 0 ? 0 : duplicateSum / rows.length,
        rows,
    };
}

/** 一行汇总文本（CLI 与日志共用） */
export function formatEvalReport(report: EvalReport): string {
    return `queries=${report.queries} hit@${report.k}=${report.hitRate.toFixed(1)}% `
        + `MRR=${report.mrr.toFixed(3)} 近重复=${(report.duplicateRatio * 100).toFixed(1)}%`;
}