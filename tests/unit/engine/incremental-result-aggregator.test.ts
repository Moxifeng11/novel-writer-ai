import { describe, it, expect, vi } from 'vitest';
import { IncrementalResultAggregator } from '../../../engine/incremental-result-aggregator';
import type { StyleAnalysisResult } from '../../../engine/deconstructors/style-deconstructor';
import type { CommercialAnalysisResult } from '../../../engine/deconstructors/commercial-deconstructor';
import type { ReadabilityAnalysisResult } from '../../../engine/deconstructors/readability-deconstructor';

function createMockStyleResult(index: number): StyleAnalysisResult {
    return {
        sentenceRhythm: {
            avgSentenceLength: 10 + index,
            medianSentenceLength: 8 + index,
            stdSentenceLength: 3 + index,
            sentenceTypeDistribution: { declarative: 0.5, interrogative: 0.2, exclamatory: 0.2, elliptical: 0.1 },
            lengthDistribution: { short: 0.3, medium: 0.5, long: 0.2 },
        },
        wordPreference: {
            topWords: [{ word: `词${index}`, count: 10 + index, frequency: 0.1 }],
            posPreference: { verb: 0.4, adjective: 0.3, adverb: 0.3 },
            modalParticles: { total: 10, perThousand: 1.5, topParticles: [] },
            idiomDensity: 0.5,
            colloquialismLevel: 0.3,
        },
        narrativeStyle: {
            perspective: 'third_person_limited',
            perspectiveConfidence: 0.8,
            descriptionRatio: { appearance: 0.3, environment: 0.4, action: 0.3, psychology: 0, total: 1 },
            narrationRatio: 0.4,
            dialogueRatio: 0.2,
        },
        rhetoric: {
            metaphor: 3 + index,
            personification: 2 + index,
            parallelism: 3 + index,
            rhetoricalQuestion: 2 + index,
            hyperbole: 1 + index,
            antithesis: 1 + index,
            total: 12 + index,
            perThousand: 0.5,
        },
        dialogueStyle: {
            dialogueRatio: 0.6,
            promptWordPreference: [],
            avgDialogueLength: 2.5,
            lengthDistribution: { short: 0.5, medium: 0.3, long: 0.2 },
        },
        paragraphStructure: {
            avgParagraphLength: 5 + index,
            medianParagraphLength: 4 + index,
            lengthDistribution: { short: 0.3, medium: 0.4, long: 0.2, veryLong: 0.1 },
            openingFeatures: { timeWord: 0.2, conjunction: 0.3, subject: 0.3, other: 0.2 },
        },
        overallStyle: {
            primaryStyle: 'realistic',
            confidence: 0.8,
            styleScores: {},
        },
        stats: {
            totalChars: 1000 + index * 500,
            totalSentences: 50 + index * 20,
            totalParagraphs: 10 + index * 5,
        },
    };
}

function createMockCommercialResult(index: number): CommercialAnalysisResult {
    return {
        goldenThreeChapters: {
            totalScore: 60 + index * 5,
            subScores: {
                openingConflict: 50 + index * 5,
                infoDensity: 70 + index * 2,
                protagonistGoal: 60 + index * 3,
                goldenFinger: 55 + index * 8,
                chapterHooks: 65 + index * 3,
                characterImmersion: 55 + index * 4,
                worldviewAttraction: 60 + index * 3,
                dialogueQuality: 50 + index * 5,
                suspenseIntensity: 58 + index * 2,
                emotionalImpact: 52 + index * 4,
            },
            improvementSuggestions: index === 0 ? [
                { category: '开篇冲突密度', severity: 'medium', suggestion: '建议增强开篇冲突', location: '前三章' },
            ] : [],
            details: {
                firstChapter: { wordCount: 3000 + index * 500, conflictDensity: 0.3 + index * 0.05, hookStrength: 0.5 + index * 0.05, infoOverloadRisk: index === 0 },
                secondChapter: { wordCount: 2500 + index * 500, goalClarity: 0.4 + index * 0.1, goldenFingerHint: true, hookStrength: 0.5 + index * 0.05 },
                thirdChapter: { wordCount: 2800 + index * 500, miniClimax: index > 0, goldenFingerReveal: index > 0, hookStrength: 0.6 + index * 0.05 },
            },
        },
        waveRhythm: {
            complianceRate: 0.5 + index * 0.1,
            smallCoolPointInterval: 3 + index,
            mediumReversalInterval: 6 + index,
            bigClimaxInterval: 15 + index,
            violations: index === 0 ? [
                { type: 'small_cool', startChapter: 5, endChapter: 10, gap: 5, threshold: 2 },
            ] : [],
        },
        overallScore: 65 + index * 5,
        overallLevel: index === 0 ? 'C' : 'B',
    };
}

function createMockReadabilityResult(index: number): ReadabilityAnalysisResult {
    return {
        showTell: {
            overallRatio: 0.5 + index * 0.05,
            showPercentage: 45 + index * 3,
            tellPercentage: 35 - index * 2,
            segments: [
                {
                    startIndex: index * 100,
                    endIndex: index * 100 + 80,
                    type: index % 2 === 0 ? 'show' as const : 'tell' as const,
                    confidence: 0.7 + index * 0.05,
                    showScore: 0.6 + index * 0.05,
                    tellScore: 0.3 + index * 0.05,
                    excerpt: `段落 ${index}`,
                },
                {
                    startIndex: index * 100 + 80,
                    endIndex: index * 100 + 160,
                    type: 'mixed' as const,
                    confidence: 0.5 + index * 0.05,
                    showScore: 0.4 + index * 0.05,
                    tellScore: 0.4 + index * 0.05,
                    excerpt: `混合段 ${index}`,
                },
            ],
            highRiskTellSegments: index === 0 ? [
                { startIndex: 0, endIndex: 200, type: 'tell', confidence: 0.85, showScore: 0.2, tellScore: 0.8, excerpt: '高风险段' },
            ] : [],
            stats: {
                totalSegments: 2,
                showCount: 1,
                tellCount: index % 2 === 0 ? 1 : 0,
                mixedCount: index % 2 === 0 ? 0 : 1,
                avgShowScore: 0.5 + index * 0.05,
            },
            suggestions: index === 0 ? [
                { type: 'showTellRatio', severity: 'medium', message: 'Show 占比偏低，建议增加感官描写' },
            ] : [],
        },
        aiTrace: {
            overallScore: 30 + index * 10,
            level: index === 0 ? 'medium' as const : index === 1 ? 'medium' as const : 'high' as const,
            dimensions: {
                sentenceSimilarity: { score: 25 + index * 8, description: '句式变化一般', details: { cv: 0.3 + index * 0.05 } },
                connectorDensity: { score: 20 + index * 5, description: '连接词使用合理', details: { totalCount: 10 + index * 2 } },
                explanatoryEnding: { score: 15 + index * 5, description: '解释性收束句使用正常', details: { totalCount: 3 + index } },
                parallelismAbuse: { score: 30 + index * 8, description: '排比使用正常', details: { paragraphCount: 50 + index * 10 } },
                wordRepetition: { score: 25 + index * 6, description: '词汇重复率正常', details: { repeatedTrigrams: 8 + index * 2 } },
                emotionUniformity: { score: 20 + index * 5, description: '情感分布偏均匀', details: { variance: 2.5 + index * 0.5 } },
            },
            highRiskParagraphs: index === 0 ? [
                { startIndex: 0, endIndex: 150, score: 75, excerpt: '高风险段落', reasons: ['句式雷同', '连接词密度高'] },
            ] : [],
        },
        overallScore: 55 + index * 5,
    };
}

describe('IncrementalResultAggregator', () => {
    describe('基本操作', () => {
        it('初始为空', () => {
            const agg = new IncrementalResultAggregator();
            expect(agg.getAllPartialResults()).toEqual([]);
        });

        it('添加分段结果', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockStyleResult(0);

            agg.addSegmentResult('style', result, 0, 3);

            const partial = agg.getPartialResult('style');
            expect(partial).toBeDefined();
            expect(partial?.completedSegments).toBe(1);
            expect(partial?.totalSegments).toBe(3);
            expect(partial?.progress).toBeCloseTo(0.333, 2);
            expect(partial?.isComplete).toBe(false);
        });

        it('完成所有段后标记 complete', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('style', createMockStyleResult(i), i, 3);
            }

            const partial = agg.getPartialResult('style');
            expect(partial?.isComplete).toBe(true);
            expect(partial?.progress).toBe(1);
            expect(partial?.completedSegments).toBe(3);
        });

        it('markDimensionComplete 强制标记完成', () => {
            const agg = new IncrementalResultAggregator();

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 3);

            const before = agg.getPartialResult('style');
            expect(before?.isComplete).toBe(false);

            agg.markDimensionComplete('style');

            const after = agg.getPartialResult('style');
            expect(after?.isComplete).toBe(true);
            expect(after?.progress).toBe(1);
        });

        it('clear 清空所有结果', () => {
            const agg = new IncrementalResultAggregator();

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 1);
            expect(agg.getAllPartialResults().length).toBe(1);

            agg.clear();
            expect(agg.getAllPartialResults()).toEqual([]);
        });
    });

    describe('结果合并', () => {
        it('合并多个风格结果', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('style', createMockStyleResult(i), i, 3);
            }

            const partial = agg.getPartialResult('style');
            expect(partial?.combinedResult).toBeDefined();
            if (partial?.combinedResult) {
                const style = partial.combinedResult as StyleAnalysisResult;
                expect(style.stats.totalChars).toBe(1000 + 1500 + 2000);
                expect(style.stats.totalSentences).toBe(50 + 70 + 90);
                const weightedAvgSentenceLength = (10 * 1000 + 11 * 1500 + 12 * 2000) / (1000 + 1500 + 2000);
                expect(style.sentenceRhythm.avgSentenceLength).toBeCloseTo(weightedAvgSentenceLength, 1);
            }
        });

        it('单段结果也执行必要标准化', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockStyleResult(0);

            agg.addSegmentResult('style', result, 0, 1);

            const partial = agg.getPartialResult('style');
            const combined = partial?.combinedResult as StyleAnalysisResult;
            expect(combined.stats).toEqual(result.stats);
            expect(combined.rhetoric.perThousand).toBe(12);
            expect(combined.wordPreference.topWords[0].frequency).toBe(1);
        });
    });

    describe('回调机制', () => {
        it('onPartialResult 注册回调', () => {
            const agg = new IncrementalResultAggregator();
            let called = false;

            const unsubscribe = agg.onPartialResult(() => {
                called = true;
            });

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 1);

            expect(called).toBe(true);
            unsubscribe();
        });

        it('unsubscribe 后不再调用', () => {
            const agg = new IncrementalResultAggregator();
            let callCount = 0;

            const unsubscribe = agg.onPartialResult(() => {
                callCount++;
            });

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 3);
            unsubscribe();
            agg.addSegmentResult('style', createMockStyleResult(1), 1, 3);

            expect(callCount).toBe(1);
        });

        it('防抖机制', async () => {
            const agg = new IncrementalResultAggregator({ debounceMs: 100 });
            let callCount = 0;

            agg.onPartialResult(() => {
                callCount++;
            });

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 10);
            agg.addSegmentResult('style', createMockStyleResult(1), 1, 10);

            await new Promise(r => setTimeout(r, 50));

            agg.addSegmentResult('style', createMockStyleResult(2), 2, 10);

            await new Promise(r => setTimeout(r, 150));

            expect(callCount).toBeGreaterThan(0);
        });

        it('进度阈值触发', () => {
            const agg = new IncrementalResultAggregator({ debounceMs: 10000, progressThreshold: 0.5 });
            let callCount = 0;

            agg.onPartialResult(() => {
                callCount++;
            });

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 10);
            expect(callCount).toBe(1);

            agg.addSegmentResult('style', createMockStyleResult(1), 1, 10);
            expect(callCount).toBe(1);

            agg.addSegmentResult('style', createMockStyleResult(2), 2, 10);
            agg.addSegmentResult('style', createMockStyleResult(3), 3, 10);
            agg.addSegmentResult('style', createMockStyleResult(4), 4, 10);
            agg.addSegmentResult('style', createMockStyleResult(5), 5, 10);
            expect(callCount).toBe(2);
        });

        it('完成时强制触发回调', () => {
            const agg = new IncrementalResultAggregator({ debounceMs: 10000, progressThreshold: 0.5 });
            let callCount = 0;

            agg.onPartialResult(() => {
                callCount++;
            });

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 2);
            expect(callCount).toBe(1);

            agg.addSegmentResult('style', createMockStyleResult(1), 1, 2);
            expect(callCount).toBe(2);
        });
    });

    describe('多维度支持', () => {
        it('支持所有 6 个维度', () => {
            const agg = new IncrementalResultAggregator();
            const dimensions: Array<'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow'> =
                ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];

            for (const dim of dimensions) {
                agg.addSegmentResult(dim, {} as any, 0, 1);
            }

            expect(agg.getAllPartialResults().length).toBe(6);
        });

        it('支持所有 8 个维度（含 commercial 和 readability）', () => {
            const agg = new IncrementalResultAggregator();
            const dimensions = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability'] as const;

            for (const dim of dimensions) {
                if (dim === 'commercial') {
                    agg.addSegmentResult(dim, createMockCommercialResult(0), 0, 1);
                } else if (dim === 'readability') {
                    agg.addSegmentResult(dim, createMockReadabilityResult(0), 0, 1);
                } else {
                    agg.addSegmentResult(dim, {} as any, 0, 1);
                }
            }

            expect(agg.getAllPartialResults().length).toBe(8);
        });

        it('各维度独立追踪进度', () => {
            const agg = new IncrementalResultAggregator();

            agg.addSegmentResult('style', createMockStyleResult(0), 0, 3);
            agg.addSegmentResult('rhythm', {} as any, 0, 2);
            agg.addSegmentResult('style', createMockStyleResult(1), 1, 3);

            const style = agg.getPartialResult('style');
            const rhythm = agg.getPartialResult('rhythm');

            expect(style?.progress).toBeCloseTo(0.666, 2);
            expect(rhythm?.progress).toBe(0.5);
        });
    });

    describe('commercial 维度聚合', () => {
        it('单块也附加等权合并口径', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockCommercialResult(0);

            agg.addSegmentResult('commercial', result, 0, 1);

            const partial = agg.getPartialResult('commercial');
            const combined = partial?.combinedResult as CommercialAnalysisResult;
            expect(combined.overallScore).toBe(result.overallScore);
            expect(combined.aggregation).toEqual({ segmentCount: 1, weightingStrategy: 'equal', dataStatus: 'complete' });
        });

        it('多分块合并：overallScore 取平均', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const partial = agg.getPartialResult('commercial');
            const combined = partial?.combinedResult as CommercialAnalysisResult;
            // overallScore: (65 + 70 + 75) / 3 = 70
            expect(combined.overallScore).toBe(70);
        });

        it('多分块合并：overallLevel 根据平均分重新计算', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult;
            // avg = 70 → level B
            expect(combined.overallLevel).toBe('B');
        });

        it('多分块合并：openingConflict 保留第一块', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult;
            // 第一块的 openingConflict = 50
            expect(combined.goldenThreeChapters.subScores.openingConflict).toBe(50);
        });

        it('多分块合并：goldenThreeChapters 整体保留第一块', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult;
            // 第一块有 suggestion，后续块没有
            expect(combined.goldenThreeChapters.improvementSuggestions.length).toBe(1);
            expect(combined.goldenThreeChapters.details.firstChapter.infoOverloadRisk).toBe(true);
        });

        it('多分块合并：waveRhythm violations 合并', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult;
            // 只有 index=0 有 violations，合并后应有 1 条
            expect(combined.waveRhythm?.violations.length).toBe(1);
        });

        it('多分块合并：waveRhythm 间隔取平均', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('commercial', createMockCommercialResult(i), i, 3);
            }

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult;
            // smallCoolPointInterval: (3 + 4 + 5) / 3 = 4
            expect(combined.waveRhythm?.smallCoolPointInterval).toBe(4);
            // mediumReversalInterval: (6 + 7 + 8) / 3 = 7
            expect(combined.waveRhythm?.mediumReversalInterval).toBe(7);
            // bigClimaxInterval: (15 + 16 + 17) / 3 = 16
            expect(combined.waveRhythm?.bigClimaxInterval).toBe(16);
            // complianceRate: (0.5 + 0.6 + 0.7) / 3 = 0.6
            expect(combined.waveRhythm?.complianceRate).toBe(0.6);
        });
    });

    describe('readability 维度聚合', () => {
        it('单块也执行可读性标准化并附加合并状态', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockReadabilityResult(0);

            agg.addSegmentResult('readability', result, 0, 1);

            const partial = agg.getPartialResult('readability');
            const combined = partial?.combinedResult as ReadabilityAnalysisResult;
            expect(combined.showTell.stats.totalSegments).toBe(2);
            expect(combined.aggregation).toEqual({ segmentCount: 1, dataStatus: 'complete' });
        });

        it('多分块合并：overallScore 取平均', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // (55 + 60 + 65) / 3 = 60
            expect(combined.overallScore).toBe(60);
        });

        it('多分块合并：showTell segments 合并累加', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // 每块 2 个 segment，3 块 = 6 个
            expect(combined.showTell.segments.length).toBe(6);
            expect(combined.showTell.stats.totalSegments).toBe(6);
        });

        it('多分块合并：showTell stats 重新计算', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // index 0: show, mixed → 1 show
            // index 1: tell, mixed → 1 tell
            // index 2: show, mixed → 1 show
            // total: 2 show, 1 tell, 3 mixed
            expect(combined.showTell.stats.showCount).toBe(2);
            expect(combined.showTell.stats.tellCount).toBe(1);
            expect(combined.showTell.stats.mixedCount).toBe(3);
        });

        it('多分块合并：showTell suggestions 合并去重', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // 只有 index 0 有 suggestion
            expect(combined.showTell.suggestions.length).toBe(1);
        });

        it('多分块合并：aiTrace 各维度取平均', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            const dims = combined.aiTrace.dimensions;
            // sentenceSimilarity: (25 + 33 + 41) / 3 = 33
            expect(dims.sentenceSimilarity.score).toBe(33);
            // parallelismAbuse: (30 + 38 + 46) / 3 = 38
            expect(dims.parallelismAbuse.score).toBe(38);
            // wordRepetition: (25 + 31 + 37) / 3 = 31
            expect(dims.wordRepetition.score).toBe(31);
        });

        it('多分块合并：aiTrace overallScore 重新计算', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // 六维平均: (33 + 25 + 20 + 38 + 31 + 25) / 6 ≈ 28.67
            expect(combined.aiTrace.overallScore).toBeCloseTo(28.67, 1);
        });

        it('多分块合并：aiTrace level 重新计算', () => {
            const agg = new IncrementalResultAggregator();

            // 高分场景: 让 aiTrace score 超过 60（用 i+6，即 index 6/7/8）
            for (let i = 0; i < 3; i++) {
                const r = createMockReadabilityResult(i + 6);
                agg.addSegmentResult('readability', r, i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // 各维分数都很高 → level high
            expect(combined.aiTrace.level).toBe('high');
        });

        it('多分块合并：highRiskParagraphs 合并排序取前 10', () => {
            const agg = new IncrementalResultAggregator();

            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('readability', createMockReadabilityResult(i), i, 3);
            }

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult;
            // 只有 index=0 有高风险段落，合并后应有 1 条
            expect(combined.aiTrace.highRiskParagraphs.length).toBe(1);
        });
    });

    describe('分段聚合修复', () => {
        it('单段商业结果也应补齐结构化等权合并口径', () => {
            const agg = new IncrementalResultAggregator();

            agg.addSegmentResult('commercial', createMockCommercialResult(0), 0, 1);

            const combined = agg.getPartialResult('commercial')?.combinedResult as CommercialAnalysisResult & {
                aggregation: { segmentCount: number; weightingStrategy: string; dataStatus: string };
            };
            expect(combined.aggregation).toEqual({
                segmentCount: 1,
                weightingStrategy: 'equal',
                dataStatus: 'complete',
            });
        });

        it('单段技术手法结果也应提供结构化合并状态', () => {
            const agg = new IncrementalResultAggregator();
            const result = {
                techniques: [],
                categoryDistribution: { structure: 0, cool_point: 0, emotion: 0, rhythm: 0, genre: 0, style: 0 },
                topTechniques: [],
                stats: { totalTechniques: 0, totalExamples: 0, avgConfidence: 0 },
            } as any;

            agg.addSegmentResult('technique', result, 0, 1);

            const combined = agg.getPartialResult('technique')?.combinedResult as {
                aggregation: { segmentCount: number; dataStatus: string };
            };
            expect(combined.aggregation).toEqual({ segmentCount: 1, dataStatus: 'complete' });
        });

        it('结构化数据不足状态应触发可读性规则估算，不依赖展示文案', () => {
            const agg = new IncrementalResultAggregator();
            const first = createMockReadabilityResult(0) as any;
            const second = createMockReadabilityResult(1) as any;
            for (const result of [first, second]) {
                result.aiTrace.dimensions.sentenceSimilarity = {
                    score: 0,
                    description: 'metric unavailable',
                    details: {},
                    dataStatus: 'insufficient',
                };
            }

            agg.addSegmentResult('readability', first, 0, 2);
            agg.addSegmentResult('readability', second, 1, 2);

            const combined = agg.getPartialResult('readability')?.combinedResult as ReadabilityAnalysisResult & {
                aggregation: { dataStatus: string };
            };
            expect(combined.aiTrace.dimensions.sentenceSimilarity.score).toBeGreaterThan(0);
            expect(combined.aiTrace.dimensions.sentenceSimilarity.dataStatus).toBe('estimated');
            expect(combined.aggregation.dataStatus).toBe('partial');
        });

        it('伏笔名称中的正常汉字不同，必须保留为不同实体', () => {
            const agg = new IncrementalResultAggregator();
            const makeSegment = (name: string) => ({
                foreshadows: [{
                    id: name,
                    name,
                    type: 'item',
                    importance: 0.5,
                    setup: { position: 1, chapter: 1, excerpt: '' },
                    totalAppearances: 1,
                    importantAppearances: [],
                }],
                typeDistribution: { item: 1, skill: 0, character: 0, setting: 0, event: 0 },
                stats: { totalForeshadows: 1, resolvedCount: 0, unresolvedCount: 1, avgImportance: 0.5 },
                timeline: [],
            });

            agg.addSegmentResult('foreshadow', makeSegment('月之匙') as any, 0, 2);
            agg.addSegmentResult('foreshadow', makeSegment('月匙') as any, 1, 2);

            const combined = agg.getPartialResult('foreshadow')?.combinedResult as any;
            expect(combined.foreshadows.map((item: { name: string }) => item.name).sort()).toEqual(['月之匙', '月匙']);
        });

        function makeStructureSeg(volumeIdx: number, chapterTitles: string[], wordCount: number): any {
            const rhythmUnits: any[] = [
                { level: 'volume', title: `第${volumeIdx}卷`, index: 1, startPosition: volumeIdx * 100000, endPosition: volumeIdx * 100000 + 99999, wordCount },
                ...chapterTitles.map((t, i) => ({ level: 'chapter', title: t, index: i + 1, startPosition: volumeIdx * 100000 + i * 3000, endPosition: volumeIdx * 100000 + i * 3000 + 2999, wordCount: Math.round(wordCount / chapterTitles.length) })),
            ];
            return {
                qcchSegments: [],
                rhythmUnits,
                threeLineStructure: {
                    mainLine: { description: `第${volumeIdx}卷主线`, keyNodes: [] },
                    subLine: { description: '', keyNodes: [] },
                    romanceLine: { description: '', keyNodes: [] },
                },
                structureType: '短篇单篇结构',
                stats: { volumeCount: 1, chapterCount: chapterTitles.length, avgChapterWordCount: Math.round(wordCount / chapterTitles.length), totalWordCount: wordCount },
            };
        }

        it('结构聚合应跨段累加章数与字数，而非只取末段', () => {
            const agg = new IncrementalResultAggregator();
            const segs = [
                makeStructureSeg(1, ['第一章', '第二章', '第三章'], 30000),
                makeStructureSeg(2, ['第四章', '第五章', '第六章'], 33000),
                makeStructureSeg(3, ['第七章'], 12000),
            ];
            segs.forEach((s, i) => agg.addSegmentResult('structure', s, i, segs.length));

            const combined = agg.getPartialResult('structure')?.combinedResult as any;
            expect(combined.stats.totalWordCount).toBe(30000 + 33000 + 12000);
            expect(combined.stats.chapterCount).toBe(7);
            expect(combined.stats.volumeCount).toBe(3);
            expect(combined.structureType).not.toBe('短篇单篇结构');
        });

        function makeCharacterSeg(clineAppear: number, extraName: string | null, appearance: number): any {
            const chars: any[] = [
                { name: '克莱恩', aliases: ['小丑'], role: 'protagonist', importance: 0.9, appearanceCount: clineAppear, mentionCount: clineAppear * 2, firstAppearance: 1, lastAppearance: 50, abilities: ['占卜'], personality: ['谨慎'], growthStages: [], relationships: [] },
            ];
            if (extraName) {
                chars.push({ name: extraName, aliases: [], role: 'supporting', importance: 0.4, appearanceCount: appearance, mentionCount: appearance, firstAppearance: 5, lastAppearance: 20, abilities: [], personality: [], growthStages: [], relationships: [] });
            }
            return { characters: chars, mainCharacter: chars[0], relations: [], stats: { totalCharacters: chars.length, mainCharacterCount: 1, avgAppearancePerCharacter: 0 } };
        }

        it('人设聚合应按姓名归并，克莱恩为单条且出现次数累加', () => {
            const agg = new IncrementalResultAggregator();
            const segs = [
                makeCharacterSeg(100, '奥黛丽', 30),
                makeCharacterSeg(120, '奥黛丽', 25),
                makeCharacterSeg(80, '梅丽莎', 15),
            ];
            segs.forEach((s, i) => agg.addSegmentResult('character', s, i, segs.length));

            const combined = agg.getPartialResult('character')?.combinedResult as any;
            const cline = combined.characters.filter((c: any) => c.name === '克莱恩');
            expect(cline.length).toBe(1);
            expect(cline[0].appearanceCount).toBe(300);
            expect(cline[0].abilities.length).toBeLessThanOrEqual(10);
            const audrey = combined.characters.filter((c: any) => c.name === '奥黛丽');
            expect(audrey.length).toBe(1);
            expect(audrey[0].appearanceCount).toBe(55);
            expect(combined.stats.totalCharacters).toBe(3);
        });

        it('角色判定全局化：分段内被标记为 protagonist 的低频配角应按全局统计降级', () => {
            const agg = new IncrementalResultAggregator();
            const makeSeg = () => ({
                characters: [
                    { name: '克莱恩', aliases: [], role: 'protagonist', importance: 0.9, appearanceCount: 250, mentionCount: 500, dialogueCount: 100, perspectiveCount: 90, keyEventCount: 30, firstAppearance: 1, lastAppearance: 100, abilities: [], personality: [], growthStages: [], relationships: [] },
                    { name: '布提斯', aliases: [], role: 'protagonist', importance: 0.8, appearanceCount: 87, mentionCount: 100, dialogueCount: 10, perspectiveCount: 2, keyEventCount: 4, firstAppearance: 10, lastAppearance: 60, abilities: [], personality: [], growthStages: [], relationships: [] },
                ],
                mainCharacter: null,
                relations: [],
                stats: { totalCharacters: 2, mainCharacterCount: 2, avgAppearancePerCharacter: 0 },
            } as any);
            agg.addSegmentResult('character', makeSeg(), 0, 2);
            agg.addSegmentResult('character', makeSeg(), 1, 2);

            const combined = agg.getPartialResult('character')?.combinedResult as any;
            const cline = combined.characters.find((c: any) => c.name === '克莱恩');
            const putisi = combined.characters.find((c: any) => c.name === '布提斯');
            expect(cline.role).toBe('protagonist');
            expect(putisi.role).not.toBe('protagonist');
        });

        function makeForeshadowSeg(ids: string[]): any {
            return {
                foreshadows: ids.map(id => ({ id, name: `伏笔${id}`, type: 'event', importance: 0.5, setup: { position: 1, chapter: 1, excerpt: '' }, totalAppearances: 2, importantAppearances: [] })),
                typeDistribution: { item: 0, skill: 0, character: 0, setting: 0, event: ids.length },
                stats: { totalForeshadows: ids.length, resolvedCount: 0, unresolvedCount: ids.length, avgImportance: 0.5 },
                timeline: [],
            };
        }

        it('伏笔聚合应按 id 去重，不因分段重复计数', () => {
            const agg = new IncrementalResultAggregator();
            const segs = [
                makeForeshadowSeg(['A', 'B']),
                makeForeshadowSeg(['B', 'C']),
                makeForeshadowSeg(['C', 'D']),
            ];
            segs.forEach((s, i) => agg.addSegmentResult('foreshadow', s, i, segs.length));

            const combined = agg.getPartialResult('foreshadow')?.combinedResult as any;
            const ids = combined.foreshadows.map((f: any) => f.id).sort();
            expect(ids).toEqual(['A', 'B', 'C', 'D']);
            expect(combined.stats.totalForeshadows).toBe(4);
        });

        it('风格子字段（对话/段落/整体）应跨段合并而非取末段', () => {
            const agg = new IncrementalResultAggregator();
            for (let i = 0; i < 3; i++) {
                agg.addSegmentResult('style', createMockStyleResult(i), i, 3);
            }
            const style = agg.getPartialResult('style')?.combinedResult as StyleAnalysisResult;
            // paragraphStructure.avgParagraphLength 为 5/6/7 按字数(1000/1500/2000)加权
            const expected = (5 * 1000 + 6 * 1500 + 7 * 2000) / (1000 + 1500 + 2000);
            expect(style.paragraphStructure.avgParagraphLength).toBeCloseTo(expected, 1);
            expect(style.dialogueStyle.dialogueRatio).toBeCloseTo(0.6, 2);
        });

        it('视角结论一致时应保留并提升合并置信度', () => {
            const agg = new IncrementalResultAggregator();
            const first = createMockStyleResult(0);
            const second = createMockStyleResult(1);
            first.narrativeStyle.perspectiveConfidence = 0.8;
            second.narrativeStyle.perspectiveConfidence = 0.8;

            agg.addSegmentResult('style', first, 0, 2);
            agg.addSegmentResult('style', second, 1, 2);

            const combined = agg.getPartialResult('style')?.combinedResult as StyleAnalysisResult;
            expect(combined.narrativeStyle.perspective).toBe('third_person_limited');
            expect(combined.narrativeStyle.perspectiveConfidence).toBeCloseTo(0.84, 2);
        });

        it('视角结论冲突时应降低合并置信度', () => {
            const agg = new IncrementalResultAggregator();
            const first = createMockStyleResult(0);
            const second = createMockStyleResult(1);
            second.narrativeStyle.perspective = 'first_person';

            agg.addSegmentResult('style', first, 0, 2);
            agg.addSegmentResult('style', second, 1, 2);

            const combined = agg.getPartialResult('style')?.combinedResult as StyleAnalysisResult;
            expect(combined.narrativeStyle.perspectiveConfidence).toBeLessThan(0.8);
            expect(combined.narrativeStyle.perspectiveConfidence).toBeCloseTo(0.34, 2);
        });

        it('节奏方差应采用包含段间差异的池化口径', () => {
            const agg = new IncrementalResultAggregator();
            const makeRhythmSegment = (avgRhythm: number) => ({
                emotionCurve: [{ position: 0, intensity: avgRhythm }],
                emotionPoints: [],
                plotStages: [],
                structureMatches: [],
                coolPoints: [],
                mainThreadSwitches: [],
                stats: {
                    avgRhythm,
                    rhythmVariance: 1,
                    climaxCount: 0,
                    coolPointCount: 0,
                    avgEmotionIntensity: 0,
                },
            });

            agg.addSegmentResult('rhythm', makeRhythmSegment(2) as any, 0, 2);
            agg.addSegmentResult('rhythm', makeRhythmSegment(8) as any, 1, 2);

            const combined = agg.getPartialResult('rhythm')?.combinedResult as any;
            expect(combined.stats.avgRhythm).toBe(5);
            expect(combined.stats.rhythmVariance).toBe(10);
            expect(combined.stats.rhythmVariance).toBeGreaterThan(1);
        });

        it('单段角色也应按全局统计重判角色并重算统计摘要', () => {
            const agg = new IncrementalResultAggregator();
            const result = {
                characters: [
                    { name: '误判主角', aliases: [], role: 'protagonist', appearanceCount: 10, mentionCount: 20, dialogueCount: 1, perspectiveCount: 0, keyEventCount: 0, firstAppearance: 1, lastAppearance: 10, abilities: [], personality: [], growthStages: [], relationships: [] },
                    { name: '真正主角', aliases: [], role: 'supporting', appearanceCount: 100, mentionCount: 200, dialogueCount: 50, perspectiveCount: 30, keyEventCount: 20, firstAppearance: 1, lastAppearance: 100, abilities: [], personality: [], growthStages: [], relationships: [] },
                ],
                mainCharacter: null,
                relations: [],
                stats: { totalCharacters: 2, mainCharacterCount: 1, avgAppearancePerCharacter: 0 },
            } as any;

            agg.addSegmentResult('character', result, 0, 1);

            const combined = agg.getPartialResult('character')?.combinedResult as any;
            const mistaken = combined.characters.find((character: any) => character.name === '误判主角');
            const protagonist = combined.characters.find((character: any) => character.name === '真正主角');
            expect(protagonist.role).toBe('protagonist');
            expect(mistaken.role).not.toBe('protagonist');
            expect(combined.mainCharacter.name).toBe('真正主角');
            expect(combined.stats).toEqual({ totalCharacters: 2, mainCharacterCount: 1, avgAppearancePerCharacter: 55 });
            expect(protagonist.importance.totalScore).toBe(85);
        });

        it('修辞速率应由合并总数与总字数重算', () => {
            const agg = new IncrementalResultAggregator();
            const first = createMockStyleResult(0);
            const second = createMockStyleResult(1);

            agg.addSegmentResult('style', first, 0, 2);
            agg.addSegmentResult('style', second, 1, 2);

            const combined = agg.getPartialResult('style')?.combinedResult as StyleAnalysisResult;
            expect(combined.rhetoric.total).toBe(30);
            expect(combined.rhetoric.perThousand).toBe(12);
        });
    });
});
