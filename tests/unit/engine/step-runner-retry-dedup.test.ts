import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StepRunner } from '../../../engine/step-runner';

/** 构造仅覆盖 callAIWithRetry 依赖的最小 StepRunner */
function makeRunner(callAIImpl: () => Promise<any>) {
    const callAI = vi.fn(callAIImpl);
    const aiEngine = { callAI };
    const plugin = {
        aiEngine,
        engineRegistry: { get: () => ({}) },
    } as any;
    const runner = new (StepRunner as any)({} as any, plugin, {}) as any;
    return { runner, callAI };
}

describe('StepRunner.callAIWithRetry — P0-2 重试去叠加（D-1 备用方案）', () => {
    it('TR-5.1: 持续业务 error 时 callAI 恰好调用 2 次（初始 + 1 次业务重试），非 3 次更非 9 次叠加', async () => {
        const { runner, callAI } = makeRunner(async () => ({ content: '', error: 'AI返回为空' }));

        // 重试耗尽后 callAIWithRetry 抛出最后一次错误（现有行为，保持不变）
        await expect(runner.callAIWithRetry('sys', 'user', 'm', 0.7, 1024, '测试步骤'))
            .rejects.toThrow('AI返回为空');

        // 旧实现 MAX_RETRIES=3（3 次调用）；D-1 备用方案保留 1 次业务重试 → 恰好 2 次
        // api-client 内部已负责网络层/429 重试，此处仅为业务 error 保留一层
        expect(callAI).toHaveBeenCalledTimes(2);
    }, 30_000);

    it('首轮成功时仅调用 1 次（行为不变）', async () => {
        const { runner, callAI } = makeRunner(async () => ({ content: 'ok', error: null }));

        const result = await runner.callAIWithRetry('sys', 'user', 'm', 0.7, 1024, '测试步骤');

        expect(result.content).toBe('ok');
        expect(callAI).toHaveBeenCalledTimes(1);
    });

    it('已取消的 signal 不发起调用，直接返回 aborted', async () => {
        const { runner, callAI } = makeRunner(async () => ({ content: '不应调用' }));
        const ctrl = new AbortController();
        ctrl.abort();

        const result = await runner.callAIWithRetry('sys', 'user', 'm', 0.7, 1024, '测试步骤', ctrl.signal);

        expect(result.finishReason).toBe('aborted');
        expect(result.error).toBe('已取消');
        expect(callAI).not.toHaveBeenCalled();
    });

    it('调用中 abort 不重试，直接返回 aborted', async () => {
        const ctrl = new AbortController();
        const { runner, callAI } = makeRunner(async () => {
            ctrl.abort();
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        });

        const result = await runner.callAIWithRetry('sys', 'user', 'm', 0.7, 1024, '测试步骤', ctrl.signal);

        expect(result.finishReason).toBe('aborted');
        expect(result.error).toBe('已取消');
        expect(callAI).toHaveBeenCalledTimes(1);
    });
});

describe('StepRunner.warnIfTruncated — 截断可见性', () => {
    function makeRunnerWithNotice() {
        const showNotice = vi.fn();
        const plugin = { aiEngine: { callAI: vi.fn() }, engineRegistry: { get: () => ({}) } } as any;
        const runner = new (StepRunner as any)({} as any, plugin, { showNotice }) as any;
        return { runner, showNotice };
    }

    it('finishReason=length：提示结果可能不完整，并带上步骤名', () => {
        const { runner, showNotice } = makeRunnerWithNotice();
        runner.warnIfTruncated({ content: '半章', finishReason: 'length' }, '正文写作');
        expect(showNotice).toHaveBeenCalledTimes(1);
        const [message] = showNotice.mock.calls[0];
        expect(message).toContain('正文写作');
        expect(message).toContain('不完整');
    });

    it('finishReason=stop：不打扰用户', () => {
        const { runner, showNotice } = makeRunnerWithNotice();
        runner.warnIfTruncated({ content: '完整', finishReason: 'stop' }, '正文写作');
        expect(showNotice).not.toHaveBeenCalled();
    });
});
