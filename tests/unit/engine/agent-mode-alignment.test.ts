import { describe, expect, it } from 'vitest';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import type { HarnessMemoryState, HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentContext, AgentProjectStatus, GuideAgentPort } from '../../../engine/agent/agent-types';
import { resolveCreationFlow, type CreationFlowFacts, type CreationFlowSnapshot, type CreationFlowStageStatus } from '../../../shared/creation-flow';

const SHORT_PROJECT = '短篇创作/测试短篇';

function stage(
    id: string,
    label: string,
    state: CreationFlowStageStatus['state'],
    extra: Partial<CreationFlowStageStatus> = {},
): CreationFlowStageStatus {
    return {
        id,
        label,
        description: '',
        action: 'wizard',
        weight: 0.3,
        ratio: state === 'done' ? 1 : 0,
        progressText: '',
        ctaLabel: '',
        primaryAction: 'wizard',
        state,
        ...extra,
    };
}

function flowFixture(
    mode: CreationFlowSnapshot['mode'],
    project: string,
    over: Partial<CreationFlowSnapshot> = {},
): CreationFlowSnapshot {
    return {
        mode,
        unitLabel: mode === 'long' ? '章' : mode === 'short' ? '节' : '集',
        project,
        stages: [
            stage('wizard', '初始化与全书规划', 'done'),
            stage('units', '单元写作', 'active'),
            stage('export', '导出成稿', 'todo'),
        ],
        overallRatio: 0.5,
        nextStageId: 'units',
        nextUnitNumber: 2,
        ...over,
    };
}

function shortStatus(project: string, over: Partial<AgentProjectStatus> = {}): AgentProjectStatus {
    return {
        project,
        mode: 'short',
        structureId: '',
        totalChapters: 2,
        plannedChapters: 2,
        writtenChapters: 1,
        skeletonChapters: 1,
        byStatus: { written: 1, pending: 1 },
        latestWrittenChapter: '第1节',
        nextChapterToWrite: '第2节',
        flow: flowFixture('short', project),
        ...over,
    };
}

function setup(overrides: Partial<GuideAgentPort> = {}, projects: string[] = [SHORT_PROJECT]) {
    const calls: string[] = [];
    const port: GuideAgentPort = {
        createProject: async () => ({ created: false, projectId: '', fileCount: 0 }),
        openWizard: async (project) => { calls.push(`wizard:${project}`); return true; },
        openFlow: async (project) => { calls.push(`flow:${project ?? ''}`); return true; },
        openStorySettings: (project) => { calls.push(`story:${project}`); return true; },
        openFullWriter: async () => true,
        openPreResearch: () => true,
        getProjectStatus: async (project) => shortStatus(project),
        runCommand: (commandId) => { calls.push(`run:${commandId}`); return true; },
        confirmDangerousAction: async () => true,
        ...overrides,
    };
    const ctx: AgentContext = { projects, activeProject: projects[0] };
    const memory: HarnessMemoryState = { slots: { pickedProject: SHORT_PROJECT } };
    const tools = createHostTools({ port, ctx, memory });
    const byName = (name: string): HarnessTool => {
        const tool = tools.find(item => item.name === name);
        if (!tool) throw new Error(`missing tool ${name}`);
        return tool;
    };
    return { calls, port, memory, byName };
}

const toolCtx = (memory: HarnessMemoryState) => ({ memory: memory as unknown as { slots: Readonly<Record<string, unknown>> } });

/** 用真实阶段引擎（shared/creation-flow）生成快照，而不是手写阶段数组 */
function realFlow(
    mode: CreationFlowSnapshot['mode'],
    project: string,
    facts: Partial<CreationFlowFacts> = {},
): CreationFlowSnapshot {
    return resolveCreationFlow(mode, project, {
        preResearchDone: false,
        docs: {},
        unitTotal: 0,
        unitTarget: 0,
        unitWritten: 0,
        nextUnitNumber: null,
        exportExists: false,
        ...facts,
    });
}

describe('Agent 工具的模式对齐', () => {
    it('open_wizard 在短篇项目下拒绝，并指向 open_flow', async () => {
        const { calls, memory, byName } = setup();
        const result = await byName('open_wizard').execute({}, toolCtx(memory));
        expect(result.ok).toBe(false);
        expect(result.content).toContain('短篇项目');
        expect(result.content).toContain('open_flow');
        expect(calls.some(call => call.startsWith('wizard:'))).toBe(false);
    });

    it('open_flow 三模式通用，直接打开创作流程', async () => {
        const { calls, memory, byName } = setup();
        const result = await byName('open_flow').execute({}, toolCtx(memory));
        expect(result.ok).toBe(true);
        expect(calls).toContain(`flow:${SHORT_PROJECT}`);
    });

    it('run_command 拒绝短篇项目下的长篇专属命令', async () => {
        const { calls, memory, byName } = setup();
        const result = await byName('run_command').execute(
            { commandId: 'novel-writer-plan-book' },
            toolCtx(memory),
        );
        expect(result.ok).toBe(false);
        expect(result.content).toContain('仅适用于长篇');
        expect(calls.some(call => call.startsWith('run:'))).toBe(false);
    });

    it('run_command 放行三模式通用命令（导出）', async () => {
        const { calls, memory, byName } = setup();
        const result = await byName('run_command').execute(
            { commandId: 'novel-writer-export-manuscript' },
            toolCtx(memory),
        );
        expect(result.ok).toBe(true);
        expect(calls).toContain('run:novel-writer-export-manuscript');
    });

    it('get_project_status 用「节」而不是「章」汇报短篇进度', async () => {
        const { memory, byName } = setup();
        const result = await byName('get_project_status').execute({}, toolCtx(memory));
        expect(result.ok).toBe(true);
        expect(result.content).toContain('规划 2 节');
        expect(result.content).toContain('已写 1 节');
        expect(result.content).toContain('最后一个已写节：第1节');
        expect(result.content).toContain('建议接下来写：第2节');
        expect(result.content).not.toContain('已写 1 章');
    });

    it('get_project_status 输出 flow 阶段进度与下一步（短篇）', async () => {
        const { memory, byName } = setup();
        const result = await byName('get_project_status').execute({}, toolCtx(memory));
        expect(result.ok).toBe(true);
        expect(result.content).toContain('阶段进度：50%');
        expect(result.content).toContain('下一步：单元写作');
        expect(result.content).toContain('阶段明细：✓初始化与全书规划 →单元写作 ○导出成稿');
        const data = result.data as unknown as AgentProjectStatus;
        expect(data.flow?.nextStageId).toBe('units');
        expect(data.flow?.stages).toHaveLength(3);
    });

    it('flow 阻塞阶段显示 blockedReason，且不把阻塞阶段当下一步', async () => {
        const blockedFlow = flowFixture('script', '剧本/测试剧本', {
            stages: [
                stage('wizard', '初始化与分集规划', 'done'),
                stage('units', '分集写作', 'blocked', { blockedReason: '缺少场景圣经' }),
                stage('export', '导出成稿', 'todo'),
            ],
            nextStageId: 'export',
        });
        const status = shortStatus('剧本/测试剧本', {
            mode: 'script',
            flow: blockedFlow,
        });
        const project = '剧本/测试剧本';
        const { memory, byName } = setup({ getProjectStatus: async () => status }, [project]);
        const result = await byName('get_project_status').execute({ project }, toolCtx(memory));
        expect(result.ok).toBe(true);
        expect(result.content).toContain('剧本');
        expect(result.content).toContain('当前阻塞：分集写作（缺少场景圣经）');
    });

    it('三模式 flow 的 unitLabel 与阶段标签按快照投影（不硬编码长篇八阶段）', async () => {
        for (const [mode, project, unitLabel] of [
            ['long', '长篇/测试长篇', '章'],
            ['short', '短篇创作/测试短篇', '节'],
            ['script', '剧本/测试剧本', '集'],
        ] as const) {
            const { memory, byName } = setup({
                getProjectStatus: async () => shortStatus(project, {
                    mode,
                    flow: flowFixture(mode, project),
                }),
            }, [project]);
            const result = await byName('get_project_status').execute({ project }, toolCtx(memory));
            expect(result.ok).toBe(true);
            expect(result.content).toContain(`规划 2 ${unitLabel}`);
            expect(result.content).toContain('阶段进度');
            expect(result.content).toContain('下一步：单元写作');
            expect(result.content).not.toContain('① 新建项目');
        }
    });
});

describe('B1 真实阶段快照回归（get_project_status ↔ resolveCreationFlow）', () => {
    const runStatus = async (project: string, status: AgentProjectStatus) => {
        const { memory, byName } = setup({ getProjectStatus: async () => status }, [project]);
        return byName('get_project_status').execute({ project }, toolCtx(memory));
    };

    it('长篇：真实四阶段、加权进度与依赖阻塞链', async () => {
        const project = '长篇小说/示例';
        const flow = realFlow('long', project, {
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            unitSettled: 4,
            nextUnitNumber: 6,
        });
        const result = await runStatus(project, shortStatus(project, { mode: 'long', flow }));

        expect(result.ok).toBe(true);
        expect(result.content).toContain('阶段进度：56%');
        expect(result.content).toContain('下一步：章节写作');
        expect(result.content).toContain('当前阻塞：成稿导出（先完成：章节写作）');
        expect(result.content).toContain('阶段明细：✓初始化与全书规划 →章节写作 →章节结算 !成稿导出');
        const data = result.data as unknown as AgentProjectStatus;
        expect(data.flow?.stages.map(item => item.id))
            .toEqual(['wizard', 'chapters', 'settlement', 'export']);
    });

    it('短篇：真实四阶段，下一步分节写作、导出被依赖阻塞', async () => {
        const project = '短篇小说/示例';
        const flow = realFlow('short', project, {
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitTarget: 20,
            nextUnitNumber: 1,
        });
        const result = await runStatus(project, shortStatus(project, { mode: 'short', flow }));

        expect(result.content).toContain('阶段进度：25%');
        expect(result.content).toContain('下一步：分节写作');
        expect(result.content).toContain('当前阻塞：导出成稿（先完成：分节写作）');
        expect(result.content).toContain('阶段明细：✓前期调研 ✓分节大纲 →分节写作 !导出成稿');
        expect(result.content).toContain('建议接下来写：第2节');
    });

    it('剧本：真实五阶段，分镜表未完成时停在分镜表；完成后进入分集写作', async () => {
        const project = '剧本/示例';
        const pending = realFlow('script', project, {
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 12,
            unitTarget: 12,
            nextUnitNumber: 1,
        });
        const result = await runStatus(project, shortStatus(project, { mode: 'script', flow: pending }));

        expect(result.content).toContain('阶段进度：20%');
        expect(result.content).toContain('下一步：分镜表');
        expect(result.content).toContain('阶段明细：✓前期调研 ✓分集大纲 →分镜表 ○分集写作 !导出成稿');
        const data = result.data as unknown as AgentProjectStatus;
        expect(data.flow?.stages.map(item => item.id))
            .toEqual(['research', 'outline', 'storyboard', 'units', 'export']);

        const storyboardDone = realFlow('script', project, {
            preResearchDone: true,
            docs: { outline: true, storyboard: true },
            unitTotal: 12,
            unitTarget: 12,
            nextUnitNumber: 1,
        });
        const next = await runStatus(project, shortStatus(project, { mode: 'script', flow: storyboardDone }));
        expect(next.content).toContain('阶段进度：30%');
        expect(next.content).toContain('下一步：分集写作');
    });

    it('旧端口未提供 flow：保留基础进度，不输出阶段行也不抛错', async () => {
        const project = '长篇/旧端口';
        const result = await runStatus(project, shortStatus(project, { mode: 'long', flow: undefined }));

        expect(result.ok).toBe(true);
        expect(result.content).not.toContain('阶段进度');
        expect(result.content).toContain('规划 2 章');
        const data = result.data as unknown as AgentProjectStatus;
        expect(data.flow).toBeUndefined();
    });
});
