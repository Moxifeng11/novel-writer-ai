/**
 * agent-repair-wiring.test.ts — 阶段 E 接线：`repair_flow` 真的被注册且有审批兜底
 *
 * `harness-repair-tools.test.ts` 测工具本身；本文件测「引擎这一层」：
 * 1. 只给 flowDiagnosis 不给 flowRepair → 不注册（agent 看不到自己执行不了的修复工具）
 * 2. 两样都给 → 注册，且 `sideEffect: write`
 * 3. 没有 requestApproval、port 也没有 confirmDangerousAction → 执行被 fail-closed 拒绝
 * 4. port 提供 confirmDangerousAction → 弹窗决定，批准后修复真的执行
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import { REPAIR_FLOW_TOOL } from '../../../engine/agent/harness/repair-tools';
import type { FlowDiagnosisDeps } from '../../../engine/agent/harness/diagnose-tools';
import type { HarnessAdapter, HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

function makeContext(): AgentContext {
    return { projects: ['长篇/九霄逆脉行'], activeProject: '长篇/九霄逆脉行' };
}

function makePort(confirm?: (request: unknown) => Promise<boolean>): GuideAgentPort {
    const noop = async (): Promise<never> => { throw new Error('不该被调用'); };
    return {
        createProject: noop,
        openWizard: noop,
        openStorySettings: () => true,
        openFullWriter: () => true,
        openPreResearch: noop,
        runCommand: () => true,
        ...(confirm ? { confirmDangerousAction: confirm } : {}),
        openCoWriting: () => true,
    } as unknown as GuideAgentPort;
}

function makeAdapter(): HarnessAdapter {
    return { call: async () => ({ content: '{"reply":"ok"}', finishReason: 'stop' }) } as unknown as HarnessAdapter;
}

function makeDiagnose(): FlowDiagnosisDeps {
    return {
        collectKnowledge: async () => ({
            bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
            embeddingReady: true, storeLoadedBooks: 1, storeReady: true,
        }),
        collectStyle: async () => ({
            templateCount: 1, globalCount: 1, projectCount: 1,
            enabledCount: 2, intensityDisabledCount: 0, embeddingReady: true,
        }),
        collectConstraint: async () => ({
            sourceCount: 1, settingExists: true, reviewStatus: 'approved' as const,
            bound: true, rulesHasContent: true,
        }),
    };
}

interface EngineWithRegistry {
    getTools(): Array<{ name: string }>;
    /** 测试直达内部注册表执行（绕过模型回合） */
    registry: { execute(name: string, args: Record<string, unknown>, ctx: unknown): Promise<{ ok: boolean; content: string }> };
}

function makeEngine(options: {
    withDiagnose?: boolean;
    withRepair?: boolean;
    confirm?: (request: unknown) => Promise<boolean>;
    revectorizeBook?: (id: string) => Promise<{ ok: boolean; detail?: string }>;
}): AgentHarnessEngine {
    const ctx = makeContext();
    return new AgentHarnessEngine({
        ctx,
        adapter: makeAdapter(),
        portDeps: { port: makePort(options.confirm), ctx },
        ...(options.withDiagnose === false ? {} : { flowDiagnosis: makeDiagnose() }),
        ...(options.withRepair === false ? {} : {
            flowRepair: {
                revectorizeBook: options.revectorizeBook ?? (async () => ({ ok: true })),
                reloadFingerprints: async () => ({ template: 1, global: 1, project: 1 }),
            },
        }),
    });
}

function names(engine: AgentHarnessEngine): string[] {
    return engine.getTools().map(t => t.name);
}

/** 通过 registry 取到工具定义（执行路径与真实回合一致） */
function registeredTool(engine: AgentHarnessEngine, name: string): HarnessTool {
    const registry = (engine as unknown as { registry: { tools?: Map<string, HarnessTool>; get?: (n: string) => HarnessTool } }).registry;
    const map = (registry as unknown as { tools: Map<string, HarnessTool> }).tools;
    const tool = map?.get(name);
    if (!tool) throw new Error(`工具未注册：${name}；已注册 ${names(engine).join(', ')}`);
    return tool;
}


describe('修复遥测（阶段 E 深化③）：回合结束后 repairs 有记录', () => {
    function scripted(turns: Array<{ tool?: { name: string; args: Record<string, unknown> }; reply?: string }>) {
        let index = 0;
        return {
            complete: async () => {
                const turn = turns[Math.min(index, turns.length - 1)];
                index += 1;
                return turn;
            },
        } as never;
    }

    it('agent 调用 repair_flow 成功 → telemetry.repairs 记录 action/ok，诊断调用不污染', async () => {
        const ctx = makeContext();
        const engine = new AgentHarnessEngine({
            ctx,
            adapter: scripted([
                { tool: { name: 'repair_flow', args: { action: 'reload_fingerprints' } } },
                { reply: '修好了' },
            ]),
            portDeps: { port: makePort(async () => true) as never, ctx },
            flowDiagnosis: makeDiagnose(),
            flowRepair: {
                revectorizeBook: async () => ({ ok: true }),
                reloadFingerprints: async () => ({ template: 1, global: 1, project: 1 }),
            },
            maxSteps: 4,
        });
        await engine.handle('帮我修一下指纹库');
        const telemetry = engine.getTelemetry();
        expect(telemetry.repairs).toHaveLength(1);
        expect(telemetry.repairs[0]).toMatchObject({ action: 'reload_fingerprints', ok: true });
        expect(telemetry.repairs[0].summary).toContain('已重载指纹库');
    });

    it('失败修复也记入遥测（ok:false），不谎报成功', async () => {
        const ctx = makeContext();
        const engine = new AgentHarnessEngine({
            ctx,
            adapter: scripted([
                { tool: { name: 'repair_flow', args: { action: 'revectorize_book', bookId: 'kb_missing' } } },
                { reply: '没修成' },
            ]),
            portDeps: { port: makePort(async () => true) as never, ctx },
            flowDiagnosis: makeDiagnose(),
            flowRepair: {
                revectorizeBook: async () => ({ ok: false, detail: '书不存在' }),
                reloadFingerprints: async () => ({ template: 0, global: 0, project: 0 }),
            },
            maxSteps: 4,
        });
        await engine.handle('修一下这本书');
        const telemetry = engine.getTelemetry();
        expect(telemetry.repairs).toHaveLength(1);
        expect(telemetry.repairs[0]).toMatchObject({ action: 'revectorize_book', ok: false });
    });
});

describe('E 接线：repair_flow 注册与审批兜底', () => {
    it('只提供诊断采集器时不注册修复工具', () => {
        const engine = makeEngine({ withRepair: false });
        expect(names(engine)).toContain('diagnose_flow');
        expect(names(engine)).not.toContain(REPAIR_FLOW_TOOL);
    });

    it('提供 flowRepair 后注册，且声明为写操作', () => {
        const engine = makeEngine({});
        expect(names(engine)).toContain(REPAIR_FLOW_TOOL);
        expect(registeredTool(engine, REPAIR_FLOW_TOOL).sideEffect).toBe('write');
    });

    it('没有审批能力（无 requestApproval、port 无 confirmDangerousAction）→ fail-closed 拒绝', async () => {
        const revectorizeBook = vi.fn(async () => ({ ok: true }));
        const engine = makeEngine({ revectorizeBook });
        const tool = registeredTool(engine, REPAIR_FLOW_TOOL);
        const result = await tool.execute({ action: 'revectorize_book', bookId: 'kb_a' }, { memory: { slots: {} } });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('fail-closed');
        expect(revectorizeBook).not.toHaveBeenCalled();
    });

    it('port 的 confirmDangerousAction 拒绝 → 不执行修复', async () => {
        const revectorizeBook = vi.fn(async () => ({ ok: true }));
        const confirm = vi.fn(async () => false);
        const engine = makeEngine({ confirm, revectorizeBook });
        const tool = registeredTool(engine, REPAIR_FLOW_TOOL);
        const result = await tool.execute({ action: 'revectorize_book', bookId: 'kb_a' }, { memory: { slots: {} } });
        expect(result.ok).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(revectorizeBook).not.toHaveBeenCalled();
    });

    it('port 的 confirmDangerousAction 批准 → 修复执行并复诊', async () => {
        const revectorizeBook = vi.fn(async () => ({ ok: true, detail: '16 段' }));
        const confirm = vi.fn(async () => true);
        const engine = makeEngine({ confirm, revectorizeBook });
        const tool = registeredTool(engine, REPAIR_FLOW_TOOL);
        const result = await tool.execute({ action: 'revectorize_book', bookId: 'kb_a' }, { memory: { slots: {} } });
        expect(result.ok).toBe(true);
        expect(revectorizeBook).toHaveBeenCalledWith('kb_a');
        expect(result.content).toContain('修复后链路状态');
    });
});
