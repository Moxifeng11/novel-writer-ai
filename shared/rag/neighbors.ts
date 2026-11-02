/**
 * neighbors.ts — 邻块合并（纯函数）
 *
 * 知识库按 400 字/40 字重叠分块，同一段场景常被切成 2–3 块并同时命中。
 * 直接 top-N 会拿到三条"同一段"，既浪费预算又丢失完整上下文。
 * 这里把同书、同维度、position 相邻（±1）的命中合并成一段。
 */

export interface RagHit {
    sample: string;
    bookId: string;
    bookName: string;
    dimension: string;
    score: number;
    position?: number;
    category?: string;
    /** 命中的查询标签（合并后去重） */
    labels?: string[];
}

const NEIGHBOR_RADIUS = 1;

/**
 * 合并相邻块。规则：
 * - 同 book + dimension，position 差 ≤ radius 视为同一段；
 * - 合并后按 position 升序拼接，去重重叠部分（按最长公共前后缀裁剪）；
 * - 分数取组内最高，labels 取并集。
 * 无 position 的命中不做合并（保持原样）。
 * @param hits - 命中
 * @param radius - 半径
  * @returns number } 结果
 */
export function mergeNeighborHits(hits: RagHit[], radius: number = NEIGHBOR_RADIUS): { hits: RagHit[]; mergedGroups: number } {
    const withPosition = hits.filter((hit) => typeof hit.position === 'number');
    const withoutPosition = hits.filter((hit) => typeof hit.position !== 'number');
    if (withPosition.length <= 1) return { hits: [...hits], mergedGroups: 0 };

    const groups = new Map<string, RagHit[]>();
    for (const hit of withPosition) {
        const key = `${hit.bookId}\u0000${hit.dimension}`;
        const list = groups.get(key) || [];
        list.push(hit);
        groups.set(key, list);
    }

    const merged: RagHit[] = [];
    let mergedGroups = 0;
    for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => (a.position || 0) - (b.position || 0));
        let current: RagHit[] = [];
        for (const hit of sorted) {
            if (current.length === 0) {
                current.push(hit);
                continue;
            }
            const prev = current[current.length - 1];
            if ((hit.position || 0) - (prev.position || 0) <= radius) {
                current.push(hit);
            } else {
                if (current.length > 1) mergedGroups++;
                merged.push(combineGroup(current));
                current = [hit];
            }
        }
        if (current.length > 0) {
            if (current.length > 1) mergedGroups++;
            merged.push(combineGroup(current));
        }
    }

    return { hits: [...merged, ...withoutPosition], mergedGroups };
}

/**
 * 组内按 position 拼接，裁掉重叠前缀
 *
 * @param group - 分组
  * @returns RagHit 实例
 */
function combineGroup(group: RagHit[]): RagHit {
    const sorted = [...group].sort((a, b) => (a.position || 0) - (b.position || 0));
    let text = sorted[0].sample;
    for (let i = 1; i < sorted.length; i++) {
        text = appendWithoutOverlap(text, sorted[i].sample);
    }
    const labels = [...new Set(sorted.flatMap((hit) => hit.labels || []))];
    return {
        ...sorted[0],
        sample: text,
        score: Math.max(...sorted.map((hit) => hit.score)),
        labels,
    };
}

/**
 * 若后一段开头与已拼文本结尾重叠，去掉重叠部分再拼接
 *
 * @param base - 基础
 * @param next - 下一个
 * @returns 文本结果
 */
export function appendWithoutOverlap(base: string, next: string): string {
    const maxOverlap = Math.min(120, base.length, next.length);
    for (let size = maxOverlap; size >= 4; size--) {
        if (base.endsWith(next.slice(0, size))) {
            return base + next.slice(size);
        }
    }
    return `${base}${next}`;
}