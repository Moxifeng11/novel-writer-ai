import { describe, expect, it } from 'vitest';
import {
    analyzeDistribution,
    checkFidelity,
    histogramSimilarity,
    humanSimilarity,
    scoreHumanity,
    stripNonProse,
    type DistributionHistogram,
} from '../../../shared/human-similarity';

/** 构造一个「真人」基线：句长偏碎、段长 80–160、对话占比 0.2 */
function humanBaseline(): DistributionHistogram {
    return {
        sentence: [0.1, 0.25, 0.3, 0.2, 0.1, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        paragraph: [0.1, 0.2, 0.3, 0.25, 0.15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        punctuation: {
            period: 0.05, comma: 0.06, semicolon: 0.0005, ellipsis: 0.0008,
            dash: 0.0004, exclamation: 0.0006, question: 0.0004,
        },
        dialogueRatio: 0.2,
    };
}

const HUMAN_TEXT = [
    '砂打在脸上。后颈那道月牙疤先挨了一下，硌得生疼。',
    '沈砚把肩膀往绳栏上又抵了抵，桥跟着晃，脚底下踩的木板“吱”一声，往左边歪过去半寸。',
    '“站直了。”父亲的声音压得极低，从牙缝里往外挤。',
    '他没吭声。',
    '左手的粗布小袋里，几个霄晶棱角顶着布面，硌出几个尖。',
].join('\n');

/** 典型 AI 腔：长句匀齐、全是句号、没有对话 */
const AI_TEXT = [
    '沈砚感受到砂粒打在脸上的疼痛，这让他想起了童年时期在矿区的艰苦生活。',
    '他抬起头看向远方的天际线，心中涌起一股莫名的情绪，仿佛有什么东西正在等待着他。',
    '父亲的声音在耳边响起，其中蕴含着深沉的关怀与期许，让他感受到了温暖的力量。',
    '他知道自己必须坚强地面对未来的一切挑战，无论前方等待他的是什么。',
].join('\n');

describe('human-similarity — 分布相似度', () => {
    it('去掉 frontmatter/标题/引用后只留正文', () => {
        const raw = ['---', 'tags: [正文]', '---', '# 第2章', '> 引用', '正文一句。'].join('\n');
        expect(stripNonProse(raw).trim()).toBe('正文一句。');
    });

    it('直方图相似度：同一分布为 1，完全不同为 0', () => {
        const a = [0.5, 0.5, 0, 0];
        expect(histogramSimilarity(a, a)).toBeCloseTo(1, 5);
        expect(histogramSimilarity([1, 0, 0, 0], [0, 0, 0, 1])).toBeCloseTo(0, 5);
    });

    it('真人样文比 AI 腔更接近真人基线（基线取自真人样文自身统计）', () => {
        const { content, ...baseline } = (() => {
            const dist = analyzeDistribution(HUMAN_TEXT);
            return { ...dist, content: undefined };
        })();
        const human = humanSimilarity(HUMAN_TEXT, baseline as unknown as DistributionHistogram).score;
        const ai = humanSimilarity(AI_TEXT, baseline as unknown as DistributionHistogram).score;
        // 同一段文本与自身基线：必然接近 1
        expect(human).toBeGreaterThan(0.95);
        // 典型 AI 腔（长句匀齐、无对话）明显更低
        expect(ai).toBeLessThan(human - 0.15);
    });

    it('句长/段长/对话三项分别可解释', () => {
        const dist = analyzeDistribution(HUMAN_TEXT);
        const baseline: DistributionHistogram = {
            sentence: dist.sentence, paragraph: dist.paragraph,
            punctuation: dist.punctuation, dialogueRatio: dist.dialogueRatio,
        };
        const detail = humanSimilarity(HUMAN_TEXT, baseline);
        expect(detail.sentence).toBeCloseTo(1, 2);
        expect(detail.paragraph).toBeCloseTo(1, 2);
        expect(detail.dialogue).toBeCloseTo(1, 2);
    });

    it('统计本身对空文本安全', () => {
        const dist = analyzeDistribution('');
        expect(dist.chars).toBe(1);
        expect(dist.sentenceCount).toBe(0);
        expect(dist.dialogueRatio).toBe(0);
    });
});

describe('human-similarity — 保真检查', () => {
    it('只改标点/虚词的改写算保真', () => {
        const rewritten = HUMAN_TEXT.replace('硌得生疼', '硌得他生疼');
        const result = checkFidelity(HUMAN_TEXT, rewritten);
        expect(result.ok).toBe(true);
        expect(result.contentOverlap).toBeGreaterThan(0.55);
    });

    it('长度腰斩算不保真', () => {
        const result = checkFidelity(HUMAN_TEXT, HUMAN_TEXT.slice(0, 10));
        expect(result.ok).toBe(false);
        expect(result.reasons.join()).toContain('过短');
    });

    it('换掉情节（内容重合过低）算不保真', () => {
        const result = checkFidelity(HUMAN_TEXT, AI_TEXT);
        expect(result.ok).toBe(false);
        expect(result.contentOverlap).toBeLessThan(0.55);
    });

    it('原文数字缺失算不保真', () => {
        const original = '他数到 3，桥面晃了 3 下。' + HUMAN_TEXT;
        const candidate = '他数了几下，桥面晃了几下。' + HUMAN_TEXT;
        expect(checkFidelity(original, candidate).numbersKept).toBe(false);
    });
});

describe('human-similarity — 章级对话下限（实测校准）', () => {
    // 实测：真人网文对话占比约 25%，AI 正文（第2章）只有 9%。
    // 句长/段长能被提示词调得像人，唯独对话密度调不出来，所以设成硬门槛。
    const longNarrative = Array.from({ length: 40 }, () => '他沿着砂峡道往前走，风把砂粒吹进领口，硌得脖颈发痒，脚步却没有停。').join('\n');

    it('整章几乎没有对话 → 判不保真', () => {
        const result = scoreHumanity({
            original: longNarrative,
            candidate: longNarrative,
            antiAI: 5,
            baseline: humanBaseline(),
        });
        expect(result.fidelity.ok).toBe(false);
        expect(result.fidelity.reasons.join()).toContain('对话占比');
        expect(result.composite).toBe(0);
    });

    it('短文本（< 1200 字）不套用章级下限', () => {
        const short = '他往前走。风很大。';
        const result = scoreHumanity({
            original: short, candidate: short, antiAI: 5, baseline: humanBaseline(),
        });
        expect(result.fidelity.reasons.join()).not.toContain('对话占比');
    });
});

describe('human-similarity — 综合分', () => {
    it('人味高且保真的改写综合分更高', () => {
        const baseline = humanBaseline();
        const good = scoreHumanity({
            original: HUMAN_TEXT,
            candidate: HUMAN_TEXT.replace('硌得生疼', '硌得他生疼'),
            antiAI: 10,
            baseline,
        });
        const bad = scoreHumanity({
            original: HUMAN_TEXT,
            candidate: AI_TEXT,
            antiAI: 10,
            baseline,
        });
        expect(good.composite).toBeGreaterThan(bad.composite);
    });

    it('保真失败时综合分为 0（再像人也不能改情节）', () => {
        const result = scoreHumanity({
            original: HUMAN_TEXT,
            candidate: AI_TEXT,
            antiAI: 0,
            baseline: humanBaseline(),
        });
        expect(result.fidelity.ok).toBe(false);
        expect(result.composite).toBe(0);
    });

    it('AI 味越高综合分越低（同文本）', () => {
        const baseline = humanBaseline();
        const low = scoreHumanity({ original: HUMAN_TEXT, candidate: HUMAN_TEXT, antiAI: 10, baseline });
        const high = scoreHumanity({ original: HUMAN_TEXT, candidate: HUMAN_TEXT, antiAI: 80, baseline });
        expect(low.composite).toBeGreaterThan(high.composite);
    });
});
