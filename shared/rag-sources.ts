/**
 * rag-sources.ts — 知识库注入来源（可追溯）
 *
 * 目标：每次生成若注入了知识库片段，把「哪本书、哪个维度、相似度、哪段原文」记进
 * 步骤结果 frontmatter 的 `rag_sources`，让「知识库到底有没有帮上忙」可查。
 *
 * 口径：
 * - 只记录实际进入 prompt 的命中文档（由 injector 报告），不是检索池
 * - 同一本书同一维度同一片段只记一次；总条数上限 8，避免 frontmatter 膨胀
 * - excerpt 截断到 60 字：足以人工辨认，又不至于把整段原文复制进每个步骤文件
 */

export interface RagSource {
    /** 参考书名 */
    book: string;
    /** 维度：style / original / technique / character / structure / ... */
    dimension: string;
    /** 相似度分数（0-1 或排序分），保留两位 */
    score: number;
    /** 命中片段开头，最长 60 字 */
    excerpt: string;
}

export const RAG_SOURCE_LIMIT = 8;
export const RAG_EXCERPT_MAX = 60;

function normalizeExcerpt(sample: string): string {
    const text = String(sample || '').replace(/\s+/g, ' ').trim();
    return text.length > RAG_EXCERPT_MAX ? `${text.slice(0, RAG_EXCERPT_MAX)}…` : text;
}

/** 追加一条来源（去重 + 上限），返回是否真的写入 */
export function pushRagSource(list: RagSource[], source: RagSource): boolean {
    const book = String(source.book || '').trim();
    if (!book) return false;
    const excerpt = normalizeExcerpt(source.excerpt);
    if (!excerpt) return false;
    const dimension = String(source.dimension || '').trim() || 'unknown';
    const key = `${book}\u0000${dimension}\u0000${excerpt}`;
    if (list.some(item => `${item.book}\u0000${item.dimension}\u0000${item.excerpt}` === key)) return false;
    if (list.length >= RAG_SOURCE_LIMIT) return false;
    list.push({
        book,
        dimension,
        score: Number.isFinite(source.score) ? Math.round(source.score * 100) / 100 : 0,
        excerpt,
    });
    return true;
}

/** 写入 frontmatter 前的清洗：去重、截断、限制条数（幂等） */
export function formatRagSources(list: readonly RagSource[]): RagSource[] {
    const out: RagSource[] = [];
    for (const item of list) pushRagSource(out, item);
    return out;
}

/** 一句话摘要，用于统计页/日志：书A(style) 0.82；书B(original) 0.74 … */
export function summarizeRagSources(list: readonly RagSource[]): string {
    return formatRagSources(list)
        .map(item => `${item.book}(${item.dimension}) ${item.score.toFixed(2)}`)
        .join('；');
}

// ─── 使用统计（G2-3b）────────────────────────────────────────────

export interface RagUsageRecord {
    /** 文件路径（步骤结果或正文） */
    path: string;
    /** 展示标签：步骤名（如「大纲摘要」）或「正文」 */
    label: string;
    sources: RagSource[];
}

export interface RagUsageSummary {
    /** 扫描到的承载文件数（步骤结果 + 正文） */
    stepsTotal: number;
    /** 其中带 rag_sources 的文件数 */
    stepsWithRag: number;
    /** 命中率 = stepsWithRag / stepsTotal（0-1） */
    hitRate: number;
    /** 引用片段总条数 */
    totalSources: number;
    /** 按书名聚合，降序 */
    byBook: Array<{ book: string; count: number }>;
    /** 按维度聚合，降序 */
    byDimension: Array<{ dimension: string; count: number }>;
    /** 最近引用的若干条（调用方按 mtime 排序后传入） */
    recent: RagUsageRecord[];
}

/** 从 frontmatter 的 rag_sources 还原（容忍旧数据/手改） */
export function normalizeRagSources(value: unknown): RagSource[] {
    if (!Array.isArray(value)) return [];
    const out: RagSource[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const book = typeof item.book === 'string' ? item.book : '';
        const dimension = typeof item.dimension === 'string' ? item.dimension : 'unknown';
        const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0;
        const excerpt = typeof item.excerpt === 'string' ? item.excerpt : '';
        pushRagSource(out, { book, dimension, score, excerpt });
    }
    return out;
}

/** 汇总知识引用情况（纯函数） */
export function summarizeRagUsage(
    records: readonly RagUsageRecord[],
    options: { recentLimit?: number } = {},
): RagUsageSummary {
    const recentLimit = options.recentLimit ?? 5;
    const bookCounts = new Map<string, number>();
    const dimensionCounts = new Map<string, number>();
    let stepsWithRag = 0;
    let totalSources = 0;

    for (const record of records) {
        if (record.sources.length === 0) continue;
        stepsWithRag++;
        totalSources += record.sources.length;
        for (const source of record.sources) {
            bookCounts.set(source.book, (bookCounts.get(source.book) || 0) + 1);
            dimensionCounts.set(source.dimension, (dimensionCounts.get(source.dimension) || 0) + 1);
        }
    }

    const toSorted = (map: Map<string, number>) => Array.from(map.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    return {
        stepsTotal: records.length,
        stepsWithRag,
        hitRate: records.length > 0 ? stepsWithRag / records.length : 0,
        totalSources,
        byBook: toSorted(bookCounts).map(item => ({ book: item.key, count: item.count })),
        byDimension: toSorted(dimensionCounts).map(item => ({ dimension: item.key, count: item.count })),
        recent: records.filter(record => record.sources.length > 0).slice(0, recentLimit),
    };
}
