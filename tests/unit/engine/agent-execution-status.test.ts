import { describe, expect, it } from 'vitest';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import type { HarnessTool } from '../../../engine/agent/harness/harness-types';
import type { AgentCommandRunRecord, AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

const CTX: AgentContext = { projects: ['长篇小说/断刃城'], activeProject: '长篇小说/断刃城' };

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

function toolOf(port: GuideAgentPort, name: string): HarnessTool {
    const tool = createHostTools({ port, ctx: CTX, memory: { slots: {} } }).find(item => item.name === name);
    if (!tool) throw new Error(`缺少工具 ${name}`);
    return tool;
}

function record(overrides: Partial<AgentCommandRunRecord> = {}): AgentCommandRunRecord {
    return {
        commandId: 'novel-writer-chapter-settlement',
        label: '第3章 结算',
        project: '长篇小说/断刃城',
        source: 'ui',
        status: 'done',
        startedAt: 1_000,
        finishedAt: 4_000,
        ...overrides,
    };
}

describe('host-tools — get_execution_status', () => {
    it('端口缺失时明确不支持', async () => {
        const result = await toolOf(makePort(), 'get_execution_status').execute({}, { memory: { slots: {} } });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('不支持');
    });

    it('没有记录时给出可继续的说明，而不是报错', async () => {
        const result = await toolOf(makePort({ getExecutionLedger: () => [] }), 'get_execution_status')
            .execute({}, { memory: { slots: {} } });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('还没有长流程执行记录');
    });

    it('渲染状态/耗时/结算回写量与伏笔闭环', async () => {
        const port = makePort({
            getExecutionLedger: () => [record({
                settlement: {
                    updated: 9,
                    created: 2,
                    updatedForeshadows: 1,
                    rejected: 1,
                    missingEntities: 2,
                    linkFieldWrites: 4,
                    recordedBehaviors: 3,
                    foreshadowLoop: { pass: false, summary: '缺一次回收' },
                },
            })],
        });
        const result = await toolOf(port, 'get_execution_status').execute({}, { memory: { slots: {} } });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('[完成]');
        expect(result.content).toContain('第3章 结算');
        expect(result.content).toContain('耗时 3s');
        expect(result.content).toContain('更新 9');
        expect(result.content).toContain('搁置 2');
        expect(result.content).toContain('拒绝字段 1');
        expect(result.content).toContain('链接化 4');
        expect(result.content).toContain('出场记录 3');
        expect(result.content).toContain('伏笔闭环未通过：缺一次回收');
    });

    it('失败记录展示失败原因；进行中记录不显示耗时', async () => {
        const port = makePort({
            getExecutionLedger: () => [
                record({ status: 'failed', failure: '分析报告缺失', finishedAt: 2_000, commandId: 'novel-writer-write-chapter' }),
                record({ status: 'running', finishedAt: undefined, commandId: 'novel-writer-export-manuscript' }),
            ],
        });
        const result = await toolOf(port, 'get_execution_status').execute({}, { memory: { slots: {} } });
        expect(result.content).toContain('[失败]');
        expect(result.content).toContain('分析报告缺失');
        expect(result.content).toContain('[进行中]');
    });

    it('按项目过滤；项目名不合法时回退为不过滤（不会把原始字符串当路径）', async () => {
        const records = [
            record({ project: '长篇小说/断刃城' }),
            record({ project: '短篇小说/别的', commandId: 'novel-writer-export-manuscript' }),
        ];
        const port = makePort({ getExecutionLedger: () => records });
        const filtered = await toolOf(port, 'get_execution_status')
            .execute({ project: '断刃城' }, { memory: { slots: {} } });
        expect(filtered.content).toContain('断刃城');
        expect(filtered.content).not.toContain('短篇小说/别的');

        const bogus = await toolOf(port, 'get_execution_status')
            .execute({ project: '../../etc' }, { memory: { slots: {} } });
        expect(bogus.ok).toBe(true);
        expect(bogus.content).toContain('条长流程记录');
    });

    it('limit 被夹到 1–20', async () => {
        const seen: number[] = [];
        const port = makePort({
            getExecutionLedger: (limit) => {
                seen.push(limit ?? -1);
                return [record()];
            },
        });
        const tool = toolOf(port, 'get_execution_status');
        await tool.execute({ limit: 999 }, { memory: { slots: {} } });
        await tool.execute({ limit: 0 }, { memory: { slots: {} } });
        expect(seen).toEqual([20, 1]);
    });
});