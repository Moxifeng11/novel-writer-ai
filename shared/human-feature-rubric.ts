/**
 * human-feature-rubric.ts — 「人工特征」评分卡（纯函数）
 *
 * 来源：一份 100% 人工样本（2306 字，朱雀判定「人工创作特征显著」）与本公司 6 份生成稿
 * 的对照统计。人工样本的可测特征与我们差得很远，而且方向明确：
 *
 *   特征                人工样本      我们（6 份）        判读
 *   对话占比            0.384        0.09–0.17          差 2–4 倍，主因
 *   对话块数（每千字）  27.7         6–23               人工靠短对话推进
 *   短叙述占比(≤25字)   0.63         0.82–0.95          我们「碎」过头了
 *   对话/叙述交替率     0.41         0.39–0.64          接近
 *   口语标记（每千字）  2.2          0–2                我们几乎没有
 *   时间/序数锚点       12 处        0–2                人工用「第一波/第八分钟」定节拍
 *
 * 因此这里按人工样本的区间打分（不是「越多越好」，短叙述占比有上界：过碎也是 AI 腔）。
 */

export interface HumanFeatureMetrics {
    chars: number;
    dialogueRatio: number;
    /** 每千字对话块数（一段引号内容算一块） */
    dialogueBlocksPerKilo: number;
    /** 对话句里 ≤12 字的占比 */
    shortDialogueShare: number;
    /** 叙述句里 ≤25 字的占比（有上界：>0.85 判过碎） */
    shortNarrationShare: number;
    /** 相邻段「说话/动作」交替率 */
    alternationRate: number;
    /** 口语标记每千字（啊/呗/嘛/啥/咋/好家伙/晓得…） */
    colloquialPerKilo: number;
    /** 时间/序数锚点数量（第N波/第N分钟/第N局/第N次） */
    timeAnchors: number;
}

export interface RubricIssue {
    key: string;
    label: string;
    actual: number;
    /** 期望区间 [min, max]（max 为 Infinity 表示只有下限） */
    expected: [number, number];
    message: string;
}

export interface RubricResult {
    metrics: HumanFeatureMetrics;
    /** 0–1，命中项越多越高 */
    score: number;
    issues: RubricIssue[];
    pass: boolean;
}

/** 人工样本测得的目标区间（留了容差，不是照抄一个样本） */
export const HUMAN_FEATURE_TARGETS = {
    dialogueRatio: [0.25, 0.55] as [number, number],
    dialogueBlocksPerKilo: [12, 45] as [number, number],
    shortNarrationShare: [0.35, 0.85] as [number, number],
    colloquialPerKilo: [0.8, Number.POSITIVE_INFINITY] as [number, number],
    timeAnchors: [2, Number.POSITIVE_INFINITY] as [number, number],
};

const COLLOQUIAL_RE = /(?:好家伙|晓得|啥|咋|呗|嘛|啊|哦|哎|唉|呸|得了吧|行吧|算了|得了|顶不住|扛不住)/g;
const TIME_ANCHOR_RE = /第[一二三四五六七八九十百\d]+(?:波|分钟|秒|局|次|手|轮|天|年)|[一二三四五六七八九十百\d]+(?:比|分钟|秒)(?![0-9])/g;

function splitSentences(text: string): string[] {
    return text.split(/[。！？!?…]+/).map((s) => s.replace(/\s+/g, '')).filter((s) => s.length > 0);
}

export function analyzeHumanFeatures(raw: string): HumanFeatureMetrics {
    const text = String(raw || '').replace(/^---[\s\S]*?---\s*/, '').trim();
    const chars = Math.max(1, text.replace(/\s+/g, '').length);
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const dialogueBlocks = [...text.matchAll(/[“"「]([^”"」]{0,600})[”"」]/g)].map((m) => m[1] || '');
    const dialogueChars = dialogueBlocks.reduce((sum, block) => sum + block.replace(/\s+/g, '').length, 0);
    const narrationText = text.replace(/[“"「][^”"」]{0,600}[”"」]/g, '');
    const narrationSentences = splitSentences(narrationText);
    const dialogueSentences = dialogueBlocks.flatMap((block) => splitSentences(block));

    let alternations = 0;
    for (let i = 1; i < paragraphs.length; i++) {
        const prev = /[“"「]/.test(paragraphs[i - 1]);
        const current = /[“"「]/.test(paragraphs[i]);
        if (prev !== current) alternations++;
    }

    return {
        chars,
        dialogueRatio: dialogueChars / chars,
        dialogueBlocksPerKilo: (dialogueBlocks.length / chars) * 1000,
        shortDialogueShare: dialogueSentences.length === 0
            ? 0
            : dialogueSentences.filter((s) => s.length <= 12).length / dialogueSentences.length,
        shortNarrationShare: narrationSentences.length === 0
            ? 0
            : narrationSentences.filter((s) => s.length <= 25).length / narrationSentences.length,
        alternationRate: paragraphs.length <= 1 ? 0 : alternations / (paragraphs.length - 1),
        colloquialPerKilo: ((text.match(COLLOQUIAL_RE) || []).length / chars) * 1000,
        timeAnchors: (text.match(TIME_ANCHOR_RE) || []).length,
    };
}

function inRange(value: number, [min, max]: [number, number]): boolean {
    return value >= min && value <= max;
}

/**
 * 按人工样本区间打分。
 * 章级文本（≥1200 字）才评；短片段只返回指标不做判定（样本太小。
 * @param raw - 原始
  * @returns RubricResult 实例
 */
export function evaluateHumanFeatures(raw: string): RubricResult {
    const metrics = analyzeHumanFeatures(raw);
    const issues: RubricIssue[] = [];

    if (metrics.chars >= 1200) {
        const checks: Array<{ key: string; label: string; value: number; range: [number, number]; message: string }> = [
            {
                key: 'dialogueRatio', label: '对话占比', value: metrics.dialogueRatio,
                range: HUMAN_FEATURE_TARGETS.dialogueRatio,
                message: `对话占比 ${(metrics.dialogueRatio * 100).toFixed(0)}%（人工样本 38%）：信息要由人物说出来，不要由叙述者转述`,
            },
            {
                key: 'dialogueBlocks', label: '对话块密度', value: metrics.dialogueBlocksPerKilo,
                range: HUMAN_FEATURE_TARGETS.dialogueBlocksPerKilo,
                message: `每千字只有 ${metrics.dialogueBlocksPerKilo.toFixed(1)} 段对话（人工样本 27.7）：用多轮短对话推进，而不是一段长叙述`,
            },
            {
                key: 'shortNarration', label: '叙述碎度', value: metrics.shortNarrationShare,
                range: HUMAN_FEATURE_TARGETS.shortNarrationShare,
                message: metrics.shortNarrationShare > HUMAN_FEATURE_TARGETS.shortNarrationShare[1]
                    ? `短叙述句占 ${(metrics.shortNarrationShare * 100).toFixed(0)}%（人工 63%）：句子碎过头了，该有几句能连着读下去的长句`
                    : `短叙述句占 ${(metrics.shortNarrationShare * 100).toFixed(0)}%（人工 63%）：叙述太整，缺短句的停顿感`,
            },
            {
                key: 'colloquial', label: '口语标记', value: metrics.colloquialPerKilo,
                range: HUMAN_FEATURE_TARGETS.colloquialPerKilo,
                message: `口语标记每千字 ${metrics.colloquialPerKilo.toFixed(1)} 处（人工 2.2）：让人物说人话（好家伙/晓得/啥），不要每句都书面`,
            },
            {
                key: 'timeAnchors', label: '时间锚点', value: metrics.timeAnchors,
                range: HUMAN_FEATURE_TARGETS.timeAnchors,
                message: `时间/序数锚点 ${metrics.timeAnchors} 处（人工样本 12）：用「第一波/第八分钟/第四手」定节拍，读者才跟得上`,
            },
        ];
        for (const check of checks) {
            if (inRange(check.value, check.range)) continue;
            issues.push({ key: check.key, label: check.label, actual: check.value, expected: check.range, message: check.message });
        }
    }

    const total = 5;
    const score = metrics.chars >= 1200 ? Math.max(0, (total - issues.length) / total) : 0;
    return { metrics, score, issues, pass: issues.length === 0 };
}

/**
 * 一行摘要（账本/面板/日志用）
 *
 * @param result - 结果
 * @returns 文本结果
 */
export function formatRubric(result: RubricResult): string {
    const m = result.metrics;
    const head = `人工特征 ${(result.score * 100).toFixed(0)}/100｜对话 ${(m.dialogueRatio * 100).toFixed(0)}%`
        + `（${m.dialogueBlocksPerKilo.toFixed(1)} 段/千字）｜短叙述 ${(m.shortNarrationShare * 100).toFixed(0)}%`
        + `｜口语 ${m.colloquialPerKilo.toFixed(1)}/千字｜锚点 ${m.timeAnchors}`;
    return result.issues.length === 0 ? `${head}｜达标` : `${head}\n- ${result.issues.map((i) => i.message).join('\n- ')}`;
}
