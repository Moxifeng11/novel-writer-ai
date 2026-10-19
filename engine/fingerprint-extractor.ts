/**
 * fingerprint-extractor.ts — AI 写作指纹提取器
 *
 * 功能：从文本中提取写作风格指纹，包括统计特征、AI 分析特征、代表性片段和向量
 * 对应优化方向：风格一致性
 */

import { AIEngine } from './ai-engine';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import type { VectorStore, StyleFingerprint, StyleFingerprintStats, StyleFingerprintFeatures } from './style-fingerprint-library';
import { calculateRhythmStats, calculatePerspectiveStats } from './style/v2-quantitative-extractor';
import type { RhythmStats, PerspectiveStats } from './style/style-dimensions-v2';
import { extractResponseText } from '../shared/api-response-utils';
import { createLogger } from '../shared/logger';


const log = createLogger('FingerprintExtractor');
export type ExtractionPhase = 'preprocessing' | 'feature-extraction' | 'sample-selection' | 'vectorization' | 'complete';

export interface ExtractionProgress {
    phase: ExtractionPhase;
    percent: number;
    message: string;
}

export interface ExtractionOptions {
    name: string;
    source: string;
    scope: 'template' | 'global' | 'project';
    tags?: string[];
    signal?: AbortSignal;
    onProgress?: (progress: ExtractionProgress) => void;
}

export class FingerprintExtractor {
    private aiEngine: AIEngine;
    private embeddingProvider: EmbeddingProvider;
    private vectorStore: VectorStore;

    constructor(
        aiEngine: AIEngine,
        embeddingProvider: EmbeddingProvider,
        vectorStore: VectorStore
    ) {
        this.aiEngine = aiEngine;
        this.embeddingProvider = embeddingProvider;
        this.vectorStore = vectorStore;
    }

    async extract(text: string, options: ExtractionOptions): Promise<StyleFingerprint> {
        const { name, source, scope, signal, onProgress } = options;

        const fingerprintId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        this.checkAbort(signal);

        const stats = await this.preprocess(text, onProgress, signal);

        const features = await this.extractFeatures(text, onProgress, signal);

        const samples = await this.selectSamples(text, onProgress, signal);

        await this.vectorize(fingerprintId, samples, onProgress, signal);

        const fingerprint: StyleFingerprint = {
            id: fingerprintId,
            name,
            source,
            scope,
            enabled: true,
            tags: options.tags ?? [],
            stats,
            features,
            samples,
            extractedAt: Date.now(),
        };

        onProgress?.({
            phase: 'complete',
            percent: 100,
            message: '指纹提取完成',
        });

        return fingerprint;
    }

    /**
     * 提取 V2 定量拆解数据（纯本地统计，不依赖 AI）。
     * 当前覆盖节奏（rhythm）与视角（perspective）两个维度，
     * 用于填补 V1→V2 迁移时定量字段全 0 的空缺。
     */
    extractV2Quantitative(text: string): { rhythm: RhythmStats; perspective: PerspectiveStats } {
        return {
            rhythm: calculateRhythmStats(text),
            perspective: calculatePerspectiveStats(text),
        };
    }

    private checkAbort(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new Error('提取已取消');
        }
    }

    private async preprocess(
        text: string,
        onProgress?: (progress: ExtractionProgress) => void,
        signal?: AbortSignal
    ): Promise<StyleFingerprintStats> {
        onProgress?.({
            phase: 'preprocessing',
            percent: 0,
            message: '正在预处理文本...',
        });

        this.checkAbort(signal);

        const cleaned = this.cleanText(text);

        onProgress?.({
            phase: 'preprocessing',
            percent: 5,
            message: '正在计算基础统计...',
        });

        this.checkAbort(signal);

        const stats = this.calculateStats(cleaned);

        onProgress?.({
            phase: 'preprocessing',
            percent: 15,
            message: '预处理完成',
        });

        return stats;
    }

    private cleanText(text: string): string {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private calculateStats(text: string): StyleFingerprintStats {
        const wordCount = text.replace(/\s/g, '').length;

        const sentenceEndings = /[。！？；]/g;
        const sentences = text.split(sentenceEndings).filter(s => s.trim().length > 0);
        const avgSentenceLength = sentences.length > 0
            ? Math.round(wordCount / sentences.length * 10) / 10
            : 0;

        const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
        const avgParagraphLength = paragraphs.length > 0
            ? Math.round(wordCount / paragraphs.length)
            : 0;

        const dialogueChars = this.countDialogueChars(text);
        const dialogueRatio = wordCount > 0
            ? Math.round((dialogueChars / wordCount) * 1000) / 1000
            : 0;

        const descriptionRatio = Math.max(0, Math.round((1 - dialogueRatio - 0.2) * 1000) / 1000);

        return {
            wordCount,
            avgSentenceLength,
            avgParagraphLength,
            dialogueRatio,
            descriptionRatio,
        };
    }

    private countDialogueChars(text: string): number {
        let count = 0;
        const patterns = [
            /「([^」]+)」/g,
            /『([^』]+)』/g,
            /"([^"]+)"/g,
            /"([^"]+)"/g,
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                for (const match of matches) {
                    count += match.replace(/[「」『』""]/g, '').length;
                }
            }
        }

        return count;
    }

    private async extractFeatures(
        text: string,
        onProgress?: (progress: ExtractionProgress) => void,
        signal?: AbortSignal
    ): Promise<StyleFingerprintFeatures> {
        onProgress?.({
            phase: 'feature-extraction',
            percent: 15,
            message: '正在分析风格特征...',
        });

        this.checkAbort(signal);

        const truncatedText = text.slice(0, 30000);

        const systemPrompt = this.buildFeatureSystemPrompt();
        const userPrompt = this.buildFeatureUserPrompt(truncatedText);

        const plugin = this.aiEngine.getPlugin();
        const model = plugin.settings.proModel;

        onProgress?.({
            phase: 'feature-extraction',
            percent: 25,
            message: '正在调用 AI 分析...',
        });

        this.checkAbort(signal);

        const response = await this.aiEngine.callAI(
            systemPrompt,
            userPrompt,
            model,
            0.3,
            2048,
            { signal }
        );

        onProgress?.({
            phase: 'feature-extraction',
            percent: 45,
            message: '正在解析分析结果...',
        });

        this.checkAbort(signal);

        const features = this.parseFeatureResponse(response);

        onProgress?.({
            phase: 'feature-extraction',
            percent: 55,
            message: '风格特征提取完成',
        });

        return features;
    }

    private buildFeatureSystemPrompt(): string {
        return [
            '你是一位专业的文学风格分析师，擅长分析小说作者的写作风格。',
            '',
            '请从以下 7 个维度分析给定文本的写作风格：',
            '1. 句式节奏：平均句长、长短句比例、句型分布特点',
            '2. 用词偏好：高频词特点、偏好动词/形容词类型、语气词使用',
            '3. 叙事特点：叙事视角、叙事节奏快慢、心理描写比例',
            '4. 修辞手法：比喻/拟人/排比等常用修辞特点',
            '5. 对话风格：对话占比、直接/间接对话、提示词偏好',
            '6. 段落结构：平均段长、段落节奏、段首特点',
            '7. 整体文风：简洁/华丽/冷峻/细腻等整体评价',
            '',
            '输出要求：',
            '- 严格返回 JSON 格式',
            '- 每个维度 50-100 字描述',
            '- 使用中文描述',
            '- 键名为：sentenceRhythm, wordPreference, narrativeStyle, rhetoric, dialogueStyle, paragraphStructure, overallTone',
            '',
            '示例格式：',
            '{',
            '  "sentenceRhythm": "句式...",',
            '  "wordPreference": "用词...",',
            '  "narrativeStyle": "叙事...",',
            '  "rhetoric": "修辞...",',
            '  "dialogueStyle": "对话...",',
            '  "paragraphStructure": "段落...",',
            '  "overallTone": "文风..."',
            '}',
        ].join('\n');
    }

    private buildFeatureUserPrompt(text: string): string {
        return [
            '请分析以下小说文本的写作风格：',
            '',
            '---文本开始---',
            text,
            '---文本结束---',
            '',
            '请按要求返回 JSON 格式的风格分析结果：',
        ].join('\n');
    }

    private parseFeatureResponse(response: any): StyleFingerprintFeatures {
        const content = extractResponseText(response);

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    sentenceRhythm: parsed.sentenceRhythm || '',
                    wordPreference: parsed.wordPreference || '',
                    narrativeStyle: parsed.narrativeStyle || '',
                    rhetoric: parsed.rhetoric || '',
                    dialogueStyle: parsed.dialogueStyle || '',
                    paragraphStructure: parsed.paragraphStructure || '',
                    overallTone: parsed.overallTone || '',
                };
            }
        } catch (e) {
            log.warn('[FingerprintExtractor] 解析风格特征 JSON 失败:', e);
        }

        return {
            sentenceRhythm: '',
            wordPreference: '',
            narrativeStyle: '',
            rhetoric: '',
            dialogueStyle: '',
            paragraphStructure: '',
            overallTone: '',
        };
    }

    private async selectSamples(
        text: string,
        onProgress?: (progress: ExtractionProgress) => void,
        signal?: AbortSignal
    ): Promise<string[]> {
        onProgress?.({
            phase: 'sample-selection',
            percent: 55,
            message: '正在筛选代表性片段...',
        });

        this.checkAbort(signal);

        const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);

        onProgress?.({
            phase: 'sample-selection',
            percent: 60,
            message: '正在组合文本片段...',
        });

        this.checkAbort(signal);

        const segments = this.buildSegments(paragraphs);

        onProgress?.({
            phase: 'sample-selection',
            percent: 65,
            message: '正在智能筛选片段...',
        });

        this.checkAbort(signal);

        const samples = this.selectRepresentativeSamples(segments);

        onProgress?.({
            phase: 'sample-selection',
            percent: 75,
            message: '片段筛选完成',
        });

        return samples;
    }

    private buildSegments(paragraphs: string[]): string[] {
        const segments: string[] = [];
        let currentSegment = '';

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (trimmed.length < 20) continue;

            if (currentSegment.length === 0) {
                currentSegment = trimmed;
            } else if (currentSegment.length < 200) {
                currentSegment += '\n\n' + trimmed;
            } else {
                segments.push(currentSegment);
                currentSegment = trimmed;
            }
        }

        if (currentSegment.length >= 100) {
            segments.push(currentSegment);
        }

        return segments;
    }

    private selectRepresentativeSamples(segments: string[]): string[] {
        if (segments.length === 0) return [];

        const samples: string[] = [];
        const targetCount = Math.min(20, segments.length);

        const dialogueSegments: string[] = [];
        const descriptionSegments: string[] = [];
        const narrationSegments: string[] = [];

        for (const seg of segments) {
            const type = this.classifySegment(seg);
            if (type === 'dialogue') dialogueSegments.push(seg);
            else if (type === 'description') descriptionSegments.push(seg);
            else narrationSegments.push(seg);
        }

        const countPerType = Math.ceil(targetCount / 3);

        const pickEvenly = (arr: string[], count: number): string[] => {
            if (arr.length === 0) return [];
            if (arr.length <= count) return [...arr];

            const result: string[] = [];
            const step = arr.length / count;
            for (let i = 0; i < count; i++) {
                const idx = Math.min(arr.length - 1, Math.floor(i * step));
                result.push(arr[idx]);
            }
            return result;
        };

        samples.push(...pickEvenly(dialogueSegments, countPerType));
        samples.push(...pickEvenly(descriptionSegments, countPerType));
        samples.push(...pickEvenly(narrationSegments, countPerType));

        if (samples.length < targetCount) {
            const remaining = segments.filter(s => !samples.includes(s));
            samples.push(...pickEvenly(remaining, targetCount - samples.length));
        }

        return samples.slice(0, targetCount);
    }

    private classifySegment(segment: string): 'dialogue' | 'description' | 'narration' {
        const dialogueIndicators = /[「『""]|说[道道]|问[道]|回答/;
        const descriptionIndicators = /[的地得].{0,5}[是像如同宛如犹如]|风景|景色|环境|气氛|感觉/;

        const dialogueMatches = (segment.match(dialogueIndicators) || []).length;
        const descriptionMatches = (segment.match(descriptionIndicators) || []).length;

        const dialogueRatio = dialogueMatches / Math.max(segment.length / 50, 1);
        const descriptionRatio = descriptionMatches / Math.max(segment.length / 50, 1);

        if (dialogueRatio > 0.3) return 'dialogue';
        if (descriptionRatio > 0.3) return 'description';
        return 'narration';
    }

    private async vectorize(
        fingerprintId: string,
        samples: string[],
        onProgress?: (progress: ExtractionProgress) => void,
        signal?: AbortSignal
    ): Promise<void> {
        onProgress?.({
            phase: 'vectorization',
            percent: 75,
            message: '正在向量化片段...',
        });

        this.checkAbort(signal);

        const total = samples.length;
        let processed = 0;

        const processBatch = async (batch: string[]): Promise<void> => {
            for (const sample of batch) {
                this.checkAbort(signal);
                await this.vectorStore.add(fingerprintId, [sample]);
                processed++;
                const percent = 75 + Math.round((processed / total) * 20);
                onProgress?.({
                    phase: 'vectorization',
                    percent,
                    message: `向量化中 (${processed}/${total})`,
                });
            }
        };

        await processBatch(samples);

        onProgress?.({
            phase: 'vectorization',
            percent: 95,
            message: '向量化完成',
        });
    }
}
