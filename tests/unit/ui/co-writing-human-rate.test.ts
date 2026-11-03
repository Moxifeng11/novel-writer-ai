import { describe, expect, it } from 'vitest';
import { calculateHumanRate } from '@/ui/co-writing/human-rate';

describe('calculateHumanRate', () => {
    it('空文本返回满分基线，风格记为未评估', () => {
        const scores = calculateHumanRate('');
        expect(scores.style).toBe(-1);
        expect(scores.sentenceLength).toBe(100);
        expect(scores.overall).toBeGreaterThan(0);
    });

    it('句长波动大时句长分下降', () => {
        const steady = calculateHumanRate('他走了。风停了。门开了。');
        const varied = calculateHumanRate('他走了。风从很远的地方卷过来，把门吹得哐当作响。门开了。');
        expect(varied.sentenceLength).toBeLessThan(steady.sentenceLength);
    });

    it('开头重复会拉低开头多样性', () => {
        const scores = calculateHumanRate('他说。他说。他说。');
        expect(scores.opening).toBeLessThan(100);
    });

    it('AI 高频词会被计入并拉低 AI 词分', () => {
        const clean = calculateHumanRate('他推门。风灌进来。');
        const ai = calculateHumanRate('然而他推门。于是风灌进来。仿佛有人在看。');
        expect(ai.aiWords).toBeLessThan(clean.aiWords);
        expect(ai.overall).toBeLessThan(clean.overall);
    });
});
