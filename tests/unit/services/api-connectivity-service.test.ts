import { describe, it, expect } from 'vitest';
import {
    normalizeChatEndpoint,
    testProviderConnectivity,
    type RequestUrlFn,
} from '../../../services/api-connectivity-service';

function response(status: number, text: string, json?: unknown) {
    return {
        status,
        text,
        get json() {
            if (json !== undefined) return json;
            return JSON.parse(text);
        },
    };
}

const base = {
    providerName: '测试供应商',
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test',
    model: 'test-model',
    sourceType: 'cloud' as const,
};

describe('API 连通性测试', () => {
    it('端点补全与常见写法', () => {
        expect(normalizeChatEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
        expect(normalizeChatEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
        expect(normalizeChatEndpoint('https://api.example.com/v1/chat/completions/')).toBe('https://api.example.com/v1/chat/completions');
        expect(normalizeChatEndpoint('http://localhost:11434/api/chat')).toBe('http://localhost:11434/api/chat');
    });

    it('200 + choices 判定为可用', async () => {
        const request: RequestUrlFn = async () => response(200, '{"choices":[{"message":{"content":"OK"}}]}');
        const result = await testProviderConnectivity(base, request);
        expect(result.level).toBe('ok');
        expect(result.status).toBe('ok');
        expect(result.httpStatus).toBe(200);
        expect(result.message).toContain('连通正常');
    });

    it('401 判定为鉴权失败', async () => {
        const request: RequestUrlFn = async () => response(401, '{"error":{"message":"invalid key"}}');
        const result = await testProviderConnectivity(base, request);
        expect(result.level).toBe('error');
        expect(result.status).toBe('auth_failed');
        expect(result.message).toContain('invalid key');
    });

    it('429 判定为限流告警', async () => {
        const request: RequestUrlFn = async () => response(429, 'rate limited');
        const result = await testProviderConnectivity(base, request);
        expect(result.level).toBe('warn');
        expect(result.status).toBe('rate_limited');
    });

    it('HTTP 200 + error body 不能当成功', async () => {
        const request: RequestUrlFn = async () => response(200, '{"error":{"message":"model not found"}}');
        const result = await testProviderConnectivity(base, request);
        expect(result.level).toBe('error');
        expect(result.message).toContain('model not found');
    });

    it('空响应给出可诊断告警', async () => {
        const request: RequestUrlFn = async () => response(200, '');
        const result = await testProviderConnectivity(base, request);
        expect(result.level).toBe('warn');
        expect(result.status).toBe('empty_response');
    });

    it('缺少密钥/模型/非法端点直接失败，不发请求', async () => {
        let called = false;
        const request: RequestUrlFn = async () => { called = true; return response(200, '{}'); };
        expect((await testProviderConnectivity({ ...base, apiKey: '' }, request)).status).toBe('auth_failed');
        expect((await testProviderConnectivity({ ...base, model: '' }, request)).status).toBe('invalid_config');
        expect((await testProviderConnectivity({ ...base, endpoint: 'not-a-url' }, request)).status).toBe('invalid_config');
        expect(called).toBe(false);
    });

    it('本地端点允许无密钥', async () => {
        const request: RequestUrlFn = async () => response(200, '{"message":{"content":"OK"}}');
        const result = await testProviderConnectivity({
            providerName: 'Ollama',
            endpoint: 'http://localhost:11434/api/chat',
            apiKey: '',
            model: 'qwen2.5:7b',
            sourceType: 'local',
        }, request);
        expect(result.level).toBe('ok');
    });
});
