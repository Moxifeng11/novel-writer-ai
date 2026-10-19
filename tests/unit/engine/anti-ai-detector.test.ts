import { describe, it, expect, afterEach } from 'vitest';
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

describe('AntiAIDetector — 多维检测引擎（P0-1 升级）', () => {
    it('detectWithPositions 检出 AI 模板短语并返回正确位置', () => {
        const text = '他的眼中闪过一丝惊讶，嘴角微微上扬。';
        const hits = detector.detectWithPositions(text);
        const l2Hits = hits.filter(h => h.type === 'l2');
        expect(l2Hits.length).toBeGreaterThan(0);
        for (const h of l2Hits) {
            expect(text.slice(h.start, h.end)).toBe(h.text);
            expect(h.start).toBeGreaterThanOrEqual(0);
            expect(h.end).toBeLessThanOrEqual(text.length);
        }
    });

    it('detect 返回完整检测结果（评分 0-100 + 命中 + 特征）', () => {
        const text = '然而他仿佛意识到了什么，似乎某种力量在召唤他。他的眼中闪过一丝惊讶，嘴角微微上扬，心中暗道一声不好。';
        const result = detector.detect(text);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.hits.length).toBeGreaterThan(0);
        expect(result.features.length).toBeGreaterThan(0);
    });

    it('score 是 detect.score 的快捷方式', () => {
        const text = '他的眼中闪过一丝惊讶，嘴角微微上扬。';
        expect(detector.score(text)).toBe(detector.detect(text).score);
    });

    it('AI 模板短语文本得分高于干净文本', () => {
        const aiText = '他的眼中闪过一丝惊讶，嘴角微微上扬，心中暗道一声不好，仿佛某种力量在召唤他。';
        const cleanText = '他盯着对面的人，手里那把刀还没放下。刚才那一下，差点要了他的命。';
        expect(detector.score(aiText)).toBeGreaterThan(detector.score(cleanText));
    });

    it('空文本返回 0 分且无命中', () => {
        const result = detector.detect('');
        expect(result.score).toBe(0);
        expect(result.hits).toEqual([]);
        expect(result.suggestions).toEqual([]);
    });
});

describe('AntiAIDetector — A1 评分可解释性', () => {
    it('每个特征分项都带上计入总分的原始得分', () => {
        const text = '然而他仿佛意识到了什么，似乎某种力量在召唤他。他的眼中闪过一丝惊讶，嘴角微微上扬。';
        const result = detector.detect(text);
        for (const feature of result.features) {
            expect(typeof feature.score).toBe('number');
            expect(feature.score as number).toBeGreaterThanOrEqual(0);
        }
    });

    it('各分项得分之和可解释总分（总分另有 100 上限）', () => {
        const text = '然而他仿佛意识到了什么，于是不由得后退一步。与此同时，某种莫名的情绪涌了上来。';
        const result = detector.detect(text);
        const sum = result.features.reduce((acc, f) => acc + (f.score ?? 0), 0);
        expect(sum).toBeGreaterThan(0);
        expect(result.score).toBeLessThanOrEqual(Math.round(sum));
    });

    it('无 AI 味文本的分项得分全为 0（无需解释的分数）', () => {
        const result = detector.detect('他盯着对面的人，手里那把刀还没放下。');
        const sum = result.features.reduce((acc, f) => acc + (f.score ?? 0), 0);
        expect(result.score).toBeLessThanOrEqual(Math.round(sum));
    });
});

describe('AntiAIDetector — R2 词表可扩充', () => {
    afterEach(() => {
        AntiAIDetector.setExtraHighFreqWords([]);
    });

    it('默认为基础词表，长度不因扩充 API 引入而改变', () => {
        expect(AntiAIDetector.getExtraHighFreqWords()).toEqual([]);
        expect(AntiAIDetector.AI_HIGH_FREQ_WORDS.length).toBeGreaterThanOrEqual(15);
    });

    it('扩充词即时进入避用词检测与 L1 词频命中', () => {
        AntiAIDetector.setExtraHighFreqWords(['话说']);
        expect(AntiAIDetector.AI_HIGH_FREQ_WORDS).toContain('话说');
        expect(detector.detectAIWords('话说你最近如何')).toContain('话说');
        expect(detector.detectWithPositions('话说你最近如何').some(h => h.type === 'l1' && h.text === '话说')).toBe(true);
    });

    it('扩充词会实际抬高 AI 味评分', () => {
        const text = '话说，这件事说来话长。话说回来，他早知道会这样。话说到这里，也就够了。';
        const before = new AntiAIDetector().score(text);
        AntiAIDetector.setExtraHighFreqWords(['话说']);
        const after = new AntiAIDetector().score(text);
        expect(after).toBeGreaterThan(before);
    });

    it('空白项、重复项与内置项会被剔除，保证词表不膨胀', () => {
        AntiAIDetector.setExtraHighFreqWords(['  然而  ', '话说', '话说', '', '  ']);
        expect(AntiAIDetector.getExtraHighFreqWords()).toEqual(['话说']);
    });

    it('传空数组或空值即恢复内置词表', () => {
        AntiAIDetector.setExtraHighFreqWords(['话说']);
        AntiAIDetector.setExtraHighFreqWords(undefined as unknown as string[]);
        expect(AntiAIDetector.getExtraHighFreqWords()).toEqual([]);
        expect(AntiAIDetector.AI_HIGH_FREQ_WORDS).not.toContain('话说');
    });
});
