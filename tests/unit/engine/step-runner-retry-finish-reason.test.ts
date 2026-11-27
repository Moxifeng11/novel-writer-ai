/**
 * 续写链路不得把缺失的 finishReason 兜成 'stop'（2026-11-28 复核修复）
 *
 * 背景：DSH-20261113-20 的修复原本只落在 `AIEngine.generateChapterStream` 上，
 * 而那条路径**没有任何生产调用方**（死代码）。真正在跑的续写链路
 * `callAIStreamWithRetry`（`engine/step-runner-retry.ts`）一直保留着
 * `finishReason || 'stop'`——流在异常/截断处结束、上游没给 finishReason 时，
 * 半截正文会被当成完整章节落盘，且 `truncated` 判定为 false，用户看不出问题。
 *
 * 本测试锁死：上游返回 undefined 时，返回值也必须是 undefined。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { callAIStreamWithRetry } from '../../../engine/step-runner-retry';
import type { StepRunnerRetryHost } from '../../../engine/step-runner-retry';

function makeHost(finishReason: 'stop' | 'length' | 'error' | 'aborted' | undefined): StepRunnerRetryHost {
    return {
        aiEngine: {
            callAIStream: vi.fn(async () => ({
                content: '他把手按在剑柄上，雨顺着檐口连成一线。'.repeat(4),
                finishReason,
                usage: { prompt: 10, completion: 20, total: 30 },
            })),
            callAI: vi.fn(async () => ({ content: '', finishReason })),
        } as unknown as StepRunnerRetryHost['aiEngine'],
        showProgress: () => { /* noop */ },
        showNotice: () => { /* noop */ },
    };
}

describe('callAIStreamWithRetry finishReason 语义', () => {
    it('上游缺失 finishReason 时不得兜成 stop（半截正文会被当完整章节落盘）', async () => {
        const result = await callAIStreamWithRetry(
            makeHost(undefined),
            'sys',
            'user',
            'model-x',
            0.8,
            4096,
            '正文',
            () => { /* noop */ },
        );
        expect(result.finishReason).toBeUndefined();
    });

    it('上游明确给 length 时原样透传（截断续写依据）', async () => {
        const result = await callAIStreamWithRetry(
            makeHost('length'),
            'sys',
            'user',
            'model-x',
            0.8,
            4096,
            '正文',
            () => { /* noop */ },
        );
        expect(result.finishReason).toBe('length');
    });

    it('上游给 stop 时原样透传', async () => {
        const result = await callAIStreamWithRetry(
            makeHost('stop'),
            'sys',
            'user',
            'model-x',
            0.8,
            4096,
            '正文',
            () => { /* noop */ },
        );
        expect(result.finishReason).toBe('stop');
    });
});
