/**
 * C2 — 六维映射去重 + 看板同源上下文。
 *
 * 历史行为：mapV1Dimension 把 readability 与 languageTexture 都映射到
 * v1.languageQuality.score，雷达图两轴同源；看板 evaluate(text) 不传上下文，
 * 同一段正文在看板与协同视图的人物维度/总分不同。
 */

import { describe, it, expect } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import {
    WritingQualityEngine,
    type WritingQualityResult,
    type QualityDimension as WqeDimension,
} from '../../../../engine/writing-quality-engine';
import { QSE_CALIBRATION, QSE_SUB_WEIGHTS } from '../../../../shared/thresholds';

const TEXT = '林默推开木门，风灌进来，吹得桌上的信纸哗啦作响。他伸手按住纸角，指节发白。'
    .repeat(6);

function dim(score: number, details: Record<string, number | string> = {}): WqeDimension {
    return { score, details, suggestions: [] };
}

/** 只用于验证映射的口径，不参与真实评分 */
function createFakeV1(languageScore: number, details: Record<string, number | string>): WritingQualityEngine {
    const result: WritingQualityResult = {
        languageQuality: dim(languageScore, details),
        rhythmQuality: dim(70),
        characterQuality: dim(70),
        plotQuality: dim(70),
        atmosphereQuality: dim(70),
        structureQuality: dim(70),
        overallScore: 70,
        grade: 'B',
        trend: 'stable',
        comparedToAverage: 0,
        topSuggestions: [],
        evaluatedAt: Date.now(),
        wordCount: TEXT.length,
        evalTimeMs: 1,
    };
    return { evaluate: () => result } as unknown as WritingQualityEngine;
}

describe('C2 — languageTexture 由 V1 子项派生', () => {
    it('readability 仍取 languageQuality.score，languageTexture 改由词汇/修辞派生', async () => {
        const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });
        const result = await engine.evaluate(TEXT);
        const v1 = result.v1Result!;

        expect(result.dimensions.readability.score).toBe(v1.languageQuality.score);

        const vocabPct = Number.parseFloat(String(v1.languageQuality.details.vocabRichness));
        const rhetoricCount = Number(v1.languageQuality.details.rhetoricCount);
        const weights = QSE_SUB_WEIGHTS.languageTextureFromV1;
        const expected = Math.round(
            Math.min(100, vocabPct * QSE_CALIBRATION.readability.vocabScale) * weights.vocab
            + Math.min(100, rhetoricCount * QSE_CALIBRATION.languageTexture.rhetoricPerHit) * weights.rhetoric,
        );

        expect(result.dimensions.languageTexture.score).toBe(expected);
        expect(result.dimensions.languageTexture.basis.join()).toContain('派生');
        expect(result.dimensions.languageTexture.details.derivation).toBeTruthy();
    });

    it('词汇/修辞子项极低时，派生的语言质感不再等于语言质量原分', async () => {
        const engine = new QualityScoreEngine({
            v1Engine: createFakeV1(90, { vocabRichness: '10%', rhetoricCount: 0 }),
        });
        const result = await engine.evaluate(TEXT);

        expect(result.dimensions.readability.score).toBe(90);
        expect(result.dimensions.languageTexture.score).toBe(9);
        expect(result.dimensions.languageTexture.score).not.toBe(result.dimensions.readability.score);
    });

    it('V1 未产出词汇/修辞子项时回退语言质量原值，不产生 NaN', async () => {
        const engine = new QualityScoreEngine({
            v1Engine: createFakeV1(55, { note: '内容不足100字，无法评估' }),
        });
        const result = await engine.evaluate(TEXT);

        expect(result.dimensions.languageTexture.score).toBe(55);
        expect(result.dimensions.languageTexture.basis.join()).toContain('原值');
        expect(result.dimensions.languageTexture.details.derivation).toBeUndefined();
    });
});
