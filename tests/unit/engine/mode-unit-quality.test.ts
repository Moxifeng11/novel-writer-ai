import { describe, expect, it } from 'vitest';
import { evaluateModeUnitQuality } from '../../../engine/mode-unit-quality';
import { QualityScoreEngine } from '../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../engine/writing-quality-engine';

const evaluator = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

const SHORT_BODY = `林晚把合同推到桌子中央时，咖啡馆的暖气正嗡嗡作响。她没有看顾沉，只盯着杯沿那道细小的缺口。

“签字。”她说。

顾沉没有动。他的手指搭在杯壁上，指节因为用力而发白。窗外有人撑伞走过，雨声把两个人的沉默填得很满。

“你确定？”他问。林晚终于抬眼，看见他眼底那一点没藏好的疲惫。她想起三年前的雨天，他把伞偏到她这边，自己半边肩膀湿透。

“明天之前，给我答案。”她站起来，走到门口时听见椅子轻轻一动。她没有回头。雨还在下，玻璃门映出两个人一坐一站的影子，中间隔着一张空桌子。`;

const SCRIPT_BODY = `第1场 日 内 咖啡馆
△ 林晚推门而入，把合同拍在桌上。
林晚：（压着声音）签字，或者我现在就走。
顾沉：（抬眼）你确定要在这个时间点撕破脸？
△ 顾沉把手机推到桌边，屏幕亮起录音界面。

第2场 夜 外 天台
△ 风把两人的衣角吹得猎猎作响。
顾沉：你想要的从来不是合同。
林晚：（停顿）我想要的是你亲口承认。
△ 远处霓虹熄灭，只剩安全出口的绿光。`;

describe('evaluateModeUnitQuality — 短篇/剧本单元质检', () => {
    it('短篇返回六维 + 开篇/结尾检查，并给出通过结论', async () => {
        const report = await evaluateModeUnitQuality({
            mode: 'short',
            body: SHORT_BODY,
            title: '第1节',
            characterNames: ['林晚', '顾沉'],
            evaluator,
        });
        expect(report.dimensions).toHaveLength(6);
        expect(report.extras.map(item => item.key)).toEqual(['opening', 'ending']);
        expect(report.wordCount).toBeGreaterThan(100);
        expect(report.overallScore).toBeGreaterThanOrEqual(0);
        expect(report.grade.length).toBeGreaterThan(0);
    });

    it('剧本识别场次/动作/对白，并标记可拍性', async () => {
        const report = await evaluateModeUnitQuality({
            mode: 'script',
            body: SCRIPT_BODY,
            title: '第1集',
            characterNames: ['林晚', '顾沉'],
            evaluator,
        });
        const byKey = Object.fromEntries(report.extras.map(item => [item.key, item]));
        expect(byKey.scenes.passed).toBe(true);
        expect(byKey.action.passed).toBe(true);
        expect(byKey.scenes.blocking).toBe(true);
    });

    it('正文过短时不通过', async () => {
        const report = await evaluateModeUnitQuality({ mode: 'short', body: '太短了。', evaluator });
        expect(report.passed).toBe(false);
    });
});
