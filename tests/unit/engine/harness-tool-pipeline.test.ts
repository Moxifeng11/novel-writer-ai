/**
 * 工具管线与安全（C2）
 *
 * 吸收 dsh 的四条硬约束：
 *  - step 级工具集快照：提示词与执行同源；
 *  - 危险工具 fail-closed：没有审批端口就拒绝；
 *  - 重复守卫按整回合计数：A-B-A-B 不能绕过写拦截；
 *  - 参数校验到类型/未知键；结构化结果保留；取消/超时都返回稳定错误。
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry, validateArgs, TOOL_CANCELLED_CODE } from '../../../engine/agent/harness/tool-registry';
import { runHarnessTurn } from '../../../engine/agent/harness/agent-loop';
import type {
    HarnessAdapter,
    HarnessAssistantTurn,
    HarnessTool,
    HarnessToolContext,
} from '../../../engine/agent/harness/harness-types';

function tool(overrides: Partial<HarnessTool> & Pick<HarnessTool, 'name'>): HarnessTool {
    return {
        description: overrides.name,
        parameters: {},
        required: [],
        sideEffect: 'none',
        execute: async () => ({ ok: true, content: `${overrides.name} 完成` }),
        ...overrides,
    };
}

function scripted(turns: HarnessAssistantTurn[]): HarnessAdapter {
    let index = 0;
    return {
        complete: async () => {
            const turn = turns[Math.min(index, turns.length - 1)];
            index += 1;
            return turn;
        },
    };
}

function ctx(signal?: AbortSignal): HarnessToolContext {
    return { memory: { slots: {} }, signal };
}

const CALL_A: HarnessAssistantTurn = { tool: { name: 'write_a', args: { value: '1' } } };
const CALL_B: HarnessAssistantTurn = { tool: { name: 'write_b', args: { value: '1' } } };
const FINAL: HarnessAssistantTurn = { reply: '完成' };

describe('工具集快照', () => {
    it('注册新工具不会影响已取出的快照', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(tool({ name: 'a' }));
        const snapshot = registry.snapshot();
        registry.register(tool({ name: 'b' }));

        expect(snapshot.names).toEqual(['a']);
        expect(snapshot.describeForPrompt()).not.toContain('### b');
        expect((await snapshot.execute('b', {}, ctx())).ok).toBe(false);
        expect((await registry.execute('b', {}, ctx())).ok).toBe(true);
    });
});

describe('重复调用守卫（整回合计数）', () => {
    it('A-B-A-B 交替调用写工具也会在第二次拦截', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(tool({ name: 'write_a', sideEffect: 'write', parameters: { value: { type: 'string', description: 'v' } } }));
        registry.register(tool({ name: 'write_b', sideEffect: 'write', parameters: { value: { type: 'string', description: 'v' } } }));
        const log = new AgentSessionLog();

        const result = await runHarnessTurn({
            adapter: scripted([CALL_A, CALL_B, CALL_A, CALL_B, FINAL]),
            registry,
            log,
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            maxSteps: 6,
        });

        expect(result.toolCalls.map(call => call.ok)).toEqual([true, true, false, false]);
        expect(result.toolCalls[2].summary).toBeTruthy();
    });
});

describe('审批', () => {
    it('危险工具无审批端口 → 拒绝且不执行', async () => {
        const execute = vi.fn(async () => ({ ok: true, content: 'done' }));
        const registry = new HarnessToolRegistry();
        registry.register(tool({ name: 'danger_tool', sideEffect: 'dangerous', execute }));
        const result = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'danger_tool', args: {} } }, FINAL]),
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
        });
        expect(result.toolCalls[0].ok).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it('用户拒绝 → 不执行；批准 → 执行一次并标记 approvalGranted', async () => {
        const seen: Array<boolean | undefined> = [];
        const execute = vi.fn(async (_args: unknown, toolCtx: HarnessToolContext) => {
            seen.push(toolCtx.approvalGranted);
            return { ok: true, content: 'done' };
        });
        const registry = new HarnessToolRegistry();
        registry.register(tool({ name: 'danger_tool', sideEffect: 'dangerous', execute }));

        const denied = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'danger_tool', args: {} } }, FINAL]),
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            requestApproval: async () => false,
        });
        expect(denied.toolCalls[0].ok).toBe(false);
        expect(execute).not.toHaveBeenCalled();

        const approved = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'danger_tool', args: {} } }, FINAL]),
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            requestApproval: async () => true,
        });
        expect(approved.toolCalls[0].ok).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(seen).toEqual([true]);
    });

    it('writeApproval=ask 时写工具也要审批；显式 allow 不询问', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(tool({
            name: 'write_tool',
            sideEffect: 'write',
            parameters: { value: { type: 'string', description: 'v' } },
        }));
        const ask = vi.fn(async () => false);

        const blocked = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'write_tool', args: { value: '1' } } }, FINAL]),
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            writeApproval: 'ask',
            requestApproval: ask,
        });
        expect(ask).toHaveBeenCalledTimes(1);
        expect(blocked.toolCalls[0].ok).toBe(false);

        const allowed = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'write_tool', args: { value: '1' } } }, FINAL]),
            registry,
            log: new AgentSessionLog(),
            memory: { slots: {} },
            projects: [],
            activeProject: null,
            writeApproval: 'allow',
        });
        expect(allowed.toolCalls[0].ok).toBe(true);
    });
});

describe('参数校验', () => {
    const demo = tool({
        name: 'demo',
        sideEffect: 'write',
        parameters: {
            name: { type: 'string', description: '名字' },
            tags: { type: 'array', description: '标签', items: 'string' },
        },
        required: ['name'],
    });

    it('拒绝未知参数', () => {
        expect(validateArgs(demo, { name: 'a', evil: 1 })).toContain('未知参数');
    });

    it('字符串类型必须真的是字符串', () => {
        expect(validateArgs(demo, { name: 123 })).toContain('必须是字符串');
    });

    it('数组元素类型按 items 校验', () => {
        expect(validateArgs(demo, { name: 'a', tags: ['x', 2] })).toContain('第 2 项');
        expect(validateArgs(demo, { name: 'a', tags: ['x', 'y'] })).toBeNull();
    });
});

describe('结构化结果与取消', () => {
    it('工具 data 会进入结果与事件（含耗时）', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(tool({
            name: 'reader',
            execute: async () => ({ ok: true, content: '读到 3 条', data: { count: 3 } }),
        }));
        const log = new AgentSessionLog();
        const result = await runHarnessTurn({
            adapter: scripted([{ tool: { name: 'reader', args: {} } }, FINAL]),
            registry,
            log,
            memory: { slots: {} },
            projects: [],
            activeProject: null,
        });

        expect(result.toolCalls[0].data?.count).toBe(3);
        const event = log.snapshot().find(e => e.type === 'tool_result') as { data?: Record<string, unknown>; durationMs?: number };
        expect(event.data?.count).toBe(3);
        expect(typeof event.durationMs).toBe('number');
    });

    it('外部取消立即返回稳定错误码，不等工具结束', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(tool({
            name: 'hang',
            execute: () => new Promise(() => { /* never resolves */ }),
        }));
        const controller = new AbortController();
        controller.abort();

        const result = await registry.execute('hang', {}, ctx(controller.signal));
        expect(result.ok).toBe(false);
        expect(result.data?.errorCode).toBe(TOOL_CANCELLED_CODE);
    });
});
