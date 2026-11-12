import { describe, it, expect } from 'vitest';
import {
    API_FORMAT_OPTIONS,
    buildAuthHeaders,
    buildChatRequestBody,
    normalizeApiFormat,
    parseChatResponse,
    parseSseFrame,
    resolveApiRoot,
    resolveModelsUrl,
    resolveRequestUrl,
    usesDoneSentinel,
} from '../../../shared/api-format';

describe('API 格式：规范化与 URL 推导', () => {
    it('合法值原样返回，未知值回落到 openai-chat', () => {
        expect(normalizeApiFormat('anthropic-messages')).toBe('anthropic-messages');
        expect(normalizeApiFormat('openai-responses')).toBe('openai-responses');
        expect(normalizeApiFormat('')).toBe('openai-chat');
        expect(normalizeApiFormat('marvellous')).toBe('openai-chat');
        expect(normalizeApiFormat(undefined)).toBe('openai-chat');
    });

    it('旧 apiStyle=ollama 归一到 openai-chat', () => {
        expect(normalizeApiFormat('ollama')).toBe('openai-chat');
    });

    it('下拉选项覆盖三种协议，短名与路径分离', () => {
        expect(API_FORMAT_OPTIONS.map(o => o.value)).toEqual([
            'anthropic-messages',
            'openai-chat',
            'openai-responses',
        ]);
        for (const option of API_FORMAT_OPTIONS) {
            // label 只放协议短名：旧版把路径塞进 label（36 字符），
            // 窄面板下会被 <select> 硬截断
            expect(option.label).not.toContain('(');
            expect(option.label.length).toBeLessThanOrEqual(24);
            // 路径单独提供，且以 / 开头
            expect(option.path).toMatch(/^\//);
        }
    });

    it('根地址剥离已写全的请求路径与结尾 /v1', () => {
        expect(resolveApiRoot('https://api.deepseek.com')).toBe('https://api.deepseek.com');
        expect(resolveApiRoot('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com');
        expect(resolveApiRoot('https://api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com');
        expect(resolveApiRoot('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic');
        expect(resolveApiRoot('https://api.deepseek.com/anthropic/v1')).toBe('https://api.deepseek.com/anthropic');
        expect(resolveApiRoot('https://api.openai.com/v1/responses')).toBe('https://api.openai.com');
    });

    it('按格式推导请求地址', () => {
        expect(resolveRequestUrl('https://api.deepseek.com', 'openai-chat'))
            .toBe('https://api.deepseek.com/v1/chat/completions');
        expect(resolveRequestUrl('https://api.deepseek.com/anthropic', 'anthropic-messages'))
            .toBe('https://api.deepseek.com/anthropic/v1/messages');
        expect(resolveRequestUrl('https://api.openai.com/v1', 'openai-responses'))
            .toBe('https://api.openai.com/v1/responses');
    });

    it('历史配置里写全的 chat/completions 原样复用，不重复拼路径', () => {
        expect(resolveRequestUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'openai-chat'))
            .toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    });

    it('Ollama 原生 /api/chat 路径不被改写', () => {
        expect(resolveRequestUrl('http://localhost:11434/api/chat', 'openai-chat'))
            .toBe('http://localhost:11434/api/chat');
    });

    it('模型列表地址按协议推导', () => {
        expect(resolveModelsUrl('https://api.deepseek.com', 'openai-chat'))
            .toBe('https://api.deepseek.com/models');
        expect(resolveModelsUrl('https://api.deepseek.com/v1', 'openai-chat'))
            .toBe('https://api.deepseek.com/models');
        expect(resolveModelsUrl('https://api.deepseek.com/anthropic', 'anthropic-messages'))
            .toBe('https://api.deepseek.com/anthropic/v1/models?limit=1000');
    });

    it('空地址不推导出半截 URL', () => {
        expect(resolveRequestUrl('', 'openai-chat')).toBe('');
        expect(resolveModelsUrl('   ', 'openai-chat')).toBe('');
    });
});

describe('API 格式：请求体与鉴权头', () => {
    const base = {
        model: 'deepseek-v4.1-flash',
        systemPrompt: '你是编辑',
        userPrompt: '写一段',
        temperature: 0.6,
        maxTokens: 2048,
        stream: false,
    };

    it('Chat Completions 用 messages + max_tokens', () => {
        const body = buildChatRequestBody('openai-chat', base);
        expect(body.messages).toEqual([
            { role: 'system', content: '你是编辑' },
            { role: 'user', content: '写一段' },
        ]);
        expect(body.max_tokens).toBe(2048);
        expect(body.stream).toBeUndefined();
    });

    it('Chat Completions 流式带 stream:true', () => {
        const body = buildChatRequestBody('openai-chat', { ...base, stream: true });
        expect(body.stream).toBe(true);
    });

    it('Anthropic 用 system + messages + max_tokens，且不带 system 角色消息', () => {
        const body = buildChatRequestBody('anthropic-messages', base);
        expect(body.system).toBe('你是编辑');
        expect(body.messages).toEqual([{ role: 'user', content: '写一段' }]);
        expect(body.max_tokens).toBe(2048);
    });

    it('Anthropic 思考预算必须小于 max_tokens，否则服务端 400', () => {
        const body = buildChatRequestBody('anthropic-messages', { ...base, thinkingBudget: 99_999 });
        const thinking = body.thinking as { budget_tokens: number };
        expect(thinking.budget_tokens).toBeLessThan(2048);
        expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
    });

    it('Anthropic 预算过大到无法小于 max_tokens 时不发 thinking', () => {
        const body = buildChatRequestBody('anthropic-messages', {
            ...base,
            maxTokens: 1024,
            thinkingBudget: 4096,
        });
        expect(body.thinking).toBeUndefined();
    });

    it('Responses 用 instructions + input + max_output_tokens', () => {
        const body = buildChatRequestBody('openai-responses', base);
        expect(body.instructions).toBe('你是编辑');
        expect(body.input).toBe('写一段');
        expect(body.max_output_tokens).toBe(2048);
        expect(body.messages).toBeUndefined();
    });

    it('Anthropic 密钥走 x-api-key 且带 anthropic-version', () => {
        const headers = buildAuthHeaders('anthropic-messages', 'sk-ant-1');
        expect(headers['x-api-key']).toBe('sk-ant-1');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        expect(headers.Authorization).toBeUndefined();
    });

    it('OpenAI 系密钥走 Bearer', () => {
        expect(buildAuthHeaders('openai-chat', 'sk-1').Authorization).toBe('Bearer sk-1');
        expect(buildAuthHeaders('openai-responses', 'sk-1').Authorization).toBe('Bearer sk-1');
    });

    it('空密钥不下发鉴权头（本地端点）', () => {
        expect(buildAuthHeaders('openai-chat', '').Authorization).toBeUndefined();
        expect(buildAuthHeaders('anthropic-messages', '').Authorization).toBeUndefined();
        expect(buildAuthHeaders('anthropic-messages', '')['x-api-key']).toBeUndefined();
    });
});

describe('API 格式：非流式响应解析', () => {
    it('Chat Completions 取 choices[0].message.content', () => {
        const parsed = parseChatResponse('openai-chat', {
            choices: [{ message: { content: '正文' }, finish_reason: 'stop' }],
        });
        expect(parsed.content).toBe('正文');
        expect(parsed.finishReason).toBe('stop');
    });

    it('Chat Completions 识别 length 截断', () => {
        const parsed = parseChatResponse('openai-chat', {
            choices: [{ message: { content: '半截' }, finish_reason: 'length' }],
        });
        expect(parsed.finishReason).toBe('length');
    });

    it('Anthropic 只取 type=text 的内容块', () => {
        const parsed = parseChatResponse('anthropic-messages', {
            content: [
                { type: 'thinking', text: '思考中' },
                { type: 'text', text: '正文A' },
                { type: 'text', text: '正文B' },
            ],
            stop_reason: 'end_turn',
        });
        expect(parsed.content).toBe('正文A正文B');
        expect(parsed.finishReason).toBe('stop');
    });

    it('Anthropic stop_reason=max_tokens 归一为 length', () => {
        const parsed = parseChatResponse('anthropic-messages', {
            content: [{ type: 'text', text: '半截' }],
            stop_reason: 'max_tokens',
        });
        expect(parsed.finishReason).toBe('length');
    });

    it('Responses 优先取 output_text', () => {
        const parsed = parseChatResponse('openai-responses', {
            status: 'completed',
            output_text: '整段正文',
            output: [{ content: [{ type: 'output_text', text: '整段正文' }] }],
        });
        expect(parsed.content).toBe('整段正文');
        expect(parsed.finishReason).toBe('stop');
    });

    it('Responses 缺 output_text 时拼接 output 里的多段文本', () => {
        const parsed = parseChatResponse('openai-responses', {
            status: 'completed',
            output: [
                { content: [{ type: 'output_text', text: '第一段' }] },
                { content: [{ type: 'output_text', text: '第二段' }] },
            ],
        });
        expect(parsed.content).toBe('第一段第二段');
    });

    it('Responses incomplete + max_output_tokens 判为 length', () => {
        const parsed = parseChatResponse('openai-responses', {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [{ content: [{ type: 'output_text', text: '半截' }] }],
        });
        expect(parsed.finishReason).toBe('length');
    });

    it('畸形响应返回空正文而不是抛错', () => {
        expect(parseChatResponse('openai-chat', null).content).toBe('');
        expect(parseChatResponse('anthropic-messages', {}).content).toBe('');
        expect(parseChatResponse('openai-responses', {}).content).toBe('');
    });
});

describe('API 格式：SSE 帧解析', () => {
    it('Chat Completions 取 delta.content', () => {
        const update = parseSseFrame('openai-chat', { choices: [{ delta: { content: '你' } }] });
        expect(update?.delta).toBe('你');
        expect(update?.done).toBeUndefined();
    });

    it('Chat Completions 保留 reasoning_content 但不并入正文', () => {
        const update = parseSseFrame('openai-chat', {
            choices: [{ delta: { reasoning_content: '想…' } }],
        });
        expect(update?.delta).toBeUndefined();
        expect(update?.reasoning).toBe('想…');
    });

    it('Chat Completions finish_reason=length 结束并标记截断', () => {
        const update = parseSseFrame('openai-chat', { choices: [{ finish_reason: 'length' }] });
        expect(update?.done).toBe(true);
        expect(update?.finishReason).toBe('length');
    });

    it('Anthropic 取 content_block_delta 的 text_delta', () => {
        const update = parseSseFrame('anthropic-messages', {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '好' },
        });
        expect(update?.delta).toBe('好');
    });

    it('Anthropic message_stop 结束流', () => {
        const update = parseSseFrame('anthropic-messages', { type: 'message_stop' });
        expect(update?.done).toBe(true);
    });

    it('Anthropic ping 被忽略', () => {
        expect(parseSseFrame('anthropic-messages', { type: 'ping' })).toBeNull();
    });

    it('Responses 取 response.output_text.delta', () => {
        const update = parseSseFrame('openai-responses', {
            type: 'response.output_text.delta',
            delta: '句子',
        });
        expect(update?.delta).toBe('句子');
    });

    it('Responses incomplete 事件按原因判定截断', () => {
        const update = parseSseFrame('openai-responses', {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
        });
        expect(update?.finishReason).toBe('length');
    });

    it('只有 Chat Completions 使用 [DONE] 哨兵', () => {
        expect(usesDoneSentinel('openai-chat')).toBe(true);
        expect(usesDoneSentinel('anthropic-messages')).toBe(false);
        expect(usesDoneSentinel('openai-responses')).toBe(false);
    });
});

describe('responses 协议失败事件映射（DSH-20261113-20）', () => {
    it('error 事件 → 带协议错误消息的结束帧（不再是正常 stop）', () => {
        const update = parseSseFrame('openai-responses', { type: 'error', message: 'rate limited' });
        expect(update?.done).toBe(true);
        expect(update?.error).toBe('rate limited');
    });

    it('response.failed 事件 → 提取 response.error.message', () => {
        const update = parseSseFrame('openai-responses', {
            type: 'response.failed',
            response: { error: { code: 'content_policy', message: 'content policy violation' } },
        });
        expect(update?.error).toBe('content policy violation');
        expect(update?.done).toBe(true);
    });

    it('无结构化消息 → 回落到事件类型名（不返回空串）', () => {
        expect(parseSseFrame('openai-responses', { type: 'error' })?.error).toContain('error');
        expect(parseSseFrame('openai-responses', { type: 'response.failed' })?.error).toContain('response.failed');
    });

    it('正常事件不受影响（response.completed 仍是 stop）', () => {
        expect(parseSseFrame('openai-responses', { type: 'response.completed' })).toEqual({ done: true, finishReason: 'stop' });
    });
});
