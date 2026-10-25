import { describe, expect, it } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

const SAMPLE = `雨从屋檐上落下来，砸在青石板上，溅起一层白雾。陈默站在门口，手指捏着那枚已经发凉的铜钱。
他听见屋里有人咳嗽，一声接着一声，像要把肺咳出来。他推门进去，药味扑面而来，混着湿木头的气息。
"娘。"他喊了一声。床上的人没有应，只有被子起伏了一下。他把铜钱放在桌上，转身去找火折子，手指在黑暗里摸到了冰凉的刀柄。
他停住了。门外有脚步声，不止一个人。`;

function makeEngines() {
    return {
        v1: new WritingQualityEngine(),
        unified: new QualityScoreEngine({ v1Engine: new WritingQualityEngine() }),
    };
}

describe('QualityScoreEngine — 统一内核（v1Engine 注入）', () => {
    it('总分与 WritingQualityEngine 完全一致', async () => {
        const { v1, unified } = makeEngines();
        const direct = v1.evaluate(SAMPLE);
        const result = await unified.evaluate(SAMPLE);
        expect(result.overallScore).toBe(direct.overallScore);
    });

    it('五维按固定映射取自 v1 六维，语言质感由 languageQuality 子项派生', async () => {
        const { v1, unified } = makeEngines();
        const direct = v1.evaluate(SAMPLE);
        const result = await unified.evaluate(SAMPLE);

        expect(result.dimensions.readability.score).toBe(direct.languageQuality.score);
        expect(result.dimensions.rhythm.score).toBe(direct.rhythmQuality.score);
        expect(result.dimensions.emotion.score).toBe(direct.atmosphereQuality.score);
        expect(result.dimensions.characterConsistency.score).toBe(direct.characterQuality.score);
        expect(result.dimensions.coherence.score).toBe(direct.plotQuality.score);
        // C2：不再直接复用 languageQuality.score，而是由词汇丰富度 + 修辞密度派生
        expect(result.dimensions.languageTexture.score).not.toBeNaN();
        expect(result.dimensions.languageTexture.basis.join()).toContain('派生');
    });

    it('单维评估与整体评估口径一致', async () => {
        const { v1, unified } = makeEngines();
        const direct = v1.evaluate(SAMPLE);
        const single = await unified.evaluateDimension(SAMPLE, 'rhythm');
        expect(single.score).toBe(direct.rhythmQuality.score);
    });

    it('透传 v1Result：落盘可直接拿到含 structure 的完整六维，无需重算', async () => {
        const { v1, unified } = makeEngines();
        const direct = v1.evaluate(SAMPLE);
        const result = await unified.evaluate(SAMPLE);

        expect(result.v1Result).toBeDefined();
        expect(result.v1Result?.structureQuality.score).toBe(direct.structureQuality.score);
        expect(result.v1Result?.overallScore).toBe(result.overallScore);
    });

    it('未注入 v1Engine 时不透传 v1Result', async () => {
        const legacy = new QualityScoreEngine();
        const result = await legacy.evaluate(SAMPLE);
        expect(result.v1Result).toBeUndefined();
    });

    it('未注入 v1Engine 时保留原有规则路径', async () => {
        const legacy = new QualityScoreEngine();
        const result = await legacy.evaluate(SAMPLE);
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.overallScore).toBeLessThanOrEqual(100);
    });
});
