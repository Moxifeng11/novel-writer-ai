export interface AntiAIConstraints {
    constraints: string;
    blacklistedWords: string[];
    sentenceLengthWarning?: string;
    openingDiversityWarning?: string;
    punctuationWarning?: string;
}

export class AntiAIDetector {
    static readonly AI_HIGH_FREQ_WORDS: string[] = [
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
            return '每5句中至少包含1个感叹号或省略号或破折号，句号占比不超过60%';
        }
        return '';
    }

    private mergeConstraints(...constraints: string[]): string {
        const merged = constraints.filter(c => c.length > 0).join('；');
        if (merged.length <= 200) return merged;
        return merged.slice(0, 197) + '...';
    }
}
