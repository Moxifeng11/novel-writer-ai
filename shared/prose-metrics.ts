/**
 * prose-metrics.ts — 正文可读性 / 碎片化体检
 *
 * 纯统计，不依赖 Obsidian，也不判断“是不是 AI”。
 * 目标是把“读起来像不像人写的”拆成可解释的指标：
 * 段落是否被切碎、句子是否全是短句、对话是否太少、标点是否单一、开头是否重复。
 *
 * 这些指标与外部检测器的结论不构成一一对应；它们是写作质量的体检项，
 * 不是“过检测”的保证。
 */

export interface ProseMetrics {
    chars: number;
    sentences: number;
    paragraphs: number;
    narrativeParagraphs: number;
    dialogueParagraphs: number;

    avgSentenceLength: number;
    sentenceLengthSd: number;
    shortSentenceRatio: number;
    longSentenceRatio: number;
    sentenceLengthBuckets: Record<'1-5' | '6-10' | '11-20' | '21-35' | '36+', number>;

    avgParagraphLength: number;
    avgNarrativeParagraphLength: number;
    singleSentenceParagraphRatio: number;
    singleSentenceNarrativeParagraphRatio: number;

    dialogueCharsRatio: number;
    dialogueParagraphRatio: number;

    sentenceStartDiversity: number;
    repeatedStarts: Array<{ prefix: string; count: number }>;
    punctuationEntropy: number;
    dashPer1000: number;
    questionPer1000: number;
    exclamationPer1000: number;
    colonPer1000: number;
    semicolonPer1000: number;
    ellipsisPer1000: number;

    /** 硬伤计数（2026-10-30 依据「去AI味」实战规则新增）：分号在中文小说里几乎只出现在 AI 文本 */
    semicolonCount: number;
    /** 省略号（…）总个数 */
    ellipsisCount: number;
    /** 破折号（—）总个数 */
    dashCount: number;
    /** 「不是A，(而)是B」先否定再肯定句式出现次数；真人偶尔用，堆叠即 AI 痕迹 */
    reversalPairCount: number;
    /** 「他不知道……只知道……」排比式感慨出现次数 */
    unknowingPatternCount: number;
    /** 末段是短句升华/总结（如「这是关于……的故事」「有些人注定……」） */
    elevatedEnding: boolean;

    longestSentence: string;
    shortestSentence: string;
}

export type ProseRiskLevel = 'low' | 'medium' | 'high';

export interface ProseIssue {
    id: string;
    severity: ProseRiskLevel;
    title: string;
    detail: string;
    suggestion: string;
    penalty: number;
}

export interface ProseRiskReport {
    score: number;
    level: ProseRiskLevel;
    issues: ProseIssue[];
    metrics: ProseMetrics;
}

const SENTENCE_TERMINATORS = '。！？!?…';
const PUNCTUATION_SET = '，。！？!?…；：、“”‘’"\'—－-（）()《》〈〉【】[]';
const DIALOGUE_RE = /“[^”]*”|『[^』]*』|「[^」]*」|"[^"]*"/g;
const HEADING_RE = /^#{1,6}\s+/;
const CHAPTER_TITLE_RE = /^第[0-9一二三四五六七八九十百千]+章(?:[\s：:].*)?$/;

const SHORT_SENTENCE_LIMIT = 10;
const LONG_SENTENCE_LIMIT = 35;

/** 「不是A，(而)是B」先否定再肯定：逗号或句号分隔都算；真人偶尔用，同一章堆 3 次以上就是典型 AI 痕迹 */
const REVERSAL_PAIR_RE = /不是[^。！？\n]{1,16}[，。,][^。！？\n]{0,10}(而是|是)[^。！？\n]{0,12}/g;
/** 「不知道……只知道……」排比式感慨（意识流腔的标志） */
const UNKNOWING_RE = /不知道[^。！？\n]{0,30}[。！？]{1,2}\s*(她|他|它)?\s*只知道/g;
/** 末段升华词：总结、点题、命运感词汇；只标记窄特征，避免误伤正常的动作收尾 */
const ELEVATED_ENDING_RE = /这(才|就)是|这是关于|而这一切|这一次,?(他|她|他们|她们)?|注定|终将|再无|不复存在|所有的一切|一切都(结束了|不同了)|属于(他|她|他们)的时代/;

function countMatches(text: string, re: RegExp): number {
    return (text.match(re) || []).length;
}

/**
 * 末段是否为「升华/点题」短段。
 * 判据（窄，防误伤）：末段无对话、可读字数 ≤ 42、命中升华词表、
 * 且全文足够长（≥ 150 字）——更短的文本末段本来就允许收束句。
 * @param paragraphs - 段落列表
 * @param text - 文本内容
 * @returns 是否成功
 */
function detectElevatedEnding(paragraphs: string[], text: string): boolean {
    if (countReadableChars(text) < 150) return false;
    const last = [...paragraphs].reverse().find((p) => p.length > 0);
    if (!last) return false;
    if (dialogueChars(last) > 0) return false;
    const chars = countReadableChars(last);
    if (chars === 0 || chars > 42) return false;
    if (!/[。！？]$/.test(last.trim())) return false;
    return ELEVATED_ENDING_RE.test(last);
}

function normalizeText(raw: string): string {
    return (raw || '')
        .replace(/\r\n?/g, '\n')
        .replace(/^---\n[\s\S]*?\n---\s*\n?/, '')
        .trim();
}

function countReadableChars(text: string): number {
    if (!text) return 0;
    let count = 0;
    for (const ch of text) {
        if (/\s/.test(ch)) continue;
        if (PUNCTUATION_SET.includes(ch)) continue;
        count++;
    }
    return count;
}

/**
 * 段落：按行切（项目默认一个自然段一行；空行只是段落分隔符）
 *
 * @param raw - 原始
 * @returns 结果数组
 */
export function splitProseParagraphs(raw: string): string[] {
    const text = normalizeText(raw);
    if (!text) return [];
    return text
        .split('\n')
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .filter((block) => !HEADING_RE.test(block) && !CHAPTER_TITLE_RE.test(block));
}

export function splitProseSentences(raw: string): string[] {
    const text = normalizeText(raw).replace(/\n+/g, ' ');
    if (!text) return [];
    const matches = text.match(new RegExp(`[^${SENTENCE_TERMINATORS}]+[${SENTENCE_TERMINATORS}]*`, 'g')) || [];
    return matches
        .map((sentence) => sentence.trim())
        .filter((sentence) => countReadableChars(sentence) > 0);
}

function countSentences(paragraph: string): number {
    return splitProseSentences(paragraph).length || 1;
}

function dialogueChars(text: string): number {
    let total = 0;
    for (const match of text.match(DIALOGUE_RE) || []) {
        total += countReadableChars(match);
    }
    return total;
}

/**
 * 对话占本段可读字符的比例；≥0.5 视为对话段，否则仍算叙述段
 *
 * @param paragraph - 段落
 * @returns 数值结果
 */
function paragraphDialogueRatio(paragraph: string): number {
    const chars = countReadableChars(paragraph);
    return chars > 0 ? dialogueChars(paragraph) / chars : 0;
}

function punctuationEntropy(text: string): number {
    const counts = new Map<string, number>();
    for (const ch of text) {
        if (!'，。！？；：…—、,.!?;:'.includes(ch)) continue;
        counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (total === 0) return 0;
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / total;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

function sentencePrefix(sentence: string): string {
    const cleaned = sentence.replace(/^[“”‘’"'\s]+/, '');
    let out = '';
    for (const ch of cleaned) {
        if (PUNCTUATION_SET.includes(ch)) continue;
        out += ch;
        if (out.length >= 2) break;
    }
    return out;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function per1000(count: number, chars: number): number {
    return chars > 0 ? round((count / chars) * 1000) : 0;
}

export function analyzeProse(raw: string): ProseMetrics {
    const text = normalizeText(raw);
    const paragraphs = splitProseParagraphs(text);
    const sentences = splitProseSentences(text);
    const readableChars = countReadableChars(text);

    const sentenceLengths = sentences.map((sentence) => countReadableChars(sentence));
    const totalSentenceChars = sentenceLengths.reduce((sum, value) => sum + value, 0);
    const avgSentenceLength = sentenceLengths.length > 0 ? totalSentenceChars / sentenceLengths.length : 0;
    const sentenceLengthSd = sentenceLengths.length > 0
        ? Math.sqrt(sentenceLengths.reduce((sum, value) => sum + (value - avgSentenceLength) ** 2, 0) / sentenceLengths.length)
        : 0;

    const paragraphLengths = paragraphs.map((paragraph) => countReadableChars(paragraph));
    const avgParagraphLength = paragraphLengths.length > 0
        ? paragraphLengths.reduce((sum, value) => sum + value, 0) / paragraphLengths.length
        : 0;

    const narrativeParagraphs = paragraphs.filter((paragraph) => paragraphDialogueRatio(paragraph) < 0.5);
    const dialogueParagraphs = paragraphs.length - narrativeParagraphs.length;
    const narrativeLengths = narrativeParagraphs.map((paragraph) => countReadableChars(paragraph));
    const avgNarrativeParagraphLength = narrativeLengths.length > 0
        ? narrativeLengths.reduce((sum, value) => sum + value, 0) / narrativeLengths.length
        : 0;

    const singleSentenceParagraphs = paragraphs.filter((paragraph) => countSentences(paragraph) <= 1).length;
    const singleSentenceNarrativeParagraphs = narrativeParagraphs.filter((paragraph) => countSentences(paragraph) <= 1).length;

    const buckets: ProseMetrics['sentenceLengthBuckets'] = { '1-5': 0, '6-10': 0, '11-20': 0, '21-35': 0, '36+': 0 };
    for (const length of sentenceLengths) {
        if (length <= 5) buckets['1-5']++;
        else if (length <= 10) buckets['6-10']++;
        else if (length <= 20) buckets['11-20']++;
        else if (length <= 35) buckets['21-35']++;
        else buckets['36+']++;
    }

    const prefixes = new Map<string, number>();
    for (const sentence of sentences) {
        const prefix = sentencePrefix(sentence);
        if (!prefix) continue;
        prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    }
    const repeatedStarts = [...prefixes.entries()]
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([prefix, count]) => ({ prefix, count }));

    const longestSentence = sentences.reduce((longest, sentence) => (
        countReadableChars(sentence) > countReadableChars(longest) ? sentence : longest
    ), '');
    const shortestSentence = sentences.reduce((shortest, sentence) => (
        !shortest || countReadableChars(sentence) < countReadableChars(shortest) ? sentence : shortest
    ), '');

    return {
        chars: readableChars,
        sentences: sentences.length,
        paragraphs: paragraphs.length,
        narrativeParagraphs: narrativeParagraphs.length,
        dialogueParagraphs,

        avgSentenceLength: round(avgSentenceLength),
        sentenceLengthSd: round(sentenceLengthSd),
        shortSentenceRatio: sentences.length > 0
            ? round(sentenceLengths.filter((length) => length <= SHORT_SENTENCE_LIMIT).length / sentences.length)
            : 0,
        longSentenceRatio: sentences.length > 0
            ? round(sentenceLengths.filter((length) => length >= LONG_SENTENCE_LIMIT).length / sentences.length)
            : 0,
        sentenceLengthBuckets: buckets,

        avgParagraphLength: round(avgParagraphLength),
        avgNarrativeParagraphLength: round(avgNarrativeParagraphLength),
        singleSentenceParagraphRatio: paragraphs.length > 0
            ? round(singleSentenceParagraphs / paragraphs.length)
            : 0,
        singleSentenceNarrativeParagraphRatio: narrativeParagraphs.length > 0
            ? round(singleSentenceNarrativeParagraphs / narrativeParagraphs.length)
            : 0,

        dialogueCharsRatio: readableChars > 0 ? round(dialogueChars(text) / readableChars) : 0,
        dialogueParagraphRatio: paragraphs.length > 0
            ? round((paragraphs.length - narrativeParagraphs.length) / paragraphs.length)
            : 0,

        sentenceStartDiversity: sentences.length > 0 ? round(prefixes.size / sentences.length) : 0,
        repeatedStarts,
        punctuationEntropy: round(punctuationEntropy(text)),
        dashPer1000: per1000((text.match(/[—－]/g) || []).length, readableChars),
        questionPer1000: per1000((text.match(/[？?]/g) || []).length, readableChars),
        exclamationPer1000: per1000((text.match(/[！!]/g) || []).length, readableChars),
        colonPer1000: per1000((text.match(/[：:]/g) || []).length, readableChars),
        semicolonPer1000: per1000((text.match(/[；;]/g) || []).length, readableChars),
        ellipsisPer1000: per1000((text.match(/…/g) || []).length, readableChars),

        longestSentence: longestSentence.slice(0, 120),
        shortestSentence: shortestSentence.slice(0, 120),

        semicolonCount: (text.match(/[；;]/g) || []).length,
        ellipsisCount: (text.match(/…/g) || []).length,
        dashCount: (text.match(/[—－]/g) || []).length,
        reversalPairCount: countMatches(text, REVERSAL_PAIR_RE),
        unknowingPatternCount: countMatches(text, UNKNOWING_RE),
        elevatedEnding: detectElevatedEnding(paragraphs, text),
    };
}

function issue(
    id: string,
    severity: ProseRiskLevel,
    title: string,
    detail: string,
    suggestion: string,
    penalty: number,
): ProseIssue {
    return { id, severity, title, detail, suggestion, penalty };
}

/**
 * 把指标折算成 0–100 的“碎片化风险”。
 * 分数只反映可读性风险，不代表任何外部检测器的判定。
 * @param metrics - 指标
  * @returns ProseRiskReport 实例
 */
export function scoreProseRisk(metrics: ProseMetrics): ProseRiskReport {
    if (metrics.chars === 0 || metrics.sentences === 0) {
        return { score: 0, level: 'low', issues: [], metrics };
    }
    const issues: ProseIssue[] = [];

    if (metrics.avgNarrativeParagraphLength > 0 && metrics.avgNarrativeParagraphLength < 80) {
        const severe = metrics.avgNarrativeParagraphLength < 55;
        issues.push(issue(
            'fragmented-paragraphs',
            severe ? 'high' : 'medium',
            '段落被切得太碎',
            `叙述段平均只有 ${metrics.avgNarrativeParagraphLength} 字，${Math.round(metrics.singleSentenceNarrativeParagraphRatio * 100)}% 的叙述段只有一句话。`,
            '把相邻的短段合并成 2–6 句、80–220 字的自然段；对话和说话人的动作、神态放同一段。',
            severe ? 25 : 12,
        ));
    }

    if (metrics.singleSentenceNarrativeParagraphRatio > 0.3) {
        const severe = metrics.singleSentenceNarrativeParagraphRatio > 0.5;
        issues.push(issue(
            'single-sentence-paragraphs',
            severe ? 'high' : 'medium',
            '单句成段过多',
            `${Math.round(metrics.singleSentenceNarrativeParagraphRatio * 100)}% 的叙述段只有一句话。`,
            '单句成段只用于强调、转折或对话交锋；每千字控制在 3 处以内。',
            severe ? 20 : 10,
        ));
    }

    if (metrics.avgSentenceLength > 0 && metrics.avgSentenceLength < 22) {
        const severe = metrics.avgSentenceLength < 18;
        issues.push(issue(
            'short-sentences',
            severe ? 'high' : 'medium',
            '句子整体偏短',
            `平均句长 ${metrics.avgSentenceLength} 字，标准差 ${metrics.sentenceLengthSd}。`,
            '把一部分短句合并成带从句、插入语或补充说明的长句；目标平均 20–30 字。',
            severe ? 15 : 8,
        ));
    }

    if (metrics.shortSentenceRatio > 0.3) {
        const severe = metrics.shortSentenceRatio > 0.4;
        issues.push(issue(
            'short-sentence-ratio',
            severe ? 'high' : 'medium',
            '短句占比过高',
            `10 字以下短句占 ${Math.round(metrics.shortSentenceRatio * 100)}%。`,
            '短句是调味，不是主菜；把不超过 25% 作为目标。',
            severe ? 10 : 5,
        ));
    }

    if (metrics.longSentenceRatio < 0.08) {
        const severe = metrics.longSentenceRatio < 0.04;
        issues.push(issue(
            'long-sentence-deficit',
            severe ? 'high' : 'medium',
            '缺少长句',
            `35 字以上长句只占 ${Math.round(metrics.longSentenceRatio * 100)}%。`,
            '每个场景至少写 2–3 个带从句或并列结构的长句，让句长有真实起伏。',
            severe ? 15 : 10,
        ));
    }

    if (metrics.dialogueCharsRatio < 0.08) {
        const severe = metrics.dialogueCharsRatio < 0.04;
        issues.push(issue(
            'dialogue-dry',
            severe ? 'high' : 'medium',
            '对话太少',
            `对话只占 ${Math.round(metrics.dialogueCharsRatio * 100)}%。`,
            '让人物开口；对话可以有停顿、打断、答非所问和一点废话，目标占 25%–45%。',
            severe ? 15 : 10,
        ));
    }

    if (metrics.punctuationEntropy < 1.2) {
        issues.push(issue(
            'punctuation-monotony',
            metrics.punctuationEntropy < 0.9 ? 'medium' : 'low',
            '标点单一',
            `标点熵 ${metrics.punctuationEntropy}，问号/冒号/感叹号使用偏少。`,
            '该用问号、感叹号、冒号的地方就让人物开口或反问；分号和省略号能不用就不用。',
            metrics.punctuationEntropy < 0.9 ? 10 : 5,
        ));
    }

    const topStart = metrics.repeatedStarts[0];
    if (topStart && metrics.sentences > 0 && topStart.count / metrics.sentences > 0.12) {
        issues.push(issue(
            'repeated-starts',
            topStart.count / metrics.sentences > 0.18 ? 'high' : 'medium',
            '句子开头重复',
            `“${topStart.prefix}”在 ${metrics.sentences} 句里开头出现 ${topStart.count} 次。`,
            '用名字、身份、代词、动作交替开头；连续 3 句不要用同一个主语。',
            topStart.count / metrics.sentences > 0.18 ? 12 : 8,
        ));
    }

    if (metrics.dashPer1000 > 4) {
        issues.push(issue(
            'dash-overuse',
            'medium',
            '破折号过多',
            `每千字 ${metrics.dashPer1000} 处破折号。`,
            '把破折号改成逗号、冒号或直接断句；全章控制在 2 处以内。',
            6,
        ));
    }

    // ── 2026-10-30 新增：来自「去AI味」实战规则的硬伤检测 ──
    // 朱雀类检测器对这几类标点/句式极其敏感；真人网文作者的分布明显更低。

    if (metrics.semicolonCount > 0) {
        issues.push(issue(
            'semicolon-ban',
            metrics.semicolonCount >= 3 ? 'high' : 'medium',
            '分号是 AI 高频标点',
            `全文出现 ${metrics.semicolonCount} 处分号。真人写中文小说几乎不用分号。`,
            '把分号改成句号断句，或用逗号连接；改完全文分号应为 0。',
            metrics.semicolonCount >= 3 ? 12 : 8,
        ));
    }

    if (metrics.ellipsisCount >= 3) {
        issues.push(issue(
            'ellipsis-ban',
            metrics.ellipsisCount >= 6 ? 'high' : 'medium',
            '省略号过多',
            `全文出现 ${metrics.ellipsisCount} 处省略号。`,
            '省略的语气用「话没说完就……的动作」写出来，或直接断句；全章不超过 2 处。',
            metrics.ellipsisCount >= 6 ? 10 : 6,
        ));
    }

    if (metrics.dashCount >= 3) {
        issues.push(issue(
            'dash-cap',
            metrics.dashCount >= 6 ? 'high' : 'medium',
            '破折号超过硬上限',
            `全文出现 ${metrics.dashCount} 处破折号（上限 2 处）。`,
            '解释改用冒号，声音延长改用「话拖长」的描写，插入语改成逗号从句。',
            metrics.dashCount >= 6 ? 10 : 6,
        ));
    }

    // 「不知道…只知道…」排比感慨出现 1 次就报（实战规则：一段都不要有）；
    // 「不是…(而)是…」真人偶尔用，堆叠到 3 次才报。
    const reversalTriggered = metrics.reversalPairCount >= 3 || metrics.unknowingPatternCount >= 1;
    if (reversalTriggered) {
        const severe = metrics.reversalPairCount >= 5 || metrics.unknowingPatternCount >= 2;
        issues.push(issue(
            'reversal-stacking',
            severe ? 'high' : 'medium',
            '「不是A而是B」堆叠',
            `先否定再肯定句式出现 ${metrics.reversalPairCount} 次，排比式感慨（不知道…只知道…）${metrics.unknowingPatternCount} 次。`,
            '每章这类句式最多留 1 处；其余改成直接陈述事实，或让人物用对话说出来。',
            severe ? 15 : 10,
        ));
    }

    if (metrics.elevatedEnding) {
        issues.push(issue(
            'elevated-ending',
            'medium',
            '末段升华/点题',
            '最后一段是独立的短句总结或命运感慨（如「这是关于……的故事」）。',
            '章节结尾落在动作、对话或悬念上；感想让读者自己得出，不要替读者总结。',
            8,
        ));
    }

    const score = Math.min(100, issues.reduce((sum, item) => sum + item.penalty, 0));
    const level: ProseRiskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    return { score, level, issues, metrics };
}

export function formatProseMetrics(metrics: ProseMetrics): string {
    const lines = [
        `字数 ${metrics.chars}｜句 ${metrics.sentences}｜段 ${metrics.paragraphs}`,
        `平均句长 ${metrics.avgSentenceLength} 字（标准差 ${metrics.sentenceLengthSd}）`,
        `平均叙述段长 ${metrics.avgNarrativeParagraphLength} 字｜单句叙述段 ${Math.round(metrics.singleSentenceNarrativeParagraphRatio * 100)}%`,
        `短句 ${Math.round(metrics.shortSentenceRatio * 100)}%｜长句 ${Math.round(metrics.longSentenceRatio * 100)}%`,
        `对话 ${Math.round(metrics.dialogueCharsRatio * 100)}%｜对话段 ${Math.round(metrics.dialogueParagraphRatio * 100)}%`,
        `标点熵 ${metrics.punctuationEntropy}｜破折号 ${metrics.dashCount}｜分号 ${metrics.semicolonCount}｜省略号 ${metrics.ellipsisCount}`,
        `「不是…是…」${metrics.reversalPairCount} 次｜末段升华 ${metrics.elevatedEnding ? '有' : '无'}`,
        `句首多样性 ${Math.round(metrics.sentenceStartDiversity * 100)}%`,
    ];
    return lines.join('\n');
}

export const PROSE_METRIC_LABELS = {
    avgSentenceLength: '平均句长',
    avgNarrativeParagraphLength: '平均叙述段长',
    singleSentenceNarrativeParagraphRatio: '单句叙述段占比',
    shortSentenceRatio: '短句占比',
    longSentenceRatio: '长句占比',
    dialogueCharsRatio: '对话占比',
    punctuationEntropy: '标点熵',
    sentenceStartDiversity: '句首多样性',
} as const;
