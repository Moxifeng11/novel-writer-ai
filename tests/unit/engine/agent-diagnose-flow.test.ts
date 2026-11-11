/**
 * 阶段 C1：agent 链路自诊断工具
 *
 * 长期目标阶段 C：agent 要能回答「**我的设定为什么没进正文**」并定位到具体环节。
 *
 * 关键设计：判定逻辑复用 `shared/link-status-compute`，
 * 所以 **agent 诊断出的断点** 与 **界面看到的断点** 永远一致——
 * 否则用户和 agent 会各说各话（用户：「界面说断了」，agent：「一切正常」）。
 *
 * 本文件锁：
 * 1. 工具对三种链路 + all 都能给出断点
 * 2. 采集失败时如实报错（不假装「链路没问题」）
 * 3. 非法参数被拒绝
 * 4. 工具是只读的（sideEffect: none，可重复调用）
 */

import { describe, expect, it, vi } from 'vitest';
import {
    createDiagnoseTools,
    DIAGNOSE_FLOW_TOOL,
    type FlowDiagnosisDeps,
} from '../../../engine/agent/harness/diagnose-tools';
import type { HarnessToolContext } from '../../../engine/agent/harness/harness-types';

/** 空上下文 */
const CTX = { memory: { slots: {} } } as unknown as HarnessToolContext;

/** 构造采集器：默认全就绪 */
function makeDeps(overrides: Partial<FlowDiagnosisDeps> = {}): FlowDiagnosisDeps {
    return {
        collectKnowledge: async () => ({
            bookTotal: 1,
            breakdownCompleted: 1,
            vectorDone: 1,
            vectorFailed: 0,
            embeddingReady: true,
            storeLoadedBooks: 1,
            storeReady: true,
        }),
        collectStyle: async () => ({
            templateCount: 0,
            globalCount: 0,
            projectCount: 1,
            enabledCount: 1,
            intensityDisabledCount: 0,
            embeddingReady: true,
        }),
        collectConstraint: async () => ({
            sourceCount: 2,
            settingExists: true,
            reviewStatus: 'approved' as const,
            bound: true,
            rulesHasContent: true,
        }),
        ...overrides,
    };
}

/** 取工具 */
function tool(deps: FlowDiagnosisDeps) {
    const tools = createDiagnoseTools(deps);
    expect(tools).toHaveLength(1);
    return tools[0];
}

describe('C1：diagnose_flow 工具', () => {
    it('工具名与只读语义', () => {
        const t = tool(makeDeps());
        expect(t.name).toBe(DIAGNOSE_FLOW_TOOL);
        expect(t.sideEffect).toBe('none');
        expect(t.required).toEqual(['flow']);
    });

    it('知识流：全部就绪时报告已通', async () => {
        const result = await tool(makeDeps()).execute({ flow: 'knowledge' }, CTX);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('知识流');
        expect(result.content).toContain('已通');
    });

    it('知识流：断在向量化时明确指出断点', async () => {
        const deps = makeDeps({
            collectKnowledge: async () => ({
                bookTotal: 2,
                breakdownCompleted: 2,
                vectorDone: 0,
                vectorFailed: 2,
                embeddingReady: false,
                storeLoadedBooks: 0,
                storeReady: true,
            }),
        });
        const result = await tool(deps).execute({ flow: 'knowledge' }, CTX);
        expect(result.content).toContain('断在「向量化」');
        expect(result.content).toContain('修好这一环');
    });

    it('风格流：全部未启用时断在启用', async () => {
        const deps = makeDeps({
            collectStyle: async () => ({
                templateCount: 0,
                globalCount: 1,
                projectCount: 1,
                enabledCount: 0,
                intensityDisabledCount: 0,
                embeddingReady: true,
            }),
        });
        const result = await tool(deps).execute({ flow: 'style' }, CTX);
        expect(result.content).toContain('断在「启用」');
    });

    it('约束流：待审核时断在审核', async () => {
        const deps = makeDeps({
            collectConstraint: async () => ({
                sourceCount: 1,
                settingExists: true,
                reviewStatus: 'pending' as const,
                bound: false,
                rulesHasContent: true,
            }),
        });
        const result = await tool(deps).execute({ flow: 'constraint' }, CTX);
        expect(result.content).toContain('断在「审核」');
    });

    it('all：汇总三条链路并列出所有断点', async () => {
        const deps = makeDeps({
            collectStyle: async () => ({
                templateCount: 0, globalCount: 0, projectCount: 1,
                enabledCount: 0, intensityDisabledCount: 0, embeddingReady: true,
            }),
            collectConstraint: async () => ({
                sourceCount: 0, settingExists: true, reviewStatus: 'pending' as const,
                bound: false, rulesHasContent: false,
            }),
        });
        const result = await tool(deps).execute({ flow: 'all' }, CTX);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('发现 2 条链路有断点');
        expect(result.content).toContain('风格流断在「启用」');
        expect(result.content).toContain('约束流断在「审核」');
    });

    it('all：三条都通时不虚构断点', async () => {
        const result = await tool(makeDeps()).execute({ flow: 'all' }, CTX);
        expect(result.content).toContain('三条链路都没有断点');
    });

    it('采集抛错时如实报错（不假装链路正常）', async () => {
        const deps = makeDeps({
            collectKnowledge: async () => { throw new Error('知识库未初始化'); },
        });
        const result = await tool(deps).execute({ flow: 'knowledge' }, CTX);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('诊断失败');
        expect(result.content).toContain('知识库未初始化');
    });

    it('非法 flow 参数被拒绝', async () => {
        const result = await tool(makeDeps()).execute({ flow: 'nope' }, CTX);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('flow 必须是');
    });

    it('缺 flow 参数也被拒绝（不默认成 all）', async () => {
        const result = await tool(makeDeps()).execute({}, CTX);
        expect(result.ok).toBe(false);
    });

    it('重复调用结果一致（只读工具可重入）', async () => {
        const deps = makeDeps();
        const t = tool(deps);
        const a = await t.execute({ flow: 'knowledge' }, CTX);
        const b = await t.execute({ flow: 'knowledge' }, CTX);
        expect(a.content).toBe(b.content);
    });

    it('返回结构化 data 供 UI 使用', async () => {
        const result = await tool(makeDeps()).execute({ flow: 'style' }, CTX);
        expect(result.data?.status).toBeTruthy();
    });
});

describe('C1：与界面口径一致', () => {
    it('agent 与界面用同一个 compute（断点必然一致）', async () => {
        // 同一份输入，界面 compute 与 agent 工具给出的断点必须相同
        const { computeKnowledgeFlowStatus } = await import('../../../shared/link-status-compute');
        const input = {
            bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
            embeddingReady: true, storeLoadedBooks: 0, storeReady: true,
        };
        const uiStatus = computeKnowledgeFlowStatus(input);
        const deps = makeDeps({ collectKnowledge: async () => input });
        const result = await tool(deps).execute({ flow: 'knowledge' }, CTX);
        expect(uiStatus.breakpoint).toBe('检索');
        expect(result.content).toContain('断在「检索」');
    });
});
