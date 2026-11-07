/**
 * agent-port-status.test.ts — B2 端口状态投影的正常路径与降级契约
 *
 * 背景：v5 B2 要求 `AgentPort.getProjectStatus` 用 `collectCreationFlowState`
 * 填充 `flow`，并在采集失败时省略该字段而不阻断基础进度（见 v5 计划 §七
 * 「collectCreationFlowState 读盘失败」）。
 * 第 89 轮补测（ZCode 派工）：短篇/剧本的模式推断与单元统计、`runCommand`
 * 的命令 id 校验与失败登记（未注册 → false 而非抛错）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCreationFlow } from '../../../shared/creation-flow';
import type { AgentProjectStatus } from '@/engine/agent/agent-types';

const mocks = vi.hoisted(() => ({
    readProjectMeta: vi.fn(),
    getChaptersForProject: vi.fn(),
    collectCreationFlowState: vi.fn(),
    listModeUnits: vi.fn(),
    registryHas: vi.fn(),
    executeCommandAsync: vi.fn(),
    recordFailed: vi.fn(),
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

vi.mock('@/shared/mode-content', async importOriginal => ({
    ...(await importOriginal<typeof import('@/shared/mode-content')>()),
    listModeUnits: mocks.listModeUnits,
}));

vi.mock('@/services/execution-ledger', () => ({
    getExecutionLedger: () => ({ recordFailed: mocks.recordFailed, getRecent: () => [] }),
}));

const { createAgentPort } = await import('@/ui/services/agent-port');

const PROJECT_META = ['## 创作模式', '长篇小说', ''].join('\n');
const SHORT_META = ['## 创作模式', '短篇小说', ''].join('\n');
const SCRIPT_META = ['## 创作模式', '短剧剧本', ''].join('\n');

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

function makePort(plugin: unknown = {}) {
    return createAgentPort({} as never, plugin as never);
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
        mocks.listModeUnits.mockReset();
        mocks.registryHas.mockReset();
        mocks.executeCommandAsync.mockReset();
        mocks.recordFailed.mockReset();
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

describe('AgentPort.getProjectStatus — 短篇/剧本模式推断', () => {
    beforeEach(() => {
        mocks.readProjectMeta.mockReset();
        mocks.getChaptersForProject.mockReset();
        mocks.collectCreationFlowState.mockReset();
        mocks.listModeUnits.mockReset();
    });

    it.each([
        { mode: 'short' as const, meta: SHORT_META, unitLabel: '节' },
        { mode: 'script' as const, meta: SCRIPT_META, unitLabel: '集' },
    ])('$mode 模式：按$unitLabel统计单元并把 mode 透传给阶段采集', async ({ mode, meta, unitLabel }) => {
        mocks.readProjectMeta.mockResolvedValue(meta);
        mocks.listModeUnits.mockReturnValue([
            { unitName: `第1${unitLabel}`, title: '开篇', status: 'written', file: { stat: { size: 2400 } } },
            { unitName: `第2${unitLabel}`, title: '反转', status: 'planned', file: null },
        ]);
        mocks.collectCreationFlowState.mockResolvedValue({
            mode,
            facts: {},
            snapshot: resolveCreationFlow(mode, `${mode}/示例`, BASE_FACTS),
        });

        const status = await makePort().getProjectStatus!('示例/项目') as AgentProjectStatus;

        expect(mocks.getChaptersForProject).not.toHaveBeenCalled();
        expect(mocks.listModeUnits).toHaveBeenCalledWith({}, '示例/项目', mode);
        expect(mocks.collectCreationFlowState).toHaveBeenCalledWith({}, '示例/项目', { mode });
        expect(status.mode).toBe(mode);
        expect(status.totalChapters).toBe(2);
        expect(status.writtenChapters).toBe(1);
        expect(status.nextChapterToWrite).toBe(`第2${unitLabel}`);
        expect(status.flow).toBeDefined();
    });
});

describe('AgentPort.runCommand — 命令 id 校验与失败登记', () => {
    function runPlugin() {
        return {
            getActiveProject: () => '短篇小说/示例',
            registry: { has: mocks.registryHas },
            executeCommandAsync: mocks.executeCommandAsync,
        };
    }

    beforeEach(() => {
        mocks.registryHas.mockReset();
        mocks.executeCommandAsync.mockReset();
        mocks.recordFailed.mockReset();
    });

    it('未注册的命令 id 返回 false，不进入执行且登记失败', async () => {
        mocks.registryHas.mockReturnValue(false);

        const ok = await makePort(runPlugin()).runCommand!('novel-writer:typo');

        expect(ok).toBe(false);
        expect(mocks.executeCommandAsync).not.toHaveBeenCalled();
        expect(mocks.recordFailed).toHaveBeenCalledTimes(1);
        expect(mocks.recordFailed).toHaveBeenCalledWith(expect.objectContaining({
            commandId: 'novel-writer:typo',
            source: 'agent',
            failure: expect.stringContaining('未在插件注册表'),
        }));
    });

    it('已注册且执行成功时返回 true，不登记失败', async () => {
        mocks.registryHas.mockReturnValue(true);
        mocks.executeCommandAsync.mockResolvedValue(true);

        const ok = await makePort(runPlugin()).runCommand!('novel-writer:write-next');

        expect(ok).toBe(true);
        expect(mocks.executeCommandAsync).toHaveBeenCalledWith('novel-writer:write-next');
        expect(mocks.recordFailed).not.toHaveBeenCalled();
    });

    it('已注册但执行返回 false 时登记「命令执行抛错」', async () => {
        mocks.registryHas.mockReturnValue(true);
        mocks.executeCommandAsync.mockResolvedValue(false);

        const ok = await makePort(runPlugin()).runCommand!('novel-writer:write-next');

        expect(ok).toBe(false);
        expect(mocks.recordFailed).toHaveBeenCalledTimes(1);
        expect(mocks.recordFailed).toHaveBeenCalledWith(expect.objectContaining({
            commandId: 'novel-writer:write-next',
            failure: expect.stringContaining('命令执行抛错'),
        }));
    });

    it('执行抛错时吞掉异常、返回 false 并记录错误信息', async () => {
        mocks.registryHas.mockReturnValue(true);
        mocks.executeCommandAsync.mockRejectedValue(new Error('boom'));

        const ok = await makePort(runPlugin()).runCommand!('novel-writer:write-next');

        expect(ok).toBe(false);
        expect(mocks.recordFailed).toHaveBeenCalledTimes(1);
        expect(mocks.recordFailed).toHaveBeenCalledWith(expect.objectContaining({
            commandId: 'novel-writer:write-next',
            failure: 'boom',
        }));
    });
});
