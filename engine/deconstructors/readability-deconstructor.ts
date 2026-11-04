import { kbBookReadabilityAnalysisFile } from '@/shared/paths';
import { isChineseChar, splitParagraphs, splitSentences } from '@/shared/text-utils';
import { VectorEnhancer } from '@/engine/vector-enhancer';
import { yieldToUI } from '@/shared/yield';
import { SHOW_TELL_WORDS, EMOTION_WORDS } from '@/engine/dimension-keywords';
import { AntiAIDetector } from '@/engine/anti-ai-detector';
import { GenreDetector, GenreConfigRegistry } from '@/engine/genre';
import { createLogger } from '@/shared/logger';
import { writeVaultText } from '@/shared/file-system-port';


const log = createLogger('ReadabilityDeconstructor');
/**
 * 展示/讲述类型。
 */
export type ShowTellType = 'show' | 'tell' | 'mixed';

/**
 * 展示/讲述分段。
 */
export interface ShowTellSegment {
    startIndex: number;
    endIndex: number;
    type: ShowTellType;
    confidence: number;
    showScore: number;
    tellScore: number;
    excerpt: string;
}

/**
 * 展示/讲述分析结果。
 */
export interface ShowTellResult {
    overallRatio: number;
    showPercentage: number;
    tellPercentage: number;
    segments: ShowTellSegment[];
    highRiskTellSegments: ShowTellSegment[];
    stats: {
        totalSegments: number;
        showCount: number;
        tellCount: number;
        mixedCount: number;
        avgShowScore: number;
    };
    suggestions: {
        type: string;
        severity: 'high' | 'medium' | 'low';
        message: string;
    }[];
}

/**
 * AI 痕迹维度。
 */
export interface AITraceDimension {
    score: number;
    description: string;
    details: Record<string, number>;
  dataStatus?: 'complete' | 'insufficient' | 'estimated';
}

/**
 * AI 痕迹分析结果。
 */
export interface AITraceResult {
    overallScore: number;
    level: 'low' | 'medium' | 'high';
    dimensions: {
        sentenceSimilarity: AITraceDimension;
        connectorDensity: AITraceDimension;
        explanatoryEnding: AITraceDimension;
        parallelismAbuse: AITraceDimension;
        wordRepetition: AITraceDimension;
        emotionUniformity: AITraceDimension;
    };
    highRiskParagraphs: Array<{
        startIndex: number;
        endIndex: number;
        score: number;
        excerpt: string;
        reasons: string[];
    }>;
}

/**
 * 可读性分析结果。
 */
export interface ReadabilityAnalysisResult {
    showTell: ShowTellResult;
    aiTrace: AITraceResult;
    overallScore: number;
  aggregation?: {
    segmentCount: number;
    dataStatus: 'complete' | 'partial';
  };
}

/**
 * 可读性拆解器：展示讲述与 AI 痕迹。
 */
export class ReadabilityDeconstructor {
    private sensorySet: Set<string>;
    private actionSet: Set<string>;
    private dialogueSet: Set<string>;
    private abstractSet: Set<string>;
    private judgmentSet: Set<string>;
    private explanationSet: Set<string>;
    private timeJumpSet: Set<string>;
    private vectorEnhancer?: VectorEnhancer;
    /** 连接词密度检测的补充连接词（与 AntiAIDetector 高频词表合并，每次检测实时合成） */
    private readonly extraAiConnectors: string[] =
        ['因此', '所以', '但是', '不过', '其实', '总之', '总而言之', '综上所述'];
    private explanatoryPatterns: string[];
    private parallelismPatterns: string[];
    private positiveEmotionSet: Set<string>;
    private negativeEmotionSet: Set<string>;
    private showSignalSet: Set<string>;
    private currentGenreId: string;
    private genreDetector: GenreDetector;

    constructor(vectorEnhancer?: VectorEnhancer) {
        this.sensorySet = new Set(SHOW_TELL_WORDS.show.sensory);
        this.actionSet = new Set(SHOW_TELL_WORDS.show.action);
        this.dialogueSet = new Set(SHOW_TELL_WORDS.show.dialogue);
        this.abstractSet = new Set(SHOW_TELL_WORDS.tell.abstract);
        this.judgmentSet = new Set(SHOW_TELL_WORDS.tell.judgment);
        this.explanationSet = new Set(SHOW_TELL_WORDS.tell.explanation);
        this.timeJumpSet = new Set(SHOW_TELL_WORDS.tell.timeJump);
        this.vectorEnhancer = vectorEnhancer;

        this.explanatoryPatterns = [
            '这不仅仅是', '更是', '不仅如此', '更重要的是',
            '换句话说', '也就是说', '简而言之'
        ];

        this.parallelismPatterns = [
            '有的', '还有的', '一方面', '另一方面'
        ];

        const positiveEmotions = [...EMOTION_WORDS.joy, ...EMOTION_WORDS.trust, ...EMOTION_WORDS.anticipation, ...EMOTION_WORDS.surprise];
        const negativeEmotions = [...EMOTION_WORDS.anger, ...EMOTION_WORDS.sadness, ...EMOTION_WORDS.fear, ...EMOTION_WORDS.disgust];
        this.positiveEmotionSet = new Set(positiveEmotions);
        this.negativeEmotionSet = new Set(negativeEmotions);

        this.genreDetector = new GenreDetector();
        this.currentGenreId = 'generic';
        this.showSignalSet = new Set(
            GenreConfigRegistry.getInstance().getGenreConfig('generic').showSignalWords
        );
    }

    /**
     * 分析。
     * @param text - 文本内容
      * @returns ReadabilityAnalysisResult 实例
     */
    async analyze(text: string): Promise<ReadabilityAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        this.updateGenreSignals(text);

        const showTell = this.calculateShowTellRatio(text);
        await yieldToUI();

        const aiTrace = this.calculateAITrace(text);
        await yieldToUI();

        const overallScore = this.calculateOverallScore(showTell);

        return {
            showTell,
            aiTrace,
            overallScore
        };
    }

    /**
     * 根据文本识别题材，刷新 showSignalSet。
     * - 题材变化时重新加载对应 genreConfig.showSignalWords
     * - 识别失败（generic）时保留默认 generic 配置
     */
    private updateGenreSignals(text: string): void {
        const detection = this.genreDetector.detect(text);
        const genreId = detection.genreId || 'generic';
        if (genreId === this.currentGenreId) {
            return;
        }
        this.currentGenreId = genreId;
        const config = GenreConfigRegistry.getInstance().getGenreConfig(genreId);
        this.showSignalSet = new Set(config.showSignalWords);
    }

    /**
     * analyzeWithVector 方法。
     * @param text - 文本内容
      * @returns ReadabilityAnalysisResult 实例
     */
    async analyzeWithVector(text: string): Promise<ReadabilityAnalysisResult> {
        const baseResult = await this.analyze(text);
        await yieldToUI();

        if (!this.vectorEnhancer || !text || text.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.warn('[ReadabilityDeconstructor] 向量模型不可用，返回纯统计结果');
                return baseResult;
            }
        } catch (e) {
            log.warn('[ReadabilityDeconstructor] 向量增强不可用，降级为纯统计', e);
            return baseResult;
        }

        return baseResult;
    }

    /**
     * saveAnalysisToMarkdown 方法。
     * @param app - Obsidian 应用实例
     * @param bookName - 书名
     * @param result - 结果
     * @param baseDir - 参数值
     */
    async saveAnalysisToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        result: ReadabilityAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookReadabilityAnalysisFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        // 用户可见分析报告：必须走 vault 索引写入，adapter.write 不触发 metadataCache。
        await writeVaultText(app as unknown as import('obsidian').App, filePath, content);
    }

    /**
     * calculateShowTellRatio 方法。
     * @param text - 文本内容
      * @returns ShowTellResult 实例
     */
    calculateShowTellRatio(text: string): ShowTellResult {
        const paragraphs = splitParagraphs(text);
        const segments: ShowTellSegment[] = [];
        let currentIndex = 0;

        for (const para of paragraphs) {
            const startIndex = text.indexOf(para, currentIndex);
            const endIndex = startIndex + para.length;
            currentIndex = endIndex;

            const { showScore, tellScore } = this.calculateSegmentScores(para);
            const { type, confidence } = this.classifySegment(showScore, tellScore);

            segments.push({
                startIndex,
                endIndex,
                type,
                confidence,
                showScore,
                tellScore,
                excerpt: para.length > 100 ? para.slice(0, 100) + '...' : para
            });
        }

        const stats = this.calculateStats(segments);
        const highRiskTellSegments = segments.filter(
            s => s.type === 'tell' && s.confidence > 0.7 && (s.endIndex - s.startIndex) > 200
        );
        const suggestions = this.generateSuggestions(stats, highRiskTellSegments.length);

        const showPercentage = this.round2((stats.showCount / Math.max(stats.totalSegments, 1)) * 100);
        const tellPercentage = this.round2((stats.tellCount / Math.max(stats.totalSegments, 1)) * 100);
        const overallRatio = this.round2(stats.showCount / Math.max(stats.totalSegments, 1));

        return {
            overallRatio,
            showPercentage,
            tellPercentage,
            segments,
            highRiskTellSegments,
            stats,
            suggestions
        };
    }

    /**
     * calculateAITrace 方法。
     * @param text - 文本内容
      * @returns AITraceResult 实例
     */
    calculateAITrace(text: string): AITraceResult {
        const sentenceSimilarity = this.calculateSentenceSimilarity(text);
        const connectorDensity = this.calculateConnectorDensity(text);
        const explanatoryEnding = this.calculateExplanatoryEnding(text);
        const parallelismAbuse = this.calculateParallelismAbuse(text);
        const wordRepetition = this.calculateWordRepetition(text);
        const emotionUniformity = this.calculateEmotionUniformity(text);

        const overallScore = this.round2(
            0.2 * sentenceSimilarity.score +
            0.2 * connectorDensity.score +
            0.15 * explanatoryEnding.score +
            0.15 * parallelismAbuse.score +
            0.15 * wordRepetition.score +
            0.15 * emotionUniformity.score
        );

        let level: 'low' | 'medium' | 'high' = 'low';
        if (overallScore >= 60) level = 'high';
        else if (overallScore >= 30) level = 'medium';

        const highRiskParagraphs = this.detectHighRiskParagraphs(text, {
            sentenceSimilarity,
            connectorDensity,
            explanatoryEnding,
            parallelismAbuse,
            wordRepetition,
            emotionUniformity
        });

        return {
            overallScore,
            level,
            dimensions: {
                sentenceSimilarity,
                connectorDensity,
                explanatoryEnding,
                parallelismAbuse,
                wordRepetition,
                emotionUniformity
            },
            highRiskParagraphs
        };
    }

    private calculateSentenceSimilarity(text: string): AITraceDimension {
        const sentences = this.splitSentences(text).filter(s => s.trim().length > 0);
        if (sentences.length < 2) {
            return { score: 0, description: '句子数量不足，无法评估', details: {} };
        }

        const lengths = sentences.map(s => this.countChineseChars(s.trim()));
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
        const std = Math.sqrt(variance);
        const cv = mean > 0 ? std / mean : 0;

        const score = this.clamp0_100(100 - cv * 200);
        let description = '句式变化丰富';
        if (cv < 0.2) description = '句式高度雷同，AI 特征明显';
        else if (cv < 0.4) description = '句式变化一般';

        return {
            score,
            description,
            details: { cv: this.round2(cv), meanLength: this.round2(mean), stdLength: this.round2(std), sentenceCount: sentences.length }
        };
    }

    private calculateConnectorDensity(text: string): AITraceDimension {
        const charCount = Math.max(this.countChineseChars(text), 1);
        let totalCount = 0;
        const wordCounts: Record<string, number> = {};

        // R2: 每次检测实时合成词表（内置高频词 + 补充连接词），用户扩充词即时生效
        const connectorWords = new Set([...AntiAIDetector.AI_HIGH_FREQ_WORDS, ...this.extraAiConnectors]);
        for (const word of connectorWords) {
            const count = (text.match(new RegExp(word, 'g')) || []).length;
            if (count > 0) {
                wordCounts[word] = count;
                totalCount += count;
            }
        }

        const densityPerK = (totalCount / charCount) * 1000;
        const score = this.clamp0_100(densityPerK * 20);

        let description = '连接词使用合理';
        if (densityPerK > 5) description = '连接词密度过高，AI 特征明显';
        else if (densityPerK > 3) description = '连接词使用偏多';

        return {
            score,
            description,
            details: { totalCount, densityPerK: this.round2(densityPerK), ...wordCounts }
        };
    }

    private calculateExplanatoryEnding(text: string): AITraceDimension {
        const charCount = Math.max(this.countChineseChars(text), 1);
        let totalCount = 0;
        const patternCounts: Record<string, number> = {};

        for (const pattern of this.explanatoryPatterns) {
            const count = (text.match(new RegExp(pattern, 'g')) || []).length;
            if (count > 0) {
                patternCounts[pattern] = count;
                totalCount += count;
            }
        }

        const frequency = (totalCount / charCount) * 1000;
        const score = this.clamp0_100(frequency * 50);

        let description = '解释性收束句使用正常';
        if (frequency > 2) description = '解释性收束句过多，AI 特征明显';
        else if (frequency > 1) description = '解释性收束句偏多';

        return {
            score,
            description,
            details: { totalCount, frequencyPerK: this.round2(frequency), ...patternCounts }
        };
    }

    private calculateParallelismAbuse(text: string): AITraceDimension {
        const paragraphs = splitParagraphs(text);
        if (paragraphs.length < 3) {
            return { score: 0, description: '段落数量不足，无法评估', details: {} };
        }

        let parallelismCount = 0;
        const details: Record<string, number> = {};

        for (let i = 0; i < paragraphs.length - 2; i++) {
            const p1 = paragraphs[i].trim();
            const p2 = paragraphs[i + 1].trim();
            const p3 = paragraphs[i + 2].trim();

            if (p1.length === 0 || p2.length === 0 || p3.length === 0) continue;

            const start1 = p1.slice(0, 3);
            const start2 = p2.slice(0, 3);
            const start3 = p3.slice(0, 3);

            if (start1 === start2 && start2 === start3 && start1.length > 0) {
                parallelismCount++;
                details[`paragraph_${i}`] = i;
            }
        }

        let patternMatchCount = 0;
        for (const pattern of this.parallelismPatterns) {
            const count = (text.match(new RegExp(pattern, 'g')) || []).length;
            if (count > 0) {
                details[pattern] = count;
                patternMatchCount += count;
            }
        }

        const ratio = (parallelismCount + patternMatchCount * 0.5) / Math.max(paragraphs.length, 1);
        const score = this.clamp0_100(ratio * 200);

        let description = '排比使用正常';
        if (ratio > 0.3) description = '排比滥用，AI 特征明显';
        else if (ratio > 0.15) description = '排比使用偏多';

        details.paragraphCount = paragraphs.length;
        details.structureParallelism = parallelismCount;
        details.patternMatchCount = patternMatchCount;
        details.ratio = this.round2(ratio);

        return { score, description, details };
    }

    private calculateWordRepetition(text: string): AITraceDimension {
        const charCount = text.length;
        if (charCount < 100) {
            return { score: 0, description: '文本长度不足，无法评估', details: {} };
        }

        const windowSize = 500;
        let repeatedWordsCount = 0;
        const repeatDetails: Record<string, number> = {};

        for (let start = 0; start < charCount; start += windowSize) {
            const window = text.slice(start, Math.min(start + windowSize, charCount));
            const charFrequency: Record<string, number> = {};

            for (let i = 0; i < window.length - 2; i++) {
                const trigram = window.slice(i, i + 3);
                if (/[\u4e00-\u9fa5]/.test(trigram[0]) && /[\u4e00-\u9fa5]/.test(trigram[1]) && /[\u4e00-\u9fa5]/.test(trigram[2])) {
                    charFrequency[trigram] = (charFrequency[trigram] || 0) + 1;
                }
            }

            for (const [word, count] of Object.entries(charFrequency)) {
                if (count > 3) {
                    repeatedWordsCount++;
                    repeatDetails[word] = Math.max(repeatDetails[word] || 0, count);
                }
            }
        }

        const density = repeatedWordsCount / Math.max(charCount / 1000, 1);
        const score = this.clamp0_100(density * 30);

        let description = '词汇重复率正常';
        if (density > 3) description = '词汇重复率过高，AI 特征明显';
        else if (density > 1.5) description = '词汇重复率偏高';

        return {
            score,
            description,
            details: { repeatedTrigrams: repeatedWordsCount, densityPerK: this.round2(density), ...repeatDetails }
        };
    }

    private calculateEmotionUniformity(text: string): AITraceDimension {
        const segments = this.splitIntoSegments(text, 10);
        if (segments.length < 2) {
            return { score: 0, description: '文本长度不足，无法评估', details: {} };
        }

        const emotionCounts: number[] = [];
        const details: Record<string, number> = {};

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            let posCount = 0;
            let negCount = 0;

            for (const word of this.positiveEmotionSet) {
                posCount += (seg.match(new RegExp(word, 'g')) || []).length;
            }
            for (const word of this.negativeEmotionSet) {
                negCount += (seg.match(new RegExp(word, 'g')) || []).length;
            }

            const total = posCount + negCount;
            emotionCounts.push(total);
            details[`seg_${i}_pos`] = posCount;
            details[`seg_${i}_neg`] = negCount;
        }

        const mean = emotionCounts.reduce((a, b) => a + b, 0) / emotionCounts.length;
        const variance = emotionCounts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / emotionCounts.length;

        const score = this.clamp0_100(100 - variance * 10);

        let description = '情感分布自然';
        if (variance < 1) description = '情感分布过于均匀，AI 特征明显';
        else if (variance < 3) description = '情感分布偏均匀';

        details.meanEmotionCount = this.round2(mean);
        details.variance = this.round2(variance);
        details.segmentCount = segments.length;

        return { score, description, details };
    }

    private detectHighRiskParagraphs(
        text: string,
        dimensions: {
            sentenceSimilarity: AITraceDimension;
            connectorDensity: AITraceDimension;
            explanatoryEnding: AITraceDimension;
            parallelismAbuse: AITraceDimension;
            wordRepetition: AITraceDimension;
            emotionUniformity: AITraceDimension;
        }
    ): AITraceResult['highRiskParagraphs'] {
        const paragraphs = splitParagraphs(text);
        const highRisk: AITraceResult['highRiskParagraphs'] = [];
        let currentIndex = 0;

        for (const para of paragraphs) {
            const startIndex = text.indexOf(para, currentIndex);
            const endIndex = startIndex + para.length;
            currentIndex = endIndex;

            if (para.length < 50) continue;

            const reasons: string[] = [];
            let paraScore = 0;

            const sentSim = this.calculateSentenceSimilarity(para);
            if (sentSim.score > 70) {
                reasons.push('句式雷同');
                paraScore += sentSim.score * 0.2;
            }

            const connDen = this.calculateConnectorDensity(para);
            if (connDen.score > 70) {
                reasons.push('连接词密度高');
                paraScore += connDen.score * 0.2;
            }

            const expEnd = this.calculateExplanatoryEnding(para);
            if (expEnd.score > 70) {
                reasons.push('解释性收束句多');
                paraScore += expEnd.score * 0.15;
            }

            const paraAb = this.calculateParallelismAbuse(para + '\n\n' + para + '\n\n' + para);
            if (paraAb.score > 70) {
                reasons.push('排比滥用');
                paraScore += paraAb.score * 0.15;
            }

            const wordRep = this.calculateWordRepetition(para);
            if (wordRep.score > 70) {
                reasons.push('词汇重复率高');
                paraScore += wordRep.score * 0.15;
            }

            const emoUni = this.calculateEmotionUniformity(para);
            if (emoUni.score > 70) {
                reasons.push('情感分布均匀');
                paraScore += emoUni.score * 0.15;
            }

            if (paraScore > 70) {
                highRisk.push({
                    startIndex,
                    endIndex,
                    score: this.round2(paraScore),
                    excerpt: para.length > 100 ? para.slice(0, 100) + '...' : para,
                    reasons
                });
            }
        }

        return highRisk.sort((a, b) => b.score - a.score).slice(0, 10);
    }

    private splitSentences(text: string): string[] {
        return text.split(/[。？！；!?.;]+/).filter(s => s.trim().length > 0);
    }

    private splitIntoSegments(text: string, n: number): string[] {
        const segments: string[] = [];
        const segLen = Math.max(Math.floor(text.length / n), 1);
        for (let i = 0; i < n; i++) {
            const start = i * segLen;
            const end = i === n - 1 ? text.length : (i + 1) * segLen;
            segments.push(text.slice(start, end));
        }
        return segments;
    }

    private clamp0_100(v: number): number {
        return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
    }

    private calculateSegmentScores(paragraph: string): { showScore: number; tellScore: number } {
        const charCount = Math.max(this.countChineseChars(paragraph), 1);

        const sensoryCount = this.countKeywords(paragraph, this.sensorySet);
        const actionCount = this.countKeywords(paragraph, this.actionSet);
        const dialogueCount = this.countKeywords(paragraph, this.dialogueSet);
        const signalCount = this.countKeywords(paragraph, this.showSignalSet);
        const quoteCount = this.countQuotes(paragraph);

        const abstractCount = this.countKeywords(paragraph, this.abstractSet);
        const judgmentCount = this.countKeywords(paragraph, this.judgmentSet);
        const explanationCount = this.countKeywords(paragraph, this.explanationSet);
        const timeJumpCount = this.countKeywords(paragraph, this.timeJumpSet);

        const showBase = (sensoryCount + actionCount + dialogueCount + signalCount) / charCount * 100;
        const showBonus = quoteCount > 0 ? 0.2 : 0;
        const showScore = this.clamp01(showBase * 0.8 + showBonus);

        const tellBase = (abstractCount + judgmentCount + explanationCount + timeJumpCount) / charCount * 100;
        const tellScore = this.clamp01(tellBase * 0.8);

        return { showScore, tellScore };
    }

    private classifySegment(showScore: number, tellScore: number): { type: ShowTellType; confidence: number } {
        if (showScore > 0.6 && tellScore < 0.4) {
            return { type: 'show', confidence: this.clamp01(showScore - tellScore) };
        }
        if (tellScore > 0.6 && showScore < 0.4) {
            return { type: 'tell', confidence: this.clamp01(tellScore - showScore) };
        }
        return { type: 'mixed', confidence: this.clamp01(1 - Math.abs(showScore - tellScore)) };
    }

    private calculateStats(segments: ShowTellSegment[]): ShowTellResult['stats'] {
        const totalSegments = segments.length;
        let showCount = 0;
        let tellCount = 0;
        let mixedCount = 0;
        let totalShowScore = 0;

        for (const seg of segments) {
            if (seg.type === 'show') showCount++;
            else if (seg.type === 'tell') tellCount++;
            else mixedCount++;
            totalShowScore += seg.showScore;
        }

        return {
            totalSegments,
            showCount,
            tellCount,
            mixedCount,
            avgShowScore: this.round2(totalShowScore / Math.max(totalSegments, 1))
        };
    }

    private generateSuggestions(
        stats: ShowTellResult['stats'],
        highRiskCount: number
    ): ShowTellResult['suggestions'] {
        const suggestions: ShowTellResult['suggestions'] = [];
        const showRatio = stats.showCount / Math.max(stats.totalSegments, 1);

        if (showRatio < 0.3) {
            suggestions.push({
                type: 'showTellRatio',
                severity: 'high',
                message: `Show 占比仅 ${(showRatio * 100).toFixed(0)}%，远低于推荐水平。建议增加更多感官描写、动作细节和对话，让读者身临其境。`
            });
        } else if (showRatio < 0.5) {
            suggestions.push({
                type: 'showTellRatio',
                severity: 'medium',
                message: `Show 占比为 ${(showRatio * 100).toFixed(0)}%，仍有提升空间。可适当将抽象叙述转化为具体场景描写。`
            });
        } else if (showRatio > 0.7) {
            suggestions.push({
                type: 'showTellRatio',
                severity: 'low',
                message: `Show 占比达 ${(showRatio * 100).toFixed(0)}%，描写生动，读者代入感强。`
            });
        }

        if (highRiskCount > 5) {
            suggestions.push({
                type: 'highRiskTell',
                severity: 'high',
                message: `发现 ${highRiskCount} 个高风险 Tell 段落（长度>200字且置信度>70%），建议优先改写这些段落。`
            });
        } else if (highRiskCount > 0) {
            suggestions.push({
                type: 'highRiskTell',
                severity: 'medium',
                message: `发现 ${highRiskCount} 个高风险 Tell 段落，建议检查并考虑改写为 Show 写法。`
            });
        }

        return suggestions;
    }

    private calculateOverallScore(showTell: ShowTellResult): number {
        const ratioScore = showTell.overallRatio * 0.6;
        const riskPenalty = Math.min(showTell.highRiskTellSegments.length * 0.05, 0.2);
        const rawScore = this.clamp01(ratioScore + 0.4 - riskPenalty);
        return Math.round(rawScore * 100);
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private countKeywords(text: string, keywordSet: Set<string>): number {
        let count = 0;
        for (const word of keywordSet) {
            count += (text.match(new RegExp(word, 'g')) || []).length;
        }
        return count;
    }

    private countQuotes(text: string): number {
        const quotePairs = [
            { start: '「', end: '」' },
            { start: '『', end: '』' },
            { start: '"', end: '"' },
            { start: "'", end: "'" },
            { start: '“', end: '”' },
            { start: '‘', end: '’' }
        ];
        let count = 0;
        for (const pair of quotePairs) {
            const regex = new RegExp(`${pair.start}[^${pair.end}]*${pair.end}`, 'g');
            count += (text.match(regex) || []).length;
        }
        return count;
    }

    private countChineseChars(text: string): number {
        let count = 0;
        for (let i = 0; i < text.length; i++) {
            if (isChineseChar(text[i])) {
                count++;
            }
        }
        return count;
    }


    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    private getEmptyResult(): ReadabilityAnalysisResult {
        const emptyDimension: AITraceDimension = { score: 0, description: '', details: {} };
        return {
            showTell: {
                overallRatio: 0,
                showPercentage: 0,
                tellPercentage: 0,
                segments: [],
                highRiskTellSegments: [],
                stats: {
                    totalSegments: 0,
                    showCount: 0,
                    tellCount: 0,
                    mixedCount: 0,
                    avgShowScore: 0
                },
                suggestions: []
            },
            aiTrace: {
                overallScore: 0,
                level: 'low',
                dimensions: {
                    sentenceSimilarity: emptyDimension,
                    connectorDensity: emptyDimension,
                    explanatoryEnding: emptyDimension,
                    parallelismAbuse: emptyDimension,
                    wordRepetition: emptyDimension,
                    emotionUniformity: emptyDimension
                },
                highRiskParagraphs: []
            },
            overallScore: 0
        };
    }

    private buildFrontmatter(result: ReadabilityAnalysisResult): string {
        const data = {
            overallScore: result.overallScore,
            showTell: {
                overallRatio: result.showTell.overallRatio,
                showPercentage: result.showTell.showPercentage,
                tellPercentage: result.showTell.tellPercentage,
                stats: result.showTell.stats,
                highRiskCount: result.showTell.highRiskTellSegments.length
            },
            aiTrace: {
                overallScore: result.aiTrace.overallScore,
                level: result.aiTrace.level,
                dimensions: {
                    sentenceSimilarity: result.aiTrace.dimensions.sentenceSimilarity.score,
                    connectorDensity: result.aiTrace.dimensions.connectorDensity.score,
                    explanatoryEnding: result.aiTrace.dimensions.explanatoryEnding.score,
                    parallelismAbuse: result.aiTrace.dimensions.parallelismAbuse.score,
                    wordRepetition: result.aiTrace.dimensions.wordRepetition.score,
                    emotionUniformity: result.aiTrace.dimensions.emotionUniformity.score
                },
                highRiskParagraphCount: result.aiTrace.highRiskParagraphs.length
            }
        };
        return JSON.stringify(data, null, 2);
    }

    private buildMarkdownBody(result: ReadabilityAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 可读性分析报告`);
        lines.push('');
        lines.push(`- 综合得分：**${result.overallScore} 分**`);
        lines.push('');

        lines.push('## AI 痕迹检测');
        lines.push('');
        lines.push('### 综合评估');
        lines.push('');

        const levelLabels: Record<string, string> = {
            low: '🟢 低风险',
            medium: '🟡 中等风险',
            high: '🔴 高风险'
        };
        lines.push(`- AI 痕迹率：**${result.aiTrace.overallScore} 分**`);
        lines.push(`- 风险等级：**${levelLabels[result.aiTrace.level]}**`);
        lines.push('');

        lines.push('### 六维检测');
        lines.push('');

        const dimLabels: Record<string, string> = {
            sentenceSimilarity: '句式雷同度',
            connectorDensity: '连接词密度',
            explanatoryEnding: '解释性收束句',
            parallelismAbuse: '排比滥用',
            wordRepetition: '词汇重复率',
            emotionUniformity: '情感词均匀度'
        };
        const dims = result.aiTrace.dimensions;
        const dimEntries: [string, AITraceDimension][] = [
            ['sentenceSimilarity', dims.sentenceSimilarity],
            ['connectorDensity', dims.connectorDensity],
            ['explanatoryEnding', dims.explanatoryEnding],
            ['parallelismAbuse', dims.parallelismAbuse],
            ['wordRepetition', dims.wordRepetition],
            ['emotionUniformity', dims.emotionUniformity]
        ];
        dimEntries.forEach(([key, dim]) => {
            lines.push(`- **${dimLabels[key]}**：${dim.score} 分 - ${dim.description}`);
        });
        lines.push('');

        if (result.aiTrace.highRiskParagraphs.length > 0) {
            lines.push('### 高风险段落（前 10 个）');
            lines.push('');
            const topRisk = result.aiTrace.highRiskParagraphs.slice(0, 10);
            topRisk.forEach((para, idx) => {
                lines.push(`#### 第 ${idx + 1} 个`);
                lines.push('');
                lines.push(`- 风险得分：**${para.score} 分**`);
                lines.push(`- 长度：${para.endIndex - para.startIndex} 字`);
                lines.push(`- 风险原因：${para.reasons.join('、')}`);
                lines.push('');
                lines.push(`> ${para.excerpt}`);
                lines.push('');
            });
        }

        lines.push('### 分析说明');
        lines.push('');
        lines.push('AI 痕迹检测基于六大维度综合评估，分数越高表示 AI 写作特征越明显。');
        lines.push('建议针对高风险段落进行人工改写，增加句式变化和情感波动，减少模板化表达。');
        lines.push('');

        lines.push('## Show vs Tell 分析');
        lines.push('');
        lines.push('### 总体比例');
        lines.push('');
        lines.push(`- Show 占比：**${result.showTell.showPercentage}%**`);
        lines.push(`- Tell 占比：**${result.showTell.tellPercentage}%**`);
        lines.push(`- Mixed 占比：**${this.round2(100 - result.showTell.showPercentage - result.showTell.tellPercentage)}%**`);
        lines.push('');

        lines.push('### 统计数据');
        lines.push('');
        lines.push(`- 总段落数：**${result.showTell.stats.totalSegments}**`);
        lines.push(`- Show 段落数：**${result.showTell.stats.showCount}**`);
        lines.push(`- Tell 段落数：**${result.showTell.stats.tellCount}**`);
        lines.push(`- Mixed 段落数：**${result.showTell.stats.mixedCount}**`);
        lines.push(`- 平均 Show 得分：${result.showTell.stats.avgShowScore}`);
        lines.push('');

        if (result.showTell.highRiskTellSegments.length > 0) {
            lines.push('### 高风险 Tell 段落（前 10 个）');
            lines.push('');
            const topRisk = result.showTell.highRiskTellSegments.slice(0, 10);
            topRisk.forEach((seg, idx) => {
                lines.push(`#### 第 ${idx + 1} 个`);
                lines.push('');
                lines.push(`- 置信度：**${(seg.confidence * 100).toFixed(0)}%**`);
                lines.push(`- 长度：${seg.endIndex - seg.startIndex} 字`);
                lines.push(`- Show 得分：${seg.showScore}`);
                lines.push(`- Tell 得分：${seg.tellScore}`);
                lines.push('');
                lines.push(`> ${seg.excerpt}`);
                lines.push('');
            });
        }

        if (result.showTell.suggestions.length > 0) {
            lines.push('### 改进建议');
            lines.push('');
            const severityLabels: Record<string, string> = {
                high: '🔴 高',
                medium: '🟡 中',
                low: '🟢 低'
            };
            result.showTell.suggestions.forEach((s, idx) => {
                lines.push(`${idx + 1}. **${severityLabels[s.severity]}** - ${s.message}`);
            });
            lines.push('');
        }

        return lines.join('\n');
    }
}
