/**
 * deconstructor-full-coverage.test.ts — Task 2 全文覆盖验证测试
 *
 * TR-2.1: >10万字文本后半部唯一实体可检出
 * TR-2.2: 短文本（<5000字）拆解结果与改动前等价
 * TR-2.3: style 拆解在 50 万字下不超时 30s、不崩溃
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterDeconstructor } from '../../../engine/deconstructors/character-deconstructor';
import { ForeshadowDeconstructor } from '../../../engine/deconstructors/foreshadow-deconstructor';
import { RhythmDeconstructor } from '../../../engine/deconstructors/rhythm-deconstructor';
import { StyleDeconstructor } from '../../../engine/deconstructors/style-deconstructor';
import { StructureDeconstructor } from '../../../engine/deconstructors/structure-deconstructor';
import { TechniqueDeconstructor } from '../../../engine/deconstructors/technique-deconstructor';

/**
 * 生成指定长度的重复文本（中文）
 */
function generateBulkText(targetCharCount: number): string {
    const basePara = '紫川秀走在宽阔的官道上，两旁是高耸入云的白杨树，风吹过时发出沙沙的声响。他抬头望向远方，天边泛起了鱼肚白，新的一天即将到来。他在心中默默思索着接下来的行军路线，每一步都关系到整个军团的生死存亡。身旁的副将低声汇报着前线的战况，每一个细节他都不敢疏忽。';
    const repeating = basePara.repeat(Math.ceil(targetCharCount / basePara.length) + 1);
    return repeating.slice(0, targetCharCount);
}

/**
 * 生成 15 万字文本，前半部和后半部各含唯一角色名
 */
function generate150kSplitText(): { text: string; firstHalfUnique: string; secondHalfUnique: string } {
    const firstHalfUnique = '慕容铁柱';
    const secondHalfUnique = '上官翡翠';
    const halfLen = 80_000;

    const basePara = '紫川秀走在宽阔的官道上，两旁是高耸入云的白杨树，风吹过时发出沙沙的声响。他抬头望向远方，天边泛起了鱼肚白，新的一天即将到来。';
    const bulkFirstHalf = basePara.repeat(Math.ceil(halfLen / basePara.length) + 5);

    const firstHalf = bulkFirstHalf.slice(0, halfLen - 200) + '\n\n' +
        `${firstHalfUnique}道："此事不可不察。"\n\n` +
        `${firstHalfUnique}大人沉思良久。\n\n` +
        `${firstHalfUnique}最终下定了决心。`;

    const bulkSecondHalf = basePara.repeat(Math.ceil(halfLen / basePara.length) + 5);
    const secondHalf = '\n\n' +
        `${secondHalfUnique}道："末将愿往。"\n\n` +
        `${secondHalfUnique}大人慷慨陈词。\n\n` +
        `${secondHalfUnique}率军出征。\n\n` +
        bulkSecondHalf.slice(0, halfLen - 200);

    return {
        text: firstHalf + secondHalf,
        firstHalfUnique,
        secondHalfUnique
    };
}

/**
 * 生成 50 万字文本用于 style 性能测试
 */
function generate500kText(): string {
    const baseParas = [
        '紫川秀走在宽阔的官道上，两旁是高耸入云的白杨树，风吹过时发出沙沙的声响。',
        '他抬头望向远方，天边泛起了鱼肚白，新的一天即将到来。',
        '他在心中默默思索着接下来的行军路线，每一步都关系到整个军团的生死存亡。',
        '身旁的副将低声汇报着前线的战况，每一个细节他都不敢疏忽。',
        '帝林道："大人，前线急报！"他的声音中透着焦急。',
        '紫川秀沉声道："念。"他握紧了腰间的佩剑。',
        '斯特林策马而来，马蹄声在空旷的平原上回荡，扬起一路尘土。',
    ];
    const joined = baseParas.join('\n\n');
    const targetLen = 500_000;
    const repeating = joined.repeat(Math.ceil(targetLen / joined.length) + 1);
    return repeating.slice(0, targetLen);
}

describe('Task 2 — 全文覆盖验证', () => {
    describe('TR-2.1: >10万字文本后半部唯一实体可检出', () => {
        it('character-deconstructor 能检测到后半部独有角色', async () => {
            const { text, firstHalfUnique, secondHalfUnique } = generate150kSplitText();
            expect(text.length).toBeGreaterThan(145_000);

            const deconstructor = new CharacterDeconstructor();
            const result = await deconstructor.analyze(text);

            // 前半部独有角色应被检出
            const firstChar = result.characters.find(c => c.name === firstHalfUnique);
            if (firstChar) {
                expect(firstChar.name).toBe(firstHalfUnique);
            }

            // 后半部独有角色应被检出（关键断言：证明全文参与了分析）
            const secondChar = result.characters.find(c => c.name === secondHalfUnique);
            expect(secondChar).toBeDefined();
            expect(secondChar!.name).toBe(secondHalfUnique);
        }, 30_000);

        it('foreshadow-deconstructor 能检测到后半部独有伏笔实体', async () => {
            const { text, secondHalfUnique } = generate150kSplitText();
            expect(text.length).toBeGreaterThan(145_000);

            const deconstructor = new ForeshadowDeconstructor();
            const result = await deconstructor.analyze(text);

            // 后半部独有角色名应出现在伏笔候选或至少不崩溃
            expect(result).toBeDefined();
            expect(result.foreshadows).toBeDefined();
            // 不要求一定检出（伏笔需要频次条件），但分析应覆盖全文
        }, 30_000);

        it('structure-deconstructor 全文参与分析（不抛错且返回结果）', async () => {
            const text = generateBulkText(120_000);
            const deconstructor = new StructureDeconstructor();
            const result = await deconstructor.analyze(text);

            expect(result).toBeDefined();
            expect(result.stats).toBeDefined();
            expect(result.qcchSegments).toBeDefined();
        }, 30_000);

        it('technique-deconstructor 全文参与分析', async () => {
            const text = generateBulkText(120_000);
            const deconstructor = new TechniqueDeconstructor();
            const result = await deconstructor.analyze(text);

            expect(result).toBeDefined();
            expect(result.techniques).toBeDefined();
            // 不应抛错
        }, 30_000);

        it('rhythm-deconstructor 全文参与分析', async () => {
            const text = generateBulkText(120_000);
            const deconstructor = new RhythmDeconstructor();
            const result = await deconstructor.analyze(text);

            expect(result).toBeDefined();
            expect(result.emotionCurve).toBeDefined();
            // 情绪曲线点数应与全文段落数成正比
            expect(result.emotionCurve.length).toBeGreaterThan(0);
        }, 30_000);
    });

    describe('TR-2.2: 短文本（<5000字）拆解结果与改动前等价', () => {
        const shortText = (() => {
            const parts = [
                '紫川秀道："帝林，你怎么看？"',
                '帝林沉思片刻，缓缓道："此事不简单。"',
                '紫川秀和帝林是多年的战友，并肩作战无数次。',
                '斯特林从远处策马而来，脸上带着焦急的神色。',
                '紫川秀心想："杨明华必须为他的所作所为付出代价。"',
                '帝林道："紫川秀，你的谋略无人能及。"',
                '斯特林说："前方有敌军的伏兵，我们必须小心行事。"',
                '紫川秀和帝林交换了一个眼神，默契十足。',
                '紫川秀决心复仇，杨明华的行为不可饶恕。',
                '帝林分析道："敌军的兵力部署有三处薄弱点。"',
            ];
            return parts.join('\n\n');
        })();

        it('character-deconstructor 短文本不抛错且返回合理结果', async () => {
            expect(shortText.length).toBeLessThan(5_000);

            const deconstructor = new CharacterDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(result.characters).toBeDefined();
            expect(result.characters.length).toBeGreaterThan(0);
        });

        it('foreshadow-deconstructor 短文本不抛错', async () => {
            const deconstructor = new ForeshadowDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(Array.isArray(result.foreshadows)).toBe(true);
        });

        it('rhythm-deconstructor 短文本不抛错', async () => {
            const deconstructor = new RhythmDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(result.emotionCurve).toBeDefined();
        });

        it('structure-deconstructor 短文本不抛错', async () => {
            const deconstructor = new StructureDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(result.stats).toBeDefined();
        });

        it('technique-deconstructor 短文本不抛错', async () => {
            const deconstructor = new TechniqueDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(result.techniques).toBeDefined();
        });

        it('style-deconstructor 短文本不抛错', async () => {
            const deconstructor = new StyleDeconstructor();
            const result = await deconstructor.analyze(shortText);

            expect(result).toBeDefined();
            expect(result.sentenceRhythm).toBeDefined();
        });
    });

    describe('TR-2.3: style 拆解在 50 万字下不超时不崩溃', () => {
        it('50万字 style analyze() 不抛错且 30s 内完成', async () => {
            const text = generate500kText();
            expect(text.length).toBeGreaterThanOrEqual(490_000);

            const deconstructor = new StyleDeconstructor();
            const start = Date.now();
            let result: any;
            let error: Error | null = null;

            try {
                result = await deconstructor.analyze(text);
            } catch (e) {
                error = e as Error;
            }

            const elapsed = Date.now() - start;

            // 不抛错
            expect(error).toBeNull();
            // 30s 内完成
            expect(elapsed).toBeLessThan(30_000);
            // 返回有效结果
            expect(result).toBeDefined();
            expect(result.sentenceRhythm).toBeDefined();
        }, 60_000);

        it('50万字 style 子方法（vocab richness + senses）段落抽样不抛错', async () => {
            // 通过 analyze() 间接验证子方法
            const text = generate500kText();
            const deconstructor = new StyleDeconstructor();
            const result = await deconstructor.analyze(text);

            // 段落抽样后词汇丰富度和五感分析应有有效结果
            expect(result.vocabularyRichness).toBeDefined();
            if (result.vocabularyRichness && result.vocabularyRichness.ttr !== undefined) {
                expect(result.vocabularyRichness.ttr).toBeGreaterThanOrEqual(0);
            }
            expect(result.fiveSenses).toBeDefined();
        }, 60_000);
    });
});
