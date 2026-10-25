import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    clearLocalModelProbeCache,
    ensureLocalModelCapability,
    normalizeOllamaBaseUrl,
    parseOllamaShowContextLength,
    probeOllamaModelCapability,
} from '../../../services/local-model-probe';
import {
    clearDetectedModelCapabilities,
    findModelCapability,
} from '../../../shared/model-capabilities';

const ENDPOINT = 'http://localhost:11434/v1/chat/completions';
const MODEL = 'my-local-llm:3b';

function showResponse(contextLength: number, arch = 'qwen2'): unknown {
    return {
        model_info: {
            'general.architecture': arch,
            [`${arch}.context_length`]: contextLength,
        },
    };
}

describe('normalizeOllamaBaseUrl', () => {
    it('收敛到 origin', () => {
        expect(normalizeOllamaBaseUrl('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434');
        expect(normalizeOllamaBaseUrl('http://127.0.0.1:11434/api/generate')).toBe('http://127.0.0.1:11434');
    });

    it('非法端点返回 null', () => {
        expect(normalizeOllamaBaseUrl('')).toBeNull();
        expect(normalizeOllamaBaseUrl('not-a-url')).toBeNull();
    });
});

describe('parseOllamaShowContextLength', () => {
    it('优先读 <arch>.context_length', () => {
        expect(parseOllamaShowContextLength(showResponse(16384))).toBe(16384);
    });

    it('回退 general.context_length', () => {
        expect(parseOllamaShowContextLength({ model_info: { 'general.context_length': 8192 } })).toBe(8192);
    });

    it('回退 parameters 里的 num_ctx', () => {
        expect(parseOllamaShowContextLength({ parameters: 'num_ctx 4096\nstop "<|im_end|>"' })).toBe(4096);
    });

    it('无法解析返回 null', () => {
        expect(parseOllamaShowContextLength({})).toBeNull();
        expect(parseOllamaShowContextLength(null)).toBeNull();
    });
});

describe('probeOllamaModelCapability', () => {
    beforeEach(() => {
        clearLocalModelProbeCache();
        clearDetectedModelCapabilities();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('解析真实窗口并注册到能力表', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => showResponse(16384),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const capability = await probeOllamaModelCapability(ENDPOINT, MODEL);
        expect(capability).toEqual({ maxContext: 16384, maxOutput: 4096 });
        expect(findModelCapability(MODEL)).toEqual({ maxContext: 16384, maxOutput: 4096 });

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://localhost:11434/api/show');
        expect(JSON.parse(String(init.body))).toEqual({ model: MODEL });
    });

    it('同端点同模型只探测一次', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => showResponse(32768),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await probeOllamaModelCapability(ENDPOINT, MODEL);
        await probeOllamaModelCapability(ENDPOINT, MODEL);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('探测失败进入冷却，不重复请求', async () => {
        const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        vi.stubGlobal('fetch', fetchMock);

        expect(await probeOllamaModelCapability(ENDPOINT, MODEL)).toBeNull();
        expect(await probeOllamaModelCapability(ENDPOINT, MODEL)).toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(findModelCapability(MODEL, 'local')).toEqual({ maxContext: 8192, maxOutput: 4096 });
    });

    it('窗口过小不注册', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => showResponse(256),
        })));

        expect(await probeOllamaModelCapability(ENDPOINT, MODEL)).toBeNull();
        expect(findModelCapability(MODEL, 'local')).toEqual({ maxContext: 8192, maxOutput: 4096 });
    });

    it('静态表已登记的模型不探测', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await ensureLocalModelCapability(ENDPOINT, 'qwen2.5:7b');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(findModelCapability('qwen2.5:7b')).toEqual({ maxContext: 32768, maxOutput: 8192 });
    });
});
