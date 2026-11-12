/**
 * ai-api-stream-truncation.test.ts — 流式截断/重试去重回归（DSH-20261113-20）
 *
 * 对抗性审查发现的三个缺陷（high）：
 *  ① 流被对端干净关闭（无 [DONE]/finish_reason/done:true）时被当成「成功完整响应」，
 *     半截正文被 BodyWriter 落盘；② 原生流失败后内部重试/降级从零重发全文，消费者
 *     累加后出现重复正文；③ responses 协议 error/failed 事件被映射成正常结束。
 *
 * 本文件用最小 AIStreamHost 桩 + 桩 fetch 驱动真实 callAIStream / callAIAsyncIterator。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callAIStream, callAIAsyncIterator, type AIStreamHost } from '../../../engine/ai-api-stream';
import { parseSseFrame } from '../../../shared/api-format';

/** 构造 SSE 字节流响应（桌面端 openStreamResponse 走全局 fetch） */
function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
        },
    });
    return { ok: true, status: 200, body: stream } as unknown as Response;
}

/** 中途出错的数据流：先产出再抛错（模拟 socket 中断） */
function brokenAfterFirstChunk(frames: string[]): Response {
    const encoder = new TextEncoder();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const frame of frames) {
                controller.enqueue(encoder.encode(frame));
                sent++;
            }
        },
        pull(controller) {
            // 全部入队后模拟 socket 中断
            if (sent >= frames.length) controller.error(new Error('ECONNRESET'));
        },
    });
    return { ok: true, status: 200, body: stream } as unknown as Response;
}

/** 最小 AIStreamHost：只实现 callAIStream/callAIAsyncIterator 触达的能力 */
function makeHost(options: {
    format?: 'openai-chat' | 'openai-responses';
    shouldFallback?: boolean;
    callAIResult?: { content: string; error?: string };
} = {}): AIStreamHost {
    const noop = async () => {};
    return {
        plugin: {
            settings: {
                defaultModel: 'test-model',
                apiEndpoint: 'https://test.example/v1',
                apiKey: 'test-key',
                maxOutput: 4096,
                availableModels: [],
            },
        },
        notifier: { showNotice: vi.fn() },
        acquireStreamSlot: vi.fn(async () => () => {}),
        // 与真实宿主同语义：返回值首项是主模型本身
        buildFallbackModels: vi.fn((model: string) => [model]),
        buildRequestBody: vi.fn(() => ({})),
        callAI: vi.fn(async () => options.callAIResult ?? { content: '一次性完整正文' }),
        getContinuityGuard: vi.fn(() => ''),
        handleRateLimit: vi.fn(async () => 'break' as const),
        isKeylessLocalEndpoint: vi.fn(() => false),
        isLocalEndpoint: vi.fn(() => false),
        isUnreachableError: vi.fn(() => false),
        resolveApiFormat: vi.fn(() => options.format ?? 'openai-chat'),
        resolveApiKey: vi.fn(async () => ({ key: 'test-key' })),
        resolveMaxContext: vi.fn(() => 128_000),
        resolveMaxOutput: vi.fn(() => 128_000),
        resolveMaxRetries: vi.fn(() => 3),
        resolveRequestEndpoint: vi.fn((endpoint: string) => endpoint),
        resolveTimeout: vi.fn(() => 5_000),
        shouldFallback: vi.fn(() => options.shouldFallback ?? false),
    } as unknown as AIStreamHost;
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([])));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('callAIStream：截断不得当成功（缺陷①）', () => {
    it('流干净结束但没有 [DONE]/finish_reason：返回 error（截断标记），不返回成功响应', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
            'data: {"choices":[{"delta":{"content":"晨星在雾里"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"升起"}}]}\n\n',
            // 对端直接关流：无 finish_reason、无 [DONE]
        ])));
        const onChunk = vi.fn();
        const result = await callAIStream(makeHost(), 'sys', 'user', 'test-model', 0.7, 4096, onChunk);
        expect(result.error).toContain('流式连接中断');
        expect(result.error).toContain('未收到正常结束标记');
        // 半截正文仍保留在 content 里供上游展示，但没有「成功」语义
        expect(result.content).toBe('晨星在雾里升起');
    });

    it('截断时 onChunk 仍以 done=true 收尾（UI 显示半截内容 + 上游走报错路径）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
            'data: {"choices":[{"delta":{"content":"半截"}}]}\n\n',
        ])));
        const onChunk = vi.fn();
        await callAIStream(makeHost(), 'sys', 'user', 'test-model', 0.7, 4096, onChunk);
        expect(onChunk).toHaveBeenLastCalledWith('半截', true);
    });

    it('正常路径不误伤：finish_reason + [DONE] → 成功返回（回归锁）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
            'data: {"choices":[{"delta":{"content":"晨星"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"升起"},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
        ])));
        const result = await callAIStream(makeHost(), 'sys', 'user', 'test-model', 0.7, 4096);
        expect(result.error).toBeUndefined();
        expect(result.content).toBe('晨星升起');
        expect(result.finishReason).toBe('stop');
    });
});


describe('回归锁（源码契约）：generateChapterStream 不得兜 stop（缺陷④）', () => {
    it('ai-engine.ts 的 finalFinishReason 赋值不得含 || ' + String.fromCharCode(39) + 'stop' + String.fromCharCode(39) + ' 兜底', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(
            'engine/ai-engine.ts',
            'utf8',
        );
        const lines = source.split(String.fromCharCode(10)).filter(l => l.includes('finalFinishReason ='));
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.includes('|| ')).toBe(false);
        }
    });
});

describe('responses 协议 error/failed 事件（缺陷③）', () => {
    it('parseSseFrame：error 事件 → 带协议错误的结束帧（不再是正常 stop）', () => {
        const update = parseSseFrame('openai-responses', { type: 'error', message: 'rate limited' });
        expect(update?.error).toBe('rate limited');
        expect(update?.done).toBe(true);
    });

    it('parseSseFrame：response.failed 事件 → 提取 response.error.message', () => {
        const update = parseSseFrame('openai-responses', {
            type: 'response.failed',
            response: { error: { message: 'content policy violation' } },
        });
        expect(update?.error).toBe('content policy violation');
    });

    it('parseSseFrame：无结构化消息 → 回落到事件类型（不返回空串）', () => {
        const update = parseSseFrame('openai-responses', { type: 'error' });
        expect(update?.error).toContain('error');
    });

    it('流内 error 事件：attempt 级抛错走回退（shouldFallback=true → 立即收场），错误含协议消息', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
            'data: {"type":"error","message":"rate limited"}\n\n',
        ])));
        const host = makeHost({ format: 'openai-responses', shouldFallback: true });
        const result = await callAIStream(host, 'sys', 'user', 'test-model', 0.7, 4096);
        expect(result.error).toContain('流式响应错误');
        expect(result.error).toContain('rate limited');
        expect(host.shouldFallback).toHaveBeenCalled();
    });
});

describe('callAIAsyncIterator：重试/降级不得重复正文（缺陷②）', () => {
    it('原生流部分产出后截断：如实报错收场，不得降级到模拟流重发全文（消费者无重复）', async () => {
        const callAI = vi.fn(async () => ({ content: '模拟流全文' }));
        const host = makeHost();
        (host as unknown as { callAI: typeof callAI }).callAI = callAI;
        vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
            'data: {"choices":[{"delta":{"content":"前500字"}}]}\n\n',
            // 干净关流，无终止符 → 截断
        ])));

        const chunks: string[] = [];
        // 手动迭代一次（生成器 return 值只存在于 done 分支；重复迭代会创建新实例）
        const iterator = callAIAsyncIterator(host, 'sys', 'user', 'test-model', 0.7, 4096);
        let step = await iterator.next();
        while (!step.done) {
            chunks.push(step.value);
            step = await iterator.next();
        }
        const finalResult = step.value;

        expect(chunks).toEqual(['前500字']); // 只有原生阶段的分片，没有模拟流重发
        expect(finalResult?.error).toContain('流式连接中断');
        expect(callAI).not.toHaveBeenCalled(); // 模拟流/完整响应降级未发生
    });

    it('零产出即失败：降级到完整响应仍保留（不误伤既有降级能力）', async () => {
        const callAI = vi.fn(async () => ({ content: '一次性完整正文' }));
        const host = makeHost();
        (host as unknown as { callAI: typeof callAI }).callAI = callAI;
        let call = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            call++;
            // 第一次：立即关流的空流（无分片产出、无终止符）→ 原生阶段失败
            return sseResponse([]);
        }));

        const chunks: string[] = [];
        const iterator = callAIAsyncIterator(host, 'sys', 'user', 'test-model', 0.7, 4096);
        let step = await iterator.next();
        while (!step.done) {
            chunks.push(step.value);
            step = await iterator.next();
        }
        // 原生零产出 → 降级链走到 simulated → host.callAI 一次性全文
        expect(callAI).toHaveBeenCalled();
        expect(chunks.join('')).toBe('一次性完整正文');
        expect(chunks.filter(c => c.includes('一次性'))).toHaveLength(1); // 无重复
    });
});
