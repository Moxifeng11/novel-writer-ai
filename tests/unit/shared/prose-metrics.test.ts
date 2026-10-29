import { describe, expect, it } from 'vitest';
import {
    analyzeProse,
    formatProseMetrics,
    scoreProseRisk,
    splitProseParagraphs,
    splitProseSentences,
} from '../../../shared/prose-metrics';

describe('prose-metrics', () => {
    it('空文本返回全零', () => {
        const metrics = analyzeProse('');
        expect(metrics.chars).toBe(0);
        expect(metrics.sentences).toBe(0);
        expect(metrics.paragraphs).toBe(0);
        expect(scoreProseRisk(metrics).score).toBe(0);
    });

    it('按行切段，忽略标题行', () => {
        const paragraphs = splitProseParagraphs('# 第1章 标题\n\n他抬手。\n风灌进来。');
        expect(paragraphs).toEqual(['他抬手。', '风灌进来。']);
    });

    it('切句保留句末标点', () => {
        const sentences = splitProseSentences('他抬手。风灌进来！真的吗？');
        expect(sentences).toEqual(['他抬手。', '风灌进来！', '真的吗？']);
    });

    it('碎片化文本：段短、单句段多、风险高', () => {
        const text = [
            '砂打在脸上。',
            '后颈那道月牙疤先挨了一下。',
            '硌得生疼。',
            '他把肩膀往绳栏上又抵了抵。',
            '桥跟着晃。',
        ].join('\n');
        const metrics = analyzeProse(text);
        const report = scoreProseRisk(metrics);

        expect(metrics.paragraphs).toBe(5);
        expect(metrics.avgNarrativeParagraphLength).toBeLessThan(30);
        expect(metrics.singleSentenceNarrativeParagraphRatio).toBe(1);
        expect(report.score).toBeGreaterThanOrEqual(60);
        expect(report.level).toBe('high');
        expect(report.issues.some((issue) => issue.id === 'fragmented-paragraphs')).toBe(true);
    });

    it('自然段文本：段长和句长明显改善', () => {
        const text = [
            '砂打在脸上，生疼。沈砚后颈那道月牙疤先挨了一下，硌得他龇了龇牙，把肩膀往绳栏上又抵了抵。桥跟着晃，脚底下踩的木板吱一声往左边歪过去半寸，他脚尖赶紧抓了抓鞋底，几粒碎砂灌进鞋尖，硌着脚趾头，难受得他直想骂娘。',
            '“站直了。”沈铁山的声音压得极低，从牙缝里往外挤。沈砚把背挺了挺，眼睛却还盯着桥那头灰白色的测脉碑。',
        ].join('\n');
        const metrics = analyzeProse(text);

        expect(metrics.paragraphs).toBe(2);
        expect(metrics.avgNarrativeParagraphLength).toBeGreaterThan(60);
        expect(metrics.singleSentenceNarrativeParagraphRatio).toBeLessThan(0.5);
    });

    it('统计对话占比与标点熵', () => {
        const text = '“你来了？”他问。\n“嗯。”她把伞收起来，抖了抖水，“路上堵。”';
        const metrics = analyzeProse(text);

        expect(metrics.dialogueCharsRatio).toBeGreaterThan(0.1);
        expect(metrics.punctuationEntropy).toBeGreaterThan(1);
        expect(formatProseMetrics(metrics)).toContain('对话');
    });

    it('叙述段里夹一句对话仍算叙述段', () => {
        const text = '沈砚把包袱放在桌角，手指在布结上停了一下。“够吗？”他问。沈铁山没回头，只把肩膀缩了缩。';
        const metrics = analyzeProse(text);

        expect(metrics.narrativeParagraphs).toBe(1);
        expect(metrics.dialogueParagraphs).toBe(0);
        expect(metrics.avgNarrativeParagraphLength).toBeGreaterThan(20);
    });

    it('标点越单一，熵越低', () => {
        const monotone = analyzeProse('他走了。她也走了。风停了。');
        const varied = analyzeProse('他走了？她也走了……风停了：真的吗！');
        expect(varied.punctuationEntropy).toBeGreaterThan(monotone.punctuationEntropy);
    });
});
