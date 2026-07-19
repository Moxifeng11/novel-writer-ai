import { describe, it, expect } from 'vitest';
import { AntiAIDetector } from '../../../engine/anti-ai-detector';

const detector = new AntiAIDetector();

describe('AntiAIDetector — AI高频词黑名单', () => {
    it('黑名单包含至少15个词', () => {
        expect(AntiAIDetector.AI_HIGH_FREQ_WORDS.length).toBeGreaterThanOrEqual(15);
    });

    it('检测AI高频词正确', () => {
        const text = '然而他仿佛意识到了什么，似乎某种力量在召唤他。';
        const words = detector.detectAIWords(text);
        expect(words).toContain('然而');
        expect(words).toContain('仿佛');
        expect(words).toContain('似乎');
        expect(words).toContain('某种');
    });

    it('空文本不检测到任何词', () => {
        expect(detector.detectAIWords('')).toEqual([]);
    });
});

describe('AntiAIDetector — 句长波动约束', () => {
    it('句长均匀时触发句长波动约束', () => {
        const sentences = [
            '他走进了房间。',
            '她站在窗前。',
            '我看向远方。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.sentenceLengthWarning).toBeDefined();
        expect(result.sentenceLengthWarning).toContain('连续3句的字数必须有明显差异');
    });

    it('句长波动正常时不触发', () => {
        const sentences = [
            '他走进了那间昏暗的房间。',
            '她站在窗前，望着远方的山峦，心中思绪万千，久久不能平静。',
            '我看向远方。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.sentenceLengthWarning).toBeUndefined();
    });
});

describe('AntiAIDetector — 开头多样性约束', () => {
    it('开头重复时触发开头多样性约束', () => {
        const sentences = [
            '他走进了房间。',
            '他站在窗前。',
            '他看向远方。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.openingDiversityWarning).toBeDefined();
        expect(result.openingDiversityWarning).toContain('连续3句的开头词不得重复');
    });

    it('开头多样时不触发', () => {
        const sentences = [
            '他走进了房间。',
            '她站在窗前。',
            '我看向远方。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.openingDiversityWarning).toBeUndefined();
    });
});

describe('AntiAIDetector — 标点节奏约束', () => {
    it('标点单调时触发标点节奏约束', () => {
        const sentences = [
            '他走进了房间。',
            '她站在窗前。',
            '我看向远方。',
            '风吹过树梢。',
            '云飘过天空。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.punctuationWarning).toBeDefined();
        expect(result.punctuationWarning).toContain('句号占比不超过60%');
    });

    it('标点丰富时不触发', () => {
        const sentences = [
            '他走进了房间！',
            '她站在窗前？',
            '我看向远方……',
            '风吹过树梢——',
            '云飘过天空。'
        ];
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.punctuationWarning).toBeUndefined();
    });
});

describe('AntiAIDetector — 边界情况', () => {
    it('空句子数组不报错', () => {
        const result = detector.buildAntiAIConstraints({ recentSentences: [] });
        expect(result.constraints).toBe('');
        expect(result.blacklistedWords).toEqual([]);
        expect(result.sentenceLengthWarning).toBeUndefined();
        expect(result.openingDiversityWarning).toBeUndefined();
        expect(result.punctuationWarning).toBeUndefined();
    });

    it('约束文本不超过200字', () => {
        const sentences: string[] = [];
        for (let i = 0; i < 10; i++) {
            sentences.push('他走进了房间。');
        }
        const result = detector.buildAntiAIConstraints({ recentSentences: sentences });
        expect(result.constraints.length).toBeLessThanOrEqual(200);
    });
});
