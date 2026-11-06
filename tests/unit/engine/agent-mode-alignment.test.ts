import { describe, expect, it } from 'vitest';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import type { HarnessMemoryState, HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentContext, AgentProjectStatus, GuideAgentPort } from '../../../engine/agent/agent-types';
import type { CreationFlowSnapshot, CreationFlowStageStatus } from '../../../shared/creation-flow';

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
