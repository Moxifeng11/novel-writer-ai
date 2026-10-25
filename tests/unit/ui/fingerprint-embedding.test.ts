/**
 * fingerprint-embedding.test.ts — UI 入口的指纹 embedding 必须与向量存储成对构造
 *
 * 此前 refill / mini-settings / novel-analysis / knowledge-detail 各自 `new OllamaEmbeddingClient(...)`，
 * 用户选择云端向量后，写入侧仍走 Ollama：写入模型与检索模型不一致，指纹向量会被模型治理跳过。
 */

import { describe, it, expect } from 'vitest';
import { createFingerprintEmbedding } from '../../../ui/fingerprint-embedding';

const app = {} as any;

describe('createFingerprintEmbedding — 统一从设置构造 embedding', () => {
    it('选择通义时使用 qwen provider 与配置的模型', () => {
        const { provider } = createFingerprintEmbedding(app, 'global', {
            vectorProviderType: 'qwen',
            vectorQwenApiKey: 'test-key',
            vectorQwenModel: 'text-embedding-v4',
            // 本地 Ollama 配置同时存在，也不能被误用
            embeddingEndpoint: 'http://localhost:11434',
            embeddingModel: 'bge-m3',
        });

        expect(provider.getProviderInfo().type).toBe('qwen');
        expect(provider.getModelName()).toBe('text-embedding-v4');
    });

    it('选择豆包时使用 doubao provider', () => {
        const { provider } = createFingerprintEmbedding(app, 'project', {
            vectorProviderType: 'doubao',
            vectorDoubaoApiKey: 'test-key',
            vectorDoubaoModel: 'doubao-embedding-large-text-240915',
        }, '测试书');

        expect(provider.getProviderInfo().type).toBe('doubao');
        expect(provider.getModelName()).toBe('doubao-embedding-large-text-240915');
    });

    it('没有设置时保持默认 Ollama + bge-m3', () => {
        const { provider } = createFingerprintEmbedding(app, 'global', undefined);

        expect(provider.getProviderInfo().type).toBe('ollama');
        expect(provider.getModelName()).toBe('bge-m3');
    });

    it('返回的向量存储复用同一个 provider 实例', () => {
        const { provider, vectorStore } = createFingerprintEmbedding(app, 'global', {
            vectorProviderType: 'openai',
            vectorOpenaiApiKey: 'test-key',
            vectorOpenaiModel: 'text-embedding-3-large',
        });

        expect((vectorStore as any).embeddingProvider).toBe(provider);
    });

    it('global scope 下不依赖 project 参数即可定位向量目录', () => {
        const { vectorStore } = createFingerprintEmbedding(app, 'global', {}, '不该被使用');

        expect((vectorStore as any).scope).toBe('global');
        expect((vectorStore as any).getVectorsDir()).not.toContain('不该被使用');
    });
});
