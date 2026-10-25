/**
 * segment-aware-breakdown.ts — 分段感知的拆解包装器
 *
 * 功能：为大文本（>30万字）自动启用分段拆解，对短文本保持原行为不变。
 *       任何维度拆解器都可以通过这个包装器获得"分段+进度可见+流式"能力。
 *
 * 核心策略：
 * - 短文本（<maxDirectWords）：直接调用原拆解器，零开销
 * - 长文本：自动分段 → 逐段拆解 → 合并结果 → 进度回调映射
 * - 合并：按维度类型（style/rhythm/character...）用各 deconstructor 自带合并逻辑
 *
 * 与现有 scheduler 集成：
 * - 在 breakdownDimension 中间加一层包装，不改外层调用
 * - 保留所有现有进度/取消/降级逻辑
 * - 流式读取由 StreamTextReader 提供，但分段是首选（更精确）
 */

import { TextSegment } from '../engine/text-segmenter';
import { StreamTextReader } from '../engine/stream-text-reader';
import { yieldToUI } from '../shared/yield';

export interface SegmentBreakdownOptions {
    maxDirectWords?: number;
    maxSegmentWords?: number;
    onSegmentProgress?: (segmentIndex: number, totalSegments: number, segmentProgress: number) => void;
}

export interface SegmentBreakdownResult<T> {
    segments: T[];
    combinedResult: T;
    totalSegments: number;
}

const DEFAULT_OPTIONS: Required<Omit<SegmentBreakdownOptions, 'onSegmentProgress'>> = {
    maxDirectWords: 300000,
    maxSegmentWords: 50000,
};

type ResolvedSegmentBreakdownOptions = Required<Omit<SegmentBreakdownOptions, 'onSegmentProgress'>> & Pick<SegmentBreakdownOptions, 'onSegmentProgress'>;

function countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
}

export class SegmentAwareBreakdown {
    private options: ResolvedSegmentBreakdownOptions;

    constructor(options: SegmentBreakdownOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    async run<T>(
        text: string,
        analyzeSegment: (segment: TextSegment) => Promise<T>,
        combine: (results: T[], totalWordCount: number) => T | Promise<T>,
        signal?: AbortSignal
    ): Promise<SegmentBreakdownResult<T>> {
        if (this.isAborted(signal)) {
            throw new Error('任务已取消');
        }

        const totalWords = countWords(text);

        if (totalWords <= this.options.maxDirectWords) {
            const segment: TextSegment = {
                index: 0,
                text,
                startOffset: 0,
                endOffset: text.length,
                wordCount: totalWords,
            };

            const result = await analyzeSegment(segment);
            return {
                segments: [result],
                combinedResult: result,
                totalSegments: 1,
            };
        }

        const reader = new StreamTextReader({
            bufferSize: Math.max(this.options.maxSegmentWords * 2, 8192),
            segmentOptions: {
                maxSegmentWords: this.options.maxSegmentWords,
                minSegmentWords: Math.floor(this.options.maxSegmentWords * 0.4),
            },
        });
        await reader.fromString(text);

        const segmentResults: T[] = [];
        const estimatedTotal = Math.max(1, this.estimateSegments(text));
        let produced = 0;

        for await (const seg of reader) {
            if (this.isAborted(signal)) {
                throw new Error('任务已取消');
            }

            this.options.onSegmentProgress?.(produced, estimatedTotal, 0);
            const result = await analyzeSegment(seg);
            segmentResults.push(result);
            produced++;
            this.options.onSegmentProgress?.(produced - 1, estimatedTotal, 1);

            await yieldToUI();
        }

        const combined = await combine(segmentResults, totalWords);

        return {
            segments: segmentResults,
            combinedResult: combined,
            totalSegments: segmentResults.length,
        };
    }

    shouldUseSegmented(text: string): boolean {
        return countWords(text) > this.options.maxDirectWords;
    }

    estimateSegments(text: string): number {
        const words = countWords(text);
        if (words <= this.options.maxDirectWords) {
            return 1;
        }
        return Math.ceil(words / this.options.maxSegmentWords);
    }

    private isAborted(signal?: AbortSignal): boolean {
        return signal?.aborted ?? false;
    }
}
