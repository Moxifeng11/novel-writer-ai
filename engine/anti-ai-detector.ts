import { AI_LEXICON } from './ai-lexicon';

/**
 * 反 AI 约束集合。
 */
export interface AntiAIConstraints {
    constraints: string;
    blacklistedWords: string[];
    sentenceLengthWarning?: string;
    openingDiversityWarning?: string;
    punctuationWarning?: string;
}

/**
 * AI 特征命中类型。
 */
export type AIDetectionHitType = 'l1' | 'l2' | 'l3';

/**
 * 单条命中。
 */
export interface AIDetectionHit {
    type: AIDetectionHitType;
    text: string;
    start: number;
    end: number;
    weight: number;
}

/**
 * 可检测特征。
 */
export interface AIDetectionFeature {
    key: string;
    displayName: string;
    value: number;
    /**
     * 该分项计入总分前的原始得分（已按分项上限封顶）。
     * 仅用于向用户解释「分数从哪来」，不参与总分计算；
     * 各分项之和可能大于 score（总分有 totalCap 上限）。
     */
    score?: number;
}

/**
 * 检测结果。
 */
export interface AIDetectionResult {
    /** 0-100，越高越像 AI 写的 */
    score: number;
    hits: AIDetectionHit[];
    features: AIDetectionFeature[];
    suggestions: string[];
}

/**
 * AI 味评分权重表（v4.10 行为基线）。
 *
 * 各分项独立封顶后求和，再以 totalCap 封顶。数值若调整会**直接改变评分结果**，
 * 因此集中定义在此处便于审阅；不要在计算分支里散落新的魔法数字。
 */
const AI_SCORE_WEIGHTS = {
    /** 模板短语（L2）：每命中计 phrasePerHit 分，封顶 phraseCap */
    phrasePerHit: 3,
    phraseCap: 35,
    /** 句式模板（L3）：每命中计 patternPerHit 分，封顶 patternCap */
    patternPerHit: 3,
    patternCap: 20,
    /** 高频词密度（L1）：密度 × wordDensityFactor，封顶 wordCap */
    wordDensityFactor: 5,
    wordCap: 15,
    /** 统计特征分项权重（value 为 0-1 归一值，乘权重计入总分） */
    statWeights: {
        sentenceLength: 8,
        opening: 6,
        punctuation: 6,
        dialogue: 4,
        /** 硬伤标点（分号/省略号/破折号）密度：2026-10-30 依据「去AI味」实战规则新增 */
        hardPunct: 10,
    },
    /** 总分上限 */
    totalCap: 100,
} as const;

/** 内置 AI 味高频词基线（不可被用户清空，AI_HIGH_FREQ_WORDS 始终包含它） */
const DEFAULT_AI_HIGH_FREQ_WORDS: string[] = [
    '然而',
    '于是',
    '随后',
    '紧接着',
    '与此同时',
    '不知为何',
    '仿佛',
    '似乎',
    '某种',
    '莫名',
    '陡然',
    '蓦地',
    '倏地',
    '旋即',
    '不由得'
];

/**
 * R2: 用户扩充的 AI 味高频词（默认空数组 → 与内置基线完全一致，无任何行为变化）。
 * 同一份扩充词同时作用于三处：
 * ① 协同写作约束黑名单（detectAIWords / AI_HIGH_FREQ_WORDS）
 * ② AI 味评分的 L1 词频层（detectWithPositions）
 * ③ 可读性「连接词密度」检测（readability-deconstructor）
 */
let extraAiHighFreqWords: string[] = [];

/**
 * AI 味检测器。
 */
export class AntiAIDetector {
    /**
     * 当前生效的高频词表 = 内置基线 + 用户扩充。
     * 只读快照：每次访问返回新数组，外部修改不会污染内部状态。
     * @returns 结果数组
     */
    static get AI_HIGH_FREQ_WORDS(): string[] {
        return extraAiHighFreqWords.length > 0
            ? [...DEFAULT_AI_HIGH_FREQ_WORDS, ...extraAiHighFreqWords]
            : DEFAULT_AI_HIGH_FREQ_WORDS;
    }

    /**
     * R2: 设置用户扩充词（去空白、去重，并剔除与内置基线重复的项）。
     * 传空数组或不传即恢复默认词表；未设置时检测结果与改动前完全一致。
     * @param words - 词表
     */
    static setExtraHighFreqWords(words: string[]): void {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of words || []) {
            const word = (raw || '').trim();
            if (!word || DEFAULT_AI_HIGH_FREQ_WORDS.includes(word) || seen.has(word)) continue;
            seen.add(word);
            cleaned.push(word);
        }
        extraAiHighFreqWords = cleaned;
    }

    /**
     * R2: 当前生效的扩充词（副本，供 Worker 侧同步）
     *
     * @returns 结果数组
     */
    static getExtraHighFreqWords(): string[] {
        return [...extraAiHighFreqWords];
    }

    buildAntiAIConstraints(context: {
        recentSentences: string[];
        currentText?: string;
    }): AntiAIConstraints {
        const { recentSentences, currentText } = context;

        const blacklistedWords = this.detectAIWords(currentText || '');

        const sentenceLengthWarning = this.buildSentenceLengthConstraint(recentSentences);
        const openingDiversityWarning = this.buildOpeningDiversityConstraint(recentSentences);
        const punctuationWarning = this.buildPunctuationConstraint(recentSentences);

        const constraints = this.mergeConstraints(
            sentenceLengthWarning || '',
            openingDiversityWarning || '',
            punctuationWarning || ''
        );

        return {
            constraints,
            blacklistedWords,
            sentenceLengthWarning: sentenceLengthWarning || undefined,
            openingDiversityWarning: openingDiversityWarning || undefined,
            punctuationWarning: punctuationWarning || undefined
        };
    }

    /** L1 词频层词表 = 内置连接词 + 用户扩充词（扩充为空时等价于原内置词表） */
    private getL1Words(): string[] {
        return extraAiHighFreqWords.length > 0
            ? [...AI_LEXICON.l1Connectives, ...extraAiHighFreqWords]
            : AI_LEXICON.l1Connectives;
    }

    /**
     * 检测 AI 高频词。
     *
     * @param text - 文本内容
     * @returns 命中列表
     */
    detectAIWords(text: string): string[] {
        if (!text) return [];
        const found: string[] = [];
        for (const word of AntiAIDetector.AI_HIGH_FREQ_WORDS) {
            if (text.includes(word)) {
                found.push(word);
            }
        }
        return found;
    }

    private buildSentenceLengthConstraint(sentences: string[]): string {
        const recent = sentences.slice(-3).filter(s => s.trim().length > 0);
        if (recent.length < 3) return '';

        const lengths = recent.map(s => s.replace(/\s/g, '').length);
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
        const std = Math.sqrt(variance);

        if (std < 5) {
            return '连续3句的字数必须有明显差异（如：8字→22字→5字），禁止连续2句字数差<5字';
        }
        return '';
    }

    private buildOpeningDiversityConstraint(sentences: string[]): string {
        const recent = sentences.slice(-3).filter(s => s.trim().length > 0);
        if (recent.length < 3) return '';

        const openings = recent.map(s => s.trim().charAt(0));
        const unique = new Set(openings);
        if (unique.size < openings.length) {
            return "连续3句的开头词不得重复（禁止连续以'他''她''这''那'开头）";
        }
        return '';
    }

    private buildPunctuationConstraint(sentences: string[]): string {
        const recent = sentences.slice(-5).filter(s => s.trim().length > 0);
        if (recent.length < 5) return '';

        let periodCount = 0;
        let totalEndCount = 0;
        for (const s of recent) {
            const trimmed = s.trim();
            if (trimmed.length === 0) continue;
            const lastChar = trimmed.charAt(trimmed.length - 1);
            if (lastChar === '。') {
                periodCount++;
                totalEndCount++;
            } else if (/[！？…—]/.test(lastChar)) {
                totalEndCount++;
            }
        }

        if (totalEndCount === 0) return '';

        const periodRatio = periodCount / totalEndCount;
        if (periodRatio > 0.6) {
            return '每5句中至少1句以问号或感叹号收尾，句号占比不超过60%；变化靠对话和疑问句制造，不要用省略号或破折号凑';
        }
        return '';
    }

    private mergeConstraints(...constraints: string[]): string {
        const merged = constraints.filter(c => c.length > 0).join('；');
        if (merged.length <= 200) return merged;
        return merged.slice(0, 197) + '...';
    }

    // ===================== 升级：多维检测引擎（P0-1） =====================

    /**
     * 段落级定位检测：返回所有命中项（含位置），供编辑器标红使用。
     * 三层词库：L2 短语精确匹配（权重最高）→ L3 句式正则 → L1 词频弱信号。
     * @param text - 文本内容
     * @returns 结果数组
     */
    detectWithPositions(text: string): AIDetectionHit[] {
        const hits: AIDetectionHit[] = [];
        if (!text) return hits;

        for (const phrase of AI_LEXICON.l2Phrases) {
            let idx = text.indexOf(phrase);
            while (idx >= 0) {
                hits.push({ type: 'l2', text: phrase, start: idx, end: idx + phrase.length, weight: 3 });
                idx = text.indexOf(phrase, idx + phrase.length);
            }
        }

        for (const pattern of AI_LEXICON.l3Patterns) {
            const re = new RegExp(pattern.regex, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                hits.push({ type: 'l3', text: m[0], start: m.index, end: m.index + m[0].length, weight: 3 });
            }
        }

        for (const word of this.getL1Words()) {
            let idx = text.indexOf(word);
            while (idx >= 0) {
                hits.push({ type: 'l1', text: word, start: idx, end: idx + word.length, weight: 1 });
                idx = text.indexOf(word, idx + word.length);
            }
        }

        return hits;
    }

    /**
     * 0-100 AI 味评分（越高越像 AI 写的）
     *
     * @param text - 文本内容
     * @returns 数值结果
     */
    score(text: string): number {
        return this.detect(text).score;
    }

    /**
     * 完整检测：评分 + 命中项 + 特征向量 + 修改建议
     *
     * @param text - 文本内容
      * @returns AIDetectionResult 实例
     */
    detect(text: string): AIDetectionResult {
        const hits = this.detectWithPositions(text);

        const l1Count = hits.filter(h => h.type === 'l1').length;
        const l2Count = hits.filter(h => h.type === 'l2').length;
        const l3Count = hits.filter(h => h.type === 'l3').length;

        const sentences = this.splitSentences(text);

        // 各分项权重集中定义于 AI_SCORE_WEIGHTS，此处只做计算
        const phraseScore = Math.min(AI_SCORE_WEIGHTS.phraseCap, l2Count * AI_SCORE_WEIGHTS.phrasePerHit);
        const patternScore = Math.min(AI_SCORE_WEIGHTS.patternCap, l3Count * AI_SCORE_WEIGHTS.patternPerHit);
        // 词频分（L1）：密度映射
        const l1Density = sentences.length > 0 ? l1Count / sentences.length : 0;
        const wordScore = Math.min(AI_SCORE_WEIGHTS.wordCap, l1Density * AI_SCORE_WEIGHTS.wordDensityFactor);

        const stats = this.computeStatFeatures(text, sentences);
        const statScore = stats.reduce((sum, f) => sum + f.score, 0);

        const score = Math.round(Math.min(AI_SCORE_WEIGHTS.totalCap, phraseScore + patternScore + wordScore + statScore));

        const features: AIDetectionFeature[] = [
            { key: 'phrase', displayName: '模板短语', value: Math.min(1, l2Count / 8), score: phraseScore },
            { key: 'pattern', displayName: '句式模板', value: Math.min(1, l3Count / 6), score: patternScore },
            { key: 'word', displayName: '高频词密度', value: Math.min(1, l1Density / 2), score: wordScore },
            ...stats.map(s => ({ key: s.key, displayName: s.displayName, value: s.value, score: s.score })),
        ];

        const suggestions = this.buildSuggestions(l2Count, l3Count, l1Count, stats);

        return { score, hits, features, suggestions };
    }

    private splitSentences(text: string): string[] {
        return text
            .split(/[。！？!?…\n]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    private computeStatFeatures(
        text: string,
        sentences: string[]
    ): Array<{ key: string; displayName: string; value: number; score: number }> {
        const features: Array<{ key: string; displayName: string; value: number; score: number }> = [];

        // 1. 句长波动（标准差越小越 AI）
        if (sentences.length >= 3) {
            const lengths = sentences.map(s => s.replace(/\s/g, '').length);
            const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
            const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
            const std = Math.sqrt(variance);
            const value = Math.max(0, Math.min(1, (12 - std) / 12));
            features.push({ key: 'sentenceLength', displayName: '句长波动', value, score: value * AI_SCORE_WEIGHTS.statWeights.sentenceLength });
        }

        // 2. 开头多样性（开头字重复率越高越 AI）
        if (sentences.length >= 3) {
            const openings = sentences.map(s => s.trim().charAt(0)).filter(c => c);
            const unique = new Set(openings).size;
            const repeatRate = openings.length > 0 ? (openings.length - unique) / openings.length : 0;
            const value = Math.max(0, Math.min(1, repeatRate));
            features.push({ key: 'opening', displayName: '开头多样性', value, score: value * AI_SCORE_WEIGHTS.statWeights.opening });
        }

        // 3. 标点单调（句号占比越高越 AI）
        if (sentences.length >= 5) {
            let periodCount = 0;
            let total = 0;
            for (const s of sentences) {
                const last = s.charAt(s.length - 1);
                if (last === '。') { periodCount++; total++; }
                else if (/[！？!?…—]/.test(last)) total++;
            }
            const periodRatio = total > 0 ? periodCount / total : 0;
            const value = Math.max(0, Math.min(1, (periodRatio - 0.4) / 0.6));
            features.push({ key: 'punctuation', displayName: '标点单调', value, score: value * AI_SCORE_WEIGHTS.statWeights.punctuation });
        }

        // 4. 对话密度（过低提示叙述化 AI 味，权重较低；空文本跳过）
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars > 0) {
            const dialogueMatches = text.match(/[“”"「」][^“”"「」]{2,}[“”"「」]/g) || [];
            const dialogueChars = dialogueMatches.reduce((sum, d) => sum + d.length, 0);
            const dialogueRatio = dialogueChars / totalChars;
            const value = Math.max(0, Math.min(1, (0.15 - dialogueRatio) / 0.15));
            features.push({ key: 'dialogue', displayName: '对话密度低', value, score: value * AI_SCORE_WEIGHTS.statWeights.dialogue });
        }

        // 5. 硬伤标点密度（2026-10-30）：分号/省略号/破折号是检测器最敏感的 AI 标点组合。
        //    真人网文几乎不用分号，省略号/破折号一章至多一两处。
        if (sentences.length >= 8) {
            const semicolons = (text.match(/[；;]/g) || []).length;
            const ellipses = (text.match(/…/g) || []).length;
            const dashes = (text.match(/[—－]/g) || []).length;
            const hardCount = semicolons * 2 + ellipses + dashes;
            const value = Math.max(0, Math.min(1, hardCount / 8));
            if (value > 0) {
                features.push({ key: 'hardPunct', displayName: '硬伤标点', value, score: value * AI_SCORE_WEIGHTS.statWeights.hardPunct });
            }
        }

        return features;
    }

    private buildSuggestions(
        l2Count: number,
        l3Count: number,
        l1Count: number,
        stats: Array<{ key: string; displayName: string; value: number }>
    ): string[] {
        const suggestions: string[] = [];
        if (l2Count > 0) suggestions.push(`发现 ${l2Count} 处 AI 模板短语（如「眼中闪过一丝」「嘴角勾起」），建议改为具体动作/神态描写`);
        if (l3Count > 0) suggestions.push(`发现 ${l3Count} 处 AI 句式模板，建议打破句式重复`);
        if (l1Count > 4) suggestions.push(`高频连接词/副词出现 ${l1Count} 次，建议删减「然而/仿佛/似乎」类虚词`);

        const hintMap: Record<string, string> = {
            sentenceLength: '连续句长过于均匀，建议长短句交替',
            opening: '连续句开头词重复，建议变换主语',
            punctuation: '句号占比过高，建议让角色开口说话或加入感叹/疑问句',
            dialogue: '对话密度偏低，建议增加对话或内心独白',
            hardPunct: '分号/省略号/破折号是检测器最敏感的 AI 标点，建议改成句号、逗号或直接断句',
        };
        for (const s of stats) {
            if (s.value > 0.7 && hintMap[s.key]) suggestions.push(hintMap[s.key]);
        }
        return suggestions;
    }
}
