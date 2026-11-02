/**
 * content-classifier.ts - deterministic classification for fingerprints and books.
 *
 * Rule-based, zero-AI: the same input always produces the same tags. Tags are
 * namespaced with `分类:` so they never collide with user tags.
 */
export type ClassificationDimension =
    | '节奏'
    | '语言'
    | '情绪'
    | '对话'
    | '结构'
    | '题材'
    | '技法'
    | '商业'
    | '受众';

/**
 * 指纹统计的最小结构。
 */
export interface FingerprintStatsLike {
    avgSentenceLength?: number;
    avgParagraphLength?: number;
    dialogueRatio?: number;
    descriptionRatio?: number;
    wordCount?: number;
    sentenceLengthStdDev?: number;
    shortSentenceRatio?: number;
    longSentenceRatio?: number;
    dialogueTurnRatio?: number;
    paragraphLengthStdDev?: number;
    lexicalDiversity?: number;
}

/**
 * 可分类指纹。
 */
export interface ClassifiableFingerprint {
    name: string;
    source?: string;
    tags?: string[];
    stats?: FingerprintStatsLike;
    features?: object;
}

/**
 * 分类标签。
 */
export interface ClassificationTag {
    dimension: ClassificationDimension;
    label: string;
    confidence: number;
    reason: string;
}

/**
 * 分类结果。
 */
export interface ClassificationResult {
    primary: string;
    tags: ClassificationTag[];
    summary: string;
}

/**
 * 书籍分类输入。
 */
export interface BookClassificationInput {
    name: string;
    author?: string;
    themeTags?: string[];
    techniqueTags?: string[];
    customTags?: string[];
    primaryGenre?: string;
    genreChannel?: 'male' | 'female' | 'neutral';
    wordCount?: number;
    synopsis?: string;
    qualityScores?: object;
}

const CLASSIFICATION_PREFIX = '分类:';

export function isClassificationTag(tag: string): boolean {
    return String(tag || '').startsWith(CLASSIFICATION_PREFIX);
}

function push(
    list: ClassificationTag[],
    dimension: ClassificationDimension,
    label: string,
    confidence: number,
    reason: string,
): void {
    if (list.some(item => item.dimension === dimension && item.label === label)) return;
    list.push({ dimension, label, confidence: Math.max(0, Math.min(1, confidence)), reason });
}

function featureText(fp: ClassifiableFingerprint): string {
    return Object.values(fp.features || {}).join(' ');
}

function defaultStats(stats?: FingerprintStatsLike): Required<FingerprintStatsLike> {
    return {
        avgSentenceLength: stats?.avgSentenceLength ?? 0,
        avgParagraphLength: stats?.avgParagraphLength ?? 0,
        dialogueRatio: stats?.dialogueRatio ?? 0,
        descriptionRatio: stats?.descriptionRatio ?? 0,
        wordCount: stats?.wordCount ?? 0,
        sentenceLengthStdDev: stats?.sentenceLengthStdDev ?? 0,
        shortSentenceRatio: stats?.shortSentenceRatio ?? 0,
        longSentenceRatio: stats?.longSentenceRatio ?? 0,
        dialogueTurnRatio: stats?.dialogueTurnRatio ?? 0,
        paragraphLengthStdDev: stats?.paragraphLengthStdDev ?? 0,
        lexicalDiversity: stats?.lexicalDiversity ?? 0,
    };
}

export function classifyFingerprint(fp: ClassifiableFingerprint): ClassificationResult {
    const stats = defaultStats(fp.stats);
    const text = `${fp.name} ${fp.source || ''} ${(fp.tags || []).join(' ')} ${featureText(fp)}`;
    const tags: ClassificationTag[] = [];

    if (stats.avgSentenceLength > 0) {
        if (stats.avgSentenceLength <= 12) push(tags, '节奏', '短句快节奏', 0.85, `平均句长 ${stats.avgSentenceLength} 字`);
        else if (stats.avgSentenceLength >= 28) push(tags, '节奏', '长句舒展', 0.8, `平均句长 ${stats.avgSentenceLength} 字`);
        else push(tags, '节奏', '句长均衡', 0.6, `平均句长 ${stats.avgSentenceLength} 字`);
    }
    if (stats.shortSentenceRatio >= 0.4) push(tags, '节奏', '短促推进', 0.8, `短句占比 ${(stats.shortSentenceRatio * 100).toFixed(0)}%`);
    if (stats.longSentenceRatio >= 0.2) push(tags, '节奏', '绵长铺陈', 0.75, `长句占比 ${(stats.longSentenceRatio * 100).toFixed(0)}%`);
    if (stats.sentenceLengthStdDev >= 18) push(tags, '节奏', '句长起伏大', 0.7, `句长标准差 ${stats.sentenceLengthStdDev.toFixed(1)}`);

    if (stats.wordCount > 0) {
        if (stats.dialogueRatio >= 0.35) push(tags, '对话', '对话驱动', 0.85, `对话占比 ${(stats.dialogueRatio * 100).toFixed(0)}%`);
        if (stats.dialogueTurnRatio >= 0.3) push(tags, '对话', '对白密集', 0.8, `对话轮次占比 ${(stats.dialogueTurnRatio * 100).toFixed(0)}%`);
        if (stats.dialogueRatio <= 0.12) push(tags, '对话', '叙述为主', 0.8, `对话占比 ${(stats.dialogueRatio * 100).toFixed(0)}%`);

        if (stats.descriptionRatio >= 0.55) push(tags, '结构', '描写浓厚', 0.8, `描写占比 ${(stats.descriptionRatio * 100).toFixed(0)}%`);
        if (stats.descriptionRatio <= 0.3) push(tags, '结构', '动作/信息推进', 0.75, `描写占比 ${(stats.descriptionRatio * 100).toFixed(0)}%`);
        if (stats.avgParagraphLength >= 180) push(tags, '结构', '长段落叙事', 0.7, `平均段长 ${stats.avgParagraphLength} 字`);
        if (stats.avgParagraphLength > 0 && stats.avgParagraphLength <= 60) push(tags, '结构', '短段落快切', 0.7, `平均段长 ${stats.avgParagraphLength} 字`);
        if (stats.lexicalDiversity >= 0.55) push(tags, '语言', '词汇丰富', 0.7, `词汇多样性 ${(stats.lexicalDiversity * 100).toFixed(0)}%`);
    }

    const rules: Array<{ re: RegExp; dimension: ClassificationDimension; label: string; reason: string }> = [
        { re: /冷峻|克制|硬朗|简练/, dimension: '语言', label: '冷峻克制', reason: '特征描述命中冷峻/克制' },
        { re: /细腻|温柔|抒情|柔美/, dimension: '语言', label: '细腻抒情', reason: '特征描述命中细腻/抒情' },
        { re: /幽默|轻松|诙谐|沙雕/, dimension: '情绪', label: '轻松诙谐', reason: '特征描述命中幽默/轻松' },
        { re: /悬疑|紧张|诡秘|压迫/, dimension: '情绪', label: '悬疑紧张', reason: '特征描述命中悬疑/紧张' },
        { re: /宏大|史诗|苍凉|悲壮/, dimension: '情绪', label: '宏大悲壮', reason: '特征描述命中宏大/悲壮' },
        { re: /古风|文言|古典|雅致/, dimension: '语言', label: '古风雅致', reason: '特征描述命中古风/文言' },
        { re: /快节奏|强冲突|爽点|反转/, dimension: '节奏', label: '强冲突快节奏', reason: '特征描述命中快节奏/反转' },
        { re: /治愈|温暖|日常/, dimension: '情绪', label: '治愈温暖', reason: '特征描述命中治愈/温暖' },
    ];
    for (const rule of rules) {
        if (rule.re.test(text)) push(tags, rule.dimension, rule.label, 0.78, rule.reason);
    }

    const primary = pickPrimary(tags);
    return { primary, tags, summary: tags.slice(0, 4).map(tag => tag.label).join(' · ') || '未识别' };
}

function pickPrimary(tags: ClassificationTag[]): string {
    const order: ClassificationDimension[] = ['节奏', '语言', '情绪', '对话', '结构'];
    for (const dimension of order) {
        const hit = tags
            .filter(tag => tag.dimension === dimension)
            .sort((a, b) => b.confidence - a.confidence)[0];
        if (hit) return hit.label;
    }
    return '未分类';
}

export function classificationTagNames(result: ClassificationResult): string[] {
    return result.tags.map(tag => `${CLASSIFICATION_PREFIX}${tag.label}`);
}

export function mergeClassificationTags(existing: string[], result: ClassificationResult): string[] {
    const generated = classificationTagNames(result);
    const kept = existing.filter(tag => !isClassificationTag(tag));
    return [...new Set([...kept, ...generated])].slice(0, 30);
}

export function classifyBook(input: BookClassificationInput): ClassificationResult {
    const tags: ClassificationTag[] = [];
    const theme = input.themeTags || [];
    const technique = input.techniqueTags || [];
    const custom = (input.customTags || []).filter(tag => !isClassificationTag(tag));
    const text = `${input.name} ${input.synopsis || ''} ${theme.join(' ')} ${technique.join(' ')} ${custom.join(' ')}`;

    if (input.genreChannel === 'male') push(tags, '受众', '男频', 0.9, '频道分类为男频');
    if (input.genreChannel === 'female') push(tags, '受众', '女频', 0.9, '频道分类为女频');
    if (input.genreChannel === 'neutral') push(tags, '受众', '通用', 0.7, '频道分类为通用');
    if (input.primaryGenre) push(tags, '题材', input.primaryGenre, 0.9, '已标注主题材');

    for (const tag of [...theme, ...custom].filter(Boolean).slice(0, 8)) {
        push(tags, '题材', tag, 0.7, '来自题材/自定义标签');
    }
    for (const tag of technique.filter(Boolean).slice(0, 8)) {
        push(tags, '技法', tag, 0.75, '来自技法标签');
    }

    if (/快节奏|爽文|强冲突|反转/.test(text)) push(tags, '节奏', '强冲突快节奏', 0.75, '标签/简介命中快节奏');
    if (/细腻|治愈|温暖|日常/.test(text)) push(tags, '情绪', '细腻治愈', 0.7, '标签/简介命中细腻治愈');
    if (/悬疑|推理|惊悚|诡秘/.test(text)) push(tags, '情绪', '悬疑紧张', 0.78, '标签/简介命中悬疑');
    if (/商业|变现|爆款|付费/.test(text)) push(tags, '商业', '商业向', 0.7, '标签/简介命中商业词');
    if (input.wordCount && input.wordCount >= 500000) push(tags, '商业', '长篇连载', 0.75, `字数 ${input.wordCount}`);
    if (input.wordCount && input.wordCount > 0 && input.wordCount < 100000) push(tags, '商业', '短篇/中短篇', 0.7, `字数 ${input.wordCount}`);

    const scores = input.qualityScores ? Object.values(input.qualityScores) : [];
    const avgScore = scores
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (avgScore.length > 0) {
        const avg = avgScore.reduce((sum, value) => sum + value, 0) / avgScore.length;
        if (avg >= 80) push(tags, '商业', '高质量样本', 0.7, `质量均分 ${avg.toFixed(0)}`);
    }

    const preferred = tags.find(tag => tag.dimension === '题材')?.label
        || tags.find(tag => tag.dimension === '技法')?.label
        || pickPrimary(tags);
    const primary = preferred !== '未分类' ? preferred : (tags[0]?.label || '未分类');
    return { primary, tags, summary: tags.slice(0, 4).map(tag => tag.label).join(' · ') || '未分类' };
}