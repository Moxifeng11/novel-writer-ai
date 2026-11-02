/**
 * shared/knowledge-position.ts — 知识检索结果 position 的唯一展示口径
 *
 * `KnowledgeSearchResult.position` 来自分块/报告样本的数组下标（0 基），
 * 不是 0–1 的相对位置。此前 prompt 与浮窗都按比例乘 100，
 * 会显示「位置4500%」这类无意义数值，误导模型与用户。
 * @param position - 位置
 * @returns 文本结果
 */
export function formatKnowledgeChunkLabel(position?: number): string {
    if (position === undefined || !Number.isFinite(position) || position < 0) return '';
    return `片段#${Math.floor(position) + 1}`;
}

/** 参与相邻去重的最小字段（避免 shared 依赖 engine 类型） */
export interface ChunkCandidate {
    bookId: string;
    dimension: string;
    position?: number;
}

/**
 * 去掉同一本书内 position 相邻的原文分块。
 *
 * 原文按 400 字/40 字重叠分块，相邻块有 40 字重复；检索命中多条相邻块时
 * 同时注入会让同一段文字重复占 prompt 预算。结果需按相关度降序传入，
 * 保留先出现（分数更高）的块。
 */
export function dedupeAdjacentChunks<T extends ChunkCandidate>(
    results: T[],
    options?: { dimension?: string; maxGap?: number },
): T[] {
    const dimension = options?.dimension ?? 'original';
    const maxGap = options?.maxGap ?? 1;
    const keptPositions = new Map<string, number[]>();

    return results.filter(r => {
        if (r.dimension !== dimension) return true;
        if (r.position === undefined || !Number.isFinite(r.position)) return true;

        const positions = keptPositions.get(r.bookId) ?? [];
        if (positions.some(p => Math.abs(p - r.position!) <= maxGap)) return false;
        positions.push(r.position);
        keptPositions.set(r.bookId, positions);
        return true;
    });
}
