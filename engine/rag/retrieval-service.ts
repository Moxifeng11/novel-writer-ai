/**
 * retrieval-service.ts — 统一 RAG 检索（多查询 → 邻块 → MMR → 预算）
 *
 * 旧实现散落在 knowledge-injector 的 9 个方法里：各自 `search()`、各自
 * `slice(0, 120~180)`、各自丢结果，既重复嵌入又丢上下文。这里收敛成一条管线：
 *
 *   查询计划（多来源） → 并行检索 → 合并去重 → 邻块扩展 → MMR → 阈值 → 预算打包
 *
 * 输出带 citation（书名·维度）与完整遥测，供注入账本与「知识注入」段展示。
 */
import type { KnowledgeSearchResult, KnowledgeVectorStore } from '../knowledge-vector-store';
import { buildQueryPlan, type RagQuery, type RagQuerySource } from '../../shared/rag/query-plan';
import { mergeNeighborHits, type RagHit } from '../../shared/rag/neighbors';
import { mmrSelect } from '../../shared/rag/diversity';
import { packByBudget, sampleBudgetOf } from '../../shared/rag/budget-pack';
import { createLogger } from '../../shared/logger';

const log = createLogger('RagRetrieval');

/**
 * 检索选项。
 */
export interface RetrieveOptions {
    /** 只在这些维度里检索 */
    dimensions?: string[];
    /** 参考书过滤 */
    bookIds?: string[];
    /** 返回条数上限 */
    topN?: number;
    /** 样本正文的字符预算（不含每条固定开销） */
    maxChars?: number;
    /** 最低相关度（0–1），默认 0.35 */
    minScore?: number;
    /** MMR 相关性权重，默认 0.7 */
    mmrLambda?: number;
    /** 是否做邻块扩展，默认 true */
    expandNeighbors?: boolean;
    /** 查询来源（缺省时只用一个查询） */
    source?: RagQuerySource;
    /** 直接用这段文本作为唯一查询（兼容旧调用） */
    queryText?: string;
}

/**
 * 检索遥测。
 */
export interface RetrievalTelemetry {
    queries: number;
    hits: number;
    deduped: number;
    neighborMerged: number;
    afterMmr: number;
    dropped: number;
    chars: number;
    cacheHits: number;
    cacheMisses: number;
    durationMs: number;
}

/**
 * 检索结果。
 */
export interface RetrievalResult {
    hits: RagHit[];
    telemetry: RetrievalTelemetry;
    /** 检索失败原因（调用方写入注入账本，不再静默） */
    error?: string;
}

const DEFAULT_TOP_N = 4;
const DEFAULT_MAX_CHARS = 600;
const DEFAULT_MIN_SCORE = 0.35;

/**
 * 把向量库结果转成统一的 RagHit（带上命中的查询标签）
 *
 * @param result - 结果
 * @param label - 标签
 * @param weight - 权重
  * @returns RagHit 实例
 */
function toRagHit(result: KnowledgeSearchResult, label: string, weight: number): RagHit {
    return {
        sample: result.sample,
        bookId: result.bookId,
        bookName: result.bookName,
        dimension: result.dimension,
        score: Math.min(1, result.score * weight),
        position: result.position,
        category: result.category,
        labels: [label],
    };
}

/**
 * 合并多查询结果：key 用 book|dimension|position|sample 前缀，保留最高分并合并标签
 *
 * @param groups - 分组列表
 */
export function mergeQueryResults(groups: Array<{ label: string; weight: number; results: KnowledgeSearchResult[] }>): {
    hits: RagHit[];
    deduped: number;
} {
    const byKey = new Map<string, RagHit>();
    let total = 0;
    for (const group of groups) {
        for (const result of group.results) {
            total++;
            const key = `${result.bookId}|${result.dimension}|${result.position ?? 'x'}|${result.sample.slice(0, 60)}`;
            const candidate = toRagHit(result, group.label, group.weight);
            const existing = byKey.get(key);
            if (!existing) {
                byKey.set(key, candidate);
                continue;
            }
            if (candidate.score > existing.score) {
                byKey.set(key, { ...candidate, labels: [...new Set([...(existing.labels || []), ...(candidate.labels || [])])] });
            } else {
                existing.labels = [...new Set([...(existing.labels || []), ...(candidate.labels || [])])];
            }
        }
    }
    return { hits: [...byKey.values()], deduped: Math.max(0, total - byKey.size) };
}

/**
 * 执行检索。任何异常都被收敛成 `{ hits: [], error }`，
 * 由调用方写进注入账本（旧实现直接 `catch { return '' }`，失败完全不可见）。
 * @param store - 存储
 * @param options - 配置项
  * @returns RetrievalResult 实例
 */
export async function retrieve(
    store: KnowledgeVectorStore | null | undefined,
    options: RetrieveOptions,
): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const emptyTelemetry = (): RetrievalTelemetry => ({
        queries: 0, hits: 0, deduped: 0, neighborMerged: 0, afterMmr: 0,
        dropped: 0, chars: 0, cacheHits: 0, cacheMisses: 0, durationMs: Date.now() - startedAt,
    });
    if (!store) return { hits: [], telemetry: emptyTelemetry(), error: '知识向量库未初始化' };

    const plan: RagQuery[] = options.source
        ? buildQueryPlan(options.source)
        : (options.queryText && options.queryText.trim().length >= 4
            ? [{ label: '当前正文', text: options.queryText.trim().slice(0, 1200), weight: 1 }]
            : []);
    if (plan.length === 0) return { hits: [], telemetry: emptyTelemetry() };

    const topN = options.topN ?? DEFAULT_TOP_N;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

    try {
        // 向量库可能是宿主注入的轻量实现（测试/旧版本只提供 search）：
        // 缓存统计与邻块读取按能力探测，缺省即跳过，而不是整条管线失败。
        const cacheStats = (): { hits: number; misses: number } => (
            typeof store.getQueryCacheStats === 'function'
                ? store.getQueryCacheStats()
                : { hits: 0, misses: 0 }
        );
        const cacheBefore = cacheStats();
        const settled = await Promise.allSettled(plan.map(async (query) => ({
            label: query.label,
            weight: query.weight,
            results: await store.search(query.text, {
                topN: Math.max(topN, 3),
                bookIds: options.bookIds,
                dimensions: options.dimensions,
                filterScope: 'perDimension',
            }),
        })));
        const groups: Array<{ label: string; weight: number; results: KnowledgeSearchResult[] }> = [];
        let queryFailures = 0;
        for (const item of settled) {
            if (item.status === 'fulfilled') groups.push(item.value);
            else queryFailures++;
        }
        if (groups.length === 0) {
            return { hits: [], telemetry: emptyTelemetry(), error: `全部 ${queryFailures} 条查询失败` };
        }

        const merged = mergeQueryResults(groups);
        const cacheAfter = cacheStats();

        // 邻块扩展：把被 400/40 分块切开的同一段场景拼回来
        let neighborMerged = 0;
        let working = merged.hits;
        if (options.expandNeighbors !== false) {
            const positions = working.map((hit) => hit.position).filter((value): value is number => typeof value === 'number');
            if (positions.length > 0 && working.length > 0 && typeof store.getNeighbors === 'function') {
                const neighbors = await store.getNeighbors(options.bookIds || [], working[0].dimension, positions, 1);
                // 把邻块补成命中（分数取命中组最低分，保证不抢主命中）
                const known = new Set(working.map((hit) => `${hit.bookId}|${hit.dimension}|${hit.position}`));
                const lowestScore = Math.min(...working.map((hit) => hit.score));
                for (const neighbor of neighbors) {
                    const key = `${neighbor.bookId}|${neighbor.dimension}|${neighbor.position}`;
                    if (known.has(key)) continue;
                    known.add(key);
                    working.push({
                        sample: neighbor.sample,
                        bookId: neighbor.bookId,
                        bookName: neighbor.bookName,
                        dimension: neighbor.dimension,
                        score: Math.max(0.3, lowestScore * 0.95),
                        position: neighbor.position,
                        category: neighbor.category,
                        labels: ['邻块'],
                    });
                }
                const neighborResult = mergeNeighborHits(working, 1);
                working = neighborResult.hits;
                neighborMerged = neighborResult.mergedGroups;
            }
        }

        const relevant = working.filter((hit) => hit.score >= minScore);
        const afterMmr = mmrSelect(relevant, Math.max(topN, 3), { lambda: options.mmrLambda ?? 0.7 });
        const packed = packByBudget(afterMmr, sampleBudgetOf(maxChars, topN));

        return {
            hits: packed.picked.slice(0, topN),
            telemetry: {
                queries: plan.length,
                hits: merged.hits.length,
                deduped: merged.deduped,
                neighborMerged,
                afterMmr: afterMmr.length,
                dropped: packed.dropped + (relevant.length - afterMmr.length),
                chars: packed.chars,
                cacheHits: cacheAfter.hits - cacheBefore.hits,
                cacheMisses: cacheAfter.misses - cacheBefore.misses,
                durationMs: Date.now() - startedAt,
            },
            error: queryFailures > 0 ? `${queryFailures} 条查询失败（已用其余结果）` : undefined,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn('[RagRetrieval] 检索失败:', message);
        return { hits: [], telemetry: emptyTelemetry(), error: message };
    }
}

/**
 * 把命中渲染成注入块（统一 citation 格式）
 *
 * @param hits - 命中
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatRetrievalHits(
    hits: RagHit[],
    options: { perItemChars?: number; header?: string; showCitation?: boolean } = {},
): string {
    if (hits.length === 0) return '';
    const limit = options.perItemChars ?? 260;
    const lines: string[] = [];
    if (options.header) lines.push(options.header);
    hits.forEach((hit, index) => {
        const citation = options.showCitation === false ? '' : `〔${hit.bookName}·${hit.dimension}〕`;
        const sample = hit.sample.length > limit ? `${hit.sample.slice(0, limit)}…` : hit.sample;
        lines.push(`${index + 1}. ${citation}${sample}`);
    });
    return lines.join('\n');
}