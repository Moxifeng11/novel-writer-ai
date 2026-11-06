/**
 * agent-stage-panel.test.ts — 工作台阶段面板视图模型
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCreationFlow } from '../../../shared/creation-flow';
import {
    buildStagePanelModel,
    buildStagePrompt,
    fetchStagePanelModel,
} from '../../../ui/agent-workbench/stage-panel';

const BASE_FACTS = {
    preResearchDone: false,
    docs: {},
    unitTotal: 0,
    unitTarget: 0,
    unitWritten: 0,
    nextUnitNumber: null,
    exportExists: false,
};

describe('buildStagePanelModel', () => {
    it('长篇：真实阶段、进度与下一步来自统一快照', () => {
        const flow = resolveCreationFlow('long', '长篇小说/示例', {
            ...BASE_FACTS,
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            unitSettled: 4,
            nextUnitNumber: 6,
        });
        const model = buildStagePanelModel(flow, '长篇小说/示例');

        expect(model.modeLabel).toBe('长篇小说');
        expect(model.percent).toBe(56);
        expect(model.nextLabel).toBe('章节写作');
        expect(model.items.map(item => item.id)).toEqual(['wizard', 'chapters', 'settlement', 'export']);
        expect(model.items[1].ratioPercent).toBe(50);
        expect(model.items[1].state).toBe('active');
        expect(model.items[3].state).toBe('blocked');
        expect(model.items[3].progressText).toContain('先完成');
        expect(model.emptyText).toBe('');
    });

    it('短篇：前置完成后进入分节写作，导出被依赖阻塞', () => {
        const flow = resolveCreationFlow('short', '短篇小说/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitTarget: 20,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '短篇小说/示例');

        expect(model.modeLabel).toBe('短篇小说');
        expect(model.items.map(item => item.id)).toEqual(['research', 'outline', 'units', 'export']);
        expect(model.items[0].state).toBe('done');
        expect(model.items[2].state).toBe('active');
        expect(model.items[3].state).toBe('blocked');
        expect(model.items[3].progressText).toContain('先完成');
        expect(model.nextLabel).toBe('分节写作');
    });

    it('剧本：五阶段含分镜表，下一步停在分镜表', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true, storyboard: false },
            unitTotal: 12,
            unitWritten: 0,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '剧本/示例');

        expect(model.items.map(item => item.id)).toEqual(['research', 'outline', 'storyboard', 'units', 'export']);
        expect(model.items[2].state).toBe('active');
        expect(model.items[3].state).toBe('todo');
        expect(model.items[4].state).toBe('blocked');
        expect(model.nextLabel).toBe('分镜表');
    });

    it('剧本：分镜表完成后进入分集写作', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true, storyboard: true },
            unitTotal: 12,
            unitWritten: 0,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '剧本/示例');

        expect(model.items[3].state).toBe('active');
        expect(model.nextLabel).toBe('分集写作');
    });

    it('剧本：预填话术带分集单元标签', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 12,
            nextUnitNumber: 1,
        });
        const unitStage = flow.stages.find(stage => stage.id === 'units');
        expect(unitStage).toBeTruthy();
        expect(buildStagePrompt(unitStage!)).toContain('继续「分集写作」');
        expect(buildStagePrompt(unitStage!)).toContain('集');
    });

    it('无项目/无快照时给出占位文案而不是硬编码阶段', () => {
        expect(buildStagePanelModel(null, '').emptyText).toContain('未选择项目');
        expect(buildStagePanelModel(undefined, '长篇小说/示例').emptyText).toContain('阶段读取失败');
        expect(buildStagePanelModel(null, '').items).toEqual([]);
    });
});

describe('fetchStagePanelModel（工作台刷新路径）', () => {
    const longFlow = resolveCreationFlow('long', '长篇小说/甲', {
        ...BASE_FACTS,
        wizardDone: true,
        unitTotal: 10,
        unitWritten: 5,
        nextUnitNumber: 6,
    });
    const shortFlow = resolveCreationFlow('short', '短篇小说/乙', {
        ...BASE_FACTS,
        preResearchDone: true,
        docs: { outline: true },
        unitTotal: 20,
        unitTarget: 20,
        nextUnitNumber: 1,
    });

    it('有项目：用 port 快照渲染真实阶段', async () => {
        const getStatus = vi.fn(async () => ({ flow: longFlow }));
        const model = await fetchStagePanelModel('长篇小说/甲', getStatus);

        expect(getStatus).toHaveBeenCalledWith('长篇小说/甲');
        expect(model.project).toBe('长篇小说/甲');
        expect(model.emptyText).toBe('');
        expect(model.modeLabel).toBe('长篇小说');
        expect(model.items).toHaveLength(4);
        expect(model.nextLabel).toBe('章节写作');
    });

    it('未选择项目：不请求 port，显示占位', async () => {
        const getStatus = vi.fn(async () => ({ flow: longFlow }));
        const model = await fetchStagePanelModel('', getStatus);

        expect(getStatus).not.toHaveBeenCalled();
        expect(model.emptyText).toContain('未选择项目');
        expect(model.items).toEqual([]);
    });

    it('切换项目：晚到的旧项目结果仍带原项目标识，可由视图丢弃', async () => {
        let resolveLong: (value: { flow?: typeof longFlow }) => void = () => undefined;
        let resolveShort: (value: { flow?: typeof shortFlow }) => void = () => undefined;
        const longPending = new Promise<{ flow?: typeof longFlow }>(resolve => { resolveLong = resolve; });
        const shortPending = new Promise<{ flow?: typeof shortFlow }>(resolve => { resolveShort = resolve; });

        // 先请求甲项目，未等结果就切到乙项目（复现快速切换）
        const first = fetchStagePanelModel('长篇小说/甲', () => longPending);
        const second = fetchStagePanelModel('短篇小说/乙', () => shortPending);
        resolveShort({ flow: shortFlow });
        const modelB = await second;
        resolveLong({ flow: longFlow });
        const modelA = await first;

        expect(modelB.project).toBe('短篇小说/乙');
        expect(modelB.modeLabel).toBe('短篇小说');
        // 旧请求返回时仍标记为甲项目 → 视图用 activeProject !== project 判定过期
        expect(modelA.project).toBe('长篇小说/甲');
        expect(modelA.modeLabel).toBe('长篇小说');
    });

    it('port 抛错：按「阶段读取失败」占位，不中断工作台', async () => {
        const getStatus = vi.fn(async () => { throw new Error('读盘失败'); });
        const model = await fetchStagePanelModel('长篇小说/甲', getStatus);

        expect(getStatus).toHaveBeenCalledTimes(1);
        expect(model.emptyText).toContain('阶段读取失败');
        expect(model.items).toEqual([]);
    });

    it('port 返回 null 或缺失：按「阶段读取失败」占位', async () => {
        expect((await fetchStagePanelModel('长篇小说/甲', async () => null)).emptyText)
            .toContain('阶段读取失败');
        expect((await fetchStagePanelModel('长篇小说/甲', undefined)).emptyText)
            .toContain('阶段读取失败');
    });
});

describe('工作台刷新接线（源码契约）', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

    it('晚到结果按 activeProject 丢弃，避免串项目', () => {
        const view = read('ui/agent-workbench-view.ts');
        expect(view).toContain('fetchStagePanelModel(project, this.port.getProjectStatus)');
        expect(view).toContain('this.activeProject !== project');
    });

    it('初次渲染、项目列表刷新与切换项目都会刷新阶段面板', () => {
        const view = read('ui/agent-workbench-view.ts');
        const awaited = view.split('await this.refreshStagePanel()').length - 1;
        const fireAndForget = view.split('void this.refreshStagePanel()').length - 1;
        expect(awaited).toBeGreaterThanOrEqual(1);
        expect(awaited + fireAndForget).toBeGreaterThanOrEqual(3);
    });

    it('点击阶段只预填输入框，不自动执行命令', () => {
        const view = read('ui/agent-workbench-view.ts');
        expect(view).toContain('this.prefillComposer(item.prompt)');
        const clickBlock = view.slice(
            view.indexOf("row.addEventListener('click'"),
            view.indexOf("row.addEventListener('keydown'"),
        );
        expect(clickBlock).not.toContain('this.submit(');
    });
});

describe('buildStagePrompt', () => {
    it('普通阶段生成可预填的一句话', () => {
        const flow = resolveCreationFlow('long', '长篇小说/示例', {
            ...BASE_FACTS,
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            nextUnitNumber: 6,
        });
        const prompt = buildStagePrompt(flow.stages[1]);
        expect(prompt).toContain('继续「章节写作」');
        expect(prompt).toContain('继续写第6章');
    });

    it('阻塞阶段带上原因', () => {
        const flow = resolveCreationFlow('short', '短篇小说/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitTarget: 20,
            nextUnitNumber: 1,
        });
        const exportStage = flow.stages[3];
        expect(buildStagePrompt(exportStage)).toContain('先完成');
    });
});
