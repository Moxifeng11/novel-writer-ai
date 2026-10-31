/**
 * human-similarity.ts — 「像不像人写」的分布相似度（纯函数）
 *
 * 现有判定有两个极端：AntiAIDetector 只数「已知 AI 标记」（把分刷到 0 得到的是
 * 毫无特征的均值文本，同样像 AI）；WQE 反而奖励排比与「不仅…而且」。
 * 这里换一个口径：拿真人语料的**分布**当参照，量「这段文本的句长/段长/标点/对话占比
 * 与真人分布有多接近」。它衡量的是「像不像这批人写的」，不是「有没有错误特征」。
 *
 * 基线由 `scripts/sample-human-corpus.mjs` 从本地指纹库抽取的真人样文统计得到。
 */

export interface DistributionHistogram {
    /** 句长直方图（按 10 字一桶，桶 0: 0-9 字 …） */
    sentence: number[];
    /** 段长直方图（按 40 字一桶） */
    paragraph: number[];
    /** 标点占比 */
    punctuation: {
        period: number;
        comma: number;
        semicolon: number;
        ellipsis: number;
        dash: number;
        exclamation: number;
        question: number;
    };
    /** 对话字符占比（引号内字符 / 全文） */
    dialogueRatio: number;
}

export interface TextDistribution extends DistributionHistogram {
    sentenceCount: number;
    paragraphCount: number;
    chars: number;
}

const SENTENCE_BUCKET = 10;
const PARAGRAPH_BUCKET = 40;
/** 直方图桶数：句子 0-199 字（20 桶），段落 0-799 字（20 桶），超出并入最后一桶 */
const BUCKETS = 20;

function toHistogram(values: number[], bucketSize: number): number[] {
    const buckets = new Array<number>(BUCKETS).fill(0);
    for (const value of values) {
        const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor(value / bucketSize)));
        buckets[index] += 1;
    }
    return buckets;
}

function normalizeHistogram(buckets: number[]): number[] {
    const total = buckets.reduce((sum, n) => sum + n, 0);
    return total > 0 ? buckets.map((n) => n / total) : buckets;
}

/** 去掉 frontmatter、标题行与引用行，只留正文 */
export function stripNonProse(raw: string): string {
    return String(raw || '')
        .replace(/^---[\s\S]*?---\s*/, '')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line) && !/^\s*>/.test(line) && !/^\s*\|/.test(line))
        .join('\n');
}

/** 统计一段文本的分布 */
export function analyzeDistribution(raw: string): TextDistribution {
    const text = stripNonProse(raw);
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const sentences = text
        .split(/[。！？!?…]+/)
        .map((s) => s.replace(/\s+/g, ''))
        .filter((s) => s.length > 0);

    const chars = Math.max(1, text.replace(/\s+/g, '').length);
    const count = (re: RegExp): number => (text.match(re) || []).length;
    const dialogueChars = [...text.matchAll(/[“"「]([^”"」]{0,400})[”"」]/g)]
        .reduce((sum, m) => sum + (m[1] ? m[1].replace(/\s+/g, '').length : 0), 0);

    return {
        chars,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        sentence: normalizeHistogram(toHistogram(sentences.map((s) => s.length), SENTENCE_BUCKET)),
        paragraph: normalizeHistogram(toHistogram(paragraphs.map((p) => p.length), PARAGRAPH_BUCKET)),
        punctuation: {
            period: count(/。/g) / chars,
            comma: (count(/，/g) + count(/,/g)) / chars,
            semicolon: (count(/；/g) + count(/;/g)) / chars,
            ellipsis: (count(/…/g) + count(/\.\.\./g)) / chars,
            dash: (count(/——/g) + count(/—/g)) / chars,
            exclamation: (count(/！/g) + count(/!/g)) / chars,
            question: (count(/？/g) + count(/\?/g)) / chars,
        },
        dialogueRatio: dialogueChars / chars,
    };
}

/** 直方图相似度：1 - 0.5 * Σ|p-q|（重叠系数），取值 0–1 */
export function histogramSimilarity(a: readonly number[], b: readonly number[]): number {
    const length = Math.max(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < length; i++) {
        diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    }
    return Math.max(0, 1 - diff / 2);
}

/** 余弦相似度（向量全部非负时取值 0–1） */
function cosineSimilarity(
    a: Record<string, number>,
    b: Record<string, number>,
): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const key of keys) {
        const x = a[key] ?? 0;
        const y = b[key] ?? 0;
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    if (normA <= 0 && normB <= 0) return 1;
    if (normA <= 0 || normB <= 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 标量相似度：按参照值归一化，避免「越接近 0 越好」的线性误判 */
function ratioSimilarity(actual: number, reference: number): number {
    if (reference <= 0 && actual <= 0) return 1;
    // 下限 0.01：分号/破折号这类千分之几的标点，相对误差会被放大到失真
    const base = Math.max(reference, 0.01);
    const relative = Math.abs(actual - base) / base;
    return Math.max(0, 1 - Math.min(1, relative));
}

/**
 * 带容差带的比值相似度：相对误差在 ±tolerance 内记满分，之外线性衰减。
 *
 * 400 字短样文的占比噪声很大（一段对话就能把对话占比从 0.1 抬到 0.3），
 * 用纯相对误差会把「同一批真人文本」判成低分。容差带让指标对样本长度更稳。
 */
function bandedRatioSimilarity(actual: number, reference: number, tolerance = 0.35): number {
    if (reference <= 0 && actual <= 0) return 1;
    const base = Math.max(reference, 0.01);
    const relative = Math.abs(actual - base) / base;
    if (relative <= tolerance) return 1;
    const decay = (relative - tolerance) / Math.max(0.0001, 1 - tolerance);
    return Math.max(0, 1 - Math.min(1, decay));
}

export interface HumanSimilarityDetail {
    /** 总相似度 0–1 */
    score: number;
    sentence: number;
    paragraph: number;
    punctuation: number;
    dialogue: number;
}

/**
 * 与真人基线的相似度。
 *
 * 权重经过真实数据校准（2026-10-31）：拿第2章 AI 正文测，句长/段长/标点三项都接近
 * 真人基线（提示词早就把这些表层特征优化过了），真正拉开差距的是**对话占比**——
 * 真人网文 25% 上下，AI 正文只有 9%。所以对话权重从 0.15 提到 0.35，
 * 句长/段长降权，避免「表面参差」冒充人味。
 */
export function humanSimilarity(text: string, baseline: DistributionHistogram): HumanSimilarityDetail {
    const actual = analyzeDistribution(text);
    const sentence = histogramSimilarity(actual.sentence, baseline.sentence);
    const paragraph = histogramSimilarity(actual.paragraph, baseline.paragraph);

    // 标点用余弦相似度：400 字样文的标点比例波动很大（一句里两个逗号就把比例抬一倍），
    // 逐项相对误差会把「同一批真人文本」判成低分。余弦只看整体形状，容忍尺度噪声。
    const punctuation = cosineSimilarity(actual.punctuation, baseline.punctuation);

    const dialogue = bandedRatioSimilarity(actual.dialogueRatio, baseline.dialogueRatio, 0.35);
    const score = 0.30 * sentence + 0.20 * paragraph + 0.15 * punctuation + 0.35 * dialogue;
    return { score, sentence, paragraph, punctuation, dialogue };
}

export interface FidelityCheck {
    /** 长度比 candidate / original */
    lengthRatio: number;
    /** 原文字符 2-gram 被候选覆盖的比例（防止改写把情节换掉） */
    contentOverlap: number;
    /** 原文中的数字是否保留（情节锚点） */
    numbersKept: boolean;
    /** 结论 0–1：1 = 完全保真 */
    score: number;
    ok: boolean;
    reasons: string[];
}

function bigrams(text: string): Set<string> {
    const s = text.replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 1 < s.length; i++) set.add(s.slice(i, i + 2));
    return set;
}

/**
 * 保真检查：改写只应改表达，不应改情节与人设。
 * 长度 ±15%、原文 2-gram 覆盖 ≥0.55、原文数字全保留才算通过。
 */
export function checkFidelity(original: string, candidate: string): FidelityCheck {
    const source = stripNonProse(original).replace(/\s+/g, '');
    const target = stripNonProse(candidate).replace(/\s+/g, '');
    const lengthRatio = source.length > 0 ? target.length / source.length : 0;

    const sourceGrams = bigrams(source);
    const targetGrams = bigrams(target);
    let hit = 0;
    for (const gram of sourceGrams) if (targetGrams.has(gram)) hit += 1;
    const contentOverlap = sourceGrams.size > 0 ? hit / sourceGrams.size : 1;

    const sourceNumbers = (source.match(/\d+(?:\.\d+)?/g) ?? []);
    const numbersKept = sourceNumbers.every((n) => target.includes(n));

    const lengthScore = Math.max(0, 1 - Math.abs(lengthRatio - 1) / 0.15);
    const score = 0.4 * Math.min(1, lengthScore) + 0.45 * Math.min(1, contentOverlap / 0.55) + 0.15 * (numbersKept ? 1 : 0);

    const reasons: string[] = [];
    if (lengthRatio < 0.85) reasons.push(`改写后过短（${Math.round(lengthRatio * 100)}%），可能丢内容`);
    if (lengthRatio > 1.15) reasons.push(`改写后过长（${Math.round(lengthRatio * 100)}%），可能加了原文没有的情节`);
    if (contentOverlap < 0.55) reasons.push(`原文内容重合仅 ${Math.round(contentOverlap * 100)}%，情节可能被改写`);
    if (!numbersKept) reasons.push('原文数字未全部保留');

    return {
        lengthRatio,
        contentOverlap,
        numbersKept,
        score: Math.max(0, Math.min(1, score)),
        ok: reasons.length === 0,
        reasons,
    };
}

export interface HumanityScore {
    /** AI 味 0–100（越低越好，来自 AntiAIDetector） */
    antiAI: number;
    humanSim: number;
    fidelity: FidelityCheck;
    /** 综合分 0–1（越高越好） */
    composite: number;
}

/**
 * 综合分：0.40×(100−antiAI)/100 + 0.45×humanSim + 0.15×fidelity。
 * 保真不过（ok=false）时综合分按 0 计——改得再「像人」但把情节改没了也不能接受。
 */
export function scoreHumanity(params: {
    original: string;
    candidate: string;
    antiAI: number;
    baseline: DistributionHistogram;
}): HumanityScore {
    const distribution = analyzeDistribution(params.candidate);
    const humanSim = humanSimilarity(params.candidate, params.baseline).score;
    const fidelity = checkFidelity(params.original, params.candidate);

    // 对话占比下限（实测校准）：真人长篇 25% 上下，AI 正文只有 9%——
    // 句长/段长/标点都能被提示词「调」到像人，唯独对话密度调不出来。
    // 因此章级文本（≥1200 字）对话低于 12% 时直接判不保真（读感问题即为真问题）。
    // 2026-10-31 校准：人工样本（朱雀判「人工创作特征显著」）对话占比 38%，
    // 我们六份生成稿 9%–17%，朱雀全部判「未发现明显的人工创作特征」。下限提到 20%。
    if (distribution.chars >= 1200 && distribution.dialogueRatio < 0.20) {
        fidelity.reasons.push(`对话占比 ${(distribution.dialogueRatio * 100).toFixed(0)}%（人工样本 38%），信息几乎都由叙述转述，读起来像梗概`);
        fidelity.ok = false;
        fidelity.score = Math.min(fidelity.score, 0.4);
    }

    const anti = Math.max(0, Math.min(100, params.antiAI));
    const composite = fidelity.ok
        ? 0.40 * ((100 - anti) / 100) + 0.45 * humanSim + 0.15 * fidelity.score
        : 0;
    return { antiAI: anti, humanSim, fidelity, composite };
}
