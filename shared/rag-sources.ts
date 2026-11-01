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
