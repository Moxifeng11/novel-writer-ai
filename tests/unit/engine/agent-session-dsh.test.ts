import { describe, expect, it, vi } from 'vitest';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import { HarnessToolRegistry } from '../../../engine/agent/harness/tool-registry';
import { runHarnessTurn } from '../../../engine/agent/harness/agent-loop';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import { createCallAIAdapter } from '../../../engine/agent/harness/agent-adapter';
import {
    buildSessionSnapshot,
    parseSessionSnapshot,
    parseSnapshotFromJsonl,
    sessionTitleOf,
} from '../../../engine/agent/harness/session-snapshot';
import {
    DEFAULT_SPILL_POLICY,
    buildSpillBody,
    buildSpillReplacement,
    shouldSpill,
} from '../../../engine/agent/harness/spill-store';
import type {
    HarnessAdapter,
    HarnessAssistantTurn,
    HarnessMemoryState,
    HarnessTool,
} from '../../../engine/agent/harness/harness-types';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

const CTX: AgentContext = { projects: [], activeProject: null };

function makePort(extra: Partial<GuideAgentPort> = {}): GuideAgentPort {
    return {
        createProject: async () => ({ created: true, projectId: '长篇/测试', fileCount: 1 }),
        openWizard: async () => true,
        openStorySettings: () => true,
        openFullWriter: () => true,
        openPreResearch: () => true,
        ...extra,
    };
}

function scriptedAdapter(turns: HarnessAssistantTurn[]): HarnessAdapter {
    let index = 0;
    return {
        async complete() {
            const turn = turns[Math.min(index, turns.length - 1)];
            index++;
            return turn;
        },
    };
}

function memoryState(): HarnessMemoryState {
    return { slots: {} };
}

// ============================================================
// 会话快照（dsh session-persistence-jsonl）
// ============================================================

describe('session-snapshot — 会话快照序列化', () => {
    it('标题取首条真实用户消息前 30 字，跳过会话开始占位', () => {
        const events = [
            { type: 'user_message' as const, text: '（会话开始。用户有 2 个项目。）' },
            { type: 'assistant_message' as const, text: '你好' },
            { type: 'user_message' as const, text: '帮我写一部关于断刃城的长篇小说，主角是守将武昭，需要一个复仇线' },
        ];
        const title = sessionTitleOf(events);
        expect(title.length).toBeLessThanOrEqual(31);
        expect(title.startsWith('帮我写一部关于断刃城')).toBe(true);
    });

    it('没有用户消息时标题为「新会话」', () => {
        expect(sessionTitleOf([])).toBe('新会话');
        expect(sessionTitleOf([{ type: 'system_message', text: 'x' }])).toBe('新会话');
    });

    it('快照包含事件/记忆/计划，可无损往返', () => {
        const events = [{ type: 'user_message' as const, text: '新建长篇' }];
        const snapshot = buildSessionSnapshot({
            events,
            callSeq: 2,
            memory: { projectName: '断刃城' },
            plan: [{ step: '写第1章', status: 'in_progress' }],
            now: 1234,
        });
        expect(snapshot.title).toBe('新建长篇');
        expect(snapshot.updatedAt).toBe(1234);
        const parsed = parseSessionSnapshot(JSON.stringify(snapshot));
        expect(parsed?.events).toEqual(events);
        expect(parsed?.memory).toEqual({ projectName: '断刃城' });
        expect(parsed?.plan).toEqual([{ step: '写第1章', status: 'in_progress' }]);
        expect(parsed?.callSeq).toBe(2);
    });

    it('坏 JSON / 未来版本返回 null，不抛异常', () => {
        expect(parseSessionSnapshot('{坏')).toBeNull();
        expect(parseSessionSnapshot('')).toBeNull();
        expect(parseSessionSnapshot(JSON.stringify({ version: 99, events: [] }))).toBeNull();
    });

    it('非法事件与非法计划步骤被丢弃，callSeq 按 callId 反推', () => {
        const text = JSON.stringify({
            version: 1,
            events: [
                { type: 'user_message', text: 'hi' },
                { type: 'unknown_type', text: 'drop me' },
                { type: 'tool_call', callId: 'call_7_read_file', tool: 'read_file', args: {} },
            ],
            plan: [{ step: '', status: 'done' }, { step: '写第2章', status: 'bogus' }],
        });
        const parsed = parseSessionSnapshot(text);
        expect(parsed?.events).toHaveLength(2);
        expect(parsed?.plan).toEqual([{ step: '写第2章', status: 'pending' }]);
        expect(parsed?.callSeq).toBe(7);
    });

    it('JSONL 取最后一条可解析的快照', () => {
        const first = JSON.stringify(buildSessionSnapshot({ events: [{ type: 'user_message', text: '旧' }], callSeq: 1, memory: {}, plan: [] }));
        const second = JSON.stringify(buildSessionSnapshot({ events: [{ type: 'user_message', text: '新' }], callSeq: 2, memory: {}, plan: [] }));
        const content = `${first}\n{坏行\n${second}\n`;
        const restored = parseSnapshotFromJsonl(content)?.events[0];
        expect(restored && 'text' in restored ? restored.text : '').toBe('新');
        expect(parseSnapshotFromJsonl('')).toBeNull();
    });
});

// ============================================================
// spill（大结果落盘）
// ============================================================

describe('spill-store — 大结果落盘策略', () => {
    const big = '甲'.repeat(DEFAULT_SPILL_POLICY.thresholdChars + 100);

    it('阈值判定', () => {
        expect(shouldSpill('短结果')).toBe(false);
        expect(shouldSpill(big)).toBe(true);
        expect(shouldSpill(big, { ...DEFAULT_SPILL_POLICY, thresholdChars: 10 })).toBe(true);
    });

    it('替代文本包含定位符与头尾摘要，且显著短于原文', () => {
        const replacement = buildSpillReplacement(big, '.sessions/spill/agent/项目/read_file-call_1.md');
        expect(replacement).toContain('.sessions/spill/agent/项目/read_file-call_1.md');
        expect(replacement).toContain('read_file');
        expect(replacement).toContain('开头');
        expect(replacement).toContain('结尾');
        expect(replacement.length).toBeLessThan(big.length / 2);
    });

    it('存档正文带来源头', () => {
        const body = buildSpillBody('search_vault', big, new Date(2026, 9, 27, 14, 3, 0));
        expect(body).toContain('# 工具结果存档：search_vault');
        expect(body).toContain('2026-10-27 14:03:00');
        expect(body.endsWith(big)).toBe(true);
    });
});

// ============================================================
// 宿主工具：read_file / search_vault
// ============================================================

describe('host-tools — read_file / search_vault', () => {
    function toolOf(port: GuideAgentPort, name: string): HarnessTool {
        const tools = createHostTools({ port, ctx: CTX, memory: memoryState() });
        const tool = tools.find(item => item.name === name);
        if (!tool) throw new Error(`缺少工具 ${name}`);
        return tool;
    }

    it('read_file 渲染行范围与续读提示', async () => {
        const port = makePort({
            readFile: async (path, options) => ({
                path,
                content: '第二行\n第三行',
                startLine: options?.offset ?? 1,
                endLine: 3,
                totalLines: 10,
                truncated: true,
                size: 100,
            }),
        });
        const result = await toolOf(port, 'read_file').execute(
            { path: '项目/正文/第1章.md', offset: 2, limit: 2 },
            { memory: { slots: {} } },
        );
        expect(result.ok).toBe(true);
        expect(result.content).toContain('第 2-3 行，共 10 行');
        expect(result.content).toContain('offset=4');
    });

    it('read_file 文件不存在时提示先确认路径而不是臆造', async () => {
        const result = await toolOf(makePort({ readFile: async () => null }), 'read_file')
            .execute({ path: '不存在的.md' }, { memory: { slots: {} } });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('search_vault');
    });

    it('read_file 端口抛错时由注册表转成失败文本', async () => {
        const registry = new HarnessToolRegistry();
        registry.register(toolOf(makePort({
            readFile: async () => { throw new Error('路径不允许包含 ..'); },
        }), 'read_file'));
        const result = await registry.execute('read_file', { path: '../x.md' }, { memory: { slots: {} } });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('路径不允许包含');
    });

    it('search_vault 输出 path:line:摘要，空命中给替代建议', async () => {
        const port = makePort({
            searchVault: async (query) => query === '武昭'
                ? [{ path: '项目/设定/武昭.md', line: 12, text: '断刃城守将' }]
                : [],
        });
        const hit = await toolOf(port, 'search_vault').execute({ query: '武昭' }, { memory: { slots: {} } });
        expect(hit.ok).toBe(true);
        expect(hit.content).toContain('项目/设定/武昭.md:12: 断刃城守将');

        const miss = await toolOf(port, 'search_vault').execute({ query: '不存在' }, { memory: { slots: {} } });
        expect(miss.ok).toBe(true);
        expect(miss.content).toContain('没有找到');
    });

    it('端口缺失时明确不支持，不静默成功', async () => {
        const read = await toolOf(makePort(), 'read_file').execute({ path: 'a.md' }, { memory: { slots: {} } });
        expect(read.ok).toBe(false);
        expect(read.content).toContain('不支持');
        const search = await toolOf(makePort(), 'search_vault').execute({ query: 'x' }, { memory: { slots: {} } });
        expect(search.ok).toBe(false);
    });
});

// ============================================================
// 引擎：时间上下文 / 会话落盘 / 恢复
// ============================================================

describe('AgentHarnessEngine — 时间上下文与会话持久化', () => {
    const fixedNow = () => new Date(2026, 9, 27, 14, 3, 0);

    function makeEngine(adapter: HarnessAdapter, extra: { onSessionChange?: (snapshot: ReturnType<AgentHarnessEngine['serialize']>) => void } = {}) {
        return new AgentHarnessEngine({
            ctx: CTX,
            adapter,
            portDeps: { port: makePort(), ctx: CTX },
            now: fixedNow,
            onSessionChange: extra.onSessionChange,
        });
    }

    it('同一分钟内多轮只注入一条时间上下文', async () => {
        const engine = makeEngine(scriptedAdapter([{ reply: '收到' }]));
        await engine.handle('第一句');
        await engine.handle('第二句');
        const snapshot = engine.serialize();
        const timeEvents = snapshot.events.filter(event => event.type === 'context_message');
        expect(timeEvents).toHaveLength(1);
        expect(timeEvents[0].text).toContain('2026-10-27 14:03（周二）');
    });

    it('回合结束把快照交给宿主，标题来自首条用户消息', async () => {
        const snapshots: Array<{ title: string; events: number }> = [];
        const engine = makeEngine(scriptedAdapter([{ reply: '收到' }]), {
            onSessionChange: (snapshot) => snapshots.push({ title: snapshot.title, events: snapshot.events.length }),
        });
        await engine.handle('帮我规划第一章的开头');
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].title).toBe('帮我规划第一章的开头');
        expect(snapshots[0].events).toBeGreaterThan(0);
        expect(engine.getSessionTitle()).toBe('帮我规划第一章的开头');
    });

    it('恢复存档：历史、记忆、计划、是否恢复标记一致', async () => {
        const first = makeEngine(scriptedAdapter([{ reply: '已经记下项目名' }]));
        await first.handle('项目名叫断刃城');
        first.getSlots();
        const snapshot = first.serialize();
        snapshot.memory = { projectName: '断刃城' };
        snapshot.plan = [{ step: '写第1章', status: 'pending' }];

        const second = makeEngine(scriptedAdapter([{ reply: '继续' }]));
        second.restore(snapshot);
        expect(second.isRestored).toBe(true);
        expect(second.getSlots().projectName).toBe('断刃城');
        expect(second.getPlan()).toEqual([{ step: '写第1章', status: 'pending' }]);
        const history = second.getHistory();
        expect(history.some(item => item.role === 'user' && item.text.includes('断刃城'))).toBe(true);
        expect(history.some(item => item.role === 'agent' && item.text.includes('已经记下'))).toBe(true);
        // 时间上下文不进回填气泡
        expect(history.some(item => item.text.startsWith('【当前时间】'))).toBe(false);
    });

    it('恢复后继续对话不丢历史（callId 从存档接续）', async () => {
        const first = makeEngine(scriptedAdapter([{ reply: '好的' }]));
        await first.handle('第一轮');
        const snapshot = first.serialize();

        const second = makeEngine(scriptedAdapter([{ reply: '第二轮回复' }]));
        second.restore(snapshot);
        await second.handle('第二轮');
        const events = second.serialize().events;
        const userTexts = events.filter(event => event.type === 'user_message').map(event => event.text);
        expect(userTexts).toContain('第一轮');
        expect(userTexts).toContain('第二轮');
    });
});

describe('agent-loop — spill 落盘接入', () => {
    it('超阈值工具结果写盘，日志留定位符并计入统计', async () => {
        const registry = new HarnessToolRegistry();
        const big = '结果正文'.repeat(2000);
        registry.register({
            name: 'big_tool',
            description: '返回超长结果',
            parameters: {},
            required: [],
            sideEffect: 'none',
            execute: async () => ({ ok: true, content: big }),
        });
        const log = new AgentSessionLog();
        const writes: Array<{ name: string; length: number }> = [];
        const result = await runHarnessTurn({
            adapter: scriptedAdapter([
                { reply: '', tool: { name: 'big_tool', args: {} } },
                { reply: '读完了' },
            ]),
            registry,
            log,
            memory: memoryState(),
            projects: [],
            activeProject: null,
            spill: {
                write: async (name, content) => {
                    writes.push({ name, length: content.length });
                    return `.sessions/spill/agent/测试/${name}.md`;
                },
            },
        });
        expect(writes).toHaveLength(1);
        expect(result.spilledResults).toBe(1);
        expect(result.spilledChars).toBeGreaterThan(0);
        const toolTurn = log.derive().find(turn => turn.role === 'tool');
        expect(toolTurn?.text).toContain('.sessions/spill/agent/测试/');
        expect(toolTurn?.text.length).toBeLessThan(big.length / 3);
    });

    it('写盘失败时保留原文，不丢结果', async () => {
        const registry = new HarnessToolRegistry();
        const big = '原文'.repeat(4000);
        registry.register({
            name: 'big_tool',
            description: '返回超长结果',
            parameters: {},
            required: [],
            sideEffect: 'none',
            execute: async () => ({ ok: true, content: big }),
        });
        const log = new AgentSessionLog();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = await runHarnessTurn({
            adapter: scriptedAdapter([
                { reply: '', tool: { name: 'big_tool', args: {} } },
                { reply: '完成' },
            ]),
            registry,
            log,
            memory: memoryState(),
            projects: [],
            activeProject: null,
            spill: { write: async () => null },
        });
        warn.mockRestore();
        expect(result.spilledResults).toBe(0);
        expect(log.derive().find(turn => turn.role === 'tool')?.text).toContain('原文原文');
    });
});

describe('agent-adapter — 兼容性回归（新增工具不影响协议）', () => {
    it('文本回复走 parseAssistantTurn 正常收尾', async () => {
        const adapter = createCallAIAdapter(async () => ({ content: '{"reply":"好的"}' }));
        const log = new AgentSessionLog();
        const result = await runHarnessTurn({
            adapter,
            registry: new HarnessToolRegistry(),
            log,
            memory: memoryState(),
            projects: [],
            activeProject: null,
        });
        expect(result.reply).toBe('好的');
    });
});