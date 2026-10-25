import { describe, expect, it } from 'vitest';
import { QualityScoreEngine } from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

/**
 * 三个入口的评分口径：
 * - 质量仪表盘 / 协同顶栏：QualityScoreEngine({ v1Engine: WQE })
 * - 监控面板 B：直接 WritingQualityEngine.evaluate
 * QSE 在 v1 分支把 overallScore 直接透传 v1.overallScore，并把六维映射到 WQE 维度。
 * 这里锁定总分与可映射维度一致，避免面板 B 与仪表盘长期分叉。
 */

const TEXT = [
    '林默推开门，雨声灌了进来。',
    '他抬头看向屋檐下的人，苏晚正低头擦着剑上的水。',
    '林默没有说话，只是把伞递了过去。',
    '苏晚接过伞，轻声道了句谢，转身走进雨里。',
    '雨点砸在青石板上，溅起一层薄薄的白雾。',
    '林默站在原地，看着那道背影慢慢消失在巷口。',
    '他握紧伞柄，指节发白，直到巷口的灯彻底暗下去。',
    '回到屋里，桌上的茶已经凉了，杯沿还留着一圈浅浅的水痕。',
    '林默把茶倒掉，重新烧水，动作很慢，像是在等什么。',
    '窗外的雨没有停，风把门吹得轻轻响了一声。',
    '他忽然想起很多年前，也是这样一个雨夜，苏晚第一次走进这个院子。',
    '那时候他们都还年轻，以为只要握紧剑，就能把所有失去的东西夺回来。',
    '水开了，白汽升起来，模糊了窗上的雨痕。',
    '林默提起壶，给自己倒了一杯，也给对面空着的杯子倒了一杯。',
].join('\n');

describe('质量评分跨视图一致性', () => {
    it('QSE 注入 WQE 后总分与 WQE 直算一致', async () => {
        const direct = new WritingQualityEngine().evaluate(TEXT);
        const viaQse = await new QualityScoreEngine({
            v1Engine: new WritingQualityEngine(),
            cacheTtlMs: 0,
        }).evaluate(TEXT);

        expect(viaQse.overallScore).toBe(direct.overallScore);
    });

    it('QSE 的五个映射维度与 WQE 六维同源', async () => {
        const direct = new WritingQualityEngine().evaluate(TEXT);
        const viaQse = await new QualityScoreEngine({
            v1Engine: new WritingQualityEngine(),
            cacheTtlMs: 0,
        }).evaluate(TEXT);

        expect(viaQse.dimensions.readability.score).toBe(direct.languageQuality.score);
        expect(viaQse.dimensions.rhythm.score).toBe(direct.rhythmQuality.score);
        expect(viaQse.dimensions.emotion.score).toBe(direct.atmosphereQuality.score);
        expect(viaQse.dimensions.characterConsistency.score).toBe(direct.characterQuality.score);
        expect(viaQse.dimensions.coherence.score).toBe(direct.plotQuality.score);
        expect(Number.isFinite(viaQse.dimensions.languageTexture.score)).toBe(true);
    });
});
