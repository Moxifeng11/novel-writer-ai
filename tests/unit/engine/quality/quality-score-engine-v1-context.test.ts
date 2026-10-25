import { describe, it, expect } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

/**
 * 注入 v1Engine 后，六维与总分都取自 WritingQualityEngine（统一内核），
 * 此时 EvaluationContext 里的人物名单/大纲若不进内核，人物维度就退化成
 * 「X说 / X道」正则估算——协同视图已经加载的人物档案等于完全没用上。
 * 这里锁定「上下文必须进 V1 内核」以及「上下文变了不能复用旧缓存」。
 */

const TEXT = [
    '林默推开门，雨声灌了进来。',
    '他抬头看向屋檐下的人，苏晚正低头擦着剑上的水。',
    '林默没有说话，只是把伞递了过去。',
    '苏晚接过伞，轻声道了句谢，转身走进雨里。',
    '雨点砸在青石板上，溅起一层薄薄的白雾。',
    '林默站在原地，看着那道背影慢慢消失在巷口。',
].join('\n');

describe('QualityScoreEngine — V1 内核接收评估上下文', () => {
    it('传 characterNames 后人物维度按名单统计，而不是正则估算', async () => {
        const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

        const withoutContext = await engine.evaluate(TEXT);
        const withoutDetails = withoutContext.dimensions.characterConsistency.details;
        expect(withoutDetails.estimation).toBe('基于对话标记估算');

        const withNames = await engine.evaluate(TEXT, { characterNames: ['林默'] });
        const withDetails = withNames.dimensions.characterConsistency.details;
        expect(withDetails.estimation).toBeUndefined();
        expect(withDetails.uniqueCharacters).toBe(1);
        expect(Number(withDetails.characterMentions)).toBeGreaterThan(0);
    });

    it('只给 characterInfos 也能把人物名送进内核', async () => {
        const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

        const result = await engine.evaluate(TEXT, {
            characterInfos: [{ name: '林默' }, { name: '苏晚' }],
        });

        const details = result.dimensions.characterConsistency.details;
        expect(details.uniqueCharacters).toBe(2);
    });

    it('同一段正文、人物名单变了不能复用旧缓存', async () => {
        const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

        const first = await engine.evaluate(TEXT, { characterNames: ['林默'] });
        expect(first.dimensions.characterConsistency.details.uniqueCharacters).toBe(1);

        const second = await engine.evaluate(TEXT, { characterNames: ['林默', '苏晚'] });
        expect(second.fromCache).toBe(false);
        expect(second.dimensions.characterConsistency.details.uniqueCharacters).toBe(2);
    });

    it('上下文缺席时不清空 V1 构造时配置的人物名单', async () => {
        const engine = new QualityScoreEngine({
            v1Engine: new WritingQualityEngine({ characterNames: ['林默'] }),
        });

        const result = await engine.evaluate(TEXT);

        // 上下文为空 = 没有新信息，不能把调用方自己的配置覆盖成空
        expect(result.dimensions.characterConsistency.details.uniqueCharacters).toBe(1);
    });
});
