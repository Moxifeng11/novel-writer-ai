/**
 * style-deconstructor-extensions.test.ts — 风格拆解器扩展维度单元测试
 *
 * 覆盖范围：
 * 1. 词汇丰富度（TTR/MTLD/Yule's K/Hapax/等级/评分）
 * 2. 五感分析（分布/平衡度/主导感官/密度等级）
 * 3. 边界情况（空文本/单字/超长文本）
 * 4. Markdown 输出包含新增章节
 * 5. 不破坏现有风格分析功能
 */

import { describe, it, expect } from 'vitest';
import {
    StyleDeconstructor,
    type StyleAnalysisResult,
    type VocabularyRichnessResult,
    type FiveSensesResult,
    type SenseType
} from '../../../../engine/deconstructors/style-deconstructor';

const RICH_SAMPLE = `他突然停下了脚步，目光所及之处，月光如水般倾泻而下，洒满整个庭院。

我心中一惊，难道这就是传说中的玄机？然而，转身的瞬间，我却看到了一抹熟悉的微笑。

风轻轻地吹过，带来阵阵花香，沁人心脾。这是怎样的一个夜晚啊。

「你来了。」他轻声说道，声音中带着几分叹息。

「嗯。」我回答道，心中却充满了疑惑。

但是，事情并没有那么简单。然而，谁也没有想到，这只是一个开始。

三年后，当我再次回到这里，一切都已物是人非。冰冷的寒风刺骨，熟悉的气息早已消散。

他望着我，眼神中满是悲伤与不舍，仿佛要将这一刻永远铭记。

我伸手触摸那冰冷的石碑，指尖传来阵阵凉意，泪水悄然滑落。`;

const SENSE_RICH_SAMPLE = `阳光刺眼，照得人睁不开眼。远处传来阵阵鸟鸣，溪水潺潺作响。
微风拂面，带来阵阵花香，沁人心脾。我伸手摘下一朵野花，放入口中，
甘甜的汁液在舌尖绽放。脚下的青石冰冷刺骨，却又带着几分粗糙的触感。
夜幕降临，星光璀璨，月亮洒下银白色的光辉。虫鸣声此起彼伏，
远处传来狼嚎，令人毛骨悚然。我紧了紧身上的斗篷，寒风刺骨，
不得不加快脚步。空气中弥漫着泥土的芬芳与腐叶的腥气，
让人忍不住皱起眉头。前方传来水声，我循声望去，
只见一道瀑布从悬崖飞泻而下，水雾弥漫，寒意逼人。`;

describe('StyleDeconstructor - 词汇丰富度扩展', () => {
    it('analyze 返回结果包含 vocabularyRichness 字段', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);

        expect(result.vocabularyRichness).toBeDefined();
        expect(result.vocabularyRichness!.totalTokens).toBeGreaterThan(0);
        expect(result.vocabularyRichness!.vocabularySize).toBeGreaterThan(0);
    });

    it('TTR 在 0-1 之间', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.ttr).toBeGreaterThanOrEqual(0);
        expect(vr.ttr).toBeLessThanOrEqual(1);
    });

    it('MTLD 为正数', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.mtld).toBeGreaterThan(0);
    });

    it('Yule\'s K 为非负数', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.yulesK).toBeGreaterThanOrEqual(0);
    });

    it('Hapax Legomena 在 0-1 之间', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.hapaxLegomena).toBeGreaterThanOrEqual(0);
        expect(vr.hapaxLegomena).toBeLessThanOrEqual(1);
    });

    it('综合评分在 0-100 之间', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.score).toBeGreaterThanOrEqual(0);
        expect(vr.score).toBeLessThanOrEqual(100);
    });

    it('level 取值为 low/medium/high 之一', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(['low', 'medium', 'high']).toContain(vr.level);
    });

    it('vocabularySize 不超过 totalTokens', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);
        const vr = result.vocabularyRichness!;

        expect(vr.vocabularySize).toBeLessThanOrEqual(vr.totalTokens);
    });

    it('空文本返回零值结果', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze('');

        expect(result.vocabularyRichness).toBeDefined();
        expect(result.vocabularyRichness!.ttr).toBe(0);
        expect(result.vocabularyRichness!.mtld).toBe(0);
        expect(result.vocabularyRichness!.totalTokens).toBe(0);
    });

    it('单字文本（无法形成 2 字窗口）返回零值结果', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze('啊');

        expect(result.vocabularyRichness).toBeDefined();
        expect(result.vocabularyRichness!.totalTokens).toBe(0);
    });

    it('重复文本（词汇丰富度低）的 TTR 应低于多样化文本', async () => {
        const decon = new StyleDeconstructor();
        const repetitiveText = '哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈';
        const diverseText = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏';

        const repetitiveResult = await decon.analyze(repetitiveText);
        const diverseResult = await decon.analyze(diverseText);

        expect(repetitiveResult.vocabularyRichness!.ttr)
            .toBeLessThan(diverseResult.vocabularyRichness!.ttr);
    });
});

describe('StyleDeconstructor - 五感分析扩展', () => {
    it('analyze 返回结果包含 fiveSenses 字段', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);

        expect(result.fiveSenses).toBeDefined();
    });

    it('五感分布占比总和约等于 1（非空文本）', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;

        const sum = fs.distribution.visual + fs.distribution.auditory
            + fs.distribution.olfactory + fs.distribution.gustatory + fs.distribution.tactile;

        expect(sum).toBeCloseTo(1, 1);
    });

    it('balanceScore 在 0-100 之间', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;

        expect(fs.balanceScore).toBeGreaterThanOrEqual(0);
        expect(fs.balanceScore).toBeLessThanOrEqual(100);
    });

    it('dominantSense 取值为五感之一', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;

        const senses: SenseType[] = ['visual', 'auditory', 'olfactory', 'gustatory', 'tactile'];
        expect(senses).toContain(fs.dominantSense);
    });

    it('counts 中主导感官的计数最大', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;
        const max = Math.max(
            fs.counts.visual, fs.counts.auditory, fs.counts.olfactory,
            fs.counts.gustatory, fs.counts.tactile
        );

        expect(fs.counts[fs.dominantSense]).toBe(max);
    });

    it('level 取值为 low/medium/high 之一', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;

        expect(['low', 'medium', 'high']).toContain(fs.level);
    });

    it('perThousand 各值为非负数', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);
        const fs = result.fiveSenses!;

        expect(fs.perThousand.visual).toBeGreaterThanOrEqual(0);
        expect(fs.perThousand.auditory).toBeGreaterThanOrEqual(0);
        expect(fs.perThousand.olfactory).toBeGreaterThanOrEqual(0);
        expect(fs.perThousand.gustatory).toBeGreaterThanOrEqual(0);
        expect(fs.perThousand.tactile).toBeGreaterThanOrEqual(0);
    });

    it('视觉主导文本的 dominantSense 应为 visual', async () => {
        const decon = new StyleDeconstructor();
        const visualText = '他望向远方，看见阳光洒在山顶，影子在地面拉得很长，远处的景色清晰可见，模糊的轮廓渐渐显现。';
        const result = await decon.analyze(visualText);
        const fs = result.fiveSenses!;

        expect(fs.counts.visual).toBeGreaterThan(0);
        expect(fs.dominantSense).toBe('visual');
    });

    it('空文本返回零值五感结果', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze('');
        const fs = result.fiveSenses!;

        expect(fs.balanceScore).toBe(0);
        expect(fs.counts.visual).toBe(0);
        expect(fs.counts.auditory).toBe(0);
        expect(fs.details.visualWords).toHaveLength(0);
    });

    it('details 中各感官词样本不超过 20 个', async () => {
        const decon = new StyleDeconstructor();
        const longText = SENSE_RICH_SAMPLE.repeat(5);
        const result = await decon.analyze(longText);
        const fs = result.fiveSenses!;

        expect(fs.details.visualWords.length).toBeLessThanOrEqual(20);
        expect(fs.details.auditoryWords.length).toBeLessThanOrEqual(20);
        expect(fs.details.olfactoryWords.length).toBeLessThanOrEqual(20);
        expect(fs.details.gustatoryWords.length).toBeLessThanOrEqual(20);
        expect(fs.details.tactileWords.length).toBeLessThanOrEqual(20);
    });
});

describe('StyleDeconstructor - 扩展维度集成与 Markdown', () => {
    it('扩展字段为可选（向后兼容）', () => {
        const minimal: StyleAnalysisResult = {
            sentenceRhythm: {
                avgSentenceLength: 0, medianSentenceLength: 0, stdSentenceLength: 0,
                sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
                lengthDistribution: { short: 0, medium: 0, long: 0 }
            },
            wordPreference: {
                topWords: [],
                posPreference: { verb: 0, adjective: 0, adverb: 0 },
                modalParticles: { total: 0, perThousand: 0, topParticles: [] },
                idiomDensity: 0, colloquialismLevel: 0
            },
            narrativeStyle: {
                perspective: 'third_person_omniscient', perspectiveConfidence: 0,
                descriptionRatio: { appearance: 0, environment: 0, action: 0, psychology: 0, total: 0 },
                narrationRatio: 0, dialogueRatio: 0
            },
            rhetoric: {
                metaphor: 0, personification: 0, parallelism: 0, rhetoricalQuestion: 0,
                hyperbole: 0, antithesis: 0, total: 0, perThousand: 0
            },
            dialogueStyle: {
                dialogueRatio: 0, promptWordPreference: [], avgDialogueLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0 }
            },
            paragraphStructure: {
                avgParagraphLength: 0, medianParagraphLength: 0,
                lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
                openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 }
            },
            overallStyle: { primaryStyle: '未知', confidence: 0, styleScores: {} },
            stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 }
        };

        expect(minimal.vocabularyRichness).toBeUndefined();
        expect(minimal.fiveSenses).toBeUndefined();
    });

    it('analyze 后扩展字段不为 undefined', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);

        expect(result.vocabularyRichness).not.toBeUndefined();
        expect(result.fiveSenses).not.toBeUndefined();
    });

    it('saveAnalysisToMarkdown 包含词汇丰富度章节', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);

        const writes: Array<{ path: string; data: string }> = [];
        const fakeApp = {
            vault: {
                adapter: {
                    exists: async () => false,
                    mkdir: async () => {},
                    write: async (path: string, data: string) => {
                        writes.push({ path, data });
                    }
                }
            }
        };

        await decon.saveAnalysisToMarkdown(fakeApp as any, 'test-book', result);

        expect(writes).toHaveLength(1);
        const content = writes[0].data;
        expect(content).toContain('词汇丰富度');
        expect(content).toContain('TTR');
        expect(content).toContain('MTLD');
        expect(content).toContain("Yule's K");
    });

    it('saveAnalysisToMarkdown 包含五感分析章节', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(SENSE_RICH_SAMPLE);

        const writes: Array<{ path: string; data: string }> = [];
        const fakeApp = {
            vault: {
                adapter: {
                    exists: async () => false,
                    mkdir: async () => {},
                    write: async (path: string, data: string) => {
                        writes.push({ path, data });
                    }
                }
            }
        };

        await decon.saveAnalysisToMarkdown(fakeApp as any, 'test-book', result);

        expect(writes).toHaveLength(1);
        const content = writes[0].data;
        expect(content).toContain('五感分析');
        expect(content).toContain('主导感官');
        expect(content).toContain('平衡度');
        expect(content).toContain('视觉词');
    });

    it('frontmatter 包含扩展字段', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);

        const writes: Array<{ path: string; data: string }> = [];
        const fakeApp = {
            vault: {
                adapter: {
                    exists: async () => false,
                    mkdir: async () => {},
                    write: async (path: string, data: string) => {
                        writes.push({ path, data });
                    }
                }
            }
        };

        await decon.saveAnalysisToMarkdown(fakeApp as any, 'test-book', result);

        const content = writes[0].data;
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).not.toBeNull();
        const frontmatter = frontmatterMatch![1];
        expect(frontmatter).toContain('vocabularyRichness');
        expect(frontmatter).toContain('fiveSenses');
    });
});

describe('StyleDeconstructor - 现有功能回归', () => {
    it('原有 7 维分析不受扩展影响', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyze(RICH_SAMPLE);

        expect(result.sentenceRhythm).toBeDefined();
        expect(result.wordPreference).toBeDefined();
        expect(result.narrativeStyle).toBeDefined();
        expect(result.rhetoric).toBeDefined();
        expect(result.dialogueStyle).toBeDefined();
        expect(result.paragraphStructure).toBeDefined();
        expect(result.overallStyle).toBeDefined();
        expect(result.stats).toBeDefined();
        expect(result.stats.totalChars).toBe(RICH_SAMPLE.length);
    });

    it('analyzeWithVector 在无 vectorEnhancer 时仍返回扩展字段', async () => {
        const decon = new StyleDeconstructor();
        const result = await decon.analyzeWithVector(RICH_SAMPLE);

        expect(result.vocabularyRichness).toBeDefined();
        expect(result.fiveSenses).toBeDefined();
    });

    it('超长文本（>1000字）能正确分段计算 TTR', async () => {
        const decon = new StyleDeconstructor();
        const longText = RICH_SAMPLE.repeat(20);
        const result = await decon.analyze(longText);
        const vr = result.vocabularyRichness!;

        expect(vr.ttr).toBeGreaterThan(0);
        expect(vr.ttr).toBeLessThanOrEqual(1);
        expect(vr.totalTokens).toBeGreaterThan(1000);
    });
});
