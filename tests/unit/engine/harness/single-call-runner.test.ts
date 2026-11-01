/**
 * SingleCallRunner — 单次调用契约（G7-4）
 *
 * 这一层是 Agent / 长篇精修的共用「一次逻辑调用」入口：
 * 只放行一次网络调用，失败必须显式返回给调用方，不允许内部偷偷重试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SingleCallRunner, type SingleCallTaskInput } from '../../../../engine/harness/single-call-runner';
import { callLedger } from '../../../../engine/harness/call-ledger';
import type { AIEngine } from '../../../../engine/ai-engine';
import type { Rule } from '../../../../engine/harness/rule-engine';

interface Payload { title: string }

function makeAi(response: { content?: string; error?: string } | Error) {
    const calls: Array<{ system: string; user: string; maxTokens?: number }> = [];
    const ai = {
        callAI: vi.fn(async (system: string, user: string, _model?: string, _temp?: number, maxTokens?: number) => {
            calls.push({ system, user, maxTokens });
            if (response instanceof Error) throw response;
            return { content: response.content ?? '', error: response.error, finishReason: 'stop' };
        }),
    };
    return { ai: ai as unknown as AIEngine, calls };
}

function baseInput(overrides: Partial<SingleCallTaskInput<Payload>> = {}): SingleCallTaskInput<Payload> {
    return {
        taskId: 'test-task',
        mode: 'long',
        modelTask: 'planning',
        ai: makeAi({ content: '{"title":"第一章"}' }).ai,
        systemPrompt: 'system',
        userPrompt: 'user',
        ...overrides,
    };
}

const CONTRACT = {
    parse: (raw: string): Payload | null => {
        try {
            const value = JSON.parse(raw) as Payload;
            return typeof value.title === 'string' ? value : null;
        } catch {
            return null;
        }
    },
};

describe('SingleCallRunner — 成功路径', () => {
    beforeEach(() => callLedger.clear());

    it('一次网络调用，契约解析成功，记录到调用账本', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '{"title":"第一章"}' });

        const result = await runner.run(baseInput({ ai, contract: CONTRACT }));

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.networkCalls).toBe(1);
        expect(result.value).toEqual({ title: '第一章' });
        expect(result.raw).toBe('{"title":"第一章"}');

        const entry = callLedger.recent(1)[0];
        expect(entry?.taskId).toBe('test-task');
        expect(entry?.logicalCalls).toBe(1);
        expect(entry?.networkCalls).toBe(1);
        expect(entry?.ok).toBe(true);
    });

    it('promptArtifact 覆盖 system/user 与 maxTokens', async () => {
        const runner = new SingleCallRunner();
        const { ai, calls } = makeAi({ content: '{"title":"x"}' });

        await runner.run(baseInput({
            ai,
            maxTokens: 100,
            promptArtifact: {
                systemPrompt: 'artifact-system',
                userPrompt: 'artifact-user',
                tokenBudget: { maxOutput: 4096 },
            } as never,
        }));

        expect(calls[0].system).toBe('artifact-system');
        expect(calls[0].user).toBe('artifact-user');
        expect(calls[0].maxTokens).toBe(4096);
    });
});

describe('SingleCallRunner — 失败路径（不重试）', () => {
    beforeEach(() => callLedger.clear());

    it('AI 返回 error → 失败并透传错误', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '', error: '模型拒绝请求' });

        const result = await runner.run(baseInput({ ai }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.error).toBe('模型拒绝请求');
        expect(result.networkCalls).toBe(1);
        expect(callLedger.recent(1)[0]?.ok).toBe(false);
    });

    it('AI 返回空内容 → 「AI 返回为空」', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '   ' });

        const result = await runner.run(baseInput({ ai }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.error).toBe('AI 返回为空');
    });

    it('契约解析失败 → 给出 parseIssues 并保留原文', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '这不是 JSON' });

        const result = await runner.run(baseInput({ ai, contract: CONTRACT }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.parseIssues).toEqual(['无法解析结构化输出']);
        expect(result.error).toContain('结构化输出校验失败');
        expect(result.raw).toBe('这不是 JSON');
    });

    it('契约 validate 返回问题 → 同样阻断', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '{"title":""}' });

        const result = await runner.run(baseInput({
            ai,
            contract: {
                parse: CONTRACT.parse,
                validate: (value: Payload) => value.title.trim() ? [] : ['标题不能为空'],
            },
        }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.parseIssues).toEqual(['标题不能为空']);
        expect(result.error).toContain('标题不能为空');
    });

    it('must 级规则不通过 → 本地规则校验失败', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi({ content: '{"title":"第一章"}' });
        const mustRule: Rule = {
            id: 'test-must',
            mode: 'all',
            scope: 'global',
            severity: 'must',
            source: 'platform',
            promptText: '测试规则',
            validate: () => ({ ruleId: 'test-must', severity: 'must', message: '命中禁用词' }),
        };

        const result = await runner.run(baseInput({ ai, rules: [mustRule] }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.error).toBe('本地规则校验失败');
        expect(result.violations.some(item => item.ruleId === 'test-must')).toBe(true);
    });

    it('AI 抛异常 → 失败且不二次调用', async () => {
        const runner = new SingleCallRunner();
        const { ai } = makeAi(new Error('网络断开'));

        const result = await runner.run(baseInput({ ai }));

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('should fail');
        expect(result.error).toBe('网络断开');
        expect(result.networkCalls).toBe(1);
        // 只调用一次，绝不内部重试
        expect((ai.callAI as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    });
});
