import { describe, expect, it } from 'vitest';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import type { HarnessMemoryState, HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentContext, AgentProjectStatus, GuideAgentPort } from '../../../engine/agent/agent-types';

const SHORT_PROJECT = '短篇创作/测试短篇';

function shortStatus(project: string): AgentProjectStatus {
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
    };
}

function setup(overrides: Partial<GuideAgentPort> = {}) {
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
    const ctx: AgentContext = { projects: [SHORT_PROJECT], activeProject: SHORT_PROJECT };
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
});
