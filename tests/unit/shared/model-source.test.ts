import { describe, it, expect } from 'vitest';
import { resolveProviderSourceType } from '../../../shared/model-source';
import type { ModelSourceLike } from '../../../shared/model-source';

describe('resolveProviderSourceType — 模型源类型解析', () => {
    it('显式 sourceType=local 优先返回 local', () => {
        const p: ModelSourceLike = { id: 'custom-1', endpoint: 'https://api.example.com/v1', sourceType: 'local' };
        expect(resolveProviderSourceType(p)).toBe('local');
    });

    it('显式 sourceType=cloud 优先返回 cloud', () => {
        const p: ModelSourceLike = { id: 'custom-1', endpoint: 'http://localhost:11434/v1', sourceType: 'cloud' };
        expect(resolveProviderSourceType(p)).toBe('cloud');
    });

    it('id=ollama 且无 sourceType 时兜底为 local', () => {
        expect(resolveProviderSourceType({ id: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions' })).toBe('local');
    });

    it('endpoint 含 localhost 兜底为 local（LM Studio/vLLM）', () => {
        expect(resolveProviderSourceType({ id: 'custom-1', endpoint: 'http://localhost:1234/v1/chat/completions' })).toBe('local');
    });

    it('endpoint 含 127.0.0.1 兜底为 local', () => {
        expect(resolveProviderSourceType({ id: 'custom-2', endpoint: 'http://127.0.0.1:8080/v1' })).toBe('local');
    });

    it('私有网段/LAN 地址兜底为 local', () => {
        expect(resolveProviderSourceType({ id: 'custom-3', endpoint: 'http://192.168.1.8:11434/v1' })).toBe('local');
        expect(resolveProviderSourceType({ id: 'custom-4', endpoint: 'http://10.0.0.5:8000/v1' })).toBe('local');
        expect(resolveProviderSourceType({ id: 'custom-5', endpoint: 'http://172.20.1.2:1234/v1' })).toBe('local');
        expect(resolveProviderSourceType({ id: 'custom-6', endpoint: 'http://ollama.local:11434/v1' })).toBe('local');
    });

    it('云端 endpoint 且无 sourceType 兜底为 cloud', () => {
        expect(resolveProviderSourceType({ id: 'deepseek', endpoint: 'https://api.deepseek.com/v1/chat/completions' })).toBe('cloud');
        expect(resolveProviderSourceType({ id: 'volc', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' })).toBe('cloud');
    });
});
