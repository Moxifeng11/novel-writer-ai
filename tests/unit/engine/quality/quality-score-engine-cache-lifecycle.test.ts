import { describe, expect, it, vi } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

/**
 * fullCache 是 textHash → QualityScore 的有界 LRU；syncV1Context 在上下文签名变化时
 * 必须清空它，否则同一段正文会沿用旧人物名单/大纲的分数。这里锁定：
 * 1) 同上下文重复评估只算一次；
 * 2) 上下文变化后重新计算；
 * 3) 缓存条目数受 cacheSize 上界约束。
 */

const TEXT = [
    '林默推开门，雨声灌了进来。',
    '他抬头看向屋檐下的人，苏晚正低头擦着剑上的水。',
    '林默没有说话，只是把伞递了过去。',
    '苏晚接过伞，轻声道了句谢，转身走进雨里。',
    '雨点砸在青石板上，溅起一层薄薄的白雾。',
    '林默站在原地，看着那道背影慢慢消失在巷口。',
].join('\n');

describe('QualityScoreEngine — fullCache 生命周期与上界', () => {
    it('同上下文 1000 次评估只计算一次；上下文变化后重算', async () => {
        const v1 = new WritingQualityEngine();
        const evaluateSpy = vi.spyOn(v1, 'evaluate');
        const engine = new QualityScoreEngine({
            v1Engine: v1,
            cacheSize: 10,
            cacheTtlMs: 60_000,
        });

        for (let i = 0; i < 1000; i += 1) {
            await engine.evaluate(TEXT, { characterNames: ['林默'] });
        }
        expect(evaluateSpy).toHaveBeenCalledTimes(1);

        const changed = await engine.evaluate(TEXT, { characterNames: ['林默', '苏晚'] });
        expect(changed.fromCache).toBe(false);
        expect(evaluateSpy).toHaveBeenCalledTimes(2);

        await engine.evaluate(TEXT, { characterNames: ['林默', '苏晚'] });
        expect(evaluateSpy).toHaveBeenCalledTimes(2);
    });

    it('fullCache 条目数不超过 cacheSize，不随评估次数增长', async () => {
        const engine = new QualityScoreEngine({
            v1Engine: new WritingQualityEngine(),
            cacheSize: 3,
            cacheTtlMs: 60_000,
        });

        for (let i = 0; i < 20; i += 1) {
            await engine.evaluate(`${TEXT}\n第${i}次`, { characterNames: ['林默'] });
        }

        expect((engine as any).fullCache.size).toBeLessThanOrEqual(3);
    });
});
