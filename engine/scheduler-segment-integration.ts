/**
 * scheduler-segment-integration.ts — Scheduler 分段能力集成层
 *
 * 功能：在不修改现有 DeconstructionScheduler 内部逻辑的前提下，
 *       暴露"分段拆解"能力给上层调用者（如 batch UI、批量脚本）。
 *
 * 集成方式：
 * - 接受一个 scheduler 实例 + 各维度拆解器
 * - 对每个维度提供 analyzeWithSegments 方法
 * - 短文本直通原 scheduler（零开销）
 * - 长文本用 SegmentAwareBreakdown 分段 + 原拆解器逐段处理
 * - 流水线并行：统计分析和向量增强并行执行
 *
 * 适用范围：
 * - UI 上"批量大书拆解"按钮
 * - API 层面"按段拆解"调用
 * - P1 的"增量输出"基于此实现
 */

import { SegmentAwareBreakdown, SegmentBreakdownResult } from './segment-aware-breakdown';
import { countCjkAndWords } from '@/shared/word-count';
import { TextSegment } from './text-segmenter';
import { IncrementalResultAggregator, PartialResult, type AnalysisResult } from './incremental-result-aggregator';
import type { DeconstructionWorkerManager, DeconstructDimension } from './deconstruction-worker-manager';
import type { LLMEnhancer } from './llm-enhancer';
import type { LLMEnhanceDimension } from './llm-prompts';

/**
 * 调度器分段选项列表结构定义。
 */
export interface SchedulerSegmentOptions {
    maxDirectWords?: number;
    maxSegmentWords?: number;
    useVector?: boolean;
    llmEnhancer?: LLMEnhancer;
    llmEnabled?: boolean;
    onSegmentProgress?: (dimension: DeconstructDimension, segmentIndex: number, totalSegments: number, segmentProgress: number) => void;
    onOverallProgress?: (dimension: DeconstructDimension, progress: number, message: string) => void;
    onPartialResult?: (result: PartialResult) => void;
}

/**
 * SchedulerSegmentIntegration 类。
 */
export class SchedulerSegmentIntegration {
    private workerManager: DeconstructionWorkerManager;
    private breakdown: SegmentAwareBreakdown;

    constructor(workerManager: DeconstructionWorkerManager) {
        this.workerManager = workerManager;
        this.breakdown = new SegmentAwareBreakdown();
    }

    /**
     * analyzeWithSegments 方法。
     * @param dimension - 参数值
     * @param text - 文本内容
     * @param signal - 取消信号
     * @param options - 配置项
      * @returns SegmentBreakdownResult<T> 实例
     */
    async analyzeWithSegments<T>(
        dimension: DeconstructDimension,
        text: string,
        signal: AbortSignal,
        options: SchedulerSegmentOptions = {}
    ): Promise<SegmentBreakdownResult<T>> {
        const useVector = options.useVector ?? true;

        const aggregator = new IncrementalResultAggregator();
        if (options.onPartialResult) {
            aggregator.onPartialResult(options.onPartialResult);
        }

        const useSegmented = this.shouldSegment(text, options);

        if (!useSegmented) {
            if (signal.aborted) {
                throw new Error('任务已取消');
            }
            const segment: TextSegment = {
                index: 0,
                text,
                startOffset: 0,
                endOffset: text.length,
                wordCount: countCjkAndWords(text),
            };

            let result: T;
            if (useVector) {
                result = await this.processSingleSegmentPipeline<T>(dimension, segment, options, aggregator);
            } else {
                const handler = this.getDimensionHandler<T>(dimension, false);
                if (!handler) {
                    throw new Error(`不支持的维度: ${dimension}`);
                }
                result = await handler(segment, (p) => {
                    options.onOverallProgress?.(dimension, p, `${dimension} 处理中...`);
                });
                aggregator.addSegmentResult(dimension, result as unknown as AnalysisResult, 0, 1);
            }

            result = await this.enhanceWithLLMIfNeeded(dimension, text, result, options);

            return {
                segments: [result],
                combinedResult: result,
                totalSegments: 1,
            };
        }

        const breakdown = new SegmentAwareBreakdown({
            maxDirectWords: options.maxDirectWords ?? 300000,
            maxSegmentWords: options.maxSegmentWords ?? 50000,
            onSegmentProgress: (segIdx, totalSegs, segProg) => {
                options.onSegmentProgress?.(dimension, segIdx, totalSegs, segProg);
            },
        });

        const totalSegs = breakdown.estimateSegments(text);

        if (useVector) {
            return breakdown.run<T>(
                text,
                async (segment) => {
                    return await this.processSingleSegmentPipeline<T>(dimension, segment, options, aggregator);
                },
                async (results) => {
                    const combined = this.combineResults<T>(results, dimension);
                    const enhanced = await this.enhanceWithLLMIfNeeded(dimension, text, combined, options);
                    aggregator.markDimensionComplete(dimension);
                    return enhanced;
                },
                signal,
            );
        }

        const handler = this.getDimensionHandler<T>(dimension, false);
        if (!handler) {
            throw new Error(`不支持的维度: ${dimension}`);
        }

        return breakdown.run<T>(
            text,
            async (segment) => {
                const result = await handler(segment, (segProg) => {
                    const overall = ((segment.index * 100 + segProg) / Math.max(1, totalSegs));
                    options.onOverallProgress?.(dimension, overall, `${dimension} 第 ${segment.index + 1} 段处理中...`);
                });

                aggregator.addSegmentResult(dimension, result as unknown as AnalysisResult, segment.index, totalSegs);

                return result;
            },
            async (results) => {
                const combined = this.combineResults<T>(results, dimension);
                const enhanced = await this.enhanceWithLLMIfNeeded(dimension, text, combined, options);
                aggregator.markDimensionComplete(dimension);
                return enhanced;
            },
            signal,
        );
    }

    private async processSingleSegmentPipeline<T>(
        dimension: DeconstructDimension,
        segment: TextSegment,
        options: SchedulerSegmentOptions,
        aggregator: IncrementalResultAggregator
    ): Promise<T> {
        const statisticalHandler = this.getDimensionHandler<T>(dimension, false);
        const vectorHandler = this.getDimensionHandler<T>(dimension, true);

        if (!statisticalHandler || !vectorHandler) {
            throw new Error(`不支持的维度: ${dimension}`);
        }

        const [statisticalResult, vectorResult] = await Promise.all([
            statisticalHandler(segment, (segProg) => {
                options.onOverallProgress?.(dimension, segProg * 0.5, `${dimension} 统计分析中...`);
            }),
            vectorHandler(segment, (segProg) => {
                options.onOverallProgress?.(dimension, 50 + segProg * 0.5, `${dimension} 向量增强中...`);
            }),
        ]);

        const mergedResult = this.mergeStatisticalAndVectorResults(statisticalResult, vectorResult, dimension);
        aggregator.addSegmentResult(dimension, mergedResult as unknown as AnalysisResult, segment.index, 1);

        return mergedResult;
    }

    private mergeStatisticalAndVectorResults<T>(statistical: T, vector: T, dimension: DeconstructDimension): T {
        if (!statistical || !vector) {
            return vector || statistical;
        }

        const stat = statistical as unknown as Record<string, unknown>;
        const vec = vector as unknown as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...stat };

        for (const [key, value] of Object.entries(vec)) {
            if (value !== undefined && value !== null) {
                merged[key] = value;
            }
        }

        return merged as unknown as T;
    }

    /**
     * 是否应该分段。
     * @param text - 文本内容
     * @param options - 配置项
     * @returns 是否成功
     */
    shouldSegment(text: string, options: SchedulerSegmentOptions = {}): boolean {
        const words = countCjkAndWords(text);
        const threshold = options.maxDirectWords ?? 300000;
        return words > threshold;
    }

    /**
     * estimateSegments 方法。
     * @param text - 文本内容
     * @param options - 配置项
     * @returns 数值结果
     */
    estimateSegments(text: string, options: SchedulerSegmentOptions = {}): number {
        const words = countCjkAndWords(text);
        const threshold = options.maxDirectWords ?? 300000;
        const maxSeg = options.maxSegmentWords ?? 50000;
        if (words <= threshold) return 1;
        return Math.ceil(words / maxSeg);
    }

    private getDimensionHandler<T>(
        dimension: DeconstructDimension,
        useVector: boolean
    ): ((segment: TextSegment, onProgress: (p: number) => void) => Promise<T>) | null {
        const map: Record<DeconstructDimension, (text: string, onProgress?: (p: number, m?: string) => void) => any> = {
            style: useVector ? this.workerManager.analyzeStyleWithVector.bind(this.workerManager) : this.workerManager.analyzeStyle.bind(this.workerManager),
            rhythm: useVector ? this.workerManager.analyzeRhythmWithVector.bind(this.workerManager) : this.workerManager.analyzeRhythm.bind(this.workerManager),
            technique: useVector ? this.workerManager.analyzeTechniqueWithVector.bind(this.workerManager) : this.workerManager.analyzeTechniqueWithVector.bind(this.workerManager),
            structure: useVector ? this.workerManager.analyzeStructureWithVector.bind(this.workerManager) : this.workerManager.analyzeStructure.bind(this.workerManager),
            character: useVector ? this.workerManager.analyzeCharacterWithVector.bind(this.workerManager) : this.workerManager.analyzeCharacter.bind(this.workerManager),
            foreshadow: useVector ? this.workerManager.analyzeForeshadowWithVector.bind(this.workerManager) : this.workerManager.analyzeForeshadow.bind(this.workerManager),
            commercial: useVector ? this.workerManager.analyzeCommercialWithVector.bind(this.workerManager) : this.workerManager.analyzeCommercial.bind(this.workerManager),
            readability: useVector ? this.workerManager.analyzeReadabilityWithVector.bind(this.workerManager) : this.workerManager.analyzeReadability.bind(this.workerManager),
        };

        const fn = map[dimension];
        if (!fn) return null;

        return async (segment, onProgress) => {
            return await fn(segment.text, onProgress);
        };
    }

    private combineResults<T>(results: T[], dimension: DeconstructDimension): T {
        const aggregator = new IncrementalResultAggregator({ debounceMs: 0, progressThreshold: 0 });
        results.forEach((result, index) => {
            aggregator.addSegmentResult(dimension, result as unknown as AnalysisResult, index, results.length);
        });
        return (aggregator.getPartialResult(dimension)?.combinedResult ?? results[results.length - 1]) as unknown as T;
    }

    private async enhanceWithLLMIfNeeded<T>(
        dimension: DeconstructDimension,
        text: string,
        result: T,
        options: SchedulerSegmentOptions
    ): Promise<T> {
        if (!options.llmEnabled || !options.llmEnhancer) {
            return result;
        }

        const enhanced = await options.llmEnhancer.enhanceResult(result as Record<string, unknown>, text, this.mapToLLMDimension(dimension));
        return enhanced as T;
    }

    private mapToLLMDimension(dimension: DeconstructDimension): LLMEnhanceDimension {
        if (dimension === 'character') return 'personality';
        if (dimension === 'technique' || dimension === 'structure' || dimension === 'commercial' || dimension === 'readability') return 'style';
        return dimension;
    }

}
