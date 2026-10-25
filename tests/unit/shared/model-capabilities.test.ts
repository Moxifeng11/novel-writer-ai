import { describe, it, expect } from 'vitest';
import {
    findModelCapability,
    lookupModelCapability,
    LOCAL_FALLBACK_CAPABILITY,
    DEFAULT_CONTEXT_WINDOW,
    DEFAULT_MAX_OUTPUT,
} from '../../../shared/model-capabilities';

describe('findModelCapability — 最长键优先', () => {
    it('deepseek-r1:7b 命中本地小模型，而不是云端 deepseek-r1', () => {
        expect(findModelCapability('deepseek-r1:7b')).toEqual({ maxContext: 32768, maxOutput: 8192 });
    });

    it('deepseek-r1（无本地后缀）仍命中云端能力', () => {
        expect(findModelCapability('deepseek-r1')).toEqual({ maxContext: 131072, maxOutput: 65536 });
    });

    it('qwen2.5:7b 命中本地能力', () => {
        expect(findModelCapability('qwen2.5:7b')).toEqual({ maxContext: 32768, maxOutput: 8192 });
    });

    it('大小写不敏感', () => {
        expect(findModelCapability('DeepSeek-R1:7B')).toEqual({ maxContext: 32768, maxOutput: 8192 });
    });
});

describe('findModelCapability — 未登记模型兜底', () => {
    it('云端未登记模型沿用全局默认', () => {
        expect(findModelCapability('unknown-model-xyz')).toEqual({
            maxContext: DEFAULT_CONTEXT_WINDOW,
            maxOutput: DEFAULT_MAX_OUTPUT,
        });
    });

    it('本地未登记模型使用更保守的兜底，避免单次输出上万 token', () => {
        expect(findModelCapability('unknown-local-model', 'local')).toEqual(LOCAL_FALLBACK_CAPABILITY);
    });

    it('空模型名返回兜底而非抛错', () => {
        expect(findModelCapability('', 'local')).toEqual(LOCAL_FALLBACK_CAPABILITY);
        expect(lookupModelCapability('')).toBeNull();
    });
});
