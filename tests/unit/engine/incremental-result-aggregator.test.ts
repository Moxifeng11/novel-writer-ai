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
                expect(style.sentenceRhythm.avgSentenceLength).toBeCloseTo((10 + 11 + 12) / 3, 1);
            }
        });

        it('单段结果直接返回', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockStyleResult(0);

            agg.addSegmentResult('style', result, 0, 1);

            const partial = agg.getPartialResult('style');
            expect(partial?.combinedResult).toEqual(result);
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
        it('单块直通', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockCommercialResult(0);

            agg.addSegmentResult('commercial', result, 0, 1);

            const partial = agg.getPartialResult('commercial');
            expect(partial?.combinedResult).toEqual(result);
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
        it('单块直通', () => {
            const agg = new IncrementalResultAggregator();
            const result = createMockReadabilityResult(0);

            agg.addSegmentResult('readability', result, 0, 1);

            const partial = agg.getPartialResult('readability');
            expect(partial?.combinedResult).toEqual(result);
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
});
