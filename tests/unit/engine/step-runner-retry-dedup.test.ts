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
});
