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
import type { DeconstructDimension } from './deconstruction-worker-manager';
import { createLogger } from '@/shared/logger';


const log = createLogger('IncrementalResultAggregator');
/**
 * 整体分析结果。
 */
export type AnalysisResult =
    | StyleAnalysisResult
    | RhythmAnalysisResult
    | TechniqueAnalysisResult
    | StructureAnalysisResult
    | CharacterAnalysisResult
    | ForeshadowAnalysisResult
    | CommercialAnalysisResult
    | ReadabilityAnalysisResult;

/**
 * 部分结果。
 */
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

/**
 * 增量结果聚合器。
 */
export class IncrementalResultAggregator {
    private partialResults: Map<DeconstructDimension, PartialResult> = new Map();
    private callbacks: Set<PartialResultCallback> = new Set();
    private lastCallbackTimes: Map<DeconstructDimension, number> = new Map();
    private lastProgress: Map<DeconstructDimension, number> = new Map();
    private options: Required<AggregatorOptions>;

    constructor(options: AggregatorOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 添加分段结果。
     *
     * @param dimension - 维度
     * @param segmentResult - 分段结果
     * @param segmentIndex - 分段索引
     * @param totalSegments - 总分段数
     */
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

    /**
     * 标记维度完成。
     *
     * @param dimension - 维度
     */
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

    /**
     * 取部分结果。
     *
     * @param dimension - 维度
     * @returns 结果
     */
    getPartialResult(dimension: DeconstructDimension): PartialResult | undefined {
        return this.partialResults.get(dimension);
    }

    /**
     * 取全部部分结果。
     * @returns 结果集
     */
    getAllPartialResults(): PartialResult[] {
        return Array.from(this.partialResults.values());
    }

    /**
     * 订阅部分结果。
     *
     * @param callback - 回调
     * @returns 取消订阅
     */
    onPartialResult(callback: PartialResultCallback): () => void {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }

    /**
     * 清空聚合。
     */
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

        const first = results[0];
        log.info(`[aggregate] 维度 ${dimension} 合并 ${results.length} 段结果`);
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

        const weights = this.buildSegmentWeights(results.map(r => r.stats?.totalChars ?? 0));

        return {
            sentenceRhythm: this.averageSentenceRhythm(results.map(r => r.sentenceRhythm), weights),
            wordPreference: this.mergeWordPreference(results.map(r => r.wordPreference), weights),
            narrativeStyle: this.mergeNarrativeStyle(results.map(r => r.narrativeStyle), weights),
            rhetoric: this.mergeRhetoric(results.map(r => r.rhetoric), totalChars),
            dialogueStyle: this.mergeDialogueStyle(results.map(r => r.dialogueStyle), weights),
            paragraphStructure: this.mergeParagraphStructure(results.map(r => r.paragraphStructure), weights),
            overallStyle: this.mergeOverallStyle(results.map(r => r.overallStyle), weights),
            stats: {
                totalChars,
                totalSentences,
                totalParagraphs,
            },
        };
    }

    /**
     * A1 复合权重：字符占比 × 数据完整度。
     * @param charCounts 各段字符数
     * @param completeness 可选，各段数据完整度（0..1）；缺省视为 1（完整）。
     * 空段（charCount<=0）或完整度为 0 的段获得 0 权重；全部为 0 时回退等权。
     */
    private buildSegmentWeights(charCounts: number[], completeness?: number[]): number[] {
        const raw = charCounts.map((c, i) => {
            const chars = c > 0 ? c : 0;
            const comp = completeness ? Math.max(0, Math.min(1, completeness[i] ?? 0)) : 1;
            return chars * comp;
        });
        const total = raw.reduce((sum, v) => sum + v, 0);
        if (total <= 0) {
            const n = charCounts.length || 1;
            return charCounts.map(() => 1 / n);
        }
        return raw.map(v => v / total);
    }

    private weightedAvg(values: number[], weights: number[]): number {
        let sum = 0;
        let wSum = 0;
        for (let i = 0; i < values.length; i++) {
            const w = weights[i] ?? 0;
            sum += (values[i] ?? 0) * w;
            wSum += w;
        }
        return wSum > 0 ? sum / wSum : 0;
    }

    /**
     * A2 合并置信度模型。
     * 返回置信度加权均值 value，以及合并置信度 confidence：
     *   confidence = weightedMeanConfidence × (1 - dispersionPenalty) × corroborationBoost
     * - 一致性不降级：加权变异系数(cv)→0 时 penalty→0，confidence ≥ 加权均值置信度；
     * - 冲突有惩罚：cv 越大 penalty 越大（上限 0.6）；
     * - 多段佐证增益：有效段越多轻微提升（上限 1.15）。
     * @param values 各段取值
     * @param weights 各段权重（未归一亦可）
     * @param perSegConfidence 可选，各段自身置信度（0..1）；缺省视为 1。
     */
    private combineConfidence(
        values: number[],
        weights: number[],
        perSegConfidence?: number[]
    ): { value: number; confidence: number } {
        const idx = values.map((_, i) => i).filter(i => (weights[i] ?? 0) > 0);
        if (idx.length === 0) {
            return { value: 0, confidence: 0 };
        }
        const wSum = idx.reduce((s, i) => s + (weights[i] ?? 0), 0);
        const value = idx.reduce((s, i) => s + (values[i] ?? 0) * (weights[i] ?? 0), 0) / wSum;

        const meanConf = idx.reduce(
            (s, i) => s + (perSegConfidence ? Math.max(0, Math.min(1, perSegConfidence[i] ?? 0)) : 1) * (weights[i] ?? 0),
            0
        ) / wSum;

        const variance = idx.reduce(
            (s, i) => s + (weights[i] ?? 0) * Math.pow((values[i] ?? 0) - value, 2),
            0
        ) / wSum;
        const std = Math.sqrt(variance);
        const cv = Math.abs(value) > 1e-9 ? std / Math.abs(value) : (std > 1e-9 ? 1 : 0);
        const dispersionPenalty = Math.min(0.6, cv);

        const effectiveN = idx.length;
        const corroborationBoost = effectiveN <= 1 ? 1 : Math.min(1.15, 1 + 0.05 * Math.log2(effectiveN));

        const confidence = Math.max(0, Math.min(1, meanConf * (1 - dispersionPenalty) * corroborationBoost));
        return { value, confidence };
    }

    /**
     * A3 池化标准差：合并各段的均值/标准差，正确计入段间方差。
     * pooledVar = Σw_i(σ_i² + μ_i²) / Σw_i − μ² ，其中 μ 为加权总均值。
     */
    private pooledStd(means: number[], stds: number[], weights: number[]): number {
        const idx = means.map((_, i) => i).filter(i => (weights[i] ?? 0) > 0);
        if (idx.length === 0) return 0;
        const wSum = idx.reduce((s, i) => s + (weights[i] ?? 0), 0);
        const grandMean = idx.reduce((s, i) => s + (means[i] ?? 0) * (weights[i] ?? 0), 0) / wSum;
        const secondMoment = idx.reduce((s, i) => {
            const w = weights[i] ?? 0;
            const mu = means[i] ?? 0;
            const sd = stds[i] ?? 0;
            return s + w * (sd * sd + mu * mu);
        }, 0) / wSum;
        const pooledVar = Math.max(0, secondMoment - grandMean * grandMean);
        return Math.sqrt(pooledVar);
    }

    /**
     * A3 分布桶重建中位数：用各段分布桶按权重合并后，
     * 在累计分布上定位中位数所在桶，避免"各段中位数直接平均"的错误。
     * @param buckets 各段的分布桶（键 → 占比/计数）
     * @param repValues 每个桶键对应的代表值（用于排序与取值）
     * @param weights 各段权重
     */
    private weightedMedianFromBuckets(
        buckets: Array<Record<string, number>>,
        repValues: Record<string, number>,
        weights: number[]
    ): number {
        const keys = Object.keys(repValues);
        const agg: Record<string, number> = {};
        for (const k of keys) agg[k] = 0;
        let total = 0;
        buckets.forEach((b, i) => {
            const w = weights[i] ?? 0;
            if (w <= 0) return;
            for (const k of keys) {
                const c = (b?.[k] ?? 0) * w;
                agg[k] += c;
                total += c;
            }
        });
        if (total <= 0) return 0;
        const ordered = keys.slice().sort((a, b) => repValues[a] - repValues[b]);
        const half = total / 2;
        let cum = 0;
        for (const k of ordered) {
            cum += agg[k];
            if (cum >= half) return repValues[k];
        }
        return repValues[ordered[ordered.length - 1]];
    }

    /**
     * A3 速率重算：速率类字段一律用"总量 / 总规模 × 单位"重算，
     * 避免对各段速率取简单平均导致的口径不一致。
     */
    private recomputeRate(totalCount: number, totalScale: number, perUnit = 1000): number {
        if (totalScale <= 0) return 0;
        return (totalCount / totalScale) * perUnit;
    }

    private combineRhythmResults(results: RhythmAnalysisResult[]): RhythmAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('rhythm') as RhythmAnalysisResult;
        }
        if (results.length === 1) {
            return results[0];
        }

        const emotionCurve = results.flatMap(r => r.emotionCurve ?? []);
        const emotionPoints = results.flatMap(r => r.emotionPoints ?? []);
        const plotStages = results.flatMap(r => r.plotStages ?? []);
        const structureMatches = results.flatMap(r => r.structureMatches ?? []);
        const coolPoints = results.flatMap(r => r.coolPoints ?? []);
        const mainThreadSwitches = results.flatMap(r => r.mainThreadSwitches ?? []);
        const hooks = results.flatMap(r => r.hooks ?? []);

        // 权重基准：各段 emotionCurve 长度（内容体量代理），缺失时等权
        const weights = this.buildSegmentWeights(results.map(r => (r.emotionCurve?.length ?? 0)));

        const climaxCount = results.reduce((sum, r) => sum + (r.stats?.climaxCount ?? 0), 0);
        const coolPointCount = results.reduce((sum, r) => sum + (r.stats?.coolPointCount ?? 0), 0);
        const avgRhythm = this.round2(
            this.weightedAvg(results.map(r => r.stats?.avgRhythm ?? 0), weights)
        );
        // rhythmVariance 存的是方差；用 pooledStd（含段间方差）后平方回方差口径
        const pooledStdRhythm = this.pooledStd(
            results.map(r => r.stats?.avgRhythm ?? 0),
            results.map(r => Math.sqrt(Math.max(0, r.stats?.rhythmVariance ?? 0))),
            weights
        );
        const rhythmVariance = this.round2(pooledStdRhythm * pooledStdRhythm);
        const avgEmotionIntensity = this.round2(
            this.weightedAvg(results.map(r => r.stats?.avgEmotionIntensity ?? 0), weights)
        );

        const last = results[results.length - 1];
        return {
            ...last,
            emotionCurve,
            emotionPoints,
            plotStages,
            structureMatches,
            coolPoints,
            mainThreadSwitches,
            hooks: hooks.length > 0 ? hooks : last.hooks,
            stats: {
                ...last.stats,
                avgRhythm,
                rhythmVariance,
                climaxCount,
                coolPointCount,
                avgEmotionIntensity,
            },
        };
    }

    private combineTechniqueResults(results: TechniqueAnalysisResult[]): TechniqueAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('technique') as TechniqueAnalysisResult;
        }
        type TechniqueT = TechniqueAnalysisResult['techniques'][number];
        const merged = new Map<string, TechniqueT>();
        const qualityWeightAcc = new Map<string, { sum: number; w: number }>();
        for (const r of results) {
            for (const t of r.techniques ?? []) {
                const key = t.id || t.name;
                const prev = merged.get(key);
                if (!prev) {
                    merged.set(key, { ...t, examples: [...(t.examples ?? [])] });
                    if (t.qualityScore != null) {
                        qualityWeightAcc.set(key, { sum: t.qualityScore * Math.max(1, t.count ?? 1), w: Math.max(1, t.count ?? 1) });
                    }
                    continue;
                }
                const prevCount = prev.count ?? 0;
                const curCount = t.count ?? 0;
                const totalCount = prevCount + curCount;
                prev.count = totalCount;
                prev.confidence = totalCount > 0
                    ? this.round2((prev.confidence * prevCount + t.confidence * curCount) / totalCount)
                    : Math.max(prev.confidence, t.confidence);
                // qualityScore：按 count 加权累计，消除 (prev+cur)/2 的分段顺序依赖
                if (t.qualityScore != null) {
                    if (prev.qualityScore != null) {
                        const qw = qualityWeightAcc.get(key) ?? { sum: prev.qualityScore * prevCount, w: prevCount };
                        qw.sum += t.qualityScore * curCount;
                        qw.w += curCount;
                        qualityWeightAcc.set(key, qw);
                        prev.qualityScore = qw.w > 0 ? this.round2(qw.sum / qw.w) : t.qualityScore;
                    } else {
                        prev.qualityScore = t.qualityScore;
                        qualityWeightAcc.set(key, { sum: t.qualityScore * Math.max(1, curCount), w: Math.max(1, curCount) });
                    }
                }
                prev.examples = [...(prev.examples ?? []), ...(t.examples ?? [])].slice(0, 20);
            }
        }

        const techniques = Array.from(merged.values());
        const categoryDistribution = { structure: 0, cool_point: 0, emotion: 0, rhythm: 0, genre: 0, style: 0 } as TechniqueAnalysisResult['categoryDistribution'];
        for (const t of techniques) {
            categoryDistribution[t.category] = (categoryDistribution[t.category] ?? 0) + 1;
        }
        const topTechniques = [...techniques]
            .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            .slice(0, 10);

        const totalTechniques = techniques.length;
        const totalExamples = techniques.reduce((sum, t) => sum + (t.examples?.length ?? 0), 0);
        const avgConfidence = totalTechniques > 0
            ? this.round2(techniques.reduce((sum, t) => sum + (t.confidence ?? 0), 0) / totalTechniques)
            : 0;
        const qualityScores = techniques.map(t => t.qualityScore).filter((q): q is number => q != null);
        const avgQualityScore = qualityScores.length > 0
            ? this.round2(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
            : undefined;

        return {
            ...results[results.length - 1],
            techniques,
            categoryDistribution,
            topTechniques,
            stats: {
                ...results[results.length - 1].stats,
                totalTechniques,
                totalExamples,
                avgConfidence,
                avgQualityScore,
            },
            aggregation: {
                segmentCount: results.length,
                dataStatus: 'complete',
            },
        };
    }

    private combineStructureResults(results: StructureAnalysisResult[]): StructureAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('structure') as StructureAnalysisResult;
        }
        if (results.length === 1) {
            return results[0];
        }

        type RhythmUnitT = StructureAnalysisResult['rhythmUnits'][number];
        const mergedUnits = new Map<string, RhythmUnitT>();
        for (const r of results) {
            for (const u of r.rhythmUnits ?? []) {
                const key = `${u.level}::${u.title}::${u.startPosition}`;
                if (!mergedUnits.has(key)) {
                    mergedUnits.set(key, { ...u });
                }
            }
        }
        const volumes: RhythmUnitT[] = [];
        const chapters: RhythmUnitT[] = [];
        const sections: RhythmUnitT[] = [];
        for (const u of mergedUnits.values()) {
            if (u.level === 'volume') volumes.push(u);
            else if (u.level === 'chapter') chapters.push(u);
            else sections.push(u);
        }
        const rhythmUnits: RhythmUnitT[] = [];
        volumes.forEach((u, i) => rhythmUnits.push({ ...u, index: i + 1 }));
        chapters.forEach((u, i) => rhythmUnits.push({ ...u, index: i + 1 }));
        sections.forEach((u, i) => rhythmUnits.push({ ...u, index: i + 1 }));

        const totalWordCount = results.reduce((sum, r) => sum + (r.stats?.totalWordCount ?? 0), 0);
        const volumeCount = volumes.length;
        const chapterCount = chapters.length;
        const avgChapterWordCount = chapterCount > 0 ? Math.round(totalWordCount / chapterCount) : 0;

        const structureType = this.determineStructureTypeByUnits(volumeCount, chapterCount);

        const qcchSegments = results.flatMap(r => r.qcchSegments ?? []);
        const threeLineStructure = this.mergeThreeLineStructure(results.map(r => r.threeLineStructure));
        const templateMatch = this.pickBestTemplateMatch(results);
        const narrativeTemporality = this.mergeNarrativeTemporality(results.map(r => r.narrativeTemporality));

        return {
            qcchSegments,
            rhythmUnits,
            threeLineStructure,
            structureType,
            stats: { volumeCount, chapterCount, avgChapterWordCount, totalWordCount },
            narrativeTemporality,
            templateMatch,
        };
    }

    private determineStructureTypeByUnits(volumeCount: number, chapterCount: number): string {
        if (volumeCount >= 3 && chapterCount >= 50) return '长篇多卷结构';
        if (volumeCount >= 2 || chapterCount >= 30) return '中长篇结构';
        if (chapterCount >= 10) return '中篇结构';
        if (chapterCount >= 3) return '短篇分章结构';
        return '短篇单篇结构';
    }

    private mergeThreeLineStructure(
        lines: (StructureAnalysisResult['threeLineStructure'] | undefined)[]
    ): StructureAnalysisResult['threeLineStructure'] {
        const valid = lines.filter((l): l is StructureAnalysisResult['threeLineStructure'] => !!l);
        if (valid.length === 0) {
            return {
                mainLine: { description: '', keyNodes: [] },
                subLine: { description: '', keyNodes: [] },
                romanceLine: { description: '', keyNodes: [] },
            };
        }
        // 描述选择：按覆盖度（该线 keyNodes 数量）排序取最高，而非"取最长字符串"；
        // 覆盖度并列时以更长描述作次级依据。
        const pickDesc = (getter: (l: StructureAnalysisResult['threeLineStructure']) => { description: string; keyNodes?: unknown[] }) =>
            valid
                .map(getter)
                .filter(x => !!x.description)
                .sort((a, b) => {
                    const covA = (a.keyNodes?.length ?? 0);
                    const covB = (b.keyNodes?.length ?? 0);
                    if (covB !== covA) return covB - covA;
                    return (b.description?.length ?? 0) - (a.description?.length ?? 0);
                })[0]?.description ?? '';
        return {
            mainLine: {
                description: pickDesc(l => l.mainLine),
                keyNodes: valid.flatMap(l => l.mainLine.keyNodes ?? []),
            },
            subLine: {
                description: pickDesc(l => l.subLine),
                keyNodes: valid.flatMap(l => l.subLine.keyNodes ?? []),
            },
            romanceLine: {
                description: pickDesc(l => l.romanceLine),
                keyNodes: valid.flatMap(l => l.romanceLine.keyNodes ?? []),
            },
        };
    }

    private pickBestTemplateMatch(
        results: StructureAnalysisResult[]
    ): StructureAnalysisResult['templateMatch'] {
        let best: StructureAnalysisResult['templateMatch'] | undefined;
        for (const r of results) {
            const tm = r.templateMatch;
            if (!tm) continue;
            if (!best || (tm.bestMatch?.matchScore ?? 0) > (best.bestMatch?.matchScore ?? 0)) {
                best = tm;
            }
        }
        return best;
    }

    private mergeNarrativeTemporality(
        items: (StructureAnalysisResult['narrativeTemporality'] | undefined)[]
    ): StructureAnalysisResult['narrativeTemporality'] {
        const valid = items.filter((x): x is NonNullable<StructureAnalysisResult['narrativeTemporality']> => !!x);
        if (valid.length === 0) return undefined;
        if (valid.length === 1) return valid[0];

        const base = valid[0];
        const flashbacks = valid.flatMap(x => x.order?.flashbacks ?? []);
        const flashforwards = valid.flatMap(x => x.order?.flashforwards ?? []);
        // 置信度加权投票：按各段 order.confidence 累加，而非简单计票
        const orderVotes = new Map<string, number>();
        for (const x of valid) {
            const t = x.order?.type;
            if (t) orderVotes.set(t, (orderVotes.get(t) ?? 0) + (x.order?.confidence ?? 0.0001));
        }
        const dominantOrder = Array.from(orderVotes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
            ?? base.order.type;
        // 合并置信度走 A2：一致时不降级
        const matchFlags = valid.map(x => (x.order?.type === dominantOrder ? 1 : 0));
        const eqW = valid.map(() => 1);
        const avgConfidence = this.round2(
            this.combineConfidence(matchFlags, eqW, valid.map(x => x.order?.confidence ?? 0)).confidence
        );

        return {
            ...base,
            order: {
                type: dominantOrder as NonNullable<StructureAnalysisResult['narrativeTemporality']>['order']['type'],
                flashbacks,
                flashforwards,
                confidence: avgConfidence,
            },
        };
    }

    private combineCharacterResults(results: CharacterAnalysisResult[]): CharacterAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('character') as CharacterAnalysisResult;
        }
        // 注意：单段也走同一后处理（全局重判 role + 重算 importance），保证单/多段一致。

        type CharacterT = CharacterAnalysisResult['characters'][number];
        const nameToKey = new Map<string, string>();
        const merged = new Map<string, CharacterT>();
        // 按角色 key 记录 abilities/personality 的出现频次，用于按频次排序取前 N
        const abilityFreq = new Map<string, Map<string, number>>();
        const personalityFreq = new Map<string, Map<string, number>>();
        const relationshipDedup = new Map<string, Set<string>>();

        const resolveKey = (name: string, aliases: string[]): string => {
            const candidates = [name, ...(aliases ?? [])].filter(Boolean);
            for (const c of candidates) {
                const existing = nameToKey.get(c);
                if (existing) return existing;
            }
            const key = name;
            for (const c of candidates) {
                if (!nameToKey.has(c)) nameToKey.set(c, key);
            }
            return key;
        };

        const uniq = (arr: string[]): string[] => Array.from(new Set((arr ?? []).filter(Boolean)));

        const bumpFreq = (store: Map<string, Map<string, number>>, key: string, items: string[]) => {
            let m = store.get(key);
            if (!m) { m = new Map(); store.set(key, m); }
            for (const it of items ?? []) {
                if (!it) continue;
                m.set(it, (m.get(it) ?? 0) + 1);
            }
        };
        const topByFreq = (store: Map<string, Map<string, number>>, key: string, n: number): string[] => {
            const m = store.get(key);
            if (!m) return [];
            return Array.from(m.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, n)
                .map(([k]) => k);
        };
        const relKey = (rel: unknown): string => {
            const r = rel as { targetId?: string; targetName?: string; type?: string };
            return `${r?.targetId ?? r?.targetName ?? ''}::${r?.type ?? ''}`;
        };
        const dedupRelationships = (key: string, rels: CharacterT['relationships']): CharacterT['relationships'] => {
            let seen = relationshipDedup.get(key);
            if (!seen) { seen = new Set(); relationshipDedup.set(key, seen); }
            const out: CharacterT['relationships'] = [];
            for (const rel of rels ?? []) {
                const rk = relKey(rel);
                if (seen.has(rk)) continue;
                seen.add(rk);
                out.push(rel);
            }
            return out;
        };

        for (const r of results) {
            for (const c of r.characters ?? []) {
                const key = resolveKey(c.name, c.aliases ?? []);
                bumpFreq(abilityFreq, key, c.abilities ?? []);
                bumpFreq(personalityFreq, key, c.personality ?? []);
                const prev = merged.get(key);
                if (!prev) {
                    merged.set(key, {
                        ...c,
                        aliases: uniq(c.aliases ?? []),
                        abilities: uniq(c.abilities ?? []),
                        personality: uniq(c.personality ?? []),
                        relationships: dedupRelationships(key, c.relationships ?? []),
                    });
                    continue;
                }
                prev.appearanceCount = (prev.appearanceCount ?? 0) + (c.appearanceCount ?? 0);
                prev.mentionCount = (prev.mentionCount ?? 0) + (c.mentionCount ?? 0);
                prev.firstAppearance = Math.min(prev.firstAppearance ?? 1, c.firstAppearance ?? 1);
                prev.lastAppearance = Math.max(prev.lastAppearance ?? 0, c.lastAppearance ?? 0);
                prev.aliases = uniq([...(prev.aliases ?? []), ...(c.aliases ?? [])]);
                prev.personality = uniq([...(prev.personality ?? []), ...(c.personality ?? [])]);
                prev.growthStages = [...(prev.growthStages ?? []), ...(c.growthStages ?? [])];
                prev.relationships = [...(prev.relationships ?? []), ...dedupRelationships(key, c.relationships ?? [])];
                if (!prev.background && c.background) prev.background = c.background;
                if (c.dialogueCount) prev.dialogueCount = (prev.dialogueCount ?? 0) + c.dialogueCount;
                if (c.perspectiveCount) prev.perspectiveCount = (prev.perspectiveCount ?? 0) + c.perspectiveCount;
                if (c.keyEventCount) prev.keyEventCount = (prev.keyEventCount ?? 0) + c.keyEventCount;
            }
        }

        // abilities 按出现频次排序取前 N（不再是"合并后截断前 10"）
        for (const [key, c] of merged.entries()) {
            const topAbilities = topByFreq(abilityFreq, key, 10);
            if (topAbilities.length > 0) c.abilities = topAbilities;
            const topPersonality = topByFreq(personalityFreq, key, 12);
            if (topPersonality.length > 0) c.personality = topPersonality;
        }

        const characters = Array.from(merged.values())
            .sort((a, b) => (b.appearanceCount ?? 0) - (a.appearanceCount ?? 0));

        this.recomputeImportanceFromGlobalStats(characters);
        this.recomputeRolesFromGlobalStats(characters);

        const totalCharacters = characters.length;
        const totalAppearance = characters.reduce((sum, c) => sum + (c.appearanceCount ?? 0), 0);
        const avgAppearancePerCharacter = totalCharacters > 0
            ? this.round2(totalAppearance / totalCharacters)
            : 0;
        const mainCharacterCount = characters.filter(
            c => c.role === 'protagonist' || c.role === 'deuteragonist'
        ).length;

        const relations = this.mergeCharacterRelations(results.flatMap(r => r.relations ?? []));
        const mainCharacter = characters[0];

        return {
            ...results[results.length - 1],
            characters,
            mainCharacter,
            relations,
            stats: {
                totalCharacters,
                mainCharacterCount,
                avgAppearancePerCharacter,
            },
        };
    }

    private mergeCharacterRelations(
        relations: CharacterAnalysisResult['relations']
    ): CharacterAnalysisResult['relations'] {
        const map = new Map<string, CharacterAnalysisResult['relations'][number]>();
        for (const rel of relations) {
            const key = `${rel.fromId}->${rel.toId}::${rel.type}`;
            const prev = map.get(key);
            if (!prev) {
                map.set(key, { ...rel });
            } else {
                prev.weight = (prev.weight ?? 0) + (rel.weight ?? 0);
            }
        }
        return Array.from(map.values());
    }

    private combineForeshadowResults(results: ForeshadowAnalysisResult[]): ForeshadowAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('foreshadow') as ForeshadowAnalysisResult;
        }
        type ForeshadowT = ForeshadowAnalysisResult['foreshadows'][number];
        const merged = new Map<string, ForeshadowT>();
        // 跨段去重：按"归一化 name + type"（分段 id 为段内局部生成，无法跨段对齐）
        const normName = (name: string): string =>
            (name ?? '').trim().toLowerCase().replace(/\s+/g, '');
        for (const r of results) {
            for (const f of r.foreshadows ?? []) {
                const key = `${f.type}::${normName(f.name)}`;
                const prev = merged.get(key);
                if (!prev) {
                    merged.set(key, { ...f });
                    continue;
                }
                prev.totalAppearances = (prev.totalAppearances ?? 0) + (f.totalAppearances ?? 0);
                prev.importance = Math.max(prev.importance ?? 0, f.importance ?? 0);
                prev.importantAppearances = [
                    ...(prev.importantAppearances ?? []),
                    ...(f.importantAppearances ?? []),
                ];
                if (!prev.firstAppearance || (f.firstAppearance && f.firstAppearance.position < prev.firstAppearance.position)) {
                    prev.firstAppearance = f.firstAppearance;
                }
                if (!prev.resolution && f.resolution) {
                    prev.resolution = f.resolution;
                }
            }
        }

        const foreshadows = Array.from(merged.values())
            .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));

        const typeDistribution = { item: 0, skill: 0, character: 0, setting: 0, event: 0 } as ForeshadowAnalysisResult['typeDistribution'];
        for (const f of foreshadows) {
            typeDistribution[f.type] = (typeDistribution[f.type] ?? 0) + 1;
        }
        const resolvedCount = foreshadows.filter(f => !!f.resolution).length;
        const unresolvedCount = foreshadows.length - resolvedCount;
        const avgImportance = foreshadows.length > 0
            ? this.round2(foreshadows.reduce((sum, f) => sum + (f.importance ?? 0), 0) / foreshadows.length)
            : 0;

        const timeline = results.flatMap(r => r.timeline ?? []);
        const semanticPairs = results.flatMap(r => r.semanticPairs ?? []);

        return {
            ...results[results.length - 1],
            foreshadows,
            typeDistribution,
            stats: {
                totalForeshadows: foreshadows.length,
                resolvedCount,
                unresolvedCount,
                avgImportance,
            },
            timeline,
            semanticPairs: semanticPairs.length > 0 ? semanticPairs : results[results.length - 1].semanticPairs,
        };
    }

    private combineCommercialResults(results: CommercialAnalysisResult[]): CommercialAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('commercial') as CommercialAnalysisResult;
        }
        const first = results[0];

        // overallScore: 等权平均。
        // 注：CommercialAnalysisResult 不携带各段字符数，无法做字符加权；
        // 若后续在结果中透出段长，可在此升级为 weightedAvg。等权平均对"各段体量相近"的分段策略是合理近似。
        let avgOverallScore = this.round2(
            results.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) / results.length
        );

        // 回退：仅当"真实全 0"（所有段 overallScore 都≈0）时才保守兜底，
        // 不再对"偏低但非 0"的有效评分粗暴抬升，避免抹平区分度（承接审计 REG-2）。
        const allSegZero = results.every(r => (r.overallScore ?? 0) < 1);
        let usedFallback = false;
        if (allSegZero) {
            const fallbackScore = 50;
            log.info('商业价值各段评分均≈0，启用保守兜底：' + fallbackScore);
            avgOverallScore = fallbackScore;
            usedFallback = true;
        }

        // goldenThreeChapters: 黄金三章本就是"开篇"分析，取覆盖开篇的第一段在语义上正确。
        let goldenThreeChapters = first.goldenThreeChapters;

        // 回退：若 goldenThreeChapters 全 0 且确为真实全 0，给保守估值
        if (goldenThreeChapters.totalScore === 0 && usedFallback) {
            const fallbackGolden = {
                ...goldenThreeChapters,
                totalScore: 50,
                subScores: {
                    openingConflict: goldenThreeChapters.subScores.openingConflict || 30,
                    infoDensity: goldenThreeChapters.subScores.infoDensity || 50,
                    protagonistGoal: goldenThreeChapters.subScores.protagonistGoal || 30,
                    goldenFinger: goldenThreeChapters.subScores.goldenFinger || 30,
                    chapterHooks: goldenThreeChapters.subScores.chapterHooks || 30,
                    characterImmersion: (goldenThreeChapters.subScores as any).characterImmersion || 25,
                    worldviewAttraction: (goldenThreeChapters.subScores as any).worldviewAttraction || 35,
                    dialogueQuality: (goldenThreeChapters.subScores as any).dialogueQuality || 40,
                    suspenseIntensity: (goldenThreeChapters.subScores as any).suspenseIntensity || 30,
                    emotionalImpact: (goldenThreeChapters.subScores as any).emotionalImpact || 20,
                },
            };
            log.info('goldenThreeChapters 全 0，回退为保守估值');
            goldenThreeChapters = fallbackGolden;
        }

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

        // globalAnalysis: 跨块合并——等权平均各维度
        let globalAnalysis: CommercialAnalysisResult['globalAnalysis'] = first.globalAnalysis;
        if (first.globalAnalysis) {
            const globalCount = results.filter(r => r.globalAnalysis).length;
            if (globalCount > 0) {
                const avgRhythmBalance = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.rhythmBalance ?? 0), 0) / globalCount
                );
                const avgEmotionalFluctuation = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.emotionalFluctuation ?? 0), 0) / globalCount
                );
                const avgWorldviewCompleteness = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.worldviewCompleteness ?? 0), 0) / globalCount
                );
                const avgCharacterDiversity = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.characterDiversity ?? 0), 0) / globalCount
                );
                const avgPlotDensity = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.plotDensity ?? 0), 0) / globalCount
                );
                const avgReaderRetention = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.readerRetention ?? 0), 0) / globalCount
                );
                const avgIpValue = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.ipValue ?? 0), 0) / globalCount
                );
                const avgMarketCompetitiveness = this.round2(
                    results.reduce((sum, r) => sum + (r.globalAnalysis?.marketCompetitiveness ?? 0), 0) / globalCount
                );

                globalAnalysis = {
                    rhythmBalance: avgRhythmBalance,
                    emotionalFluctuation: avgEmotionalFluctuation,
                    worldviewCompleteness: avgWorldviewCompleteness,
                    characterDiversity: avgCharacterDiversity,
                    plotDensity: avgPlotDensity,
                    readerRetention: avgReaderRetention,
                    ipValue: avgIpValue,
                    marketCompetitiveness: avgMarketCompetitiveness,
                    subScores: {
                        rhythmBalance: avgRhythmBalance,
                        emotionalFluctuation: avgEmotionalFluctuation,
                        worldviewCompleteness: avgWorldviewCompleteness,
                        characterDiversity: avgCharacterDiversity,
                        plotDensity: avgPlotDensity
                    }
                };
            }
        }

        // level 根据平均分重新计算（与 CommercialDeconstructor.calculateOverallLevel 一致）
        const overallLevel = this.calculateCommercialLevel(avgOverallScore);

        let wordCount: CommercialAnalysisResult['wordCount'];
        const firstWithWordCount = results.find(r => r.wordCount);
        if (firstWithWordCount?.wordCount) {
            wordCount = {
                total: results.reduce((sum, r) => sum + (r.wordCount?.total ?? 0), 0),
                chineseOnly: results.reduce((sum, r) => sum + (r.wordCount?.chineseOnly ?? 0), 0),
                platformStyle: results.reduce((sum, r) => sum + (r.wordCount?.platformStyle ?? 0), 0),
            };
        }

        return {
            goldenThreeChapters,
            waveRhythm,
            globalAnalysis,
            overallScore: avgOverallScore,
            overallLevel,
            wordCount,
            aggregation: {
                segmentCount: results.length,
                weightingStrategy: 'equal',
                dataStatus: 'complete',
            },
        };
    }

    private combineReadabilityResults(results: ReadabilityAnalysisResult[]): ReadabilityAnalysisResult {
        if (results.length === 0) {
            return this.createEmptyResult('readability') as ReadabilityAnalysisResult;
        }
        // overallScore: 按段落数加权（段落数为内容体量代理），比等权更贴近全局
        const overallWeights = this.buildSegmentWeights(
            results.map(r => r.showTell?.stats?.totalSegments ?? 0)
        );
        const avgOverallScore = this.round2(
            this.weightedAvg(results.map(r => r.overallScore ?? 0), overallWeights)
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

        // aiTrace: 各维度按段落数加权平均，说明取代表性（得分最高）段
        const dimensionKeys = ['sentenceSimilarity', 'connectorDensity', 'explanatoryEnding', 'parallelismAbuse', 'wordRepetition', 'emotionUniformity'] as const;

        const segWeights = this.buildSegmentWeights(
            results.map(r => r.showTell?.stats?.totalSegments ?? 0)
        );

        const averagedDims: Record<string, {
            score: number;
            description: string;
            details: Record<string, number>;
            dataStatus?: 'complete' | 'insufficient' | 'estimated';
        }> = {};
        for (const key of dimensionKeys) {
            const scores = results.map(r => r.aiTrace?.dimensions?.[key]?.score ?? 0);
            const avgScore = this.round2(this.weightedAvg(scores, segWeights));
            // 代表 description：选"得分最接近加权均值"的段（而非最高分段），
            // 使展示的说明与聚合分数一致，避免以极端段说明代表整体。
            let bestIdx = 0;
            let bestDelta = Infinity;
            results.forEach((r, i) => {
                const dim = r.aiTrace?.dimensions?.[key];
                if (!dim?.description) return;
                const delta = Math.abs((dim.score ?? 0) - avgScore);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    bestIdx = i;
                }
            });
            const repDim = results[bestIdx]?.aiTrace?.dimensions?.[key];
            averagedDims[key] = {
                score: avgScore,
                description: repDim?.description ?? '',
                details: repDim?.details ?? {},
                dataStatus: repDim?.dataStatus,
            };
        }

        // 零值处理修正：score===0 在这两个维度是"合法低分"（句式多变/情感分布自然），
        // 不应一律用规则估算覆盖。仅当所有段都因"数据不足"而无法计算时才给保守估算，
        // 避免把优质写作的低 AI 痕迹误判为需要兜底（承接审计 BUG-3）。
        const allInsufficient = (key: 'sentenceSimilarity' | 'emotionUniformity'): boolean =>
            results.every(r => r.aiTrace?.dimensions?.[key]?.dataStatus === 'insufficient');

        if (averagedDims.sentenceSimilarity && averagedDims.sentenceSimilarity.score === 0 && allInsufficient('sentenceSimilarity')) {
            const longParagraphRatio = showTell.segments.length > 0
                ? showTell.segments.filter(s => (s.endIndex - s.startIndex) > 200).length / showTell.segments.length
                : 0.3;
            averagedDims.sentenceSimilarity.score = Math.round(Math.min(60, longParagraphRatio * 50 + 10));
            averagedDims.sentenceSimilarity.description = '句式相似度（数据不足，规则估算）';
            averagedDims.sentenceSimilarity.dataStatus = 'estimated';
        }

        if (averagedDims.emotionUniformity && averagedDims.emotionUniformity.score === 0 && allInsufficient('emotionUniformity')) {
            const tellRatio = showTell.tellPercentage / 100 || 0.3;
            averagedDims.emotionUniformity.score = Math.round(Math.min(50, tellRatio * 40 + 5));
            averagedDims.emotionUniformity.description = '情感均匀度（数据不足，规则估算）';
            averagedDims.emotionUniformity.dataStatus = 'estimated';
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
            aggregation: {
                segmentCount: results.length,
                dataStatus: Object.values(averagedDims).some(d => d.dataStatus === 'estimated') ? 'partial' : 'complete',
            },
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

    private averageSentenceRhythm(rhythms: (StyleAnalysisResult['sentenceRhythm'] | undefined)[], weights?: number[]): StyleAnalysisResult['sentenceRhythm'] {
        const validPairs = rhythms
            .map((r, i) => ({ r, w: weights?.[i] ?? 1 }))
            .filter((p): p is { r: StyleAnalysisResult['sentenceRhythm']; w: number } => p.r !== undefined);
        const count = validPairs.length;
        if (count === 0) return { avgSentenceLength: 0, medianSentenceLength: 0, stdSentenceLength: 0, sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 }, lengthDistribution: { short: 0, medium: 0, long: 0 } };

        const validRhythms = validPairs.map(p => p.r);
        const w = validPairs.map(p => p.w);
        const wa = (getter: (r: StyleAnalysisResult['sentenceRhythm']) => number) =>
            this.weightedAvg(validRhythms.map(getter), w);

        // stdSentenceLength: 池化标准差（含段间方差），避免直接平均各段标准差
        const pooledStdSentence = this.pooledStd(
            validRhythms.map(r => r.avgSentenceLength ?? 0),
            validRhythms.map(r => r.stdSentenceLength ?? 0),
            w
        );
        // medianSentenceLength: 由长度分布桶重建，避免"各段中位数平均"
        const SENTENCE_LEN_REP = { short: 5, medium: 20, long: 40 };
        const medianSentence = this.weightedMedianFromBuckets(
            validRhythms.map(r => ({
                short: r.lengthDistribution?.short ?? 0,
                medium: r.lengthDistribution?.medium ?? 0,
                long: r.lengthDistribution?.long ?? 0,
            })),
            SENTENCE_LEN_REP,
            w
        );

        return {
            avgSentenceLength: wa(r => r.avgSentenceLength ?? 0),
            medianSentenceLength: medianSentence || wa(r => r.medianSentenceLength ?? 0),
            stdSentenceLength: pooledStdSentence,
            sentenceTypeDistribution: {
                declarative: wa(r => r.sentenceTypeDistribution?.declarative ?? 0),
                interrogative: wa(r => r.sentenceTypeDistribution?.interrogative ?? 0),
                exclamatory: wa(r => r.sentenceTypeDistribution?.exclamatory ?? 0),
                elliptical: wa(r => r.sentenceTypeDistribution?.elliptical ?? 0),
            },
            lengthDistribution: {
                short: wa(r => r.lengthDistribution?.short ?? 0),
                medium: wa(r => r.lengthDistribution?.medium ?? 0),
                long: wa(r => r.lengthDistribution?.long ?? 0),
            },
            dominantVectorStyle: this.weightedDominantVectorStyle(validRhythms, w),
            vectorStyleScores: this.mergeVectorStyleScores(validRhythms, w),
        };
    }

    private weightedDominantVectorStyle(rhythms: StyleAnalysisResult['sentenceRhythm'][], weights: number[]): string | undefined {
        const tally = new Map<string, number>();
        rhythms.forEach((r, i) => {
            const style = r.dominantVectorStyle;
            if (style) tally.set(style, (tally.get(style) ?? 0) + (weights[i] ?? 0));
        });
        if (tally.size === 0) return undefined;
        return Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    private mergeVectorStyleScores(rhythms: StyleAnalysisResult['sentenceRhythm'][], weights: number[]): Record<string, number> | undefined {
        const acc = new Map<string, number>();
        let hasAny = false;
        rhythms.forEach((r, i) => {
            const scores = r.vectorStyleScores;
            if (!scores) return;
            hasAny = true;
            const w = weights[i] ?? 0;
            for (const [k, v] of Object.entries(scores)) {
                acc.set(k, (acc.get(k) ?? 0) + v * w);
            }
        });
        if (!hasAny) return undefined;
        const out: Record<string, number> = {};
        for (const [k, v] of acc.entries()) out[k] = this.round2(v);
        return out;
    }

    private recomputeRolesFromGlobalStats(characters: CharacterAnalysisResult['characters']): void {
        if (characters.length === 0) return;
        const topAppear = Math.max(1, ...characters.map(c => c.appearanceCount ?? 0));
        const topDialogue = Math.max(1, ...characters.map(c => c.dialogueCount ?? 0));
        const topPerspective = Math.max(1, ...characters.map(c => c.perspectiveCount ?? 0));
        const topKeyEvents = Math.max(1, ...characters.map(c => c.keyEventCount ?? 0));

        let bestIdx = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < characters.length; i++) {
            const c = characters[i];
            const appearScore = (c.appearanceCount ?? 0) / topAppear;
            const dialogueScore = (c.dialogueCount ?? 0) / topDialogue;
            const perspectiveScore = (c.perspectiveCount ?? 0) / topPerspective;
            const keyEventScore = (c.keyEventCount ?? 0) / topKeyEvents;
            // 综合得分：出现次数权重最大，对话/视角/关键事件辅助
            const globalScore = appearScore * 0.45 + dialogueScore * 0.2 + perspectiveScore * 0.2 + keyEventScore * 0.15;

            if (globalScore >= 0.35) c.role = 'deuteragonist';
            else if (globalScore >= 0.1) c.role = 'supporting';
            else c.role = 'minor';

            // 记录最高分者（并列取首个/出场更多者，characters 已按 appearanceCount 降序）
            if (globalScore > bestScore) {
                bestScore = globalScore;
                bestIdx = i;
            }
        }

        // 唯一主角保证：得分最高者恒为 protagonist；其余即使达阈值也不并列为主角。
        // 消除"零主角"（无人达 0.7）与"多主角”（多人 ≥ 0.7）两种边界。
        characters.forEach((c, i) => {
            if (i === bestIdx) {
                c.role = 'protagonist';
            } else if (c.role === 'protagonist') {
                c.role = 'deuteragonist';
            }
        });
    }

    /**
     * 合并后依据全本累计参数重算 importance，避免沿用某单段的 importance 对象。
     */
    private recomputeImportanceFromGlobalStats(characters: CharacterAnalysisResult['characters']): void {
        if (characters.length === 0) return;
        const topAppear = Math.max(1, ...characters.map(c => c.appearanceCount ?? 0));
        const topDialogue = Math.max(1, ...characters.map(c => c.dialogueCount ?? 0));
        const topPerspective = Math.max(1, ...characters.map(c => c.perspectiveCount ?? 0));
        const topKeyEvents = Math.max(1, ...characters.map(c => c.keyEventCount ?? 0));
        const topRelations = Math.max(1, ...characters.map(c => (c.relationships?.length ?? 0)));

        for (const c of characters) {
            const appearanceFrequency = (c.appearanceCount ?? 0) / topAppear;
            const dialogueRatio = (c.dialogueCount ?? 0) / topDialogue;
            const perspectiveRatio = (c.perspectiveCount ?? 0) / topPerspective;
            const plotDrivingScore = (c.keyEventCount ?? 0) / topKeyEvents;
            const relationshipCentrality = (c.relationships?.length ?? 0) / topRelations;

            const totalScore =
                appearanceFrequency * 0.35 +
                dialogueRatio * 0.20 +
                plotDrivingScore * 0.20 +
                relationshipCentrality * 0.15 +
                perspectiveRatio * 0.10;

            const scaled = this.round2(totalScore * 100);
            let tier: NonNullable<CharacterAnalysisResult['characters'][number]['importance']>['tier'];
            if (scaled >= 70) tier = 'protagonist';
            else if (scaled >= 45) tier = 'core_supporting';
            else if (scaled >= 25) tier = 'important_supporting';
            else if (scaled >= 10) tier = 'minor_supporting';
            else tier = 'extra';

            c.importance = {
                appearanceFrequency: this.round2(appearanceFrequency * 100),
                dialogueRatio: this.round2(dialogueRatio * 100),
                plotDrivingScore: this.round2(plotDrivingScore * 100),
                relationshipCentrality: this.round2(relationshipCentrality * 100),
                perspectiveRatio: this.round2(perspectiveRatio * 100),
                totalScore: scaled,
                tier,
            };
        }
    }

    private mergeWordPreference(prefs: StyleAnalysisResult['wordPreference'][], weights?: number[]): StyleAnalysisResult['wordPreference'] {
        const w = weights ?? prefs.map(() => 1 / (prefs.length || 1));
        const topWordsMap = new Map<string, number>();
        for (const p of prefs) {
            for (const word of p.topWords ?? []) {
                topWordsMap.set(word.word, (topWordsMap.get(word.word) ?? 0) + word.count);
            }
        }
        const totalWordCount = Array.from(topWordsMap.values()).reduce((a, b) => a + b, 0);
        const topWords = Array.from(topWordsMap.entries())
            .map(([word, count]) => ({ word, count, frequency: totalWordCount > 0 ? count / totalWordCount : 0 }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        return {
            topWords,
            posPreference: {
                verb: this.weightedAvg(prefs.map(p => p.posPreference?.verb ?? 0), w),
                adjective: this.weightedAvg(prefs.map(p => p.posPreference?.adjective ?? 0), w),
                adverb: this.weightedAvg(prefs.map(p => p.posPreference?.adverb ?? 0), w),
            },
            modalParticles: {
                total: prefs.reduce((sum, p) => sum + (p.modalParticles?.total ?? 0), 0),
                perThousand: this.weightedAvg(prefs.map(p => p.modalParticles?.perThousand ?? 0), w),
                topParticles: [],
            },
            idiomDensity: this.weightedAvg(prefs.map(p => p.idiomDensity), w),
            colloquialismLevel: this.weightedAvg(prefs.map(p => p.colloquialismLevel), w),
        };
    }

    private mergeNarrativeStyle(
        styles: StyleAnalysisResult['narrativeStyle'][],
        weights?: number[]
    ): StyleAnalysisResult['narrativeStyle'] {
        if (styles.length === 0) {
            return {
                perspective: 'third_person_limited', perspectiveConfidence: 0,
                descriptionRatio: { appearance: 0, environment: 0, action: 0, psychology: 0, total: 0 },
                narrationRatio: 0, dialogueRatio: 0,
            };
        }
        const w = weights ?? styles.map(() => 1 / styles.length);

        // perspective：置信度加权投票（权重 × 该段视角置信度），不再取末段
        const voteAcc = new Map<string, number>();
        for (let i = 0; i < styles.length; i++) {
            const s = styles[i];
            const vote = (w[i] ?? 0) * (s.perspectiveConfidence ?? 0.0001);
            voteAcc.set(s.perspective, (voteAcc.get(s.perspective) ?? 0) + vote);
        }
        const sortedVotes = Array.from(voteAcc.entries()).sort((a, b) => b[1] - a[1]);
        const perspective = (sortedVotes[0]?.[0] as StyleAnalysisResult['narrativeStyle']['perspective'])
            ?? styles[styles.length - 1].perspective;

        // perspectiveConfidence 走 A2：一致时不降级、冲突时下调
        const perspectiveMatch = styles.map(s => (s.perspective === perspective ? 1 : 0));
        const conf = this.combineConfidence(
            perspectiveMatch,
            w,
            styles.map(s => s.perspectiveConfidence ?? 0)
        );

        const wa = (getter: (s: StyleAnalysisResult['narrativeStyle']) => number) =>
            this.round2(this.weightedAvg(styles.map(getter), w));

        return {
            perspective,
            perspectiveConfidence: this.round2(conf.confidence),
            descriptionRatio: {
                appearance: wa(s => s.descriptionRatio?.appearance ?? 0),
                environment: wa(s => s.descriptionRatio?.environment ?? 0),
                action: wa(s => s.descriptionRatio?.action ?? 0),
                psychology: wa(s => s.descriptionRatio?.psychology ?? 0),
                total: wa(s => s.descriptionRatio?.total ?? 0),
            },
            narrationRatio: wa(s => s.narrationRatio ?? 0),
            dialogueRatio: wa(s => s.dialogueRatio ?? 0),
        };
    }

    private mergeRhetoric(
        rhetorics: StyleAnalysisResult['rhetoric'][],
        totalChars?: number
    ): StyleAnalysisResult['rhetoric'] {
        const metaphor = rhetorics.reduce((sum, r) => sum + (r.metaphor ?? 0), 0);
        const personification = rhetorics.reduce((sum, r) => sum + (r.personification ?? 0), 0);
        const parallelism = rhetorics.reduce((sum, r) => sum + (r.parallelism ?? 0), 0);
        const rhetoricalQuestion = rhetorics.reduce((sum, r) => sum + (r.rhetoricalQuestion ?? 0), 0);
        const hyperbole = rhetorics.reduce((sum, r) => sum + (r.hyperbole ?? 0), 0);
        const antithesis = rhetorics.reduce((sum, r) => sum + (r.antithesis ?? 0), 0);
        const total = metaphor + personification + parallelism + rhetoricalQuestion + hyperbole + antithesis;
        // perThousand：用总数/总字数重算，与 total 口径一致，而非各段速率平均
        const perThousand = (totalChars && totalChars > 0)
            ? this.round2(this.recomputeRate(total, totalChars, 1000))
            : this.round2(rhetorics.reduce((sum, r) => sum + (r.perThousand ?? 0), 0) / (rhetorics.length || 1));
        return {
            metaphor,
            personification,
            parallelism,
            rhetoricalQuestion,
            hyperbole,
            antithesis,
            total,
            perThousand,
        };
    }

    private mergeDialogueStyle(dialogues: StyleAnalysisResult['dialogueStyle'][], weights?: number[]): StyleAnalysisResult['dialogueStyle'] {
        if (dialogues.length === 0) {
            return { dialogueRatio: 0, promptWordPreference: [], avgDialogueLength: 0, lengthDistribution: { short: 0, medium: 0, long: 0 } };
        }
        const w = weights ?? dialogues.map(() => 1 / dialogues.length);

        const promptMap = new Map<string, number>();
        for (const d of dialogues) {
            for (const p of d.promptWordPreference ?? []) {
                promptMap.set(p.word, (promptMap.get(p.word) ?? 0) + p.count);
            }
        }
        const promptWordPreference = Array.from(promptMap.entries())
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        return {
            dialogueRatio: this.round2(this.weightedAvg(dialogues.map(d => d.dialogueRatio ?? 0), w)),
            promptWordPreference,
            avgDialogueLength: this.round2(this.weightedAvg(dialogues.map(d => d.avgDialogueLength ?? 0), w)),
            lengthDistribution: {
                short: this.round2(this.weightedAvg(dialogues.map(d => d.lengthDistribution?.short ?? 0), w)),
                medium: this.round2(this.weightedAvg(dialogues.map(d => d.lengthDistribution?.medium ?? 0), w)),
                long: this.round2(this.weightedAvg(dialogues.map(d => d.lengthDistribution?.long ?? 0), w)),
            },
        };
    }

    private mergeParagraphStructure(structures: StyleAnalysisResult['paragraphStructure'][], weights?: number[]): StyleAnalysisResult['paragraphStructure'] {
        if (structures.length === 0) {
            return {
                avgParagraphLength: 0, medianParagraphLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
                openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 },
            };
        }
        const w = weights ?? structures.map(() => 1 / structures.length);
        return {
            avgParagraphLength: this.round2(this.weightedAvg(structures.map(s => s.avgParagraphLength ?? 0), w)),
            medianParagraphLength: this.round2(this.weightedAvg(structures.map(s => s.medianParagraphLength ?? 0), w)),
            lengthDistribution: {
                short: this.round2(this.weightedAvg(structures.map(s => s.lengthDistribution?.short ?? 0), w)),
                medium: this.round2(this.weightedAvg(structures.map(s => s.lengthDistribution?.medium ?? 0), w)),
                long: this.round2(this.weightedAvg(structures.map(s => s.lengthDistribution?.long ?? 0), w)),
                veryLong: this.round2(this.weightedAvg(structures.map(s => s.lengthDistribution?.veryLong ?? 0), w)),
            },
            openingFeatures: {
                timeWord: structures.reduce((sum, s) => sum + (s.openingFeatures?.timeWord ?? 0), 0),
                conjunction: structures.reduce((sum, s) => sum + (s.openingFeatures?.conjunction ?? 0), 0),
                subject: structures.reduce((sum, s) => sum + (s.openingFeatures?.subject ?? 0), 0),
                other: structures.reduce((sum, s) => sum + (s.openingFeatures?.other ?? 0), 0),
            },
        };
    }

    private mergeOverallStyle(styes: StyleAnalysisResult['overallStyle'][], weights?: number[]): StyleAnalysisResult['overallStyle'] {
        if (styes.length === 0) {
            return { primaryStyle: '未知', confidence: 0, styleScores: {} };
        }
        const w = weights ?? styes.map(() => 1 / styes.length);

        const scoreAcc = new Map<string, number>();
        for (let i = 0; i < styes.length; i++) {
            const weight = w[i] ?? 0;
            for (const [k, v] of Object.entries(styes[i].styleScores ?? {})) {
                scoreAcc.set(k, (scoreAcc.get(k) ?? 0) + v * weight);
            }
        }
        const styleScores: Record<string, number> = {};
        for (const [k, v] of scoreAcc.entries()) styleScores[k] = this.round2(v);

        const sorted = Object.entries(styleScores).sort((a, b) => b[1] - a[1]);
        const primaryStyle = sorted[0]?.[0] ?? styes[styes.length - 1].primaryStyle;
        const secondaryStyle = sorted[1]?.[0];

        return {
            primaryStyle,
            secondaryStyle,
            confidence: this.round2(this.weightedAvg(styes.map(s => s.confidence ?? 0), w)),
            styleScores,
            vectorVerified: styes.some(s => s.vectorVerified),
            vectorConfidence: this.round2(this.weightedAvg(styes.map(s => s.vectorConfidence ?? 0), w)),
        };
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
                        subScores: {
                            openingConflict: 0,
                            infoDensity: 0,
                            protagonistGoal: 0,
                            goldenFinger: 0,
                            chapterHooks: 0,
                            characterImmersion: 0,
                            worldviewAttraction: 0,
                            dialogueQuality: 0,
                            suspenseIntensity: 0,
                            emotionalImpact: 0
                        },
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
