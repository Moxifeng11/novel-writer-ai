import { describe, it, expect } from 'vitest';
import { calculateRhythmStats, calculatePerspectiveStats } from '../../../../engine/style/v2-quantitative-extractor';

describe('v2-quantitative-extractor — 节奏维度', () => {
    it('短句为主的文本 short 占比更高', () => {
        const text = '他来了。她走了。天黑了。灯亮了。';
        const stats = calculateRhythmStats(text);
        expect(stats.sentenceLengthDistribution.short).toBeGreaterThan(stats.sentenceLengthDistribution.long);
        expect(stats.avgSentenceLength).toBeLessThan(10);
    });

    it('长句为主的文本 long 占比更高', () => {
        const text = '这是一个非常非常长的句子因为它包含了很多很多的内容而且没有停顿一直延续下去直到最后才结束。';
        const stats = calculateRhythmStats(text);
        expect(stats.sentenceLengthDistribution.long).toBeGreaterThan(0);
    });

    it('标点密度为正且随标点增多而上升', () => {
        const sparse = calculateRhythmStats('这是一个没有太多标点的句子内容');
        const dense = calculateRhythmStats('这，是，一，个，标，点，很，多，的，句，子！');
        expect(dense.punctuationDensity).toBeGreaterThan(sparse.punctuationDensity);
    });

    it('空文本不抛异常并返回零值', () => {
        const stats = calculateRhythmStats('');
        expect(stats.avgSentenceLength).toBe(0);
        expect(stats.punctuationDensity).toBe(0);
        expect(stats.status).toBe('complete');
    });
});

describe('v2-quantitative-extractor — 视角维度', () => {
    it('第一人称为主的文本 first 占比最高', () => {
        const text = '我站起身，我望向窗外，我心里想着这件事。';
        const stats = calculatePerspectiveStats(text);
        expect(stats.personDistribution.first).toBeGreaterThan(stats.personDistribution.third);
    });

    it('第三人称为主的文本 third 占比最高', () => {
        const text = '他推开门，他看见她站在门口，他们相视一笑。';
        const stats = calculatePerspectiveStats(text);
        expect(stats.personDistribution.third).toBeGreaterThan(stats.personDistribution.first);
    });

    it('人称分布三项之和约等于 1', () => {
        const stats = calculatePerspectiveStats('我看看你，你看着他，他看向我。');
        const sum = stats.personDistribution.first + stats.personDistribution.second + stats.personDistribution.third;
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
    });

    it('空文本不抛异常', () => {
        const stats = calculatePerspectiveStats('');
        expect(stats.status).toBe('complete');
    });
});
