import { describe, expect, it } from 'vitest';
import { detectProviderFromEndpoint } from '../../../shared/provider-detection';

describe('provider-detection — URL 供应商识别', () => {
    it('识别本机 Ollama 默认端口', () => {
        const r = detectProviderFromEndpoint('http://localhost:11434/v1/chat/completions');
        expect(r.valid).toBe(true);
        expect(r.providerId).toBe('ollama');
        expect(r.sourceType).toBe('local');
        expect(r.apiStyle).toBe('ollama');
        expect(r.confidence).toBe('high');
    });

    it('识别 Ollama 原生 /api/generate', () => {
        const r = detectProviderFromEndpoint('http://127.0.0.1:11434/api/generate');
        expect(r.providerId).toBe('ollama');
        expect(r.apiStyle).toBe('ollama');
        expect(r.normalizedEndpoint).toBe('http://127.0.0.1:11434/api/generate');
    });

    it('识别局域网 Ollama', () => {
        const r = detectProviderFromEndpoint('http://192.168.1.8:11434');
        expect(r.providerId).toBe('ollama');
        expect(r.sourceType).toBe('local');
        expect(r.normalizedEndpoint).toBe('http://192.168.1.8:11434/v1/chat/completions');
    });

    it('识别本地 OpenAI 兼容服务并补全 /v1/chat/completions', () => {
        const r = detectProviderFromEndpoint('http://localhost:1234/v1');
        expect(r.valid).toBe(true);
        expect(r.sourceType).toBe('local');
        expect(r.apiStyle).toBe('openai');
        expect(r.normalizedEndpoint).toBe('http://localhost:1234/v1/chat/completions');
        expect(r.providerId).toBeNull();
    });

    it.each([
        ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'volc'],
        ['https://api.deepseek.com/v1/chat/completions', 'deepseek'],
        ['https://token.sensenova.cn/v1/chat/completions', 'sensenova'],
        ['https://api.catcat.top/v1/chat/completions', 'catcat'],
        ['https://api.openai.com/v1/chat/completions', 'openai'],
        ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen'],
        ['https://openrouter.ai/api/v1/chat/completions', 'openrouter'],
        ['https://api.siliconflow.cn/v1/chat/completions', 'siliconflow'],
        ['https://api.moonshot.cn/v1/chat/completions', 'moonshot'],
        ['https://api.groq.com/openai/v1/chat/completions', 'groq'],
        ['https://api.together.xyz/v1/chat/completions', 'together'],
        ['https://api.mistral.ai/v1/chat/completions', 'mistral'],
    ])('识别已知云端供应商 %s -> %s', (url, id) => {
        const r = detectProviderFromEndpoint(url);
        expect(r.valid).toBe(true);
        expect(r.providerId).toBe(id);
        expect(r.sourceType).toBe('cloud');
        expect(r.confidence).toBe('high');
    });

    it('已知供应商只填 base URL 时补全 chat 端点', () => {
        const r = detectProviderFromEndpoint('https://api.deepseek.com/v1');
        expect(r.normalizedEndpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    });

    it('未知公网主机按 OpenAI 兼容处理并标低置信度', () => {
        const r = detectProviderFromEndpoint('https://proxy.example.com/v1');
        expect(r.valid).toBe(true);
        expect(r.providerId).toBeNull();
        expect(r.apiStyle).toBe('openai');
        expect(r.confidence).toBe('low');
        expect(r.warning).toContain('OpenAI 兼容');
    });

    it('未知主机的 Ollama 原生路径标为 ollama 并提示确认', () => {
        const r = detectProviderFromEndpoint('https://llm.example.com/api/generate');
        expect(r.apiStyle).toBe('ollama');
        expect(r.sourceType).toBe('cloud');
        expect(r.warning).toContain('Ollama');
    });

    it('无协议的私有地址自动补 http', () => {
        const r = detectProviderFromEndpoint('192.168.1.8:11434');
        expect(r.valid).toBe(true);
        expect(r.normalizedEndpoint.startsWith('http://')).toBe(true);
        expect(r.providerId).toBe('ollama');
    });

    it('无协议的云端地址自动补 https', () => {
        const r = detectProviderFromEndpoint('api.deepseek.com/v1');
        expect(r.normalizedEndpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    });

    it('空输入返回 invalid', () => {
        const r = detectProviderFromEndpoint('   ');
        expect(r.valid).toBe(false);
        expect(r.warning).toContain('为空');
    });

    it('畸形 URL 返回 invalid，不抛异常', () => {
        const r = detectProviderFromEndpoint('http://');
        expect(r.valid).toBe(false);
        expect(r.warning).toContain('URL');
    });

    it('normalizedEndpoint 不保留 query/hash，避免密钥进日志', () => {
        const r = detectProviderFromEndpoint('https://api.deepseek.com/v1?key=secret#frag');
        expect(r.normalizedEndpoint).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(r.normalizedEndpoint).not.toContain('secret');
    });
});
