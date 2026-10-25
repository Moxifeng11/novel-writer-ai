/**
 * C4 — `syncV1Context` 修改共享 V1 内核带来的非重入风险。
 *
 * V1 内核是构造时注入的同一实例，`syncV1Context` 直接 `updateOptions`。
 * 现在所有评估入口走同一串行队列：一次评估的「同步上下文 → 内核评分」
 * 不会被另一次调用插入，并发调用也各自拿到自己上下文对应的结果。
 */

import { describe, it, expect } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import {
    WritingQualityEngine,
    type WritingQualityResult,
} from '../../../../engine/writing-quality-engine';

const TEXT_A = '林默推开门，雨声灌了进来。他抬头看向屋檐，水珠顺着瓦片往下掉。'.repeat(5);
const TEXT_B = '苏晚擦着剑上的水，火光照在她侧脸上，剑身映出一线冷白。'.repeat(5);

function fakeResult(overallScore = 70): WritingQualityResult {
    const dim = (score: number) => ({
        score,
        details: { vocabRichness: '40%', rhetoricCount: 2 },
        suggestions: [],
    });
    return {
        languageQuality: dim(overallScore),
        rhythmQuality: dim(70),
        characterQuality: dim(70),
        plotQuality: dim(70),
        atmosphereQuality: dim(70),
        structureQuality: dim(70),
        overallScore,
        grade: 'B',
        trend: 'stable',
        comparedToAverage: 0,
        topSuggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 0,
        evalTimeMs: 1,
    };
}

describe('C4 — 评估串行队列', () => {
    it('并发两次 evaluate 各自拿到自己人物名单的结果', async () => {
        const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

        const [a, b] = await Promise.all([
            engine.evaluate(TEXT_A, { characterNames: ['林默'] }),
            engine.evaluate(TEXT_B, { characterNames: ['苏晚'] }),
        ]);

        expect(a.dimensions.characterConsistency.details.uniqueCharacters).toBe(1);
        expect(b.dimensions.characterConsistency.details.uniqueCharacters).toBe(1);
        // 名单没有串台：A 的正文里没有苏晚，B 的正文里没有林默
        expect(a.dimensions.characterConsistency.details.uniqueCharacters)
            .toBe(b.dimensions.characterConsistency.details.uniqueCharacters);
    });

    it('evaluate 进入队列后才执行，调用返回时内核尚未被触碰', async () => {
        let calls = 0;
        const kernel = {
            evaluate: () => { calls++; return fakeResult(); },
            updateOptions: () => {},
        } as unknown as WritingQualityEngine;
        const engine = new QualityScoreEngine({ v1Engine: kernel });

        const pending = engine.evaluate(TEXT_A);
        expect(calls).toBe(0);

        await pending;
        expect(calls).toBe(1);
    });

    it('evaluateDimension 与 evaluate 共用同一队列', async () => {
        let calls = 0;
        const kernel = {
            evaluate: () => { calls++; return fakeResult(); },
            updateOptions: () => {},
        } as unknown as WritingQualityEngine;
        const engine = new QualityScoreEngine({ v1Engine: kernel });

        const [score] = await Promise.all([
            engine.evaluateDimension(TEXT_A, 'rhythm'),
            engine.evaluate(TEXT_B, { characterNames: ['苏晚'] }),
        ]);

        expect(score.score).toBe(70);
        expect(calls).toBe(2);
    });

    it('前一次评估抛错不会卡死队列', async () => {
        let calls = 0;
        const kernel = {
            evaluate: () => {
                calls++;
                if (calls === 1) throw new Error('kernel boom');
                return fakeResult(80);
            },
            updateOptions: () => {},
        } as unknown as WritingQualityEngine;
        const engine = new QualityScoreEngine({ v1Engine: kernel });

        await expect(engine.evaluate(TEXT_A)).rejects.toThrow('kernel boom');

        const second = await engine.evaluate(TEXT_B, { characterNames: ['苏晚'] });
        expect(second.overallScore).toBe(80);
        expect(calls).toBe(2);
    });
});
