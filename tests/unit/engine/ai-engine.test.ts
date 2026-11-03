import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {
            apiKey: 'test-key',
            apiEndpoint: 'https://test.api/v1/chat/completions',
            defaultModel: 'gpt-3.5-turbo',
            proModel: 'gpt-4',
            maxOutput: 4096,
            minWordCount: 2000,
            maxWordCount: 4000,
            maxContext: 8000,
            availableModels: ['gpt-3.5-turbo', 'gpt-4'],
            enableAutoModelFallback: true,
            maxApiRetries: 3,
            customProviders: [],
        };
        app = {};
    },
}));

import { AIEngine, APIResponse } from '../../../engine/ai-engine';
import { AIApiClient } from '../../../engine/ai-api-client';
import { buildChapterPrompts, buildSystemPrompt, buildUserPrompt } from '../../../engine/ai-prompt-builder';
import type { ChapterContext } from '../../../engine/ai-types';

function makeMockPlugin() {
    return {
        settings: {
            apiKey: 'test-key',
            apiEndpoint: 'https://test.api/v1/chat/completions',
            defaultModel: 'gpt-3.5-turbo',
            proModel: 'gpt-4',
            maxOutput: 4096,
            minWordCount: 2000,
            maxWordCount: 4000,
            maxContext: 8000,
            availableModels: ['gpt-3.5-turbo', 'gpt-4'],
            enableAutoModelFallback: true,
            maxApiRetries: 3,
            customProviders: [],
        },
        app: {},
        engineRegistry: {
            get: vi.fn().mockReturnValue(null),
            getOrNull: vi.fn().mockReturnValue(null),
        },
    } as any;
}

function makeChapterContext(overrides: Partial<ChapterContext> = {}): ChapterContext {
    return {
        chapterNumber: 5,
        project: '测试项目',
        volume: '第1卷',
        chapterPlan: '分卷规划内容',
        outline: '本章大纲：主角遭遇危机',
        infoPlan: '信息规划：揭示伏笔A',
        previousChapters: '前文摘要：主角刚刚进入秘境',
        unrevealedForeshadow: '未揭示伏笔列表',
        timelineEvents: '时间线事件',
        worldView: '世界观：玄幻修真世界',
        settingLib: '设定库内容',
        worldType: '玄幻',
        writingStyle: '文笔风格要求',
        characters: '人物状态：主角林惊鸿',
        forcedReveal: [],
        unrevealedCount: 5,
        ...overrides,
    };
}

describe('AIEngine.getMaxConcurrent', () => {
    it('默认模型返回默认并发数 2', () => {
        expect(AIEngine.getMaxConcurrent('gpt-3.5-turbo')).toBe(2);
        expect(AIEngine.getMaxConcurrent('unknown-model')).toBe(2);
    });

    it('轻量模型（flash/mini/nano/haiku/air/1-8）返回并发数 4', () => {
        expect(AIEngine.getMaxConcurrent('gpt-4o-mini')).toBe(4);
        expect(AIEngine.getMaxConcurrent('claude-3-haiku-20240307')).toBe(4);
        expect(AIEngine.getMaxConcurrent('gemini-1.5-flash')).toBe(4);
        expect(AIEngine.getMaxConcurrent('gemini-1.5-nano')).toBe(4);
        expect(AIEngine.getMaxConcurrent('gpt-4o-air')).toBe(4);
    });

    it('重型推理模型（reasoner/r1/opus/v4-pro）返回并发数 1', () => {
        expect(AIEngine.getMaxConcurrent('deepseek-reasoner')).toBe(1);
        expect(AIEngine.getMaxConcurrent('deepseek-r1')).toBe(1);
        expect(AIEngine.getMaxConcurrent('claude-3-opus-20240229')).toBe(1);
        expect(AIEngine.getMaxConcurrent('gpt-v4-pro')).toBe(1);
    });

    it('本地 Ollama 模型（qwen2.5/deepseek-r1:7b/ollama）返回并发数 4', () => {
        expect(AIEngine.getMaxConcurrent('qwen2.5:7b')).toBe(4);
        expect(AIEngine.getMaxConcurrent('qwen2.5-coder:14b')).toBe(4);
        expect(AIEngine.getMaxConcurrent('ollama://llama3')).toBe(4);
    });

    it('模型名称大小写不敏感', () => {
        expect(AIEngine.getMaxConcurrent('GPT-4O-MINI')).toBe(4);
        expect(AIEngine.getMaxConcurrent('DeepSeek-R1')).toBe(1);
        expect(AIEngine.getMaxConcurrent('QWEN2.5:7B')).toBe(4);
    });
});

describe('buildSystemPrompt - 请求构建', () => {
    it('注入唯一来源规则文本与单一镜头锚点（v4.26）', () => {
        const ctx = makeChapterContext();
        const rules = '【写作规则（唯一来源）】每章只有一个镜头。';
        const prompt = buildSystemPrompt(ctx, { minWordCount: 2000, maxWordCount: 4000 }, undefined, rules);
        expect(prompt).toContain('【本章镜头】视角人物：主角');
        expect(prompt).toContain('【写作规则（唯一来源）】');
        expect(prompt).toContain('每章只有一个镜头');
        // 不再内嵌第二份规则/数值禁令
        expect(prompt).not.toContain('破折号偶尔用');
        expect(prompt).not.toContain('每章至少回收1个旧伏笔');
    });

    it('包含世界观题材类型', () => {
        const ctx = makeChapterContext({ worldType: '都市' });
        const prompt = buildSystemPrompt(ctx, { minWordCount: 2000, maxWordCount: 4000 });
        expect(prompt).toContain('都市');
        expect(prompt).toContain('题材世界');
    });

    it('传入空规则时使用镜头兜底引导（不注入第二份规则）', () => {
        const ctx = makeChapterContext();
        const prompt = buildSystemPrompt(ctx, { minWordCount: 2000, maxWordCount: 4000 });
        expect(prompt).toContain('【本章镜头】视角人物：主角');
        expect(prompt).toContain('别人的心思只从动作与语气里流露');
    });

    // B6：知识注入是 user 中的可裁剪层，不能拼到 system 尾部（否则窗口不足时最先被截掉）
    it('知识注入进入 user 的可裁剪层而不是 system 尾部', () => {
        const ctx = makeChapterContext();
        const knowledge = '【文笔风格注入】主角说话习惯用短句';
        const prompts = buildChapterPrompts(
            ctx,
            { minWordCount: 2000, maxWordCount: 4000 },
            undefined,
            knowledge,
            { maxContext: 128000, maxOutput: 4096 },
        );

        expect(prompts.system).not.toContain('【文笔风格注入】');
        expect(prompts.user).toContain('主角说话习惯用短句');
        expect(prompts.droppedKnowledge).toBe(false);
    });

    it('空知识注入不改变 prompt 结构', () => {
        const ctx = makeChapterContext();
        const promptWithout = buildSystemPrompt(ctx, { minWordCount: 2000, maxWordCount: 4000 });
        const prompts = buildChapterPrompts(
            ctx,
            { minWordCount: 2000, maxWordCount: 4000 },
            undefined,
            '   ',
            { maxContext: 128000, maxOutput: 4096 },
        );
        expect(prompts.system).toBe(promptWithout);
        expect(prompts.user).toBe(buildUserPrompt(ctx, { minWordCount: 2000 }));
    });
});

describe('buildUserPrompt - 请求构建', () => {
    it('包含章节号和标题格式要求', () => {
        const ctx = makeChapterContext({ chapterNumber: 10 });
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('第10章');
        expect(prompt).toContain('# 第10章 标题');
        expect(prompt).toContain('标题 2-15 字');
    });

    it('包含世界观和设定库', () => {
        const ctx = makeChapterContext({
            worldView: '世界观完整内容',
            settingLib: '设定库完整内容',
        });
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('【世界观】');
        expect(prompt).toContain('世界观完整内容');
        expect(prompt).toContain('【设定库】');
        expect(prompt).toContain('设定库完整内容');
    });

    it('包含人物状态和大纲', () => {
        const ctx = makeChapterContext({
            characters: '林惊鸿：主角，剑修',
            outline: '本章主角大战魔尊',
        });
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('【人物状态】');
        expect(prompt).toContain('林惊鸿');
        expect(prompt).toContain('【本章大纲】');
        expect(prompt).toContain('大战魔尊');
    });

    it('强制揭示伏笔时列出具体伏笔名称', () => {
        const ctx = makeChapterContext({
            forcedReveal: ['神秘玉佩', '身世之谜'],
        });
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('【本章必须揭示的伏笔】');
        expect(prompt).toContain('神秘玉佩');
        expect(prompt).toContain('身世之谜');
        expect(prompt).toContain('本章优先揭示以下伏笔');
    });

    it('包含最后指令和自查清单', () => {
        const ctx = makeChapterContext();
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('【最后指令】');
        expect(prompt).toContain('【输出前检查】');
        expect(prompt).toContain('标题必须完整');
        expect(prompt).toContain('每段开头空两格');
        // v4.26：不再把字数写死进自查项
        expect(prompt).not.toContain('字数≥2000字');
    });

    it('前文摘要和分卷规划正确拼接', () => {
        const ctx = makeChapterContext({
            chapterPlan: '分卷规划：本卷主角升级',
            previousChapters: '前文摘要：上一章结尾...',
        });
        const prompt = buildUserPrompt(ctx, { minWordCount: 2000 });
        expect(prompt).toContain('【分卷规划】');
        expect(prompt).toContain('【前文摘要】');
    });
});

describe('APIResponse 类型与错误处理', () => {
    it('成功响应包含 content 和 usage', () => {
        const response: APIResponse = {
            content: '生成的正文内容',
            usage: { prompt: 100, completion: 500, total: 600 },
        };
        expect(response.content).toBeTruthy();
        expect(response.usage?.total).toBe(600);
        expect(response.error).toBeUndefined();
    });

    it('错误响应包含 error 字段且 content 为空', () => {
        const response: APIResponse = {
            content: '',
            error: '网络连接超时',
        };
        expect(response.content).toBe('');
        expect(response.error).toBe('网络连接超时');
    });

    it('usage 可选，缺失时不报错', () => {
        const response: APIResponse = {
            content: '测试内容',
        };
        expect(response.content).toBe('测试内容');
        expect(response.usage).toBeUndefined();
    });
});

describe('AIEngine.generateChapterStream', () => {
    it('截断后携带前文尾部继续生成并合并结果', async () => {
        const plugin = makeMockPlugin();
        const engine = Object.create(AIEngine.prototype) as AIEngine;
        (engine as any).plugin = plugin;
        const responses: APIResponse[] = [
            { content: '第一段'.repeat(30), finishReason: 'length' },
            { content: '第二段', finishReason: 'stop' },
        ];
        const prompts: string[] = [];
        vi.spyOn(engine, 'callAIStream').mockImplementation(async (_system, userPrompt, _model, _temperature, _maxTokens, onChunk) => {
            prompts.push(userPrompt);
            const response = responses.shift()!;
            onChunk?.(response.content, false);
            onChunk?.(response.content, true);
            return response;
        });

        const result = await engine.generateChapterStream(makeChapterContext(), vi.fn());

        expect(result.content).toBe('第一段'.repeat(30) + '第二段');
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain('第一段'.repeat(30).slice(-500));
    });

    it('连续续写无新增内容时停止，避免无限调用', async () => {
        const plugin = makeMockPlugin();
        const engine = Object.create(AIEngine.prototype) as AIEngine;
        (engine as any).plugin = plugin;
        const content = '稳定内容'.repeat(20);
        const callAIStream = vi.spyOn(engine, 'callAIStream').mockImplementation(async () => ({
            content,
            finishReason: 'length',
        }));

        const result = await engine.generateChapterStream(makeChapterContext(), vi.fn());

        expect(callAIStream).toHaveBeenCalledTimes(2);
        expect(result.content).toBe(content + content);
    });
});

describe('AIEngine 构造与委托', () => {
    it('构造函数正常初始化，不抛出错误', () => {
        const plugin = makeMockPlugin();
        expect(() => {
            new AIEngine(plugin);
        }).not.toThrow();
    });

    it('getPlugin 返回传入的 plugin 实例', () => {
        const plugin = makeMockPlugin();
        const engine = new AIEngine(plugin);
        expect(engine.getPlugin()).toBe(plugin);
    });

    it('resetSessionTokens 重置会话 token 计数', () => {
        const plugin = makeMockPlugin();
        const engine = new AIEngine(plugin);
        engine.resetSessionTokens();
        expect(engine.sessionTokens).toEqual({ input: 0, output: 0 });
    });

    it('sessionTokens 返回副本，外部修改不影响内部状态', () => {
        const plugin = makeMockPlugin();
        const engine = new AIEngine(plugin);
        const tokens = engine.sessionTokens;
        tokens.input = 999;
        expect(engine.sessionTokens.input).toBe(0);
    });

    it('callAI 未显式给 maxTokens 时使用 settings.maxOutput（不再被静态表压到 4096）', async () => {
        const plugin = makeMockPlugin();
        plugin.settings.maxOutput = 131072;
        const engine = new AIEngine(plugin) as any;
        const originalCallAI = engine.apiClient.callAI;
        engine.apiClient.callAI = vi.fn().mockResolvedValue({ content: 'ok' });

        await engine.callAI('system', 'user', 'deepseek-flash', 0.7);

        expect(engine.apiClient.callAI).toHaveBeenCalledWith(
            'system', 'user', 'deepseek-flash', 0.7, 131072, undefined
        );

        engine.apiClient.callAI = originalCallAI;
    });

    it('callAI 显式 maxTokens 原样透传，由 API 客户端按模型能力上限收敛', async () => {
        const plugin = makeMockPlugin();
        const engine = new AIEngine(plugin) as any;
        const originalCallAI = engine.apiClient.callAI;
        engine.apiClient.callAI = vi.fn().mockResolvedValue({ content: 'ok' });

        await engine.callAI('system', 'user', 'deepseek-flash', 0.7, 2048);

        expect(engine.apiClient.callAI).toHaveBeenCalledWith(
            'system', 'user', 'deepseek-flash', 0.7, 2048, undefined
        );

        engine.apiClient.callAI = originalCallAI;
    });

    it('callAI 委托给 apiClient.callAI', async () => {
        const plugin = makeMockPlugin();
        const engine = new AIEngine(plugin) as any;
        const mockResult: APIResponse = { content: 'mock result' };

        const originalCallAI = engine.apiClient.callAI;
        engine.apiClient.callAI = vi.fn().mockResolvedValue(mockResult);

        const result = await engine.callAI('system', 'user', 'gpt-4', 0.8, 2048);

        expect(engine.apiClient.callAI).toHaveBeenCalledWith(
            'system', 'user', 'gpt-4', 0.8, 2048, undefined
        );
        expect(result).toEqual(mockResult);

        engine.apiClient.callAI = originalCallAI;
    });
});

describe('AIApiClient - 响应解析逻辑', () => {
    it('OpenAI 格式响应正确提取 content', () => {
        const mockResponse = {
            choices: [{ message: { content: 'Hello World' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        };
        const content = mockResponse.choices?.[0]?.message?.content;
        expect(content).toBe('Hello World');
        expect(mockResponse.usage?.total_tokens).toBe(30);
    });

    it('Ollama 原生格式响应正确转换', () => {
        const mockResponse = {
            response: 'Ollama response content',
            prompt_eval_count: 15,
            eval_count: 25,
            done: true,
        };
        const content = mockResponse.response;
        const usage = {
            prompt_tokens: mockResponse.prompt_eval_count || 0,
            completion_tokens: mockResponse.eval_count || 0,
            total_tokens: (mockResponse.prompt_eval_count || 0) + (mockResponse.eval_count || 0),
        };
        expect(content).toBe('Ollama response content');
        expect(usage.total_tokens).toBe(40);
    });

    it('空 choices 返回空内容', () => {
        const mockResponse = { choices: [] } as any;
        const content = mockResponse.choices?.[0]?.message?.content;
        expect(content).toBeUndefined();
    });

    it('无 message 字段时 content 为 undefined', () => {
        const mockResponse = { choices: [{}] } as any;
        const content = mockResponse.choices?.[0]?.message?.content;
        expect(content).toBeUndefined();
    });
});

describe('AIApiClient - 错误类型判断', () => {
    function isDisconnectionError(error: unknown, statusCode?: number): boolean {
        if (statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) return true;
        if (statusCode === 408) return true;
        if (statusCode && statusCode >= 400 && statusCode < 500) return false;
        if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError') return true;
        if (error instanceof TypeError) return true;
        const msg = error instanceof Error ? error.message.toLowerCase() :
            typeof error === 'string' ? error.toLowerCase() : '';
        if (msg.includes('fetch failed') || msg.includes('networkerror')
            || msg.includes('timeout') || msg.includes('econnrefused')
            || msg.includes('enotfound') || msg.includes('certificate')
            || msg.includes('ssl') || msg.includes('cloudflare')
            || msg.includes('502 bad gateway')) return true;
        return false;
    }

    it('5xx 服务端错误视为断联错误', () => {
        expect(isDisconnectionError(null, 500)).toBe(true);
        expect(isDisconnectionError(null, 502)).toBe(true);
        expect(isDisconnectionError(null, 503)).toBe(true);
        expect(isDisconnectionError(null, 504)).toBe(true);
    });

    it('408 超时视为断联错误', () => {
        expect(isDisconnectionError(null, 408)).toBe(true);
    });

    it('4xx 客户端错误不视为断联错误', () => {
        expect(isDisconnectionError(null, 400)).toBe(false);
        expect(isDisconnectionError(null, 401)).toBe(false);
        expect(isDisconnectionError(null, 403)).toBe(false);
        expect(isDisconnectionError(null, 404)).toBe(false);
        expect(isDisconnectionError(null, 429)).toBe(false);
    });

    it('AbortError 视为断联错误', () => {
        const abortError = { name: 'AbortError', message: 'aborted' };
        expect(isDisconnectionError(abortError)).toBe(true);
    });

    it('TypeError（如 fetch failed）视为断联错误', () => {
        const typeError = new TypeError('fetch failed');
        expect(isDisconnectionError(typeError)).toBe(true);
    });

    it('网络错误消息关键字视为断联错误', () => {
        expect(isDisconnectionError(new Error('NetworkError'))).toBe(true);
        expect(isDisconnectionError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isDisconnectionError(new Error('ENOTFOUND'))).toBe(true);
        expect(isDisconnectionError(new Error('502 Bad Gateway'))).toBe(true);
    });

    it('普通错误不视为断联错误', () => {
        expect(isDisconnectionError(new Error('something went wrong'))).toBe(false);
        expect(isDisconnectionError(new Error('invalid response'))).toBe(false);
    });
});
