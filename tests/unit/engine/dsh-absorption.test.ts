/**
 * dsh-absorption.test.ts — 从 DeepSeek Harness 吸收的机制
 *
 * 本轮吸收（保持本插件「内存日志 + JSON 协议 + 注入端口」的务实取舍）：
 * 1. tool-result pruner：超长工具结果在投影时保留头/尾、中段替换为标记；
 * 2. timeout policy：工具声明预算，超时返回结构化 TOOL_TIMEOUT 并触发中止信号；
 * 3. repeat-tool-reminder：只读工具重复只提醒、写入类工具重复才拦截；
 * 4. steering inbox：回合进行中可插入用户补充，下一步模型就能看到；
 * 5. 压力触发的会话压缩：字符数超阈值也压缩（不再只看轮次）。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { pruneToolResultText, PRUNE_MARKER, DEFAULT_PRUNE_CONFIG } from '../../../engine/agent/harness/tool-result-pruner';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry, TOOL_TIMEOUT_CODE } from '../../../engine/agent/harness/tool-registry';
import { runHarnessTurn } from '../../../engine/agent/harness/agent-loop';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import type { HarnessAdapter, HarnessAssistantTurn, HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentContext } from '../../../engine/agent/agent-types';

describe('tool-result pruner — 投影时裁剪超长工具结果', () => {
    it('未超阈值时原样返回', () => {
        const text = '短结果。';
        expect(pruneToolResultText(text)).toEqual({ text, saved: 0 });
    });

    it('超阈值时保留头尾并插入标记，原事件不被改写', () => {
        const text = '头'.repeat(4000) + '中间内容'.repeat(4000) + '尾'.repeat(4000);
        const outcome = pruneToolResultText(text);
        expect(outcome.saved).toBeGreaterThan(0);
        expect(outcome.text.startsWith('头'.repeat(100))).toBe(true);
        expect(outcome.text).toContain(PRUNE_MARKER.trim());
        expect(outcome.text.endsWith('尾'.repeat(100))).toBe(true);
        expect(Array.from(outcome.text).length).toBeLessThan(Array.from(text).length);
    });

    it('按码点裁剪，不切开代理对', () => {
        const emoji = '😀';
        const text = emoji.repeat(DEFAULT_PRUNE_CONFIG.thresholdChars + 20);
        const outcome = pruneToolResultText(text);
        // 结果里的 emoji 必须完整（不出现孤立代理项）
        expect(outcome.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        expect(outcome.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });
});

describe('AgentSessionLog — derive 裁剪与统计', () => {
    it('超长 tool_result 在转写里被裁剪，但日志事件保持原文', () => {
        const log = new AgentSessionLog();
        log.append({ type: 'user_message', text: '开始' });
        log.append({ type: 'tool_call', callId: 'c1', tool: 'list_chapters', args: {} });
        const huge = '章'.repeat(9000);
        log.append({ type: 'tool_result', callId: 'c1', tool: 'list_chapters', ok: true, content: huge });

        const turns = log.derive();
        const toolTurn = turns.find(t => t.role === 'tool');
        expect(toolTurn?.text).toContain(PRUNE_MARKER.trim());
        expect(Array.from(toolTurn?.text || '').length).toBeLessThan(3000);

        // 原始事件未被改写（可重放）
        const raw = log.snapshot().find(e => e.type === 'tool_result') as { content: string };
        expect(raw.content).toBe(huge);
        expect(log.pruneStats.results).toBe(1);
        expect(log.pruneStats.chars).toBeGreaterThan(0);
    });

    it('关闭裁剪（thresholdChars=0）时保留全文', () => {
        const log = new AgentSessionLog();
        log.setPruneConfig({ thresholdChars: 0 });
        log.append({ type: 'tool_call', callId: 'c1', tool: 'x', args: {} });
        log.append({ type: 'tool_result', callId: 'c1', tool: 'x', ok: true, content: '长'.repeat(9000) });
        expect(log.derive()[0].text).toContain('长'.repeat(8000));
        expect(log.pruneStats.results).toBe(0);
    });
});

describe('HarnessToolRegistry — 工具超时策略', () => {
    function makeTool(overrides: Partial<HarnessTool>): HarnessTool {
        return {
            name: 'slow_tool',
            description: '慢工具',
            parameters: {},
            required: [],
            execute: async () => ({ ok: true, content: '完成' }),
            ...overrides,
        } as HarnessTool;
    }

    it('超时返回结构化失败，并触发工具内的中止信号', async () => {
        let sawAbort = false;
        const registry = new HarnessToolRegistry();
        registry.register(makeTool({
            timeoutMs: 20,
            execute: async (_args, ctx) => {
                await new Promise<void>(resolve => {
                    ctx.signal?.addEventListener('abort', () => { sawAbort = true; resolve(); }, { once: true });
                    setTimeout(resolve, 500);
                });
                return { ok: true, content: '迟到的成功' };
            },
        }));

        const result = await registry.execute('slow_tool', {}, { memory: { slots: {} } });

        expect(result.ok).toBe(false);
        expect(result.content).toContain('超时');
        expect(result.data?.errorCode).toBe(TOOL_TIMEOUT_CODE);
        expect(sawAbort).toBe(true);
    });

    it('预算内正常返回；未声明预算不设 deadline', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(makeTool({ name: 'fast', timeoutMs: 500, execute: async () => ({ ok: true, content: '快' }) }));
        registry.register(makeTool({ name: 'nobudget', execute: async () => ({ ok: true, content: '无预算' }) }));

        await expect(registry.execute('fast', {}, { memory: { slots: {} } })).resolves.toMatchObject({ ok: true, content: '快' });
        await expect(registry.execute('nobudget', {}, { memory: { slots: {} } })).resolves.toMatchObject({ ok: true, content: '无预算' });
    });
});

describe('runHarnessTurn — 重复调用按副作用分级', () => {
    function scripted(turn: Partial<HarnessAssistantTurn>): HarnessAdapter {
        return { complete: async () => turn as HarnessAssistantTurn };
    }

    function makeRegistry(sideEffect: 'none' | 'write') {
        const registry = new HarnessToolRegistry();
        let executions = 0;
        registry.register({
            name: 'probe',
            description: '探针',
            parameters: {},
            required: [],
            sideEffect,
            execute: async () => { executions += 1; return { ok: true, content: 'ok' }; },
        });
        return { registry, getExecutions: () => executions };
    }

    it('只读工具重复执行，但在阈值处注入提醒', async () => {
        const { registry, getExecutions } = makeRegistry('none');
        const log = new AgentSessionLog();
        log.append({ type: 'user_message', text: '开始' });

        const result = await runHarnessTurn({
            adapter: scripted({ reply: '', tool: { name: 'probe', args: {} } }),
            registry, log, memory: { slots: {} }, projects: [], activeProject: null, maxSteps: 4,
        });

        expect(getExecutions()).toBe(4);
        expect(log.snapshot().some(e => e.type === 'context_message' && e.text.includes('连续 3 次'))).toBe(true);
        // 只读工具重复不算失败（提醒是 advisory 语义）
        expect(result.failed).toBe(false);
    });

    it('写入类工具第二次重复即拦截', async () => {
        const { registry, getExecutions } = makeRegistry('write');
        const log = new AgentSessionLog();
        log.append({ type: 'user_message', text: '开始' });

        await runHarnessTurn({
            adapter: scripted({ reply: '', tool: { name: 'probe', args: {} } }),
            registry, log, memory: { slots: {} }, projects: [], activeProject: null, maxSteps: 3,
        });

        expect(getExecutions()).toBe(1);
        expect(log.snapshot().some(e => e.type === 'tool_result' && e.content.includes('重复调用已被阻止'))).toBe(true);
    });
});

describe('AgentHarnessEngine — 回合内补充（steering）', () => {
    it('回合进行中 steer 的消息会进入下一次模型调用的上下文', async () => {
        const ctx: AgentContext = { projects: [], activeProject: null };
        const requests: Array<{ turns: Array<{ role: string; text: string }> }> = [];
        let releaseFirst: () => void = () => undefined;
        const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
        let call = 0;

        const adapter: HarnessAdapter = {
            async complete(request) {
                requests.push(request as never);
                call++;
                if (call === 1) {
                    // 第一次调用挂起：给测试机会 steer
                    await firstGate;
                    return { reply: '', tool: { name: 'update_memory', args: { slots: { genre: '玄幻' } } } };
                }
                return { reply: '收到补充。' };
            },
        };

        const engine = new AgentHarnessEngine({ ctx, adapter, portDeps: { port: {} as never, ctx } });
        const started = engine.start();
        // 等第一次模型调用已进入
        await vi.waitFor(() => expect(requests.length).toBe(1));
        expect(engine.steer('补充：用男频')).toBe(true);
        releaseFirst();
        const outcome = await started;

        expect(requests.length).toBe(2);
        const secondTurns = requests[1].turns.map(t => t.text).join('\n');
        expect(secondTurns).toContain('用户在你执行过程中补充');
        expect(secondTurns).toContain('补充：用男频');
        expect(outcome.messages.some(m => m.text.includes('收到补充'))).toBe(true);
        // 回合结束后 steer 不再接收
        expect(engine.steer('太晚了')).toBe(false);
    });
});

describe('AgentHarnessEngine — 压力触发压缩', () => {
    it('轮次没到阈值但字符数超阈值时也会压缩', async () => {
        const ctx: AgentContext = { projects: [], activeProject: null };
        const adapter: HarnessAdapter = {
            complete: async (request) => {
                // 压缩调用（单条 user turn 且含「压缩」提示）直接返回摘要
                if (request.turns.length === 1 && request.system.includes('会话压缩器')) {
                    return { reply: '【摘要】已确认：项目名=新书，结构=三幕式。' };
                }
                return { reply: '好的。' };
            },
        };
        const engine = new AgentHarnessEngine({
            ctx, adapter, portDeps: { port: {} as never, ctx },
            compaction: { thresholdTurns: 999, keepTurns: 1, thresholdChars: 200 },
        });
        const log = (engine as unknown as { log: AgentSessionLog }).log;
        // 先塞一段超长历史（synthetic，模拟多轮长工具结果）
        for (let i = 0; i < 6; i++) {
            log.append({ type: 'user_message', text: `第 ${i} 轮`.repeat(30) });
            log.append({ type: 'assistant_message', text: '收到。'.repeat(30) });
        }
        expect(log.derivedChars(10_000)).toBeGreaterThan(200);

        await engine.handle('继续');

        const telemetry = engine.getTelemetry();
        expect(telemetry.compactions).toBeGreaterThan(0);
        expect(log.snapshot().some(e => e.type === 'user_message' && e.text.includes('历史摘要'))).toBe(true);
    });
});
