import type {
    BreakdownDimension,
    DeconstructionQualityLevel,
    DimensionQualityScore,
} from './deconstruction-scheduler';

export type { BreakdownDimension, DeconstructionQualityLevel, DimensionQualityScore };

/**
 * 质量评分输入。
 */
export interface QualityScoringInput {
    dimension: BreakdownDimension;
    result: any;
    textLength: number;
    usedLevel: DeconstructionQualityLevel;
    elapsedTime?: number;
}

/**
 * 交叉校验规则。
 */
export interface CrossValidationRule {
    name: string;
    dimensionA: BreakdownDimension;
    dimensionB: BreakdownDimension;
    fieldA: string;
    fieldB: string;
    rule: 'positive_correlation' | 'negative_correlation' | 'range_check' | 'consistency';
    threshold?: number;
    description: string;
}

/**
 * 交叉校验结果。
 */
export interface CrossValidationResult {
    rule: CrossValidationRule;
    passed: boolean;
    valueA: number;
    valueB: number;
    message: string;
}

const DIMENSION_REQUIRED_FIELDS: Record<BreakdownDimension, string[]> = {
    style: ['sentenceRhythm', 'wordPreference', 'narrativeStyle', 'rhetoric', 'dialogueStyle', 'paragraphStructure', 'overallStyle', 'stats'],
    rhythm: ['emotionCurve', 'emotionPoints', 'plotStages', 'structureMatches', 'coolPoints', 'mainThreadSwitches', 'stats'],
    technique: ['techniques', 'categoryDistribution', 'topTechniques', 'stats'],
    structure: ['qcchSegments', 'rhythmUnits', 'threeLineStructure', 'structureType', 'stats'],
    character: ['characters', 'relations', 'stats'],
    foreshadow: ['foreshadows', 'typeDistribution', 'stats', 'timeline'],
    commercial: ['goldenThreeChapters', 'overallScore', 'overallLevel'],
    readability: ['showTell', 'aiTrace', 'overallScore'],
};

const CROSS_VALIDATION_RULES: CrossValidationRule[] = [
    {
        name: '爽点密度 vs 情绪曲线强度',
        dimensionA: 'rhythm', dimensionB: 'rhythm',
        fieldA: 'coolPoints.length', fieldB: 'emotionPoints.avgIntensity',
        rule: 'positive_correlation',
        description: '爽点密度高的章节应有更高的情绪强度',
    },
    {
        name: '章末钩子率 vs 张力峰值',
        dimensionA: 'rhythm', dimensionB: 'rhythm',
        fieldA: 'hookAnalysis.hookRate', fieldB: 'tensionCurve.peaks.length',
        rule: 'positive_correlation',
        description: '钩子率高的章节应有更多张力峰值',
    },
    {
        name: '对话比例 vs Show占比',
        dimensionA: 'style', dimensionB: 'readability',
        fieldA: 'dialogueStyle.dialogueRatio', fieldB: 'showTell.showPercentage',
        rule: 'positive_correlation',
        description: '对话多的文本 Show 占比应更高',
    },
    {
        name: '词汇丰富度 vs AI痕迹',
        dimensionA: 'style', dimensionB: 'readability',
        fieldA: 'vocabularyRichness.ttr', fieldB: 'aiTrace.overallScore',
        rule: 'negative_correlation',
        description: '词汇丰富度越高，AI痕迹应越低',
    },
    {
        name: '金手指出现 vs 商业评分',
        dimensionA: 'commercial', dimensionB: 'commercial',
        fieldA: 'goldenThreeChapters.subScores.goldenFinger', fieldB: 'overallScore',
        rule: 'positive_correlation',
        description: '金手指得分高则商业评分高',
    },
    {
        name: '角色数 vs 网络密度',
        dimensionA: 'character', dimensionB: 'character',
        fieldA: 'characters.length', fieldB: 'networkCentrality.networkDensity',
        rule: 'range_check', threshold: 0.3,
        description: '角色数多时网络密度不应过低',
    },
    {
        name: '设定密度 vs 世界观覆盖度',
        dimensionA: 'foreshadow', dimensionB: 'foreshadow',
        fieldA: 'settingDensity.avgDensity', fieldB: 'worldbuilding.coverageScore',
        rule: 'positive_correlation',
        description: '设定密度高则世界观覆盖度高',
    },
    {
        name: '结构匹配度 vs 节奏曲线评分',
        dimensionA: 'structure', dimensionB: 'rhythm',
        fieldA: 'templateMatch.bestMatch.matchScore', fieldB: 'rhythmCurve.avgScore',
        rule: 'positive_correlation',
        description: '结构清晰的作品节奏评分也高',
    },
    {
        name: '情感波动度 vs 张力标准差',
        dimensionA: 'rhythm', dimensionB: 'rhythm',
        fieldA: 'nrcEmotion.emotionVolatility', fieldB: 'tensionCurve.overallTensionStd',
        rule: 'positive_correlation',
        description: '情感波动大时张力起伏也大',
    },
];

/**
 * 质量评分器。
 */
export class QualityScorer {
    /**
     * 计算质量分。
     *
     * @param input - 输入
     * @returns 分数
     */
    calculateQualityScore(input: QualityScoringInput): DimensionQualityScore {
        const completeness = this.calculateCompleteness(input.dimension, input.result);
        const consistency = this.calculateConsistency(input.dimension, input.result);
        const confidence = this.calculateConfidence(input.usedLevel, input.result);
        const overall = Math.round(0.4 * completeness + 0.3 * consistency + 0.3 * confidence);
        const level: DimensionQualityScore['level'] = overall >= 80 ? 'high' : overall >= 50 ? 'medium' : 'low';
        return {
            completeness,
            consistency,
            confidence,
            overall,
            level,
            usedLevel: input.usedLevel,
        };
    }

    /**
     * 批量评分。
     *
     * @param inputs - 输入集合
     * @returns 分数表
     */
    calculateBatchScores(inputs: QualityScoringInput[]): Record<BreakdownDimension, DimensionQualityScore> {
        const out = {} as Record<BreakdownDimension, DimensionQualityScore>;
        for (const input of inputs) {
            out[input.dimension] = this.calculateQualityScore(input);
        }
        return out;
    }

    /**
     * 交叉校验。
     *
     * @param results - 结果列表
     * @returns 结果
     */
    crossValidate(results: Partial<Record<BreakdownDimension, any>>): CrossValidationResult[] {
        const out: CrossValidationResult[] = [];
        for (const rule of CROSS_VALIDATION_RULES) {
            const objA = results[rule.dimensionA];
            const objB = results[rule.dimensionB];
            if (!objA || !objB) continue;

            const rawA = this.getFieldByPath(objA, rule.fieldA);
            const rawB = this.getFieldByPath(objB, rule.fieldB);
            if (rawA === undefined || rawA === null) continue;
            if (rawB === undefined || rawB === null) continue;

            const numA = this.toNumber(rawA);
            const numB = this.toNumber(rawB);
            if (numA === null || numB === null) continue;

            const normA = this.normalize(numA);
            const normB = this.normalize(numB);

            let passed = false;
            let message = '';

            switch (rule.rule) {
                case 'positive_correlation':
                    passed = (normA > 0.5 && normB > 0.5) || (normA <= 0.5 && normB <= 0.5);
                    message = `A=${numA}, B=${numB}, 期望同向变化, 实际${passed ? '一致' : '不一致'}`;
                    break;
                case 'negative_correlation':
                    passed = (normA > 0.5 && normB <= 0.5) || (normA <= 0.5 && normB > 0.5);
                    message = `A=${numA}, B=${numB}, 期望反向变化, 实际${passed ? '一致' : '不一致'}`;
                    break;
                case 'range_check':
                    passed = rule.threshold !== undefined ? numB >= rule.threshold : true;
                    message = `B=${numB}, 阈值=${rule.threshold ?? '-'}, ${passed ? '通过' : '未通过'}`;
                    break;
                case 'consistency': {
                    const diff = Math.abs(normA - normB);
                    passed = diff < 0.2;
                    message = `A=${numA}, B=${numB}, 偏差=${diff.toFixed(2)}, ${passed ? '在合理范围内' : '偏差过大'}`;
                    break;
                }
            }

            out.push({
                rule,
                passed,
                valueA: numA,
                valueB: numB,
                message,
            });
        }
        return out;
    }

    /**
     * 是否应升级质量档。
     *
     * @param score - 分数
     * @returns 布尔值
     */
    shouldUpgrade(score: DimensionQualityScore): boolean {
        return score.overall < 60 && score.usedLevel !== 'deep';
    }

    /**
     * 建议质量档。
     *
     * @param score - 分数
     * @returns 档位
     */
    suggestLevel(score: DimensionQualityScore): DeconstructionQualityLevel {
        if (score.overall >= 80) return score.usedLevel;
        if (score.usedLevel === 'fast') return 'standard';
        if (score.usedLevel === 'standard') return 'deep';
        return score.usedLevel;
    }

    private calculateCompleteness(dimension: BreakdownDimension, result: any): number {
        if (!result || typeof result !== 'object') return 30;
        const requiredFields = DIMENSION_REQUIRED_FIELDS[dimension] || [];
        if (requiredFields.length === 0) return 70;

        let filledCount = 0;
        let missingCount = 0;
        for (const field of requiredFields) {
            const value = this.getFieldByPath(result, field);
            if (this.isNonEmpty(value)) {
                filledCount++;
            } else {
                missingCount++;
            }
        }
        const total = requiredFields.length;
        const coverage = filledCount / total;
        const missingRatio = missingCount / total;

        const allKeys = Object.keys(result);
        const nonEmptyTopKeys = allKeys.filter(k => this.isNonEmpty((result as any)[k])).length;
        const diversity = allKeys.length > 0 ? nonEmptyTopKeys / allKeys.length : 0.5;

        return Math.round(100 * (0.5 * coverage + 0.3 * (1 - missingRatio) + 0.2 * diversity));
    }

    private calculateConsistency(dimension: BreakdownDimension, result: any): number {
        if (!result || typeof result !== 'object') return 50;

        let selfConsistency = 0.7;
        let stability = 0.7;

        if (dimension === 'character') {
            const chars = result.characters;
            const stats = result.stats;
            if (Array.isArray(chars) && stats && typeof stats.totalCharacters === 'number') {
                selfConsistency = chars.length === stats.totalCharacters ? 1.0 : 0.5;
            }
        } else if (dimension === 'commercial') {
            const score = result.overallScore;
            const level = result.overallLevel;
            if (typeof score === 'number' && typeof level === 'string') {
                const expectedLevel = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
                selfConsistency = expectedLevel === level ? 1.0 : 0.5;
            }
        } else if (dimension === 'foreshadow') {
            const fs = result.foreshadows;
            const stats = result.stats;
            if (Array.isArray(fs) && stats && typeof stats.totalForeshadows === 'number') {
                selfConsistency = fs.length === stats.totalForeshadows ? 1.0 : 0.5;
            }
        } else if (dimension === 'technique') {
            const dist = result.categoryDistribution;
            if (dist && typeof dist === 'object') {
                const sum = Object.values(dist).reduce((s: number, v: any) => s + (typeof v === 'number' ? v : 0), 0);
                if (sum > 0) {
                    stability = (sum >= 0.95 && sum <= 1.05) ? 1.0 : 0.6;
                }
            }
        }

        if (dimension === 'style' || dimension === 'readability') {
            const ttr = this.getFieldByPath(result, 'vocabularyRichness.ttr');
            if (typeof ttr === 'number') {
                stability = (ttr >= 0 && ttr <= 1) ? 1.0 : 0.4;
            }
        }

        return Math.round(100 * (0.5 * selfConsistency + 0.5 * stability));
    }

    private calculateConfidence(usedLevel: DeconstructionQualityLevel, result: any): number {
        let base: number;
        if (usedLevel === 'fast') {
            base = 40;
        } else if (usedLevel === 'standard') {
            base = 65;
        } else {
            base = 85;
        }

        let bonus = 0;
        if (result && typeof result === 'object') {
            const keys = Object.keys(result);
            if (keys.length >= 8) bonus = 10;
            else if (keys.length >= 5) bonus = 5;
        }

        return Math.min(95, base + bonus);
    }

    private getFieldByPath(obj: any, path: string): any {
        if (obj === null || obj === undefined || !path) return undefined;
        const parts = path.split('.');
        let current: any = obj;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            if (typeof current !== 'object' && !Array.isArray(current)) return undefined;
            if (part === 'length' && (Array.isArray(current) || typeof current === 'string')) {
                return current.length;
            }
            current = current[part];
        }
        return current;
    }

    private isNonEmpty(value: any): boolean {
        if (value === null || value === undefined) return false;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') return value.length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    }

    private toNumber(value: any): number | null {
        if (typeof value === 'number') return isFinite(value) ? value : null;
        if (typeof value === 'string') {
            const n = parseFloat(value);
            return isNaN(n) ? null : n;
        }
        if (typeof value === 'boolean') return value ? 1 : 0;
        return null;
    }

    private normalize(value: number): number {
        if (value < 0) return 0;
        if (value <= 1) return value;
        if (value <= 10) return value / 10;
        if (value <= 100) return value / 100;
        return 1;
    }
}

export { CROSS_VALIDATION_RULES, DIMENSION_REQUIRED_FIELDS };
