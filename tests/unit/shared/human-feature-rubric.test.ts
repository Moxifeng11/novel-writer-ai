import { describe, expect, it } from 'vitest';
import {
    HUMAN_FEATURE_TARGETS,
    analyzeHumanFeatures,
    evaluateHumanFeatures,
    formatRubric,
} from '../../../shared/human-feature-rubric';

/** 人工样本（朱雀判定「人工创作特征显著」）的节选：对话密集、短句交替、有口语与时间锚点 */
const HUMAN_LIKE = [
    '“关羽。”',
    '萧白把这词在舌尖上含了一遍，松开。BP本被合上的嗓音隔着舞台传过来，对面席位已经有人起身。',
    '“走。”',
    '晏清和在通道口拦住他，战术册还摊着，挡在他和出口之间。“先别急。你说他拿关羽，你从哪听出来的。”',
    '“他亲口说的，两个字。”萧白脚步没停，只是往旁边让了半步，“人在我们对面，声音还不至于听错。”',
    '“关羽是他吃饭的家伙。”晏清和往旁边让开路，跟他并排走，“两年前那场MVP就是用关羽打的。”',
    '“好家伙。”江宜撇了下嘴，“说得跟我一定会死一样。”',
    '“坐下。”萧白两个字，两个人同时闭嘴。',
    '第一波兵线，关羽在线上没动。第二波兵线，关羽没动。第三波兵线，河道草丛里的关羽猛地冲出来。',
    '“他往中路去了。”萧白报，声音紧了一线，“江宜，退。退到底。”',
    '“我掉兵了。”鹿小野的动静听上去咽了口气，“我一级没反到蓝，全废了。”',
    '“废不了。”萧白说，“你听我指挥就行。”',
    '第八分钟，经济差被拉平。第九分钟，关羽又推了萧白一次。',
    '“他们要打远古龙。我们接。”',
    '鹿小野的响动卡了一拍：“我们经济还落后两千多。”',
    '“我晓得。”萧白说，“所以接的时候不跟他们抢第一条。”',
].join('\n');

/** 典型生成稿：叙述为主、对话稀疏、句句短、没有口语 */
const AI_LIKE = Array.from({ length: 30 }, (_, i) => (
    `砂粒打在脸上，他抬手挡了一下。风从峡口灌进来，吹得砂布顶噗噗响。他低着头往前走，脚下踩着碎砂。`
    + (i % 6 === 0 ? '“走。”' : '')
)).join('\n');

describe('human-feature-rubric — 人工特征评分卡', () => {
    it('人工样本命中全部特征（对话/碎度/口语/锚点）', () => {
        const result = evaluateHumanFeatures(HUMAN_LIKE);
        expect(result.metrics.dialogueRatio).toBeGreaterThan(HUMAN_FEATURE_TARGETS.dialogueRatio[0]);
        expect(result.metrics.shortNarrationShare).toBeLessThanOrEqual(HUMAN_FEATURE_TARGETS.shortNarrationShare[1]);
        expect(result.metrics.colloquialPerKilo).toBeGreaterThan(0);
        expect(result.metrics.timeAnchors).toBeGreaterThanOrEqual(2);
        expect(result.issues.map((i) => i.key)).not.toContain('dialogueRatio');
    });

    it('AI 稿在对话占比上必然失败', () => {
        const result = evaluateHumanFeatures(AI_LIKE);
        expect(result.metrics.dialogueRatio).toBeLessThan(HUMAN_FEATURE_TARGETS.dialogueRatio[0]);
        expect(result.issues.map((i) => i.key)).toContain('dialogueRatio');
    });

    it('叙述过碎（>85% 短句）也会被判问题，而不是越碎越好', () => {
        // 需要 ≥1200 字才判定：150 行 × 9 字 ≈ 1350 字
        const veryChopped = Array.from({ length: 150 }, () => '他走。风大。砂落。').join('\n');
        const result = evaluateHumanFeatures(veryChopped);
        expect(result.metrics.shortNarrationShare).toBeGreaterThan(HUMAN_FEATURE_TARGETS.shortNarrationShare[1]);
        expect(result.issues.map((i) => i.key)).toContain('shortNarration');
    });

    it('短文本（<1200 字）不判定，score 为 0 且无 issue', () => {
        const result = evaluateHumanFeatures('他走。风大。');
        expect(result.metrics.chars).toBeLessThan(1200);
        expect(result.issues).toEqual([]);
        expect(result.score).toBe(0);
    });

    it('空文本安全', () => {
        const metrics = analyzeHumanFeatures('');
        expect(metrics.chars).toBe(1);
        expect(metrics.dialogueRatio).toBe(0);
        expect(Number.isFinite(metrics.dialogueBlocksPerKilo)).toBe(true);
    });

    it('formatRubric 输出可读摘要（含未达标原因）', () => {
        const text = formatRubric(evaluateHumanFeatures(AI_LIKE));
        expect(text).toContain('人工特征');
        expect(text).toContain('对话');
    });
});
