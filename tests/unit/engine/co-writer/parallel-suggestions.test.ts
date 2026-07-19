
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    scoreSuggestionQuality,
    sortSuggestionsByQuality,
    ParallelSuggestionGenerator,
    type StreamGeneratorFactory,
    type ParallelSuggestionOptions,
} from '../../../../engine/co-writer/parallel-suggestions';
import type { SuggestionRecord, SuggestionDirection } from '../../../../shared/types';
import { createSimulatedStream } from '../../../../engine/streaming/simulated-stream';

function createMockSuggestion(
    id: string,
    text: string,
    direction: SuggestionDirection = 'action',
    style: 'default' | 'creative' | 'conservative' = 'default'
): SuggestionRecord {
    return {
        id,
        text,
        direction,
        style,
        temperature: 0.7,
        preview: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
    };
}

function createMockStreamFactory(
    texts: string[],
    options: { failOnAttempt?: Record<number, number[]>; delayMs?: number } = {}
): StreamGeneratorFactory {
    const callCount: Record<number, number> = {};

    return (direction: SuggestionDirection, directionIndex: number, signal: AbortSignal) => {
        const idx = directionIndex;
        callCount[idx] = (callCount[idx] || 0) + 1;
        const currentAttempt = callCount[idx];

        const failIndices = options.failOnAttempt?.[idx] || [];
        const shouldFail = failIndices.includes(currentAttempt);

        const text = texts[idx] || '默认建议文本。';

        return (async function* () {
            if (signal.aborted) {
                return null;
            }

            if (shouldFail) {
                throw new Error(`模拟失败 (方向 ${idx}, 尝试 ${currentAttempt})`);
            }

            const stream = createSimulatedStream(text, {
                splitBy: 'char',
                chunkSize: 5,
                minDelayMs: options.delayMs ?? 5,
                maxDelayMs: options.delayMs ?? 10,
            });

            let finalText = '';
            while (true) {
                if (signal.aborted) {
                    return null;
                }
                const { value, done } = await stream.next();
                if (done) {
                    finalText = value as string;
                    break;
                }
                yield value;
            }

            return createMockSuggestion(
                `mock_${idx}_${Date.now()}`,
                finalText,
                direction,
                idx === 0 ? 'default' : idx === 1 ? 'creative' : 'conservative'
            );
        })();
    };
}

describe('scoreSuggestionQuality', () => {
    describe('长度评分', () => {
        it('200-500字应该得高分', () => {
            const text = '这是一段测试文本。'.repeat(20);
            const result = scoreSuggestionQuality(text);
            expect(result.details.lengthScore).toBeGreaterThanOrEqual(90);
        });

        it('少于100字得分较低', () => {
            const text = '短文本。';
            const result = scoreSuggestionQuality(text);
            expect(result.details.lengthScore).toBeLessThan(70);
        });

        it('超过800字得分逐渐降低', () => {
            const text = '这是一段很长的测试文本。'.repeat(80);
            const result = scoreSuggestionQuality(text);
            expect(result.details.lengthScore).toBeLessThan(80);
        });

        it('空文本得分最低', () => {
            const result = scoreSuggestionQuality('');
            expect(result.details.lengthScore).toBeGreaterThanOrEqual(20);
            expect(result.score).toBeLessThan(50);
        });
    });

    describe('多样性评分', () => {
        it('包含对话的文本多样性得分更高', () => {
            const textWithDialogue = '他看着她。「你好。」她说。他点了点头。';
            const textWithoutDialogue = '他看着她。她说话了。他点了点头。';
            const scoreWith = scoreSuggestionQuality(textWithDialogue).details.diversityScore;
            const scoreWithout = scoreSuggestionQuality(textWithoutDialogue).details.diversityScore;
            expect(scoreWith).toBeGreaterThan(scoreWithout);
        });

        it('包含动作描写的文本多样性得分更高', () => {
            const textWithAction = '他转身迈步，抬手握拳，脚步沉稳。';
            const textSimple = '他走过去。他做了动作。';
            const scoreWith = scoreSuggestionQuality(textWithAction).details.diversityScore;
            const scoreSimple = scoreSuggestionQuality(textSimple).details.diversityScore;
            expect(scoreWith).toBeGreaterThanOrEqual(scoreSimple);
        });

        it('包含环境描写的文本多样性得分更高', () => {
            const textWithDesc = '阳光洒在地面上，风带来花的气味，温度适宜。';
            const textSimple = '天气很好。';
            const scoreWith = scoreSuggestionQuality(textWithDesc).details.diversityScore;
            const scoreSimple = scoreSuggestionQuality(textSimple).details.diversityScore;
            expect(scoreWith).toBeGreaterThanOrEqual(scoreSimple);
        });
    });

    describe('连贯性评分', () => {
        it('有前文时，与前文有衔接的文本连贯性得分更高', () => {
            const precedingText = '他站在门口，看着远方的山脉，心中充满了期待。';
            const textCoherent = '山脉的轮廓在阳光下格外清晰，他深吸一口气。';
            const textRandom = '宇宙中有很多星星，黑洞是很神奇的天体。';
            const scoreCoherent = scoreSuggestionQuality(textCoherent, precedingText).details.coherenceScore;
            const scoreRandom = scoreSuggestionQuality(textRandom, precedingText).details.coherenceScore;
            expect(scoreCoherent).toBeGreaterThanOrEqual(scoreRandom);
        });

        it('有多句话的文本连贯性得分更高', () => {
            const multiSentence = '第一句话。第二句话。第三句话。';
            const singleSentence = '只有一句话';
            const scoreMulti = scoreSuggestionQuality(multiSentence).details.coherenceScore;
            const scoreSingle = scoreSuggestionQuality(singleSentence).details.coherenceScore;
            expect(scoreMulti).toBeGreaterThanOrEqual(scoreSingle);
        });
    });

    describe('综合评分', () => {
        it('高质量文本综合得分应该高', () => {
            const goodText = '他站在窗前，目光落在远方的山峦上。「你真的决定了？」身后传来她的声音。他没有回头，只是轻轻点了点头。窗外的风吹动窗帘，带着一丝凉意。';
            const result = scoreSuggestionQuality(goodText);
            expect(result.score).toBeGreaterThan(50);
            expect(result.score).toBeLessThanOrEqual(100);
        });

        it('评分应该在0-100范围内', () => {
            const texts = [
                '',
                '短',
                '正常长度的一段文本。',
                '他说。她说。他们说。'.repeat(10),
                '非常长的文本。'.repeat(100),
            ];
            for (const text of texts) {
                const result = scoreSuggestionQuality(text);
                expect(result.score).toBeGreaterThanOrEqual(0);
                expect(result.score).toBeLessThanOrEqual(100);
            }
        });
    });
});

describe('sortSuggestionsByQuality', () => {
    it('应该按质量得分从高到低排序', () => {
        const shortSuggestion = createMockSuggestion('1', '短文本。');
        const goodSuggestion = createMockSuggestion(
            '2',
            '他站在窗前，目光落在远方的山峦上。「你真的决定了？」身后传来她的声音。他没有回头，只是轻轻点了点头。窗外的风吹动窗帘，带着一丝凉意。'
        );
        const mediumSuggestion = createMockSuggestion(
            '3',
            '他走过去。她说了句话。他点了点头。'
        );

        const suggestions = [shortSuggestion, goodSuggestion, mediumSuggestion];
        const sorted = sortSuggestionsByQuality(suggestions);

        expect(sorted.length).toBe(3);
        const scores = sorted.map(s => scoreSuggestionQuality(s.text).score);
        expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
        expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
    });

    it('不应该修改原始数组', () => {
        const s1 = createMockSuggestion('1', '文本一。');
        const s2 = createMockSuggestion('2', '文本二。');
        const original = [s1, s2];
        const sorted = sortSuggestionsByQuality(original);

        expect(sorted).not.toBe(original);
        expect(original[0].id).toBe('1');
        expect(original[1].id).toBe('2');
    });
});

describe('ParallelSuggestionGenerator', () => {
    describe('基本功能', () => {
        it('应该并行生成指定数量的建议', async () => {
            const texts = [
                '第一条建议文本。内容很丰富。',
                '第二条建议文本。风格不同。',
                '第三条建议文本。比较保守。',
            ];
            const factory = createMockStreamFactory(texts, { delayMs: 2 });
            const directions: SuggestionDirection[] = ['action', 'emotion', 'dialogue'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();

            expect(result.handles.length).toBe(3);
            expect(result.handles[0].direction).toBe('action');
            expect(result.handles[1].direction).toBe('emotion');
            expect(result.handles[2].direction).toBe('dialogue');

            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(3);
            for (let i = 0; i < allSuggestions.length; i++) {
                expect(allSuggestions[i].text.length).toBeGreaterThan(0);
            }

            for (const handle of result.handles) {
                expect(handle.status).toBe('completed');
                expect(handle.currentText.length).toBeGreaterThan(0);
            }
        });

        it('每条建议应该有独立的流式输出', async () => {
            const texts = [
                '第一条建议。分两句话。',
                '第二条建议。也分两句话。',
            ];
            const factory = createMockStreamFactory(texts, { delayMs: 5 });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();

            const firstHandle = result.handles[0];
            expect(['pending', 'streaming']).toContain(firstHandle.status);

            const allSuggestions = await result.allCompleted;

            expect(firstHandle.status).toBe('completed');
            expect(firstHandle.currentText).toBe(texts[0]);

            expect(allSuggestions.length).toBe(2);
        });

        it('生成完成后应该按质量排序', async () => {
            const shortText = '短。';
            const goodText = '他站在窗前，目光落在远方的山峦上。「你真的决定了？」身后传来她的声音。他没有回头，只是轻轻点了点头。窗外的风吹动窗帘，带着一丝凉意。';
            const mediumText = '他走过去。她说了句话。他点了点头。'

            const texts = [shortText, goodText, mediumText];
            const factory = createMockStreamFactory(texts, { delayMs: 2 });
            const directions: SuggestionDirection[] = ['action', 'emotion', 'dialogue'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(3);

            const scores = allSuggestions.map(s => scoreSuggestionQuality(s.text).score);
            for (let i = 1; i < scores.length; i++) {
                expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
            }
        });
    });

    describe('失败重试机制', () => {
        it('单条建议失败不应该影响其他建议', async () => {
            const texts = [
                '第一条成功的建议。',
                '第二条成功的建议。',
                '第三条成功的建议。',
            ];
            const factory = createMockStreamFactory(texts, {
                delayMs: 2,
                failOnAttempt: { 1: [1] },
            });
            const directions: SuggestionDirection[] = ['action', 'emotion', 'dialogue'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(2);
            expect(result.handles.filter(h => h.status === 'completed').length).toBe(2);
            expect(result.handles.filter(h => h.status === 'failed').length).toBe(1);
            expect(result.handles[1].status).toBe('failed');
            expect(result.handles[1].error).toBeDefined();
        });

        it('失败后应该自动重试', async () => {
            const texts = [
                '第一条建议。',
                '第二条建议，首次失败后重试成功。',
            ];
            const factory = createMockStreamFactory(texts, {
                delayMs: 2,
                failOnAttempt: { 1: [1] },
            });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 5000,
                maxRetries: 1,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(2);
            expect(result.handles[1].status).toBe('completed');
        });

        it('重试次数耗尽后应该标记为失败', async () => {
            const texts = [
                '第一条成功。',
                '第二条永远失败。',
            ];
            const factory = createMockStreamFactory(texts, {
                delayMs: 2,
                failOnAttempt: { 1: [1, 2, 3] },
            });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 5000,
                maxRetries: 1,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(1);
            expect(result.handles[1].status).toBe('failed');
        });
    });

    describe('取消功能', () => {
        it('调用cancel应该取消所有正在进行的生成', async () => {
            const texts = [
                '第一条很长的建议。需要很多时间才能生成完成。'.repeat(5),
                '第二条也很长的建议。同样需要很多时间。'.repeat(5),
            ];
            const factory = createMockStreamFactory(texts, { delayMs: 50 });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();

            setTimeout(() => {
                result.cancel();
            }, 30);

            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBeLessThanOrEqual(2);
        });

        it('取消后handles应该标记为失败或保持完成状态', async () => {
            const texts = [
                '快建议。',
                '慢建议。需要很长时间。'.repeat(20),
            ];
            const factory = createMockStreamFactory(texts, { delayMs: 30 });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();

            setTimeout(() => {
                result.cancel();
            }, 20);

            await result.allCompleted;

            const statuses = result.handles.map(h => h.status);
            expect(statuses.some(s => s === 'failed' || s === 'completed')).toBe(true);
        });
    });

    describe('超时处理', () => {
        it('生成超时应该被标记为失败', async () => {
            const texts = [
                '正常的建议。',
                '这条生成非常慢，应该超时。'.repeat(50),
            ];
            const factory = createMockStreamFactory(texts, { delayMs: 200 });
            const directions: SuggestionDirection[] = ['action', 'emotion'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 2,
                timeoutMs: 100,
                maxRetries: 0,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBeLessThanOrEqual(1);
        }, 5000);
    });

    describe('并发行为', () => {
        it('建议应该是并行生成的，总时间应该小于串行时间', async () => {
            const texts = [
                '第一条建议文本。内容适中。'.repeat(2),
                '第二条建议文本。内容适中。'.repeat(2),
                '第三条建议文本。内容适中。'.repeat(2),
            ];
            const perChunkDelay = 20;
            const factory = createMockStreamFactory(texts, { delayMs: perChunkDelay });
            const directions: SuggestionDirection[] = ['action', 'emotion', 'dialogue'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const startTime = Date.now();
            const result = generator.generate();
            await result.allCompleted;
            const totalTime = Date.now() - startTime;

            const estimatedSerialTime = texts.length * 6 * perChunkDelay;
            expect(totalTime).toBeLessThan(estimatedSerialTime);
        }, 5000);
    });

    describe('边界情况', () => {
        it('方向数量少于请求数量时，应该按实际方向数生成', () => {
            const texts = ['建议一。', '建议二。'];
            const factory = createMockStreamFactory(texts, { delayMs: 2 });
            const directions: SuggestionDirection[] = ['action'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();
            expect(result.handles.length).toBe(1);
        });

        it('所有建议都失败时，应该返回空数组且所有handle都是failed状态', async () => {
            const texts = ['失败1。', '失败2。', '失败3。'];
            const factory = createMockStreamFactory(texts, {
                delayMs: 2,
                failOnAttempt: { 0: [1, 2], 1: [1, 2], 2: [1, 2] },
            });
            const directions: SuggestionDirection[] = ['action', 'emotion', 'dialogue'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 3,
                timeoutMs: 5000,
                maxRetries: 1,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(allSuggestions.length).toBe(0);
            expect(result.handles.every(h => h.status === 'failed')).toBe(true);
        });

        it('可以只生成1条建议', async () => {
            const texts = ['单条建议。'];
            const factory = createMockStreamFactory(texts, { delayMs: 2 });
            const directions: SuggestionDirection[] = ['action'];

            const generator = new ParallelSuggestionGenerator(factory, directions, {
                count: 1,
                timeoutMs: 5000,
                maxRetries: 0,
            });

            const result = generator.generate();
            const allSuggestions = await result.allCompleted;

            expect(result.handles.length).toBe(1);
            expect(allSuggestions.length).toBe(1);
        });
    });
});
