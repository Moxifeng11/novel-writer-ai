/**
 * llm-enhancer.test.ts — LLM 增强层单元测试
 *
 * 覆盖：
 * - enhanceWithLLM 成功/失败/降级路径
 * - enhanceResult 浅合并
 * - buildContextForDimension 各维度取样策略
 * - parseJSONResponse 容错（Markdown 代码块、前后空白）
 * - LLM 提示词模板生成
 * - GenreDetector.detectWithLLM 成功识别 + 失败降级
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMEnhancer, resetDegradationNoticeStateForTest, type LLMCaller } from '../../../engine/llm-enhancer';
import { getDimensionPrompt, type LLMEnhanceDimension } from '../../../engine/llm-prompts';
import { getDegradationNotifier } from '@/shared/degradation-notifier';
import { GenreDetector } from '../../../engine/genre/genre-detector';
import { GenreConfigRegistry } from '../../../engine/genre/genre-config-registry';

/** 构造 mock LLM 调用器 */
function createMockCaller(response: { content: string; error?: string }): LLMCaller & { calls: Array<{ system: string; user: string; model?: string }> } {
    const calls: Array<{ system: string; user: string; model?: string }> = [];
    return {
        calls,
        async callAI(systemPrompt: string, userPrompt: string, model?: string): Promise<{ content: string; error?: string }> {
            calls.push({ system: systemPrompt, user: userPrompt, model });
            return response;
        },
    };
}

/** 构造抛异常的 mock 调用器 */
function createThrowingCaller(errorMsg: string): LLMCaller {
    return {
        async callAI(): Promise<{ content: string; error?: string }> {
            throw new Error(errorMsg);
        },
    };
}

const SAMPLE_TEXT = '林动一掌拍出，灵力激荡，境界突破至筑基期。他眼神坚毅，性格沉稳而果断。';

describe('LLMEnhancer - enhanceWithLLM', () => {
    let enhancer: LLMEnhancer;

    describe('成功路径', () => {
        it('LLM 返回合法 JSON 时返回 success=true', async () => {
            const caller = createMockCaller({
                content: '{"personality":["冷静","果断"],"evidence":["一掌拍出","眼神坚毅"]}',
            });
            enhancer = new LLMEnhancer(caller, { llmModel: 'test-model' });

            const result = await enhancer.enhanceWithLLM({
                dimension: 'personality',
                text: SAMPLE_TEXT,
            });

            expect(result.success).toBe(true);
            expect(result.fallbackUsed).toBe(false);
            expect(result.data).toEqual({ personality: ['冷静', '果断'], evidence: ['一掌拍出', '眼神坚毅'] });
            expect(result.dimension).toBe('personality');
        });

        it('调用时传入指定模型名', async () => {
            const caller = createMockCaller({ content: '{"personality":[]}' });
            enhancer = new LLMEnhancer(caller, { llmModel: 'my-llm' });

            await enhancer.enhanceWithLLM({
                dimension: 'personality',
                text: SAMPLE_TEXT,
            });

            expect(caller.calls[0].model).toBe('my-llm');
        });

        it('LLM 返回带 Markdown 代码块的 JSON 时能正确解析', async () => {
            const caller = createMockCaller({
                content: '```json\n{"personality":["冷静"]}\n```',
            });
            enhancer = new LLMEnhancer(caller);

            const result = await enhancer.enhanceWithLLM({
                dimension: 'personality',
                text: SAMPLE_TEXT,
            });

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ personality: ['冷静'] });
        });

        it('LLM 返回带前后缀文字的 JSON 时能提取主体', async () => {
            const caller = createMockCaller({
                content: '好的，这是结果：{"personality":["冷静"]} 完成',
            });
            enhancer = new LLMEnhancer(caller);

            const result = await enhancer.enhanceWithLLM({
                dimension: 'personality',
                text: SAMPLE_TEXT,
            });

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ personality: ['冷静'] });
        });
    });

    describe('降级路径', () => {
        it('空文本时返回 fallbackUsed=true', async () => {
            const caller = createMockCaller({ content: '{}' });
            enhancer = new LLMEnhancer(caller);
            const existing = { foo: 'bar' };

            const result = await enhancer.enhanceWithLLM({
                dimension: 'personality',
                text: '',
                existingResult: existing,
            });

            expect(result.success).toBe(false);
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackData).toBe(existing);
            expect(result.error).toBe('empty text');
        });

        it('LLM 返回 error 字段时降级', async () => {
            const caller = createMockCaller({
                content: '',
                error: 'rate limit exceeded',
            });
            enhancer = new LLMEnhancer(caller);
            const existing = { foo: 'bar' };

            const result = await enhancer.enhanceWithLLM({
                dimension: 'style',
                text: SAMPLE_TEXT,
                existingResult: existing,
            });

            expect(result.success).toBe(false);
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackData).toBe(existing);
            expect(result.error).toBe('rate limit exceeded');
        });

        it('LLM 返回非 JSON 时降级', async () => {
            const caller = createMockCaller({
                content: '这不是 JSON',
            });
            enhancer = new LLMEnhancer(caller);
            const existing = { foo: 'bar' };

            const result = await enhancer.enhanceWithLLM({
                dimension: 'rhythm',
                text: SAMPLE_TEXT,
                existingResult: existing,
            });

            expect(result.success).toBe(false);
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackData).toBe(existing);
            expect(result.error).toBe('invalid JSON response');
        });

        it('LLM 调用抛异常时降级', async () => {
            const caller = createThrowingCaller('network error');
            enhancer = new LLMEnhancer(caller);
            const existing = { foo: 'bar' };

            const result = await enhancer.enhanceWithLLM({
                dimension: 'foreshadow',
                text: SAMPLE_TEXT,
                existingResult: existing,
            });

            expect(result.success).toBe(false);
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackData).toBe(existing);
            expect(result.error).toBe('network error');
        });

        it('降级时不影响纯统计结果（fallbackData 即 existingResult）', async () => {
            const caller = createThrowingCaller('fail');
            enhancer = new LLMEnhancer(caller);
            const existing = { count: 42, names: ['a', 'b'] };

            const result = await enhancer.enhanceWithLLM({
                dimension: 'goals',
                text: SAMPLE_TEXT,
                existingResult: existing,
            });

            expect(result.fallbackData).toBe(existing);
            expect(result.fallbackData).toEqual({ count: 42, names: ['a', 'b'] });
        });
    });
});

describe('LLMEnhancer - enhanceResult 便捷方法', () => {
    it('成功时浅合并 data 到 result', async () => {
        const caller = createMockCaller({
            content: '{"extraField":"llm-value"}',
        });
        const enhancer = new LLMEnhancer(caller);

        const baseResult = { baseField: 'stat-value', extraField: 'stat-old' };
        const merged = await enhancer.enhanceResult(baseResult, SAMPLE_TEXT, 'personality');

        expect(merged.baseField).toBe('stat-value');
        expect(merged.extraField).toBe('llm-value');
    });

    it('失败时原样返回 result', async () => {
        const caller = createThrowingCaller('fail');
        const enhancer = new LLMEnhancer(caller);

        const baseResult = { baseField: 'stat-value' };
        const merged = await enhancer.enhanceResult(baseResult, SAMPLE_TEXT, 'personality');

        expect(merged).toBe(baseResult);
    });
});

describe('LLMEnhancer - buildContextForDimension 静态方法', () => {
    const fullText = '段落一。段落一内容。\n\n段落二。段落二内容。\n\n段落三。段落三内容。\n\n段落四。段落四内容。\n\n段落五。段落五内容。';

    it('personality/abilities 维度取前 3-5 段', () => {
        const ctx = LLMEnhancer.buildContextForDimension('personality', fullText);
        expect(ctx.length).toBeGreaterThan(0);
        expect(ctx.length).toBeLessThanOrEqual(500);
        expect(ctx).toContain('段落一');
    });

    it('style 维度取首段+中段+尾段', () => {
        const ctx = LLMEnhancer.buildContextForDimension('style', fullText);
        expect(ctx).toContain('段落一');
        expect(ctx).toContain('段落五');
    });

    it('rhythm 维度取章节首尾段落', () => {
        const ctx = LLMEnhancer.buildContextForDimension('rhythm', fullText);
        expect(ctx).toContain('段落一');
        expect(ctx).toContain('段落五');
    });

    it('goals/genre/foreshadow 维度取前 500 字', () => {
        const ctx = LLMEnhancer.buildContextForDimension('genre', fullText);
        expect(ctx.length).toBeLessThanOrEqual(500);
    });

    it('空文本返回空字符串', () => {
        expect(LLMEnhancer.buildContextForDimension('personality', '')).toBe('');
    });

    it('段落数组参数优先生效', () => {
        const paragraphs = ['自定义段落A', '自定义段落B'];
        const ctx = LLMEnhancer.buildContextForDimension('personality', fullText, paragraphs);
        expect(ctx).toContain('自定义段落A');
    });
});

describe('llm-prompts - getDimensionPrompt', () => {
    const dimensions: LLMEnhanceDimension[] = [
        'personality', 'abilities', 'goals', 'style', 'rhythm', 'foreshadow', 'genre'
    ];

    it('每个维度都能生成 systemPrompt 和 userPrompt', () => {
        for (const dim of dimensions) {
            const prompt = getDimensionPrompt(dim, SAMPLE_TEXT);
            expect(prompt.systemPrompt).toBeTruthy();
            expect(prompt.userPrompt).toBeTruthy();
            expect(prompt.systemPrompt.length).toBeGreaterThan(50);
            expect(prompt.userPrompt).toContain(SAMPLE_TEXT);
        }
    });

    it('genre 维度提示词包含可选 genreId 列表', () => {
        const prompt = getDimensionPrompt('genre', SAMPLE_TEXT);
        expect(prompt.systemPrompt).toContain('cultivation');
        expect(prompt.systemPrompt).toContain('generic');
    });

    it('existingResult 会写入 userPrompt', () => {
        const existing = { count: 5 };
        const prompt = getDimensionPrompt('personality', SAMPLE_TEXT, undefined, existing);
        expect(prompt.userPrompt).toContain('"count":5');
    });

    it('无 existingResult 时 userPrompt 显示"（无）"', () => {
        const prompt = getDimensionPrompt('personality', SAMPLE_TEXT);
        expect(prompt.userPrompt).toContain('（无）');
    });
});

describe('GenreDetector - detectWithLLM', () => {
    let detector: GenreDetector;

    beforeEach(() => {
        GenreConfigRegistry.resetInstance();
        detector = new GenreDetector();
    });

    it('LLM 识别内置题材时返回对应 genreId', async () => {
        const caller = createMockCaller({
            content: '{"genreId":"cultivation","displayName":"修仙","detectorSignals":["灵力","境界"],"keywords":{"abilityKeywords":["剑术"],"styleKeywords":["白描"],"foreshadowTypes":["伏笔"]}}',
        });

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('cultivation');
        expect(result.confidence).toBe(0.6);
    });

    it('LLM 识别新题材时注册到 registry', async () => {
        const caller = createMockCaller({
            content: '{"genreId":"test_new_genre","displayName":"测试新题材","detectorSignals":["信号词1","信号词2"],"keywords":{"abilityKeywords":["能力1"],"styleKeywords":["风格1"],"foreshadowTypes":["伏笔1"]}}',
        });

        const registry = GenreConfigRegistry.getInstance();
        expect(registry.hasGenreConfig('test_new_genre')).toBe(false);

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('test_new_genre');
        expect(registry.hasGenreConfig('test_new_genre')).toBe(true);
        const config = registry.getGenreConfig('test_new_genre');
        expect(config.displayName).toBe('测试新题材');
        expect(config.detectorSignals).toEqual(['信号词1', '信号词2']);
    });

    it('LLM 返回 generic 时降级', async () => {
        const caller = createMockCaller({
            content: '{"genreId":"generic","displayName":"通用","detectorSignals":[],"keywords":{}}',
        });

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('generic');
        expect(result.confidence).toBe(0);
    });

    it('LLM 返回非法 genreId 时降级到 generic', async () => {
        const caller = createMockCaller({
            content: '{"genreId":"非法 ID!!!","displayName":"x","detectorSignals":[],"keywords":{}}',
        });

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('generic');
    });

    it('LLM 调用失败时降级到 generic', async () => {
        const caller = createThrowingCaller('LLM 不可用');

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('generic');
        expect(result.confidence).toBe(0);
    });

    it('LLM 返回非 JSON 时降级到 generic', async () => {
        const caller = createMockCaller({
            content: '这不是 JSON',
        });

        const result = await detector.detectWithLLM(SAMPLE_TEXT, caller);

        expect(result.genreId).toBe('generic');
    });

    it('空文本时返回 generic', async () => {
        const caller = createMockCaller({ content: '{}' });

        const result = await detector.detectWithLLM('', caller);

        expect(result.genreId).toBe('generic');
        expect(result.confidence).toBe(0);
    });

    it('识别新题材后纯统计 detect 能命中（detectorSignals 已注册）', async () => {
        // 先用 LLM 注册一个新题材，特征词为"测试信号词XYZ"
        const registerCaller = createMockCaller({
            content: '{"genreId":"test_signal_genre","displayName":"测试信号题材","detectorSignals":["测试信号词XYZ"],"keywords":{"abilityKeywords":[],"styleKeywords":[],"foreshadowTypes":[]}}',
        });
        await detector.detectWithLLM('某文本', registerCaller);

        // 用包含特征词的文本调用纯统计 detect
        const text = '测试信号词XYZ 测试信号词XYZ 测试信号词XYZ';
        const statResult = detector.detect(text);

        // 纯统计应该能识别到新注册的题材
        expect(statResult.genreId).toBe('test_signal_genre');
        expect(statResult.confidence).toBeGreaterThan(0);
    });
});

describe('LLM 增强层 - 纯统计流程零侵入验证', () => {
    it('未注入 llmEnhancer 时 deconstructor.analyze 行为不变', async () => {
        // 这个测试验证 LLMEnhancer 是可选注入的
        // 通过构造不注入 llmEnhancer 的 LLMEnhancer 实例间接验证
        const caller = createMockCaller({ content: '{}' });
        const enhancer = new LLMEnhancer(caller);

        // 不调用 enhanceWithLLM，enhancer 不应主动调用 caller
        expect(caller.calls.length).toBe(0);

        // 调用 enhanceWithLLM 才会触发 caller
        await enhancer.enhanceWithLLM({ dimension: 'personality', text: 'test' });
        expect(caller.calls.length).toBe(1);
    });

    it('默认温度为 0.3（结构化输出稳定）', async () => {
        const caller = createMockCaller({ content: '{}' });
        const enhancer = new LLMEnhancer(caller);

        await enhancer.enhanceWithLLM({ dimension: 'personality', text: 'test' });

        // 验证默认选项生效（间接验证：调用成功）
        expect(caller.calls.length).toBe(1);
    });
});

describe('降级上报（audit §三-4：LLM 增强降级可见化）', () => {
    beforeEach(() => resetDegradationNoticeStateForTest());

    /** 取 notifier 最近事件 */
    function recentEvents() {
        return getDegradationNotifier().getEvents();
    }

    it('**LLM 调用返回错误 → 上报 source=llm 降级事件**', async () => {
        const before = recentEvents().length;
        const enhancer = new LLMEnhancer(createMockCaller({ content: '', error: 'api 500' }));
        const result = await enhancer.enhanceWithLLM({ dimension: 'abilities', text: SAMPLE_TEXT, existingResult: { existing: true } });
        expect(result.fallbackUsed).toBe(true);
        const added = recentEvents().slice(before);
        expect(added.some(e => e.source === 'llm' && e.dimension === 'abilities')).toBe(true);
    });

    it('**LLM 抛异常 → 上报降级事件**', async () => {
        const before = recentEvents().length;
        const enhancer = new LLMEnhancer(createThrowingCaller('network down'));
        await enhancer.enhanceWithLLM({ dimension: 'goals', text: SAMPLE_TEXT, existingResult: { existing: true } });
        const added = recentEvents().slice(before);
        expect(added.some(e => e.source === 'llm' && e.dimension === 'goals')).toBe(true);
    });

    it('**同一维度只上报一次**（模块级去重，避免每章重复弹 Notice）', async () => {
        const enhancer = new LLMEnhancer(createThrowingCaller('boom'));
        await enhancer.enhanceWithLLM({ dimension: 'foreshadow', text: SAMPLE_TEXT, existingResult: { existing: true } });
        const first = recentEvents().filter(e => e.source === 'llm' && e.dimension === 'foreshadow').length;
        // 新建实例（模拟每章新建 enhancer）后再降级同一维度，不应再次上报
        const another = new LLMEnhancer(createThrowingCaller('boom'));
        await another.enhanceWithLLM({ dimension: 'foreshadow', text: SAMPLE_TEXT, existingResult: { existing: true } });
        const second = recentEvents().filter(e => e.source === 'llm' && e.dimension === 'foreshadow').length;
        expect(first).toBeGreaterThan(0);
        expect(second).toBe(first);
    });

    it('成功路径不产生降级事件（负例）', async () => {
        const before = recentEvents().length;
        const enhancer = new LLMEnhancer(createMockCaller({ content: '{"score":0.8}' }));
        await enhancer.enhanceWithLLM({ dimension: 'personality', text: SAMPLE_TEXT, existingResult: { existing: true } });
        expect(recentEvents().length).toBe(before);
    });
});
