/**
 * co-writer-embedding-provider.test.ts — 协同写作的 embedding 必须跟随「向量提供商」设置
 *
 * 此前协同指纹检索与知识库检索都硬编码 Ollama（`new OllamaEmbeddingClient(embeddingEndpoint, embeddingModel)`），
 * 而拆解/指纹提取走 `EmbeddingProviderFactory`（尊重 vectorProviderType）。
 * 用户选择 OpenAI/豆包/通义后，写入与查询来自不同模型：维度不一致时检索抛错，
 * Rev 106/107 之后改为跳过，表现为知识/指纹注入静默消失。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine } from '../../../engine/co-writer-engine';

function makeEngine(settings: Record<string, unknown>) {
    const aiEngine = {
        getPlugin: () => ({ settings }),
        callAI: vi.fn(),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine({} as any, aiEngine as any, contextManager as any) as any;
    return engine;
}

function providerOf(settings: Record<string, unknown>) {
    return makeEngine(settings)['createEmbeddingProvider']();
}

describe('CoWriterEngine — embedding 跟随向量提供商设置', () => {
    it('选择通义时使用 qwen provider 与配置的模型', () => {
        const provider = providerOf({
            vectorProviderType: 'qwen',
            vectorQwenApiKey: 'test-key',
            vectorQwenModel: 'text-embedding-v4',
            // 本地 Ollama 的配置同时存在，也不能被误用
            embeddingEndpoint: 'http://localhost:11434',
            embeddingModel: 'bge-m3',
        });

        expect(provider.getProviderInfo().type).toBe('qwen');
        expect(provider.getModelName()).toBe('text-embedding-v4');
    });

    it('选择豆包时使用 doubao provider', () => {
        const provider = providerOf({
            vectorProviderType: 'doubao',
            vectorDoubaoApiKey: 'test-key',
            vectorDoubaoModel: 'doubao-embedding-large-text-240915',
            embeddingModel: 'bge-m3',
        });

        expect(provider.getProviderInfo().type).toBe('doubao');
        expect(provider.getModelName()).toBe('doubao-embedding-large-text-240915');
    });

    it('选择 OpenAI 时使用 openai provider', () => {
        const provider = providerOf({
            vectorProviderType: 'openai',
            vectorOpenaiApiKey: 'test-key',
            vectorOpenaiModel: 'text-embedding-3-large',
        });

        expect(provider.getProviderInfo().type).toBe('openai');
        expect(provider.getModelName()).toBe('text-embedding-3-large');
    });

    it('保持 Ollama 时未配置 vectorOllamaModel 回退 embeddingModel', () => {
        const provider = providerOf({
            vectorProviderType: 'ollama',
            vectorOllamaModel: '',
            embeddingEndpoint: 'http://localhost:11434',
            embeddingModel: 'nomic-embed-text',
        });

        expect(provider.getProviderInfo().type).toBe('ollama');
        expect(provider.getModelName()).toBe('nomic-embed-text');
    });

    it('没有设置时保持默认 Ollama + bge-m3', () => {
        const provider = providerOf({});

        expect(provider.getProviderInfo().type).toBe('ollama');
        expect(provider.getModelName()).toBe('bge-m3');
    });
});
