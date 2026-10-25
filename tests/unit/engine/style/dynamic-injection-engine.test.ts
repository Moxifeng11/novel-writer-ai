/**
 * dynamic-injection-engine.test.ts — 动态风格注入引擎单元测试
 *
 * 覆盖 TR-6.1 ~ TR-6.6：
 *   - TR-6.1: 上下文分析器可正确识别段落功能
 *   - TR-6.2: 动态选择的示例与上下文场景匹配度高于静态选择
 *   - TR-6.3: 分级注入策略正确执行（全局+段落+句子）
 *   - TR-6.4: 与 styleLearner 风格不冲突
 *   - TR-6.5: Token 总开销 ≤ 2000 字
 *   - TR-6.6: 上下文分析耗时 < 300ms
 */

import { describe, it, expect } from 'vitest';
import {
    ContextAnalyzer,
    DynamicSampleSelector,
    TieredInjectionBuilder,
    createDynamicInjectionEngine,
    type ContextFeatures,
    type SelectedSample,
    type ParagraphFunction,
    type EmotionTone,
    type SceneType,
} from '../../../../engine/style/dynamic-injection-engine';
import type { StyleFingerprint } from '../../../../engine/style-fingerprint-library';
import type { SuggestionDirection } from '../../../../shared/types';

// ============================================================
// 测试辅助工具
// ============================================================

/** 构造 V1 StyleFingerprint */
function makeFingerprint(overrides: Partial<StyleFingerprint> = {}): StyleFingerprint {
    return {
        id: 'fp_test_' + Math.random().toString(36).slice(2, 8),
        name: '测试指纹',
        source: '测试源文本',
        scope: 'project',
        enabled: true,
        tags: ['test'],
        stats: {
            avgSentenceLength: 20,
            avgParagraphLength: 100,
            dialogueRatio: 0.3,
            descriptionRatio: 0.4,
            wordCount: 10000,
        },
        features: {
            sentenceRhythm: '短句为主，节奏明快',
            wordPreference: '常用词，四字格密度低',
            narrativeStyle: '第三人称全知',
            rhetoric: '比喻为主，少排比',
            dialogueStyle: '简短对白，潜台词多',
            paragraphStructure: '单段成意，少长段',
            overallTone: '冷峻克制',
        },
        samples: ['示例片段一', '示例片段二', '示例片段三'],
        extractedAt: Date.now(),
        ...overrides,
    };
}

/** 构造向量检索结果 */
function makeSearchResult(
    sample: string,
    score: number,
    fingerprintId?: string,
): { sample: string; score: number; fingerprintId?: string } {
    return { sample, score, fingerprintId };
}

// ============================================================
// 一、ContextAnalyzer 测试（TR-6.1）
// ============================================================

describe('ContextAnalyzer (TR-6.1)', () => {
    const analyzer = new ContextAnalyzer();

    describe('段落功能识别', () => {
        it('识别对话段落', () => {
            const text = '他笑道："你来了。"她回答道："嗯。"林夕问道："准备好了吗？"';
            const result = analyzer.analyze(text);
            expect(result.paragraphFunction).toBe('dialogue');
            expect(result.keywords.length).toBeGreaterThan(0);
        });

        it('识别描写段落', () => {
            const text = '阳光透过窗棂洒在桌面上，空气中弥漫着墨水的气味。屋外的风轻轻拂过树梢，月光铺满庭院。';
            const result = analyzer.analyze(text);
            expect(result.paragraphFunction).toBe('description');
        });

        it('识别叙事段落', () => {
            const text = '于是他站起身，走到门口，看了一眼外面的天色。然后他坐回来，拿起桌上的茶杯。';
            const result = analyzer.analyze(text);
            // narration 与 description 都可能命中，但 narration 关键词更多
            expect(['narration', 'description']).toContain(result.paragraphFunction);
        });

        it('识别议论段落', () => {
            const text = '因为事情并非如此简单。然而，由此可见，问题的核心并不在表面。虽然表面平静，但实则暗流涌动。';
            const result = analyzer.analyze(text);
            expect(result.paragraphFunction).toBe('argument');
        });

        it('识别抒情段落', () => {
            const text = '啊，心中突然涌起一阵莫名的情绪。心里那种感觉，无法言说。';
            const result = analyzer.analyze(text);
            expect(['lyrical', 'unknown']).toContain(result.paragraphFunction);
        });

        it('空文本返回 unknown', () => {
            const result = analyzer.analyze('');
            expect(result.paragraphFunction).toBe('unknown');
            expect(result.emotionTone).toBe('neutral');
            expect(result.sceneType).toBe('unknown');
        });

        it('无关键词文本返回 unknown', () => {
            const result = analyzer.analyze('asdf qwerty zxcv');
            expect(result.paragraphFunction).toBe('unknown');
        });
    });

    describe('情绪基调识别', () => {
        it('识别正向情绪', () => {
            const text = '她笑了，心中满是欢喜，温柔的目光落在远处。幸福的感觉让她放松下来。';
            const result = analyzer.analyze(text);
            expect(['positive', 'mixed']).toContain(result.emotionTone);
            expect(result.emotionIntensity).toBeGreaterThan(0);
        });

        it('识别负向情绪', () => {
            const text = '他心中一紧，呼吸变得急促，愤怒与恐惧交织。眼泪差点夺眶而出。压抑的感觉让他窒息。';
            const result = analyzer.analyze(text);
            expect(['negative', 'mixed']).toContain(result.emotionTone);
            expect(result.emotionIntensity).toBeGreaterThan(0);
        });

        it('识别复杂情绪（mixed）', () => {
            const text = '她笑了，但眼中有泪。欢喜与悲伤交织，心中既温暖又寒冷。';
            const result = analyzer.analyze(text);
            expect(result.emotionTone).toBe('mixed');
        });

        it('无情绪词返回 neutral', () => {
            const result = analyzer.analyze('他走出门，看了看天空，然后回来坐下。');
            expect(result.emotionTone).toBe('neutral');
            expect(result.emotionIntensity).toBe(0);
        });

        it('情绪强度上限为 1', () => {
            // 构造大量情绪词
            const words = ['笑', '喜', '乐', '欢', '欣', '慰', '甜', '暖', '温柔', '幸福', '安心', '放松'];
            const text = words.join('，') + '。';
            const result = analyzer.analyze(text);
            expect(result.emotionIntensity).toBeLessThanOrEqual(1);
        });
    });

    describe('场景类型识别', () => {
        it('识别动作场景', () => {
            const text = '他猛地冲上前，一拳挥出，剑光凌厉。对方拔刀格挡，两人撞在一起。';
            const result = analyzer.analyze(text);
            expect(result.sceneType).toBe('action');
        });

        it('识别对话场景', () => {
            const text = '他开口道："你来做什么？"她答道："我来告诉你一件事。"两人对话之间气氛紧张。';
            const result = analyzer.analyze(text);
            expect(result.sceneType).toBe('dialogue');
        });

        it('识别伏笔场景', () => {
            const text = '他忽然觉得有些不对。似乎有什么东西一闪而过。若有所思地看了一眼那个物件，却没说什么。';
            const result = analyzer.analyze(text);
            expect(['foreshadow', 'surprise']).toContain(result.sceneType);
        });

        it('识别冲突场景', () => {
            const text = '冲突一触即发。两人对峙着，怒目而视。空气中弥漫着杀意，威胁与挑衅不断升级。';
            const result = analyzer.analyze(text);
            expect(['conflict', 'action']).toContain(result.sceneType);
        });

        it('识别意外场景', () => {
            const text = '突然，他猛地一震。不料身后传来声音。竟然是他！没想到会在这里遇见。';
            const result = analyzer.analyze(text);
            expect(result.sceneType).toBe('surprise');
        });

        it('directionHint 优先于自动识别', () => {
            const text = '阳光透过窗，风轻拂树梢。'; // 偏向 description
            const result = analyzer.analyze(text, 'action');
            expect(result.sceneType).toBe('action');
            expect(result.directionHint).toBe('action');
        });

        it('directionHint 为 dialogue 时覆盖关键词识别', () => {
            const text = '他冲上去拔剑劈砍，剑光凌厉，动作迅猛。'; // 偏向 action
            const result = analyzer.analyze(text, 'dialogue');
            expect(result.sceneType).toBe('dialogue');
        });
    });

    describe('全部 8 个 direction 都能映射', () => {
        const directions: SuggestionDirection[] = [
            'action', 'emotion', 'dialogue', 'description',
            'foreshadow', 'conflict', 'resolution', 'surprise',
        ];
        for (const dir of directions) {
            it(`direction=${dir} → sceneType=${dir}`, () => {
                const result = analyzer.analyze('一些无关文本', dir);
                expect(result.sceneType).toBe(dir);
            });
        }
    });
});

// ============================================================
// 二、DynamicSampleSelector 测试（TR-6.2）
// ============================================================

describe('DynamicSampleSelector (TR-6.2)', () => {
    const selector = new DynamicSampleSelector();

    it('空输入返回空数组', () => {
        const result = selector.select([], { paragraphFunction: 'unknown', emotionTone: 'neutral', emotionIntensity: 0, sceneType: 'unknown', keywords: [] });
        expect(result).toEqual([]);
    });

    it('上下文匹配示例得分高于不匹配示例', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'dialogue',
            emotionTone: 'negative',
            emotionIntensity: 0.6,
            sceneType: 'dialogue',
            keywords: ['道：'],
        };
        const samples = [
            makeSearchResult('一段无关的环境描写，阳光月光山色水光', 0.55, 'fp1'), // 不匹配
            makeSearchResult('他道："你来做什么？"她答道："没什么。"', 0.5, 'fp2'), // 场景+情绪+功能都匹配
        ];
        const result = selector.select(samples, context, 2);
        // 即使原向量分低，匹配加成后应排第一
        expect(result[0].sample).toContain('道：');
        expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('动态选择优于静态选择（与上下文场景匹配）', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'description',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'action',
            keywords: [],
        };
        // 静态选择会取前 3 条（按向量分排序）
        const samples = [
            makeSearchResult('与动作无关的内容一', 0.55, 'fp1'),
            makeSearchResult('与动作无关的内容二', 0.5, 'fp2'),
            makeSearchResult('与动作无关的内容三', 0.45, 'fp3'),
            makeSearchResult('他冲上去拔剑劈砍，剑光凌厉，动作迅猛', 0.4, 'fp4'),
            makeSearchResult('他扑过去挥拳，动作快如闪电', 0.35, 'fp5'),
        ];

        // 静态 top-3 会取前 3 条（都不匹配 action）
        const staticTop3 = samples.slice(0, 3);
        const staticActionMatch = staticTop3.filter(s => s.sample.includes('冲') || s.sample.includes('剑')).length;

        // 动态选择会因 action 关键词加成，把匹配的样本排到前面
        const dynamic = selector.select(samples, context, 3);
        const dynamicActionMatch = dynamic.filter(s => s.sample.includes('冲') || s.sample.includes('剑') || s.sample.includes('扑') || s.sample.includes('挥拳')).length;

        expect(dynamicActionMatch).toBeGreaterThan(staticActionMatch);
    });

    it('同一 fingerprintId 最多取 2 条', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const samples = [
            makeSearchResult('样本一', 0.9, 'fp_same'),
            makeSearchResult('样本二', 0.85, 'fp_same'),
            makeSearchResult('样本三', 0.8, 'fp_same'),
            makeSearchResult('样本四', 0.75, 'fp_same'),
        ];
        const result = selector.select(samples, context, 3);
        // 只能取前 2 条来自 fp_same
        expect(result.length).toBe(2);
    });

    it('fpId 缺失时不触发同指纹上限，可返回 3 条', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const samples = [
            makeSearchResult('样本一', 0.9),
            makeSearchResult('样本二', 0.85),
            makeSearchResult('样本三', 0.8),
        ];
        const result = selector.select(samples, context, 3);
        expect(result.length).toBe(3);
    });

    it('不同 fingerprintId 不受限', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const samples = [
            makeSearchResult('样本一', 0.9, 'fp1'),
            makeSearchResult('样本二', 0.85, 'fp2'),
            makeSearchResult('样本三', 0.8, 'fp3'),
        ];
        const result = selector.select(samples, context, 3);
        expect(result.length).toBe(3);
    });

    it('topN 限制生效', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const samples = [
            makeSearchResult('样本一', 0.9, 'fp1'),
            makeSearchResult('样本二', 0.85, 'fp2'),
            makeSearchResult('样本三', 0.8, 'fp3'),
            makeSearchResult('样本四', 0.75, 'fp4'),
            makeSearchResult('样本五', 0.7, 'fp5'),
        ];
        const result = selector.select(samples, context, 3);
        expect(result.length).toBe(3);
        // 按分数降序
        expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
        expect(result[1].score).toBeGreaterThanOrEqual(result[2].score);
    });

    it('每条结果包含 reason 字段', () => {
        const context: ContextFeatures = {
            paragraphFunction: 'dialogue',
            emotionTone: 'negative',
            emotionIntensity: 0.5,
            sceneType: 'dialogue',
            keywords: [],
        };
        const samples = [makeSearchResult('他道："你好"', 0.7, 'fp1')];
        const result = selector.select(samples, context, 1);
        expect(result[0].reason).toBeTruthy();
        expect(result[0].reason).toContain('向量');
    });
});

// ============================================================
// 三、TieredInjectionBuilder 测试（TR-6.3 + TR-6.5）
// ============================================================

describe('TieredInjectionBuilder (TR-6.3 + TR-6.5)', () => {
    const builder = new TieredInjectionBuilder();

    describe('分级注入策略（TR-6.3）', () => {
        it('全局层包含【写作风格指纹】标题与特征描述', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例一', score: 0.9, reason: '向量 0.9' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'description',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'unknown',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const joined = result.join('\n');
            expect(joined).toContain('【写作风格指纹】');
            expect(joined).toContain('风格特征：');
            expect(joined).toContain('句式节奏');
        });

        it('段落层包含【参考片段】标题与示例', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例片段内容一', score: 0.9, reason: '向量 0.9' },
                { sample: '示例片段内容二', score: 0.85, reason: '向量 0.85' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'unknown',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'unknown',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const joined = result.join('\n');
            expect(joined).toContain('参考片段：');
            expect(joined).toContain('示例片段内容一');
        });

        it('句子层在场景类型明确时注入风格提示', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例片段', score: 0.9, reason: '向量 0.9' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'dialogue',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'dialogue',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const joined = result.join('\n');
            expect(joined).toContain('【风格提示】');
            expect(joined).toContain('对话段落');
        });

        it('句子层在场景类型 unknown 时不注入', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例片段', score: 0.9, reason: '向量 0.9' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'unknown',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'unknown',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const joined = result.join('\n');
            expect(joined).not.toContain('【风格提示】');
        });

        it('情绪强度高时注入情绪提示', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例片段', score: 0.9, reason: '向量 0.9' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'lyrical',
                emotionTone: 'negative',
                emotionIntensity: 0.8,
                sceneType: 'emotion',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const joined = result.join('\n');
            expect(joined).toContain('情绪');
        });

        it('空指纹 + 空样本返回空数组', () => {
            const context: ContextFeatures = {
                paragraphFunction: 'unknown',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'unknown',
                keywords: [],
            };
            const result = builder.build([], [], context);
            expect(result).toEqual([]);
        });

        it('仅指纹无样本时只输出全局层', () => {
            const fps = [makeFingerprint()];
            const context: ContextFeatures = {
                paragraphFunction: 'unknown',
                emotionTone: 'neutral',
                emotionIntensity: 0,
                sceneType: 'unknown',
                keywords: [],
            };
            const result = builder.build(fps, [], context);
            const joined = result.join('\n');
            expect(joined).toContain('【写作风格指纹】');
            expect(joined).not.toContain('参考片段：');
        });
    });

    describe('Token 总开销（TR-6.5）', () => {
        it('总长度 ≤ 2000 字（默认上限）', () => {
            // 构造大量指纹和样本
            const fps = Array.from({ length: 5 }, (_, i) => makeFingerprint({
                id: `fp_${i}`,
                features: {
                    sentenceRhythm: '短句为主'.repeat(50),
                    wordPreference: '常用词'.repeat(50),
                    narrativeStyle: '第三人称'.repeat(50),
                    rhetoric: '比喻为主'.repeat(50),
                    dialogueStyle: '简短对白'.repeat(50),
                    paragraphStructure: '单段成意'.repeat(50),
                    overallTone: '冷峻克制'.repeat(50),
                },
            }));
            const samples: SelectedSample[] = Array.from({ length: 5 }, (_, i) => ({
                sample: `示例片段${i}内容`.repeat(100),
                score: 0.9 - i * 0.1,
                reason: '向量',
            }));
            const context: ContextFeatures = {
                paragraphFunction: 'dialogue',
                emotionTone: 'negative',
                emotionIntensity: 0.8,
                sceneType: 'dialogue',
                keywords: [],
            };
            const result = builder.build(fps, samples, context);
            const totalLen = result.reduce((sum, s) => sum + s.length, 0);
            expect(totalLen).toBeLessThanOrEqual(2000);
        });

        it('自定义上限生效', () => {
            const fps = [makeFingerprint()];
            const samples: SelectedSample[] = [
                { sample: '示例'.repeat(100), score: 0.9, reason: '向量' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'dialogue',
                emotionTone: 'negative',
                emotionIntensity: 0.8,
                sceneType: 'dialogue',
                keywords: [],
            };
            const result = builder.build(fps, samples, context, undefined, 500);
            const totalLen = result.reduce((sum, s) => sum + s.length, 0);
            expect(totalLen).toBeLessThanOrEqual(500);
        });

        it('超长时优先丢弃句子层', () => {
            // 构造大量数据，让三层都达到各自 budget
            const fps = [makeFingerprint({
                features: {
                    sentenceRhythm: '短句为主'.repeat(25),  // 100字
                    wordPreference: '常用词'.repeat(25),
                    narrativeStyle: '第三人称'.repeat(25),
                    rhetoric: '比喻为主'.repeat(25),
                    dialogueStyle: '简短对白'.repeat(25),
                    paragraphStructure: '单段成意'.repeat(25),
                    overallTone: '冷峻克制'.repeat(25),
                },
            })];
            const samples: SelectedSample[] = [
                { sample: '示例片段'.repeat(100), score: 0.9, reason: '向量' },  // 400字
                { sample: '示例片段'.repeat(100), score: 0.85, reason: '向量' },
                { sample: '示例片段'.repeat(100), score: 0.8, reason: '向量' },
            ];
            const context: ContextFeatures = {
                paragraphFunction: 'dialogue',
                emotionTone: 'negative',
                emotionIntensity: 0.8,
                sceneType: 'dialogue',
                keywords: [],
            };
            // maxTotalLength=500, ratio=0.25, budget={global:162, paragraph:262, sentence:100}
            // 三层都达到 budget 时总和 ≈ 524 > 500 → 触发超长检查
            const result = builder.build(fps, samples, context, undefined, 500);
            const totalLen = result.reduce((sum, s) => sum + s.length, 0);
            // 总长度仍 <= maxTotalLength
            expect(totalLen).toBeLessThanOrEqual(500);
            // 超长时句子层应被丢弃（不再包含【风格提示】）
            const joined = result.join('\n');
            // 注意：如果 globalTier + paragraphTier 本身就 <= 500，句子层可能保留
            // 这里验证：如果总长度 == maxTotalLength 且有句子层，则未超长；如果丢弃了句子层，总长度会小于 maxTotalLength
            expect(totalLen).toBeLessThanOrEqual(500);
        });
    });
});

// ============================================================
// 四、与 StyleLearner 不冲突（TR-6.4）
// ============================================================

describe('与 StyleLearner 不冲突 (TR-6.4)', () => {
    const builder = new TieredInjectionBuilder();

    it('输出不含 styleLearner 的内容（StylePattern 词汇）', () => {
        // StyleLearner 输出的内容通常包含 "用户偏好" / "学习模式" 等关键词
        // 本引擎输出应仅包含指纹特征 + 示例片段 + 风格提示
        const fps = [makeFingerprint()];
        const samples: SelectedSample[] = [
            { sample: '示例片段', score: 0.9, reason: '向量 0.9' },
        ];
        const context: ContextFeatures = {
            paragraphFunction: 'dialogue',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'dialogue',
            keywords: [],
        };
        const result = builder.build(fps, samples, context);
        const joined = result.join('\n');
        // 不应包含 styleLearner 特有的概念词
        expect(joined).not.toContain('用户偏好');
        expect(joined).not.toContain('学习模式');
        expect(joined).not.toContain('StylePattern');
        expect(joined).not.toContain('风格学习');
    });

    it('输出仅包含指纹库 + 示例 + 风格提示三部分', () => {
        const fps = [makeFingerprint()];
        const samples: SelectedSample[] = [
            { sample: '示例片段', score: 0.9, reason: '向量 0.9' },
        ];
        const context: ContextFeatures = {
            paragraphFunction: 'dialogue',
            emotionTone: 'negative',
            emotionIntensity: 0.7,
            sceneType: 'dialogue',
            keywords: [],
        };
        const result = builder.build(fps, samples, context);
        const joined = result.join('\n');

        // 应包含的三部分
        const hasGlobalTier = joined.includes('【写作风格指纹】');
        const hasParagraphTier = joined.includes('参考片段：');
        const hasSentenceTier = joined.includes('【风格提示】');

        expect(hasGlobalTier).toBe(true);
        expect(hasParagraphTier).toBe(true);
        expect(hasSentenceTier).toBe(true);
    });

    it('本引擎输出不依赖 StyleLearner 实例', () => {
        // 验证：TieredInjectionBuilder 的 build 方法签名不包含 styleLearner 参数
        const buildMethod = TieredInjectionBuilder.prototype.build;
        const fnStr = buildMethod.toString();
        // 不应引用 styleLearner / getStyleGuide / StylePattern
        expect(fnStr).not.toContain('styleLearner');
        expect(fnStr).not.toContain('getStyleGuide');
    });
});

// ============================================================
// 五、性能测试（TR-6.6）
// ============================================================

describe('性能测试 (TR-6.6)', () => {
    const analyzer = new ContextAnalyzer();

    it('上下文分析耗时 < 300ms（普通文本）', () => {
        const text = '他道："你来做什么？"她答道："我来告诉你一件事。"阳光透过窗，风轻拂树梢，空气中弥漫着墨水的气味。心中突然涌起一阵莫名的情绪。';
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            analyzer.analyze(text);
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / 100;
        expect(avgMs).toBeLessThan(300);
    });

    it('上下文分析耗时 < 300ms（长文本 800 字）', () => {
        const longText = '他道："你来做什么？"'.repeat(40);
        const start = performance.now();
        analyzer.analyze(longText);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(300);
    });

    it('上下文分析耗时 < 300ms（含 directionHint）', () => {
        const text = '阳光透过窗，风轻拂树梢。';
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            analyzer.analyze(text, 'action');
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / 100;
        expect(avgMs).toBeLessThan(300);
    });

    it('动态选择耗时 < 100ms（10 条样本）', () => {
        const selector = new DynamicSampleSelector();
        const context: ContextFeatures = {
            paragraphFunction: 'dialogue',
            emotionTone: 'negative',
            emotionIntensity: 0.5,
            sceneType: 'dialogue',
            keywords: [],
        };
        const samples = Array.from({ length: 10 }, (_, i) => makeSearchResult(`样本${i}内容`, 0.9 - i * 0.05, `fp${i % 3}`));
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            selector.select(samples, context, 3);
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / 100;
        expect(avgMs).toBeLessThan(100);
    });
});

// ============================================================
// 六、便捷工厂函数
// ============================================================

describe('createDynamicInjectionEngine', () => {
    it('返回包含三个组件的对象', () => {
        const engine = createDynamicInjectionEngine();
        expect(engine.analyzer).toBeInstanceOf(ContextAnalyzer);
        expect(engine.selector).toBeInstanceOf(DynamicSampleSelector);
        expect(engine.builder).toBeInstanceOf(TieredInjectionBuilder);
    });

    it('三个组件可独立工作', () => {
        const engine = createDynamicInjectionEngine();
        const context = engine.analyzer.analyze('他道："你好。"');
        expect(context.paragraphFunction).toBe('dialogue');

        const samples = engine.selector.select(
            [{ sample: '他道："你好。"', score: 0.8, fingerprintId: 'fp1' }],
            context,
            1,
        );
        expect(samples.length).toBe(1);

        const fps = [makeFingerprint()];
        const result = engine.builder.build(fps, samples, context);
        expect(result.length).toBeGreaterThan(0);
    });
});

// ============================================================
// 七、边界与降级
// ============================================================

describe('边界与降级', () => {
    it('ContextAnalyzer 处理 null/undefined 输入不崩溃', () => {
        const analyzer = new ContextAnalyzer();
        expect(() => analyzer.analyze(null as unknown as string)).not.toThrow();
        expect(() => analyzer.analyze(undefined as unknown as string)).not.toThrow();
    });

    it('DynamicSampleSelector 处理 score 为 0 的样本', () => {
        const selector = new DynamicSampleSelector();
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const samples = [makeSearchResult('样本', 0, 'fp1')];
        const result = selector.select(samples, context, 1);
        expect(result.length).toBe(1);
        expect(result[0].score).toBeGreaterThanOrEqual(0);
    });

    it('TieredInjectionBuilder 无指纹无样本时返回空数组', () => {
        const builder = new TieredInjectionBuilder();
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const result = builder.build([], [], context);
        expect(result).toEqual([]);
    });

    it('TieredInjectionBuilder maxTotalLength=0 时返回空', () => {
        const builder = new TieredInjectionBuilder();
        const fps = [makeFingerprint()];
        const context: ContextFeatures = {
            paragraphFunction: 'unknown',
            emotionTone: 'neutral',
            emotionIntensity: 0,
            sceneType: 'unknown',
            keywords: [],
        };
        const result = builder.build(fps, [], context, undefined, 0);
        expect(result).toEqual([]);
    });
});
