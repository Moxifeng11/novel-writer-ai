/**
 * agent-port-status.test.ts — B2 端口阶段投影（flow）的降级契约回归
 *
 * 背景：v5 B2 要求 `AgentPort.getProjectStatus` 用 `collectCreationFlowState`
 * 填充 `flow`，并在采集失败时省略该字段而不阻断基础进度（见 v5 计划 §七
 * 「collectCreationFlowState 读盘失败」）。
 * 该分支此前没有单测覆盖：工作台侧测的是 `fetchStagePanelModel` 的 catch，
 * engine 侧测的是格式化器，端口层的「采集失败仍返回章节统计」无人锁定。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCreationFlow } from '../../../shared/creation-flow';
import type { AgentProjectStatus } from '@/engine/agent/agent-types';

const mocks = vi.hoisted(() => ({
    readProjectMeta: vi.fn(),
    getChaptersForProject: vi.fn(),
    collectCreationFlowState: vi.fn(),
}));

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

vi.mock('@/shared/paths', async importOriginal => ({
    ...(await importOriginal<typeof import('@/shared/paths')>()),
    readProjectMeta: mocks.readProjectMeta,
}));

vi.mock('@/ui/project-utils', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ui/project-utils')>()),
    getChaptersForProject: mocks.getChaptersForProject,
}));

vi.mock('@/ui/full-writer/creation-flow-state', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ui/full-writer/creation-flow-state')>()),
    collectCreationFlowState: mocks.collectCreationFlowState,
}));

const { createAgentPort } = await import('@/ui/services/agent-port');

const PROJECT_META = ['## 创作模式', '长篇小说', ''].join('\n');

const BASE_FACTS = {
    preResearchDone: false,
    docs: {},
    unitTotal: 0,
    unitTarget: 0,
    unitWritten: 0,
    nextUnitNumber: null,
    exportExists: false,
};

const FLOW_SNAPSHOT = resolveCreationFlow('long', '长篇小说/示例', {
    ...BASE_FACTS,
    wizardDone: true,
    unitTotal: 2,
    unitWritten: 1,
    unitSettled: 1,
    nextUnitNumber: 2,
});

function makePort() {
    return createAgentPort({} as never, {} as never);
}

function chapter(chapterName: string, written: boolean) {
    return {
        chapter: chapterName,
        volume: '',
        title: chapterName,
        status: written ? 'written' : 'planned',
        file: null,
        hasBody: written,
        written,
        size: written ? 2000 : 0,
    };
}

describe('AgentPort.getProjectStatus — 阶段投影 flow 降级契约', () => {
    beforeEach(() => {
        mocks.readProjectMeta.mockReset().mockResolvedValue(PROJECT_META);
        mocks.getChaptersForProject.mockReset().mockReturnValue([
            chapter('第1章', true),
            chapter('第2章', false),
        ]);
        mocks.collectCreationFlowState.mockReset();
    });

    it('采集成功时返回完整 flow 快照', async () => {
        mocks.collectCreationFlowState.mockResolvedValue({
            mode: 'long',
            facts: {},
            snapshot: FLOW_SNAPSHOT,
        });

        const status = await makePort().getProjectStatus!('长篇小说/示例');

        expect(status).not.toBeNull();
        const typed = status as AgentProjectStatus;
        expect(typed.mode).toBe('long');
        expect(typed.flow).toEqual(FLOW_SNAPSHOT);
        expect(typed.totalChapters).toBe(2);
        expect(typed.writtenChapters).toBe(1);
    });

    it('采集抛错时省略 flow，但章节统计仍可用（不阻断旧行为）', async () => {
        mocks.collectCreationFlowState.mockRejectedValue(new Error('read failed'));

        const status = await makePort().getProjectStatus!('长篇小说/示例');

        expect(status).not.toBeNull();
        const typed = status as AgentProjectStatus;
        expect(typed.flow).toBeUndefined();
        expect(typed.mode).toBe('long');
        expect(typed.totalChapters).toBe(2);
        expect(typed.writtenChapters).toBe(1);
    });

    it('项目元信息读取失败时整体返回 null（外层兜底不变）', async () => {
        mocks.readProjectMeta.mockRejectedValue(new Error('meta missing'));

        const status = await makePort().getProjectStatus!('长篇小说/示例');

        expect(status).toBeNull();
        expect(mocks.collectCreationFlowState).not.toHaveBeenCalled();
    });
});
