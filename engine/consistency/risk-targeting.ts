/**
 * risk-targeting.ts — 一致性审核的风险定位（S3）
 *
 * 目的：**省 token**。全量把每章正文送模型复核太贵，而 ConStory-Bench 的实测结论是
 * 一致性错误有明确倾向，可以据此只审高风险段：
 *  - 错误**集中在故事中段**（位置 30%–70%）
 *  - 错误出现在**高 token 熵**片段
 *  - 某些错误类型**共现**
 *
 * 本模块只做**本地统计**（字符分布熵、罕见字密度、句长方差），不调任何 API，
 * 因此可以全量跑、零成本，用于给后续 LLM 复核排序与截断。
 */

/** 分段结果 */
export interface RiskSegment {
    /** 章节 key */
    chapterKey: string;
    /** 段落在正文中的起止字符偏移 */
    start: number;
    end: number;
    /** 风险分（0–1，越高越优先） */
    score: number;
    /** 加分原因（便于解释与调参） */
    reasons: string[];
}

/** 定位输入 */
export interface RiskTargetingInput {
    /** 章节正文 */
    chapters: ReadonlyArray<{ chapterKey: string; body: string }>;
    /** 每段目标长度（字符，默认 800） */
    segmentSize?: number;
    /** 最多返回多少段（默认 Infinity） */
    limit?: number;
    /** 期望审阅的正文覆盖率（0–1，默认 0.4） */
    coverage?: number;
}

/** 默认分段长度 */
export const DEFAULT_SEGMENT_SIZE = 800;

/** 中段加权的核心区间（论文实测错误集中处） */
const MIDDLE_FROM = 0.3;
const MIDDLE_TO = 0.7;

/**
 * 计算文本的字符分布熵（归一化到 0–1）。
 *
 * 用字符（而非 token）近似：中文网文里 token 熵与字符熵高度相关，
 * 且字符统计零依赖、可离线算。
 *
 * @param text - 文本
 * @returns 归一化熵（0–1）
 */
export function charEntropy(text: string): number {
    const chars = [...(text || '')].filter(ch => !/\s/.test(ch));
    if (chars.length < 8) return 0;
    const counts = new Map<string, number>();
    for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / chars.length;
        entropy -= p * Math.log2(p);
    }
    // 归一化：以「不同字符数」为理论上限
    const max = Math.log2(counts.size || 1);
    return max > 0 ? Math.min(1, entropy / max) : 0;
}

/**
 * 罕见字密度（全文出现次数 ≤2 的字符占比）。
 *
 * 罕见字多通常意味着具体名词/生僻设定密集，正是设定矛盾的高发处。
 *
 * @param text - 文本
 * @returns 0–1
 */
export function rareCharDensity(text: string): number {
    const chars = [...(text || '')].filter(ch => !/\s/.test(ch));
    if (chars.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let rare = 0;
    for (const [ch, count] of counts) {
        if (count <= 2) rare += count;
    }
    return rare / chars.length;
}

/**
 * 句长方差（越大越可能节奏紊乱/信息堆叠）。
 *
 * @param text - 文本
 * @returns 方差（字符²）
 */
export function sentenceLengthVariance(text: string): number {
    const sentences = (text || '').split(/[。！？!?\n]+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length < 2) return 0;
    const lengths = sentences.map(s => s.length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    return lengths.reduce((acc, len) => acc + (len - mean) ** 2, 0) / lengths.length;
}

/**
 * 定位高风险段落。
 *
 * 打分组成（各自归一化后加权）：
 *  - 位置：处于 [0.3, 0.7] 得 0.4 分（论文实证）
 *  - 熵：字符熵 × 0.35
 *  - 罕见字密度：× 0.25
 *
 * 只返回按分数降序、累计长度不超过 `coverage` 的段落。
 *
 * @param input - 输入
 * @returns 高风险段落（按风险降序）
 */
export function selectRiskSegments(input: RiskTargetingInput): RiskSegment[] {
    const size = Math.max(200, input.segmentSize ?? DEFAULT_SEGMENT_SIZE);
    const coverage = Math.min(1, Math.max(0.05, input.coverage ?? 0.4));
    const segments: RiskSegment[] = [];

    for (const chapter of input.chapters) {
        const body = chapter.body || '';
        if (!body) continue;
        const total = body.length;
        const count = Math.max(1, Math.ceil(total / size));
        for (let i = 0; i < count; i++) {
            const start = i * size;
            const end = Math.min(total, start + size);
            const text = body.slice(start, end);
            if (text.trim().length === 0) continue;

            const position = total === 0 ? 0 : (start + end) / 2 / total;
            const inMiddle = position >= MIDDLE_FROM && position <= MIDDLE_TO;
            const entropy = charEntropy(text);
            const rare = rareCharDensity(text);
            const variance = sentenceLengthVariance(text);

            const reasons: string[] = [];
            let score = 0;
            if (inMiddle) {
                score += 0.4;
                reasons.push('位于故事中段');
            }
            score += entropy * 0.35;
            if (entropy > 0.75) reasons.push('字符熵偏高');
            score += rare * 0.25;
            if (rare > 0.5) reasons.push('罕见字密集');
            if (variance > 3000) {
                score += 0.1;
                reasons.push('句长波动大');
            }

            segments.push({
                chapterKey: chapter.chapterKey,
                start,
                end,
                score: Math.min(1, Number(score.toFixed(4))),
                reasons,
            });
        }
    }

    segments.sort((a, b) => b.score - a.score);
    if (input.limit !== undefined) return segments.slice(0, Math.max(0, input.limit));

    // 按覆盖率截断：累计长度不超过正文总长 × coverage
    const totalChars = input.chapters.reduce((acc, c) => acc + (c.body?.length ?? 0), 0);
    const budget = totalChars * coverage;
    const picked: RiskSegment[] = [];
    let used = 0;
    for (const segment of segments) {
        const length = segment.end - segment.start;
        if (used + length > budget && picked.length > 0) break;
        picked.push(segment);
        used += length;
    }
    // 结果仍按「章节顺序 + 段内位置」返回，便于呈现
    return picked.sort((a, b) => (a.chapterKey === b.chapterKey
        ? a.start - b.start
        : a.chapterKey.localeCompare(b.chapterKey)));
}

/**
 * 类型共现提示：命中一类时顺带关注相关类（论文实证存在共现）。
 *
 * @param kind - 已命中的类型
 * @returns 建议一并关注的相关类型
 */
export function coexistingKinds(kind: string): string[] {
    switch (kind) {
        case 'quantitative':
            // 数量不符常与命名混淆同时出现（同一批设定被记错）
            return ['nomenclature', 'appearance'];
        case 'nomenclature':
            return ['quantitative'];
        case 'absolute-time':
        case 'duration':
        case 'simultaneity':
            return ['causeless-effect', 'causal-violation'];
        default:
            return [];
    }
}

/**
 * 判断某章某偏移是否落在给定高风险段内。
 *
 * @param segments - 高风险段
 * @param chapterKey - 章节 key
 * @param offset - 字符偏移
 * @returns 是否命中
 */
export function isHighRiskOffset(
    segments: readonly RiskSegment[],
    chapterKey: string,
    offset: number | undefined,
): boolean {
    if (offset === undefined) return false;
    return segments.some(s => s.chapterKey === chapterKey && offset >= s.start && offset < s.end);
}
