/**
 * 阶段 C1 收口：`diagnose_flow` 工具真的被注册进引擎
 *
 * `diagnose-tools.test.ts` 测的是工具本身（判定、参数校验、只读语义），
 * 但**接线**此前没有任何测试：`AgentHarnessEngineOptions.flowDiagnosis`
 * 传进去之后，引擎的 registry 里到底有没有这个工具？
 *
 * 这条链路如果断了，用户问「我的设定为什么没进正文」，agent 只会说「不知道」，
 * 而代码里躺着一个从没被注册过的诊断工具——典型的「以为生效了但没生效」。
 *
 * 本文件锁：
 * 1. 提供采集器时，工具出现在 `getTools()` 里
 * 2. 不提供时**不出现**（不能让 agent 看到自己无法执行的工具）
 * 3. 工具经 registry 执行时走的是注入的采集器（端到端，不是只看名字）
 */

import { describe, expect, it } from 'vitest';
import { AgentHarnessEngine } from '../../../engine/agent/harness/harness-engine';
import { DIAGNOSE_FLOW_TOOL } from '../../../engine/agent/harness/diagnose-tools';
import type { FlowDiagnosisDeps } from '../../../engine/agent/harness/diagnose-tools';
import type { HarnessAdapter } from '../../../engine/agent/harness/harness-types';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

/** 上下文 */
function makeContext(): AgentContext {
    return { projects: ['长篇/九霄逆脉行'], activeProject: '长篇/九霄逆脉行' };
}

/** 最小 port（本文件不触发任何 port 动作） */
function makePort(): GuideAgentPort {
    const noop = async (): Promise<never> => { throw new Error('不该被调用'); };
    return {
        createProject: noop,
        openWizard: noop,
        openStorySettings: () => true,
        openFullWriter: () => true,
        openPreResearch: noop,
        runCommand: () => true,
        confirmDangerousAction: async () => true,
        openCoWriting: () => true,
    } as unknown as GuideAgentPort;
}

/** 不会被调用的适配器 */
function makeAdapter(): HarnessAdapter {
    return {
        call: async () => ({ content: '{"reply":"ok"}', finishReason: 'stop' }),
    } as unknown as HarnessAdapter;
}

/** 采集器：全部就绪 */
function makeDeps(): FlowDiagnosisDeps {
    return {
        collectKnowledge: async () => ({
            bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
            embeddingReady: true, storeLoadedBooks: 1, storeReady: true,
        }),
        collectStyle: async () => ({
            templateCount: 0, globalCount: 0, projectCount: 1,
            enabledCount: 1, intensityDisabledCount: 0, embeddingReady: true,
        }),
        collectConstraint: async () => ({
            sourceCount: 1, settingExists: true, reviewStatus: 'approved' as const,
            bound: true, rulesHasContent: true,
        }),
    };
}

/** 造引擎 */
function makeEngine(flowDiagnosis?: FlowDiagnosisDeps): AgentHarnessEngine {
    const ctx = makeContext();
    return new AgentHarnessEngine({
        ctx,
        adapter: makeAdapter(),
        portDeps: { port: makePort(), ctx },
        ...(flowDiagnosis ? { flowDiagnosis } : {}),
    });
}

describe('C1 接线：diagnose_flow 注册', () => {
    it('提供采集器时工具出现在工具列表里', () => {
        const engine = makeEngine(makeDeps());
        const names = engine.getTools().map(t => t.name);
        expect(names).toContain(DIAGNOSE_FLOW_TOOL);
    });

    it('不提供采集器时不注册（agent 看不到无法执行的工具）', () => {
        const engine = makeEngine();
        const names = engine.getTools().map(t => t.name);
        expect(names).not.toContain(DIAGNOSE_FLOW_TOOL);
    });

    it('注册后工具描述会进系统提示（agent 知道它存在）', () => {
        const engine = makeEngine(makeDeps());
        const tool = engine.getTools().find(t => t.name === DIAGNOSE_FLOW_TOOL);
        expect(tool).toBeTruthy();
        expect(tool!.description.length).toBeGreaterThan(10);
        // 描述里应说明用途（诊断链路为什么没生效）
        expect(tool!.description).toContain('诊断');
    });

    it('工具经 registry 执行时使用注入的采集器（端到端）', async () => {
        let knowledgeCalled = 0;
        const deps = makeDeps();
        deps.collectKnowledge = async () => {
            knowledgeCalled += 1;
            return {
                bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
                embeddingReady: true, storeLoadedBooks: 1, storeReady: true,
            };
        };
        const engine = makeEngine(deps);
        const ctx = makeContext();
        const result = await engine['registry'].execute(
            DIAGNOSE_FLOW_TOOL,
            { flow: 'knowledge' },
            { ctx, memory: { slots: {} } } as never,
        );
        expect(result.ok).toBe(true);
        expect(knowledgeCalled).toBe(1);
        expect(result.content).toContain('知识流');
    });

    it('不提供采集器时执行该工具返回失败（不是静默成功）', async () => {
        const engine = makeEngine();
        const ctx = makeContext();
        const result = await engine['registry'].execute(
            DIAGNOSE_FLOW_TOOL,
            { flow: 'knowledge' },
            { ctx, memory: { slots: {} } } as never,
        );
        expect(result.ok).toBe(false);
    });
});
