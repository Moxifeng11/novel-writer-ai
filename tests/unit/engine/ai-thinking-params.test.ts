import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { AIApiClient } from '../../../engine/ai-api-client';

function makeClient() {
    return new AIApiClient({
        settings: {
            apiKey: 'k',
            apiEndpoint: 'https://api.openai.com/v1/chat/completions',
            defaultModel: 'gpt-4o',
            availableModels: ['gpt-4o'],
            maxContext: 128000,
            maxOutput: 8192,
        },
    } as never);
}

function build(
    client: AIApiClient,
    opts: {
        ollama?: boolean;
        model: string;
        endpoint: string;
        mode?: 'off' | 'auto' | 'on';
        budget?: number;
    },
) {
    return (client as unknown as {
        buildRequestBody: (...args: unknown[]) => Record<string, unknown>;
    }).buildRequestBody(
        opts.ollama === true,
        opts.model,
        'user',
        'system',
        0.7,
        4096,
        false,
        opts.ollama ? 32768 : undefined,
        opts.endpoint,
        opts.mode,
        opts.budget,
    );
}

describe('AIApiClient — 思考参数', () => {
    it('Ollama 原生端点显式开启时下发 think=true', () => {
        const body = build(makeClient(), {
            ollama: true,
            model: 'qwen2.5:7b',
            endpoint: 'http://localhost:11434/api/generate',
            mode: 'on',
        });
        expect(body['think']).toBe(true);
        expect((body['options'] as Record<string, unknown>)['num_ctx']).toBe(32768);
    });

    it('Ollama 显式关闭时下发 think=false', () => {
        const body = build(makeClient(), {
            ollama: true,
            model: 'qwen2.5:7b',
            endpoint: 'http://localhost:11434/api/generate',
            mode: 'off',
        });
        expect(body['think']).toBe(false);
    });

    it('auto 模式不下发思考字段，交给供应商默认', () => {
        const body = build(makeClient(), {
            model: 'gpt-4o',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            mode: 'auto',
        });
        expect(body['reasoning_effort']).toBeUndefined();
        expect(body['thinking']).toBeUndefined();
    });

    it('OpenAI o 系列开启思考时下发 reasoning_effort', () => {
        const body = build(makeClient(), {
            model: 'o3',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            mode: 'on',
            budget: 4096,
        });
        expect(body['reasoning_effort']).toBe('medium');
    });

    it('火山/DeepSeek 开启思考时下发 thinking 对象与预算', () => {
        const body = build(makeClient(), {
            model: 'deepseek-v3-2-251201',
            endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
            mode: 'on',
            budget: 2048,
        });
        expect(body['thinking']).toEqual({ type: 'enabled', budget_tokens: 2048 });
    });

    it('未知供应商开启思考时不发送未验证字段', () => {
        const body = build(makeClient(), {
            model: 'proxy-model',
            endpoint: 'https://proxy.example.com/v1/chat/completions',
            mode: 'on',
        });
        expect(body['thinking']).toBeUndefined();
        expect(body['reasoning_effort']).toBeUndefined();
    });
});
