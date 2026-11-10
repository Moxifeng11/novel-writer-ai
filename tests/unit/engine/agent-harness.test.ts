import { describe, expect, it } from 'vitest';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry, validateArgs } from '../../../engine/agent/harness/tool-registry';
import { assembleHarnessSystemPrompt } from '../../../engine/agent/harness/prompt-sections';
import {
    extractJsonBlock,
    parseAssistantTurn,
    runHarnessTurn,
} from '../../../engine/agent/harness/agent-loop';
import { createCallAIAdapter } from '../../../engine/agent/harness/agent-adapter';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import type {
    DerivedTurn,
    HarnessAdapter,
    HarnessAssistantTurn,
    HarnessMemoryState,
    HarnessTool,
} from '../../../engine/agent/harness/harness-types';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

// ============================================================
// Session Log
// ============================================================

describe('AgentSessionLog', () => {
    it('投影时合并工具调用与结果，隐藏 system 与 marker', () => {
        const log = new AgentSessionLog();
        log.append({ type: 'system_message', text: 'sys' });
        log.append({ type: 'turn_marker', marker: 'turn_start' });
        log.append({ type: 'user_message', text: '我想写长篇' });
        log.append({ type: 'assistant_message', text: '好的，先选频道。' });
        const callId = log.nextCallId('update_memory');
        log.append({ type: 'tool_call', callId, tool: 'update_memory', args: { slots: { creationType: 'long' } } });
        log.append({ type: 'tool_result', callId, tool: 'update_memory', ok: true, content: '已记录 1 项' });
        log.append({ type: 'assistant_message', text: '已记住。' });

        const turns = log.derive();
        expect(turns).toHaveLength(4);
        expect(turns[0]).toEqual({ role: 'user', text: '我想写长篇' });
        expect(turns[2].role).toBe('tool');
        expect(turns[2].text).toContain('update_memory');
        expect(turns[2].text).toContain('已记录 1 项');
        expect(turns.some(t => t.text === 'sys')).toBe(false);
    });

    it('derive 支持 limitTurns 截断', () => {
        const log = new AgentSessionLog();
        for (let i = 0; i < 30; i++) {
            log.append({ type: 'user_message', text: `消息 ${i}` });
        }
        expect(log.derive(10)).toHaveLength(10);
        expect(log.derive(10)[0].text).toBe('消息 20');
    });

    it('reset 清空日志与调用计数', () => {
        const log = new AgentSessionLog();
        log.nextCallId('a');
        log.append({ type: 'user_message', text: 'x' });
        log.reset();
        expect(log.size).toBe(0);
        expect(log.nextCallId('b')).toBe('call_1_b');
    });
});

// ============================================================
// Tool Registry
// ============================================================

function makeTool(overrides: Partial<HarnessTool> = {}): HarnessTool {
    return {
        name: 'demo_tool',
        description: '演示工具',
        parameters: {
            target: { type: 'string', description: '目标' },
            mode: { type: 'string', description: '模式', enum: ['fast', 'slow'] },
        },
        required: ['target'],
        execute: async () => ({ ok: true, content: '完成' }),
        ...overrides,
    };
}

describe('HarnessToolRegistry', () => {
    it('校验必填 / 枚举 / 未知工具', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(makeTool());

        const missing = await registry.execute('demo_tool', {}, {} as never);
        expect(missing.ok).toBe(false);
        expect(missing.content).toContain('缺少必填参数：target');

        const badEnum = await registry.execute('demo_tool', { target: 'x', mode: 'warp' }, {} as never);
        expect(badEnum.ok).toBe(false);
        expect(badEnum.content).toContain('fast/slow');

        const unknown = await registry.execute('nope', {}, {} as never);
        expect(unknown.ok).toBe(false);
        expect(unknown.content).toContain('未知工具');

        const ok = await registry.execute('demo_tool', { target: 'x', mode: 'fast' }, {} as never);
        expect(ok.ok).toBe(true);
    });

    it('执行异常被捕获为失败结果，不抛出', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(makeTool({
            execute: async () => { throw new Error('boom'); },
        }));
        const result = await registry.execute('demo_tool', { target: 'x' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('boom');
    });

    it('describeForPrompt 输出名称、描述与参数', () => {
        const registry = new HarnessToolRegistry();
        registry.register(makeTool());
        const text = registry.describeForPrompt();
        expect(text).toContain('### demo_tool');
        expect(text).toContain('演示工具');
        expect(text).toContain('必填');
        expect(text).toContain('fast/slow');
    });
});

// ============================================================
// Prompt Sections
// ============================================================

describe('assembleHarnessSystemPrompt', () => {
    it('包含身份、环境、记忆、工具与协议段', () => {
        const registry = new HarnessToolRegistry();
        registry.register(makeTool());
        const memory: HarnessMemoryState = { slots: { creationType: 'long', projectName: '九霄' } };
        const prompt = assembleHarnessSystemPrompt({
            projects: ['长篇/九霄逆脉行'],
            activeProject: '长篇/九霄逆脉行',
            memory,
            registry,
        });
        expect(prompt).toContain('对话引导 Agent');
        expect(prompt).toContain('九霄逆脉行');
        expect(prompt).toContain('- projectName: "九霄"');
        expect(prompt).toContain('demo_tool');
        expect(prompt).toContain('输出协议');
        // v5 B1：阶段引导以 flow 为事实源，不再让模型凭记忆套固定八阶段
        expect(prompt).toContain('阶段事实源');
        expect(prompt).toContain('flow.nextStageId');
        expect(prompt).toContain('blockedReason');
        // 分段顺序：身份在工具之前
        expect(prompt.indexOf('对话引导 Agent')).toBeLessThan(prompt.indexOf('demo_tool'));
    });
});

// ============================================================
// Assistant Turn 解析
// ============================================================

describe('parseAssistantTurn / extractJsonBlock', () => {
    it('解析标准 JSON 协议', () => {
        const parsed = parseAssistantTurn('{"reply":"选个频道","chips":[{"label":"男频","value":"男频"}],"tool":{"name":"update_memory","arguments":{"slots":{"creationType":"long"}}}}');
        expect(parsed.reply).toBe('选个频道');
        expect(parsed.tool?.name).toBe('update_memory');
        expect(parsed.chips?.[0].label).toBe('男频');
    });

    it('容忍代码围栏与前后杂文本', () => {
        const parsed = parseAssistantTurn('好的：\n```json\n{"reply":"继续","tool":null}\n```');
        expect(parsed.reply).toBe('继续');
        expect(parsed.tool).toBeUndefined();
    });

    it('非 JSON 纯文本整体作为 reply', () => {
        const parsed = parseAssistantTurn('这句话没有 JSON');
        expect(parsed.reply).toBe('这句话没有 JSON');
    });

    it('extractJsonBlock 处理嵌套与字符串中的花括号', () => {
        const block = extractJsonBlock('前缀 {"a":{"b":"包含}花括号"},"c":1} 后缀');
        expect(JSON.parse(block!)).toEqual({ a: { b: '包含}花括号' }, c: 1 });
    });
});

// ============================================================
// Agent Loop（脚本化适配器）
// ============================================================

function scriptedAdapter(steps: Array<Partial<HarnessAssistantTurn>>): { adapter: HarnessAdapter } {
    let index = 0;
    return {
        adapter: {
            async complete() {
                const step = steps[Math.min(index, steps.length - 1)];
                index++;
                return { reply: '', ...step } as HarnessAssistantTurn;
            },
        },
    };
}

function makeLoopOptions(adapter: HarnessAdapter, memory: HarnessMemoryState = { slots: {} }) {
    const registry = new HarnessToolRegistry();
    const executed: string[] = [];
    registry.register({
        name: 'echo_tool',
        description: '回声工具',
        parameters: { message: { type: 'string', description: '消息' } },
        required: ['message'],
        execute: async (args) => {
            executed.push(String(args.message));
            return { ok: true, content: `回声：${args.message}` };
        },
    });
    registry.register({
        name: 'fail_tool',
        description: '总是失败的工具',
        parameters: {},
        required: [],
        execute: async () => ({ ok: false, content: '导出失败：磁盘不可写' }),
    });
    const log = new AgentSessionLog();
    log.append({ type: 'user_message', text: '开始' });
    return { registry, log, memory, executed };
}

describe('runHarnessTurn', () => {
    it('工具回合后继续模型调用，最终回复结束回合', async () => {
        const { adapter } = scriptedAdapter([
            { reply: '我先记一下。', tool: { name: 'echo_tool', args: { message: '你好' } } },
            { reply: '记好了，接下来选类型。', chips: [{ label: '长篇', value: '长篇' }] },
        ]);
        const { registry, log, memory } = makeLoopOptions(adapter);
        const result = await runHarnessTurn({
            adapter, registry, log, memory, projects: [], activeProject: null,
        });

        expect(result.usedAi).toBe(true);
        expect(result.failed).toBe(false);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]).toEqual({ tool: 'echo_tool', ok: true, summary: '你好' });
        expect(result.reply).toBe('记好了，接下来选类型。');
        expect(result.chips[0].label).toBe('长篇');
        // 工具结果已写回日志
        const turns = log.derive();
        expect(turns.some(t => t.role === 'tool' && t.text.includes('回声：你好'))).toBe(true);
    });

    it('适配器失败时 failed=true 且不产出回复', async () => {
        const adapter: HarnessAdapter = { async complete() { return null; } };
        const { registry, log, memory } = makeLoopOptions(adapter);
        const result = await runHarnessTurn({ adapter, registry, log, memory, projects: [], activeProject: null });
        expect(result.failed).toBe(true);
        expect(result.usedAi).toBe(false);
    });

    it('同一工具重复调用只执行一次，步数耗尽后以失败收尾', async () => {
        const { adapter } = scriptedAdapter([
            { reply: '', tool: { name: 'echo_tool', args: { message: '循环' } } },
        ]);
        const { registry, log, memory } = makeLoopOptions(adapter);
        const result = await runHarnessTurn({
            adapter, registry, log, memory, projects: [], activeProject: null, maxSteps: 3,
        });
        // 第一次真正执行，后两次被去重拦截（模型抖动/重试时不再放大副作用）
        expect(result.toolCalls).toHaveLength(3);
        expect(result.toolCalls[0].ok).toBe(true);
        expect(result.toolCalls[1].ok).toBe(false);
        expect(result.toolCalls[2].ok).toBe(false);
        // 最后一步工具失败 → 回合按失败收尾，不能把模型「动手前」的承诺当成功
        expect(result.failed).toBe(true);
        expect(result.reply).toContain('重复调用已被阻止');
    });

    it('最后一步工具失败时标记回合失败并带上失败原因', async () => {
        const { adapter } = scriptedAdapter([
            { reply: '正在导出……', tool: { name: 'fail_tool', args: {} } },
        ]);
        const { registry, log, memory } = makeLoopOptions(adapter);
        const result = await runHarnessTurn({
            adapter, registry, log, memory, projects: [], activeProject: null, maxSteps: 1,
        });
        expect(result.failed).toBe(true);
        expect(result.failReason).toContain('导出失败');
    });

    it('未知工具调用不会中断回合，模型能收到错误并继续', async () => {
        const { adapter } = scriptedAdapter([
            { reply: '调错工具了', tool: { name: 'no_such_tool', args: {} } },
            { reply: '抱歉，重来。' },
        ]);
        const { registry, log, memory } = makeLoopOptions(adapter);
        const result = await runHarnessTurn({ adapter, registry, log, memory, projects: [], activeProject: null });
        expect(result.toolCalls[0].ok).toBe(false);
        expect(result.reply).toBe('抱歉，重来。');
        expect(log.derive().some(t => t.text.includes('未知工具'))).toBe(true);
    });
});

// ============================================================
// CallAI 适配器
// ============================================================

describe('createCallAIAdapter', () => {
    it('把系统提示与转写折叠进 callAI，解析 JSON 协议', async () => {
        const calls: Array<{ system: string; user: string }> = [];
        const adapter = createCallAIAdapter(async (system, user) => {
            calls.push({ system, user });
            return {
                content: '{"reply":"好的","chips":[{"label":"男频","value":"男频"}]}',
            };
        });
        const turns: DerivedTurn[] = [
            { role: 'user', text: '我想写长篇' },
            { role: 'assistant', text: '选频道' },
        ];
        const turn = await adapter.complete({ system: 'SYS', turns, temperature: 0.5, maxTokens: 100 });

        expect(calls).toHaveLength(1);
        expect(calls[0].system).toContain('SYS');
        expect(calls[0].user).toContain('【用户】我想写长篇');
        expect(calls[0].user).toContain('【你上一条回复】选频道');
        expect(turn?.reply).toBe('好的');
        expect(turn?.chips?.[0].value).toBe('男频');
    });

    it('callAI 报错 / 空内容 / 异常都返回 null', async () => {
        expect(await createCallAIAdapter(async () => ({ content: '', error: 'x' })).complete({ system: 's', turns: [], temperature: 0, maxTokens: 1 })).toBeNull();
        expect(await createCallAIAdapter(async () => ({ content: '  ' })).complete({ system: 's', turns: [], temperature: 0, maxTokens: 1 })).toBeNull();
        expect(await createCallAIAdapter(async () => { throw new Error('net'); }).complete({ system: 's', turns: [], temperature: 0, maxTokens: 1 })).toBeNull();
    });

    it('模型输出非 JSON 文本时兜底为 reply', async () => {
        const adapter = createCallAIAdapter(async () => ({ content: '这是纯文本回复' }));
        const turn = await adapter.complete({ system: 's', turns: [], temperature: 0, maxTokens: 1 });
        expect(turn?.reply).toBe('这是纯文本回复');
    });
});

// ============================================================
// Harness Engine（宿主工具 + 引擎表面）
// ============================================================

function makeContext(): AgentContext {
    return { projects: ['长篇/九霄逆脉行'], activeProject: '长篇/九霄逆脉行' };
}

function makePort() {
    const calls: string[] = [];
    const port: GuideAgentPort & { calls: string[] } = {
        calls,
        createProject: async (params) => {
            calls.push(`create_long:${params.projectName}:${params.genre}:${params.storySettings.structureId}`);
            return { created: true, projectId: `长篇/${params.projectName}`, fileCount: 12 };
        },
        openWizard: async (project) => { calls.push(`open_wizard:${project}`); return true; },
        openStorySettings: () => { calls.push('open_story_settings'); return true; },
        openFullWriter: () => { calls.push('open_full_writer'); return true; },
        openPreResearch: (mode) => { calls.push(`open_pre_research:${mode}`); return true; },
        runCommand: (commandId) => { calls.push(`run_command:${commandId}`); return true; },
        // 高成本/破坏性命令需要用户确认（dsh user-approval）
        confirmDangerousAction: async (request) => { calls.push(`approve:${request.title}`); return true; },
        openCoWriting: () => { calls.push('open_co_writing'); return true; },
    };
    return port;
}

describe('AgentHarnessEngine', () => {
    it('完整链路：记忆 → 创建 → 打开向导，工具结果反馈给用户', async () => {
        const port = makePort();
        // 显式步骤脚本：每个模型调用按序返回；工具调用后 loop 会再次调用模型
        const script: Array<Partial<HarnessAssistantTurn>> = [
            // start：记录类型/项目名/题材 → 追问频道
            {
                raw: JSON.stringify({
                    reply: '我先记一下。',
                    tool: { name: 'update_memory', arguments: { slots: { creationType: 'long', projectName: '新界风云', genre: '玄幻' } } },
                }),
            },
            {
                raw: JSON.stringify({
                    reply: '好的，长篇想发男频还是女频？',
                    chips: [{ label: '男频', value: '男频' }, { label: '女频', value: '女频' }],
                }),
            },
            // handle('男频')：记录频道 → 给确认摘要
            {
                raw: JSON.stringify({
                    reply: '收到。',
                    tool: { name: 'update_memory', arguments: { slots: { channel: '男频' } } },
                }),
            },
            {
                raw: JSON.stringify({
                    reply: '设定摘要：玄幻男频长篇……确认后我立即创建。',
                    chips: [{ label: '确认创建', value: '确认创建' }],
                }),
            },
            // handle('确认创建')：创建 → 打开向导 → 收尾
            {
                raw: JSON.stringify({
                    reply: '开始创建。',
                    tool: { name: 'create_long_project', arguments: {} },
                }),
            },
            {
                raw: JSON.stringify({
                    reply: '✅ 创建完成！',
                    tool: { name: 'open_wizard', arguments: {} },
                }),
            },
            { raw: JSON.stringify({ reply: '去写第一章吧！' }) },
        ];
        let stepIndex = 0;
        const adapter: HarnessAdapter = {
            async complete() {
                const step = script[Math.min(stepIndex, script.length - 1)];
                stepIndex++;
                return step as HarnessAssistantTurn;
            },
        };

        const engine = new AgentHarnessEngine({
            ctx: makeContext(),
            adapter,
            portDeps: { port, ctx: makeContext() },
        });

        const boot = await engine.start();
        expect(boot.usedAi).toBe(true);
        expect(boot.messages.some(m => m.text.includes('男频还是女频'))).toBe(true);
        expect(engine.getSlots().creationType).toBe('long');

        await engine.handle('男频');
        expect(engine.getSlots().channel).toBe('男频');

        const confirmTurn = await engine.handle('确认创建');
        expect(confirmTurn.toolCalls.some(c => c.tool === 'create_long_project' && c.ok)).toBe(true);
        expect(confirmTurn.toolCalls.some(c => c.tool === 'open_wizard' && c.ok)).toBe(true);
        expect(port.calls.some(c => c.startsWith('create_long:新界风云:玄幻'))).toBe(true);
        expect(port.calls).toContain('open_wizard:长篇/新界风云');
        expect(engine.isDone()).toBe(false);
    });

    it('创建工具从记忆回填缺省参数，同人缺原作时报错给模型', async () => {
        const port = makePort();
        let lastToolText = '';
        let phase = 0;
        const adapter: HarnessAdapter = {
            async complete(request) {
                phase++;
                if (phase === 1) {
                    return {
                        raw: JSON.stringify({
                            reply: '先记录。',
                            tool: { name: 'update_memory', arguments: { slots: { projectName: '同人试炼', genre: '玄幻', projectType: 'fanfic' } } },
                        }),
                    };
                }
                // 第二步：取最新的工具结果行（update_memory 之后应为 create_long_project 的失败结果）
                const toolTurns = request.turns.filter(t => t.role === 'tool');
                lastToolText = toolTurns[toolTurns.length - 1]?.text || '';
                if (!lastToolText.includes('create_long_project')) {
                    return {
                        raw: JSON.stringify({
                            reply: '尝试创建。',
                            tool: { name: 'create_long_project', arguments: { projectName: '同人试炼', genre: '玄幻', projectType: 'fanfic' } },
                        }),
                    };
                }
                return { raw: JSON.stringify({ reply: '明白缺什么了。' }) };
            },
        };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port, ctx: makeContext() } });
        await engine.start();
        await engine.handle('创建');

        // 缺 sourceWork → 工具返回失败，端口未被调用
        expect(port.calls).toHaveLength(0);
        expect(lastToolText).toContain('create_long_project');
        expect(lastToolText).toContain('缺少原作名称');
    });

    it('适配器完全失败时输出降级 chip，宿主可切换规则引擎', async () => {
        const adapter: HarnessAdapter = { async complete() { return null; } };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port: makePort(), ctx: makeContext() } });
        const outcome = await engine.start();
        expect(outcome.degraded).toBe(true);
        expect(outcome.chips.some(chip => chip.value === '__fallback_rule__')).toBe(true);
    });

    it('空输入直接提示，不消耗模型调用', async () => {
        let calls = 0;
        const adapter: HarnessAdapter = { async complete() { calls++; return { reply: 'x' }; } };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port: makePort(), ctx: makeContext() } });
        const outcome = await engine.handle('   ');
        expect(calls).toBe(0);
        expect(outcome.messages[0].text).toContain('没有收到内容');
    });

    it('遥测累积轮次/模型调用/工具统计，getTools 暴露工具目录', async () => {
        const script: Array<Partial<HarnessAssistantTurn>> = [
            { raw: JSON.stringify({ reply: '记一下', tool: { name: 'update_memory', arguments: { slots: { creationType: 'long' } } } }) },
            { raw: JSON.stringify({ reply: '好了。' }) },
            { raw: JSON.stringify({ reply: '再记一次', tool: { name: 'update_memory', arguments: { slots: { channel: '男频' } } } }) },
            { raw: JSON.stringify({ reply: '调个坏工具', tool: { name: 'no_such_tool', arguments: {} } }) },
            { raw: JSON.stringify({ reply: '结束。' }) },
        ];
        let i = 0;
        const adapter: HarnessAdapter = { async complete() { return script[i++] as HarnessAssistantTurn; } };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port: makePort(), ctx: makeContext() } });
        await engine.start();
        await engine.handle('继续');

        const telemetry = engine.getTelemetry();
        expect(telemetry.turns).toBe(2);
        expect(telemetry.modelCalls).toBe(2);
        expect(telemetry.toolCalls).toBe(3);
        expect(telemetry.toolOk).toBe(2);
        expect(telemetry.toolFail).toBe(1);
        expect(telemetry.byTool.update_memory).toEqual({ total: 2, ok: 2 });
        expect(telemetry.byTool.no_such_tool).toEqual({ total: 1, ok: 0 });
        expect(telemetry.lastToolCalls[0].tool).toBe('no_such_tool');

        const tools = engine.getTools();
        expect(tools.length).toBeGreaterThanOrEqual(14);
        expect(tools.some(t => t.name === 'run_command')).toBe(true);
        expect(tools.some(t => t.name === 'get_project_status')).toBe(true);
    });

    it('工作台扩展工具：list_chapters / open_chapter / get_project_status / run_command / open_co_writing', async () => {
        const port = makePort();
        port.listChapters = async () => [
            { chapter: '第1章', volume: '第1卷', title: '九脉逆行', status: 'settled', hasBody: true, written: true, size: 14538 },
            { chapter: '第2章', volume: '第1卷', title: '', status: 'pending', hasBody: true, written: false, size: 287 },
        ];
        port.getProjectStatus = async () => ({
            project: '长篇/九霄逆脉行',
            mode: 'long',
            structureId: 'qichengzhuanhe',
            totalChapters: 2,
            plannedChapters: 2,
            writtenChapters: 1,
            skeletonChapters: 1,
            byStatus: { settled: 1, pending: 1 },
            latestWrittenChapter: '第1章',
            nextChapterToWrite: '第2章',
        });
        port.runCommand = (commandId) => {
            if (commandId !== 'novel-writer-export-manuscript') return false;
            port.calls.push(`run_command:${commandId}`);
            return true;
        };
        port.openCoWriting = () => { port.calls.push('open_co_writing'); return true; };

        const seen: Array<Record<string, unknown>> = [];
        const script: Array<Partial<HarnessAssistantTurn>> = [
            { reply: '', tool: { name: 'list_chapters', args: {} } },
            { reply: '', tool: { name: 'get_project_status', args: {} } },
            { reply: '', tool: { name: 'open_chapter', args: { chapter: '第2章' } } },
            { reply: '', tool: { name: 'open_co_writing', args: {} } },
            { reply: '', tool: { name: 'run_command', args: { commandId: 'novel-writer-export-manuscript', reason: '导出' } } },
            { reply: '', tool: { name: 'run_command', args: { commandId: 'no-such-cmd' } } },
            { reply: '全部完成。' },
        ];
        const adapter: HarnessAdapter = {
            async complete(request) {
                const toolTurns = request.turns.filter(t => t.role === 'tool');
                if (toolTurns.length > 0) seen.push({ text: toolTurns[toolTurns.length - 1].text });
                const step = script[Math.min(seen.length, script.length - 1)];
                return { reply: '', ...step } as HarnessAssistantTurn;
            },
        };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port, ctx: makeContext() }, maxSteps: 10 });
        const outcome = await engine.start();

        const texts = seen.map(item => String(item.text));
        expect(texts.some(t => t.includes('list_chapters') && t.includes('第1章') && t.includes('已写'))).toBe(true);
        expect(texts.some(t => t.includes('get_project_status') && t.includes('结构 qichengzhuanhe'))).toBe(true);
        // BUG 回归：进度必须区分「已写」与「待写骨架」，且建议续写第2章而不是把骨架当最新
        expect(texts.some(t => t.includes('已写 1 章'))).toBe(true);
        expect(texts.some(t => t.includes('待写骨架 1 章'))).toBe(true);
        expect(texts.some(t => t.includes('建议接下来写：第2章'))).toBe(true);
        expect(texts.some(t => t.includes('不算已完成'))).toBe(true);
        expect(texts.some(t => t.includes('open_chapter') && t.includes('第2章'))).toBe(true);
        expect(texts.some(t => t.includes('open_co_writing') && t.includes('成功'))).toBe(true);
        expect(texts.some(t => t.includes('run_command') && t.includes('novel-writer-export-manuscript') && t.includes('成功'))).toBe(true);
        expect(texts.some(t => t.includes('no-such-cmd') && t.includes('失败'))).toBe(true);
        expect(outcome.messages.some(m => m.text.includes('全部完成'))).toBe(true);
        expect(port.calls).toContain('open_co_writing');
        expect(port.calls).toContain('run_command:novel-writer-export-manuscript');
    });

    it('update_plan 工具维护创作计划，getPlan 可读，提示词含计划段', async () => {
        const port = makePort();
        const prompts: string[] = [];
        const script: Array<Partial<HarnessAssistantTurn>> = [
            {
                raw: JSON.stringify({
                    reply: '我先把计划列出来。',
                    tool: {
                        name: 'update_plan',
                        arguments: {
                            steps: [
                                { step: '配置世界观', status: 'done' },
                                { step: '写第1章正文', status: 'in_progress' },
                                { step: '导出成稿', status: 'pending' },
                            ],
                        },
                    },
                }),
            },
            { raw: JSON.stringify({ reply: '计划已更新。' }) },
            { raw: JSON.stringify({ reply: '继续。' }) },
        ];
        let i = 0;
        const adapter: HarnessAdapter = {
            async complete(request) {
                prompts.push(request.system);
                return script[Math.min(i++, script.length - 1)] as HarnessAssistantTurn;
            },
        };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port, ctx: makeContext() } });
        await engine.start();

        const plan = engine.getPlan();
        expect(plan).toHaveLength(3);
        expect(plan[1]).toEqual({ step: '写第1章正文', status: 'in_progress' });

        await engine.handle('继续');
        expect(prompts[prompts.length - 1]).toContain('创作计划');
        expect(prompts[prompts.length - 1]).toContain('写第1章正文');
    });

    it('会话压缩：超过阈值后历史被压成摘要节点', async () => {
        const port = makePort();
        let summaryCalls = 0;
        const transcripts: string[] = [];
        const adapter: HarnessAdapter = {
            async complete(request) {
                transcripts.push(request.turns.map(t => t.text).join('\n'));
                if (request.system.includes('会话压缩器')) {
                    summaryCalls++;
                    return { reply: '早期：用户想写玄幻长篇，已确认起承转合结构。' };
                }
                const toolTurns = request.turns.filter(t => t.role === 'tool');
                if (toolTurns.length === 0) {
                    return {
                        raw: JSON.stringify({
                            reply: '记录。',
                            tool: { name: 'update_memory', arguments: { slots: { creationType: 'long' } } },
                        }),
                    };
                }
                return { raw: JSON.stringify({ reply: '好的。' }) };
            },
        };
        const engine = new AgentHarnessEngine({
            ctx: makeContext(),
            adapter,
            portDeps: { port, ctx: makeContext() },
            compaction: { thresholdTurns: 6, keepTurns: 2 },
        });

        await engine.start();
        for (let round = 0; round < 8; round++) await engine.handle('第' + round + '轮');

        expect(summaryCalls).toBeGreaterThan(0);
        // S3-2：压缩输入里的工具结果必须带围栏，不能把注入文本「洗白」成可信摘要
        expect(transcripts.some(t => t.includes('【工具结果#'))).toBe(true);
        // 摘要节点进入对话转写（而非系统提示词）
        expect(transcripts.some(t => t.includes('历史摘要'))).toBe(true);
        expect(transcripts.some(t => t.includes('玄幻长篇'))).toBe(true);
    });
    it('restore 丢弃不在活跃项目列表的 pickedProject（S3-2）', () => {
        const adapter: HarnessAdapter = { async complete() { return { reply: '' }; } };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port: makePort(), ctx: makeContext() } });
        engine.restore({
            events: [],
            callSeq: 1,
            memory: { pickedProject: '长篇小说/不存在', projectName: '书A' },
            plan: [],
        } as never);

        expect(engine.getSlots().pickedProject).toBeUndefined();
        expect(engine.getSlots().projectName).toBe('书A');
    });

    it('updateContext 后新项目列表对工具可见', async () => {
        let captured = '';
        const script: Array<Partial<HarnessAssistantTurn>> = [
            { reply: '好的，开始。' },
            { reply: '', tool: { name: 'list_projects', args: {} } },
            { reply: '完成。' },
        ];
        let phase = 0;
        const adapter: HarnessAdapter = {
            async complete(request) {
                phase++;
                if (phase >= 3) {
                    const toolTurns = request.turns.filter(t => t.role === 'tool');
                    captured = toolTurns[toolTurns.length - 1]?.text || '';
                    return { reply: '完成。' };
                }
                return { reply: '', ...script[phase - 1] } as HarnessAssistantTurn;
            },
        };
        const engine = new AgentHarnessEngine({ ctx: makeContext(), adapter, portDeps: { port: makePort(), ctx: makeContext() } });
        await engine.start();
        engine.updateContext({ projects: ['长篇/新界风云'], activeProject: '长篇/新界风云' });
        await engine.handle('看看项目');
        expect(captured).toContain('新界风云');
    });
});
