/**
 * incremental-result-aggregator.ts — 增量结果聚合器
 *
 * 功能：将分段拆解的结果逐步聚合成完整结果，支持增量输出和防抖回调。
 *
 * 设计目标：
 * - 每段完成后立即更新聚合结果
 * - 防抖机制：每 10% 进度或每 2 秒触发一次回调
 * - 支持维度级增量：风格维度完成一段后，风格部分结果可用
 * - 完成的维度标记 isComplete
 */

import type { StyleAnalysisResult } from './deconstructors/style-deconstructor';
import type { RhythmAnalysisResult } from './deconstructors/rhythm-deconstructor';
import type { TechniqueAnalysisResult } from './deconstructors/technique-deconstructor';
import type { StructureAnalysisResult } from './deconstructors/structure-deconstructor';
import type { CharacterAnalysisResult } from './deconstructors/character-deconstructor';
import type { ForeshadowAnalysisResult } from './deconstructors/foreshadow-deconstructor';
import type { CommercialAnalysisResult } from './deconstructors/commercial-deconstructor';
import type { ReadabilityAnalysisResult } from './deconstructors/readability-deconstructor';
import type { DeconstructDimension } from '../services/deconstruction-worker-manager';
import { createLogger } from '../shared/logger';


const log = createLogger('IncrementalResultAggregator');
export type AnalysisResult =
    | StyleAnalysisResult
    | RhythmAnalysisResult
    | TechniqueAnalysisResult
    | StructureAnalysisResult
    | CharacterAnalysisResult
    | ForeshadowAnalysisResult
    | CommercialAnalysisResult
    | ReadabilityAnalysisResult;

export interface PartialResult {
    dimension: DeconstructDimension;
    results: AnalysisResult[];
    combinedResult?: AnalysisResult;
    totalSegments: number;
    completedSegments: number;
    isComplete: boolean;
    progress: number;
    lastUpdated: number;
}

interface PartialResultCallback {
    (result: PartialResult): void;
}

interface AggregatorOptions {
    debounceMs?: number;
    progressThreshold?: number;
}

const DEFAULT_OPTIONS: Required<AggregatorOptions> = {
    debounceMs: 2000,
    progressThreshold: 0.1,
};

export class IncrementalResultAggregator {
    private partialResults: Map<DeconstructDimension, PartialResult> = new Map();
    private callbacks: Set<PartialResultCallback> = new Set();
    private lastCallbackTimes: Map<DeconstructDimension, number> = new Map();
    private lastProgress: Map<DeconstructDimension, number> = new Map();
    private options: Required<AggregatorOptions>;

    constructor(options: AggregatorOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    addSegmentResult(
        dimension: DeconstructDimension,
        segmentResult: AnalysisResult,
        segmentIndex: number,
        totalSegments: number
    ): void {
        const existing = this.partialResults.get(dimension);
        const results = existing ? [...existing.results, segmentResult] : [segmentResult];
        const completedSegments = results.length;
        const isComplete = completedSegments >= totalSegments;
        const progress = totalSegments > 0 ? completedSegments / totalSegments : 0;

        const combined = isComplete ? this.combineResults(results, dimension) : (existing?.combinedResult);

        const partialResult: PartialResult = {
            dimension,
            results,
            combinedResult: combined,
            totalSegments,
            completedSegments,
            isComplete,
            progress,
            lastUpdated: Date.now(),
        };

        this.partialResults.set(dimension, partialResult);

        this.triggerCallbackIfNeeded(dimension, progress, partialResult);
    }

    markDimensionComplete(dimension: DeconstructDimension): void {
        const existing = this.partialResults.get(dimension);
        if (existing) {
            const combined = this.combineResults(existing.results, dimension);
            existing.combinedResult = combined;
            existing.isComplete = true;
            existing.progress = 1;
            existing.lastUpdated = Date.now();
            this.partialResults.set(dimension, existing);
            this.triggerCallback(dimension, existing);
        }
    }

    getPartialResult(dimension: DeconstructDimension): PartialResult | undefined {
        return this.partialResults.get(dimension);
    }

    getAllPartialResults(): PartialResult[] {
        return Array.from(this.partialResults.values());
    }

    onPartialResult(callback: PartialResultCallback): () => void {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }

    clear(): void {
        this.partialResults.clear();
        this.lastCallbackTimes.clear();
        this.lastProgress.clear();
    }

    private triggerCallbackIfNeeded(
        dimension: DeconstructDimension,
        progress: number,
        partialResult: PartialResult
    ): void {
        const now = Date.now();
        const lastTime = this.lastCallbackTimes.get(dimension) || 0;
        const lastProg = this.lastProgress.get(dimension) || 0;

        const timePassed = now - lastTime >= this.options.debounceMs;
        const progressChanged = progress - lastProg >= this.options.progressThreshold;

        if (timePassed || progressChanged || partialResult.isComplete) {
            this.triggerCallback(dimension, partialResult);
            this.lastCallbackTimes.set(dimension, now);
            this.lastProgress.set(dimension, progress);
        }
    }

    private triggerCallback(dimension: DeconstructDimension, partialResult: PartialResult): void {
        for (const callback of this.callbacks) {
            try {
                callback(partialResult);
            } catch (e) {
                log.warn('PartialResult callback error:', e);
            }
        }
    }

    private combineResults(results: AnalysisResult[], dimension: DeconstructDimension): AnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult(dimension);
        }

        if (results.length === 1) {
            return results[0];
        }

        const first = results[0];
        switch (dimension) {
            case 'style':
                return this.combineStyleResults(results as StyleAnalysisResult[]);
            case 'rhythm':
                return this.combineRhythmResults(results as RhythmAnalysisResult[]);
            case 'technique':
                return this.combineTechniqueResults(results as TechniqueAnalysisResult[]);
            case 'structure':
                return this.combineStructureResults(results as StructureAnalysisResult[]);
            case 'character':
                return this.combineCharacterResults(results as CharacterAnalysisResult[]);
            case 'foreshadow':
                return this.combineForeshadowResults(results as ForeshadowAnalysisResult[]);
            case 'commercial':
                return this.combineCommercialResults(results as CommercialAnalysisResult[]);
            case 'readability':
                return this.combineReadabilityResults(results as ReadabilityAnalysisResult[]);
            // 已知限制：以下维度尚未实现专门的聚合逻辑，默认返回第一块结果。
            // 新增维度需在此处添加 case 分支并实现对应的 combineXxxResults 方法。
            default:
                return first;
        }
    }

    private combineStyleResults(results: StyleAnalysisResult[]): StyleAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('style') as StyleAnalysisResult;
        }

        const first = results[0];
        if (!first.sentenceRhythm || !first.wordPreference) {
            return first;
        }

        const totalChars = results.reduce((sum, r) => sum + (r.stats?.totalChars ?? 0), 0);
        const totalSentences = results.reduce((sum, r) => sum + (r.stats?.totalSentences ?? 0), 0);
        const totalParagraphs = results.reduce((sum, r) => sum + (r.stats?.totalParagraphs ?? 0), 0);

        return {
            sentenceRhythm: this.averageSentenceRhythm(results.map(r => r.sentenceRhythm)),
            wordPreference: this.mergeWordPreference(results.map(r => r.wordPreference)),
            narrativeStyle: this.mergeNarrativeStyle(results.map(r => r.narrativeStyle)),
            rhetoric: this.mergeRhetoric(results.map(r => r.rhetoric)),
            dialogueStyle: this.mergeDialogueStyle(results.map(r => r.dialogueStyle)),
            paragraphStructure: this.mergeParagraphStructure(results.map(r => r.paragraphStructure)),
            overallStyle: this.mergeOverallStyle(results.map(r => r.overallStyle)),
            stats: {
                totalChars,
                totalSentences,
                totalParagraphs,
            },
        };
    }

    private combineRhythmResults(results: RhythmAnalysisResult[]): RhythmAnalysisResult {
        return results[results.length - 1];
    }

    private combineTechniqueResults(results: TechniqueAnalysisResult[]): TechniqueAnalysisResult {
        return results[results.length - 1];
    }

    private combineStructureResults(results: StructureAnalysisResult[]): StructureAnalysisResult {
        return results[results.length - 1];
    }

    private combineCharacterResults(results: CharacterAnalysisResult[]): CharacterAnalysisResult {
        const characters = results.flatMap(r => r.characters ?? []);
        const relations = results.flatMap(r => r.relations ?? []);
        return {
            ...results[results.length - 1],
            characters,
            relations,
        };
    }

    private combineForeshadowResults(results: ForeshadowAnalysisResult[]): ForeshadowAnalysisResult {
        const foreshadows = results.flatMap(r => r.foreshadows ?? []);
        return {
            ...results[results.length - 1],
            foreshadows,
        };
    }

    private combineCommercialResults(results: CommercialAnalysisResult[]): CommercialAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('commercial') as CommercialAnalysisResult;
        }
        if (results.length === 1) {
            return results[0];
        }

        const first = results[0];

        // overallScore: 算术平均（注：CommercialAnalysisResult 不含字数信息，暂用等权平均）
        const avgOverallScore = this.round2(
            results.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) / results.length
        );

        // openingConflict 保留第一块（只有开头有冲突检测意义）
        const goldenThreeChapters = first.goldenThreeChapters;

        // waveRhythm: 跨块合并——合并 violations，平均各间隔与合规率
        let waveRhythm: CommercialAnalysisResult['waveRhythm'] = first.waveRhythm;
        if (first.waveRhythm) {
            const allViolations = results
                .filter(r => r.waveRhythm)
                .flatMap(r => r.waveRhythm!.violations);
            const waveCount = results.filter(r => r.waveRhythm).length;
            const avgCompliance = waveCount > 0
                ? this.round2(results.reduce((sum, r) => sum + (r.waveRhythm?.complianceRate ?? 0), 0) / waveCount)
                : 0;
            const avgSmallInterval = waveCount > 0
                ? this.round2(results.reduce((sum, r) => sum + (r.waveRhythm?.smallCoolPointInterval ?? 0), 0) / waveCount)
                : 0;
            const avgMediumInterval = waveCount > 0
                ? this.round2(results.reduce((sum, r) => sum + (r.waveRhythm?.mediumReversalInterval ?? 0), 0) / waveCount)
                : 0;
            const avgBigInterval = waveCount > 0
                ? this.round2(results.reduce((sum, r) => sum + (r.waveRhythm?.bigClimaxInterval ?? 0), 0) / waveCount)
                : 0;

            waveRhythm = {
                complianceRate: avgCompliance,
                smallCoolPointInterval: avgSmallInterval,
                mediumReversalInterval: avgMediumInterval,
                bigClimaxInterval: avgBigInterval,
                violations: allViolations,
            };
        }

        // level 根据平均分重新计算（与 CommercialDeconstructor.calculateOverallLevel 一致）
        const overallLevel = this.calculateCommercialLevel(avgOverallScore);

        return {
            goldenThreeChapters,
            waveRhythm,
            overallScore: avgOverallScore,
            overallLevel,
        };
    }

    private combineReadabilityResults(results: ReadabilityAnalysisResult[]): ReadabilityAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('readability') as ReadabilityAnalysisResult;
        }
        if (results.length === 1) {
            return results[0];
        }

        // overallScore: 算术平均（注：ReadabilityAnalysisResult 不含字数信息，暂用等权平均）
        const avgOverallScore = this.round2(
            results.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) / results.length
        );

        // showTell: segment 合并累加，重新计算 stats
        const allSegments = results.flatMap(r => r.showTell?.segments ?? []);
        const allHighRisk = results.flatMap(r => r.showTell?.highRiskTellSegments ?? []);
        const showCount = allSegments.filter(s => s.type === 'show').length;
        const tellCount = allSegments.filter(s => s.type === 'tell').length;
        const mixedCount = allSegments.filter(s => s.type === 'mixed').length;
        const totalSegments = allSegments.length;
        const avgShowScore = totalSegments > 0
            ? this.round2(allSegments.reduce((sum, s) => sum + s.showScore, 0) / totalSegments)
            : 0;
        const overallRatio = totalSegments > 0 ? this.round2(showCount / totalSegments) : 0;
        const showPercentage = totalSegments > 0 ? this.round2((showCount / totalSegments) * 100) : 0;
        const tellPercentage = totalSegments > 0 ? this.round2((tellCount / totalSegments) * 100) : 0;

        // suggestions: 合并去重（按 message 去重）
        const allSuggestions = results.flatMap(r => r.showTell?.suggestions ?? []);
        const seenMessages = new Set<string>();
        const mergedSuggestions = allSuggestions.filter(s => {
            if (seenMessages.has(s.message)) return false;
            seenMessages.add(s.message);
            return true;
        });

        const showTell: ReadabilityAnalysisResult['showTell'] = {
            overallRatio,
            showPercentage,
            tellPercentage,
            segments: allSegments,
            highRiskTellSegments: allHighRisk,
            stats: { totalSegments, showCount, tellCount, mixedCount, avgShowScore },
            suggestions: mergedSuggestions,
        };

        // aiTrace: 各维度取平均
        const dimCount = results.length;
        const dimensionKeys = ['sentenceSimilarity', 'connectorDensity', 'explanatoryEnding', 'parallelismAbuse', 'wordRepetition', 'emotionUniformity'] as const;

        const averagedDims: Record<string, { score: number; description: string; details: Record<string, number> }> = {};
        for (const key of dimensionKeys) {
            const scores = results.map(r => r.aiTrace?.dimensions?.[key]?.score ?? 0);
            const avgScore = this.round2(scores.reduce((a, b) => a + b, 0) / dimCount);
            const lastDesc = results[results.length - 1].aiTrace?.dimensions?.[key]?.description ?? '';
            averagedDims[key] = {
                score: avgScore,
                description: lastDesc,
                details: results[results.length - 1].aiTrace?.dimensions?.[key]?.details ?? {},
            };
        }

        const aiTraceOverallScore = this.round2(
            Object.values(averagedDims).reduce((sum, d) => sum + d.score, 0) / dimensionKeys.length
        );
        const aiTraceLevel = this.calculateAITraceLevel(aiTraceOverallScore);

        // highRiskParagraphs: 合并排序取前 10
        const allHighRiskParagraphs = results.flatMap(r => r.aiTrace?.highRiskParagraphs ?? []);
        allHighRiskParagraphs.sort((a, b) => b.score - a.score);
        const topHighRiskParagraphs = allHighRiskParagraphs.slice(0, 10);

        const aiTrace: ReadabilityAnalysisResult['aiTrace'] = {
            overallScore: aiTraceOverallScore,
            level: aiTraceLevel,
            dimensions: averagedDims as ReadabilityAnalysisResult['aiTrace']['dimensions'],
            highRiskParagraphs: topHighRiskParagraphs,
        };

        return {
            showTell,
            aiTrace,
            overallScore: avgOverallScore,
        };
    }

    private calculateCommercialLevel(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
        if (score >= 90) return 'S';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B';
        if (score >= 60) return 'C';
        return 'D';
    }

    private calculateAITraceLevel(score: number): 'low' | 'medium' | 'high' {
        if (score >= 60) return 'high';
        if (score >= 30) return 'medium';
        return 'low';
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }

    private averageSentenceRhythm(rhythms: (StyleAnalysisResult['sentenceRhythm'] | undefined)[]): StyleAnalysisResult['sentenceRhythm'] {
        const validRhythms = rhythms.filter((r): r is StyleAnalysisResult['sentenceRhythm'] => r !== undefined);
        const count = validRhythms.length;
        if (count === 0) return { avgSentenceLength: 0, medianSentenceLength: 0, stdSentenceLength: 0, sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 }, lengthDistribution: { short: 0, medium: 0, long: 0 } };

        const avg = validRhythms.reduce((sum, r) => sum + (r.avgSentenceLength ?? 0), 0) / count;
        const median = validRhythms.reduce((sum, r) => sum + (r.medianSentenceLength ?? 0), 0) / count;
        const std = validRhythms.reduce((sum, r) => sum + (r.stdSentenceLength ?? 0), 0) / count;

        return {
            avgSentenceLength: avg,
            medianSentenceLength: median,
            stdSentenceLength: std,
            sentenceTypeDistribution: {
                declarative: validRhythms.reduce((sum, r) => sum + (r.sentenceTypeDistribution?.declarative ?? 0), 0) / count,
                interrogative: validRhythms.reduce((sum, r) => sum + (r.sentenceTypeDistribution?.interrogative ?? 0), 0) / count,
                exclamatory: validRhythms.reduce((sum, r) => sum + (r.sentenceTypeDistribution?.exclamatory ?? 0), 0) / count,
                elliptical: validRhythms.reduce((sum, r) => sum + (r.sentenceTypeDistribution?.elliptical ?? 0), 0) / count,
            },
            lengthDistribution: {
                short: validRhythms.reduce((sum, r) => sum + (r.lengthDistribution?.short ?? 0), 0) / count,
                medium: validRhythms.reduce((sum, r) => sum + (r.lengthDistribution?.medium ?? 0), 0) / count,
                long: validRhythms.reduce((sum, r) => sum + (r.lengthDistribution?.long ?? 0), 0) / count,
            },
            dominantVectorStyle: validRhythms[validRhythms.length - 1].dominantVectorStyle,
            vectorStyleScores: validRhythms[validRhythms.length - 1].vectorStyleScores,
        };
    }

    private mergeWordPreference(prefs: StyleAnalysisResult['wordPreference'][]): StyleAnalysisResult['wordPreference'] {
        const topWordsMap = new Map<string, number>();
        for (const p of prefs) {
            for (const w of p.topWords ?? []) {
                topWordsMap.set(w.word, (topWordsMap.get(w.word) ?? 0) + w.count);
            }
        }
        const topWords = Array.from(topWordsMap.entries())
            .map(([word, count]) => ({ word, count, frequency: count / prefs.length }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        return {
            topWords,
            posPreference: {
                verb: prefs.reduce((sum, p) => sum + (p.posPreference?.verb ?? 0), 0) / prefs.length,
                adjective: prefs.reduce((sum, p) => sum + (p.posPreference?.adjective ?? 0), 0) / prefs.length,
                adverb: prefs.reduce((sum, p) => sum + (p.posPreference?.adverb ?? 0), 0) / prefs.length,
            },
            modalParticles: {
                total: prefs.reduce((sum, p) => sum + (p.modalParticles?.total ?? 0), 0),
                perThousand: prefs.reduce((sum, p) => sum + (p.modalParticles?.perThousand ?? 0), 0) / prefs.length,
                topParticles: [],
            },
            idiomDensity: prefs.reduce((sum, p) => sum + p.idiomDensity, 0) / prefs.length,
            colloquialismLevel: prefs.reduce((sum, p) => sum + p.colloquialismLevel, 0) / prefs.length,
        };
    }

    private mergeNarrativeStyle(styles: StyleAnalysisResult['narrativeStyle'][]): StyleAnalysisResult['narrativeStyle'] {
        return styles[styles.length - 1];
    }

    private mergeRhetoric(rhetorics: StyleAnalysisResult['rhetoric'][]): StyleAnalysisResult['rhetoric'] {
        const count = rhetorics.length;
        const metaphor = rhetorics.reduce((sum, r) => sum + (r.metaphor ?? 0), 0);
        const personification = rhetorics.reduce((sum, r) => sum + (r.personification ?? 0), 0);
        const parallelism = rhetorics.reduce((sum, r) => sum + (r.parallelism ?? 0), 0);
        const rhetoricalQuestion = rhetorics.reduce((sum, r) => sum + (r.rhetoricalQuestion ?? 0), 0);
        const hyperbole = rhetorics.reduce((sum, r) => sum + (r.hyperbole ?? 0), 0);
        const antithesis = rhetorics.reduce((sum, r) => sum + (r.antithesis ?? 0), 0);
        return {
            metaphor,
            personification,
            parallelism,
            rhetoricalQuestion,
            hyperbole,
            antithesis,
            total: metaphor + personification + parallelism + rhetoricalQuestion + hyperbole + antithesis,
            perThousand: rhetorics.reduce((sum, r) => sum + (r.perThousand ?? 0), 0) / count,
        };
    }

    private mergeDialogueStyle(dialogues: StyleAnalysisResult['dialogueStyle'][]): StyleAnalysisResult['dialogueStyle'] {
        return dialogues[dialogues.length - 1];
    }

    private mergeParagraphStructure(structures: StyleAnalysisResult['paragraphStructure'][]): StyleAnalysisResult['paragraphStructure'] {
        return structures[structures.length - 1];
    }

    private mergeOverallStyle(styes: StyleAnalysisResult['overallStyle'][]): StyleAnalysisResult['overallStyle'] {
        return styes[styes.length - 1];
    }

    private createEmptyResult(dimension: DeconstructDimension): AnalysisResult {
        switch (dimension) {
            case 'style':
                return {
                    sentenceRhythm: {
                        avgSentenceLength: 0, medianSentenceLength: 0, stdSentenceLength: 0,
                        sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
                        lengthDistribution: { short: 0, medium: 0, long: 0 },
                    },
                    wordPreference: {
                        topWords: [],
                        posPreference: { verb: 0, adjective: 0, adverb: 0 },
                        modalParticles: { total: 0, perThousand: 0, topParticles: [] },
                        idiomDensity: 0, colloquialismLevel: 0,
                    },
                    narrativeStyle: {
                        perspective: 'third_person_limited', perspectiveConfidence: 0,
                        descriptionRatio: { appearance: 0, environment: 0, action: 0, psychology: 0, total: 0 },
                        narrationRatio: 0, dialogueRatio: 0,
                    },
                    rhetoric: {
                        metaphor: 0, personification: 0, parallelism: 0,
                        rhetoricalQuestion: 0, hyperbole: 0, antithesis: 0,
                        total: 0, perThousand: 0,
                    },
                    dialogueStyle: {
                        dialogueRatio: 0, promptWordPreference: [], avgDialogueLength: 0,
                        lengthDistribution: { short: 0, medium: 0, long: 0 },
                    },
                    paragraphStructure: {
                        avgParagraphLength: 0, medianParagraphLength: 0,
                        lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
                        openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 },
                    },
                    overallStyle: {
                        primaryStyle: 'unknown', confidence: 0, styleScores: {},
                    },
                    stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 },
                };
            case 'rhythm':
                return {
                    emotionCurve: [],
                    emotionPoints: [],
                    plotStages: [],
                    structureMatches: [],
                    coolPoints: [],
                    mainThreadSwitches: [],
                    stats: {
                        avgRhythm: 0, rhythmVariance: 0, climaxCount: 0,
                        coolPointCount: 0, avgEmotionIntensity: 0,
                    },
                };
            case 'technique':
                return {
                    techniques: [],
                    categoryDistribution: { structure: 0, cool_point: 0, emotion: 0, rhythm: 0, genre: 0, style: 0 },
                    topTechniques: [],
                    stats: { totalTechniques: 0, totalExamples: 0, avgConfidence: 0 },
                };
            case 'structure':
                return {
                    qcchSegments: [],
                    rhythmUnits: [],
                    threeLineStructure: {
                        mainLine: { description: '', keyNodes: [] },
                        subLine: { description: '', keyNodes: [] },
                        romanceLine: { description: '', keyNodes: [] },
                    },
                    structureType: '',
                    stats: { volumeCount: 0, chapterCount: 0, avgChapterWordCount: 0, totalWordCount: 0 },
                };
            case 'character':
                return {
                    characters: [],
                    relations: [],
                    stats: { totalCharacters: 0, mainCharacterCount: 0, avgAppearancePerCharacter: 0 },
                };
            case 'foreshadow':
                return {
                    foreshadows: [],
                    typeDistribution: { character: 0, item: 0, skill: 0, setting: 0, event: 0 },
                    stats: { totalForeshadows: 0, resolvedCount: 0, unresolvedCount: 0, avgImportance: 0 },
                    timeline: [],
                };
            case 'commercial':
                return {
                    goldenThreeChapters: {
                        totalScore: 0,
                        subScores: { openingConflict: 0, infoDensity: 0, protagonistGoal: 0, goldenFinger: 0, chapterHooks: 0 },
                        improvementSuggestions: [],
                        details: {
                            firstChapter: { wordCount: 0, conflictDensity: 0, hookStrength: 0, infoOverloadRisk: false },
                            secondChapter: { wordCount: 0, goalClarity: 0, goldenFingerHint: false, hookStrength: 0 },
                            thirdChapter: { wordCount: 0, miniClimax: false, goldenFingerReveal: false, hookStrength: 0 },
                        },
                    },
                    waveRhythm: { complianceRate: 0, smallCoolPointInterval: 0, mediumReversalInterval: 0, bigClimaxInterval: 0, violations: [] },
                    overallScore: 0,
                    overallLevel: 'D',
                };
            case 'readability':
                return {
                    showTell: {
                        overallRatio: 0, showPercentage: 0, tellPercentage: 0,
                        segments: [], highRiskTellSegments: [],
                        stats: { totalSegments: 0, showCount: 0, tellCount: 0, mixedCount: 0, avgShowScore: 0 },
                        suggestions: [],
                    },
                    aiTrace: {
                        overallScore: 0, level: 'low',
                        dimensions: {
                            sentenceSimilarity: { score: 0, description: '', details: {} },
                            connectorDensity: { score: 0, description: '', details: {} },
                            explanatoryEnding: { score: 0, description: '', details: {} },
                            parallelismAbuse: { score: 0, description: '', details: {} },
                            wordRepetition: { score: 0, description: '', details: {} },
                            emotionUniformity: { score: 0, description: '', details: {} },
                        },
                        highRiskParagraphs: [],
                    },
                    overallScore: 0,
                };
            default:
                return {} as AnalysisResult;
        }
    }
}
